# NCHU Pickleball V5 → v5.1.0 修正規格書

## 0. 給執行者（程式修改者）的規則

1. **只修改本文件列出的地方**。不要順手重構、重新排版或改名。
2. 「整檔替換」＝刪除原檔全部內容，貼上文件中的程式碼。
3. 「找到 → 換成」＝以**函式名稱**定位。原檔與範例若有空白或縮排差異，以語意為準。**找不到就停下來回報，不要猜。**
4. 程式碼中的 `*` 是乘號，**絕對不能變成 `_`**。
5. 來源檔只有：`v14.html`（模板）、`css/*.css`、`js/*.js`、`scripts/`、`backend/`。**不要修改 `index.html` 和 `v14-single.html`**，它們是打包產物。
6. 載入順序（全部合併在同一個 `<script>`）：
   `config → audio → physics → referee → motion → ui → social → fly_connectome → fun_mode → game`
   **不要在 `ui.js`、`social.js` 的頂層同步呼叫會用到 `TEACH`、`scene`、`ball` 的函式**，因為這些在 `game.js` 才宣告，會觸發 TDZ 錯誤，導致整個遊戲停止。
7. 全部改完後執行 `node scripts/build-single.js`，把輸出（成功或錯誤訊息）完整回報。
8. 「Part C 人工步驟」涉及金鑰，**執行者不得處理，也不得在任何檔案中寫入真實金鑰或網址**。

## 檔案總覽

| 檔案 | 動作 | 章節 |
|---|---|---|
| `js/physics.js` | 整檔替換 | A1 |
| `scripts/build-single.js` | 整檔替換 | A2 |
| `backend/cloudflare-worker.js` | 整檔替換 | A3 |
| `backend/Code.gs` | 整檔替換 | A4 |
| `js/game.js` | 片段修改 | B1 |
| `js/ui.js` | 片段修改 | B2 |
| `js/motion.js` | 片段修改 | B3 |
| `js/social.js` | 片段修改 | B4 |
| `js/fun_mode.js` | 片段修改 | B5 |
| `js/config.js` | 片段修改 | B6 |
| `css/hud.css`、`css/style.css`、`css/modals.css` | 片段修改 | B7 |
| `v14.html` | 片段修改 | B8 |
| `backend/` 部署說明 `.md`、`整合報告.md` | 文字修改 | B9 |

建議執行順序：A1 → A2 → B1～B8 → 打包 → A3、A4、B9。

---

# Part A：整檔替換

## A1. `js/physics.js`

```js
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

/* 假設值：多孔球缺乏公開風洞資料，以遊戲手感校正 */
const OMEGA_MAX = 80;      // spin = ±1 對應 80 rad/s（約 760 rpm）
const CL_SLOPE  = 0.8;     // C_L ≈ 0.8 · S，S = R·|ω| / |v|
const CL_MAX    = 0.25;

const SPIN_DECAY_FAST  = 0.14;   // 1/s
const SPIN_DECAY_ACAD  = 0.35;   // 1/s
const LINEAR_DAMP_FAST = 0.09;   // 1/s
const PHYS_H = 1 / 120;

/* 球的視覺縮放：由 game.js（螢幕）與 fun_mode.js（道具）設定，sync() 統一套用 */
const BALL_VIS = { base: 1, item: 1, glow: 8 };

/** 共用速度積分（不含碰撞、不改位置）。回傳衰減後的 spin */
function integrateVel(vel, spin, h, mode) {
    vel.y -= GRAVITY * h;

    if (mode === PHYSICS_MODES.ACADEMIC) {
        // ① 二次方阻力 a = −k|v|v，隱式形式：不會讓速度反向
        const v0 = vel.length();
        if (v0 > 1e-4) vel.multiplyScalar(1 / (1 + DRAG_K * v0 * h));

        // ② 馬格努斯力 a = K_M·C_L·|v|²·(ω×v)/|ω×v|，ω = (0, ωy, 0)
        //    ωy 正負依前進方向決定，確保 spin > 0 永遠往 +x 偏
        const v = vel.length();
        if (Math.abs(spin) > 0.04 && v > 0.5) {
            const wy = -spin * OMEGA_MAX * (vel.z < 0 ? 1 : -1);
            const cx = wy * vel.z;
            const cz = -wy * vel.x;
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

function crossesNet(z0, z1, y1, x1) {
    return z0 !== z1 && z0 * z1 <= 0 &&
        y1 < NET_H + BALL_R && Math.abs(x1) < COURT_W / 2 + 0.2;
}

/* ═══════ 飛行模擬器（預測、預覽線、彈道解算共用） ═══════ */
const _simP = new THREE.Vector3(), _simV = new THREE.Vector3();
const _simOut = { x: 0, z: 0, t: 0, net: false, n: 0 };
/**
 * 模擬到第一次落地或撞網。pts 為預先配置的點池（可為 null）。
 * 回傳共用物件，請立即讀取；超過 tMax 回傳 null。
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
        this.spin = 0;
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
            ball.rotation.x -= this.vel.z * 3.6 * h;
            ball.rotation.y += this.spin * 16.0 * h;
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
            this.spin *= 0.35;
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

/* ═══════ 預測：FAST 保留原版真空預測；ACADEMIC 使用同一套積分器 ═══════ */
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
            _apV.x = _apV.x * REST_XZ + s * 0.75;
            _apV.z *= REST_XZ;
            s *= 0.35;
            bounced = true; continue;
        }
        if (bounced && _apV.y <= 0) return { x: _apP.x, y: _apP.y, z: _apP.z, t: t };
    }
    return null;
}

/* ═══════ 學術模式彈道修正（打靶法） ═══════
   以 spin = 0 解算，保留 tryHit「反向起手、靠側旋兜回」的設計。
   未收斂時回退到誤差最小、且不撞網的候選速度。 */
const _arcP0 = new THREE.Vector3(), _arcBest = new THREE.Vector3();
function refineArcAcademic(fx, fy, fz, tx, tz, out) {
    _arcP0.set(fx, fy, fz);
    let bestErr = Infinity;
    for (let it = 0; it < 20; it++) {
        const r = simulateFlight(_arcP0, out, 0, null);
        if (!r)    { out.y -= 0.5; continue; }
        if (r.net) { out.y += 0.4; continue; }
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
let server = 'PLAYER';
let secondServe = false;
function needBounce() { return stage >= 2 && rallyHits < 3; }
function scoring() { return stage >= 4; }
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
    if (swatterHunting()) return;
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
```

## A2. `scripts/build-single.js`

```js
#!/usr/bin/env node
/**
 * NCHU Pickleball V5 - 單檔打包工具
 * 將 v14.html（模板）+ css/ + js/ 合成 v14-single.html，並同步輸出 index.html
 * 執行：node scripts/build-single.js            （輸出 single + index）
 *       node scripts/build-single.js --no-index （只輸出 single）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'v14.html');
const OUT_SINGLE = path.join(ROOT, 'v14-single.html');
const OUT_INDEX = path.join(ROOT, 'index.html');

const CSS_FILES = ['style.css', 'hud.css', 'nav.css', 'modals.css'];
const JS_FILES = ['config.js', 'audio.js', 'physics.js', 'referee.js', 'motion.js',
    'ui.js', 'social.js', 'fly_connectome.js', 'fun_mode.js', 'game.js'];

const CSS_BLOCK = /\s*<!-- ═══════ NCHU Pickleball V5 模組化樣式表 ═══════ -->[\s\S]*?<link rel="stylesheet" href="\.\/css\/modals\.css">/;
const JS_BLOCK = /\s*<!-- ═══════ NCHU Pickleball V5 模組化 JavaScript 核心 ═══════ -->[\s\S]*?<script src="\.\/js\/game\.js"><\/script>/;

function fail(msg) {
    console.error('❌ ' + msg);
    process.exit(1);
}

function readAll(dir, files) {
    return files.map(f => {
        const p = path.join(ROOT, dir, f);
        if (!fs.existsSync(p)) fail(`找不到 ${dir}/${f}`);
        return { name: f, src: fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') };
    });
}

function warnDuplicateFunctions(parts) {
    const seen = new Map();
    for (const { name, src } of parts) {
        for (const m of src.matchAll(/^[ \t]{0,8}function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
            const fn = m[1];
            if (seen.has(fn) && seen.get(fn) !== name) {
                console.warn(`⚠️  函式 ${fn}() 同時定義在 ${seen.get(fn)} 與 ${name}，後者會覆蓋前者`);
            } else seen.set(fn, name);
        }
    }
}

function replaceOnce(html, re, content, label) {
    if (!re.test(html)) fail(`模板中找不到 ${label} 標記區塊，請檢查 v14.html 的註解是否被修改`);
    return html.replace(re, () => content);
}

console.log('📦 開始打包…');
let html = fs.readFileSync(TEMPLATE, 'utf8');

const cssParts = readAll('css', CSS_FILES);
const jsParts = readAll('js', JS_FILES);

const css = cssParts.map(p => `\n/* ─── ${p.name} ─── */\n${p.src}\n`).join('');
const js = jsParts.map(p => `\n/* ─── ${p.name} ─── */\n${p.src}\n`).join('');

if (/<\/script/i.test(js)) fail('JS 內容含有 "</script"，請改寫為 "<\\/script"');
if (/<\/style/i.test(css)) fail('CSS 內容含有 "</style"');

try {
    new vm.Script(js, { filename: 'combined.js' });
} catch (e) {
    const line = (e.stack || '').match(/combined\.js:(\d+)/);
    let where = '';
    if (line) {
        let n = +line[1], acc = 0;
        for (const p of jsParts) {
            const len = p.src.split('\n').length + 2;
            if (n <= acc + len) { where = ` → ${p.name} 約第 ${n - acc - 1} 行`; break; }
            acc += len;
        }
    }
    fail(`合併後的 JS 有語法錯誤：${e.message}${where}`);
}
warnDuplicateFunctions(jsParts);

html = replaceOnce(html, CSS_BLOCK, `\n    <style>\n${css}\n    </style>`, 'CSS');
html = replaceOnce(html, JS_BLOCK, `\n    <script>\n${js}\n    </script>`, 'JS');

if (/<link rel="stylesheet" href="\.\/css\//.test(html) || /<script src="\.\/js\//.test(html)) {
    fail('輸出中仍有未內嵌的本地 css/js 參照');
}

fs.writeFileSync(OUT_SINGLE, html, 'utf8');
console.log(`✅ v14-single.html（${html.split('\n').length} 行）`);
if (!process.argv.includes('--no-index')) {
    fs.writeFileSync(OUT_INDEX, html, 'utf8');
    console.log('✅ index.html 已同步');
}
```

