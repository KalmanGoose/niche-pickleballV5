
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
