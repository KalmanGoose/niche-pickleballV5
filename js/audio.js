/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 音效系統與 Web Audio 合成器 (Audio System)
   ═══════════════════════════════════════════════════════════════════ */
        const AUDIO_PREFS = { sfxOn: true, master: 0.8, vibrateOn: true, ttsOn: true, ttsVoiceStyle: 'sweet', ttsVoiceUri: '' };
        const PREF_KEY = 'nchu_pb_audio';
        function loadAudioPrefs() {
            try {
                const raw = localStorage.getItem(PREF_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (typeof o.sfxOn === 'boolean') AUDIO_PREFS.sfxOn = o.sfxOn;
                    if (typeof o.master === 'number') AUDIO_PREFS.master = Math.min(1, Math.max(0, o.master));
                    if (typeof o.vibrateOn === 'boolean') AUDIO_PREFS.vibrateOn = o.vibrateOn;
                    if (typeof o.ttsOn === 'boolean') AUDIO_PREFS.ttsOn = o.ttsOn;
                    if (typeof o.ttsVoiceStyle === 'string') AUDIO_PREFS.ttsVoiceStyle = o.ttsVoiceStyle;
                    if (typeof o.ttsVoiceUri === 'string') AUDIO_PREFS.ttsVoiceUri = o.ttsVoiceUri;
                }
            } catch (e) { }
        }
        function saveAudioPrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(AUDIO_PREFS)); } catch (e) { } }
        loadAudioPrefs();
        function syncAudioUI() {
            const cb = document.getElementById('pref-sfx'), rg = document.getElementById('pref-vol'),
                nm = document.getElementById('pref-vol-num'),
                vb = document.getElementById('pref-vibrate'),
                vbHint = document.getElementById('pref-vibrate-hint');
            if (cb) cb.checked = AUDIO_PREFS.sfxOn;
            if (rg) { rg.value = Math.round(AUDIO_PREFS.master * 100); rg.disabled = !AUDIO_PREFS.sfxOn; }
            if (nm) nm.innerText = Math.round(AUDIO_PREFS.master * 100) + '%';
            const tts = document.getElementById('pref-tts');
            if (tts) tts.checked = AUDIO_PREFS.ttsOn !== false;
            if (vb) {
                vb.checked = AUDIO_PREFS.vibrateOn;
                if (vbHint) {
                    const sup = typeof Haptic !== 'undefined' && Haptic.isSupported();
                    vbHint.innerText = sup
                        ? '已連線手機震動馬達 (支援 Android/Chrome 等)'
                        : '此裝置不支援震動 API (iOS/Safari 以音效共振替代)';
                }
            }
            const style = AUDIO_PREFS.ttsVoiceStyle || 'sweet';
            ['sweet', 'coach', 'goose'].forEach(s => {
                const btn = document.getElementById('vstyle-' + s);
                if (btn) btn.classList.toggle('on', s === style);
            });
            const curLabel = document.getElementById('tts-current-voice-name');
            if (curLabel) {
                const styleLabels = {
                    sweet: '🌸 甜美親切 (溫柔學姐)',
                    coach: '🎾 熱血裁判 (宏亮果斷)',
                    goose: '🪿 俏皮神鵝 (中興村長)'
                };
                curLabel.innerText = styleLabels[style] || '🌸 甜美親切';
            }
            populateVoiceSelector();
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
        
        let cachedVoices = [];
        function updateVoiceList() {
            if (typeof window === "undefined" || !window.speechSynthesis) return;
            try {
                cachedVoices = window.speechSynthesis.getVoices() || [];
                populateVoiceSelector();
            } catch (e) {}
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
            if (window.speechSynthesis.onvoiceschanged !== undefined) {
                window.speechSynthesis.onvoiceschanged = updateVoiceList;
            }
            updateVoiceList();
        }

        function populateVoiceSelector() {
            const sel = document.getElementById('pref-tts-voice-select');
            if (!sel) return;
            if (!cachedVoices || !cachedVoices.length) {
                try {
                    cachedVoices = window.speechSynthesis.getVoices() || [];
                } catch (e) {}
            }
            const currentVal = AUDIO_PREFS.ttsVoiceUri || '';
            const zhVoices = (cachedVoices || []).filter(v => v.lang && (
                v.lang.toLowerCase().includes('zh') ||
                v.lang.toLowerCase().includes('cmn')
            ));
            if (!zhVoices.length) return;
            let html = '<option value="">✨ 智能最佳人聲 (推薦)</option>';
            zhVoices.forEach(v => {
                let label = v.name;
                if (label.includes('Mei-Jia')) label = '🌸 美佳 Mei-Jia (台灣甜美女聲)';
                else if (label.includes('HsiaoChen')) label = '🌸 曉臻 HsiaoChen (台灣自然女聲)';
                else if (label.includes('YunJhe')) label = '🎾 雲哲 YunJhe (台灣自然男聲)';
                else if (label.includes('Google 國語')) label = '🌟 Google 國語 (台灣標準)';
                else if (label.includes('Ting-Ting')) label = '🌸 婷婷 Ting-Ting (標準女聲)';
                else if (label.includes('Sinji')) label = '🎾 新吉 Sinji (台灣男聲)';
                else if (label.includes('HanHan')) label = '🌸 涵涵 HanHan (標準女聲)';
                const isSel = (v.voiceURI === currentVal || v.name === currentVal) ? ' selected' : '';
                html += '<option value="' + (v.voiceURI || v.name) + '"' + isSel + '>' + label + '</option>';
            });
            sel.innerHTML = html;
        }

        function findBestVoice(preferredStyle) {
            if (!cachedVoices.length && typeof window !== "undefined" && window.speechSynthesis) {
                try { cachedVoices = window.speechSynthesis.getVoices() || []; } catch (e) {}
            }
            if (!cachedVoices || !cachedVoices.length) return null;

            if (AUDIO_PREFS.ttsVoiceUri) {
                const matched = cachedVoices.find(v => v.voiceURI === AUDIO_PREFS.ttsVoiceUri || v.name === AUDIO_PREFS.ttsVoiceUri);
                if (matched) return matched;
            }

            const zhVoices = cachedVoices.filter(v => v.lang && (
                v.lang.toLowerCase().includes('zh') ||
                v.lang.toLowerCase().includes('cmn')
            ));
            if (!zhVoices.length) return cachedVoices[0] || null;

            const femaleKeywords = ['mei-jia', 'hsiaochen', 'ting-ting', 'yuna', 'hanhan', 'xiaoxiao', 'female', '女', 'sweet'];
            const maleKeywords = ['yunjhe', 'danny', 'kangkang', 'yunxi', 'male', '男', 'coach', 'sinji'];

            const sorted = [...zhVoices].sort((a, b) => {
                const aName = (a.name || '').toLowerCase();
                const bName = (b.name || '').toLowerCase();
                const aLang = (a.lang || '').toLowerCase();
                const bLang = (b.lang || '').toLowerCase();

                const aTw = (aLang.includes('tw') || aLang.includes('hant')) ? 100 : 0;
                const bTw = (bLang.includes('tw') || bLang.includes('hant')) ? 100 : 0;

                const aQuality = (aName.includes('natural') || aName.includes('enhanced') || aName.includes('premium') || aName.includes('neural')) ? 50 : 0;
                const bQuality = (bName.includes('natural') || bName.includes('enhanced') || bName.includes('premium') || bName.includes('neural')) ? 50 : 0;

                let aStyle = 0, bStyle = 0;
                if (preferredStyle === 'coach') {
                    if (maleKeywords.some(k => aName.includes(k))) aStyle = 30;
                    if (maleKeywords.some(k => bName.includes(k))) bStyle = 30;
                } else {
                    if (femaleKeywords.some(k => aName.includes(k))) aStyle = 30;
                    if (femaleKeywords.some(k => bName.includes(k))) bStyle = 30;
                }
                return (bTw + bQuality + bStyle) - (aTw + aQuality + aStyle);
            });
            return sorted[0];
        }

        function naturalizePickleballSpeech(text) {
            if (!text) return "";
            let s = String(text);
            s = s.replace(/[（(][^）)]*[）)]/g, " ");
            s = s.replace(/(\d+)\s*[-－—]\s*(\d+)/g, "$1 比 $2");
            const numZh = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
            s = s.replace(/第\s*(\d+)\s*關/g, (m, n) => "第" + (numZh[+n] || n) + "關");
            s = s.replace(/\bSide[- ]?out\b/gi, "換發球！Side-out");
            s = s.replace(/\bDink\b/gi, "放短小球");
            s = s.replace(/\bDrop\b/gi, "第三拍吊球");
            s = s.replace(/\bDrive\b/gi, "平抽球");
            s = s.replace(/\bFault\b/gi, "違規失誤");
            s = s.replace(/<[^>]+>/g, " ");
            s = s.replace(/[*#_`~]/g, " ");
            s = s.replace(/[!！]+/g, "！");
            s = s.replace(/[,，]+/g, "，");
            return s.trim();
        }

        function onTtsToggle(on) {
            AUDIO_PREFS.ttsOn = !!on;
            saveAudioPrefs();
            syncAudioUI();
            if (on) speakReferee("語音裁判已就緒，祝你比賽順利！");
        }
        function setTtsVoiceStyle(style) {
            AUDIO_PREFS.ttsVoiceStyle = style;
            saveAudioPrefs();
            syncAudioUI();
            const demoPhrases = {
                sweet: "發球！中興大學零比零，祝你打出精彩好球！",
                coach: "各就各位！比分零比零，發球開始！",
                goose: "呱呱！發球養成零比零，看我的旋風回擊呱！"
            };
            speakReferee(demoPhrases[style] || demoPhrases.sweet);
            if (typeof toast === 'function') {
                const styleNames = { sweet: "🌸 甜美親切 (溫柔學姐)", coach: "🎾 熱血裁判 (宏亮果斷)", goose: "🪿 俏皮神鵝 (中興村長)" };
                toast('🎙️ 已切換裁判音色', styleNames[style] || style);
            }
        }
        function onTtsVoiceSelect(uri) {
            AUDIO_PREFS.ttsVoiceUri = uri || '';
            saveAudioPrefs();
            speakReferee("語音引擎切換完成，祝你比賽順利！");
        }
        function testTts() {
            const style = AUDIO_PREFS.ttsVoiceStyle || 'sweet';
            const demoPhrases = {
                sweet: "發球！中興大學零比零，祝你打出精彩好球！",
                coach: "各就各位！比分零比零，發球開始！",
                goose: "呱呱！發球養成零比零，看我的旋風回擊呱！"
            };
            speakReferee(demoPhrases[style] || demoPhrases.sweet);
            if (typeof toast === "function") toast("📢 裁判語音試聽", "正在以精緻人聲朗讀匹克球比分");
        }
        function speakReferee(text, lang = "zh-TW") {
            if (AUDIO_PREFS.ttsOn === false) return;
            if (typeof window === "undefined" || !window.speechSynthesis) return;
            try {
                window.speechSynthesis.cancel();
                const speechText = naturalizePickleballSpeech(text);
                if (!speechText) return;
                const utter = new SpeechSynthesisUtterance(speechText);
                const style = AUDIO_PREFS.ttsVoiceStyle || 'sweet';
                const bestVoice = findBestVoice(style);
                if (bestVoice) {
                    utter.voice = bestVoice;
                    utter.lang = bestVoice.lang || lang;
                } else {
                    utter.lang = lang;
                }

                if (style === 'coach') {
                    utter.pitch = 0.90;
                    utter.rate = 1.06;
                } else if (style === 'goose') {
                    utter.pitch = 1.28;
                    utter.rate = 1.10;
                } else { // 'sweet'
                    utter.pitch = 1.10;
                    utter.rate = 1.02;
                }

                utter.volume = Math.min(1, Math.max(0.2, (AUDIO_PREFS.master || 0.8) * 1.2));
                window.speechSynthesis.speak(utter);
            } catch (e) {}
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
            window.onTtsToggle = onTtsToggle;
            window.setTtsVoiceStyle = setTtsVoiceStyle;
            window.onTtsVoiceSelect = onTtsVoiceSelect;
            window.testTts = testTts;
            window.speakReferee = speakReferee;
            window.loadAudioPrefs = loadAudioPrefs;
            window.saveAudioPrefs = saveAudioPrefs;
            window.syncAudioUI = syncAudioUI;
            window.__setTtsVoiceStyle = setTtsVoiceStyle;
            window.__onTtsVoiceSelect = onTtsVoiceSelect;
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
