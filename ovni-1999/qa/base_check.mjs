/* QA visual do Basescape (js/gfx/base_render.js) num Chromium real (Playwright), sem servidor (file://):
   gera uma página de teste na pasta de saída que carrega core/i18n/data/sim (ordem de index.html) + color.js +
   base_render.js e desenha: a base inicial de OV.Campaign.newCampaign (cursor e seleção), uma base completa de
   fim de jogo (todas as instalações, 4 naves, alienígenas em contenção), obras em vários estados, fantasmas
   válido/inválido/fora da grelha, desmantelar, realce por tipo, ícones de instalações e naves e uma tira de
   fotogramas da animação. Verifica: sem erros de consola/página, a animação muda píxeis, a imagem estática não
   muda entre fotogramas fora das zonas animadas, cellAt/layout coerentes e tempo de desenho por fotograma.
   Uso: node ovni-1999/qa/base_check.mjs [--out <pasta>] [--dpr 1|2] [--cell 72]. */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const load = require('../tools/load.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION_QA = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad/ui4';
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION_QA) ? path.join(SESSION_QA, 'base') : path.join(process.cwd(), 'qa-out', 'base'));
const OUT = path.resolve(arg('out', DEF_OUT));
const DPR = +arg('dpr', 2);
const CELL = +arg('cell', 72);
fs.mkdirSync(OUT, { recursive: true });

const scripts = load.nodeFiles({ extra: ['js/gfx/base_render.js'] });
const tags = scripts.map((f) => '<script src="' + pathToFileURL(path.join(ROOT, f)).href + '"></script>').join('\n');

