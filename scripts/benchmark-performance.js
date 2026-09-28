/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball - 10,000 幀極限效能與記憶體基準測試 (Headless Benchmark)
   Performance Profiler & Zero-Allocation Memory Budget Test Suite
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const { performance } = require('perf_hooks');

// 模擬瀏覽器環境
global.window = global;
global.performance = performance;
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

// 載入神經大腦
const flyCode = fs.readFileSync(path.join(__dirname, '../js/fly_connectome.js'), 'utf8');
eval(flyCode);

console.log('═══════════════════════════════════════════════════════════');
console.log('🚀 開始執行 NCHU Pickleball 10,000 幀極限效能基準測試');
console.log('═══════════════════════════════════════════════════════════\n');

// 測試 6 大性格預設之 10,000 幀計算開銷
const brain = new DrosophilaConnectome();
const ballPos = { x: 0.2, y: 1.1, z: -1.2 };
const ballVel = { x: 0.1, y: -0.5, z: 12.0 };
global.HALF_L = 6.7;
global.COURT_W = 6.1;
const flyPos  = { x: 0.0, y: 1.0, z: -6.7 };

const presets = ['AGILE_HUNTER', 'CHAOTIC_JITTER', 'GLIDE_BOMBER', 'ANCHOR_TACTICIAN', 'STDP_ADAPTIVE', 'NCHU_GOOSE'];

for (const p of presets) {
    brain.applyPreset(p);
    
    // 強制觸發一次 GC 如果可能，或記錄堆疊起始
    if (global.gc) global.gc();
    const startHeap = v8.getHeapStatistics().used_heap_size;
    const t0 = performance.now();

    const FRAMES = 10000;
    for (let f = 0; f < FRAMES; f++) {
        // 模擬動態逼近球
        ballPos.z = -2.0 + Math.sin(f * 0.05) * 1.5;
        ballVel.z = 10.0 + Math.cos(f * 0.02) * 5.0;
        
        // 核心 SNN 步進 (含 Euler 0.5ms 子步長與短時突觸抑制)
        brain.step(0.016, ballPos, ballVel, flyPos, true, 0);
    }

    const t1 = performance.now();
    const endHeap = v8.getHeapStatistics().used_heap_size;
    const totalMs = t1 - t0;
    const perFrameUs = (totalMs / FRAMES) * 1000; // 微秒
    const heapGrowthMb = Math.max(0, (endHeap - startHeap) / (1024 * 1024));

    console.log(`【預設 ${p}】`);
    console.log(`  ⏱️ 10,000 幀總耗時 : ${totalMs.toFixed(2)} ms`);
    console.log(`  ⚡ 單幀大腦計算耗時 : ${perFrameUs.toFixed(2)} μs (${(totalMs / FRAMES).toFixed(4)} ms)`);
    console.log(`  💾 V8 記憶體增長量  : ${heapGrowthMb.toFixed(3)} MB`);

    if (totalMs / FRAMES > 0.5) {
        console.error(`  ❌ FAIL: 單幀計算過長 (> 0.5ms)，無法滿足 120Hz 高刷新率要求`);
        process.exit(1);
    }
    if (heapGrowthMb > 4.0) {
        console.error(`  ❌ FAIL: 記憶體增長過高 (> 4.0MB)，疑似有臨時物件未回收！`);
        process.exit(1);
    }
    console.log(`  ✅ PASS: 算力預算極佳 (< 0.5ms) 且記憶體無顯著洩漏\n`);
}

console.log('═══════════════════════════════════════════════════════════');
console.log('🎉 基準測試完成！所有預設 10,000 幀物理與神經步進皆順利通過！');
console.log('═══════════════════════════════════════════════════════════');
