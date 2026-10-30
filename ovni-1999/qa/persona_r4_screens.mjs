/* Ronda de personas 4 — QA dos ecrãs num Chromium real (Playwright):
   1. Batalha Rápida: escolher Cidónia sobe o «Mês» para 4 (nota «recomendado»); baixá-lo mostra o aviso ⚠ no resumo;
   2. briefing da Batalha Rápida (OVNI aterrado) e da campanha a 1024×576: ↓/PageDown/Fim deslocam o corpo com o foco
      em «Iniciar missão»; o rodapé anuncia as setas; o objetivo do OVNI aterrado fala de material, não de pontos;
   3. relatório: vitória de terror com 4 civis mortos pela X-COM (causa e dica) e fogo amigo por foguete de um
      atirador que morreu depois («explosão de …»);
   4. Opções no iPad sem «Deslocar nas margens» nem «Roda do rato» e com «2.º toque»; toque longo sem a tecla.
   Capturas a 1440×900, 1024×576 (125 %) e iPad 834×1194 / 1194×834 (toque). Falha em erros de consola/página ou ⟦…⟧.
   Uso: node ovni-1999/qa/persona_r4_screens.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'persona_r4_screens') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'persona_r4_screens') : path.join(process.cwd(), 'qa-out', 'persona_r4_screens');
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
const isPad = (v) => v.startsWith('pad');
async function openPage(view, tag) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Screens && OV.CampaignUI);
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
const press = async (page, view, loc) => { if (isPad(view)) await loc.tap(); else await loc.click(); };
const bodyScroll = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('.scr-brief-body')].pop();
  return b ? { top: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight } : null;
});

try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  // =============================================================================================================
  log('1. Batalha Rápida: Cidónia sobe o «Mês» para 4; baixá-lo avisa no resumo');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'qb-' + view);
    await page.evaluate(() => {
      localStorage.setItem('ovni1999.quick', JSON.stringify({ kind: 'crash', ufo: 'small_scout', month: 0, time: 'day', diff: 0, squad: 8 }));
      OV.Scenes.set('menu');
      OV.Scenes.push('quickbattle', {});
    });
    await sleep(450);
    await press(page, view, page.locator('.scr-qb .scr-seg-b[data-v="cydonia"]'));
    await sleep(250);
    const st = await page.evaluate(() => ({
      month: (document.querySelector('.scr-seg.months .scr-seg-b.on') || {}).textContent,
      note: [...document.querySelectorAll('.scr-fnote')].map((n) => n.textContent).join(' | '),
      warn: !!document.querySelector('.scr-qb-warn:not(.hidden)'),
    }));
    check(st.month === '4', view + ': Cidónia → Mês 4 (' + st.month + ')');
    check(/recomendado para Cidónia/.test(st.note), view + ': nota «recomendado»: ' + st.note);
    check(!st.warn, view + ': Mês 4 sem aviso');
    check(!(await page.evaluate(() => /\bnull\b/.test(document.querySelector('.scr-summary').textContent))), view + ': resumo sem «null»');
    await shot(page, 'qb-' + view + '-cydonia');
    await press(page, view, page.locator('.scr-seg.months .scr-seg-b[data-v="0"]'));
    await sleep(250);
    const w = await page.evaluate(() => {
      const n = document.querySelector('.scr-qb-warn:not(.hidden)');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      // à vista na janela e dentro da área do formulário (não escondido pela deslocação)
      const body = document.querySelector('.scr-qb-body').getBoundingClientRect();
      return { text: n.textContent, vis: r.width > 100 && r.height > 10 && r.top >= body.top - 1 && r.bottom <= body.bottom + 1, colour: getComputedStyle(n).color };
    });
    check(w && /Espingardas/.test(w.text) && /Mês 4/.test(w.text), view + ': aviso com espingardas: ' + (w && w.text));
    check(w && w.vis, view + ': aviso à vista');
    // Base Alienígena: Mês 2
    await press(page, view, page.locator('.scr-qb .scr-seg-b[data-v="alienBase"]'));
    await sleep(250);
    check((await page.evaluate(() => (document.querySelector('.scr-seg.months .scr-seg-b.on') || {}).textContent)) === '2', view + ': Base Alienígena → Mês 2');
    await press(page, view, page.locator('.scr-seg.months .scr-seg-b[data-v="0"]'));
    await press(page, view, page.locator('.scr-qb .scr-seg-b[data-v="cydonia"]'));
    await sleep(250);
    await press(page, view, page.locator('.scr-seg.months .scr-seg-b[data-v="0"]'));
    await sleep(250);
    if (view === 'desk') {
      await page.evaluate(() => { document.documentElement.dataset.palette = 'cvd'; });
      await shot(page, 'qb-desk-warn-cvd');
      await page.evaluate(() => { document.documentElement.dataset.palette = 'normal'; });
    }
    await shot(page, 'qb-' + view + '-warn');
    await noMissing(page, 'qb ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('2a. Briefing da Batalha Rápida (OVNI aterrado): setas deslocam com o foco em «Iniciar missão»');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'brief-' + view);
    await page.evaluate(() => {
      localStorage.setItem('ovni1999.quick', JSON.stringify({ kind: 'landed', ufo: 'large_scout', month: 1, time: 'day', diff: 1, squad: 10 }));
      OV.Scenes.set('menu');
      OV.Scenes.push('quickbattle', {});
    });
    await sleep(400);
    await press(page, view, page.locator('.scr-qb .btn.primary.scr-big'));
    await page.waitForSelector('.scr-brief .scr-soldier');
    await sleep(400);
    const obj = await page.locator('.scr-obj li').nth(1).innerText();
    check(!/pontos/.test(obj) && /material/.test(obj), view + ': objetivo do OVNI aterrado: ' + obj);
    if (!isPad(view)) {
      const foc = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
      check(/Iniciar/i.test(foc || ''), view + ': o foco começa em «Iniciar missão» (' + foc + ')');
      const s0 = await bodyScroll(page);
      if (s0 && s0.max > 4) {
        await page.keyboard.press('ArrowDown');
        await sleep(350);
        const s1 = await bodyScroll(page);
        check(s1.top > 0, view + ': ↓ desloca o briefing (' + s1.top + '/' + s1.max + ')');
        await page.keyboard.press('End');
        await sleep(350);
        const s2 = await bodyScroll(page);
        check(Math.abs(s2.top - s2.max) <= 2, view + ': Fim chega ao fundo (' + s2.top + '/' + s2.max + ')');
        await shot(page, 'brief-' + view + '-end');
        await page.keyboard.press('Home');
        await sleep(350);
        check((await bodyScroll(page)).top === 0, view + ': Início volta ao topo');
        await page.keyboard.press('PageDown');
        await sleep(350);
        check((await bodyScroll(page)).top > 0, view + ': PageDown desloca');
        check((await topId(page)) === 'briefing', view + ': as setas não saem do briefing');
      } else check(view === 'desk', view + ': o corpo do briefing devia deslocar a este tamanho (' + JSON.stringify(s0) + ')');
      const hint = await page.locator('.scr-brief .scr-foot .scr-hint').innerText();
      check(/↑ ↓ deslocam/.test(hint), view + ': rodapé com as setas: ' + hint);
    }
    await shot(page, 'brief-' + view);
    await noMissing(page, 'briefing ' + view);
    await ctx.close();
  }

  log('2b. Briefing da campanha: as mesmas teclas sem mexer em campaign_ui');
  for (const view of ['zoom', 'desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'cbrief-' + view);
    await page.evaluate(() => {
      const G = OV.Campaign.newCampaign({ seed: 7, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
      OV.Game.G = G;
      OV.Scenes.set('geoscape', { G });
      const m = OV.Missions.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 99999 });
      const u = OV.Missions.spawnUfo(G, m.id);
      u.lon = -7.9; u.lat = 39.5; u.detected = true;
      OV.Missions.onUfoDown(G, u.id, 'crashed', null);
      const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
      OV.World.launch(G, sky.id, { kind: 'ufo', id: u.id });
      let n = 0;
      while (sky.status !== 'patrol' && n++ < 80) { OV.World.step(G, 720); G.events.splice(0); }
      OV.CampaignUI.launchMission(G, { kind: 'ufo', id: u.id }, sky.id);
    });
    await page.waitForSelector('.cp-brief .scr-soldier');
    await sleep(500);
    check((await topId(page)) === 'cbriefing', view + ': briefing da campanha aberto');
    if (!isPad(view)) {
      const s0 = await bodyScroll(page);
      if (s0 && s0.max > 4) {
        await page.keyboard.press('ArrowDown');
        await sleep(350);
        check((await bodyScroll(page)).top > 0, view + ': ↓ desloca o briefing da campanha');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('End');
        await sleep(350);
        const s2 = await bodyScroll(page);
        check(Math.abs(s2.top - s2.max) <= 2, view + ': Fim chega ao fundo (' + s2.top + '/' + s2.max + ')');
        check((await topId(page)) === 'cbriefing', view + ': continua no briefing');
      } else check(view === 'desk', view + ': o briefing da campanha devia deslocar (' + JSON.stringify(s0) + ')');
    }
    await shot(page, 'cbrief-' + view);
    await noMissing(page, 'cbriefing ' + view);
    await ctx.close();
  }

  // =============================================================================================================
  log('3. Relatório: civis mortos pela X-COM numa vitória; foguete de um atirador que morreu depois');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'deb-' + view);
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'terror', month: 4, seed: 38, squad: 8, time: 'night', diff: 0 });
      const B = OV.Battle.create(mission);
      const xs = B.units.filter((u) => u.side === 'xcom' && u.type === 'soldier');
      for (const u of B.units) if (u.side === 'alien') { u.status = 'dead'; u.killedBy = xs[0].id; }
      const civs = B.units.filter((u) => u.origSide === 'civ').slice(0, 4);
      for (const c of civs) Object.assign(c, { status: 'dead', killedBy: xs[1].id, deathCause: 'explosion' });
      B.stats.civKilledByXcom = civs.length;
      window.__civ = civs.length;
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(500);
    const r = await page.evaluate(() => ({
      result: document.querySelector('.scr-result').textContent,
      cause: [...document.querySelectorAll('.scr-deb-cause .scr-cause')].map((n) => n.textContent).join(' | '),
      tip: (document.querySelector('.scr-deb-cause .scr-tip') || {}).textContent || '',
      line: [...document.querySelectorAll('.scr-score tr')].map((n) => n.textContent).find((t) => /Civis mortos pela X-COM/.test(t)) || '',
      n: window.__civ,
    }));
    check(/VITÓRIA/i.test(r.result), view + ': vitória (' + r.result + ')');
    check(r.cause.indexOf(r.n + ' civis mortos pelas armas da X-COM (−200 pontos)') >= 0, view + ': causa dos civis: ' + r.cause);
    check(/−200/.test(r.line), view + ': a mesma conta da linha de pontos: ' + r.line);
    check(/^Dica:/.test(r.tip) && /50 pontos/.test(r.tip), view + ': dica dos civis: ' + r.tip);
    await noMissing(page, 'debrief civis ' + view);
    await shot(page, 'deb-' + view + '-civ');

    // fogo amigo: foguete de quem morreu depois (mãos vazias no fim)
    await page.evaluate(() => {
      OV.Scenes.set('menu');
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'cydonia', month: 0, seed: 9, squad: 8, diff: 0 });
      const B = OV.Battle.create(mission);
      const gun = (u) => { const it = B.items.find((x) => x.id === u.items.R); return it && it.type; };
      const xs = B.units.filter((u) => u.side === 'xcom' && u.type === 'soldier');
      const rocket = xs.find((u) => gun(u) === 'rocket_launcher');
      const vict = xs.find((u) => u !== rocket);
      const alien = B.units.find((u) => u.origSide === 'alien');
      OV.Combat.killUnit(B, vict, rocket.id, 'shot');
      OV.Combat.killUnit(B, rocket, alien.id, 'shot');
      window.__ff = [vict.name, rocket.name, rocket.items.R];
      OV.Scenes.push('debrief', { B, mission, meta, quick: meta.quick });
    });
    await page.waitForSelector('.scr-debrief .scr-result');
    await sleep(400);
    const f = await page.evaluate(() => ({ cause: (document.querySelector('.scr-deb-cause .scr-cause') || {}).textContent || '', ff: window.__ff }));
    check(f.ff[2] === null || f.ff[2] === undefined, view + ': o atirador morto largou a arma (' + f.ff[2] + ')');
    check(f.cause.indexOf(f.ff[0] + ' ← explosão de ' + f.ff[1]) >= 0, view + ': foguete = explosão: ' + f.cause);
    await noMissing(page, 'debrief ff ' + view);
    if (view === 'desk' || view === 'padP') await shot(page, 'deb-' + view + '-ff');
    await ctx.close();
  }

  // =============================================================================================================
  log('4. Opções: sem rato no iPad; toque longo sem a tecla');
  for (const view of ALL) {
    const { ctx, page } = await openPage(view, 'opt-' + view);
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('options', {}); });
    await page.waitForSelector('.scr-opts');
    await sleep(400);
    const o = await page.evaluate(() => {
      const t = document.querySelector('.scr-opts').innerText;
      return { edge: /Deslocar nas margens/.test(t), wheel: /Roda do rato/.test(t), tap: /2\.º toque/.test(t), click: /2\.º clique/.test(t) };
    });
    if (isPad(view)) {
      check(!o.edge && !o.wheel, view + ': sem opções do rato (' + JSON.stringify(o) + ')');
      check(o.tap && !o.click, view + ': «2.º toque» na dica dos explosivos');
    } else {
      check(o.edge && o.wheel && o.click, view + ': com rato as opções ficam (' + JSON.stringify(o) + ')');
    }
    await shot(page, 'opt-' + view);
    await noMissing(page, 'opções ' + view);
    if (isPad(view)) {
      // toque longo em «Fechar» (dica «Fechar Esc»): a etiqueta aparece sem a tecla
      const box = await page.locator('.scr-opts .scr-foot .btn.primary').boundingBox();
      const cdp = await ctx.newCDPSession(page);
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await sleep(700);
      const lp = await page.evaluate(() => {
        const b = document.querySelector('.lp-tip');
        const k = b && b.querySelector('.key');
        return b ? { text: b.innerText, key: k ? getComputedStyle(k).display : 'none' } : null;
      });
      await shot(page, 'opt-' + view + '-longpress');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(200);
      check(lp && /Fechar/.test(lp.text), view + ': etiqueta do toque longo (' + JSON.stringify(lp) + ')');
      check(lp && lp.key === 'none' && !/Esc/.test(lp.text), view + ': sem a tecla «Esc» no iPad');
      check((await topId(page)) === 'options', view + ': o toque longo não fechou as opções');
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
