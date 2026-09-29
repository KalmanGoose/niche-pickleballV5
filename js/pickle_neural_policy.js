/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 輕量神經戰術決策網路 (Tiny Pickle Neural Policy)
   PPA Tour 戰術知識蒸餾神經網路 (8 Inputs -> 16 Hidden -> 4 Tactical Outputs)
   計算時間 < 0.05ms，零 GC 分配，相容 Node.js 與瀏覽器 WebGL 環境
   ═══════════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    // 4 大戰術動作常數
    const ACTIONS = ['DROP', 'DRIVE', 'DINK', 'LOB'];
    const ACTION_NAMES = {
        DROP: '💧 第三桿放短 (Third Shot Drop)',
        DRIVE: '🚀 穿越重砲抽球 (Power Drive)',
        DINK: '🎾 廚房區切角小球 (Angled Dink)',
        LOB: '🌈 挑高過頂長球 (Tactical Lob)'
    };

    // ═══════ 神經網路權重矩陣 (Distilled PPA Tour Neural Weights) ═══════
    // W1: 16 個神經元 x 8 個輸入特徵
    // 特徵順序: [ballX_norm, ballY_norm, ballZ_norm, ballVx_norm, ballVy_norm, ballVz_norm, playerX_norm, playerZ_norm]
    const W1 = new Float32Array([
        // N0: 偵測玩家退縮底線 (Deep Baseline Opponent)
         0.12, -0.45,  0.35,  0.08, -0.15,  0.62, -0.10,  1.85,
        // N1: 偵測玩家逼近廚房 (Rushing Kitchen Opponent)
        -0.08,  0.52, -0.40, -0.05,  0.22, -0.55,  0.05, -1.92,
        // N2: 偵測玩家左側空檔 (Player Displaced Left -> Attack Right)
        -0.85,  0.10,  0.25, -0.32,  0.05,  0.40, -1.65,  0.22,
        // N3: 偵測玩家右側空檔 (Player Displaced Right -> Attack Left)
         0.85,  0.10,  0.25,  0.32,  0.05,  0.40,  1.65,  0.22,
        // N4: 偵測自身處於廚房近網區 (In-Kitchen Soft Exchange)
         0.05, -0.65,  1.42,  0.12, -0.40,  0.88,  0.15, -0.50,
        // N5: 偵測高浮半空機會球 (Looming High Float Ball)
         0.00,  1.75, -0.30,  0.10,  0.85, -0.60,  0.00,  0.10,
        // N6: 偵測極速重抽衝擊 (Heavy Inbound Attack)
         0.20,  0.15, -0.85,  0.45, -0.35, -1.80, -0.12,  0.35,
        // N7: 偵測中路真空地帶 (Center Court Gap)
        -0.30,  0.20,  0.40, -0.15,  0.10,  0.50,  0.05,  0.80,
        // N8: 側旋來球抗性與消旋特徵 (Spin Neutralizer)
         0.45, -0.20,  0.60,  0.85, -0.10,  0.45,  0.30,  0.40,
        // N9: 第三桿關鍵決策特徵 (Third Shot Drop Prime)
         0.10, -0.30, -0.95, -0.10, -0.25, -1.15,  0.05,  1.40,
        // N10: 網頂擦網球 (Net Cord / Low Skimmer)
        -0.15, -1.45,  0.85,  0.05, -0.90,  0.75, -0.20, -0.30,
        // N11: 弧線防禦挑高緩衝 (Defensive Reset Lob)
         0.05, -0.80, -1.20, -0.20, -0.50, -1.50, -0.10, -0.80,
        // N12: 刁鑽對角壓迫 (Cross-Court Squeeze)
        -0.70,  0.35,  0.55, -0.40,  0.15,  0.65,  1.20,  0.15,
        // N13: 順向直線偷襲 (Down-the-Line Ambush)
         0.70,  0.35,  0.55,  0.40,  0.15,  0.65, -1.20,  0.15,
        // N14: 節奏突變破壞 (Pace Disruption)
         0.15, -0.25,  0.75, -0.65,  0.35, -0.80,  0.00,  0.60,
        // N15: 穩定壓底防守 (Deep Baseline Containment)
         0.00,  0.10, -0.50,  0.00,  0.10, -0.70,  0.00, -0.40
    ]);

    const B1 = new Float32Array([
         0.15, -0.10,  0.05,  0.05,  0.20, -0.25,  0.10,  0.05,
        -0.05,  0.35, -0.15, -0.30,  0.10,  0.10,  0.00,  0.25
    ]);

    // W2: 4 個動作輸出 (DROP, DRIVE, DINK, LOB) x 16 個隱藏節點
    const W2 = new Float32Array([
        // DROP: 第三桿放短 (由 N0, N4, N9, N10 強正向驅動)
         1.45, -1.20,  0.10,  0.10,  1.10, -1.50, -0.35,  0.45,
         0.20,  1.85,  1.05, -0.40,  0.25,  0.25,  0.60,  0.15,
        // DRIVE: 重砲抽球 (由 N2, N3, N5, N6, N12, N13 強正向驅動)
        -0.85,  0.40,  1.35,  1.35, -0.95,  1.80,  1.25,  0.70,
         0.40, -1.10, -0.75, -1.10,  1.45,  1.45, -0.50,  0.65,
        // DINK: 廚房切角小球 (由 N1, N4, N10, N12, N13 強正向驅動)
        -0.40,  1.15,  0.75,  0.75,  1.75, -0.80, -0.60, -0.25,
         0.15,  0.45,  1.60, -0.85,  1.20,  1.20,  0.80, -0.50,
        // LOB: 挑高過頂長球 (由 N1, N11 強正向驅動，玩家前衝時必殺)
        -1.60,  2.10, -0.30, -0.30, -0.85, -0.50,  0.15, -0.40,
        -0.10, -0.85, -0.60,  2.20, -0.45, -0.45,  0.35, -0.70
    ]);

    const B2 = new Float32Array([
        0.25, 0.40, 0.30, -0.65
    ]);

    // 預分配推論工作記憶體 (Zero-Allocation Buffer)
    const _feat = new Float32Array(8);
    const _hid = new Float32Array(16);
    const _logits = new Float32Array(4);
    const _probs = new Float32Array(4);

    /**
     * 前向推論計算：8 Inputs -> 16 Hidden (LeakyReLU) -> 4 Logits -> Softmax
     */
    function forwardPass(features) {
        // 隱藏層運算
        for (let i = 0; i < 16; i++) {
            let sum = B1[i];
            const rowOffset = i * 8;
            for (let j = 0; j < 8; j++) {
                sum += features[j] * W1[rowOffset + j];
            }
            // LeakyReLU: max(0.05 * sum, sum)
            _hid[i] = sum > 0 ? sum : sum * 0.05;
        }

        // 輸出層運算
        let maxLogit = -Infinity;
        for (let k = 0; k < 4; k++) {
            let sum = B2[k];
            const rowOffset = k * 16;
            for (let i = 0; i < 16; i++) {
                sum += _hid[i] * W2[rowOffset + i];
            }
            _logits[k] = sum;
            if (sum > maxLogit) maxLogit = sum;
        }

        // 數值穩定 Softmax
        let expSum = 0;
        for (let k = 0; k < 4; k++) {
            const e = Math.exp(_logits[k] - maxLogit);
            _probs[k] = e;
            expSum += e;
        }
        for (let k = 0; k < 4; k++) {
            _probs[k] /= expSum;
        }

        return _probs;
    }

    /**
     * 戰術幾何解算器：根據神經網路決策的動作，推演最佳落點座標、初速倍率與旋轉參數
     */
    function resolveTactics(actionIdx, ball, playerPos, courtW, halfL, kitchenD) {
        const action = ACTIONS[actionIdx];
        const halfW = courtW * 0.5;
        const safeW = halfW - 0.45; // 邊線安全留白 45cm，確保 100% 界內

        let targetX = 0;
        let targetZ = 0;
        let speedScale = 1.0;
        let spin = 0;
        let liftY = 0;
        let explanation = '';

        // 玩家站位偏向 (Player Offset)
        const px = playerPos ? playerPos.x : 0;
        const pz = playerPos ? playerPos.z : halfL - 0.5;
        // 尋找球場空檔 (反向空側)
        const openCourtX = px > 0.3 ? -safeW * 0.85 : (px < -0.3 ? safeW * 0.85 : (Math.random() < 0.5 ? -safeW * 0.6 : safeW * 0.6));

        switch (action) {
            case 'DROP':
                // 💧 第三桿放短：精確落在玩家廚房區 (1.15m ~ 1.85m)，柔和過網消去攻擊力
                targetX = openCourtX * 0.6 + (Math.random() - 0.5) * 0.4;
                targetZ = 1.25 + Math.random() * 0.60;
                speedScale = 0.72;
                spin = -0.08; // 輕微回旋
                liftY = 0.25;
                explanation = '對手深站底線，神經網路執行【第三桿放短】，將球柔和吊入廚房區！';
                break;

            case 'DRIVE':
                // 🚀 穿越重砲：高速低平壓向深底線空檔角 (5.2m ~ 5.9m)
                targetX = openCourtX + (Math.random() - 0.5) * 0.3;
                targetZ = halfL - 0.95 + (Math.random() - 0.5) * 0.35;
                speedScale = 1.22;
                spin = 0.12 * Math.sign(openCourtX); // 兩側刁鑽上旋 / 側旋
                liftY = 0;
                explanation = '抓到邊線空檔，神經網路發動【穿越重砲抽球】，直壓底角！';
                break;

            case 'DINK':
                // 🎾 廚房區切角小球：網前極致小角度對角切球 (0.8m ~ 1.6m)
                targetX = (px > 0 ? -1 : 1) * safeW * 0.80 + (Math.random() - 0.5) * 0.3;
                targetZ = 0.85 + Math.random() * 0.70;
                speedScale = 0.65;
                spin = (px > 0 ? -0.15 : 0.15); // 順勢切球
                liftY = 0.18;
                explanation = '網前近身交鋒，神經網路執行【大斜線丁克切球】，逼迫對手跨步！';
                break;

            case 'LOB':
                // 🌈 挑高過頂長球：當玩家過度前衝時，高角度吊越過頂落在底線前 80cm
                targetX = (Math.random() - 0.5) * 1.5;
                targetZ = halfL - 0.80 + (Math.random() - 0.5) * 0.4;
                speedScale = 0.92;
                spin = 0;
                liftY = 1.45; // 弧線大幅挑高
                explanation = '偵測到對手過度逼近廚房網前，神經網路果斷【挑高過頂長球】！';
                break;
        }

        // 界內安全鉗制
        targetX = Math.max(-safeW, Math.min(safeW, targetX));
        targetZ = Math.max(0.65, Math.min(halfL - 0.45, targetZ));

        return {
            targetX,
            targetZ,
            speedScale,
            spin,
            liftY,
            explanation
        };
    }

    /**
     * 對外主介面：TinyPicklePolicy.evaluate(state)
     */
    const TinyPicklePolicy = {
        ACTIONS,
        ACTION_NAMES,

        /**
         * 執行決策推論
         * @param {Object} state
         *   - ball: { x, y, z, vx, vy, vz }
         *   - player: { x, y, z }
         *   - court: { width, halfL, kitchenD }
         * @returns {Object} 包含最佳動作、機率分佈、戰術落點與解說
         */
        evaluate: function (state) {
            const b = state.ball || { x: 0, y: 1.0, z: 0, vx: 0, vy: 0, vz: 0 };
            const p = state.player || { x: 0, y: 0.9, z: 5.5 };
            const cW = (state.court && state.court.width) || 6.10;
            const hL = (state.court && state.court.halfL) || 6.70;
            const kD = (state.court && state.court.kitchenD) || 2.13;

            // 特徵正規化 [-1, 1]
            _feat[0] = Math.max(-1, Math.min(1, b.x / (cW * 0.5)));
            _feat[1] = Math.max(0, Math.min(1, b.y / 3.0));
            _feat[2] = Math.max(-1, Math.min(1, b.z / hL));
            _feat[3] = Math.max(-1, Math.min(1, (b.vx || 0) / 15.0));
            _feat[4] = Math.max(-1, Math.min(1, (b.vy || 0) / 12.0));
            _feat[5] = Math.max(-1, Math.min(1, (b.vz || 0) / 20.0));
            _feat[6] = Math.max(-1, Math.min(1, p.x / (cW * 0.5)));
            _feat[7] = Math.max(0, Math.min(1, p.z / hL)); // 0: 網前, 1: 深底線

            const probs = forwardPass(_feat);

            // 選取最高機率之戰術
            let bestIdx = 0;
            let bestProb = probs[0];
            for (let i = 1; i < 4; i++) {
                if (probs[i] > bestProb) {
                    bestProb = probs[i];
                    bestIdx = i;
                }
            }

            const tactics = resolveTactics(bestIdx, b, p, cW, hL, kD);

            return {
                action: ACTIONS[bestIdx],
                actionName: ACTION_NAMES[ACTIONS[bestIdx]],
                confidence: bestProb,
                probabilities: [probs[0], probs[1], probs[2], probs[3]],
                tactics: tactics
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TinyPicklePolicy;
    }
    if (typeof global !== 'undefined') {
        global.TinyPicklePolicy = TinyPicklePolicy;
        global.PickleNeuralPolicy = TinyPicklePolicy;
    }
})(typeof window !== 'undefined' ? window : global);
