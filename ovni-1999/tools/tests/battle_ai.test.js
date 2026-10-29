/* Testes da IA da batalha: js/sim/battle/ai.js (DESIGN.md §11; REA 03 §11) + simulador headless tools/sim.js */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const AI = OV.AI;
  const id = (k) => D.tileId(k);
  const sim = require('../sim.js');

  // mapa aberto de chão FARM, de dia; lado ativo e turno à escolha
  function fixture(o) {
    const opt = o || {};
    const m = BM.create(opt.w || 24, opt.h || 16, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = id('FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: opt.turn || 1, side: opt.side || 'alien', phase: 'play', aborted: false,
      pendingExplosions: [], reserve: 'none', reserveKneel: false, craftTiles: [], specials: {}, nodes: opt.nodes || [],
      settings: { instantGrenades: true }, cheat: false,
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: opt.diff === undefined ? 1 : opt.diff, shade: 0, deploymentId: 'dep_terror_site', craftType: 'skyranger' },
      rng: OV.RNG.streams(opt.seed || 7),
    };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y) => BM.idx(B.map, x, y, 0);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'T' + sid++, name: 'Teste', nat: 'pt', rank: 0, armour: 'coveralls', missions: 0,
      stats: { tu: 60, sta: 60, hp: 40, brav: 50, react: 50, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 },
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = opt.dir === undefined ? 2 : opt.dir;
    return u;
  }
  function alien(B, type, x, y, o) {
    const opt = o || {};
    const u = BU.fromAlien(B, type, 0, OV.RNG.create(opt.seed || 5), 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = opt.dir === undefined ? 2 : opt.dir;
    return u;
  }
  function civilian(B, x, y) {
    const u = BU.fromCivilian(B, null, OV.RNG.create(3));
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = 0;
    u.ai.mode = 'civilian';
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
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  t.test('Turno alienígena completa numa fixture pequena (UT ≥ 0, invariantes, ≤ 3 ações por passagem)', () => {
    const B = fixture({ turn: 2 });
    soldier(B, 3, 4, { dir: 2 });
    soldier(B, 3, 10, { dir: 2 });
    const a1 = alien(B, 'sectoid_soldier', 18, 4, { dir: 6 });
    const a2 = alien(B, 'sectoid_navigator', 20, 12, { dir: 6 });
    const a3 = alien(B, 'floater_soldier', 14, 7, { dir: 6 });
    OV.LOS.refreshAll(B);
    const r = run(B, AI.turn(B, 'alien'));
    t.ok(r.ret && r.ret.actions >= 1, 'pelo menos uma ação');
    t.ok(r.ret.actions <= 3 * 2 * 3 + 12, 'limite de ações');
    for (const a of [a1, a2, a3]) t.ok(a.tu >= 0 && a.energy >= 0, 'UT/energia ≥ 0');
    t.ok(AI.MODES.includes(a1.ai.mode), 'modo válido');
    // lado errado ou batalha terminada: nada acontece
    t.eq(run(B, AI.turn(B, 'xcom')).ev.length, 0);
    B.phase = 'over';
    t.eq(run(B, AI.turn(B, 'alien')).ev.length, 0);
  });

  t.test('Alienígena em combate dispara contra o soldado que vê (modo por distância: snap a 6 tiles)', () => {
    const B = fixture({ turn: 1 });
    const s = soldier(B, 10, 8, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 4, 8, { dir: 2 });
    a.ai.mode = 'combat';
    OV.LOS.refreshAll(B);
    t.ok(OV.LOS.isVisibleTo(B, 'alien', s), 'o alienígena vê o soldado');
    const ctx = AI.turnContext(B, 'alien');
    const act = AI.think(B, a, ctx);
    t.eq([act.type, act.mode, act.target.unitId], ['shoot', 'snap', s.id]);
    t.eq(AI.fireModes(2), ['auto', 'snap', 'aimed']);
    t.eq(AI.fireModes(15), ['aimed', 'snap']);
    t.eq(AI.fireModes(25), ['aimed']);
    const r = run(B, AI.turn(B, 'alien'));
    const shots = ofType(r.ev, 'shot').filter((e) => e.shooterId === a.id);
    t.ok(shots.length >= 1, 'disparou');
    t.ok(a.tu < a.tuMax, 'gastou UT');
  });

  t.test('Crisálida aproxima-se (desesperada) e ataca corpo a corpo', () => {
    const B = fixture({ turn: 1 });
    const s = soldier(B, 12, 8, { dir: 2 });
    const c = alien(B, 'chryssalid', 3, 8, { dir: 2 });
    s.turnsSinceSpotted = 0;
    OV.LOS.refreshAll(B);
    const ctx = AI.turnContext(B, 'alien');
    const uc = AI.unitContext(B, c, ctx);
    t.ok(uc.arms.meleeOnly && uc.known.length === 1, 'só corpo a corpo, alvo conhecido');
    t.eq(AI.chooseMode(B, c, uc, ctx), 'combat');
    const r = run(B, AI.turn(B, 'alien'));
    t.ok(ofType(r.ev, 'step').length >= 6, 'aproximou-se');
    const melee = ofType(r.ev, 'melee').filter((e) => e.attackerId === c.id);
    t.ok(melee.length >= 1, 'atacou corpo a corpo');
    t.ok(s.status !== 'ok' || dist(c, s) === 1, 'adjacente ao alvo (ou alvo abatido)');
  });

  t.test('Ferido, desarmado e avistado: foge (modo escape) para fora da vista e termina o turno', () => {
    const B = fixture({ turn: 2 });
    // muro norte-sul em x = 14 (y 0..11) para se poder esconder
    for (let y = 0; y <= 11; y++) B.map.parts[I(B, 14, y) * 4 + 1] = id('FARM.wall');
    soldier(B, 6, 6, { dir: 2 });
    soldier(B, 6, 8, { dir: 2 });
    soldier(B, 6, 10, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 12, 8, { dir: 6 });
    for (const it of BU.allItems(B, a)) BU.deleteItem(B, it.id);
    a.items = { R: null, L: null, belt: [], pack: [] };
    a.hp = 5;
    OV.LOS.refreshAll(B);
    const ctx = AI.turnContext(B, 'alien');
    const uc = AI.unitContext(B, a, ctx);
    t.ok(uc.spotters.length >= 2, 'avistado');
    const w = AI.modeWeights(B, a, uc, ctx, false);
    t.eq([w.combat, w.ambush, w.patrol], [0, 0, 0], 'sem arma nem esconderijo: só fuga');
    t.ok(w.escape > 0);
    const r = run(B, AI.turn(B, 'alien'));
    t.eq(a.ai.mode, 'escape');
    t.ok(ofType(r.ev, 'step').length >= 1, 'andou');
    t.ok(!OV.LOS.isVisibleTo(B, 'xcom', a), 'já não é visto pela X-COM');
  });

  t.test('Eficácia de granadas: inimigos − 2·amigos − 4·próprio + dificuldade/2; regras de turno, voadores e repetição', () => {
    const B = fixture({ turn: 3, diff: 1 });
    const s1 = soldier(B, 12, 8, { dir: 6 });
    const s2 = soldier(B, 13, 9, { dir: 6 });
    const a = alien(B, 'sectoid_soldier', 5, 8, { dir: 2 });
    const g = BU.newItem(B, 'alien_grenade');
    BU.giveItem(B, a, g.id, 'belt', true);
    a.ai.mode = 'combat';
    OV.LOS.refreshAll(B);
    const ctx = AI.turnContext(B, 'alien');
    const e = AI.grenadeEfficacy(B, a, I(B, 12, 8), 5, ctx);
    t.eq([e.enemies, e.friends, e.self, e.eff], [2, 0, 0, 3], 'Veterano: coef 2 ⇒ +1');
    const f = alien(B, 'sectoid_soldier', 10, 8, { dir: 2, seed: 9 });
    t.eq(AI.grenadeEfficacy(B, a, I(B, 12, 8), 5, ctx).eff, 1, 'amigo no raio −2');
    t.eq(AI.grenadeEfficacy(B, a, I(B, 8, 8), 5, ctx).self, 1, 'o próprio no raio');
    for (const it of BU.allItems(B, f)) BU.deleteItem(B, it.id);
    f.items = { R: null, L: null, belt: [], pack: [] };
    BU.removeUnitFromMap(B, f);
    B.units.splice(B.units.indexOf(f), 1);
    // turno 3: mão livre → ativar → lançar; o tile fica marcado
    const act = AI.think(B, a, ctx);
    t.eq([act.type, act.itemId, act.to], ['inv', g.id, 'L']);
    t.eq(ctx.queue[a.id].map((x) => x.type), ['prime', 'throw']);
    t.ok(ctx.grenaded.has(ctx.queue[a.id][1].toI));
    // turno 2: ainda não usa granadas ⇒ dispara
    B.turn = 2;
    const ctx2 = AI.turnContext(B, 'alien');
    t.eq(AI.think(B, a, ctx2).type, 'shoot');
    // tile já atacado neste turno ⇒ nada; alvo a voar ⇒ nada
    B.turn = 3;
    const ctx3 = AI.turnContext(B, 'alien');
    ctx3.grenaded.add(I(B, 12, 8));
    ctx3.grenaded.add(I(B, 13, 9));
    t.eq(AI.think(B, a, ctx3).type, 'shoot');
    const ctx4 = AI.turnContext(B, 'alien');
    s1.float = true;
    s2.float = true;
    t.eq(AI.think(B, a, ctx4).type, 'shoot');
    s1.float = false;
    s2.float = false;
    // executa: granada rebenta (granadas instantâneas)
    const r = run(B, AI.turn(B, 'alien'));
    t.ok(ofType(r.ev, 'explosion').some((x) => x.cause === 'grenade'), 'explosão da granada');
  });

  t.test('Granada: UT = 4 (cinto → mão) + ativar + lançar, sem contar o cinto a dobrar', () => {
    const B = fixture({ turn: 3, diff: 1 });
    soldier(B, 12, 8, { dir: 6 });
    soldier(B, 13, 9, { dir: 6 });
    const a = alien(B, 'sectoid_soldier', 5, 8, { dir: 2 });
    const g = BU.newItem(B, 'alien_grenade');
    BU.giveItem(B, a, g.id, 'belt', true);
    a.ai.mode = 'combat';
    OV.LOS.refreshAll(B);
    const need = 4 + BU.actionTU(B, a, g.id, 'prime') + BU.actionTU(B, a, g.id, 'throw');
    a.tu = need;
    let ctx = AI.turnContext(B, 'alien');
    const act = AI.explosivePlan(B, a, AI.unitContext(B, a, ctx), ctx);
    t.ok(act && act.type === 'inv', 'UT exatas (' + need + ') chegam');
    t.eq(ctx.queue[a.id].map((x) => x.type), ['prime', 'throw']);
    a.tu = need - 1;
    ctx = AI.turnContext(B, 'alien');
    t.eq(AI.explosivePlan(B, a, AI.unitContext(B, a, ctx), ctx), null, 'uma UT a menos não chega');
  });

  t.test('Reserva da patrulha alienígena: 1/2, 2·(1/5) ou 1/3 das UT base pela agressividade (checkReservedTU)', () => {
    const B = fixture({ turn: 2 });
    const a = alien(B, 'sectoid_soldier', 5, 8);
    const ctx = AI.turnContext(B, 'alien');
    const c = AI.unitContext(B, a, ctx);
    const base = a.stats.tu;
    for (const [aggr, want] of [[0, OV.U.idiv(base, 2)], [1, OV.U.idiv(base, 5) * 2], [2, OV.U.idiv(base, 3)]]) {
      c.aggr = aggr;
      t.eq(AI.patrolReserve(B, a, c), want, 'agressividade ' + aggr);
    }
    c.arms = Object.assign({}, c.arms, { gun: null });
    t.eq(AI.patrolReserve(B, a, c), 0, 'sem arma de fogo');
  });

  t.test('Sem arma: apanha a arma carregada a ≤ 3 tiles; arma vazia: apanha munição e recarrega', () => {
    const B = fixture({ turn: 2 });
    soldier(B, 22, 1, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 5, 8, { dir: 2 });
    for (const it of BU.allItems(B, a)) BU.deleteItem(B, it.id);
    a.items = { R: null, L: null, belt: [], pack: [] };
    const gun = BU.newItem(B, 'plasma_pistol', { ammo: 'plasma_pistol_clip', at: I(B, 7, 9) });
    BU.newItem(B, 'plasma_pistol', { ammo: 'plasma_pistol_clip', at: I(B, 12, 8) });
    OV.LOS.refreshAll(B);
    const r = run(B, AI.turn(B, 'alien'));
    t.ok(ofType(r.ev, 'pickup').length === 1, 'apanhou');
    t.eq(gun.owner, a.id, 'a arma mais próxima');
    // arma vazia + carregador no chão do próprio tile ⇒ apanha e recarrega
    const C = fixture({ turn: 2 });
    soldier(C, 22, 1, { dir: 2 });
    const b = alien(C, 'sectoid_soldier', 5, 8, { dir: 2 });
    for (const it of BU.allItems(C, b)) if (BU.slotOf(b, it.id) !== 'R') BU.deleteItem(C, it.id);
    b.items.belt = [];
    b.items.pack = [];
    BU.item(C, b, 'R').ammo = null;
    BU.newItem(C, 'plasma_pistol_clip', { at: I(C, 5, 8) });
    OV.LOS.refreshAll(C);
    const r2 = run(C, AI.turn(C, 'alien'));
    t.eq(ofType(r2.ev, 'pickup').length + ofType(r2.ev, 'reload').length, 2, 'apanhou e recarregou');
    t.ok(BU.item(C, b, 'R').ammo && BU.item(C, b, 'R').ammo.rounds > 0);
  });

  t.test('Civis fogem dos alienígenas que veem (e não disparam)', () => {
    const B = fixture({ turn: 1, side: 'civ' });
    soldier(B, 22, 1, { dir: 2 }); // X-COM viva (senão a batalha já acabou)
    const c = civilian(B, 9, 8);
    const a = alien(B, 'sectoid_soldier', 5, 8, { dir: 2 });
    c.dir = 6;
    OV.LOS.refreshAll(B);
    const d0 = dist(c, a);
    const r = run(B, AI.turn(B, 'civ'));
    t.ok(ofType(r.ev, 'step').length >= 1, 'andou');
    t.ok(dist(c, a) > d0, 'afastou-se');
    t.eq(ofType(r.ev, 'shot').length, 0);
  });

  t.test('Turno de batota: todos os X-COM conhecidos e modo combate (CHEAT_TURN por dificuldade)', () => {
    const B = fixture({ turn: 10, diff: 1 });
    const s = soldier(B, 2, 2, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 20, 13, { dir: 6 });
    alien(B, 'sectoid_soldier', 21, 13, { dir: 6, seed: 6 });
    alien(B, 'sectoid_soldier', 21, 14, { dir: 6, seed: 8 });
    OV.LOS.refreshAll(B);
    t.ok(!AI.cheatNow(B), 'turno 10 com 3 vivos: ainda não');
    B.turn = 11;
    t.ok(AI.cheatNow(B), 'turno 11 > 10 (Veterano)');
    const C = fixture({ turn: 6, diff: 1 });
    alien(C, 'sectoid_soldier', 5, 5);
    t.ok(AI.cheatNow(C), 'turno 6 > 10/2 com ≤ 2 vivos');
    s.turnsSinceSpotted = 50;
    run(B, AI.turn(B, 'alien'));
    t.eq([B.cheat, s.turnsSinceSpotted], [true, 0]);
    t.eq(a.ai.mode, 'combat');
  });

  t.test('playerBot: perfil, batalha completa até ao fim com invariantes; turnos de IA deterministas e após gravar/carregar', () => {
    t.eq([AI.profile.aggression, AI.profile.intelligence, AI.profile.flares, AI.profile.medikit, AI.profile.kneelAimed], [1, 10, true, true, true]);
    const r = sim.runBattle({ ufo: 'small_scout', seed: 4, month: 0, diff: 1, turns: 40 });
    t.ok(['win', 'loss', 'cap'].includes(r.outcome), 'resultado ' + r.outcome);
    t.ok(r.events > 10);
    const o = { ufo: 'medium_scout', seed: 3, month: 0, diff: 1, turns: 4 };
    const h1 = sim.runBattle(o).hash;
    t.eq(sim.runBattle(o).hash, h1, 'mesma semente ⇒ mesmo hash');
    t.eq(sim.runBattle(Object.assign({ saveAt: 3 }, o)).hash, h1, 'gravar/carregar no turno 3 não muda o resultado');
  });

  t.test('Desempenho: ≤ 20 ms por ação alienígena num mapa 50×50×3', () => {
    const B = BT.create(sim.missionFor({ ufo: 'battleship', seed: 2, month: 3, diff: 1 }));
    const drain = (g) => { let x; while (!(x = g.next()).done); };
    drain(BT.beginBattle(B));
    let ms = 0, n = 0;
    for (let k = 0; k < 3 && B.phase !== 'over'; k++) {
      drain(AI.turn(B, 'xcom'));
      if (B.phase === 'over') break;
      // turno alienígena medido isoladamente (UT cheias, como no início do turno deles)
      B.side = 'alien';
      const t0 = process.hrtime.bigint();
      const g = AI.turn(B, 'alien');
      let x;
      while (!(x = g.next()).done);
      ms += Number(process.hrtime.bigint() - t0) / 1e6;
      n += x.value.actions;
      B.side = 'xcom';
      drain(BT.endPlayerTurn(B));
    }
    t.ok(n > 0, 'houve ações');
    const per = ms / n;
    t.ok(per <= 20, 'ms por ação ' + per.toFixed(2));
  });
};
