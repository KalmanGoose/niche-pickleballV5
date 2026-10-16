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
| **`./.venv/bin/python -m unittest discover -s tests -v`** | 運動學管線 11 項測試＋`TASK-V8-608` 12 大回歸測試（嚴格人工簽認表、序列 DP 最大配對數、Manifest 讀取失敗/毀損保護、孤兒簽認事件保護、時間容差歧義與單檔原子失敗保留、精確 ID 時間戳偏移拒絕、4 檔全量事務性 Rollback 注入、跨產物 event_id 一致性與映射持久化、回滾失敗備份保留與阻斷混合讀取、中斷崩潰偵測與安全自動恢復、**替換完成但日誌寫入前崩潰之實體磁碟雜湊感知恢復**、**成功發布路徑日誌清理失敗嚴格保留備份防護**） | **23/23 PASS (100%)** | 驗證提取管線、Manifest 安全防線、預寫日誌事務性發布、實體磁碟狀態感知恢復、日誌清理失敗備份保留與中斷安全恢復全數受單元測試保護 |
| **`./.venv/bin/python scripts/evaluate_detector_v2.py`** | 於隔離副本唯讀檢查 `candidate_events_manifest.csv` 之待審狀態、矛盾狀態計數與啟發式分級分佈（含恢復日誌守護） | **724 筆 `PENDING_HUMAN_AUDIT` / 0 筆矛盾** | 確保自動分級或矛盾狀態絕不計入人工真值 TP/FP 分母，且中斷未完成時拒絕讀取 |
| **`git diff --check`** | 檢查變更檔案之空白與格式規範 | **PASS (Exit 0)** | 確保提交差異乾淨無格式瑕疵 |

---

## 8. TASK-V8-608 實作紀錄：Manifest 安全防線、可恢復事務發布與跨產物一致性修正

* **Task ID**：`TASK-V8-608`（Extraction manifest safety, recoverable transactional batch publish, and detector evaluation）
* **分支與基底**：於乾淨隔離 worktree 自 `3308840` 建立 `task/agv/extract-guard-3308840`（完整保留原 `test-mobile-motion` 工作樹與未提交修改，未動 `data/**`、`models/**` 或前端/後端產品檔）。
* **變更檔案（嚴格限於 Allowed Files）**：
  - `scripts/manifest_annotations_v2.py`（共用標註驗證、兩層配對含時間戳檢核、預寫日誌可恢復批次發布 `batch_publish_files`、實體磁碟狀態感知恢復函式 `recover_pending_batch_publish`、未完成交易守護 `check_no_pending_recovery`、跨產物 ID 同步 `update_events_with_resolved_annotations`）
  - `scripts/extract_strokes_v2.py`（預檢通過後暫存、checkpoint 讀取守護、跨產物同步 `resolved_event_id`、可恢復事務批次發布、持久化 `event_id_mapping`）
  - `scripts/audit_biomechanics_tiering.py`（接入共用預檢、孤兒／歧義阻斷與原子替換）
  - `scripts/evaluate_detector_v2.py`（未完成交易日誌守護、嚴格人工簽認狀態表、序列 DP 最大配對數與最小總時間誤差）
  - `tests/test_manifest_v2.py`（12 組先紅後綠之可重現失敗注入與崩潰恢復回歸測試）
  - `HANDOFF.md`（記錄本任務變更、紅綠燈測試證據與未驗證項目）

