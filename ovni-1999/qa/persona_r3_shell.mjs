/* Ronda de personas 3 — QA do «shell» num Chromium real (Playwright): «Enviar equipa» com 2 soldados (pergunta com
   «Embarcar N e enviar» por omissão, aviso persistente «leva só N a bordo», aviso forte no briefing), «Esperar pelo dia»
   por omissão de noite em Recruta, entrega de armas com «Pôr na nave» e o equipar a bordo que diz o que ficou na base,
   duplo clique em Contratar/Despedir, foco ao iniciar o 1.º projeto com N, modo construção ao teclado (texto e dica
   dentro da janela), nomes acessíveis com contexto, painel lateral a 1024×560 com o foco à vista, mira logo no
   «Escolher no globo», Financiamento em retrato, textos do iPad (interceção, sinalizadores), selos 1/2/3 escondidos no
   toque, toque duplo no mar com um só aviso, relatório mensal ao teclado, mapa novo ao carregar uma gravação manual.
   Capturas a 1440×900, 1024×576 (125 %), 1024×560 e iPad 834×1194 / 1194×834 (toque).
   Falha em erros de consola/página ou ⟦…⟧. Uso: node ovni-1999/qa/persona_r3_shell.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r3_shell') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r3_shell') : path.join(process.cwd(), 'qa-out', 'persona_r3_shell');
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
// só 2 soldados a bordo do transporte
const TWO_ABOARD = () => {
  const G = window.__G, c = window.__sky;
  for (const id of c.soldiers.slice(2)) OV.BaseSim.assignSoldier(G, id, null);
  return c.soldiers.length;
};

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. «Enviar equipa» com 2 soldados: aviso persistente, pergunta com «Embarcar N e enviar» por omissão');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'send-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    const n = await page.evaluate(TWO_ABOARD);
    await page.evaluate(REOPEN);
    await sleep(500);
    check(n === 2, view + ': 2 soldados a bordo');
    const al = await page.locator('.geo-alert[data-alert="aboard"]').innerText().catch(() => '');
    check(/leva só 2 soldados a bordo/.test(al), view + ': aviso «leva só 2 a bordo» «' + al + '»');
    const u = await page.evaluate(LANDED, { lon: 2, lat: 46 });
    await page.evaluate((id) => OV.GeoUI.intercept(window.__G, id), u.id);
    await sleep(500);
    await shot(page, 'send-' + view + '-dialog');
    await press(page, view, '.geo-dlg .geo-row.transport');
    await sleep(450);
    const md = await page.evaluate(() => {
      const m = document.querySelector('#modals .modal');
      return m ? { text: m.innerText, prim: (m.querySelector('.btn.primary') || {}).textContent || '', foc: document.activeElement && document.activeElement.textContent } : null;
    });
    check(md && /Só 2 soldados contra/.test(md.text), view + ': pergunta «Só 2 soldados contra…» ' + (md && md.text.slice(0, 80)));
    check(md && /^Embarcar \d+ e enviar/.test(md.prim) && /Enviar assim/i.test(md.text), view + ': «Embarcar N e enviar» principal, «Enviar assim» também ' + (md && md.prim));
    check(await page.evaluate(() => window.__sky.status === 'ready'), view + ': a nave ainda não partiu');
    await shot(page, 'send-' + view + '-confirm');
    if (TOUCH(view)) await page.locator('#modals .btn.primary').tap();
    else await page.keyboard.press('Enter');
    await sleep(500);
    const st = await page.evaluate(() => ({ n: window.__sky.soldiers.length, status: window.__sky.status, dest: window.__sky.dest }));
    check(st.n > 2 && st.status !== 'ready' && st.dest, view + ': embarcou e partiu ' + JSON.stringify(st));
    await noMissing(page, 'send ' + view);
    await ctx.close();
  }
  // «Enviar assim» também envia (sem embarcar)
  {
    const { ctx, page } = await openPage('desk', 'send-go');
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    await page.evaluate(TWO_ABOARD);
    const u = await page.evaluate(LANDED, { lon: 2, lat: 46 });
    await page.evaluate((id) => OV.GeoUI.intercept(window.__G, id), u.id);
    await sleep(400);
    await page.locator('.geo-dlg .geo-row.transport').first().dblclick();
    await sleep(450);
    check((await page.locator('#modals .modal').count()) === 1, 'duplo clique na linha: uma só pergunta, ainda aberta');
    await page.locator('#modals .btn.danger').click();
    await sleep(400);
    const st = await page.evaluate(() => ({ n: window.__sky.soldiers.length, dest: !!window.__sky.dest }));
    check(st.n === 2 && st.dest, '«Enviar assim» manda os 2 ' + JSON.stringify(st));
    // briefing: aviso forte
    await page.evaluate((id) => {
      const G = window.__G, c = window.__sky, ufo = G.ufos.find((x) => x.id === id);
      c.lon = ufo.lon; c.lat = ufo.lat; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      OV.CampaignUI.launchMission(G, { kind: 'ufo', id }, c.id);
    }, u.id);
    await sleep(900);
    const br = await page.evaluate(() => ({ top: OV.Scenes.top().id, bad: [...document.querySelectorAll('.cp-warns li.bad')].map((l) => l.textContent) }));
    check(br.top === 'cbriefing' && br.bad.some((t) => /Só 2 soldados contra/.test(t)), 'briefing: aviso «bad» «Só 2 soldados contra…» ' + JSON.stringify(br));
    await shot(page, 'send-desk-briefing');
    await noMissing(page, 'briefing');
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Noite no local em Recruta: «Esperar pelo dia» é o Enter');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'night-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    const ok = await page.evaluate(() => {
      const G = window.__G;
      let lon = null;
      for (let l = -180; l < 180; l += 10) if (OV.GMath.dayPhase(G, l, 20) === 'night' && OV.GMath.dayPhase({ t: G.t + 4 * 3600 }, l, 20) === 'night') { lon = l; break; }
      if (lon === null) return false;
      const D = OV.Data, id = 'u950';
      G.ufos.push({ id, type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon, lat: 20, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const c = window.__sky;
      c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
      G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id }, prompt: 'mission' });
      OV.GeoUI.open(G);
      return !!D;
    });
    await sleep(800);
    const pop = await page.evaluate(() => {
      const p = document.querySelector('.geo-pop');
      return p ? { text: p.innerText, prim: (p.querySelector('.btn.primary') || {}).textContent || '', first: (p.querySelector('.geo-pop-a .btn') || {}).textContent || '' } : null;
    });
    check(ok && pop && /Esperar pelo dia/.test(pop.prim) && /Esperar pelo dia/.test(pop.first), view + ': «Esperar pelo dia» primeiro e realçado ' + JSON.stringify(pop && pop.prim));
    check(pop && /Atacar já/i.test(pop.text) && /É noite/i.test(pop.text), view + ': «Atacar já» e a pergunta curta');
    await shot(page, 'night-' + view + '-popup');
    if (!TOUCH(view)) {
      await page.keyboard.press('Enter');
      await sleep(400);
      const w = await page.evaluate(() => ({ wait: (window.__G.ui.waitDay || []).length, top: OV.Scenes.top().id }));
      check(w.wait === 1 && w.top === 'geoscape', 'Enter espera pelo dia (não abre o briefing) ' + JSON.stringify(w));
    }
    await noMissing(page, 'night ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Armas entregues: «Pôr na Skyranger-1» abre o equipamento; a bordo diz o que ficou na base');
  for (const view of ['desk', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'gear-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    await page.evaluate(() => {
      const G = window.__G;
      G.bases[0].stores.rocket_launcher = (G.bases[0].stores.rocket_launcher | 0) + 10;
      G.bases[0].stores.small_rocket = 6;
      G.events.push({ t: 'deliveryArrived', baseId: G.bases[0].id, kind: 'item', itemId: 'rocket_launcher', n: 10 });
      OV.GeoUI.open(G);
    });
    await sleep(800);
    const pop = await page.locator('.geo-pop').innerText().catch(() => '');
    check(/Pôr na /i.test(pop), view + ': botão «Pôr na …» «' + pop.replace(/\s+/g, ' ').slice(0, 120) + '»');
    await shot(page, 'gear-' + view + '-delivery');
    await press(page, view, '.geo-pop .btn.primary');
    await sleep(900);
    const st = await page.evaluate(() => ({ top: OV.Scenes.top().id, s: OV.BaseUI.debug.state(), sky: window.__sky.id }));
    check(st.top === 'basescape' && st.s && st.s.tab === 'crafts' && st.s.equip === st.sky, view + ': base › Naves com o equipamento aberto ' + JSON.stringify(st.s && { tab: st.s.tab, equip: st.s.equip }));
    check(await page.evaluate(() => /Lança-Foguetes/.test((document.querySelector('.bsc-equip') || document.body).innerText)), view + ': os lança-foguetes estão no armazém do equipamento');
    await shot(page, 'gear-' + view + '-equip');
    // nave no local: o equipar a bordo diz o que ficou
    await page.evaluate(() => {
      const G = window.__G, c = window.__sky;
      while (OV.Scenes.stack.length > 1) OV.Scenes.pop();
      c.status = 'patrol'; c.lon = 2; c.lat = 46;
      OV.Scenes.push('equip', { G, craftId: c.id });
    });
    await sleep(700);
    const left = await page.locator('.cp-eq-left').innerText().catch(() => '');
    check(/Ficaram em .*Lança-Foguetes/.test(left) && /Base › Naves › Equipar/.test(left), view + ': «Ficaram em …: N × Lança-Foguetes…» «' + left.slice(0, 90) + '»');
    await shot(page, 'gear-' + view + '-away');
    await noMissing(page, 'gear ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('4. Base: duplo clique em Contratar/Despedir, foco ao iniciar o 1.º projeto, construção ao teclado, nomes');
  for (const view of ['desk', 'low']) {
    const { ctx, page } = await openPage(view, 'base-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'personnel'));
    await sleep(700);
    const f0 = await page.evaluate(() => window.__G.funds);
    const d0 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    await page.locator('[data-hire="soldier"][data-n="5"]').dblclick();
    await sleep(500);
    const d1 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    const f1 = await page.evaluate(() => window.__G.funds);
    check(d1 - d0 === 5, view + ': duplo clique em «Contratar +5» contrata 5 (não 10): ' + (d1 - d0) + ', fundos −' + (f0 - f1));
    const s0 = await page.evaluate(() => OV.BaseSim.staff(window.__G, window.__G.bases[0].id).scientists.total);
    await page.locator('[data-sack="scientist"][data-n="5"]').dblclick();
    await sleep(500);
    const s1 = await page.evaluate(() => OV.BaseSim.staff(window.__G, window.__G.bases[0].id).scientists.total);
    check(s0 - s1 === 5, view + ': duplo clique em «Despedir 5» despede 5: ' + (s0 - s1));
    // dois cliques espaçados contam os dois
    await page.locator('[data-hire="soldier"][data-n="1"]').click();
    await sleep(600);
    await page.locator('[data-hire="soldier"][data-n="1"]').click();
    await sleep(400);
    const d2 = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.kind === 'soldier').reduce((s, d) => s + d.n, 0));
    check(d2 - d1 === 2, view + ': dois cliques espaçados contratam 2: ' + (d2 - d1));
    await shot(page, 'base-' + view + '-hire');
    // investigação: N com o foco no separador, Enter → foco no «Novo projeto»
    await page.keyboard.press('2');
    await sleep(400);
    await page.evaluate(() => { const t = document.querySelector('.bsc-tab.on'); if (t) t.focus(); });
    await page.keyboard.press('n');
    await sleep(500);
    const f = await page.evaluate(() => (document.activeElement && document.activeElement.textContent) || '');
    check(/Iniciar/.test(f), view + ': N abre a escolha com o foco em «Iniciar» (' + f.slice(0, 30) + ')');
    await page.keyboard.press('Enter');
    await sleep(600);
    const af = await page.evaluate(() => ({ tag: document.activeElement.tagName, act: document.activeElement.dataset && document.activeElement.dataset.act, n: window.__G.bases[0].research.length }));
    check(af.n === 1 && af.act === 'newResearch', view + ': 1.º projeto iniciado e o foco no «Novo projeto» ' + JSON.stringify(af));
    const sub = await page.locator('.bsc-head-sub').first().innerText().catch(() => '');
    check(!/^1 projetos/.test(sub), view + ': subtítulo no singular quando é 1 («' + sub + '»)');
    const names = await page.evaluate(() => [...document.querySelectorAll('.bsc-stepper[data-topic] .btn')].map((b) => b.getAttribute('aria-label') || ''));
    check(names.length && names.every((n) => / — /.test(n)), view + ': botões dos cientistas com o nome do projeto ' + (names[0] || ''));
    await shot(page, 'base-' + view + '-research');
    // construção: só teclado
    await page.keyboard.press('1');
    await sleep(400);
    await page.mouse.move(2, 2);
    await page.evaluate(() => { const r = document.querySelector('[data-fac="living_quarters"]'); r.focus(); r.click(); });
    await sleep(400);
    let minLeft = 1e9, maxRight = -1e9;
    for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight']) {
      await page.keyboard.press(k);
      await sleep(90);
      const r = await page.evaluate(() => { const g = document.querySelector('.bsc-ghosttip:not(.hidden)'); if (!g) return null; const b = g.getBoundingClientRect(); return { l: b.left, r: b.right }; });
      if (r) { minLeft = Math.min(minLeft, r.l); maxRight = Math.max(maxRight, r.r); }
    }
    const vw = VIEWS[view].viewport.width;
    check(minLeft >= 0 && maxRight <= vw, view + ': a dica do fantasma fica dentro da janela (' + Math.round(minLeft) + '…' + Math.round(maxRight) + ')');
    const info = await page.locator('.bsc-info').innerText().catch(() => '');
    check(/Enter constrói|ocupada|elevador|ligada/i.test(info), view + ': texto do teclado no modo construção «' + info.replace(/\s+/g, ' ').slice(0, 90) + '»');
    await shot(page, 'base-' + view + '-build');
    await noMissing(page, 'base ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('5. Geoscape: painel a 1024×560 com dois avisos; mira logo no «Escolher no globo»');
  for (const view of ['low', 'zoom', 'desk']) {
    const { ctx, page } = await openPage(view, 'side-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 2 });
    await page.evaluate(() => { const G = window.__G; for (const id of G.bases[0].soldiers.slice(0, 7)) OV.Campaign.findSoldier(G, id).woundDays = 9; });
    await page.evaluate(LANDED, { lon: 2, lat: 46 });
    await page.evaluate(REOPEN);
    await sleep(700);
    const al = await page.locator('.geo-alert').count();
    check(al >= 2, view + ': dois avisos persistentes (' + al + ')');
    // Tab até à linha do OVNI: tem de ficar à vista
    let vis = null;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('.geo-lists')) return null; const b = a.getBoundingClientRect(); return { t: b.top, b: b.bottom, text: a.textContent }; });
      if (r && /OVNI/.test(r.text)) { vis = r; break; }
    }
    await sleep(300);
    if (vis) vis = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); return { t: b.top, b: b.bottom }; });
    const H = VIEWS[view].viewport.height;
    check(vis && vis.t >= 0 && vis.b <= H + 1, view + ': a linha do OVNI com o foco está à vista ' + JSON.stringify(vis));
    const side = await page.evaluate(() => { const s = document.querySelector('.geo-side'); const b = s.getBoundingClientRect(); return { b: b.bottom, oy: getComputedStyle(s).overflowY }; });
    check(side.b <= H && side.oy === 'auto', view + ': painel dentro da janela e com deslocação ' + JSON.stringify(side));
    await shot(page, 'side-' + view + '-focus');
    // «Escolher no globo» pela tecla G: a mira aparece logo e a linha Enter/Esc fica
    await page.evaluate(() => { document.activeElement.blur(); OV.GeoUI.intercept(window.__G); });
    await sleep(400);
    const ic = await page.evaluate(() => { const r = [...document.querySelectorAll('.geo-dlg .geo-row')].find((x) => /Intercetor|Interceptor/.test(x.textContent) && !x.disabled); if (r) r.click(); return !!r; });
    await sleep(400);
    check(ic, view + ': escolheu um intercetor');
    await page.keyboard.press('g');
    await sleep(600);
    const b1 = await page.locator('.geo-banner').innerText().catch(() => '');
    check(/Enter: escolher · Esc: cancelar/.test(b1), view + ': sem setas, a faixa já diz Enter/Esc «' + b1.replace(/\s+/g, ' ') + '»');
    await shot(page, 'side-' + view + '-aim');
    await page.keyboard.press('ArrowLeft');
    await sleep(500);
    const b2 = await page.locator('.geo-banner').innerText().catch(() => '');
    check(/Enter: escolher · Esc: cancelar/.test(b2), view + ': depois de uma seta a linha Enter/Esc fica «' + b2.replace(/\s+/g, ' ') + '»');
    await page.keyboard.press('Escape');
    await sleep(200);
    await noMissing(page, 'side ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('6. iPad: Financiamento em retrato, textos sem teclas, selos 1/2/3, toque duplo no mar');
  for (const view of ['padP', 'padL']) {
    const { ctx, page } = await openPage(view, 'pad-' + view);
    await page.evaluate(NEWG, { diff: 0, month: 1 });
    await sleep(500);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.geo-acts .btn')].find((x) => /Financ/.test(x.textContent)); b.click(); });
    await sleep(600);
    const fd = await page.evaluate(() => {
      const l = document.querySelector('.geo-fund-l');
      const th = [...document.querySelectorAll('.geo-fund-t th')].pop();
      const lb = l.getBoundingClientRect(), tb = th.getBoundingClientRect();
      return { sw: l.scrollWidth, cw: l.clientWidth, thR: tb.right, lR: lb.right, ta: getComputedStyle(l).touchAction };
    });
    check(fd.sw <= fd.cw + 1 && fd.thR <= fd.lR + 1, view + ': tabela do Financiamento inteira (Evolução à vista) ' + JSON.stringify(fd));
    await shot(page, 'pad-' + view + '-funding');
    await page.evaluate(() => { const x = document.querySelector('.geo-dlg .geo-x'); if (x) x.click(); });
    await sleep(300);
    // sinalizadores e interceção sem teclas
    const txt = await page.evaluate(() => {
      const G = window.__G, c = window.__sky;
      c.equipment = Object.assign({}, c.equipment, { electro_flare: 3 });
      const out = [];
      for (let l = -180; l < 180; l += 15) {
        const id = 'u96' + out.length;
        G.ufos.push({ id, type: 'small_scout', status: 'landed', lon: l, lat: 10, detected: true, race: 'sectoid', groundLeftS: 36000 });
        out.push(OV.GeoUI.model.teamEtaLine(G, { kind: 'ufo', id }, 0));
      }
      return out.filter((x) => /sinalizador/.test(x));
    });
    check(txt.length > 0 && txt.every((x) => !/ com L /.test(x) && /botão do sinalizador/.test(x)), view + ': sinalizadores sem a tecla L ' + (txt[0] || '(nenhuma noite)'));
    const df = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 21, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      G.ufos.push({ id: 'u93', type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -8, lat: 40, dest: { lon: 0, lat: 45 }, alt: 2, speed: 2200, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const ic = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'interceptor');
      OV.GeoUI.open(G);
      const d = OV.Dogfight.create(G, ic.id, 'u93');
      G.events.length = 0;
      OV.DogfightUI.open(G, d.id);
      const h = document.querySelector('.df-hint');
      return h ? h.textContent : '';
    });
    check(/Os interruptores ligam/.test(df) && !/Q\/E|\(3\)|2 Cauteloso/.test(df), view + ': ajuda da interceção sem teclas «' + df.slice(0, 80) + '»');
    await shot(page, 'pad-' + view + '-df');
    await noMissing(page, 'pad ' + view);
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage('padL', 'ng-padL');
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('newgame', {}); });
    await page.waitForSelector('.cp-diff');
    const badge = await page.evaluate(() => [...document.querySelectorAll('.cp-diff-n')].map((n) => getComputedStyle(n).display));
    check(badge.length === 3 && badge.every((d) => d === 'none'), 'iPad: sem selos 1/2/3 nas dificuldades ' + badge.join(','));
    await shot(page, 'ng-padL-diff');
    await page.locator('.cp-ng-diff .btn.primary').tap();
    await page.waitForSelector('.cp-ng-side', { timeout: 8000 });
    await sleep(1200);
    const tip = await page.locator('.cp-globe-tip').innerText().catch(() => '');
    check(/Toque longo: centrar/.test(tip), 'iPad: «Toque longo: centrar», como no Geoscape «' + tip + '»');
    const pt = await page.evaluate(() => { const d = OV.CampaignUI.debug.newgame(); return OV.GlobeRender.project(Object.assign({}, d.view), -30, 35); });
    if (pt.front) {
      await page.touchscreen.tap(pt.x, pt.y);
      await sleep(90);
      await page.touchscreen.tap(pt.x, pt.y);
      await sleep(700);
      const n = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].filter((t) => /terra firme/.test(t.textContent)).length);
      check(n === 0, 'iPad: toque duplo no mar só centra (avisos: ' + n + ')');
      await page.touchscreen.tap(pt.x, pt.y);
      await sleep(700);
      const n2 = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].filter((t) => /terra firme/.test(t.textContent)).length);
      check(n2 === 1, 'iPad: um toque no mar dá um aviso (' + n2 + ')');
      await page.touchscreen.tap(pt.x, pt.y);
      await sleep(700);
      const n3 = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].filter((t) => /terra firme/.test(t.textContent)).length);
      check(n3 === 1, 'iPad: o mesmo aviso não se empilha (' + n3 + ')');
      await shot(page, 'ng-padL-sea');
    } else check(false, 'iPad: ponto no mar visível');
    await noMissing(page, 'newgame padL');
    await ctx.close();
  }

  // =============================================================================================================
  log('7. Relatório mensal ao teclado; carregar uma gravação manual sorteia outro mapa');
  for (const view of ['low', 'desk', 'padP']) {
    const { ctx, page } = await openPage(view, 'mr-' + view);
    await page.evaluate(NEWG, { diff: 0 });
    await page.evaluate(() => {
      const G = window.__G;
      OV.Economy.addScore(G, 'alien', 900, -100, 40);
      const rep = OV.Economy.monthEnd(G);
      OV.CampaignUI.monthReport(G, rep);
    });
    await page.waitForSelector('.cp-mr .cp-fund');
    await sleep(400);
    const sc0 = await page.evaluate(() => { const b = document.querySelector('.cp-mr-body'); return { h: b.scrollHeight, c: b.clientHeight, t: b.scrollTop, ti: b.tabIndex }; });
    check(sc0.ti === 0, view + ': o corpo do relatório recebe o Tab');
    if (!TOUCH(view)) {
      await page.keyboard.press('PageDown');
      await sleep(300);
      await page.keyboard.press('ArrowDown');
      await sleep(300);
      const t1 = await page.evaluate(() => document.querySelector('.cp-mr-body').scrollTop);
      check(sc0.h <= sc0.c + 1 || t1 > 0, view + ': PageDown/↓ deslocam o relatório (' + t1 + ' de ' + (sc0.h - sc0.c) + ')');
      await page.keyboard.press('End');
      await sleep(300);
      await page.keyboard.press('Tab');
      const foc = await page.evaluate(() => document.activeElement.classList.contains('cp-mr-body') || /CONTINUAR|Continuar/.test(document.activeElement.textContent));
      check(foc, view + ': Tab passa pelo corpo do relatório');
      await shot(page, 'mr-' + view + '-end');
      await page.keyboard.press('Home');
    } else await shot(page, 'mr-' + view);
    await noMissing(page, 'mr ' + view);
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage('desk', 'load');
    const r = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 77, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      OV.Save.save('1', G, null, { label: 'QA r3' });
      const st1 = OV.Save.load('1');
      OV.CampaignUI.resume(st1);
      const m1 = OV.Game.G.rng.map;
      const st2 = OV.Save.load('1');
      OV.CampaignUI.resume(st2);
      const m2 = OV.Game.G.rng.map;
      OV.Save.remove('1');
      return { m0: G.rng.map, m1, m2 };
    });
    check(r.m1 !== r.m0 && r.m2 !== r.m1, 'carregar a mesma gravação manual duas vezes dá mapas diferentes ' + JSON.stringify(r));
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
