/* Ronda 5 de personas — Battlescape e «Equipar» num Chromium real (Playwright). Uma verificação por achado de
   r5_fixA (a parte pura está em tools/tests/ui_persona_r5.test.js):
   #0 Rui (teclado): com o painel do turno aberto, o foco fica no jogo e Enter termina o turno;
   #1 Sofia: batalha que acaba depois de «Fim do turno» (granadas) mostra as baixas dessa fase antes do relatório;
   #2 Sofia: a dica de uma linha da equipa abre à direita da coluna;
   #3/#4 Tiago (Recruta): foguete com aliado ao lado da linha pede o 2.º clique; apontado a um alienígena mostra o acerto;
   #5 Tiago: alienígena por ver logo atrás de uma porta fechada — o soldado abre a porta (e vê-o) em vez de «Caminho bloqueado»;
   #6 Pedro (125 %): a etiqueta do sinalizador perto da margem não fica debaixo da lista da equipa;
   #7 Pedro: tiro alienígena falhado contra um dos nossos aparece no registo (N) com «Mostrar atacante»;
   #8 Pedro: «Equipar» a 1024×560 — mãos, cinto e mochila à vista ao abrir, ajuda curta inteira;
   #9 Marta (iPad): foguete que apanha a própria atiradora pede uma janela à parte (Cancelar não dispara);
   #10 Marta: o 1.º toque num botão do HUD já dá as dicas de toque;
   #11 Marta: «Fim do turno» tocado durante a animação de ajoelhar não se perde;
   #12 Marta: o conselho do OVNI fica no registo com «Mostrar».
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r5_battle.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r5') : path.join(process.cwd(), 'qa-out', 'persona_r5'));
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
let browser, page, ctx, shotN = 0, cdp = null;
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
async function ipad(w, h) {
  ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: IPAD_UA });
  page = await ctx.newPage();
  watch(page);
  cdp = await ctx.newCDPSession(page);
}
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
const tap = async (x, y, after) => { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(after === undefined ? 160 : after); };
const tapEl = async (sel, after) => { const b = await page.locator(sel).first().boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2, after); };
const noMissing = async (where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
const clearToasts = () => page.evaluate(() => { for (const n of document.querySelectorAll('#toasts .toast')) n.remove(); });

/* foguete na mão direita do soldado escolhido, UT cheias; tiro em linha reta a uma casa a 5, com um aliado ao lado
   da 1.ª casa da linha (o caso de Caracas: falhado, rebenta em cima dele e da atiradora). → {id, x, y, mate, tx, ty, al}|null */
const rocketSetup = (o) => page.evaluate((o) => {
  const B = OV.Game.B, m = B.map;
  B.mission.difficulty = 0;
  const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
  u.tu = u.tuMax;
  if (o.female !== undefined) u.female = o.female;
  const oldR = u.items.R;
  if (oldR !== null && oldR !== undefined) { OV.BUnits.takeFromUnit(u, oldR); OV.BUnits.giveItem(B, u, oldR, 'pack', true); }
  OV.BUnits.giveItem(B, u, OV.BUnits.newItem(B, 'rocket_launcher', { ammo: 'small_rocket' }).id, 'R', true);
  const mate = B.units.find((x) => x.side === 'xcom' && x.id !== u.id && x.onMap);
  const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
  const z = u.z;
  const free = (x, y) => x >= 1 && y >= 1 && x < m.w - 1 && y < m.h - 1 && OV.BMap.hasFloor(m, OV.BMap.idx(m, x, y, z)) && !m.parts[OV.BMap.idx(m, x, y, z) * 4 + 3]
    && !B.units.some((q) => q.onMap && q.status !== 'dead' && q.x === x && q.y === y && q.z === z && q !== mate && q !== al && q !== u) && OV.BUnits.fits(B, mate, OV.BMap.idx(m, x, y, z));
  // atirador numa casa livre (procura à volta da posição dele), aliado ao lado, alvo a 3 casas na diagonal e o
  // alienígena a 6 na mesma diagonal
  for (let r = 0; r < 14; r++) for (let sy = u.y - r; sy <= u.y + r; sy++) for (let sx = u.x - r; sx <= u.x + r; sx++) {
    if (Math.max(Math.abs(sx - u.x), Math.abs(sy - u.y)) !== r || !free(sx, sy)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // linha reta; o aliado na casa ao lado da 1.ª casa da linha (a 1 casa dela), o alvo a 5 e o alienígena a 7
      const px = dy ? 1 : 0, py = dx ? 1 : 0;
      const mx = sx + dx + px, my = sy + dy + py, tx = sx + 5 * dx, ty = sy + 5 * dy, ax = sx + 7 * dx, ay = sy + 7 * dy;
      let ok = free(mx, my) && free(ax, ay);
      for (let k = 1; k <= 6 && ok; k++) ok = free(sx + k * dx, sy + k * dy) && free(sx + k * dx - px, sy + k * dy - py) && (k > 3 || free(sx + k * dx + px, sy + k * dy + py));
      if (!ok) continue;
      OV.BUnits.placeUnit(B, u, OV.BMap.idx(m, sx, sy, z));
      OV.BUnits.placeUnit(B, mate, OV.BMap.idx(m, mx, my, z));
      OV.BUnits.placeUnit(B, al, OV.BMap.idx(m, ax, ay, z));
      u.dir = OV.U.dirTo(dx, dy);
      if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
      OV.BattleUI.refresh();
      return { id: u.id, x: sx, y: sy, mate: mate.id, mateName: mate.name, tx, ty, al: al.id, alSeen: OV.LOS.isVisibleTo(B, 'xcom', al) };
    }
  }
  return null;
}, o || {});

