/* Playtest da campanha inteira pela interface, como um jogador num Mac (rato/trackpad + teclado) ou num iPad (toques):
   menu → «Nova Campanha» → Veterano → base em Lisboa → «Fundar base» → Geoscape (gestos de trackpad) → base (B):
   contratar cientistas, «Armas Laser», laboratório, equipar o Skyranger → Esc → tempo (teclas 1–6) até um OVNI →
   «Intercetar» → combate (só canhão contra batedor pequeno, Agressivo) → «Enviar equipa» → chegada → «Iniciar missão» →
   briefing → «Equipar» → batalha jogada com cliques e teclas (turnos alienígenas acelerados com Espaço; > N turnos ⇒
   «Abortar» e fica registado) → relatório da missão → Geoscape → material recuperado no armazém → investigação
   concluída → Ufopédia → local de terror (deixado expirar ou respondido) → relatório mensal de janeiro → «Gravar» na
   ranhura 1 → recarregar a página → «Continuar» → data/fundos/base/investigação idênticos.
   O estado (OV.Game, OV.GeoUI.current(), OV.BaseUI.debug, OV.BattleUI.debug) só é LIDO para decidir onde clicar.
   Capturas e registo com marcas de tempo (log.txt; esperas em tempo real; momentos confusos) na pasta de saída.
   Falha com erros de consola/página, chaves ⟦em falta⟧, estados presos ou o jogo carregado diferente do gravado.
   Uso: node ovni-1999/qa/full_campaign.mjs [--out <pasta>] [--vw 1440 --vh 900] [--dpr 2] [--touch] [--seed 4242]
        [--turns 25] [--terror expire|respond] [--max-min 40] [--headed] */
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'campaign')
  : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'campaign') : path.join(process.cwd(), 'qa-out', 'campaign');
const OUT = path.resolve(arg('out', DEF_OUT));
const TOUCH = argv.includes('--touch');
const VW = +arg('vw', TOUCH ? 1180 : 1440), VH = +arg('vh', TOUCH ? 820 : 900), DPR = +arg('dpr', 2);
const SEED = arg('seed', '314');
const MAX_TURNS = +arg('turns', TOUCH ? 3 : 25);
const TERROR = arg('terror', 'expire');
const MAX_MS = +arg('max-min', 40) * 60000;
const ALIEN_TURN_SLOW_MS = 30000;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
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
for (const f of fs.readdirSync(OUT)) if (/\.(png|txt)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const URL0 = 'http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1';
const errors = [], fails = [], lines = [], confusing = [], timings = [];
const T0 = Date.now();
let browser, ctx, page, cdp, shotN = 0, tag = '';

const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(7) + 's';
function note(msg) {
  const l = stamp() + ' ' + (tag ? '[' + tag + '] ' : '') + msg;
  lines.push(l);
  console.log(l);
}
function check(ok, msg) {
  note((ok ? '✓ ' : '✗ ') + msg);
  if (!ok) fails.push((tag ? tag + ': ' : '') + msg);
  return ok;
}
function confuse(msg) {
  confusing.push(msg);
  note('?? CONFUSO: ' + msg);
}
async function shot(name) {
  shotN++;
  const f = String(shotN).padStart(3, '0') + '_' + name + '.png';
  try { await page.screenshot({ path: path.join(OUT, f) }); } catch (e) { note('captura falhou: ' + e.message); }
  return f;
}
const sleep = (ms) => page.waitForTimeout(ms);
// espera cronometrada: regista quanto tempo real demorou
async function timed(label, fn) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  timings.push([label, ms]);
  note('⏱ ' + label + ': ' + (ms / 1000).toFixed(1) + ' s');
  return r;
}
async function until(pred, ms, what, arg0) {
  try {
    await page.waitForFunction(pred, arg0 === undefined ? null : arg0, { timeout: ms, polling: 120 });
    return true;
  } catch (e) {
    check(false, 'à espera de: ' + what + ' (' + (ms / 1000) + ' s)');
    await shot('stuck_' + what.replace(/\W+/g, '_').slice(0, 30));
    return false;
  }
}
const topScene = () => page.evaluate(() => (OV.Scenes.top() ? OV.Scenes.top().id : null));
const gameDate = () => page.evaluate(() => (OV.Game.G ? OV.U.fmtDate(OV.Game.G.t) : '—'));

// ---- entrada: clique de rato ou toque ---------------------------------------------------------------------------
async function press(locator) {
  const l = locator.first();
  if (TOUCH) await l.tap();
  else await l.click();
}
async function pointAt(x, y, o) {
  if (TOUCH) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y, o);
}
async function key(k) {
  await page.keyboard.press(k);
}
// gestos de dois dedos / toque longo no iPad (CDP)
async function touchSeq(seq) {
  for (const s of seq) {
    await cdp.send('Input.dispatchTouchEvent', { type: s.type, touchPoints: (s.pts || []).map((p, i) => ({ x: p[0], y: p[1], id: i })) });
    if (s.wait) await sleep(s.wait);
  }
}
async function longPress(x, y) {
  await touchSeq([{ type: 'touchStart', pts: [[x, y]], wait: 750 }, { type: 'touchEnd', pts: [] }]);
}
async function pinch(cx, cy, from, to) {
  const steps = 8;
  const seq = [{ type: 'touchStart', pts: [[cx - from, cy], [cx + from, cy]], wait: 30 }];
  for (let k = 1; k <= steps; k++) {
    const d = from + ((to - from) * k) / steps;
    seq.push({ type: 'touchMove', pts: [[cx - d, cy], [cx + d, cy]], wait: 30 });
  }
  seq.push({ type: 'touchEnd', pts: [] });
  await touchSeq(seq);
}
async function twoFingerPan(cx, cy, dx, dy) {
  const steps = 8;
  const seq = [{ type: 'touchStart', pts: [[cx - 40, cy], [cx + 40, cy]], wait: 30 }];
  for (let k = 1; k <= steps; k++) seq.push({ type: 'touchMove', pts: [[cx - 40 + (dx * k) / steps, cy + (dy * k) / steps], [cx + 40 + (dx * k) / steps, cy + (dy * k) / steps]], wait: 30 });
  seq.push({ type: 'touchEnd', pts: [] });
  await touchSeq(seq);
}
// trackpad do Mac: dois dedos = roda contínua em píxeis; pinça = ctrl+roda
async function trackpadScroll(x, y, dx, dy, n) {
  await page.mouse.move(x, y);
  for (let k = 0; k < (n || 6); k++) { await page.mouse.wheel(dx, dy); await sleep(16); }
}
async function trackpadPinch(x, y, dy, n) {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let k = 0; k < (n || 6); k++) { await page.mouse.wheel(0, dy); await sleep(16); }
  await page.keyboard.up('Control');
}

// ---- verificações transversais -------------------------------------------------------------------------------------
async function missingKeys(where) {
  const r = await page.evaluate(() => {
    const vis = document.body.innerText.match(/⟦[^⟧]*⟧/g) || [];
    return vis.concat([...(OV.T.missing || [])].filter((k) => k !== 'nao.existe.x'));
  });
  const uniq = [...new Set(r)];
  if (uniq.length) check(false, where + ': chaves em falta ' + uniq.join(', '));
}
async function overflow(where) {
  const r = await page.evaluate(() => {
    const out = [];
    const d = document.documentElement;
    if (d.scrollWidth > innerWidth + 1) out.push('deslocação horizontal da página ' + d.scrollWidth + '>' + innerWidth);
    for (const n of document.querySelectorAll('#hud .btn, #hud button, #modals button')) {
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(n).visibility === 'hidden') continue;
      if (b.right > innerWidth + 2 || b.bottom > innerHeight + 2 || b.left < -2 || b.top < -2) out.push('botão fora do ecrã: «' + (n.textContent || '').trim().slice(0, 30) + '»');
    }
    return out.slice(0, 6);
  });
  for (const m of r) confuse(where + ': ' + m);
}
async function smallTargets(where) {
  if (!TOUCH) return;
  const r = await page.evaluate(() => [...document.querySelectorAll('#hud button, #modals button')].filter((n) => {
    const b = n.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(n).visibility !== 'hidden' && (b.height < 31.5 || b.width < 31.5);
  }).map((n) => (n.getAttribute('aria-label') || n.textContent || n.className).trim().slice(0, 24)).slice(0, 8));
  if (r.length) confuse(where + ': alvos de toque < 32 px: ' + r.join(' | '));
}
async function watchToasts() {
  await page.evaluate(() => {
    if (window.__qaToasts) return;
    window.__qaToasts = [];
    const host = document.getElementById('toasts');
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.textContent) window.__qaToasts.push(n.textContent.trim());
    }).observe(host, { childList: true });
  });
}
async function flushToasts() {
  const list = await page.evaluate(() => { const l = window.__qaToasts || []; window.__qaToasts = []; return l; });
  if (list.length) note('  avisos: ' + list.map((t) => '«' + t + '»').join(' '));
}

