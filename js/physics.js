/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 3D 物理引擎 (Physics Engine)
   積分器：半隱式 Euler (Symplectic Euler)，固定步長 h = 1/120 s
   FAST     ：經驗線性阻尼 + 經驗側向加速度（原版手感）
   ACADEMIC ：隱式二次方阻力 + 馬格努斯力 + 指數自旋衰減
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════ 空氣動力學常數 ═══════
   BALL_R (0.14 m) 是為手機可見度放大的「碰撞 / 視覺半徑」。
   空氣動力學一律使用真實半徑 BALL_R_PHYS。 */
const BALL_R_PHYS = 0.037;                                          // 直徑 74 mm
const BALL_MASS   = 0.026;                                          // 26 g
const AIR_DENSITY = 1.225;                                          // kg/m³
const BALL_AREA   = Math.PI * BALL_R_PHYS * BALL_R_PHYS;            // ≈ 4.30e-3 m²
const DRAG_CD     = 0.58;
const DRAG_K      = 0.5 * DRAG_CD * AIR_DENSITY * BALL_AREA / BALL_MASS; // ≈ 0.0588 1/m
const MAGNUS_K    = 0.5 * AIR_DENSITY * BALL_AREA / BALL_MASS;           // ≈ 0.101 1/m

/* 假設值：多孔球缺乏公開風洞資料，以遊戲手感校正（報告時請如實說明） */
const OMEGA_MAX = 80;      // spin = ±1 對應 80 rad/s（約 760 rpm）
const CL_SLOPE  = 0.8;     // C_L ≈ 0.8 · S，S = R·|ω| / |v|
const CL_MAX    = 0.25;

const SPIN_DECAY_FAST  = 0.14;   // 1/s
const SPIN_DECAY_ACAD  = 0.35;   // 1/s，ω(t) = ω₀·e^(−βt)
const LINEAR_DAMP_FAST = 0.09;   // 1/s
const PHYS_H = 1 / 120;          // 遊戲本體與預測共用步長

/* 球的視覺縮放：由 game.js（螢幕）與 fun_mode.js（道具）設定，sync() 統一套用 */
const BALL_VIS = { base: 1, item: 1, glow: 8 };

/**
 * 共用速度積分（不含碰撞、不改位置）。
 * 遊戲本體、落點預測、彈道解算都呼叫這支，確保物理一致。
 * @returns {number} 衰減後的 spin
 */
function integrateVel(vel, spin, h, mode) {
    vel.y -= GRAVITY * h;

    if (mode === PHYSICS_MODES.ACADEMIC) {
        // ① 二次方阻力 a = −k|v|v，隱式形式：大步長下也不會讓速度反向
        const v0 = vel.length();
        if (v0 > 1e-4) vel.multiplyScalar(1 / (1 + DRAG_K * v0 * h));

        // ② 馬格努斯力 a = K_M·C_L·|v|²·(ω×v)/|ω×v|，ω = (0, ωy, 0)
        //    ωy 的正負依前進方向決定，確保 spin > 0 永遠往 +x 偏（與 FAST 語意一致）
        const v = vel.length();
        if (Math.abs(spin) > 0.04 && v > 0.5) {
            const wy = -spin * OMEGA_MAX * (vel.z < 0 ? 1 : -1);
            const cx = wy * vel.z;      // (ω×v).x
            const cz = -wy * vel.x;     // (ω×v).z
            const cm = Math.hypot(cx, cz);
            if (cm > 1e-6) {
                const S  = BALL_R_PHYS * Math.abs(wy) / v;
                const CL = Math.min(CL_MAX, CL_SLOPE * S);
                const aM = MAGNUS_K * CL * v * v;
                vel.x += aM * (cx / cm) * h;
                vel.z += aM * (cz / cm) * h;
            }
        }
        return spin * Math.exp(-SPIN_DECAY_ACAD * h);
    }

    // ── FAST：與原版 step() 逐行等價 ──
    if (Math.abs(spin) > 0.04) {
        const spdForward = Math.min(12, Math.max(2, Math.abs(vel.z)));
        const magnusAcc = spin * 3.6 * (0.80 + 0.20 * (spdForward / 8.0));
        vel.x += magnusAcc * h;
        spin *= (1 - SPIN_DECAY_FAST * h);
    }
    vel.x *= (1 - LINEAR_DAMP_FAST * h);
    vel.z *= (1 - LINEAR_DAMP_FAST * h);
    return spin;
}

