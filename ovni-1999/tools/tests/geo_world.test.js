/* Testes do OV.World (contrato docs/CAMPAIGN_API.md §3, §5.3, §9): ordens e motivos, interceção → dogfight, sombra de
   um transporte e chegada, combustível e regresso, patrulha, radar (probabilidade, perda, hiper-onda), ataque à base,
   salto de tempo idêntico a 5 s de cada vez, JSON depois de uma semana. Os módulos dos colegas (BaseSim, Economy,
   Soldiers, Dogfight) são isolados aqui; os duplos de teste vivem só neste ficheiro. */
module.exports = function (OV, t) {
  const W = OV.World, Camp = OV.Campaign, M = OV.GMath, C = OV.Clock, D = OV.Data;
  const MODS = ['BaseSim', 'Economy', 'Soldiers', 'Dogfight'];
  // corre fn sem os módulos dos colegas (e com os duplos dados)
  function iso(doubles, fn) {
    const saved = {};
    for (const k of MODS) { saved[k] = OV[k]; delete OV[k]; }
    Object.assign(OV, doubles || {});
    try { return fn(); } finally {
      for (const k of MODS) { if (saved[k] === undefined) delete OV[k]; else OV[k] = saved[k]; }
    }
  }
  const strip = (G) => { const o = JSON.parse(JSON.stringify(G)); delete o.events; return o; };
  const LIS = { lon: -9.14, lat: 38.72 };
  // campanha limpa: sem missões nem OVNIs (cada teste põe o que precisa)
  function fresh(seed) {
    const G = Camp.newCampaign({ seed: seed || 7, difficulty: 1 });
    G.alienMissions = [];
    G.ufos = [];
    G.events = [];
    return G;
  }
  function mkUfo(G, p) {
    const u = Object.assign({
      id: Camp.nextId(G, 'u'), type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
      lon: 0, lat: 40, dest: null, alt: 2, speed: 1000, status: 'flying', dmg: 0, detected: true, hyper: false,
      groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null,
    }, p);
    G.ufos.push(u);
    return u;
  }
  const at = (p, bearing, nm) => M.destination(p, bearing, nm);
  // corre até um evento de um tipo (ou até maxTicks); devolve os eventos vistos
  function runUntil(G, type, maxTicks, chunk) {
    const seen = [];
    let done = 0;
    while (done < maxTicks) {
      const r = W.step(G, Math.min(chunk || 60, maxTicks - done));
      done += r.ticks;
      for (const e of G.events.splice(0)) seen.push(e);
      if (seen.some((e) => e.t === type)) return seen;
      if (r.ticks === 0) break;
    }
    return seen;
  }
  const dogfightDouble = () => ({
    Dogfight: {
      create(G, craftId, ufoId) {
        const d = { id: Camp.nextId(G, 'd'), craftId, ufoId };
        G.dogfights.push(d);
        Camp.findCraft(G, craftId).dogfightId = d.id;
        return d;
      },
    },
  });

  // ---- step: guardas e paragens -------------------------------------------------------------------------------
  t.test('World.step: jogo acabado, batalha e dogfight não avançam o relógio', () => {
    const G = fresh();
    G.flags.lost = true;
    t.eq(W.step(G, 10), { ticks: 0, stopped: true, reason: 'ended' });
    G.flags.lost = false;
    G.activeMission = { siteRef: { kind: 'ufo', id: 'u1' }, craftId: 'c1', startedT: 0 };
    t.eq(W.step(G, 10).reason, 'battle');
    G.activeMission = null;
    G.dogfights.push({ id: 'd1' });
    t.eq(W.step(G, 10).reason, 'dogfight');
    t.eq(G.t, 0);
  });
  t.test('World.step: avança o pedido sem eventos e para no tick de um evento stop', () => {
    iso({}, () => {
      const G = fresh();
      t.eq(W.step(G, 100), { ticks: 100, stopped: false, reason: null });
      t.eq(G.t, 500);
      const u = mkUfo(G, { lon: LIS.lon, lat: LIS.lat - 5, detected: false, dest: { lon: LIS.lon, lat: LIS.lat - 30 } });
      G.debug = { revealUfos: true, instantResearch: false, instantBuild: false, instantProduction: false };
      const r = W.step(G, 1000);
      t.eq(r.stopped, true);
      t.eq(r.reason, 'event');
      t.eq(G.t, 1800, 'para na verificação dos 30 min');
      t.eq(r.ticks, 260);
      t.ok(G.events.some((e) => e.t === 'ufoDetected' && e.ufoId === u.id && e.hyper === false));
    });
  });
  t.test('World.step: planeia o mês se a campanha ainda não o fez (passo 0c) e muda de mês', () => {
    iso({}, () => {
      const G = fresh();
      G.plannedMonth = -1;
      W.step(G, 1);
      t.eq(G.plannedMonth, 0);
      t.ok(G.alienMissions.length >= 2);
      G.t = C.monthStartT(1) - 5;
      const n0 = G.alienMissions.length;
      W.step(G, 1);
      t.eq([G.month, G.plannedMonth], [1, 1]);
      t.ok(G.alienMissions.length > n0, 'guião do mês 1');
    });
  });

  // ---- ordens ---------------------------------------------------------------------------------------------------
  t.test('World.canOrder/order: motivos de bloqueio e avisos', () => {
    iso({}, () => {
      const G = fresh();
      const far = mkUfo(G, { lon: 140, lat: -35, speed: 1000 });
      const fast = mkUfo(G, { lon: -5, lat: 40, speed: 3000 });
      const hidden = mkUfo(G, { lon: -5, lat: 41, detected: false });
      const landed = mkUfo(G, { lon: -4, lat: 40, status: 'landed', speed: 0, alt: 0, groundLeftS: 9999 });
      t.eq(W.canOrder(G, 'c99', 'home'), { ok: false, reason: 'noCraft' });
      t.eq(W.canOrder(G, 'c2', { kind: 'ufo', id: hidden.id }), { ok: false, reason: 'noTarget' });
      t.eq(W.canOrder(G, 'c2', { kind: 'ufo', id: 'u999' }), { ok: false, reason: 'noTarget' });
      t.eq(W.canOrder(G, 'c2', { kind: 'cydonia' }), { ok: false, reason: 'noTarget' });
      t.eq(W.canOrder(G, 'c2', 'home'), { ok: false, reason: 'noTarget' }, 'já está na base');
      t.eq(W.canOrder(G, 'c2', { kind: 'ufo', id: fast.id }), { ok: true, warn: 'tooSlow' });
      t.eq(W.canOrder(G, 'c2', { kind: 'ufo', id: far.id }), { ok: true, warn: 'tooFar' });
      t.eq(W.canOrder(G, 'c1', { kind: 'ufo', id: fast.id }), { ok: true, warn: 'noWeapons' });
      t.eq(W.canOrder(G, 'c2', { kind: 'point', lon: 0, lat: 45 }), { ok: true });
      t.eq(W.canOrder(G, 'c1', { kind: 'ufo', id: landed.id }), { ok: true });
      // base alienígena por descobrir
      G.alienBases.push({ id: 'a1', lon: 0, lat: 45, race: 'sectoid', region: 'europe', country: null, missionId: null, discovered: false, foundT: null, supplyT: null });
      t.eq(W.canOrder(G, 'c1', { kind: 'alienBase', id: 'a1' }), { ok: false, reason: 'noTarget' });
      G.alienBases[0].discovered = true;
      t.eq(W.canOrder(G, 'c1', { kind: 'alienBase', id: 'a1' }), { ok: true });
      // transporte sem soldados aptos para um local em terra
      const sky = Camp.findCraft(G, 'c1');
      for (const id of sky.soldiers) G.soldiers[id].woundDays = 3;
      t.eq(W.canOrder(G, 'c1', { kind: 'ufo', id: landed.id }), { ok: false, reason: 'noSoldiers' });
      // manutenção: abaixo de 50 % não descola; acima pode (orig)
      const c3 = Camp.findCraft(G, 'c3');
      c3.status = 'refuel';
      c3.fuel = 400;
      t.eq(W.canOrder(G, 'c3', { kind: 'point', lon: 0, lat: 45 }), { ok: false, reason: 'notReady' });
      c3.fuel = 600;
      t.eq(W.canOrder(G, 'c3', { kind: 'point', lon: 0, lat: 45 }), { ok: true });
      t.eq(W.launch(G, 'c3', { kind: 'point', lon: 0, lat: 45 }), { ok: false, reason: 'notReady' }, 'launch exige ready');
      // no ar sem combustível só pode voltar
      const c2 = Camp.findCraft(G, 'c2');
      t.ok(W.order(G, 'c2', { kind: 'point', lon: 0, lat: 45 }).ok);
      c2.fuel = 0;
      t.eq(W.canOrder(G, 'c2', { kind: 'point', lon: 1, lat: 45 }), { ok: false, reason: 'noFuel' });
      t.eq(W.recall(G, 'c2'), { ok: true });
      t.eq(c2.status, 'returning');
      c2.dogfightId = 'd1';
      t.eq(W.canOrder(G, 'c2', 'home'), { ok: false, reason: 'inDogfight' });
    });
  });
  t.test('World.launch: descola, guarda missionT e completa o equipamento a partir do armazém', () => {
    iso({}, () => {
      const G = fresh();
      G.t = 600;
      const sky = Camp.findCraft(G, 'c1');
      const base = Camp.findBase(G, 'b1');
      const s = G.soldiers[sky.soldiers[0]];
      s.loadout.pack.push('smoke_grenade');
      const had = sky.equipment.smoke_grenade | 0, store = base.stores.smoke_grenade | 0;
      t.ok(store > 0, 'há granadas de fumo no armazém');
      const r = W.launch(G, 'c1', { kind: 'point', lon: 0, lat: 45 });
      t.eq(r, { ok: true });
      t.eq([sky.status, sky.missionT, sky.patrol, sky.lowFuel, sky.speed], ['out', 600, false, false, D.crafts.skyranger.speed]);
      t.eq(sky.equipment.smoke_grenade | 0, Math.max(had, 1));
      t.eq((base.stores.smoke_grenade | 0) + (sky.equipment.smoke_grenade | 0), store + had, 'nada se perde');
    });
  });

  // ---- voo e contactos --------------------------------------------------------------------------------------
  t.test('World: interceção com ponto de encontro cria um dogfight (dogfightStart) e o passo para', () => {
    iso(dogfightDouble(), () => {
      const G = fresh();
      const u = mkUfo(G, { lon: -5, lat: 42, dest: { lon: 20, lat: 42 }, speed: 1200 });
      t.eq(W.launch(G, 'c2', { kind: 'ufo', id: u.id }), { ok: true });
      const ev = runUntil(G, 'dogfightStart', 2000, 50);
      const df = ev.find((e) => e.t === 'dogfightStart');
      t.ok(df, 'dogfight começou');
      t.eq([df.craftId, df.ufoId], ['c2', u.id]);
      t.eq(G.dogfights.length, 1);
      const c2 = Camp.findCraft(G, 'c2');
      t.eq([c2.lon, c2.lat], [u.lon, u.lat], 'nave no OVNI');
      t.eq(c2.status, 'out');
      t.eq(W.step(G, 10).reason, 'dogfight');
      // a perseguição apontou para a frente do OVNI: o encontro foi a leste do ponto de partida do OVNI
      t.ok(u.lon > -5, 'encontro à frente');
    });
  });
  t.test('World: sem munições ou OVNI mais rápido não há dogfight; transporte segue o OVNI e chega quando aterra', () => {
    iso(dogfightDouble(), () => {
      const G = fresh();
      const u = mkUfo(G, { lon: -9, lat: 37, dest: { lon: -9, lat: 20 }, speed: 300 });
      t.eq(W.launch(G, 'c1', { kind: 'ufo', id: u.id }), { ok: true, warn: 'noWeapons' });
      let ev = [];
      for (let k = 0; k < 400; k++) { W.step(G, 1); ev = ev.concat(G.events.splice(0)); }
      const sky = Camp.findCraft(G, 'c1');
      t.eq(G.dogfights.length, 0);
      t.near(M.distNm(sky, u), 0, 1e-6, 'a sombra acompanha o OVNI');
      u.status = 'landed';
      u.speed = 0;
      u.alt = 0;
      u.dest = null;
      u.groundLeftS = 3600;
      ev = runUntil(G, 'craftArrived', 100, 1);
      const a = ev.find((e) => e.t === 'craftArrived');
      t.eq([a.craftId, a.target, a.prompt], ['c1', { kind: 'ufo', id: u.id }, 'mission']);
      t.eq([sky.status, sky.patrol], ['patrol', false]);
      // o OVNI descola: a nave volta a persegui-lo
      u.status = 'flying';
      u.speed = 300;
      u.alt = 1;
      u.dest = { lon: -9, lat: 10 };
      W.step(G, 1);
      t.eq(sky.status, 'out');
      // Intercetor contra um OVNI mais rápido: só sombra, sem dogfight
      const v = mkUfo(G, { lon: -9.14, lat: 38.8, dest: { lon: 60, lat: 38.8 }, speed: 2500 });
      W.launch(G, 'c2', { kind: 'ufo', id: v.id });
      for (let k = 0; k < 50; k++) { W.step(G, 1); G.events.length = 0; }
      t.eq(G.dogfights.length, 0, 'mais rápido que a nave');
    });
  });
  t.test('World: alvo perdido (OVNI fora do radar) → patrulha no último ponto visto e targetLost', () => {
    iso({}, () => {
      const G = fresh();
      const u = mkUfo(G, { lon: 60, lat: 50, dest: { lon: 80, lat: 50 }, speed: 2000, detected: true });
      W.launch(G, 'c2', { kind: 'ufo', id: u.id });
      u.lastSeen = { lon: 59, lat: 50, t: 0 };
      G.t = 1795;
      W.step(G, 1); // verificação dos 30 min: fora de todos os radares
      const lost = G.events.find((e) => e.t === 'ufoLost');
      t.ok(lost && lost.stop === true, 'perda com perseguidor pára o jogo');
      G.events.length = 0;
      W.step(G, 1);
      const c2 = Camp.findCraft(G, 'c2');
      const tl = G.events.find((e) => e.t === 'targetLost');
      t.ok(tl && tl.target.kind === 'ufo' && tl.target.id === u.id);
      t.eq([c2.status, c2.patrol, c2.dest.kind], ['patrol', true, 'point']);
      t.near(c2.dest.lon, u.lastSeen.lon, 1e-9);
      // sem perseguidor a perda não pára
      const v = mkUfo(G, { lon: 100, lat: 0, dest: { lon: 101, lat: 0 }, speed: 100, detected: true });
      G.events.length = 0;
      G.t = 3595;
      W.detect(G);
      t.eq(G.events.find((e) => e.ufoId === v.id).stop, false);
    });
  });
  t.test('World: chegada a um ponto → patrulha; patrulha perto de base alienígena revela-a', () => {
    iso({}, () => {
      const G = fresh();
      const p = at(LIS, 45, 500);
      W.launch(G, 'c2', { kind: 'point', lon: p.lon, lat: p.lat });
      const ev = runUntil(G, 'craftArrived', 2000, 100);
      const a = ev.find((e) => e.t === 'craftArrived');
      t.eq(a.prompt, 'patrol');
      const c2 = Camp.findCraft(G, 'c2');
      t.eq([c2.status, c2.patrol, c2.speed], ['patrol', true, D.crafts.interceptor.speed / 2]);
      G.alienBases.push({ id: 'a1', lon: c2.lon, lat: c2.lat, race: 'sectoid', region: 'europe', country: null, missionId: null, discovered: false, foundT: null, supplyT: null });
      G.alienBases.push({ id: 'a2', lon: 120, lat: -30, race: 'sectoid', region: 'australasia', country: null, missionId: null, discovered: false, foundT: null, supplyT: null });
      for (let k = 0; k < 40 && !G.alienBases[0].discovered; k++) W.patrolDiscovery(G);
      t.ok(G.alienBases[0].discovered, '50 % a cada 10 min junto à base');
      t.eq(G.alienBases[1].discovered, false, 'longe de mais');
      t.ok(G.events.some((e) => e.t === 'alienBaseFound' && e.alienBaseId === 'a1' && e.how === 'patrol'));
      // ordem de patrulha no sítio onde está: fica logo a patrulhar, sem aviso
      W.order(G, 'c2', { kind: 'point', lon: c2.lon, lat: c2.lat });
      t.eq([c2.status, c2.patrol], ['patrol', true]);
    });
  });
  t.test('World: pouco combustível → regressa (craftLowFuel); a zero ainda aterra na base (refuel)', () => {
    iso({}, () => {
      const G = fresh();
      const c2 = Camp.findCraft(G, 'c2');
      const p = at(LIS, 270, 2500);
      W.launch(G, 'c2', { kind: 'point', lon: p.lon, lat: p.lat });
      c2.fuel = 200;
      const ev = runUntil(G, 'craftLowFuel', 20000, 120);
      t.ok(ev.some((e) => e.t === 'craftLowFuel' && e.craftId === 'c2'));
      t.eq([c2.status, c2.lowFuel, c2.dest], ['returning', true, { kind: 'base', id: 'b1' }]);
      t.ok(c2.fuel > 0, 'o aviso chega antes de ficar sem nada');
      c2.fuel = 0; // mesmo a zero continua até casa
      const ev2 = runUntil(G, 'craftReturned', 20000, 120);
      t.ok(ev2.some((e) => e.t === 'craftReturned' && e.baseId === 'b1'));
      t.eq(c2.fuel, 0);
      t.eq([c2.status, c2.speed, c2.dest, c2.lowFuel], ['refuel', 0, null, false]);
      t.eq([c2.lon, c2.lat], [Camp.findBase(G, 'b1').lon, Camp.findBase(G, 'b1').lat]);
      t.ok(!ev2.some((e) => e.t === 'craftLost'));
    });
  });
  t.test('World.burnFuel: consumo a cada 10 min pela velocidade atual (patrulha a meio)', () => {
    iso({}, () => {
      const G = fresh();
      const c2 = Camp.findCraft(G, 'c2');
      W.launch(G, 'c2', { kind: 'point', lon: -9, lat: 39 });
      const f0 = c2.fuel;
      W.burnFuel(G);
      t.eq(c2.fuel, f0 - D.craftFuelPer10Min('interceptor', 2100));
      c2.status = 'patrol';
      c2.patrol = true;
      c2.speed = 1050;
      W.burnFuel(G);
      t.eq(c2.fuel, f0 - 21 - 10);
    });
  });
  t.test('World.checkup: reparar → rearmar → reabastecer → pronta', () => {
    const G = fresh();
    const c2 = Camp.findCraft(G, 'c2');
    t.eq(W.checkup(G, 'c2'), 'ready');
    c2.fuel -= 1;
    t.eq(W.checkup(G, 'c2'), 'refuel');
    c2.weapons[0].ammo -= 1;
    t.eq(W.checkup(G, 'c2'), 'rearm');
    c2.hp -= 1;
    t.eq(W.checkup(G, 'c2'), 'repair');
  });

  // ---- radar -----------------------------------------------------------------------------------------------------
  t.test('World.detect: probabilidade em 2 000 verificações dentro de ±3 % da fórmula', () => {
    iso({}, () => {
      const G = fresh(11);
      const base = Camp.findBase(G, 'b1');
      base.grid.push({ type: 'large_radar', x: 0, y: 0, daysLeft: 0 }, { type: 'small_radar', x: 5, y: 0, daysLeft: 3 });
      const p = at(LIS, 90, 1200);
      const u = mkUfo(G, { lon: p.lon, lat: p.lat, dest: null, alt: 1, detected: false });
      // radar pequeno 15 + grande 30 (o que está em obra não conta) × (100 − 15 − 20)/100
      t.eq(W.detectChance(G, u.id, 'b1'), Math.floor((45 * 65) / 100));
      const far = mkUfo(G, { lon: p.lon, lat: p.lat, alt: 1, detected: false });
      Object.assign(far, at(LIS, 90, 2000));
      t.eq(W.detectChance(G, far.id, 'b1'), Math.floor((30 * 65) / 100), 'só o radar grande chega');
      far.status = 'crashed';
      let hits = 0;
      for (let k = 0; k < 2000; k++) {
        u.detected = false;
        W.detect(G);
        if (u.detected) hits++;
      }
      t.near(hits / 2000, 0.29, 0.03, 'frequência');
      t.eq(G.stats.ufosDetected, hits);
      // em terra: −30 em vez do tamanho
      u.status = 'landed';
      u.alt = 0;
      t.eq(W.detectChance(G, u.id, 'b1'), Math.floor((45 * 70) / 100));
    });
  });
  t.test('World.detect: radar de nave no ar deteta logo; hiper-onda identifica e regista o tipo e a raça', () => {
    iso({}, () => {
      const G = fresh();
      const p = at(LIS, 0, 5000);
      const u = mkUfo(G, { lon: p.lon, lat: p.lat, detected: false, type: 'abductor', race: 'floater' });
      const c2 = Camp.findCraft(G, 'c2');
      W.launch(G, 'c2', { kind: 'point', lon: 0, lat: 0 });
      Object.assign(c2, at(p, 180, 500));
      W.detect(G);
      t.eq([u.detected, u.hyper], [true, false]);
      t.ok(u.lastSeen && u.lastSeen.t === G.t);
      const G2 = fresh();
      const base = Camp.findBase(G2, 'b1');
      base.grid.push({ type: 'hyper_wave_decoder', x: 0, y: 0, daysLeft: 0 });
      const v = mkUfo(G2, Object.assign(at(LIS, 90, 2500), { detected: false, type: 'abductor', race: 'floater' }));
      W.detect(G2);
      t.eq([v.detected, v.hyper], [true, true]);
      t.ok(G2.seen.ufoTypes.indexOf('abductor') >= 0 && G2.seen.races.indexOf('floater') >= 0);
      t.eq(G2.events.find((e) => e.t === 'ufoDetected').hyper, true);
      const circles = W.radarCircles(G2);
      t.ok(circles.some((c) => c.kind === 'hyper_wave_decoder' && c.rangeNm === 2759 && c.baseId === 'b1'));
      t.ok(circles.some((c) => c.kind === 'small_radar' && c.rangeNm === 1695));
      t.ok(!circles.some((c) => c.kind === 'craft'), 'naves no hangar não têm radar');
      t.ok(W.radarCircles(G).some((c) => c.kind === 'craft' && c.craftId === 'c2' && c.rangeNm === 672));
    });
  });

  // ---- base atacada, naves perdidas, gravação --------------------------------------------------------------------
  t.test('World.contacts: Couraçado do ataque chega à base → baseAttack + Campaign.baseDefence; o OVNI desaparece', () => {
    iso({}, () => {
      const G = fresh();
      const m = OV.Missions.spawnMission(G, 'alien_retaliation', { region: 'europe', race: 'sectoid', delayMin: 600, targetBaseId: 'b1' });
      const u = mkUfo(G, Object.assign(at(LIS, 0, 40), { type: 'battleship', traj: 'assault', missionId: m.id, targetBaseId: 'b1', speed: 5000, dest: { lon: LIS.lon, lat: LIS.lat } }));
      m.liveUfos.push(u.id);
      m.wave = D.alienMissions.alien_retaliation.waves.length + 1;
      const old = Camp.baseDefence;
      const calls = [];
      Camp.baseDefence = (G2, baseId, ufoId) => { calls.push([baseId, ufoId]); return { result: 'repelled', shots: [], soldiersLost: [] }; };
      try {
        const ev = runUntil(G, 'baseAttack', 200, 1);
        t.ok(ev.some((e) => e.t === 'baseAttack' && e.baseId === 'b1' && e.ufoId === u.id));
        t.eq(calls, [['b1', u.id]]);
        t.eq(Camp.findUfo(G, u.id), null, 'OVNI retirado');
        t.eq(Camp.findAlienMission(G, m.id), null, 'retaliação acabou');
      } finally {
        if (old === undefined) delete Camp.baseDefence; else Camp.baseDefence = old;
      }
    });
  });
  t.test('World.loseCraft: tira a nave e a tripulação, conta a estatística e avisa', () => {
    const G = fresh();
    const crew = Camp.findCraft(G, 'c1').soldiers.slice();
    const ev = W.loseCraft(G, 'c1', 'dogfight');
    t.eq([ev.t, ev.type, ev.reason, ev.soldiers], ['craftLost', 'skyranger', 'dogfight', crew]);
    t.eq(Camp.findCraft(G, 'c1'), null);
    t.eq(Camp.findBase(G, 'b1').crafts.indexOf('c1'), -1);
    for (const id of crew) t.eq(Camp.findSoldier(G, id), null);
    t.eq(G.stats.craftsLost, 1);
  });
  t.test('World.autosave: dias 1, 10 e 20 do mês', () => {
    const G = fresh();
    const days = [];
    for (let d = 0; d < 40; d++) {
      G.events = [];
      G.t = 43200 + d * 86400;
      W.autosave(G);
      if (G.events.length) days.push(C.date(G).d);
    }
    t.eq(days, [10, 20, 1, 10]);
  });

  // ---- determinismo ----------------------------------------------------------------------------------------------
  t.test('World.step: salto de tempo sem nada no ar = 5 s de cada vez (hash igual numa semana)', () => {
    iso({}, () => {
      const G1 = Camp.newCampaign({ seed: 23, difficulty: 1 });
      const G2 = JSON.parse(JSON.stringify(G1));
      Camp.rebuildDerived(G2);
      const N = 7 * 17280;
      // espia o relógio: o modo rápido tem de dar saltos maiores do que 1 tick
      const adv = C.advance;
      let jumps = 0;
      C.advance = (G, k) => { if (k > 1) jumps++; return adv(G, k); };
      let done = 0, calls = 0;
      try {
        while (done < N) {
          const r = W.step(G1, N - done);
          done += r.ticks;
          calls++;
          G1.events.length = 0;
          t.ok(r.ticks > 0, 'avança');
        }
      } finally { C.advance = adv; }
      for (let k = 0; k < N; k++) { W.step(G2, 1); G2.events.length = 0; }
      t.ok(jumps > 50, 'houve saltos: ' + jumps);
      t.eq(G1.t, G2.t);
      t.eq(Camp.hash(G1), Camp.hash(G2));
      t.eq(strip(G1), strip(G2));
    });
  });
  t.test('World: JSON depois de uma semana simulada é igual e a continuação dá o mesmo hash', () => {
    iso({}, () => {
      const G = Camp.newCampaign({ seed: 5, difficulty: 0 });
      const end = 7 * 86400;
      while (G.t < end) {
        W.step(G, Math.min(720, (end - G.t) / 5));
        G.events.length = 0;
        const j = JSON.parse(JSON.stringify(G));
        delete j.events;
        t.eq(j, strip(G), 'JSON puro em t=' + G.t);
      }
      const G2 = JSON.parse(JSON.stringify(G));
      Camp.rebuildDerived(G2);
      t.eq(Camp.hash(G2), Camp.hash(G));
      for (const X of [G, G2]) {
        let left = 3 * 17280;
        while (left > 0) { const r = W.step(X, left); left -= r.ticks; X.events.length = 0; }
      }
      t.eq(Camp.hash(G2), Camp.hash(G));
    });
  });
  t.test('World (integração com os módulos presentes): 10 dias sem erros e JSON puro', () => {
    const G = Camp.newCampaign({ seed: 3, difficulty: 1 });
    const end = 10 * 86400;
    while (G.t < end && !G.flags.lost) {
      const r = W.step(G, 17280);
      G.events.length = 0;
      if (r.ticks === 0) break;
    }
    t.ok(G.t >= end || G.flags.lost);
    t.eq(JSON.parse(JSON.stringify(strip(G))), strip(G));
  });
};
