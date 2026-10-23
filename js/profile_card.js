/* ══════════════════════════════════════════════════════════════
   中興大學匹克球 · 個人選手證 (NCHU Island Passport)
   匹克鵝 GLB 展示台、等級經驗值與成就系統 (含揚州炒飯傳奇梗)
   ══════════════════════════════════════════════════════════════ */

(function (window) {
    'use strict';

    let currentProfileTab = 'passport'; // 'passport' | 'edit'
    let threeMini = null; // 3D 匹克鵝展示台實例

    // ── 經驗值與成就資料存取 ──
    const EXP_KEY = 'nchu_player_exp';
    const ACH_KEY = 'nchu_player_achievements';

    function getPlayerExp() {
        try {
            const raw = localStorage.getItem(EXP_KEY);
            return raw ? parseInt(raw, 10) : 2450;
        } catch (e) {
            return 2450;
        }
    }

    function setPlayerExp(exp) {
        try {
            localStorage.setItem(EXP_KEY, String(exp));
        } catch (e) {}
    }

    function getUnlockedAchievements() {
        try {
            const raw = localStorage.getItem(ACH_KEY);
            return raw ? JSON.parse(raw) : ['fried_rice', 'ac_init', 'kitchen_master'];
        } catch (e) {
            return ['fried_rice', 'ac_init', 'kitchen_master'];
        }
    }

    // ── 6 大校園傳奇榮譽成就定義 ──
    const ACHIEVEMENTS_DATA = [
        {
            id: 'fried_rice',
            icon: '🍚',
            title: '揚州炒飯加飯特大盛',
            desc: '吃完這座南門路傳奇炒飯小山，碳水充能 100%，耐力爆表！',
            badge: '中興傳奇'
        },
        {
            id: 'black_swan',
            icon: '🦢',
            title: '黑天鵝的認可',
            desc: '在中興湖畔擊敗村長鵝，獲得黑天鵝引吭高歌應援！',
            badge: '霸主認證'
        },
        {
            id: 'giant_fiber',
            icon: '🚲',
            title: '捷安特神經領航員',
            desc: '重砲反向截擊速度超越仿生蒼蠅 GFS 巨纖維神經公路！',
            badge: '神經破風'
        },
        {
            id: 'kitchen_master',
            icon: '🍳',
            title: '廚房區魔術師',
            desc: '網前連續 5 次極限 Dink 輕推放短不失誤！',
            badge: '手感大師'
        },
        {
            id: 'nchu_student',
            icon: '🎓',
            title: '中興初陣正式生',
            desc: '成功綁定 7 碼中興學號與系所，登錄校園英雄榜！',
            badge: '興大認證'
        },
        {
            id: 'magnus_banana',
            icon: '🌪️',
            title: '馬格努斯狂熱',
            desc: '揮出大弧度繞柱香蕉球 (ATP)，氣流偏折撕裂全場！',
            badge: '流體力學'
        }
    ];

    // ── 依經驗值計算等級與頭銜 ──
    function calcLevelInfo(exp) {
        // 每 300 EXP 一級
        const level = Math.max(1, Math.floor(exp / 300) + 1);
        const curExpInLevel = exp % 300;
        const maxExpInLevel = 300;
        let title = '中興新手球員';
        if (level >= 20) title = 'NCHU 傳奇球王 👑';
        else if (level >= 15) title = '中興神鵝認證搭檔 🦢';
        else if (level >= 10) title = '揚州炒飯碳水戰神 🍚';
        else if (level >= 6) title = '巨纖維捷安特領航員 🚲';
        else if (level >= 3) title = '中興湖巡弋截擊手 🎾';

        return { level, title, curExpInLevel, maxExpInLevel };
    }

    // ══════════════════════════════════════════════════════════════
    // 🎨 2D 手繪動態人偶生成器
    // ══════════════════════════════════════════════════════════════
    function renderPassportView() {
        const exp = getPlayerExp();
        const { level, title, curExpInLevel, maxExpInLevel } = calcLevelInfo(exp);
        const unlocked = getUnlockedAchievements();
        const prof = (window.playerProfile || {});

        const isGuest = (prof.sidPrefix === 'GUEST' || !prof.sidPrefix || prof.isGuest);
        const deptText = prof.department || (isGuest ? '校園訪客 · 快速試玩' : '中興大學選手');
        const nickText = prof.nickname || '島民球員';

        const passportContent = document.getElementById('passport-tab-content');
        if (!passportContent) return;

        passportContent.innerHTML = `
            <!-- 選手證主卡片 -->
            <div class="passport-card">
                <!-- 頂部身分條 -->
                <div class="passport-header-bar">
                    <div class="passport-title-wrap">
                        <span class="passport-logo-icon">🌿</span>
                        <div class="passport-title-text">
                            <h3>國立中興大學 · 匹克球島民選手證</h3>
                            <div class="passport-sub">NCHU PICKLEBALL PLAYER PASSPORT</div>
                        </div>
                    </div>
                    <div class="passport-mode-switcher">
                        <span class="btn-avatar-mode on">🪿 匹克鵝</span>
                    </div>
                </div>

                <!-- 人偶與基本資料水平區塊 -->
                <div class="passport-hero-row">
                    <!-- 左側人偶展示台 -->
                    <div class="passport-doll-box">
                        <div id="passport-avatar-3d" style="width:150px;height:210px;"></div>
                        <div class="avatar-tip-caption">👆 拖曳轉身看看匹克鵝</div>
                    </div>

                    <!-- 右側球員資訊與等級 -->
                    <div class="passport-info-col">
                        <div class="passport-player-name-row">
                            <span class="passport-player-nick">${escapeHtml(nickText)}</span>
                            <span class="passport-status-tag ${isGuest ? 'guest' : 'student'}">${isGuest ? '👟 訪客選手' : '🎓 正式學生'}</span>
                        </div>
                        <div class="passport-player-dept">🏛️ ${escapeHtml(deptText)}</div>

                        <!-- 等級與稱號徽章 -->
                        <div class="passport-level-plate">
                            <div class="passport-level-num">Lv.${level}</div>
                            <div class="passport-level-right">
                                <div class="passport-level-title">${title}</div>
                                <div class="passport-exp-bar-wrap">
                                    <div class="passport-exp-bar-fill" style="width:${Math.min(100, Math.round(curExpInLevel / maxExpInLevel * 100))}%;"></div>
                                </div>
                                <div class="passport-exp-label">${curExpInLevel} / ${maxExpInLevel} EXP</div>
                            </div>
                        </div>

                        <!-- 揚州炒飯體力加成彩蛋 (校園傳奇梗) -->
                        <div class="passport-rice-buff">
                            <div class="rice-buff-icon">🍚</div>
                            <div class="rice-buff-info">
                                <div class="rice-buff-title">中興南門路 · 揚州炒飯特大盛加成</div>
                                <div class="rice-buff-desc">已攝取傳奇碳水小山！飽食度 100%，耐力續航 +30%！</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 戰力四維雷達指標 -->
                <div class="passport-stats-grid">
                    <div class="stat-pill">
                        <span class="s-icon">🚀</span>
                        <span class="s-name">扣殺爆發</span>
                        <span class="s-val">88</span>
                    </div>
                    <div class="stat-pill">
                        <span class="s-icon">⚡</span>
                        <span class="s-name">神經反應</span>
                        <span class="s-val">94</span>
                    </div>
                    <div class="stat-pill">
                        <span class="s-icon">🌀</span>
                        <span class="s-name">旋球掌控</span>
                        <span class="s-val">86</span>
                    </div>
                    <div class="stat-pill">
                        <span class="s-icon">🍚</span>
                        <span class="s-name">炒飯耐力</span>
                        <span class="s-val">99+</span>
                    </div>
                </div>

                <!-- 榮譽成就勳章牆 -->
                <div class="passport-achievements-sec">
                    <div class="passport-sec-header">
                        <span class="sec-title">🏆 島民榮譽成就牆 (Achievements)</span>
                        <span class="sec-count">${unlocked.length} / ${ACHIEVEMENTS_DATA.length} 已解鎖</span>
                    </div>
                    <div class="passport-badges-list">
                        ${ACHIEVEMENTS_DATA.map(ach => {
                            const isDone = unlocked.includes(ach.id);
                            return `
                                <div class="ach-badge-card ${isDone ? 'unlocked' : 'locked'}">
                                    <div class="ach-badge-icon">${ach.icon}</div>
                                    <div class="ach-badge-body">
                                        <div class="ach-badge-top">
                                            <span class="ach-badge-name">${ach.title}</span>
                                            <span class="ach-badge-tag">${ach.badge}</span>
                                        </div>
                                        <div class="ach-badge-desc">${ach.desc}</div>
                                    </div>
                                    <div class="ach-badge-state">${isDone ? '✓' : '🔒'}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        // 依據目前模式啟動人偶渲染
        init3DAvatar();
        if (typeof syncCharPickerUI === 'function') syncCharPickerUI();
    }

    function init3DAvatar() {
        if (threeMini) {
            threeMini.destroy();
            threeMini = null;
        }
        const box = document.getElementById('passport-avatar-3d');
        if (box && window.THREE) {
            threeMini = new window.NGoCharacterPortrait(box);
        }
    }

    // ── 雙模切換 ──
    function switchAvatarMode() { init3DAvatar(); }

    // ── 選手證與編輯分頁切換 ──
    function switchProfileTab(tab) {
        currentProfileTab = tab;
        const btnPass = document.getElementById('ptab-btn-passport');
        const btnEdit = document.getElementById('ptab-btn-edit');
        const panePass = document.getElementById('passport-tab-content');
        const paneEdit = document.getElementById('profile-edit-content');

        if (btnPass) btnPass.classList.toggle('on', tab === 'passport');
        if (btnEdit) btnEdit.classList.toggle('on', tab === 'edit');

        if (panePass) panePass.style.display = (tab === 'passport' ? 'block' : 'none');
        if (paneEdit) paneEdit.style.display = (tab === 'edit' ? 'block' : 'none');

        if (tab === 'passport') {
            renderPassportView();
        } else {
            if (threeMini) { threeMini.destroy(); threeMini = null; }
        }
    }

    // ── 關閉個人檔案時徹底休眠 ──
    function suspendProfileAvatar() {
        if (threeMini) {
            threeMini.destroy();
            threeMini = null;
        }
    }

    // ── 全域注入 ──
    window.renderPassportView = renderPassportView;
    window.switchAvatarMode = switchAvatarMode;
    window.switchProfileTab = switchProfileTab;
    window.suspendProfileAvatar = suspendProfileAvatar;
    window.getPlayerExp = getPlayerExp;
    window.setPlayerExp = setPlayerExp;

})(window);
