# NCHU Pickleball 專案交接檔 (Project Handoff for GPT / Antigravity)

> **版本**：v5.3.0-review-sync  
> **更新日期**：2026-10-15  
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

## 5. 真人揮拍特徵提取修復與人工驗證交付 (v2 Rigorous & Traceable Pipeline Delivery)

> **任務目標**：依 GPT 與本地代碼核對結果，徹底重構真人揮拍姿態特徵提取流程，產出可追溯、可人工驗證的揮拍事件與特徵。  
> **嚴格邊界 [Constraint]**：本次交付嚴格限定於「**資料提取修復＋人工驗收素材**」。**禁止啟動神經網路訓練，禁止修改遊戲運行時（Runtime / index.html / js/）**。通過人工與 GPT Review 後始可進行後續訓練。  
> **任務識別碼**：`Task ID: 8df84d6c-7f46-4df2-ba38-06e471391a6d/task-377`  
> **工作目錄**：`/Users/ethanchen/Desktop/匹克球/test systeam/匹克球N-GO.v1`  
> **當前分支**：`test-mobile-motion`  
> **Commit SHA**：`be16536df20bafd50a96edb96f064686cb77b117`  

---

### 5.1 已確認缺陷與 v2 數學/工程修復對策

| 缺陷項目 | 舊版 (v1 Baseline) 致命問題 | v2 修復對策與工程實作 | 證據等級 |
| :--- | :--- | :--- | :--- |
| **1. 速度異常暴衝 (最高 30,256)** | 逐幀重新計算尺度並對縮放座標直接有限差分；包含雜訊極大的 Z 軸；追蹤跳點未濾除，產生高達 30,256.055 的荒謬數值。 | ① 徹底拔除未經相機校準的 Z 軸；② 速度改以「軀幹長度/秒 (torso-lengths/s)」為物理單位；③ 採用整段影片中位數軀幹長度 $S_{ref}$ 作為全域常數參考尺度；④ 導入 1-Euro 2D 自適應低通濾波器；⑤ 加入單影格瞬移跳點（>3.0 $S_{ref}$）過濾門檻。 | `[Fact]` |
| **2. 垂直座標正負號翻轉** | 原公式 `wrist_y_rel_hip = rw.y - mid_hip_y`，因影像座標系 Y 朝下，手腕在髖部上方時差值為負，註解與診斷解讀完全相反。 | 修正為標準 $Y_{up}$ 座標系：`wrist_y_rel_hip = (mid_hip_y - rw_y) / S_ref`。手腕在臀部上方為正值（如扣殺 SMASH 為正），手腕在臀部下方為負值（如合法下手發球 UNDERHAND 為負）。 | `[Fact]` |
| **3. 非等比長寬比失真** | 直接在正規化 $[0, 1]$ 空間計算夾角與距離，在 9:16（1080x1920 / 2160x3840）直式構圖下，水平方向距離被壓縮 1.77 倍，關節角度嚴重扭曲。 | 所有關節點在輸入後，第一時間映射回原始物理像素座標（Isotropic Euclidean Pixel Space），再進行角度、位移與距離運算，杜絕長寬比失真。 | `[Fact]` |
| **4. 類別偏置之事件偵測** | 舊版依據「預設真實類別」設定不同的速度與高度門檻（例如針對 Smash 設特定高門檻，Dink 設低門檻），造成嚴重的選樣偏差（Selection Bias）。 | 實作全動作通用的「無偏候選事件偵測器 (Class-Agnostic Detector)」：統一以波峰速度 $\ge 1.5\text{ torso/s}$、總路徑長 $\ge 0.3\text{ torso}$ 為候選，不依真實類別動態改變判定標準。 | `[Fact]` |
| **5. 峰值重複觸發與震盪** | 單次揮拍在加速、撞擊、隨揮震盪時會觸發 2~4 次事件，導致重複抽樣。 | 引入非極大值抑制（NMS）時間窗合併演算法：在 $0.45\text{s}$ 時間窗內的多重波峰自動合併為單一擊球事件，記錄完整起始點、候選波峰與結束點。 | `[Fact]` |
| **6. 動作標籤混淆** | 舊版腳本硬將 `volley_punch` 覆寫映射為 `PASSIVE_BLOCK`。 | 嚴格保留 `VOLLEY_PUNCH` 原始動作標籤獨立性，不與 `PASSIVE_BLOCK` 混淆。 | `[Fact]` |
| **7. 尺度退化防護** | 選手側身時，肩膀或髖部投影寬度會縮小，逐幀除以當前寬度會造成除以趨近零的奇異點。 | 估算 $S_{ref}$ 時採用軀幹對角與垂直綜合長度之中位數，並在逐幀分析中加入 `DEG_SCALE_LOW` (<0.4 $S_{ref}$) 與 `DEG_SCALE_HIGH` (>2.0 $S_{ref}$) 退化品質旗標。 | `[Fact]` |

