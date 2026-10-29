/* Gravações (DESIGN.md §18; contrato docs/CAMPAIGN_API.md §5.10, §7).
   Forma: {game:'ovni-1999', schema, savedAt, label, build, campaign: G sem events | null, battle: B serializado | null}.
   O único ficheiro de js/sim que toca no localStorage, sempre atrás de verificação e try/catch.

   OV.Save = {
     SCHEMA, SLOTS:['auto','autoTurn','1','2','3'], KEY(slot) → 'ovni1999.save.' + slot, MIGRATIONS:[]
     toJSON(G, B?, meta?) → objeto            Error('save.err.busy') com interceções em curso
     fromJSON(obj) → {G, B, meta}            Error('save.err.game'|'save.err.schema'|'save.err.parse'); validação profunda
                                             (repara listas/contadores em falta, recusa o resto) e ensaio dos passos do
                                             relógio numa cópia antes de devolver G
     migrate(obj, list?, target?) → obj       MIGRATIONS[n] eleva uma gravação do esquema n para n+1
     write(slot, obj) → {ok, reason?:'slot'|'quota'|'unavailable'} ; read(slot) → objeto|null ; remove(slot) → bool
     save(slot, G, B?, meta?) → {ok, reason?}  (toJSON + write; 'busy' com interceções em curso)
     list() / slots() → [{slot, label, savedAt, t, date:'AAAA-MM-DD', month, funds, difficulty, battle, corrupt?}]
     load(slot) → {G, B, meta}|null (null = vazio; gravação inválida lança como fromJSON)
     exportFile(obj | G) → {filename, name, mime, text} ; importFile(text) → {G, B, meta}
     setStorage(storage|null) → armazenamento alternativo (testes; null volta ao localStorage) } */
