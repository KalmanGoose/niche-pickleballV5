#!/usr/bin/env python3
"""
NCHU Pickleball - Real Strokes Feature Extractor v2 (Turbo & Rigorous)
=====================================================================
Changes in v2:
1. Isotropic pixel conversion (compensates for 1080x1920 portrait aspect ratio).
2. Honest non-dimensional kinematics (units in torso-lengths/s and torso-lengths/s^2).
3. Correct Y-up coordinate convention: wrist above hip is positive, wrist below hip is negative.
4. Scale estimation using median torso length with degeneracy guard.
5. Outlier/teleportation jump rejection and 1-Euro filtering to prevent 30,000 extreme speeds.
6. Class-agnostic candidate stroke event detector (identical thresholds for all videos).
7. Label preservation: VOLLEY_PUNCH is kept distinct from PASSIVE_BLOCK.
8. Multi-frame contact progression collage generation for visual audit.
9. Comprehensive checksum and parameter checkpointing.
"""

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import glob
import math
import json
import hashlib
import csv
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from scripts.kinematics_v2 import (
    to_pixel_coords,
    calculate_angle_2d,
    estimate_reference_scale,
    compute_kinematics_series,
    detect_candidate_events,
    DEG_OK,
    DEG_SCALE_LOW,
    DEG_SCALE_HIGH
)
from scripts.manifest_annotations_v2 import (
    ManifestValidationError,
    atomic_write_csv_rows,
    atomic_write_json,
    load_and_validate_manifest,
    match_and_merge_manifest_annotations,
)

os.environ['MPLCONFIGDIR'] = '/tmp/matplotlib'

CODE_VERSION = "2.0.0"
MODEL_PATH = "models/pose_landmarker_heavy.task"
VIDEOS_DIR = "data/videos"
OUTPUT_DIR = "data/v2"
CHECKPOINT_PATH = os.path.join(OUTPUT_DIR, "checkpoint_v2.json")
DATASET_JSON_PATH = os.path.join(OUTPUT_DIR, "real_strokes_dataset_v2.json")
DATASET_CSV_PATH = os.path.join(OUTPUT_DIR, "real_strokes_dataset_v2.csv")
COLLAGE_DIR = os.path.join(OUTPUT_DIR, "verification_collages")
MANIFEST_PATH = os.path.join(OUTPUT_DIR, "candidate_events_manifest.csv")

# 動作標籤映射：保留 volley_punch 的獨立性，不與 passive_block 混淆
RAW_CLASS_MAPPING = {
    "serve_legal": "UNDERHAND_LEGAL",
    "serve_fault": "OVERHAND_FAULT",
    "dink": "KITCHEN_DINK",
    "drive": "POWER_DRIVE",
    "smash": "SMASH",
    "volley_punch": "VOLLEY_PUNCH",
    "block": "PASSIVE_BLOCK",
    "被ㄩㄥ": "PASSIVE_BLOCK"
}

FEATURE_NAMES_V2 = [
    "wrist_y_rel_hip",            # 手腕相對臀部高度 (正值=腰部上方, 負值=腰部下方, 單位: torso-lengths)
    "elbow_angle_deg",            # 手肘夾角 (度數 0~180, 像素平面)
    "shoulder_angle_deg",         # 肩膀抬升角 (度數 0~180, 像素平面)
    "wrist_speed_torso_s",        # 手腕瞬時線速率 (單位: torso-lengths/s)
    "wrist_accel_y_torso_s2",     # 手腕真實垂直加速度 (Y向上為正, 單位: torso-lengths/s^2)
    "torso_yaw_deg",              # 軀幹轉身角 (度數 -45 ~ +45)
    "stance_balance_ratio",       # 重心左右偏移比例 (相對於腳踝中點, 單位: torso-lengths)
    "left_hand_up",               # 左手是否舉起高於左肩 (0.0 或 1.0)
    "estimated_wrist_height_ratio",# 手腕相對於腳踝高度比例 (單位: torso-lengths)
    "swing_path_len_torso"        # 候選事件手腕總位移路徑長度 (單位: torso-lengths)
]

POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28),
    (15, 19), (15, 21), (16, 20), (16, 22)
]

KINEMATICS_SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "kinematics_v2.py")
EXTRACTOR_SCRIPT_PATH = os.path.abspath(__file__)

DETECTOR_PARAMS = {
    "frame_step": 2,
    "min_peak_speed": 1.5,
    "min_path_len": 0.3,
    "merge_window_s": 0.45,
    "max_cluster_span_s": 0.38,
    "target_w": 540,
    "min_pose_presence_confidence": 0.5,
    "min_tracking_confidence": 0.5
}

def compute_detector_params_hash(params):
    payload = json.dumps(params, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

def compute_file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def get_raw_class_for_filename(filename):
    lower = filename.lower()
    for key, cls_name in RAW_CLASS_MAPPING.items():
        if key in lower:
            return cls_name
    return None

def load_checkpoint_v2(checkpoint_path=None):
    target_path = checkpoint_path or CHECKPOINT_PATH
    if os.path.exists(target_path):
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            raise ManifestValidationError(
                f"[{target_path}] Failed to read or parse existing checkpoint JSON: {exc}"
            ) from exc
    return {}

def save_checkpoint_v2(chk, checkpoint_path=None):
    target_path = checkpoint_path or CHECKPOINT_PATH
    atomic_write_json(target_path, chk)

def load_existing_manifest_annotations(manifest_path):
    """
    Fail-closed manifest loader:
    Validates existing manifest CSV and returns exact `(video, event_id)` dictionary.
    Raises ManifestValidationError on any I/O, encoding, CSV, missing-column,
    duplicate-key, or contradictory-status error.
    """
    state = load_and_validate_manifest(manifest_path)
    if not state["exists"]:
        return {}
    return state["by_key"]

def draw_skeleton_on_frame(frame, lms, width, height, highlight_wrist=True):
    annotated = frame.copy()
    if not lms:
        return annotated
        
    for p1_idx, p2_idx in POSE_CONNECTIONS:
        p1 = lms[p1_idx]
        p2 = lms[p2_idx]
        if p1.visibility > 0.4 and p2.visibility > 0.4:
            pt1 = (int(p1.x * width), int(p1.y * height))
            pt2 = (int(p2.x * width), int(p2.y * height))
            cv2.line(annotated, pt1, pt2, (0, 255, 255), 3)

    for idx, lm in enumerate(lms):
        if lm.visibility > 0.4:
            pt = (int(lm.x * width), int(lm.y * height))
            color = (0, 0, 255) if (idx in [15, 16] and highlight_wrist) else (0, 255, 0)
            radius = 6 if idx in [15, 16] else 4
            cv2.circle(annotated, pt, radius, color, -1)

    return annotated

def create_multi_frame_collage(cap, event, lms_by_frame, width, height, output_path):
    """
    Create a 5-frame contact progression collage:
    [Start, Lead-in, Peak, Follow-through, End]
    """
    f_start = event["start_frame_idx"]
    f_peak = event["peak_frame_idx"]
    f_end = event["end_frame_idx"]
    
    f_mid1 = (f_start + f_peak) // 2
    f_mid2 = (f_peak + f_end) // 2
    
    target_indices = [f_start, f_mid1, f_peak, f_mid2, f_end]
    labels = ["Start", "Approach", "Candidate Peak", "Follow", "End"]
    
    panel_w = 216
    panel_h = 384
    panels = []
    
    for idx_in_ev, f_idx in enumerate(target_indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            panel = np.zeros((panel_h, panel_w, 3), dtype=np.uint8)
        else:
            lms = lms_by_frame.get(f_idx)
            skel = draw_skeleton_on_frame(frame, lms, width, height)
            panel = cv2.resize(skel, (panel_w, panel_h))
            
        color = (0, 0, 255) if idx_in_ev == 2 else (0, 255, 0)
        cv2.putText(panel, f"{labels[idx_in_ev]}: f{f_idx}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        if idx_in_ev == 2:
            speed = event["peak_speed_torso_s"]
            cv2.putText(panel, f"v={speed:.2f} t/s", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        panels.append(panel)
        
    collage = np.hstack(panels)
    
    # Add top banner
    banner = np.zeros((40, collage.shape[1], 3), dtype=np.uint8)
    banner_text = f"Event: {event['event_id']} | Class: {event['raw_class']} | Duration: {event['duration_s']:.2f}s | Path: {event['path_length_torso']:.2f} torso"
    cv2.putText(banner, banner_text, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    
    full_img = np.vstack([banner, collage])
    cv2.imwrite(output_path, full_img)

def process_video_v2(video_path, base_options, model_sha, collage_out_dir=None):
    fname = os.path.basename(video_path)
    raw_class = get_raw_class_for_filename(fname)
    if raw_class is None:
        print(f"⚠️ 跳過未識別類別之影片: {fname}", flush=True)
        return []

    video_sha = compute_file_sha256(video_path)

    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5
    )
    detector = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"\n🎬 [v2 提取] {fname} [{raw_class}] (總幀數: {total_frames}, FPS: {fps:.2f}, 解析度: {width}x{height})", flush=True)

    # 4X 加速：等比縮小至 540x960 供 MediaPipe 輸入，保持 100% 關節無失真
    target_w = 540
    target_h = int(height * (target_w / width))

    frame_idx = 0
    timestamps = []
    frames_landmarks = []
    wrist_px_positions = []
    wrist_visibilities = []
    lms_dict_for_collage = {}

    FRAME_STEP = 2  # ~30fps sampling for robust peak detection

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
            
        frame_idx += 1
        if frame_idx % FRAME_STEP != 0:
            continue

        ts_ms = int(frame_idx * (1000.0 / fps))
        t_sec = ts_ms / 1000.0

        small_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = detector.detect_for_video(mp_image, ts_ms)

        if frame_idx % 600 == 0 or frame_idx >= total_frames - 2:
            pct = int((frame_idx / total_frames) * 100)
            print(f"\r   ⏳ 逐幀推論: {frame_idx}/{total_frames} 幀 ({pct}%) [{'█'*(pct//5)}{'░'*(20 - pct//5)}]", end="", flush=True)

        if res.pose_landmarks and len(res.pose_landmarks) > 0:
            lms = res.pose_landmarks[0]
            frames_landmarks.append(lms)
            lms_dict_for_collage[frame_idx] = lms

            # 16: 右手腕
            rw = lms[16]
            rw_px = to_pixel_coords((rw.x, rw.y), width, height)
            wrist_px_positions.append(rw_px)
            wrist_visibilities.append(rw.visibility)
        else:
            frames_landmarks.append(None)
            wrist_px_positions.append(None)
            wrist_visibilities.append(0.0)

        timestamps.append(t_sec)

    detector.close()
    print("", flush=True)

    # 1. 估算穩定軀幹參考尺度 S_ref (像素)
    scale_ref, torso_lengths = estimate_reference_scale(frames_landmarks, width, height)
    print(f"   📏 穩定軀幹參考尺度 S_ref: {scale_ref:.1f} pixels (中位數估計)", flush=True)

    # 2. 計算運動學時間序列 (速度、垂直速度、垂直加速度)
    speeds, vel_x, vel_y, accel_y, flags = compute_kinematics_series(
        wrist_px_positions, timestamps, scale_ref, wrist_visibilities
    )

    # 3. 動作無關候選事件偵測 (Class-Agnostic Candidate Event Detector)
    raw_events = detect_candidate_events(
        speeds=speeds,
        times=timestamps,
        positions_px=wrist_px_positions,
        flags=flags,
        scale_ref=scale_ref,
        min_peak_speed=DETECTOR_PARAMS["min_peak_speed"],
        min_path_len=DETECTOR_PARAMS["min_path_len"],
        merge_window_s=DETECTOR_PARAMS["merge_window_s"],
        max_cluster_span_s=DETECTOR_PARAMS["max_cluster_span_s"]
    )

    print(f"   🎯 通用偵測器識別出 {len(raw_events)} 次候選揮拍事件", flush=True)

    # 4. 提取打擊峰值特徵並格式化事件
    stem = os.path.splitext(fname)[0]
    final_events = []
    
    for ev_idx, ev in enumerate(raw_events):
        p_idx = ev["peak_frame_idx"]
        lms = frames_landmarks[p_idx]
        if not lms:
            continue
            
        rw = lms[16] # 右腕
        re = lms[14] # 右肘
        rs = lms[12] # 右肩
        rh = lms[24] # 右髖
        lh = lms[23] # 左髖
        ls = lms[11] # 左肩
        lw = lms[15] # 左腕
        ra = lms[28] # 右踝
        la = lms[27] # 左踝

        # 轉換為物理像素座標以計算真實角度與相對高度
        rw_px = to_pixel_coords((rw.x, rw.y), width, height)
        re_px = to_pixel_coords((re.x, re.y), width, height)
        rs_px = to_pixel_coords((rs.x, rs.y), width, height)
        rh_px = to_pixel_coords((rh.x, rh.y), width, height)
        lh_px = to_pixel_coords((lh.x, lh.y), width, height)
        ls_px = to_pixel_coords((ls.x, ls.y), width, height)
        lw_px = to_pixel_coords((lw.x, lw.y), width, height)
        ra_px = to_pixel_coords((ra.x, ra.y), width, height)
        la_px = to_pixel_coords((la.x, la.y), width, height)

        mid_hip_px_y = (rh_px[1] + lh_px[1]) / 2.0
        mid_hip_px_x = (rh_px[0] + lh_px[0]) / 2.0
        mid_ankle_px_x = (ra_px[0] + la_px[0]) / 2.0

        # (1) wrist_y_rel_hip: Y向上為正！手腕在腰上方為正，腰下方為負
        wrist_y_rel_hip = (mid_hip_px_y - rw_px[1]) / scale_ref

        # (2) elbow_angle_deg (像素平面真實幾何夾角)
        elbow_angle = calculate_angle_2d(rs_px, re_px, rw_px)

        # (3) shoulder_angle_deg (軀幹與大臂夾角)
        shoulder_angle = calculate_angle_2d(rh_px, rs_px, re_px)

        # (4) wrist_speed_torso_s
        wrist_speed = float(speeds[p_idx])

        # (5) wrist_accel_y_torso_s2 (真實垂直速度微分)
        wrist_acc_y = float(accel_y[p_idx])

        # (6) torso_yaw_deg (肩膀深度差)
        sh_dz = rs.z - ls.z
        torso_yaw = math.asin(np.clip(sh_dz * 2.0, -1.0, 1.0)) * (180.0 / math.pi)

        # (7) stance_balance_ratio (相對於腳踝中點的重心偏移)
        stance_balance = (mid_hip_px_x - mid_ankle_px_x) / scale_ref

        # (8) left_hand_up (左手腕在影像中高於左肩，即 y 較小)
        left_hand_up = 1.0 if lw_px[1] < ls_px[1] else 0.0

        # (9) estimated_wrist_height_ratio (相對於腳踝的高度比例)
        estimated_wrist_height = (ra_px[1] - rw_px[1]) / scale_ref

        # (10) swing_path_len_torso
        swing_path_len = float(ev["path_length_torso"])

        features_dict = {
            "wrist_y_rel_hip": round(wrist_y_rel_hip, 4),
            "elbow_angle_deg": round(elbow_angle, 2),
            "shoulder_angle_deg": round(shoulder_angle, 2),
            "wrist_speed_torso_s": round(wrist_speed, 3),
            "wrist_accel_y_torso_s2": round(wrist_acc_y, 3),
            "torso_yaw_deg": round(torso_yaw, 2),
            "stance_balance_ratio": round(stance_balance, 3),
            "left_hand_up": round(left_hand_up, 1),
            "estimated_wrist_height_ratio": round(estimated_wrist_height, 3),
            "swing_path_len_torso": round(swing_path_len, 3)
        }

        # 退化標記
        torso_L = torso_lengths[p_idx]
        deg_flag = DEG_OK
        if torso_L is not None:
            if torso_L < 0.4 * scale_ref:
                deg_flag = DEG_SCALE_LOW
            elif torso_L > 2.0 * scale_ref:
                deg_flag = DEG_SCALE_HIGH

        orig_peak_frame = (p_idx + 1) * FRAME_STEP
        orig_start_frame = (ev["start_frame_idx"] + 1) * FRAME_STEP
        orig_end_frame = (ev["end_frame_idx"] + 1) * FRAME_STEP

        event_record = {
            "event_id": f"{stem}_ev_{ev_idx+1:03d}",
            "video": fname,
            "video_sha256": video_sha,
            "raw_class": raw_class,
            "candidate_peak_frame": orig_peak_frame,
            "start_frame": orig_start_frame,
            "end_frame": orig_end_frame,
            "timestamp_peak_s": round(ev["timestamp_peak_s"], 3),
            "duration_s": round(ev["duration_s"], 3),
            "peak_speed_torso_s": round(wrist_speed, 3),
            "path_length_torso": round(swing_path_len, 3),
            "quality_flag": deg_flag,
            "features": features_dict
        }
        final_events.append(event_record)

    # 5. 生成連續多格預覽 Collage（供人工驗證確認真偽）
    # 每類生成前 8 個事件的 Collage
    target_collage_dir = collage_out_dir or COLLAGE_DIR
    os.makedirs(target_collage_dir, exist_ok=True)
    num_collages_to_make = min(8, len(final_events))
    for k in range(num_collages_to_make):
        ev = final_events[k]
        collage_out = os.path.join(target_collage_dir, f"{raw_class}_{ev['event_id']}.jpg")
        try:
            create_multi_frame_collage(
                cap,
                {
                    "event_id": ev["event_id"],
                    "raw_class": ev["raw_class"],
                    "start_frame_idx": ev["start_frame"],
                    "peak_frame_idx": ev["candidate_peak_frame"],
                    "end_frame_idx": ev["end_frame"],
                    "duration_s": ev["duration_s"],
                    "path_length_torso": ev["path_length_torso"],
                    "peak_speed_torso_s": ev["peak_speed_torso_s"]
                },
                lms_dict_for_collage,
                width,
                height,
                collage_out
            )
        except Exception as e:
            print(f"⚠️ 生成 Collage 失敗 ({ev['event_id']}): {e}", flush=True)

    cap.release()
    print(f"   🖼️ 已輸出 {num_collages_to_make} 組 5 幀連續接觸動作驗證圖至 {target_collage_dir}/", flush=True)

    return final_events


def publish_extraction_outputs(
    all_events,
    staged_checkpoint,
    metadata,
    manifest_path=None,
    dataset_json_path=None,
    dataset_csv_path=None,
    checkpoint_path=None,
    existing_state=None,
):
    """
    Validate and match existing manifest annotations against `all_events` BEFORE
    replacing any output file. If validation or 1-to-1 matching fails (e.g., orphan
    signed rows or ambiguous timestamp matches), raises ManifestValidationError and
    leaves existing manifest, dataset, and checkpoint files untouched.
    Note: os.replace guarantees single-file atomicity per output file.
    """
    target_manifest = manifest_path or MANIFEST_PATH
    target_ds_json = dataset_json_path or DATASET_JSON_PATH
    target_ds_csv = dataset_csv_path or DATASET_CSV_PATH
    target_chk = checkpoint_path or CHECKPOINT_PATH

    if existing_state is None:
        existing_state = load_and_validate_manifest(target_manifest)

    merge_res = match_and_merge_manifest_annotations(existing_state, all_events)
    annotations_by_new_idx = merge_res["annotations_by_new_idx"]
    preserved_count = merge_res["preserved_signed_count"]

    manifest_rows = []
    csv_rows = []
    csv_header = [
        "event_id", "video", "raw_class", "candidate_peak_frame",
        "start_frame", "end_frame", "timestamp_peak_s", "duration_s",
        "peak_speed_torso_s", "path_length_torso", "quality_flag"
    ] + FEATURE_NAMES_V2

    for idx, ev in enumerate(all_events):
        ann = annotations_by_new_idx[idx]
        manifest_rows.append({
            "event_id": ann["resolved_event_id"],
            "video": ev["video"],
            "timestamp_peak_s": ev["timestamp_peak_s"],
            "duration_s": ev["duration_s"],
            "peak_speed_torso_s": ev["peak_speed_torso_s"],
            "raw_class": ev["raw_class"],
            "heuristic_tier": "UNCLASSIFIED",
            "audit_notes": "",
            "manual_verified": ann["manual_verified"],
            "is_true_stroke": ann["is_true_stroke"],
            "notes": ann["notes"],
        })

        feats = ev["features"]
        csv_row = {
            "event_id": ev["event_id"],
            "video": ev["video"],
            "raw_class": ev["raw_class"],
            "candidate_peak_frame": str(ev["candidate_peak_frame"]),
            "start_frame": str(ev["start_frame"]),
            "end_frame": str(ev["end_frame"]),
            "timestamp_peak_s": str(ev["timestamp_peak_s"]),
            "duration_s": str(ev["duration_s"]),
            "peak_speed_torso_s": str(ev["peak_speed_torso_s"]),
            "path_length_torso": str(ev["path_length_torso"]),
            "quality_flag": ev["quality_flag"],
        }
        for k in FEATURE_NAMES_V2:
            csv_row[k] = str(feats[k])
        csv_rows.append(csv_row)

    manifest_fieldnames = [
        "event_id", "video", "timestamp_peak_s", "duration_s",
        "peak_speed_torso_s", "raw_class", "heuristic_tier",
        "audit_notes", "manual_verified", "is_true_stroke", "notes"
    ]

    full_output = {
        "metadata": metadata,
        "events": all_events,
    }

    # Publish order: manifest -> dataset JSON -> dataset CSV -> checkpoint JSON
    # (Each file is replaced atomically via sibling tempfile + fsync + os.replace)
    atomic_write_csv_rows(target_manifest, manifest_fieldnames, manifest_rows)
    atomic_write_json(target_ds_json, full_output)
    atomic_write_csv_rows(target_ds_csv, csv_header, csv_rows)
    if staged_checkpoint is not None:
        save_checkpoint_v2(staged_checkpoint, target_chk)

    return merge_res


def main():
    print("=" * 70, flush=True)
    print("🎾 NCHU 匹克球 - 真人揮拍特徵提取器 v2 (Rigorous & Traceable)", flush=True)
    print("   版本:", CODE_VERSION)
    print("=" * 70, flush=True)

    # 0. Pre-validate existing manifest and checkpoint BEFORE creating directories or processing videos
    existing_state = load_and_validate_manifest(MANIFEST_PATH)
    checkpoint = load_checkpoint_v2(CHECKPOINT_PATH)
    staged_checkpoint = dict(checkpoint)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(COLLAGE_DIR, exist_ok=True)

    force_rerun = "--force" in sys.argv or "--no-cache" in sys.argv
    kinematics_sha = compute_file_sha256(KINEMATICS_SCRIPT_PATH)
    extractor_sha = compute_file_sha256(EXTRACTOR_SCRIPT_PATH)
    params_hash = compute_detector_params_hash(DETECTOR_PARAMS)

    base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
    model_sha = compute_file_sha256(MODEL_PATH)

    video_files = sorted(glob.glob(os.path.join(VIDEOS_DIR, "*.*")))
    valid_videos = [v for v in video_files if v.endswith((".mp4", ".mov", ".MOV")) and "備用" not in v]

    print(f"📂 掃描到 {len(valid_videos)} 部正式動作影片素材", flush=True)

    all_events = []
    import tempfile as _tempfile
    with _tempfile.TemporaryDirectory(dir=OUTPUT_DIR, prefix=".collages_staging_") as staged_collage_dir:
        for vpath in valid_videos:
            vname = os.path.basename(vpath)
            v_sha = compute_file_sha256(vpath)

            # 嚴格 Checkpoint 機制：必須同時匹配 video_sha, model_sha, kinematics_sha, extractor_sha, params_hash
            cache_entry = staged_checkpoint.get(vname)
            if (not force_rerun and cache_entry and
                cache_entry.get("code_version") == CODE_VERSION and
                cache_entry.get("video_sha256") == v_sha and
                cache_entry.get("model_sha256") == model_sha and
                cache_entry.get("kinematics_sha256") == kinematics_sha and
                cache_entry.get("extractor_sha256") == extractor_sha and
                cache_entry.get("params_hash") == params_hash):
                cached_events = cache_entry.get("events", [])
                print(f"⚡ [v2 斷點快取生效] {vname}: 秒讀 {len(cached_events)} 筆驗證事件", flush=True)
                all_events.extend(cached_events)
                continue

            events = process_video_v2(vpath, base_options, model_sha, collage_out_dir=staged_collage_dir)
            all_events.extend(events)
            staged_checkpoint[vname] = {
                "code_version": CODE_VERSION,
                "video_sha256": v_sha,
                "model_sha256": model_sha,
                "kinematics_sha256": kinematics_sha,
                "extractor_sha256": extractor_sha,
                "params_hash": params_hash,
                "events_count": len(events),
                "events": events
            }

        metadata = {
            "version": CODE_VERSION,
            "created_at": "2026-10-16",
            "model_path": MODEL_PATH,
            "model_sha256": model_sha,
            "kinematics_sha256": kinematics_sha,
            "extractor_sha256": extractor_sha,
            "params_hash": params_hash,
            "feature_names": FEATURE_NAMES_V2,
            "total_candidate_events": len(all_events)
        }

        merge_res = publish_extraction_outputs(
            all_events=all_events,
            staged_checkpoint=staged_checkpoint,
            metadata=metadata,
            manifest_path=MANIFEST_PATH,
            dataset_json_path=DATASET_JSON_PATH,
            dataset_csv_path=DATASET_CSV_PATH,
            checkpoint_path=CHECKPOINT_PATH,
            existing_state=existing_state,
        )

        # Only move staged collages into COLLAGE_DIR after manifest/dataset/checkpoint publish succeeds
        for cname in os.listdir(staged_collage_dir):
            os.replace(
                os.path.join(staged_collage_dir, cname),
                os.path.join(COLLAGE_DIR, cname),
            )

    preserved_count = merge_res["preserved_signed_count"]
    print(f"\n💾 已儲存 v2 真人事件資料庫 (JSON): {DATASET_JSON_PATH}", flush=True)
    print(f"💾 已儲存 v2 真人事件資料庫 (CSV):  {DATASET_CSV_PATH}", flush=True)
    print(f"📋 已建立/更新人工標註清單 (Manifest): {MANIFEST_PATH} (保留 {preserved_count} 筆人工標註)", flush=True)

    # 統計輸出各類別事件數
    class_tally = {}
    for ev in all_events:
        c = ev["raw_class"]
        class_tally[c] = class_tally.get(c, 0) + 1

    print("\n" + "=" * 70, flush=True)
    print("📊 v2 通用偵測器候選事件分佈統計：", flush=True)
    for c, cnt in sorted(class_tally.items(), key=lambda x: x[1], reverse=True):
        print(f"   - {c:<18}: {cnt:>3} 個候選事件", flush=True)
    print("=" * 70, flush=True)

if __name__ == "__main__":
    try:
        main()
    except ManifestValidationError as err:
        print(f"❌ Manifest 安全檢驗未通過，已中止發布以保護既有資料: {err}", file=sys.stderr, flush=True)
        sys.exit(1)
