/* Ronda de personas 5 — QA das Opções num Chromium real (Playwright):
   1. menu → Opções: no iPad (toque, sem teclado) não há «Cursor de teclado no combate» e «Reduzir movimento» fala
      da definição do iPad; com rato/trackpad a linha fica e a dica diz «sistema operativo» (nunca «computador»);
   2. iPad com teclado externo: depois de uma tecla física a linha volta a aparecer;
   3. Opções dentro do combate (botão do HUD) no iPad: a mesma regra.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 834×1194 / 1194×834 (toque). Falha em erros de consola/página ou ⟦…⟧.
   Uso: node ovni-1999/qa/persona_r5_screens.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r5_screens') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r5_screens') : path.join(process.cwd(), 'qa-out', 'persona_r5_screens');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('· ' + s);

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

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;
const browser = await chromium.launch();

const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  padP: { viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
const ALL = ['desk', 'zoom', 'padP', 'padL'];
const isPad = (v) => v.startsWith('pad');
async function openPage(view, tag) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Screens && OV.CampaignUI);
  await sleep(300);
  return { ctx, page };
}
const shot = async (page, name) => { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const topId = (page) => page.evaluate(() => (OV.Scenes.top() || {}).id);
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': chaves i18n em falta ' + (m ? [...new Set(m)].join(', ') : ''));
};
const press = async (page, view, loc) => { if (isPad(view)) await loc.tap(); else await loc.click(); };
const bodyScroll = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('.scr-brief-body')].pop();
  return b ? { top: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight } : null;
});

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  const optState = (page) => page.evaluate(() => {
    const t = document.querySelector('.scr-opts').innerText;
    return { kb: /Cursor de teclado/.test(t), ipad: /definição do iPad/.test(t), os: /sistema operativo/.test(t), pc: /computador/.test(t) };
  });

  // =============================================================================================================
  log('1–2. Opções do menu: sem cursor de teclado no iPad até se usar um teclado físico');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'opt-' + view);
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('options', {}); });
    await page.waitForSelector('.scr-opts');
    await sleep(400);
    const o = await optState(page);
    check(!o.pc, view + ': nada de «computador» (' + JSON.stringify(o) + ')');
    if (isPad(view)) {
      check(!o.kb, view + ': sem «Cursor de teclado» no toque (' + JSON.stringify(o) + ')');
      check(o.ipad && !o.os, view + ': «Reduzir movimento» fala do iPad');
    } else {
      check(o.kb && o.os && !o.ipad, view + ': com rato a linha e a dica do sistema ficam (' + JSON.stringify(o) + ')');
    }
    await shot(page, 'opt-' + view);
    await noMissing(page, 'opções ' + view);
    if (isPad(view)) {
      // teclado externo: uma tecla física (fecha com Esc) e as Opções voltam a mostrar o cursor de teclado
      await page.keyboard.press('Escape');
      await sleep(250);
      check((await topId(page)) !== 'options', view + ': Esc fechou as Opções');
      await page.evaluate(() => OV.Scenes.push('options', {}));
      await page.waitForSelector('.scr-opts');
      await sleep(300);
      const k = await optState(page);
      check(k.kb, view + ': com teclado físico a linha aparece (' + JSON.stringify(k) + ')');
      await shot(page, 'opt-' + view + '-kb');
    }
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Opções dentro do combate no iPad');
  for (const view of ['padL', 'padP', 'desk']) {
    const { ctx, page } = await openPage(view, 'bopt-' + view);
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Screens.startBattle(OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'small_scout', month: 0, time: 'day', diff: 0, squad: 6, seed: 7 }).mission, { quick: true }); });
    await page.waitForFunction(() => OV.Scenes.stack.some((x) => x.id === 'battlescape') && OV.BattleUI && OV.BattleUI.scene, null, { timeout: 20000 });
    await sleep(900);
    // o botão «Opções» do HUD (o mesmo caminho da persona), tocado no iPad
    const b = page.locator('.bs-hud button.bs-btn[aria-label^="Opções"]').first();
    check((await b.count()) === 1, view + ' combate: botão «Opções» no HUD');
    // a animação de entrada pode estar a correr (o 1.º toque só a acelera): tocar até abrir
    for (let i = 0; i < 4 && !(await page.locator('.scr-opts').count()); i++) { await press(page, view, b); await sleep(500); }
    await page.waitForSelector('.scr-opts');
    await sleep(400);
    const o = await optState(page);
    check(!o.pc, view + ' combate: nada de «computador»');
    check(isPad(view) ? !o.kb && o.ipad : o.kb && o.os, view + ' combate: ' + JSON.stringify(o));
    check(await page.evaluate(() => /abortar/i.test(document.querySelector('.scr-opts').innerText)), view + ' combate: botão «Abortar» no painel');
    await shot(page, 'bopt-' + view);
    await noMissing(page, 'opções do combate ' + view);
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log(e);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) fails.push(e);
console.log((fails.length ? '✗ ' : '✓ ') + (checks - fails.length + errors.length) + '/' + checks + ' verificações; capturas em ' + OUT);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