// ============================================================================================================
// 1. Menu → nova campanha → base em Lisboa
// ============================================================================================================
async function newCampaign() {
  tag = 'nova';
  await until(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', 20000, 'menu principal');
  await sleep(500);
  await watchToasts();
  await shot('menu');
  await press(page.locator('.scr-mi[data-id="new"]'));
  await until(() => OV.Scenes.top().id === 'newgame', 5000, 'cena nova campanha');
  await sleep(300);
  await press(page.locator('.cp-diff.d1'));
  await page.locator('.cp-seed').fill(SEED);
  await shot('newgame_difficulty');
  const diff = await page.evaluate(() => OV.CampaignUI.debug.newgame().diff);
  check(diff === 1, 'Veterano escolhido (' + diff + ')');
  await press(page.locator('.cp-ng-diff .btn.primary'));
  await until(() => OV.CampaignUI.debug.newgame().step === 'place', 5000, 'passo «local da base»');
  await timed('globo da colocação pronto', () => sleep(1100));
  // gestos: trackpad (dois dedos roda o globo, pinça amplia) ou toque (dois dedos, pinça)
  const v0 = await page.evaluate(() => OV.CampaignUI.debug.newgame().view);
  const gx = (v0.cx || VW / 2), gy = (v0.cy || VH / 2);
  if (TOUCH) { await twoFingerPan(gx, gy, 60, 20); await pinch(gx, gy, 60, 110); }
  else { await trackpadScroll(gx, gy, 18, 6, 6); await trackpadPinch(gx, gy, -8, 6); }
  await sleep(400);
  const v1 = await page.evaluate(() => OV.CampaignUI.debug.newgame().view);
  check(Math.abs(v1.lon - v0.lon) + Math.abs(v1.lat - v0.lat) > 0.5, 'gesto de dois dedos roda o globo (' + v0.lon.toFixed(1) + '→' + v1.lon.toFixed(1) + ')');
  check(v1.zoom > v0.zoom + 0.05, 'pinça amplia (' + v0.zoom.toFixed(2) + '→' + v1.zoom.toFixed(2) + ')');
  // centra em Lisboa (C) e clica em cima de Lisboa
  await key('c');
  await sleep(1000);
  const p = await page.evaluate(() => {
    const d = OV.CampaignUI.debug.newgame();
    const v = Object.assign({}, d.view, { time: performance.now() });
    const q = OV.GlobeRender.project(v, -9.14, 38.72);
    return q.front ? { x: q.x, y: q.y } : null;
  });
  if (!check(!!p, 'Lisboa visível no globo')) return false;
  const free = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id === 'view'; }, [p.x, p.y]);
  if (!free) confuse('Lisboa fica tapada pelo painel na colocação da base');
  await pointAt(p.x, p.y);
  await sleep(300);
  const ng = await page.evaluate(() => OV.CampaignUI.debug.newgame());
  check(Math.abs(ng.chosen.lon + 9.14) < 1.5 && Math.abs(ng.chosen.lat - 38.72) < 1.5, 'local escolhido em Lisboa (' + ng.chosen.lon + ', ' + ng.chosen.lat + ') · nome «' + ng.name + '»');
  await shot('newgame_place_lisbon');
  await missingKeys('nova campanha');
  await overflow('nova campanha');
  await smallTargets('nova campanha');
  await timed('«Fundar base» → Geoscape', async () => {
    await press(page.locator('.cp-ng-side .btn.primary'));
    await until(() => OV.Scenes.top() && OV.Scenes.top().id === 'geoscape', 15000, 'Geoscape');
  });
  const g = await page.evaluate(() => ({ seed: OV.Game.G.seed, diff: OV.Game.G.difficulty, base: OV.Game.G.bases[0].name, lon: OV.Game.G.bases[0].lon, lat: OV.Game.G.bases[0].lat }));
  check(g.diff === 1, 'campanha em Veterano, semente ' + g.seed + ', base «' + (g.base || 'Base Lusitânia') + '» em ' + g.lon.toFixed(2) + ', ' + g.lat.toFixed(2));
  await sleep(700);
  return true;
}

// ============================================================================================================
// 2. Geoscape: leitura do estado e reações
// ============================================================================================================
const gs = () => page.evaluate(() => {
  const top = OV.Scenes.top();
  const c = OV.GeoUI.current();
  const G = OV.Game.G;
  return Object.assign({ top: top ? top.id : null, stack: OV.Scenes.stack.map((s) => s.id), date: G ? OV.U.fmtDate(G.t) : '', gt: G ? G.t : 0, month: G ? G.month : 0 }, c || {});
});
async function popupText() {
  return page.evaluate(() => { const n = document.querySelector('.geo-pop:not(.out)'); return n ? n.innerText.replace(/\s+/g, ' ').trim() : ''; });
}
async function popBtn(label) {
  const b = page.locator('.geo-pop:not(.out) .geo-pop-a button', { hasText: label });
  if (!(await b.count())) return false;
  await press(b);
  await sleep(250);
  return true;
}
async function setSpeed(k) {
  const s = await gs();
  if (s.top !== 'geoscape' || s.speed === k - 1 && !s.paused) return;
  // ora tecla, ora botão (como um jogador)
  if (TOUCH || (k + shotN) % 3 === 0) await press(page.locator('.geo-speeds .geo-sp').nth(k - 1));
  else await key(String(k));
}

const goal = {
  intro: false, base: false, intercept: 0, dogfightWon: false, crashed: null, teamSent: false, battle: false,
  stores: false, research: false, ufopaedia: false, newProject: false, terror: null, terrorDone: false, month: false,
  sciAssigned: false, seen: new Set(),
};
const popupShots = new Set();

// ---- base: contratar, investigar, construir, equipar ---------------------------------------------------------------
async function baseTab(n) {
  if (TOUCH) await press(page.locator('.bsc-tab').nth(n - 1));
  else await key(String(n));
  await sleep(250);
}
async function setupBase() {
  tag = 'base';
  await timed('abrir a base (B)', async () => {
    if (TOUCH) await press(page.locator('.geo-acts .btn', { hasText: 'Bases' }));
    else await key('b');
    await until(() => OV.BaseUI.isOpen() && OV.BaseUI.debug.state().layout, 8000, 'Basescape');
  });
  await sleep(400);
  await shot('base_open');
  // contratar 5 cientistas
  await baseTab(4);
  const d0 = await page.evaluate(() => OV.Game.G.bases[0].deliveries.length);
  await press(page.locator('[data-hire="scientist"][data-n="5"]'));
  await sleep(250);
  const d1 = await page.evaluate(() => OV.Game.G.bases[0].deliveries.filter((d) => d.kind === 'scientist').map((d) => d.n));
  check(d1.indexOf(5) >= 0, '5 cientistas contratados (chegam em 48 h); entregas ' + d0 + '→' + (d0 + d1.length));
  await shot('base_hire');
  // investigação: «Armas Laser»
  await baseTab(2);
  await press(page.locator('[data-act="newResearch"]'));
  await until(() => !!document.querySelector('.bsc-sheet [data-start]'), 4000, 'escolha de investigação');
  await shot('base_research_picker');
  const laser = page.locator('.bsc-sheet [data-start="laser_weapons"]');
  if (!(await laser.count())) { confuse('«Armas Laser» não aparece na lista de investigação'); await key('Escape'); }
  else {
    await press(laser);
    await sleep(250);
    const r = await page.evaluate(() => OV.Game.G.bases[0].research.map((p) => p.topic + ':' + p.scientists));
    check(r.some((x) => x.startsWith('laser_weapons:')), '«Armas Laser» em curso: ' + r.join(', '));
  }
  await shot('base_research');
  // laboratório numa célula livre e ligada
  await baseTab(1);
  await press(page.locator('[data-fac="laboratory"]'));
  await sleep(200);
  const cell = await page.evaluate(() => {
    const G = OV.Game.G;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (OV.BaseSim.canPlace(G, 'b1', 'laboratory', x, y) === null) return { x, y };
    return null;
  });
  if (check(!!cell, 'há uma célula válida para o laboratório')) {
    const p = await page.evaluate(([x, y]) => OV.BaseUI.debug.cellCenter(x, y), [cell.x, cell.y]);
    if (!TOUCH) { await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(200); await shot('base_lab_ghost'); }
    const f0 = await page.evaluate(() => OV.Game.G.funds);
    await pointAt(p.x, p.y);
    await until(() => !!document.querySelector('#modals .modal .btn.primary'), 4000, 'confirmação da construção');
    await shot('base_lab_confirm');
    await press(page.locator('#modals .modal .btn.primary'));
    await sleep(300);
    const f1 = await page.evaluate(() => OV.Game.G.funds);
    const lab = await page.evaluate(([x, y]) => OV.Game.G.bases[0].grid.find((f) => f.x === x && f.y === y && f.type === 'laboratory') || null, [cell.x, cell.y]);
    check(!!lab && lab.daysLeft > 0 && f0 - f1 === 750000, 'laboratório em obras em ' + cell.x + ',' + cell.y + ' (' + (lab && lab.daysLeft) + ' dias, −$' + (f0 - f1) + ')');
  }
  // Skyranger: equipar (copiar o kit de um soldado para o pior atirador)
  await baseTab(6);
  await press(page.locator('[data-craft="c1"]'));
  await sleep(200);
  await shot('base_crafts_skyranger');
  await press(page.locator('[data-act="equip"]'));
  if (await until(() => !!document.querySelector('.bsc-equip .inv-equip'), 5000, 'ecrã «Equipar» da base')) {
    const sols = page.locator('.bsc-equip .eq-sol');
    const n = await sols.count();
    const pistol = await page.evaluate(() => {
      const G = OV.Game.G;
      const ids = G.crafts.c1.soldiers;
      return ids.findIndex((id) => G.soldiers[id].loadout.R === 'pistol');
    });
    await press(sols.nth(pistol > 0 ? 1 : 0));
    await press(page.locator('.bsc-equip [data-act="copy"]'));
    await press(sols.nth(pistol >= 0 ? pistol : n - 1));
    await sleep(150);
    const before = await page.evaluate((i) => { const G = OV.Game.G; return G.soldiers[G.crafts.c1.soldiers[i]].loadout.R; }, pistol >= 0 ? pistol : n - 1);
    await press(page.locator('.bsc-equip [data-act="paste"]'));
    await sleep(250);
    const after = await page.evaluate((i) => { const G = OV.Game.G; return G.soldiers[G.crafts.c1.soldiers[i]].loadout.R; }, pistol >= 0 ? pistol : n - 1);
    check(before !== after, 'equipamento colado no soldado da pistola (' + before + ' → ' + after + ')');
    await shot('base_equip');
    await missingKeys('equipar (base)');
    await key('Escape');
    await sleep(250);
  }
  await missingKeys('base');
  await overflow('base');
  await smallTargets('base');
  await timed('sair da base (Esc)', async () => {
    if (TOUCH) await press(page.locator('.bsc-topbtns .btn').last());
    else await key('Escape');
    await until(() => OV.Scenes.top() && OV.Scenes.top().id === 'geoscape', 5000, 'regresso ao Geoscape');
  });
  goal.base = true;
  tag = 'geo';
}

