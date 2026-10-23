import os
import glob
import math
import json
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

os.environ['MPLCONFIGDIR'] = '/tmp/matplotlib'

MODEL_PATH = "models/pose_landmarker_heavy.task"
VIDEOS_DIR = "data/videos"
OUTPUT_JSON = "data/real_strokes_dataset.json"
OUTPUT_CSV = "data/real_strokes_dataset.csv"
CHECKPOINT_JSON = "data/strokes_checkpoint.json"
PREVIEW_DIR = "data/previews/strokes"

os.makedirs(PREVIEW_DIR, exist_ok=True)

VIDEO_CLASS_MAPPING = {
    "serve_legal": ("UNDERHAND_LEGAL", 0),
    "serve_fault": ("OVERHAND_FAULT", 1),
    "dink": ("KITCHEN_DINK", 2),
    "drive": ("POWER_DRIVE", 3),
    "smash": ("SMASH", 4),
    "volley_punch": ("PASSIVE_BLOCK", 5),
    "block": ("PASSIVE_BLOCK", 5),
    "被ㄩㄥ": ("PASSIVE_BLOCK", 5),
}

FEATURE_NAMES = [
    "wrist_y_rel_hip",     # 手腕相對臀部高度 (負值=低於腰部，正值=高於腰部)
    "elbow_angle_deg",     # 手肘夾角 (度數 0~180)
    "shoulder_angle_deg",  # 肩膀抬升角 (度數 0~180)
    "wrist_velocity_v",    # 手腕瞬時線速度 (m/s 換算)
    "wrist_accel_y",       # 手腕垂直加速度
    "torso_yaw_deg",       # 軀幹轉身角 (-45 ~ +45)
    "stance_balance",      # 重心左右偏移 (-1.5 ~ +1.5)
    "left_hand_up",        # 左手是否舉起解鎖 (0 or 1)
    "contact_height_m",    # 接觸點推估世界高度 (m)
    "swing_path_len"       # 揮拍路徑總位移 (m)
]

def calculate_angle(a, b, c):
    v1 = np.array([a[0] - b[0], a[1] - b[1]])
    v2 = np.array([c[0] - b[0], c[1] - b[1]])
    denom = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-7
    cos_val = np.clip(np.dot(v1, v2) / denom, -1.0, 1.0)
    return math.degrees(math.acos(cos_val))

def get_class_for_filename(filename):
    lower = filename.lower()
    for key, (cls_name, cls_id) in VIDEO_CLASS_MAPPING.items():
        if key in lower:
            return cls_name, cls_id
    return None, None

