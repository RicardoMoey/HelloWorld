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
    retaliation: { stop: false }, baseSpotted: { stop: true }, pactSigned: { stop: false },
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
     nome (2, +2 por cada repetição de um nome vivo), atributos (11, pela ordem de soldierGen.statKeys), semente do retrato (1). */
  function makeSoldier(G, opts) {
    const o = opts || {};
    const Data = D();
    const r = o.rng || rng(G, 'geo');
    const gen = Data.soldierGen;
    const nat = Data.pickNationality(r);
    const female = r.pct(gen.femalePct);
    const name = Data.soldierName(r, nat, female, Data.soldierNamesTaken(G.soldiers));
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
      equipment: U.clone(o.equipment || {}), dogfightId: null, lowFuel: false, missionT: null, acquiredT: G.t | 0,
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
      research: [], production: [], deliveries: [], transfers: [], spotted: false, rentDue: 0,
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
    const nSol = Array.isArray(sb.soldiersByDifficulty) ? sb.soldiersByDifficulty[G.difficulty] | 0 : sb.soldiers | 0;
    for (let k = 0; k < nSol; k++) {
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
(function (OV) {
  'use strict';

  /* OV.Campaign (secção B) = {
       availableResearch(G, baseId) → [topicId] ; availableManufacture(G, baseId) → [manufactureId]
       equipPool(G, craftId) → {squad, stores} ; applyEquip(G, craftId, {loadouts, stores}) → {ok, reason?}
       siteRefOf(mission) → siteRef ; briefingMeta(G, mission) → meta
       startMission(G, siteRef, craftId, {settings}?) → missão para OV.Battle.create (marca G.activeMission)
       cancelMission(G) → bool (sai do briefing sem batalha) ; abortMission(G, B) → modelo (abortar + finishMission)
       reseedMap(G, salt) → novo G.rng.map (mistura determinística do sal na stream 'map'; repetir uma missão)
       finishMission(G, B) → modelo do debriefing
       baseVolley(G, baseId, ufoId) → {shots, destroyed} (defesas atiram uma vez; ufo.siege)
       baseDefence(G, baseId, ufoId) → {result, shots, soldiersLost}
       assaultForce(G, ufo) → força esperada da tripulação do OVNI ; defenderPower(soldado) → força na defesa }
     Erros de pré-condição: Error('campaign.err.<motivo>'). */
  const U = OV.U;
  const D = () => OV.Data;
  const C = OV.Campaign;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const AIRBORNE = { out: 1, patrol: 1, returning: 1 };
  const fail = (reason) => new Error('campaign.err.' + reason);

  // ---- multiconjuntos {id: n} sem chaves a zero ------------------------------------------------------------
  function bagAdd(bag, id, n) {
    const v = (bag[id] | 0) + (n | 0);
    if (v > 0) bag[id] = v;
    else delete bag[id];
  }
  const bagOf = (o) => {
    const out = {};
    for (const k of Object.keys(o || {})) if ((o[k] | 0) > 0) out[k] = o[k] | 0;
    return out;
  };
  // itens de um modelo de equipamento pela ordem R, L, cinto…, mochila…
  function loadoutItems(lo) {
    const out = [];
    if (!lo) return out;
    if (lo.R) out.push(lo.R);
    if (lo.L) out.push(lo.L);
    for (const it of lo.belt || []) if (it) out.push(it);
    for (const it of lo.pack || []) if (it) out.push(it);
    return out;
  }
  const cloneLo = (lo) => ({ R: (lo && lo.R) || null, L: (lo && lo.L) || null, belt: ((lo && lo.belt) || []).slice(), pack: ((lo && lo.pack) || []).slice() });
  function templatesOf(G, craft) {
    const bag = {};
    for (const sid of craft.soldiers) {
      const s = C.findSoldier(G, sid);
      if (s) for (const it of loadoutItems(s.loadout)) bagAdd(bag, it, 1);
    }
    return bag;
  }
  // carga solta = equipamento − Σ modelos (limitada a 0)
  function looseOf(G, craft) {
    const loose = bagOf(craft.equipment);
    const tpl = templatesOf(G, craft);
    for (const k of Object.keys(tpl)) bagAdd(loose, k, -Math.min(tpl[k], loose[k] | 0));
    return loose;
  }
  // item que a equipa pode levar para o terreno (sem cadáveres, fixos, componentes, armas de nave)
  function equipUsable(id) {
    const def = D().items[id];
    return !!def && def.battle !== false && def.kind !== 'corpse' && !def.fixed && String(def.kind || '').indexOf('craft_') !== 0;
  }
  // nave no hangar da sua base (equipar mexe no armazém)
  function inHangar(G, craft) {
    const b = C.findBase(G, craft.baseId);
    return !!b && !AIRBORNE[craft.status] && b.crafts.indexOf(craft.id) >= 0;
  }
  const fitSoldiers = (G, craft) => craft.soldiers.map((id) => C.findSoldier(G, id)).filter((s) => s && !(s.woundDays > 0));

  // ---- investigação e fabrico disponíveis ---------------------------------------------------------------------
  function availableResearch(G, baseId) {
    const base = C.findBase(G, baseId);
    if (!base) return [];
    const running = new Set();
    for (const b of G.bases) for (const r of b.research) running.add(r.topic);
    return D().researchAvailable(G.researched, G.flags, base.stores, base.aliens).filter((t) => !running.has(t));
  }
  function availableManufacture(G) {
    return D().manufactureAvailable(G.researched);
  }

  // ---- ecrã «Equipar» -----------------------------------------------------------------------------------------
  function equipPool(G, craftId) {
    const craft = C.findCraft(G, craftId);
    if (!craft) throw fail('noCraft');
    const squad = [];
    for (const sid of craft.soldiers) {
      const s = C.findSoldier(G, sid);
      if (!s) continue;
      squad.push({
        id: s.id, name: s.name, rank: s.rank, stats: U.clone(s.stats), armour: s.armour, portraitSeed: s.portraitSeed,
        female: s.female, nat: s.nat, loadout: cloneLo(s.loadout),
      });
    }
    const stores = looseOf(G, craft);
    if (inHangar(G, craft)) {
      const base = C.findBase(G, craft.baseId);
      for (const k of Object.keys(base.stores)) if (equipUsable(k)) bagAdd(stores, k, base.stores[k]);
    }
    return { squad, stores };
  }

  /* Aplica o resultado do ecrã «Equipar» (contrato §5.9). Recusa um resultado que crie ou destrua itens
     (conservação por tipo entre modelos, carga solta e, no hangar, o armazém utilizável). */
  function applyEquip(G, craftId, res) {
    const craft = C.findCraft(G, craftId);
    if (!craft) return { ok: false, reason: 'noCraft' };
    const r = res || {};
    const loadouts = r.loadouts || {};
    const R = bagOf(r.stores);
    const hangar = inHangar(G, craft);
    const base = C.findBase(G, craft.baseId);
    const team = craft.soldiers.map((id) => C.findSoldier(G, id)).filter(Boolean);
    const newLo = {};
    for (const s of team) newLo[s.id] = loadouts[s.id] ? cloneLo(loadouts[s.id]) : cloneLo(s.loadout);
    for (const id of Object.keys(newLo)) for (const it of loadoutItems(newLo[id])) if (!D().items[it]) return { ok: false, reason: 'item' };
    // antes: modelos + equipamento solto + armazém utilizável ; depois: modelos novos + R
    const before = bagOf(craft.equipment);
    if (hangar) for (const k of Object.keys(base.stores)) if (equipUsable(k)) bagAdd(before, k, base.stores[k]);
    const tplOld = templatesOf(G, craft);
    for (const k of Object.keys(tplOld)) if ((tplOld[k] | 0) > (craft.equipment[k] | 0)) bagAdd(before, k, tplOld[k] - (craft.equipment[k] | 0));
    const tplNew = {};
    for (const id of Object.keys(newLo)) for (const it of loadoutItems(newLo[id])) bagAdd(tplNew, it, 1);
    const after = bagOf(R);
    for (const k of Object.keys(tplNew)) bagAdd(after, k, tplNew[k]);
    const keys = new Set(Object.keys(before).concat(Object.keys(after)));
    for (const k of keys) if ((before[k] | 0) !== (after[k] | 0)) return { ok: false, reason: 'mismatch' };

    const oldLoose = looseOf(G, craft);
    for (const s of team) s.loadout = newLo[s.id];
    const equipment = U.clone(tplNew);
    if (hangar) {
      const loose = {};
      for (const k of Object.keys(oldLoose)) bagAdd(loose, k, Math.min(oldLoose[k], R[k] | 0));
      for (const k of Object.keys(loose)) bagAdd(equipment, k, loose[k]);
      for (const k of Object.keys(base.stores)) if (equipUsable(k)) delete base.stores[k];
      for (const k of Object.keys(R)) bagAdd(base.stores, k, R[k] - (loose[k] | 0));
    } else {
      for (const k of Object.keys(R)) bagAdd(equipment, k, R[k]);
    }
    craft.equipment = equipment;
    return { ok: true };
  }

  // ---- missões ------------------------------------------------------------------------------------------------
  const UFO_KIND = { crashed: 'crash', landed: 'landed' };
  function siteRefOf(mission) {
    const m = mission || {};
    if (m.meta && m.meta.campaign && m.meta.campaign.siteRef) return U.clone(m.meta.campaign.siteRef);
    if (m.kind === 'crash' || m.kind === 'landed') return { kind: 'ufo', id: m.siteId };
    if (m.kind === 'terror') return { kind: 'site', id: m.siteId };
    if (m.kind === 'alienBase') return { kind: 'alienBase', id: m.siteId };
    return { kind: 'cydonia' };
  }
  // local da missão → {kind, obj, lon, lat}; Cidónia: ponto da base da nave
  function siteOf(G, siteRef, craft) {
    if (siteRef && siteRef.kind === 'cydonia') {
      const b = craft ? C.findBase(G, craft.baseId) : G.bases[0] || null;
      return { kind: 'cydonia', obj: null, lon: b ? b.lon : 0, lat: b ? b.lat : 0 };
    }
    const tg = C.targetOf(G, siteRef);
    return tg && (tg.kind === 'ufo' || tg.kind === 'site' || tg.kind === 'alienBase') ? tg : null;
  }

  function metaFor(G, siteRef, craftId, site, phase) {
    const Data = D();
    const ref = siteRef.kind === 'cydonia' ? { kind: 'cydonia' } : { kind: siteRef.kind, id: siteRef.id };
    const meta = { time: phase, cityKey: null, regionKey: null, countryKey: null, race: null, campaign: { siteRef: ref, craftId } };
    if (siteRef.kind === 'cydonia') return meta;
    const o = site.obj;
    if (o.cityId) meta.cityKey = (Data.citiesById[o.cityId] && Data.citiesById[o.cityId].nameKey) || 'city.' + o.cityId;
    const region = OV.GMath.regionAt(site.lon, site.lat);
    if (region && Data.regions[region]) meta.regionKey = Data.regions[region].nameKey;
    const country = OV.GMath.countryAt(site.lon, site.lat);
    if (country && Data.countries[country]) meta.countryKey = Data.countries[country].nameKey;
    // raça conhecida: terror e bases sempre; OVNIs só identificados (hiperonda) ou já vistos no terreno
    const known = siteRef.kind !== 'ufo' || o.hyper || (G.seen.ufoTypes.indexOf(o.type) >= 0 && G.seen.races.indexOf(o.race) >= 0);
    if (known && Data.races[o.race]) meta.race = o.race;
    return meta;
  }
  // fase do dia no local; base alienígena e Cidónia têm luz própria (sombra da batalha por omissão)
  function phaseAt(G, siteRef, site) {
    if (siteRef.kind === 'cydonia' || siteRef.kind === 'alienBase') {
      const shade = siteRef.kind === 'cydonia' ? tune('SHADE_MARS', 8) : tune('SHADE_ALIEN_BASE', 8);
      return shade > tune('DARK_SHADE', 9) ? 'night' : shade > tune('SHADE_DAY', 0) ? 'dusk' : 'day';
    }
    return OV.GMath.dayPhase(G, site.lon, site.lat);
  }

  function briefingMeta(G, mission) {
    const ref = siteRefOf(mission);
    const craft = C.findCraft(G, mission && mission.craftId);
    const site = siteOf(G, ref, craft);
    if (!site) throw fail('noTarget');
    return metaFor(G, ref, craft ? craft.id : null, site, phaseAt(G, ref, site));
  }

  // equipa financiada pelo equipamento a bordo (contrato: «funded(template)»)
  function fundSquad(G, craft) {
    const def = D().crafts[craft.type];
    const pool = bagOf(craft.equipment);
    const take = (it) => {
      if (!it || !((pool[it] | 0) > 0)) return false;
      bagAdd(pool, it, -1);
      return true;
    };
    const squad = [];
    for (const s of fitSoldiers(G, craft).slice(0, def.seatsUI | 0)) {
      const lo = s.loadout || C.emptyLoadout();
      const funded = {
        R: take(lo.R) ? lo.R : null, L: take(lo.L) ? lo.L : null,
        belt: (lo.belt || []).filter(take), pack: (lo.pack || []).filter(take),
      };
      squad.push({
        soldierId: s.id, name: s.name, nat: s.nat, female: s.female, rank: s.rank, stats: U.clone(s.stats), armour: s.armour,
        portraitSeed: s.portraitSeed, missions: s.missions, loadout: funded,
      });
    }
    return { squad, craftItems: pool };
  }

  function checkStart(G, siteRef, craft) {
    if (G.activeMission) throw fail('busy');
    if (G.flags.won || G.flags.lost) throw fail('ended');
    // nunca uma batalha por cima de uma interceção em curso
    if (G.dogfights && G.dogfights.some((d) => !d.over)) throw fail('busy');
    if (!craft) throw fail('noCraft');
    const def = D().crafts[craft.type];
    if (!def || !def.transport || !def.block) throw fail('notTransport');
    if (craft.dogfightId) throw fail('inDogfight');
    if (!fitSoldiers(G, craft).length) throw fail('noSoldiers');
    if (!siteRef || typeof siteRef !== 'object') throw fail('noTarget');
    if (siteRef.kind === 'cydonia') {
      if (!G.flags.cydoniaUnlocked) throw fail('locked');
      if (craft.type !== 'avenger' && !def.spacecraft) throw fail('craftType');
      if (craft.status !== 'ready' || !inHangar(G, craft)) throw fail('notReady');
      return siteOf(G, siteRef, craft);
    }
    const site = siteOf(G, siteRef, craft);
    if (!site) throw fail('noTarget');
    if (site.kind === 'ufo' && !UFO_KIND[site.obj.status]) throw fail('noTarget');
    if (site.kind === 'alienBase' && !site.obj.discovered) throw fail('noTarget');
    const d = craft.dest;
    const aimed = !!d && d.kind === siteRef.kind && d.id === siteRef.id;
    const near = OV.GMath.distNm(craft, site) <= tune('MISSION_ARRIVE_NM', 5);
    if (!(craft.status === 'patrol' && (aimed || near))) throw fail('notAtSite');
    return site;
  }

  /* Missão para OV.Battle.create (contrato §5.9). Tira um u32 da stream map e marca G.activeMission. */
  function startMission(G, siteRef, craftId, opts) {
    const o = opts || {};
    const Data = D();
    const craft = C.findCraft(G, craftId);
    const site = checkStart(G, siteRef, craft);
    const ref = siteRef.kind === 'cydonia' ? { kind: 'cydonia' } : { kind: siteRef.kind, id: site.obj.id };
    const obj = site.obj;
    const kind = ref.kind === 'ufo' ? UFO_KIND[obj.status] : ref.kind === 'site' ? 'terror' : ref.kind;
    const surface = kind === 'crash' || kind === 'landed' || kind === 'terror';
    const phase = phaseAt(G, ref, site);
    const { squad, craftItems } = fundSquad(G, craft);
    const mission = {
      kind, siteId: obj ? obj.id : null, craftId: craft.id, ufoType: ref.kind === 'ufo' ? obj.type : null,
      terrain: kind === 'terror' ? 'URBAN' : kind === 'alienBase' ? 'ALIENBASE' : kind === 'cydonia' ? 'MARS' : Data.terrainAt(site.lon, site.lat),
      night: surface ? phase === 'night' : false,
      race: obj && Data.races[obj.race] ? obj.race : 'mixed',
      month: G.month | 0, difficulty: G.difficulty | 0, seed: C.rng(G, 'map').u32(), deploymentId: null, craftType: craft.type,
      squad, craftItems, researched: G.researched.slice(), settings: U.clone(o.settings || {}),
      meta: metaFor(G, ref, craft.id, site, phase),
    };
    if (surface) mission.shade = OV.GMath.missionShade(G, site.lon, site.lat);
    // local já visitado sem vitória: só os sobreviventes e o material deixado no terreno (contrato §11.10)
    if (obj && obj.garrison && (ref.kind === 'ufo' || ref.kind === 'alienBase')) mission.garrison = U.clone(obj.garrison);
    G.activeMission = { siteRef: ref, craftId: craft.id, startedT: G.t };
    return mission;
  }

  // saída do briefing sem batalha: a nave fica no local (a semente já tirada não volta)
  function cancelMission(G) {
    if (!G.activeMission) return false;
    G.activeMission = null;
    return true;
  }

  /* «Repetir a missão» a partir da gravação «Antes da missão»: mistura um sal (n.º da tentativa) na stream 'map', para
     que o próximo startMission sorteie outro mapa (sem repetição com informação perfeita). Determinística: o mesmo
     G.rng.map e o mesmo sal dão sempre o mesmo estado. Não toca nas outras streams → G.rng.map */
  function reseedMap(G, salt) {
    if (!G || !G.rng || typeof G.rng.map !== 'number') throw fail('noGame');
    const k = Math.imul(((salt >>> 0) + 1) >>> 0, 0x9e3779b1) >>> 0;
    G.rng.map = OV.RNG.create(((G.rng.map >>> 0) ^ k) >>> 0).u32() >>> 0;
    return G.rng.map;
  }

  function containmentRoom(G, baseId) {
    const cap = OV.BaseSim.capacities(G, baseId).aliens;
    return Math.max(0, (cap.cap | 0) - (cap.used | 0));
  }

  /* Aplica o resultado de uma batalha da campanha a G (contrato §5.9, passos 1–10) → modelo do debriefing. */
  function finishMission(G, B) {
    const Data = D();
    const am = G.activeMission;
    if (!B || !B.mission) throw fail('noBattle');
    if (!OV.Battle.outcome(B)) OV.Battle.abort(B);
    const ref = am ? U.clone(am.siteRef) : siteRefOf(B.mission);
    const craftId = am ? am.craftId : B.mission.craftId;
    const craft = C.findCraft(G, craftId);
    if (!craft) throw fail('noCraft');
    const baseId = craft.baseId;
    const base = C.findBase(G, baseId);
    const site = siteOf(G, ref, craft) || { kind: ref.kind, obj: null, lon: craft.lon, lat: craft.lat };
    const meta = site.obj || ref.kind === 'cydonia' ? metaFor(G, ref, craftId, site, phaseAt(G, ref, site)) : { time: null, cityKey: null, regionKey: null, countryKey: null, race: null, campaign: { siteRef: ref, craftId } };
    const where = { kind: ref.kind, lon: site.lon, lat: site.lat };

    // 1–2) relatório da batalha e pontuação (a nave perdida é descontada por World.loseCraft, não duas vezes)
    // a contenção e o valor de um terror ignorado entram no próprio relatório (pontos coerentes com o que acontece)
    const room0 = base ? containmentRoom(G, baseId) : 0;
    const terrorFloor = ref.kind === 'site' ? OV.Missions.expiredPoints(G) : 0;
    const deb = OV.Battle.debrief(B, { researched: G.researched, captureRoom: room0, terrorFloor });
    const craftLine = deb.craftLost ? deb.lines.filter((l) => l.key === 'bs.debrief.craftLost').reduce((s, l) => s + l.points, 0) : 0;
    OV.Economy.addScore(G, 'xcom', deb.score - craftLine, site.lon, site.lat);

    // 3) material e alienígenas vivos para a base (sem contenção com espaço, morrem: fica o cadáver)
    const stored = {}, capturedStored = {}, capturedLost = {}, surrendered = {};
    if (!deb.craftLost && base) {
      for (const k of Object.keys(deb.recovered).sort()) { bagAdd(base.stores, k, deb.recovered[k]); bagAdd(stored, k, deb.recovered[k]); }
      let room = room0;
      for (const cap of deb.captured) {
        if (room > 0) {
          room--;
          bagAdd(base.aliens, cap.unitType, 1);
          bagAdd(capturedStored, cap.unitType, 1);
        } else {
          bagAdd(capturedLost, cap.unitType, 1);
          const corpse = Data.units[cap.unitType] && Data.units[cap.unitType].corpse;
          if (corpse && Data.items[corpse]) { bagAdd(base.stores, corpse, 1); bagAdd(stored, corpse, 1); }
        }
      }
      /* ours (ritmo, contrato §11.12, persona r5): o posto de comando da base — pessoal que não entra na batalha, à
         parte da tripulação B.crew — rende-se quando a base é tomada pela força: vitória sem nenhum alienígena consciente
         (nem pelo centro de controlo com alienígenas de pé, nem ao sair). Entrega vivas as patentes de
         TUNE.ALIEN_BASE_SURRENDER da raça enquanto houver lugar na contenção; os da batalha (mortos ou atordoados) não
         contam, por isso atordoar o comandante dá um segundo. surrendered = os que vieram assim */
      if (ref.kind === 'alienBase' && deb.result === 'win' && !deb.objective && !B.aborted) {
        const race = (site.obj && site.obj.race) || B.mission.race;
        const members = Data.races[race] && Data.races[race].members;
        for (const rank of tune('ALIEN_BASE_SURRENDER', ['commander', 'leader'])) {
          const unit = members && members[rank];
          const rr = typeof unit === 'string' && Data.units[unit] ? Data.unitRankRace(unit) : null;
          if (!rr || rr.rank !== rank || room <= 0) continue;
          room--;
          bagAdd(base.aliens, unit, 1);
          bagAdd(capturedStored, unit, 1);
          bagAdd(surrendered, unit, 1);
        }
      }
    }
    // 4) equipamento perdido sai da nave
    for (const k of Object.keys(deb.equipmentLost)) bagAdd(craft.equipment, k, -Math.min(deb.equipmentLost[k], craft.equipment[k] | 0));

    // 5) soldados: experiência/feridas, mortos e desaparecidos; depois as promoções por quotas
    const progression = [];
    const combat = C.rng(G, 'combat');
    for (const s of deb.soldiers) {
      if (!C.findSoldier(G, s.soldierId)) continue;
      if (s.status === 'ok') {
        const r = OV.Soldiers.applyMission(G, s.soldierId, { exp: s.exp || {}, hpLost: s.hpLost | 0, kills: s.kills | 0 }, combat) || {};
        const pt = r.promotedTo;
        progression.push({ soldierId: s.soldierId, gains: r.gains || {}, promoted: pt === undefined || pt === null ? null : pt, kills: s.kills | 0 });
      } else {
        // missão ganha: o corpo é recuperado e a armadura volta ao armazém (como no OpenXcom; desaparecidos não)
        const sol = C.findSoldier(G, s.soldierId);
        const item = sol && Data.armours[sol.armour] ? Data.armours[sol.armour].storeItem : null;
        if (s.status === 'dead' && deb.result === 'win' && !deb.craftLost && base && item && Data.items[item]) {
          bagAdd(base.stores, item, 1);
          bagAdd(stored, item, 1);
        }
        OV.Soldiers.kill(G, s.soldierId, s.status === 'dead' ? 'kia' : 'mia', where);
      }
    }
    const promotions = OV.Soldiers.promotions(G) || [];
    for (const p of promotions) {
      const row = progression.find((g) => g.soldierId === p.id);
      if (row) row.promoted = Math.max(row.promoted === null ? -1 : row.promoted, p.to);
    }

    // 6) nave: perdida, ou regressa à base (Cidónia: já está no hangar → manutenção)
    if (deb.craftLost) OV.World.loseCraft(G, craftId, 'mission');
    else if (ref.kind === 'cydonia') {
      Object.assign(craft, { dest: null, speed: 0, patrol: false });
      OV.BaseSim.checkup(G, craftId);
    } else {
      craft.dest = { kind: 'base', id: baseId };
      craft.status = 'returning';
      craft.patrol = false;
      craft.speed = D().crafts[craft.type].speed;
    }

    // 7) o local desaparece numa vitória; sem vitória, um OVNI ou base guarda os sobreviventes e o material no terreno
    // (ours, §11.10: abortar e voltar já não repõe a tripulação inteira)
    if (deb.result !== 'win' && site.obj && (ref.kind === 'ufo' || ref.kind === 'alienBase')) {
      const gar = OV.Battle.garrisonAfter(B, deb);
      if (gar) site.obj.garrison = Object.assign(gar, { visits: ((site.obj.garrison && site.obj.garrison.visits) | 0) + 1 });
    }
    if (ref.kind !== 'cydonia') OV.Missions.onSiteCleared(G, ref, deb.result);

    // 8) estatísticas e registos vistos
    const st = G.stats;
    if (deb.result === 'win') st.missionsWon++;
    else if (deb.result === 'loss') st.missionsLost++;
    else st.missionsAborted++;
    st.aliensKilled += deb.kills | 0;
    for (const k of Object.keys(capturedStored)) st.aliensCaptured += capturedStored[k];
    st.civiliansSaved += (deb.civilians && deb.civilians.saved) | 0;
    const race = B.mission.race;
    if (Data.races[race] && G.seen.races.indexOf(race) < 0) G.seen.races.push(race);
    const ufoType = B.mission.ufoType;
    const ufoSite = (B.mission.kind === 'crash' || B.mission.kind === 'landed') && !!Data.ufos[ufoType];
    if (ufoSite && G.seen.ufoTypes.indexOf(ufoType) < 0) G.seen.ufoTypes.push(ufoType);
    // primeira recuperação de um tipo de OVNI abre o seu artigo da Ufopédia (contrato §5.11, ufo_<tipo>)
    if (ufoSite && deb.result === 'win' && !deb.craftLost && G.ufopaedia.indexOf('ufo_' + ufoType) < 0) G.ufopaedia.push('ufo_' + ufoType);

    // 9) Cidónia decide o jogo
    if (ref.kind === 'cydonia') {
      if (deb.result === 'win') C.endGame(G, 'won');
      else C.endGame(G, 'lost', 'cydonia');
    }
    // 10) fim
    G.activeMission = null;

    let storage = null;
    if (base && !deb.craftLost) {
      const cap = OV.BaseSim.capacities(G, baseId).storage;
      storage = { cap: cap.cap, used: cap.used, over: cap.used > cap.cap };
    }
    return {
      debrief: deb, mission: B.mission, meta, outcome: G.flags.won ? 'victory' : G.flags.lost ? 'gameOver' : 'continue',
      progression, promotions, stored, capturedStored, capturedLost, surrendered, craftLost: !!deb.craftLost, scoreAdded: deb.score | 0, storage,
    };
  }

  // «Abortar missão» na batalha: sobreviventes e material da nave regressam (OV.Battle.abort) e aplica-se o resultado
  function abortMission(G, B) {
    if (B && B.phase !== 'over' && !B.aborted) OV.Battle.abort(B);
    return finishMission(G, B);
  }

  /* Salva das defesas da base contra o OVNI do ataque (atiram primeiro, uma vez por ataque; stream combat). Marca
     ufo.siege = {baseId, shots} (o World lança depois as naves armadas do hangar e só então resolve o assalto). */
  function baseVolley(G, baseId, ufoId) {
    const base = C.findBase(G, baseId);
    const ufo = C.findUfo(G, ufoId);
    if (!base || !ufo) throw fail('noTarget');
    if (ufo.siege && ufo.siege.baseId === baseId) return { shots: ufo.siege.shots, destroyed: (ufo.dmg | 0) >= D().ufos[ufo.type].hp };
    const r = C.rng(G, 'combat');
    const shots = [];
    for (const d of OV.BaseSim.capacities(G, baseId).defences) {
      const hit = r.pct(d.hit | 0);
      const dmg = hit ? U.idiv(d.power | 0, 2) + r.int(0, d.power | 0) : 0;
      if (hit) ufo.dmg = (ufo.dmg | 0) + dmg;
      shots.push({ type: d.type, hit, dmg });
    }
    ufo.siege = { baseId, shots };
    return { shots, destroyed: (ufo.dmg | 0) >= D().ufos[ufo.type].hp };
  }

  /* Força esperada da tripulação do OVNI de um ataque (contrato §5.9): Σ sobre as linhas do destacamento do tipo de OVNI
     de média(qty) × (UT + Pontaria + Saúde + armadura frontal) da unidade da raça na dificuldade (Data.alienStats /
     alienArmour; terroristas: média das duas posições; quantidades com Data.crewDifficulty do mês), × (100 +
     TUNE.BASE_DEFENCE_TIER_PCT × nível médio de armamento do mês, alienItemTiers) / 100. Inteiro. */
  function assaultForce(G, ufo) {
    const Data = D();
    const def = ufo && Data.ufos[ufo.type];
    const depId = def && def.deployment;
    const dep = depId && Data.deployments[depId];
    if (!dep) return 0;
    const diff = G.difficulty | 0;
    const cd = Data.crewDifficulty(depId, diff, G.month | 0);
    const race = Data.races[ufo.race] ? ufo.race : dep.race || 'sectoid';
    let sum4 = 0;
    for (const row of dep.rows) {
      const q = Data.rowQty(row, cd);
      for (const pick of [0, 1]) {
        const unit = Data.rowUnit(dep, row, race, pick);
        if (!unit || !Data.units[unit]) continue;
        const st = Data.alienStats(unit, diff);
        const ar = Data.alienArmour(unit, diff);
        sum4 += ((q[0] | 0) + (q[1] | 0)) * ((st.tu | 0) + (st.fire | 0) + (st.hp | 0) + ((ar && ar[0]) | 0));
      }
    }
    // nível de armamento esperado ×100 (pistola 0, espingarda 1, pesado 2): fixo da raça, senão a tabela do mês
    const tiers = Data.alienItemTiers;
    let tier100 = 0;
    if (tiers && tiers.raceTier && tiers.raceTier[race] !== undefined) tier100 = 100 * (tiers.raceTier[race] | 0);
    else if (tiers && Array.isArray(tiers.byMonth) && tiers.byMonth.length) {
      const row = tiers.byMonth[U.clamp(G.month | 0, 0, tiers.byMonth.length - 1)];
      for (let k = 0; k < row.length; k++) tier100 += k * (row[k] | 0);
    }
    return U.idiv(U.idiv(sum4, 4) * (100 + U.idiv(tune('BASE_DEFENCE_TIER_PCT', 20) * tier100, 100)), 100);
  }
  /* Poder de tiro de uma arma de infantaria (o da arma ou o da melhor munição), até TUNE.BASE_DEFENCE_GUN_CAP; armas de
     atordoar e por investigar (researched = lista de G) não contam → 0 */
  function gunPower(id, researched, stores) {
    const Data = D();
    const it = Data.items[id];
    if (!it || it.kind !== 'firearm' || it.battle === false) return 0;
    if (researched && it.research && researched.indexOf(it.research) < 0) return 0;
    let p = it.power | 0, dmg = it.dmg;
    if (Array.isArray(it.ammo)) {
      for (const a of it.ammo) {
        const am = Data.items[a];
        // stores (armazém): só a munição que lá há e se pode usar
        if (stores && (!((stores[a] | 0) > 0) || (researched && am && am.research && researched.indexOf(am.research) < 0))) continue;
        if (am && (am.power | 0) > p && am.dmg !== 'STUN') { p = am.power | 0; dmg = am.dmg; }
      }
    }
    if (dmg === 'STUN') return 0;
    return Math.min(p, tune('BASE_DEFENCE_GUN_CAP', 120));
  }
  /* Ordem das armas para o equipamento automático (persona r5; a UI escolhe a 1.ª que a Força aguenta com munição):
     espingardas da melhor para a pior, depois as armas pesadas com munição no pool (Lança-Foguetes, Canhões, Laser
     Pesado) pela potência, e só então as pistolas — 11 Lança-Foguetes no armazém já não deixam um recruta de pistola.
     Ficam de fora as de atordoar, a guiada (Blaster) e as por investigar. stores = {itemId: n} → [itemId] */
  const KIT_RIFLES = ['heavy_plasma', 'plasma_rifle', 'laser_rifle', 'rifle'];
  function kitGuns(G, stores) {
    const Data = D();
    const st = stores || {};
    const res = G.researched;
    const ok = (id) => (st[id] | 0) > 0 && gunPower(id, res, Array.isArray(Data.items[id].ammo) && Data.items[id].ammo.length ? st : null) > 0
      && !Data.items[id].guided;
    const ids = Object.keys(st).filter((id) => Data.items[id] && Data.items[id].kind === 'firearm' && ok(id));
    const pow = (id) => gunPower(id, res, st);
    const wt = (id) => Data.items[id].weight | 0;
    const rifles = KIT_RIFLES.filter((id) => ids.indexOf(id) >= 0);
    const hand = (id) => !Data.items[id].twoHanded;
    const rest = ids.filter((id) => rifles.indexOf(id) < 0).sort((a, b) => pow(b) - pow(a) || wt(a) - wt(b) || (a < b ? -1 : 1));
    return rifles.concat(rest.filter((id) => !hand(id)), rest.filter(hand));
  }
  // melhor arma nas mãos de um soldado → poder (0 desarmado)
  const handGun = (s, researched) => Math.max(gunPower(s.loadout && s.loadout.R, researched), gunPower(s.loadout && s.loadout.L, researched));
  /* força de um soldado na defesa: UT + Pontaria + Saúde + armadura frontal do que veste + (poder da arma − espingarda)
     × BASE_DEFENCE_WEAPON_PCT % (persona r5: espingarda 0, laser +15, plasma pesado +42, desarmado −15). gun = poder da
     arma (omissão: a melhor que leva nas mãos). */
  function defenderPower(s, gun) {
    const a = D().armours[s.armour];
    const g = gun === undefined || gun === null ? handGun(s, null) : gun | 0;
    const w = U.idiv((g - tune('BASE_DEFENCE_GUN_BASE', 30)) * tune('BASE_DEFENCE_WEAPON_PCT', 50), 100);
    return Math.max(0, (s.stats.tu | 0) + (s.stats.fire | 0) + (s.stats.hp | 0) + ((a && a.front) | 0) + w);
  }
  // soldados que defendem a base: aptos, de casa, e não numa nave no ar
  function garrisonOf(G, baseId) {
    return Object.keys(G.soldiers).map((id) => G.soldiers[id]).filter((s) => {
      if (s.baseId !== baseId || s.woundDays > 0) return false;
      const c = s.craftId ? C.findCraft(G, s.craftId) : null;
      return !c || !AIRBORNE[c.status];
    });
  }
  /* Força da guarnição: cada soldado com a arma que leva; os desarmados (ou com arma pior) vão buscar ao armazém as
     melhores armas com munição (uma por soldado). → {men, list:[{id, power}]} */
  function garrisonPower(G, base, garrison) {
    const res = G.researched;
    const spare = [];
    const st = base.stores || {};
    for (const id of Object.keys(st).sort()) {
      const p = gunPower(id, res, st);
      if (p <= 0) continue;
      const it = D().items[id];
      const needsAmmo = Array.isArray(it.ammo) && it.ammo.length > 0;
      const clips = needsAmmo ? it.ammo.reduce((n, a) => n + ((st[a] | 0) > 0 && (!D().items[a].research || res.indexOf(D().items[a].research) >= 0) ? st[a] | 0 : 0), 0) : Infinity;
      for (let k = 0; k < Math.min(st[id] | 0, clips); k++) spare.push(p);
    }
    spare.sort((a, b) => b - a);
    const rows = garrison.map((s) => ({ s, own: handGun(s, res) })).sort((a, b) => a.own - b.own || (a.s.id < b.s.id ? -1 : 1));
    const list = [];
    let men = 0;
    for (const r of rows) {
      const gun = spare.length && spare[0] > r.own ? spare.shift() : r.own;
      const p = defenderPower(r.s, gun);
      list.push({ id: r.s.id, power: p });
      men += p;
    }
    return { men, list };
  }
  /* Probabilidades do assalto (persona r5: suave em vez de um limiar) para r = 100 × força / exigência:
     perdida = clamp(100 × (MID − r) / (MID − LO)), repelida = clamp(100 × (r − LO) / (HI − LO)), o resto = aguentada a
     custo (baixas pesadas e instalações destruídas). LO 50 / MID 100 / HI 150: r ≤ 50 cai sempre, r ≥ 150 aguenta sempre. */
  function defenceOddsOf(strength, need, garrisonN) {
    if (!garrisonN) return { ratio: 0, lostPct: 100, repelPct: 0, holdPct: 0 };
    const lo = tune('BASE_DEFENCE_RATIO_LO', 50), mid = tune('BASE_DEFENCE_RATIO_MID', 100), hi = tune('BASE_DEFENCE_RATIO_HI', 150);
    const ratio = need > 0 ? U.idiv(100 * strength, need) : 1000;
    const lostPct = U.clamp(U.idiv(100 * (mid - ratio), Math.max(1, mid - lo)), 0, 100);
    const repelPct = U.clamp(U.idiv(100 * (ratio - lo), Math.max(1, hi - lo)), 0, 100 - lostPct);
    return { ratio, lostPct, repelPct, holdPct: 100 - lostPct - repelPct };
  }
  // força (soldados + defesas com teto) e exigência de um assalto do OVNI ufo (casco que resta) contra a base
  function defenceBalance(G, base, ufo) {
    const garrison = garrisonOf(G, base.id);
    const gp = garrisonPower(G, base, garrison);
    let fac = 0;
    const defences = OV.BaseSim.capacities(G, base.id).defences;
    for (const d of defences) fac += U.idiv((d.power | 0) * tune('BASE_DEFENCE_FACILITY_PCT', 25), 100);
    const facUsed = Math.min(fac, U.idiv(gp.men * tune('BASE_DEFENCE_FACILITY_CAP_PCT', 66), 100));
    const hp = Math.max(1, D().ufos[ufo.type].hp);
    const full = U.idiv(assaultForce(G, ufo) * tune('BASE_DEFENCE_CREW_PCT', 50), 100);
    const need = U.idiv(full * Math.max(0, hp - (ufo.dmg | 0)), hp);
    return { garrison, men: gp.men, list: gp.list, facilities: facUsed, facilitiesRaw: fac, defences: defences.length, strength: gp.men + facUsed, need };
  }
  // raça mais forte das que podem atacar este mês (ou a da retaliação que já visa a base)
  function attackerRace(G, baseId) {
    const m = G.alienMissions.find((x) => x.targetBaseId === baseId && D().alienMissions[x.type] && D().alienMissions[x.type].objective === 'retaliation');
    if (m && D().races[m.race]) return m.race;
    const w = D().raceWeights('alien_retaliation', G.month | 0);
    let best = null, bestF = -1;
    for (const race of Object.keys(w).sort()) {
      if (!(w[race] > 0) || !D().races[race]) continue;
      const f = assaultForce(G, { type: 'battleship', race, dmg: 0 });
      if (f > bestF) { bestF = f; best = race; }
    }
    return best || 'sectoid';
  }
  /* Estimativa para a interface (persona r5): a guarnição de hoje contra um assalto. opts.ufoId = o OVNI que ataca (com o
     casco que lhe resta); senão um Couraçado intacto da raça opts.race (omissão: a da retaliação que visa a base, ou a
     mais forte do mês). → {garrison, strength, need, ratio, lostPct, repelPct, holdPct, race, ufoType, men, facilities,
     defences, soldiersShort, defencesShort} — soldiersShort: soldiers de força média a mais até ratio ≥ MID (0 se
     chega); defencesShort: Defesas de Mísseis a mais que bastam, ou −1 se só defesas não chegam (teto). Puro. */
  function defenceOdds(G, baseId, opts) {
    const o = opts || {};
    const base = C.findBase(G, baseId);
    if (!base) throw fail('noTarget');
    const real = o.ufoId ? C.findUfo(G, o.ufoId) : null;
    const race = real ? real.race : D().races[o.race] ? o.race : attackerRace(G, baseId);
    const ufo = real || { type: 'battleship', race, dmg: 0 };
    const b = defenceBalance(G, base, ufo);
    const odds = defenceOddsOf(b.strength, b.need, b.garrison.length);
    const mid = tune('BASE_DEFENCE_RATIO_MID', 100);
    const target = U.idiv(b.need * mid + 99, 100);
    const short = Math.max(0, target - b.strength);
    // soldado médio: a média da guarnição, ou um recruta de fato com espingarda (≈ 140)
    const avg = b.garrison.length ? Math.max(1, U.idiv(b.men, b.garrison.length)) : 140;
    const capPct = tune('BASE_DEFENCE_FACILITY_CAP_PCT', 66);
    const perSoldier = avg + U.idiv(avg * capPct, 100) * (b.facilitiesRaw > b.facilities ? 1 : 0);
    const soldiersShort = short > 0 ? Math.ceil(short / Math.max(1, perSoldier)) : 0;
    const mdPow = U.idiv(((D().facilities.missile_defence && D().facilities.missile_defence.defence) | 0) * tune('BASE_DEFENCE_FACILITY_PCT', 25), 100);
    const room = Math.max(0, U.idiv(b.men * capPct, 100) - b.facilities);
    const defencesShort = short <= 0 ? 0 : short <= room && mdPow > 0 ? Math.ceil(short / mdPow) : -1;
    return {
      garrison: b.garrison.length, strength: b.strength, need: b.need, ratio: odds.ratio, lostPct: odds.lostPct, repelPct: odds.repelPct,
      holdPct: odds.holdPct, race, ufoType: ufo.type, men: b.men, facilities: b.facilities, defences: b.defences, soldiersShort, defencesShort,
    };
  }

  /* Ataque a uma base X-COM, resolvido automaticamente (MVP; contrato §5.9 baseDefence; stream combat): salva das
     defesas (se ainda não houve), depois a guarnição (com as armas que leva ou que encontra no armazém) contra a
     tripulação esperada do OVNI no casco que resta. As defesas só ajudam até TUNE.BASE_DEFENCE_FACILITY_CAP_PCT da força
     dos soldados. Resultado sorteado com defenceOddsOf (persona r5): 'repelled' (baixas pelo rácio), 'repelled' com
     held:true (aguentada a custo: ≥ HOLD_CASUALTY_PCT % da guarnição morre, mas fica 1, sem pontos, e até
     HOLD_FACILITIES radares/defesas voltam a obra — facilitiesDamaged) ou 'lost' (a base cai). */
  const CAP_KEYS = ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts'];
  const WRECKABLE = (def) => !!def && !def.lift && CAP_KEYS.every((k) => !(def[k] > 0));
  function baseDefence(G, baseId, ufoId) {
    const Data = D();
    const base = C.findBase(G, baseId);
    const ufo = C.findUfo(G, ufoId);
    if (!base || !ufo) throw fail('noTarget');
    const ufoDef = Data.ufos[ufo.type];
    const shots = baseVolley(G, baseId, ufoId).shots;
    const r = C.rng(G, 'combat');
    const soldiersLost = [], facilitiesDamaged = [];
    let result, held = false, odds = null;
    const killAll = (list) => {
      for (const s of list) {
        soldiersLost.push(s.id);
        OV.Soldiers.kill(G, s.id, 'base', { kind: 'base', lon: base.lon, lat: base.lat });
      }
    };
    const pickDead = (garrison, n) => {
      const pool = garrison.slice();
      const out = [];
      for (let k = 0; k < n && pool.length; k++) out.push(pool.splice(r.int(0, pool.length - 1), 1)[0]);
      return out;
    };
    if ((ufo.dmg | 0) >= ufoDef.hp) {
      result = 'ufoDestroyed';
      OV.Missions.onUfoDown(G, ufoId, 'destroyed', null);
    } else {
      const b = defenceBalance(G, base, ufo);
      const garrison = b.garrison;
      odds = defenceOddsOf(b.strength, b.need, garrison.length);
      const roll = garrison.length ? r.int(0, 99) : 0;
      if (!garrison.length || roll < odds.lostPct) {
        result = 'lost';
        killAll(garrison);
      } else {
        result = 'repelled';
        held = roll >= odds.lostPct + odds.repelPct;
        // baixas = round(guarnição × exigência / força × CASUALTY_PCT %), entre 1 e a guarnição
        const pct = tune('BASE_DEFENCE_CASUALTY_PCT', 40);
        let n = U.clamp(U.idiv(2 * garrison.length * b.need * pct + 100 * b.strength, 200 * Math.max(1, b.strength)), 1, garrison.length);
        // aguentada a custo: a maior parte da guarnição cai (mas alguém fica) e o assalto destrói instalações
        if (held) n = U.clamp(Math.max(n, U.idiv(garrison.length * tune('BASE_DEFENCE_HOLD_CASUALTY_PCT', 60) + 99, 100)), 0, garrison.length - 1);
        killAll(pickDead(garrison, n));
        if (held) {
          // instalações sem capacidades (radares, defesas, descodificador) ficam desfeitas: voltam a obra (dias de
          // construção) e não contam até estarem prontas — as de alojamento/hangar/armazém não se mexem
          for (let k = 0; k < tune('BASE_DEFENCE_HOLD_FACILITIES', 2); k++) {
            const cand = base.grid.filter((f) => !(f.daysLeft > 0) && WRECKABLE(Data.facilities[f.type]));
            if (!cand.length) break;
            const f = cand[r.int(0, cand.length - 1)];
            f.daysLeft = Math.max(1, Data.facilities[f.type].days | 0);
            facilitiesDamaged.push(f.type);
          }
        }
        if (!held) OV.Economy.addScore(G, 'xcom', ufoDef.score | 0, base.lon, base.lat);
        OV.Missions.onSiteCleared(G, { kind: 'ufo', id: ufoId }, 'win');
      }
    }
    const ev = { baseId, ufoId, shots, result, soldiersLost };
    if (held) Object.assign(ev, { held: true, facilitiesDamaged });
    if (odds) ev.odds = { ratio: odds.ratio, lostPct: odds.lostPct, repelPct: odds.repelPct, holdPct: odds.holdPct };
    C.event(G, 'baseDefence', ev);
    if (result === 'lost') destroyBase(G, baseId);
    return { result, shots, soldiersLost, held, facilitiesDamaged, odds };
  }

  // base perdida: naves e pessoal desaparecem; sem bases o jogo acaba ('baseLost')
  function destroyBase(G, baseId) {
    const base = C.findBase(G, baseId);
    if (!base) return;
    for (const cid of base.crafts.slice()) if (C.findCraft(G, cid)) OV.World.loseCraft(G, cid, 'base');
    for (const sid of base.soldiers.slice()) if (C.findSoldier(G, sid)) OV.Soldiers.kill(G, sid, 'base', { kind: 'base', lon: base.lon, lat: base.lat });
    C.removeById(G.bases, baseId);
    if (!G.bases.length) C.endGame(G, 'lost', 'baseLost');
  }

  Object.assign(OV.Campaign, {
    availableResearch, availableManufacture, equipPool, applyEquip, siteRefOf, briefingMeta,
    startMission, cancelMission, reseedMap, abortMission, finishMission, baseVolley, baseDefence, assaultForce, defenderPower,
    defenceOdds, kitGuns,
  });
})(globalThis.OV || (globalThis.OV = {}));