// ---- interceção -------------------------------------------------------------------------------------------------------
async function ufoInfo(ufoId) {
  return page.evaluate((id) => {
    const G = OV.Game.G;
    const u = id ? G.ufos.find((x) => x.id === id) : G.ufos.filter((x) => x.detected && x.status === 'flying').pop();
    return u ? { id: u.id, type: u.type, status: u.status, speed: u.speed, chased: Object.values(G.crafts).some((c) => c.dest && c.dest.kind === 'ufo' && c.dest.id === u.id) } : null;
  }, ufoId || null);
}
async function interceptorReady() {
  return page.evaluate(() => Object.values(OV.Game.G.crafts).some((c) => c.type === 'interceptor' && OV.World.canOrder(OV.Game.G, c.id, { kind: 'point', lon: c.lon + 1, lat: c.lat }).ok && c.status === 'ready'));
}
async function pickCraftRow(re) {
  const rows = page.locator('.geo-int .geo-row:not(:disabled)', { hasText: re });
  if (!(await rows.count())) return null;
  const name = await rows.first().locator('b').first().textContent();
  await press(rows);
  await sleep(300);
  return name;
}
async function handleDogfight() {
  tag = 'combate';
  const info = await page.evaluate(() => {
    const a = OV.DogfightUI.active()[0];
    const G = OV.Game.G;
    const u = a && G.ufos.find((x) => x.id === a.ufoId);
    return a ? { ufo: u ? u.type : '?', craft: a.craftId } : null;
  });
  note('combate aéreo: ' + JSON.stringify(info));
  await sleep(500);
  await shot('dogfight_open');
  const small = info && info.ufo === 'small_scout';
  if (small) {
    if (TOUCH) await press(page.locator('.df-wpn.s0 .df-tgl'));
    else await key('q');
    note('  Stingray desligado (Q): só canhão contra o batedor pequeno');
  }
  if (TOUCH) await press(page.locator('.df-mode.m-aggressive'));
  else await key('4');
  await sleep(300);
  const mode = await page.evaluate(() => { const a = OV.DogfightUI.active()[0]; const d = a && OV.Game.G.dogfights.find((x) => x.id === a.dogfightId); return d ? d.mode : null; });
  check(mode === 'aggressive', 'postura Agressiva (' + mode + ')');
  let shotMid = false, out = null, reArmed = false;
  await timed('combate aéreo até ao resultado', async () => {
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      const s = await page.evaluate(() => ({ top: OV.Scenes.top().id, act: OV.DogfightUI.active() }));
      if (s.top !== 'dogfight') break;
      const a = s.act[0];
      if (a && !a.over && !shotMid) {
        const d = await page.evaluate((id) => { const x = OV.Game.G.dogfights.find((q) => q.id === id); return x ? x.dist : null; }, a.dogfightId);
        if (d !== null && d < 420) { shotMid = true; await shot('dogfight_fight'); }
      }
      // o OVNI começa a fugir: volta a ligar o Stingray (melhor destruído do que escapado)
      if (a && !a.over && small && !reArmed && (await page.evaluate((id) => !!(OV.Dogfight.breakingOff && OV.Dogfight.breakingOff(OV.Game.G, id)), a.dogfightId))) {
        reArmed = true;
        if (TOUCH) await press(page.locator('.df-wpn.s0 .df-tgl'));
        else await key('q');
        note('  o OVNI está a fugir: Stingray ligado outra vez (Q)');
      }
      if (a && a.over) {
        out = a.outcome;
        await sleep(500);
        await shot('dogfight_result_' + out);
        if (TOUCH) await press(page.locator('.df-cont'));
        else await key('Enter');
        await sleep(500);
      }
      await sleep(250);
    }
  });
  note('resultado do combate: ' + out);
  goal.intercept++;
  if (out === 'crashed') goal.dogfightWon = true;
  tag = 'geo';
}

