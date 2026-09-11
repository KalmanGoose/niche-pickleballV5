/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 3D 渲染主引擎、匹克鵝 AI 與遊戲主迴圈 (Game Engine)
   ═══════════════════════════════════════════════════════════════════ */
/* ═══════ 教學寬容度設定 ═══════ */
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
        let zoneServe, arc, ringLand, ringSpot, warnKitchen, rings = [];

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
            g.addColorStop(0, '#267cb5'); g.addColorStop(0.34, '#53a5df');
            g.addColorStop(0.62, '#8ecaf0'); g.addColorStop(0.84, '#cfeefa'); g.addColorStop(1, '#e5f6fd');
            x.fillStyle = g; x.fillRect(0, 0, 8, 256);
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            return t;
        }
        let TEX_GLOW, TEX_BLOB;

        /* ★ v5.0.14: 智慧相機自適應解算器 (動態適配手機直向/橫向，全視角清楚呈現主角、球拍與球場全景) */
        function getResponsiveCameraConfig() {
            const w = window.innerWidth, h = window.innerHeight;
            const aspect = w / h;
            const isMob = w <= 950 || h <= 550 || (typeof IS_MOBILE !== 'undefined' && IS_MOBILE);

            if (!isMob) {
                // 桌機寬螢幕：舒適全景
                return { fov: 50, camH: 8.5, camDist: 14.5, lookY: 0.80, lookZ: -0.5, ballScale: 1.0, glowScale: 7, glowOpacity: 0.26 };
            }

            if (aspect < 0.95) {
                // ★ 手機直向模式 (Portrait): 視角拉高後移，底線發球站位(x=±1.5, z=7.05)的球員全身、球拍、整個球網與對手完全清晰入鏡！
                const targetHFOVRad = 48 * Math.PI / 180;
                const vFOVRad = 2 * Math.atan(Math.tan(targetHFOVRad / 2) / aspect);
                const fov = Math.min(84, Math.max(60, vFOVRad * 180 / Math.PI));
                return { fov: fov, camH: 9.2, camDist: 15.6, lookY: 0.85, lookZ: -0.4, ballScale: 1.25, glowScale: 8, glowOpacity: 0.35 };
            } else {
                // ★ 手機橫向模式 (Landscape): 視角適度拉高並後移，球員全身、球拍與對手居中寬裕入鏡，完美開闊
                return { fov: 48, camH: 8.8, camDist: 14.8, lookY: 0.85, lookZ: -0.5, ballScale: 1.20, glowScale: 7.5, glowOpacity: 0.32 };
            }
        }

        function init3D() {
            scene = new THREE.Scene();
            scene.background = skyTex();
            scene.fog = new THREE.Fog(0xc3ddee, GRADE.fogNear, GRADE.fogFar);

            const camCfg = getResponsiveCameraConfig();
            cam = new THREE.PerspectiveCamera(camCfg.fov, window.innerWidth / window.innerHeight, 0.1, 200);
            cam.position.set(0, camCfg.camH, camCfg.camDist);
            try {
                ren = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
            } catch (e) {
                document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
                    'padding:24px;text-align:center;font-size:15px;line-height:1.8;color:#f8fafc;">' +
                    '此裝置或瀏覽器不支援 WebGL,無法執行 3D 球場。<br>' +
                    '請改用 Chrome / Edge 最新版,或在瀏覽器設定中開啟硬體加速。</div>';
                throw e;
            }
            ren.setSize(window.innerWidth, window.innerHeight);
            ren.outputEncoding = THREE.sRGBEncoding;
            ren.toneMapping = THREE.LinearToneMapping;
            ren.toneMappingExposure = GRADE.exposure;
            ren.shadowMap.enabled = true;
            ren.shadowMap.type = THREE.PCFSoftShadowMap;
            document.getElementById('stage3d').appendChild(ren.domElement);
            ray = new THREE.Raycaster();
            aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            TEX_GLOW = glowTex(); TEX_BLOB = softBlobTex();
            buildLights(); buildEnvironment(); buildCourt(); buildNet();
            buildBall(); buildSteve(); buildCreeper(); buildGuides();
            buildAimZones(); buildRingPool();
        }
        function buildLights() {
            scene.add(new THREE.HemisphereLight(0xdcefff, 0x7d9c5e, GRADE.hemiI));
            sunKey = new THREE.DirectionalLight(0xfff4e0, GRADE.sunI);
            const key = sunKey;
            key.position.set(8, 15, 9); key.castShadow = true;
            key.shadow.mapSize.set(512, 512);
            const d = 11;
            key.shadow.camera.left = -d; key.shadow.camera.right = d;
            key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
            key.shadow.camera.near = 1; key.shadow.camera.far = 42;
            key.shadow.bias = -0.0012; key.shadow.radius = 3;
            scene.add(key);
            const fill = new THREE.DirectionalLight(0xbcd8ff, GRADE.fillI);
            fill.position.set(-9, 6, 7); scene.add(fill);
            const rim = new THREE.DirectionalLight(0xaef0ff, GRADE.rimI);
            rim.position.set(-2, 5, -13); scene.add(rim);
        }
        let scoreboard3DMesh = null, scoreboard3DTex = null;
        function updateScore3D() {
            if (!scoreboard3DTex) return;
            const canvas = scoreboard3DTex.image;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, 512, 256);

            // 邊框與裝飾線
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 6;
            ctx.strokeRect(6, 6, 500, 244);
            ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
            ctx.fillRect(6, 6, 500, 244);

            // 頂部標題
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 24px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('NCHU PICKLE LEARNING GROUP', 256, 42);

            // 關卡資訊
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px system-ui, sans-serif';
            const sName = STAGES[stage] ? STAGES[stage].name : '匹克球對決';
            ctx.fillText('STAGE ' + stage + ' · ' + sName, 256, 74);

            // 即時比分區塊
            ctx.fillStyle = '#34d399';
            ctx.font = 'bold 64px "Barlow Condensed", system-ui, sans-serif'; ctx.fillStyle = '#d3f36c';
            ctx.textAlign = 'center';
            ctx.fillText(pScore + '  :  ' + aScore, 256, 148);

            // 玩家 vs 匹克鵝
            ctx.font = 'bold 20px system-ui, sans-serif';
            ctx.fillStyle = '#f8fafc';
            ctx.textAlign = 'left';
            ctx.fillText('🪿 ' + (playerProfile.nickname || '玩家'), 40, 205);
            ctx.textAlign = 'right';
            ctx.fillText('匹克鵝 AI 🪿', 472, 205);

            scoreboard3DTex.needsUpdate = true;
        }

        function buildEnvironment() {
            const gt = noiseTex('#5f9440', 256, 2400, 0.07); gt.repeat.set(7, 7);
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
                new THREE.MeshStandardMaterial({ map: gt, color: 0x4f7d37, roughness: 0.96 }));
            ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
            ground.receiveShadow = true; scene.add(ground);

            // ★ 視覺調色:採用沉穩耐看之深岩藍/海軍灰，降低刺眼反光
            const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, metalness: 0.05 });
            const railMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.75, metalness: 0.15 });
            for (const dir of [1, -1]) for (let t = 0; t < 3; t++) {
                const w = COURT_W + 7 - t * 0.6, h = 0.55 + t * 0.55, dep = 1.5;
                const z = dir * (HALF_L + 4.2 + t * 1.45);
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), seatMat);
                m.position.set(0, h / 2, z); m.castShadow = (t === 0); m.receiveShadow = true; scene.add(m);
                const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.12), railMat);
                r.position.set(0, h + 0.035, z - dir * dep / 2); scene.add(r);
            }

            // ★ 3D 看台計分板 (NCHU pickle learning group)
            const scCanvas = document.createElement('canvas');
            scCanvas.width = 512; scCanvas.height = 256;
            scoreboard3DTex = new THREE.CanvasTexture(scCanvas);
            const scMat = new THREE.MeshBasicMaterial({ map: scoreboard3DTex, toneMapped: false });
            scoreboard3DMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), scMat);
            scoreboard3DMesh.position.set(0, 4.4, -(HALF_L + 7.8));
            scene.add(scoreboard3DMesh);

            // 計分板外框
            const scFrame = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.4, 0.18),
                new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 }));
            scFrame.position.set(0, 4.4, -(HALF_L + 7.9));
            scene.add(scFrame);

            updateScore3D();
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xc9d6e4, roughness: 0.42, metalness: 0.55 });
            const lampMat = new THREE.MeshStandardMaterial({
                color: 0xf2f7ff, roughness: 0.3, metalness: 0.3,
                emissive: 0xfff6dd, emissiveIntensity: 0.35
            });
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const px = sx * (COURT_W / 2 + 3.4), pz = sz * (HALF_L + 2.0);
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 7.2, 8), poleMat);
                pole.position.set(px, 3.6, pz); pole.castShadow = true; scene.add(pole);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.42), lampMat);
                head.position.set(px - sx * 0.4, 7.2, pz); head.castShadow = true; scene.add(head);
                const hg = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: TEX_GLOW, color: 0xfff3d4,
                    transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false
                }));
                hg.position.copy(head.position); hg.scale.set(2.6, 2.6, 1); scene.add(hg);
            }
        }
        function buildCourt() {
            const ot = noiseTex('#1c6d97', 256, 2000, 0.06); ot.repeat.set(4, 6);
            const out = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 5.6, COURT_L + 5.6),
                new THREE.MeshStandardMaterial({ map: ot, color: 0x2278a3, roughness: 0.8 }));
            out.rotation.x = -Math.PI / 2; out.position.y = -0.008; out.receiveShadow = true; scene.add(out);
            const ct = noiseTex('#2489b8', 256, 1600, 0.05); ct.repeat.set(3, 6);
            const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_L),
                new THREE.MeshStandardMaterial({ map: ct, color: 0x3498db, roughness: 0.66 }));
            court.rotation.x = -Math.PI / 2; court.receiveShadow = true; scene.add(court);
            const kt = noiseTex('#c25a3c', 256, 1400, 0.06); kt.repeat.set(3, 2);
            const kit = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, KITCHEN_D * 2),
                new THREE.MeshStandardMaterial({ map: kt, color: 0xe67e22, roughness: 0.62 }));
            kit.rotation.x = -Math.PI / 2; kit.position.y = 0.002; kit.receiveShadow = true; scene.add(kit);

            // ★ V5 3D 廚房區 (7 FT Non-Volley Zone) 立體視覺標註
            try {
                const nvzC = document.createElement('canvas'); nvzC.width = 512; nvzC.height = 128;
                const nvzX = nvzC.getContext('2d');
                nvzX.fillStyle = 'rgba(255,255,255,0.25)';
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
            const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
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
        }
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
            const c = document.createElement('canvas'); c.width = 128; c.height = 64;
            const x = c.getContext('2d');
            x.fillStyle = '#eaff52'; x.fillRect(0, 0, 128, 64);
            x.fillStyle = 'rgba(70,92,12,.5)';
            for (let i = 0; i < 22; i++) { x.beginPath(); x.arc((i * 31) % 128, (i * 19) % 64, 4.5, 0, Math.PI * 2); x.fill(); }
            const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
            ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 22, 22),
                new THREE.MeshStandardMaterial({
                    map: t, roughness: 0.32, metalness: 0.02,
                    emissive: 0x93b800, emissiveIntensity: 0.14
                }));
            ball.castShadow = true;
            // ★ v5.0.5: 手機端球體視覺放大 35%~45%，解決小螢幕球小如芝麻看不清的問題
            if (typeof camCfg !== 'undefined' && camCfg.ballScale) {
                ball.scale.set(camCfg.ballScale, camCfg.ballScale, camCfg.ballScale);
            }
            scene.add(ball);
            ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({
                map: TEX_GLOW, color: 0xf0ff9a,
                transparent: true, opacity: (typeof camCfg !== 'undefined' ? camCfg.glowOpacity : 0.35),
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            const gScale = (typeof camCfg !== 'undefined' ? camCfg.glowScale : 9);
            ballGlow.scale.set(BALL_R * gScale, BALL_R * gScale, 1); scene.add(ballGlow);
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
        function buildSteve() {
            pGrp = new THREE.Group();
            const skin = new THREE.MeshStandardMaterial({ color: 0xf0b085, roughness: 0.6 });
            const shirt = new THREE.MeshStandardMaterial({ color: 0x2fd4c4, roughness: 0.5 });
            const pants = new THREE.MeshStandardMaterial({ color: 0x4265a8, roughness: 0.66 });
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.24), shirt);
            torso.position.y = 0.82; torso.castShadow = true; pGrp.add(torso);
            const legs = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.52, 0.23), pants);
            legs.position.y = 0.26; legs.castShadow = true; pGrp.add(legs);
            const hc = document.createElement('canvas'); hc.width = hc.height = 32;
            const h = hc.getContext('2d');
            h.fillStyle = '#f0b085'; h.fillRect(0, 0, 32, 32);
            h.fillStyle = '#4a3018'; h.fillRect(0, 0, 32, 9);
            h.fillStyle = '#ffffff'; h.fillRect(6, 14, 7, 4); h.fillRect(19, 14, 7, 4);
            h.fillStyle = '#33518f'; h.fillRect(9, 14, 4, 4); h.fillRect(19, 14, 4, 4);
            h.fillStyle = 'rgba(150,90,55,.55)'; h.fillRect(11, 23, 10, 3);
            const ht = new THREE.CanvasTexture(hc); ht.magFilter = THREE.NearestFilter; ht.encoding = THREE.sRGBEncoding;
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35),
                new THREE.MeshStandardMaterial({ map: ht, roughness: 0.6 }));
            head.position.y = 1.29; head.castShadow = true; pGrp.add(head);
            const la = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.54, 0.14), shirt);
            la.position.set(-0.29, 0.8, 0.02); la.rotation.z = 0.16; la.castShadow = true; pGrp.add(la);
            pArm = new THREE.Mesh(new THREE.BoxGeometry(0.135, 1, 0.135), skin);
            pArm.castShadow = true; pGrp.add(pArm);
            pPad = new THREE.Group();
            const face = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.36, 0.035),
                new THREE.MeshStandardMaterial({ color: 0xf0454f, roughness: 0.32, metalness: 0.06 }));
            face.position.y = 0.18; face.castShadow = true; pPad.add(face);
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.38, 0.02),
                new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: 0.5 }));
            edge.position.set(0, 0.18, -0.012); pPad.add(edge);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.055),
                new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: 0.8 }));
            grip.position.y = -0.055; pPad.add(grip);
            pPad.scale.setScalar(1.45); pGrp.add(pPad);
            scene.add(pGrp);
        }
        function buildCreeper() {
            gGrp = new THREE.Group();
            const gs = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.5 });
            const bk = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.4 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.58, 0.74), gs);
            body.position.y = 0.52; body.castShadow = true; gGrp.add(body);
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.44, 0.17), gs);
            neck.position.set(0, 0.96, 0.19); neck.castShadow = true; gGrp.add(neck);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), gs);
            head.position.set(0, 1.26, 0.21); head.castShadow = true; gGrp.add(head);
            const beak = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.26), bk);
            beak.position.set(0, 1.2, 0.42); gGrp.add(beak);
            for (const sx of [-0.15, 0.15]) for (const sz of [-0.16, 0.16]) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.1), bk);
                leg.position.set(sx, 0.13, sz); leg.castShadow = true; gGrp.add(leg);
            }
            gArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), gs);
            gArm.castShadow = true; gGrp.add(gArm);
            gPad = new THREE.Group();
            const gf = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.36, 0.035),
                new THREE.MeshStandardMaterial({ color: 0xd9ff5c, roughness: 0.32 }));
            gf.position.y = 0.18; gf.castShadow = true; gPad.add(gf);
            const ge = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.38, 0.02),
                new THREE.MeshStandardMaterial({ color: 0x24304a, roughness: 0.5 }));
            ge.position.set(0, 0.18, 0.012); gPad.add(ge);
            gPad.scale.setScalar(1.45); gGrp.add(gPad);
            scene.add(gGrp);
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
        /* ★ v5.0.2 軌跡解算器升級:支援依擊球力道動態縮放飛行初速 (speedScale) */
        function solveArc(fx, fy, fz, tx, tz, out, speedScale) {
            const dist = Math.hypot(tx - fx, tz - fz);
            const baseSpd = (speedScale || 1.0) * 11.8;
            // ★ v5.0.12: 當球越過球網且目標為網前短球/廚房區時，增加過網空氣阻力餘裕 (reqClear)，保證絕對不因減速意外掛網
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
                add(0.0, '發球預備: 站進右側藍圈，拍面自然就位', 'STEP 1 站位預備', () => { dMove(1.5, back); dPaddle(0.34, 0.74); dDemoTgt.x = -1.5; dDemoTgt.z = -4.8; });
                add(1.8, '拍面低於腰部 = 合法下手臂發球', 'STEP 2 擊球點高度', () => dPaddle(0.31, 0.60));
                add(3.2, '👆 向上滑動推拍: 對角送進綠色發球區', 'STEP 3 直推發球', () => { triggerFingerDemoSwipe(0); dHit(-1.5, -4.8, 0); });
                add(5.6, '收拍時手腕自然抬高過肩', 'STEP 3.5 完整收拍');
                add(6.8, '走到左側藍圈，準備示範側旋發球', 'STEP 4 換邊發球', () => { dMove(-1.5, back); dPaddle(-0.31, 0.60); dDemoTgt.x = 1.5; dDemoTgt.z = -4.8; });
                add(8.6, '🌪️ 右上刷切揮拍: 劃出微弧線落入右側發球區', 'STEP 5 側切發球', () => { triggerFingerDemoSwipe(1); dHit(1.5, -4.8, 0.65); });
                add(11.0, '左右發球各成功一次即過關！點擊畫面開始', '通關重點');
            } else if (st === 2) {
                add(0.0, '先正常對角發球過網', 'STEP 1 發球', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.6; dDemoTgt.z = -4.8; });
                add(1.4, null, null, () => dHit(-1.6, -4.8));
                add(3.4, '匹克鵝回擊一顆底線深球', 'STEP 2 對手深球', () => { dG(-1.4, -3.2); dDemoTgt.x = 1.2; dDemoTgt.z = 5.8; });
                add(4.2, null, null, () => dGHit(1.2, 5.8));
                add(5.4, '⚠️ 核心法則: 接發球必須等球落地彈跳一次！', 'STEP 3 等球落地', () => { dMove(1.2, 6.0); dPaddle(0.27, 0.54); dDemoTgt.x = -1.2; dDemoTgt.z = -3.6; });
                add(7.8, '落地彈起後平穩回擊，完成雙彈跳規則！', 'STEP 4 合法回擊', () => { triggerFingerDemoSwipe(0); dHit(-1.2, -3.6); });
                add(10.0, '雙方各落地一次後，方開放凌空截擊', '雙彈跳核心');
            } else if (st === 3) {
                add(0.0, '中興湖畔 7 呎廚房非截擊區 (Kitchen)', 'STEP 1 網前規則', () => { dMove(1.5, back); dPaddle(0.31, 0.60); dG(0, -HALF_L - 0.5); dDemoTgt.x = -1.6; dDemoTgt.z = -4.8; });
                add(1.4, null, null, () => dHit(-1.6, -4.8));
                add(3.4, '匹克鵝把球輕吊進廚房區', 'STEP 2 對手吊球', () => { dG(-1.2, -3.0); dDemoTgt.x = 0.8; dDemoTgt.z = 1.35; });
                add(4.2, null, null, () => dGHit(0.8, 1.35));
                add(5.6, '❌ 球未落地就在廚房內揮拍 = KITCHEN FAULT 犯規', '錯誤示範', () => { dMove(0.8, 1.5); dPaddle(0.29, 1.0); dBad(); });
                add(7.6, '✅ 正確做法: 耐心等球落地彈起後再輕推 (Dink)', '正確做法', () => { dPaddle(0.25, 0.48); dDemoTgt.x = -0.9; dDemoTgt.z = -1.7; });
                add(9.2, '落地後輕推小球安全過網，成功通關！', 'STEP 3 廚房輕推', () => { triggerFingerDemoSwipe(0); dHit(-0.9, -1.7); });
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
            dismissFingerTutorial();
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

        let infoCollapsed = false;
        function toggleInfoCollapse() {
            const el = document.getElementById('info');
            if (!el) return;
            infoCollapsed = !infoCollapsed;
            if (infoCollapsed) el.classList.add('collapsed');
            else el.classList.remove('collapsed');
        }

        let bottomCollapsed = false;
        function toggleBottomCollapse() {
            const el = document.getElementById('bottom');
            const icon = document.getElementById('mini-toggle-icon');
            if (!el) return;
            bottomCollapsed = !bottomCollapsed;
            if (bottomCollapsed) {
                el.classList.add('collapsed');
                if (icon) icon.innerText = '▸';
            } else {
                el.classList.remove('collapsed');
                if (icon) icon.innerText = '▾';
            }
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
        function switchStage(n) {
            clearTimers();
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            demoOn = false; D.demo.style.display = 'none';
            const wm = document.getElementById('demo-watermark'); if (wm) wm.style.display = 'none';
            stage = n;
            document.querySelectorAll('[data-stage]').forEach(b => b.classList.toggle('on', +b.dataset.stage === n));
            closePanel();
            D.chip.innerText = 'STAGE ' + n;
            D.name.innerText = STAGES[n].name; D.sub.innerText = STAGES[n].sub; D.desc.innerText = STAGES[n].desc;
            pScore = 0; aScore = 0; legalServes = 0; twoBounceDone = 0; serveSide = 1; server = 'PLAYER'; secondServe = false; locked = false;
            updateScore(); updateGoal();
            gGrp.visible = (n >= 2); gGrp.position.set(0, 0, -HALF_L - 0.5);
            warnKitchen.material.opacity = 0;
            if (!dSeen[n]) { dSeen[n] = true; startDemo(n); } else resetServe();
        }
        let gooseServeTimer = null;
        function resetServe() {
            if (gooseServeTimer) { clearTimeout(gooseServeTimer); gooseServeTimer = null; }
            state = 'SERVE_READY';
            rallyHits = 0; bounces = 0; lastHitter = 'NONE';
            pLock = 0; gLock = 0; swingT = 0;
            charging = false; power = 0; powerDir = 1; locked = false; powerBarDisplay = 0;
            servePrepared = false; calibT0 = 0; serveCooldown = 1.2;
            resetServeFSM(); kcReset();

            if (server === 'PLAYER') {
                pPos.x = 1.5 * serveSide; pPos.z = HALF_L + 0.35;
                serveFromRight = pPos.x >= 0;
                aiTo.x = 0; aiTo.z = -HALF_L - 0.5;
                AIM.idx = 2; AIM.cand = 2; AIM.dwell = 0; syncAimPips();
                if (webcamActive) document.getElementById('calibration-box').style.display = 'flex';
                D.pFill.style.width = '0%';
                const hints = {
                    1: '左手舉高解鎖 → 拍面低於腰 → 向上推拍 → 收拍抬過肩',
                    2: '左手舉高預備 → 匹克鵝回深球 → 讓球落地一次再回擊',
                    3: '左手舉高預備 → 匹克鵝吊球進廚房 → 等球落地再輕推 1 次',
                    4: '對決匹克鵝 (發球得分制, 先得 3 分勝)',
                    5: '🔥 中興湖魔王戰! (發球得分制, 搶 5 分登錄英雄榜)'
                };
                toast('READY · 玩家發球', hints[stage] + (stage >= 4 ? (' · ' + (secondServe ? '2nd' : '1st') + ' Serve') : ''));
            } else {
                // 匹克鵝發球:玩家站到對角落點側接發球
                pPos.x = 1.5 * serveSide; pPos.z = HALF_L + 0.45;
                serveFromRight = false;
                gGrp.position.set(-1.5 * serveSide, 0, -HALF_L - 0.35);
                aiTo.x = -1.5 * serveSide; aiTo.z = -HALF_L - 0.35;
                if (webcamActive) document.getElementById('calibration-box').style.display = 'none';
                D.pFill.style.width = '0%';
                toast('🪿 匹克鵝發球中 (' + (secondServe ? '2nd' : '1st') + ' Serve)', '站好底線,等球在對角區落地一次後回擊');
                gooseServeTimer = later(gooseDoServe, 1600);
            }
            updateGoal();
        }

        function gooseDoServe() {
            if (state !== 'SERVE_READY' || server !== 'GOOSE' || demoOn) return;
            // ★ 先把球釘在鵝的腰部發球點,再從同一點解彈道(起點必須一致)
            PH.setPos(gGrp.position.x, 0.80, gGrp.position.z + 0.30);
            state = 'SERVE_AIR'; lastHitter = 'GOOSE';
            rallyHits = 1; bounces = 0; gLock = 0.3; pLock = 0;
            const targetX = 1.4 * serveSide, targetZ = 2.6 + Math.random() * 1.6;
            solveArc(PH.pos.x, PH.pos.y, PH.pos.z, targetX, targetZ, PH.vel);
            S.pop(0.65); popRing(gGrp.position.x, gGrp.position.z, 1.2, 0x38bdf8);
            toast('🪿 匹克鵝下手發球!', '等球落地一次再回擊');
        }


/* ═══════ 玩家操作、揮拍擊球、匹克鵝 AI 與主動畫迴圈 ═══════ */
        function beginCharge() {
            S.init(); closePanel();
            if (camEdit) return;                       // 編輯視角時不蓄力
            if (demoOn) { skipDemo(); return; }
            if (locked) return;
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
        function serveTarget(p) {
            const t = THREE.MathUtils.clamp(p / 100, 0, 1);
            serveTgt.z = -(KITCHEN_D - 0.15 + t * (HALF_L - KITCHEN_D + 0.9));
            if (webcamActive) {
                serveTgt.x = aimTargetX();
            } else {
                // ★ 基準鎖定合法對角發球區 (diagSign * COURT_W/4)，搭配滑動橫向速度與拍面微調
                const baseBoxX = diagSign() * (COURT_W / 4);
                const swipeSteer = THREE.MathUtils.clamp((SWIPE.peakVx / 600) * 0.70, -0.80, 0.80);
                serveTgt.x = THREE.MathUtils.clamp(baseBoxX + padX * 0.55 + swipeSteer, -(COURT_W / 2 - 0.35), (COURT_W / 2 - 0.35));
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

            // ★ 匹克球發球側旋校準: 直推(brushVx < 70)保持筆直，側滑(brushVx >= 70)產生強勁香蕉側旋弧線
            let serveSpin = 0;
            if (!webcamActive) {
                const brushVx = SWIPE.peakVx;
                if (Math.abs(brushVx) >= 70) {
                    const dir = Math.sign(brushVx);
                    const ratio = THREE.MathUtils.clamp((Math.abs(brushVx) - 70) / 320, 0, 1);
                    serveSpin = dir * THREE.MathUtils.lerp(0.30, 0.82, ratio);
                } else {
                    serveSpin = 0; // 正常發球 100% 筆直
                }
            } else {
                serveSpin = THREE.MathUtils.clamp((RIGHT.padXFree || 0) * 0.55, -0.65, 0.65);
            }
            PH.spin = serveSpin; PH.spinInc = 0;

            if (Math.abs(serveSpin) >= 0.22) {
                const spinSideTxt = serveSpin > 0 ? '🌪️ 右側旋發球弧線 (RIGHT SERVE CURVE)' : '🌪️ 左側旋發球弧線 (LEFT SERVE CURVE)';
                announceReferee(spinSideTxt, '發球觸發空中香蕉弧線軌跡', false);
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
            const b = PH.pos, p = padW;
            const assist = webcamActive ? 1.45 : 1.0;
            const r = swingT > 0
                ? { z: (0.62 + BALL_R) * assist, x: (0.82 + BALL_R) * assist, y: (0.78 + BALL_R) * assist }
                : { z: (0.45 + BALL_R) * assist, x: (0.60 + BALL_R) * assist, y: (0.55 + BALL_R) * assist };
            if (Math.abs(b.z - p.z) > r.z || Math.abs(b.x - p.x) > r.x || Math.abs(b.y - p.y) > r.y) return;

            dismissFingerTutorial();
            const volley = (bounces === 0);
            // ★ KITCHEN FAULT 條件更具體,須先判定(否則 Stage 3 永遠先被判雙彈跳違規)
            if (volley && stage >= 3 && pPos.z < KITCHEN_D + 0.05) {
                endRally('GOOSE', 'KITCHEN FAULT', '站在中興湖廚房內不可空中截擊'); return;
            }
            if (volley && needBounce()) { endRally('GOOSE', '雙彈跳違規', '接發球必須等球落地一次'); return; }
            pLock = 0.28; lastHitter = 'PLAYER'; rallyHits++; bounces = 0;

            // ★ 動力鏈評分
            let chainRes = null;
            if (webcamActive) {
                const g = gradeChain();
                if (g) {
                    chainRes = g;
                    motionStatsAdd(g);
                    later(() => showChainFeedback(g), 1200);
                }
                kcReset();
            }

            // ★ 擊球力道階梯重整: 優先採納垂直推拍與橫向側刷速度
            let ch = 0.55;
            const hasSwipeVy = (SWIPE.peakVy > 80);
            const swipePower = hasSwipeVy ? THREE.MathUtils.clamp((SWIPE.peakVy - 60) / 950, 0.22, 1.0) : 0;
            const swipeHorizPower = Math.abs(SWIPE.peakVx) > 90 ? THREE.MathUtils.clamp((Math.abs(SWIPE.peakVx) - 70) / 800, 0.35, 0.90) : 0;

            if (hasSwipeVy || swipeHorizPower > 0) {
                ch = Math.max(swipePower, swipeHorizPower, swingT > 0 ? (swingP / 100) : 0.45);
            } else if (swingT > 0) {
                ch = THREE.MathUtils.clamp(swingP / 100, 0.18, 1.0);
            } else if (webcamActive) {
                ch = THREE.MathUtils.clamp(hitPower(KIN.vPeak, SWING.path) / 100, 0.22, 1.0);
            } else {
                ch = 0.48; // 微弱擋球
            }
            swingT = 0;

            // ★ 擊球落點瞄準 (tx) 穩定化 & 匹克球香蕉側旋弧線:
            // 1. tx: 穩定指向對手場地，杜絕擊球無故出界
            // 2. spin: 直推(deadzone < 65px/s)保持 100% 筆直；側切(>= 65px/s)敏銳觸發空中香蕉弧線！
            let tx = 0, spin = 0;
            if (webcamActive) {
                const aimZoneX = aimTargetX();
                const wristFree = (RIGHT.padXFree || 0);
                tx = THREE.MathUtils.clamp(aimZoneX * 0.75 + wristFree * 0.8, -COURT_W / 2 + 0.5, COURT_W / 2 - 0.5);
                spin = THREE.MathUtils.clamp(wristFree * 0.55, -0.75, 0.75);
            } else {
                const swipeSteer = THREE.MathUtils.clamp((SWIPE.peakVx / 700) * 0.85, -0.95, 0.95);
                const contactSteer = THREE.MathUtils.clamp((padX * 0.45) + ((b.x - p.x) * 0.35), -0.65, 0.65);
                tx = THREE.MathUtils.clamp(swipeSteer + contactSteer, -COURT_W / 2 + 0.55, COURT_W / 2 - 0.55);

                const brushVx = SWIPE.peakVx;
                if (Math.abs(brushVx) >= 65) {
                    const dir = Math.sign(brushVx);
                    const ratio = THREE.MathUtils.clamp((Math.abs(brushVx) - 65) / 320, 0, 1);
                    spin = dir * THREE.MathUtils.lerp(0.32, 0.88, ratio);
                } else {
                    spin = 0; // 正常直推揮拍 100% 筆直出球！
                }
            }

            PH.spin = spin; PH.spinInc = 0;

            // 側旋切球裁判廣播
            if (Math.abs(spin) >= 0.22) {
                const spinSideTxt = spin > 0 ? '🌪️ 右側旋香蕉弧線 (RIGHT CURVE)' : '🌪️ 左側旋香蕉弧線 (LEFT CURVE)';
                announceReferee(spinSideTxt, '側刷觸發空中香蕉弧線軌跡', false);
            }

            // ★ v5.0.2 依力道連續階梯計算落點與動態初速 (solveArc 速度縮放)
            let tz = -3.5, spdScale = 1.0;
            if (ch < 0.25) {
                // 輕推短球 (Dink): 初速柔和，高拋物線進廚房
                tz = -(0.75 + ch * 2.0);
                spdScale = 0.80;
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            } else if (ch < 0.65) {
                // 中速後場球 (Drive)
                const k = (ch - 0.25) / 0.40;
                tz = -(2.20 + k * 2.80);
                spdScale = 0.95 + k * 0.26;
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            } else {
                // 高速抽殺 (Power Shot / Smash): 初速極快
                const k = (ch - 0.65) / 0.35;
                tz = -(5.00 + k * 1.80);
                spdScale = 1.22 + k * 0.38;
                solveArc(b.x, b.y, b.z, tx, tz, PH.vel, spdScale);
            }

            const hitMph = Math.round(PH.vel.length() * 2.23694);
            const hitType = volley ? 'VOLLEY' : (ch < 0.5 ? 'DINK' : 'POWER SHOT');

            if (stage === 3 && !volley) {
                S.pop(0.4 + ch * 0.6);
                toast('NICE DINK!', '成功完成中興湖廚房合法回擊!');
                twoBounceDone = 1; updateGoal();
                auditLogAdd({
                    stage: stage, type: hitType, hitter: 'PLAYER', speed: hitMph,
                    power: Math.round(ch * 100), spin: +spin.toFixed(2), chain: chainRes,
                    stance: { ok: stanceOK, bal: +stanceBal.toFixed(2) }, outcome: '廚房合法回擊 (過關)'
                });
                clearStage(); return;
            }

            S.pop(0.4 + ch * 0.6); addShake(0.05 + ch * 0.06);

            if (Math.abs(spin) >= 0.18) {
                toast((spin > 0 ? '🌪️ 右側旋切球' : '🌪️ 左側旋切球') + ' · ' + hitType, hitMph + ' mph');
            } else {
                toast(hitType, hitMph + ' mph');
            }

            auditLogAdd({
                stage: stage, type: hitType, hitter: 'PLAYER', speed: hitMph,
                power: Math.round(ch * 100), spin: +spin.toFixed(2), chain: chainRes,
                stance: { ok: stanceOK, bal: +stanceBal.toFixed(2) }, outcome: '合法回擊'
            });

            if (stage === 2 && rallyHits >= 3 && !volley) {
                twoBounceDone = 1; updateGoal(); locked = true;
                later(() => { locked = false; clearStage(); }, 700);
            }
        }
        const joyAnalog = { x: 0, z: 0 };
        const playerVel = { x: 0, z: 0 };
        function updatePlayer(dt) {
            if (demoOn) return;
            if (camEdit) {                              // ★編輯視角時鎖住走位
                pGrp.position.set(pPos.x, 0, pPos.z);
                pPad.position.set(padX, padY, -0.24);
                pPad.rotation.set(-0.24, 0, -padX * 0.5);
                pPad.getWorldPosition(padW);
                limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
                if (state === 'SERVE_READY' && server === 'PLAYER') PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
                return;
            }

            // ★ 動態新手引導:手指滑動時，主角同步執行揮拍與腳步示範
            if (fingerTutActive && (state === 'SERVE_READY' || state === 'DEMO')) {
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
                const maxSpeed = 7.2;

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
                }

                const accel = (targetVx !== 0 || targetVz !== 0) ? 26 : 18;
                playerVel.x += (targetVx - playerVel.x) * Math.min(1, dt * accel);
                playerVel.z += (targetVz - playerVel.z) * Math.min(1, dt * accel);

                pPos.x += playerVel.x * dt;
                pPos.z += playerVel.z * dt;
            }
            pPos.x = THREE.MathUtils.clamp(pPos.x, -COURT_W / 2 - 0.7, COURT_W / 2 + 0.7);
            pPos.z = THREE.MathUtils.clamp(pPos.z, 0.3, HALF_L + 1.6);
            pGrp.position.set(pPos.x, 0, pPos.z);
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
            pPad.getWorldPosition(padW);
            limb(pArm, _b.set(0.2, 1.16, 0.02), _a.set(padX, padY - 0.17, -0.24));
            if (state === 'SERVE_READY' && server === 'PLAYER') PH.reset(padW.x - 0.22, Math.max(BALL_R, padW.y + 0.1), padW.z - 0.06);
        }
        function planShot() {
            const plan = AI_PLAN[stage] || 'MIX', xl = COURT_W / 2 - 0.45;
            if (plan === 'DEEP') {
                aiShot.z = HALF_L - 0.55 - Math.random() * 0.6;
                aiShot.x = THREE.MathUtils.clamp(pPos.x + (Math.random() - 0.5) * 1.2, -xl, xl);
            } else if (plan === 'KITCHEN') {
                // ★ v5.0.12: 第三關廚房落點優化：落點穩定在 1.15m ~ 1.85m (廚房線以內、過網餘裕充足)，弧線平滑過網，供玩家完美練習落地擊球
                aiShot.z = 1.15 + Math.random() * 0.70;
                aiShot.x = THREE.MathUtils.clamp(pPos.x * 0.45 + (Math.random() - 0.5) * 1.5, -xl, xl);
            } else if (plan === 'BOSS') {
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
        function updateGoose(dt) {
            if (demoOn || !gGrp.visible) return;
            const active = (state === 'RALLY' || state === 'SERVE_AIR');
            if (active && PH.vel.z < 0) {
                const ap = predictApex();
                if (ap) {
                    aiTo.x = THREE.MathUtils.clamp(ap.x, -COURT_W / 2 - 0.7, COURT_W / 2 + 0.7);
                    aiTo.z = THREE.MathUtils.clamp(ap.z, -HALF_L - 2.5, -0.9);
                }
            } else if (state === 'SERVE_READY') {
                if (server === 'GOOSE') { aiTo.x = -1.5 * serveSide; aiTo.z = -HALF_L - 0.35; }
                else { aiTo.x = 0; aiTo.z = -HALF_L - 0.5; }
            } else if (active) { aiTo.x *= 0.9; aiTo.z = -KITCHEN_D - 0.5; }
            // ★ v5.0.3: AI 難度係數 (僅對 Stage >= 4 生效，教學關維持引導移速)
            const diffScale = stage >= 4 ? (DIFF_PRESETS[diffLevel]?.speedScale || 1.0) : 1.0;
            const spd = (AI_SPEED[stage] || 5.5) * diffScale;
            const dx = aiTo.x - gGrp.position.x, dz = aiTo.z - gGrp.position.z, d = Math.hypot(dx, dz);
            if (d > 1e-4) {
                const mv = Math.min(d, spd * dt);
                gGrp.position.x += dx / d * mv; gGrp.position.z += dz / d * mv;
            }
            gGrp.rotation.y = Math.PI;
            const py = THREE.MathUtils.clamp(PH.pos.y, 0.22, 1.6);
            const lx = THREE.MathUtils.clamp(PH.pos.x - gGrp.position.x, -0.8, 0.8);
            gPad.position.set(-lx, py, -0.34); gPad.rotation.set(0.24, 0, 0);
            gPad.getWorldPosition(gPadW);
            limb(gArm, _b.set(0.18, 0.85, -0.05), _a.set(-lx, py - 0.17, -0.34));

            // ★ 發球等待時球固定在腰部高度(不可回讀 PH.pos.y,否則會逐幀爬升)
            if (state === 'SERVE_READY' && server === 'GOOSE') {
                PH.reset(gGrp.position.x, 0.80, gGrp.position.z + 0.30);
            }
            if (!active || gLock > 0 || locked) return;
            if (PH.pos.z > -0.05 || PH.vel.z > 0 || bounces === 0) return;
            const b = PH.pos, gp = gPadW;
            if (Math.abs(b.z - gp.z) > 0.62 + BALL_R || Math.abs(b.x - gp.x) > 0.80 + BALL_R ||
                Math.abs(b.y - gp.y) > 0.75 + BALL_R) return;

            // ★ 規格 6: 人性化失誤機制 + ★ v5.0.12 前三關新手教學失誤率極低 (2.5%)，第4~5關依難度調節
            const diffMult = stage >= 4 ? (DIFF_PRESETS[diffLevel]?.missMultiplier || 1.0) : 1.0;
            let missRate = (AI_MISS[stage] || 0.025) * diffMult;
            const incomingSpeed = PH.vel.length();
            if (incomingSpeed > 14.2 && stage >= 4) missRate += 0.11; // 僅對第4~5關玩家極速回球提升失誤率
            missRate = Math.min(missRate, 0.92);

            if (Math.random() < missRate) {
                const errType = Math.random();
                if (stage <= 3) {
                    // ★ v5.0.12: 前三關教學關卡匹克鵝絕不掛網，偶發失誤採底線微出界，保證新手教學節奏流暢
                    planShot();
                    aiShot.z = HALF_L + 0.65;
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel);
                    gLock = 0.5; S.pop(0.7); toast('🪿 匹克鵝回擊微出界', '偶發失誤'); return;
                } else if (errType < 0.40) {
                    // 40% 掛網 (第4~5關)
                    planShot();
                    solveArc(b.x, b.y, b.z, aiShot.x, 0.05, PH.vel);
                    PH.vel.y = Math.min(PH.vel.y * 0.55, 1.8);
                    PH.vel.z = Math.min(PH.vel.z, -3.0);
                    gLock = 0.5; S.pop(0.4); toast('🪿 匹克鵝回擊掛網', '失誤'); return;
                } else if (errType < 0.80) {
                    // 40% 出界 (第4~5關)
                    planShot();
                    aiShot.z = HALF_L + 1.2;
                    solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel);
                    gLock = 0.5; S.pop(0.7); toast('🪿 匹克鵝回擊出底線', '失誤'); return;
                } else {
                    // 20% 慢揮漏球 (第4~5關)
                    gLock = 0.6; return;
                }
            }

            gLock = 0.28; pLock = 0.15; lastHitter = 'GOOSE'; rallyHits++; bounces = 0;
            if (state === 'SERVE_AIR') state = 'RALLY';
            PH.spin = 0; PH.spinInc = 0; // ★ 匹克鵝回擊時清除側旋與偏折，保證回球彈道乾淨平穩
            planShot(); solveArc(b.x, b.y, b.z, aiShot.x, aiShot.z, PH.vel); S.pop(0.6);
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
        function updateGuides(dt) {
            const ready = (state === 'SERVE_READY');
            const flying = (state === 'SERVE_AIR' || state === 'RALLY' || state === 'DEMO');
            const myServe = (server === 'PLAYER');
            const isDemo = (state === 'DEMO');

            // ★ v5.0.10: 示範模式時保持 3D 軌跡引導線、目標落點區與站位光圈常駐高亮
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

            // 示範模式專用拋物線與目標落點解算
            if (isDemo && demoHold) {
                const tgX = dDemoTgt.x;
                const tgZ = dDemoTgt.z;
                zoneServe.position.set(tgX, 0.012, tgZ);

                const px = padW.x - 0.22;
                const py = Math.max(BALL_R, padW.y + 0.1);
                const pz = padW.z - 0.06;
                solveArc(px, py, pz, tgX, tgZ, _a);

                let vx = _a.x, vy = _a.y, vz = _a.z;
                const h = 1 / 90, pts = [];
                for (let i = 0; i < 240; i++) {
                    const p = pool[i]; p.set(px, py, pz); pts.push(p);
                    vy -= GRAVITY * h; px += vx * h; py += vy * h; pz += vz * h;
                    if (py <= BALL_R) { ringLand.position.set(px, 0.016, pz); break; }
                }
                arc.geometry.setFromPoints(pts); arc.computeLineDistances();
                ringLand.visible = true;
                arc.material.color.setHex(0x3fe0c4);
                ringLand.userData.out.material.color.setHex(0x3fe0c4);
                ringLand.userData.glow.material.color.setHex(0x3fe0c4);
                return;
            }

            if (ready && myServe) {
                zoneServe.position.set(diagSign() * COURT_W / 4, 0.012, -(KITCHEN_D + HALF_L) / 2);
                serveVel(power, _a);
                let px = PH.pos.x, py = PH.pos.y, pz = PH.pos.z;
                let vx = _a.x, vy = _a.y, vz = _a.z;
                const h = 1 / 90, pts = [];
                for (let i = 0; i < 240; i++) {
                    const p = pool[i]; p.set(px, py, pz); pts.push(p);
                    vy -= GRAVITY * h; px += vx * h; py += vy * h; pz += vz * h;
                    if (py <= BALL_R) { ringLand.position.set(px, 0.016, pz); break; }
                }
                arc.geometry.setFromPoints(pts); arc.computeLineDistances(); ringLand.visible = true;

                const fresh = webcamActive && serveCue.txt && (performance.now() - serveCue.t < 700);
                let msg = fresh ? serveCue.txt
                    : (servePrepared ? '✅ 已解鎖,拍面低於腰後向上推拍' : '👉 請先「左手舉高」解鎖發球');
                let col = fresh ? serveCue.col : (servePrepared ? '#3fe0c4' : '#ffc857');
                const tX = ringLand.position.x, tZ = ringLand.position.z;
                if (pPos.z < HALF_L - 0.05) { msg = '⚠ 雙腳未在底線後'; col = '#ff6b6b'; }
                else if (stage === 1 && sideOf(pPos.x) !== serveSide) {
                    msg = '⚠ 請站進藍圈(' + (serveSide > 0 ? '右' : '左') + '側)'; col = '#ff6b6b';
                }
                else if (padW.y > SERVE_MAX_H && !(webcamActive && SFSM.phase !== 'SETUP')) { msg = '⚠ 拍面過高,須低於腰部'; col = '#ff6b6b'; }
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
                const hex = serveLegal ? 0x3fe0c4 : (col === '#ff6b6b' ? 0xff6b6b : 0xffc857);
                arc.material.color.setHex(hex);
                ringLand.userData.out.material.color.setHex(hex);
                ringLand.userData.glow.material.color.setHex(hex);
                return;
            }
            if (ready && !myServe) {
                ringLand.visible = false;
                setHint('🪿 匹克鵝準備發球,站好底線等球落地一次', '#93a2bb');
                return;
            }
            if (flying && predictLanding(_land)) {
                ringLand.visible = true; ringLand.position.set(_land.x, 0.016, _land.z);
                const bad = (stage >= 3 && _land.z > 0 && _land.z < KITCHEN_D);
                const hex = bad ? 0xff2d2d : 0xffc857;
                ringLand.userData.out.material.color.setHex(hex);
                ringLand.userData.glow.material.color.setHex(hex);
                setHint(bad ? '🍳 這球會落在你的中興湖廚房,等它彈起再打' : '—', bad ? '#ff6b6b' : '#93a2bb');
            } else { ringLand.visible = false; setHint('—', '#93a2bb'); }
        }

        /* ═══════════════════════════════════════════════
           榜單與社交(欄位名稱已對齊後端)
           ═══════════════════════════════════════════════ */
        /* playerId 進入 inline onclick 前只保留安全字元(前端格式為 P-XXXX-XXXX) */
        function safePid(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_\-]/g, ''); }
        function safeNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }

        function escapeHtml(s) {
            if (!s) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
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
            el.innerHTML = '<div class="lb-empty">⚠ 尚未設定 GAS_URL<br>請在程式碼頂端填入 /exec 網址</div>';
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
                if (r && r.err === 'ALREADY_LIKED_TODAY') toast('今天已經讚過了', '每人每日對同一位限 1 次');
                else { btn.disabled = false; btn.classList.remove('liked'); toast('按讚失敗', (r && r.err) || ''); }
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
                    toast('邀請失敗', (r && r.err) || '');
                }
            });
        }
        function respondFriend(targetPid, action, btn) {
            if (!API_READY() || !playerProfile.playerId) return;
            if (action !== 'accept') { toast('後端尚未支援拒絕', '目前只能接受或忽略'); return; }
            btn.disabled = true; btn.innerText = '處理中';
            postSigned({ act: 'friendAccept', playerId: playerProfile.playerId, toId: targetPid }).then(r => {
                if (r && r.ok) { toast('🎉 已成為球友!', ''); loadFriends(); }
                else { btn.disabled = false; btn.innerText = '接受'; toast('確認失敗', (r && r.err) || ''); }
            });
        }
        function submitScoreToCloud(score) {
            if (!playerProfile.playerId) { toast('未登入,成績未上傳', ''); return; }
            if (!API_READY()) { toast('本機離線模式', '通關得分: ' + score); return; }
            postSigned({
                act: 'submit',
                playerId: playerProfile.playerId, sessionId: playerProfile.sessionId,
                avatar: playerProfile.avatar, nickname: playerProfile.nickname,
                department: playerProfile.department, grade: playerProfile.grade,
                deptCode: playerProfile.deptCode,
                entryYear: playerProfile.entryYear, score: score, stage: stage,
                aimMode: AIM.mode, teachLevel: TEACH.level, perfLevel: perfLevel,
                webcamUsed: webcamActive, device: IS_MOBILE ? 'mobile' : 'desktop'
            }).then(r => {
                if (r && r.ok) toast('✨ 戰績已登錄中興英雄榜!', '最佳成績 ' + r.bestScore + ' · 點榜單查看排名');
                else toast('登錄失敗', (r && r.err) || '請稍後再試');
            });
        }

        /* ═══════ 主迴圈 ═══════ */
        let camX = 0, last = performance.now();
        let loopFrameCount = 0;
        const camLookTarget = new THREE.Vector3(0, 0.85, 0.3);
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
            updateAimZones(dt); updateRings(dt);

            // 速度儀表文字降頻更新 (每 4 幀更新一次，徹底消除 Layout Reflow 造成的掉幀)
            if ((loopFrameCount++ & 3) === 0) {
                const mphStr = (PH.vel.length() * 2.23694).toFixed(1);
                if (D.sp) D.sp.innerText = mphStr;
                if (!cachedMiniSpd) cachedMiniSpd = document.getElementById('mini-spd-val');
                if (cachedMiniSpd) cachedMiniSpd.innerText = mphStr + ' mph';
            }

            const k = 1 - Math.pow(0.01, dt);
            camX += (pPos.x * 0.3 - camX) * k;
            const sx = (Math.random() - 0.5) * shake;
            const sy = (Math.random() - 0.5) * shake * 0.7;

            if (camViewMode === 0) {
                // ★ 智慧超感相機 (相機位置平滑追蹤)
                const cfg = (typeof getResponsiveCameraConfig === 'function')
                    ? getResponsiveCameraConfig()
                    : { camH: 8.2, camDist: 13.6, lookY: 0.74, lookZ: -0.4, fov: 50 };

                cam.position.set(camX * 0.4 + sx, cfg.camH + sy, cfg.camDist);
                cam.lookAt(camX * 0.25, cfg.lookY, cfg.lookZ);
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
            ren.render(scene, cam);
        }

        window.addEventListener('resize', () => {
            cam.aspect = window.innerWidth / window.innerHeight;
            if (typeof getResponsiveCameraConfig === 'function') {
                const cfg = getResponsiveCameraConfig();
                cam.fov = cfg.fov;
                if (ball && cfg.ballScale) ball.scale.set(cfg.ballScale, cfg.ballScale, cfg.ballScale);
                if (ballGlow && cfg.glowScale) ballGlow.scale.set(BALL_R * cfg.glowScale, BALL_R * cfg.glowScale, 1);
            }
            cam.updateProjectionMatrix();
            ren.setPixelRatio(Math.min(window.devicePixelRatio, PERF_PRESETS[perfLevel].pixelRatio));
            ren.setSize(window.innerWidth, window.innerHeight);
        });

        
        /* ═══════════════════════════════════════════════
           🛡️ DOM 崩潰防禦與安全更新函式
           ═══════════════════════════════════════════════ */
        function updatePlayerWhoLabel() {
            const whoLabel = document.getElementById('p-who-label');
            if (whoLabel && typeof playerProfile !== 'undefined' && playerProfile) {
                const av = playerProfile.avatar || '🪿';
                const nick = (playerProfile.nickname || '').slice(0, 6);
                whoLabel.innerText = av + ' ' + nick;
            }
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
        setTimeout(() => startSpotlightTour(false), 800);
        initFingerTutorial();
        initLayoutMode();
        initCardResize();
        initNavDrag();

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
        updateCamEditUI();
        loop();