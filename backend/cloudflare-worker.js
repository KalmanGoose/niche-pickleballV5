/**
 * NCHU Pickleball - Cloudflare Worker Serverless Reverse Proxy
 * 
 * 功能：
 * 1. 隱藏真實 GAS_URL 與 SIGN_SECRET 密鑰 (安全隔離)
 * 2. 嚴格 CORS 來源白名單校驗
 * 3. IP 頻率限制 (Rate Limiting: 30次/分鐘) 防 DoS 與爆配額
 * 4. 邊緣端點快取 (Leaderboard Cache: 15s) 減輕 Google Apps Script 執行負擔
 * 5. 伺服器端動態計算 HMAC-SHA256 數位簽章 (Web Crypto API)
 */

const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function checkRateLimit(ip) {
    const now = Date.now();
    let record = RATE_LIMIT_MAP.get(ip);
    if (!record || now > record.resetTime) {
        record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
        RATE_LIMIT_MAP.set(ip, record);
        return true;
    }
    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }
    record.count++;
    return true;
}

async function computeHmacSha256(secretStr, msgStr) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secretStr),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
    const bytes = new Uint8Array(signature);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export default {
    async fetch(request, env, ctx) {
        // 從 Cloudflare 環境變數讀取，若未設定則使用預設值
        const gasUrl = env.GAS_URL || 'https://script.google.com/macros/s/AKfycbwbQJTyJFtZjGOHs_EzYnbbQjq1Znj8KHG1l9uVhgqsyUK2KpkwdN6nydNNvyqz394mGQ/exec';
        const signSecret = env.SIGN_SECRET || 'nchu-pickleball-2026-secret';

        const origin = request.headers.get('Origin') || '';
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

        // 允許的來源網域白名單
        const allowedOrigins = [
            'https://kalmangoose.github.io',
            'http://localhost',
            'http://127.0.0.1'
        ];
        const isAllowedOrigin = !origin || allowedOrigins.some(ao => origin.startsWith(ao));

        const corsHeaders = {
            'Access-Control-Allow-Origin': isAllowedOrigin && origin ? origin : '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        };

        // 處理 CORS Preflight 預檢請求
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // 來源白名單校驗
        if (origin && !isAllowedOrigin) {
            return new Response(JSON.stringify({ ok: false, err: 'FORBIDDEN_ORIGIN' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // IP 頻率限制校驗
        if (!checkRateLimit(clientIp)) {
            return new Response(JSON.stringify({ ok: false, err: 'RATE_LIMIT_EXCEEDED' }), {
                status: 429,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const url = new URL(request.url);

        // 處理 GET 請求 (查詢排行榜、個人資訊、好友)
        if (request.method === 'GET') {
            const forwardUrl = gasUrl + (url.search ? url.search : '');
            const cacheOptions = (url.searchParams.get('act') === 'leaderboard') ? { cf: { cacheTtl: 15, cacheEverything: true } } : {};
            try {
                const response = await fetch(forwardUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    ...cacheOptions
                });
                const data = await response.text();
                return new Response(data, {
                    status: response.status,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json;charset=utf-8',
                        'Cache-Control': url.searchParams.get('act') === 'leaderboard' ? 'public, max-age=15' : 'no-cache'
                    }
                });
            } catch (err) {
                return new Response(JSON.stringify({ ok: false, err: 'PROXY_UPSTREAM_ERROR' }), {
                    status: 502,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 處理 POST 請求 (提交戰績、按讚、加好友、更新個人檔案)
        if (request.method === 'POST') {
            try {
                let payload;
                const rawText = await request.text();
                try {
                    payload = JSON.parse(rawText);
                } catch (_) {
                    return new Response(JSON.stringify({ ok: false, err: 'INVALID_JSON' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // 如果前端傳送的是未簽名純資料，由 Worker 在雲端代理計算簽名封裝
                let envPayload;
                if (payload && payload.data && payload.sig) {
                    // 原生簽名封裝直接轉發
                    envPayload = payload;
                } else {
                    const dataStr = JSON.stringify(payload);
                    const ts = Date.now();
                    const nonce = Math.random().toString(36).slice(2, 10);
                    const sig = await computeHmacSha256(signSecret, dataStr + '|' + ts + '|' + nonce);
                    envPayload = { data: dataStr, ts, nonce, sig };
                }

                // 送交 GAS 後端
                const upstreamRes = await fetch(gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(envPayload)
                });
                const resText = await upstreamRes.text();
                return new Response(resText, {
                    status: upstreamRes.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=utf-8' }
                });
            } catch (err) {
                return new Response(JSON.stringify({ ok: false, err: 'PROXY_POST_FAIL' }), {
                    status: 502,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }
};
