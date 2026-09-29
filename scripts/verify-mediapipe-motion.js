/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - MediaPipe 體感管線與運動學端到端驗證腳本
   MediaPipe Motion Tracking & Kinematic Chain End-to-End Verification
   ═══════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 模擬瀏覽器環境
global.window = global;
global.performance = { now: () => Date.now() };
global.document = {
    readyState: 'complete',
    getElementById: () => null,
    body: { classList: { remove: () => {}, add: () => {}, toggle: () => false, contains: () => false } }
};
global.THREE = {
    MathUtils: {
        clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
        lerp: (x, y, t) => x + (y - x) * t
    }
};

// 載入 motion.js
const motionCode = fs.readFileSync(path.join(__dirname, '../js/motion.js'), 'utf8');
vm.runInThisContext(motionCode);

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passCount++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failCount++;
    }
}

console.log('═══════════════════════════════════════════════════════════');
console.log('📷 啟動 MediaPipe 體感 AI 演算法與動態濾波深度驗證');
console.log('═══════════════════════════════════════════════════════════\n');

// ─── 檢驗 1: MediaPipe 33 節點模型拓撲與資料結構 ───
console.log('【檢驗 1】MediaPipe 33 節點拓撲與分層解析');
{
    assert(JOINT_SETS.FULL33.length === 33, '完整人體姿態骨架包含 33 個節點');
    assert(JOINT_SETS.UPPER14.length === 14, '上半身低功耗模式包含 14 個關鍵運動節點');
    assert(JOINT_SETS.CORE6.length === 6, '極致省電模式鎖定雙肩、雙肘、雙腕 6 個核心節點');
    assert(POSE_BONES.length >= 16, '骨架連結拓撲骨骼數量合規');
}

// ─── 檢驗 2: 1€ Filter (One-Euro Filter) 靜態防抖與高動態追蹤 ───
console.log('\n【檢驗 2】One-Euro Filter 自適應截止頻率');
{
    const filter = new OneEuroFilter(30, 1.0, 0.007, 1.0);
    // 模擬鏡頭微幅抖動 (手持攝影機或低照度雜訊)
    let rawJitterSum = 0;
    let filteredJitterSum = 0;
    const center = 0.50;
    let t = 1000;
    for (let i = 0; i < 40; i++) {
        t += 33.3; // 30 FPS
        const jitter = (Math.sin(i * 2.3) * 0.02) + (Math.cos(i * 4.7) * 0.015);
        const raw = center + jitter;
        const out = filter.filter(raw, t);
        rawJitterSum += Math.abs(jitter);
        filteredJitterSum += Math.abs(out - center);
    }
    const suppressionRatio = (rawJitterSum - filteredJitterSum) / rawJitterSum;
    assert(suppressionRatio > 0.45, `靜止高頻噪聲濾波消除率達標 (${(suppressionRatio * 100).toFixed(1)}% > 45%)`);

    // 模擬高速連續揮拍斜坡追隨
    const fastFilter = new OneEuroFilter(60, 1.0, 2.5, 10.0);
    let rampT = 2000;
    let maxLag = 0;
    for (let i = 0; i <= 20; i++) {
        rampT += 16.6; // 60 FPS
        const truePos = 0.2 + (0.6 * (i / 20));
        const filteredPos = fastFilter.filter(truePos, rampT);
        if (i > 1) {
            const lag = Math.abs(truePos - filteredPos);
            if (lag > maxLag) maxLag = lag;
        }
    }
    assert(maxLag < 0.12, `高速揮拍動態跟隨延遲極小 (最大偏差 ${maxLag.toFixed(3)} < 0.12)`);
}

