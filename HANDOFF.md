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

> **審查結論處置**：本輪 GPT Review 判定不通過（Standards 4 項、Spec 5 項），批評完全客觀中肯。我們全面接受審查意見，立即停止擴充與部署，**將神經網路訓練與遊戲 Runtime 接入完整拆出本輪交付**，回到約定之「**提取管線修復＋人工驗收素材**」。工作樹中之 Runtime 接線與多餘檔案已乾淨復原至基線 `a1d934b`，保留既有提交歷史，專注解決提取缺陷與人工標註真值建立。

---

### 5.1 未支持宣稱之正式撤回與數據澄清 (Formal Retractions)

| 原宣稱項目 | 審查查證問題 | 正式處置與客觀事實 |
| :--- | :--- | :--- |
| **1.「276 筆 Tier A 純真值樣本」** | 393 筆的 `manual_verified` 均為自動產出之 `AUTO_TIERED`，依門檻自封為 `TRUE`，無人工真值。 | **🚨 撤回真值宣稱**：412 筆（更新管線後）僅代表通過運動學門檻之「啟發式候選揮拍 (`HEURISTIC_TIER_A_CANDIDATE`)」，所有樣本之 `manual_verified` 重置為 `PENDING_HUMAN_AUDIT`，`is_true_stroke` 重置為 `PENDING`，交由人工比對 5 幀連續圖確認。 |
| **2.「跨影片留一完整 LOVO（21 部影片）」** | 實際為 4 支留出影片、21 個事件（更新前）；為固定切分而非逐片輪替之完整 LOVO；合法發球 Recall 僅 42.9% (3/7)；丁克 Recall 100% 僅為 3/3。 | **🚨 撤回完整 LOVO 宣稱**：更正為「**4 支固定留出影片之驗證子集 (Held-out Fold)**」。澄清各類別之真實樣本數，且 `VOLLEY_PUNCH`、`OVERHAND_FAULT`、`POWER_DRIVE`、`PASSIVE_BLOCK` 均為單影片類別，標註為 `[Constraint: 無法進行跨影片泛化驗證]`。 |
| **3.「新引擎已接管發球與廚房判罰」** | `tryHit()` 僅在 `RALLY` 狀態進入，`isServe` 恆為 false；`wristVelY` 未傳入；廚房犯規已被前置程式提前 return。 | **🚨 撤回接入宣稱**：`stroke_classifier_v2.js` 與 `tests/test_stroke_engine.js` 已徹底自交付中移除，遊戲 `js/game.js`、`v14.html`、`index.html` 乾淨還原至 baseline，**本輪零 Runtime 改動**。待後續模型與特徵對齊通過審查後再行獨立接入。 |
| **4.「推論引擎零動態記憶體配置 (Zero GC)」** | 特徵提取每次建立 `Float32Array`，推論與仲裁亦每次回傳新 Object，Node 基準測試不能代表手機瀏覽器零 GC。 | **🚨 撤回 Zero GC 宣稱**：承認目前實作存在 TypedArray 與物件配置，不使用未經驗證之零 GC 宣傳詞。 |
| **5.「獨立測試結果 (Test Set)」** | 訓練每輪均評估 Test Set 並以測試準確率挑選儲存最佳權重，造成測試集資訊洩漏。 | **🚨 修正選模機制**：`scripts/train_stroke_classifier_v2.py` 已拔除迴圈內測試集選模，改為純依訓練損失 (`train_loss`) 保存模型，測試集僅在訓練完全結束後獨立評估一次。 |

---

### 5.2 提取管線缺陷工程修復實證 (Kinematics Pipeline Remediation)

針對 Reviewer 指出的提取管線 4 大可重現缺陷，已完成徹底修復並通過專屬單元測試：

1. **遮擋後手腕跳點追蹤無法恢復 (Tracking Occlusion Recovery)**：
   - *缺陷根源*：`last_good_pt` 在位移超過門檻時永遠不更新，導致遮擋後手腕在畫面新位置重現時，連續有效幀均被當作 `JUMP_OUTLIER` 永遠卡死。
   - *修復實作* (`scripts/kinematics_v2.py`)：新增時序中斷重置與連續跳點重同步機制。當時間間隔 $\Delta t > 0.20\text{s}$ 或累積連續跳點達 3 幀以上時，自動將當前有效關節點視為新追蹤基準（標記為 `RESUME` / `RECOVERED`），平滑重啟追蹤。
   - *測試實證*：新增 `test_tracking_recovery_after_occlusion`，驗證遮擋 15 幀後出現在新位置的 8 個連續點有 $\ge 6$ 幀成功恢復追蹤（100% PASS）。

