/* Ciclo do mundo do Geoscape (DESIGN.md §3.1, §3.13, §12; REA 02-geoscape §1, §3, §6; contrato docs/CAMPAIGN_API.md
   §3, §5.3). Avança o relógio, voa naves e OVNIs, deteta por radar, consome combustível e chama os outros módulos da
   estratégia pela ordem fixa do contrato (os que ainda não existem são saltados).

   OV.World = {
     step(G, ticks) → {ticks, stopped, reason:null|'event'|'dogfight'|'battle'|'ended'}
     order(G, craftId, target) → {ok, reason?, warn?}     nave no hangar (descola) ou no ar (muda de alvo)
     launch(G, craftId, target) → idem, só com estado 'ready' ; recall(G, craftId) ; patrol(G, craftId, lon, lat)
     canOrder(G, craftId, target) → {ok, reason?, warn?}  verificação pura para as listas da UI
     loseCraft(G, craftId, reason) ; radarCircles(G) → [{lon, lat, rangeNm, kind, baseId|craftId}]
     dropTarget(G, kind, id, lon, lat)   naves que seguiam um alvo que desapareceu passam a patrulhar (targetLost)
     checkup(G, craftId) → estado de manutenção ('repair'|'rearm'|'refuel'|'ready') ; detectChance(G, ufoId, baseId) → %
     moveCrafts, moveUfos, contacts, burnFuel, patrolDiscovery, detect, autosave (exportados para testes)
   }
   target = {kind:'ufo'|'site'|'alienBase'|'base', id} | {kind:'point', lon, lat} | 'home'.
   Salto de tempo (ours, GEO_IDLE_COALESCE): sem naves no ar nem OVNIs a voar, um passo avança até à fronteira de 10 min
   seguinte (ou até ao fim do tempo em terra de um OVNI pousado) — o resultado é idêntico a avançar de 5 em 5 s. */
