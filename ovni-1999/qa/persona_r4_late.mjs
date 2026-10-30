/* Ronda 4 de personas — achados tardios (Rui, veterano; Sofia, casual) num Chromium real (Playwright). A parte pura
   está em tools/tests/late_persona_r4.test.js.
   Batalha:
   A) Rui: Lançador Blaster com «Reservar tiro rápido» (⇧2) → aviso «fica reservado o tiro apontado» e etiqueta do
      caminho «Tiro apontado (a arma não tem tiro rápido) + ajoelhar»;
   B) Rui: granada dentro do OVNI → sem arco o texto diz «paredes ou teto no caminho» (nunca «o alvo está debaixo de
      um teto») e as casas com arco ficam marcadas; numa casa marcada o custo normal;
   C) Sofia: OVNI aterrado de dia, todos os alienígenas lá dentro → conselho ao fim de 3 turnos (Recruta), com
      «Mostrar» a centrar a porta.
   Estratégia:
   D) Sofia: armazém sobrelotado → «!» em Bases e aviso «Armazém … sobrelotado (57,9/50)» com «Vender material»;
   E) Sofia: ataque terrorista de noite → o alerta diz «lá será noite»; a chegada avisa e oferece «Esperar pelo dia»
      quando o ataque dura até lá; quando não dura, diz que acaba antes e não oferece esperar;
   F) Sofia: «Fabrico concluído» de Espingardas Laser → «Trocar armas na Skyranger-1» troca as armas dos soldados;
   G) Rui: briefing longe da base com armas melhores a bordo → aviso + «Trocar armas» (U); Equipar diz «e mais N
      tipos» do que ficou na base, com o bastão e as granadas de fumo primeiro;
   H) Sofia: «Ritmo: Desconhecido» e «h de engenheiro» com dica e rótulo acessível.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/persona_r4_late.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r4_late') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r4_late') : path.join(process.cwd(), 'qa-out', 'persona_r4_late');
const OUT = path.resolve(arg('out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(true); }); s.on('error', () => res(false)); });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const URL0 = 'http://127.0.0.1:' + port + '/ovni-1999/index.html?nosw=1&debug=1';
const errors = [];
const fails = [];
let checks = 0;
let browser, ctx, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, msg) => { checks++; console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fails.push(msg); };
const shot = async (name) => { await sleep(250); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const st = () => page.evaluate(() => OV.BattleUI.debug.state());
const noMissing = async (where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  log(!m, where + ': sem chaves ⟦…⟧ ' + (m ? [...new Set(m)].join(', ') : ''));
};
const toasts = () => page.evaluate(() => (document.getElementById('toasts') || {}).innerText || '');
const clearToasts = () => page.evaluate(() => { for (const n of document.querySelectorAll('#toasts .toast')) n.remove(); });
async function newPage(w, h) {
  ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
}
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 60000 });
  await sleep(150);
}
async function openBattle(query) {
  await page.goto(URL0 + '&' + query);
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
  await idle();
}
async function endTurn() {
  await page.keyboard.press('Enter');
  await sleep(300);
  const b = page.locator('#modals .btn.primary');
  if (await b.count()) await b.first().click();
  for (let k = 0; k < 100; k++) {
    await sleep(100);
    const s = await st();
    if (!s || s.ended || (!s.playing && s.side === 'xcom' && k > 3)) break;
  }
  await idle();
}
// campanha nova no Geoscape, sem a introdução
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: (o && o.diff) | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  if (o && o.month) G.month = o.month;
  // sem missões alienígenas: nenhum alerta alheio pelo meio
  G.alienMissions.length = 0;
  G.ufos.length = 0;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.GeoUI.open(G);
  return true;
};
async function openGeo(o) {
  await page.goto(URL0);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI && OV.BaseUI);
  await sleep(300);
  await page.evaluate(NEWG, o || {});
  await sleep(600);
}
const popText = () => page.evaluate(() => { const p = document.querySelector('.geo-pop'); if (!p) return ''; const c = p.cloneNode(true); c.querySelectorAll('.btn').forEach((b) => b.remove()); return c.innerText.replace(/\s+/g, ' '); });
const popBtns = () => page.evaluate(() => [...document.querySelectorAll('.geo-pop .btn')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // =============================== A) reserva com o modo efetivo ===============================
  await newPage(1440, 900);
  await openBattle('battle=small_scout&landed=1&seed=7&diff=2');
  const A = await page.evaluate(() => {
    const B = OV.Game.B;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const old = u.items.R;
    if (old !== null && old !== undefined) { OV.BUnits.takeFromUnit(u, old); OV.BUnits.giveItem(B, u, old, 'pack', true); }
    const w = OV.BUnits.newItem(B, 'blaster_launcher', { ammo: 'blaster_bomb' });
    OV.BUnits.giveItem(B, u, w.id, 'R', true);
    u.stats.str = 80;
    OV.BattleUI.refresh();
    return { id: u.id, x: u.x, y: u.y };
  });
  await clearToasts();
  await page.keyboard.press('Shift+Digit2');
  await sleep(300);
  const t1 = await toasts();
  log(/a arma não tem tiro rápido — fica reservado o tiro apontado \(\d+ UT\)/.test(t1), 'A: ⇧2 com o Blaster avisa o modo efetivo «' + t1.replace(/\s+/g, ' ').slice(0, 120) + '»');
  await page.keyboard.press('j');
  await sleep(150);
  // UT para andar um pouco mas não o suficiente para guardar a reserva: um destino que a come
  const dest = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    const res = OV.Act.reserveTU(B, u, { standing: true });
    u.tu = res + 10;
    for (let r = 2; r < 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const x = u.x + dx, y = u.y + dy;
          if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
          const wp = OV.Act.walkPreview(B, u, OV.BMap.idx(m, x, y, u.z));
          if (wp && wp.tu > 10 && wp.tu <= u.tu) { OV.BattleUI.refresh(); return { x, y, z: u.z, tu: wp.tu, res }; }
        }
      }
    }
    return null;
  });
  log(!!dest, 'A: destino que come a reserva ' + JSON.stringify(dest));
  if (dest) {
    await page.evaluate((d) => OV.BattleUI.debug.centre(d.x, d.y, d.z), dest);
    await sleep(200);
    const p = await page.evaluate((d) => OV.BattleUI.debug.tileToScreen(d.x, d.y, d.z), dest);
    await page.mouse.move(p.x, p.y + 16, { steps: 2 });
    await sleep(300);
    const s = await st();
    log(/para guardar \d+ UT \(Tiro apontado \(a arma não tem tiro rápido\) \+ ajoelhar\)/.test(s.pathLabel || ''), 'A: etiqueta do caminho «' + s.pathLabel + '»');
    await shot('A_reserve_label');
  }
  await noMissing('A');
  await ctx.close();

  // =============================== B) granada dentro do OVNI ===============================
  await newPage(1440, 900);
  await openBattle('battle=medium_scout&landed=1&seed=5&diff=1');
  const Bk = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map, r = B.ufo;
    const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
    // os alienígenas longe do OVNI (nada interrompe); o soldado numa casa com teto dentro do OVNI
    for (const a of B.units) if (a.side === 'alien' && a.onMap) a.stats.tu = 0;
    let at = null;
    for (let y = r.y; y < r.y + r.h && !at; y++) {
      for (let x = r.x; x < r.x + r.w && !at; x++) {
        const i = OV.BMap.idx(m, x, y, 0);
        if (OV.BMap.canStand(m, i) && !OV.Battle.unitAt(B, i) && m.parts[OV.BMap.idx(m, x, y, 1) * 4]) at = i;
      }
    }
    if (at === null) return null;
    OV.BUnits.placeUnit(B, u, at);
    const g = OV.BUnits.newItem(B, 'grenade');
    OV.BUnits.giveItem(B, u, g.id, 'belt', true);
    u.tu = u.tuMax;
    for (let y = r.y - 2; y < r.y + r.h + 2; y++) for (let x = r.x - 2; x < r.x + r.w + 2; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.disc[OV.BMap.idx(m, x, y, 0)] |= 1;
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.BattleUI.refresh();
    // uma casa sem arco e uma com arco, as duas com teto, a ≤ 6 casas
    const ok = [], no = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = OV.BMap.idx(m, x, y, 0);
        if (!OV.BMap.hasFloor(m, i) || (x === u.x && y === u.y) || Math.abs(x - u.x) + Math.abs(y - u.y) > 6) continue;
        if (!m.parts[OV.BMap.idx(m, x, y, 1) * 4]) continue;
        const p = OV.Act.planArc(B, u, i);
        (p && p.goal === i ? ok : no).push({ x, y });
      }
    }
    return { u: { x: u.x, y: u.y }, ok: ok[0] || null, no: no[0] || null };
  });
  log(!!(Bk && Bk.ok && Bk.no), 'B: soldado dentro do OVNI, casas com e sem arco debaixo do teto ' + JSON.stringify(Bk));
  if (Bk && Bk.ok && Bk.no) {
    await page.evaluate((u) => OV.BattleUI.debug.centre(u.x, u.y, 0), Bk.u);
    await page.keyboard.press('g');
    await sleep(300);
    let s = await st();
    log(s.mode === 'throw' && s.arcTiles > 0, 'B: dentro do OVNI, ao lançar as casas com arco ficam marcadas logo (' + s.arcTiles + ')');
    await page.evaluate((p) => OV.BattleUI.debug.kb(p.x, p.y, 0), Bk.no);
    await sleep(250);
    s = await st();
    const lb = (s.throwInfo && s.throwInfo.label) || '';
    log(/paredes ou teto no caminho/.test(lb) && !/O alvo está debaixo de um teto/.test(lb), 'B: casa sem arco «' + lb + '»');
    await shot('B_grenade_noarc');
    await page.evaluate((p) => OV.BattleUI.debug.kb(p.x, p.y, 0), Bk.ok);
    await sleep(250);
    s = await st();
    log(!!s.throwInfo && /UT/.test(s.throwInfo.label) && !/trajetória/.test(s.throwInfo.label), 'B: casa marcada com arco «' + (s.throwInfo && s.throwInfo.label) + '»');
    await shot('B_grenade_ok');
    await page.keyboard.press('Escape');
  }
  await noMissing('B');
  await ctx.close();

  // =============================== C) conselho do OVNI de dia ===============================
  await newPage(1440, 900);
  await openBattle('battle=large_scout&landed=1&seed=5&diff=0');
  const C0 = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map, r = B.ufo;
    // todos os alienígenas dentro do OVNI e quietos (a situação da Sofia: 10 turnos sem ver ninguém)
    const free = [];
    for (let y = r.y + 2; y < r.y + r.h - 2; y++) for (let x = r.x + 2; x < r.x + r.w - 2; x++) { const i = OV.BMap.idx(m, x, y, 0); if (OV.BMap.canStand(m, i) && !OV.Battle.unitAt(B, i)) free.push(i); }
    let k = 0;
    for (const a of B.units) {
      if (a.side !== 'alien' || !a.onMap || a.status === 'dead') continue;
      const inside = a.x >= r.x && a.x < r.x + r.w && a.y >= r.y && a.y < r.y + r.h && a.z === 0;
      if (!inside && free[k] !== undefined) OV.BUnits.placeUnit(B, a, free[k++]);
      a.stats.tu = 0;
      a.tu = 0;
    }
    if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
    OV.BattleUI.debug.contact(B.turn - 2);
    OV.BattleUI.refresh();
    return { turn: B.turn, entry: OV.BattleUI.model.ufoEntry(B), w: m.w, night: !!B.mission.night };
  });
  log(!C0.night, 'C: missão de dia');
  await endTurn();
  let s = await st();
  const hintRow = s.report && s.report.rows.find((t) => /dentro do OVNI/.test(t));
  log(!!hintRow && /3 turnos/.test(hintRow) && /«Mostrar» leva à entrada/.test(hintRow), 'C: conselho de dia ao fim de 3 turnos (Recruta): «' + (hintRow || JSON.stringify(s.report)) + '»');
  await shot('C_ufo_hint_day');
  if (hintRow) {
    const cam0 = s.cam;
    const clicked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.bs-report-row')].filter((r) => /dentro do OVNI/.test(r.textContent));
      const b = rows.length ? rows[0].querySelector('.btn') : null;
      if (b) b.click();
      return !!b;
    });
    await sleep(500);
    s = await st();
    const ex = C0.entry % C0.w, ey = (C0.entry / C0.w) | 0;
    const near = await page.evaluate((p) => { const v = OV.BattleUI.debug.tileToScreen(p.x, p.y, 0); return { x: v.x, y: v.y, W: innerWidth, H: innerHeight }; }, { x: ex, y: ey });
    log(clicked && Math.abs(near.x - near.W / 2) < 80 && Math.abs(near.y - near.H / 2) < 120, 'C: «Mostrar» centra a porta (' + ex + ',' + ey + ') ' + JSON.stringify(near) + ' cam ' + JSON.stringify(cam0) + '→' + JSON.stringify(s.cam));
    await shot('C_ufo_hint_door');
  }
  await noMissing('C');
  await ctx.close();

  // =============================== D) armazém sobrelotado ===============================
  await newPage(1440, 900);
  await openGeo({ seed: 41, diff: 0 });
  await page.evaluate(() => { const b = window.__G.bases[0]; b.stores.alien_alloys = (b.stores.alien_alloys | 0) + 120; OV.GeoUI.open(window.__G); });
  await sleep(700);
  const D0 = await page.evaluate(() => {
    const a = document.querySelector('.geo-alert[data-alert="stores"]');
    const badge = [...document.querySelectorAll('.geo-badge')].some((b) => !b.classList.contains('hidden'));
    return { text: a ? a.innerText.replace(/\s+/g, ' ') : '', badge };
  });
  log(/Armazém de .* sobrelotado \(\d+(,\d)?\/\d+\)/.test(D0.text) && /vender material/i.test(D0.text) && D0.badge, 'D: aviso no Geoscape e «!» em Bases ' + JSON.stringify(D0));
  await shot('D_stores_over');
  await page.locator('.geo-alert[data-alert="stores"] .btn').first().click();
  await sleep(700);
  const tab = await page.evaluate(() => (OV.BaseUI.debug && OV.BaseUI.debug.state ? OV.BaseUI.debug.state().tab : null));
  log(tab === 'market', 'D: «Vender material» abre o Mercado (' + tab + ')');
  await noMissing('D');
  await ctx.close();

  // =============================== E) ataque terrorista de noite ===============================
  await newPage(1440, 900);
  await openGeo({ seed: 42, diff: 0, month: 1 });
  const E0 = await page.evaluate(() => {
    const G = window.__G, D = OV.Data, M = OV.GeoUI.model;
    for (const city of D.cities) {
      const site = { id: 't90', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: city.id, lon: city.lon, lat: city.lat, race: 'sectoid', region: null, country: null, leftS: 20 * 3600 };
      G.sites.length = 0;
      G.sites.push(site);
      const e = M.teamEta(G, { kind: 'site', id: 't90' });
      if (e && e.phase === 'night' && e.h < 10) {
        G.events.push({ t: 'terrorSite', siteId: 't90', cityId: city.id, lon: city.lon, lat: city.lat, race: 'sectoid' });
        return { city: city.id, h: e.h };
      }
    }
    return null;
  });
  log(!!E0, 'E: cidade onde a equipa chega de noite ' + JSON.stringify(E0));
  if (E0) {
    await page.evaluate(() => OV.GeoUI.open(window.__G));
    await page.waitForSelector('.geo-pop', { timeout: 8000 }).catch(() => null);
    await sleep(400);
    const tx = await popText();
    log(/lá será noite/.test(tx), 'E: alerta do ataque diz «lá será noite» «' + tx.slice(0, 200) + '»');
    await shot('E_terror_alert_night');
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  // chegada de noite: o ataque dura até ao dia → avisa e oferece esperar; não dura → diz que acaba antes
  for (const lasts of [true, false]) {
    const ok = await page.evaluate((L) => {
      const G = window.__G;
      for (const n of document.querySelectorAll('.geo-pop')) n.remove();
      let city = null, h = 0;
      for (const ci of OV.Data.cities) {
        if (OV.GMath.dayPhase(G, ci.lon, ci.lat) !== 'night') continue;
        let k = 1;
        while (k < 24 && OV.GMath.dayPhase({ t: G.t + k * 3600 }, ci.lon, ci.lat) !== 'day') k++;
        if (k >= 3 && k <= 9) { city = ci; h = k; break; }
      }
      if (!city) return null;
      const lon = city.lon, lat = city.lat;
      G.sites.length = 0;
      G.sites.push({ id: 't91', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: city.id, lon, lat, race: 'sectoid', region: null, country: null, leftS: L ? (h + 6) * 3600 : (h - 1) * 3600 });
      const c = window.__sky;
      c.lon = lon; c.lat = lat; c.status = 'patrol'; c.dest = { kind: 'site', id: 't91' };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'site', id: 't91' }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return { lon, h };
    }, lasts);
    await page.waitForSelector('.geo-pop', { timeout: 8000 }).catch(() => null);
    await sleep(400);
    const tx = await popText();
    const bt = await popBtns();
    if (lasts) {
      log(!!ok && !/null|undefined/.test(tx) && /O ataque ainda dura/.test(tx) && bt.some((b) => /Esperar pelo dia/.test(b)) && (tx.match(/Esperar pelo dia|esperar pelo dia/g) || []).length <= 1, 'E: chegada de noite, o ataque dura → aviso e «Esperar pelo dia» «' + tx.slice(0, 220) + '» ' + JSON.stringify(bt));
      await shot('E_terror_arrived_night_wait');
    } else {
      log(!!ok && /acaba antes de amanhecer/.test(tx) && !bt.some((b) => /Esperar pelo dia/.test(b)), 'E: o ataque acaba antes do dia → sem esperar «' + tx.slice(0, 200) + '» ' + JSON.stringify(bt));
      await shot('E_terror_arrived_night_ends');
    }
  }
  await noMissing('E');
  await ctx.close();

  // =============================== F) fabrico concluído → trocar armas ===============================
  await newPage(1440, 900);
  await openGeo({ seed: 43, diff: 0 });
  await page.evaluate(() => {
    const G = window.__G, b = G.bases[0];
    G.researched.push('laser_rifle');
    b.stores.laser_rifle = 5;
    G.events.push({ t: 'productionDone', baseId: b.id, item: 'laser_rifle', qty: 5 });
    OV.GeoUI.open(G);
  });
  await page.waitForSelector('.geo-pop', { timeout: 8000 }).catch(() => null);
  await sleep(400);
  const fb = await popBtns();
  const ft = await popText();
  log(fb.some((b) => /Trocar armas na/.test(b)) && /armas piores/.test(ft), 'F: «Fabrico concluído» oferece a troca ' + JSON.stringify(fb) + ' «' + ft.slice(0, 200) + '»');
  await shot('F_production_upgrade');
  await clearToasts();
  await page.locator('.geo-pop .btn', { hasText: /Trocar armas/ }).first().click();
  await sleep(400);
  const fr = await page.evaluate(() => window.__sky.soldiers.map((id) => OV.Campaign.findSoldier(window.__G, id).loadout.R).filter((x) => x === 'laser_rifle').length);
  const ftt = await toasts();
  log(fr === 5 && /armas trocadas/.test(ftt), 'F: 5 soldados com Espingarda Laser «' + ftt.replace(/\s+/g, ' ').slice(0, 120) + '»');
  await shot('F_upgrade_done');
  await noMissing('F');
  await ctx.close();

  // =============================== G) briefing longe da base: trocar armas; «e mais N» ===============================
  await newPage(1440, 900);
  await openGeo({ seed: 44, diff: 1 });
  const G0 = await page.evaluate(() => {
    const G = window.__G, c = window.__sky, b = G.bases[0];
    G.researched.push('laser_rifle');
    c.equipment.laser_rifle = (c.equipment.laser_rifle | 0) + 2;
    b.stores.stun_rod = 2;
    b.stores.smoke_grenade = 10;
    const id = 'u960';
    G.ufos.push({ id, type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2, lat: 46, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
    c.lon = 2; c.lat = 46; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
    OV.CampaignUI.launchMission(G, { kind: 'ufo', id }, c.id);
    return OV.Scenes.top().id;
  });
  await sleep(600);
  const gw = await page.evaluate(() => [...document.querySelectorAll('.cp-warns li')].map((l) => l.innerText.replace(/\s+/g, ' ')));
  log(G0 === 'cbriefing' && gw.some((w) => /Há armas melhores a bordo para 2 soldados/.test(w) && /trocar armas/i.test(w)), 'G: briefing avisa das armas melhores ' + JSON.stringify(gw));
  await shot('G_brief_upgrade');
  await clearToasts();
  await page.keyboard.press('u');
  await sleep(600);
  const gt = await toasts();
  const gw2 = await page.evaluate(() => [...document.querySelectorAll('.cp-warns li')].map((l) => l.innerText.replace(/\s+/g, ' ')));
  log(/2 armas trocadas/.test(gt) && !gw2.some((w) => /armas melhores/.test(w)), 'G: U troca e o aviso some «' + gt.replace(/\s+/g, ' ').slice(0, 120) + '»');
  await page.keyboard.press('e');
  await sleep(800);
  const left = await page.evaluate(() => (document.querySelector('.cp-eq-left') || {}).title || '');
  log(/^Ficaram em .*: \d+ × Granada de Fumo, \d+ × Bastão Atordoador|^Ficaram em .*: \d+ × Bastão Atordoador, \d+ × Granada de Fumo/.test(left) && /e mais \d+ tipos?: /.test(left), 'G: «Ficaram em …» com captura primeiro e «e mais N» «' + left.slice(0, 260) + '»');
  await shot('G_equip_left');
  await noMissing('G');
  await ctx.close();

  // =============================== H) dicas «Ritmo» e «h de engenheiro» ===============================
  for (const [w, h] of [[1440, 900], [1024, 700]]) {
    await newPage(w, h);
    await openGeo({ seed: 45, diff: 0 });
    await page.evaluate(() => {
      const G = window.__G, b = G.bases[0];
      G.researched.push('laser_weapons', 'laser_pistol', 'laser_rifle');
      const topic = OV.Campaign.availableResearch(G, b.id)[0];
      OV.BaseSim.startResearch(G, b.id, topic, 5);
      OV.BaseUI.open(G, b.id, 'research');
    });
    await sleep(700);
    const chip = await page.evaluate(() => { const c = document.querySelector('.bsc-chip.prog'); return c ? { text: c.textContent, aria: c.getAttribute('aria-label'), title: c.getAttribute('title') } : null; });
    log(!!chip && /^Ritmo: Desconhecido$/.test(chip.text) && /ainda não sabem quanto tempo/.test(chip.aria) && !!chip.title, w + ': selo do ritmo explicado ' + JSON.stringify(chip));
    await page.locator('.bsc-chip.prog').first().hover();
    await sleep(500);
    await shot('H_research_chip_' + w);
    await page.keyboard.press('3');
    await sleep(500);
    await page.keyboard.press('n');
    await sleep(600);
    const sub = await page.evaluate(() => { const r = document.querySelector('.bsc-pick .bsc-row-sub'); return r ? { text: r.textContent, title: r.getAttribute('title') } : null; });
    log(!!sub && /h de engenheiro/.test(sub.text) && /horas de trabalho de engenheiro por unidade/.test(sub.title || ''), w + ': «h de engenheiro» explicado ' + JSON.stringify(sub));
    if (sub) { await page.locator('.bsc-pick .bsc-row-sub').first().hover(); await sleep(500); }
    await shot('H_production_hours_' + w);
    await noMissing('H ' + w);
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log('✗ exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close().catch(() => null);
  server.kill();
}
for (const e of errors) { console.log('✗ ' + e); fails.push(e); }
console.log((fails.length ? '✗ ' : '✓ ') + (checks - fails.length) + '/' + checks + ' verificações · capturas em ' + OUT);
process.exit(fails.length ? 1 : 0);