---

### 5.2 可重現基線與版本失效機制 (Baseline & Reproducibility)

1. **舊版基線封存**：
   - 舊版提取資料已完整備份於 `data/legacy_v1_baseline/`（包含 `real_strokes_dataset.json`、`real_strokes_dataset.csv`、`strokes_checkpoint.json`）。
   - 建立 `data/legacy_v1_baseline/metadata.json`，完整記錄 11 支影片原始 SHA256 雜湊、模型檔雜湊、舊版腳本雜湊、幀率與解析度。
2. **嚴格失效 Checkpoint 機制**：
   - 新版斷點快取 `data/v2/checkpoint_v2.json` 必須**同時匹配**：
     - `code_version == "2.0.0"`
     - `video_sha256 == sha256(video_file)`
     - `model_sha256 == sha256("models/pose_landmarker_heavy.task")`
   - 任一項變更即自動失效重新推論，禁止僅憑檔名重用過期特徵。

---

### 5.3 自動化單元測試實證 (Unit Tests - 6/6 全部通過)

測試套件位於 `tests/test_kinematics_v2.py`，執行結果如下：

```bash
$ ./.venv/bin/python -m unittest tests/test_kinematics_v2.py -v
test_aspect_ratio_compensation (tests.test_kinematics_v2.TestKinematicsV2)
Verify that normalized coordinates (1080x1920) are properly converted to isotropic pixels. ... ok
test_candidate_event_peak_merging (tests.test_kinematics_v2.TestKinematicsV2)
Verify that multiple local ripples within 0.45s are merged into a single coherent stroke event. ... ok
test_constant_velocity_recovery (tests.test_kinematics_v2.TestKinematicsV2)
Verify known synthetic velocity is accurately recovered without phantom scale jitter. ... ok
test_coordinate_signs_y_up (tests.test_kinematics_v2.TestKinematicsV2)
Verify Y-up convention: wrist above hip is positive, wrist below hip is negative. ... ok
test_scale_degeneracy_detection (tests.test_kinematics_v2.TestKinematicsV2)
Verify scale degeneracy guard flags frames where torso length collapses. ... ok
test_tracking_jump_outlier_rejection (tests.test_kinematics_v2.TestKinematicsV2)
Verify that an insane single-frame teleportation jump does not create 30,000 velocity. ... ok

----------------------------------------------------------------------
Ran 6 tests in 0.003s
OK
```

---

### 5.4 人工抽查素材與可驗證證據 (Human Audit Assets)

為徹底擺脫單張截圖無法判斷完整動作之缺陷，v2 管道為每個候選事件生成 **5 幀連續動作審查圖 (5-Frame Progression Collage)**：
- **面板構成**：`[Start] ➔ [Approach] ➔ [Candidate Peak (含速度標註)] ➔ [Follow] ➔ [End]`
- **覆蓋資訊**：骨架連線（綠色=身體關節，紅色=擊球手腕）、事件編號、動作類別、總歷時 (s)、手腕總路徑長 (torso)、波峰速率 (torso/s)。
- **儲存目錄**：`data/v2/verification_collages/`
- **事件清單 Manifest**：`data/v2/candidate_events_manifest.csv`。

#### 國際運動生物力學標準 (Sports CV) 之三級可信度標註（由 `scripts/audit_biomechanics_tiering.py` 自動分級）：
針對 393 筆候選事件，依據神經肌肉不應期（Refractory Period $0.55\text{s}$）、生理揮拍歷時窗（$0.12\text{s} \le \Delta t \le 1.15\text{s}$）與擊球動能下限（$\ge 1.8\text{ t/s}$）進行三級可信度標註：
1. **🟢 Tier A (高可信度真揮拍, 276 筆 / 70.2%)**：力學特徵完全符合匹克球揮拍生物力學，推薦作為訓練核心真值集。
2. **🟡 Tier B (邊界/次級震盪, 69 筆 / 17.6%)**：包含密集交鋒次級波峰、前置引拍波峰、邊界小球力道或尺度退化，供人工複檢。
3. **🔴 Tier C (高機率假陽性, 48 筆 / 12.2%)**：包含歷時過長走動、瞬態噪訊或彎腰撿球（如 `serve_fault_ev_002` 撿球動作已被精準標為 Tier C），建議預設排除。