/** 一步位移是否撞網（Physics.step 與模擬器共用同一判定） */
function crossesNet(z0, z1, y1, x1) {
    return z0 !== z1 && z0 * z1 <= 0 &&
        y1 < NET_H + BALL_R && Math.abs(x1) < COURT_W / 2 + 0.2;
}

/* ═══════ 飛行模擬器（預測、預覽線、彈道解算共用） ═══════ */
const _simP = new THREE.Vector3(), _simV = new THREE.Vector3();
const _simOut = { x: 0, z: 0, t: 0, net: false, n: 0 };
/**
 * 從 (p0, v0, spin) 模擬到第一次落地或撞網。
 * @param {?Array<THREE.Vector3>} pts 預先配置的點池；提供時依序寫入軌跡，最多 pts.length 點
 * @returns {?{x,z,t,net,n}} 共用物件，請立即讀取；超過 tMax 回傳 null
 */
function simulateFlight(p0, v0, spin, pts, h, tMax) {
    h = h || PHYS_H; tMax = tMax || 4;
    _simP.copy(p0); _simV.copy(v0);
    const cap = pts ? pts.length : 0;
    let s = spin || 0, t = 0, n = 0;
    if (n < cap) pts[n++].copy(_simP);
    while (t < tMax) {
        const z0 = _simP.z;
        s = integrateVel(_simV, s, h, currentPhysicsMode);
        _simP.addScaledVector(_simV, h);
        t += h;
        if (crossesNet(z0, _simP.z, _simP.y, _simP.x)) {
            _simP.z = 0;
            if (n < cap) pts[n++].copy(_simP);
            _simOut.x = _simP.x; _simOut.z = 0; _simOut.t = t; _simOut.net = true; _simOut.n = n;
            return _simOut;
        }
        if (_simP.y <= BALL_R && _simV.y < 0) {
            _simP.y = BALL_R;
            if (n < cap) pts[n++].copy(_simP);
            _simOut.x = _simP.x; _simOut.z = _simP.z; _simOut.t = t; _simOut.net = false; _simOut.n = n;
            return _simOut;
        }
        if (n < cap) pts[n++].copy(_simP);
    }
    return null;
}

