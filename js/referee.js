/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 虛擬裁判、競賽計分與官方規則 (Referee & Competition)
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════ 競賽狀態與發球/得分機制 (Side-out Scoring State) ═══════ */
        let stage = 1, state = 'SERVE_READY';
        let pScore = 0, aScore = 0, legalServes = 0, twoBounceDone = 0;
        let rallyHits = 0, bounces = 0, lastHitter = 'NONE';
        let serveFromRight = true, serveSide = 1, locked = false;
        const pPos = { x: 1.5, z: HALF_L + 0.35 };
        const keys = { w: false, a: false, s: false, d: false };
        const mouse = new THREE.Vector2(0, -0.22);
        let padX = 0, padY = 0.78;
        let charging = false, power = 0, powerDir = 1, powerBarDisplay = 0;
        let swingT = 0, swingP = 0, pLock = 0, gLock = 0;
        let serveLegal = true, pulse = 0, shake = 0, ballSquash = 0;
        let servePrepared = false;


/* ═══════ 計分判定、發球權轉換、規則手冊與虛擬裁判廣播 ═══════ */
        function endRally(scorer, msg, sub) {
            if (locked || demoOn) return;
            if (state === 'FAULT' || state === 'OVER') return;
            updateLastAuditOutcome(msg, sub);
            if (!scoring()) { fail(msg, sub); return; }   // ★ 練習關轉交 fail(),不扣分
            state = 'FAULT'; freeze();

            const isMatch = (stage === 4 || stage === 5);
            if (isMatch) {
                // ★ 規格 8: 正式匹克球發球得分制 (Side-out Scoring)
                if (scorer === server) {
                    // 發球方贏得回合 ➔ 得 1 分 + 換至另一側繼續發球
                    if (server === 'PLAYER') {
                        pScore++; S.point(); popRing(0, -3, 6, 0x3fe0c4);
                        toast('🏆 玩家得分！換邊發球', '比分 ' + pScore + ' - ' + aScore);
                    } else {
                        aScore++; S.fault(); addShake(0.22);
                        toast('🪿 匹克鵝得分！換邊發球', '比分 ' + pScore + ' - ' + aScore);
                    }
                    serveSide *= -1;
                    secondServe = false; // 得分繼續保有第 1 次發球權
                } else {
                    // 接球方贏得回合 ➔ 不得分, 破壞對方發球權 (Fault / Side-out)
                    if (scorer === 'PLAYER') S.point(); else { S.fault(); addShake(0.22); }
                    if (!secondServe) {
                        // 第一次失誤 ➔ 換邊進行 Second Serve
                        secondServe = true;
                        serveSide *= -1;
                        toast('⚠️ ' + msg + ' (Second Serve)', (server === 'PLAYER' ? '玩家' : '匹克鵝') + ' 第 2 次發球機會 · 換邊');
                    } else {
                        // 第二次失誤 ➔ 觸發 Side-out 換球權!
                        secondServe = false;
                        server = (server === 'PLAYER' ? 'GOOSE' : 'PLAYER');
                        serveSide = 1; // 換球權由右側開始發球
                        toast('🔄 Side-out 換球權！', '輪到 ' + (server === 'PLAYER' ? '玩家' : '匹克鵝') + ' 右側發球');
                    }
                }
            } else {
                if (scorer === 'PLAYER') { pScore++; S.point(); popRing(0, -3, 6, 0x3fe0c4); }
                else { aScore++; S.fault(); addShake(0.22); }
                toast(msg, sub || '按空白鍵重新發球');
            }

            updateScore(); updateGoal();
            const goal = STAGES[stage].goal;
            if (stage === 3 || stage === 4 || stage === 5) {
                if (pScore >= goal) { clearStage(); return; }
                if (aScore >= goal) {
                    state = 'OVER'; clearTimers();
                    toast(stage === 5 ? '魔王匹克鵝獲勝!' : ('匹克鵝先得 ' + goal + ' 分'), '3 秒後重新挑戰');
                    later(() => switchStage(stage), 3000); return;
                }
            }
            later(resetServe, 2200);
        }
        function fail(msg, sub) {
            if (locked || demoOn) return;
            if (state === 'FAULT' || state === 'OVER') return;
            updateLastAuditOutcome(msg, sub);
            state = 'FAULT'; freeze(); S.fault(); addShake(0.14);
            toast(msg, sub || '練習關不扣分,按空白鍵重來');
            later(resetServe, 1650);
        }
        function serveFail(msg, sub) { if (scoring()) endRally(server === 'PLAYER' ? 'GOOSE' : 'PLAYER', msg, sub); else fail(msg, sub); }
        function clearStage() {
            updateLastAuditOutcome('關卡順利通過');
            state = 'FAULT'; freeze(); clearTimers(); locked = true; S.point();
            popRing(0, 2, 8, 0xffc857);
            toast('STAGE ' + stage + ' CLEARED', stage < 5 ? '自動進入下一關' : '🏆 恭喜擊敗中興湖魔王!登錄英雄榜');
            if (stage < 5) later(() => switchStage(stage + 1), 2100);
            else later(() => { locked = false; resetServe(); submitScoreToCloud(pScore); }, 2100);
        }
        function forfeitMatch() {
            closePanel();
            if (state === 'OVER' || demoOn) return;
            if (confirm('確定棄賽直接結算比分?')) {
                state = 'OVER'; clearTimers();
                toast('🏳️ 玩家選擇棄賽', '最終比分:' + pScore + ' - ' + aScore);
                later(() => {
                    if (stage === 5 && pScore > 0) submitScoreToCloud(pScore);
                    resetServe();
                }, 1800);
            }
        }
        let toastT = null;
        function toast(main, sub) {
            D.tMain.innerText = main; D.tSub.innerText = sub || '';
            D.tMain.classList.add('on');
            if (toastT) clearTimeout(toastT);
            toastT = setTimeout(() => D.tMain.classList.remove('on'), 1900);

            // ★ V5 虛擬裁判膠囊同步廣播
            const isFault = (main.indexOf('FAULT') !== -1 || main.indexOf('失誤') !== -1 || main.indexOf('違規') !== -1 || main.indexOf('出界') !== -1 || main.indexOf('❌') !== -1);
            announceReferee(main, sub, isFault);
        }
        function updateScore() {
            updatePlayerWhoLabel(); D.pv.innerText = pScore; D.av.innerText = aScore; updateScore3D(); }
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
            const isPhysics = (tab === 'physics');
            const btnRules = document.getElementById('rtab-btn-rules');
            const btnPhys = document.getElementById('rtab-btn-physics');
            const paneRules = document.getElementById('rtab-pane-rules');
            const panePhys = document.getElementById('rtab-pane-physics');
            const titleEl = document.getElementById('rules-modal-main-title');
            const srcLink = document.getElementById('rules-modal-source-link');

            if (btnRules) btnRules.classList.toggle('on', !isPhysics);
            if (btnPhys) btnPhys.classList.toggle('on', isPhysics);
            if (paneRules) paneRules.style.display = isPhysics ? 'none' : 'block';
            if (panePhys) panePhys.style.display = isPhysics ? 'block' : 'none';

            if (titleEl) {
                titleEl.innerHTML = isPhysics ? '🌪️ 匹克球流體力學與馬格努斯效應科普' : '📖 2026 USA PICKLEBALL 官方競賽手冊';
            }
            if (srcLink) {
                if (isPhysics) {
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

            tEl.innerHTML = title;
            if (dEl) dEl.innerText = detail || '';
            if (isFault) el.classList.add('fault'); else el.classList.remove('fault');
            el.classList.add('show');
            if (refT) clearTimeout(refT);
            refT = setTimeout(() => el.classList.remove('show'), 2200);
        }