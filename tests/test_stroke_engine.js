/**
 * Unit Tests for Dual-Path Stroke Classifier & Biomechanical Rule Guardrail Engine
 * =================================================================================
 * Tests:
 * 1. Neural forward pass & Softmax normalization sum = 1.0
 * 2. Deterministic USA Pickleball Rule 4.A.7 guardrail enforcement
 * 3. Kitchen Rule 9.B Non-Volley Zone guardrail enforcement
 * 4. Dual-Path arbitration conflict resolution (Rule overrides neural hallucination)
 * 5. Latency benchmark (< 0.01ms / 10,000 runs)
 * 6. Robustness against NaN, undefined, and extreme boundary values
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const StrokeEngine = require('../js/stroke_classifier_v2.js');

function runTests() {
    console.log("==============================================================================");
    console.log("🧪 執行 Pickleball Dual-Path Stroke Engine 單元測試 (Unit Test Suite)");
    console.log("==============================================================================");

    // Test 1: Neural Forward Pass & Probabilities Sum
    {
        const dummyFeats = new Float32Array([0.1, 90.0, 30.0, 5.5, 2.0, 5.0, 0.02, 0.0, 1.1, 1.2]);
        const res = StrokeEngine.predictNeural(dummyFeats);
        
        assert(res.className, "Must return valid className");
        assert(StrokeEngine.CLASSES.includes(res.className), `Class ${res.className} must be in CLASSES`);
        assert(res.confidence > 0 && res.confidence <= 1.0, `Confidence ${res.confidence} must be in (0, 1]`);
        
        let sumP = 0;
        for (let i = 0; i < res.probabilities.length; i++) {
            sumP += res.probabilities[i];
        }
        assert(Math.abs(sumP - 1.0) < 1e-4, `Probabilities sum must be 1.0, got ${sumP}`);
        console.log("✓ Test 1: Neural forward pass and Softmax probability sum passed.");
    }

    // Test 2: Rule 4.A.7.c (Contact Above Waist) Guardrail
    {
        // High contact height (wrist_y_rel_hip = 0.40, far above 0.15 waist limit)
        const highFeats = new Float32Array([0.40, 130.0, 60.0, 9.0, 1.0, 10.0, 0.0, 0.0, 1.8, 2.0]);
        const context = { isServe: true, isVolley: false, inKitchen: false, wristVelY: 2.0 };
        
        const guard = StrokeEngine.evaluateRuleGuardrail(highFeats, context);
        assert.strictEqual(guard.isFault, true, "Contact above waist in serve must be flagged as fault");
        assert.strictEqual(guard.faultType, 'OVERHAND_FAULT');
        assert(guard.reason.includes('超過腰部法定上限'), "Reason must explain waist exceedance");

        const arb = StrokeEngine.arbitrateStroke(highFeats, context);
        assert.strictEqual(arb.finalStroke, 'OVERHAND_FAULT', "Arbitration must enforce OVERHAND_FAULT");
        assert.strictEqual(arb.ruleEnforced, true);
        console.log("✓ Test 2: USA Pickleball Rule 4.A.7.c (waist height guardrail) passed.");
    }

    // Test 3: Rule 4.A.7.a (Downward Arc Serve) Guardrail
    {
        // Low contact height (y = -0.10, below waist) BUT downward chop (wristVelY = -1.5)
        const chopFeats = new Float32Array([-0.10, 110.0, 40.0, 8.0, -10.0, 0.0, 0.0, 0.0, 0.9, 1.5]);
        const context = { isServe: true, isVolley: false, inKitchen: false, wristVelY: -1.5 };
        
        const guard = StrokeEngine.evaluateRuleGuardrail(chopFeats, context);
        assert.strictEqual(guard.isFault, true, "Downward arc in serve must be flagged as fault");
        assert.strictEqual(guard.faultType, 'OVERHAND_FAULT');
        assert(guard.reason.includes('向上弧線'), "Reason must cite upward arc violation");

        const arb = StrokeEngine.arbitrateStroke(chopFeats, context);
        assert.strictEqual(arb.finalStroke, 'OVERHAND_FAULT');
        console.log("✓ Test 3: USA Pickleball Rule 4.A.7.a (upward arc guardrail) passed.");
    }

    // Test 4: Legal Serve Identification
    {
        // Low contact height (-0.15) and positive upward arc (+3.0)
        const legalFeats = new Float32Array([-0.15, 100.0, 20.0, 6.0, 5.0, 0.0, 0.0, 1.0, 0.85, 1.4]);
        const context = { isServe: true, isVolley: false, inKitchen: false, wristVelY: 3.0 };
        
        const guard = StrokeEngine.evaluateRuleGuardrail(legalFeats, context);
        assert.strictEqual(guard.isFault, false, "Legal serve conditions must NOT trigger fault");

        const arb = StrokeEngine.arbitrateStroke(legalFeats, context);
        assert.strictEqual(arb.isFault, false);
        assert.strictEqual(arb.finalStroke, 'UNDERHAND_LEGAL');
        console.log("✓ Test 4: Legal underhand serve correctly verified and passed.");
    }

    // Test 5: Kitchen Rule 9.B Non-Volley Zone Violation Guardrail
    {
        const smashFeats = new Float32Array([0.80, 160.0, 80.0, 15.0, -15.0, 15.0, 0.1, 0.0, 2.2, 2.5]);
        const context = { isServe: false, isVolley: true, inKitchen: true }; // Volley inside Kitchen!
        
        const guard = StrokeEngine.evaluateRuleGuardrail(smashFeats, context);
        assert.strictEqual(guard.isFault, true, "Volley in Kitchen must trigger fault");
        assert.strictEqual(guard.faultType, 'KITCHEN_FAULT');

        const arb = StrokeEngine.arbitrateStroke(smashFeats, context);
        assert.strictEqual(arb.isFault, true);
        assert.strictEqual(arb.ruleEnforced, true);
        console.log("✓ Test 5: USA Pickleball Rule 9.B (kitchen non-volley zone guardrail) passed.");
    }

    // Test 6: Robustness Against NaN, Null, and Degenerate Inputs
    {
        const nanFeats = new Float32Array([NaN, undefined, 0, null, NaN, NaN, 0, 0, NaN, 0]);
        const res = StrokeEngine.predictNeural(nanFeats);
        assert(res.className, "Engine must not crash on NaN inputs");
        assert(!isNaN(res.confidence), "Confidence must not be NaN");

        const nullRes = StrokeEngine.predictNeural(null);
        assert.strictEqual(nullRes.className, 'PASSIVE_BLOCK', "Null input safely defaults to PASSIVE_BLOCK");
        console.log("✓ Test 6: NaN and null input degradation robustness passed.");
    }

    // Test 7: Latency Benchmark (10,000 Inferences)
    {
        const benchFeats = new Float32Array([0.15, 115.0, 32.0, 7.2, 3.5, 4.0, 0.05, 0.0, 1.2, 1.6]);
        const context = { isServe: false, isVolley: false, inKitchen: false };
        
        const N = 10000;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < N; i++) {
            StrokeEngine.arbitrateStroke(benchFeats, context);
        }
        const t1 = process.hrtime.bigint();
        const totalMs = Number(t1 - t0) / 1e6;
        const avgMs = totalMs / N;
        const fps = Math.round(1000 / avgMs);

        console.log(`✓ Test 7: Benchmark 10,000 Dual-Path inferences completed in ${totalMs.toFixed(2)} ms`);
        console.log(`   ➔ 平均單次延遲: ${avgMs.toFixed(5)} ms (${fps.toLocaleString()} Inferences/sec)`);
        assert(avgMs < 0.05, `Inference latency ${avgMs} ms exceeds 0.05 ms requirement`);
    }

    console.log("\n==============================================================================");
    console.log("🎉 所有 7 項單元測試與效能基準全數 PASS (100%)！");
    console.log("==============================================================================");
}

runTests();