### 8.1 核心修正摘要 (Reviewer A Rejection Remediation)
1. **[P1] 回滾失敗備份保留、預寫日誌與阻斷混合版本讀取 (`scripts/manifest_annotations_v2.py`, `scripts/extract_strokes_v2.py`, `scripts/evaluate_detector_v2.py`)**：
   - *問題根源*：舊版 `batch_publish_files` 在第 2 檔替換失敗且回滾第 1 檔也失敗（雙重故障）時，`finally` 區塊無條件執行 `shutil.rmtree(backup_dir)`，導致第 1 檔為新版、第 2 檔為舊版（混合版本），且唯一可用於恢復的備份被刪除；中斷時亦無持久化日誌。
   - *修復實作*：
     1. **Write-Ahead Recovery Journal**：在接觸任何目標檔前，於目標目錄原子寫入 `.batch_publish_recovery.json`，記錄交易 ID、目標目錄、各檔案原始/暫存 SHA-256、備份路徑與初始 `PENDING` 狀態。隨替換推進即時更新日誌狀態。
     2. **回滾失敗嚴格保留備份**：`remove_backup_on_finally` 預設為 `False`。僅在交易完全成功（所有目標替換完成）或回滾完全成功（所有已替換目標均成功還原且 SHA-256 驗證無誤）時才清除備份與日誌。若回滾中拋出任何異常，日誌標記為 `ROLLBACK_FAILED`，**絕不刪除備份目錄**，並拋出含備份路徑與日誌路徑之 `RuntimeError`。
     3. **嚴格阻斷讀取或覆寫混合版本**：`load_and_validate_manifest`、`load_checkpoint_v2`、`evaluate_detector_v2.py` 與 `batch_publish_files(auto_recover=False)` 在讀寫前均呼叫 `check_no_pending_recovery`。若目錄下存在未完成或回滾失敗之日誌，立即拋出 `ManifestValidationError` 拒絕執行，**徹底阻止讀取混合版本**。
     4. **安全可驗證恢復機制**：新增 `recover_pending_batch_publish(target_dir)`，自保留備份將所有已修改檔案倒序還原至原始位元組，逐一驗證 SHA-256 吻合後，才刪除日誌與備份目錄；`publish_extraction_outputs` 與 `batch_publish_files` 支援 `auto_recover=True`，在下次執行前自動完成安全恢復。
   - *測試實證*：
     - `test_9_rollback_failure_preserves_backup_blocks_mixed_reads_and_recovers` 驗證雙重故障時備份目錄 100% 保留、日誌標記 `ROLLBACK_FAILED`、讀取與再次發布被嚴格阻斷、執行 `recover_pending_batch_publish` 後所有檔案 100% byte-for-byte 還原且後續操作恢復正常。
     - `test_10_interrupted_publication_recovery_and_mixed_version_guard` 驗證中斷崩潰（殘留 `IN_PROGRESS` 日誌與半替換檔案）時阻斷讀取、`auto_recover=True` 下次執行前自動安全恢復並順利完成新發布。

2. **[P1] 精確 ID 配對增加時間戳一致性檢核 (`scripts/manifest_annotations_v2.py`)**：
   - 第一層 `(video, event_id)` 精確配對強制檢核 `abs(new_ts - old_ts) <= timestamp_tolerance_s`。
   - 若 ID 相同但時間戳偏移超過容差（例如舊版 `smash_ev_001` 在 3.235s 帶有 `HUMAN_CONFIRMED/TRUE`，新版重編號後 `smash_ev_001` 位移至 19.800s），立即視為時間戳衝突／歧義，拋出 `ManifestValidationError` 並中止發布，**絕不靜默繼承人工簽認**。
   - 回歸測試：`test_6_exact_id_with_shifted_timestamp_rejected_as_ambiguity` 驗證時間戳位移被拒絕且原檔 100% 保持原樣。

3. **[P1] 多檔發布實作全量事務性 Rollback (All-or-Nothing) (`scripts/manifest_annotations_v2.py`, `scripts/extract_strokes_v2.py`)**：
   - 提取輸出涉及 4 大產物：`candidate_events_manifest.csv`、`real_strokes_dataset_v2.json`、`real_strokes_dataset_v2.csv`、`checkpoint_v2.json`。
   - 於 staging 暫存目錄完整寫入並驗證 4 檔，於 backup 暫存目錄對已存在之目標檔案進行完整備份，循序透過 `_replace_single_file` 執行原子替換。
   - 若任一步驟失敗且回滾成功，所有已修改檔案 100% 還原為備份狀態。
   - 回歸測試：`test_7_multi_file_batch_publish_rollback_on_any_failure` 分別在第 1、2、3、4 檔注入替換失敗，驗證 4 個檔案在 4 次失敗注入中 SHA-256 均 **100% byte-for-byte 保持原樣**。

4. **[P2] 跨產物 event_id 100% 一致性與可追查映射持久化 (`scripts/manifest_annotations_v2.py`, `scripts/extract_strokes_v2.py`)**：
   - 當第二層時間戳 fallback 承接舊穩定 ID 時，呼叫 `update_events_with_resolved_annotations`，將記憶體中的 `all_events` 與 `staged_checkpoint` 中的事件 ID 統一更新為 `resolved_event_id`，並記錄 `detector_event_id`。
   - `full_output["metadata"]["event_id_mapping"]` 持久化儲存 `(video, stable_event_id, detector_event_id, timestamp_peak_s)` 映射陣列，保證追溯性。
   - 確保 `manifest.csv`、`dataset.json`、`dataset.csv` 與 `checkpoint.json` **4 個產物之 `(video, event_id)` 鍵 100% 相同**，跨檔 Join 完全成功。
   - 回歸測試：`test_8_cross_artifact_event_id_consistency_and_persistent_mapping` 驗證 4 大產物鍵值一致性與 metadata 映射持久化。