## A3. `backend/cloudflare-worker.js`

```js
/**
 * NCHU Pickleball - Cloudflare Worker 反向代理
 * 1. GAS_URL 與 SIGN_SECRET 必須設為 Worker 機密，未設定就拒絕服務
 * 2. CORS 來源白名單（精確比對）
 * 3. 盡力而為的 IP 頻率限制
 * 4. act 白名單與請求大小上限
 * 5. 伺服器端 HMAC-SHA256 簽章（證明請求經過本代理；玩家身分由 GAS 以 token 驗證）
 */

const POST_ACTS = new Set(['submit', 'like', 'friendReq', 'friendAccept', 'updateProfile', 'sync_twin']);
const GET_ACTS = new Set(['ping', 'leaderboard', 'me', 'friends']);
const MAX_BODY_CHARS = 16 * 1024;
const WINDOW_MS = 60 * 1000;
const LIMITS = { GET: 40, POST: 15 };

const PROD_ORIGINS = new Set(['https://kalmangoose.github.io']);
function originAllowed(origin) {
    if (!origin) return false;
    if (PROD_ORIGINS.has(origin)) return true;
    try {
        const u = new URL(origin);
        return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    } catch (_) {
        return false;
    }
}

const buckets = new Map();
function rateLimit(key, max) {
    const now = Date.now();
    if (buckets.size > 5000) {
        for (const [k, r] of buckets) if (now > r.reset) buckets.delete(k);
    }
    const r = buckets.get(key);
    if (!r || now > r.reset) {
        buckets.set(key, { n: 1, reset: now + WINDOW_MS });
        return true;
    }
    if (r.n >= max) return false;
    r.n++;
    return true;
}

async function hmacSha256Base64(secret, msg) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
    let bin = '';
    for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
    return btoa(bin);
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = originAllowed(origin);
        const cors = {
            'Access-Control-Allow-Origin': allowed ? origin : 'null',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: allowed ? 204 : 403, headers: cors });
        }
        if (!allowed) return json({ ok: false, err: 'FORBIDDEN_ORIGIN' }, 403, cors);

        if (!env.GAS_URL || !env.SIGN_SECRET) {
            return json({ ok: false, err: 'PROXY_NOT_CONFIGURED' }, 500, cors);
        }

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!rateLimit(ip + ':' + request.method, LIMITS[request.method] || 10)) {
            return json({ ok: false, err: 'RATE_LIMIT_EXCEEDED' }, 429, cors);
        }

        if (request.method === 'GET') {
            const url = new URL(request.url);
            const act = url.searchParams.get('act') || 'ping';
            if (!GET_ACTS.has(act)) return json({ ok: false, err: 'UNKNOWN_GET_ACTION' }, 400, cors);
            const fwd = new URL(env.GAS_URL);
            fwd.searchParams.set('act', act);
            const pid = url.searchParams.get('pid');
            if (pid) fwd.searchParams.set('pid', pid.slice(0, 64));
            try {
                const res = await fetch(fwd.toString(), { headers: { 'Accept': 'application/json' } });
                return new Response(await res.text(), {
                    status: res.status,
                    headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
                });
            } catch (_) {
                return json({ ok: false, err: 'PROXY_UPSTREAM_ERROR' }, 502, cors);
            }
        }

        if (request.method === 'POST') {
            const raw = await request.text();
            if (raw.length > MAX_BODY_CHARS) return json({ ok: false, err: 'PAYLOAD_TOO_LARGE' }, 413, cors);
            let payload;
            try { payload = JSON.parse(raw); } catch (_) {
                return json({ ok: false, err: 'INVALID_JSON' }, 400, cors);
            }
            if (!payload || typeof payload !== 'object' || !POST_ACTS.has(payload.act)) {
                return json({ ok: false, err: 'UNKNOWN_POST_ACTION' }, 400, cors);
            }
            const dataStr = JSON.stringify(payload);
            const ts = Date.now();
            const nonce = crypto.randomUUID();
            const sig = await hmacSha256Base64(env.SIGN_SECRET, dataStr + '|' + ts + '|' + nonce);
            try {
                const res = await fetch(env.GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ data: dataStr, ts, nonce, sig })
                });
                return new Response(await res.text(), {
                    status: res.status,
                    headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
                });
            } catch (_) {
                return json({ ok: false, err: 'PROXY_POST_FAIL' }, 502, cors);
            }
        }

        return json({ ok: false, err: 'METHOD_NOT_ALLOWED' }, 405, cors);
    }
};
```

## A4. `backend/Code.gs`

