#!/usr/bin/env node
/* Simulador headless de batalhas (DESIGN.md §19.2–19.4): playerBot (OV.AI, lado X-COM) contra a IA alienígena até ao
   fim (limite de turnos), com invariantes verificados depois de cada evento.

   node ovni-1999/tools/sim.js battle --ufo small_scout --terrain FARM --night 0 --diff 1 --month 0 --seeds 20 --squad 8
     --ufo all        varre todos os OVNIs + local de terror, base alienígena e Cidónia (equipamento do mês)
     --kind terror|alienBase|cydonia   missão sem OVNI ; --seed0 N  primeira semente ; --turns 40  limite
     --det            corre cada semente duas vezes e exige o mesmo hash final
     --save-at 5      grava no início do turno 5, recarrega, continua e compara o hash final
     --vet            equipa veterana para o mês (ganhos de atributos de ~2 missões por mês de campanha)
     --heavy          meses 0–2: Canhão Pesado (HE) e Lança-Foguetes do equipamento inicial em dois soldados
     --race R         raça fixa (sectoid, floater, snakeman, muton, ethereal); sem ela, terror usa raceSchedule
     --squad N        soldados (omissão 8; base alienígena e Cidónia: a nave cheia — Skyranger 10, Avenger 12)
   Locais de terror: raça pelo calendário da campanha (Data.raceSchedule.alien_terror); missões escuras (base alienígena,
   Marte) levam very-lights; dois soldados levam uma granada de fumo.
     --quiet / --verbose
   Código de saída ≠ 0 em qualquer exceção, falha de invariante ou divergência de hash.
   Também é um módulo: require('./sim.js') → {runBattle, missionFor, checkInvariants, SWEEP, TARGETS}. */
'use strict';

const OV = require('./load')({ finalize: true });

// ---- invariantes (DESIGN §19.4) ------------------------------------------------------------------------------
const LIVE = { ok: 1, panic: 1 };
const NUM_FIELDS = ['x', 'y', 'z', 'tu', 'tuMax', 'energy', 'hp', 'stun', 'morale', 'dir'];

function checkInvariants(B, ev, st) {
  const errs = [];
  const m = B.map;
  if (st.ended) errs.push('evento depois do fim da batalha: ' + (ev && ev.t));
  if (ev && ev.t === 'battleEnd') st.ended = true;
  const expect = new Int32Array(m.n);
  for (const u of B.units) {
    for (const k of NUM_FIELDS) if (typeof u[k] === 'number' && !Number.isFinite(u[k])) errs.push('NaN em ' + u.id + '.' + k);
    if ((u.tu | 0) < 0 || u.tu < 0) errs.push('tu < 0 em ' + u.id + ' (' + u.tu + ')');
    if (u.energy < 0) errs.push('energia < 0 em ' + u.id);
    if (!(LIVE[u.status] && u.onMap && u.x >= 0)) continue;
    const tiles = OV.BUnits.unitTiles(u, m);
    const falling = ev && ev.t === 'step' && ev.unitId === u.id && ev.kind === 'fall';
    let floor = false;
    for (const i of tiles) {
      if (i < 0 || i >= m.n) { errs.push('unidade fora do mapa ' + u.id); continue; }
      const o = OV.BMap.objectDef(m, i);
      if (o && o.fullBlock) errs.push('unidade ' + u.id + ' dentro de bloco cheio em ' + i);
      if (OV.BMap.hasFloor(m, i)) floor = true;
      if (expect[i]) errs.push('duas unidades no tile ' + i);
      expect[i] = u.id + 1;
    }
    if (!floor && !u.float && !falling) errs.push('unidade ' + u.id + ' sem chão em ' + tiles[0]);
  }
  const ua = B._ && B._.unitAt;
  if (ua) for (let i = 0; i < m.n; i++) if (ua[i] !== expect[i]) { errs.push('unitAt inconsistente no tile ' + i); break; }
  for (const it of B.items) {
    const owned = it.owner !== null && it.owner !== undefined;
    const ground = it.at !== null && it.at !== undefined;
    if (owned === ground) errs.push('item ' + it.id + ' ' + (owned ? 'com dono e no chão' : 'sem dono nem chão'));
    if (owned) {
      const o = OV.BUnits.findUnit(B, it.owner);
      if (!o || OV.BUnits.slotOf(o, it.id) === null) errs.push('item ' + it.id + ' com dono que não o tem');
    }
    for (const k of ['rounds', 'fuse']) if (typeof it[k] === 'number' && !Number.isFinite(it[k])) errs.push('NaN no item ' + it.id);
    if (it.ammo && !Number.isFinite(it.ammo.rounds)) errs.push('NaN nas munições do item ' + it.id);
  }
  // unidades visíveis ⊆ campo de visão do lado
  if (B._ && B._.visible && B._.sees) {
    for (const side of ['xcom', 'alien']) {
      const vis = B._.visible[side];
      if (!vis) continue;
      for (const id of vis) {
        let ok = false;
        for (const u of B.units) {
          if (u.side === side && B._.sees[u.id] && B._.sees[u.id].has(id)) { ok = true; break; }
        }
        if (!ok) { errs.push('unidade ' + id + ' visível para ' + side + ' sem observador'); break; }
      }
    }
  }
  return errs;
}

