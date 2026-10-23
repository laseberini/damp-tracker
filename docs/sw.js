// Keeps the app's own files on the phone so it opens with no signal.
// (Readings and photos live in IndexedDB, not here.)

const CACHE = 'damp-tracker-v2';
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

// Network first, bypassing the browser's HTTP cache (GitHub Pages lets it keep files for
// 10 minutes), so a new version shows straight away. Falls back to our cache when offline
// or when the network takes more than 3 seconds.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.searchParams.has('check')) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
      const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
        if (res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      });
      if (!hit) return net;
      return Promise.race([net.catch(() => hit), new Promise((r) => setTimeout(() => r(hit), 3000))]);
    }),
  );
});
