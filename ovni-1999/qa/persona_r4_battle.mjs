/* Ronda 4 de personas — Battlescape e inventário num Chromium real (Playwright). Uma verificação por achado (a parte
   pura está em tools/tests/ui_persona_r4.test.js):
   A) Tiago (Recruta, rato): aliado perto da linha de tiro → aviso com o nome, marca no soldado, 2.º clique num tiro
      fraco («Clique outra vez — pode atingir …»); o registo (N) diz se o tiro acertou ou falhou;
   B) Pedro (teclado, 125 %): inventário — ← da mão esquerda vazia fica, ↓ vai ao cinto (nunca à mão direita);
   C) Pedro: alienígena visto numa casa por descobrir (atrás de uma parede, por uma janela) desenha-se em
      transparência por cima de tudo, com o losango; «1» mostra uma etiqueta com o nome; paleta 'cvd';
   D) Pedro: botões de reserva com aria-pressed e marca ✓ (forma, não só cor);
   E) Marta (iPad): a apontar, tocar no alienígena colado atrás do atirador aponta ao alienígena; o botão do
      alienígena escolhe-o como alvo (1.º toque) e dispara (2.º);
   F) Marta (iPad retrato): «Equipar» — toque longo numa linha do armazém e arrastar até à mão; arrastar logo na
      vertical continua a rolar a lista;
   G) Marta (iPad): deslizes com dois dedos a zoom 2 não baixam o zoom.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r4_battle.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r4') : path.join(process.cwd(), 'qa-out', 'persona_r4'));
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
let browser, page, ctx, shotN = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) fails.push(msg);
};
const st = () => page.evaluate(() => OV.BattleUI.debug.state());
async function shot(name) {
  shotN++;
  await page.screenshot({ path: path.join(OUT, String(shotN).padStart(2, '0') + '_' + name + '.png') });
}
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 60000 });
  await sleep(150);
}
function watch(p) {
  p.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
}
async function openBattle(query) {
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
  await idle();
}
async function desk(w, h, dpr) {
  ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr || 1 });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  page = await ctx.newPage();
  watch(page);
}
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let cdp = null;
async function ipad(w, h) {
  ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: IPAD_UA });
  page = await ctx.newPage();
  watch(page);
  cdp = await ctx.newCDPSession(page);
}
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(160); };
const noMissing = async (where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
const clearToasts = () => page.evaluate(() => { for (const n of document.querySelectorAll('#toasts .toast')) n.remove(); });

/* prepara um tiro em linha reta: atirador (o soldado escolhido), alienígena a 6 casas e um aliado a 1 casa ao lado
   da linha, na 2.ª casa; procura uma direção com as casas livres e o alienígena à vista. → {id, al, mate, …}|null */
const lineSetup = (opts) => page.evaluate((o) => {
  const B = OV.Game.B, m = B.map;
  B.mission.difficulty = o.diff;
  const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
  u.tu = u.tuMax;
  if (o.fire !== undefined) u.stats.fire = o.fire;
  // espingarda carregada na mão direita (o tiro do relatório)
  const oldR = u.items.R;
  if (oldR !== null && oldR !== undefined) { OV.BUnits.takeFromUnit(u, oldR); OV.BUnits.giveItem(B, u, oldR, 'pack', true); }
  const rifle = OV.BUnits.newItem(B, 'rifle', { ammo: 'rifle_clip' });
  OV.BUnits.giveItem(B, u, rifle.id, 'R', true);
  const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
  const mate = B.units.find((x) => x.side === 'xcom' && x.id !== u.id && x.onMap);
  const free = (x, y) => x >= 1 && y >= 1 && x < m.w - 1 && y < m.h - 1 && !B.units.some((q) => q.onMap && q.status !== 'dead' && q.x === x && q.y === y && q.z === u.z && q !== al && q !== mate)
    && OV.BUnits.fits(B, mate, OV.BMap.idx(m, x, y, u.z));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    let ok = true;
    for (let k = 1; k <= 6 && ok; k++) ok = free(u.x + dx * k, u.y + dy * k);
    const px = u.x + dx * 2 + (dy ? 1 : 0), py = u.y + dy * 2 + (dx && !dy ? 1 : 0);
    if (!ok || !free(px, py)) continue;
    OV.BUnits.placeUnit(B, al, OV.BMap.idx(m, u.x + dx * 6, u.y + dy * 6, u.z));
    OV.BUnits.placeUnit(B, mate, OV.BMap.idx(m, px, py, u.z));
    u.dir = OV.U.dirTo(dx, dy);
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    if (!OV.LOS.isVisibleTo(B, 'xcom', al)) continue;
    OV.BattleUI.refresh();
    return { id: u.id, x: u.x, y: u.y, al: al.id, ax: al.x, ay: al.y, mate: mate.id, mateName: mate.name };
  }
  return null;
}, opts);