// ─── 檢驗 3: 人體動力鏈時序分解 (Kinetic Chain Timing & Order) ───
console.log('\n【檢驗 3】動力鏈三段式 (腰 -> 肩 -> 肘) 差分時序演算法');
{
    kcReset();
    let now = 10000;
    for (let i = 0; i < 20; i++) {
        now += 25; // 40Hz
        const gHip = 250 * Math.exp(-Math.pow(i - 4, 2) / 3);
        const gSh = 380 * Math.exp(-Math.pow(i - 7, 2) / 3);
        const gEl = 450 * Math.exp(-Math.pow(i - 10, 2) / 3);
        kcPush(now, gHip, gSh, gEl);
    }
    const chainGood = gradeChain();
    assert(chainGood !== null, '標準發力動力鏈成功提取評估結果');
    assert(chainGood.ordered === true, '動力鏈時序精確判定為循序發力 (ordered === true)');
    assert(chainGood.elbowRatio > 0.20 && chainGood.elbowRatio < 0.55, `手肘角速度佔比合理 (${(chainGood.elbowRatio * 100).toFixed(1)}%)`);
}

// ─── 檢驗 4: 手臂代償不良姿勢偵測 (Arm Only Compensation Detection) ───
console.log('\n【檢驗 4】手臂代償不良姿勢偵測');
{
    kcReset();
    let now = 20000;
    for (let i = 0; i < 20; i++) {
        now += 25;
        const gHip = 5 * Math.random(); // 雜訊
        const gSh = 120 * Math.exp(-Math.pow(i - 8, 2) / 4);
        const gEl = 550 * Math.exp(-Math.pow(i - 10, 2) / 2);
        kcPush(now, gHip, gSh, gEl);
    }
    const chainArm = gradeChain();
    assert(chainArm !== null, '純手臂揮拍成功提取評估結果');
    assert(chainArm.elbowRatio > 0.60, `準確捕捉純手臂代償高佔比 (${(chainArm.elbowRatio * 100).toFixed(1)}% > 60%)`);
    assert(chainArm.ordered === null, '髖部未參與發力時不盲目判定時序 (ordered === null)');
}

// ─── 檢驗 5: 側旋刷拍弧線與幾何格林公式 (Sagitta & Spin Geometry) ───
console.log('\n【檢驗 5】側旋刷拍弧線與格林公式旋轉面積');
{
    // 直線推球軌跡
    swipeStart(200, 400);
    for (let i = 1; i <= 10; i++) {
        swipeMove(200, 400 - i * 25);
    }
    swipeEnd();
    assert(Math.abs(SWIPE.lastStroke.sagitta) < 4.0, `直線前推弦線拱高接近零 (|sagitta| = ${Math.abs(SWIPE.lastStroke.sagitta).toFixed(1)}px < 4.0)`);
    assert(Math.abs(SWIPE.lastStroke.spin) < 0.25, `直線前推無多餘側旋 (|spin| = ${Math.abs(SWIPE.lastStroke.spin).toFixed(2)} < 0.25)`);

    // 順向右刷香蕉弧線軌跡
    swipeStart(200, 400);
    for (let i = 1; i <= 12; i++) {
        const x = 200 + Math.sin((i / 12) * Math.PI) * 55 + i * 4;
        const y = 400 - i * 22;
        swipeMove(x, y);
    }
    swipeEnd();
    assert(SWIPE.lastStroke.sagitta > 15, `右刷弧線外凸拱高顯著 (sagitta = ${SWIPE.lastStroke.sagitta.toFixed(1)}px > 15)`);
    assert(SWIPE.lastStroke.spin > 0.35, `成功產生正向右側旋 (spin = +${SWIPE.lastStroke.spin.toFixed(2)})`);
}

// ─── 檢驗 6: 變動幀率與低照度掉幀抗性 ───
console.log('\n【檢驗 6】變動幀率與低照度掉幀抗性');
{
    const filter = new OneEuroFilter(30, 1.0, 0.007, 1.0);
    let t = 0;
    let ok = true;
    const intervals = [16.6, 33.3, 100.0, 16.6, 250.0, 33.3]; // 模擬鏡頭突然大掉幀至 4fps 再恢復
    for (const dt of intervals) {
        t += dt;
        const val = filter.filter(1.0, t);
        if (isNaN(val) || !isFinite(val)) ok = false;
    }
    assert(ok, '在極端掉幀與時間間隔驟變下，濾波器無 NaN 或溢出崩潰');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`🎉 MediaPipe 體感驗證總計：通過 ${passCount} 項，失敗 ${failCount} 項`);
console.log('═══════════════════════════════════════════════════════════\n');

if (failCount > 0) process.exit(1);
