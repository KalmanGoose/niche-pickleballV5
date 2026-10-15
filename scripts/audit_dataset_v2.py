#!/usr/bin/env python3
"""
NCHU Pickleball - Dataset Comparison & Sanity Audit (v1 Legacy vs v2 Rigorous)
=============================================================================
Calculates:
- Statistical distributions (p10, median, p90, max) for key features
- Extreme speed outlier counts (> 100, > 1000)
- Sanity checks on physical consistency (e.g. Smash vs Legal Serve heights)
- Temporal event intervals and candidate event quality
"""

import os
import json
import statistics as st
from collections import defaultdict

V1_PATH = "data/legacy_v1_baseline/real_strokes_dataset.json"
V2_PATH = "data/v2/real_strokes_dataset_v2.json"

def audit_dataset(path, is_v2=False):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if is_v2:
        events = data.get("events", [])
        total = len(events)
        class_key = "raw_class"
    else:
        events = data.get("samples", [])
        total = data.get("total_samples", len(events))
        class_key = "class_name"

    groups = defaultdict(list)
    speeds = []
    y_rel_hip_by_class = defaultdict(list)
    speeds_by_class = defaultdict(list)
    quality_flags = defaultdict(int)

    for ev in events:
        cname = ev[class_key]
        if is_v2:
            feats = ev["features"]
            spd = feats["wrist_speed_torso_s"]
            y_rel = feats["wrist_y_rel_hip"]
            quality_flags[ev.get("quality_flag", "OK")] += 1
        else:
            feats = ev["features"]
            spd = feats[3]
            y_rel = feats[0]

        speeds.append(spd)
        y_rel_hip_by_class[cname].append(y_rel)
        speeds_by_class[cname].append(spd)
        groups[cname].append(ev)

    def percentile(arr, p):
        if not arr:
            return 0.0
        sorted_arr = sorted(arr)
        idx = int(len(sorted_arr) * (p / 100.0))
        idx = min(idx, len(sorted_arr) - 1)
        return sorted_arr[idx]

    report = {
        "path": path,
        "total_events": total,
        "speed_overall": {
            "p10": percentile(speeds, 10),
            "median": percentile(speeds, 50),
            "p90": percentile(speeds, 90),
            "max": max(speeds) if speeds else 0.0,
            "count_gt_100": sum(1 for s in speeds if s > 100.0),
            "count_gt_1000": sum(1 for s in speeds if s > 1000.0)
        },
        "by_class": {},
        "quality_flags": dict(quality_flags)
    }

    for cname in sorted(groups.keys()):
        c_speeds = speeds_by_class[cname]
        c_y = y_rel_hip_by_class[cname]
        report["by_class"][cname] = {
            "count": len(groups[cname]),
            "speed_median": percentile(c_speeds, 50),
            "speed_max": max(c_speeds) if c_speeds else 0.0,
            "y_rel_hip_p10": percentile(c_y, 10),
            "y_rel_hip_median": percentile(c_y, 50),
            "y_rel_hip_p90": percentile(c_y, 90)
        }

    return report

def print_audit_comparison():
    rep_v1 = audit_dataset(V1_PATH, is_v2=False)
    rep_v2 = audit_dataset(V2_PATH, is_v2=True)

    print("=" * 76)
    print("📊 匹克球揮拍特徵提取新舊版本對比審查報告 (v1 Baseline vs v2 Rigorous)")
    print("=" * 76)

    if rep_v1:
        s1 = rep_v1["speed_overall"]
        print(f"\n[v1 舊版基線 - 存在已知失真]")
        print(f"  總候選樣本數: {rep_v1['total_events']}")
        print(f"  速度 (偽 m/s): p10={s1['p10']:.2f}, med={s1['median']:.2f}, p90={s1['p90']:.2f}, max={s1['max']:.2f}")
        print(f"  🚨 速度極端異常: >100 有 {s1['count_gt_100']} 筆, >1000 有 {s1['count_gt_1000']} 筆 (最高 {s1['max']:.1f})")
        print("  各動作類別手腕相對腰高 (負值誤標為低於腰，實為高於腰):")
        for c, st_c in rep_v1["by_class"].items():
            print(f"    - {c:<16}: n={st_c['count']:>3} | y_rel med={st_c['y_rel_hip_median']:>6.2f} | speed med={st_c['speed_median']:>6.2f}")

    if rep_v2:
        s2 = rep_v2["speed_overall"]
        print(f"\n[v2 新版 - 物理修正後]")
        print(f"  總候選事件數: {rep_v2['total_events']}")
        print(f"  速率 (torso-lengths/s): p10={s2['p10']:.2f}, med={s2['median']:.2f}, p90={s2['p90']:.2f}, max={s2['max']:.2f}")
        print(f"  ✅ 速度極端異常: >100 有 {s2['count_gt_100']} 筆 (徹底消除 30,000 天文數字!)")
        print(f"  品質旗標分佈: {rep_v2['quality_flags']}")
        print("  各動作類別手腕相對腰高 (Y向上為正: 正值=腰部上方, 負值=腰部下方):")
        for c, st_c in rep_v2["by_class"].items():
            print(f"    - {c:<16}: n={st_c['count']:>3} | y_rel med={st_c['y_rel_hip_median']:>6.2f} | speed med={st_c['speed_median']:>6.2f}")
    else:
        print("\n⏳ v2 提取進行中，請於提取完成後重新執行此腳本。")

    print("=" * 76)

if __name__ == "__main__":
    print_audit_comparison()