// ---- página de teste (corre no browser) -----------------------------------------------------------------
const PAGE_JS = String.raw`
(function () {
  'use strict';
  const BR = OV.BaseRender;
  const CELL = +new URLSearchParams(location.search).get('cell') || 72;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (OV.Data && OV.Data.finalize && !OV.Data._finalized) { try { OV.Data.finalize(); } catch (e) { /* já finalizado */ } }
  const G = OV.Campaign.newCampaign({ seed: 7 });
  const start = G.bases[0];

  function scene(id, title, w, h, paint) {
    const wrap = document.createElement('div');
    wrap.className = 'scene';
    wrap.id = id;
    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = title;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    wrap.appendChild(lab);
    wrap.appendChild(c);
    document.getElementById('root').appendChild(wrap);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d141c';
    ctx.fillRect(0, 0, w, h);
    paint(ctx, w, h, c);
    return c;
  }
  const S = 6 * CELL + 32;

  // 1) base inicial
  const startCrafts = start.crafts.map((id) => G.crafts[id]);
  scene('start', 'Base inicial (newCampaign) — cursor na oficina, seleção no laboratório', S, S, (ctx) => {
    BR.draw(ctx, start, { x: 16, y: 16, cell: CELL, dpr, time: 1.3, G, hover: { x: 4, y: 3 }, selection: { x: 3, y: 3 } });
  });

  // 2) base completa de fim de jogo
  const F = (type, x, y, daysLeft) => ({ type, x, y, daysLeft: daysLeft || 0 });
  const late = JSON.parse(JSON.stringify(start));
  late.grid = [
    F('hangar', 0, 0), F('hangar', 2, 0), F('hangar', 4, 0),
    F('large_radar', 0, 2), F('laboratory', 1, 2), F('access_lift', 2, 2), F('living_quarters', 3, 2), F('living_quarters', 4, 2), F('hyper_wave_decoder', 5, 2),
    F('alien_containment', 0, 3), F('laboratory', 1, 3), F('workshop', 2, 3), F('workshop', 3, 3), F('general_stores', 4, 3), F('psi_lab', 5, 3),
    F('hangar', 0, 4), F('laser_defence', 2, 4), F('plasma_defence', 3, 4), F('grav_shield', 4, 4), F('mind_shield', 5, 4),
    F('fusion_defence', 2, 5), F('missile_defence', 3, 5), F('small_radar', 4, 5), F('general_stores', 5, 5),
  ];
  late.crafts = ['k1', 'k2', 'k3', 'k4'];
  late.aliens = { sectoid_soldier: 3, muton_soldier: 2, ethereal_commander: 1 };
  const lateCrafts = [{ type: 'avenger', status: 'ready' }, { type: 'firestorm', status: 'refuel' }, { type: 'interceptor', status: 'repair' }, { type: 'skyranger', status: 'ready' }];
  scene('late', 'Base de fim de jogo — todas as instalações, 4 naves, 6 alienígenas', S, S, (ctx) => {
    BR.draw(ctx, late, { x: 16, y: 16, cell: CELL, dpr, time: 2.7, crafts: lateCrafts });
  });

  // 3) obras
  const build = JSON.parse(JSON.stringify(start));
  build.grid.push(F('hangar', 0, 0, 9), F('laboratory', 1, 2, 9), F('living_quarters', 4, 2, 3), F('alien_containment', 5, 3, 1), F('large_radar', 4, 1, 5), F('general_stores', 2, 5, 2));
  scene('build', 'Obras: hangar 9 d, laboratório 9 d, radar grande 5 d, alojamentos 3 d, armazém 2 d, contenção 1 d', S, S, (ctx) => {
    BR.draw(ctx, build, { x: 16, y: 16, cell: CELL, dpr, time: 0.2, G });
  });

  // 4) fantasmas e desmantelar
  const W2 = S * 2 + 16;
  scene('ghost', 'Fantasma válido (hangar 0,0) | inválido (laboratório 5,0) + desmantelar oficina e elevador (recusado)', W2, S, (ctx) => {
    BR.draw(ctx, start, { x: 16, y: 16, cell: CELL, dpr, time: 0.4, G, hover: { x: 0, y: 0 }, ghost: { type: 'hangar', x: 0, y: 0, valid: true } });
    BR.draw(ctx, start, { x: S + 16, y: 16, cell: CELL, dpr, time: 0.4, G, ghost: { type: 'laboratory', x: 5, y: 0, valid: false }, dismantle: { x: 4, y: 3 } });
  });
  scene('ghost2', 'Fantasma fora da grelha (hangar 5,1) | desmantelar recusado (elevador) + realce de laboratórios', W2, S, (ctx) => {
    BR.draw(ctx, start, { x: 16, y: 16, cell: CELL, dpr, time: 0.9, G, ghost: { type: 'hangar', x: 5, y: 1, valid: false } });
    BR.draw(ctx, late, { x: S + 16, y: 16, cell: CELL, dpr, time: 0.9, crafts: lateCrafts, dismantle: { x: 2, y: 2, ok: false }, highlight: 'laboratory' });
  });

  // 5) ícones
  const types = BR.TYPES;
  const crafts = Object.keys(OV.Data.crafts).concat(['objeto_desconhecido']);
  const IW = 16 + (types.length) * 104;
  scene('icons', 'Ícones: instalações (96 e 48 px) e naves', Math.max(IW, 600), 96 + 48 + 96 + 64, (ctx) => {
    types.forEach((t, k) => {
      ctx.drawImage(BR.facilityIcon(t, 96, dpr), 16 + k * 104, 8, 96, 96);
      ctx.drawImage(BR.facilityIcon(t, 48, dpr), 16 + k * 104 + 24, 112, 48, 48);
    });
    crafts.forEach((t, k) => {
      ctx.drawImage(BR.craftIcon(t, 96, dpr), 16 + k * 120, 172, 96, 96);
      ctx.drawImage(BR.craftIcon(t, 40, dpr), 16 + k * 120 + 96, 228, 40, 40);
    });
  });

  // 6) tira de animação: o mesmo recorte em 6 instantes
  scene('anim', 'Animação — fim de jogo em t = 0, 0,4, 0,8, 1,2, 1,6, 2,0 s (recorte 3×2 células)', 6 * (3 * CELL + 8) + 8, 2 * CELL + 16, (ctx) => {
    for (let k = 0; k < 6; k++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(8 + k * (3 * CELL + 8), 8, 3 * CELL, 2 * CELL);
      ctx.clip();
      BR.draw(ctx, late, { x: 8 + k * (3 * CELL + 8) - 3 * CELL, y: 8 - 2 * CELL, cell: CELL, dpr, time: k * 0.4, crafts: lateCrafts });
      ctx.restore();
    }
  });

  // ---- verificações numéricas ------------------------------------------------------------------------------
  const info = { checks: [] };
  const ok = (c, m) => info.checks.push((c ? 'ok ' : 'FALHA ') + m);
  function frame(base, t, extra) {
    const c = document.createElement('canvas');
    c.width = (6 * CELL + 32) * dpr;
    c.height = c.width;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BR.draw(ctx, base, Object.assign({ x: 16, y: 16, cell: CELL, dpr, time: t }, extra));
    return ctx.getImageData(0, 0, c.width, c.height).data;
  }
  function diff(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
    return n / (a.length / 4);
  }
  const f0 = frame(late, 0, { crafts: lateCrafts }), f1 = frame(late, 0.9, { crafts: lateCrafts }), f0b = frame(late, 0, { crafts: lateCrafts });
  const d01 = diff(f0, f1);
  info.animDiff = +(d01 * 100).toFixed(2);
  ok(d01 > 0.004 && d01 < 0.2, 'animação muda ' + info.animDiff + ' % dos píxeis (subtil, > 0,4 % e < 20 %)');
  ok(diff(f0, f0b) === 0, 'mesmo instante ⇒ mesma imagem');
  // a camada estática não depende do tempo: sem animação (instalações estáticas) a imagem é igual
  const calm = { grid: [{ type: 'access_lift', x: 2, y: 2, daysLeft: 0 }], crafts: [] };
  ok(BR.animated(late) && BR.animated(calm), 'animated()');
  // cellAt / layout
  const L = BR.layout(800, 600);
  ok(L.cell === Math.floor((600 - 24) / 6) && L.x >= 0 && L.y >= 0, 'layout ' + JSON.stringify(L));
  const v = { x: 16, y: 16, cell: CELL };
  ok(JSON.stringify(BR.cellAt(v, 16, 16)) === '{"x":0,"y":0}', 'cellAt canto');
  ok(JSON.stringify(BR.cellAt(v, 16 + 6 * CELL - 1, 16 + 6 * CELL - 1)) === '{"x":5,"y":5}', 'cellAt último');
  ok(BR.cellAt(v, 15, 40) === null && BR.cellAt(v, 16 + 6 * CELL, 40) === null, 'cellAt fora');
  const slots = BR.hangarSlots(start, { G });
  ok(slots.length === 3 && slots[0].craft.type === 'skyranger' && slots[1].craft.type === 'interceptor', 'hangarSlots base inicial');
  // desempenho: fotograma com a camada estática em cache
  const c = document.createElement('canvas');
  c.width = (6 * CELL + 32) * dpr;
  c.height = c.width;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  BR.draw(ctx, late, { x: 16, y: 16, cell: CELL, dpr, time: 0, crafts: lateCrafts });
  const t0 = performance.now();
  const N = 40;
  for (let k = 0; k < N; k++) BR.draw(ctx, late, { x: 16, y: 16, cell: CELL, dpr, time: k / 20, crafts: lateCrafts, hover: { x: k % 6, y: 2 } });
  info.frameMs = +((performance.now() - t0) / N).toFixed(2);
  BR.clearCache();
  const t1 = performance.now();
  BR.draw(ctx, late, { x: 16, y: 16, cell: CELL, dpr, time: 0, crafts: lateCrafts });
  info.coldMs = +(performance.now() - t1).toFixed(1);
  info.stats = BR.stats();
  // base não alterada
  const before = JSON.stringify(start);
  BR.draw(ctx, start, { x: 16, y: 16, cell: CELL, dpr, time: 3, G, ghost: { type: 'hangar', x: 0, y: 0, valid: true } });
  ok(JSON.stringify(start) === before, 'draw não altera a base');
  window.__info = info;
  window.__done = true;
})();`;

