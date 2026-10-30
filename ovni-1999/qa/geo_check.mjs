/* Verificação do Geoscape (js/ui/geo_ui.js) num Chromium real (Playwright).
   Campanha nova com base em Lisboa → investigação iniciada pela OV.BaseSim → globo aberto → tempo em cada velocidade
   até um OVNI ser detetado → interceção com um Intercetor (janela de combate ou recurso automático) até à queda →
   Skyranger enviado até «Iniciar missão?» → avisos de investigação e fabrico → fim do mês. Capturas a 1440×900,
   1280×800 e 1024×700 (@2×), medição de fps a rodar o globo, sem erros de consola nem chaves ⟦em falta⟧.
   Uso: node ovni-1999/qa/geo_check.mjs [--out <pasta>] [--port <n>] [--quick]
   Capturas fora do repositório (pasta de sessão, OVNI_QA_OUT ou ./qa-out). Código de saída ≠ 0 em qualquer falha. */
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
const QUICK = argv.includes('--quick');
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'geo')
  : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'geo') : path.join(process.cwd(), 'qa-out', 'geo');
const OUT = path.resolve(arg('--out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

const fails = [];
const notes = [];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) fails.push(msg); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);

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

// ---- utilidades na página ------------------------------------------------------------------------------------------
const st = (page) => page.evaluate(() => {
  const s = OV.GeoUI.current();
  const top = OV.Scenes.top();
  const G = OV.Game.G;
  return Object.assign({ top: top ? top.id : null, ufos: G ? G.ufos.map((u) => ({ id: u.id, status: u.status, detected: u.detected })) : [] }, s || {});
});
async function shot(page, name) {
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}
async function missingKeys(page) {
  return page.evaluate(() => {
    const vis = (document.body.innerText.match(/⟦[^⟧]*⟧/g) || []);
    const geo = [...(OV.T.missing || [])].filter((k) => /^geo\./.test(k));
    return vis.concat(geo).join(', ');
  });
}
async function newGame(page, opts) {
  await page.goto(BASE);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.GeoUI && OV.Campaign);
  await page.evaluate((o) => {
    const G = OV.Campaign.newCampaign({ seed: o.seed, difficulty: o.diff, baseLonLat: { lon: -9.14, lat: 38.72 } });
    if (o.research) OV.BaseSim.startResearch(G, 'b1', 'medikit', 10);
    if (o.reveal) G.debug = { revealUfos: true };
    window.__G0 = G;
    OV.GeoUI.open(G);
  }, opts);
  await sleep(900);
}

// avança o tempo até pred(state) com reações automáticas às janelas (registadas em seen)
async function drive(page, pred, o) {
  const opt = Object.assign({ speed: '5', maxMs: 60000, label: '' }, o || {});
  const end = Date.now() + opt.maxMs;
  let lastKey = 0;
  while (Date.now() < end) {
    const s = await st(page);
    if (pred(s)) { if (s.popup && opt.seen) opt.seen.add(s.popup); return s; }
    if (s.top === 'dogfight') { await handleDogfight(page); continue; }
    if (s.top && s.top !== 'geoscape') {
      opt.seen && opt.seen.add('scene:' + s.top);
      await shotOnce(page, 'scene-' + s.top, opt.seen);
      await page.keyboard.press('Escape');
      await sleep(300);
      const s2 = await st(page);
      if (s2.top === s.top) await page.evaluate(() => OV.Scenes.pop());
      await sleep(200);
      continue;
    }
    if (s.popup) {
      await shotOnce(page, 'popup-' + s.popup, opt.seen);
      opt.seen && opt.seen.add(s.popup);
      if (opt.onPopup && (await opt.onPopup(s))) continue;
      await page.keyboard.press('Escape');
      await sleep(250);
      continue;
    }
    if (s.dialog) { await page.keyboard.press('Escape'); await sleep(150); continue; }
    if (s.speed !== +opt.speed - 1 && Date.now() - lastKey > 400) { await page.keyboard.press(opt.speed); lastKey = Date.now(); }
    await sleep(120);
  }
  return null;
}
const shotSeen = new Set();
async function shotOnce(page, name, seen) {
  if (shotSeen.has(name)) return;
  shotSeen.add(name);
  await shot(page, name);
}
let dogfights = 0;
async function handleDogfight(page) {
  dogfights++;
  await sleep(500);
  if (dogfights === 1) await shot(page, 'dogfight-open');
  // postura agressiva (tecla 4), espera pelo fim; Enter fecha o resultado
  await page.keyboard.press('4');
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    const top = await page.evaluate(() => OV.Scenes.top() && OV.Scenes.top().id);
    if (top !== 'dogfight') break;
    await sleep(400);
    const over = await page.evaluate(() => !!(OV.DogfightUI && OV.DogfightUI.active().some((p) => p.over)));
    if (over) { await shot(page, 'dogfight-end-' + dogfights); await page.keyboard.press('Enter'); await sleep(400); }
  }
}

