# 匹克球 N-GO (Pickleball N-GO) 專案交接手冊 (Handover Document for GPT / AI Assistant)

> **文件目的**：提供給接續開發的 AI Agent (如 ChatGPT / GPT-4o / Codex 等) 或工程師快速理解專案全貌、架構職責、最新進度、嚴格禁忌與接續開發指引。
> **更新時間**：2026-10-23
> **目前分支**：`integration/mobile-goose-v1` (HEAD: `c18287c`)
> **自我檢測狀態**：`node scripts/self-test.js` ➡️ **99/99 全數 PASS (100%)**

---

## 一、 專案核心定位與技術棧

本專案名為 **「匹克球 N-GO」 (Pickleball N-GO)**，以國立中興大學 (NCHU) 校園與中興湖為背景，是一款專為**手機瀏覽器與行動裝置**設計的高效能 3D 匹克球體感/觸控網頁遊戲。

### 核心技術棧
- **3D 引擎**：Three.js r128（原生 WebGL，嚴格鎖定 SRI 安全雜湊防禦供應鏈漏洞）。
- **物理與碰撞引擎**：自研純 JS 向量動力學（支援重力、空氣阻力、馬格努斯側旋香蕉球、Swept CCD 防高速穿透連續碰撞檢測）。
- **規則與裁判系統**：100% 依循 **USA Pickleball 官方單打規則**（發球規則、換發球 Side-out、廚房區 Non-Volley Zone 截擊違例判定、雙跳原則）。
- **AI 戰術大腦**：普林斯頓大學 FlyWire 果蠅大腦全腦連接組 (LIF-A 突觸傳遞模型) + `TinyPicklePolicy` 戰術小模型，驅動對手 AI 進行第三桿放短 (Third Shot Drop)、直線抽擊 (Drive) 與高吊球 (Lob)。
- **3D 角色與骨骼動畫**：Blender 導出的 21 骨骼標準 Rigged GLB 模型（中興村長匹克鵝、冠軍黑天鵝），支援 `Idle`、`Walk`、`Run`、`Swing` 四段動作混合與右腕掛拍 (`PaddleSocket.R`)。
- **體感辨識 (選用)**：MediaPipe Pose 33 關節點動態體感捕捉（與主遊戲解耦，無鏡頭亦可純虛擬搖桿流暢遊玩）。
- **音效與回饋**：Web Audio API 純代碼合成聲效 + 行動端 Haptic Vibration 4 段式震動。

---

## 二、 雙 GitHub 倉庫與線上網址

專案目前同時維護並自動同步於兩個 GitHub 倉庫：

