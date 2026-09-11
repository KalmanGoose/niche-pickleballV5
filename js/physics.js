/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 3D 物理引擎與馬格努斯效應 (Physics Engine)
   ═══════════════════════════════════════════════════════════════════ */
        class Physics {
            constructor() {
                this.pos = new THREE.Vector3(0, 1, HALF_L);
                this.vel = new THREE.Vector3();
                this.spin = 0;      // 側旋量 (-1.0 ~ 1.0)
                this.spinInc = 0;   // 側旋累積偏折位移
            }
            sync() {
                ball.position.copy(this.pos);
                const sq = ballSquash;
                ball.scale.set(1 + sq * 0.26, 1 - sq * 0.34, 1 + sq * 0.26);
                ballGlow.position.copy(this.pos);
                const spd = this.vel.length();
                ballGlow.material.opacity = 0.16 + Math.min(0.26, spd * 0.02);
                // ★ v5.0.2 側旋強烈時動態變換尾隨氣流光暈
                if (Math.abs(this.spin) >= 0.25) {
                    ballGlow.material.color.set(this.spin > 0 ? 0xd3f36c : 0x818cf8);
                    ballGlow.material.opacity = 0.42;
                } else {
                    ballGlow.material.color.set(0x38bdf8);
                }
                for (let i = ballTrail.length - 1; i > 0; i--) ballTrail[i].p.copy(ballTrail[i - 1].p);
                ballTrail[0].p.copy(this.pos);
                const on = spd > 3.2;
                for (let i = 0; i < ballTrail.length; i++) {
                    const tr = ballTrail[i], f = 1 - i / ballTrail.length;
                    tr.spr.position.copy(tr.p);
                    const sc = BALL_R * 4.2 * f;
                    tr.spr.scale.set(sc, sc, 1);
                    tr.spr.material.opacity = on ? 0.24 * f * f : 0;
                }
                ballBlob.position.set(this.pos.x, 0.014, this.pos.z);
                const hh = THREE.MathUtils.clamp(this.pos.y, 0, 3.2);
                const bs = THREE.MathUtils.lerp(BALL_R * 3.1, BALL_R * 6.4, hh / 3.2);
                ballBlob.scale.set(bs, bs, 1);
                ballBlob.material.opacity = THREE.MathUtils.lerp(0.5, 0.09, hh / 3.2);
            }
            setPos(x, y, z) { this.pos.set(x, y, z); if (ball) this.sync(); }
            reset(x, y, z) { this.setPos(x, y, z); this.vel.set(0, 0, 0); this.spin = 0; this.spinInc = 0; }
            update(dt) {
                if (state === 'SERVE_READY' || state === 'FAULT' || state === 'OVER') { this.sync(); return; }
                const H = 1 / 240;
                let rem = dt, guard = 0;
                while (rem > 1e-6 && guard++ < 30) {
                    const h = Math.min(H, rem); rem -= h;
                    if (!this.step(h)) break;
                }
                this.sync();
            }
            step(h) {
                const pz = this.pos.z;
                this.vel.y -= GRAVITY * h;

                // ★ v5.0.8 側旋物理精密矯正: 直推絕對筆直零偏漂，刻意側刷呈現自然平穩的香蕉弧線 (0.7m~0.9m)
                if (Math.abs(this.spin) > 0.08) {
                    const curveFlightFactor = Math.sin(Math.min(1, Math.abs(this.pos.z) / HALF_L) * Math.PI);
                    // ★ v5.0.9 匹克球多孔真實空氣動力微側旋: 係數收窄至 1/5，真實賽場微弧線 (極限 0.15m~0.22m)，絕不滿場亂飛
                    const magnusAcc = (this.spin * 2.8 + Math.sign(this.spin) * Math.pow(this.spin, 2) * 1.2) * (0.8 + 0.5 * curveFlightFactor);
                    const outDist = Math.max(0, Math.abs(this.pos.x) - (COURT_W / 2 + 0.2));
                    const softGuard = THREE.MathUtils.clamp(1.0 - (outDist / 0.8), 0.2, 1.0);

                    this.spinInc = THREE.MathUtils.clamp(this.spinInc + magnusAcc * h * softGuard, -2.2, 2.2);
                    this.pos.x += this.spinInc * h;
                    this.spin *= (1 - 0.35 * h); // 多孔擾流自旋自然衰減
                } else {
                    this.spinInc = 0; // 零側旋保證 100% 筆直前進，徹底杜絕自動偏飄
                }

                // ★ v5.0.2 空氣阻力物理衰減 (Air Drag: 初速破空、尾端柔和減速)
                this.vel.x *= (1 - 0.12 * h);
                this.vel.z *= (1 - 0.12 * h);

                this.pos.addScaledVector(this.vel, h);
                if (pz !== this.pos.z && pz * this.pos.z <= 0) {
                    if (this.pos.y < NET_H + BALL_R && Math.abs(this.pos.x) < COURT_W / 2 + 0.2) {
                        this.pos.z = 0; this.vel.set(0, 0, 0);
                        S.net(); addShake(0.1);
                        popRing(this.pos.x, 0.05, 2, 0xff5555);
                        onNet(); return false;
                    }
                }
                if (this.pos.y <= BALL_R && this.vel.y < 0) {
                    this.pos.y = BALL_R;
                    const imp = Math.abs(this.vel.y);
                    if (imp < DEAD_VY) { this.vel.set(0, 0, 0); onDead(); return false; }
                    this.vel.y = -this.vel.y * REST_Y;
                    this.vel.x *= REST_XZ;
                    this.vel.z *= REST_XZ;
                    this.spin *= 0.35; // 落地彈跳大幅衰減側旋
                    this.spinInc = 0;  // ★ 落地瞬間側向滑動速度歸零，防止球在地面橫向滑移
                    ballSquash = Math.min(1, imp / 7);
                    S.thump(imp / 8);
                    popRing(this.pos.x, this.pos.z, 1.6 + imp * 0.14, 0xffffff);
                    onBounce();
                    return (state === 'RALLY' || state === 'SERVE_AIR' || state === 'DEMO');
                }
                return true;
            }
        }
        const PH = new Physics();

        function predictLanding(out) {
            const a = -0.5 * GRAVITY, b = PH.vel.y, c = PH.pos.y - BALL_R;
            const disc = b * b - 4 * a * c;
            if (disc < 0) return false;
            const t = (-b - Math.sqrt(disc)) / (2 * a);
            if (!(t > 0) || t > 6) return false;
            out.set(PH.pos.x + PH.vel.x * t, 0.016, PH.pos.z + PH.vel.z * t);
            return true;
        }
        function predictApex() {
            _pp.copy(PH.pos);
            _pv.copy(PH.vel);
            const h = 1 / 180;
            let bounced = false, t = 0;
            for (let i = 0; i < 1200; i++) {
                _pv.y -= GRAVITY * h;
                _pp.addScaledVector(_pv, h); t += h;
                if (_pp.y <= BALL_R && _pv.y < 0) {
                    _pp.y = BALL_R;
                    if (bounced) return null;
                    if (Math.abs(_pv.y) < DEAD_VY) return null;
                    if (_pp.z > -0.05) return null;
                    _pv.y = -_pv.y * REST_Y;
                    _pv.x *= REST_XZ;
                    _pv.z *= REST_XZ;
                    bounced = true; continue;
                }
                if (bounced && _pv.y <= 0) return { x: _pp.x, y: _pp.y, z: _pp.z, t: t };
            }
            return null;
        }
        let server = 'PLAYER';          // 'PLAYER' | 'GOOSE'
        let secondServe = false;        // 是否進入第 2 次發球機會

        function needBounce() { return stage >= 2 && rallyHits < 3; }
        function scoring() { return stage >= 4; } // 前三關為練習關,失誤只重試不計分

        function onNet() {
            if (demoOn) return;
            if (scoring()) endRally(lastHitter === 'GOOSE' ? 'PLAYER' : 'GOOSE', '掛網', '球沒過網');
            else fail('掛網', '擊球點再放低一點,往前送出去');
        }
        function onBounce() {
            if (demoOn) return;
            bounces++;
            const x = PH.pos.x, z = PH.pos.z;
            if (bounces === 1) {
                const inCourt = Math.abs(x) <= COURT_W / 2 + BALL_R && Math.abs(z) <= HALF_L + BALL_R;
                if (!inCourt) {
                    if (state === 'SERVE_AIR') serveFail('發球出界', '力道略減,看落點圈瞄準對角區');
                    else if (scoring()) endRally(lastHitter === 'GOOSE' ? 'PLAYER' : 'GOOSE', '界外球', '第一次落地必須在白線內');
                    else fail('界外球', '控制力道與方向');
                    return;
                }
                if (state === 'SERVE_AIR') { checkServeLanding(x, z); return; }
                if (stage >= 3 && lastHitter === 'GOOSE' && z > 0 && z < KITCHEN_D)
                    toast('球落進你的中興湖畔', '等它彈起來再輕推,別空中截擊');
                return;
            }
            if (scoring()) {
                if (lastHitter === 'PLAYER') endRally('PLAYER', '得分', '球在對面落地兩次');
                else endRally('GOOSE', '失分', '球在你這側落地兩次');
            } else fail('回合結束', '按空白鍵重新開始');
        }
        function onDead() {
            if (demoOn) return;
            if (scoring()) {
                if (lastHitter === 'PLAYER' && PH.pos.z < 0) endRally('PLAYER', '得分', '球已停止');
                else if (lastHitter === 'GOOSE' && PH.pos.z > 0) endRally('GOOSE', '失分', '球已停止');
                else endRally(PH.pos.z > 0 ? 'GOOSE' : 'PLAYER', '球已停止', '回合結束');
            } else fail('球已停止', '按空白鍵重新開始');
        }
        function checkServeLanding(x, z) {
            if (lastHitter === 'PLAYER') {
                if (z > -0.02) serveFail('發球太短', '沒過網,加大蓄力');
                else if (z > -KITCHEN_D) serveFail('落入對面中興湖廚房', '落點圈必須越過廚房線');
                else if (serveFromRight ? (x > DIAG_DEADZONE) : (x < -DIAG_DEADZONE))
                    serveFail('未進對角發球區', '瞄準綠色高亮區,或切換 🔒 自動對角');
                else { state = 'RALLY'; onLegalServe(); }
            } else {
                // 匹克鵝發球判定
                if (z < 0.02) endRally('PLAYER', '匹克鵝發球掛網', '發球失誤');
                else if (z < KITCHEN_D) endRally('PLAYER', '匹克鵝發球落入廚房', '發球失誤');
                else if (serveSide > 0 ? (x < -DIAG_DEADZONE) : (x > DIAG_DEADZONE))
                    endRally('PLAYER', '匹克鵝未進對角區', '發球失誤');
                else {
                    state = 'RALLY';
                    toast('GOOD RETURN CHANCE', '匹克鵝合法發球,等球落地後回擊');
                }
            }
        }
        function onLegalServe() {
            updateLastAuditOutcome('合法發球進區');
            if (stage !== 1) { toast('GOOD SERVE', '合法過網落地,進入對打'); return; }
            legalServes++; updateGoal();
            if (legalServes >= STAGES[1].goal) { clearStage(); return; }
            serveSide *= -1; locked = true; freeze(); S.swap(); updateGoal();
            toast('合法發球 ' + legalServes + ' / ' + STAGES[1].goal,
                '自動換邊 → 移動到' + (serveSide > 0 ? '右' : '左') + '側藍圈再發球');
            later(() => { locked = false; resetServe(); }, 1500);
        }
        function freeze() {
            PH.vel.set(0, 0, 0);
            charging = false; power = 0; powerDir = 1;
            swingT = 0; pLock = 0; gLock = 0;
            D.pFill.style.width = '0%'; powerBarDisplay = 0;
            resetSwing(); resetServeFSM();
        }