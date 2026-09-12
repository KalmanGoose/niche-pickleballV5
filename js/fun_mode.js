/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 瘋狂道具戰模式 (Fun Item Battle Mode)
   結合《瑪利歐網球》趣味元素與 3D 物理引擎 / 普林斯頓果蠅神經系統
   ═══════════════════════════════════════════════════════════════════ */

(function(window) {
    'use strict';

    const FUN_STORAGE_KEY = 'nchu_pb_fun_mode';

    const FunMode = {
        enabled: false,
        items: [],             // 場上的 3D 道具箱
        spawnCooldown: 0,
        activeBuff: null,      // 'MEGA_PADDLE' | 'ELECTRIC_SWATTER' | 'MEGA_BALL' | 'GIANT_PLAYER'
        buffTimer: 0,
        buffMaxTime: 0,
        flyBuff: null,         // 'HEXA_PADDLE' | 'KAIJU_FLY'
        flyBuffTimer: 0,
        flySquashed: false,
        flySquashTimer: 0,
        hexaGroup: null,       // 蒼蠅六刀流球拍群組
        swatterSparkGroup: null, // 電蚊拍電弧粒子群組
        zapCombo: 0,           // 0: 未電擊, 1: 觸電抽搐, 2: 過載冒煙, 3: 致命 K.O.
        zapCooldown: 0,        // 每次電擊的受創無敵/冷卻時間 (0.35s)
        electricArcMesh: null, // 3D 雷電折線特效
        electricArcTimer: 0,
        isFaceOff: false,      // 是否進入近身對峙揮砍距離
        slashTimer: 0,         // 手勢揮拍動作時間
        slashDir: 'RIGHT',     // 揮拍方向: 'RIGHT' | 'LEFT' | 'DOWN' | 'UP'
        strokeStartX: 0,
        strokeStartY: 0,
        strokePrevX: 0,
        strokePrevY: 0,
        isStroking: false,
        questionBoxTex: null,  // 問號箱材質
        originalPadScale: 2.175,

        // 道具清單定義
        ITEMS: [
            { id: 'MEGA_PADDLE', name: '巨無霸球拍', icon: '🎾', color: '#facc15', dur: 4.5, desc: '球拍膨脹 2.8 倍，閉著眼睛都能接到！' },
            { id: 'ELECTRIC_SWATTER', name: '霹靂電蚊拍', icon: '⚡', color: '#a855f7', dur: 7.5, desc: '不管球了！衝過網直接把蒼蠅電爛才會贏！' },
            { id: 'MEGA_BALL', name: '巨無霸鐵球', icon: '💣', color: '#64748b', dur: 5.0, desc: '球體膨脹為 1 米巨鐵球，落地引發地震波！' },
            { id: 'GIANT_PLAYER', name: '超巨大化球員', icon: '🍄', color: '#ef4444', dur: 5.0, desc: '人偶體積放大 2 倍，無敵重扣覆蓋全場！' }
        ],

        init: function() {
            try {
                this.enabled = localStorage.getItem(FUN_STORAGE_KEY) === 'true';
            } catch (e) {
                this.enabled = false;
            }
            this.buildQuestionBoxTexture();
            this.buildFlyHexaPaddles();
            this.buildSwatterSparks();
            this.syncUI();
        },

        buildQuestionBoxTexture: function() {
            if (typeof document === 'undefined') return;
            const cv = document.createElement('canvas');
            cv.width = 128; cv.height = 128;
            const ctx = cv.getContext('2d');
            // 金黃色漸層背景
            const grad = ctx.createLinearGradient(0, 0, 128, 128);
            grad.addColorStop(0, '#f59e0b');
            grad.addColorStop(0.5, '#fbbf24');
            grad.addColorStop(1, '#d97706');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 128, 128);

            // 邊框與鉚釘
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 8;
            ctx.strokeRect(4, 4, 120, 120);

            ctx.fillStyle = '#fef3c7';
            ctx.fillRect(8, 8, 10, 10);
            ctx.fillRect(110, 8, 10, 10);
            ctx.fillRect(8, 110, 10, 10);
            ctx.fillRect(110, 110, 10, 10);

            // 白色問號字樣
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 76px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;
            ctx.fillText('?', 64, 68);

            if (typeof THREE !== 'undefined') {
                this.questionBoxTex = new THREE.CanvasTexture(cv);
                this.questionBoxTex.magFilter = THREE.NearestFilter;
            }
        },

        buildFlyHexaPaddles: function() {
            if (typeof THREE === 'undefined' || typeof flyMesh === 'undefined' || !flyMesh) return;
            if (this.hexaGroup) return;

            this.hexaGroup = new THREE.Group();
            this.hexaGroup.name = 'flyHexaPaddles';

            // 6 把微型阿修羅球拍（對應蒼蠅 6 隻腳位置）
            const padMat = new THREE.MeshStandardMaterial({
                color: 0xef4444,
                roughness: 0.3,
                metalness: 0.3,
                emissive: 0x991b1b,
                emissiveIntensity: 0.4
            });
            const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });

            const legOffsets = [
                { x: -0.32, y: 0.62, z: -0.18, rotY: -0.8, rotZ: 0.4 },
                { x: 0.32, y: 0.62, z: -0.18, rotY: 0.8, rotZ: -0.4 },
                { x: -0.36, y: 0.60, z: 0.05, rotY: -1.5, rotZ: 0.2 },
                { x: 0.36, y: 0.60, z: 0.05, rotY: 1.5, rotZ: -0.2 },
                { x: -0.28, y: 0.58, z: 0.28, rotY: -2.3, rotZ: 0.1 },
                { x: 0.28, y: 0.58, z: 0.28, rotY: 2.3, rotZ: -0.1 }
            ];

            for (let i = 0; i < 6; i++) {
                const conf = legOffsets[i];
                const miniPad = new THREE.Group();
                const face = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.02), padMat);
                face.position.y = 0.12;
                const rim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.25, 0.015), edgeMat);
                rim.position.y = 0.12;
                const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.04), edgeMat);
                grip.position.y = -0.04;

                miniPad.add(face);
                miniPad.add(rim);
                miniPad.add(grip);
                miniPad.position.set(conf.x, conf.y, conf.z);
                miniPad.rotation.set(0, conf.rotY, conf.rotZ);
                miniPad.scale.setScalar(1.25);
                this.hexaGroup.add(miniPad);
            }

            this.hexaGroup.visible = false;
            flyMesh.add(this.hexaGroup);
        },

        buildSwatterSparks: function() {
            if (typeof THREE === 'undefined' || typeof pPad === 'undefined' || !pPad) return;
            if (this.swatterSparkGroup) return;

            this.swatterSparkGroup = new THREE.Group();
            this.swatterSparkGroup.name = 'swatterSparks';

            // 電蚊拍發光網格與青紫色閃爍電弧圈
            const gridMat = new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                wireframe: true,
                transparent: true,
                opacity: 0.75
            });
            const grid = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.04), gridMat);
            grid.position.y = 0.18;
            this.swatterSparkGroup.add(grid);

            // 電弧光環
            for (let i = 0; i < 3; i++) {
                const sparkRing = new THREE.Mesh(
                    new THREE.RingGeometry(0.12 + i * 0.06, 0.15 + i * 0.06, 16),
                    new THREE.MeshBasicMaterial({
                        color: i % 2 === 0 ? 0xc084fc : 0x38bdf8,
                        transparent: true,
                        opacity: 0.8,
                        side: THREE.DoubleSide
                    })
                );
                sparkRing.position.set(0, 0.18, 0.03);
                sparkRing.name = 'sparkRing_' + i;
                this.swatterSparkGroup.add(sparkRing);
            }

            this.swatterSparkGroup.visible = false;
            pPad.add(this.swatterSparkGroup);
        },

        buildRunwayGuidance: function() {
            if (typeof THREE === 'undefined' || typeof scene === 'undefined') return;
            if (this.guidanceGroup) return;

            this.guidanceGroup = new THREE.Group();
            this.guidanceGroup.name = 'swatterRunwayGuidance';

            // 光毯地面箭頭 (從後場一路延伸跨越球網至對手場地)
            const arrowMat = new THREE.MeshBasicMaterial({
                color: 0x38bdf8,
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            // 鋪設跨越球網的前進能量箭頭
            for (let i = 0; i < 9; i++) {
                const z = 3.6 - i * 1.15; // 跨越 2.13 (廚房線) 與 0 (球網) 至 -5.6
                const arrowGeo = new THREE.ConeGeometry(0.32, 0.60, 3);
                const arrow = new THREE.Mesh(arrowGeo, arrowMat);
                arrow.rotation.x = -Math.PI / 2;
                arrow.rotation.z = Math.PI;
                arrow.position.set(0, 0.02, z);
                arrow.name = 'guideArrow_' + i;
                this.guidanceGroup.add(arrow);
            }

            // 球網破除電弧光環
            const netRingGeo = new THREE.RingGeometry(0.65, 0.95, 24);
            const netRingMat = new THREE.MeshBasicMaterial({
                color: 0xc084fc,
                transparent: true,
                opacity: 0.75,
                side: THREE.DoubleSide
            });
            const netRing = new THREE.Mesh(netRingGeo, netRingMat);
            netRing.position.set(0, 0.45, 0); // 剛好在球網中央
            netRing.name = 'netBreakRing';
            this.guidanceGroup.add(netRing);

            this.guidanceGroup.visible = false;
            scene.add(this.guidanceGroup);
        },

        showGuideBanner: function() {
            let el = document.getElementById('swatter-guide-banner');
            if (!el) {
                el = document.createElement('div');
                el.id = 'swatter-guide-banner';
                el.className = 'swatter-guide-banner';
                document.body.appendChild(el);
            }
            this.updateGuideBanner();
            el.style.display = 'flex';
        },

        updateGuideBanner: function() {
            const el = document.getElementById('swatter-guide-banner');
            if (!el) return;
            const combo = this.zapCombo || 0;
            let badges = '';
            for (let i = 1; i <= 3; i++) {
                if (i <= combo) {
                    badges += `<span class="sg-badge hit">⚡</span>`;
                } else {
                    badges += `<span class="sg-badge unhit">▫️</span>`;
                }
            }

            let subText = '👆 手指按住往前拖曳 · 衝過球網逼近蒼蠅！';
            let titleText = '⚡ 第一人稱狂暴衝鋒 · 跨網封印解除！ ⚡';

            if (this.isFaceOff) {
                if (combo === 0) {
                    titleText = '⚡ 貼臉近身對峙！快速滑動螢幕揮拍！ ⚡';
                    subText = '👆 在螢幕上快速滑動！親手揮拍電死牠！';
                } else if (combo === 1) {
                    titleText = '⚡ 第 1 擊命中！蒼蠅劇烈抽搐！ ⚡';
                    subText = '💥 破甲抽搐！再快速滑動給牠第二擊！';
                } else if (combo === 2) {
                    titleText = '⚡⚡ 第 2 擊命中！過載狂冒煙！ ⚡⚡';
                    subText = '🔥 蒼蠅已過載！最後用力滑動致命一擊！';
                } else if (combo >= 3) {
                    titleText = '⚡⚡⚡ 終極 K.O.！蒼蠅徹底電焦！ ⚡⚡⚡';
                    subText = '🏆 3/3 灰飛煙滅！直接奪得分數！';
                }
            }

            el.innerHTML = `
                <div class="sg-combo-row">
                    <span class="sg-combo-label">電擊連擊:</span>
                    <div class="sg-badges">${badges}</div>
                </div>
                <div class="sg-pulse">${titleText}</div>
                <div class="sg-sub">${subText}</div>
            `;
        },

        createSlashVisual: function(sx, sy, dx, dy) {
            let container = document.getElementById('slash-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'slash-container';
                container.style.position = 'fixed';
                container.style.inset = '0';
                container.style.pointerEvents = 'none';
                container.style.zIndex = '9999';
                document.body.appendChild(container);
            }

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('style', 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;');

            const len = Math.hypot(dx, dy) || 140;
            const normX = (dx / len) * 120;
            const normY = (dy / len) * 120;

            const cx = sx || (window.innerWidth / 2);
            const cy = sy || (window.innerHeight / 2);

            const x1 = cx - normX;
            const y1 = cy - normY;
            const x2 = cx + normX;
            const y2 = cy + normY;

            const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * 55;
            const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 55;

            const strokeColor = (this.zapCombo >= 2) ? '#facc15' : '#38bdf8';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`);
            path.setAttribute('stroke', strokeColor);
            path.setAttribute('stroke-width', '7');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('style', 'filter: drop-shadow(0 0 16px #38bdf8) drop-shadow(0 0 28px #c084fc); transition: opacity 0.28s ease-out;');
            svg.appendChild(path);

            container.appendChild(svg);
            setTimeout(() => {
                svg.style.opacity = '0';
                setTimeout(() => svg.remove(), 280);
            }, 60);
        },

        handleSwipeSlash: function(dx, dy, sx, sy) {
            if (this.activeBuff !== 'ELECTRIC_SWATTER') return false;
            if (!this.isFaceOff) return false;
            if (this.zapCooldown > 0 || this.zapCombo >= 3) return false;

            // 根據手指滑動方向決定揮拍姿勢
            if (Math.abs(dx) > Math.abs(dy)) {
                this.slashDir = dx > 0 ? 'RIGHT' : 'LEFT';
            } else {
                this.slashDir = dy > 0 ? 'DOWN' : 'UP';
            }
            this.slashTimer = 0.35; // 0.35 秒揮拍動作

            // 觸發螢幕電弧刀光切痕
            this.createSlashVisual(sx, sy, dx, dy);

            // 執行電擊打擊
            this.executeFlyZap();
            return true;
        },

        onSwipeStart: function(x, y) {
            this.strokeStartX = this.strokePrevX = x;
            this.strokeStartY = this.strokePrevY = y;
            this.isStroking = true;
        },

        onSwipeMove: function(x, y) {
            if (!this.isStroking) return;
            const dx = x - this.strokeStartX;
            const dy = y - this.strokeStartY;
            const dist = Math.hypot(dx, dy);

            // 滑動距離超過 28px 且處於近身對峙時觸發揮砍
            if (dist > 28 && this.activeBuff === 'ELECTRIC_SWATTER' && this.isFaceOff) {
                this.handleSwipeSlash(dx, dy, x, y);
                this.strokeStartX = x;
                this.strokeStartY = y;
            }
            this.strokePrevX = x;
            this.strokePrevY = y;
        },

        onSwipeEnd: function() {
            this.isStroking = false;
        },

        createElectricArc: function(fromPos, toPos, intensity) {
            if (typeof THREE === 'undefined' || typeof scene === 'undefined') return;
            if (this.electricArcMesh) {
                scene.remove(this.electricArcMesh);
                if (this.electricArcMesh.geometry) this.electricArcMesh.geometry.dispose();
                this.electricArcMesh = null;
            }

            const points = [];
            const segments = 9;
            const start = new THREE.Vector3(fromPos.x, fromPos.y, fromPos.z);
            const end = new THREE.Vector3(toPos.x, toPos.y, toPos.z);
            const dir = new THREE.Vector3().subVectors(end, start);
            const len = dir.length() || 1;

            const up = Math.abs(dir.y / len) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            const perp1 = new THREE.Vector3().crossVectors(dir, up).normalize();
            const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

            points.push(start.clone());
            const jitterScale = Math.min(0.40, len * 0.15) * (intensity || 1.0);

            for (let i = 1; i < segments; i++) {
                const alpha = i / segments;
                const basePt = new THREE.Vector3().lerpVectors(start, end, alpha);
                const j1 = (Math.random() - 0.5) * 2 * jitterScale;
                const j2 = (Math.random() - 0.5) * 2 * jitterScale;
                basePt.addScaledVector(perp1, j1);
                basePt.addScaledVector(perp2, j2);
                points.push(basePt);
            }
            points.push(end.clone());

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const colorHex = (intensity > 1.6) ? 0xfacc15 : (intensity > 1.1 ? 0xa855f7 : 0x38bdf8);
            const mat = new THREE.LineBasicMaterial({
                color: colorHex,
                linewidth: 3,
                transparent: true,
                opacity: 1.0,
                depthWrite: false
            });

            this.electricArcMesh = new THREE.Line(geo, mat);
            this.electricArcTimer = 0.28;
            scene.add(this.electricArcMesh);
        },

        hideGuideBanner: function() {
            const el = document.getElementById('swatter-guide-banner');
            if (el) el.style.display = 'none';
        },

        toggle: function(forceState) {
            this.enabled = (typeof forceState === 'boolean') ? forceState : !this.enabled;
            try {
                localStorage.setItem(FUN_STORAGE_KEY, String(this.enabled));
            } catch (e) { }

            this.syncUI();

            if (!this.enabled) {
                this.clearAll();
                if (typeof toast === 'function') toast('🍄 道具戰已關閉', '已切換為正規匹克球模式');
            } else {
                if (typeof toast === 'function') toast('🍄 瘋狂道具戰已啟動！', '球場隨機掉落問號箱，踩到自動啟動超能力！');
                if (typeof S !== 'undefined' && S.tone) {
                    S.tone('triangle', 440, 880, 0.18, 0.25);
                }
            }
        },

        syncUI: function() {
            const lbl = document.getElementById('nav-fun-lbl');
            if (lbl) lbl.innerText = this.enabled ? '開' : '關';

            const subLbl = document.getElementById('subbar-fun-lbl');
            if (subLbl) subLbl.innerText = this.enabled ? '開' : '關';

            const btn = document.getElementById('nav-fun-btn');
            if (btn) {
                btn.style.color = this.enabled ? '#fbbf24' : 'var(--dim)';
                btn.classList.toggle('on', this.enabled);
            }
            const subBtn = document.getElementById('subbar-fun-btn');
            if (subBtn) {
                subBtn.style.color = this.enabled ? '#fbbf24' : 'var(--dim)';
                subBtn.classList.toggle('on', this.enabled);
            }
        },

        spawnItemBox: function() {
            if (typeof THREE === 'undefined' || typeof scene === 'undefined') return;
            if (this.items.length >= 2) return;

            // 隨機在玩家半場生成 (x: -2.1 ~ +2.1, z: 1.6 ~ 5.5)
            const sx = (Math.random() - 0.5) * 4.2;
            const sz = 1.6 + Math.random() * 3.8;

            const boxGrp = new THREE.Group();
            boxGrp.position.set(sx, 0.55, sz);

            // 3D 問號方塊
            const mat = new THREE.MeshStandardMaterial({
                map: this.questionBoxTex,
                roughness: 0.35,
                metalness: 0.25,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.45
            });
            const cube = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat);
            cube.castShadow = true;
            cube.name = 'boxCube';
            boxGrp.add(cube);

            // 地面發光投影光環
            const shadowMat = new THREE.MeshBasicMaterial({
                color: 0xfbbf24,
                transparent: true,
                opacity: 0.38,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const floorRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.36, 24), shadowMat);
            floorRing.rotation.x = -Math.PI / 2;
            floorRing.position.y = -0.53;
            boxGrp.add(floorRing);

            boxGrp.userData = {
                baseY: 0.55,
                rotSpeed: 2.2 + Math.random() * 0.8,
                bobPhase: Math.random() * Math.PI * 2,
                itemType: this.ITEMS[Math.floor(Math.random() * this.ITEMS.length)]
            };

            scene.add(boxGrp);
            this.items.push(boxGrp);

            // 掉落音效與波紋
            if (typeof S !== 'undefined' && S.ready) S.ready();
            if (typeof popRing === 'function') popRing(sx, sz, 1.4, 0xfbbf24);
        },

        update: function(dt) {
            if (!this.enabled) return;

            const now = performance.now() / 1000;

            // 1. 道具箱生成計時器
            this.spawnCooldown -= dt;
            if (typeof state !== 'undefined' && state === 'RALLY') {
                if (this.spawnCooldown <= 0 && this.items.length < 2) {
                    this.spawnItemBox();
                    this.spawnCooldown = 8.0 + Math.random() * 6.0; // 8~14秒生成一顆
                }
            }

            // 2. 更新道具箱旋轉與浮動
            for (let i = this.items.length - 1; i >= 0; i--) {
                const it = this.items[i];
                it.rotation.y += it.userData.rotSpeed * dt;
                it.position.y = it.userData.baseY + Math.sin(now * 3.5 + it.userData.bobPhase) * 0.12;

                // 撿拾碰撞檢測 (玩家靠近至 0.85 米)
                if (typeof pPos !== 'undefined') {
                    const dist = Math.hypot(pPos.x - it.position.x, pPos.z - it.position.z);
                    if (dist < 0.85) {
                        this.triggerPickup(it.userData.itemType, it.position);
                        scene.remove(it);
                        this.items.splice(i, 1);
                    }
                }
            }

            // 3. 更新玩家 Buff 倒數
            if (this.activeBuff) {
                this.buffTimer -= dt;
                this.updateHud();

                // 電蚊拍電弧特效動態與近身電擊檢測
                if (this.activeBuff === 'ELECTRIC_SWATTER') {
                    if (this.zapCooldown > 0) {
                        this.zapCooldown -= dt;
                    }

                    if (this.swatterSparkGroup) {
                        for (let i = 0; i < 3; i++) {
                            const ring = this.swatterSparkGroup.getObjectByName('sparkRing_' + i);
                            if (ring) {
                                ring.rotation.z += (i + 1) * 8.0 * dt;
                                ring.material.opacity = 0.4 + Math.random() * 0.5;
                            }
                        }
                    }
                    if (typeof ballGlow !== 'undefined' && ballGlow) {
                        ballGlow.material.color.set(0x38bdf8);
                        ballGlow.material.opacity = 0.85;
                    }

                    // 更新 3D 引導光毯
                    if (!this.guidanceGroup) this.buildRunwayGuidance();
                    if (this.guidanceGroup) {
                        this.guidanceGroup.visible = true;
                        const gTime = performance.now() * 0.005;
                        for (let i = 0; i < 9; i++) {
                            const arr = this.guidanceGroup.getObjectByName('guideArrow_' + i);
                            if (arr) {
                                arr.position.y = 0.02 + Math.sin(gTime * 3 + i * 0.6) * 0.015;
                                arr.material.opacity = 0.35 + Math.sin(gTime * 4 - i * 0.8) * 0.35;
                            }
                        }
                        const nRing = this.guidanceGroup.getObjectByName('netBreakRing');
                        if (nRing) {
                            nRing.rotation.z += 4.0 * dt;
                            nRing.scale.setScalar(1.0 + Math.sin(gTime * 5) * 0.15);
                        }
                    }

                    // 偵測是否進入近身對峙揮砍距離（2.0米以內）
                    const targetObj = (typeof gGrp !== 'undefined' && gGrp) ? gGrp.position : null;
                    if (targetObj && typeof pPos !== 'undefined') {
                        const distToFly = Math.hypot(pPos.x - targetObj.x, pPos.z - targetObj.z);
                        const wasFaceOff = this.isFaceOff;
                        this.isFaceOff = (distToFly <= 2.0);
                        if (wasFaceOff !== this.isFaceOff) {
                            this.updateGuideBanner();
                        }
                    }

                    if (this.slashTimer > 0) {
                        this.slashTimer -= dt;
                    }
                } else {
                    if (this.guidanceGroup) this.guidanceGroup.visible = false;
                }

                if (this.buffTimer <= 0) {
                    if (this.activeBuff === 'ELECTRIC_SWATTER') {
                        if (typeof toast === 'function') {
                            toast('💨 蒼蠅逃脫成功！', '電蚊拍電力耗盡，蒼蠅逃過一劫！');
                        }
                        if (typeof announceReferee === 'function') {
                            announceReferee('💨 蒼蠅逃脫！', '電蚊拍電力耗盡，蒼蠅撿回一命！', true);
                        }
                        this.clearPlayerBuff();
                        if (typeof freeze === 'function') freeze();
                        if (typeof state !== 'undefined') state = 'FAULT';
                        if (typeof later === 'function' && typeof resetServe === 'function') {
                            later(resetServe, 1800);
                        }
                        return;
                    }
                    this.clearPlayerBuff();
                }
            } else {
                if (this.guidanceGroup) this.guidanceGroup.visible = false;
            }

            // 更新 3D 雷電鏈折線壽命與淡出
            if (this.electricArcMesh) {
                this.electricArcTimer -= dt;
                if (this.electricArcTimer <= 0) {
                    if (typeof scene !== 'undefined') scene.remove(this.electricArcMesh);
                    if (this.electricArcMesh.geometry) this.electricArcMesh.geometry.dispose();
                    this.electricArcMesh = null;
                } else if (this.electricArcMesh.material) {
                    this.electricArcMesh.material.opacity = Math.max(0, this.electricArcTimer / 0.28);
                }
            }

            // 4. 更新蒼蠅狂暴/壓扁狀態
            if (this.flyBuff) {
                this.flyBuffTimer -= dt;
                if (this.flyBuff === 'HEXA_PADDLE' && typeof flyMesh !== 'undefined' && flyMesh) {
                    // 阿修羅高速自旋
                    flyMesh.rotation.y += 18.0 * dt;
                }
                if (this.flyBuffTimer <= 0) {
                    this.clearFlyBuff();
                }
            }

            if (this.flySquashed) {
                this.flySquashTimer -= dt;
                if (this.flySquashTimer <= 0) {
                    this.flySquashed = false;
                    if (typeof flyMesh !== 'undefined' && flyMesh) {
                        flyMesh.scale.set(1, 1, 1);
                    }
                }
            }
        },

        triggerPickup: function(item, pos) {
            this.activeBuff = item.id;
            this.buffTimer = item.dur;
            this.buffMaxTime = item.dur;

            // 特效音與波紋
            if (typeof S !== 'undefined' && S.point) S.point();
            if (typeof popRing === 'function') popRing(pos.x, pos.z, 2.2, 0xfacc15);

            if (typeof toast === 'function') {
                toast(`${item.icon} 獲得【${item.name}】！`, item.desc);
            }
            if (typeof announceReferee === 'function') {
                announceReferee(`🍄 道具發動！`, `玩家獲得【${item.name}】！`, true);
            }

            // 應用具體屬性
            if (item.id === 'MEGA_PADDLE') {
                if (typeof pPad !== 'undefined') {
                    pPad.scale.setScalar(this.originalPadScale * 2.8);
                }
            } else if (item.id === 'ELECTRIC_SWATTER') {
                this.zapCombo = 0;
                this.zapCooldown = 0;
                if (this.swatterSparkGroup) this.swatterSparkGroup.visible = true;
                // ★ 立即解除任何鎖定與中斷，強行保證追殺暢行無阻！
                if (typeof locked !== 'undefined') locked = false;
                if (typeof state !== 'undefined' && state !== 'OVER') state = 'RALLY';
                if (typeof clearTimers === 'function') clearTimers();
                if (typeof dismissFingerTutorial === 'function') dismissFingerTutorial();
                this.showGuideBanner();
                if (typeof S !== 'undefined' && S.tone) {
                    S.tone('sawtooth', 220, 580, 0.35, 0.4);
                }
                if (typeof toast === 'function') {
                    toast('⚡ 霹靂電蚊拍發動！全速衝鋒！', '不管球了！連續電擊 3 次電爛蒼蠅才會贏！');
                }
                if (typeof announceReferee === 'function') {
                    announceReferee('⚡ 進入追殺模式！', '連續電擊 3 次電死蒼蠅才算贏！球落地不結算！', false);
                }
            } else if (item.id === 'MEGA_BALL') {
                if (typeof ball !== 'undefined') {
                    ball.scale.setScalar(2.8);
                    ball.material.color.set(0x334155); // 沉重鐵灰色
                }
                if (typeof ballGlow !== 'undefined') {
                    ballGlow.scale.setScalar(2.8);
                }
            } else if (item.id === 'GIANT_PLAYER') {
                if (typeof pGrp !== 'undefined') {
                    pGrp.scale.setScalar(2.0);
                }
                if (typeof addShake === 'function') addShake(0.2);
            }

            // 偶爾觸發蒼蠅狂暴對抗 (35% 機率觸發六刀流或巨獸蒼蠅)
            if (typeof diffLevel !== 'undefined' && diffLevel === 'fly' && !this.flyBuff && Math.random() < 0.45) {
                const flyItem = Math.random() < 0.65 ? 'HEXA_PADDLE' : 'KAIJU_FLY';
                this.triggerFlyBuff(flyItem);
            }

            this.showHudBadge(item);
        },

        triggerFlyBuff: function(buffType) {
            this.flyBuff = buffType;
            this.flyBuffTimer = 5.0;

            if (buffType === 'HEXA_PADDLE') {
                if (!this.hexaGroup) this.buildFlyHexaPaddles();
                if (this.hexaGroup) this.hexaGroup.visible = true;
                if (typeof toast === 'function') {
                    toast('🪰⚔️ 蒼蠅狂暴：六刀流阿修羅！', '六隻腳全掏出球拍！360度陀螺無死角連擊！');
                }
                if (typeof announceReferee === 'function') {
                    announceReferee('🪰 蒼蠅啟動六刀流！', '阿修羅全方位連擊！', true);
                }
            } else if (buffType === 'KAIJU_FLY') {
                if (typeof flyMesh !== 'undefined' && flyMesh) {
                    flyMesh.scale.setScalar(3.2);
                }
                if (typeof toast === 'function') {
                    toast('🦕 蒼蠅狂暴：巨獸哥吉拉型態！', '體積暴增 3 倍！注意超重力回球！');
                }
            }
        },

        // 當玩家揮動電蚊拍靠近蒼蠅時觸發電擊 (按空白鍵或在對峙時點擊)
        tryElectrocuteFly: function() {
            if (this.activeBuff !== 'ELECTRIC_SWATTER') return false;
            if (this.zapCooldown > 0 || this.zapCombo >= 3) return false;
            if (!this.isFaceOff) return false;
            this.handleSwipeSlash(0, -60, window.innerWidth / 2, window.innerHeight / 2);
            return true;
        },

        executeFlyZap: function() {
            if (this.activeBuff !== 'ELECTRIC_SWATTER') return;
            if (this.zapCooldown > 0) return; // 冷卻防抖，保證打擊節奏

            this.zapCombo++;
            this.zapCooldown = 0.35; // 0.35 秒受創間隔，手感流暢敏捷

            // 保證 Buff 時間充裕完成 3 連擊
            this.buffTimer = Math.max(this.buffTimer, 5.0);

            const flyPos = (typeof gGrp !== 'undefined' && gGrp) ? gGrp.position : null;
            const swatterPos = (typeof padW !== 'undefined') ? padW : (typeof pPos !== 'undefined' ? new THREE.Vector3(pPos.x, 1.1, pPos.z - 0.4) : null);

            // 生成 3D 高壓雷電鏈折線 (球拍直貫蒼蠅)
            if (swatterPos && flyPos) {
                this.createElectricArc(swatterPos, flyPos, 0.8 + this.zapCombo * 0.45);
            }

            this.updateGuideBanner();

            if (this.zapCombo === 1) {
                // ── 第 1 擊：觸電破甲抽搐 ──
                if (typeof flyState !== 'undefined') flyState = 'ELECTROCUTED';
                if (typeof flyStunTimer !== 'undefined') flyStunTimer = 0.80;
                if (typeof flyMesh !== 'undefined' && flyMesh) {
                    flyMesh.rotation.z = Math.PI * 0.35; // 身體微傾歪斜
                }
                if (typeof S !== 'undefined' && S.tone) {
                    S.tone('sawtooth', 320, 750, 0.28, 0.45);
                }
                if (typeof addShake === 'function') addShake(0.25);
                if (typeof popRing === 'function' && flyPos) {
                    popRing(flyPos.x, flyPos.z, 2.6, 0x38bdf8);
                }
                if (window.FLY_BRAIN) {
                    if (window.FLY_BRAIN.gfVm !== undefined) window.FLY_BRAIN.gfVm = 18.0;
                    const snnCircuitStatusEl = document.getElementById('fly-snn-status');
                    if (snnCircuitStatusEl) {
                        snnCircuitStatusEl.innerText = '⚡ VOLTAGE SPIKE (第 1 擊：神經元高壓抽搐)';
                        snnCircuitStatusEl.style.color = '#38bdf8';
                    }
                }
                if (typeof toast === 'function') {
                    toast('⚡ [1/3] 觸電抽搐！', '第 1 擊破除護甲！快追上去再補一擊！');
                }
            } else if (this.zapCombo === 2) {
                // ── 第 2 擊：過載狂冒煙、頭冒金星 ──
                if (typeof flyState !== 'undefined') flyState = 'ELECTROCUTED';
                if (typeof flyStunTimer !== 'undefined') flyStunTimer = 0.90;
                if (typeof flyDizzy !== 'undefined' && flyDizzy) flyDizzy.visible = true;
                if (typeof flyMesh !== 'undefined' && flyMesh) {
                    flyMesh.rotation.z = Math.PI * 0.55; // 重度側翻
                    flyMesh.scale.set(1.15, 0.85, 1.15); // 壓抑受創變形
                }
                if (typeof S !== 'undefined' && S.tone) {
                    S.tone('sawtooth', 220, 950, 0.38, 0.55);
                    S.tone('square', 720, 180, 0.22, 0.35);
                }
                if (typeof addShake === 'function') addShake(0.38);
                if (typeof popRing === 'function' && flyPos) {
                    popRing(flyPos.x, flyPos.z, 3.2, 0xa855f7);
                    popRing(flyPos.x, flyPos.z, 2.2, 0xfacc15);
                }
                if (window.FLY_BRAIN) {
                    if (window.FLY_BRAIN.gfVm !== undefined) window.FLY_BRAIN.gfVm = 34.0;
                    const snnCircuitStatusEl = document.getElementById('fly-snn-status');
                    if (snnCircuitStatusEl) {
                        snnCircuitStatusEl.innerText = '🔥 CIRCUIT SMOKING (第 2 擊：迴路過載冒煙)';
                        snnCircuitStatusEl.style.color = '#f59e0b';
                    }
                }
                if (typeof toast === 'function') {
                    toast('⚡⚡ [2/3] 過載冒煙！', '第 2 擊命中！蒼蠅已冒煙暈眩，給牠最後致命一擊！');
                }
            } else if (this.zapCombo >= 3) {
                // ── 第 3 擊：終極雷暴 K.O. 翻肚墜地 ──
                if (typeof flyState !== 'undefined') flyState = 'ELECTROCUTED';
                if (typeof flyStunTimer !== 'undefined') flyStunTimer = 4.0;
                if (typeof flyDizzy !== 'undefined' && flyDizzy) flyDizzy.visible = true;
                if (typeof flyMesh !== 'undefined' && flyMesh) {
                    flyMesh.rotation.x = Math.PI * 0.75; // 翻肚朝天
                    flyMesh.rotation.z = 0;
                    flyMesh.position.y = -0.55; // 墜地
                    flyMesh.scale.set(1.2, 0.75, 1.2);
                }
                if (typeof S !== 'undefined') {
                    if (S.tone) S.tone('sawtooth', 650, 30, 0.65, 0.7);
                    if (S.thump) S.thump(2.5);
                }
                if (typeof addShake === 'function') addShake(0.55);
                if (typeof popRing === 'function' && flyPos) {
                    popRing(flyPos.x, flyPos.z, 3.5, 0x38bdf8);
                    popRing(flyPos.x, flyPos.z, 4.8, 0xa855f7);
                    popRing(flyPos.x, flyPos.z, 6.0, 0xfacc15);
                }
                if (window.FLY_BRAIN) {
                    if (window.FLY_BRAIN.gfVm !== undefined) window.FLY_BRAIN.gfVm = 50.0;
                    const snnCircuitStatusEl = document.getElementById('fly-snn-status');
                    if (snnCircuitStatusEl) {
                        snnCircuitStatusEl.innerText = '💀 FATAL OVERLOAD / SHORT CIRCUIT (終極致命短路)';
                        snnCircuitStatusEl.style.color = '#ef4444';
                    }
                }

                // ★ 玩家直接獲勝得分！不管球掉去哪裡，電死蒼蠅就算贏！
                if (typeof pScore !== 'undefined') {
                    pScore++;
                    if (typeof updateScore === 'function') updateScore();
                    if (typeof updateGoal === 'function') updateGoal();
                }

                if (typeof S !== 'undefined' && S.point) {
                    later(() => S.point(), 280);
                }

                if (typeof toast === 'function') {
                    toast('⚡⚡⚡ 3/3 K.O.！電爆蒼蠅獲勝！', '連續 3 擊徹底電焦蒼蠅！不管球了，這分直接算你贏！');
                }
                if (typeof announceReferee === 'function') {
                    announceReferee('⚡ 3連擊 K.O.！', '徹底電焦蒼蠅！直接獲得 1 分！', false);
                }

                this.clearPlayerBuff();

                // 結算當前回合
                const isMatch = (typeof stage !== 'undefined' && (stage === 4 || stage === 5));
                if (isMatch && typeof serveSide !== 'undefined') {
                    serveSide *= -1;
                    if (typeof secondServe !== 'undefined') secondServe = false;
                }
                const goal = (typeof STAGES !== 'undefined' && STAGES[stage]) ? STAGES[stage].goal : 11;
                if (typeof stage !== 'undefined' && (stage === 3 || stage === 4 || stage === 5) && pScore >= goal) {
                    if (typeof clearStage === 'function') clearStage();
                    return;
                }

                if (typeof freeze === 'function') freeze();
                if (typeof state !== 'undefined') state = 'FAULT';
                if (typeof later === 'function' && typeof resetServe === 'function') {
                    later(resetServe, 2800);
                }
            }
        },

        // 巨鐵球壓扁蒼蠅
        squashFly: function() {
            if (typeof diffLevel === 'undefined' || diffLevel !== 'fly') return;
            if (typeof flyMesh === 'undefined' || !flyMesh) return;

            this.flySquashed = true;
            this.flySquashTimer = 2.5;
            flyMesh.scale.set(1.8, 0.18, 1.8); // 壓成一張紙片！
            if (typeof S !== 'undefined' && S.thump) S.thump(1.8);
            if (typeof addShake === 'function') addShake(0.35);

            if (typeof toast === 'function') {
                toast('💥 巨鐵球直接壓扁！', '蒼蠅試圖硬接巨鐵球，被砸成一張卡通紙片！');
            }
        },

        clearPlayerBuff: function() {
            if (this.activeBuff === 'MEGA_PADDLE') {
                if (typeof pPad !== 'undefined') pPad.scale.setScalar(this.originalPadScale);
            } else if (this.activeBuff === 'ELECTRIC_SWATTER') {
                if (this.swatterSparkGroup) this.swatterSparkGroup.visible = false;
                if (this.guidanceGroup) this.guidanceGroup.visible = false;
                this.hideGuideBanner();
            } else if (this.activeBuff === 'MEGA_BALL') {
                if (typeof ball !== 'undefined') {
                    ball.scale.setScalar(1.0);
                    ball.material.color.set(0xdcff6a); // 恢復經典亮螢光黃
                }
                if (typeof ballGlow !== 'undefined') {
                    ballGlow.scale.setScalar(1.0);
                    ballGlow.material.color.set(0xdcff6a);
                }
            } else if (this.activeBuff === 'GIANT_PLAYER') {
                if (typeof pGrp !== 'undefined') pGrp.scale.setScalar(1.0);
            }

            if (typeof pPos !== 'undefined' && pPos.z < 0.3) {
                pPos.z = 1.2;
                if (typeof pGrp !== 'undefined') pGrp.position.z = 1.2;
            }

            this.activeBuff = null;
            this.buffTimer = 0;
            this.zapCombo = 0;
            this.zapCooldown = 0;
            this.isFaceOff = false;
            this.slashTimer = 0;
            this.isStroking = false;
            const sc = document.getElementById('slash-container');
            if (sc) sc.innerHTML = '';
            if (this.electricArcMesh) {
                if (typeof scene !== 'undefined') scene.remove(this.electricArcMesh);
                if (this.electricArcMesh.geometry) this.electricArcMesh.geometry.dispose();
                this.electricArcMesh = null;
            }
            this.hideHudBadge();
            this.hideGuideBanner();
            if (this.guidanceGroup) this.guidanceGroup.visible = false;
        },

        clearFlyBuff: function() {
            if (this.hexaGroup) this.hexaGroup.visible = false;
            if (typeof flyMesh !== 'undefined' && flyMesh) {
                flyMesh.scale.set(1, 1, 1);
                flyMesh.rotation.set(0, 0, 0);
            }
            this.flyBuff = null;
            this.flyBuffTimer = 0;
        },

        clearCourtItems: function() {
            if (this.activeBuff === 'ELECTRIC_SWATTER') return;
            if (typeof scene !== 'undefined') {
                for (const it of this.items) scene.remove(it);
            }
            this.items = [];
            this.spawnCooldown = 4.0;
        },

        clearAll: function() {
            this.clearCourtItems();
            this.clearPlayerBuff();
            this.clearFlyBuff();
            this.zapCombo = 0;
            this.zapCooldown = 0;
            this.isFaceOff = false;
            this.slashTimer = 0;
            this.isStroking = false;
            const sc = document.getElementById('slash-container');
            if (sc) sc.innerHTML = '';
            if (this.electricArcMesh) {
                if (typeof scene !== 'undefined') scene.remove(this.electricArcMesh);
                if (this.electricArcMesh.geometry) this.electricArcMesh.geometry.dispose();
                this.electricArcMesh = null;
            }
            if (this.guidanceGroup) this.guidanceGroup.visible = false;
            this.hideGuideBanner();
        },

        // ═══════ HUD 徽章顯示 ═══════
        showHudBadge: function(item) {
            let el = document.getElementById('fun-item-hud');
            if (!el) {
                el = document.createElement('div');
                el.id = 'fun-item-hud';
                el.className = 'fun-item-hud';
                document.body.appendChild(el);
            }
            el.innerHTML = `
                <div class="fun-item-icon">${item.icon}</div>
                <div class="fun-item-info">
                    <div class="fun-item-name">${item.name}</div>
                    <div class="fun-item-bar-wrap"><div id="fun-item-bar" class="fun-item-bar" style="background:${item.color};"></div></div>
                </div>
                <div class="fun-item-time" id="fun-item-time">${item.dur.toFixed(1)}s</div>
            `;
            el.style.display = 'flex';
        },

        updateHud: function() {
            const bar = document.getElementById('fun-item-bar');
            const timeEl = document.getElementById('fun-item-time');
            if (bar && this.buffMaxTime > 0) {
                const pct = Math.max(0, Math.min(100, (this.buffTimer / this.buffMaxTime) * 100));
                bar.style.width = pct + '%';
            }
            if (timeEl) {
                timeEl.innerText = Math.max(0, this.buffTimer).toFixed(1) + 's';
            }
        },

        hideHudBadge: function() {
            const el = document.getElementById('fun-item-hud');
            if (el) el.style.display = 'none';
        }
    };

    window.FunMode = FunMode;
    window.toggleFunMode = function(force) { FunMode.toggle(force); };

})(typeof window !== 'undefined' ? window : this);
