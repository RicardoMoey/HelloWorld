/* Ritmo da campanha (DESIGN.md §14; contrato docs/CAMPAIGN_API.md §8 e §11): chaves de afinação novas, manutenção das
   naves com uma só definição, artigo ufo_<tipo> na primeira recuperação, defesa da base com a guarnição inicial, queda
   junto à costa, rendição na base alienígena, calendário das raças do terror e o bot de campanha (determinismo e
   gravar/carregar a meio). */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign, D = OV.Data, T = OV.TUNE, W = OV.World, BS = OV.BaseSim;
  const LIVE = { ok: 1, panic: 1 };
  const drain = (g) => {
    let x;
    while (!(x = g.next()).done);
    return x.value;
  };
  function freshG(seed, diff) {
    const G = C.newCampaign({ seed: seed || 11, difficulty: diff === undefined ? 1 : diff });
    G.alienMissions = [];
    G.events.length = 0;
    return G;
  }
  function placeUfo(G, status, type, lon, lat, race) {
    const u = {
      id: C.nextId(G, 'u'), type, missionId: null, race: race || 'sectoid', region: OV.GMath.regionAt(lon, lat), traj: 'P0', wp: 0, lon, lat,
      dest: null, alt: 0, speed: 0, status, dmg: 0, detected: true, hyper: false, groundLeftS: 3600, crashLeftS: 86400, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }
  const skyOf = (G) => Object.values(G.crafts).find((c) => c.type === 'skyranger');
  function forceWin(B) {
    for (const u of B.units) if (u.side === 'alien' && LIVE[u.status]) OV.Combat.killUnit(B, u, null, 'test');
  }
  function battleAt(G, ref, obj) {
    const sky = skyOf(G);
    Object.assign(sky, { status: 'patrol', dest: { kind: ref.kind, id: obj.id }, lon: obj.lon, lat: obj.lat, speed: 0 });
    const m = C.startMission(G, ref, sky.id);
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    forceWin(B);
    return C.finishMission(G, B);
  }

  t.test('afinação: chaves novas do contrato em OV.TUNE (§8)', () => {
    t.eq(T.MISSION_ARRIVE_NM, 5);
    t.eq([T.BASE_DEFENCE_CREW_PCT, T.BASE_DEFENCE_TIER_PCT, T.BASE_DEFENCE_FACILITY_PCT, T.BASE_DEFENCE_FACILITY_CAP_PCT, T.BASE_DEFENCE_CASUALTY_PCT, T.RETALIATION_WARNING_MIN], [50, 20, 25, 66, 40, 1440]);
    t.eq(T.ALIEN_BASE_SURRENDER, ['commander', 'leader']);
    t.eq(D.missionRules.terrorNearBaseWeightMul, 4);
    t.eq(D.missionRules.crashCoastNm, 180);
  });

  t.test('manutenção: uma só definição (Data.craftServiceStatus) para o World ao aterrar e para o BaseSim', () => {
    const G = freshG(5);
    const c2 = C.findCraft(G, 'c2');
    const def = D.crafts.interceptor;
    const cases = [
      [() => {}, 'ready'],
      [() => { c2.fuel = def.fuel - 1; }, 'refuel'],
      [() => { c2.weapons[0].ammo -= 1; }, 'rearm'],
      [() => { c2.hp -= 1; }, 'repair'],
    ];
    for (const [mut, want] of cases) {
      mut();
      t.eq([D.craftServiceStatus(c2, 0), W.checkup(G, 'c2'), BS.serviceStatus(G, 'c2')], [want, want, want], want);
    }
    t.eq(D.craftServiceStatus(c2, 1), 'rearm', 'a partir da etapa rearmar');
    t.eq(D.craftServiceStatus(c2, 2), 'refuel', 'a partir da etapa reabastecer');
    // aterragem: o World entrega a nave ao BaseSim.checkup (reparar primeiro)
    const b = G.bases[0];
    Object.assign(c2, { status: 'returning', dest: { kind: 'base', id: b.id }, lon: b.lon + 0.01, lat: b.lat, speed: def.speed });
    W.moveCrafts(G);
    t.eq([c2.status, c2.speed, c2.dest], ['repair', 0, null]);
    t.ok(G.events.some((e) => e.t === 'craftReturned' && e.craftId === 'c2'));
  });

  t.test('Ufopédia: a primeira recuperação de um tipo de OVNI abre ufo_<tipo>; uma derrota não', () => {
    const G = freshG(7);
    t.ok(G.ufopaedia.indexOf('ufo_small_scout') < 0);
    const u = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    const model = battleAt(G, { kind: 'ufo', id: u.id }, u);
    t.eq(model.debrief.result, 'win');
    t.ok(G.ufopaedia.indexOf('ufo_small_scout') >= 0, 'artigo aberto');
    t.eq(G.ufopaedia.filter((a) => a === 'ufo_small_scout').length, 1, 'sem duplicados');
    // derrota (equipa toda morta): nada recuperado, artigo fechado
    const G2 = freshG(7);
    const u2 = placeUfo(G2, 'crashed', 'medium_scout', 2.35, 48.85);
    const sky = skyOf(G2);
    Object.assign(sky, { status: 'patrol', dest: { kind: 'ufo', id: u2.id }, lon: u2.lon, lat: u2.lat, speed: 0 });
    const B = OV.Battle.create(C.startMission(G2, { kind: 'ufo', id: u2.id }, sky.id));
    drain(OV.Battle.beginBattle(B));
    for (const x of B.units) if (x.side === 'xcom' && LIVE[x.status]) OV.Combat.killUnit(B, x, null, 'test');
    C.finishMission(G2, B);
    t.ok(G2.ufopaedia.indexOf('ufo_medium_scout') < 0);
  });

  t.test('defesa da base: guarnição inicial repele um Couraçado em Recruta; o casco perdido e as defesas contam (até 66 % dos soldados)', () => {
    // exigência = BASE_DEFENCE_CREW_PCT % da tripulação esperada × casco que resta (contrato §5.9, persona r4); o
    // resultado é sorteado pelo rácio força/exigência (persona r5, §11.12): ≥ 150 % repele sempre, ≤ 50 % cai sempre
    const powerOf = (list) => list.reduce((s, x) => s + C.defenderPower(x), 0);
    for (const seed of [3, 4, 5, 6]) {
      const G = freshG(seed, 0);
      G.month = 3;
      const u = placeUfo(G, 'flying', 'battleship', G.bases[0].lon, G.bases[0].lat);
      const need = Math.floor((C.assaultForce(G, u) * T.BASE_DEFENCE_CREW_PCT) / 100);
      t.ok(powerOf(Object.values(G.soldiers)) >= 1.5 * need, 'guarnição inicial ≥ 150 % de ' + need);
      const r = C.baseDefence(G, 'b1', u.id);
      t.eq([r.result, r.held, r.odds.repelPct], ['repelled', false, 100], 'semente ' + seed);
      t.ok(r.soldiersLost.length >= 1 && r.soldiersLost.length <= 3);
    }
    // Veterano, mês 3: 5 soldados em casa não chegam, nem com duas Defesas de Mísseis; os 10 iniciais sim
    const vet = (atHome, withDefences) => {
      const G = freshG(9, 1);
      G.month = 3;
      const sky = skyOf(G);
      sky.status = 'out';
      const all = Object.values(G.soldiers);
      for (const s of all) {
        if (s.craftId) OV.Campaign.removeById(sky.soldiers, s.id);
        s.craftId = null;
      }
      for (const s of all.slice(atHome)) {
        s.craftId = sky.id;
        sky.soldiers.push(s.id);
      }
      if (withDefences) G.bases[0].grid.push({ type: 'missile_defence', x: 5, y: 0, daysLeft: 0 }, { type: 'missile_defence', x: 5, y: 1, daysLeft: 0 });
      const u = placeUfo(G, 'flying', 'battleship', G.bases[0].lon, G.bases[0].lat);
      const r = C.baseDefence(G, 'b1', u.id);
      return { r, G };
    };
    const bare = vet(5, false);
    t.ok(bare.r.odds.ratio < 65 && bare.r.odds.lostPct >= 70 && bare.r.odds.repelPct <= 15, 'só 5 soldados: ' + JSON.stringify(bare.r.odds));
    const def = vet(5, true);
    t.ok(def.r.odds.ratio > bare.r.odds.ratio && def.r.odds.ratio < T.BASE_DEFENCE_RATIO_MID && def.r.odds.lostPct > 0,
      'as defesas ajudam mas não substituem a guarnição: ' + JSON.stringify(def.r.odds));
    // 1 soldado com 3 Defesas de Mísseis (exploit da ronda 4) cai sempre
    const one = vet(1, true);
    t.eq([one.r.result, one.r.odds.lostPct], ['lost', 100], JSON.stringify(one.r.odds));
    const full = vet(10, false);
    t.ok(full.r.odds.ratio >= T.BASE_DEFENCE_RATIO_MID && full.r.odds.lostPct === 0, 'os 10 iniciais: ' + JSON.stringify(full.r.odds));
    t.eq(full.r.result, 'repelled');
  });

  t.test('queda no mar a ≤ 180 mn da costa cai em terra; no alto mar o OVNI é destruído', () => {
    const G = freshG(13);
    // 1° a oeste de Peniche (≈ 50 mn de costa)
    const u = placeUfo(G, 'flying', 'medium_scout', -10.4, 39.4);
    t.ok(!OV.GMath.isLand(u.lon, u.lat), 'começa no mar');
    OV.Missions.onUfoDown(G, u.id, 'crashed', 'c2');
    t.eq(u.status, 'crashed');
    t.ok(OV.GMath.isLand(u.lon, u.lat), 'local da queda em terra');
    t.ok(OV.GMath.distNmLL(u.lon, u.lat, -10.4, 39.4) <= 180);
    t.ok(G.events.some((e) => e.t === 'ufoCrashed' && e.ufoId === u.id && e.lon === u.lon));
    const v = placeUfo(G, 'flying', 'medium_scout', -30, 40); // Atlântico, longe de tudo
    OV.Missions.onUfoDown(G, v.id, 'crashed', 'c2');
    t.ok(!C.findUfo(G, v.id), 'afundou');
    t.ok(G.events.some((e) => e.t === 'ufoDestroyed' && e.ufoId === v.id));
  });

  t.test('base alienígena tomada: o posto de comando (comandante e líder) rende-se se houver contenção; sem contenção, nada', () => {
    const mk = (withContainment) => {
      const G = freshG(17, 1);
      if (withContainment) G.bases[0].grid.push({ type: 'alien_containment', x: 5, y: 3, daysLeft: 0 });
      const a = {
        id: C.nextId(G, 'a'), lon: 10, lat: 50, race: 'sectoid', region: OV.GMath.regionAt(10, 50), country: OV.GMath.countryAt(10, 50),
        missionId: null, discovered: true, foundT: 0, supplyT: null,
      };
      G.alienBases.push(a);
      return { G, model: battleAt(G, { kind: 'alienBase', id: a.id }, a) };
    };
    const { G, model } = mk(true);
    t.eq(model.debrief.result, 'win');
    // o posto de comando rende-se: 1 comandante e 1 líder (persona r5: à parte da tripulação da batalha)
    t.eq(G.bases[0].aliens, { sectoid_commander: 1, sectoid_leader: 1 });
    t.eq(model.capturedStored, { sectoid_commander: 1, sectoid_leader: 1 });
    t.eq(model.surrendered, { sectoid_commander: 1, sectoid_leader: 1 }, 'rendição à parte no modelo do relatório');
    t.ok(G.stats.aliensCaptured >= 2);
    t.eq(G.alienBases.length, 0);
    // a cadeia da história fica ao alcance: o líder dá «interrogado» (e, retroativamente, a bandeira das Origens) e o
    // comandante a sua depois da Solução Marciana
    t.ok(C.availableResearch(G, 'b1').indexOf('interrogate_sectoid_leader') >= 0);
    const none = mk(false);
    t.eq(none.G.bases[0].aliens, {});
  });

  t.test('terror nos meses 0–1: só raças vencíveis com espingardas/lasers (sem Ciberdiscos em massa nem Crisálidas)', () => {
    t.eq(D.raceWeights('alien_terror', 0), { floater: 100 });
    t.eq(D.raceWeights('alien_terror', 1), { floater: 100 });
    t.ok(!D.raceWeights('alien_terror', 2).snakeman, 'Crisálidas só a partir do mês 3');
  });

  t.test('bot de campanha: mesma semente ⇒ mesmo resultado; gravar/carregar a meio (OV.Save) não muda nada', () => {
    const Bot = require('../campaign_bot');
    const a = Bot.run({ OV, seed: 3, difficulty: 1, days: 8 });
    const b = Bot.run({ OV, seed: 3, difficulty: 1, days: 8 });
    const c = Bot.run({ OV, seed: 3, difficulty: 1, days: 8, saveMidDay: 4 });
    t.ok(c.savedMid, 'gravou a meio');
    t.eq(b.hash, a.hash);
    t.eq(c.hash, a.hash);
    t.eq(c.battleLog, a.battleLog);
    for (const k of ['endDay', 'reason', 'battles', 'byKind', 'soldiersLost', 'ratings', 'funds', 'research', 'ufos', 'terror', 'pacts']) t.ok(k in a, 'campo ' + k);
    t.eq(a.reason, 'timeout');
    t.ok(a.ufos.detected >= 1, 'deteta OVNIs na 1.ª semana');
  });
};
