/* Regressões de controlo e clareza do Battlescape (revisão UX, vaga 3) num Chromium real (Playwright).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre e abre
   /ovni-1999/index.html?battle=medium_scout&seed=7&debug=1 com navigator.platform = 'MacIntel'. Verifica:
   pinça/ctrl+roda e gestos horizontais por cima do HUD (zoom da câmara, nunca da página), menu de contexto nativo,
   classificação da roda (trackpad ≠ entalhe, usedTrackpad liga/desliga), ⌘⇧ deixados ao navegador, ⌘ sozinho
   atualiza a pré-visualização do tiro forçado (Ctrl no Mac não força), aliado na linha de tiro, etiquetas do alvo
   sem tapar a unidade e dentro do ecrã, câmara presa ao losango do mapa, Espaço seguro a acelerar ≠ «Feito»,
   clique de pressa só numa reprodução, repetição automática (Enter no modal, K), separador escondido, plural da
   espoleta, insígnia, precisão no menu, destino sem caminho, tamanhos de letra, dicas e aria-labels.
   Depois, num contexto iPad (toque): pinça sobre o HUD não amplia a página; pinça no canvas amplia a câmara.
   Falha com qualquer erro de consola/página. Uso: node ovni-1999/qa/ux_regress.mjs [--out <pasta>] [--headed] */
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
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'ux') : path.join(process.cwd(), 'qa-out', 'ux'));
const OUT = path.resolve(arg('out', DEF_OUT));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}
async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, '127.0.0.1', () => { s.end(); res(true); });
      s.on('error', () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

fs.mkdirSync(OUT, { recursive: true });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const errors = [];
const fails = [];
let browser, page, shotN = 0;

const log = (ok, msg) => {
  console.log((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) fails.push(msg);
};
const st = () => page.evaluate(() => OV.BattleUI.debug.state());
async function shot(name) {
  shotN++;
  await page.screenshot({ path: path.join(OUT, String(shotN).padStart(2, '0') + '_' + name + '.png') });
}
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 60000 });
  await page.waitForTimeout(120);
}
const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n || 2);

// funções injetadas: eventos de roda sintéticos (wheelDeltaY à maneira do Chrome no Mac: trunc(−3·deltaY))
const HELPERS = `
window.__wheel = function (x, y, o) {
  o = o || {};
  const t = o.sel ? document.querySelector(o.sel) : document.elementFromPoint(x, y);
  if (o.sel) { const r = t.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  const e = new WheelEvent('wheel', { deltaX: o.dx || 0, deltaY: o.dy || 0, deltaMode: o.mode || 0, clientX: x, clientY: y, ctrlKey: !!o.ctrl, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'wheelDeltaY', { value: o.wdy !== undefined ? o.wdy : Math.trunc(-3 * (o.dy || 0)) });
  Object.defineProperty(e, 'wheelDeltaX', { value: Math.trunc(-3 * (o.dx || 0)) });
  t.dispatchEvent(e);
  return e.defaultPrevented;
};
window.__kd = [];
`;

