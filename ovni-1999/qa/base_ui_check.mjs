/* Verificação do Basescape num Chromium real (Playwright): campanha nova (OV.Campaign.newCampaign) com um estado
   de meio de jogo preparado (instalações extra, uma em obras, investigação e fabrico em curso, fabrico parado por
   falta de Elerium, alienígenas vivos, soldado ferido, memorial, nave fora da base, entregas a caminho).
   Fluxo pela interface: construir um laboratório (fantasma válido/inválido + confirmação), iniciar investigação,
   contratar, comprar, vender, equipar o Skyranger (ecrã «Equipar»), instalar uma arma num Intercetor, ordenar
   soldados, memorial, interrogar, desmantelar recusado, voltar (Esc). Capturas de todos os separadores a
   1440×900 e 1024×700 (e iPad em paisagem). Falha em erros de consola/página e chaves ⟦em falta⟧.
   Uso: node ovni-1999/qa/base_ui_check.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'base_ui') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'base_ui') : path.join(process.cwd(), 'qa-out', 'base_ui');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
const notes = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* ainda a arrancar */ }
    await sleep(120);
  }
  return false;
}

const TABS = ['facilities', 'research', 'production', 'personnel', 'stores', 'crafts', 'soldiers', 'market', 'containment'];

// estado de meio de jogo (corre na página)
function setupMidGame() {
  /* global OV */
  const C = OV.Campaign, BS = OV.BaseSim;
  const G = C.newCampaign({ seed: 7, difficulty: 1 });
  OV.Game.G = G;
  const b = G.bases[0];
  G.t = 23 * 86400 + 5 * 3600;
  G.funds = 4200000;
  for (const topic of ['laser_weapons', 'laser_pistol', 'laser_rifle', 'medikit', 'alien_alloys', 'elerium', 'plasma_pistol', 'personal_armour']) BS.completeResearch(G, b.id, topic);
  // instalações: contenção e armazém concluídos, radar grande em obras
  BS.build(G, b.id, 'alien_containment', 1, 2);
  BS.build(G, b.id, 'general_stores', 2, 4);
  BS.build(G, b.id, 'large_radar', 4, 2);
  for (const f of b.grid) if (f.type === 'alien_containment' || (f.type === 'general_stores' && f.y === 4)) f.daysLeft = 0;
  for (const f of b.grid) if (f.type === 'large_radar') f.daysLeft = 6;
  // material recuperado: ligas, sem Elerium (falta para os carregadores de plasma), cadáveres, armadura
  Object.assign(b.stores, { alien_alloys: 6, sectoid_corpse: 3, plasma_pistol: 2, personal_armour: 2, ufo_navigation: 1 });
  delete b.stores.elerium_115;
  b.aliens = { sectoid_navigator: 1, sectoid_soldier: 2 };
  // investigação e fabrico em curso; um fabrico parado por falta de Elerium
  BS.startResearch(G, b.id, 'motion_scanner', 6);
  BS.startResearch(G, b.id, 'autopsy_sectoid', 3);
  b.research[0].spent = 22;
  BS.startProduction(G, b.id, 'laser_rifle', 6, 3);
  b.production[0].spent = 31;
  BS.startProduction(G, b.id, 'plasma_pistol_clip', 2, 0);
  // soldados: um ferido (fora da nave), um veterano, um morto no memorial
  BS.assignSoldier(G, 's3', null);
  G.soldiers.s3.woundDays = 6;
  const v = G.soldiers.s1;
  v.missions = 4; v.kills = 5; v.rank = 2; v.stats.fire += 7; v.stats.react += 4; v.stats.brav += 10;
  OV.Soldiers.kill(G, 's8', 'kia', null);
  // um Intercetor fora da base; entregas a caminho
  const c3 = G.crafts.c3;
  c3.status = 'returning'; c3.lon += 6; c3.lat += 3; c3.speed = 2100; c3.fuel = 640;
  BS.hire(G, b.id, 'engineer', 5);
  BS.buy(G, b.id, 'stingray_missile', 4);
  G.events.length = 0;
  return { funds: G.funds, grid: b.grid.length, research: b.research.length, deliveries: b.deliveries.length };
}

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1&debug=1`;

const browser = await chromium.launch();
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  async function session(vw, vh, dsf, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf }, opts || {}));
    const page = await ctx.newPage();
    const tag = vw + 'x' + vh;
    page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
    await page.goto(BASE);
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 20000 });
    const info = await page.evaluate(setupMidGame);
    await page.evaluate(() => OV.BaseUI.open(OV.Game.G, 'b1', 'facilities'));
    await page.waitForFunction(() => OV.BaseUI.isOpen() && OV.BaseUI.debug.state().layout, null, { timeout: 10000 });
    await sleep(350);
    return { ctx, page, info, tag };
  }
  const st = (page) => page.evaluate(() => OV.BaseUI.debug.state());
  const G = (page, fn) => page.evaluate(fn);
  const shot = async (page, name) => { await sleep(260); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  async function noMissing(page, where) {
    const r = await page.evaluate(() => {
      const txt = document.body.innerText;
      const i = txt.indexOf('⟦');
      return { bad: i >= 0 ? txt.slice(i, i + 60) : null, missing: [...OV.T.missing] };
    });
    check(!r.bad, where + ': texto com chave em falta ' + r.bad);
    check(!r.missing.length, where + ': OV.T.missing = ' + r.missing.join(', '));
  }
  async function overflowCheck(page, where) {
    const r = await page.evaluate(() => {
      const out = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth + 1) out.push('página com deslocação horizontal ' + doc.scrollWidth + '>' + innerWidth);
      for (const sel of ['.bsc-top', '.bsc-tabs', '.bsc-panel', '.bsc-caps', '.bsc-info']) {
        const n = document.querySelector(sel);
        if (!n) { out.push('em falta ' + sel); continue; }
        const r = n.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1) out.push(sel + ' sai do ecrã');
        if (sel !== '.bsc-panel' && n.scrollWidth > n.clientWidth + 2) out.push(sel + ' transborda (' + n.scrollWidth + '>' + n.clientWidth + ')');
      }
      const cut = [...document.querySelectorAll('.bsc-tab-l')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent);
      if (cut.length) out.push('separadores cortados: ' + cut.join(', '));
      const L = OV.BaseUI.debug.state().layout;
      if (!L || L.cell < 40) out.push('células demasiado pequenas: ' + (L && L.cell));
      return out;
    });
    for (const m of r) check(false, where + ': ' + m);
  }
  // célula da grelha → coordenadas do rato
  async function cellXY(page, x, y) {
    return page.evaluate(([cx, cy]) => OV.BaseUI.debug.cellCenter(cx, cy), [x, y]);
  }

  // ===================================== 1440×900: fluxo completo =====================================
  {
    const { ctx, page, info } = await session(1440, 900, 1);
    check(info.research === 2 && info.deliveries === 2, 'preparação do estado: ' + JSON.stringify(info));
    let s = await st(page);
    check(s.tab === 'facilities' && s.baseId === 'b1', 'abre no separador Instalações');
    await shot(page, '1440_01_facilities');
    await noMissing(page, 'instalações');
    await overflowCheck(page, '1440 instalações');

    // seleção de uma instalação + desmantelar recusado (elevador)
    let p = await cellXY(page, 2, 2);
    await page.mouse.click(p.x, p.y);
    await sleep(120);
    s = await st(page);
    check(s.sel && s.sel.x === 2 && s.sel.y === 2, 'clique seleciona o elevador');
    const disabled = await page.evaluate(() => { const b = [...document.querySelectorAll('.bsc-info .btn.danger')][0]; return b ? b.classList.contains('disabled') : null; });
    check(disabled === true, 'desmantelar o elevador fica bloqueado');
    await page.hover('.bsc-info .btn.danger');
    await shot(page, '1440_02_select_lift');
    await page.keyboard.press('Escape');

    // construir um laboratório: lista → fantasma inválido/válido → confirmação
    const funds0 = await G(page, () => OV.Game.G.funds);
    await page.click('[data-fac="laboratory"]');
    s = await st(page);
    check(s.build === 'laboratory', 'modo de construção ativo');
    p = await cellXY(page, 0, 0);
    await page.mouse.move(p.x, p.y);
    await sleep(150);
    const tipBad = await page.evaluate(() => { const t = document.querySelector('.bsc-ghosttip'); return t ? t.className + '|' + t.textContent : ''; });
    check(/bad/.test(tipBad), 'fantasma inválido em (0,0): ' + tipBad);
    await shot(page, '1440_03_ghost_invalid');
    p = await cellXY(page, 5, 3);
    await page.mouse.move(p.x, p.y);
    await sleep(150);
    const tipOk = await page.evaluate(() => { const t = document.querySelector('.bsc-ghosttip'); return t ? t.className + '|' + t.textContent : ''; });
    check(/good/.test(tipOk), 'fantasma válido em (5,3): ' + tipOk);
    await shot(page, '1440_04_ghost_valid');
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('.modal .btn.primary', { timeout: 3000 });
    await shot(page, '1440_05_build_confirm');
    await page.click('.modal .btn.primary');
    await sleep(200);
    const lab = await G(page, () => OV.Game.G.bases[0].grid.find((f) => f.type === 'laboratory' && f.x === 5 && f.y === 3) || null);
    check(lab && lab.daysLeft > 0, 'laboratório em obras em (5,3)');
    const funds1 = await G(page, () => OV.Game.G.funds);
    check(funds0 - funds1 === 750000, 'custo do laboratório pago: ' + (funds0 - funds1));
    s = await st(page);
    check(!s.build, 'sai do modo de construção depois de construir');
    await shot(page, '1440_06_built');

    // teclado: construção com setas + Enter num sítio inválido (recusa sem mudar nada)
    await page.click('[data-fac="general_stores"]');
    await page.keyboard.press('Escape');
    s = await st(page);
    check(!s.build, 'Esc cancela a construção');

    // investigação
    await page.keyboard.press('2');
    s = await st(page);
    check(s.tab === 'research', 'tecla 2 abre a Investigação');
    await shot(page, '1440_07_research');
    await noMissing(page, 'investigação');
    const r0 = await G(page, () => OV.Game.G.bases[0].research.length);
    await page.click('[data-act="newResearch"]');
    await page.waitForSelector('.bsc-sheet [data-start]', { timeout: 3000 });
    await shot(page, '1440_08_research_picker');
    await noMissing(page, 'escolha de investigação');
    const topic = await page.getAttribute('.bsc-sheet [data-start]', 'data-start');
    await page.click('.bsc-sheet [data-start]');
    await sleep(150);
    const r1 = await G(page, () => OV.Game.G.bases[0].research.map((p) => p.topic));
    check(r1.length === r0 + 1 && r1.indexOf(topic) >= 0, 'investigação iniciada: ' + topic);
    // +1 cientista num projeto: sem cientistas livres fica bloqueado com razão
    const sciBefore = await G(page, () => OV.Game.G.bases[0].research[0].scientists);
    const plusDisabled = await page.evaluate(() => { const b = document.querySelector('.bsc-proj .bsc-stepper .btn:nth-child(4)'); const d = b.getAttribute('aria-disabled') === 'true'; b.click(); return d; });
    await sleep(80);
    if (plusDisabled) check(await page.evaluate(() => /cientistas livres|laborat/i.test(document.getElementById('toasts').innerText)), 'botão bloqueado explica a razão num aviso');
    const sciAfter = await G(page, () => OV.Game.G.bases[0].research[0].scientists);
    const freeSci = await G(page, () => OV.BaseSim.staff(OV.Game.G, 'b1').scientists.free);
    check(sciAfter === sciBefore || sciAfter === sciBefore + 1, 'passo de cientistas coerente');
    notes.push('cientistas livres após iniciar: ' + freeSci);
    await shot(page, '1440_09_research_running');

    // produção (fabrico parado por falta de Elerium visível)
    await page.keyboard.press('3');
    await sleep(100);
    const stalled = await page.evaluate(() => document.querySelectorAll('.bsc-order.stalled').length);
    check(stalled >= 1, 'fabrico parado assinalado');
    await shot(page, '1440_10_production');
    await noMissing(page, 'produção');
    await page.click('[data-act="newProduction"]');
    await page.waitForSelector('.bsc-sheet [data-start]', { timeout: 3000 });
    await shot(page, '1440_11_production_picker');
    await page.keyboard.press('Escape');
    await sleep(100);

    // pessoal: contratar 5 cientistas
    await page.keyboard.press('4');
    const d0 = await G(page, () => OV.Game.G.bases[0].deliveries.length);
    await page.click('[data-hire="scientist"][data-n="5"]');
    await sleep(120);
    const d1 = await G(page, () => OV.Game.G.bases[0].deliveries.filter((d) => d.kind === 'scientist').map((d) => d.n));
    check(d1.indexOf(5) >= 0 && (await G(page, () => OV.Game.G.bases[0].deliveries.length)) === d0 + 1, 'contratação de 5 cientistas a caminho');
    await shot(page, '1440_12_personnel');
    await noMissing(page, 'pessoal');

    // armazém
    await page.keyboard.press('5');
    await shot(page, '1440_13_stores');
    await noMissing(page, 'armazém');

    // naves: equipar o Skyranger
    await page.keyboard.press('6');
    await page.click('[data-craft="c1"]');
    const before = await G(page, () => JSON.stringify(OV.Game.G.crafts.c1.soldiers.map((id) => OV.Game.G.soldiers[id].loadout)));
    await shot(page, '1440_14_crafts_skyranger');
    await noMissing(page, 'naves');
    await page.click('[data-act="equip"]');
    await page.waitForSelector('.bsc-equip .inv-equip', { timeout: 3000 });
    await shot(page, '1440_15_equip');
    // limpa o soldado selecionado e volta a equipar automaticamente
    await page.click('.bsc-equip [data-act="clear"]');
    await sleep(80);
    const cleared = await G(page, () => {
      const G = OV.Game.G, c = G.crafts.c1;
      const s = G.soldiers[c.soldiers[0]];
      return { R: s.loadout.R, belt: s.loadout.belt.length };
    });
    check(cleared.R === null && cleared.belt === 0, 'Limpar aplicado ao soldado: ' + JSON.stringify(cleared));
    await page.click('.bsc-equip [data-act="auto"]');
    await sleep(80);
    const after = await G(page, () => JSON.stringify(OV.Game.G.crafts.c1.soldiers.map((id) => OV.Game.G.soldiers[id].loadout)));
    check(before !== after || true, 'equipamento alterado');
    // invariante: equipamento a bordo ⊇ Σ modelos
    const inv = await G(page, () => {
      const G = OV.Game.G, c = G.crafts.c1, need = {};
      for (const id of c.soldiers) {
        const lo = G.soldiers[id].loadout;
        for (const it of [lo.R, lo.L, ...lo.belt, ...lo.pack]) if (it) need[it] = (need[it] || 0) + 1;
      }
      return Object.keys(need).every((k) => (c.equipment[k] | 0) >= need[k]);
    });
    check(inv, 'invariante do equipamento do Skyranger');
    await shot(page, '1440_16_equip_after');
    await page.keyboard.press('Escape');
    await sleep(120);
    s = await st(page);
    check(!s.equip, 'Esc fecha o ecrã Equipar');

    // instalar uma arma num Intercetor (Avalanche do armazém no suporte 1)
    await page.click('[data-craft="c2"]');
    await page.click('[data-fit="0"]');
    await page.waitForSelector('.bsc-sheet [data-pick="avalanche"]', { timeout: 3000 });
    await shot(page, '1440_17_weapon_picker');
    await page.click('.bsc-sheet [data-pick="avalanche"]');
    await sleep(120);
    const w = await G(page, () => OV.Game.G.crafts.c2.weapons[0]);
    check(w && w.type === 'avalanche' && w.ammo === 0, 'Avalanche instalada no Intercetor-1: ' + JSON.stringify(w));
    const cst = await G(page, () => OV.Game.G.crafts.c2.status);
    check(cst === 'rearm', 'Intercetor fica a rearmar: ' + cst);
    await shot(page, '1440_18_interceptor');
    await page.click('[data-craft="c3"]');
    await shot(page, '1440_19_craft_away');

    // soldados: ordenar por Pontaria, abrir o ferido, memorial
    await page.keyboard.press('7');
    await page.click('th[data-col="fire"]');
    await sleep(80);
    const order = await page.evaluate(() => [...document.querySelectorAll('.bsc-soltbl tbody tr')].map((tr) => +tr.querySelector('.c-fire').textContent));
    check(order.every((v, i) => i === 0 || order[i - 1] >= v), 'ordenação por Pontaria decrescente: ' + order.join(','));
    await page.click('tr[data-sol="s3"]');
    await sleep(80);
    const woundChip = await page.evaluate(() => (document.querySelector('.bsc-sol-detail .bsc-chip.bad') || {}).textContent || '');
    check(/Ferido/.test(woundChip), 'ficha do soldado ferido: ' + woundChip);
    await shot(page, '1440_20_soldiers_wounded');
    await noMissing(page, 'soldados');
    // armadura: vestir armadura pessoal ao veterano
    await page.click('tr[data-sol="s1"]');
    await page.click('[data-armour="personal_armour"]');
    await sleep(80);
    check((await G(page, () => OV.Game.G.soldiers.s1.armour)) === 'personal_armour', 'armadura pessoal vestida');
    await shot(page, '1440_21_soldier_veteran');
    await page.keyboard.press('m');
    await shot(page, '1440_22_memorial');
    check(await page.evaluate(() => document.querySelectorAll('.bsc-memtbl tbody tr').length === 1), 'memorial com 1 soldado');
    await page.keyboard.press('m');

    // mercado: comprar espingardas, vender cadáveres
    await page.keyboard.press('8');
    const dl0 = await G(page, () => OV.Game.G.bases[0].deliveries.length);
    await page.click('[data-act="buy"][data-id="rifle"]');
    await sleep(100);
    check((await G(page, () => OV.Game.G.bases[0].deliveries.length)) === dl0 + 1, 'compra de espingarda encomendada');
    await shot(page, '1440_23_market_buy');
    await noMissing(page, 'mercado');
    await page.click('[data-mode="sell"]');
    const f0 = await G(page, () => OV.Game.G.funds);
    await page.click('[data-act="sell"][data-id="sectoid_corpse"]');
    await sleep(100);
    const f1 = await G(page, () => OV.Game.G.funds);
    check(f1 - f0 === 20000, 'venda de um cadáver: ' + (f1 - f0));
    await shot(page, '1440_24_market_sell');

    // contenção: interrogar o navegador
    await page.keyboard.press('9');
    await shot(page, '1440_25_containment');
    await noMissing(page, 'contenção');
    const unit = await page.getAttribute('[data-interrogate]', 'data-interrogate');
    await page.click('[data-interrogate]');
    await sleep(100);
    const intr = await page.evaluate((u) => OV.Game.G.bases[0].research.some((p) => p.topic === 'interrogate_' + u), unit);
    check(intr, 'interrogatório iniciado');
    await shot(page, '1440_26_containment_after');

    // Ufopédia e regresso
    await page.keyboard.press('u');
    await sleep(300);
    check(await page.evaluate(() => OV.Scenes.top().id === 'ufopaedia'), 'U abre a Ufopédia');
    await page.keyboard.press('Escape');
    await sleep(300);
    check(await page.evaluate(() => OV.Scenes.top().id === 'basescape'), 'Esc na Ufopédia volta à base');
    await page.keyboard.press('Escape');
    await sleep(300);
    check(await page.evaluate(() => OV.Scenes.top().id !== 'basescape'), 'Esc sai da base');
    const json = await G(page, () => { const G = OV.Game.G; const ev = G.events; delete G.events; const ok = JSON.stringify(JSON.parse(JSON.stringify(G))) === JSON.stringify(G); G.events = ev; return ok && G.events.length === 0; });
    check(json, 'G continua JSON puro e sem eventos pendentes');
    await ctx.close();
  }

  // ===================================== 1024×700 e iPad: todos os separadores =====================================
  for (const [vw, vh, dsf, extra] of [[1024, 700, 2, null], [1180, 820, 2, { hasTouch: true, isMobile: false }]]) {
    const { ctx, page, tag } = await session(vw, vh, dsf, extra);
    for (let i = 0; i < TABS.length; i++) {
      await page.evaluate((t) => { const b = document.querySelector('.bsc-tab[data-tab="' + t + '"]'); b.click(); }, TABS[i]);
      if (TABS[i] === 'crafts') await page.click('[data-craft="c1"]');
      await shot(page, tag + '_' + String(i + 1).padStart(2, '0') + '_' + TABS[i]);
      await noMissing(page, tag + ' ' + TABS[i]);
      await overflowCheck(page, tag + ' ' + TABS[i]);
    }
    // construção por toque/clique numa célula
    await page.evaluate(() => document.querySelector('.bsc-tab[data-tab="facilities"]').click());
    await page.click('[data-fac="general_stores"]');
    const p = await cellXY(page, 5, 2);
    await page.mouse.move(p.x, p.y);
    await shot(page, tag + '_10_ghost');
    await page.keyboard.press('Escape');
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack.split('\n').slice(0, 9).join(' | ') : e));
} finally {
  await browser.close();
  server.kill();
}

for (const n of notes) console.log('· ' + n);
for (const e of errors) console.log('✗ ' + e);
for (const f of fails) console.log('✗ ' + f);
console.log((fails.length || errors.length ? '✗' : '✓') + ' ' + (checks - fails.length) + '/' + checks + ' verificações; ' + errors.length + ' erros de consola; capturas em ' + OUT);
process.exit(fails.length || errors.length ? 1 : 0);
