/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 系統常數、設定與資料庫 (Config & Identity)
   ═══════════════════════════════════════════════════════════════════ */
        const APP_VERSION = 'v5.0.14';

        /* ═══════ 雙軌物理引擎模式 (Dual Physics Modes) ═══════ */
        const PHYSICS_MODES = {
            FAST: 'fast',          // ⚡ 極速經驗模式 (Arcade Mode): 輕量線性阻尼，保證 60 FPS 順暢省電
            ACADEMIC: 'academic'   // 🔬 嚴格學術求解 (Simulation Mode): 真實質量、密度、阻力與馬格努斯微分方程
        };
        let currentPhysicsMode = localStorage.getItem('nchu_physics_mode') || PHYSICS_MODES.FAST;
/* ═══════════════════════════════════════════════
           ★★★ 部署設定:這兩行要換成你自己的 ★★★
           ═══════════════════════════════════════════════ */
        const GAS_URL = 'https://script.google.com/macros/s/AKfycbwbQJTyJFtZjGOHs_EzYnbbQjq1Znj8KHG1l9uVhgqsyUK2KpkwdN6nydNNvyqz394mGQ/exec';
        const SIGN_SECRET = 'nchu-pickleball-2026-secret';
        const API_READY = () => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GAS_URL);

        /* ═══════ 純 JS HMAC-SHA256 ═══════ */
        const SHA = (() => {
            const K = new Uint32Array([
                0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
                0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
                0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
                0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
                0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
                0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
                0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
                0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
            const rr = (x, n) => (x >>> n) | (x << (32 - n));
            function digest(bytes) {
                const l = bytes.length;
                const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6);
                buf.set(bytes); buf[l] = 0x80;
                const bits = l * 8;
                buf[buf.length - 4] = (bits >>> 24) & 255; buf[buf.length - 3] = (bits >>> 16) & 255;
                buf[buf.length - 2] = (bits >>> 8) & 255; buf[buf.length - 1] = bits & 255;
                const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
                const w = new Uint32Array(64);
                for (let i = 0; i < buf.length; i += 64) {
                    for (let t = 0; t < 16; t++) w[t] = (buf[i + 4 * t] << 24) | (buf[i + 4 * t + 1] << 16) | (buf[i + 4 * t + 2] << 8) | buf[i + 4 * t + 3];
                    for (let t = 16; t < 64; t++) {
                        const s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
                        const s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
                        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
                    }
                    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
                    for (let t = 0; t < 64; t++) {
                        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g);
                        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
                        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c);
                        const t2 = (S0 + mj) >>> 0;
                        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
                    }
                    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
                    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
                }
                const out = new Uint8Array(32);
                for (let i = 0; i < 8; i++) {
                    out[4 * i] = (H[i] >>> 24) & 255; out[4 * i + 1] = (H[i] >>> 16) & 255;
                    out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255;
                }
                return out;
            }
            const enc = s => new TextEncoder().encode(s);
            const b64 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
            function hmac(keyStr, msgStr) {
                let key = enc(keyStr);
                if (key.length > 64) key = digest(key);
                const ip = new Uint8Array(64), op = new Uint8Array(64);
                for (let i = 0; i < 64; i++) { const k = i < key.length ? key[i] : 0; ip[i] = k ^ 0x36; op[i] = k ^ 0x5c; }
                const m = enc(msgStr);
                const inner = new Uint8Array(64 + m.length); inner.set(ip); inner.set(m, 64);
                const ih = digest(inner);
                const outer = new Uint8Array(96); outer.set(op); outer.set(ih, 64);
                return b64(digest(outer));
            }
            return { hmac };
        })();

        /* Content-Type 必須 text/plain,否則觸發 CORS preflight 而 GAS 不處理 OPTIONS */
        function postSigned(payload) {
            if (!API_READY()) return Promise.resolve({ ok: false, err: 'GAS_URL_NOT_SET' });
            const data = JSON.stringify(payload);
            const ts = Date.now(), nonce = Math.random().toString(36).slice(2, 10);
            const env = { data, ts, nonce, sig: SHA.hmac(SIGN_SECRET, data + '|' + ts + '|' + nonce) };
            return fetch(GAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(env)
            }).then(r => r.json()).catch(() => ({ ok: false, err: 'NETWORK_FAIL' }));
        }
        function apiGet(qs) {
            if (!API_READY()) return Promise.resolve({ ok: false, err: 'GAS_URL_NOT_SET' });
            return fetch(GAS_URL + '?' + qs).then(r => r.json()).catch(() => ({ ok: false, err: 'NETWORK_FAIL' }));
        }

        /* ═══════ 系所代碼表(115 學年度‧學士班) ═══════ */
        const DEPT_LIST = [
            { code: '10F', name: '台灣人文創新學士學位學程', college: '文學院', sid: ['U10F'] },
            { code: '11', name: '中國文學系', college: '文學院', sid: ['U11'] },
            { code: '12', name: '外國語文學系', college: '文學院', sid: ['U12'] },
            { code: '13', name: '歷史學系', college: '文學院', sid: ['U13'] },
            { code: '21', name: '財務金融學系', college: '管理學院', sid: ['U21'] },
            { code: '23', name: '企業管理學系', college: '管理學院', sid: ['U23'] },
            { code: '28', name: '會計學系', college: '管理學院', sid: ['U28'] },
            { code: '29', name: '資訊管理學系', college: '管理學院', sid: ['U29'] },
            { code: '44', name: '行銷學系', college: '管理學院', sid: ['U44'] },
            { code: '24', name: '法律學系', college: '法政學院', sid: ['U24'] },
            { code: '30F', name: '景觀與遊憩學士學位學程', college: '農資學院', sid: ['U30F'] },
            { code: '30G', name: '生物科技學士學位學程', college: '農資學院', sid: ['U30G'] },
            { code: '30H', name: '國際農企業學士學位學程', college: '農資學院', sid: ['U30H'] },
            { code: '31', name: '農藝學系', college: '農資學院', sid: ['U31'] },
            { code: '32', name: '園藝學系', college: '農資學院', sid: ['U32'] },
            { code: '33', name: '森林學系', college: '農資學院', sid: ['U33'] },
            { code: '34', name: '應用經濟學系', college: '農資學院', sid: ['U34'] },
            { code: '35', name: '植物病理學系', college: '農資學院', sid: ['U35'] },
            { code: '36', name: '昆蟲學系', college: '農資學院', sid: ['U36'] },
            { code: '37', name: '動物科學系', college: '農資學院', sid: ['U37'] },
            { code: '39', name: '土壤環境科學系', college: '農資學院', sid: ['U39'] },
            { code: '40', name: '生物產業機電工程學系', college: '農資學院', sid: ['U40'] },
            { code: '42', name: '水土保持學系', college: '農資學院', sid: ['U42'] },
            { code: '43', name: '食品暨應用生物科技學系', college: '農資學院', sid: ['U43'] },
            { code: '38', name: '獸醫學系', college: '獸醫學院', sid: ['U38'] },
            { code: '51', name: '化學系', college: '理學院', sid: ['U51'] },
            { code: '53', name: '應用數學系', college: '理學院', sid: ['U53', 'U53F', 'U53G'] },
            { code: '54', name: '物理學系', college: '理學院', sid: ['U54'] },
            { code: '52', name: '生命科學系', college: '生命科學院', sid: ['U52'] },
            { code: '56', name: '資訊工程學系', college: '電資學院', sid: ['U56'] },
            { code: '64', name: '電機工程學系', college: '電資學院', sid: ['U64'] },
            { code: '64F', name: '電機資訊學院學士班', college: '電資學院', sid: ['U64F'] },
            { code: '01F', name: '學士後發光二極體學士學位學程', college: '工學院', sid: ['U01F'] },
            { code: '60F', name: '學士後太陽能光電系統應用學士學位學程', college: '工學院', sid: ['U60F'] },
            { code: '60G', name: '智慧創意工程學士學位學程學士班', college: '工學院', sid: ['U60G'] },
            { code: '61', name: '機械工程學系', college: '工學院', sid: ['U61'] },
            { code: '62', name: '土木工程學系', college: '工學院', sid: ['U62'] },
            { code: '63', name: '環境工程學系', college: '工學院', sid: ['U63'] },
            { code: '65', name: '化學工程學系', college: '工學院', sid: ['U65'] },
            { code: '66', name: '材料科學與工程學系', college: '工學院', sid: ['U66'] },
            { code: '86', name: '學士後醫學系', college: '醫學院', sid: ['U86'] },
            { code: 'OTHER', name: '其他 / 碩博班(手動填寫)', college: '其他', sid: [] }
        ];
        /* 只收 3 碼;含第四碼的學位學程不自動判定,避免誤判成同號別系 */
        const SID_MAP = (() => {
            const m = {};
            DEPT_LIST.forEach(d => d.sid.forEach(s => {
                const f = s.replace(/^U/, '0');
                if (f.length === 3) m[f] = d;
            }));
            return m;
        })();
        const EDU_MAP = { '4': '學士班' };

        function rocYear() {
            const d = new Date(), r = d.getFullYear() - 1911;
            return (d.getMonth() >= 7) ? r : r - 1;
        }
        function gradeOf(entry) {
            const n = rocYear() - entry + 1;
            if (n <= 0) return '大一';
            return n <= 4 ? ['大一', '大二', '大三', '大四'][n - 1] : '延修生';
        }
        function parseStudentId(raw) {
            const s = String(raw || '').trim();
            if (!/^\d{7}$/.test(s)) return { ok: false, msg: '需輸入 7 位數字' };
            const year = parseInt(s.slice(1, 4), 10);
            if (!(year >= 90 && year <= rocYear() + 1)) return { ok: false, msg: '入學學年不合理' };
            const field = s.slice(4, 7), hit = SID_MAP[field];
            return {
                ok: true, prefix: s, eduCode: s.slice(0, 1), edu: EDU_MAP[s.slice(0, 1)] || '',
                entryYear: year, deptField: field, dept: hit || null, grade: gradeOf(year), matched: !!hit
            };
        }
        function buildDeptOptions() {
            const sel = document.getElementById('user-dept-sel');
            sel.innerHTML = '<option value="">— 請選擇系所 —</option>';
            const g = {};
            DEPT_LIST.forEach(d => { (g[d.college] = g[d.college] || []).push(d); });
            Object.keys(g).forEach(col => {
                const og = document.createElement('optgroup'); og.label = col;
                g[col].forEach(d => {
                    const o = document.createElement('option');
                    o.value = d.code; o.textContent = d.name; og.appendChild(o);
                });
                sel.appendChild(og);
            });
        }
        function onSidInput(v) {
            const msg = document.getElementById('sid-msg');
            const sel = document.getElementById('user-dept-sel');
            const gsel = document.getElementById('user-grade-sel');
            const r = parseStudentId(v);
            if (!r.ok) { msg.innerText = '⚠ ' + r.msg; msg.className = 'sid-msg bad'; return; }
            if (r.matched && r.edu) {
                msg.innerText = '✅ ' + r.dept.name + r.grade + '(入學 ' + r.entryYear + ' 學年)';
                msg.className = 'sid-msg ok';
                if (!sel.dataset.touched) { sel.value = r.dept.code; onDeptSelect(); }
                if (!gsel.dataset.touched) gsel.value = r.grade;
            } else {
                msg.innerText = '⚠ 無法自動判定,請手動選擇系所與年級';
                msg.className = 'sid-msg warn';
            }
        }
        function onDeptSelect() {
            const sel = document.getElementById('user-dept-sel');
            document.getElementById('user-dept-manual').style.display = (sel.value === 'OTHER') ? 'block' : 'none';
        }

        /* ═══════ 頭像:單一資料源,登入與設定共用 ═══════ */
        const AVATARS = ['🪿', '🧢', '🏸', '🧋', '⚡', '🐮', '🍎', '🥩', '🪳'];
        function buildAvatarGrid(id, onPick) {
            const box = document.getElementById(id);
            if (!box) return;
            box.innerHTML = '';
            AVATARS.forEach(em => {
                const d = document.createElement('div');
                d.className = 'avatar-opt' + (em === playerProfile.avatar ? ' selected' : '');
                d.textContent = em;
                d.addEventListener('click', () => onPick(em, d));
                box.appendChild(d);
            });
        }
        function buildAvatarGrids() {
            buildAvatarGrid('login-avatar-grid', selectAvatar);
            buildAvatarGrid('edit-avatar-grid', selectEditAvatar);
        }
        function selectAvatar(em, el) {
            document.querySelectorAll('#login-avatar-grid .avatar-opt').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected'); playerProfile.avatar = em;
        }
        function selectEditAvatar(em, el) {
            document.querySelectorAll('#edit-avatar-grid .avatar-opt').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected'); playerProfile.avatar = em;
        }
        function setNick(t) { document.getElementById('user-nick').value = t; }

        /* ═══════ 身分編號 (方案 B: 裝置綁定唯一 ID) ═══════ */
        const ID_KEY = 'nchu_pb_identity';
        function genPlayerId() {
            let rnd;
            if (window.crypto && crypto.getRandomValues) {
                rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
            } else rnd = Math.random().toString(36).substring(2, 6);
            return 'P-' + Date.now().toString(36).toUpperCase() + '-' + rnd.toUpperCase();
        }
        function loadIdentity() { try { return JSON.parse(localStorage.getItem(ID_KEY)); } catch (e) { return null; } }
        function saveIdentity(o) { try { localStorage.setItem(ID_KEY, JSON.stringify(o)); } catch (e) { } }
        function getOrCreatePlayerId() {
            const saved = loadIdentity() || {};
            if (!saved.playerId) {
                saved.playerId = genPlayerId();
                saveIdentity(saved);
            }
            return saved.playerId;
        }

        let playerProfile = {
            playerId: null, avatar: '🪿', sidPrefix: '', deptCode: '',
            department: '', grade: '', entryYear: '', nickname: '叫獸aka愛叫的野獸', sessionId: null
        };

        /* ═══════ 教練模式與參數熱抽換 (Dual-Track Model) ═══════ */
        const MODEL_STORAGE_KEY = 'nchu_custom_motion_model';

        /* ═══════ 教練參數:可調鍵白名單 + 範圍夾制 ═══════ */
        const TUNABLE = {
            powerWeight: ['a', 'd', 'vScale', 'dScale', 'min', 'max'],
            serveFSM: ['WINDOW', 'TH_V', 'TH_D'],      // ★ 排除 phase/power/clock 執行期欄位
            aiSpeed: ['2', '3', '4', '5'],
            aiMiss: ['2', '3', '4', '5']
        };
        const RANGE = {
            'powerWeight.a': [0, 1], 'powerWeight.d': [0, 1],
            'powerWeight.vScale': [1, 40], 'powerWeight.dScale': [1, 80],
            'powerWeight.min': [0, 60], 'powerWeight.max': [20, 100],
            'serveFSM.WINDOW': [0.2, 3], 'serveFSM.TH_V': [0.3, 6], 'serveFSM.TH_D': [0.05, 2],
            'aiSpeed.*': [1, 12], 'aiMiss.*': [0, 0.6]
        };
        function pickNum(group, key, raw) {
            const n = Number(raw);
            if (!isFinite(n)) return null;
            const r = RANGE[group + '.' + key] || RANGE[group + '.*'];
            return r ? Math.min(r[1], Math.max(r[0], n)) : n;
        }
        function assignTunable(target, src, group) {
            if (!src || typeof src !== 'object') return;
            TUNABLE[group].forEach(k => {
                if (src[k] === undefined) return;
                const v = pickNum(group, k, src[k]);
                if (v !== null) target[k] = v;
            });
        }
        function mergeStages(src) {
            if (!src || typeof src !== 'object') return;
            Object.keys(src).forEach(k => {
                if (!STAGES[k] || !src[k]) return;              // 只允許覆寫既有關卡
                const g = Math.floor(Number(src[k].goal));
                if (isFinite(g) && g >= 1 && g <= 21) STAGES[k].goal = g;  // ★ 只動 goal
            });
        }
        function applyMotionModel(p) {
            if (!p) return;
            assignTunable(POWER_W, p.powerWeight, 'powerWeight');
            assignTunable(SFSM, p.serveFSM, 'serveFSM');
            assignTunable(AI_SPEED, p.aiSpeed, 'aiSpeed');
            assignTunable(AI_MISS, p.aiMiss, 'aiMiss');
            mergeStages(p.stages);
            if (POWER_W.max <= POWER_W.min) POWER_W.max = POWER_W.min + 10;
        }

        function loadCustomMotionModel() {
            try {
                const raw = localStorage.getItem(MODEL_STORAGE_KEY);
                if (raw) {
                    const data = JSON.parse(raw);
                    applyMotionModel(data.parameters || data);
                }
            } catch (e) { console.error('Failed to load custom motion model', e); }
        }

        function checkAdminAccess(inputNickname) {
            const raw = String(inputNickname || '').trim().toLowerCase();
            if (raw === 'coach#nchu' || raw === 'admin#pickle') {
                ['coach-import-btn', 'coach-export-btn', 'coach-reset-btn'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'block';
                });
                toast('🛠️ 教練/管理員模式已啟用', '已解鎖參數匯入、匯出與重置');
                return true;
            }
            return false;
        }

        function importMotionModel() {
            const fileInput = document.getElementById('coach-file-input');
            if (fileInput) fileInput.click();
        }

        function onCoachFileSelected(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => {
                try {
                    const json = JSON.parse(evt.target.result);
                    const params = json.parameters || json;
                    applyMotionModel(params);
                    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(json));
                    if (typeof updateGoal === 'function') updateGoal();
                    toast('✅ 教練參數已成功匯入', '已即時套用最新動力學與 AI 數值');
                } catch (err) {
                    toast('❌ 匯入失敗', 'JSON 格式錯誤: ' + err.message);
                }
                e.target.value = '';
            };
            reader.readAsText(file);
        }

        function exportMotionModel() {
            const modelData = {
                app: 'NCHU Pickleball Lab',
                version: '1.1-demo',
                exportedAt: new Date().toISOString(),
                devicePlayerId: playerProfile.playerId || getOrCreatePlayerId(),
                profile: {
                    nickname: playerProfile.nickname,
                    department: playerProfile.department
                    // ★ 刻意不匯出 sidPrefix:匯出檔會離開裝置
                },
                parameters: {
                    powerWeight: {
                        a: POWER_W.a, d: POWER_W.d, vScale: POWER_W.vScale,
                        dScale: POWER_W.dScale, min: POWER_W.min, max: POWER_W.max
                    },
                    serveFSM: { WINDOW: SFSM.WINDOW, TH_V: SFSM.TH_V, TH_D: SFSM.TH_D },
                    stages: {
                        1: { goal: STAGES[1].goal }, 2: { goal: STAGES[2].goal },
                        3: { goal: STAGES[3].goal }, 4: { goal: STAGES[4].goal },
                        5: { goal: STAGES[5].goal }
                    },
                    aiSpeed: Object.assign({}, AI_SPEED),
                    aiMiss: Object.assign({}, AI_MISS)
                },
                motionStats: motionSummary()
            };
            const blob = new Blob([JSON.stringify(modelData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'pickleball_motion_model.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast('📥 模型參數已匯出', 'pickleball_motion_model.json');
        }

        function resetMotionModel() {
            localStorage.removeItem(MODEL_STORAGE_KEY);
            toast('🔄 已還原為原廠預設值', '正在重載預設常數...');
            setTimeout(() => location.reload(), 1000);
        }

        function loginErr(msg) {
            const el = document.getElementById('sid-msg');
            el.innerText = '⚠ ' + msg;
            el.className = 'sid-msg bad';
        }

        function showFullLoginForm() {
            document.getElementById('login-quick-box').style.display = 'none';
            document.getElementById('login-full-form').style.display = 'block';
        }

        function handleQuickStart() {
            const saved = loadIdentity();
            if (saved && saved.department) {
                playerProfile.playerId = getOrCreatePlayerId();
                playerProfile.avatar = saved.avatar || '🪿';
                playerProfile.sidPrefix = saved.sidPrefix || '';
                playerProfile.deptCode = saved.deptCode || '';
                playerProfile.department = saved.department || '';
                playerProfile.grade = saved.grade || '';
                playerProfile.entryYear = saved.entryYear || '';
                playerProfile.nickname = saved.nickname || '叫獸aka愛叫的野獸';
                playerProfile.sessionId = 'S-' + Date.now().toString(36);
                checkAdminAccess(playerProfile.nickname);

                document.getElementById('p-who-label').innerText =
                    playerProfile.avatar + ' ' + playerProfile.nickname.slice(0, 6);
                document.getElementById('login-overlay').style.display = 'none';
                clearKeys();
                S.init();
                toast('👋 歡迎回來,' + playerProfile.department, '編號 ' + playerProfile.playerId);
                switchStage(1);
            } else {
                showFullLoginForm();
            }
        }

        function handleLogin() {
            const r = parseStudentId(document.getElementById('user-sid').value);
            if (!r.ok) { loginErr(r.msg); return; }
            const code = document.getElementById('user-dept-sel').value;
            if (!code) { loginErr('請在下拉選單選擇系所'); return; }
            const manual = document.getElementById('user-dept-manual').value.trim();
            if (code === 'OTHER' && !manual) { loginErr('請填寫系所名稱'); return; }

            const dept = (code === 'OTHER') ? manual : ((DEPT_LIST.find(d => d.code === code) || {}).name || '');
            const grade = document.getElementById('user-grade-sel').value;
            const nick = document.getElementById('user-nick').value.trim();

            playerProfile.playerId = getOrCreatePlayerId(); // ★ 方案 B: 裝置唯一 ID
            playerProfile.sidPrefix = r.prefix;
            playerProfile.deptCode = code;
            playerProfile.department = dept + grade;
            playerProfile.grade = grade;
            playerProfile.entryYear = String(r.entryYear);
            if (nick) playerProfile.nickname = nick;
            playerProfile.ig = (document.getElementById('edit-ig').value || '').trim();
            playerProfile.sessionId = 'S-' + Date.now().toString(36);
            checkAdminAccess(playerProfile.nickname);

            saveIdentity({
                playerId: playerProfile.playerId,
                sidPrefix: r.prefix,
                avatar: playerProfile.avatar,
                nickname: playerProfile.nickname,
                department: playerProfile.department,
                grade: playerProfile.grade,
                deptCode: playerProfile.deptCode,
                entryYear: playerProfile.entryYear
            });

            document.getElementById('p-who-label').innerText =
                playerProfile.avatar + ' ' + playerProfile.nickname.slice(0, 6);
            document.getElementById('login-overlay').style.display = 'none';
            clearKeys();
            S.init();
            toast('👋 歡迎,' + playerProfile.department, '編號 ' + playerProfile.playerId);
            switchStage(1);
        }
        function openProfileModal() {
            document.getElementById('edit-dept').value = playerProfile.department;
            document.getElementById('edit-nick').value = playerProfile.nickname;
            document.getElementById('edit-id-badge').innerText =
                '玩家編號 ' + (playerProfile.playerId || '未登入') +
                '　學號前綴 ' + (playerProfile.sidPrefix || '—');
            buildAvatarGrid('edit-avatar-grid', selectEditAvatar);
            document.getElementById('profile-modal').style.display = 'flex';
            closePanel();
        }
        function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; clearKeys(); }
        function saveProfile() {
            playerProfile.department = document.getElementById('edit-dept').value.trim() || playerProfile.department;
            const n = document.getElementById('edit-nick').value.trim();
            if (n) {
                playerProfile.nickname = n;
                checkAdminAccess(n);
            }
            document.getElementById('p-who-label').innerText =
                playerProfile.avatar + ' ' + playerProfile.nickname.slice(0, 6);
            const sv = loadIdentity() || {};
            sv.playerId = playerProfile.playerId || getOrCreatePlayerId();
            sv.sidPrefix = playerProfile.sidPrefix || sv.sidPrefix;
            sv.avatar = playerProfile.avatar;
            sv.nickname = playerProfile.nickname;
            sv.department = playerProfile.department;
            saveIdentity(sv);
            closeProfileModal();
            if (playerProfile.playerId) {
                postSigned({
                    act: 'updateProfile', playerId: playerProfile.playerId, avatar: playerProfile.avatar,
                    nickname: playerProfile.nickname, department: playerProfile.department
                });
            }
            toast('⚙️ 個人設定已儲存', '繼續中興湖特訓!');
        }

        /* ═══════ 音效偏好 ═══════ */

/* ═══════ 賽場尺寸、物理常數與 AI 難度常數 ═══════ */
        const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 820;
        const GRADE = { exposure: 1.05, hemiI: 1.05, sunI: 1.80, fillI: 0.45, rimI: 0.32, fogNear: 34, fogFar: 98 };
        const COURT_W = 6.10, COURT_L = 13.41, HALF_L = COURT_L / 2;
        const KITCHEN_D = 2.13, NET_H = 0.914, GRAVITY = 9.81;
        const BALL_R = 0.14, NET_CLEAR = NET_H + BALL_R + 0.14, SERVE_MAX_H = 1.15;
        const REST_Y = 0.55, REST_XZ = 0.68, DEAD_VY = 0.80;
        const DIAG_DEADZONE = 0.12;

        const STAGES = {
            1: { name: '發球養成', sub: 'Underhand Serve', desc: '左手舉高預備,球拍低於腰部、雙腳在底線後,對角送進綠區。', goal: 2 },
            2: { name: '雙彈跳規則', sub: 'Two-Bounce Rule', desc: '發球與接發球各必須先落地一次。等球彈起再回擊。', goal: 1 },
            3: { name: '廚房區攻防', sub: 'Kitchen Zone', desc: '球落進廚房時,等它彈起後再輕推回去 1 次即過關;球未落地就在廚房揮拍會被判違規。', goal: 1 },
            4: { name: '對決匹克鵝', sub: 'Full Match', desc: '綜合對決匹克鵝,先得 3 分過關。', goal: 3 },
            5: { name: '魔王匹克鵝', sub: 'Boss Fight', desc: '終極對決!打敗中興湖魔王匹克鵝登錄英雄榜。', goal: 5 }
        };
        const AI_SPEED = { 2: 5.2, 3: 5.9, 4: 5.2, 5: 5.6 };
        const AI_MISS = { 1: 0.0, 2: 0.005, 3: 0.005, 4: 0.20, 5: 0.14 }; // ★ v5.0.14: 前三關教學關卡匹克鵝失誤率極低 (0.5%)，偶爾失誤
        const AI_PLAN = { 2: 'DEEP', 3: 'KITCHEN', 4: 'MIX', 5: 'BOSS' };

        /* ★ v5.0.4: AI 難度平衡調優 (初階失誤率大幅調低，強化連續來回抽球的互動與參與感) */
        const DIFF_PRESETS = {
            easy:   { missMultiplier: 1.35, speedScale: 0.88, label: '🟢 初階 (高回球互動)', color: '#4ade80' },
            medium: { missMultiplier: 1.00, speedScale: 1.00, label: '🟡 中等 (標準對抗)', color: '#facc15' },
            hard:   { missMultiplier: 0.65, speedScale: 1.15, label: '🔴 困難 (魔王挑戰)', color: '#f87171' },
            fly:    { missMultiplier: 0.00, speedScale: 1.50, label: '🪰 仿生蒼蠅 (巨纖維神經反射)', color: '#a855f7' }
        };
        let diffLevel = 'easy'; // 預設初階
        try {
            const savedDiff = localStorage.getItem('nchu_pb_diff');
            if (savedDiff && DIFF_PRESETS[savedDiff]) diffLevel = savedDiff;
        } catch(e) {}

        function cycleDifficulty() {
            const order = ['easy', 'medium', 'hard', 'fly'];
            const next = order[(order.indexOf(diffLevel) + 1) % order.length];
            setDifficulty(next);
        }

        function setDifficulty(level) {
            if (!DIFF_PRESETS[level]) return;
            diffLevel = level;
            try { localStorage.setItem('nchu_pb_diff', level); } catch(e) {}
            syncDifficultyUI();
            if (typeof FunMode !== 'undefined' && FunMode.onDifficultyChange) {
                FunMode.onDifficultyChange(level);
            }
            const msg = (level === 'fly') ? '🪰 仿生蒼蠅已上陣 (巨纖維反射/小球視盲)' : (DIFF_PRESETS[level].label + ' 已套用');
            toast('🤖 AI 對手模式', msg);
        }

        function syncDifficultyUI() {
            document.querySelectorAll('[data-diff]').forEach(b => {
                b.classList.toggle('on', b.getAttribute('data-diff') === diffLevel);
            });
            const qdb = document.getElementById('quick-diff-btn');
            const qdn = document.getElementById('quick-diff-name');
            const conf = DIFF_PRESETS[diffLevel] || DIFF_PRESETS.easy;
            if (qdn) {
                const shortNames = { easy: '初階', medium: '中等', hard: '困難', fly: '蒼蠅' };
                qdn.innerText = shortNames[diffLevel] || '初階';
            }
            if (qdb) {
                qdb.style.borderColor = conf.color;
                qdb.style.color = conf.color;
            }
            const aiWho = document.getElementById('ai-who-label');
            if (aiWho) {
                aiWho.innerText = (diffLevel === 'fly') ? '🪰 仿生蒼蠅' : '🪿 匹克鵝';
            }
            if (typeof updateOpponentMeshVisibility === 'function') {
                updateOpponentMeshVisibility();
            }
        }

        /* ═══════ 搖桿走位速率設定 (Joystick Movement Speed Config) ═══════ */
        const JOY_SPEED_PRESETS = {
            slow:   { label: '慢速', fullLabel: '🐢 慢速 (4.5 m/s · 精準微步)', speed: 4.5 },
            normal: { label: '標準', fullLabel: '🚶 標準 (5.5 m/s · 舒適好控)', speed: 5.5 },
            fast:   { label: '疾速', fullLabel: '🏃 疾速 (7.2 m/s · 敏捷衝刺)', speed: 7.2 }
        };
        let joySpeedLevel = 'normal';
        try {
            const savedJoy = localStorage.getItem('nchu_pb_joy_speed');
            if (savedJoy && JOY_SPEED_PRESETS[savedJoy]) joySpeedLevel = savedJoy;
        } catch (e) { }

        function setJoySpeed(level) {
            if (!JOY_SPEED_PRESETS[level]) return;
            joySpeedLevel = level;
            try { localStorage.setItem('nchu_pb_joy_speed', level); } catch (e) { }
            syncJoySpeedUI();
            if (typeof toast === 'function') {
                toast('🕹️ 搖桿移動速率', JOY_SPEED_PRESETS[level].fullLabel);
            }
        }

        function cycleJoySpeedQuick() {
            const order = ['slow', 'normal', 'fast'];
            const idx = order.indexOf(joySpeedLevel);
            const next = order[(idx + 1) % order.length];
            setJoySpeed(next);
        }

        function syncJoySpeedUI() {
            const lbl = document.getElementById('joy-speed-lbl');
            if (lbl && JOY_SPEED_PRESETS[joySpeedLevel]) {
                lbl.innerText = JOY_SPEED_PRESETS[joySpeedLevel].label;
            }
            const aiJoyBtn = document.getElementById('subbar-joy-btn');
            if (aiJoyBtn && JOY_SPEED_PRESETS[joySpeedLevel]) {
                aiJoyBtn.innerHTML = `🕹️ 搖桿: ${JOY_SPEED_PRESETS[joySpeedLevel].label}`;
            }
            document.querySelectorAll('[data-joy-speed]').forEach(b => {
                b.classList.toggle('on', b.getAttribute('data-joy-speed') === joySpeedLevel);
            });
        }

        /* ═══════ 網前自動走位助攻設定 (Net Auto-Assist Config) ═══════ */
        // 預設關閉，杜絕純手動走位時擅自往前衝；體感模式或手動開啟時方生效
        let netAssistEnabled = false;
        try {
            const savedAssist = localStorage.getItem('nchu_pb_net_assist');
            if (savedAssist !== null) netAssistEnabled = (savedAssist === 'true');
        } catch (e) { }

        function setNetAssist(enabled) {
            netAssistEnabled = !!enabled;
            try { localStorage.setItem('nchu_pb_net_assist', netAssistEnabled); } catch (e) { }
            syncNetAssistUI();
            if (typeof toast === 'function') {
                toast('🏃 網前自動走位', netAssistEnabled ? '✅ 已開啟 (落入廚房自動前踏)' : '❌ 已關閉 (純手動走位)');
            }
        }

        function toggleNetAssist() {
            setNetAssist(!netAssistEnabled);
        }

        function syncNetAssistUI() {
            const btn = document.getElementById('subbar-net-assist-btn');
            if (btn) {
                if (netAssistEnabled) {
                    btn.innerHTML = '🏃 網前助攻: 開';
                    btn.style.color = 'var(--ok)';
                } else {
                    btn.innerHTML = '🏃 網前助攻: 關';
                    btn.style.color = 'var(--dim)';
                }
            }
            const drawerBtn = document.getElementById('drawer-net-assist-btn');
            if (drawerBtn) {
                drawerBtn.innerHTML = `🏃 網前自動走位: ${netAssistEnabled ? '✅ 開啟' : '❌ 關閉'}`;
                drawerBtn.classList.toggle('on', netAssistEnabled);
            }
        }



        const D = {
            pv: document.getElementById('pv') || { innerText: '' }, av: document.getElementById('av') || { innerText: '' },
            chip: document.getElementById('chip-n'), name: document.getElementById('s-name'),
            sub: document.getElementById('s-sub'), desc: document.getElementById('s-desc'),
            gFill: document.getElementById('goal-fill'), gTxt: document.getElementById('goal-txt'),
            hint: document.getElementById('hint'), tMain: document.getElementById('t-main'),
            tSub: document.getElementById('t-sub'), sp: document.getElementById('sp'),
            pFill: document.getElementById('p-fill'), demo: document.getElementById('demo'),
            dTag: document.getElementById('d-tag'), dCap: document.getElementById('d-cap'),
            aimHud: document.getElementById('aim-hud'), aimName: document.getElementById('aim-name'),
            aimPips: Array.prototype.slice.call(document.querySelectorAll('#aim-hud .aim-pip')),
            waistRow: document.getElementById('waist-row'), waistMark: document.getElementById('waist-mark'),
            camEdit: document.getElementById('cam-edit'), camVert: document.getElementById('cam-vert'),
            cvH: document.getElementById('cv-h'), cvD: document.getElementById('cv-d'), cvY: document.getElementById('cv-y'),
            ceHint: document.getElementById('ce-hint')
        };

        let timers = [];
        function later(fn, ms) {
            const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms);
            timers.push(id); return id;
        }
        function clearTimers() { timers.forEach(clearTimeout); timers = []; }
