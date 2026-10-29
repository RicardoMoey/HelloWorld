/* Verificação dos ecrãs e menus num Chromium real (Playwright): menu → batalha rápida → briefing → voltar; opções;
   como jogar; créditos; nova campanha; relatório (vitória e derrota) → jogar de novo; atalho ?battle=…; vista iPad.
   Tira capturas de cada passo e falha em qualquer erro de consola/página ou chave i18n em falta (⟦…⟧).
   Uso: node ovni-1999/qa/screens_check.mjs [--out <pasta>] [--port <n>] */
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
// capturas fora do repositório (pasta de sessão, OVNI_QA_OUT ou ./qa-out)
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'screens') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'screens') : path.join(process.cwd(), 'qa-out', 'screens');
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

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html`;

const browser = await chromium.launch();
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  const shot = async (name, p) => { await sleep(260); await (p || page).screenshot({ path: path.join(OUT, name + '.png') }); };
  const visible = (sel, p) => (p || page).locator(sel).first().isVisible();
  const topId = (p) => (p || page).evaluate(() => (OV.Scenes.top() || {}).id);
  const noMissing = async (where, p) => {
    const txt = await (p || page).evaluate(() => document.body.innerText);
    const m = txt.match(/⟦[^⟧]*⟧/g);
    check(!m, where + ': chaves i18n em falta ' + (m ? m.join(', ') : ''));
  };
  const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await sleep(60); } };

  // ---- menu principal
  await page.goto(BASE + '?nosw=1');
  await page.waitForSelector('.scr-menu .scr-mi', { timeout: 15000 });
  await sleep(900);
  check((await page.locator('.scr-menu .scr-mi').count()) === 8, 'menu: 8 entradas');
  check(await page.locator('.scr-logo-big').isVisible(), 'menu: logótipo visível');
  check((await page.locator('a.scr-family').getAttribute('href')) === '../index.html', 'menu: ligação ao hub');
  check(await page.locator('.scr-mi[data-id="continue"]').isDisabled(), 'menu: «Continuar» desativado sem gravações');
  await noMissing('menu');
  await shot('01-menu');

  // navegação por teclado até «Batalha Rápida»
  const selId = () => page.evaluate(() => (document.querySelector('.scr-mi.sel') || {}).dataset.id);
  check((await selId()) === 'quick', 'menu: seleção inicial em «Batalha Rápida» sem gravações');
  await key('ArrowDown');
  check((await selId()) === 'load', 'menu: ↓ passa a «Carregar»');
  await key('ArrowUp', 2);
  check((await selId()) === 'new', 'menu: ↑ salta «Continuar» desativado');
  await key('ArrowDown');
  check((await selId()) === 'quick', 'menu: ↓ volta a «Batalha Rápida»');
  await key('Enter');
  await page.waitForSelector('.scr-quickbattle .scr-seg-b', { timeout: 5000 });
  await sleep(300);
  check(await page.locator('.scr-menu').evaluate((n) => n.classList.contains('scr-paused')), 'menu escondido por baixo do formulário');
  await noMissing('batalha rápida');
  await shot('02-quickbattle');

  // terror: OVNI e terreno desativados
  await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'Local de Terror' }).click();
  check(await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'Batedor Médio' }).isDisabled(), 'terror: OVNI desativado');
  check(await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'Floresta' }).isDisabled(), 'terror: terreno desativado');
  check(/Local de Terror — /.test(await page.locator('.scr-sum-title').innerText()), 'terror: resumo com cidade');
  await shot('03-quick-terror');

  // OVNI despenhado, noite, mês 2, 6 soldados
  await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'OVNI Despenhado' }).click();
  await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'Batedor Médio' }).click();
  await page.locator('.scr-quickbattle .scr-seg-b', { hasText: 'Noite' }).click();
  await page.locator('.scr-quickbattle .scr-seg.months .scr-seg-b', { hasText: '2' }).click();
  await page.locator('.scr-quickbattle input[type=range]').fill('6');
  await page.locator('.scr-quickbattle .scr-seed').fill('4242');
  await page.locator('.scr-quickbattle .scr-seed').press('Tab');
  check((await page.locator('.scr-sum-title').innerText()).includes('Batedor Médio'), 'resumo: título com OVNI');
  await shot('04-quick-crash-night');
  await page.locator('.scr-quickbattle .btn.primary').click();
  await page.waitForSelector('.scr-briefing .scr-soldier', { timeout: 5000 });
  await sleep(300);
  check((await page.locator('.scr-briefing .scr-soldier').count()) === 6, 'briefing: 6 soldados');
  check((await page.locator('.scr-briefing canvas.scr-portrait').count()) === 6, 'briefing: retratos');
  check((await page.locator('.scr-briefing .scr-title').innerText()).includes('OVNI Despenhado — Batedor Médio'), 'briefing: título');
  check((await page.locator('.scr-briefing .scr-note').count()) >= 2, 'briefing: notas de noite e queda');
  await noMissing('briefing');
  await shot('05-briefing');

  // Esc volta ao formulário com as escolhas mantidas; Esc volta ao menu
  await key('Escape');
  await sleep(250);
  check((await topId()) === 'quickbattle', 'Esc no briefing volta ao formulário');
  check(await page.locator('.scr-quickbattle .scr-seg-b.on', { hasText: 'Noite' }).isVisible(), 'formulário mantém «Noite»');
  await key('Escape');
  await sleep(250);
  check((await topId()) === 'menu', 'Esc no formulário volta ao menu');
  check(!(await page.locator('.scr-menu').evaluate((n) => n.classList.contains('scr-paused'))), 'menu visível outra vez');

  // ---- opções
  await page.locator('.scr-mi[data-id="options"]').click();
  await page.waitForSelector('.scr-options .scr-switch', { timeout: 5000 });
  await sleep(250);
  await noMissing('opções');
  check((await page.locator('.scr-options .btn.danger').count()) === 0, 'opções: sem «Sair para o menu» fora de jogo');
  const before = await page.evaluate(() => OV.Game.settings.edgeScroll);
  await page.locator('.scr-options .scr-switch[aria-label="Deslocar nas margens do ecrã"]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ovni1999.settings') || '{}').edgeScroll);
  check(stored === !before, 'opções: definição gravada em localStorage');
  await page.locator('.scr-options .scr-seg-b', { hasText: '×4' }).first().click();
  check((await page.evaluate(() => OV.Game.settings.speedXcom)) === 4, 'opções: velocidade X-COM ×4');
  await shot('06-options');
  await key('Escape');
  await sleep(250);
  check((await topId()) === 'menu', 'Esc fecha as opções');

  // ---- como jogar
  await page.locator('.scr-mi[data-id="howto"]').click();
  await page.waitForSelector('.scr-howto .scr-ktable', { timeout: 5000 });
  await noMissing('como jogar');
  await shot('07-howto-controls');
  await key('2');
  check((await page.locator('.scr-howto .scr-card').count()) >= 6, 'como jogar: cartões de combate');
  await shot('08-howto-battle');
  await key('3');
  await shot('09-howto-geo');
  await key('Escape');
  await sleep(250);

  // ---- créditos
  await page.locator('.scr-mi[data-id="credits"]').click();
  await page.waitForSelector('.scr-credits .scr-docs a', { timeout: 5000 });
  check((await page.locator('.scr-credits .scr-docs a').count()) === 5, 'créditos: 5 documentos REA');
  const docHref = await page.locator('.scr-credits .scr-docs a').first().getAttribute('href');
  const docOk = await page.evaluate((h) => fetch(h).then((r) => r.ok), docHref);
  check(docOk, 'créditos: ligação para docs/rea responde');
  check((await page.locator('.scr-cr-p').innerText()).includes('Julian Gollop'), 'créditos: Julian Gollop');
  await noMissing('créditos');
  await shot('10-credits');
  await key('Escape');
  await sleep(250);

  // ---- nova campanha (modal ou cena newgame)
  await page.locator('.scr-mi[data-id="new"]').click();
  await sleep(300);
  const hasNewgame = await page.evaluate(() => !!OV.SceneDefs.newgame);
  if (!hasNewgame) {
    check(await visible('#modals .modal'), 'nova campanha: modal «próxima atualização»');
    await shot('11-newgame-modal');
    await page.locator('#modals .modal .btn', { hasText: 'Fechar' }).click();
    await sleep(200);
  } else {
    await shot('11-newgame');
    await key('Escape');
  }

  // ---- relatório: vitória com uma baixa, um ferido e experiência
  await page.evaluate(() => {
    OV.Scenes.set('menu');
    const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month: 1, seed: 77, squad: 8, time: 'day' });
    const B = OV.Battle.create(mission);
    const xs = B.units.filter((u) => u.side === 'xcom');
    const al = B.units.filter((u) => u.side === 'alien');
    al.forEach((u, k) => { u.status = 'dead'; xs[k % xs.length].kills = (xs[k % xs.length].kills | 0) + 1; });
    xs[2].status = 'dead';
    xs[4].hp = Math.max(1, xs[4].hp - 11);
    for (const u of xs) u.exp = { fire: 3, react: 2, brav: 1, thr: 1 };
    window.__qaDeb = { mission, meta };
    OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
  });
  await page.waitForSelector('.scr-debrief .scr-result', { timeout: 5000 });
  await sleep(300);
  check((await page.locator('.scr-debrief .scr-result').innerText()).toLowerCase() === 'vitória', 'relatório: vitória');
  check((await page.locator('.scr-debrief .scr-mem').count()) === 1, 'relatório: memorial com 1 baixa');
  check((await page.locator('.scr-debrief .scr-wound').count()) >= 1, 'relatório: feridos');
  check((await page.locator('.scr-debrief .scr-prog-row').count()) === 7, 'relatório: progressão dos 7 sobreviventes');
  check((await page.locator('.scr-debrief .scr-item').count()) >= 1, 'relatório: material recuperado com ícones');
  await noMissing('relatório');
  await shot('12-debrief-win');

  // jogar de novo → novo briefing com outra semente
  await page.locator('.scr-debrief .btn', { hasText: 'Jogar de novo' }).click();
  await page.waitForSelector('.scr-briefing .scr-soldier', { timeout: 5000 });
  check((await topId()) === 'briefing', '«Jogar de novo» abre o briefing');
  await key('Escape');
  await sleep(250);
  check((await topId()) === 'menu' || (await topId()) === 'quickbattle', 'Esc no briefing nunca deixa a pilha vazia');

  // derrota
  await page.evaluate(() => {
    OV.Scenes.set('menu');
    const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'terror', month: 0, seed: 11, squad: 5, time: 'night' });
    const B = OV.Battle.create(mission);
    for (const u of B.units) if (u.side === 'xcom') u.status = 'dead';
    OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
  });
  await page.waitForSelector('.scr-debrief .scr-result', { timeout: 5000 });
  await sleep(300);
  check((await page.locator('.scr-debrief .scr-result').innerText()).toLowerCase() === 'derrota', 'relatório: derrota');
  check((await page.locator('.scr-debrief .scr-mem').count()) === 5, 'relatório: memorial com 5 nomes');
  await shot('13-debrief-loss');
  await page.locator('.scr-debrief .btn.primary').click();
  await sleep(250);
  check((await topId()) === 'menu', '«Continuar» volta ao menu');

  // ---- atalho ?battle=… (sem briefing)
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror(battle): ' + (e && e.message)));
  p2.on('console', (m) => { if (m.type() === 'error') errors.push('console.error(battle): ' + m.text()); });
  await p2.goto(BASE + '?nosw=1&battle=small_scout&night=1&seed=3&diff=1&month=1');
  await sleep(1500);
  const hasBattle = await p2.evaluate(() => !!OV.SceneDefs.battlescape);
  const top2 = await topId(p2);
  if (hasBattle) {
    check(top2 === 'battlescape', '?battle=: entra direto no battlescape (topo: ' + top2 + ')');
    const M = await p2.evaluate(() => OV.Game.B && OV.Game.B.mission);
    check(M && M.ufoType === 'small_scout' && M.night && M.difficulty === 1 && M.month === 1 && M.seed === 3, '?battle=: parâmetros da missão');
  } else {
    check(await visible('#modals .modal', p2), '?battle= sem battlescape: aviso');
    check(top2 === 'quickbattle', '?battle= sem battlescape: fica no formulário');
  }
  await shot('14-direct-battle', p2);
  await p2.close();

  // ---- iPad vertical (toque)
  const ctxPad = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const pad = await ctxPad.newPage();
  pad.on('pageerror', (e) => errors.push('pageerror(ipad): ' + (e && e.message)));
  pad.on('console', (m) => { if (m.type() === 'error') errors.push('console.error(ipad): ' + m.text()); });
  await pad.goto(BASE + '?nosw=1');
  await pad.waitForSelector('.scr-menu .scr-mi', { timeout: 15000 });
  await sleep(700);
  await shot('15-ipad-menu', pad);
  await pad.locator('.scr-mi[data-id="quick"]').tap();
  await pad.waitForSelector('.scr-quickbattle .scr-seg-b', { timeout: 5000 });
  const overflow = await pad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'iPad: sem deslocação horizontal');
  await shot('16-ipad-quick', pad);
  await ctxPad.close();
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) fails.push(e);
console.log(`screens_check: ${checks} verificações, ${fails.length} falhas — capturas em ${OUT}`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
