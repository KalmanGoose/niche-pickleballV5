#!/usr/bin/env python3
"""
Candidate Event Detector Ground-Truth & Precision/Recall Evaluator (v2)
=======================================================================
Evaluates the Class-Agnostic Candidate Event Detector in two modes:
1. Manifest Audit Mode: Computes verified Precision (TP / (TP + FP)) and
   human audit coverage from `data/v2/candidate_events_manifest.csv`.
   Explicitly separates `PENDING_HUMAN_AUDIT` from human-verified entries
   so heuristic auto-tiering is never conflated with ground truth.
2. Interval Ground-Truth Mode: When `data/v2/ground_truth_events.json` is
   present (or passed into `evaluate_event_detection`), matches detected
   candidate events against ground-truth stroke timestamps (tolerance <= 0.30s)
   to compute true Detection Precision, Recall, and F1.
"""

import os
import csv
import json
from collections import defaultdict

MANIFEST_PATH = "data/v2/candidate_events_manifest.csv"
GT_EVENTS_PATH = "data/v2/ground_truth_events.json"

HUMAN_VERIFIED_STATUSES = {"HUMAN_CONFIRMED", "HUMAN_REJECTED", "VERIFIED_TRUE", "VERIFIED_FALSE"}


def evaluate_event_detection(detected_events, ground_truth_events, tolerance_s=0.30):
    """
    Match detected candidate events against ground-truth stroke events per video.
    Each ground-truth event is matched at most once (greedy nearest-peak matching
    within `tolerance_s`).
    Returns dict with TP, FP, FN, precision, recall, f1.
    """
    det_by_video = defaultdict(list)
    gt_by_video = defaultdict(list)

    for d in detected_events:
        det_by_video[d["video"]].append(float(d["timestamp_peak_s"]))
    for g in ground_truth_events:
        gt_by_video[g["video"]].append(float(g["timestamp_peak_s"]))

    tp = 0
    fp = 0
    fn = 0

    all_videos = sorted(set(det_by_video.keys()) | set(gt_by_video.keys()))
    for vid in all_videos:
        dets = sorted(det_by_video.get(vid, []))
        gts = sorted(gt_by_video.get(vid, []))
        matched_gt = set()

        for dt_peak in dets:
            best_idx = None
            best_diff = tolerance_s + 1.0
            for idx, gt_peak in enumerate(gts):
                if idx in matched_gt:
                    continue
                diff = abs(dt_peak - gt_peak)
                if diff <= tolerance_s and diff < best_diff:
                    best_diff = diff
                    best_idx = idx
            if best_idx is not None:
                matched_gt.add(best_idx)
                tp += 1
            else:
                fp += 1

        fn += len(gts) - len(matched_gt)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "tolerance_s": tolerance_s
    }


def summarize_manifest_audit(manifest_rows):
    """
    Summarize human verification progress and verified candidate precision
    from manifest rows without treating PENDING_HUMAN_AUDIT as ground truth.
    """
    total = len(manifest_rows)
    tier_counts = defaultdict(int)
    status_counts = defaultdict(int)

    verified_tp = 0
    verified_fp = 0
    pending_count = 0

    for row in manifest_rows:
        tier = row.get("heuristic_tier") or row.get("audit_tier") or "UNCLASSIFIED"
        status = row.get("manual_verified", "PENDING_HUMAN_AUDIT")
        is_true = str(row.get("is_true_stroke", "PENDING")).upper()

        tier_counts[tier] += 1
        status_counts[status] += 1

        if status != "PENDING_HUMAN_AUDIT" and is_true in ("TRUE", "FALSE"):
            if is_true == "TRUE":
                verified_tp += 1
            else:
                verified_fp += 1
        else:
            pending_count += 1

    verified_total = verified_tp + verified_fp
    verified_precision = (verified_tp / verified_total) if verified_total > 0 else None

    return {
        "total_candidates": total,
        "pending_human_audit": pending_count,
        "human_verified_total": verified_total,
        "human_verified_tp": verified_tp,
        "human_verified_fp": verified_fp,
        "verified_candidate_precision": verified_precision,
        "heuristic_tier_counts": dict(tier_counts),
        "status_counts": dict(status_counts)
    }


def main():
    if not os.path.exists(MANIFEST_PATH):
        print(f"❌ 找不到 Manifest 檔案: {MANIFEST_PATH}")
        return

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    summary = summarize_manifest_audit(rows)

    print("=" * 76)
    print("📋 候選事件偵測器驗收與真值評估報告 (Detector Audit & PR Evaluation v2)")
    print("=" * 76)
    print(f"  總候選事件數 (Total Candidates)      : {summary['total_candidates']}")
    print(f"  待人工驗收數 (PENDING_HUMAN_AUDIT)   : {summary['pending_human_audit']}")
    print(f"  已完成人工真值標註 (Human Verified)  : {summary['human_verified_total']}")
    print("-" * 76)
    print("  [啟發式預篩選分佈 (僅供人工審閱排序，非人工真值)]:")
    for tier, cnt in sorted(summary["heuristic_tier_counts"].items()):
        pct = (cnt / summary["total_candidates"] * 100.0) if summary["total_candidates"] else 0.0
        print(f"    - {tier:<22}: {cnt:4d} 筆 ({pct:5.1f}%)")

    if summary["human_verified_total"] > 0:
        print("-" * 76)
        print(f"  ✅ 已驗證真揮拍 (Verified TP)        : {summary['human_verified_tp']}")
        print(f"  ❌ 已驗證假陽性 (Verified FP)        : {summary['human_verified_fp']}")
        print(f"  🎯 候選偵測精確率 (Verified Precision): {summary['verified_candidate_precision']*100:.2f}%")
    else:
        print("-" * 76)
        print("  ⚠️ 狀態: 尚未載入人工確認真值 (0 筆已人工簽核)。")
        print("     所有候選事件均標記為 PENDING_HUMAN_AUDIT，禁止於人工驗收前宣稱最終真值指標。")

    if os.path.exists(GT_EVENTS_PATH):
        with open(GT_EVENTS_PATH, "r", encoding="utf-8") as gf:
            gt_events = json.load(gf)
        pr_metrics = evaluate_event_detection(rows, gt_events, tolerance_s=0.30)
        print("-" * 76)
        print(f"  📐 獨立事件真值比對 (Ground-Truth Interval Matching, tol={pr_metrics['tolerance_s']:.2f}s):")
        print(f"    - TP={pr_metrics['tp']}, FP={pr_metrics['fp']}, FN={pr_metrics['fn']}")
        print(f"    - Precision : {pr_metrics['precision']*100:.2f}%")
        print(f"    - Recall    : {pr_metrics['recall']*100:.2f}%")
        print(f"    - F1 Score  : {pr_metrics['f1']*100:.2f}%")
    print("=" * 76)


if __name__ == "__main__":
    main()
