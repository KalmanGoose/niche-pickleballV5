# NCHU Pickleball 專案交接檔 (Project Handoff for GPT / Antigravity)

> **版本**：v5.4.0-pipeline-remediation  
> **更新日期**：2026-10-16  
> **當前分支**：`test-mobile-motion`  
> **重要規則**：
> 1. 本檔禁止寫入任何正式金鑰、Token、GAS Web App 原始網址與 Worker Secret。
> 2. **禁止直接修改 `index.html` 與 `v14-single.html`**。修改必須在 `js/`、`css/`、`v14.html` 進行，並執行打包腳本。

---

## 1. 專案核心架構與鐵律

* **專案名稱**：國立中興大學 (NCHU) 匹克球體感養成與校園社群 (`匹克球N-GO.v1`)
* **核心技術棧**：
  * 前端：Vanilla JavaScript (ES6+), Three.js (3D 球場與物理視覺), MediaPipe Pose (33 點體感姿態推論), Web Audio API, PWA (Service Worker 快取重置防卡死)。
  * 後端：Cloudflare Workers (反向代理、CORS 白名單、IP/PID 頻率限制、HMAC-SHA256 伺服器簽署) + Google Apps Script (GAS, 綁定 Google Sheets 作為 NoSQL 資料庫, LockService 排他鎖, Token SHA-256 鑑權)。
* **檔案目錄架構**：
  * 唯一源碼 (Source of Truth)：
    * 網頁骨架模板：`v14.html`
    * 模組化邏輯：`js/`（`config.js`, `audio.js`, `physics.js`, `referee.js`, `motion.js`, `hub_sandbox.js`, `profile_card.js`, `ui.js`, `social.js`, `fly_connectome.js`, `pickle_neural_policy.js`, `fun_mode.js`, `game.js`）
    * 模組化樣式：`css/`（`style.css`, `hud.css`, `nav.css`, `modals.css`）
    * 雲端後端：`backend/cloudflare-worker.js`, `backend/Code.gs`
  * 打包工具：
    * `node scripts/build-single.js`：自動執行 `vm.Script` 語法檢查，並將 `v14.html` + `css/` + `js/` 合成為 `v14-single.html` 與 `index.html`。
* **JS 載入與依賴順序**：
  `config` ➔ `audio` ➔ `physics` ➔ `referee` ➔ `motion` ➔ `hub_sandbox` ➔ `profile_card` ➔ `ui` ➔ `social` ➔ `fly_connectome` ➔ `pickle_neural_policy` ➔ `fun_mode` ➔ `game`。

---

## 2. 目前最新進度：Claude 6 輪深度審查與本機代碼實證彙整

剛剛完成 Claude Web 針對全專案進行的 **6 輪全面代碼審查（Code Review）**。我們已在本地原始碼逐行核實，整理出「**真實致命 Bug（必須修復）**」與「**審查誤報 / 幻覺（已澄清，不要重複修改）**」：

### 🔴 【A. 真實致命 Bug 清單 (已證實，列入 P0/P1 重構)】

1. **手勢曲球方向在短滑動時反轉 (`js/game.js:getSwipeCurve`)**：
   - *原因*：短手勢分支中 `spinAreaContrib = THREE.MathUtils.clamp(-spinArea / 1400, ...)` 被加上了負號，直接與代表弧線凸出量的 `sagitta` 互砍相消，導致右手向右劃弧反而打出左曲球。
   - *修法*：改用 Claude 建議的精簡兩項式：`const raw = (s.sagitta || 0) / 65 + (s.distX || 0) / 150;`，移除負號並消除 `peakVx` 的量化抖動。
2. **「完美第三桿放短」成死碼，且修復需防範第 2 關無法過關陷阱 (`js/game.js:tryHit`)**：
   - *原因*：`rallyHits++` 在 line 2025 先加 1（使 `rallyHits >= 2`），隨後在 line 2110 判定 `isThirdShot = (rallyHits === 1)` 恆為 false，導致從未觸發過！
   - *致命陷阱*：改為 `rallyHits === 3 && server === 'PLAYER'` 後，**絕對不能在分支內直接 `return;`**！因為會跳過 line 2117 的第 2 關通關判定（`stage === 2 && rallyHits >= 3 && !volley`），導致第 2 關永遠無法通關！
   - *修法*：使用 `forcedShot` 覆寫落點與球速，限定 `stage >= 4`，讓後續過關判定、狀態重置與日誌記錄正常執行。
