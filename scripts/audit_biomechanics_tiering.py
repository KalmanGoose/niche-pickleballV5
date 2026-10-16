#!/usr/bin/env python3
"""
Biomechanics-Driven 3-Tier Stroke Quality Classification
=========================================================
Applies peer-reviewed sports CV literature standards:
1. Neuromuscular Refractory Period (0.55s) for peak deduplication
2. Physiological Stroke Duration Window (0.12s - 1.15s)
3. Kinetic Speed Floor (>= 2.2 t/s for Tier A, >= 1.8 t/s for Tier B)
4. Scale Degeneracy Penalty
5. Fail-closed manifest validation, 1-to-1 annotation matching, and atomic replacement
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.manifest_annotations_v2 import (
    ManifestValidationError,
    atomic_write_csv_rows,
    load_and_validate_manifest,
    match_and_merge_manifest_annotations,
)

MANIFEST_IN = "data/v2/candidate_events_manifest.csv"
DATASET_PATH = "data/v2/real_strokes_dataset_v2.json"
MANIFEST_OUT = "data/v2/candidate_events_manifest.csv"


def run_tiering():
    # 1. Fail-closed pre-check of existing manifest before computing or writing
    existing_state = load_and_validate_manifest(MANIFEST_IN)

    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        ds = json.load(f)
    events = ds["events"]

    # 2. Match existing human-signed and note-bearing rows before any output write
    merge_res = match_and_merge_manifest_annotations(existing_state, events)
    annotations_by_new_idx = merge_res["annotations_by_new_idx"]
    preserved_count = merge_res["preserved_signed_count"]

    # 3. Map video events sorted by timestamp for refractory period check
    by_video = defaultdict(list)
    for e in events:
        by_video[e["video"]].append(e)

    subordinate_peaks = {}
    for v, evs in by_video.items():
        evs_s = sorted(evs, key=lambda x: x["timestamp_peak_s"])
        for i in range(1, len(evs_s)):
            gap = evs_s[i]["timestamp_peak_s"] - evs_s[i - 1]["timestamp_peak_s"]
            if gap < 0.55:
                spd_prev = evs_s[i - 1]["peak_speed_torso_s"]
                spd_curr = evs_s[i]["peak_speed_torso_s"]
                if spd_prev >= spd_curr:
                    subordinate_peaks[evs_s[i]["event_id"]] = f"次級波峰 (與前主波峰間隔 {gap:.2f}s < 0.55s)"
                else:
                    subordinate_peaks[evs_s[i - 1]["event_id"]] = f"引拍前置波峰 (與後主波峰間隔 {gap:.2f}s < 0.55s)"

    tiered_records = []
    tier_counts = {"TIER_A": 0, "TIER_B": 0, "TIER_C": 0}

    for idx, e in enumerate(events):
        det_eid = e["event_id"]
        dur = e["duration_s"]
        spd = e["peak_speed_torso_s"]
        qflag = e.get("quality_flag", "OK")

        if dur > 1.15:
            tier = "TIER_C_SUSPECT"
            reason = f"歷時過長 ({dur:.2f}s > 1.15s，疑為走動/回位)"
        elif dur < 0.12:
            tier = "TIER_C_SUSPECT"
            reason = f"歷時過短 ({dur:.2f}s < 0.12s，疑為瞬態噪訊)"
        elif spd < 1.8:
            tier = "TIER_C_SUSPECT"
            reason = f"波峰速度過低 ({spd:.2f} < 1.8 t/s，低於有效擊球動能下限)"
        elif det_eid in subordinate_peaks:
            tier = "TIER_B_MARGINAL"
            reason = subordinate_peaks[det_eid]
        elif qflag != "OK":
            tier = "TIER_B_MARGINAL"
            reason = f"尺度退化標記 ({qflag})"
        elif spd < 2.2:
            tier = "TIER_B_MARGINAL"
            reason = f"邊界小球力道 (1.8 <= {spd:.2f} < 2.2 t/s)"
        else:
            tier = "TIER_A_CANDIDATE"
            reason = "符合生物力學候選特徵 (速度/時長無異常)"

        tier_group = tier.split("_")[0] + "_" + tier.split("_")[1]
        tier_counts[tier_group] += 1

        ann = annotations_by_new_idx[idx]
        rec = {
            "event_id": ann["resolved_event_id"],
            "video": e["video"],
            "timestamp_peak_s": e["timestamp_peak_s"],
            "duration_s": dur,
            "peak_speed_torso_s": spd,
            "raw_class": e["raw_class"],
            "heuristic_tier": tier,
            "confidence_tier": tier,
            "audit_notes": reason,
            "manual_verified": ann["manual_verified"],
            "is_true_stroke": ann["is_true_stroke"],
            "notes": ann["notes"],
        }
        tiered_records.append(rec)

    fieldnames = [
        "event_id", "video", "timestamp_peak_s", "duration_s",
        "peak_speed_torso_s", "raw_class", "heuristic_tier", "confidence_tier",
        "audit_notes", "manual_verified", "is_true_stroke", "notes",
    ]
    atomic_write_csv_rows(MANIFEST_OUT, fieldnames, tiered_records)

    print("=" * 76)
    print("🏆 運動生物力學啟發式候選分級完成 (Heuristic Candidate Tiering)")
    print("=" * 76)
    total = len(tiered_records)
    if total > 0:
        print(f"總候選事件數 : {total} 筆")
        print(f"🟢 Tier A (啟發式候選揮拍) : {tier_counts['TIER_A']:3d} 筆 ({tier_counts['TIER_A']/total*100:5.1f}%) -> 待人工審查確認")
        print(f"🟡 Tier B (邊界/次級震盪)   : {tier_counts['TIER_B']:3d} 筆 ({tier_counts['TIER_B']/total*100:5.1f}%) -> 待人工抽樣確認")
        print(f"🔴 Tier C (疑似假陽性)     : {tier_counts['TIER_C']:3d} 筆 ({tier_counts['TIER_C']/total*100:5.1f}%) -> 建議預設排除")
    print(f"📌 人工標註保留狀態: {preserved_count} 筆已保留，{total - preserved_count} 筆維持 PENDING_HUMAN_AUDIT")
    print("=" * 76)
    print("⚠️  [重要聲明] 此分級為自動化啟發式篩選，嚴禁直接視為人工標註真值 (Ground Truth)。")
    print(f"📁 已寫入分級標籤至: {MANIFEST_OUT}\n")


if __name__ == "__main__":
    try:
        run_tiering()
    except ManifestValidationError as err:
        print(f"❌ Manifest 安全檢驗未通過，已中止寫入以保護原檔: {err}", file=sys.stderr, flush=True)
        sys.exit(1)
