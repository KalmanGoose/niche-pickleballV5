/**
 * NCHU Pickleball - Cloudflare Worker 反向代理
 * 1. GAS_URL 與 SIGN_SECRET 必須設為 Worker 機密，未設定就拒絕服務
 * 2. CORS 來源白名單（精確比對）
 * 3. 盡力而為的 IP 頻率限制
 * 4. act 白名單與請求大小上限
 * 5. 伺服器端 HMAC-SHA256 簽章（證明請求經過本代理；玩家身分由 GAS 以 token 驗證）
 */

const POST_ACTS = new Set(['submit', 'like', 'friendReq', 'friendAccept', 'updateProfile', 'sync_twin']);
const GET_ACTS = new Set(['ping', 'leaderboard', 'me', 'friends']);
const MAX_BODY_CHARS = 16 * 1024;
const WINDOW_MS = 60 * 1000;
const LIMITS = { GET: 40, POST: 15 };

const PROD_ORIGINS = new Set(['https://kalmangoose.github.io']);
function originAllowed(origin) {
    if (!origin) return false;
    if (PROD_ORIGINS.has(origin)) return true;
    try {
        const u = new URL(origin);
        return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    } catch (_) {
        return false;
    }
}

const buckets = new Map();
function rateLimit(key, max) {
    const now = Date.now();
    if (buckets.size > 5000) {
        for (const [k, r] of buckets) if (now > r.reset) buckets.delete(k);
    }
    const r = buckets.get(key);
    if (!r || now > r.reset) {
        buckets.set(key, { n: 1, reset: now + WINDOW_MS });
        return true;
    }
    if (r.n >= max) return false;
    r.n++;
    return true;
}

async function hmacSha256Base64(secret, msg) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
    let bin = '';
    for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
    return btoa(bin);
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = originAllowed(origin);
        if (!allowed) {
            return new Response(JSON.stringify({ ok: false, err: 'FORBIDDEN_ORIGIN' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json;charset=utf-8' }
            });
        }
        const cors = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (!env.GAS_URL || !env.SIGN_SECRET) {
            return json({ ok: false, err: 'PROXY_NOT_CONFIGURED' }, 500, cors);
        }

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!rateLimit(ip + ':' + request.method, LIMITS[request.method] || 10)) {
            return json({ ok: false, err: 'RATE_LIMIT_EXCEEDED' }, 429, cors);
        }

        if (request.method === 'GET') {
            const url = new URL(request.url);
            const act = url.searchParams.get('act') || 'ping';
            if (!GET_ACTS.has(act)) return json({ ok: false, err: 'UNKNOWN_GET_ACTION' }, 400, cors);
            const fwd = new URL(env.GAS_URL);
            fwd.searchParams.set('act', act);
            const pid = url.searchParams.get('pid');
            if (pid) fwd.searchParams.set('pid', pid.slice(0, 64));
            try {
                const res = await fetch(fwd.toString(), { headers: { 'Accept': 'application/json' } });
                return new Response(await res.text(), {
                    status: res.status,
                    headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
                });
            } catch (_) {
                return json({ ok: false, err: 'PROXY_UPSTREAM_ERROR' }, 502, cors);
            }
        }

        if (request.method === 'POST') {
            const raw = await request.text();
            if (raw.length > MAX_BODY_CHARS) return json({ ok: false, err: 'PAYLOAD_TOO_LARGE' }, 413, cors);
            let payload;
            try { payload = JSON.parse(raw); } catch (_) {
                return json({ ok: false, err: 'INVALID_JSON' }, 400, cors);
            }
            if (!payload || typeof payload !== 'object' || !POST_ACTS.has(payload.act)) {
                return json({ ok: false, err: 'UNKNOWN_POST_ACTION' }, 400, cors);
            }
            const dataStr = JSON.stringify(payload);
            const ts = Date.now();
            const nonce = crypto.randomUUID();
            const sig = await hmacSha256Base64(env.SIGN_SECRET, dataStr + '|' + ts + '|' + nonce);
            try {
                const res = await fetch(env.GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ data: dataStr, ts, nonce, sig })
                });
                return new Response(await res.text(), {
                    status: res.status,
                    headers: { ...cors, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
                });
            } catch (_) {
                return json({ ok: false, err: 'PROXY_POST_FAIL' }, 502, cors);
            }
        }

        return json({ ok: false, err: 'METHOD_NOT_ALLOWED' }, 405, cors);
    }
};
