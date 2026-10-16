#!/usr/bin/env python3
"""
Candidate Event Detector Ground-Truth & Precision/Recall Evaluator (v2)
=======================================================================
Evaluates the Class-Agnostic Candidate Event Detector in two modes:
1. Manifest Audit Mode: Computes verified Precision (TP / (TP + FP)) and
   human audit coverage from `data/v2/candidate_events_manifest.csv`.
   Strictly accepts only consistent human-signed status pairs:
     - HUMAN_CONFIRMED / TRUE, VERIFIED_TRUE / TRUE -> TP
     - HUMAN_REJECTED / FALSE, VERIFIED_FALSE / FALSE -> FP
   Separates pending rows from invalid/contradictory rows and never includes
   either in TP, FP, or the verified precision denominator.
2. Interval Ground-Truth Mode: Matches detected candidate events against
   ground-truth stroke timestamps per video using sequence dynamic programming
   (DP) that lexicographically maximizes matched pairs (TP) first and minimizes
   total absolute time error second within `tolerance_s`.
"""

import csv
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.manifest_annotations_v2 import (
    ManifestValidationError,
    check_no_pending_recovery,
    classify_annotation_status,
)

MANIFEST_PATH = "data/v2/candidate_events_manifest.csv"
GT_EVENTS_PATH = "data/v2/ground_truth_events.json"

HUMAN_VERIFIED_STATUSES = {"HUMAN_CONFIRMED", "HUMAN_REJECTED", "VERIFIED_TRUE", "VERIFIED_FALSE"}


def _solve_video_optimal_matching(dets, gts, tolerance_s):
    """
    Sequence DP for 1D non-crossing bipartite matching on sorted timestamps.
    Maximizes matched count (TP), then minimizes total absolute time difference,
    with deterministic index tie-breaking.
    Complexity: O(D * G) time and space per video.
    """
    d_len = len(dets)
    g_len = len(gts)
    if d_len == 0 or g_len == 0:
        return 0, 0.0, []

    # dp[i][j] stores (matched_count, -total_err_ns, neg_pairs_tuple)
    # where neg_pairs_tuple stores (-i, -j) so Python tuple max() prefers smaller (i, j) indices.
    dp = [[(0, 0, ()) for _ in range(g_len + 1)] for _ in range(d_len + 1)]

    for i in range(d_len - 1, -1, -1):
        dt_val = dets[i][0]
        for j in range(g_len - 1, -1, -1):
            # Option 1: skip detection i
            best = dp[i + 1][j]

            # Option 2: skip ground truth j
            cand_skip_gt = dp[i][j + 1]
            if cand_skip_gt > best:
                best = cand_skip_gt

            # Option 3: match detection i with ground truth j if within tolerance_s
            gt_val = gts[j][0]
            diff = abs(dt_val - gt_val)
            if diff <= tolerance_s + 1e-12:
                err_ns = int(round(diff * 1_000_000_000))
                sub_cnt, sub_neg_err, sub_pairs = dp[i + 1][j + 1]
                cand_match = (sub_cnt + 1, sub_neg_err - err_ns, ((-i, -j),) + sub_pairs)
                if cand_match > best:
                    best = cand_match

            dp[i][j] = best

    best_cnt, _, neg_pairs = dp[0][0]
    matched_pairs = [(-ni, -nj) for ni, nj in neg_pairs]
    total_abs_err = sum(abs(dets[i][0] - gts[j][0]) for i, j in matched_pairs)
    return best_cnt, total_abs_err, matched_pairs


def evaluate_event_detection(detected_events, ground_truth_events, tolerance_s=0.30):
    """
    Match detected candidate events against ground-truth stroke events per video.
    Uses sequence DP per video to maximize matched pairs (TP) first and minimize
    total absolute time difference second within `tolerance_s`.
    Returns dict with TP, FP, FN, precision, recall, f1, tolerance_s, and total_abs_time_error_s.
    """
    det_by_video = defaultdict(list)
    gt_by_video = defaultdict(list)

    for idx, d in enumerate(detected_events):
        det_by_video[d["video"]].append((
            float(d["timestamp_peak_s"]),
            str(d.get("event_id", "")),
            idx,
        ))
    for idx, g in enumerate(ground_truth_events):
        gt_by_video[g["video"]].append((
            float(g["timestamp_peak_s"]),
            str(g.get("event_id", "")),
            idx,
        ))

    tp = 0
    fp = 0
    fn = 0
    total_abs_time_error_s = 0.0

    all_videos = sorted(set(det_by_video.keys()) | set(gt_by_video.keys()))
    for vid in all_videos:
        dets = sorted(det_by_video.get(vid, []), key=lambda x: (x[0], x[1], x[2]))
        gts = sorted(gt_by_video.get(vid, []), key=lambda x: (x[0], x[1], x[2]))

        vid_tp, vid_err, _ = _solve_video_optimal_matching(dets, gts, tolerance_s)
        tp += vid_tp
        fp += len(dets) - vid_tp
        fn += len(gts) - vid_tp
        total_abs_time_error_s += vid_err

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
        "tolerance_s": tolerance_s,
        "total_abs_time_error_s": total_abs_time_error_s,
    }


