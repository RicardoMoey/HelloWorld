/* Estado da batalha (DESIGN.md §5.3, §6, §7): criação a partir de uma missão (mapa, equipa X-COM, tripulação
   alienígena por linhas de destacamento, civis, danos de queda), índices derivados, serialização, hash e
   resultado, fluxo de turnos, abortar e debriefing.

   OV.Battle.create(mission) | create(G, mission) → B
     mission = {kind:'crash'|'landed'|'terror'|'alienBase'|'cydonia', ufoType, terrain, shade|night, race, month,
                difficulty, seed, deploymentId, craftType, squad:[soldado], craftItems:{itemId:n},
                garrison?:{crew:[{type, rank, tier, outside}], leftovers:{itemId:n}, crashed} (local revisitado)}
   OV.Battle.quickMission({ufoType, terrain, night, difficulty, month, squadSize, seed, race, kind}) → mission
   OV.Battle.rebuildDerived(B) → B._ (não enumerável: {unitAt:Int32Array(n), unitById, itemById, dirty, light, visTiles, caches})
   OV.Battle.serialize(B) → objeto JSON ; deserialize(obj) → B ; hash(B) → uint32
   OV.Battle.unitAt(B,i) ; unitsOf(B, side, all) ; outcome(B) → null|'win'|'loss'|'abort' ; objectiveDestroyed(B)
   OV.Battle.exitWin(B) → bool: base alienígena com o centro de controlo destruído — abortar (sair) dá a vitória
   OV.Battle.clusteredDeaths(B) → n.º de mortos X-COM do turno alienígena com outro morto do mesmo turno a ≤ 2 casas
   OV.Battle.beginBattle(B) → Generator ; beginPlayerTurn(B) → Generator ; endPlayerTurn(B) → Generator (devolvem {outcome})
   OV.Battle.abort(B) → {survivors, mia, craftLost, result} ; debrief(B, ctx?) → relatório da missão (§3.17)
   OV.Battle.crewRange(mission) → {min, max} efetivo alienígena esperado (guarnição de um local revisitado, senão a tabela)
   OV.Battle.garrisonAfter(B, debrief) → {crew, leftovers, crashed}|null — o que fica no local sem vitória (mission.garrison)
     ctx = {researched?, interrogated?, captureRoom? (lugares livres na contenção), terrorFloor? (pontos de um terror
     ignorado: um terror perdido/abortado custa pelo menos isto em civis + linha TERROR_ABANDONED_KEY)} */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const SCHEMA = 1;
  const SIDES = ['xcom', 'alien', 'civ'];
  const LIVE = { ok: 1, panic: 1 };
  // chave da linha do relatório de um terror abandonado (texto «Ataque terrorista sem resposta»)
  const TERROR_ABANDONED_KEY = 'bs.debrief.terrorAbandoned';

  // ---- missão normalizada ------------------------------------------------------------------------------
  const KIND_TERRAIN = { terror: 'URBAN', alienBase: 'ALIENBASE', cydonia: 'MARS' };
  const KIND_DEP = { terror: 'dep_terror_site', alienBase: 'dep_alien_base', cydonia: 'dep_cydonia' };

  function normalizeMission(mission) {
    const Data = D();
    const m = mission || {};
    const kind = m.kind || (m.ufoType ? 'crash' : 'terror');
    const ufoBased = kind === 'crash' || kind === 'landed';
    const ufoType = m.ufoType && Data.ufos[m.ufoType] ? m.ufoType : ufoBased ? 'small_scout' : null;
    const terrain = KIND_TERRAIN[kind] || (m.terrain && Data.mapScripts[m.terrain] ? m.terrain : 'FARM');
    const deploymentId = m.deploymentId && Data.deployments[m.deploymentId] ? m.deploymentId
      : KIND_DEP[kind] || Data.ufos[ufoType || 'small_scout'].deployment;
    const dep = Data.deployments[deploymentId];
    let shade = m.shade;
    if (shade === undefined || shade === null) {
      if (kind === 'alienBase') shade = tune('SHADE_ALIEN_BASE', 8);
      else if (kind === 'cydonia') shade = tune('SHADE_MARS', 8);
      else shade = m.night ? tune('SHADE_NIGHT', 13) : tune('SHADE_DAY', 0);
    }
    const out = {
      kind, ufoType, terrain, shade: U.clamp(shade | 0, 0, 15), night: (shade | 0) > tune('DARK_SHADE', 9),
      race: dep.race || (m.race && Data.races[m.race] ? m.race : 'sectoid'), month: Math.max(0, m.month | 0),
      difficulty: U.clamp(m.difficulty | 0, 0, 2), seed: (m.seed === undefined ? 1 : m.seed) >>> 0, deploymentId,
      craftType: m.craftType && Data.crafts[m.craftType] && Data.crafts[m.craftType].block ? m.craftType : kind === 'cydonia' ? 'avenger' : 'skyranger',
      crashed: kind === 'crash', siteId: m.siteId === undefined ? null : m.siteId, craftId: m.craftId === undefined ? null : m.craftId,
    };
    const gar = normalizeGarrison(m.garrison);
    if (gar) out.garrison = gar;
    return out;
  }

  // efetivo alienígena esperado de uma missão → {min, max}: a guarnição exata de um local revisitado, senão a tabela
  // do destacamento para a dificuldade e o mês (Data.deploymentRange)
  function crewRange(mission) {
    const M = normalizeMission(mission);
    if (M.garrison) return { min: M.garrison.crew.length, max: M.garrison.crew.length };
    return D().deploymentRange(M.deploymentId, M.difficulty, M.month);
  }

  /* Guarnição de um local já visitado (campanha, contrato §11.10): os alienígenas que ficaram depois de um abandono e o
     material deixado no terreno. {crew:[{type, rank, tier, outside}], leftovers:{tipo:n}, crashed} | null */
  function normalizeGarrison(g) {
    const Data = D();
    if (!g || typeof g !== 'object' || !Array.isArray(g.crew)) return null;
    const crew = [];
    for (const c of g.crew) {
      if (!c || !Data.units[c.type]) continue;
      crew.push({ type: c.type, rank: typeof c.rank === 'string' ? c.rank : 'soldier', tier: U.clamp(c.tier | 0, 0, 2), outside: U.clamp(c.outside | 0, 0, 100) });
    }
    const leftovers = {};
    for (const k of Object.keys(g.leftovers || {}).sort()) if (Data.items[k] && (g.leftovers[k] | 0) > 0) leftovers[k] = g.leftovers[k] | 0;
    return { crew, leftovers, crashed: !!g.crashed };
  }

  // ---- índices derivados ----------------------------------------------------------------------------------
  function rebuildDerived(B) {
    const n = B.map.n;
    const _ = {
      unitAt: new Int32Array(n), unitById: new Map(), itemById: new Map(),
      dirty: { light: true, los: true, path: true }, light: new Uint8Array(n), visTiles: new Uint8Array(n), caches: {},
    };
    Object.defineProperty(B, '_', { value: _, enumerable: false, writable: true, configurable: true });
    for (const u of B.units) {
      _.unitById.set(u.id, u);
      if (u.onMap && LIVE[u.status] && u.x >= 0) for (const i of BU().unitTiles(u, B.map)) _.unitAt[i] = u.id + 1;
    }
    for (const it of B.items) _.itemById.set(it.id, it);
    return _;
  }

  function unitAt(B, i) {
    if (!B._) rebuildDerived(B);
    const v = B._.unitAt[i];
    return v ? BU().findUnit(B, v - 1) : null;
  }
  // unidades conscientes no mapa do lado (all ⇒ todas as do lado, incluindo mortas/inconscientes)
  function unitsOf(B, side, all) {
    return B.units.filter((u) => u.side === side && (all || (LIVE[u.status] && u.onMap)));
  }

  // objetivos (núcleos da base / Cérebro) todos destruídos?
  function objectiveDestroyed(B) {
    const tiles = B.objectiveTiles || [];
    if (!tiles.length) return false;
    for (const i of tiles) {
      for (let p = 0; p < 4; p++) {
        const d = BM().def(B.map, i, p);
        if (d && d.special === 'OBJECTIVE') return false;
      }
    }
    return true;
  }

  /* vitória: nenhum alienígena consciente (atordoados contam como neutralizados) ou o Cérebro de Cidónia destruído;
     derrota: nenhuma unidade X-COM consciente no mapa (tem prioridade); 'abort' quando B.aborted.
     Base alienígena (regra orig, persona r5): o centro de controlo destruído não acaba a batalha — a base cai quando a
     equipa sai (abortar com objectiveDestroyed ⇒ 'win', com as regras de recolha de um abandono). */
  const OBJECTIVE_KINDS = { cydonia: 1, alienBase: 1 };
  const END_ON_OBJECTIVE = { cydonia: 1 };
  const exitWin = (B) => B.mission.kind === 'alienBase' && objectiveDestroyed(B);
  function outcome(B) {
    if (B.aborted) return B.result === 'win' ? 'win' : 'abort';
    if (!B.units.some((u) => u.side === 'xcom' && LIVE[u.status] && u.onMap)) return 'loss';
    if (END_ON_OBJECTIVE[B.mission.kind] === 1 && objectiveDestroyed(B)) return 'win';
    if (!B.units.some((u) => u.side === 'alien' && LIVE[u.status])) return 'win';
    return null;
  }

  // ---- colocação ------------------------------------------------------------------------------------------
  // retângulo de referência da nave (ou dos inícios X-COM) para distâncias
  function craftRect(B, gen) {
    if (gen.craft) return { x0: gen.craft.x, y0: gen.craft.y, x1: gen.craft.x + gen.craft.w - 1, y1: gen.craft.y + gen.craft.h - 1 };
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const i of gen.xcomStarts) {
      const [x, y] = BM().xyz(B.map, i);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }
  const rectDist = (r, x, y) => Math.max(Math.max(0, r.x0 - x, x - r.x1), Math.max(0, r.y0 - y, y - r.y1));

  // canto onde a unidade cabe a partir do tile (2×2: também com o nó num dos outros cantos)
  function fitAt(B, u, x, y, z) {
    const m = B.map;
    const offs = u.size > 1 ? [[0, 0], [-1, 0], [0, -1], [-1, -1]] : [[0, 0]];
    for (const [dx, dy] of offs) {
      if (!BM().inB(m, x + dx, y + dy, z)) continue;
      const i = BM().idx(m, x + dx, y + dy, z);
      if (BU().fits(B, u, i)) return i;
    }
    return -1;
  }

  // tile livre alcançável mais próximo (BFS ortogonal sobre o mapa de alcance)
  function nearestFree(B, u, from, reach) {
    const m = B.map;
    const seen = new Uint8Array(m.n);
    const q = [from];
    seen[from] = 1;
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      if ((!reach || reach[i]) && BU().fits(B, u, i)) return i;
      for (const dir of [0, 2, 4, 6, 8, 9]) {
        const j = BM().neighbour(m, i, dir);
        if (j >= 0 && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    return -1;
  }

  // escolhe entre candidatos {node, i}: maior prioridade, desempate pelo rng
  function pickBest(cands, rng) {
    if (!cands.length) return null;
    let best = -Infinity;
    for (const c of cands) best = Math.max(best, c.node.prio);
    const top = cands.filter((c) => c.node.prio === best);
    return top[rng.int(0, top.length - 1)];
  }

  // 2×2: o tile de desova tem de ligar a uma zona grande do mapa (não um sótão só com escadas 1×1); cache por tile
  function roomy(B, u, i, ctx) {
    if ((u.size | 0) <= 1 || !OV.Path || typeof OV.Path.reachable !== 'function') return true;
    const cache = ctx.roomy || (ctx.roomy = new Map());
    const key = i * 4 + (u.canFly ? 2 : 0) + (u.move === 'slide' ? 1 : 0);
    if (!cache.has(key)) {
      const [x, y, z] = BM().xyz(B.map, i);
      const probe = Object.assign({}, u, { x, y, z, onMap: true, tu: 9999, energy: 9999 });
      const r = OV.Path.reachable(B, probe, 9999, 9999, { units: 'none' });
      cache.set(key, r.list.length >= tune('LARGE_SPAWN_MIN_REACH', 40));
    }
    return cache.get(key);
  }

  /* Nó de desova (DESIGN §7.5 + pendentes do DATA_API): preferência de patente no conjunto (OVNI ou exterior),
     depois outras patentes do mesmo conjunto, depois os nós exteriores (patente 0 primeiro), depois qualquer
     tile alcançável longe da nave. Nunca larga um alienígena. 2×2 só em tiles ligados a uma zona grande (roomy). */
  function spawnAlien(B, u, rank, inside, ctx) {
    const Data = D();
    const rng = B.rng.map;
    const prefs = Data.NODE_RANK_PREFS[rank] || [1];
    const free = (pool, filter) => {
      const out = [];
      for (const node of pool) {
        if (ctx.used.has(node) || (filter && !filter(node))) continue;
        const i = fitAt(B, u, node.x, node.y, node.z);
        if (i >= 0 && BU().spawnAllowed(B, u, i) && roomy(B, u, i, ctx)) out.push({ node, i });
      }
      return out;
    };
    const tryPool = (pool, order) => {
      for (const step of order) {
        const c = pickBest(free(pool, step), rng);
        if (c) return c;
      }
      return null;
    };
    const byRank = (r) => (n) => n.rank === r;
    const far = (n) => rectDist(ctx.rect, n.x, n.y) >= ctx.minDist;
    const prefSteps = prefs.map((r) => (n) => byRank(r)(n) && (n.inside || far(n)));
    let c = null;
    if (inside) c = tryPool(ctx.insideNodes, prefSteps.concat([() => true]));
    if (!c) {
      const outsideSteps = inside
        ? [(n) => n.rank === 0 && far(n)].concat(prefSteps, [far, () => true])
        : prefSteps.concat([(n) => n.rank === 0 && far(n), far, () => true]);
      c = tryPool(ctx.outsideNodes, outsideSteps);
    }
    if (!c && !inside) c = tryPool(ctx.insideNodes, [() => true]);
    let i;
    if (c) {
      ctx.used.add(c.node);
      i = c.i;
      u.ai.node = ctx.nodeIndex.get(c.node);
    } else {
      // último recurso: tile alcançável ao acaso a ≥ minDist da nave
      const cand = [];
      for (let k = 0; k < B.map.n; k++) {
        if (!ctx.reach[k]) continue;
        const [x, y] = BM().xyz(B.map, k);
        if (rectDist(ctx.rect, x, y) >= ctx.minDist && BU().fits(B, u, k) && BU().spawnAllowed(B, u, k) && ((u.size | 0) <= 1 || roomy(B, u, k, ctx))) cand.push(k);
      }
      i = cand.length ? cand[rng.int(0, cand.length - 1)] : nearestFree(B, u, ctx.fallbackFrom, null);
      if (i < 0) throw new Error('Battle: sem espaço para ' + u.type);
    }
    BU().placeUnit(B, u, i);
    return i;
  }

  // morto na queda: corpo e equipamento ficam no chão
  function killAtCrash(B, u) {
    const i = BU().unitTile(B, u);
    BU().removeUnitFromMap(B, u);
    u.status = 'dead';
    u.hp = 0;
    u.crashDead = true;
    for (const it of BU().allItems(B, u)) {
      if (D().items[it.type].fixed) BU().deleteItem(B, it.id);
      else BU().dropItem(B, u, it.id, i);
    }
    if (u.corpse && D().items[u.corpse]) BU().newItem(B, u.corpse, { at: i, unitId: u.id });
    B.stats.crashDead++;
  }

  // direção inicial: 20 %·coef de olhar para a nave se estiver a ≤ 20 tiles (DESIGN §11.7)
  function alienFacing(B, u, rect, rng) {
    let dir = rng.int(0, 7);
    const coef = D().alienGrowth.coef[B.mission.difficulty] | 0;
    const cx = (rect.x0 + rect.x1) >> 1, cy = (rect.y0 + rect.y1) >> 1;
    if (rectDist(rect, u.x, u.y) <= 20 && coef > 0 && rng.pct(20 * coef)) dir = U.dirTo(cx - u.x, cy - u.y);
    u.dir = dir;
  }

  // ---- criação --------------------------------------------------------------------------------------------
  function create(a, b) {
    const Data = D();
    const mission = b && typeof b === 'object' ? b : a;
    const M = normalizeMission(mission);
    const streams = OV.RNG.streams(M.seed);
    const B = {
      schema: SCHEMA, mission: M, map: null, nodes: [], xcomStarts: [], craftTiles: [], objectiveTiles: [], specials: {},
      ufo: null, craft: null, layout: [], breaches: [], gen: null,
      turn: 1, side: 'xcom', phase: 'setup', cheat: false, aborted: false, reserve: 'none', reserveKneel: false,
      rng: { map: streams.map, combat: streams.combat, ai: streams.ai },
      units: [], items: [],
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0, xcomPanics: 0 },
      log: [], pendingExplosions: [], flashes: [], nextId: 1, crew: [],
      // opções da batalha (Granadas instantâneas) e tópicos investigados (equipamento alienígena utilizável)
      settings: Object.assign({ instantGrenades: !!tune('INSTANT_GRENADES_DEFAULT', true) }, mission.settings || {}),
      researched: Array.isArray(mission.researched) ? mission.researched.slice() : null,
    };
    const rng = B.rng.map;
    const gen = OV.MapGen.generate({
      deploymentId: M.deploymentId, terrain: M.terrain, ufoType: Data.deployments[M.deploymentId].kind === 'ufo' ? M.ufoType : null,
      crashed: M.crashed, craftType: M.craftType, shade: M.shade, seed: M.seed,
    }, rng);
    Object.assign(B, {
      map: gen.map, nodes: gen.nodes, xcomStarts: gen.xcomStarts, craftTiles: gen.craftTiles, objectiveTiles: gen.objectiveTiles,
      specials: gen.specials, ufo: gen.ufo, craft: gen.craft, layout: gen.layout, breaches: gen.breaches,
      gen: { attempts: gen.attempts, validated: gen.validated, size: gen.size.slice(), craftRot: gen.craftRot },
    });
    B.pendingExplosions = gen.explosions.map((e) => Object.assign({}, e, { voxel: e.voxel.slice() }));
    rebuildDerived(B);
    const rect = craftRect(B, gen);

    // equipa X-COM: os primeiros ficam mais perto da rampa (zona CRAFT)
    const exits = gen.specials.CRAFT.map((i) => BM().xyz(B.map, i));
    const exitDist = (i) => {
      const [x, y] = BM().xyz(B.map, i);
      let d = 1e9;
      for (const [ex, ey] of exits) d = Math.min(d, Math.abs(ex - x) + Math.abs(ey - y));
      return exits.length ? d : 0;
    };
    const starts = gen.xcomStarts.slice().sort((p, q) => exitDist(p) - exitDist(q) || p - q);
    const faceOut = gen.craft ? (4 + 2 * gen.craftRot) & 7 : null;
    const mcx = B.map.w >> 1, mcy = B.map.h >> 1;
    let si = 0;
    for (const s of mission.squad || []) {
      const u = BU().fromSoldier(B, s, s.loadout);
      let i = -1;
      while (si < starts.length && i < 0) {
        const t = starts[si++];
        if (BU().fits(B, u, t)) i = t;
      }
      if (i < 0) i = nearestFree(B, u, starts[0], gen.reach);
      if (i < 0) throw new Error('Battle: sem espaço para a equipa');
      BU().placeUnit(B, u, i);
      u.dir = faceOut !== null ? faceOut : U.dirTo(mcx - u.x, mcy - u.y);
    }
    // carga da nave não distribuída: no chão do primeiro tile de início
    const cargo = mission.craftItems || {};
    for (const type of Object.keys(cargo).sort()) {
      if (!Data.items[type] || Data.items[type].battle === false) continue;
      for (let k = 0; k < (cargo[type] | 0); k++) BU().newItem(B, type, { at: starts[0] });
    }

    // tripulação alienígena por linhas do destacamento
    const dep = Data.deployments[M.deploymentId];
    const nodeIndex = new Map(gen.nodes.map((n, k) => [n, k]));
    const ctx = {
      used: new Set(), nodeIndex, rect, minDist: tune('SPAWN_SAFE_DIST', 10), reach: gen.reach, fallbackFrom: gen.ufo ? BM().idx(B.map, gen.ufo.x, gen.ufo.y, 0) : 0,
      insideNodes: gen.nodes.filter((n) => n.inside), outsideNodes: gen.nodes.filter((n) => !n.inside),
    };
    const ufoMission = dep.kind === 'ufo' && ctx.insideNodes.length > 0;
    const dead = [];
    // B.crew guarda patente da linha, nível de armamento e % fora do OVNI de cada alienígena (guarnição após abandono)
    const spawnOne = (type, rank, tier, outside) => {
      const u = BU().fromAlien(B, type, tier, rng, M.deploymentId);
      const inside = ufoMission && !rng.pct(outside);
      spawnAlien(B, u, rank, inside, ctx);
      alienFacing(B, u, rect, rng);
      B.crew.push({ id: u.id, type, rank, tier, outside: outside | 0 });
      return u;
    };
    const gar = M.garrison;
    if (gar) {
      // local revisitado: só os sobreviventes da visita anterior (a queda só mata se o OVNI caiu desde então)
      for (const c of gar.crew) {
        const u = spawnOne(c.type, c.rank, c.tier, c.outside);
        if (M.crashed && !gar.crashed && rng.pct(Data.ufoRules.crashCrewDeathPct)) dead.push(u);
      }
    } else {
      for (const row of dep.rows) {
        const q = Data.crewQty(M.deploymentId, row, M.difficulty, M.month);
        const n = rng.int(q[0], q[1]);
        for (let k = 0; k < n; k++) {
          const type = Data.rowUnit(dep, row, M.race, rng.int(0, 1));
          const tier = Data.rollItemTier(M.month, rng);
          const u = spawnOne(type, row.rank, tier, row.outside);
          if (M.crashed && rng.pct(Data.ufoRules.crashCrewDeathPct)) dead.push(u);
        }
      }
    }
    // a queda nunca mata toda a tripulação (a missão não acaba antes de começar)
    const crew = B.units.filter((u) => u.side === 'alien').length;
    for (const u of dead.slice(0, Math.max(0, crew - 1))) killAtCrash(B, u);

    // civis (terror): chão caminhável dos níveis/papéis do script, longe da nave
    const civ = dep.civilians;
    const cs = Data.mapScripts[M.terrain].civilians;
    if (civ && cs) {
      const count = rng.int(civ[0], civ[1]);
      const cand = [];
      for (let i = 0; i < B.map.n; i++) {
        if (!gen.reach[i] || gen.footprint[i]) continue;
        const [x, y, z] = BM().xyz(B.map, i);
        if (cs.levels.indexOf(z) < 0 || rectDist(rect, x, y) < cs.minCraftDist) continue;
        const f = BM().def(B.map, i, 0);
        if (!f || cs.floors.indexOf(f.role) < 0 || !BM().canStand(B.map, i)) continue;
        cand.push(i);
      }
      for (let k = 0; k < count && cand.length; k++) {
        const u = BU().fromCivilian(B, null, rng);
        let placed = -1;
        while (placed < 0 && cand.length) {
          const j = rng.int(0, cand.length - 1);
          const i = cand[j];
          cand[j] = cand[cand.length - 1];
          cand.pop();
          if (BU().fits(B, u, i)) placed = i;
        }
        if (placed < 0) {
          B.units.splice(B.units.indexOf(u), 1);
          B._.unitById.delete(u.id);
          break;
        }
        BU().placeUnit(B, u, placed);
        u.dir = rng.int(0, 7);
        u.ai.mode = 'civilian';
      }
    }
    return B;
  }

  // ---- missão rápida (ecrã de batalha rápida e testes) ----------------------------------------------------
  // raças dos OVNIs por mês na batalha rápida; os locais de terror usam o calendário da campanha (raceSchedule)
  const RACES_BY_MONTH = [['sectoid', 'floater'], ['sectoid', 'floater'], ['sectoid', 'floater', 'snakeman'],
    ['sectoid', 'floater', 'snakeman'], ['sectoid', 'floater', 'snakeman', 'muton'], ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal']];

  /* Equipamento por mês, alinhado com a progressão real da campanha (bot de campanha, Veterano, sementes 1–3: lasers e
     Armadura Pessoal nos dias 22–28, Plasma Pesado a partir do dia ≈ 90, poucos fatos energéticos antes de Cidónia):
     0 espingarda + fato de combate; 1–2 Espingarda Laser + Armadura Pessoal; 3–5 Plasma Pesado + Armadura Pessoal;
     6+ Plasma Pesado + Fato Energético. quickMission junta um kit médico ao soldado com mais Saúde. */
  function quickLoadout(month, night) {
    let lo, armour;
    if (month < 1) {
      lo = { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade'], pack: [] };
      armour = 'coveralls';
    } else if (month < 3) {
      lo = { R: 'laser_rifle', L: null, belt: ['grenade', 'grenade'], pack: [] };
      armour = 'personal_armour';
    } else {
      lo = { R: 'heavy_plasma', L: null, belt: ['heavy_plasma_clip', 'heavy_plasma_clip', 'grenade'], pack: [] };
      armour = month < 6 ? 'personal_armour' : 'power_suit';
    }
    if (night) lo.belt.push('electro_flare');
    return { lo, armour };
  }

  // raça de um local de terror como na campanha: Data.raceSchedule.alien_terror (pesos do último mês ≤ month)
  function terrorRace(month, rng) {
    const Data = D();
    const w = typeof Data.raceWeights === 'function' ? Data.raceWeights('alien_terror', month) : null;
    const race = w && Object.keys(w).length ? rng.weighted(w) : null;
    return race && Data.races[race] ? race : rng.pick(RACES_BY_MONTH[Math.min(month, RACES_BY_MONTH.length - 1)]);
  }

  function quickMission(opts) {
    const Data = D();
    const o = opts || {};
    const seed = (o.seed === undefined ? 1 : o.seed) >>> 0;
    const rng = OV.RNG.create((seed ^ 0x5eed0b5) >>> 0);
    const terrain = o.terrain && Data.mapScripts[o.terrain] ? o.terrain : 'FARM';
    const kind = o.kind || (terrain === 'ALIENBASE' ? 'alienBase' : terrain === 'MARS' ? 'cydonia'
      : o.ufoType ? (o.landed ? 'landed' : 'crash') : terrain === 'URBAN' ? 'terror' : 'crash');
    const month = Math.max(0, o.month | 0);
    const night = !!o.night;
    const race = o.race && Data.races[o.race] ? o.race : kind === 'terror' ? terrorRace(month, rng) : rng.pick(RACES_BY_MONTH[Math.min(month, RACES_BY_MONTH.length - 1)]);
    const craftType = kind === 'cydonia' ? 'avenger' : o.craftType || 'skyranger';
    const seats = Data.crafts[craftType].seatsUI || 10;
    const squadSize = U.clamp(o.squadSize === undefined ? 8 : o.squadSize | 0, 1, seats);
    const gen = Data.soldierGen;
    const { lo, armour } = quickLoadout(month, night);
    const squad = [];
    for (let k = 0; k < squadSize; k++) {
      const nat = Data.pickNationality(rng);
      const female = rng.pct(gen.femalePct);
      const name = Data.soldierName(rng, nat, female, Data.soldierNamesTaken(squad));
      const stats = Data.rollSoldierStats(rng);
      squad.push({
        soldierId: 'q' + (k + 1), name, nat, female, rank: k === 0 ? 2 : k < 3 ? 1 : 0, stats, armour,
        portraitSeed: rng.int(0, 0x7fffffff), missions: 0,
        loadout: { R: lo.R, L: lo.L, belt: lo.belt.slice(), pack: lo.pack.slice() },
      });
    }
    // medikit para o soldado com mais saúde
    let best = 0;
    for (let k = 1; k < squad.length; k++) if (squad[k].stats.hp > squad[best].stats.hp) best = k;
    if (squad.length) squad[best].loadout.pack.push('medikit');
    return {
      kind, ufoType: kind === 'crash' || kind === 'landed' ? (o.ufoType && Data.ufos[o.ufoType] ? o.ufoType : 'small_scout') : o.ufoType || null,
      terrain, night, shade: o.shade, race, month, difficulty: U.clamp(o.difficulty | 0, 0, 2), seed,
      deploymentId: o.deploymentId || null, craftType, squad, craftItems: o.craftItems || {},
    };
  }

  // ---- serialização ---------------------------------------------------------------------------------------
  const TA = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };

  function encode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, b64: U.b64enc(v) };
    if (Array.isArray(v)) return v.map(encode);
    const o = {};
    for (const k of Object.keys(v)) if (k !== '_' && typeof v[k] !== 'function') o[k] = encode(v[k]);
    return o;
  }
  function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    if (v.$ta && typeof v.b64 === 'string' && TA[v.$ta]) return U.b64dec(v.b64, TA[v.$ta]);
    const o = {};
    for (const k of Object.keys(v)) o[k] = decode(v[k]);
    return o;
  }

  function rngStates(B) {
    const o = {};
    for (const k of Object.keys(B.rng).sort()) o[k] = typeof B.rng[k].state === 'function' ? B.rng[k].state() : B.rng[k] >>> 0;
    return o;
  }

  function serialize(B) {
    const out = {};
    for (const k of Object.keys(B)) {
      if (k === '_') continue;
      out[k] = k === 'rng' ? rngStates(B) : encode(B[k]);
    }
    return out;
  }

  function deserialize(obj) {
    const B = {};
    for (const k of Object.keys(obj)) B[k] = k === 'rng' ? OV.RNG.loadStreams(obj.rng) : decode(obj[k]);
    rebuildDerived(B);
    // visibilidade (B._.visible/sees, tiles vistos) refeita já: as regras (alvo visível, avistamentos) dependem dela
    if (OV.LOS && B.map && B.phase !== 'setup') OV.LOS.refreshAll(B);
    return B;
  }

  // ---- hash (FNV-1a 32 bits) -----------------------------------------------------------------------------
  function fnvBytes(h, ta) {
    const b = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 16777619);
    return h;
  }
  function fnvStr(h, s) {
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      h = Math.imul(h ^ (c & 255), 16777619);
      h = Math.imul(h ^ (c >>> 8), 16777619);
    }
    return h;
  }
  function hash(B) {
    let h = 2166136261 | 0;
    const m = B.map;
    for (const k of ['parts', 'fire', 'smoke', 'ufoDoorOpen', 'disc']) h = fnvBytes(h, m[k]);
    h = fnvStr(h, JSON.stringify(B.units));
    h = fnvStr(h, JSON.stringify(B.items));
    h = fnvStr(h, JSON.stringify(rngStates(B)));
    h = fnvStr(h, JSON.stringify([B.turn, B.side, B.pendingExplosions, B.flashes || []]));
    // estado que decide resultados fora do mapa/unidades (pontuação, memória da IA, fogo novo, berserk, opções)
    h = fnvStr(h, JSON.stringify([B.stats, B.aiMem || null, B.freshFire || [], B.pendingBerserk || [], !!B.cheat, B.phase,
      B.result || null, B.reserve || 'none', !!B.reserveKneel, B.settings || null, !!B.aborted]));
    return h >>> 0;
  }

  // ---- fluxo de turnos (DESIGN §10; REA §1.5, §14) -------------------------------------------------------
  const tileOfU = (B, u) => (u && u.x >= 0 ? (u.z * B.map.h + u.y) * B.map.w + u.x : -1);

  // eventos 'spotted' para os alienígenas que o jogador passou a ver (resultado de LOS.refreshAll)
  function spottedEvents(B, res) {
    const out = [];
    for (const id of (res && res.spotted && res.spotted.xcom) || []) {
      const t = BU().findUnit(B, id);
      if (t) out.push({ t: 'spotted', unitId: id, by: null, side: 'xcom', vis: true, pos: tileOfU(B, t) });
    }
    return out;
  }
  function* refreshSight(B) {
    if (!OV.LOS) return;
    for (const e of spottedEvents(B, OV.LOS.refreshAll(B))) yield e;
  }
  // explosões em cadeia pendentes (+ visão) depois de um bloco de eventos
  function* settleAll(B, evs) {
    let changed = evs.length > 0;
    if (OV.Combat && B.pendingExplosions && B.pendingExplosions.length) {
      const pend = OV.Combat.resolvePendingExplosions(B);
      if (pend.length) changed = true;
      for (const e of pend) yield e;
    }
    if (changed) yield* refreshSight(B);
  }
  // fim da batalha: fixa o resultado e anuncia-o uma vez
  function* finish(B) {
    const o = outcome(B);
    if (!o) return null;
    if (B.phase !== 'over') {
      B.phase = 'over';
      B.result = o;
      yield { t: 'battleEnd', result: o, vis: true, pos: -1 };
    }
    return o;
  }

  // equipamento levado pela X-COM (para separar o que volta do que é recuperado no debriefing)
  function countItems(B, keep) {
    const Data = D();
    const out = {};
    const add = (type) => { out[type] = (out[type] || 0) + 1; };
    for (const it of B.items) {
      const def = Data.items[it.type];
      if (!def || def.fixed || def.recover === false || def.battle === false || !keep(it)) continue;
      add(it.type);
      if (it.ammo && it.ammo.rounds > 0) add(it.ammo.type);
    }
    return out;
  }
  function recordBrought(B) {
    if (B.brought) return;
    const craft = new Set(B.craftTiles || []);
    const xcom = new Set(B.units.filter((u) => u.origSide === 'xcom').map((u) => u.id));
    B.brought = countItems(B, (it) => (it.owner !== null ? xcom.has(it.owner) : craft.has(it.at)));
  }

  /* Início do turno de um lado: anúncio, fim do controlo mental, recuperação das unidades (UT, energia, feridas,
     fogo, atordoamento), memória dos alienígenas, inimigos escondidos de novo + FOV, fase de pânico e berserk. */
  function* sideStart(B, side) {
    B.side = side;
    yield { t: 'turnStart', side, turn: B.turn, vis: true, pos: -1 };
    if (OV.Morale) for (const e of OV.Morale.revertControl(B, side)) yield e;
    const evs = [];
    for (const u of B.units.slice()) {
      if (u.side !== side || u.status === 'dead' || u.mia) continue;
      if (OV.Env) for (const e of OV.Env.unitTurnStart(B, u)) { evs.push(e); yield e; }
    }
    for (const u of B.units) {
      if (u.side === side) {
        u.done = false;
        u.spottedThisTurn = [];
      } else if (u.ai && Array.isArray(u.ai.wasHitBy) && u.ai.wasHitBy.length) u.ai.wasHitBy = [];
      // memória alienígena: +1 a cada início de turno X-COM (o LOS repõe 0 em quem está à vista)
      if (side === 'xcom' && u.side !== 'alien' && u.status !== 'dead') u.turnsSinceSpotted = Math.min(255, (u.turnsSinceSpotted | 0) + 1);
    }
    if (OV.Combat && B.pendingExplosions && B.pendingExplosions.length) for (const e of OV.Combat.resolvePendingExplosions(B)) yield e;
    // clarões dos disparos deste lado (Act, MUZZLE_FLASH_LIGHT) apagam-se quando ele volta a jogar
    if (Array.isArray(B.flashes) && B.flashes.length) B.flashes = B.flashes.filter((f) => f.side !== side);
    if (OV.LOS) {
      OV.LOS.resetSide(B, side);
      const res = OV.LOS.refreshAll(B);
      if (side === 'xcom') for (const e of spottedEvents(B, res)) yield e;
    }
    if (OV.Act && OV.Act.noteSpotted) for (const u of B.units) if (u.side === side && LIVE[u.status] && u.onMap) OV.Act.noteSpotted(B, u);
    if (outcome(B)) return;
    if (side !== 'civ' && OV.Morale) {
      // os tiros do berserk passam por OV.Act.perform (que já trata explosões e visão)
      yield* OV.Morale.panicPhase(B, side);
      if (outcome(B)) { B.pendingBerserk = []; return; }
      yield* OV.Morale.runBerserk(B);
      if (outcome(B)) return;
      yield* settleAll(B, []);
    }
  }
  // fim do turno de um lado: portas OVNI fecham, granadas com espoleta 0 rebentam e as outras descontam
  function* sideEnd(B, side) {
    const evs = [];
    if (OV.Env) {
      for (const e of OV.Env.closeUfoDoors(B)) evs.push(e);
      if (side !== 'civ') for (const e of OV.Env.armedGrenadesEndTurn(B)) evs.push(e);
    }
    for (const e of evs) yield e;
    yield* settleAll(B, evs);
  }

  /* Início da batalha: explosões das fontes de energia do OVNI caído, luz e FOV iniciais, turno 1 da X-COM. */
  function* beginBattle(B) {
    if (!B._) rebuildDerived(B);
    if (B.phase !== 'setup') return { outcome: outcome(B) };
    B.phase = 'play';
    B.side = 'xcom';
    if (!B.settings) B.settings = { instantGrenades: !!tune('INSTANT_GRENADES_DEFAULT', true) };
    recordBrought(B);
    // fontes de energia do OVNI caído: como em create(), a missão não acaba antes de começar (o último alienígena
    // consciente sobrevive às explosões da queda)
    if (OV.Combat && B.pendingExplosions && B.pendingExplosions.length) {
      const alive = new Set(B.units.filter((u) => u.origSide === 'alien' && u.status !== 'dead').map((u) => u.id));
      for (const e of OV.Combat.resolvePendingExplosions(B, null, { keepLast: 'alien' })) yield e;
      // mortos pelas fontes de energia antes do turno 1 contam como mortos na queda (nem abates nem pontos da X-COM)
      for (const u of B.units) {
        if (!alive.has(u.id) || u.status !== 'dead' || u.crashDead) continue;
        u.crashDead = true;
        B.stats.crashDead = (B.stats.crashDead | 0) + 1;
        if (B.stats.aliensKilled > 0) B.stats.aliensKilled--;
      }
    }
    let res = null;
    if (OV.LOS) {
      OV.LOS.computeLight(B);
      res = OV.LOS.refreshAll(B);
    }
    yield { t: 'turnStart', side: 'xcom', turn: B.turn, vis: true, pos: -1 };
    for (const e of spottedEvents(B, res)) yield e;
    for (const u of B.units) {
      if (u.side !== 'xcom') continue;
      u.done = false;
      u.spottedThisTurn = [];
      if (OV.Act && OV.Act.noteSpotted && LIVE[u.status] && u.onMap) OV.Act.noteSpotted(B, u);
    }
    const o = yield* finish(B);
    return { outcome: o };
  }

  // turno X-COM (sem o fim do turno alienígena): exposto para retomar depois de carregar
  function* beginPlayerTurn(B) {
    if (!B._) rebuildDerived(B);
    yield* sideStart(B, 'xcom');
    const o = yield* finish(B);
    return { outcome: o };
  }

  /* «Terminar turno» (DESIGN §10): fim do turno X-COM → turno alienígena (pânico, OV.AI.turn) → civis →
     manutenção da ronda (fogo/fumo) → turno X-COM seguinte (recuperação, pânico/berserk, FOV). */
  function* endPlayerTurn(B) {
    if (!B._) rebuildDerived(B);
    if (B.phase === 'setup') yield* beginBattle(B);
    let o = yield* finish(B);
    if (o) return { outcome: o };
    const AI = () => (OV.AI && typeof OV.AI.turn === 'function' ? OV.AI : null);
    yield* sideEnd(B, 'xcom');
    if ((o = yield* finish(B))) return { outcome: o };
    yield* sideStart(B, 'alien');
    if ((o = yield* finish(B))) return { outcome: o };
    if (AI()) yield* AI().turn(B, 'alien');
    if ((o = yield* finish(B))) return { outcome: o };
    yield* sideEnd(B, 'alien');
    if ((o = yield* finish(B))) return { outcome: o };
    if (B.units.some((u) => u.side === 'civ' && LIVE[u.status] && u.onMap)) {
      yield* sideStart(B, 'civ');
      if (AI()) yield* AI().turn(B, 'civ');
      yield* sideEnd(B, 'civ');
      if ((o = yield* finish(B))) return { outcome: o };
    }
    if (OV.Env) {
      const evs = OV.Env.roundUpkeep(B);
      for (const e of evs) yield e;
      yield* settleAll(B, evs);
    }
    if ((o = yield* finish(B))) return { outcome: o };
    B.turn++;
    yield* sideStart(B, 'xcom');
    o = yield* finish(B);
    return { outcome: o };
  }

  /* Abortar (REA §14): sobrevivem as unidades X-COM conscientes nos tiles da nave e os inconscientes cujo corpo lá
     está (no chão ou ao colo de um sobrevivente); as restantes ficam desaparecidas em combate (u.mia).
     → {survivors, mia, craftLost, result: 'win' (base alienígena sem centro de controlo, alguém a bordo) | 'abort'} */
  function abort(B) {
    if (!B._) rebuildDerived(B);
    const craft = new Set(B.craftTiles || []);
    const survivors = [], mia = [];
    const xc = B.units.filter((u) => u.origSide === 'xcom' && u.status !== 'dead' && !u.mia);
    for (const u of xc) {
      if (u.side === 'xcom' && LIVE[u.status] && u.onMap && BU().unitTiles(u, B.map).some((i) => craft.has(i))) survivors.push(u.id);
    }
    for (const u of xc) {
      if (survivors.indexOf(u.id) >= 0) continue;
      let safe = false;
      if (u.status === 'out') {
        const body = B.items.find((it) => it.unitId === u.id);
        if (body) safe = body.owner !== null ? survivors.indexOf(body.owner) >= 0 : craft.has(body.at);
      }
      if (safe) survivors.push(u.id);
      else {
        u.mia = true;
        BU().removeUnitFromMap(B, u);
        mia.push(u.id);
      }
    }
    const conscious = survivors.filter((id) => LIVE[(BU().findUnit(B, id) || {}).status]);
    B.aborted = true;
    B.phase = 'over';
    // base alienígena com o centro de controlo destruído: sair com alguém a bordo é a vitória (a base cai)
    B.result = conscious.length && exitWin(B) ? 'win' : 'abort';
    return { survivors, mia, craftLost: conscious.length === 0, result: B.result };
  }

  // ---- debriefing (DESIGN §3.17; REA §14) -------------------------------------------------------------
  const listHas = (list, x) => !!list && (typeof list.has === 'function' ? list.has(x) : Array.isArray(list) && list.indexOf(x) >= 0);

  // destino de cada unidade de origem X-COM: 'ok' | 'dead' | 'mia'
  function xcomFates(B, result) {
    const craft = new Set(B.craftTiles || []);
    const fates = new Map();
    const xc = B.units.filter((u) => u.origSide === 'xcom');
    const onCraft = (u) => u.side === 'xcom' && LIVE[u.status] && u.onMap && BU().unitTiles(u, B.map).some((i) => craft.has(i));
    for (const u of xc) {
      if (u.status === 'dead') fates.set(u.id, 'dead');
      else if (u.mia || result === 'loss') fates.set(u.id, 'mia');
      else if (result === 'win' || B.aborted) fates.set(u.id, 'ok');
      else fates.set(u.id, onCraft(u) ? 'ok' : null);
    }
    for (const u of xc) {
      if (fates.get(u.id) !== null) continue;
      const body = u.status === 'out' ? B.items.find((it) => it.unitId === u.id) : null;
      const safe = !!body && (body.owner !== null ? fates.get(body.owner) === 'ok' : craft.has(body.at));
      fates.set(u.id, safe ? 'ok' : 'mia');
    }
    return fates;
  }

  /* Baixas X-COM em grupo (persona r5): mortos no turno alienígena (ou de outro lado) com outro morto do mesmo turno a
     ≤ 2 casas (Chebyshev, mesmo nível) — a equipa estava junta e um tiro/explosão apanhou vários → n.º desses mortos */
  function clusteredDeaths(B) {
    const m = B.map;
    const dead = B.units.filter((u) => u.origSide === 'xcom' && u.status === 'dead' && u.deathSide && u.deathSide !== 'xcom'
      && u.deathTile >= 0 && u.deathTile < m.n);
    let n = 0;
    for (const u of dead) {
      const [x, y, z] = BM().xyz(m, u.deathTile);
      const near = dead.some((v) => {
        if (v === u || v.deathTurn !== u.deathTurn) return false;
        const [vx, vy, vz] = BM().xyz(m, v.deathTile);
        return vz === z && Math.max(Math.abs(vx - x), Math.abs(vy - y)) <= 2;
      });
      if (near) n++;
    }
    return n;
  }

  /* Relatório da missão. ctx (opcional) = {researched: [tópico]|Set, interrogated: [tipo]|Set|fn(tipo)}: os pontos de
     artefactos só contam enquanto não investigados; captura vale 2×valor até a patente/raça ser interrogada (+10 depois).
     → {result, score, lines:[{key, n, points, itemId?}], kills, captured:[{unitType, unitId}], recovered:{tipo:n},
        returned:{tipo:n}, equipmentLost:{tipo:n}, lost:[soldierId], dead:[…], mia:[…], wounded:{soldierId:hp},
        exp:{soldierId:{…}}, soldiers:[{soldierId, unitId, status, hpLost, kills, exp}], civilians:{saved, killedByAliens,
        killedByXcom}, craftLost, turns, aliensLeft:[unitId] (sem vitória: alienígenas que ficam no local),
        leftOnField:{tipo:n} (sem vitória: material que fica no terreno), objective (vitória pelo objetivo com alienígenas
        ainda de pé: não contam como abatidos e o que levam não é recuperado), panics (episódios de pânico X-COM),
        clustered (mortos X-COM em grupo no turno alienígena, clusteredDeaths)}
     Vitória numa base alienígena: dep.artefacts × dispositivos intactos; num local revisitado: + mission.garrison.leftovers. */
  function debrief(B, ctx) {
    const Data = D();
    const c = ctx || {};
    const researched = c.researched || B.researched || null;
    const interrogated = (type) => (typeof c.interrogated === 'function' ? !!c.interrogated(type)
      : listHas(c.interrogated, type) || (!!Data.interrogationId && listHas(researched, Data.interrogationId(type))));
    const result = outcome(B) || 'abort';
    const fates = xcomFates(B, result);
    const craft = new Set(B.craftTiles || []);
    const find = (id) => BU().findUnit(B, id);
    // vitória pelo objetivo (centro de controlo / Cérebro): os alienígenas ainda de pé fogem com o que levam
    const holder = (it) => (it.owner !== null && it.owner !== undefined ? find(it.owner) : null);
    // vitória ao sair (base alienígena, abort): só se recolhe o que está na nave ou com quem embarcou
    const recoverable = (it) => {
      if (result === 'win' && !B.aborted) {
        const h = holder(it);
        return !(h && h.origSide === 'alien' && h.side === 'alien' && LIVE[h.status]);
      }
      if (result === 'loss') return false;
      return it.owner !== null ? fates.get(it.owner) === 'ok' : craft.has(it.at);
    };
    const lines = [];
    const line = (key, n, points, extra) => { if (n > 0) lines.push(Object.assign({ key, n, points }, extra || {})); };

    // itens no campo que vão para a base; corpos de alienígenas atordoados = capturas
    const field = {};
    const add = (type, n) => { if (n > 0) field[type] = (field[type] || 0) + n; };
    const captured = [];
    const stunKills = [];
    for (const it of B.items) {
      const def = Data.items[it.type];
      if (!def || def.fixed || def.recover === false || def.battle === false || !recoverable(it)) continue;
      if (it.unitId !== null && it.unitId !== undefined) {
        const bu = find(it.unitId);
        if (bu && bu.status !== 'dead') {
          if (bu.origSide !== 'alien') continue;
          if (bu.capturable) {
            captured.push({ unitType: bu.type, unitId: bu.id });
            continue;
          }
          stunKills.push(bu);
        }
      }
      add(it.type, 1);
      if (it.ammo && it.ammo.rounds > 0) add(it.ammo.type, 1);
    }
    // alienígenas sob Controlo Mental X-COM no fim de uma vitória: recuperados vivos (como os atordoados); ao sair,
    // só os que estão a bordo
    if (result === 'win') {
      for (const u of B.units) {
        if (u.origSide !== 'alien' || u.side === 'alien' || !LIVE[u.status]) continue;
        if (B.aborted && !(u.onMap && BU().unitTiles(u, B.map).some((i) => craft.has(i)))) continue;
        if (u.capturable) captured.push({ unitType: u.type, unitId: u.id });
        else stunKills.push(u);
      }
    }
    // componentes do OVNI tomado (fontes de energia e navegação intactas, ligas, Elerium, artefactos)
    const M = B.mission;
    // local revisitado: o que ficou no terreno numa visita anterior é recolhido com a vitória
    if (result === 'win' && !B.aborted && M.garrison) for (const k of Object.keys(M.garrison.leftovers || {})) add(k, M.garrison.leftovers[k] | 0);
    // peças intactas de um tipo especial: base × intactos / total (round = true arredonda a meio)
    const intact = (special, base, round) => {
      const tiles = (B.specials && B.specials[special]) || [];
      if (!tiles.length) return base;
      let n = 0;
      for (const i of tiles) {
        for (let p = 0; p < 4; p++) {
          const d = BM().def(B.map, i, p);
          if (d && d.special === special) { n++; break; }
        }
      }
      return round ? U.idiv(2 * base * n + tiles.length, 2 * tiles.length) : U.idiv(base * n, tiles.length);
    };
    // artefactos de uma instalação alienígena tomada (dep.artefacts), na proporção dos dispositivos intactos
    const dep = Data.deployments[M.deploymentId];
    if (result === 'win' && !B.aborted && dep && dep.artefacts) {
      for (const k of Object.keys(dep.artefacts)) add(k, intact('DEVICE', dep.artefacts[k] | 0, true));
    }
    if (result === 'win' && M.ufoType && (M.kind === 'crash' || M.kind === 'landed') && Data.ufos[M.ufoType]) {
      const ufo = Data.ufos[M.ufoType];
      const rec = Data.ufoRecovery(M.ufoType, {
        crashed: !!M.crashed, powerSources: intact('POWER_SOURCE', ufo.powerSources | 0), navigation: intact('NAVIGATION', ufo.navigation | 0),
      });
      for (const k of Object.keys(rec)) add(k, rec[k]);
    }
    // o que a X-COM trouxe volta; o resto é recuperado
    const brought = B.brought || countItems(B, (it) => it.owner !== null && (find(it.owner) || {}).origSide === 'xcom');
    const returned = {}, recovered = {}, equipmentLost = {};
    for (const type of Object.keys(field).sort()) {
      const back = Math.min(field[type], brought[type] | 0);
      if (back > 0) returned[type] = back;
      if (field[type] - back > 0) recovered[type] = field[type] - back;
    }
    for (const type of Object.keys(brought).sort()) {
      const lost = (brought[type] | 0) - (returned[type] | 0);
      if (lost > 0) equipmentLost[type] = lost;
    }

    // alienígenas
    // ctx.captureRoom (campanha): só os que cabem na contenção contam como capturados; os outros morrem e contam
    // como abatidos (o OpenXcom só dá «live alien recovered» com contenção). captured mantém todos, pela mesma ordem.
    const room = Number.isFinite(c.captureRoom) ? Math.max(0, c.captureRoom | 0) : captured.length;
    const aliens = B.units.filter((u) => u.origSide === 'alien');
    const killed = aliens.filter((u) => u.status === 'dead' && !u.crashDead).concat(stunKills);
    let capPts = 0, capKept = 0;
    for (const cap of captured) {
      const u = find(cap.unitId);
      if (capKept >= room) { killed.push(u); continue; }
      capKept++;
      capPts += interrogated(cap.unitType) ? tune('SCORE_CAPTURE_KNOWN', 10) : 2 * (u.value | 0);
    }
    line('bs.debrief.aliensKilled', killed.length, killed.reduce((s, u) => s + (u.value | 0), 0));
    line('bs.debrief.aliensCaptured', capKept, capPts);

    // civis
    const civValue = (Data.units.civilian_m && Data.units.civilian_m.value) | 0 || 30;
    const civs = B.units.filter((u) => u.origSide === 'civ');
    const civAlive = civs.filter((u) => u.status !== 'dead');
    const saved = result === 'win' ? civAlive.length : 0;
    const byAliens = (B.stats.civKilledByAliens | 0) + (result === 'win' ? 0 : civAlive.length);
    const byXcom = B.stats.civKilledByXcom | 0;
    line('bs.debrief.civSaved', saved, saved * civValue);
    line('bs.debrief.civKilledByAliens', byAliens, -byAliens * civValue);
    line('bs.debrief.civKilledByXcom', byXcom, -byXcom * (civValue + 2 * U.idiv(civValue, 3)));
    // ours (campanha, ctx.terrorFloor = Missions.expiredPoints): abandonar um terror custa pelo menos o mesmo que
    // ignorá-lo — sem isto, abortar no 1.º turno (só civis × valor) era a jogada dominante
    const floor = Math.max(0, c.terrorFloor | 0);
    if (M.kind === 'terror' && result !== 'win' && floor > byAliens * civValue) line(TERROR_ABANDONED_KEY, 1, -(floor - byAliens * civValue));

    // soldados
    const soldiers = [], lost = [], dead = [], mia = [], wounded = {}, exp = {};
    let deadPts = 0, miaPts = 0;
    for (const u of B.units) {
      if (u.origSide !== 'xcom') continue;
      const fate = fates.get(u.id);
      if (fate === 'dead') deadPts += u.value | 0;
      if (fate === 'mia') miaPts += u.value | 0;
      if (u.type !== 'soldier') continue;
      const sid = u.soldierId !== null && u.soldierId !== undefined ? u.soldierId : u.id;
      const hpLost = fate === 'ok' ? Math.max(0, (u.hpMax | 0) - Math.max(0, u.hp | 0)) : 0;
      soldiers.push({ soldierId: sid, unitId: u.id, status: fate, hpLost, kills: u.kills | 0, exp: Object.assign({}, u.exp) });
      if (fate === 'dead') { lost.push(sid); dead.push(sid); }
      else if (fate === 'mia') { lost.push(sid); mia.push(sid); }
      else {
        if (hpLost > 0) wounded[sid] = hpLost;
        exp[sid] = Object.assign({}, u.exp);
      }
    }
    line('bs.debrief.xcomKilled', dead.length, -deadPts);
    line('bs.debrief.xcomMia', mia.length, -miaPts);
    const survivorsUp = B.units.some((u) => u.origSide === 'xcom' && fates.get(u.id) === 'ok' && LIVE[u.status]);
    const craftLost = result === 'loss' || !survivorsUp;
    const craftDef = Data.crafts[M.craftType];
    if (craftLost) line('bs.debrief.craftLost', 1, -((craftDef && craftDef.score) | 0));
    if (result === 'win' && M.kind === 'alienBase') line('bs.debrief.alienBaseDestroyed', 1, (Data.scoring && Data.scoring.alienBaseDestroyed) || 500);

    // artefactos ainda não investigados dão pontos
    for (const type of Object.keys(recovered).sort()) {
      const def = Data.items[type];
      const rp = def.recoveryPoints | 0;
      const topic = def.topic || def.research;
      if (!rp || (topic && listHas(researched, topic))) continue;
      const pts = U.idiv(recovered[type], def.recoveryPer || 1) * rp;
      if (pts > 0) line(def.nameKey, recovered[type], pts, { itemId: type });
    }
    // sem vitória: alienígenas que continuam no local (nem mortos, nem capturados, nem levados atordoados) e material
    // que ficou no terreno (não recuperado e não transportado por eles)
    const aliensLeft = [], leftOnField = {};
    if (result !== 'win') {
      const gone = new Set(captured.map((cp) => cp.unitId).concat(stunKills.map((u) => u.id)));
      for (const u of aliens) if (u.status !== 'dead' && !gone.has(u.id)) aliensLeft.push(u.id);
      const stay = new Set(aliensLeft);
      for (const it of B.items) {
        const def = Data.items[it.type];
        if (!def || def.fixed || def.recover === false || def.battle === false || recoverable(it)) continue;
        if ((it.owner !== null && it.owner !== undefined && stay.has(it.owner)) || (it.unitId !== null && it.unitId !== undefined && stay.has(it.unitId))) continue;
        leftOnField[it.type] = (leftOnField[it.type] | 0) + 1;
        if (it.ammo && it.ammo.rounds > 0 && Data.items[it.ammo.type]) leftOnField[it.ammo.type] = (leftOnField[it.ammo.type] | 0) + 1;
      }
    }
    const score = lines.reduce((s, l) => s + l.points, 0);
    // objective: vitória com o objetivo destruído e alienígenas ainda de pé ; panics: episódios de pânico/berserk X-COM
    const objective = result === 'win' && OBJECTIVE_KINDS[M.kind] === 1 && objectiveDestroyed(B)
      && B.units.some((u) => u.origSide === 'alien' && u.side === 'alien' && LIVE[u.status]);
    return {
      result, score, lines, kills: killed.length, captured, recovered, returned, equipmentLost, lost, dead, mia, wounded, exp, soldiers,
      civilians: { saved, killedByAliens: byAliens, killedByXcom: byXcom }, craftLost, turns: B.turn, aliensLeft, leftOnField,
      objective, panics: (B.stats && B.stats.xcomPanics) | 0, clustered: clusteredDeaths(B),
    };
  }

  /* Guarnição que fica num local depois de uma batalha sem vitória (campanha, contrato §11.10): os sobreviventes com a
     patente, o nível de armamento e a % fora do OVNI com que foram gerados, mais o material deixado no terreno (soma
     com o de visitas anteriores). deb = debrief(B). → {crew, leftovers, crashed} | null (vitória). crew vazia = só
     falta recolher o material (a próxima batalha acaba logo em vitória) */
  function garrisonAfter(B, deb) {
    const Data = D();
    if (!deb || deb.result === 'win') return null;
    const M = B.mission;
    const byId = new Map((B.crew || []).map((c) => [c.id, c]));
    const crew = [];
    for (const id of deb.aliensLeft || []) {
      const u = BU().findUnit(B, id);
      if (!u || !Data.units[u.type]) continue;
      const c = byId.get(id);
      crew.push(c ? { type: c.type, rank: c.rank, tier: c.tier | 0, outside: c.outside | 0 }
        : { type: u.type, rank: Data.units[u.type].rank || 'terrorist', tier: 0, outside: 0 });
    }
    const leftovers = Object.assign({}, (M.garrison && M.garrison.leftovers) || {});
    for (const k of Object.keys(deb.leftOnField || {})) leftovers[k] = (leftovers[k] | 0) + deb.leftOnField[k];
    const sorted = {};
    for (const k of Object.keys(leftovers).sort()) sorted[k] = leftovers[k];
    return { crew, leftovers: sorted, crashed: !!M.crashed };
  }

  OV.Battle = Object.assign(OV.Battle || {}, {
    SCHEMA, SIDES, create, normalizeMission, crewRange, quickMission, quickLoadout, rebuildDerived, serialize, deserialize, hash,
    unitAt, unitsOf, outcome, objectiveDestroyed, exitWin, clusteredDeaths, spawnAlien, nearestFree,
    beginBattle, beginPlayerTurn, endPlayerTurn, abort, debrief, garrisonAfter, recordBrought, TERROR_ABANDONED_KEY,
  });
})(globalThis.OV || (globalThis.OV = {}));
