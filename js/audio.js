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
            tone(type, f0, f1, dur, vol) {
                if (!AUDIO_PREFS.sfxOn || AUDIO_PREFS.master <= 0) return;
                this.init(); if (!this.ctx) return;
                const t = this.ctx.currentTime;
                const o = this.ctx.createOscillator(), g = this.ctx.createGain();
                o.type = type;
                o.frequency.setValueAtTime(f0, t);
                o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
                g.gain.setValueAtTime(Math.max(0.0009, vol * AUDIO_PREFS.master), t);
                g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
                o.connect(g); g.connect(this.ctx.destination);
                o.start(t); o.stop(t + dur);
            }
            pop(p = 0.5) { this.tone('sine', 190 + p * 150, 48, 0.038, 0.62); this.tone('triangle', 900 + p * 400, 300, 0.03, 0.12); }
            thump(p = 1) { this.tone('sine', 108, 30, 0.075, 0.30 * Math.min(1, p)); }
            net() { this.tone('triangle', 250, 85, 0.13, 0.34); }
            fault() { this.tone('square', 760, 220, 0.24, 0.17); }
            point() { this.tone('triangle', 540, 1020, 0.17, 0.26); later(() => this.tone('triangle', 780, 1300, 0.14, 0.2), 95); }
            swap() { this.tone('triangle', 420, 740, 0.13, 0.22); }
            tick() { this.tone('square', 1200, 900, 0.03, 0.08); }
            ready() { this.tone('sine', 660, 990, 0.10, 0.16); }
            like() { this.tone('triangle', 700, 1250, 0.12, 0.20); }
        }
        const S = new Sound();