2. **多波峰鏈式合併失控 (Peak Merging Cluster Span Limit)**：
   - *缺陷根源*：波峰合併時僅比對相鄰前一波峰之時間差（`times[p] - times[curr[-1]] <= merge_window_s`），導致間隔 0.4s 的多個連續波峰像骨牌一樣鏈式連鎖，跨越 1.2s 以上被合成單一超大事件。
   - *修復實作* (`scripts/kinematics_v2.py`)：引入最大總聚合時間窗 `max_cluster_span_s = 0.40s`，並將相鄰合併窗收緊至 `min(merge_window_s, 0.35s)`。即使相鄰波峰在窗內，一旦整群跨度超過 0.40s 即強制切分出新事件。
   - *測試實證*：新增 `test_peak_merging_cluster_span_limit`，驗證跨越 1.2s 的 4 個間隔 0.4s 波峰被精準切分為多個獨立事件，不再被合併成 1 個事件（100% PASS）。

3. **斷點快取缺乏代碼與參數雜湊 (Comprehensive Cache Invalidation)**：
   - *缺陷根源*：舊版快取僅比對靜態字串 `code_version == "2.0.0"`，修改 `kinematics_v2.py` 或調整提取門檻參數時，快取依然秒讀舊事件，無法自動失效。
   - *修復實作* (`scripts/extract_strokes_v2.py`)：快取條目新增並強制比對：
     - `kinematics_sha256`：`scripts/kinematics_v2.py` 之 SHA256 檔案雜湊。
     - `extractor_sha256`：`scripts/extract_strokes_v2.py` 之 SHA256 檔案雜湊。
     - `params_hash`：包含門檻、採樣步長、合併窗與尺度參數之完整設定字典 SHA256 雜湊。
     - 支援 `--force` / `--no-cache` 命令列旗標強制重跑。
   - *測試實證*：新增 `test_cache_invalidation_hash_checking`，驗證代碼雜湊或參數雜湊任一變更即自動判定快取失效（100% PASS）。

4. **重跑提取覆寫人工標註 (Non-Destructive Manifest Preservation)**：
   - *缺陷根源*：舊版以 `open(MANIFEST_PATH, "w")` 直接全量覆寫，使用者填寫之人工查驗結果會在一鍵重跑時徹底蒸發。
   - *修復實作* (`scripts/extract_strokes_v2.py` & `scripts/audit_biomechanics_tiering.py`)：新增 `load_existing_manifest_annotations`。重新生成清單時，優先比對現有檔案中之 `(video, event_id)` 與 `(video, timestamp)`，凡經人工標註之 `manual_verified`（如 `HUMAN_CONFIRMED` / `HUMAN_REJECTED`）、`is_true_stroke` 及 `notes` 一律 100% 原樣繼承保留；未人工標註者預設給予 `PENDING_HUMAN_AUDIT` 與 `PENDING`。
   - *測試實證*：新增 `test_manifest_preservation_of_human_annotations`，驗證人工確認與備註在重跑提取後完整留存（100% PASS）。

---

### 5.3 提取管線重跑全量數據與啟發式分級結果

以修復後的運動學管線（追蹤恢復＋最大跨度限制＋雜湊校驗）重跑 11 部影片全量素材：

* **總候選事件數**：**781 筆**（舊版因遮擋卡死與骨牌合併遺漏了許多合法事件，修復後完整收錄真實候選事件）。
* **手腕速率極值**：**41.44 torso-lengths/s**（無任何 $>100$ 或數萬極端跳點）。
* **物理品質旗標**：748 筆 OK (95.8%), 19 筆尺度擴展標記, 14 筆尺度坍陷標記。
* **各類別候選分佈**：
  - `UNDERHAND_LEGAL` : 231 筆
  - `POWER_DRIVE`     : 184 筆
  - `OVERHAND_FAULT`  :  81 筆
  - `VOLLEY_PUNCH`    :  80 筆
  - `SMASH`           :  79 筆
  - `KITCHEN_DINK`    :  75 筆
  - `PASSIVE_BLOCK`   :  51 筆

#### 啟發式候選分級 (Heuristic Tiering, 由 `scripts/audit_biomechanics_tiering.py` 產出)：
> ⚠️ **重要聲明**：以下分級僅為基於速度、時長與次級波峰規則之初篩，**非人工真值**，全數標為 `PENDING_HUMAN_AUDIT`，供人工審查。

