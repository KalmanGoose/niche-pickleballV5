/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 介面控制器、活動式選單與導覽 (UI & Interaction)
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════ 相機視角設定與自訂面板 ═══════ */
        /* ═══════════════════════════════════════════════
           ★ 視角系統(含自訂視角)
           ═══════════════════════════════════════════════ */
        const CAM_KEY = 'nchu_pb_camview';
        const CAM_DEF = { h: 6.1, dist: 11.5, yaw: 0 };
        const CAM_LIM = { hMin: 1.2, hMax: 22, dMin: 4.5, dMax: 26, yawMax: Math.PI * 0.75 };
        let camCustom = { h: CAM_DEF.h, dist: CAM_DEF.dist, yaw: CAM_DEF.yaw };
        let camViewMode = 0;                       // 0~3 內建, 4 = 自訂
        let camEdit = false;                       // 編輯模式旗標
        const camKeys = { u: false, j: false, i: false, k: false, o: false, l: false };
        const camPad = { vert: 0 };                 // 手機 ▲▼ 按鈕: -1 / 0 / +1
        const VIEW_NAMES = ['經典追蹤', '戰術俯瞰', '沉浸越肩', '電視轉播', '自訂視角'];

        function loadCamCustom() {
            try {
                const o = JSON.parse(localStorage.getItem(CAM_KEY)) || {};
                // 若為舊版預設參數 (8.2 / 14.5)，自動無縫切換為全新最佳化視角 (6.1 / 11.5)
                const isOldDef = Math.abs((Number(o.h) || 0) - 8.2) < 0.2 && Math.abs((Number(o.dist) || 0) - 14.5) < 0.2;
                if (isOldDef) {
                    camCustom.h = CAM_DEF.h;
                    camCustom.dist = CAM_DEF.dist;
                    camCustom.yaw = CAM_DEF.yaw;
                    saveCamCustom();
                } else {
                    camCustom.h = THREE.MathUtils.clamp(Number(o.h) || CAM_DEF.h, CAM_LIM.hMin, CAM_LIM.hMax);
                    camCustom.dist = THREE.MathUtils.clamp(Number(o.dist) || CAM_DEF.dist, CAM_LIM.dMin, CAM_LIM.dMax);
                    camCustom.yaw = THREE.MathUtils.clamp(Number(o.yaw) || 0, -CAM_LIM.yawMax, CAM_LIM.yawMax);
                }
            } catch (e) {
                camCustom.h = CAM_DEF.h;
                camCustom.dist = CAM_DEF.dist;
                camCustom.yaw = CAM_DEF.yaw;
            }
        }
        function saveCamCustom() {
            try { localStorage.setItem(CAM_KEY, JSON.stringify(camCustom)); } catch (e) { }
        }
        function cycleCamView() {
            if (camEdit) return;
            camViewMode = (camViewMode + 1) % 5;
            const qcn = document.getElementById('quick-cam-name');
            if (qcn) {
                const shortNames = ['經典', '俯瞰', '越肩', '轉播', '自訂'];
                qcn.innerText = shortNames[camViewMode] || VIEW_NAMES[camViewMode];
            }
            toast('攝影機視角', VIEW_NAMES[camViewMode]);
        }
        function enterCamEdit() {
            closePanel();
            // ★ 自訂視角無縫繼承當前視角參數 (Seamless Custom View)
            if (camViewMode === 0) {
                camCustom.h = 6.1; camCustom.dist = 11.5; camCustom.yaw = 0;
            } else if (camViewMode === 1) {
                camCustom.h = 14.5; camCustom.dist = 7.5; camCustom.yaw = 0;
            } else if (camViewMode === 2) {
                camCustom.h = 1.55; camCustom.dist = 3.6; camCustom.yaw = 0;
            } else if (camViewMode === 3) {
                camCustom.h = 4.5; camCustom.dist = 8.2; camCustom.yaw = Math.PI * 0.45;
            }
            camEdit = true;
            camViewMode = 4;
            clearKeys();
            camPad.vert = 0;
            D.camEdit.classList.add('on');
            D.ceHint.innerHTML = IS_MOBILE
                ? '<b>搖桿左右</b> 環繞 · <b>搖桿上下</b> 遠近 · <b>▲▼</b> 升高降低'
                : '<b>U</b>/<b>J</b> 升高降低 · <b>I</b>/<b>K</b> 拉近拉遠 · <b>O</b>/<b>L</b> 左右環繞';
            if (IS_MOBILE) {
                document.getElementById('joy').classList.add('cam-mode');
                D.camVert.classList.add('on');
            }
            updateCamEditUI();
            toast('🎨 自訂視角編輯中', IS_MOBILE ? '搖桿暫時用來調鏡頭' : '用 U J I K O L 調整');
        }
        function exitCamEdit() {
            camEdit = false;
            clearKeys();
            camPad.vert = 0;
            Object.keys(camKeys).forEach(k => camKeys[k] = false);
            D.camEdit.classList.remove('on');
            document.getElementById('joy').classList.remove('cam-mode');
            D.camVert.classList.remove('on');
            saveCamCustom();
            toast('✓ 視角已儲存', '搖桿恢復為移動控制');
        }
        function resetCamCustom() {
            camCustom.h = CAM_DEF.h; camCustom.dist = CAM_DEF.dist; camCustom.yaw = CAM_DEF.yaw;
            updateCamEditUI();
            toast('↺ 已重設為預設視角', '');
        }
        function updateCamEditUI() {
            D.cvH.innerText = camCustom.h.toFixed(1);
            D.cvD.innerText = camCustom.dist.toFixed(1);
            D.cvY.innerText = Math.round(camCustom.yaw * 180 / Math.PI) + '°';
        }
        function updateCamCustom(dt) {
            if (!camEdit) return;
            const hs = 3.4 * dt, ds = 5.2 * dt, ys = 1.15 * dt;
            let moved = false;
            if (camKeys.u) { camCustom.h += hs; moved = true; }
            if (camKeys.j) { camCustom.h -= hs; moved = true; }
            if (camKeys.i) { camCustom.dist -= ds; moved = true; }
            if (camKeys.k) { camCustom.dist += ds; moved = true; }
            if (camKeys.o) { camCustom.yaw -= ys; moved = true; }
            if (camKeys.l) { camCustom.yaw += ys; moved = true; }
            if (camPad.vert !== 0) { camCustom.h += camPad.vert * hs; moved = true; }
            // 手機:編輯模式下搖桿改控鏡頭(此時 updatePlayer 已停止移動)
            if (keys.a) { camCustom.yaw -= ys; moved = true; }
            if (keys.d) { camCustom.yaw += ys; moved = true; }
            if (keys.w) { camCustom.dist -= ds; moved = true; }
            if (keys.s) { camCustom.dist += ds; moved = true; }
            if (!moved) return;
            camCustom.h = THREE.MathUtils.clamp(camCustom.h, CAM_LIM.hMin, CAM_LIM.hMax);
            camCustom.dist = THREE.MathUtils.clamp(camCustom.dist, CAM_LIM.dMin, CAM_LIM.dMax);
            camCustom.yaw = THREE.MathUtils.clamp(camCustom.yaw, -CAM_LIM.yawMax, CAM_LIM.yawMax);
            updateCamEditUI();
        }

        /* ═══════ ★ v5.0.14: 精緻下拉子排導覽控制器 (Dropdown Subbar Controller) ═══════ */
        let activeNavMenu = null;
        function toggleNavMenu(menu) {
            if (menu === 'profile') menu = 'settings';
            activeNavMenu = (activeNavMenu === menu) ? null : menu;
            const subbar = document.getElementById('nav-subbar');
            if (subbar) subbar.classList.toggle('open', !!activeNavMenu);

            document.querySelectorAll('.subbar-group').forEach(g => {
                g.style.display = (g.id === `subbar-${activeNavMenu}`) ? 'flex' : 'none';
            });
            document.querySelectorAll('#nav button[data-menu]').forEach(b => {
                b.classList.toggle('open', b.dataset.menu === activeNavMenu);
            });
            syncSubbarStates();
        }

        // 兼容舊版呼叫
        function togglePanel(name) { toggleNavMenu(name); }
        function closePanel() { if (activeNavMenu) toggleNavMenu(activeNavMenu); }

        /* ★ 橫向滑動加強輔助器 (支援手機原生滑動、桌機滑鼠抓取拖曳與滑鼠滾輪橫向滾動) */
        function enableHorizontalDragScroll(el) {
            if (!el || el._hDragInit) return;
            el._hDragInit = true;
            let isDown = false;
            let startX = 0, scrollLeft = 0, moved = false;

            el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                isDown = true;
                moved = false;
                startX = e.pageX - el.offsetLeft;
                scrollLeft = el.scrollLeft;
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                const x = e.pageX - el.offsetLeft;
                const walk = (x - startX) * 1.5;
                if (Math.abs(walk) > 4) moved = true;
                el.scrollLeft = scrollLeft - walk;
            });

            window.addEventListener('mouseup', () => {
                if (isDown) {
                    isDown = false;
                }
            });

            // 若使用者進行了拖動 (距離 > 4px)，阻斷 click 事件防止誤觸按鈕
            el.addEventListener('click', (e) => {
                if (moved) {
                    e.stopPropagation();
                    e.preventDefault();
                    moved = false;
                }
            }, true);

            // 滑鼠垂直滾輪轉換為水平滑動
            el.addEventListener('wheel', (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    el.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });
        }

        // 點擊空白處自動關閉下拉子排
        document.addEventListener('pointerdown', (e) => {
            if (!activeNavMenu) return;
            const nav = document.getElementById('nav');
            const subbar = document.getElementById('nav-subbar');
            if (nav && nav.contains(e.target)) return;
            if (subbar && subbar.contains(e.target)) return;
            closePanel();
        });

        function syncSubbarStates() {
            // 同步 AI 體感開關狀態
            const aiBtn = document.getElementById('subbar-ai-btn');
            if (aiBtn) {
                aiBtn.innerHTML = (typeof aiActive !== 'undefined' && aiActive) ? '📷 體感: 開啟' : '📷 體感: 關閉';
                aiBtn.style.color = (typeof aiActive !== 'undefined' && aiActive) ? 'var(--lime)' : 'var(--ok)';
            }
            // 同步關卡按鈕高亮
            if (typeof curStage !== 'undefined') {
                document.querySelectorAll('#subbar-stage .stage-btn').forEach(btn => {
                    btn.classList.toggle('on', parseInt(btn.dataset.stage) === curStage);
                });
            }
            // 同步瞄準模式狀態
            const aimBtn = document.getElementById('subbar-aim-btn');
            if (aimBtn && typeof aimAssistMode !== 'undefined') {
                const map = { LOCKED: '🔒 自動對角', LEFT_ZONE: '🧭 左手瞄準', TORSO: '🔄 轉身瞄準', RIGHT_FREE: '✋ 右手自由' };
                aimBtn.innerHTML = `🎯 瞄準: ${map[aimAssistMode] || aimAssistMode}`;
            }
            // 同步體感判定等級
            const teachBtn = document.getElementById('subbar-teach-btn');
            if (teachBtn && typeof teachLevel !== 'undefined') {
                const map = { easy: '🟢 寬鬆', normal: '🟡 標準', strict: '🔴 嚴格' };
                teachBtn.innerHTML = `🎚️ 判定: ${map[teachLevel] || teachLevel}`;
            }
            // 同步 AI 對手難度
            const diffBtn = document.getElementById('subbar-diff-btn');
            const curDiff = (typeof diffLevel !== 'undefined') ? diffLevel : ((typeof gameDifficulty !== 'undefined') ? gameDifficulty : 'easy');
            if (diffBtn) {
                const map = { easy: '🟢 初階', medium: '🟡 中等', hard: '🔴 困難', fly: '🪰 蒼蠅' };
                diffBtn.innerHTML = `🤖 對手: ${map[curDiff] || curDiff}`;
            }
            // 同步效能預設
            const perfBtn = document.getElementById('subbar-perf-btn');
            if (perfBtn && typeof perfLevel !== 'undefined') {
                const map = { low: '🟢 節能', medium: '🟡 平衡', high: '🔴 原生高畫質', ultra: '🟣 極致' };
                perfBtn.innerHTML = `⚡ 畫質: ${map[perfLevel] || perfLevel}`;
            }
            // 同步卡片縮放標籤
            const scaleLbl = document.getElementById('quick-scale-lbl');
            if (scaleLbl && typeof cardScales !== 'undefined') {
                scaleLbl.innerText = `${Math.round((cardScales.info || 1.0) * 100)}%`;
            }
            // 同步轉播樣式標籤
            const refLbl = document.getElementById('ref-mode-lbl');
            if (refLbl && typeof REFEREE_MODES !== 'undefined' && REFEREE_MODES[refereeMode]) {
                refLbl.innerText = REFEREE_MODES[refereeMode];
            }
            // 同步各處難度切換鈕高亮
            if (typeof syncDifficultyUI === 'function') syncDifficultyUI();
            // 同步搖桿移動速率標籤
            if (typeof syncJoySpeedUI === 'function') syncJoySpeedUI();
        }

        /* ── 個人設定子分類頁籤切換 ── */
        function switchSettingsTab(tab) {
            const tabs = ['view', 'user', 'data'];
            tabs.forEach(t => {
                const btn = document.getElementById(`stab-btn-${t}`);
                const pane = document.getElementById(`stab-pane-${t}`);
                if (btn) btn.classList.toggle('on', t === tab);
                if (pane) pane.style.display = (t === tab) ? 'flex' : 'none';
            });
        }

        /* ── 選單最小化 / 還原懸浮球控制器 ── */
        function toggleNavMinimize(forceMin) {
            const wrapper = document.getElementById('nav-wrapper');
            const pill = document.getElementById('nav-minimized-pill');
            const nav = document.getElementById('nav');
            const subbar = document.getElementById('nav-subbar');
            if (!wrapper || !pill || !nav) return;

            const isCurrentlyMin = wrapper.classList.contains('minimized');
            const isMin = (forceMin !== undefined) ? !!forceMin : !isCurrentlyMin;

            if (isMin) {
                wrapper.classList.add('minimized');
                nav.style.setProperty('display', 'none', 'important');
                pill.style.setProperty('display', 'flex', 'important');
                if (subbar) {
                    subbar.classList.remove('open');
                    subbar.style.setProperty('display', 'none', 'important');
                    activeNavMenu = null;
                }
                try { localStorage.setItem('nchu_nav_minimized', '1'); } catch (e) {}
                if (typeof toast === 'function') toast('⚙️ 選單已收入懸浮球', '整列選單已完全收合！點擊懸浮球即可展開');
            } else {
                wrapper.classList.remove('minimized');
                nav.style.removeProperty('display');
                pill.style.removeProperty('display');
                if (subbar) {
                    subbar.style.removeProperty('display');
                }
                try { localStorage.setItem('nchu_nav_minimized', '0'); } catch (e) {}

                // ★ 展開防爆框防護：若展開後選單超出螢幕右側邊緣，自動向左平滑修正
                requestAnimationFrame(() => {
                    const rect = wrapper.getBoundingClientRect();
                    if (rect.right > window.innerWidth - 8 || rect.left < 8) {
                        const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
                        const clampedLeft = Math.max(8, Math.min(maxLeft, rect.left));
                        wrapper.style.left = clampedLeft + 'px';
                        wrapper.style.transform = 'none';
                        try {
                            localStorage.setItem('nchu_nav_pos', JSON.stringify({ left: clampedLeft, top: rect.top }));
                        } catch (err) {}
                    }
                });
            }
        }

        /* ═══════════════════════════════════════════════════════════════════
           NCHU Pickleball V5 - 全方位 HUD 自由拖拉與防爆框邊界守護引擎
           ═══════════════════════════════════════════════════════════════════ */

        /**
         * 🛡️ 單一 HUD 視窗邊界夾取校正 (基於真實渲染像素 getBoundingClientRect)
         * 保證任何縮放比率、旋轉角度或定位下，HUD 都不會超出螢幕
         */
        window.clampHudElement = function (el, margin = 8) {
            if (!el) return;
            if (el.offsetParent === null && el.style.display === 'none') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const winW = window.innerWidth;
            const winH = window.innerHeight;

            let shiftX = 0;
            let shiftY = 0;

            if (rect.right > winW - margin) {
                shiftX = (winW - margin) - rect.right;
            }
            if (rect.left + shiftX < margin) {
                shiftX = margin - rect.left;
            }

            if (rect.bottom > winH - margin) {
                shiftY = (winH - margin) - rect.bottom;
            }
            if (rect.top + shiftY < margin) {
                shiftY = margin - rect.top;
            }

            if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
                const curLeft = parseFloat(el.style.left) || rect.left;
                const curTop = parseFloat(el.style.top) || rect.top;
                el.style.left = (curLeft + shiftX) + 'px';
                el.style.top = (curTop + shiftY) + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        };

        /**
         * 🛡️ 全域巡檢並回彈所有浮動 HUD
         */
        window.clampAllHuds = function () {
            const ids = ['info', 'board', 'fly-snn-hud', 'nav-wrapper', 'fun-item-hud'];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) window.clampHudElement(el);
            });
        };

        // 綁定視窗縮放與手機橫直向切換事件，自動拉回所有 HUD
        window.addEventListener('resize', () => {
            window.clampAllHuds();
        });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                window.clampAllHuds();
            }, 150);
        });

        /**
         * 🎯 通用卡片直接拖拉綁定函式 (支援觸控滑動、滑鼠拖動、防爆框與雙擊重置)
         */
        window.makeHudDraggable = function (el, options = {}) {
            if (!el) return null;
            const {
                storageKey = '',
                name = 'HUD',
                ignoreSelector = 'button, input, select, textarea, canvas, .card-resize-handle, .info-toggle-btn, #snn-zoom-level',
                dragHandle = null,
                onTap = null,
                onReset = null,
                defaultStyles = {}
            } = options;

            el.classList.add('hud-draggable');

            // 讀取上次記憶的位置 (支援安全性檢驗與邊界約束)
            if (storageKey) {
                try {
                    const saved = localStorage.getItem(storageKey);
                    if (saved) {
                        const p = JSON.parse(saved);
                        if (typeof p.left === 'number' && typeof p.top === 'number') {
                            el.style.left = p.left + 'px';
                            el.style.top = p.top + 'px';
                            el.style.right = 'auto';
                            el.style.bottom = 'auto';
                            if (p.transform) el.style.transform = p.transform;
                            else el.style.transform = 'none';

                            requestAnimationFrame(() => window.clampHudElement(el));
                        }
                    }
                } catch (_) {}
            }

            let isDragging = false;
            let startPointerX = 0, startPointerY = 0;
            let initLeft = 0, initTop = 0;
            let hasMoved = false;
            let lastTapTime = 0;

            const dragTrigger = dragHandle || el;

            dragTrigger.addEventListener('pointerdown', (e) => {
                if (e.button && e.button !== 0) return;
                if (ignoreSelector && e.target.closest(ignoreSelector)) return;

                isDragging = true;
                hasMoved = false;
                startPointerX = e.clientX;
                startPointerY = e.clientY;

                const rect = el.getBoundingClientRect();
                initLeft = rect.left;
                initTop = rect.top;

                el.style.transform = 'none';
                el.style.left = initLeft + 'px';
                el.style.top = initTop + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
                el.classList.add('hud-dragging');

                try { dragTrigger.setPointerCapture(e.pointerId); } catch (_) {}
                e.stopPropagation();
            });

            dragTrigger.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startPointerX;
                const dy = e.clientY - startPointerY;
                if (Math.hypot(dx, dy) > 4) {
                    hasMoved = true;
                }
                if (!hasMoved) return;

                const rect = el.getBoundingClientRect();
                const winW = window.innerWidth;
                const winH = window.innerHeight;
                const margin = 8;

                const maxLeft = Math.max(margin, winW - rect.width - margin);
                const maxTop = Math.max(margin, winH - rect.height - margin);

                const newL = Math.max(margin, Math.min(maxLeft, initLeft + dx));
                const newT = Math.max(margin, Math.min(maxTop, initTop + dy));

                el.style.left = newL + 'px';
                el.style.top = newT + 'px';

                e.stopPropagation();
                e.preventDefault();
            });

            const endDrag = (e) => {
                if (!isDragging) return;
                isDragging = false;
                el.classList.remove('hud-dragging');
                try { dragTrigger.releasePointerCapture(e.pointerId); } catch (_) {}

                const now = Date.now();
                if (hasMoved) {
                    window.clampHudElement(el);
                    const curLeft = parseFloat(el.style.left);
                    const curTop = parseFloat(el.style.top);
                    if (storageKey) {
                        try {
                            localStorage.setItem(storageKey, JSON.stringify({ left: curLeft, top: curTop }));
                        } catch (_) {}
                    }
                    if (typeof toast === 'function') {
                        toast(`📍 ${name}位置已記憶`, '已放置於自訂畫面位置');
                    }
                } else {
                    // 雙擊 / 雙點擊判定 (320ms 內連續輕點重置位置)
                    if (now - lastTapTime < 320) {
                        resetToDefault();
                        lastTapTime = 0;
                        return;
                    }
                    lastTapTime = now;
                    if (typeof onTap === 'function') {
                        onTap(e);
                    }
                }
            };

            dragTrigger.addEventListener('pointerup', endDrag);
            dragTrigger.addEventListener('pointercancel', endDrag);

            function resetToDefault() {
                if (storageKey) {
                    try { localStorage.removeItem(storageKey); } catch (_) {}
                }
                if (typeof onReset === 'function') {
                    onReset();
                } else if (defaultStyles) {
                    Object.keys(defaultStyles).forEach(k => {
                        el.style[k] = defaultStyles[k];
                    });
                }
                if (typeof toast === 'function') {
                    toast(`🔄 ${name}位置已重置`, '恢復預設位置');
                }
            }

            dragTrigger.addEventListener('dblclick', (e) => {
                if (ignoreSelector && e.target.closest(ignoreSelector)) return;
                e.stopPropagation();
                resetToDefault();
            });

            return {
                reset: resetToDefault,
                clamp: () => window.clampHudElement(el)
            };
        };

        /* ── 關卡資訊框 (#info) 直接拖曳支援 ── */
        window.initInfoDrag = function () {
            const info = document.getElementById('info');
            if (!info || info._hudDragInit) return;
            info._hudDragInit = true;

            window.makeHudDraggable(info, {
                storageKey: 'nchu_info_pos',
                name: '關卡資訊框',
                ignoreSelector: 'button, .diff-btn, .card-resize-handle, .info-toggle-btn',
                defaultStyles: {
                    top: 'calc(8px + env(safe-area-inset-top))',
                    left: 'calc(8px + env(safe-area-inset-left))',
                    right: 'auto',
                    bottom: 'auto',
                    transform: 'scale(var(--info-scale, 1))'
                }
            });
        };

        /* ── 雙人比分板 (#board) 直接拖曳支援 ── */
        window.initBoardDrag = function () {
            const board = document.getElementById('board');
            if (!board || board._hudDragInit) return;
            board._hudDragInit = true;

            window.makeHudDraggable(board, {
                storageKey: 'nchu_board_pos',
                name: '雙人比分板',
                ignoreSelector: '.card-resize-handle',
                defaultStyles: {
                    top: 'calc(8px + env(safe-area-inset-top))',
                    right: 'calc(8px + env(safe-area-inset-right))',
                    left: 'auto',
                    bottom: 'auto',
                    transform: 'scale(var(--board-scale, 1))'
                }
            });
        };

        /* ── 活動式選單自由拖曳與記憶功能 (支援觸控/滑鼠與雙擊重置) ── */
        window.initNavDrag = function () {
            const wrapper = document.getElementById('nav-wrapper');
            const handle = document.querySelector('.nav-drag-handle');
            const pill = document.getElementById('nav-minimized-pill');
            const nav = document.getElementById('nav');
            if (!wrapper) return;

            // 讀取上次記憶的位置 (防卡死與邊界守護)
            try {
                const savedPos = localStorage.getItem('nchu_nav_pos');
                if (savedPos) {
                    const pos = JSON.parse(savedPos);
                    const isOffscreen = pos.left < -20 || pos.top < -20 || 
                                       pos.left > (window.innerWidth - 30) || 
                                       pos.top > (window.innerHeight - 30);
                    if (isOffscreen) {
                        localStorage.removeItem('nchu_nav_pos');
                        resetNavPosition();
                    } else if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                        wrapper.style.left = pos.left + 'px';
                        wrapper.style.top = pos.top + 'px';
                        wrapper.style.transform = 'none';
                        requestAnimationFrame(() => window.clampHudElement(wrapper));
                    }
                }
                const savedMin = localStorage.getItem('nchu_nav_minimized');
                if (savedMin === '1') {
                    toggleNavMinimize(true);
                }
            } catch (e) {}

            function bindDrag(el, isPill) {
                if (!el || el._dragBound) return;
                el._dragBound = true;
                let dragging = false;
                let startX = 0, startY = 0;
                let initLeft = 0, initTop = 0;
                let hasMoved = false;
                let lastTap = 0;

                el.addEventListener('pointerdown', (e) => {
                    if (e.button && e.button !== 0) return;
                    if (!isPill && e.target.closest('button')) return;
                    dragging = true;
                    hasMoved = false;
                    startX = e.clientX;
                    startY = e.clientY;

                    const rect = wrapper.getBoundingClientRect();
                    initLeft = rect.left;
                    initTop = rect.top;

                    wrapper.style.transform = 'none';
                    wrapper.style.left = initLeft + 'px';
                    wrapper.style.top = initTop + 'px';

                    try { el.setPointerCapture(e.pointerId); } catch (err) {}
                    e.stopPropagation();
                });

                el.addEventListener('pointermove', (e) => {
                    if (!dragging) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    if (Math.hypot(dx, dy) > 4) {
                        hasMoved = true;
                    }
                    if (!hasMoved) return;

                    const rect = wrapper.getBoundingClientRect();
                    const w = rect.width || 60;
                    const h = rect.height || 40;
                    const maxLeft = Math.max(8, window.innerWidth - w - 8);
                    const maxTop = Math.max(6, window.innerHeight - h - 8);

                    const newL = Math.max(8, Math.min(maxLeft, initLeft + dx));
                    const newT = Math.max(6, Math.min(maxTop, initTop + dy));

                    wrapper.style.left = newL + 'px';
                    wrapper.style.top = newT + 'px';
                });

                const endDrag = (e) => {
                    if (!dragging) return;
                    dragging = false;
                    try { el.releasePointerCapture(e.pointerId); } catch (err) {}

                    const now = Date.now();
                    if (hasMoved) {
                        window.clampHudElement(wrapper);
                        const rect = wrapper.getBoundingClientRect();
                        try {
                            localStorage.setItem('nchu_nav_pos', JSON.stringify({ left: rect.left, top: rect.top }));
                        } catch (err) {}
                    } else {
                        // 雙擊 / 雙點擊判定 (320ms 內連續點擊拖曳手柄或懸浮球重置位置)
                        if (now - lastTap < 320) {
                            resetNavPosition();
                            lastTap = 0;
                            return;
                        }
                        lastTap = now;

                        if (isPill) {
                            toggleNavMinimize(false);
                        }
                    }
                };

                el.addEventListener('pointerup', endDrag);
                el.addEventListener('pointercancel', endDrag);

                el.addEventListener('dblclick', (e) => {
                    if (!isPill && e.target.closest('button')) return;
                    e.stopPropagation();
                    resetNavPosition();
                });
            }

            bindDrag(handle, false);
            bindDrag(pill, true);
            if (nav) bindDrag(nav, false);
        };

        function resetNavPosition() {
            const wrapper = document.getElementById('nav-wrapper');
            if (!wrapper) return;
            wrapper.style.left = '50%';
            wrapper.style.top = 'calc(58px + env(safe-area-inset-top))';
            wrapper.style.transform = 'translateX(-50%)';
            try { localStorage.removeItem('nchu_nav_pos'); } catch (e) {}
            if (typeof toast === 'function') toast('🔄 選單位置已重置', '已還原至預設頂部置中位置');
        }

        // 自動初始化 HUD 拖曳
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                window.initInfoDrag();
                window.initBoardDrag();
                window.initNavDrag();
            });
        } else {
            setTimeout(() => {
                window.initInfoDrag();
                window.initBoardDrag();
                window.initNavDrag();
            }, 50);
        }

        function cycleAimModeQuick() {
            const modes = ['LOCKED', 'LEFT_ZONE', 'TORSO', 'RIGHT_FREE'];
            const idx = modes.indexOf(aimAssistMode);
            const next = modes[(idx + 1) % modes.length];
            setAimMode(next);
            syncSubbarStates();
        }

        function cycleTeachLevelQuick() {
            const levels = ['easy', 'normal', 'strict'];
            const idx = levels.indexOf(teachLevel);
            const next = levels[(idx + 1) % levels.length];
            setTeachLevel(next);
            syncSubbarStates();
        }

        function cycleDifficultyQuick() {
            const diffs = ['easy', 'medium', 'hard', 'fly'];
            const curDiff = (typeof diffLevel !== 'undefined') ? diffLevel : 'easy';
            const idx = diffs.indexOf(curDiff);
            const next = diffs[(idx + 1) % diffs.length];
            setDifficulty(next);
            syncSubbarStates();
        }

        function cyclePerfQuick() {
            const perfs = ['low', 'medium', 'high', 'ultra'];
            const idx = perfs.indexOf(perfLevel);
            const next = perfs[(idx + 1) % perfs.length];
            applyPerfPreset(next);
            syncSubbarStates();
        }

        function cycleCardScaleQuick() {
            const scales = [0.8, 1.0, 1.25, 1.5];
            const cur = (typeof cardScales !== 'undefined' && cardScales.info) ? cardScales.info : 1.0;
            let next = scales[0];
            for (let i = 0; i < scales.length; i++) {
                if (scales[i] > cur + 0.05) {
                    next = scales[i];
                    break;
                }
            }
            setCardScale('info', next, true);
            setCardScale('board', next, true);
            syncSubbarStates();
            if (typeof toast === 'function') {
                toast('📐 卡片尺寸設定', `目前卡片大小：${Math.round(next * 100)}%`);
            }
        }

        function syncPerfButtons() {
            document.querySelectorAll('[data-perf]').forEach(b => b.classList.toggle('on', b.dataset.perf === perfLevel));
        }

        /* ═══════ 效能分級 ═══════ */