```js
/**
 * NCHU Pickleball - Google Apps Script 後端  v3.0
 * 1. HMAC-SHA256 驗簽（金鑰存於「指令碼屬性」SIGN_SECRET）
 * 2. 時間戳 ±10 分鐘 + nonce 防重放（先驗簽，再記錄 nonce）
 * 3. 玩家 token 驗證：公開 playerId + 私密 token（只存 SHA-256 雜湊）
 * 4. LockService 排他鎖、公式注入過濾、分數邊界檢查
 * 需要 V8 執行環境
 */

var PLAYER_HEADERS = ['playerId', 'avatar', 'nickname', 'department', 'deptCode', 'grade',
    'entryYear', 'bestScore', 'likes', 'updatedAt', 'twin_data', 'ig', 'tokenHash'];
var COL = { PID: 0, AVATAR: 1, NICK: 2, DEPT: 3, DEPTCODE: 4, GRADE: 5, ENTRY: 6,
    BEST: 7, LIKES: 8, UPDATED: 9, TWIN: 10, IG: 11, TOKEN: 12 };

var SCORE_STAGES = [5, 6];
var MAX_SCORE = 5;
var MAX_TWIN_CHARS = 30000;
var POST_ACTS = ['submit', 'like', 'friendReq', 'friendAccept', 'updateProfile', 'sync_twin'];

function getSecret() {
    var s = PropertiesService.getScriptProperties().getProperty('SIGN_SECRET');
    if (!s) throw new Error('SIGN_SECRET_NOT_CONFIGURED');
    return s;
}

function getDb() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return {
        players: getOrCreateSheet(ss, 'players', PLAYER_HEADERS),
        scores: getOrCreateSheet(ss, 'scores', ['id', 'playerId', 'sessionId', 'score', 'stage', 'device', 'webcam', 'createdAt']),
        friends: getOrCreateSheet(ss, 'friends', ['id', 'fromId', 'toId', 'status', 'updatedAt']),
        likes: getOrCreateSheet(ss, 'likes', ['id', 'fromId', 'toId', 'date', 'createdAt'])
    };
}

function getOrCreateSheet(ss, name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
        return sheet;
    }
    if (sheet.getLastColumn() < headers.length) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    return sheet;
}

function jsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function sanitize(val, maxLen) {
    if (val === null || val === undefined) return '';
    var s = String(val).trim();
    if (/^[=\+\-@]/.test(s)) s = "'" + s;
    return s.slice(0, maxLen || 100);
}

function sanitizeIg(val) {
    var s = String(val || '').trim().replace(/^@/, '');
    return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : '';
}

function safeParse(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch (_) { return null; }
}

function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8);
}

function writeCells(sheet, dataRow, startCol, values) {
    sheet.getRange(dataRow + 1, startCol + 1, 1, values.length).setValues([values]);
}

function findRow(pData, pid) {
    for (var i = 1; i < pData.length; i++) if (pData[i][COL.PID] === pid) return i;
    return -1;
}

function verifySignature(dataStr, ts, nonce, sig) {
    var mac = Utilities.computeHmacSha256Signature(
        dataStr + '|' + ts + '|' + nonce, getSecret(), Utilities.Charset.UTF_8);
    return Utilities.base64Encode(mac) === sig;
}

function hashToken(token) {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
    return Utilities.base64Encode(d);
}

function authorize(db, pData, pid, token, isoTime) {
    if (!/^[A-Za-z0-9_\-]{6,40}$/.test(pid)) return { err: 'INVALID_PLAYER_ID' };
    if (!/^[a-f0-9]{32,64}$/.test(token)) return { err: 'TOKEN_REQUIRED' };
    var h = hashToken(token);
    var i = findRow(pData, pid);
    if (i > 0) {
        var stored = pData[i][COL.TOKEN];
        if (!stored) {
            db.players.getRange(i + 1, COL.TOKEN + 1).setValue(h);
            pData[i][COL.TOKEN] = h;
            return { row: i };
        }
        return stored === h ? { row: i } : { err: 'UNAUTHORIZED' };
    }
    var row = [];
    for (var c = 0; c < PLAYER_HEADERS.length; c++) row.push('');
    row[COL.PID] = pid; row[COL.AVATAR] = '🪿'; row[COL.NICK] = '匿名球員';
    row[COL.BEST] = 0; row[COL.LIKES] = 0; row[COL.UPDATED] = isoTime; row[COL.TOKEN] = h;
    db.players.appendRow(row);
    pData.push(row);
    return { row: pData.length - 1 };
}

function doGet(e) {
    var p = e ? e.parameter : {};
    var act = p.act || 'ping';
    var pid = p.pid ? String(p.pid).trim() : '';
    try {
        var db = getDb();

        if (act === 'ping') {
            return jsonResponse({ ok: true, api: 'nchu-pickleball-v3.0', acts: ['ping', 'leaderboard', 'me', 'friends'] });
        }

        if (act === 'leaderboard') {
            var pData = db.players.getDataRange().getValues();
            var list = [];
            for (var i = 1; i < pData.length; i++) {
                var row = pData[i];
                var sc = Number(row[COL.BEST]) || 0;
                if (!row[COL.PID] || sc <= 0) continue;
                list.push({
                    playerId: row[COL.PID], avatar: row[COL.AVATAR] || '🪿',
                    nickname: row[COL.NICK] || '匿名球員', department: row[COL.DEPT] || '',
                    deptCode: row[COL.DEPTCODE] || '', ig: row[COL.IG] || '',
                    score: sc, likes: Number(row[COL.LIKES]) || 0
                });
            }
            list.sort(function (a, b) { return b.score - a.score; });

            var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
            var likesData = pid ? db.likes.getDataRange().getValues() : [];
            var friendsData = pid ? db.friends.getDataRange().getValues() : [];

            var result = list.slice(0, 50).map(function (item, idx) {
                var isMe = !!pid && item.playerId === pid;
                var liked = false, friendStatus = 'none';
                if (pid && !isMe) {
                    for (var j = 1; j < likesData.length; j++) {
                        if (likesData[j][1] === pid && likesData[j][2] === item.playerId && likesData[j][3] === today) {
                            liked = true; break;
                        }
                    }
                    for (var k = 1; k < friendsData.length; k++) {
                        var f = friendsData[k];
                        if ((f[1] === pid && f[2] === item.playerId) || (f[2] === pid && f[1] === item.playerId)) {
                            if (f[3] === 'accepted') friendStatus = 'accepted';
                            else if (f[1] === pid) friendStatus = 'pending';
                            else friendStatus = 'incoming';
                            break;
                        }
                    }
                }
                item.rank = idx + 1; item.liked = liked; item.friend = friendStatus; item.isMe = isMe;
                return item;
            });
            return jsonResponse({ ok: true, list: result });
        }

        if (act === 'me') {
            if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
            var pData = db.players.getDataRange().getValues();
            var bestScore = 0, likes = 0, scoresList = [];
            for (var i = 1; i < pData.length; i++) {
                var row = pData[i];
                var sc = Number(row[COL.BEST]) || 0;
                if (row[COL.PID] && sc > 0) scoresList.push({ pid: row[COL.PID], score: sc });
                if (row[COL.PID] === pid) { bestScore = sc; likes = Number(row[COL.LIKES]) || 0; }
            }
            scoresList.sort(function (a, b) { return b.score - a.score; });
            var rank = 0;
            for (var j = 0; j < scoresList.length; j++) if (scoresList[j].pid === pid) { rank = j + 1; break; }
            var sData = db.scores.getDataRange().getValues(), sessions = 0;
            for (var k = 1; k < sData.length; k++) if (sData[k][1] === pid) sessions++;
            return jsonResponse({ ok: true, rank: rank, bestScore: bestScore, likes: likes, sessions: sessions });
        }

        if (act === 'friends') {
            if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
            var fData = db.friends.getDataRange().getValues();
            var pData = db.players.getDataRange().getValues();
            var playerMap = {};
            for (var i = 1; i < pData.length; i++) {
                var r = pData[i];
                if (!r[COL.PID]) continue;
                var twin = safeParse(r[COL.TWIN]);
                playerMap[r[COL.PID]] = {
                    playerId: r[COL.PID], avatar: r[COL.AVATAR] || '🪿',
                    nickname: r[COL.NICK] || '匿名球員', department: r[COL.DEPT] || '',
                    ig: r[COL.IG] || '', score: Number(r[COL.BEST]) || 0,
                    stats: twin && twin.stats ? twin.stats : null
                };
            }
            var inc = [], acc = [], out = [];
            for (var j = 1; j < fData.length; j++) {
                var fr = fData[j];
                if (fr[3] === 'accepted') {
                    if (fr[1] === pid && playerMap[fr[2]]) acc.push(playerMap[fr[2]]);
                    else if (fr[2] === pid && playerMap[fr[1]]) acc.push(playerMap[fr[1]]);
                } else if (fr[3] === 'pending') {
                    if (fr[1] === pid && playerMap[fr[2]]) out.push(playerMap[fr[2]]);
                    else if (fr[2] === pid && playerMap[fr[1]]) inc.push(playerMap[fr[1]]);
                }
            }
            return jsonResponse({ ok: true, friends: { incoming: inc, accepted: acc, outgoing: out } });
        }

        return jsonResponse({ ok: false, err: 'UNKNOWN_GET_ACTION' });
    } catch (err) {
        return jsonResponse({ ok: false, err: 'GET_ERROR: ' + err });
    }
}

function doPost(e) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return jsonResponse({ ok: false, err: 'SERVER_BUSY_PLEASE_RETRY' });
    try {
        var body = e && e.postData ? e.postData.contents : '';
        if (!body) return jsonResponse({ ok: false, err: 'EMPTY_BODY' });
        var env = safeParse(body);
        if (!env) return jsonResponse({ ok: false, err: 'INVALID_JSON_ENVELOPE' });

        var dataStr = String(env.data || ''), ts = Number(env.ts);
        var nonce = String(env.nonce || ''), sig = String(env.sig || '');
        var now = Date.now();

        if (!ts || Math.abs(now - ts) > 10 * 60 * 1000) return jsonResponse({ ok: false, err: 'TIMESTAMP_EXPIRED' });
        if (nonce.length < 8 || !verifySignature(dataStr, ts, nonce, sig)) {
            return jsonResponse({ ok: false, err: 'INVALID_SIGNATURE' });
        }
        var cache = CacheService.getScriptCache(), nonceKey = 'pb_nonce_' + nonce;
        if (cache.get(nonceKey)) return jsonResponse({ ok: false, err: 'REPLAY_ATTACK_DETECTED' });
        cache.put(nonceKey, '1', 600);

        var payload = safeParse(dataStr);
        if (!payload) return jsonResponse({ ok: false, err: 'INVALID_INNER_JSON' });
        var act = payload.act;
        if (POST_ACTS.indexOf(act) < 0) return jsonResponse({ ok: false, err: 'UNKNOWN_POST_ACTION' });

        var db = getDb();
        var isoTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
        var pData = db.players.getDataRange().getValues();

        var pid = String(payload.playerId || '').trim();
        var auth = authorize(db, pData, pid, String(payload.token || ''), isoTime);
        if (auth.err) return jsonResponse({ ok: false, err: auth.err });
        var me = auth.row;

        if (act === 'submit') {
            var score = Math.floor(Number(payload.score));
            var stage = Math.floor(Number(payload.stage));
            if (SCORE_STAGES.indexOf(stage) < 0) return jsonResponse({ ok: false, err: 'INVALID_STAGE' });
            if (isNaN(score) || score < 0 || score > MAX_SCORE) return jsonResponse({ ok: false, err: 'INVALID_SCORE_RANGE' });

            db.scores.appendRow([newId('SC'), pid, sanitize(payload.sessionId, 40), score, stage,
                sanitize(payload.device, 20), payload.webcamUsed ? 'Y' : 'N', isoTime]);

            var newBest = Math.max(Number(pData[me][COL.BEST]) || 0, score);
            writeCells(db.players, me, COL.AVATAR, [
                sanitize(payload.avatar, 8) || '🪿',
                sanitize(payload.nickname, 30) || '匿名球員',
                sanitize(payload.department, 40),
                sanitize(payload.deptCode, 10),
                sanitize(payload.grade, 10),
                sanitize(payload.entryYear, 6),
                newBest
            ]);
            writeCells(db.players, me, COL.UPDATED, [isoTime]);
            return jsonResponse({ ok: true, bestScore: newBest });
        }

        if (act === 'like') {
            var toId = String(payload.toId || '').trim();
            var target = findRow(pData, toId);
            if (target < 0 || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });
            var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
            var likesData = db.likes.getDataRange().getValues();
            for (var i = 1; i < likesData.length; i++) {
                if (likesData[i][1] === pid && likesData[i][2] === toId && likesData[i][3] === today) {
                    return jsonResponse({ ok: false, err: 'ALREADY_LIKED_TODAY' });
                }
            }
            db.likes.appendRow([newId('LK'), pid, toId, today, isoTime]);
            var newLikes = (Number(pData[target][COL.LIKES]) || 0) + 1;
            writeCells(db.players, target, COL.LIKES, [newLikes]);
            return jsonResponse({ ok: true, likes: newLikes });
        }

        if (act === 'friendReq') {
            var toId = String(payload.toId || '').trim();
            if (findRow(pData, toId) < 0 || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });
            var fData = db.friends.getDataRange().getValues();
            for (var i = 1; i < fData.length; i++) {
                var fr = fData[i];
                if (fr[1] === pid && fr[2] === toId) return jsonResponse({ ok: true, status: fr[3] });
                if (fr[1] === toId && fr[2] === pid) {
                    db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
                    return jsonResponse({ ok: true, status: 'accepted' });
                }
            }
            db.friends.appendRow([newId('FR'), pid, toId, 'pending', isoTime]);
            return jsonResponse({ ok: true, status: 'pending' });
        }

        if (act === 'friendAccept') {
            var toId = String(payload.toId || '').trim();
            var fData = db.friends.getDataRange().getValues();
            for (var i = 1; i < fData.length; i++) {
                if (fData[i][1] === toId && fData[i][2] === pid && fData[i][3] === 'pending') {
                    db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
                    return jsonResponse({ ok: true, status: 'accepted' });
                }
            }
            return jsonResponse({ ok: false, err: 'INVITATION_NOT_FOUND' });
        }

        if (act === 'updateProfile') {
            writeCells(db.players, me, COL.AVATAR, [
                sanitize(payload.avatar, 8) || '🪿',
                sanitize(payload.nickname, 30) || '匿名球員',
                sanitize(payload.department, 40)
            ]);
            writeCells(db.players, me, COL.UPDATED, [isoTime]);
            writeCells(db.players, me, COL.IG, [sanitizeIg(payload.ig)]);
            return jsonResponse({ ok: true });
        }

        if (act === 'sync_twin') {
            var twinData = String(payload.twin_data || '');
            if (twinData.length > MAX_TWIN_CHARS) return jsonResponse({ ok: false, err: 'TWIN_DATA_TOO_LARGE' });
            if (!safeParse(twinData)) return jsonResponse({ ok: false, err: 'INVALID_TWIN_JSON' });
            writeCells(db.players, me, COL.UPDATED, [isoTime, twinData]);
            return jsonResponse({ ok: true });
        }

        return jsonResponse({ ok: false, err: 'UNKNOWN_POST_ACTION' });
    } catch (err) {
        return jsonResponse({ ok: false, err: 'SERVER_ERROR: ' + err });
    } finally {
        lock.releaseLock();
    }
}
```