/* ═══════ 物理本體 ═══════ */
class Physics {
    constructor() {
        this.pos = new THREE.Vector3(0, 1, HALF_L);
        this.vel = new THREE.Vector3();
        this.spin = 0;   // 無因次側旋量，正值往 +x 偏
    }
    sync() {
        const k = BALL_VIS.base * BALL_VIS.item;
        const sq = ballSquash;
        ball.position.copy(this.pos);
        ball.scale.set(k * (1 + sq * 0.26), k * (1 - sq * 0.34), k * (1 + sq * 0.26));
        ballGlow.position.copy(this.pos);
        const gs = BALL_R * BALL_VIS.glow * BALL_VIS.item;
        ballGlow.scale.set(gs, gs, 1);
        const spd = this.vel.length();
        ballGlow.material.opacity = 0.16 + Math.min(0.26, spd * 0.02);
        // 側旋流光：右旋紫、左旋青、直球螢光綠
        const hasCurve = Math.abs(this.spin) >= 0.12;
        if (hasCurve) {
            ballGlow.material.color.set(this.spin > 0 ? 0xc084fc : 0x38bdf8);
            ballGlow.material.opacity = 0.52;
        } else {
            ballGlow.material.color.set(0xdcff6a);
        }
        for (let i = ballTrail.length - 1; i > 0; i--) ballTrail[i].p.copy(ballTrail[i - 1].p);
        ballTrail[0].p.copy(this.pos);
        const on = spd > 2.8;
        for (let i = 0; i < ballTrail.length; i++) {
            const tr = ballTrail[i], f = 1 - i / ballTrail.length;
            tr.spr.position.copy(tr.p);
            const sc = BALL_R * (hasCurve ? 5.2 : 3.8) * f;
            tr.spr.scale.set(sc, sc, 1);
            if (hasCurve) {
                tr.spr.material.color.set(this.spin > 0 ? 0xc084fc : 0x38bdf8);
                tr.spr.material.opacity = on ? (0.48 * f) : 0;
            } else {
                tr.spr.material.color.set(0xdcff6a);
                tr.spr.material.opacity = on ? (0.24 * f * f) : 0;
            }
        }
        ballBlob.position.set(this.pos.x, 0.014, this.pos.z);
        const hh = THREE.MathUtils.clamp(this.pos.y, 0, 3.2);
        const bs = THREE.MathUtils.lerp(BALL_R * 3.1, BALL_R * 6.4, hh / 3.2);
        ballBlob.scale.set(bs, bs, 1);
        ballBlob.material.opacity = THREE.MathUtils.lerp(0.5, 0.09, hh / 3.2);
    }
    setPos(x, y, z) { this.pos.set(x, y, z); if (ball) this.sync(); }
    reset(x, y, z) {
        this.setPos(x, y, z);
        this.vel.set(0, 0, 0);
        this.spin = 0;
        if (ball) ball.rotation.set(0, 0, 0);
    }
    update(dt) {
        if (state === 'SERVE_READY' || state === 'FAULT' || state === 'OVER') { this.sync(); return; }
        let rem = dt, guard = 0;
        while (rem > 1e-6 && guard++ < 16) {
            const h = Math.min(PHYS_H, rem); rem -= h;
            if (!this.step(h)) break;
        }
        this.sync();
    }
    step(h) {
        const pz = this.pos.z;
        this.spin = integrateVel(this.vel, this.spin, h, currentPhysicsMode);
        if (ball) {
            ball.rotation.x -= this.vel.z * 3.6 * h;   // 前進滾翻（視覺）
            ball.rotation.y += this.spin * 16.0 * h;   // 側旋陀螺（視覺）
        }
        this.pos.addScaledVector(this.vel, h);

        if (crossesNet(pz, this.pos.z, this.pos.y, this.pos.x)) {
            this.pos.z = 0; this.vel.set(0, 0, 0);
            S.net(); addShake(0.1);
            popRing(this.pos.x, 0.05, 2, 0xff5555);
            onNet(); return false;
        }
        if (this.pos.y <= BALL_R && this.vel.y < 0) {
            this.pos.y = BALL_R;
            const imp = Math.abs(this.vel.y);
            if (imp < DEAD_VY) { this.vel.set(0, 0, 0); onDead(); return false; }
            this.vel.y = -this.vel.y * REST_Y;
            this.vel.x *= REST_XZ;
            this.vel.z *= REST_XZ;
            this.vel.x += this.spin * 0.75;   // 落地時側旋轉為額外側向速度（遊戲化效果）
            this.spin *= 0.35;                // 落地摩擦大幅耗散自旋
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

/* ═══════ 預測 ═══════
   FAST 保留原版真空預測（AI 走位、落點圈行為不變）；ACADEMIC 使用同一套積分器 */
function predictLandingVacuum(out) {
    const a = -0.5 * GRAVITY, b = PH.vel.y, c = PH.pos.y - BALL_R;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (!(t > 0) || t > 6) return false;
    out.set(PH.pos.x + PH.vel.x * t, 0.016, PH.pos.z + PH.vel.z * t);
    return true;
}
function predictLanding(out) {
    if (currentPhysicsMode !== PHYSICS_MODES.ACADEMIC) return predictLandingVacuum(out);
    const r = simulateFlight(PH.pos, PH.vel, PH.spin, null);
    if (!r || r.net) return false;
    out.set(r.x, 0.016, r.z);
    return true;
}

const _apP = new THREE.Vector3(), _apV = new THREE.Vector3();
function predictApexVacuum() {
    _apP.copy(PH.pos); _apV.copy(PH.vel);
    const h = 1 / 180;
    let bounced = false, t = 0;
    for (let i = 0; i < 1200; i++) {
        _apV.y -= GRAVITY * h;
        _apP.addScaledVector(_apV, h); t += h;
        if (_apP.y <= BALL_R && _apV.y < 0) {
            _apP.y = BALL_R;
            if (bounced || Math.abs(_apV.y) < DEAD_VY || _apP.z > -0.05) return null;
            _apV.y = -_apV.y * REST_Y;
            _apV.x *= REST_XZ;
            _apV.z *= REST_XZ;
            bounced = true; continue;
        }
        if (bounced && _apV.y <= 0) return { x: _apP.x, y: _apP.y, z: _apP.z, t: t };
    }
    return null;
}
function predictApex() {
    if (currentPhysicsMode !== PHYSICS_MODES.ACADEMIC) return predictApexVacuum();
    _apP.copy(PH.pos); _apV.copy(PH.vel);
    let s = PH.spin, bounced = false, t = 0;
    for (let i = 0; i < 600; i++) {
        s = integrateVel(_apV, s, PHYS_H, currentPhysicsMode);
        _apP.addScaledVector(_apV, PHYS_H); t += PHYS_H;
        if (_apP.y <= BALL_R && _apV.y < 0) {
            _apP.y = BALL_R;
            if (bounced || Math.abs(_apV.y) < DEAD_VY || _apP.z > -0.05) return null;
            _apV.y = -_apV.y * REST_Y;
            _apV.x = _apV.x * REST_XZ + s * 0.75;   // 與 step() 落地邏輯一致
            _apV.z *= REST_XZ;
            s *= 0.35;
            bounced = true; continue;
        }
        if (bounced && _apV.y <= 0) return { x: _apP.x, y: _apP.y, z: _apP.z, t: t };
    }
    return null;
}

/* ═══════ 學術模式彈道修正（打靶法） ═══════
   以真空解為初值，反覆模擬並修正水平速度，直到落點誤差 < 10 cm。
   刻意以 spin = 0 解算：保留 tryHit「反向起手、靠側旋兜回」的香蕉球設計。
   未收斂時回退到誤差最小、且不撞網的候選速度。 */
const _arcP0 = new THREE.Vector3(), _arcBest = new THREE.Vector3();
function refineArcAcademic(fx, fy, fz, tx, tz, out) {
    _arcP0.set(fx, fy, fz);
    let bestErr = Infinity;
    for (let it = 0; it < 20; it++) {
        const r = simulateFlight(_arcP0, out, 0, null);
        if (!r)    { out.y -= 0.5; continue; }   // 超時：拋太高
        if (r.net) { out.y += 0.4; continue; }   // 撞網：抬高
        const ex = tx - r.x, ez = tz - r.z, e2 = ex * ex + ez * ez;
        if (e2 < bestErr) { bestErr = e2; _arcBest.copy(out); }
        if (e2 < 0.01) return true;
        const T = Math.max(0.25, r.t);
        out.x += ex / T;
        out.z += ez / T;
        if (out.lengthSq() > 35 * 35) out.setLength(35);
    }
    if (bestErr < Infinity) out.copy(_arcBest);
    return false;
}

/* ═══════ 規則判定 ═══════ */
let server = 'PLAYER';          // 'PLAYER' | 'GOOSE'
let secondServe = false;
function needBounce() { return stage >= 2 && rallyHits < 3; }
function scoring() { return stage >= 4; }   // 前三關練習關：失誤只重試不計分
function swatterHunting() { return typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER'; }

function onNet() {
    if (demoOn || swatterHunting()) return;
    if (scoring()) endRally(lastHitter === 'GOOSE' ? 'PLAYER' : 'GOOSE', '掛網', '球沒過網');
    else fail('掛網', '擊球點再放低一點,往前送出去');
}
function onBounce() {
    if (demoOn || swatterHunting()) return;
    bounces++;
    const x = PH.pos.x, z = PH.pos.z;
    if (bounces === 1) {
        const inCourt = Math.abs(x) <= COURT_W / 2 + BALL_R && Math.abs(z) <= HALF_L + BALL_R;
        if (!inCourt) {
            if (state === 'SERVE_AIR') serveFail('發球出界', '力道略減,看落點圈瞄準對角區');
            else if (scoring()) endRally(lastHitter === 'GOOSE' ? 'PLAYER' : 'GOOSE', '界外球', '第一次落地必須在白線內');
            else fail('界外球', lastHitter === 'GOOSE' ? '對手打出界,重新開始' : '控制力道與方向');
            return;
        }
        if (state === 'SERVE_AIR') { checkServeLanding(x, z); return; }
        // 第一次落地必須在擊球者的對面
        const ownSide = (lastHitter === 'PLAYER' && z > 0) || (lastHitter === 'GOOSE' && z < 0);
        if (ownSide) {
            if (scoring()) endRally(lastHitter === 'PLAYER' ? 'GOOSE' : 'PLAYER', '未過網', '球落在擊球者自己的場地');
            else fail('未過網', lastHitter === 'GOOSE' ? '對手回球沒過網' : '擊球力道不足');
            return;
        }
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
    if (demoOn || swatterHunting()) return;
    if (scoring()) {
        if (lastHitter === 'PLAYER' && PH.pos.z < 0) endRally('PLAYER', '得分', '球已停止');
        else if (lastHitter === 'GOOSE' && PH.pos.z > 0) endRally('GOOSE', '失分', '球已停止');
        else endRally(PH.pos.z > 0 ? 'GOOSE' : 'PLAYER', '球已停止', '回合結束');
    } else fail('球已停止', '按空白鍵重新開始');
}
function checkServeLanding(x, z) {
    if (swatterHunting()) return;
    if (lastHitter === 'PLAYER') {
        if (z > -0.02) serveFail('發球太短', '沒過網,加大蓄力');
        else if (z > -KITCHEN_D) serveFail('落入對面中興湖廚房', '落點圈必須越過廚房線');
        else if (serveFromRight ? (x > DIAG_DEADZONE) : (x < -DIAG_DEADZONE))
            serveFail('未進對角發球區', '瞄準綠色高亮區,或切換 🔒 自動對角');
        else { state = 'RALLY'; onLegalServe(); }
    } else {
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
    if (swatterHunting()) return;
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
    if (swatterHunting()) return;   // 電蚊拍追殺中不可清除道具
    PH.vel.set(0, 0, 0);
    charging = false; power = 0; powerDir = 1;
    swingT = 0; pLock = 0; gLock = 0;
    D.pFill.style.width = '0%'; powerBarDisplay = 0;
    resetSwing(); resetServeFSM();
    if (typeof dinkRallyCount !== 'undefined') dinkRallyCount = 0;
    if (typeof isChanceBall !== 'undefined') isChanceBall = false;
    if (typeof FunMode !== 'undefined' && FunMode.clearCourtItems) FunMode.clearCourtItems();
}

/* ═══════ 雙軌物理模式切換 ═══════ */
function setPhysicsMode(mode) {
    currentPhysicsMode = (mode === PHYSICS_MODES.ACADEMIC) ? PHYSICS_MODES.ACADEMIC : PHYSICS_MODES.FAST;
    try { localStorage.setItem('nchu_physics_mode', currentPhysicsMode); } catch (e) { }
    syncPhysicsModeUI();
    if (typeof toast === 'function') {
        const acad = currentPhysicsMode === PHYSICS_MODES.ACADEMIC;
        toast(acad ? '🔬 學術求解模式' : '⚡ 極速經驗模式',
            acad ? '二次方阻力 + 馬格努斯力 · 半隱式 Euler h=1/120s' : '線性阻尼 + 經驗側向力 · 手感穩定');
    }
}
function togglePhysicsMode() {
    setPhysicsMode(currentPhysicsMode === PHYSICS_MODES.ACADEMIC ? PHYSICS_MODES.FAST : PHYSICS_MODES.ACADEMIC);
}
function syncPhysicsModeUI() {
    const isAcad = (currentPhysicsMode === PHYSICS_MODES.ACADEMIC);
    document.querySelectorAll('[data-physics-mode]').forEach(el => {
        el.classList.toggle('on', (el.getAttribute('data-physics-mode') === 'academic') === isAcad);
    });
    const pill = document.getElementById('physics-mode-pill');
    if (pill) {
        pill.innerHTML = isAcad ? '🔬 學術' : '⚡ 極速';
        pill.style.color = isAcad ? '#c7d2fe' : '#bae6fd';
    }
    const sub = document.getElementById('subbar-phys-btn');
    if (sub) sub.innerHTML = '🌪️ 物理: ' + (isAcad ? '🔬學術' : '⚡極速');
    const modalBtn = document.getElementById('rtab-mode-toggle-btn');
    if (modalBtn) {
        modalBtn.innerHTML = isAcad ? '🔬 當前：學術求解模式 (點擊切換為極速模式)' : '⚡ 當前：極速經驗模式 (點擊切換為學術求解)';
        modalBtn.style.background = isAcad ? 'rgba(129, 140, 248, 0.2)' : 'rgba(56, 189, 248, 0.15)';
        modalBtn.style.borderColor = isAcad ? '#818cf8' : '#38bdf8';
    }
}
