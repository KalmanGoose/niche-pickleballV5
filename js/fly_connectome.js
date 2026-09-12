/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 普林斯頓 FlyWire 果蠅神經連接組核心
   Princeton University FlyWire Drosophila Visual Escape Connectome
   Spiking Neural Network (LIF-A) & Electrophysiology Simulation Engine
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /**
     * DrosophilaConnectome
     * 實作果蠅巨大纖維視覺逃逸神經迴路 (Giant Fiber Escape System - GFES)
     * 基於普林斯頓大學 FlyWire 聯盟神經元連接組拓撲 (Dorkenwald et al., Nature 2024)
     * 迴路架構：
     *   Ommatidia (複眼光流) -> LC4 / LPLC2 (小葉突觸柱狀神經元)
     *   -> GF (巨大纖維神經元, LIF-A 生物物理膜電位模型)
     *   -> TTMn (中足伸肌運動神經元, 瞬移逃逸起跳) + DLMn (背縱飛行肌, 125Hz 超頻振翅)
     *   -> DNa01 / DNa02 (下行轉向神經元, 精準對角線壓線截擊)
     * 
     * 包含 Tsodyks-Markram 短時突觸抑制 (Short-Term Synaptic Depression, STD)
     * 以及即時多通道電生理示波器 (CRT Oscilloscope) 繪圖引擎
     */
    class DrosophilaConnectome {
        constructor() {
            // ─── 1. 生物物理膜電位參數 (Leaky Integrate-and-Fire with Adaptation) ───
            this.vRest = -65.0;       // 靜息電位 (mV)
            this.vReset = -70.0;      // 去極化後重置電位 (mV)
            this.vThresh = -45.0;     // 動作電位放電閥值 (mV)
            this.vPeak = +25.0;       // 動作電位尖峰 (mV)
            this.tauM = 0.012;        // 膜時間常數 12 ms (0.012 s)
            this.Rm = 10.0;           // 膜電阻 10 MΩ
            this.tauRef = 0.0035;     // 絕對不反應期 3.5 ms (0.0035 s)
            this.refTimer = 0.0;      // 不反應期計時器 (s)
            this.Vm = this.vRest;     // 當前巨纖維 (GF) 膜電位 (mV)

            // ─── 2. 脈衝頻率適應性電流 (Spike-Frequency Adaptation) ───
            this.adapt = 0.0;         // 適應性電流 a(t)
            this.tauAdapt = 0.080;    // 適應性時間常數 80 ms
            this.adaptB = 1.25;       // 每次放電後之適應性增量

            // ─── 3. Tsodyks-Markram 短時突觸抑制 (Short-Term Depression, STD) ───
            this.xVesicle = 1.0;      // 突觸神經傳導物質釋放資源池 fraction [0.0, 1.0]
            this.tauRec = 2.80;       // 囊泡回收恢復時間常數 2.8 s
            this.U = 0.38;            // 突觸釋放利用率 (Utilization factor)
            this.isFatigued = false;  // 當 x < 0.26 時觸發微距視覺過載 (STUNNED)

            // ─── 4. 光學幾何與視覺小葉神經元 (Visual Lobula Neurons) ───
            this.ballRadius = 0.037;  // 匹克球半徑 (m) - 直徑 74mm
            this.theta = 0.0;         // 複眼對球之立體視角張角 (rad)
            this.dThetaDt = 0.0;      // 光學逼近膨脹率 (rad/s)
            this.vApproach = 0.0;     // 球體逼近相對速度 (m/s)
            this.lc4 = 0.0;           // LC4 柱狀神經元活化值 (擴張角速度敏感)
            this.lplc2 = 0.0;         // LPLC2 小葉板神經元活化值 (碰撞光流敏感)
            this.iSyn = 0.0;          // 輸入至 GF 之突觸電流 (pA / a.u.)

            // ─── 5. 下行運動神經元輸出 (Motor Outputs) ───
            this.gfSpike = false;     // 本幀是否發放 GF 動作電位
            this.spikeCount = 0;      // 累積放電次數
            this.ttmnActive = false;  // TTMn 起跳跳躍致動
            this.dlmnFreq = 70.0;     // DLMn 飛行肌頻率 (Hz)
            this.dnaSteer = 0.0;      // DNa01/02 下行轉向控制量 [-1.0, 1.0]

            // ─── 6. 示波器歷史波形緩衝區 (Oscilloscope History Buffer) ───
            this.historyLength = 220; // 與 Canvas 寬度 220px 匹配
            this.historyVm = new Float32Array(this.historyLength);
            this.historySpike = new Uint8Array(this.historyLength);
            this.historyLoom = new Float32Array(this.historyLength);
            this.historyIdx = 0;

            for (let i = 0; i < this.historyLength; i++) {
                this.historyVm[i] = this.vRest;
                this.historySpike[i] = 0;
                this.historyLoom[i] = 0;
            }

            // 狀態文字快取
            this._domVm = null;
            this._domDtheta = null;
            this._domVesicle = null;
            this._domState = null;
            this.hudVisible = true;
        }

        /**
         * 重置神經元電生理狀態至靜息
         */
        reset() {
            this.Vm = this.vRest;
            this.refTimer = 0.0;
            this.adapt = 0.0;
            this.xVesicle = 1.0;
            this.isFatigued = false;
            this.gfSpike = false;
            this.dThetaDt = 0.0;
            this.iSyn = 0.0;
            this.ttmnActive = false;
            this.dlmnFreq = 70.0;
            this.dnaSteer = 0.0;
            for (let i = 0; i < this.historyLength; i++) {
                this.historyVm[i] = this.vRest;
                this.historySpike[i] = 0;
                this.historyLoom[i] = 0;
            }
        }

        /**
         * 執行單步數值生物物理模擬 (60FPS 或動態 dt)
         * 包含子步長 Euler 積分器 (sub-step <= 0.5ms)
         */
        step(dt, ballPos, ballVel, flyPos, isRallyActive, dinkCount = 0) {
            this.gfSpike = false;
            this.ttmnActive = false;

            if (!isRallyActive || !ballPos || !flyPos) {
                this._passiveDecay(dt);
                this._recordHistory(this.Vm, 0, 0);
                return;
            }

            // 1. 光學逼近幾何學 (Visual Looming Optics)
            const dx = ballPos.x - flyPos.x;
            const dy = ballPos.y - (flyPos.y || 0.85);
            const dz = ballPos.z - flyPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            let dTheta = 0.0;
            let vApp = 0.0;

            if (dist > 0.04) {
                this.theta = 2.0 * Math.atan(this.ballRadius / dist);
                // 逼近速度分量 v_app = - (r • v) / |r|
                vApp = -(dx * ballVel.x + dy * ballVel.y + dz * ballVel.z) / dist;
                this.vApproach = vApp;
                if (vApp > 0.0) {
                    dTheta = (2.0 * this.ballRadius * vApp) / (dist * dist + this.ballRadius * this.ballRadius);
                }
            } else {
                this.vApproach = 0.0;
            }
            this.dThetaDt = dTheta;

            // 2. 普林斯頓小葉突觸柱狀神經元激發度 (Lobula Columellar Neurons)
            // LC4: 對擴張角速度敏銳 (閥值 ~ 0.12 rad/s)
            this.lc4 = Math.max(0.0, dTheta - 0.12);
            // LPLC2: 對立體角與角膨脹之碰撞光流敏銳 (θ * dθ/dt)
            this.lplc2 = (this.theta * 12.0) * Math.max(0.0, dTheta);

            // 3. Tsodyks-Markram 短時突觸抑制 (STD) 囊泡耗竭動力學
            // 廚房區小球 (Dink): 球在網前低速滯留，複眼微距刺激持續，突觸囊泡急速釋放消耗
            const inKitchen = (ballPos.z > -2.25 && ballPos.z < 0.0);
            let inputRate = 0.0;
            if (inKitchen) {
                // 丁克拍數越多，網前微距過載速率呈非線性倍增
                const dinkMultiplier = 1.0 + Math.min(3.0, dinkCount * 0.75);
                inputRate = 2.2 * dinkMultiplier * Math.max(0.0, 1.0 - dist / 3.0);
            } else if (vApp < 3.0 && dist < 2.8) {
                inputRate = 0.6 * Math.max(0.0, 1.0 - dist / 2.8);
            }

            const dxVesicle = ((1.0 - this.xVesicle) / this.tauRec - this.U * this.xVesicle * inputRate) * dt;
            this.xVesicle = Math.max(0.04, Math.min(1.0, this.xVesicle + dxVesicle));
            this.isFatigued = (this.xVesicle < 0.26);

            // 4. 巨纖維突觸電流傳導 (Synaptic Current to GF)
            // 當突觸抑制發生時，I_syn 顯著衰減，巨纖維完全無法放電
            const wLC4 = 3.20;
            const wLPLC2 = 4.10;
            this.iSyn = this.xVesicle * (wLC4 * this.lc4 + wLPLC2 * this.lplc2);

            // 5. LIF-A 膜電位高精度 Euler 數值積分 (子步長 <= 0.5ms)
            const dtSub = 0.0005; // 0.5 ms
            const subSteps = Math.max(1, Math.ceil(dt / dtSub));
            const actualDtSub = dt / subSteps;
            let frameSpiked = false;

            for (let s = 0; s < subSteps; s++) {
                // 適應性電流指數衰減
                this.adapt += (-this.adapt / this.tauAdapt) * actualDtSub;

                if (this.refTimer > 0.0) {
                    this.refTimer -= actualDtSub;
                    this.Vm = this.vReset;
                } else {
                    // LIF-A 微分方程:
                    // dVm/dt = [ -(Vm - Vrest) + Rm * I_syn - Rm * a ] / tauM
                    const dVm = (-(this.Vm - this.vRest) + this.Rm * (this.iSyn * 1.85) - this.adapt * 2.0) / this.tauM;
                    this.Vm += dVm * actualDtSub;

                    // 動作電位放電判定 (Spike Threshold Crossing)
                    if (this.Vm >= this.vThresh) {
                        this.Vm = this.vPeak; // 去極化尖峰 +25mV
                        frameSpiked = true;
                        this.gfSpike = true;
                        this.spikeCount++;
                        this.refTimer = this.tauRef; // 進入 3.5ms 不反應期
                        this.adapt += this.adaptB;   // 適應性電流激增
                        break;
                    }
                }
            }

            // 6. 下行運動效應器驅動 (Downstream Motor Actuation)
            if (this.gfSpike) {
                this.ttmnActive = true;
                this.dlmnFreq = 125.0; // 飛行肌爆發振翅至 125Hz
                // DNa01/02 轉向向量：根據球的入射角與玩家位置產生反向補償
                this.dnaSteer = Math.sign(dx) * 0.85;
            } else if (this.isFatigued) {
                this.ttmnActive = false;
                this.dlmnFreq = 14.0;  // 飛行肌失速至 14Hz
                this.dnaSteer = 0.0;
            } else {
                this.ttmnActive = false;
                this.dlmnFreq = 70.0;  // 正常巡航 70Hz
            }

            this._recordHistory(this.Vm, frameSpiked ? 1 : 0, this.dThetaDt);
        }

        /**
         * 無球或暫停時之被動弛豫 (Passive Relaxation)
         */
        _passiveDecay(dt) {
            const dtSub = 0.001;
            const subSteps = Math.max(1, Math.ceil(dt / dtSub));
            const actualDtSub = dt / subSteps;
            for (let s = 0; s < subSteps; s++) {
                this.adapt += (-this.adapt / this.tauAdapt) * actualDtSub;
                this.Vm += (-(this.Vm - this.vRest) / this.tauM) * actualDtSub;
            }
            // 囊泡資源緩慢回收
            this.xVesicle = Math.min(1.0, this.xVesicle + ((1.0 - this.xVesicle) / this.tauRec) * dt);
            this.isFatigued = (this.xVesicle < 0.26);
            this.dThetaDt = 0.0;
            this.iSyn = 0.0;
            this.dlmnFreq = 70.0;
            this.ttmnActive = false;
        }

        /**
         * 寫入歷史波形環形緩衝區
         */
        _recordHistory(vm, spike, loom) {
            this.historyVm[this.historyIdx] = vm;
            this.historySpike[this.historyIdx] = spike;
            this.historyLoom[this.historyIdx] = loom;
            this.historyIdx = (this.historyIdx + 1) % this.historyLength;
        }

        /**
         * 繪製高質感電生理示波器 (CRT Electrophysiology Oscilloscope)
         * @param {HTMLCanvasElement} canvas 
         */
        renderOscilloscope(canvas) {
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const w = canvas.width;
            const h = canvas.height;

            // 1. 深黑色 CRT 示波器背景
            ctx.fillStyle = '#03080e';
            ctx.fillRect(0, 0, w, h);

            // 2. 螢光網格線 (Grid: 電位 mV 與 時間 ms)
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = 'rgba(34, 197, 94, 0.12)';

            // 垂直時間刻度線 (每 20px 一格)
            ctx.beginPath();
            for (let x = 0; x < w; x += 22) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
            }
            // 水平電位刻度線
            for (let y = 0; y < h; y += 17) {
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
            }
            ctx.stroke();

            // 輔助座標映射常數: Vm 範圍 [-75mV, +30mV] 共 105mV
            // y = h - ((Vm - (-75)) / 105) * h
            const vmToY = (vm) => {
                const norm = THREE_CLAMP((vm + 75.0) / 105.0, 0.0, 1.0);
                return h - norm * (h - 10) - 5;
            };

            // 3. 靜息電位參考線 (-65mV) 與 動作電位放電閥值線 (-45mV)
            const yRest = vmToY(-65.0);
            const yThresh = vmToY(-45.0);

            // -65mV 靜息電位 (淡綠虛線)
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
            ctx.beginPath();
            ctx.moveTo(0, yRest);
            ctx.lineTo(w, yRest);
            ctx.stroke();

            // -45mV 動作電位閥值 (紅色虛線)
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
            ctx.beginPath();
            ctx.moveTo(0, yThresh);
            ctx.lineTo(w, yThresh);
            ctx.stroke();
            ctx.setLineDash([]); // 恢復實線

            // 閥值文字標記
            ctx.font = '7.5px monospace';
            ctx.fillStyle = 'rgba(244, 63, 94, 0.85)';
            ctx.fillText('Vth -45mV', 4, yThresh - 2);
            ctx.fillStyle = 'rgba(74, 222, 128, 0.55)';
            ctx.fillText('-65mV', 4, yRest + 8);

            // 4. CH2: 光學逼近率 dθ/dt (青藍色波形)
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.70)';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            for (let i = 0; i < this.historyLength; i++) {
                const bufIdx = (this.historyIdx + i) % this.historyLength;
                const loomVal = this.historyLoom[bufIdx];
                // 映射 loom (0 ~ 5 rad/s) 至畫面上半部
                const yLoom = h - 6 - Math.min(1.0, loomVal / 4.0) * (h * 0.45);
                const x = (i / this.historyLength) * w;
                if (i === 0) ctx.moveTo(x, yLoom);
                else ctx.lineTo(x, yLoom);
            }
            ctx.stroke();

            // 5. CH1: 巨纖維膜電位 Vm (亮螢光綠波形)
            ctx.save();
            ctx.shadowColor = 'rgba(34, 197, 94, 0.75)';
            ctx.shadowBlur = 4;
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1.4;
            ctx.beginPath();

            let hasSpikesInWindow = false;
            for (let i = 0; i < this.historyLength; i++) {
                const bufIdx = (this.historyIdx + i) % this.historyLength;
                const vmVal = this.historyVm[bufIdx];
                const x = (i / this.historyLength) * w;
                const y = vmToY(vmVal);

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);

                if (this.historySpike[bufIdx] === 1) {
                    hasSpikesInWindow = true;
                }
            }
            ctx.stroke();
            ctx.restore();

            // 6. Spike 動作電位脈衝柵格 (Raster Ticks)
            if (hasSpikesInWindow) {
                ctx.fillStyle = '#facc15';
                for (let i = 0; i < this.historyLength; i++) {
                    const bufIdx = (this.historyIdx + i) % this.historyLength;
                    if (this.historySpike[bufIdx] === 1) {
                        const x = (i / this.historyLength) * w;
                        ctx.fillRect(x - 1, h - 7, 2, 6);
                    }
                }
            }

            // 7. CRT 掃描線光暈裝飾 (Scanline Overlay)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
            for (let y = 0; y < h; y += 2) {
                ctx.fillRect(0, y, w, 1);
            }
        }

        /**
         * 更新 HUD 遙測數據文字標籤
         */
        updateDomReadouts() {
            if (!this._domVm) this._domVm = document.getElementById('snn-vm');
            if (!this._domDtheta) this._domDtheta = document.getElementById('snn-dtheta');
            if (!this._domVesicle) this._domVesicle = document.getElementById('snn-vesicle');
            if (!this._domState) this._domState = document.getElementById('snn-circuit-state');

            if (this._domVm) {
                this._domVm.innerText = (this.Vm >= 0 ? '+' : '') + this.Vm.toFixed(1) + ' mV';
                if (this.Vm >= this.vThresh) {
                    this._domVm.style.color = '#f43f5e';
                    this._domVm.style.textShadow = '0 0 8px rgba(244,63,94,0.8)';
                } else {
                    this._domVm.style.color = '#22c55e';
                    this._domVm.style.textShadow = 'none';
                }
            }

            if (this._domDtheta) {
                this._domDtheta.innerText = this.dThetaDt.toFixed(2) + ' rad/s';
            }

            if (this._domVesicle) {
                const pct = (this.xVesicle * 100).toFixed(0) + '%';
                this._domVesicle.innerText = pct;
                if (this.xVesicle < 0.28) {
                    this._domVesicle.style.color = '#eab308';
                } else {
                    this._domVesicle.style.color = '#38bdf8';
                }
            }

            if (this._domState) {
                if (this.gfSpike) {
                    this._domState.innerText = '⚡ GF 動作電位放電!';
                    this._domState.className = 'snn-status spike';
                } else if (this.isFatigued) {
                    this._domState.innerText = '💤 微距視盲過載 (暈眩)';
                    this._domState.className = 'snn-status stunned';
                } else if (this.Vm > this.vRest + 3.0) {
                    this._domState.innerText = '📈 去極化興奮中';
                    this._domState.className = 'snn-status excited';
                } else {
                    this._domState.innerText = '🟢 LIF 靜息平衡';
                    this._domState.className = 'snn-status rest';
                }
            }
        }
    }

    // 內部安全鉗制輔助函式
    function THREE_CLAMP(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    // 掛載至全域
    window.DrosophilaConnectome = DrosophilaConnectome;
    window.FLY_BRAIN = new DrosophilaConnectome();

    // 全域切換 HUD 函式
    window.toggleSnnHud = function (force) {
        const hud = document.getElementById('fly-snn-hud');
        if (!hud) return;
        const willShow = (force !== undefined) ? force : (hud.style.display === 'none' || hud.style.display === '');
        hud.style.display = willShow ? 'flex' : 'none';
        if (!willShow) {
            hud.dataset.userClosed = 'true';
        } else {
            delete hud.dataset.userClosed;
        }
        const btn = document.getElementById('subbar-snn-btn');
        if (btn) {
            btn.innerText = willShow ? '⚡ 示波器: 開' : '⚡ 示波器: 關';
            btn.style.color = willShow ? '#c084fc' : 'var(--dim)';
        }
    };

    // ─── 7. 示波器視窗自由拖曳與四角切換 (HUD Drag & Position Controls) ───
    const SNN_POSITIONS = [
        { name: '右上 (預設)', top: 'calc(96px + env(safe-area-inset-top))', right: '8px', bottom: 'auto', left: 'auto', origin: 'top right' },
        { name: '右下', top: 'auto', right: '8px', bottom: '85px', left: 'auto', origin: 'bottom right' },
        { name: '左下', top: 'auto', right: 'auto', bottom: '85px', left: '8px', origin: 'bottom left' },
        { name: '左上', top: 'calc(230px + env(safe-area-inset-top))', right: 'auto', bottom: 'auto', left: '8px', origin: 'top left' }
    ];
    let snnPosIdx = 0;

    window.cycleSnnHudPosition = function (e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        snnPosIdx = (snnPosIdx + 1) % SNN_POSITIONS.length;
        applySnnPosition(snnPosIdx, true);
    };

    function applySnnPosition(idx, showToast) {
        const hud = document.getElementById('fly-snn-hud');
        if (!hud) return;
        const pos = SNN_POSITIONS[idx];
        hud.style.top = pos.top;
        hud.style.right = pos.right;
        hud.style.bottom = pos.bottom;
        hud.style.left = pos.left;
        hud.style.transformOrigin = pos.origin;

        localStorage.setItem('nchu_fly_snn_pos_idx', idx.toString());
        localStorage.removeItem('nchu_fly_snn_custom_pos');

        if (showToast && typeof toast === 'function') {
            toast('📍 示波器已移動', `停靠位置：${pos.name}`);
        }
    }

    // ─── 8. 示波器視窗獨立放大/縮小按鈕 (Zoom In / Out Controls) ───
    window.zoomSnnHud = function (delta, e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        const curScale = (typeof cardScales !== 'undefined' && cardScales['fly-snn-hud']) 
            ? cardScales['fly-snn-hud'] 
            : 1.0;
        const newScale = Math.min(1.80, Math.max(0.50, curScale + delta));
        if (typeof setCardScale === 'function') {
            setCardScale('fly-snn-hud', newScale, true);
        } else {
            document.documentElement.style.setProperty('--fly-snn-hud-scale', newScale.toFixed(2));
            const snnZoom = document.getElementById('snn-zoom-level');
            if (snnZoom) snnZoom.innerText = Math.round(newScale * 100) + '%';
            localStorage.setItem('nchu_fly-snn-hud_scale', newScale.toFixed(2));
        }
        if (typeof toast === 'function') {
            const act = delta > 0 ? '放大' : '縮小';
            toast(`🔍 示波器已${act}`, `目前比例：${Math.round(newScale * 100)}%`);
        }
    };

    window.resetSnnHudScale = function (e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (typeof setCardScale === 'function') {
            setCardScale('fly-snn-hud', 1.0, true);
        } else {
            document.documentElement.style.setProperty('--fly-snn-hud-scale', '1.0');
            const snnZoom = document.getElementById('snn-zoom-level');
            if (snnZoom) snnZoom.innerText = '100%';
            localStorage.setItem('nchu_fly-snn-hud_scale', '1.0');
        }
        if (typeof toast === 'function') {
            toast('📐 示波器尺寸已重置', '恢復 100% 預設大小');
        }
    };

    function initSnnHudDrag() {
        const hud = document.getElementById('fly-snn-hud');
        if (!hud) return;

        // 讀取上次記憶的位置
        try {
            const savedCustom = localStorage.getItem('nchu_fly_snn_custom_pos');
            if (savedCustom) {
                const p = JSON.parse(savedCustom);
                if (typeof p.left === 'number' && typeof p.top === 'number') {
                    hud.style.left = p.left + 'px';
                    hud.style.top = p.top + 'px';
                    hud.style.right = 'auto';
                    hud.style.bottom = 'auto';
                    hud.style.transformOrigin = (p.left > window.innerWidth / 2) ? 'top right' : 'top left';
                }
            } else {
                const savedIdx = localStorage.getItem('nchu_fly_snn_pos_idx');
                if (savedIdx !== null) {
                    snnPosIdx = parseInt(savedIdx, 10) || 0;
                    applySnnPosition(snnPosIdx, false);
                }
            }
        } catch (_) {}

        // 綁定標題列拖曳
        const header = hud.querySelector('.snn-header');
        if (!header) return;

        let isDragging = false;
        let startPointerX = 0, startPointerY = 0;
        let initLeft = 0, initTop = 0;
        let hasMoved = false;

        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || e.target.id === 'snn-zoom-level') return;
            if (e.button && e.button !== 0) return;

            isDragging = true;
            hasMoved = false;
            startPointerX = e.clientX;
            startPointerY = e.clientY;

            const container = document.getElementById('game-container') || document.body;
            const cRect = container.getBoundingClientRect();
            const hRect = hud.getBoundingClientRect();

            initLeft = hRect.left - cRect.left;
            initTop = hRect.top - cRect.top;

            hud.style.left = initLeft + 'px';
            hud.style.top = initTop + 'px';
            hud.style.right = 'auto';
            hud.style.bottom = 'auto';

            try { header.setPointerCapture(e.pointerId); } catch (_) {}
            e.stopPropagation();
        });

        header.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startPointerX;
            const dy = e.clientY - startPointerY;
            if (Math.hypot(dx, dy) > 3) hasMoved = true;

            const container = document.getElementById('game-container') || document.body;
            const cRect = container.getBoundingClientRect();

            const curScale = (typeof cardScales !== 'undefined' && cardScales['fly-snn-hud']) ? cardScales['fly-snn-hud'] : 1.0;
            const w = hud.offsetWidth * curScale;
            const h = hud.offsetHeight * curScale;

            const maxLeft = Math.max(4, cRect.width - w - 4);
            const maxTop = Math.max(4, cRect.height - h - 4);

            const nextLeft = Math.max(4, Math.min(maxLeft, initLeft + dx));
            const nextTop = Math.max(4, Math.min(maxTop, initTop + dy));

            hud.style.left = nextLeft + 'px';
            hud.style.top = nextTop + 'px';
            hud.style.right = 'auto';
            hud.style.bottom = 'auto';

            e.stopPropagation();
            e.preventDefault();
        });

        const endDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            try { header.releasePointerCapture(e.pointerId); } catch (_) {}

            if (hasMoved) {
                const curLeft = parseFloat(hud.style.left);
                const curTop = parseFloat(hud.style.top);
                localStorage.setItem('nchu_fly_snn_custom_pos', JSON.stringify({ left: curLeft, top: curTop }));
                if (typeof toast === 'function') {
                    toast('📍 示波器位置已記憶', '已放置於自訂畫面位置');
                }
            }
        };

        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        // 雙擊標題列快速重設回預設右上角
        header.addEventListener('dblclick', (e) => {
            if (e.target.closest('button')) return;
            snnPosIdx = 0;
            applySnnPosition(0, true);
        });
    }

    // ─── 9. 關卡框 (#info) 拖曳支援 ───
    function initInfoDrag() {
        const info = document.getElementById('info');
        if (!info) return;
        const handle = info.querySelector('.info-drag-handle');
        if (!handle) return;

        let isDragging = false;
        let startPointerX = 0, startPointerY = 0;
        let initLeft = 0, initTop = 0;
        let hasMoved = false;

        // 讀取記憶位置
        try {
            const saved = localStorage.getItem('nchu_info_pos');
            if (saved) {
                const p = JSON.parse(saved);
                if (typeof p.left === 'number' && typeof p.top === 'number') {
                    info.style.left = p.left + 'px';
                    info.style.top = p.top + 'px';
                    info.style.right = 'auto';
                }
            }
        } catch (_) {}

        handle.addEventListener('pointerdown', (e) => {
            if (e.button && e.button !== 0) return;
            isDragging = true;
            hasMoved = false;
            startPointerX = e.clientX;
            startPointerY = e.clientY;

            const container = document.getElementById('game-container') || document.body;
            const cRect = container.getBoundingClientRect();
            const iRect = info.getBoundingClientRect();

            initLeft = iRect.left - cRect.left;
            initTop = iRect.top - cRect.top;

            info.style.left = initLeft + 'px';
            info.style.top = initTop + 'px';
            info.style.right = 'auto';

            try { handle.setPointerCapture(e.pointerId); } catch (_) {}
            e.stopPropagation();
            e.preventDefault();
        });

        handle.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startPointerX;
            const dy = e.clientY - startPointerY;
            if (Math.hypot(dx, dy) > 3) hasMoved = true;

            const container = document.getElementById('game-container') || document.body;
            const cRect = container.getBoundingClientRect();

            const curScale = (typeof cardScales !== 'undefined' && cardScales.info) ? cardScales.info : 1.0;
            const w = info.offsetWidth * curScale;
            const h = info.offsetHeight * curScale;

            const maxLeft = Math.max(4, cRect.width - w - 4);
            const maxTop = Math.max(4, cRect.height - h - 4);

            info.style.left = Math.max(4, Math.min(maxLeft, initLeft + dx)) + 'px';
            info.style.top = Math.max(4, Math.min(maxTop, initTop + dy)) + 'px';
            info.style.right = 'auto';

            e.stopPropagation();
            e.preventDefault();
        });

        const endDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
            if (hasMoved) {
                const curLeft = parseFloat(info.style.left);
                const curTop = parseFloat(info.style.top);
                localStorage.setItem('nchu_info_pos', JSON.stringify({ left: curLeft, top: curTop }));
                if (typeof toast === 'function') {
                    toast('📍 關卡框位置已記憶', '已放置於自訂位置');
                }
            }
        };

        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);

        handle.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            localStorage.removeItem('nchu_info_pos');
            info.style.top = 'calc(14px + env(safe-area-inset-top))';
            info.style.left = 'calc(14px + env(safe-area-inset-left))';
            info.style.right = 'auto';
            if (typeof toast === 'function') {
                toast('📍 關卡框位置已重置', '恢復預設左上角位置');
            }
        });
    }

    // 初始化拖曳
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initSnnHudDrag();
            initInfoDrag();
        });
    } else {
        setTimeout(() => {
            initSnnHudDrag();
            initInfoDrag();
        }, 50);
    }
})();