---

# Part B：片段修改

## B1. `js/game.js`

### G1　`solveArc`：整個函式替換為以下兩個函式

```js
function solveArcVacuum(fx, fy, fz, tx, tz, out, speedScale) {
    const dist = Math.hypot(tx - fx, tz - fz);
    const baseSpd = (speedScale || 1.0) * 11.8;
    const reqClear = NET_CLEAR + ((fz < 0 && tz < 2.6) ? 0.22 : 0.0);
    for (let k = 0; k < 16; k++) {
        const T = dist / Math.max(3.5, baseSpd - k * 0.70) + 0.22 + k * 0.06;
        const vx = (tx - fx) / T, vz = (tz - fz) / T;
        const vy = (BALL_R - fy + 0.5 * GRAVITY * T * T) / T;
        if ((fz > 0) !== (tz > 0)) {
            const tn = -fz / vz;
            if (tn > 0 && tn < T) {
                const yn = fy + vy * tn - 0.5 * GRAVITY * tn * tn;
                if (yn < reqClear) continue;
            }
        }
        out.set(vx, vy, vz); return true;
    }
    out.set(0, 6, tz > fz ? 7 : -7); return false;
}
function solveArc(fx, fy, fz, tx, tz, out, speedScale) {
    const ok = solveArcVacuum(fx, fy, fz, tx, tz, out, speedScale);
    if (currentPhysicsMode !== PHYSICS_MODES.ACADEMIC) return ok;
    return refineArcAcademic(fx, fy, fz, tx, tz, out);
}
```

### G2　`buildBall()`

找到從 `if (typeof camCfg !== 'undefined' && camCfg.ballScale) {` 開始，到 `ballGlow.scale.set(BALL_R * gScale, BALL_R * gScale, 1); scene.add(ballGlow);` 為止的整段，換成：

```js
const cfg0 = getResponsiveCameraConfig();
BALL_VIS.base = cfg0.ballScale;
BALL_VIS.glow = cfg0.glowScale;
scene.add(ball);
ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX_GLOW, color: 0xf0ff9a,
    transparent: true, opacity: cfg0.glowOpacity,
    blending: THREE.AdditiveBlending, depthWrite: false
}));
scene.add(ballGlow);
```

（球的縮放改由 `physics.js` 的 `sync()` 套用。之後的 `ballTrail`、`ballBlob` 建立程式碼不變。）

### G3　`handleStageResize`：整個函式替換

```js
let camCfgCache = null;
function handleStageResize() {
    if (!cam || !ren) return;
    const dims = getStageDimensions();
    const cfg = camCfgCache = getResponsiveCameraConfig(dims.w, dims.h);
    cam.aspect = dims.w / dims.h;
    cam.fov = cfg.fov;
    cam.updateProjectionMatrix();
    BALL_VIS.base = cfg.ballScale;
    BALL_VIS.glow = cfg.glowScale;
    const curPR = PERF_PRESETS[perfLevel] ? PERF_PRESETS[perfLevel].pixelRatio : 2.0;
    ren.setPixelRatio(Math.min(window.devicePixelRatio || 2, curPR));
    ren.setSize(dims.w, dims.h);
}
```

### G4　`updateGuides`：整個函式替換，並在它**上方**（`const pool = [];` 之後）加入輔助函式

