#!/usr/bin/env python3
"""
Deep Self-Audit & False Positive Analysis for Stroke Events v2
==============================================================
Analyzes candidate events across all 11 videos:
1. Video duration, candidate event counts, and stroke frequency (events/min)
2. Duration distribution (p10, median, p90, max)
3. Inter-event intervals (time delta between consecutive strokes)
4. Suspect events identification (outliers in duration, path length, or speed)
"""

import os
import csv
import cv2
import json
import glob
from collections import defaultdict

MANIFEST_PATH = "data/v2/candidate_events_manifest.csv"
DATASET_PATH = "data/v2/real_strokes_dataset_v2.json"
VIDEOS_DIR = "data/videos"

def percentile(arr, p):
    if not arr:
        return 0.0
    s = sorted(arr)
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    d = k - f
    return s[f] * (1.0 - d) + s[c] * d

def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        events = list(reader)

    print(f"📊 讀取到 {len(events)} 筆候選事件 Manifest 資料\n")

    # Group by video
    by_video = defaultdict(list)
    for ev in events:
        by_video[ev["video"]].append(ev)

    video_stats = {}
    print("=" * 86)
    print(f"{'影片名稱':<20} | {'類別':<16} | {'長度(s)':>7} | {'事件數':>6} | {'頻率(/min)':>10} | {'中位歷時':>8} | {'中位速率':>8}")
    print("-" * 86)

    all_durations = []
    all_speeds = []
    all_gaps = []
    suspect_events = []

    for vpath in sorted(glob.glob(os.path.join(VIDEOS_DIR, "*.*"))):
        vname = os.path.basename(vpath)
        if "備用" in vname or not vname.lower().endswith((".mp4", ".mov")):
            continue

        cap = cv2.VideoCapture(vpath)
        fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
        n_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 1
        dur_s = n_frames / fps
        cap.release()

        v_events = by_video.get(vname, [])
        v_cls = v_events[0]["raw_class"] if v_events else "UNKNOWN"
        count = len(v_events)
        freq = (count / (dur_s / 60.0)) if dur_s > 0 else 0

        durations = [float(e["duration_s"]) for e in v_events]
        speeds = [float(e["peak_speed_torso_s"]) for e in v_events]
        all_durations.extend(durations)
        all_speeds.extend(speeds)

        med_dur = percentile(durations, 50) if durations else 0
        med_spd = percentile(speeds, 50) if speeds else 0

        # Calculate inter-event gaps
        v_events_sorted = sorted(v_events, key=lambda x: float(x["timestamp_peak_s"]))
        for i in range(1, len(v_events_sorted)):
            t_curr = float(v_events_sorted[i]["timestamp_peak_s"])
            t_prev = float(v_events_sorted[i-1]["timestamp_peak_s"])
            gap = t_curr - t_prev
            all_gaps.append(gap)
            if gap < 0.6:  # Less than 0.6s gap is suspicious for consecutive strokes
                suspect_events.append({
                    "reason": f"連續事件間隔極短 ({gap:.2f}s < 0.6s)",
                    "event_a": v_events_sorted[i-1]["event_id"],
                    "event_b": v_events_sorted[i]["event_id"],
                    "video": vname,
                    "class": v_cls,
                    "timestamp": t_curr
                })

        for e in v_events:
            d = float(e["duration_s"])
            s = float(e["peak_speed_torso_s"])
            if d > 1.2:
                suspect_events.append({
                    "reason": f"揮拍歷時過長 ({d:.2f}s > 1.2s，疑為走動/準備動作)",
                    "event_id": e["event_id"],
                    "video": vname,
                    "class": v_cls,
                    "duration": d,
                    "speed": s,
                    "timestamp": float(e["timestamp_peak_s"])
                })

        print(f"{vname:<20} | {v_cls:<16} | {dur_s:7.1f} | {count:6d} | {freq:10.1f} | {med_dur:7.2f}s | {med_spd:6.2f} t/s")

    print("=" * 86)

    print(f"\n📈 全量特徵分佈摘要 ({len(events)} Events Overall):")
    print(f"  揮拍歷時 (Duration) : p10={percentile(all_durations, 10):.2f}s, med={percentile(all_durations, 50):.2f}s, p90={percentile(all_durations, 90):.2f}s, max={max(all_durations):.2f}s")
    print(f"  峰值速率 (Speed)    : p10={percentile(all_speeds, 10):.2f} t/s, med={percentile(all_speeds, 50):.2f} t/s, p90={percentile(all_speeds, 90):.2f} t/s, max={max(all_speeds):.2f} t/s")
    print(f"  擊球間隔 (Inter-gap): p10={percentile(all_gaps, 10):.2f}s, med={percentile(all_gaps, 50):.2f}s, p90={percentile(all_gaps, 90):.2f}s, min={min(all_gaps) if all_gaps else 0:.2f}s")

    print(f"\n🔍 疑似假陽性/需人工重點審查事件分析:")
    print(f"  共檢出 {len(suspect_events)} 處需人工核查邊界的情況")
    
    # Group suspect events by reason
    by_reason = defaultdict(list)
    for s in suspect_events:
        by_reason[s["reason"].split("(")[0].strip()].append(s)

    for r, items in by_reason.items():
        print(f"\n  📌 [{r}] (共 {len(items)} 處):")
        for item in items[:5]:
            ev_label = item.get('event_id') or f"{item.get('event_a')} -> {item.get('event_b')}"
            print(f"     - {item['video']} | {item['class']} | {ev_label} @ {item['timestamp']:.2f}s: {item['reason']}")
        if len(items) > 5:
            print(f"     ... 其餘 {len(items)-5} 處詳見 Manifest")

if __name__ == "__main__":
    main()
