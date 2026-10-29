/* Campanha, secção B (contrato docs/CAMPAIGN_API.md §5.9): startMission → OV.Battle.create → batalha (playerBot ou
   resultado forçado) → finishMission para queda/aterragem/terror/base alienígena/Cidónia; abortar; equipar; investigação
   disponível; defesa da base; ciclo completo com o OV.World real (chegada → missão → regresso). */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign;
  const D = OV.Data;
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };
  const LIVE = { ok: 1, panic: 1 };

  function placeUfo(G, status, type, lon, lat, race) {
    const u = {
      id: C.nextId(G, 'u'), type, missionId: null, race: race || 'sectoid', region: OV.GMath.regionAt(lon, lat), traj: 'P0', wp: 0, lon, lat,
      dest: null, alt: 0, speed: 0, status, dmg: 0, detected: true, hyper: false, groundLeftS: 3600, crashLeftS: 86400, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }
  function placeSite(G, cityId, race) {
    const city = D.citiesById[cityId];
    const s = { id: C.nextId(G, 't'), kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId, lon: city.lon, lat: city.lat, race,
      region: city.region, country: OV.GMath.countryAt(city.lon, city.lat), leftS: 36000 };
    G.sites.push(s);
    return s;
  }
  function placeAlienBase(G, lon, lat, race) {
    const a = { id: C.nextId(G, 'a'), lon, lat, race, region: OV.GMath.regionAt(lon, lat), country: OV.GMath.countryAt(lon, lat), missionId: null,
      discovered: true, foundT: 0, supplyT: null };
    G.alienBases.push(a);
    return a;
  }
  const skyOf = (G) => Object.values(G.crafts).find((c) => c.type === 'skyranger');
  function arrive(craft, kind, obj) {
    Object.assign(craft, { status: 'patrol', dest: { kind, id: obj.id }, lon: obj.lon, lat: obj.lat, speed: 0 });
  }
  function freshG(seed, diff) {
    const G = C.newCampaign({ seed: seed || 7, difficulty: diff === undefined ? 1 : diff });
    G.events.length = 0;
    return G;
  }
  // resultados forçados (sem jogar): todos os alienígenas mortos / toda a equipa morta
  function forceWin(B) {
    for (const u of B.units) if (u.side === 'alien' && LIVE[u.status]) drain0(OV.Combat.killUnit(B, u, null, 'test'));
  }
  function forceLoss(B) {
    for (const u of B.units) if (u.side === 'xcom' && LIVE[u.status]) drain0(OV.Combat.killUnit(B, u, null, 'test'));
  }
  const drain0 = (evs) => evs;
  function playBot(B, maxTurns) {
    drain(OV.Battle.beginBattle(B));
    while (B.phase !== 'over' && B.turn <= maxTurns) {
      drain(OV.AI.turn(B, 'xcom'));
      if (B.phase !== 'over') drain(OV.Battle.endPlayerTurn(B));
    }
    return B;
  }
  const jsonSafe = (G) => {
    const a = JSON.stringify(G, function (k, v) { return this === G && k === 'events' ? undefined : v; });
    t.ok(!/NaN|Infinity|undefined/.test(a), 'sem NaN/Infinity');
    const back = JSON.parse(a);
    back.events = G.events;
    t.eq(back, G, 'G JSON puro (ida e volta igual)');
  };


  t.test('startMission: missão exata para OV.Battle.create (queda de dia, equipa financiada, semente da stream map)', () => {
    const G = freshG(7);
    const sky = skyOf(G);
    const ufo = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    t.throws(() => C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id), 'nave ainda no hangar ⇒ notAtSite');
    arrive(sky, 'ufo', ufo);
    // um soldado ferido fica de fora
    const hurt = G.soldiers[sky.soldiers[7]];
    const mapBefore = G.rng.map;
    const geoBefore = G.rng.geo;
    hurt.woundDays = 3;
    const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id, { settings: { instantGrenades: false } });
    hurt.woundDays = 0;
    t.ok(G.rng.map !== mapBefore && G.rng.geo === geoBefore, 'só a stream map avança');
    t.eq([m.kind, m.siteId, m.craftId, m.ufoType, m.race, m.month, m.difficulty, m.craftType, m.deploymentId], ['crash', ufo.id, sky.id, 'small_scout', 'sectoid', 0, 1, 'skyranger', null]);
    t.eq(m.terrain, D.terrainAt(ufo.lon, ufo.lat));
    t.eq(m.shade, OV.GMath.missionShade(G, ufo.lon, ufo.lat));
    t.eq(m.night, OV.GMath.dayPhase(G, ufo.lon, ufo.lat) === 'night');
    t.eq(m.squad.length, 7, 'ferido não embarca');
    t.ok(m.squad.every((s) => s.soldierId !== hurt.id));
    t.eq(m.settings, { instantGrenades: false });
    t.eq(m.researched, []);
    t.eq(G.activeMission, { siteRef: { kind: 'ufo', id: ufo.id }, craftId: sky.id, startedT: 0 });
    // conservação: Σ modelos financiados + carga solta = equipamento da nave
    const total = {};
    const add = (k) => { if (k) total[k] = (total[k] | 0) + 1; };
    for (const s of m.squad) { add(s.loadout.R); add(s.loadout.L); s.loadout.belt.forEach(add); s.loadout.pack.forEach(add); }
    for (const k of Object.keys(m.craftItems)) total[k] = (total[k] | 0) + m.craftItems[k];
    t.eq(total, sky.equipment, 'equipa + carga = equipamento');
    const sq = m.squad[0];
    const s0 = G.soldiers[sq.soldierId];
    t.eq(Object.keys(sq).sort(), ['armour', 'female', 'loadout', 'missions', 'name', 'nat', 'portraitSeed', 'rank', 'soldierId', 'stats']);
    t.eq([sq.name, sq.armour, sq.stats], [s0.name, s0.armour, s0.stats]);
    t.ok(sq.stats !== s0.stats, 'atributos clonados');
    t.eq(m.meta.campaign, { siteRef: { kind: 'ufo', id: ufo.id }, craftId: sky.id });
    t.eq([m.meta.regionKey, m.meta.countryKey, m.meta.race], ['region.europe', 'country.france', null]);
    t.eq(C.briefingMeta(G, m), m.meta);
    const B = OV.Battle.create(m);
    t.eq(B.units.filter((u) => u.side === 'xcom').length, 7);
    t.eq(B.settings.instantGrenades, false);
    t.eq(B.mission.siteId, ufo.id);
    t.throws(() => C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id), 'segunda missão em curso ⇒ busy');
    t.ok(C.cancelMission(G) && G.activeMission === null);
    // mesma campanha, mesma semente ⇒ mesma missão
    const G2 = freshG(7);
    const u2 = placeUfo(G2, 'crashed', 'small_scout', 2.35, 48.85);
    arrive(skyOf(G2), 'ufo', u2);
    G2.soldiers[skyOf(G2).soldiers[7]].woundDays = 3;
    const m2 = C.startMission(G2, { kind: 'ufo', id: u2.id }, skyOf(G2).id, { settings: { instantGrenades: false } });
    t.eq(m2, m);
  });

  t.test('startMission: pré-condições → Error campaign.err.*', () => {
    const G = freshG(9);
    const sky = skyOf(G);
    const err = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };
    const flying = placeUfo(G, 'flying', 'small_scout', 2.35, 48.85);
    arrive(sky, 'ufo', flying);
    t.eq(err(() => C.startMission(G, { kind: 'ufo', id: flying.id }, sky.id)), 'campaign.err.noTarget');
    t.eq(err(() => C.startMission(G, { kind: 'ufo', id: 'u99' }, sky.id)), 'campaign.err.noTarget');
    const inter = Object.values(G.crafts).find((c) => c.type === 'interceptor');
    t.eq(err(() => C.startMission(G, { kind: 'ufo', id: flying.id }, inter.id)), 'campaign.err.notTransport');
    t.eq(err(() => C.startMission(G, { kind: 'cydonia' }, sky.id)), 'campaign.err.locked');
    const ab = placeAlienBase(G, 20, 0, 'sectoid');
    ab.discovered = false;
    arrive(sky, 'alienBase', ab);
    t.eq(err(() => C.startMission(G, { kind: 'alienBase', id: ab.id }, sky.id)), 'campaign.err.noTarget');
    const landed = placeUfo(G, 'landed', 'small_scout', 2.35, 48.85);
    arrive(sky, 'ufo', landed);
    const keep = sky.soldiers.slice();
    for (const id of keep) G.soldiers[id].woundDays = 2;
    t.eq(err(() => C.startMission(G, { kind: 'ufo', id: landed.id }, sky.id)), 'campaign.err.noSoldiers');
    for (const id of keep) G.soldiers[id].woundDays = 0;
    t.eq(G.activeMission, null, 'nenhuma falha marca a missão');
    t.eq(C.startMission(G, { kind: 'ufo', id: landed.id }, sky.id).kind, 'landed');
  });

  t.test('queda: playerBot até ao fim → finishMission (pontuação, armazém, soldados, nave regressa, OVNI removido)', () => {
    const G = freshG(7);
    const sky = skyOf(G);
    const ufo = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    arrive(sky, 'ufo', ufo);
    const storesBefore = Object.assign({}, G.bases[0].stores);
    const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
    const B = playBot(OV.Battle.create(m), 30);
    t.eq(B.phase, 'over', 'batalha acabou');
    const xBefore = G.score.month.xcom.total;
    const eqBefore = Object.assign({}, sky.equipment);
    const model = C.finishMission(G, B);
    const deb = model.debrief;
    t.eq(deb.result, B.result);
    t.eq(model.outcome, 'continue');
    t.eq(G.activeMission, null);
    t.eq(G.score.month.xcom.total - xBefore, deb.score, 'pontuação da batalha somada');
    t.eq(model.scoreAdded, deb.score);
    t.eq(Object.keys(model).sort(), ['capturedLost', 'capturedStored', 'craftLost', 'debrief', 'meta', 'mission', 'outcome', 'progression', 'promotions', 'scoreAdded', 'storage', 'stored']);
    if (deb.result === 'win') {
      t.eq(G.ufos.length, 0, 'OVNI removido');
      t.eq(G.stats.missionsWon, 1);
      for (const k of Object.keys(deb.recovered)) t.ok((G.bases[0].stores[k] | 0) >= (storesBefore[k] | 0) + deb.recovered[k], 'recuperado ' + k);
      t.ok(G.seen.races.indexOf('sectoid') >= 0 && G.seen.ufoTypes.indexOf('small_scout') >= 0);
    }
    t.eq(G.stats.aliensKilled, deb.kills);
    const ok = deb.soldiers.filter((s) => s.status === 'ok');
    t.eq(model.progression.map((p) => p.soldierId), ok.map((s) => s.soldierId), 'progressão = sobreviventes');
    for (const p of model.progression) {
      t.eq(Object.keys(p).sort(), ['gains', 'kills', 'promoted', 'soldierId']);
      t.eq(G.soldiers[p.soldierId].missions, 1);
    }
    for (const sid of deb.dead.concat(deb.mia)) {
      t.ok(!G.soldiers[sid], 'morto saiu do plantel');
      t.ok(G.dead.some((d) => d.id === sid), 'memorial ' + sid);
      t.ok(sky.soldiers.indexOf(sid) < 0);
    }
    for (const sid of Object.keys(deb.wounded)) if (G.soldiers[sid]) t.ok(G.soldiers[sid].woundDays > 0 && G.soldiers[sid].craftId === null, 'ferido ' + sid);
    if (!deb.craftLost) {
      t.eq([sky.status, sky.dest], ['returning', { kind: 'base', id: 'b1' }]);
      for (const k of Object.keys(eqBefore)) t.eq(sky.equipment[k] | 0, Math.max(0, eqBefore[k] - (deb.equipmentLost[k] | 0)), 'equipamento ' + k);
    }
    jsonSafe(G);
  });

  t.test('aterragem: vitória com um alienígena atordoado — sem contenção morre (cadáver), com contenção fica vivo', () => {
    for (const containment of [false, true]) {
      const G = freshG(11);
      if (containment) G.bases[0].grid.push({ type: 'alien_containment', x: 5, y: 0, daysLeft: 0 });
      const sky = skyOf(G);
      const ufo = placeUfo(G, 'landed', 'medium_scout', -3.7, 40.4);
      arrive(sky, 'ufo', ufo);
      const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
      t.eq(m.kind, 'landed');
      const B = OV.Battle.create(m);
      drain(OV.Battle.beginBattle(B));
      const aliens = B.units.filter((u) => u.side === 'alien' && LIVE[u.status]);
      const victim = aliens.find((u) => u.capturable);
      t.ok(victim, 'há um capturável');
      OV.Combat.knockOut(B, victim, null);
      forceWin(B);
      t.eq(OV.Battle.outcome(B), 'win');
      const model = C.finishMission(G, B);
      t.eq(model.debrief.captured.length, 1);
      const corpse = D.units[victim.type].corpse;
      if (containment) {
        t.eq(model.capturedStored, { [victim.type]: 1 });
        t.eq(G.bases[0].aliens, { [victim.type]: 1 });
        t.eq(G.stats.aliensCaptured, 1);
        t.ok(C.availableResearch(G, 'b1').indexOf(D.interrogationId(victim.type)) >= 0, 'interrogatório disponível');
      } else {
        t.eq(model.capturedLost, { [victim.type]: 1 });
        t.eq(G.bases[0].aliens, {});
        t.ok((model.stored[corpse] | 0) >= 1, 'cadáver em vez do vivo');
        t.eq(G.stats.aliensCaptured, 0);
      }
      t.ok(model.storage && model.storage.cap > 0);
      t.eq(G.ufos.length, 0);
    }
  });

  t.test('terror: derrota → equipa perdida (memorial), nave perdida (uma só penalização), local desaparece sem −1000', () => {
    const G = freshG(13);
    const sky = skyOf(G);
    const site = placeSite(G, 'paris', 'floater');
    arrive(sky, 'site', site);
    const m = C.startMission(G, { kind: 'site', id: site.id }, sky.id);
    t.eq([m.kind, m.terrain, m.race, m.ufoType], ['terror', 'URBAN', 'floater', null]);
    t.eq(m.meta.cityKey, D.citiesById.paris.nameKey);
    t.eq(m.meta.race, 'floater');
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    forceLoss(B);
    const xBefore = G.score.month.xcom.total;
    const model = C.finishMission(G, B);
    t.eq(model.debrief.result, 'loss');
    t.ok(model.craftLost && !G.crafts[sky.id], 'nave perdida');
    t.eq(G.stats.missionsLost, 1);
    t.eq(G.stats.craftsLost, 1);
    t.eq(G.sites.length, 0, 'o local de terror desaparece depois de qualquer batalha (OpenXcom)');
    const alienBefore = G.score.month.alien.total;
    for (let k = 0; k < 40; k++) OV.Missions.think30m(G);
    t.eq(G.score.month.alien.total - alienBefore < D.scoring.terrorSiteExpired, true, 'sem terrorSiteExpired depois da derrota');
    t.ok(!G.events.some((e) => e.t === 'terrorSiteExpired'));
    t.eq(G.score.month.xcom.total - xBefore, model.debrief.score, 'penalização da nave contada uma vez');
    t.eq(G.dead.length, 8);
    t.eq(Object.keys(G.soldiers).length, 0);
    t.eq(model.progression, []);
    t.ok(G.events.some((e) => e.t === 'craftLost'));
    t.eq(G.activeMission, null);
  });

  t.test('base alienígena: vitória → base removida, +500 na pontuação, raça vista', () => {
    const G = freshG(17);
    const sky = skyOf(G);
    const ab = placeAlienBase(G, 20, 5, 'floater');
    arrive(sky, 'alienBase', ab);
    const m = C.startMission(G, { kind: 'alienBase', id: ab.id }, sky.id);
    t.eq([m.kind, m.terrain, m.race], ['alienBase', 'ALIENBASE', 'floater']);
    t.ok(m.shade === undefined, 'sombra por omissão da batalha');
    t.eq(m.meta.time, 'dusk');
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    forceWin(B);
    const model = C.finishMission(G, B);
    t.ok(model.debrief.lines.some((l) => l.key === 'bs.debrief.alienBaseDestroyed' && l.points === D.scoring.alienBaseDestroyed));
    t.eq(G.alienBases.length, 0);
    t.ok(G.seen.races.indexOf('floater') >= 0);
    t.eq(G.seen.ufoTypes, []);
    t.eq(skyOf(G).status, 'returning');
  });

  t.test('Cidónia: só com Avenger pronto e desbloqueada; vitória ⇒ won + victory; derrota ⇒ lost cydonia', () => {
    for (const win of [true, false]) {
      const G = freshG(19);
      const sky = skyOf(G);
      G.flags.cydoniaUnlocked = true;
      t.throws(() => C.startMission(G, { kind: 'cydonia' }, sky.id), 'Skyranger não vai a Marte');
      const av = C.addCraft(G, 'b1', 'avenger');
      for (const sid of sky.soldiers.slice()) {
        C.removeById(sky.soldiers, sid);
        av.soldiers.push(sid);
        G.soldiers[sid].craftId = av.id;
      }
      av.equipment = sky.equipment;
      sky.equipment = {};
      const m = C.startMission(G, { kind: 'cydonia' }, av.id);
      t.eq([m.kind, m.terrain, m.siteId, m.race, m.craftType], ['cydonia', 'MARS', null, 'mixed', 'avenger']);
      t.eq(G.activeMission.siteRef, { kind: 'cydonia' });
      const B = OV.Battle.create(m);
      drain(OV.Battle.beginBattle(B));
      if (win) forceWin(B);
      else forceLoss(B);
      const model = C.finishMission(G, B);
      if (win) {
        t.eq([model.outcome, G.flags.won, G.flags.lost], ['victory', true, false]);
        t.ok(G.events.some((e) => e.t === 'victory'));
        t.ok(['ready', 'repair', 'rearm', 'refuel'].indexOf(av.status) >= 0, 'Avenger em manutenção no hangar: ' + av.status);
      } else {
        t.eq([model.outcome, G.flags.lost, G.flags.lostReason], ['gameOver', true, 'cydonia']);
        t.ok(G.events.some((e) => e.t === 'gameOver' && e.reason === 'cydonia'));
      }
    }
  });

  t.test('abortar no turno 1: equipa a bordo regressa, OVNI fica, missão abortada', () => {
    const G = freshG(23);
    const sky = skyOf(G);
    const ufo = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    arrive(sky, 'ufo', ufo);
    const eqBefore = JSON.stringify(sky.equipment), stBefore = JSON.stringify(G.bases[0].stores);
    const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    const model = C.abortMission(G, B);
    t.eq(model.debrief.result, 'abort');
    t.eq([JSON.stringify(sky.equipment), JSON.stringify(G.bases[0].stores)], [eqBefore, stBefore], 'nada ganho nem perdido ao abortar logo');
    t.eq(G.stats.missionsAborted, 1);
    t.eq(G.ufos.length, 1, 'o local continua');
    const back = model.debrief.soldiers.filter((s) => s.status === 'ok').length;
    t.eq(Object.keys(G.soldiers).length, back);
    if (back) t.eq(sky.status, 'returning');
    t.eq(G.activeMission, null);
    // finishMission de uma batalha a meio também aborta
    const ufo2 = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    if (back) {
      arrive(sky, 'ufo', ufo2);
      const B2 = OV.Battle.create(C.startMission(G, { kind: 'ufo', id: ufo2.id }, sky.id));
      drain(OV.Battle.beginBattle(B2));
      t.eq(C.finishMission(G, B2).debrief.result, 'abort');
    }
  });

  t.test('ciclo real: World.order → craftArrived (mission) → startMission → batalha → finishMission → craftReturned', () => {
    const G = freshG(5);
    const sky = skyOf(G);
    const ufo = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    ufo.crashLeftS = 86400 * 3;
    t.eq(OV.World.order(G, sky.id, { kind: 'ufo', id: ufo.id }), { ok: true });
    let arrived = null;
    for (let k = 0; k < 2000 && !arrived; k++) {
      OV.World.step(G, 12);
      for (const e of G.events.splice(0)) if (e.t === 'craftArrived') arrived = e;
    }
    t.ok(arrived && arrived.prompt === 'mission', 'chegou com pedido de missão');
    const m = C.startMission(G, arrived.target, arrived.craftId);
    t.eq(OV.World.step(G, 12), { ticks: 0, stopped: true, reason: 'battle' }, 'o mundo para durante a batalha');
    const B = playBot(OV.Battle.create(m), 30);
    const model = C.finishMission(G, B);
    t.eq(G.activeMission, null);
    let back = null;
    for (let k = 0; k < 2000 && !back; k++) {
      const r = OV.World.step(G, 12);
      t.ok(r.reason !== 'battle');
      for (const e of G.events.splice(0)) if (e.t === 'craftReturned') back = e;
    }
    if (!model.craftLost) {
      t.ok(back && back.craftId === sky.id, 'a nave voltou à base');
      t.ok(['repair', 'rearm', 'refuel', 'ready'].indexOf(sky.status) >= 0, sky.status);
    }
  });

  t.test('equipPool/applyEquip: conservação no hangar e fora; resultado inválido recusado', () => {
    const G = freshG(29);
    const sky = skyOf(G);
    const base = G.bases[0];
    const usable = (k) => D.items[k] && D.items[k].battle !== false && D.items[k].kind !== 'corpse';
    const total = () => {
      const o = {};
      const add = (k, n) => { o[k] = (o[k] | 0) + n; };
      for (const k of Object.keys(sky.equipment)) add(k, sky.equipment[k]);
      for (const k of Object.keys(base.stores)) add(k, base.stores[k]);
      return o;
    };
    const before = total();
    const pool = C.equipPool(G, sky.id);
    t.eq(pool.squad.length, 8);
    t.eq(Object.keys(pool.squad[0]).sort(), ['armour', 'female', 'id', 'loadout', 'name', 'nat', 'portraitSeed', 'rank', 'stats']);
    t.ok(!pool.stores.stingray && !pool.stores.cannon_rounds && pool.stores.rifle > 0, 'só itens de combate; armazém incluído no hangar');
    // simula o ecrã: o primeiro soldado troca tudo por uma espingarda do armazém
    const st = Object.assign({}, pool.stores);
    const lo = {};
    for (const s of pool.squad) lo[s.id] = JSON.parse(JSON.stringify(s.loadout));
    const first = lo[pool.squad[0].id];
    for (const k of [first.R, first.L].concat(first.belt, first.pack)) if (k) st[k] = (st[k] | 0) + 1;
    lo[pool.squad[0].id] = { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip'], pack: [] };
    st.rifle--; st.rifle_clip -= 2;
    t.eq(C.applyEquip(G, sky.id, { loadouts: lo, stores: st }), { ok: true });
    t.eq(G.soldiers[pool.squad[0].id].loadout, lo[pool.squad[0].id]);
    t.eq(total(), before, 'nada criado nem destruído');
    const tpl = {};
    for (const sid of sky.soldiers) for (const k of [G.soldiers[sid].loadout.R].concat(G.soldiers[sid].loadout.belt, G.soldiers[sid].loadout.pack)) if (k) tpl[k] = (tpl[k] | 0) + 1;
    for (const k of Object.keys(tpl)) t.ok((sky.equipment[k] | 0) >= tpl[k], 'invariante ⊇ modelos: ' + k);
    // resultado que cria itens ⇒ recusado sem mexer em nada
    const snap = JSON.stringify(G);
    const cheat = Object.assign({}, C.equipPool(G, sky.id).stores);
    cheat.heavy_plasma = 5;
    t.eq(C.applyEquip(G, sky.id, { loadouts: {}, stores: cheat }).reason, 'mismatch');
    t.eq(JSON.stringify(G), snap);
    // fora da base: só o equipamento a bordo
    sky.status = 'patrol';
    const away = C.equipPool(G, sky.id);
    let n = 0;
    for (const k of Object.keys(away.stores)) n += away.stores[k];
    let loose = 0;
    for (const k of Object.keys(sky.equipment)) loose += sky.equipment[k];
    for (const k of Object.keys(tpl)) loose -= tpl[k];
    t.eq(n, loose, 'fora: só a carga solta');
    t.ok(Object.keys(away.stores).every(usable));
    const lo2 = {};
    for (const s of away.squad) lo2[s.id] = s.loadout;
    const eqBefore = JSON.stringify(sky.equipment);
    t.eq(C.applyEquip(G, sky.id, { loadouts: lo2, stores: away.stores }), { ok: true });
    t.eq(JSON.stringify(Object.keys(sky.equipment).sort().map((k) => [k, sky.equipment[k]])), JSON.stringify(Object.keys(JSON.parse(eqBefore)).sort().map((k) => [k, JSON.parse(eqBefore)[k]])));
  });

  t.test('availableResearch exclui projetos em curso; availableManufacture segue o investigado', () => {
    const G = freshG(31);
    const all = C.availableResearch(G, 'b1');
    t.ok(all.length > 0);
    t.eq(all, D.researchAvailable(G.researched, G.flags, G.bases[0].stores, G.bases[0].aliens));
    G.bases[0].research.push({ topic: all[0], cost: 10, spent: 0, scientists: 5 });
    t.eq(C.availableResearch(G, 'b1'), all.slice(1));
    t.eq(C.availableResearch(G, 'b404'), []);
    t.eq(C.availableManufacture(G, 'b1'), D.manufactureAvailable([]));
  });

  t.test('baseDefence: abatido pelas defesas, repelido pela guarnição, base perdida ⇒ fim de jogo', () => {
    // 1) defesas de mísseis e OVNI já danificado
    let G = freshG(37);
    G.bases[0].grid.push({ type: 'missile_defence', x: 5, y: 0, daysLeft: 0 }, { type: 'missile_defence', x: 5, y: 1, daysLeft: 0 });
    let u = placeUfo(G, 'flying', 'small_scout', G.bases[0].lon, G.bases[0].lat);
    u.dmg = D.ufos.small_scout.hp - 1;
    G.rng.combat = 1;
    let r;
    for (let k = 0; k < 20; k++) {
      const G2 = JSON.parse(JSON.stringify(G));
      C.rebuildDerived(G2);
      G2.rng.combat = k + 1;
      r = C.baseDefence(G2, 'b1', u.id);
      if (r.result === 'ufoDestroyed') { G = G2; break; }
    }
    t.eq(r.result, 'ufoDestroyed');
    t.eq(r.shots.length, 2);
    t.ok(r.shots.every((s) => (s.hit ? s.dmg >= 250 && s.dmg <= 750 : s.dmg === 0)));
    t.eq(G.ufos.length, 0);
    t.ok(G.events.some((e) => e.t === 'baseDefence' && e.result === 'ufoDestroyed'));
    // 2) guarnição de 14 soldados contra um Couraçado em Recruta: repelido, 1–3 baixas
    G = freshG(41, 0);
    for (let k = 0; k < 6; k++) C.addSoldier(G, C.makeSoldier(G, { baseId: 'b1' }));
    const strength = Object.values(G.soldiers).reduce((s, x) => s + x.stats.tu + x.stats.fire + x.stats.hp, 0);
    t.ok(strength >= OV.TUNE.BASE_DEFENCE_BASE || strength >= 1800, 'guarnição forte: ' + strength);
    u = placeUfo(G, 'landed', 'battleship', G.bases[0].lon, G.bases[0].lat);
    const xBefore = G.score.month.xcom.total;
    r = C.baseDefence(G, 'b1', u.id);
    t.eq(r.result, 'repelled');
    t.ok(r.soldiersLost.length >= 1 && r.soldiersLost.length <= 3);
    t.eq(Object.keys(G.soldiers).length, 14 - r.soldiersLost.length);
    t.eq(G.score.month.xcom.total - xBefore, D.ufos.battleship.score);
    t.eq(G.ufos.length, 0);
    // 3) sem guarnição (todos fora numa nave em voo) ⇒ base perdida, fim de jogo
    G = freshG(43, 2);
    skyOf(G).status = 'out';
    u = placeUfo(G, 'landed', 'battleship', G.bases[0].lon, G.bases[0].lat);
    r = C.baseDefence(G, 'b1', u.id);
    t.eq(r.result, 'lost');
    t.eq([G.bases.length, G.flags.lost, G.flags.lostReason], [0, true, 'baseLost']);
    const types = G.events.map((e) => e.t);
    t.ok(types.indexOf('baseDefence') >= 0 && types.indexOf('baseDefence') < types.indexOf('gameOver'), 'resultado antes do fim de jogo');
  });

};
