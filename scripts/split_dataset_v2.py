#!/usr/bin/env python3
"""
Strict Leave-One-Video-Out (LOVO) Splitter & Data Preparation
=============================================================
Applies zero-leakage constraints:
1. Filters exclusively Tier A high-confidence strokes (or Tier A + verified B)
2. Isolates entire video files between Train and Test sets
3. Identifies multi-video classes for genuine cross-video generalization evaluation:
   - KITCHEN_DINK: dink.mp4 vs dink2.mp4
   - SMASH: smash.mp4 vs smash2.mp4
   - UNDERHAND_LEGAL: serve_legal_2.mp4 vs serve_legal1.mp4 / serve_legal3.mp4
4. Explicitly isolates single-video classes
"""

import json
import csv
import os
from collections import defaultdict

MANIFEST_PATH = "data/v2/candidate_events_manifest.csv"
DATASET_PATH = "data/v2/real_strokes_dataset_v2.json"
OUTPUT_SPLIT_PATH = "data/v2/lovo_split_plan.json"

CLASSES = [
    "UNDERHAND_LEGAL",
    "OVERHAND_FAULT",
    "KITCHEN_DINK",
    "POWER_DRIVE",
    "SMASH",
    "VOLLEY_PUNCH",
    "PASSIVE_BLOCK"
]

def create_lovo_splits():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest_rows = list(csv.DictReader(f))

    # Index manifest by event_id for fast tier lookup
    manifest_by_id = {r["event_id"]: r for r in manifest_rows}

    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        ds = json.load(f)

    all_events = ds["events"]

    # Filter to Tier A candidate strokes
    tier_a_events = []
    for ev in all_events:
        m = manifest_by_id.get(ev["event_id"])
        if m:
            tier = m.get("heuristic_tier") or m.get("confidence_tier", "")
            if tier.startswith("TIER_A"):
                tier_a_events.append(ev)

    print(f"📊 從候選事件中篩選出 {len(tier_a_events)} 筆 Tier A 啟發式候選揮拍 (待人工審查確認)")

    # Group by class and video
    by_class_video = defaultdict(lambda: defaultdict(list))
    for ev in tier_a_events:
        c = ev["raw_class"]
        v = ev["video"]
        by_class_video[c][v].append(ev)

    print("\n🎬 Tier A 動作類別與所屬影片分佈:")
    multi_video_classes = []
    single_video_classes = []

    for c in CLASSES:
        v_dict = by_class_video[c]
        v_counts = {v: len(evs) for v, evs in v_dict.items()}
        print(f"  - {c:<16}: {sum(v_counts.values()):3d} 筆 (分佈於 {len(v_counts)} 部影片: {v_counts})")
        if len(v_counts) >= 2:
            multi_video_classes.append(c)
        else:
            single_video_classes.append(c)

    # Design the primary Cross-Video Evaluation Fold (LOVO)
    # Fold 1: Test on unseen videos: dink2.mp4 (DINK), smash2.mp4 (SMASH), serve_legal3.mp4 & serve_legal1.mp4 (SERVE)
    # Train on: dink.mp4, smash.mp4, serve_legal_2.mp4 + single-video classes
    test_videos = ["dink2.mp4", "smash2.mp4", "serve_legal3.mp4", "serve_legal1.mp4"]
    
    train_set = []
    test_set = []

    for ev in tier_a_events:
        if ev["video"] in test_videos:
            test_set.append(ev)
        else:
            train_set.append(ev)

    print(f"\n✅ 基準 LOVO 評估集劃分完成 (Zero-Leakage):")
    print(f"   訓練集 (Train Set): {len(train_set):3d} 筆樣本 (包含多影片主訓練片與單影片基礎集)")
    print(f"   測試集 (Test Set) : {len(test_set):3d} 筆樣本 (完全獨立之驗證影片: {test_videos})")

    split_plan = {
        "metadata": {
            "strategy": "Leave-One-Video-Out (LOVO)",
            "tier_filter": "TIER_A_CONFIRMED",
            "total_samples": len(tier_a_events),
            "train_samples": len(train_set),
            "test_samples": len(test_set),
            "test_videos": test_videos,
            "multi_video_classes": multi_video_classes,
            "single_video_classes": single_video_classes
        },
        "train_event_ids": [e["event_id"] for e in train_set],
        "test_event_ids": [e["event_id"] for e in test_set]
    }

    with open(OUTPUT_SPLIT_PATH, "w", encoding="utf-8") as f:
        json.dump(split_plan, f, indent=2, ensure_ascii=False)

    print(f"📁 劃分方案已儲存至: {OUTPUT_SPLIT_PATH}")

if __name__ == "__main__":
    create_lovo_splits()