// esgota um gerador verificando os invariantes a cada evento
function drain(gen, B, st) {
  let r;
  while (!(r = gen.next()).done) {
    st.events++;
    if (st.check) {
      const errs = checkInvariants(B, r.value, st);
      if (errs.length) {
        const e = new Error('invariante (turno ' + B.turn + ', evento ' + r.value.t + '): ' + errs.slice(0, 4).join('; '));
        e.invariant = true;
        throw e;
      }
    }
  }
  return r.value;
}

// ---- missões -------------------------------------------------------------------------------------------------
const UFOS = ['small_scout', 'medium_scout', 'large_scout', 'harvester', 'abductor', 'supply_ship', 'terror_ship', 'battleship'];
// mês do varrimento por tipo (equipamento do mês: 0–2 espingarda, 3–5 laser + armadura, Cidónia fato + plasma pesado)
const SWEEP = [
  { id: 'small_scout', ufo: 'small_scout', month: 0 }, { id: 'medium_scout', ufo: 'medium_scout', month: 0 },
  { id: 'large_scout', ufo: 'large_scout', month: 1 }, { id: 'harvester', ufo: 'harvester', month: 1 },
  { id: 'abductor', ufo: 'abductor', month: 1 }, { id: 'supply_ship', ufo: 'supply_ship', month: 2 },
  { id: 'terror_ship', ufo: 'terror_ship', month: 3 }, { id: 'battleship', ufo: 'battleship', month: 3 },
  { id: 'terror', kind: 'terror', month: 1 }, { id: 'alienBase', kind: 'alienBase', month: 3 },
  { id: 'cydonia', kind: 'cydonia', month: 6 },
];
// metas de DESIGN §19.3 (vitórias %, baixas máximas médias)
const TARGETS = {
  small_scout: { win: 95, losses: 1 }, medium_scout: { win: 95, losses: 1 }, large_scout: { win: 95, losses: 1 },
  abductor: { win: 80, losses: 2 }, terror: { win: 70, losses: 3 }, battleship: { win: 70 }, alienBase: { win: 50 }, cydonia: { win: 60 },
};

// ganhos por mês de campanha (≈ 2 missões/mês, DESIGN §3.2: +1..+4 por estatística usada) — só com --vet
const VET_GAIN = { tu: 2, sta: 2, hp: 1, react: 3, fire: 4, thr: 2, str: 1, brav: 5 };
function veteranSquad(squad, month) {
  const caps = OV.Data.soldierGen.caps;
  for (const s of squad) {
    for (const k of Object.keys(VET_GAIN)) s.stats[k] = Math.min(caps[k], (s.stats[k] | 0) + VET_GAIN[k] * month);
    s.missions = 2 * month;
    s.rank = Math.min(5, (s.rank | 0) + (month >> 1));
  }
}

