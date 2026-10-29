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
(function (OV) {
  'use strict';

  /* OV.Campaign (secção B) = {
       availableResearch(G, baseId) → [topicId] ; availableManufacture(G, baseId) → [manufactureId]
       equipPool(G, craftId) → {squad, stores} ; applyEquip(G, craftId, {loadouts, stores}) → {ok, reason?}
       siteRefOf(mission) → siteRef ; briefingMeta(G, mission) → meta
       startMission(G, siteRef, craftId, {settings}?) → missão para OV.Battle.create (marca G.activeMission)
       cancelMission(G) → bool (sai do briefing sem batalha) ; abortMission(G, B) → modelo (abortar + finishMission)
       finishMission(G, B) → modelo do debriefing
       baseDefence(G, baseId, ufoId) → {result, shots, soldiersLost} }
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
    G.activeMission = { siteRef: ref, craftId: craft.id, startedT: G.t };
    return mission;
  }

  // saída do briefing sem batalha: a nave fica no local (a semente já tirada não volta)
  function cancelMission(G) {
    if (!G.activeMission) return false;
    G.activeMission = null;
    return true;
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
    const deb = OV.Battle.debrief(B, { researched: G.researched });
    const craftLine = deb.craftLost ? deb.lines.filter((l) => l.key === 'bs.debrief.craftLost').reduce((s, l) => s + l.points, 0) : 0;
    OV.Economy.addScore(G, 'xcom', deb.score - craftLine, site.lon, site.lat);

    // 3) material e alienígenas vivos para a base (sem contenção com espaço, morrem: fica o cadáver)
    const stored = {}, capturedStored = {}, capturedLost = {};
    if (!deb.craftLost && base) {
      for (const k of Object.keys(deb.recovered).sort()) { bagAdd(base.stores, k, deb.recovered[k]); bagAdd(stored, k, deb.recovered[k]); }
      let room = containmentRoom(G, baseId);
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
      // ours (ritmo, contrato §11): a base alienígena tomada entrega vivas as patentes de TUNE.ALIEN_BASE_SURRENDER
      // (uma por entrada; contam as já capturadas na batalha) enquanto houver lugar na contenção
      if (ref.kind === 'alienBase' && deb.result === 'win') {
        const race = (site.obj && site.obj.race) || B.mission.race;
        const members = Data.races[race] && Data.races[race].members;
        const want = {};
        for (const rank of tune('ALIEN_BASE_SURRENDER', ['commander', 'leader', 'leader'])) {
          const unit = members && members[rank];
          const rr = typeof unit === 'string' && Data.units[unit] ? Data.unitRankRace(unit) : null;
          if (rr && rr.rank === rank) want[unit] = (want[unit] | 0) + 1;
        }
        for (const unit of Object.keys(want)) {
          const n = Math.min(room, want[unit] - (capturedStored[unit] | 0));
          if (n <= 0) continue;
          room -= n;
          bagAdd(base.aliens, unit, n);
          bagAdd(capturedStored, unit, n);
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
      } else OV.Soldiers.kill(G, s.soldierId, s.status === 'dead' ? 'kia' : 'mia', where);
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

    // 7) o local desaparece numa vitória
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
      progression, promotions, stored, capturedStored, capturedLost, craftLost: !!deb.craftLost, scoreAdded: deb.score | 0, storage,
    };
  }

  // «Abortar missão» na batalha: sobreviventes e material da nave regressam (OV.Battle.abort) e aplica-se o resultado
  function abortMission(G, B) {
    if (B && B.phase !== 'over' && !B.aborted) OV.Battle.abort(B);
    return finishMission(G, B);
  }

  /* Ataque a uma base X-COM, resolvido automaticamente (MVP; contrato §5.9 baseDefence; stream combat). */
  function baseDefence(G, baseId, ufoId) {
    const Data = D();
    const base = C.findBase(G, baseId);
    const ufo = C.findUfo(G, ufoId);
    if (!base || !ufo) throw fail('noTarget');
    const ufoDef = Data.ufos[ufo.type];
    const r = C.rng(G, 'combat');
    const shots = [];
    for (const d of OV.BaseSim.capacities(G, baseId).defences) {
      const hit = r.pct(d.hit | 0);
      const dmg = hit ? U.idiv(d.power | 0, 2) + r.int(0, d.power | 0) : 0;
      if (hit) ufo.dmg = (ufo.dmg | 0) + dmg;
      shots.push({ type: d.type, hit, dmg });
    }
    const soldiersLost = [];
    let result;
    if ((ufo.dmg | 0) >= ufoDef.hp) {
      result = 'ufoDestroyed';
      OV.Missions.onUfoDown(G, ufoId, 'destroyed', null);
    } else {
      const garrison = Object.keys(G.soldiers).map((id) => G.soldiers[id]).filter((s) => {
        if (s.baseId !== baseId || s.woundDays > 0) return false;
        const c = s.craftId ? C.findCraft(G, s.craftId) : null;
        return !c || !AIRBORNE[c.status];
      });
      // força = Σ (UT + Pontaria + Saúde) da guarnição + parte do poder das defesas; a exigência desce com o casco
      // que as defesas já tiraram ao OVNI (afinação: docs/CAMPAIGN_API.md §8)
      const defPct = tune('BASE_DEFENCE_FACILITY_PCT', 100);
      let strength = garrison.reduce((sum, s) => sum + (s.stats.tu | 0) + (s.stats.fire | 0) + (s.stats.hp | 0), 0);
      for (const d of OV.BaseSim.capacities(G, baseId).defences) strength += U.idiv((d.power | 0) * defPct, 100);
      const full = tune('BASE_DEFENCE_BASE', 1000) + tune('BASE_DEFENCE_PER_COEF', 250) * 2 * (G.difficulty | 0);
      const need = U.idiv(full * Math.max(0, ufoDef.hp - (ufo.dmg | 0)), Math.max(1, ufoDef.hp));
      if (garrison.length && strength >= need) {
        result = 'repelled';
        const n = Math.min(r.int(1, 3), garrison.length);
        const pool = garrison.slice();
        for (let k = 0; k < n; k++) {
          const s = pool.splice(r.int(0, pool.length - 1), 1)[0];
          soldiersLost.push(s.id);
          OV.Soldiers.kill(G, s.id, 'base', { kind: 'base', lon: base.lon, lat: base.lat });
        }
        OV.Economy.addScore(G, 'xcom', ufoDef.score | 0, base.lon, base.lat);
        OV.Missions.onSiteCleared(G, { kind: 'ufo', id: ufoId }, 'win');
      } else {
        result = 'lost';
        for (const s of garrison) {
          soldiersLost.push(s.id);
          OV.Soldiers.kill(G, s.id, 'base', { kind: 'base', lon: base.lon, lat: base.lat });
        }
      }
    }
    C.event(G, 'baseDefence', { baseId, ufoId, shots, result, soldiersLost });
    if (result === 'lost') destroyBase(G, baseId);
    return { result, shots, soldiersLost };
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
    startMission, cancelMission, abortMission, finishMission, baseDefence,
  });
})(globalThis.OV || (globalThis.OV = {}));
