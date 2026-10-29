/* QA visual e de desempenho do globo do Geoscape (OV.GlobeRender) num Chromium real (Playwright).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre, abre qa/globe_check.html em vários cenários
   (dia sobre a Europa, noite sobre a Ásia, crepúsculo, nível de cidade, colocar base válida/inválida, alvo, muitos
   objetos, polos, Pacífico), grava capturas (também de fotogramas em movimento, a meia resolução), verifica a API no
   navegador (pick∘project, objectAt, countryAt, animações), verifica que a imagem parada depois de um movimento é igual
   píxel a píxel à de uma abertura direta na mesma câmara, e mede o desempenho a rodar o globo (1440×900 @2×: tempo do
   draw(), CPU do fio principal por fotograma e fps). Falha em erros de consola/página vindos do globo.
   Uso: node ovni-1999/qa/globe_check.mjs [--out <pasta>] [--only <texto>] [--frames 240] [--no-perf] */
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'globe')
  : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'globe') : path.join(process.cwd(), 'qa-out', 'globe');
const OUT = path.resolve(arg('out', DEF_OUT));
const ONLY = arg('only', null);
const FRAMES = +arg('frames', 240);
const PERF = !argv.includes('--no-perf');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ['01_europe_day.png', 'scene=europe'],
  ['02_asia_night.png', 'scene=night'],
  ['03_city_zoom.png', 'scene=city'],
  ['04_place_valid.png', 'scene=place'],
  ['05_place_invalid.png', 'scene=placeBad'],
  ['06_many_objects.png', 'scene=many'],
  ['07_target_mode.png', 'scene=target'],
  ['08_dusk_atlantic.png', 'scene=dusk'],
  ['09_south_pole.png', 'scene=pole'],
  ['10_pacific.png', 'scene=pacific'],
  ['11_arctic.png', 'scene=arctic&t=0'],
  ['12_europe_z5.png', 'scene=europe&zoom=5&lon=4&lat=46.5'],
  ['13_europe_z2.png', 'scene=europe&zoom=2&lon=8&lat=46'],
];

