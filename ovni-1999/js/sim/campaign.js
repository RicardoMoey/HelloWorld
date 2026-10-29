/* Campanha (DESIGN.md §6, §3.17; contrato vinculativo em docs/CAMPAIGN_API.md).
   Secção A (arquiteto): estado inicial G e ajudas partilhadas por todos os módulos da estratégia.
   Secção B (engenheiro de campanha): fluxo de missões e restantes funções — ver o marcador no fim do ficheiro.

   OV.Campaign (secção A) = {
     SCHEMA, STREAMS, EVENTS, ID_PREFIX,
     newCampaign({difficulty, seed, baseLonLat:{lon,lat}, baseName}) → G
     rng(G, stream) → RNG ligado a G.rng[stream] (cada número tirado atualiza G.rng; nunca guardar noutro sítio)
     nextId(G, prefix) → 'b1', 's7', … ; craftNumber(G, type) → n (Skyranger-1, Intercetor-2, …)
     rebuildDerived(G) → G._ (não enumerável) ; hash(G) → uint32 (FNV-1a do JSON, sem events/ui/_)
     event(G, type, data?) → evento empurrado para G.events (stop pelo catálogo EVENTS, data.stop sobrepõe)
     endGame(G, 'won'|'lost', reason) ; newScoreMonth() ; emptyLoadout()
     findBase/findCraft/findSoldier/findUfo/findAlienMission/findSite/findAlienBase/findDogfight(G, id) → objeto|null
     baseOf(G, craftOuSoldado) ; targetOf(G, ref) → {kind, id, obj, lon, lat}|null ; removeById(array, id) → objeto|null
     makeSoldier(G, {baseId, rng?}) → soldado novo (não inserido) ; addSoldier(G, soldier) ; addCraft(G, baseId, type, opts?) → nave
     defaultLoadouts(G, craftId) → aplica modelos de equipamento iniciais aos soldados da nave }
   Regra R1: sem DOM, sem Math.random; aleatoriedade só por rng(G, stream). */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const SCHEMA = 1;

  // streams de G.rng e quem as usa (contrato §1.4)
  const STREAMS = ['geo', 'map', 'combat', 'ai'];
  const ID_PREFIX = {
    base: 'b', soldier: 's', craft: 'c', ufo: 'u', alienMission: 'm', site: 't', alienBase: 'a', dogfight: 'd',
    production: 'p', delivery: 'dl', transfer: 'tr',
  };

  // catálogo de eventos: stop = o ciclo do Geoscape para e a velocidade volta a 5 s (contrato §3)
  const EVENTS = {
    ufoDetected: { stop: true }, ufoLost: { stop: true }, ufoLanded: { stop: true }, ufoLiftOff: { stop: false },
    ufoCrashed: { stop: true }, ufoDestroyed: { stop: true }, ufoEscaped: { stop: true }, ufoGone: { stop: false },
    craftArrived: { stop: true }, craftLowFuel: { stop: true }, craftReturned: { stop: false }, craftLost: { stop: true },
    craftReady: { stop: false }, craftRearmShort: { stop: false }, targetLost: { stop: true }, interceptOrderInvalid: { stop: false },
    dogfightStart: { stop: true }, dogfightEnd: { stop: false },
    researchDone: { stop: true }, productionDone: { stop: true }, productionStalled: { stop: true }, facilityDone: { stop: true },
    deliveryArrived: { stop: true }, transferArrived: { stop: false }, soldierRecovered: { stop: false },
    terrorSite: { stop: true }, terrorSiteExpired: { stop: true }, crashSiteExpired: { stop: false }, landedUfoGone: { stop: false },
    alienBaseFound: { stop: true }, alienBaseBuilt: { stop: false }, baseAttack: { stop: true }, baseDefence: { stop: true },
    retaliation: { stop: false }, pactSigned: { stop: false },
    monthEnd: { stop: true }, gameOver: { stop: true }, victory: { stop: true }, autosaveDue: { stop: false },
  };

  // ---- RNG ligado ao estado ---------------------------------------------------------------------------------
  function derived(G) {
    if (!G._ || typeof G._ !== 'object') {
      Object.defineProperty(G, '_', { value: { rng: {} }, enumerable: false, configurable: true, writable: true });
    }
    if (!G._.rng) G._.rng = {};
    return G._;
  }
  function rebuildDerived(G) {
    if (G._) delete G._;
    derived(G);
    if (!Array.isArray(G.events)) G.events = [];
    return G._;
  }
  function rng(G, name) {
    const cache = derived(G).rng;
    if (cache[name]) return cache[name];
    if (!G.rng || typeof G.rng[name] !== 'number') throw new Error('Campaign.rng: stream desconhecida ' + name);
    const r = OV.RNG.create(0);
    Object.defineProperty(r, 's', {
      get: () => G.rng[name] >>> 0,
      set: (v) => { G.rng[name] = v >>> 0; },
      enumerable: true, configurable: true,
    });
    cache[name] = r;
    return r;
  }

  // ---- ids ---------------------------------------------------------------------------------------------------
  function nextId(G, prefix) {
    const seq = G.ids.seq;
    seq[prefix] = (seq[prefix] | 0) + 1;
    return prefix + seq[prefix];
  }
  function craftNumber(G, type) {
    const c = G.ids.craftNum;
    c[type] = (c[type] | 0) + 1;
    return c[type];
  }

  // ---- procura ----------------------------------------------------------------------------------------------
  const inList = (list, id) => {
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  const findBase = (G, id) => inList(G.bases, id);
  const findCraft = (G, id) => (G.crafts && Object.prototype.hasOwnProperty.call(G.crafts, id) ? G.crafts[id] : null);
  const findSoldier = (G, id) => (G.soldiers && Object.prototype.hasOwnProperty.call(G.soldiers, id) ? G.soldiers[id] : null);
  const findUfo = (G, id) => inList(G.ufos, id);
  const findAlienMission = (G, id) => inList(G.alienMissions, id);
  const findSite = (G, id) => inList(G.sites, id);
  const findAlienBase = (G, id) => inList(G.alienBases, id);
  const findDogfight = (G, id) => inList(G.dogfights, id);
  const baseOf = (G, x) => (x && x.baseId ? findBase(G, x.baseId) : null);
  function removeById(list, id) {
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === id || (list[i] && list[i].id === id)) return list.splice(i, 1)[0];
    }
    return null;
  }

  // alvo/local → {kind, id, obj, lon, lat}; ref = {kind:'ufo'|'site'|'alienBase'|'base'|'craft', id} | {kind:'point', lon, lat}
  // | {kind:'cydonia'} | 'home' (precisa de ref.craftId: base da nave)
  function targetOf(G, ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return null;
    const k = ref.kind;
    let obj = null;
    if (k === 'point') return Number.isFinite(ref.lon) && Number.isFinite(ref.lat) ? { kind: k, id: null, obj: null, lon: ref.lon, lat: ref.lat } : null;
    if (k === 'cydonia') return { kind: k, id: null, obj: null, lon: null, lat: null };
    if (k === 'ufo') obj = findUfo(G, ref.id);
    else if (k === 'site') obj = findSite(G, ref.id);
    else if (k === 'alienBase') obj = findAlienBase(G, ref.id);
    else if (k === 'base') obj = findBase(G, ref.id);
    else if (k === 'craft') obj = findCraft(G, ref.id);
    if (!obj) return null;
    return { kind: k, id: obj.id, obj, lon: obj.lon, lat: obj.lat };
  }

  // ---- eventos e fim de jogo ------------------------------------------------------------------------------------
  function event(G, type, data) {
    if (!Array.isArray(G.events)) G.events = [];
    const def = EVENTS[type];
    const ev = Object.assign({ t: type, at: G.t, stop: def ? def.stop : false }, data || {});
    if (data && data.stop !== undefined) ev.stop = !!data.stop;
    G.events.push(ev);
    return ev;
  }
  function endGame(G, outcome, reason) {
    if (G.flags.won || G.flags.lost) return null;
    if (outcome === 'won') {
      G.flags.won = true;
      return event(G, 'victory', {});
    }
    G.flags.lost = true;
    G.flags.lostReason = reason || 'council';
    return event(G, 'gameOver', { reason: G.flags.lostReason });
  }

  const newScoreMonth = () => ({
    xcom: { total: 0, regions: {}, countries: {} },
    alien: { total: 0, regions: {}, countries: {} },
    research: 0,
  });
  const emptyLoadout = () => ({ R: null, L: null, belt: [], pack: [] });

  // ---- hash (FNV-1a 32 bits sobre o JSON canónico) -----------------------------------------------------------
  const HASH_SKIP = { events: 1, ui: 1, _: 1 };
  function hash(G) {
    const s = JSON.stringify(G, function (k, v) { return this === G && HASH_SKIP[k] ? undefined : v; });
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ---- soldados ---------------------------------------------------------------------------------------------
  /* Recruta novo (contrato §1.7). Ordem de consumo fixa da stream (geo por omissão): nacionalidade (1), sexo (1),
     nome (2), atributos (11, pela ordem de soldierGen.statKeys), semente do retrato (1). */
  function makeSoldier(G, opts) {
    const o = opts || {};
    const Data = D();
    const r = o.rng || rng(G, 'geo');
    const gen = Data.soldierGen;
    const nat = Data.pickNationality(r);
    const female = r.pct(gen.femalePct);
    const name = Data.soldierName(r, nat, female);
    const stats = Data.rollSoldierStats(r);
    const portraitSeed = r.int(0, 0x7fffffff);
    return {
      id: nextId(G, ID_PREFIX.soldier), name, nat, female, rank: 0, stats, initial: U.clone(stats),
      missions: 0, kills: 0, woundDays: 0, armour: gen.armour, baseId: o.baseId === undefined ? null : o.baseId, craftId: null,
      loadout: emptyLoadout(), portraitSeed, hiredT: G.t | 0, psi: { training: false },
    };
  }
  function addSoldier(G, s) {
    G.soldiers[s.id] = s;
    const b = findBase(G, s.baseId);
    if (b && b.soldiers.indexOf(s.id) < 0) b.soldiers.push(s.id);
    return s;
  }

  // ---- naves ------------------------------------------------------------------------------------------------
  // nave nova na base (pronta, depósito cheio, armas por montar salvo opts.weapons); a base tem de a listar
  function addCraft(G, baseId, type, opts) {
    const o = opts || {};
    const def = D().crafts[type];
    const b = findBase(G, baseId);
    if (!def || !b) throw new Error('Campaign.addCraft: ' + type + ' / ' + baseId);
    const weapons = [];
    for (let k = 0; k < (def.weapons | 0); k++) {
      const w = o.weapons && o.weapons[k];
      weapons.push(w && D().craftWeapons[w.type] ? { type: w.type, ammo: w.ammo === undefined ? D().craftWeapons[w.type].ammoMax : w.ammo } : null);
    }
    const c = {
      id: nextId(G, ID_PREFIX.craft), type, num: craftNumber(G, type), name: null, baseId, status: 'ready',
      lon: b.lon, lat: b.lat, dest: null, patrol: false, speed: 0, fuel: def.fuel, hp: def.hp, weapons, soldiers: [],
      equipment: U.clone(o.equipment || {}), dogfightId: null, lowFuel: false, missionT: null,
    };
    G.crafts[c.id] = c;
    b.crafts.push(c.id);
    return c;
  }

  /* Modelos de equipamento iniciais (ours, para a 1.ª missão ensinar tudo): o mais forte leva o Canhão Pesado, o de
     pior Pontaria a pistola, os restantes espingarda com 2 carregadores e granada; o atirador mais forte leva o
     kit médico; os primeiros atiradores levam um very-light. Tudo sai de craft.equipment (que fica ⊇ Σ modelos). */
  function defaultLoadouts(G, craftId) {
    const Data = D();
    const craft = findCraft(G, craftId);
    if (!craft) return;
    const pool = U.clone(craft.equipment);
    const team = craft.soldiers.map((id) => findSoldier(G, id)).filter(Boolean);
    if (!team.length) return;
    const take = (lo, item, slot) => {
      if (!item || !((pool[item] | 0) > 0)) return false;
      if (slot === 'R' || slot === 'L') {
        if (lo[slot] || !Data.fitsSlot(item, slot, [])) return false;
        lo[slot] = item;
      } else {
        if (!Data.fitsSlot(item, slot, lo[slot])) return false;
        lo[slot].push(item);
      }
      pool[item]--;
      return true;
    };
    const idxBy = (cands, key, sign) => cands.reduce((best, i) => ((team[i].stats[key] - team[best].stats[key]) * sign > 0 ? i : best), cands[0]);
    const all = team.map((_, i) => i);
    const heavy = (pool.heavy_cannon | 0) > 0 && team.length > 2 ? idxBy(all, 'str', 1) : -1;
    const rest1 = all.filter((i) => i !== heavy);
    const pistol = (pool.pistol | 0) > 0 && rest1.length > 1 && (pool.rifle | 0) < rest1.length ? idxBy(rest1, 'fire', -1) : -1;
    const riflemen = rest1.filter((i) => i !== pistol);
    const medic = riflemen.length ? idxBy(riflemen, 'str', 1) : -1;
    let flares = 0;
    for (let i = 0; i < team.length; i++) {
      const lo = emptyLoadout();
      if (i === heavy) {
        take(lo, 'heavy_cannon', 'R');
        take(lo, 'hc_ap', 'belt');
        take(lo, 'hc_he', 'belt');
      } else if (i === pistol) {
        take(lo, 'pistol', 'R');
        take(lo, 'pistol_clip', 'belt');
        take(lo, 'pistol_clip', 'belt');
        take(lo, 'grenade', 'belt');
      } else {
        if (!take(lo, 'rifle', 'R')) take(lo, 'pistol', 'R');
        const clip = lo.R === 'pistol' ? 'pistol_clip' : 'rifle_clip';
        take(lo, clip, 'belt');
        take(lo, clip, 'belt');
        take(lo, 'grenade', 'belt');
        if (flares < 4 && take(lo, 'electro_flare', 'belt')) flares++;
        if (i === medic) take(lo, 'medikit', 'pack');
      }
      team[i].loadout = lo;
    }
  }

  // ---- financiamento inicial -----------------------------------------------------------------------------------
  // RNG(base, 2·base) k$ por país, normalizado para FUNDING_TOTAL exato (maiores restos recebem os k$ que faltam)
  function initialFunding(G, r) {
    const Data = D();
    const ids = Object.keys(Data.countries);
    const targetK = Math.round(tune('FUNDING_TOTAL', 6000000) / 1000);
    const raw = ids.map((id) => r.int(Data.countries[id].fundingBase, 2 * Data.countries[id].fundingBase));
    const total = raw.reduce((s, v) => s + v, 0);
    const k = raw.map((v) => Math.floor((v * targetK) / total));
    let left = targetK - k.reduce((s, v) => s + v, 0);
    const order = raw.map((v, i) => i).sort((a, b) => ((raw[b] * targetK) % total) - ((raw[a] * targetK) % total) || a - b);
    for (let j = 0; left > 0; j = (j + 1) % order.length, left--) k[order[j]]++;
    return ids.map((id, i) => ({
      id, funding: Math.min(k[i], Data.countries[id].fundingCap) * 1000, history: [], pact: false, mood: 'same', lastDelta: 0,
    }));
  }

  // ---- novo jogo -----------------------------------------------------------------------------------------------
  const DEFAULT_BASE = { lon: -9.14, lat: 38.72 }; // Lisboa

  function newCampaign(opts) {
    const o = opts || {};
    const Data = D();
    const difficulty = U.clamp(o.difficulty | 0, 0, 2);
    const seed = (o.seed === undefined || o.seed === null ? 1 : o.seed) >>> 0;
    const ll = o.baseLonLat && Number.isFinite(o.baseLonLat.lon) && Number.isFinite(o.baseLonLat.lat) ? o.baseLonLat : DEFAULT_BASE;
    const lon = OV.GMath.wrapLon(ll.lon), lat = OV.GMath.clampLat(ll.lat);
    if (!OV.GMath.isLand(lon, lat)) throw new Error('Campaign.newCampaign: base fora de terra (' + lon + ', ' + lat + ')');

    const G = {
      game: 'ovni-1999', schema: SCHEMA, seed, difficulty,
      t: 0, month: 0, plannedMonth: -1,
      rng: OV.RNG.saveStreams(OV.RNG.streams(seed)),
      ids: { seq: {}, craftNum: {} },
      funds: 0, history: [], reports: [], council: { badMonths: 0, debtMonths: 0, lastRating: 0 },
      score: { month: newScoreMonth(), all: { xcom: 0, alien: 0, research: 0 } },
      countries: [],
      bases: [], soldiers: {}, dead: [], crafts: {},
      ufos: [], alienMissions: [], sites: [], alienBases: [], dogfights: [],
      alien: { tables: {}, cities: [], retaliations: [] },
      researched: [], ufopaedia: [], seen: { ufoTypes: [], races: [] },
      flags: {},
      stats: {
        ufosDetected: 0, ufosShotDown: 0, ufosDestroyed: 0, missionsWon: 0, missionsLost: 0, missionsAborted: 0,
        aliensKilled: 0, aliensCaptured: 0, soldiersLost: 0, civiliansSaved: 0, terrorIgnored: 0, craftsLost: 0,
      },
      activeMission: null,
      ui: {},
      debug: null,
      events: [],
    };
    for (const f of Data.researchFlags) G.flags[f] = false;
    Object.assign(G.flags, { won: false, lost: false, lostReason: null });
    rebuildDerived(G);

    // 1) países (stream geo: 16 números)
    const geo = rng(G, 'geo');
    G.countries = initialFunding(G, geo);
    G.funds = G.countries.reduce((s, c) => s + c.funding, 0);

    // 2) base inicial
    const sb = Data.startingBase;
    const grid = sb.facilities.map((f) => ({ type: f.type, x: f.x, y: f.y, daysLeft: 0 }));
    const conn = Data.gridConnected(grid);
    if (!conn.ok) throw new Error('Campaign.newCampaign: base inicial inválida (' + conn.reason + ')');
    const base = {
      id: nextId(G, ID_PREFIX.base), name: typeof o.baseName === 'string' && o.baseName.trim() ? o.baseName.trim().slice(0, 32) : null,
      lon, lat, region: OV.GMath.regionAt(lon, lat), country: OV.GMath.countryAt(lon, lat),
      grid, scientists: sb.scientists | 0, engineers: sb.engineers | 0,
      soldiers: [], crafts: [], stores: U.clone(sb.stores), aliens: {},
      research: [], production: [], deliveries: [], transfers: [], spotted: false,
    };
    G.bases.push(base);

    // 3) naves (Skyranger com a carga orig + 1 kit médico e 4 very-lights do armazém; Intercetores armados)
    const crafts = sb.crafts.map((spec) => addCraft(G, base.id, spec.type, { weapons: spec.weapons, equipment: spec.cargo }));
    const transport = crafts.find((c) => Data.crafts[c.type].transport) || null;
    if (transport) {
      for (const [item, n] of [['medikit', 1], ['electro_flare', 4]]) {
        const k = Math.min(n, base.stores[item] | 0);
        if (k <= 0) continue;
        base.stores[item] -= k;
        if (!base.stores[item]) delete base.stores[item];
        transport.equipment[item] = (transport.equipment[item] | 0) + k;
      }
    }

    // 4) soldados (stream geo: 16 números cada) — OV.Soldiers.generate quando existe (mesmo contrato e ordem)
    const gen = OV.Soldiers && typeof OV.Soldiers.generate === 'function' ? OV.Soldiers.generate : makeSoldier;
    for (let k = 0; k < (sb.soldiers | 0); k++) {
      const s = gen(G, { baseId: base.id });
      s.armour = sb.soldierArmour || s.armour;
      addSoldier(G, s);
      if (transport && transport.soldiers.length < (Data.crafts[transport.type].seatsUI | 0)) {
        transport.soldiers.push(s.id);
        s.craftId = transport.id;
      }
    }
    if (transport) defaultLoadouts(G, transport.id);

    // 5) guião alienígena do mês 0 (se OV.Missions ainda não existe, World.step planeia no primeiro passo)
    if (OV.Missions && typeof OV.Missions.planMonth === 'function') OV.Missions.planMonth(G);
    return G;
  }

  OV.Campaign = Object.assign(OV.Campaign || {}, {
    SCHEMA, STREAMS, EVENTS, ID_PREFIX,
    newCampaign, rng, nextId, craftNumber, rebuildDerived, hash, event, endGame, newScoreMonth, emptyLoadout,
    findBase, findCraft, findSoldier, findUfo, findAlienMission, findSite, findAlienBase, findDogfight, baseOf, targetOf, removeById,
    makeSoldier, addSoldier, addCraft, defaultLoadouts,
  });
})(globalThis.OV || (globalThis.OV = {}));

/* ==================================================================================================================
   Secção B — engenheiro de campanha (docs/CAMPAIGN_API.md §5.9): startMission, finishMission, briefingMeta,
   availableResearch, availableManufacture, equipPool, applyEquip, baseDefence. Acrescentar abaixo deste marcador num
   IIFE próprio com Object.assign(OV.Campaign, {...}); a secção A acima não muda sem rever o contrato.
   ================================================================================================================== */
