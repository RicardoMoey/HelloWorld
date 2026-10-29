/* Playtest completo pela interface, como um jogador: menu → «Batalha Rápida» → Batedor Pequeno, Dia, Recruta →
   «Começar» → «Iniciar Missão» → joga a batalha só com cliques e teclas (avanço por lanços em direção ao OVNI,
   tiros apontados quando a probabilidade é razoável, uma granada, fim de turno) até à vitória ou 25 turnos →
   debriefing → «Continuar». Depois uma noite com Batedor Médio e sinalizadores (L), com «Confirmar movimento»
   ligado nas Opções (como no trackpad). OV.BattleUI.debug e OV.Game.B só são LIDOS para escolher onde clicar.
   Grava capturas e um registo (log.txt) na pasta de saída; falha com erros de consola/página, estados presos,
   cliques que não fazem nada ou turnos alienígenas lentos.
   Uso: node ovni-1999/qa/full_battle.mjs [--out <pasta>] [--turns 25] [--seed N (dia)] [--seed-night N] [--only day|night]
        [--headed] */
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
const DEF_OUT = process.env.OVNI_QA_OUT || (fs.existsSync(SESSION) ? path.join(SESSION, 'ui', 'play') : path.join(process.cwd(), 'qa-out', 'play'));
const OUT = path.resolve(arg('out', DEF_OUT));
const MAX_TURNS = +arg('turns', 25);
const SEED_DAY = arg('seed', '314');
const SEED_NIGHT = arg('seed-night', '314');
const ONLY = arg('only', '');
const ALIEN_TURN_SLOW_MS = 25000; // turno alienígena (velocidade por omissão) acima disto conta como lento

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
for (const f of fs.readdirSync(OUT)) if (/\.(png|txt)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const errors = [];
const fails = [];
const lines = [];
const T0 = Date.now();
let browser, page, shotN = 0, tag = '';

const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
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
async function shot(name) {
  shotN++;
  const f = String(shotN).padStart(3, '0') + '_' + (tag ? tag + '_' : '') + name + '.png';
  await page.screenshot({ path: path.join(OUT, f) });
  return f;
}
const sleep = (ms) => page.waitForTimeout(ms);
const st = () => page.evaluate(() => (OV.BattleUI.scene && OV.BattleUI.debug.state()) || { gone: true, ended: true, scene: OV.Scenes.top() && OV.Scenes.top().id, visibleAliens: [] });
const topScene = () => page.evaluate(() => (OV.Scenes.top() ? OV.Scenes.top().id : null));
async function idle(ms, what) {
  try {
    await page.waitForFunction(() => {
      if (!(window.OV && OV.Scenes)) return false;
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

// ---- leituras (só leitura de B / debug) ---------------------------------------------------------------------
const readUnit = (id) => page.evaluate((id) => {
  if (!OV.Game.B) return null; // batalha terminada (já no debriefing)
  const u = OV.BUnits.findUnit(OV.Game.B, id);
  return u ? { id: u.id, x: u.x, y: u.y, z: u.z, tu: u.tu, hp: u.hp, status: u.status, onMap: u.onMap, name: u.name || (u.nameKey ? OV.T(u.nameKey) : ''), kneel: !!u.kneel, side: u.side } : null;
}, id);
const squadIds = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'xcom' || u.origSide === 'xcom').map((u) => u.id));
const liveSquad = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'xcom' && u.onMap && u.x >= 0 && u.status === 'ok').map((u) => u.id));
const aliensLeft = () => page.evaluate(() => (OV.Game.B ? OV.Game.B.units : []).filter((u) => u.side === 'alien' && (u.status === 'ok' || u.status === 'panic')).length);
// equipamento útil do soldado: arma (mão e modos), granadas e sinalizadores
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
    flares: items.filter((it) => D[it.type] && D[it.type].kind === 'flare').length,
    str: u.stats.str,
  };
}, id);

