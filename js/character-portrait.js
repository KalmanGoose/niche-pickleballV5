/* Small, independent GLB portraits for the passport and the lake. */
(function (window) {
    'use strict';
    const files = new Map();
    function modelBytes() {
        const url = 'models/characters/pickler_goose_mobile.glb';
        if (!files.has(url)) {
            files.set(url, fetch(url).then(r => {
                if (!r.ok) throw new Error('模型讀取失敗');
                return r.arrayBuffer();
            }).catch(e => { files.delete(url); throw e; }));
        }
        return files.get(url);
    }
    function disposePortraitModel(root) {
        const geometries = new Set(), materials = new Set(), textures = new Set();
        root.traverse(o => {
            if (o.geometry) geometries.add(o.geometry);
            for (const m of o.material ? [].concat(o.material) : []) {
                materials.add(m);
                for (const value of Object.values(m)) if (value && value.isTexture) textures.add(value);
            }
            if (o.skeleton && o.skeleton.boneTexture) textures.add(o.skeleton.boneTexture);
        });
        geometries.forEach(g => g.dispose());
        materials.forEach(m => m.dispose());
        textures.forEach(t => t.dispose());
    }
    // Side steps, shoulder turns and alternating knee bends. Stylized, not video mocap.
    function shanshenClip(root) {
        const THREE = window.THREE, tracks = [];
        const times = [0, .3, .6, .9, 1.2, 1.5, 1.8, 2.1, 2.4];
        const sway = [0, 1, 0, -1, 0, 1, 0, -1, 0];
        const rotations = {
            Spine: [0, .2, .13], Head: [0, -.13, -.07],
            'UpperArm.L': [.28, .08, .12], 'UpperArm.R': [-.28, -.08, -.12],
            'Forearm.L': [.16, 0, .12], 'Forearm.R': [-.16, 0, -.12],
            'Thigh.L': [.32, 0, .1], 'Thigh.R': [-.32, 0, -.1],
            'Shin.L': [-.28, 0, 0], 'Shin.R': [.28, 0, 0]
        };
        root.traverse(bone => {
            if (!bone.isBone) return;
            const name = bone.userData.name || bone.name, amplitude = rotations[name];
            if (!amplitude) return;
            const rest = bone.quaternion.clone(), values = [];
            for (const phase of sway) {
                const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    amplitude[0] * phase, amplitude[1] * phase, amplitude[2] * phase));
                rest.clone().multiply(delta).toArray(values, values.length);
            }
            tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values));
        });
        return new THREE.AnimationClip('Lake_Shanshen', 2.4, tracks);
    }
    class CharacterPortrait {
        constructor(container, options = {}) {
            this.container = container;
            this.dance = !!options.dance;
            this.destroyed = false;
            this.listeners = [];
            this.yaw = .2;
            this.time = 0;
            this.last = 0;
            this.frame = 0;
            this.container.textContent = '匹克鵝準備中…';
            this.ready = this.init();
        }
        async init() {
            const THREE = window.THREE;
            try {
                if (!THREE || !THREE.GLTFLoader) throw new Error('3D 套件尚未就緒');
                const bytes = await modelBytes();
                const gltf = await new Promise((resolve, reject) => new THREE.GLTFLoader().parse(bytes, '', resolve, reject));
                if (this.destroyed) { disposePortraitModel(gltf.scene); return; }
                this.scene = new THREE.Scene();
                this.camera = new THREE.PerspectiveCamera(32, 1, .05, 20);
                this.camera.position.set(0, 1.05, 4.5);
                this.camera.lookAt(0, 1.05, 0);
                this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
                this.renderer.outputEncoding = THREE.sRGBEncoding;
                this.container.textContent = '';
                this.container.appendChild(this.renderer.domElement);
                this.renderer.domElement.setAttribute('aria-label', this.dance ? '匹克鵝的閃身步風格舞步' : '可轉身的 3D 匹克鵝');
                this.scene.add(new THREE.HemisphereLight(0xfff8ed, 0x728769, 1.2));
                const light = new THREE.DirectionalLight(0xffffff, 1.2);
                light.position.set(2, 4, 4); this.scene.add(light);
                this.root = gltf.scene;
                this.root.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(this.root);
                this.root.scale.setScalar(2.05 / box.getSize(new THREE.Vector3()).y);
                this.root.updateMatrixWorld(true);
                box.setFromObject(this.root);
                const center = box.getCenter(new THREE.Vector3());
                this.root.position.set(-center.x, -box.min.y, -center.z);
                this.baseX = this.root.position.x;
                this.root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
                this.scene.add(this.root);
                this.mixer = new THREE.AnimationMixer(this.root);
                const clip = this.dance ? shanshenClip(this.root) : gltf.animations.find(c => c.name === 'Idle');
                if (clip) this.mixer.clipAction(clip).play();
                this.resizeObserver = new ResizeObserver(() => this.resize());
                this.resizeObserver.observe(this.container); this.resize();
                if (!this.dance) this.bindDrag();
                this.tick = this.tick.bind(this); this.frame = requestAnimationFrame(this.tick);
            } catch (e) {
                if (!this.destroyed) this.container.textContent = '匹克鵝暫時未載入，請稍後重開。';
                console.warn('Character portrait:', e.message);
            }
        }
        resize() {
            if (!this.renderer) return;
            const width = this.container.clientWidth || 170, height = this.container.clientHeight || 220;
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
        }
        bindDrag() {
            const canvas = this.renderer.domElement;
            let start = null;
            canvas.style.touchAction = 'pan-y';
            const on = (event, fn) => { canvas.addEventListener(event, fn); this.listeners.push([event, fn]); };
            on('pointerdown', e => { start = e.clientX; canvas.setPointerCapture(e.pointerId); });
            on('pointermove', e => { if (start !== null) { this.yaw += (e.clientX - start) * .015; start = e.clientX; } });
            on('pointerup', () => { start = null; });
            on('pointercancel', () => { start = null; });
        }
        tick(now) {
            if (this.destroyed) return;
            this.frame = requestAnimationFrame(this.tick);
            if (document.hidden || now - this.last < 50) return;
            const dt = this.last ? Math.min(.1, (now - this.last) / 1000) : 0;
            this.last = now; this.time += dt;
            this.mixer.update(dt);
            this.root.rotation.y = this.yaw + (this.dance ? Math.sin(this.time * Math.PI / 1.2) * .25 : 0);
            this.root.position.x = this.baseX + (this.dance ? Math.sin(this.time * Math.PI / .6) * .09 : 0);
            this.renderer.render(this.scene, this.camera);
        }
        destroy() {
            this.destroyed = true; cancelAnimationFrame(this.frame);
            if (this.resizeObserver) this.resizeObserver.disconnect();
            if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
            if (this.root) disposePortraitModel(this.root);
            if (this.renderer) {
                for (const [event, fn] of this.listeners) this.renderer.domElement.removeEventListener(event, fn);
                this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
            }
        }
    }
    window.NGoCharacterPortrait = CharacterPortrait;
})(window);