// ---- janelas do Geoscape ----------------------------------------------------------------------------------------------
async function handlePopup(s) {
  const type = s.popup;
  const txt = await popupText();
  note('janela «' + type + '» (' + s.date + '): ' + txt.slice(0, 220));
  if (!popupShots.has(type)) { popupShots.add(type); await shot('popup_' + type); await missingKeys('janela ' + type); }
  goal.seen.add(type);
  switch (type) {
    case 'intro':
      goal.intro = true;
      if (!(await popBtn('Ao trabalho'))) await key('Enter');
      return;
    case 'ufoDetected': {
      const u = await ufoInfo();
      const ready = await interceptorReady();
      // comandante novato: na 1.ª missão prefere batedores pequenos/médios (os grandes só depois de 3 alertas ou em fevereiro)
      const easy = u && (u.type === 'small_scout' || u.type === 'medium_scout' || goal.skipped >= 3 || s.month >= 1);
      if (u && u.status === 'flying' && !easy) { goal.skipped = (goal.skipped | 0) + 1; note('  ' + u.type + ': grande demais para a primeira missão, deixo passar'); }
      const want = u && easy && u.status === 'flying' && !u.chased && ready && !goal.dogfightWon && !goal.crashed && !goal.battle;
      if (want) {
        note('  OVNI ' + u.id + ' (' + u.type + ', ' + Math.round(u.speed) + ' nós) → «Intercetar»');
        await popBtn('Intercetar');
        await until(() => OV.GeoUI.current() && OV.GeoUI.current().dialog === 'intercept', 4000, 'diálogo de interceção');
        if (goal.intercept === 0) await shot('intercept_dialog');
        const name = await pickCraftRow(/Intercetor/);
        if (!name) { confuse('nenhum Intercetor disponível no diálogo apesar de haver um pronto'); await key('Escape'); return; }
        note('  lançado: ' + name);
        return;
      }
      if (u && u.status !== 'flying' && !goal.teamSent && !goal.battle) {
        if (await popBtn('Enviar equipa')) { await sendSkyranger(u.id); return; }
      }
      await popBtn('OK');
      return;
    }
    case 'ufoCrashed': {
      const u = await ufoInfo();
      goal.crashed = true;
      if (!goal.battle && !goal.teamSent) {
        note('  OVNI abatido → «Enviar equipa»');
        await popBtn('Enviar equipa');
        await sendSkyranger();
        return;
      }
      await popBtn('OK');
      return;
    }
    case 'ufoLanded': {
      if (!goal.battle && !goal.teamSent && (goal.intercept >= 2 || (await gs()).month >= 1)) {
        note('  OVNI aterrado e ainda sem missão → «Enviar equipa»');
        await popBtn('Enviar equipa');
        await sendSkyranger();
        return;
      }
      await popBtn('OK');
      return;
    }
    case 'craftArrived': {
      if (/Iniciar missão/i.test(txt)) {
        await timed('«Iniciar missão» → briefing', async () => {
          await popBtn('Iniciar missão');
          await until(() => OV.Scenes.top().id === 'cbriefing', 8000, 'briefing da campanha');
        });
        return;
      }
      // intercetor sobre um OVNI aterrado (não combate no chão): regressa
      if (await popBtn('Regressar')) return;
      await key('Enter');
      return;
    }
    case 'targetLost':
    case 'craftLowFuel':
      if (!(await popBtn('Regressar'))) await key('Enter');
      return;
    case 'researchDone':
      if (!goal.ufopaedia) {
        goal.research = true;
        await timed('«Ver Ufopédia»', async () => {
          await popBtn('Ver Ufopédia');
          await until(() => OV.Scenes.top().id === 'ufopaedia', 5000, 'Ufopédia');
        });
        await sleep(600);
        await shot('ufopaedia_article');
        await missingKeys('Ufopédia');
        const art = await page.evaluate(() => { const h = document.querySelector('.scr-ufopaedia h1, .scr-ufopaedia .up-title'); return h ? h.textContent : ''; });
        note('  artigo aberto: «' + art + '»');
        goal.ufopaedia = true;
        if (TOUCH) await press(page.locator('.scr-ufopaedia .btn', { hasText: /Voltar|Fechar/ }));
        else await key('Escape');
        await until(() => OV.Scenes.top().id === 'geoscape', 5000, 'regresso da Ufopédia');
        return;
      }
      if (!goal.newProject) {
        goal.newProject = true;
        await popBtn('Novo projeto');
        if (await until(() => OV.Scenes.top().id === 'basescape', 5000, 'base em «Investigação»')) {
          await sleep(400);
          const picker = await page.locator('.bsc-sheet [data-start]').count();
          if (!picker) confuse('«Novo projeto» abriu a base sem a lista de projetos');
          else {
            await shot('base_new_project');
            const topic = await page.locator('.bsc-sheet [data-start]').first().getAttribute('data-start');
            await press(page.locator('.bsc-sheet [data-start]').first());
            note('  novo projeto: ' + topic);
          }
          await sleep(200);
          await key('Escape');
          await sleep(200);
          if ((await topScene()) === 'basescape') await key('Escape');
          await until(() => OV.Scenes.top().id === 'geoscape', 5000, 'regresso da base');
        }
        return;
      }
      await popBtn('OK');
      return;
    case 'deliveryArrived':
      if (/cientista/i.test(txt) && !goal.sciAssigned) {
        goal.sciAssigned = true;
        await popBtn('Ir para a base');
        if (await until(() => OV.Scenes.top().id === 'basescape', 5000, 'base (pessoal)')) {
          await baseTab(2);
          const all = page.locator('.bsc-proj .bsc-stepper .btn', { hasText: 'Todos' });
          if (await all.count()) {
            const before = await page.evaluate(() => OV.BaseSim.staff(OV.Game.G, 'b1').scientists.free);
            await press(all);
            await sleep(200);
            const after = await page.evaluate(() => OV.BaseSim.staff(OV.Game.G, 'b1').scientists.free);
            check(after < before || before === 0, 'cientistas novos postos a trabalhar («Todos»): livres ' + before + '→' + after);
            await shot('base_scientists_assigned');
          } else {
            const pick = page.locator('[data-act="newResearch"]');
            if (await pick.count()) {
              await press(pick);
              await sleep(300);
              if (await page.locator('.bsc-sheet [data-start]').count()) await press(page.locator('.bsc-sheet [data-start]').first());
              note('  sem projeto em curso: novo projeto com os cientistas novos');
            }
          }
          await key('Escape');
          await sleep(200);
          if ((await topScene()) === 'basescape') await key('Escape');
          await until(() => OV.Scenes.top().id === 'geoscape', 5000, 'regresso da base');
        }
        return;
      }
      await popBtn('OK');
      return;
    case 'terrorSite': {
      goal.terror = goal.terror || 'appeared';
      const can = await page.evaluate(() => { const c = OV.Game.G.crafts.c1; return !!c && c.status === 'ready'; });
      if (TERROR === 'respond' && can && goal.battle) {
        note('  terror: respondo com o Skyranger');
        await popBtn('Enviar equipa');
        await sendSkyranger();
        goal.terror = 'responded';
        return;
      }
      note('  terror: sem resposta (fica a expirar)');
      await popBtn('OK');
      return;
    }
    case 'terrorSiteExpired':
      goal.terrorDone = true;
      goal.terror = goal.terror || 'appeared';
      await popBtn('OK');
      return;
    case 'gameOver':
      check(false, 'fim de jogo inesperado: ' + txt);
      return;
    default:
      if (!(await popBtn('OK'))) await key('Enter');
  }
}
async function sendSkyranger(ufoId) {
  await until(() => OV.GeoUI.current() && OV.GeoUI.current().dialog === 'intercept', 4000, 'diálogo «Enviar equipa»');
  await shot('send_team');
  const name = await pickCraftRow(/Skyranger/);
  if (!name) {
    const why = await page.evaluate(() => [...document.querySelectorAll('.geo-int .geo-row')].map((b) => b.innerText.replace(/\s+/g, ' ')).join(' | '));
    confuse('Skyranger não disponível para enviar a equipa: ' + why);
    await key('Escape');
    return false;
  }
  goal.teamSent = true;
  note('  equipa a caminho: ' + name + (ufoId ? ' → ' + ufoId : ''));
  return true;
}

// ============================================================================================================
// 3. Briefing, equipar e batalha (lógica de full_battle.mjs)
// ============================================================================================================
async function briefing() {
  tag = 'missão';
  await sleep(500);
  await shot('briefing');
  await missingKeys('briefing');
  await overflow('briefing');
  const txt = await page.evaluate(() => document.querySelector('.cp-brief').innerText.replace(/\s+/g, ' ').slice(0, 300));
  note('briefing: ' + txt);
  await press(page.locator('.cp-brief .btn', { hasText: 'Equipar' }));
  await until(() => OV.Scenes.top().id === 'equip' && !!document.querySelector('.cp-eq .eq-sol'), 6000, 'ecrã Equipar');
  await sleep(300);
  await press(page.locator('.cp-eq .eq-sol').nth(1));
  await sleep(200);
  await shot('equip');
  await missingKeys('equipar');
  await press(page.locator('.cp-eq .btn.primary', { hasText: 'Concluído' }));
  await until(() => OV.Scenes.top().id === 'cbriefing', 4000, 'regresso ao briefing');
  await timed('«Iniciar missão» → batalha jogável', async () => {
    await press(page.locator('.cp-brief .btn.primary', { hasText: 'Iniciar missão' }));
    await until(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), 40000, 'battlescape');
    await idle(60000, 'abertura');
  });
  await page.evaluate(() => { window.__qaB = OV.Game.B; });
  const m = await page.evaluate(() => ({ kind: OV.Game.B.mission.kind, ufo: OV.Game.B.mission.ufoType, night: !!OV.Game.B.mission.night, map: OV.Game.B.map.w + '×' + OV.Game.B.map.h, squad: OV.Game.B.units.filter((u) => u.origSide === 'xcom').length }));
  note('batalha: ' + JSON.stringify(m));
  return m;
}

