/* Ronda 3 de personas — Battlescape, kit médico e «Equipar» num Chromium real (Playwright). Uma verificação por
   achado (a parte pura está em tools/tests/ui_persona_r3.test.js):
   A) «Equipar» (Rui): o carregador da arma não ocupa uma casa do cinto — arma carregada + 2 carregadores +
      granada + fumo cabe (4/4); a arma volta ao armazém com o carregador; Auto-equipar não gasta casa com ele;
   B) «Equipar a bordo» da campanha (Pedro/Marta): a 1024×560 (125 %) as mãos e o cinto veem-se ao abrir; no iPad
      (retrato e paisagem) os botões têm ≥ 32 px e, no retrato, o armazém fica com a altura que sobra;
   C) teclado (Pedro): X pede para abortar; a dica do teclado some ao fim de ~6 s e «?» volta a mostrá-la;
   D) pânico no início do turno (Pedro): secção no relatório, contagem «em pânico», linha da equipa com ícone, texto
      e aria-label; Tab avisa que os soldados em pânico não podem agir;
   E) kit médico (Pedro): ←/→ mudam de ferido, ↑/↓ de parte (marcada e aria-pressed), Tab move o foco real pelos
      botões do painel e Enter ativa o botão com foco; rodapé com as teclas;
   F) etiquetas do alvo (Pedro): do lado oposto ao atirador;
   G) iPad (Marta): lançar um sinalizador pede «Toque de novo para lançar».
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r3_battle.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r3') : path.join(process.cwd(), 'qa-out', 'persona_r3'));
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


async function openCampaignEquip() {
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 30000 });
  await page.evaluate(() => {
    const G = OV.Campaign.newCampaign({ seed: 31, difficulty: 1 });
    G.ui.geoIntro = true;
    OV.Game.G = G;
    OV.CampaignUI.openGeo(G);
  });
  await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
  await sleep(300);
  await page.evaluate(() => { const G = OV.Game.G; OV.Scenes.push('equip', { G, craftId: Object.keys(G.crafts).find((id) => G.crafts[id].type === 'skyranger') }); });
  await page.waitForSelector('.cp-eq .inv-equip', { timeout: 10000 });
  await sleep(400);
}
// partes do boneco à vista dentro da sua janela de deslocação
const dollView = () => page.evaluate(() => {
  const d = document.querySelector('.inv-doll');
  const r = (q) => { const n = document.querySelector(q); if (!n) return null; const b = n.getBoundingClientRect(); return { t: b.top, b: b.bottom }; };
  const v = d.getBoundingClientRect();
  return { top: v.top, bot: v.top + d.clientHeight, hands: r('.inv-doll .inv-handsrow'), belt: r('.inv-doll .inv-strip.belt'), pack: r('.inv-doll .inv-strip.pack'), scroll: d.scrollHeight, client: d.clientHeight };
});

let s;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) «Equipar»: carregador na arma fora do cinto ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => {
    const B = OV.Game.B;
    const host = document.createElement('div');
    host.id = 'eqhost';
    const pw = Math.min(1240, innerWidth - 28), ph = Math.min(860, innerHeight - 24);
    host.setAttribute('style', 'position:fixed;left:' + ((innerWidth - pw) / 2) + 'px;top:' + ((innerHeight - ph) / 2) + 'px;width:' + pw + 'px;height:' + ph + 'px;z-index:30;padding:12px 14px;box-sizing:border-box;background:#0a121b;display:flex');
    document.body.appendChild(host);
    const squad = B.units.filter((u) => u.side === 'xcom').slice(0, 3).map((u, k) => ({
      id: 's' + k, name: u.name, rank: u.rank, stats: Object.assign({}, u.stats, { str: 40 }), armour: 'coveralls', portraitSeed: u.portraitSeed, female: u.female, nat: u.nat,
      loadout: k === 0 ? { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'rifle_clip', 'grenade'], pack: [] } : { R: null, L: null, belt: [], pack: [] },
    }));
    OV.Game.G = null;
    window.__eq = OV.InventoryUI.equipScreen(host, { squad, researched: null, stores: { smoke_grenade: 2, rifle: 2, rifle_clip: 6, grenade: 4, electro_flare: 2 }, night: true, onChange: () => {} });
    window.__eq.root.style.flex = '1';
  });
  await sleep(250);
  const belt = () => page.evaluate(() => ({
    cells: Array.from(document.querySelectorAll('#eqhost .inv-strip.belt .inv-it')).map((n) => n.dataset.src),
    use: (document.querySelector('#eqhost .inv-strip.belt .inv-use') || {}).textContent,
    // insígnia à vista (não só no DOM)
    badge: (() => { const n = document.querySelector('#eqhost [data-drop="slot:R"] .inv-badge.ammo'); return n && n.getBoundingClientRect().width > 0 ? n.textContent : ''; })(),
    na: /na arma/i.test((document.querySelector('#eqhost .inv-strip.belt') || {}).textContent || ''),
  }));
  let b = await belt();
  log(b.cells.length === 3 && b.use === '3/4' && !b.na && b.badge === '20/20', 'cinto 3/4 sem casa «NA ARMA», arma «' + b.badge + '» ' + JSON.stringify(b));
  await page.locator('#eqhost [data-src="st:smoke_grenade"]').click();
  await page.locator('#eqhost .inv-strip.belt .inv-slotcell').first().hover();
  await sleep(100);
  const chip = await page.locator('#eqhost .inv-strip.belt > .inv-chip').textContent().catch(() => '');
  await page.locator('#eqhost .inv-strip.belt .inv-slotcell').first().click();
  await sleep(150);
  b = await belt();
  let es = await page.evaluate(() => window.__eq.state());
  log(b.use === '4/4' && es.loadouts.s0.belt.indexOf('smoke_grenade') >= 0 && !/Não cabe/.test(chip || ''), 'granada de fumo no cinto: arma carregada + 2 carregadores + granada + fumo = ' + b.use + ' ' + JSON.stringify(es.loadouts.s0));
  await shot('equip_classic_belt');
  // a arma volta ao armazém com o carregador
  await page.locator('#eqhost [data-src="lo:R:0"]').click();
  await page.locator('#eqhost .eq-stores').click({ position: { x: 20, y: 10 } });
  await sleep(150);
  es = await page.evaluate(() => window.__eq.state());
  b = await belt();
  log(es.loadouts.s0.R === null && es.stores.rifle === 3 && es.stores.rifle_clip === 7 && b.use === '4/4', 'arma ao armazém leva o carregador (armazém: ' + es.stores.rifle + ' espingardas, ' + es.stores.rifle_clip + ' carregadores; cinto ' + b.use + ')');
  // Auto-equipar: carregada + reserva + 2 granadas + sinalizador no cinto
  await page.locator('#eqhost .eq-sol').nth(1).click();
  await page.keyboard.press('a');
  await sleep(150);
  b = await belt();
  es = await page.evaluate(() => window.__eq.state());
  log(b.use === '4/4' && b.badge === '20/20' && b.cells.length === 4 && !b.na, 'Auto-equipar: «' + b.badge + '» e cinto ' + b.use + ' ' + JSON.stringify(es.loadouts.s1));
  await shot('equip_auto');
  // dica da mão diz qual carregador vai dentro
  await page.locator('#eqhost [data-src="lo:R:0"]').hover();
  await sleep(500);
  const tipT = await page.evaluate(() => (document.querySelector('.tooltip, #tooltip, .tip') || {}).textContent || '');
  log(/Carregador de Espingarda|carregador/i.test(tipT) && /não ocupa espaço/.test(tipT), 'dica da arma: «' + tipT.slice(0, 120) + '»');
  await noMissing('Equipar');
  await ctx.close();

  // =============================== B) «Equipar a bordo» em janelas baixas e no iPad ===============================
  for (const vp of [[1024, 560, 1.25, 'desk'], [1440, 900, 1, 'desk'], [834, 1194, 2, 'ipad'], [1194, 834, 2, 'ipad']]) {
    const tag = vp[0] + 'x' + vp[1];
    if (vp[3] === 'ipad') await ipad(vp[0], vp[1]); else await desk(vp[0], vp[1], vp[2]);
    await openCampaignEquip();
    const d = await dollView();
    const hb = await page.evaluate(() => { const n = document.querySelector('.cp-eq [data-drop="slot:R"] .inv-badge.ammo'); return n && n.getBoundingClientRect().width > 0 ? n.textContent : ''; });
    log(/^\d+\/\d+$/.test(hb), tag + ': arma na mão com a insígnia «' + hb + '» à vista');
    if (vp[3] === 'desk') log(d.hands && d.belt && d.hands.t >= d.top - 1 && d.belt.b <= d.bot + 1, tag + ': mãos e cinto à vista ao abrir (mãos ' + Math.round(d.hands.t) + '–' + Math.round(d.hands.b) + ', cinto até ' + Math.round(d.belt.b) + ' ≤ ' + Math.round(d.bot) + ')');
    if (vp[3] === 'ipad') {
      const hs = await page.evaluate(() => Array.from(document.querySelectorAll('.cp-eq .eq-btns .btn')).map((n) => Math.round(n.getBoundingClientRect().height)));
      log(hs.length === 4 && hs.every((h) => h >= 32), tag + ': botões do Equipar ≥ 32 px ' + JSON.stringify(hs));
      if (vp[0] < vp[1]) {
        const g = await page.evaluate(() => {
          const st = document.querySelector('.cp-eq .eq-stores').getBoundingClientRect();
          const host = document.querySelector('.cp-eq .eq-main');
          const hb = host.getBoundingClientRect();
          return { stores: Math.round(st.height), gap: Math.round(hb.bottom - (host.scrollHeight > host.clientHeight + 2 ? hb.bottom : st.bottom)), list: Math.round(document.querySelector('.cp-eq .eq-stores-list').getBoundingClientRect().height) };
        });
        log(g.stores >= 260 && g.gap <= 24, tag + ': armazém com a altura que sobra (' + g.stores + ' px, lista ' + g.list + ' px, vazio por baixo ' + g.gap + ' px)');
      }
    }
    await shot('cp_equip_' + tag);
    await noMissing('Equipar a bordo ' + tag);
    await ctx.close();
  }

  // =============================== C) teclado: X aborta; a dica do teclado some ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  await page.keyboard.press('x');
  await sleep(250);
  const mt = await page.evaluate(() => { const m = document.querySelector('#modals .modal'); return m ? m.textContent : ''; });
  log(/Abortar/i.test(mt), 'X abre a confirmação de abortar: «' + mt.replace(/\s+/g, ' ').slice(0, 90) + '»');
  await shot('abort_x');
  await page.keyboard.press('Escape');
  await sleep(200);
  s = await st();
  log(!s.ended && s.phase !== 'over', 'Esc na confirmação não aborta');
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  s = await st();
  log(/Setas: cursor/.test(s.hint), 'cursor de teclado: dica à vista «' + s.hint.slice(0, 40) + '…»');
  await sleep(6400);
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  s = await st();
  const hintOn = await page.evaluate(() => document.querySelector('.bs-hint').classList.contains('on'));
  log(!hintOn && !s.hint, 'ao fim de 6 s a dica do teclado some (mesmo a mexer o cursor)');
  await shot('kb_hint_gone');
  await page.keyboard.press('?');
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(200);
  s = await st();
  log(/Setas: cursor/.test(s.hint), '«?» volta a mostrar a dica');
  const keysheet = await page.evaluate(() => OV.T('hud.keys.20'));
  log(/^X\|Abortar/.test(keysheet), 'folha de teclas com «X · Abortar missão»');
  await ctx.close();

  // =============================== D) pânico no início do turno ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  await page.evaluate(() => {
    const B = OV.Game.B;
    OV.Game.settings.confirmEndTurn = false;
    for (const u of B.units) if (u.side === 'alien') { u.tu = 0; u.stats.tu = 0; }
    const xs = B.units.filter((u) => u.side === 'xcom' && u.onMap);
    for (const u of xs.slice(0, 3)) { u.morale = 0; u.stats.brav = 10; }
  });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => { const s = OV.BattleUI.debug.state(); return s && s.side === 'xcom' && s.turn === 2 && !s.playing; }, null, { timeout: 90000 });
  await sleep(400);
  s = await st();
  const panicked = await page.evaluate(() => OV.Game.B.units.filter((u) => u.side === 'xcom' && u.status === 'panic').map((u) => u.name));
  const rep = await page.evaluate(() => ({ sum: (document.querySelector('.bs-report-sum') || {}).textContent || '', rows: Array.from(document.querySelectorAll('.bs-report-list > div')).map((n) => n.textContent) }));
  log(panicked.length > 0 && rep.rows.some((r) => /No início do turno X-COM/.test(r)) && /em pânico/.test(rep.sum), 'relatório: «' + rep.sum + '» ' + JSON.stringify(rep.rows.slice(0, 5)) + ' (em pânico: ' + panicked.join(', ') + ')');
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-sq.panic')).map((n) => ({ txt: (n.querySelector('.bs-sq-st') || {}).textContent || '', aria: n.getAttribute('aria-label') })));
  log(rows.length === panicked.length && rows.every((r) => /⚠/.test(r.txt) && /Pânico/i.test(r.txt) && /em pânico, sem UT/.test(r.aria)), 'linhas da equipa em pânico com ícone, texto e aria ' + JSON.stringify(rows));
  await shot('panic_report');
  await page.keyboard.press('Escape');
  await sleep(150);
  await clearToasts();
  await page.keyboard.press('Tab');
  await sleep(200);
  const tt = await toastText();
  log(/em pânico não pode/.test(tt), 'Tab avisa: «' + tt + '»');
  await shot('panic_tab');
  await noMissing('pânico');
  await ctx.close();

  // =============================== E) kit médico pelo teclado ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  const med = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    u.tu = u.tuMax;
    if (u.items.L !== null && u.items.L !== undefined) { const o = u.items.L; OV.BUnits.takeFromUnit(u, o); OV.BUnits.giveItem(B, u, o, 'pack', true); }
    const kit = OV.BUnits.newItem(B, 'medikit');
    OV.BUnits.giveItem(B, u, kit.id, 'L', true);
    const mates = B.units.filter((x) => x.side === 'xcom' && x.id !== u.id && x.onMap).slice(0, 2);
    const free = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]].map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < B.map.w && y < B.map.h && OV.BUnits.fits(B, mates[0], OV.BMap.idx(B.map, x, y, u.z)) && !B.units.some((q) => q.onMap && q.x === x && q.y === y && q.z === u.z));
    mates.forEach((m, k) => { if (free[k]) OV.BUnits.placeUnit(B, m, OV.BMap.idx(B.map, free[k][0], free[k][1], u.z)); });
    u.wounds = [0, 1, 0, 0, 0, 0];
    mates[0].wounds = [0, 0, 2, 0, 1, 0];
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.InventoryUI.medikit(B, u.id, kit.id, {});
    return { id: u.id, mate: mates[0].id };
  });
  await sleep(300);
  const medState = () => page.evaluate(() => {
    const d = OV.InventoryUI.debug.state();
    const on = document.querySelector('.medk-pb.on');
    const a = document.activeElement;
    return { med: d.med, on: on ? on.dataset.part : null, pressed: on ? on.getAttribute('aria-pressed') : null, act: a && a.closest('.medk') ? (a.dataset.pid ? 'pid:' + a.dataset.pid : a.dataset.part ? 'part:' + a.dataset.part : a.dataset.act || a.className) : a ? a.tagName : null, keys: (document.querySelector('.medk-keys') || {}).textContent || '' };
  });
  let m0 = await medState();
  log(m0.med && m0.on === '1' && m0.pressed === 'true' && /←\/→ ferido · ↑\/↓ parte do corpo/.test(m0.keys), 'kit: a 1.ª ferida escolhida e marcada; rodapé «' + m0.keys.slice(0, 50) + '…»');
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  let m1 = await medState();
  log(m1.med.patientId !== m0.med.patientId && m1.on === '2', '→ muda de ferido (' + m0.med.patientId + ' → ' + m1.med.patientId + '), parte ' + m1.on);
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  let m2 = await medState();
  log(m2.on === '3' && m2.pressed === 'true' && m2.med.patientId === m1.med.patientId, '↓ muda de parte (2 → ' + m2.on + ') sem trocar de ferido');
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  m2 = await medState();
  log(m2.on === '4', '↓ outra vez: parte ' + m2.on);
  await shot('medkit_keys');
  await page.keyboard.press('Tab');
  await sleep(100);
  await page.keyboard.press('Tab');
  await sleep(100);
  const m3 = await medState();
  log(/^(pid|part|med-|medclose)/.test(m3.act || ''), 'Tab move o foco real dentro do painel: ' + m3.act);
  // foco no ferido «próprio» e Enter: escolhe esse ferido
  await page.evaluate((id) => document.querySelector('.medk [data-pid="' + id + '"]').focus(), med.id);
  await page.keyboard.press('Enter');
  await sleep(200);
  const m4 = await medState();
  log(m4.med.patientId === med.id && m4.act === 'pid:' + med.id, 'Enter ativa o botão com foco (ferido ' + m4.med.patientId + ', foco ' + m4.act + ')');
  await noMissing('kit médico');
  await ctx.close();

  // =============================== F) etiquetas do alvo do lado oposto ao atirador ===============================
  await desk(1440, 900);
  await openBattle('battle=medium_scout&seed=7');
  const aim = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const al = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    return { id: u.id, x: u.x, y: u.y, al: al.id };
  });
  const sides = [];
  for (const [dx, dy] of [[4, -4], [-4, 4]]) {
    await setUnitTiles([[aim.al, aim.x + dx, aim.y + dy, 0]]);
    await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [aim.x, aim.y]);
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await sleep(150);
    const tp = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), aim.al);
    const up = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), aim.id);
    await page.mouse.move(tp.x, tp.y, { steps: 2 });
    await sleep(250);
    s = await st();
    sides.push({ shooterRight: up.x > tp.x, labelRight: s.targetLabel ? s.targetLabel.right : null });
    await shot('target_label_' + (dx > 0 ? 'a' : 'b'));
    await page.keyboard.press('Escape');
    await sleep(100);
  }
  log(sides.length === 2 && sides.every((x) => x.labelRight !== null && x.labelRight === !x.shooterRight), 'etiquetas do alvo do lado oposto ao atirador ' + JSON.stringify(sides));
  await ctx.close();

  // =============================== G) iPad: «Toque de novo para lançar» ===============================
  await ipad(1194, 834);
  await openBattle('battle=medium_scout&seed=7&night=1');
  s = await st();
  await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    u.tu = u.tuMax;
    const f = OV.BUnits.newItem(B, 'electro_flare');
    if (!OV.BUnits.giveItem(B, u, f.id, 'belt')) OV.BUnits.giveItem(B, u, f.id, 'pack', true);
    OV.BattleUI.refresh();
  });
  await sleep(200);
  // botão «Sinalizador» do HUD (5.º da grelha: ajoelhar, inventário, recarregar, granada, sinalizador)
  const fb = await page.locator('.bs-grid .bs-btn').nth(4).boundingBox();
  await tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await sleep(250);
  await page.evaluate(([x, y]) => OV.BattleUI.debug.centre(x, y, 0), [s.unit.x, s.unit.y]);
  await sleep(150);
  const ft = await page.evaluate(([x, y]) => OV.BattleUI.debug.tileToScreen(x, y, 0), [s.unit.x + 2, s.unit.y + 2]);
  await tap(ft.x, ft.y);
  await sleep(200);
  s = await st();
  log(s.mode === 'throw' && !!s.throwInfo && /^Toque de novo para lançar/.test(s.throwInfo.label), 'iPad: «' + (s.throwInfo && s.throwInfo.label) + '»');
  await shot('ipad_flare_confirm');
  await noMissing('iPad lançar');
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
