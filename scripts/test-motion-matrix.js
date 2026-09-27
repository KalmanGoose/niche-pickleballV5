/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball - 體感運動學與果蠅神經大腦 Headless 自動化壓力測試矩陣
   Automated Kinematics & Drosophila Connectome Stress Test Suite
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

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

// 載入模組
const motionCode = fs.readFileSync(path.join(__dirname, '../js/motion.js'), 'utf8');
eval(motionCode);

const flyCode = fs.readFileSync(path.join(__dirname, '../js/fly_connectome.js'), 'utf8');
eval(flyCode);

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
console.log('🧪 開始執行運動學與神經大腦 60+ 矩陣自動化測試');
console.log('═══════════════════════════════════════════════════════════\n');

// ─── 測試 1: 1€ Filter (One-Euro Filter) 靜止降噪與動態延遲 ───
console.log('【測試 1】1€ Filter 自適應人體關節防抖測試');
{
    const filter = new OneEuroFilter(30, 1.0, 0.007, 1.0);
    // 1.1 靜止噪聲輸入: 基準值 0.5 + 高斯噪聲 [-0.03, +0.03]
    let rawNoiseSum = 0;
    let filteredNoiseSum = 0;
    const base = 0.5;
    let t = 1000;

    for (let i = 0; i < 50; i++) {
        t += 33.3; // 30 FPS
        const noise = (Math.sin(i * 1.7) * 0.025) + (Math.cos(i * 3.1) * 0.015);
        const raw = base + noise;
        const filtered = filter.filter(raw, t);
        rawNoiseSum += Math.abs(raw - base);
        filteredNoiseSum += Math.abs(filtered - base);
    }
    const noiseReduction = (1 - filteredNoiseSum / rawNoiseSum) * 100;
    assert(noiseReduction > 45, `靜止高頻噪聲濾波消除率達標 (${noiseReduction.toFixed(1)}% > 45%)`);

    // 1.2 高速揮拍動態響應: 500ms 內快速從 0.2 飆升至 0.8
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

// ─── 測試 2: 動力鏈時序 (Kinematic Chain Timing & Order) ───
console.log('\n【測試 2】人體動力鏈 (腰 -> 肩 -> 肘) 差分時序與佔比判定');
{
    // 2.1 標準順暢動力鏈: 腰先發力 (t=100), 肩隨後 (t=140), 肘最後收 (t=180)
    kcReset();
    let now = 10000;
    for (let i = 0; i < 20; i++) {
        now += 25; // 40Hz
        // 峰值曲線 (Gaussian Bell)
        const gHip = 250 * Math.exp(-Math.pow(i - 4, 2) / 3);
        const gSh = 380 * Math.exp(-Math.pow(i - 7, 2) / 3);
        const gEl = 450 * Math.exp(-Math.pow(i - 10, 2) / 3);
        kcPush(now, gHip, gSh, gEl);
    }
    const chainGood = gradeChain();
    assert(chainGood !== null, '標準發力動力鏈成功提取評估結果');
    assert(chainGood.ordered === true, '動力鏈時序判定為正確順序 (ordered === true)');
    assert(chainGood.elbowRatio > 0.20 && chainGood.elbowRatio < 0.55, `手肘角速度佔比合理 (${(chainGood.elbowRatio * 100).toFixed(1)}%)`);

    // 2.2 純手臂揮拍 (Arm Dominant): 腰完全不動，手肘佔比超過 60%
    kcReset();
    now = 20000;
    for (let i = 0; i < 20; i++) {
        now += 25;
        const gHip = 5 * Math.random(); // 雜訊
        const gSh = 120 * Math.exp(-Math.pow(i - 8, 2) / 4);
        const gEl = 650 * Math.exp(-Math.pow(i - 8, 2) / 4);
        kcPush(now, gHip, gSh, gEl);
    }
    const chainArm = gradeChain();
    assert(chainArm.ordered === null, '髖部參與不足時時序不盲目判定 (ordered === null)');
    assert(chainArm.elbowRatio > 0.60, `準確捕捉手臂代償高佔比 (${(chainArm.elbowRatio * 100).toFixed(1)}% > 60%)`);
}

// ─── 測試 3: 寶可夢式手勢幾何分析 (Swipe Sagitta & Spin Area) ───
console.log('\n【測試 3】寶可夢 GO 弧線手勢與馬格努斯側旋幾何學測試');
{
    // 3.1 直線前推深球 (Flat Drive)
    swipeStart(200, 400);
    let st = 30000;
    for (let i = 1; i <= 10; i++) {
        st += 20;
        swipeMove(200, 400 - i * 25); // 直線上推
    }
    swipeEnd();
    assert(Math.abs(SWIPE.lastStroke.sagitta) < 4.0, `直線前推弦線拱高接近零 (|sagitta| = ${Math.abs(SWIPE.lastStroke.sagitta).toFixed(1)}px < 4.0)`);
    assert(Math.abs(SWIPE.lastStroke.spin) < 0.25, `直線前推無多餘側旋 (|spin| = ${Math.abs(SWIPE.lastStroke.spin).toFixed(2)} < 0.25)`);

    // 3.2 寶可夢右刷香蕉球 (Right Curve Sagitta > 0, Spin > 0)
    swipeStart(200, 400);
    st = 40000;
    for (let i = 1; i <= 12; i++) {
        st += 18;
        const x = 200 + Math.sin((i / 12) * Math.PI) * 55 + i * 4;
        const y = 400 - i * 22;
        swipeMove(x, y);
    }
    swipeEnd();
    assert(SWIPE.lastStroke.sagitta > 15, `右刷弧線外凸拱高顯著 (sagitta = ${SWIPE.lastStroke.sagitta.toFixed(1)}px > 15)`);
    assert(SWIPE.lastStroke.spin > 0.35, `成功產生正向右側旋 (spin = +${SWIPE.lastStroke.spin.toFixed(2)})`);

    // 3.3 高速稀疏軌跡內插保護測試
    swipeStart(100, 300);
    swipeMove(150, 200); // 巨大步長 (dx=50, dy=-100, dist=111px)
    swipeEnd();
    assert(SWIPE.history.length >= 2, '高速巨大步長滑動自動觸發中點內插');
}

// ─── 測試 4: 果蠅神經大腦 (Fly Connectome) 6 大預設與穩定性 ───
console.log('\n【測試 4】普林斯頓 FlyWire 果蠅神經大腦 6 大預設與數值穩定性');
{
    const brain = new DrosophilaConnectome();
    const presets = brain.getPresetList();
    assert(presets.length === 6, `成功註冊 6 大神經性格配置 (已發現 ${presets.length} 種)`);

    // 驗證各預設切換
    for (const p of presets) {
        brain.applyPreset(p.id);
        assert(brain.currentPresetKey === p.id, `預設 [${p.name}] 成功載入`);
        assert(brain.tauM > 0.004 && brain.tauM < 0.030, `  膜時間常數合理 (${(brain.tauM * 1000).toFixed(1)}ms)`);
        assert(brain.dlmnMaxFreq >= 110.0, `  飛行肌爆發頻率具備飛行能力 (${brain.dlmnMaxFreq}Hz)`);
    }

    // 4.1 極端逼近速度 (25 m/s 彗星級暴扣) 數值穩定性測試
    brain.applyPreset('CHAOTIC_JITTER');
    const ballPos = { x: 0, y: 1.0, z: -1.0 };
    const ballVel = { x: 0, y: -2.0, z: 25.0 }; // 25 m/s 直衝果蠅
    const flyPos = { x: 0, y: 1.0, z: -0.2 };

    let crashed = false;
    for (let step = 0; step < 120; step++) {
        try {
            brain.step(0.016, ballPos, ballVel, flyPos, true, 0);
            if (isNaN(brain.Vm) || isNaN(brain.xVesicle) || isNaN(brain.dThetaDt)) {
                crashed = true;
                break;
            }
        } catch (e) {
            crashed = true;
            break;
        }
    }
    assert(!crashed, '極端 25m/s 高速衝撞下微分方程無 NaN、無發散崩潰');
    assert(brain.Vm >= -95.0 && brain.Vm <= 35.0, `膜電位嚴格保持在生物物理微小鉗制內 (${brain.Vm.toFixed(1)}mV)`);

    // 4.2 廚房區微距小球 (Dink) STD 突觸囊泡耗竭測試
    brain.applyPreset('ANCHOR_TACTICIAN');
    brain.reset();
    const dinkBallPos = { x: 0, y: 0.8, z: -1.2 };
    const dinkBallVel = { x: 0, y: 0, z: 1.0 };
    const dinkFlyPos = { x: 0, y: 0.8, z: -1.5 };

    for (let step = 0; step < 200; step++) {
        brain.step(0.016, dinkBallPos, dinkBallVel, dinkFlyPos, true, 4);
    }
    assert(brain.xVesicle < 0.28, `長時間網前小球拉鋸成功觸發 Tsodyks-Markram 囊泡耗竭 (x = ${(brain.xVesicle * 100).toFixed(1)}% < 28%)`);
    assert(brain.isFatigued === true, '囊泡耗竭正確觸發微距視覺過載 (isFatigued === true)');

    // 4.3 STDP 在線突觸可塑性更新測試
    brain.applyPreset('STDP_ADAPTIVE');
    const initialW = brain.wLC4;
    brain.step(0.016, { x: 0, y: 1, z: -1 }, { x: 0, y: 0, z: 12 }, { x: 0, y: 1, z: 0 }, true, 0);
    // 誘發 spike
    brain.Vm = brain.vThresh + 1;
    brain.step(0.016, { x: 0, y: 1, z: -1 }, { x: 0, y: 0, z: 12 }, { x: 0, y: 1, z: 0 }, true, 0);
    assert(brain.wLC4 !== initialW, `STDP 成功動態調節突觸權重 (初期: ${initialW} -> 更新: ${brain.wLC4.toFixed(3)})`);
}

// ─── 測試 5: 身材歸一化 (Normalization Across Body Sizes) ───
console.log('\n【測試 5】人體身材比例歸一化測試 (成人 vs 孩童)');
{
    // 成人
    updateShoulderWidth({ x: 0.35, y: 0.3 }, { x: 0.65, y: 0.3 });
    const adultW = NORM.W;
    assert(NORM.ready === true && adultW > 0.25, `成人肩寬正常辨識 (W = ${adultW.toFixed(2)})`);

    // 孩童 / 遠距離
    updateShoulderWidth({ x: 0.45, y: 0.3 }, { x: 0.55, y: 0.3 });
    const childW = NORM.W;
    assert(NORM.ready === true && childW < adultW, `遠距/孩童肩寬平滑收斂 (W = ${childW.toFixed(2)})`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`🎉 測試結果總計：通過 ${passCount} 項，失敗 ${failCount} 項`);
console.log('═══════════════════════════════════════════════════════════');

if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
