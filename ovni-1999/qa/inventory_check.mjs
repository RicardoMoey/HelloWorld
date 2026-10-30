/* QA do inventário, do kit médico e do ecrã «Equipar» num Chromium real (Playwright). Serve /home/user/HelloWorld com
   «python3 -m http.server» numa porta livre e joga pela interface:
   A) ?battle=medium_scout&seed=7&month=1&night=1 — abre com I; clica granada → mão (custo nos destinos), arrasta
      carregador → mochila, larga no chão e volta a apanhar, recarrega largando o carregador na arma vazia (15 UT),
      ativa a granada (espoleta 2), dica com estatísticas, teclado (setas + Enter), excesso de peso com um cadáver,
      fecha com I e confirma que o HUD volta;
   B) ?battle=medium_scout&seed=7&month=2 — ferimentos criados por page.evaluate; inventário → kit médico na mochila →
      «Usar…» → Curar ×2 (o kit passa para a mão), Estimulante num vizinho; depois menu de ação «Usar…» →
      Analgésico; ecrã a 1024×700;
   C) OV.InventoryUI.equipScreen num contentor: Auto-equipar, arrastar do armazém, Esvaziar.
   As UT são verificadas ao ponto contra a tabela §3.7. Falha com erros de consola/página e chaves i18n em falta.
   Uso: node ovni-1999/qa/inventory_check.mjs [--out <pasta>] [--headed] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'inventory') : path.join(process.cwd(), 'qa-out', 'inventory'));
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
  const f = String(shotN).padStart(2, '0') + '_' + name + '.png';
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
async function openBattle(query, size) {
  await page.setViewportSize(size || { width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  await idle();
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
  await page.waitForTimeout(120);
}
async function drag(from, to, opts) {
  await page.locator(from).first().scrollIntoViewIfNeeded();
  const a = await centre(from), b = await centre(to);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 6, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(120);
  if (opts && opts.shot) await shot(opts.shot);
  const hot = await inv();
  await page.mouse.up();
  await page.waitForTimeout(80);
  await idle();
  return hot;
}
// preparação do teste: UT cheias (para cada passo medir o custo exato sem esgotar o soldado)
const refill = () => page.evaluate(() => {
  const u = OV.BUnits.findUnit(OV.Game.B, OV.InventoryUI.debug.state().unitId);
  u.tu = u.tuMax;
  OV.InventoryUI.refresh();
});
const unitInfo = (id) => page.evaluate((uid) => {
  const u = OV.BUnits.findUnit(OV.Game.B, uid);
  return { tu: u.tu, hp: u.hp, energy: u.energy, morale: u.morale, stun: u.stun, wounds: u.wounds.slice(), str: u.stats.str, baseTU: u.stats.tu };
}, id);

page = null;
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  // ================================= A) inventário =================================
  await openBattle('battle=medium_scout&seed=7&month=1&night=1');
  await page.evaluate(() => { OV.Game.settings.confirmMove = 'always'; });
  // soldado com espingarda na mão direita (o sargento da batalha rápida pode levar o lança-foguetes)
  const rk = await page.evaluate(() => {
    const B = OV.Game.B;
    const sq = B.units.filter((u) => u.side === 'xcom' || u.origSide === 'xcom');
    return sq.findIndex((u) => { const it = OV.BUnits.findItem(B, u.items.R); return it && it.type === 'rifle'; });
  });
  if (rk > 0) await click('.bs-squad .bs-sq:nth-child(' + (rk + 1) + ')');
  const sel = await page.evaluate(() => OV.BattleUI.debug.state().selectedId);
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  let s = await inv();
  log(s.open && s.mode === 'inv' && s.unitId === sel, 'tecla I abre o inventário do soldado selecionado');
  log(await page.evaluate(() => getComputedStyle(document.querySelector('.bs-hud')).visibility === 'hidden'), 'HUD da batalha escondido por baixo do inventário');
  log(!!s.R && s.R.type === 'rifle' && s.belt.length >= 3, 'mão direita com espingarda e cinto com carregadores/granadas: ' + JSON.stringify(s.belt.map((x) => x.type)));
  await shot('inv_open');

  // clicar granada no cinto → escolher mão esquerda
  const gren = s.belt.find((x) => x.type === 'grenade');
  let tu0 = (await unitInfo(sel)).tu;
  await click('[data-src="i:' + gren.id + '"]');
  s = await inv();
  log(s.selected === 'i:' + gren.id, 'clique escolhe a granada');
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('.inv-chip')).map((c) => c.closest('[data-drop]').dataset.drop + '=' + c.textContent));
  log(chips.some((c) => c === 'slot:L=−4 UT') && chips.some((c) => c === 'slot:pack=−16 UT') && chips.some((c) => c === 'slot:ground=−6 UT'), 'custos em todos os destinos: ' + chips.join(', '));
  const lp = await centre('[data-drop="slot:L"]');
  await page.mouse.move(lp.x, lp.y, { steps: 6 });
  await page.waitForTimeout(150);
  s = await inv();
  log(s.hot === 'slot:L' && s.hotLabel === '−4 UT', 'passar sobre a mão esquerda mostra «−4 UT»');
  await shot('inv_pick_grenade');
  await click('[data-drop="slot:L"]');
  await idle();
  s = await inv();
  let tu1 = (await unitInfo(sel)).tu;
  log(s.L && s.L.id === gren.id && tu0 - tu1 === 4, 'granada cinto → mão esquerda por clique/clique (−4 UT: ' + (tu0 - tu1) + ')');

  // arrastar um carregador do cinto para a mochila (16 UT)
  s = await inv();
  const clip = s.belt.find((x) => x.type === 'rifle_clip');
  tu0 = tu1;
  const hotDrag = await drag('[data-src="i:' + clip.id + '"]', '[data-drop="slot:pack"]', { shot: 'inv_drag_clip' });
  log(hotDrag.hot === 'slot:pack' && hotDrag.hotLabel === '−16 UT', 'arrasto mostra o destino e «−16 UT»');
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.pack.some((x) => x.id === clip.id) && tu0 - tu1 === 16, 'carregador arrastado cinto → mochila (−16 UT: ' + (tu0 - tu1) + ')');

  // largar a granada no chão (2 UT) e voltar a apanhá-la (8 UT)
  tu0 = tu1;
  await drag('[data-src="i:' + gren.id + '"]', '[data-drop="slot:ground"]');
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.ground.some((x) => x.id === gren.id) && tu0 - tu1 === 2, 'granada largada no chão (−2 UT: ' + (tu0 - tu1) + ')');
  tu0 = tu1;
  await drag('[data-src="i:' + gren.id + '"]', '[data-drop="slot:L"]');
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.L && s.L.id === gren.id && tu0 - tu1 === 8, 'granada apanhada do chão para a mão (−8 UT: ' + (tu0 - tu1) + ')');

  // recarregar: arma vazia (preparação do teste) e carregador largado sobre ela
  await page.evaluate(() => {
    const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.InventoryUI.debug.state().unitId);
    OV.BUnits.findItem(B, u.items.R).ammo.rounds = 0;
    OV.InventoryUI.refresh();
  });
  s = await inv();
  log(s.R.ammo === 0, 'espingarda vazia (preparação)');
  const clip2 = s.pack.find((x) => x.type === 'rifle_clip') || s.belt.find((x) => x.type === 'rifle_clip');
  tu0 = (await unitInfo(sel)).tu;
  const hotR = await drag('[data-src="i:' + clip2.id + '"]', '[data-src="i:' + s.R.id + '"]', { shot: 'inv_drag_reload' });
  log(hotR.hot === 'item:' + s.R.id && hotR.hotLabel === '−15 UT', 'carregador sobre a arma: destino «recarregar» com «−15 UT» (' + hotR.hot + ' ' + hotR.hotLabel + ')');
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.R.ammo === 20 && tu0 - tu1 === 15 && !s.pack.concat(s.belt).some((x) => x.id === clip2.id), 'recarregada com 20 balas e carregador consumido (−15 UT: ' + (tu0 - tu1) + ')');
  await shot('inv_reloaded');

  // ativar a granada (espoleta 2) pelo painel de ações
  await refill();
  await click('[data-src="i:' + gren.id + '"]');
  await click('[data-act="prime"]');
  s = await inv();
  log(s.fusePick === gren.id, '«Ativar…» abre a escolha da espoleta');
  await shot('inv_fuse_picker');
  tu0 = (await unitInfo(sel)).tu;
  const primeCost = await page.evaluate(() => { const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.InventoryUI.debug.state().unitId); return OV.BUnits.actionTU(B, u, u.items.L, 'prime'); });
  await page.keyboard.press('2');
  await idle();
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.L.fuse === 2 && tu0 - tu1 === primeCost, 'granada ativada com espoleta 2 (−' + (tu0 - tu1) + ' UT, esperado ' + primeCost + ')');
  log(await page.locator('[data-src="i:' + gren.id + '"] .inv-badge.fuse').count() === 1, 'distintivo de espoleta na granada');

  // dica com estatísticas
  await page.mouse.move(10, 10);
  const rp = await centre('[data-src="i:' + s.R.id + '"]');
  await page.mouse.move(rp.x, rp.y, { steps: 5 });
  await page.waitForTimeout(250);
  const tipTxt = await page.evaluate(() => { const t = document.getElementById('tooltip'); return t && !t.classList.contains('hidden') ? t.textContent : ''; });
  log(/Tiro rápido: precisão \d+ % · \d+ UT/.test(tipTxt) && /Dano 30/.test(tipTxt), 'dica da espingarda com dano e precisão por modo');
  await shot('inv_tooltip');

  // teclado: setas + Enter para escolher e pousar
  await refill();
  await page.mouse.move(5, 450);
  s = await inv();
  // a mochila pode estar vazia (desde a ronda 3 o carregador da arma não ocupa o cinto: nada transborda para lá)
  const keyZone = s.pack.length ? 'pack' : 'belt';
  const keyTarget = s[keyZone][s[keyZone].length - 1];
  let found = false;
  const focusIn = (sel) => page.evaluate((q) => { const f = document.querySelector('.kfocus'); return !!f && !!f.closest(q); }, sel);
  for (let n = 0; n < 6 && !(await focusIn('[data-drop="slot:' + keyZone + '"]')); n++) await page.keyboard.press('ArrowDown');
  for (let n = 0; n < 10 && !found; n++) {
    found = await page.evaluate((id) => !!document.querySelector('.kfocus[data-src="i:' + id + '"]'), keyTarget.id);
    if (!found) await page.keyboard.press('ArrowRight');
  }
  log(found, 'setas levam o foco até ao objeto (' + keyZone + ')');
  await page.keyboard.press('Enter');
  s = await inv();
  log(s.selected === 'i:' + keyTarget.id, 'Enter escolhe o objeto focado');
  for (let n = 0; n < 6; n++) {
    if (await page.evaluate(() => { const f = document.querySelector('.kfocus'); return !!f && f.closest('[data-drop="slot:ground"]') !== null; })) break;
    await page.keyboard.press('ArrowRight');
  }
  await shot('inv_keyboard');
  tu0 = (await unitInfo(sel)).tu;
  await page.keyboard.press('Enter');
  await idle();
  s = await inv();
  tu1 = (await unitInfo(sel)).tu;
  log(s.ground.some((x) => x.id === keyTarget.id) && tu0 - tu1 > 0, 'Enter pousa no chão (−' + (tu0 - tu1) + ' UT)');

  // excesso de peso: cadáver no tile (preparação) apanhado para a mão direita... ocupada: vai para a esquerda após largar a granada
  await page.evaluate(() => {
    const B = OV.Game.B, u = OV.BUnits.findUnit(B, OV.InventoryUI.debug.state().unitId);
    OV.BUnits.newItem(B, 'sectoid_corpse', { at: OV.BUnits.unitTile(B, u) });
    OV.InventoryUI.refresh();
  });
  await refill();
  s = await inv();
  await drag('[data-src="i:' + gren.id + '"]', '[data-drop="slot:belt"]');
  s = await inv();
  const corpse = s.ground.find((x) => x.type === 'sectoid_corpse');
  await click('[data-src="i:' + corpse.id + '"]');
  const lp2 = await centre('[data-drop="slot:L"]');
  await page.mouse.move(lp2.x, lp2.y, { steps: 6 });
  await page.waitForTimeout(150);
  await shot('inv_overweight_preview');
  await click('[data-drop="slot:L"]');
  await idle();
  s = await inv();
  const overBad = await page.evaluate(() => document.querySelector('.inv-meter.wt').classList.contains('bad'));
  log(s.L && s.L.type === 'sectoid_corpse' && s.weight > s.str && overBad, 'cadáver na mão: peso ' + s.weight + '/' + s.str + ' a vermelho');
  await shot('inv_overweight');

  // Tab muda de soldado; I fecha; HUD volta
  await page.keyboard.press('Tab');
  s = await inv();
  log(s.unitId !== sel, 'Tab passa ao soldado seguinte');
  await shot('inv_next_soldier');
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  s = await inv();
  const hudBack = await page.evaluate(() => getComputedStyle(document.querySelector('.bs-hud')).visibility !== 'hidden' && OV.BattleUI.scene && OV.Scenes.top().id === 'battlescape');
  log(!s.open && hudBack, 'I fecha e o Battlescape volta ao topo');
  // botão do HUD reabre
  await click('.bs-grid .bs-btn:nth-child(2)');
  s = await inv();
  log(s.open, 'botão «Inventário» do HUD abre');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  log(!(await inv()).open, 'Esc fecha');

  // ================================= B) kit médico =================================
  await openBattle('battle=medium_scout&seed=7&month=2');
  const med = await page.evaluate(() => {
    const B = OV.Game.B;
    const sq = B.units.filter((u) => u.side === 'xcom');
    const medic = sq.find((u) => u.items.pack.some((id) => OV.BUnits.findItem(B, id).type === 'medikit'));
    const near = sq.find((u) => u !== medic && u.z === medic.z && Math.max(Math.abs(u.x - medic.x), Math.abs(u.y - medic.y)) <= 1);
    // ferimentos para o teste
    medic.wounds[2] = 2;
    medic.wounds[0] = 1;
    medic.hp -= 10;
    if (near) { near.wounds[4] = 1; near.hp -= 5; near.energy = Math.max(0, near.energy - 30); near.stun = 6; }
    return { medic: medic.id, idx: sq.indexOf(medic), near: near ? near.id : null };
  });
  await page.waitForTimeout(400);
  log(med.medic !== undefined, 'soldado com kit médico na mochila: #' + med.medic + (med.near ? ', vizinho #' + med.near : ''));
  await click('.bs-squad .bs-sq:nth-child(' + (med.idx + 1) + ')');
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  s = await inv();
  const kit = s.pack.find((x) => x.type === 'medikit');
  await click('[data-src="i:' + kit.id + '"]');
  await shot('med_kit_selected');
  await click('[data-act="use"]');
  s = await inv();
  log(!!s.med && s.med.patientId === med.medic && s.med.part === 0, '«Usar…» abre o kit médico no próprio, com a cabeça escolhida');
  await shot('med_panel');
  // curar o braço direito duas vezes (1.ª: kit passa para a mão)
  await click('.medk-pb[data-part="2"]');
  let before = await unitInfo(med.medic);
  await click('[data-act="med-heal"]');
  await idle();
  let after = await unitInfo(med.medic);
  s = await inv();
  const freeHandTU = 8;
  log(after.wounds[2] === 1 && after.hp === before.hp + 3 && before.tu - after.tu === freeHandTU + 10 && (s.L && s.L.type === 'medikit'), 'Curar: −1 ferida, +3 Saúde, kit para a mão (−' + (before.tu - after.tu) + ' UT = 8 + 10)');
  before = after;
  await click('[data-act="med-heal"]');
  await idle();
  after = await unitInfo(med.medic);
  s = await inv();
  log(after.wounds[2] === 0 && before.tu - after.tu === 10 && s.med.part === 0, 'segunda cura (−10 UT) e a escolha passa à ferida seguinte (cabeça)');
  await shot('med_healed');
  if (med.near) {
    await click('.medk-pat[data-pid="' + med.near + '"]');
    const nb = await unitInfo(med.near);
    await click('[data-act="med-stim"]');
    await idle();
    const na = await unitInfo(med.near);
    log(na.energy === Math.min(nb.energy + 10, 999) && na.stun === Math.max(0, nb.stun - 4), 'Estimulante no vizinho: +10 energia, −4 atordoamento');
    await shot('med_stim_neighbour');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  s = await inv();
  log(s.open && !s.med, 'Esc fecha só o kit e volta ao inventário');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // menu de ação da mão esquerda (kit) → «Usar…» → painel isolado
  await page.keyboard.press('q');
  await page.waitForTimeout(200);
  const entries = await page.evaluate(() => OV.BattleUI.debug.state().menu);
  log(entries && entries.entries.some((e) => e.label === 'Usar…'), 'menu de ação do kit tem «Usar…»');
  await page.keyboard.press('1');
  await page.waitForTimeout(250);
  s = await inv();
  log(s.open && s.mode === 'med', 'menu «Usar…» abre o painel do kit médico');
  before = await unitInfo(med.medic);
  await click('[data-act="med-pain"]');
  await idle();
  after = await unitInfo(med.medic);
  log(after.morale >= before.morale && before.tu - after.tu === 10, 'Analgésico (−10 UT, moral ' + before.morale + '→' + after.morale + ')');
  await shot('med_from_menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  log(!(await inv()).open, 'Esc fecha o painel isolado');

  // 1024×700: tudo cabe
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.waitForTimeout(200);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const p = document.querySelector('.inv-panel').getBoundingClientRect();
    return { w: p.width, h: p.height, ok: p.left >= 0 && p.top >= 0 && p.right <= innerWidth && p.bottom <= innerHeight, scroll: document.querySelector('.inv-panel').scrollHeight - document.querySelector('.inv-panel').clientHeight };
  });
  log(fit.ok && fit.scroll <= 2, 'inventário cabe a 1024×700 (' + Math.round(fit.w) + '×' + Math.round(fit.h) + ', excesso ' + fit.scroll + ')');
  await shot('inv_1024');
  await page.keyboard.press('Escape');

  // ================================= C) «Equipar» =================================
  await page.setViewportSize({ width: 1440, height: 900 });
  const eq = await page.evaluate(() => {
    const B = OV.Game.B;
    const host = document.createElement('div');
    host.id = 'eqhost';
    Object.assign(host.style, { position: 'fixed', inset: '40px 60px', zIndex: 30, padding: '14px', background: '#070c12', border: '1px solid #2a4560', display: 'flex' });
    host.className = 'panel';
    document.body.appendChild(host);
    const squad = B.units.filter((u) => u.side === 'xcom').slice(0, 6).map((u, k) => ({
      id: 's' + k, name: u.name, rank: u.rank, stats: Object.assign({}, u.stats), armour: u.armourId, portraitSeed: u.portraitSeed, female: u.female, nat: u.nat,
      loadout: k === 0 ? { R: 'pistol', L: null, belt: ['pistol_clip'], pack: [] } : { R: null, L: null, belt: [], pack: [] },
    }));
    window.__eqLog = [];
    window.__eq = OV.InventoryUI.equipScreen(host, {
      squad, night: true,
      stores: { rifle: 4, rifle_clip: 12, grenade: 6, smoke_grenade: 2, electro_flare: 6, medikit: 1, heavy_cannon: 1, hc_ap: 3, pistol_clip: 2, motion_scanner: 1 },
      onChange: (st) => window.__eqLog.push(st),
    });
    window.__eq.root.style.flex = '1';
    return squad.length;
  });
  log(eq >= 4, 'ecrã «Equipar» montado com ' + eq + ' soldados');
  await click('#eqhost [data-act="auto"]');
  let es = await page.evaluate(() => window.__eq.state());
  log(es.loadouts.s0.R === 'rifle' && es.loadouts.s0.belt.filter((t) => t === 'rifle_clip').length === 2 && es.stores.pistol === 1 && es.stores.rifle === 3, 'Auto-equipar: espingarda + 2 carregadores; a pistola volta ao armazém');
  await drag('#eqhost [data-src="st:electro_flare"]', '#eqhost [data-drop="slot:L"]');
  es = await page.evaluate(() => window.__eq.state());
  log(es.loadouts.s0.L === 'electro_flare' && es.stores.electro_flare === 4, 'arrastar do armazém para a mão esquerda');
  await click('#eqhost [data-src="st:heavy_cannon"]');
  const bad = await page.evaluate(() => document.querySelector('#eqhost [data-drop="slot:belt"]').classList.contains('drop-bad'));
  log(bad, 'canhão pesado: cinto marcado «Não cabe»');
  await shot('equip_screen');
  await page.keyboard.press('Escape');
  await click('#eqhost [data-act="clear"]');
  es = await page.evaluate(() => ({ st: window.__eq.state(), n: window.__eqLog.length }));
  log(!es.st.loadouts.s0.R && es.st.stores.rifle === 4 && es.n >= 3, 'Esvaziar devolve tudo; onChange chamado ' + es.n + ' vezes');
  await page.evaluate(() => { window.__eq.destroy(); document.getElementById('eqhost').remove(); });

  // chaves em falta
  const missing = await page.evaluate(() => document.body.innerText.includes('⟦'));
  log(!missing, 'sem chaves i18n em falta');
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
