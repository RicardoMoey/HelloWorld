/* Ronda de personas 3 — QA dos ecrãs num Chromium real (Playwright): Batalha Rápida do mês 4 de noite e Local de
   Terror de noite sem ninguém com excesso de peso no «Equipar»; Enter depois de «Aleatória» começa (não sorteia);
   relatório de uma vitória cara com fogo amigo a tiro de reação (quem atingiu quem + dica com título próprio);
   «Como Jogar» › Combate com as formas do caminho (● ○ ✕). Capturas a 1440×900, 1024×576 (125 %) e iPad
   834×1194 / 1194×834 (toque). Falha em erros de consola/página ou ⟦…⟧.
   Uso: node ovni-1999/qa/persona_r3_screens.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r3_screens') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r3_screens') : path.join(process.cwd(), 'qa-out', 'persona_r3_screens');
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
async function openPage(view, tag) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Screens && OV.InventoryUI);
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
// peso > Força no equipamento da missão aberta no briefing
const OVERWEIGHT = () => {
  const sc = OV.Scenes.stack.find((s) => s.id === 'briefing');
  const m = sc && sc.params ? sc.params.mission : null;
  const squad = (m && m.squad) || (window.__qaMission && window.__qaMission.squad) || [];
  const w = (l) => [l.R, l.L].concat(l.belt || [], l.pack || []).filter(Boolean).reduce((a, id) => a + (OV.Data.items[id].weight | 0), 0);
  return squad.filter((s) => w(s.loadout) > s.stats.str).map((s) => s.name + ' ' + w(s.loadout) + '/' + s.stats.str);
};

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Batalha Rápida: «Aleatória» e depois Enter começa; kit dentro da Força (mês 4 de noite, terror de noite)');
  const CASES = [
    { view: 'desk', q: { kind: 'landed', ufo: 'battleship', time: 'night', diff: 2, month: 4, squad: 10 } },
    { view: 'zoom', q: { kind: 'landed', ufo: 'battleship', time: 'night', diff: 2, month: 4, squad: 10 } },
    { view: 'padL', q: { kind: 'terror', time: 'night', diff: 0, month: 0, squad: 8, seed: 91277, seedLocked: true } },
    { view: 'padP', q: { kind: 'terror', time: 'night', diff: 0, month: 0, squad: 8, seed: 91277, seedLocked: true } },
  ];
  for (const { view, q } of CASES) {
    const { ctx, page } = await openPage(view, 'qb-' + view);
    await page.evaluate((qq) => {
      localStorage.setItem('ovni1999.quick', JSON.stringify(qq));
      // a missão que o briefing recebe (para medir o peso em qualquer passo)
      const push = OV.Scenes.push.bind(OV.Scenes);
      OV.Scenes.push = (id, p) => { if (id === 'briefing' && p && p.mission) window.__qaMission = p.mission; return push(id, p); };
      OV.Scenes.set('menu');
      OV.Scenes.push('quickbattle', {});
    }, q);
    await sleep(450);
    const touch = view.startsWith('pad');
    if (!touch) {
      await page.locator('.scr-qb .btn.small.ghost').click();
      await sleep(200);
      const seed = +(await page.locator('.scr-seed').inputValue());
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
      await page.keyboard.press('Enter');
      await sleep(500);
      check((await topId(page)) === 'briefing', view + ': Enter com o foco em «' + focused + '» começa (' + (await topId(page)) + ')');
      const used = await page.evaluate(() => window.__qaMission && window.__qaMission.seed);
      check(used === seed, view + ': a semente da batalha é a que estava à vista (' + used + ' / ' + seed + ')');
    } else {
      await page.locator('.scr-qb .btn.primary.scr-big').tap();
      await sleep(500);
      check((await topId(page)) === 'briefing', view + ': «Começar» por toque abre o briefing');
    }
    check((await page.evaluate(OVERWEIGHT)).length === 0, view + ': ninguém com excesso de peso: ' + (await page.evaluate(OVERWEIGHT)).join(', '));
    await shot(page, 'qb-' + view + '-brief');
    // passo «Equipar»
    if (touch) await page.locator('.scr-brief .btn[aria-keyshortcuts="E"]').tap();
    else await page.keyboard.press('e');
    await sleep(700);
    check((await topId(page)) === 'qequip', view + ': Equipar aberto');
    const n = await page.evaluate(() => (window.__qaMission.squad || []).length);
    const over = [];
    for (let k = 0; k < n; k++) {
      // cada soldado: o painel do peso não diz «Excesso de peso»
      const t = await page.evaluate((i) => {
        const tabs = [...document.querySelectorAll('.inv-equip [data-sid], .inv-equip .inv-sq, .inv-equip .eq-sq')];
        if (tabs[i]) tabs[i].click();
        return document.querySelector('.inv-equip') ? document.querySelector('.inv-equip').innerText : '';
      }, k);
      if (/Excesso de peso/.test(t)) over.push(k);
      if (k === 0) await shot(page, 'qb-' + view + '-equip');
    }
    check(over.length === 0, view + ': «Excesso de peso» no Equipar para os soldados ' + over.join(','));
    await noMissing(page, 'qequip ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('2. Relatório: vitória cara com fogo amigo a tiro de reação');
  for (const view of ['desk', 'zoom', 'padP', 'padL']) {
    const { ctx, page } = await openPage(view, 'deb-' + view);
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month: 0, seed: 77, squad: 6, time: 'day', diff: 0 });
      const B = OV.Battle.create(mission);
      const xs = B.units.filter((u) => u.side === 'xcom' && u.type === 'soldier');
      for (const u of B.units) if (u.side === 'alien') u.status = 'dead';
      // 3 de 6 mortos: um a tiro de reação de um colega, dois pelos alienígenas
      const alien = B.units.find((u) => u.origSide === 'alien');
      // o atirador leva uma espingarda (não o lança-foguetes: esse conta como explosão)
      const gun = (u) => { const it = B.items.find((x) => x.id === u.items.R); return it && it.type; };
      const shooter = xs.find((u) => gun(u) === 'rifle');
      const vict = xs.filter((u) => u !== shooter);
      Object.assign(vict[0], { status: 'dead', killedBy: shooter.id, deathCause: 'shot', deathSide: 'alien' });
      Object.assign(vict[1], { status: 'dead', killedBy: alien.id, deathCause: 'shot' });
      Object.assign(vict[2], { status: 'dead', killedBy: alien.id, deathCause: 'shot' });
      window.__ff = [vict[0].name, shooter.name];
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(500);
    const r = await page.evaluate(() => ({
      result: document.querySelector('.scr-result').textContent,
      cause: (document.querySelector('.scr-deb-cause .scr-cause') || {}).textContent || '',
      tip: (document.querySelector('.scr-deb-cause .scr-tip.costly') || {}).textContent || '',
      ff: window.__ff,
    }));
    check(/VITÓRIA/i.test(r.result), view + ': é uma vitória (' + r.result + ')');
    check(r.cause.indexOf(r.ff[0] + ' ← tiro de reação de ' + r.ff[1]) >= 0, view + ': nomeia quem atingiu quem: ' + r.cause);
    check(!/explosivos/.test(r.cause), view + ': sem «explosivos» quando foi a tiro');
    check(/^Vitória cara/.test(r.tip), view + ': dica com título de vitória cara: ' + r.tip);
    await noMissing(page, 'debrief ' + view);
    await shot(page, 'deb-' + view + '-costly');
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Como Jogar › Combate: o caminho explica-se pelas formas');
  for (const view of ['desk', 'zoom', 'padP', 'padL']) {
    const { ctx, page } = await openPage(view, 'howto-' + view);
    await page.evaluate(() => OV.Scenes.push('howto', { tab: 'battle' }));
    await sleep(500);
    const t = await page.locator('.scr-howto-body .scr-card').first().innerText();
    check(/● ponto cheio/.test(t) && /○ ponto oco/.test(t) && /✕ cruz/.test(t), view + ': formas descritas: ' + t.slice(0, 80));
    const vis = await page.evaluate(() => {
      const c = document.querySelector('.scr-howto-body .scr-card').getBoundingClientRect();
      return c.width > 200 && c.top < innerHeight && c.right <= innerWidth + 0.5;
    });
    check(vis, view + ': cartão das UT à vista');
    await noMissing(page, 'howto ' + view);
    await shot(page, 'howto-' + view + '-battle');
    // paleta para daltonismo: as mesmas formas
    if (view === 'desk') {
      await page.evaluate(() => { document.documentElement.dataset.palette = 'cvd'; });
      await shot(page, 'howto-desk-battle-cvd');
      await page.evaluate(() => { document.documentElement.dataset.palette = 'normal'; });
    }
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
