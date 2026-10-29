/* Verificação do núcleo da campanha num Chromium real (Playwright): o jogo arranca sem erros de consola/página nas três
   resoluções de referência, e OV.Campaign.newCampaign / OV.Clock / OV.GMath dão no navegador exatamente os mesmos
   resultados que em Node (hash do estado inicial por semente, fronteiras do relógio, distâncias e fase do dia).
   Uso: node ovni-1999/qa/campaign_core_check.mjs [--out <pasta>] [--port <n>]
   Capturas fora do repositório (pasta de sessão, OVNI_QA_OUT ou ./qa-out). Código de saída ≠ 0 em qualquer falha. */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'campaign-core')
  : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'campaign-core') : path.join(process.cwd(), 'qa-out', 'campaign-core');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
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
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* ainda a arrancar */ }
    await sleep(120);
  }
  return false;
}

// a mesma sonda corre em Node e no navegador (OV global já carregado e finalizado)
function probe(OV) {
  const out = { hashes: {}, funds: {}, clock: [], gmath: {} };
  for (const seed of [1, 42, 2024, 777777]) {
    const G = OV.Campaign.newCampaign({ seed, difficulty: seed % 3, baseLonLat: { lon: -9.14, lat: 38.72 } });
    out.hashes[seed] = OV.Campaign.hash(G);
    out.funds[seed] = G.countries.map((c) => c.funding).join(',');
  }
  const G = { t: 0 };
  for (let k = 0; k < 3000; k++) out.clock.push(OV.Clock.advance(G, 97));
  out.clock = out.clock.join('');
  const M = OV.GMath;
  const LIS = { lon: -9.14, lat: 38.72 }, NY = { lon: -74, lat: 40.71 };
  out.gmath.dist = M.distNm(LIS, NY).toFixed(6);
  out.gmath.bearing = M.bearing(LIS, NY).toFixed(6);
  let p = LIS, n = 0;
  while (!(p = M.stepToward(p, NY, 2100, 5)).arrived) n++;
  out.gmath.ticks = n;
  const ip = M.interceptPoint({ lon: 0, lat: 10 }, 2100, { lon: -20, lat: 0 }, { lon: 40, lat: 0 }, 1000);
  out.gmath.intercept = [ip.lon.toFixed(5), ip.lat.toFixed(5), ip.hours.toFixed(6)].join(',');
  out.gmath.phase = [0, 6, 12, 18].map((h) => M.dayPhase({ t: h * 3600 }, LIS.lon, LIS.lat)).join(',');
  return out;
}

const NodeOV = require(path.join(REPO, 'ovni-1999', 'tools', 'load.js'))({ finalize: true });
const expected = probe(NodeOV);

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html`;

let browser = null;
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 700]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(w + 'px pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(w + 'px console.error: ' + m.text()); });
    await page.goto(BASE + '?nosw=1&debug=1');
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Campaign && OV.Campaign.newCampaign, null, { timeout: 15000 });
    await sleep(700);
    const got = await page.evaluate(`(${probe.toString()})(OV)`);
    check(JSON.stringify(got.hashes) === JSON.stringify(expected.hashes), w + 'px: hash de newCampaign difere de Node ' + JSON.stringify(got.hashes) + ' vs ' + JSON.stringify(expected.hashes));
    check(JSON.stringify(got.funds) === JSON.stringify(expected.funds), w + 'px: financiamento difere de Node');
    check(got.clock === expected.clock, w + 'px: máscaras do relógio diferem de Node');
    check(JSON.stringify(got.gmath) === JSON.stringify(expected.gmath), w + 'px: GMath difere de Node ' + JSON.stringify(got.gmath) + ' vs ' + JSON.stringify(expected.gmath));
    const missing = await page.evaluate(() => (document.body.innerText.match(/⟦[^⟧]*⟧/g) || []).join(', '));
    check(!missing, w + 'px: chaves i18n em falta ' + missing);
    await page.screenshot({ path: path.join(OUT, 'menu-' + w + 'x' + h + '.png') });
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

for (const e of errors) fails.push(e);
console.log('node:', JSON.stringify(expected.hashes), expected.gmath);
for (const f of fails) console.log('✗ ' + f);
console.log((fails.length ? '✗' : '✓') + ' campaign_core_check: ' + (checks - fails.length + errors.length) + '/' + checks + ' verificações; capturas em ' + OUT);
process.exit(fails.length ? 1 : 0);