// ---- cliques seguros: o ponto tem de cair no canvas (não num painel do HUD) -------------------------------------
async function onCanvas(p) {
  if (!p) return false;
  const vp = page.viewportSize();
  if (p.x < 8 || p.y < 8 || p.x > vp.width - 8 || p.y > vp.height - 8) return false;
  return page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return !!e && e.id === 'view';
  }, [p.x, p.y]);
}
// desloca a câmara com as setas até o ponto ficar visível e livre do HUD
async function bringIntoView(getPoint) {
  const vp = page.viewportSize();
  for (let k = 0; k < 8; k++) {
    const p = await getPoint();
    if (!p) return null;
    const inner = p.x > 300 && p.x < vp.width - 240 && p.y > 110 && p.y < vp.height - 230;
    if (inner && (await onCanvas(p))) return p;
    const dx = p.x - vp.width / 2, dy = p.y - (vp.height / 2 - 60);
    const keys = [];
    if (Math.abs(dx) > 120) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    if (Math.abs(dy) > 90) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    if (!keys.length) return (await onCanvas(p)) ? p : null;
    const ms = Math.min(700, Math.max(90, (Math.max(Math.abs(dx), Math.abs(dy)) / 700) * 1000));
    // com o cursor de teclado ligado, as setas sozinhas movem o cursor: ⇧ + setas desloca a câmara
    await page.keyboard.down('Shift');
    for (const kk of keys) await page.keyboard.down(kk);
    await sleep(ms);
    for (const kk of keys) await page.keyboard.up(kk);
    await page.keyboard.up('Shift');
    await sleep(60);
  }
  const p = await getPoint();
  return (await onCanvas(p)) ? p : null;
}
const tilePoint = (x, y, z) => () => page.evaluate(([a, b, c]) => OV.BattleUI.debug.tileToScreen(a, b, c), [x, y, z]);
const unitPoint = (id) => () => page.evaluate((i) => OV.BattleUI.debug.unitScreen(i), id);

// ---- seleção ----------------------------------------------------------------------------------------------------
async function selectSoldier(id) {
  const me = await readUnit(id);
  if (!me || me.status !== 'ok' || !me.onMap) return false; // caiu durante a ação de outro (reação)
  const ids = await squadIds();
  const k = ids.indexOf(id);
  if (k < 0) return false;
  const row = page.locator('.bs-squad .bs-sq').nth(k);
  await row.click();
  await sleep(80);
  let s = await st();
  if (s.selectedId !== id) {
    check(false, 'clique na faixa da equipa não selecionou o soldado ' + id + ' (selecionado ' + s.selectedId + ')');
    return false;
  }
  await page.keyboard.press('c');
  await sleep(320);
  return true;
}

// ---- movimento por lanços -------------------------------------------------------------------------------------
// campo de distâncias (UT) a partir do centro do OVNI, calculado com um clone da unidade (B não muda)
async function pickMoveTile(id, opts) {
  return page.evaluate(([id, o]) => {
    const B = OV.Game.B, m = B.map, u = OV.BUnits.findUnit(B, id);
    const plane = m.w * m.h;
    const xyz = (i) => { const z = (i / plane) | 0, r = i - z * plane; return [r % m.w, (r / m.w) | 0, z]; };
    const R = B.ufo || { x: m.w >> 1, y: m.h >> 1, w: 1, h: 1 };
    // alvo: tile de chão livre mais perto do centro do OVNI (nível 0)
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
    const keep = Math.max(0, o.keep | 0);
    const budget = Math.max(0, (u.tu | 0) - (u.kneel ? 8 : 0) - keep);
    const r = OV.Path.reachable(B, u, budget, u.energy | 0);
    const mates = B.units.filter((q) => q.side === 'xcom' && q.onMap && q.status === 'ok' && q.id !== u.id);
    let best = null, bs = 1e9;
    for (const i of r.list) {
      if (i === here) continue;
      if (field[i] < 0) continue;
      if (B._.unitAt[i]) continue;
      const [x, y, z] = xyz(i);
      if (z > 0 && !o.climb) continue;
      if (field[i] >= field[here] - 2 || field[i] < field[here] - o.maxAdvance) continue; // progresso, até ao limite do lanço
      if (o.standoff > 0) {
        const dx = Math.max(R.x - x, 0, x - (R.x + R.w - 1)), dy = Math.max(R.y - y, 0, y - (R.y + R.h - 1));
        if (Math.max(dx, dy) < o.standoff) continue; // cerco: fica fora do alcance da porta
      }
      let near = 0;
      for (const q of mates) if (q.z === z && Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= 1) near++;
      const score = field[i] + near * 12 + r.cost[i] * 0.05;
      if (score < bs) { bs = score; best = { x, y, z, i, field: field[i], cost: r.cost[i] }; }
    }
    return { best, hereField: field[here], goal };
  }, [id, opts]);
}
async function frontField(exceptId) {
  return page.evaluate((ex) => {
    const B = OV.Game.B, m = B.map, R = B.ufo || { x: m.w >> 1, y: m.h >> 1, w: 1, h: 1 };
    const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
    let best = 1e9;
    for (const q of B.units) {
      if (q.side !== 'xcom' || !q.onMap || q.status !== 'ok' || q.id === ex) continue;
      const fake = Object.assign({}, q, { x: cx, y: cy, z: 0, tu: 9999, energy: 9999, kneel: false });
      const f = OV.Path.reachable(B, fake, 9999, 9999, { units: 'none' }).cost[(q.z * m.h + q.y) * m.w + q.x];
      if (f >= 0 && f < best) best = f;
    }
    return best === 1e9 ? 9999 : best;
  }, exceptId);
}

