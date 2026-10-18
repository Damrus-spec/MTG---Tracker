// MTG Tracker service worker: lets the app open with no signal.
// - Page (navigations, index.html): network-first, cached copy when offline,
//   so deploys still arrive immediately and checkForUpdate keeps working.
// - Other local files (manifest, icons, privacy): network-first too.
// - Pinned CDN libraries: cache-first (they never change under the same URL;
//   bump CACHE to drop old copies).
// - Google APIs, Scryfall API, sign-in: never cached — always live.
const CACHE = 'mtg-shell-v1';
const TABLER = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/';
const PRECACHE = [
  './', 'index.html', 'manifest.json', 'privacy.html',
  'icon-192.png', 'icon-512.png', 'icon.svg',
  TABLER + 'tabler-icons.min.css',
  TABLER + 'fonts/tabler-icons.woff2?v2.47.0',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    // CORS requests so the cached copies satisfy the page's SRI checks
    Promise.all(PRECACHE.map(u => c.add(new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' }))))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req, cacheKey) {
  return fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(cacheKey, copy)); }
    return res;
  }).catch(() => caches.match(cacheKey, { ignoreSearch: true }).then(hit => hit || Response.error()));
}

function isPage(req, url) {
  return req.mode === 'navigate' || (url.origin === location.origin && url.pathname.endsWith('/index.html'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isPage(req, url)) {
    e.respondWith(networkFirst(req, 'index.html'));
    return;
  }
  if (url.origin === location.origin) {
    // Small local files (manifest, icons, privacy page): fresh when online, cached when not
    if (!url.pathname.endsWith('/sw.js')) e.respondWith(networkFirst(req, req));
    return;
  }
  if (!url.href.startsWith('https://cdn.jsdelivr.net/npm/')) return; // APIs, Google sign-in, Scryfall images: browser default

  // Pinned CDN versions never change under the same URL: cache-first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
