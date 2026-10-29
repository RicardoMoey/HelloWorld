/* Testes dos dados do Geoscape: regiões, países, cidades, terrenos, trajetórias, missões, guião mensal,
   raças, constantes do globo, pontuação e textos pt-PT */
module.exports = function (OV, t) {
  const D = OV.Data;

  const REGION_IDS = ['north_america', 'arctic', 'antarctica', 'south_america', 'south_africa', 'north_africa', 'europe', 'russia',
    'asia', 'southeast_asia', 'australasia', 'pacific', 'north_atlantic', 'south_atlantic', 'indian_ocean'];
  const COUNTRY_IDS = ['usa', 'canada', 'brazil', 'uk', 'france', 'germany', 'italy', 'spain', 'russia', 'egypt', 'nigeria',
    'south_africa', 'india', 'china', 'japan', 'australia'];
  const UFO_IDS = ['small_scout', 'medium_scout', 'large_scout', 'harvester', 'abductor', 'supply_ship', 'terror_ship', 'battleship'];
  const MISSION_IDS = ['alien_research', 'alien_harvest', 'alien_abduction', 'alien_infiltration', 'alien_base', 'alien_terror',
    'alien_retaliation', 'alien_supply'];
  const RACES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'mixed'];
  const named = (key) => OV.T.has(key) && OV.T(key).indexOf('⟦') < 0;
  const validArea = (a) => a.length >= 4 && a[0] >= -180 && a[1] <= 180 && a[0] <= a[1] && a[2] >= -90 && a[3] <= 90 && a[2] <= a[3];

  // locais conhecidos [lon, lat]
  const LONDON = [-0.13, 51.5], PARIS = [2.35, 48.86], LISBON = [-9.14, 38.72], PORTO = [-8.61, 41.15], MADRID = [-3.7, 40.42];

  t.test('regiões: os 15 ids fixos, nomes pt-PT, áreas normais e centróide', () => {
    t.eq(Object.keys(D.regions).sort(), REGION_IDS.slice().sort());
    for (const id of REGION_IDS) {
      const r = D.regions[id];
      t.eq(r.id, id);
      t.ok(named(r.nameKey), 'nome ' + id);
      t.ok(r.areas.length > 0 && r.areas.every(validArea), 'áreas ' + id);
      t.ok(Array.isArray(r.centroid) && r.centroid.length === 2 && Math.abs(r.centroid[1]) <= 90, 'centróide ' + id);
      t.ok(typeof r.ocean === 'boolean', 'ocean ' + id);
    }
    t.eq(['north_atlantic', 'south_atlantic', 'indian_ocean'].map((id) => D.regions[id].ocean), [true, true, true]);
    t.eq(D.regions.north_atlantic.missionRegion, 'north_america');
    t.eq(D.regions.south_atlantic.missionRegion, 'antarctica');
    t.eq(D.regions.indian_ocean.missionRegion, 'south_africa');
    t.eq(D.regions.europe.ocean, false);
  });

  t.test('regiões cobrem o globo sem sobreposições (grelha de 1°)', () => {
    let gaps = 0, over = 0;
    for (let lon = -179.5; lon < 180; lon += 1) {
      for (let lat = -89.5; lat < 90; lat += 1) {
        let n = 0;
        for (const id of REGION_IDS) if (D.inAreas(D.regions[id].areas, lon, lat)) n++;
        if (n === 0) gaps++;
        if (n > 1) over++;
      }
    }
    t.eq([gaps, over], [0, 0]);
    t.eq(D.regionAt(0, 90), 'arctic');
    t.eq(D.regionAt(0, -90), 'antarctica');
    t.eq(D.regionAt(180, 20), 'pacific');
    t.eq(D.regionAt(-180, 20), 'pacific');
  });

  t.test('conversão de coordenadas: Londres, Paris, Lisboa e Porto na Europa', () => {
    for (const p of [LONDON, PARIS, LISBON, PORTO, MADRID]) t.eq(D.regionAt(p[0], p[1]), 'europe', 'região ' + p);
    t.eq(D.countryAt(LONDON[0], LONDON[1]), 'uk');
    t.eq(D.countryAt(PARIS[0], PARIS[1]), 'france');
    t.eq(D.countryAt(MADRID[0], MADRID[1]), 'spain');
    t.eq(D.countryAt(LISBON[0], LISBON[1]), null, 'Portugal não é financiador');
    t.eq(D.countryAt(PORTO[0], PORTO[1]), null);
    t.eq(D.countryAt(-74, 40.7), 'usa');
    t.eq(D.countryAt(139.7, 35.7), 'japan');
    t.eq(D.countryAt(37.6, 55.75), 'russia');
    t.eq(D.countryAt(151.2, -33.9), 'australia');
    t.eq(D.countryAt(-43.2, -22.9), 'brazil');
    t.eq(D.regionAt(-43.2, -22.9), 'south_america');
    t.eq(D.regionAt(-30, 40), 'north_atlantic');
    t.eq(D.regionAt(80, -40), 'indian_ocean');
    t.eq(D.regionAt(-140, 0), 'pacific');
    // longitude fora do intervalo é normalizada
    t.eq(D.regionAt(LONDON[0] + 360, LONDON[1]), 'europe');
  });

  t.test('países: §3.17, região existente, etiqueta dentro do país e da região', () => {
    t.eq(Object.keys(D.countries).sort(), COUNTRY_IDS.slice().sort());
    const table = {
      usa: [600, 10000, 'north_america'], canada: [230, 4000, 'north_america'], brazil: [300, 4000, 'south_america'],
      uk: [240, 7000, 'europe'], france: [320, 8000, 'europe'], germany: [250, 9000, 'europe'], italy: [160, 6000, 'europe'],
      spain: [140, 5000, 'europe'], russia: [230, 8000, 'russia'], egypt: [230, 2000, 'north_africa'],
      nigeria: [180, 2000, 'north_africa'], south_africa: [230, 3000, 'south_africa'], india: [150, 5000, 'asia'],
      china: [245, 7000, 'southeast_asia'], japan: [400, 10000, 'southeast_asia'], australia: [280, 5000, 'australasia'],
    };
    for (const id of COUNTRY_IDS) {
      const c = D.countries[id];
      t.eq([c.fundingBase, c.fundingCap, c.region], table[id], id);
      t.ok(D.regions[c.region], 'região de ' + id);
      t.ok(named(c.nameKey), 'nome ' + id);
      t.ok(c.areas.every(validArea), 'áreas ' + id);
      t.ok(D.inAreas(c.areas, c.label[0], c.label[1]), 'etiqueta de ' + id + ' no país');
      t.eq(D.regionAt(c.label[0], c.label[1]), c.region, 'etiqueta de ' + id + ' na região');
      t.eq(D.countryAt(c.label[0], c.label[1]), id, 'countryAt etiqueta ' + id);
    }
  });

  t.test('financiamento: soma das bases e normalização para $6 M', () => {
    let base = 0, cap = 0;
    for (const id in D.countries) {
      base += D.countries[id].fundingBase;
      cap += D.countries[id].fundingCap;
    }
    t.eq(base, 4185);
    // RNG(base, 2·base) por país, normalizado ao total: o total tem de caber nesse intervalo
    const total = (OV.TUNE.FUNDING_TOTAL || 6000000) / 1000;
    t.ok(total >= base && total <= 2 * base, 'total ' + total + ' em [' + base + ', ' + 2 * base + ']');
    t.ok(cap > 10 * total, 'tetos muito acima do arranque');
  });

  t.test('cidades: lista orig + Lisboa e Porto, nomes pt-PT, coerentes com a zona 3', () => {
    t.eq(D.cities.length, 53);
    const ids = new Set(D.cities.map((c) => c.id));
    t.eq(ids.size, D.cities.length, 'ids únicos');
    for (const c of D.cities) {
      t.ok(named(c.nameKey), 'nome ' + c.id);
      t.ok(D.regions[c.region], 'região de ' + c.id);
      t.ok(D.regions[c.region].cities.indexOf(c.id) >= 0, c.id + ' listada na região');
      const z3 = D.regions[c.region].missionZones[3];
      t.ok(z3.some((a) => a[4] === c.id && a[0] === c.lon && a[2] === c.lat), c.id + ' na zona 3');
      t.eq(D.citiesById[c.id], c);
    }
    for (const id of ['lisbon', 'porto', 'london', 'paris']) t.eq(D.citiesById[id].region, 'europe', id);
    t.eq(D.regionAt(D.citiesById.lisbon.lon, D.citiesById.lisbon.lat), 'europe');
    t.eq(D.countryAt(D.citiesById.london.lon, D.citiesById.london.lat), 'uk');
    t.eq(D.countryAt(D.citiesById.paris.lon, D.citiesById.paris.lat), 'france');
    t.near(D.citiesById.london.lon, -0.1, 0.1, 'Londres lon');
    t.near(D.citiesById.london.lat, 51.5, 0.1, 'Londres lat');
    t.eq(OV.T('city.london'), 'Londres');
    t.eq(OV.T('city.moscow'), 'Moscovo');
    t.eq(OV.T('city.new_york'), 'Nova Iorque');
    t.eq(OV.T('city.beijing'), 'Pequim');
    t.eq(OV.T('city.cape_town'), 'Cidade do Cabo');
    t.eq(OV.T('city.lisbon'), 'Lisboa');
  });

  t.test('zonas de missão: 6 zonas nas regiões com missões; cidades da zona 3 são pontos', () => {
    for (const id of REGION_IDS) {
      const r = D.regions[id];
      if (r.ocean) {
        t.eq(r.missionZones.length, 0, id);
        t.eq(Object.keys(r.missionWeights).length, 0, id);
        continue;
      }
      t.eq(r.missionZones.length, 6, id);
      for (let z = 0; z < 6; z++) t.ok(r.missionZones[z].length > 0 && r.missionZones[z].every(validArea), id + ' zona ' + z);
      for (const a of r.missionZones[3]) t.ok(a[0] === a[1] && a[2] === a[3] || typeof a[4] !== 'string', id + ' zona 3 pontual');
      for (const m in r.missionWeights) t.ok(D.alienMissions[m] && D.alienMissions[m].table, id + ' tabela ' + m);
    }
    t.eq(D.regions.europe.cities.length, 9);
    t.eq(D.regions.arctic.cities.length, 0);
  });

  t.test('terrainAt: polar, deserto, selva, montanha e quinta/floresta', () => {
    t.eq(D.terrainAt(10, 23), 'DESERT', 'Sara');
    t.eq(D.terrainAt(45, 23), 'DESERT', 'Arábia');
    t.eq(D.terrainAt(105, 43), 'DESERT', 'Gobi');
    t.eq(D.terrainAt(-112, 33), 'DESERT', 'Arizona');
    t.eq(D.terrainAt(132, -25), 'DESERT', 'Austrália interior');
    t.eq(D.terrainAt(-69.5, -23), 'DESERT', 'Atacama');
    t.eq(D.terrainAt(-60, -3), 'JUNGLE', 'Amazónia');
    t.eq(D.terrainAt(22, 0), 'JUNGLE', 'Congo');
    t.eq(D.terrainAt(113, -1), 'JUNGLE', 'Bornéu');
    t.eq(D.terrainAt(10, 46.5), 'MOUNTAIN', 'Alpes');
    t.eq(D.terrainAt(86.9, 28), 'MOUNTAIN', 'Himalaias');
    t.eq(D.terrainAt(-75, -10), 'MOUNTAIN', 'Andes');
    t.eq(D.terrainAt(-110, 43), 'MOUNTAIN', 'Rochosas');
    t.eq(D.terrainAt(0, -80), 'POLAR', 'Antártida');
    t.eq(D.terrainAt(-40, 72), 'POLAR', 'Gronelândia');
    t.eq(D.terrainAt(100, 65), 'POLAR', 'Sibéria a norte de 60°');
    // fora das caixas: FARM/FOREST pelo hash
    t.eq(D.terrainAt(LISBON[0], LISBON[1], 0), 'FARM');
    t.eq(D.terrainAt(LISBON[0], LISBON[1], 99), 'FOREST');
    t.eq(D.terrainAt(LISBON[0], LISBON[1]), D.terrainAt(LISBON[0], LISBON[1]), 'determinístico');
    let farm = 0;
    for (let h = 0; h < 1000; h++) if (D.terrainAt(2, 47, OV.U.hash32(h, 7, 3)) === 'FARM') farm++;
    t.ok(farm > 480 && farm < 620, 'FARM ≈ 55 % (' + farm + ')');
    for (const k in D.terrainBoxes) t.ok(D.terrainBoxes[k].every(validArea), 'caixas ' + k);
    t.eq(Object.keys(D.terrainBoxes).sort(), ['DESERT', 'JUNGLE', 'MOUNTAIN']);
  });

  t.test('trajetórias P0–P9 + assalto (orig)', () => {
    const ids = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'assault'];
    t.eq(Object.keys(D.trajectories).sort(), ids.slice().sort());
    for (const id of ids) {
      const tr = D.trajectories[id];
      t.eq(tr.id, id);
      t.eq(tr.groundS, tr.groundTimer * 5);
      t.ok(tr.pts.length >= 2, id);
      for (const p of tr.pts) t.ok(p[0] >= 0 && p[0] <= 5 && p[1] >= 0 && p[1] <= 4 && p[2] > 0 && p[2] <= 100, id + ' ' + p);
      t.eq(tr.pts[0][0], 5, id + ' entra pela zona 5');
    }
    t.eq(D.trajectories.P0, { id: 'P0', groundTimer: 3000, groundS: 15000, pts: [[5, 4, 100], [0, 3, 74], [0, 1, 28], [1, 1, 47], [5, 2, 100]] });
    t.eq(D.trajectories.P7.pts[3], [3, 1, 20], 'P7 passa pela cidade');
    t.eq(D.altitudes.length, 5);
    for (const a of D.altitudes) t.ok(named('alt.' + a), 'altitude ' + a);
  });

  t.test('missões: ondas com trajetórias e OVNIs válidos, temporizadores ×0,5', () => {
    t.eq(Object.keys(D.alienMissions).sort(), MISSION_IDS.slice().sort());
    for (const id of MISSION_IDS) {
      const m = D.alienMissions[id];
      t.eq(m.id, id);
      t.ok(named(m.nameKey), 'nome ' + id);
      t.ok(m.waves.length > 0, id);
      for (const w of m.waves) {
        t.ok(UFO_IDS.indexOf(w.ufo) >= 0, id + ' OVNI ' + w.ufo);
        if (D.ufos) t.ok(D.ufos[w.ufo], id + ' OVNI definido ' + w.ufo);
        t.ok(D.trajectories[w.traj], id + ' trajetória ' + w.traj);
        t.ok(w.n >= 1 && w.timer >= 30 && w.timer % 30 === 0, id + ' onda');
      }
      if (m.spawnUfo) t.ok(UFO_IDS.indexOf(m.spawnUfo) >= 0, id + ' spawnUfo');
      if (m.siteType && D.deployments) t.ok(D.deployments[m.siteType], id + ' siteType ' + m.siteType);
    }
    t.eq(D.alienMissions.alien_research.waves.map((w) => [w.ufo, w.n, w.traj, w.timer]),
      [['small_scout', 1, 'P0', 4500], ['medium_scout', 1, 'P2', 3900], ['large_scout', 2, 'P4', 4500]]);
    const terror = D.alienMissions.alien_terror;
    t.eq(terror.waves.map((w) => [w.ufo, w.traj, w.timer, w.objective]), [['medium_scout', 'P1', 6000, false], ['terror_ship', 'P7', 4500, true]]);
    t.eq([terror.siteType, terror.spawnZone, terror.cityOnly], ['dep_terror_site', 3, true]);
    t.eq(D.alienMissions.alien_base.siteType, 'dep_alien_base');
    t.eq(D.alienMissions.alien_retaliation.spawnUfo, 'battleship');
    t.eq(D.alienMissions.alien_retaliation.assaultTraj, 'assault');
    t.eq(D.alienMissions.alien_supply.raceFrom, 'base');
    // as zonas das trajetórias usadas existem em todas as regiões com missões
    for (const id of MISSION_IDS) {
      for (const w of D.alienMissions[id].waves) {
        for (const p of D.trajectories[w.traj].pts) {
          for (const r of REGION_IDS) if (!D.regions[r].ocean) t.ok(D.regions[r].missionZones[p[0]], r + ' zona ' + p[0]);
        }
      }
    }
    const table = MISSION_IDS.filter((id) => D.alienMissions[id].table).sort();
    t.eq(table, ['alien_abduction', 'alien_base', 'alien_harvest', 'alien_infiltration', 'alien_research']);
  });

  t.test('contagem das vagas e atraso por abate (orig/ours)', () => {
    const R = D.missionRules;
    const rng = OV.RNG.create(5);
    for (let i = 0; i < 300; i++) {
      const c = R.countdown(4500, rng);
      t.ok(c >= 2220 && c <= 6750 && c % 30 === 0, 'countdown ' + c);
      const s = R.shootDownDelayMin(rng);
      t.ok(s >= 30 * 48 && s <= 30 * 248 && s % 30 === 0, 'abate ' + s);
    }
    const small = new Set();
    for (let i = 0; i < 50; i++) small.add(R.countdown(30, rng));
    t.eq([...small].sort((a, b) => a - b), [0, 30]);
    t.eq([R.nearBaseNm, R.nearBaseWeightMul, R.shootDownRetaliationFromMonth], [4000, 3, 2]);
  });

  t.test('guião mensal: meses 0, 1, 2 e 3+ definidos', () => {
    const ids = (m, d, r) => D.scriptsForMonth(m, d || 0, r).map((s) => s.id);
    const table = (m, d) => D.scriptsForMonth(m, d || 0).filter((s) => !s.missionWeights).reduce((n, s) => n + s.count, 0);
    t.eq(ids(0), ['gameStart', 'firstTerror']);
    const start = D.missionScripts.find((s) => s.id === 'gameStart');
    t.eq([Object.keys(start.missionWeights), start.races, start.startDelay, start.target], [['alien_research'], { sectoid: 100 }, 120, 'baseRegion']);
    t.eq(D.missionScripts.find((s) => s.id === 'firstTerror').startDelay, 3 * 24 * 60);
    t.eq(ids(1), ['recurringTerror', 'seedAlienBase', 'recon']);
    const seed = D.missionScripts.find((s) => s.id === 'seedAlienBase');
    t.eq([Object.keys(seed.missionWeights), seed.target, seed.maxBaseDistNm], [['alien_base'], 'nearBase', 4000]);
    t.eq([table(0), table(1), table(2), table(3), table(7)], [0, 1, 2, 3, 3]);
    for (let m = 0; m < 12; m++) t.ok(D.scriptsForMonth(m, 0).length > 0, 'mês ' + m);
    for (let m = 1; m < 12; m++) t.ok(ids(m).indexOf('recurringTerror') >= 0, 'terror no mês ' + m);
    // retaliação agendada: mês 3 em Recruta/Veterano, mês 2 em Super-humano
    t.ok(ids(2, 0).indexOf('scheduledRetaliation') < 0);
    t.ok(ids(3, 0).indexOf('scheduledRetaliation') >= 0);
    t.ok(ids(3, 1).indexOf('scheduledRetaliation') >= 0);
    t.ok(ids(2, 2).indexOf('scheduledRetaliation') >= 0);
    // A Solução Marciana provoca a retaliação logo e substitui a agendada
    const after = ids(4, 0, ['martian_solution']);
    t.ok(after.indexOf('researchRetaliation') >= 0 && after.indexOf('scheduledRetaliation') < 0, after.join(','));
    t.ok(ids(1, 0, new Set(['martian_solution'])).indexOf('researchRetaliation') >= 0, 'Set aceite');
    t.eq(D.missionScripts.find((s) => s.id === 'researchRetaliation').immediate, true);
    for (const s of D.missionScripts) for (const m in s.missionWeights || {}) t.ok(D.alienMissions[m], s.id + ' ' + m);
  });

  t.test('raças por mês (ours) e terror com Homens-Serpente', () => {
    t.eq(D.raceWeights('alien_research', 0), { sectoid: 60, floater: 40 });
    t.eq(D.raceWeights('alien_abduction', 1), { sectoid: 30, floater: 30, snakeman: 20, muton: 20 });
    t.eq(D.raceWeights('alien_harvest', 2).ethereal, 20);
    t.eq(D.raceWeights('alien_base', 9), { muton: 30, ethereal: 30, snakeman: 20, floater: 10, sectoid: 10 });
    t.eq(D.raceWeights('alien_terror', 1), { floater: 100 });
    t.eq(D.raceWeights('alien_terror', 5).snakeman, 25);
    t.ok(!D.raceWeights('alien_terror', 2).snakeman, 'Crisálidas só a partir do mês 3');
    t.eq(D.raceWeights('alien_terror', 0), { floater: 100 });
    t.ok(!D.raceWeights('alien_terror', 9).ethereal, 'sem Etéreos no terror');
    const w = D.raceWeights('alien_research', 0);
    w.sectoid = 0;
    t.eq(D.raceWeights('alien_research', 0).sectoid, 60, 'devolve cópia');
    for (const k in D.raceSchedule) for (const m in D.raceSchedule[k]) for (const r in D.raceSchedule[k][m]) t.ok(RACES.indexOf(r) >= 0, r);
  });

  t.test('constantes do globo: radares em mn e graus, zoom orig', () => {
    const G = D.geoConst;
    t.eq(G.radar.small_radar.nm, 1695);
    t.near(G.radar.small_radar.deg, 28.25, 1e-9);
    t.near(G.radar.large_radar.deg, 42.95, 1e-9);
    t.near(G.radar.hyper_wave_decoder.deg, 45.98, 0.01);
    t.near(G.radar.craft.deg, 11.2, 1e-9);
    if (D.facilities && D.facilities.small_radar) t.eq(D.facilities.small_radar.radarRange, G.radar.small_radar.nm);
    t.eq(G.zoomRadii, [0.45, 0.6, 0.9, 1.4, 2.25, 3.6]);
    t.eq([G.sun.nightRadiusDeg, G.sun.twilightDeg, G.sun.duskElevDeg], [90, [84, 96], -6]);
    t.near(G.earthRadiusNm, 3437.75, 0.01);
    t.eq(G.entryRingDeg, [25, 35]);
  });

  t.test('pontuação: atividade dos OVNIs, missões, bases e terror', () => {
    const S = D.scoring;
    t.eq([S.ufoActivity.flying, S.ufoActivity.landed, S.ufoActivity.everyMin], [1, 2, 120]);
    t.eq(S.missionPoints, {
      alien_research: 0, alien_harvest: 30, alien_abduction: 50, alien_infiltration: 150, alien_base: 50,
      alien_terror: 10, alien_retaliation: 0, alien_supply: 0,
    });
    t.eq([S.alienBasePerDay, S.terrorSiteExpired, S.alienBaseDestroyed], [5, 1000, 500]);
    t.eq(D.ratingKey(600, 0), 'rating.excellent');
    t.eq(D.ratingKey(100, 0), 'rating.good');
    t.eq(D.ratingKey(-899, 0), 'rating.ok');
    t.eq(D.ratingKey(-900, 0), 'rating.poor');
    t.eq(D.ratingKey(-1200, 0), 'rating.terrible');
    t.eq(D.ratingKey(-600, 2), 'rating.poor');
    for (const k of ['terrible', 'poor', 'ok', 'good', 'excellent']) t.ok(named('rating.' + k), k);
  });

  t.test('regras imutáveis depois de finalize', () => {
    t.ok(Object.isFrozen(D.regions.europe) && Object.isFrozen(D.regions.europe.missionZones[3]), 'regiões');
    t.ok(Object.isFrozen(D.countries.usa.areas[0]), 'países');
    t.ok(Object.isFrozen(D.alienMissions.alien_terror.waves[1]), 'missões');
    t.ok(Object.isFrozen(D.missionScripts) && Object.isFrozen(D.trajectories.P0.pts), 'guião e trajetórias');
    t.ok(Object.isFrozen(D.geoConst.radar.craft) && Object.isFrozen(D.scoring), 'constantes');
  });

  t.test('textos pt-PT: países, regiões, missões e terrenos', () => {
    const pt = {
      usa: 'EUA', canada: 'Canadá', brazil: 'Brasil', uk: 'Reino Unido', france: 'França', germany: 'Alemanha', italy: 'Itália',
      spain: 'Espanha', russia: 'Rússia', egypt: 'Egito', nigeria: 'Nigéria', south_africa: 'África do Sul', india: 'Índia',
      china: 'China', japan: 'Japão', australia: 'Austrália',
    };
    for (const id in pt) t.eq(OV.T(D.countries[id].nameKey), pt[id], id);
    t.eq(OV.T('region.europe'), 'Europa');
    t.eq(OV.T('region.russia'), 'Sibéria');
    t.eq(OV.T('mission.alien_research'), 'Investigação Alienígena');
    t.eq(OV.T('mission.alien_supply'), 'Abastecimento');
    for (const id of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS']) t.ok(named('terrain.' + id), id);
  });
};