3. **神經網路 `speedScale` 未接上，且 N9 特徵偏置導致 99% DROP (`js/game.js` & `js/pickle_neural_policy.js`)**：
   - *原因*：`planShot` 算出 `speedScale` 後未傳入 `solveArc`，LOB（挑高球）與 DRIVE（平抽）球速與弧線完全相同；N9 神經元對 `ballZ_norm` 與 `ballVz_norm` 負負得正強烈激發，幾乎只出 DROP。
   - *修法*：`planShot` 記錄 `aiShot.speed = t.speedScale`，傳入 `solveArc`；LOB 移除未使用的 `liftY` 改用降速 `speedScale = 0.45` 產生高拋；神經網路特徵維度改為相對座標。
4. **好友 API 未驗證洩漏 IG 與風格資料 (`backend/cloudflare-worker.js`, `backend/Code.gs`)**：
   - *原因*：GET `act=friends&pid=xxx` 未檢查 token，且英雄榜也回傳了 `ig`。
   - *修法*：`friends` 移入 `POST_ACTS`，必須帶 token 經 `authorize()` 鑑權；英雄榜 API 徹底拔除 `ig` 欄位；待確認的 pending 邀請不回傳 `ig`。
5. **帳號刪除前端防護不足 (`js/config.js:deleteAccount`)**：
   - *原因*：前端未檢查 `postSigned({ act: 'deleteMe' })` 的回傳 `r.ok`，即使失敗也顯示成功；且 `localStorage` 未完整清除所有 `nchu_*` 項目。
   - *修法*：檢查 `r && r.ok`，失敗時警示並終止；清除所有 `Object.keys(localStorage).filter(k => k.startsWith('nchu_'))`。
6. **巨人化道具讓拍面過高無法發球 (`js/fun_mode.js:GIANT_PLAYER`)**：
   - *原因*：`pGrp.scale.setScalar(2.0)` 放大整個模型組（包含球拍 `pPad`），導致拍面世界座標高度超過發球上限 1.15m（`SERVE_MAX_H`），發球必判犯規！
   - *修法*：只放大球員軀幹視覺模型（`[pTorso, pLegs, pHead, pLeftArm, pCap]`），不縮放包含球拍的根群組 `pGrp`。
7. **道具箱 GPU 記憶體洩漏 (`js/fun_mode.js:spawnItemBox`)**：
   - *原因*：每個箱子獨立 `new BoxGeometry` 與 `new MeshStandardMaterial`，移除時僅 `scene.remove` 未 `dispose()`。
   - *修法*：模組初始化時預先建立共用幾何與材質，各實例共用。
8. **降溫模式讀錯屬性覆蓋畫質 (`js/social.js:setEcoMode`)**：
   - *原因*：讀取 `PERF_PRESETS[perfLevel].skip`（正確屬性為 `frameSkip`），導致結束降溫後一律還原為 1，節能畫質失效。
   - *修法*：改為讀取 `.frameSkip`。
9. **物理數值 NaN 終極安全防線 (`js/physics.js:step`)**：
   - *修法*：在 `step()` 結尾加入 `if (!Number.isFinite(this.pos.x + ...))` 防護，一旦數值異常立刻重置位置與速度並呼叫 `onDead()`，杜絕卡死在空中。

---

### 🟢 【B. 經本機原始碼核實為「誤報 / 幻覺」(請勿誤改)】

1. **`updateAimFromLeftHand` 未定義？** ➜ **誤報！** 該函式真實定義在 `js/motion.js:324`，且 `updateTorsoYaw` 在 line 332 也確實接收 4 個參數，體感主流程完全不會拋 ReferenceError。
2. **逐幕 33 點錄影器有 17MB 記憶體洩漏？** ➜ **誤報！** 專案中從未實作過高頻逐幕錄影器（此為規劃中的概念，未上線），目前僅有記錄 20 筆力道摘要的 `AUDIT_LOG`。決定**堅守隱私不錄製高頻姿態（選 B）**，隱私條款同步聲明「零姿態影格錄製、零視訊外傳」。
3. **toast 樣板字串缺少 `${}`？** ➜ **誤報！** 原始碼完整正常，是複製貼上給 Claude 時 Markdown 語法吃掉符號。
4. **Worker 缺少 `deleteMe` 白名單？** ➜ **誤報！** `backend/cloudflare-worker.js:10` 與 `Code.gs:18` 已包含 `'deleteMe'`。

---

## 3. 下一步實作執行計畫 (Sprint Tasks)