// soldados por omissão: 8 (DESIGN §19.3); assaltos planeados (base alienígena, Cidónia) levam a nave cheia
function defaultSquad(kind) {
  const craft = kind === 'cydonia' ? 'avenger' : kind === 'alienBase' ? 'skyranger' : null;
  return craft ? OV.Data.crafts[craft].seatsUI || 8 : 8;
}

/* Equipamento final realista para Cidónia (o que a campanha terá no fim): fatos energéticos (dois fatos de voo),
   Plasma Pesado com dois carregadores e uma granada alienígena; dois soldados com Lança-Bombas Blaster e duas bombas;
   dois kits médicos. Os very-lights ficam se a missão for escura. */
function cydoniaKit(squad) {
  squad.forEach((s, k) => {
    const flares = s.loadout.belt.filter((x) => x === 'electro_flare');
    s.armour = k % 4 === 3 ? 'flying_suit' : 'power_suit';
    if (k === 1 || k === 4) {
      s.loadout.R = 'blaster_launcher';
      s.loadout.belt = ['blaster_bomb', 'blaster_bomb'].concat(flares);
    } else {
      s.loadout.R = 'heavy_plasma';
      s.loadout.belt = ['heavy_plasma_clip', 'heavy_plasma_clip', 'alien_grenade'].concat(flares);
    }
    s.loadout.pack = s.loadout.pack.filter((x) => x !== 'medikit');
    if (k === 2 || k === 5) s.loadout.pack.push('medikit');
  });
}

/* --heavy (meses 0–2): as armas pesadas do equipamento inicial (Skyranger e armazém, Data.startBase) — um Canhão
   Pesado com munição HE e um Lança-Foguetes com foguetes pequenos, como um jogador os levaria contra Ciberdiscos e
   Crisálidas. */
function heavyKit(squad) {
  const set = (s, R, belt) => {
    s.loadout.R = R;
    s.loadout.belt = belt.concat(s.loadout.belt.filter((x) => x === 'electro_flare' || x === 'grenade').slice(0, 2));
  };
  if (squad[3]) set(squad[3], 'heavy_cannon', ['hc_he', 'hc_ap']);
  if (squad[4]) set(squad[4], 'rocket_launcher', ['small_rocket', 'small_rocket']);
}

function missionFor(o) {
  const kind = o.kind || null;
  const terrain = kind === 'terror' ? 'URBAN' : kind === 'alienBase' ? 'ALIENBASE' : kind === 'cydonia' ? 'MARS' : o.terrain || 'FARM';
  const mission = OV.Battle.quickMission({
    ufoType: kind ? undefined : o.ufo || 'small_scout', terrain, kind: kind || undefined, night: !!o.night,
    difficulty: o.diff === undefined ? 1 : o.diff, month: o.month | 0, squadSize: o.squad || defaultSquad(kind), seed: o.seed >>> 0,
    race: o.race || undefined, // terror: Battle.quickMission usa o calendário da campanha (raceSchedule.alien_terror)
  });
  // base alienígena e Marte são escuros (sombra > DARK_SHADE): a equipa leva very-lights como numa missão noturna
  const dark = OV.Battle.normalizeMission(mission).night;
  if (dark && !o.night) for (const s of mission.squad) if (s.loadout.belt.indexOf('electro_flare') < 0) s.loadout.belt.push('electro_flare');
  // granadas de fumo (5 nas reservas iniciais): duas na mochila de dois soldados, como um jogador as levaria
  mission.squad.forEach((s, k) => {
    if (k === 1 || k === 2) s.loadout.pack.push('smoke_grenade');
  });
  // --vet: equipa com a experiência típica do mês de campanha (ganhos de atributos por missões, até aos limites)
  if (o.vet) veteranSquad(mission.squad, o.month | 0);
  if (o.heavy && (o.month | 0) < 3) heavyKit(mission.squad);
  if (kind === 'cydonia') cydoniaKit(mission.squad);
  return mission;
}

