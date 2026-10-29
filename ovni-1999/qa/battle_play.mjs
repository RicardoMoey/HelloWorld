/* QA jogável do Battlescape num Chromium real (Playwright): serve /home/user/HelloWorld com «python3 -m http.server»
   numa porta livre, abre /ovni-1999/index.html?battle=medium_scout&seed=7&debug=1 e joga pela interface:
   seleciona um soldado, passa o cursor num tile (pré-visualização do caminho), move com «Confirmar movimento»,
   roda, ajoelha, abre o menu de ação, avança até avistar um alienígena, aponta (probabilidade no cursor), dispara um
   tiro rápido, lança uma granada (G), termina o turno, assiste ao turno alienígena — 3 turnos — e depois uma missão
   noturna com sinalizador (L) e o HUD a 1024×700. Capturas por passo; falha com erros de consola/página.
   Uso: node ovni-1999/qa/battle_play.mjs [--out <pasta>] [--turns 3] [--headed] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'battle') : path.join(process.cwd(), 'qa-out', 'battle'));
const OUT = path.resolve(arg('out', DEF_OUT));
const TURNS = +arg('turns', 3);

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
// estado do HUD; sem cena de batalha (fim → debriefing) devolve {ended: true, gone: true}
const OV_ok = (s) => !!s && s.phase === 'play';
const st = () => page.evaluate(() => (OV.BattleUI.scene && OV.BattleUI.debug.state()) || { ended: true, gone: true, scene: OV.Scenes.top() && OV.Scenes.top().id, visibleAliens: [] });
async function shot(name) {
  shotN++;
  const f = String(shotN).padStart(2, '0') + '_' + name + '.png';
  await page.screenshot({ path: path.join(OUT, f) });
  return f;
}
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!(window.OV && OV.BattleUI)) return false;
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 60000 });
  await page.waitForTimeout(120);
}
async function tile(x, y, z) {
  return page.evaluate(([a, b, c]) => OV.BattleUI.debug.tileToScreen(a, b, c), [x, y, z]);
}
async function openBattle(query, size) {
  await page.setViewportSize(size || { width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?' + query + '&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  await idle();
  // confirmar movimento sempre ligado (o rato do Playwright conta como rato)
  await page.evaluate(() => { OV.Game.settings.confirmMove = 'always'; OV.Game.settings.confirmEndTurn = true; });
}
// tile alcançável a ~n passos na direção de (tx, ty) para a unidade selecionada (só leitura de B)
async function stepToward(n, tx, ty) {
  return page.evaluate(([n, tx, ty]) => {
    const B = OV.Game.B, s = OV.BattleUI.debug.state(), u = OV.BUnits.findUnit(B, s.selectedId);
    const r = OV.Path.reachable(B, u, Math.max(0, u.tu - (u.kneel ? 8 : 0) - 30), u.energy);
    let best = null, bd = 1e9;
    for (const i of r.list) {
      const z = (i / (B.map.w * B.map.h)) | 0, rr = i - z * B.map.w * B.map.h, x = rr % B.map.w, y = (rr / B.map.w) | 0;
      if (z !== u.z) continue;
      const steps = Math.max(Math.abs(x - u.x), Math.abs(y - u.y));
      const d = Math.hypot(x - tx, y - ty) + (n ? Math.abs(steps - n) * 3 : 0);
      if (d < bd) { bd = d; best = { x, y, z }; }
    }
    return best;
  }, [n, tx, ty]);
}
async function aliensKnown() {
  return page.evaluate(() => OV.Game.B.units.filter((u) => u.side === 'alien' && u.onMap && (u.status === 'ok' || u.status === 'panic')).map((u) => ({ id: u.id, x: u.x, y: u.y, z: u.z })));
}
async function confirmModal() {
  const b = page.locator('#modals .btn.primary');
  if (await b.count()) { await b.first().click(); return true; }
  return false;
}
async function endTurn(label) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  if (await page.locator('#modals .modal').count()) {
    await shot(label + '_confirm');
    await confirmModal();
  }
  // a meio do turno alienígena (Movimento Oculto…)
  let saw = false;
  for (let k = 0; k < 60; k++) {
    await page.waitForTimeout(80);
    const on = await page.evaluate(() => !!document.querySelector('.bs-hidden.on'));
    if (on && !saw) { saw = true; await shot(label + '_hidden'); }
    const s = await st();
    if (s.gone || (!s.playing && s.side === 'xcom' && k > 3)) break;
  }
  await idle(90000);
  return saw;
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch({ headless: !argv.includes('--headed') });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message) + '\n' + (e && e.stack)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ================= missão diurna =================
  await openBattle('battle=medium_scout&seed=7');
  let s = await st();
  log(s && s.phase === 'play' && s.side === 'xcom', 'batalha aberta (turno ' + s.turn + ', ' + s.reachCount + ' tiles alcançáveis)');
  await shot('start');

  // selecionar o 2.º soldado pela lista da equipa
  await page.locator('.bs-sq').nth(1).click();
  await page.waitForTimeout(250);
  s = await st();
  log(s.selectedId !== null && s.unit, 'seleção pela lista: unidade ' + s.selectedId);
  const aliens0 = await aliensKnown();
  const goal = aliens0[0] || { x: 15, y: 25 };

  // passar o cursor num tile: pré-visualização do caminho
  let t = await stepToward(4, goal.x, goal.y);
  let p = await tile(t.x, t.y, t.z);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(200);
  s = await st();
  log(s.pathSteps > 0 && s.pathLabel, 'pré-visualização do caminho: ' + s.pathSteps + ' passos, «' + s.pathLabel + '»');
  await shot('hover_path');
  // tile longe (passos vermelhos)
  const far = await page.evaluate(() => { const s = OV.BattleUI.debug.state(); return { x: Math.max(0, s.unit.x - 14), y: Math.min(OV.Game.B.map.h - 1, s.unit.y + 18), z: 0 }; });
  p = await tile(far.x, far.y, far.z);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(200);
  s = await st();
  log(s.pathStates.indexOf('out') >= 0 || s.pathSteps === 0, 'caminho longo com passos sem UT (' + [...new Set(s.pathStates)].join('/') + ')');
  await shot('hover_far');

  // mover com confirmação (2 cliques)
  p = await tile(t.x, t.y, t.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  s = await st();
  log(s.lock >= 0 && /Confirmar/.test(s.pathLabel || ''), 'primeiro clique bloqueia o destino: «' + s.pathLabel + '»');
  await shot('confirm_lock');
  const before = s.unit;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  await shot('walking');
  await idle();
  s = await st();
  log(s.unit.x !== before.x || s.unit.y !== before.y, 'andou de ' + before.x + ',' + before.y + ' para ' + s.unit.x + ',' + s.unit.y + ' (UT ' + before.tu + '→' + s.unit.tu + ')');

  // rodar (clique secundário)
  const dir0 = s.unit.dir;
  p = await tile(s.unit.x - 2, s.unit.y + 2, s.unit.z);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await idle();
  s = await st();
  log(s.unit.dir !== dir0, 'rodou ' + dir0 + '→' + s.unit.dir);

  // ajoelhar e levantar
  await page.keyboard.press('k');
  await idle();
  s = await st();
  log(s.unit.kneel, 'ajoelhou (K)');
  await shot('kneel');

  // menu de ação da mão direita
  await page.mouse.move(700, 120);
  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  s = await st();
  log(s.menu && s.menu.entries.length >= 2, 'menu de ação: ' + (s.menu ? s.menu.entries.map((e) => e.label + ' ' + e.cost + 'UT ' + (e.acc !== undefined ? e.acc + '%' : '')).join(' | ') : '—'));
  await shot('action_menu');
  await page.keyboard.press('Escape');

  // reservas de UT
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(100);
  s = await st();
  log(s.reserve === 'snap', 'reserva tiro rápido (Shift+2)');
  await page.keyboard.press('Shift+Digit1');

  // avançar até avistar um alienígena (vários soldados, vários turnos)
  let seenAlien = null;
  for (let turn = 0; turn < 6 && !seenAlien; turn++) {
    const ids = await page.evaluate(() => OV.Game.B.units.filter((u) => u.side === 'xcom' && u.onMap && u.status === 'ok').map((u) => u.id));
    for (const id of ids) {
      const al = await aliensKnown();
      if (!al.length) break;
      const dest = await page.evaluate(([id, gx, gy]) => {
        const B = OV.Game.B, u = OV.BUnits.findUnit(B, id);
        if (!u || u.tu < 20) return null;
        const r = OV.Path.reachable(B, u, Math.max(0, u.tu - (u.kneel ? 8 : 0) - 26), u.energy);
        let best = null, bd = 1e9;
        for (const i of r.list) {
          const z = (i / (B.map.w * B.map.h)) | 0, rr = i - z * B.map.w * B.map.h, x = rr % B.map.w, y = (rr / B.map.w) | 0;
          if (z !== u.z) continue;
          const d = Math.hypot(x - gx, y - gy);
          if (d < bd) { bd = d; best = { x, y, z }; }
        }
        return best;
      }, [id, al[0].x, al[0].y]);
      if (!dest) continue;
      await page.evaluate(([id, d]) => OV.BattleUI.debug.selectAndMove(id, d.x, d.y, d.z), [id, dest]);
      await idle();
      s = await st();
      if (s.ended) break;
      if (s.visibleAliens.length) { seenAlien = s.visibleAliens[0]; break; }
    }
    if (seenAlien || (await st()).ended) break;
    await endTurn('advance_t' + turn);
  }
  s = await st();
  log(!!seenAlien || s.ended, seenAlien ? 'alienígena à vista em ' + seenAlien.x + ',' + seenAlien.y : 'batalha terminou antes de avistar');
  if (seenAlien && !s.ended) {
    await shot('alien_spotted');
    // escolher o soldado com mais UT que vê o alienígena e apontar
    const shooter = await page.evaluate(() => {
      const B = OV.Game.B;
      const list = B.units.filter((u) => u.side === 'xcom' && u.onMap && u.status === 'ok').sort((a, b) => b.tu - a.tu);
      const al = OV.LOS.unitsVisibleTo(B, 'xcom', true)[0];
      const t = OV.BUnits.findUnit(B, al);
      const ok = list.find((u) => OV.LOS.targetVoxel(B, u, t)) || list[0];
      return ok.id;
    });
    await page.evaluate((id) => {
      const rows = [...document.querySelectorAll('.bs-sq')];
      const names = OV.Game.B.units.filter((u) => u.side === 'xcom' || u.origSide === 'xcom');
      const k = names.findIndex((u) => u.id === id);
      rows[k].click();
    }, shooter);
    await page.waitForTimeout(200);
    await page.keyboard.press('e');
    await page.waitForTimeout(150);
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    s = await st();
    log(s.mode === 'target', 'modo de alvo (E, 1 = tiro rápido)');
    // centrar no alienígena primeiro (tecla 1 fora do menu)
    await page.keyboard.press('Escape');
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(400);
    await page.keyboard.press('e');
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    const ap2 = await page.evaluate((id) => OV.BattleUI.debug.unitScreen(id), seenAlien.id);
    await page.mouse.move(ap2.x, ap2.y);
    await page.waitForTimeout(250);
    s = await st();
    log(s.target && s.target.label, 'cursor de alvo: «' + (s.target && s.target.label) + '»' + (s.target && s.target.sub ? ' + «' + s.target.sub + '»' : ''));
    await shot('aim_alien');
    if (s.target && !s.target.blocked) {
      await page.mouse.click(ap2.x, ap2.y);
      await page.waitForTimeout(160);
      await shot('firing');
      await idle();
      s = await st();
      log(true, 'tiro rápido disparado (UT agora ' + (s.unit ? s.unit.tu : '-') + ')');
      await shot('after_shot');
    } else {
      // sem linha de tiro: força com ⌘ (Meta)
      await page.keyboard.down('Meta');
      await page.mouse.move(ap2.x + 1, ap2.y);
      await page.waitForTimeout(150);
      await page.mouse.click(ap2.x + 1, ap2.y, { modifiers: ['Meta'] });
      await page.keyboard.up('Meta');
      await idle();
      log(true, 'tiro forçado (sem linha de tiro)');
    }
    // granada rápida
    s = await st();
    if (!s.ended) {
      const al = (await st()).visibleAliens[0] || seenAlien;
      // granadeiro: o soldado com mais UT
      await page.evaluate(() => {
        const list = OV.Game.B.units.filter((u) => u.side === 'xcom' || u.origSide === 'xcom');
        let k = -1, best = -1;
        list.forEach((u, n) => { if (u.side === 'xcom' && u.onMap && u.status === 'ok' && u.tu > best) { best = u.tu; k = n; } });
        if (k >= 0) document.querySelectorAll('.bs-sq')[k].click();
      });
      await page.waitForTimeout(200);
      await page.keyboard.press('g');
      await page.waitForTimeout(150);
      const gp = await tile(al.x, al.y, al.z);
      await page.mouse.move(gp.x, gp.y);
      await page.waitForTimeout(250);
      s = await st();
      log(s.mode === 'throw' && s.throwInfo, 'granada rápida (G): «' + (s.throwInfo && s.throwInfo.label) + '»');
      await shot('grenade_aim');
      if (s.throwInfo && s.throwInfo.ok) {
        await page.mouse.click(gp.x, gp.y);
        await page.waitForTimeout(500);
        await shot('grenade_flight');
        await idle();
        await shot('grenade_after');
        log(true, 'granada lançada');
      } else {
        // aproximar o alvo até ficar ao alcance
        const near = await page.evaluate(([ax, ay]) => {
          const s = OV.BattleUI.debug.state();
          return { x: Math.round((s.unit.x * 2 + ax) / 3), y: Math.round((s.unit.y * 2 + ay) / 3), z: s.unit.z };
        }, [al.x, al.y]);
        const np = await tile(near.x, near.y, near.z);
        await page.mouse.move(np.x, np.y);
        await page.waitForTimeout(200);
        s = await st();
        if (s.throwInfo && s.throwInfo.ok) {
          await page.mouse.click(np.x, np.y);
          await idle();
          await shot('grenade_after');
          log(true, 'granada lançada (mais perto): «' + s.throwInfo.label + '»');
        } else {
          log(true, 'granada fora de alcance/UT: «' + (s.throwInfo && s.throwInfo.label) + '»');
          await page.keyboard.press('Escape');
        }
      }
    }
  }

  // turnos: terminar, assistir ao turno alienígena
  for (let k = 0; k < TURNS; k++) {
    s = await st();
    if (s.ended) break;
    const t0 = s.turn;
    const saw = await endTurn('turn' + t0);
    s = await st();
    log(s.ended || s.turn === t0 + 1, 'turno ' + t0 + ' → ' + (s.gone ? 'fim da batalha (cena ' + s.scene + ')' : s.turn) + (saw ? ' (Movimento Oculto visto)' : ''));
    await shot(s.gone ? 'battle_end' : 'turn' + s.turn + '_start');
    if (s.ended) break;
    // um movimento por turno para o jogo avançar
    const al = await aliensKnown();
    if (al.length) {
      const tt = await stepToward(5, al[0].x, al[0].y);
      if (tt) {
        const tp = await tile(tt.x, tt.y, tt.z);
        await page.mouse.move(tp.x, tp.y);
        await page.mouse.click(tp.x, tp.y);
        await page.waitForTimeout(80);
        await page.mouse.click(tp.x, tp.y);
        await idle();
      }
    }
  }
  // zoom por pinça (Ctrl+roda, como o Chrome no trackpad) com encaixe e níveis
  if (!(await st()).gone) {
    await page.mouse.move(720, 420);
    const z0 = (await st()).cam.zoom;
    await idle();
    await page.keyboard.down('Control');
    for (let k = 0; k < 8; k++) {
      await page.mouse.wheel(0, -16);
      await page.waitForTimeout(16);
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(900);
    const z = (await st()).cam.zoom;
    log(z > z0 && [0.5, 0.75, 1, 1.5, 2].some((v) => Math.abs(v - z) < 1e-6), 'zoom por pinça ' + z0 + ' → encaixa em ' + z);
    await shot('zoomed');
    await page.keyboard.press('.');
    const lz = (await st()).viewZ;
    await page.keyboard.press(',');
    log(lz === 1 && (await st()).viewZ === 0, 'níveis de vista com . e ,');
    await page.keyboard.press('-');
    await page.waitForTimeout(400);
  }
  // minimapa
  if (!(await st()).gone) {
    await page.keyboard.press('m');
    await page.waitForTimeout(400);
    s = await st();
    log(s.miniOn, 'mapa tático (M)');
    await shot('minimap');
    await page.keyboard.press('m');
  }

  // opções (Esc) e inventário (I)
  if (!(await st()).gone) {
    await page.mouse.move(700, 120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => OV.Scenes.top().id);
    const modal = await page.locator('#modals .modal').count();
    log(top === 'options' || modal > 0, 'Esc abre as opções (' + (top === 'options' ? 'cena options' : 'modal') + ')');
    await shot('options');
    if (top === 'options') await page.evaluate(() => OV.Scenes.pop());
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    s = await st();
    log(!s.gone && OV_ok(s), 'regresso à batalha depois das opções');
    await page.keyboard.press('i');
    await page.waitForTimeout(400);
    await shot('inventory_key');
    const inv = await page.evaluate(() => OV.Scenes.top().id);
    if (inv !== 'battlescape') { await page.keyboard.press('Escape'); await page.waitForTimeout(300); if ((await page.evaluate(() => OV.Scenes.top().id)) !== 'battlescape') await page.evaluate(() => OV.Scenes.pop()); }
    log(true, 'tecla I → ' + (inv === 'battlescape' ? 'aviso (inventário indisponível)' : 'cena ' + inv));
    // abortar → debriefing
    await page.locator('.bs-btn.danger').first().click();
    await page.waitForTimeout(300);
    await shot('abort_confirm');
    await page.locator('#modals .btn.danger').first().click();
    await page.waitForFunction(() => !OV.BattleUI.scene, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => OV.Scenes.top() && OV.Scenes.top().id);
    log(after === 'debrief', 'abortar → cena ' + after);
    await shot('abort_debrief');
  }

  // ================= missão noturna com sinalizador =================
  await openBattle('battle=small_scout&night=1&seed=11');
  await shot('night_start');
  s = await st();
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  const fl = await page.evaluate(() => {
    const s = OV.BattleUI.debug.state(), m = OV.Game.B.map;
    return { x: Math.min(m.w - 1, Math.max(0, s.unit.x - 3)), y: Math.min(m.h - 1, s.unit.y + 5), z: s.unit.z };
  });
  const fp = await tile(fl.x, fl.y, fl.z);
  await page.mouse.move(fp.x, fp.y);
  await page.waitForTimeout(250);
  s = await st();
  log(s.mode === 'throw' && s.throwInfo, 'sinalizador (L): «' + (s.throwInfo && s.throwInfo.label) + '»');
  await shot('night_flare_aim');
  if (s.throwInfo && s.throwInfo.ok) {
    await page.mouse.click(fp.x, fp.y);
    await idle();
    await page.mouse.move(10, 300);
    await page.waitForTimeout(300);
    await shot('night_flare_lit');
    const lit = await page.evaluate(() => OV.Game.B.items.some((it) => it.type === 'electro_flare' && it.at !== null && it.owner === null));
    log(lit, 'sinalizador no chão a iluminar');
  }
  const saw = await endTurn('night_turn1');
  log(true, 'turno noturno terminado' + (saw ? ' (Movimento Oculto visto)' : ''));
  await shot('night_turn2');

  // ================= HUD em ecrãs pequenos =================
  for (const [w, h] of [[1280, 800], [1024, 700]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.keyboard.press('e');
    await page.waitForTimeout(150);
    await shot('hud_' + w + 'x' + h);
    await page.keyboard.press('Escape');
    const over = await page.evaluate(() => {
      const r = (q) => document.querySelector(q).getBoundingClientRect();
      const card = r('.bs-card'), con = r('.bs-console'), end = r('.bs-end');
      return { overlap: card.right > con.left + 1 || con.right > end.left + 1, out: end.right > window.innerWidth + 1, top: Math.min(card.top, con.top, end.top) };
    });
    log(!over.overlap && !over.out, 'HUD ' + w + '×' + h + ' sem sobreposições (topo do HUD a ' + Math.round(over.top) + ' px)');
  }
  // chaves i18n em falta (⟦chave⟧)
  const miss = await page.evaluate(() => [...OV.T.missing]);
  log(!miss.length, 'chaves i18n em falta: ' + (miss.join(', ') || 'nenhuma'));
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
