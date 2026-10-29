/* QA do pré-aquecimento dos sprites de tile (OV.BattleRender.prewarm, chamado por reset() ao carregar a batalha) num
   Chromium real (Playwright), Couraçado (mapa 50×50×3) a 1440×900 @2×: espera que o trabalho em segundo plano acabe,
   mede o pior tempo de desenho (BattleRender.stats().ms) nos fotogramas de um zoom 1 → 1.5 → 0.75 e de um pan com a
   cache já quente; depois esvazia a cache de sprites e repete o mesmo zoom «a frio» para comparar. Falha com erros de
   consola/página, se o pré-aquecimento não terminar ou se o zoom quente gerar sprites de tile novos.
   Uso: node ovni-1999/qa/battle_prewarm_check.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'battle') : path.join(process.cwd(), 'qa-out', 'battle'));
const OUT = path.resolve(arg('out', DEF_OUT));

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
const fails = [];
let browser, page, shotN = 0;
const log = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) fails.push(msg);
};
async function shot(name) {
  shotN++;
  await page.screenshot({ path: path.join(OUT, 'prewarm_' + String(shotN).padStart(2, '0') + '_' + name + '.png') });
}
// grava o tempo de desenho de cada fotograma durante fn (ms) → {max, avg, n, sprites (entradas novas na cache)}
async function measure(fn, ms) {
  await page.evaluate(() => {
    window.__ms = [];
    window.__ent0 = OV.TileSprites.stats().entries;
    window.__on = true;
    window.__st = [];
    const loop = () => { if (!window.__on) return; const st = OV.BattleRender.stats(); window.__ms.push(st.ms); window.__st.push(st); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await fn();
  await page.waitForTimeout(ms || 700);
  return page.evaluate(() => {
    window.__on = false;
    const a = window.__ms.slice(1);
    const worst = window.__st.slice(1)[a.indexOf(Math.max(...a))] || {};
    return { worst: 'regiões ' + worst.chunks + ', cozidas ' + worst.bakes + ', diretas ' + worst.direct + ', sprites ' + worst.sprites, max: +Math.max(...a).toFixed(1), avg: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1), n: a.length, sprites: OV.TileSprites.stats().entries - window.__ent0 };
  });
}
const key = async (k) => { await page.keyboard.press(k); };
async function zoomRun() {
  const a = await measure(() => key('='), 700);
  const b = await measure(async () => { await key('-'); await page.waitForTimeout(300); await key('-'); }, 900);
  return { in: a, out: b };
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?battle=battleship&seed=3&month=3&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  const t0 = Date.now();
  await page.waitForFunction(() => OV.BattleRender.warmStats().finished && OV.BattleRender.warmStats().total > 0, null, { timeout: 180000, polling: 500 });
  const w = await page.evaluate(() => OV.BattleRender.warmStats());
  log(w.finished && w.done > 0, 'pré-aquecimento terminou: ' + w.done + '/' + w.total + ' sprites em ' + w.ms.toFixed(0) + ' ms de trabalho (escalas ' + w.scales.join(', ') + '), ' + (Date.now() - t0) + ' ms de relógio');
  await page.waitForFunction(() => { const s = OV.BattleUI.debug.state(); return s && !s.playing && !OV.Presenter.playing; }, null, { timeout: 60000 });
  await page.mouse.move(720, 420);
  await shot('loaded');
  const warm = await zoomRun();
  await shot('warm_zoom');
  const pan = await measure(async () => {
    for (let k = 0; k < 30; k++) {
      await page.mouse.wheel(18, 10);
      await page.waitForTimeout(16);
    }
  }, 300);
  log(warm.in.sprites === 0, 'zoom 1 → 1.5 quente: ' + warm.in.sprites + ' sprites de tile novos, pior desenho ' + warm.in.max + ' ms (média ' + warm.in.avg + '; ' + warm.in.worst + ')');
  log(warm.out.sprites === 0, 'zoom 1.5 → 0.75 quente: ' + warm.out.sprites + ' sprites novos, pior desenho ' + warm.out.max + ' ms (média ' + warm.out.avg + '; ' + warm.out.worst + ')');
  console.log('· pan quente: pior desenho ' + pan.max + ' ms (média ' + pan.avg + ', ' + pan.n + ' fotogramas, ' + pan.sprites + ' sprites novos)');
  // a frio: sem sprites em cache (como antes do pré-aquecimento)
  await page.evaluate(() => { OV.TileSprites.clearCache(); });
  await key('=');
  await page.waitForTimeout(600);
  const cold = await zoomRun();
  await shot('cold_zoom');
  console.log('· a frio: zoom → 1.5 pior desenho ' + cold.in.max + ' ms (' + cold.in.sprites + ' sprites gerados); → 0.75 pior ' + cold.out.max + ' ms (' + cold.out.sprites + ')');
  log(warm.in.max <= cold.in.max, 'zoom quente (' + warm.in.max + ' ms) não pior do que a frio (' + cold.in.max + ' ms)');
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log('✗ exceção: ' + (e && e.stack ? e.stack : e));
  if (page) await shot('exception').catch(() => {});
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const e of errors) console.log('✗ ' + e);
const total = fails.length + errors.length;
console.log(total ? '\n' + total + ' falha(s) · capturas em ' + OUT : '\nTudo verde · capturas em ' + OUT);
process.exit(total ? 1 : 0);
