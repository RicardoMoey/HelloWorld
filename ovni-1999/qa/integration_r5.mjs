/* Ronda 5 de personas — integração num Chromium real (Playwright). Uma verificação por pendente cruzado:
   A) base alienígena: centro de controlo destruído → aviso (painel, registo, «Abortar» verde) e a confirmação diz
      VITÓRIA; sair com a equipa na nave dá o relatório de vitória;
   B) fila da equipa: soldado a sangrar com ✚ e «ferido a sangrar» no nome acessível;
   C) memorial do relatório com a causa da morte (texto do registo do combate);
   D) base › Instalações: barra «Defesa da base» (força / exigida, risco de perder a base);
   E) Ufopédia: cabeçalhos de secção fixos não se sobrepõem ao deslocar a lista;
   F) «Equipar» a 1024×560: ajuda do rodapé inteira em 2 linhas, nota «Ficaram em» sem 3.ª linha cortada;
   G) Como Jogar: linha do ⌥ + clique na porta.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/integration_r5.mjs [--out <pasta>] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'integration_r5') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'integration_r5') : path.join(process.cwd(), 'qa-out', 'integration_r5');
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
  low: { viewport: { width: 1024, height: 560 } },
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
  log('A. Base alienígena: sair depois de destruir o centro de controlo é a vitória');
  for (const view of ['desk', 'padL']) {
    const { ctx, page } = await openPage(view, 'exit-' + view, 'battle=alienBase&seed=3&diff=1');
    const r = await page.evaluate(() => {
      const B = OV.Game.B, m = B.map;
      let n = 0;
      for (const i of B.objectiveTiles || []) for (let p = 0; p < 4; p++) {
        const d = OV.BMap.def(m, i, p);
        if (d && d.special === 'OBJECTIVE') { m.parts[i * 4 + p] = 0; n++; }
      }
      const craft = new Set(B.craftTiles || []);
      const u = B.units.find((x) => x.side === 'xcom' && x.onMap && x.status === 'ok' && OV.BUnits.unitTiles(x, m).some((i) => craft.has(i)));
      return { n, exit: OV.Battle.exitWin(B), u: u ? { id: u.id, x: u.x, y: u.y, z: u.z } : null, outcome: OV.Battle.outcome(B) };
    });
    check(r.n > 0 && r.exit && r.outcome === null && !!r.u, view + ': centro destruído, a batalha continua ' + JSON.stringify(r));
    // uma ação do jogador (andar uma casa dentro da nave) passa por afterAction
    const mv = await page.evaluate(async (u) => {
      const B = OV.Game.B, m = B.map;
      const tried = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = u.x + dx, y = u.y + dy, z = u.z;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        if (B.units.some((q) => q.onMap && q.x === x && q.y === y && q.z === z && q.status !== 'dead')) continue;
        const v = OV.Act.validate(B, { type: 'walk', unitId: u.id, to: OV.BMap.idx(m, x, y, z) });
        tried.push([x, y, v.ok, v.reason]);
        if (!v.ok) continue;
        const res = await OV.BattleUI.debug.selectAndMove(u.id, x, y, z);
        return { x, y, res: res && res.ok, tried };
      }
      return { tried };
    }, r.u);
    await idle(page);
    const s = await st(page);
    check(s.exitHinted, view + ': aviso dado depois da ação ' + JSON.stringify(mv));
    const hud = await page.evaluate(() => ({
      abortCls: document.querySelector('.bs-btn.danger.exit-win') ? 1 : 0,
      report: OV.BattleUI.debug.state().report,
      toasts: [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent),
      log: OV.BattleUI.debug.log().map((e) => e.text),
    }));
    check(hud.abortCls === 1, view + ': «Abortar» passa a verde (exit-win)');
    check(!!hud.report && hud.report.rows.some((x) => /Centro de controlo destruído!/.test(x)), view + ': painel com o aviso ' + JSON.stringify(hud.report));
    check(hud.toasts.some((x) => /volte à nave e aborte para vencer/.test(x)), view + ': aviso rápido ' + JSON.stringify(hud.toasts));
    check(hud.log.some((x) => /Abortar \(X\)/.test(x)), view + ': fica no registo (N)');
    await shot(page, 'A-exit-hint-' + view);
    await noMissing(page, view + ' aviso');
    // Abortar: a janela diz que é vitória
    await page.evaluate(() => OV.BattleUI.abort());
    await page.waitForSelector('.modal');
    await sleep(200);
    const md = await page.evaluate(() => ({ text: document.querySelector('.modal').innerText, btns: [...document.querySelectorAll('.modal button')].map((b) => ({ t: b.textContent, cls: b.className })) }));
    check(/VITÓRIA/.test(md.text) && md.btns.some((b) => /Sair — base destruída/.test(b.t) && /primary/.test(b.cls)), view + ': confirmação «sair conta como VITÓRIA» ' + JSON.stringify(md.btns));
    await shot(page, 'A-exit-confirm-' + view);
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => /Sair — base destruída/.test(b.textContent)).click());
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'debrief', null, { timeout: 30000 });
    await sleep(600);
    const db = await page.evaluate(() => ({ res: OV.Game && OV.Scenes.top().id, text: document.body.innerText.slice(0, 4000) }));
    check(/a equipa saiu e a base caiu/.test(db.text), view + ': relatório de vitória com a nota do objetivo');
    await shot(page, 'A-exit-debrief-' + view);
    await noMissing(page, view + ' relatório');
    await ctx.close();
  }

  // =============================================================================================================
  log('B/C. Ferido a sangrar na fila da equipa; causa da morte no memorial');
  {
    const view = 'zoom';
    const { ctx, page } = await openPage(view, 'bleed-' + view, 'battle=crash&seed=4&diff=1');
    const r = await page.evaluate(() => {
      const B = OV.Game.B;
      const xs = B.units.filter((x) => x.side === 'xcom' && x.onMap && x.status === 'ok');
      xs[0].wounds = [0, 2, 0, 0, 0, 0];
      OV.BattleUI.refresh();
      return { id: xs[0].id, name: xs[0].name, victim: xs[1].id };
    });
    await sleep(400);
    const row = await page.evaluate(() => {
      const it = [...document.querySelectorAll('.bs-sq')].find((n) => n.classList.contains('bleeding'));
      return it ? { mark: (it.querySelector('.bs-sq-bleed') || {}).textContent, aria: it.getAttribute('aria-label'), n: document.querySelectorAll('.bs-sq.bleeding').length } : null;
    });
    check(!!row && row.n === 1 && row.mark === '✚' && /ferido a sangrar/.test(row.aria) && row.aria.indexOf(r.name) === 0, view + ': ✚ e nome acessível ' + JSON.stringify(row));
    await shot(page, 'B-bleed-' + view);
    // C: um soldado morto por um alienígena (evento passado pelo registo) → memorial com a causa
    await page.evaluate((vid) => {
      const B = OV.Game.B;
      const v = OV.BUnits.findUnit(B, vid);
      const a = B.units.find((x) => x.side === 'alien' && x.status === 'ok');
      const evs = OV.Combat.killUnit(B, v, a.id, 'shot');
      for (const e of evs) OV.BattleUI.debug.noteEvent(e);
    }, r.victim);
    await page.evaluate(() => OV.BattleUI.abort());
    await page.waitForSelector('.modal');
    await sleep(200);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal button')]; b[b.length - 1].click(); });
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'debrief', null, { timeout: 30000 });
    await sleep(600);
    const mem = await page.evaluate(() => [...document.querySelectorAll('.scr-mem .scr-muted')].map((n) => n.textContent));
    check(mem.some((x) => /em combate — \S/.test(x)), view + ': memorial com a causa ' + JSON.stringify(mem));
    await shot(page, 'C-memorial-' + view);
    await noMissing(page, view + ' memorial');
    await ctx.close();
  }

  // =============================================================================================================
  log('D. Base › Instalações: defesa da base');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'def-' + view);
    await page.evaluate(NEWG, { seed: 41, diff: 1, month: 3 });
    await sleep(300);
    await page.evaluate(() => OV.BaseUI.open(window.__G, window.__G.bases[0].id, 'facilities'));
    await page.waitForSelector('.bsc-def');
    await sleep(300);
    const d = await page.evaluate(() => {
      const n = document.querySelector('.bsc-def');
      const r = n.getBoundingClientRect();
      return { text: n.innerText, cls: n.className, w: r.width, right: r.right, vw: innerWidth };
    });
    check(/Defesa da base/i.test(d.text) && /exigida/.test(d.text) && /Risco de perder a base: \d+ %/.test(d.text), view + ': barra da defesa ' + JSON.stringify(d.text));
    check(d.right <= d.vw && d.w > 150, view + ': cabe no painel');
    await shot(page, 'D-defence-' + view);
    await noMissing(page, view + ' defesa');
    await ctx.close();
  }

  // =============================================================================================================
  log('E. Ufopédia: cabeçalhos de secção fixos sem sobreposição');
  for (const view of ['desk', 'zoom']) {
    const { ctx, page } = await openPage(view, 'up-' + view);
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Ufopaedia.open(null); });
    await page.waitForSelector('.up-nav-group');
    await sleep(300);
    const res = [];
    for (const f of [0.15, 0.35, 0.55, 0.8]) {
      const o = await page.evaluate((frac) => {
        const nav = document.querySelector('.up-nav');
        nav.scrollTop = Math.round((nav.scrollHeight - nav.clientHeight) * frac);
        return new Promise((ok) => requestAnimationFrame(() => {
          const nr = nav.getBoundingClientRect();
          const hs = [...nav.querySelectorAll('.up-nav-sec')].map((h) => h.getBoundingClientRect()).filter((q) => q.bottom > nr.top && q.top < nr.bottom);
          let overlap = 0;
          for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (hs[i].top < hs[j].bottom - 1 && hs[j].top < hs[i].bottom - 1) overlap++;
          ok({ n: hs.length, overlap, groups: nav.querySelectorAll('.up-nav-group').length, st: nav.scrollTop });
        }));
      }, f);
      res.push(o);
    }
    check(res.every((o) => o.overlap === 0 && o.groups >= 3) && res.some((o) => o.st > 0), view + ': nenhum cabeçalho por cima de outro ' + JSON.stringify(res));
    await page.evaluate(() => { const nav = document.querySelector('.up-nav'); nav.scrollTop = Math.round((nav.scrollHeight - nav.clientHeight) * 0.35); });
    await shot(page, 'E-ufopaedia-' + view);
    await noMissing(page, view + ' Ufopédia');
    await ctx.close();
  }

  // =============================================================================================================
  log('F. «Equipar» a 1024×560 fora da base: rodapé e nota «Ficaram em»');
  {
    const { ctx, page } = await openPage('low', 'eq-low');
    await page.evaluate(NEWG, { seed: 41, diff: 0 });
    await page.evaluate(() => {
      const G = window.__G, c = window.__sky;
      const b = OV.Campaign.findBase(G, c.baseId);
      b.stores = Object.assign({}, b.stores, { rocket_launcher: 3, small_rocket: 6, laser_rifle: 4, medikit: 3, electro_flare: 6, grenade: 9 });
      c.status = 'out';
      OV.Scenes.push('equip', { G, craftId: c.id });
    });
    await page.waitForSelector('.cp-eq');
    await sleep(500);
    const f = await page.evaluate(() => {
      const h = document.querySelector('.cp-eq > footer .scr-hint');
      const l = document.querySelector('.cp-eq-left');
      const lh = l ? parseFloat(getComputedStyle(l).lineHeight) : 0;
      return {
        hint: h ? { clamp: getComputedStyle(h).webkitLineClamp, sh: h.scrollHeight, ch: h.clientHeight, ell: getComputedStyle(h).textOverflow } : null,
        left: l ? { h: l.getBoundingClientRect().height, lh, pad: parseFloat(getComputedStyle(l).paddingTop) + parseFloat(getComputedStyle(l).paddingBottom), border: parseFloat(getComputedStyle(l).borderTopWidth) + parseFloat(getComputedStyle(l).borderBottomWidth) } : null,
      };
    });
    check(!!f.hint && f.hint.clamp === '2' && f.hint.ell !== 'ellipsis' && f.hint.sh <= f.hint.ch + 2, 'rodapé em até 2 linhas, inteiro ' + JSON.stringify(f.hint));
    check(!!f.left && f.left.h <= 2 * f.left.lh + f.left.pad + f.left.border + 2, 'nota «Ficaram em» sem 3.ª linha a espreitar ' + JSON.stringify(f.left));
    await shot(page, 'F-equip-low');
    await noMissing(page, 'equipar 1024×560');
    await ctx.close();
  }

  // =============================================================================================================
  log('G. Como Jogar: Alt/⌥ + clique abre a porta');
  {
    const { ctx, page } = await openPage('desk', 'howto');
    await page.evaluate(() => { OV.Scenes.set('menu'); OV.Scenes.push('howto', { tab: 'controls' }); });
    await sleep(500);
    const txt = await page.evaluate(() => document.body.innerText);
    check(/⌥ Option\+clique numa porta/.test(txt) && /abre-a sozinho e pára/.test(txt), 'linha da porta (Mac) no Como Jogar');
    await shot(page, 'G-howto');
    await noMissing(page, 'Como Jogar');
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
