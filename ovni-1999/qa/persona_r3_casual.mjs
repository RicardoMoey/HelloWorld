/* Ronda 3 de personas — QA da jogadora casual (Sofia, Recruta, trackpad) num Chromium real (Playwright):
   A) granada alienígena com espoleta 0 que rebenta no fim do turno X-COM: a baixa aparece no relatório do turno
      («Desde o fim do seu turno» › «No fim do turno X-COM — rebentaram granadas», causa «granada alienígena»);
   B) Skyranger a caminho de um ataque terrorista: «OVNI aterrou» diz para onde vai e o que custa, a linha do
      «Enviar equipa» mostra «· a caminho do ataque em …» e escolhê-la pergunta («Manter rumo» por omissão);
   C) chegada ao crepúsculo: aviso verdadeiro e «Esperar pelo dia» oferecido (atacar continua a ser o Enter);
   D) intercetor sem munição: o aviso explica as caixas inteiras e abre o Mercado com a quantidade sugerida;
   E) género e plurais: «Promovida a …» no debrief, «1 apto · 1 ferido» no Pessoal.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 1194×834 (toque). Falha em erros de consola/página ou ⟦…⟧.
   Uso: node ovni-1999/qa/persona_r3_casual.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r3_casual') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r3_casual') : path.join(process.cwd(), 'qa-out', 'persona_r3_casual');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails.push(msg); };
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

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const ROOT_URL = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;
const browser = await chromium.launch();

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: false, deviceScaleFactor: 2, userAgent: IPAD_UA },
};
const TOUCH = (v) => v === 'padL';

async function openPage(view, tag, query) {
  const ctx = await browser.newContext(VIEWS[view]);
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(ROOT_URL + (query ? '&' + query : ''));
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI && OV.BaseUI && OV.BattleUI);
  await sleep(300);
  if (TOUCH(view)) await page.evaluate(() => { OV.Input.lastPointerType = 'touch'; });
  return { ctx, page };
}
const shot = async (page, name) => { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': sem chaves ⟦…⟧ ' + (m ? [...new Set(m)].join(', ') : ''));
};
const press = async (page, view, sel) => {
  const loc = page.locator(sel).first();
  if (TOUCH(view)) await loc.tap();
  else await loc.click();
};
const popInfo = (page) => page.evaluate(() => {
  const p = document.querySelector('.geo-pop');
  return p ? { text: p.innerText, prim: (p.querySelector('.btn.primary') || {}).textContent || '', btns: [...p.querySelectorAll('.geo-pop-a .btn')].map((b) => b.textContent) } : null;
});
// campanha nova (Recruta) no Geoscape, sem a introdução
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.GeoUI.open(G);
  return true;
};
// ataque terrorista em curso com o Skyranger a caminho + OVNI aterrado noutro sítio
const BUSY = () => {
  const G = window.__G, c = window.__sky, C = OV.Campaign;
  const city = Object.keys(OV.Data.citiesById).find((k) => /budap/i.test(k)) || Object.keys(OV.Data.citiesById)[0];
  const cc = OV.Data.citiesById[city];
  const site = { id: C.nextId(G, 't'), kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: city, lon: cc.lon, lat: cc.lat, race: 'sectoid', leftS: 9 * 3600 };
  G.sites.push(site);
  const uid = C.nextId(G, 'u');
  G.ufos.push({ id: uid, type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2, lat: 46, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 5 * 3600, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
  const r = OV.World.launch(G, c.id, { kind: 'site', id: site.id });
  window.__site = site.id;
  window.__ufo = uid;
  return { ok: r.ok, status: c.status, dest: c.dest };
};

try {
  if (!(await waitHttp(ROOT_URL, 8000))) throw new Error('servidor HTTP não arrancou');

  // ============================================================================================================
  log('A. Granada alienígena no fim do turno X-COM → relatório do turno');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'nade-' + view, 'battle=medium_scout&seed=7&diff=0');
    await page.waitForFunction(() => OV.BattleUI.scene && OV.BattleUI.debug.state() && !OV.BattleUI.debug.state().playing, null, { timeout: 60000 });
    await sleep(400);
    const setup = await page.evaluate(() => {
      const B = OV.Game.B;
      OV.Game.settings.confirmEndTurn = false;
      for (const u of B.units) if (u.side === 'alien') { u.tu = 0; u.stats.tu = 0; }
      const xs = B.units.filter((u) => u.side === 'xcom' && u.onMap);
      const v = xs[0];
      const al = B.units.find((u) => u.side === 'alien');
      const i = (v.z * B.map.h + v.y) * B.map.w + v.x;
      const g = OV.BUnits.newItem(B, 'alien_grenade', { at: i });
      g.fuse = 0;
      g.primedBy = al.id;
      OV.Battle.rebuildDerived(B);
      window.__victim = v.id;
      return { name: v.name, hp: v.hp };
    });
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => { const s = OV.BattleUI.debug.state(); return s && s.side === 'xcom' && s.turn === 2 && !s.playing; }, null, { timeout: 90000 });
    await sleep(500);
    const rep = await page.evaluate(() => ({
      title: (document.querySelector('.bs-report-title') || {}).textContent || '',
      sum: (document.querySelector('.bs-report-sum') || {}).textContent || '',
      rows: Array.from(document.querySelectorAll('.bs-report-list > div')).map((n) => n.textContent),
      hit: (() => { const u = OV.BUnits.findUnit(OV.Game.B, window.__victim); return { st: u.status, hp: u.hp }; })(),
    }));
    check(rep.hit.st === 'dead' || rep.hit.hp < setup.hp, view + ': a granada atingiu ' + setup.name + ' ' + JSON.stringify(rep.hit));
    check(/Desde o fim do seu turno/.test(rep.title), view + ': título «' + rep.title + '»');
    const k = rep.rows.findIndex((r) => /No fim do turno X-COM/.test(r));
    check(k === 0 && rep.rows.slice(1).some((r) => r.indexOf(setup.name) >= 0 && /granada alienígena/.test(r)), view + ': secção do fim do turno com a baixa e a causa ' + JSON.stringify(rep.rows.slice(0, 4)));
    check(/morto|ferido/.test(rep.sum), view + ': resumo «' + rep.sum + '»');
    await shot(page, 'A-' + view + '-turnEnd-report');
    // o registo de mensagens (N) separa o fim do turno X-COM das ações do jogador
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.press('n');
    await sleep(400);
    const lg = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-report-list .bs-report-turn')).map((n) => n.textContent));
    check(lg.some((x) => /Turno 1 — fim do turno X-COM/.test(x)), view + ': registo com «Turno 1 — fim do turno X-COM» ' + JSON.stringify(lg));
    await shot(page, 'A-' + view + '-log');
    await noMissing(page, 'A ' + view);
    await ctx.close();
  }

  // ============================================================================================================
  log('B. Skyranger a caminho de um ataque terrorista: «OVNI aterrou» e «Enviar equipa»');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'busy-' + view);
    await page.evaluate(NEWG, { seed: 41 });
    const b = await page.evaluate(BUSY);
    check(b.ok && b.dest && b.dest.kind === 'site', view + ': Skyranger a caminho do ataque ' + JSON.stringify(b));
    await page.evaluate(() => { window.__G.events.push({ t: 'ufoLanded', ufoId: window.__ufo }); OV.GeoUI.open(window.__G); });
    await sleep(900);
    const pop = await popInfo(page);
    check(pop && /OVNI aterrou/i.test(pop.text) && /já segue a caminho do ataque em/.test(pop.text) && /sem resposta \(−500 pontos\)/.test(pop.text), view + ': «OVNI aterrou» diz para onde vai e o custo ' + JSON.stringify(pop && pop.text.slice(0, 260)));
    await shot(page, 'B-' + view + '-ufoLanded');
    await press(page, view, '.geo-pop .btn.primary');
    await sleep(700);
    const row = await page.evaluate(() => {
      const r = document.querySelector('.geo-dlg .geo-row.transport');
      return r ? { sub: (r.querySelector('small') || {}).textContent || '', note: (r.querySelector('em') || {}).textContent || '' } : null;
    });
    check(row && /a caminho do ataque em/.test(row.sub), view + ': linha da nave com «a caminho do ataque em …» ' + JSON.stringify(row));
    check(row && /sem resposta: −500 pontos/.test(row.note), view + ': nota a vermelho com o custo ' + JSON.stringify(row && row.note));
    await shot(page, 'B-' + view + '-dialog');
    await press(page, view, '.geo-dlg .geo-row.transport');
    await sleep(600);
    const md = await page.evaluate(() => {
      const m = document.querySelector('#modals .modal');
      return m ? { text: m.innerText, prim: (m.querySelector('.btn.primary') || {}).textContent || '', foc: (document.activeElement || {}).textContent || '' } : null;
    });
    check(md && /Desviar Skyranger-1\?/i.test(md.text) && /ninguém responde ao ataque/.test(md.text) && /500 pontos/.test(md.text), view + ': pergunta antes de desviar ' + JSON.stringify(md && md.text.slice(0, 200)));
    check(md && /Manter rumo/.test(md.prim), view + ': «Manter rumo» é o principal ' + JSON.stringify(md && md.prim));
    await shot(page, 'B-' + view + '-divert');
    if (TOUCH(view)) await page.locator('#modals .btn.primary').tap();
    else await page.keyboard.press('Enter');
    await sleep(500);
    const keep = await page.evaluate(() => window.__sky.dest);
    check(keep && keep.kind === 'site', view + ': «Manter rumo» deixa a nave no ataque ' + JSON.stringify(keep));
    if (view === 'desk') {
      await press(page, view, '.geo-dlg .geo-row.transport');
      await sleep(500);
      await page.locator('#modals .btn.danger').click();
      await sleep(500);
      const go = await page.evaluate(() => window.__sky.dest);
      check(go && go.kind === 'ufo', '«Desviar mesmo assim» manda a nave para o OVNI ' + JSON.stringify(go));
    }
    await noMissing(page, 'B ' + view);
    await ctx.close();
  }

  // ============================================================================================================
  log('C. Chegada ao crepúsculo: aviso e «Esperar pelo dia»');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'dusk-' + view);
    await page.evaluate(NEWG, { seed: 43 });
    const ok = await page.evaluate(() => {
      const G = window.__G;
      let lon = null;
      for (let l = -180; l < 180 && lon === null; l++) if (OV.GMath.dayPhase(G, l, 52) === 'dusk') lon = l;
      if (lon === null) return false;
      const id = OV.Campaign.nextId(G, 'u');
      G.ufos.push({ id, type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon, lat: 52, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const c = window.__sky;
      c.lon = lon; c.lat = 52; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return true;
    });
    await sleep(900);
    const pop = await popInfo(page);
    check(ok && pop && /Lá é crepúsculo/.test(pop.text) && /20 casas/.test(pop.text), view + ': aviso do crepúsculo ' + JSON.stringify(pop && pop.text.slice(0, 260)));
    check(pop && pop.btns.some((t) => /Esperar pelo dia/.test(t)) && /Iniciar missão/i.test(pop.prim), view + ': «Esperar pelo dia» oferecido, «Iniciar missão» por omissão ' + JSON.stringify(pop && pop.btns));
    await shot(page, 'C-' + view + '-dusk');
    if (!TOUCH(view)) await page.keyboard.press('w');
    else await page.locator('.geo-pop .btn', { hasText: 'Esperar pelo dia' }).tap();
    await sleep(500);
    const w = await page.evaluate(() => ({ wait: (window.__G.ui.waitDay || []).length, top: OV.Scenes.top().id }));
    check(w.wait === 1 && w.top === 'geoscape', view + ': esperar pelo dia fica registado ' + JSON.stringify(w));
    await noMissing(page, 'C ' + view);
    await ctx.close();
  }

  // ============================================================================================================
  log('D. Intercetor sem munição: caixas inteiras e Mercado com a quantidade sugerida');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'ammo-' + view);
    await page.evaluate(NEWG, { seed: 44 });
    const sug = await page.evaluate(() => {
      const G = window.__G, b = G.bases[0];
      const icp = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => (c.weapons || []).some((w) => w && w.type === 'cannon'));
      b.stores.cannon_rounds = 0;
      icp.weapons.find((w) => w && w.type === 'cannon').ammo = 194;
      G.events.push({ t: 'craftRearmShort', craftId: icp.id, itemId: 'cannon_rounds', what: 'ammo' });
      OV.GeoUI.open(G);
      return OV.GeoUI.model.ammoSuggest(G, b.id, 'cannon_rounds').qty;
    });
    await sleep(900);
    const pop = await popInfo(page);
    check(pop && /caixas inteiras de 50/.test(pop.text) && new RegExp('Sugestão: comprar ' + sug + ' ').test(pop.text), view + ': o aviso explica as caixas e sugere ' + sug + ' ' + JSON.stringify(pop && pop.text.slice(0, 300)));
    check(pop && new RegExp('Comprar munição \\(×' + sug + '\\)').test(pop.prim), view + ': botão «' + (pop && pop.prim) + '»');
    await shot(page, 'D-' + view + '-popup');
    await press(page, view, '.geo-pop .btn.primary');
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'basescape', null, { timeout: 8000 });
    await sleep(700);
    const mk = await page.evaluate(() => {
      const r = document.querySelector('[data-buy="cannon_rounds"]');
      return r ? { qty: (r.querySelector('.bsc-step-v') || {}).textContent || '', text: r.innerText, hl: r.classList.contains('bsc-hl') } : null;
    });
    check(mk && mk.qty === String(sug) && mk.hl, view + ': Mercado com ' + sug + ' caixas na linha realçada ' + JSON.stringify(mk && { qty: mk.qty, hl: mk.hl }));
    check(mk && /Caixa de 50 munições: cada rearme/.test(mk.text), view + ': linha do Mercado explica as caixas');
    await shot(page, 'D-' + view + '-market');
    await noMissing(page, 'D ' + view);
    await ctx.close();
  }

  // ============================================================================================================
  log('E. Género e plurais: «Promovida a …», «1 apto · 1 ferido»');
  {
    const { ctx, page } = await openPage('desk', 'promo', 'battle=small_scout&seed=11&diff=0');
    await page.waitForFunction(() => OV.BattleUI.scene && OV.BattleUI.debug.state() && !OV.BattleUI.debug.state().playing, null, { timeout: 60000 });
    const who = await page.evaluate(() => {
      const B = OV.Game.B;
      const u = B.units.find((x) => x.origSide === 'xcom' && x.type === 'soldier');
      u.female = true;
      const sq = (B.mission.squad || []).find((x) => x.soldierId === u.soldierId);
      if (sq) sq.female = true;
      const s = { soldierId: u.soldierId, name: u.name };
      for (const a of B.units) if (a.side === 'alien' && a.status !== 'dead') OV.Combat.killUnit(B, a, null, 'test');
      const deb = OV.Battle.debrief(B);
      OV.Scenes.replace('debrief', { B, debrief: deb, outcome: 'win', progression: [{ soldierId: s.soldierId, gains: { tu: 2 }, promoted: 1, kills: 1 }] });
      return s.name;
    });
    await sleep(900);
    const promo = await page.evaluate(() => [...document.querySelectorAll('.scr-promo')].map((n) => n.textContent));
    check(promo.length === 1 && /^Promovida a /.test(promo[0]), 'debrief: «' + promo.join(' | ') + '» (' + who + ')');
    await shot(page, 'E-debrief-promovida');
    await noMissing(page, 'E debrief');
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage('desk', 'pers');
    await page.evaluate(NEWG, { seed: 45 });
    await page.evaluate(() => {
      const G = window.__G, b = G.bases[0];
      const sols = b.soldiers.map((id) => OV.Campaign.findSoldier(G, id));
      sols.forEach((s, k) => { s.woundDays = k === 0 ? 0 : k === 1 ? 5 : 0; });
      // só 2 soldados na base: 1 apto, 1 ferido
      for (const s of sols.slice(2)) { OV.BaseSim.assignSoldier(G, s.id, null); OV.BaseSim.sack(G, b.id, 'soldier', s.id); }
      OV.BaseUI.open(G, b.id, 'personnel');
    });
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'basescape', null, { timeout: 8000 });
    await sleep(700);
    const txt = await page.evaluate(() => document.body.innerText);
    const m = txt.match(/\d+ aptos? · \d+ feridos?/);
    check(!!m && !/\b1 aptos\b|\b1 feridos\b/.test(txt), 'Pessoal: «' + (m ? m[0] : '—') + '» (sem «1 aptos»/«1 feridos»)');
    await shot(page, 'E-personnel');
    await noMissing(page, 'E pessoal');
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack || e));
  console.log(e);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) fails.push(e);
console.log('\n' + checks + ' verificações · ' + fails.length + ' falhas · capturas em ' + OUT);
if (fails.length) {
  for (const f of fails) console.log('✗ ' + f);
  process.exit(1);
}
