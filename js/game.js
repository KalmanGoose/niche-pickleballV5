/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 -  主引擎跟有的美的
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════ 寬容度設定 ═══════ */
        const TEACH = { level: 'easy', scale: { easy: 0.55, normal: 0.8, strict: 1.0 } };
        function tScale() { return TEACH.scale[TEACH.level]; }
        function setTeachLevel(l) {
            TEACH.level = l;
            document.querySelectorAll('[data-teach]').forEach(b => b.classList.toggle('on', b.dataset.teach === l));
            toast('動作寬容度:' + ({ easy: '🟢 新手', normal: '🟡 標準', strict: '🔴 嚴格' })[l], '揮拍門檻係數 ×' + tScale());
        }

        /* ═══════ Three.js ═══════ */
        let scene, cam, ren, ray, aimPlane, sunKey = null;
        let ball, ballGlow, ballBlob, ballTrail = [];
        let pGrp, pPad, pArm, gGrp, gPad, gArm, netGrp;
        let gooseMesh = null, flyMesh = null, flyWings = [], flyDizzy = null;
        let flyState = 'HOVER'; // 'HOVER' | 'LOOMING_REFLEX' | 'STUNNED' | 'DINK_APPROACH' | 'POPUP' | 'RECOVERY'
        let flyStunTimer = 0, flyHoverTime = 0, consecutiveDinks = 0;
        let dinkRallyCount = 0, isChanceBall = false;

        function updateOpponentMeshVisibility() {
            const isFly = (typeof diffLevel !== 'undefined' && diffLevel === 'fly');
            if (gooseMesh) gooseMesh.visible = !isFly;
            if (flyMesh) flyMesh.visible = isFly;
            if (gArm) gArm.visible = !isFly;
            const aiWho = document.getElementById('ai-who-label');
            if (aiWho) aiWho.innerText = isFly ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';

            const snnHud = document.getElementById('fly-snn-hud');
            if (snnHud) {
                if (isFly && snnHud.dataset.userClosed !== 'true') {
                    snnHud.style.display = 'flex';
                } else if (!isFly) {
                    snnHud.style.display = 'none';
                }
            }
        }
        let zoneServe, arc, ringLand, ringSpot, warnKitchen, rings = [];
        let practiceWallMesh = null, isWallPractice = false, wallCombo = 0;
        window.isWallPractice = false;