(function (OV) {
  'use strict';

  const GAME = 'ovni-1999';
  const SCHEMA = 1;
  const SLOTS = ['auto', 'autoTurn', '1', '2', '3'];
  const PREFIX = 'ovni1999.save.';
  const MAX_TEXT = 32 * 1024 * 1024;
  const KEY = (slot) => PREFIX + slot;
  const err = (reason) => new Error('save.err.' + reason);
  // MIGRATIONS[n](obj) → obj do esquema n+1 (no próprio objeto)
  const MIGRATIONS = [];

  // chaves de topo de G e os seus tipos (contrato §1.1)
  const G_KEYS = {
    game: 'string', schema: 'number', seed: 'number', difficulty: 'number', t: 'number', month: 'number', plannedMonth: 'number',
    rng: 'object', ids: 'object', funds: 'number', history: 'array', reports: 'array', council: 'object', score: 'object',
    countries: 'array', bases: 'array', soldiers: 'object', dead: 'array', crafts: 'object', ufos: 'array', alienMissions: 'array',
    sites: 'array', alienBases: 'array', dogfights: 'array', alien: 'object', researched: 'array', ufopaedia: 'array', seen: 'object',
    flags: 'object', stats: 'object',
  };

  // ---- armazenamento ----------------------------------------------------------------------------------------
  let custom = null;
  function storage() {
    if (custom) return custom;
    try {
      const ls = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch (e) {
      return null; // Safari privado / dados bloqueados
    }
  }
  function setStorage(s) {
    custom = s || null;
  }
  const validSlot = (slot) => SLOTS.indexOf(String(slot)) >= 0;
  function isQuota(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || ''));
  }

  // ---- serialização -----------------------------------------------------------------------------------------
  function campaignJSON(G) {
    return JSON.parse(JSON.stringify(G, function (k, v) {
      return this === G && (k === 'events' || k === '_') ? undefined : v;
    }));
  }

  function toJSON(G, B, meta) {
    const m = meta || {};
    if (!G && !B) throw err('empty');
    if (G && Array.isArray(G.dogfights) && G.dogfights.length) throw err('busy');
    const battle = B ? JSON.parse(JSON.stringify(OV.Battle.serialize(B))) : null;
    return {
      game: GAME, schema: SCHEMA,
      savedAt: typeof m.savedAt === 'string' ? m.savedAt : new Date().toISOString(),
      label: typeof m.label === 'string' ? m.label : null,
      build: typeof m.build === 'string' ? m.build : null,
      campaign: G ? campaignJSON(G) : null,
      battle,
    };
  }

  function migrate(obj, list, target) {
    const steps = list || MIGRATIONS;
    const to = target === undefined ? SCHEMA : target;
    let o = obj;
    while (o.schema < to) {
      const fn = steps[o.schema];
      if (typeof fn !== 'function') throw err('schema');
      const from = o.schema;
      o = fn(o) || o;
      if (!(o.schema > from)) o.schema = from + 1;
      if (o.campaign && typeof o.campaign === 'object') o.campaign.schema = o.schema;
    }
    return o;
  }

  const typeOk = (v, ty) => (ty === 'array' ? Array.isArray(v) : ty === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : typeof v === ty && (ty !== 'number' || Number.isFinite(v)));
  const isObj = (v) => typeOk(v, 'object');
  const isInt = (v) => Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const need = (ok) => {
    if (!ok) throw err('parse');
  };
  const CRAFT_STATUS = { ready: 1, out: 1, patrol: 1, returning: 1, repair: 1, rearm: 1, refuel: 1 };
  const UFO_STATUS = { flying: 1, landed: 1, crashed: 1 };
  const STATS = ['ufosDetected', 'ufosShotDown', 'ufosDestroyed', 'missionsWon', 'missionsLost', 'missionsAborted', 'aliensKilled',
    'aliensCaptured', 'soldiersLost', 'civiliansSaved', 'terrorIgnored', 'craftsLost'];

  function checkCampaign(G) {
    if (!G || typeof G !== 'object' || Array.isArray(G)) throw err('parse');
    if (G.game !== GAME) throw err('game');
    for (const k of Object.keys(G_KEYS)) if (!typeOk(G[k], G_KEYS[k])) throw err('parse');
    for (const s of (OV.Campaign && OV.Campaign.STREAMS) || []) if (!typeOk(G.rng[s], 'number')) throw err('parse');
    if (!G.bases.every((b) => b && typeof b.id === 'string' && Array.isArray(b.grid) && b.stores && typeof b.stores === 'object')) throw err('parse');
    for (const id of Object.keys(G.crafts)) if (!G.crafts[id] || G.crafts[id].id !== id) throw err('parse');
    for (const id of Object.keys(G.soldiers)) if (!G.soldiers[id] || G.soldiers[id].id !== id) throw err('parse');
    if (G.activeMission !== null && G.activeMission !== undefined && !typeOk(G.activeMission, 'object')) throw err('parse');
  }

  /* Validação profunda (contrato §1): repara o que tem um valor por omissão óbvio (listas e contadores em falta,
     interceções gravadas à mão) e recusa (save.err.parse) o que não se pode adivinhar, antes de chegar ao ciclo
     principal. Depois corre todos os passos do relógio numa cópia: se algum rebentar, a gravação é recusada. */
  function repairCampaign(G) {
    const Data = OV.Data;
    const Camp = OV.Campaign;
    need(isInt(G.t) && G.t >= 0 && G.t % 5 === 0 && isInt(G.month) && G.month === OV.Clock.monthIndex(G.t));
    need(isInt(G.plannedMonth) && G.plannedMonth >= -1 && G.plannedMonth <= G.month);
    need(isInt(G.difficulty) && G.difficulty >= 0 && G.difficulty <= 2 && isInt(G.funds));
    need(isObj(G.ids.seq) && isObj(G.ids.craftNum));
    for (const k in G.ids.seq) need(isInt(G.ids.seq[k]));
    // pontuação
    const sm = G.score.month, sa = G.score.all;
    need(isObj(sm) && isObj(sa) && isNum(sm.research) && isNum(sa.xcom) && isNum(sa.alien) && isNum(sa.research));
    for (const side of ['xcom', 'alien']) need(isObj(sm[side]) && isNum(sm[side].total) && isObj(sm[side].regions) && isObj(sm[side].countries));
    // contadores, bandeiras, vistos, conselho
    for (const k of ['badMonths', 'debtMonths', 'lastRating']) if (!isInt(G.council[k])) G.council[k] = 0;
    for (const k of STATS) if (!isInt(G.stats[k])) G.stats[k] = 0;
    for (const f of Data.researchFlags) if (typeof G.flags[f] !== 'boolean') G.flags[f] = false;
    for (const f of ['won', 'lost']) if (typeof G.flags[f] !== 'boolean') G.flags[f] = false;
    if (G.flags.lostReason === undefined) G.flags.lostReason = null;
    for (const k of ['ufoTypes', 'races']) if (!Array.isArray(G.seen[k])) G.seen[k] = [];
    need(G.researched.every(isStr) && G.ufopaedia.every(isStr));
    // países
    for (const c of G.countries) {
      need(isObj(c) && isStr(c.id) && isInt(c.funding) && c.funding >= 0);
      if (!Array.isArray(c.history)) c.history = [];
      if (typeof c.pact !== 'boolean') c.pact = false;
      if (typeof c.mood !== 'string') c.mood = 'same';
      if (!isInt(c.lastDelta)) c.lastDelta = 0;
    }
    // bases
    const baseIds = {};
    for (const b of G.bases) {
      need(isStr(b.id) && !baseIds[b.id] && isNum(b.lon) && isNum(b.lat) && isInt(b.scientists) && isInt(b.engineers));
      baseIds[b.id] = b;
      for (const k of ['soldiers', 'crafts', 'research', 'production', 'deliveries']) need(Array.isArray(b[k]));
      if (!Array.isArray(b.transfers)) b.transfers = [];
      if (!isObj(b.aliens)) b.aliens = {};
      if (typeof b.spotted !== 'boolean') b.spotted = false;
      if (!isInt(b.rentDue) || b.rentDue < 0) b.rentDue = 0;
      for (const f of b.grid) need(isObj(f) && !!Data.facilities[f.type] && isInt(f.x) && isInt(f.y) && isInt(f.daysLeft));
      for (const bag of [b.stores, b.aliens]) for (const k in bag) need(isInt(bag[k]));
      for (const p of b.research) need(isObj(p) && isStr(p.topic) && isInt(p.cost) && isInt(p.spent) && isInt(p.scientists));
      for (const p of b.production) need(isObj(p) && isStr(p.id) && !!Data.manufacture[p.item] && isInt(p.engineers) && isInt(p.qty) && isInt(p.done) && isNum(p.spent));
      for (const d of b.deliveries.concat(b.transfers)) need(isObj(d) && isStr(d.kind) && isInt(d.n) && isInt(d.etaT));
    }
    // naves (interceções nunca se gravam: as que vierem à mão são descartadas)
    G.dogfights = [];
    for (const id of Object.keys(G.crafts)) {
      const c = G.crafts[id];
      const def = Data.crafts[c.type];
      const b = baseIds[c.baseId];
      need(!!def && !!b && b.crafts.indexOf(id) >= 0 && !!CRAFT_STATUS[c.status] && isNum(c.lon) && isNum(c.lat) && isNum(c.fuel) && isNum(c.hp));
      if (!Array.isArray(c.weapons)) c.weapons = [];
      while (c.weapons.length < (def.weapons | 0)) c.weapons.push(null);
      for (const w of c.weapons) need(w === null || (isObj(w) && !!Data.craftWeapons[w.type] && (w.ammo === null || isInt(w.ammo))));
      need(Array.isArray(c.soldiers));
      if (!isObj(c.equipment)) c.equipment = {};
      if (!isInt(c.acquiredT)) c.acquiredT = null;
      c.dogfightId = null;
      if (c.dest !== null && c.dest !== undefined) need(isObj(c.dest) && isStr(c.dest.kind));
      else c.dest = null;
    }
    for (const b of G.bases) for (const cid of b.crafts) need(!!G.crafts[cid] && G.crafts[cid].baseId === b.id);
    // soldados
    const statKeys = Data.soldierGen && Data.soldierGen.statKeys;
    for (const id of Object.keys(G.soldiers)) {
      const s = G.soldiers[id];
      need(isObj(s.stats) && !!baseIds[s.baseId] && baseIds[s.baseId].soldiers.indexOf(id) >= 0 && isInt(s.rank) && isInt(s.woundDays));
      if (Array.isArray(statKeys)) for (const k of statKeys) need(isNum(s.stats[k]));
      if (!isObj(s.loadout)) s.loadout = Camp.emptyLoadout();
      if (!Array.isArray(s.loadout.belt)) s.loadout.belt = [];
      if (!Array.isArray(s.loadout.pack)) s.loadout.pack = [];
      if (s.craftId === undefined) s.craftId = null;
      if (s.craftId !== null) need(!!G.crafts[s.craftId] && G.crafts[s.craftId].soldiers.indexOf(id) >= 0);
    }
    for (const b of G.bases) for (const sid of b.soldiers) need(!!G.soldiers[sid]);
    // estratégia alienígena
    for (const u of G.ufos) need(isObj(u) && isStr(u.id) && !!Data.ufos[u.type] && !!UFO_STATUS[u.status] && isNum(u.lon) && isNum(u.lat) && isInt(u.dmg));
    for (const m of G.alienMissions) need(isObj(m) && isStr(m.id) && !!Data.alienMissions[m.type] && Array.isArray(m.liveUfos) && isNum(m.countdownS));
    for (const x of G.sites) need(isObj(x) && isStr(x.id) && isNum(x.lon) && isNum(x.lat) && isNum(x.leftS));
    for (const x of G.alienBases) need(isObj(x) && isStr(x.id) && isNum(x.lon) && isNum(x.lat));
    for (const r of G.history.concat(G.reports)) need(isObj(r));
  }

  // todos os passos do relógio (contrato §3.1) numa cópia: um G que os rebente nunca chega ao Geoscape
  const SMOKE = [['World', 'moveCrafts'], ['World', 'moveUfos'], ['World', 'contacts'], ['World', 'burnFuel'], ['World', 'patrolDiscovery'],
    ['Missions', 'scan10m'], ['BaseSim', 'halfHourly'], ['World', 'detect'], ['Economy', 'ufoActivity30m'], ['Missions', 'think30m'],
    ['BaseSim', 'hourly'], ['BaseSim', 'daily'], ['Soldiers', 'daily'], ['Economy', 'daily'], ['Missions', 'daily'], ['Missions', 'monthEnd'],
    ['Economy', 'monthEnd'], ['Economy', 'checkDefeat'], ['Economy', 'upkeep'], ['World', 'radarCircles']];
  function smoke(G) {
    try {
      const S = JSON.parse(JSON.stringify(G));
      OV.Campaign.rebuildDerived(S);
      S.events = [];
      for (const b of S.bases) {
        if (OV.BaseSim) OV.BaseSim.capacities(S, b.id);
        if (OV.BaseSim && typeof OV.BaseSim.staff === 'function') OV.BaseSim.staff(S, b.id);
      }
      for (const [mod, fn] of SMOKE) if (OV[mod] && typeof OV[mod][fn] === 'function') OV[mod][fn](S);
      OV.Campaign.hash(S);
    } catch (e) {
      throw err('parse');
    }
  }

  function fromJSON(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw err('parse');
    if (input.game !== GAME) throw err('game');
    if (!Number.isInteger(input.schema) || input.schema < 1 || input.schema > SCHEMA) throw err('schema');
    let obj;
    try {
      obj = JSON.parse(JSON.stringify(input));
    } catch (e) {
      throw err('parse');
    }
    obj = migrate(obj);
    if (obj.campaign === undefined || obj.battle === undefined || (obj.campaign === null && obj.battle === null)) throw err('parse');
    let G = null, B = null;
    if (obj.campaign !== null) {
      checkCampaign(obj.campaign);
      G = obj.campaign;
      G.schema = SCHEMA;
      repairCampaign(G);
      if (G.ui === undefined || G.ui === null || typeof G.ui !== 'object' || Array.isArray(G.ui)) G.ui = {};
      if (G.debug === undefined) G.debug = null;
      // missão marcada sem batalha gravada (gravado no briefing): a batalha nunca começou, o Geoscape tem de andar
      if (G.activeMission === undefined || (G.activeMission && obj.battle === null)) G.activeMission = null;
      G.events = [];
      OV.Campaign.rebuildDerived(G);
      smoke(G);
    }
    if (obj.battle !== null) {
      const raw = obj.battle;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw err('parse');
      if (OV.Battle.SCHEMA !== undefined && raw.schema !== OV.Battle.SCHEMA) throw err('schema');
      try {
        B = OV.Battle.deserialize(raw);
      } catch (e) {
        throw err('parse');
      }
      if (!B || !B.map || !Array.isArray(B.units) || !B.mission) throw err('parse');
    }
    const meta = { label: obj.label === undefined ? null : obj.label, savedAt: obj.savedAt || null, build: obj.build === undefined ? null : obj.build };
    return { G, B, meta };
  }

  // ---- ranhuras -----------------------------------------------------------------------------------------------
  function write(slot, obj) {
    if (!validSlot(slot)) return { ok: false, reason: 'slot' };
    const st = storage();
    if (!st) return { ok: false, reason: 'unavailable' };
    let text;
    try {
      text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    } catch (e) {
      return { ok: false, reason: 'unavailable' };
    }
    try {
      st.setItem(KEY(slot), text);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: isQuota(e) ? 'quota' : 'unavailable' };
    }
  }
  function readText(slot) {
    const st = storage();
    if (!st || !validSlot(slot)) return null;
    try {
      const v = st.getItem(KEY(slot));
      return typeof v === 'string' && v.length ? v : null;
    } catch (e) {
      return null;
    }
  }
  function read(slot) {
    const text = readText(slot);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }
  function remove(slot) {
    const st = storage();
    if (!st || !validSlot(slot)) return false;
    try {
      st.removeItem(KEY(slot));
      return true;
    } catch (e) {
      return false;
    }
  }
  function save(slot, G, B, meta) {
    let obj;
    try {
      obj = toJSON(G, B, meta);
    } catch (e) {
      return { ok: false, reason: String(e && e.message).replace('save.err.', '') || 'unavailable' };
    }
    return write(slot, obj);
  }

  const gameDate = (t) => {
    const d = OV.U.dateOf(t | 0);
    return d.y + '-' + OV.U.pad2(d.m + 1) + '-' + OV.U.pad2(d.d);
  };
  // resumo de uma gravação para as listas (sem desserializar a batalha)
  function summary(slot, obj) {
    const G = obj && obj.campaign;
    const B = obj && obj.battle;
    const ok = !!obj && obj.game === GAME && (G || B);
    if (!ok) return { slot, label: null, savedAt: null, t: null, date: null, month: null, funds: null, difficulty: null, battle: false, corrupt: true };
    return {
      slot, label: typeof obj.label === 'string' ? obj.label : null, savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : null,
      t: G && Number.isFinite(G.t) ? G.t : null, date: G && Number.isFinite(G.t) ? gameDate(G.t) : null,
      month: G && Number.isFinite(G.month) ? G.month : B && B.mission ? B.mission.month | 0 : null,
      funds: G && Number.isFinite(G.funds) ? G.funds : null, difficulty: G ? G.difficulty | 0 : B && B.mission ? B.mission.difficulty | 0 : null,
      battle: !!B, schema: obj.schema,
    };
  }
  function list() {
    const out = [];
    for (const slot of SLOTS) {
      const text = readText(slot);
      if (text === null) continue;
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        obj = null;
      }
      out.push(summary(slot, obj));
    }
    return out;
  }
  function load(slot) {
    const text = readText(slot);
    if (text === null) return null;
    return importFile(text);
  }

  // ---- ficheiros ------------------------------------------------------------------------------------------------
  function exportFile(x) {
    const obj = x && x.game === GAME && x.campaign === undefined && x.battle === undefined ? toJSON(x) : x;
    if (!obj || obj.game !== GAME) throw err('game');
    const t = obj.campaign && Number.isFinite(obj.campaign.t) ? obj.campaign.t : null;
    const day = t !== null ? gameDate(t) : String(obj.savedAt || new Date().toISOString()).slice(0, 10);
    const filename = 'ovni1999-' + day + '.json';
    return { filename, name: filename, mime: 'application/json', text: JSON.stringify(obj) };
  }
  function importFile(text) {
    if (typeof text !== 'string' || !text.length || text.length > MAX_TEXT) throw err('parse');
    let obj;
    try {
      obj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      throw err('parse');
    }
    return fromJSON(obj);
  }

  OV.Save = {
    SCHEMA, SLOTS, KEY, MIGRATIONS,
    toJSON, fromJSON, migrate, write, read, remove, save, list, slots: list, load, exportFile, importFile, setStorage,
  };
})(globalThis.OV || (globalThis.OV = {}));
