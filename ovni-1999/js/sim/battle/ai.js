/* IA da batalha (DESIGN.md §11; REA 03 §11 — AlienBAIState do OpenXcom): alienígenas, civis e o playerBot
   (X-COM automático, só para testes headless e varrimentos de equilíbrio). Toda a mudança de B passa por
   OV.Act.perform (yield* dos seus eventos: animações e fogo de reação acontecem naturalmente). Decisões só com
   B.rng.ai; aritmética inteira.

   OV.AI.turn(B, side 'alien'|'civ'|'xcom', profile?) → Generator<Event>, devolve {actions}
   OV.AI.think(B, u, ctx?) → action | null          (ctx = turnContext(B, u.side); fila de planos em ctx.queue)
   OV.AI.profile                                      definições do playerBot (agressão 1, inteligência 10, …)
   Auxiliares exportados: turnContext, unitContext, modeWeights, chooseMode, grenadeEfficacy, fireModes, arms,
     knownEnemies, attackTU, recordSightings, cheatNow, MODES, PROFILES,
     patrolReserve(B, u, c, modes?) → UT guardadas (sem modes: 1/2, 2/5 ou 1/3 das UT base pela agressividade),
     explosivePlan(B, u, c, ctx) → ação (granada: inv/prime/throw em ctx.queue; bomba do blaster) | null.
   TUNE lidas: CHEAT_TURN, AI_MAX_ACTIONS, AI_PASSES, AI_GRENADE_FROM_TURN, TU_PSI, TU_KNEEL, TU_STAND, DARK_SHADE e
     AI_MIND_CONTROL (omissão false: no MVP a IA só usa Pânico; true ativa o Controlo Mental com controlOdds).
   Estado novo em B (JSON): B.cheat (já existia; fica true a partir do turno de batota), B.aiMem = {xcom:{seen:{id:turno},
     goal, visited:[nó]}}. Em cada unidade: u.ai.mode, u.ai.aggroId, u.ai.node, u.ai.memory {goal, failed}. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const idiv = U.idiv;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const LIVE = { ok: 1, panic: 1 };
  const MODES = ['combat', 'patrol', 'ambush', 'escape'];

  // definições do playerBot (DESIGN §11.10): também servem de modelo para perfis de teste
  const PLAYER_BOT = Object.freeze({
    aggression: 1, intelligence: 10, flares: true, retreatPct: 33, medikit: true, grenades: true, kneelAimed: true,
    cover: true, reserve: 'aimed', cohesion: 7, advance: 100, maxActions: 5, passes: 2,
  });
  const PROFILES = Object.freeze({
    alien: Object.freeze({ aggression: null, intelligence: null, maxActions: null, passes: null }),
    civ: Object.freeze({ maxActions: 2, passes: 1 }),
    playerBot: PLAYER_BOT,
  });

  // ---- utilitários -----------------------------------------------------------------------------------------
  function derived(B) {
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    return B._;
  }
  const active = (u) => !!u && LIVE[u.status] === 1 && u.onMap && u.x >= 0;
  const hostile = (a, b) => (a === 'alien') !== (b === 'alien');
  const tileOf = (B, u) => (u && u.x >= 0 ? (u.z * B.map.h + u.y) * B.map.w + u.x : -1);
  const over = (B) => B.phase === 'over' || B.aborted || !!(OV.Battle && OV.Battle.outcome && OV.Battle.outcome(B));
  const defOf = (it) => (it ? D().items[it.type] || null : null);
  const hasMode = (type, mode) => D().weaponModes(type).some((m) => m.mode === mode);

  // distância em tiles (euclidiana 3-D arredondada, como Morale.tileDist)
  function tdist(ax, ay, az, bx, by, bz) {
    const dx = ax - bx, dy = ay - by, dz = az - bz;
    const n = dx * dx + dy * dy + dz * dz;
    const r = U.isqrt(n);
    return n - r * r > r ? r + 1 : r;
  }
  const udist = (a, b) => tdist(a.x, a.y, a.z, b.x, b.y, b.z);
  function idist(m, i, u) {
    const [x, y, z] = BM().xyz(m, i);
    return tdist(x, y, z, u.x, u.y, u.z);
  }
  // distância entre retângulos (0 sobrepostos, 1 adjacentes), no plano
  function rectGap(ax, ay, as, bx, by, bs) {
    const gx = Math.max(0, bx - (ax + as - 1), ax - (bx + bs - 1));
    const gy = Math.max(0, by - (ay + as - 1), ay - (by + bs - 1));
    return Math.max(gx, gy);
  }
  const sees = (B, viewer, target) => !!(B._ && B._.sees && B._.sees[viewer.id] && B._.sees[viewer.id].has(target.id));
  const valid = (B, a) => !!a && OV.Act.validate(B, a).ok;

  // ---- memória do playerBot e avistamentos -------------------------------------------------------------------
  function mem(B) {
    if (!B.aiMem || typeof B.aiMem !== 'object') B.aiMem = {};
    if (!B.aiMem.xcom) B.aiMem.xcom = { seen: {}, goal: -1, visited: [] };
    return B.aiMem.xcom;
  }
  // alienígenas que a X-COM vê agora ficam memorizados (turno do último avistamento)
  function recordSightings(B) {
    if (!OV.LOS || !B._ || !B._.visible || !B._.visible.xcom) return;
    const M = mem(B);
    for (const id of B._.visible.xcom) {
      const t = BU().findUnit(B, id);
      if (t && t.side === 'alien' && LIVE[t.status]) M.seen[id] = B.turn;
    }
  }

  // ---- armamento -------------------------------------------------------------------------------------------
  function hasAmmo(it) {
    const def = defOf(it);
    if (!def) return false;
    if (Array.isArray(def.ammo) && def.ammo.length) return !!(it.ammo && it.ammo.rounds > 0);
    return def.power !== undefined;
  }
  function ammoDef(it) {
    const def = defOf(it);
    if (!def) return null;
    if (Array.isArray(def.ammo) && def.ammo.length) return it.ammo ? D().items[it.ammo.type] || null : null;
    return def;
  }
  function usable(B, u, type) {
    const list = B.researched || (B.mission && B.mission.researched);
    if (u.origSide !== 'xcom' || !Array.isArray(list)) return true;
    const def = D().items[type];
    return !def || !def.research || list.indexOf(def.research) >= 0;
  }
  /* O que a unidade pode usar: arma de fogo carregada, corpo a corpo, recarga possível, granadas, flare, medikit, psi. */
  function arms(B, u) {
    const out = { gun: null, melee: null, reload: null, empty: null, grenades: [], flare: null, medikit: null, psi: !!u.psi };
    for (const hand of ['R', 'L']) {
      const it = BU().item(B, u, hand);
      const def = defOf(it);
      if (!def || !usable(B, u, it.type)) continue;
      if (def.kind === 'firearm') {
        if (hasAmmo(it)) {
          if (!out.gun) out.gun = { it, hand, def, ammo: ammoDef(it) };
        } else if (!out.reload && Array.isArray(def.ammo)) {
          const other = BU().item(B, u, hand === 'R' ? 'L' : 'R');
          const pool = BU().item(B, u, 'belt').concat(BU().item(B, u, 'pack'), other ? [other] : []);
          const clip = pool.find((c) => c && def.ammo.indexOf(c.type) >= 0);
          if (clip) out.reload = { hand, it, clip };
          else if (!out.empty) out.empty = { hand, it, def };
        }
      } else if (def.kind === 'melee' && hasMode(it.type, 'melee') && !out.melee) out.melee = { it, hand, def };
    }
    for (const it of BU().allItems(B, u)) {
      const def = defOf(it);
      if (!def || !usable(B, u, it.type)) continue;
      if (def.kind === 'grenade' && def.prime && !def.proximity && (it.fuse < 0 || it.fuse === undefined || it.fuse === null)) out.grenades.push(it);
      else if (def.kind === 'flare' && !out.flare) out.flare = it;
      else if (def.kind === 'medikit' && it.charges && it.charges.heal > 0 && !out.medikit) out.medikit = it;
    }
    out.blaster = !!(out.gun && out.gun.def.guided);
    out.meleeOnly = !out.gun && !out.reload && !!out.melee;
    out.armed = !!(out.gun || out.melee || out.reload);
    return out;
  }
  // UT do ataque de referência: tiro rápido (arma tipo espingarda), apontado (blaster), corpo a corpo
  function attackTU(B, u, ar) {
    const a = ar || arms(B, u);
    if (a.gun) {
      const order = a.blaster ? ['aimed'] : ['snap', 'aimed', 'auto'];
      for (const m of order) {
        if (!hasMode(a.gun.it.type, m)) continue;
        const c = BU().actionTU(B, u, a.gun.it.id, m);
        if (c !== null) return c;
      }
    }
    if (a.melee) {
      const c = BU().actionTU(B, u, a.melee.it.id, 'melee');
      if (c !== null) return c;
    }
    return 0;
  }
  // modos de fogo por distância (DESIGN §11.2d): < 4 auto>snap>aimed; > 12 aimed (snap se < 20); senão snap>aimed>auto
  function fireModes(dist) {
    if (dist < 4) return ['auto', 'snap', 'aimed'];
    if (dist > 12) return dist < 20 ? ['aimed', 'snap'] : ['aimed'];
    return ['snap', 'aimed', 'auto'];
  }

  // ---- contexto --------------------------------------------------------------------------------------------
  function profileOf(side, override) {
    if (override) return override;
    if (side === 'xcom') return PLAYER_BOT;
    if (side === 'civ') return PROFILES.civ;
    return PROFILES.alien;
  }
  function liveAliens(B) {
    let n = 0;
    for (const u of B.units) if (u.side === 'alien' && LIVE[u.status]) n++;
    return n;
  }
  // turno de batota (DESIGN §11.0): turno > CHEAT_TURN, ou > CHEAT_TURN/2 com ≤ 2 alienígenas vivos
  function cheatNow(B) {
    const ct = tune('CHEAT_TURN', [12, 10, 8]);
    const diff = U.clamp((B.mission && B.mission.difficulty) | 0, 0, 2);
    const turn = Array.isArray(ct) ? ct[diff] | 0 : ct | 0;
    return B.turn > turn || (B.turn > idiv(turn, 2) && liveAliens(B) <= 2);
  }
  /* Zonas perigosas do turno: à volta de alienígenas atingidos/mortos nesta ronda e no raio de granadas armadas no chão. */
  function dangerMap(B) {
    const m = B.map;
    const out = new Uint8Array(m.n);
    const mark = (x0, y0, z0, r) => {
      for (let y = Math.max(0, y0 - r); y <= Math.min(m.h - 1, y0 + r); y++) {
        for (let x = Math.max(0, x0 - r); x <= Math.min(m.w - 1, x0 + r); x++) {
          if ((x - x0) * (x - x0) + (y - y0) * (y - y0) <= r * r) out[BM().idx(m, x, y, z0)] = 1;
        }
      }
    };
    for (const u of B.units) {
      if (u.side !== 'alien' || u.x < 0) continue;
      const hit = u.ai && Array.isArray(u.ai.wasHitBy) && u.ai.wasHitBy.length > 0;
      if ((hit && LIVE[u.status]) || (u.status === 'dead' && u.deathTurn === B.turn)) mark(u.x, u.y, u.z, 2);
    }
    for (const it of B.items) {
      if (it.owner !== null || it.at === null || it.at === undefined || !(it.fuse >= 0)) continue;
      const def = defOf(it);
      if (!def || def.kind !== 'grenade') continue;
      const [x, y, z] = BM().xyz(m, it.at);
      mark(x, y, z, Math.max(1, def.radius | 0));
    }
    return out;
  }
  function turnContext(B, side, profile) {
    derived(B);
    const cheat = side === 'alien' && cheatNow(B);
    return {
      side, profile: profileOf(side, profile), turn: B.turn, cheat, queue: {}, ended: new Set(), patrolled: new Set(),
      grenaded: new Set(), danger: dangerMap(B), cache: new Map(), flares: 0, fired: new Set(),
    };
  }

  function intelligence(u, prof) {
    if (prof && prof.intelligence !== null && prof.intelligence !== undefined) return prof.intelligence | 0;
    return u.int === undefined || u.int === null ? 4 : u.int | 0;
  }
  function aggression(u, prof) {
    if (prof && prof.aggression !== null && prof.aggression !== undefined) return prof.aggression | 0;
    return u.aggr === undefined || u.aggr === null ? 1 : U.clamp(u.aggr | 0, 0, 2);
  }
  /* Inimigos conhecidos (DESIGN §11.0): para os alienígenas, X-COM/civis com turnsSinceSpotted ≤ inteligência (ou à
     vista do lado); para o playerBot, alienígenas à vista ou vistos há ≤ inteligência turnos. */
  function knownEnemies(B, u, prof) {
    const out = [];
    const intel = intelligence(u, prof);
    const M = u.side === 'xcom' ? mem(B) : null;
    for (const t of B.units) {
      if (t === u || !active(t) || !hostile(u.side, t.side)) continue;
      if (u.side === 'civ') {
        if (t.side === 'alien' && (sees(B, u, t) || udist(u, t) <= 6)) out.push(t);
        continue;
      }
      const vis = OV.LOS && OV.LOS.isVisibleTo(B, u.side, t);
      let known = vis;
      if (!known && u.side === 'alien') known = (t.turnsSinceSpotted | 0) <= intel;
      if (!known && M) {
        const s = M.seen[t.id];
        known = s !== undefined && B.turn - s <= intel;
      }
      if (known) out.push(t);
    }
    return out;
  }
  function unitContext(B, u, ctx) {
    const prof = ctx.profile;
    const known = knownEnemies(B, u, prof);
    const visible = known.filter((t) => sees(B, u, t));
    const spotters = known.filter((t) => t.side !== 'civ' && sees(B, t, u));
    let nearest = null, nd = 1e9;
    for (const t of known) {
      const d = udist(u, t);
      if (d < nd) { nd = d; nearest = t; }
    }
    const ar = arms(B, u);
    return {
      known, visible, spotters, nearest, nearestDist: nearest ? nd : 1e9, arms: ar, atkTU: attackTU(B, u, ar),
      aggr: aggression(u, prof), intel: intelligence(u, prof), hpMax: Math.max(1, u.hpMax | 0 || u.stats.hp | 0),
    };
  }

  // ---- alcance (cache por ação) ------------------------------------------------------------------------------
  function reachFor(B, u, budget, ctx) {
    const b = Math.max(0, budget | 0);
    const key = u.id + ':' + tileOf(B, u) + ':' + b + ':' + (u.tu | 0) + ':' + (u.energy | 0);
    let r = ctx.cache.get(key);
    if (!r) {
      r = OV.Path.reachable(B, u, b, null, { ai: u.side !== 'xcom' });
      ctx.cache.set(key, r);
    }
    return r;
  }
  const standCost = (u) => (u.kneel ? tune('TU_STAND', 8) : 0);
  function walkTo(B, u, reach, i, desperate) {
    if (i === reach.origin) return null;
    const p = OV.Path.pathTo(reach, i);
    if (!p || !p.steps.length) return null;
    return { type: 'walk', unitId: u.id, to: i, path: p.steps, desperate: !!desperate };
  }
  /* Caminho até goal, truncado ao orçamento de UT (e a stop(tile) → true para parar antes). Simula os passos com as
     regras reais (portas, unidades vistas); para antes de um ocupante escondido. */
  function walkToward(B, u, goal, budget, opts) {
    const o = opts || {};
    const m = B.map;
    if (!(goal >= 0) || goal >= m.n) return null;
    const ai = u.side !== 'xcom';
    const full = OV.Path.find(B, u, goal, null, { ai }) || OV.Path.find(B, u, goal, null, { ai, units: 'none' });
    if (!full || !full.steps.length) return null;
    let cur = tileOf(B, u);
    let tu = standCost(u), energy = 0;
    const steps = [];
    let last = -1;
    for (const dir of full.steps) {
      const s = OV.Path.stepCost(B, u, cur, dir, {});
      if (!s || s.occupant !== null) break;
      if (tu + s.tu > budget || energy + s.energy > (u.energy | 0)) break;
      if (o.stop && o.stop(s.to)) break;
      tu += s.tu;
      energy += s.energy;
      steps.push(dir);
      cur = s.to;
      last = cur;
    }
    if (!steps.length) return null;
    return { type: 'walk', unitId: u.id, to: last, path: steps, desperate: !!o.desperate };
  }

  // ---- pesos dos modos (DESIGN §11.1; REA §11) — inteiros ×100 ---------------------------------------------
  const mul = (w, pct) => idiv(w * pct, 100);
  function modeWeights(B, u, c, ctx, ambushFound) {
    const cur = u.ai && u.ai.mode;
    const tuHalf = (u.tu | 0) * 2 > (u.stats.tu | 0);
    let escape = c.arms.meleeOnly ? 1200 : 1500;
    if (tuHalf) escape = 500;
    let ambush = 1200, combat = 2000;
    let patrol = c.spotters.length ? 0 : c.visible.length ? 1500 : 3000;
    if (cur === 'escape') escape = mul(escape, 110);
    if (cur === 'ambush') ambush = mul(ambush, 110);
    if (cur === 'combat') { combat = mul(combat, 110); ambush = mul(ambush, 150); }
    if (cur === 'patrol') patrol = mul(patrol, 110);
    const hp3 = (u.hp | 0) * 3;
    if (hp3 < c.hpMax) { escape = mul(escape, 170); combat = mul(combat, 60); ambush = mul(ambush, 75); }
    else if (hp3 < 2 * c.hpMax) { escape = mul(escape, 140); combat = mul(combat, 80); ambush = mul(ambush, 80); }
    else if ((u.hp | 0) < c.hpMax) escape = mul(escape, 110);
    if (c.aggr === 0) { escape = mul(escape, 140); combat = mul(combat, 70); }
    else if (c.aggr === 1) ambush = mul(ambush, 110);
    else { combat = mul(combat, 140); escape = mul(escape, 70); }
    const N = c.spotters.length;
    if (N) {
      escape = idiv(escape * (N + 10), 10);
      combat = idiv(combat * (N + 20), 20);
    } else escape = idiv(escape, 2);
    if (c.visible.length) combat = idiv(combat * (c.visible.length + 10), 10);
    if (c.nearest && c.nearestDist < 5) ambush = 0;
    ambush = ambushFound && c.arms.gun && !c.arms.blaster && !c.arms.meleeOnly ? mul(ambush, 170) : 0;
    if (c.known.length === 1) combat = mul(combat, 120);
    if (!c.known.length) { combat = 0; escape = 0; }
    if (!c.arms.armed && !c.arms.grenades.length && !c.arms.psi) { combat = 0; ambush = 0; }
    return { combat, patrol, ambush, escape };
  }
  // reavaliar o modo? (DESIGN §11.1)
  function needsEval(B, u, c, ctx) {
    const mode = u.ai.mode;
    if (ctx.cheat || c.spotters.length > 2 || (u.hp | 0) * 3 < 2 * c.hpMax) return true;
    if (u.ai.aggroId !== null && u.ai.aggroId !== undefined && !c.known.some((t) => t.id === u.ai.aggroId)) return true;
    if (!MODES.includes(mode)) return true;
    if (mode === 'patrol') return c.known.length > 0 || B.rng.ai.pct(10);
    if (mode === 'ambush') return !c.arms.gun || c.visible.length > 0;
    if (mode === 'combat') return !!(u.ai.memory && u.ai.memory.failed) || !c.known.length;
    if (mode === 'escape') return c.spotters.length === 0;
    return false;
  }
  function chooseMode(B, u, c, ctx) {
    const prof = ctx.profile;
    // playerBot: política direta (recua ferido, combate com inimigos conhecidos, explora sem eles)
    if (u.side === 'xcom') {
      if (c.known.length && (u.hp | 0) * 100 < (prof.retreatPct | 0) * c.hpMax && c.spotters.length) return 'escape';
      if (c.known.length && (c.arms.armed || c.arms.grenades.length)) return 'combat';
      return 'patrol';
    }
    // unidades de terror corpo a corpo: sempre combate quando há alvos (DESIGN §11.9)
    if (c.arms.meleeOnly) return c.known.length ? 'combat' : 'patrol';
    if (ctx.cheat && c.known.length && (c.arms.armed || c.arms.grenades.length || c.arms.psi)) return 'combat';
    if (!needsEval(B, u, c, ctx)) return u.ai.mode;
    const amb = c.known.length && c.arms.gun && !c.arms.blaster ? ambushSpot(B, u, c, ctx) : null;
    const w = modeWeights(B, u, c, ctx, !!amb);
    let pick = B.rng.ai.weighted(w);
    if (!pick) pick = ['combat', 'patrol', 'ambush', 'escape'].find((k) => w[k] > 0) || 'patrol';
    if (u.ai.memory) u.ai.memory.failed = false;
    return pick;
  }

  // ---- ataque ----------------------------------------------------------------------------------------------
  // valor do alvo (menor é melhor): HP × armadura, ×2 se o alvo vê o atirador, × (distância + 5)
  function targetValue(B, u, t) {
    const arm = Array.isArray(t.armour) ? t.armour[0] | 0 : 0;
    let v = (Math.max(1, t.hp | 0)) * (arm + 10);
    if (sees(B, t, u)) v *= 2;
    return v * (udist(u, t) + 5);
  }
  function friendsNear(B, u, x, y, z, r) {
    for (const f of B.units) {
      if (!active(f) || f.side !== u.side || f.z !== z) continue;
      if (rectGap(f.x, f.y, f.size || 1, x, y, 1) <= r) return true;
    }
    return false;
  }
  // melhor tiro possível agora contra os alvos visíveis → ação (ou ajoelhar antes do apontado no playerBot)
  function shotPlan(B, u, c, ctx) {
    const g = c.arms.gun;
    if (!g || !c.visible.length) return null;
    const list = c.visible.slice().sort((a, b) => targetValue(B, u, a) - targetValue(B, u, b) || a.id - b.id);
    const R = g.ammo ? g.ammo.radius | 0 : 0;
    for (const t of list) {
      if (R > 0 && friendsNear(B, u, t.x, t.y, t.z, R)) continue;
      const dist = udist(u, t);
      for (const mode of fireModes(dist)) {
        if (!hasMode(g.it.type, mode)) continue;
        const a = { type: 'shoot', unitId: u.id, hand: g.hand, mode, target: { unitId: t.id } };
        const v = OV.Act.validate(B, a);
        if (!v.ok) continue;
        if (u.side === 'xcom' && ctx.profile.kneelAimed && mode === 'aimed' && !u.kneel && BU().canKneel(u)) {
          const k = { type: 'kneel', unitId: u.id };
          if ((u.tu | 0) >= tune('TU_KNEEL', 4) + v.tu && valid(B, k)) return k;
        }
        u.ai.aggroId = t.id;
        return a;
      }
    }
    return null;
  }

  /* Eficácia de uma explosão no tile i (DESIGN §11.2c): desespero + dificuldade/2 + inimigos − 2·amigos − 4·próprio
     no raio (mesmo nível). → {eff, enemies, friends, self} */
  function grenadeEfficacy(B, u, i, radius, ctx) {
    const m = B.map;
    const [x, y, z] = BM().xyz(m, i);
    const r = Math.max(1, radius | 0);
    let enemies = 0, friends = 0, self = 0;
    for (const t of B.units) {
      if (!active(t) || t.z !== z) continue;
      const s = t.size || 1;
      let inside = false;
      for (let oy = 0; oy < s && !inside; oy++) {
        for (let ox = 0; ox < s && !inside; ox++) {
          const dx = t.x + ox - x, dy = t.y + oy - y;
          if (dx * dx + dy * dy <= r * r) inside = true;
        }
      }
      if (!inside) continue;
      if (t === u) self = 1;
      else if (t.side === u.side) friends++;
      else if (hostile(u.side, t.side)) enemies++;
    }
    let desperation = idiv(100 - U.clamp(u.morale | 0, 0, 100), 10);
    if ((u.hp | 0) * 3 < Math.max(1, u.hpMax | 0)) desperation += 3;
    const coef = u.side === 'alien' ? (D().alienGrowth.coef[(B.mission && B.mission.difficulty) | 0] | 0) : 0;
    const eff = desperation + idiv(coef, 2) + enemies - 2 * friends - 4 * self;
    return { eff, enemies, friends, self, desperation };
  }
  // granada (mão livre → ativar → lançar) ou bomba do blaster contra grupos (DESIGN §11.2c)
  function explosivePlan(B, u, c, ctx) {
    if (u.side === 'alien' && B.turn < tune('AI_GRENADE_FROM_TURN', 3)) return null;
    if (u.side === 'xcom' && !ctx.profile.grenades) return null;
    const m = B.map;
    const targets = [];
    for (const t of c.known) {
      if (t.float || (t.canFly && t.z > 0 && !BM().hasFloor(m, tileOf(B, t)))) continue; // nunca contra voadores
      const i = tileOf(B, t);
      if (!ctx.grenaded.has(i) && targets.indexOf(i) < 0) targets.push(i);
    }
    if (!targets.length) return null;
    // bomba do blaster
    if (c.arms.blaster && c.arms.gun && c.arms.gun.ammo) {
      const R = c.arms.gun.ammo.radius | 0;
      let best = null;
      for (const i of targets) {
        const e = grenadeEfficacy(B, u, i, R, ctx);
        if (e.eff <= 0 || e.self || (best && e.eff <= best.eff)) continue;
        const a = { type: 'shoot', unitId: u.id, hand: c.arms.gun.hand, mode: 'aimed', target: { i } };
        if (valid(B, a)) best = { eff: e.eff, a, i };
      }
      if (best) {
        ctx.grenaded.add(best.i);
        return best.a;
      }
    }
    if (!c.arms.grenades.length) return null;
    const free = BU().item(B, u, 'R') === null ? 'R' : BU().item(B, u, 'L') === null ? 'L' : null;
    const g = c.arms.grenades.find((it) => BU().slotOf(u, it.id) === 'R' || BU().slotOf(u, it.id) === 'L') || c.arms.grenades[0];
    const slot = BU().slotOf(u, g.id);
    const inHand = slot === 'R' || slot === 'L';
    if (!inHand && !free) return null;
    const def = defOf(g);
    const R = def.radius | 0;
    const invTU = inHand ? 0 : D().invMoveTU(slot, free) | 0;
    // tirar do cinto (4, REA) + ativar 50 % + lançar 25 %; o movimento de inventário não conta a dobrar
    const cost = (inHand ? 0 : Math.max(invTU, 4)) + BU().actionTU(B, u, g.id, 'prime') + BU().actionTU(B, u, g.id, 'throw');
    if ((u.tu | 0) < cost) return null;
    const range = D().throwRange(u.stats.str | 0, def.weight | 0);
    let best = null;
    for (const i of targets) {
      const e = grenadeEfficacy(B, u, i, R, ctx);
      if (e.eff <= 0 || !(e.enemies >= 2 || e.desperation >= 6)) continue;
      if (best && e.eff <= best.eff) continue;
      const [tx, ty, tz] = BM().xyz(m, i);
      const dx = tx - u.x, dy = ty - u.y, dz = idiv((tz - u.z) * 3, 2);
      if (U.isqrt(dx * dx + dy * dy + dz * dz) > range) continue;
      if (!OV.Act.planArc(B, u, i)) continue;
      best = { eff: e.eff, i };
    }
    if (!best) return null;
    ctx.grenaded.add(best.i);
    const steps = [];
    if (!inHand) steps.push({ type: 'inv', unitId: u.id, itemId: g.id, to: free });
    steps.push({ type: 'prime', unitId: u.id, itemId: g.id, fuse: 0 });
    steps.push({ type: 'throw', unitId: u.id, itemId: g.id, toI: best.i });
    const first = steps.shift();
    ctx.queue[u.id] = steps;
    return first;
  }

  // ataque psiónico (DESIGN §11.2a): pânico; controlo mental com as probabilidades originais se TUNE.AI_MIND_CONTROL
  function psiPlan(B, u, c, ctx) {
    if (!c.arms.psi || !OV.Morale || (u.tu | 0) <= tune('TU_PSI', 25)) return null;
    const atk = OV.Morale.psiAttackStrength(u);
    let best = null, bestScore = -1e9;
    for (const t of c.known) {
      if (t.side !== 'xcom' && t.side !== 'civ') continue;
      const score = atk - idiv(2 * (t.stats.psiSkill | 0), 5) - OV.Morale.tileDist(u, t) - (t.stats.psiStr | 0) + B.rng.ai.int(55, 105);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return null;
    if (c.visible.length && c.arms.gun && c.arms.gun.ammo && (c.arms.gun.ammo.power | 0) >= bestScore) return null;
    if (B.rng.ai.int(35, 155) >= bestScore) return null;
    let kind = 'panic';
    if (tune('AI_MIND_CONTROL', false) && B.rng.ai.pct(OV.Morale.controlOdds(B, best))) kind = 'control';
    const a = { type: 'psi', unitId: u.id, targetId: best.id, kind };
    return valid(B, a) ? a : null;
  }

  // investida corpo a corpo (DESIGN §11.2b): o Crisálida prefere civis/pouca armadura, depois o mais próximo
  function meleePlan(B, u, c, ctx) {
    const w = c.arms.melee;
    if (!w || !c.known.length) return null;
    const m = B.map;
    const prefersSoft = u.type === 'chryssalid';
    const order = c.known.slice().sort((a, b) => {
      if (prefersSoft) {
        const ca = a.side === 'civ' ? 0 : 1, cb = b.side === 'civ' ? 0 : 1;
        if (ca !== cb) return ca - cb;
        const aa = Array.isArray(a.armour) ? a.armour[0] | 0 : 0, ab = Array.isArray(b.armour) ? b.armour[0] | 0 : 0;
        if (aa !== ab) return aa - ab;
      }
      return udist(u, a) - udist(u, b) || a.id - b.id;
    });
    for (const t of order) {
      const a = { type: 'melee', unitId: u.id, targetId: t.id };
      if (valid(B, a)) {
        u.ai.aggroId = t.id;
        return a;
      }
    }
    const cost = BU().actionTU(B, u, w.it.id, 'melee') | 0;
    const reach = reachFor(B, u, (u.tu | 0) - cost - 4 - standCost(u), ctx);
    const s = u.size || 1;
    for (const t of order) {
      const ts = t.size || 1;
      let best = -1, bc = 1e9;
      for (let y = t.y - s; y <= t.y + ts; y++) {
        for (let x = t.x - s; x <= t.x + ts; x++) {
          if (!BM().inB(m, x, y, t.z) || rectGap(x, y, s, t.x, t.y, ts) !== 1) continue;
          const i = BM().idx(m, x, y, t.z);
          const k = reach.cost[i];
          if (k >= 0 && k < bc) { bc = k; best = i; }
        }
      }
      if (best >= 0) {
        u.ai.aggroId = t.id;
        if (best === reach.origin) continue;
        const a = walkTo(B, u, reach, best, true);
        if (a) {
          ctx.queue[u.id] = [{ type: 'melee', unitId: u.id, targetId: t.id }];
          return a;
        }
      }
    }
    // longe demais: avança com todas as UT
    const t = order[0];
    u.ai.aggroId = t.id;
    return walkToward(B, u, tileOf(B, t), (u.tu | 0), { desperate: true });
  }

  // cobertura: objeto baixo ou parede que trava o passo (mas não a vista) entre o tile e o alvo
  function hasCover(m, i, t) {
    const [x, y, z] = BM().xyz(m, i);
    const dir = U.dirTo(t.x - x, t.y - y);
    if (dir < 0) return false;
    const e = BM().edgeInfo(m, x, y, z, dir & 6);
    if (e.blocked.move && !e.blocked.los) return true;
    const j = BM().neighbour(m, i, dir & 6);
    if (j < 0) return false;
    const o = BM().objectDef(m, j);
    return !!(o && !o.fullBlock && (o.height | 0) >= 8 && (o.tu | 0) >= 255);
  }
  // quantos inimigos conhecidos veriam u no tile i (simétrico: u em i vê-os); só tiles à vista da X-COM contam p/ alienígenas
  function exposure(B, u, i, list, cap) {
    if (u.side === 'alien' && B._ && B._.visTiles && !B._.visTiles[i]) return 0;
    let n = 0;
    for (const t of list) {
      if (t.side === 'civ' || idist(B.map, i, t) > 20) continue;
      if (OV.LOS.canSeeFrom(B, u, i, t) && ++n >= cap) break;
    }
    return n;
  }
  function sampleTiles(B, list, max, filter) {
    const out = [];
    for (let k = 0; k < list.length; k++) if (!filter || filter(list[k])) out.push(list[k]);
    if (out.length <= max) return out;
    B.rng.ai.shuffle(out);
    out.length = max;
    return out.sort((a, b) => a - b);
  }
  // n.º de inimigos conhecidos (não civis) com o tile (x,y) no seu cone de visão
  function coneRisk(B, list, x, y) {
    let n = 0;
    const probe = { x, y, size: 1 };
    for (const t of list) if (t.side !== 'civ' && LIVE[t.status] && OV.LOS.inCone(B, t, probe)) n++;
    return n;
  }
  function pathRisk(B, reach, i, list, memo) {
    let n = 0;
    for (let v = i; v >= 0 && v !== reach.origin; v = reach.parent[v]) {
      let r = memo.get(v);
      if (r === undefined) {
        const [x, y] = BM().xyz(B.map, v);
        r = coneRisk(B, list, x, y);
        memo.set(v, r);
      }
      n += r;
    }
    return n;
  }
  /* Ponto de tiro (DESIGN §11.2e): até 60 tiles de reachAtk numa caixa 11×11; pontuação 100 − UT + 20·alvo visível
     + 10·cobertura − 30·(visto por > 1) − 40·fogo; só contam tiles de onde se vê o alvo. */
  function firePoint(B, u, c, ctx, target) {
    const m = B.map;
    const budget = (u.tu | 0) - c.atkTU - standCost(u) - 2;
    if (budget < 4) return null;
    const reach = reachFor(B, u, budget, ctx);
    const cands = sampleTiles(B, reach.list, 60, (i) => {
      const [x, y] = BM().xyz(m, i);
      return Math.abs(x - u.x) <= 5 && Math.abs(y - u.y) <= 5 && !ctx.danger[i];
    });
    const careful = u.side === 'xcom' && ctx.profile.cover;
    const risk = careful ? new Map() : null;
    let best = -1, bs = -1e9;
    for (const i of cands) {
      if (!OV.LOS.canSeeFrom(B, u, i, target)) continue;
      let s = 100 - reach.cost[i] + 20;
      if (u.side !== 'xcom' || ctx.profile.cover) if (hasCover(m, i, target)) s += 10;
      const ex = exposure(B, u, i, c.known, 2);
      // playerBot: nunca escolhe um ponto de tiro à vista de mais de um inimigo conhecido
      if (ex > 1 && careful) continue;
      if (ex > 1) s -= 30;
      if (m.fire[i] > 0) s -= 40;
      // playerBot: cada passo dentro do cone de um inimigo conhecido arrisca fogo de reação
      if (careful) s -= 15 * pathRisk(B, reach, i, c.known, risk);
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0 || best === reach.origin) return null;
    return walkTo(B, u, reach, best, false);
  }

  // combate (DESIGN §11.2): psi → corpo a corpo → explosivos → tiro → ponto de tiro / aproximação
  function combatPlan(B, u, c, ctx) {
    const psi = psiPlan(B, u, c, ctx);
    if (psi) return psi;
    if (c.arms.meleeOnly) return meleePlan(B, u, c, ctx);
    const ex = explosivePlan(B, u, c, ctx);
    if (ex) return ex;
    const shot = shotPlan(B, u, c, ctx);
    if (shot) return shot;
    if (!c.known.length || !c.arms.gun) return null;
    const go = u.side === 'xcom' || ctx.cheat || c.spotters.length > 0 || c.aggr < B.rng.ai.int(0, 3);
    if (!go) return null;
    let target = c.known.find((t) => t.id === u.ai.aggroId) || c.nearest;
    if (c.visible.length && !c.visible.includes(target)) target = c.visible[0];
    u.ai.aggroId = target.id;
    const fp = firePoint(B, u, c, ctx, target);
    if (fp) return fp;
    // sem ponto de tiro: aproxima-se guardando as UT do ataque (playerBot: pelo menos metade, para o fogo de reação)
    const careful = u.side === 'xcom' && ctx.profile.cover;
    const keep = careful ? Math.max(c.atkTU, idiv(u.stats.tu | 0, 2)) : c.atkTU;
    const a = walkToward(B, u, tileOf(B, target), (u.tu | 0) - keep, {
      stop: (i) => {
        if (ctx.danger[i] === 1) return true;
        if (!careful) return false;
        const [x, y] = BM().xyz(B.map, i);
        return coneRisk(B, c.known.filter((t) => tdist(t.x, t.y, t.z, x, y, t.z) <= 10), x, y) > 0;
      },
    });
    return a && valid(B, a) ? a : null;
  }

  // ---- emboscada e fuga --------------------------------------------------------------------------------------
  function windowNear(m, i) {
    const [x, y, z] = BM().xyz(m, i);
    const isWin = (j, p) => {
      if (j < 0) return -1;
      const d = BM().def(m, j, p);
      return d && d.window ? 1 : -1;
    };
    if (isWin(i, 1) > 0) return 6;
    if (isWin(i, 2) > 0) return 0;
    if (x + 1 < m.w && isWin(BM().idx(m, x + 1, y, z), 1) > 0) return 2;
    if (y + 1 < m.h && isWin(BM().idx(m, x, y + 1, z), 2) > 0) return 4;
    return -1;
  }
  // tile de emboscada (DESIGN §11.3): nós a ≤ 10 tiles no mesmo nível, em reachAtk, sem perigo, fora da vista do alvo
  function ambushSpot(B, u, c, ctx) {
    const key = 'amb:' + u.id + ':' + tileOf(B, u) + ':' + (u.tu | 0);
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    const m = B.map;
    const aggro = c.known.find((t) => t.id === u.ai.aggroId) || c.nearest;
    let res = null;
    if (aggro) {
      const reach = reachFor(B, u, (u.tu | 0) - c.atkTU - standCost(u), ctx);
      let cands = [];
      if (u.side === 'alien' && B.nodes && B.nodes.length) {
        for (const n of B.nodes) {
          if (n.z !== u.z || tdist(n.x, n.y, n.z, u.x, u.y, u.z) > 10) continue;
          cands.push(BM().idx(m, n.x, n.y, n.z));
        }
        cands = B.rng.ai.shuffle(cands);
      } else cands = sampleTiles(B, reach.list, 40, (i) => idist(m, i, u) <= 10);
      let best = -1, bs = -1e9;
      for (const i of cands) {
        if (reach.cost[i] < 0 || ctx.danger[i]) continue;
        if (OV.LOS.canSeeFrom(B, u, i, aggro)) continue;
        const s = 100 - reach.cost[i] + (windowNear(m, i) >= 0 ? 25 : 0);
        if (s > bs) { bs = s; best = i; }
        if (s > 80) break;
      }
      if (best >= 0) res = { i: best, reach, aggro };
    }
    ctx.cache.set(key, res);
    return res;
  }
  function ambushPlan(B, u, c, ctx) {
    const spot = ambushSpot(B, u, c, ctx);
    if (!spot) return null;
    ctx.ended.add(u.id);
    const [x, y] = BM().xyz(B.map, spot.i);
    const face = U.dirTo(spot.aggro.x - x, spot.aggro.y - y);
    const turnA = (dir) => (dir >= 0 ? { type: 'turn', unitId: u.id, dir } : null);
    if (spot.i === spot.reach.origin) {
      const a = turnA(face);
      return a && valid(B, a) ? a : null;
    }
    const w = walkTo(B, u, spot.reach, spot.i, false);
    if (!w) return null;
    if (face >= 0) ctx.queue[u.id] = [turnA(face)];
    return w;
  }
  /* Fuga (DESIGN §11.4): até 150 tiles alcançáveis ao acaso; 100 − 10·observadores − 40·fogo + 2·distância ao
     inimigo mais próximo; anda em desespero, roda 180° e termina o turno. */
  function escapePlan(B, u, c, ctx) {
    const m = B.map;
    const reach = reachFor(B, u, (u.tu | 0) - standCost(u), ctx);
    const cands = sampleTiles(B, reach.list, 150, null);
    const threats = c.known.length ? c.known : c.spotters;
    let best = -1, bs = -1e9;
    for (const i of cands) {
      let near = 99;
      for (const t of threats) near = Math.min(near, idist(m, i, t));
      let s = 100 - 10 * exposure(B, u, i, threats, 4) + 2 * Math.min(near, 30);
      if (m.fire[i] > 0) s -= 40;
      if (ctx.danger[i]) s -= 20;
      if (s > bs) { bs = s; best = i; }
    }
    ctx.ended.add(u.id);
    if (best < 0 || best === reach.origin) return null;
    const w = walkTo(B, u, reach, best, true);
    if (!w) return null;
    const last = w.path[w.path.length - 1];
    if (last >= 0 && last < 8) ctx.queue[u.id] = [{ type: 'turn', unitId: u.id, dir: (last + 4) & 7, desperate: true }];
    return w;
  }

  // tile mais barato fora da vista dos observadores conhecidos (o caminho conta o risco de reação)
  function hidePlan(B, u, c, ctx) {
    const reach = reachFor(B, u, (u.tu | 0) - standCost(u), ctx);
    const memo = new Map();
    let best = -1, bs = 1e9;
    for (let k = 1; k < reach.list.length && k < 400; k++) {
      const i = reach.list[k];
      if (ctx.danger[i] || B.map.fire[i] > 0) continue;
      if (exposure(B, u, i, c.spotters, 1) > 0) continue;
      const s = reach.cost[i] + 12 * pathRisk(B, reach, i, c.spotters, memo);
      if (s < bs) { bs = s; best = i; }
    }
    ctx.ended.add(u.id);
    return best >= 0 ? walkTo(B, u, reach, best, false) : null;
  }

  // passo lateral: tile alcançável ao acaso entre 3 e 6 tiles, fora de zonas perigosas
  function repositionPlan(B, u, ctx) {
    const reach = reachFor(B, u, idiv((u.tu | 0), 2), ctx);
    const cands = [];
    for (let k = 1; k < reach.list.length; k++) {
      const i = reach.list[k];
      const d = idist(B.map, i, u);
      if (d >= 3 && d <= 6 && !ctx.danger[i] && B.map.fire[i] === 0) cands.push(i);
    }
    if (!cands.length) return null;
    ctx.ended.add(u.id);
    return walkTo(B, u, reach, cands[B.rng.ai.int(0, cands.length - 1)], false);
  }

  // ---- patrulha ----------------------------------------------------------------------------------------------
  // UT de reserva da patrulha por agressão (0 apontado, 1 auto, 2 rápido) para o fogo de reação
  /* UT guardadas na patrulha. Alienígenas (sem modes): parte fixa das UT base pela agressividade, como o
     checkReservedTU do OpenXcom (0 apontado 1/2, 1 rajada 2·(1/5), 2+ rápido 1/3). Com modes (playerBot): custo real. */
  function patrolReserve(B, u, c, modes) {
    const g = c.arms.gun;
    if (!g) return 0;
    if (!modes) {
      const base = u.stats.tu | 0;
      return c.aggr === 0 ? idiv(base, 2) : c.aggr === 1 ? idiv(base, 5) * 2 : idiv(base, 3);
    }
    for (const mo of modes) {
      if (!hasMode(g.it.type, mo)) continue;
      const k = BU().actionTU(B, u, g.it.id, mo);
      if (k !== null) return k;
    }
    return c.atkTU;
  }
  function nodeTile(B, k) {
    const n = B.nodes[k];
    return BM().idx(B.map, n.x, n.y, n.z);
  }
  function nodeAt(B, u) {
    for (let k = 0; k < (B.nodes || []).length; k++) {
      const n = B.nodes[k];
      if (n.x === u.x && n.y === u.y && n.z === u.z) return k;
    }
    return -1;
  }
  // patrulha alienígena (DESIGN §11.5; REA §11): batedores percorrem o mapa, os outros ficam nos nós vizinhos
  function patrolPlan(B, u, c, ctx) {
    if (ctx.patrolled.has(u.id)) return null;
    const m = B.map;
    const nodes = B.nodes || [];
    const budget = (u.tu | 0) - patrolReserve(B, u, c) - standCost(u);
    if (!nodes.length || budget < 4) return null;
    const memo = u.ai.memory || (u.ai.memory = {});
    const here = nodeAt(B, u);
    if (here >= 0) u.ai.node = here;
    const cur = u.ai.node >= 0 && u.ai.node < nodes.length ? nodes[u.ai.node] : null;
    let fire = false;
    for (let d = 0; d < 8 && !fire; d++) {
      const j = BM().neighbour(m, tileOf(B, u), d);
      if (j >= 0 && m.fire[j] > 0) fire = true;
    }
    const scout = !cur || cur.rank === 0 || ctx.cheat || fire || (u.morale | 0) < 50 || !cur.inside;
    let goal = typeof memo.goal === 'number' ? memo.goal : -1;
    if (goal === here || goal < 0 || goal >= nodes.length || ctx.danger[nodeTile(B, goal)]) goal = -1;
    if (goal < 0) {
      const prefs = D().NODE_RANK_PREFS[u.rank] || [];
      const w = {};
      for (let k = 0; k < nodes.length; k++) {
        if (k === here) continue;
        const n = nodes[k];
        const ti = nodeTile(B, k);
        if (ctx.danger[ti]) continue;
        const occ = OV.Battle.unitAt(B, ti);
        if (occ && occ !== u) continue;
        let wt;
        if (scout) wt = 10;
        else {
          if (n.inside !== cur.inside || tdist(n.x, n.y, n.z, u.x, u.y, u.z) > 10) continue;
          wt = 5 + 10 * (n.prio | 0) + (prefs.indexOf(n.rank) >= 0 ? 20 : 0);
        }
        w['n' + k] = wt;
      }
      const pick = B.rng.ai.weighted(w);
      if (pick) goal = +pick.slice(1);
    }
    memo.goal = goal;
    ctx.patrolled.add(u.id);
    if (goal < 0) return lookOut(B, u);
    const a = walkToward(B, u, nodeTile(B, goal), budget, { stop: (i) => ctx.danger[i] === 1 });
    if (!a || !valid(B, a)) {
      memo.goal = -1;
      return lookOut(B, u);
    }
    if (a.to === nodeTile(B, goal)) {
      u.ai.node = goal;
      memo.goal = -1;
      const wd = windowNear(m, a.to);
      if (wd >= 0) ctx.queue[u.id] = [{ type: 'turn', unitId: u.id, dir: wd }];
    }
    return a;
  }
  // num nó: olhar por uma janela adjacente
  function lookOut(B, u) {
    const wd = windowNear(B.map, tileOf(B, u));
    if (wd < 0 || wd === u.dir) return null;
    const a = { type: 'turn', unitId: u.id, dir: wd };
    return valid(B, a) ? a : null;
  }

  // ---- playerBot: exploração, flares, medikit ---------------------------------------------------------------
  function squadOf(B, u) {
    return B.units.filter((s) => s.side === u.side && active(s));
  }
  function centroid(list) {
    let sx = 0, sy = 0;
    for (const s of list) { sx += s.x; sy += s.y; }
    return [idiv(sx, Math.max(1, list.length)), idiv(sy, Math.max(1, list.length))];
  }
  // objetivo comum da equipa: nó ainda não visitado mais perto do centro da equipa (o OVNI primeiro)
  function exploreGoal(B, u) {
    const M = mem(B);
    const nodes = B.nodes || [];
    const squad = squadOf(B, u);
    for (let k = 0; k < nodes.length; k++) {
      if (M.visited.indexOf(k) >= 0) continue;
      const n = nodes[k];
      if (squad.some((s) => s.z === n.z && Math.abs(s.x - n.x) <= 3 && Math.abs(s.y - n.y) <= 3)) M.visited.push(k);
    }
    if (M.goal >= 0 && M.goal < nodes.length && M.visited.indexOf(M.goal) < 0) return nodeTile(B, M.goal);
    const [cx, cy] = centroid(squad);
    let best = -1, bd = 1e9;
    for (let pass = 0; pass < 2 && best < 0; pass++) {
      for (let k = 0; k < nodes.length; k++) {
        if (M.visited.indexOf(k) >= 0) continue;
        const n = nodes[k];
        if (pass === 0 && B.ufo && !n.inside) continue;
        const d = Math.max(Math.abs(n.x - cx), Math.abs(n.y - cy)) + 3 * n.z;
        if (d < bd) { bd = d; best = k; }
      }
    }
    if (best < 0) {
      M.visited = [];
      return -1;
    }
    M.goal = best;
    return nodeTile(B, best);
  }
  function botPatrol(B, u, c, ctx) {
    if (ctx.patrolled.has(u.id)) return null;
    const goal = exploreGoal(B, u);
    if (goal < 0) return null;
    const prof = ctx.profile;
    // flare à frente do caminho de noite, se essa zona estiver escura (um por turno na equipa)
    if (prof.flares && c.arms.flare && ctx.flares < 1 && B.mission && (B.mission.shade | 0) > tune('DARK_SHADE', 9) && !c.visible.length) {
      const fl = flarePlan(B, u, c, ctx, goal);
      if (fl) return fl;
    }
    const reserve = prof.reserve === 'none' ? 0 : patrolReserve(B, u, c, [prof.reserve || 'snap', 'snap', 'aimed']);
    const budget = idiv(((u.tu | 0) - reserve) * (prof.advance || 100), 100);
    if (budget < 4) return null;
    const squad = squadOf(B, u);
    const [cx, cy] = centroid(squad);
    const coh = prof.cohesion | 0;
    const d0 = Math.max(Math.abs(u.x - cx), Math.abs(u.y - cy));
    const a = walkToward(B, u, goal, budget, {
      stop: (i) => {
        if (ctx.danger[i]) return true;
        const [x, y] = BM().xyz(B.map, i);
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        return d > coh && d > d0;
      },
    });
    ctx.patrolled.add(u.id);
    return a && valid(B, a) ? a : null;
  }
  function flarePlan(B, u, c, ctx, goal) {
    const m = B.map;
    const it = c.arms.flare;
    const slot = BU().slotOf(u, it.id);
    const inHand = slot === 'R' || slot === 'L';
    const free = BU().item(B, u, 'L') === null ? 'L' : BU().item(B, u, 'R') === null ? 'R' : null;
    if (!inHand && !free) return null;
    const p = OV.Path.find(B, u, goal, null, { units: 'none' });
    if (!p || p.tiles.length < 6) return null;
    const range = D().throwRange(u.stats.str | 0, defOf(it).weight | 0);
    const to = p.tiles[Math.min(p.tiles.length - 1, Math.max(5, Math.min(range - 1, 10)))];
    if (OV.LOS.shadeAt(B, to) <= tune('DARK_SHADE', 9)) return null;
    if (!OV.Act.planArc(B, u, to)) return null;
    const cost = (inHand ? 0 : D().invMoveTU(slot, free) | 0) + BU().actionTU(B, u, it.id, 'throw') + 4;
    if ((u.tu | 0) - cost < 20) return null;
    ctx.flares++;
    const throwA = { type: 'throw', unitId: u.id, itemId: it.id, toI: to };
    if (inHand) return throwA;
    ctx.queue[u.id] = [throwA];
    return { type: 'inv', unitId: u.id, itemId: it.id, to: free };
  }
  // tratar feridas fatais (o próprio ou um vizinho); o medikit volta à mochila quando já não é preciso
  function medikitPlan(B, u, c, ctx) {
    const kit = c.arms.medikit;
    if (!ctx.profile.medikit || !kit) return null;
    const slot = BU().slotOf(u, kit.id);
    const inHand = slot === 'R' || slot === 'L';
    const wounds = (t) => (t.wounds || []).reduce((s, w) => s + (w | 0), 0);
    const near = squadOf(B, u).filter((t) => wounds(t) > 0 && t.z === u.z && rectGap(u.x, u.y, u.size || 1, t.x, t.y, t.size || 1) <= 1);
    near.sort((a, b) => wounds(b) - wounds(a) || a.id - b.id);
    if (near.length) {
      const t = near[0];
      const heal = { type: 'medikit', unitId: u.id, targetId: t.id, kind: 'heal', itemId: kit.id };
      if (inHand) return valid(B, heal) ? heal : null;
      const free = BU().item(B, u, 'L') === null ? 'L' : BU().item(B, u, 'R') === null ? 'R' : null;
      if (!free) return null;
      const cost = (D().invMoveTU(slot, free) | 0) + (defOf(kit).useTU | 0 || 10);
      if ((u.tu | 0) < cost) return null;
      ctx.queue[u.id] = [heal];
      return { type: 'inv', unitId: u.id, itemId: kit.id, to: free };
    }
    if (inHand) {
      const back = { type: 'inv', unitId: u.id, itemId: kit.id, to: 'pack' };
      if (valid(B, back)) return back;
      const belt = { type: 'inv', unitId: u.id, itemId: kit.id, to: 'belt' };
      if (valid(B, belt)) return belt;
    }
    return null;
  }

  // ---- manutenção: recarregar e apanhar armas -----------------------------------------------------------------
  function reloadPlan(B, u, c) {
    const r = c.arms.reload;
    if (!r || c.arms.gun) return null;
    const a = { type: 'reload', unitId: u.id, hand: r.hand, clipId: r.clip.id };
    return valid(B, a) ? a : null;
  }
  // sem arma: apanha uma arma carregada (ou munição para a arma vazia) no próprio tile ou a ≤ 3 tiles (DESIGN §11.6)
  function pickupPlan(B, u, c, ctx) {
    if (c.arms.armed) return null;
    const m = B.map;
    const free = BU().item(B, u, 'R') === null ? 'R' : BU().item(B, u, 'L') === null ? 'L' : null;
    const clips = c.arms.empty ? c.arms.empty.def.ammo : null;
    let best = null, bd = 1e9, to = null;
    for (const it of B.items) {
      if (it.owner !== null || it.at === null || it.at === undefined) continue;
      const def = defOf(it);
      if (!def || def.fixed || !usable(B, u, it.type)) continue;
      let dest = null;
      if (def.kind === 'firearm' && hasAmmo(it) && free) dest = free;
      else if (clips && clips.indexOf(it.type) >= 0) dest = D().fitsSlot(it.type, 'belt', BU().item(B, u, 'belt').map((x) => x.type)) ? 'belt' : free;
      if (!dest) continue;
      const d = idist(m, it.at, u);
      if (d > 3 || d >= bd) continue;
      bd = d;
      best = it;
      to = dest;
    }
    if (!best) return null;
    const mine = BU().unitTiles(u, m);
    const pick = { type: 'pickup', unitId: u.id, itemId: best.id, to };
    if (mine.indexOf(best.at) >= 0) return valid(B, pick) ? pick : null;
    const reach = reachFor(B, u, (u.tu | 0) - 8 - standCost(u), ctx);
    const w = walkTo(B, u, reach, best.at, false);
    if (!w) return null;
    ctx.queue[u.id] = [pick];
    return w;
  }

  // ---- civis (DESIGN §11.8): fogem dos alienígenas que veem (ou a ≤ 6 tiles); senão um passeio curto ----------
  function civThink(B, u, ctx) {
    if (ctx.ended.has(u.id)) return null;
    ctx.ended.add(u.id);
    const threats = knownEnemies(B, u, ctx.profile);
    const m = B.map;
    if (threats.length) {
      const reach = reachFor(B, u, (u.tu | 0) - standCost(u), ctx);
      const cands = sampleTiles(B, reach.list, 80, null);
      let best = -1, bs = -1e9;
      for (const i of cands) {
        let near = 99;
        for (const t of threats) near = Math.min(near, idist(m, i, t));
        let s = 3 * Math.min(near, 25) - (reach.cost[i] >> 3);
        for (const t of threats) if (OV.LOS.canSeeFrom(B, u, i, t)) s -= 10;
        if (m.fire[i] > 0) s -= 40;
        if (s > bs) { bs = s; best = i; }
      }
      return best >= 0 ? walkTo(B, u, reach, best, true) : null;
    }
    if (!B.rng.ai.pct(30)) return null;
    const reach = reachFor(B, u, idiv((u.tu | 0), 2), ctx);
    if (reach.list.length < 2) return null;
    const i = reach.list[B.rng.ai.int(1, reach.list.length - 1)];
    return walkTo(B, u, reach, i, false);
  }

  // ---- decisão -------------------------------------------------------------------------------------------------
  /* Próxima ação de u (ou null). Mantém u.ai.mode; os planos com vários passos ficam em ctx.queue[u.id]. */
  function think(B, u, ctxIn) {
    derived(B);
    if (!active(u) || u.status === 'panic' || u.side !== B.side || !OV.Act || !OV.Path || !OV.LOS) return null;
    const ctx = ctxIn || turnContext(B, u.side);
    if (!u.ai) u.ai = { mode: 'patrol', node: -1, aggroId: null, wasHitBy: [], memory: {} };
    if (!u.ai.memory) u.ai.memory = {};
    const q = ctx.queue[u.id];
    while (q && q.length) {
      const a = q.shift();
      if (valid(B, a)) return a;
      q.length = 0;
    }
    if (u.side === 'civ') return civThink(B, u, ctx);
    const c = unitContext(B, u, ctx);
    if (u.ai.aggroId !== null && u.ai.aggroId !== undefined && !c.known.some((t) => t.id === u.ai.aggroId)) u.ai.aggroId = null;
    const rl = reloadPlan(B, u, c);
    if (rl) return rl;
    if (!c.arms.armed) {
      const pk = pickupPlan(B, u, c, ctx);
      if (pk) return pk;
    }
    if (u.side === 'xcom') {
      const mk = c.visible.length && (u.hp | 0) * 3 >= c.hpMax ? null : medikitPlan(B, u, c, ctx);
      if (mk) return mk;
    }
    const mode = chooseMode(B, u, c, ctx);
    u.ai.mode = mode;
    let a = null;
    // playerBot «dispara e esconde-te»: depois de atacar neste turno, se mais de um inimigo conhecido o vê, sai da vista
    // em vez de continuar a disparar exposto (o fogo de reação e o turno alienígena castigam quem fica à vista)
    if (u.side === 'xcom' && mode === 'combat' && ctx.fired && ctx.fired.has(u.id) && c.spotters.length > 0
      && !ctx.ended.has(u.id) && exposure(B, u, tileOf(B, u), c.known, 2) > 1) {
      a = hidePlan(B, u, c, ctx);
      if (a) return a;
      ctx.ended.delete(u.id);
    }
    if (mode === 'combat') {
      a = combatPlan(B, u, c, ctx);
      if (!a) {
        u.ai.memory.failed = true;
        // sem ataque possível: patrulha (corpo a corpo: mesmo à vista, para não bloquear passagens)
        if (u.side === 'alien' && (!c.visible.length || c.arms.meleeOnly)) a = patrolPlan(B, u, c, ctx);
      }
    } else if (mode === 'ambush') a = ambushPlan(B, u, c, ctx);
    else if (mode === 'escape') a = escapePlan(B, u, c, ctx);
    else a = u.side === 'xcom' ? botPatrol(B, u, c, ctx) : patrolPlan(B, u, c, ctx);
    // playerBot: inimigo conhecido mas inalcançável (p. ex. bloqueio mútuo num elevador) ⇒ muda de posição
    if (!a && u.side === 'xcom' && mode === 'combat' && c.known.length && (u.tu | 0) * 2 >= (u.stats.tu | 0)) {
      a = repositionPlan(B, u, ctx);
    }
    // playerBot: sem tiro possível e à vista de inimigos ⇒ sai da linha de vista («dispara e esconde-te»)
    if (!a && u.side === 'xcom' && c.spotters.length && !ctx.ended.has(u.id)) a = hidePlan(B, u, c, ctx);
    // playerBot: sem mais nada a fazer, ajoelha-se (precisão +15 % no fogo de reação)
    if (!a && u.side === 'xcom' && !u.kneel && BU().canKneel(u) && (u.tu | 0) - tune('TU_KNEEL', 4) > (c.arms.gun ? c.atkTU : -1)) {
      const k = { type: 'kneel', unitId: u.id };
      if (valid(B, k)) a = k;
    }
    return a;
  }

  /* Turno de um lado (DESIGN §10, §11): cada unidade até AI_MAX_ACTIONS decisões por passagem, AI_PASSES passagens
     (a segunda só para quem tem ≥ 20 UT); para quando UT ≤ 5 ou uma ação falha. */
  function* turn(B, side, profile) {
    derived(B);
    if (!OV.Act || !OV.Path || !OV.LOS || over(B) || B.side !== side) return { actions: 0 };
    const ctx = turnContext(B, side, profile);
    const prof = ctx.profile;
    if (ctx.cheat) {
      B.cheat = true;
      for (const t of B.units) if (t.side !== 'alien' && active(t)) t.turnsSinceSpotted = 0;
    }
    recordSightings(B);
    const passes = prof.passes || tune('AI_PASSES', 2);
    const maxA = prof.maxActions || tune('AI_MAX_ACTIONS', 3);
    let total = 0;
    for (let p = 0; p < passes; p++) {
      for (const u of B.units.slice()) {
        if (u.side !== side || !active(u) || u.status === 'panic') continue;
        if (p > 0 && (u.tu | 0) < 20) continue;
        let n = 0;
        for (let guard = 0; guard < 24; guard++) {
          if (over(B)) return { actions: total };
          if (!active(u) || u.side !== side || u.status === 'panic') break;
          const queued = !!(ctx.queue[u.id] && ctx.queue[u.id].length);
          if (!queued && (n >= maxA || (u.tu | 0) <= 5 || ctx.ended.has(u.id))) break;
          const a = think(B, u, ctx);
          if (!a) break;
          if (!queued) n++;
          const res = yield* OV.Act.perform(B, a);
          total++;
          ctx.cache.clear();
          recordSightings(B);
          if (!res || !res.ok) {
            delete ctx.queue[u.id];
            if (res && res.reason === 'spotted' && active(u)) continue;
            if (u.ai && u.ai.memory && (a.type === 'shoot' || a.type === 'melee' || a.type === 'throw')) u.ai.memory.failed = true;
            break;
          }
          if (u.ai && u.ai.memory && (a.type === 'shoot' || a.type === 'melee')) u.ai.memory.failed = false;
          if (a.type === 'shoot' || a.type === 'throw' || a.type === 'melee') ctx.fired.add(u.id);
        }
      }
    }
    return { actions: total };
  }

  OV.AI = {
    turn, think, profile: PLAYER_BOT, PROFILES, MODES, turnContext, unitContext, modeWeights, chooseMode, grenadeEfficacy,
    fireModes, arms, knownEnemies, attackTU, recordSightings, cheatNow, patrolReserve, explosivePlan,
  };
})(globalThis.OV || (globalThis.OV = {}));
