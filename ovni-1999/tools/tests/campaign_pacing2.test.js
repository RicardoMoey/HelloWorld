/* Ritmo da campanha, 2.ª passagem (DESIGN.md §14, §22; contrato docs/CAMPAIGN_API.md §11.6): Portugal financiador,
   abertura mais justa (10 soldados, tripulações do mês 0, primeiro terror depois das primeiras quedas, segunda metade
   de janeiro com OVNIs, terror ignorado a meio preço nos meses 0–1), canhão contra o Batedor Pequeno, regiões ao
   alcance do radar, armadura dos mortos recuperada numa vitória, Vingador com menos ligas e a métrica de intervalo do
   bot de campanha. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign, D = OV.Data, GM = OV.GMath, Mi = OV.Missions, DF = OV.Dogfight;
  const LIS = { lon: -9.14, lat: 38.72 };
  const drain = (g) => {
    let x;
    while (!(x = g.next()).done);
    return x.value;
  };

  t.test('Portugal financia: país da base de Lisboa, verba no arranque e total normalizado a $6 M', () => {
    t.ok(D.countries.portugal, 'Data.countries.portugal');
    t.eq([D.countries.portugal.region, D.countries.portugal.fundingBase, D.countries.portugal.fundingCap], ['europe', 120, 2500]);
    t.eq(OV.T(D.countries.portugal.nameKey), 'Portugal');
    t.eq(D.world.countryIds.indexOf('portugal') >= 0 && D.world.countryAt(-8, 39.5), 'portugal', 'contorno Natural Earth');
    for (const seed of [1, 2, 3, 4, 5]) {
      const G = C.newCampaign({ seed, difficulty: 1 });
      t.eq(G.countries.reduce((s, c) => s + c.funding, 0), OV.TUNE.FUNDING_TOTAL || 6000000, 'total');
      const pt = G.countries.find((c) => c.id === 'portugal');
      t.ok(pt && pt.funding >= 100000 && pt.funding <= 250000, 'verba modesta ' + (pt && pt.funding));
      t.eq(G.bases[0].country, 'portugal', 'base de Lisboa num país financiador');
    }
    // pontos em Lisboa contam para Portugal (retângulos de pontuação)
    const G = C.newCampaign({ seed: 9 });
    OV.Economy.addScore(G, 'xcom', 50, LIS.lon, LIS.lat);
    t.eq(G.score.month.xcom.countries, { portugal: 50 });
    t.eq(GM.countryAt(-3.7, 40.42), 'spain', 'Madrid continua em Espanha');
  });

  t.test('equipa inicial: 10 soldados em Recruta e Veterano (Skyranger cheia), 8 em Super-humano', () => {
    t.eq(D.startingBase.soldiersByDifficulty, [10, 10, 8]);
    for (const diff of [0, 1, 2]) {
      const G = C.newCampaign({ seed: 3, difficulty: diff });
      const sky = G.crafts.c1;
      t.eq(sky.soldiers.length, [10, 10, 8][diff]);
      for (const id of sky.soldiers) t.ok(G.soldiers[id].loadout.R, 'armado ' + id);
    }
  });

  t.test('mês 0: primeiro terror +10 dias; meses 0–2: Investigação Alienígena na região da base aos +14 dias', () => {
    const ids = D.scriptsForMonth(0, 1).map((s) => s.id);
    t.eq(ids, ['gameStart', 'firstTerror', 'regionalScouts']);
    for (const m of [1, 2]) t.ok(D.scriptsForMonth(m, 1).some((s) => s.id === 'regionalScouts'), 'mês ' + m);
    t.eq(D.scriptsForMonth(3, 1).map((s) => s.id).indexOf('regionalScouts'), -1, 'só nos meses 0–2');
    const G = C.newCampaign({ seed: 21, difficulty: 1 });
    const ter = G.alienMissions.find((m) => m.script === 'firstTerror');
    const late = G.alienMissions.find((m) => m.script === 'regionalScouts');
    t.eq(ter.countdownS, 10 * 86400);
    t.eq([late.type, late.region, late.countdownS], ['alien_research', G.bases[0].region, 14 * 86400]);
  });

  t.test('terror ignorado: −500 nos meses 0–1, −1 000 a partir do mês 2 (pontos no evento)', () => {
    const pts = [];
    for (const month of [0, 1, 2]) {
      const G = C.newCampaign({ seed: 5, difficulty: 1 });
      G.alienMissions = [];
      G.month = month;
      G.events.length = 0;
      const city = D.citiesById.paris;
      G.sites.push({ id: C.nextId(G, 't'), kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: 'paris', lon: city.lon, lat: city.lat,
        race: 'floater', region: 'europe', country: 'france', leftS: 1800 });
      const before = G.score.month.alien.total;
      Mi.think30m(G);
      const ev = G.events.find((e) => e.t === 'terrorSiteExpired');
      t.ok(ev, 'expirou no mês ' + month);
      t.eq(G.score.month.alien.total - before, ev.points);
      pts.push(ev.points);
    }
    t.eq(pts, [500, 500, 1000]);
    t.eq([0, 1, 2, 7].map((month) => Mi.expiredPoints({ month })), [500, 500, 1000, 1000], 'Missions.expiredPoints (texto da UI)');
  });

  t.test('tripulações do mês 0: tabela de uma dificuldade abaixo nos OVNIs (atributos iguais); terror e mês 1 sem mudança', () => {
    const range = (dep, diff, month) => {
      const r = D.deploymentRange(dep, diff, month);
      return [r.min, r.max];
    };
    t.eq(range('dep_large_scout', 1, 0), range('dep_large_scout', 0));
    t.eq(range('dep_large_scout', 1, 1), range('dep_large_scout', 1));
    t.eq(range('dep_large_scout', 2, 0), range('dep_large_scout', 1));
    t.eq(range('dep_large_scout', 0, 0), range('dep_large_scout', 0));
    t.eq(range('dep_large_scout', 1), range('dep_large_scout', 1), 'sem mês: tabela da dificuldade');
    t.eq(range('dep_terror_site', 1, 0), range('dep_terror_site', 1), 'terror sem redução');
    t.eq(D.crewDifficulty('dep_medium_scout', 1, 0), 0);
    // na batalha: Batedor Grande de Veterano no mês 0 dentro da tabela de Recruta
    const max = D.deploymentRange('dep_large_scout', 0).max;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = OV.Battle.quickMission({ ufoType: 'large_scout', terrain: 'FARM', kind: 'landed', difficulty: 1, month: 0, seed, squadSize: 8 });
      const B = OV.Battle.create(m);
      const aliens = B.units.filter((u) => u.origSide === 'alien').length;
      t.ok(aliens <= max, 'semente ' + seed + ': ' + aliens + ' ≤ ' + max);
      const a = B.units.find((u) => u.origSide === 'alien');
      t.eq(a.stats.fire, D.alienStats(a.type, 1).fire, 'atributos de Veterano');
    }
  });

  t.test('Batedor Pequeno: só o canhão (Stingray desligado) abate-o em Veterano antes da fuga (breakOff 360)', () => {
    t.eq(D.ufos.small_scout.breakOff, 360);
    let crashed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const G = C.newCampaign({ seed, difficulty: 1 });
      const u = {
        id: C.nextId(G, 'u'), type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1, lon: 2.35, lat: 48.85,
        dest: null, alt: 3, speed: 1000, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null,
        objective: false, targetBaseId: null, siteCity: null, siege: null,
      };
      G.ufos.push(u);
      G.crafts.c2.status = 'out';
      const d = DF.create(G, 'c2', u.id);
      DF.toggleWeapon(G, d.id, 0);
      if (DF.autoResolve(G, d.id, 'aggressive') === 'crashed') crashed++;
    }
    t.ok(crashed >= 18, 'quedas ' + crashed + '/20');
  });

  t.test('regiões da tabela: ×4 ao alcance do Radar Grande (≤ 2 600 mn); terror ×4 até 4 000 mn', () => {
    const R = D.missionRules;
    t.eq([R.nearBaseNm, R.nearBaseWeightMul, R.terrorNearBaseNm, R.terrorNearBaseWeightMul], [2600, 4, 4000, 4]);
    t.ok(R.nearBaseNm >= D.facilities.large_radar.radarRange, 'cobre o alcance do Radar Grande');
    const G = C.newCampaign({ seed: 2 });
    const w = Mi.regionWeights(G);
    const near = Object.keys(w).filter((r) => w[r] > D.regions[r].weight).sort();
    t.eq(near, ['europe', 'north_africa']);
  });

  t.test('missão ganha: a armadura de um soldado morto volta ao armazém (derrota: perde-se)', () => {
    const LIVE = { ok: 1, panic: 1 };
    const run = (win) => {
      const G = C.newCampaign({ seed: 17, difficulty: 1 });
      G.alienMissions = [];
      const sky = G.crafts.c1;
      const sid = sky.soldiers[0];
      G.bases[0].stores.personal_armour = 1;
      G.researched.push('personal_armour');
      t.eq(OV.BaseSim.setArmour(G, sid, 'personal_armour').ok, true);
      const u = {
        id: C.nextId(G, 'u'), type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2.35, lat: 48.85,
        dest: null, alt: 0, speed: 0, status: 'crashed', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 86400, lastSeen: null,
        objective: false, targetBaseId: null, siteCity: null, siege: null,
      };
      G.ufos.push(u);
      Object.assign(sky, { status: 'patrol', dest: { kind: 'ufo', id: u.id }, lon: u.lon, lat: u.lat, speed: 0 });
      const B = OV.Battle.create(C.startMission(G, { kind: 'ufo', id: u.id }, sky.id));
      drain(OV.Battle.beginBattle(B));
      const victim = B.units.find((x) => x.soldierId === sid);
      OV.Combat.killUnit(B, victim, null, 'test');
      for (const x of B.units) if ((win ? x.side === 'alien' : x.side === 'xcom') && LIVE[x.status]) OV.Combat.killUnit(B, x, null, 'test');
      const before = G.bases[0].stores.personal_armour | 0;
      const model = C.finishMission(G, B);
      return { G, model, before, sid };
    };
    const w = run(true);
    t.eq(w.model.debrief.result, 'win');
    t.ok(!w.G.soldiers[w.sid] && w.G.dead.some((d) => d.id === w.sid && d.armour === 'personal_armour'), 'morto, no memorial com a armadura');
    t.eq((w.G.bases[0].stores.personal_armour | 0) - w.before, 1, 'armadura recuperada');
    t.eq(w.model.stored.personal_armour, 1, 'listada no material recuperado');
    const l = run(false);
    t.ok(l.model.debrief.result !== 'win');
    t.eq((l.G.bases[0].stores.personal_armour | 0) - l.before, 0, 'derrota: perde-se');
  });

  t.test('Vingador: 25 ligas (ritmo do fim), 2 fontes de energia, 1 navegação', () => {
    t.eq(D.manufacture.avenger.materials, { alien_alloys: 25, ufo_power_source: 2, ufo_navigation: 1 });
  });

  t.test('bot: intervalo sem OVNIs detetados (meses 0–2)', () => {
    const Bot = require('../campaign_bot');
    const DAY = 86400;
    t.eq(Bot.detectGap([], 90 * DAY), 90);
    t.eq(Bot.detectGap([2 * DAY, 10 * DAY, 30 * DAY], 40 * DAY), 20);
    t.eq(Bot.detectGap([5 * DAY, 80 * DAY], 60 * DAY), 55, 'deteções depois do fim não contam');
    t.eq(Bot.detectGap([1 * DAY, 2 * DAY], 20 * DAY), 18, 'cauda até ao fim');
  });
};
