const CACHE_NAME = 'club-v98';
const NEVER_CACHE = ['app.js', 'index.html'];
const ASSETS = ['./style.css', './user.html', './register.html', './guest.html', './jsQR.js', './qrcode.min.js', './manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    const noCache = NEVER_CACHE.some(f => url.pathname.endsWith(f));
    if (noCache) {
        e.respondWith(fetch(e.request));
        return;
    }
    e.respondWith(
        fetch(e.request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