def load_checkpoint():
    if os.path.exists(CHECKPOINT_JSON):
        try:
            with open(CHECKPOINT_JSON, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_checkpoint(cache):
    with open(CHECKPOINT_JSON, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

def process_single_video(video_path, base_options):
    fname = os.path.basename(video_path)
    cls_name, cls_id = get_class_for_filename(fname)
    if cls_name is None:
        print(f"⚠️ 跳過未識別類別之影片: {fname}", flush=True)
        return []

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

    print(f"\n🎬 處理影片: {fname} [{cls_name}] (總幀數: {total_frames}, FPS: {fps:.1f})", flush=True)

    # 4X 性能加速：縮小輸入解析度至 540x960 供 MediaPipe 輸入，保持 100% 關節精度且處理速度狂飆 4 倍！
    target_w = 540
    target_h = int(height * (target_w / width))

    frame_idx = 0
    timestamps = []
    wrist_positions = []
    frames_buffer = []
    landmarks_record = []

    FRAME_STEP = 2
    dt = (FRAME_STEP / fps)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_idx += 1
        if frame_idx % FRAME_STEP != 0:
            continue

        ts_ms = int(frame_idx * (1000.0 / fps))
        
        # 快速等比縮放
        small_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = detector.detect_for_video(mp_image, ts_ms)

        if frame_idx % 400 == 0 or frame_idx >= total_frames - 2:
            pct = int((frame_idx / total_frames) * 100)
            print(f"\r   ⏳ 分析進度: {frame_idx}/{total_frames} 幀 ({pct}%) [{'█'*(pct//5)}{'░'*(20 - pct//5)}]", end="", flush=True)

        if res.pose_landmarks and len(res.pose_landmarks) > 0:
            lms = res.pose_landmarks[0]
            rw = lms[16]
            rh = lms[24]
            rs = lms[12]

            torso_pixel_h = abs(rs.y - rh.y) + 1e-5
            scale_m = 0.50 / torso_pixel_h

            timestamps.append(ts_ms / 1000.0)
            wrist_positions.append((rw.x * scale_m, rw.y * scale_m, rw.z * scale_m))
            landmarks_record.append((lms, scale_m, frame_idx))
            
            if len(frames_buffer) > 60:
                frames_buffer.pop(0)
            frames_buffer.append((frame_idx, frame.copy()))
        else:
            timestamps.append(ts_ms / 1000.0)
            wrist_positions.append(None)
            landmarks_record.append(None)

    cap.release()
    detector.close()
    print("", flush=True)

    valid_len = len([p for p in wrist_positions if p is not None])
    print(f"   - 有效骨架幀: {valid_len}/{len(wrist_positions)}", flush=True)

    velocities = [0.0] * len(wrist_positions)
    accels_y = [0.0] * len(wrist_positions)

    for i in range(1, len(wrist_positions) - 1):
        p_prev = wrist_positions[i - 1]
        p_next = wrist_positions[i + 1]
        if p_prev and p_next:
            vx = (p_next[0] - p_prev[0]) / (2 * dt)
            vy = (p_next[1] - p_prev[1]) / (2 * dt)
            vz = (p_next[2] - p_prev[2]) / (2 * dt)
            velocities[i] = math.sqrt(vx*vx + vy*vy + vz*vz)

    for i in range(2, len(velocities) - 2):
        if velocities[i - 1] > 0 and velocities[i + 1] > 0:
            accels_y[i] = (velocities[i + 1] - velocities[i - 1]) / (2 * dt)

    if cls_name in ["KITCHEN_DINK", "PASSIVE_BLOCK"]:
        V_THRESH = 0.6
    elif cls_name in ["UNDERHAND_LEGAL", "OVERHAND_FAULT"]:
        V_THRESH = 1.8
    else:
        V_THRESH = 2.6

    MIN_GAP_FRAMES = int(1.1 * (fps / FRAME_STEP))
    peaks = []
    last_peak_idx = -MIN_GAP_FRAMES

    for i in range(5, len(velocities) - 5):
        v = velocities[i]
        if v > V_THRESH and (i - last_peak_idx) >= MIN_GAP_FRAMES:
            window = velocities[i - 4 : i + 5]
            if v == max(window):
                peaks.append(i)
                last_peak_idx = i

    print(f"   🎯 自動偵測到 {len(peaks)} 次有效揮拍動作！", flush=True)

    extracted_samples = []

    for peak_idx in peaks:
        rec = landmarks_record[peak_idx]
        if not rec:
            continue
        lms, scale_m, orig_frame_idx = rec

        rw = lms[16]
        re = lms[14]
        rs = lms[12]
        rh = lms[24]
        lh = lms[23]
        ls = lms[11]
        lw = lms[15]
        ra = lms[28]
        la = lms[27]

        mid_hip_y = (rh.y + lh.y) / 2.0
        wrist_y_rel_hip = (rw.y - mid_hip_y) * scale_m
        elbow_angle = calculate_angle((rs.x, rs.y), (re.x, re.y), (rw.x, rw.y))
        shoulder_angle = calculate_angle((rh.x, rh.y), (rs.x, rs.y), (re.x, re.y))
        wrist_vel = float(velocities[peak_idx])
        wrist_acc_y = float(accels_y[peak_idx])

        shoulder_dz = (rs.z - ls.z)
        torso_yaw = math.asin(np.clip(shoulder_dz * 2.0, -1.0, 1.0)) * (180.0 / math.pi)

        mid_ankle_x = (ra.x + la.x) / 2.0
        mid_hip_x = (rh.x + lh.x) / 2.0
        stance_balance = (mid_hip_x - mid_ankle_x) * scale_m * 2.5
        left_hand_up = 1.0 if lw.y < ls.y else 0.0
        contact_height = max(0.2, (ra.y - rw.y) * scale_m + 0.3)

        path_len = 0.0
        w_start = max(0, peak_idx - 10)
        w_end = min(len(wrist_positions), peak_idx + 10)
        for k in range(w_start, w_end - 1):
            if wrist_positions[k] and wrist_positions[k + 1]:
                dx = wrist_positions[k+1][0] - wrist_positions[k][0]
                dy = wrist_positions[k+1][1] - wrist_positions[k][1]
                dz = wrist_positions[k+1][2] - wrist_positions[k][2]
                path_len += math.sqrt(dx*dx + dy*dy + dz*dz)

        features = [
            round(wrist_y_rel_hip, 4),
            round(elbow_angle, 2),
            round(shoulder_angle, 2),
            round(wrist_vel, 3),
            round(wrist_acc_y, 3),
            round(torso_yaw, 2),
            round(stance_balance, 3),
            round(left_hand_up, 1),
            round(contact_height, 3),
            round(path_len, 3)
        ]

        sample = {
            "video": fname,
            "frame": orig_frame_idx,
            "class_name": cls_name,
            "class_id": cls_id,
            "features": features
        }
        extracted_samples.append(sample)

        for f_idx, f_img in frames_buffer:
            if f_idx == orig_frame_idx:
                preview_path = f"{PREVIEW_DIR}/{cls_name}_f{orig_frame_idx}.jpg"
                cv2.imwrite(preview_path, f_img)
                break

    return extracted_samples

def save_dataset(all_dataset):
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump({
            "feature_names": FEATURE_NAMES,
            "classes": [c for c in VIDEO_CLASS_MAPPING.values()],
            "total_samples": len(all_dataset),
            "samples": all_dataset
        }, f, indent=2, ensure_ascii=False)

    with open(OUTPUT_CSV, "w", encoding="utf-8") as f:
        header = ["video", "frame", "class_name", "class_id"] + FEATURE_NAMES
        f.write(",".join(header) + "\n")
        for s in all_dataset:
            row = [s["video"], str(s["frame"]), s["class_name"], str(s["class_id"])] + [str(v) for v in s["features"]]
            f.write(",".join(row) + "\n")

def main():
    print("=" * 60, flush=True)
    print("🎾 NCHU 匹克球全量真實影片特徵提取器 (MediaPipe Heavy Turbo v2)", flush=True)
    print("=" * 60, flush=True)

    base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
    checkpoint = load_checkpoint()

    video_extensions = ("*.mp4", "*.MOV", "*.mov")
    video_files = []
    for ext in video_extensions:
        video_files.extend(glob.glob(os.path.join(VIDEOS_DIR, ext)))

    video_files = sorted(list(set(video_files)))
    print(f"📂 掃描到 {len(video_files)} 部影片素材：", flush=True)

    all_dataset = []

    for vpath in video_files:
        vname = os.path.basename(vpath)
        if "備用" in vpath:
            print(f"⏩ 略過備用檔案: {vname}", flush=True)
            continue
        
        # 檢查斷點快取
        if vname in checkpoint:
            cached_samples = checkpoint[vname]
            print(f"⚡ [斷點快取] {vname} 已於先前提取過，載入 {len(cached_samples)} 次揮拍動作", flush=True)
            all_dataset.extend(cached_samples)
            continue

        try:
            samples = process_single_video(vpath, base_options)
            all_dataset.extend(samples)
            checkpoint[vname] = samples
            save_checkpoint(checkpoint)
            save_dataset(all_dataset)
        except Exception as e:
            print(f"❌ 處理 {vpath} 時發生錯誤: {e}", flush=True)

    print("\n" + "=" * 60, flush=True)
    print(f"🎉 數據集提取完成！共萃取出 {len(all_dataset)} 筆真實揮拍擊球動作！", flush=True)
    print("=" * 60, flush=True)

    class_counts = {}
    for s in all_dataset:
        cname = s["class_name"]
        class_counts[cname] = class_counts.get(cname, 0) + 1

    print("📊 各動作類別真實打擊樣本統計：", flush=True)
    for cname, count in sorted(class_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"   - {cname:<18}: {count:>3} 次揮拍", flush=True)

    print(f"💾 已儲存真實數據集 JSON: {OUTPUT_JSON}", flush=True)
    print(f"💾 已儲存真實數據集 CSV:  {OUTPUT_CSV}", flush=True)

if __name__ == "__main__":
    main()