const html = `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><title>Basescape — QA</title>
<style>
  html, body { margin: 0; background: #05080c; color: #dbe6ef; font: 12px -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  #root { display: flex; flex-direction: column; gap: 14px; padding: 12px; align-items: flex-start; }
  .scene { background: #0d141c; border: 1px solid #22344a; padding: 6px; }
  .lab { color: #ffb53d; font-weight: 700; letter-spacing: 1px; margin: 2px 4px 6px; }
  #err { color: #ff6a5a; white-space: pre; }
</style></head><body>
<div id="err"></div><div id="root"></div>
<script>window.addEventListener('error', (e) => { document.getElementById('err').textContent += (e.message || e) + '\\n'; });</script>
${tags}
<script>${PAGE_JS}</script>
</body></html>`;
const PAGE = path.join(OUT, 'base_check.html');
fs.writeFileSync(PAGE, html);

const errors = [];
const browser = await chromium.launch();
let info = null;
try {
  const ctx = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(PAGE).href + '?cell=' + CELL);
  await page.waitForFunction(() => window.__done === true || document.getElementById('err').textContent, null, { timeout: 60000 })
    .catch(() => errors.push('a página não terminou'));
  const err = await page.evaluate(() => document.getElementById('err').textContent);
  if (err) errors.push(err.trim());
  info = await page.evaluate(() => window.__info || null);
  for (const id of ['start', 'late', 'build', 'ghost', 'ghost2', 'icons', 'anim']) {
    const el = await page.$('#' + id);
    if (el) await el.screenshot({ path: path.join(OUT, id + '.png') });
    else errors.push('cena em falta: ' + id);
  }
  await ctx.close();
} finally {
  await browser.close();
}
if (info) {
  for (const c of info.checks) {
    console.log((c.startsWith('ok') ? '✓ ' : '✗ ') + c);
    if (!c.startsWith('ok')) errors.push(c);
  }
  console.log('  fotograma (cache quente): ' + info.frameMs + ' ms; primeiro desenho a frio: ' + info.coldMs + ' ms; cache ' + JSON.stringify(info.stats));
}
for (const e of errors) console.log('✗ ' + e);
console.log(errors.length ? '✗ ' + errors.length + ' erro(s)' : '✓ sem erros; capturas em ' + OUT);
process.exit(errors.length ? 1 : 0);