/* ═══════ 彈窗控制器、HUD 面板自由拖曳與卡片縮放手柄 ═══════ */
        const MODAL_IDS = ['login-overlay', 'profile-modal', 'audio-modal', 'tech-modal', 'social-modal', 'audit-modal', 'social-card-modal', 'mock-chat-modal', 'rules-modal'];
        function isTypingTarget(e) {
            const t = e.target;
            if (!t) return false;
            const tag = (t.tagName || '').toUpperCase();
            return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
        }
        function anyModalOpen() {
            return MODAL_IDS.some(id => {
                const el = document.getElementById(id);
                return el && el.style.display !== 'none';
            });
        }
        function clearKeys() { keys.w = keys.a = keys.s = keys.d = false; charging = false; }

        function setupInput() {
            window.addEventListener('keydown', e => {
                const overlay = document.getElementById('login-overlay');
                if (overlay && overlay.style.display !== 'none') {
                    const qBox = document.getElementById('login-quick-box');
                    if (qBox && qBox.style.display !== 'none' && (e.code === 'Space' || e.code === 'Enter')) {
                        e.preventDefault();
                        handleQuickStart();
                        return;
                    }
                }
                if (isTypingTarget(e) || anyModalOpen()) { clearKeys(); return; }
                const k = e.key.toLowerCase();
                // 自訂視角六鍵(僅編輯模式)
                if (camEdit) {
                    if (k === 'u' || k === 'j' || k === 'i' || k === 'k' || k === 'o' || k === 'l') { camKeys[k] = true; e.preventDefault(); return; }
                    if (e.code === 'Enter') { exitCamEdit(); e.preventDefault(); return; }
                    if (e.key === 'Escape') { exitCamEdit(); e.preventDefault(); return; }
                }
                if (k === '1') { cycleCamView(); e.preventDefault(); }
                if (k === 'w' || k === 'arrowup') { keys.w = true; e.preventDefault(); }
                if (k === 's' || k === 'arrowdown') { keys.s = true; e.preventDefault(); }
                if (k === 'a' || k === 'arrowleft') { keys.a = true; e.preventDefault(); }
                if (k === 'd' || k === 'arrowright') { keys.d = true; e.preventDefault(); }
                if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) beginCharge(); }
                if (e.key === 'Escape') closePanel();
            });
            window.addEventListener('keyup', e => {
                if (isTypingTarget(e) || anyModalOpen()) return;
                const k = e.key.toLowerCase();
                if (k === 'u' || k === 'j' || k === 'i' || k === 'k' || k === 'o' || k === 'l') camKeys[k] = false;
                if (k === 'w' || k === 'arrowup') keys.w = false;
                if (k === 's' || k === 'arrowdown') keys.s = false;
                if (k === 'a' || k === 'arrowleft') keys.a = false;
                if (k === 'd' || k === 'arrowright') keys.d = false;
                if (e.code === 'Space') { e.preventDefault(); release(); }
            });

            window.addEventListener('mousemove', e => {
                if (!webcamActive && !camEdit && ren && ren.domElement) {
                    const rect = ren.domElement.getBoundingClientRect();
                    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    mouse.x = nx;
                    mouse.y = ny;
                    swipeMove(e.clientX, e.clientY);
                }
            });
            window.isScreenTouching = false;
            ren.domElement.addEventListener('mousedown', e => {
                window.isScreenTouching = true;
                swipeStart(e.clientX, e.clientY);
                beginCharge();
            });
            window.addEventListener('mouseup', e => {
                window.isScreenTouching = false;
                swipeEnd();
                release();
            });

            const el = ren.domElement;
            const aimT = t => {
                if (!webcamActive && !camEdit && ren && ren.domElement) {
                    const rect = ren.domElement.getBoundingClientRect();
                    const nx = ((t.clientX - rect.left) / rect.width) * 2 - 1;
                    const ny = -((t.clientY - rect.top) / rect.height) * 2 + 1;
                    mouse.x = nx;
                    mouse.y = ny;
                }
            };
            let tid = null;
            el.addEventListener('touchstart', e => {
                e.preventDefault();
                if (tid === null && e.changedTouches.length) {
                    window.isScreenTouching = true;
                    const t = e.changedTouches[0];
                    tid = t.identifier;
                    aimT(t);
                    swipeStart(t.clientX, t.clientY);
                    beginCharge();
                }
            }, { passive: false });
            el.addEventListener('touchmove', e => {
                e.preventDefault();
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === tid) {
                        const t = e.touches[i];
                        aimT(t);
                        swipeMove(t.clientX, t.clientY);
                        break;
                    }
                }
            }, { passive: false });
            const tend = e => {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === tid) {
                        tid = null;
                        window.isScreenTouching = false;
                        swipeEnd();
                        release();
                        break;
                    }
                }
            };
            el.addEventListener('touchend', tend, { passive: false });
            el.addEventListener('touchcancel', tend, { passive: false });

            setupJoystick();
            setupCamVertButtons();
            initDraggableHUD();
            syncDifficultyUI();
            enableHorizontalDragScroll(document.getElementById('subbar-ai'));
            enableHorizontalDragScroll(document.getElementById('nav'));
            window.addEventListener('blur', () => {
                clearKeys(); camPad.vert = 0;
                Object.keys(camKeys).forEach(k => camKeys[k] = false);
            });
        }

        /* ═══════════════════════════════════════════════
           ★ v5.0.3: 輕量化純觸控/滑鼠長按可拖曳 HUD 系統 (Zero Engine Overhead)
           ═══════════════════════════════════════════════ */
        function initDraggableHUD() {
            const STORAGE_KEY = 'nchu_pb_hud_positions';
            let savedPositions = {};
            try {
                savedPositions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
            } catch(e) {}

            let activeDrag = null;

            function makeDraggable(el, id) {
                if (!el) return;
                el.classList.add('hud-draggable');

                // 載入並校驗儲存位置 (防止超出目前解析度)
                if (savedPositions[id]) {
                    const { left, top } = savedPositions[id];
                    const maxL = window.innerWidth - 60;
                    const maxT = window.innerHeight - 50;
                    if (left >= 0 && left < maxL && top >= 0 && top < maxT) {
                        el.style.left = left + 'px';
                        el.style.top = top + 'px';
                        el.style.right = 'auto';
                        el.style.bottom = 'auto';
                    }
                }

                let pressTimer = null;
                let isDragging = false;
                let startX = 0, startY = 0;
                let elemInitL = 0, elemInitT = 0;

                const startPress = (clientX, clientY) => {
                    const rect = el.getBoundingClientRect();
                    elemInitL = rect.left;
                    elemInitT = rect.top;
                    startX = clientX;
                    startY = clientY;

                    pressTimer = setTimeout(() => {
                        isDragging = true;
                        el.classList.add('hud-dragging');
                        if (navigator.vibrate) navigator.vibrate(28);
                    }, 360); // 360ms 長按判定觸發拖曳

                    activeDrag = {
                        doMove: (clientX, clientY) => {
                            if (!isDragging) {
                                if (Math.hypot(clientX - startX, clientY - startY) > 8) {
                                    clearTimeout(pressTimer);
                                }
                                return;
                            }
                            const dx = clientX - startX;
                            const dy = clientY - startY;
                            const newL = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, elemInitL + dx));
                            const newT = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, elemInitT + dy));
                            el.style.left = newL + 'px';
                            el.style.top = newT + 'px';
                            el.style.right = 'auto';
                            el.style.bottom = 'auto';
                        },
                        endPress: () => {
                            clearTimeout(pressTimer);
                            if (isDragging) {
                                isDragging = false;
                                el.classList.remove('hud-dragging');
                                const rect = el.getBoundingClientRect();
                                savedPositions[id] = { left: Math.round(rect.left), top: Math.round(rect.top) };
                                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPositions)); } catch(e) {}
                            }
                            activeDrag = null;
                        },
                        isDragging: () => isDragging
                    };
                };

                // 行動端觸控事件
                el.addEventListener('touchstart', (e) => {
                    if (e.touches.length !== 1) return;
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.classList.contains('info-toggle-btn')) return;
                    startPress(e.touches[0].clientX, e.touches[0].clientY);
                }, { passive: true });

                // 桌機端滑鼠事件
                el.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.classList.contains('info-toggle-btn')) return;
                    startPress(e.clientX, e.clientY);
                });
            }

            // 單一全域視窗監聽，杜絕重複綁定與記憶體洩漏
            window.addEventListener('touchmove', (e) => {
                if (activeDrag && e.touches.length === 1) {
                    if (activeDrag.isDragging()) e.preventDefault();
                    activeDrag.doMove(e.touches[0].clientX, e.touches[0].clientY);
                }
            }, { passive: false });

            window.addEventListener('touchend', () => { if (activeDrag) activeDrag.endPress(); }, { passive: true });
            window.addEventListener('touchcancel', () => { if (activeDrag) activeDrag.endPress(); }, { passive: true });
            window.addEventListener('mousemove', (e) => { if (activeDrag) activeDrag.doMove(e.clientX, e.clientY); });
            window.addEventListener('mouseup', () => { if (activeDrag) activeDrag.endPress(); });

            makeDraggable(document.getElementById('info'), 'info');
            makeDraggable(document.getElementById('speed-hud-mini'), 'speed_hud');
        }
        function setupJoystick() {
            const jc = document.getElementById('joy'), nub = document.getElementById('nub');
            if (IS_MOBILE) jc.style.display = 'block';
            let jid = null, cx = 0, cy = 0;
            jc.addEventListener('touchstart', e => {
                e.stopPropagation(); e.preventDefault();
                if (jid === null && e.changedTouches.length) {
                    jid = e.changedTouches[0].identifier;
                    const r = jc.getBoundingClientRect();
                    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
                }
            }, { passive: false });
            window.addEventListener('touchmove', e => {
                if (jid === null) return;
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === jid) {
                        const t = e.touches[i];
                        const dx = t.clientX - cx, dy = t.clientY - cy;
                        const dist = Math.min(Math.hypot(dx, dy), 34), ang = Math.atan2(dy, dx);
                        const mx = Math.cos(ang) * dist, my = Math.sin(ang) * dist;
                        nub.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
                        // ★ 類比加速度感應:微推微動，推到底全速前進
                        const joyMag = Math.min(1.0, dist / 34);
                        const analogRate = Math.pow(joyMag, 1.35);
                        joyAnalog.x = (dx / (dist || 1)) * analogRate;
                        joyAnalog.z = (dy / (dist || 1)) * analogRate;
                        keys.a = mx < -6; keys.d = mx > 6; keys.w = my < -6; keys.s = my > 6;
                        break;
                    }
                }
            }, { passive: false });
            const jend = e => {
                if (jid === null) return;
                joyAnalog.x = 0; joyAnalog.z = 0;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === jid) {
                        jid = null; nub.style.transform = 'translate(0,0)';
                        keys.w = keys.a = keys.s = keys.d = false; break;
                    }
                }
            };
            window.addEventListener('touchend', jend);
            window.addEventListener('touchcancel', jend);
        }
        function setupCamVertButtons() {
            const up = document.getElementById('cv-up'), dn = document.getElementById('cv-down');
            const bind = (btn, val) => {
                const on = e => { e.preventDefault(); e.stopPropagation(); camPad.vert = val; };
                const off = e => { e.preventDefault(); camPad.vert = 0; };
                btn.addEventListener('touchstart', on, { passive: false });
                btn.addEventListener('touchend', off, { passive: false });
                btn.addEventListener('touchcancel', off, { passive: false });
                btn.addEventListener('mousedown', on);
                btn.addEventListener('mouseup', off);
                btn.addEventListener('mouseleave', off);
            };
            bind(up, 1); bind(dn, -1);
        }

