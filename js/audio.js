/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 音效系統與 Web Audio 合成器 (Audio System)
   ═══════════════════════════════════════════════════════════════════ */
        const AUDIO_PREFS = { sfxOn: true, master: 0.8, vibrateOn: true };
        const PREF_KEY = 'nchu_pb_audio';
        function loadAudioPrefs() {
            try {
                const raw = localStorage.getItem(PREF_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (typeof o.sfxOn === 'boolean') AUDIO_PREFS.sfxOn = o.sfxOn;
                    if (typeof o.master === 'number') AUDIO_PREFS.master = Math.min(1, Math.max(0, o.master));
                    if (typeof o.vibrateOn === 'boolean') AUDIO_PREFS.vibrateOn = o.vibrateOn;
                }
            } catch (e) { }
        }
        function saveAudioPrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(AUDIO_PREFS)); } catch (e) { } }
        function syncAudioUI() {
            const cb = document.getElementById('pref-sfx'), rg = document.getElementById('pref-vol'),
                nm = document.getElementById('pref-vol-num'),
                vb = document.getElementById('pref-vibrate'),
                vbHint = document.getElementById('pref-vibrate-hint');
            if (cb) cb.checked = AUDIO_PREFS.sfxOn;
            if (rg) { rg.value = Math.round(AUDIO_PREFS.master * 100); rg.disabled = !AUDIO_PREFS.sfxOn; }
            if (nm) nm.innerText = Math.round(AUDIO_PREFS.master * 100) + '%';
            if (vb) {
                vb.checked = AUDIO_PREFS.vibrateOn;
                if (vbHint) {
                    const sup = typeof Haptic !== 'undefined' && Haptic.isSupported();
                    vbHint.innerText = sup
                        ? '已連線手機震動馬達 (支援 Android/Chrome 等)'
                        : '此裝置不支援震動 API (iOS/Safari 以音效共振替代)';
                }
            }
        }
        function onSfxToggle(on) { AUDIO_PREFS.sfxOn = !!on; saveAudioPrefs(); syncAudioUI(); if (on) { S.init(); S.swap(); } }
        function onVibrateToggle(on) {
            AUDIO_PREFS.vibrateOn = !!on;
            saveAudioPrefs();
            syncAudioUI();
            if (on && typeof Haptic !== 'undefined') {
                Haptic.drive();
            }
        }
        function onVolInput(v) {
            AUDIO_PREFS.master = Math.min(1, Math.max(0, v / 100));
            document.getElementById('pref-vol-num').innerText = Math.round(AUDIO_PREFS.master * 100) + '%';
            saveAudioPrefs();
        }
        function testSfx() { S.init(); S.pop(0.75); later(() => S.point(), 220); }
        function testVibrate() {
            if (typeof Haptic === 'undefined' || !Haptic.isSupported()) {
                if (typeof toast === 'function') toast('📳 此裝置不支援原生震動 (iOS/Safari)', '以打擊立體聲音效優雅共振替代');
                S.init();
                S.pop(0.9);
                return;
            }
            AUDIO_PREFS.vibrateOn = true;
            saveAudioPrefs();
            syncAudioUI();
            Haptic.smash();
            S.init();
            S.pop(0.9);
            if (typeof toast === 'function') toast('📳 觸覺震動測試成功！', '重砲殺球爆裂手感 [25ms, 15ms, 45ms]');
        }
        function openAudioModal() { syncAudioUI(); document.getElementById('audio-modal').style.display = 'flex'; closePanel(); S.init(); }
        function closeAudioModal() { document.getElementById('audio-modal').style.display = 'none'; saveAudioPrefs(); clearKeys(); }
        function openTechModal() { document.getElementById('tech-modal').style.display = 'flex'; closePanel(); }
        function closeTechModal() { document.getElementById('tech-modal').style.display = 'none'; clearKeys(); }

        /* ═══════ 觸覺震動回饋系統 (Haptic Feedback System) ═══════ */
        const Haptic = {
            isSupported() {
                return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
            },
            vibrate(pattern) {
                if (!AUDIO_PREFS.vibrateOn) return false;
                if (!this.isSupported()) return false;
                try {
                    return navigator.vibrate(pattern);
                } catch (e) {
                    return false;
                }
            },
            // 1. 網前放短 (Dink)：12ms 極短促微震
            dink() {
                return this.vibrate(12);
            },
            // 2. 標準平抽 (Drive)：22ms 清脆短震
            drive() {
                return this.vibrate(22);
            },
            // 3. 重砲殺球 (Smash)：兩段式爆裂震 [25ms 震, 15ms 停, 45ms 重震]
            smash() {
                return this.vibrate([25, 15, 45]);
            },
            // 4. 觸網 / 犯規失誤 (Fault)：阻滯頓挫震 [50ms 震, 30ms 停, 50ms 震]
            fault() {
                return this.vibrate([50, 30, 50]);
            },
            // 根據擊球力度 p (0.0 ~ 1.0) 動態選擇微震曲線
            hit(power = 0.5) {
                if (power < 0.45) return this.dink();
                if (power >= 0.8) return this.smash();
                return this.drive();
            }
        };
        if (typeof window !== 'undefined') {
            window.Haptic = Haptic;
            window.testVibrate = testVibrate;
            window.onVibrateToggle = onVibrateToggle;
        }

        /* ═══════ 常數與狀態 ═══════ */