let mismatchedHovers = 0;
async function moveTo(id, t, why) {
  const before = await readUnit(id);
  const p = await bringIntoView(tilePoint(t.x, t.y, t.z));
  if (!p) {
    note('  (destino ' + t.x + ',' + t.y + ' fora do ecrã, desisto)');
    return false;
  }
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await sleep(90);
  let s = await st();
  if (!s.hover || s.hover.x !== t.x || s.hover.y !== t.y || s.hover.z !== t.z) {
    mismatchedHovers++;
    note('  cursor em ' + (s.hover ? s.hover.x + ',' + s.hover.y + ',' + s.hover.z : '—') + ' em vez de ' + t.x + ',' + t.y + ',' + t.z);
    if (!s.hover || !s.pathSteps) return false;
  }
  if (!s.pathSteps) {
    note('  sem pré-visualização do caminho para ' + t.x + ',' + t.y);
    return false;
  }
  const label = s.pathLabel;
  await page.mouse.click(p.x, p.y);
  await sleep(70);
  s = await st();
  if (!s.playing && s.lock >= 0) {
    // «Confirmar movimento»: segundo clique no mesmo tile
    if (needShot()) await shot('confirm_lock');
    await page.mouse.click(p.x, p.y);
    await sleep(70);
  }
  await idle(60000, 'andar');
  const after = await readUnit(id);
  if (!after) return true;
  const moved = after.x !== before.x || after.y !== before.y || after.z !== before.z;
  if (!moved && after.status === 'ok') {
    check(false, 'clique em ' + t.x + ',' + t.y + ' («' + label + '») não moveu ' + before.name);
    await shot('no_move');
    return false;
  }
  note('  ' + before.name + ' ' + why + ': ' + before.x + ',' + before.y + ' → ' + after.x + ',' + after.y + ' (UT ' + before.tu + '→' + after.tu + (after.status !== 'ok' ? ', ' + after.status : '') + ')');
  return true;
}
let actions = 0;
const needShot = () => actions % 6 === 0;