function nowMs() {
  const t = process.hrtime();
  return t[0] * 1e3 + t[1] / 1e6;
}

/* Uma batalha completa → {outcome, turns, xcomDead, aliensKilled, aliensStunned, crashDead, aliens, hash, msPerTurn, events}.
   o.saveAt: grava/recarrega no início desse turno X-COM. */
function runBattle(o) {
  const st = { ended: false, events: 0, check: o.check !== false };
  const mission = missionFor(o);
  let B = OV.Battle.create(mission);
  const cap = o.turns || 40;
  const aliens = B.units.filter((u) => u.side === 'alien').length;
  drain(OV.Battle.beginBattle(B), B, st);
  let ms = 0, rounds = 0, saved = false;
  while (B.phase !== 'over' && B.turn <= cap) {
    if (o.saveAt && !saved && B.turn === o.saveAt) {
      saved = true;
      const json = JSON.stringify(OV.Battle.serialize(B));
      B = OV.Battle.deserialize(JSON.parse(json));
      OV.LOS.refreshAll(B);
    }
    const t0 = nowMs();
    drain(OV.AI.turn(B, 'xcom'), B, st);
    if (B.phase !== 'over') drain(OV.Battle.endPlayerTurn(B), B, st);
    ms += nowMs() - t0;
    rounds++;
  }
  const outcome = B.phase === 'over' ? B.result || OV.Battle.outcome(B) : 'cap';
  const xcomDead = B.units.filter((u) => u.origSide === 'xcom' && u.status === 'dead').length;
  return {
    outcome, turns: B.turn, xcomDead, aliensKilled: B.stats.aliensKilled, aliensStunned: B.stats.aliensStunned,
    crashDead: B.stats.crashDead, aliens, hash: OV.Battle.hash(B), msPerTurn: rounds ? ms / rounds : 0, events: st.events,
    race: B.mission.race, B,
  };
}

// ---- CLI -------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    } else args._.push(a);
  }
  return args;
}
const median = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length & 1 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pad = (s, n) => String(s).padEnd(n);

