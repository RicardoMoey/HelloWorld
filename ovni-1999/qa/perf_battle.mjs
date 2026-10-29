/* Desempenho do Battlescape no navegador (DESIGN.md §16): Couraçado (mapa 50×50×3) a 1280×800 @2×, pan contínuo
   com o trackpad (roda com deltaX/deltaY, como dois dedos no Mac) a zoom 1 e 2, em três vistas: jogo normal (nível do
   soldado, névoa), mapa todo revelado no nível de cima (pior caso) e de noite. Lê a leitura de desempenho do modo de
   depuração (OV.BattleUI.debug.perf(): fps e tempo de desenho em JS) e mede também o intervalo entre fotogramas.
   Alvo: desenho < 8 ms (médio) nas vistas de jogo — falha acima disso. Sem GPU (rasterização por software, como neste
   contentor) o Chromium rasteriza dentro de draw() e o fps não representa um Mac: o fps e o pior caso (mapa todo
   revelado, três níveis) são registados e só avisam.
   Uso: node ovni-1999/qa/perf_battle.mjs [--frames 240] [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'perf') : path.join(process.cwd(), 'qa-out', 'perf'));
const OUT = path.resolve(arg('out', DEF_OUT));
const FRAMES = +arg('frames', 240);
const DRAW_MS_MAX = 8;

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
const errors = [], fails = [], warns = [];
let browser, page;

// pan em círculo à volta do ponto de partida com eventos de roda reais no canvas (trackpad: deltaX e deltaY)
async function panRun(frames) {
  return page.evaluate((n) => new Promise((res) => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    const at = [];
    let k = 0;
    function f(t) {
      at.push(t);
      k++;
      const a = (k / n) * Math.PI * 2;
      c.dispatchEvent(new WheelEvent('wheel', { deltaX: -Math.sin(a) * 16, deltaY: Math.cos(a) * 10, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      if (k < n) requestAnimationFrame(f);
      else {
        const dts = at.slice(1).map((v, i) => v - at[i]).sort((x, y) => x - y);
        res({ fps: +((dts.length * 1000) / (at[at.length - 1] - at[0])).toFixed(1), p95frame: +dts[Math.floor(dts.length * 0.95)].toFixed(1), perf: OV.BattleUI.debug.perf() });
      }
    }
    requestAnimationFrame(f);
  }), frames);
}
async function measure(label, worst) {
  await panRun(60); // aquecimento: sprites e regiões desta vista
  const r = await panRun(FRAMES);
  const p = r.perf || {};
  const line = '⏱ ' + label.padEnd(30) + ' ' + String(r.fps).padStart(5) + ' fps (p95 fotograma ' + r.p95frame + ' ms) · desenho ' + p.avg + ' ms (p95 ' + p.p95 + ') · ' + p.chunks + ' regiões · ' + p.sprites + ' sprites';
  console.log(line);
  if (!(p.avg < DRAW_MS_MAX)) {
    // pior caso (tudo revelado, todos os níveis): sem GPU o Chromium rasteriza dentro de draw(); só avisa
    if (worst) warns.push(label + ': desenho médio ' + p.avg + ' ms (pior caso, rasterização por software)');
    else fails.push(label + ': desenho médio ' + p.avg + ' ms ≥ ' + DRAW_MS_MAX);
  }
  if (r.fps < 50) warns.push(label + ': ' + r.fps + ' fps (rasterização por software neste navegador)');
  const f = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.png';
  await page.screenshot({ path: path.join(OUT, f) });
  return r;
}
async function open(query) {
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state() && !OV.BattleUI.debug.state().playing, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => OV.Game.B.map.w + '×' + OV.Game.B.map.h + '×' + OV.Game.B.map.d);
  console.log('mapa ' + m + ' (' + query + ')');
  if (m !== '50×50×3') fails.push('mapa esperado 50×50×3, obtido ' + m);
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('consola: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('página: ' + e.message));

  await open('battle=battleship&seed=3');
  await measure('jogo zoom 1');
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.waitForTimeout(400);
  await measure('jogo zoom 2');
  // pior caso: tudo revelado e todos os níveis à vista
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.evaluate(() => OV.BattleUI.debug.showAll(true));
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await page.waitForTimeout(400);
  await measure('revelado nível 3 zoom 1', true);
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await page.waitForTimeout(400);
  await measure('revelado nível 3 zoom 2', true);

  await open('battle=battleship&seed=3&night=1');
  await page.evaluate(() => OV.BattleUI.debug.showAll(true));
  await measure('noite revelado zoom 1');
} catch (e) {
  fails.push('exceção: ' + (e && e.message ? e.message.split('\n')[0] : e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const w of warns) console.log('⚠ ' + w);
for (const e of errors) console.log('✗ ' + e);
for (const f of fails) console.log('✗ ' + f);
const bad = fails.length + errors.length;
console.log(bad ? '✗ ' + bad + ' problema(s)' : '✓ desenho dentro do alvo; capturas em ' + OUT);
process.exit(bad ? 1 : 0);