// ---- tiro ---------------------------------------------------------------------------------------------------
async function openModeMenu(hand) {
  await page.keyboard.press(hand === 'L' ? 'q' : 'e');
  await sleep(120);
  return (await st()).menu;
}
// entra em modo de alvo com o modo pedido (dígito do menu); devolve false se não houver ou estiver desativado
async function enterMode(hand, wanted) {
  const menu = await openModeMenu(hand);
  if (!menu || !menu.entries) return false;
  const k = menu.entries.findIndex((e) => e.label.toLowerCase().startsWith(wanted));
  if (k < 0 || !menu.entries[k].enabled) {
    await page.keyboard.press('Escape');
    await sleep(60);
    return false;
  }
  await page.keyboard.press(String(k + 1));
  await sleep(100);
  return (await st()).mode === 'target';
}
async function tryShoot(id, alien, kit) {
  const modes = [['tiro apontado', 38], ['tiro rápido', 30], ['rajada', 30]];
  for (const [mode, min] of modes) {
    const s0 = await st();
    if (!s0.unit) return false;
    if (!(await enterMode(kit.gunHand, mode))) continue;
    const p = await bringIntoView(unitPoint(alien.id));
    if (!p) {
      await page.keyboard.press('Escape');
      return false;
    }
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await sleep(140);
    const s = await st();
    const tg = s.target;
    if (!tg || tg.blocked || tg.hitPct === null || tg.hitPct < min || (tg.blastR && tg.sub)) {
      let why = '';
      if (tg && tg.blocked && process.env.OVNI_QA_LOF) {
        why = await page.evaluate(([sid, aid]) => {
          const B = OV.Game.B, u = OV.BUnits.findUnit(B, sid), a = OV.BUnits.findUnit(B, aid), m = B.map, D = OV.Data.tileDefs;
          const aim = OV.LOS.targetVoxel(B, u, a) || OV.Combat.unitCentre(a);
          const o = OV.LOS.originVoxel(B, u, aim);
          const tr = OV.LOS.traceShot(B, o, aim, u.id, 0);
          const pl = m.w * m.h, z = (tr.i / pl) | 0, r = tr.i - z * pl;
          const part = tr.part === null || tr.part === undefined ? '' : m.parts[tr.i * 4 + tr.part];
          return ' [' + u.x + ',' + u.y + ',' + u.z + (u.kneel ? 'k' : '') + ' → ' + a.x + ',' + a.y + ',' + a.z + ' alvo ' + (aim ? aim.join('/') : 'nenhum') + ' bate ' + tr.kind + ' em ' + (r % m.w) + ',' + ((r / m.w) | 0) + ',' + z + ' ' + (part && D[part] ? D[part].key : '') + ' vê? ' + OV.LOS.isVisibleTo(B, 'xcom', a) + ']';
        }, [s.unit.id, alien.id]);
      }
      note('  ' + mode + ': ' + (tg ? tg.label + (tg.sub ? ' / ' + tg.sub : '') : 'sem alvo') + ' — não vale a pena' + why);
      await page.keyboard.press('Escape');
      await sleep(60);
      if (tg && tg.blocked) return false;
      continue;
    }
    const a0 = await readUnit(alien.id);
    if (needShot() || mode === 'tiro apontado') await shot('aim');
    await page.mouse.click(p.x, p.y);
    await sleep(160);
    if (needShot()) await shot('firing');
    await idle(60000, 'disparar');
    const a1 = await readUnit(alien.id);
    const res = !a1 || a1.status === 'dead' ? 'MORTO' : a1.status === 'unconscious' ? 'inconsciente' : a1.hp < a0.hp ? 'ferido (' + a0.hp + '→' + a1.hp + ')' : 'falhou';
    note('  ' + mode + ' em ' + a0.name + ' com «' + tg.label + '» → ' + res);
    stats.shots++;
    if (res === 'MORTO') stats.kills++;
    actions++;
    return true;
  }
  return false;
}
async function tryGrenade(id, alien) {
  await page.keyboard.press('g');
  await sleep(120);
  if ((await st()).mode !== 'throw') return false;
  const p = await bringIntoView(tilePoint(alien.x, alien.y, alien.z));
  if (!p) {
    await page.keyboard.press('Escape');
    return false;
  }
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await sleep(140);
  const s = await st();
  if (!s.throwInfo || !s.throwInfo.ok || s.throwInfo.sub) {
    note('  granada: ' + (s.throwInfo ? s.throwInfo.label + (s.throwInfo.sub ? ' / ' + s.throwInfo.sub : '') : 'sem informação') + ' — cancelo');
    if (s.throwInfo && s.throwInfo.sub && !sawRisk) {
      sawRisk = true;
      await shot('grenade_risk');
    }
    await page.keyboard.press('Escape');
    await sleep(60);
    return false;
  }
  await shot('grenade_aim');
  const a0 = await readUnit(alien.id);
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  await shot('grenade_flight');
  await idle(60000, 'granada');
  await shot('grenade_after');
  const a1 = await readUnit(alien.id);
  note('  GRANADA em ' + a0.name + ' («' + s.throwInfo.label + '») → ' + (!a1 || a1.status !== 'ok' ? a1 ? a1.status : 'desapareceu' : 'HP ' + a0.hp + '→' + a1.hp));
  stats.grenades++;
  actions++;
  return true;
}
async function throwFlare(id, ahead) {
  await page.keyboard.press('l');
  await sleep(120);
  if ((await st()).mode !== 'throw') return false;
  const p = await bringIntoView(tilePoint(ahead.x, ahead.y, ahead.z));
  if (!p) {
    await page.keyboard.press('Escape');
    return false;
  }
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await sleep(140);
  const s = await st();
  if (!s.throwInfo || !s.throwInfo.ok) {
    const why = await page.evaluate(([id, t]) => {
      const B = OV.Game.B, m = B.map, u = OV.BUnits.findUnit(B, id), i = (t.z * m.h + t.y) * m.w + t.x;
      const target = [t.x * 16 + 8, t.y * 16 + 8, t.z * 24 + 2], o = OV.LOS.originVoxel(B, u, target);
      return u.x + ',' + u.y + ' → ' + t.x + ',' + t.y + ' ' + [3, 0].map((c) => { const r = OV.Act.traceArc(B, u, o, target, c); return 'c' + c + ':' + r.arc[r.arc.length - 1].join('/'); }).join(' ');
    }, [id, ahead]);
    note('  sinalizador: ' + (s.throwInfo ? s.throwInfo.label : '—') + ' — cancelo (' + why + ')');
    await page.keyboard.press('Escape');
    return false;
  }
  await page.mouse.click(p.x, p.y);
  await idle(30000, 'sinalizador');
  note('  sinalizador lançado para ' + ahead.x + ',' + ahead.y + ' («' + s.throwInfo.label + '»)');
  stats.flares++;
  actions++;
  return true;
}
// tile à frente do soldado (em direção ao OVNI), ao alcance de arremesso
async function flareSpot(id) {
  return page.evaluate((id) => {
    const B = OV.Game.B, m = B.map, u = OV.BUnits.findUnit(B, id), R = B.ufo;
    if (!R) return null;
    const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
    const d = Math.hypot(cx - u.x, cy - u.y);
    if (d < 6) return null;
    const k = Math.min(9, d - 3) / d;
    const x = Math.round(u.x + (cx - u.x) * k), y = Math.round(u.y + (cy - u.y) * k);
    return { x: Math.max(0, Math.min(m.w - 1, x)), y: Math.max(0, Math.min(m.h - 1, y)), z: 0 };
  }, id);
}

