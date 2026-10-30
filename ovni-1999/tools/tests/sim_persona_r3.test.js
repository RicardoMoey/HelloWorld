/* Persona ronda 3 (simulação/dados): nomes de recrutas únicos; artefactos da base alienígena; abortar e voltar não
   repõe a tripulação (guarnição do local); OVNI aterrado de noite nos meses 0–1 espera pelo dia; custos de contratação
   documentados como ours. Contrato: docs/CAMPAIGN_API.md §11.10; DESIGN §22. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign;
  const D = OV.Data;
  const U = OV.U;
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };
  const skyOf = (G) => Object.values(G.crafts).find((c) => c.type === 'skyranger');
  const arrive = (craft, kind, obj) => Object.assign(craft, { status: 'patrol', dest: { kind, id: obj.id }, lon: obj.lon, lat: obj.lat, speed: 0 });
  const aliensOf = (B) => B.units.filter((u) => u.origSide === 'alien');
  const typeBag = (list) => {
    const out = {};
    for (const x of list) out[x.type] = (out[x.type] | 0) + 1;
    return out;
  };

  function freshG(seed, diff) {
    const G = C.newCampaign({ seed, difficulty: diff === undefined ? 1 : diff });
    G.events.length = 0;
    return G;
  }
  function placeUfo(G, status, type, lon, lat) {
    const u = {
      id: C.nextId(G, 'u'), type, missionId: null, race: 'sectoid', region: OV.GMath.regionAt(lon, lat), traj: 'P9', wp: 0, lon, lat,
      dest: null, alt: 0, speed: 0, status, dmg: 0, detected: true, hyper: false, groundLeftS: 36000, crashLeftS: 3 * 86400, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }
  // mata o alienígena (sem cadáver: basta para o relatório) e tira-o do mapa
  function killAlien(B, u) {
    u.status = 'dead';
    u.hp = 0;
    OV.BUnits.removeUnitFromMap(B, u);
  }

  // ---- 1. nomes ---------------------------------------------------------------------------------------------
  t.test('recrutas: um nome já usado por um soldado vivo volta a ser sorteado (mesma nacionalidade)', () => {
    const G = freshG(11);
    const probe = OV.Soldiers.generate(U.clone(G), { baseId: 'b1' });
    const s0 = Object.values(G.soldiers)[0];
    const keep = s0.name;
    s0.name = probe.name;
    const s = OV.Soldiers.generate(G, { baseId: 'b1' });
    t.ok(s.name !== probe.name, 'nome repetido: ' + s.name);
    t.eq(s.nat, probe.nat, 'a nacionalidade sai antes do nome');
    s0.name = keep;
    // Campaign.makeSoldier segue a mesma regra
    const G2 = freshG(11);
    Object.values(G2.soldiers)[0].name = probe.name;
    t.ok(C.makeSoldier(G2, { baseId: 'b1' }).name !== probe.name);
  });

  t.test('recrutas: sem nomes livres acrescenta « II», « III»…', () => {
    const r = OV.RNG.create(5);
    const base = D.soldierName(OV.RNG.create(5), 'us', false);
    // todos os nomes simples e os « II» ocupados
    const taken = (nm) => !/ I{2,}$/.test(nm) || / II$/.test(nm);
    const name = D.soldierName(r, 'us', false, taken);
    t.ok(/ III$/.test(name), name);
    t.eq(D.soldierName(OV.RNG.create(5), 'us', false), base, 'sem predicado: o sorteio de sempre');
  });

  t.test('campanha nova: equipa inicial sem nomes repetidos (60 sementes, 3 dificuldades)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const diff of [0, 1, 2]) {
        const names = Object.values(C.newCampaign({ seed, difficulty: diff }).soldiers).map((s) => s.name);
        t.eq(new Set(names).size, names.length, 'semente ' + seed + '/' + diff + ': ' + names.join(', '));
      }
    }
  });

  t.test('batalha rápida: esquadra sem nomes repetidos', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const names = OV.Battle.quickMission({ ufoType: 'small_scout', seed, squadSize: 10 }).squad.map((s) => s.name);
      t.eq(new Set(names).size, names.length, 'semente ' + seed);
    }
  });

  // ---- 2. artefactos da base alienígena ---------------------------------------------------------------------
  t.test('base alienígena tomada: artefactos na proporção dos dispositivos intactos, com pontos enquanto não investigados', () => {
    const want = D.deployments.dep_alien_base.artefacts;
    t.ok(Object.keys(want).length >= 5);
    for (const seed of [1, 2]) {
      const B = OV.Battle.create(OV.Battle.quickMission({ kind: 'alienBase', month: 3, seed, difficulty: 1 }));
      t.ok(B.specials.DEVICE.length > 0, 'o mapa tem dispositivos');
      for (const u of aliensOf(B)) killAlien(B, u);
      const deb = OV.Battle.debrief(B, {});
      t.eq(deb.result, 'win');
      for (const k of Object.keys(want)) {
        t.eq(deb.recovered[k], want[k], k);
        t.ok(deb.lines.some((l) => l.itemId === k && l.points > 0), 'pontos de ' + k);
      }
      // investigado: o artefacto entra no armazém, sem pontos
      const deb2 = OV.Battle.debrief(B, { researched: Object.keys(want).map((k) => D.items[k].topic) });
      t.eq(deb2.recovered.alien_food, want.alien_food);
      t.ok(!deb2.lines.some((l) => l.itemId === 'alien_food'));
      // dispositivos destruídos: nada a recuperar
      for (const i of B.specials.DEVICE) for (let p = 0; p < 4; p++) {
        const d = OV.BMap.def(B.map, i, p);
        if (d && d.special === 'DEVICE') B.map.parts[i * 4 + p] = 0;
      }
      const deb3 = OV.Battle.debrief(B, {});
      for (const k of Object.keys(want)) t.eq(deb3.recovered[k] | 0, 0, k + ' sem dispositivos');
    }
  });

  t.test('base alienígena perdida/abortada: sem artefactos; OVNI continua sem eles', () => {
    const B = OV.Battle.create(OV.Battle.quickMission({ kind: 'alienBase', month: 3, seed: 3, difficulty: 1 }));
    drain(OV.Battle.beginBattle(B));
    OV.Battle.abort(B);
    const deb = OV.Battle.debrief(B, {});
    t.eq(deb.recovered.alien_food | 0, 0);
    const B2 = OV.Battle.create(OV.Battle.quickMission({ ufoType: 'small_scout', seed: 3 }));
    for (const u of aliensOf(B2)) killAlien(B2, u);
    t.eq(OV.Battle.debrief(B2, {}).recovered.alien_food | 0, 0);
  });

  // ---- 3. abortar e voltar ----------------------------------------------------------------------------------
  function farmSetup(seed, status) {
    const G = freshG(seed, 1);
    const b = G.bases[0];
    const sky = skyOf(G);
    const ufo = placeUfo(G, status, 'medium_scout', b.lon + 0.4, b.lat);
    return { G, sky, ufo };
  }
  function visit(G, sky, ufo) {
    arrive(sky, 'ufo', ufo);
    const M = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
    const B = OV.Battle.create(M);
    return { M, B };
  }

  t.test('abortar depois de abates: a tripulação seguinte são só os sobreviventes (tipos, patente, armamento)', () => {
    for (const [seed, status] of [[5, 'crashed'], [6, 'landed'], [9, 'landed']]) {
      const { G, sky, ufo } = farmSetup(seed, status);
      const { M, B } = visit(G, sky, ufo);
      t.ok(!M.garrison, '1.ª visita: tripulação da tabela');
      drain(OV.Battle.beginBattle(B));
      const alive = aliensOf(B).filter((u) => u.status !== 'dead');
      t.ok(alive.length >= 2, 'semente ' + seed + ': ' + alive.length + ' vivos');
      killAlien(B, alive[0]);
      const m1 = C.abortMission(G, B);
      t.eq(m1.debrief.result, 'abort');
      t.ok(m1.debrief.lines.some((l) => l.key === 'bs.debrief.aliensKilled'), 'o abate conta');
      t.ok(G.ufos.indexOf(ufo) >= 0, 'o OVNI fica no mapa');
      const gar = ufo.garrison;
      t.ok(gar && gar.visits === 1, 'guarnição guardada');
      t.eq(gar.crew.length, alive.length - 1, 'tripulação = sobreviventes');
      t.eq(typeBag(gar.crew), typeBag(alive.slice(1)));
      t.ok(Object.keys(gar.leftovers).length > 0, 'as armas do morto ficam no terreno');
      t.eq(OV.Battle.crewRange(C.startMission(G, { kind: 'ufo', id: ufo.id }, (arrive(sky, 'ufo', ufo), sky.id))).max, alive.length - 1);
      C.cancelMission(G);
      // 2.ª visita: exatamente os sobreviventes, sem novas mortes da queda
      const v2 = visit(G, sky, ufo);
      t.ok(!!v2.M.garrison);
      const crew2 = aliensOf(v2.B);
      t.eq(crew2.length, gar.crew.length);
      t.eq(typeBag(crew2), typeBag(gar.crew));
      t.ok(crew2.every((u) => u.status !== 'dead'), 'sem mortes da queda outra vez');
      t.eq(v2.B.crew.map((c) => c.tier), gar.crew.map((c) => c.tier), 'mesmo armamento');
      // vitória: o material deixado na 1.ª visita entra no armazém e o OVNI desaparece
      for (const u of crew2) killAlien(v2.B, u);
      const store0 = U.clone(G.bases[0].stores);
      const m2 = C.finishMission(G, v2.B);
      t.eq(m2.debrief.result, 'win');
      for (const k of Object.keys(gar.leftovers)) t.ok((G.bases[0].stores[k] | 0) >= (store0[k] | 0) + gar.leftovers[k], 'recolhido ' + k);
      t.ok(G.ufos.indexOf(ufo) < 0, 'OVNI tomado sai do mapa');
    }
  });

  t.test('abortar várias vezes não multiplica abates nem material: a pontuação total ≤ uma vitória', () => {
    const { G, sky, ufo } = farmSetup(5, 'crashed');
    let points = 0, killsTotal = 0, crew0 = 0;
    for (let v = 0; v < 6 && G.ufos.indexOf(ufo) >= 0; v++) {
      const { B } = visit(G, sky, ufo);
      drain(OV.Battle.beginBattle(B));
      const alive = aliensOf(B).filter((u) => u.status !== 'dead');
      if (v === 0) crew0 = aliensOf(B).filter((u) => !u.crashDead).length;
      if (alive.length) killAlien(B, alive[0]);
      const m = OV.Battle.outcome(B) === 'win' ? C.finishMission(G, B) : C.abortMission(G, B);
      points += m.debrief.score;
      killsTotal += m.debrief.kills;
    }
    t.ok(killsTotal <= crew0, 'abates ' + killsTotal + ' ≤ tripulação ' + crew0);
    t.ok(G.ufos.indexOf(ufo) < 0, 'acaba por ser tomado');
  });

  t.test('guarnição: gravar e carregar mantém-na; o abastecimento da base alienígena repõe-na', () => {
    const { G, sky, ufo } = farmSetup(6, 'landed');
    const { B } = visit(G, sky, ufo);
    drain(OV.Battle.beginBattle(B));
    killAlien(B, aliensOf(B).find((u) => u.status !== 'dead'));
    C.abortMission(G, B);
    sky.status = 'returning';
    const back = OV.Save.fromJSON(JSON.parse(JSON.stringify(OV.Save.toJSON(G, null, { label: 't', savedAt: '1999-01-01T00:00:00Z' })))).G;
    t.eq(JSON.stringify(C.findUfo(back, ufo.id).garrison), JSON.stringify(ufo.garrison));
    t.eq(C.hash(back), C.hash(G));
    // base alienígena com guarnição; uma Nave de Abastecimento aterra lá ⇒ guarnição completa outra vez
    const ab = { id: C.nextId(G, 'a'), lon: 10, lat: 45, race: 'sectoid', region: OV.GMath.regionAt(10, 45), country: null, missionId: null, discovered: true, foundT: 0, supplyT: null,
      garrison: { crew: [{ type: 'sectoid_soldier', rank: 'soldier', tier: 0, outside: 0 }], leftovers: {}, crashed: false, visits: 1 } };
    G.alienBases.push(ab);
    const m = { id: C.nextId(G, 'm'), type: 'alien_supply', region: ab.region, race: 'sectoid', wave: 0, ufoCounter: 1, countdownS: 0, liveUfos: [], cityId: null, targetBaseId: null, alienBaseId: ab.id, startedT: 0, script: null };
    G.alienMissions.push(m);
    const sup = placeUfo(G, 'flying', 'supply_ship', ab.lon, ab.lat);
    Object.assign(sup, { missionId: m.id, objective: true, wp: 1, traj: D.alienMissions.alien_supply.waves[0].traj || sup.traj });
    m.liveUfos.push(sup.id);
    OV.Missions.onUfoWaypoint(G, sup.id);
    t.ok(ab.supplyT !== null, 'abastecida');
    t.ok(!('garrison' in ab), 'guarnição reposta');
  });

  // ---- 4. aterragem noturna nos meses 0–1 ---------------------------------------------------------------------
  // primeira longitude em terra (passos de 5°, latitude 40) com a fase do dia pedida em G.t
  function lonWith(G, phase) {
    for (let lon = -180; lon < 180; lon += 5) if (OV.GMath.isLand(lon, 40) && OV.GMath.dayPhase(G, lon, 40) === phase) return lon;
    return null;
  }
  const nightLon = (G) => lonWith(G, 'night');
  function landNow(G, lon) {
    const u = placeUfo(G, 'flying', 'large_scout', lon, 40);
    Object.assign(u, { traj: 'P9', wp: 0, alt: 4, groundLeftS: 0 });
    OV.Missions.onUfoWaypoint(G, u.id);
    return u;
  }

  t.test('meses 0–1: OVNI que aterra de noite fica no chão até depois de amanhecer; mês 2: regra normal', () => {
    const groundS = D.trajectories ? D.trajectories.P9.groundS : null;
    for (const month of [0, 1]) {
      const G = freshG(3);
      G.month = month;
      const lon = nightLon(G);
      t.ok(lon !== null, 'há noite algures');
      const u = landNow(G, lon);
      t.eq(u.status, 'landed');
      const lift = (G.t | 0) + u.groundLeftS;
      t.eq(OV.GMath.dayPhase({ t: lift }, u.lon, u.lat), 'day', 'descola de dia');
      t.eq(OV.GMath.dayPhase({ t: lift - 1800 }, u.lon, u.lat), 'day', 'com pelo menos meia hora de dia');
      t.ok(u.groundLeftS <= OV.TUNE.NIGHT_LANDING_MAX_S);
      // a interface acorda «ao amanhecer» à hora certa (passos de 1 h) e o OVNI ainda lá está
      let h = 0;
      while (h < 24 && OV.GMath.dayPhase({ t: G.t + h * 3600 }, u.lon, u.lat) !== 'day') h++;
      t.ok(h * 3600 < u.groundLeftS, 'ainda no chão quando a interface avisa (' + h + ' h < ' + (u.groundLeftS / 3600).toFixed(1) + ' h)');
    }
    const G = freshG(3);
    G.month = 2;
    const u = landNow(G, nightLon(G));
    if (groundS !== null) t.eq(u.groundLeftS, groundS, 'mês 2: tempo da trajetória');
    t.ok(u.groundLeftS < 6 * 3600);
    // de dia, nos meses 0–1, também a regra normal
    const G2 = freshG(3);
    t.eq(landNow(G2, lonWith(G2, 'day')).groundLeftS, u.groundLeftS);
  });

  // ---- 5. contratação ---------------------------------------------------------------------------------------
  t.test('contratação: soldado orig (40/20 k$); cientista e engenheiro a um salário, marcado «ours» e documentado', () => {
    const T = OV.TUNE;
    t.eq([T.SOLDIER_HIRE, T.SCIENTIST_HIRE, T.ENGINEER_HIRE], [40000, 30000, 25000]);
    t.eq([T.SOLDIER_SALARY, T.SCIENTIST_SALARY, T.ENGINEER_SALARY], [20000, 30000, 25000]);
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '..', '..');
    const tuning = fs.readFileSync(path.join(root, 'js', 'data', 'tuning.js'), 'utf8');
    const line = tuning.split('\n').findIndex((l) => /SCIENTIST_HIRE:/.test(l));
    t.ok(line > 0 && /ours/.test(tuning.split('\n')[line - 1] + tuning.split('\n')[line - 2]), 'tuning.js marca a contratação como ours');
    t.ok(/\*\*ours\*\* `SCIENTIST_HIRE` 30 000/.test(fs.readFileSync(path.join(root, 'docs', 'CAMPAIGN_API.md'), 'utf8')), 'contrato §8 marca ours');
    t.ok(/Hiring scientists and engineers costs one month's salary/.test(fs.readFileSync(path.join(root, 'DESIGN.md'), 'utf8')), 'DESIGN §22');
    const G = freshG(2);
    const f0 = G.funds;
    t.ok(OV.BaseSim.hire(G, 'b1', 'engineer', 2).ok);
    t.eq(G.funds, f0 - 2 * T.ENGINEER_HIRE);
  });
};