/* ═══════ Three.js 場景、燈光、球場與材質初始化 ═══════ */
        const padW = new THREE.Vector3(), gPadW = new THREE.Vector3();
        const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
        const _q = new THREE.Quaternion(), UPY = new THREE.Vector3(0, 1, 0);
        const _aim = new THREE.Vector3(), _pp = new THREE.Vector3(), _pv = new THREE.Vector3();
        const _land = new THREE.Vector3();
        const serveTgt = { x: 0, z: -4 };
        const aiTo = { x: 0, z: -HALF_L - 0.5 };
        const aiShot = { x: 0, z: 3 };

        function noiseTex(hex, size, density, contrast) {
            const c = document.createElement('canvas'); c.width = c.height = size;
            const x = c.getContext('2d'); x.fillStyle = hex; x.fillRect(0, 0, size, size);
            for (let i = 0; i < density; i++) {
                const l = Math.random() < 0.5 ? 255 : 0;
                x.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',' + (Math.random() * contrast) + ')';
                const s = 1 + Math.random() * 2.5;
                x.fillRect(Math.random() * size, Math.random() * size, s, s);
            }
            const t = new THREE.CanvasTexture(c);
            t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = 4;
            return t;
        }
        function glowTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }
        function softBlobTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(0.55, 'rgba(0,0,0,.22)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = g; x.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }
        function skyTex() {
            const c = document.createElement('canvas'); c.width = 8; c.height = 256;
            const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
            g.addColorStop(0, '#38bdf8'); g.addColorStop(0.35, '#7dd3fc');
            g.addColorStop(0.65, '#bae6fd'); g.addColorStop(0.85, '#fef08a'); g.addColorStop(1, '#fef9c3');
            x.fillStyle = g; x.fillRect(0, 0, 8, 256);
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            return t;
        }

        /* ═══════════ 清新校園風格 程序化紋理 (Procedural Textures) ═══════════ */
        function acGrassTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#62ad35'; ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#73bf43';
            for (let y = 0; y < 128; y += 32) {
                for (let x = 0; x < 128; x += 32) {
                    ctx.beginPath();
                    ctx.moveTo(x + 16, y + 4); ctx.lineTo(x + 28, y + 16);
                    ctx.lineTo(x + 16, y + 28); ctx.lineTo(x + 4, y + 16);
                    ctx.closePath(); ctx.fill();
                }
            }
            const t = new THREE.CanvasTexture(c);
            t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
            return t;
        }

        let waterTexRef = null;
        function acWaterTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, 0, 128, 128);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            for (let y = 8; y < 128; y += 24) {
                for (let x = 6; x < 128; x += 32) {
                    ctx.beginPath(); ctx.arc(x + 10, y, 8, 0.2 * Math.PI, 0.8 * Math.PI, false); ctx.stroke();
                }
            }
            const t = new THREE.CanvasTexture(c);
            t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
            waterTexRef = t;
            return t;
        }

        let woodPlanksTexRef = null;
        function acWoodPlanksTex() {
            const c = document.createElement('canvas'); c.width = 256; c.height = 256;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#deb887'; ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = '#b07d50'; ctx.lineWidth = 4;
            for (let y = 0; y < 256; y += 32) {
                ctx.fillStyle = (y % 64 === 0) ? '#e6c594' : '#deb887';
                ctx.fillRect(0, y, 256, 30);
                ctx.beginPath(); ctx.moveTo(0, y + 31); ctx.lineTo(256, y + 31); ctx.stroke();
                ctx.fillStyle = 'rgba(120, 60, 20, 0.22)';
                ctx.beginPath(); ctx.arc((y * 37) % 230 + 12, y + 16, 2.5, 0, Math.PI * 2); ctx.fill();
            }
            const t = new THREE.CanvasTexture(c);
            t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
            woodPlanksTexRef = t;
            return t;
        }

        function acFaceTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fce5cd'; ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#5c3a21'; ctx.fillRect(0, 0, 128, 36);
            ctx.beginPath(); ctx.moveTo(0, 36);
            for (let i = 0; i <= 128; i += 16) ctx.lineTo(i, 36 + (i % 32 === 0 ? 12 : 2));
            ctx.lineTo(128, 0); ctx.lineTo(0, 0); ctx.fill();
            // Rosy cheeks
            ctx.fillStyle = 'rgba(255, 130, 160, 0.55)';
            ctx.beginPath(); ctx.arc(28, 84, 13, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(100, 84, 13, 0, Math.PI * 2); ctx.fill();
            // Anime sparkling eyes
            ctx.fillStyle = '#1e293b';
            ctx.beginPath(); ctx.ellipse(38, 66, 9, 14, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(90, 66, 9, 14, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(36, 60, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(88, 60, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(40, 70, 2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(92, 70, 2, 0, Math.PI * 2); ctx.fill();
            // Cute smile
            ctx.strokeStyle = '#8d5b4c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(64, 88, 10, 0.15 * Math.PI, 0.85 * Math.PI, false); ctx.stroke();
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            return t;
        }

        function acPaddleTex() {
            const c = document.createElement('canvas'); c.width = 128; c.height = 160;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, 0, 128, 160);
            ctx.strokeStyle = 'rgba(217, 119, 6, 0.25)'; ctx.lineWidth = 2;
            for (let y = 10; y < 160; y += 18) {
                ctx.beginPath(); ctx.moveTo(0, y);
                ctx.bezierCurveTo(40, y + 4, 80, y - 4, 128, y); ctx.stroke();
            }
            // Green Leaf emblem
            ctx.fillStyle = '#10b981'; ctx.beginPath();
            ctx.moveTo(64, 45); ctx.bezierCurveTo(92, 55, 96, 95, 68, 115);
            ctx.bezierCurveTo(76, 95, 66, 88, 58, 92);
            ctx.bezierCurveTo(34, 90, 36, 60, 64, 45); ctx.fill();
            ctx.strokeStyle = '#047857'; ctx.lineWidth = 2.5; ctx.beginPath();
            ctx.moveTo(64, 52); ctx.quadraticCurveTo(66, 80, 68, 110); ctx.stroke();
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            return t;
        }

        function acGooseFaceTex() {
            const c = document.createElement('canvas'); c.width = c.height = 128;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#0f172a';
            ctx.beginPath(); ctx.arc(42, 60, 8, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(86, 60, 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(40, 57, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(84, 57, 3, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255, 160, 180, 0.45)';
            ctx.beginPath(); ctx.arc(32, 74, 9, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(96, 74, 9, 0, Math.PI * 2); ctx.fill();
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            return t;
        }
        let TEX_GLOW, TEX_BLOB;

        /* ★ 智慧相機自適應解算器 (純直立模式鎖定: 高度 6.1, 距離 11.5, 視角親近沉浸, 垂直視場角自適應) */
        function getStageDimensions() {
            const stageEl = document.getElementById('stage3d');
            if (stageEl && stageEl.clientWidth > 0 && stageEl.clientHeight > 0) {
                return { w: stageEl.clientWidth, h: stageEl.clientHeight };
            }
            return { w: window.innerWidth, h: window.innerHeight };
        }

        function getResponsiveCameraConfig(customW, customH) {
            const dims = (customW && customH) ? { w: customW, h: customH } : getStageDimensions();
            const aspect = dims.w / dims.h;

            // ★ 自然實戰自適應相機 (Natural Adaptive Match Camera):
            // 還原順手舒適的實戰自適應仰俯角 (camH: 6.1, camDist: 11.5, lookY: 0.85, lookZ: -0.4)
            // 依據寬高比動態調整水平/垂直視角 (52°~84°)，球感自然、空間感清晰，打球手感最佳
            const targetHFOVRad = 48 * Math.PI / 180;
            const vFOVRad = 2 * Math.atan(Math.tan(targetHFOVRad / 2) / Math.min(aspect, 0.72));
            const fov = Math.min(84, Math.max(52, vFOVRad * 180 / Math.PI));

            return {
                fov: fov,
                camH: 6.1,
                camDist: 11.5,
                lookY: 0.85,
                lookZ: -0.4,
                ballScale: 1.25,
                glowScale: 8,
                glowOpacity: 0.35
            };
        }

        function init3D() {
            scene = new THREE.Scene();
            scene.background = skyTex();
            scene.fog = new THREE.Fog(0xcfeefa, GRADE.fogNear, GRADE.fogFar);

            const dims = getStageDimensions();
            const camCfg = getResponsiveCameraConfig(dims.w, dims.h);
            cam = new THREE.PerspectiveCamera(camCfg.fov, dims.w / dims.h, 0.1, 200);
            cam.position.set(0, camCfg.camH, camCfg.camDist);
            try {
                ren = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
            } catch (e) {
                document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
                    'padding:24px;text-align:center;font-size:15px;line-height:1.8;color:#f8fafc;">' +
                    '此裝置或瀏覽器不支援 WebGL,無法執行 3D 球場。<br>' +
                    '請改用 Chrome / Edge 最新版,或在瀏覽器設定中開啟硬體加速。</div>';
                throw e;
            }
            const initPR = Math.min(window.devicePixelRatio || 2, (typeof PERF_PRESETS !== 'undefined' && typeof perfLevel !== 'undefined' && PERF_PRESETS[perfLevel]) ? PERF_PRESETS[perfLevel].pixelRatio : 2.0);
            ren.setPixelRatio(initPR);
            ren.setSize(dims.w, dims.h);
            ren.outputEncoding = THREE.sRGBEncoding;
            ren.toneMapping = THREE.ACESFilmicToneMapping;
            ren.toneMappingExposure = GRADE.exposure;
            ren.shadowMap.enabled = true;
            ren.shadowMap.type = THREE.PCFSoftShadowMap;
            document.getElementById('stage3d').appendChild(ren.domElement);
            ray = new THREE.Raycaster();
            aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            TEX_GLOW = glowTex(); TEX_BLOB = softBlobTex();
            buildLights(); buildEnvironment(); buildCourt(); buildNet(); buildPracticeWall();
            buildBall(); buildSteve(); buildCreeper(); buildGuides();
            buildAimZones(); buildRingPool();
            if (typeof FunMode !== 'undefined' && FunMode.init) FunMode.init();
        }
        function buildLights() {
            scene.add(new THREE.HemisphereLight(0xf8f3e6, 0x476b38, GRADE.hemiI * 0.85));
            sunKey = new THREE.DirectionalLight(0xfff7e6, GRADE.sunI);
            const key = sunKey;
            key.position.set(8, 15, 9); key.castShadow = true;
            key.shadow.mapSize.set(512, 512);
            const d = 11;
            key.shadow.camera.left = -d; key.shadow.camera.right = d;
            key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
            key.shadow.camera.near = 1; key.shadow.camera.far = 42;
            key.shadow.bias = -0.0012; key.shadow.radius = 3;
            scene.add(key);
            const fill = new THREE.DirectionalLight(0xdcebf7, GRADE.fillI * 0.80);
            fill.position.set(-9, 6, 7); scene.add(fill);
            const rim = new THREE.DirectionalLight(0xfef3c7, GRADE.rimI * 0.70);
            rim.position.set(-2, 5, -13); scene.add(rim);
        }
        let scoreboard3DMesh = null, scoreboard3DTex = null;
        function updateScore3D() {
            if (!scoreboard3DTex) return;
            const canvas = scoreboard3DTex.image;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            // 黑板底色 (Chalkboard Slate Green)
            ctx.fillStyle = '#163828';
            ctx.fillRect(0, 0, 512, 256);

            // 仿木質外邊框與暖色粉筆內線
            ctx.strokeStyle = '#92400e';
            ctx.lineWidth = 10;
            ctx.strokeRect(5, 5, 502, 246);
            ctx.strokeStyle = 'rgba(254, 240, 138, 0.45)';
            ctx.lineWidth = 2;
            ctx.strokeRect(14, 14, 484, 228);

            // 頂部標題 (清新小島風)
            ctx.fillStyle = '#fde047';
            ctx.font = 'bold 22px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🏝️ NCHU ANIMAL CROSSING PICKLEBALL 🏝️', 256, 42);

            // 關卡資訊
            ctx.fillStyle = '#6ee7b7';
            ctx.font = '15px system-ui, sans-serif';
            const sName = STAGES[stage] ? STAGES[stage].name : '島嶼對決';
            ctx.fillText('STAGE ' + stage + ' · ' + sName, 256, 72);

            // 即時比分區塊 (明亮溫暖的粉筆字體)
            ctx.font = 'bold 64px "Barlow Condensed", system-ui, sans-serif';
            ctx.fillStyle = '#fef08a';
            ctx.textAlign = 'center';
            ctx.fillText(pScore + '  :  ' + aScore, 256, 148);

            // 玩家 vs 村長鵝
            ctx.font = 'bold 19px system-ui, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText('🌿 ' + (playerProfile.nickname || '島民玩家'), 36, 205);
            ctx.textAlign = 'right';
            ctx.fillText('村長鵝 AI 🪿', 476, 205);

            scoreboard3DTex.needsUpdate = true;
        }

        let lilyPads = [];
        let spectatorDucklings = [];
        function buildEnvironment() {
            // ═══════ 1. 溫暖島嶼湖水與草皮 (Surrounding Lake & Island Lawn) ═══════
            const wt = acWaterTex(); wt.repeat.set(12, 12);
            const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
                new THREE.MeshStandardMaterial({ map: wt, color: 0x38bdf8, roughness: 0.15, metalness: 0.08, transparent: true, opacity: 0.92 }));
            waterPlane.rotation.x = -Math.PI / 2; waterPlane.position.y = -0.05;
            waterPlane.receiveShadow = true; scene.add(waterPlane);

            const gt = acGrassTex(); gt.repeat.set(10, 12);
            const islandGround = new THREE.Mesh(new THREE.PlaneGeometry(36, 46),
                new THREE.MeshStandardMaterial({ map: gt, color: 0x5aa334, roughness: 0.92 }));
            islandGround.rotation.x = -Math.PI / 2; islandGround.position.y = -0.015;
            islandGround.receiveShadow = true; scene.add(islandGround);

            // ═══════ 2. 湖面漂浮睡蓮與荷花 (Water Lilies & Lotus Blossoms) ═══════
            lilyPads = [];
            const lilyGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.02, 16);
            const lilyMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 });
            const lotusGeo = new THREE.ConeGeometry(0.14, 0.20, 6);
            const lotusMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.6 });

            const lilyCoords = [
                { x: -11, z: -8 }, { x: -13, z: 2 }, { x: -10, z: 9 }, { x: -14, z: -14 },
                { x: 12, z: -6 }, { x: 11, z: 5 }, { x: 13, z: 12 }, { x: 10, z: -13 }
            ];
            for (let i = 0; i < lilyCoords.length; i++) {
                const pad = new THREE.Mesh(lilyGeo, lilyMat);
                pad.position.set(lilyCoords[i].x, -0.025, lilyCoords[i].z);
                pad.rotation.y = Math.random() * Math.PI * 2;
                scene.add(pad);
                if (i % 2 === 0) {
                    const flower = new THREE.Mesh(lotusGeo, lotusMat);
                    flower.position.set(lilyCoords[i].x, 0.08, lilyCoords[i].z);
                    scene.add(flower);
                }
                lilyPads.push({ mesh: pad, baseRot: pad.rotation.y, phase: i * 0.8 });
            }

            // ═══════ 3. 白色矮木柵欄 (Cute White Picket Fences) ═══════
            const fenceMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
            const fencePostGeo = new THREE.BoxGeometry(0.12, 0.72, 0.12);
            const fenceRailGeo = new THREE.BoxGeometry(0.06, 0.10, 18);
            for (const sx of [-1, 1]) {
                const fx = sx * (COURT_W / 2 + 3.8);
                // 橫木
                const railUpper = new THREE.Mesh(fenceRailGeo, fenceMat);
                railUpper.position.set(fx, 0.48, 0); railUpper.castShadow = true; scene.add(railUpper);
                const railLower = new THREE.Mesh(fenceRailGeo, fenceMat);
                railLower.position.set(fx, 0.22, 0); railLower.castShadow = true; scene.add(railLower);
                // 柱子
                for (let z = -9; z <= 9; z += 1.8) {
                    const post = new THREE.Mesh(fencePostGeo, fenceMat);
                    post.position.set(fx, 0.36, z); post.castShadow = true; scene.add(post);
                }
            }

            // ═══════ 4. 低多邊形果樹 (Low-poly Fruit Trees) ═══════
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
            const leavesMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 });
            const fruitMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
            const treeCoords = [
                { x: -10.5, z: -10 }, { x: -11.5, z: 8 },
                { x: 10.5, z: -9 }, { x: 11.0, z: 9 }
            ];
            for (const tc of treeCoords) {
                const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.30, 2.0, 8), trunkMat);
                trunk.position.set(tc.x, 1.0, tc.z); trunk.castShadow = true; scene.add(trunk);
                // 3 層樹冠
                const foliage1 = new THREE.Mesh(new THREE.SphereGeometry(1.05, 8, 8), leavesMat);
                foliage1.position.set(tc.x, 2.2, tc.z); foliage1.castShadow = true; scene.add(foliage1);
                const foliage2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 8), leavesMat);
                foliage2.position.set(tc.x, 2.9, tc.z); foliage2.castShadow = true; scene.add(foliage2);
                // 紅蘋果
                for (let a = 0; a < 3; a++) {
                    const ang = (a / 3) * Math.PI * 2;
                    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), fruitMat);
                    apple.position.set(tc.x + Math.cos(ang) * 0.85, 2.2, tc.z + Math.sin(ang) * 0.85);
                    scene.add(apple);
                }
            }

            // ═══════ 5. 側邊觀眾原木長椅與可愛加油小鴨 (Duckling Spectators on Log Benches) ═══════
            const logMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.85 });
            const duckMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 });
            const duckBeakMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
            spectatorDucklings = [];

            for (const sx of [-1, 1]) {
                const bx = sx * (COURT_W / 2 + 2.4);
                const bench = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.32, 3.6), logMat);
                bench.position.set(bx, 0.16, 0); bench.castShadow = true; scene.add(bench);

                // 2 隻觀眾小鴨坐在長椅上
                for (const dz of [-0.9, 0.9]) {
                    const duckGrp = new THREE.Group();
                    const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 10), duckMat);
                    dBody.position.y = 0.44; dBody.scale.set(0.9, 0.8, 1.1); dBody.castShadow = true; duckGrp.add(dBody);
                    const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), duckMat);
                    dHead.position.set(0, 0.60, 0.10); dHead.castShadow = true; duckGrp.add(dHead);
                    const dBeak = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.10), duckBeakMat);
                    dBeak.position.set(0, 0.58, 0.22); duckGrp.add(dBeak);
                    duckGrp.position.set(bx, 0, dz);
                    duckGrp.rotation.y = (sx > 0 ? -Math.PI / 2 : Math.PI / 2);
                    scene.add(duckGrp);
                    spectatorDucklings.push({ grp: duckGrp, baseY: 0, phase: dz * 2.0 });
                }
            }

            // ═══════ 6. 3D 看台黑板計分板 (Chalkboard) ═══════
            const scCanvas = document.createElement('canvas');
            scCanvas.width = 512; scCanvas.height = 256;
            scoreboard3DTex = new THREE.CanvasTexture(scCanvas);
            const scMat = new THREE.MeshBasicMaterial({ map: scoreboard3DTex, toneMapped: false });
            scoreboard3DMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), scMat);
            scoreboard3DMesh.position.set(0, 4.4, -(HALF_L + 7.8));
            scene.add(scoreboard3DMesh);

            // 計分板原木外框
            const scFrame = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.4, 0.18),
                new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 }));
            scFrame.position.set(0, 4.4, -(HALF_L + 7.9));
            scene.add(scFrame);

            // 支撐原木立柱
            for (const px of [-2.6, 2.6]) {
                const scPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.0, 8), trunkMat);
                scPost.position.set(px, 2.2, -(HALF_L + 7.9)); scPost.castShadow = true; scene.add(scPost);
            }

            updateScore3D();

            // ═══════ 7. 花園木樁暖色庭園燈 (Cozy Garden Lanterns) ═══════
            const woodPostMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
            const lampMat = new THREE.MeshStandardMaterial({
                color: 0xfef08a, roughness: 0.2, emissive: 0xfde047, emissiveIntensity: 0.45
            });
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const px = sx * (COURT_W / 2 + 3.4), pz = sz * (HALF_L + 2.0);
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 4.8, 8), woodPostMat);
                pole.position.set(px, 2.4, pz); pole.castShadow = true; scene.add(pole);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.55), lampMat);
                head.position.set(px, 4.8, pz); head.castShadow = true; scene.add(head);
                const roof = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.35, 4), woodPostMat);
                roof.position.set(px, 5.3, pz); roof.rotation.y = Math.PI / 4; scene.add(roof);
                const hg = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: TEX_GLOW, color: 0xffedd5,
                    transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false
                }));
                hg.position.copy(head.position); hg.scale.set(3.2, 3.2, 1); scene.add(hg);
            }
        }

        function buildCourt() {
            // ★ 1. 浮島原木甲板平台 (3D Raised Floating Wooden Deck Platform)
            // 具備實體厚度 0.28m，浮於中興湖水面 (y = -0.14)，細緻木紋板條與柔和陰影
            const woodTex = acWoodPlanksTex();
            woodTex.repeat.set(6, 14);
            const deckMat = new THREE.MeshStandardMaterial({
                map: woodTex, color: 0xdeb887, roughness: 0.78, metalness: 0.05
            });
            const deckW = COURT_W + 4.8;
            const deckL = COURT_L + 5.2;
            const deckH = 0.28;
            const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, deckH, deckL), deckMat);
            deck.position.set(0, -deckH / 2, 0);
            deck.receiveShadow = true;
            deck.castShadow = true;
            scene.add(deck);

            // ★ 2. 四周倒角原木護欄 (Beveled Wooden Curb Rims)
            const curbMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75 });
            const curbThick = 0.18, curbH = 0.09;
            for (const sx of [-1, 1]) {
                const rim = new THREE.Mesh(new THREE.BoxGeometry(curbThick, curbH, deckL), curbMat);
                rim.position.set(sx * (deckW / 2 - curbThick / 2), curbH / 2, 0);
                rim.castShadow = true; rim.receiveShadow = true; scene.add(rim);
            }
            for (const sz of [-1, 1]) {
                const rim = new THREE.Mesh(new THREE.BoxGeometry(deckW, curbH, curbThick), curbMat);
                rim.position.set(0, curbH / 2, sz * (deckL / 2 - curbThick / 2));
                rim.castShadow = true; rim.receiveShadow = true; scene.add(rim);
            }

            // ★ 3. 碼頭原木繫船柱 (Dock Wooden Bollards at Corners)
            const bollardMat = new THREE.MeshStandardMaterial({ color: 0x6e4720, roughness: 0.8 });
            const capMat = new THREE.MeshStandardMaterial({ color: 0x9a6b38, roughness: 0.6 });
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const bx = sx * (deckW / 2 - 0.26), bz = sz * (deckL / 2 - 0.26);
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.65, 12), bollardMat);
                post.position.set(bx, 0.24, bz); post.castShadow = true; scene.add(post);
                const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), capMat);
                cap.position.set(bx, 0.54, bz); cap.scale.set(1, 0.5, 1); scene.add(cap);
            }

            // ★ 外圍緩衝草皮裝飾邊框 (草坪綠 0x2e8352 與暖陶土 0xc86446 色彩規範)
            const courtTurfMat = new THREE.MeshStandardMaterial({ color: 0x2e8352, roughness: 0.88, metalness: 0.02 });
            const courtApron = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 0.36, COURT_L + 0.36), courtTurfMat);
            courtApron.rotation.x = -Math.PI / 2; courtApron.position.y = 0.0005; courtApron.receiveShadow = true; scene.add(courtApron);

            // ★ 4. 正式比賽發球區：水上湛藍湖水色 (Clear Lake Blue Service Courts)
            const courtMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.82, metalness: 0.02 });
            const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_L), courtMat);
            court.rotation.x = -Math.PI / 2; court.position.y = 0.001; court.receiveShadow = true; scene.add(court);

            // ★ 5. 廚房區 (7 FT NVZ)：清新天青藍 (Fresh Sky Blue Kitchen) 與暖陶土基線
            const kitMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.82, metalness: 0.02 });
            const kit = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, KITCHEN_D * 2), kitMat);
            kit.rotation.x = -Math.PI / 2; kit.position.y = 0.003; kit.receiveShadow = true; scene.add(kit);
            const kitBaseAccent = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, 0.04),
                new THREE.MeshBasicMaterial({ color: 0xc86446 }));
            kitBaseAccent.rotation.x = -Math.PI / 2; kitBaseAccent.position.set(0, 0.0035, 0); scene.add(kitBaseAccent);

            // ★ 3D 廚房區 (7 FT Non-Volley Zone) 清新木紋白字立體標註
            try {
                const nvzC = document.createElement('canvas'); nvzC.width = 512; nvzC.height = 128;
                const nvzX = nvzC.getContext('2d');
                nvzX.fillStyle = 'rgba(255,255,255,0.40)';
                nvzX.font = 'bold 36px "Barlow Condensed", system-ui, sans-serif';
                nvzX.textAlign = 'center';
                nvzX.fillText('7 FT · NON-VOLLEY ZONE (KITCHEN)', 256, 75);
                const nvzTex = new THREE.CanvasTexture(nvzC);
                const nvzMat = new THREE.MeshBasicMaterial({ map: nvzTex, transparent: true, opacity: 0.85 });
                const nvzM1 = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W * 0.82, 0.48), nvzMat);
                nvzM1.rotation.x = -Math.PI / 2; nvzM1.position.set(0, 0.004, KITCHEN_D * 0.5); scene.add(nvzM1);
                const nvzM2 = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W * 0.82, 0.48), nvzMat);
                nvzM2.rotation.x = -Math.PI / 2; nvzM2.rotation.z = Math.PI; nvzM2.position.set(0, 0.004, -KITCHEN_D * 0.5); scene.add(nvzM2);
            } catch(e) { console.warn('NVZ canvas marking init error', e); }

            // ★ 柔和白堊粉筆線 (Soft Chalk White Lines)
            const lm = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
            function line(w, h, x, z) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lm);
                m.rotation.x = -Math.PI / 2; m.position.set(x, 0.005, z); scene.add(m);
            }
            const lw = 0.06;
            line(COURT_W, lw, 0, HALF_L); line(COURT_W, lw, 0, -HALF_L);
            line(lw, COURT_L, COURT_W / 2, 0); line(lw, COURT_L, -COURT_W / 2, 0);
            line(COURT_W, lw, 0, KITCHEN_D); line(COURT_W, lw, 0, -KITCHEN_D);
            line(lw, HALF_L - KITCHEN_D, 0, (HALF_L + KITCHEN_D) / 2);
            line(lw, HALF_L - KITCHEN_D, 0, -(HALF_L + KITCHEN_D) / 2);

            // ★ NCHU 賽事規格 3D 廣告圍欄與匹克球社群看板 (Tournament A-Frame Signboards)
            function buildCourtSign(w, h, title, subtitle, emblem, col1, col2, x, z, rotY) {
                try {
                    const sc = document.createElement('canvas');
                    sc.width = 1024; sc.height = 256;
                    const sx = sc.getContext('2d');
                    // 底色漸層
                    const g = sx.createLinearGradient(0, 0, 1024, 0);
                    g.addColorStop(0, col1);
                    g.addColorStop(1, col2);
                    sx.fillStyle = g;
                    sx.fillRect(0, 0, 1024, 256);
                    // 運動斜切條紋裝飾
                    sx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                    for (let i = -100; i < 1100; i += 70) {
                        sx.beginPath();
                        sx.moveTo(i, 0); sx.lineTo(i + 45, 0);
                        sx.lineTo(i + 15, 256); sx.lineTo(i - 30, 256);
                        sx.fill();
                    }
                    // 溫暖日光暖金飾條
                    sx.fillStyle = '#f6c445';
                    sx.fillRect(0, 0, 1024, 8);
                    sx.fillRect(0, 248, 1024, 8);
                    // 徽章圖示
                    sx.font = '64px system-ui, sans-serif';
                    sx.textAlign = 'center';
                    sx.textBaseline = 'middle';
                    sx.fillText(emblem || '🎾', 80, 128);
                    // 主標題
                    sx.fillStyle = '#ffffff';
                    sx.font = 'bold 54px "Barlow Condensed", system-ui, sans-serif';
                    sx.textAlign = 'left';
                    sx.fillText(title, 150, 108);
                    // 副標題
                    sx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                    sx.font = '600 28px "Barlow Condensed", system-ui, sans-serif';
                    sx.fillText(subtitle, 152, 172);

                    const stex = new THREE.CanvasTexture(sc);
                    stex.anisotropy = 4;
                    const smat = new THREE.MeshStandardMaterial({
                        map: stex, roughness: 0.35, metalness: 0.15
                    });
                    // 3D 傾斜 A 字板組 (Tilted A-Board Group)
                    const grp = new THREE.Group();
                    grp.position.set(x, 0, z);
                    grp.rotation.y = rotY || 0;
                    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), smat);
                    board.position.y = (h / 2) * Math.cos(0.22);
                    board.rotation.x = -0.22; // 微微後傾 12.6 度，對向鏡頭清晰可見
                    board.castShadow = true;
                    board.receiveShadow = true;
                    grp.add(board);
                    scene.add(grp);
                } catch(e) {
                    console.warn('buildCourtSign error:', e);
                }
            }

            // 1. 左側邊線看板：NCHU 匹克球學習社群 (中興湖林蔭墨綠到球場草綠)
            buildCourtSign(4.2, 0.58, 'NCHU PICKLEBALL LEARNING COMMUNITY', '國立中興大學匹克球學習社群 · 運動科技推廣中心', '🎾', '#1b4332', '#2d6a4f', -(COURT_W / 2 + 1.25), -1.8, Math.PI / 2);
            // 2. 左側後段看板：馬格努斯流體力學實驗室 (中興湖深潭水藍)
            buildCourtSign(4.2, 0.58, 'MAGNUS EFFECT FLUID DYNAMICS LAB', '旋球流體力學 · NASA 空氣動力學專題科普', '🌪️', '#162a38', '#1e3a5f', -(COURT_W / 2 + 1.25), 1.8, Math.PI / 2);
            // 3. 右側邊線看板：國立中興大學 中興湖水上球場 (自然翠綠)
            buildCourtSign(4.2, 0.58, 'NATIONAL CHUNG HSING UNIVERSITY', '中興湖水上特訓球場 · ZHONGXING LAKE ARENA', '🌿', '#245e3d', '#40916c', (COURT_W / 2 + 1.25), -1.8, -Math.PI / 2);
            // 4. 右側後段看板：USA Pickleball 官方手冊認證 (暖陶土紅磚木色)
            buildCourtSign(4.2, 0.58, '2026 USA PICKLEBALL OFFICIAL HUB', '國際競賽規則手冊 · 虛擬裁判精準判定', '🏆', '#7c341e', '#c86446', (COURT_W / 2 + 1.25), 1.8, -Math.PI / 2);
            // 5. 對手底線後方大看板 (正對鏡頭)：中興大學匹克鵝官方錦標賽 (沉穩深邃林木綠搭配暖金字)
            buildCourtSign(6.2, 0.68, 'NCHU PICKLEBALL · 中興大學匹克鵝打秋', 'LEARNING COMMUNITY · CAMPUS LEADERBOARD ARENA', '🪿', '#142823', '#1b3a30', 0, -(HALF_L + 2.1), 0);
        }

        /* ═══════ 🧱 中興湖對牆擊球特訓木牆 (Wall Rebound Practice) ═══════ */
        function buildPracticeWall() {
            if (practiceWallMesh) return;
            const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#eddcc6'; ctx.fillRect(0, 0, 1024, 512);
            // 木紋板條
            ctx.strokeStyle = '#d8c4a9'; ctx.lineWidth = 4;
            for (let y = 0; y < 512; y += 64) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
            }
            // 0.91m 官方標準網高紅線
            const netY = Math.round(512 * (1 - 0.91 / 3.2));
            ctx.fillStyle = '#ef4444'; ctx.fillRect(0, netY - 6, 1024, 12);
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('▲ 0.91m 官方標準網高線 (NET HEIGHT) ▲', 512, netY - 10);

            // 靶心甜區
            const targetY = Math.round(512 * (1 - 1.45 / 3.2));
            ctx.strokeStyle = '#2d6a4f'; ctx.lineWidth = 8;
            ctx.beginPath(); ctx.arc(512, targetY, 80, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = 'rgba(45, 106, 79, 0.12)'; ctx.fill();
            ctx.strokeStyle = '#c86446'; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.arc(512, targetY, 40, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#c86446'; ctx.beginPath(); ctx.arc(512, targetY, 15, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2d6a4f'; ctx.font = 'bold 24px sans-serif';
            ctx.fillText('⭐ 靶心甜區 (SWEET SPOT) +2分', 512, targetY + 115);

            const tex = new THREE.CanvasTexture(c);
            const wallGeo = new THREE.BoxGeometry(COURT_W + 0.6, 3.2, 0.12);
            const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
            practiceWallMesh = new THREE.Mesh(wallGeo, wallMat);
            practiceWallMesh.position.set(0, 1.6, 0);
            practiceWallMesh.visible = false;
            practiceWallMesh.castShadow = true;
            practiceWallMesh.receiveShadow = true;
            scene.add(practiceWallMesh);
        }

        function initWallPractice() {
            isWallPractice = true;
            window.isWallPractice = true;
            wallCombo = 0;
            pScore = 0; aScore = 0;
            server = 'PLAYER';
            if (gooseServeTimer) { clearTimeout(gooseServeTimer); gooseServeTimer = null; }
            if (typeof FunMode !== 'undefined') {
                FunMode.clearAll();
                FunMode.enabled = false;
                FunMode.syncUI();
            }
            if (practiceWallMesh) practiceWallMesh.visible = true;
            if (gGrp) gGrp.visible = false;
            if (flyMesh) flyMesh.visible = false;
            if (gooseMesh) gooseMesh.visible = false;
            if (gArm) gArm.visible = false;
            if (flyDizzy) flyDizzy.visible = false;
            if (typeof updateDynamicStagePill === 'function') {
                updateDynamicStagePill(1, 0, 0);
                const sTxt = document.getElementById('dsp-stage');
                if (sTxt) sTxt.innerText = '🧱 對牆特訓 · 連擊挑戰';
            }
            toast('🧱 對牆特訓開始！', '瞄準練習牆紅線以上反覆推球抽球！');
            announceReferee('🧱 對牆特訓模式！', '向練習牆發球開始！', true);
            resetServe();
        }

        function onWallHit(x, y) {
            if (y < 0.91) {
                S.net(); addShake(0.08);
                popRing(x, 0.05, 1.8, 0xff5555);
                if (wallCombo > 0) {
                    announceReferee('⚠️ 低於網高！', `連擊中斷 (最高連擊: ${wallCombo})`, false);
                }
                wallCombo = 0;
            } else {
                wallCombo++;
                const isBullseye = Math.abs(x) < 0.8 && Math.abs(y - 1.45) < 0.45;
                if (isBullseye) {
                    S.point(); addShake(0.12);
                    popRing(x, y, 2.4, 0xf6c445);
                    pScore += 2;
                    announceReferee(`🎯 靶心命中！連擊 x${wallCombo}`, '得分 +2！手感極佳！', true);
                } else {
                    S.pop(1.0);
                    popRing(x, y, 1.8, 0x48bb78);
                    pScore += 1;
                    announceReferee(`🧱 命中！連擊 x${wallCombo}`, '連續控球中！', false);
                }
                if (typeof updateDynamicStagePill === 'function') {
                    updateDynamicStagePill(1, pScore, wallCombo);
                }
            }
        }
        window.initWallPractice = initWallPractice;
        window.onWallHit = onWallHit;

        function buildNet() {
            netGrp = new THREE.Group();
            const nc = document.createElement('canvas'); nc.width = nc.height = 32;
            const nx = nc.getContext('2d');
            nx.strokeStyle = 'rgba(245,250,255,.92)'; nx.lineWidth = 2.5;
            for (let i = 0; i <= 32; i += 8) { nx.beginPath(); nx.moveTo(i, 0); nx.lineTo(i, 32); nx.moveTo(0, i); nx.lineTo(32, i); nx.stroke(); }
            const nt = new THREE.CanvasTexture(nc);
            nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(38, 6);
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, NET_H - 0.07),
                new THREE.MeshBasicMaterial({
                    map: nt, transparent: true, opacity: 0.66,
                    side: THREE.DoubleSide, depthWrite: false
                }));
            mesh.position.y = (NET_H - 0.07) / 2; netGrp.add(mesh);
            const tape = new THREE.Mesh(new THREE.BoxGeometry(COURT_W + 0.06, 0.065, 0.035),
                new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, toneMapped: false }));
            tape.position.y = NET_H - 0.03; tape.castShadow = true; netGrp.add(tape);
            for (const sx of [-1, 1]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, NET_H + 0.06, 10),
                    new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.4, metalness: 0.5 }));
                post.position.set(sx * (COURT_W / 2 + 0.12), (NET_H + 0.06) / 2, 0);
                post.castShadow = true; netGrp.add(post);
            }
            scene.add(netGrp);
        }
        function buildBall() {
            const c = document.createElement('canvas'); c.width = 256; c.height = 128;
            const x = c.getContext('2d');
            x.fillStyle = '#eaff52'; x.fillRect(0, 0, 256, 128);
            x.fillStyle = 'rgba(60,82,10,.6)';
            for (let i = 0; i < 26; i++) {
                x.beginPath();
                x.arc((i * 59) % 256, (i * 37) % 128, 7.5, 0, Math.PI * 2);
                x.fill();
            }
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
            ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 32),
                new THREE.MeshStandardMaterial({
                    map: t, roughness: 0.32, metalness: 0.02,
                    emissive: 0x93b800, emissiveIntensity: 0.14
                }));
            ball.castShadow = true;
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
            for (let i = 0; i < 22; i++) {
                const s = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: TEX_GLOW, color: 0xdcff6a,
                    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
                }));
                scene.add(s); ballTrail.push({ spr: s, p: new THREE.Vector3() });
            }
            ballBlob = new THREE.Sprite(new THREE.SpriteMaterial({
                map: TEX_BLOB, transparent: true,
                opacity: 0.5, depthWrite: false
            }));
            ballBlob.center.set(0.5, 0.5); scene.add(ballBlob);
        }
        function limb(mesh, from, to) {
            const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
            mesh.position.set(from.x + dx * 0.5, from.y + dy * 0.5, from.z + dz * 0.5);
            _q.setFromUnitVectors(UPY, _c.set(dx / len, dy / len, dz / len));
            mesh.quaternion.copy(_q); mesh.scale.set(1, len, 1);
        }
        let pTorso = null, pLegs = null, pHead = null, pLeftArm = null, pCap = null;
        function buildSteve() {
            pGrp = new THREE.Group();
            const skin = new THREE.MeshStandardMaterial({ color: 0xfce5cd, roughness: 0.6 });
            const shirt = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.5 }); // Mint turquoise polo
            const pants = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.66 }); // Cobalt shorts
            const shoes = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }); // White sneakers

            // 1. 圓潤風格上身 Polo 衫 (Chibi Torso)
            pTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.56, 14), shirt);
            pTorso.position.y = 0.82; pTorso.castShadow = true; pGrp.add(pTorso);

            // Polo 領口
            const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 14), shirt);
            collar.rotation.x = Math.PI / 2; collar.position.set(0, 1.08, 0); pGrp.add(collar);

            // 2. 短褲與運動鞋腿部 (Shorts & Sneakers)
            pLegs = new THREE.Group();
            pLegs.position.y = 0.26;
            for (const sx of [-0.11, 0.11]) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 10), pants);
                leg.position.set(sx, 0.12, 0); leg.castShadow = true; pLegs.add(leg);
                const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.19), shoes);
                shoe.position.set(sx, -0.06, 0.03); shoe.castShadow = true; pLegs.add(shoe);
            }
            pGrp.add(pLegs);

            // 3. 圓萌 Chibi 頭部 (Chibi Head with Sparkling Anime Eyes & Rosy Cheeks)
            const headTex = acFaceTex();
            pHead = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 20),
                new THREE.MeshStandardMaterial({ map: headTex, roughness: 0.55 }));
            pHead.position.y = 1.30; pHead.castShadow = true; pGrp.add(pHead);

            // 4. 經典遮陽帽 (Sun Visor Cap)
            pCap = new THREE.Group();
            const capCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.08, 16),
                new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.4 }));
            capCrown.position.y = 1.44; capCrown.castShadow = true; pCap.add(capCrown);
            const capBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.025, 16, 1, false, -Math.PI * 0.32, Math.PI * 0.64),
                new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.4, side: THREE.DoubleSide }));
            capBrim.rotation.x = 0.15; capBrim.position.set(0, 1.41, 0.10); capBrim.castShadow = true; pCap.add(capBrim);
            pGrp.add(pCap);

            // 5. 左手臂 (Left Arm)
            pLeftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.50, 10), shirt);
            pLeftArm.position.set(-0.27, 0.82, 0.02); pLeftArm.rotation.z = 0.16; pLeftArm.castShadow = true; pGrp.add(pLeftArm);

            // 6. 右手臂與球拍 (Right Arm & Paddle with AC Leaf Logo)
            pArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.0, 10), skin);
            pArm.castShadow = true; pGrp.add(pArm);

            pPad = new THREE.Group();
            const padMat = new THREE.MeshStandardMaterial({ map: acPaddleTex(), roughness: 0.32, metalness: 0.05 });
            const face = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.36, 0.035), padMat);
            face.position.y = 0.18; face.castShadow = true; pPad.add(face);
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.38, 0.02),
                new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.5 }));
            edge.position.set(0, 0.18, -0.012); pPad.add(edge);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.055),
                new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.8 }));
            grip.position.y = -0.055; pPad.add(grip);
            pPad.scale.setScalar(2.175); pGrp.add(pPad); // ★ 球拍放大 1.5 倍 (1.45 * 1.5 = 2.175)
            scene.add(pGrp);
        }

        let gooseEmoteSprite = null, gooseEmoteCanvas = null, gooseEmoteTex = null, gooseEmoteTimer = 0;
        function updateGooseEmote(emoji) {
            try {
                if (!gooseEmoteCanvas) {
                    gooseEmoteCanvas = document.createElement('canvas');
                    gooseEmoteCanvas.width = 128; gooseEmoteCanvas.height = 128;
                    gooseEmoteTex = new THREE.CanvasTexture(gooseEmoteCanvas);
                    const mat = new THREE.SpriteMaterial({ map: gooseEmoteTex, transparent: true, depthWrite: false });
                    gooseEmoteSprite = new THREE.Sprite(mat);
                    gooseEmoteSprite.scale.set(1.05, 1.05, 1);
                    scene.add(gooseEmoteSprite);
                }
                const ctx = gooseEmoteCanvas.getContext('2d');
                ctx.clearRect(0, 0, 128, 128);
                if (!emoji) {
                    if (gooseEmoteSprite) gooseEmoteSprite.visible = false;
                    return;
                }
                // 繪製圓角對話氣泡 (Cute Speech Bubble)
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = 'rgba(0,0,0,0.22)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.roundRect(14, 14, 100, 78, 18);
                ctx.fill();
                // 下方尖角
                ctx.beginPath();
                ctx.moveTo(54, 92); ctx.lineTo(64, 112); ctx.lineTo(74, 92); ctx.fill();
                ctx.shadowBlur = 0;
                // Emoji
                ctx.font = '44px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(emoji, 64, 53);
                if (gooseEmoteTex) gooseEmoteTex.needsUpdate = true;
                if (gooseEmoteSprite) gooseEmoteSprite.visible = true;
                gooseEmoteTimer = 2.2;
            } catch (e) {
                console.warn('updateGooseEmote error safely caught:', e);
            }
        }

        function buildCreeper() {
            gGrp = new THREE.Group();
            gooseMesh = new THREE.Group();
            const gs = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }); // Clean white goose feathers
            const bk = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 }); // Bright orange beak & feet
            const visorMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 }); // Mayor red visor
            const bandanaMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5 }); // Turquoise neck bandana

            // 1. 胖嘟嘟圓潤鵝身體 (Plump Goose Body)
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 16), gs);
            body.position.y = 0.54; body.scale.set(0.92, 0.95, 1.25);
            body.castShadow = true; gooseMesh.add(body);

            // 2. 優雅圓柱頸部 (Goose Neck)
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.44, 12), gs);
            neck.position.set(0, 0.95, 0.18); neck.castShadow = true; gooseMesh.add(neck);

            // 3. 村長鵝湖水綠領巾 (Turquoise Mayor Bandana)
            const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.038, 8, 14), bandanaMat);
            bandana.rotation.x = Math.PI / 2; bandana.position.set(0, 0.82, 0.17); gooseMesh.add(bandana);

            // 4. 可愛圓圓鵝頭 (Cute Goose Head with acGooseFaceTex)
            const gHeadTex = acGooseFaceTex();
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16),
                new THREE.MeshStandardMaterial({ map: gHeadTex, roughness: 0.45 }));
            head.position.set(0, 1.26, 0.20); head.castShadow = true; gooseMesh.add(head);

            // 5. 村長紅色遮陽帽 (Mayor Red Visor Cap)
            const gVisor = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.06, 14), visorMat);
            gVisor.position.set(0, 1.39, 0.20); gVisor.castShadow = true; gooseMesh.add(gVisor);
            const gBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14, 1, false, -Math.PI * 0.32, Math.PI * 0.64),
                new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35, side: THREE.DoubleSide }));
            gBrim.rotation.x = 0.16; gBrim.position.set(0, 1.36, 0.29); gooseMesh.add(gBrim);

            // 6. 鮮橘色鵝喙 (Orange Beak)
            const beak = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.22, 10), bk);
            beak.rotation.x = Math.PI / 2; beak.position.set(0, 1.20, 0.42); gooseMesh.add(beak);

            // 7. 橘色蹼足 (Webbed Feet)
            for (const sx of [-0.15, 0.15]) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 8), bk);
                leg.position.set(sx, 0.14, 0); leg.castShadow = true; gooseMesh.add(leg);
                const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.20), bk);
                foot.position.set(sx, 0.02, 0.05); foot.castShadow = true; gooseMesh.add(foot);
            }
            gGrp.add(gooseMesh);

            // ═══════ 仿生蒼蠅 3D 輕量模型 (Bio-inspired Fly Opponent Mesh) ═══════
            flyMesh = new THREE.Group();
            const chitinMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.25, metalness: 0.85 });
            const eyeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xa855f7, emissiveIntensity: 0.55, roughness: 0.1, metalness: 0.9 });
            const wingMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.65, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide });
            window.flyMaterials = { chitin: chitinMat, eye: eyeMat, wing: wingMat };

            // 蒼蠅腹部 (Abdomen)
            const fAbdomen = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), chitinMat);
            fAbdomen.scale.set(0.9, 0.85, 1.35); fAbdomen.position.set(0, 0.80, -0.25);
            fAbdomen.castShadow = true; flyMesh.add(fAbdomen);

            // 蒼蠅胸部 (Thorax)
            const fThorax = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), chitinMat);
            fThorax.position.set(0, 0.86, 0.08); fThorax.castShadow = true; flyMesh.add(fThorax);

            // 蒼蠅頭部 (Head)
            const fHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), chitinMat);
            fHead.position.set(0, 0.90, 0.30); fHead.castShadow = true; flyMesh.add(fHead);

            // 巨型紅色複眼 (Compound Eyes - High-speed Optical Motion Detectors)
            const fEyeL = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 12), eyeMat);
            fEyeL.position.set(-0.11, 0.95, 0.38); flyMesh.add(fEyeL);
            const fEyeR = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 12), eyeMat);
            fEyeR.position.set(0.11, 0.95, 0.38); flyMesh.add(fEyeR);

            // 高頻震動雙翼 (Buzzing Wings)
            flyWings = [];
            const wGeo = new THREE.PlaneGeometry(0.38, 0.72);
            for (const side of [-1, 1]) {
                const wPivot = new THREE.Group();
                wPivot.position.set(side * 0.16, 1.02, -0.02);
                const blade = new THREE.Mesh(wGeo, wingMat);
                blade.position.set(side * 0.18, 0, -0.32);
                blade.rotation.x = Math.PI / 2 - 0.15;
                blade.rotation.z = side * 0.25;
                wPivot.add(blade);
                flyMesh.add(wPivot);
                flyWings.push({ pivot: wPivot, side });
            }

            // 6 隻微型足肢 (Legs)
            const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
            for (const lx of [-0.18, 0.18]) {
                for (const lz of [-0.15, 0.05, 0.25]) {
                    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.04), legMat);
                    leg.position.set(lx, 0.68, lz);
                    leg.rotation.z = (lx < 0 ? 0.35 : -0.35);
                    flyMesh.add(leg);
                }
            }

            // 暈眩光環 / 星星 (Stun Stars Indicator)
            flyDizzy = new THREE.Group();
            flyDizzy.position.set(0, 1.35, 0.25);
            for (let i = 0; i < 3; i++) {
                const ang = (i / 3) * Math.PI * 2;
                const star = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8),
                    new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
                star.position.set(Math.cos(ang) * 0.26, 0, Math.sin(ang) * 0.26);
                flyDizzy.add(star);
            }
            flyDizzy.visible = false;
            flyMesh.add(flyDizzy);

            flyMesh.visible = false;
            gGrp.add(flyMesh);

            gArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), gs);
            gArm.castShadow = true; gGrp.add(gArm);
            gPad = new THREE.Group();
            const gf = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.36, 0.035),
                new THREE.MeshStandardMaterial({ color: 0xd9ff5c, roughness: 0.32 }));
            gf.position.y = 0.18; gf.castShadow = true; gPad.add(gf);
            const ge = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.38, 0.02),
                new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: 0.5 }));
            ge.position.set(0, 0.18, 0.012); gPad.add(ge);
            gPad.scale.setScalar(2.175); gGrp.add(gPad); // ★ 對手球拍同步放大 1.5 倍
            scene.add(gGrp);
            updateOpponentMeshVisibility();
        }
        function buildGuides() {
            zoneServe = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W / 2 - 0.06, HALF_L - KITCHEN_D - 0.06),
                new THREE.MeshBasicMaterial({
                    color: 0x3fe0c4, transparent: true, opacity: 0.24,
                    side: THREE.DoubleSide, depthWrite: false
                }));
            zoneServe.rotation.x = -Math.PI / 2;
            zoneServe.position.set(-COURT_W / 4, 0.008, -(HALF_L + KITCHEN_D) / 2);
            scene.add(zoneServe);
            arc = new THREE.Line(new THREE.BufferGeometry(),
                new THREE.LineDashedMaterial({
                    color: 0xffc857, dashSize: 0.22, gapSize: 0.14,
                    transparent: true, opacity: 0.95
                }));
            scene.add(arc);
            ringLand = new THREE.Group();
            const rOut = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40),
                new THREE.MeshBasicMaterial({
                    color: 0xffc857, side: THREE.DoubleSide,
                    transparent: true, opacity: 1, depthWrite: false
                }));
            rOut.rotation.x = -Math.PI / 2; ringLand.add(rOut);
            const rIn = new THREE.Sprite(new THREE.SpriteMaterial({
                map: TEX_GLOW, color: 0xffc857,
                transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            rIn.scale.set(0.95, 0.95, 1); rIn.position.y = 0.01; ringLand.add(rIn);
            ringLand.userData = { out: rOut, glow: rIn }; ringLand.position.y = 0.016;
            scene.add(ringLand);
            ringSpot = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 40),
                new THREE.MeshBasicMaterial({
                    color: 0x4f8dff, side: THREE.DoubleSide,
                    transparent: true, opacity: 0.9, depthWrite: false
                }));
            ringSpot.rotation.x = -Math.PI / 2; ringSpot.position.set(1.5, 0.014, HALF_L + 0.35);
            ringSpot.visible = false; scene.add(ringSpot);
            warnKitchen = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, KITCHEN_D),
                new THREE.MeshBasicMaterial({
                    color: 0xff2d2d, transparent: true, opacity: 0,
                    side: THREE.DoubleSide, depthWrite: false
                }));
            warnKitchen.rotation.x = -Math.PI / 2; warnKitchen.position.set(0, 0.006, KITCHEN_D / 2);
            scene.add(warnKitchen);
        }
        function buildRingPool() {
            for (let i = 0; i < 8; i++) {
                const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 30),
                    new THREE.MeshBasicMaterial({
                        color: 0xffffff, transparent: true, opacity: 0,
                        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
                    }));
                m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
                rings.push({ m: m, t: 0, life: 0, s1: 3 });
            }
        }
        function popRing(x, z, s1, col) {
            for (const r of rings) {
                if (r.life <= 0) {
                    r.m.position.set(x, 0.02, z);
                    r.life = 0.55; r.t = 0; r.s1 = s1 || 3;
                    r.m.material.color.setHex(col || 0xffffff);
                    r.m.visible = true; return;
                }
            }
        }
        function updateRings(dt) {
            for (const r of rings) {
                if (r.life <= 0) continue;
                r.t += dt;
                const k = Math.min(1, r.t / r.life), s = 0.6 + k * r.s1;
                r.m.scale.set(s, s, 1);
                r.m.material.opacity = (1 - k) * 0.7;
                if (k >= 1) { r.life = 0; r.m.visible = false; }
            }
        }
        function addShake(v) { shake = Math.min(0.5, shake + v); }
