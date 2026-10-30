/* QA da integração da ronda 1 de personas (pendentes que cruzavam ficheiros de vários donos).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre e verifica, com capturas:
   A) Battlescape 1280×800: conselhos da 1.ª missão, menu de ação sem transbordar, bomba guiada pela rota
      («Bomba guiada · rota N casas»), granada alienígena ativada em Recruta (círculo + aviso), «o clarão revelou-o»
      no relatório do turno alienígena com o clarão no mapa.
   B) Campanha 1280×800: OVNI aterrado de noite → «Esperar pelo dia» no aviso e no briefing → o relógio para ao
      amanhecer e volta a perguntar; Equipar a bordo com o sítio da nave; auto-equipar sem armas → aviso; vender nave
      → aluguer deste mês; Opções «Confirmar explosivos»; Como Jogar (21 teclas); OVNI em losango magenta (paleta cvd);
      ranhuras auto2/preMission pelo OV.Save.
   C) 1024×640 (1280×800 a 125 %): título do menu inteiro, cartão da instalação sem «L…», menu de ação.
   D) iPad: toque longo num botão do Geoscape mostra a etiqueta (OV.Dom.tooltip) e não carrega.
   Uso: node qa/integration_r1.mjs [--out DIR] */
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { createRequire } from 'module';
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'integration_r1') : path.join(process.cwd(), 'qa-out', 'integration_r1'));
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
let browser, ctx, page, shotN = 0;
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
const URL0 = () => 'http://127.0.0.1:' + port + '/ovni-1999/index.html';
async function openBattle(query) {
  await page.goto(URL0() + '?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
  await idle();
}
async function openMenu() {
  await page.goto(URL0() + '?debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 30000 });
  await sleep(300);
}
const noMissing = async (where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
const topId = () => page.evaluate(() => (OV.Scenes.top() || {}).id);
const toastText = () => page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((n) => n.textContent).join(' | '));
const menuOverflow = () => page.evaluate(() => {
  const m = document.querySelector('.bs-menu');
  const l = document.querySelector('.bs-menu-list');
  if (!m || !l) return 'sem menu';
  const mr = m.getBoundingClientRect();
  const out = Array.from(m.querySelectorAll('.bs-mi-acc, .bs-mi-cost')).filter((n) => n.textContent && n.getBoundingClientRect().right > mr.right - 2).map((n) => n.textContent);
  return l.scrollWidth > l.clientWidth + 1 || out.length ? { sw: l.scrollWidth, cw: l.clientWidth, out } : null;
});

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) Battlescape ===============================
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  watch(page);
  await openBattle('battle=medium_scout&seed=7&diff=0');
  log((await page.evaluate(() => OV.Game.B.mission.difficulty)) === 0, 'batalha rápida em Recruta');

  // conselhos da primeira missão
  await page.evaluate(() => OV.BattleUI.debug.tips());
  await sleep(250);
  let s = await st();
  log(!!s.report && s.report.kind === 'tips' && s.report.rows.length === 3 && /Espalhe a equipa/.test(s.report.rows[0]), 'conselhos da 1.ª missão: ' + JSON.stringify(s.report && s.report.rows));
  await noMissing('conselhos');
  await shot('battle_tips');
  await page.keyboard.press('Escape');
  await sleep(150);
  log(!(await st()).report, 'Esc fecha os conselhos');

  // menu de ação: a coluna da pontaria cabe na caixa
  await page.keyboard.press('e');
  await sleep(250);
  let ov = await menuOverflow();
  log(ov === null, 'menu de ação sem transbordar (1280): ' + JSON.stringify(ov));
  await shot('battle_menu');
  await page.keyboard.press('Escape');
  await sleep(150);

  // bomba guiada: Lançador Blaster na mão direita, alvo atrás de um obstáculo
  const g = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    for (const h of ['R', 'L']) {
      const id = u.items[h];
      if (id !== null) { OV.BUnits.takeFromUnit(u, id); const it = OV.BUnits.findItem(B, id); it.owner = null; it.at = (u.z * B.map.h + u.y) * B.map.w + u.x; }
    }
    const it = OV.BUnits.newItem(B, 'blaster_launcher', { ammo: 'blaster_bomb' });
    OV.BUnits.giveItem(B, u, it.id, 'R', true);
    u.tu = u.stats.tu;
    const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    return { id: a.id, ux: u.x, uy: u.y };
  });
  await page.evaluate(([id, x, y]) => {
    const B = OV.Game.B;
    OV.BUnits.placeUnit(B, OV.BUnits.findUnit(B, id), OV.BMap.idx(B.map, x, y, 0));
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.BattleUI.refresh();
    OV.BattleUI.debug.centre(x, y, 0);
  }, [g.id, g.ux + 5, g.uy + 2]);
  await sleep(200);
  s = await st();
  log(s.visibleAliens.some((a) => a.id === g.id), 'alienígena de teste à vista');
  await page.keyboard.press('e');
  await sleep(200);
  await page.keyboard.press('1');
  await sleep(300);
  s = await st();
  log(s.mode === 'target' && !!s.target && /^Bomba guiada · rota \d+ casas · Acerto ≈ \d+ %/.test(s.target.label || '') && s.target.route > 0,
    'bomba guiada: «' + (s.target && s.target.label) + '» (rota ' + (s.target && s.target.route) + ')');
  await noMissing('bomba guiada');
  await shot('battle_guided_route');
  await page.keyboard.press('Escape');
  await sleep(150);

  // granada alienígena ativada no chão, à vista, em Recruta
  const nade = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    const at = OV.BMap.idx(B.map, u.x + 1, u.y, u.z);
    const it = OV.BUnits.newItem(B, 'alien_grenade', { at });
    it.fuse = 1;
    if (OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.BattleUI.debug.noteEvent({ t: 'throw', unitId: a.id, itemId: it.id });
    OV.BattleUI.debug.centre(u.x, u.y, 0);
    return OV.BattleUI.debug.grenades();
  });
  await sleep(200);
  s = await st();
  log(nade >= 1 && s.dangers.length >= 1 && s.dangers[0].r > 0, 'granada alienígena: círculo de ' + JSON.stringify(s.dangers));
  const gr = s.report ? s.report.rows.join(' | ') : '';
  log(/Granada alienígena! Afaste os soldados/.test(gr), 'aviso no relatório do turno: «' + gr.slice(0, 120) + '»');
  await shot('battle_alien_grenade');
  await page.keyboard.press('Escape');
  await sleep(150);

  // atacante não visto revelado pelo clarão
  const rv = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const a = B.units.find((x) => x.side === 'alien' && x.onMap && x.status === 'ok');
    // escondido longe da equipa quando dispara
    let far = null, fd = -1;
    const taken = new Set(B.units.filter((v) => v.onMap).map((v) => v.x + ',' + v.y));
    for (let y = 0; y < B.map.h; y++) for (let x = 0; x < B.map.w; x++) {
      const dd = Math.abs(x - u.x) + Math.abs(y - u.y);
      if (dd > fd && !taken.has(x + ',' + y)) { fd = dd; far = [x, y]; }
    }
    OV.BUnits.placeUnit(B, a, OV.BMap.idx(B.map, far[0], far[1], 0));
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    const seenThen = OV.LOS.isVisibleTo(B, 'xcom', a);
    OV.BattleUI.debug.noteEvent({ t: 'damage', unitId: u.id, amount: 6, wounds: 0, attackerId: a.id, dmgType: 'AP', cause: 'shot' });
    // agora à vista, com o clarão no tile dele
    OV.BUnits.placeUnit(B, a, OV.BMap.idx(B.map, u.x + 3, u.y + 3, 0));
    B.flashes = (B.flashes || []).concat([{ i: OV.BMap.idx(B.map, u.x + 3, u.y + 3, 0), side: 'alien' }]);
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.BattleUI.refresh();
    OV.BattleUI.debug.report('turn');
    return { seenThen, seenNow: OV.LOS.isVisibleTo(B, 'xcom', a) };
  });
  await sleep(250);
  s = await st();
  log(!rv.seenThen && rv.seenNow, 'atacante escondido quando disparou e à vista agora');
  log(!!s.report && s.report.rows.some((r) => /atacante não visto — o clarão revelou-o/.test(r)), 'relatório: «… — o clarão revelou-o»: ' + JSON.stringify(s.report && s.report.rows));
  const btnTxt = await page.locator('.bs-report-row .btn').last().innerText().catch(() => '');
  log(/Atacante/i.test(btnTxt), 'botão «Atacante» centra no atirador revelado: ' + btnTxt);
  await shot('battle_flash_revealed');
  await page.keyboard.press('Escape');
  await ctx.close();

  // =============================== B) campanha ===============================
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  watch(page);
  await openMenu();
  await page.evaluate(() => {
    const G = OV.Campaign.newCampaign({ seed: 31, difficulty: 1 });
    G.ui.geoIntro = true;
    OV.Game.G = G;
    OV.CampaignUI.openGeo(G);
  });
  await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
  await sleep(600);
  // OVNI aterrado num sítio onde é noite e continua a ser durante 4 h; Skyranger posto ao lado
  const night = await page.evaluate(() => {
    const G = OV.Game.G;
    let lon = null;
    for (let l = -180; l < 180 && lon === null; l += 5) {
      if (OV.GMath.dayPhase(G, l, 0) === 'night' && OV.GMath.dayPhase({ t: G.t + 4 * 3600 }, l, 0) === 'night') lon = l;
    }
    const m = OV.Missions.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 99999 });
    const u = OV.Missions.spawnUfo(G, m.id);
    Object.assign(u, { lon, lat: 0, detected: true, status: 'landed', speed: 0, groundLeftS: 400000, dest: null });
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    sky.lon = lon - 1.5;
    sky.lat = 0.5;
    const r = OV.World.launch(G, sky.id, { kind: 'ufo', id: u.id });
    let n = 0;
    while (sky.status !== 'patrol' && n++ < 40) OV.World.step(G, 120);
    if (OV.GeoUI.current().paused) OV.GeoUI.togglePause();
    OV.GeoUI.setSpeed(0);
    return { lon, ufo: u.id, craft: sky.id, launch: r.ok, status: sky.status };
  });
  log(night.lon !== null && night.launch && night.status === 'patrol', 'OVNI aterrado de noite e Skyranger no local ' + JSON.stringify(night));
  await page.waitForSelector('.geo-pop', { timeout: 15000 });
  await sleep(300);
  let pop = await page.locator('.geo-pop').innerText();
  log(/Lá é noite/.test(pop) && /ESPERAR PELO DIA|Esperar pelo dia/i.test(pop), 'aviso «Equipa no local» sugere esperar pelo dia: ' + pop.replace(/\s+/g, ' ').slice(0, 200));
  await noMissing('equipa no local de noite');
  await shot('geo_night_arrival');
  // briefing de noite: também lá está o botão
  // em Recruta (ou com o OVNI seguro até amanhecer) o botão de atacar chama-se «Atacar já» (ronda 3)
  await page.locator('.geo-pop .btn', { hasText: /Iniciar|Atacar já/i }).first().click();
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'cbriefing', null, { timeout: 15000 });
  await sleep(400);
  const br = await page.locator('.cp-brief').innerText();
  log(/Esperar pelo dia/i.test(br) && /Sugestão: «Esperar pelo dia»/.test(br), 'briefing de noite com «Esperar pelo dia» (W)');
  await noMissing('briefing de noite');
  await shot('briefing_night_waitday');
  await page.keyboard.press('w');
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'geoscape', null, { timeout: 10000 });
  const wd = await page.evaluate(() => ({ L: OV.Game.G.ui.waitDay, am: OV.Game.G.activeMission }));
  log(Array.isArray(wd.L) && wd.L.length === 1 && wd.L[0].craftId === night.craft && wd.am === null, 'W: missão cancelada e espera registada ' + JSON.stringify(wd));
  await page.evaluate(() => OV.GeoUI.setSpeed(5));
  await page.waitForSelector('.geo-pop', { timeout: 30000 });
  await sleep(300);
  pop = await page.locator('.geo-pop').innerText();
  const dawn = await page.evaluate((lon) => ({ ph: OV.GMath.dayPhase(OV.Game.G, lon, 0), speed: OV.GeoUI.current().speed, L: OV.Game.G.ui.waitDay }), night.lon);
  log(/Amanheceu no local/i.test(pop) && dawn.ph === 'day' && dawn.L.length === 0, 'ao amanhecer o relógio para e volta a perguntar: ' + JSON.stringify(dawn) + ' «' + pop.replace(/\s+/g, ' ').slice(0, 80) + '»');
  await shot('geo_dawn');
  await page.keyboard.press('w');
  await sleep(200);

  // Equipar a bordo: a nave está fora da base
  await page.evaluate((c) => OV.Scenes.push('equip', { G: OV.Game.G, craftId: c }), night.craft);
  await page.waitForSelector('.cp-eq .inv-equip', { timeout: 10000 });
  await sleep(300);
  const kick = await page.locator('.cp-eq .scr-head').innerText();
  log(/EQUIPAR A BORDO|Equipar a bordo/i.test(kick) && /Skyranger/i.test(kick), 'Equipar a bordo com a nave e o sítio: ' + kick.replace(/\s+/g, ' ').slice(0, 120));
  await noMissing('equipar a bordo');
  await shot('equip_away');
  await page.keyboard.press('Escape');
  await sleep(300);

  // auto-equipar sem armas no armazém → aviso de onde comprar
  const nw = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:40px;z-index:60;background:#05080c;display:flex';
    document.body.appendChild(host);
    const s = { id: 'q1', name: 'Rita Sousa', rank: 0, stats: { str: 30, tu: 60, hp: 35 }, portraitSeed: 3, female: true, nat: 'pt', loadout: { R: null, L: null, belt: [], pack: [] } };
    const ctl = OV.InventoryUI.equipScreen(host, { squad: [s], stores: { grenade: 2 }, onChange: () => {}, researched: [] });
    await new Promise((r) => setTimeout(r, 200));
    const b = Array.from(host.querySelectorAll('button')).find((x) => /Auto-equipar/i.test(x.textContent));
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 250));
    window.__eqHost = host;
    window.__eqCtl = ctl;
    return !!b;
  });
  const nwt = await toastText();
  log(nw && /Armazém sem armas com munição/.test(nwt) && /Mercado/.test(nwt), 'auto-equipar sem armas: «' + nwt.slice(0, 140) + '»');
  await shot('equip_noweapons');
  await page.evaluate(() => { if (window.__eqCtl) window.__eqCtl.destroy(); window.__eqHost.remove(); });

  // vender uma nave: o aluguer deste mês aparece antes de confirmar
  await page.evaluate(() => {
    const G = OV.Game.G;
    G.t += 10 * 86400;
    OV.BaseUI.open(G, G.bases[0].id, 'crafts');
  });
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'basescape', null, { timeout: 10000 });
  await sleep(400);
  const icId = await page.evaluate(() => Object.keys(OV.Game.G.crafts).find((id) => OV.Game.G.crafts[id].type === 'interceptor' && OV.Game.G.crafts[id].status === 'ready'));
  const rent = await page.evaluate((id) => OV.BaseSim.craftRentDue(OV.Game.G, id), icId);
  const row = page.locator('[data-craft="' + icId + '"], [data-cid="' + icId + '"], [data-id="' + icId + '"]').first();
  if (await row.count()) await row.click();
  else await page.locator('.bsc-craft, .bsc-crow').filter({ hasText: /Intercetor|Interceptor/ }).first().click();
  await sleep(250);
  await page.locator('[data-act="sellCraft"]').first().click();
  await page.waitForSelector('#modals .modal', { timeout: 5000 });
  const sell = await page.locator('#modals .modal').innerText();
  log(rent > 0 && /Aluguer deste mês: .*\(cobrado no fim do mês\)/.test(sell), 'vender nave: «Aluguer deste mês» (' + rent + ' $): ' + sell.replace(/\s+/g, ' ').slice(0, 220));
  await noMissing('vender nave');
  await shot('base_sell_rent');
  await page.locator('#modals .modal .btn', { hasText: /Cancelar/i }).click();
  await sleep(200);
  // cartão da instalação selecionada (laboratório) com nome e efeito inteiros
  await page.evaluate(() => OV.BaseUI.open(OV.Game.G, OV.Game.G.bases[0].id, 'facilities'));
  await sleep(300);
  const lab = await page.evaluate(() => {
    const b = OV.Game.G.bases[0];
    const f = b.grid.find((x) => x.type === 'laboratory') || b.grid.find((x) => x.type === 'living_quarters');
    return f ? OV.BaseUI.debug.cellCenter(f.x, f.y) : null;
  });
  if (lab) await page.mouse.click(lab.x, lab.y);
  await sleep(250);
  const card = await page.evaluate(() => {
    const n = document.querySelector('.bsc-info-name');
    const b = document.querySelector('.bsc-info-btns');
    const info = document.querySelector('.bsc-info');
    if (!n || !info) return null;
    const ir = info.getBoundingClientRect();
    return { name: n.textContent, cut: n.scrollHeight > n.clientHeight + 1, btnsIn: !b || b.getBoundingClientRect().bottom <= ir.bottom + 1 };
  });
  log(!!card && !card.cut && card.btnsIn, 'cartão da instalação (1280): ' + JSON.stringify(card));
  await shot('base_facility_card');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ranhuras auto2 e preMission pelo OV.Save
  const slots = await page.evaluate(() => {
    OV.CampaignUI.autosave(OV.Game.G, { silent: true });
    OV.CampaignUI.autosave(OV.Game.G, { silent: true });
    OV.CampaignUI.saveBeforeMission(OV.Game.G, { kind: 'ufo', id: 'x' }, 'c1');
    return OV.Save.list().map((e) => e.slot);
  });
  log(slots.indexOf('auto2') >= 0 && slots.indexOf('preMission') >= 0, 'OV.Save.list inclui auto2 e preMission: ' + slots.join(','));
  await page.evaluate(() => OV.CampaignUI.saveDialog(OV.Game.G));
  await page.waitForSelector('.cp-sl-list', { timeout: 5000 });
  await sleep(250);
  const sl = await page.locator('.cp-sl-list').innerText();
  log(/Automática \(anterior\)/i.test(sl) && /Antes da missão/i.test(sl), 'diálogo de gravações mostra as duas ranhuras extra');
  await shot('saves_extra');
  await page.keyboard.press('Escape');
  await sleep(300);

  // OVNI em voo com a paleta para daltonismo: losango magenta
  const uv = await page.evaluate(async () => {
    const G = OV.Game.G;
    OV.Game.settings.palette = 'cvd';
    OV.Game.applySettings();
    const m = OV.Missions.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 99999 });
    const u = OV.Missions.spawnUfo(G, m.id);
    Object.assign(u, { lon: 0, lat: 45, detected: true, status: 'flying', speed: 0, dest: null });
    if (!OV.GeoUI.current().paused) OV.GeoUI.togglePause();
    OV.GeoUI.centreOn(G, { kind: 'ufo', id: u.id }, 3);
    await new Promise((r) => setTimeout(r, 900));
    return u.id;
  });
  // desenho do globo numa tela à parte, centrado no OVNI (as duas fases do pisca), contando píxeis magenta à volta do OVNI
  const mag = await page.evaluate((id) => {
    const G = OV.Game.G, v0 = { lon: 0, lat: 45, zoom: 3, w: 800, h: 600, dpr: 1 };
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const g2 = c.getContext('2d', { willReadFrequently: true });
    let best = 0;
    for (const time of [0, 250, 500, 750]) {
      const v = Object.assign({}, v0, { time, palette: 'cvd' });
      OV.GlobeRender.draw(g2, G, v);
      const sp = OV.GlobeRender.screenPos(G, v, { kind: 'ufo', id });
      if (!sp) continue;
      const dpr = v.dpr || 1;
      let n = 0;
      for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
        const d = g2.getImageData(Math.round((sp.x + dx) * dpr), Math.round((sp.y + dy) * dpr), 1, 1).data;
        if (d[0] > 180 && d[2] > 140 && d[1] < 130) n++;
      }
      best = Math.max(best, n);
    }
    return best;
  }, uv);
  log(mag > 0, 'OVNI em voo a magenta na paleta cvd (' + mag + ' px)');
  await page.screenshot({ path: path.join(OUT, String(++shotN).padStart(2, '0') + '_geo_ufo_cvd.png'), clip: { x: 340, y: 200, width: 600, height: 400 } });
  await page.evaluate(() => { OV.Game.settings.palette = 'normal'; OV.Game.applySettings(); });

  // Opções: confirmar explosivos
  await page.evaluate(() => OV.Scenes.push('options', {}));
  await page.waitForSelector('.scr-opts', { timeout: 5000 });
  await sleep(250);
  const optTxt = await page.locator('.scr-opts').innerText();
  log(/Confirmar explosivos perto de aliados/i.test(optTxt) && /Recruta e Veterano/i.test(optTxt), 'Opções: «Confirmar explosivos perto de aliados»');
  const seg = page.locator('.scr-opts button', { hasText: /^Sempre$/ });
  const nSeg = await seg.count();
  if (nSeg) await seg.nth(nSeg - 1).click();
  await sleep(150);
  log((await page.evaluate(() => OV.Game.settings.confirmBlast)) === 'always', 'confirmBlast muda para «Sempre»');
  await page.locator('.scr-opts .scr-frow, .scr-opts .scr-opt-row', { hasText: /Confirmar explosivos/i }).first().scrollIntoViewIfNeeded().catch(() => {});
  await shot('options_confirmblast');
  await page.evaluate(() => { OV.Game.settings.confirmBlast = 'auto'; OV.Game.saveSettings(); });
  await page.keyboard.press('Escape');
  await sleep(300);

  // Como Jogar: teclado do combate com o cursor
  await page.evaluate(() => OV.Scenes.push('howto', {}));
  await page.waitForSelector('.scr-ktable.keys', { timeout: 5000 });
  const nRows = await page.locator('.scr-ktable.keys tbody tr').count();
  const howto = await page.locator('.scr-ktable.keys').innerText();
  log(nRows === 21 && /Mover o cursor de casas/.test(howto) && /Registo de mensagens/.test(howto), 'Como Jogar: ' + nRows + ' teclas, cursor e registo');
  await noMissing('como jogar');
  await shot('howto_keys');
  await ctx.close();

  // =============================== C) 1024×640 (125 %) ===============================
  ctx = await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1.25 });
  page = await ctx.newPage();
  watch(page);
  await openMenu();
  const logo = await page.evaluate(() => {
    const r = document.querySelector('.scr-logo-big').getBoundingClientRect();
    const l = document.querySelector('.scr-menu-list').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), listBottom: Math.round(l.bottom), h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth };
  });
  log(logo.top >= 0 && logo.listBottom <= logo.h && logo.sw <= logo.w, 'menu a 125 %: título inteiro e lista visível ' + JSON.stringify(logo));
  await shot('menu_125');
  await page.evaluate(() => {
    const G = OV.Campaign.newCampaign({ seed: 32, difficulty: 1 });
    G.ui.geoIntro = true;
    OV.Game.G = G;
    OV.CampaignUI.openGeo(G);
    OV.BaseUI.open(G, G.bases[0].id, 'facilities');
  });
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'basescape', null, { timeout: 10000 });
  await sleep(500);
  const lab2 = await page.evaluate(() => {
    const b = OV.Game.G.bases[0];
    const f = b.grid.find((x) => x.type === 'laboratory') || b.grid.find((x) => x.type === 'living_quarters');
    return OV.BaseUI.debug.cellCenter(f.x, f.y);
  });
  await page.mouse.click(lab2.x, lab2.y);
  await sleep(300);
  const card2 = await page.evaluate(() => {
    const n = document.querySelector('.bsc-info-name');
    const sub = document.querySelector('.bsc-info-sub');
    const info = document.querySelector('.bsc-info');
    const b = document.querySelector('.bsc-info-btns');
    const ir = info.getBoundingClientRect();
    return { name: n.textContent, nameW: Math.round(n.getBoundingClientRect().width), nameCut: n.scrollHeight > n.clientHeight + 1, sub: sub && sub.textContent, btnsIn: !b || b.getBoundingClientRect().bottom <= ir.bottom + 1 };
  });
  log(card2.nameW >= 60 && !card2.nameCut && card2.btnsIn, 'cartão da instalação a 125 %: ' + JSON.stringify(card2));
  await shot('base_card_125');
  await ctx.close();

  // menu de ação a 125 %
  ctx = await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1.25 });
  page = await ctx.newPage();
  watch(page);
  await openBattle('battle=large_scout&seed=11&month=4');
  await page.keyboard.press('e');
  await sleep(250);
  ov = await menuOverflow();
  log(ov === null, 'menu de ação sem transbordar (125 %): ' + JSON.stringify(ov));
  await shot('battle_menu_125');
  await ctx.close();

  // =============================== D) iPad: toque longo no Geoscape ===============================
  ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  await openMenu();
  await page.evaluate(() => {
    const G = OV.Campaign.newCampaign({ seed: 33, difficulty: 0 });
    G.ui.geoIntro = true;
    OV.Game.G = G;
    OV.CampaignUI.openGeo(G);
  });
  await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
  await sleep(600);
  const sp0 = await page.evaluate(() => OV.GeoUI.current().speed);
  const bb = await page.locator('.geo-sp').nth(4).boundingBox();
  await touch('touchStart', [[bb.x + bb.width / 2, bb.y + bb.height / 2]]);
  await sleep(700);
  const lp = await page.locator('.lp-tip').innerText().catch(() => '');
  await shot('ipad_geo_longpress');
  await touch('touchEnd', []);
  await sleep(300);
  const sp1 = await page.evaluate(() => OV.GeoUI.current().speed);
  log(lp.length > 0 && sp1 === sp0, 'iPad: toque longo num botão do Geoscape mostra «' + lp.replace(/\n/g, ' ') + '» e não muda a velocidade (' + sp0 + '→' + sp1 + ')');
  await ctx.close();
} catch (e) {
  fails.push('exceção: ' + (e && e.stack || e));
  console.log('✗ exceção: ' + (e && e.stack || e));
  try { if (page) await page.screenshot({ path: path.join(OUT, 'exception.png') }); } catch (e2) { /* sem página */ }
} finally {
  if (browser) await browser.close();
  server.kill();
}
const errs = errors.filter((e) => !/favicon|service worker/i.test(e));
log(!errs.length, 'sem erros na consola ' + JSON.stringify(errs.slice(0, 5)));
console.log('\n' + (fails.length ? '✗ ' + fails.length + ' falhas' : '✓ tudo verde') + ' — capturas em ' + OUT);
process.exit(fails.length ? 1 : 0);
