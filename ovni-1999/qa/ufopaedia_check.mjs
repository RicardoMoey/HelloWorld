/* Verificação da Ufopédia num Chromium real (Playwright): Arquivo (sem campanha) e Ufopédia de campanha
   (só artigos desbloqueados, distintivo «Novo»), navegação por teclado (← →, Home/End, /, Esc), pesquisa,
   patentes das raças, deslizar com o trackpad, e capturas de ≥ 8 artigos de todas as secções a 1440×900 e 1024×700.
   Falha em erros de consola/página, chaves i18n em falta (⟦…⟧) ou ilustrações vazias.
   Uso: node ovni-1999/qa/ufopaedia_check.mjs [--out <pasta>] [--port <n>] [--all] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'ufopaedia') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'ufopaedia') : path.join(process.cwd(), 'qa-out', 'ufopaedia');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const errors = [];
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

// artigos a fotografar: pelo menos um por secção
const SHOTS = [
  'craft_skyranger', 'craft_avenger', 'item_avalanche', 'item_plasma_beam', 'item_rifle', 'item_heavy_cannon', 'item_power_suit',
  'facility_hangar', 'facility_large_radar', 'race_sectoid', 'race_chryssalid', 'race_cyberdisc', 'cydonia', 'alien_interrogation',
  'item_ufo_power_source', 'ufo_construction', 'ufo_abductor', 'ufo_battleship',
];

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html?nosw=1`;

const browser = await chromium.launch();
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  async function session(vw, vh, dsf) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(vw + 'x' + vh + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Ufopédia/.test(m.text()))) errors.push(vw + 'x' + vh + ' console: ' + m.text()); });
    await page.goto(BASE);
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 15000 });
    return { ctx, page };
  }
  const state = (page) => page.evaluate(() => {
    const r = document.querySelector('.up-root:not(.scr-leaving)');
    if (!r) return null;
    const cv = r.querySelector('.up-canvas');
    let ink = 0;
    if (cv && cv.width) {
      // ilustração não vazia: píxeis com variação na zona central
      const g = cv.getContext('2d');
      const d = g.getImageData(Math.floor(cv.width * 0.3), Math.floor(cv.height * 0.3), Math.floor(cv.width * 0.4), Math.floor(cv.height * 0.4)).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 64) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
      ink = seen.size;
    }
    return {
      title: r.querySelector('.up-title').textContent,
      kicker: r.querySelector('.up-kicker').textContent,
      items: r.querySelectorAll('.up-nav-item').length,
      sel: (r.querySelector('.up-nav-item.sel') || {}).dataset ? r.querySelector('.up-nav-item.sel').dataset.id : null,
      news: r.querySelectorAll('.up-nav-item .up-new').length,
      text: r.innerText,
      ink,
      top: OV.Scenes.top().id,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  const missingKeys = (s) => (s && /⟦/.test(s.text) ? s.text.match(/⟦[^⟧]*⟧/g).slice(0, 5).join(' ') : '');

  // ---------------------------------------------------------------- Arquivo a 1440×900
  {
    const { ctx, page } = await session(1440, 900, 2);
    await page.evaluate(() => OV.Ufopaedia.open(null));
    await page.waitForSelector('.up-root .up-nav-item');
    await sleep(300);
    let s = await state(page);
    const total = await page.evaluate(() => OV.Ufopaedia.articles().length);
    check(s.items === total, 'arquivo: lista com todos os artigos (' + s.items + '/' + total + ')');
    check(s.top === 'ufopaedia', 'arquivo: cena no topo');
    check(!missingKeys(s), 'arquivo: chaves em falta ' + missingKeys(s));
    await page.screenshot({ path: path.join(OUT, '1440-00-arquivo.png') });

    // navegação por teclado
    const first = s.sel;
    await page.keyboard.press('ArrowRight');
    await sleep(120);
    s = await state(page);
    check(s.sel && s.sel !== first, 'seta direita muda de artigo');
    await page.keyboard.press('ArrowLeft');
    await sleep(120);
    s = await state(page);
    check(s.sel === first, 'seta esquerda volta ao artigo anterior');
    await page.keyboard.press('End');
    await sleep(120);
    s = await state(page);
    check(s.sel === 'ufo_battleship', 'End vai ao último artigo (' + s.sel + ')');
    await page.keyboard.press('ArrowRight');
    await sleep(120);
    s = await state(page);
    check(s.sel === first, 'a seguir ao último dá a volta ao primeiro');

    // pesquisa: «/» foca, sem acentos, Enter abre o primeiro
    await page.keyboard.press('/');
    await page.keyboard.type('cri');
    await sleep(150);
    s = await state(page);
    check(s.items >= 1 && s.items <= 3, 'pesquisa «cri» filtra a lista (' + s.items + ')');
    await page.keyboard.press('Enter');
    await sleep(150);
    s = await state(page);
    check(s.sel === 'race_chryssalid', 'Enter abre o primeiro resultado (' + s.sel + ')');
    await page.fill('.up-search', 'xyzzy');
    await sleep(120);
    s = await state(page);
    check(s.items === 0 && /Nenhum artigo/.test(s.text), 'pesquisa sem resultados mostra aviso');
    await page.focus('.up-search');
    await page.keyboard.press('Escape');
    await sleep(120);
    s = await state(page);
    check(s.items === total && s.top === 'ufopaedia', 'Esc na pesquisa limpa-a sem fechar');

    // patentes dos Sectoides
    await page.evaluate(() => { OV.Scenes.pop(); OV.Ufopaedia.open(null, 'race_sectoid'); });
    await page.waitForSelector('.up-root:not(.scr-leaving) .up-chip');
    const chips = await page.locator('.up-root:not(.scr-leaving) .up-chip').count();
    check(chips >= 5, 'Sectoide tem escolha de patente (' + chips + ')');
    await page.locator('.up-root:not(.scr-leaving) .up-chip').last().click();
    await sleep(200);
    s = await state(page);
    check(/Sectoide Comandante/i.test(s.text), 'patente escolhida muda a tabela');
    await page.screenshot({ path: path.join(OUT, '1440-01-sectoide-comandante.png') });

    // deslizar no trackpad (horizontal) → seguinte
    const before = s.sel;
    // rajada de eventos de roda horizontais como os de um trackpad (≈ 60 Hz)
    await page.evaluate(() => {
      const t = document.querySelector('.up-root:not(.scr-leaving) .up-info');
      for (let i = 0; i < 8; i++) t.dispatchEvent(new WheelEvent('wheel', { deltaX: 18, deltaY: 1, bubbles: true }));
    });
    await sleep(250);
    s = await state(page);
    check(s.sel !== before, 'deslizar horizontal no trackpad muda de artigo (' + before + ' → ' + s.sel + ')');

    // capturas de artigos
    let n = 2;
    for (const id of SHOTS) {
      await page.evaluate((a) => { OV.Scenes.pop(); OV.Ufopaedia.open(null, a); }, id);
      await page.waitForFunction((a) => { const r = document.querySelector('.up-root:not(.scr-leaving) .up-nav-item.sel'); return r && r.dataset.id === a; }, id);
      await sleep(350);
      s = await state(page);
      check(s.ink > 12, id + ': ilustração com conteúdo (' + s.ink + ' cores)');
      check(!missingKeys(s), id + ': chaves em falta ' + missingKeys(s));
      check(!s.overflowX, id + ': sem deslocação horizontal');
      await page.screenshot({ path: path.join(OUT, '1440-' + String(n++).padStart(2, '0') + '-' + id + '.png') });
    }
    if (argv.includes('--all')) {
      const ids = await page.evaluate(() => OV.Ufopaedia.articles().map((a) => a.id));
      for (const id of ids) {
        await page.evaluate((a) => { OV.Scenes.pop(); OV.Ufopaedia.open(null, a); }, id);
        await sleep(200);
        s = await state(page);
        check(s.ink > 12 && !missingKeys(s), id + ': artigo completo');
      }
    }
    // Esc fecha e volta ao menu
    await page.keyboard.press('Escape');
    await sleep(300);
    check((await page.evaluate(() => OV.Scenes.top().id)) === 'menu', 'Esc volta ao menu');
    check((await page.locator('.up-root:not(.scr-leaving)').count()) === 0, 'raiz DOM removida ao sair');
    await ctx.close();
  }

  // ---------------------------------------------------------------- campanha a 1440×900
  {
    const { ctx, page } = await session(1440, 900, 2);
    const info = await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ difficulty: 1, seed: 7 });
      G.researched.push('laser_weapons', 'laser_pistol', 'autopsy_sectoid');
      G.ufopaedia.push('laser_weapons', 'laser_pistol', 'autopsy_sectoid', 'ufo_small_scout');
      OV.Game.G = G;
      const open = OV.Ufopaedia.openArticles(G).length;
      OV.Ufopaedia.open(G, 'laser_pistol');
      return { open, total: OV.Ufopaedia.articles().length };
    });
    await page.waitForSelector('.up-root .up-nav-item');
    await sleep(300);
    let s = await state(page);
    check(s.items === info.open && info.open < info.total, 'campanha: só artigos desbloqueados (' + s.items + '/' + info.total + ')');
    check(s.sel === 'item_laser_pistol', 'campanha: abre o artigo do tópico investigado (' + s.sel + ')');
    check(s.news === 3, 'campanha: distintivos «Novo» nos 3 restantes por ler (' + s.news + ')');
    check(/por desclassificar/.test(s.text), 'campanha: contagem de artigos por desclassificar');
    check(!/Cidónia/.test(s.text), 'campanha: artigo bloqueado não aparece');
    await page.screenshot({ path: path.join(OUT, '1440-30-campanha.png') });
    await page.evaluate(() => { OV.Scenes.pop(); OV.Ufopaedia.open(OV.Game.G, 'sectoid'); });
    await sleep(300);
    s = await state(page);
    check(s.sel === 'race_sectoid', 'campanha: id de interrogatório «sectoid» abre a raça');
    const read = await page.evaluate(() => OV.Game.G.ui.ufopaediaRead.slice());
    check(read.includes('item_laser_pistol') && read.includes('race_sectoid'), 'campanha: artigos lidos ficam em G.ui');
    await page.screenshot({ path: path.join(OUT, '1440-31-campanha-sectoide-veterano.png') });
    await ctx.close();
  }

  // ---------------------------------------------------------------- 1024×700
  {
    const { ctx, page } = await session(1024, 700, 2);
    let n = 40;
    for (const id of ['item_rifle', 'race_snakeman', 'craft_interceptor', 'facility_alien_containment', 'ufo_terror_ship', 'item_stingray', 'martian_solution', 'item_alien_alloys']) {
      await page.evaluate((a) => { if (OV.Scenes.top().id === 'ufopaedia') OV.Scenes.pop(); OV.Ufopaedia.open(null, a); }, id);
      await page.waitForFunction((a) => { const r = document.querySelector('.up-root:not(.scr-leaving) .up-nav-item.sel'); return r && r.dataset.id === a; }, id);
      await sleep(350);
      const s = await state(page);
      check(s.ink > 12, '1024 ' + id + ': ilustração com conteúdo');
      check(!s.overflowX, '1024 ' + id + ': sem deslocação horizontal');
      const fit = await page.evaluate(() => {
        const p = document.querySelector('.up-root:not(.scr-leaving) .up-panel').getBoundingClientRect();
        const f = document.querySelector('.up-root:not(.scr-leaving) .up-foot').getBoundingClientRect();
        return p.bottom <= window.innerHeight + 1 && f.bottom <= p.bottom + 1;
      });
      check(fit, '1024 ' + id + ': painel e rodapé cabem no ecrã');
      await page.screenshot({ path: path.join(OUT, '1024-' + n++ + '-' + id + '.png') });
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- iPad (toque)
  {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('ipad pageerror: ' + (e && e.message)));
    await page.goto(BASE);
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 15000 });
    await page.evaluate(() => OV.Ufopaedia.open(null, 'ufo_harvester'));
    await sleep(400);
    const s = await state(page);
    check(!s.overflowX && s.ink > 12, 'iPad: artigo cabe e tem ilustração');
    await page.locator('.up-root .up-next').tap();
    await sleep(250);
    check((await state(page)).sel === 'ufo_abductor', 'iPad: tocar em «Seguinte»');
    await page.screenshot({ path: path.join(OUT, 'ipad-ufo.png') });
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) fails.push(e);
console.log('capturas em ' + OUT);
for (const f of fails) console.log('✗ ' + f);
console.log((fails.length ? '✗' : '✓') + ' ' + (checks - fails.length + errors.length) + '/' + checks + ' verificações' + (errors.length ? ', ' + errors.length + ' erro(s) de consola' : ''));
process.exit(fails.length ? 1 : 0);
