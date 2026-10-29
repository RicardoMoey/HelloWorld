/* Service worker dos Jogos de Família — offline como app.
   HTML/JS/CSS: rede primeiro (atualizações chegam logo), cache como recurso offline.
   Imagens: cache primeiro. Só as navegações caem no index.html quando tudo falha. */
const CACHE = 'jogos-familia-v4';
const ASSETS = [
  './', './index.html', './reviravolta.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png',
  './command-2026/index.html', './command-2026/css/style.css',
  ...['core', 'data', 'map', 'spatial', 'path', 'entities', 'units', 'combat', 'fog', 'ai', 'audio', 'sprites', 'render', 'input', 'ui', 'game'].map((f) => './command-2026/js/' + f + '.js'),
];
// OVNI: a lista de ficheiros vem do próprio ovni-1999/index.html (fonte única da ordem de carregamento)
function ovniAssets() {
  return fetch('./ovni-1999/index.html').then((r) => r.text()).then((html) => {
    const out = ['./ovni-1999/', './ovni-1999/index.html'];
    const re = /(?:src|href)="((?:js|css)\/[^"?#]+)"/g;
    let m;
    while ((m = re.exec(html))) out.push('./ovni-1999/' + m[1]);
    return out;
  });
}
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).then(() => ovniAssets().then((list) => c.addAll(list)).catch(() => null)))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function put(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isCode = req.mode === 'navigate' || /\.(html|js|css|json)$/.test(new URL(req.url).pathname) || new URL(req.url).pathname.endsWith('/');
  if (isCode) {
    e.respondWith(
      fetch(req).then((res) => put(req, res)).catch(() =>
        caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
  } else {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => put(req, res))));
  }
});