5. **嚴格人工簽認狀態表與序列 DP 最大配對數 (`scripts/evaluate_detector_v2.py`)**：
   - 僅 `HUMAN_CONFIRMED/TRUE`、`VERIFIED_TRUE/TRUE` 計入 `human_verified_tp`；僅 `HUMAN_REJECTED/FALSE`、`VERIFIED_FALSE/FALSE` 計入 `human_verified_fp`。
   - `AUTO_TIERED/TRUE` 與各類矛盾狀態均排除於 TP/FP 與 `verified_candidate_precision` 分母之外，分開統計 `pending_human_audit` 與 `invalid_or_contradictory_count`。
   - 序列動態規劃以字典序最大化 `(配對數 TP, -總絕對時間差, 確定性索引順序)`，避免貪婪匹配造成的非最優配對。

### 8.2 Round 3 P1 修正：檔案替換與日誌更新時間差防護、日誌刪除失敗備份保留與雙重驗收
依 Reviewer A 唯讀審查報告（`/private/tmp/cli-review-608.md`），針對「檔案原子替換後、journal 狀態更新前之中斷窗口」與「成功路徑刪除 journal 失敗」進行全面補強：
1. **實體磁碟狀態感知恢復 (Content-Aware Recovery, `recover_pending_batch_publish`)**：
   - 恢復時**不得且不再**單純信任日誌中的 `item['state']`。
   - 對 journal 中每個 item，主動檢視實際磁碟狀態：計算目標檔當前 SHA-256，並與 `original_sha256` 及 `existed_before` 逐一比對。
   - 凡實際磁碟內容偏離交易前原始狀態者（無論日誌標記為 `PENDING`、`REPLACING` 或 `COMMITTED`），一律判定為需要恢復。
   - 還原前嚴格驗證備份檔案存在性與原始 SHA-256；還原後立即檢驗該檔 SHA-256。
   - 新增全域 Post-Recovery Verification：在刪除日誌前，強制再次檢查交易清單內所有目標檔案，100% 確認所有檔案均回到交易前位元組。
2. **替換前寫入 `REPLACING` 狀態 (`batch_publish_files`)**：
   - 在執行 `_replace_single_file` 前，先將記憶體與磁碟上的 journal item 狀態更新為 `REPLACING` 並即時寫入，進一步縮小狀態不確定性窗口。
   - 替換過程中若發生異常，回滾檢查所有被處理過的 items，並逐一還原。
3. **成功與回滾路徑日誌清理失敗絕不刪除備份**：
   - 在 `batch_publish_files` 的成功路徑（Step 4）與回滾路徑中，若 unlinking journal 發生任何 `OSError` 或日誌殘留，`remove_backup_on_finally` 維持 `False`。
   - 嚴格禁止刪除 `backup_dir`，並拋出含備份路徑之 `RuntimeError`，杜絕留下無備份可恢復的 stale journal。
4. **新增回歸測試 (tests/test_manifest_v2.py)**：
   - `test_11_replace_done_before_committed_journal_crash_recovers`：模擬檔案替換已完成、但崩潰發生於 `COMMITTED` 寫入日誌之前（日誌仍為 `PENDING`）。驗證恢復函式能主動感知磁碟雜湊偏離、自備份完全還原兩檔原始 SHA-256、清理日誌與備份，並成功放行後續讀取。
   - `test_12_success_journal_unlink_failure_preserves_backup`：模擬成功路徑中日誌刪除失敗，驗證拋出 `RuntimeError`、備份目錄 100% 完整保留未被 finally 刪除、且後續恢復程序可自該備份安全還原。

### 8.3 未驗證項目與證據缺口 (Evidence Gaps — NOT VERIFIED)
- **真實人工標註真值與獨立影片事件 GT**：`NOT VERIFIED`（目前 `data/v2/candidate_events_manifest.csv` 724 筆全數為 `PENDING_HUMAN_AUDIT`，尚未載入真人簽核真值或 `ground_truth_events.json`）。
- **正式 `data/v2` 重寫與實際影片重提取**：`NOT VERIFIED`（依任務板規範，本任務未對正式 `data/v2` 執行寫入或重跑 11 支實際影片提取，所有失敗注入與成功寫入均於 `tempfile.TemporaryDirectory` 臨時資料驗證）。
- **跨提取版本時間容差之實戰覆蓋率與超大事件數 DP 記憶體壓測**：`NOT VERIFIED`。
- **BROWSER / HUMAN GAME FEEL**：`NOT REQUIRED / NOT VERIFIED`（本任務未修改任何前端／遊戲 Runtime 程式碼）。