```js
const _guideP0 = new THREE.Vector3();
const ARC_MAX = 240;
let arcPosAttr = null, arcDistAttr = null;
function writeArc(n) {
    if (!arcPosAttr) {
        arcPosAttr = new THREE.BufferAttribute(new Float32Array(ARC_MAX * 3), 3);
        arcDistAttr = new THREE.BufferAttribute(new Float32Array(ARC_MAX), 1);
        arcPosAttr.setUsage(THREE.DynamicDrawUsage);
        arcDistAttr.setUsage(THREE.DynamicDrawUsage);
        arc.geometry.setAttribute('position', arcPosAttr);
        arc.geometry.setAttribute('lineDistance', arcDistAttr);
        arc.frustumCulled = false;
    }
    let d = 0;
    for (let i = 0; i < n; i++) {
        const p = pool[i];
        arcPosAttr.setXYZ(i, p.x, p.y, p.z);
        if (i > 0) d += p.distanceTo(pool[i - 1]);
        arcDistAttr.setX(i, d);
    }
    arcPosAttr.needsUpdate = true;
    arcDistAttr.needsUpdate = true;
    arc.geometry.setDrawRange(0, n);
}
function setGuideColor(hex) {
    arc.material.color.setHex(hex);
    ringLand.userData.out.material.color.setHex(hex);
    ringLand.userData.glow.material.color.setHex(hex);
}
function previewArc(p0, v0, spin) {
    const r = simulateFlight(p0, v0, spin, pool);
    if (!r) { arc.visible = false; ringLand.visible = false; return null; }
    writeArc(r.n);
    ringLand.visible = true;
    ringLand.position.set(r.x, 0.016, r.z);
    return r;
}

function updateGuides(dt) {
    const ready = (state === 'SERVE_READY');
    const flying = (state === 'SERVE_AIR' || state === 'RALLY' || state === 'DEMO');
    const myServe = (server === 'PLAYER');
    const isDemo = (state === 'DEMO');
    arc.visible = (ready && myServe) || (isDemo && demoHold);
    zoneServe.visible = (ready && myServe) || isDemo;
    ringSpot.visible = (ready && stage === 1) || (isDemo && (stage === 1 || stage === 2));
    if (ringSpot.visible) {
        if (isDemo) ringSpot.position.set(dWalk.x, 0.014, dWalk.z);
        else ringSpot.position.set(1.5 * serveSide, 0.014, HALF_L + 0.35);
    }
    pulse += dt * 5;
    const inK = (stage >= 3 && flying && pPos.z < KITCHEN_D + 0.05);
    let want = inK ? 0.14 + 0.09 * Math.abs(Math.sin(pulse)) : 0;
    if (dFlash > 0) want = Math.max(want, 0.42 * dFlash * (0.6 + 0.4 * Math.abs(Math.sin(pulse * 2))));
    warnKitchen.material.opacity += (want - warnKitchen.material.opacity) * Math.min(1, dt * 8);
    updateWaistHud(); updateStanceHud();

    if (isDemo && demoHold) {
        zoneServe.position.set(dDemoTgt.x, 0.012, dDemoTgt.z);
        _guideP0.set(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
        solveArc(_guideP0.x, _guideP0.y, _guideP0.z, dDemoTgt.x, dDemoTgt.z, _a);
        previewArc(_guideP0, _a, 0);
        setGuideColor(0x3fe0c4);
        return;
    }

    if (ready && myServe) {
        zoneServe.position.set(diagSign() * COURT_W / 4, 0.012, -(KITCHEN_D + HALF_L) / 2);
        serveVel(power, _a);
        const r = previewArc(PH.pos, _a, getSwipeCurve());
        const willNet = !r || r.net;
        const fresh = webcamActive && serveCue.txt && (performance.now() - serveCue.t < 700);
        let msg = fresh ? serveCue.txt
            : (servePrepared ? '✅ 已解鎖,拍面低於腰後向上推拍' : '👉 請先「左手舉高」解鎖發球');
        let col = fresh ? serveCue.col : (servePrepared ? '#3fe0c4' : '#ffc857');
        const tX = ringLand.position.x, tZ = ringLand.position.z;
        if (pPos.z < HALF_L - 0.05) { msg = '⚠ 雙腳未在底線後'; col = '#ff6b6b'; }
        else if (stage === 1 && sideOf(pPos.x) !== serveSide) {
            msg = '⚠ 請站進藍圈(' + (serveSide > 0 ? '右' : '左') + '側)'; col = '#ff6b6b';
        }
        else if (padW.y > SERVE_MAX_H && !(webcamActive && SFSM.phase !== 'SETUP')) { msg = '⚠ 拍面過高,須低於腰部'; col = '#ff6b6b'; }
        else if (willNet) { msg = '⚠ 這球會掛網,加大蓄力'; col = '#ff6b6b'; }
        else if (Math.abs(tZ) > HALF_L) { msg = '⚠ 落點會出底線'; col = '#ffc857'; }
        else if (tZ > -KITCHEN_D) { msg = '⚠ 落點在中興湖廚房內'; col = '#ffc857'; }
        else if (serveFromRight ? (tX > DIAG_DEADZONE) : (tX < -DIAG_DEADZONE)) {
            msg = '⚠ 落點未進對角發球區'; col = '#ffc857';
        }
        if (webcamActive) {
            if (AIM.mode === 'LOCKED') msg += '　|　🔒 自動對角';
            else if (AIM.mode === 'LEFT_ZONE' || AIM.mode === 'TORSO') msg += '　|　🧭 ' + AIM_NAMES[AIM.idx];
            if (stanceOK && Math.abs(stanceBal) >= 1.4) msg += '　|　⚠ 重心已偏出雙腳外';
        }
        serveLegal = (col === '#3fe0c4');
        setHint(msg, col);
        setGuideColor(serveLegal ? 0x3fe0c4 : (col === '#ff6b6b' ? 0xff6b6b : 0xffc857));
        return;
    }

    if (ready && !myServe) {
        ringLand.visible = false;
        setHint('🪿 匹克鵝準備發球,站好底線等球落地一次', '#93a2bb');
        return;
    }

    if (flying && predictLanding(_land)) {
        ringLand.visible = true;
        ringLand.position.set(_land.x, 0.016, _land.z);
        const bad = (stage >= 3 && _land.z > 0 && _land.z < KITCHEN_D);
        const hex = bad ? 0xff2d2d : 0xffc857;
        ringLand.userData.out.material.color.setHex(hex);
        ringLand.userData.glow.material.color.setHex(hex);
        setHint(bad ? '🍳 這球會落在你的中興湖廚房,等它彈起再打' : '—', bad ? '#ff6b6b' : '#93a2bb');
    } else {
        ringLand.visible = false;
        setHint('—', '#93a2bb');
    }
}
```

### G5　`updateGoose`

**(a)** 刪除函式開頭的這一行：
```js
updateOpponentMeshVisibility();
```

**(b)** 在 `function updateGoose(dt) {` 的**上方**加入：
```js
function gooseErrorHit() {
    gLock = 0.5; lastHitter = 'GOOSE'; rallyHits++; bounces = 0;
    PH.spin = 0; dinkRallyCount = 0; isChanceBall = false;
    if (state === 'SERVE_AIR') state = 'RALLY';
}
function gooseForceNet(b) {
    const T = 0.6;
    const xn = THREE.MathUtils.clamp(b.x * 0.5, -(COURT_W / 2 - 0.3), COURT_W / 2 - 0.3);
    PH.vel.set((xn - b.x) / T, (0.45 - b.y + 0.5 * GRAVITY * T * T) / T, -b.z / T);
}
```

**(c)** 找到緊接在 `missRate = Math.min(missRate, 0.92);` 之後的整個 `if (Math.random() < missRate) { … }` 區塊（包含「微出界」、「掛網」、「出底線」、「慢揮漏球」四個分支），整塊換成：
```js
if (Math.random() < missRate) {
    const errType = Math.random();
    if (stage >= 4 && errType >= 0.80) { gLock = 0.6; return; }
    planShot();
    gooseErrorHit();
    if (stage >= 4 && errType < 0.40) {
        gooseForceNet(b);
        S.pop(0.4); toast('🪿 匹克鵝回擊掛網', '失誤');
    } else {
        solveArc(b.x, b.y, b.z, aiShot.x, HALF_L + 1.6, PH.vel);
        S.pop(0.7); toast(stage <= 3 ? '🪿 匹克鵝回擊微出界' : '🪿 匹克鵝回擊出底線', '失誤');
    }
    return;
}
```

### G6　`release()`：刪除函式開頭這段

```js
if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER') {
    swingT = 0.28;
    FunMode.tryElectrocuteFly();
}
```

### G7　`switchStage`

把 `function switchStage(n) {` 與下一行 `clearTimers();` 換成：
```js
function switchStage(n, opts) {
    clearTimers();
    if (typeof restoreTwinParams === 'function' && !(opts && opts.keepTwin)) restoreTwinParams();
    if (typeof FunMode !== 'undefined') FunMode.usedForcedItem = false;
```
其餘內容不變。

### G8　`loop()`

**(a)** 在 `let camX = 0, last = performance.now();` 的下一行加入：
```js
const _camDesPos = new THREE.Vector3(), _camDesLook = new THREE.Vector3();
const _camNormPos = new THREE.Vector3(), _camNormLook = new THREE.Vector3();
```

**(b)** 示波器那段：
```js
if (window.FLY_BRAIN && typeof diffLevel !== 'undefined' && diffLevel === 'fly') {
    const snnC = document.getElementById('fly-snn-canvas');
    if (snnC && snnC.offsetParent !== null) {
        FLY_BRAIN.renderOscilloscope(snnC);
    }
}
```
換成：
```js
if (window.FLY_BRAIN && diffLevel === 'fly') {
    if (!loop.snnC) { loop.snnC = document.getElementById('fly-snn-canvas'); loop.snnHud = document.getElementById('fly-snn-hud'); }
    if (loop.snnHud && loop.snnHud.style.display !== 'none') FLY_BRAIN.renderOscilloscope(loop.snnC);
}
```