const st = () => page.evaluate(() => (OV.BattleUI.scene && OV.BattleUI.debug.state()) || { gone: true, ended: true, visibleAliens: [] });
async function idle(ms, what) {
  try {
    await page.waitForFunction(() => {
      if (!OV.BattleUI || !OV.BattleUI.scene) return true;
      if (OV.Scenes.top() && OV.Scenes.top().id !== 'battlescape') return true;
      const s = OV.BattleUI.debug.state();
      return !!s && !s.playing && !OV.Presenter.playing;
    }, null, { timeout: ms || 60000 });
  } catch (e) {
    check(false, 'preso à espera do fim da animação (' + (what || '?') + ')');
    await shot('stuck');
    throw e;
  }
  await sleep(90);
}
const readUnit = (id) => page.evaluate((id) => {
  if (!OV.Game.B) return null;
  const u = OV.BUnits.findUnit(OV.Game.B, id);
  return u ? { id: u.id, x: u.x, y: u.y, z: u.z, tu: u.tu, hp: u.hp, status: u.status, onMap: u.onMap, name: u.name || '', kneel: !!u.kneel } : null;
}, id);
const squadIds = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'xcom' || u.origSide === 'xcom').map((u) => u.id));
const liveSquad = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'xcom' && u.onMap && u.x >= 0 && u.status === 'ok').map((u) => u.id));
const aliensLeft = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'alien' && (u.status === 'ok' || u.status === 'panic')).length);
const kitOf = (id) => page.evaluate((id) => {
  const B = OV.Game.B, u = OV.BUnits.findUnit(B, id), D = OV.Data.items;
  const all = [];
  for (const s of ['R', 'L']) if (u.items[s] !== null && u.items[s] !== undefined) all.push(u.items[s]);
  for (const s of ['belt', 'pack']) for (const i of u.items[s] || []) all.push(i);
  const items = all.map((i) => OV.BUnits.findItem(B, i)).filter(Boolean);
  const gunHand = ['R', 'L'].find((h) => { const it = OV.BUnits.findItem(B, u.items[h]); return it && D[it.type] && D[it.type].kind === 'firearm'; }) || null;
  const gun = gunHand ? OV.BUnits.findItem(B, u.items[gunHand]) : null;
  return {
    gunHand, loaded: !!(gun && gun.ammo && gun.ammo.rounds > 0),
    snapTU: gun ? OV.BUnits.actionTU(B, u, gun.id, 'snap') : 0,
    aimedTU: gun ? OV.BUnits.actionTU(B, u, gun.id, 'aimed') : 0,
    grenades: items.filter((it) => D[it.type] && D[it.type].kind === 'grenade' && D[it.type].dmg !== 'SMOKE' && !D[it.type].proximity).length,
  };
}, id);
async function onCanvas(p) {
  if (!p) return false;
  if (p.x < 8 || p.y < 8 || p.x > VW - 8 || p.y > VH - 8) return false;
  return page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && e.id === 'view'; }, [p.x, p.y]);
}
async function bringIntoView(getPoint) {
  for (let k = 0; k < 8; k++) {
    const p = await getPoint();
    if (!p) return null;
    const inner = p.x > 300 && p.x < VW - 240 && p.y > 110 && p.y < VH - 230;
    if (inner && (await onCanvas(p))) return p;
    const dx = p.x - VW / 2, dy = p.y - (VH / 2 - 60);
    const keys = [];
    if (Math.abs(dx) > 120) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    if (Math.abs(dy) > 90) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    if (!keys.length) return (await onCanvas(p)) ? p : null;
    const ms = Math.min(700, Math.max(90, (Math.max(Math.abs(dx), Math.abs(dy)) / 700) * 1000));
    for (const kk of keys) await page.keyboard.down(kk);
    await sleep(ms);
    for (const kk of keys) await page.keyboard.up(kk);
    await sleep(60);
  }
  const p = await getPoint();
  return (await onCanvas(p)) ? p : null;
}
const tilePoint = (x, y, z) => () => page.evaluate(([a, b, c]) => OV.BattleUI.debug.tileToScreen(a, b, c), [x, y, z]);
const unitPoint = (id) => () => page.evaluate((i) => OV.BattleUI.debug.unitScreen(i), id);
async function selectSoldier(id) {
  const me = await readUnit(id);
  if (!me || me.status !== 'ok' || !me.onMap) return false;
  const k = (await squadIds()).indexOf(id);
  if (k < 0) return false;
  await press(page.locator('.bs-squad .bs-sq').nth(k));
  await sleep(80);
  const s = await st();
  if (s.selectedId !== id) { check(false, 'faixa da equipa não selecionou ' + id); return false; }
  await key('c');
  await sleep(300);
  return true;
}
async function pickMoveTile(id, o) {
  return page.evaluate(([id, o]) => {
    const B = OV.Game.B, m = B.map, u = OV.BUnits.findUnit(B, id);
    const plane = m.w * m.h;
    const xyz = (i) => { const z = (i / plane) | 0, r = i - z * plane; return [r % m.w, (r / m.w) | 0, z]; };
    const R = B.ufo || { x: m.w >> 1, y: m.h >> 1, w: 1, h: 1 };
    const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
    let goal = null, gd = 1e9;
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
      const i = y * m.w + x;
      if (!m.parts[i * 4]) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < gd) { gd = d; goal = { x, y, z: 0 }; }
    }
    if (!goal) goal = { x: cx, y: cy, z: 0 };
    const fake = Object.assign({}, u, { x: goal.x, y: goal.y, z: goal.z, tu: 9999, energy: 9999, kneel: false });
    const field = OV.Path.reachable(B, fake, 9999, 9999, { units: 'none' }).cost;
    const here = (u.z * m.h + u.y) * m.w + u.x;
    const budget = Math.max(0, (u.tu | 0) - (u.kneel ? 8 : 0) - Math.max(0, o.keep | 0));
    const r = OV.Path.reachable(B, u, budget, u.energy | 0);
    const mates = B.units.filter((q) => q.side === 'xcom' && q.onMap && q.status === 'ok' && q.id !== u.id);
    let best = null, bs = 1e9;
    for (const i of r.list) {
      if (i === here || field[i] < 0 || B._.unitAt[i]) continue;
      const [x, y, z] = xyz(i);
      if (z > 0 && !o.climb) continue;
      if (field[i] >= field[here] - 2) continue;
      if (o.standoff > 0) {
        const dx = Math.max(R.x - x, 0, x - (R.x + R.w - 1)), dy = Math.max(R.y - y, 0, y - (R.y + R.h - 1));
        if (Math.max(dx, dy) < o.standoff) continue;
      }
      let near = 0;
      for (const q of mates) if (q.z === z && Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= 1) near++;
      const score = field[i] + near * 12 + r.cost[i] * 0.05;
      if (score < bs) { bs = score; best = { x, y, z }; }
    }
    return { best, hereField: field[here] };
  }, [id, o]);
}
async function moveTo(id, t, why) {
  const before = await readUnit(id);
  const p = await bringIntoView(tilePoint(t.x, t.y, t.z));
  if (!p) return false;
  if (!TOUCH) { await page.mouse.move(p.x, p.y, { steps: 3 }); await sleep(90); }
  let s = await st();
  if (!TOUCH && (!s.pathSteps)) return false;
  await pointAt(p.x, p.y);
  await sleep(80);
  s = await st();
  if (!s.playing && s.lock >= 0) { await pointAt(p.x, p.y); await sleep(80); }
  await idle(60000, 'andar');
  const after = await readUnit(id);
  if (!after) return true;
  const moved = after.x !== before.x || after.y !== before.y || after.z !== before.z;
  if (!moved && after.status === 'ok') { note('  clique em ' + t.x + ',' + t.y + ' não moveu ' + before.name); return false; }
  note('  ' + before.name + ' ' + why + ': ' + before.x + ',' + before.y + ' → ' + after.x + ',' + after.y + ' (UT ' + before.tu + '→' + after.tu + ')');
  return true;
}
async function enterMode(hand, wanted) {
  await key(hand === 'L' ? 'q' : 'e');
  await sleep(120);
  const menu = (await st()).menu;
  if (!menu || !menu.entries) return false;
  const k = menu.entries.findIndex((e) => e.label.toLowerCase().startsWith(wanted));
  if (k < 0 || !menu.entries[k].enabled) { await key('Escape'); await sleep(60); return false; }
  await key(String(k + 1));
  await sleep(100);
  return (await st()).mode === 'target';
}
const bstats = { shots: 0, kills: 0, grenades: 0, moves: 0, alienTurns: [], turns: 0 };
let grenadeUsed = false, battleShots = 0;
async function tryShoot(alien, kit) {
  for (const [mode, min] of [['tiro apontado', 38], ['tiro rápido', 30], ['rajada', 30]]) {
    if (!(await st()).unit) return false;
    if (!(await enterMode(kit.gunHand, mode))) continue;
    const p = await bringIntoView(unitPoint(alien.id));
    if (!p) { await key('Escape'); return false; }
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await sleep(140);
    const tg = (await st()).target;
    if (!tg || tg.blocked || tg.hitPct === null || tg.hitPct < min || (tg.blastR && tg.sub)) {
      await key('Escape');
      await sleep(60);
      if (tg && tg.blocked) return false;
      continue;
    }
    const a0 = await readUnit(alien.id);
    if (battleShots < 2) await shot('battle_aim');
    await page.mouse.click(p.x, p.y);
    await sleep(160);
    await idle(60000, 'disparar');
    const a1 = await readUnit(alien.id);
    const res = !a1 || a1.status === 'dead' ? 'MORTO' : a1.status === 'unconscious' ? 'inconsciente' : a1.hp < a0.hp ? 'ferido' : 'falhou';
    note('  ' + mode + ' (' + tg.label + ') → ' + res);
    bstats.shots++;
    battleShots++;
    if (res === 'MORTO') { bstats.kills++; if (bstats.kills === 1) await shot('battle_first_kill'); }
    return true;
  }
  return false;
}
async function tryGrenade(alien) {
  await key('g');
  await sleep(120);
  if ((await st()).mode !== 'throw') return false;
  const p = await bringIntoView(tilePoint(alien.x, alien.y, alien.z));
  if (!p) { await key('Escape'); return false; }
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await sleep(140);
  const s = await st();
  if (!s.throwInfo || !s.throwInfo.ok || s.throwInfo.sub) { await key('Escape'); await sleep(60); return false; }
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  await shot('battle_grenade');
  await idle(60000, 'granada');
  bstats.grenades++;
  note('  granada lançada');
  return true;
}
async function firingSpot(id, alienId, keep) {
  return page.evaluate(([id, aid, keep]) => {
    const B = OV.Game.B, m = B.map, u = OV.BUnits.findUnit(B, id), a = OV.BUnits.findUnit(B, aid);
    const plane = m.w * m.h;
    const r = OV.Path.reachable(B, u, Math.max(0, (u.tu | 0) - (u.kneel ? 8 : 0) - keep), u.energy | 0);
    const aim = OV.Combat.unitCentre(a);
    let n = 0;
    for (const i of r.list) {
      if (++n > 220) break;
      if (B._.unitAt[i]) continue;
      const z = (i / plane) | 0, rr = i - z * plane, x = rr % m.w, y = (rr / m.w) | 0;
      if (z !== u.z) continue;
      const fake = Object.assign({}, u, { x, y, z, kneel: false });
      const tr = OV.LOS.traceShot(B, OV.LOS.originVoxel(B, fake, aim), aim, u.id, 0);
      if (tr.kind === 'unit' && tr.unitId === a.id) return { x, y, z };
    }
    return null;
  }, [id, alienId, keep]);
}
async function soldierTurn(id, plan) {
  if (!(await selectSoldier(id))) return;
  let moved = false;
  for (let step = 0; step < 6; step++) {
    const s = await st();
    if (s.gone || s.ended || !s.unit) return;
    const u = await readUnit(id);
    if (!u || u.status !== 'ok' || u.tu < 4) return;
    const kit = await kitOf(id);
    const vis = s.visibleAliens.slice().sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    if (vis.length) {
      if (!kit.loaded && kit.gunHand) { await key('r'); await idle(20000, 'recarregar'); continue; }
      let acted = false;
      if (!grenadeUsed && kit.grenades && u.tu >= 20) {
        for (const a of vis.filter((q) => Math.hypot(q.x - u.x, q.y - u.y) <= 14).slice(0, 2)) {
          acted = await tryGrenade(a);
          if (acted) { grenadeUsed = true; break; }
        }
      }
      for (const a of vis) {
        if (acted || !kit.gunHand || u.tu < kit.snapTU) break;
        acted = await tryShoot(a, kit);
      }
      if (acted) continue;
      if (moved || u.tu < kit.snapTU + 8 || !kit.gunHand) return;
      const spot = await firingSpot(id, vis[0].id, kit.snapTU + 2);
      if (spot) { moved = true; await moveTo(id, spot, 'procura linha de tiro'); bstats.moves++; continue; }
      return;
    }
    if (moved) {
      if (!u.kneel && u.tu >= 4 + kit.snapTU) { await key('k'); await idle(10000, 'ajoelhar'); }
      return;
    }
    if (!plan.move) {
      if (!u.kneel && u.tu >= 4 + kit.snapTU) { await key('k'); await idle(10000, 'ajoelhar'); }
      return;
    }
    const pick = await pickMoveTile(id, { keep: kit.snapTU, standoff: plan.standoff, climb: plan.climb });
    if (!pick.best) return;
    moved = true;
    if (await moveTo(id, pick.best, 'avança')) bstats.moves++;
  }
}
async function endTurn() {
  const s0 = await st();
  const turn = s0.turn;
  const t0 = Date.now();
  if (TOUCH) await press(page.locator('.bs-end'));
  else await key('Enter');
  await sleep(250);
  if (await page.locator('#modals .modal').count()) await press(page.locator('#modals .btn.primary'));
  let held = false;
  for (let k = 0; k < 2400; k++) {
    await sleep(50);
    const s = await st();
    if (s.gone || s.ended) break;
    // acelera o turno alienígena (Espaço seguro, só enquanto o turno deles se reproduz)
    if (!TOUCH && !held && s.side === 'alien' && s.playing) { await page.keyboard.down(' '); held = true; }
    if (s.side === 'xcom' && s.turn > turn) {
      if (held) { await page.keyboard.up(' '); held = false; }
      if (!s.playing) break;
    }
    if (Date.now() - t0 > 150000) { check(false, 'turno alienígena ' + turn + ' preso há > 150 s'); await shot('alien_stuck'); break; }
  }
  if (held) await page.keyboard.up(' ');
  const ms = Date.now() - t0;
  bstats.alienTurns.push(ms);
  await flushToasts();
  note('fim do turno ' + turn + ': turno alienígena ' + (ms / 1000).toFixed(1) + ' s');
  if (ms > ALIEN_TURN_SLOW_MS) confuse('turno alienígena ' + turn + ' lento mesmo acelerado: ' + (ms / 1000).toFixed(1) + ' s');
  await idle(30000, 'início do turno');
}
async function playBattle() {
  grenadeUsed = false;
  let turnN = 0;
  while (true) {
    let s = await st();
    if (s.gone || s.ended) break;
    turnN = s.turn;
    bstats.turns = turnN;
    if (turnN > MAX_TURNS) break;
    const B = await page.evaluate(() => { const B = OV.Game.B; const sq = B.units.filter((u) => u.origSide === 'xcom'); return { alive: sq.filter((u) => u.status === 'ok' && u.onMap).length, aliens: B.units.filter((u) => u.side === 'alien' && (u.status === 'ok' || u.status === 'panic')).length }; });
    note('turno ' + turnN + ': soldados ' + B.alive + ', alienígenas ativos ' + B.aliens);
    if (turnN === 1 || turnN % 5 === 0) await shot('battle_t' + turnN);
    const ids = await liveSquad();
    const order = await squadIds();
    const fields = [];
    for (const id of ids) {
      const f = await page.evaluate((id) => {
        const B = OV.Game.B, m = B.map, q = OV.BUnits.findUnit(B, id), R = B.ufo || { x: m.w >> 1, y: m.h >> 1, w: 1, h: 1 };
        const fake = Object.assign({}, q, { x: R.x + (R.w >> 1), y: R.y + (R.h >> 1), z: 0, tu: 9999, energy: 9999, kneel: false });
        return OV.Path.reachable(B, fake, 9999, 9999, { units: 'none' }).cost[(q.z * m.h + q.y) * m.w + q.x];
      }, id);
      fields.push({ id, f: f < 0 ? 9999 : f, k: order.indexOf(id) });
    }
    const front = Math.min(...fields.map((q) => q.f));
    fields.sort((a, b) => b.f - a.f);
    const assault = turnN >= 5;
    for (const q of fields) {
      s = await st();
      if (s.gone || s.ended) break;
      await soldierTurn(q.id, { move: (q.k + turnN) % 2 === 0 || q.f > front + 40 || assault, standoff: assault ? 0 : 5, climb: assault });
    }
    await flushToasts();
    s = await st();
    if (s.gone || s.ended) break;
    if ((await aliensLeft()) === 0) break;
    if (turnN >= MAX_TURNS) break;
    await endTurn();
  }
  const s = await st();
  if (!s.gone && !s.ended) {
    note('limite de ' + MAX_TURNS + ' turnos: a batalha arrasta-se → «Abortar missão» (registado)');
    confuse('batalha passou ' + MAX_TURNS + ' turnos sem fim; abortada');
    await press(page.locator('.bs-btn.danger'));
    await sleep(300);
    await shot('battle_abort_confirm');
    await press(page.locator('#modals .btn.danger'));
  }
}
async function debrief() {
  tag = 'relatório';
  await until(() => OV.Scenes.top() && OV.Scenes.top().id === 'cdebrief', 40000, 'relatório da missão');
  await sleep(700);
  await shot('mission_debrief');
  await missingKeys('relatório da missão');
  await overflow('relatório da missão');
  const txt = await page.evaluate(() => { const r = document.querySelector('.scr-result'); const tot = document.querySelector('.scr-total'); return (r ? r.textContent : '?') + ' · ' + (tot ? tot.textContent.replace(/\s+/g, ' ') : ''); });
  note('relatório: ' + txt);
  await timed('«Continuar» → Geoscape', async () => {
    await press(page.locator('.cp-deb .btn.primary'));
    await until(() => OV.Scenes.top() && OV.Scenes.top().id === 'geoscape', 10000, 'Geoscape depois da missão');
  });
  tag = 'geo';
}
async function battleFlow() {
  const stores0 = await page.evaluate(() => Object.assign({}, OV.Game.G.bases[0].stores));
  await briefing();
  tag = 'batalha';
  await shot('battle_start');
  // opções na batalha (Esc): alienígenas mais rápidos
  if (!TOUCH) {
    await page.mouse.move(VW / 2, VH / 2);
    await key('Escape');
    if (await until(() => OV.Scenes.top().id === 'options', 5000, 'opções na batalha')) {
      const row = page.locator('.scr-orow', { has: page.locator('.scr-olabel span', { hasText: /^Movimento alienígena$/ }) });
      if (await row.count()) await row.locator('.scr-seg-b[data-v="4"]').click();
      else confuse('opção «Movimento alienígena» não encontrada');
      await press(page.locator('.scr-opts .btn.primary', { hasText: 'Fechar' }));
      await until(() => OV.Scenes.top().id === 'battlescape', 5000, 'regresso à batalha');
    }
  }
  const t0 = Date.now();
  if (TOUCH) {
    // iPad: um turno com toques (selecionar e mover), depois abortar pelo botão
    const ids = await liveSquad();
    for (const id of ids.slice(0, 2)) {
      if (!(await selectSoldier(id))) continue;
      const pick = await pickMoveTile(id, { keep: 20, standoff: 5 });
      if (pick.best) await moveTo(id, pick.best, 'avança (toque, toque de confirmação)');
    }
    await shot('battle_touch');
    note('iPad: batalha terminada pelo botão «Abortar» após o primeiro turno (registado)');
    await press(page.locator('.bs-btn.danger'));
    await sleep(300);
    await press(page.locator('#modals .btn.danger'));
  } else await playBattle();
  const res = await page.evaluate(() => { const B = window.__qaB; return B ? B.result || OV.Battle.outcome(B) : null; });
  note('resultado: ' + res + ' em ' + bstats.turns + ' turnos (' + ((Date.now() - t0) / 60000).toFixed(1) + ' min reais); tiros ' + bstats.shots + ', mortos ' + bstats.kills + ', granadas ' + bstats.grenades + '; turnos alienígenas ' + bstats.alienTurns.map((x) => (x / 1000).toFixed(1)).join('/') + ' s');
  timings.push(['batalha inteira', Date.now() - t0]);
  await debrief();
  goal.battle = true;
  goal.teamSent = false;
  const stores1 = await page.evaluate(() => Object.assign({}, OV.Game.G.bases[0].stores));
  const gained = Object.keys(stores1).filter((k) => (stores1[k] | 0) > (stores0[k] | 0));
  note('armazém: novos/aumentados ' + (gained.join(', ') || 'nenhum'));
  return { res, gained };
}
async function checkStores(gained) {
  tag = 'base';
  if (TOUCH) await press(page.locator('.geo-acts .btn', { hasText: 'Bases' }));
  else await key('b');
  await until(() => OV.BaseUI.isOpen(), 6000, 'base');
  await baseTab(5);
  await sleep(300);
  await shot('base_stores_after_mission');
  const shown = await page.evaluate((ids) => ids.filter((id) => !!document.querySelector('.bsc-item[data-item="' + id + '"]')), gained);
  if (gained.length) check(shown.length === gained.length, 'material recuperado visível no armazém: ' + shown.join(', '));
  else confuse('missão sem material recuperado (o armazém não mudou)');
  goal.stores = true;
  await key('Escape');
  await until(() => OV.Scenes.top().id === 'geoscape', 5000, 'regresso ao Geoscape');
  tag = 'geo';
}

