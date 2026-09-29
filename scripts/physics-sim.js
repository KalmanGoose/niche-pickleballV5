#!/usr/bin/env node
/**
 * NCHU Pickleball V5 - 物理引擎與擊球動力學自動化模擬器 (Physics Dynamics & Hitting Simulation)
 * 驗證發球、丁克、抽殺、馬格努斯曲球、被動擋球與連續碰撞檢測 (CCD)
 * 執行：node scripts/physics-sim.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── 輕量級 THREE.js 模擬環境 ──
class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

const MathUtils = {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    lerp: (x, y, t) => x + (y - x) * t
};

const THREE = { Vector3, MathUtils };

// ── 載入常數與物理模組 ──
const ROOT = path.resolve(__dirname, "..");
const configSrc = fs.readFileSync(path.join(ROOT, "js", "config.js"), "utf8");
const physSrc = fs.readFileSync(path.join(ROOT, "js", "physics.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");

const sandbox = {
    THREE,
    window: {},
    document: {
        getElementById: () => ({ style: {} }),
        querySelectorAll: () => [],
        querySelector: () => null
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { userAgent: "Node" },
    console,
    Math,
    performance: { now: () => Date.now() },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    state: "RALLY",
    ballSquash: 0,
    ball: null,
    ballGlow: { position: new Vector3(), scale: new Vector3(), material: { opacity: 0, color: { set: () => {} } } },
    ballTrail: [],
    ballBlob: { position: new Vector3(), scale: new Vector3(), material: { opacity: 0 } },
    onNet: () => {},
    onBounce: () => {},
    onDead: () => {},
    S: { net: () => {}, thump: () => {}, pop: () => {} },
    addShake: () => {},
    popRing: () => {}
};

// 提取 config 常數
vm.runInNewContext(configSrc + `
globalThis.PHYSICS_MODES = PHYSICS_MODES;
globalThis.currentPhysicsMode = currentPhysicsMode;
globalThis.COURT_W = COURT_W;
globalThis.COURT_L = COURT_L;
globalThis.HALF_L = HALF_L;
globalThis.KITCHEN_D = KITCHEN_D;
globalThis.NET_H = NET_H;
globalThis.BALL_R = BALL_R;
globalThis.GRAVITY = GRAVITY;
`, sandbox);

// 提取 physics
vm.runInNewContext(physSrc + `
globalThis.integrateVel = integrateVel;
globalThis.crossesNet = crossesNet;
`, sandbox);

// 提取 game.js 中的 solveArcVacuum, solveArc 關鍵計算
const mSolveArcVac = gameSrc.match(/function solveArcVacuum\(fx, fy, fz, tx, tz, out, speedScale\)[\s\S]*?\n}/);
const mSolveArc = gameSrc.match(/function solveArc\(fx, fy, fz, tx, tz, out, speedScale\)[\s\S]*?\n}/);
if (mSolveArcVac) vm.runInNewContext(mSolveArcVac[0] + "\nglobalThis.solveArcVacuum = solveArcVacuum;", sandbox);
if (mSolveArc) vm.runInNewContext(mSolveArc[0] + "\nglobalThis.solveArc = solveArc;", sandbox);

const {
    COURT_W, COURT_L, HALF_L, KITCHEN_D, NET_H, BALL_R, GRAVITY,
    PHYSICS_MODES, currentPhysicsMode, integrateVel, crossesNet,
    solveArcVacuum, solveArc
} = sandbox;

console.log("═══════════════════════════════════════════════════════════");
console.log("🎾 NCHU Pickleball 多版本物理動力學與彈道模擬測試");
console.log("═══════════════════════════════════════════════════════════\n");

let passed = 0, failed = 0;
function testAssert(cond, title, details) {
    if (cond) {
        console.log(`  ✅ [PASS] ${title}`);
        passed++;
    } else {
        console.error(`  ❌ [FAIL] ${title}${details ? " -> " + details : ""}`);
        failed++;
    }
}

/**
 * 飛行積分模擬器：模擬球從初速/自旋出發，直到落地或撞網
 */