**(c)** 電蚊拍鏡頭區塊中：
```js
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
```
換成：
```js
const desiredPos = _camDesPos;
const desiredLook = _camDesLook;
```

**(d)** `camViewMode === 0` 區塊中，`const cfg = … ;` 以及兩行 `new THREE.Vector3(...)` 換成：
```js
const cfg = camCfgCache || getResponsiveCameraConfig();
const normalTargetPos = _camNormPos.set(camX * 0.4 + sx, cfg.camH + sy, cfg.camDist);
const normalTargetLook = _camNormLook.set(camX * 0.25, cfg.lookY, cfg.lookZ);
```

### G9　`submitScoreToCloud`：函式開頭加入

```js
if (typeof FunMode !== 'undefined' && FunMode.usedForcedItem) { toast('🧪 本局使用過試用道具', '成績不列入英雄榜'); return; }
if (window.CUSTOM_MODEL_ACTIVE) { toast('🛠️ 教練參數模式', '成績不列入英雄榜'); return; }
```

### G10　檔案結尾的啟動區塊

- 刪除 `initNavDrag();` 這一行
- 在 `if (typeof syncNetAssistUI === 'function') syncNetAssistUI();` 之後加入：
```js
syncPhysicsModeUI();
syncSubbarStates();
```

### G11（選做）
全檔中的 `PH.spinInc = 0;` 可以刪除，屬性已不存在，留著不會出錯。

---

## B2. `js/ui.js`

### U1　兩個函式替換

```js
function cycleAimModeQuick() {
    const modes = ['LOCKED', 'LEFT_ZONE', 'TORSO', 'RIGHT_FREE'];
    setAimMode(modes[(modes.indexOf(AIM.mode) + 1) % modes.length]);
    syncSubbarStates();
}
function cycleTeachLevelQuick() {
    const levels = ['easy', 'normal', 'strict'];
    setTeachLevel(levels[(levels.indexOf(TEACH.level) + 1) % levels.length]);
    syncSubbarStates();
}
```

### U2　`syncSubbarStates`：整個函式替換

```js
function syncSubbarStates() {
    const aiBtn = document.getElementById('subbar-ai-btn');
    if (aiBtn) {
        aiBtn.innerHTML = webcamActive ? '📷 體感: 開啟' : '📷 體感: 關閉';
        aiBtn.style.color = webcamActive ? 'var(--lime)' : 'var(--ok)';
    }
    document.querySelectorAll('#subbar-stage .stage-btn[data-stage]').forEach(btn => {
        btn.classList.toggle('on', +btn.dataset.stage === stage);
    });
    const aimBtn = document.getElementById('subbar-aim-btn');
    if (aimBtn) {
        const map = { LOCKED: '🔒 自動對角', LEFT_ZONE: '🧭 左手瞄準', TORSO: '🔄 轉身瞄準', RIGHT_FREE: '✋ 右手自由' };
        aimBtn.innerHTML = `🎯 瞄準: ${map[AIM.mode] || AIM.mode}`;
    }
    const teachBtn = document.getElementById('subbar-teach-btn');
    if (teachBtn) {
        const map = { easy: '🟢 寬鬆', normal: '🟡 標準', strict: '🔴 嚴格' };
        teachBtn.innerHTML = `🎚️ 判定: ${map[TEACH.level] || TEACH.level}`;
    }
    const diffBtn = document.getElementById('subbar-diff-btn');
    if (diffBtn) {
        const map = { easy: '🟢 初階', medium: '🟡 中等', hard: '🔴 困難', fly: '🪰 蒼蠅' };
        diffBtn.innerHTML = `🤖 對手: ${map[diffLevel] || diffLevel}`;
    }
    const perfBtn = document.getElementById('subbar-perf-btn');
    if (perfBtn) {
        const map = { low: '🟢 節能', medium: '🟡 平衡', high: '🔴 原生高畫質', ultra: '🟣 極致' };
        perfBtn.innerHTML = `⚡ 畫質: ${map[perfLevel] || perfLevel}`;
    }
    const scaleLbl = document.getElementById('quick-scale-lbl');
    if (scaleLbl) scaleLbl.innerText = `${Math.round((cardScales.info || 1.0) * 100)}%`;
    const refLbl = document.getElementById('ref-mode-lbl');
    if (refLbl && REFEREE_MODES[refereeMode]) refLbl.innerText = REFEREE_MODES[refereeMode];
    syncDifficultyUI();
    syncJoySpeedUI();
    syncPhysicsModeUI();
}
```
⚠️ 此函式使用 `TEACH`（定義於 `game.js`），**不可在 `ui.js` 頂層同步呼叫**。

### U3　`TOUR_STEPS`：整個陣列替換

```js
const TOUR_STEPS = [
    {
        targetSelector: '#nav button[data-menu="settings"]',
        title: '⚙️ 第一站：雙層分類設定選單',
        badge: '第 1 / 3 站 · 功能收納',
        desc: '點擊【設定】可展開視角畫面、操作手感與系統偏好三大分類！',
        onEnter: () => { if (activeNavMenu !== 'settings') toggleNavMenu('settings'); switchSettingsTab('view'); },
        onExit: () => { closePanel(); }
    },
    {
        targetSelector: '#nav button[data-menu="social"]',
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
                    ig: '',
                    score: 32,
                    stats: { serve: 95, dink: 88, spin: 94, chain: 92, speed: 90 }
                });
            }, 300);
        },
        onExit: () => { closeSocialCard(); closeSocial(); }
    },
    {
        targetSelector: '#speed-hud-mini',
        title: '🎾 第三站：滑動擊球與即時數據',
        badge: '第 3 / 3 站 · 實戰手感',
        desc: '向前滑動推打深球、左右切刷出香蕉側旋弧線！膠囊常駐顯示即時球速與揮拍蓄力值。',
        onEnter: () => { showFingerTutorial(); },
        onExit: () => { dismissFingerTutorial(); }
    }
];
```

### U4　`MODAL_IDS`

```js
const MODAL_IDS = ['login-overlay', 'profile-modal', 'audio-modal', 'tech-modal', 'social-modal',
    'audit-modal', 'social-card-modal', 'mock-chat-modal', 'rules-modal', 'item-cards-modal'];
```

---

## B3. `js/motion.js`

`applyPerfPreset` 中，在 `ren.setSize(sw, sh);` 的**前一行**加入：
```js
ren.setPixelRatio(dpr);
```

---

## B4. `js/social.js`

### S1　審計日誌編號

`auditLogAdd` 的上方加入 `let auditSeq = 0;`，並把函式內的
```js
entry.id = AUDIT_LOG.length + 1;
```
換成
```js
entry.id = ++auditSeq;
```
`loadAuditCache` 中 `AUDIT_LOG.push(...arr.slice(-20));` 的下一行加入：
```js
auditSeq = AUDIT_LOG.reduce((m, r) => Math.max(m, r.id || 0), 0);
```
`renderAuditTable` 空表那行的 `colspan="11"` 改成 `colspan="12"`。

### S2　數位孿生：`battleDigitalTwin` 整個函式替換，並在上方加入 `restoreTwinParams`

```js
let twinBackup = null;
function restoreTwinParams() {
    if (!twinBackup) return;
    AI_SPEED[4] = twinBackup.speed; AI_MISS[4] = twinBackup.miss;
    twinBackup = null;
}
function battleDigitalTwin() {
    closeSocialCard();
    if (!currentFriendData) return;
    toast('⚔️ 載入數位孿生行為模型', '對手匹克鵝已套用「' + currentFriendData.nickname + '」之球風與側旋特徵！');
    if (!twinBackup) twinBackup = { speed: AI_SPEED[4], miss: AI_MISS[4] };
    AI_SPEED[4] = 6.2;
    AI_MISS[4] = 0.08;
    switchStage(4, { keepTwin: true });
}
```

### S3　體感按鈕同步
在以下三處的最後各加一行 `syncSubbarStates();`：
- `startWebcamAI` 中 `cameraUtils.start().then(() => { … })` 的 callback 內
- 同一段 `.catch(err => { … })` 的 callback 內
- `stopWebcamAI` 函式的結尾