// ============================================================================================================
// 4. Relatório mensal, gravar, recarregar, continuar
// ============================================================================================================
async function monthReport() {
  tag = 'mês';
  await sleep(700);
  await shot('month_report');
  await missingKeys('relatório mensal');
  await overflow('relatório mensal');
  const txt = await page.evaluate(() => { const n = document.querySelector('.cp-mr'); return n ? n.innerText.replace(/\s+/g, ' ').slice(0, 260) : ''; });
  note('relatório mensal: ' + txt);
  const sc = await page.evaluate(() => { const b = document.querySelector('.cp-mr-body'); return b ? { h: b.scrollHeight, c: b.clientHeight } : null; });
  if (sc && sc.h > sc.c + 4) {
    note('  relatório com deslocação (' + sc.h + ' > ' + sc.c + ' px): rolo com o trackpad');
    if (!TOUCH) { const r = await page.locator('.cp-mr-body').boundingBox(); await trackpadScroll(r.x + r.width / 2, r.y + r.height / 2, 0, 60, 6); await shot('month_report_scrolled'); }
  }
  goal.month = true;
  await press(page.locator('.cp-mr .btn.primary'));
  await until(() => OV.Scenes.top().id !== 'monthReport', 5000, 'fechar relatório mensal');
  tag = 'geo';
}
const signature = () => page.evaluate(() => {
  const G = OV.Game.G;
  const b = G.bases[0];
  return JSON.stringify({ t: G.t, date: OV.U.fmtDate(G.t), funds: G.funds, month: G.month, researched: G.researched,
    base: { grid: b.grid, stores: b.stores, research: b.research, production: b.production, sci: b.scientists, eng: b.engineers, soldiers: b.soldiers, crafts: b.crafts, deliveries: b.deliveries },
    soldiers: Object.keys(G.soldiers).length, crafts: Object.values(G.crafts).map((c) => c.id + ':' + c.status), score: G.score.all });
});
async function saveReload() {
  tag = 'gravar';
  await setPaused();
  if (TOUCH) await press(page.locator('.geo-acts .btn', { hasText: 'Gravar' }));
  else await key('s');
  await until(() => OV.Scenes.top().id === 'saveload', 5000, 'diálogo de gravação');
  await sleep(300);
  await shot('save_dialog');
  await missingKeys('gravar');
  const row = page.locator('.cp-sl-row[data-slot="1"]');
  const btn = row.locator('.btn', { hasText: /Gravar|Substituir/ });
  const wasEmpty = (await btn.textContent()).includes('Gravar');
  await press(btn);
  if (!wasEmpty) { await until(() => !!document.querySelector('#modals .btn.primary'), 3000, 'confirmar substituição'); await press(page.locator('#modals .btn.primary')); }
  await sleep(400);
  const saved = await page.evaluate(() => OV.Save.list().find((e) => e.slot === '1'));
  check(!!saved, 'ranhura 1 gravada: ' + (saved && saved.label));
  await shot('save_done');
  const sig0 = await signature();
  await key('Escape');
  await sleep(300);
  tag = 'carregar';
  await timed('recarregar a página → menu', async () => {
    await page.reload();
    await until(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', 20000, 'menu depois de recarregar');
  });
  await watchToasts();
  await sleep(400);
  const hint = await page.evaluate(() => { const b = document.querySelector('.scr-mi[data-id="continue"]'); return b ? b.innerText.replace(/\s+/g, ' ') : ''; });
  note('menu: «' + hint + '»');
  await shot('menu_continue');
  await timed('«Continuar» → Geoscape', async () => {
    await press(page.locator('.scr-mi[data-id="continue"]'));
    await until(() => OV.Scenes.top() && OV.Scenes.top().id === 'geoscape', 15000, 'Geoscape carregado');
  });
  const sig1 = await signature();
  const a = JSON.parse(sig0), b = JSON.parse(sig1);
  const diffs = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check(!diffs.length, 'jogo carregado idêntico ao gravado (data ' + b.date + ', fundos ' + b.funds + ', ' + b.researched.length + ' investigações)' + (diffs.length ? ' — difere: ' + diffs.join(', ') : ''));
  const s = await gs();
  check(s.paused || s.t === a.t, 'o tempo não dispara sozinho depois de carregar (pausa: ' + s.paused + ')');
  await sleep(500);
  await shot('loaded_geoscape');
  await missingKeys('jogo carregado');
}
// missão final pela interface: a investigação de Cidónia levaria horas, por isso só o estado é preparado (bandeira e
// um Vingador pronto com a equipa); a partida é feita como um jogador: base → Naves → «Missão final: Cidónia» → briefing
async function finalMission() {
  tag = 'cidónia';
  await setPaused();
  await page.evaluate(() => {
    const G = OV.Game.G, b = G.bases[0];
    G.flags.cydoniaUnlocked = true;
    const av = OV.Campaign.addCraft(G, b.id, 'avenger');
    av.status = 'ready';
    for (const sid of b.soldiers.slice()) { const s = G.soldiers[sid]; if (s && !(s.woundDays > 0) && av.soldiers.length < 12) OV.BaseSim.assignSoldier(G, sid, av.id); }
  });
  if (TOUCH) await press(page.locator('.geo-acts .btn', { hasText: 'Bases' }));
  else await key('b');
  await until(() => OV.BaseUI.isOpen(), 6000, 'base');
  await baseTab(6);
  await press(page.locator('.bsc-craft', { hasText: 'Vingador' }));
  await sleep(300);
  await shot('cydonia_base_crafts');
  if (TOUCH) await press(page.locator('[data-act="cydonia"]'));
  else await key('x');
  await until(() => !!document.querySelector('.modal.cp-cy-modal'), 4000, 'confirmação de Cidónia');
  await shot('cydonia_confirm');
  await press(page.locator('.modal.cp-cy-modal .btn', { hasText: 'Partir para Marte' }));
  const ok = await until(() => OV.Scenes.top().id === 'cbriefing' && OV.Game.G.activeMission && OV.Game.G.activeMission.siteRef.kind === 'cydonia', 6000, 'briefing de Cidónia');
  check(ok, 'missão final lançada pela interface (briefing de Cidónia)');
  await sleep(500);
  await shot('cydonia_briefing');
  await missingKeys('briefing de Cidónia');
  if (TOUCH) await press(page.locator('.cp-brief .btn', { hasText: 'Cancelar' }));
  else await key('Escape');
  await until(() => OV.Scenes.top().id === 'basescape', 5000, 'regresso à base');
  check(await page.evaluate(() => !OV.Game.G.activeMission), 'cancelar o briefing de Cidónia não deixa missão ativa');
  if (TOUCH) await press(page.locator('.bsc-topbtns .btn.primary'));
  else await key('Escape');
  await until(() => OV.Scenes.top().id === 'geoscape', 5000, 'regresso ao Geoscape');
  tag = 'geo';
}
// ecrãs finais (só por depuração: uma campanha real leva horas até lá) para o dossiê de imprensa
async function endings() {
  tag = 'fim';
  await page.evaluate(() => OV.CampaignUI.victory(OV.Game.G));
  await until(() => OV.Scenes.top().id === 'victory', 5000, 'ecrã de vitória');
  await sleep(900);
  await shot('victory_debug');
  await missingKeys('vitória');
  await page.evaluate(() => OV.CampaignUI.gameOver(OV.Game.G, 'council'));
  await until(() => OV.Scenes.top().id === 'gameOver', 5000, 'ecrã de derrota');
  await sleep(900);
  await shot('gameover_debug');
  await missingKeys('derrota');
  note('ecrãs de vitória e derrota abertos por depuração (CampaignUI.victory / gameOver)');
}
async function setPaused() {
  const s = await gs();
  if (s.top === 'geoscape' && !s.paused) { await key('p'); await sleep(150); }
}

// ============================================================================================================
// 5. Ciclo principal do Geoscape
// ============================================================================================================
async function geoLoop() {
  tag = 'geo';
  const tStart = Date.now();
  let lastSpeedLog = '', dayMark = null, lastGT = -1, sameT = 0, idleAt = Date.now();
  let didGestures = false, shotUfo = false;
  while (Date.now() - T0 < MAX_MS) {
    const s = await gs();
    if (s.top === 'gameOver') { await shot('game_over'); check(false, 'derrota inesperada: ' + (await page.evaluate(() => OV.Game.G.flags.lostReason))); return false; }
    if (s.top === 'dogfight') { await handleDogfight(); idleAt = Date.now(); continue; }
    if (s.top === 'cbriefing') {
      const r = await battleFlow();
      goal.storesPending = r.gained;
      idleAt = Date.now();
      continue;
    }
    if (s.top === 'monthReport') { await monthReport(); idleAt = Date.now(); continue; }
    if (s.top === 'ufopaedia' || s.top === 'basescape' || s.top === 'saveload' || s.top === 'options') {
      confuse('cena «' + s.top + '» aberta sem ter sido pedida pelo jogador');
      await key('Escape');
      await sleep(300);
      continue;
    }
    if (s.top !== 'geoscape') { note('cena inesperada: ' + s.top); await shot('unexpected_' + s.top); await sleep(500); continue; }
    if (s.popup) { await handlePopup(s); idleAt = Date.now(); continue; }
    if (s.dialog) { confuse('diálogo «' + s.dialog + '» ficou aberto'); await key('Escape'); await sleep(200); continue; }
    if (!goal.intro) goal.intro = true;
    if (!didGestures) {
      didGestures = true;
      await shot('geoscape_start');
      await missingKeys('Geoscape');
      await overflow('Geoscape');
      await smallTargets('Geoscape');
      const v0 = s.view;
      const cx = (VW - 320) / 2, cy = VH / 2;
      if (TOUCH) { await twoFingerPan(cx, cy, -80, 0); await pinch(cx, cy, 50, 90); await longPress(cx + 40, cy + 30); }
      else { await trackpadScroll(cx, cy, -20, 0, 6); await trackpadPinch(cx, cy, -10, 5); await page.mouse.click(cx + 40, cy + 30, { modifiers: ['Control'] }); }
      await sleep(900);
      const v1 = (await gs()).view;
      check(Math.abs(v1.lon - v0.lon) > 0.5 || Math.abs(v1.lat - v0.lat) > 0.5, 'gestos rodam o globo (' + v0.lon.toFixed(1) + '→' + v1.lon.toFixed(1) + ')');
      check(v1.zoom > v0.zoom + 0.05, 'pinça amplia o globo (' + v0.zoom.toFixed(2) + '→' + v1.zoom.toFixed(2) + ')');
      await key('h');
      await sleep(600);
      continue;
    }
    if (!goal.base) { await setupBase(); continue; }
    if (goal.storesPending) { const g = goal.storesPending; goal.storesPending = null; await checkStores(g); idleAt = Date.now(); continue; }
    // objetivo cumprido: gravar e recarregar
    if (goal.battle && goal.month && goal.ufopaedia && (goal.terrorDone || goal.terror === 'responded' || s.month >= 2)) return true;
    if (s.month >= 3) { check(false, 'abril sem completar o fluxo: ' + JSON.stringify(Object.assign({}, goal, { seen: [...goal.seen] }))); return false; }
    // velocidade: 1 hora com naves no ar ou OVNIs à vista; 1 dia com tudo calmo
    const air = await page.evaluate(() => {
      const G = OV.Game.G;
      return { crafts: Object.values(G.crafts).some((c) => ['out', 'patrol', 'returning'].includes(c.status)), ufos: G.ufos.some((u) => u.detected) };
    });
    const want = air.crafts ? 4 : air.ufos ? 5 : 6;
    await setSpeed(want);
    if (air.ufos && !shotUfo) {
      const sel = await page.evaluate(() => { const u = OV.Game.G.ufos.find((x) => x.detected); if (u) OV.GeoUI.select({ kind: 'ufo', id: u.id }); return !!u; });
      if (sel) { shotUfo = true; await sleep(500); await shot('geoscape_ufo_card'); }
    }
    const lab = 'vel. ' + want + (air.crafts ? ' (naves no ar)' : '');
    if (lab !== lastSpeedLog) { lastSpeedLog = lab; note(s.date + ' · ' + lab); }
    const d = s.date.split(' · ')[0];
    if (d !== dayMark) {
      if (dayMark !== null) timings.push(['dia de jogo (' + d + ')', Date.now() - idleAt]);
      dayMark = d;
      idleAt = Date.now();
      await flushToasts();
    }
    if (s.gt === lastGT) { if (++sameT > 60 && !s.blocked) { confuse('o relógio não avança há ~10 s sem nada aberto (' + JSON.stringify({ speed: s.speed, paused: s.paused, queue: s.queue, waiting: s.waiting }) + ')'); await shot('clock_stuck'); sameT = 0; } }
    else { sameT = 0; lastGT = s.gt; }
    await sleep(160);
  }
  check(false, 'tempo real esgotado (' + (MAX_MS / 60000) + ' min) com objetivos ' + JSON.stringify(Object.assign({}, goal, { seen: [...goal.seen] })));
  void tStart;
  return false;
}

// ============================================================================================================
try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch({ headless: !argv.includes('--headed') });
  ctx = await browser.newContext(Object.assign({ deviceScaleFactor: DPR, viewport: { width: VW, height: VH } }, TOUCH ? { hasTouch: true, isMobile: false, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}));
  page = await ctx.newPage();
  if (TOUCH) cdp = await ctx.newCDPSession(page);
  await page.addInitScript(() => { try { Object.defineProperty(navigator, 'platform', { get: () => (navigator.maxTouchPoints > 0 ? 'iPad' : 'MacIntel') }); } catch (e) { /* só leitura */ } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('consola: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('página: ' + e.message));
  note('viewport ' + VW + '×' + VH + ' @' + DPR + 'x' + (TOUCH ? ' (toque, iPad)' : ' (Mac: rato/trackpad + teclado)') + ', semente ' + SEED + ', terror: ' + TERROR);
  await timed('arranque da página', async () => { await page.goto(URL0); });
  if (await newCampaign()) {
    const ok = await geoLoop();
    if (ok) await saveReload();
    if (ok) await finalMission();
    if (ok && !TOUCH) await endings();
    const G = await page.evaluate(() => { const G = OV.Game.G; return { date: OV.U.fmtDate(G.t), funds: G.funds, researched: G.researched, stats: G.stats, rating: G.reports.length ? G.reports[G.reports.length - 1].ratingKey : null }; });
    note('estado final: ' + JSON.stringify(G));
    check(goal.seen.has('ufoDetected'), 'OVNI detetado');
    check(goal.intercept > 0, 'interceção feita (' + goal.intercept + ')');
    check(goal.battle, 'batalha jogada e relatório da campanha');
    check(goal.research && goal.ufopaedia, 'investigação concluída e Ufopédia aberta');
    check(!!goal.terror, 'local de terror visto (' + goal.terror + (goal.terrorDone ? ', expirou' : '') + ')');
    check(goal.month, 'relatório mensal');
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.message ? e.message.split('\n')[0] : e));
  note('EXCEÇÃO ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
  try { await shot('exception'); } catch (_) { /* página fechada */ }
} finally {
  tag = '';
  for (const e of errors) note('✗ ' + e);
  note('— esperas (tempo real) —');
  for (const [k, ms] of timings.filter((x) => !/^dia de jogo/.test(x[0]))) note('  ' + k + ': ' + (ms / 1000).toFixed(1) + ' s');
  const days = timings.filter((x) => /^dia de jogo/.test(x[0])).map((x) => x[1]);
  if (days.length) note('  dia de jogo médio: ' + (days.reduce((a, b) => a + b, 0) / days.length / 1000).toFixed(1) + ' s (' + days.length + ' dias, incluindo janelas)');
  note('— momentos confusos (' + confusing.length + ') —');
  for (const c of confusing) note('  · ' + c);
  fs.writeFileSync(path.join(OUT, 'log.txt'), lines.join('\n') + '\n');
  if (browser) await browser.close();
  server.kill();
}
const bad = fails.length + errors.length;
console.log(bad ? '✗ ' + fails.length + ' falha(s), ' + errors.length + ' erro(s) — ' + OUT : '✓ campanha completa sem erros — capturas e registo em ' + OUT);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(bad ? 1 : 0);
