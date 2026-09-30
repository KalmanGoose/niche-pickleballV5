/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball N-GO - PWA 離線快取服務工作者 (Service Worker)
   Version: v5.9.1
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'nchu-pickleball-v5.9.1';

const PRECACHE_ASSETS = [
    './',
    './index.html',
    './v14.html',
    './v14-single.html',
    './manifest.json',
    './css/style.css',
    './css/hud.css',
    './css/modals.css',
    './images/nchu_map_2.5d.jpg',
    './images/pickleball_lab_logo.jpg',
    './images/pickleball_action.jpg',
    './js/config.js',
    './js/audio.js',
    './js/physics.js',
    './js/referee.js',
    './js/motion.js',
    './js/hub_sandbox.js',
    './js/profile_card.js',
    './js/ui.js',
    './js/social.js',
    './js/fly_connectome.js',
    './js/pickle_neural_policy.js',
    './js/fun_mode.js',
    './js/game.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(PRECACHE_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // CDN 資源與外部腳本 (MediaPipe, Three.js, Fonts)：採用 Stale-While-Revalidate
    if (req.url.includes('cdn.jsdelivr.net') || req.url.includes('cdnjs.cloudflare.com') || req.url.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(req).then(cached => {
                    const fetchPromise = fetch(req).then(networkRes => {
                        if (networkRes && networkRes.status === 200) {
                            cache.put(req, networkRes.clone());
                        }
                        return networkRes;
                    }).catch(() => cached);
                    return cached || fetchPromise;
                });
            })
        );
        return;
    }

    // 本地資源：Cache First, Network Fallback
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(networkRes => {
                if (networkRes && networkRes.status === 200 && req.url.startsWith(self.location.origin)) {
                    const copy = networkRes.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                }
                return networkRes;
            });
        }).catch(() => {
            if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
                return caches.match('./index.html');
            }
        })
    );
});