/* ═══════ Web Audio 合成器類別 ═══════ */
        class Sound {
            constructor() { this.ctx = null; }
            init() {
                if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); }
                if (this.ctx.state === 'suspended') this.ctx.resume();
            }
            tone(type, f0, f1, dur, vol, pan = 0) {
                if (!AUDIO_PREFS.sfxOn || AUDIO_PREFS.master <= 0) return;
                this.init(); if (!this.ctx) return;
                const t = this.ctx.currentTime;
                const o = this.ctx.createOscillator(), g = this.ctx.createGain();
                o.type = type;
                o.frequency.setValueAtTime(f0, t);
                o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
                g.gain.setValueAtTime(Math.max(0.0009, vol * AUDIO_PREFS.master), t);
                g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
                o.connect(g);
                if (this.ctx.createStereoPanner && typeof pan === 'number' && pan !== 0) {
                    const panner = this.ctx.createStereoPanner();
                    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
                    g.connect(panner);
                    panner.connect(this.ctx.destination);
                } else {
                    g.connect(this.ctx.destination);
                }
                o.start(t); o.stop(t + dur);
            }
            pop(p = 0.5, pan = 0) {
                // 原木球拍清脆打擊聲 (Crisp Wood Paddle Pop)
                this.tone('sine', 220 + p * 180, 55, 0.042, 0.65, pan);
                this.tone('triangle', 950 + p * 450, 320, 0.035, 0.18, pan);
                if (typeof Haptic !== 'undefined') Haptic.hit(p);
            }
            thump(p = 1, pan = 0) { this.tone('sine', 108, 30, 0.075, 0.30 * Math.min(1, p), pan); }
            coach() { this.tone('triangle', 523.25, 659.25, 0.10, 0.22); }
            net() {
                this.tone('triangle', 250, 85, 0.13, 0.34);
                if (typeof Haptic !== 'undefined') Haptic.fault();
            }
            fault() {
                // 溫和抱歉的小失誤聲，非刺耳噪音
                this.tone('sine', 480, 220, 0.18, 0.18);
                this.tone('triangle', 320, 160, 0.22, 0.14);
                if (typeof Haptic !== 'undefined') Haptic.fault();
            }
            point() {
                // 歡快雙音木琴 (Cozy Marimba Two-tone)
                this.tone('triangle', 587.33, 587.33, 0.14, 0.26); // D5
                if (typeof later === 'function') later(() => this.tone('triangle', 880, 880, 0.18, 0.22), 85); // A5
                else setTimeout(() => this.tone('triangle', 880, 880, 0.18, 0.22), 85);
            }
            swap() { this.tone('triangle', 440, 660, 0.12, 0.20); }
            tick() { this.tone('sine', 1200, 800, 0.025, 0.08); }
            ready() { this.tone('sine', 659.25, 783.99, 0.12, 0.18); }
            like() {
                // 甜美愛心叮咚聲
                this.tone('sine', 659.25, 659.25, 0.08, 0.18);
                const delayFn = (typeof later === 'function') ? later : setTimeout;
                delayFn(() => this.tone('sine', 987.77, 987.77, 0.14, 0.22), 70);
            }
            // ═══════ 清新風格專屬療癒音效 ═══════
            quack() {
                // 匹克鵝村長俏皮叫聲 (Playful Goose Quack)
                this.tone('sawtooth', 330, 240, 0.09, 0.16);
                const delayFn = (typeof later === 'function') ? later : setTimeout;
                delayFn(() => this.tone('sawtooth', 290, 210, 0.11, 0.14), 75);
            }
            fanfare() {
                // 勝利大獎賽號角琶音 (Victory Marimba Arpeggio: C-E-G-C)
                const delayFn = (typeof later === 'function') ? later : setTimeout;
                this.tone('triangle', 523.25, 523.25, 0.12, 0.25); // C5
                delayFn(() => this.tone('triangle', 659.25, 659.25, 0.12, 0.25), 90); // E5
                delayFn(() => this.tone('triangle', 783.99, 783.99, 0.12, 0.25), 180); // G5
                delayFn(() => this.tone('triangle', 1046.50, 1046.50, 0.28, 0.32), 270); // C6
            }
            shutter() {
                // 拍立得快門機械喀嚓聲 (Polaroid Camera Shutter)
                this.tone('sine', 1600, 200, 0.03, 0.22);
                const delayFn = (typeof later === 'function') ? later : setTimeout;
                delayFn(() => this.tone('triangle', 400, 120, 0.08, 0.25), 45);
            }
        }
        const S = new Sound();