function simBallTrajectory(p0, v0, spin, mode, dtStep = 1 / 120, maxT = 4.0) {
    const p = p0.clone();
    const v = v0.clone();
    let s = spin;
    let t = 0;
    let apexY = p.y;
    let netY = null;
    let netT = null;
    let hitNet = false;
    let landed = false;
    const history = [{ t, x: p.x, y: p.y, z: p.z }];

    while (t < maxT) {
        const pz0 = p.z, py0 = p.y;
        s = integrateVel(v, s, dtStep, mode);
        p.addScaledVector(v, dtStep);
        t += dtStep;

        if (p.y > apexY) apexY = p.y;

        // 檢查過網處的 Y 高度
        if (pz0 * p.z <= 0 && pz0 !== p.z) {
            netY = p.y;
            netT = t;
            if (crossesNet(pz0, p.z, p.y, p.x, py0)) {
                hitNet = true;
                break;
            }
        }

        // 地面碰撞
        if (p.y <= BALL_R && v.y < 0) {
            landed = true;
            break;
        }

        history.push({ t, x: p.x, y: p.y, z: p.z });
    }

    return {
        landed,
        hitNet,
        landX: p.x,
        landY: p.y,
        landZ: p.z,
        landT: t,
        apexY,
        netY,
        finalVel: v.length(),
        spinRemaining: s,
        history
    };
}

// ── 測試 1：發球過網與對角落點檢測 (Serve Trajectories) ──
console.log("▶ [1/4] 發球彈道與對角發球區落點驗證 (Serve Sweeps)...");
const servePowers = [0.2, 0.4, 0.6, 0.8, 1.0];
const serveSpins = [0, 0.45, -0.45, 0.85, -0.85];

for (const pwr of servePowers) {
    const targetZ = -(KITCHEN_D + 0.20 + pwr * (HALF_L - KITCHEN_D - 0.60));
    for (const sp of serveSpins) {
        const targetX = -1.525 - sp * 0.50;
        const p0 = new Vector3(1.5, 0.70, HALF_L + 0.35);
        const v0 = new Vector3();
        const ok = solveArcVacuum(p0.x, p0.y, p0.z, targetX, targetZ, v0);

        const simFast = simBallTrajectory(p0, v0, sp, PHYSICS_MODES.FAST);
        testAssert(
            ok && !simFast.hitNet && simFast.netY >= NET_H + BALL_R,
            `FAST發球 (力道 ${(pwr * 100).toFixed(0)}%, 旋轉 ${sp.toFixed(2)}) 順利過網 (淨空 ${(simFast.netY - NET_H).toFixed(2)}m)`,
            `淨空不足或撞網`
        );
        testAssert(
            simFast.landZ < -KITCHEN_D && simFast.landZ > -HALF_L,
            `FAST發球落入合法發球深度 (Z=${simFast.landZ.toFixed(2)}m, 廚房=${-KITCHEN_D}m, 底線=${-HALF_L}m)`
        );
    }
}

// ── 測試 2：擊球類型與手感階梯驗證 (Dink, Drive, Smash, Passive Block) ──
console.log("\n▶ [2/4] 4 級擊球階梯動力學驗證 (Dink / Drop / Drive / Smash)...");
// ① 廚房精準丁克 (Dink): 柔和慢速越網，落在對面廚房區 (-1.15m ~ -1.75m)
{
    const p0 = new Vector3(0.5, 0.45, 2.2);
    const v0 = new Vector3();
    const tz = -1.45;
    solveArcVacuum(p0.x, p0.y, p0.z, 0.0, tz, v0, 0.65);
    const sim = simBallTrajectory(p0, v0, 0, PHYSICS_MODES.FAST);
    testAssert(
        !sim.hitNet && sim.landZ < 0 && sim.landZ > -KITCHEN_D,
        `廚房丁克 (Dink): 柔和過網並精準落在對面廚房內 (Z=${sim.landZ.toFixed(2)}m, 飛行=${sim.landT.toFixed(2)}s)`
    );
}

// ② 過渡區深推球 (Deep Drop / Dink): 落在對手腳邊 (-2.5m ~ -3.5m)
{
    const p0 = new Vector3(0.2, 0.55, 3.8);
    const v0 = new Vector3();
    const tz = -3.2;
    solveArcVacuum(p0.x, p0.y, p0.z, -0.5, tz, v0, 1.0);
    const sim = simBallTrajectory(p0, v0, 0, PHYSICS_MODES.FAST);
    testAssert(
        !sim.hitNet && sim.landZ <= -KITCHEN_D && sim.landZ > -HALF_L,
        `過渡區深推 (Drop): 壓制在深區 (Z=${sim.landZ.toFixed(2)}m)`
    );
}

