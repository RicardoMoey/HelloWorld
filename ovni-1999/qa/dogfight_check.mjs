/* Verificação da janela de interceção (js/ui/dogfight_ui.js) num Chromium real (Playwright).
   Cria uma campanha com OV.Campaign.newCampaign, põe um OVNI a voar perto da base e envia um intercetor com
   OV.World.launch até ao contacto (o segundo combate simultâneo usa OV.Dogfight.create). A janela abre por cima do
   menu (a cena do Geoscape é detetada se existir). Joga cada postura, liga/desliga armas, minimiza, troca de
   combate e tira capturas: aproximação, disparo, impacto, queda, fuga, nave atingida/destruída, minimizado — a
   1440×900, 1024×700 e iPad (toque). Falha com erros de consola/página, chaves i18n em falta (⟦…⟧) ou estado errado.
   Uso: node ovni-1999/qa/dogfight_check.mjs [--out <pasta>] [--port <n>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'dogfight') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'dogfight') : path.join(process.cwd(), 'qa-out', 'dogfight');
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

// corre na página: campanha nova, OVNI(s) a voar perto da base, intercetor(es) até ao contacto
function pageSetup(o) {
  const OV = window.OV;
  if (OV.DogfightUI.isOpen()) OV.DogfightUI.close();
  const G = OV.Campaign.newCampaign({ seed: o.seed || 7, difficulty: o.difficulty === undefined ? 1 : o.difficulty });
  G.events.length = 0;
  const b = G.bases[0];
  const crafts = o.crafts || ['c2'];
  const ufos = crafts.map((cid, i) => {
    const u = {
      id: OV.Campaign.nextId(G, 'u'), type: (o.ufos && o.ufos[i]) || o.ufo || 'small_scout', missionId: null, race: 'sectoid', region: b.region,
      traj: 'P0', wp: 1, lon: b.lon + 4 + i * 2, lat: b.lat + 2 - i * 3, dest: { lon: b.lon + 60, lat: b.lat + 5 }, alt: o.alt || 2,
      speed: o.speed || 700, status: 'flying', dmg: 0, detected: true, hyper: !!o.hyper, groundLeftS: 0, crashLeftS: 0, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  });
  if (o.weapons) G.crafts.c2.weapons = o.weapons;
  OV.World.launch(G, crafts[0], { kind: 'ufo', id: ufos[0].id });
  let n = 0;
  while (!G.dogfights.length && n++ < 5000) OV.World.step(G, 1);
  for (let i = 1; i < crafts.length; i++) {
    G.crafts[crafts[i]].status = 'out';
    OV.Dogfight.create(G, crafts[i], ufos[i].id);
  }
  G.events.length = 0; // dogfightStart já tratado (o Geoscape chamaria DogfightUI.open)
  if (o.escapeT) for (const d of G.dogfights) d.escapeT = o.escapeT;
  window.__G = G;
  window.__evs = [];
  window.__sums = [];
  window.__closed = null;
  OV.Game.G = G;
  const opts = {
    onEvents: (evs) => window.__evs.push(...evs.map((e) => e.t)),
    onEnd: (s) => window.__sums.push(s),
    onClose: (all) => { window.__closed = all.length; },
  };
  const ok = o.all ? OV.DogfightUI.open(G, null, opts) : OV.DogfightUI.open(G, G.dogfights[0].id, opts);
  return { ok, n, dogfights: G.dogfights.map((d) => d.id), geo: !!OV.SceneDefs.geoscape };
}

const port = +arg('--port', 0) || (await freePort());
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/ovni-1999/index.html`;

const browser = await chromium.launch();
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');

  async function session(name, viewport, extra) {
    const ctx = await browser.newContext(Object.assign({ viewport, deviceScaleFactor: 2 }, extra || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console.error: ' + m.text()); });
    await page.goto(BASE + '?nosw=1');
    await page.waitForSelector('.scr-menu .scr-mi', { timeout: 15000 });
    await sleep(500);
    return { ctx, page };
  }
  const helpers = (page, prefix) => ({
    shot: async (n) => { await page.screenshot({ path: path.join(OUT, prefix + n + '.png') }); },
    setup: (o) => page.evaluate(pageSetup, o),
    st: () => page.evaluate(() => {
      const G = window.__G, OV = window.OV;
      const d = G.dogfights[0] || null;
      const a = OV.DogfightUI.active();
      return {
        top: (OV.Scenes.top() || {}).id, active: a, d: d ? { id: d.id, mode: d.mode, dist: d.dist, proj: d.projectiles.length, weapons: d.weapons.map((w) => w.enabled) } : null,
        dfs: G.dogfights.length, ufoDmg: G.ufos.map((u) => u.dmg), craftHp: G.crafts.c2 ? G.crafts.c2.hp : null,
        banner: !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'),
        bannerTxt: (document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden) .df-btitle') || {}).textContent || '',
        status: (document.querySelector('.df-panel:not(.hidden) .df-st-main') || {}).textContent || '',
        evs: window.__evs.slice(), sums: window.__sums.map((s) => s.outcome), closed: window.__closed,
      };
    }),
    until: async (fn, ms, what) => {
      const end = Date.now() + (ms || 15000);
      while (Date.now() < end) {
        if (await page.evaluate(fn)) return true;
        await sleep(25);
      }
      fails.push('tempo esgotado: ' + what);
      return false;
    },
    // congela o combate (pausa silenciosa) no fotograma em que a condição se cumpre
    freezeWhen: (src, ms) => page.evaluate(([code, lim]) => new Promise((res) => {
      const f = new Function('return (' + code + ')()');
      const end = performance.now() + lim;
      const loop = () => {
        if (f()) { window.OV.DogfightUI.setPaused(true, true); res(true); } else if (performance.now() > end) res(false); else requestAnimationFrame(loop);
      };
      loop();
    }), [src, ms || 15000]),
    thaw: () => page.evaluate(() => window.OV.DogfightUI.setPaused(false, true)),
    noMissing: async (where) => {
      const txt = await page.evaluate(() => document.body.innerText);
      const m = txt.match(/⟦[^⟧]*⟧/g);
      check(!m, where + ': chaves i18n em falta ' + (m ? m.join(', ') : ''));
    },
  });

  // ================================================================== 1440×900: abate de um Batedor Pequeno
  {
    const { ctx, page } = await session('1440', { width: 1440, height: 900 });
    const H = helpers(page, '1440-');
    const r = await H.setup({ ufo: 'medium_scout', alt: 2 });
    check(r.ok && r.dogfights.length === 1, 'contacto via World.launch cria um dogfight e a janela abre');
    await sleep(300);
    let s = await H.st();
    check(s.top === 'dogfight', 'cena dogfight no topo');
    // a interface abre a atacar (Normal, ou a última postura do jogador), nunca em «Distância» (vaga 4)
    check(s.d && s.d.mode === 'standard', 'postura inicial Normal (' + (s.d && s.d.mode) + ')');
    check(await page.locator('.df-panel:not(.hidden) .df-mode.on').getAttribute('data-mode') === 'standard', 'botão Normal realçado');
    check(await page.locator('.df-panel:not(.hidden) .df-hint').count() === 1, 'dica das posturas no primeiro combate');
    const lbl = await page.locator('.df-mode[data-mode="standard"]').getAttribute('aria-label');
    check(/\(3\)/.test(lbl || ''), 'botão Normal anuncia o atalho 3');
    await H.noMissing('aberto');
    await page.keyboard.press('3');
    await sleep(700);
    s = await H.st();
    check(s.d && s.d.mode === 'standard', 'tecla 3 → Normal');
    check(s.d && s.d.dist < 640, 'a nave aproxima-se');
    await H.shot('01-approach');
    check(await H.freezeWhen("() => { const d = window.__G.dogfights[0]; return !!d && d.projectiles.some((p) => p.pos > d.dist * 0.45); }"), 'primeiro míssil');
    await H.shot('02-firing');
    await H.thaw();
    check(await H.freezeWhen("() => window.__G.ufos.some((u) => u.dmg > 0) || !window.__G.dogfights.length"), 'primeiro impacto');
    await H.shot('03-hit');
    await H.thaw();
    // as capturas a 2× são lentas: congela o combate enquanto se fotografa o resultado
    await H.until(() => !window.__G.dogfights.length, 15000, 'fim do combate');
    await H.until(() => !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'), 4000, 'banner');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(true));
    s = await H.st();
    check(/OVNI/.test(s.bannerTxt), 'banner de resultado: ' + s.bannerTxt);
    await H.noMissing('resultado');
    await H.shot('04-crash');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(false));
    await H.until(() => (window.OV.Scenes.top() || {}).id !== 'dogfight', 6000, 'fecho automático');
    s = await H.st();
    check(s.dfs === 0, 'G.dogfights vazio depois de fechar');
    check(s.evs.includes('dogfightEnd'), 'eventos de campanha entregues por onEvents: ' + s.evs.join(','));
    check(s.sums.length === 1 && s.closed === 1, 'onEnd e onClose chamados');
    check(s.top === 'menu', 'volta à cena de baixo (menu)');
    const canSave = await page.evaluate(() => { try { window.OV.Save.toJSON(window.__G); return true; } catch (e) { return String(e.message || e); } });
    check(canSave === true, 'gravação permitida depois do combate: ' + canSave);

    // ---- posturas, armas, pausa e desengate
    await H.setup({ ufo: 'medium_scout', alt: 3 });
    await sleep(250);
    for (const [k, m] of [['2', 'cautious'], ['4', 'aggressive'], ['1', 'standoff'], ['3', 'standard']]) {
      await page.keyboard.press(k);
      await sleep(80);
      s = await H.st();
      check(s.d && s.d.mode === m, 'tecla ' + k + ' → ' + m + ' (obtido ' + (s.d && s.d.mode) + ')');
    }
    await page.keyboard.press('q');
    await sleep(80);
    s = await H.st();
    check(s.d && s.d.weapons[0] === false, 'Q desliga a arma 1');
    await page.locator('.df-wpn.s1 .df-tgl').click();
    await sleep(80);
    s = await H.st();
    check(s.d && s.d.weapons[1] === false, 'clique desliga a arma 2');
    await page.keyboard.press('q');
    await page.keyboard.press('e');
    await sleep(80);
    s = await H.st();
    check(s.d && s.d.weapons[0] && s.d.weapons[1], 'Q/E voltam a ligar');
    await page.keyboard.press('Space');
    await sleep(120);
    const d0 = (await H.st()).d.dist;
    await sleep(400);
    s = await H.st();
    check(s.d.dist === d0, 'pausa congela a simulação');
    await H.shot('05-paused');
    await page.keyboard.press('p');
    await sleep(300);
    await page.locator('.df-mode[data-mode="cautious"]').hover();
    await sleep(250);
    check(await page.locator('#tooltip:not(.hidden)').count() === 1, 'tooltip num botão de postura');
    await H.shot('05b-tooltip');
    await page.mouse.move(5, 5);
    // congela no primeiro dano (com aproximação 4 o Batedor Médio cai depressa: sem isto o desengate chega tarde)
    check(await H.freezeWhen("() => window.__G.ufos.some((u) => u.dmg > 0) || window.__G.crafts.c2.hp < 100 || !window.__G.dogfights.length"), 'troca de tiros com o Batedor Médio');
    await H.shot('06-exchange');
    await page.keyboard.press('5');
    await sleep(80);
    await H.thaw();
    await H.until(() => !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'), 15000, 'resultado do desengate');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(true));
    await sleep(300);
    await H.shot('07-disengaged');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(false));
    await page.keyboard.press('Enter');
    await sleep(300);
    s = await H.st();
    check(s.top === 'menu' && s.sums.length === 1, 'Enter fecha o resultado (' + s.top + ' ' + s.sums.join(',') + ')');

    // ---- fuga: um Abdutor mais rápido do que o intercetor
    await H.setup({ ufo: 'abductor', speed: 1500, alt: 4, escapeT: 70, hyper: true });
    await page.keyboard.press('2');
    await H.until(() => document.querySelector('.df-panel:not(.hidden) .df-st-main') && /fugir/.test(document.querySelector('.df-panel:not(.hidden) .df-st-main').textContent), 9000, 'estado «OVNI a fugir»');
    await sleep(250);
    await page.evaluate(() => window.OV.DogfightUI.setPaused(true, true));
    await H.shot('08-fleeing');
    await H.thaw();
    check(await page.locator('.df-panel:not(.hidden) .df-mode:not(:disabled)').count() === 0, 'posturas bloqueadas com o OVNI a fugir');
    await H.until(() => !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'), 15000, 'resultado da fuga');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(true));
    await sleep(300);
    s = await H.st();
    check(s.sums.length === 0 && /escapou|danificada/i.test(s.bannerTxt), 'banner «OVNI escapou»: ' + s.bannerTxt);
    await H.shot('09-escaped');
    await page.evaluate(() => window.OV.DogfightUI.setPaused(false));
    await H.until(() => (window.OV.Scenes.top() || {}).id !== 'dogfight', 6000, 'fecho após fuga');
    s = await H.st();
    check(s.evs.includes('ufoEscaped'), 'evento ufoEscaped entregue');

    // ---- nave destruída: Nave de Guerra, postura Agressivo
    await H.setup({ ufo: 'battleship', speed: 1500, alt: 3, difficulty: 2 });
    await page.keyboard.press('4');
    check(await H.freezeWhen("() => !!document.querySelector('.df-panel.hit')", 12000), 'nave atingida');
    await H.shot('10-hull-hit');
    await H.thaw();
    await H.until(() => !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'), 20000, 'resultado contra a Nave de Guerra');
    await sleep(300);
    s = await H.st();
    await H.shot('11-craft-destroyed');
    check(/destruída|danificada|escapou|interrompida|munições/i.test(s.bannerTxt), 'banner contra a Nave de Guerra: ' + s.bannerTxt);
    await H.until(() => (window.OV.Scenes.top() || {}).id !== 'dogfight', 6000, 'fecho após a Nave de Guerra');

    // ---- dois combates: painel + ficha; minimizar; trocar
    await H.setup({ crafts: ['c2', 'c3'], ufos: ['small_scout', 'medium_scout'], all: true });
    await sleep(300);
    s = await H.st();
    check(s.active.length === 2 && s.active.filter((a) => a.minimised).length === 1, 'dois combates: um aberto, um em ficha');
    await H.shot('12-two');
    await page.keyboard.press('Tab');
    await sleep(200);
    s = await H.st();
    check(s.active[1] && !s.active[1].minimised && s.active[0].minimised, 'Tab troca o combate aberto');
    await page.keyboard.press('m');
    await sleep(250);
    s = await H.st();
    check(s.active.every((a) => a.minimised), 'M minimiza: só fichas');
    await H.shot('13-minimised');
    await page.locator('.df-chip').first().click();
    await sleep(200);
    s = await H.st();
    check(s.active.some((a) => !a.minimised), 'clique na ficha volta a abrir');
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.press('3');
    s = await H.st();
    check(s.active.every((a) => a.minimised), 'Esc minimiza');
    await page.evaluate(() => window.OV.DogfightUI.close());
    await sleep(200);
    s = await H.st();
    check(s.top === 'menu' && s.dfs === 0 && s.closed === 2, 'close() termina os dois combates e sai da cena: ' + JSON.stringify({ top: s.top, dfs: s.dfs, closed: s.closed, sums: s.sums }));
    await ctx.close();
  }

  // ================================================================== 1024×700
  {
    const { ctx, page } = await session('1024', { width: 1024, height: 700 });
    const H = helpers(page, '1024-');
    await H.setup({ ufo: 'large_scout', alt: 1 });
    await page.keyboard.press('4');
    await sleep(900);
    const box = await page.locator('.df-panel:not(.hidden)').boundingBox();
    check(box && box.y >= 0 && box.y + box.height <= 700 && box.width <= 1024, 'painel cabe em 1024×700: ' + JSON.stringify(box));
    await H.shot('01-approach');
    await H.until(() => !!document.querySelector('.df-panel:not(.hidden) .df-banner:not(.hidden)'), 20000, 'resultado 1024');
    await sleep(300);
    await H.shot('02-result');
    await H.until(() => (window.OV.Scenes.top() || {}).id !== 'dogfight', 6000, 'fecho 1024');
    await H.setup({ crafts: ['c2', 'c3'], all: true, ufos: ['small_scout', 'harvester'] });
    await sleep(500);
    await H.shot('03-two');
    await page.keyboard.press('m');
    await sleep(300);
    await H.shot('04-minimised');
    await H.noMissing('1024');
    await page.evaluate(() => window.OV.DogfightUI.close());
    await ctx.close();
  }

  // ================================================================== iPad (toque)
  {
    const { ctx, page } = await session('ipad', { width: 1180, height: 820 }, { hasTouch: true, isMobile: false });
    const H = helpers(page, 'ipad-');
    await H.setup({ ufo: 'terror_ship', speed: 1500, alt: 2 });
    await page.locator('.df-mode[data-mode="cautious"]').tap();
    await sleep(200);
    const s = await H.st();
    check(s.d && s.d.mode === 'cautious', 'toque escolhe a postura');
    const h = await page.locator('.df-mode[data-mode="cautious"]').boundingBox();
    check(h && h.height >= 32, 'alvos de toque ≥ 32 px: ' + (h && h.height));
    await sleep(2200);
    await H.shot('01-touch');
    await page.evaluate(() => window.OV.DogfightUI.close());
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) fails.push(e);
console.log(`dogfight_check: ${checks} verificações, ${fails.length} falhas; capturas em ${OUT}`);
if (fails.length) {
  console.log('FALHAS:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('OK');
