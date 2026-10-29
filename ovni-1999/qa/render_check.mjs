/* QA visual e de desempenho do renderizador do Battlescape num Chromium real (Playwright).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre, abre qa/render_check.html em vários
   cenários (dia/noite com very-light, zoom 1 e 2, níveis cortados, FARM/URBAN/DESERT/ALIENBASE/MARS, cada tipo de
   OVNI, folhas de tiles, efeitos), grava capturas e falha em erros de consola/página. No fim mede o pan de
   300 fotogramas num mapa 50×50×3 a 1280×800 @2× e imprime fps e tempos de desenho.
   --hull-context: serve o battle_render.js com a integração de OV.TileSprites.floorState/objectState (chãos recortados
   junto aos cascos diagonais, cúpula do elevador, diagonais a encher a metade interior); sem efeito se o
   renderizador já a fizer.
   Uso: node ovni-1999/qa/render_check.mjs [--out <pasta>] [--only <texto>] [--no-perf] [--frames 300] [--hull-context] */
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // /home/user/HelloWorld
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'render') : path.join(process.cwd(), 'qa-out', 'render'));
const OUT = path.resolve(arg('out', DEF_OUT));
const ONLY = arg('only', null);
const FRAMES = +arg('frames', 300);
const PERF = !argv.includes('--no-perf');
const HULL_CONTEXT = argv.includes('--hull-context');
// [original, integração] no battle_render.js
const CONTEXT_PATCH = [
  ['tileSpr(st, S, f, st.variant[i], 0)', 'tileSpr(st, S, f, st.variant[i], OV.TileSprites.floorState ? OV.TileSprites.floorState(m, x, y, z) : 0)'],
  ['} else if (TS.frames(obj) > 1) state = animState(obj, st, i, F.time);',
    '} else if (TS.frames(obj) > 1) state = animState(obj, st, i, F.time);\n            else if (od.diagonal && TS.objectState) state = TS.objectState(m, x, y, z);'],
];

// [ficheiro, query]
const SHOTS = [
  ['farm_day_z1.png', 'ufo=abductor&terrain=FARM&night=0&zoom=1'],
  ['farm_day_z2.png', 'ufo=abductor&terrain=FARM&night=0&zoom=2&focus=craft'],
  ['farm_night_flare.png', 'ufo=abductor&terrain=FARM&night=1&zoom=1&focus=mid'],
  ['farm_night_z2.png', 'ufo=abductor&terrain=FARM&night=1&zoom=2&focus=craft'],
  ['farm_ufo_level1.png', 'ufo=abductor&terrain=FARM&zoom=2&viewZ=1&overlays=0'],
  ['farm_ufo_level2.png', 'ufo=abductor&terrain=FARM&zoom=1&viewZ=2&overlays=0'],
  ['farm_fog.png', 'ufo=abductor&terrain=FARM&zoom=1&fog=1&reveal=1'],
  ['urban_terror.png', 'kind=terror&terrain=URBAN&zoom=1&focus=craft'],
  ['urban_terror_z1.png', 'kind=terror&terrain=URBAN&zoom=1&viewZ=1&focus=centre&overlays=0'],
  ['desert.png', 'ufo=medium_scout&terrain=DESERT&zoom=1'],
  ['forest.png', 'ufo=small_scout&terrain=FOREST&zoom=1&focus=mid'],
  ['jungle.png', 'ufo=harvester&terrain=JUNGLE&zoom=1'],
  ['polar.png', 'ufo=large_scout&terrain=POLAR&zoom=1'],
  ['mountain.png', 'ufo=supply_ship&terrain=MOUNTAIN&zoom=1'],
  ['alienbase.png', 'kind=alienBase&zoom=1&focus=craft'],
  ['alienbase_z2.png', 'kind=alienBase&zoom=2&focus=centre&overlays=0'],
  ['mars.png', 'kind=cydonia&zoom=1&focus=centre&overlays=0'],
  ['mars_z1.png', 'kind=cydonia&zoom=1&focus=centre&viewZ=1&overlays=0'],
  ['fx.png', 'mode=fx&ufo=abductor&terrain=FARM&zoom=1&focus=mid&overlays=0'],
];
// cada OVNI: despenhado e pousado, de dia e de noite, por fora (nível de cima, com tejadilho) e por dentro (corte em z0)
for (const u of ['small_scout', 'medium_scout', 'large_scout', 'harvester', 'abductor', 'supply_ship', 'terror_ship', 'battleship']) {
  SHOTS.push(['ufo_' + u + '.png', 'ufo=' + u + '&terrain=FARM&zoom=1&overlays=0&seed=7']);
  SHOTS.push(['ufo_' + u + '_top.png', 'ufo=' + u + '&terrain=FARM&zoom=1&overlays=0&seed=7&kind=landed&viewZ=top']);
  SHOTS.push(['ufo_' + u + '_inside.png', 'ufo=' + u + '&terrain=FARM&zoom=2&overlays=0&seed=7&kind=landed']);
  SHOTS.push(['ufo_' + u + '_night.png', 'ufo=' + u + '&terrain=DESERT&zoom=2&overlays=0&seed=7&night=1&flare=0&fire=0']);
}
// naves X-COM (porão por dentro e fuselagem por fora)
for (const c of ['skyranger', 'avenger']) {
  SHOTS.push(['craft_' + c + '.png', 'ufo=small_scout&terrain=FARM&zoom=2&overlays=0&seed=7&focus=craft&craft=' + c]);
  SHOTS.push(['craft_' + c + '_top.png', 'ufo=small_scout&terrain=FARM&zoom=2&overlays=0&seed=7&focus=craft&viewZ=top&craft=' + c]);
}
SHOTS.push(['ufo_urban_crash.png', 'ufo=medium_scout&terrain=URBAN&zoom=2&overlays=0&seed=11']);
SHOTS.push(['farm_buildings.png', 'ufo=small_scout&terrain=FARM&zoom=2&overlays=0&seed=3&focus=centre']);
for (const s of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS', 'UFO', 'CRAFT']) {
  SHOTS.push(['tiles_' + s + '.png', 'mode=tiles&set=' + s + '&zoom=1&w=1400&h=1000']);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}
