# NCHU Pickleball AI 體感動作自訓模型指南 (Model Training Guide)

本專案已包含一鍵式端側輕量化神經網路訓練腳本：`scripts/train_stroke_classifier.py`。
此腳本為純 Python 實現（零依賴，無需預先安裝 PyTorch 或 TensorFlow），可在任何電腦上 2~3 秒內完成訓練並生成約 8KB 的輕量化 JSON 權重檔案。

---

## 快速開始（起床一鍵訓練）

在終端機中執行：

```bash
python3 scripts/train_stroke_classifier.py
```

### 輸出結果
腳本會於 `models/` 目錄生成：
- `models/stroke_classifier_weights.json`（約 8.5 KB）

### 包含的 6 大匹克球揮拍姿勢類別
1. `UNDERHAND_LEGAL`：合法下手臂發球（拍面手腕低於腰部，向上推拍過網）
2. `OVERHAND_FAULT`：違規高位發球（手腕過高、過肩凌空暴扣等發球犯規）
3. `KITCHEN_DINK`：廚房區柔和丁克（低速、輕推、小位移）
4. `POWER_DRIVE`：底線平抽深球（中高速、大位移、軀幹旋轉帶動）
5. `SMASH`：機會球凌空扣殺（極速、向下加速度、高擊球點）
6. `PASSIVE_BLOCK`：被動減力擋球（借力卸力、手腕位移接近 0）

---

## 前端 JavaScript 輕量化推理原理

導出的權重檔案直接由瀏覽器透過極簡前向傳播（2 次矩陣向量乘法 + ReLU 激活 + Softmax）在 **0.2 毫秒** 內完成推論：

```javascript
// 純 JS 0.2ms 超低延遲推理
function predictStroke(features) {
    const norm = features.map((v, i) => (v - scaler.means[i]) / scaler.stds[i]);
    // 隱藏層 (10 -> 16, ReLU)
    const h = b1.map((b, j) => Math.max(0, b + norm.reduce((sum, x, i) => sum + x * W1[i][j], 0)));
    // 輸出層 (16 -> 6, Softmax)
    const logits = b2.map((b, c) => b + h.reduce((sum, hj, j) => sum + hj * W2[j][c], 0));
    return softmax(logits);
}
```

這項設計徹底免除了載入 30MB TensorFlow.js 執行階段的龐大負擔，在任何手機瀏覽器上都能保持 60 FPS 順暢運行！
