/* QA da ação «Descarregar» (OV.Act 'unload') ponta a ponta no inventário da batalha, num Chromium real (Playwright).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre e joga pela interface:
   ?battle=medium_scout&seed=7&month=1 — tecla I; escolhe a espingarda carregada na mão direita → botão «Descarregar»
   com «−8 UT»; descarrega (carregador com as balas que restavam na mão esquerda, −8 UT); a mesma arma passa a mostrar
   «Recarregar» (−15 UT) e recarrega; com a outra mão ocupada (o carregador) o botão fica desativado («Ocupada»);
   o painel de ações cabe no ecrã a 1440×900, 1280×800 e 1024×700 (@2×). Falha com erros de consola/página e chaves
   i18n em falta. Uso: node ovni-1999/qa/battle_unload_check.mjs [--out <pasta>] */
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
  const f = 'unload_' + String(shotN).padStart(2, '0') + '_' + name + '.png';
  await page.screenshot({ path: path.join(OUT, f) });
  return f;
}
const inv = () => page.evaluate(() => OV.InventoryUI.debug.state());
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!(window.OV && OV.BattleUI)) return false;
    const busy = OV.InventoryUI && OV.InventoryUI.isOpen() && OV.InventoryUI.debug.state().busy;
    if (busy) return false;
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 60000 });
  await page.waitForTimeout(150);
}
async function centre(sel) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error('sem elemento: ' + sel);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function click(sel) {
  const p = await centre(sel);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}
const unitInfo = (id) => page.evaluate((uid) => {
  const B = OV.Game.B, u = OV.BUnits.findUnit(B, uid);
  const it = (h) => { const x = OV.BUnits.item(B, u, h); return x ? { id: x.id, type: x.type, rounds: x.rounds, ammo: x.ammo ? x.ammo.rounds : null } : null; };
  return { tu: u.tu, R: it('R'), L: it('L') };
}, id);
const button = (act) => page.evaluate((a) => {
  const b = document.querySelector('[data-act="' + a + '"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { text: b.textContent, off: b.classList.contains('off'), cost: (b.querySelector('.cost') || {}).textContent || '', x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, vw: innerWidth, vh: innerHeight };
}, act);
// escolhe o objeto (um segundo clique no escolhido larga a escolha)
async function pick(id) {
  const st = await inv();
  if (st.selected !== 'i:' + id) await click('[data-src="i:' + id + '"]');
}
const fullTU = () => page.evaluate(() => {
  const u = OV.BUnits.findUnit(OV.Game.B, OV.InventoryUI.debug.state().unitId);
  u.tu = u.tuMax;
  OV.InventoryUI.refresh();
});

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?battle=medium_scout&seed=7&month=1&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  await idle();
  log(await page.evaluate(() => OV.Act.TYPES.indexOf('unload') >= 0), 'motor com a ação «unload»');
  const sel = await page.evaluate(() => OV.BattleUI.debug.state().selectedId);
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  let s = await inv();
  log(s.open && s.R && s.R.type === 'rifle' && s.R.ammo === 20 && !s.L, 'inventário aberto: espingarda carregada (20) na mão direita, esquerda livre');

  // escolher a arma → «Descarregar −8 UT»
  await click('[data-src="i:' + s.R.id + '"]');
  let b = await button('unload');
  log(!!b && /Descarregar/.test(b.text) && b.cost === '−8 UT' && !b.off, 'botão «Descarregar» com «−8 UT»: ' + (b && b.text));
  const rb = await button('reload');
  log(!rb, 'arma carregada: sem «Recarregar»');
  await shot('unload_button');

  // descarregar
  let u0 = await unitInfo(sel);
  await click('[data-act="unload"]');
  await idle();
  let u1 = await unitInfo(sel);
  log(u1.R && u1.R.ammo === null && u1.L && u1.L.type === 'rifle_clip' && u1.L.rounds === 20 && u0.tu - u1.tu === 8,
    'descarregada: carregador (20 balas) na mão esquerda, −' + (u0.tu - u1.tu) + ' UT');
  s = await inv();
  log(s.L && s.L.type === 'rifle_clip', 'o painel mostra o carregador na mão esquerda');
  await shot('unloaded');

  // a mesma arma passa a «Recarregar» e recarrega a partir da mão
  await pick(u1.R.id);
  b = await button('reload');
  log(!!b && /Recarregar/.test(b.text) && b.cost === '−15 UT' && !(await button('unload')), 'arma vazia: «Recarregar −15 UT» em vez de «Descarregar»');
  u0 = u1;
  await click('[data-act="reload"]');
  await idle();
  u1 = await unitInfo(sel);
  log(u1.R.ammo === 20 && u0.tu - u1.tu === 15, 'recarregada (−' + (u0.tu - u1.tu) + ' UT)');

  // outra mão ocupada (o carregador descarregado ou, se foi usado, uma granada) → botão desativado
  await fullTU();
  s = await inv();
  if (!s.L) {
    const g = s.belt.find((x) => x.type === 'grenade') || s.pack.find((x) => x.type === 'grenade');
    await pick(g.id);
    await click('[data-drop="slot:L"]');
    await idle();
    s = await inv();
  }
  log(!!s.L, 'mão esquerda ocupada: ' + (s.L && s.L.type));
  await pick(s.R.id);
  b = await button('unload');
  log(!!b && b.off && /^Ocupad[ao]$/.test(b.cost), 'com a outra mão ocupada «Descarregar» fica desativado («' + (b && b.cost) + '»)');
  await shot('unload_blocked');

  // cabe no ecrã nos tamanhos de referência
  await page.evaluate(() => {
    const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.InventoryUI.debug.state().unitId);
    const l = OV.BUnits.item(B, u, 'L');
    if (l) OV.BUnits.giveItem(B, u, l.id, 'pack', true);
    OV.InventoryUI.refresh();
  });
  for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);
    s = await inv();
    await pick(s.R.id);
    b = await button('unload');
    log(!!b && !b.off && b.x0 >= 0 && b.y0 >= 0 && b.x1 <= b.vw && b.y1 <= b.vh, vp.width + '×' + vp.height + ': «Descarregar» visível e ativo dentro do ecrã');
    await shot('unload_' + vp.width + 'x' + vp.height);
  }
  log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), 'sem chaves i18n em falta');
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