async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, '127.0.0.1', () => { s.end(); res(true); });
      s.on('error', () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

fs.mkdirSync(OUT, { recursive: true });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const errors = [];
let browser;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  if (HULL_CONTEXT) {
    await page.route('**/js/gfx/battle_render.js', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      for (const [a, b] of CONTEXT_PATCH) if (!body.includes(b)) body = body.split(a).join(b);
      await route.fulfill({ response: res, body, headers: Object.assign({}, res.headers(), { 'content-type': 'text/javascript' }) });
    });
  }
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const base = 'http://127.0.0.1:' + port + '/ovni-1999/qa/render_check.html?';
  for (const [file, query] of SHOTS) {
    if (ONLY && !(file + '?' + query).includes(ONLY)) continue;
    const before = errors.length;
    const wq = /w=(\d+)/.exec(query), hq = /h=(\d+)/.exec(query);
    await page.setViewportSize({ width: wq ? +wq[1] : 1280, height: hq ? +hq[1] : 800 });
    await page.goto(base + query);
    await page.waitForFunction(() => window.__ready === true || document.getElementById('err').textContent, null, { timeout: 60000 })
      .catch(() => errors.push(file + ': a página não terminou'));
    const pageErr = await page.evaluate(() => document.getElementById('err').textContent);
    if (pageErr) errors.push(file + ': ' + pageErr.trim());
    const inf = await page.evaluate(() => window.__info || null);
    await page.screenshot({ path: path.join(OUT, file) });
    const extra = inf && inf.drawMs !== undefined ? '  ' + inf.terrain + ' ' + (inf.ufo || '-') + ' ' + inf.size.join('×') + ' unid ' + inf.xcom + '/' + inf.aliens + '/' + inf.civs + ' desenho ' + inf.drawMs + ' ms, criar ' + inf.createMs + ' ms'
      : inf ? '  ' + JSON.stringify(inf) : '';
    console.log((errors.length > before ? '✗ ' : '✓ ') + file + extra);
  }
  if (PERF && !ONLY) {
    // 50×50×3: FARM com OVNI grande (terreno «large»); pan em laço
    for (const [label, query] of [['zoom 1', 'ufo=battleship&terrain=FARM&zoom=1&overlays=0&seed=3'], ['zoom 2', 'ufo=battleship&terrain=FARM&zoom=2&overlays=0&seed=3'],
      ['noite zoom 1', 'ufo=battleship&terrain=FARM&zoom=1&overlays=0&seed=3&night=1']]) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(base + query);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
      const size = await page.evaluate(() => window.__info.size.join('×'));
      const r = await page.evaluate((n) => window.__perf(n), FRAMES);
      console.log('⏱ pan ' + label + ' (' + size + ', 1280×800 @2×): ' + r.fps + ' fps, desenho médio ' + r.avgMs + ' ms, p95 ' + r.p95 + ' ms, máx ' + r.maxMs + ' ms');
    }
  }
} catch (e) {
  errors.push(String(e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const e of errors) console.log('✗ ' + e);
console.log(errors.length ? '✗ ' + errors.length + ' erro(s)' : '✓ sem erros; capturas em ' + OUT);
process.exit(errors.length ? 1 : 0);
