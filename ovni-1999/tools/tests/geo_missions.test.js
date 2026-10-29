/* Testes do OV.Missions (DESIGN.md §3.18; contrato docs/CAMPAIGN_API.md §1.11–§1.14, §3.2, §5.4, §9): guião dos meses
   0 e 1, pesos das regiões, ciclo de vagas, trajetórias (aterragens, saída), terror (aparece e expira, −1 000),
   abate (queda em água ⇒ destruído), bases alienígenas (criação, abastecimento, revelação), retaliação, infiltração,
   determinismo e 60 dias sem jogador. Os módulos dos colegas são isolados; Economy é um duplo que regista pontos. */
module.exports = function (OV, t) {
  const Mi = OV.Missions, W = OV.World, Camp = OV.Campaign, GM = OV.GMath, D = OV.Data, C = OV.Clock;
  const MODS = ['BaseSim', 'Economy', 'Soldiers', 'Dogfight'];
  function iso(doubles, fn) {
    const saved = {};
    for (const k of MODS) { saved[k] = OV[k]; delete OV[k]; }
    Object.assign(OV, doubles || {});
    try { return fn(); } finally {
      for (const k of MODS) { if (saved[k] === undefined) delete OV[k]; else OV[k] = saved[k]; }
    }
  }
  // Economy duplo: só regista addScore
  function econ(log) {
    return { Economy: { addScore(G, side, pts, lon, lat) { log.push({ side, pts, lon, lat }); } } };
  }
  const LIS = { lon: -9.14, lat: 38.72 };
  function fresh(seed, difficulty) {
    const G = Camp.newCampaign({ seed: seed || 7, difficulty: difficulty === undefined ? 1 : difficulty });
    G.alienMissions = [];
    G.ufos = [];
    G.events = [];
    return G;
  }
  function run(G, ticks, onEvent) {
    let left = ticks;
    while (left > 0) {
      const r = W.step(G, Math.min(left, 17280));
      left -= r.ticks;
      for (const e of G.events.splice(0)) if (onEvent) onEvent(e);
      if (r.ticks === 0) break;
    }
  }
  const minutes = (s) => s / 60;

  // ---- guião ------------------------------------------------------------------------------------------------------
  t.test('planMonth mês 0: Investigação Alienígena (Sectoides, região da base, +120 min) e primeiro terror (+3 dias)', () => {
    iso({}, () => {
      for (const seed of [1, 2, 3, 4]) {
        const G = Camp.newCampaign({ seed, difficulty: 1 });
        t.eq(G.plannedMonth, 0);
        t.eq(G.events.length, 0, 'sem eventos visíveis');
        const res = G.alienMissions.find((m) => m.script === 'gameStart');
        t.eq([res.type, res.region, res.race, res.countdownS, res.wave], ['alien_research', 'europe', 'sectoid', 120 * 60, 0]);
        const ter = G.alienMissions.find((m) => m.script === 'firstTerror');
        t.eq([ter.type, ter.countdownS], ['alien_terror', 3 * 86400]);
        t.ok(D.citiesById[ter.cityId] && D.citiesById[ter.cityId].region === ter.region, 'cidade da região');
        t.ok(D.raceWeights('alien_terror', 0)[ter.race] > 0);
        t.eq(G.alienMissions.length, 2);
        t.eq(Mi.planMonth(G), [], 'não repete o mês');
      }
    });
  });
  t.test('planMonth mês 1: terror, base alienígena perto da base X-COM (≤ 4 000 mn) e uma missão da tabela', () => {
    iso({}, () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const G = fresh(seed);
        G.month = 1;
        Mi.planMonth(G);
        const by = (s) => G.alienMissions.filter((m) => m.script === s);
        t.eq(by('recurringTerror').length, 1);
        t.eq(by('recurringTerror')[0].countdownS, 150 * 60);
        const seedB = by('seedAlienBase');
        t.eq(seedB.length, 1);
        t.eq(seedB[0].type, 'alien_base');
        const c = D.regions[seedB[0].region].centroid;
        t.ok(GM.distNm(LIS, { lon: c[0], lat: c[1] }) <= 4000, 'região perto: ' + seedB[0].region);
        t.eq(by('recon').length, 1);
        t.ok(D.regions[by('recon')[0].region].missionWeights[by('recon')[0].type] > 0, 'tipo da tabela da região');
        t.eq(G.alienMissions.length, 3);
      }
    });
  });
  t.test('pesos das regiões da tabela: ×3 com o centróide a ≤ 4 000 mn da base; oceanos fora', () => {
    const G = fresh();
    const w = Mi.regionWeights(G);
    t.eq(w.europe, D.regions.europe.weight * 3);
    t.eq(w.north_africa, D.regions.north_africa.weight * 3);
    t.eq(w.australasia, D.regions.australasia.weight);
    t.eq(w.north_atlantic, undefined);
    t.eq(w.pacific, D.regions.pacific.weight);
  });
  t.test('raça: bases alienígenas e Couraçados sem Mutões até haver um comandante interrogado', () => {
    iso({}, () => {
      const G = fresh(3);
      G.month = 9;
      const races = {};
      for (let k = 0; k < 120; k++) races[Mi.spawnMission(G, 'alien_base', { region: 'europe' }).race] = 1;
      t.ok(!races.muton, 'sem Mutões: ' + Object.keys(races));
      // Couraçado de uma missão Mutão também troca de raça
      const m = Mi.spawnMission(G, 'alien_harvest', { region: 'europe', race: 'muton' });
      m.wave = D.alienMissions.alien_harvest.waves.length - 1;
      const u = Mi.spawnUfo(G, m.id);
      t.eq(u.type, 'battleship');
      t.ok(u.race !== 'muton');
      G.flags.commanderInterrogated = true;
      const seen = {};
      for (let k = 0; k < 120; k++) seen[Mi.spawnMission(G, 'alien_base', { region: 'europe' }).race] = 1;
      t.ok(seen.muton, 'com comandante já podem ser Mutões');
    });
  });

  // ---- vagas e trajetórias ------------------------------------------------------------------------------------
  t.test('ciclo de vagas: a 1.ª nave sai à hora, as seguintes pelo temporizador (T/2..1,5T), uma vaga dupla', () => {
    iso({}, () => {
      const G = fresh(9);
      const def = D.alienMissions.alien_research;
      const m = Mi.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 120 });
      const spawnT = [];
      for (let k = 0; k < 4; k++) Mi.think30m(G);
      t.eq(G.ufos.length, 1, 'ao fim de 2 h');
      t.eq(G.ufos[0].type, 'small_scout');
      t.eq([m.wave, m.ufoCounter], [1, 0]);
      const w1 = def.waves[1].timer * 60;
      t.ok(m.countdownS >= Math.floor(w1 / 2 / 1800) * 1800 && m.countdownS <= Math.floor(w1 / 2 / 1800) * 1800 + w1, 'contagem ' + minutes(m.countdownS));
      // corre as contagens até ao fim das vagas (sem mexer nos OVNIs)
      for (let k = 0; k < 2000 && m.wave < def.waves.length; k++) {
        const n = G.ufos.length;
        Mi.think30m(G);
        if (G.ufos.length > n) spawnT.push(G.ufos[G.ufos.length - 1].type);
      }
      t.eq(spawnT, ['medium_scout', 'large_scout', 'large_scout']);
      t.eq(m.liveUfos.length, 4);
      for (const u of G.ufos) {
        t.eq([u.missionId, u.race, u.region, u.wp, u.status], [m.id, 'sectoid', 'europe', 1, 'flying']);
        const c = D.regions.europe.centroid;
        const deg = GM.distNm({ lon: c[0], lat: c[1] }, u) / 60;
        t.ok(deg >= 25 - 1e-6 && deg <= 35 + 1e-6, 'entra no anel da zona 5');
        t.eq(u.speed, Math.floor(D.ufos[u.type].speed * D.trajectories[u.traj].pts[0][2] / 100));
      }
      // missão só acaba quando os OVNIs saem
      for (const u of G.ufos.slice()) Mi.removeUfo(G, u.id);
      t.eq(Camp.findAlienMission(G, m.id), null);
    });
  });
  t.test('trajetória P2: voa os pontos, aterra na zona 1 (5 s se for água), descola com pontos e sai pela zona 5', () => {
    const log = [];
    iso(econ(log), () => {
      const G = fresh(4);
      const m = Mi.spawnMission(G, 'alien_harvest', { region: 'north_africa', race: 'floater', delayMin: 30 });
      m.wave = 1; // vaga 2: Batedor Pequeno P2
      Mi.think30m(G);
      const u = G.ufos[0];
      t.eq([u.type, u.traj], ['small_scout', 'P2']);
      u.detected = true;
      const seen = [];
      let landedAt = null, wasLand = null;
      for (let k = 0; k < 40 * 720 && Camp.findUfo(G, u.id); k++) {
        W.moveUfos(G);
        for (const e of G.events.splice(0)) seen.push(e.t);
        if (u.status === 'landed' && !landedAt) {
          landedAt = { lon: u.lon, lat: u.lat };
          wasLand = GM.isLand(u.lon, u.lat);
          t.eq(u.groundLeftS, wasLand ? D.trajectories.P2.groundS : 5);
          t.eq([u.wp, u.alt, u.speed, u.dest], [4, 0, 0, null]);
          t.ok(GM.inAreas(D.regions.north_africa.missionZones[1], u.lon, u.lat), 'aterra na zona 1');
        }
      }
      t.ok(landedAt, 'aterrou');
      t.eq(Camp.findUfo(G, u.id), null, 'saiu');
      t.ok(seen.indexOf('ufoLanded') >= 0 && seen.indexOf('ufoLiftOff') > seen.indexOf('ufoLanded') && seen.indexOf('ufoGone') > 0, seen.join(','));
      t.ok(log.some((s) => s.side === 'alien' && s.pts === 30 && s.lon === landedAt.lon), 'Colheita: +30 ao descolar');
    });
  });
  t.test('aterragem de OVNI não detetado: sem eventos (não denuncia OVNIs escondidos)', () => {
    iso({}, () => {
      const G = fresh(4);
      const m = Mi.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 30 });
      m.wave = 1;
      Mi.think30m(G);
      const u = G.ufos[0];
      for (let k = 0; k < 40 * 720 && Camp.findUfo(G, u.id); k++) W.moveUfos(G);
      t.eq(G.events.filter((e) => /^ufo/.test(e.t)).length, 0);
    });
  });

  // ---- terror -------------------------------------------------------------------------------------------------
  t.test('terror: a Nave de Terror vira local na cidade (sem teste de terra), dura 8–16 h e expira com −1 000', () => {
    const log = [];
    iso(econ(log), () => {
      const G = fresh(12);
      const m = Mi.spawnMission(G, 'alien_terror', { region: 'south_america', race: 'floater', cityId: 'buenos_aires', delayMin: 30 });
      m.wave = 1;
      let site = null, expired = null;
      run(G, 20 * 17280, (e) => {
        if (e.t === 'terrorSite') site = Object.assign({}, e, { leftS: Camp.findSite(G, e.siteId).leftS });
        if (e.t === 'terrorSiteExpired') expired = e;
      });
      t.ok(site, 'local criado');
      const city = D.citiesById.buenos_aires;
      t.eq([site.cityId, site.lon, site.lat, site.race], ['buenos_aires', city.lon, city.lat, 'floater']);
      t.ok(!GM.isLand(city.lon, city.lat), 'cidade costeira numa célula de mar, mesmo assim local de terror');
      t.ok(site.leftS >= 8 * 3600 && site.leftS <= 16 * 3600 && site.leftS % 3600 === 0, 'duração ' + site.leftS);
      t.ok(log.some((s) => s.side === 'alien' && s.pts === 10 && s.lon === city.lon), '+10 ao criar o local');
      t.ok(expired, 'expirou');
      t.eq(expired.points, 1000);
      t.ok(log.some((s) => s.side === 'alien' && s.pts === 1000 && s.lat === city.lat));
      t.eq(G.sites.length, 0);
      t.eq(G.stats.terrorIgnored, 1);
      t.eq(Camp.findAlienMission(G, m.id), null, 'missão terminou');
    });
  });
  t.test('terror: a nave que segue o local recebe targetLost quando expira; vitória limpa o local', () => {
    iso({}, () => {
      const G = fresh(12);
      G.sites.push({ id: 't1', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: 'madrid', lon: -3.75, lat: 40.375, race: 'floater', region: 'europe', country: 'spain', leftS: 1800 });
      W.launch(G, 'c2', { kind: 'site', id: 't1' });
      Mi.think30m(G);
      t.ok(G.events.some((e) => e.t === 'targetLost' && e.craftId === 'c2' && e.target.kind === 'site'));
      t.eq(Camp.findCraft(G, 'c2').dest.kind, 'point');
      G.sites.push({ id: 't2', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: 'paris', lon: 2.375, lat: 48.75, race: 'floater', region: 'europe', country: 'france', leftS: 9000 });
      Mi.onSiteCleared(G, { kind: 'site', id: 't2' }, 'abort');
      t.ok(Camp.findSite(G, 't2'), 'abortar não limpa');
      Mi.onSiteCleared(G, { kind: 'site', id: 't2' }, 'win');
      t.eq(Camp.findSite(G, 't2'), null);
    });
  });

  // ---- abates -------------------------------------------------------------------------------------------------
  t.test('onUfoDown: queda em terra → local 24–72 h, pontos X-COM, atraso da vaga; sobre água → destruído', () => {
    const log = [];
    iso(econ(log), () => {
      const G = fresh(5);
      const m = Mi.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid', delayMin: 30 });
      Mi.think30m(G);
      const u = G.ufos[0];
      Object.assign(u, { lon: 2.35, lat: 46.5, detected: true }); // França
      const cd = m.countdownS;
      Mi.onUfoDown(G, u.id, 'crashed', 'c2');
      t.eq([u.status, u.speed, u.alt, u.dest], ['crashed', 0, 0, null]);
      t.ok(u.crashLeftS >= 24 * 3600 && u.crashLeftS <= 72 * 3600 && u.crashLeftS % 3600 === 0);
      const delay = m.countdownS - cd;
      t.ok(delay >= 30 * 48 * 60 && delay <= 30 * 248 * 60 && delay % 1800 === 0, 'atraso ' + delay);
      t.ok(log.some((s) => s.side === 'xcom' && s.pts === D.ufos.small_scout.score));
      t.eq(G.events.find((e) => e.t === 'ufoCrashed').craftId, 'c2');
      t.eq(G.stats.ufosShotDown, 1);
      t.ok(m.liveUfos.indexOf(u.id) >= 0, 'o local da queda conta como OVNI vivo');
      // o local desaparece com o tempo
      u.crashLeftS = 1800;
      Mi.think30m(G);
      t.eq(Camp.findUfo(G, u.id), null);
      t.ok(G.events.some((e) => e.t === 'crashSiteExpired' && e.ufoId === u.id));
      // no meio do Atlântico: destruído
      m.countdownS = 0;
      Mi.think30m(G);
      const v = G.ufos[0];
      Object.assign(v, { lon: -40, lat: 35, detected: true });
      Mi.onUfoDown(G, v.id, 'crashed', 'c3');
      t.eq(Camp.findUfo(G, v.id), null);
      const de = G.events.find((e) => e.t === 'ufoDestroyed');
      t.eq([de.ufoId, de.craftId, de.type, de.score], [v.id, 'c3', 'medium_scout', D.ufos.medium_scout.scoreDestroyed]);
      t.eq(G.stats.ufosDestroyed, 1);
    });
  });
  t.test('onUfoDown: retaliação por abate a partir do mês 2 (sem duplicar a região) e só depois', () => {
    iso({}, () => {
      const G = fresh(8, 2);
      const m = Mi.spawnMission(G, 'alien_research', { region: 'asia', race: 'floater', delayMin: 30 });
      const shoot = () => {
        m.wave = 0;
        m.ufoCounter = 0;
        m.countdownS = 0;
        Mi.think30m(G);
        const u = G.ufos[G.ufos.length - 1];
        Object.assign(u, { lon: 0, lat: -40 }); // água
        Mi.onUfoDown(G, u.id, 'destroyed', 'c2');
      };
      for (let k = 0; k < 30; k++) shoot();
      t.eq(G.alienMissions.filter((x) => x.type === 'alien_retaliation').length, 0, 'mês 0: nunca');
      G.month = 2;
      for (let k = 0; k < 80; k++) shoot();
      const ret = G.alienMissions.filter((x) => x.type === 'alien_retaliation');
      t.ok(ret.length >= 1 && ret.length <= 2, 'retaliações: ' + ret.length);
      for (const r of ret) {
        t.ok(r.region === 'asia' || r.region === 'europe', r.region);
        t.eq(r.race, 'floater', 'raça do OVNI abatido');
        t.ok(r.countdownS <= 3000 * 60 && (3000 * 60 - r.countdownS) % 1800 === 0, 'primeiro OVNI a 50 h');
      }
      t.eq(new Set(ret.map((r) => r.region)).size, ret.length, 'uma por região');
      t.ok(G.events.some((e) => e.t === 'retaliation'));
      t.eq(G.alien.retaliations.length, ret.length);
    });
  });
  t.test('retaliação: o OVNI encontra a base X-COM (scan10m) e segue-se o Couraçado do ataque à base', () => {
    iso({}, () => {
      const G = fresh(6);
      const m = Mi.spawnMission(G, 'alien_retaliation', { region: 'europe', race: 'sectoid', delayMin: 30 });
      Mi.think30m(G);
      const u = G.ufos[0];
      t.eq(u.traj, 'P8');
      u.wp = 3;
      Object.assign(u, GM.destination(LIS, 10, 100));
      for (let k = 0; k < 200 && !m.targetBaseId; k++) Mi.scan10m(G);
      t.eq(m.targetBaseId, 'b1');
      t.eq(Camp.findBase(G, 'b1').spotted, true);
      m.countdownS = 0;
      Mi.think30m(G);
      const bs = G.ufos.find((x) => x.targetBaseId === 'b1');
      t.ok(bs, 'Couraçado lançado');
      t.eq([bs.type, bs.traj, bs.objective], ['battleship', 'assault', true]);
      t.eq([bs.dest.lon, bs.dest.lat], [LIS.lon, LIS.lat]);
      const n = G.ufos.length;
      for (let k = 0; k < 50; k++) Mi.think30m(G);
      t.eq(G.ufos.length, n, 'não lança mais nada');
    });
  });

  // ---- bases alienígenas, abastecimento, infiltração, agentes -----------------------------------------------------
  t.test('base alienígena: o guião do mês 1 constrói-a na zona 4 perto da base X-COM (+50); a vitória retira-a', () => {
    const log = [];
    iso(econ(log), () => {
      const G = fresh(14);
      G.month = 1;
      G.t = C.monthStartT(1);
      Mi.planMonth(G);
      G.alienMissions = G.alienMissions.filter((m) => m.script === 'seedAlienBase');
      const m = G.alienMissions[0];
      let built = null;
      run(G, 27 * 17280, (e) => { if (e.t === 'alienBaseBuilt' && !built) built = e; });
      t.ok(built, 'base construída');
      const ab = Camp.findAlienBase(G, built.alienBaseId);
      t.ok(C.monthIndex(G.t) >= 1 && ab.missionId === m.id);
      t.eq([ab.region, ab.race, ab.discovered], [m.region, m.race, false]);
      t.ok(ab.race !== 'muton');
      t.ok(GM.distNm(LIS, ab) <= 4000, 'ao alcance: ' + Math.round(GM.distNm(LIS, ab)));
      t.ok(log.some((s) => s.side === 'alien' && s.pts === 50 && s.lon === ab.lon));
      t.eq(Camp.findAlienMission(G, m.id), null);
      Mi.onSiteCleared(G, { kind: 'alienBase', id: ab.id }, 'win');
      t.eq(G.alienBases.length, 0);
    });
  });
  t.test('abastecimento: 6 %/dia por base; a Nave de Abastecimento pousa na base e, seguida, revela-a', () => {
    iso({}, () => {
      const G = fresh(15);
      G.alienBases.push({ id: 'a1', lon: 10, lat: 50, race: 'snakeman', region: 'europe', country: 'germany', missionId: null, discovered: false, foundT: null, supplyT: null });
      let days = 0;
      while (!G.alienMissions.length && days < 400) { Mi.daily(G); days++; }
      const m = G.alienMissions[0];
      t.eq([m.type, m.race, m.alienBaseId, m.region], ['alien_supply', 'snakeman', 'a1', 'europe']);
      for (let k = 0; k < 30; k++) Mi.daily(G);
      t.eq(G.alienMissions.length, 1, 'uma de cada vez');
      m.countdownS = 0;
      Mi.think30m(G);
      const u = G.ufos[0];
      t.eq([u.type, u.traj, u.objective, u.dest.lon, u.dest.lat], ['supply_ship', 'P9', true, 10, 50]);
      u.detected = true;
      for (let k = 0; k < 20000 && u.status === 'flying'; k++) W.moveUfos(G);
      t.eq([u.status, u.lon, u.lat, u.groundLeftS], ['landed', 10, 50, D.trajectories.P9.groundS]);
      t.eq(G.alienBases[0].supplyT, G.t);
      t.eq(G.alienBases[0].discovered, true);
      t.ok(G.events.some((e) => e.t === 'alienBaseFound' && e.how === 'supply'));
      u.groundLeftS = 5;
      W.moveUfos(G);
      t.eq(u.status, 'flying');
      for (let k = 0; k < 20000 && Camp.findUfo(G, u.id); k++) W.moveUfos(G);
      t.eq(Camp.findUfo(G, u.id), null, 'saiu');
      t.eq(G.alienMissions.length, 0);
    });
  });
  t.test('fim do mês: os agentes revelam uma base escondida (~50 %) e registam-no para o relatório', () => {
    iso({}, () => {
      let found = 0;
      for (let s = 1; s <= 60; s++) {
        const G = fresh(s);
        G.alienBases.push({ id: 'a1', lon: 10, lat: 50, race: 'sectoid', region: 'europe', country: 'germany', missionId: null, discovered: false, foundT: null, supplyT: null });
        Mi.monthEnd(G);
        if (G.alienBases[0].discovered) {
          found++;
          t.eq(G.alien.lastReveal, { month: 0, alienBaseId: 'a1' });
          t.ok(G.events.some((e) => e.t === 'alienBaseFound' && e.how === 'agents'));
        } else t.eq(G.alien.lastReveal, null);
      }
      t.ok(found >= 18 && found <= 42, 'revelações ' + found + '/60');
    });
  });
  t.test('infiltração: no fim das vagas um país da região fica com pacto pendente e surge uma base; assina no fim do mês', () => {
    const log = [];
    iso(econ(log), () => {
      const G = fresh(16);
      const m = Mi.spawnMission(G, 'alien_infiltration', { region: 'europe', race: 'sectoid', delayMin: 30 });
      m.wave = D.alienMissions.alien_infiltration.waves.length - 1;
      m.ufoCounter = 1; // último Couraçado da vaga dupla
      m.countdownS = 0;
      Mi.think30m(G);
      t.eq(m.wave, 0, 'recomeça');
      t.eq(G.alienBases.length, 1);
      t.eq(G.alien.pendingPacts.length, 1);
      const cid = G.alien.pendingPacts[0].countryId;
      t.eq(D.countries[cid].region, 'europe');
      t.ok(!log.some((s) => s.pts === 150), 'os 150 só no fim do mês');
      Mi.monthEnd(G);
      const c = G.countries.find((x) => x.id === cid);
      t.eq(c.pact, true);
      t.ok(G.events.some((e) => e.t === 'pactSigned' && e.countryId === cid));
      t.ok(log.some((s) => s.side === 'alien' && s.pts === 150 && GM.countryAt(s.lon, s.lat) === cid));
      t.eq(G.alien.newPacts, { month: 0, countries: [cid] });
      t.eq(G.alien.pendingPacts, []);
      t.ok(Camp.findAlienMission(G, m.id), 'a infiltração nunca acaba');
    });
  });
  t.test('onResearch: a Solução Marciana lança logo uma retaliação na região da base', () => {
    iso({}, () => {
      const G = fresh(17);
      Mi.onResearch(G, 'laser_weapons');
      t.eq(G.alienMissions.length, 0);
      Mi.onResearch(G, 'martian_solution');
      t.eq(G.alienMissions.map((m) => [m.type, m.region, m.script]), [['alien_retaliation', 'europe', 'researchRetaliation']]);
      Mi.onResearch(G, 'martian_solution');
      t.eq(G.alienMissions.length, 1, 'não duplica');
    });
  });

  // ---- campanha sem jogador ------------------------------------------------------------------------------------
  function sixtyDays(seed) {
    const G = Camp.newCampaign({ seed, difficulty: 1 });
    const n = {};
    let baseByMonth2 = false;
    while (G.t < 60 * 86400) {
      const r = W.step(G, 17280);
      for (const e of G.events.splice(0)) n[e.t] = (n[e.t] || 0) + 1;
      if (G.alienBases.length && C.monthIndex(G.t) < 2) baseByMonth2 = true;
      if (r.ticks === 0) break;
    }
    return { G, n, baseByMonth2 };
  }
  t.test('60 dias sem jogador: OVNIs, deteções, aterragens, terror e base alienígena antes do mês 2', () => {
    iso({}, () => {
      for (const seed of [1, 2, 3]) {
        const { G, n, baseByMonth2 } = sixtyDays(seed);
        t.ok(G.ids.seq.u >= 8, 'OVNIs: ' + G.ids.seq.u);
        t.ok(n.ufoDetected >= 2 && G.stats.ufosDetected === n.ufoDetected, 'deteções ' + n.ufoDetected);
        t.ok(n.ufoLanded >= 1, 'aterragens vistas ' + n.ufoLanded);
        t.ok(n.terrorSite >= 2, 'terror ' + n.terrorSite);
        t.ok(n.terrorSiteExpired >= 1);
        t.ok(baseByMonth2, 'base alienígena até ao mês 2');
        t.eq([G.month, G.plannedMonth], [2, 2]);
        t.ok(n.autosaveDue >= 5);
      }
    });
  });
  t.test('determinismo: duas campanhas iguais dão o mesmo hash; JSON a meio e continuar dá o mesmo hash', () => {
    iso({}, () => {
      const a = sixtyDays(21).G, b = sixtyDays(21).G;
      t.eq(Camp.hash(a), Camp.hash(b));
      t.ok(Camp.hash(sixtyDays(22).G) !== Camp.hash(a), 'outra semente, outro mundo');
      const G = Camp.newCampaign({ seed: 30, difficulty: 2 });
      run(G, 20 * 17280);
      const H = JSON.parse(JSON.stringify(G));
      Camp.rebuildDerived(H);
      run(G, 25 * 17280);
      run(H, 25 * 17280);
      t.eq(Camp.hash(H), Camp.hash(G));
    });
  });
};
