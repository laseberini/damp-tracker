// Keeps the app's own files on the phone so it opens with no signal.
// (Readings and photos live in IndexedDB, not here.)

const CACHE = 'damp-tracker-v1';
const FILES = ['./', './index.html', './app.js', './db.js', './ui.js', './chart.js', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so updates show straight away; fall back to the cache when offline or
// when the network takes more than 3 seconds.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      });
      if (!hit) return net;
      return Promise.race([net.catch(() => hit), new Promise((r) => setTimeout(() => r(hit), 3000))]);
    }),
  );
});
