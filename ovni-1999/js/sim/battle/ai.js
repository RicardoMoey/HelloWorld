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
   TUNE lidas: CHEAT_TURN, AI_MAX_ACTIONS, AI_PASSES, AI_GRENADE_FROM_TURN, AI_GRENADE_FUSE (espoleta por dificuldade), TU_PSI, TU_KNEEL, TU_STAND, DARK_SHADE e
     AI_MIND_CONTROL (omissão false: no MVP a IA só usa Pânico; true ativa o Controlo Mental com controlOdds).
     AI_MELEE_HEAR (8): distância a que Crisálidas/Ceifadores/Zombies «ouvem» um alvo conhecido do lado mas não visto.
   Conhecimento dos alienígenas: só o que o lado viu (turnsSinceSpotted ≤ inteligência) até ao turno de batota; as
   unidades corpo a corpo só investem contra quem viram elas próprias (u.ai.memory.seen), quem as atingiu ou quem
   ouvem; o Blaster só dispara pelas regras dos explosivos (turno ≥ AI_GRENADE_FROM_TURN, eficácia > 0).
   playerBot (lado X-COM, só headless): ver botThink/botTurn — fogo concentrado, granadas, lanços com vigia, cerco ao
     OVNI, fumo, flares, medikit, recuo para a nave, coesão; conhece só o que a equipa viu (fantasmas na última posição).
   Estado novo em B (JSON): B.cheat (já existia; fica true a partir do turno de batota), B.aiMem = {xcom:{seen:{id:turno},
     pos:{id:tile}, goal, visited:[nó], contact (turno), lastShotTurn}}. Em cada unidade: u.ai.mode, u.ai.aggroId,
     u.ai.node, u.ai.memory {goal, failed, seen:{id:turno} (só corpo a corpo)}. */
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
  /* advance: % das UT base gastas a avançar num lanço; cohesion: distância máxima (Chebyshev) ao aliado mais próximo;
     exitFirst: soldados que saem da nave no turno 1 (os outros ficam a cobrir a rampa); smoke: fumo sobre feridos expostos;
     bound: avanço em lanços (a metade de trás avança e passa a da frente, que vigia com as UT todas); coverWeight: peso da
     cobertura na escolha do tile (em UT de progresso por meia cobertura); travel/travelDist: sem contacto e com o objetivo a
     mais de travelDist tiles, todos avançam até travel % das UT, sem lanços; ghostTurns: turnos que o bot se lembra da última
     posição vista de um alienígena; grenadeSingle: granada num alvo isolado quando a probabilidade de o abater a tiro
     (com as UT que restam) fica abaixo desta %; spacing/crowdWeight: afastamento desejado entre soldados (Chebyshev) e o
     seu peso (granadas e bombas apanham grupos); siege: até este turno, sem contacto, a equipa cerca a porta de entrada do
     OVNI em vez de entrar (0 = entra logo). */
  const PLAYER_BOT = Object.freeze({
    aggression: 1, intelligence: 10, flares: true, retreatPct: 33, medikit: true, grenades: true, kneelAimed: true,
    cohesion: 6, advance: 60, maxActions: 8, passes: 2, smoke: true, exitFirst: 4, bound: true, coverWeight: 10, travel: 70, travelDist: 14, ghostTurns: 3, grenadeSingle: 40,
    spacing: 3, crowdWeight: 5, siege: 12,
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
    if (!B.aiMem.xcom.pos) B.aiMem.xcom.pos = {};
    return B.aiMem.xcom;
  }
  /* Alienígenas que a X-COM vê agora ficam memorizados (turno e tile do último avistamento). Um alienígena
     lembrado cujo último tile a equipa vê agora sem ele lá é esquecido (já não se sabe onde está). */
  function recordSightings(B) {
    if (!OV.LOS || !B._ || !B._.visible || !B._.visible.xcom) return;
    const M = mem(B);
    for (const id of B._.visible.xcom) {
      const t = BU().findUnit(B, id);
      if (t && t.side === 'alien' && LIVE[t.status]) {
        M.seen[id] = B.turn;
        M.pos[id] = tileOf(B, t);
        M.contact = B.turn;
      }
    }
    const vt = B._.visTiles;
    if (!vt) return;
    for (const k of Object.keys(M.pos)) {
      if (B._.visible.xcom.has(+k)) continue;
      if (vt[M.pos[k]]) {
        delete M.pos[k];
        delete M.seen[k];
      }
    }
  }
  // alienígenas: cada unidade corpo a corpo lembra-se de quem viu ela própria (e de quem a atingiu)
  function recordOwnSightings(B) {
    if (!B._ || !B._.sees) return;
    for (const u of B.units) {
      if (u.side !== 'alien' || !active(u) || !u.ai) continue;
      const s = B._.sees[u.id];
      const hit = Array.isArray(u.ai.wasHitBy) ? u.ai.wasHitBy : [];
      if ((!s || !s.size) && !hit.length) continue;
      if (!arms(B, u).meleeOnly) continue;
      const memo = u.ai.memory || (u.ai.memory = {});
      const seen = memo.seen || (memo.seen = {});
      if (s) for (const id of s) seen[id] = B.turn;
      for (const id of hit) seen[id] = B.turn;
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
    const out = { gun: null, melee: null, reload: null, empty: null, grenades: [], smoke: [], flare: null, medikit: null, psi: !!u.psi };
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
      if (def.kind === 'grenade' && def.prime && !def.proximity && (it.fuse < 0 || it.fuse === undefined || it.fuse === null)) {
        if (def.dmg === 'SMOKE') out.smoke.push(it);
        else out.grenades.push(it);
      }
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
      grenaded: new Set(), danger: dangerMap(B), cache: new Map(), flares: 0, fired: new Set(), moved: new Set(),
      turned: new Set(), pass: 0, team: null, stalled: false,
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
     vista do lado); para o playerBot, alienígenas à vista ou, vistos há ≤ inteligência turnos, um «fantasma» na
     última posição vista (o bot não sabe para onde se mexeram). */
  function ghostOf(B, t, i) {
    const [x, y, z] = BM().xyz(B.map, i);
    return {
      id: t.id, side: t.side, type: t.type, status: 'ok', onMap: true, x, y, z, size: t.size, dir: t.dir, height: t.height,
      kneelHeight: t.kneelHeight, kneel: false, hp: t.hp, hpMax: t.hpMax, armour: t.armour, mods: t.mods, float: t.float,
      canFly: t.canFly, stats: t.stats, ghost: true,
    };
  }
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
        const ghost = Math.min(intel, prof && prof.ghostTurns !== undefined ? prof.ghostTurns | 0 : intel);
        if (s !== undefined && B.turn - s <= ghost && M.pos[t.id] !== undefined) out.push(ghostOf(B, t, M.pos[t.id]));
        continue;
      }
      if (known) out.push(t);
    }
    return out;
  }
  /* Unidades corpo a corpo alienígenas (Crisálida, Ceifador, Zombie): só investem contra quem viram elas próprias
     (memória por unidade, inteligência em turnos), quem as atingiu ou quem está tão perto que o ouvem; de resto
     patrulham. O turno de batota levanta a restrição. */
  function meleeKnown(B, u, known, intel, ctx) {
    if (ctx.cheat) return known;
    const seen = (u.ai && u.ai.memory && u.ai.memory.seen) || {};
    const hear = tune('AI_MELEE_HEAR', 8);
    return known.filter((t) => sees(B, u, t) || (seen[t.id] !== undefined && B.turn - seen[t.id] <= intel) || udist(u, t) <= hear);
  }
  function unitContext(B, u, ctx) {
    const prof = ctx.profile;
    let known = knownEnemies(B, u, prof);
    if (u.side === 'alien' && known.length && arms(B, u).meleeOnly) known = meleeKnown(B, u, known, intelligence(u, prof), ctx);
    const visible = known.filter((t) => !t.ghost && sees(B, u, t));
    const spotters = known.filter((t) => !t.ghost && t.side !== 'civ' && sees(B, t, u));
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
    if (!g || !c.visible.length || c.arms.blaster) return null;
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
        // a bomba guiada voa por uma rota (Act.validate); os alienígenas continuam a só a disparar com linha de tiro
        // (com rotas à volta das esquinas a base alienígena do mês 3 em Veterano caía de 54 % para 38 % de vitórias)
        if (u.side === 'alien' && !OV.LOS.targetVoxel(B, u, i)) continue;
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
    steps.push({ type: 'prime', unitId: u.id, itemId: g.id, fuse: alienFuse(B, u) });
    steps.push({ type: 'throw', unitId: u.id, itemId: g.id, toI: best.i });
    const first = steps.shift();
    ctx.queue[u.id] = steps;
    return first;
  }
  /* ours: espoleta das granadas alienígenas por dificuldade (AI_GRENADE_FUSE). Em Recruta (1) a granada cai no fim do
     turno alienígena e só rebenta no fim do turno X-COM seguinte: o jogador vê-a e pode afastar a equipa. */
  function alienFuse(B, u) {
    if (u.side !== 'alien') return 0;
    const f = tune('AI_GRENADE_FUSE', [0, 0, 0]);
    const d = U.clamp((B.mission && B.mission.difficulty) | 0, 0, 2);
    return Array.isArray(f) ? f[d] | 0 : f | 0;
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
    let best = -1, bs = -1e9;
    for (const i of cands) {
      if (!OV.LOS.canSeeFrom(B, u, i, target)) continue;
      let s = 100 - reach.cost[i] + 20;
      if (hasCover(m, i, target)) s += 10;
      if (exposure(B, u, i, c.known, 2) > 1) s -= 30;
      if (m.fire[i] > 0) s -= 40;
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0 || best === reach.origin) return null;
    return walkTo(B, u, reach, best, false);
  }

  // combate alienígena (DESIGN §11.2): psi → corpo a corpo → explosivos → tiro → ponto de tiro / aproximação
  function combatPlan(B, u, c, ctx) {
    const psi = psiPlan(B, u, c, ctx);
    if (psi) return psi;
    if (c.arms.meleeOnly) return meleePlan(B, u, c, ctx);
    const ex = explosivePlan(B, u, c, ctx);
    if (ex) return ex;
    const shot = shotPlan(B, u, c, ctx);
    if (shot) return shot;
    if (!c.known.length || !c.arms.gun) return null;
    const go = ctx.cheat || c.spotters.length > 0 || c.aggr < B.rng.ai.int(0, 3);
    if (!go) return null;
    let target = c.known.find((t) => t.id === u.ai.aggroId) || c.nearest;
    if (c.visible.length && !c.visible.includes(target)) target = c.visible[0];
    u.ai.aggroId = target.id;
    const fp = firePoint(B, u, c, ctx, target);
    if (fp) return fp;
    // sem ponto de tiro: aproxima-se guardando as UT do ataque
    const a = walkToward(B, u, tileOf(B, target), (u.tu | 0) - c.atkTU, { stop: (i) => ctx.danger[i] === 1 });
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
    // nó explorado: a equipa vê o tile dele (não basta estar perto: o casco do OVNI esconde o interior)
    const vt = B._ && B._.visTiles;
    for (let k = 0; k < nodes.length; k++) {
      if (M.visited.indexOf(k) >= 0) continue;
      const n = nodes[k];
      const ti = nodeTile(B, k);
      const near = squad.some((s) => s.z === n.z && Math.abs(s.x - n.x) <= 8 && Math.abs(s.y - n.y) <= 8);
      if (near && (vt ? vt[ti] : true)) M.visited.push(k);
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
  // flare: à frente no caminho até goal; com at (tile) explícito, para esse tile (p. ex. onde se viu um alienígena)
  function flarePlan(B, u, c, ctx, goal, at) {
    const m = B.map;
    const it = c.arms.flare;
    const slot = BU().slotOf(u, it.id);
    const inHand = slot === 'R' || slot === 'L';
    const free = BU().item(B, u, 'L') === null ? 'L' : BU().item(B, u, 'R') === null ? 'R' : null;
    if (!inHand && !free) return null;
    const range = D().throwRange(u.stats.str | 0, defOf(it).weight | 0);
    // candidatos: o tile pedido, ou tiles do caminho a 10, 8, 6 e 4 passos (o primeiro com arco possível, escuro e longe
    // de outro flare deste turno)
    const cands = [];
    if (at >= 0) {
      if (idist(m, at, u) > range || idist(m, at, u) < 4) return null;
      cands.push(at);
    } else {
      const p = OV.Path.find(B, u, goal, null, { units: 'none' });
      if (!p || p.tiles.length < 5) return null;
      for (const k of [10, 8, 6, 4]) if (k < range && k < p.tiles.length) cands.push(p.tiles[k]);
    }
    let to = -1;
    for (const i of cands) {
      const [fx, fy] = BM().xyz(m, i);
      if (ctx.lit && ctx.lit.some((j) => { const [lx, ly] = BM().xyz(m, j); return cheb(lx, ly, fx, fy) <= 4; })) continue;
      if (OV.LOS.shadeAt(B, i) <= tune('DARK_SHADE', 9)) continue;
      if (!OV.Act.planArc(B, u, i)) continue;
      to = i;
      break;
    }
    if (to < 0) return null;
    const cost = (inHand ? 0 : D().invMoveTU(slot, free) | 0) + BU().actionTU(B, u, it.id, 'throw') + 4;
    if ((u.tu | 0) - cost < 20) return null;
    ctx.flares++;
    (ctx.lit || (ctx.lit = [])).push(to);
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
    // o medikit volta à mochila só quando sobram UT para isso e para a vigia (senão fica na mão até ao turno seguinte)
    if (inHand && (u.side !== 'xcom' || (u.tu | 0) - 14 >= overwatchTU(B, u, c) || !c.known.length)) {
      const back = { type: 'inv', unitId: u.id, itemId: kit.id, to: 'pack' };
      if (valid(B, back)) return back;
      const belt = { type: 'inv', unitId: u.id, itemId: kit.id, to: 'belt' };
      if (valid(B, belt)) return belt;
    }
    return null;
  }

  // ---- playerBot: tática de um jogador competente (DESIGN §11.10) ---------------------------------------------
  /* Por turno: quem vê alienígenas dispara primeiro (fogo concentrado no mais perigoso), granadas em grupos e em
     Crisálidas/Ceifadores que se aproximam; sem inimigos à vista avança em lanços (≤ metade das UT, termina em
     cobertura, nunca a mais de `cohesion` tiles do aliado mais próximo, nunca à porta do OVNI) e fica de vigia
     (ajoelhado, virado para a ameaça, com UT para um tiro rápido de reação). Feridos (< 1/3 de vida) recuam para a
     nave fora da vista; fumo para cobrir quem fica exposto; flares à frente de noite; medikit em quem sangra. */
  const MELEE_TERROR = { chryssalid: 1, reaper: 1, zombie: 1 };
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  // sonda: soldado hipotético num tile (para «o inimigo t veria alguém ali?», com a vista dele)
  const PROBE = { id: -1, side: 'xcom', status: 'ok', onMap: true, x: 0, y: 0, z: 0, size: 1, dir: 0, height: 22, kneelHeight: 14, kneel: false };
  function enemySees(B, t, i, kneel) {
    if (t.side === 'civ') return false;
    const [x, y, z] = BM().xyz(B.map, i);
    if (cheb(x, y, t.x, t.y) > 20) return false;
    PROBE.x = x;
    PROBE.y = y;
    PROBE.z = z;
    PROBE.kneel = !!kneel;
    return OV.LOS.canSeeFrom(B, t, tileOf(B, t), PROBE);
  }
  // quantos inimigos conhecidos veriam um soldado (ajoelhado ou de pé) no tile i — até cap
  function threatCount(B, i, list, kneel, cap, ctx) {
    const key = 't' + i + (kneel ? 'k' : 's') + list.length;
    const hit = ctx.cache.get(key);
    if (hit !== undefined) return Math.min(hit, cap);
    let n = 0;
    for (const t of list) if (enemySees(B, t, i, kneel) && ++n >= 3) break;
    ctx.cache.set(key, n);
    return Math.min(n, cap);
  }
  // cobertura no tile i na direção de (tx,ty): 0..2 (parede/vedação/objeto alto entre o tile e a ameaça)
  function coverToward(m, i, tx, ty) {
    const [x, y, z] = BM().xyz(m, i);
    const dir = U.dirTo(tx - x, ty - y);
    if (dir < 0) return 0;
    const dirs = dir & 1 ? [(dir + 7) & 7, (dir + 1) & 7] : [dir];
    let n = 0;
    for (const d of dirs) {
      const e = BM().edgeInfo(m, x, y, z, d);
      if (e.blocked.move || e.blocked.los) { n++; continue; }
      const j = BM().neighbour(m, i, d);
      if (j < 0) continue;
      const o = BM().objectDef(m, j);
      if (o && (o.fullBlock || ((o.height | 0) >= 8 && (o.tu | 0) >= 255))) n++;
    }
    return dirs.length === 1 ? 2 * n : n;
  }
  // penalização por aliados demasiado perto (granadas de raio 5 apanham grupos): 3 por aliado a ≤ 1 tile, 1 até spacing
  function crowding(allies, x, y, z, spacing) {
    let n = 0;
    for (const s of allies) {
      if (Math.abs(s.z - z) > 1) continue;
      const d = cheb(x, y, s.x, s.y);
      if (d <= 1) n += 3;
      else if (d <= spacing) n++;
    }
    return n;
  }
  function nearestAlly(allies, x, y, z) {
    let d = 99;
    for (const s of allies) d = Math.min(d, cheb(x, y, s.x, s.y) + 2 * Math.abs(s.z - z));
    return d;
  }
  // UT de vigia: tiro rápido (ou o ataque de referência) + ajoelhar + uma rotação
  function overwatchTU(B, u, c) {
    const g = c.arms.gun;
    if (!g) return 0;
    const snap = hasMode(g.it.type, 'snap') ? BU().actionTU(B, u, g.it.id, 'snap') : c.atkTU;
    return (snap | 0) + (u.kneel ? 0 : tune('TU_KNEEL', 4)) + 2;
  }
  // custos (UT) a partir de um tile para todo o mapa, por Dijkstra de uma sonda (cache por turno)
  function costFrom(B, ctx, u, goal) {
    const T = ctx.team;
    const key = 'g' + goal;
    if (T && T.maps.has(key)) return T.maps.get(key);
    const [x, y, z] = BM().xyz(B.map, goal);
    const probe = Object.assign({}, u, { x, y, z, kneel: false, tu: 9999, energy: 9999, onMap: true });
    const r = OV.Path.reachable(B, probe, 9999, 9999, { units: 'none' });
    if (T) T.maps.set(key, r.cost);
    return r.cost;
  }
  function objectivesLeft(B) {
    const out = [];
    for (const i of B.objectiveTiles || []) {
      for (let p = 0; p < 4; p++) {
        const d = BM().def(B.map, i, p);
        if (d && d.special === 'OBJECTIVE') { out.push(i); break; }
      }
    }
    return out;
  }
  // tile de pé ao lado de um tile (objetivo não é transitável)
  function standNear(B, i) {
    const m = B.map;
    if (BM().canStand(m, i)) return i;
    for (let d = 0; d < 8; d++) {
      const j = BM().neighbour(m, i, d);
      if (j >= 0 && BM().canStand(m, j)) return j;
    }
    return -1;
  }
  /* Estado da equipa no turno: portas do OVNI (e vizinhas), tiles da nave, objetivo comum e mapa de custos até ele. */
  function team(B, ctx, u) {
    if (ctx.team) return ctx.team;
    const m = B.map;
    const T = { maps: new Map(), doors: new Set(), craft: new Set(B.craftTiles || []), goal: -1, exitLeft: 1e9, home: -1 };
    ctx.team = T;
    for (let i = 0; i < m.n; i++) {
      let door = false;
      for (let p = 1; p < 4 && !door; p++) {
        const d = BM().def(m, i, p);
        if (d && d.door === 'ufo') door = true;
      }
      if (!door) continue;
      T.doors.add(i);
      for (let d = 0; d < 8; d++) {
        const j = BM().neighbour(m, i, d);
        if (j >= 0) T.doors.add(j);
      }
    }
    const lead = u || squadOf(B, { side: 'xcom' })[0];
    if (!lead) return T;
    T.home = (B.xcomStarts || [])[0] === undefined ? -1 : B.xcomStarts[0];
    const obj = objectivesLeft(B);
    if (obj.length) {
      let best = -1, bd = 1e9;
      for (const i of obj) {
        const j = standNear(B, i);
        if (j >= 0 && idist(m, j, lead) < bd) { bd = idist(m, j, lead); best = j; }
      }
      T.goal = best;
    }
    if (T.goal < 0) {
      T.goal = exploreGoal(B, lead);
      const M0 = mem(B);
      T.goalInside = T.goal >= 0 && M0.goal >= 0 && !!(B.nodes[M0.goal] && B.nodes[M0.goal].inside);
    }
    if (T.goal >= 0) T.goalMap = costFrom(B, ctx, lead, T.goal);
    // lanços: a metade da frente (mais perto do objetivo) vigia, a de trás avança e passa-lhe à frente
    if (T.goalMap) {
      const sq = squadOf(B, lead).filter((x) => x.status !== 'panic');
      const gm = (x) => (T.goalMap[tileOf(B, x)] >= 0 ? T.goalMap[tileOf(B, x)] : 32000);
      sq.sort((a, b) => gm(a) - gm(b) || a.id - b.id);
      T.front = new Set(sq.slice(0, sq.length >> 1).map((x) => x.id));
      // viagem: ainda sem contacto nesta batalha e o objetivo (ou o OVNI) longe da frente ⇒ todos avançam, mais depressa
      const M = mem(B);
      const lead0 = sq[0];
      let far = sq.length > 0 && gm(lead0) > 4 * (prof0(ctx).travelDist | 0 || 14);
      if (far && B.ufo && lead0) {
        const r = B.ufo;
        far = Math.max(Math.max(0, r.x - lead0.x, lead0.x - (r.x + r.w - 1)), Math.max(0, r.y - lead0.y, lead0.y - (r.y + r.h - 1))) > (prof0(ctx).travelDist | 0 || 14);
      }
      T.travel = far && !(M.contact >= B.turn - 2);
    }
    if (B.turn === 1 && typeof ctx.profile.exitFirst === 'number') T.exitLeft = ctx.profile.exitFirst | 0;
    return T;
  }
  const prof0 = (ctx) => ctx.profile || PLAYER_BOT;
  /* lanços sem contacto: prof.bound 'always' | 'contact' (só com contacto nos últimos 2 turnos) | false */
  function bounding(B, ctx) {
    const T = ctx.team, b = ctx.profile.bound;
    if (!b || !T || T.travel || B.turn <= 1) return false;
    if (b === 'contact') return mem(B).contact >= B.turn - 2;
    return true;
  }
  // ponto para onde virar e de onde vem a ameaça: inimigo conhecido mais próximo, senão o OVNI, senão o objetivo
  function threatPoint(B, u, c, ctx) {
    if (c.nearest) return [c.nearest.x, c.nearest.y];
    if (B.ufo) {
      const M = mem(B);
      const inside = (B.nodes || []).some((n, k) => n.inside && M.visited.indexOf(k) < 0);
      if (inside) return [B.ufo.x + (B.ufo.w >> 1), B.ufo.y + (B.ufo.h >> 1)];
    }
    const T = team(B, ctx, u);
    if (T.goal >= 0) {
      const [x, y] = BM().xyz(B.map, T.goal);
      return [x, y];
    }
    return [B.map.w >> 1, B.map.h >> 1];
  }

  /* Avanço em lanço até ao objetivo: ≤ pct % das UT base (guardando as UT de vigia), escolhe o tile com mais
     progresso + cobertura, longe das portas do OVNI, sem se colar a aliados nem se afastar mais de cohesion do
     mais próximo; com inimigos conhecidos, fora da vista deles. */
  function advancePlan(B, u, c, ctx, goal, pct) {
    if (!(goal >= 0)) return null;
    const T = team(B, ctx, u);
    const gc = costFrom(B, ctx, u, goal);
    const here = tileOf(B, u);
    if (here === goal) return null;
    const hc = gc[here] >= 0 ? gc[here] : 32000;
    const keep = overwatchTU(B, u, c);
    const budget = Math.min((u.tu | 0) - keep, idiv((u.stats.tu | 0) * pct, 100)) - standCost(u);
    if (budget < 4) return null;
    const reach = reachFor(B, u, budget, ctx);
    const allies = squadOf(B, u).filter((s) => s !== u);
    const coh = ctx.profile.cohesion | 0 || 6;
    const d0 = allies.length ? nearestAlly(allies, u.x, u.y, u.z) : 0;
    const [tx, ty] = threatPoint(B, u, c, ctx);
    const cands = [];
    for (let k = 1; k < reach.list.length; k++) {
      const i = reach.list[k];
      const g = gc[i];
      if (g < 0 || g >= hc || ctx.danger[i] || B.map.fire[i] > 0 || T.doors.has(i)) continue;
      const [x, y, z] = BM().xyz(B.map, i);
      if (allies.length) {
        const da = nearestAlly(allies, x, y, z);
        if (da > coh && da >= d0) continue;
      }
      const s = (hc - g) + (ctx.profile.coverWeight | 0) * coverToward(B.map, i, tx, ty)
        - (ctx.profile.crowdWeight | 0) * crowding(allies, x, y, z, ctx.profile.spacing | 0);
      cands.push({ i, s });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.s - a.s || a.i - b.i);
    let best = -1, bs = -1e9;
    const lim = c.known.length ? 16 : 1;
    for (let k = 0; k < cands.length && k < lim; k++) {
      let s = cands[k].s;
      if (c.known.length) s -= 40 * threatCount(B, cands[k].i, c.known, true, 2, ctx);
      if (s > bs) { bs = s; best = cands[k].i; }
    }
    if (best < 0 || bs <= 0) return null;
    return walkTo(B, u, reach, best, false);
  }

  /* Ponto de tiro (contacto sem alvo à vista): ≤ metade das UT, de onde se vê um inimigo conhecido, com cobertura,
     à vista de no máximo um; o caminho evita os cones de visão conhecidos. Dispara na decisão seguinte. */
  function botFirePoint(B, u, c, ctx) {
    if (!c.arms.gun) return null;
    const budget = Math.min((u.tu | 0) - c.atkTU - tune('TU_KNEEL', 4), idiv((u.stats.tu | 0) * (ctx.profile.advance | 0 || 50), 100)) - standCost(u);
    if (budget < 4) return null;
    const targets = c.known.filter((t) => t.side !== 'civ' && udist(u, t) <= 26).sort((a, b) => udist(u, a) - udist(u, b) || a.id - b.id).slice(0, 4);
    if (!targets.length) return null;
    const T = team(B, ctx, u);
    const reach = reachFor(B, u, budget, ctx);
    const risk = new Map();
    const allies = squadOf(B, u).filter((x) => x !== u);
    const coh = ctx.profile.cohesion | 0 || 6;
    const d0 = allies.length ? nearestAlly(allies, u.x, u.y, u.z) : 0;
    let best = -1, bs = -1e9, n = 0;
    for (let k = 1; k < reach.list.length && n < 70; k++) {
      const i = reach.list[k];
      if (ctx.danger[i] || B.map.fire[i] > 0 || T.doors.has(i)) continue;
      const [x, y, z] = BM().xyz(B.map, i);
      if (allies.length) {
        const da = nearestAlly(allies, x, y, z);
        if (da > coh && da >= d0) continue;
      }
      let tgt = null;
      for (const t of targets) if (cheb(x, y, t.x, t.y) <= 20 && OV.LOS.canSeeFrom(B, u, i, t)) { tgt = t; break; }
      n++;
      if (!tgt) continue;
      const ex = threatCount(B, i, c.known, true, 3, ctx);
      if (ex > 1) continue;
      const s = 100 - reach.cost[i] + 12 * coverToward(B.map, i, tgt.x, tgt.y) - 25 * ex - 12 * pathRisk(B, reach, i, c.known, risk);
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0) return null;
    return walkTo(B, u, reach, best, false);
  }

  /* Tiro com fogo concentrado: valor do alvo = perigo × probabilidade de o abater com as UT que restam; modo com
     mais acertos esperados (auto conta 3 balas); ajoelha antes se isso não custar um tiro. Probabilidades pelo
     modelo real (Combat.hitChance) com uma stream local determinística que não toca em B. */
  function hitP(B, u, g, mode, t, ctx) {
    const key = 'h' + u.id + ':' + tileOf(B, u) + ':' + (u.kneel ? 1 : 0) + ':' + t.id + ':' + mode;
    let p = ctx.cache.get(key);
    if (p === undefined) {
      const rng = OV.RNG.create(((B.turn * 7919) ^ (u.id * 104729) ^ (t.id * 31) ^ (tileOf(B, u) * 13)) >>> 0);
      p = OV.Combat && OV.Combat.hitChance ? OV.Combat.hitChance(B, u, g.it.id, mode, t, rng, 12) : 50;
      ctx.cache.set(key, p);
    }
    return p;
  }
  function dangerOf(B, t, squad) {
    let d = 10, near = 99;
    for (const s of squad) near = Math.min(near, udist(s, t));
    if (MELEE_TERROR[t.type]) d += 25 + 4 * Math.max(0, 12 - near);
    for (const s of squad) if (sees(B, t, s)) { d += 15; break; }
    if (t.psi) d += 10;
    const w = BU().item(B, t, 'R');
    const wd = w ? D().items[w.type] : null;
    if (wd && wd.guided) d += 30;
    else if (wd && w.type === 'heavy_plasma') d += 8;
    return d;
  }
  function botShot(B, u, c, ctx) {
    const g = c.arms.gun;
    if (!g || !c.visible.length) return null;
    const squad = squadOf(B, u);
    const pw = g.ammo ? g.ammo.power | 0 : 0;
    const dmgType = g.ammo ? g.ammo.dmg : null;
    const R = g.ammo ? g.ammo.radius | 0 : 0;
    const modes = ['snap', 'auto', 'aimed'].filter((mo) => hasMode(g.it.type, mo));
    let best = null;
    const list = c.visible.filter((t) => t.side === 'alien').sort((a, b) => udist(u, a) - udist(u, b) || a.id - b.id).slice(0, 5);
    for (const t of list) {
      if (R > 0 && friendsNear(B, u, t.x, t.y, t.z, R)) continue;
      const mod = t.mods && dmgType && t.mods[dmgType] !== undefined ? t.mods[dmgType] | 0 : 100;
      const arm = Array.isArray(t.armour) ? t.armour[0] | 0 : 0;
      const per = Math.max(2, idiv(pw * mod, 100) - arm);
      const need = Math.max(1, Math.ceil(Math.max(1, t.hp | 0) / per));
      const danger = dangerOf(B, t, squad);
      for (const mo of modes) {
        const cost = BU().actionTU(B, u, g.it.id, mo) | 0;
        if (cost <= 0 || cost > (u.tu | 0)) continue;
        const a = { type: 'shoot', unitId: u.id, hand: g.hand, mode: mo, target: { unitId: t.id } };
        if (!valid(B, a)) continue;
        const p = hitP(B, u, g, mo, t, ctx);
        const shots = mo === 'auto' ? 3 : 1;
        const n = Math.max(1, idiv(u.tu | 0, cost));
        const hits = n * shots * p; // ×100
        const kill = Math.min(100, idiv(hits, need));
        const v = danger * kill + idiv(hits, 10);
        if (!best || v > best.v || (v === best.v && p > best.p)) best = { v, a, p, cost, n, t };
      }
    }
    ctx.shotKill = best ? Math.min(100, idiv(best.v, Math.max(1, dangerOf(B, best.t, squad)))) : 0;
    if (!best || best.p <= 0) return null;
    // ajoelhar primeiro (+15 % de precisão) quando não custa um tiro deste modo e ninguém o vê (ajoelhar provoca reação)
    if (ctx.profile.kneelAimed && !u.kneel && BU().canKneel(u) && !c.spotters.length) {
      const kt = tune('TU_KNEEL', 4);
      if (idiv((u.tu | 0) - kt, best.cost) >= best.n && (u.tu | 0) - kt >= best.cost) {
        const k = { type: 'kneel', unitId: u.id };
        if (valid(B, k)) return k;
      }
    }
    u.ai.aggroId = best.t.id;
    return best.a;
  }

  /* Granadas do bot: só contra alvos vistos agora (ou neste turno), sem aliados nem civis no raio; num grupo de ≥ 2
     ou numa Crisálida/Ceifador/Zombie a ≤ 10 tiles de um soldado. */
  function botGrenade(B, u, c, ctx) {
    if (!ctx.profile.grenades || !c.arms.grenades.length) return null;
    const M = mem(B);
    const targets = c.known.filter((t) => t.side === 'alien' && (!t.ghost || M.seen[t.id] === B.turn));
    if (!targets.length) return null;
    const g = c.arms.grenades.find((it) => BU().slotOf(u, it.id) === 'R' || BU().slotOf(u, it.id) === 'L') || c.arms.grenades[0];
    const slot = BU().slotOf(u, g.id);
    const inHand = slot === 'R' || slot === 'L';
    const free = BU().item(B, u, 'R') === null ? 'R' : BU().item(B, u, 'L') === null ? 'L' : null;
    // a granada vai para a mão livre (o bot não larga a arma)
    if (!inHand && !free) return null;
    const def = defOf(g);
    const R = Math.max(1, def.radius | 0);
    const cost = (inHand ? 0 : Math.max(D().invMoveTU(slot, free) | 0, 4)) + BU().actionTU(B, u, g.id, 'prime') + BU().actionTU(B, u, g.id, 'throw');
    if ((u.tu | 0) < cost) return null;
    const range = D().throwRange(u.stats.str | 0, def.weight | 0);
    const squad = squadOf(B, u);
    const m = B.map;
    let best = null;
    for (const t of targets) {
      if (t.float || (t.canFly && t.z > 0 && !BM().hasFloor(m, tileOf(B, t)))) continue;
      const i = tileOf(B, t);
      if (ctx.grenaded.has(i)) continue;
      const [x, y, z] = [t.x, t.y, t.z];
      let enemies = 0, bad = 0;
      for (const e of targets) if (e.z === z && (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= R * R) enemies++;
      for (const f of B.units) {
        if (!active(f) || f.side === 'alien' || f.z !== z) continue;
        if ((f.x - x) * (f.x - x) + (f.y - y) * (f.y - y) <= (R + 1) * (R + 1)) bad++;
      }
      if (bad) continue;
      let near = 99;
      for (const s of squad) near = Math.min(near, udist(s, t));
      const terror = MELEE_TERROR[t.type] && near <= 10;
      // um só alvo: só quando o tiro tem pouca hipótese de o abater (alienígena em cobertura, longe)
      const single = ctx.profile.grenadeSingle && !t.ghost && (ctx.shotKill | 0) < (ctx.profile.grenadeSingle | 0);
      if (enemies < 2 && !terror && !single) continue;
      const score = enemies * 10 + (terror ? 15 : 0);
      if (best && score <= best.score) continue;
      const dx = x - u.x, dy = y - u.y, dz = idiv((z - u.z) * 3, 2);
      if (U.isqrt(dx * dx + dy * dy + dz * dz) > range) continue;
      if (!OV.Act.planArc(B, u, i)) continue;
      best = { score, i };
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

  /* Fumo a cobrir o soldado s (o próprio ou um aliado) exposto: granada de fumo 1–2 tiles à frente dele, na direção
     da ameaça que o vê. */
  function smokePlan(B, u, c, ctx, s, threat) {
    if (!ctx.profile.smoke || !c.arms.smoke.length || !threat) return null;
    const g = c.arms.smoke[0];
    const slot = BU().slotOf(u, g.id);
    const inHand = slot === 'R' || slot === 'L';
    const free = BU().item(B, u, 'R') === null ? 'R' : BU().item(B, u, 'L') === null ? 'L' : null;
    if (!inHand && !free) return null;
    const cost = (inHand ? 0 : Math.max(D().invMoveTU(slot, free) | 0, 4)) + BU().actionTU(B, u, g.id, 'prime') + BU().actionTU(B, u, g.id, 'throw');
    if ((u.tu | 0) < cost) return null;
    const def = defOf(g);
    const range = D().throwRange(u.stats.str | 0, def.weight | 0);
    const m = B.map;
    const dir = U.dirTo(threat.x - s.x, threat.y - s.y);
    if (dir < 0) return null;
    // 1–3 tiles à frente dele, também ao lado (um arco rasante não passa por cima de quem está na linha)
    const px = U.DX[(dir + 2) & 7], py = U.DY[(dir + 2) & 7];
    const spots = [];
    for (const k of [2, 1, 3]) for (const l of [0, 1, -1]) spots.push([s.x + U.DX[dir] * k + px * l, s.y + U.DY[dir] * k + py * l]);
    for (const [x, y] of spots) {
      if (!BM().inB(m, x, y, s.z)) continue;
      const i = BM().idx(m, x, y, s.z);
      if (ctx.smoked && ctx.smoked.has(i)) return null;
      if (i === tileOf(B, u) || !BM().hasFloor(m, i)) continue;
      const dx = x - u.x, dy = y - u.y;
      if (U.isqrt(dx * dx + dy * dy) > range) continue;
      if (!OV.Act.planArc(B, u, i)) continue;
      (ctx.smoked || (ctx.smoked = new Set())).add(i);
      const steps = [];
      if (!inHand) steps.push({ type: 'inv', unitId: u.id, itemId: g.id, to: free });
      steps.push({ type: 'prime', unitId: u.id, itemId: g.id, fuse: 0 });
      steps.push({ type: 'throw', unitId: u.id, itemId: g.id, toI: i });
      const first = steps.shift();
      ctx.queue[u.id] = steps;
      return first;
    }
    return null;
  }

  function coverAllyPlan(B, u, c, ctx) {
    if (!ctx.profile.smoke || !c.arms.smoke.length || ctx.smokeUsed !== undefined) return null;
    const seen = c.known.filter((t) => !t.ghost && t.side === 'alien');
    for (const s of squadOf(B, u)) {
      if ((s.hp | 0) * 2 >= Math.max(1, s.hpMax | 0)) continue;
      const th = seen.find((t) => enemySees(B, t, tileOf(B, s), s.kneel));
      if (!th) continue;
      const a = smokePlan(B, u, c, ctx, s, th);
      if (a) {
        ctx.smokeUsed = s.id;
        return a;
      }
    }
    return null;
  }

  // recuo do ferido: para a nave, por tiles fora da vista dos inimigos conhecidos; acaba o turno
  function retreatPlan(B, u, c, ctx) {
    const T = team(B, ctx, u);
    if (T.home < 0) return hidePlan(B, u, c, ctx);
    const gc = costFrom(B, ctx, u, T.home);
    const here = tileOf(B, u);
    const hc = gc[here] >= 0 ? gc[here] : 32000;
    const reach = reachFor(B, u, (u.tu | 0) - standCost(u) - tune('TU_KNEEL', 4), ctx);
    const memo = new Map();
    const cands = [];
    for (let k = 1; k < reach.list.length; k++) {
      const i = reach.list[k];
      if (ctx.danger[i] || B.map.fire[i] > 0 || T.doors.has(i)) continue;
      const g = gc[i] >= 0 ? gc[i] : 32000;
      cands.push({ i, s: (hc - g) - 2 * reach.cost[i] / 4 });
    }
    cands.sort((a, b) => b.s - a.s || a.i - b.i);
    let best = -1, bs = -1e9;
    for (let k = 0; k < cands.length && k < 40; k++) {
      const i = cands[k].i;
      const ex = c.known.length ? threatCount(B, i, c.known, true, 3, ctx) : 0;
      const s = cands[k].s - 60 * ex - 10 * pathRisk(B, reach, i, c.spotters, memo);
      if (s > bs) { bs = s; best = i; }
    }
    ctx.ended.add(u.id);
    if (best < 0) return null;
    return walkTo(B, u, reach, best, false);
  }

  // medikit: vai ter com um aliado que sangra (sem ficar à vista de inimigos conhecidos)
  function medicWalkPlan(B, u, c, ctx) {
    if (!ctx.profile.medikit || !c.arms.medikit) return null;
    const wounds = (t) => (t.wounds || []).reduce((a, w) => a + (w | 0), 0);
    const hurt = squadOf(B, u).filter((t) => t !== u && wounds(t) > 0 && t.z === u.z && udist(u, t) <= 8);
    if (!hurt.length) return null;
    hurt.sort((a, b) => wounds(b) - wounds(a) || a.id - b.id);
    const reach = reachFor(B, u, (u.tu | 0) - 22 - standCost(u), ctx);
    const m = B.map;
    for (const t of hurt) {
      let best = -1, bc = 1e9;
      for (let d = 0; d < 8; d++) {
        const j = BM().neighbour(m, tileOf(B, t), d);
        if (j < 0 || reach.cost[j] < 0 || reach.cost[j] >= bc) continue;
        if (c.known.length && threatCount(B, j, c.known, true, 1, ctx) > 0) continue;
        bc = reach.cost[j];
        best = j;
      }
      if (best >= 0 && best !== reach.origin) return walkTo(B, u, reach, best, false);
    }
    return null;
  }

  // Cérebro (Cidónia) ou outro objetivo à vista: disparar contra o tile
  function objectivePlan(B, u, c, ctx) {
    const g = c.arms.gun;
    if (!g || !(B.objectiveTiles || []).length) return null;
    for (const i of objectivesLeft(B)) {
      if (idist(B.map, i, u) > 20) continue;
      for (const mo of ['auto', 'snap', 'aimed']) {
        if (!hasMode(g.it.type, mo)) continue;
        const a = { type: 'shoot', unitId: u.id, hand: g.hand, mode: mo, target: { i } };
        if (valid(B, a)) return a;
      }
    }
    return null;
  }

  /* Cerco ao OVNI (sem contacto, com o objetivo dentro dele): em vez de entrar pela porta, cada soldado toma posição a
     5–12 tiles da porta de entrada (a primeira do caminho até ao objetivo), com vista para ela e em cobertura, e
     vigia; quem sair apanha fogo cruzado. Depois do turno prof.siege a equipa entra. */
  function isDoorTile(m, i) {
    for (let p = 1; p < 4; p++) {
      const d = BM().def(m, i, p);
      if (d && d.door === 'ufo') return true;
    }
    return false;
  }
  function entryDoor(B, ctx, u) {
    const T = team(B, ctx, u);
    if (T.entry !== undefined) return T.entry;
    T.entry = -1;
    if (!B.ufo || T.goal < 0) return -1;
    const p = OV.Path.find(B, u, T.goal, null, { units: 'none' });
    if (p) for (const i of p.tiles) if (isDoorTile(B.map, i)) { T.entry = i; break; }
    return T.entry;
  }
  const DOOR_PROBE = { id: -2, side: 'alien', status: 'ok', onMap: true, x: 0, y: 0, z: 0, size: 1, dir: 0, height: 22, kneelHeight: 14, kneel: false };
  function siegePlan(B, u, c, ctx) {
    const door = entryDoor(B, ctx, u);
    if (door < 0) return null;
    const m = B.map;
    const [dx, dy, dz] = BM().xyz(m, door);
    Object.assign(DOOR_PROBE, { x: dx, y: dy, z: dz });
    const T = team(B, ctx, u);
    const allies = squadOf(B, u).filter((x) => x !== u);
    const sp = ctx.profile.spacing | 0;
    const good = (i, x, y, z) => {
      const d = cheb(x, y, dx, dy);
      return z === dz && d >= 5 && d <= 12 && !T.doors.has(i) && OV.LOS.canSeeFrom(B, u, i, DOOR_PROBE);
    };
    const here = tileOf(B, u);
    const score = (i, x, y, z, cost) => 30 - 3 * Math.abs(cheb(x, y, dx, dy) - 8) + (ctx.profile.coverWeight | 0) * coverToward(m, i, dx, dy)
      - (ctx.profile.crowdWeight | 0) * crowding(allies, x, y, z, sp) - (cost >> 2);
    let bs = -1e9, best = -1;
    if (good(here, u.x, u.y, u.z)) { bs = score(here, u.x, u.y, u.z, 0); best = here; }
    const reach = reachFor(B, u, (u.tu | 0) - overwatchTU(B, u, c) - standCost(u), ctx);
    let n = 0;
    for (let k = 1; k < reach.list.length && n < 120; k++) {
      const i = reach.list[k];
      if (ctx.danger[i] || m.fire[i] > 0) continue;
      const [x, y, z] = BM().xyz(m, i);
      if (Math.abs(cheb(x, y, dx, dy) - 8) > 4) continue;
      n++;
      const sc = score(i, x, y, z, reach.cost[i]);
      if (sc <= bs || !good(i, x, y, z)) continue;
      bs = sc;
      best = i;
    }
    if (best < 0) {
      // longe: aproxima-se da porta
      return advancePlan(B, u, c, ctx, door, ctx.profile.advance | 0 || 50);
    }
    if (best === here) return null;
    return walkTo(B, u, reach, best, false);
  }

  // fim do turno da unidade: virar para a ameaça e ajoelhar, guardando as UT do tiro rápido de reação
  function settlePlan(B, u, c, ctx) {
    const keep = c.arms.gun ? overwatchTU(B, u, c) - (u.kneel ? 0 : tune('TU_KNEEL', 4)) - 2 : 0;
    const [tx, ty] = threatPoint(B, u, c, ctx);
    const dir = U.dirTo(tx - u.x, ty - u.y);
    if (dir >= 0 && dir !== u.dir && !ctx.turned.has(u.id)) {
      ctx.turned.add(u.id);
      const a = { type: 'turn', unitId: u.id, dir };
      const v = OV.Act.validate(B, a);
      if (v.ok && (u.tu | 0) - (v.tu | 0) >= keep) return a;
    }
    if (!u.kneel && BU().canKneel(u) && !c.spotters.length && (u.tu | 0) - tune('TU_KNEEL', 4) >= keep) {
      const k = { type: 'kneel', unitId: u.id };
      if (valid(B, k)) return k;
    }
    ctx.ended.add(u.id);
    return null;
  }

  // decisão do playerBot (manutenção já tratada em think)
  function botThink(B, u, c, ctx) {
    const prof = ctx.profile;
    const T = team(B, ctx, u);
    u.ai.mode = c.known.length ? 'combat' : 'patrol';
    if (ctx.ended.has(u.id)) return null;
    const hurt = (u.hp | 0) * 100 < (prof.retreatPct | 0) * c.hpMax;
    const exposedNow = c.spotters.length > 0;
    // 1. ferido grave: fora da vista e de volta à nave; fumo se não houver onde se esconder
    if (hurt) {
      u.ai.mode = 'escape';
      if (!exposedNow && c.visible.length) {
        const sh = botShot(B, u, c, ctx);
        if (sh && (u.tu | 0) > idiv(u.stats.tu | 0, 2)) return sh;
      }
      const r = retreatPlan(B, u, c, ctx);
      if (r) return r;
      if (exposedNow) {
        const sm = smokePlan(B, u, c, ctx, u, c.spotters[0]);
        if (sm) return sm;
      }
      ctx.ended.delete(u.id);
    }
    // 2. inimigos à vista: granada (grupos, terror a aproximar-se) e tiro concentrado
    if (c.visible.length) {
      ctx.shotKill = 0;
      const sh = botShot(B, u, c, ctx);
      // um colega ferido (< 1/2) à vista de um alienígena que este tiro dificilmente abate: fumo sobre ele primeiro
      if ((ctx.shotKill | 0) < 50) {
        const cover = coverAllyPlan(B, u, c, ctx);
        if (cover) return cover;
      }
      const ex = botGrenade(B, u, c, ctx);
      if (ex) return ex;
      if (sh) return sh;
      if (exposedNow && !ctx.ended.has(u.id)) {
        const h = hidePlan(B, u, c, ctx);
        if (h) return h;
        ctx.ended.delete(u.id);
      }
    } else if (ctx.fired.has(u.id) && exposedNow && !ctx.ended.has(u.id)) {
      const h = hidePlan(B, u, c, ctx);
      if (h) return h;
      ctx.ended.delete(u.id);
    } else {
      const cover = coverAllyPlan(B, u, c, ctx);
      if (cover) return cover;
    }
    // 3. objetivo da missão à vista (Cérebro)
    const ob = objectivePlan(B, u, c, ctx);
    if (ob) return ob;
    // 4. medikit a quem sangra por perto
    if (!ctx.moved.has(u.id)) {
      const mw = medicWalkPlan(B, u, c, ctx);
      if (mw) { ctx.moved.add(u.id); return mw; }
    }
    // 2.ª passagem: só ataques (as UT que sobram são da vigia)
    if (ctx.pass > 0 || ctx.moved.has(u.id)) return settlePlan(B, u, c, ctx);
    ctx.moved.add(u.id);
    // 5. contacto: ponto de tiro a meio das UT; sem ele, os que estão longe aproximam-se fora da vista; os outros vigiam
    if (c.known.length) {
      if (prof.flares && c.arms.flare && ctx.flares < 3 && B.mission && (B.mission.shade | 0) > tune('DARK_SHADE', 9)) {
        const g = c.known.filter((t) => t.side === 'alien' && OV.LOS.shadeAt(B, tileOf(B, t)) > tune('DARK_SHADE', 9))
          .sort((a, b) => udist(u, a) - udist(u, b) || a.id - b.id)[0];
        const fl = g ? flarePlan(B, u, c, ctx, -1, tileOf(B, g)) : null;
        if (fl) { ctx.moved.delete(u.id); return fl; }
      }
      // a metade da frente vigia com as UT todas (fogo de reação); a de trás procura um ponto de tiro a meio das UT ou
      // aproxima-se do inimigo conhecido mais próximo, em cobertura e fora da vista (num impasse avançam todos)
      const holder = prof.bound && prof.holdFire !== false && T.front && T.front.has(u.id) && !ctx.stalled && !T.releaseFront;
      if (!holder) {
        const fp = botFirePoint(B, u, c, ctx);
        if (fp) return fp;
      }
      if (!holder && c.nearest && udist(u, c.nearest) > 3) {
        const at = standNear(B, tileOf(B, c.nearest));
        const adv = at >= 0 ? advancePlan(B, u, c, ctx, at, prof.advance | 0 || 50) : null;
        if (adv) return adv;
        if (T.front && !T.front.has(u.id)) T.releaseFront = true;
      }
      return settlePlan(B, u, c, ctx);
    }
    // 6. sem contacto: flare de noite e avanço em lanço (no turno 1 só alguns saem da nave; depois, metade da equipa
    // avança e a outra metade vigia com as UT todas, alternando; quem ficou para trás avança sempre)
    if (prof.flares && c.arms.flare && ctx.flares < 3 && B.mission && (B.mission.shade | 0) > tune('DARK_SHADE', 9) && T.goal >= 0) {
      const fl = flarePlan(B, u, c, ctx, T.goal);
      if (fl) { ctx.moved.delete(u.id); return fl; }
    }
    if (T.craft.has(tileOf(B, u)) && T.exitLeft <= 0) return settlePlan(B, u, c, ctx);
    if (bounding(B, ctx) && !T.craft.has(tileOf(B, u)) && T.front && T.front.has(u.id) && !T.releaseFront) {
      const allies = squadOf(B, u).filter((x) => x !== u);
      if (!allies.length || nearestAlly(allies, u.x, u.y, u.z) <= (prof.cohesion | 0 || 6)) return settlePlan(B, u, c, ctx);
    }
    const goal = T.goal >= 0 ? T.goal : exploreGoal(B, u);
    if (prof.siege && B.turn < (prof.siege | 0) && T.goalInside && B.ufo && !T.travel) {
      const r = B.ufo;
      const far = Math.max(Math.max(0, r.x - u.x, u.x - (r.x + r.w - 1)), Math.max(0, r.y - u.y, u.y - (r.y + r.h - 1)));
      if (far <= 16) {
        const sg = siegePlan(B, u, c, ctx);
        return sg || settlePlan(B, u, c, ctx);
      }
    }
    const adv = advancePlan(B, u, c, ctx, goal, T.travel ? prof.travel | 0 || 70 : prof.advance | 0 || 50);
    if (adv) {
      if (T.craft.has(tileOf(B, u))) T.exitLeft--;
      return adv;
    }
    // a retaguarda não tem por onde avançar (a frente tapa a passagem): a frente avança neste turno
    if (T.front && !T.front.has(u.id)) T.releaseFront = true;
    return settlePlan(B, u, c, ctx);
  }

  /* Ordem do bot: primeiro quem vê alienígenas (dispara); depois, com lanços, a retaguarda (do mais atrasado para a
     frente, para passar à frente da vigia); sem lanços, do mais adiantado para trás. */
  function nextBotUnit(B, ctx, done) {
    const T = ctx.team;
    let best = null, bk0 = 0, bk1 = 0;
    for (const u of B.units) {
      if (u.side !== 'xcom' || !active(u) || u.status === 'panic' || done.has(u.id)) continue;
      if (ctx.pass > 0 && (u.tu | 0) < 20) continue;
      const s = B._.sees && B._.sees[u.id];
      let seesEnemy = false;
      if (s) for (const id of s) { const t = BU().findUnit(B, id); if (t && t.side === 'alien' && active(t)) { seesEnemy = true; break; } }
      const gm = T && T.goalMap ? T.goalMap[tileOf(B, u)] : 0;
      const rear = !!(ctx.profile.bound && T && T.front && !T.front.has(u.id));
      const k0 = seesEnemy ? 0 : rear ? 1 : 2;
      const k1 = rear ? -(gm >= 0 ? gm : 32000) : gm >= 0 ? gm : 32000;
      if (!best || k0 < bk0 || (k0 === bk0 && (k1 < bk1 || (k1 === bk1 && u.id < best.id)))) { best = u; bk0 = k0; bk1 = k1; }
    }
    return best;
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
      return botThink(B, u, c, ctx);
    }
    const mode = chooseMode(B, u, c, ctx);
    u.ai.mode = mode;
    let a = null;
    if (mode === 'combat') {
      a = combatPlan(B, u, c, ctx);
      if (!a) {
        u.ai.memory.failed = true;
        // sem ataque possível: patrulha (corpo a corpo: mesmo à vista, para não bloquear passagens)
        if (u.side === 'alien' && (!c.visible.length || c.arms.meleeOnly)) a = patrolPlan(B, u, c, ctx);
      }
    } else if (mode === 'ambush') a = ambushPlan(B, u, c, ctx);
    else if (mode === 'escape') a = escapePlan(B, u, c, ctx);
    else a = patrolPlan(B, u, c, ctx);
    return a;
  }

  /* Decisões de uma unidade até AI_MAX_ACTIONS (as ações em fila não contam); para quando UT ≤ 5 ou uma ação falha
     (um «avistado» que interrompe a marcha volta a decidir). → n.º de ações executadas. */
  function* runUnit(B, u, ctx, maxA) {
    const side = u.side;
    let n = 0, total = 0;
    for (let guard = 0; guard < 24; guard++) {
      if (over(B)) return total;
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
      if (side === 'alien') recordOwnSightings(B);
      if (!res || !res.ok) {
        delete ctx.queue[u.id];
        if (res && res.reason === 'spotted' && active(u)) continue;
        if (u.ai && u.ai.memory && (a.type === 'shoot' || a.type === 'melee' || a.type === 'throw')) u.ai.memory.failed = true;
        break;
      }
      if (u.ai && u.ai.memory && (a.type === 'shoot' || a.type === 'melee')) u.ai.memory.failed = false;
      if (a.type === 'shoot' || a.type === 'throw' || a.type === 'melee') ctx.fired.add(u.id);
    }
    return total;
  }

  /* Turno do playerBot: passagens com a ordem de nextBotUnit (quem vê alienígenas primeiro, depois do mais
     adiantado para trás); a 2.ª passagem só ataca. No fim, fumo sobre soldados feridos que ficaram expostos. */
  function* botTurn(B, ctx) {
    const prof = ctx.profile;
    const maxA = prof.maxActions || tune('AI_MAX_ACTIONS', 3);
    const M = mem(B);
    // impasse: inimigos conhecidos sem um tiro da X-COM no turno anterior ⇒ aproxima-se mais
    ctx.stalled = M.lastShotTurn !== undefined && B.turn - M.lastShotTurn >= 2;
    let total = 0;
    for (let p = 0; p < (prof.passes || 2); p++) {
      ctx.pass = p;
      const done = new Set();
      for (;;) {
        if (over(B)) return { actions: total };
        const u = nextBotUnit(B, ctx, done);
        if (!u) break;
        done.add(u.id);
        if (p > 0) ctx.ended.delete(u.id);
        total += yield* runUnit(B, u, ctx, maxA);
      }
    }
    if (prof.smoke) {
      for (const s of B.units.slice()) {
        if (over(B)) break;
        if (s.side !== 'xcom' || !active(s) || (s.hp | 0) * 2 >= Math.max(1, s.hpMax | 0)) continue;
        const spot = OV.LOS.spotters(B, s, 'alien').map((id) => BU().findUnit(B, id)).filter((t) => t && LIVE[t.status]);
        if (!spot.length) continue;
        for (const h of squadOf(B, s)) {
          if (h.status === 'panic' || ctx.smokeUsed === s.id) continue;
          const hc = unitContext(B, h, ctx);
          const a = smokePlan(B, h, hc, ctx, s, spot[0]);
          if (!a) continue;
          ctx.smokeUsed = s.id;
          ctx.ended.delete(h.id);
          total += yield* runUnit(B, h, ctx, 1);
          break;
        }
      }
    }
    if (ctx.fired.size) M.lastShotTurn = B.turn;
    else if (M.lastShotTurn === undefined) M.lastShotTurn = B.turn;
    return { actions: total };
  }

  /* Turno de um lado (DESIGN §10, §11): cada unidade até AI_MAX_ACTIONS decisões por passagem, AI_PASSES passagens
     (a segunda só para quem tem ≥ 20 UT); para quando UT ≤ 5 ou uma ação falha. O lado X-COM usa o playerBot. */
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
    if (side === 'alien') recordOwnSightings(B);
    if (side === 'xcom') return yield* botTurn(B, ctx);
    const passes = prof.passes || tune('AI_PASSES', 2);
    const maxA = prof.maxActions || tune('AI_MAX_ACTIONS', 3);
    let total = 0;
    for (let p = 0; p < passes; p++) {
      for (const u of B.units.slice()) {
        if (u.side !== side || !active(u) || u.status === 'panic') continue;
        if (p > 0 && (u.tu | 0) < 20) continue;
        total += yield* runUnit(B, u, ctx, maxA);
        if (over(B)) return { actions: total };
      }
    }
    return { actions: total };
  }

  OV.AI = {
    turn, think, profile: PLAYER_BOT, PROFILES, MODES, turnContext, unitContext, modeWeights, chooseMode, grenadeEfficacy,
    fireModes, arms, knownEnemies, attackTU, recordSightings, cheatNow, patrolReserve, explosivePlan,
  };
})(globalThis.OV || (globalThis.OV = {}));
