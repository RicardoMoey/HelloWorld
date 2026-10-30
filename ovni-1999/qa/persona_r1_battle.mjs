/* Ronda 1 de personas — Battlescape, inventário e «Equipar» num Chromium real (Playwright).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre e verifica, com capturas:
   A) teclado só (Pedro): setas movem o cursor de tiles, Enter anda com a mesma pré-visualização, ⇧+setas deslocam a
      câmara sem mexer no cursor, E→1 entra no modo de alvo com o cursor num alienígena, Tab salta, G entra no
      lançamento com o cursor, «?» mostra as teclas, Esc esconde o cursor;
   B) explosivo com aliados no raio (Tiago): o 1.º Enter não dispara («Enter outra vez… atinge N aliados»), o 2.º
      dispara; rótulo «Explosão raio N» em vez de «Acerto ≈ 0 %»; menu com «Pontaria»;
   C) porta (Rui): com ⌥ o rótulo passa a «Abrir a porta sem entrar · N UT», sem ⌥ aparece a dica; ⌥+clique abre;
   D) turno alienígena (Sofia): registo com «foi morta em combate — explosão (…)» e painel com «Mostrar»;
      abortar com 0 soldados na nave avisa que a nave se perde;
   E) movimento reduzido e paleta para daltonismo (Pedro): sem animações no HUD, FX sem tremor, classes cvd;
   F) iPad 834×1194 e 1194×834 (Marta): nenhum botão do HUD tapado por outro, toque longo mostra a etiqueta e não
      carrega no botão, sem caminho «fantasma» depois de andar, «Toque para acelerar» no turno alienígena;
   G) 1024×576 (125 %): nomes das armas nas mãos sem corte, reserva de UT livre;
   H) «Equipar» (Rui/Sofia/Inês/Pedro/Marta): botões sem texto cortado a 1440, 1024 e retrato, teclado (setas +
      Enter apanha e pousa), auto-equipar sem armas por investigar nem acima da Força; kit médico sem texto a sair.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r1_battle.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r1') : path.join(process.cwd(), 'qa-out', 'persona_r1'));
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
const noMissing = async (where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
// botões do HUD que não estão debaixo de outro (o centro de cada um devolve-o a ele próprio)
const covered = () => page.evaluate(() => {
  const bad = [];
  for (const n of document.querySelectorAll('.bs-hud .bs-btn, .bs-hud .bs-end, .bs-hud .bs-hand, .bs-hud .bs-res')) {
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!e || !(n === e || n.contains(e))) bad.push((n.getAttribute('aria-label') || n.className) + ' ← ' + (e ? e.className || e.tagName : 'nada'));
  }
  return bad;
});
const smallTargets = () => page.evaluate(() => {
  const bad = [];
  for (const n of document.querySelectorAll('.bs-hud button, .modal button, .modal label')) {
    const r = n.getBoundingClientRect();
    if (r.width < 2) continue;
    if (r.height < 32 || r.width < 32) bad.push((n.getAttribute('aria-label') || n.textContent.trim().slice(0, 20)) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  return bad;
});
const setUnitTiles = (pairs) => page.evaluate((list) => {
  const B = OV.Game.B;
  for (const [id, x, y, z] of list) {
    const u = OV.BUnits.findUnit(B, id);
    OV.BUnits.placeUnit(B, u, OV.BMap.idx(B.map, x, y, z || 0));
  }
  if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
  OV.BattleUI.refresh();
}, pairs);

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) teclado só ===============================
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  page = await ctx.newPage();
  watch(page);
  await openBattle('battle=medium_scout&seed=7');
  let s = await st();
  const u0 = s.unit;
  await page.keyboard.press('ArrowRight');
  s = await st();
  log(s.kcur && s.kcur.x === u0.x && s.kcur.y === u0.y, '1.ª seta: cursor de teclado aparece no soldado ' + JSON.stringify(s.kcur));
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp']) await page.keyboard.press(k);
  await sleep(150);
  s = await st();
  const dest = s.kcur;
  log(!!dest && (dest.x !== u0.x || dest.y !== u0.y) && /^Custa \d+ UT · ficam \d+ · En \d+/.test(s.pathLabel || ''), 'setas: cursor ' + JSON.stringify(dest) + ', pré-visualização «' + s.pathLabel + '»');
  log(/Setas: cursor/.test(s.hint), 'dica do teclado no HUD: «' + s.hint + '»');
  log(s.pathStates.length > 0 && s.pathStates.every((x) => x === 'ok' || x === 'reserve'), 'estados dos passos: ' + s.pathStates.join(','));
  await shot('kb_cursor_move');
  const cam0 = s.cam;
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowLeft');
  await sleep(350);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Shift');
  s = await st();
  log(s.cam.x < cam0.x - 20 && s.kcur && s.kcur.x === dest.x && s.kcur.y === dest.y, '⇧+← desloca a câmara (' + Math.round(cam0.x) + '→' + Math.round(s.cam.x) + ') e o cursor fica');
  await page.keyboard.press('Enter');
  await idle();
  s = await st();
  log(s.unit.x === dest.x && s.unit.y === dest.y, 'Enter: o soldado anda até ao cursor (' + s.unit.x + ',' + s.unit.y + ')');
  log(s.turn === 1 && s.side === 'xcom', 'Enter com o cursor não terminou o turno');
  // alvo pelo teclado: alienígena posto à vista
  const al = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    return { id: a.id, ux: u.x, uy: u.y };
  });
  await setUnitTiles([[al.id, al.ux + 4, al.uy + 1, 0]]);
  await page.evaluate(() => OV.BattleUI.debug.centre(OV.BattleUI.debug.state().unit.x, OV.BattleUI.debug.state().unit.y, 0));
  s = await st();
  const seenAl = s.visibleAliens.find((a) => a.id === al.id);
  log(!!seenAl, 'alienígena de teste à vista: ' + JSON.stringify(s.visibleAliens));
  await page.keyboard.press('e');
  await page.keyboard.press('1');
  await sleep(200);
  s = await st();
  log(s.mode === 'target' && s.kcur && seenAl && s.kcur.x === seenAl.x && s.kcur.y === seenAl.y, 'E→1: modo de alvo com o cursor no alienígena ' + JSON.stringify(s.kcur));
  log(!!s.target && /Acerto ≈ \d+ %|Explosão/.test(s.target.label || ''), 'pré-visualização do tiro pelo teclado: «' + (s.target && s.target.label) + '»');
  log(/Tab ou 1–0/.test(s.hint), 'dica de alvo pelo teclado: «' + s.hint + '»');
  await shot('kb_target');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  s = await st();
  log(s.kcur && seenAl && s.kcur.x === seenAl.x && s.kcur.y === seenAl.y, 'Tab volta a pôr o cursor no alienígena');
  await page.keyboard.press('Escape');
  s = await st();
  log(s.mode === 'move' && !!s.kcur, 'Esc cancela o modo de alvo (o cursor fica)');
  const hasGrenade = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    return OV.BUnits.allItems ? OV.BUnits.allItems(B, u).some((it) => OV.Data.items[it.type].kind === 'grenade') : true;
  });
  if (hasGrenade) {
    await page.keyboard.press('g');
    await sleep(200);
    s = await st();
    log(s.mode === 'throw' && !!s.kcur && !!s.throwInfo, 'G: lançamento pelo teclado com destino «' + (s.throwInfo && s.throwInfo.label) + '»');
    await shot('kb_throw');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  s = await st();
  log(!s.kcur, 'Esc esconde o cursor de teclado');
  await page.keyboard.press('Shift+Slash');
  await sleep(200);
  log(await page.locator('.modal .bs-keys').count() === 1, '«?» abre a folha de teclas');
  await shot('kb_keys');
  await page.keyboard.press('Escape');
  await sleep(150);

  // =============================== B) explosivo com aliados no raio ===============================
  const setup = await page.evaluate(() => {
    const B = OV.Game.B;
    B.mission.difficulty = 0;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    u.tu = u.tuMax;
    const old = u.items.L;
    if (old !== null && old !== undefined) {
      OV.BUnits.takeFromUnit(u, old);
      OV.BUnits.giveItem(B, u, old, 'pack', true);
    }
    const it = OV.BUnits.newItem(B, 'rocket_launcher', { ammo: 'small_rocket' });
    OV.BUnits.giveItem(B, u, it.id, 'L', true);
    const mate = B.units.find((x) => x.side === 'xcom' && x.id !== u.id && x.onMap);
    const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    return { id: u.id, x: u.x, y: u.y, mate: mate.id, al: al.id };
  });
  // aliado fora da linha de tiro mas dentro do raio; o alienígena de teste vai para longe
  await setUnitTiles([[setup.mate, setup.x + 5, setup.y + 3, 0], [setup.al, 2, 2, 0]]);
  await page.evaluate(() => OV.BattleUI.refresh());
  await page.keyboard.press('q');
  await sleep(150);
  s = await st();
  log(!!s.menu && s.menu.entries.length > 0 && s.menu.entries.every((e) => e.acc === undefined || typeof e.acc === 'number'), 'menu do lança-foguetes aberto');
  const accTxt = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-mi-acc')).map((n) => n.textContent).filter(Boolean));
  log(accTxt.length > 0 && accTxt.every((t) => /^Pontaria \d+ %$/.test(t)), 'menu: coluna «Pontaria» ' + JSON.stringify(accTxt));
  await shot('rocket_menu');
  await page.keyboard.press('1');
  await sleep(150);
  await page.evaluate(([x, y]) => OV.BattleUI.debug.kb(x, y, 0), [setup.x + 5, setup.y + 1]);
  await sleep(150);
  s = await st();
  log(s.target && /^Explosão raio \d+ · /.test(s.target.label || '') && s.target.blastR > 0, 'rótulo do explosivo: «' + (s.target && s.target.label) + '»');
  log(s.target && /Risco: \d+ aliado/.test(s.target.sub || ''), 'aviso de aliados no raio: «' + (s.target && s.target.sub) + '»');
  const tu0 = s.unit.tu;
  await page.keyboard.press('Enter');
  await sleep(200);
  s = await st();
  log(s.unit.tu === tu0 && s.tapLock >= 0 && /Enter outra vez para disparar — atinge \d+ aliado/.test(s.target && s.target.sub || ''), '1.º Enter não dispara: «' + (s.target && s.target.sub) + '»');
  await shot('blast_confirm');
  await page.keyboard.press('Enter');
  await idle();
  s = await st();
  log(s.unit.tu < tu0, '2.º Enter dispara (UT ' + tu0 + ' → ' + s.unit.tu + ')');
  await shot('blast_after');

  // =============================== C) porta: ⌥ mostra o custo de a abrir sem entrar ===============================
  await openBattle('battle=medium_scout&seed=7');
  const door = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    for (let i = 0; i < m.w * m.h; i++) {
      if (!OV.BMap.isUfoDoor(m, i)) continue;
      const [x, y] = OV.BMap.xyz(m, i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = OV.BMap.idx(m, x + dx, y + dy, 0);
        if (x + dx < 0 || y + dy < 0 || x + dx >= m.w || y + dy >= m.h) continue;
        if (B.units.some((q) => q.onMap && q.x === x + dx && q.y === y + dy && q.z === 0)) continue;
        const ox = u.x, oy = u.y;
        OV.BUnits.placeUnit(B, u, j);
        u.tu = u.tuMax;
        const v = OV.Act.validate(B, { type: 'door', unitId: u.id, i });
        if (v.ok) {
          for (let k = 0; k < 6; k++) m.disc[i] |= 7;
          OV.LOS.refreshAll(B);
          OV.BattleUI.refresh();
          return { x, y, tu: v.tu };
        }
        OV.BUnits.placeUnit(B, u, OV.BMap.idx(m, ox, oy, 0));
      }
    }
    return null;
  });
  log(!!door, 'porta de OVNI junto ao soldado ' + JSON.stringify(door));
  if (door) {
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [door.x, door.y]);
    await sleep(200);
    const p = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [door.x, door.y]);
    await page.mouse.move(p.x - 30, p.y + 10);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await sleep(120);
    s = await st();
    log(/abrir a porta sem entrar/.test(s.pathSub || ''), 'sem ⌥: dica «' + s.pathSub + '»');
    await page.keyboard.down('Alt');
    await sleep(120);
    s = await st();
    log(/^Abrir a porta sem entrar · \d+ UT$/.test(s.pathLabel || ''), 'com ⌥: «' + s.pathLabel + '»');
    await shot('door_alt');
    const tuB = s.unit.tu;
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await idle();
    s = await st();
    log(s.unit.tu === tuB - door.tu && s.unit.x !== door.x, '⌥+clique abre a porta sem entrar (−' + door.tu + ' UT)');
  }

  // =============================== D) registo do turno alienígena e abortar ===============================
  const ids = await page.evaluate(() => {
    const B = OV.Game.B;
    const f = B.units.find((x) => x.side === 'xcom' && x.onMap);
    f.female = true;
    f.name = 'Teresa Carvalho';
    const a = B.units.find((x) => x.side === 'alien' && x.onMap);
    return { f: f.id, a: a.id, i: (f.z * B.map.h + f.y) * B.map.w + f.x };
  });
  await page.evaluate((o) => {
    const D = OV.BattleUI.debug;
    D.noteEvent({ t: 'damage', unitId: o.f, attackerId: o.a, dmgType: 'HE', cause: 'grenade', amount: 50, wounds: 0, vis: true, pos: o.i });
    D.noteEvent({ t: 'death', unitId: o.f, killerId: o.a, cause: 'grenade', i: o.i, vis: true, pos: o.i });
    D.report('turn');
  }, ids);
  await sleep(200);
  s = await st();
  log(!!s.report && s.report.rows.some((r) => /Teresa Carvalho foi morta em combate — explosão/.test(r)), 'painel «Durante o turno alienígena»: ' + JSON.stringify(s.report && s.report.rows));
  log(await page.locator('.bs-report .bs-report-row .btn').count() > 0, 'botão «Mostrar» em cada linha');
  await shot('alien_turn_report');
  await page.keyboard.press('Escape');
  s = await st();
  log(!s.report, 'Esc fecha o relatório');
  await page.keyboard.press('n');
  await sleep(150);
  s = await st();
  log(!!s.report && s.report.kind === 'log', 'N abre o registo de mensagens');
  await page.keyboard.press('n');
  // abortar sem ninguém na nave
  await page.evaluate(() => {
    const B = OV.Game.B, craft = new Set(B.craftTiles || []);
    for (const u of B.units) {
      if (u.side !== 'xcom' || !u.onMap) continue;
      if (OV.BUnits.unitTiles(u, B.map).some((i) => craft.has(i))) {
        for (let i = 0; i < B.map.w * B.map.h; i++) {
          if (craft.has(i) || B.units.some((q) => q.onMap && q.z === 0 && (q.y * B.map.w + q.x) === i)) continue;
          if (OV.Path && OV.BUnits.fits && !OV.BUnits.fits(B, u, i)) continue;
          OV.BUnits.placeUnit(B, u, i);
          break;
        }
      }
    }
    OV.BattleUI.refresh();
  });
  await page.locator('.bs-btn.danger').first().click();
  await sleep(250);
  const abortTxt = await page.locator('.modal').innerText().catch(() => '');
  log(/a nave fica no terreno e perde-se/.test(abortTxt) && /Abortar e perder a nave/i.test(abortTxt), 'abortar com 0 na nave avisa que a nave se perde');
  await shot('abort_lose_craft');
  await page.locator('.modal button', { hasText: /cancelar/i }).first().click();
  await sleep(150);

  // =============================== E) movimento reduzido + paleta para daltonismo ===============================
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { OV.Game.settings.palette = 'cvd'; OV.BattleUI.refresh(); });
  await sleep(300);
  const rm = await page.evaluate(() => ({ rm: document.querySelector('.bs-hud').classList.contains('rm'), cvd: document.querySelector('.bs-hud').classList.contains('cvd'), fx: !!OV.FX.reduceMotion }));
  log(rm.rm && rm.fx, 'prefers-reduced-motion: HUD .rm e FX sem tremor');
  log(rm.cvd, 'paleta cvd ligada no HUD');
  await page.keyboard.press('e');
  await sleep(100);
  const anim = await page.evaluate(() => { const m = document.querySelector('.bs-menu'); return m ? getComputedStyle(m).animationName : 'none'; });
  log(anim === 'none', 'menu sem animação: ' + anim);
  await page.keyboard.press('Escape');
  const shake = await page.evaluate(async () => { OV.FX.shake(1); await new Promise((r) => setTimeout(r, 120)); const o = OV.FX.offset(); return Math.abs(o.x) + Math.abs(o.y); });
  log(shake === 0, 'explosão sem tremor de ecrã (offset ' + shake + ')');
  const sel = await page.evaluate(() => OV.BattleUI.debug.state().unit);
  await page.evaluate(([x, y]) => OV.BattleUI.debug.kb(x + 6, y + 2, 0), [sel.x, sel.y]);
  await sleep(200);
  await shot('cvd_reduced_path');
  await page.evaluate(() => { OV.Game.settings.palette = 'normal'; OV.BattleUI.refresh(); });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await noMissing('batalha (secretária)');
  await ctx.close();

  // =============================== G) 1024×576 (125 % de zoom) ===============================
  ctx = await browser.newContext({ viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1.25 });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  page = await ctx.newPage();
  watch(page);
  await openBattle('battle=large_scout&seed=11&month=4');
  let cov = await covered();
  log(!cov.length, '1024×576: nenhum botão tapado ' + JSON.stringify(cov));
  const clip = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-hand-name')).filter((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent));
  log(!clip.length, '1024×576: nomes das armas sem corte ' + JSON.stringify(clip));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await shot('hud_1024');
  await ctx.close();

  // =============================== F) iPad (toque) ===============================
  for (const vp of [{ width: 834, height: 1194 }, { width: 1194, height: 834 }]) {
    ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    page = await ctx.newPage();
    watch(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
    const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(140); };
    await openBattle('battle=medium_scout&seed=7');
    const tag = vp.width + 'x' + vp.height;
    cov = await covered();
    log(!cov.length, tag + ': nenhum botão do HUD tapado por outro ' + JSON.stringify(cov));
    const small = await smallTargets();
    log(!small.length, tag + ': alvos de toque ≥ 32 px ' + JSON.stringify(small));
    // toque longo num botão: etiqueta, sem carregar
    const kneel0 = (await st()).unit.kneel;
    const kb = await page.locator('.bs-grid .bs-btn').first().boundingBox();
    await touch('touchStart', [[kb.x + kb.width / 2, kb.y + kb.height / 2]]);
    await sleep(700);
    const lp = await page.locator('.bs-lp').innerText().catch(() => '');
    await shot('ipad_longpress_' + tag);
    await touch('touchEnd', []);
    await sleep(300);
    s = await st();
    log(/Ajoelhar/.test(lp) && s.unit.kneel === kneel0, tag + ': toque longo mostra «' + lp.replace(/\n/g, ' ') + '» e não ajoelha');
    // andar com dois toques e não ficar com caminho fantasma
    const me = s.unit;
    const tp = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [me.x + 2, me.y + 1]);
    await tap(tp.x, tp.y);
    s = await st();
    log(s.lock >= 0 && /Toque de novo/.test(s.pathLabel || ''), tag + ': 1.º toque mostra o caminho «' + s.pathLabel + '»');
    await tap(tp.x, tp.y);
    await idle();
    s = await st();
    log(!s.pathLabel && !s.hover, tag + ': depois de andar não fica caminho «fantasma» (' + s.pathLabel + ')');
    await shot('ipad_hud_' + tag);
    if (vp.width < vp.height) {
      // fim de turno pelo botão (toque) e banner do turno alienígena
      const eb = await page.locator('.bs-end').boundingBox();
      await page.evaluate(() => { OV.Game.settings.confirmEndTurn = false; });
      await tap(eb.x + eb.width / 2, eb.y + eb.height / 2);
      let hurry = '';
      for (let k = 0; k < 60 && !hurry; k++) {
        hurry = await page.evaluate(() => { const h = document.querySelector('.bs-hidden.on .bs-hidden-hurry'); return h ? h.textContent : ''; });
        if (!hurry) await sleep(100);
      }
      log(hurry === 'Toque para acelerar', tag + ': turno alienígena diz «' + hurry + '»');
      await idle(90000);
      s = await st();
      log(!s.pathLabel, tag + ': início do turno sem caminho fantasma');
    }
    await noMissing('iPad ' + tag);
    await ctx.close();
  }

  // =============================== H) «Equipar» e kit médico ===============================
  for (const vp of [{ width: 1440, height: 900, host: 'inset: 40px 60px' }, { width: 1024, height: 700, host: 'inset: 20px' }, { width: 834, height: 1194, host: 'inset: 10px' }]) {
    ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    page = await ctx.newPage();
    watch(page);
    await openBattle('battle=medium_scout&seed=7');
    const tag = vp.width + 'x' + vp.height;
    await page.evaluate((hostCss) => {
      const B = OV.Game.B;
      const host = document.createElement('div');
      host.id = 'eqhost';
      host.setAttribute('style', 'position:fixed;' + hostCss + ';z-index:30;padding:12px;background:#070c12;border:1px solid #2a4560;display:flex');
      document.body.appendChild(host);
      const squad = B.units.filter((u) => u.side === 'xcom').slice(0, 6).map((u, k) => ({
        id: 's' + k, name: u.name, rank: u.rank, stats: Object.assign({}, u.stats, k === 0 ? { str: 20 } : {}), armour: u.armourId, portraitSeed: u.portraitSeed, female: u.female, nat: u.nat,
        loadout: { R: null, L: null, belt: [], pack: [] },
      }));
      OV.Game.G = { researched: [] };
      window.__eq = OV.InventoryUI.equipScreen(host, {
        squad, night: true,
        stores: { plasma_pistol: 2, plasma_pistol_clip: 4, heavy_cannon: 1, hc_ap: 3, rocket_launcher: 1, small_rocket: 4, rifle: 4, rifle_clip: 12, grenade: 6, electro_flare: 6, medikit: 1, hc_he: 2 },
        onChange: () => {},
      });
      window.__eq.root.style.flex = '1';
    }, vp.host);
    await sleep(200);
    const btn = await page.evaluate(() => Array.from(document.querySelectorAll('#eqhost .eq-btns .btn')).map((b) => ({ t: b.textContent, over: b.scrollWidth > b.clientWidth + 1, r: b.getBoundingClientRect().toJSON() })));
    const overlap = btn.some((a, i) => btn.some((b, j) => j > i && a.r.left < b.r.right - 1 && b.r.left < a.r.right - 1 && a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1));
    log(btn.length === 4 && btn.every((b) => !b.over) && !overlap, tag + ': botões Copiar/Colar/Auto-equipar/Esvaziar sem corte nem sobreposição ' + JSON.stringify(btn.map((b) => b.t + (b.over ? '!' : ''))));
    const zero = await page.evaluate(() => ['.eq-squad', '.inv-doll', '.eq-stores'].map((q) => { const n = document.querySelector('#eqhost ' + q); const r = n ? n.getBoundingClientRect() : null; return q + ':' + (r ? Math.round(r.width) + '×' + Math.round(r.height) : '-'); }));
    log(zero.every((z) => !/×0$|:-$/.test(z)), tag + ': equipa, boneco e armazém visíveis ' + JSON.stringify(zero));
    const handOk = await page.evaluate(() => {
      const h = document.querySelector('#eqhost [data-drop="slot:R"]');
      const r = h.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!e && h.contains(e);
    });
    log(handOk, tag + ': a mão direita não fica por baixo do armazém');
    await page.locator('#eqhost [data-act="auto"]').click();
    let es = await page.evaluate(() => window.__eq.state());
    log(es.loadouts.s0.R && es.loadouts.s0.R !== 'plasma_pistol' && es.loadouts.s0.R !== 'heavy_cannon', tag + ': auto-equipar (Força 20) não dá armas por investigar nem pesadas: ' + es.loadouts.s0.R);
    const unk = await page.locator('#eqhost .inv-it.unk').count();
    log(unk > 0, tag + ': objetos por investigar assinalados no armazém (' + unk + ')');
    await page.locator('#eqhost [data-act="clear"]').click();
    // teclado: setas até ao armazém, Enter apanha, setas até à mão, Enter pousa
    await page.mouse.move(2, 2);
    await page.keyboard.press('ArrowDown');
    let moved = false;
    const focusKey = () => page.evaluate(() => {
      const n = document.querySelector('#eqhost .kfocus');
      if (!n) return '';
      const r = n.getBoundingClientRect();
      return n.dataset.src || n.dataset.drop || n.dataset.act || n.className + '@' + Math.round(r.left) + ',' + Math.round(r.top);
    });
    // anda para baixo; quando não mexe, para o lado (armazém à direita em paisagem, por baixo em retrato)
    let prevF = '';
    const trail = [];
    for (let k = 0; k < 50 && !moved; k++) {
      await page.keyboard.press('ArrowDown');
      let f = await focusKey();
      if (f === prevF) {
        await page.keyboard.press('ArrowRight');
        f = await focusKey();
      }
      prevF = f;
      trail.push(f.split('@')[0]);
      if (f === 'st:rifle') moved = true;
      else if (f.startsWith('st:')) {
        // dentro do armazém: sobe até ao topo e desce até à espingarda
        for (const dir of ['ArrowUp', 'ArrowDown']) {
          for (let j = 0; j < 20 && !moved; j++) {
            await page.keyboard.press(dir);
            const g = await focusKey();
            trail.push(g.split('@')[0]);
            if (g === 'st:rifle') moved = true;
          }
        }
        break;
      }
    }
    await page.keyboard.press('Enter');
    const picked = await page.evaluate(() => { const n = document.querySelector('#eqhost .inv-it.picked'); return n ? n.dataset.src.slice(3) : null; });
    let dropped = false;
    prevF = '';
    for (let k = 0; k < 50 && picked && !dropped; k++) {
      const f = await focusKey();
      if (f === 'slot:R' || f === 'slot:L') {
        await page.keyboard.press('Enter');
        dropped = true;
      } else {
        await page.keyboard.press(f === prevF ? 'ArrowUp' : 'ArrowLeft');
        prevF = f;
      }
    }
    es = await page.evaluate(() => window.__eq.state());
    log(picked === 'rifle' && dropped && (es.loadouts.s0.R === picked || es.loadouts.s0.L === picked), tag + ': teclado apanha do armazém e pousa na mão (' + JSON.stringify(es.loadouts.s0) + ')');
    await shot('equip_' + tag);
    await page.evaluate(() => { window.__eq.destroy(); document.getElementById('eqhost').remove(); OV.Game.G = null; });
    if (vp.width === 1440) {
      // kit médico sem feridas: o motivo vai por baixo do título, nada sai da caixa
      await page.evaluate(() => {
        const B = OV.Game.B;
        const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
        const it = OV.BUnits.newItem(B, 'medikit');
        if (u.items.L !== null) { const o = u.items.L; OV.BUnits.takeFromUnit(u, o); OV.BUnits.giveItem(B, u, o, 'pack', true); }
        OV.BUnits.giveItem(B, u, it.id, 'L', true);
        OV.InventoryUI.medikit(B, u.id, it.id, {});
      });
      await sleep(400);
      const medk = await page.evaluate(() => Array.from(document.querySelectorAll('.medk-b')).map((b) => ({ over: b.scrollWidth > b.clientWidth + 1, why: (b.querySelector('small.bad') || {}).textContent || '' })));
      log(medk.length === 3 && medk.every((m) => !m.over) && medk.some((m) => /feridas/.test(m.why)), 'kit médico: motivo por baixo do título, sem transbordar ' + JSON.stringify(medk));
      await shot('medikit');
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  }
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
