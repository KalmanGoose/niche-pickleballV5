/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 音效系統與 Web Audio 合成器 (Audio System)
   ═══════════════════════════════════════════════════════════════════ */
        const AUDIO_PREFS = { sfxOn: true, master: 0.8 };
        const PREF_KEY = 'nchu_pb_audio';
        function loadAudioPrefs() {
            try {
                const raw = localStorage.getItem(PREF_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (typeof o.sfxOn === 'boolean') AUDIO_PREFS.sfxOn = o.sfxOn;
                    if (typeof o.master === 'number') AUDIO_PREFS.master = Math.min(1, Math.max(0, o.master));
                }
            } catch (e) { }
        }
        function saveAudioPrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(AUDIO_PREFS)); } catch (e) { } }
        function syncAudioUI() {
            const cb = document.getElementById('pref-sfx'), rg = document.getElementById('pref-vol'),
                nm = document.getElementById('pref-vol-num');
            if (cb) cb.checked = AUDIO_PREFS.sfxOn;
            if (rg) { rg.value = Math.round(AUDIO_PREFS.master * 100); rg.disabled = !AUDIO_PREFS.sfxOn; }
            if (nm) nm.innerText = Math.round(AUDIO_PREFS.master * 100) + '%';
        }
        function onSfxToggle(on) { AUDIO_PREFS.sfxOn = !!on; saveAudioPrefs(); syncAudioUI(); if (on) { S.init(); S.swap(); } }
        function onVolInput(v) {
            AUDIO_PREFS.master = Math.min(1, Math.max(0, v / 100));
            document.getElementById('pref-vol-num').innerText = Math.round(AUDIO_PREFS.master * 100) + '%';
            saveAudioPrefs();
        }
        function testSfx() { S.init(); S.pop(0.75); later(() => S.point(), 220); }
        function openAudioModal() { syncAudioUI(); document.getElementById('audio-modal').style.display = 'flex'; closePanel(); S.init(); }
        function closeAudioModal() { document.getElementById('audio-modal').style.display = 'none'; saveAudioPrefs(); clearKeys(); }
        function openTechModal() { document.getElementById('tech-modal').style.display = 'flex'; closePanel(); }
        function closeTechModal() { document.getElementById('tech-modal').style.display = 'none'; clearKeys(); }

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
            }
            thump(p = 1, pan = 0) { this.tone('sine', 108, 30, 0.075, 0.30 * Math.min(1, p), pan); }
            coach() { this.tone('triangle', 523.25, 659.25, 0.10, 0.22); }
            net() { this.tone('triangle', 250, 85, 0.13, 0.34); }
            fault() {
                // 溫和抱歉的小失誤聲，非刺耳噪音
                this.tone('sine', 480, 220, 0.18, 0.18);
                this.tone('triangle', 320, 160, 0.22, 0.14);
            }
            point() {
                // 動森風歡快雙音木琴 (Cozy Marimba Two-tone)
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
            // ═══════ 動森風格專屬療癒音效 ═══════
            quack() {
                // 匹克鵝村長俏皮叫聲 (Playful Goose Quack)
                this.tone('sawtooth', 330, 240, 0.09, 0.16);
                const delayFn = (typeof later === 'function') ? later : setTimeout;
                delayFn(() => this.tone('sawtooth', 290, 210, 0.11, 0.14), 75);
            }
            fanfare() {
                // 勝利大獎賽動森號角琶音 (Victory Marimba Arpeggio: C-E-G-C)
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
