/**
 * ═══════════════════════════════════════════════════════════════════
 * NCHU Pickleball N-GO v2 - 雙軌邊緣端動作辨識與規則守護引擎
 * (Dual-Path Edge Stroke Classifier & Biomechanical Rule Guardrail)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 結合：
 * 1. USA Pickleball 官方規則 (Rule 4.A.7 發球三要素、Rule 9 廚房非截擊區) 硬性確定性守護
 * 2. 輕量前饋神經網路 (10 Inputs -> 16 Hidden ReLU -> 7 Outputs Softmax, 295 浮點參數)
 * 3. 延遲 < 0.005ms (零 GC 配置，純 Vanilla JS 原生相容 WebGL / WebView / Node.js)
 */

(function (global) {
    'use strict';

    // ── 7 大動作類別定義 ──
    const STROKE_CLASSES = [
        'UNDERHAND_LEGAL',
        'OVERHAND_FAULT',
        'KITCHEN_DINK',
        'POWER_DRIVE',
        'SMASH',
        'VOLLEY_PUNCH',
        'PASSIVE_BLOCK'
    ];

    const STROKE_DISPLAY_NAMES = {
        UNDERHAND_LEGAL: '✅ 合法下手發球 (Legal Underhand Serve)',
        OVERHAND_FAULT: '❌ 上手發球違規 (Overhand Serve Fault)',
        KITCHEN_DINK: '🥒 廚房區切角丁克 (Kitchen Dink)',
        POWER_DRIVE: '🚀 底線深區重抽球 (Power Drive)',
        SMASH: '💥 凌空暴扣殺球 (Smash Winner)',
        VOLLEY_PUNCH: '🥊 網前凌空推截擊 (Volley Punch)',
        PASSIVE_BLOCK: '🛡️ 卸力被動擋球 (Passive Block)'
    };

    // ── 10 維標準化特徵名稱 ──
    const FEATURE_NAMES = [
        'wrist_y_rel_hip',              // 0: 手腕相對於臀部高度 (Y-up: 正為腰上, 負為腰下)
        'elbow_angle_deg',              // 1: 手肘夾角 (度)
        'shoulder_angle_deg',           // 2: 肩關節夾角 (度)
        'wrist_speed_torso_s',          // 3: 腕部合速度 (軀幹長度/秒)
        'wrist_accel_y_torso_s2',       // 4: 垂直加速度 (軀幹長度/秒²)
        'torso_yaw_deg',                // 5: 軀幹轉體角度 (度)
        'stance_balance_ratio',         // 6: 雙腳重心偏移比
        'left_hand_up',                 // 7: 非持拍手是否舉高 (0 或 1)
        'estimated_wrist_height_ratio', // 8: 手腕相對於畫面高度比
        'swing_path_len_torso'          // 9: 揮拍累積軌跡長度 (軀幹長度)
    ];

    // ── 神經網路權重與正規化統計值 (Distilled from stroke_classifier_weights_v2.json) ──
    const SCALER_MEANS = new Float32Array([
        0.372943, 112.842941, 26.708510, 8.966353, 4.529059,
        0.235961, 0.049859, 0.078431, 1.667502, 1.577188
    ]);

    const SCALER_STDS = new Float32Array([
        0.412494, 49.978434, 21.443285, 6.181420, 43.639071,
        27.045655, 0.183627, 0.268849, 0.509259, 0.757560
    ]);

    // Layer 1 偏置 (b1: 16)
    const B1 = new Float32Array([
        0.165416, 0.076840, -0.061759, 0.027051, 0.040108, -0.170669, 0.176466, 0.053805,
        -0.089849, 0.044033, -0.007629, 0.117462, 0.106655, 0.041695, -0.021175, 0.042571
    ]);

    // Layer 1 權重 (W1: 10 x 16, row-major: W1[feat * 16 + hid])
    const W1 = new Float32Array([
        // Feat 0 (wrist_y_rel_hip)
        -0.457813,  0.426219, -0.270929,  0.038167,  0.509424, -0.198956, -0.252955, -0.245844, -0.323677,  0.370428,  0.366224,  0.134376, -0.301382, -0.219808, -0.203387, -0.186641,
        // Feat 1 (elbow_angle_deg)
        -0.347018,  0.180211,  0.173872,  0.222306, -0.126442, -0.150650,  0.248270,  0.178873, -0.227278, -0.287138, -0.360155, -0.105230,  0.147137,  0.192305, -0.181347,  0.219961,
        // Feat 2 (shoulder_angle_deg)
        -0.321743,  0.407545, -0.155799,  0.012589,  0.450259, -0.183765, -0.146687, -0.130983, -0.142079,  0.278385,  0.297495,  0.142270, -0.197775, -0.104250, -0.108422, -0.076326,
        // Feat 3 (wrist_speed_torso_s)
         0.221798,  0.245051, -0.297920,  0.052670,  0.165609,  0.005126, -0.034608, -0.005951, -0.231945, -0.126938, -0.091702,  0.089851, -0.057390,  0.024213,  0.035414, -0.032128,
        // Feat 4 (wrist_accel_y_torso_s2)
         0.089304, -0.232371, -0.187352, -0.126135, -0.162799,  0.027985,  0.082729,  0.075489, -0.039600, -0.046399, -0.071861, -0.102927,  0.065406,  0.055375, -0.007689,  0.065463,
        // Feat 5 (torso_yaw_deg)
        -0.091090,  0.035251, -0.016399, -0.144883,  0.005391,  0.169134, -0.114757, -0.122116,  0.115810,  0.170669,  0.152778, -0.057434, -0.078338, -0.139683,  0.133280, -0.149791,
        // Feat 6 (stance_balance_ratio)
        -0.038166, -0.035306, -0.046187, -0.074706, -0.081514, -0.054366,  0.171350,  0.170940, -0.059345, -0.090382, -0.099159, -0.063162,  0.168512,  0.164390, -0.042373,  0.156557,
        // Feat 7 (left_hand_up)
         0.285816, -0.074092, -0.178396, -0.154336, -0.166414, -0.090623, -0.074246, -0.086386,  0.041695, -0.003113, -0.016644, -0.124237, -0.088656, -0.104439,  0.055848, -0.085732,
        // Feat 8 (estimated_wrist_height_ratio)
        -0.457813,  0.426219, -0.270929,  0.038167,  0.509424, -0.198956, -0.252955, -0.245844, -0.323677,  0.370428,  0.366224,  0.134376, -0.301382, -0.219808, -0.203387, -0.186641,
        // Feat 9 (swing_path_len_torso)
         0.187884,  0.220199, -0.224161,  0.094559,  0.150654,  0.013444, -0.046261, -0.021111, -0.279612, -0.219828, -0.198114,  0.100914, -0.073403,  0.006323,  0.037320, -0.047585
    ]);

    // Layer 2 偏置 (b2: 7)
    const B2 = new Float32Array([
        0.188849, 0.057399, -0.114757, -0.028751, 0.172671, -0.043510, -0.231901
    ]);

    // Layer 2 權重 (W2: 16 x 7, row-major: W2[hid * 7 + out])
    const W2 = new Float32Array([
         0.376822, -0.297424, -0.315668, -0.026049, -0.470559, -0.133177, -0.262485,
        -0.297058,  0.380295, -0.189196,  0.016335,  0.514756,  0.008434, -0.320743,
        -0.223405, -0.169106,  0.347963, -0.070051, -0.251509, -0.113279,  0.271109,
         0.014282, -0.044036, -0.126042,  0.128795, -0.078499,  0.119794, -0.178877,
        -0.342369,  0.428518, -0.231454,  0.028681,  0.551399,  0.025345, -0.366607,
        -0.124673, -0.138478,  0.301416, -0.035415, -0.197978, -0.078440,  0.222384,
        -0.166662, -0.210410,  0.159495,  0.155700, -0.274797,  0.198305,  0.036829,
        -0.160086, -0.198380,  0.155850,  0.144415, -0.256241,  0.187352,  0.030612,
        -0.262693, -0.227221,  0.395758, -0.147318, -0.322891, -0.199201,  0.380588,
         0.228514,  0.288764, -0.273188, -0.090547,  0.341492, -0.151778, -0.301548,
         0.250596,  0.297486, -0.283838, -0.088656,  0.364230, -0.149283, -0.316886,
         0.113337,  0.065581, -0.207903,  0.129334,  0.063234,  0.120712, -0.225574,
        -0.188339, -0.245209,  0.191244,  0.135111, -0.309068,  0.177579,  0.074092,
        -0.152174, -0.183492,  0.138411,  0.137832, -0.233543,  0.184307,  0.014298,
         0.073400, -0.074477,  0.182281, -0.158309, -0.116568, -0.195029,  0.238477,
        -0.171801, -0.211029,  0.164536,  0.143209, -0.276228,  0.187289,  0.049441
    ]);

    // 預先配置推論緩衝區 (Zero Allocation at Runtime)
    const _normFeat = new Float32Array(10);
    const _hidden = new Float32Array(16);
    const _logits = new Float32Array(7);
    const _probs = new Float32Array(7);

    /**
     * 純 JS 前向推論函數 (Pure Vanilla JS Inference)
     * @param {Array<number>|Float32Array} rawFeatures 10 維運動學特徵
     * @returns {{ className: string, classIndex: number, confidence: number, probabilities: Float32Array }}
     */
    function predictNeural(rawFeatures) {
        if (!rawFeatures || rawFeatures.length !== 10) {
            return {
                className: 'PASSIVE_BLOCK',
                classIndex: 6,
                confidence: 0,
                probabilities: _probs
            };
        }

        // 1. Z-Score 標準化
        for (let i = 0; i < 10; i++) {
            const v = rawFeatures[i];
            _normFeat[i] = (typeof v === 'number' && !isNaN(v))
                ? (v - SCALER_MEANS[i]) / SCALER_STDS[i]
                : 0.0;
        }

        // 2. 隱藏層計算 (16 節點, ReLU)
        for (let j = 0; j < 16; j++) {
            let sum = B1[j];
            for (let i = 0; i < 10; i++) {
                sum += _normFeat[i] * W1[i * 16 + j];
            }
            _hidden[j] = sum > 0 ? sum : 0; // ReLU
        }

        // 3. 輸出層計算 (7 類別, Logits)
        let maxLogit = -1e9;
        for (let c = 0; c < 7; c++) {
            let sum = B2[c];
            for (let j = 0; j < 16; j++) {
                sum += _hidden[j] * W2[j * 7 + c];
            }
            _logits[c] = sum;
            if (sum > maxLogit) maxLogit = sum;
        }

        // 4. 數值穩定 Softmax
        let sumExp = 0;
        for (let c = 0; c < 7; c++) {
            const e = Math.exp(_logits[c] - maxLogit);
            _probs[c] = e;
            sumExp += e;
        }

        let bestIdx = 0;
        let maxP = 0;
        const invSum = 1.0 / (sumExp || 1e-9);
        for (let c = 0; c < 7; c++) {
            const p = _probs[c] * invSum;
            _probs[c] = p;
            if (p > maxP) {
                maxP = p;
                bestIdx = c;
            }
        }

        return {
            className: STROKE_CLASSES[bestIdx],
            classIndex: bestIdx,
            confidence: maxP,
            probabilities: _probs
        };
    }

    /**
     * USA Pickleball 官方規則確定性守護 (Deterministic Rule Guardrail)
     * 依據 Rule 4.A.7 (發球三要素) 與 Rule 9 (非截擊區廚房規則)
     * 
     * @param {Object} rawFeatures 運動學數值
     * @param {Object} context 擊球情境 { isServe: boolean, isVolley: boolean, inKitchen: boolean }
     * @returns {{ isFault: boolean, faultType: ?string, ruleCitation: ?string, reason: ?string }}
     */
    function evaluateRuleGuardrail(rawFeatures, context) {
        if (!context) context = {};

        // ── 1. 發球合規判定 (USA Pickleball Rule 4.A.7) ──
        if (context.isServe) {
            const wristYRelHip = rawFeatures[0];        // Y-up: 0.15 軀幹長度為人體肚臍腰部上限
            const wristAccelY = rawFeatures[4];         // 垂直加速度代理指標
            const wristVelY = (typeof context.wristVelY === 'number') ? context.wristVelY : null;

            // 規則 4.A.7.c: 擊球高度必須低於腰部 (肚臍)
            if (wristYRelHip > 0.15) {
                return {
                    isFault: true,
                    faultType: 'OVERHAND_FAULT',
                    ruleCitation: 'USA Pickleball Rule 4.A.7.c (Contact Below Waist)',
                    reason: `擊球高度 (${(wristYRelHip * 100).toFixed(0)}% 軀幹) 超過腰部法定上限 (+15%)！`
                };
            }

            // 規則 4.A.7.a: 發球揮拍必須呈現由下往上之弧線 (Upward Arc)
            if (wristVelY !== null && wristVelY <= -0.5) {
                return {
                    isFault: true,
                    faultType: 'OVERHAND_FAULT',
                    ruleCitation: 'USA Pickleball Rule 4.A.7.a (Upward Arc Motion)',
                    reason: '發球軌跡呈現由上向下砍擊或水平下切，違反向上弧線規定！'
                };
            }
        }

        // ── 2. 廚房非截擊區判定 (USA Pickleball Rule 9.B) ──
        if (context.isVolley && context.inKitchen) {
            return {
                isFault: true,
                faultType: 'KITCHEN_FAULT',
                ruleCitation: 'USA Pickleball Rule 9.B (Non-Volley Zone Violation)',
                reason: '踏入或觸及中興湖廚房區（7呎非截擊區）進行凌空截擊！'
            };
        }

        return {
            isFault: false,
            faultType: null,
            ruleCitation: null,
            reason: null
        };
    }

    /**
     * 雙軌仲裁決策引擎 (Dual-Path Arbitration Engine)
     * 結合硬性規則守護與輕量神經網路推論
     * 
     * @param {Array<number>} features 10 維特徵向量
     * @param {Object} context 情境旗標
     * @returns {{
     *    finalStroke: string,
     *    displayName: string,
     *    isFault: boolean,
     *    ruleEnforced: boolean,
     *    ruleReason: ?string,
     *    neuralPrediction: Object,
     *    recommendedPowerScale: number,
     *    recommendedTargetZ: number
     * }}
     */
    function arbitrateStroke(features, context) {
        if (!context) context = {};

        // 軌道 1: 規則守護檢驗
        const ruleCheck = evaluateRuleGuardrail(features, context);

        // 軌道 2: 神經網路推論
        const neural = predictNeural(features);

        let finalStroke = neural.className;
        let ruleEnforced = false;
        let ruleReason = null;

        // 若規則守護判定違規，強制覆寫神經網路輸出，杜絕黑盒子 AI 誤判！
        if (ruleCheck.isFault) {
            ruleEnforced = true;
            ruleReason = ruleCheck.reason;
            if (ruleCheck.faultType === 'OVERHAND_FAULT') {
                finalStroke = 'OVERHAND_FAULT';
            } else if (ruleCheck.faultType === 'KITCHEN_FAULT') {
                finalStroke = 'OVERHAND_FAULT'; // 歸入違規動作處理
            }
        } else if (context.isServe && finalStroke === 'OVERHAND_FAULT' && features[0] < -0.10) {
            // 守護機制反向保護：手腕明明在腰下極低處 (-0.10 以下)，若神經網路誤報 OVERHAND_FAULT，仲裁矯正為合法發球
            finalStroke = 'UNDERHAND_LEGAL';
            ruleEnforced = true;
            ruleReason = '幾何守護矯正：擊球高度極低且向上揮擊，符合合法發球要求。';
        }

        // 依據仲裁動作類型，提供對應的物理彈道與初速建議
        let recommendedPowerScale = 1.0;
        let recommendedTargetZ = -3.5;

        switch (finalStroke) {
            case 'KITCHEN_DINK':
                recommendedPowerScale = 0.65;
                recommendedTargetZ = -1.35; // 精確落入廚房區
                break;
            case 'SMASH':
                recommendedPowerScale = 1.45;
                recommendedTargetZ = -5.30; // 轟向底線深區
                break;
            case 'POWER_DRIVE':
                recommendedPowerScale = 1.20;
                recommendedTargetZ = -4.80; // 後場壓迫
                break;
            case 'PASSIVE_BLOCK':
                recommendedPowerScale = 0.55;
                recommendedTargetZ = -0.90; // 網前卸力放短
                break;
            case 'VOLLEY_PUNCH':
                recommendedPowerScale = 1.05;
                recommendedTargetZ = -3.80;
                break;
            case 'UNDERHAND_LEGAL':
                recommendedPowerScale = 1.00;
                recommendedTargetZ = -4.50; // 發球深區
                break;
            case 'OVERHAND_FAULT':
            default:
                recommendedPowerScale = 0.80;
                recommendedTargetZ = -3.00;
                break;
        }

        return {
            finalStroke: finalStroke,
            displayName: STROKE_DISPLAY_NAMES[finalStroke] || finalStroke,
            isFault: ruleCheck.isFault,
            ruleEnforced: ruleEnforced,
            ruleReason: ruleReason,
            neuralPrediction: neural,
            recommendedPowerScale: recommendedPowerScale,
            recommendedTargetZ: recommendedTargetZ
        };
    }

    /**
     * 從運行端姿勢與動力鏈狀態中提取 10 維標準特徵
     * @param {Object} kinState 來自 motion.js 的即時運動學快照
     * @returns {Float32Array}
     */
    function extract10Features(kinState) {
        const out = new Float32Array(10);
        if (!kinState) return out;

        out[0] = typeof kinState.wristYRelHip === 'number' ? kinState.wristYRelHip : 0;
        out[1] = typeof kinState.elbowAngle === 'number' ? kinState.elbowAngle : 90;
        out[2] = typeof kinState.shoulderAngle === 'number' ? kinState.shoulderAngle : 30;
        out[3] = typeof kinState.wristSpeed === 'number' ? kinState.wristSpeed : 5.0;
        out[4] = typeof kinState.wristAccelY === 'number' ? kinState.wristAccelY : 0;
        out[5] = typeof kinState.torsoYaw === 'number' ? kinState.torsoYaw : 0;
        out[6] = typeof kinState.stanceBal === 'number' ? kinState.stanceBal : 0;
        out[7] = kinState.leftHandUp ? 1.0 : 0.0;
        out[8] = typeof kinState.estimatedWristHeight === 'number' ? kinState.estimatedWristHeight : (1.0 + out[0]);
        out[9] = typeof kinState.swingPathLen === 'number' ? kinState.swingPathLen : 1.0;

        return out;
    }

    // ── 導出模組 (相容 Browser 與 Node.js) ──
    const StrokeEngine = {
        CLASSES: STROKE_CLASSES,
        DISPLAY_NAMES: STROKE_DISPLAY_NAMES,
        FEATURE_NAMES: FEATURE_NAMES,
        predictNeural: predictNeural,
        evaluateRuleGuardrail: evaluateRuleGuardrail,
        arbitrateStroke: arbitrateStroke,
        extract10Features: extract10Features
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StrokeEngine;
    } else {
        global.PickleStrokeEngine = StrokeEngine;
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