function runSet(label, base, args, failures) {
  const seeds = args.seeds === undefined ? 20 : +args.seeds;
  const seed0 = args.seed0 === undefined ? 1 : +args.seed0;
  const quiet = !!args.quiet;
  const rows = [];
  for (let k = 0; k < seeds; k++) {
    const o = Object.assign({}, base, { seed: seed0 + k });
    let r;
    try {
      r = runBattle(o);
      if (args.det) {
        const r2 = runBattle(o);
        if (r2.hash !== r.hash) failures.push(label + ' semente ' + o.seed + ': hash diferente na repetição (' + r.hash + ' ≠ ' + r2.hash + ')');
      }
      if (args['save-at']) {
        const r3 = runBattle(Object.assign({}, o, { saveAt: +args['save-at'] }));
        if (r3.hash !== r.hash) failures.push(label + ' semente ' + o.seed + ': hash diferente depois de gravar/carregar no turno ' + args['save-at']);
      }
    } catch (e) {
      failures.push(label + ' semente ' + o.seed + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n  ') : e));
      if (!quiet) console.log('  ' + pad(label, 13) + ' semente ' + pad(o.seed, 4) + ' ERRO ' + (e && e.message));
      continue;
    }
    rows.push(r);
    if (!quiet) {
      console.log('  ' + pad(label, 13) + ' semente ' + pad(o.seed, 4) + pad(r.outcome, 6) + ' turnos ' + pad(r.turns, 3) + ' mortos X-COM ' + pad(r.xcomDead, 2)
        + ' alien. ' + pad(r.aliens, 2) + ' (mortos ' + r.aliensKilled + ', atord. ' + r.aliensStunned + ', queda ' + r.crashDead + ') '
        + pad(r.race, 9) + ' ' + r.msPerTurn.toFixed(1) + ' ms/turno');
    }
  }
  const wins = rows.filter((r) => r.outcome === 'win');
  const sum = {
    label, n: rows.length, winPct: rows.length ? Math.round((100 * wins.length) / rows.length) : 0,
    medianTurns: median(rows.map((r) => r.turns)), avgLosses: rows.length ? rows.reduce((s, r) => s + r.xcomDead, 0) / rows.length : 0,
    losses: rows.filter((r) => r.outcome === 'loss').length, caps: rows.filter((r) => r.outcome === 'cap').length,
    msPerTurn: rows.length ? rows.reduce((s, r) => s + r.msPerTurn, 0) / rows.length : 0,
  };
  const tg = TARGETS[label];
  const tgs = tg ? '  meta ' + tg.win + ' %' + (tg.losses !== undefined ? ' / ≤ ' + tg.losses + ' baixas' : '') : '';
  console.log('= ' + pad(label, 13) + ' vitórias ' + pad(sum.winPct + ' %', 6) + ' turnos (mediana) ' + pad(sum.medianTurns, 5)
    + ' baixas X-COM/batalha ' + pad(sum.avgLosses.toFixed(2), 5) + ' derrotas ' + pad(sum.losses, 3) + ' limite ' + pad(sum.caps, 3)
    + sum.msPerTurn.toFixed(1) + ' ms/turno' + tgs);
  return sum;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'battle';
  if (cmd !== 'battle' && cmd !== 'battles') {
    console.log('uso: node ovni-1999/tools/sim.js battle [--ufo tipo|all] [--kind terror|alienBase|cydonia] [--terrain T] [--night 0|1] [--diff 0..2] [--month n] [--seeds n] [--squad n] [--det] [--save-at turno]');
    process.exit(2);
  }
  for (const e of OV.__loadErrors || []) console.log('✗ carregar ' + e);
  if ((OV.__loadErrors || []).length || OV.__finalizeError) process.exit(1);
  const common = {
    terrain: args.terrain || 'FARM', night: args.night === undefined ? false : args.night === true || +args.night === 1,
    diff: args.diff === undefined ? 1 : +args.diff, squad: args.squad === undefined ? 0 : +args.squad,
    race: args.race && args.race !== true ? args.race : undefined,
    turns: args.turns === undefined ? 40 : +args.turns, vet: !!args.vet, heavy: !!args.heavy,
  };
  const failures = [];
  const sums = [];
  const t0 = Date.now();
  if (args.ufo === 'all') {
    for (const s of SWEEP) {
      const month = args.month === undefined ? s.month : +args.month;
      const base = Object.assign({}, common, { ufo: s.ufo, kind: s.kind, month });
      sums.push(runSet(s.id, base, args, failures));
    }
  } else {
    const kind = args.kind && args.kind !== true ? args.kind : null;
    const ufo = kind ? null : args.ufo && args.ufo !== true ? args.ufo : 'small_scout';
    if (ufo && UFOS.indexOf(ufo) < 0) {
      console.log('OVNI desconhecido: ' + ufo);
      process.exit(2);
    }
    const base = Object.assign({}, common, { ufo, kind, month: args.month === undefined ? (kind === 'cydonia' ? 6 : 0) : +args.month });
    sums.push(runSet(kind || ufo, base, args, failures));
  }
  if (sums.length > 1) {
    const all = sums.reduce((a, s) => a + s.n, 0);
    console.log('total: ' + all + ' batalhas em ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }
  for (const f of failures) console.log('✗ ' + f);
  process.exit(failures.length ? 1 : 0);
}

module.exports = { runBattle, missionFor, checkInvariants, drain, SWEEP, TARGETS, UFOS };
if (require.main === module) main();