### 優先級 P0（上線前必修）
- [ ] **Task P0-1**：`js/game.js` 修復曲球手勢兩項式 (`getSwipeCurve`)。
- [ ] **Task P0-2**：`js/game.js` 修復第三桿放短（`rallyHits === 3 && server === 'PLAYER'`，`forcedShot` 覆寫落點，限定 `stage >= 4`，不提前 return）。
- [ ] **Task P0-3**：`backend/cloudflare-worker.js` & `backend/Code.gs` 將 `friends` 改為 POST 驗證 token；英雄榜完全移除 `ig` 欄位。
- [ ] **Task P0-4**：`js/config.js` 強化 `deleteAccount()` 驗證回應與全面清理 `nchu_*` localStorage。
- [ ] **Task P0-5**：`js/fun_mode.js` 修正 `GIANT_PLAYER` 僅放大軀幹視覺，以及道具箱幾何/材質共用防 GPU 洩漏。
- [ ] **Task P0-6**：`js/physics.js` 加入 `step()` NaN 終極防護。
- [ ] **Task P0-7**：`js/social.js` 修正 `setEcoMode` 的 `.frameSkip` 讀取。
- [ ] **Task P0-8**：執行 `node scripts/build-single.js` 同步 `index.html`。

### 優先級 P1（功能正確性與平衡）
- [ ] **Task P1-1**：`js/game.js` 接上神經網路 `aiShot.speed` 到 `solveArc`；`js/pickle_neural_policy.js` LOB 改降速高拋。
- [ ] **Task P1-2**：`js/pickle_neural_policy.js` 修正 N9 DROP 偏置與相對座標。
- [ ] **Task P1-3**：`privacy-policy.html` 修正條款文字（宣告零逐幕姿態錄製、英雄榜公開欄位僅包含系所、明確揭露 Sheets/Worker 運作）。

---

## 4. 修復後回歸測試檢核清單 (Regression Test Checklist)

1. **第 2 關回歸**：在第 2 關雙彈跳中，後場輕推回擊是否能**正常通關**？（驗證陷阱 1 已解）
2. **第 4 關放短**：玩家發球 ➔ 鵝回深球 ➔ 玩家後場輕推（`ch <= 0.28`），是否正常觸發 `PERFECT!` 與廚房落點？
3. **曲球手勢**：關閉體感，觸控或滑鼠向右劃弧，球是否往右曲？向前直推是否筆直飛行？
4. **巨人化道具**：第 6 關吃下紅蘑菇 🍄 後，發球是否不再誤判「拍面過高」？
5. **好友資料隱私**：使用無 token 的 GET 請求打 `act=friends` 是否被拒絕？英雄榜列表是否已無 `ig`？
6. **NaN 容錯**：在瀏覽器 Console 執行 `PH.vel.x = NaN`，遊戲是否正常結算而不卡死？

---

## 5. 本輪 Review 判定回覆、宣稱撤回與交付範圍收斂

> **審查結論處置**：本輪 GPT Review 判定不通過（Standards 4 項、Spec 5 項），批評完全客觀中肯。我們全面接受審查意見，立即停止擴充與部署，**將神經網路訓練與遊戲 Runtime 接入完整拆出本輪交付**，回到約定之「**提取管線修復＋人工驗收素材**」。工作樹中之 Runtime 接線、模型權重與訓練切分產物已自交付 `HEAD` 中退回（完整保留先前提交歷史），確保 `git diff 952b573 HEAD -- js/ css/ v14.html index.html v14-single.html scripts/self-test.js` 完全為空（零 Runtime 修改）。

---

### 5.1 未支持宣稱之正式撤回與數據澄清 (Formal Retractions)

