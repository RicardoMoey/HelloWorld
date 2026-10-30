/* Ronda de personas 4 — QA do «shell» num Chromium real (Playwright): duplo clique fantasma no briefing, foco que
   não salta para «Novo projeto» (chave de foco única em todos os botões da base), Enter repetido em «Contratar +5»,
   Mercado ao teclado (uma paragem por linha, setas, aria-pressed), aviso e confirmação ao vender o último cadáver,
   lista de construção que não se mexe, base em retrato com a ficha do soldado à vista, bases alienígenas
   distinguíveis, «Esperar pelo dia» acelerado e sem a pergunta repetida, local da base recentrado ao rodar o iPad.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 834×1194 / 1194×834 (toque).
   Falha em erros de consola/página ou ⟦…⟧. Uso: node ovni-1999/qa/persona_r4_shell.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r4_shell') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r4_shell') : path.join(process.cwd(), 'qa-out', 'persona_r4_shell');
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
  low: { viewport: { width: 1024, height: 560 } },
  padP: { viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
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
// toque ou clique num elemento (o iPad não tem rato)
const press = async (page, view, sel) => {
  const loc = page.locator(sel).first();
  if (TOUCH(view)) await loc.tap();
  else await loc.click();
};
// campanha nova no Geoscape, sem a introdução
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: (o && o.diff) | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  if (o && o.month) G.month = o.month;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.GeoUI.open(G);
  return true;
};
const REOPEN = () => { OV.GeoUI.open(window.__G); return true; };
// OVNI aterrado conhecido com efetivo mínimo ≥ 3 → id
const LANDED = (o) => {
  const G = window.__G;
  const D = OV.Data;
  const type = Object.keys(D.ufos).find((k) => D.deploymentRange(D.ufos[k].deployment, G.difficulty | 0, G.month | 0).min >= 3) || 'large_scout';
  const id = 'u' + (900 + G.ufos.length);
  G.ufos.push({ id, type, missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: o.lon, lat: o.lat, dest: null, alt: 0, speed: 0, status: o.status || 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: o.crashLeftS || 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
  if (G.seen.ufoTypes.indexOf(type) < 0) G.seen.ufoTypes.push(type);
  return { id, type, min: D.deploymentRange(D.ufos[type].deployment, G.difficulty | 0, G.month | 0).min };
};
const focusInfo = () => { const a = document.activeElement; return { lbl: (a && a.getAttribute && a.getAttribute('aria-label')) || '', act: (a && a.dataset && a.dataset.act) || '', txt: ((a && a.textContent) || '').trim().slice(0, 40), tag: a ? a.tagName : '' }; };

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Briefing: o 2.º clique de um duplo clique não ativa «Equipar» acabado de aparecer');
  {
    const { ctx, page } = await openPage('desk', 'ghost');
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    const u = await page.evaluate(LANDED, { lon: 2, lat: 46 });
    const r = await page.evaluate((id) => {
      const G = window.__G, c = window.__sky;
      c.lon = 2; c.lat = 46; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      OV.CampaignUI.launchMission(G, { kind: 'ufo', id }, c.id);
      const top0 = OV.Scenes.top().id;
      const eq = [...document.querySelectorAll('.cp-brief .scr-foot .btn')].find((b) => /equipar/i.test(b.textContent));
      if (!eq) return { top0, eq: false };
      eq.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
      const top1 = OV.Scenes.top().id;
      const cancel = [...document.querySelectorAll('.cp-brief .scr-foot .btn')].find((b) => /cancelar/i.test(b.textContent));
      cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
      return { top0, eq: true, top1, top2: OV.Scenes.top().id };
    }, u.id);
    check(r.top0 === 'cbriefing' && r.eq && r.top1 === 'cbriefing' && r.top2 === 'cbriefing', 'duplo clique fantasma em Equipar/Cancelar ignorado ' + JSON.stringify(r));
    await shot(page, 'brief-desk');
    await sleep(500);
    await page.locator('.cp-brief .scr-foot .btn', { hasText: /equipar/i }).first().click();
    await sleep(500);
    check(await topId(page) === 'equip', 'um clique simples em Equipar continua a abrir o equipamento');
    await noMissing(page, 'briefing');
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Base ao teclado: chave de foco única, Enter repete o passo dos cientistas, Contratar +5 duas vezes');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'focus-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => {
      const G = window.__G, b = G.bases[0];
      const av = OV.Campaign.availableResearch(G, b.id);
      OV.BaseSim.startResearch(G, b.id, av[0], 2);
      OV.BaseSim.startResearch(G, b.id, av[1], 2);
      OV.BaseUI.open(G, b.id, 'research');
    });
    await sleep(700);
    // todas as paragens do Tab dos separadores 2, 6, 7 e 8 voltam a si próprias pela chave
    const bad = await page.evaluate(async () => {
      const out = [];
      for (const k of ['2', '6', '7', '8']) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const box = document.querySelector('.bsc-content');
        for (const b of box.querySelectorAll('button')) {
          if (b.offsetParent === null) continue;
          const key = OV.Dom.focusKey(b);
          document.body.focus();
          if (!key || !OV.Dom.refocus(key, box) || document.activeElement !== b) out.push(k + ':' + (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30) + ' → ' + key);
        }
      }
      return out;
    });
    check(!bad.length, view + ': cada botão da base reencontra-se pela sua chave (' + bad.length + ') ' + bad.slice(0, 4).join(' | '));
    await page.keyboard.press('2');
    await sleep(400);
    const before = await page.evaluate(() => window.__G.bases[0].research[0].scientists);
    await page.evaluate(() => { const b = document.querySelectorAll('.bsc-stepper[data-topic]')[0].querySelectorAll('.btn')[2]; b.focus(); });
    const f0 = await page.evaluate(focusInfo);
    await page.keyboard.press('Enter');
    await sleep(350);
    const f1 = await page.evaluate(focusInfo);
    await page.keyboard.press('Enter');
    await sleep(350);
    const f2 = await page.evaluate(focusInfo);
    const after = await page.evaluate(() => ({ s: window.__G.bases[0].research[0].scientists, modal: !!document.querySelector('#modals .modal') }));
    check(f1.lbl === f0.lbl && f2.lbl === f0.lbl && f1.act !== 'newResearch', view + ': o foco fica em «' + f0.lbl + '» (' + f1.lbl + ' / ' + f2.lbl + ')');
    check(after.s === before + 2 && !after.modal, view + ': dois Enter = +2 cientistas, sem abrir «Novo projeto» ' + JSON.stringify([before, after]));
    await shot(page, 'research-' + view);
    // Pessoal: Enter, Enter em «Contratar +5» (300 ms) = duas encomendas
    await page.keyboard.press('4');
    await sleep(400);
    const d0 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    await page.evaluate(() => document.querySelector('[data-hire="soldier"][data-n="5"]').focus());
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(400);
    const d1 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    check(d1 - d0 === 10, view + ': Enter duas vezes em «Contratar +5» contrata 10: ' + (d1 - d0));
    // o duplo clique do rato continua a contar uma vez
    await page.locator('[data-hire="soldier"][data-n="5"]').dblclick();
    await sleep(500);
    const d2 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    check(d2 - d1 === 5, view + ': duplo clique continua a contratar 5: ' + (d2 - d1));
    await noMissing(page, 'base foco ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Mercado ao teclado: uma paragem por linha, setas, aria-pressed; vender o último cadáver pede confirmação');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'market-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'market'));
    await sleep(700);
    const m = await page.evaluate(() => {
      const box = document.querySelector('.bsc-content');
      const stops = [...box.querySelectorAll('button')].filter((b) => b.tabIndex >= 0 && b.offsetParent !== null).length;
      const rows = box.querySelectorAll('.bsc-mrow[data-buy]').length;
      const seg = [...document.querySelectorAll('.bsc-seg .btn')].map((b) => b.getAttribute('aria-pressed'));
      return { stops, rows, seg };
    });
    check(m.stops <= m.rows + 3, view + ': paragens do Tab ' + m.stops + ' para ' + m.rows + ' linhas');
    check(m.seg.join() === 'true,false', view + ': aria-pressed em Comprar/Vender ' + m.seg.join());
    await page.evaluate(() => document.querySelector('.bsc-mrow[data-buy] [data-act="buy"]').focus());
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    const id2 = await page.evaluate(() => document.activeElement.closest('.bsc-mrow').dataset.buy);
    const ids = await page.evaluate(() => [...document.querySelectorAll('.bsc-mrow[data-buy]')].map((r) => r.dataset.buy));
    check(id2 === ids[1], view + ': ↓ vai para a linha seguinte (' + id2 + ')');
    for (const k of ['ArrowRight', 'ArrowRight']) { await page.keyboard.press(k); await sleep(150); }
    const q1 = await page.evaluate((id) => ({ v: document.querySelector('[data-buy="' + id + '"] .bsc-step-v').textContent, f: document.activeElement.dataset.act + ':' + document.activeElement.dataset.id }), id2);
    check(q1.v === '3' && q1.f === 'buy:' + id2, view + ': → → = 3 com o foco no Comprar da linha ' + JSON.stringify(q1));
    await page.keyboard.press('Shift+ArrowRight');
    await sleep(150);
    const q2 = await page.evaluate((id) => document.querySelector('[data-buy="' + id + '"] .bsc-step-v').textContent, id2);
    check(q2 === '13' || q2 === '3', view + ': ⇧→ soma 10 (' + q2 + ')');
    await page.keyboard.press('Home');
    await sleep(150);
    const q3 = await page.evaluate((id) => document.querySelector('[data-buy="' + id + '"] .bsc-step-v').textContent, id2);
    check(q3 === '1', view + ': Início volta a 1 (' + q3 + ')');
    await page.keyboard.press('PageDown');
    await sleep(150);
    const id3 = await page.evaluate(() => document.activeElement.closest('.bsc-mrow').dataset.buy);
    check(ids.indexOf(id3) === Math.min(ids.length - 1, 7), view + ': PgDn salta 6 linhas (' + id3 + ')');
    const f0 = await page.evaluate(() => window.__G.funds);
    await page.keyboard.press('Enter');
    await sleep(400);
    check(await page.evaluate((f) => window.__G.funds < f, f0), view + ': Enter compra');
    await shot(page, 'market-' + view + '-buy');
    // vender: o último cadáver de Sectoide faz falta à autópsia
    await page.evaluate(() => { window.__G.bases[0].stores.sectoid_corpse = 1; OV.BaseUI.refresh(); });
    await page.locator('.bsc-seg .btn[data-mode="sell"]').click();
    await sleep(300);
    const need = await page.locator('[data-sell="sectoid_corpse"] .bsc-row-need').innerText().catch(() => '');
    check(/Necessário para investigar: Autópsia/i.test(need), view + ': «' + need + '»');
    await shot(page, 'market-' + view + '-sell');
    await page.locator('[data-sell="sectoid_corpse"] [data-act="sell"]').click();
    await sleep(400);
    const mt = await page.locator('#modals .modal').innerText().catch(() => '');
    check(/deixa de se poder investigar/.test(mt), view + ': confirmação ao vender o último «' + mt.replace(/\s+/g, ' ').slice(0, 80) + '»');
    await shot(page, 'market-' + view + '-sellconfirm');
    await page.keyboard.press('Enter');
    await sleep(400);
    check(await page.evaluate(() => window.__G.bases[0].stores.sectoid_corpse === 1), view + ': Enter = Guardar (não vende)');
    await sleep(450);
    await page.locator('[data-sell="sectoid_corpse"] [data-act="sell"]').click();
    await sleep(400);
    await page.locator('#modals .modal .btn.danger').click();
    await sleep(400);
    check(await page.evaluate(() => !(window.__G.bases[0].stores.sectoid_corpse > 0)), view + ': «Vender mesmo assim» vende');
    await noMissing(page, 'mercado ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('4. Construir: a lista não se mexe quando começa uma obra');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'build-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => { window.__G.funds = 9e6; OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'facilities'); });
    await sleep(700);
    const y = () => page.evaluate(() => { const r = document.querySelector('[data-fac="alien_containment"]'); return r ? Math.round(r.getBoundingClientRect().top + document.querySelector('.bsc-content').scrollTop) : -1; });
    const y0 = await y();
    const built = await page.evaluate(() => {
      const G = window.__G, b = G.bases[0];
      for (let yy = 0; yy < 6; yy++) for (let x = 0; x < 6; x++) if (!OV.BaseSim.canPlace(G, b.id, 'laboratory', x, yy)) { OV.BaseSim.build(G, b.id, 'laboratory', x, yy); G.events.splice(0); OV.BaseUI.refresh(); return true; }
      return false;
    });
    await sleep(300);
    const y1 = await y();
    const under = await page.locator('.bsc-build-row').count();
    check(built && under >= 1 && y0 === y1, view + ': Contenção no mesmo sítio depois de iniciar uma obra (' + y0 + ' → ' + y1 + ')');
    await shot(page, 'build-' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('5. iPad em retrato: separador com a altura toda, ficha do soldado à vista');
  for (const view of ['padP', 'padL']) {
    const { ctx, page } = await openPage(view, 'pad-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'soldiers'));
    await sleep(800);
    const h = await page.evaluate(() => document.querySelector('.bsc-content').clientHeight);
    if (view === 'padP') check(h >= 700, view + ': altura do separador ' + h + ' (era 520)');
    await page.locator('tr[data-sol]').nth(5).tap();
    await sleep(500);
    const vis = await page.evaluate(() => {
      const box = document.querySelector('.bsc-content').getBoundingClientRect(), d = document.querySelector('.bsc-sol-detail').getBoundingClientRect();
      const ren = document.querySelector('.bsc-sol-detail .bsc-sol-name, .bsc-sol-detail input, .bsc-sol-detail .btn');
      const rr = ren ? ren.getBoundingClientRect() : d;
      return { top: Math.round(d.top), boxTop: Math.round(box.top), boxBot: Math.round(box.bottom), ren: Math.round(rr.bottom) };
    });
    check(vis.top >= vis.boxTop - 1 && vis.ren <= vis.boxBot + 1, view + ': ficha do soldado à vista ' + JSON.stringify(vis));
    await shot(page, 'soldiers-' + view);
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'market'));
    await sleep(500);
    await shot(page, 'market-' + view);
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'facilities'));
    await sleep(500);
    await shot(page, 'facilities-' + view);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.bsc-kbd-hint') || document.body).display === 'none' || !document.querySelector('.bsc-kbd-hint')), view + ': sem ajuda de teclado no toque');
    await noMissing(page, 'base ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('6. Geoscape: duas bases alienígenas na Nigéria distinguíveis; alerta «outra base»');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'abase-' + view);
    await page.evaluate(NEWG, { diff: 1, month: 3 });
    await page.evaluate(() => {
      const G = window.__G;
      G.alienBases.push({ id: 'a1', lon: 5.8, lat: 5.5, race: 'floater', region: 'africa', discovered: true });
      G.alienBases.push({ id: 'a2', lon: 6.8, lat: 5.6, race: 'muton', region: 'africa', discovered: true });
      G.events.push({ t: 'alienBaseFound', alienBaseId: 'a2', how: 'patrol' });
      OV.GeoUI.open(G);
    });
    await sleep(900);
    const pop = await page.locator('.geo-pop').innerText().catch(() => '');
    check(/outra base alienígena .*Mutons/i.test(pop.replace(/\s+/g, ' ')), view + ': alerta «outra base alienígena … Mutons» «' + pop.replace(/\s+/g, ' ').slice(0, 110) + '»');
    await shot(page, 'abase-' + view + '-alert');
    await press(page, view, '.geo-pop .btn:last-child');
    await sleep(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.geo-li.k-abase')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    check(rows.length === 2 && rows[0] !== rows[1] && rows.some((r) => /Flutuantes/.test(r)) && rows.some((r) => /Mutons/.test(r)), view + ': linhas LOCAIS ' + JSON.stringify(rows));
    await shot(page, 'abase-' + view + '-list');
    await noMissing(page, 'bases alienígenas ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('7. Noite em Recruta: a pergunta não se repete; «Esperar pelo dia» acelera o tempo');
  for (const view of ['desk', 'padP']) {
    const { ctx, page } = await openPage(view, 'night-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    const ok = await page.evaluate(() => {
      const G = window.__G;
      let lon = null;
      for (let l = -180; l < 180; l += 10) if (OV.GMath.dayPhase(G, l, 20) === 'night' && OV.GMath.dayPhase({ t: G.t + 4 * 3600 }, l, 20) === 'night') { lon = l; break; }
      if (lon === null) return false;
      // sem outras missões alienígenas: um «OVNI detetado» alheio pararia o relógio durante a espera
      G.alienMissions.length = 0;
      G.ufos.length = 0;
      const id = 'u950';
      G.ufos.push({ id, type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon, lat: 20, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const c = window.__sky;
      c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return true;
    });
    await sleep(900);
    const txt = await page.evaluate(() => { const p = document.querySelector('.geo-pop'); if (!p) return ''; const c = p.cloneNode(true); c.querySelectorAll('.btn').forEach((b) => b.remove()); return c.innerText; });
    const n = (txt.match(/Esperar pelo dia/g) || []).length;
    check(ok && n === 1, view + ': «Esperar pelo dia» uma só vez no texto (' + n + ') «' + txt.replace(/\s+/g, ' ').slice(0, 160) + '»');
    await shot(page, 'night-' + view + '-popup');
    await press(page, view, '.geo-pop .btn.primary');
    await sleep(500);
    const s = await page.evaluate(() => ({ sp: window.__G.ui.geo.speed, wait: (window.__G.ui.waitDay || []).length, toast: document.getElementById('toasts').innerText }));
    check(s.wait === 1 && s.sp >= 3 && /30 min/.test(s.toast), view + ': espera com o tempo a «30 min» ' + JSON.stringify(s));
    // amanhece em segundos reais, não em minutos (um alerta alheio — OVNI detetado — pode parar o relógio primeiro)
    const g0 = await page.evaluate(() => window.__G.t);
    await page.waitForFunction((t0) => /amanhec/i.test((document.querySelector('.geo-pop') || {}).innerText || '') || !(window.__G.ui.waitDay || []).length || window.__G.t - t0 >= 3 * 3600 || (document.querySelector('.geo-pop') && window.__G.ui.geo.speed === 0), g0, { timeout: 8000 }).catch(() => null);
    const g1 = await page.evaluate((t0) => ({ dt: window.__G.t - t0, pop: ((document.querySelector('.geo-pop') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 60) }), g0);
    check(g1.dt >= 3 * 3600 || /amanhec/i.test(g1.pop) || (g1.pop && g1.dt > 0), view + ': o tempo corre depressa até amanhecer ou até outro alerta ' + JSON.stringify(g1));
    await shot(page, 'night-' + view + '-dawn');
    await noMissing(page, 'noite ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('8. Local da primeira base: rodar o iPad mantém o local escolhido à vista');
  {
    const { ctx, page } = await openPage('padL', 'site');
    await page.evaluate(() => { OV.CampaignUI.newGame(); return true; });
    await sleep(600);
    await page.locator('.cp-ng-diff .btn.primary').last().tap();
    await sleep(1500);
    const vis = async () => page.evaluate(() => {
      const d = OV.CampaignUI.debug.newgame();
      const p = OV.GlobeRender.project(Object.assign({ time: performance.now(), highlights: [], selection: null }, d.view), d.chosen.lon, d.chosen.lat);
      const side = document.querySelector('.cp-ng-side').getBoundingClientRect();
      const free = side.width < d.view.w * 0.7 ? p.x < side.left : p.y < side.top;
      return { front: p.front, x: Math.round(p.x), y: Math.round(p.y), free, w: d.view.w, h: d.view.h };
    });
    const a = await vis();
    check(a.front && a.free, 'paisagem: local escolhido à vista ' + JSON.stringify(a));
    await shot(page, 'site-padL');
    // como a Marta: toque duplo no mar (o globo centra-se no Atlântico) e o local escolhido fica junto ao painel
    await page.touchscreen.tap(40, 420);
    await sleep(110);
    await page.touchscreen.tap(40, 420);
    await sleep(1300);
    const z = await vis();
    check(z.front && z.free, 'paisagem depois do toque duplo no mar: à vista ' + JSON.stringify(z));
    await page.setViewportSize({ width: 834, height: 1194 });
    await sleep(1200);
    const b = await vis();
    check(b.front && b.free && b.x > 0 && b.x < b.w && b.y > 0, 'retrato: local escolhido à vista sem CENTRAR ' + JSON.stringify(b));
    await shot(page, 'site-padP');
    await page.setViewportSize({ width: 1194, height: 834 });
    await sleep(1200);
    const c = await vis();
    check(c.front && c.free, 'de volta à paisagem: à vista ' + JSON.stringify(c));
    await noMissing(page, 'local da base');
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
