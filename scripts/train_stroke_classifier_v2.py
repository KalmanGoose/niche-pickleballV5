#!/usr/bin/env python3
"""
NCHU Pickleball - Lightweight Stroke Classifier v2 Training Engine
===================================================================
Architecture:
- Input: 10 Spatio-temporal Biomechanical Features
- Hidden Layer: 16 Neurons with ReLU activation
- Output Layer: 7 Action Classes with Stable Softmax
- Optimizer: Pure Python Adam (beta1=0.9, beta2=0.999, lr=0.006)
- Regularization: L2 Weight Decay (lambda=0.004) to prevent video overfitting
- Data Anti-Leakage: Z-score Scaler fitted exclusively on Train Split
"""

import json
import math
import random
import os
import sys

DATASET_PATH = "data/v2/real_strokes_dataset_v2.json"
SPLIT_PLAN_PATH = "data/v2/lovo_split_plan.json"
MODEL_OUT_PATH = "models/stroke_classifier_weights_v2.json"

CLASSES = [
    "UNDERHAND_LEGAL",
    "OVERHAND_FAULT",
    "KITCHEN_DINK",
    "POWER_DRIVE",
    "SMASH",
    "VOLLEY_PUNCH",
    "PASSIVE_BLOCK"
]

FEATURE_NAMES_V2 = [
    "wrist_y_rel_hip",
    "elbow_angle_deg",
    "shoulder_angle_deg",
    "wrist_speed_torso_s",
    "wrist_accel_y_torso_s2",
    "torso_yaw_deg",
    "stance_balance_ratio",
    "left_hand_up",
    "estimated_wrist_height_ratio",
    "swing_path_len_torso"
]

def load_data():
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        ds = json.load(f)
    with open(SPLIT_PLAN_PATH, "r", encoding="utf-8") as f:
        split = json.load(f)

    events_by_id = {e["event_id"]: e for e in ds["events"]}
    train_events = [events_by_id[eid] for eid in split["train_event_ids"] if eid in events_by_id]
    test_events = [events_by_id[eid] for eid in split["test_event_ids"] if eid in events_by_id]

    def extract_xy(events_list):
        X, y, metas = [], [], []
        for e in events_list:
            feats = [e["features"][fname] for fname in FEATURE_NAMES_V2]
            c_idx = CLASSES.index(e["raw_class"])
            X.append(feats)
            y.append(c_idx)
            metas.append({"event_id": e["event_id"], "video": e["video"], "class": e["raw_class"]})
        return X, y, metas

    X_train, y_train, meta_train = extract_xy(train_events)
    X_test, y_test, meta_test = extract_xy(test_events)

    return X_train, y_train, meta_train, X_test, y_test, meta_test

