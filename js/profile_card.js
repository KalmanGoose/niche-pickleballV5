/* ══════════════════════════════════════════════════════════════
   中興大學匹克球 · 個人選手證 (NCHU Island Passport)
   2D/3D 雙模動態人偶展示台、等級經驗值與成就系統 (含揚州炒飯傳奇梗)
   ══════════════════════════════════════════════════════════════ */

(function (window) {
    'use strict';

    let currentAvatarMode = '2D'; // '2D' | '3D'
    let currentProfileTab = 'passport'; // 'passport' | 'edit'
    let threeMini = null; // 3D 微型人偶展示台實例

    // ── 經驗值與成就資料存取 ──
    const EXP_KEY = 'nchu_player_exp';
    const ACH_KEY = 'nchu_player_achievements';
    const AVATAR_MODE_KEY = 'nchu_player_avatar_mode';

    function getPlayerExp() {
        try {
            const raw = localStorage.getItem(EXP_KEY);
            if (raw !== null && !isNaN(parseInt(raw, 10))) {
                return parseInt(raw, 10);
            }
            return 120; // 首次新玩家初始經驗值 (Lv.1 新手球員)
        } catch (e) {
            return 120;
        }
    }

    function setPlayerExp(exp) {
        try {
            localStorage.setItem(EXP_KEY, String(exp));
        } catch (e) {}
    }

    function addPlayerExp(amount, reason = '') {
        const cur = getPlayerExp();
        const next = Math.max(0, cur + (amount || 0));
        setPlayerExp(next);
        const oldLevel = Math.floor(cur / 300) + 1;
        const newLevel = Math.floor(next / 300) + 1;
        if (newLevel > oldLevel) {
            const { title } = calcLevelInfo(next);
            if (typeof toast === 'function') {
                toast(`🎉 等級提升至 Lv.${newLevel}！`, `榮獲頭銜：${title}`);
            }
            if (typeof S !== 'undefined' && S.fanfare) {
                S.fanfare();
            }
            if (typeof speakReferee === 'function') {
                speakReferee(`恭喜升級！晉升為等級 ${newLevel}！`);
            }
        }
        return next;
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
            title: '捷安特神經破風手',
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
        else if (level >= 6) title = '巨纖維捷安特破風手 🚲';
        else if (level >= 3) title = '中興湖巡弋截擊手 🎾';

        return { level, title, curExpInLevel, maxExpInLevel };
    }

    // ══════════════════════════════════════════════════════════════
    // 🎨 2D 手繪動態人偶生成器
    // ══════════════════════════════════════════════════════════════
    function render2DAvatar() {
        const wrap = document.getElementById('passport-avatar-2d');
        if (!wrap) return;

        wrap.innerHTML = `
            <div class="avatar-2d-canvas-wrap">
                <svg viewBox="0 0 160 200" class="avatar-2d-svg" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <radialGradient id="shadowGrad" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stop-color="#2b1d14" stop-opacity="0.25"/>
                            <stop offset="100%" stop-color="#2b1d14" stop-opacity="0"/>
                        </radialGradient>
                        <linearGradient id="jerseyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#2e7d32"/>
                            <stop offset="100%" stop-color="#1b5e20"/>
                        </linearGradient>
                        <linearGradient id="paddleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#f59e0b"/>
                            <stop offset="100%" stop-color="#d97706"/>
                        </linearGradient>
                    </defs>
                    
                    <!-- 投影 -->
                    <ellipse cx="80" cy="188" rx="42" ry="7" fill="url(#shadowGrad)"/>
                    
                    <!-- 身體與球衣 (中興森林墨綠運動服) -->
                    <g class="avatar-2d-body-group">
                        <!-- 雙腿與運動鞋 -->
                        <rect x="66" y="145" width="10" height="28" rx="4" fill="#fcd34d"/>
                        <rect x="84" y="145" width="10" height="28" rx="4" fill="#fcd34d"/>
                        <rect x="62" y="168" width="16" height="12" rx="4" fill="#ffffff" stroke="#dec8a7" stroke-width="1.5"/>
                        <rect x="82" y="168" width="16" height="12" rx="4" fill="#ffffff" stroke="#dec8a7" stroke-width="1.5"/>
                        
                        <!-- 白色運動短褲 -->
                        <path d="M 60 128 L 100 128 L 96 148 L 84 148 L 80 138 L 76 148 L 64 148 Z" fill="#ffffff" stroke="#e0d0b8" stroke-width="1.5"/>
                        
                        <!-- 中興綠球衣主體 -->
                        <path d="M 52 74 Q 80 70 108 74 L 104 130 L 56 130 Z" fill="url(#jerseyGrad)"/>
                        <!-- 球衣白色運動斜切飾條 -->
                        <path d="M 54 84 L 106 100 L 105 108 L 55 92 Z" fill="#ffffff" opacity="0.3"/>
                        <!-- NCHU 校名標誌 -->
                        <text x="80" y="112" font-size="10.5" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="system-ui">NCHU</text>
                        
                        <!-- 左臂 (叉腰) -->
                        <path d="M 54 78 Q 38 98 48 116" stroke="#fcd34d" stroke-width="8" stroke-linecap="round" fill="none"/>
                        
                        <!-- 右臂 (手持匹克球拍) -->
                        <g class="avatar-2d-arm-right">
                            <path d="M 106 78 Q 124 96 118 118" stroke="#fcd34d" stroke-width="8" stroke-linecap="round" fill="none"/>
                            <!-- 握把 -->
                            <rect x="114" y="116" width="6" height="16" rx="2" fill="#78350f" transform="rotate(-25 117 124)"/>
                            <!-- 拍面 (中興暖金) -->
                            <rect x="108" y="86" width="22" height="30" rx="8" fill="url(#paddleGrad)" stroke="#b45309" stroke-width="1.5" transform="rotate(-25 119 101)"/>
                            <!-- 拍面匹克球孔洞裝飾 -->
                            <circle cx="119" cy="98" r="2.5" fill="#fef3c7" opacity="0.8"/>
                            <circle cx="113" cy="106" r="2" fill="#fef3c7" opacity="0.8"/>
                            <circle cx="125" cy="103" r="2" fill="#fef3c7" opacity="0.8"/>
                        </g>
                        
                        <!-- 脖子與頭部 -->
                        <rect x="74" y="60" width="12" height="16" rx="3" fill="#fcd34d"/>
                        <circle cx="80" cy="46" r="24" fill="#fed7aa"/>
                        
                        <!-- 可愛髮型 (中興島民自然短髮) -->
                        <path d="M 56 42 Q 80 18 104 42 Q 106 28 88 22 Q 72 22 56 36 Z" fill="#4a2e18"/>
                        <path d="M 56 42 Q 54 52 58 60 Q 62 48 64 42 Z" fill="#4a2e18"/>
                        <path d="M 104 42 Q 106 52 102 60 Q 98 48 96 42 Z" fill="#4a2e18"/>
                        
                        <!-- 眼睛 (眨眼微笑) -->
                        <circle cx="72" cy="45" r="2.8" fill="#2b1d14"/>
                        <circle cx="88" cy="45" r="2.8" fill="#2b1d14"/>
                        <circle cx="73" cy="44" r="0.9" fill="#ffffff"/>
                        <circle cx="89" cy="44" r="0.9" fill="#ffffff"/>
                        
                        <!-- 腮紅 -->
                        <ellipse cx="67" cy="51" rx="4.5" ry="2.2" fill="#f87171" opacity="0.45"/>
                        <ellipse cx="93" cy="51" rx="4.5" ry="2.2" fill="#f87171" opacity="0.45"/>
                        
                        <!-- 自信微笑 -->
                        <path d="M 76 53 Q 80 57 84 53" stroke="#2b1d14" stroke-width="1.8" stroke-linecap="round" fill="none"/>
                    </g>
                </svg>
                <div class="avatar-idle-badge">🎾 待命中</div>
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    // 🪪 渲染個人選手證主面板
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
                    </div>

                <!-- 人偶與基本資料水平區塊 -->
                <div class="passport-hero-row">
                    <!-- 左側人偶展示台 -->
                    <div class="passport-doll-box">
                        <div id="passport-avatar-2d" style="display:${currentAvatarMode === '2D' ? 'block' : 'none'};"></div>
                        
                        <div class="avatar-tip-caption">🍃 中興島民選手待命中</div>
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
        render2DAvatar();
    }

    function switchAvatarMode(mode) {
        currentAvatarMode = "2D";
        render2DAvatar();
    }

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
        }
    }

    // ── 關閉個人檔案時徹底休眠 ──
    function suspendProfileAvatar() {}

    // ── 全域注入 ──
    window.renderPassportView = renderPassportView;
    window.switchAvatarMode = switchAvatarMode;
    window.switchProfileTab = switchProfileTab;
    window.suspendProfileAvatar = suspendProfileAvatar;
    window.getPlayerExp = getPlayerExp;
    window.setPlayerExp = setPlayerExp;
    window.addPlayerExp = addPlayerExp;

})(window);
