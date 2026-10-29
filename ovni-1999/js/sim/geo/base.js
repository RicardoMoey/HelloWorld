/* Bases X-COM: instalações, pessoal, mercado, investigação, fabrico e manutenção das naves
   (DESIGN.md §3.13–§3.16, §13; REA 02-geoscape §7, §8.2, §10, §11; contrato docs/CAMPAIGN_API.md §1.8, §1.10, §5.6).
   OV.BaseSim = {
     capacities(G, baseId) → {personnel, labs, workshops, storage, aliens, crafts:{cap,used}, radars, defences, hyper, upkeep}
     staff(G, baseId) → {soldiers, scientists:{total,free}, engineers:{total,free}}
     canPlace(G, baseId, type, x, y) → reason|null ; build(G, baseId, type, x, y) → {ok, reason}
     canDismantle(G, baseId, x, y) → reason|null ; dismantle(G, baseId, x, y) → {ok, reason}
     canHire / hire(G, baseId, kind, n) ; sack(G, baseId, kind, nOrSoldierId)
     canBuy / buy(G, baseId, itemIdOrCraftType, n) ; sell(G, baseId, itemId, n)
     canSellCraft(G, craftId) → reason|null ('noCraft'|'away'|'crew') ; sellCraft(G, craftId) → {ok, price}|{ok:false, reason}
     moveCargo(G, craftId, itemId, n) ; setArmour(G, soldierId, armourId) ; assignSoldier(G, soldierId, craftId|null)
     fitWeapon(G, craftId, slot, weaponType|null) ; checkup(G, craftId) → estado ; serviceStatus(G, craftId) → estado (puro)
     renameBase / renameCraft
     startResearch(G, baseId, topic, scientists) ; setScientists ; cancelResearch ; researchLabel(G, baseId, topic) → chave
     startProduction(G, baseId, item, engineers, qty) ; setEngineers ; setQty ; cancelProduction
     halfHourly(G) ; hourly(G) ; daily(G) ; completeResearch(G, baseId, topic) }
   Mutações devolvem {ok:true} ou {ok:false, reason}; a UI mostra T('base.err.' + reason).
   Regra R1: sem DOM; só a stream geo (custo aleatório da investigação, recrutas entregues). */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const GRID = 6;
  const OK = Object.freeze({ ok: true });
  const fail = (reason) => ({ ok: false, reason });
  const HANGAR_STATUS = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  const PERSONNEL = { soldier: 'SOLDIER', scientist: 'SCIENTIST', engineer: 'ENGINEER' };
  const SLOTS = ['R', 'L', 'belt', 'pack'];
  const NAME_MAX = 24;

  const isInt = (n) => Number.isInteger(n);
  const inHangar = (craft) => !!craft && HANGAR_STATUS[craft.status] === 1;
  const researched = (G, id) => !id || G.researched.indexOf(id) >= 0;
  const debug = (G, k) => !!(G.debug && G.debug[k]);

  // ---- armazém -------------------------------------------------------------------------------------------
  function add(stores, id, n) {
    if (!(n > 0)) return;
    stores[id] = (stores[id] | 0) + n;
  }
  function take(stores, id, n) {
    const have = stores[id] | 0;
    const k = Math.min(have, n);
    if (k <= 0) return 0;
    if (have - k > 0) stores[id] = have - k;
    else delete stores[id];
    return k;
  }
  // espaço de armazém em décimas (Data.items[id].storage é 0,1 … 6)
  function tenths(id, n) {
    const it = D().items[id];
    const s = it && Number.isFinite(it.storage) ? it.storage : 0.1;
    return Math.round(s * 10) * n;
  }

  // ---- grelha ----------------------------------------------------------------------------------------------
  const cells = (f) => D().facilityCells(f.type, f.x, f.y);
  function facilityAt(base, x, y) {
    for (let k = 0; k < base.grid.length; k++) {
      for (const [cx, cy] of cells(base.grid[k])) if (cx === x && cy === y) return k;
    }
    return -1;
  }
  const built = (f) => (f.daysLeft | 0) === 0;

  // modelos de equipamento dos soldados de uma nave (multiconjunto)
  function templates(G, craft, exceptId) {
    const out = {};
    for (const sid of craft.soldiers) {
      if (sid === exceptId) continue;
      const s = C().findSoldier(G, sid);
      if (!s || !s.loadout) continue;
      for (const slot of SLOTS) {
        const v = s.loadout[slot];
        for (const it of Array.isArray(v) ? v : v ? [v] : []) out[it] = (out[it] | 0) + 1;
      }
    }
    return out;
  }
  // carga solta = equipamento − Σ modelos
  function loose(G, craft, exceptId) {
    const tpl = templates(G, craft, exceptId);
    const out = {};
    for (const id in craft.equipment) {
      const n = (craft.equipment[id] | 0) - (tpl[id] | 0);
      if (n > 0) out[id] = n;
    }
    return out;
  }

  // ---- capacidades (só instalações concluídas contam, orig) ------------------------------------------------
  function capacitiesOf(G, base, grid) {
    const Data = D();
    const cap = { personnel: 0, labs: 0, workshops: 0, storage: 0, aliens: 0, crafts: 0 };
    const radars = [], defences = [];
    let hyper = false;
    for (const f of grid) {
      if (!built(f)) continue;
      const def = Data.facilities[f.type];
      if (!def) continue;
      cap.personnel += def.personnel;
      cap.labs += def.labs;
      cap.workshops += def.workshops;
      cap.storage += def.storage;
      cap.aliens += def.aliens;
      cap.crafts += def.crafts;
      if (def.radarRange > 0) radars.push({ type: f.type, rangeNm: def.radarRange, chance: def.radarChance });
      if (def.defence > 0) defences.push({ type: f.type, power: def.defence, hit: def.hitRatio });
      if (def.hyper) hyper = true;
    }
    let personnel = base.soldiers.length + (base.scientists | 0) + (base.engineers | 0);
    let crafts = base.crafts.length;
    let store = 0;
    for (const id in base.stores) store += tenths(id, base.stores[id] | 0);
    for (const cid of base.crafts) {
      const c = C().findCraft(G, cid);
      if (c) for (const id in c.equipment) store += tenths(id, c.equipment[id] | 0);
    }
    for (const dl of base.deliveries.concat(base.transfers || [])) {
      if (PERSONNEL[dl.kind]) personnel += dl.n;
      else if (dl.kind === 'craft') crafts += dl.n;
      else if (dl.kind === 'item') store += tenths(dl.itemId, dl.n);
    }
    let labs = 0, shops = 0, aliens = 0;
    for (const p of base.research) labs += p.scientists | 0;
    for (const p of base.production) shops += (p.engineers | 0) + (Data.manufacture[p.item] ? Data.manufacture[p.item].space : 0);
    for (const k in base.aliens) aliens += base.aliens[k] | 0;
    return {
      personnel: { cap: cap.personnel, used: personnel },
      labs: { cap: cap.labs, used: labs },
      workshops: { cap: cap.workshops, used: shops },
      storage: { cap: cap.storage, used: store / 10, usedTenths: store },
      aliens: { cap: cap.aliens, used: aliens },
      crafts: { cap: cap.crafts, used: crafts },
      radars, defences, hyper,
      upkeep: OV.Economy.baseUpkeep(G, base).total,
    };
  }
  function capacities(G, baseId) {
    const base = C().findBase(G, baseId);
    return base ? capacitiesOf(G, base, base.grid) : null;
  }

  function staff(G, baseId) {
    const base = C().findBase(G, baseId);
    if (!base) return null;
    let sci = 0, eng = 0;
    for (const p of base.research) sci += p.scientists | 0;
    for (const p of base.production) eng += p.engineers | 0;
    return {
      soldiers: base.soldiers.length,
      scientists: { total: base.scientists | 0, free: (base.scientists | 0) - sci },
      engineers: { total: base.engineers | 0, free: (base.engineers | 0) - eng },
    };
  }

  // hangares livres, descontando naves em fabrico já pagas
  function freeHangars(G, base, exceptProdId) {
    const cap = capacitiesOf(G, base, base.grid).crafts;
    let reserved = 0;
    for (const p of base.production) {
      const m = D().manufacture[p.item];
      if (m && m.produces.craft && p.paid && p.id !== exceptProdId) reserved++;
    }
    return cap.cap - cap.used - reserved;
  }

  // ---- construção ------------------------------------------------------------------------------------------
  function canPlace(G, baseId, type, x, y) {
    const base = C().findBase(G, baseId);
    const def = D().facilities[type];
    if (!base || !def) return 'unavailable';
    if (def.research && !researched(G, def.research)) return 'research';
    if (def.lift && base.grid.some((f) => D().facilities[f.type] && D().facilities[f.type].lift)) return 'lift';
    const mine = D().facilityCells(type, x, y);
    for (const [cx, cy] of mine) if (!isInt(cx) || !isInt(cy) || cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) return 'cells';
    for (const [cx, cy] of mine) if (facilityAt(base, cx, cy) >= 0) return 'overlap';
    if (!def.lift || base.grid.length) {
      // ligação ortogonal a uma instalação existente (concluída ou em obra — todas estão ligadas ao elevador)
      let touch = false;
      for (const [cx, cy] of mine) {
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && facilityAt(base, nx, ny) >= 0) touch = true;
        }
      }
      if (!touch) return 'notConnected';
    }
    if (G.funds < def.cost) return 'funds';
    return null;
  }

  function build(G, baseId, type, x, y) {
    const r = canPlace(G, baseId, type, x, y);
    if (r) return fail(r);
    const base = C().findBase(G, baseId);
    const def = D().facilities[type];
    G.funds -= def.cost;
    const f = { type, x, y, daysLeft: debug(G, 'instantBuild') ? 0 : def.days };
    base.grid.push(f);
    if (f.daysLeft === 0) C().event(G, 'facilityDone', { baseId, type, x, y });
    return { ok: true, facility: f };
  }

  function canDismantle(G, baseId, x, y) {
    const base = C().findBase(G, baseId);
    if (!base) return 'unavailable';
    const k = facilityAt(base, x, y);
    if (k < 0) return 'empty';
    const f = base.grid[k];
    if (D().facilities[f.type].lift) return 'lift';
    const rest = base.grid.filter((_, j) => j !== k);
    if (!D().gridConnected(rest).ok) return 'notConnected';
    if (built(f)) {
      // só as capacidades que esta instalação dá (armazém já cheio demais não bloqueia um laboratório vazio)
      const def = D().facilities[f.type];
      const c = capacitiesOf(G, base, rest);
      for (const key of ['personnel', 'labs', 'workshops', 'aliens']) if (def[key] > 0 && c[key].used > c[key].cap) return 'inUse';
      if (def.crafts > 0) {
        // naves em fabrico já pagas reservam um hangar (como freeHangars)
        let reserved = 0;
        for (const p of base.production) {
          const m = D().manufacture[p.item];
          if (m && m.produces.craft && p.paid) reserved++;
        }
        if (c.crafts.used + reserved > c.crafts.cap) return 'inUse';
      }
      if (def.storage > 0 && c.storage.usedTenths > c.storage.cap * 10) return 'inUse';
    }
    return null;
  }
  function dismantle(G, baseId, x, y) {
    const r = canDismantle(G, baseId, x, y);
    if (r) return fail(r);
    const base = C().findBase(G, baseId);
    base.grid.splice(facilityAt(base, x, y), 1);
    return OK;
  }

  // ---- pessoal ---------------------------------------------------------------------------------------------
  const hireCost = (kind) => tune(PERSONNEL[kind] + '_HIRE', { soldier: 40000, scientist: 30000, engineer: 25000 }[kind]);

  function canHire(G, baseId, kind, n) {
    const base = C().findBase(G, baseId);
    if (!base) return 'unavailable';
    if (!PERSONNEL[kind]) return 'unavailable';
    if (!isInt(n) || n < 1) return 'count';
    const cap = capacitiesOf(G, base, base.grid).personnel;
    if (cap.used + n > cap.cap) return 'quarters';
    if (G.funds < hireCost(kind) * n) return 'funds';
    return null;
  }
  function hire(G, baseId, kind, n) {
    const r = canHire(G, baseId, kind, n);
    if (r) return fail(r);
    const base = C().findBase(G, baseId);
    G.funds -= hireCost(kind) * n;
    const dl = { id: C().nextId(G, 'dl'), kind, itemId: null, n, etaT: G.t + tune('DELIVERY_PERSONNEL_H', 48) * 3600 };
    base.deliveries.push(dl);
    return { ok: true, delivery: dl };
  }

  // devolve ao armazém o que o modelo do soldado ocupa a bordo (nave no hangar)
  function unloadTemplate(G, base, craft, s) {
    if (!craft || !inHangar(craft) || !s.loadout) return;
    for (const slot of SLOTS) {
      const v = s.loadout[slot];
      for (const it of Array.isArray(v) ? v : v ? [v] : []) add(base.stores, it, take(craft.equipment, it, 1));
    }
  }

  function sack(G, baseId, kind, what) {
    const base = C().findBase(G, baseId);
    if (!base || !PERSONNEL[kind]) return fail('unavailable');
    if (kind === 'soldier') {
      const s = C().findSoldier(G, what);
      if (!s || s.baseId !== baseId) return fail('noSoldier');
      const craft = s.craftId ? C().findCraft(G, s.craftId) : null;
      if (craft && !inHangar(craft)) return fail('away');
      if (craft) {
        unloadTemplate(G, base, craft, s);
        C().removeById(craft.soldiers, s.id);
      }
      const arm = D().armours[s.armour];
      if (arm && arm.storeItem) add(base.stores, arm.storeItem, 1);
      C().removeById(base.soldiers, s.id);
      delete G.soldiers[s.id];
      return OK;
    }
    const n = what;
    if (!isInt(n) || n < 1) return fail('count');
    const st = staff(G, baseId);
    const free = kind === 'scientist' ? st.scientists.free : st.engineers.free;
    if (n > free) return fail('busy');
    if (kind === 'scientist') base.scientists -= n;
    else base.engineers -= n;
    return OK;
  }

  // ---- mercado ---------------------------------------------------------------------------------------------
  function canBuy(G, baseId, id, n) {
    const base = C().findBase(G, baseId);
    if (!base) return 'unavailable';
    if (!isInt(n) || n < 1) return 'count';
    const cdef = D().crafts[id];
    if (cdef) {
      if (!(cdef.buy > 0) || !researched(G, cdef.requires)) return 'unavailable';
      if (freeHangars(G, base) < n) return 'hangar';
      if (G.funds < cdef.buy * n) return 'funds';
      return null;
    }
    const it = D().items[id];
    if (!it || !(it.buy > 0) || it.mvp === false || !researched(G, it.research)) return 'unavailable';
    const st = capacitiesOf(G, base, base.grid).storage;
    if (st.usedTenths + tenths(id, n) > st.cap * 10) return 'storage';
    if (G.funds < it.buy * n) return 'funds';
    return null;
  }
  function buy(G, baseId, id, n) {
    const r = canBuy(G, baseId, id, n);
    if (r) return fail(r);
    const base = C().findBase(G, baseId);
    const cdef = D().crafts[id];
    let dl;
    if (cdef) {
      G.funds -= cdef.buy * n;
      dl = { id: C().nextId(G, 'dl'), kind: 'craft', itemId: id, n, etaT: G.t + (cdef.deliveryH | 0) * 3600 };
    } else {
      const it = D().items[id];
      G.funds -= it.buy * n;
      const h = it.deliveryH > 0 ? it.deliveryH : tune('DELIVERY_ITEMS_H', 24);
      dl = { id: C().nextId(G, 'dl'), kind: 'item', itemId: id, n, etaT: G.t + h * 3600 };
    }
    base.deliveries.push(dl);
    return { ok: true, delivery: dl };
  }

  // venda imediata; alienígenas vivos nunca (Data.liveAliensSellable)
  function sell(G, baseId, id, n) {
    const base = C().findBase(G, baseId);
    if (!base) return fail('unavailable');
    if (!isInt(n) || n < 1) return fail('count');
    if (base.aliens[id] && !D().liveAliensSellable) return fail('unsellable');
    const it = D().items[id];
    if (!it || !(it.sell > 0)) return fail('unsellable');
    if ((base.stores[id] | 0) < n) return fail('stock');
    take(base.stores, id, n);
    G.funds += it.sell * n;
    return OK;
  }

  /* Venda de uma nave (orig: preço de venda; só no hangar, sem dogfight nem missão, sem soldados a bordo).
     As armas montadas (e as munições carregadas, em carregadores inteiros) e a carga voltam ao armazém; o aluguer
     acaba e o hangar fica livre. Sem penalização de pontuação. */
  function canSellCraft(G, craftId) {
    const craft = C().findCraft(G, craftId);
    if (!craft) return 'noCraft';
    const base = C().findBase(G, craft.baseId);
    if (!base || !inHangar(craft) || craft.dogfightId) return 'away';
    if (G.activeMission && G.activeMission.craftId === craftId) return 'away';
    if (craft.soldiers.length) return 'crew';
    return null;
  }
  function sellCraft(G, craftId) {
    const r = canSellCraft(G, craftId);
    if (r) return fail(r);
    const craft = C().findCraft(G, craftId);
    const base = C().findBase(G, craft.baseId);
    for (const w of craft.weapons) {
      if (!w) continue;
      add(base.stores, w.type, 1);
      const cd = D().craftWeapons[w.type];
      if (cd && cd.ammoItem && w.ammo > 0) add(base.stores, cd.ammoItem, U.idiv(w.ammo, cd.ammoPerItem || 1));
    }
    for (const id in craft.equipment) add(base.stores, id, craft.equipment[id] | 0);
    const price = D().crafts[craft.type].sell | 0;
    G.funds += price;
    C().removeById(base.crafts, craftId);
    delete G.crafts[craftId];
    return { ok: true, price };
  }

  // ---- naves e soldados ------------------------------------------------------------------------------------
  // carga solta: n > 0 armazém → nave, n < 0 nave → armazém (nave no hangar da sua base)
  function moveCargo(G, craftId, id, n) {
    const craft = C().findCraft(G, craftId);
    if (!craft) return fail('noCraft');
    const base = C().findBase(G, craft.baseId);
    if (!inHangar(craft) || !base) return fail('away');
    if (!isInt(n)) return fail('count');
    if (n === 0) return OK;
    const it = D().items[id];
    if (!it || it.battle === false) return fail('unavailable');
    if (n > 0) {
      if ((base.stores[id] | 0) < n) return fail('stock');
      take(base.stores, id, n);
      add(craft.equipment, id, n);
      return OK;
    }
    if ((loose(G, craft)[id] | 0) < -n) return fail('inUse');
    take(craft.equipment, id, -n);
    add(base.stores, id, -n);
    return OK;
  }

  function setArmour(G, soldierId, armourId) {
    const s = C().findSoldier(G, soldierId);
    if (!s) return fail('noSoldier');
    const a = D().armours[armourId];
    if (!a || !researched(G, a.research)) return fail('unavailable');
    const base = C().findBase(G, s.baseId);
    const craft = s.craftId ? C().findCraft(G, s.craftId) : null;
    if (!base || (craft && !inHangar(craft))) return fail('away');
    if (s.armour === armourId) return OK;
    if (a.storeItem && (base.stores[a.storeItem] | 0) < 1) return fail('stock');
    if (a.storeItem) take(base.stores, a.storeItem, 1);
    const old = D().armours[s.armour];
    if (old && old.storeItem) add(base.stores, old.storeItem, 1);
    s.armour = armourId;
    return OK;
  }

  /* Lugar numa nave (ou null para sair). Ao sair, o modelo volta ao armazém; ao entrar, o modelo é apoiado pela
     carga solta da nave e depois pelo armazém; o que faltar sai do modelo (invariante do equipamento, §1.10). */
  function assignSoldier(G, soldierId, craftId) {
    const s = C().findSoldier(G, soldierId);
    if (!s) return fail('noSoldier');
    const base = C().findBase(G, s.baseId);
    if (!base) return fail('away');
    const old = s.craftId ? C().findCraft(G, s.craftId) : null;
    if (old && !inHangar(old)) return fail('away');
    if (craftId === null || craftId === undefined) {
      if (old) {
        unloadTemplate(G, base, old, s);
        C().removeById(old.soldiers, s.id);
      }
      s.craftId = null;
      return OK;
    }
    const craft = C().findCraft(G, craftId);
    if (!craft) return fail('noCraft');
    if (craft.baseId !== s.baseId) return fail('base');
    if (!inHangar(craft)) return fail('away');
    if ((s.woundDays | 0) > 0) return fail('wounded');
    if (old === craft) return OK;
    if (craft.soldiers.length >= (D().crafts[craft.type].seatsUI | 0)) return fail('seats');
    if (old) {
      unloadTemplate(G, base, old, s);
      C().removeById(old.soldiers, s.id);
    }
    const free = loose(G, craft);
    const lo = s.loadout || C().emptyLoadout();
    const backed = (it) => {
      if ((free[it] | 0) > 0) {
        free[it]--;
        return true;
      }
      if ((base.stores[it] | 0) > 0) {
        take(base.stores, it, 1);
        add(craft.equipment, it, 1);
        return true;
      }
      return false;
    };
    const nl = { R: lo.R && backed(lo.R) ? lo.R : null, L: lo.L && backed(lo.L) ? lo.L : null, belt: [], pack: [] };
    for (const slot of ['belt', 'pack']) for (const it of lo[slot] || []) if (backed(it)) nl[slot].push(it);
    s.loadout = nl;
    craft.soldiers.push(s.id);
    s.craftId = craft.id;
    return OK;
  }

  // ---- manutenção das naves (reparar → rearmar → reabastecer → pronta) -------------------------------------
  function needsAmmo(w) {
    if (!w || w.ammo === null) return false;
    const wd = D().craftWeapons[w.type];
    return !!wd && wd.ammoMax !== null && w.ammo < wd.ammoMax;
  }
  // primeiro serviço necessário a partir da etapa `from` (0 reparar, 1 rearmar, 2 reabastecer): definição única nos dados
  const nextStatus = (craft, from) => D().craftServiceStatus(craft, from);
  function setService(G, craft, status) {
    const was = craft.status;
    craft.status = status;
    if (status === 'ready' && was !== 'ready') C().event(G, 'craftReady', { craftId: craft.id });
  }
  // serviço de que a nave precisa agora (puro, sem mudar nada) → 'repair'|'rearm'|'refuel'|'ready'
  function serviceStatus(G, craftId) {
    const craft = C().findCraft(G, craftId);
    return craft ? nextStatus(craft, 0) : null;
  }
  // estado de manutenção de uma nave no hangar (sem eventos) → estado; definição única (o World usa-a ao aterrar)
  function checkup(G, craftId) {
    const craft = C().findCraft(G, craftId);
    if (!craft) return null;
    craft.status = nextStatus(craft, 0);
    return craft.status;
  }

  function fitWeapon(G, craftId, slot, type) {
    const craft = C().findCraft(G, craftId);
    if (!craft) return fail('noCraft');
    const def = D().crafts[craft.type];
    const base = C().findBase(G, craft.baseId);
    if (!isInt(slot) || slot < 0 || slot >= (def.weapons | 0)) return fail('slot');
    if (!inHangar(craft) || !base) return fail('away');
    const cur = craft.weapons[slot] || null;
    let wd = null;
    if (type) {
      wd = D().craftWeapons[type];
      if (!wd || wd.mvp === false) return fail('unavailable');
      if (cur && cur.type === type) return OK;
      if ((base.stores[type] | 0) < 1) return fail('stock');
    }
    if (cur) {
      add(base.stores, cur.type, 1);
      const cd = D().craftWeapons[cur.type];
      if (cd && cd.ammoItem && cur.ammo > 0) add(base.stores, cd.ammoItem, U.idiv(cur.ammo, cd.ammoPerItem || 1));
    }
    if (type) {
      take(base.stores, type, 1);
      craft.weapons[slot] = { type, ammo: wd.ammoMax === null ? null : 0 };
    } else {
      craft.weapons[slot] = null;
    }
    if (craft.status !== 'repair') craft.status = nextStatus(craft, 0);
    return OK;
  }

  function repair(G, craft) {
    const def = D().crafts[craft.type];
    craft.hp = Math.min(def.hp, craft.hp + tune('CRAFT_REPAIR_HP_H', D().craftRules.repairHpPerHour || 5));
    if (craft.hp >= def.hp) setService(G, craft, nextStatus(craft, 1));
  }

  /* CraftWeapon::rearm (orig): até rearmPerHour munições por hora em carregadores inteiros do armazém. Uma arma sem
     munição em armazém fica como está e é avisada uma só vez, quando o rearme das outras acaba (orig: avisa e deixa
     de a rearmar); a entrega de munição de nave volta a pôr a nave a rearmar (arrive). */
  function rearm(G, base, craft) {
    let pending = false;
    const short = [];
    for (const w of craft.weapons) {
      if (!needsAmmo(w)) continue;
      const wd = D().craftWeapons[w.type];
      if (!wd.ammoItem) {
        w.ammo = wd.ammoMax;
        continue;
      }
      const avail = base.stores[wd.ammoItem] | 0;
      if (avail <= 0) {
        if (short.indexOf(wd.ammoItem) < 0) short.push(wd.ammoItem);
        continue;
      }
      const clip = wd.ammoPerItem || 1;
      const need = U.idiv(Math.min(wd.rearmPerHour, wd.ammoMax - w.ammo + clip - 1), clip);
      const use = Math.min(need, avail);
      take(base.stores, wd.ammoItem, use);
      w.ammo = Math.min(wd.ammoMax, w.ammo + use * clip);
      if (w.ammo < wd.ammoMax) pending = true;
    }
    if (pending) return;
    for (const itemId of short) C().event(G, 'craftRearmShort', { craftId: craft.id, itemId, what: 'ammo' });
    setService(G, craft, nextStatus(craft, 2));
  }

  function refuel(G, base, craft) {
    const def = D().crafts[craft.type];
    if (def.refuelItem) {
      if ((base.stores[def.refuelItem] | 0) < 1) {
        C().event(G, 'craftRearmShort', { craftId: craft.id, itemId: def.refuelItem, what: 'fuel' });
        setService(G, craft, 'ready');
        return;
      }
      take(base.stores, def.refuelItem, 1);
    }
    craft.fuel = Math.min(def.fuel, craft.fuel + def.refuel);
    if (craft.fuel >= def.fuel) setService(G, craft, 'ready');
  }

  function renameBase(G, baseId, name) {
    const b = C().findBase(G, baseId);
    if (!b) return fail('unavailable');
    const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    b.name = n || null;
    return OK;
  }
  function renameCraft(G, craftId, name) {
    const c = C().findCraft(G, craftId);
    if (!c) return fail('noCraft');
    const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    c.name = n || null;
    return OK;
  }

  // ---- investigação ----------------------------------------------------------------------------------------
  const runningAnywhere = (G, topic) => G.bases.some((b) => b.research.some((p) => p.topic === topic));
  function availResearch(G, base) {
    if (typeof C().availableResearch === 'function') return C().availableResearch(G, base.id);
    return D().researchAvailable(G.researched, G.flags, base.stores, base.aliens).filter((id) => !runningAnywhere(G, id));
  }
  function availManufacture(G, base) {
    if (typeof C().availableManufacture === 'function') return C().availableManufacture(G, base.id);
    return D().manufactureAvailable(G.researched);
  }
  const findProject = (base, topic) => base.research.find((p) => p.topic === topic) || null;

  function startResearch(G, baseId, topicId, scientists) {
    const base = C().findBase(G, baseId);
    const topic = D().researchTopic(topicId);
    if (!base || !topic) return fail('unavailable');
    if (runningAnywhere(G, topicId)) return fail('busy');
    if (D().researchAvailable(G.researched, G.flags, base.stores, base.aliens).indexOf(topicId) < 0) return fail('unavailable');
    const n = scientists === undefined ? 0 : scientists;
    if (!isInt(n) || n < 0) return fail('count');
    const st = staff(G, baseId);
    if (n > st.scientists.free) return fail('scientists');
    const labs = capacitiesOf(G, base, base.grid).labs;
    if (labs.cap <= 0 || labs.used + n > labs.cap) return fail('labs');
    const live = topic.consumes && topic.consumes.liveAlien;
    if (live && (base.aliens[live] | 0) < 1) return fail('unavailable');
    // consumo (orig): 1 item de needItem do armazém, ou o alienígena vivo do interrogatório
    const item = D().researchConsumable(topicId, base.stores);
    if (item) take(base.stores, item, 1);
    if (live) take(base.aliens, live, 1);
    const pct = D().researchRules.costRandPct;
    const cost = Math.max(1, U.idiv(topic.cost * C().rng(G, 'geo').int(pct[0], pct[1]), 100));
    const p = { topic: topicId, cost, spent: 0, scientists: n };
    base.research.push(p);
    return { ok: true, project: p };
  }

  function setScientists(G, baseId, topicId, n) {
    const base = C().findBase(G, baseId);
    const p = base ? findProject(base, topicId) : null;
    if (!p) return fail('unavailable');
    if (!isInt(n) || n < 0) return fail('count');
    if (n - p.scientists > staff(G, baseId).scientists.free) return fail('scientists');
    const labs = capacitiesOf(G, base, base.grid).labs;
    if (labs.used - p.scientists + n > labs.cap) return fail('labs');
    p.scientists = n;
    return OK;
  }

  // cancelar não devolve o item consumido (orig); ours: o alienígena de um interrogatório volta à contenção
  // (mesmo sem lugar livre — estava lá quando o projeto começou)
  function cancelResearch(G, baseId, topicId) {
    const base = C().findBase(G, baseId);
    const p = base ? findProject(base, topicId) : null;
    if (!p) return fail('unavailable');
    base.research.splice(base.research.indexOf(p), 1);
    const topic = D().researchTopic(topicId);
    const live = topic && topic.consumes && topic.consumes.liveAlien;
    if (live) add(base.aliens, live, 1);
    return { ok: true, returned: live || null };
  }

  function researchLabel(G, baseId, topicId) {
    const base = C().findBase(G, baseId);
    const p = base ? findProject(base, topicId) : null;
    return p ? D().progressLabelKey(p.cost, p.spent, p.scientists) : 'research.progress.none';
  }

  /* Conclusão (caminho único, contrato §5.6): efeitos calculados antes de marcar; investigado, bandeiras, artigo
     da Ufopédia (+ artigo grátis), pontos, Missions.onResearch e o evento com o que ficou disponível. */
  function completeResearch(G, baseId, topicId) {
    const Data = D();
    const topic = Data.researchTopic(topicId);
    const base = C().findBase(G, baseId);
    if (!topic || !base) return null;
    const p = findProject(base, topicId);
    if (p) base.research.splice(base.research.indexOf(p), 1);
    const prevR = availResearch(G, base);
    const prevM = availManufacture(G, base);
    const fx = Data.researchEffects(topicId, G.researched, G.flags);
    if (G.researched.indexOf(topicId) < 0) G.researched.push(topicId);
    for (const f of fx.flags) G.flags[f] = true;
    const addArticle = (a) => {
      if (a && G.ufopaedia.indexOf(a) < 0) G.ufopaedia.push(a);
    };
    addArticle(topic.article);
    if (fx.freeArticle === 'race') addArticle('race_' + topic.race);
    else if (fx.freeArticle === 'ufo') for (const u of G.seen.ufoTypes) addArticle('ufo_' + u);
    OV.Economy.addScore(G, 'research', fx.points);
    if (OV.Missions && typeof OV.Missions.onResearch === 'function') OV.Missions.onResearch(G, topicId);
    const unlocked = availResearch(G, base).filter((id) => prevR.indexOf(id) < 0);
    const manufacture = availManufacture(G, base).filter((id) => prevM.indexOf(id) < 0);
    return C().event(G, 'researchDone', { baseId, topic: topicId, article: topic.article, unlocked, manufacture, flags: fx.flags.slice() });
  }

  // ---- fabrico ---------------------------------------------------------------------------------------------
  const findProd = (base, id) => base.production.find((p) => p.id === id) || null;

  // pode pagar a próxima unidade? → razão de paragem ou null
  function payBlock(G, base, p) {
    const m = D().manufacture[p.item];
    if (G.funds < m.cost) return 'funds';
    for (const it in m.materials) if ((base.stores[it] | 0) < m.materials[it]) return 'materials';
    if (m.produces.craft && freeHangars(G, base, p.id) < 1) return 'hangar';
    return null;
  }
  // tenta pagar dinheiro e materiais da unidade seguinte; avisa uma vez por paragem
  function tryPay(G, base, p) {
    if (p.paid) return true;
    const why = payBlock(G, base, p);
    if (why) {
      if (p.stalled !== why) C().event(G, 'productionStalled', { baseId: base.id, item: p.item, reason: why });
      p.stalled = why;
      return false;
    }
    const m = D().manufacture[p.item];
    G.funds -= m.cost;
    for (const it in m.materials) take(base.stores, it, m.materials[it]);
    p.paid = true;
    p.stalled = null;
    return true;
  }

  function startProduction(G, baseId, item, engineers, qty) {
    const base = C().findBase(G, baseId);
    const m = D().manufacture[item];
    if (!base || !m || availManufacture(G, base).indexOf(item) < 0) return fail('unavailable');
    const n = engineers === undefined ? 0 : engineers;
    const q = qty === undefined ? 1 : qty;
    if (!isInt(n) || n < 0 || !isInt(q) || q < 0) return fail('count');
    if (n > staff(G, baseId).engineers.free) return fail('engineers');
    const ws = capacitiesOf(G, base, base.grid).workshops;
    if (ws.used + n + m.space > ws.cap) return fail('workshops');
    if (m.produces.craft && freeHangars(G, base) < 1) return fail('hangar');
    const p = { id: C().nextId(G, 'p'), item, engineers: n, qty: q, done: 0, spent: 0, paid: false, stalled: null };
    base.production.push(p);
    tryPay(G, base, p);
    return { ok: true, production: p };
  }

  function setEngineers(G, baseId, pid, n) {
    const base = C().findBase(G, baseId);
    const p = base ? findProd(base, pid) : null;
    if (!p) return fail('unavailable');
    if (!isInt(n) || n < 0) return fail('count');
    if (n - p.engineers > staff(G, baseId).engineers.free) return fail('engineers');
    const ws = capacitiesOf(G, base, base.grid).workshops;
    if (ws.used - p.engineers + n > ws.cap) return fail('workshops');
    p.engineers = n;
    return OK;
  }
  function setQty(G, baseId, pid, qty) {
    const base = C().findBase(G, baseId);
    const p = base ? findProd(base, pid) : null;
    if (!p) return fail('unavailable');
    if (!isInt(qty) || qty < 0 || (qty > 0 && qty <= p.done)) return fail('count');
    p.qty = qty;
    return OK;
  }
  // cancelar não devolve a unidade já paga (orig)
  function cancelProduction(G, baseId, pid) {
    const base = C().findBase(G, baseId);
    const p = base ? findProd(base, pid) : null;
    if (!p) return fail('unavailable');
    base.production.splice(base.production.indexOf(p), 1);
    return OK;
  }

  function deliverProduct(G, base, m) {
    const pr = m.produces;
    for (let k = 0; k < (pr.n || 1); k++) {
      if (pr.craft) checkup(G, C().addCraft(G, base.id, pr.craft).id);
      else add(base.stores, pr.item, 1);
    }
  }

  // uma hora de fabrico: paga a unidade se preciso; +engenheiros horas; unidades concluídas entram em armazém
  function produce(G, base) {
    for (const p of base.production.slice()) {
      const m = D().manufacture[p.item];
      if (!m || !tryPay(G, base, p)) continue;
      p.spent += p.engineers;
      if (debug(G, 'instantProduction')) p.spent = Math.max(p.spent, m.hours);
      while (p.paid && p.spent >= m.hours) {
        p.spent -= m.hours;
        p.paid = false;
        p.done++;
        deliverProduct(G, base, m);
        if (p.qty > 0 && p.done >= p.qty) {
          base.production.splice(base.production.indexOf(p), 1);
          C().event(G, 'productionDone', { baseId: base.id, item: p.item, qty: p.done });
          break;
        }
        if (!tryPay(G, base, p)) break;
      }
      if (!p.paid) p.spent = Math.min(p.spent, m.hours);
    }
  }

  // ---- entregas ----------------------------------------------------------------------------------------------
  function arrive(G, base, dl) {
    if (dl.kind === 'item') {
      add(base.stores, dl.itemId, dl.n);
      // munição de nave chegou: naves prontas com armas por carregar voltam a rearmar
      const it = D().items[dl.itemId];
      if (it && it.kind === 'craft_ammo') {
        for (const cid of base.crafts) {
          const c = C().findCraft(G, cid);
          if (c && c.status === 'ready' && c.weapons.some((w) => needsAmmo(w) && D().craftWeapons[w.type].ammoItem === dl.itemId)) c.status = 'rearm';
        }
      }
    } else if (dl.kind === 'craft') {
      for (let k = 0; k < dl.n; k++) checkup(G, C().addCraft(G, base.id, dl.itemId).id);
    } else if (dl.kind === 'soldier') {
      for (let k = 0; k < dl.n; k++) C().addSoldier(G, OV.Soldiers.generate(G, { baseId: base.id }));
    } else if (dl.kind === 'scientist') {
      base.scientists += dl.n;
    } else if (dl.kind === 'engineer') {
      base.engineers += dl.n;
    }
  }
  function deliveries(G, base) {
    for (const dl of base.deliveries.slice()) {
      if (dl.etaT > G.t) continue;
      C().removeById(base.deliveries, dl.id);
      arrive(G, base, dl);
      C().event(G, 'deliveryArrived', { baseId: base.id, kind: dl.kind, itemId: dl.itemId, n: dl.n });
    }
    for (const tr of (base.transfers || []).slice()) {
      if (tr.etaT > G.t) continue;
      C().removeById(base.transfers, tr.id);
      arrive(G, base, tr);
      C().event(G, 'transferArrived', { baseId: base.id, kind: tr.kind, itemId: tr.itemId, n: tr.n });
    }
  }

  // ---- passos do relógio ---------------------------------------------------------------------------------------
  function crafts(G, base, status) {
    const out = [];
    for (const id of base.crafts) {
      const c = C().findCraft(G, id);
      if (c && c.status === status) out.push(c);
    }
    return out;
  }

  // §3.1 passo 7: reabastecer
  function halfHourly(G) {
    for (const base of G.bases) for (const c of crafts(G, base, 'refuel')) refuel(G, base, c);
  }

  // §3.1 passo 11: fabrico; reparar e rearmar; entregas e transferências
  function hourly(G) {
    for (const base of G.bases) {
      produce(G, base);
      for (const c of crafts(G, base, 'repair')) repair(G, c);
      for (const c of crafts(G, base, 'rearm')) rearm(G, base, c);
      deliveries(G, base);
    }
  }

  // §3.1 passo 12: construção e investigação
  function daily(G) {
    for (const base of G.bases) {
      for (const f of base.grid) {
        if ((f.daysLeft | 0) <= 0) continue;
        f.daysLeft--;
        if (f.daysLeft === 0) C().event(G, 'facilityDone', { baseId: base.id, type: f.type, x: f.x, y: f.y });
      }
    }
    for (const base of G.bases) {
      for (const p of base.research.slice()) {
        p.spent += p.scientists | 0;
        if (debug(G, 'instantResearch') && p.scientists > 0) p.spent = Math.max(p.spent, p.cost);
        if (p.spent >= p.cost) completeResearch(G, base.id, p.topic);
      }
    }
  }

  OV.BaseSim = {
    capacities, staff, canPlace, build, canDismantle, dismantle,
    canHire, hire, sack, canBuy, buy, sell, canSellCraft, sellCraft,
    moveCargo, setArmour, assignSoldier, fitWeapon, checkup, serviceStatus, renameBase, renameCraft,
    startResearch, setScientists, cancelResearch, researchLabel, completeResearch,
    startProduction, setEngineers, setQty, cancelProduction,
    halfHourly, hourly, daily,
    loose: (G, craftId) => {
      const c = C().findCraft(G, craftId);
      return c ? loose(G, c) : null;
    },
  };
})(globalThis.OV || (globalThis.OV = {}));
