/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 虛擬裁判、競賽計分與官方規則 (Referee & Competition)
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════ 競賽狀態與發球/得分機制 (Side-out Scoring State) ═══════ */
        let stage = 1, state = 'SERVE_READY';
        let pScore = 0, aScore = 0, legalServes = 0, twoBounceDone = 0;
        let rallyHits = 0, bounces = 0, lastHitter = 'NONE';
        let serveFromRight = true, serveSide = 1, locked = false;
        let stageAdvanceTimer = null; // ★ 獨立關卡推進定時器，防護 clearTimers 抹除
        const pPos = { x: 1.5, z: HALF_L + 0.35 };
        const keys = { w: false, a: false, s: false, d: false };
        const mouse = new THREE.Vector2(0, -0.22);
        let padX = 0, padY = 0.78;
        let charging = false, power = 0, powerDir = 1, powerBarDisplay = 0;
        let swingT = 0, swingP = 0, pLock = 0, gLock = 0;
        let serveLegal = true, pulse = 0, shake = 0, ballSquash = 0;
        let servePrepared = false, serveCooldown = 0;


/* ═══════ 計分判定、發球權轉換、規則手冊與虛擬裁判廣播 ═══════ */
        function endRally(scorer, msg, sub) {
            if (locked || demoOn || state === 'CLEARED') return;
            if (state === 'FAULT' || state === 'OVER') return;
            // ★ 🧱 對牆特訓模式：不計失分或勝負，僅重置連擊並重新發球
            if (typeof isWallPractice !== 'undefined' && isWallPractice) {
                state = 'FAULT'; freeze();
                if (typeof S !== 'undefined' && S.fault) S.fault();
                if (wallCombo > 0) toast('🧱 連擊中斷', '最高連擊: ' + wallCombo + ' · 重新推球開始');
                wallCombo = 0;
                later(resetServe, 800);
                return;
            }
            // ★ 🍄 瘋狂道具戰：電蚊拍追殺模式下，球落地/掛網完全不結算！必須衝過去電到蒼蠅才算贏！
            if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER') return;
            updateLastAuditOutcome(msg, sub);
            if (!scoring()) { fail(msg, sub); return; }   // ★ 練習關轉交 fail(),不扣分
            state = 'FAULT'; freeze();

            const isMatch = (stage === 4 || stage === 5 || stage === 6);
            if (isMatch) {
                // ★ 規格 8: 正式匹克球單打發球得分制 (USA Pickleball Official Singles Rules)
                const oppName = (typeof diffLevel !== 'undefined' && diffLevel === 'fly') ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';
                if (scorer === server) {
                    // 發球方贏得回合 ➔ 得 1 分 + 依新分數奇偶切換發球區 (偶數右區、奇數左區)
                    if (server === 'PLAYER') {
                        pScore++; S.point(); popRing(0, -3, 6, 0x3fe0c4);
                        if (typeof updateGooseEmote === 'function') updateGooseEmote('💦');
                        if (typeof addPlayerExp === 'function') addPlayerExp(25, '得分');
                        serveSide = (pScore % 2 === 0) ? 1 : -1;
                        toast('🏆 玩家得分！', '比分 ' + pScore + ' - ' + aScore + ' · ' + (serveSide === 1 ? '右側' : '左側') + '發球');
                    } else {
                        aScore++; S.fault(); addShake(0.22);
                        if (typeof updateGooseEmote === 'function') updateGooseEmote('🎵');
                        serveSide = (aScore % 2 === 0) ? 1 : -1;
                        toast(oppName + '得分！', '比分 ' + pScore + ' - ' + aScore + ' · ' + (serveSide === 1 ? '右側' : '左側') + '發球');
                    }
                    secondServe = false;
                } else {
                    // 接球方贏得回合 ➔ 單打直接 Side-out 換發球權 (單打無第二發球員，失誤即換發球權)
                    if (scorer === 'PLAYER') {
                        S.point();
                        if (typeof updateGooseEmote === 'function') updateGooseEmote('💦');
                    } else {
                        S.fault(); addShake(0.22);
                        if (typeof updateGooseEmote === 'function') updateGooseEmote('🎵');
                    }
                    secondServe = false;
                    server = (server === 'PLAYER' ? 'GOOSE' : 'PLAYER');
                    const newServerScore = (server === 'PLAYER') ? pScore : aScore;
                    serveSide = (newServerScore % 2 === 0) ? 1 : -1;
                    const nextName = (server === 'PLAYER' ? '玩家' : oppName);
                    toast('🔄 Side-out 換發球權！', '輪到 ' + nextName + ' (' + (serveSide === 1 ? '右側' : '左側') + '發球)');
                }
            } else {
                if (scorer === 'PLAYER') {
                    pScore++; S.point(); popRing(0, -3, 6, 0x3fe0c4);
                    if (typeof updateGooseEmote === 'function') updateGooseEmote('💦');
                } else {
                    aScore++; S.fault(); addShake(0.22);
                    if (typeof updateGooseEmote === 'function') updateGooseEmote('🎵');
                }
                toast(msg, sub || '按空白鍵重新發球');
            }

            updateScore(); updateGoal();
            const goal = STAGES[stage].goal;
            if (stage === 3 || stage === 4 || stage === 5 || stage === 6) {
                if (pScore >= goal) { clearStage(); return; }
                if (aScore >= goal) {
                    state = 'OVER'; clearTimers();
                    const opp = (typeof diffLevel !== 'undefined' && diffLevel === 'fly') ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';
                    const loseMsg = stage === 5 ? '魔王匹克鵝獲勝!' : (stage === 6 ? '🍄 道具戰 ' + opp + ' 獲勝!' : (opp + '先得 ' + goal + ' 分'));
                    toast(loseMsg, '比賽結束，點擊檢視紀念卡');
                    if (typeof updateGooseEmote === 'function') updateGooseEmote('🏆');
                    if (typeof showPolaroidSouvenir === 'function') showPolaroidSouvenir(false, pScore, aScore);
                    // ★ 拍立得展示期間暫停自動倒數換關，等待玩家點擊「繼續遊戲」再重置
                    return;
                }
            }
            later(resetServe, 2200);
        }
        function fail(msg, sub) {
            if (locked || demoOn || state === 'CLEARED') return;
            if (state === 'FAULT' || state === 'OVER') return;
            // ★ 🧱 對牆特訓模式：不計失敗，僅重置連擊
            if (typeof isWallPractice !== 'undefined' && isWallPractice) {
                state = 'FAULT'; freeze();
                if (typeof S !== 'undefined' && S.fault) S.fault();
                if (wallCombo > 0) toast('🧱 連擊中斷', '最高連擊: ' + wallCombo + ' · 重新推球開始');
                wallCombo = 0;
                later(resetServe, 800);
                return;
            }
            // ★ 🍄 瘋狂道具戰：電蚊拍追殺模式下，不判練習關失敗
            if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER') return;
            updateLastAuditOutcome(msg, sub);
            state = 'FAULT'; freeze(); S.fault(); addShake(0.14);
            toast(msg, sub || '練習關不扣分，點擊螢幕重新發球');
            later(resetServe, 900);
        }
        function serveFail(msg, sub) {
            if (state === 'CLEARED') return;
            if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER') return;
            if (scoring()) endRally(server === 'PLAYER' ? 'GOOSE' : 'PLAYER', msg, sub); else fail(msg, sub);
        }
        function clearStage() {
            updateLastAuditOutcome('關卡順利通過');
            state = 'CLEARED'; freeze(); clearTimers(); locked = true; S.point();
            popRing(0, 2, 8, 0xffc857);
            if (typeof updateGooseEmote === 'function') updateGooseEmote('👏');
            if (typeof addPlayerExp === 'function') addPlayerExp(stage === 5 ? 300 : 120, '關卡勝利');
            if (typeof showPolaroidSouvenir === 'function' && stage >= 4) {
                showPolaroidSouvenir(true, pScore, aScore);
                // ★ 正式關卡通關拍立得彈出時，等待玩家點擊 [繼續遊戲] 再推進關卡！
                return;
            }
            if (stageAdvanceTimer) {
                clearTimeout(stageAdvanceTimer);
                stageAdvanceTimer = null;
            }
            if (stage < 5) {
                const nextSt = stage + 1;
                toast('STAGE ' + stage + ' CLEARED', '🎉 恭喜通關！自動進入 STAGE ' + nextSt);
                stageAdvanceTimer = setTimeout(() => {
                    stageAdvanceTimer = null;
                    switchStage(nextSt, { fromClear: true });
                }, 1200);
            } else if (stage === 5) {
                toast('STAGE 5 CLEARED', '🏆 擊敗中興湖魔王！解鎖隱藏娛樂關！');
                stageAdvanceTimer = setTimeout(() => {
                    stageAdvanceTimer = null;
                    submitScoreToCloud(pScore);
                    switchStage(6, { fromClear: true });
                }, 2400);
            } else {
                toast('🎉 STAGE 6 完美通關！', '🏆 稱霸瘋狂道具戰！登錄英雄榜！');
                stageAdvanceTimer = setTimeout(() => {
                    stageAdvanceTimer = null;
                    locked = false;
                    resetServe();
                    submitScoreToCloud(pScore);
                }, 2000);
            }
        }
        function forfeitMatch() {
            closePanel();
            if (state === 'OVER' || demoOn) return;
            if (confirm('確定棄賽直接結算比分?')) {
                state = 'OVER'; clearTimers();
                toast('🏳️ 玩家選擇棄賽', '最終比分:' + pScore + ' - ' + aScore);
                if (typeof showPolaroidSouvenir === 'function') showPolaroidSouvenir(false, pScore, aScore);
                later(() => {
                    if ((stage === 5 || stage === 6) && pScore > 0) submitScoreToCloud(pScore);
                    resetServe();
                }, 1800);
            }
        }
        let toastT = null;
        function toast(main, sub) {
            // ★ V5 裁判廣播與操作指引分工解耦，杜絕多層重複疊字
            const isFault = (main.indexOf('FAULT') !== -1 || main.indexOf('失誤') !== -1 || main.indexOf('違規') !== -1 || main.indexOf('出界') !== -1 || main.indexOf('❌') !== -1);
            const isMajorCall = isFault || main.indexOf('Side-out') !== -1 || main.indexOf('得分') !== -1 || main.indexOf('獲勝') !== -1 || main.indexOf('連擊中斷') !== -1;

            // 1. 裁判廣播橫幅 (頂部木質懸浮膠囊) 專司賽事正式判決
            announceReferee(main, sub, isFault);

            // 2. 中央大字提示 (#toast) 僅於操作性教學/發球指引時輕量顯示，重大判決隱藏以杜絕疊字遮擋 3D 看板與球場
            if (!isMajorCall && D.tMain) {
                D.tMain.innerText = main;
                if (D.tSub) D.tSub.innerText = sub || '';
                D.tMain.classList.add('on');
                if (toastT) clearTimeout(toastT);
                toastT = setTimeout(() => D.tMain.classList.remove('on'), 1900);
            } else if (D.tMain) {
                D.tMain.classList.remove('on');
            }
        }
        function updateScore() {
            updatePlayerWhoLabel();
            D.pv.innerText = pScore;
            D.av.innerText = aScore;
            updateScore3D();
            if (typeof updateDynamicStagePill === 'function') {
                updateDynamicStagePill(stage, (typeof isWallPractice !== 'undefined' && isWallPractice) ? pScore : pScore, (typeof isWallPractice !== 'undefined' && isWallPractice) ? wallCombo : aScore);
            }
        }
        function updateGoal() {
            const goal = STAGES[stage].goal;
            let cur;
            if (stage === 1) cur = legalServes;
            else if (stage === 2 || stage === 3) cur = twoBounceDone;
            else cur = pScore;
            D.gTxt.innerText = cur + ' / ' + goal;
            D.gFill.style.width = Math.min(100, cur / goal * 100) + '%';
        }

        
        /* ══════════════════════════════════════════════════════════════
           V5 JavaScript 擴充: 規則手冊、虛擬裁判狀態機與旋轉提示
           ══════════════════════════════════════════════════════════════ */
        function openRulesModal(tab) {
            closePanel();
            const m = document.getElementById('rules-modal');
            if (m) m.style.display = 'flex';
            if (tab) switchRulesModalTab(tab);
        }
        function closeRulesModal() {
            const m = document.getElementById('rules-modal');
            if (m) m.style.display = 'none';
        }
        function switchRulesModalTab(tab) {
            const isRules = (tab === 'rules' || !tab);
            const isPhysics = (tab === 'physics');
            const isFly = (tab === 'fly');

            const btnRules = document.getElementById('rtab-btn-rules');
            const btnPhys = document.getElementById('rtab-btn-physics');
            const btnFly = document.getElementById('rtab-btn-fly');

            const paneRules = document.getElementById('rtab-pane-rules');
            const panePhys = document.getElementById('rtab-pane-physics');
            const paneFly = document.getElementById('rtab-pane-fly');

            const titleEl = document.getElementById('rules-modal-main-title');
            const srcLink = document.getElementById('rules-modal-source-link');

            if (btnRules) btnRules.classList.toggle('on', isRules);
            if (btnPhys) btnPhys.classList.toggle('on', isPhysics);
            if (btnFly) btnFly.classList.toggle('on', isFly);

            if (paneRules) paneRules.style.display = isRules ? 'block' : 'none';
            if (panePhys) panePhys.style.display = isPhysics ? 'block' : 'none';
            if (paneFly) paneFly.style.display = isFly ? 'block' : 'none';

            if (titleEl) {
                if (isFly) {
                    titleEl.innerHTML = '🪰 普林斯頓 FlyWire 果蠅神經大腦文獻 (Nature 2024)';
                } else if (isPhysics) {
                    titleEl.innerHTML = '🌪️ 匹克球流體力學與馬格努斯效應科普';
                } else {
                    titleEl.innerHTML = '📖 2026 USA PICKLEBALL 官方競賽手冊';
                }
            }
            if (srcLink) {
                if (isFly) {
                    srcLink.href = 'https://flywire.ai/';
                    srcLink.innerHTML = '🌐 查閱 Princeton FlyWire Nature 2024 全腦連接組 ↗';
                } else if (isPhysics) {
                    srcLink.href = 'https://www.grc.nasa.gov/www/k-12/airplane/beach.html';
                    srcLink.innerHTML = '🌐 查閱 NASA 空氣動力學教育庫 (Magnus Effect) ↗';
                } else {
                    srcLink.href = 'https://usapickleball.org/rules/';
                    srcLink.innerHTML = '🌐 閱讀 USA Pickleball 官方完整競賽手冊 ↗';
                }
            }
        }
        function dismissRotatePrompt() {
            const p = document.getElementById('rotate-prompt');
            if (p) p.style.display = 'none';
        }

        function toggleScienceDrawer(drawerId) {
            const drawer = document.getElementById(drawerId);
            if (!drawer) return;
            const isOpen = drawer.classList.contains('open');
            drawer.classList.toggle('open', !isOpen);
            const btn = drawer.querySelector('.drawer-toggle-btn');
            if (btn) {
                btn.innerHTML = !isOpen ? '▴ 收合內容' : '▾ 點擊展開';
            }
        }

        let refT = null;
        let refereeMode = parseInt(localStorage.getItem('nchu_referee_mode') || '1');
        const REFEREE_MODES = {
            1: '電視條',
            2: '球員卡',
            3: '靈動島',
            4: '3D投影'
        };

        function setRefereeMode(mode, save) {
            refereeMode = parseInt(mode) || 1;
            if (save) localStorage.setItem('nchu_referee_mode', refereeMode.toString());
            const lbl = document.getElementById('ref-mode-lbl');
            if (lbl && REFEREE_MODES[refereeMode]) lbl.innerText = REFEREE_MODES[refereeMode];
            const el = document.getElementById('referee-announcement');
            if (el) {
                el.classList.remove('mode-1', 'mode-2', 'mode-3', 'mode-4');
                el.classList.add('mode-' + refereeMode);
            }
        }

        function cycleRefereeModeQuick() {
            const next = (refereeMode % 4) + 1;
            setRefereeMode(next, true);
            toast('🎾 開始揮拍！', `轉播樣式已切換：${REFEREE_MODES[next]}`);
        }

        function announceReferee(title, detail, isFault) {
            const el = document.getElementById('referee-announcement');
            const tEl = document.getElementById('ref-title');
            const dEl = document.getElementById('ref-detail');
            if (!el || !tEl) return;

            el.classList.remove('mode-1', 'mode-2', 'mode-3', 'mode-4');
            el.classList.add('mode-' + refereeMode);

            tEl.innerText = title;
            if (dEl) dEl.innerText = detail || '';
            if (isFault) el.classList.add('fault'); else el.classList.remove('fault');
            el.classList.add('show');
            if (typeof speakReferee === 'function') speakReferee(title);
            if (refT) clearTimeout(refT);
            refT = setTimeout(() => el.classList.remove('show'), 2200);
        }