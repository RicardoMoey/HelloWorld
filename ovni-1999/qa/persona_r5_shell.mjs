/* Ronda de personas 5 — QA do «shell» num Chromium real (Playwright): dica que não fica presa ao trocar de cena (Esc
   no Mercado, modal), «Ficaram em…» com «(N a bordo)», «Equipar para a noite» no briefing e no Equipar, OVNI que
   descola antes do dia (Atacar já por omissão), transporte que regressa quando o OVNI levanta voo e «Alvo perdido»
   com «Regressar», «Vender material» em Vender, «Próximos passos» clicáveis (rato, teclado e toque), embarque dos
   aptos quando a nave volta, briefing de OVNI danificado, botões segmentados com aria-pressed e ✓, avisos da base em
   retrato por baixo dos separadores, saúde distinta das UT na paleta para daltonismo.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 834×1194 / 1194×834 (toque).
   Falha em erros de consola/página ou ⟦…⟧. Uso: node ovni-1999/qa/persona_r5_shell.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r5_shell') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r5_shell') : path.join(process.cwd(), 'qa-out', 'persona_r5_shell');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } };
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
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;
const browser = await chromium.launch();

const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  padP: { viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
const ALL = ['desk', 'zoom', 'padP', 'padL'];
const TOUCH = (v) => v === 'padP' || v === 'padL';

async function openPage(view, tag) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI && OV.BaseUI);
  await sleep(300);
  if (TOUCH(view)) await page.evaluate(() => { OV.Input.lastPointerType = 'touch'; });
  return { ctx, page };
}
const shot = async (page, name) => { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const topId = (page) => page.evaluate(() => (OV.Scenes.top() || {}).id);
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': chaves i18n em falta ' + (m ? [...new Set(m)].join(', ') : ''));
};
const press = async (page, view, sel) => {
  const loc = page.locator(sel).first();
  if (TOUCH(view)) await loc.tap();
  else await loc.click();
};
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: (o && o.diff) | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  if (o && o.month) G.month = o.month;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.GeoUI.open(G);
  return true;
};
// noite num ponto (lat 20) que fica de noite pelo menos h horas → lon
const NIGHT_LON = (h) => {
  const G = window.__G;
  for (let l = -180; l < 180; l += 5) {
    let ok = true;
    for (let k = 0; k <= h; k++) if (OV.GMath.dayPhase({ t: G.t + k * 3600 }, l, 20) !== 'night') { ok = false; break; }
    if (ok) return l;
  }
  return null;
};
const PUT_UFO = (o) => {
  const G = window.__G;
  const id = 'u' + (950 + G.ufos.length);
  G.ufos.push({ id, type: o.type || 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: o.lon, lat: o.lat, dest: null, alt: 0, speed: 0, status: o.status || 'landed', dmg: o.dmg | 0, detected: true, hyper: false, groundLeftS: o.groundLeftS || 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
  return id;
};
const popText = () => { const p = document.querySelector('.geo-pop'); if (!p) return ''; return p.innerText.replace(/\s+/g, ' '); };
const popPrimary = () => { const b = document.querySelector('.geo-pop .btn.primary'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : ''; };

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Dica do Mercado não fica presa no Geoscape (Esc com o rato em COMPRAR; modal; nó removido)');
  {
    const { ctx, page } = await openPage('desk', 'tip');
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'market'));
    await sleep(600);
    const buy = page.locator('.bsc [data-act="buy"]').first();
    const bb = await buy.boundingBox();
    await page.mouse.move(bb.x + 2, bb.y + 2);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
    await sleep(350);
    const shown = await page.evaluate(() => !document.getElementById('tooltip').classList.contains('hidden'));
    check(shown, 'a dica de COMPRAR aparece com o rato por cima');
    await page.keyboard.press('Escape');
    await sleep(500);
    const after = await page.evaluate(() => ({ top: OV.Scenes.top().id, hidden: document.getElementById('tooltip').classList.contains('hidden') }));
    check(after.top === 'geoscape' && after.hidden, 'Esc para o Geoscape esconde a dica ' + JSON.stringify(after));
    await shot(page, 'tip-after-esc-desk');
    // dica órfã (nó removido sem mouseleave): o primeiro movimento esconde-a
    const orphan = await page.evaluate(() => {
      const b = document.createElement('button');
      b.textContent = 'x';
      b.style.cssText = 'position:fixed;left:600px;top:400px;width:80px;height:40px;z-index:99';
      document.body.appendChild(b);
      OV.Dom.tooltip(b, 'teste');
      return true;
    });
    await page.mouse.move(610, 410, { steps: 3 });
    await page.mouse.move(630, 420, { steps: 3 });
    await sleep(200);
    const vis1 = await page.evaluate(() => !document.getElementById('tooltip').classList.contains('hidden'));
    await page.evaluate(() => { const b = [...document.body.children].find((n) => n.tagName === 'BUTTON' && n.textContent === 'x'); if (b) b.remove(); });
    await page.mouse.move(900, 300, { steps: 3 });
    await sleep(150);
    const vis2 = await page.evaluate(() => !document.getElementById('tooltip').classList.contains('hidden'));
    check(orphan && vis1 && !vis2, 'dica cujo nó saiu do DOM some ao mexer o rato (' + vis1 + ' → ' + vis2 + ')');
    await noMissing(page, 'dica');
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Briefing noturno longe da base: «Equipar para a noite», «Ficaram em … (N a bordo)», OVNI danificado');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'kit-' + view);
    await page.evaluate(NEWG, { diff: 2 });
    const setup = await page.evaluate(({ NL, PU }) => {
      const G = window.__G, c = window.__sky, C = OV.Campaign;
      const lon = (0, eval)('(' + NL + ')')(6);
      if (lon === null) return { ok: false };
      // no hangar: ninguém leva sinalizadores nem kit médico (voltam ao armazém)
      const pool = C.equipPool(G, c.id);
      const st = Object.assign({}, pool.stores), los = {};
      for (const s of pool.squad) {
        const lo = s.loadout;
        const drop = (a) => a.filter((x) => { if (x === 'electro_flare' || x === 'medikit') { st[x] = (st[x] | 0) + 1; return false; } return true; });
        los[s.id] = { R: lo.R, L: lo.L, belt: drop(lo.belt || []), pack: drop(lo.pack || []) };
      }
      const r = C.applyEquip(G, c.id, { loadouts: los, stores: st });
      const b = C.findBase(G, c.baseId);
      // a bordo, soltos: 4 sinalizadores e 1 kit; no armazém fica muito mais
      c.equipment.electro_flare = (c.equipment.electro_flare | 0) + 4;
      c.equipment.medikit = (c.equipment.medikit | 0) + 1;
      b.stores.electro_flare = 12;
      b.stores.grenade = 15;
      const id = (0, eval)('(' + PU + ')')({ lon, lat: 20, type: 'large_scout', dmg: 118 });
      c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      return { ok: !!(r && r.ok), id };
    }, { NL: NIGHT_LON.toString(), PU: PUT_UFO.toString() });
    check(setup.ok, view + ': preparação ' + JSON.stringify(setup));
    await page.evaluate((id) => OV.CampaignUI.launchMission(window.__G, { kind: 'ufo', id }, window.__sky.id), setup.id);
    await sleep(700);
    const br = await page.evaluate(() => ({
      top: OV.Scenes.top().id,
      warns: [...document.querySelectorAll('.cp-warns li')].map((li) => li.innerText.replace(/\s+/g, ' ')),
      kit: !!document.querySelector('.cp-warns [data-act="kit"]'),
      kitTxt: ((document.querySelector('.cp-warns [data-act="kit"]') || {}).textContent || ''),
      notes: [...document.querySelectorAll('.scr-note')].map((n) => n.innerText).join(' | '),
    }));
    check(br.top === 'cbriefing' && br.kit && /noite/i.test(br.kitTxt), view + ': botão «Equipar para a noite» ' + JSON.stringify(br.warns));
    check(br.warns.some((w) => /sinalizadores a bordo/.test(w)) && br.warns.some((w) => /kit médico a bordo/.test(w)), view + ': avisos de sinalizadores e kit a bordo');
    check(/danificado/.test(br.notes) && !/casco intacto/.test(br.notes), view + ': OVNI danificado no briefing ' + br.notes.slice(0, 160));
    await shot(page, 'brief-night-' + view);
    // Equipar: «Ficaram em … (4 a bordo)» com os sinalizadores logo a seguir à captura, e o botão «Equipar para a noite»
    await press(page, view, '.cp-brief .scr-foot .btn:has-text("Equipar")');
    await sleep(700);
    const eq = await page.evaluate(() => ({ top: OV.Scenes.top().id, left: ((document.querySelector('.cp-eq-left') || {}).textContent || ''), kit: !!document.querySelector('.cp-eq [data-act="kit"]') }));
    check(eq.top === 'equip' && /12 × Sinalizador \(4 a bordo\)/.test(eq.left) && /Granada(?! de Fumo)/.test(eq.left), view + ': «Ficaram em…» com o que vai a bordo «' + eq.left.slice(0, 220) + '»');
    check(eq.kit, view + ': «Equipar para a noite» no rodapé do Equipar');
    await shot(page, 'equip-night-' + view);
    if (view === 'desk') {
      await page.keyboard.press('k');
      await sleep(600);
      const after = await page.evaluate(() => ({ kit: !!document.querySelector('.cp-eq [data-act="kit"]'), toast: document.getElementById('toasts').innerText, top: OV.Scenes.top().id }));
      check(after.top === 'equip' && !after.kit && /sinaliza/i.test(after.toast), 'K no Equipar aplica o kit e o botão desaparece ' + JSON.stringify(after));
      await page.keyboard.press('Enter');
      await sleep(600);
      const br2 = await page.evaluate(() => ({ top: OV.Scenes.top().id, kit: !!document.querySelector('.cp-warns [data-act="kit"]'), flares: (OV.Game.G || window.__G).activeMission ? 0 : 0 }));
      check(br2.top === 'cbriefing' && !br2.kit, 'de volta ao briefing sem o aviso de kit ' + JSON.stringify(br2));
    } else if (view === 'padL') {
      await press(page, view, '.cp-eq .scr-foot .btn:has-text("Concluído")');
      await sleep(600);
      await press(page, view, '.cp-warns [data-act="kit"]');
      await sleep(600);
      const br3 = await page.evaluate(() => ({ top: OV.Scenes.top().id, kit: !!document.querySelector('.cp-warns [data-act="kit"]'), sq: [...document.querySelectorAll('.cp-sol')].length }));
      check(br3.top === 'cbriefing' && !br3.kit, 'iPad: toque em «Equipar para a noite» no briefing ' + JSON.stringify(br3));
      await shot(page, 'brief-night-after-' + view);
    }
    await noMissing(page, 'briefing noturno ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Chegada de noite a um OVNI que descola antes do dia: «Atacar já» por omissão; ao descolar, o transporte regressa');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'leave-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    const id = await page.evaluate(({ NL, PU }) => {
      const G = window.__G;
      const lon = (0, eval)('(' + NL + ')')(6);
      G.alienMissions.length = 0;
      G.ufos.length = 0;
      const id = (0, eval)('(' + PU + ')')({ lon, lat: 20, groundLeftS: 2 * 3600 });
      const c = window.__sky;
      c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return id;
    }, { NL: NIGHT_LON.toString(), PU: PUT_UFO.toString() });
    await sleep(900);
    const txt = await page.evaluate(popText), prim = await page.evaluate(popPrimary);
    check(/levantar voo antes de amanhecer/.test(txt) && /iniciar|atacar/i.test(prim) && !/esperar/i.test(prim), view + ': principal «' + prim + '» · ' + txt.slice(0, 200));
    await shot(page, 'leave-' + view + '-popup');
    // «Esperar pelo dia» (não por omissão) e o OVNI levanta voo: o Skyranger regressa
    await press(page, view, '.geo-pop .btn:has-text("Esperar pelo dia")');
    await sleep(300);
    await page.evaluate((uid) => {
      const G = window.__G;
      G.events.push({ t: 'ufoLiftOff', ufoId: uid });
      const u = G.ufos.find((x) => x.id === uid);
      u.status = 'flying';
    }, id);
    await page.waitForFunction(() => window.__sky.status === 'returning' || window.__sky.dest === 'home' || (window.__sky.dest && window.__sky.dest.kind === 'base'), null, { timeout: 5000 }).catch(() => null);
    await sleep(900);
    const st = await page.evaluate(() => ({ st: window.__sky.status, dest: window.__sky.dest, toast: document.getElementById('toasts').innerText.replace(/\s+/g, ' ') }));
    check(st.st === 'returning' && /regressa à base/.test(st.toast), view + ': o transporte regressa quando o OVNI levanta voo ' + JSON.stringify(st));
    // «Alvo perdido» num transporte: «Regressar à base» por omissão
    // sem o OVNI em voo (o alerta «OVNI detetado» viria primeiro) e sem popups abertos
    await page.evaluate(() => { window.__G.ufos.length = 0; });
    for (let k = 0; k < 4 && (await page.evaluate(() => !!document.querySelector('.geo-pop'))); k++) { await page.keyboard.press('Escape'); await sleep(350); }
    await page.evaluate(() => {
      const G = window.__G, c = window.__sky;
      c.status = 'patrol'; c.dest = { kind: 'point', lon: c.lon, lat: c.lat }; c.patrol = true;
      G.events.push({ t: 'targetLost', craftId: c.id, target: { kind: 'ufo', id: 'u999' } });
    });
    await page.waitForFunction(() => /Alvo perdido/i.test((document.querySelector('.geo-pop') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => null);
    await sleep(300);
    const tl = await page.evaluate(() => ({ txt: ((document.querySelector('.geo-pop') || {}).innerText || '').replace(/\s+/g, ' '), prim: ((document.querySelector('.geo-pop .btn.primary') || {}).textContent || '').trim() }));
    check(/Regressar/i.test(tl.prim) && /transporte não interceta/.test(tl.txt), view + ': «Alvo perdido» num transporte ' + JSON.stringify(tl));
    await shot(page, 'targetlost-' + view);
    await noMissing(page, 'noite/alvo perdido ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('4. «Vender material» abre o Mercado em Vender; próximos passos clicáveis; segmentados com aria-pressed');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'geo-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await sleep(500);
    await shot(page, 'geo-steps-' + view);
    // passo «Começar uma investigação» → base › Investigação
    const hasSteps = await page.evaluate(() => document.querySelectorAll('.geo-steps .geo-step').length);
    check(hasSteps === 4, view + ': 4 passos com botão (' + hasSteps + ')');
    if (view === 'zoom') {
      // teclado: foco no passo e Enter
      await page.evaluate(() => document.querySelector('.geo-step[data-step="research"]').focus());
      await page.keyboard.press('Enter');
    } else await press(page, view, '.geo-step[data-step="research"]');
    await sleep(700);
    const st = await page.evaluate(() => (OV.Scenes.top().debugState ? OV.Scenes.top().debugState().tab : OV.Scenes.top().id));
    check(st === 'research', view + ': passo leva à Investigação (' + st + ')');
    await page.evaluate(() => { if (document.querySelector('.modal')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await sleep(300);
    await page.evaluate(() => OV.BaseUI.close());
    await sleep(500);
    // armazém sobrelotado → «Vender material»
    await page.evaluate(() => { const G = window.__G; G.bases[0].stores.alien_alloys = (G.bases[0].stores.alien_alloys | 0) + 400; G.t += 3600; OV.GeoUI.open(G); });
    await sleep(800);
    const has = await page.evaluate(() => !!document.querySelector('[data-alert="stores"] .btn'));
    check(has, view + ': aviso de armazém sobrelotado com botão');
    await shot(page, 'geo-stores-' + view);
    await press(page, view, '[data-alert="stores"] .btn');
    await sleep(800);
    const m = await page.evaluate(() => { const d = OV.Scenes.top().debugState(); return { tab: d.tab, market: d.market, pressed: ((document.querySelector('.bsc [data-mode="sell"]') || {}).getAttribute || (() => null)).call(document.querySelector('.bsc [data-mode="sell"]'), 'aria-pressed') }; });
    check(m.tab === 'market' && m.market === 'sell' && m.pressed === 'true', view + ': «Vender material» abre Mercado › Vender ' + JSON.stringify(m));
    await shot(page, 'market-sell-' + view);
    // ficha do soldado: Armadura/Nave com aria-pressed, grupo com nome e ✓
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'soldiers'));
    await sleep(500);
    await press(page, view, '.bsc [data-sol], .bsc .bsc-sol-row, .bsc-tab-soldiers .bsc-row');
    await sleep(600);
    const seg = await page.evaluate(() => {
      const grp = [...document.querySelectorAll('.bsc .bsc-seg[role="group"]')].map((g) => g.getAttribute('aria-label'));
      const on = [...document.querySelectorAll('.bsc .bsc-seg .btn.seg.on')];
      const pressed = on.map((b) => b.getAttribute('aria-pressed'));
      const offP = [...document.querySelectorAll('.bsc .bsc-seg .btn.seg:not(.on)')].map((b) => b.getAttribute('aria-pressed'));
      const tick = on.length ? getComputedStyle(on[0], '::before').content : '';
      return { grp, pressed, offP, tick };
    });
    check(seg.grp.length >= 2 && seg.pressed.length >= 2 && seg.pressed.every((p) => p === 'true') && seg.offP.every((p) => p === 'false') && /✓/.test(seg.tick), view + ': segmentados acessíveis ' + JSON.stringify(seg));
    await shot(page, 'soldier-sheet-' + view);
    // retrato: avisos da base por baixo dos separadores
    if (view === 'padP') {
      await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'personnel'));
      await sleep(500);
      await page.evaluate(() => OV.Dom.toast('Contratação: 1 engenheiro. Chegada dentro de 48 h.', null, 'info'));
      await sleep(400);
      const r = await page.evaluate(() => {
        const t = document.querySelector('#toasts .toast');
        const tabs = [...document.querySelectorAll('.bsc-tab')];
        if (!t || !tabs.length) return { ok: false };
        const tr = t.getBoundingClientRect();
        const over = tabs.some((b) => { const q = b.getBoundingClientRect(); return !(tr.bottom <= q.top || tr.top >= q.bottom || tr.right <= q.left || tr.left >= q.right); });
        return { ok: true, over, top: Math.round(tr.top), h: innerHeight };
      });
      check(r.ok && !r.over, 'retrato: o aviso não tapa os separadores ' + JSON.stringify(r));
      await shot(page, 'base-toast-padP');
    }
    await noMissing(page, 'geo/base ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('5. Nave de volta ao hangar embarca os aptos que ficaram na base');
  {
    const { ctx, page } = await openPage('desk', 'board');
    await page.evaluate(NEWG, { diff: 0 });
    const r = await page.evaluate(async () => {
      const G = window.__G, c = window.__sky;
      const out = c.soldiers.slice(0, 3);
      for (const id of out) OV.BaseSim.assignSoldier(G, id, null);
      const n0 = c.soldiers.length;
      G.events.push({ t: 'craftReturned', craftId: c.id, baseId: c.baseId });
      OV.GeoUI.open(G);
      await new Promise((res) => setTimeout(res, 1200));
      return { n0, n1: c.soldiers.length, toast: document.getElementById('toasts').innerText.replace(/\s+/g, ' ') };
    });
    check(r.n1 === r.n0 + 3 && /embarcaram/.test(r.toast), 'aptos embarcam quando a nave chega ' + JSON.stringify(r));
    await shot(page, 'board-on-return');
    await noMissing(page, 'embarque');
    await ctx.close();
  }

  // =============================================================================================================
  log('6. Paleta para daltonismo: barra de saúde distinta da barra de UT');
  {
    const { ctx, page } = await openPage('desk', 'cvd');
    const c = await page.evaluate(() => {
      document.documentElement.setAttribute('data-palette', 'cvd');
      const host = document.createElement('div');
      host.append(OV.Dom.bar(20, 40, 'tu'), OV.Dom.bar(15, 33, 'hp'));
      document.body.appendChild(host);
      const col = (sel) => getComputedStyle(host.querySelector(sel)).backgroundColor;
      const r = { tu: col('.bar-tu i'), hp: col('.bar-hp i') };
      host.remove();
      return r;
    });
    check(c.tu !== c.hp && /230, 238, 245/.test(c.hp), 'cvd: UT ' + c.tu + ' · saúde ' + c.hp);
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
console.log((fails.length ? '✗ ' : '✓ ') + (checks - fails.length + errors.length) + '/' + checks + ' verificações; capturas em ' + OUT);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