/* ═══════ Spotlight 聚光燈互動導覽系統 ═══════ */
        /* ═══════════════════════════════════════════════
           ✨ Spotlight 聚光燈 + Mock 抽屜互動導覽 (A+B 方案)
           ═══════════════════════════════════════════════ */
        let tourCurrentStep = 0;
        let tourActive = false;

        const TOUR_STEPS = [
            {
                targetSelector: '#nav button[data-panel="settings"]',
                title: '⚙️ 第一站：雙層分類設定選單',
                badge: '第 1 / 3 站 · 功能收納',
                desc: '點擊【設定】可滑出雙層抽屜：切換 3D 視角、調節體感靈敏度、綁定個人 IG 與同步數位孿生！',
                onEnter: () => {
                    togglePanel('settings');
                    setTimeout(() => openSettingsSub('game'), 350);
                },
                onExit: () => {
                    closePanel();
                    openSettingsSub('main');
                }
            },
            {
                targetSelector: '#nav button[data-panel="board"]',
                title: '🪿 第二站：社交名片與數位孿生對戰',
                badge: '第 2 / 3 站 · 零延遲 Mock 示範',
                desc: '點擊【社交】即可展開球員個人名片與 5 維特徵雷達圖，還能直接點擊【⚔️ 挑戰數位孿生】與好友 AI 對決！',
                onEnter: () => {
                    openSocial();
                    setTimeout(() => {
                        openPlayerCard({
                            nickname: '中興匹克球神',
                            department: '電機工程學系 四年級',
                            avatar: '🪿',
                            ig: 'nchu_pickleball_god',
                            score: 32,
                            stats: { serve: 95, dink: 88, spin: 94, chain: 92, speed: 90 }
                        });
                    }, 300);
                },
                onExit: () => {
                    closeSocialCard();
                    closeSocial();
                }
            },
            {
                targetSelector: '#speed-hud-mini',
                title: '🎾 第三站：滑動擊球與即時數據',
                badge: '第 3 / 3 站 · 實戰手感',
                desc: '向前滑動推打深球、左右切刷出香蕉側旋弧線！左下角膠囊常駐顯示即時球速與揮拍蓄力值。',
                onEnter: () => {
                    showFingerTutorial();
                },
                onExit: () => {
                    dismissFingerTutorial();
                }
            }
        ];

        function startSpotlightTour(force) {
            if (!force) {
                try {
                    const seen = localStorage.getItem('nchu_pickle_tour_done_v4');
                    if (seen === '1') return;
                } catch (e) {}
            }
            tourActive = true;
            tourCurrentStep = 0;
            const overlay = document.getElementById('spotlight-tour');
            if (overlay) overlay.style.display = 'block';
            renderSpotlightStep(0);
        }

        function renderSpotlightStep(idx) {
            if (idx < 0 || idx >= TOUR_STEPS.length) {
                dismissSpotlightTour();
                return;
            }
            const step = TOUR_STEPS[idx];
            if (typeof step.onEnter === 'function') step.onEnter();

            const badge = document.getElementById('tour-step-badge');
            const title = document.getElementById('tour-title');
            const desc = document.getElementById('tour-desc');
            const nextBtn = document.getElementById('tour-next-btn');
            const hole = document.getElementById('spotlight-hole');
            const card = document.getElementById('spotlight-card');

            if (badge) badge.innerText = step.badge;
            if (title) title.innerText = step.title;
            if (desc) desc.innerText = step.desc;
            if (nextBtn) nextBtn.innerText = (idx === TOUR_STEPS.length - 1) ? '開始暢玩 (Finish) ✓' : '下一步 ▸';

            const target = document.querySelector(step.targetSelector);
            if (target && hole && card) {
                const rect = target.getBoundingClientRect();
                const pad = 8;
                hole.style.top = Math.max(0, rect.top - pad) + 'px';
                hole.style.left = Math.max(0, rect.left - pad) + 'px';
                hole.style.width = (rect.width + pad * 2) + 'px';
                hole.style.height = (rect.height + pad * 2) + 'px';

                // 卡片智慧定位 (避開目標物)
                const cardW = Math.min(window.innerWidth * 0.9, 340);
                let cardTop = rect.bottom + 16;
                if (cardTop + 180 > window.innerHeight) {
                    cardTop = Math.max(16, rect.top - 190);
                }
                let cardLeft = Math.max(16, Math.min(window.innerWidth - cardW - 16, rect.left));
                card.style.top = cardTop + 'px';
                card.style.left = cardLeft + 'px';
            }
        }

        function nextSpotlightStep() {
            if (!tourActive) return;
            const prevStep = TOUR_STEPS[tourCurrentStep];
            if (prevStep && typeof prevStep.onExit === 'function') prevStep.onExit();

            tourCurrentStep++;
            if (tourCurrentStep >= TOUR_STEPS.length) {
                dismissSpotlightTour();
            } else {
                renderSpotlightStep(tourCurrentStep);
            }
        }

        function dismissSpotlightTour() {
            tourActive = false;
            const overlay = document.getElementById('spotlight-tour');
            if (overlay) overlay.style.display = 'none';
            try {
                localStorage.setItem('nchu_pickle_tour_done_v4', '1');
            } catch (e) {}
            closePanel();
            closeSocialCard();
            toast('🎾 導覽完成！', '隨時可在【設定】中重新觀看互動導覽');
        }