### S4　`openPlayerCard`：不再捏造 IG 帳號
找到：
```js
const igHandle = currentFriendData.ig || ('user_' + (currentFriendData.playerId ? currentFriendData.playerId.slice(-4) : 'nchu'));
currentFriendData.ig = igHandle;
document.getElementById('sc-ig-tag').innerHTML = '<span style="font-size:11px;color:#c084fc;">📸 @' + escapeHtml(igHandle) + '</span>';
```
換成：
```js
const igHandle = currentFriendData.ig || '';
document.getElementById('sc-ig-tag').innerHTML = igHandle
    ? '<span style="font-size:11px;color:#c084fc;">📸 @' + escapeHtml(igHandle) + '</span>'
    : '<span style="font-size:11px;color:var(--dim);">尚未綁定 IG</span>';
document.getElementById('sc-ig-btn').style.display = igHandle ? '' : 'none';
document.getElementById('mc-ig-btn').style.display = igHandle ? '' : 'none';
```

### S5　`openFriendIG`：整個函式替換
```js
function openFriendIG() {
    const clean = (currentFriendData && currentFriendData.ig || '').replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) { toast('對方尚未綁定 IG', ''); return; }
    window.open('https://instagram.com/' + encodeURIComponent(clean), '_blank', 'noopener');
}
```

### S6　`syncDigitalTwin`
`recentShots: AUDIT_LOG.slice(-20),` 改成 `recentShots: AUDIT_LOG.slice(-10),`

---

## B5. `js/fun_mode.js`

### F1　開發後門只在本機啟用
- IIFE 開頭 `'use strict';` 的下一行加入：
```js
const DEV_MODE = ['localhost', '127.0.0.1'].includes(location.hostname);
```
- `init` 中 `this.bindDevShortcuts();` 改成 `if (DEV_MODE) this.bindDevShortcuts();`
- 檔案底部的 `window.giveSwatter = function () { … };` 與 `window.giveItem = function (id) { … };` 兩段，用 `if (DEV_MODE) { … }` 包起來

### F2　試用道具標記
- `FunMode` 物件中（例如 `lastPickedId: null,` 下一行）加入屬性 `usedForcedItem: false,`
- `forceItem: function(itemId) {` 的下一行加入 `this.usedForcedItem = true;`

### F3　巨無霸鐵球
- `triggerPickup` 的 MEGA_BALL 分支整段換成：
```js
} else if (item.id === 'MEGA_BALL') {
    BALL_VIS.item = 2.8;
    if (typeof ball !== 'undefined' && ball) ball.material.color.set(0x334155);
```
- `clearPlayerBuff` 的 MEGA_BALL 分支整段換成：
```js
} else if (this.activeBuff === 'MEGA_BALL') {
    if (typeof ball !== 'undefined' && ball) ball.material.color.set(0xffffff);
```
- `clearPlayerBuff` 函式開頭（重設 `pPad.scale` 那段附近）加入 `BALL_VIS.item = 1;`

### F4　電擊連動示波器
`executeFlyZap` 中共有 3 段（第 1、2、3 擊各一段）以 `if (window.FLY_BRAIN) {` 開頭、內含 `gfVm` 與 `fly-snn-status` 的區塊，每段都整段換成：
```js
if (window.FLY_BRAIN) window.FLY_BRAIN.Vm = window.FLY_BRAIN.vPeak;
```

---

## B6. `js/config.js`

### C1　API 區塊
**刪除**：`GAS_URL`、`SIGN_SECRET` 兩個常數，整個 `const SHA = (() => { … })();`，以及原本的 `API_READY`、`postSigned`、`apiGet`。在原位置加入：

```js
// ★ 部署後由人工填入 Worker 網址；保持佔位字串時會自動進入離線模式
const PROXY_URL = 'https://YOUR-WORKER.workers.dev';
const API_READY = () => /^https:\/\//.test(PROXY_URL) && PROXY_URL.indexOf('YOUR-WORKER') < 0;

const TOKEN_KEY = 'nchu_pb_token';
function getOrCreateToken() {
    let t = null;
    try { t = localStorage.getItem(TOKEN_KEY); } catch (e) { }
    if (!t || !/^[a-f0-9]{32}$/.test(t)) {
        t = Array.from(crypto.getRandomValues(new Uint8Array(16)),
            b => b.toString(16).padStart(2, '0')).join('');
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { }
    }
    return t;
}

function postSigned(payload) {
    if (!API_READY()) return Promise.resolve({ ok: false, err: 'API_URL_NOT_SET' });
    return fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, payload, { token: getOrCreateToken() }))
    }).then(r => r.json()).catch(() => ({ ok: false, err: 'NETWORK_FAIL' }));
}
function apiGet(qs) {
    if (!API_READY()) return Promise.resolve({ ok: false, err: 'API_URL_NOT_SET' });
    return fetch(PROXY_URL + '?' + qs).then(r => r.json()).catch(() => ({ ok: false, err: 'NETWORK_FAIL' }));
}
```

### C2　`APP_VERSION`
改成 `const APP_VERSION = 'v5.1.0';`

### C3　`handleQuickStart`
- 在 `playerProfile.nickname = saved.nickname || '叫獸aka愛叫的野獸';` 之後加入：
```js
playerProfile.ig = saved.ig || '';
```
- 在 `document.getElementById('login-overlay').style.display = 'none';` 之後加入：
```js
document.body.classList.remove('login-open');
```

### C4　`handleLogin`
- **刪除**：`playerProfile.ig = (document.getElementById('edit-ig').value || '').trim();`
- `saveIdentity({ … })` 物件內加入一行 `ig: playerProfile.ig || '',`
- 在 `document.getElementById('login-overlay').style.display = 'none';` 之後加入：
```js
document.body.classList.remove('login-open');
```

### C5　`openProfileModal`
在 `document.getElementById('edit-nick').value = playerProfile.nickname;` 之後加入：
```js
document.getElementById('edit-ig').value = playerProfile.ig || '';
```

### C6　`saveProfile`：整個函式替換
```js
function saveProfile() {
    playerProfile.department = document.getElementById('edit-dept').value.trim() || playerProfile.department;
    const n = document.getElementById('edit-nick').value.trim();
    if (n) {
        playerProfile.nickname = n;
        checkAdminAccess(n);
    }
    playerProfile.ig = document.getElementById('edit-ig').value.trim().replace(/^@/, '');
    document.getElementById('p-who-label').innerText =
        playerProfile.avatar + ' ' + playerProfile.nickname.slice(0, 6);
    const sv = loadIdentity() || {};
    sv.playerId = playerProfile.playerId || getOrCreatePlayerId();
    sv.sidPrefix = playerProfile.sidPrefix || sv.sidPrefix;
    sv.avatar = playerProfile.avatar;
    sv.nickname = playerProfile.nickname;
    sv.department = playerProfile.department;
    sv.ig = playerProfile.ig;
    saveIdentity(sv);
    closeProfileModal();
    if (playerProfile.playerId) {
        postSigned({
            act: 'updateProfile', playerId: playerProfile.playerId, avatar: playerProfile.avatar,
            nickname: playerProfile.nickname, department: playerProfile.department,
            ig: playerProfile.ig || ''
        }).then(r => {
            if (r && r.err === 'UNAUTHORIZED') toast('⚠️ 雲端身分驗證失敗', '此玩家編號已綁定其他裝置');
        });
    }
    toast('⚙️ 個人設定已儲存', '繼續中興湖特訓!');
}
```

### C7　教練參數標記
在以下兩處的 `applyMotionModel(...)` 之後各加一行 `window.CUSTOM_MODEL_ACTIVE = true;`：
- `loadCustomMotionModel` 內
- `onCoachFileSelected` 的 `reader.onload` 內

---

## B7. CSS

### `css/hud.css`
6 個 `body:has(#login-overlay:not([style*="display: none"]))` 選擇器全部改成 `body.login-open`，其餘不變。

### `css/style.css`（檔案最後加入）
```css
input, textarea, select { -webkit-user-select: text; user-select: text; }
```

### `css/modals.css`
兩段 `#speed-hud-mini { … }` 規則中，**只刪除 `bottom: 14px;` 與 `left: 14px;` 兩行**。
⚠️ **`position: absolute;` 必須保留**，`hud.css` 沒有設定定位。

---

## B8. `v14.html`（模板）

1. `<body class="layout-v4">` → `<body class="layout-v4 login-open">`
2. 第一行註解與 `<title>` 中的版本號改為 `v5.1.0`
3. `<tbody id="audit-tbody">` 內的 `colspan="11"` → `colspan="12"`
4. 規則手冊「學術 04」卡片中，`本遊戲 3D 物理引擎即時以四階數值積分求解…` 那一句改成：
   `本遊戲 3D 物理引擎以半隱式 Euler（固定步長 h = 1/120 s）數值積分求解下列方程式，可用下方按鈕切換兩種模式：`
5. 細項 ⑤ 的「運動學效果」那一條改成：
   `• <b>運動學效果</b>：使側旋造成的偏折隨時間收斂，不會持續加速偏移。`
