// Service worker: caches the app shell so the game loads offline after the first visit.
// Songs live in IndexedDB and never go through the network, so they work offline already.
const CACHE = 'fretline-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['./', './index.html']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the page (so updates arrive), cache first for hashed build assets.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isAsset = /\/assets\//.test(req.url);
  event.respondWith(
    isAsset
      ? caches.match(req).then((hit) => hit || fetchAndCache(req))
      : fetchAndCache(req).catch(() =>
          caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')),
        ),
  );
});

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}
