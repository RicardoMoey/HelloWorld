/* Ronda 4 de personas — integração num Chromium real (Playwright). Uma verificação por pendente cruzado:
   A) raio da explosão: civis contados à parte dos aliados («Risco: 2 aliados e 1 civil…», 2.º clique idem);
   B) iPad: as Opções do combate não mostram a roda nem o deslizar pelas margens (com rato mostram);
   C) Geoscape: velocidade do tempo com tabindex móvel (uma paragem de Tab, ← → mudam a velocidade);
   D) «Esperar pelo dia»: um alerta alheio baixa o tempo a 5 seg e, fechada a janela, a espera volta a «30 min»;
   E) relatório rápido: dica do pânico (2+ episódios) e nota «Centro de controlo destruído…» numa vitória pelo objetivo
      (desde a ronda 5: centro destruído e saída com a equipa na nave);
   F) relatório da campanha: alienígenas rendidos em linha própria («rendeu-se»), separados dos capturados.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/integration_r4.mjs [--out <pasta>] */
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
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'integration_r4') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'integration_r4') : path.join(process.cwd(), 'qa-out', 'integration_r4');
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

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const HOST = `http://127.0.0.1:${port}/ovni-1999/index.html`;
const browser = await chromium.launch();
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPAD_UA },
};
const TOUCH = (v) => v === 'padL';

async function openPage(view, tag, query) {
  const ctx = await browser.newContext(VIEWS[view]);
  if (!TOUCH(view)) await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(HOST + '?nosw=1&debug=1' + (query ? '&' + query : ''));
  if (query && /battle=/.test(query)) {
    await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
    await idle(page);
  } else await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI);
  await sleep(300);
  if (TOUCH(view)) await page.evaluate(() => { OV.Input.lastPointerType = 'touch'; });
  return { ctx, page };
}
async function idle(page) {
  await page.waitForFunction(() => {
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: 60000 });
  await sleep(150);
}
const shot = async (page, name) => { await sleep(250); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': sem chaves ⟦…⟧ ' + (m ? [...new Set(m)].join(', ') : ''));
};
const st = (page) => page.evaluate(() => OV.BattleUI.debug.state());
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: (o && o.diff) | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  if (o && o.month) G.month = o.month;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.GeoUI.open(G);
  return true;
};

