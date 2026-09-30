const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '../v14.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const passportHtml = `
            <!-- 頁籤 1: 選手證與成就 (預設展開) -->
            <div id="passport-tab-content" style="display:block;">
                <div class="passport-card">
                    <div class="passport-header">
                        <div class="passport-avatar" id="passport-avatar-display">😎</div>
                        <div class="passport-info">
                            <h3 id="passport-name-display">興大匹克球神</h3>
                            <div class="passport-dept" id="passport-dept-display">未設定系所 · 國立中興大學</div>
                            <div class="passport-level-box">
                                <div class="level-badge">Lv <span id="passport-level-num">1</span></div>
                                <div class="exp-bar-container"><div class="exp-bar-fill" style="width: 25%;"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="achievements-section">
                        <h4>🏅 特殊成就徽章</h4>
                        <div class="achievements-grid">
                            <div class="achievement-badge locked" title="完成 10 場對牆特訓">🧱 牆島大師</div>
                            <div class="achievement-badge" title="戰勝中興黑天鵝">🦢 降鵝勇士</div>
                            <div class="achievement-badge" title="完成隱藏挑戰：揚州炒飯 (中興大學傳說彩蛋！)">🍚 揚州炒飯大師</div>
                            <div class="achievement-badge locked" title="解鎖全部科普卡片">📚 科普學者</div>
                        </div>
                    </div>
                </div>
            </div>`;

html = html.replace(/<!-- 頁籤 1: 選手證與成就 \(預設展開\) -->\s*<div id="passport-tab-content" style="display:block;"><\/div>/, passportHtml);
fs.writeFileSync(htmlPath, html);
console.log("Injected passport HTML!");