* 🟢 **Tier A 啟發式候選揮拍**：**412 筆 (52.8%)**。特徵符合揮拍生理窗，作為人工驗收之優先集。
* 🟡 **Tier B 邊界/次級震盪**：**258 筆 (33.0%)**。包含小於 0.55s 之引拍波峰、次級隨揮與小球力道，需抽樣人工確認。
* 🔴 **Tier C 疑似假陽性**：**111 筆 (14.2%)**。包含時長 >1.15s 走動或速度 <1.8 t/s 之無效動作。
* 📌 **人工真值繼承狀態**：781 筆目前均處於 `PENDING_HUMAN_AUDIT` 與 `PENDING` 狀態，等待人工逐一簽認。

---

### 5.4 人工視覺驗收素材交付 (Human Audit Assets)

為供工程與運動專業人員進行事件真值標記，本次交付提供完整之可視化驗收素材：

1. **5 幀連續接觸動作展開圖 (Collages)**：
   - 位於 `data/v2/verification_collages/`。
   - 涵蓋 7 大類別動作之 `[Start ➔ Approach ➔ Candidate Peak ➔ Follow ➔ End]`。
   - 每張圖標註原片名、事件 ID、波峰手腕速率、總路徑長與總時長，可清晰目視確認是否真有揮拍與觸球。
2. **人工審查事件清單 (Manifest CSV)**：
   - 位於 `data/v2/candidate_events_manifest.csv`。
   - 包含欄位：`event_id, video, timestamp_peak_s, duration_s, peak_speed_torso_s, raw_class, heuristic_tier, confidence_tier, audit_notes, manual_verified, is_true_stroke, notes`。
   - 審查人員可直接於 Excel / 編輯器填寫 `manual_verified` (`HUMAN_CONFIRMED` / `HUMAN_REJECTED`) 與 `is_true_stroke` (`TRUE` / `FALSE`)，後續管線已具備保護機制，永不被覆寫。

---

## 6. 模型訓練修復與 Runtime 接入之後續規劃 (Decoupled Next-Phase Roadmap)

依審查意見，模型訓練與 Runtime 接入已拆出本輪，獨立規劃如下：

1. **訓練腳本選模洩漏修復實證 (`scripts/train_stroke_classifier_v2.py`)**：
   - 已完成重構：訓練迴圈內**完全移除測試集評估**，僅依據 `train_loss` 保存最優權重。
   - 保留測試集僅在訓練完全終止後，對最優權重獨立執行一次性評估。
2. **待完成前置要件 (Prerequisites for Model Phase)**：
   - ① **人工真值結凍**：完成 `candidate_events_manifest.csv` 之人工標註，建立具備 Ground Truth 的事件集，計算候選偵測器之精準 Precision / Recall。
   - ② **線上 / 離線特徵定義 100% 嚴格對齊**：
     - 線上垂直加速度：由連續 3 幀之手腕速度差分計算，禁止使用 `KIN.vPeak * 0.5` 替代。
     - 線上相對高度：統一採用標準化軀幹長度，禁止混淆遊戲世界高度與物理像素相對高度。
     - 發球準備旗標與抬手特徵：統一使用左手腕是否高於左肩之即時姿態判定。
   - ③ **權重一致性與數值單元測試**：
     - 新增自動化測試，直接載入遊戲端 JS 內嵌權重矩陣與 Python 模型 JSON 權重，比對所有 295 個浮點數（最大絕對誤差 $< 10^{-6}$），在 CI 中阻擋任何權重漂移。
   - ④ **正式 Runtime 接線與發球守護修復**：
     - 修正 `tryHit()` 與發球狀態機之接線邏輯，確保發球與回擊均能正確注入雙軌引擎。

---

## 7. 全量自動化驗證矩陣 (Verification Receipts)

| 測試指令 / 檢驗工具 | 測試範圍與檢驗項目 | 實測結果 | 驗收意義 |
| :--- | :--- | :--- | :--- |
| **`python3 -m unittest discover -s tests -v`** | 運動學座標符號、等比像素補償、速度還原、瞬移跳點過濾、尺度退化標記、**遮擋追蹤恢復**、**波峰合併跨度限制**、**代碼與參數雜湊快取失效**、**人工標註非破壞性留存** | **10/10 PASS (100%)** | 驗證運動學管線修復完成，4 大缺陷已全數受單元測試保護 |
| **`node scripts/self-test.js`** | 打包同步、資安防禦 (OWASP)、物理動力學矩陣 (82項)、CCD 防穿透、遊戲狀態機全套測試 | **99/99 PASS (100%)** | 驗證 Runtime 乾淨復原至穩定狀態，無語法或回歸問題 |