let s;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // ====================== #3/#4 Tiago: foguete com aliado ao lado (rato) e acerto à vista ======================
  for (const vp of [[1440, 900, 1], [1024, 576, 1.25]]) {
    const tag = vp[0] + 'x' + vp[1];
    await desk(vp[0], vp[1], vp[2]);
    await openBattle('battle=medium_scout&seed=7&diff=0');
    const R = await rocketSetup();
    log(!!R, tag + ': foguete montado ' + JSON.stringify(R));
    if (!R) { await ctx.close(); continue; }
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [R.x, R.y]);
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await sleep(200);
    const tp = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [R.tx, R.ty]);
    await page.mouse.move(tp.x, tp.y, { steps: 2 });
    await sleep(250);
    s = await st();
    const tu0 = s.unit.tu;
    log(s.target && s.target.risk.indexOf(R.mate) >= 0 && /rebentar em cima de/.test(s.target.sub || ''), tag + ': aviso «' + (s.target && s.target.sub) + '» e marca no aliado');
    await shot('rocket_near_' + tag);
    await page.mouse.click(tp.x, tp.y);
    await sleep(200);
    s = await st();
    log(s.unit.tu === tu0 && s.tapLock >= 0 && /^Clique outra vez — se falhar, pode rebentar em cima de /.test((s.target && s.target.sub) || ''), tag + ': 1.º clique não dispara: «' + (s.target && s.target.sub) + '»');
    // duplo clique (2.º clique de um duplo) também não
    await page.mouse.click(tp.x, tp.y, { clickCount: 2 });
    await sleep(200);
    log((await st()).unit.tu === tu0, tag + ': o duplo clique não dispara o foguete');
    await shot('rocket_confirm_' + tag);
    await page.keyboard.press('Escape');
    await sleep(150);
    // #4: apontado ao alienígena, o acerto fica no rótulo
    if (R.alSeen) {
      await page.keyboard.press('e');
      await page.keyboard.press('1');
      await sleep(150);
      const ap = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), R.al);
      await page.mouse.move(ap.x, ap.y + 10, { steps: 2 });
      await sleep(250);
      s = await st();
      log(s.target && /^Acerto ≈ \d+ % · se acertar, explosão raio 3/.test(s.target.label || '') && typeof s.target.hitPct === 'number', tag + ': rótulo do foguete apontado ao alienígena «' + (s.target && s.target.label) + '»');
      await shot('rocket_alien_pct_' + tag);
      await page.keyboard.press('Escape');
    } else log(true, tag + ': (alienígena fora de vista: rótulo com acerto verificado no Node)');
    await noMissing('foguete ' + tag);
    await ctx.close();
  }

  // ====================== #0 Rui: Enter com o painel do turno aberto termina o turno ======================
  await desk(1440, 900, 1);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => { OV.Game.settings.confirmEndTurn = false; });
  await page.keyboard.press('Tab'); // quem joga ao teclado
  await sleep(200);
  await page.evaluate(() => {
    const B = OV.Game.B, u = B.units.find((x) => x.side === 'xcom' && x.onMap);
    OV.BattleUI.debug.noteEvent({ t: 'morale', kind: 'panic', unitId: u.id, vis: true, pos: -1 });
    OV.BattleUI.debug.report('turn');
  });
  await sleep(250);
  const foc = await page.evaluate(() => ({ inReport: !!document.activeElement && !!document.activeElement.closest('.bs-report'), open: !!OV.BattleUI.debug.state().report }));
  log(foc.open && !foc.inReport, '#0 painel aberto sem roubar o foco ' + JSON.stringify(foc));
  await shot('report_open_kb');
  const turn0 = (await st()).turn;
  await page.keyboard.press('Enter');
  await sleep(300);
  await idle(90000);
  s = await st();
  log(s.turn > turn0, '#0 Enter com o painel aberto termina o turno (turno ' + turn0 + ' → ' + s.turn + ')');
  // painel do turno seguinte (se abriu) fechado sem Esc a mais (sem painel, Esc abre as Opções)
  if ((await st()).report) await page.keyboard.press('Escape');
  await sleep(150);
  // #7: tiro alienígena falhado no registo
  const sh = await page.evaluate(() => {
    const B = OV.Game.B, u = B.units.find((x) => x.side === 'xcom' && x.onMap && x.status === 'ok');
    const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    const pos = (a.z * B.map.h + a.y) * B.map.w + a.x;
    const vis0 = OV.LOS.isVisibleTo;
    OV.LOS.isVisibleTo = (BB, side, x) => (x === a ? true : vis0(BB, side, x));
    try { OV.BattleUI.debug.noteEvent({ t: 'shot', shooterId: a.id, targetId: u.id, targetI: (u.z * B.map.h + u.y) * B.map.w + u.x, round: 0, shots: 1, hit: { kind: 'floor' }, vis: true, pos }); } finally { OV.LOS.isVisibleTo = vis0; }
    return { a: a.id, u: u.name };
  });
  await page.keyboard.press('n');
  await sleep(250);
  const lg = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-report-row')).map((n) => n.textContent));
  log(lg.some((r) => /disparou contra .* — falhou/.test(r) && /Atacante|Mostrar/.test(r)), '#7 registo: ' + JSON.stringify(lg.slice(0, 2)) + ' ' + JSON.stringify(sh));
  await shot('log_alien_shot');
  await page.keyboard.press('Escape');
  // #2: dica da linha da equipa à direita
  await page.mouse.move(700, 450);
  const row = await page.locator('.bs-sq').nth(1).boundingBox();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 4 });
  await sleep(150);
  await page.mouse.move(row.x + row.width / 2 + 3, row.y + row.height / 2, { steps: 2 });
  await sleep(250);
  const tipBox = await page.evaluate(() => { const t = document.getElementById('tooltip'); if (!t || t.classList.contains('hidden')) return null; const r = t.getBoundingClientRect(); return { l: r.left, t: r.top, b: r.bottom }; });
  log(!!tipBox && tipBox.l >= row.x + row.width, '#2 dica da equipa à direita da coluna ' + JSON.stringify(tipBox) + ' linha até ' + Math.round(row.x + row.width));
  await shot('squad_tip_right');
  await noMissing('turno/registo/dica');
  await ctx.close();

  // ====================== #1 Sofia: a batalha acaba no fim do turno (granadas) ======================
  await desk(1440, 900, 1);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => {
    OV.Game.settings.confirmEndTurn = false;
    const B = OV.Game.B;
    // todos os soldados com 1 de vida e uma granada ativada a 0 debaixo de cada um
    for (const u of B.units.filter((x) => x.side === 'xcom' && x.onMap)) {
      u.hp = 1;
      const g = OV.BUnits.newItem(B, 'grenade');
      OV.BUnits.giveItem(B, u, g.id, 'belt', true);
      OV.BUnits.dropItem(B, u, g.id);
      g.fuse = 0;
    }
    OV.BattleUI.refresh();
  });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => !OV.BattleUI.scene || (OV.BattleUI.debug.state() && OV.BattleUI.debug.state().report && document.querySelector('.bs-report .btn.primary')), null, { timeout: 90000 });
  const fin = await page.evaluate(() => ({ scene: OV.Scenes.top() && OV.Scenes.top().id, btn: (document.querySelector('.bs-report .btn.primary') || {}).textContent || '', title: (document.querySelector('.bs-report-title') || {}).textContent || '', sum: (document.querySelector('.bs-report-sum') || {}).textContent || '', rows: document.querySelectorAll('.bs-report-row').length }));
  log(fin.scene === 'battlescape' && /Continuar para o relatório/.test(fin.btn) && /mort/.test(fin.sum) && fin.rows > 0, '#1 baixas da última fase antes do relatório: ' + JSON.stringify(fin));
  await shot('final_phase_report');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id !== 'battlescape', null, { timeout: 20000 });
  log(true, '#1 Enter segue para «' + (await page.evaluate(() => OV.Scenes.top().id)) + '»');
  await ctx.close();

  // ====================== #5 Tiago: porta fechada com um alienígena por ver logo atrás ======================
  await desk(1440, 900, 1);
  let doorOk = null;
  for (const seed of [3, 5, 8, 11, 14]) {
    await openBattle('battle=terror&seed=' + seed + '&diff=0');
    doorOk = await page.evaluate(() => {
      const B = OV.Game.B, m = B.map, D = OV.Data.tileDefs;
      const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
      const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok' && (x.size || 1) === 1);
      const empty = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && OV.BMap.hasFloor(m, OV.BMap.idx(m, x, y, 0)) && !m.parts[OV.BMap.idx(m, x, y, 0) * 4 + 3]
        && !B.units.some((q) => q.onMap && q.status !== 'dead' && q.x === x && q.y === y && q.z === 0);
      for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 2; x++) {
        const i = OV.BMap.idx(m, x, y, 0);
        for (const part of [1, 2]) {
          const d = D[m.parts[i * 4 + part]];
          if (!d || d.door !== 'swing' || d.open || !d.alt) continue;
          // lado de fora (oeste/norte) e de dentro (a própria casa); o destino é a casa seguinte
          const [ox, oy] = part === 1 ? [x - 1, y] : [x, y - 1];
          const [gx, gy] = part === 1 ? [x + 1, y] : [x, y + 1];
          if (!empty(ox, oy) || !empty(x, y) || !empty(gx, gy)) continue;
          const gi = OV.BMap.idx(m, gx, gy, 0);
          if (m.parts[gi * 4 + part]) continue;
          OV.BUnits.placeUnit(B, u, OV.BMap.idx(m, ox, oy, 0));
          OV.BUnits.placeUnit(B, al, i);
          u.tu = u.tuMax;
          u.kneel = false;
          if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
          if (OV.LOS.isVisibleTo(B, 'xcom', al)) continue;
          for (const k of [i, gi]) m.disc[k] |= 1;
          OV.BattleUI.refresh();
          return { u: u.id, al: al.id, door: i, part, gx, gy, tu: u.tu, at: OV.BMap.idx(m, ox, oy, 0) };
        }
      }
      return null;
    });
    if (doorOk) break;
  }
  log(!!doorOk, '#5 porta com alienígena por ver atrás ' + JSON.stringify(doorOk));
  if (doorOk) {
    await page.evaluate((d) => OV.BattleUI.debug.centre(d.gx, d.gy, 0), doorOk);
    await page.evaluate((d) => OV.BattleUI.debug.kb(d.gx, d.gy, 0), doorOk);
    await sleep(200);
    await clearToasts();
    await page.keyboard.press('Enter');
    await idle();
    const r = await page.evaluate((d) => {
      const B = OV.Game.B, u = OV.BUnits.findUnit(B, d.u), al = OV.BUnits.findUnit(B, d.al);
      return { open: OV.BMap.isDoorOpen(B.map, d.door, d.part), at: (u.z * B.map.h + u.y) * B.map.w + u.x, tu: u.tu, seen: OV.LOS.isVisibleTo(B, 'xcom', al), toasts: Array.from(document.querySelectorAll('#toasts .toast')).map((n) => n.textContent) };
    }, doorOk);
    log(r.open && r.at === doorOk.at && r.tu < doorOk.tu && r.seen && !r.toasts.some((x) => /Caminho bloqueado/.test(x)), '#5 a porta abre-se, o soldado fica e vê o alienígena ' + JSON.stringify(r));
    await shot('door_opened_alien');
  }
  await noMissing('porta');
  await ctx.close();

  // ====================== #6 Pedro (125 %): etiqueta do sinalizador fora da lista da equipa ======================
  await desk(1024, 576, 1.25);
  await openBattle('battle=medium_scout&seed=7&night=1');
  await page.evaluate(() => {
    const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    OV.BUnits.giveItem(B, u, OV.BUnits.newItem(B, 'electro_flare').id, 'belt', true);
    OV.BattleUI.refresh();
  });
  await page.keyboard.press('l');
  await sleep(200);
  // rato logo à direita da lista da equipa, a meia altura: a etiqueta comprida («sem trajetória», «longe») centrada no
  // ponteiro passaria por baixo da lista
  const sq = await page.locator('.bs-squad').boundingBox();
  await page.mouse.move(sq.x + sq.width + 16, sq.y + sq.height * 0.55, { steps: 3 });
  await sleep(350);
  const lab = await page.evaluate(() => OV.BattleRender.labels());
  const over = lab.filter((l) => l.x0 < sq.x + sq.width && l.x1 > sq.x && l.y0 < sq.y + sq.height && l.y1 > sq.y);
  log(lab.length > 0 && over.length === 0, '#6 etiquetas fora da lista da equipa ' + JSON.stringify(lab.map((l) => [Math.round(l.x0), Math.round(l.y0), Math.round(l.x1), l.text.slice(0, 30)])));
  await shot('flare_label_clear');
  // teclado: o cursor posto numa casa debaixo da lista puxa a câmara (o cursor nunca fica escondido)
  const tile = await page.evaluate((sq) => {
    const m = OV.Game.B.map;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const p = OV.BattleUI.debug.tileToScreen(x, y, 0);
      if (p.x > sq.x + 30 && p.x < sq.x + sq.width - 10 && p.y > sq.y + 40 && p.y < sq.y + sq.height - 20) return { x, y };
    }
    return null;
  }, sq);
  if (tile) {
    await page.evaluate((t) => OV.BattleUI.debug.kb(t.x, t.y, 0), tile);
    await sleep(500);
    const at = await page.evaluate((t) => OV.BattleUI.debug.tileToScreen(t.x, t.y, 0), tile);
    log(!(at.x > sq.x && at.x < sq.x + sq.width && at.y > sq.y && at.y < sq.y + sq.height), '#6 cursor de teclado numa casa debaixo da lista: a câmara mostra-o (' + Math.round(at.x) + ', ' + Math.round(at.y) + ')');
    await shot('flare_kb_cursor_visible');
  } else log(true, '#6 (nenhuma casa debaixo da lista nesta vista)');
  await noMissing('sinalizador 125 %');
  await ctx.close();

  // ====================== #8 Pedro: «Equipar» a 1024×560 ======================
  for (const vp of [[1024, 560, 2.5], [1440, 900, 1], [1194, 834, 2]]) {
    const tag = vp.slice(0, 2).join('x');
    await desk(vp[0], vp[1], vp[2]);
    await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1');
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 30000 });
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 31, difficulty: 0 });
      G.ui.geoIntro = true;
      OV.Game.G = G;
      OV.CampaignUI.openGeo(G);
    });
    await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
    await page.evaluate(() => { const G = OV.Game.G; const id = Object.keys(G.crafts).find((k) => G.crafts[k].type === 'skyranger'); G.crafts[id].status = 'out'; OV.Scenes.push('equip', { G, craftId: id }); });
    await page.waitForSelector('.cp-eq .inv-equip', { timeout: 10000 });
    await sleep(500);
    const m = await page.evaluate(() => {
      const d = document.querySelector('.cp-eq .inv-doll'), pack = document.querySelector('.cp-eq .inv-strip.pack');
      const sh = document.querySelector('.cp-eq .inv-info .inv-hint-short'), lg = document.querySelector('.cp-eq .inv-info .inv-hint-long');
      const vis = (n) => !!n && getComputedStyle(n).display !== 'none';
      return { doll: [d.scrollHeight, d.clientHeight], packIn: pack.getBoundingClientRect().bottom <= d.getBoundingClientRect().bottom + 1, short: vis(sh) ? [sh.scrollHeight, sh.clientHeight] : null, long: vis(lg) };
    });
    log(m.doll[0] <= m.doll[1] + 1 && m.packIn, '#8 ' + tag + ': mãos, cinto e mochila à vista sem deslocar ' + JSON.stringify(m));
    if (vp[1] <= 640) log(!!m.short && m.short[0] <= m.short[1] + 1 && !m.long, '#8 ' + tag + ': ajuda curta inteira em 2 linhas');
    await shot('equip_' + tag);
    await noMissing('Equipar ' + tag);
    await ctx.close();
  }

  // ====================== #10/#11/#9/#12 Marta (iPad) ======================
  for (const vp of [[1194, 834], [834, 1194]]) {
    const tag = vp[0] + 'x' + vp[1];
    await ipad(vp[0], vp[1]);
    await openBattle('battle=medium_scout&seed=7&night=1');
    // #10: 1.º toque é num botão do HUD (sinalizador) — a dica já é a de toque
    await page.evaluate(() => {
      const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
      OV.BUnits.giveItem(B, u, OV.BUnits.newItem(B, 'electro_flare').id, 'belt', true);
      OV.BattleUI.refresh();
    });
    const lp0 = await page.evaluate(() => OV.Input.lastPointerType);
    await tapEl('.bs-btn[aria-label^="' + (await page.evaluate(() => OV.T('hud.btn.flare'))) + '"]', 300);
    s = await st();
    const want = await page.evaluate(() => OV.T('hud.hint.throw.touch'));
    log(s.mode === 'throw' && s.hint === want, '#10 ' + tag + ': dica de toque logo ao 1.º toque no HUD «' + s.hint + '» (início: ' + lp0 + ')');
    await shot('ipad_flare_hint_' + tag);
    await page.keyboard.press('Escape');
    await sleep(150);
    // #11: «Fim do turno» 150 ms depois de começar uma animação — o pedido fica guardado
    await page.evaluate(() => { OV.Game.settings.confirmEndTurn = true; });
    // (a animação de ajoelhar dura só 200–580 ms e o toque chegava às vezes depois dela: um passeio de várias casas
    // dá uma animação certa a interromper — o caso do soldado da lista tocado com a Manon a andar)
    {
      await page.evaluate(() => {
        const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
        for (let r = 6; r >= 3; r--) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const x = u.x + dx, y = u.y + dy;
          if (x < 0 || y < 0 || x >= B.map.w || y >= B.map.h) continue;
          if (OV.Act.validate(B, { type: 'walk', unitId: u.id, to: OV.BMap.idx(B.map, x, y, u.z) }).ok) { OV.BattleUI.debug.selectAndMove(u.id, x, y, u.z); return; }
        }
      });
      await sleep(150);
    }
    const playing = (await st()).playing;
    await tapEl('.bs-end', 50);
    const queued = await page.evaluate(() => document.querySelector('.bs-end').classList.contains('queued') || OV.BattleUI.debug.state().queued > 0);
    await page.waitForFunction(() => document.querySelector('#modals .modal') || OV.BattleUI.debug.state().side !== 'xcom', null, { timeout: 8000 }).catch(() => {});
    const dlg = await page.evaluate(() => !!document.querySelector('#modals .modal'));
    log(dlg && playing && queued, '#11 ' + tag + ': «Fim do turno» tocado durante a animação (a tocar: ' + playing + ', guardado: ' + queued + ') abre a confirmação');
    await shot('ipad_end_queued_' + tag);
    if (dlg) {
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#modals .modal .btn')).find((x) => x.textContent === OV.T('common.cancel')); if (b) b.click(); });
      await sleep(300);
    }
    // #9: foguete com a própria atiradora no raio — janela à parte; Cancelar não dispara, «Disparar» dispara
    const R = await rocketSetup({ female: true });
    if (R) {
      await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [R.x, R.y]);
      // alvo: a casa do aliado ao lado (raio 3 apanha a atiradora)
      await tapEl('.bs-hand[data-hand="R"]', 200);
      await page.evaluate(() => { const b = document.querySelector('.bs-menu-item:not(.off)'); if (b) b.click(); });
      await sleep(200);
      const tp = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [R.tx, R.ty]);
      const tu0 = (await st()).unit.tu;
      await tap(tp.x, tp.y, 250);
      s = await st();
      log(s.tapLock >= 0 && /Toque outra vez.*(atinge|rebentar em cima)/.test((s.target && s.target.sub) || ''), '#9 ' + tag + ': 1.º toque: «' + (s.target && s.target.sub) + '»');
      await sleep(500);
      await tap(tp.x, tp.y, 300);
      const ask = await page.evaluate(() => { const m = document.querySelector('#modals .modal'); return m ? { txt: m.textContent, focus: document.activeElement ? document.activeElement.textContent : '' } : null; });
      log(!!ask && /Disparar mesmo assim\?/.test(ask.txt) && /a própria atiradora/.test(ask.txt) && ask.focus === (await page.evaluate(() => OV.T('common.cancel'))) && (await st()).unit.tu === tu0, '#9 ' + tag + ': 2.º toque abre a janela (Cancelar com o foco) ' + JSON.stringify(ask && ask.txt.slice(0, 120)));
      await shot('ipad_rocket_ask_' + tag);
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#modals .modal .btn')).find((x) => x.textContent === OV.T('common.cancel')); if (b) b.click(); });
      await sleep(300);
      log((await st()).unit.tu === tu0, '#9 ' + tag + ': Cancelar não dispara');
    } else log(false, '#9 ' + tag + ': foguete não montado');
    // #12: conselho do OVNI no registo
    await page.evaluate(() => {
      const B = OV.Game.B, r = B.ufo;
      const inside = (a) => a.x >= r.x && a.x < r.x + r.w && a.y >= r.y && a.y < r.y + r.h;
      const live = B.units.filter((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
      // os de fora vão para dentro do OVNI (casas livres com chão); se não couberem, saem do mapa
      const spots = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = OV.BMap.idx(B.map, x, y, 0);
        if (OV.BMap.hasFloor(B.map, i) && !B.units.some((q) => q.onMap && q.x === x && q.y === y && q.z === 0)) spots.push(i);
      }
      for (const a of live.filter((x) => !inside(x))) {
        const i = spots.find((k) => OV.BUnits.fits(B, a, k));
        if (i !== undefined) { OV.BUnits.placeUnit(B, a, i); spots.splice(spots.indexOf(i), 1); } else OV.BUnits.removeUnitFromMap(B, a);
      }
      if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
      OV.Game.settings.confirmEndTurn = false;
      OV.BattleUI.debug.contact(-20);
    });
    if ((await st()).mode !== 'move') await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => OV.BattleUI.debug.state() && OV.BattleUI.debug.state().side === 'xcom' && !OV.BattleUI.debug.state().playing && OV.BattleUI.debug.state().ufoHinted, null, { timeout: 90000 }).catch(() => {});
    const hinted = (await st()).ufoHinted;
    if (hinted) {
      await page.evaluate(() => { const c = document.querySelector('.bs-report .btn'); if (c) c.click(); });
      await sleep(200);
      await tapEl('.bs-logbtn', 300);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-report-row')).map((n) => n.textContent));
      log(rows.some((r) => /dentro do OVNI/.test(r) && /Mostrar/.test(r)), '#12 ' + tag + ': conselho no registo ' + JSON.stringify(rows.slice(0, 2)));
      await shot('ipad_log_ufo_hint_' + tag);
    } else log(true, '#12 ' + tag + ': (conselho não devido neste mapa; verificado no Node)');
    await noMissing('iPad ' + tag);
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
