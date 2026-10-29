/* Testes do núcleo da estratégia: OV.Clock, OV.GMath e OV.Campaign (secção A: newCampaign e ajudas partilhadas).
   Contrato: docs/CAMPAIGN_API.md */
module.exports = function (OV, t) {
  const C = OV.Clock, M = OV.GMath, Camp = OV.Campaign, D = OV.Data;
  const strip = (G) => {
    const o = JSON.parse(JSON.stringify(G));
    delete o.events;
    return o;
  };
  const LIS = { lon: -9.14, lat: 38.72 }, NY = { lon: -74.0, lat: 40.71 };

  // ---- relógio ----------------------------------------------------------------------------------------------
  t.test('Clock: início 1 jan 1999 12:00 UTC (sexta-feira)', () => {
    const d = C.date({ t: 0 });
    t.eq([d.y, d.m, d.d, d.h, d.min, d.wd], [1999, 0, 1, 12, 0, 5]);
    t.eq(C.monthIndex(0), 0);
    t.eq(C.hourUTC(0), 12);
  });
  t.test('Clock.advance: máscaras nas fronteiras de 10 min, 30 min, 1 h, dia e mês', () => {
    const G = { t: 0 };
    t.eq(C.advance(G, 1), C.T5S);
    t.eq(G.t, 5);
    G.t = 595;
    t.eq(C.advance(G), C.T5S | C.T10M);
    G.t = 1795;
    t.eq(C.advance(G), C.T5S | C.T10M | C.T30M);
    G.t = 3595;
    t.eq(C.advance(G), C.T5S | C.T10M | C.T30M | C.T1H);
    G.t = 43195; // 23:59:55 de 1 jan
    t.eq(C.advance(G), C.T5S | C.T10M | C.T30M | C.T1H | C.T1D);
    t.eq(C.date(G).d, 2);
    G.t = C.monthStartT(1) - 5; // 31 jan 23:59:55
    t.eq(C.advance(G), C.T5S | C.T10M | C.T30M | C.T1H | C.T1D | C.T1MO);
    const d = C.date(G);
    t.eq([d.m, d.d, d.h], [1, 1, 0]);
    t.eq(C.monthIndex(G), 1);
    t.eq(C.advance(G, 0), 0, 'avançar 0 ticks');
  });
  t.test('Clock: contagem de fronteiras num dia inteiro a 5 s', () => {
    const G = { t: 0 };
    const n = { m10: 0, m30: 0, h: 0, d: 0, mo: 0 };
    for (let k = 0; k < 17280; k++) {
      const m = C.advance(G, 1);
      if (m & C.T10M) n.m10++;
      if (m & C.T30M) n.m30++;
      if (m & C.T1H) n.h++;
      if (m & C.T1D) n.d++;
      if (m & C.T1MO) n.mo++;
    }
    t.eq(n, { m10: 144, m30: 48, h: 24, d: 1, mo: 0 });
    t.eq(G.t, 86400);
  });
  t.test('Clock.ticksUntil: salto exato até cada fronteira', () => {
    t.eq(C.ticksUntil({ t: 0 }, C.T10M), 120);
    t.eq(C.ticksUntil({ t: 0 }, C.T1D), 8640);
    t.eq(C.ticksUntil({ t: 0 }, C.T1MO), (31 * 86400 - 43200) / 5);
    for (const bit of [C.T10M, C.T30M, C.T1H, C.T1D, C.T1MO]) {
      for (const t0 of [0, 5, 1795, 43195, 100000, C.monthStartT(3) - 5]) {
        const G = { t: t0 };
        const k = C.ticksUntil(G, bit);
        const m = C.advance(G, k);
        t.ok(m & bit, 'bit ' + bit + ' a partir de ' + t0);
        const G2 = { t: t0 };
        if (k > 1) t.ok(!(C.advance(G2, k - 1) & bit), 'um tick antes não atravessa (' + bit + ', ' + t0 + ')');
      }
    }
  });
  t.test('Clock: meses reais e ano bissexto', () => {
    t.eq(C.daysInMonth(C.monthStartT(1)), 28); // fev 1999
    t.eq(C.daysInMonth(C.monthStartT(13)), 29); // fev 2000
    for (let mi = 0; mi < 30; mi++) t.eq(C.monthIndex(C.monthStartT(mi) + 1), mi);
    t.eq(C.dayOfYear(0), 0);
    t.eq(C.dayOfYear(C.monthStartT(12)), 0);
  });
  t.test('Clock: longitude subsolar segue a hora UTC', () => {
    t.near(C.sunLon(0), 0, 1e-9);
    t.near(C.sunLon(6 * 3600), -90, 1e-9); // 18:00 UTC
    t.near(C.sunLon(-6 * 3600 + 86400), 90, 1e-9); // 06:00 UTC
    t.eq(C.declination(0), 0); // sem estações
  });

  // ---- globo ------------------------------------------------------------------------------------------------
  t.test('GMath: vec/toLL ida e volta', () => {
    for (let lat = -85; lat <= 85; lat += 17) {
      for (let lon = -175; lon <= 175; lon += 25) {
        const p = M.toLL(M.vec(lon, lat));
        t.near(p.lon, lon, 1e-9);
        t.near(p.lat, lat, 1e-9);
      }
    }
    t.eq(M.toLL(M.vec(30, 90)).lat, 90);
    t.eq(M.wrapLon(190), -170);
    t.eq(M.wrapLon(-190), 170);
  });
  t.test('GMath.distNm: Lisboa–Nova Iorque ≈ 2 930 mn; 1° = 60 mn; antípodas = 10 800 mn', () => {
    t.near(M.distNm(LIS, NY), 2930, 15);
    t.near(M.distNm({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }), 60, 1e-9);
    t.near(M.distNm({ lon: 10, lat: 20 }, { lon: -170, lat: -20 }), 10800, 1e-6);
    t.near(M.distNmLL(-9.14, 38.72, -74, 40.71), M.distNm(LIS, NY), 1e-9);
    t.near(M.distNm(LIS, LIS), 0, 1e-12);
    t.ok(M.withinNm(LIS, NY, 3000) && !M.withinNm(LIS, NY, 2800));
  });
  t.test('GMath: rumo e destino', () => {
    t.near(M.bearing({ lon: 0, lat: 0 }, { lon: 10, lat: 0 }), 90, 1e-9);
    t.near(M.bearing({ lon: 0, lat: 0 }, { lon: 0, lat: 10 }), 0, 1e-9);
    t.near(M.bearing({ lon: 0, lat: 0 }, { lon: -10, lat: 0 }), 270, 1e-9);
    const b = M.bearing(LIS, NY);
    t.ok(b > 270 && b < 310, 'Lisboa → Nova Iorque a oés-noroeste: ' + b);
    const p = M.destination(LIS, b, M.distNm(LIS, NY));
    t.near(M.distNm(p, NY), 0, 0.01);
  });
  t.test('GMath.stepToward: desloca knots·s/3600 mn e chega exatamente', () => {
    let p = { lon: LIS.lon, lat: LIS.lat };
    const r = M.stepToward(p, NY, 2100, 5);
    t.near(M.distNm(p, r), 2100 * 5 / 3600, 1e-6);
    t.ok(!r.arrived);
    t.near(r.remainingNm, M.distNm(r, NY), 1e-6);
    // fica sobre o grande círculo: d(L, P) + d(P, NY) = d(L, NY)
    t.near(M.distNm(LIS, r) + M.distNm(r, NY), M.distNm(LIS, NY), 1e-6);
    const total = M.distNm(LIS, NY);
    const per = 2100 * 5 / 3600;
    let ticks = 0;
    while (true) {
      const s = M.stepToward(p, NY, 2100, 5);
      p = s;
      ticks++;
      if (s.arrived) break;
      t.ok(ticks < 100000, 'não converge');
    }
    t.eq(ticks, Math.ceil(total / per));
    t.eq([p.lon, p.lat], [NY.lon, NY.lat]);
    t.eq(M.stepToward(NY, NY, 500, 5).arrived, true);
  });
  t.test('GMath.lerp e path no grande círculo', () => {
    const mid = M.lerp(LIS, NY, 0.5);
    t.near(M.distNm(LIS, mid), M.distNm(mid, NY), 1e-6);
    const pts = M.path(LIS, NY, 2);
    t.eq(pts[0], [LIS.lon, LIS.lat]);
    t.near(M.distNm({ lon: pts[pts.length - 1][0], lat: pts[pts.length - 1][1] }, NY), 0, 1e-6);
    t.ok(pts.length >= Math.ceil(M.distNm(LIS, NY) / 60 / 2));
    const circ = M.smallCircle(LIS, 1695, 24);
    t.eq(circ.length, 25);
    for (const [lon, lat] of circ) t.near(M.distNm(LIS, { lon, lat }), 1695, 1e-6);
  });
  t.test('GMath.interceptPoint: encontro no rumo do alvo; perseguidor lento espera no destino', () => {
    const chaser = { lon: 0, lat: 10 };
    const ufo = { lon: -20, lat: 0 }, dest = { lon: 40, lat: 0 };
    const ip = M.interceptPoint(chaser, 2100, ufo, dest, 1000);
    t.ok(ip && ip.hours > 0);
    // o OVNI chega lá ao mesmo tempo que a nave
    t.near(M.distNm(chaser, ip), 2100 * ip.hours, 0.05);
    t.near(M.distNm(ufo, ip), 1000 * ip.hours, 0.05);
    t.near(M.distNm(ufo, ip) + M.distNm(ip, dest), M.distNm(ufo, dest), 1e-6);
    const slow = M.interceptPoint(chaser, 100, ufo, dest, 4000);
    t.near(M.distNm(slow, dest), 0, 1e-6);
    t.near(slow.hours, M.distNm(chaser, dest) / 100, 1e-9);
    const still = M.interceptPoint(chaser, 500, ufo, null, 0);
    t.eq([still.lon, still.lat], [ufo.lon, ufo.lat]);
    t.eq(M.interceptPoint(chaser, 0, ufo, dest, 10), null);
  });
  t.test('GMath: regiões, países (retângulos orig), terra', () => {
    t.eq(M.regionAt(LIS.lon, LIS.lat), 'europe');
    t.eq(M.countryAt(2.35, 48.85), 'france');
    t.eq(M.countryAt(LIS.lon, LIS.lat), 'portugal', 'Portugal financia (ours)');
    t.eq(M.countryAtMap(LIS.lon, LIS.lat), 'portugal');
    t.eq(M.isLand(LIS.lon, LIS.lat), true);
    t.eq(M.isLand(-40, 35), false);
    t.ok(M.inRect(5, 5, [0, 10, 0, 10]) && !M.inRect(15, 5, [0, 10, 0, 10]));
  });
  t.test('GMath: sol, dia/crepúsculo/noite e sombra da missão', () => {
    const G = { t: 0 }; // 12:00 UTC: sol sobre (0, 0)
    t.near(M.sunElevation(G, 0, 0), 90, 1e-9);
    t.near(M.sunElevation(G, 180, 0), -90, 1e-9);
    t.eq(M.dayPhase(G, 0, 0), 'day');
    t.eq(M.dayPhase(G, 180, 0), 'night');
    t.eq(M.dayPhase(G, 93, 0), 'dusk'); // 3° abaixo do horizonte
    t.eq(M.isNightAt(G, 120, 10), true);
    t.eq(M.isNightAt(G, LIS.lon, LIS.lat), false);
    t.eq(C.isNightAt(G, 120, 10), true);
    t.eq(M.missionShade(G, 0, 0), OV.TUNE.SHADE_DAY);
    t.eq(M.missionShade(G, 93, 0), OV.TUNE.SHADE_DUSK);
    t.eq(M.missionShade(G, 180, 0), OV.TUNE.SHADE_NIGHT);
    const G2 = { t: 12 * 3600 }; // meia-noite UTC: Lisboa às escuras
    t.eq(M.dayPhase(G2, LIS.lon, LIS.lat), 'night');
    const s = M.sunLL(G2);
    t.near(Math.abs(s.lon), 180, 1e-9);
  });
  t.test('GMath: pontos aleatórios em terra e anel de entrada (determinísticos)', () => {
    const areas = D.regions.europe.missionZones[0];
    const a = OV.RNG.create(7), b = OV.RNG.create(7);
    for (let k = 0; k < 20; k++) {
      const p = M.randomLandPoint(a, areas), q = M.randomLandPoint(b, areas);
      t.eq(p, q);
      t.ok(M.inAreas(areas, p.lon, p.lat), 'dentro das áreas');
      if (p.land) t.ok(M.isLand(p.lon, p.lat));
    }
    const sea = [[-40, -30, 30, 40]];
    const r = OV.RNG.create(3);
    const w = M.randomLandPoint(r, sea, 10);
    t.eq(w.land, false);
    const rr = OV.RNG.create(11);
    const c = D.regions.europe.centroid;
    for (let k = 0; k < 30; k++) {
      const p = M.randomPointAround(rr, { lon: c[0], lat: c[1] }, 25, 35);
      const deg = M.distNm({ lon: c[0], lat: c[1] }, p) / 60;
      t.ok(deg >= 25 - 1e-6 && deg <= 35 + 1e-6, 'anel 25–35°: ' + deg);
    }
  });

  // ---- campanha: newCampaign ----------------------------------------------------------------------------------
  const TOP = ['game', 'schema', 'seed', 'difficulty', 't', 'month', 'plannedMonth', 'rng', 'ids', 'funds', 'history', 'reports', 'council',
    'score', 'countries', 'bases', 'soldiers', 'dead', 'crafts', 'ufos', 'alienMissions', 'sites', 'alienBases', 'dogfights', 'alien',
    'researched', 'ufopaedia', 'seen', 'flags', 'stats', 'activeMission', 'ui', 'debug', 'events'];

  t.test('newCampaign: forma do estado conforme o contrato', () => {
    const G = Camp.newCampaign({ difficulty: 1, seed: 42, baseLonLat: LIS, baseName: 'Base Alfa' });
    for (const k of TOP) t.ok(Object.prototype.hasOwnProperty.call(G, k), 'falta G.' + k);
    t.eq(Object.keys(G).filter((k) => TOP.indexOf(k) < 0), [], 'campos a mais');
    t.eq([G.game, G.schema, G.seed, G.difficulty, G.t, G.month], ['ovni-1999', 1, 42, 1, 0, 0]);
    for (const s of Camp.STREAMS) t.ok(Number.isInteger(G.rng[s]) && G.rng[s] >= 0 && G.rng[s] <= 0xffffffff, 'rng.' + s);
    for (const f of D.researchFlags) t.eq(G.flags[f], false);
    t.eq([G.flags.won, G.flags.lost, G.flags.lostReason], [false, false, null]);
    t.eq(G.score.month, Camp.newScoreMonth());
    t.eq(G.activeMission, null);
    t.ok(Array.isArray(G.events) && G.events.length === 0 || OV.Missions && OV.Missions.planMonth);
  });
  t.test('newCampaign: financiamento normalizado a 6 000 000 e fundos iniciais', () => {
    for (const seed of [1, 2, 99, 12345]) {
      const G = Camp.newCampaign({ seed });
      const sum = G.countries.reduce((s, c) => s + c.funding, 0);
      t.eq(sum, OV.TUNE.FUNDING_TOTAL);
      t.eq(G.funds, OV.TUNE.FUNDING_TOTAL);
      t.eq(G.countries.map((c) => c.id), Object.keys(D.countries));
      for (const c of G.countries) {
        t.eq(c.funding % 1000, 0, 'múltiplo de 1000');
        t.ok(c.funding > 0 && c.funding <= D.countries[c.id].fundingCap * 1000);
        t.eq([c.pact, c.history, c.mood, c.lastDelta], [false, [], 'same', 0]);
      }
    }
  });
  t.test('newCampaign: base inicial orig (grelha ligada, pessoal, armazém)', () => {
    const G = Camp.newCampaign({ seed: 5, baseLonLat: LIS });
    t.eq(G.bases.length, 1);
    const b = G.bases[0];
    t.eq([b.id, b.region, b.country, b.name], ['b1', 'europe', 'portugal', null]);
    t.eq(b.grid.length, D.startingBase.facilities.length);
    t.ok(D.gridConnected(b.grid).ok, 'grelha ligada ao elevador');
    for (const f of b.grid) t.eq(f.daysLeft, 0);
    t.eq([b.scientists, b.engineers], [10, 10]);
    t.eq(b.soldiers.length, D.startingBase.soldiersByDifficulty[G.difficulty]);
    t.eq([0, 1, 2].map((d) => Camp.newCampaign({ seed: 5, difficulty: d }).bases[0].soldiers.length), [10, 10, 8], 'ours: 10/10/8');
    t.eq(b.crafts.length, 3);
    t.eq([b.research, b.production, b.deliveries, b.transfers, b.aliens, b.spotted], [[], [], [], [], {}, false]);
    // armazém = orig + extras, menos o kit médico e os very-lights postos na Skyranger
    const exp = Object.assign({}, D.startingBase.stores);
    exp.medikit -= 1;
    exp.electro_flare -= 4;
    t.eq(b.stores, exp);
  });
  t.test('newCampaign: naves (Skyranger com equipa, Intercetores armados)', () => {
    const G = Camp.newCampaign({ seed: 5 });
    const crafts = Object.values(G.crafts);
    t.eq(crafts.map((c) => c.type), ['skyranger', 'interceptor', 'interceptor']);
    t.eq(crafts.map((c) => c.num), [1, 1, 2]);
    for (const c of crafts) {
      const def = D.crafts[c.type];
      t.eq([c.status, c.fuel, c.hp, c.dest, c.baseId, c.dogfightId], ['ready', def.fuel, def.hp, null, 'b1', null]);
      t.eq([c.lon, c.lat], [G.bases[0].lon, G.bases[0].lat]);
      t.eq(c.weapons.length, def.weapons);
    }
    t.eq(crafts[1].weapons, [{ type: 'stingray', ammo: 6 }, { type: 'cannon', ammo: 200 }]);
    const sky = crafts[0];
    t.eq(sky.soldiers.length, 10, 'a Skyranger leva os 10 (Recruta)');
    for (const id of sky.soldiers) t.eq(G.soldiers[id].craftId, sky.id);
    const cargo = Object.assign({}, D.startingBase.crafts[0].cargo, { medikit: 1, electro_flare: 4 });
    t.eq(sky.equipment, cargo);
  });
  t.test('newCampaign: soldados completos e equipamento ⊆ carga da nave', () => {
    const G = Camp.newCampaign({ seed: 77 });
    const sky = G.crafts.c1;
    const need = {};
    for (const id of Object.keys(G.soldiers)) {
      const s = G.soldiers[id];
      t.eq(Object.keys(s).sort(), ['armour', 'baseId', 'craftId', 'female', 'hiredT', 'id', 'initial', 'kills', 'loadout', 'missions',
        'name', 'nat', 'portraitSeed', 'psi', 'rank', 'stats', 'woundDays'].sort());
      t.eq([s.rank, s.missions, s.kills, s.woundDays, s.armour, s.baseId], [0, 0, 0, 0, 'coveralls', 'b1']);
      t.eq(s.initial, s.stats);
      for (const k of D.soldierGen.statKeys) t.ok(s.stats[k] >= D.soldierGen.statsMin[k] && s.stats[k] <= D.soldierGen.statsMax[k], k);
      const lo = s.loadout;
      t.ok(lo.R, 'arma na mão direita');
      for (const slot of ['belt', 'pack']) {
        const acc = [];
        for (const it of lo[slot]) {
          t.ok(D.fitsSlot(it, slot, acc), it + ' cabe em ' + slot);
          acc.push(it);
        }
      }
      for (const it of [lo.R, lo.L].concat(lo.belt, lo.pack)) if (it) need[it] = (need[it] | 0) + 1;
    }
    for (const it in need) t.ok((sky.equipment[it] | 0) >= need[it], 'carga cobre ' + it);
    const lo = Object.values(G.soldiers).map((s) => s.loadout);
    t.ok(lo.some((l) => l.R === 'heavy_cannon'), 'canhão pesado');
    t.ok(lo.some((l) => l.pack.indexOf('medikit') >= 0), 'kit médico');
    t.ok(lo.some((l) => l.belt.indexOf('electro_flare') >= 0), 'very-light');
  });
  t.test('newCampaign: JSON puro (ida e volta) e determinismo por semente', () => {
    const a = Camp.newCampaign({ seed: 2024, difficulty: 2 });
    const b = Camp.newCampaign({ seed: 2024, difficulty: 2 });
    const c = Camp.newCampaign({ seed: 2025, difficulty: 2 });
    t.eq(strip(a), strip(b));
    t.eq(Camp.hash(a), Camp.hash(b));
    t.ok(Camp.hash(a) !== Camp.hash(c));
    const back = JSON.parse(JSON.stringify(a));
    t.eq(strip(back), strip(a));
    t.eq(Camp.hash(back), Camp.hash(a));
    const bad = [];
    (function walk(v, path) {
      if (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) || typeof v === 'function') bad.push(path);
      else if (v && typeof v === 'object') {
        if (ArrayBuffer.isView(v) || (Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v))) bad.push(path);
        else for (const k of Object.keys(v)) walk(v[k], path + '.' + k);
      }
    })(a, 'G');
    t.eq(bad, [], 'valores não-JSON');
  });
  t.test('newCampaign: base no mar rejeitada; dificuldade e nome saneados', () => {
    t.throws(() => Camp.newCampaign({ baseLonLat: { lon: -40, lat: 35 } }));
    const G = Camp.newCampaign({ difficulty: 9, baseName: '   ', baseLonLat: { lon: 139.7, lat: 35.7 } });
    t.eq(G.difficulty, 2);
    t.eq(G.bases[0].name, null);
    t.eq(G.bases[0].region, 'southeast_asia');
    t.eq(G.bases[0].country, 'japan');
    t.eq(Camp.newCampaign({ difficulty: -3 }).difficulty, 0);
  });

  // ---- ajudas partilhadas ---------------------------------------------------------------------------------
  t.test('Campaign.rng: ligada a G.rng, determinística e sem estado escondido', () => {
    const G = Camp.newCampaign({ seed: 9 });
    const s0 = G.rng.geo;
    const r = Camp.rng(G, 'geo');
    t.eq(r, Camp.rng(G, 'geo'), 'mesma instância em cache');
    const x = r.int(0, 1e6);
    t.ok(G.rng.geo !== s0, 'estado escrito em G.rng');
    const ref = OV.RNG.create(0);
    ref.setState(s0);
    t.eq(ref.int(0, 1e6), x);
    // uma cópia JSON continua a mesma sequência
    const G2 = JSON.parse(JSON.stringify(G));
    t.eq(Camp.rng(G2, 'geo').int(0, 1e9), Camp.rng(G, 'geo').int(0, 1e9));
    t.ok(!Object.keys(G).includes('_'), 'G._ não enumerável');
    t.throws(() => Camp.rng(G, 'ui'));
    const before = G.rng.combat;
    Camp.rng(G, 'map').u32();
    t.eq(G.rng.combat, before, 'streams independentes');
  });
  t.test('Campaign: ids, procura, alvos, eventos e fim de jogo', () => {
    const G = Camp.newCampaign({ seed: 3 });
    t.eq(Camp.nextId(G, 'u'), 'u1');
    t.eq(Camp.nextId(G, 'u'), 'u2');
    t.eq(Camp.nextId(G, 's'), 's11');
    t.eq(Camp.findBase(G, 'b1'), G.bases[0]);
    t.eq(Camp.findCraft(G, 'c2'), G.crafts.c2);
    t.eq(Camp.findCraft(G, 'toString'), null);
    t.eq(Camp.findSoldier(G, 's1'), G.soldiers.s1);
    t.eq(Camp.baseOf(G, G.crafts.c1), G.bases[0]);
    t.eq(Camp.findUfo(G, 'u1'), null);
    const tb = Camp.targetOf(G, { kind: 'base', id: 'b1' });
    t.eq([tb.kind, tb.id, tb.lon, tb.lat], ['base', 'b1', G.bases[0].lon, G.bases[0].lat]);
    t.eq(Camp.targetOf(G, { kind: 'point', lon: 10, lat: 20 }).lat, 20);
    t.eq(Camp.targetOf(G, { kind: 'ufo', id: 'u99' }), null);
    t.eq(Camp.targetOf(G, { kind: 'cydonia' }).kind, 'cydonia');
    G.events.length = 0;
    const e = Camp.event(G, 'ufoDetected', { ufoId: 'u1' });
    t.eq([e.t, e.stop, e.ufoId, e.at], ['ufoDetected', true, 'u1', G.t]);
    t.eq(Camp.event(G, 'craftReturned', { craftId: 'c1' }).stop, false);
    t.eq(Camp.event(G, 'craftReturned', { craftId: 'c1', stop: true }).stop, true);
    const h = Camp.hash(G);
    G.events.length = 0;
    G.ui.lon = 33;
    t.eq(Camp.hash(G), h, 'hash ignora events e ui');
    const go = Camp.endGame(G, 'lost', 'debt');
    t.eq([go.t, G.flags.lost, G.flags.lostReason], ['gameOver', true, 'debt']);
    t.eq(Camp.endGame(G, 'won'), null, 'só termina uma vez');
    const list = [{ id: 'a' }, { id: 'b' }];
    t.eq(Camp.removeById(list, 'a'), { id: 'a' });
    t.eq(list, [{ id: 'b' }]);
    t.eq(Camp.removeById(['x', 'y'], 'y'), 'y');
    for (const k in Camp.EVENTS) t.eq(typeof Camp.EVENTS[k].stop, 'boolean', k);
  });
  t.test('Campaign.makeSoldier: ordem de consumo do RNG do contrato', () => {
    const G = Camp.newCampaign({ seed: 31 });
    const r0 = G.rng.geo;
    const s = Camp.makeSoldier(G, { baseId: 'b1' });
    const r = OV.RNG.create(0);
    r.setState(r0);
    const nat = D.pickNationality(r);
    const female = r.pct(D.soldierGen.femalePct);
    const name = D.soldierName(r, nat, female);
    const stats = D.rollSoldierStats(r);
    const seed = r.int(0, 0x7fffffff);
    t.eq([s.nat, s.female, s.name, s.stats, s.portraitSeed], [nat, female, name, stats, seed]);
    t.eq(G.rng.geo, r.state());
    t.eq(G.soldiers[s.id], undefined, 'não inserido');
    Camp.addSoldier(G, s);
    t.eq(G.soldiers[s.id], s);
    t.ok(G.bases[0].soldiers.indexOf(s.id) >= 0);
  });
  t.test('Campaign.addCraft: nave comprada/fabricada na base', () => {
    const G = Camp.newCampaign({ seed: 4 });
    const c = Camp.addCraft(G, 'b1', 'interceptor', { weapons: [{ type: 'avalanche' }] });
    t.eq([c.num, c.status, c.fuel, c.hp], [3, 'ready', 1000, 100]);
    t.eq(c.weapons, [{ type: 'avalanche', ammo: 3 }, null]);
    t.ok(G.bases[0].crafts.indexOf(c.id) >= 0);
    t.throws(() => Camp.addCraft(G, 'b9', 'interceptor'));
  });
  t.test('contrato §5.9: a equipa inicial gera uma batalha válida (OV.Battle.create)', () => {
    const G = Camp.newCampaign({ seed: 8 });
    const craft = G.crafts.c1;
    const pool = Object.assign({}, craft.equipment);
    const squad = craft.soldiers.map((id) => G.soldiers[id]).filter((s) => s.woundDays === 0).map((s) => {
      const lo = { R: null, L: null, belt: [], pack: [] };
      for (const slot of ['R', 'L', 'belt', 'pack']) {
        for (const it of slot === 'R' || slot === 'L' ? (s.loadout[slot] ? [s.loadout[slot]] : []) : s.loadout[slot]) {
          if ((pool[it] | 0) <= 0) continue;
          pool[it]--;
          if (slot === 'R' || slot === 'L') lo[slot] = it;
          else lo[slot].push(it);
        }
      }
      return { soldierId: s.id, name: s.name, nat: s.nat, female: s.female, rank: s.rank, stats: Object.assign({}, s.stats), armour: s.armour,
        portraitSeed: s.portraitSeed, missions: s.missions, loadout: lo };
    });
    const mission = { kind: 'crash', siteId: 'u1', craftId: craft.id, ufoType: 'small_scout', terrain: 'FARM', night: false, shade: 0,
      race: 'sectoid', month: 0, difficulty: G.difficulty, seed: Camp.rng(G, 'map').u32(), deploymentId: null, craftType: craft.type,
      squad, craftItems: pool, researched: G.researched.slice(), settings: { instantGrenades: true } };
    const B = OV.Battle.create(mission);
    const xcom = B.units.filter((u) => u.side === 'xcom');
    t.eq(xcom.length, 10);
    t.eq(xcom.map((u) => u.soldierId), craft.soldiers);
    t.eq([B.mission.siteId, B.mission.craftId, B.mission.kind], ['u1', 'c1', 'crash']);
    for (const u of xcom) t.ok(u.tu > 0 && u.items.R !== null, 'armado e com UT: ' + u.soldierId);
  });
};