// tile alcançável (guardando keep UT) donde a linha de tiro chega ao alienígena; o mais barato
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
      const o = OV.LOS.originVoxel(B, fake, aim);
      const tr = OV.LOS.traceShot(B, o, aim, u.id, 0);
      if (tr.kind === 'unit' && tr.unitId === a.id) return { x, y, z };
    }
    return null;
  }, [id, alienId, keep]);
}

// ---- um soldado no seu turno ---------------------------------------------------------------------------------
const stats = { shots: 0, kills: 0, grenades: 0, flares: 0, moves: 0, alienTurns: [], turns: 0 };
const total = { shots: 0, grenades: 0 };
let grenadeUsed = false, sawRisk = false;
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
      if (!kit.loaded && kit.gunHand) {
        await page.keyboard.press('r');
        await idle(20000, 'recarregar');
        note('  ' + u.name + ' recarrega (R)');
        continue;
      }
      let acted = false;
      if (!grenadeUsed && kit.grenades && u.tu >= 20) {
        for (const a of vis.filter((q) => Math.hypot(q.x - u.x, q.y - u.y) <= 14).slice(0, 2)) {
          acted = await tryGrenade(id, a);
          if (acted) {
            grenadeUsed = true;
            break;
          }
        }
      }
      for (const a of vis) {
        if (acted || !kit.gunHand) break;
        if (u.tu < kit.snapTU) break;
        acted = await tryShoot(id, a, kit);
      }
      if (acted) continue;
      // sem linha de tiro: procura um tile alcançável com linha de tiro e UT para um tiro rápido (uma vez)
      if (moved || u.tu < kit.snapTU + 8 || !kit.gunHand) return;
      const spot = await firingSpot(id, vis[0].id, kit.snapTU + 2);
      if (spot) {
        moved = true;
        await moveTo(id, spot, 'procura linha de tiro');
        stats.moves++;
        actions++;
        continue;
      }
      return;
    }
    if (moved && plan.flare && kit.flares && !plan.flareDone && u.tu >= 18) {
      // de noite: sinalizador à frente depois do lanço (de dentro da nave o teto não deixa)
      const spot = await flareSpot(id);
      if (spot && (await throwFlare(id, spot))) {
        plan.flareDone = true;
        continue;
      }
    }
    if (moved) {
      // fim do lanço: ajoelhar para o fogo de reação se sobrar UT
      if (plan.kneel && !u.kneel && u.tu >= 4 + kit.snapTU) {
        await page.keyboard.press('k');
        await idle(10000, 'ajoelhar');
      }
      return;
    }
    const keep = vis.length ? kit.snapTU : plan.keep === 'aimed' ? kit.aimedTU : plan.keep === 'none' ? 0 : kit.snapTU;
    if (!plan.move) {
      if (plan.kneel && !u.kneel && u.tu >= 4 + kit.snapTU) {
        await page.keyboard.press('k');
        await idle(10000, 'ajoelhar');
        note('  ' + u.name + ' fica de vigia (ajoelhado)');
      }
      return;
    }
    const pick = await pickMoveTile(id, { keep, maxAdvance: plan.maxAdvance, standoff: plan.standoff, climb: plan.climb });
    if (!pick.best) {
      note('  ' + u.name + ': sem destino útil (campo ' + pick.hereField + ')');
      return;
    }
    moved = true;
    const ok = await moveTo(id, pick.best, 'avança');
    if (ok) stats.moves++;
    actions++;
    if (needShot()) await shot('move');
  }
}