| 原宣稱項目 | 審查查證問題 | 正式處置與客觀事實 |
| :--- | :--- | :--- |
| **1.「276 筆 Tier A 純真值樣本」** | 393 筆的 `manual_verified` 均為自動產出之 `AUTO_TIERED`，依門檻自封為 `TRUE`，無人工真值。 | **🚨 撤回真值宣稱**：更新管線後之 436 筆僅代表通過運動學門檻之「啟發式候選揮拍 (`TIER_A_CANDIDATE`)」，所有 724 筆樣本之 `manual_verified` 均設為 `PENDING_HUMAN_AUDIT`、`is_true_stroke` 設為 `PENDING`，交由人工比對 5 幀連續圖確認。 |
| **2.「跨影片留一完整 LOVO（21 部影片）」** | 實際為 4 支留出影片、21 個事件（更新前）；為固定切分而非逐片輪替之完整 LOVO；合法發球 Recall 僅 42.9% (3/7)；丁克 Recall 100% 僅為 3/3。 | **🚨 撤回完整 LOVO 宣稱與訓練產物**：本輪已將模型訓練、固定切分計畫與權重檔案拆出交付範圍；澄清 `VOLLEY_PUNCH`、`OVERHAND_FAULT`、`POWER_DRIVE`、`PASSIVE_BLOCK` 均為單影片類別，待補齊多影片與人工真值後再另案進行模型訓練。 |
| **3.「新引擎已接管發球與廚房判罰」** | `tryHit()` 僅在 `RALLY` 狀態進入，`isServe` 恆為 false；`wristVelY` 未傳入；廚房犯規已被前置程式提前 return。 | **🚨 撤回接入宣稱**：`stroke_classifier_v2.js` 與 `tests/test_stroke_engine.js` 已自交付 `HEAD` 移除，`js/game.js`、`v14.html`、`index.html`、`v14-single.html` 100% 還原至 `952b573` 基線，**本輪零 Runtime 改動**。 |
| **4.「推論引擎零動態記憶體配置 (Zero GC)」** | 特徵提取每次建立 `Float32Array`，推論與仲裁亦每次回傳新 Object，Node 基準測試不能代表手機瀏覽器零 GC。 | **🚨 撤回 Zero GC 宣稱**：承認先前實作存在 TypedArray 與物件配置，撤回未經驗證之零 GC 宣稱。 |
| **5.「獨立測試結果 (Test Set)」** | 訓練每輪均評估 Test Set 並以測試準確率挑選儲存最佳權重，造成測試集資訊洩漏。 | **🚨 撤回洩漏模型**：承認先前訓練迴圈存在測試集選模洩漏，已將模型與訓練腳本拆出本輪交付，留待人工真值結凍後於下一階段獨立處理。 |

---

### 5.2 提取管線缺陷工程修復實證 (Kinematics Pipeline Remediation)

針對 Reviewer 指出的提取管線 4 大可重現缺陷，已完成徹底修復並通過專屬單元測試：

1. **遮擋後手腕跳點追蹤無法恢復 (Tracking Occlusion Recovery)**：
   - *缺陷根源*：`last_good_pt` 在位移超過門檻時永遠不更新，導致遮擋後手腕在畫面新位置重現時，連續有效幀均被當作 `JUMP_OUTLIER` 永遠卡死。
   - *修復實作* (`scripts/kinematics_v2.py`)：引入 **3 幀前瞻空間一致性檢驗 (`_has_coherent_lookahead`)** 與分段邊界 (`segment_starts`) 差分保護。當關節點相對於上一有效點位移超過 `max_disp` 時，若當前幀與後續連續 2 幀（共 3 幀）皆有效且彼此位移均 $\le \text{max\_disp}$，立即判定為真實位置重現（而非單幀雜訊瞬移），第 1 幀即恢復為 `"OK"` 並重置 `OneEuroFilter2D`，同時在速度與加速度差分時不跨越 `segment_starts` 邊界，徹底消除重定位邊界之速度爆衝。
   - *測試實證*：`test_tracking_recovery_after_occlusion` 驗證短遮擋（2 幀）與長遮擋（15 幀）後出現在新位置的 8 個連續點 **8/8 全數立即恢復為 `"OK"`** 且無速度異常（100% PASS）。

2. **多波峰鏈式合併失控 (1D Peak Non-Maximum Suppression)**：
   - *缺陷根源*：舊版由左至右貪婪合併僅比對相鄰前一波峰之時間差（`times[p] - times[curr[-1]] <= merge_window_s`），導致間隔 0.4s 的多個連續波峰像骨牌一樣鏈式連鎖，跨越 1.2s 被合成單一事件。
   - *修復實作* (`scripts/kinematics_v2.py`)：改為 **依峰值速率由高至低排序之真實 1D Peak Non-Maximum Suppression (NMS)**（抑制半徑 `effective_merge_window_s = min(merge_window_s, max_cluster_span_s) = 0.38s`），被抑制之次級引拍／隨揮波峰不會傳遞抑制半徑，徹底杜絕骨牌鏈式合併；同時事件起訖追蹤 (`start_idx`, `end_idx`) 受相鄰主峰中點與 $\pm 0.55\text{s}$ 雙重邊界約束，確保相鄰獨立揮拍絕不重疊。
   - *測試實證*：`test_peak_merging_cluster_span_limit` 驗證跨越 1.2s 的 4 個間隔 0.4s 波峰 **4/4 全數保留為 4 個獨立事件**（100% PASS）。