// fps em rotação: arrasto contínuo do rato durante ~2,5 s
async function measureFps(page, w, h) {
  const d0 = (await st(page)).draws;
  await page.evaluate(() => {
    window.__fr = [];
    let last = performance.now();
    const f = (t) => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(f); };
    window.__frOn = true;
    requestAnimationFrame(f);
  });
  const cx = (w - 320) / 2, cy = h / 2;
  await page.mouse.move(cx - 200, cy);
  await page.mouse.down();
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 2500) {
    k++;
    await page.mouse.move(cx - 200 + ((k * 9) % 400), cy + Math.sin(k / 6) * 60);
    await sleep(8);
  }
  await page.mouse.up();
  const r = await page.evaluate(() => {
    window.__frOn = false;
    const fr = window.__fr.slice(3);
    const s = OV.GeoUI.current();
    fr.sort((a, b) => a - b);
    const avg = fr.reduce((a, b) => a + b, 0) / Math.max(1, fr.length);
    return { frames: fr.length, fps: 1000 / avg, p95: fr[Math.floor(fr.length * 0.95)] || 0, drawMs: s && s.perf ? s.perf.ms : null };
  });
  r.draws = (await st(page)).draws - d0;
  // tempo de JS do desenho do globo em movimento (média de 30 desenhos forçados)
  r.jsDrawMs = await page.evaluate(() => {
    const s = OV.GeoUI.current();
    const v = { lon: s.view.lon, lat: s.view.lat, zoom: s.view.zoom, w: OV.View.w, h: OV.View.h, dpr: OV.View.dpr, cx: (OV.View.w - 320) / 2, time: performance.now() };
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) { OV.GlobeRender.rotateBy(v, 6, 0); v.time = performance.now(); OV.GlobeRender.draw(OV.View.ctx, OV.Game.G, v); }
    return (performance.now() - t0) / 30;
  });
  return r;
}

