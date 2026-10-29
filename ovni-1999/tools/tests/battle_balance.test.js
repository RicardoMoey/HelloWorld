/* Equilíbrio da batalha: segurança da desova (bunits/mapgen), conhecimento dos alienígenas no turno 1 (ai.js) e
   tática do playerBot (vigia, lanços, fogo concentrado, granadas, fumo, medikit, recuo, coesão). */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const AI = OV.AI;
  const id = (k) => D.tileId(k);
  const sim = require('../sim.js');
  const TERROR = new Set(D.TERROR_UNITS);
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  // distância (Chebyshev, mesmo nível ou ±1) da unidade ao início X-COM mais próximo
  function startDist(B, u) {
    let d = 999;
    for (const i of B.xcomStarts) {
      const [x, y, z] = BM.xyz(B.map, i);
      if (Math.abs(z - u.z) > 1) continue;
      for (const [tx, ty] of BU.unitTiles(u).map((p) => [p.x, p.y])) d = Math.min(d, cheb(tx, ty, x, y));
    }
    return d;
  }

  // ---- 1. segurança da desova ------------------------------------------------------------------------------
  t.test('Desova: nenhum alienígena a < 10 tiles dos inícios X-COM, terror a < 14 (todas as missões, Veterano e Super-humano)', () => {
    let n = 0, terror = 0;
    for (const s of sim.SWEEP) {
      for (const diff of [1, 2]) {
        for (const seed of [2, 5, 9]) {
          const B = BT.create(sim.missionFor({ ufo: s.ufo, kind: s.kind, month: s.month, diff, seed }));
          for (const u of B.units) {
            if (u.side !== 'alien' || !u.onMap) continue;
            const d = startDist(B, u);
            const lim = TERROR.has(u.type) ? 14 : 10;
            t.ok(d >= lim, s.id + '/' + diff + '/' + seed + ': ' + u.type + ' a ' + d + ' tiles (mínimo ' + lim + ')');
            n++;
            if (TERROR.has(u.type)) terror++;
          }
        }
      }
    }
    t.ok(n > 300 && terror > 20, 'amostra: ' + n + ' alienígenas, ' + terror + ' de terror');
  });

  t.test('Desova: base alienígena sem unidades de terror no módulo do elevador nem nos vizinhos', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const B = BT.create(sim.missionFor({ kind: 'alienBase', month: 3, diff: 2, seed }));
      const cells = new Set();
      for (const i of B.xcomStarts) {
        const [x, y] = BM.xyz(B.map, i);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.add((((y / 10) | 0) + dy) * 100 + ((x / 10) | 0) + dx);
      }
      for (const u of B.units) {
        if (u.side !== 'alien' || !TERROR.has(u.type)) continue;
        for (const p of BU.unitTiles(u)) t.ok(!cells.has(((p.y / 10) | 0) * 100 + ((p.x / 10) | 0)), 'semente ' + seed + ': ' + u.type + ' em ' + p.x + ',' + p.y);
      }
    }
  });

  t.test('Desova: tripulação do OVNI continua lá dentro; nós exteriores a < 12 tiles com prio 0; mapa determinístico', () => {
    let inside = 0, crew = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const B = BT.create(sim.missionFor({ ufo: 'abductor', month: 1, diff: 1, seed }));
      const r = B.ufo;
      for (const u of B.units) {
        if (u.side !== 'alien' || !u.onMap) continue;
        crew++;
        if (u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h) inside++;
        if (u.rank === 'leader') t.ok(u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h, 'líder dentro do OVNI');
      }
      const dist = OV.MapGen.startDistance(B.map, B.xcomStarts);
      for (const nd of B.nodes) {
        if (nd.inside) t.ok(dist[BM.idx(B.map, nd.x, nd.y, nd.z)] >= 10, 'nó do OVNI longe da nave');
        else if (dist[BM.idx(B.map, nd.x, nd.y, nd.z)] < 12) t.eq(nd.prio, 0, 'nó exterior perto da nave despromovido');
      }
    }
    t.ok(inside * 2 > crew, 'a maior parte da tripulação dentro do OVNI: ' + inside + '/' + crew);
    const m = sim.missionFor({ ufo: 'battleship', month: 3, diff: 2, seed: 4 });
    t.eq(BT.hash(BT.create(m)), BT.hash(BT.create(sim.missionFor({ ufo: 'battleship', month: 3, diff: 2, seed: 4 }))), 'mesma semente ⇒ mesmo B');
  });

  t.test('Desova: recuo determinístico quando o mapa é pequeno demais (nunca larga um alienígena)', () => {
    const m = BM.create(14, 14, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = id('FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', phase: 'setup', xcomStarts: [BM.idx(m, 7, 7, 0)],
      mission: { kind: 'crash', difficulty: 1, deploymentId: 'dep_small_scout' }, nodes: [],
    };
    BT.rebuildDerived(B);
    const a = BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(3), 'dep_small_scout');
    // nenhum tile a ≥ 10 tiles: o limiar desce até haver tiles suficientes (aqui 7: só a orla do mapa)
    t.ok(BU.spawnAllowed(B, a, BM.idx(m, 0, 0, 0)) && !BU.fits(B, a, BM.idx(m, 1, 1, 0)), 'mapa pequeno: limiar recuado');
    const tiny = BM.create(8, 8, 1);
    for (let i = 0; i < tiny.n; i++) tiny.parts[i * 4] = id('FARM.ground');
    const B0 = Object.assign({}, B, { map: tiny, units: [], items: [], nextId: 1, xcomStarts: [BM.idx(tiny, 4, 4, 0)] });
    BT.rebuildDerived(B0);
    const a0 = BU.fromAlien(B0, 'sectoid_soldier', 0, OV.RNG.create(3), 'dep_small_scout');
    t.ok(BU.fits(B0, a0, BM.idx(tiny, 5, 5, 0)), 'sem espaço nenhum: sem restrição (nunca larga um alienígena)');
    // mapa grande: restrição normal; fora da preparação não há restrição
    const g = BM.create(40, 40, 1);
    for (let i = 0; i < g.n; i++) g.parts[i * 4] = id('FARM.ground');
    const B2 = Object.assign({}, B, { map: g, units: [], items: [], nextId: 1, xcomStarts: [BM.idx(g, 2, 2, 0)] });
    BT.rebuildDerived(B2);
    const s2 = BU.fromAlien(B2, 'sectoid_soldier', 0, OV.RNG.create(3), 'dep_small_scout');
    const c2 = BU.fromAlien(B2, 'chryssalid', 0, OV.RNG.create(3), 'dep_terror_site');
    t.ok(!BU.fits(B2, s2, BM.idx(g, 11, 2, 0)) && BU.fits(B2, s2, BM.idx(g, 12, 2, 0)), 'soldado: 10 tiles');
    t.ok(!BU.fits(B2, c2, BM.idx(g, 15, 15, 0)) && BU.fits(B2, c2, BM.idx(g, 16, 16, 0)), 'terror: 14 tiles');
    B2.phase = 'play';
    t.ok(BU.fits(B2, s2, BM.idx(g, 3, 3, 0)), 'em jogo (zombies, reforços): sem restrição');
  });

  // ---- fixtures de IA ---------------------------------------------------------------------------------------
  function fixture(o) {
    const opt = o || {};
    const m = BM.create(opt.w || 30, opt.h || 20, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = id('FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: opt.turn || 1, side: opt.side || 'xcom', phase: 'play', aborted: false,
      pendingExplosions: [], reserve: 'none', reserveKneel: false, craftTiles: [], specials: {}, nodes: opt.nodes || [],
      xcomStarts: opt.starts || [], settings: { instantGrenades: true }, cheat: false,
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 1, shade: 0, deploymentId: 'dep_terror_site', craftType: 'skyranger' },
      rng: OV.RNG.streams(opt.seed || 11),
    };
    BT.rebuildDerived(B);
    // sentinela fora do mapa: um alienígena vivo que ninguém vê (a batalha não acaba)
    if (!opt.empty) BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(1), 'dep_terror_site');
    return B;
  }
  const I = (B, x, y) => BM.idx(B.map, x, y, 0);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'B' + sid++, name: 'Teste', nat: 'pt', rank: 0, armour: 'coveralls', missions: 0,
      stats: Object.assign({ tu: 60, sta: 60, hp: 40, brav: 60, react: 50, fire: 60, thr: 60, str: 40, melee: 30, psiStr: 60, psiSkill: 0 }, opt.stats || {}),
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: 'rifle', L: null, belt: ['rifle_clip', 'grenade'], pack: [] });
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = opt.dir === undefined ? 2 : opt.dir;
    return u;
  }
  function alien(B, type, x, y, o) {
    const opt = o || {};
    const u = BU.fromAlien(B, type, 0, OV.RNG.create(opt.seed || 5), 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = opt.dir === undefined ? 6 : opt.dir;
    return u;
  }
  const run = (B, gen) => {
    const ev = [];
    const st = { ended: false, events: 0, check: true };
    let r;
    while (!(r = gen.next()).done) {
      ev.push(r.value);
      const errs = sim.checkInvariants(B, r.value, st);
      if (errs.length) throw new Error('invariante: ' + errs.join('; ') + ' (evento ' + r.value.t + ')');
    }
    return { ev, ret: r.value };
  };
  const ofType = (ev, ty) => ev.filter((e) => e.t === ty);

  // ---- 2. conhecimento dos alienígenas antes do turno de batota ----------------------------------------------
  t.test('Turno 1: alienígenas que não viram ninguém não escolhem alvos nem caminham para a X-COM', () => {
    let checked = 0;
    for (const s of ['abductor', 'terror', 'alienBase', 'battleship']) {
      const def = sim.SWEEP.find((x) => x.id === s);
      for (const seed of [1, 2, 3]) {
        const B = BT.create(sim.missionFor({ ufo: def.ufo, kind: def.kind, month: def.month, diff: 1, seed }));
        const drain = (g) => { let r; while (!(r = g.next()).done); };
        drain(BT.beginBattle(B));
        // a X-COM fica na nave (nenhum soldado se mexe): passa ao turno alienígena
        B.side = 'alien';
        OV.LOS.refreshAll(B);
        const seenBefore = new Set(B._.visible.alien);
        const xcom = B.units.filter((u) => u.side === 'xcom');
        const d0 = new Map();
        const near = (a) => Math.min(...xcom.map((x) => cheb(a.x, a.y, x.x, x.y)));
        for (const a of B.units) if (a.side === 'alien' && a.onMap) d0.set(a.id, near(a));
        const ctx = AI.turnContext(B, 'alien');
        t.ok(!ctx.cheat, 'turno 1 sem batota');
        const blind = B.units.filter((a) => a.side === 'alien' && a.onMap && !(B._.sees[a.id] && [...B._.sees[a.id]].some((x) => seenBefore.has(x))));
        for (const a of blind) {
          const c = AI.unitContext(B, a, ctx);
          if (seenBefore.size) continue;
          t.eq(c.known.length, 0, s + '/' + seed + ': ' + a.type + ' não conhece ninguém');
        }
        if (seenBefore.size) continue;
        const g = AI.turn(B, 'alien');
        const spotted = new Set();
        let r;
        while (!(r = g.next()).done) if (r.value.t === 'spotted' || (r.value.t === 'step' && B._.visible.alien.size)) for (const x of B._.visible.alien) spotted.add(x);
        if (spotted.size) continue; // alguém viu um soldado durante o turno (legítimo)
        for (const a of blind) {
          if (!a.onMap) continue;
          t.eq(a.ai.aggroId, null, s + '/' + seed + ': ' + a.type + ' sem alvo');
          t.ok(a.ai.mode !== 'combat', s + '/' + seed + ': ' + a.type + ' não está em combate (' + a.ai.mode + ')');
          checked++;
        }
      }
    }
    t.ok(checked >= 10, 'alienígenas verificados: ' + checked);
  });

  t.test('Crisálida/Ceifador: patrulham em vez de investir contra quem não viram (memória própria, ouvido a ≤ 8, batota)', () => {
    const B = fixture({ side: 'alien', w: 34, h: 16 });
    const s = soldier(B, 28, 8);
    const c = alien(B, 'chryssalid', 4, 8, { dir: 6 }); // de costas para o soldado, a 24 tiles
    OV.LOS.refreshAll(B);
    s.turnsSinceSpotted = 0; // outro alienígena viu-o: conhecido do lado
    let ctx = AI.turnContext(B, 'alien');
    let uc = AI.unitContext(B, c, ctx);
    t.eq(uc.known.length, 0, 'não o viu ela própria nem o ouve');
    t.eq(AI.chooseMode(B, c, uc, ctx), 'patrol');
    c.ai.memory.seen = { [s.id]: B.turn };
    uc = AI.unitContext(B, c, ctx);
    t.eq([uc.known.length, AI.chooseMode(B, c, uc, ctx)], [1, 'combat'], 'viu-o ela própria: investe');
    c.ai.memory.seen = {};
    BU.placeUnit(B, c, I(B, 21, 8));
    OV.LOS.refreshAll(B);
    uc = AI.unitContext(B, c, ctx);
    t.eq(uc.known.length, 1, 'a 7 tiles ouve-o');
    BU.placeUnit(B, c, I(B, 4, 8));
    OV.LOS.refreshAll(B);
    B.turn = 30;
    ctx = AI.turnContext(B, 'alien');
    t.ok(ctx.cheat, 'turno de batota');
    uc = AI.unitContext(B, c, ctx);
    t.eq(uc.known.length, 1, 'na batota conhece todos');
  });

  t.test('Blaster: o comandante só dispara bombas pelas regras dos explosivos (nunca antes do turno 3)', () => {
    const B = fixture({ side: 'alien', turn: 1 });
    const s = soldier(B, 20, 8);
    const a = alien(B, 'floater_commander', 6, 8, { dir: 2 });
    for (const h of ['R', 'L']) if (a.items[h] !== null) BU.deleteItem(B, a.items[h]);
    for (const it of BU.allItems(B, a)) BU.deleteItem(B, it.id);
    const bl = BU.newItem(B, 'blaster_launcher', { ammo: 'blaster_bomb' });
    BU.giveItem(B, a, bl.id, 'R', true);
    a.ai.mode = 'combat';
    OV.LOS.refreshAll(B);
    t.ok(OV.LOS.isVisibleTo(B, 'alien', s), 'vê o soldado');
    const r = run(B, AI.turn(B, 'alien'));
    t.eq(ofType(r.ev, 'shot').filter((e) => e.shooterId === a.id).length, 0, 'turno 1: sem bomba');
  });

  // ---- 3. playerBot ---------------------------------------------------------------------------------------------
  t.test('playerBot: sem inimigos, avança em lanço (≤ 60 % das UT) e acaba ajoelhado, virado para a ameaça, com UT de reação', () => {
    const nodes = [{ x: 26, y: 10, z: 0, rank: 1, prio: 3, inside: false }];
    const B = fixture({ nodes, turn: 3 });
    const sq = [soldier(B, 3, 8), soldier(B, 3, 11), soldier(B, 5, 9), soldier(B, 5, 12)];
    OV.LOS.refreshAll(B);
    run(B, AI.turn(B, 'xcom'));
    const snap = (u) => BU.actionTU(B, u, u.items.R, 'snap');
    let moved = 0;
    for (const u of sq) {
      t.ok(u.kneel, 'ajoelhado ' + u.id);
      t.ok(u.tu >= snap(u), 'UT para um tiro rápido de reação: ' + u.tu);
      if (u.x > 6) moved++;
      const dir = OV.U.dirTo(26 - u.x, 10 - u.y);
      t.ok(Math.min((u.dir - dir + 8) & 7, (dir - u.dir + 8) & 7) <= 1, 'virado para o objetivo');
    }
    t.ok(moved >= 2, 'a retaguarda avançou: ' + moved);
    // coesão: ninguém a mais de 6 tiles do aliado mais próximo
    for (const u of sq) t.ok(Math.min(...sq.filter((x) => x !== u).map((x) => cheb(u.x, u.y, x.x, x.y))) <= 6, 'coeso');
  });

  t.test('playerBot: fogo concentrado no alienígena mais fácil de abater; ajoelha antes de disparar', () => {
    const B = fixture({ turn: 4 });
    const s = soldier(B, 4, 9, { dir: 2 });
    // de costas: não veem o soldado (ajoelhar à vista de um alienígena provocaria fogo de reação)
    const a1 = alien(B, 'sectoid_soldier', 13, 4, { dir: 2 });
    const a2 = alien(B, 'sectoid_soldier', 13, 13, { dir: 2 });
    a2.hp = 3; // ferido
    OV.LOS.refreshAll(B);
    t.ok(B._.sees[s.id] && B._.sees[s.id].has(a1.id) && B._.sees[s.id].has(a2.id), 'vê os dois');
    const ctx = AI.turnContext(B, 'xcom');
    const first = AI.think(B, s, ctx);
    t.eq(first.type, 'kneel', 'ajoelha primeiro');
    run(B, OV.Act.perform(B, first));
    ctx.cache.clear();
    const shot = AI.think(B, s, ctx);
    t.eq([shot.type, shot.target.unitId], ['shoot', a2.id], 'dispara no ferido');
  });

  t.test('playerBot: granada num grupo de alienígenas e numa Crisálida a aproximar-se (sem aliados no raio)', () => {
    const B = fixture({ turn: 4 });
    const s = soldier(B, 4, 9, { dir: 2 });
    soldier(B, 2, 15, { dir: 2 });
    alien(B, 'sectoid_soldier', 13, 9);
    alien(B, 'sectoid_soldier', 14, 10);
    alien(B, 'sectoid_soldier', 13, 11);
    OV.LOS.refreshAll(B);
    const r = run(B, AI.turn(B, 'xcom'));
    t.ok(ofType(r.ev, 'throw').some((e) => e.unitId === s.id), 'lançou a granada no grupo');
    const B2 = fixture({ turn: 4 });
    const s2 = soldier(B2, 4, 9, { dir: 2 });
    alien(B2, 'chryssalid', 12, 9);
    OV.LOS.refreshAll(B2);
    const r2 = run(B2, AI.turn(B2, 'xcom'));
    t.ok(ofType(r2.ev, 'throw').some((e) => e.unitId === s2.id), 'granada na Crisálida a 8 tiles');
  });

  t.test('playerBot: medikit em quem sangra; ferido grave sai da vista; fumo a cobrir um ferido exposto', () => {
    // medikit
    const B = fixture({ turn: 3 });
    const medic = soldier(B, 6, 6, { loadout: { R: 'rifle', L: null, belt: ['rifle_clip'], pack: ['medikit'] } });
    const hurt = soldier(B, 7, 6);
    hurt.wounds[1] = 2;
    OV.LOS.refreshAll(B);
    run(B, AI.turn(B, 'xcom'));
    t.ok(hurt.wounds.reduce((a, w) => a + w, 0) < 2, 'feridas tratadas');
    t.ok(medic.tu >= 0);
    // recuo: muro em x = 12 para esconder
    const B2 = fixture({ turn: 3 });
    for (let y = 0; y <= 14; y++) B2.map.parts[I(B2, 12, y) * 4 + 1] = id('FARM.wall');
    const w = soldier(B2, 14, 8, { dir: 2 });
    w.hp = 8;
    soldier(B2, 9, 10, { dir: 2 });
    const a = alien(B2, 'sectoid_soldier', 24, 8, { dir: 6 });
    OV.LOS.refreshAll(B2);
    t.ok(OV.LOS.isVisibleTo(B2, 'alien', w), 'o ferido está à vista');
    run(B2, AI.turn(B2, 'xcom'));
    t.ok(w.status !== 'ok' || !OV.LOS.canSee(B2, a, w), 'o ferido saiu da vista do alienígena');
    // fumo: ferido sem saída à vista de um alienígena; o colega com fumo cobre-o
    const B3 = fixture({ turn: 3, w: 30, h: 12 });
    const v = soldier(B3, 14, 6, { dir: 2, stats: { tu: 50 } });
    v.hp = 10;
    v.tu = 0;
    const helper = soldier(B3, 10, 6, { dir: 6, loadout: { R: 'rifle', L: null, belt: ['rifle_clip'], pack: ['smoke_grenade'] } });
    alien(B3, 'sectoid_soldier', 27, 6, { dir: 6 });
    OV.LOS.refreshAll(B3);
    const r3 = run(B3, AI.turn(B3, 'xcom'));
    const smoke = ofType(r3.ev, 'throw').filter((e) => e.unitId === helper.id);
    t.ok(smoke.length >= 1, 'fumo lançado pelo colega');
    if (smoke.length) t.ok(B3.map.smoke.some((x) => x > 0), 'há fumo no mapa');
  });

  t.test('playerBot: turno 1 com a nave como abrigo (só 4 saem), recuo para a nave e determinismo', () => {
    const r1 = sim.runBattle({ ufo: 'large_scout', seed: 3, month: 1, diff: 1, turns: 2 });
    const r2 = sim.runBattle({ ufo: 'large_scout', seed: 3, month: 1, diff: 1, turns: 2 });
    t.eq(r1.hash, r2.hash, 'mesmo resultado');
    const B = BT.create(sim.missionFor({ ufo: 'medium_scout', month: 0, diff: 1, seed: 7 }));
    const drain = (g) => { let r; while (!(r = g.next()).done); };
    drain(BT.beginBattle(B));
    const craft = new Set(B.craftTiles);
    drain(AI.turn(B, 'xcom'));
    const out = B.units.filter((u) => u.side === 'xcom' && u.status === 'ok' && !craft.has(BU.unitTile(B, u))).length;
    t.ok(out <= AI.profile.exitFirst, 'saíram ' + out + ' (máx. ' + AI.profile.exitFirst + ')');
  });

  // ---- 4. equilíbrio (amostra rápida; o varrimento completo é tools/sim.js) --------------------------------------
  t.test('Equilíbrio: batedores pequenos ganhos quase sempre com poucas baixas (amostra rápida)', () => {
    let wins = 0, dead = 0;
    const seeds = [1, 2, 3, 4];
    for (const seed of seeds) {
      const r = sim.runBattle({ ufo: 'small_scout', seed, month: 0, diff: 1, turns: 30 });
      if (r.outcome === 'win') wins++;
      dead += r.xcomDead;
    }
    t.ok(wins >= 3, 'vitórias ' + wins + '/' + seeds.length);
    t.ok(dead / seeds.length <= 1.5, 'baixas por batalha ' + (dead / seeds.length).toFixed(2));
  });
};
