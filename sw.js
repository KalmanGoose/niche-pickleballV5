/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball - Service Worker Cache Reset & Unregister
   ═══════════════════════════════════════════════════════════════════ */
self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => caches.delete(key)));
        }).then(() => {
            return self.registration.unregister();
        }).then(() => {
            return self.clients.claim();
        })
    );
});