6. `tech-modal` 中刪除「，維持真實賽場微弧線（橫向偏折極限 0.15m~0.22m）」這段文字
7. 將「⚙️【工程答辯精髓】…」整個黃框 `<div>`（從 `<div style="background:linear-gradient(135deg, rgba(234,179,8,0.12)` 開始到它對應的結束標籤）替換為：

```html
<div style="background:linear-gradient(135deg, rgba(234,179,8,0.12), rgba(15,23,42,0.85));border:1.5px solid rgba(234,179,8,0.4);border-radius:10px;padding:14px 16px;margin-top:6px;">
    <div style="font-weight:900;color:#facc15;font-size:14px;margin-bottom:8px;">⚙️ 理論方程式 vs. 實際程式實作</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(56,189,248,0.3);border-radius:6px;padding:10px;">
            <div style="font-weight:800;color:#38bdf8;font-size:12px;margin-bottom:4px;">⚡ 極速模式 (FAST)</div>
            <div style="font-size:11.5px;color:#cbd5e1;line-height:1.6;">
                • 線性阻尼：<code>v<sub>x,z</sub> ← v<sub>x,z</sub>·(1 − 0.09h)</code><br>
                • 經驗側向加速度：<code>a<sub>x</sub> = 3.6·spin·(0.8 + 0.2·|v<sub>z</sub>|/8)</code><br>
                • 自旋衰減 0.14 s⁻¹<br>
                • 目的：手感穩定、落點容易預測
            </div>
        </div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(129,140,248,0.35);border-radius:6px;padding:10px;">
            <div style="font-weight:800;color:#c7d2fe;font-size:12px;margin-bottom:4px;">🔬 學術模式 (ACADEMIC)</div>
            <div style="font-size:11.5px;color:#cbd5e1;line-height:1.6;">
                • 二次方阻力 <code>a = −k|v|v</code>，k = ½C<sub>d</sub>ρA/m ≈ 0.0588 m⁻¹；以隱式形式 <code>v ← v/(1+k|v|h)</code> 更新<br>
                • 馬格努斯力 <code>a = ½C<sub>L</sub>ρA|v|²/m</code>，方向為 ω×v；C<sub>L</sub> ≈ 0.8·S（S = Rω/|v|），上限 0.25<br>
                • 自旋指數衰減 β = 0.35 s⁻¹<br>
                • 擊球初速以打靶法反覆修正，落點誤差 &lt; 10 cm
            </div>
        </div>
    </div>
    <div style="margin-top:10px;background:rgba(15,23,42,0.8);border:1px solid rgba(234,179,8,0.25);border-radius:6px;padding:10px 12px;font-size:11.5px;color:#cbd5e1;line-height:1.6;">
        <b style="color:#fcd34d;">⚠️ 模型限制</b><br>
        • 多孔球的 C<sub>L</sub> 與自旋衰減缺乏公開風洞資料；spin = 1 對應 80 rad/s 與 C<sub>L</sub> 斜率皆為假設值，以遊戲手感校正<br>
        • 碰撞與視覺使用放大半徑 0.14 m（手機可見度），空氣動力學使用真實半徑 0.037 m<br>
        • 落地反彈採經驗恢復係數（垂直 0.55、水平 0.68），未建模球與地面的摩擦及自旋耦合
    </div>
</div>
```

---

## B9. 文件

### `backend/` 內的部署說明 `.md`
- 步驟 1 第 5 點：「編輯既有部署 → 新版本」改成「**新增部署作業**，複製新的 `/exec` 網址，並在『管理部署作業』中**封存舊部署**」
- 步驟 1 新增一點：「專案設定 → 指令碼屬性 → 新增 `SIGN_SECRET`，值為自行產生的隨機字串」
- 步驟 2 第 5 點：`GAS_URL` 與 `SIGN_SECRET` **都**用「新增機密 (Secret)」；`SIGN_SECRET` 的值改成「與 GAS 指令碼屬性相同的隨機字串」，**刪除** `nchu-pickleball-2026-secret`
- 步驟 3 的指令改成：`node scripts/build-single.js`（腳本已自動同步 `index.html`，不需要 `cp`）
- 「生效成果」中「徹底杜絕洗榜」改成「防止冒用他人身分與提交超出範圍的分數」

### `整合報告.md`
搜尋以下字詞，逐一依右欄修正：

| 搜尋 | 修正為 |
|---|---|
| 四階、RK4、Runge-Kutta | 半隱式 Euler（Symplectic Euler） |
| 1/240、240Hz、30 子步 | h = 1/120 s，每幀最多 16 子步 |
| 0.15m~0.22m、0.15~0.22 | 刪除，或改成「側旋偏折隨時間收斂」 |
| `[-2.2, 2.2]`、spinInc | 刪除 |
| 5400-5440 行 | 刪除 |
| 嚴格學術求解 | 學術模式（二次方阻力 + 馬格努斯力，C_L 為假設值） |
| 企業級、徹底杜絕、100% | 依「Part E 已知限制」改為如實敘述 |

⚠️ 規則手冊的文獻 [3] Smith & Nathan (2020)、[4]、[5] 需**人工**查證是否存在，執行者不得自行編造或修改書目。

---

# Part C：人工步驟（執行者不得處理）

依序進行，期間社交功能會中斷數分鐘：

1. 產生新金鑰：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. **GAS**：貼上 `Code.gs` → 指令碼屬性新增 `SIGN_SECRET` → **新增部署作業** → 複製新網址 → **封存舊部署**；確認已啟用 V8
3. **Worker**：貼上 `cloudflare-worker.js` → `GAS_URL`、`SIGN_SECRET` 皆設為 **Secret**
4. **前端**：把 `config.js` 的 `PROXY_URL` 改成 Worker 網址 → `node scripts/build-single.js` → commit 並 push
5. 確認 repo 中已經**沒有** `nchu-pickleball-2026-secret` 與舊 GAS 網址：`git grep -n "nchu-pickleball-2026-secret"`（git 歷史仍會保留，所以第 1、2 步的換金鑰和封存舊部署是必要的）

---

# Part D：測試清單

### 前端
1. 每一關的示範：3D 畫面正常播放、不凍結
2. 手機版：球是否變大；拿到巨無霸鐵球時球變大，結束後恢復原色
3. 球速膠囊在右下角，沒有壓住左下角搖桿
4. 子選單「🎯 瞄準」「🎚️ 判定」可點擊；開啟相機後「📷 體感」顯示開啟
5. 第 4 關：匹克鵝「掛網」真的撞網、「出底線」真的出界，且都是**玩家得分**
6. 切換學術模式：所有 UI 標籤同步；能正常對打；落點圈準確；重新整理後仍保持學術模式
7. 設定 IG → 重新整理 → 開啟個人檔案，IG 仍在
8. 正式網址上：按 `E` 不會召喚電蚊拍；Console 輸入 `giveSwatter` 回傳 `undefined`
9. 登入畫面時看不到示範卡片與選單；登入後正常顯示

### 後端（部署後）
```bash
W=https://你的-worker.workers.dev
# 應回傳 FORBIDDEN_ORIGIN
curl -s -X POST $W -d '{"act":"submit"}'
# 應回傳 UNAUTHORIZED
curl -s -X POST $W -H "Origin: https://kalmangoose.github.io" -H "Content-Type: application/json" \
  -d '{"act":"updateProfile","playerId":"P-英雄榜上的ID","token":"00000000000000000000000000000000","nickname":"test"}'
# 應回傳 INVALID_SCORE_RANGE（會建立 P-TEST-0001，測完手動刪除該列）
curl -s -X POST $W -H "Origin: https://kalmangoose.github.io" -H "Content-Type: application/json" \
  -d '{"act":"submit","playerId":"P-TEST-0001","token":"0123456789abcdef0123456789abcdef","score":21,"stage":5}'
# 舊 GAS 網址應已失效
curl -s -L -X POST '舊的 GAS /exec 網址' -d '{}'
```

---

# Part E：已知限制（報告時請如實說明）

- 尚未綁定 token 的舊玩家，誰先寫入誰就能綁定。可請同學部署後都登入一次，或清空 `players` 表
- token 只存在 localStorage，清除瀏覽器資料或換裝置後無法再修改原本的玩家資料
- 遊戲邏輯在瀏覽器執行，玩家仍能用自己的 token 提交合法範圍內的分數（最高 5 分）
- Worker 頻率限制是 isolate 記憶體內計數，屬盡力而為
- 每個 GAS 請求都會讀取整張工作表，適合班級規模
- 學術模式的 C_L、ω 對應、自旋衰減皆為假設值
- 學術模式下，發球預覽每幀會執行打靶法，低階手機可能掉幀
- 單打第二發球權、英雄榜同分無鑑別度等規則設計問題，本次未處理