3. **斷點快取缺乏代碼與參數雜湊 (Comprehensive Cache Invalidation)**：
   - *缺陷根源*：舊版快取僅比對靜態字串 `code_version == "2.0.0"`，修改 `kinematics_v2.py` 或調整提取門檻參數時，快取依然秒讀舊事件，無法自動失效。
   - *修復實作* (`scripts/extract_strokes_v2.py`)：快取條目新增並強制比對：
     - `kinematics_sha256`：`scripts/kinematics_v2.py` 之 SHA256 檔案雜湊。
     - `extractor_sha256`：`scripts/extract_strokes_v2.py` 之 SHA256 檔案雜湊。
     - `params_hash`：包含門檻、採樣步長、合併窗與尺度參數之完整設定字典 SHA256 雜湊。
     - 支援 `--force` / `--no-cache` 命令列旗標強制重跑。
   - *測試實證*：`test_cache_invalidation_hash_checking` 驗證代碼雜湊或參數雜湊任一變更即自動判定快取失效（100% PASS）。

4. **重跑提取覆寫人工標註與偵測評估補齊 (Non-Destructive Manifest Preservation & Detector PR Evaluator)**：
   - *缺陷根源*：舊版以 `open(MANIFEST_PATH, "w")` 直接全量覆寫，使用者填寫之人工查驗結果會在一鍵重跑時蒸發。
   - *修復實作* (`scripts/extract_strokes_v2.py`, `scripts/audit_biomechanics_tiering.py`, `scripts/evaluate_detector_v2.py`)：
     - 新增 `load_existing_manifest_annotations`：重新生成清單時，優先比對現有檔案中之 `(video, event_id)` 與 `(video, timestamp)`，凡經人工標註之 `manual_verified`、`is_true_stroke` 及 `notes` 一律 100% 原樣繼承保留；未人工標註者預設給予 `PENDING_HUMAN_AUDIT` 與 `PENDING`。
     - 新增 `scripts/evaluate_detector_v2.py`：提供候選事件人工真值覆蓋率統計、已驗證候選精確率 (`TP / (TP + FP)`)，以及與獨立真值時間戳 (`data/v2/ground_truth_events.json`, 容許誤差 $\le 0.30\text{s}$) 比對之事件級 Detection Precision / Recall / F1 評估工具。
   - *測試實證*：`test_manifest_preservation_of_human_annotations` 與 `test_detector_precision_recall_evaluation` 雙雙通過（100% PASS）。

---

### 5.3 提取管線重跑全量數據與啟發式分級結果

以修復後的運動學管線（3 幀空間一致性追蹤恢復＋1D Peak NMS＋雜湊校驗）重跑 11 部影片全量素材：

* **總候選事件數**：**724 筆**（修復遮擋後追蹤卡死與骨牌鏈式合併後，完整收錄各段連續對打與多球練習之候選事件）。
* **時序與速度分佈**：
  - 揮拍歷時 (`Duration`)：`p10 = 0.17s`, `med = 0.33s`, `p90 = 0.60s`, **`max = 1.13s`**（無任何跨越多球的超長合併事件）。
  - 峰值速率 (`Speed`)：`p10 = 2.09 t/s`, `med = 4.89 t/s`, `p90 = 16.61 t/s`, **`max = 41.56 t/s`**（無任何 $>100$ 或數萬之極端跳點）。
  - 擊球間隔 (`Inter-gap`)：`p10 = 0.43s`, `med = 0.67s`, `p90 = 1.59s`, **`min = 0.40s`**。
* **物理品質旗標**：696 筆 `OK` (96.1%), 17 筆 `DEGRADED_SCALE_EXPAND`, 11 筆 `DEGRADED_SCALE_COLLAPSE`。
* **各類別候選分佈**：
  - `UNDERHAND_LEGAL` : 209 筆（3 支影片：39 + 120 + 50）
  - `POWER_DRIVE`     : 172 筆（1 支影片）
  - `OVERHAND_FAULT`  :  78 筆（1 支影片）
  - `SMASH`           :  74 筆（2 支影片：55 + 19）
  - `KITCHEN_DINK`    :  71 筆（2 支影片：62 + 9）
  - `VOLLEY_PUNCH`    :  71 筆（1 支影片）
  - `PASSIVE_BLOCK`   :  49 筆（1 支影片）