/* 真空彈道解算（原版邏輯） */
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
/* 對外介面：學術模式下以打靶法修正阻力與側旋的影響 */
function solveArc(fx, fy, fz, tx, tz, out, speedScale) {
    const ok = solveArcVacuum(fx, fy, fz, tx, tz, out, speedScale);
    if (currentPhysicsMode !== PHYSICS_MODES.ACADEMIC) return ok;
    return refineArcAcademic(fx, fy, fz, tx, tz, out);
}


/* ═══════ 互動示範模式 (Interactive Demo Sequence) ═══════ */

        /* ═══════ 示範 ═══════ */
        let demoOn = false, demoHold = true;
        let dSteps = [], dIdx = 0, dClock = 0, dEnd = 0, dFlash = 0;
        const dSeen = {};
        const dWalk = { x: 1.5, z: HALF_L + 0.35 }, dPad = { x: 0.34, y: 0.74 }, dGoose = { x: 0, z: -HALF_L - 0.5 }, dDemoTgt = { x: -1.5, z: -4.8 };
        function dMove(x, z) { dWalk.x = x; dWalk.z = z; }
        function dPaddle(x, y) { dPad.x = x; dPad.y = y; }
        function dG(x, z) { dGoose.x = x; dGoose.z = z; }
        function ballOnPad() { PH.setPos(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06); }
        function dHit(tx, tz, spin) {
            demoHold = false; dDemoTgt.x = tx; dDemoTgt.z = tz; ballOnPad();
            PH.spin = (typeof spin === 'number') ? spin : 0; PH.spinInc = 0;
            solveArc(PH.pos.x, PH.pos.y, PH.pos.z, tx, tz, PH.vel); S.pop(0.6);
        }
        function dGHit(tx, tz) {
            demoHold = false; dDemoTgt.x = tx; dDemoTgt.z = tz;
            PH.setPos(gPadW.x, Math.max(BALL_R, gPadW.y), gPadW.z + 0.06);
            solveArc(PH.pos.x, PH.pos.y, PH.pos.z, tx, tz, PH.vel); S.pop(0.55);
        }
        function dBad() { S.fault(); dFlash = 1; addShake(0.18); }
        function dCap(main, tag) { if (main) D.dCap.innerText = main; if (tag) D.dTag.innerText = '🎬 ' + tag; }
        function buildDemo(st) {
            const A = [], add = (at, main, tag, fn) => A.push({ at: at, main: main, tag: tag, do: fn });
            const back = HALF_L + 0.35;
            if (st === 1) {
                add(0.0, '發球預備: 雙腳在底線後，球拍自然就位', 'STEP 1 站位預備', () => { dMove(1.5, back); dPaddle(0.34, 0.74); dDemoTgt.x = -1.5; dDemoTgt.z = -4.8; });
                add(1.0, '👆 向上滑動推拍: 球拍由下往上推球', 'STEP 2 向上推拍', () => { dPaddle(0.31, 0.60); });
                add(2.8, '拍面低於腰部向上直推，將球對角送進綠區！', 'STEP 3 直推發球', () => { dHit(-1.5, -4.8, 0); });
                add(4.5, '球落入綠色對角區即成功過關！點擊任意處開始', '通關重點');
            } else if (st === 2) {
                add(0.0, '先正常對角發球過網', 'STEP 1 發球', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.6; dDemoTgt.z = -4.8; });
                add(1.4, null, null, () => dHit(-1.6, -4.8));
                add(3.4, '匹克鵝回擊一顆底線深球', 'STEP 2 對手深球', () => { dG(-1.4, -3.2); dDemoTgt.x = 1.2; dDemoTgt.z = 5.8; });
                add(4.2, null, null, () => dGHit(1.2, 5.8));
                add(5.2, '⚠️ 核心法則: 接發球必須等球落地彈跳一次！', 'STEP 3 等球落地', () => { dMove(1.2, 6.0); dPaddle(0.27, 0.54); dDemoTgt.x = -1.2; dDemoTgt.z = -3.6; });
                add(7.8, '落地彈起後平穩回擊，完成雙彈跳規則！', 'STEP 4 合法回擊', () => { dHit(-1.2, -3.6); });
                add(10.0, '雙方各落地一次後，方開放凌空截擊', '雙彈跳核心');
            } else if (st === 3) {
                add(0.0, '中興湖畔 7 呎廚房非截擊區 (Kitchen)', 'STEP 1 網前規則', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.6; dDemoTgt.z = -4.8; });
                add(1.4, null, null, () => dHit(-1.6, -4.8));
                add(3.4, '匹克鵝把球輕吊進廚房區', 'STEP 2 對手吊球', () => { dG(-1.2, -3.0); dDemoTgt.x = 0.8; dDemoTgt.z = 1.35; });
                add(4.2, null, null, () => dGHit(0.8, 1.35));
                add(5.6, '❌ 球未落地就在廚房內揮拍 = KITCHEN FAULT 犯規', '錯誤示範', () => { dMove(0.8, 1.5); dPaddle(0.29, 1.0); dBad(); });
                add(7.4, '✅ 正確做法: 耐心等球落地彈起後再輕推 (Dink)', '正確做法', () => { dPaddle(0.25, 0.48); dDemoTgt.x = -0.9; dDemoTgt.z = -1.7; });
                add(9.2, '落地後輕推小球安全過網，成功通關！', 'STEP 3 廚房輕推', () => { dHit(-0.9, -1.7); });
                add(11.4, '廚房區落地後方可入內擊球', '通關重點');
            } else if (st === 4) {
                add(0.0, '對決關卡: 先得 3 分者獲勝', 'STEP 1 對決匹克鵝', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.6; dDemoTgt.z = -4.8; });
                add(1.6, null, null, () => dHit(-1.6, -4.8));
                add(3.4, '前兩拍仍要遵守雙彈跳規則', 'STEP 2 雙彈跳', () => { dG(-1.4, -3.2); dDemoTgt.x = 1.2; dDemoTgt.z = 5.2; });
                add(4.2, null, null, () => dGHit(1.2, 5.2));
                add(5.6, '落地後回擊,再推進到廚房線前', 'STEP 3 推進', () => { dMove(1.2, 5.4); dPaddle(0.29, 0.58); dDemoTgt.x = -1.2; dDemoTgt.z = -2.6; });
                add(7.6, null, null, () => dHit(-1.2, -2.6));
                add(10.0, '贏得 3 分即可挑戰魔王關', '重點');
            } else {
                add(0.0, '🔥 中興湖魔王-匹克鵝戰!', 'STAGE 5 魔王戰', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.5; dDemoTgt.z = -4.8; });
                add(2.0, '小心被追著咬!全力回擊!', '魔王戰');
                add(5.0, '全力揮拍擊敗魔王,將系級與暱稱寫入興大英雄榜!', '通關榮譽');
            }
            return A;
        }
        function startDemo(st) {
            clearTimers();
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            demoOn = true; locked = true; demoHold = true; state = 'DEMO';
            document.body.classList.add('demo-mode-active');
            dIdx = 0; dClock = 0; dFlash = 0;
            charging = false; power = 0; powerDir = 1; D.pFill.style.width = '0%';
            rallyHits = 0; bounces = 0; lastHitter = 'NONE';
            dMove(1.5, HALF_L + 0.35); dPaddle(0.34, 0.74); dG(0, -HALF_L - 0.5);
            dDemoTgt.x = -1.5; dDemoTgt.z = -4.8;
            pPos.x = dWalk.x; pPos.z = dWalk.z; gGrp.position.set(dGoose.x, 0, dGoose.z);
            dSteps = buildDemo(st); dEnd = dSteps[dSteps.length - 1].at + 2.4;
            dCap('準備開始示範…', 'STAGE ' + st);
            D.demo.style.display = 'block';
            const wm = document.getElementById('demo-watermark'); if (wm) wm.style.display = 'block';
        }
        function endDemo() {
            demoOn = false; locked = false; demoHold = true; dFlash = 0;
            D.demo.style.display = 'none';
            const wm = document.getElementById('demo-watermark'); if (wm) wm.style.display = 'none';
            warnKitchen.material.opacity = 0; resetServe();
            document.body.classList.remove('demo-mode-active');
            dismissFingerTutorial(true);
            toast('🎾 輪到你了！', '向上滑動推球發球');
        }
        function skipDemo() { if (demoOn) { clearTimers(); endDemo(); } }
        function replayDemo() { closePanel(); startDemo(stage); }

        let helpCollapsed = false;
        
        
        /* ═══════════════════════════════════════════════
           🛠️ v4.1.3 選單分層、折疊與個人資料增強模組
           ═══════════════════════════════════════════════ */
        function openSettingsSub(sub) {
            const l1 = document.getElementById('settings-l1');
            const l2Game = document.getElementById('settings-l2-game');
            const l2Motion = document.getElementById('settings-l2-motion');
            const l2Profile = document.getElementById('settings-l2-profile');
            const l2Twin = document.getElementById('settings-l2-twin');

            if (l1) l1.style.display = (sub === 'main') ? 'flex' : 'none';
            if (l2Game) l2Game.style.display = (sub === 'game') ? 'flex' : 'none';
            if (l2Motion) l2Motion.style.display = (sub === 'motion') ? 'flex' : 'none';
            if (l2Profile) l2Profile.style.display = (sub === 'profile') ? 'flex' : 'none';
            if (l2Twin) l2Twin.style.display = (sub === 'twin') ? 'flex' : 'none';
        }

        function toggleInfoCollapse() {
            // 已固定精簡縮小狀態，移除展開/收折行為
        }

        // ★ 預設收合底端操作面板 (保留視野乾淨清爽)
        let bottomCollapsed = true;
        try {
            const savedBottom = localStorage.getItem('nchu_pb_bottom_collapsed');
            if (savedBottom !== null) bottomCollapsed = (savedBottom === 'true');
        } catch(e) {}

        function syncBottomCollapseUI() {
            const el = document.getElementById('bottom');
            const icon = document.getElementById('mini-toggle-icon');
            if (!el) return;
            if (bottomCollapsed) {
                el.classList.add('collapsed');
                if (icon) icon.innerText = '▸';
            } else {
                el.classList.remove('collapsed');
                if (icon) icon.innerText = '▾';
            }
        }

        function toggleBottomCollapse() {
            bottomCollapsed = !bottomCollapsed;
            try { localStorage.setItem('nchu_pb_bottom_collapsed', bottomCollapsed); } catch(e) {}
            syncBottomCollapseUI();
        }

        function toggleKeysCollapse() {
            const k = document.getElementById('keys');
            if (k) toggleHelpCollapse();
        }

        function toggleHelpCollapse() {
            helpCollapsed = !helpCollapsed;
            const full = document.getElementById('keys-full');
            const mini = document.getElementById('keys-mini');
            if (full && mini) {
                full.style.display = helpCollapsed ? 'none' : 'block';
                mini.style.display = helpCollapsed ? 'block' : 'none';
            }
        }
        function demoActors(dt) {
            const k = 1 - Math.pow(0.004, dt);
            pPos.x += (dWalk.x - pPos.x) * k; pPos.z += (dWalk.z - pPos.z) * k;
            pGrp.position.set(pPos.x, 0, pPos.z);
            padX += (dPad.x - padX) * k; padY += (dPad.y - padY) * k;
            pPad.position.set(padX, padY, -0.24);
            pPad.rotation.set(-0.24, 0, -padX * 0.5);
            pPad.getWorldPosition(padW);
            limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
            if (gGrp.visible) {
                gGrp.position.x += (dGoose.x - gGrp.position.x) * k;
                gGrp.position.z += (dGoose.z - gGrp.position.z) * k;
                gGrp.rotation.y = Math.PI;
                const py = THREE.MathUtils.clamp(PH.pos.y, 0.3, 1.4);
                const lx = THREE.MathUtils.clamp(PH.pos.x - gGrp.position.x, -0.8, 0.8);
                gPad.position.set(-lx, py, -0.34); gPad.rotation.set(0.24, 0, 0);
                gPad.getWorldPosition(gPadW);
                limb(gArm, _b.set(0.18, 0.85, -0.05), _a.set(-lx, py - 0.17, -0.34));
            }
            if (demoHold) PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
        }
        function runDemo(dt) {
            dClock += dt;
            if (dFlash > 0) dFlash = Math.max(0, dFlash - dt * 0.5);
            while (dIdx < dSteps.length && dClock >= dSteps[dIdx].at) {
                const s = dSteps[dIdx++]; dCap(s.main, s.tag); if (s.do) s.do();
            }
            demoActors(dt);
            if (dClock >= dEnd) endDemo();
        }
        function switchStage(n, opts) {
            if (typeof stageAdvanceTimer !== 'undefined' && stageAdvanceTimer) {
                clearTimeout(stageAdvanceTimer);
                stageAdvanceTimer = null;
            }
            clearTimers();
            if (typeof restoreTwinParams === 'function' && !(opts && opts.keepTwin)) restoreTwinParams();
            if (typeof FunMode !== 'undefined') FunMode.usedForcedItem = false;
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            demoOn = false; D.demo.style.display = 'none';
            const wm = document.getElementById('demo-watermark'); if (wm) wm.style.display = 'none';
            document.body.classList.remove('demo-mode-active');
            if (typeof dismissFingerTutorial === 'function') dismissFingerTutorial(true);
            stage = n;
            isWallPractice = false;
            window.isWallPractice = false;
            if (practiceWallMesh) practiceWallMesh.visible = false;
            document.querySelectorAll('[data-stage]').forEach(b => b.classList.toggle('on', +b.dataset.stage === n));
            closePanel();
            D.chip.innerText = 'STAGE ' + n;
            D.name.innerText = STAGES[n].name; D.sub.innerText = STAGES[n].sub; D.desc.innerText = STAGES[n].desc;
            pScore = 0; aScore = 0; legalServes = 0; twoBounceDone = 0; serveSide = 1; server = 'PLAYER'; secondServe = false; locked = false;
            updateScore(); updateGoal();
            if (typeof updateDynamicStagePill === 'function') updateDynamicStagePill(n, pScore, aScore);
            if (gGrp) {
                gGrp.visible = true;
                gGrp.position.set(0, 0, -HALF_L - 0.5);
            }

            // ★ 🍄 道具戰關卡管理 (前4關鎖定停用，第5關魔王自由開關，第6關常駐開啟)
            if (typeof FunMode !== 'undefined') {
                if (n === 6) {
                    FunMode.enabled = true;
                    FunMode.hasSpawnedFirstFlyBox = false;
                    FunMode.pityNonSwatterCount = 0;
                    FunMode.consecutiveDebuffCount = 0;
                    FunMode.spawnCooldown = 0.8;
                    FunMode.syncUI();
                    if (diffLevel !== 'fly' && typeof setDifficulty === 'function') {
                        setDifficulty('fly');
                    }
                } else if (n <= 4) {
                    FunMode.enabled = false;
                    FunMode.clearAll();
                    FunMode.syncUI();
                } else if (n === 5) {
                    FunMode.syncUI();
                }
            }

            updateOpponentMeshVisibility();
            warnKitchen.material.opacity = 0;
            const isAdvance = !!(opts && opts.fromClear);
            const showDemo = !!(opts && opts.showDemo);
            // ★ 永遠優先讓玩家親自操作，手上永遠有球！只有點擊「觀看示範」時才啟動 startDemo
            if (showDemo) {
                dSeen[n] = true;
                startDemo(n);
            } else {
                dSeen[n] = true;
                resetServe();
                const stageHints = {
                    1: '向上滑動推拍，將球對角發進綠區即過關！',
                    2: '雙彈跳規則：發球過網，等匹克鵝回球落地彈起再打回去！',
                    3: '廚房區攻防：等球在廚房落地彈起後輕推小球過網！',
                    4: '綜合對決：發球得分制，先得 3 分過關！',
                    5: '魔王對決：全力揮拍擊敗中興湖魔王匹克鵝！',
                    6: '瘋狂道具戰：拾取盲盒神裝，稱霸全場！'
                };
                toast('🎯 STAGE ' + n + '：' + STAGES[n].name, stageHints[n] || STAGES[n].desc);
            }
        }
        let gooseServeTimer = null;
        function resetServe() {
            if (gooseServeTimer) { clearTimeout(gooseServeTimer); gooseServeTimer = null; }
            state = 'SERVE_READY';
            rallyHits = 0; bounces = 0; lastHitter = 'NONE';
            pLock = 0; gLock = 0; swingT = 0;
            charging = false; power = 0; powerDir = 1; locked = false; powerBarDisplay = 0;
            servePrepared = !webcamActive; calibT0 = 0; serveCooldown = 0.5;
            resetServeFSM(); kcReset();

            dinkRallyCount = 0;
            isChanceBall = false;

            if (typeof diffLevel !== 'undefined' && diffLevel === 'fly') {
                flyState = 'HOVER'; flyStunTimer = 0;
                if (flyMesh) flyMesh.rotation.z = 0;
                if (flyDizzy) flyDizzy.visible = false;
            }

            // 🍄 回合重置時，若 buff 已結束或不在娛樂模式，強制確保球拍縮放復原
            if (typeof FunMode !== 'undefined' && (!FunMode.activeBuff || !FunMode.enabled)) {
                FunMode.clearPlayerBuff();
            }

            if (server === 'PLAYER') {
                pPos.x = 1.5 * serveSide; pPos.z = HALF_L + 0.35;
                serveFromRight = pPos.x >= 0;
                aiTo.x = 0; aiTo.z = -HALF_L - 0.5;
                // ★ 關鍵：在 resetServe 當下立即將球精確重置在玩家球拍旁，手上有球絕不漏發！
                pPad.position.set(padX, padY, -0.24);
                pPad.getWorldPosition(padW);
                PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
                AIM.idx = 2; AIM.cand = 2; AIM.dwell = 0; syncAimPips();
                if (webcamActive) document.getElementById('calibration-box').style.display = 'flex';
                D.pFill.style.width = '0%';
                const whoOpp = (typeof diffLevel !== 'undefined' && diffLevel === 'fly') ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';
                const hints = webcamActive ? {
                    1: '左手舉高解鎖 → 拍面低於腰 → 向上推拍 → 收拍抬過肩',
                    2: '左手舉高預備 → ' + whoOpp + '回深球 → 讓球落地一次再回擊',
                    3: '左手舉高預備 → ' + whoOpp + '吊球進廚房 → 等球落地再輕推 1 次',
                    4: '對決 ' + whoOpp + ' (發球得分制, 先得 3 分勝)',
                    5: '🔥 中興湖魔王戰! (發球得分制, 搶 5 分登錄英雄榜)',
                    6: '🍄 瘋狂道具大亂鬥! (踩盲盒搶神裝/防踩雷, 先得 5 分勝)'
                } : {
                    1: '向上滑動推球發球，雙腳在底線後，對角送進綠區',
                    2: '發球進對角區 → ' + whoOpp + '回深球 → 讓球落地一次再回擊',
                    3: '發球進對角區 → ' + whoOpp + '吊球進廚房 → 等球落地再輕推 1 次',
                    4: '對決 ' + whoOpp + ' (發球得分制, 先得 3 分勝)',
                    5: '🔥 中興湖魔王戰! (發球得分制, 搶 5 分登錄英雄榜)',
                    6: '🍄 瘋狂道具大亂鬥! (踩盲盒搶神裝/防踩雷, 先得 5 分勝)'
                };
                toast('READY · 玩家發球', hints[stage] + (stage >= 4 ? (' · ' + (secondServe ? '2nd' : '1st') + ' Serve') : ''));
            } else {
                // 匹克鵝/蒼蠅發球:玩家站到對角落點側接發球
                pPos.x = 1.5 * serveSide; pPos.z = HALF_L + 0.45;
                serveFromRight = false;
                gGrp.position.set(-1.5 * serveSide, 0, -HALF_L - 0.35);
                aiTo.x = -1.5 * serveSide; aiTo.z = -HALF_L - 0.35;
                if (webcamActive) document.getElementById('calibration-box').style.display = 'none';
                D.pFill.style.width = '0%';
                const whoName = (typeof diffLevel !== 'undefined' && diffLevel === 'fly') ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';
                toast(whoName + ' 發球中 (' + (secondServe ? '2nd' : '1st') + ' Serve)', '站好底線,等球在對角區落地一次後回擊');
                gooseServeTimer = later(gooseDoServe, 1600);
            }
            updateGoal();
        }

        function gooseDoServe() {
            if (isWallPractice || state !== 'SERVE_READY' || server !== 'GOOSE' || demoOn) return;
            const isFly = (typeof diffLevel !== 'undefined' && diffLevel === 'fly');
            PH.setPos(gGrp.position.x, 0.80, gGrp.position.z + 0.30);
            state = 'SERVE_AIR'; lastHitter = 'GOOSE';
            rallyHits = 1; bounces = 0; gLock = 0.3; pLock = 0;
            const targetX = 1.4 * serveSide, targetZ = 2.6 + Math.random() * 1.6;
            solveArc(PH.pos.x, PH.pos.y, PH.pos.z, targetX, targetZ, PH.vel);
            S.pop(0.65);
            if (isFly) {
                popRing(gGrp.position.x, gGrp.position.z, 1.4, 0xa855f7);
                toast('🪰 仿生蒼蠅下手發球!', '等球落地一次再回擊');
            } else {
                popRing(gGrp.position.x, gGrp.position.z, 1.2, 0x38bdf8);
                toast('🪿 匹克鵝下手發球!', '等球落地一次再回擊');
            }
        }


