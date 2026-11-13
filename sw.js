// Мрежа прво, кеш како резерва — апликацијата се отвора и без интернет.
const CACHE = 'carina-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/words.js', 'js/store.js', 'js/sheet.js', 'js/app.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).hostname.includes('googleapis.com')) return;
    e.respondWith(
        fetch(req).then(res => {
            if (res.ok && (new URL(req.url).origin === location.origin || req.url.includes('cdnjs.cloudflare.com') || req.url.includes('gstatic.com'))) {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
        }).catch(() => caches.match(req))
    );
});