// ---- avisos do jogo (toasts e banners) vão para o registo -----------------------------------------------------
async function watchToasts() {
  await page.evaluate(() => {
    if (window.__qaToasts) return;
    window.__qaToasts = [];
    const host = document.getElementById('toasts');
    if (!host) return;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.textContent) window.__qaToasts.push(n.textContent.trim());
    }).observe(host, { childList: true, subtree: false });
  });
}
async function flushToasts() {
  const list = await page.evaluate(() => { const l = window.__qaToasts || []; window.__qaToasts = []; return l; });
  if (list.length) note('  avisos: ' + list.map((t) => '«' + t + '»').join(' '));
}

// ---- turnos -----------------------------------------------------------------------------------------------------
async function endTurn() {
  const s0 = await st();
  const turn = s0.turn;
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await sleep(250);
  if (await page.locator('#modals .modal').count()) {
    await page.locator('#modals .btn.primary').first().click();
  }
  let sawHidden = false;
  for (let k = 0; k < 2400; k++) {
    await sleep(50);
    if (!sawHidden && (await page.evaluate(() => !!document.querySelector('.bs-hidden.on')))) {
      sawHidden = true;
      if (turn <= 2 || turn % 5 === 0) await shot('t' + turn + '_hidden');
    }
    const s = await st();
    if (s.gone || s.ended) break;
    if (s.side === 'xcom' && s.turn > turn && !s.playing) break;
    if (Date.now() - t0 > 120000) {
      check(false, 'turno alienígena ' + turn + ' preso há mais de 120 s');
      await shot('alien_stuck');
      throw new Error('turno alienígena preso');
    }
  }
  const ms = Date.now() - t0;
  stats.alienTurns.push(ms);
  await flushToasts();
  note('fim do turno ' + turn + ': turno alienígena ' + (ms / 1000).toFixed(1) + ' s' + (sawHidden ? ' (Movimento Oculto)' : ''));
  if (ms > ALIEN_TURN_SLOW_MS) check(false, 'turno alienígena ' + turn + ' lento: ' + (ms / 1000).toFixed(1) + ' s');
  await idle(30000, 'início do turno');
}

async function report(prefix) {
  const B = await page.evaluate(() => {
    const B = OV.Game.B;
    const sq = B.units.filter((u) => u.origSide === 'xcom' || u.side === 'xcom');
    return { turn: B.turn, alive: sq.filter((u) => u.status === 'ok' && u.onMap).length, dead: sq.filter((u) => u.status === 'dead').length,
      aliens: B.units.filter((u) => u.side === 'alien' && (u.status === 'ok' || u.status === 'panic')).length };
  });
  note(prefix + ' turno ' + B.turn + ': soldados vivos ' + B.alive + ' (mortos ' + B.dead + '), alienígenas ativos ' + B.aliens);
}

async function playBattle(night) {
  grenadeUsed = false;
  let turnN = 0;
  while (turnN < MAX_TURNS) {
    let s = await st();
    if (s.gone || s.ended) break;
    turnN = s.turn;
    stats.turns = turnN;
    await report('início do');
    if (turnN === 1 || turnN % 4 === 0) await shot('t' + turnN + '_start');
    const ids = await liveSquad();
    const order = await squadIds();
    // lanços: metade da equipa avança (alternando por turno), a outra fica ajoelhada com UT para reagir;
    // até ao turno 5 cerca o OVNI a ≥ 5 tiles, depois entra
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
    fields.sort((a, b) => b.f - a.f); // de trás para a frente
    // alienígenas à vista no início do turno: primeiro quem tem granada e UT inteiras
    if (!grenadeUsed && (await st()).visibleAliens.length) {
      const g = [];
      for (const q of fields) g.push((await kitOf(q.id)).grenades > 0);
      const idx = fields.map((q, k) => k).sort((a, b) => (g[b] ? 1 : 0) - (g[a] ? 1 : 0) || a - b);
      const re = idx.map((k) => fields[k]);
      fields.length = 0;
      fields.push(...re);
    }
    const assault = turnN >= 5;
    let flareDone = false;
    for (const q of fields) {
      s = await st();
      if (s.gone || s.ended) break;
      const plan = {
        move: (q.k + turnN) % 2 === 0 || q.f > front + 40 || assault,
        maxAdvance: 999, standoff: assault ? 0 : 5, keep: 'snap', kneel: true, climb: assault,
        flare: night && !flareDone, flareDone: false,
      };
      await soldierTurn(q.id, plan);
      if (plan.flareDone) flareDone = true;
    }
    await flushToasts();
    s = await st();
    if (s.gone || s.ended) break;
    if ((await aliensLeft()) === 0) break;
    await endTurn();
  }
  let s = await st();
  if (!s.gone && !s.ended) {
    note('limite de ' + MAX_TURNS + ' turnos: abortar a missão pelo botão');
    await page.locator('.bs-btn.danger').first().click();
    await sleep(250);
    await shot('abort_confirm');
    await page.locator('#modals .btn.danger').first().click();
  }
}

