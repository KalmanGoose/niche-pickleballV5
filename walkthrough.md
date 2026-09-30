
## 第 17 階段：UI 排版、科普卡片抽屜化與個人成就彩蛋 (v5.9.0)
**變更摘要**：
- **防溢出排版修復**：修正 `#referee-announcement` (裁判廣播) 與 `.ac-bubble` (小動物對話框) 的 CSS `word-break: break-word` 與 `white-space: pre-wrap`，杜絕手機版字體炸出版面。
- **科普卡片收納化 (Accordion)**：將物理學與果蠅大腦的詳細解說區塊全面轉換為 HTML5 `<details>` 與 `<summary>` 的抽屜式展開結構。所有主題預設收合，並優化了 `G I A N T (aka 捷安特腳踏車神經)` 的趣味彩蛋，提升可讀性與趣味性。
- **個人專屬設定大升級 (Passport & Achievements)**：為個人檔案 Modal 注入了更精緻的「島民選手證」版面。現在點開後會顯示：
  1. 玩家自選大頭人偶 (Avatar)
  2. 根據擊球次數計算的虛擬等級 (Level)
  3. 成就徽章系統，並埋入了中興大學在地彩蛋「🍚 揚州炒飯大師」。
- **大廳 Typography 優化**：優化了「快速進入球場」上方的名字與系所字體粗細與對比度 (`#quick-nickname`, `#quick-dept`)。
- **觸覺震動深度確認**：確認擊球震動 (`Haptic.hit()`) 已與「系統設定」內的 `pref-vibrate` 切換開關完美整合。
- **零隱患全域事件綁定**：將 67 個 HTML 內聯 `onclick` 事件函數強制顯式掛載於 `window` 物件，確保在 Safari 極端環境或網路載入順序不一的情況下，絕不拋出 `ReferenceError`。

**測試驗證**：
1. 透過 Node.js 進行最嚴格的 Strict Mode 沙盒模擬載入，無任何未宣告變數報錯。
2. `node scripts/self-test.js` 全數 99 項測試 100% 通過。

## 第 18 階段：個人公仔輕量化、PWA離線球場、語音裁判與中興湖環境物理 (v5.9.1)
**變更摘要**：
- **個人檔案 3D 公仔徹底移除**：依照要求，砍除 `js/profile_card.js` 中龐大的 `ThreeMiniDoll` 次級 WebGL 場景與雙模切換鈕，全面回歸純淨、零 GPU 負擔的 2D 手繪島民選手風格，節省超過 200 行代碼與大幅降低行動裝置記憶體。
- **PWA 離線快取支援 (Service Worker & Manifest)**：
  - 新增根目錄 `sw.js` 與 `manifest.json`。
  - 將 3D 核心庫、MediaPipe 體感權重、圖檔音效與主程式全面納入快取，支援戶外斷網 100% 離線開啟與手機「加入主畫面」全螢幕安裝。
- **體感 3 公尺巨無霸 HUD (Distant / TV Mode)**：
  - 開啟相機體感時，自動切換 `body.distant-hud-active` 巨無霸視野。
  - 比分與裁判判決膠囊放大 1.35x ~ 1.7x，高對比陰影，保證玩家後退 2~3 米揮拍依然清晰可讀。
- **語音裁判大聲公 (Web Speech API TTS)**：
  - 於 `js/audio.js` 實裝 `speakReferee(text)`，判決出界、換發球或得分時由手機即時人聲朗讀。
  - 於系統音效設定新增 `📢 語音裁判大聲公` 開關與「試聽語音」功能。
- **動力鏈防抖作弊檢測 (Kinetic Chain Anti-Wiggle Guard)**：
  - 在 `js/social.js` 捕捉揮拍時，檢測手腕位移與肩肘角速度。若判定為靠近鏡頭純抖手腕，強制壓制球速並提示「請帶動肩膀與腰腹動力鏈完整揮拍」。
- **動態熱管理 (Thermal Eco Mode)**：
  - 於 `js/game.js` 實裝滾動 FPS 監控。若體感模式下畫面掉幀超過門檻，自動啟動 Eco Mode 降頻 MediaPipe 與關閉即時陰影，防止夏天戶外 iPhone 過熱降頻。
- **中興湖真實時間光影 (Real-Time Day/Night/Sunset)**：
  - 依據玩家真實時間自動切換：06:00~10:30 晨曦朝陽、10:30~16:30 正午艷陽、16:30~18:45 黃昏晚霞、18:45~06:00 夜間球場 4 盞高亮四角探照燈。
- **中興湖穿孔球微風物理 (Wind Vector Aerodynamics)**：
  - 在 `js/physics.js` 實裝微風向量 `WIND`，計算多孔穿透阻力產生的自然微風偏轉，並於頂部藥丸旁增設即時風向風速儀 (`#wind-hud`)。

**測試驗證**：
1. `node scripts/build-single.js` 單檔打包無誤。
2. `node scripts/strict-check.js` 嚴格模式 0 未宣告變數。
3. `node scripts/self-test.js` 全數 99 項測試 100% 通過。
4. `node scripts/physics-sim.js` 82 項物理動力學全數 PASS。
5. `node scripts/benchmark-performance.js` 10,000 幀極限效能零洩漏全數 PASS。
6. `git grep "動森"` 檢測：0 殘留。
