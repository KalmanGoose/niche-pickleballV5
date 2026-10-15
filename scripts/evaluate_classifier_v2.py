#!/usr/bin/env python3
"""
Comprehensive Classifier Evaluation & Confusion Matrix
======================================================
Evaluates models/stroke_classifier_weights_v2.json on:
1. Full Dataset (Tier A Confirmed, N=276)
2. Leave-One-Video-Out Test Partition (Unseen Videos, N=21)
3. Computes: Confusion Matrix, Precision, Recall, Macro-F1
"""

import json
import math
import os
from collections import defaultdict

MODEL_PATH = "models/stroke_classifier_weights_v2.json"
DATASET_PATH = "data/v2/real_strokes_dataset_v2.json"
SPLIT_PLAN_PATH = "data/v2/lovo_split_plan.json"
REPORT_OUT_PATH = "data/v2/evaluation_report_v2.json"

def predict_single(features, means, stds, W1, b1, W2, b2):
    # 1. Feature normalization
    norm_x = [(features[i] - means[i]) / stds[i] for i in range(len(features))]
    
    # 2. Hidden Layer (ReLU)
    hidden_dim = len(b1)
    h1 = [0.0] * hidden_dim
    for j in range(hidden_dim):
        val = b1[j] + sum(norm_x[k] * W1[k][j] for k in range(len(features)))
        h1[j] = max(0.0, val)
        
    # 3. Output Layer (Stable Softmax)
    n_class = len(b2)
    logits = [b2[c] + sum(h1[j] * W2[j][c] for j in range(hidden_dim)) for c in range(n_class)]
    max_l = max(logits)
    exp_l = [math.exp(l - max_l) for l in logits]
    sum_exp = sum(exp_l)
    probs = [el / sum_exp for el in exp_l]
    
    pred_idx = probs.index(max(probs))
    return pred_idx, probs

def evaluate():
    with open(MODEL_PATH, "r", encoding="utf-8") as f:
        model = json.load(f)
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        ds = json.load(f)
    with open(SPLIT_PLAN_PATH, "r", encoding="utf-8") as f:
        split = json.load(f)

    classes = model["metadata"]["classes"]
    feature_names = model["metadata"]["feature_names"]
    means = model["scaler"]["means"]
    stds = model["scaler"]["stds"]
    W1 = model["weights"]["W1"]
    b1 = model["weights"]["b1"]
    W2 = model["weights"]["W2"]
    b2 = model["weights"]["b2"]

    events_by_id = {e["event_id"]: e for e in ds["events"]}
    test_ids = set(split["test_event_ids"])
    train_ids = set(split["train_event_ids"])

    def evaluate_subset(event_ids, name):
        y_true, y_pred = [], []
        sub_events = [events_by_id[eid] for eid in event_ids if eid in events_by_id]
        
        for e in sub_events:
            feats = [e["features"][fname] for fname in feature_names]
            t_idx = classes.index(e["raw_class"])
            p_idx, _ = predict_single(feats, means, stds, W1, b1, W2, b2)
            y_true.append(t_idx)
            y_pred.append(p_idx)

        # Confusion Matrix
        cm = [[0] * len(classes) for _ in range(len(classes))]
        for yt, yp in zip(y_true, y_pred):
            cm[yt][yp] += 1

        # Precision, Recall, F1
        per_class = {}
        for c_idx, cname in enumerate(classes):
            tp = cm[c_idx][c_idx]
            fp = sum(cm[r][c_idx] for r in range(len(classes))) - tp
            fn = sum(cm[c_idx][c] for c in range(len(classes))) - tp
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
            total_c = sum(cm[c_idx])
            per_class[cname] = {
                "support": total_c,
                "precision": round(prec, 3),
                "recall": round(rec, 3),
                "f1_score": round(f1, 3)
            }

        macro_f1 = sum(m["f1_score"] for m in per_class.values()) / len(classes)
        acc = sum(cm[i][i] for i in range(len(classes))) / len(y_true) if y_true else 0.0

        return {
            "subset_name": name,
            "total_samples": len(y_true),
            "accuracy": round(acc, 4),
            "macro_f1": round(macro_f1, 4),
            "confusion_matrix": cm,
            "per_class": per_class
        }

    rep_train = evaluate_subset(train_ids, "Train Set (Tier A, N=255)")
    rep_test = evaluate_subset(test_ids, "LOVO Test Set (Unseen Videos, N=21)")

    print("=" * 78)
    print("📊 NCHU 匹克球 - 神經網路分類器 v2 全面評估報告 (Evaluation Report)")
    print("=" * 78)
    print(f"訓練集準確率 : {rep_train['accuracy']*100:.1f}% | Macro-F1: {rep_train['macro_f1']:.3f}")
    print(f"留一影片驗證 : {rep_test['accuracy']*100:.1f}% | Macro-F1: {rep_test['macro_f1']:.3f} (測試影片: {split['metadata']['test_videos']})")
    print("-" * 78)

    print("📋 留一影片 (LOVO Test) 跨影片分類詳細指標:")
    print(f"{'動作類別':<18} | {'樣本數':>6} | {'Precision':>10} | {'Recall':>8} | {'F1-Score':>8}")
    print("-" * 78)
    for cname, m in rep_test["per_class"].items():
        if m["support"] > 0:
            print(f"{cname:<18} | {m['support']:6d} | {m['precision']:10.3f} | {m['recall']:8.3f} | {m['f1_score']:8.3f}")
        else:
            print(f"{cname:<18} | {m['support']:6d} | {'--':>10} | {'--':>8} | {'[單影片未在測試折]':>8}")

    print("=" * 78)
    print("🎯 留一影片混淆矩陣 (Rows: True Class, Cols: Predicted Class):")
    short_names = ["U-L", "O-F", "K-D", "P-D", "SM", "V-P", "P-B"]
    header = "      " + " ".join(f"{sn:>5}" for sn in short_names)
    print(header)
    for i, row in enumerate(rep_test["confusion_matrix"]):
        if sum(row) > 0:
            row_str = " ".join(f"{v:>5}" for v in row)
            print(f"{short_names[i]:<5}: {row_str}  ({classes[i]})")
    print("=" * 78)

    full_report = {
        "metadata": model["metadata"],
        "train_evaluation": rep_train,
        "lovo_test_evaluation": rep_test
    }
    with open(REPORT_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2, ensure_ascii=False)
    print(f"📁 評估報告已儲存至: {REPORT_OUT_PATH}\n")

if __name__ == "__main__":
    evaluate()
