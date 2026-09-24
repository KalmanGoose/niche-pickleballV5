# 匹克球雲端後端與資安代理部署指引

本指引協助您將全新加固版的 **Google Apps Script 後端** 與 **Cloudflare Worker 安全代理** 部署上線。

---

## 步驟 1：更新 Google Sheets 後端 (`backend/Code.gs`)

此步驟強化 Google Sheets 後端的資料庫寫入安全（加入防重放攻擊、試算表併發排他鎖、成績物理邊界檢驗）：

1. 打開您的 Google 試算表（也就是存放玩家戰績與英雄榜的試算表）。
2. 點選頂部功能表：**「擴充功能」➔「Apps Script」**。
3. 將編輯器內原有的程式碼全部清除，複製本專案 [`backend/Code.gs`](./Code.gs) 的全部代碼並貼上。
4. 點擊編輯器上方的 💾「儲存專案」圖示。
5. 專案設定 ➔ 指令碼屬性 ➔ 新增 `SIGN_SECRET`，值為自行產生的隨機字串。
6. 點擊右上角藍色的 **「部署」➔「新增部署作業」**，複製新的 `/exec` 網址，並在「管理部署作業」中**封存舊部署**。
7. 完成！現在您的 Google Sheets 資料庫已具備完整併發防護與防刷榜機制。

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
     - `SIGN_SECRET`：與 GAS 指令碼屬性相同的隨機字串
   - 點擊儲存。
6. 複製該 Worker 的公開網址（格式類似 `https://nchu-pickleball-proxy.your-account.workers.dev`）。

---

## 步驟 3：前端切換至代理模式 (全資安防護生效)

1. 開啟專案中的 `js/config.js`，將複製的 Worker 網址填入 `PROXY_URL`：
   ```javascript
   const PROXY_URL = 'https://nchu-pickleball-proxy.your-account.workers.dev';
   ```
2. 執行單檔編譯與同步：
   ```bash
   node scripts/build-single.js
   ```
3. 提交並推送到 GitHub：
   ```bash
   git add . && git commit -m "feat: switch to cloudflare worker proxy" && git push
   ```
4. **生效成果**：
   - 瀏覽器端再也看不到真實的 `GAS_URL` 與 `SIGN_SECRET`。
   - 享有 Cloudflare 全球 CDN 快取（排行榜 15 秒秒開）。
   - 享有單一 IP 每分鐘頻率限制與 WAF 阻擋惡意爬蟲，防止冒用他人身分與提交超出範圍的分數！
