# 匹克球雲端後端與資安代理部署指引

本指引協助您將全新加固版的 **Google Apps Script 後端** 與 **Cloudflare Worker 安全代理** 部署上線。

---

## 步驟 1：建立全新 Google 試算表與後端 (`backend/Code.gs`)

此步驟強化 Google Sheets 後端的資料庫寫入安全（加入防重放攻擊、試算表併發排他鎖、成績物理邊界檢驗、純文字格式防注入）：

1. 建立一份**全新的 Google 試算表**（New Spreadsheet，命名如 `NCHU_Pickleball_v5.1_DB`），以隔離全新 schema 與測試資料，避免影響舊資料。
2. 點選試算表頂部功能表：**「擴充功能」➔「Apps Script」**。
   - ⚠️ **重要**：GAS **必須**從試算表內建選單建立（容器綁定專案）。因為程式碼使用 `SpreadsheetApp.getActiveSpreadsheet()`，獨立的 GAS 專案會回傳 `null` 而引發錯誤。
3. 檢查試算表時區：點選試算表功能表 **「檔案」➔「設定」**，確認時區設定為 **「(GMT+08:00) 台北」**（`Asia/Taipei`），以確保每日按讚與計分日期比對精準一致。
4. 將編輯器內原有的程式碼全部清除，複製本專案 [`backend/Code.gs`](./Code.gs) 的全部代碼並貼上。
5. 點擊編輯器上方的 💾「儲存專案」圖示。
6. 專案設定 ➔ 指令碼屬性 ➔ 新增 `SIGN_SECRET`，值為自行產生的隨機字串（至少 32 字元，例如使用 `openssl rand -hex 32` 或密碼產生器）。
7. 在編輯器上方函式下拉選單中選擇 `setupTextFormats`，點擊「執行」，完成試算表 4 個工作表的儲存格文字格式預設（`@`），防止試算表自動將字串誤轉為數字或公式。
8. 點擊右上角藍色的 **「部署」➔「新增部署作業」**：
   - 種類選「網頁應用程式 (Web App)」
   - 執行身分：**「我 (Me)」**
   - 誰可以存取：**「任何人 (Anyone)」**（⚠️ 務必選「任何人」，若選「擁有 Google 帳戶的使用者」，Worker 將收到 Google 登入頁面 HTML，前端會出現 `BAD_RESPONSE`）
   - 複製產生的 Web App `/exec` 網址。
   - ⚠️ **重要版本更新提醒**：日後每次修改 `Code.gs`，都必須到「管理部署作業」➔「編輯」➔「版本」選**「新版本」**儲存，否則線上執行的永遠是舊程式。
   - ⚠️ **部署安全順序：先不要封存舊 GAS 部署！** 待 v6 實測通過並合併至 main 之後，再封存舊部署，避免線上服務中斷。
9. 完成！現在您的 Google Sheets 資料庫已具備完整併發防護、純文字格式化與防刷榜機制。

---

## 步驟 2：部署 Cloudflare Worker 反向代理 (`backend/cloudflare-worker.js`)
*(強烈推薦，永久免費且不需要綁信用卡，徹底隱藏 Google 端點與金鑰)*

1. 前往 [Cloudflare 儀表板](https://dash.cloudflare.com/) 登入或免費註冊帳號。
2. 在左側導航列點擊 **「Workers 和 Pages」➔「建立應用程式」➔「建立 Worker」**。
3. 為 Worker 命名（例如 `nchu-pickleball-proxy`），點擊右下角 **「部署」**。
4. 部署成功後，點擊 **「編輯代碼 (Edit code)」**：
   - 將預設代碼全部清空。
   - 複製本專案 [`backend/cloudflare-worker.js`](./cloudflare-worker.js) 的全部內容並貼上。
   - 點擊右上角 **「儲存並部署 (Save and Deploy)」**。
5. 設定環境變數（機密金鑰隔離）：
   - 點擊左上角返回 Worker 管理頁面，點選 **「設定 (Settings)」➔「變數與機密 (Variables and Secrets)」**。
   - `GAS_URL` 與 `SIGN_SECRET` **都**用「新增機密 (Add Secret)」：
     - `GAS_URL`：您的 Google Apps Script `/exec` 網址
     - `SIGN_SECRET`：與 GAS 指令碼屬性完全相同的隨機字串
   - 點擊儲存。
6. 複製該 Worker 的公開網址（格式類似 `https://nchu-pickleball-proxy.your-account.workers.dev`）。

---

## 步驟 3：前端切換至代理模式與連線驗證

1. 開啟專案中的 `js/config.js`，將複製的 Worker 網址填入 `PROXY_URL`：
   ```javascript
   const PROXY_URL = 'https://nchu-pickleball-proxy.your-account.workers.dev';
   ```
2. 執行單檔編譯與同步：
   ```bash
   node scripts/build-single.js
   ```
3. **部署驗證**：
   - 在瀏覽器或終端機測試 Worker 端點：`curl -s "https://nchu-pickleball-proxy.your-account.workers.dev?act=ping"`，確認回傳 `{"ok":true,"msg":"pong"}` 或等價 ping 回應。
   - 從本機環境（localhost）開啟遊戲，進行一次快速球員登錄或修改暱稱（`updateProfile`）。
   - 若回傳 `INVALID_SIGNATURE`，代表 Worker 端與 GAS 指令碼屬性的 `SIGN_SECRET` 不一致，請確認兩邊完全相同。
   - 本驗證亦順便確認了 Cloudflare Worker 能夠正確跟隨 GAS 的 302 重導向並取回資料。
4. 提交並推送到 GitHub：
   ```bash
   git add . && git commit -m "feat: switch to cloudflare worker proxy" && git push
   ```
5. **資安架構聲明**：
   - 瀏覽器端再也看不到真實的 `GAS_URL` 與 `SIGN_SECRET`。
   - 享有單一 IP 每分鐘 120/240 次、單一 playerId 每分鐘 15 次的頻率限制與 40 KB Payload 防護。
   - ⚠️ **關於 Origin 白名單**：Origin 白名單僅由瀏覽器保證，防範惡意跨站腳本呼叫，但用 curl 等工具仍可偽造 Origin 標頭。因此系統**真正的安全性完全依賴私密 token 與後端 HMAC 簽章驗證**，而非僅靠 Origin 白名單。