try {
  if (!(await waitHttp(HOST, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('A. Raio da explosão: civis à parte dos aliados');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'blast-' + view, 'battle=terror&seed=11&diff=0');
    const L = await page.evaluate(() => {
      const B = OV.Game.B, m = B.map;
      B.mission.difficulty = 0;
      const u = OV.BUnits.findUnit(B, OV.BattleUI.debug.state().selectedId);
      u.tu = u.tuMax;
      const oldR = u.items.R;
      if (oldR !== null && oldR !== undefined) { OV.BUnits.takeFromUnit(u, oldR); OV.BUnits.giveItem(B, u, oldR, 'pack', true); }
      const rl = OV.BUnits.newItem(B, 'rocket_launcher', { ammo: 'small_rocket' });
      OV.BUnits.giveItem(B, u, rl.id, 'R', true);
      const mate = B.units.find((x) => x.side === 'xcom' && x.id !== u.id && x.onMap);
      const civ = B.units.find((x) => x.origSide === 'civ' && x.onMap && x.status === 'ok');
      if (!mate || !civ) return null;
      const free = (x, y) => x >= 1 && y >= 1 && x < m.w - 1 && y < m.h - 1
        && !B.units.some((q) => q.onMap && q.status !== 'dead' && q.x === x && q.y === y && q.z === u.z && q !== mate && q !== civ)
        && OV.BUnits.fits(B, mate, OV.BMap.idx(m, x, y, u.z));
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        let ok = true;
        for (let k = 1; k <= 8 && ok; k++) ok = free(u.x + dx * k, u.y + dy * k);
        // alvo a 7 casas; aliado e civil a 1 casa do alvo, de lados opostos da linha
        const tx = u.x + dx * 7, ty = u.y + dy * 7;
        const sx = dy ? 1 : 0, sy = dy ? 0 : 1;
        if (!ok || !free(tx + sx, ty + sy) || !free(tx - sx, ty - sy)) continue;
        OV.BUnits.placeUnit(B, mate, OV.BMap.idx(m, tx + sx, ty + sy, u.z));
        OV.BUnits.placeUnit(B, civ, OV.BMap.idx(m, tx - sx, ty - sy, u.z));
        u.dir = OV.U.dirTo(dx, dy);
        if (OV.LOS.refreshAll) OV.LOS.refreshAll(B);
        if (!OV.LOS.isVisibleTo(B, 'xcom', civ)) continue;
        OV.BattleUI.refresh();
        return { tx, ty, z: u.z, id: u.id };
      }
      return null;
    });
    check(!!L, view + ': lança-foguetes com aliado e civil junto ao alvo ' + JSON.stringify(L));
    if (L) {
      await page.evaluate(([x, y, z]) => OV.BattleUI.debug.centre(x, y, z), [L.tx, L.ty, L.z]);
      await page.keyboard.press('e');
      await page.keyboard.press('1');
      await sleep(200);
      const tp = await page.evaluate(([x, y, z]) => OV.BattleUI.debug.tileToScreen(x, y, z), [L.tx, L.ty, L.z]);
      await page.mouse.move(tp.x, tp.y, { steps: 2 });
      await sleep(250);
      let s = await st(page);
      const sub = (s.target && s.target.sub) || '';
      check(s.mode === 'target' && /^Risco: \d+ aliados? e 1 civil no raio da explosão$/.test(sub), view + ': pré-visualização «' + sub + '» (' + (s.target && s.target.label) + ')');
      await shot(page, 'A-blast-' + view);
      if (view === 'desk') {
        const tu0 = s.unit.tu;
        await page.mouse.click(tp.x, tp.y);
        await sleep(250);
        s = await st(page);
        const sub2 = (s.target && s.target.sub) || '';
        check(s.unit.tu === tu0 && /^Clique outra vez para disparar — atinge \d+ aliados? e 1 civil$/.test(sub2), view + ': 1.º clique pede confirmação «' + sub2 + '»');
        await shot(page, 'A-blast-confirm');
        await page.keyboard.press('Escape');
        await sleep(150);
      }
    }
    await noMissing(page, 'explosão ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('B. Opções do combate: sem roda nem margens no iPad');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'opts-' + view, 'battle=small_scout&seed=3&diff=1');
    // o botão Opções do combate abre o ecrã de Opções geral (a janela própria do combate é o recurso sem ele)
    const lbl = await page.evaluate(() => [OV.T('scr.opt.wheel'), OV.T('scr.opt.edgeScroll'), OV.T('hud.btn.options')]);
    const btnSel = 'button[aria-label="' + lbl[2] + ' (Esc)"]';
    if (TOUCH(view)) await page.locator(btnSel).first().tap();
    else await page.locator(btnSel).first().click();
    await page.waitForSelector('.scr-opts');
    await sleep(300);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.scr-opts [id^="scr-opt-l"]')].map((n) => n.textContent.trim()));
    const hasW = rows.indexOf(lbl[0]) >= 0, hasE = rows.indexOf(lbl[1]) >= 0;
    if (TOUCH(view)) check(!hasW && !hasE && rows.length >= 6, view + ': sem «' + lbl[0] + '» nem «' + lbl[1] + '» (' + rows.length + ' linhas)');
    else check(hasW && hasE, view + ': com rato as duas linhas ficam (' + rows.length + ' linhas)');
    await shot(page, 'B-opts-' + view);
    await noMissing(page, 'opções ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('C. Geoscape: velocidade do tempo com tabindex móvel');
  {
    const { ctx, page } = await openPage('zoom', 'speed');
    await page.evaluate(NEWG, { diff: 1 });
    await sleep(600);
    const tabs = () => page.evaluate(() => [...document.querySelectorAll('.geo-speeds [role=radio]')].map((b) => b.tabIndex + ':' + b.getAttribute('aria-checked')));
    let t0 = await tabs();
    check(t0.length === 6 && t0.filter((x) => x.startsWith('0:')).length === 1 && t0.findIndex((x) => x.startsWith('0:')) === t0.findIndex((x) => x.endsWith(':true')), 'uma só paragem de Tab, na velocidade marcada ' + JSON.stringify(t0));
    await page.evaluate(() => document.querySelector('.geo-speeds [role=radio][tabindex="0"]').focus());
    const sp0 = await page.evaluate(() => window.__G.ui.geo.speed | 0);
    await page.keyboard.press('ArrowRight');
    await sleep(200);
    const r1 = await page.evaluate(() => ({ sp: window.__G.ui.geo.speed, foc: [...document.querySelectorAll('.geo-speeds [role=radio]')].indexOf(document.activeElement) }));
    t0 = await tabs();
    check(r1.sp === sp0 + 1 && r1.foc === sp0 + 1 && t0[sp0 + 1] === '0:true', '→ sobe a velocidade e leva o foco ' + JSON.stringify({ sp0, r1, t0 }));
    await shot(page, 'C-speed');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);
    const r2 = await page.evaluate(() => window.__G.ui.geo.speed);
    check(r2 === sp0, '← volta (' + r2 + ')');
    await noMissing(page, 'velocidade');
    await ctx.close();
  }

  // =============================================================================================================
  log('D. «Esperar pelo dia»: depois de um alerta alheio, a velocidade da espera volta');
  {
    const { ctx, page } = await openPage('desk', 'wait');
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    const ok = await page.evaluate(() => {
      const G = window.__G;
      let lon = null;
      for (let l = -180; l < 180; l += 10) if (OV.GMath.dayPhase(G, l, 20) === 'night' && OV.GMath.dayPhase({ t: G.t + 4 * 3600 }, l, 20) === 'night') { lon = l; break; }
      if (lon === null) return false;
      G.alienMissions.length = 0;
      G.ufos.length = 0;
      G.ufos.push({ id: 'u950', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon, lat: 20, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const c = window.__sky;
      c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id: 'u950' };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id: 'u950' }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return true;
    });
    await sleep(900);
    await page.locator('.geo-pop .btn.primary').first().click();
    await sleep(400);
    let s = await page.evaluate(() => ({ sp: window.__G.ui.geo.speed, wait: (window.__G.ui.waitDay || []).length }));
    check(ok && s.wait === 1 && s.sp >= 3, 'espera com o tempo acelerado ' + JSON.stringify(s));
    // um «OVNI detetado» alheio a meio da espera (o mundo para com reason 'event')
    await page.evaluate(() => {
      const G = window.__G;
      G.ufos.push({ id: 'u951', type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 10, lat: 45, dest: null, alt: 2, speed: 300, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const orig = OV.World.step;
      OV.World.step = (G2, n) => {
        OV.World.step = orig;
        const r = orig(G2, Math.min(n, 60));
        G2.events.push({ t: 'ufoDetected', ufoId: 'u951', hyper: false });
        return { ticks: r.ticks, stopped: true, reason: 'event' };
      };
    });
    await page.waitForSelector('.geo-pop', { timeout: 8000 });
    await sleep(300);
    s = await page.evaluate(() => ({ sp: window.__G.ui.geo.speed, pop: (document.querySelector('.geo-pop') || {}).innerText || '' }));
    check(s.sp === 0 && /OVNI/i.test(s.pop), 'o alerta baixa o tempo a 5 seg ' + JSON.stringify({ sp: s.sp, pop: s.pop.replace(/\s+/g, ' ').slice(0, 60) }));
    await shot(page, 'D-alert');
    // o OVNI de teste sai do mapa (senão o «saiu do alcance dos radares» seguinte voltava a parar o relógio)
    await page.evaluate(() => {
      const G = window.__G;
      G.ufos.splice(G.ufos.findIndex((u) => u.id === 'u951'), 1);
      for (const n of document.querySelectorAll('#toasts .toast')) n.remove();
    });
    const t1 = await page.evaluate(() => window.__G.t);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /continua à espera do amanhecer/.test(document.getElementById('toasts').innerText), null, { timeout: 4000 }).catch(() => null);
    s = await page.evaluate(() => ({ sp: window.__G.ui.geo.speed, pop: ((document.querySelector('.geo-pop') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 80), wait: (window.__G.ui.waitDay || []).length, toast: document.getElementById('toasts').innerText }));
    // a 30 min por passo o amanhecer pode chegar logo a seguir: então a janela «Equipa no local» já voltou
    const dawn = s.wait === 0 && /amanhec/i.test(s.pop);
    check(/continua à espera do amanhecer/.test(s.toast) && (s.sp >= 3 || dawn), 'fechada a janela, a espera volta a acelerar ' + JSON.stringify(s));
    await sleep(900);
    const dt = await page.evaluate((t) => window.__G.t - t, t1);
    check(dt >= 1800, 'o tempo correu depressa depois do alerta (+' + dt + ' s de jogo)');
    await shot(page, 'D-resumed');
    await noMissing(page, 'espera');
    await ctx.close();
  }

  // =============================================================================================================
  log('E. Relatório rápido: dica do pânico; vitória pelo objetivo');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'deb-' + view);
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'landed', ufo: 'medium_scout', month: 0, seed: 21, squad: 6, diff: 1 });
      const B = OV.Battle.create(mission);
      const xs = B.units.filter((u) => u.side === 'xcom' && u.type === 'soldier');
      const al = B.units.find((u) => u.origSide === 'alien');
      for (const u of xs) OV.Combat.killUnit(B, u, al.id, 'shot');
      B.stats.xcomPanics = 3;
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(400);
    let r = await page.evaluate(() => ({ res: document.querySelector('.scr-result').textContent, tip: (document.querySelector('.scr-deb-cause .scr-tip') || {}).textContent || '' }));
    check(/DERROTA/i.test(r.res) && /pânico/.test(r.tip) && /oficial/.test(r.tip), view + ': derrota com pânico: «' + r.tip.slice(0, 160) + '»');
    await shot(page, 'E-panic-' + view);
    await noMissing(page, 'pânico ' + view);
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'alienBase', month: 3, seed: 5, squad: 8, diff: 1 });
      const B = OV.Battle.create(mission);
      // centro de controlo destruído com alienígenas ainda de pé
      for (const i of B.objectiveTiles) for (let p = 0; p < 4; p++) {
        const d = OV.BMap.def(B.map, i, p);
        if (d && d.special === 'OBJECTIVE') B.map.parts[i * 4 + p] = 0;
      }
      // regra orig (persona r5): o centro destruído não acaba a batalha; sair (abortar com a equipa na nave) é a vitória
      window.__mid = OV.Battle.outcome(B);
      OV.Battle.abort(B);
      window.__out = OV.Battle.outcome(B);
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(400);
    r = await page.evaluate(() => ({ mid: window.__mid, out: window.__out, res: document.querySelector('.scr-result').textContent, good: [...document.querySelectorAll('.scr-deb-cause .scr-cause.good')].map((n) => n.textContent).join(' | ') }));
    check(r.mid === null && r.out === 'win' && /VITÓRIA/i.test(r.res) && /^Centro de controlo destruído/.test(r.good), view + ': vitória pelo objetivo: «' + r.good + '»');
    await shot(page, 'E-objective-' + view);
    await noMissing(page, 'objetivo ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('F. Relatório da campanha: alienígenas rendidos em linha própria');
  {
    const { ctx, page } = await openPage('desk', 'cdeb');
    const r = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 7, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'alienBase', month: 3, seed: 5, squad: 8, diff: 1 });
      const B = OV.Battle.create(mission);
      for (const u of B.units) if (u.origSide === 'alien') { u.status = 'dead'; u.hp = 0; }
      const deb = OV.Battle.debrief(B);
      const race = OV.Data.races[mission.race] || {};
      const cmd = (race.members && race.members.commander) || 'sectoid_commander';
      const lead = (race.members && race.members.leader) || 'sectoid_leader';
      const model = {
        debrief: deb, mission, meta, outcome: 'continue', stored: {}, capturedLost: {}, craftLost: false, storage: null,
        capturedStored: { [cmd]: 1, [lead]: 2 }, surrendered: { [cmd]: 1, [lead]: 1 }, progression: [], promotions: [],
      };
      OV.Scenes.set('menu');
      OV.Scenes.push('cdebrief', { G, B, model, onDone: () => {} });
      return { cmd: OV.T(OV.Data.units[cmd].nameKey), lead: OV.T(OV.Data.units[lead].nameKey) };
    });
    await page.waitForSelector('.cp-deb .scr-result');
    await sleep(400);
    const li = await page.evaluate(() => [...document.querySelectorAll('.cp-deb .cp-warns li')].map((n) => n.textContent));
    const sur = li.filter((x) => /rendeu-se quando tomámos a base/.test(x));
    const cont = li.filter((x) => /: para a contenção/.test(x));
    check(sur.length === 2 && sur.some((x) => x.indexOf(r.cmd + ' ×1') === 0) && sur.some((x) => x.indexOf(r.lead + ' ×1') === 0), 'rendidos: ' + JSON.stringify(sur));
    check(cont.length === 1 && cont[0].indexOf(r.lead + ' ×1') === 0, 'capturados pela equipa (2 − 1 rendido): ' + JSON.stringify(cont));
    await shot(page, 'F-surrender');
    await noMissing(page, 'contenção');
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
  console.log(e);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) fails.push(e);
console.log((fails.length ? '✗ ' : '✓ ') + (checks - (fails.length - errors.length)) + '/' + checks + ' verificações; capturas em ' + OUT);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