/* ═══════ 玩家操作、揮拍擊球、匹克鵝 AI 與主動畫迴圈 ═══════ */
        function beginCharge() {
            S.init(); closePanel();
            if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER') {
                swingT = 0.28;
                FunMode.tryElectrocuteFly();
                return;
            }
            if (camEdit) return;                       // 編輯視角時不蓄力
            if (demoOn) { skipDemo(); return; }
            if (locked || state === 'CLEARED') return;
            if (state === 'FAULT') { clearTimers(); resetServe(); return; }
            if (webcamActive) return;                  // 體感模式不用震盪蓄力,避免與 AI 搶 power
            if (state === 'SERVE_READY' && server !== 'PLAYER') return;   // ★ 鵝發球期間不蓄力
            if (state === 'SERVE_READY' || state === 'RALLY') charging = true;
        }
        function release() {
            if (!charging) return;
            charging = false;
            const p = power; power = 0; powerDir = 1; D.pFill.style.width = '0%';
            if (state === 'SERVE_READY') doServe(p);
            else if (state === 'RALLY') { swingT = 0.22; swingP = p; }
        }
        /**
         * ★ 簡化直覺的滑動自旋計算器:
         * - 向上直推 (橫向位移 < 18px 且 橫向速度 < 70px/s): 回傳 0 (100% 筆直直球，絕不亂漂)
         * - 手指往右滑: 回傳正值 (球往右飛，空中劃向右側)
         * - 手指往左滑: 回傳負值 (球往左飛，空中劃向左側)
         * - 滑動太猛 / 刻意滑太多: 回傳超過 1.3~1.6 (球在空中強烈拐彎直接噴出界外，達成失誤判定!)
         */
        /**
         * ★ 取得當前有效揮拍手勢快照 (Active or Recent Swipe Snapshot)
         * - 若手指正在滑動且已具備動量，優先採用當前手勢
         * - 若手指剛離手 (320ms 內)，採用已完成手勢快照，杜絕擊球時手勢被早洩截斷
         */
        function getActiveSwipe() {
            if (typeof SWIPE === 'undefined') return { distX: 0, distY: 0, peakVx: 0, peakVy: 0, sagitta: 0, spinArea: 0, spin: 0 };
            const now = performance.now();
            const curDist = Math.hypot(SWIPE.distX, SWIPE.distY);
            const curSpeed = Math.hypot(SWIPE.peakVx, SWIPE.peakVy);
            const ls = SWIPE.lastStroke;
            if (SWIPE.active && (curDist >= 15 || curSpeed >= 120)) {
                return SWIPE;
            }
            if (ls && (now - ls.time) < 320) {
                const lsDist = Math.hypot(ls.distX, ls.distY);
                if (lsDist >= curDist) return ls;
            }
            return SWIPE;
        }

        /**
         * ★ 寶可夢 GO 精靈球曲球幾何流體感應器 (Pokémon GO Curveball Sensor):
         * 1. 純直球高容寬保證 (Straight Throw Deadzone):
         *    - 弦線拱高偏折 |sagitta| < 12px 且 橫向位移 |distX| < 22px 且 橫向速度 |peakVx| < 160px/s 且 無畫圓旋轉 (|spinArea| < 350px²)
         *    - 判定為純直球 (Curve = 0)，100% 筆直向前飛行，零偏漂、零誤觸！
         * 2. 幾何多源感測曲球 (Arc Sagitta + Brush Ratio + Circular Spin):
         *    - 拱高偏折量 (Sagitta): 解決「向外畫弧再收回」淨位移小問題，精準捕捉弧線凸出程度與方向
         *    - 側切刷拍 (Brush Ratio): 捕捉快速側斜刷推
         *    - 畫圓積分 (Green's Theorem Spin Area): 捕捉發球前畫圈蓄力
         * 3. 連續平滑漸進自旋 (Smooth Continuous Scaling):
         *    - 微弧切球 (0.20 ~ 0.35) -> 標準香蕉曲球 (0.40 ~ 0.85) -> 大幅度拐彎 (0.90 ~ 1.25) -> 甩過猛噴界外 (> 1.35)
         */
        function getSwipeCurve() {
            if (webcamActive) {
                return THREE.MathUtils.clamp((RIGHT.padXFree || 0) * 0.7, -1.2, 1.2);
            }
            const s = getActiveSwipe();
            const distX = s.distX || 0;
            const peakVx = s.peakVx || 0;
            const sagitta = s.sagitta || 0;
            const spinArea = s.spinArea || 0;

            // ① 直球高容寬死區判定：正常向前推球絕不誤觸曲球
            const isStraightSagitta = Math.abs(sagitta) < 12;
            const isStraightDist = Math.abs(distX) < 22;
            const isStraightSpeed = Math.abs(peakVx) < 160;
            const isStraightSpinArea = Math.abs(spinArea) < 350;

            if (isStraightSagitta && isStraightDist && isStraightSpeed && isStraightSpinArea) {
                return 0;
            }

            // ② 多源幾何分量綜合計算
            const chordLen = Math.hypot(distX, s.distY || 0);

            // 弧線拱高分量 (每 65px 拱高約 1.0 曲率)
            const arcContrib = sagitta / 65;

            // 橫向側刷與速度分量 (靈敏捕捉側刷，平滑增益)
            const brushRatio = Math.abs(distX) / Math.max(30, Math.abs(s.distY || 0));
            const brushContrib = (distX / 50) * 0.60 + (peakVx / 450) * 0.40;

            // 畫圈旋轉積分分量 (僅在短位移原地畫圈蓄力時生效，避免干擾長劃弧)
            let spinAreaContrib = 0;
            if (chordLen < 75 && Math.abs(spinArea) > 250) {
                spinAreaContrib = THREE.MathUtils.clamp(-spinArea / 1400, -0.85, 0.85);
            }

            // 綜合加權：
            // 長畫弧手勢 (chordLen >= 75): 拱高 55% + 側刷 45% + 側斜超額加成
            // 短位移或原地畫圈: 加入自旋積分
            let rawCurve = 0;
            if (chordLen >= 75) {
                const slashBoost = (brushRatio > 0.7) ? (brushRatio - 0.7) * 0.65 * Math.sign(distX) : 0;
                rawCurve = arcContrib * 0.55 + brushContrib * 0.45 + slashBoost;
            } else {
                rawCurve = arcContrib * 0.45 + brushContrib * 0.30 + spinAreaContrib * 0.50;
            }
            const absCurve = Math.abs(rawCurve);

            // 微弱超標仍視為手指微抖，不啟動曲球
            if (absCurve < 0.12) return 0;

            const dir = Math.sign(rawCurve);

            // ③ 連續平滑無斷層映射：起步 0.18，平滑過渡至 1.25（避免甩球自旋超標暴衝）
            const curveVal = dir * THREE.MathUtils.clamp(0.18 + (absCurve - 0.12) * 0.75, 0.20, 1.25);
            return curveVal;
        }

        function serveTarget(p) {
            const t = THREE.MathUtils.clamp(p / 100, 0, 1);
            // 發球落點深度：合法發球區介於廚房線(2.13m)與底線(6.705m)之間
            // t=0 落於廚房線後方約 0.2m (-2.33m)，t=1 落於底線前約 0.4m (-6.30m)，極速發球最誇張落地亦不超過底線往外0.6m
            serveTgt.z = -(KITCHEN_D + 0.20 + t * (HALF_L - KITCHEN_D - 0.60));
            if (webcamActive) {
                serveTgt.x = aimTargetX();
            } else {
                // ★ 基準鎖定合法對角發球區 (diagSign * COURT_W/4)
                const baseBoxX = diagSign() * (COURT_W / 4);
                const curve = getSwipeCurve();
                // 瞄準點微調：曲球先朝內側啟動，由馬格努斯側向力優雅拐入對角發球區
                if (Math.abs(curve) > 1.10) {
                    serveTgt.x = baseBoxX + Math.sign(curve) * 0.95; // 甩出邊線界外（出界約0.4~0.6m，絕不暴衝）
                } else if (Math.abs(curve) >= 0.20) {
                    serveTgt.x = baseBoxX - curve * 0.50; // 微向內引，弧線向外兜入合法對角區
                } else {
                    serveTgt.x = baseBoxX; // 純直球直轟發球區中央
                }
            }
            return serveTgt;
        }
        function serveVel(p, out) {
            const tg = serveTarget(p);
            solveArc(PH.pos.x, PH.pos.y, PH.pos.z, tg.x, tg.z, out);
            return out;
        }
        /* Math.sign(0) 回傳 0,永不等於 ±1 → 玩家站正中央會拿到看不懂的犯規 */
        function sideOf(x) { return x > 0.15 ? 1 : (x < -0.15 ? -1 : 0); }

        /**
         * @param {number} p 力道 0~100
         * @param {number} [contactY] 擊球瞬間的拍面世界高度(公尺)。
         *        體感模式由 updateServeFSM 在揮拍啟動時擷取;省略則以當前 padW.y 判定。
         */
        function doServe(p, contactY) {
            if (server !== 'PLAYER') { toast('現在是匹克鵝發球', '等牠發球過網後再回擊'); return; }
            if (stage === 1 && sideOf(pPos.x) !== serveSide) {
                serveFail('發球位置錯誤', '本次輪到' + (serveSide > 0 ? '右' : '左') + '側,請站進藍圈'); return;
            }
            if (pPos.z < HALF_L - 0.05) { serveFail('腳踩線', '雙腳必須在底線之後'); return; }
            const cy = (typeof contactY === 'number' && contactY > 0) ? contactY : padW.y;
            if (cy > SERVE_MAX_H) {
                serveFail('擊球點過高 (' + cy.toFixed(2) + 'm)', '下手臂發球須低於腰部,上限 ' + SERVE_MAX_H + 'm'); return;
            }
            dismissFingerTutorial();
            state = 'SERVE_AIR'; lastHitter = 'PLAYER';
            rallyHits = 1; bounces = 0; pLock = 0.3; gLock = 0;
            serveFromRight = pPos.x >= 0;
            serveVel(p, PH.vel); S.pop(p / 100);

            // ★ 寶可夢 GO 曲球發球自旋
            const serveSpin = getSwipeCurve();
            PH.spin = serveSpin; PH.spinInc = 0;

            if (Math.abs(serveSpin) >= 0.25) {
                const spinSideTxt = serveSpin > 0 ? '⭐ 寶可夢式右曲球 (RIGHT CURVE)' : '⭐ 寶可夢式左曲球 (LEFT CURVE)';
                announceReferee(spinSideTxt, Math.abs(serveSpin) > 1.10 ? '⚠️ 甩球過猛，球偏出界外！' : '精準曲球已觸發', false);
            }

            popRing(PH.pos.x, PH.pos.z, 1.2, 0xffc857);
            const spdMph = Math.round(PH.vel.length() * 2.23694);
            toast('SERVE', spdMph + ' mph');

            auditLogAdd({
                stage: stage,
                type: 'SERVE',
                hitter: 'PLAYER',
                speed: spdMph,
                power: Math.round(p),
                spin: +serveSpin.toFixed(2),
                chain: null,
                stance: { ok: stanceOK, bal: +stanceBal.toFixed(2) },
                outcome: '發球飛行中'
            });
        }
        function tryHit() {
            if (demoOn) return;
            if (state !== 'RALLY' || pLock > 0 || locked) return;
            if (PH.vel.z <= 0 || PH.pos.z < 0.05) return;
            const b = PH.pos, prevB = (PH.prevPos || b), p = padW;
            const isMegaPad = (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'MEGA_PADDLE');
            const isMiniPad = (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'MINI_PADDLE');
            const padScale = isMegaPad ? 3.8 : (isMiniPad ? 0.45 : 1.5); // ★ 巨無霸球拍 3.8 倍超寬判定，迷你拍 0.45 倍極限縮水，一般 1.5 倍
            const assist = (webcamActive ? 1.45 : 1.0) * padScale;
            const r = swingT > 0
                ? { z: (0.62 + BALL_R) * assist, x: (0.82 + BALL_R) * assist, y: (0.78 + BALL_R) * assist }
                : { z: (0.45 + BALL_R) * assist, x: (0.60 + BALL_R) * assist, y: (0.55 + BALL_R) * assist };

            // ★ 連續碰撞檢測 (Swept Continuous Collision Detection)：
            // 避免在 30 FPS 或卡頓掉幀時，高速殺球（14~18 m/s，單幀位移可達 0.6m）穿透球拍
            const minZ = Math.min(prevB.z, b.z) - r.z;
            const maxZ = Math.max(prevB.z, b.z) + r.z;
            const crossesZ = (p.z >= minZ && p.z <= maxZ) || (Math.abs(b.z - p.z) <= r.z);
            if (!crossesZ) return;

            // 根據穿過球拍平面的時刻插值 X、Y 座標
            const dz = b.z - prevB.z;
            const tCross = Math.abs(dz) > 1e-4 ? THREE.MathUtils.clamp((p.z - prevB.z) / dz, 0, 1) : 1;
            const crossX = THREE.MathUtils.lerp(prevB.x, b.x, tCross);
            const crossY = THREE.MathUtils.lerp(prevB.y, b.y, tCross);

            const inX = Math.abs(crossX - p.x) <= r.x || Math.abs(b.x - p.x) <= r.x;
            const inY = Math.abs(crossY - p.y) <= r.y || Math.abs(b.y - p.y) <= r.y;
            if (!inX || !inY) return;

            dismissFingerTutorial();
            const volley = (bounces === 0);
            // ★ KITCHEN FAULT 條件更具體,須先判定(否則 Stage 3 永遠先被判雙彈跳違規)
            if (volley && stage >= 3 && pPos.z < KITCHEN_D + 0.05) {
                endRally('GOOSE', 'KITCHEN FAULT', '站在中興湖廚房內不可空中截擊'); return;
            }
            if (volley && needBounce()) { endRally('GOOSE', '雙彈跳違規', '接發球必須等球落地一次'); return; }
            pLock = 0.28; lastHitter = 'PLAYER'; rallyHits++; bounces = 0;

            // 🍄 瘋狂道具戰：擊球特殊觸發 (電蚊拍電擊、巨球震撼、巨拍轟擊)
            if (typeof FunMode !== 'undefined' && FunMode.activeBuff) {
                if (FunMode.activeBuff === 'ELECTRIC_SWATTER') {
                    FunMode.tryElectrocuteFly();
                    popRing(b.x, b.z, 2.2, 0x38bdf8);
                    if (typeof S !== 'undefined' && S.tone) S.tone('sawtooth', 360, 100, 0.14, 0.25);
                } else if (FunMode.activeBuff === 'MEGA_BALL') {
                    popRing(b.x, b.z, 2.8, 0x64748b);
                    addShake(0.24);
                    if (typeof S !== 'undefined' && S.thump) S.thump(1.6);
                } else if (FunMode.activeBuff === 'MEGA_PADDLE') {
                    popRing(b.x, b.z, 2.5, 0xfacc15);
                    addShake(0.12);
                    if (typeof S !== 'undefined' && S.pop) S.pop(1.0);
                }
            }

            // ★ 動力鏈評分與 🧑‍🏫 AI 虛擬教練即時診斷
            let chainRes = null;
            if (webcamActive) {
                const g = gradeChain();
                if (g) {
                    chainRes = g;
                    motionStatsAdd(g);
                    later(() => showChainFeedback(g), 1200);
                    if (g.ordered === false && g.pElbow > 55) {
                        if (typeof S !== 'undefined' && S.coach) S.coach();
                        toast('🧑‍🏫 AI 教練提示', '手臂代償發力過重！試著先轉動腰髖帶動揮拍，球速更強！');
                    } else if (g.ordered === true) {
                        if (typeof S !== 'undefined' && S.coach) S.coach();
                        toast('🧑‍🏫 AI 教練讚賞', '極佳！標準人體動力鏈發力時序（腰➔肩➔肘）！');
                    }
                }
                kcReset();
            }

            // ★ 手機觸覺震動反饋 (Haptic Vibration)
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                try { navigator.vibrate(25); } catch (_) {}
            }

            // ★ v5.0.14: 擊球力道四級階梯 (依手指揮動幅度/位移/速度精準判斷: 0動=被動擋球/掛網, 微動=廚房Dink, 中推=過渡深球, 大揮=抽殺)
            const sw = (typeof getActiveSwipe === 'function') ? getActiveSwipe() : SWIPE;
            const swipeDist = Math.hypot(sw.distX, sw.distY);
            const swipeSpeed = Math.hypot(sw.peakVx * 0.65, sw.peakVy);

            let ch = 0.20; // 預設柔和丁克
            let isPassiveBlock = false;

            if (webcamActive) {
                ch = THREE.MathUtils.clamp(hitPower(KIN.vPeak, SWING.path) / 100, 0.15, 1.0);
            } else if (swingT > 0) {
                // 蓄力鍵擊球 (空白鍵 / 右鍵)
                ch = THREE.MathUtils.clamp(swingP / 100, 0.15, 1.0);
            } else if (swipeDist < 12 && swipeSpeed < 75) {
                // 【第 0 級: 都沒有動 / 被動減力碰球 (Passive Block)】
                isPassiveBlock = true;
                ch = 0.12;
            } else if (swipeDist < 45 && swipeSpeed < 320) {
                // 【第 1 級: 稍微動一點點 (Gentle Kitchen Dink)】
                // 手指滑動 12px ~ 45px，輕推小球
                const t = Math.max(0, (swipeDist - 12) / 33);
                ch = 0.18 + t * 0.06; // 0.18 ~ 0.24 (精準丁克力道)
            } else if (swipeDist < 100 && swipeSpeed < 700) {
                // 【第 2 級: 稍微動多一點 (Medium Push / 廚房後緣中深球)】
                // 手指滑動 45px ~ 100px，中推
                const t = Math.max(0, (swipeDist - 45) / 55);
                ch = 0.28 + t * 0.18; // 0.28 ~ 0.46 (過渡區深球)
            } else {
                // 【第 3 級: 快速 / 大幅度滑動 (Drive / Speed-up / Smash)】
                const t = Math.min(1.0, Math.max(0, (swipeSpeed - 700) / 800));
                ch = 0.55 + t * 0.45; // 0.55 ~ 1.0 (重砲抽殺)
            }
            swingT = 0;

            // ★ 🧱 對牆擊球特訓模式 (Wall Rebound Practice): 朝木牆瞄準發射
            if (isWallPractice) {
                const tz = 0.05;
                const tx = THREE.MathUtils.clamp((sw.distX || 0) * 0.02, -1.8, 1.8);
                const spdScale = Math.min(1.4, Math.max(0.7, ch * 1.6));
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
                S.pop(0.85);
                return;
            }

            // ★ 🌟 第三桿放短 (Third Shot Drop) 戰術判定：發球後第 3 桿自後場打出柔和下墜球落入廚房區
            const isThirdShot = (rallyHits === 1);
            if (isThirdShot && b.z > 3.6 && ch <= 0.28 && !isPassiveBlock) {
                const tz = -1.2; // 精準落入對手廚房區
                const tx = THREE.MathUtils.clamp(padX * 0.6, -1.5, 1.5);
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, 0.76);
                toast('🌟 完美第三桿放短！', 'PERFECT THIRD SHOT DROP · 成功瓦解對手網前壓迫！');
                announceReferee('🌟 完美第三桿放短！', '精準落入廚房區！', true);
                popRing(b.x, b.z, 2.2, 0xf6c445);
                S.point();
                return;
            }

            // ★ 簡化直覺落點與自旋 (寶可夢 GO 曲球機制)
            let tx = 0, spin = 0;
            if (webcamActive) {
                const aimZoneX = aimTargetX();
                const wristFree = (RIGHT.padXFree || 0);
                tx = THREE.MathUtils.clamp(aimZoneX * 0.75 + wristFree * 0.8, -COURT_W / 2 + 0.5, COURT_W / 2 - 0.5);
                spin = getSwipeCurve();
            } else {
                spin = getSwipeCurve();
                // 初速瞄準微調：曲球先朝反向/內側啟動，再由馬格努斯側向力優雅劃出經典香蕉弧線
                // 若甩球過猛 (|spin| > 1.10)，限制初始偏角，使最誇張出界僅在邊線/底線外0.5~0.8米以內，絕不暴衝
                if (Math.abs(spin) > 1.10) {
                    tx = Math.sign(spin) * 1.55; // 限制橫向初速度，保證最誇張出界不超過邊線外 0.8m
                } else if (Math.abs(spin) >= 0.20) {
                    // 香蕉弧線初始彈道：反向引導 (-spin * 0.55)，由馬格努斯效應優雅兜回場內！
                    tx = -spin * 0.55 + (padX * 0.4);
                } else {
                    // 純直球：依照拍面橫向位置自然微調瞄準，零自旋零偏漂
                    tx = THREE.MathUtils.clamp(padX * 0.85, -1.8, 1.8);
                }
            }

            PH.spin = spin; PH.spinInc = 0;

            // 側旋切球裁判廣播 (只在顯著自旋且非暴抽時提示，避免過度干擾)
            if (Math.abs(spin) >= 0.25) {
                const spinSideTxt = spin > 0 ? '⭐ 寶可夢式右曲球 (RIGHT CURVE)' : '⭐ 寶可夢式左曲球 (LEFT CURVE)';
                announceReferee(spinSideTxt, Math.abs(spin) > 1.10 ? '⚠️ 甩球過猛，球偏出界外！' : '精準曲球已觸發', false);
            }

            // ★ v5.0.14 依手指滑動階梯精確解算落點 (0動=被動擋球/掛網, 微動=廚房丁克, 中推=深球, 大動=抽殺)
            let tz = -3.5, spdScale = 1.0;
            if (isChanceBall && (ch >= 0.22 || b.y > 0.70 || swipeDist > 20 || swipeSpeed > 180)) {
                // ★ 機會球凌空扣殺：抓到浮高破綻，強制轉為極速暴扣 (SMASH WINNER)！
                ch = Math.max(ch, 0.85);
                tz = -(HALF_L - 0.70); // -5.30m (直轟對角深線)
                tx = (gGrp.position.x > 0 ? -1.65 : 1.65); // 殺向遠離對手的無人死角
                spdScale = 1.45; // 極速重扣
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
                toast('💥 凌空扣殺得分 (SMASH WINNER)!', '抓到浮高破綻，極速重扣殺向空檔！');
                announceReferee('💥 扣殺得分！', '漂亮終結網前拉鋸！', true);
                isChanceBall = false;
                dinkRallyCount = 0;
                if (typeof diffLevel !== 'undefined' && diffLevel === 'fly') {
                    flyState = 'STUNNED';
                    flyStunTimer = 2.2;
                } else {
                    gLock = 1.2;
                }
                addShake(0.18);
                S.pop(1.0);
            } else if (isPassiveBlock) {
                // 第 0 級：手指完全沒動 / 被動減力碰球 (Passive Block)
                const incomingEnergy = Math.hypot(PH.vel.x, PH.vel.y, PH.vel.z);
                const hitLow = (b.y < 0.32);
                // 確定性物理：來球過慢 (< 4.8m/s) 或接觸點過低 (低於 0.32m 且無主動推拍)，能量不足必然掛網
                if (incomingEnergy < 4.8 || hitLow) {
                    tz = -0.15; // 沒過網
                    spdScale = 0.52;
                    solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
                    toast('⚠️ 被動擋球掛網', '來球過低或推力不足（微向上滑動可順利起球）');
                } else {
                    // 借力卸力柔和過網，落入廚房前端 (0.75m ~ 1.25m)
                    tz = -(0.75 + Math.min(1.0, (incomingEnergy - 4.8) / 6.0) * 0.50);
                    spdScale = 0.60;
                    solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
                }
            } else if (ch < 0.26) {
                // 第 1 級：稍微動一點點 -> 100% 精準落在廚房區 (Kitchen Dink: 1.15m ~ 1.75m)
                const k = (ch - 0.18) / 0.08;
                tz = -(1.15 + k * 0.60); // 1.15m ~ 1.75m (廚房線以內)
                spdScale = 0.65; // ★ 柔和低速弧線 (約 5.5 m/s)
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            } else if (ch < 0.52) {
                // 第 2 級：稍微動多一點 -> 落在廚房線後緣或過渡區 (Deep Dink / Drop: 2.10m ~ 3.60m)
                const k = (ch - 0.26) / 0.26;
                tz = -(2.10 + k * 1.50); // 2.10m ~ 3.60m
                spdScale = 0.95 + k * 0.15;
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            } else {
                // 第 3 級：大幅/快速滑動 -> 底線平抽或扣殺 (Power Drive / Smash)
                const k = (ch - 0.52) / 0.48;
                // 校準目標深度與初速縮放：即使極限抽殺，落地距底線最誇張亦壓在 0.8m 以內 (不超過 -7.5m)
                tz = -(4.40 + k * 1.70); // -4.40m ~ -6.10m
                spdScale = 1.10 + k * 0.25; // 1.10 ~ 1.35
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            }

            // 擊球後重置本次滑動位移、幾何分析與快照，避免延續至下一次碰球
            if (typeof SWIPE !== 'undefined') {
                SWIPE.distX = 0; SWIPE.distY = 0;
                SWIPE.peakVx = 0; SWIPE.peakVy = 0;
                SWIPE.vx = 0; SWIPE.vy = 0;
                SWIPE.smoothedVx = 0; SWIPE.smoothedVy = 0;
                SWIPE.sagitta = 0; SWIPE.spinArea = 0; SWIPE.spin = 0;
                SWIPE.history = [];
                SWIPE.startX = SWIPE.currX; SWIPE.startY = SWIPE.currY;
                SWIPE.lastStroke = null;
            }

            const hitMph = Math.round(PH.vel.length() * 2.23694);
            const hitType = volley ? 'VOLLEY' : (ch < 0.5 ? 'DINK' : 'POWER SHOT');

            if (stage === 3 && !volley) {
                S.pop(0.4 + ch * 0.6);
                toast('NICE DINK! · ' + hitMph + ' mph', '成功完成中興湖廚房合法回擊!');
                twoBounceDone = 1; updateGoal();
                auditLogAdd({
                    stage: stage, type: hitType, hitter: 'PLAYER', speed: hitMph,
                    power: Math.round(ch * 100), spin: +spin.toFixed(2), chain: chainRes,
                    stance: { ok: stanceOK, bal: +stanceBal.toFixed(2) }, outcome: '廚房合法回擊 (過關)'
                });
                locked = true;
                clearStage();
                return;
            }

            S.pop(0.4 + ch * 0.6); addShake(0.05 + ch * 0.06);

            // ★ 統一單一高品質 Toast 回饋，杜絕 0ms 內連續覆蓋與閃爍
            const spinBadge = Math.abs(spin) >= 0.20 ? (spin > 0 ? '🌪️ 右側旋 · ' : '🌪️ 左側旋 · ') : '';
            if (!isChanceBall) {
                if (isPassiveBlock) {
                    if (tz < -0.2) toast('🎾 減力擋球 · ' + hitMph + ' mph', '借力卸力柔和過網，落入廚房前端');
                } else if (ch < 0.26) {
                    toast(spinBadge + '🎾 廚房精準丁克 · ' + hitMph + ' mph', '柔和越網，貼網低彈跳');
                } else if (ch < 0.52) {
                    toast(spinBadge + '🎾 過渡區深推球 · ' + hitMph + ' mph', '壓制在對手腳邊');
                } else {
                    toast(spinBadge + '💥 重砲抽球 · ' + hitMph + ' mph', '極速直轟底線！');
                }
            }

            auditLogAdd({
                stage: stage, type: hitType, hitter: 'PLAYER', speed: hitMph,
                power: Math.round(ch * 100), spin: +spin.toFixed(2), chain: chainRes,
                stance: { ok: stanceOK, bal: +stanceBal.toFixed(2) }, outcome: '合法回擊'
            });

            if (stage === 2 && rallyHits >= 3 && !volley) {
                twoBounceDone = 1; updateGoal(); locked = true;
                clearStage();
            }
        }
        const joyAnalog = { x: 0, z: 0 };
        const playerVel = { x: 0, z: 0 };
        const dragRay = new THREE.Raycaster();
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();

        function updatePlayer(dt) {
            if (demoOn) return;

            // ★ ⚡ 霹靂電蚊拍：第三人稱動態越肩自動鎖定與觸控拖曳過網追殺 (Third-Person Chase & Rush across the Net)
            const isHunting = (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER');
            if (isHunting) {
                // 保持主角身體完整可見，展現衝鋒跨網奔跑英姿 (第三人稱動態越肩視角)
                if (pTorso && !pTorso.visible) pTorso.visible = true;
                if (pLegs && !pLegs.visible) pLegs.visible = true;
                if (pHead && !pHead.visible) pHead.visible = true;
                if (pLeftArm && !pLeftArm.visible) pLeftArm.visible = true;

                const targetObj = (typeof gGrp !== 'undefined' && gGrp) ? gGrp.position : { x: 0, z: -HALF_L * 0.7 };

                // 判斷是否已接近蒼蠅進入「近身對峙揮砍」模式 (distToFly <= 3.8m) 或已在處決死亡結算
                const distToFly = Math.hypot(pPos.x - targetObj.x, pPos.z - targetObj.z);
                const isClose = (distToFly <= 3.8) || (typeof FunMode !== 'undefined' && FunMode.isKODeathSequence);
                if (typeof FunMode !== 'undefined') {
                    const wasClose = FunMode.isFaceOff;
                    FunMode.isFaceOff = isClose;
                    if (wasClose !== isClose) FunMode.updateGuideBanner();
                }

                if (isClose) {
                    // ★ 近身對峙：平滑鎖定在蒼蠅前方約 1.6 米處對峙，維持面對蒼蠅，不穿透衝過頭
                    const standZ = targetObj.z + 1.60;
                    pPos.x += (targetObj.x - pPos.x) * Math.min(1, dt * 8);
                    pPos.z += (standZ - pPos.z) * Math.min(1, dt * 8);
                    pGrp.position.set(pPos.x, 0, pPos.z);
                } else {
                    // ★ 衝刺逼近階段：手指拖曳或全速自動衝鋒
                    let targetX = targetObj.x;
                    let targetZ = targetObj.z;
                    let isDraggingToTarget = false;

                    if (window.isScreenTouching && cam) {
                        dragRay.setFromCamera(mouse, cam);
                        if (dragRay.ray.intersectPlane(groundPlane, groundHit)) {
                            targetX = THREE.MathUtils.clamp(groundHit.x, -COURT_W / 2 - 0.7, COURT_W / 2 + 0.7);
                            targetZ = THREE.MathUtils.clamp(groundHit.z, -(HALF_L + 1.8), HALF_L + 1.2);
                            isDraggingToTarget = true;
                        }
                    }

                    const dx = targetX - pPos.x;
                    const dz = targetZ - pPos.z;
                    const dist = Math.hypot(dx, dz) || 1;

                    const rushSpeed = isDraggingToTarget ? 11.2 : 9.6;
                    let targetVx = (dx / dist) * Math.min(rushSpeed, Math.max(2.5, dist * 8.0));
                    let targetVz = (dz / dist) * Math.min(rushSpeed, Math.max(2.5, dist * 8.0));

                    if (Math.hypot(joyAnalog.x, joyAnalog.z) > 0.05) {
                        targetVx += joyAnalog.x * 4.5;
                        targetVz += joyAnalog.z * 4.5;
                    } else {
                        if (keys.a) targetVx -= 4.5;
                        if (keys.d) targetVx += 4.5;
                        if (keys.w) targetVz -= 4.5;
                        if (keys.s) targetVz += 4.5;
                    }

                    playerVel.x += (targetVx - playerVel.x) * Math.min(1, dt * 28);
                    playerVel.z += (targetVz - playerVel.z) * Math.min(1, dt * 28);

                    pPos.x += playerVel.x * dt;
                    pPos.z += playerVel.z * dt;

                    pPos.x = THREE.MathUtils.clamp(pPos.x, -COURT_W / 2 - 0.7, COURT_W / 2 + 0.7);
                    pPos.z = THREE.MathUtils.clamp(pPos.z, -(HALF_L + 1.8), HALF_L + 1.6);
                    const runBob = isClose ? 0 : Math.sin(performance.now() * 0.018) * 0.035;
                    pGrp.position.set(pPos.x, runBob, pPos.z);
                }

                // 第三人稱手持電蚊拍姿勢：右手持拍向前微傾，電弧環繞
                let padX = 0.35 + Math.sin(performance.now() * 0.014) * 0.03;
                let padY = 0.96 + Math.sin(performance.now() * 0.018) * 0.03;
                let padZ = -0.32;
                let rotPitch = -0.25;
                let rotYaw = -0.15;
                let rotRoll = -0.20;

                // 手勢揮砍動畫 (Slash Swat Animation)
                if (typeof FunMode !== 'undefined' && FunMode.slashTimer > 0) {
                    const phase = 1.0 - (FunMode.slashTimer / 0.35); // 0 -> 1
                    const curve = Math.sin(phase * Math.PI); // 0 -> 1 -> 0
                    if (FunMode.slashDir === 'RIGHT') {
                        // 從左向右猛烈橫斬
                        padX = 0.35 - 0.48 + curve * 1.05;
                        padY = 0.96 - 0.12 + curve * 0.32;
                        rotRoll += -0.7 + curve * 1.5;
                        rotYaw += -0.5 + curve * 1.2;
                    } else if (FunMode.slashDir === 'LEFT') {
                        // 從右向左猛烈反斬
                        padX = 0.35 + 0.48 - curve * 1.05;
                        padY = 0.96 + 0.12 - curve * 0.32;
                        rotRoll += 0.7 - curve * 1.5;
                        rotYaw += 0.5 - curve * 1.2;
                    } else {
                        // 向上或向下劈砍
                        rotPitch += -curve * 1.1;
                        padZ -= curve * 0.30;
                        padY -= curve * 0.38;
                    }
                }

                pPad.position.set(padX, padY, padZ);
                pPad.rotation.set(rotPitch, rotYaw, rotRoll);
                pPad.getWorldPosition(padW);
                limb(pArm, _b.set(0.24, 1.16, 0.02), _a.set(padX, padY - 0.17, padZ));
                if (pLeftArm) {
                    pLeftArm.rotation.x = isClose ? 0.2 : Math.sin(performance.now() * 0.016) * 0.45;
                }
                return;
            } else {
                // 恢復正常身體可見度
                if (pTorso && !pTorso.visible) pTorso.visible = true;
                if (pLegs && !pLegs.visible) pLegs.visible = true;
                if (pHead && !pHead.visible) pHead.visible = true;
                if (pLeftArm && !pLeftArm.visible) pLeftArm.visible = true;
            }

            if (camEdit) {                              // ★編輯視角時鎖住走位
                pGrp.position.set(pPos.x, 0, pPos.z);
                pPad.position.set(padX, padY, -0.24);
                pPad.rotation.set(-0.24, 0, -padX * 0.5);
                pPad.getWorldPosition(padW);
                limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
                if (state === 'SERVE_READY' && server === 'PLAYER') PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
                return;
            }

            // ★ 動態新手引導:手指滑動時，僅在示範模式中主角同步執行揮拍與腳步示範
            if (fingerTutActive && demoOn && state === 'DEMO') {
                const t = fingerAnimProgress;
                const easeT = Math.sin(t * Math.PI * 0.5);
                if (fingerAnimStep === 0) {
                    // 直線前推
                    pGrp.position.set(1.5 * serveSide, 0, HALF_L - easeT * 0.18);
                    padX = 0; padY = 0.72 + easeT * 0.45;
                } else if (fingerAnimStep === 1) {
                    // 右刷拍
                    pGrp.position.set(1.5 * serveSide + easeT * 0.22, 0, HALF_L);
                    padX = easeT * 0.42; padY = 0.72 + easeT * 0.35;
                } else {
                    // 左刷拍
                    pGrp.position.set(1.5 * serveSide - easeT * 0.22, 0, HALF_L);
                    padX = -easeT * 0.42; padY = 0.72 + easeT * 0.35;
                }
                pPad.position.set(padX, padY, -0.24);
                pPad.rotation.set(-0.24, 0, -padX * 0.6);
                pPad.getWorldPosition(padW);
                limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
                if (server === 'PLAYER') PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
                return;
            }

            if (webcamActive) {
                if (state === 'SERVE_READY') {
                    pPos.x += (1.5 * serveSide - pPos.x) * Math.min(1, dt * 18);
                    pPos.z += (HALF_L + 0.35 - pPos.z) * Math.min(1, dt * 18);
                } else if ((state === 'RALLY' || state === 'SERVE_AIR') && PH.vel.z > 0) {
                    pPos.x += (PH.pos.x - pPos.x) * Math.min(1, dt * 25);
                    // ★ 已落地 → 允許下探廚房追短球;未落地 → 維持廚房線後,避免截擊違規
                    const zFloor = (bounces > 0) ? 0.60 : (KITCHEN_D + 0.30);
                    const tz = Math.max(zFloor, Math.min(HALF_L + 0.5, PH.pos.z + 0.25));
                    pPos.z += (tz - pPos.z) * Math.min(1, dt * 20);
                } else if (state === 'RALLY' || state === 'SERVE_AIR') {
                    // ★ 球離開後主動退回廚房線後,否則會永久卡在廚房裡
                    const tz = KITCHEN_D + 0.30;
                    pPos.z += (tz - pPos.z) * Math.min(1, dt * 14);
                }
            } else {
                // ★ v5.0.2 人物走位物理加速度與煞車慣性 (起步加速 a=26, 煞車減速 friction=18)
                let targetVx = 0, targetVz = 0;
                const baseSpd = (typeof JOY_SPEED_PRESETS !== 'undefined' && JOY_SPEED_PRESETS[joySpeedLevel])
                    ? JOY_SPEED_PRESETS[joySpeedLevel].speed
                    : 5.5;
                let maxSpeed = baseSpd;

                // 🍄 道具負面效果：千斤鉛塊步 (HEAVY_FEET) 減速 60%
                if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'HEAVY_FEET') {
                    maxSpeed *= 0.40;
                }

                if (Math.hypot(joyAnalog.x, joyAnalog.z) > 0.05) {
                    targetVx = joyAnalog.x * maxSpeed;
                    targetVz = joyAnalog.z * maxSpeed;
                } else {
                    if (keys.w) targetVz -= maxSpeed;
                    if (keys.s) targetVz += maxSpeed;
                    if (keys.a) targetVx -= maxSpeed;
                    if (keys.d) targetVx += maxSpeed;
                    if (targetVx !== 0 && targetVz !== 0) {
                        targetVx *= 0.7071;
                        targetVz *= 0.7071;
                    }

                    // ★ 網前自動跑位助攻：僅在體感模式或手動開啟設定時啟用，預設關閉以保證純手動走位！
                    const allowNetAssist = (typeof netAssistEnabled !== 'undefined' && netAssistEnabled);
                    if (allowNetAssist && targetVx === 0 && targetVz === 0 && (state === 'RALLY' || state === 'SERVE_AIR')) {
                        if (predictLanding(_land) && _land.z > 0 && _land.z < KITCHEN_D + 0.40) {
                            const wantZ = KITCHEN_D + 0.28; // 廚房線後 28cm 安全站位
                            targetVz = (wantZ - pPos.z) * 3.6;
                            targetVx = (_land.x * 0.65 - pPos.x) * 3.2;
                        } else if (dinkRallyCount > 0 && pPos.z > KITCHEN_D + 0.50) {
                            // 丁克拉鋸中平滑就位於廚房線前
                            const wantZ = KITCHEN_D + 0.28;
                            targetVz = (wantZ - pPos.z) * 3.2;
                        }
                    }
                }

                // 🍄 道具負面效果：混亂顛倒 (REVERSE_CONTROLS) 搖桿/按鍵方向顛倒
                if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'REVERSE_CONTROLS') {
                    targetVx = -targetVx;
                    targetVz = -targetVz;
                }

                // 🍄 道具負面效果：香蕉皮打滑 (BANANA_SLIP) 失去抓地力失控滑行
                if (typeof FunMode !== 'undefined' && (FunMode.activeBuff === 'BANANA_SLIP' || FunMode.slipTimer > 0)) {
                    targetVx = playerVel.x * 0.97;
                    targetVz = playerVel.z * 0.97;
                }

                const accel = (targetVx !== 0 || targetVz !== 0) ? 26 : 18;
                playerVel.x += (targetVx - playerVel.x) * Math.min(1, dt * accel);
                playerVel.z += (targetVz - playerVel.z) * Math.min(1, dt * accel);

                pPos.x += playerVel.x * dt;
                pPos.z += playerVel.z * dt;
            }
            const minZ = 0.3;
            pPos.x = THREE.MathUtils.clamp(pPos.x, -COURT_W / 2 - 0.7, COURT_W / 2 + 0.7);
            pPos.z = THREE.MathUtils.clamp(pPos.z, minZ, HALF_L + 1.6);
            pGrp.position.set(pPos.x, 0, pPos.z);
            // 🍄 香蕉皮打滑 360° 旋轉踉蹌動畫
            if (typeof FunMode !== 'undefined' && (FunMode.activeBuff === 'BANANA_SLIP' || FunMode.slipTimer > 0)) {
                pGrp.rotation.y += dt * 14.0;
                pGrp.rotation.z = Math.sin((FunMode.slipTimer || 0) * 16) * 0.32;
            } else if (!isHunting) {
                // 數位孿生上半身轉動鏡像 (Digital Twin Torso Mirroring)
                if (webcamActive && typeof YAW !== 'undefined') {
                    const wantYaw = -YAW.ema * 0.45;
                    pGrp.rotation.y = THREE.MathUtils.lerp(pGrp.rotation.y, wantYaw, Math.min(1, dt * 12));
                    if (pHead) pHead.rotation.y = -wantYaw * 0.5;
                } else {
                    pGrp.rotation.set(0, 0, 0);
                    // 可愛奔跑彈跳 (Cute Bouncy Jog)
                    const speed = Math.hypot(playerVel.x, playerVel.z);
                    if (speed > 0.5) {
                        pGrp.position.y = Math.abs(Math.sin(performance.now() * 0.014)) * 0.035;
                        if (pHead) pHead.rotation.z = Math.sin(performance.now() * 0.014) * 0.04;
                    } else {
                        pGrp.position.y = 0;
                        if (pHead) pHead.rotation.z = 0;
                    }
                }
            }
            if (webcamActive) updatePaddleAssist(dt);
            else {
                ray.setFromCamera(mouse, cam);
                aimPlane.constant = -(pPos.z - 0.24);
                if (ray.ray.intersectPlane(aimPlane, _aim)) {
                    padX = THREE.MathUtils.clamp(_aim.x - pPos.x, -0.95, 0.95);
                    const yHi = (state === 'SERVE_READY' && server === 'PLAYER') ? (SERVE_MAX_H - 0.10) : 2.0;
                    padY = THREE.MathUtils.clamp(_aim.y, 0.22, yHi);
                }
            }
            pPad.position.set(padX, padY, -0.24);
            pPad.rotation.set(-0.24, 0, -padX * 0.5);
            // 🍄 動態平滑同步球拍縮放，確保道具狀態結束或切換時 100% 縮回原本大小，絕不卡死
            if (typeof FunMode !== 'undefined' && typeof pPad !== 'undefined') {
                const baseScale = FunMode.originalPadScale || 2.175;
                let targetScale = baseScale;
                if (FunMode.activeBuff === 'MEGA_PADDLE') {
                    targetScale = baseScale * 2.8;
                } else if (FunMode.activeBuff === 'MINI_PADDLE') {
                    targetScale = baseScale * 0.35;
                }
                const currentScale = pPad.scale.x;
                pPad.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, Math.min(1, dt * 14)));
            }
            pPad.getWorldPosition(padW);
            limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
            if (state === 'SERVE_READY' && server === 'PLAYER') PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
        }
        function planShot() {
            const plan = AI_PLAN[stage] || 'MIX', xl = COURT_W / 2 - 0.45;

            // ★ 前三關教學保持確定性教學引導落點
            if (stage <= 3) {
                if (plan === 'DEEP') {
                    aiShot.z = HALF_L - 0.55 - Math.random() * 0.6;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x + (Math.random() - 0.5) * 1.2, -xl, xl);
                } else if (plan === 'KITCHEN') {
                    aiShot.z = 1.15 + Math.random() * 0.70;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.45 + (Math.random() - 0.5) * 1.5, -xl, xl);
                }
                return;
            }

            // ★ 🧠 輕量神經戰術小模型推論 (Tiny Pickle Neural Decision Policy)
            if (typeof TinyPicklePolicy !== 'undefined' && TinyPicklePolicy.evaluate && (diffLevel !== 'easy' || stage >= 4)) {
                try {
                    const neuralRes = TinyPicklePolicy.evaluate({
                        ball: { x: PH.pos.x, y: PH.pos.y, z: PH.pos.z, vx: PH.vel.x, vy: PH.vel.y, vz: PH.vel.z },
                        player: { x: pPos.x, y: 0.9, z: pPos.z },
                        court: { width: COURT_W, halfL: HALF_L, kitchenD: KITCHEN_D }
                    });
                    if (neuralRes && neuralRes.tactics) {
                        aiShot.x = neuralRes.tactics.targetX;
                        aiShot.z = neuralRes.tactics.targetZ;
                        if (neuralRes.tactics.spin) PH.spin = neuralRes.tactics.spin;
                        return;
                    }
                } catch(e) {
                    console.warn('TinyPicklePolicy fallback to heuristic AI:', e);
                }
            }

            if (plan === 'BOSS') {
                // ★ 魔王關: 30% 丁克球 + 70% 兩側刁鑽深球
                if (Math.random() < 0.30) {
                    aiShot.z = 0.65 + Math.random() * 1.15;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.5 + (Math.random() - 0.5) * 2.2, -xl, xl);
                } else {
                    aiShot.z = HALF_L - 0.35 - Math.random() * 1.1;
                    aiShot.x = (Math.random() < 0.5 ? 1 : -1) * (COURT_W / 2 - 0.45 - Math.random() * 0.35);
                }
            } else {
                // ★ 第四關: 35% 廚房區吊短球 (Dink Shot AI)
                const shouldDink = (pPos.z > 4.2 || gGrp.position.z > -KITCHEN_D - 0.8) && Math.random() < 0.35;
                if (shouldDink) {
                    aiShot.z = 0.70 + Math.random() * 1.15; // 丁克短球
                    aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.4 + (Math.random() - 0.5) * 2.2, -xl, xl);
                } else {
                    aiShot.z = Math.random() < 0.3 ? 1.2 + Math.random() * 1.2 : 3.4 + Math.random() * 2.6;
                    // ★ v5.0.4: 初階時 AI 回球盡量送至玩家附近 (±1.4m)，大幅提升來回抽球的爽感與互動
                    const spread = (diffLevel === 'easy') ? 1.4 : 3.8;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x + (Math.random() - 0.5) * spread, -xl, xl);
                }
            }
        }