async function waitDebrief() {
  try {
    await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'debrief', null, { timeout: 30000 });
  } catch (e) {
    check(false, 'o debriefing não apareceu (cena ' + (await topScene()) + ')');
    await shot('no_debrief');
    throw e;
  }
  await sleep(500);
  await shot('debrief');
  const txt = await page.evaluate(() => {
    const r = document.querySelector('.scr-result');
    const tot = document.querySelector('.scr-total');
    return (r ? r.textContent : '?') + ' · ' + (tot ? tot.textContent.replace(/\s+/g, ' ') : '');
  });
  note('debriefing: ' + txt);
  const btn = page.locator('.scr-deb button.btn.primary', { hasText: 'Continuar' });
  check((await btn.count()) === 1, 'botão «Continuar» no debriefing');
  await btn.click();
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 10000 });
  check(true, '«Continuar» volta ao menu');
  await sleep(300);
}

// ---- menu → batalha ---------------------------------------------------------------------------------------------
async function segClick(rowLabel, optLabel) {
  const row = page.locator('.scr-frow', { has: page.locator('.scr-flabel', { hasText: new RegExp('^' + rowLabel + '$') }) });
  const b = row.locator('.scr-seg-b', { hasText: new RegExp('^' + optLabel + '$') });
  if (!(await b.count())) {
    check(false, 'opção «' + optLabel + '» em «' + rowLabel + '» não encontrada');
    return;
  }
  await b.first().click();
  await sleep(60);
}
async function startFromMenu(ufoLabel, timeLabel, diffLabel, seed) {
  const t0 = Date.now();
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 20000 });
  await sleep(400);
  await shot('menu');
  await watchToasts();
  await page.locator('.scr-mi', { hasText: 'Batalha Rápida' }).click();
  await page.waitForSelector('.scr-qb');
  await sleep(250);
  await segClick('Missão', 'OVNI Despenhado');
  await segClick('OVNI', ufoLabel);
  await segClick('Hora', timeLabel);
  await segClick('Dificuldade', diffLabel);
  await page.locator('.scr-seed').fill(String(seed));
  await page.locator('.scr-seed').press('Tab');
  await sleep(200);
  await shot('quickbattle');
  await page.locator('.scr-qb button.btn.primary', { hasText: 'Começar' }).click();
  await page.waitForSelector('.scr-brief');
  await sleep(400);
  await shot('briefing');
  note('menu → briefing em ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const t1 = Date.now();
  await page.locator('.scr-brief button.btn.primary', { hasText: 'Iniciar Missão' }).click();
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 30000 });
  note('«Iniciar Missão» → batalha em ' + ((Date.now() - t1) / 1000).toFixed(1) + ' s');
  await idle(60000, 'abertura');
  await page.evaluate(() => { window.__qaB = OV.Game.B; }); // referência só para ler o resultado depois do fim
  note('abertura (primeiro turno jogável) em ' + ((Date.now() - t1) / 1000).toFixed(1) + ' s');
  const s = await st();
  const m = await page.evaluate(() => ({ kind: OV.Game.B.mission.kind, ufo: OV.Game.B.mission.ufoType || OV.Game.B.mission.ufo, night: !!OV.Game.B.mission.night, diff: OV.Game.B.mission.difficulty, map: OV.Game.B.map.w + '×' + OV.Game.B.map.h + '×' + OV.Game.B.map.d }));
  check(s.turn === 1 && s.side === 'xcom', 'batalha aberta: ' + JSON.stringify(m));
  return m;
}
// opções pela interface (Esc): velocidades e «Confirmar movimento»
async function setOptions(speed, confirm) {
  await page.mouse.move(700, 300);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'options', null, { timeout: 5000 });
  await sleep(200);
  const row = (label) => page.locator('.scr-orow', { has: page.locator('.scr-olabel span', { hasText: new RegExp('^' + label + '$') }) });
  if (speed) {
    await row('Movimento X-COM').locator('.scr-seg-b[data-v="' + speed + '"]').click();
    await row('Movimento alienígena').locator('.scr-seg-b[data-v="' + speed + '"]').click();
  }
  if (confirm) await row('Confirmar movimento').locator('.scr-seg-b', { hasText: confirm }).click();
  await shot('options');
  await page.locator('.scr-opts button.btn.primary', { hasText: 'Fechar' }).click();
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'battlescape', null, { timeout: 5000 });
  const set = await page.evaluate(() => OV.Game.settings);
  note('opções: X-COM ×' + set.speedXcom + ', alienígenas ×' + set.speedAlien + ', confirmar movimento ' + set.confirmMove);
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor http não arrancou');
  browser = await chromium.launch({ headless: !argv.includes('--headed') });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('consola: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('página: ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1');

  if (ONLY !== 'night') {
    tag = 'dia';
    await startFromMenu('Batedor Pequeno', 'Dia', 'Recruta', SEED_DAY);
    await shot('battle_start');
    await playBattle(false);
    const res = await page.evaluate(() => { const B = window.__qaB; return B ? B.result || OV.Battle.outcome(B) : null; });
    note('resultado: ' + res + ' em ' + stats.turns + ' turnos; tiros ' + stats.shots + ', mortos ' + stats.kills + ', granadas ' + stats.grenades + ', movimentos ' + stats.moves);
    total.shots += stats.shots;
    total.grenades += stats.grenades;
    check(res === 'win', 'vitória no Batedor Pequeno de dia (Recruta)');
    await waitDebrief();
  }

  if (ONLY !== 'day') {
    tag = 'noite';
    Object.assign(stats, { shots: 0, kills: 0, grenades: 0, flares: 0, moves: 0, alienTurns: [], turns: 0 });
    if (ONLY === 'night') await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 20000 });
    await startFromMenu('Batedor Médio', 'Noite', 'Recruta', SEED_NIGHT);
    await setOptions('4', 'Sempre');
    await shot('battle_start');
    await playBattle(true);
    const res = await page.evaluate(() => { const B = window.__qaB; return B ? B.result || OV.Battle.outcome(B) : null; });
    note('resultado: ' + res + ' em ' + stats.turns + ' turnos; tiros ' + stats.shots + ', mortos ' + stats.kills + ', sinalizadores ' + stats.flares + ', granadas ' + stats.grenades);
    total.shots += stats.shots;
    total.grenades += stats.grenades;
    check(stats.flares >= 1, 'sinalizadores lançados de noite');
    check(res === 'win' || res === 'loss' || res === 'abort', 'batalha noturna terminada (' + res + ')');
    await waitDebrief();
  }
  if (!ONLY) {
    tag = '';
    check(total.shots >= 1, 'tiros disparados: ' + total.shots);
    check(total.grenades >= 1, 'granadas lançadas: ' + total.grenades);
  }
  if (mismatchedHovers) note('aviso: ' + mismatchedHovers + ' vez(es) o cursor caiu noutro tile (unidade/objeto à frente)');
  const missing = await page.evaluate(() => document.body.innerText.match(/⟦[^⟧]+⟧/g) || []);
  check(!missing.length, 'chaves i18n em falta: ' + (missing.join(', ') || 'nenhuma'));
} catch (e) {
  fails.push('exceção: ' + (e && e.message ? e.message.split('\n')[0] : e));
  note('EXCEÇÃO ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  try { await shot('exception'); } catch (_) { /* página fechada */ }
} finally {
  for (const e of errors) note('✗ ' + e);
  fs.writeFileSync(path.join(OUT, 'log.txt'), lines.join('\n') + '\n');
  if (browser) await browser.close();
  server.kill();
}
const bad = fails.length + errors.length;
console.log(bad ? '✗ ' + fails.length + ' falha(s), ' + errors.length + ' erro(s) — ' + OUT : '✓ tudo verde — capturas e registo em ' + OUT);
process.exit(bad ? 1 : 0);