(function (OV) {
  'use strict';

  const D = () => OV.Data;
  const Camp = () => OV.Campaign;
  const GM = () => OV.GMath;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const AIR = { out: true, patrol: true, returning: true };
  const HANGAR = { ready: true, repair: true, rearm: true, refuel: true };
  const ev = (G, type, data) => Camp().event(G, type, data);
  const ended = (G) => !!(G.flags && (G.flags.won || G.flags.lost));

  function call(mod, name, G) {
    const m = OV[mod];
    if (m && typeof m[name] === 'function') return m[name](G);
    return undefined;
  }

  // ---- ciclo principal -------------------------------------------------------------------------------------------
  function idle(G) {
    for (const id in G.crafts) if (AIR[G.crafts[id].status]) return false;
    for (const u of G.ufos) if (u.status === 'flying') return false;
    return true;
  }
  function landedTicks(G) {
    let k = Infinity;
    for (const u of G.ufos) if (u.status === 'landed') k = Math.min(k, Math.max(1, Math.ceil(u.groundLeftS / 5)));
    return k;
  }
  function stoppedSince(G, mark) {
    for (let i = mark; i < G.events.length; i++) if (G.events[i] && G.events[i].stop) return true;
    return false;
  }

  function step(G, ticks) {
    const n = Math.max(0, Math.floor(ticks === undefined ? 1 : ticks));
    if (ended(G)) return { ticks: 0, stopped: true, reason: 'ended' };
    if (G.activeMission) return { ticks: 0, stopped: true, reason: 'battle' };
    if (G.dogfights && G.dogfights.length) return { ticks: 0, stopped: true, reason: 'dogfight' };
    if (!Array.isArray(G.events)) G.events = [];
    if (OV.Missions && typeof OV.Missions.planMonth === 'function' && G.plannedMonth < G.month) OV.Missions.planMonth(G);
    const C = OV.Clock;
    const coalesce = tune('GEO_IDLE_COALESCE', true);
    let done = 0;
    while (done < n) {
      let k = 1;
      if (coalesce && n - done > 1 && idle(G)) k = Math.max(1, Math.min(n - done, C.ticksUntil(G, C.T10M), landedTicks(G)));
      const mark = G.events.length;
      const mask = C.advance(G, k);
      tick(G, mask, k);
      done += k;
      if (ended(G) || G.dogfights.length || stoppedSince(G, mark)) return { ticks: done, stopped: true, reason: 'event' };
    }
    return { ticks: done, stopped: false, reason: null };
  }

  // um tick (ou k ticks de inatividade: só os OVNIs pousados contam tempo) pela ordem do contrato §3.1
  function tick(G, mask, k) {
    const C = OV.Clock;
    if (mask & C.T5S) {
      moveCrafts(G);
      advanceUfos(G, k);
      contacts(G);
    }
    if (ended(G)) return;
    if (mask & C.T10M) {
      burnFuel(G);
      patrolDiscovery(G);
      call('Missions', 'scan10m', G);
    }
    if (mask & C.T30M) {
      call('BaseSim', 'halfHourly', G);
      detect(G);
      call('Economy', 'ufoActivity30m', G);
      call('Missions', 'think30m', G);
    }
    if (ended(G)) return;
    if (mask & C.T1H) call('BaseSim', 'hourly', G);
    if (mask & C.T1D) {
      call('BaseSim', 'daily', G);
      call('Soldiers', 'daily', G);
      call('Economy', 'daily', G);
      call('Missions', 'daily', G);
      autosave(G);
    }
    if (ended(G)) return;
    if (mask & C.T1MO) {
      call('Missions', 'monthEnd', G);
      const report = call('Economy', 'monthEnd', G);
      if (report) ev(G, 'monthEnd', { report });
      G.month = C.monthIndex(G);
      call('Missions', 'planMonth', G);
      const reason = call('Economy', 'checkDefeat', G);
      if (reason) Camp().endGame(G, 'lost', reason);
    }
  }

  // ---- naves: utilidades -----------------------------------------------------------------------------------------
  const defOf = (c) => D().crafts[c.type];
  const homeRef = (c) => ({ kind: 'base', id: c.baseId });
  const patrolSpeed = (def) => (def.speed * D().craftRules.patrolSpeedPct) / 100;
  const stepNm = (kn) => (kn * 5) / 3600;
  function fitSoldiers(G, c) {
    let n = 0;
    for (const id of c.soldiers || []) {
      const s = Camp().findSoldier(G, id);
      if (s && (s.woundDays | 0) === 0) n++;
    }
    return n;
  }
  // tem pelo menos uma arma com munições (ou de feixe)
  function armed(c) {
    for (const w of c.weapons || []) {
      if (!w) continue;
      const wd = D().craftWeapons[w.type];
      if (wd && (wd.ammoMax === null || wd.beam || (w.ammo | 0) > 0)) return true;
    }
    return false;
  }
  // estado de manutenção ao aterrar: reparar → rearmar → reabastecer → pronta (orig Craft::checkup)
  function checkupOf(c) {
    const def = defOf(c);
    if (c.hp < def.hp) return 'repair';
    for (const w of c.weapons || []) {
      if (!w) continue;
      const wd = D().craftWeapons[w.type];
      if (wd && wd.ammoMax !== null && !wd.beam && (w.ammo | 0) < wd.ammoMax) return 'rearm';
    }
    if (c.fuel < def.fuel) return 'refuel';
    return 'ready';
  }
  function checkup(G, craftId) {
    const c = Camp().findCraft(G, craftId);
    return c ? checkupOf(c) : null;
  }
  function targetsUfo(G, ufoId) {
    for (const id in G.crafts) {
      const d = G.crafts[id].dest;
      if (d && d.kind === 'ufo' && d.id === ufoId && AIR[G.crafts[id].status]) return true;
    }
    return false;
  }

  // ---- ordens ----------------------------------------------------------------------------------------------------
  function normRef(c, target) {
    if (target === 'home') return homeRef(c);
    if (!target || typeof target !== 'object') return null;
    if (target.kind === 'point') return { kind: 'point', lon: target.lon, lat: target.lat };
    return { kind: target.kind, id: target.id };
  }
  function fuelNeed(def, nm) {
    const per = D().craftFuelPer10Min(def.id, def.speed);
    return Math.ceil(((nm / def.speed) * 6)) * per;
  }

  function check(G, craftId, target, requireReady) {
    const c = Camp().findCraft(G, craftId);
    if (!c) return { ok: false, reason: 'noCraft' };
    if (c.dogfightId) return { ok: false, reason: 'inDogfight' };
    const def = defOf(c);
    if (requireReady && c.status !== 'ready') return { ok: false, reason: 'notReady' };
    const inHangar = !!HANGAR[c.status];
    if (inHangar && c.status !== 'ready' && (c.fuel * 2 < def.fuel || c.hp * 2 < def.hp)) return { ok: false, reason: 'notReady' };
    const ref = normRef(c, target);
    if (!ref) return { ok: false, reason: 'noTarget' };
    const tg = Camp().targetOf(G, ref);
    if (!tg || ref.kind === 'cydonia' || ref.kind === 'craft') return { ok: false, reason: 'noTarget' };
    const home = ref.kind === 'base' && ref.id === c.baseId;
    if (ref.kind === 'ufo' && !tg.obj.detected) return { ok: false, reason: 'noTarget' };
    if (ref.kind === 'alienBase' && !tg.obj.discovered) return { ok: false, reason: 'noTarget' };
    if (home && inHangar) return { ok: false, reason: 'noTarget' };
    if ((c.fuel | 0) <= 0 && !home) return { ok: false, reason: 'noFuel' };
    const flyingUfo = ref.kind === 'ufo' && tg.obj.status === 'flying';
    const ground = (ref.kind === 'ufo' && !flyingUfo) || ref.kind === 'site' || ref.kind === 'alienBase';
    if (def.transport && ground && fitSoldiers(G, c) === 0) return { ok: false, reason: 'noSoldiers' };
    const base = Camp().findBase(G, c.baseId);
    let warn = null;
    if (flyingUfo && !armed(c)) warn = 'noWeapons';
    else if (flyingUfo && tg.obj.speed > def.speed) warn = 'tooSlow';
    else if (!home && base) {
      const nm = GM().distNm(c, tg) + GM().distNm(tg, base);
      if (fuelNeed(def, nm) > c.fuel) warn = 'tooFar';
    }
    return warn ? { ok: true, warn, c, ref, inHangar, home } : { ok: true, c, ref, inHangar, home };
  }
  const pub = (r) => (r.ok ? (r.warn ? { ok: true, warn: r.warn } : { ok: true }) : { ok: false, reason: r.reason });

  function canOrder(G, craftId, target) {
    return pub(check(G, craftId, target, false));
  }

  // equipamento dos modelos dos soldados a bordo que falte na nave sai do armazém da base (se houver)
  function topUpEquipment(G, c) {
    const base = Camp().findBase(G, c.baseId);
    if (!base) return;
    const need = {};
    for (const id of c.soldiers) {
      const s = Camp().findSoldier(G, id);
      if (!s || !s.loadout) continue;
      const lo = s.loadout;
      for (const it of [lo.R, lo.L].concat(lo.belt || [], lo.pack || [])) if (it) need[it] = (need[it] | 0) + 1;
    }
    for (const it in need) {
      const miss = need[it] - (c.equipment[it] | 0);
      const take = Math.min(miss, base.stores[it] | 0);
      if (take <= 0) continue;
      base.stores[it] -= take;
      if (!base.stores[it]) delete base.stores[it];
      c.equipment[it] = (c.equipment[it] | 0) + take;
    }
  }

  function apply(G, r) {
    const c = r.c, def = defOf(c);
    if (r.inHangar) {
      c.missionT = G.t | 0;
      c.lowFuel = false;
      topUpEquipment(G, c);
    }
    c.dest = r.ref;
    c.patrol = false;
    c.speed = def.speed;
    if (r.home) {
      c.status = 'returning';
      return;
    }
    c.status = 'out';
    // patrulhar no sítio onde já está: fica logo a patrulhar, sem aviso de chegada
    if (r.ref.kind === 'point' && !r.inHangar && GM().distNm(c, r.ref) <= stepNm(def.speed)) {
      c.status = 'patrol';
      c.patrol = true;
      c.speed = patrolSpeed(def);
    }
  }
  function order(G, craftId, target) {
    const r = check(G, craftId, target, false);
    if (r.ok) apply(G, r);
    return pub(r);
  }
  function launch(G, craftId, target) {
    const r = check(G, craftId, target, true);
    if (r.ok) apply(G, r);
    return pub(r);
  }
  const recall = (G, craftId) => order(G, craftId, 'home');
  const patrol = (G, craftId, lon, lat) => order(G, craftId, { kind: 'point', lon, lat });

  // ---- perda de alvos e de naves -------------------------------------------------------------------------------
  function lostTarget(G, c, p) {
    const old = c.dest && c.dest.kind !== 'point' ? { kind: c.dest.kind, id: c.dest.id } : c.dest;
    const at = p && Number.isFinite(p.lon) ? p : { lon: c.lon, lat: c.lat };
    c.dest = { kind: 'point', lon: at.lon, lat: at.lat };
    c.patrol = true;
    c.status = 'patrol';
    c.speed = patrolSpeed(defOf(c));
    ev(G, 'targetLost', { craftId: c.id, target: old });
  }
  function dropTarget(G, kind, id, lon, lat) {
    for (const cid in G.crafts) {
      const c = G.crafts[cid];
      if (!AIR[c.status] || c.status === 'returning' || c.dogfightId) continue;
      if (!c.dest || c.dest.kind !== kind || c.dest.id !== id) continue;
      lostTarget(G, c, Number.isFinite(lon) ? { lon, lat } : null);
    }
  }

  function loseCraft(G, craftId, reason) {
    const c = Camp().findCraft(G, craftId);
    if (!c) return null;
    const def = defOf(c);
    const base = Camp().findBase(G, c.baseId);
    const soldiers = (c.soldiers || []).slice();
    const where = { kind: 'craft', lon: c.lon, lat: c.lat };
    for (const sid of soldiers) {
      if (OV.Soldiers && typeof OV.Soldiers.kill === 'function') OV.Soldiers.kill(G, sid, 'craft', where);
      else {
        const s = Camp().findSoldier(G, sid);
        if (s) {
          delete G.soldiers[sid];
          const b = Camp().findBase(G, s.baseId);
          if (b) Camp().removeById(b.soldiers, sid);
        }
      }
    }
    if (OV.Economy && typeof OV.Economy.addScore === 'function') OV.Economy.addScore(G, 'xcom', -def.score, c.lon, c.lat);
    if (c.dogfightId) Camp().removeById(G.dogfights, c.dogfightId);
    delete G.crafts[craftId];
    if (base) Camp().removeById(base.crafts, craftId);
    G.stats.craftsLost++;
    return ev(G, 'craftLost', { craftId, type: c.type, reason: reason || 'dogfight', soldiers });
  }

  // ---- voo das naves (passo 1) ---------------------------------------------------------------------------------
  function contact(G, c, u) {
    const def = defOf(c);
    c.lon = u.lon;
    c.lat = u.lat;
    const max = tune('MAX_DOGFIGHTS', 2);
    const fast = !D().craftRules.engageRequiresSpeed || u.speed <= def.speed;
    if (!armed(c) || !fast || c.dogfightId || G.dogfights.length >= max) return false;
    if (!OV.Dogfight || typeof OV.Dogfight.create !== 'function') return false;
    const df = OV.Dogfight.create(G, c.id, u.id);
    if (!df || !df.id) return false;
    ev(G, 'dogfightStart', { dogfightId: df.id, craftId: c.id, ufoId: u.id });
    return true;
  }
  function chase(G, c, def, u) {
    c.status = 'out';
    c.patrol = false;
    c.speed = def.speed;
    if (GM().distNm(c, u) <= stepNm(def.speed)) {
      contact(G, c, u);
      return;
    }
    const aim = (u.dest && GM().interceptPoint(c, def.speed, u, u.dest, u.speed)) || u;
    const r = GM().stepToward(c, aim, def.speed, 5);
    c.lon = r.lon;
    c.lat = r.lat;
  }
  function landHome(G, c) {
    const b = Camp().findBase(G, c.baseId);
    c.lon = b.lon;
    c.lat = b.lat;
    c.speed = 0;
    c.dest = null;
    c.patrol = false;
    c.lowFuel = false;
    c.missionT = null;
    c.status = checkupOf(c);
    ev(G, 'craftReturned', { craftId: c.id, baseId: b.id });
  }
  function arrive(G, c, def, ref) {
    if (ref.kind === 'base' && ref.id === c.baseId) {
      landHome(G, c);
      return;
    }
    c.status = 'patrol';
    c.speed = patrolSpeed(def);
    if (ref.kind === 'point' || ref.kind === 'base') {
      c.patrol = true;
      ev(G, 'craftArrived', { craftId: c.id, target: ref.kind === 'point' ? { kind: 'point', lon: ref.lon, lat: ref.lat } : { kind: ref.kind, id: ref.id }, prompt: 'patrol' });
      return;
    }
    c.patrol = false;
    const prompt = def.transport && fitSoldiers(G, c) > 0 ? 'mission' : 'none';
    ev(G, 'craftArrived', { craftId: c.id, target: { kind: ref.kind, id: ref.id }, prompt });
  }

  function flyCraft(G, c) {
    const def = defOf(c);
    if (c.status === 'returning' && !(c.dest && c.dest.kind === 'base' && c.dest.id === c.baseId)) c.dest = homeRef(c);
    if (!c.dest) {
      c.status = 'returning';
      c.dest = homeRef(c);
    }
    const ref = c.dest;
    let pos;
    if (ref.kind === 'point') pos = ref;
    else {
      const tg = Camp().targetOf(G, ref);
      if (!tg) {
        if (ref.kind === 'base' && ref.id === c.baseId) {
          loseCraft(G, c.id, 'base');
          return;
        }
        lostTarget(G, c, null);
        return;
      }
      pos = tg.obj;
      if (ref.kind === 'ufo') {
        if (!pos.detected && pos.status !== 'crashed') {
          lostTarget(G, c, pos.lastSeen);
          return;
        }
        if (pos.status === 'flying') {
          chase(G, c, def, pos);
          return;
        }
      }
    }
    if (c.status === 'patrol') {
      // à espera sobre um local, ou a patrulhar: só se desloca até ao ponto de patrulha (meia velocidade)
      c.speed = patrolSpeed(def);
      if (ref.kind === 'point' && c.patrol) {
        const r = GM().stepToward(c, pos, c.speed, 5);
        c.lon = r.lon;
        c.lat = r.lat;
      }
      return;
    }
    c.speed = def.speed;
    const r = GM().stepToward(c, pos, def.speed, 5);
    c.lon = r.lon;
    c.lat = r.lat;
    if (r.arrived) arrive(G, c, def, ref);
  }

  function moveCrafts(G) {
    for (const id in G.crafts) {
      const c = G.crafts[id];
      if (!c || !AIR[c.status] || c.dogfightId) continue;
      flyCraft(G, c);
    }
  }

  // ---- OVNIs (passo 2) -----------------------------------------------------------------------------------------
  function advanceUfos(G, k) {
    const M = OV.Missions;
    const ids = G.ufos.map((u) => u.id);
    for (const id of ids) {
      const u = Camp().findUfo(G, id);
      if (!u) continue;
      if (u.status === 'flying') {
        if (!u.dest) {
          if (M && !u.targetBaseId) M.onUfoWaypoint(G, u.id);
          continue;
        }
        const r = GM().stepToward(u, u.dest, u.speed, 5);
        u.lon = r.lon;
        u.lat = r.lat;
        if (r.arrived && !u.targetBaseId && M) M.onUfoWaypoint(G, u.id);
      } else if (u.status === 'landed') {
        u.groundLeftS -= 5 * k;
        if (u.groundLeftS <= 0 && M) M.onUfoLiftOff(G, u.id);
      }
    }
  }
  const moveUfos = (G) => advanceUfos(G, 1);

  // ---- contactos vindos do movimento dos OVNIs e ataques à base (passo 3) ----------------------------------------
  function contacts(G) {
    for (const id in G.crafts) {
      const c = G.crafts[id];
      if (!c || c.status !== 'out' || c.dogfightId || !c.dest || c.dest.kind !== 'ufo') continue;
      const u = Camp().findUfo(G, c.dest.id);
      if (!u || u.status !== 'flying' || !u.detected) continue;
      const def = defOf(c);
      if (u.speed > def.speed) continue; // a nave não acompanha um OVNI mais rápido
      if (GM().distNm(c, u) <= stepNm(Math.max(u.speed, def.speed))) contact(G, c, u);
    }
    for (const u of G.ufos.slice()) {
      if (u.status !== 'flying' || !u.targetBaseId || !Camp().findUfo(G, u.id)) continue;
      const b = Camp().findBase(G, u.targetBaseId);
      if (b && GM().distNm(u, b) > 1) continue;
      if (b) {
        ev(G, 'baseAttack', { baseId: b.id, ufoId: u.id });
        if (typeof Camp().baseDefence === 'function') Camp().baseDefence(G, b.id, u.id);
      }
      if (Camp().findUfo(G, u.id) && OV.Missions) OV.Missions.removeUfo(G, u.id);
      if (ended(G)) return;
    }
  }

  // ---- combustível (passo 4) -----------------------------------------------------------------------------------
  function burnFuel(G) {
    const margin = tune('LOW_FUEL_MARGIN_10M', 1);
    for (const id in G.crafts) {
      const c = G.crafts[id];
      if (!AIR[c.status] || c.dogfightId) continue;
      const def = defOf(c);
      c.fuel = Math.max(0, (c.fuel | 0) - D().craftFuelPer10Min(c.type, c.speed));
      if (c.status === 'returning' || !D().craftRules.lowFuelReturn) continue;
      const base = Camp().findBase(G, c.baseId);
      if (!base) continue;
      const need = Math.ceil((GM().distNm(c, base) / def.speed) * 6 + margin) * D().craftFuelPer10Min(c.type, def.speed);
      if (c.fuel > need) continue;
      c.lowFuel = true;
      c.status = 'returning';
      c.patrol = false;
      c.speed = def.speed;
      c.dest = homeRef(c);
      ev(G, 'craftLowFuel', { craftId: c.id });
    }
  }

  // ---- patrulha descobre bases alienígenas (passo 5) -----------------------------------------------------------
  function patrolDiscovery(G) {
    if (!G.alienBases.length) return;
    const pr = D().missionRules.patrolReveal;
    for (const id in G.crafts) {
      const c = G.crafts[id];
      if (c.status !== 'patrol' || !c.patrol || c.dogfightId) continue;
      for (const ab of G.alienBases) {
        if (ab.discovered) continue;
        const d = GM().distNm(c, ab);
        if (d > pr.rangeNm) continue;
        const p = Math.floor(pr.pct - (pr.pct * d) / pr.rangeNm);
        if (p <= 0 || !Camp().rng(G, 'geo').pct(p)) continue;
        ab.discovered = true;
        ab.foundT = G.t | 0;
        ev(G, 'alienBaseFound', { alienBaseId: ab.id, how: 'patrol' });
      }
    }
  }

  // ---- radar (passo 8) -----------------------------------------------------------------------------------------
  function baseRadars(b) {
    const out = [];
    for (const f of b.grid || []) {
      if ((f.daysLeft | 0) !== 0) continue;
      const fd = D().facilities[f.type];
      if (!fd || !(fd.radarRange > 0)) continue;
      out.push({ type: f.type, rangeNm: fd.radarRange, chance: fd.radarChance | 0, hyper: !!fd.hyper });
    }
    return out;
  }
  function radarCircles(G) {
    const out = [];
    for (const b of G.bases) for (const r of baseRadars(b)) out.push({ lon: b.lon, lat: b.lat, rangeNm: r.rangeNm, kind: r.type, baseId: b.id });
    const nm = D().craftRules.radarRange;
    for (const id in G.crafts) {
      const c = G.crafts[id];
      if (AIR[c.status]) out.push({ lon: c.lon, lat: c.lat, rangeNm: nm, kind: 'craft', craftId: c.id });
    }
    return out;
  }
  // visibilidade = tamanho + altitude (pousado: −30 em vez do tamanho; REA §3.1)
  const ALT_VIS = [-30, -20, -10, 0, -10];
  function visibility(u) {
    if (u.status === 'landed' || (u.alt | 0) === 0) return ALT_VIS[0];
    return D().ufos[u.type].visibility + ALT_VIS[Math.max(1, Math.min(4, u.alt | 0))];
  }
  function chanceFrom(b, radars, u) {
    let sum = 0;
    const d = GM().distNm(b, u);
    for (const r of radars) if (!r.hyper && d <= r.rangeNm) sum += r.chance;
    return sum > 0 ? Math.max(0, Math.floor((sum * (100 + visibility(u))) / 100)) : 0;
  }
  function detectChance(G, ufoId, baseId) {
    const u = Camp().findUfo(G, ufoId), b = Camp().findBase(G, baseId);
    return u && b ? chanceFrom(b, baseRadars(b), u) : 0;
  }
  function markSeen(G, u) {
    if (!G.seen) return;
    if (G.seen.ufoTypes.indexOf(u.type) < 0) G.seen.ufoTypes.push(u.type);
    if (u.race && G.seen.races.indexOf(u.race) < 0) G.seen.races.push(u.race);
  }

  function detect(G) {
    if (!G.ufos.length) return;
    const geo = Camp().rng(G, 'geo');
    const reveal = !!(G.debug && G.debug.revealUfos);
    const bases = G.bases.map((b) => ({ b, radars: baseRadars(b) }));
    const craftNm = D().craftRules.radarRange;
    const air = [];
    for (const id in G.crafts) if (AIR[G.crafts[id].status]) air.push(G.crafts[id]);
    for (const u of G.ufos) {
      if (u.status !== 'flying' && u.status !== 'landed') continue;
      const was = u.detected;
      let inHyper = false, inRadar = false;
      for (const x of bases) {
        const d = GM().distNm(x.b, u);
        for (const r of x.radars) {
          if (d > r.rangeNm) continue;
          inRadar = true;
          if (r.hyper) inHyper = true;
        }
      }
      let inCraft = false;
      for (const c of air) if (GM().distNm(c, u) <= craftNm) inCraft = true;
      if (inHyper || reveal) {
        u.detected = true;
        if (inHyper) {
          u.hyper = true;
          markSeen(G, u);
        }
      } else if (u.detected) {
        if (!inRadar && !inCraft) {
          u.detected = false;
          u.hyper = false;
          ev(G, 'ufoLost', { ufoId: u.id, stop: targetsUfo(G, u.id) });
          continue;
        }
      } else if (inCraft) u.detected = true;
      else {
        for (const x of bases) {
          const ch = chanceFrom(x.b, x.radars, u);
          if (ch > 0 && geo.int(0, 99) < ch) {
            u.detected = true;
            break;
          }
        }
      }
      if (!u.detected) continue;
      u.lastSeen = { lon: u.lon, lat: u.lat, t: G.t | 0 };
      if (!was) {
        G.stats.ufosDetected++;
        ev(G, 'ufoDetected', { ufoId: u.id, hyper: !!u.hyper });
      }
    }
  }

  // ---- gravação automática (passo 16) --------------------------------------------------------------------------
  function autosave(G) {
    const days = tune('AUTOSAVE_DAYS', [1, 10, 20]);
    if (days.indexOf(OV.Clock.date(G).d) >= 0) ev(G, 'autosaveDue', {});
  }

  OV.World = {
    step, order, launch, recall, patrol, canOrder, loseCraft, radarCircles, dropTarget, checkup, detectChance,
    moveCrafts, moveUfos, contacts, burnFuel, patrolDiscovery, detect, autosave,
  };
})(globalThis.OV || (globalThis.OV = {}));
