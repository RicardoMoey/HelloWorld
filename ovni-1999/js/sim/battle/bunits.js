/* Unidades e itens de batalha (DESIGN.md §3.3, §3.7, §6; REA 03 §1.5, §2.2, §13). Registos JSON puros em
   B.units / B.items (referências por id); índices derivados em B._ (unitAt, unitById, itemById).

   Unidade: {id, side 'xcom'|'alien'|'civ', origSide, type, soldierId, name, nameKey, nat, female, portraitSeed,
     rank (índice de patente X-COM | patente alienígena | null), sprite, armourId, x,y,z, onMap, dir, size,
     tu, tuMax, energy, energyMax, hp, hpMax, stun, morale, kneel, float, canFly, move, height, kneelHeight,
     armour:[F,L,R,Rear,U], armourMax, mods{AP..SMOKE}, wounds:[cabeça,tronco,braçoD,braçoE,pernaD,pernaE], burn,
     status 'ok'|'dead'|'out'|'panic', stats{tu,sta,hp,react,fire,thr,str,brav,melee,psiStr,psiSkill,energyRecovery},
     items:{R,L,belt:[],pack:[]} (ids de B.items), exp{fire,react,thr,melee,brav,psi}, ai{mode,node,aggroId,wasHitBy,memory},
     turnsSinceSpotted, motion, kills, int, aggr, value, psi, capturable, zombify, spawnOnDeath, explodeOnDeath, corpse}
   Item: {id, type, ammo:{type,rounds}|null, rounds (munição solta: balas restantes; restantes null), owner (unitId|null),
     at (tile|null), fuse (−1 = não ativada), charges ({heal,stim,pain} no medikit | null), unitId (corpos)} */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const SLOTS = ['R', 'L', 'belt', 'pack'];
  const LIVE = { ok: 1, panic: 1 };

  // ---- ids e índices ----------------------------------------------------------------------------------
  function nextId(B) {
    if (!(B.nextId > 0)) B.nextId = 1;
    return B.nextId++;
  }
  const hasDerived = (B) => !!(B._ && B._.unitAt);

  function findItem(B, id) {
    if (id === null || id === undefined) return null;
    if (B._ && B._.itemById) {
      const it = B._.itemById.get(id);
      if (it && B.items.indexOf(it) >= 0) return it;
    }
    for (const it of B.items) {
      if (it.id === id) {
        if (B._ && B._.itemById) B._.itemById.set(id, it);
        return it;
      }
    }
    return null;
  }
  function findUnit(B, id) {
    if (id === null || id === undefined) return null;
    if (B._ && B._.unitById) {
      const u = B._.unitById.get(id);
      if (u && B.units.indexOf(u) >= 0) return u;
    }
    for (const u of B.units) {
      if (u.id === id) {
        if (B._ && B._.unitById) B._.unitById.set(id, u);
        return u;
      }
    }
    return null;
  }

  // ---- itens ------------------------------------------------------------------------------------------
  // opts: {ammo: tipo de munição a carregar, owner, at, unitId}
  function newItem(B, type, opts) {
    const o = opts || {};
    const def = D().items[type];
    if (!def) throw new Error('BUnits.newItem: item desconhecido ' + type);
    let ammo = null;
    if (o.ammo) {
      const a = D().items[o.ammo];
      if (!a) throw new Error('BUnits.newItem: munição desconhecida ' + o.ammo);
      ammo = { type: o.ammo, rounds: o.rounds !== undefined ? o.rounds : a.rounds };
    }
    const it = {
      id: nextId(B), type, ammo,
      rounds: def.kind === 'ammo' ? (o.rounds !== undefined ? o.rounds : def.rounds) : null,
      owner: o.owner === undefined ? null : o.owner,
      at: o.at === undefined ? null : o.at,
      fuse: -1,
      charges: def.charges ? Object.assign({}, def.charges) : null,
      unitId: o.unitId === undefined ? null : o.unitId,
    };
    B.items.push(it);
    if (B._ && B._.itemById) B._.itemById.set(it.id, it);
    return it;
  }

  function deleteItem(B, id) {
    const it = findItem(B, id);
    if (!it) return false;
    if (it.owner !== null) {
      const u = findUnit(B, it.owner);
      if (u) takeFromUnit(u, id);
    }
    B.items.splice(B.items.indexOf(it), 1);
    if (B._ && B._.itemById) B._.itemById.delete(id);
    return true;
  }

  // retira o id do inventário da unidade → compartimento de onde saiu ou null
  function takeFromUnit(u, id) {
    if (u.items.R === id) { u.items.R = null; return 'R'; }
    if (u.items.L === id) { u.items.L = null; return 'L'; }
    for (const s of ['belt', 'pack']) {
      const k = u.items[s].indexOf(id);
      if (k >= 0) { u.items[s].splice(k, 1); return s; }
    }
    return null;
  }

  function slotOf(u, id) {
    if (u.items.R === id) return 'R';
    if (u.items.L === id) return 'L';
    if (u.items.belt.indexOf(id) >= 0) return 'belt';
    if (u.items.pack.indexOf(id) >= 0) return 'pack';
    return null;
  }

  // R/L → item | null; belt/pack → [item]
  function item(B, u, slot) {
    if (slot === 'R' || slot === 'L') return findItem(B, u.items[slot]);
    return (u.items[slot] || []).map((id) => findItem(B, id)).filter(Boolean);
  }
  const handItems = (B, u) => [item(B, u, 'R'), item(B, u, 'L')].filter(Boolean);
  const allItems = (B, u) => SLOTS.reduce((a, s) => a.concat(s === 'R' || s === 'L' ? [item(B, u, s)].filter(Boolean) : item(B, u, s)), []);

  // põe o item no compartimento (respeita capacidade; force ignora-a — tripulações alienígenas)
  function giveItem(B, u, itemId, slot, force) {
    const it = findItem(B, itemId);
    if (!it || SLOTS.indexOf(slot) < 0) return false;
    const def = D().items[it.type];
    if (slot === 'R' || slot === 'L') {
      if (u.items[slot] !== null) return false;
    } else if (!force) {
      const types = u.items[slot].map((id) => (findItem(B, id) || {}).type).filter(Boolean);
      if (def.fixed || !D().fitsSlot(it.type, slot, types)) return false;
    }
    if (it.owner !== null && it.owner !== u.id) {
      const prev = findUnit(B, it.owner);
      if (prev) takeFromUnit(prev, itemId);
    } else if (it.owner === u.id) takeFromUnit(u, itemId);
    if (slot === 'R' || slot === 'L') u.items[slot] = itemId;
    else u.items[slot].push(itemId);
    it.owner = u.id;
    it.at = null;
    return true;
  }

  // larga o item (compartimento 'R'|'L' ou id do item) no tile (por omissão o da unidade) → item | null
  function dropItem(B, u, slot, tile) {
    const id = typeof slot === 'number' ? slot : u.items[slot];
    if (id === null || id === undefined) return null;
    const it = findItem(B, id);
    if (!it || takeFromUnit(u, id) === null) return null;
    it.owner = null;
    it.at = tile === undefined || tile === null ? unitTile(B, u) : tile;
    return it;
  }

  // ---- medidas ------------------------------------------------------------------------------------------
  // peso transportado: itens + munição carregada (armadura pesa 0, orig)
  function weight(B, u) {
    const items = D().items;
    let w = 0;
    for (const it of allItems(B, u)) {
      const def = items[it.type];
      if (!def || def.fixed) continue;
      w += def.weight | 0;
      if (it.ammo && items[it.ammo.type]) w += items[it.ammo.type].weight | 0;
    }
    return w;
  }

  // UT do turno (REA §1.5): base × min(1, Força/peso), −10 % por ferida em cada perna
  function turnTU(B, u) {
    let tu = u.stats.tu;
    const w = weight(B, u);
    if (w > u.stats.str) tu = U.idiv(tu * Math.max(0, u.stats.str), w);
    const legs = u.wounds[4] + u.wounds[5];
    if (legs > 0) tu -= U.idiv(tu * 10 * legs, 100);
    return Math.max(0, tu);
  }

  // UT de uma ação: % das UT base (stats.tu) salvo flat; prime 50 %, throw 25 %, reload 15 fixas
  function actionTU(B, u, itemId, mode) {
    const type = typeof itemId === 'string' ? itemId : (findItem(B, itemId) || {}).type;
    const base = u.stats.tu;
    if (mode === 'throw') return U.idiv(base * tune('PCT_THROW', 25), 100);
    if (mode === 'prime') return U.idiv(base * tune('PCT_PRIME', 50), 100);
    if (mode === 'reload') return tune('TU_RELOAD', 15);
    if (!type) return null;
    const m = D().weaponModes(type).find((x) => x.mode === mode);
    if (!m) return null;
    return m.flat ? m.tu : U.idiv(base * m.tu, 100);
  }

  const invMoveCost = (from, to) => D().invMoveTU(from, to);

  // só soldados (não unidades grandes, nem a voar)
  const canKneel = (u) => u.type === 'soldier' && u.size === 1 && !u.float && LIVE[u.status] === 1;
  // altura dos olhos acima do chão do tile (voxels)
  const eyeHeight = (u) => (u.kneel ? u.kneelHeight : u.height) - 2;
  const isConscious = (u) => LIVE[u.status] === 1;

  // tiles ocupados: com o mapa (ou B) → índices; sem mapa → [{x,y,z}]
  function unitTiles(u, mOrB) {
    const m = mOrB && mOrB.map ? mOrB.map : mOrB;
    const out = [];
    for (let dy = 0; dy < u.size; dy++) {
      for (let dx = 0; dx < u.size; dx++) {
        if (m) out.push(((u.z * m.h) + u.y + dy) * m.w + u.x + dx);
        else out.push({ x: u.x + dx, y: u.y + dy, z: u.z });
      }
    }
    return out;
  }
  const unitTile = (B, u) => (u.x < 0 ? null : (u.z * B.map.h + u.y) * B.map.w + u.x);

  function removeUnitFromMap(B, u) {
    if (hasDerived(B) && u.onMap && u.x >= 0) {
      const ua = B._.unitAt;
      for (const i of unitTiles(u, B.map)) if (ua[i] === u.id + 1) ua[i] = 0;
    }
    u.onMap = false;
    if (B._ && B._.dirty) B._.dirty.los = true;
  }

  // coloca a unidade com o canto (x,y) no tile i (2×2: i é o tile noroeste)
  function placeUnit(B, u, i) {
    removeUnitFromMap(B, u);
    const [x, y, z] = OV.BMap.xyz(B.map, i);
    u.x = x;
    u.y = y;
    u.z = z;
    u.onMap = true;
    if (hasDerived(B) && isConscious(u)) for (const t of unitTiles(u, B.map)) B._.unitAt[t] = u.id + 1;
    if (B._ && B._.dirty) B._.dirty.los = true;
  }

  /* Segurança da desova (só na preparação, B.phase 'setup', para alienígenas ainda fora do mapa): nenhum
     alienígena a menos de SPAWN_SAFE_DIST (10) tiles de Chebyshev de um início X-COM no mesmo nível ou a ±1;
     unidades de terror (Data.TERROR_UNITS) a menos de SPAWN_TERROR_DIST (14); na base alienígena, também fora do
     módulo do elevador e dos módulos vizinhos. Recuo determinístico: cada limiar desce 1 tile de cada vez (até 6,
     a distância antiga) enquanto não houver tiles alcançáveis suficientes; sem nenhum, não há restrição. */
  const SPAWN_MIN = 6;
  function spawnZones(B) {
    const caches = B._ && B._.caches;
    if (!caches) return null;
    if (caches.spawn && caches.spawn.n === B.map.n) return caches.spawn;
    const m = B.map, BM = OV.BMap;
    const starts = B.xcomStarts || [];
    if (!starts.length || !OV.MapGen || !OV.MapGen.startDistance) return null;
    const dist = OV.MapGen.startDistance(m, starts);
    const reach = OV.MapGen.flood(m, starts);
    // módulos 10×10 do elevador (células com inícios X-COM) e vizinhos — só na base alienígena
    const cw = Math.ceil(m.w / 10);
    let liftCells = null;
    if (B.mission && B.mission.kind === 'alienBase') {
      liftCells = new Set();
      for (const i of starts) {
        const [x, y] = BM.xyz(m, i);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) liftCells.add((((y / 10) | 0) + dy) * cw + ((x / 10) | 0) + dx);
      }
    }
    const inLift = (x, y) => !!liftCells && liftCells.has(((y / 10) | 0) * cw + ((x / 10) | 0));
    // histogramas de distância dos cantos onde cabe uma unidade 1×1 / 2×2 (alcançáveis; com/sem módulos do elevador)
    const hist = { 1: new Int32Array(256), 2: new Int32Array(256), lift1: new Int32Array(256), lift2: new Int32Array(256) };
    const probe = { id: -1, size: 1 };
    for (let i = 0; i < m.n; i++) {
      if (!reach[i]) continue;
      const [x, y] = BM.xyz(m, i);
      for (const sz of [1, 2]) {
        probe.size = sz;
        if (!fitsGeom(B, probe, i, true)) continue;
        const d = unitStartDist(m, dist, i, sz);
        hist[sz][d]++;
        if (!inLift(x, y) && !(sz === 2 && (inLift(x + 1, y) || inLift(x, y + 1) || inLift(x + 1, y + 1)))) hist['lift' + sz][d]++;
      }
    }
    const crew = crewMax(B);
    const need = { 1: 2 * crew + 8, 2: 12 };
    const pick = (h, want, n) => {
      const cum = new Int32Array(257);
      for (let d = 255; d >= 0; d--) cum[d] = cum[d + 1] + h[d];
      for (let L = want; L >= SPAWN_MIN; L--) if (cum[L] >= n) return L;
      return -1;
    };
    const lim = {};
    for (const sz of [1, 2]) {
      const normal = pick(hist[sz], tune('SPAWN_SAFE_DIST', 10), need[sz]);
      let terror = liftCells ? pick(hist['lift' + sz], tune('SPAWN_TERROR_DIST', 14), need[sz]) : -1;
      const lift = terror >= 0;
      if (!lift) terror = pick(hist[sz], tune('SPAWN_TERROR_DIST', 14), need[sz]);
      lim[sz] = { normal: Math.max(0, normal), terror: Math.max(0, terror), lift };
    }
    caches.spawn = { n: m.n, dist, lim, inLift };
    return caches.spawn;
  }
  function crewMax(B) {
    const Data = D();
    const dep = B.mission && Data.deployments[B.mission.deploymentId];
    if (!dep || !Data.deploymentRange) return 20;
    const r = Data.deploymentRange(B.mission.deploymentId, 2);
    return Math.max(4, (r && r.max) | 0);
  }
  // menor distância aos inícios entre os tiles da unidade com o canto em i
  function unitStartDist(m, dist, i, size) {
    if (size <= 1) return dist[i];
    const x = i % m.w, y = ((i / m.w) | 0) % m.h;
    let d = 255;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (x + dx < m.w && y + dy < m.h) d = Math.min(d, dist[i + dy * m.w + dx]);
    return d;
  }
  const isTerror = (u) => (D().TERROR_UNITS || []).indexOf(u.type) >= 0;
  // tile i é uma desova permitida para u? (fora da preparação: sempre)
  function spawnAllowed(B, u, i) {
    if (!B || B.phase !== 'setup' || !u || u.side !== 'alien' || u.onMap) return true;
    const z = spawnZones(B);
    if (!z) return true;
    const sz = (u.size | 0) > 1 ? 2 : 1;
    const terror = isTerror(u);
    const lim = z.lim[sz];
    if (unitStartDist(B.map, z.dist, i, sz) < (terror ? lim.terror : lim.normal)) return false;
    if (terror && lim.lift) {
      const m = B.map;
      const x = i % m.w, y = ((i / m.w) | 0) % m.h;
      for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) if (z.inLift(x + dx, y + dy)) return false;
    }
    return true;
  }

  // a unidade 2×2 (ou 1×1) cabe com o canto em i? (tiles livres, mesmo nível, sem paredes internas; alienígenas
  // na preparação: também spawnAllowed)
  function fits(B, u, i, ignoreUnits) {
    return fitsGeom(B, u, i, ignoreUnits) && spawnAllowed(B, u, i);
  }
  function fitsGeom(B, u, i, ignoreUnits) {
    const m = B.map, BM = OV.BMap;
    if (i < 0 || i >= m.n) return false;
    const [x, y, z] = BM.xyz(m, i);
    for (let dy = 0; dy < u.size; dy++) {
      for (let dx = 0; dx < u.size; dx++) {
        if (!BM.inB(m, x + dx, y + dy, z)) return false;
        const t = BM.idx(m, x + dx, y + dy, z);
        if (!BM.canStand(m, t)) return false;
        if (!ignoreUnits && hasDerived(B) && B._.unitAt[t] && B._.unitAt[t] !== u.id + 1) return false;
        if (dx > 0 && BM.edgeInfo(m, x + dx - 1, y + dy, z, 2).blocked.move) return false;
        if (dy > 0 && BM.edgeInfo(m, x + dx, y + dy - 1, z, 4).blocked.move) return false;
      }
    }
    return true;
  }

  // ---- registo base ------------------------------------------------------------------------------------
  function baseUnit(B, o) {
    return Object.assign({
      id: nextId(B), side: 'xcom', origSide: 'xcom', type: 'soldier', soldierId: null, name: null, nameKey: null,
      nat: null, female: false, portraitSeed: 0, rank: null, sprite: 'soldier', armourId: null,
      x: -1, y: -1, z: -1, onMap: false, dir: 0, size: 1,
      tu: 0, tuMax: 0, energy: 0, energyMax: 0, hp: 0, hpMax: 0, stun: 0, morale: tune('MORALE_START', 100),
      kneel: false, float: false, canFly: false, move: 'walk', height: 22, kneelHeight: 14,
      armour: [0, 0, 0, 0, 0], armourMax: [0, 0, 0, 0, 0], mods: D().damageMods({}),
      wounds: [0, 0, 0, 0, 0, 0], burn: 0, status: 'ok', stats: null,
      items: { R: null, L: null, belt: [], pack: [] },
      exp: { fire: 0, react: 0, thr: 0, melee: 0, brav: 0, psi: 0 },
      ai: { mode: 'patrol', node: -1, aggroId: null, wasHitBy: [], memory: {} },
      turnsSinceSpotted: 255, motion: 0, kills: 0, int: 0, aggr: 1, value: 0, psi: false, capturable: false,
      zombify: null, spawnOnDeath: null, explodeOnDeath: null, corpse: null,
    }, o);
  }

  function statsOf(src, energyRecovery) {
    const s = {};
    for (const k of ['tu', 'sta', 'hp', 'react', 'fire', 'thr', 'str', 'brav', 'melee', 'psiStr', 'psiSkill']) s[k] = src[k] | 0;
    s.energyRecovery = energyRecovery | 0;
    return s;
  }

  // arma na mão: carrega com o primeiro carregador compatível do inventário (que é consumido)
  function autoLoad(B, u) {
    const items = D().items;
    for (const hand of ['R', 'L']) {
      const w = item(B, u, hand);
      if (!w || w.ammo) continue;
      const def = items[w.type];
      if (!def || !def.ammo || !def.ammo.length) continue;
      for (const s of ['belt', 'pack']) {
        const clip = item(B, u, s).find((c) => def.ammo.indexOf(c.type) >= 0);
        if (clip) {
          w.ammo = { type: clip.type, rounds: clip.rounds };
          deleteItem(B, clip.id);
          break;
        }
      }
    }
  }

  // soldado → unidade. s = {soldierId|id, name, nat, female, rank, stats{…}, armour, portraitSeed, missions};
  // loadout = {R, L, belt:[], pack:[]} com tipos de item (por omissão s.loadout); opts.autoLoad (true)
  function fromSoldier(B, s, loadout, opts) {
    const o = opts || {};
    const Data = D();
    const gen = Data.soldierGen;
    const armourId = Data.armours[s.armour] ? s.armour : gen.armour;
    const armour = Data.armours[armourId];
    const st = statsOf(s.stats, U.idiv(s.stats.tu | 0, 3));
    const rankIdx = s.rank | 0;
    const rank = Data.soldierRank(rankIdx);
    const u = baseUnit(B, {
      side: 'xcom', origSide: 'xcom', type: 'soldier', soldierId: s.soldierId || s.id || null, name: s.name || null,
      nat: s.nat || null, female: !!s.female, portraitSeed: s.portraitSeed | 0, rank: rankIdx, sprite: gen.sprite, armourId,
      hp: st.hp, hpMax: st.hp, energy: st.sta, energyMax: st.sta, height: gen.standHeight, kneelHeight: gen.kneelHeight,
      armour: Data.soldierArmour(armourId), armourMax: Data.soldierArmour(armourId), mods: Object.assign({}, armour.mods),
      canFly: !!armour.flight, stats: st, int: 10, aggr: 1, corpse: armour.corpse,
      value: 20 + (s.missions | 0) + (rank ? rank.scoreBonus : 0),
    });
    B.units.push(u);
    if (B._ && B._.unitById) B._.unitById.set(u.id, u);
    const lo = loadout || s.loadout || { R: null, L: null, belt: [], pack: [] };
    for (const slot of SLOTS) {
      const list = slot === 'R' || slot === 'L' ? (lo[slot] ? [lo[slot]] : []) : lo[slot] || [];
      for (const type of list) {
        if (!Data.items[type]) continue;
        const it = newItem(B, type);
        // o ecrã «Equipar» garante as capacidades; um carregamento inválido vai para a mochila
        if (!giveItem(B, u, it.id, slot) && !giveItem(B, u, it.id, 'pack')) giveItem(B, u, it.id, 'pack', true);
      }
    }
    if (o.autoLoad !== false) autoLoad(B, u);
    u.tuMax = turnTU(B, u);
    u.tu = u.tuMax;
    return u;
  }

  // alienígena → unidade (atributos/armadura pela dificuldade de B.mission; equipamento por OV.Data.alienLoadout)
  function fromAlien(B, unitTypeId, tier, rng, deploymentId) {
    const Data = D();
    const def = Data.units[unitTypeId];
    if (!def) throw new Error('BUnits.fromAlien: unidade desconhecida ' + unitTypeId);
    const diff = (B.mission && B.mission.difficulty) | 0;
    const raw = Data.alienStats(unitTypeId, diff);
    const st = statsOf(raw, def.energyRecovery);
    const weapon = def.weapon ? Data.items[def.weapon] : null;
    const u = baseUnit(B, {
      side: def.side, origSide: def.side, type: unitTypeId, nameKey: def.nameKey, rank: def.rank, sprite: def.sprite,
      female: !!def.female, size: def.size | 0 || 1, hp: st.hp, hpMax: st.hp, energy: st.sta, energyMax: st.sta,
      height: def.height, kneelHeight: def.kneel, armour: Data.alienArmour(unitTypeId, diff), armourMax: Data.alienArmour(unitTypeId, diff),
      mods: Object.assign({}, def.armour.mods), canFly: def.move === 'fly', move: def.move, stats: st,
      int: def.int | 0, aggr: def.aggr === undefined ? 1 : def.aggr, value: def.value | 0, psi: !!def.psi,
      capturable: !!def.capturable, zombify: weapon && weapon.zombify ? weapon.zombify : null,
      spawnOnDeath: def.spawnOnDeath || null, explodeOnDeath: def.explodeOnDeath ? Object.assign({}, def.explodeOnDeath) : null,
      corpse: def.corpse,
    });
    B.units.push(u);
    if (B._ && B._.unitById) B._.unitById.set(u.id, u);
    if (weapon) {
      const it = newItem(B, def.weapon);
      giveItem(B, u, it.id, 'R', true);
    } else if (def.side === 'alien' && !def.noInventory) {
      const list = Data.alienLoadout(unitTypeId, deploymentId || (B.mission && B.mission.deploymentId), tier, rng);
      let first = true;
      for (const type of list) {
        const it = newItem(B, type);
        if (first) {
          giveItem(B, u, it.id, 'R', true);
          first = false;
        } else if (!giveItem(B, u, it.id, 'belt')) giveItem(B, u, it.id, 'pack', true);
      }
      autoLoad(B, u);
    }
    u.tuMax = turnTU(B, u);
    u.tu = u.tuMax;
    return u;
  }

  // civil (terror): type 'civilian_m'|'civilian_f' ou null (ao acaso com rng)
  function fromCivilian(B, type, rng) {
    const id = type || (rng && rng.pct(50) ? 'civilian_f' : 'civilian_m');
    return fromAlien(B, id, 0, rng, null);
  }

  OV.BUnits = {
    SLOTS, nextId, newItem, deleteItem, findItem, findUnit, item, handItems, allItems, giveItem, dropItem, slotOf,
    takeFromUnit, weight, turnTU, actionTU, invMoveCost, canKneel, eyeHeight, isConscious, unitTiles, unitTile,
    placeUnit, removeUnitFromMap, fits, spawnAllowed, autoLoad, fromSoldier, fromAlien, fromCivilian,
  };
})(globalThis.OV || (globalThis.OV = {}));