/* 匹克鵝失誤擊球：與正常擊球一樣更新回合狀態，讓後續判定依真實因果計分 */
function gooseErrorHit() {
    gLock = 0.5; lastHitter = 'GOOSE'; rallyHits++; bounces = 0;
    PH.spin = 0; dinkRallyCount = 0; isChanceBall = false;
    if (state === 'SERVE_AIR') state = 'RALLY';
}
/* 保證撞網：0.6 秒後以 0.45 m 高度抵達網面（拋物線在區間內不會碰地） */
function gooseForceNet(b) {
    const T = 0.6;
    const xn = THREE.MathUtils.clamp(b.x * 0.5, -(COURT_W / 2 - 0.3), COURT_W / 2 - 0.3);
    PH.vel.set((xn - b.x) / T, (0.45 - b.y + 0.5 * GRAVITY * T * T) / T, -b.z / T);
}
        function updateGoose(dt) {
            if (demoOn || (typeof isWallPractice !== 'undefined' && isWallPractice) || !gGrp || !gGrp.visible) return;
            const isFly = (typeof diffLevel !== 'undefined' && diffLevel === 'fly');

            const active = (state === 'RALLY' || state === 'SERVE_AIR');

            if (isFly) {
                // ═══════ 普林斯頓 FlyWire 巨大纖維視覺逃逸神經迴路 (LIF-A SNN) ═══════
                flyHoverTime += dt;

                // 1. 執行 SNN 生物物理單步模擬 (LIF-A 膜電位與 Tsodyks-Markram STD)
                if (window.FLY_BRAIN) {
                    FLY_BRAIN.step(dt, PH.pos, PH.vel, gGrp.position, active, dinkRallyCount);
                }

                // 2. 雙翼高頻拍動 (由 DLMn 飛行肌運動神經元即時驅動: 70Hz ~ 125Hz)
                if (flyWings && flyWings.length) {
                    const wingFreq = window.FLY_BRAIN ? FLY_BRAIN.dlmnFreq : ((flyState === 'LOOMING_REFLEX') ? 125 : (flyState === 'STUNNED' ? 14 : 70));
                    const wingAmp = (flyState === 'STUNNED') ? 0.15 : 0.60;
                    flyWings.forEach(w => {
                        w.pivot.rotation.y = Math.sin(flyHoverTime * wingFreq) * wingAmp * w.side;
                    });
                }

                // 3. 暈眩/電擊狀態倒數 (Stunned / Electrocuted / Grounded State)
                if (flyState === 'STUNNED' || flyState === 'ELECTROCUTED') {
                    flyStunTimer -= dt;
                    const isSwatterHunting = (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER');
                    const zapCombo = isSwatterHunting ? FunMode.zapCombo : (flyState === 'ELECTROCUTED' ? 3 : 0);

                    if (zapCombo === 1) {
                        // ── 第 1 擊：空中高頻抽搐抖動，踉蹌低速後退 ──
                        gGrp.position.y = THREE.MathUtils.lerp(gGrp.position.y, 0.65, dt * 8);
                        if (flyMesh) {
                            flyMesh.rotation.z = Math.PI * 0.35 + (Math.random() - 0.5) * 0.25;
                            flyMesh.position.x = (Math.random() - 0.5) * 0.12;
                            flyMesh.position.y = (Math.random() - 0.5) * 0.08;
                        }
                        if (flyWings && flyWings.length) {
                            flyWings.forEach(w => {
                                w.pivot.rotation.y = (Math.random() - 0.5) * 0.9 * w.side;
                            });
                        }
                    } else if (zapCombo === 2) {
                        // ── 第 2 擊：過載冒煙，機身重度側翻，高度跌落至 0.38m ──
                        gGrp.position.y = THREE.MathUtils.lerp(gGrp.position.y, 0.38, dt * 10);
                        if (flyMesh) {
                            flyMesh.rotation.z = Math.PI * 0.55 + (Math.random() - 0.5) * 0.30;
                            flyMesh.position.x = (Math.random() - 0.5) * 0.16;
                            flyMesh.position.y = (Math.random() - 0.5) * 0.10;
                        }
                        if (flyDizzy) {
                            flyDizzy.visible = true;
                            flyDizzy.rotation.y += dt * 16;
                        }
                    } else {
                        // ── 第 3 擊：終極致命處決墜地 (K.O. Death Drop & Charred Ground Impact) ──
                        const wasAirborne = gGrp.position.y > 0.18;
                        gGrp.position.y = THREE.MathUtils.lerp(gGrp.position.y, 0.08, dt * 12);
                        const justLanded = wasAirborne && gGrp.position.y <= 0.18;
                        if (justLanded) {
                            if (typeof S !== 'undefined' && S.thump) S.thump(3.0);
                            if (typeof addShake === 'function') addShake(0.40);
                            if (typeof popRing === 'function') {
                                popRing(gGrp.position.x, gGrp.position.z, 2.5, 0x38bdf8);
                                popRing(gGrp.position.x, gGrp.position.z, 3.8, 0xa855f7);
                            }
                        }

                        if (flyMesh) {
                            // 肚皮徹底朝天 (180度翻肚仰躺地面)，焦黑微震
                            flyMesh.rotation.x = THREE.MathUtils.lerp(flyMesh.rotation.x, Math.PI * 0.88, dt * 10);
                            flyMesh.rotation.z = THREE.MathUtils.lerp(flyMesh.rotation.z, Math.PI * 0.15, dt * 6);
                            if (gGrp.position.y <= 0.14) {
                                flyMesh.position.x = (Math.random() - 0.5) * 0.04;
                                flyMesh.position.y = (Math.random() - 0.5) * 0.03;
                            }
                        }
                        if (flyWings && flyWings.length) {
                            flyWings.forEach(w => {
                                // 雙翼無力垂落地面
                                w.pivot.rotation.y = THREE.MathUtils.lerp(w.pivot.rotation.y, 0, dt * 12);
                                w.pivot.rotation.z = THREE.MathUtils.lerp(w.pivot.rotation.z, -0.45 * w.side, dt * 10);
                            });
                        }
                        if (flyDizzy) {
                            flyDizzy.visible = true;
                            flyDizzy.position.y = 0.45; // 星星盤旋在地面死蒼蠅頭頂
                            flyDizzy.rotation.y += dt * 14;
                        }
                    }

                    if (flyStunTimer <= 0 && !(typeof FunMode !== 'undefined' && FunMode.isKODeathSequence)) {
                        flyState = 'HOVER';
                        if (flyMesh) {
                            flyMesh.rotation.set(0, 0, 0);
                            flyMesh.position.set(0, 0, 0);
                        }
                        if (flyDizzy && (!isSwatterHunting || zapCombo < 2)) flyDizzy.visible = false;
                        if (window.FLY_BRAIN) FLY_BRAIN.reset();
                    }
                } else if (flyState === 'RECOVERY') {
                    // 浮高破綻後短暫低速回防 (2.8m/s)，無法發動巨纖維瞬移反抽
                    if (flyDizzy) flyDizzy.visible = false;
                    if (flyMesh) flyMesh.rotation.z = 0;
                    const targetY = 0.65;
                    gGrp.position.y = THREE.MathUtils.lerp(gGrp.position.y, targetY, dt * 6);
                } else {
                    if (flyDizzy && !(typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER' && FunMode.zapCombo >= 2)) flyDizzy.visible = false;
                    if (flyMesh) flyMesh.rotation.z = 0;
                    // 浮空盤旋與神經質抖動 (Hover Jitter)
                    const targetY = 0.88 + Math.sin(flyHoverTime * 14) * 0.10;
                    gGrp.position.y = THREE.MathUtils.lerp(gGrp.position.y, targetY, dt * 10);
                }

                // ★ 🍄 瘋狂道具戰：電蚊拍追殺模式 - 蒼蠅驚慌逃竄與近身對峙 AI (Panic Fleeing & Face-Off)
                if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER' && flyState !== 'ELECTROCUTED' && flyState !== 'STUNNED') {
                    if (FunMode.isFaceOff) {
                        // 近身對峙：蒼蠅被逼停在底線前懸停，劇烈拍翅並緊張發抖，面對玩家電蚊拍
                        gGrp.position.y = 1.25 + Math.sin(flyHoverTime * 28) * 0.08;
                        if (flyMesh) {
                            flyMesh.position.x = (Math.random() - 0.5) * 0.06;
                            flyMesh.position.y = (Math.random() - 0.5) * 0.05;
                        }
                        if (flyWings && flyWings.length) {
                            flyWings.forEach(w => {
                                w.pivot.rotation.y = Math.sin(flyHoverTime * 180) * 0.85 * w.side;
                            });
                        }
                        return; // 停在玩家正前方供手勢揮砍！
                    }

                    const dx = gGrp.position.x - pPos.x;
                    const dz = gGrp.position.z - pPos.z;
                    const d = Math.hypot(dx, dz) || 1;
                    // 根據目前遭受的電擊次數減緩逃竄速度
                    let escapeSpeed = 4.2;
                    if (FunMode.zapCombo === 1) escapeSpeed = 2.0;
                    else if (FunMode.zapCombo === 2) escapeSpeed = 0.7;

                    let fleeX = gGrp.position.x + (dx / d) * escapeSpeed * dt;
                    let fleeZ = gGrp.position.z + (dz / d) * escapeSpeed * dt;
                    fleeX = THREE.MathUtils.clamp(fleeX, -COURT_W / 2 + 0.35, COURT_W / 2 - 0.35);
                    fleeZ = THREE.MathUtils.clamp(fleeZ, -HALF_L + 0.4, -0.6);
                    gGrp.position.x = fleeX;
                    gGrp.position.z = fleeZ;
                    gGrp.position.y = 0.95 + Math.sin(flyHoverTime * 24) * 0.25;
                    if (flyWings && flyWings.length) {
                        flyWings.forEach(w => {
                            w.pivot.rotation.y = Math.sin(flyHoverTime * 140) * 0.7 * w.side;
                        });
                    }
                    return; // 略過原本追球邏輯，全速逃命！
                }

                // 4. 根據生物神經元輸出驅動行為 (Spike / STD Fatigue / Dink Approach)
                if (active && PH.vel.z < 0) {
                    const bDist = Math.hypot(PH.pos.x - gGrp.position.x, PH.pos.z - gGrp.position.z);
                    const ap = predictApex();
                    const hasLand = predictLanding(_land);
                    const isKitchenBound = hasLand ? (_land.z < 0 && _land.z > -KITCHEN_D - 0.25) : (ap ? (ap.z > -KITCHEN_D - 0.35) : false);

                    if (isKitchenBound) {
                        // ★ 廚房區柔和小球 (Dink): 檢視突觸抑制狀態 (Tsodyks-Markram x < 0.26)
                        if (flyState !== 'STUNNED' && flyState !== 'RECOVERY') {
                            const isVesicleDepleted = window.FLY_BRAIN && FLY_BRAIN.isFatigued;
                            if (isVesicleDepleted || dinkRallyCount >= 2) {
                                if (flyState !== 'POPUP') {
                                    flyState = 'POPUP';
                                    toast('🪰 突觸囊泡枯竭！ (STD 過載)', 'Tsodyks-Markram x < 0.26，微距視覺癱瘓！');
                                    if (typeof speechSay === 'function' && Math.random() < 0.4) speechSay('微距視盲過載！');
                                }
                            } else {
                                flyState = 'DINK_APPROACH'; // 壓向廚房線打拉鋸
                            }
                        }
                    } else if (bDist >= 0.8 && flyState !== 'STUNNED' && flyState !== 'RECOVERY') {
                        // ★ 非廚房球：檢驗巨纖維 (GF) 膜電位是否突破 -45mV 爆發動作電位
                        const hasSpike = window.FLY_BRAIN ? FLY_BRAIN.gfSpike : false;
                        if (hasSpike) {
                            if (flyState !== 'LOOMING_REFLEX') {
                                flyState = 'LOOMING_REFLEX';
                                toast('🪰 巨纖維動作電位放電！', '普林斯頓 FlyWire GF 膜電位突破 -45mV！瞬移逃逸！');
                                popRing(gGrp.position.x, gGrp.position.z, 1.4, 0xa855f7);
                                if (typeof speechSay === 'function' && Math.random() < 0.3) speechSay('巨纖維反射！');
                            }
                        }
                    }
                }
            } else {
                // 非蒼蠅模式，重置高度與暈眩動畫
                gGrp.position.y = 0;
                if (flyDizzy) flyDizzy.visible = false;
                if (flyMesh) flyMesh.rotation.z = 0;
            }

            if (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER' && !isFly) {
                const pdx = gGrp.position.x - pPos.x;
                const pdz = gGrp.position.z - pPos.z;
                const pd = Math.hypot(pdx, pdz) || 1;
                aiTo.x = THREE.MathUtils.clamp(gGrp.position.x + (pdx / pd) * 4.2, -COURT_W / 2 + 0.4, COURT_W / 2 - 0.4);
                aiTo.z = THREE.MathUtils.clamp(gGrp.position.z + (pdz / pd) * 4.2, -HALF_L + 0.4, -0.6);
            } else if (active && PH.vel.z < 0) {
                const hasLand = predictLanding(_land);
                if (bounces >= 1) {
                    // ★ 球已在對手半場彈起：最高優先級動態直追球體即時位置，保證貼身迎擊
                    aiTo.x = THREE.MathUtils.clamp(PH.pos.x, -COURT_W / 2 + 0.35, COURT_W / 2 - 0.35);
                    aiTo.z = THREE.MathUtils.clamp(PH.pos.z - 0.45, -HALF_L - 1.2, -0.9);
                } else if (hasLand && _land.z < 0) {
                    // ★ 球在飛行中：根據物理預測落點 _land 全力跑位
                    aiTo.x = THREE.MathUtils.clamp(_land.x, -COURT_W / 2 + 0.35, COURT_W / 2 - 0.35);
                    if (_land.z > -KITCHEN_D - 0.20) {
                        // 廚房小球：AI 壓上廚房線前 (z: -2.25m ~ -1.10m)
                        aiTo.z = THREE.MathUtils.clamp(_land.z - 0.45, -KITCHEN_D - 0.25, -1.10);
                    } else {
                        // 底線深球：站在落點後方 0.65m，球拍自然迎向彈跳上升期
                        aiTo.z = THREE.MathUtils.clamp(_land.z - 0.65, -HALF_L - 2.0, -KITCHEN_D - 0.35);
                    }
                } else {
                    const ap = predictApex();
                    if (ap) {
                        aiTo.x = THREE.MathUtils.clamp(ap.x, -COURT_W / 2 + 0.35, COURT_W / 2 - 0.35);
                        aiTo.z = THREE.MathUtils.clamp(ap.z - 0.45, -HALF_L - 2.0, -0.9);
                    }
                }
            } else if (state === 'SERVE_READY') {
                if (server === 'GOOSE') { aiTo.x = -1.5 * serveSide; aiTo.z = -HALF_L - 0.35; }
                else { aiTo.x = 0; aiTo.z = -HALF_L - 0.5; }
            } else if (active) {
                aiTo.x *= 0.9;
                aiTo.z = (dinkRallyCount > 0) ? (-KITCHEN_D - 0.20) : (-KITCHEN_D - 0.5);
            }

            // 移速計算：蒼蠅在 LOOMING_REFLEX 時速度高達 24.0 (超速瞬移)，平時巡航為 10.5，STUNNED 時速度為 0.2，RECOVERY 為 2.8
            let spd;
            if (isFly) {
                if (flyState === 'STUNNED') spd = 0.2;
                else if (flyState === 'RECOVERY') spd = 2.8;
                else if (flyState === 'LOOMING_REFLEX') spd = 24.0;
                else spd = 10.5;
            } else {
                const diffScale = stage >= 4 ? (DIFF_PRESETS[diffLevel]?.speedScale || 1.0) : 1.0;
                let baseSpd = (AI_SPEED[stage] || 5.5) * diffScale;
                // ★ 前三關教學關與初階模式保證陪練到位，防止玩家發大角度遠球 AI 來不及就位
                if (stage <= 3 || diffLevel === 'easy') {
                    baseSpd = Math.max(baseSpd, 7.2);
                }
                spd = baseSpd;
            }

            const dx = aiTo.x - gGrp.position.x, dz = aiTo.z - gGrp.position.z, d = Math.hypot(dx, dz);
            if (d > 1e-4) {
                const mv = Math.min(d, spd * dt);
                gGrp.position.x += dx / d * mv; gGrp.position.z += dz / d * mv;
            }
            gGrp.rotation.y = Math.PI;
            const py = THREE.MathUtils.clamp(PH.pos.y, 0.22, 1.6);
            const lx = THREE.MathUtils.clamp(PH.pos.x - gGrp.position.x, -0.8, 0.8);
            // ★ 關鍵修復：蒼蠅浮空時 (gGrp.y > 0)，球拍相對 y 坐標需扣除浮空高度，使 gPadW 世界坐標精確鎖定球體高度 py
            const padRelY = isFly ? (py - gGrp.position.y) : py;
            gPad.position.set(-lx, padRelY, -0.34); gPad.rotation.set(0.24, 0, 0);
            gPad.getWorldPosition(gPadW);
            if (!isFly) {
                limb(gArm, _b.set(0.18, 0.85, -0.05), _a.set(-lx, py - 0.17, -0.34));
            }

            // ★ 發球等待時球固定在腰部高度(不可回讀 PH.pos.y,否則會逐幀爬升)
            if (state === 'SERVE_READY' && server === 'GOOSE') {
                PH.reset(gGrp.position.x, 0.80, gGrp.position.z + 0.30);
            }
            if (!active || gLock > 0 || locked) return;
            if (PH.pos.z > -0.05 || PH.vel.z > 0 || bounces === 0) return;
            const b = PH.pos, gp = gPadW;
            // ★ 放寬擊球容差：前三關教學關卡與初階模式給予充足接球範圍，確保對手 100% 把球打回！
            const isEasyOrTeach = (stage <= 3 || diffLevel === 'easy');
            const xTol = isFly ? 1.25 : (isEasyOrTeach ? 1.65 : 1.15);
            const zTol = isFly ? 1.05 : (isEasyOrTeach ? 1.35 : 0.95);
            const yTol = isFly ? 1.15 : (isEasyOrTeach ? 1.55 : 1.15);
            if (Math.abs(b.z - gp.z) > zTol + BALL_R || Math.abs(b.x - gp.x) > xTol + BALL_R ||
                Math.abs(b.y - gp.y) > yTol + BALL_R) return;

            // ★ 蒼蠅若處於暈眩或電擊狀態 (STUNNED / ELECTROCUTED)，無法回擊，造成破綻讓球落地！
            if (isFly && (flyState === 'STUNNED' || flyState === 'ELECTROCUTED')) {
                return;
            }

            // ★ 🍄 瘋狂道具戰：若玩家打出巨無霸鐵球，蒼蠅硬接直接被砸成一張紙片！
            if (isFly && typeof FunMode !== 'undefined' && FunMode.activeBuff === 'MEGA_BALL') {
                FunMode.squashFly();
                return;
            }

            if (isFly) {
                // ═══════ 仿生蒼蠅官方規則遵循與巨纖維反擊機制 ═══════
                gLock = 0.24; pLock = 0.14; lastHitter = 'GOOSE'; rallyHits++; bounces = 0;
                if (state === 'SERVE_AIR') state = 'RALLY';

                // 🪰⚔️ 六刀流阿修羅蒼蠅多重連擊音效
                if (typeof FunMode !== 'undefined' && FunMode.flyBuff === 'HEXA_PADDLE') {
                    if (typeof S !== 'undefined' && S.pop) {
                        S.pop(0.5);
                        later(() => S.pop(0.7), 50);
                        later(() => S.pop(0.95), 100);
                    }
                    popRing(gGrp.position.x, gGrp.position.z, 2.4, 0xef4444);
                }

                // 1. 新手教學關卡規則 (Stage 2 & 3 嚴格配合教學)
                if (stage === 2) {
                    // ★ 第 2 關：雙彈跳規則 (Two-Bounce Rule)
                    // 蒼蠅必須回傳乾淨、深邃的底線平球，供玩家落地一次後回擊過關
                    aiShot.z = HALF_L - 0.75;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x + (Math.random() - 0.5) * 0.8, -1.8, 1.8);
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel, 1.0);
                    PH.spin = 0; PH.spinInc = 0;
                    S.pop(0.65);
                    toast('🪰 蒼蠅回傳底線深球', '等球落地一次再回擊');
                    flyState = 'HOVER';
                    return;
                } else if (stage === 3) {
                    // ★ 第 3 關：中興湖廚房區 (Kitchen / Non-Volley Zone)
                    // 蒼蠅必須將球輕吊入玩家廚房區 (1.2m ~ 1.7m)，供玩家練習落地推擊小球 (Dink)
                    aiShot.z = 1.35 + Math.random() * 0.35;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.4 + (Math.random() - 0.5) * 0.8, -1.5, 1.5);
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel, 0.88);
                    PH.spin = 0; PH.spinInc = 0;
                    S.pop(0.55);
                    toast('🪰 蒼蠅放中興湖短球', '等球在廚房區落地後輕推');
                    flyState = 'HOVER';
                    return;
                }

                // 2. 第 4~5 關與正式對抗賽 (嚴格遵循匹克球競賽標準，保證 100% 界內)
                const isCounter = (flyState === 'LOOMING_REFLEX');
                let targetX, targetZ, spdScale, spinVal;

                if (isCounter) {
                    // 巨纖維神經極速反抽：結合 DNa01/02 下行轉向神經元，精準壓向遠離玩家之對角底線
                    const steerDir = (window.FLY_BRAIN && FLY_BRAIN.dnaSteer !== 0) ? -Math.sign(FLY_BRAIN.dnaSteer) : (pPos.x > 0 ? -1 : 1);
                    targetX = (steerDir < 0 ? -1.75 : 1.75) + (Math.random() - 0.5) * 0.20;
                    targetZ = HALF_L - 0.85 + (Math.random() - 0.5) * 0.20; // 5.75m ~ 5.95m (底線前安全界內)
                    spdScale = 1.20; // 呼叫 solveArc 內建高速運算，精確計算飛行初速，保證落點合規
                    spinVal = (steerDir < 0 ? -0.16 : 0.16); // 正式競賽微側旋切球 (在合法死區內)
                    popRing(gGrp.position.x, gGrp.position.z, 1.6, 0xa855f7);
                    S.pop(0.85);
                    toast('🪰 巨纖維瞬殺反抽！', '極速壓線深球回敬！');
                    dinkRallyCount = 0;
                    isChanceBall = false;
                } else if (flyState === 'POPUP' || (flyState === 'DINK_APPROACH' && dinkRallyCount >= 2)) {
                    // ★ 方案 B 核心破綻：連續丁克拉鋸 2 拍以上，第 3 拍微距視覺過載浮出半高機會球！
                    targetX = (Math.random() - 0.5) * 1.2;
                    targetZ = 2.40 + Math.random() * 0.60; // 落在玩家淺中場 (2.4m ~ 3.0m)
                    spdScale = 0.90;
                    spinVal = 0;
                    solveArc(b.x, b.y, b.z, targetX, targetZ, PH.vel, spdScale);
                    PH.vel.y = Math.max(PH.vel.y, 4.6); // 高高浮在網頂上方 50cm，滯空近 1 秒
                    isChanceBall = true;
                    dinkRallyCount = 0;
                    flyState = 'RECOVERY'; // 蒼蠅回防較慢，無法立刻發動巨纖維反抽
                    popRing(gGrp.position.x, gGrp.position.z, 2.0, 0xfacc15);
                    S.pop(0.42);
                    toast('🔥 蒼蠅微距視覺過載！ (CHANCE BALL)', '半高機會球！快往前凌空大揮扣殺！');
                    announceReferee('🔥 機會半高球！', '蒼蠅網前失手，抓機會扣殺！', true);
                    return;
                } else if (flyState === 'DINK_APPROACH' || (b.z > -KITCHEN_D - 0.20)) {
                    // ★ 方案 B 核心拉鋸：蒼蠅精準回推直線或大斜線丁克球！
                    if (dinkRallyCount === 0) {
                        // 第 1 拍：蒼蠅直線柔推
                        dinkRallyCount = 1;
                        targetX = THREE.MathUtils.clamp(pPos.x * 0.45 + (Math.random() - 0.5) * 0.3, -1.6, 1.6);
                        targetZ = 1.35 + Math.random() * 0.35; // 玩家廚房區 (1.35m ~ 1.70m)
                        spdScale = 0.65;
                        popRing(gGrp.position.x, gGrp.position.z, 1.3, 0x38bdf8);
                        S.pop(0.55);
                        toast('🎾 丁克拉鋸開啟！ (拍數 1/3)', '蒼蠅直線柔和推回！等球落地再推！');
                    } else {
                        // 第 2 拍：蒼蠅大斜線切球
                        dinkRallyCount = 2;
                        targetX = (pPos.x > 0 ? -1.45 : 1.45) + (Math.random() - 0.5) * 0.2;
                        targetZ = 1.25 + Math.random() * 0.35;
                        spdScale = 0.68;
                        popRing(gGrp.position.x, gGrp.position.z, 1.4, 0x06b6d4);
                        S.pop(0.65);
                        toast('🎾 丁克大斜線切球！ (拍數 2/3)', '蒼蠅變線切對角！快橫移跨步推回！');
                    }
                    spinVal = (Math.random() - 0.5) * 0.06;
                    solveArc(b.x, b.y, b.z, targetX, targetZ, PH.vel, spdScale);
                    PH.spin = spinVal;
                    PH.spinInc = 0;
                    flyState = 'HOVER';
                    isChanceBall = false;
                    return;
                } else {
                    // 一般來回球：戰術性交替廚房短球 (30%) 與底線深球 (70%)
                    const shouldDink = Math.random() < 0.30;
                    if (shouldDink) {
                        targetX = THREE.MathUtils.clamp(pPos.x * 0.4 + (Math.random() - 0.5) * 1.2, -1.6, 1.6);
                        targetZ = 1.30 + Math.random() * 0.50; // 1.3m ~ 1.8m (廚房區內)
                        spdScale = 0.65; // ★ 真實柔和丁克初速
                        spinVal = 0;
                        toast('🪰 仿生蒼蠅吊短球', '廚房區丁克小球，快向前就位！');
                        dinkRallyCount = 1;
                        flyState = 'DINK_APPROACH';
                    } else {
                        targetX = (pPos.x > 0 ? -1.65 : 1.65) + (Math.random() - 0.5) * 0.30;
                        targetZ = HALF_L - 1.05 - Math.random() * 0.60; // 5.05m ~ 5.65m
                        spdScale = 1.05;
                        spinVal = (Math.random() - 0.5) * 0.15;
                        toast('🪰 仿生蒼蠅回擊', '底線壓制深球');
                        dinkRallyCount = 0;
                    }
                    popRing(gGrp.position.x, gGrp.position.z, 1.2, 0xa855f7);
                    S.pop(0.65);
                    isChanceBall = false;
                }

                // 呼叫 solveArc 精確解算彈道，禁止在解算後乘倍數破壞物理軌跡！
                solveArc(b.x, b.y, b.z, targetX, targetZ, PH.vel, spdScale);
                PH.spin = spinVal;
                PH.spinInc = 0;
                flyState = 'HOVER';
                return;
            }

            // ★ 規格 6: 前三關新手教學失誤率徹底歸零 (100% 穩健回球)；第4~5關依難度調節
            const diffMult = stage >= 4 ? (DIFF_PRESETS[diffLevel]?.missMultiplier || 1.0) : 1.0;
            let missRate = stage <= 3 ? 0 : (AI_MISS[stage] || 0.15) * diffMult;
            const incomingSpeed = PH.vel.length();
            if (incomingSpeed > 14.2 && stage >= 4) missRate += 0.11; // 僅對第4~5關玩家極速回球提升失誤率
            missRate = Math.min(missRate, 0.92);

            if (Math.random() < missRate) {
                const errType = Math.random();
                if (stage >= 4 && errType >= 0.80) {
                    gLock = 0.6;
                    if (typeof updateGooseEmote === 'function') updateGooseEmote('❓');
                    return;
                }   // 20% 慢揮漏球：沒碰到球
                planShot();
                gooseErrorHit();
                if (typeof updateGooseEmote === 'function') updateGooseEmote('💦');
                if (stage >= 4 && errType < 0.40) {
                    gooseForceNet(b);                                   // 40% 掛網 → onNet → 玩家得分
                    S.pop(0.4); toast('🪿 匹克鵝回擊掛網', '失誤');
                } else {
                    // 出界：+1.6 m 以抵銷 FAST 阻尼約 6% 的縮短，確保真的落在界外
                    solveArc(b.x, b.y, b.z, aiShot.x, HALF_L + 1.6, PH.vel);
                    S.pop(0.7); toast(stage <= 3 ? '🪿 匹克鵝回擊微出界' : '🪿 匹克鵝回擊出底線', '失誤');
                }
                return;
            }

            gLock = 0.28; pLock = 0.15; lastHitter = 'GOOSE'; rallyHits++; bounces = 0;
            if (state === 'SERVE_AIR') state = 'RALLY';
            PH.spin = 0; PH.spinInc = 0; // ★ 匹克鵝回擊時清除側旋與偏折，保證回球彈道乾淨平穩

            // 匹克鵝 AI 的丁克拉鋸邏輯 (支援 Option B: 第 4/5 關與自選難度)
            const isGooseKitchenDink = (b.z > -KITCHEN_D - 0.20);
            if (isGooseKitchenDink && stage >= 4) {
                if (dinkRallyCount >= 2) {
                    // ★ 第 3 拍：匹克鵝網前失手，浮出半高機會球！
                    aiShot.z = 2.40 + Math.random() * 0.50;
                    aiShot.x = (Math.random() - 0.5) * 1.5;
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel, 0.85);
                    PH.vel.y = Math.max(PH.vel.y, 4.4);
                    isChanceBall = true;
                    dinkRallyCount = 0;
                    popRing(gGrp.position.x, gGrp.position.z, 1.8, 0xfacc15);
                    S.pop(0.45);
                    toast('🔥 匹克鵝回擊浮高！ (CHANCE BALL)', '半高機會球！快往前凌空大揮扣殺！');
                    announceReferee('🔥 機會半高球！', '匹克鵝網前失手，抓機會扣殺！', true);
                    return;
                } else if (dinkRallyCount === 1) {
                    // ★ 第 2 拍：匹克鵝回切大斜線小球
                    dinkRallyCount = 2;
                    aiShot.z = 1.25 + Math.random() * 0.35;
                    aiShot.x = (pPos.x > 0 ? -1.45 : 1.45) + (Math.random() - 0.5) * 0.2;
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel, 0.68);
                    toast('🎾 丁克大斜線切球！ (拍數 2/3)', '匹克鵝切向對角！快橫移跨步推回！');
                    S.pop(0.60);
                    return;
                } else {
                    // ★ 第 1 拍：匹克鵝回推直線小球
                    dinkRallyCount = 1;
                    aiShot.z = 1.35 + Math.random() * 0.35;
                    aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.45 + (Math.random() - 0.5) * 0.3, -1.6, 1.6);
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel, 0.65);
                    toast('🎾 丁克拉鋸開啟！ (拍數 1/3)', '匹克鵝直線柔和推回！等球落地再推！');
                    S.pop(0.55);
                    return;
                }
            } else {
                dinkRallyCount = 0;
                isChanceBall = false;
            }

            planShot(); solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel); S.pop(0.6);
            if (S.quack && Math.random() < 0.45) S.quack();
            if (rallyHits >= 6 && typeof updateGooseEmote === 'function') updateGooseEmote('🌟');
            if (stage === 2) toast('底線深球來了', '等它落地一次,再打回去就過關');
            else if (stage === 3 || aiShot.z < KITCHEN_D) toast('匹克鵝把球吊進中興湖廚房', '等落地再打');
        }

        const pool = [];
        for (let i = 0; i < 240; i++) pool.push(new THREE.Vector3());
        function setHint(t, c) { D.hint.innerText = t; D.hint.style.color = c; }
        function updateWaistHud() {
            if (!webcamActive) return;
            const pct = THREE.MathUtils.clamp(waistLevel, -0.5, 1.3);
            D.waistMark.style.left = THREE.MathUtils.clamp((pct + 0.5) / 1.8 * 100, 0, 100) + '%';
            D.waistMark.style.background = (waistLevel < 0.08) ? '#3fe0c4' : '#f87171';
        }