#### 啟發式候選分級 (Heuristic Tiering, 由 `scripts/audit_biomechanics_tiering.py` 產出)：
> ⚠️ **重要聲明**：以下分級僅為基於速度、時長與次級波峰規則之初篩排序，**非人工真值**，724 筆全數標為 `manual_verified = PENDING_HUMAN_AUDIT`、`is_true_stroke = PENDING`，供人工審查。

* 🟢 **Tier A 啟發式候選揮拍 (`TIER_A_CANDIDATE`)**：**436 筆 (60.2%)**。特徵符合揮拍生理窗，作為人工驗收之優先集。
* 🟡 **Tier B 邊界/次級震盪 (`TIER_B_MARGINAL`)**：**229 筆 (31.6%)**。包含小於 0.55s 之次級波峰或輕力道動作，需人工抽樣確認。
* 🔴 **Tier C 疑似假陽性 (`TIER_C_SUSPECT`)**：**59 筆 (8.1%)**。包含速度 $<1.8\text{ t/s}$ 之緩慢復位或撿球動作。

---

### 5.4 人工視覺驗收素材交付 (Human Audit Assets)

為供工程與運動專業人員進行事件真值標記，本次交付提供完整之可視化驗收素材：

1. **5 幀連續接觸動作展開圖 (Collages)**：
   - 位於 `data/v2/verification_collages/`（共 88 張組圖，每支影片抽樣最多 8 組代表事件）。
   - 涵蓋 7 大類別動作之 `[Start ➔ Approach ➔ Candidate Peak ➔ Follow ➔ End]`。
2. **人工審查事件清單 (Manifest CSV) 與評估腳本**：
   - 清單位於 `data/v2/candidate_events_manifest.csv`。
   - 審查人員於填寫 `manual_verified` (`HUMAN_CONFIRMED` / `HUMAN_REJECTED`) 與 `is_true_stroke` (`TRUE` / `FALSE`) 後，可直接執行 `./.venv/bin/python scripts/evaluate_detector_v2.py` 產出真值覆蓋率與 Precision / Recall / F1 指標。

---

## 6. 模型訓練修復與 Runtime 接入之後續規劃 (Decoupled Next-Phase Roadmap)

依審查意見，模型訓練與 Runtime 接入已完全拆出本輪，待人工驗收完成後按以下規範另案推進：

1. **人工真值結凍**：完成 `candidate_events_manifest.csv` 人工確認並執行 `scripts/evaluate_detector_v2.py` 驗收偵測器 Precision / Recall。
2. **嚴格分離訓練／驗證／測試集選模**：僅在訓練集內部驗證選模，保留測試集僅在最終執行一次性盲測，並誠實標註單影片類別之跨影片評估限制。
3. **線上／離線特徵定義 100% 對齊與權重一致性自動化測試**：修正線上垂直加速度、相對高度與左手高舉特徵定義，並於 CI 測試中強制比對 JS 內嵌權重與模型 JSON 權重（295 個參數誤差 $< 10^{-6}$），通過後方可接入發球與對打狀態機。

---

## 7. 全量自動化驗證矩陣 (Verification Receipts)

| 測試指令 / 檢驗工具 | 測試範圍與檢驗項目 | 實測結果 | 驗收意義 |
| :--- | :--- | :--- | :--- |
| **`./.venv/bin/python -m unittest discover -s tests -v`** | 運動學座標符號、等比像素補償、速度還原、瞬移跳點過濾、尺度退化標記、**遮擋追蹤恢復 (8/8 OK)**、**1D Peak NMS (4峰不合併)**、**代碼與參數雜湊快取失效**、**人工標註非破壞性留存**、**偵測器 PR 評估與待審狀態隔離** | **11/11 PASS (100%)** | 驗證運動學管線修復完成，所有審查指出之提取缺陷均受單元測試保護 |
| **`./.venv/bin/python scripts/evaluate_detector_v2.py`** | 檢查 `candidate_events_manifest.csv` 是否存在未經授權之自動真值，並輸出啟發式分級與人工審核進度 | **724 筆全數為 `PENDING_HUMAN_AUDIT`** | 確保自動分級絕不冒充人工真值 |
| **`node scripts/self-test.js`** | 打包同步、資安防禦 (OWASP)、物理動力學矩陣 (82項)、CCD 防穿透、遊戲狀態機全套測試 | **99/99 PASS (100%)** | 驗證 Runtime 100% 維持在 `952b573` 基線狀態，無任何越界修改或打包脫節 |