def summarize_manifest_audit(manifest_rows):
    """
    Summarize human verification progress and verified candidate precision
    from manifest rows using strict human-signed status table:
      - HUMAN_CONFIRMED / TRUE, VERIFIED_TRUE / TRUE -> TP
      - HUMAN_REJECTED / FALSE, VERIFIED_FALSE / FALSE -> FP
    Separates pending rows and invalid/contradictory rows; neither enters
    TP, FP, or the verified precision denominator.
    """
    total = len(manifest_rows)
    tier_counts = defaultdict(int)
    status_counts = defaultdict(int)

    verified_tp = 0
    verified_fp = 0
    pending_count = 0
    invalid_or_contradictory_count = 0
    invalid_rows = []

    for row_idx, row in enumerate(manifest_rows, start=2):
        tier = (row.get("heuristic_tier") or row.get("audit_tier") or "UNCLASSIFIED").strip() or "UNCLASSIFIED"
        raw_status = row.get("manual_verified", "")
        raw_is_true = row.get("is_true_stroke", "")

        status_kind, norm_ver, norm_true = classify_annotation_status(raw_status, raw_is_true)
        tier_counts[tier] += 1
        status_counts[norm_ver or "EMPTY"] += 1

        if status_kind == "SIGNED_TP":
            verified_tp += 1
        elif status_kind == "SIGNED_FP":
            verified_fp += 1
        elif status_kind == "PENDING":
            pending_count += 1
        else:
            invalid_or_contradictory_count += 1
            invalid_rows.append({
                "row_num": row_idx,
                "video": (row.get("video") or "").strip(),
                "event_id": (row.get("event_id") or "").strip(),
                "manual_verified": str(raw_status).strip(),
                "is_true_stroke": str(raw_is_true).strip(),
            })

    verified_total = verified_tp + verified_fp
    verified_precision = (verified_tp / verified_total) if verified_total > 0 else None

    return {
        "total_candidates": total,
        "pending_human_audit": pending_count,
        "invalid_or_contradictory_count": invalid_or_contradictory_count,
        "invalid_rows": invalid_rows,
        "human_verified_total": verified_total,
        "human_verified_tp": verified_tp,
        "human_verified_fp": verified_fp,
        "verified_candidate_precision": verified_precision,
        "heuristic_tier_counts": dict(tier_counts),
        "status_counts": dict(status_counts),
    }


def main():
    target_dir = os.path.dirname(os.path.abspath(MANIFEST_PATH)) or "."
    try:
        check_no_pending_recovery(target_dir)
    except ManifestValidationError as err:
        print(f"❌ {err}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(MANIFEST_PATH):
        print(f"❌ 找不到 Manifest 檔案: {MANIFEST_PATH}")
        sys.exit(1)

    with open(MANIFEST_PATH, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    summary = summarize_manifest_audit(rows)

    print("=" * 76)
    print("📋 候選事件偵測器驗收與真值評估報告 (Detector Audit & PR Evaluation v2)")
    print("=" * 76)
    print(f"  總候選事件數 (Total Candidates)      : {summary['total_candidates']}")
    print(f"  待人工驗收數 (PENDING_HUMAN_AUDIT)   : {summary['pending_human_audit']}")
    print(f"  已完成人工真值標註 (Human Verified)  : {summary['human_verified_total']}")
    print(f"  異常/矛盾標註列數 (Invalid/Conflict) : {summary['invalid_or_contradictory_count']}")
    print("-" * 76)
    print("  [啟發式預篩選分佈 (僅供人工審閱排序，非人工真值)]:")
    for tier, cnt in sorted(summary["heuristic_tier_counts"].items()):
        pct = (cnt / summary["total_candidates"] * 100.0) if summary["total_candidates"] else 0.0
        print(f"    - {tier:<22}: {cnt:4d} 筆 ({pct:5.1f}%)")

    if summary["invalid_or_contradictory_count"] > 0:
        print("-" * 76)
        print("  🚨 偵測到無效或矛盾之標註狀態 (未計入 TP/FP 分母，請人工修正):")
        for bad in summary["invalid_rows"][:10]:
            print(
                f"    - 列 {bad['row_num']} ({bad['video']}, {bad['event_id']}): "
                f"manual_verified='{bad['manual_verified']}', is_true_stroke='{bad['is_true_stroke']}'"
            )

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