async function open(ctx, query) {
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  await idle();
  await page.addScriptTag({ content: HELPERS });
  await page.evaluate(() => {
    OV.Game.settings.confirmMove = 'never';
    OV.Game.settings.confirmEndTurn = false;
    window.addEventListener('keydown', (e) => window.__kd.push({ key: e.key, meta: e.metaKey, shift: e.shiftKey, prevented: e.defaultPrevented }));
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); })
      .observe(document.getElementById('toasts'), { childList: true });
  });
}
// tile alcançável a ~n passos (só leitura de B)
async function reachTile(n) {
  return page.evaluate((n) => {
    const B = OV.Game.B, s = OV.BattleUI.debug.state(), u = OV.BUnits.findUnit(B, s.selectedId);
    const r = OV.Path.reachable(B, u, Math.max(0, u.tu - 20), u.energy);
    let best = null, bd = 1e9;
    for (const i of r.list) {
      const z = (i / (B.map.w * B.map.h)) | 0, rr = i - z * B.map.w * B.map.h, x = rr % B.map.w, y = (rr / B.map.w) | 0;
      if (z !== u.z) continue;
      const d = Math.abs(Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) - n);
      if (d < bd) { bd = d; best = { x, y, z }; }
    }
    return best;
  }, n);
}
async function walk(n) {
  const t = await reachTile(n);
  const p = await page.evaluate(([x, y, z]) => OV.BattleUI.debug.tileToScreen(x, y, z), [t.x, t.y, t.z]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(60);
  return p;
}
// procura, à volta da unidade selecionada e no modo de pontaria, um tile cuja pré-visualização satisfaz fn
async function findTarget(test, r) {
  return page.evaluate(([src, r]) => {
    const fn = new Function('t', 'return ' + src);
    const u = OV.BattleUI.debug.state().unit;
    for (let d = 1; d <= r; d++) {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const p = OV.BattleUI.debug.tileToScreen(u.x + dx, u.y + dy, u.z);
        if (p.x < 40 || p.y < 80 || p.x > innerWidth - 40 || p.y > innerHeight - 200) continue;
        OV.BattleUI.debug.hover(p.x, p.y);
        const t = OV.BattleUI.debug.state().target;
        if (t && fn(t)) return { x: Math.round(p.x), y: Math.round(p.y), tile: [u.x + dx, u.y + dy], t };
      }
    }
    return null;
  }, [test, r || 9]);
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch({ headless: !argv.includes('--headed') });

  // ======================= A. Mac (rato + trackpad + teclado) =======================
  const mac = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
  await mac.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  await open(mac, 'battle=medium_scout&seed=7');
  log(await page.evaluate(() => OV.Input.isMac), 'plataforma Mac simulada');
  await shot('start');

  // aria-labels sem código-fonte
  const badAria = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label')).filter((s) => /=>|function|⟦/.test(s)));
  log(!badAria.length, 'aria-labels legíveis ' + (badAria.length ? JSON.stringify(badAria) : '(mãos: «' + (await page.evaluate(() => document.querySelector('.bs-hand').getAttribute('aria-label'))) + '»)'));

  // --- roda/pinça por cima do HUD
  const hudSel = ['.bs-card', '.bs-console', '.bs-sq', '.bs-end', '.bs-top'];
  const prevented = await page.evaluate((sels) => sels.map((s) => [s, __wheel(0, 0, { sel: s, ctrl: true, dy: 3 }), __wheel(0, 0, { sel: s, dx: -30 })]), hudSel);
  log(prevented.every((r) => r[1] && r[2]), 'ctrl+roda e roda horizontal por cima do HUD canceladas ' + JSON.stringify(prevented.filter((r) => !(r[1] && r[2]))));
  const z0 = (await st()).cam.zoom;
  await page.evaluate(() => { for (let k = 0; k < 6; k++) __wheel(0, 0, { sel: '.bs-sq', ctrl: true, dy: -8 }); });
  await page.waitForTimeout(400);
  const z1 = (await st()).cam.zoom;
  log(z1 > z0, 'pinça por cima da equipa amplia a câmara (' + z0 + ' → ' + z1 + ')');
  for (let k = 0; k < 3; k++) { await page.keyboard.press('Minus'); await page.waitForTimeout(220); }
  await page.keyboard.press('Equal');
  await page.waitForTimeout(250);
  const ctxm = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 860 });
    document.querySelector('.bs-console').dispatchEvent(e);
    return e.defaultPrevented;
  });
  log(ctxm, 'menu de contexto nativo bloqueado por cima da consola');

  // --- classificação da roda
  await page.keyboard.press('Period');
  await page.waitForTimeout(100);
  const vz0 = (await st()).viewZ;
  const tp = await page.evaluate(() => {
    const out = [];
    for (const dy of [-6, -14, -27, -40, -33, -20, -9]) { __wheel(720, 400, { dy }); out.push(OV.BattleUI.debug.state().viewZ); }
    return { out, used: OV.Input.usedTrackpad };
  });
  log(vz0 === 1 && tp.out.every((z) => z === vz0) && tp.used, 'trackpad vertical (−40 a meio da rajada) não muda de nível e liga usedTrackpad ' + JSON.stringify(tp));
  await page.waitForTimeout(450);
  const notch = await page.evaluate(() => { __wheel(720, 400, { dy: 40, wdy: -120 }); return { z: OV.BattleUI.debug.state().viewZ, used: OV.Input.usedTrackpad }; });
  log(notch.z === vz0 - 1 && !notch.used, 'entalhe de rato isolado desce um nível e volta ao modo rato ' + JSON.stringify(notch));
  const horiz = await page.evaluate(() => { for (const dx of [5, 12, 20, 9, 3]) __wheel(720, 400, { dx }); return OV.Input.usedTrackpad; });
  log(horiz, 'deslocação só horizontal também conta como trackpad');
  await page.waitForTimeout(450);
  await page.evaluate(() => __wheel(720, 400, { dy: 40, wdy: -120 }));
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(400);

  // --- atalhos ⌘⇧ ficam para o navegador
  await page.evaluate(() => { window.__kd = []; });
  for (const k of ['Meta+Shift+Backspace', 'Meta+Shift+ArrowUp', 'Meta+Shift+Enter', 'Meta+Shift+Digit1']) await page.keyboard.press(k);
  await page.waitForTimeout(150);
  const kd = await page.evaluate(() => window.__kd.filter((e) => e.meta && e.key !== 'Meta' && e.key !== 'Shift'));
  const modalOpen = await page.locator('#modals .modal').count();
  log(kd.length === 4 && kd.every((e) => !e.prevented) && !modalOpen, '⌘⇧⌫/↑/↵/1 não são consumidos pelo jogo ' + JSON.stringify(kd));

  // --- pontaria: aliado na linha, ⌘ sozinho, Ctrl no Mac, etiquetas
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(120);
  const menu = await page.evaluate(() => [...document.querySelectorAll('.bs-mi-acc')].map((n) => ({ t: n.textContent, title: n.getAttribute('title') })).filter((x) => x.t));
  log(menu.length && menu.every((m) => /^Pontaria \d+ %$/.test(m.t) && m.title), 'menu: coluna de pontaria rotulada com dica ' + JSON.stringify(menu[0]));
  await shot('menu');
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(120);
  log((await st()).mode === 'target', 'E → 1 entra no modo de pontaria (tiro rápido)');
  const fr = await findTarget("/está na linha de tiro/.test(t.label)", 6);
  log(!!fr && fr.t.sub === 'Risco: aliado na linha', 'aliado no caminho: etiqueta nomeia-o e o aviso não sugere o tiro forçado ' + JSON.stringify(fr && fr.t));
  if (fr) {
    await page.mouse.move(fr.x, fr.y);
    await frames(3);
    await shot('aim_friend_in_line');
  }
  const bl = await findTarget("t.blocked && /Sem linha de tiro/.test(t.label)", 9);
  if (bl) {
    await page.mouse.move(bl.x, bl.y);
    await frames(2);
    const s0 = (await st()).target;
    await page.keyboard.down('Meta');
    await frames(2);
    const s1 = (await st()).target;
    await page.keyboard.up('Meta');
    await frames(2);
    const s2 = (await st()).target;
    log(s0.sub === '⌘ + clique: tiro forçado' && /^Tiro forçado/.test(s1.label) && !/^Tiro forçado/.test(s2.label),
      '⌘ sozinho mostra/retira o tiro forçado sem mexer o rato: «' + s0.label + '» → «' + s1.label + '» → «' + s2.label + '»');
    await page.keyboard.down('Control');
    await page.mouse.move(bl.x + 1, bl.y);
    await frames(2);
    const s3 = (await st()).target;
    await page.keyboard.up('Control');
    log(!/^Tiro forçado/.test(s3.label), 'Ctrl no Mac não promete o tiro forçado (é o clique secundário): «' + s3.label + '»');
    await shot('aim_blocked');
  } else log(false, 'nenhum tile sem linha de tiro encontrado para o teste do ⌘');
  // etiquetas do alvo ao lado da unidade apontada e dentro do ecrã
  const other = await page.evaluate(() => {
    const s = OV.BattleUI.debug.state();
    const u = OV.Game.B.units.find((q) => q.side === 'xcom' && q.id !== s.selectedId && q.onMap && q.status === 'ok');
    return { id: u.id, p: OV.BattleUI.debug.unitScreen(u.id) };
  });
  await page.mouse.move(other.p.x, other.p.y);
  await frames(3);
  const geo = await page.evaluate((id) => ({ labels: OV.BattleRender.labels(), unit: OV.BattleRender.unitRects().find((r) => r.unitId === id) }), other.id);
  const ov = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  log(geo.unit && geo.labels.length && geo.labels.every((l) => !ov(l, geo.unit)), 'etiquetas do alvo não tapam a unidade apontada ' + JSON.stringify(geo.labels.map((l) => l.text)));
  await shot('aim_unit');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // --- etiquetas sempre dentro do ecrã (zoom 2, varrimento do ecrã)
  for (let k = 0; k < 4; k++) { await page.keyboard.press('Equal'); await page.waitForTimeout(220); }
  log((await st()).cam.zoom === 2, 'zoom 2 com «=»');
  let outside = [];
  for (let x = 6; x < 1440; x += 180) {
    for (let y = 90; y < 820; y += 120) {
      await page.mouse.move(x, y);
      await frames(2);
      const L = await page.evaluate(() => OV.BattleRender.labels());
      for (const l of L) if (l.x0 < 0 || l.y0 < 0 || l.x1 > 1440 || l.y1 > 900) outside.push([x, y, l.text]);
    }
  }
  await page.mouse.move(6, 450);
  await frames(2);
  await shot('label_left_edge');
  log(!outside.length, 'etiquetas de caminho dentro do ecrã a zoom 2 ' + JSON.stringify(outside.slice(0, 3)));
  for (let k = 0; k < 2; k++) { await page.keyboard.press('Minus'); await page.waitForTimeout(220); }
  log((await st()).cam.zoom === 1, 'zoom 1 com «−»');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(350);

  // --- destino sem caminho
  const np = await page.evaluate(() => {
    const B = OV.Game.B, m = B.map, u = OV.BattleUI.debug.state().unit;
    for (let d = 3; d < 14; d++) for (let dx = -d; dx <= d; dx++) {
      const x = u.x + dx, y = u.y + d;
      if (x < 0 || y >= m.h || x >= m.w) continue;
      if (m.disc[(u.z * m.h + y) * m.w + x] & 1) continue;
      const p = OV.BattleUI.debug.tileToScreen(x, y, u.z);
      if (p.x < 60 || p.x > innerWidth - 60 || p.y < 80 || p.y > innerHeight - 220) continue;
      return { x: p.x, y: p.y };
    }
    return null;
  });
  if (np) {
    await page.mouse.move(np.x, np.y);
    await frames(2);
    const s = await st();
    log(s.pathSteps === 1 && s.pathStates[0] === 'out' && s.pathLabel === 'Zona desconhecida', 'zona por descobrir: destino vermelho e motivo («' + s.pathLabel + '»)');
    await shot('hover_unknown');
  } else log(false, 'nenhum tile por descobrir à vista');

  // --- câmara presa ao losango do mapa
  const black = [];
  await page.evaluate(() => OV.BattleUI.debug.showAll(true)); // a névoa também é negra: medir só a geometria
  for (const [dx, dy, name] of [[-400, 0, 'left'], [400, 0, 'right'], [0, -400, 'up'], [0, 400, 'down']]) {
    await page.evaluate(([dx, dy]) => { for (let k = 0; k < 25; k++) __wheel(720, 400, { dx, dy: dy || 0.5 }); }, [dx, dy]);
    await frames(3);
    const r = await page.evaluate(() => {
      const s = OV.BattleUI.debug.state(), v = OV.View, m = OV.Game.B.map;
      const t = OV.Iso.screenToTileF(v.w / 2, v.h / 2, s.viewZ, s.cam);
      const g = v.ctx.getImageData(0, 0, v.canvas.width, v.canvas.height).data;
      let lit = 0, n = 0;
      for (let y = 40; y < v.canvas.height; y += 60) for (let x = 40; x < v.canvas.width; x += 60) {
        const k = (y * v.canvas.width + x) * 4;
        n++;
        if (g[k] + g[k + 1] + g[k + 2] > 40) lit++;
      }
      return { tx: +t.x.toFixed(1), ty: +t.y.toFixed(1), w: m.w, h: m.h, lit: +(lit / n).toFixed(2) };
    });
    if (name === 'left') await shot('cam_far_left');
    if (!(r.tx >= -2.01 && r.ty >= -2.01 && r.tx <= r.w + 2.01 && r.ty <= r.h + 2.01 && r.lit >= 0.1)) black.push([name, r]);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => OV.BattleUI.debug.showAll(false));
  log(!black.length, 'panorâmica extrema nunca deixa o ecrã negro (centro sobre o mapa) ' + JSON.stringify(black));

  // --- Espaço seguro para acelerar não é «Feito»
  const sel0 = (await st()).selectedId;
  await walk(6);
  log((await st()).playing, 'clique num tile a 6 passos começa a andar');
  await page.keyboard.down(' ');
  await page.waitForTimeout(80);
  const ff = await page.evaluate(() => OV.Presenter.fast);
  await idle();
  await page.keyboard.up(' ');
  await page.waitForTimeout(300);
  const after = await st();
  const done0 = await page.evaluate((id) => OV.BUnits.findUnit(OV.Game.B, id).done, sel0);
  log(ff && after.selectedId === sel0 && !done0, 'Espaço seguro durante a marcha acelera (×8) e largado depois não marca «Feito» (sel ' + after.selectedId + ', feito ' + done0 + ')');
  // controlo: um toque no Espaço com o jogo parado marca «Feito»
  await page.keyboard.press(' ');
  await idle();
  const ctl = await st();
  const done1 = await page.evaluate((id) => OV.BUnits.findUnit(OV.Game.B, id).done, sel0);
  log(done1 && ctl.selectedId !== sel0, 'toque no Espaço parado: «Feito» e passa ao seguinte (' + sel0 + ' → ' + ctl.selectedId + ')');

  // --- clique de pressa vale só para uma reprodução
  await walk(5);
  await page.mouse.click(700, 300);
  await idle();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await walk(7);
  await page.waitForTimeout(100);
  const fBefore = await page.evaluate(() => OV.Presenter.fast);
  await page.keyboard.down(' ');
  await page.waitForTimeout(40);
  await page.keyboard.up(' ');
  await page.waitForTimeout(30);
  const fAfter = await page.evaluate(() => ({ fast: OV.Presenter.fast, playing: OV.Presenter.playing }));
  log(!fBefore && fAfter.playing && !fAfter.fast, 'Espaço largado a meio volta à velocidade normal depois de um clique de pressa anterior ' + JSON.stringify(fAfter));
  await idle();

  // --- separador escondido a meio de uma animação
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await walk(7);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
  const vis = await page.evaluate(() => ({ playing: OV.Presenter.playing, fast: OV.Presenter.fast }));
  log(vis.playing && !vis.fast, 'voltar ao separador não deixa a animação a ×8 ' + JSON.stringify(vis));
  await idle();

  // --- repetição automática: K e Enter
  const k0 = (await st()).unit;
  await page.keyboard.down('k');
  await page.waitForTimeout(100);
  for (let k = 0; k < 25; k++) { await page.keyboard.down('k'); await page.waitForTimeout(35); }
  await page.keyboard.up('k');
  await idle();
  const k1 = (await st()).unit;
  log(k1.kneel !== k0.kneel && k0.tu - k1.tu <= 8, 'K seguro: ajoelha uma vez (UT ' + k0.tu + ' → ' + k1.tu + ')');
  await page.evaluate(() => { OV.Game.settings.confirmEndTurn = true; });
  const t0 = (await st()).turn;
  await page.keyboard.down('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.down('Enter');
  await page.waitForTimeout(60);
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.waitForTimeout(200);
  const em = await page.locator('#modals .modal').count();
  const t1 = await st();
  log(em === 1 && t1.turn === t0 && t1.side === 'xcom' && !t1.playing, 'Enter longo abre a confirmação e a repetição não a aceita (modal ' + em + ', turno ' + t1.turn + ')');
  await shot('endturn_confirm');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.evaluate(() => { OV.Game.settings.confirmEndTurn = false; });

  // --- espoleta: plural, insígnia, dica
  const gr = await page.evaluate(() => {
    const B = OV.Game.B;
    for (const u of B.units) {
      if (u.side !== 'xcom' || !u.onMap || u.status !== 'ok' || u.done || u.tu < 30) continue;
      const free = u.items.L === null || u.items.L === undefined ? 'L' : u.items.R === null || u.items.R === undefined ? 'R' : null;
      if (!free) continue;
      for (const slot of ['belt', 'pack']) for (const id of u.items[slot] || []) {
        const it = OV.BUnits.findItem(B, id), d = OV.Data.items[it.type];
        if (d && d.kind === 'grenade' && d.prime && !d.proximity) return { unitId: u.id, itemId: id, hand: free };
      }
    }
    return null;
  });
  if (gr) {
    await page.evaluate((g) => {
      // passar a granada para a mão pela ação do motor (o mesmo que o inventário faz)
      const a = { type: 'inv', unitId: g.unitId, itemId: g.itemId, to: g.hand };
      if (!OV.Act.validate(OV.Game.B, a).ok) throw new Error('inv recusado');
      for (const _ of OV.Act.perform(OV.Game.B, a)); // eslint-disable-line no-unused-vars
      OV.BattleUI.refresh();
    }, gr);
    const pos = await page.evaluate((id) => [...document.querySelectorAll('.bs-sq')].findIndex((n) => n.textContent.includes(OV.BUnits.findUnit(OV.Game.B, id).name)), gr.unitId);
    await page.locator('.bs-sq').nth(pos).click();
    await page.waitForTimeout(200);
    await page.keyboard.press(gr.hand === 'L' ? 'KeyQ' : 'KeyE');
    await page.waitForTimeout(150);
    const entries = (await st()).menu.entries;
    const n = entries.findIndex((e) => /^Ativar/.test(e.label)) + 1;
    await page.keyboard.press('Digit' + n);
    await page.waitForTimeout(150);
    const hint = await page.evaluate(() => (document.querySelector('.bs-fuse-hint') || {}).textContent);
    await shot('fuse_page');
    await page.evaluate(() => { window.__toasts = []; });
    await page.keyboard.press('Digit1');
    await idle();
    const toasts = await page.evaluate(() => window.__toasts);
    const badge = await page.evaluate(() => { const b = document.querySelector('.bs-hand-fuse'); return b ? { t: b.textContent, title: b.title } : null; });
    log(hint === 'Turnos até rebentar (0 = rebenta ao aterrar)', 'página da espoleta explica o 0 conforme as granadas instantâneas: «' + hint + '»');
    log(toasts.includes('Espoleta: rebenta daqui a 1 turno'), 'espoleta 1: «' + toasts.join(' | ') + '»');
    log(badge && badge.t === 'Esp. 1' && badge.title === 'Ativada: rebenta daqui a 1 turno', 'insígnia da granada ativada ' + JSON.stringify(badge));
    await shot('fuse_badge');
  } else log(false, 'nenhum soldado com granada e mão livre');

  // --- textos, tamanhos de letra e dicas
  const strs = await page.evaluate(() => Object.values(OV.STR).filter((v) => /Faltam UT|\btiles\b|turno\(s\)/.test(v)));
  log(!strs.length, 'sem «Faltam UT», «tiles» nem «turno(s)» nos textos ' + JSON.stringify(strs));
  const fonts = await page.evaluate(() => ['.bs-bar-row label', '.bs-bar-row .bar span', '.bs-cap', '.bs-level-txt', '.bs-hand-name', '.bs-hand-key', '.bs-sq-rank', '.bs-top-time', '.bs-chip']
    .map((q) => { const n = document.querySelector(q); return [q, n ? parseFloat(getComputedStyle(n).fontSize) : null]; }).filter((r) => r[1] !== null));
  log(fonts.every((f) => f[1] >= 10), 'letra do HUD ≥ 10 px ' + JSON.stringify(fonts));
  const tipOf = async (sel) => {
    await page.mouse.move(5, 5);
    await page.locator(sel).first().hover();
    await page.waitForTimeout(120);
    return page.evaluate(() => document.getElementById('tooltip').textContent);
  };
  const tMo = await tipOf('.bs-bar-row:nth-child(4)');
  const tDay = await tipOf('.bs-top-time');
  log(/pânico/.test(tMo) && /casas/.test(tDay), 'dicas explicam a moral e a visão: «' + tMo + '» · «' + tDay + '»');
  const miss = await page.evaluate(() => [...OV.T.missing]);
  log(!miss.length, 'chaves i18n em falta: ' + (miss.join(', ') || 'nenhuma'));
  await page.close();

  // ======================= B. noite: alienígena visível legível =======================
  await open(mac, 'battle=medium_scout&seed=7&night=1');
  const al = await page.evaluate(() => {
    const a = OV.Game.B.units.find((u) => u.side === 'alien' && u.onMap && u.status === 'ok');
    OV.BattleUI.debug.showAll(true); // só a vista: desenha-o como se a X-COM o visse
    OV.BattleUI.debug.centre(a.x, a.y, a.z);
    return a.id;
  });
  await page.mouse.move(5, 300);
  await frames(4);
  const luma = await page.evaluate((id) => {
    const r = OV.BattleRender.unitRects().find((q) => q.unitId === id), v = OV.View, d = v.dpr;
    const x0 = Math.round(r.x0 * d), y0 = Math.round(r.y0 * d), w = Math.round((r.x1 - r.x0) * d), h = Math.round((r.y1 - r.y0) * d);
    const g = v.ctx.getImageData(x0, y0, w, h).data;
    // média dos 25 % de píxeis mais claros da caixa (a silhueta, não o chão à volta)
    const L = [];
    for (let k = 0; k < g.length; k += 4) L.push(0.2126 * g[k] + 0.7152 * g[k + 1] + 0.0722 * g[k + 2]);
    L.sort((a, b) => b - a);
    const top = L.slice(0, Math.max(1, L.length >> 2));
    return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
  }, al);
  await shot('night_alien');
  log(luma >= 45, 'de noite, um alienígena desenhado lê-se no escuro (luma dos píxeis claros ' + luma + ')');
  await page.close();

  // ======================= C. iPad (toque) =======================
  const ipad = await browser.newContext({
    deviceScaleFactor: 2, viewport: { width: 1180, height: 820 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await open(ipad, 'battle=medium_scout&seed=7');
  const cdp = await ipad.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  async function pinch(cx, cy, spread) {
    await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
    for (let k = 1; k <= 8; k++) { await touch('touchMove', [[cx - 50 - k * spread, cy], [cx + 50 + k * spread, cy]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(350);
  }
  // touch-action não se herda: o efetivo é a interseção com os antepassados (html/body/#hud a none)
  const ta = await page.evaluate(() => ['html', 'body', '#hud', '#modals', '.bs-squad', '#view'].map((q) => [q, getComputedStyle(document.querySelector(q)).touchAction]));
  log(ta.every(([q, v]) => (q === '.bs-squad' ? v === 'pan-y' : v === 'none')), 'touch-action: ' + JSON.stringify(ta));
  for (const sel of ['.bs-console', '.bs-sq', '.bs-card']) {
    const r = await page.evaluate((q) => { const b = document.querySelector(q).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
    await pinch(r.x, r.y, 12);
    const sc = await page.evaluate(() => visualViewport.scale);
    log(sc === 1, 'pinça sobre ' + sel + ' não amplia a página (escala ' + sc + ')');
  }
  const zb = (await st()).cam.zoom;
  await pinch(560, 380, 10);
  const za = await st();
  const sc2 = await page.evaluate(() => visualViewport.scale);
  log(za.cam.zoom !== zb && sc2 === 1, 'pinça no canvas amplia a câmara (' + zb + ' → ' + za.cam.zoom + '), página a 1×');
  await shot('ipad_after_pinch');
  await page.close();
} catch (e) {
  errors.push(String(e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const e of errors) console.log('✗ ' + e);
const bad = errors.length + fails.length;
console.log(bad ? '✗ ' + fails.length + ' verificação(ões) falhada(s), ' + errors.length + ' erro(s)' : '✓ sem erros; capturas em ' + OUT);
process.exit(bad ? 1 : 0);
