/* Testes do ambiente: js/sim/battle/env.js (DESIGN.md §3.3, §3.6, §3.11; REA 03 §1.5, §4.4, §8) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const C = OV.Combat;
  const E = OV.Env;
  const id = (k) => D.tileId(k);

  function fixture(w, h, d, floorKey, seed) {
    const m = BM.create(w || 12, h || 12, d || 1);
    const plane = m.w * m.h;
    for (let i = 0; i < plane; i++) m.parts[i * 4] = id(floorKey || 'FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', aborted: false, pendingExplosions: [],
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 0, shade: 0, deploymentId: 'dep_terror_site' }, rng: OV.RNG.streams(seed || 5),
    };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'E' + sid++, name: 'Teste', nat: 'pt', rank: 0, armour: opt.armour || 'coveralls',
      stats: Object.assign({ tu: 60, sta: 60, hp: 40, brav: 50, react: 50, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 }, opt.stats),
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: null, L: null, belt: [], pack: [] });
    BU.placeUnit(B, u, I(B, x, y, opt.z));
    return u;
  }
  function alien(B, type, x, y, z) {
    const u = BU.fromAlien(B, type, 0, B.rng.map, 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y, z));
    return u;
  }
  const lowRng = { int: (a, b) => Math.min(a, b), pct: () => true };
  const highRng = { int: (a, b) => Math.max(a, b), pct: () => false };
  const ofType = (evs, ty) => evs.filter((e) => e.t === ty);

  // ---- portas --------------------------------------------------------------------------------------------
  t.test('Portas: batente troca para aberta e fica; 2×2 não abre; OVNI abre o grupo «O» e fecha no fim do turno', () => {
    const B = fixture();
    const i = I(B, 5, 5);
    B.map.parts[i * 4 + 1] = id('FARM.door');
    B.map.parts[i * 4 + 2] = id('FARM.door.n');
    const s = soldier(B, 4, 5);
    const disc = alien(B, 'cyberdisc', 1, 1);
    t.eq(E.openDoor(B, disc, i, 1), [], 'unidade 2×2 não abre portas de batente');
    const ev = E.openDoor(B, s, i, 1);
    t.eq(ev.map((e) => e.t), ['tile', 'door']);
    t.eq([ev[1].kind, ev[1].part, ev[1].unitId, ev[1].open], ['swing', 1, s.id, true]);
    t.eq(BM.def(B.map, i, 1).key, 'FARM.doorOpen');
    t.ok(!BM.edgeInfo(B.map, 4, 5, 0, 2).blocked.move, 'passagem livre');
    t.eq(E.openDoor(B, s, i, 1), [], 'já aberta');
    E.openDoor(B, s, i, 2);
    t.eq(BM.def(B.map, i, 2).key, 'FARM.doorOpen.n', 'porta norte');
    t.eq(E.openDoor(B, s, I(B, 2, 2), 1), [], 'sem porta');
    // OVNI: três segmentos ligados + um isolado
    const U = fixture(12, 12, 1, 'UFO.inner');
    const row = [I(U, 3, 4), I(U, 4, 4), I(U, 5, 4)];
    for (const j of row) U.map.parts[j * 4 + 3] = id('UFO.ufoDoor');
    const lone = I(U, 9, 9);
    U.map.parts[lone * 4 + 3] = id('UFO.ufoDoor');
    const evU = E.openDoor(U, null, row[1]);
    t.eq([evU[0].kind, evU[0].tiles], ['ufo', row]);
    t.eq(row.map((j) => U.map.ufoDoorOpen[j]), [1, 1, 1]);
    t.eq(U.map.ufoDoorOpen[lone], 0);
    t.ok(BM.canStand(U.map, row[0]), 'aberta deixa passar');
    t.eq(E.openDoor(U, null, row[0], 3), [], 'já aberta');
    // fim do turno: unidade na porta mantém o grupo aberto
    const a = alien(U, 'sectoid_soldier', 4, 4);
    t.eq(E.closeUfoDoors(U), []);
    t.eq(U.map.ufoDoorOpen[row[2]], 1);
    BU.placeUnit(U, a, I(U, 4, 6));
    const evC = E.closeUfoDoors(U);
    t.eq([evC.length, evC[0].open, evC[0].tiles], [1, false, row]);
    t.eq(row.map((j) => U.map.ufoDoorOpen[j]), [0, 0, 0]);
    t.ok(!BM.canStand(U.map, row[1]), 'fechada bloqueia');
  });

  // ---- gravidade ------------------------------------------------------------------------------------------
  t.test('Gravidade: chão destruído ⇒ unidade e itens caem (0 de dano); quem voa paira', () => {
    const B = fixture(10, 10, 3);
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) B.map.parts[I(B, x, y, 1) * 4] = id('FARM.inner.up');
    const i1 = I(B, 4, 4, 1);
    const s = soldier(B, 4, 4, { z: 1 });
    const it = BU.newItem(B, 'grenade', { at: i1 });
    const hp = s.hp;
    t.eq(E.applyGravity(B, i1), [], 'com chão nada cai');
    t.eq(C.damageTerrain(B, i1, 0, 29), [], 'armadura 30');
    const ev = C.damageTerrain(B, i1, 0, 30);
    t.eq(B.map.parts[i1 * 4], 0, 'buraco');
    const falls = ofType(ev, 'fall');
    t.eq(falls.map((e) => [e.unitId, e.itemId, e.fromZ, e.toZ]), [[s.id, null, 1, 0], [null, it.id, 1, 0]]);
    t.eq([s.z, s.hp, BU.findItem(B, it.id).at], [0, hp, I(B, 4, 4, 0)]);
    t.eq(B._.unitAt[i1], 0);
    t.eq(BT.unitAt(B, I(B, 4, 4, 0)), s);
    // flutuante sobre um buraco: paira
    const f = alien(B, 'floater_soldier', 5, 5, 1);
    const i5 = I(B, 5, 5, 1);
    B.map.parts[i5 * 4] = 0;
    E.applyGravity(B, i5);
    t.eq([f.z, f.float], [1, true]);
    // ocupado em baixo: cai para o tile livre mais próximo
    const below = soldier(B, 6, 6);
    const top = soldier(B, 6, 6, { z: 1 });
    B.map.parts[I(B, 6, 6, 1) * 4] = 0;
    E.applyGravity(B, I(B, 6, 6, 0));
    t.eq(top.z, 0);
    t.ok(BU.unitTile(B, top) !== BU.unitTile(B, below), 'não cai em cima de outra unidade');
  });

  // ---- fogo e fumo ------------------------------------------------------------------------------------------
  t.test('Fogo: dura combustível+1, espalha-se (fumo − inflam/10 + 15 %), parede trava, queima o chão', () => {
    const B = fixture(9, 9);
    const c = I(B, 4, 4);
    B.map.fire[c] = 2;
    B.map.smoke[c] = 10;
    // parede a leste do centro (aresta oeste do tile (5,4))
    B.map.parts[I(B, 5, 4) * 4 + 1] = id('FARM.wall');
    const ev = E.roundUpkeep(B, lowRng);
    t.eq(B.map.fire[c], 1, '−1');
    const N = I(B, 4, 3), S = I(B, 4, 5), W = I(B, 3, 4), Ea = I(B, 5, 4);
    t.eq([N, S, W].map((j) => [B.map.fire[j], B.map.smoke[j]]), [[2, 10], [2, 10], [2, 10]], 'relva: combustível 1 + 1; fumo 15 − 5');
    t.eq(B.map.fire[Ea], 0, 'parede trava o fogo');
    t.eq(ofType(ev, 'fire')[0].tiles.slice().sort((a, b) => a - b), [N, W, S].sort((a, b) => a - b));
    // sem sorte (rng alto) nada pega
    const Q = fixture(9, 9);
    Q.map.fire[c] = 3;
    Q.map.smoke[c] = 10;
    E.roundUpkeep(Q, highRng);
    t.eq([Q.map.fire[N], Q.map.fire[c]], [0, 2]);
    // segunda ronda: o centro apaga-se e o chão queima
    const ev2 = E.roundUpkeep(B, highRng);
    t.eq(B.map.fire[c], 0);
    t.eq(BM.def(B.map, c, 0).key, 'FARM.scorched', 'relva queimada');
    t.ok(ofType(ev2, 'tile').some((e) => e.i === c && e.part === 0));
    t.eq(ofType(ev2, 'burnout')[0].tiles, [c]);
    t.eq(B.map.fire[N], 1, 'os novos ardem mais um turno');
    // fardo de palha (objeto inflamável): ao apagar-se vira entulho e o chão queima
    const H = fixture(5, 5);
    const h = I(H, 2, 2);
    H.map.parts[h * 4 + 3] = id('FARM.crate');
    H.map.fire[h] = 1;
    E.roundUpkeep(H, highRng);
    t.eq([BM.def(H.map, h, 3).key, BM.def(H.map, h, 0).key], ['FARM.rubbleObject', 'FARM.scorched']);
    // fogo aceso nesta ronda (freshFire) não desconta
    const F = fixture(5, 5);
    F.map.fire[h] = 2;
    F.freshFire = [h];
    E.roundUpkeep(F, highRng);
    t.eq([F.map.fire[h], F.freshFire], [2, []]);
    // à prova de fogo não pega
    const P = fixture(5, 5, 1, 'URBAN.ground');
    P.map.fire[h] = 3;
    P.map.smoke[h] = 15;
    E.roundUpkeep(P, lowRng);
    t.eq(P.map.fire[I(P, 2, 1)], 0, 'passeio (inflam 255)');
  });

  t.test('Fumo: −1 por ronda, espalha-se pela média (fumo/sobreposições − 1), paredes travam, desaparece', () => {
    const B = fixture(9, 9, 1, 'URBAN.ground');
    const c = I(B, 4, 4);
    B.map.smoke[c] = 10;
    E.roundUpkeep(B, lowRng);
    t.eq(B.map.smoke[c], 9);
    t.eq([I(B, 4, 3), I(B, 5, 4), I(B, 4, 5), I(B, 3, 4)].map((j) => B.map.smoke[j]), [8, 8, 8, 8], '9 recebido − 1');
    t.eq(B.map.smoke[I(B, 5, 5)], 0, 'diagonal não');
    for (let k = 0; k < 40; k++) E.roundUpkeep(B, lowRng);
    let total = 0;
    for (let i = 0; i < B.map.n; i++) total += B.map.smoke[i];
    t.eq(total, 0, 'dissipa-se');
    // fechado entre paredes: só decai
    const W = fixture(9, 9, 1, 'URBAN.ground');
    W.map.parts[c * 4 + 1] = id('URBAN.wall');
    W.map.parts[c * 4 + 2] = id('URBAN.wall.n');
    W.map.parts[I(W, 5, 4) * 4 + 1] = id('URBAN.wall');
    W.map.parts[I(W, 4, 5) * 4 + 2] = id('URBAN.wall.n');
    W.map.smoke[c] = 10;
    E.roundUpkeep(W, lowRng);
    t.eq(W.map.smoke[c], 9);
    let around = 0;
    for (let i = 0; i < W.map.n; i++) if (i !== c) around += W.map.smoke[i];
    t.eq(around, 0);
    // fogo deita metade do fumo para os vizinhos e para cima (sem chão)
    const Fz = fixture(5, 5, 2, 'URBAN.ground');
    const f = I(Fz, 2, 2);
    Fz.map.fire[f] = 3;
    Fz.map.smoke[f] = 10;
    E.roundUpkeep(Fz, highRng);
    t.eq([Fz.map.smoke[I(Fz, 2, 1)], Fz.map.smoke[I(Fz, 2, 2, 1)]], [4, 4], '10/2 recebido − 1');
  });

  // ---- início do turno ----------------------------------------------------------------------------------------
  t.test('Início do turno: UT com excesso de peso e feridas nas pernas; energia; sangria; ajoelhado mantém-se', () => {
    const B = fixture();
    const s = soldier(B, 3, 3, { stats: { str: 20 }, loadout: { R: 'heavy_cannon', L: null, belt: ['hc_ap'], pack: [] } });
    t.eq(BU.weight(B, s), 24, 'canhão 18 + carregador 6');
    s.tu = 0;
    s.energy = 10;
    s.kneel = true;
    E.unitTurnStart(B, s, lowRng);
    t.eq(s.tu, 50, '60 × 20/24');
    t.eq(s.tuMax, 50);
    t.eq(s.energy, 30, '+ UT/3 = 20');
    t.eq(s.kneel, true);
    s.wounds = [0, 1, 0, 0, 1, 1];
    s.energy = 10;
    const ev = E.unitTurnStart(B, s, lowRng);
    t.eq(s.tu, 40, '50 − 2 × 10 %');
    t.eq(s.energy, 29, '+20 − 10 % de 10 (tronco)');
    t.eq(s.hp, 37, '−1 por ferida');
    t.eq(ofType(ev, 'damage')[0].cause, 'wounds');
    s.energy = 55;
    E.unitTurnStart(B, s, lowRng);
    t.eq(s.energy, 60, 'limite = Vigor');
    // alien: energyRecovery
    const a = alien(B, 'sectoid_soldier', 8, 8);
    a.energy = 0;
    E.unitTurnStart(B, a, lowRng);
    t.eq(a.energy, a.stats.energyRecovery);
    // morre a sangrar: cadáver no chão
    const d = soldier(B, 6, 6);
    d.hp = 2;
    d.wounds = [1, 1, 1, 0, 0, 0];
    const ti = BU.unitTile(B, d);
    const evd = E.unitTurnStart(B, d, lowRng);
    t.eq(d.status, 'dead');
    t.eq(ofType(evd, 'death')[0].cause, 'wounds');
    t.ok(B.items.some((x) => x.unitId === d.id && x.at === ti));
  });

  t.test('Início do turno: a arder, fogo e fumo no tile, imunidades', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    s.burn = 3;
    E.unitTurnStart(B, s, lowRng);
    t.eq([s.hp, s.burn], [35, 2], '−RNG(5,10) × IN 100 %');
    // de pé em fogo: dano = fumo do tile (IN), 40 % de pegar fogo, sem dano de queimadura nesse turno
    const f = soldier(B, 5, 5);
    const fi = BU.unitTile(B, f);
    B.map.fire[fi] = 2;
    B.map.smoke[fi] = 10;
    f.burn = 4;
    const r = { int: (a, b) => (a === 0 && b === 99 ? 0 : Math.max(a, b)), pct: () => true };
    const ev = E.unitTurnStart(B, f, r);
    t.eq(f.hp, 30, '10 de fogo; a queimadura não conta neste turno');
    t.eq(f.burn, 5, 'pega fogo RNG(0,5)');
    t.eq(ofType(ev, 'damage')[0].cause, 'fire');
    // fato energético: IN 0
    const p = soldier(B, 7, 7, { armour: 'power_suit' });
    const pi = BU.unitTile(B, p);
    B.map.fire[pi] = 2;
    B.map.smoke[pi] = 12;
    E.unitTurnStart(B, p, lowRng);
    t.eq([p.hp, p.burn], [40, 0]);
    // fumo: +(fumo/4 + 1) de atordoamento; aliens não respiram; fato energético imune
    const m = soldier(B, 9, 2);
    B.map.smoke[BU.unitTile(B, m)] = 8;
    E.unitTurnStart(B, m, lowRng);
    t.eq(m.stun, 3 - 1, '+3 e −1 da recuperação');
    const a = alien(B, 'sectoid_soldier', 9, 5);
    B.map.smoke[BU.unitTile(B, a)] = 15;
    E.unitTurnStart(B, a, lowRng);
    t.eq(a.stun, 0);
    const ps = soldier(B, 9, 8, { armour: 'power_suit' });
    B.map.smoke[BU.unitTile(B, ps)] = 15;
    E.unitTurnStart(B, ps, lowRng);
    t.eq(ps.stun, 0);
  });

  t.test('Inconsciente: atordoamento −1 por turno; acorda com stun < HP num tile livre perto do corpo', () => {
    const B = fixture();
    const s = soldier(B, 4, 4, { loadout: { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] } });
    const ti = BU.unitTile(B, s);
    C.damageUnit(B, s, 0, 'STUN', 0, 1, null, { roll: false });
    s.stun = 41;
    C.knockOut(B, s, null);
    t.eq(s.status, 'out');
    const body = B.items.find((x) => x.unitId === s.id);
    t.eq([body.type, body.at], ['soldier_corpse', ti]);
    t.eq(BU.findItem(B, B.items.find((x) => x.type === 'rifle').id).at, ti, 'arma no chão');
    E.unitTurnStart(B, s, lowRng);
    t.eq([s.status, s.stun], ['out', 40], 'stun 40 ≥ HP 40');
    // alguém ocupa o tile do corpo
    const other = soldier(B, 4, 4);
    const ev = E.unitTurnStart(B, s, lowRng);
    t.eq([s.status, s.stun], ['ok', 39]);
    const w = ofType(ev, 'wake')[0];
    t.ok(w && w.i !== ti, 'acorda ao lado (tile ocupado)');
    t.eq(BT.unitAt(B, w.i), s);
    t.eq(B.items.filter((x) => x.unitId === s.id), [], 'corpo removido');
    t.ok(other.status === 'ok');
    // alien acordado deixa de contar como atordoado
    const a = alien(B, 'sectoid_soldier', 9, 9);
    C.damageUnit(B, a, 200, 'STUN', 0, 1, null, { rng: highRng });
    t.eq([a.status, B.stats.aliensStunned], ['out', 1]);
    a.stun = 0;
    E.unitTurnStart(B, a, lowRng);
    t.eq([a.status, B.stats.aliensStunned], ['ok', 0]);
  });

  // ---- granadas ------------------------------------------------------------------------------------------------
  t.test('Granadas: espoleta 0 no chão rebenta no fim do turno; as outras descontam; proximidade fica de fora', () => {
    const B = fixture(16, 16);
    const s = soldier(B, 2, 2, { stats: { hp: 200 } });
    const hot = BU.newItem(B, 'grenade', { at: I(B, 10, 10) });
    hot.fuse = 0;
    hot.primedBy = s.id;
    const later = BU.newItem(B, 'grenade', { at: I(B, 14, 2) });
    later.fuse = 2;
    const prox = BU.newItem(B, 'proximity_grenade', { at: I(B, 2, 14) });
    prox.fuse = 0;
    const held = BU.newItem(B, 'grenade');
    BU.giveItem(B, s, held.id, 'L');
    held.fuse = 0;
    const held2 = BU.newItem(B, 'grenade');
    BU.giveItem(B, s, held2.id, 'belt');
    held2.fuse = 1;
    const idle = BU.newItem(B, 'grenade', { at: I(B, 5, 5) });
    t.eq(E.itemsOnTile(B, I(B, 10, 10)).map((x) => x.id), [hot.id]);
    const ev = E.armedGrenadesEndTurn(B, B.rng.combat);
    const ex = ofType(ev, 'explosion');
    t.eq(ex.length, 1);
    t.eq([ex[0].i, ex[0].attackerId, ex[0].dmgType, ex[0].radius, ex[0].cause], [I(B, 10, 10), s.id, 'HE', 5, 'grenade']);
    t.eq(BU.findItem(B, hot.id), null, 'a granada desaparece');
    t.eq([later.fuse, prox.fuse, held.fuse, held2.fuse, idle.fuse], [1, 0, 0, 0, -1]);
    t.ok(BU.findItem(B, held.id), 'na mão não rebenta');
    const ev2 = E.armedGrenadesEndTurn(B, B.rng.combat);
    t.eq(ofType(ev2, 'explosion').length, 0, 'later passa a 0 mas só rebenta no próximo fim de turno');
    t.eq(later.fuse, 0);
    t.eq(ofType(E.armedGrenadesEndTurn(B, B.rng.combat), 'explosion').length, 1);
    // granada de fumo
    const sm = BU.newItem(B, 'smoke_grenade', { at: I(B, 8, 3) });
    sm.fuse = 0;
    E.armedGrenadesEndTurn(B, B.rng.combat);
    t.ok(B.map.smoke[I(B, 8, 3)] >= 7, 'fumo');
  });

  t.test('Determinismo do ambiente: fogo numa quinta durante várias rondas dá o mesmo hash', () => {
    const run = () => {
      const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 33, squadSize: 4 }));
      C.resolvePendingExplosions(B);
      C.explode(B, [B.map.w * 8, B.map.h * 8, 2], 90, 'IN', 4, null);
      for (let k = 0; k < 6; k++) {
        E.roundUpkeep(B);
        for (const u of B.units) E.unitTurnStart(B, u);
        E.closeUfoDoors(B);
        E.armedGrenadesEndTurn(B);
      }
      return BT.hash(B);
    };
    t.eq(run(), run());
  });
};