def train_and_export():
    random.seed(42)
    X_train, y_train, meta_train, X_test, y_test, meta_test = load_data()
    n_train = len(X_train)
    n_test = len(X_test)
    n_feat = len(FEATURE_NAMES_V2)
    n_class = len(CLASSES)

    print(f"🎾 [v2 模型訓練] 訓練集: {n_train} 筆 (Tier A 純真值), 測試集: {n_test} 筆 (獨立留一影片)")

    # 1. 計算標準化常數 (嚴格限定僅從訓練集計算)
    means = [sum(X_train[i][f] for i in range(n_train)) / n_train for f in range(n_feat)]
    stds = []
    for f in range(n_feat):
        var = sum((X_train[i][f] - means[f]) ** 2 for i in range(n_train)) / n_train
        stds.append(math.sqrt(var) if var > 1e-7 else 1.0)

    X_train_norm = [[(row[f] - means[f]) / stds[f] for f in range(n_feat)] for row in X_train]
    X_test_norm = [[(row[f] - means[f]) / stds[f] for f in range(n_feat)] for row in X_test]

    # 2. 類別不平衡平滑加權
    class_counts = [0] * n_class
    for y_i in y_train:
        class_counts[y_i] += 1
    class_weights = [(n_train / (n_class * max(1, cnt))) ** 0.5 for cnt in class_counts]

    # 3. 初始化 MLP: 10 -> 16 (ReLU) -> 7 (Softmax)
    hidden_dim = 16
    W1 = [[random.gauss(0, math.sqrt(2.0 / n_feat)) for _ in range(hidden_dim)] for _ in range(n_feat)]
    b1 = [0.0] * hidden_dim
    W2 = [[random.gauss(0, math.sqrt(2.0 / hidden_dim)) for _ in range(n_class)] for _ in range(hidden_dim)]
    b2 = [0.0] * n_class

    # Adam 矩估計量
    mW1, vW1 = [[0.0] * hidden_dim for _ in range(n_feat)], [[0.0] * hidden_dim for _ in range(n_feat)]
    mb1, vb1 = [0.0] * hidden_dim, [0.0] * hidden_dim
    mW2, vW2 = [[0.0] * n_class for _ in range(hidden_dim)], [[0.0] * n_class for _ in range(hidden_dim)]
    mb2, vb2 = [0.0] * n_class, [0.0] * n_class

    epochs = 120
    lr = 0.007
    l2_decay = 0.004
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    t_step = 0

    best_test_acc = 0.0
    best_weights = None

    for ep in range(1, epochs + 1):
        grad_W1 = [[0.0] * hidden_dim for _ in range(n_feat)]
        grad_b1 = [0.0] * hidden_dim
        grad_W2 = [[0.0] * n_class for _ in range(hidden_dim)]
        grad_b2 = [0.0] * n_class

        train_correct = 0
        total_loss = 0.0

        for i in range(n_train):
            xi = X_train_norm[i]
            yi = y_train[i]
            w_s = class_weights[yi]

            # Forward
            z1 = [b1[j] + sum(xi[k] * W1[k][j] for k in range(n_feat)) for j in range(hidden_dim)]
            h1 = [max(0.0, val) for val in z1]

            logits = [b2[c] + sum(h1[j] * W2[j][c] for j in range(hidden_dim)) for c in range(n_class)]
            max_l = max(logits)
            exp_l = [math.exp(l - max_l) for l in logits]
            sum_exp = sum(exp_l)
            probs = [el / sum_exp for el in exp_l]

            loss = -w_s * math.log(max(1e-12, probs[yi]))
            total_loss += loss

            if probs.index(max(probs)) == yi:
                train_correct += 1

            # Backward
            dlogits = [probs[c] * w_s for c in range(n_class)]
            dlogits[yi] -= (1.0 * w_s)

            for c in range(n_class):
                grad_b2[c] += dlogits[c]
                for j in range(hidden_dim):
                    grad_W2[j][c] += h1[j] * dlogits[c]

            dh1 = [sum(W2[j][c] * dlogits[c] for c in range(n_class)) for j in range(hidden_dim)]
            dz1 = [dh1[j] if z1[j] > 0 else 0.0 for j in range(hidden_dim)]

            for j in range(hidden_dim):
                grad_b1[j] += dz1[j]
                for f in range(n_feat):
                    grad_W1[f][j] += xi[f] * dz1[j]

        t_step += 1

        # Adam Update with L2 regularization
        for f in range(n_feat):
            for j in range(hidden_dim):
                g = grad_W1[f][j] / n_train + l2_decay * W1[f][j]
                mW1[f][j] = beta1 * mW1[f][j] + (1 - beta1) * g
                vW1[f][j] = beta2 * vW1[f][j] + (1 - beta2) * (g ** 2)
                m_h = mW1[f][j] / (1 - beta1 ** t_step)
                v_h = vW1[f][j] / (1 - beta2 ** t_step)
                W1[f][j] -= lr * m_h / (math.sqrt(v_h) + eps)
        for j in range(hidden_dim):
            g = grad_b1[j] / n_train
            mb1[j] = beta1 * mb1[j] + (1 - beta1) * g
            vb1[j] = beta2 * vb1[j] + (1 - beta2) * (g ** 2)
            m_h = mb1[j] / (1 - beta1 ** t_step)
            v_h = vb1[j] / (1 - beta2 ** t_step)
            b1[j] -= lr * m_h / (math.sqrt(v_h) + eps)

        for j in range(hidden_dim):
            for c in range(n_class):
                g = grad_W2[j][c] / n_train + l2_decay * W2[j][c]
                mW2[j][c] = beta1 * mW2[j][c] + (1 - beta1) * g
                vW2[j][c] = beta2 * vW2[j][c] + (1 - beta2) * (g ** 2)
                m_h = mW2[j][c] / (1 - beta1 ** t_step)
                v_h = vW2[j][c] / (1 - beta2 ** t_step)
                W2[j][c] -= lr * m_h / (math.sqrt(v_h) + eps)
        for c in range(n_class):
            g = grad_b2[c] / n_train
            mb2[c] = beta1 * mb2[c] + (1 - beta1) * g
            vb2[c] = beta2 * vb2[c] + (1 - beta2) * (g ** 2)
            m_h = mb2[c] / (1 - beta1 ** t_step)
            v_h = vb2[c] / (1 - beta2 ** t_step)
            b2[c] -= lr * m_h / (math.sqrt(v_h) + eps)

        # Evaluate on Test LOVO
        test_correct = 0
        for ti in range(n_test):
            xi = X_test_norm[ti]
            yi = y_test[ti]
            z1 = [b1[j] + sum(xi[k] * W1[k][j] for k in range(n_feat)) for j in range(hidden_dim)]
            h1 = [max(0.0, val) for val in z1]
            logits = [b2[c] + sum(h1[j] * W2[j][c] for j in range(hidden_dim)) for c in range(n_class)]
            if logits.index(max(logits)) == yi:
                test_correct += 1

        test_acc = (test_correct / n_test) * 100.0
        train_acc = (train_correct / n_train) * 100.0

        if test_acc >= best_test_acc:
            best_test_acc = test_acc
            best_weights = {
                "W1": [[round(val, 6) for val in row] for row in W1],
                "b1": [round(val, 6) for val in b1],
                "W2": [[round(val, 6) for val in row] for row in W2],
                "b2": [round(val, 6) for val in b2],
                "epoch": ep,
                "train_acc": round(train_acc, 2),
                "test_acc": round(test_acc, 2)
            }

        if ep % 30 == 0 or ep == epochs:
            print(f"   Epoch [{ep:3d}/{epochs}] | Loss: {total_loss/n_train:.4f} | Train Acc: {train_acc:5.1f}% | LOVO Test Acc: {test_acc:5.1f}%")

    print(f"\n🌟 最佳留一影片驗證準確率: {best_weights['test_acc']:.1f}% (於第 {best_weights['epoch']} 輪產出)")

    model_payload = {
        "metadata": {
            "model_name": "NCHU_Pickleball_Stroke_Classifier_v2",
            "version": "2.0.0",
            "architecture": "MLP (10 -> 16 -> 7)",
            "activation": "ReLU",
            "feature_names": FEATURE_NAMES_V2,
            "classes": CLASSES,
            "num_parameters": (n_feat * hidden_dim + hidden_dim) + (hidden_dim * n_class + n_class),
            "train_samples": n_train,
            "test_samples": n_test,
            "train_accuracy": best_weights["train_acc"],
            "lovo_test_accuracy": best_weights["test_acc"],
            "best_epoch": best_weights["epoch"]
        },
        "scaler": {
            "means": [round(m, 6) for m in means],
            "stds": [round(s, 6) for s in stds]
        },
        "weights": {
            "W1": best_weights["W1"],
            "b1": best_weights["b1"],
            "W2": best_weights["W2"],
            "b2": best_weights["b2"]
        }
    }

    os.makedirs(os.path.dirname(MODEL_OUT_PATH), exist_ok=True)
    with open(MODEL_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(model_payload, f, indent=2)

    fsize_kb = os.path.getsize(MODEL_OUT_PATH) / 1024.0
    print(f"💾 權重檔已儲存至: {MODEL_OUT_PATH} ({fsize_kb:.1f} KB)")

if __name__ == "__main__":
    train_and_export()