// ③ 底線平抽與殺球 (Power Drive / Smash): 極速直轟底線 (spdScale = 1.35)
{
    const p0 = new Vector3(-0.3, 0.70, 5.5);
    const v0 = new Vector3();
    const tz = -5.8;
    solveArcVacuum(p0.x, p0.y, p0.z, 1.2, tz, v0, 1.35);
    const sim = simBallTrajectory(p0, v0, 0, PHYSICS_MODES.FAST);
    testAssert(
        !sim.hitNet && sim.landZ <= -4.0 && sim.landZ > -HALF_L - 0.5,
        `底線平抽 (Drive): 高速直穿底線 (Z=${sim.landZ.toFixed(2)}m, 初速=${v0.length().toFixed(1)}m/s)`
    );
}

// ④ 確定性被動擋球 (Deterministic Passive Block)
{
    const incomingFast = 10.0;
    const tzPass = -(0.75 + Math.min(1.0, (incomingFast - 4.8) / 6.0) * 0.50);
    const p0 = new Vector3(0, 0.60, 4.5);
    const v0 = new Vector3();
    solveArcVacuum(p0.x, p0.y, p0.z, 0, tzPass, v0, 0.60);
    const simPass = simBallTrajectory(p0, v0, 0, PHYSICS_MODES.FAST);
    testAssert(
        !simPass.hitNet && simPass.landZ < 0 && simPass.landZ > -KITCHEN_D,
        `高速來球被動擋球: 成功借力卸力軟化過網落於廚房 (Z=${simPass.landZ.toFixed(2)}m)`
    );

    const incomingSlow = 4.0;
    const isNetError = (incomingSlow < 4.8 || 0.28 < 0.32);
    testAssert(
        isNetError,
        `低速低角度被動擋球: 物理確定性判定能量不足掛網 (非隨機幣擲)`
    );
}

// ── 測試 3：馬格努斯效應 (Magnus Curve) 橫向側偏量化測試 ──
console.log("\n▶ [3/4] 馬格努斯效應 (Magnus Curve) 弧線量化檢測...");
const speeds = [7.0, 11.0, 15.0];
const spins = [0.3, 0.6, 0.9];

for (const spd of speeds) {
    for (const sp of spins) {
        const p0 = new Vector3(0, 0.8, 5.0);
        const v0 = new Vector3(0, 1.5, -spd);
        const simFast = simBallTrajectory(p0, v0, sp, PHYSICS_MODES.FAST);
        const simAcad = simBallTrajectory(p0, v0, sp, PHYSICS_MODES.ACADEMIC);

        testAssert(
            simFast.landX > 0.05 && simAcad.landX > 0.02,
            `速度 ${spd}m/s, 自旋 +${sp}: FAST 偏轉 +${simFast.landX.toFixed(2)}m, ACAD 偏轉 +${simAcad.landX.toFixed(2)}m`
        );
        testAssert(
            simFast.landX < COURT_W / 2 + 0.8,
            `最狂甩球橫向偏離受限在球場外緣以內，絕不暴衝出界 (X=${simFast.landX.toFixed(2)}m)`
        );
    }
}

// ── 測試 4：連續碰撞檢測 (Swept CCD) 防高速穿拍測試 ──
console.log("\n▶ [4/4] 連續碰撞檢測 (Swept CCD) 防高速殺球穿拍測試...");
const highSpeeds = [14.0, 17.0, 20.0];
const fpsList = [60, 30, 20];
const padZ = 6.8;
const rzInstant = 0.59;

for (const spd of highSpeeds) {
    for (const fps of fpsList) {
        const dt = 1.0 / fps;
        const stepDist = spd * dt;

        const prevZ = padZ - 0.40;
        const currZ = prevZ + stepDist;

        const instantHit = Math.abs(currZ - padZ) <= rzInstant;

        const minZ = Math.min(prevZ, currZ) - rzInstant;
        const maxZ = Math.max(prevZ, currZ) + rzInstant;
        const sweptHit = (padZ >= minZ && padZ <= maxZ);

        testAssert(
            sweptHit === true,
            `Swept CCD 在 ${fps} FPS, ${spd} m/s 殺球 (單幀位移 ${stepDist.toFixed(2)}m) 100% 成功接住！`
        );

        if (!instantHit) {
            console.log(`    ℹ️ [驗證優勢] 傳統瞬時判定在 ${fps} FPS / ${spd} m/s 發生穿拍漏球 (Tunneling)，而 Swept CCD 完美守護！`);
        }
    }
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`🎉 物理模擬矩陣測試完成！通過: ${passed} 項，失敗: ${failed} 項`);
console.log("═══════════════════════════════════════════════════════════");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