/* ═══════ 軌跡預覽線（預先配置緩衝，每幀零配置） ═══════ */
const _guideP0 = new THREE.Vector3();
const ARC_MAX = 240;   // = pool.length
let arcPosAttr = null, arcDistAttr = null;
function writeArc(n) {
    if (!arcPosAttr) {
        arcPosAttr = new THREE.BufferAttribute(new Float32Array(ARC_MAX * 3), 3);
        arcDistAttr = new THREE.BufferAttribute(new Float32Array(ARC_MAX), 1);
        arcPosAttr.setUsage(THREE.DynamicDrawUsage);
        arcDistAttr.setUsage(THREE.DynamicDrawUsage);
        arc.geometry.setAttribute('position', arcPosAttr);
        arc.geometry.setAttribute('lineDistance', arcDistAttr);
        arc.frustumCulled = false;   // 頂點每幀變動，舊的 bounding sphere 會誤判剔除
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
/** 模擬並畫出預覽線；回傳 simulateFlight 結果（null = 無法預測） */
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

    // ── 示範模式：預覽電腦即將擊出的軌跡 ──
    if (isDemo && demoHold) {
        zoneServe.position.set(dDemoTgt.x, 0.012, dDemoTgt.z);
        _guideP0.set(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
        solveArc(_guideP0.x, _guideP0.y, _guideP0.z, dDemoTgt.x, dDemoTgt.z, _a);
        previewArc(_guideP0, _a, 0);
        setGuideColor(0x3fe0c4);
        return;
    }

    // ── 玩家發球預備：預覽線與合法性提示 ──
    if (ready && myServe) {
        zoneServe.position.set(diagSign() * COURT_W / 4, 0.012, -(KITCHEN_D + HALF_L) / 2);
        serveVel(power, _a);
        const r = previewArc(PH.pos, _a, getSwipeCurve());
        const willNet = !r || r.net;
        const fresh = webcamActive && serveCue.txt && (performance.now() - serveCue.t < 700);
        let msg = fresh ? serveCue.txt
            : (!webcamActive
                ? '✅ 向上推拍發球（拍面低於腰）'
                : (servePrepared ? '✅ 已解鎖,拍面低於腰後向上推拍' : '👉 請先「左手舉高」解鎖發球'));
        let col = fresh ? serveCue.col : (!webcamActive || servePrepared ? '#3fe0c4' : '#ffc857');
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

    // ── 飛行中：落點圈 ──
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

                /* ═══════════════════════════════════════════════
           榜單與社交(欄位名稱已對齊後端)
           ═══════════════════════════════════════════════ */
        /* playerId 進入 inline onclick 前只保留安全字元(前端格式為 P-XXXX-XXXX) */
        function safePid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_\-]/g, ''); }
        function safeNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }

        /* escapeHtml 已於 config.js 全域宣告 (含完整 XSS 與反引號 &#96; 防禦) */
        let socialTab = 'lb';
        function openSocial() {
            closePanel();
            document.getElementById('social-modal').style.display = 'flex';
            clearKeys();
            switchSocialTab(socialTab);
        }
        function closeSocial() { document.getElementById('social-modal').style.display = 'none'; clearKeys(); }
        function switchSocialTab(t) {
            socialTab = t;
            document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
            document.getElementById('tab-lb').style.display = (t === 'lb') ? 'block' : 'none';
            document.getElementById('tab-fr').style.display = (t === 'fr') ? 'block' : 'none';
            if (t === 'lb') { loadLeaderboard(); loadMe(); } else loadFriends();
        }
        function apiWarn(el) {
            el.innerHTML = '<div class="lb-empty">雲端英雄榜尚未啟用，目前為本機離線模式</div>';
        }
        function loadMe() {
            const card = document.getElementById('my-card');
            if (!playerProfile.playerId || !API_READY()) { card.style.display = 'none'; return; }
            apiGet('act=me&pid=' + encodeURIComponent(playerProfile.playerId)).then(r => {
                if (!r || !r.ok) { card.style.display = 'none'; return; }
                card.style.display = 'flex';
                document.getElementById('mc-rank').innerText = r.rank ? '#' + r.rank : '-';
                document.getElementById('mc-best').innerText = r.bestScore || 0;
                document.getElementById('mc-likes').innerText = r.likes || 0;
                document.getElementById('mc-sess').innerText = r.sessions || 0;
            });
        }
        function loadLeaderboard() {
            const el = document.getElementById('lb-list');
            if (!API_READY()) { apiWarn(el); return; }
            el.innerHTML = '<div class="lb-empty">載入中…</div>';
            apiGet('act=leaderboard&pid=' + encodeURIComponent(playerProfile.playerId || '')).then(r => {
                if (!r || !r.ok || !r.list || !r.list.length) {
                    el.innerHTML = '<div class="lb-empty">目前還沒有中興英雄榜紀錄!<br>通關第 5 關即可登錄</div>';
                    return;
                }
                let html = '';
                r.list.forEach((item, idx) => {
                    const rank = idx + 1;
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ('#' + rank);
                    const isMe = !!item.isMe || item.playerId === playerProfile.playerId;
                    const pid = safePid(item.playerId);
                    const fr = item.friend;                    // 後端欄位是 friend
                    const frClass = fr === 'accepted' ? 'fr-ok'
                        : (fr === 'pending' || fr === 'incoming') ? 'fr-pending' : '';
                    const frText = fr === 'accepted' ? '已是球友' : fr === 'pending' ? '已邀請'
                        : fr === 'incoming' ? '接受' : '+好友';
                    const frDis = (fr === 'accepted' || fr === 'pending') ? 'disabled' : '';
                    const frCall = fr === 'incoming'
                        ? "respondFriend('" + pid + "','accept',this)"
                        : "sendFriendReq('" + pid + "',this)";
                    const likeBtn = isMe ? '' :
                        '<button class="mini ' + (item.liked ? 'liked' : '') + '" ' + (item.liked ? 'disabled' : '') +
                        ' onclick="likePlayer(\'' + pid + '\',this)">❤️ <span>' + safeNum(item.likes) + '</span></button>';
                    const frBtn = isMe ? '' :
                        '<button class="mini ' + frClass + '" ' + frDis + ' onclick="' + frCall + '">' + frText + '</button>';
                    html += '<div class="lb-row ' + (isMe ? 'me' : '') + '">' +
                        '<div class="lb-rank">' + medal + '</div>' +
                        '<div class="lb-av">' + escapeHtml(item.avatar || '🪿') + '</div>' +
                        '<div class="lb-mid">' +
                        '<div class="lb-nick">' + escapeHtml(item.nickname || '匿名球員') + (isMe ? ' (你)' : '') + '</div>' +
                        '<div class="lb-dept">' + escapeHtml(item.department || '') + '</div>' +
                        '</div>' +
                        '<div class="lb-sc">' + safeNum(item.score) + '</div>' +
                        '<div class="lb-acts">' + likeBtn + frBtn + '</div></div>';
                });
                el.innerHTML = html;
            });
        }
        function loadFriends() {
            const el = document.getElementById('fr-list');
            if (!API_READY()) { apiWarn(el); return; }
            if (!playerProfile.playerId) {
                el.innerHTML = '<div class="lb-empty">請先設定球員檔案</div>'; return;
            }
            el.innerHTML = '<div class="lb-empty">好友名單載入中…</div>';
            apiGet('act=friends&pid=' + encodeURIComponent(playerProfile.playerId)).then(r => {
                if (!r || !r.ok) { el.innerHTML = '<div class="lb-empty">暫無好友資料</div>'; return; }
                const f = r.friends || {};
                const inc = f.incoming || [], acc = f.accepted || [], out = f.outgoing || [];
                const row = (x, actions) =>
                    '<div class="lb-row" style="cursor:pointer;" onclick="openPlayerCard(' + escapeHtml(JSON.stringify(x)) + ')" title="點擊檢視個人名片與特徵雷達圖">' +
                    '<div class="lb-av">' + escapeHtml(x.avatar || '🪿') + '</div>' +
                    '<div class="lb-mid">' +
                    '<div class="lb-nick">' + escapeHtml(x.nickname || '—') + '</div>' +
                    '<div class="lb-dept">' + escapeHtml(x.department || '') + '</div>' +
                    '</div>' +
                    '<div class="lb-sc">' + safeNum(x.score) + '</div>' +
                    '<div class="lb-acts">' + (actions || '<span class="card-act-pill">🪪 名片</span>') + '</div></div>';
                let html = '';
                if (inc.length) {
                    html += '<div class="fr-sec-t">📥 待你確認 (' + inc.length + ')</div>';
                    html += inc.map(x => row(x,
                        '<button class="mini fr-pending" onclick="respondFriend(\'' + safePid(x.playerId) + '\',\'accept\',this)">接受</button>')).join('');
                }
                html += '<div class="fr-sec-t">✓ 我的球友 (' + acc.length + ')</div>';
                html += acc.length ? acc.map(x => row(x, '')).join('')
                    : '<div class="lb-empty">還沒有球友,到英雄榜送出邀請吧!</div>';
                if (out.length) {
                    html += '<div class="fr-sec-t">📤 已送出 (' + out.length + ')</div>';
                    html += out.map(x => row(x, '<button class="mini fr-pending" disabled>⏳</button>')).join('');
                }
                el.innerHTML = html;
            });
        }
        /* 樂觀更新:GAS 回應約 1~3 秒,不先動 UI 體感會很鈍 */
        function likePlayer(targetPid, btn) {
            if (!API_READY() || !playerProfile.playerId) return;
            const span = btn.querySelector('span');
            const before = span ? span.innerText : '0';
            btn.disabled = true; btn.classList.add('liked');
            if (span) span.innerText = (parseInt(before, 10) || 0) + 1;
            S.like();
            postSigned({ act: 'like', playerId: playerProfile.playerId, toId: targetPid }).then(r => {
                if (r && r.ok) { if (span) span.innerText = r.likes; return; }
                if (span) span.innerText = before;
                btn.disabled = false; btn.classList.remove('liked');
                toast('按讚失敗', (r && r.err) ? errMsg(r.err) : '請稍後再試');
            });
        }
        function sendFriendReq(targetPid, btn) {
            if (!API_READY() || !playerProfile.playerId) return;
            btn.disabled = true; btn.className = 'mini fr-pending'; btn.innerText = '送出中';
            postSigned({ act: 'friendReq', playerId: playerProfile.playerId, toId: targetPid }).then(r => {
                if (r && r.ok) {
                    if (r.status === 'accepted') {
                        btn.className = 'mini fr-ok'; btn.innerText = '已是球友';
                        toast('🎉 已成為球友', '對方先前也邀請過你');
                    } else { btn.innerText = '已邀請'; toast('好友邀請已送出', '等待對方確認'); }
                } else {
                    btn.disabled = false; btn.className = 'mini'; btn.innerText = '+好友';
                    toast('邀請失敗', (r && r.err) ? errMsg(r.err) : '請稍後再試');
                }
            });
        }
        function respondFriend(targetPid, action, btn) {
            if (!API_READY() || !playerProfile.playerId) return;
            if (action !== 'accept') { toast('後端尚未支援拒絕', '目前只能接受或忽略'); return; }
            btn.disabled = true; btn.innerText = '處理中';
            postSigned({ act: 'friendAccept', playerId: playerProfile.playerId, toId: targetPid }).then(r => {
                if (r && r.ok) { toast('🎉 已成為球友!', ''); loadFriends(); }
                else { btn.disabled = false; btn.innerText = '接受'; toast('確認失敗', (r && r.err) ? errMsg(r.err) : '請稍後再試'); }
            });
        }
        function submitScoreToCloud(score) {
            if (typeof FunMode !== 'undefined' && FunMode.usedForcedItem) { toast('🧪 本局使用過試用道具', '成績不列入英雄榜'); return; }
            if (window.CUSTOM_MODEL_ACTIVE) { toast('🛠️ 教練參數模式', '成績不列入英雄榜'); return; }
            if (!playerProfile.playerId) { toast('未登入,成績未上傳', ''); return; }
            if (!API_READY()) { toast('本機離線模式', '通關得分: ' + score); return; }

            // 前端物理合理性防禦檢驗
            const numScore = Math.floor(Number(score));
            if (isNaN(numScore) || numScore < 0 || numScore > 5) {
                toast('⚠️ 成績異常', '得分超出賽事有效物理範圍');
                return;
            }
            if (stage !== 5 && stage !== 6) {
                toast('⚠️ 關卡異常', '僅第 5、6 關計分賽可登錄英雄榜');
                return;
            }

            postSigned({
                act: 'submit',
                playerId: playerProfile.playerId, sessionId: playerProfile.sessionId,
                avatar: playerProfile.avatar, nickname: playerProfile.nickname,
                department: playerProfile.department, grade: playerProfile.grade,
                deptCode: playerProfile.deptCode,
                entryYear: playerProfile.entryYear, score: numScore, stage: stage,
                aimMode: AIM.mode, teachLevel: TEACH.level, perfLevel: perfLevel,
                webcamUsed: webcamActive, device: IS_MOBILE ? 'mobile' : 'desktop'
            }).then(r => {
                if (r && r.ok) toast('✨ 戰績已登錄中興英雄榜!', '最佳成績 ' + r.bestScore + ' · 點社交查看排名');
                else if (r && r.err === 'TIMEOUT') toast('⏳ 連線逾時', '成績可能已送出，請先重新整理英雄榜確認');
                else toast('登錄失敗', (r && r.err) ? errMsg(r.err) : '請稍後再試');
            });
        }

        /* ═══════ 主迴圈 ═══════ */
        let camX = 0, last = performance.now();
        const _camDesPos = new THREE.Vector3(), _camDesLook = new THREE.Vector3();
        const _camNormPos = new THREE.Vector3(), _camNormLook = new THREE.Vector3();
        let loopFrameCount = 0;
        const camLookTarget = new THREE.Vector3(0, 0.85, 0.3);
        const huntCamPos = new THREE.Vector3();
        const huntCamLook = new THREE.Vector3();
        let huntCamActive = false;
        let huntReturnTimer = 0;
        let cachedMiniSpd = null, cachedMiniPwr = null;

        function loop() {
            requestAnimationFrame(loop);
            const now = performance.now();
            let dt = (now - last) / 1000; last = now;
            if (dt > 0.05) dt = 0.05;

            if (pLock > 0) pLock = Math.max(0, pLock - dt);
            if (gLock > 0) gLock = Math.max(0, gLock - dt);
            if (serveCooldown > 0) serveCooldown = Math.max(0, serveCooldown - dt);
            if (swingT > 0) swingT = Math.max(0, swingT - dt);
            if (shake > 0) shake = Math.max(0, shake - dt * 1.6);
            if (ballSquash > 0) ballSquash = Math.max(0, ballSquash - dt * 6);

            if (demoOn) runDemo(dt);
            updateCamCustom(dt);
            updatePlayer(dt);

            if (charging) {
                power += powerDir * 150 * dt;
                if (power >= 100) { power = 100; powerDir = -1; }
                if (power <= 0) { power = 0; powerDir = 1; }
                D.pFill.style.width = power.toFixed(1) + '%';
                if (!cachedMiniPwr) cachedMiniPwr = document.getElementById('mini-pwr-val');
                if (cachedMiniPwr) cachedMiniPwr.innerText = power.toFixed(0) + '%';
            }

            PH.update(dt); tryHit(); updateGoose(dt); updateGuides(dt);
            if (typeof FunMode !== 'undefined') FunMode.update(dt);
            updateAimZones(dt); updateRings(dt);

            // 速度儀表文字降頻更新 (每 4 幀更新一次，徹底消除 Layout Reflow 造成的掉幀)
            if ((loopFrameCount++ & 3) === 0) {
                const mphStr = (PH.vel.length() * 2.23694).toFixed(1);
                if (D.sp) D.sp.innerText = mphStr;
                if (!cachedMiniSpd) cachedMiniSpd = document.getElementById('mini-spd-val');
                if (cachedMiniSpd) cachedMiniSpd.innerText = mphStr + ' mph';

                // 更新神經示波器遙測文字
                if (window.FLY_BRAIN && typeof diffLevel !== 'undefined' && diffLevel === 'fly') {
                    FLY_BRAIN.updateDomReadouts();
                }
            }

            // 即時渲染果蠅神經電生理示波器 Canvas (60FPS 流暢波形)
            if (window.FLY_BRAIN && diffLevel === 'fly') {
                if (!loop.snnC) { loop.snnC = document.getElementById('fly-snn-canvas'); loop.snnHud = document.getElementById('fly-snn-hud'); }
                if (loop.snnHud && loop.snnHud.style.display !== 'none') FLY_BRAIN.renderOscilloscope(loop.snnC);
            }

            const k = 1 - Math.pow(0.01, dt);
            camX += (pPos.x * 0.3 - camX) * k;
            const sx = (Math.random() - 0.5) * shake;
            const sy = (Math.random() - 0.5) * shake * 0.7;

            const isHuntingCam = (typeof FunMode !== 'undefined' && FunMode.activeBuff === 'ELECTRIC_SWATTER');
            if (isHuntingCam) {
                huntReturnTimer = 0.45; // 標記離開追殺時需平滑回航
                const targetObj = (typeof gGrp !== 'undefined' && gGrp) ? gGrp.position : { x: 0, z: -HALF_L * 0.7 };
                const desiredPos = _camDesPos;
                const desiredLook = _camDesLook;

                if (typeof FunMode !== 'undefined' && (FunMode.isFaceOff || FunMode.isKODeathSequence)) {
                    // ★ 近身對峙階段 / 處決死亡特寫：精準對決特寫 (鏡頭高度 2.05m、身後 2.7m，若在處決墜地時視線平順微俯向地面焦黑死蒼蠅)
                    const lookY = (typeof FunMode !== 'undefined' && FunMode.isKODeathSequence) ? 0.35 : 1.25;
                    desiredPos.set(pPos.x * 0.45 + sx * 0.05, 2.05 + sy * 0.05, pPos.z + 2.7);
                    desiredLook.set(targetObj.x, lookY, targetObj.z);
                } else {
                    // ★ 跨網衝鋒階段：第三人稱動態越肩追擊視角 (高度 3.25m、身後 4.2m，視野開闊清爽，清晰看清球網、地面跑道與前方蒼蠅)
                    desiredPos.set(pPos.x * 0.55 + sx * 0.06, 3.25 + sy * 0.06, pPos.z + 4.2);
                    const lookAheadZ = Math.min(pPos.z - 4.5, targetObj.z);
                    desiredLook.set(targetObj.x * 0.35 + pPos.x * 0.65, 1.20, lookAheadZ);
                }

                if (!huntCamActive) {
                    huntCamActive = true;
                    huntCamPos.copy(cam.position);
                    huntCamLook.set(camX * 0.25, 0.85, -0.4);
                }

                // 舒適平滑漸進 (Smooth Lerp，約 0.35 秒平順拉近，徹底告別貼臉爆衝感)
                const lerpSpd = Math.min(1.0, dt * 7.5);
                huntCamPos.lerp(desiredPos, lerpSpd);
                huntCamLook.lerp(desiredLook, lerpSpd);

                cam.position.copy(huntCamPos);
                cam.lookAt(huntCamLook);
            } else if (camViewMode === 0) {
                // ★ 智慧超感相機 (相機位置平滑追蹤)
                const cfg = camCfgCache || getResponsiveCameraConfig();
                const normalTargetPos = _camNormPos.set(camX * 0.4 + sx, cfg.camH + sy, cfg.camDist);
                const normalTargetLook = _camNormLook.set(camX * 0.25, cfg.lookY, cfg.lookZ);

                if (huntReturnTimer > 0) {
                    huntReturnTimer -= dt;
                    // 從追殺鏡頭平滑退回到正常高空賽事視角
                    const returnLerp = Math.min(1.0, dt * 5.5);
                    cam.position.lerp(normalTargetPos, returnLerp);
                    camLookTarget.lerp(normalTargetLook, returnLerp);
                    cam.lookAt(camLookTarget);
                } else {
                    huntCamActive = false;
                    cam.position.copy(normalTargetPos);
                    cam.lookAt(normalTargetLook);
                }
            } else if (camViewMode === 1) {
                cam.position.set(sx, 14.5 + sy, 7.5);
                cam.lookAt(0, 0, -1.0);
            } else if (camViewMode === 2) {
                // Mode 2: 沉浸越肩
                cam.position.set(pPos.x * 0.75 + 0.35 + sx, 1.55 + sy, pPos.z + 3.2);
                cam.lookAt(pPos.x * 0.45, 0.95, -3.5);
            } else if (camViewMode === 3) {
                cam.position.set(7.8 + sx, 4.5 + sy, 0);
                cam.lookAt(0, 0.8, 0);
            } else {
                // ★ 自訂視角:平滑動態追蹤主角位置 (Smooth Lerp Tracking)
                const cxp = Math.sin(camCustom.yaw) * camCustom.dist;
                const czp = Math.cos(camCustom.yaw) * camCustom.dist;
                cam.position.set(cxp + sx, camCustom.h + sy, czp);
                camLookTarget.x += (pPos.x * 0.35 - camLookTarget.x) * Math.min(1, dt * 4.5);
                camLookTarget.z += (pPos.z * 0.25 - 0.3 - camLookTarget.z) * Math.min(1, dt * 4.5);
                cam.lookAt(camLookTarget.x, 0.85, camLookTarget.z);
            }

            // ═══════ 活潑環境動畫 (Living World Updates) ═══════
            // 1. 湖水水波細膩平移
            if (waterTexRef) {
                waterTexRef.offset.x = (waterTexRef.offset.x + dt * 0.015) % 1;
                waterTexRef.offset.y = (waterTexRef.offset.y + dt * 0.012) % 1;
            }
            // 2. 睡蓮與荷花隨波輕晃
            if (lilyPads && lilyPads.length) {
                const nowSec = now * 0.001;
                for (let i = 0; i < lilyPads.length; i++) {
                    const lp = lilyPads[i];
                    lp.mesh.rotation.y = lp.baseRot + Math.sin(nowSec * 0.8 + lp.phase) * 0.05;
                    lp.mesh.position.y = -0.025 + Math.sin(nowSec * 1.2 + lp.phase) * 0.006;
                }
            }
            // 3. 觀眾小鴨加油歡呼節奏微動
            if (spectatorDucklings && spectatorDucklings.length) {
                const nowSec = now * 0.001;
                for (let i = 0; i < spectatorDucklings.length; i++) {
                    const sd = spectatorDucklings[i];
                    const cheer = (pLock > 0 || gLock > 0) ? 2.5 : 1.0;
                    sd.grp.position.y = sd.baseY + Math.abs(Math.sin(nowSec * 3.5 * cheer + sd.phase)) * (0.04 * cheer);
                }
            }
            // 4. 村長鵝頭頂對話氣泡跟隨與計時
            if (gooseEmoteSprite && gooseEmoteSprite.visible) {
                if (gGrp) {
                    gooseEmoteSprite.position.set(gGrp.position.x, 2.15 + Math.sin(now * 0.006) * 0.06, gGrp.position.z + 0.15);
                }
                if (gooseEmoteTimer > 0) {
                    gooseEmoteTimer -= dt;
                    if (gooseEmoteTimer <= 0) gooseEmoteSprite.visible = false;
                }
            }

            ren.render(scene, cam);
        }

        /* ═══════════ 拍立得完賽紀念卡 (Polaroid Souvenir) ═══════════ */
        let lastSouvenirWon = true, lastSouvenirP = 3, lastSouvenirA = 1;
        let lastSouvenirSnapshotCanvas = null;

        function showPolaroidSouvenir(won, pScore, aScore) {
            lastSouvenirWon = !!won;
            lastSouvenirP = pScore;
            lastSouvenirA = aScore;
            const modal = document.getElementById('polaroid-modal');
            if (!modal) return;
            const canvas = document.getElementById('polaroid-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const cw = canvas.width = 600;
            const ch = canvas.height = 420;

            // 1. 擷取 WebGL 3D 畫面 (Aspect-Ratio Cover 裁切，杜絕直式手機橫向擠壓變形)
            try {
                if (ren && ren.domElement) {
                    ren.render(scene, cam);
                    const sw = ren.domElement.width, sh = ren.domElement.height;
                    const tar = cw / ch, sar = sw / sh;
                    let sx = 0, sy = 0, scw = sw, sch = sh;
                    if (sar > tar) {
                        scw = sh * tar;
                        sx = (sw - scw) / 2;
                    } else {
                        sch = sw / tar;
                        sy = Math.max(0, (sh - sch) * 0.40);
                    }
                    ctx.drawImage(ren.domElement, sx, sy, scw, sch, 0, 0, cw, ch);

                    // ★ 同步產生 2K 高解析度快照離線畫布 (1440 x 860) 供下載時無損重現
                    const snapCanvas = document.createElement('canvas');
                    snapCanvas.width = 1440; snapCanvas.height = 860;
                    const scx = snapCanvas.getContext('2d');
                    scx.imageSmoothingEnabled = true;
                    scx.imageSmoothingQuality = 'high';
                    const star = 1440 / 860;
                    let ssx = 0, ssy = 0, sscw = sw, ssch = sh;
                    if (sar > star) {
                        sscw = sh * star;
                        ssx = (sw - sscw) / 2;
                    } else {
                        ssch = sw / star;
                        ssy = Math.max(0, (sh - ssch) * 0.40);
                    }
                    scx.drawImage(ren.domElement, ssx, ssy, sscw, ssch, 0, 0, 1440, 860);
                    lastSouvenirSnapshotCanvas = snapCanvas;
                }
            } catch (e) {
                console.warn('3D screen capture failed, using gradient fallback', e);
                const grad = ctx.createLinearGradient(0, 0, 0, ch);
                grad.addColorStop(0, '#7dd3fc');
                grad.addColorStop(1, '#86efac');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, cw, ch);
            }

            // 2. 柔和暗角與照片光暈 (Soft Vignette)
            const vig = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.25, cw / 2, ch / 2, cw * 0.7);
            vig.addColorStop(0, 'rgba(0,0,0,0)');
            vig.addColorStop(1, 'rgba(15,23,42,0.38)');
            ctx.fillStyle = vig;
            ctx.fillRect(0, 0, cw, ch);

            // 3. 頂部中興大學匹克球社群標籤徽章 (NCHU Community Header Badge)
            ctx.fillStyle = 'rgba(20, 40, 32, 0.92)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.roundRect(16, 16, 260, 36, 18);
            ctx.fill();
            ctx.strokeStyle = 'rgba(246, 196, 69, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#f6c445';
            ctx.font = 'bold 14px "Barlow Condensed", system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('🎾 NCHU PICKLEBALL COMMUNITY', 30, 34);

            // 4. 右下角高對比立體金箔比分徽章 (3D Gold Foil Match Score Badge)
            const bw = 170, bh = 46, bx = cw - bw - 14, by = ch - bh - 14;
            const bgGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
            bgGrad.addColorStop(0, '#064e3b');
            bgGrad.addColorStop(1, '#022c22');
            ctx.fillStyle = bgGrad;
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 14);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fef08a';
            ctx.font = '800 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🏆 MATCH RESULT', bx + bw / 2, by + 14);

            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 22px "Barlow Condensed", system-ui, sans-serif';
            ctx.fillText('FINAL  ' + pScore + '  :  ' + aScore, bx + bw / 2, by + 34);

            // 5. 更新 DOM 模態文字、個人頭像暱稱與印章
            const avatarEl = document.getElementById('polaroid-avatar-preview');
            const nickEl = document.getElementById('polaroid-nick-preview');
            const deptEl = document.getElementById('polaroid-dept-preview');
            const scoreEl = document.getElementById('polaroid-score-preview');
            if (avatarEl) avatarEl.innerText = (typeof playerProfile !== 'undefined' && playerProfile.avatar) ? playerProfile.avatar : '🧢';
            if (nickEl) nickEl.innerText = (typeof playerProfile !== 'undefined' && playerProfile.nickname) ? playerProfile.nickname : '興大匹克球神';
            if (deptEl) deptEl.innerText = (typeof playerProfile !== 'undefined' && playerProfile.department) ? (playerProfile.department + ' · 國立中興大學') : '國立中興大學匹克球社群';
            if (scoreEl) scoreEl.innerText = 'FINAL ' + pScore + ' : ' + aScore;

            const dateEl = document.getElementById('polaroid-date');
            if (dateEl) {
                const now = new Date();
                dateEl.innerText = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' · 中興湖畔 晴天 26°C';
            }

            const stampEl = document.getElementById('polaroid-stamp');
            const msgEl = document.getElementById('polaroid-msg');
            if (stampEl && msgEl) {
                if (won) {
                    stampEl.innerText = 'VICTORY!';
                    stampEl.style.color = '#10b981';
                    stampEl.style.borderColor = '#10b981';
                    msgEl.innerText = '「太精彩了！村長鵝為你熱烈鼓掌，中興大學的球迷們都為你的球技歡呼！」';
                    if (S && S.fanfare) S.fanfare();
                } else {
                    stampEl.innerText = 'NICE PLAY!';
                    stampEl.style.color = '#f59e0b';
                    stampEl.style.borderColor = '#f59e0b';
                    msgEl.innerText = '「這是一場超棒的友誼賽！村長鵝給了你一個大大的擁抱，休息一下再來挑戰吧～」';
                    if (S && S.point) S.point();
                }
            }

            if (S && S.shutter) setTimeout(() => S.shutter(), 250);
            modal.style.display = 'flex';
        }

        function closePolaroidModal() {
            const modal = document.getElementById('polaroid-modal');
            if (modal) modal.style.display = 'none';
            if (state === 'CLEARED') {
                if (stage < 5) {
                    switchStage(stage + 1, { fromClear: true });
                } else if (stage === 5) {
                    if (typeof submitScoreToCloud === 'function') submitScoreToCloud(pScore);
                    switchStage(6, { fromClear: true });
                } else {
                    resetServe();
                }
            } else if (state === 'OVER') {
                switchStage(stage);
            }
        }

        function downloadPolaroid() {
            try {
                // ★ 2K 超取樣高解析度完整拍立得畫布 (1600 x 1350)
                const fullCanvas = document.createElement('canvas');
                fullCanvas.width = 1600;
                fullCanvas.height = 1350;
                const fx = fullCanvas.getContext('2d');
                fx.imageSmoothingEnabled = true;
                fx.imageSmoothingQuality = 'high';

                // 1. 溫潤拍立得米白藝術相紙底襯 (Warm Fine Art Paper)
                fx.fillStyle = '#fcfbf7';
                fx.beginPath();
                fx.roundRect(0, 0, 1600, 1350, 36);
                fx.fill();
                fx.strokeStyle = '#e2ded6';
                fx.lineWidth = 4;
                fx.stroke();

                // 2. 頂部立體木質圖釘 (Wooden Pin)
                fx.font = '72px system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.textBaseline = 'middle';
                fx.fillText('📌', 800, 52);

                // 3. 標頭文字 (Header Title & Date)
                fx.fillStyle = '#334155';
                fx.font = 'bold 36px "Barlow Condensed", system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.fillText('國立中興大學匹克球學習社群 · 友誼錦標賽', 800, 102);

                const now = new Date();
                const dateStr = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' · 中興湖水上特訓球場 · 晴天 26°C';
                fx.fillStyle = '#64748b';
                fx.font = '600 22px system-ui, sans-serif';
                fx.fillText(dateStr, 800, 138);

                // 4. 繪製 3D 照片主體區域 (Photo Area: 1440 x 860)
                const px = 80, py = 165, pw = 1440, ph = 860;
                fx.save();
                fx.beginPath();
                fx.roundRect(px, py, pw, ph, 20);
                fx.clip();

                // 擷取 3D WebGL 畫面 (優先使用結算當下等比例無變形快照)
                if (lastSouvenirSnapshotCanvas) {
                    fx.drawImage(lastSouvenirSnapshotCanvas, px, py, pw, ph);
                } else if (ren && ren.domElement) {
                    try {
                        const sw = ren.domElement.width, sh = ren.domElement.height;
                        const star = pw / ph, sar = sw / sh;
                        let ssx = 0, ssy = 0, sscw = sw, ssch = sh;
                        if (sar > star) {
                            sscw = sh * star;
                            ssx = (sw - sscw) / 2;
                        } else {
                            ssch = sw / star;
                            ssy = Math.max(0, (sh - ssch) * 0.40);
                        }
                        fx.drawImage(ren.domElement, ssx, ssy, sscw, ssch, px, py, pw, ph);
                    } catch(e) {
                        const fallbackGrad = fx.createLinearGradient(px, py, px, py + ph);
                        fallbackGrad.addColorStop(0, '#0284c7');
                        fallbackGrad.addColorStop(1, '#059669');
                        fx.fillStyle = fallbackGrad;
                        fx.fillRect(px, py, pw, ph);
                    }
                }

                // 照片暗角 (Vignette)
                const vig = fx.createRadialGradient(px + pw / 2, py + ph / 2, pw * 0.28, px + pw / 2, py + ph / 2, pw * 0.72);
                vig.addColorStop(0, 'rgba(0,0,0,0)');
                vig.addColorStop(1, 'rgba(15,23,42,0.42)');
                fx.fillStyle = vig;
                fx.fillRect(px, py, pw, ph);

                // 左上角官方徽章 (Top-Left Pill)
                fx.fillStyle = 'rgba(20, 40, 32, 0.92)';
                fx.beginPath();
                fx.roundRect(px + 30, py + 30, 480, 58, 29);
                fx.fill();
                fx.strokeStyle = 'rgba(246, 196, 69, 0.75)';
                fx.lineWidth = 2.5;
                fx.stroke();
                fx.fillStyle = '#f6c445';
                fx.font = 'bold 24px "Barlow Condensed", system-ui, sans-serif';
                fx.textAlign = 'left';
                fx.textBaseline = 'middle';
                fx.fillText('🎾 NCHU PICKLEBALL COMMUNITY · OFFICIAL SOUVENIR', px + 52, py + 59);

                // 右下角立體金箔比分勳章 (Bottom-Right 3D Gold Foil Score Badge)
                const sbw = 340, sbh = 96, sbx = px + pw - sbw - 30, sby = py + ph - sbh - 30;
                const sbGrad = fx.createLinearGradient(sbx, sby, sbx, sby + sbh);
                sbGrad.addColorStop(0, '#064e3b');
                sbGrad.addColorStop(1, '#022c22');
                fx.fillStyle = sbGrad;
                fx.beginPath();
                fx.roundRect(sbx, sby, sbw, sbh, 24);
                fx.fill();
                fx.strokeStyle = '#facc15';
                fx.lineWidth = 4;
                fx.stroke();

                fx.fillStyle = '#fef08a';
                fx.font = '800 18px system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.fillText('🏆 MATCH RESULT', sbx + sbw / 2, sby + 30);

                fx.fillStyle = '#facc15';
                fx.font = 'bold 44px "Barlow Condensed", system-ui, sans-serif';
                fx.fillText('FINAL  ' + lastSouvenirP + '  :  ' + lastSouvenirA, sbx + sbw / 2, sby + 72);

                fx.restore();

                // 5. 拍立得下方個人化玩家資訊與官方認證印章 (Classic Bottom Margin)
                const pAvatar = (typeof playerProfile !== 'undefined' && playerProfile.avatar) ? playerProfile.avatar : '🧢';
                const pNick = (typeof playerProfile !== 'undefined' && playerProfile.nickname) ? playerProfile.nickname : '興大匹克球神';
                const pDept = (typeof playerProfile !== 'undefined' && playerProfile.department) ? (playerProfile.department + ' · 國立中興大學') : '國立中興大學匹克球社群';
                const pId = (typeof playerProfile !== 'undefined' && playerProfile.playerId) ? ('ID: ' + playerProfile.playerId) : 'ID: NCHU-2026';

                // 玩家頭像圈
                const avX = 140, avY = 1145, avR = 48;
                fx.fillStyle = '#e2e8f0';
                fx.beginPath();
                fx.arc(avX, avY, avR, 0, Math.PI * 2);
                fx.fill();
                fx.strokeStyle = '#10b981';
                fx.lineWidth = 4;
                fx.stroke();

                fx.font = '52px system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.textBaseline = 'middle';
                fx.fillText(pAvatar, avX, avY + 2);

                // 玩家名稱與系級
                fx.textAlign = 'left';
                fx.fillStyle = '#0f172a';
                fx.font = 'bold 36px system-ui, sans-serif';
                fx.fillText(pNick, avX + 64, avY - 14);

                fx.fillStyle = '#64748b';
                fx.font = '600 22px system-ui, sans-serif';
                fx.fillText(pDept + '   |   ' + pId, avX + 66, avY + 26);

                // 右側官方印章 (Stamp)
                fx.save();
                fx.translate(1420, 1145);
                fx.rotate(-0.16); // 逆時針傾斜 9 度
                const stampWon = lastSouvenirWon;
                const stampCol = stampWon ? '#dc2626' : '#d97706';
                fx.strokeStyle = stampCol;
                fx.fillStyle = stampCol;
                fx.lineWidth = 4;
                fx.beginPath();
                fx.arc(0, 0, 72, 0, Math.PI * 2);
                fx.stroke();
                fx.lineWidth = 2;
                fx.beginPath();
                fx.arc(0, 0, 64, 0, Math.PI * 2);
                fx.stroke();

                fx.font = 'bold 12px "Barlow Condensed", system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.fillText('★ NATIONAL CHUNG HSING UNIV ★', 0, -42);

                fx.font = '900 32px "Barlow Condensed", system-ui, sans-serif';
                fx.fillText(stampWon ? 'VICTORY!' : 'NICE PLAY!', 0, 2);

                fx.font = '800 13px system-ui, sans-serif';
                fx.fillText(stampWon ? 'OFFICIAL CERTIFIED' : 'FRIENDLY MATCH', 0, 40);
                fx.restore();

                // 最底部版權與社群浮水印
                fx.fillStyle = '#94a3b8';
                fx.font = '600 18px "Barlow Condensed", system-ui, sans-serif';
                fx.textAlign = 'center';
                fx.fillText('NCHU PICKLEBALL LEARNING COMMUNITY · OFFICIAL SOUVENIR POSTCARD · ZHONGXING LAKE ARENA', 800, 1315);

                // 6. 下載完整 2K 高清圖片
                const link = document.createElement('a');
                link.download = 'NCHU-Pickleball-Souvenir-' + (pNick.replace(/\s+/g, '_')) + '-' + Date.now() + '.png';
                link.href = fullCanvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                if (typeof toast === 'function') toast('📸 2K 高清紀念卡已儲存', '完整相紙、比分勳章與個人頭像已匯出！');
            } catch (e) {
                console.error('Download high-res polaroid failed', e);
            }
        }

        window.showPolaroidSouvenir = showPolaroidSouvenir;
        window.closePolaroidModal = closePolaroidModal;
        window.downloadPolaroid = downloadPolaroid;
        window.updateGooseEmote = updateGooseEmote;

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

        window.addEventListener('resize', handleStageResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(handleStageResize, 150);
        });
        if (typeof ResizeObserver !== 'undefined') {
            const stageObserver = new ResizeObserver(() => handleStageResize());
            const sEl = document.getElementById('stage3d') || document.getElementById('game-container');
            if (sEl) stageObserver.observe(sEl);
        }

        
        /* ═══════════════════════════════════════════════
           🛡️ DOM 崩潰防禦與安全更新函式
           ═══════════════════════════════════════════════ */
        function updatePlayerWhoLabel() {
            if (typeof playerProfile !== 'undefined' && playerProfile)
                updateWhoLabel(playerProfile.nickname, playerProfile.avatar);
        }


