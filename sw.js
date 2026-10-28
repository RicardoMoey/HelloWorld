/* Service worker dos Jogos de Família — cache para funcionar offline como app */
const CACHE = 'jogos-familia-v2';
const ASSETS = [
  './', './index.html', './reviravolta.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png',
  './command-2026/index.html', './command-2026/css/style.css',
  ...['core', 'data', 'map', 'spatial', 'path', 'entities', 'units', 'combat', 'fog', 'ai', 'audio', 'sprites', 'render', 'input', 'ui', 'game'].map((f) => './command-2026/js/' + f + '.js'),
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