const fails = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* a arrancar */ }
    await sleep(120);
  }
  return false;
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/qa/globe_check.html`;
let browser = null;
try {
  if (!(await waitHttp(`http://127.0.0.1:${port}/ovni-1999/index.html`, 8000))) throw new Error('servidor não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message));

  const open = async (query) => {
    await page.goto(BASE + '?' + query + '&static=1&time=1000');
    await page.waitForFunction(() => window.QA && window.QA.ready && window.QA.stats.frames > 2, null, { timeout: 30000 });
    await page.waitForTimeout(400); // refinamento da camada base após a 1.ª imagem
  };
  const pageErrors = async () => page.evaluate(() => window.QA_ERRORS.slice());

  for (const [file, query] of SHOTS) {
    if (ONLY && !file.includes(ONLY) && !query.includes(ONLY)) continue;
    await open(query);
    await page.screenshot({ path: path.join(OUT, file) });
    const errs = await pageErrors();
    const mine = errs.filter((e) => /globe/.test(e.file) || /draw:/.test(e.msg));
    check(!mine.length, file + ': erros do globo ' + JSON.stringify(mine));
    if (errs.length - mine.length) console.log('aviso (' + file + '): erros noutros ficheiros: ' + errs.filter((e) => !mine.includes(e)).map((e) => path.basename(e.file) + ' ' + e.msg).join(' | '));
    console.log('captura ' + file);
  }

  // fotogramas em movimento (caminho grosseiro a meia resolução): deriva lenta (≈2 px no total) e captura
  for (const [file, query] of [['14_europe_moving.png', 'scene=europe'], ['15_asia_night_moving.png', 'scene=night'], ['16_city_moving.png', 'scene=city']]) {
    if (ONLY && !file.includes(ONLY) && !query.includes(ONLY)) continue;
    await open(query);
    await page.evaluate(() => { const { OV, view } = window.QA; window.__osc = setInterval(() => OV.GlobeRender.rotateBy(view, 0.05, 0), 8); });
    await page.waitForTimeout(300);
    const busy = await page.evaluate(() => window.QA.OV.GlobeRender.busy(window.QA.view));
    await page.screenshot({ path: path.join(OUT, file) });
    await page.evaluate(() => clearInterval(window.__osc));
    check(busy, file + ': em movimento o globo fica por refinar (busy)');
    console.log('captura ' + file);
  }

  // a imagem parada depois de um movimento é a mesma de uma abertura direta (o caminho grosseiro não deixa rasto)
  if (!ONLY) {
    const canvasHash = () => page.evaluate(() => {
      const c = document.getElementById('view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0x811c9dc5;
      for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)), 0x01000193);
      return (h >>> 0).toString(16);
    });
    await open('scene=europe&lon=20&lat=30&zoom=1.5');
    const direct = await canvasHash();
    await open('scene=europe&lon=-60&lat=10&zoom=1');
    await page.evaluate(() => { const { OV, view } = window.QA; window.QA.unfreeze(); OV.GlobeRender.rotateTo(view, 20, 30, 500, 1.5); });
    await page.waitForFunction(() => { const { OV, view } = window.QA; return view.lon === 20 && view.lat === 30 && !OV.GlobeRender.busy(view); }, null, { timeout: 20000 });
    await page.evaluate(() => window.QA.freeze(1000));
    await page.waitForTimeout(300);
    const after = await canvasHash();
    check(direct === after, 'imagem parada após rotateTo igual à abertura direta (' + direct + ' vs ' + after + ')');
  }

  // API no navegador
  await open('scene=europe');
  const api = await page.evaluate(() => {
    const { OV, G, view } = window.QA;
    const GR = OV.GlobeRender;
    const out = { round: 0, roundMax: 0, hits: {}, misc: {} };
    for (let i = 0; i < 400; i++) {
      const lon = -180 + ((i * 137.5) % 360), lat = -80 + ((i * 61.3) % 160);
      const p = GR.project(view, lon, lat);
      if (!p.front) continue;
      const q = GR.pick(view, p.x, p.y);
      if (!q) continue;
      const d = OV.GMath.distNmLL(lon, lat, q.lon, q.lat);
      out.round++;
      out.roundMax = Math.max(out.roundMax, d);
    }
    for (const u of G.ufos) {
      const p = GR.screenPos(G, view, { kind: 'ufo', id: u.id });
      const o = p && p.front ? GR.objectAt(G, view, p.x + 2, p.y + 1) : null;
      out.hits[u.id] = o ? o.kind + ':' + o.id : null;
    }
    const b = G.bases[0], pb = GR.project(view, b.lon, b.lat);
    out.misc.base = GR.objectAt(G, view, pb.x, pb.y);
    out.misc.empty = GR.objectAt(G, view, 5, 5);
    out.misc.space = GR.pick(view, 2, 2);
    const pf = GR.project(view, 2.5, 46.5);
    out.misc.france = GR.countryAt(view, pf.x, pf.y);
    // animação: rotateTo chega ao alvo exato
    const v2 = Object.assign({}, view, { time: 0 });
    GR.rotateTo(v2, 120, 30, 500, 2);
    GR.update(v2, 250);
    out.misc.mid = { lon: v2.lon, lat: v2.lat, zoom: v2.zoom, busy: GR.busy(v2) };
    GR.update(v2, 600);
    out.misc.end = { lon: v2.lon, lat: v2.lat, zoom: v2.zoom, active: GR.update(v2, 700) };
    // zoomAt mantém o ponto sob o cursor
    const v3 = Object.assign({}, view);
    const a = GR.pick(v3, 900, 300);
    GR.zoomAt(v3, 3, 900, 300);
    const b3 = GR.pick(v3, 900, 300);
    out.misc.zoomAnchor = OV.GMath.distNmLL(a.lon, a.lat, b3.lon, b3.lat);
    return out;
  });
  check(api.round > 100 && api.roundMax < 0.01, 'pick∘project: ' + api.round + ' pontos, erro máx ' + api.roundMax + ' mn');
  for (const [id, hit] of Object.entries(api.hits)) check(hit === null || hit === 'ufo:' + id || hit.startsWith('ufo:') || hit.startsWith('craft:'), 'objectAt OVNI ' + id + ' → ' + hit);
  check(Object.values(api.hits).filter((h) => h && h.startsWith('ufo:')).length >= 3, 'objectAt acerta nos OVNIs: ' + JSON.stringify(api.hits));
  check(api.misc.base && api.misc.base.kind === 'base', 'objectAt base: ' + JSON.stringify(api.misc.base));
  check(api.misc.empty === null && api.misc.space === null, 'canto vazio sem objeto nem ponto');
  check(api.misc.france === 'france', 'countryAt França: ' + api.misc.france);
  check(api.misc.mid.busy && Math.abs(api.misc.end.lon - 120) < 1e-6 && Math.abs(api.misc.end.lat - 30) < 1e-6 && api.misc.end.zoom === 2 && !api.misc.end.active,
    'rotateTo: ' + JSON.stringify(api.misc));
  check(api.misc.zoomAnchor < 5, 'zoomAt ancorado: ' + api.misc.zoomAnchor.toFixed(2) + ' mn');
  console.log('API: ' + JSON.stringify({ round: api.round, roundMax: api.roundMax, misc: api.misc }));

  // interação real: arrastar roda, clique seleciona
  await page.goto(BASE + '?scene=europe');
  await page.waitForFunction(() => window.QA && window.QA.ready && window.QA.stats.frames > 2, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({ lon: window.QA.view.lon, lat: window.QA.view.lat }));
  await page.mouse.move(700, 450);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(700 - i * 20, 450 + i * 6);
  await page.mouse.up();
  const after = await page.evaluate(() => ({ lon: window.QA.view.lon, lat: window.QA.view.lat }));
  check(after.lon > before.lon + 5 && after.lat > before.lat, 'arrastar para a esquerda roda para este: ' + JSON.stringify([before, after]));

  if (PERF) {
    // desempenho: rodar continuamente (fotograma grosseiro em cada passo) e parado com o tempo a correr.
    // «draw» é o tempo de parede de GlobeRender.draw (inclui o raster síncrono do canvas reduzido neste Chromium sem
    // GPU); «CPU» é o tempo de CPU do fio principal por fotograma (JS + raster + composição), via CDP.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    for (const [name, query, rotate] of [['rodar', 'scene=europe', true], ['rodar_noite', 'scene=night', true], ['tempo_a_correr', 'scene=many', false], ['so_dinamica', 'scene=many', 'idle'], ['rodar_z3', 'scene=city', true]]) {
      await page.goto(BASE + '?' + query);
      await page.waitForFunction(() => window.QA && window.QA.ready && window.QA.stats.frames > 2, null, { timeout: 30000 });
      await page.waitForTimeout(500);
      const m0 = await metrics();
      const r = await page.evaluate(({ n, rotate }) => new Promise((res) => {
        const { OV, G, view, stats } = window.QA;
        stats.ms.length = 0;
        let k = 0;
        const t0 = performance.now();
        const step = () => {
          if (rotate === true) OV.GlobeRender.rotateBy(view, 3, 0.4);
          else if (!rotate) G.t += 60;
          if (++k < n) requestAnimationFrame(step);
          else {
            const dt = performance.now() - t0;
            const ms = stats.ms.slice().sort((a, b) => a - b);
            res({ fps: (n / dt) * 1000, med: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1] });
          }
        };
        requestAnimationFrame(step);
      }), { n: FRAMES, rotate });
      const m1 = await metrics();
      const cpu = ((m1.ThreadTime - m0.ThreadTime) * 1000) / FRAMES;
      console.log(`desempenho ${name}: ${r.fps.toFixed(1)} fps, draw mediana ${r.med.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, máx ${r.max.toFixed(1)} ms, CPU do fio principal ${cpu.toFixed(1)} ms/fotograma (Chromium sem GPU neste contentor)`);
    }
  }

  const real = consoleErrs.filter((e) => !/favicon/.test(e));
  check(!real.filter((e) => /globe/i.test(e)).length, 'erros de consola do globo: ' + real.join(' | '));
  if (real.length) console.log('consola: ' + real.join(' | '));
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(`${checks - fails.length}/${checks} verificações; capturas em ${OUT}`);
if (fails.length) {
  for (const f of fails) console.log('✗ ' + f);
  process.exit(1);
}