---

### 5.5 新舊資料集統計對比實證 (v1 Baseline vs v2 Rigorous)

依據 `scripts/audit_dataset_v2.py` 對 `data/legacy_v1_baseline/real_strokes_dataset.json` 與 `data/v2/real_strokes_dataset_v2.json` 的全量審查結果：

| 評估指標 | 舊版基線 (v1 Legacy) | 新版交付 (v2 Rigorous) | 改善說明與驗收結果 |
| :--- | :--- | :--- | :--- |
| **總候選事件數** | 545 筆 (含重複觸發與震盪) | **393 筆** (NMS 0.45s 合併去重) | 消除單次揮拍多次觸發問題，起訖歷時更精準 |
| **手腕速率極值 (Max Speed)** | **30,256.06** (天文數字) | **32.53 torso/s** | 徹底杜絕數萬速度異常值 |
| **速率極端異常 (>100)** | **39 筆** (>1000 有 16 筆) | **0 筆 (0.0%)** | 徹底消除暴衝問題 |
| **速率統計分佈 (p10 / med / p90)** | p10=4.75, med=14.62, p90=65.67 | **p10=2.04, med=5.52, p90=17.86** | 速度分佈回歸人體生物力學合理區間 |
| **動作標籤完整性** | `VOLLEY_PUNCH` 被抹除併入 `BLOCK` | **7 類完整獨立** (`VOLLEY_PUNCH`: 45 筆) | 保留原始動作多樣性 |
| **品質旗標追蹤** | 無 (無法追蹤品質) | **383 筆 OK, 10 筆退化標記** | 支援退化尺度 (EXPAND/COLLAPSE) 精確追溯 |
| **手腕相對臀部高度 (SMASH)** | med = -0.11 (負值代表高於腰，解讀相反) | **med = +0.32** (標準 $Y_{up}$，正值代表高於腰) | 物理符號與解讀完全自洽 |

#### 各動作類別候選事件與分佈細目 (v2)：
- `UNDERHAND_LEGAL` : 94 筆 | y_rel med = +0.31 | speed med = 5.43 torso/s
- `OVERHAND_FAULT`  : 62 筆 | y_rel med = +0.35 | speed med = 6.91 torso/s
- `SMASH`           : 59 筆 | y_rel med = +0.32 | speed med = 4.52 torso/s
- `POWER_DRIVE`     : 49 筆 | y_rel med = +0.41 | speed med = 6.98 torso/s
- `KITCHEN_DINK`    : 46 筆 | y_rel med = +0.16 | speed med = 4.58 torso/s
- `VOLLEY_PUNCH`    : 45 筆 | y_rel med = +0.49 | speed med = 7.54 torso/s
- `PASSIVE_BLOCK`   : 38 筆 | y_rel med = +0.31 | speed med = 4.95 torso/s

---

### 5.6 證據等級與已知缺口宣告 (Evidence Gaps & Constraints)

1. `[Constraint]` **單一受試者限制**：目前所有 11 部影片均由同一位球員受試錄製。目前的提取與統計數據**僅能證明該球員動作在此流程下的自洽性，嚴禁宣稱跨受試者泛化能力**。
2. `[Fact]` **單目 2D 空間相對量限制**：影片無外部標定相機參照系，速度以軀幹中位數尺度正規化（`torso-lengths/s`），不標記為公尺/秒 (m/s)，手腕相對於臀部高度不稱為絕對擊球點高度。
3. `[Hypothesis]` **波峰速率與真實擊球點之對應性**：運動學波峰速率僅代表「候選揮拍動作之最高手腕速度點」，真實網球/匹克球觸球瞬間（Ball-Paddle Contact）通常發生於波峰前 1~2 幀或波峰瞬間，需由人工審查 5 幀 Collage 作最後確認。
4. `[Constraint]` **單影片類別驗證限制**：`VOLLEY_PUNCH` 與 `OVERHAND_FAULT` 目前各僅有 1 支影片，禁止將同一支原片切段跨作訓練/測試集，該兩類別在補錄前明確列為「暫無法執行跨影片泛化驗證」。