let s;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) Tiago: aliado perto da linha de tiro ===============================
  for (const vp of [[1440, 900, 1], [1024, 576, 1.25]]) {
    const tag = vp[0] + 'x' + vp[1];
    await desk(vp[0], vp[1], vp[2]);
    await openBattle('battle=medium_scout&seed=7&diff=0');
    const L = await lineSetup({ diff: 0, fire: 15 });
    log(!!L, tag + ': tiro em linha montado ' + JSON.stringify(L));
    if (!L) { await ctx.close(); continue; }
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [L.x, L.y]);
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await sleep(200);
    const tp = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), L.al);
    await page.mouse.move(tp.x, tp.y + 8, { steps: 2 });
    await sleep(250);
    s = await st();
    const tu0 = s.unit.tu;
    log(s.mode === 'target' && s.target && s.target.risk.indexOf(L.mate) >= 0 && /^Risco: .* perto da linha de tiro/.test(s.target.sub || ''),
      tag + ': aviso «' + (s.target && s.target.sub) + '» e marca no aliado (risco ' + JSON.stringify(s.target && s.target.risk) + ', acerto ' + (s.target && s.target.hitPct) + ' %)');
    await shot('near_line_' + tag);
    if (tag === '1440x900') {
      await page.mouse.click(tp.x, tp.y + 8);
      await sleep(200);
      s = await st();
      log(s.unit.tu === tu0 && s.tapLock >= 0 && /^Clique outra vez — pode atingir /.test((s.target && s.target.sub) || ''), 'Recruta, acerto ' + (s.target && s.target.hitPct) + ' %: 1.º clique pede confirmação «' + (s.target && s.target.sub) + '»');
      await shot('near_line_confirm');
      await sleep(450);
      await page.mouse.click(tp.x, tp.y + 8);
      await idle();
      s = await st();
      log(s.unit.tu < tu0, '2.º clique dispara (UT ' + tu0 + ' → ' + s.unit.tu + ')');
      const lg = await page.evaluate(() => OV.BattleUI.debug.log().map((e) => e.text));
      const mine = lg.filter((x) => /(acertou|falhou|nenhum acerto|não acertou|atingiu)/.test(x));
      if (!mine.length) console.log('  registo: ' + JSON.stringify(lg));
      log(mine.length >= 1, 'registo com o resultado do tiro: ' + JSON.stringify(mine.slice(-2)));
      await page.keyboard.press('n');
      await sleep(250);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-report-list .bs-report-row')).map((n) => n.className + ' | ' + n.textContent));
      log(rows.some((r) => /(acertou|falhou|nenhum acerto)/.test(r) && /(good|miss)/.test(r)), 'painel N: ' + JSON.stringify(rows.slice(0, 3)));
      await shot('log_shot_result');
      await page.keyboard.press('Escape');
      // Veterano: só o aviso, sem 2.º clique
      await page.evaluate(() => { OV.Game.B.mission.difficulty = 1; });
      await clearToasts();
    }
    await noMissing('linha de tiro ' + tag);
    await ctx.close();
  }

  // =============================== B) Pedro: setas no inventário ===============================
  await desk(1024, 560, 2.5);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const o = u.items.L;
    if (o !== null && o !== undefined) { OV.BUnits.takeFromUnit(u, o); OV.BUnits.giveItem(B, u, o, 'pack', true); }
    OV.BattleUI.refresh();
  });
  await page.keyboard.press('i');
  await sleep(400);
  const fk = () => page.evaluate(() => { const n = document.querySelector('.inv-panel .kfocus'); if (!n) return ''; const b = n.closest('[data-drop]'); return (b ? b.dataset.drop : '') + '|' + (n.dataset.src || n.dataset.drop || n.className); });
  // anda até à mão esquerda (caixa vazia) com as setas
  let at = '';
  for (let k = 0; k < 14 && !/^slot:L\|/.test(at); k++) {
    const dir = await page.evaluate(() => {
      const f = document.querySelector('.inv-panel .kfocus'), t = document.querySelector('.inv-panel [data-drop="slot:L"]');
      if (!f) return 'ArrowDown';
      const a = f.getBoundingClientRect(), b = t.getBoundingClientRect();
      const dy = b.top - a.top, dx = b.left - a.left;
      return Math.abs(dy) > 20 ? (dy < 0 ? 'ArrowUp' : 'ArrowDown') : dx < 0 ? 'ArrowLeft' : 'ArrowRight';
    });
    await page.keyboard.press(dir);
    await sleep(60);
    at = await fk();
  }
  log(/^slot:L\|/.test(at), 'foco na mão esquerda: ' + at);
  await page.keyboard.press('ArrowLeft');
  await sleep(80);
  const afterLeft = await fk();
  log(afterLeft === at, '← na mão esquerda fica onde está (' + afterLeft + ')');
  await page.keyboard.press('ArrowDown');
  await sleep(80);
  const afterDown = await fk();
  log(/^slot:belt\|/.test(afterDown), '↓ da mão esquerda vai ao cinto (' + afterDown + ')');
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  log(/^slot:L\|/.test(await fk()), '↑ do cinto volta à mão esquerda');
  await shot('inv_nav_125');
  await page.keyboard.press('Escape');
  await sleep(200);
  await ctx.close();

  // =============================== C) Pedro: alienígena numa casa por descobrir ===============================
  for (const vp of [[1440, 900, 1], [1024, 576, 1.25]]) {
    const tag = vp[0] + 'x' + vp[1];
    await desk(vp[0], vp[1], vp[2]);
    await openBattle('battle=medium_scout&seed=7');
    await page.evaluate(() => { OV.Game.settings.palette = 'cvd'; OV.BattleUI.refresh(); });
    const L = await lineSetup({ diff: 1 });
    // visto pela X-COM, mas as casas dele ainda por descobrir (o caso da janela/parede do Local de terror)
    await page.evaluate((id) => {
      const B = OV.Game.B, a = OV.BUnits.findUnit(B, id);
      for (const i of OV.BUnits.unitTiles(a, B.map)) B.map.disc[i] = 0;
      OV.BattleUI.refresh();
    }, L.al);
    await page.keyboard.press('1');
    await sleep(500);
    const r = await page.evaluate((id) => ({ drawn: OV.BattleRender.unitRects().some((q) => q.unitId === id), tag: OV.BattleUI.debug.state().unitTag, name: OV.BUnits.findUnit(OV.Game.B, id).name || OV.T(OV.BUnits.findUnit(OV.Game.B, id).nameKey) }), L.al);
    log(r.drawn, tag + ': alienígena visto numa casa por descobrir é desenhado (antes: só o HUD dizia «1»)');
    log(!!r.tag && r.tag.unitId === L.al && r.tag.text === r.name, tag + ': «1» mostra a etiqueta «' + (r.tag && r.tag.text) + '»');
    await shot('alien_unknown_tile_cvd_' + tag);
    // D) reserva com aria-pressed e marca ✓
    await page.keyboard.press('Shift+Digit2');
    await sleep(200);
    const res = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-res')).map((n) => ({ p: n.getAttribute('aria-pressed'), on: n.classList.contains('on'), mark: getComputedStyle(n, '::after').content })));
    const grp = await page.evaluate(() => (document.querySelector('.bs-reserve') || {}).getAttribute && document.querySelector('.bs-reserve').getAttribute('aria-label'));
    log(res.length === 5 && res.every((x) => x.p === (x.on ? 'true' : 'false')) && res.filter((x) => x.on).length === 1 && res.filter((x) => x.on)[0].mark.indexOf('✓') >= 0 && !!grp,
      tag + ': reserva com aria-pressed e ✓ ' + JSON.stringify(res.map((x) => x.p + (x.on ? '✓' : ''))) + ' grupo «' + grp + '»');
    await shot('reserve_pressed_' + tag);
    await noMissing('alienígena tapado ' + tag);
    await ctx.close();
  }

  // =============================== E) Marta: alvo colado atrás do atirador, botão do alienígena ===============================
  for (const vp of [[1194, 834], [834, 1194]]) {
    const tag = vp[0] + 'x' + vp[1];
    await ipad(vp[0], vp[1]);
    await openBattle('battle=medium_scout&seed=7');
    const adj = await page.evaluate(() => {
      const B = OV.Game.B, m = B.map;
      const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
      u.tu = u.tuMax;
      const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
      const oldR = u.items.R;
      if (oldR !== null && oldR !== undefined) { OV.BUnits.takeFromUnit(u, oldR); OV.BUnits.giveItem(B, u, oldR, 'pack', true); }
      OV.BUnits.giveItem(B, u, OV.BUnits.newItem(B, 'pistol', { ammo: 'pistol_clip' }).id, 'R', true);
      // uma casa «acima» no ecrã (x−1, y−1)
      const i = OV.BMap.idx(m, u.x - 1, u.y - 1, u.z);
      if (!OV.BUnits.fits(B, al, i) || B.units.some((q) => q.onMap && q.x === u.x - 1 && q.y === u.y - 1 && q.z === u.z)) return null;
      OV.BUnits.placeUnit(B, al, i);
      u.dir = 7;
      if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
      OV.BattleUI.refresh();
      return { id: u.id, x: u.x, y: u.y, al: al.id, ai: i, seen: OV.LOS.isVisibleTo(B, 'xcom', al) };
    });
    log(!!adj && adj.seen, tag + ': alienígena colado atrás do atirador ' + JSON.stringify(adj));
    if (!adj) { await ctx.close(); continue; }
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [adj.x, adj.y]);
    await sleep(200);
    // um toque no mapa (o jogo passa a saber que é toque) e a pontaria pelo teclado do iPad
    const free = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [adj.x + 3, adj.y + 3]);
    await tap(free.x, free.y);
    await page.evaluate(() => OV.BattleUI.debug.state() && document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await sleep(250);
    const ap = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), adj.al);
    // centro do corpo do alienígena (unitScreen dá a cabeça)
    await tap(ap.x, ap.y + 14);
    await sleep(200);
    s = await st();
    log(s.mode === 'target' && s.target && s.target.toI === adj.ai && /Acerto|Toque/.test((s.target.label || '') + (s.target.sub || '')), tag + ': toque no alienígena aponta-lhe (alvo ' + (s.target && s.target.toI) + ' = ' + adj.ai + ', «' + (s.target && s.target.label) + '»)');
    await shot('ipad_adjacent_aim_' + tag);
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await sleep(200);
    const tu0 = (await st()).unit.tu;
    const bb = await page.locator('.bs-alien').first().boundingBox();
    await tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(250);
    s = await st();
    log(s.mode === 'target' && s.target && s.target.toI === adj.ai && s.tapLock === adj.ai && s.unit.tu === tu0, tag + ': botão do alienígena a apontar: alvo escolhido, «' + (s.target && s.target.sub) + '»' + (s.target ? '' : ' ' + JSON.stringify({ mode: s.mode, tapLock: s.tapLock, bb })));
    await shot('ipad_alien_button_' + tag);
    await sleep(450);
    await tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await idle();
    s = await st();
    log(s.unit.tu < tu0, tag + ': 2.º toque no botão dispara (UT ' + tu0 + ' → ' + s.unit.tu + ')');
    await noMissing('iPad pontaria ' + tag);
    await ctx.close();
  }

  // =============================== F) Marta: «Equipar» no retrato, toque longo e arrastar ===============================
  await ipad(834, 1194);
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 30000 });
  await page.evaluate(() => {
    const G = OV.Campaign.newCampaign({ seed: 31, difficulty: 0 });
    G.ui.geoIntro = true;
    OV.Game.G = G;
    OV.CampaignUI.openGeo(G);
  });
  await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
  await sleep(300);
  await page.evaluate(() => { const G = OV.Game.G; OV.Scenes.push('equip', { G, craftId: Object.keys(G.crafts).find((id) => G.crafts[id].type === 'skyranger') }); });
  await page.waitForSelector('.cp-eq .inv-equip', { timeout: 10000 });
  await sleep(500);
  // mão esquerda vazia
  const lhEmpty = await page.evaluate(() => !!document.querySelector('.cp-eq [data-drop="slot:L"].empty'));
  const row = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.cp-eq .eq-stores [data-src^="st:"]'));
    const n = list.find((x) => /pistol"?$/.test(x.dataset.src)) || list.find((x) => /st:pistol/.test(x.dataset.src)) || list[0];
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { src: n.dataset.src, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const lh = await page.evaluate(() => { const r = document.querySelector('.cp-eq [data-drop="slot:L"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  log(lhEmpty && !!row && lh.y < row.y, 'retrato: mão esquerda vazia acima da linha ' + row.src + ' (' + Math.round(lh.y) + ' < ' + Math.round(row.y) + ')');
  const scrollOf = () => page.evaluate(() => { const n = document.querySelector('.cp-eq .eq-stores-list'); return n ? n.scrollTop : -1; });
  // arrastar logo na vertical: rola a lista, não pega no objeto
  const sc0 = await scrollOf();
  await touch('touchStart', [[row.x, row.y]]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [[row.x, row.y - 18 * k]]); await sleep(16); }
  await touch('touchEnd', []);
  await sleep(400);
  const st1 = await page.evaluate(() => (document.querySelector('.cp-eq [data-drop="slot:L"]') || {}).className);
  log(/empty/.test(st1), 'arrasto vertical imediato não pega no objeto (rola a lista: ' + sc0 + ' → ' + (await scrollOf()) + ')');
  // toque longo (400 ms) e arrastar até à mão esquerda
  const row2 = await page.evaluate((src) => { const n = document.querySelector('.cp-eq [data-src="' + src + '"]') || document.querySelector('.cp-eq .eq-stores [data-src^="st:"]'); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { src: n.dataset.src, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, row.src);
  const lh2 = await page.evaluate(() => { const r = document.querySelector('.cp-eq [data-drop="slot:L"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await touch('touchStart', [[row2.x, row2.y]]);
  await sleep(400);
  const lifted = await page.evaluate(() => !!document.querySelector('.inv-ghost'));
  for (let k = 1; k <= 12; k++) { await touch('touchMove', [[row2.x + (lh2.x - row2.x) * k / 12, row2.y + (lh2.y - row2.y) * k / 12]]); await sleep(30); }
  await shot('ipad_equip_drag_mid');
  await touch('touchEnd', []);
  await sleep(500);
  const lhNow = await page.evaluate(() => { const n = document.querySelector('.cp-eq [data-drop="slot:L"]'); return { empty: n.classList.contains('empty'), txt: n.textContent.trim().slice(0, 40) }; });
  log(lifted && !lhNow.empty, 'toque longo levanta o objeto e arrasta-o até à mão esquerda («' + lhNow.txt + '»)');
  const hint = await page.evaluate(() => document.body.innerText.match(/[^\n]*mantenha o dedo[^\n]*/) ? 'ok' : (document.querySelector('.cp-eq .eq-hint, .cp-eq [class*=hint]') || {}).textContent || '');
  console.log('  dica do Equipar (texto da campanha, outro ficheiro): ' + String(hint).slice(0, 120));
  await shot('ipad_equip_after_drag');
  await noMissing('Equipar retrato');
  await ctx.close();

  // =============================== G) Marta: deslizes com dois dedos a zoom 2 ===============================
  await ipad(1194, 834);
  await openBattle('battle=medium_scout&seed=7');
  const seq = async (list) => { for (const s0 of list) { await touch(s0.type, s0.pts); if (s0.wait) await sleep(s0.wait); } };
  const pinch = async (cx, cy, from, to) => { const q = [{ type: 'touchStart', pts: [[cx - from, cy], [cx + from, cy]], wait: 30 }]; for (let k = 1; k <= 8; k++) { const d = from + (to - from) * k / 8; q.push({ type: 'touchMove', pts: [[cx - d, cy], [cx + d, cy]], wait: 30 }); } q.push({ type: 'touchEnd', pts: [] }); await seq(q); };
  const pan2 = async (cx, cy, dx, dy) => { const q = [{ type: 'touchStart', pts: [[cx - 40, cy], [cx + 40, cy]], wait: 30 }]; for (let k = 1; k <= 8; k++) q.push({ type: 'touchMove', pts: [[cx - 40 + dx * k / 8, cy + dy * k / 8], [cx + 40 + dx * k / 8, cy + dy * k / 8]], wait: 30 }); q.push({ type: 'touchEnd', pts: [] }); await seq(q); };
  const zooms = [];
  for (let run = 0; run < 4; run++) {
    for (let i = 0; i < 3; i++) { await pinch(700, 400, 60, 160); await sleep(150); }
    const z0 = (await st()).cam.zoom;
    const z = [z0];
    for (let i = 0; i < 4; i++) { await pan2(700, 400, -120, -40); await sleep(180); z.push((await st()).cam.zoom); }
    zooms.push(z);
    await pinch(700, 400, 160, 60);
    await sleep(300);
  }
  log(zooms.every((z) => z[0] === 2 && z.every((v) => v === 2)), 'zoom 2 aguenta 16 deslizes com dois dedos ' + JSON.stringify(zooms));
  const zIn = (await st()).cam.zoom;
  log(zIn < 2, 'a pinça para dentro continua a afastar (zoom ' + zIn + ')');
  await shot('ipad_zoom_pan');
  await ctx.close();
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log('✗ exceção: ' + (e && e.stack ? e.stack : e));
  if (page) await shot('exception').catch(() => {});
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const e of errors) console.log('✗ ' + e);
console.log((fails.length || errors.length ? '✗ ' : '✓ ') + (fails.length + errors.length) + ' falha(s); capturas em ' + OUT);
process.exit(fails.length || errors.length ? 1 : 0);
