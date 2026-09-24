# NCHU Pickleball 交接檔

> 每次開始工作前先讀這份。改完程式後更新「進度」與「待辦」。
> ⚠️ 本檔禁止寫入任何金鑰、token、GAS 網址、Worker 網址。

## 1. 專案結構（不常變）
- 來源檔：`v14.html`（模板）、`css/*.css`、`js/*.js`、`scripts/`、`backend/`
- 打包產物（不要手改）：`index.html`、`v14-single.html`
- 打包：`node scripts/build-single.js`（含語法檢查，失敗會顯示檔名與行號）
- JS 合併順序：config → audio → physics → referee → motion → ui → social → fly_connectome → fun_mode → game
- 注意：`ui.js`、`social.js` 頂層不可同步呼叫用到 `TEACH`、`scene`、`ball` 的函式（TDZ）

## 2. 分工
- 改程式、打包、測試：Antigravity
- Review、設計修法：Claude（無法存取 repo，只看貼上的內容）
- 規格來源：`FIX_PLAN_v5.1.0.md`

## 3. 進度（依 FIX_PLAN 章節）
| 章節 | 狀態 | 備註 |
|---|---|---|
| A1 physics.js | 🔧 已實作 | 雙模式（FAST/ACADEMIC）、空氣動力常數、Symplectic Euler |
| A2 build-single.js | 🔧 已實作 | 支援 vm.Script 語法檢查、重複函式警示、自動同步 index.html |
| A3 Worker / A4 Code.gs | 🔧 已實作 | 代碼已替換為 v3.0 HMAC 簽章代理、防重放、排他鎖；部署另見 Part C |
| B1 game.js | ✅ 已 review | 含 solveArc 分流、RWD 尺寸綁定、示範修復、gooseErrorHit、離線 apiWarn 與分數關卡檢查 |
| B2 ui.js | ✅ 已 review | U1~U4 均完成，TOUR_STEPS 站台描述與 IG 欄位已修正 |
| B3 motion.js | 🔧 已實作 | applyPerfPreset 加入 ren.setPixelRatio(dpr) |
| B4 social.js | 🔧 已實作 | S1~S6 完成，IG 格式驗證與按鈕切換、recentShots slice(-10) |
| B5 fun_mode.js | 🔧 已實作 | F1~F4 完成，本機開發限定、MEGA_BALL 顏色復原、示波器連動 |
| B6 config.js | 🔧 已實作 | C1~C7 完成，Worker 代理與 token 機制、APP_VERSION v5.1.0 |
| B7 CSS | 🔧 已實作 | hud.css body.login-open、style.css user-select、modals.css 只刪 bottom/left 保留 position:absolute |
| B8 v14.html | 🔧 已實作 | 黃框更新為簡練版「理論方程式 vs. 實際程式實作」與模型限制 |
| B9 文件 | 🔧 已實作 | DEPLOY_GUIDE.md 與 整合報告.md 詞彙修訂 |
| 打包 | ✅ 語法檢查通過（見第 6 節） | 通過 Node.js vm.Script 語法檢查，v14-single.html 與 index.html 已同步 |
| Part C 人工部署 | ⏳ 待人工執行 | 產生金鑰、GAS 指令碼屬性設定、Worker Secret 設定與填入 PROXY_URL |
| Part D 手機實測 | ⏳ 待實測 | 待部署後進行手機端遊玩手感與排行榜聯網測試 |

## 4. 待辦（依優先順序）
1. 給 Claude review `config.js`（只需 C1、C3～C6 相關函式：`PROXY_URL`、`API_READY`、`getOrCreateToken`、`postSigned`、`apiGet`、`handleQuickStart`、`handleLogin`、`openProfileModal`、`saveProfile`）
2. 在 v6 分支完成 Part C 部署（**先不要封存舊 GAS 部署**）
3. 在 v6 預覽環境執行 Part D 測試
4. 測試通過後合併 v6 → main
5. 合併後才封存舊 GAS 部署，並用 curl 確認舊網址失效

## 5. 已確定的決策（不要推翻）
- FAST 物理模式行為維持原版；ACADEMIC 為展示用
- 金鑰只放 GAS 指令碼屬性與 Worker Secret，前端不可出現
- 玩家身分：公開 playerId + 私密 token（後端只存 SHA-256）
- `v14.html` 是模板，不能刪
- `modals.css` 的 `#speed-hud-mini` 只刪 `bottom`、`left`，保留 `position`
- 前端防禦性檢查：score ≤ 5 且 stage ∈ {5, 6}（與後端規則一致）
- 部署順序：v6 部署與測試 → 合併 main → 最後才封存舊 GAS 部署（避免線上社交功能中斷）
- GitHub Pages 從 main 部署，v6 的修改在合併前不會上線

## 6. 最近一次打包 / 測試紀錄
- **打包指令**：`node scripts/build-single.js`
- **打包輸出**：
  ```
  📦 開始打包…
  ✅ v14-single.html（14025 行）
  ✅ index.html 已同步
  ```
- **逐檔語法檢查**（`node --check`）：
  ```
  OK  js/audio.js
  OK  js/config.js
  OK  js/fly_connectome.js
  OK  js/fun_mode.js
  OK  js/game.js
  OK  js/motion.js
  OK  js/physics.js
  OK  js/referee.js
  OK  js/social.js
  OK  js/ui.js
  OK  backend/cloudflare-worker.js
  OK  backend/Code.gs
  ```
- **備註**：Node.js `vm.Script` 與 `node --check` 僅檢查語法，無法抓到執行期錯誤（例如變數未定義），需靠 Part D 實測。

## 7. 未解問題
- 文獻 [3]～[5] 待人工查證
- 單打第二發球權、英雄榜同分無鑑別度：規則設計問題，尚未決定