/* ═══════ 遊戲啟動進入點與鍵盤事件監聽 ═══════ */
        /* ═══════ 啟動 ═══════ */
        loadAudioPrefs();
        loadCamCustom();
        loadCustomMotionModel();
        buildDeptOptions();
        buildAvatarGrids();
        loadAuditCache();
        updatePlayerWhoLabel();
        initFingerTutorial();
        initLayoutMode();
        initCardResize();

        document.getElementById('user-sid').addEventListener('input', e => onSidInput(e.target.value));
        document.getElementById('user-dept-sel').addEventListener('change', e => {
            e.target.dataset.touched = 'true'; onDeptSelect();
        });
        document.getElementById('user-grade-sel').addEventListener('change', e => {
            e.target.dataset.touched = 'true';
        });

        const savedIdentity = loadIdentity();
        if (savedIdentity && savedIdentity.department) {
            if (savedIdentity.avatar && AVATARS.indexOf(savedIdentity.avatar) >= 0) {
                playerProfile.avatar = savedIdentity.avatar;
            }
            if (savedIdentity.ig) playerProfile.ig = savedIdentity.ig;
            if (savedIdentity.nickname) {
                playerProfile.nickname = savedIdentity.nickname;
                document.getElementById('user-nick').value = savedIdentity.nickname;
                checkAdminAccess(savedIdentity.nickname);
            }
            if (savedIdentity.sidPrefix) {
                document.getElementById('user-sid').value = savedIdentity.sidPrefix;
                onSidInput(savedIdentity.sidPrefix);
            }
            buildAvatarGrids();

            // 設置快速開局卡片內容並顯示
            document.getElementById('quick-avatar').innerText = playerProfile.avatar || '🪿';
            document.getElementById('quick-nickname').innerText = savedIdentity.nickname || '叫獸aka愛叫的野獸';
            document.getElementById('quick-dept').innerText = (savedIdentity.department || '') + (savedIdentity.sidPrefix ? ' · ' + savedIdentity.sidPrefix : '');
            document.getElementById('quick-pid').innerText = '裝置 Token: ' + (savedIdentity.playerId || getOrCreatePlayerId());
            document.getElementById('login-quick-box').style.display = 'block';
            document.getElementById('login-full-form').style.display = 'none';
        } else {
            if (savedIdentity) {
                if (savedIdentity.avatar && AVATARS.indexOf(savedIdentity.avatar) >= 0) {
                    playerProfile.avatar = savedIdentity.avatar;
                }
                if (savedIdentity.sidPrefix) {
                    document.getElementById('user-sid').value = savedIdentity.sidPrefix;
                    onSidInput(savedIdentity.sidPrefix);
                }
                buildAvatarGrids();
            }
            document.getElementById('login-quick-box').style.display = 'none';
            document.getElementById('login-full-form').style.display = 'block';
        }

        init3D();
        setupInput();
        applyPerfPreset(perfLevel);
        syncPerfButtons();
        syncAimPips();
        syncBottomCollapseUI();
        if (typeof syncJoySpeedUI === 'function') syncJoySpeedUI();
        if (typeof syncNetAssistUI === 'function') syncNetAssistUI();
        syncPhysicsModeUI();
        syncSubbarStates();
        updateCamEditUI();
        loop();