| 倉庫名稱 | 遠端別名 | 倉庫 URL | 線上 GitHub Pages 測試網址 |
| :--- | :--- | :--- | :--- |
| **V8 獨立倉庫** | `v8` | `https://github.com/KalmanGoose/pickleball-ngo-v8.git` | [https://kalmangoose.github.io/pickleball-ngo-v8/](https://kalmangoose.github.io/pickleball-ngo-v8/) |
| **主要發布倉庫** | `origin` | `https://github.com/KalmanGoose/niche-pickleballV5.git` | [https://kalmangoose.github.io/niche-pickleballV5/](https://kalmangoose.github.io/niche-pickleballV5/) |
| **3D 角色獨立展廳** | - | `tools/character-preview/index.html` | [https://kalmangoose.github.io/pickleball-ngo-v8/tools/character-preview/](https://kalmangoose.github.io/pickleball-ngo-v8/tools/character-preview/) |

> **分支策略**：
> - `main`：正式穩定發布分支。
> - `gh-pages`：GitHub Pages 靜態站點託管分支。
> - `integration/mobile-goose-v1`：目前功能整合主幹。

---

## 三、 目錄結構與模組職責說明

```text
匹克球N-GO.v1/
├── v14.html                     # [核心入口] 模組化開發主 HTML (包含 DOM 結構與 Modal 宣告)
├── index.html                   # [發布產物] GitHub Pages 預設入口 (由 build-single.js 產出，勿手改)
├── v14-single.html              # [單檔產物] 行動端離線單檔版本 (由 build-single.js 產出，勿手改)
├── js/
│   ├── config.js                # 全域常數、關卡 1~7 數值、防注入安全過濾器 (escapeHtml)、後端錯誤對照
│   ├── physics.js               # 物理引擎：重力、空氣阻力、Magnus 側旋力學、網子碰撞、Swept CCD
│   ├── referee.js               # 裁判系統：發球權輪替 (Side-out)、雙跳原則、廚房區踩線判決、計分廣播
│   ├── game.js                  # [核心大腦] Three.js 場景/相機/燈光、GLTF 載入、骨骼狀態機、主迴圈、拍立得截圖
│   ├── ui.js                    # UI 事件控制器：虛擬搖桿、角色切換彈窗、難度選單、NookPhone 抽屜
│   ├── audio.js                 # Web Audio API 聲效合成、Haptic 震動控制器
│   ├── fly_connectome.js        # 普林斯頓 FlyWire 2024 果蠅大腦 LIF-A 突觸類神經網路
│   ├── pickle_neural_policy.js  # 輕量戰術決策網路 TinyPicklePolicy
│   ├── hub_sandbox.js           # 2.5D 中興湖導覽大地圖微視差畫布
│   ├── social.js                # 社群連結、學號/系所資料持久化、成就徽章
│   ├── motion.js                # MediaPipe 33 點人體骨架視覺辨識 (已安全隔離)
│   └── fun_mode.js              # 趣味對牆特訓 (Practice Wall) 與道具機制
├── css/
│   ├── style.css                # 基礎排版與色調
│   ├── hud.css                  # 遊戲 HUD、裁判廣播藥丸、虛擬搖桿、頂部導航
│   └── modals.css               # 所有彈窗樣式 (角色選擇、大地圖、拍立得、設定手冊)
├── models/
│   └── characters/
│       ├── pickler_goose_mobile.glb # 3.48 MB, 63,642 面, 21 骨, 4 段動作 (中興村長匹克鵝)
│       └── black_swan_mobile.glb    # 3.19 MB, 58,390 面, 21 骨, 4 段動作 (冠軍黑天鵝)
├── tools/
│   └── character-preview/       # 獨立 3D 骨架模型展示器 (含相機旋轉、動作切換、骨骼測試)
└── scripts/
    ├── build-single.js          # 自動打包腳本：將 CSS/JS/模型注入為單一 html
    └── self-test.js             # 99 項自動化回歸測試 (含 OWASP、物理 CCD、效能基準)
```

---

## 四、 雙模式打包機制 (重要！)

本專案採用**模組化開發 + 自動打包發布**工作流：
1. **開發時**：僅修改 `v14.html`、`js/*.js`、`css/*.css`。
2. **打包發布**：執行 `node scripts/build-single.js`。
   - 腳本會自動將 CSS 與 JS 壓縮打包，內嵌為獨立單檔 `v14-single.html`。
   - 腳本會自動同步複製 `v14-single.html` 到根目錄的 `index.html`。
3. **驗證檢測**：執行 `node scripts/self-test.js` 確保 99/99 項測試全過。

> ⚠️ **開發禁忌**：
> - **絕對不要手動編輯 `index.html` 或 `v14-single.html`**！一旦手動編輯，下次執行 build-single 就會被覆蓋遺失。
> - 一律先改 `js/`、`css/`、`v14.html`，再執行 `node scripts/build-single.js`。

---

## 五、 近期已完成的關鍵功能與架構

1. **出戰角色自選系統 (`#char-picker-modal`)**：
   - 玩家可自由挑選：👦 **興大陽光球員**、🪿 **中興村長匹克鵝**、🦢 **冠軍匹克黑天鵝**。
   - 記憶存入 `localStorage` (`nchu_player_char`)，換關或重開自動保持。
2. **玩家 3D 骨骼模型與動作驅動**：
   - 玩家與 AI 對手各自擁有獨立的 `AnimationMixer`。
   - 玩家模型掛入 `pGrp`，面向球場對手側（`root.rotation.y = Math.PI`）。
   - 動作依搖桿移動速度無縫過渡（`Idle` 靜止、`Walk` 慢走、`Run` 衝刺）；發球與擊球瞬間播放 `Swing` 單次揮拍動畫後平滑淡回。
3. **視角系統**：
   - 支援 3 種視角：標準追隨視角 (Follow)、俯瞰等角 (Isometric)、**104° 超廣角第一人稱 (First-Person)**。
4. **球場 3D 果蠅示波器看板**：
   - 普林斯頓 FlyWire 神經脈衝示波器以 3D 廣告看板形式固定在球場邊緣圍網，真實融入球場環境。
5. **資安漏洞徹底防禦**：
   - Three.js 導入全數加註 SRI 完整性校驗與防竄改機制。
   - 徹底移除未過濾的字串拼接，杜絕 XSS 與試算表注入漏洞。
   - 移除「破風手」舊文案，維護品牌一致性。

---

## 六、 關鍵技術細節與防坑指南 (Gotchas)

1. **Three.js r128 骨骼名稱去點問題**：
   - r128 載入 GLTF 時，若骨骼名稱帶有小數點（如 `PaddleSocket.R`），引擎常會自動轉為 `PaddleSocketR`。
   - 請統一呼叫 `findBone(root, targetName)`，該函式同時檢驗 `node.name` 與 `node.userData.name`，可確保精準取得骨骼節點掛載球拍。
2. **物理碰撞與視覺模型分離**：
   - 揮拍命中判定由不可見的幾何碰撞球/片代理 (`pad` 與 `gPad`) 負責，其座標精確跟隨玩家/對手位置。
   - **請勿使用 SkinnedMesh 頂點進行即時球體物理碰撞**，那會導致嚴重卡頓與判定抖動。
3. **Git 操作守則**：
   - **禁止使用 `git add .`**！工作區可能包含使用者本機的測試影片 (`data/videos/`)、Python 虛擬環境 (`.venv/`) 或未追蹤數據。
   - 請明確使用 `git add <檔案路徑>`。

---

## 七、 接續開發建議清單 (Next Steps)

若接續的 GPT / 工程師需要繼續推進功能，建議依序進行：

1. **MediaPipe 33 點體感骨架強化**：
   - 目前體感骨架已安全解耦（不影響無相機玩家）。下一階段可將玩家視訊捕捉到的手臂揮動角度，直接映射到 3D 模型的上臂/前臂骨骼旋轉量，實現「真人体感即時鏡像」。
2. **數值等級與解鎖系統**：
   - 建立球員升級曲線（球速、跑速、體力條、專屬技能），並在過關或完賽時給予經驗值與金幣獎勵。
3. **Unity 整合評估**：
   - 本專案目前基於輕量 WebGL (Three.js)，載入速度在手機端為毫秒級 (< 500KB 程式碼 + 3MB 模型)。
   - 若未來需採用 Unity，建議以 **Unity WebGL Build** 或 **Flutter / React Native 封裝 App** 方式整合，或維持現有 Three.js 架構以保有免安裝、跨平台隨開即玩的優勢。