let browser = null;
try {
  if (!(await waitHttp(BASE, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // ===================================================== fluxo completo a 1440×900 =====================================
  {
    const W = 1440, H = 900;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(W + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(W + ' console.error: ' + m.text()); });
    await newGame(page, { seed: 7, diff: 0, research: true });
    let s = await st(page);
    check(s.top === 'geoscape', 'cena geoscape aberta');
    check(s.popup === 'intro', 'aviso de boas-vindas');
    await shot(page, '1440-00-intro');
    await page.keyboard.press('Enter');
    await sleep(500);
    await shot(page, '1440-01-main');
    // fps a rodar o globo
    await page.keyboard.press('p');
    const fps = await measureFps(page, W, H);
    log('rotação 1440×900@2×:', JSON.stringify(fps));
    notes.push('fps a rodar (1440×900@2×, contentor sem GPU): ' + fps.fps.toFixed(1) + ' (p95 ' + fps.p95.toFixed(1) + ' ms; JS do desenho ' + fps.jsDrawMs.toFixed(1) + ' ms)');
    check(fps.frames > 5, 'fotogramas medidos');
    check(fps.draws > 5, 'o globo redesenha durante a rotação (' + fps.draws + ' desenhos)');
    await page.keyboard.press('p');

    // cada velocidade avança o relógio (e mais depressa que a anterior), até à primeira deteção
    const seen = new Set();
    const deltas = [];
    for (let k = 1; k <= 6; k++) {
      s = await st(page);
      if (s.popup) break;
      const t0 = s.t;
      await page.keyboard.press(String(k));
      await sleep(1200);
      s = await st(page);
      deltas.push({ speed: k, dt: s.t - t0, stoppedBy: s.popup });
      if (s.popup) break;
    }
    log('Δt por velocidade (s de jogo em 1,2 s):', JSON.stringify(deltas));
    check(deltas.length >= 3 && deltas.every((d) => d.dt > 0), 'cada velocidade avança o tempo');
    for (let i = 1; i < deltas.length; i++) if (!deltas[i].stoppedBy && !deltas[i - 1].stoppedBy) check(deltas[i].dt > deltas[i - 1].dt, 'velocidade ' + deltas[i].speed + ' mais rápida que ' + deltas[i - 1].speed);

    // até um OVNI em voo ser detetado (as janelas intermédias fecham-se)
    let flying = null;
    const isFlyingDet = (x) => x.popup === 'ufoDetected' && x.ufos.some((u) => u.detected && u.status === 'flying');
    flying = await drive(page, isFlyingDet, { speed: '4', maxMs: QUICK ? 30000 : 70000, seen });
    if (!flying) {
      notes.push('nenhum OVNI em voo detetado de forma natural: G.debug.revealUfos ligado para continuar');
      await page.evaluate(() => { OV.Game.G.debug = { revealUfos: true }; });
      flying = await drive(page, isFlyingDet, { speed: '4', maxMs: 40000, seen });
    }
    check(!!flying, 'OVNI em voo detetado');
    s = await st(page);
    check(s.speed === 0, 'velocidade caiu para 5 s no alerta');
    await shot(page, '1440-02-ufo-detected');
    const tPause = s.t;
    await sleep(700);
    check((await st(page)).t === tPause, 'tempo parado com o aviso aberto');

    // interceção: tentativas até uma queda (agressivo); cada OVNI novo é intercetado
    let crashed = null;
    for (let attempt = 0; attempt < (QUICK ? 2 : 5) && !crashed; attempt++) {
      s = await st(page);
      if (s.popup !== 'ufoDetected') {
        const got = await drive(page, isFlyingDet, { speed: '4', maxMs: 60000, seen });
        if (!got) break;
      }
      await page.keyboard.press('i');
      await sleep(500);
      s = await st(page);
      check(s.dialog === 'intercept', 'diálogo de interceção');
      if (attempt === 0) await shot(page, '1440-03-intercept-craft');
      const picked = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.geo-int .geo-row:not(:disabled)')];
        const r = rows.find((b) => /Intercetor/.test(b.textContent));
        if (!r) return null;
        r.click();
        return r.querySelector('b').textContent;
      });
      if (!picked) { notes.push('sem intercetor disponível na tentativa ' + attempt); await page.keyboard.press('Escape'); break; }
      log('lançado:', picked);
      await sleep(400);
      if (attempt === 0) await shot(page, '1440-04-launched');
      // acelera até ao combate e ao seu resultado
      const res = await drive(page, (x) => ['ufoCrashed', 'ufoDestroyed', 'ufoEscaped', 'craftLost', 'targetLost', 'craftArrived', 'ufoLost'].includes(x.popup), {
        speed: '3', maxMs: 90000, seen,
        onPopup: async (x) => { if (x.popup === 'ufoDetected') { await page.keyboard.press('Escape'); return true; } return false; },
      });
      if (!res) { notes.push('combate sem resultado na tentativa ' + attempt); break; }
      log('resultado:', res.popup);
      await shot(page, '1440-05-result-' + attempt + '-' + res.popup);
      if (res.popup === 'ufoCrashed') crashed = res;
      else {
        await page.keyboard.press(res.popup === 'targetLost' || res.popup === 'craftArrived' ? 'r' : 'Escape');
        await sleep(300);
      }
    }
    check(dogfights > 0, 'janela de combate aberta (ou recurso automático)');
    if (!crashed) notes.push('nenhuma queda em ' + dogfights + ' combates (destruição/fuga são resultados legítimos)');

    // equipa enviada a um OVNI no chão (queda ou aterragem)
    let groundRef = null;
    if (crashed) { await page.keyboard.press('e'); groundRef = 'crash'; }
    else {
      const g = await drive(page, (x) => x.popup === 'ufoDetected' && x.ufos.some((u) => u.detected && u.status === 'landed') || x.popup === 'ufoLanded', { speed: '4', maxMs: 60000, seen });
      if (g) { await page.keyboard.press('e'); groundRef = 'landed'; }
    }
    await sleep(500);
    s = await st(page);
    if (check(groundRef && s.dialog === 'intercept', 'diálogo «Enviar equipa»')) {
      await shot(page, '1440-06-send-team');
      const sky = await page.evaluate(() => {
        const r = [...document.querySelectorAll('.geo-int .geo-row:not(:disabled)')].find((b) => /Skyranger/.test(b.textContent));
        if (r) r.click();
        return !!r;
      });
      check(sky, 'Skyranger escolhido');
      const arr = await drive(page, (x) => x.popup === 'craftArrived', {
        speed: '3', maxMs: 90000, seen,
        onPopup: async (x) => { if (x.popup !== 'craftArrived') { await page.keyboard.press('Escape'); return true; } return false; },
      });
      check(!!arr, '«Iniciar missão?» na chegada');
      if (arr) {
        await shot(page, '1440-07-start-mission');
        const txt = await page.evaluate(() => document.querySelector('.geo-pop') && document.querySelector('.geo-pop').innerText);
        // de noite (ou ao crepúsculo) «Esperar pelo dia» pode ser o Enter: aí ataca-se com I («Atacar já»)
        const nightDef = /Atacar já/i.test(txt || '');
        check(/Iniciar (a )?missão|Atacar já/i.test(txt || ''), 'botão «Iniciar missão» / «Atacar já»');
        await page.keyboard.press(nightDef ? 'i' : 'Enter');
        await sleep(1500);
        const top = await page.evaluate(() => OV.Scenes.top() && OV.Scenes.top().id);
        log('após «Iniciar missão»:', top);
        check(top && top !== 'geoscape', 'missão lançada (cena ' + top + ')');
        await shot(page, '1440-08-after-launch');
        // volta ao Geoscape sem jogar a batalha
        await page.evaluate(() => {
          const G = OV.Game.G;
          if (G.activeMission) OV.Campaign.cancelMission(G);
          OV.Game.B = null;
          OV.GeoUI.open(G);
        });
        await sleep(600);
      }
    }

    // investigação (já iniciada) e fabrico do Medi-Kit desbloqueado
    s = await st(page);
    let research = seen.has('researchDone') ? s : null;
    if (!research) research = await drive(page, (x) => x.popup === 'researchDone', { speed: '5', maxMs: 60000, seen });
    if (!seen.has('researchDone')) {
      log('investigação:', JSON.stringify(await page.evaluate(() => ({ r: OV.Game.G.researched, b: OV.Game.G.bases[0].research, t: OV.Game.G.t, same: OV.Game.G === window.__G0,
        stack: OV.Scenes.stack.map((x) => x.id), cur: OV.GeoUI.current(), modals: document.getElementById('modals').innerText.slice(0, 300) }))));
      await shot(page, '1440-09-research-missing');
    }
    check(seen.has('researchDone'), 'aviso de investigação concluída');
    if (research && research.popup === 'researchDone') {
      await shot(page, '1440-09-research');
      await page.keyboard.press('Escape');
    }
    const prod = await page.evaluate(() => OV.BaseSim.startProduction(OV.Game.G, 'b1', 'medikit', 10, 1));
    check(prod && prod.ok, 'fabrico iniciado: ' + JSON.stringify(prod && prod.reason));
    await drive(page, (x) => x.popup === 'productionDone', { speed: '5', maxMs: 60000, seen });
    check(seen.has('productionDone'), 'aviso de fabrico concluído');
    if ((await st(page)).popup === 'productionDone') { await shot(page, '1440-10-production'); await page.keyboard.press('Escape'); }

    // painel de financiamento e cartões
    await sleep(300);
    await page.keyboard.press('f');
    await sleep(500);
    check((await st(page)).dialog === 'funding', 'painel de financiamento');
    await shot(page, '1440-11-funding');
    await page.keyboard.press('Escape');
    await page.evaluate(() => OV.GeoUI.select({ kind: 'base', id: 'b1' }));
    await sleep(400);
    await shot(page, '1440-12-card-base');

    // fim do mês
    const mo = await drive(page, (x) => x.top !== 'geoscape' && x.top !== 'dogfight' || x.popup === 'monthEnd' || (x.queue || []).includes('monthEnd') || x.waiting, {
      speed: '6', maxMs: 90000, seen,
      onPopup: async (x) => { if (x.popup === 'monthEnd') return false; await page.keyboard.press('Escape'); return true; },
    });
    s = await st(page);
    check(!!mo, 'fim do mês alcançado');
    await sleep(600);
    await shot(page, '1440-13-month-end');
    const hist = await page.evaluate(() => OV.Game.G.history.length);
    check(hist >= 1, 'G.history tem o mês fechado');
    log('popups vistos:', [...seen].join(', '));
    if (s.top !== 'geoscape') { await page.keyboard.press('Escape'); await sleep(400); }

    const miss = await missingKeys(page);
    check(!miss, '1440: chaves em falta ' + miss);
    await ctx.close();
  }

  // ===================================================== tamanhos menores =============================================
  for (const [W, H] of [[1280, 800], [1024, 700]]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(W + ' pageerror: ' + (e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(W + ' console.error: ' + m.text()); });
    await newGame(page, { seed: 21, diff: 1, research: false, reveal: true });
    await page.keyboard.press('Enter');
    await sleep(300);
    await shot(page, W + '-01-main');
    const seen = new Set();
    const d = await drive(page, (x) => x.popup === 'ufoDetected', { speed: '4', maxMs: 40000, seen });
    check(!!d, W + ': OVNI detetado');
    await shot(page, W + '-02-ufo-detected');
    await page.keyboard.press('i');
    await sleep(500);
    await shot(page, W + '-03-intercept');
    // o painel e o diálogo cabem no ecrã
    const fit = await page.evaluate(() => {
      const r = (q) => { const n = document.querySelector(q); if (!n) return null; const b = n.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      return { side: r('.geo-side'), dlg: r('.geo-dlg'), vw: innerWidth, vh: innerHeight, lists: (() => { const n = document.querySelector('.geo-lists'); return n ? n.clientHeight : 0; })() };
    });
    check(fit.side && fit.side[3] <= fit.vh + 1 && fit.side[0] >= 0, W + ': painel lateral dentro do ecrã');
    check(fit.dlg && fit.dlg[2] <= fit.side[0] + 1 && fit.dlg[3] <= fit.vh, W + ': diálogo não tapa o painel');
    check(fit.lists >= 40, W + ': listas visíveis (' + fit.lists + ' px)');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('f');
    await sleep(500);
    await shot(page, W + '-04-funding');
    await page.keyboard.press('Escape');
    // seleção de uma nave no ar (cartão)
    await page.evaluate(() => {
      const G = OV.Game.G;
      const u = G.ufos.find((x) => x.detected);
      if (u) OV.World.launch(G, 'c2', { kind: 'ufo', id: u.id });
      OV.GeoUI.select({ kind: 'craft', id: 'c2' });
    });
    await sleep(500);
    await shot(page, W + '-05-card-craft');
    const miss = await missingKeys(page);
    check(!miss, W + ': chaves em falta ' + miss);
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

for (const e of errors) fails.push(e);
for (const n of notes) console.log('ℹ ' + n);
for (const f of fails) console.log('✗ ' + f);
console.log((fails.length ? '✗' : '✓') + ' geo_check: ' + (checks - fails.length + errors.length) + '/' + checks + ' verificações; capturas em ' + OUT);
process.exit(fails.length ? 1 : 0);
