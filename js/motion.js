/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 體感 AI 與動力鏈追蹤 (Motion AI & BlazePose)
   ═══════════════════════════════════════════════════════════════════ */
        const PERF_PRESETS = {
            low: { label: '🟢 低', joints: 'CORE6', frameSkip: 3, pixelRatio: 0.8, shadow: 0, complexity: 0, skeleton: 'MINIMAL' },
            medium: { label: '🟡 中 (極速60fps)', joints: 'UPPER14', frameSkip: 2, pixelRatio: 1.2, shadow: 0, complexity: 0, skeleton: 'BASIC' },
            high: { label: '🔴 高', joints: 'UPPER14', frameSkip: 2, pixelRatio: 1.6, shadow: 512, complexity: 0, skeleton: 'SMOOTH' },
            ultra: { label: '🟣 超高', joints: 'FULL33', frameSkip: 1, pixelRatio: 2.0, shadow: 1024, complexity: 1, skeleton: 'GLOW' }
        };
        const JOINT_SETS = {
            CORE6: [11, 12, 13, 14, 15, 16],
            UPPER14: [11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 0, 7],
            FULL33: Array.from({ length: 33 }, (_, i) => i)
        };
        let perfLevel = IS_MOBILE ? 'medium' : 'high';
        let frameSkip = PERF_PRESETS[perfLevel].frameSkip;
        function applyPerfPreset(level) {
            const p = PERF_PRESETS[level]; if (!p) return;
            perfLevel = level; frameSkip = p.frameSkip;
            ren.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
            ren.setSize(window.innerWidth, window.innerHeight);
            if (sunKey) {
                const want = p.shadow > 0;
                sunKey.castShadow = want;
                if (want && sunKey.shadow.mapSize.width !== p.shadow) {
                    sunKey.shadow.mapSize.set(p.shadow, p.shadow);
                    if (sunKey.shadow.map) { sunKey.shadow.map.dispose(); sunKey.shadow.map = null; }
                }
            }
            ren.shadowMap.enabled = p.shadow > 0;
            ren.shadowMap.needsUpdate = true;
            if (poseInstance) poseInstance.setOptions({
                modelComplexity: p.complexity, smoothLandmarks: true,
                minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
            });
            syncPerfButtons();
            toast('效能分級:' + p.label, '抽樣 1/' + p.frameSkip + ' 影格 · 陰影 ' + (p.shadow || '關閉') + ' · ' + p.joints);
        }
        const POSE_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
        [23, 25], [25, 27], [24, 26], [26, 28], [15, 19], [15, 21], [16, 20], [16, 22]];
        function drawSkeleton(ctx, lm, w, h) {
            const p = PERF_PRESETS[perfLevel];
            const allow = new Set(JOINT_SETS[p.joints]);
            const px = i => ({ x: (1 - lm[i].x) * w, y: lm[i].y * h });
            ctx.lineWidth = p.skeleton === 'MINIMAL' ? 2 : 3;
            ctx.strokeStyle = servePrepared ? '#3fe0c4' : '#ffc857';
            if (p.skeleton === 'GLOW') { ctx.shadowBlur = 8; ctx.shadowColor = '#38bdf8'; }
            for (const pair of POSE_BONES) {
                const a = pair[0], b = pair[1];
                if (!allow.has(a) || !allow.has(b) || !lm[a] || !lm[b]) continue;
                const A = px(a), B = px(b);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
            }
            ctx.shadowBlur = 0;
            if (p.skeleton === 'MINIMAL') return;
            ctx.fillStyle = '#ffc857';
            for (const i of allow) {
                if (!lm[i]) continue;
                const P = px(i);
                ctx.beginPath(); ctx.arc(P.x, P.y, p.skeleton === 'GLOW' ? 3.5 : 4, 0, Math.PI * 2); ctx.fill();
            }
        }

        /* ═══════ 體感演算法 ═══════ */
        let webcamActive = false, poseInstance = null, cameraUtils = null;
        let lastWristPos = { t: performance.now() };
        let lastWristAngle = 180, lastShoulderAngle = 0, serveCooldown = 0;
        function calculateAngle(a, b, c) {
            if (!a || !b || !c) return 0;
            const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
            const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
            const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
            const m1 = Math.hypot(ab.x, ab.y, ab.z), m2 = Math.hypot(cb.x, cb.y, cb.z);
            if (!m1 || !m2) return 0;
            return Math.round(Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * (180 / Math.PI));
        }
        const NORM = { W: 0, ready: false, MIN_W: 0.04 };
        function updateShoulderWidth(lS, rS) {
            if (!lS || !rS) { NORM.ready = false; return; }
            const W = Math.hypot(lS.x - rS.x, lS.y - rS.y);
            if (W < NORM.MIN_W) { NORM.ready = false; return; }
            NORM.W = NORM.W ? NORM.W * 0.8 + W * 0.2 : W;
            NORM.ready = true;
        }
        function nd(dx, dy, dz) { return NORM.ready ? Math.hypot(dx, dy, dz || 0) / NORM.W : 0; }

        const BODY = { torsoH: 0, ready: false, WAIST_WORLD: 0.95 };
        function updateBodyScale(sh, hip) {
            if (!sh || !hip) { BODY.ready = false; return; }
            const h = Math.abs(hip.y - sh.y);
            if (h < 0.05) { BODY.ready = false; return; }
            BODY.torsoH = BODY.torsoH ? BODY.torsoH * 0.85 + h * 0.15 : h;
            BODY.ready = true;
        }
        function wristLevel(wrist, hip) {
            if (!BODY.ready || !wrist || !hip) return 0;
            return (hip.y - wrist.y) / BODY.torsoH;
        }
        function levelToWorldY(l) { return THREE.MathUtils.clamp(BODY.WAIST_WORLD + l * 0.62, 0.22, 2.0); }
        let waistLevel = 0;
        let calibT0 = 0;

        const KIN = { vEMA: 0, vPeak: 0, dtEMA: 0.04 };
        function updateKinematics(step, dtRaw) {
            KIN.dtEMA = KIN.dtEMA * 0.7 + dtRaw * 0.3;
            const dt = Math.max(0.016, KIN.dtEMA);
            const vNow = step / dt;
            KIN.vEMA = KIN.vEMA * 0.65 + vNow * 0.35;
            KIN.vPeak = Math.max(KIN.vPeak * (1 - 1.8 * dtRaw), KIN.vEMA);
        }
        const SWING = { path: 0, active: false, peakV: 0, idle: 0 };
        function accumulateSwing(step, dt) {
            if (step > 0.014) {
                SWING.active = true; SWING.idle = 0;
                SWING.path += step;
                SWING.peakV = Math.max(SWING.peakV, KIN.vPeak);
            } else if (SWING.active) {
                SWING.idle += dt;
                if (SWING.idle > 0.35) resetSwing();
            }
        }
        function resetSwing() { SWING.path = 0; SWING.peakV = 0; SWING.active = false; SWING.idle = 0; KIN.vPeak = 0; KIN.vEMA = 0; }

        const POWER_W = { a: 0.4, d: 0.6, vScale: 11, dScale: 30, min: 18, max: 92 };
        function hitPower(vPeak, pathNorm) {
            const raw = (vPeak * POWER_W.vScale * POWER_W.a) + (pathNorm * POWER_W.dScale * POWER_W.d);
            return THREE.MathUtils.clamp(Math.round(raw), POWER_W.min, POWER_W.max);
        }
        const PALM = { TH_OPEN: 0.34, TH_CLOSE: 0.26, open: false, D: 0 };
        function updatePalmOpen(lm) {
            const w = lm[16], ix = lm[19], th = lm[21];
            if (!w || !ix || !th || !NORM.ready) return;
            const dI = Math.hypot(ix.x - w.x, ix.y - w.y, (ix.z || 0) - (w.z || 0));
            const dT = Math.hypot(th.x - w.x, th.y - w.y, (th.z || 0) - (w.z || 0));
            PALM.D = (dI + dT) / (2 * NORM.W);
            if (!PALM.open && PALM.D >= PALM.TH_OPEN) PALM.open = true;
            else if (PALM.open && PALM.D < PALM.TH_CLOSE) PALM.open = false;
        }
        /* 手指 landmark 在 320x240 常失效 → 抓不到就放行,不阻擋玩家 */
        function palmGateOK(lm) {
            const vis = p => p && (p.visibility === undefined || p.visibility > 0.5);
            if (!vis(lm[19]) || !vis(lm[21])) return true;
            return PALM.open;
        }
        const SFSM = { phase: 'SETUP', power: 0, clock: 0, contactY: 0, WINDOW: 0.70, TH_V: 1.6, TH_D: 0.30 };
        const serveCue = { txt: '', col: '#ffc857', t: 0 };
        function resetServeFSM() { SFSM.phase = 'SETUP'; SFSM.power = 0; SFSM.clock = 0; SFSM.contactY = 0; resetSwing(); }
        function setServeCue(txt, col) { serveCue.txt = txt; serveCue.col = col; serveCue.t = performance.now(); }

        /**
         * 體感發球狀態機:SETUP(拍面低於腰) → IMPACT(向上推拍) → VALIDATE(收拍過肩)
         * @param {Array} lm MediaPipe poseLandmarks
         * @param {number} dt 秒
         */
        function updateServeFSM(lm, dt) {
            if (state !== 'SERVE_READY' || locked || serveCooldown > 0) return;
            if (server !== 'PLAYER') return;              // ★ 鵝發球回合不接受玩家揮拍
            const sh = lm[12], w = lm[16], hip = lm[24];
            if (!sh || !w || !hip) return;
            const palmOK = palmGateOK(lm), below = waistLevel < 0.08;

            if (SFSM.phase === 'SETUP') {
                const ok = servePrepared && palmOK && below;
                setServeCue(ok ? ('✅ 拍面低於腰 (' + (waistLevel * 100).toFixed(0) + '%),向上推拍!')
                    : (!servePrepared ? '👉 先左手舉高解鎖'
                        : !palmOK ? '✋ 右手掌心張開(準備拋球)'
                            : '⬇️ 手腕再放低 ' + Math.max(1, ((waistLevel - 0.08) * 100)).toFixed(0) + '% 才到腰下'),
                    ok ? '#3fe0c4' : '#ffc857');
                if (ok && KIN.vPeak > SFSM.TH_V * tScale() * 0.4) {
                    // ★ 擊球點必須在此刻記錄:此時手腕仍在腰下,才是真正的接觸高度。
                    //    若等到 VALIDATE(收拍過肩)才量,padW.y 已隨手腕升到 ~1.5m,必然誤判過高。
                    SFSM.contactY = padW.y;
                    SFSM.phase = 'IMPACT';
                }
                return;
            }
            if (SFSM.phase === 'IMPACT') {
                if (KIN.vPeak >= SFSM.TH_V * tScale() && SWING.path >= SFSM.TH_D * tScale()) {
                    SFSM.power = hitPower(KIN.vPeak, SWING.path);
                    SFSM.phase = 'VALIDATE'; SFSM.clock = 0;
                    setServeCue('🔼 順勢收拍!手腕抬過肩膀', '#818cf8'); S.ready();
                } else if ((SFSM.clock += dt) > 0.9) resetServeFSM();
                return;
            }
            if (SFSM.phase === 'VALIDATE') {
                SFSM.clock += dt;
                if (waistLevel >= 0.92) {
                    serveCooldown = 1.5;
                    const p = SFSM.power, cy = SFSM.contactY;   // 先取出,resetServeFSM 會清掉
                    resetServeFSM();
                    doServe(p, cy);
                } else if (SFSM.clock > SFSM.WINDOW) {
                    resetServeFSM(); toast('收拍未完成', '揮拍後手腕需抬到肩膀高度'); S.fault();
                }
            }
        }

        /* ═══════ 瞄準 ═══════ */
        const AIM = {
            mode: 'LOCKED', zones: 5, idx: 2, cand: 2, dwell: 0,
            DWELL_NEED: 0.14, HYST: 0.34, SPAN: 1.5, invert: false, raw: 0.5
        };
        const AIM_NAMES = ['◤ 貼中線', '◀ 內側', '● 區中央', '▶ 外側', '◢ 貼邊線'];
        function diagSign() { return (pPos.x >= 0) ? -1 : 1; }
        function aimZoneXAt(i) {
            const half = COURT_W / 2 - 0.4, near = 0.42;
            return diagSign() * (near + (half - near) * (i / (AIM.zones - 1)));
        }
        function aimTargetX() {
            if (AIM.mode === 'LOCKED') return diagSign() * (COURT_W / 4);
            if (AIM.mode === 'LEFT_ZONE' || AIM.mode === 'TORSO') return aimZoneXAt(AIM.idx);
            return THREE.MathUtils.clamp(padX * 3.4, -(COURT_W / 2 - 0.25), COURT_W / 2 - 0.25);
        }
        function commitAimIdx(fPos, dt) {
            const t = THREE.MathUtils.clamp(Math.round(fPos), 0, AIM.zones - 1);
            if (t !== AIM.idx && Math.abs(fPos - AIM.idx) < 0.5 + AIM.HYST) return;
            if (t === AIM.cand) {
                AIM.dwell += dt;
                if (AIM.dwell >= AIM.DWELL_NEED && t !== AIM.idx) {
                    AIM.idx = t; AIM.dwell = 0; S.tick(); syncAimPips();
                }
            } else { AIM.cand = t; AIM.dwell = 0; }
        }
        function updateAimFromLeftHand(lW, torsoX, dt) {
            if (AIM.mode !== 'LEFT_ZONE' || !lW || !NORM.ready) return;
            let t = -((lW.x - torsoX) / (NORM.W * AIM.SPAN));
            if (AIM.invert) t = -t;
            AIM.raw = THREE.MathUtils.clamp((t + 1) / 2, 0, 1);
            commitAimIdx(AIM.raw * (AIM.zones - 1), dt);
        }
        const YAW = { wMax: 0, ema: 0, DEAD: 0.14, SPAN: 0.55 };
        function updateTorsoYaw(lS, rS) {
            if (!lS || !rS) return;
            const w = Math.hypot(lS.x - rS.x, lS.y - rS.y);
            YAW.wMax = Math.max(YAW.wMax * 0.999, w);
            if (YAW.wMax < 0.04) return;
            const cosY = THREE.MathUtils.clamp(w / YAW.wMax, 0, 1);
            const mag = Math.sqrt(Math.max(0, 1 - cosY * cosY));
            const sign = Math.sign((rS.z || 0) - (lS.z || 0)) || 1;
            YAW.ema = YAW.ema * 0.8 + (sign * mag) * 0.2;
        }
        function updateAimFromTorso(dt) {
            if (AIM.mode !== 'TORSO') return;
            let v = Math.abs(YAW.ema) < YAW.DEAD ? 0 : YAW.ema;
            if (AIM.invert) v = -v;
            const t = THREE.MathUtils.clamp(v / YAW.SPAN, -1, 1);
            commitAimIdx((t + 1) / 2 * (AIM.zones - 1), dt);
        }

        /* ═══════════════════════════════════════════════
           運動學品質指標(kinematic-only,不需肢段質量)
           三項:動力鏈時序、手肘角速度佔比、重心投影 vs 支撐面
           全部僅用一階中央差分或純幾何,刻意避開二階微分
           ═══════════════════════════════════════════════ */

        /**
         * YAW.ema 是 |sin(yaw)| 的 EMA(無因次 0~1)。
         * 必須還原成角度,才能與 shA / elA(度)同單位比較。
         * @returns {number} 軀幹旋轉角(度),帶正負號
         */
        function torsoYawDeg() {
            const v = THREE.MathUtils.clamp(Math.abs(YAW.ema), 0, 1);
            return Math.asin(v) * 180 / Math.PI * (YAW.ema < 0 ? -1 : 1);
        }

        /* 固定長度環形緩衝,執行期不配置新物件 */
        const KC = {
            N: 32, n: 0, w: 0, DEBUG: false,
            t: new Float64Array(32), hip: new Float64Array(32),
            sh: new Float64Array(32), el: new Float64Array(32)
        };

        function kcReset() { KC.n = 0; KC.w = 0; }

        /**
         * @param {number} t   performance.now() 毫秒
         * @param {number} hip 軀幹旋轉角(度)
         * @param {number} sh  肩角(度)
         * @param {number} el  肘角(度)
         */
        function kcPush(t, hip, sh, el) {
            const i = KC.w;
            KC.t[i] = t; KC.hip[i] = hip; KC.sh[i] = sh; KC.el[i] = el;
            KC.w = (i + 1) % KC.N;
            if (KC.n < KC.N) KC.n++;
        }

        /** 第 j 筆(由舊到新,0-based)在環形陣列中的實際索引 */
        function kcIdx(j) { return (KC.w - KC.n + j + KC.N) % KC.N; }

        /**
         * 一階中央差分找角速度峰值。
         * @param {Float64Array} arr
         * @returns {{v:number, t:number}} v 為 deg/s;無有效資料時 v = -1
         */
        function kcPeak(arr) {
            let best = -1, bt = 0;
            for (let j = 1; j < KC.n - 1; j++) {
                const a = kcIdx(j - 1), b = kcIdx(j), c = kcIdx(j + 1);
                const dt = (KC.t[c] - KC.t[a]) / 1000;
                if (dt <= 1e-4) continue;
                const v = Math.abs((arr[c] - arr[a]) / dt);
                if (v > best) { best = v; bt = KC.t[b]; }
            }
            return { v: best, t: bt };
        }

        /**
         * 評估動力鏈:髖 → 肩 → 肘 的峰值是否依序出現。
         * ordered 僅在髖部確實參與發力時才有意義,否則為 null(不判定)。
         * @returns {?{ordered:?boolean, elbowRatio:number, hipShare:number,
         *             dt1:number, dt2:number, tol:number, hv:number, sv:number, ev:number}}
         */
        function gradeChain() {
            if (KC.n < 8) return null;
            const h = kcPeak(KC.hip), s = kcPeak(KC.sh), e = kcPeak(KC.el);
            if (h.v < 0 || s.v < 0 || e.v < 0) return null;
            /* 容忍度不可小於一個取樣間隔:低效能檔位 callback 僅約 10~15Hz */
            const span = (KC.t[kcIdx(KC.n - 1)] - KC.t[kcIdx(0)]) / Math.max(1, KC.n - 1);
            const tol = Math.max(30, span * 0.75);
            const dt1 = s.t - h.t, dt2 = e.t - s.t;
            const sum = h.v + s.v + e.v;
            const hipShare = sum > 1e-6 ? h.v / sum : 0;
            /* ★ 髖部佔比過低 → 峰值時刻為雜訊,時序判定無意義 */
            const trustOrder = hipShare >= CHAIN_TH.hipMinShare;
            const g = {
                ordered: trustOrder ? ((dt1 >= -tol) && (dt2 >= -tol)) : null,
                elbowRatio: sum > 1e-6 ? e.v / sum : 0,
                hipShare: hipShare,
                dt1: dt1, dt2: dt2, tol: tol,
                hv: h.v, sv: s.v, ev: e.v
            };
            if (KC.DEBUG) console.log('[chain] hip', h.v.toFixed(0),
                'sh', s.v.toFixed(0), 'el', e.v.toFixed(0),
                '| dt1', dt1.toFixed(0), 'dt2', dt2.toFixed(0), 'tol', tol.toFixed(0),
                '| elbowRatio', g.elbowRatio.toFixed(2),
                'hipShare', hipShare.toFixed(2), 'trust', trustOrder);
            return g;
        }

        /* elbowHigh / hipMinShare 皆為推估起始值,必須以實機資料校正(見任務 B) */
        const CHAIN_TH = { elbowHigh: 0.55, hipMinShare: 0.12, cooldownMs: 4000 };
        let chainLastMsg = 0;

        /** @param {Object} g gradeChain() 的回傳值 */
        function showChainFeedback(g) {
            const now = performance.now();
            if (now - chainLastMsg < CHAIN_TH.cooldownMs) return;
            chainLastMsg = now;
            if (g.elbowRatio > CHAIN_TH.elbowHigh) {
                toast('⚠️ 偏向純手臂發力',
                    '手肘佔比 ' + (g.elbowRatio * 100).toFixed(0) + '% · 試著先轉腰帶動肩膀');
            } else if (g.ordered === true) {
                toast('✅ 動力鏈順暢', '腰 → 肩 → 肘 依序發力,力量傳遞正確');
            } else if (g.ordered === false) {
                toast('動力鏈時序未對齊', '腰先轉、肩再帶、手肘最後收');
            } else {
                toast('腰部參與度偏低', '軀幹旋轉幅度不足,先從轉腰開始練');
            }
        }

        /* ═══════ 重心投影 vs 雙腳支撐面(零微分,可即時) ═══════ */
        let stanceBal = 0, stanceOK = false;

        /**
         * 以骨盆 0.6 + 肩線 0.4 加權近似 COM,除以雙腳半寬正規化。
         * @param {Array} lm MediaPipe poseLandmarks(33 點)
         */
        function updateStance(lm) {
            const lH = lm[23], rH = lm[24], lA = lm[27], rA = lm[28], lS = lm[11], rS = lm[12];
            const vis = p => p && (p.visibility === undefined || p.visibility > 0.5);
            if (!vis(lH) || !vis(rH) || !vis(lA) || !vis(rA) || !vis(lS) || !vis(rS)) {
                stanceOK = false; return;              // 腳未入鏡 → 不判定,不阻擋玩家
            }
            const aL = Math.min(lA.x, rA.x), aR = Math.max(lA.x, rA.x);
            const halfW = (aR - aL) / 2;
            if (halfW < 0.02) { stanceOK = false; return; }   // 雙腳併攏,支撐面無意義
            const comX = ((lH.x + rH.x) / 2) * 0.6 + ((lS.x + rS.x) / 2) * 0.4;
            const mid = (aL + aR) / 2;
            stanceBal = THREE.MathUtils.clamp((comX - mid) / halfW, -2, 2);
            stanceOK = true;
        }

        function updateStanceHud() {
            if (!webcamActive) return;
            const el = document.getElementById('stance-mark');
            if (!el) return;
            if (!stanceOK) { el.style.background = 'rgba(255,255,255,.3)'; return; }
            el.style.left = ((stanceBal + 2) / 4 * 100).toFixed(1) + '%';
            const m = Math.abs(stanceBal);
            el.style.background = (m < 1) ? '#3fe0c4' : (m < 1.4 ? '#ffc857' : '#f87171');
        }

        function setStanceRowVisible(on) {
            const r = document.getElementById('stance-row');
            if (r) r.style.display = on ? 'flex' : 'none';
        }

        /* ═══════ 場次動作統計(報告用,不上傳後端) ═══════ */
        const MSTAT = {
            swings: 0, ordered: 0, orderedN: 0, elbowSum: 0, elbowMax: 0,
            hipShareSum: 0, stanceBad: 0, stanceN: 0
        };

        /** @param {Object} g gradeChain() 的回傳值 */
        function motionStatsAdd(g) {
            MSTAT.swings++;
            if (g.ordered !== null) { MSTAT.orderedN++; if (g.ordered) MSTAT.ordered++; }
            MSTAT.elbowSum += g.elbowRatio;
            MSTAT.hipShareSum += (g.hipShare || 0);
            if (g.elbowRatio > MSTAT.elbowMax) MSTAT.elbowMax = g.elbowRatio;
            if (stanceOK) { MSTAT.stanceN++; if (Math.abs(stanceBal) >= 1) MSTAT.stanceBad++; }
        }

        /** @returns {?Object} 無揮拍紀錄時回傳 null */
        function motionSummary() {
            if (!MSTAT.swings) return null;
            return {
                swings: MSTAT.swings,
                orderedRate: MSTAT.orderedN ? +(MSTAT.ordered / MSTAT.orderedN).toFixed(3) : null,
                orderedSamples: MSTAT.orderedN,
                elbowRatioMean: +(MSTAT.elbowSum / MSTAT.swings).toFixed(3),
                elbowRatioMax: +MSTAT.elbowMax.toFixed(3),
                hipShareMean: +(MSTAT.hipShareSum / MSTAT.swings).toFixed(3),
                stanceOutRate: MSTAT.stanceN ? +(MSTAT.stanceBad / MSTAT.stanceN).toFixed(3) : null,
                stanceSamples: MSTAT.stanceN
            };
        }
        window.motionSummary = motionSummary;   // 供 Console 直接查詢

        /* ═══════════════════════════════════════════════
           🏸 滑動速度向量與指向感應模組 (Swipe Kinematics)
           ═══════════════════════════════════════════════ */
        const SWIPE = {
            active: false,
            prevX: 0,
            prevY: 0,
            lastTime: 0,
            vx: 0,         // px/s 水平速度 (右正左負)
            vy: 0,         // px/s 垂直推拍速度 (上推為正)
            smoothedVx: 0,
            smoothedVy: 0,
            peakVx: 0,
            peakVy: 0,
            spin: 0
        };

        function swipeStart(x, y) {
            dismissFingerTutorial();
            const now = performance.now();
            SWIPE.active = true;
            SWIPE.prevX = x;
            SWIPE.prevY = y;
            SWIPE.lastTime = now;
            SWIPE.vx = SWIPE.vy = 0;
            SWIPE.smoothedVx = SWIPE.smoothedVy = 0;
            SWIPE.peakVx = SWIPE.peakVy = 0;
            SWIPE.spin = 0;
        }

        function swipeMove(x, y) {
            if (!SWIPE.active) return;
            const now = performance.now();
            const dt = Math.max(0.004, Math.min(0.08, (now - SWIPE.lastTime) / 1000));
            SWIPE.lastTime = now;

            const dx = x - SWIPE.prevX;
            const dy = SWIPE.prevY - y; // 向上為正

            const instVx = dx / dt;
            const instVy = dy / dt;

            // EMA 指數滑動平均
            const alpha = 0.65;
            SWIPE.smoothedVx = instVx * alpha + SWIPE.smoothedVx * (1 - alpha);
            SWIPE.smoothedVy = instVy * alpha + SWIPE.smoothedVy * (1 - alpha);

            SWIPE.vx = SWIPE.smoothedVx;
            SWIPE.vy = SWIPE.smoothedVy;

            if (Math.abs(SWIPE.vx) > Math.abs(SWIPE.peakVx)) SWIPE.peakVx = SWIPE.vx;
            if (SWIPE.vy > SWIPE.peakVy) SWIPE.peakVy = SWIPE.vy;

            // ★ v5.0.9 側旋量即時估算 (提高分母門檻，僅在顯著橫切時提供微側旋參考)
            const brushRatio = SWIPE.vx / Math.max(160, Math.abs(SWIPE.vy) + 120);
            SWIPE.spin = THREE.MathUtils.clamp((SWIPE.vx / 900) * 0.45 + brushRatio * 0.20, -0.45, 0.45);

            SWIPE.prevX = x;
            SWIPE.prevY = y;
            SWIPE.currX = x;
            SWIPE.currY = y;
        }

        function swipeEnd() {
            SWIPE.active = false;
        }

        /* ═══════════════════════════════════════════════
           👆 新手手指動畫示範控制器 (Finger Tutorial)
           ═══════════════════════════════════════════════ */
        let fingerTutActive = true;
        let fingerAnimTimer = null;
        let fingerAnimStep = 0; // 0: straight, 1: right curve, 2: left curve
        let fingerAnimProgress = 0;

        /* ═══════════════════════════════════════════════
           📐 版面風格切換預覽控制器 (Layout Preview Switch)
           支援: V4 第一版經典對稱三欄版面 (預設) vs V5 雙角簡約版面
           ═══════════════════════════════════════════════ */
        function initLayoutMode() {
            const savedLayout = localStorage.getItem('nchu_pb_layout');
            // 預設採用使用者最喜歡的第一版 (V4 經典三欄對稱)
            if (savedLayout === 'v5') {
                document.body.classList.remove('layout-v4');
            } else {
                document.body.classList.add('layout-v4');
            }
            updateLayoutBtnText();
        }

        function toggleLayoutPreview() {
            const isV4 = document.body.classList.toggle('layout-v4');
            localStorage.setItem('nchu_pb_layout', isV4 ? 'v4' : 'v5');
            updateLayoutBtnText();
            if (typeof toast === 'function') {
                toast(
                    isV4 ? '📐 已切換為 V4 經典三欄版面' : '📐 已切換為 V5 雙角簡約版面',
                    isV4 ? '左上關卡 · 中央選單 · 右上比分板 (第一版經典)' : '左上關卡 · 右上選單 · 中央開闊'
                );
            }
        }

        function updateLayoutBtnText() {
            const btn = document.getElementById('layout-toggle-btn');
            const isV4 = document.body.classList.contains('layout-v4');
            if (btn) {
                btn.innerHTML = isV4 ? '📐 V4經典(三欄)' : '📐 V5雙角';
            }
        }

        /* ═══════════════════════════════════════════════
           📐 手機/觸控卡片自主滑動縮放控制器 (Card Scale & Resize Controller)
           支援: 角落拖曳滑動縮放、雙指捏合縮放、設定滑桿與本機存檔記憶
           ═══════════════════════════════════════════════ */
        let cardScales = { info: 1.0, board: 1.0 };

        function initCardResize() {
            // 讀取本機偏好
            const savedInfo = localStorage.getItem('nchu_info_scale');
            const savedBoard = localStorage.getItem('nchu_board_scale');
            if (savedInfo) setCardScale('info', parseFloat(savedInfo), false);
            else setCardScale('info', 1.0, false);
            if (savedBoard) setCardScale('board', parseFloat(savedBoard), false);
            else setCardScale('board', 1.0, false);

            const tooltip = document.getElementById('scale-tooltip');

            // 綁定各卡片角落手柄拖曳事件 (支援手機觸控滑動與滑鼠拖曳)
            document.querySelectorAll('.card-resize-handle').forEach(handle => {
                const target = handle.dataset.target;
                const card = document.getElementById(target);
                if (!card) return;

                let startX = 0, startY = 0, startScale = 1.0, isDragging = false;

                handle.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    startScale = cardScales[target] || 1.0;
                    try { handle.setPointerCapture(e.pointerId); } catch (_) {}

                    if (tooltip) {
                        tooltip.style.display = 'block';
                        tooltip.style.left = Math.min(window.innerWidth - 80, Math.max(10, e.clientX)) + 'px';
                        tooltip.style.top = Math.max(10, e.clientY - 40) + 'px';
                        tooltip.innerText = `🔍 ${Math.round(startScale * 100)}%`;
                    }
                });

                handle.addEventListener('pointermove', (e) => {
                    if (!isDragging) return;
                    e.stopPropagation();
                    e.preventDefault();

                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;

                    // #info 右下拖曳: 向右下放大，向左上縮小
                    // #board 左下拖曳: 向左下放大，向右上縮小
                    const delta = (target === 'info')
                        ? (dx + dy) / 200
                        : (-dx + dy) / 200;

                    const newScale = Math.min(1.80, Math.max(0.50, startScale + delta));
                    setCardScale(target, newScale, false);

                    if (tooltip) {
                        tooltip.style.left = Math.min(window.innerWidth - 80, Math.max(10, e.clientX)) + 'px';
                        tooltip.style.top = Math.max(10, e.clientY - 40) + 'px';
                        tooltip.innerText = `🔍 ${Math.round(newScale * 100)}%`;
                    }
                });

                const endDrag = (e) => {
                    if (!isDragging) return;
                    isDragging = false;
                    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
                    if (tooltip) tooltip.style.display = 'none';
                    setCardScale(target, cardScales[target], true);
                    if (typeof syncSubbarStates === 'function') syncSubbarStates();
                    if (typeof toast === 'function') {
                        const name = (target === 'info') ? '關卡框' : '比分板';
                        toast(`📐 ${name} 尺寸已設定`, `目前縮放比例：${Math.round(cardScales[target] * 100)}%（已記憶）`);
                    }
                };

                handle.addEventListener('pointerup', endDrag);
                handle.addEventListener('pointercancel', endDrag);

                // 雙擊手柄快速重設為 100%
                handle.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setCardScale(target, 1.0, true);
                    if (typeof syncSubbarStates === 'function') syncSubbarStates();
                    if (typeof toast === 'function') {
                        const name = (target === 'info') ? '關卡框' : '比分板';
                        toast(`📐 ${name} 已重置`, '恢復 100% 預設大小');
                    }
                });
            });

            // 雙指捏合縮放 (Pinch-to-zoom: 保留雙指自由縮放，支援 touchcancel 防呆)
            ['info', 'board'].forEach(id => {
                const card = document.getElementById(id);
                if (!card) return;
                let pinchDist0 = 0, pinchScale0 = 1.0;

                card.addEventListener('touchstart', (e) => {
                    if (e.touches.length === 2) {
                        const dx = e.touches[0].clientX - e.touches[1].clientX;
                        const dy = e.touches[0].clientY - e.touches[1].clientY;
                        pinchDist0 = Math.hypot(dx, dy);
                        pinchScale0 = cardScales[id] || 1.0;
                    }
                }, { passive: true });

                card.addEventListener('touchmove', (e) => {
                    if (e.touches.length === 2 && pinchDist0 > 10) {
                        const dx = e.touches[0].clientX - e.touches[1].clientX;
                        const dy = e.touches[0].clientY - e.touches[1].clientY;
                        const dist = Math.hypot(dx, dy);
                        const ratio = dist / pinchDist0;
                        const newScale = Math.min(1.80, Math.max(0.50, pinchScale0 * ratio));
                        setCardScale(id, newScale, false);
                    }
                }, { passive: true });

                const endPinch = (e) => {
                    if (pinchDist0 > 0 && e.touches.length < 2) {
                        pinchDist0 = 0;
                        setCardScale(id, cardScales[id], true);
                        if (typeof syncSubbarStates === 'function') syncSubbarStates();
                    }
                };
                card.addEventListener('touchend', endPinch, { passive: true });
                card.addEventListener('touchcancel', endPinch, { passive: true });
            });
        }

        function setCardScale(target, scale, save) {
            const clamped = Math.min(1.80, Math.max(0.50, parseFloat(scale)));
            cardScales[target] = clamped;

            document.documentElement.style.setProperty(`--${target}-scale`, clamped.toFixed(2));

            // 更新滑桿與文字指示
            const slider = document.getElementById(`${target}-scale-slider`);
            const txt = document.getElementById(`${target}-scale-txt`);
            if (slider) slider.value = Math.round(clamped * 100);
            if (txt) txt.innerText = Math.round(clamped * 100) + '%';

            const quickLbl = document.getElementById('quick-scale-lbl');
            if (quickLbl) quickLbl.innerText = Math.round(clamped * 100) + '%';

            if (save) {
                localStorage.setItem(`nchu_${target}_scale`, clamped.toFixed(2));
            }
        }

        function resetCardScales() {
            setCardScale('info', 1.0, true);
            setCardScale('board', 1.0, true);
            if (typeof toast === 'function') {
                toast('📐 卡片尺寸已還原', '左上關卡框與右上比分板皆已恢復 100% 預設大小');
            }
        }

        function initFingerTutorial() {
            const overlay = document.getElementById('finger-tutorial');
            if (!overlay) return;
            // ★ v5.0.11: 啟動時預設隱藏，絕不污染登入畫面
            overlay.classList.add('hidden');
            overlay.addEventListener('pointerdown', dismissFingerTutorial);
        }

        function showFingerTutorial(stepMode) {
            fingerTutActive = true;
            if (typeof stepMode === 'number') fingerAnimStep = stepMode;
            fingerAnimProgress = 0;
            const overlay = document.getElementById('finger-tutorial');
            if (overlay) overlay.classList.remove('hidden');
            if (!fingerAnimTimer) runFingerAnimation();
        }
        function triggerFingerDemoSwipe(mode) {
            fingerTutActive = true;
            if (typeof mode === 'number') fingerAnimStep = mode;
            fingerAnimProgress = 0.55;
            const overlay = document.getElementById('finger-tutorial');
            if (overlay) overlay.classList.remove('hidden');
            if (!fingerAnimTimer) runFingerAnimation();
        }
        function dismissFingerTutorial() {
            if (!fingerTutActive) return;
            fingerTutActive = false;
            const overlay = document.getElementById('finger-tutorial');
            if (overlay) overlay.classList.add('hidden');
            if (fingerAnimTimer) { cancelAnimationFrame(fingerAnimTimer); fingerAnimTimer = null; }
            // ★ v5.0.7: 示範結束後恢復選單與 HUD 顯示
            if (!demoOn) document.body.classList.remove('demo-mode-active');
            toast('🎾 開始揮拍！', '向前滑動推球 · 左右刷拍側旋');
        }

        function runFingerAnimation() {
            if (!fingerTutActive) return;
            const hand = document.getElementById('finger-tut-hand');
            const trail = document.getElementById('finger-tut-trail');
            const desc = document.getElementById('finger-tut-desc');
            const p1 = document.getElementById('tut-mode-1');
            const p2 = document.getElementById('tut-mode-2');
            const p3 = document.getElementById('tut-mode-3');

            fingerAnimProgress += 0.016;
            if (fingerAnimProgress >= 1.0) {
                fingerAnimProgress = 0;
                fingerAnimStep = (fingerAnimStep + 1) % 3;
            }

            const t = fingerAnimProgress;
            const easeT = Math.sin(t * Math.PI * 0.5);

            let startX = 0, startY = 0;
            let targetX = 0, targetY = -95;
            let pathD = '';

            if (fingerAnimStep === 0) {
                // 1. 直線前推打深球
                targetX = 0; targetY = -100;
                const currX = startX + (targetX - startX) * easeT;
                const currY = startY + (targetY - startY) * easeT;
                if (hand) hand.style.transform = 'translate(' + currX + 'px, ' + currY + 'px)';
                if (p1 && p2 && p3) { p1.className = 'finger-mode-pill on'; p2.className = 'finger-mode-pill'; p3.className = 'finger-mode-pill'; }
                if (desc) desc.innerHTML = '👆 <b>直線快速前推</b> (Fast Upward Swipe)<br><span style="color:var(--ok);">➔ 爆發力道打出後場深球</span>';
                pathD = '<path d="M 110 145 L 110 ' + (145 + currY) + '" stroke="#38bdf8" stroke-width="3" stroke-dasharray="4 4" fill="none" opacity="' + (1 - t*0.25) + '"/>';
            } else if (fingerAnimStep === 1) {
                // 2. 右刷拍側旋弧線
                targetX = 60; targetY = -85;
                const currX = startX + (targetX - startX) * easeT;
                const currY = startY + (targetY - startY) * Math.sin(easeT * Math.PI * 0.5);
                if (hand) hand.style.transform = 'translate(' + currX + 'px, ' + currY + 'px) rotate(15deg)';
                if (p1 && p2 && p3) { p1.className = 'finger-mode-pill'; p2.className = 'finger-mode-pill on'; p3.className = 'finger-mode-pill'; }
                if (desc) desc.innerHTML = '🌪️ <b>向右上刷拍</b> (Swipe Up-Right)<br><span style="color:#c084fc;">➔ 觸發右側旋香蕉弧線球 (Right Curve)</span>';
                pathD = '<path d="M 110 145 Q 130 110 ' + (110 + currX) + ' ' + (145 + currY) + '" stroke="#c084fc" stroke-width="3" stroke-dasharray="4 4" fill="none" opacity="' + (1 - t*0.25) + '"/>';
            } else {
                // 3. 左刷拍側旋弧線
                targetX = -60; targetY = -85;
                const currX = startX + (targetX - startX) * easeT;
                const currY = startY + (targetY - startY) * Math.sin(easeT * Math.PI * 0.5);
                if (hand) hand.style.transform = 'translate(' + currX + 'px, ' + currY + 'px) rotate(-15deg)';
                if (p1 && p2 && p3) { p1.className = 'finger-mode-pill'; p2.className = 'finger-mode-pill'; p3.className = 'finger-mode-pill on'; }
                if (desc) desc.innerHTML = '🌪️ <b>向左上刷拍</b> (Swipe Up-Left)<br><span style="color:#c084fc;">➔ 觸發左側旋香蕉弧線球 (Left Curve)</span>';
                pathD = '<path d="M 110 145 Q 90 110 ' + (110 + currX) + ' ' + (145 + currY) + '" stroke="#c084fc" stroke-width="3" stroke-dasharray="4 4" fill="none" opacity="' + (1 - t*0.25) + '"/>';
            }

            if (trail) trail.innerHTML = '<svg>' + pathD + '</svg>';
            fingerAnimTimer = requestAnimationFrame(runFingerAnimation);
        }

        /* ═══════════════════════════════════════════════
           📊 體感與動力鏈審計日誌模組 (Kinematic Audit Log)
           ═══════════════════════════════════════════════ */