/* Ronda 2 de personas — Battlescape, inventário e «Equipar» num Chromium real (Playwright). Uma verificação por
   achado (ver tools/tests/ui_persona_r2.test.js para a parte pura):
   A) porta (Rui/Inês): longe da porta, a dica não promete «0 UT»; ao lado mostra o custo real;
   B) explosivo com aliados no raio (Tiago): um duplo clique no alvo não dispara; um clique separado depois sim;
   C) teclado (Pedro): ↓ ← ↓ ← desce uma fila da grelha; reserva comida → etiqueta e recusa com o motivo; T sem
      cursor roda para a casa do ponteiro (Inês); registo (N) com o foco no painel, Tab chega a «Mostrar», Enter
      mostra sem terminar o turno nem mudar de soldado; «?» abre no topo (1024×576);
   D) painel do turno (Sofia/Marta): os avisos não tapam o painel; no retrato o painel não tapa a lista de soldados;
   E) iPad (Marta): dica do modo de tiro acima do HUD de baixo, sem emblemas de teclas, «toque na arma» ao tocar
      num alienígena;
   F) «Equipar» (Rui/Tiago/Marta/Pedro): arma carregada «28/28» + «Na arma», cabeçalho sem sobreposições a 1440,
      1194, 1024×576 e 834, munição largada na arma carrega-a, ⌫ devolve o objeto escolhido com o rato, toque numa
      linha do armazém guarda, Enter pousa e o foco fica no objeto, Enter numa casa ocupada recusa sem perder a
      escolha, o cartão de informação não fica por baixo do boneco;
   G) inventário de combate (Pedro): ↓ da mão direita vai para o cinto; nomes de munições do chão sem corte.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r2_battle.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r2') : path.join(process.cwd(), 'qa-out', 'persona_r2'));
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
  ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: IPAD_UA });
  page = await ctx.newPage();
  watch(page);
  cdp = await ctx.newCDPSession(page);
}
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(160); };
const noMissing = async (where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
const setUnitTiles = (pairs) => page.evaluate((list) => {
  const B = OV.Game.B;
  for (const [id, x, y, z] of list) {
    const u = OV.BUnits.findUnit(B, id);
    OV.BUnits.placeUnit(B, u, OV.BMap.idx(B.map, x, y, z || 0));
  }
  if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
  OV.BattleUI.refresh();
}, pairs);
const rectOf = (sel) => page.evaluate((q) => { const n = document.querySelector(q); if (!n) return null; const r = n.getBoundingClientRect(); return r.width > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }, sel);
const cross = (a, b) => !!a && !!b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
const toastText = () => page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((n) => n.textContent).join(' | '));
// foco virtual do teclado (inventário/Equipar): anda com as setas até ao nó `want` dentro de `scope`
const fkey = (scope) => page.evaluate((sc) => { const n = document.querySelector(sc + ' .kfocus'); if (!n) return ''; const b = n.closest('[data-drop]'); return (b ? b.dataset.drop : '') + '|' + (n.dataset.src || n.dataset.act || n.className); }, scope);
async function goTo(scope, want, max) {
  for (let k = 0; k < (max || 40); k++) {
    const r = await page.evaluate(([sc, w]) => {
      const f = document.querySelector(sc + ' .kfocus'), t = document.querySelector(sc + ' ' + w);
      if (!t) return { miss: true };
      if (f && (f === t || t.contains(f))) return { done: true };
      if (!f) return { dx: 0, dy: 1 };
      const a = f.getBoundingClientRect(), b = t.getBoundingClientRect();
      return { dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2) };
    }, [scope, want]);
    if (r.done) return true;
    if (r.miss) return false;
    const h = r.dx > 0 ? 'ArrowRight' : 'ArrowLeft', v = r.dy > 0 ? 'ArrowDown' : 'ArrowUp';
    const before = await fkey(scope);
    if (process.env.QA_TRACE) console.log('   goTo', want, before, Math.round(r.dx), Math.round(r.dy));
    // como uma pessoa: primeiro a linha (↑/↓), depois a coluna (←/→); se não mexer, o outro eixo
    const first = Math.abs(r.dy) > 30 ? v : h, second = first === v ? h : v;
    await page.keyboard.press(first);
    if ((await fkey(scope)) === before) await page.keyboard.press(second);
  }
  return false;
}
const clearToasts = () => page.evaluate(() => { for (const n of document.querySelectorAll('#toasts .toast')) n.remove(); });

let es;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) porta longe / ao lado ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  const door = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const free = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && !B.units.some((q) => q.onMap && q.x === x && q.y === y && q.z === 0) && OV.BUnits.fits(B, u, OV.BMap.idx(m, x, y, 0));
    for (let i = 0; i < m.w * m.h; i++) {
      if (!OV.BMap.isUfoDoor(m, i)) continue;
      const [x, y] = OV.BMap.xyz(m, i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!free(x + dx, y + dy) || !free(x + 3 * dx, y + 3 * dy)) continue;
        OV.BUnits.placeUnit(B, u, OV.BMap.idx(m, x + dx, y + dy, 0));
        u.tu = u.tuMax;
        const v = OV.Act.validate(B, { type: 'door', unitId: u.id, i });
        if (!v.ok) continue;
        m.disc[i] |= 7;
        return { x, y, tu: v.tu, near: [x + dx, y + dy], far: [x + 3 * dx, y + 3 * dy], id: u.id };
      }
    }
    return null;
  });
  log(!!door, 'porta de OVNI com casas livres ao lado e a 3 casas ' + JSON.stringify(door));
  if (door) {
    const hoverDoor = async () => {
      await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [door.x, door.y]);
      await sleep(150);
      const p = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [door.x, door.y]);
      await page.mouse.move(p.x - 40, p.y + 12);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await sleep(150);
      return st();
    };
    await setUnitTiles([[door.id, door.far[0], door.far[1], 0]]);
    let s = await hoverDoor();
    log(!!s.pathSub && /quando o soldado estiver ao lado/.test(s.pathSub) && !/0 UT/.test(s.pathSub), 'longe da porta: «' + s.pathSub + '» (sem «0 UT»)');
    await shot('door_far');
    await setUnitTiles([[door.id, door.near[0], door.near[1], 0]]);
    s = await hoverDoor();
    const m = /\((\d+) UT\)/.exec(s.pathSub || '');
    log(!!m && +m[1] > 0 && +m[1] === door.tu, 'ao lado da porta: «' + s.pathSub + '» = custo real ' + door.tu);
  }
  await ctx.close();

  // =============================== B) duplo clique num explosivo com aliados no raio ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
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
  await setUnitTiles([[setup.mate, setup.x + 5, setup.y + 3, 0], [setup.al, 2, 2, 0]]);
  await page.keyboard.press('q');
  await page.keyboard.press('1');
  await sleep(150);
  await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [setup.x + 3, setup.y + 2]);
  await sleep(150);
  const tp = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [setup.x + 5, setup.y + 1]);
  await page.mouse.move(tp.x, tp.y, { steps: 2 });
  await sleep(120);
  let s = await st();
  const tuB0 = s.unit.tu;
  log(s.mode === 'target' && s.target && /Risco: \d+ aliado/.test(s.target.sub || ''), 'alvo com aliados no raio: «' + (s.target && s.target.sub) + '»');
  await page.mouse.dblclick(tp.x, tp.y);
  await sleep(250);
  s = await st();
  log(s.unit.tu === tuB0 && s.tapLock >= 0 && /Clique outra vez para disparar — atinge \d+ aliado/.test((s.target && s.target.sub) || ''), 'duplo clique não dispara: «' + (s.target && s.target.sub) + '» (UT ' + s.unit.tu + ')');
  await shot('blast_dblclick');
  await sleep(450);
  await page.mouse.click(tp.x, tp.y);
  await idle();
  s = await st();
  log(s.unit.tu < tuB0, 'clique separado depois do aviso dispara (UT ' + tuB0 + ' → ' + s.unit.tu + ')');
  await ctx.close();

  // =============================== C) teclado ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  // ↓ ← ↓ ← …
  await page.keyboard.press('ArrowDown');
  s = await st();
  const k0 = s.kcur;
  const trail = [];
  for (let k = 0; k < 3; k++) {
    for (const key of ['ArrowDown', 'ArrowLeft']) {
      await page.keyboard.press(key);
      const q = (await st()).kcur;
      trail.push(q.x + ',' + q.y);
    }
  }
  const k1 = (await st()).kcur;
  log(!!k0 && k1.x === k0.x && k1.y === k0.y + 6, '↓←↓←↓←: ' + k0.x + ',' + k0.y + ' → ' + trail.join(' '));
  await page.keyboard.press('Escape');
  // reserva comida pelo destino
  await page.keyboard.press('Shift+Digit2');
  const rdest = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    u.tu = u.tuMax;
    let best = null;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const x = u.x + dx, y = u.y + dy;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h || (!dx && !dy)) continue;
      const i = OV.BMap.idx(m, x, y, u.z);
      if (!(m.disc[i] & 1)) continue;
      const wp = OV.Act.walkPreview(B, u, i, { reserveMode: B.reserve });
      if (!wp || !wp.tiles.length || wp.marks.some((k) => k === 2)) continue;
      if (wp.marks[wp.marks.length - 1] === 1 && (!best || wp.tu < best.tu)) best = { x, y, tu: wp.tu };
    }
    return best;
  });
  log(!!rdest, 'destino que come a reserva de tiro rápido ' + JSON.stringify(rdest));
  if (rdest) {
    await page.evaluate(([x, y]) => OV.BattleUI.debug.kb(x, y, 0), [rdest.x, rdest.y]);
    await sleep(150);
    s = await st();
    const resTU = +((/guardar (\d+) UT/.exec(s.pathLabel || '') || [])[1] || 0);
    log(/o soldado para antes, para guardar \d+ UT \(Tiro rápido\)/.test(s.pathLabel || '') && /F1 = sem reserva/.test(s.pathSub || ''), 'etiqueta: «' + s.pathLabel + '» / «' + s.pathSub + '»');
    await shot('kb_reserve_path');
    await clearToasts();
    await page.keyboard.press('Enter');
    await idle();
    const tt = await toastText();
    s = await st();
    log(/Parou para guardar as UT reservadas/.test(tt) && s.unit.tu >= resTU && (s.unit.x !== rdest.x || s.unit.y !== rdest.y), 'Enter: anda e para antes da reserva (UT ' + s.unit.tu + ' ≥ ' + resTU + '), aviso «' + tt + '»');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Shift+Digit1');
  // T sem cursor: roda para a casa do ponteiro
  s = await st();
  const me = s.unit;
  const face = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [me.x - 3, me.y]);
  await page.mouse.move(face.x + 3, face.y + 1);
  await page.mouse.move(face.x, face.y, { steps: 2 });
  await sleep(120);
  const want = await page.evaluate(([dx, dy]) => OV.U.dirTo(dx, dy), [-3, 0]);
  await page.keyboard.press('t');
  await idle();
  s = await st();
  log(s.unit.dir === want || me.dir === want, 'T com o rato roda para a casa do ponteiro (dir ' + me.dir + ' → ' + s.unit.dir + ', esperado ' + want + ')');
  // registo de mensagens pelo teclado
  const ids = await page.evaluate(() => {
    const B = OV.Game.B;
    const f = B.units.find((x) => x.side === 'xcom' && x.onMap && x.id !== OV.BattleUI.debug.state().selectedId);
    const a = B.units.find((x) => x.side === 'alien' && x.onMap);
    return { f: f.id, a: a.id, i: (f.z * B.map.h + f.y) * B.map.w + f.x };
  });
  await page.evaluate((o) => {
    OV.BattleUI.debug.noteEvent({ t: 'damage', unitId: o.f, attackerId: o.a, dmgType: 'AP', cause: 'shot', amount: 6, wounds: 0, vis: true, pos: o.i });
  }, ids);
  s = await st();
  const sel0 = s.selectedId, turn0 = s.turn;
  await page.keyboard.press('n');
  await sleep(150);
  const focus = () => page.evaluate(() => { const a = document.activeElement; return a && a.closest('.bs-report') ? a.textContent.trim() : a ? a.tagName : ''; });
  let f = await focus();
  log(/^Fechar/.test(f), 'N: o foco vai para «Fechar» do registo (' + f + ')');
  await page.keyboard.press('Tab');
  f = await focus();
  s = await st();
  log(/^(Mostrar|Atacante)$/.test(f) && s.selectedId === sel0 && !!s.report, 'Tab chega a «' + f + '» sem mudar de soldado');
  await page.keyboard.press('Enter');
  await sleep(300);
  s = await st();
  log(!!s.report && s.turn === turn0 && s.side === 'xcom', 'Enter em «Mostrar» centra sem fechar nem terminar o turno');
  await shot('log_keyboard');
  await page.keyboard.press('Escape');
  s = await st();
  f = await focus();
  log(!s.report && f === 'BODY', 'Esc fecha e o foco volta ao jogo (' + f + ')');
  await ctx.close();
  // folha de teclas a 1024×576
  await desk(1024, 576, 1.25);
  await openBattle('battle=medium_scout&seed=7');
  await page.keyboard.press('Shift+Slash');
  await sleep(250);
  const ks = await page.evaluate(() => {
    const box = document.querySelector('.modal.bs-keysheet');
    const row = box && box.querySelector('.bs-keys tr');
    const btn = box && box.querySelector('.modal-actions .btn');
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect(), k = btn.getBoundingClientRect();
    return { top: box.scrollTop, rowIn: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, btnIn: k.bottom <= b.bottom + 1 && k.top >= b.top, focus: document.activeElement === btn };
  });
  log(ks.top === 0 && ks.rowIn && ks.btnIn && ks.focus, '«?» abre no topo com o botão à vista e com foco ' + JSON.stringify(ks));
  await shot('keysheet_1024');
  await page.keyboard.press('Escape');
  await ctx.close();

  // =============================== D) painel do turno e avisos ===============================
  for (const vp of [[1440, 900, false], [834, 1194, true]]) {
    if (vp[2]) await ipad(vp[0], vp[1]);
    else await desk(vp[0], vp[1]);
    await openBattle('battle=medium_scout&seed=7');
    const tag = vp[0] + 'x' + vp[1];
    const o = await page.evaluate(() => {
      const B = OV.Game.B;
      const xs = B.units.filter((x) => x.side === 'xcom' && x.onMap);
      const a = B.units.find((x) => x.side === 'alien' && x.onMap);
      return { f: xs[1].id, g: xs[2].id, a: a.id, i: (xs[1].z * B.map.h + xs[1].y) * B.map.w + xs[1].x };
    });
    await page.evaluate((q) => {
      const D = OV.BattleUI.debug;
      D.noteEvent({ t: 'damage', unitId: q.g, attackerId: q.a, dmgType: 'AP', cause: 'shot', amount: 5, wounds: 0, vis: true, pos: q.i });
      D.noteEvent({ t: 'damage', unitId: q.f, attackerId: q.a, dmgType: 'PLASMA', cause: 'shot', amount: 60, wounds: 0, vis: true, pos: q.i });
      D.noteEvent({ t: 'death', unitId: q.f, killerId: q.a, cause: 'shot', i: q.i, vis: true, pos: q.i });
      D.report('turn');
      OV.Dom.toast('bs.spotted', null, 'alert');
      OV.Dom.toast('hud.log.alienKilled', { name: 'Davide Rossi', by: 'Vikram Kumar' }, 'alert');
    }, o);
    await sleep(350);
    const rep = await rectOf('.bs-report:not(.hidden)');
    const toasts = await page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    log(!!rep && toasts.length > 0 && toasts.every((t) => !cross(t, rep)), tag + ': os avisos não tapam o painel do turno');
    const sq = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-squad .bs-sq')).map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    log(sq.every((q) => !cross(q, rep)), tag + ': o painel não tapa a lista de soldados');
    const bot = await page.evaluate(() => Math.min(...['.bs-card', '.bs-console', '.bs-end'].map((q) => document.querySelector(q).getBoundingClientRect().top)));
    log(toasts.every((t) => t.b <= bot), tag + ': avisos por cima do HUD de baixo');
    await shot('report_toasts_' + tag);
    await ctx.close();
  }

  // =============================== E) iPad: dica do tiro, teclas, alienígena ===============================
  for (const vp of [[834, 1194], [1194, 834]]) {
    await ipad(vp[0], vp[1]);
    await openBattle('battle=medium_scout&seed=7');
    const tag = vp[0] + 'x' + vp[1];
    s = await st();
    const al = await page.evaluate(() => {
      const B = OV.Game.B;
      const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
      return a.id;
    });
    await setUnitTiles([[al, s.unit.x + 3, s.unit.y + 1, 0]]);
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [s.unit.x + 1, s.unit.y]);
    await sleep(200);
    const ap = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), al);
    await clearToasts();
    await tap(ap.x, ap.y);
    const tt = await toastText();
    log(/toque na arma/.test(tt) && !/Q\/E/.test(tt), tag + ': tocar num alienígena: «' + tt + '»');
    const keys = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-hud .key, .bs-hud .bs-hand-key')).filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.textContent));
    log(!keys.length, tag + ': sem emblemas de teclas no HUD ' + JSON.stringify(keys));
    // modo de tiro pela mão direita e a dica fica acima do HUD de baixo
    const hand = await page.locator('.bs-hand').nth(1).boundingBox();
    await tap(hand.x + hand.width / 2, hand.y + hand.height / 2);
    await sleep(150);
    const item = await page.locator('.bs-menu .bs-menu-item:not([disabled])').first().boundingBox().catch(() => null);
    if (item) await tap(item.x + item.width / 2, item.y + item.height / 2);
    await sleep(200);
    s = await st();
    const hint = await rectOf('.bs-hint.on');
    const bot = await page.evaluate(() => Math.min(...['.bs-card', '.bs-console', '.bs-end'].map((q) => document.querySelector(q).getBoundingClientRect().top)));
    log(s.mode === 'target' && !!hint && hint.b <= bot - 2 && /Toque no alvo/.test(s.hint), tag + ': dica «' + s.hint + '» acima do HUD (fundo ' + (hint && Math.round(hint.b)) + ' ≤ ' + Math.round(bot) + ')');
    await shot('ipad_target_hint_' + tag);
    await noMissing('iPad ' + tag);
    await ctx.close();
  }

  // =============================== F) «Equipar» ===============================
  const mountEquip = () => page.evaluate(() => {
    const B = OV.Game.B;
    const host = document.createElement('div');
    host.id = 'eqhost';
    const pw = Math.min(1240, innerWidth - 28), ph = Math.min(860, innerHeight - 24);
    host.setAttribute('style', 'position:fixed;left:' + ((innerWidth - pw) / 2) + 'px;top:' + ((innerHeight - ph) / 2) + 'px;width:' + pw + 'px;height:' + ph + 'px;z-index:30;padding:12px 14px;box-sizing:border-box;background:#0a121b;display:flex');
    document.body.appendChild(host);
    const squad = B.units.filter((u) => u.side === 'xcom').slice(0, 6).map((u, k) => ({
      id: 's' + k, name: k === 0 ? 'Alejandro Jiménez Fernández' : u.name, rank: u.rank, stats: Object.assign({}, u.stats, k === 0 ? { str: 21 } : {}), armour: 'power_suit', portraitSeed: u.portraitSeed, female: u.female, nat: u.nat,
      loadout: k === 0 ? { R: 'plasma_rifle', L: null, belt: ['plasma_rifle_clip', 'plasma_rifle_clip', 'grenade', 'electro_flare'], pack: ['medikit', 'electro_flare'] } : k === 1 ? { R: 'small_launcher', L: null, belt: [], pack: [] } : { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip'], pack: [] },
    }));
    OV.Game.G = null;
    window.__eq = OV.InventoryUI.equipScreen(host, { squad, researched: null, stores: { stun_rod: 2, small_launcher: 1, stun_bomb: 4, plasma_rifle_clip: 3, grenade: 2, smoke_grenade: 3, medikit: 1, electro_flare: 4, rifle: 2, rifle_clip: 4 }, onChange: () => {} });
    window.__eq.root.style.flex = '1';
  });
  const eqHead = () => page.evaluate(() => {
    const q = (s) => { const n = document.querySelector('#eqhost ' + s); if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const btns = Array.from(document.querySelectorAll('#eqhost .eq-btns .btn')).map((n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    return { val: q('.inv-head .inv-meter .val'), note: q('.inv-head .inv-meter-note'), meters: q('.inv-head .inv-meters'), btns, info: q('.eq-main > .inv-info'), doll: q('.inv-doll'), noteCut: (() => { const n = document.querySelector('#eqhost .inv-head .inv-meter-note'); return n ? n.scrollWidth > n.clientWidth + 1 : false; })() };
  });
  for (const vp of [[1440, 900, 1], [1194, 834, 1], [1024, 576, 1.25], [834, 1194, 1]]) {
    const tag = vp[0] + 'x' + vp[1];
    await desk(vp[0], vp[1], vp[2]);
    await openBattle('battle=medium_scout&seed=7');
    await mountEquip();
    await sleep(250);
    const h = await eqHead();
    const hit = h.btns.some((b) => cross(b, h.val) || cross(b, h.note) || cross(b, h.meters));
    log(!hit && !h.noteCut && h.val && h.val.r <= h.meters.r + 1, tag + ': peso e aviso de excesso à vista, sem botões por cima');
    if (h.info && h.info.b > h.info.t + 4) log(h.doll.b <= h.info.t + 1, tag + ': o boneco não passa por cima do cartão de informação (' + Math.round(h.doll.b) + ' ≤ ' + Math.round(h.info.t) + ')');
    const eq = await page.evaluate(() => ({
      badge: (document.querySelector('#eqhost [data-drop="slot:R"] .inv-badge.ammo') || {}).textContent || '',
      inw: Array.from(document.querySelectorAll('#eqhost .inv-strip.belt .inv-it.inweapon')).map((n) => n.dataset.src + ':' + n.textContent),
    }));
    log(eq.badge === '28/28' && eq.inw.length === 1 && /lo:belt:0/.test(eq.inw[0]) && /Na arma/i.test(eq.inw[0]), tag + ': arma na mão «' + eq.badge + '» e carregador «Na arma» ' + JSON.stringify(eq.inw));
    await shot('equip_' + tag);
    if (vp[0] === 1440) {
      // lançador vazio: munição do armazém largada na arma carrega-a
      await page.locator('#eqhost .eq-sol').nth(1).click();
      await sleep(100);
      let b = (await page.locator('#eqhost [data-drop="slot:R"] .inv-badge.ammo').textContent().catch(() => '')) || '';
      log(/Vazia/i.test(b), 'lançador sem munição mostra «' + b + '» na mão');
      await page.locator('#eqhost [data-src="st:stun_bomb"]').click();
      await page.locator('#eqhost [data-drop="slot:R"] .inv-it').hover();
      await sleep(100);
      const chip = await page.locator('#eqhost [data-drop="slot:R"] > .inv-chip').textContent().catch(() => '');
      await page.locator('#eqhost [data-drop="slot:R"] .inv-it').click();
      await sleep(120);
      es = await page.evaluate(() => window.__eq.state());
      b = (await page.locator('#eqhost [data-drop="slot:R"] .inv-badge.ammo').textContent().catch(() => '')) || '';
      log(chip === 'Carregar' && es.loadouts.s1.R === 'small_launcher' && es.loadouts.s1.belt.indexOf('stun_bomb') >= 0 && /^\d+\/\d+$/.test(b), 'bomba largada no lançador: «' + chip + '» → ' + JSON.stringify(es.loadouts.s1) + ' mão «' + b + '»');
      // ⌫ com um objeto escolhido com o rato
      await page.locator('#eqhost .eq-sol').nth(0).click();
      await page.locator('#eqhost [data-src="lo:pack:0"]').click();
      await page.keyboard.press('Backspace');
      await sleep(120);
      es = await page.evaluate(() => window.__eq.state());
      log(es.loadouts.s0.pack.indexOf('medikit') < 0 && es.stores.medikit === 2, '⌫ devolve ao armazém o kit médico escolhido com o rato ' + JSON.stringify(es.loadouts.s0.pack));
      // teclado: Enter numa casa ocupada com um objeto escolhido recusa e não perde a escolha
      await page.mouse.move(3, 3);
      await page.keyboard.press('ArrowDown');
      const g1 = await goTo('#eqhost', '[data-src="st:grenade"]');
      await page.keyboard.press('Enter');
      const picked = await page.evaluate(() => { const n = document.querySelector('#eqhost .inv-it.picked'); return n ? n.dataset.src : null; });
      const g2 = await goTo('#eqhost', '[data-src="lo:R:0"]');
      await clearToasts();
      await page.keyboard.press('Enter');
      await sleep(120);
      const still = await page.evaluate(() => { const n = document.querySelector('#eqhost .inv-it.picked'); return n ? n.dataset.src : null; });
      const tt = await toastText();
      log(g1 && g2 && picked === 'st:grenade' && still === 'st:grenade' && /Ocupad|cheia|ocupad/i.test(tt), 'Enter na mão ocupada com a granada escolhida: recusa («' + tt + '») e a granada continua escolhida');
      // pousar no cinto com Enter: o foco fica no objeto pousado (não salta para «Copiar»)
      if (still) await page.keyboard.press('Escape');
      await page.locator('#eqhost [data-src="lo:belt:3"]').click();
      await page.keyboard.press('Backspace');
      await page.mouse.move(3, 3);
      await page.keyboard.press('ArrowDown');
      const g3 = await goTo('#eqhost', '[data-src="st:grenade"]');
      await page.keyboard.press('Enter');
      const g4 = await goTo('#eqhost', '.inv-strip.belt .inv-slotcell[data-nav]');
      await page.keyboard.press('Enter');
      await sleep(120);
      const after = await fkey('#eqhost');
      es = await page.evaluate(() => window.__eq.state());
      log(g3 && g4 && es.loadouts.s0.belt.filter((t) => t === 'grenade').length === 2 && /^slot:belt\|lo:belt:3$/.test(after), 'Enter pousa a granada no cinto e o foco fica nela (' + after + ') ' + JSON.stringify(es.loadouts.s0.belt));
      await page.keyboard.press('Enter');
      const again = await page.evaluate(() => { const n = document.querySelector('#eqhost .inv-it.picked'); return n ? n.dataset.src : null; });
      es = await page.evaluate(() => window.__eq.state());
      log(again === 'lo:belt:3' && !!es.loadouts.s0.belt, 'o Enter seguinte apanha a granada pousada (não carrega em «Copiar»)');
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { window.__eq.destroy(); document.getElementById('eqhost').remove(); });
    await ctx.close();
  }
  // toque: com um objeto do soldado escolhido, tocar numa linha do armazém guarda-o
  await ipad(1194, 834);
  await openBattle('battle=medium_scout&seed=7');
  await mountEquip();
  await sleep(250);
  const pk = await page.locator('#eqhost [data-src="lo:pack:0"]').boundingBox();
  await tap(pk.x + pk.width / 2, pk.y + pk.height / 2);
  const row = await page.locator('#eqhost [data-src="st:rifle"]').boundingBox();
  await tap(row.x + row.width / 2, row.y + row.height / 2);
  es = await page.evaluate(() => window.__eq.state());
  log(es.loadouts.s0.pack.indexOf('medikit') < 0 && es.stores.medikit === 2, 'iPad: kit médico escolhido + toque na linha «Espingarda» do armazém → guardado ' + JSON.stringify(es.loadouts.s0.pack));
  await shot('equip_ipad_tap_store');
  await page.evaluate(() => { window.__eq.destroy(); document.getElementById('eqhost').remove(); });
  await ctx.close();

  // =============================== G) inventário de combate ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const t = (u.z * B.map.h + u.y) * B.map.w + u.x;
    for (const ty of ['hc_ap', 'hc_he']) {
      const it = OV.BUnits.newItem(B, ty);
      it.owner = null;
      it.at = t;
    }
    if (u.items.R === null) {
      const w = OV.BUnits.newItem(B, 'rifle', { ammo: 'rifle_clip' });
      OV.BUnits.giveItem(B, u, w.id, 'R', true);
    }
  });
  await page.keyboard.press('i');
  await sleep(300);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.inv-ground .inv-it.row .inv-nm')).filter((n) => /Canhão Pesado/.test(n.textContent)).map((n) => ({ t: n.textContent, cut: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1 })));
  log(names.length === 2 && names.every((n) => !n.cut), 'chão: munições do Canhão Pesado com o nome inteiro ' + JSON.stringify(names));
  await page.keyboard.press('ArrowDown');
  const gR = await goTo('.inv-root', '[data-drop="slot:R"] .inv-it');
  const cur = await fkey('.inv-root');
  await page.keyboard.press('ArrowDown');
  const down = await fkey('.inv-root');
  log(gR && /^slot:belt\|/.test(down), 'inventário: ↓ da mão direita vai para o cinto (' + cur + ' → ' + down + ')');
  await shot('inv_ground_names');
  await noMissing('inventário');
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
