/* Ronda de personas 2 — QA do «shell» num Chromium real (Playwright): Batalha Rápida (penumbra das bases, Enter no
   deslizador e nos segmentos, semente nova), menu baixo ao teclado, Opções com grupos nomeados e um só Tab por grupo,
   «Como Jogar» por plataforma e com as teclas da base, Geoscape a 1280 px (rótulos inteiros, avisos persistentes de
   cientistas e soldados), «Novo projeto» por omissão, intercetor sem munição, efetivo contra equipa, Mercado
   (+10, duplo clique, espaço), encomendas somadas, separadores ao teclado, dica do fantasma, Ufopédia ao teclado e
   em retrato, relatório ao teclado, avisos que não passam para o ecrã seguinte, dicas só depois de mexer o ponteiro.
   Capturas a 1440×900, 1280×800, 1024×576 (125 %), 1024×560 e iPad 834×1194 / 1194×834 (toque).
   Falha em erros de consola/página ou ⟦…⟧. Uso: node ovni-1999/qa/persona_r2_shell.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r2_shell') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r2_shell') : path.join(process.cwd(), 'qa-out', 'persona_r2_shell');
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
  mba: { viewport: { width: 1280, height: 800 } },
  zoom: { viewport: { width: 1024, height: 576 } },
  low: { viewport: { width: 1024, height: 560 } },
  padP: { viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  padL: { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};

async function openPage(view, tag, o) {
  const ctx = await browser.newContext(VIEWS[view]);
  if (o && o.mac) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign && OV.CampaignUI && OV.BaseUI);
  await sleep(300);
  return { ctx, page };
}
const shot = async (page, name) => { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
const topId = (page) => page.evaluate(() => (OV.Scenes.top() || {}).id);
const noMissing = async (page, where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  check(!m, where + ': chaves i18n em falta ' + (m ? [...new Set(m)].join(', ') : ''));
};
// campanha nova no Geoscape, sem a introdução
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: (o && o.seed) || 41, difficulty: (o && o.diff) | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  if (o && o.month) G.month = o.month;
  window.__G = G;
  OV.GeoUI.open(G);
  return true;
};
const REOPEN = () => { OV.GeoUI.open(window.__G); return true; };

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Batalha Rápida: penumbra na base alienígena, Enter no deslizador e nos segmentos, semente nova');
  for (const view of ['desk', 'zoom', 'padP']) {
    const { ctx, page } = await openPage(view, 'qb-' + view);
    const seeds = [];
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('quickbattle', {}); });
      await sleep(350);
      seeds.push(+(await page.locator('.scr-seed').inputValue()));
      await page.evaluate(() => { localStorage.setItem('ovni1999.quick', JSON.stringify({ kind: 'crash', seed: 4242 })); });
    }
    check(seeds[0] !== seeds[1] || seeds[0] !== 4242, view + ': semente nova em cada abertura ' + seeds.join('/'));
    // semente escrita à mão fica (seedLocked)
    if (view === 'desk') {
      await page.locator('.scr-seed').fill('777');
      await page.locator('.scr-seed').press('Tab');
      await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('quickbattle', {}); });
      await sleep(300);
      // a semente só se guarda ao começar: começa e volta
      await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('quickbattle', {}); });
      await sleep(300);
    }
    await page.locator('.scr-seg-b[data-v="alienBase"]').click();
    await sleep(250);
    const form = await page.locator('.scr-qb').innerText();
    check(/Hora determinada pela missão: Penumbra/i.test(form), view + ': HORA explica a penumbra');
    check(/Penumbra/.test(await page.locator('.scr-summary').innerText()) && !/\bNoite\b/.test(await page.locator('.scr-summary .scr-chips').innerText()), view + ': resumo «Penumbra», não «Noite»');
    await noMissing(page, 'qb ' + view);
    await shot(page, 'qb-' + view + '-alienbase');
    if (view !== 'padP') {
      // Enter com o foco no deslizador EQUIPA
      await page.locator('.scr-range input[type=range]').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await sleep(450);
      check((await topId(page)) === 'briefing', view + ': Enter no deslizador começa (' + (await topId(page)) + ')');
      const br = await page.locator('.scr-brief').innerText();
      check(/Iluminação fraca e fixa/.test(br) && !/Missão noturna/.test(br), view + ': briefing da base sem nota de noite');
      check(/UT Unidades de Tempo/.test(br) && /FOR Força/.test(br), view + ': legenda das estatísticas');
      check(await page.evaluate(() => document.querySelector('.scr-st').getAttribute('title') === 'Unidades de Tempo'), view + ': UT com o nome completo');
      check(await page.evaluate(() => !OV.Scenes.top() || true) && await page.evaluate(() => [...document.querySelectorAll('.scr-soldier')].length > 0), view + ': equipa no briefing');
      await shot(page, 'qb-' + view + '-brief');
      await page.keyboard.press('Escape');
      await sleep(350);
      // Enter com o foco num segmento
      await page.locator('.scr-seg-b[data-v="crash"]').click();
      await sleep(150);
      await page.locator('.scr-seg-b[data-v="crash"]').focus();
      await page.keyboard.press('Enter');
      await sleep(450);
      check((await topId(page)) === 'briefing', view + ': Enter num segmento começa');
    }
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Menu a 1024×560: ↓ até «Créditos» mantém o item e a dica à vista');
  {
    const { ctx, page } = await openPage('low', 'menu');
    await page.evaluate(() => OV.Scenes.set('menu'));
    await sleep(400);
    for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowDown'); await sleep(60); }
    await sleep(300);
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      const foot = document.querySelector('.scr-menu-foot').getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      return { id: a.dataset.id, top: ar.top, bottom: ar.bottom, foot: foot.bottom, h: innerHeight };
    });
    check(!!r.id, 'menu: foco num item ' + r.id);
    await page.evaluate(() => { const L = [...document.querySelectorAll('.scr-mi')]; L[L.length - 1].focus(); });
    for (let i = 0; i < 9 && (await page.evaluate(() => document.activeElement.dataset.id)) !== 'credits'; i++) await page.keyboard.press('ArrowDown');
    await sleep(300);
    const r2 = await page.evaluate(() => {
      const a = document.activeElement.getBoundingClientRect(), foot = document.querySelector('.scr-menu-foot').getBoundingClientRect();
      return { id: document.activeElement.dataset.id, bottom: a.bottom, foot: foot.bottom, h: innerHeight };
    });
    check(r2.id === 'credits' && r2.bottom <= r2.h + 0.5, 'menu: «Créditos» à vista ' + JSON.stringify(r2));
    check(r2.foot <= r2.h + 0.5, 'menu: dica do rodapé à vista ' + JSON.stringify(r2));
    await shot(page, 'menu-low-credits');
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Opções: cada grupo com nome legível e um só Tab; Gravações com nome por posição');
  {
    const { ctx, page } = await openPage('zoom', 'opts');
    await page.evaluate(() => OV.Scenes.push('options', {}));
    await sleep(400);
    const g = await page.evaluate(() => [...document.querySelectorAll('.scr-opts [role=radiogroup]')].map((r) => {
      const id = r.getAttribute('aria-labelledby');
      const lab = id ? (document.getElementById(id) || {}).textContent : r.getAttribute('aria-label');
      return { lab, stops: [...r.querySelectorAll('.scr-seg-b')].filter((b) => b.tabIndex >= 0).length };
    }));
    check(g.length >= 8, 'opções: grupos ' + g.length);
    check(g.every((x) => x.lab && !/^(speedXcom|speedAlien|confirmMove|wheel|confirmBlast|palette|reduceMotion|textScale)$/.test(x.lab)), 'opções: nomes legíveis ' + g.map((x) => x.lab).join(' · '));
    check(g.every((x) => x.stops === 1), 'opções: um só Tab por grupo ' + g.map((x) => x.stops).join(','));
    const stops = await page.evaluate(() => [...document.querySelectorAll('.scr-opts button, .scr-opts input')].filter((b) => b.tabIndex >= 0 && !b.disabled && b.offsetParent).length);
    check(stops <= 22, 'opções: paragens do Tab ' + stops);
    await shot(page, 'opts-zoom');
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.evaluate(() => { localStorage.setItem('ovni1999.save.1', '{}'); });
    await page.evaluate(NEWG, {});
    await sleep(500);
    await page.evaluate(() => OV.CampaignUI.saveDialog ? OV.CampaignUI.saveDialog(window.__G) : OV.Scenes.push('saveload', { G: window.__G, mode: 'save' }));
    await sleep(500);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.cp-sl-acts .btn')].map((b) => b.getAttribute('aria-label')));
    check(labels.length > 0 && labels.every((l) => l && /: /.test(l)), 'gravações: botões com posição ' + labels.join(' | '));
    await shot(page, 'saves-zoom');
    await ctx.close();
  }

  // =============================================================================================================
  log('4. Como Jogar: ⌘ no Mac, Ctrl fora dele; tabela «Teclado na base»');
  for (const mac of [true, false]) {
    const { ctx, page } = await openPage('desk', 'howto-' + mac, { mac });
    await page.evaluate(() => OV.Scenes.push('howto', {}));
    await sleep(400);
    const t = await page.locator('.scr-howto-body').innerText();
    if (mac) check(/⌘ Cmd\+clique a apontar/.test(t) && !/Ctrl\+clique a apontar/.test(t), 'mac: força o tiro com ⌘');
    else check(/Ctrl\+clique a apontar/.test(t) && !/⌘ Cmd/.test(t), 'outros: força o tiro com Ctrl');
    if (mac) await shot(page, 'howto-mac');
    await page.keyboard.press('3');
    await sleep(250);
    check(/Teclado na base/i.test(await page.locator('.scr-howto-body').innerText()), 'Como Jogar › Geoscape: teclas da base');
    if (!mac) await shot(page, 'howto-geo');
    await noMissing(page, 'howto');
    await ctx.close();
  }

  // =============================================================================================================
  log('5. Geoscape a 1280×800: rótulos inteiros, avisos persistentes, «Novo projeto» por omissão');
  for (const view of ['mba', 'zoom', 'padL']) {
    const { ctx, page } = await openPage(view, 'geo-' + view);
    await page.evaluate(NEWG, { month: 3 });
    await sleep(700);
    const cut = await page.evaluate(() => [...document.querySelectorAll('.geo-acts .btn .geo-bl')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent + ' ' + s.scrollWidth + '>' + s.clientWidth));
    check(!cut.length, view + ': rótulos do painel inteiros ' + cut.join(', '));
    check(await page.locator('.geo-alert[data-alert="sci"]').isVisible(), view + ': aviso «cientistas parados» fora do 1.º mês');
    await noMissing(page, 'geo ' + view);
    await shot(page, 'geo-' + view + '-alerts');
    // poucos soldados
    await page.evaluate(() => { const G = window.__G; for (const id of G.bases[0].soldiers.slice(0, 7)) OV.Campaign.findSoldier(G, id).woundDays = 9; OV.BaseSim.hire(G, 'b1', 'soldier', 5); });
    await page.evaluate(REOPEN);
    await sleep(500);
    const sq = await page.locator('.geo-alert[data-alert="squad"]').innerText().catch(() => '');
    check(/Só 3 soldados aptos/.test(sq) && /Chegam 5 recrutas/.test(sq), view + ': aviso de poucos soldados com recrutas a caminho «' + sq + '»');
    // «Enviar equipa» contra um OVNI aterrado conhecido
    await page.evaluate(() => {
      const G = window.__G;
      G.ufos.push({ id: 'u71', type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2, lat: 46, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      G.seen.ufoTypes.push('medium_scout');
      OV.GeoUI.intercept(G, 'u71');
    });
    await sleep(500);
    const dlg = await page.locator('.geo-dlg').innerText().catch(() => '');
    check(/Só 3 soldados contra \d/.test(dlg), view + ': «Só 3 soldados contra …» no Enviar equipa');
    await shot(page, 'geo-' + view + '-send-short');
    await page.keyboard.press('Escape');
    await sleep(250);
    if (view === 'mba') {
      // investigação concluída com cientistas parados: Enter → escolha de projeto
      await page.evaluate(() => { window.__G.events.push({ t: 'researchDone', topic: 'laser_weapons', baseId: 'b1', unlocked: [], manufacture: [] }); OV.GeoUI.open(window.__G); });
      await sleep(600);
      const pop = await page.locator('.geo-pop').innerText().catch(() => '');
      check(/Novo projeto/.test(pop), 'investigação concluída: botão «Novo projeto»');
      check(await page.evaluate(() => { const b = document.querySelector('.geo-pop .btn.primary'); return !!b && /Novo projeto/.test(b.textContent); }), 'investigação concluída: «Novo projeto» realçado');
      await shot(page, 'geo-mba-researchdone');
      await page.keyboard.press('Enter');
      await sleep(700);
      check((await topId(page)) === 'basescape' && (await page.evaluate(() => OV.BaseUI.debug.state().tab)) === 'research', 'Enter → base › Investigação');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await sleep(500);
      // intercetor sem munição
      await page.evaluate(() => {
        const G = window.__G;
        if (OV.Scenes.top().id !== 'geoscape') OV.GeoUI.open(G);
        for (const id of Object.keys(G.crafts)) if (G.crafts[id].type === 'interceptor') for (const w of G.crafts[id].weapons) if (w) w.ammo = 0;
        G.ufos.push({ id: 'u72', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -8, lat: 41, dest: { lon: 0, lat: 45 }, alt: 2, speed: 2200, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
        OV.GeoUI.intercept(G, 'u72');
      });
      await sleep(500);
      check(/SEM MUNIÇÃO/.test(await page.locator('.geo-dlg').innerText()), 'interceção: selo «SEM MUNIÇÃO»');
      await shot(page, 'geo-mba-noammo');
      await page.locator('.geo-dlg .geo-row.dry').first().click();
      await sleep(400);
      check(/Enviar sem munição/i.test(await page.locator('#modals').innerText()), 'interceção: confirmação antes de enviar');
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.keyboard.press('Escape');
      await sleep(300);
      // aviso de rearme → Mercado na linha certa
      await page.evaluate(() => { const G = window.__G; G.events.push({ t: 'craftRearmShort', craftId: 'c2', itemId: 'stingray_missile', what: 'ammo' }); OV.GeoUI.open(G); });
      await sleep(600);
      check(/Comprar munição/i.test(await page.locator('.geo-pop').innerText().catch(() => '')), 'rearme: janela com «Comprar munição»');
      await page.keyboard.press('Enter');
      await sleep(800);
      const mk = await page.evaluate(() => ({ top: OV.Scenes.top().id, tab: OV.BaseUI.debug.state() && OV.BaseUI.debug.state().tab, hl: (document.querySelector('.bsc-mrow.bsc-hl') || {}).dataset }));
      check(mk.top === 'basescape' && mk.tab === 'market' && mk.hl && mk.hl.buy === 'stingray_missile', 'rearme: Mercado com a linha realçada ' + JSON.stringify(mk));
      await shot(page, 'base-mba-market-ammo');
      // avisos antigos não passam para o ecrã novo
      await page.keyboard.press('Escape');
      await sleep(400);
      const n = await page.evaluate(() => { OV.Dom.toast('teste', null, 'info'); OV.BaseUI.open(window.__G, 'b1', 'facilities'); return document.getElementById('toasts').children.length; });
      check(n === 0, 'avisos limpos ao abrir a base: ' + n);
    }
    await ctx.close();
  }

  // =============================================================================================================
  log('6. Base: Mercado (+10, duplo clique, espaço), encomendas somadas, separadores ao teclado, fantasma, iPad');
  for (const view of ['desk', 'zoom', 'padL', 'padP']) {
    const { ctx, page } = await openPage(view, 'base-' + view);
    await page.evaluate(NEWG, {});
    await sleep(400);
    await page.evaluate(() => OV.BaseUI.open(window.__G, 'b1', 'market'));
    await sleep(600);
    await page.evaluate(() => document.querySelector('.bsc-mrow[data-buy="rifle"]').scrollIntoView({ block: 'center' }));
    await sleep(200);
    const sub = await page.locator('.bsc-mrow[data-buy="rifle"]').innerText();
    check(/ocupa 0,2 un\. cada/.test(sub), view + ': Comprar diz o espaço por unidade');
    // a 1024 px o «+10» esconde-se (só − e +): aí chega-se a 10 com o «+»
    if (await page.locator('[data-qty="buy:rifle:+10"]').isVisible()) await page.locator('[data-qty="buy:rifle:+10"]').click();
    else for (let i = 0; i < 9; i++) { await page.locator('[data-qty="buy:rifle:+1"]').click(); await sleep(40); }
    await sleep(200);
    check((await page.locator('.bsc-mrow[data-buy="rifle"] .bsc-step-v').innerText()) === '10', view + ': «+10» de 1 dá 10');
    const before = await page.evaluate(() => window.__G.bases[0].deliveries.length);
    if (view === 'desk' || view === 'zoom') await page.locator('.bsc-mrow[data-buy="rifle"] [data-act="buy"]').dblclick();
    else {
      // toque duplo rápido no mesmo sítio (o botão é recriado depois do 1.º toque)
      const bb = await page.locator('.bsc-mrow[data-buy="rifle"] [data-act="buy"]').boundingBox();
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(90);
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    }
    await sleep(400);
    const after = await page.evaluate(() => window.__G.bases[0].deliveries.filter((d) => d.itemId === 'rifle').map((d) => d.n));
    await page.evaluate(() => document.querySelector('.bsc-mrow[data-buy="rifle"]').scrollIntoView({ block: 'center' }));
    check(after.length === 1 && after[0] === 10 && (await page.evaluate(() => window.__G.bases[0].deliveries.length)) === before + 1, view + ': duplo clique compra uma vez ' + JSON.stringify(after));
    check((await page.locator('.bsc-mrow[data-buy="rifle"] .bsc-step-v').innerText()) === '1', view + ': quantidade volta a 1');
    await shot(page, 'base-' + view + '-market');
    await page.locator('.bsc-seg [data-mode="sell"]').click();
    await sleep(300);
    check(/liberta/.test(await page.locator('.bsc-tab-market').innerText()), view + ': Vender diz quanto espaço liberta');
    await page.evaluate(() => { const G = window.__G; OV.BaseSim.hire(G, 'b1', 'soldier', 5); OV.BaseSim.hire(G, 'b1', 'soldier', 1); OV.BaseSim.hire(G, 'b1', 'soldier', 1); OV.BaseSim.hire(G, 'b1', 'scientist', 10); OV.BaseUI.open(G, 'b1', 'personnel'); });
    await sleep(500);
    const dl = await page.locator('.bsc-deliv').innerText();
    check(/7 soldados/.test(dl) && (dl.match(/soldado/g) || []).length === 1, view + ': contratações somadas ' + dl.replace(/\n/g, ' / '));
    check(/10 cientistas\s*chegam dentro de/.test(dl), view + ': «chegam» no plural');
    await shot(page, 'base-' + view + '-personnel');
    await page.evaluate(() => OV.BaseUI.open(window.__G, 'b1', 'stores'));
    await sleep(400);
    check(/un\. cada · .* no total/.test(await page.locator('.bsc-tab-stores').innerText()), view + ': Armazém: espaço por unidade e total');
    if (view === 'zoom') {
      const kbd = await page.evaluate(() => [...document.querySelectorAll('.bsc-tab kbd')].filter((k) => getComputedStyle(k).display !== 'none').length);
      check(kbd === 9, 'zoom: teclas dos 9 separadores à vista (' + kbd + ')');
      const cut = await page.evaluate(() => [...document.querySelectorAll('.bsc-tab-l')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
      check(!cut.length, 'zoom: separadores sem cortes ' + cut.join(','));
      await page.locator('.bsc-tab.on').focus();
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      const t = await page.evaluate(() => ({ tab: OV.BaseUI.debug.state().tab, foc: document.activeElement.dataset.tab, kcur: OV.BaseUI.debug.state().kcur }));
      check(t.tab === 'crafts' && t.foc === 'crafts' && !t.kcur, 'zoom: → com o foco num separador muda de separador ' + JSON.stringify(t));
    }
    if (view === 'padL' || view === 'padP') {
      await page.evaluate(() => OV.BaseUI.open(window.__G, 'b1', 'soldiers'));
      await sleep(400);
      const h = await page.evaluate(() => ({ row: Math.min(...[...document.querySelectorAll('.bsc-soltbl tbody tr')].map((r) => r.getBoundingClientRect().height)), th: document.querySelector('.bsc-soltbl thead th').getBoundingClientRect().height }));
      check(h.row >= 32 && h.th >= 32, view + ': linhas de soldados ≥ 32 px ' + JSON.stringify(h));
      await shot(page, 'base-' + view + '-soldiers');
      const date = await page.evaluate(() => { const d = document.querySelector('.bsc-topstats .bsc-ts'); return d ? getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 20 : false; });
      check(date, view + ': a data fica no cabeçalho');
      // construir: tocar numa casa inválida e depois na válida ao lado (a dica não apanha o toque)
      await page.evaluate(() => OV.BaseUI.open(window.__G, 'b1', 'facilities'));
      await sleep(400);
      const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.bsc-ghosttip')).pointerEvents);
      check(pe === 'none', view + ': dica do fantasma sem toques (' + pe + ')');
    }
    await noMissing(page, 'base ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('7. Ufopédia: ↓ desloca o texto em foco; em retrato a figura não tapa o texto');
  {
    const { ctx, page } = await openPage('low', 'up-low');
    await page.evaluate(() => OV.Ufopaedia.open(null));
    await sleep(500);
    for (let i = 0; i < 12; i++) {
      const sc = await page.evaluate(() => { const b = document.querySelector('.up-info'); return b.scrollHeight > b.clientHeight + 4; });
      if (sc) break;
      await page.keyboard.press('ArrowRight');
      await sleep(200);
    }
    const t0 = await page.locator('.up-title').innerText();
    await page.locator('.up-info').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    await sleep(300);
    const r = await page.evaluate(() => ({ st: document.querySelector('.up-info').scrollTop, t: document.querySelector('.up-title').textContent, o: getComputedStyle(document.querySelector('.up-info')).outlineStyle }));
    check(r.t === t0 && r.st > 0, 'ufopédia: ↓/PageDown deslocam o texto e não mudam de artigo ' + JSON.stringify(r));
    check(r.o !== 'none', 'ufopédia: contorno de foco visível');
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    check((await page.locator('.up-title').innerText()) !== t0, 'ufopédia: → muda de artigo');
    await shot(page, 'up-low');
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage('padP', 'up-padP');
    await page.evaluate(() => OV.Ufopaedia.open(null, 'craft_skyranger'));
    await sleep(700);
    const g = await page.evaluate(() => {
      const fig = document.querySelector('.up-fig').getBoundingClientRect(), txt = document.querySelector('.up-info').getBoundingClientRect();
      return { figBottom: fig.bottom, textTop: txt.top };
    });
    check(g.figBottom <= g.textTop + 1, 'ufopédia retrato: a figura acaba antes do texto ' + JSON.stringify(g));
    await shot(page, 'up-padP');
    await ctx.close();
  }

  // =============================================================================================================
  log('8. Relatório: ↓/PageDown deslocam a lista; dicas de botão só depois de mexer o ponteiro');
  for (const view of ['zoom', 'desk']) {
    const { ctx, page } = await openPage(view, 'deb-' + view);
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month: 1, seed: 77, squad: 10, time: 'day' });
      const B = OV.Battle.create(mission);
      const xs = B.units.filter((u) => u.side === 'xcom');
      for (const u of B.units) if (u.side === 'alien') u.status = 'dead';
      for (const u of xs) u.exp = { fire: 3, react: 2, brav: 1, thr: 1 };
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(500);
    const can = await page.evaluate(() => { const b = document.querySelector('.scr-deb-body'); return b.scrollHeight > b.clientHeight + 4; });
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowDown');
    await sleep(400);
    const st = await page.evaluate(() => document.querySelector('.scr-deb-body').scrollTop);
    check(!can || st > 0, view + ': o relatório desloca-se ao teclado (scrollTop ' + st + ')');
    await page.keyboard.press('End');
    await sleep(300);
    await shot(page, 'deb-' + view + '-end');
    // botão que nasce debaixo de um ponteiro parado
    await page.mouse.move(300, 300);
    await sleep(250);
    await page.evaluate(() => {
      const b = OV.Dom.el('button', { type: 'button', class: 'btn', id: 'qa-tt', style: { position: 'fixed', left: '260px', top: '270px', width: '90px', height: '60px', zIndex: 999 } }, 'QA');
      OV.Dom.tooltip(b, '<b>dica QA</b>');
      document.body.appendChild(b);
      b.dispatchEvent(new MouseEvent('mouseenter'));
    });
    await sleep(300);
    const hid = await page.evaluate(() => document.getElementById('tooltip').classList.contains('hidden'));
    check(hid, view + ': sem dica enquanto o ponteiro não se mexe');
    await page.mouse.move(305, 304);
    await sleep(250);
    const shown = await page.evaluate(() => !document.getElementById('tooltip').classList.contains('hidden') && /dica QA/.test(document.getElementById('tooltip').textContent));
    check(shown, view + ': a dica aparece ao mexer o ponteiro');
    await page.evaluate(() => { document.getElementById('qa-tt').remove(); OV.Dom.hideTooltip(); });
    await ctx.close();
  }

  // =============================================================================================================
  log('9. Interceção: com a pergunta dos mísseis aberta a ajuda do combate sai');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'df-' + view);
    const ok = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 21, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      G.ui.geoIntro = true;
      G.ufos.push({ id: 'u93', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: -8, lat: 40, dest: { lon: 0, lat: 45 }, alt: 2, speed: 2200, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
      const ic = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'interceptor');
      window.__G = G;
      OV.GeoUI.open(G);
      const d = OV.Dogfight.create(G, ic.id, 'u93');
      G.events.length = 0;
      return OV.DogfightUI.open(G, d.id);
    });
    await sleep(800);
    const st = await page.evaluate(() => ({
      ask: !document.querySelector('.df-ask').classList.contains('hidden'),
      tip: getComputedStyle(document.querySelector('.df-tip')).display,
      hint: document.querySelector('.df-hint') ? getComputedStyle(document.querySelector('.df-hint')).display : 'none',
      tt: document.getElementById('tooltip').classList.contains('hidden'),
    }));
    check(ok && st.ask && st.tip === 'none' && st.hint === 'none', view + ': pergunta sem a ajuda por baixo ' + JSON.stringify(st));
    check(st.tt, view + ': sem dica de botão a tapar a pergunta');
    await shot(page, 'df-' + view + '-ask');
    await noMissing(page, 'df ' + view);
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
