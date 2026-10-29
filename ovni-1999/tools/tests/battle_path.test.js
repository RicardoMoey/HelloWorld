/* Testes do pathfinding da batalha: js/sim/battle/path.js (DESIGN.md §9, §3.3; REA 03 §2.1) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const P = OV.Path;
  const TU = OV.TUNE;
  const id = (k) => D.tileId(k);
  const tuOf = (k) => D.tileDefByKey[k].tu;

  // mapa w×h×d: chão FARM em z0, telhado em z>0 (roof = false ⇒ níveis superiores vazios)
  function fixture(w, h, d, roof) {
    const m = BM.create(w || 5, h || 5, d || 2);
    for (let i = 0; i < m.n; i++) {
      if (i < m.plane) m.parts[i * 4] = id('FARM.ground');
      else if (roof !== false) m.parts[i * 4] = id('FARM.roof.up');
    }
    const B = { map: m, units: [], items: [], nextId: 1, mission: { difficulty: 0 } };
    BT.rebuildDerived(B);
    return B;
  }
  const set = (B, x, y, z, part, key) => { B.map.parts[BM.idx(B.map, x, y, z) * 4 + part] = key ? id(key) : 0; };
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  let uid = 1000;
  // unidade mínima; place ⇒ entra em B.units e no unitAt
  function mk(B, x, y, z, o, place) {
    const u = Object.assign({ id: uid++, side: 'xcom', size: 1, canFly: false, x, y, z: z || 0, onMap: true, status: 'ok', tu: 80, energy: 80, kneel: false }, o || {});
    if (place) {
      B.units.push(u);
      BU.placeUnit(B, u, I(B, x, y, z || 0));
    }
    return u;
  }
  const step = (B, u, dir, opts, from) => P.stepCost(B, u, from === undefined ? I(B, u.x, u.y, u.z) : from, dir, opts);

  // ---- custos base -------------------------------------------------------------------------------------
  t.test('Path: chão 4 UT/2 energia, diagonal 6/3, searas 6, arbusto, entulho, correr', () => {
    const B = fixture();
    const u = mk(B, 2, 2);
    let s = step(B, u, 0);
    t.eq([s.tu, s.energy, s.to, s.via, s.kind, s.fall, s.float, s.door, s.opensUfoDoor, s.occupant], [4, 2, I(B, 2, 1), I(B, 2, 1), 'walk', false, false, null, null, null]);
    s = step(B, u, 1);
    t.eq([s.tu, s.energy, s.to], [6, 3, I(B, 3, 1)]);
    set(B, 3, 2, 0, 3, 'FARM.crop');
    t.eq(tuOf('FARM.ground') + tuOf('FARM.crop'), 6);
    t.eq([step(B, u, 2).tu, step(B, u, 2).energy], [6, 3], 'searas ortogonal');
    set(B, 3, 3, 0, 3, 'FARM.crop');
    t.eq([step(B, u, 3).tu, step(B, u, 3).energy], [9, 4], 'searas na diagonal: floor(6×3/2)');
    set(B, 1, 2, 0, 3, 'FARM.bush');
    t.eq(step(B, u, 6).tu, tuOf('FARM.ground') + tuOf('FARM.bush'));
    // entulho de parede: ortogonal soma, diagonal soma a média das paredes atravessadas
    const B2 = fixture();
    const v = mk(B2, 2, 2);
    set(B2, 3, 2, 0, 1, 'FARM.rubbleWall'); // E.west
    t.eq(step(B2, v, 2).tu, 4 + tuOf('FARM.rubbleWall'));
    t.eq(step(B2, v, 1).tu, 6 + tuOf('FARM.rubbleWall'), 'NE atravessa uma parede de entulho');
    set(B2, 2, 2, 0, 2, 'FARM.rubbleWall.n'); // start.north
    t.eq(step(B2, v, 1).tu, 6 + OV.U.idiv(2 * tuOf('FARM.rubbleWall'), 2), 'NE com duas: média');
    // correr: UT ×3/4, energia ×3/2
    const B3 = fixture();
    const r = mk(B3, 2, 2);
    t.eq([step(B3, r, 0, { run: true }).tu, step(B3, r, 0, { run: true }).energy], [3, 3]);
    t.eq([step(B3, r, 1, { run: true }).tu, step(B3, r, 1, { run: true }).energy], [4, 4]);
    // limites do mapa e direções inválidas
    const c = mk(B3, 0, 0);
    t.eq(step(B3, c, 0), null);
    t.eq(step(B3, c, 6), null);
    t.eq(step(B3, c, 7), null);
    t.eq(step(B3, c, 9), null);
    t.eq(P.stepCost(B3, c, -1, 0), null);
    t.eq(P.stepCost(B3, c, 0, 10), null);
  });

  t.test('Path: paredes por direção (tabela do DESIGN §9), diagonais sem cortar esquinas', () => {
    // paredes de cada direção a partir de (2,2): [dx, dy, parte]
    const TABLE = {
      0: [[0, 0, 2]],
      1: [[0, 0, 2], [1, -1, 1], [1, 0, 1], [1, 0, 2]],
      2: [[1, 0, 1]],
      3: [[1, 0, 1], [0, 1, 2], [1, 1, 2], [1, 1, 1]],
      4: [[0, 1, 2]],
      5: [[0, 0, 1], [0, 1, 1], [0, 1, 2], [-1, 1, 2]],
      6: [[0, 0, 1]],
      7: [[0, 0, 1], [0, 0, 2], [-1, 0, 2], [0, -1, 1]],
    };
    const walls = new Map();
    for (const dir in TABLE) for (const w of TABLE[dir]) walls.set(w.join(), w);
    for (const w of walls.values()) {
      const B = fixture();
      const u = mk(B, 2, 2);
      set(B, 2 + w[0], 2 + w[1], 0, w[2], w[2] === 1 ? 'FARM.wall' : 'FARM.wall.n');
      const expect = [], got = [];
      for (let dir = 0; dir < 8; dir++) {
        if (TABLE[dir].some((x) => x.join() === w.join())) expect.push(dir);
        if (step(B, u, dir) === null) got.push(dir);
        t.eq(step(B, u, dir) === null, BM.edgeInfo(B.map, 2, 2, 0, dir).blocked.move, 'igual a edgeInfo ' + w + ' dir ' + dir);
      }
      t.eq(got, expect, 'parede ' + w);
    }
    // objeto de bloco inteiro num canto bloqueia as diagonais que passam por ele; caixote não
    const B = fixture();
    const u = mk(B, 2, 2);
    set(B, 3, 2, 0, 3, 'FARM.tree');
    t.eq([0, 1, 2, 3, 4].map((d) => step(B, u, d) === null), [false, true, true, true, false]);
    set(B, 3, 2, 0, 3, 'FARM.crate');
    t.eq([0, 1, 2, 3, 4].map((d) => step(B, u, d) === null), [false, false, true, false, false], 'caixote só bloqueia o próprio tile');
    // janela e vedação bloqueiam o movimento
    set(B, 3, 2, 0, 3, null);
    set(B, 2, 2, 0, 2, 'FARM.window.n');
    t.eq(step(B, u, 0), null);
    set(B, 2, 2, 0, 1, 'FARM.fence');
    t.eq(step(B, u, 6), null);
  });

  t.test('Path: portas de batente (+TU_DOOR, só ortogonal) e portas de OVNI (abre-se ao entrar)', () => {
    const B = fixture();
    const u = mk(B, 2, 2);
    set(B, 2, 2, 0, 1, 'FARM.door');
    let s = step(B, u, 6);
    t.eq([s.tu, s.energy], [4 + tuOf('FARM.doorOpen') + TU.TU_DOOR, 2]);
    t.eq(s.door, { i: I(B, 2, 2), part: 1 });
    const w = mk(B, 1, 2);
    t.eq(step(B, w, 2).door, { i: I(B, 2, 2), part: 1 }, 'mesma porta pelo outro lado');
    t.eq(step(B, u, 5), null, 'diagonal não abre portas');
    t.eq(step(B, u, 7), null);
    set(B, 2, 2, 0, 1, 'FARM.doorOpen');
    s = step(B, u, 6);
    t.eq([s.tu, s.door], [4, null], 'porta aberta');
    t.ok(step(B, u, 5) !== null, 'porta aberta deixa passar na diagonal');
    // porta de OVNI fechada no destino
    const C = fixture();
    const v = mk(C, 2, 2);
    set(C, 2, 1, 0, 3, 'UFO.ufoDoor');
    s = step(C, v, 0);
    t.eq([s.tu, s.energy, s.opensUfoDoor, s.to], [4 + TU.TU_DOOR, 2, I(C, 2, 1), I(C, 2, 1)]);
    t.eq(step(C, mk(C, 1, 2), 1), null, 'porta de OVNI não se abre na diagonal');
    C.map.ufoDoorOpen[I(C, 2, 1)] = 1;
    s = step(C, v, 0);
    t.eq([s.tu, s.opensUfoDoor], [4, null], 'aberta');
    t.ok(step(C, mk(C, 1, 2), 1) !== null);
  });

  // ---- ligações verticais, quedas, voo ------------------------------------------------------------------
  t.test('Path: escadas 6 UT/3 energia, elevador gravítico 8/0, sem ligação não há subida', () => {
    const B = fixture(5, 5, 3);
    set(B, 3, 3, 0, 3, 'FARM.stairsFoot');
    set(B, 3, 3, 1, 3, 'FARM.stairsHead');
    set(B, 1, 1, 0, 3, 'UFO.gravlift');
    set(B, 1, 1, 1, 3, 'UFO.gravlift');
    set(B, 1, 1, 2, 3, 'UFO.gravlift');
    const u = mk(B, 3, 3, 0);
    let s = step(B, u, 8);
    t.eq([s.tu, s.energy, s.to, s.kind], [TU.TU_STAIRS, TU.EN_STAIRS, I(B, 3, 3, 1), 'stairs']);
    t.eq([TU.TU_STAIRS, TU.EN_STAIRS], [6, 3]);
    s = step(B, mk(B, 3, 3, 1), 9);
    t.eq([s.tu, s.energy, s.to], [6, 3, I(B, 3, 3, 0)]);
    t.eq(step(B, u, 9), null);
    t.eq(step(B, mk(B, 3, 3, 1), 8), null, 'cabeça das escadas não sobe');
    s = step(B, mk(B, 1, 1, 0), 8);
    t.eq([s.tu, s.energy, s.to, s.kind], [8, 0, I(B, 1, 1, 1), 'gravlift']);
    s = step(B, mk(B, 1, 1, 2), 9);
    t.eq([s.tu, s.to], [8, I(B, 1, 1, 1)]);
    t.eq(step(B, mk(B, 0, 0, 0), 8), null, 'sem ligação');
    // destino ocupado por um amigo
    mk(B, 1, 1, 1, {}, true);
    t.eq(step(B, mk(B, 1, 1, 0), 8), null);
  });

  t.test('Path: escadas/elevador para um tile sem chão (destruído) não ligam', () => {
    const B = fixture(5, 5, 2);
    set(B, 3, 3, 0, 3, 'FARM.stairsFoot');
    set(B, 3, 3, 1, 3, 'FARM.stairsHead');
    set(B, 1, 1, 0, 3, 'UFO.gravlift');
    set(B, 1, 1, 1, 3, 'UFO.gravlift');
    const u = mk(B, 3, 3, 0);
    t.eq(step(B, u, 8).kind, 'stairs');
    BM.setPart(B, I(B, 3, 3, 1), 0, 0);
    t.eq(step(B, u, 8), null, 'cabeça das escadas sem chão');
    const g = mk(B, 1, 1, 0);
    t.eq(step(B, g, 8).kind, 'gravlift');
    BM.setPart(B, I(B, 1, 1, 1), 0, 0);
    t.eq(step(B, g, 8), null, 'elevador para um tile sem chão');
    const r = P.reachable(B, u);
    t.ok(!(r.cost[I(B, 3, 3, 1)] >= 0), 'reachable também não chega lá');
    // voador continua a poder subir pelo ar
    t.ok(step(B, mk(B, 3, 3, 0, { canFly: true }), 8) !== null, 'voo');
  });

  t.test('Path: quedas de beirais (0 UT extra), voadores ficam a voar', () => {
    const B = fixture(5, 5, 3);
    set(B, 2, 1, 1, 0, null);
    const u = mk(B, 2, 2, 1);
    let s = step(B, u, 0);
    t.eq([s.fall, s.kind, s.via, s.to, s.tu, s.energy, s.float], [true, 'fall', I(B, 2, 1, 1), I(B, 2, 1, 0), 4, 2, false]);
    s = step(B, u, 1 + 6, undefined, I(B, 3, 2, 1)); // NW de (3,2,1) para (2,1,1)
    t.eq([s.fall, s.to, s.tu], [true, I(B, 2, 1, 0), 6]);
    // dois níveis
    set(B, 2, 1, 2, 0, null);
    s = step(B, mk(B, 2, 2, 2), 0);
    t.eq([s.fall, s.to], [true, I(B, 2, 1, 0)]);
    // aterragem impossível: árvore; ou amigo no tile de aterragem
    set(B, 2, 1, 0, 3, 'FARM.tree');
    t.eq(step(B, u, 0), null);
    set(B, 2, 1, 0, 3, null);
    mk(B, 2, 1, 0, {}, true);
    t.eq(step(B, u, 0), null);
    // voador: não cai
    const f = mk(B, 2, 2, 1, { canFly: true });
    s = step(B, f, 0);
    t.eq([s.fall, s.float, s.to, s.tu, s.kind], [false, true, I(B, 2, 1, 1), 4, 'walk']);
  });

  t.test('Path: voo vertical 8 UT sem chão por cima/por baixo; teto da base bloqueia', () => {
    const B = fixture(5, 5, 3);
    const f = mk(B, 2, 2, 0, { canFly: true });
    t.eq(step(B, f, 8), null, 'telhado por cima');
    set(B, 2, 2, 1, 0, null);
    let s = step(B, f, 8);
    t.eq([s.tu, s.energy, s.kind, s.float, s.to], [TU.TU_GRAVLIFT, 0, 'fly', true, I(B, 2, 2, 1)]);
    t.eq(step(B, f, 8, undefined, I(B, 2, 2, 1)), null, 'chão em z2');
    s = step(B, f, 9, undefined, I(B, 2, 2, 1));
    t.eq([s.tu, s.float, s.to], [8, false, I(B, 2, 2, 0)]);
    t.eq(step(B, f, 9, undefined, I(B, 3, 3, 1)), null, 'não desce através do próprio chão');
    t.eq(step(B, mk(B, 2, 2, 0), 8), null, 'quem não voa não sobe');
    // árvore no tile de cima
    set(B, 2, 2, 1, 3, 'FARM.tree');
    t.eq(step(B, f, 8), null);
    set(B, 2, 2, 1, 3, null);
    B.map.ceiling = true;
    t.eq(step(B, f, 8), null, 'base alienígena: teto');
    B.map.ceiling = false;
    // 2×2 voador (Ciberdisco): os quatro tiles livres por cima
    const C = fixture(6, 6, 2);
    const disc = mk(C, 1, 1, 0, { canFly: true, size: 2 });
    t.eq(step(C, disc, 8), null);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) set(C, x, y, 1, 0, null);
    t.eq(step(C, disc, 8), null, 'um dos quatro com telhado');
    set(C, 2, 2, 1, 0, null);
    s = step(C, disc, 8);
    t.eq([s.tu, s.to, s.float], [8, I(C, 1, 1, 1), true]);
  });

  // ---- unidades 2×2 --------------------------------------------------------------------------------------
  t.test('Path: 2×2 — quatro tiles, paredes internas, média dos custos, sem escadas nem portas de batente', () => {
    const B = fixture(7, 7, 2);
    const u = mk(B, 1, 1, 0, { size: 2 }, true);
    let s = step(B, u, 2);
    t.eq([s.tu, s.energy, s.to], [4, 2, I(B, 2, 1)]);
    t.eq(step(B, u, 3).tu, 6);
    set(B, 3, 1, 0, 3, 'FARM.crop');
    t.eq(step(B, u, 2).tu, OV.U.idiv(4 + 6 + 4 + 4, 4), 'média das partes');
    set(B, 3, 2, 0, 3, 'FARM.crop');
    t.eq(step(B, u, 2).tu, OV.U.idiv(4 + 6 + 4 + 6, 4));
    // parede interna da pegada de destino que nenhuma parte atravessa
    set(B, 3, 2, 0, 2, 'FARM.wall.n');
    t.eq(step(B, u, 2), null, 'parede entre (3,1) e (3,2)');
    set(B, 3, 2, 0, 2, null);
    set(B, 3, 2, 0, 3, 'FARM.tree');
    t.eq(step(B, u, 2), null, 'árvore numa das partes');
    set(B, 3, 2, 0, 3, null);
    // porta de batente: 2×2 não abre
    set(B, 3, 1, 0, 1, 'FARM.door');
    t.eq(step(B, u, 2), null);
    t.ok(step(B, mk(B, 2, 1), 2) !== null, '1×1 abre');
    set(B, 3, 1, 0, 1, 'FARM.doorOpen');
    t.ok(step(B, u, 2) !== null, 'porta já aberta é só uma passagem');
    // escadas: só 1×1; elevador 2×2 completo serve
    const C = fixture(6, 6, 2);
    const big = mk(C, 1, 1, 0, { size: 2 });
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
      set(C, x, y, 0, 3, 'FARM.stairsFoot');
      set(C, x, y, 1, 3, 'FARM.stairsHead');
    }
    t.eq(step(C, big, 8), null, 'escadas');
    t.ok(step(C, mk(C, 1, 1, 0), 8) !== null);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
      set(C, x, y, 0, 3, 'UFO.gravlift');
      set(C, x, y, 1, 3, 'UFO.gravlift');
    }
    t.eq(step(C, big, 8).kind, 'gravlift');
    // unidades: as próprias não bloqueiam, um amigo numa das partes sim
    mk(B, 3, 2, 0, {}, true);
    t.eq(step(B, u, 2), null);
    t.ok(step(B, u, 4) !== null, 'sobrepõe-se a si própria');
    // porta de OVNI com dois segmentos: abre-se de frente
    const E = fixture(6, 6, 1);
    set(E, 2, 1, 0, 3, 'UFO.ufoDoor');
    set(E, 3, 1, 0, 3, 'UFO.ufoDoor');
    set(E, 1, 1, 0, 3, 'UFO.hull');
    set(E, 4, 1, 0, 3, 'UFO.hull');
    s = step(E, mk(E, 2, 2, 0, { size: 2 }), 0);
    t.eq([s.tu, s.opensUfoDoor, s.to], [4 + TU.TU_DOOR, I(E, 2, 1), I(E, 2, 1)]);
    t.eq(step(E, mk(E, 1, 2, 0, { size: 2 }), 0), null, 'casco numa das partes');
    // 2×2 sem queda parcial: com um tile com chão fica apoiada; sem nenhum cai
    const F = fixture(6, 6, 2);
    const w = mk(F, 1, 1, 1, { size: 2 });
    set(F, 3, 1, 1, 0, null);
    s = step(F, w, 2);
    t.eq([s.fall, s.to], [false, I(F, 2, 1, 1)], 'meio apoiada');
    set(F, 3, 2, 1, 0, null);
    set(F, 4, 1, 1, 0, null);
    set(F, 4, 2, 1, 0, null);
    s = step(F, mk(F, 2, 1, 1, { size: 2 }), 2);
    t.eq([s.fall, s.to], [true, I(F, 3, 1, 0)], 'sem chão nenhum cai');
  });

  // ---- unidades no caminho -------------------------------------------------------------------------------
  t.test('Path: amigos bloqueiam, inimigos vistos bloqueiam, não vistos não (occupant)', () => {
    const B = fixture(6, 6, 1);
    const u = mk(B, 1, 1, 0, {}, true);
    mk(B, 2, 1, 0, {}, true);
    const al = mk(B, 1, 2, 0, { side: 'alien' }, true);
    t.eq(step(B, u, 2), null, 'amigo');
    let s = step(B, u, 4);
    t.ok(s !== null && s.occupant === al.id, 'inimigo não visto não bloqueia o planeamento');
    t.eq(step(B, u, 4, { seen: [al.id] }), null, 'visto (lista)');
    t.eq(step(B, u, 4, { seen: new Set([al.id]) }), null, 'visto (Set)');
    t.eq(step(B, u, 4, { seen: (x) => x.id === al.id }), null, 'visto (predicado)');
    t.eq(step(B, u, 4, { units: 'all' }), null);
    s = step(B, u, 2, { units: 'none' });
    t.ok(s !== null && s.occupant !== null);
    // para o lado alienígena o soldado X-COM é o inimigo
    t.ok(step(B, al, 0) !== null && step(B, al, 0).occupant === u.id);
    t.eq(step(B, al, 0, { seen: [u.id] }), null);
    // inconscientes e mortos não ocupam
    al.status = 'out';
    BU.removeUnitFromMap(B, al);
    s = step(B, u, 4, { units: 'all' });
    t.ok(s !== null && s.occupant === null);
    // reachable: o tile do inimigo não visto conta como alcançável, o do amigo não
    const C = fixture(6, 6, 1);
    const v = mk(C, 0, 0, 0, {}, true);
    mk(C, 1, 0, 0, {}, true);
    const hid = mk(C, 0, 1, 0, { side: 'alien' }, true);
    const r = P.reachable(C, v, 40, 40);
    t.eq(r.cost[I(C, 1, 0)], -1);
    t.eq(r.cost[I(C, 0, 1)], 4);
    t.eq(P.reachable(C, v, 40, 40, { seen: [hid.id] }).cost[I(C, 0, 1)], -1);
  });

  // ---- reachable / pathTo / find ----------------------------------------------------------------------------
  t.test('Path.reachable: orçamento de UT e de energia; pathTo reconstrói passos; budget', () => {
    const B = fixture(9, 9, 1);
    const u = mk(B, 4, 4, 0, {}, true);
    let r = P.reachable(B, u, 8, 80);
    t.eq(r.origin, I(B, 4, 4));
    t.eq(r.cost[r.origin], 0);
    t.eq(r.list[0], r.origin);
    // 1 passo: 8 vizinhos; 2 passos ortogonais (8 UT): 4 tiles; ortogonal + diagonal = 10 > 8
    t.eq(r.list.length, 1 + 8 + 4);
    t.eq(r.cost[I(B, 4, 2)], 8);
    t.eq(r.cost[I(B, 5, 3)], 6);
    t.eq(r.cost[I(B, 5, 2)], -1);
    // energia 2: só um passo ortogonal
    r = P.reachable(B, u, 80, 2);
    t.eq(r.list.length, 1 + 4);
    t.eq(r.cost[I(B, 5, 3)], -1, 'diagonal custa 3 de energia');
    r = P.reachable(B, u, 80, 5);
    t.eq(r.energy[I(B, 6, 4)], 4);
    t.eq(r.cost[I(B, 6, 2)], -1, '2 diagonais = 6 de energia');
    // pathTo e reconstituição passo a passo com stepCost
    r = P.reachable(B, u, 80, 80);
    const tgt = I(B, 8, 1);
    const p = P.pathTo(r, tgt);
    t.eq(p.tu, r.cost[tgt]);
    t.eq(p.tu, 4 * 4 + 2 * 3);
    t.eq(p.steps.length, 4);
    t.eq(p.tiles[p.tiles.length - 1], tgt);
    let at = r.origin, tu = 0, en = 0;
    p.steps.forEach((d, k) => {
      const s = P.stepCost(B, u, at, d);
      tu += s.tu;
      en += s.energy;
      at = s.to;
      t.eq(at, p.tiles[k]);
      t.eq(tu, p.tus[k]);
    });
    t.eq([tu, en], [p.tu, p.energy]);
    t.eq(P.pathTo(r, r.origin), { steps: [], tiles: [], tus: [], tu: 0, energy: 0 });
    t.eq(P.pathTo(P.reachable(B, u, 4, 80), tgt), null);
    t.eq(P.pathTo(r, -1), null);
    // orçamentos por omissão: UT − levantar-se (de joelhos), energia atual
    u.tu = 20;
    u.energy = 9;
    t.eq(P.budget(u), { tu: 20, energy: 9 });
    u.kneel = true;
    t.eq(P.budget(u), { tu: 20 - TU.TU_STAND, energy: 9 });
    r = P.reachable(B, u);
    t.eq([r.tuBudget, r.energyBudget], [12, 9]);
    u.kneel = false;
    // fora do mapa
    const off = mk(B, -1, -1, -1, { onMap: false });
    t.eq(P.reachable(B, off, 50, 50).list.length, 0);
    t.eq(P.find(B, off, 0, 50), null);
  });

  t.test('Path.find: linha reta em campo aberto, contorna paredes, null sem caminho ou sem UT', () => {
    const B = fixture(12, 12, 1);
    const u = mk(B, 0, 0, 0, {}, true);
    let f = P.find(B, u, I(B, 10, 4));
    t.eq([f.tu, f.steps.length], [4 * 10 + 2 * 4, 10]);
    t.eq(f.tiles[f.tiles.length - 1], I(B, 10, 4));
    // linha de Bresenham: cada tile perto da reta ideal
    f.tiles.forEach((i) => {
      const [x, y] = BM.xyz(B.map, i);
      t.ok(Math.abs(y - (x * 4) / 10) <= 1, 'perto da reta');
    });
    // muro com uma abertura em y=10
    for (let y = 0; y < 10; y++) set(B, 6, y, 0, 1, 'FARM.wall');
    f = P.find(B, u, I(B, 9, 0));
    const r = P.reachable(B, u, 200, 200);
    t.eq(f.tu, r.cost[I(B, 9, 0)]);
    t.ok(f.tiles.some((i) => BM.xyz(B.map, i)[1] >= 10), 'passa pela abertura');
    t.eq(P.find(B, u, I(B, 9, 0), f.tu - 1), null, 'UT insuficientes');
    t.ok(P.find(B, u, I(B, 9, 0), f.tu) !== null);
    t.eq(P.find(B, u, I(B, 9, 0), null, { energy: 5 }), null, 'energia insuficiente');
    // alvo fechado
    for (const [x, y, p] of [[9, 6, 1], [10, 6, 1], [9, 6, 2], [9, 7, 2]]) set(B, x, y, 0, p, p === 1 ? 'FARM.wall' : 'FARM.wall.n');
    t.eq(P.find(B, u, I(B, 9, 6)), null);
    t.eq(r.cost[I(B, 9, 6)] >= 0, true, 'antes de fechar era alcançável');
    t.eq(P.reachable(B, u, 200, 200).cost[I(B, 9, 6)], -1);
    t.eq(P.find(B, u, I(B, 0, 0)), { steps: [], tiles: [], tus: [], tu: 0, energy: 0 });
    // através de uma porta (abre-se e custa)
    const C = fixture(5, 3, 1);
    const v = mk(C, 0, 1, 0, {}, true);
    for (let y = 0; y < 3; y++) set(C, 2, y, 0, 1, y === 1 ? 'FARM.door' : 'FARM.wall');
    f = P.find(C, v, I(C, 4, 1));
    t.eq(f.tu, 4 * 4 + TU.TU_DOOR);
    t.eq(f.steps, [2, 2, 2, 2]);
  });

  t.test('Path: IA evita fogo (+32 só na pesquisa, não cobrado)', () => {
    const B = fixture(7, 3, 1);
    const u = mk(B, 0, 1, 0, { side: 'alien' }, true);
    B.map.fire[I(B, 3, 1)] = 3;
    const plain = P.find(B, u, I(B, 6, 1));
    t.eq(plain.tu, 24);
    t.ok(plain.tiles.indexOf(I(B, 3, 1)) >= 0, 'sem a opção ai atravessa o fogo');
    const ai = P.find(B, u, I(B, 6, 1), null, { ai: true });
    t.eq(ai.tu, 4 + 4 + 6 + 6 + 4 + 4, 'contorna (custo real, sem penalização)');
    t.ok(ai.tiles.indexOf(I(B, 3, 1)) < 0);
    const s = P.stepCost(B, u, I(B, 2, 1), 2, { ai: true });
    t.eq([s.tu, s.penalty], [4, TU.AI_BURNING_PATH_COST]);
    const r = P.reachable(B, u, 100, 100, { ai: true });
    t.eq(r.cost[I(B, 6, 1)], ai.tu);
    t.eq(r.cost[I(B, 3, 1)], 12, 'o tile a arder continua alcançável e com o custo real');
  });

  t.test('Path: reachable e find coerentes em mapas gerados (soldado, voador, 2×2); repetível', () => {
    const cases = [
      { ufoType: 'battleship', terrain: 'URBAN', seed: 3 },
      { ufoType: 'supply_ship', terrain: 'FARM', seed: 5, landed: true },
      { ufoType: 'terror_ship', terrain: 'FOREST', seed: 2, race: 'sectoid' },
      { terrain: 'ALIENBASE', seed: 4 },
    ];
    for (const opts of cases) {
      const B = BT.create(BT.quickMission(opts));
      const units = [B.units.find((x) => x.side === 'xcom')];
      const flyer = B.units.find((x) => x.side === 'alien' && x.canFly && x.size === 1);
      const big = B.units.find((x) => x.side === 'alien' && x.size === 2);
      if (flyer) units.push(flyer);
      if (big) units.push(big);
      for (const u of units) {
        const tag = opts.terrain + ' ' + u.type;
        const r = P.reachable(B, u, 255, 255, { units: 'none' });
        t.ok(r.list.length > 20, tag + ': alcance ' + r.list.length);
        const again = P.reachable(B, u, 255, 255, { units: 'none' });
        t.eq(again.cost, r.cost, tag + ': repetível');
        t.eq(again.parent, r.parent);
        let n = 0;
        for (let k = 1; k < r.list.length; k += Math.max(1, (r.list.length / 25) | 0)) {
          const i = r.list[k];
          const f = P.find(B, u, i, 255, { units: 'none' });
          t.ok(f && f.tu === r.cost[i], tag + ': find ' + (f && f.tu) + ' ≠ reachable ' + r.cost[i] + ' em ' + BM.xyz(B.map, i));
          // reconstituição com stepCost
          const p = P.pathTo(r, i);
          let at = r.origin, tu = 0;
          for (const d of p.steps) {
            const s = P.stepCost(B, u, at, d, { units: 'none' });
            tu += s.tu;
            at = s.to;
          }
          t.eq([at, tu], [i, r.cost[i]], tag + ': passos de pathTo');
          n++;
        }
        t.ok(n >= 10);
        // tiles onde se pode estar mas fora do alcance: find também falha
        let checked = 0;
        for (let i = 0; i < B.map.n && checked < 15; i += 37) {
          if (r.cost[i] >= 0 || !BU.fits(B, u, i, true)) continue;
          t.eq(P.find(B, u, i, 255, { units: 'none' }), null, tag + ': inalcançável ' + BM.xyz(B.map, i));
          checked++;
        }
      }
      // a base alienígena tem teto: nenhum voador chega a z1
      if (opts.terrain === 'ALIENBASE' && flyer) {
        const r = P.reachable(B, flyer, 255, 255, { units: 'none' });
        t.ok(Array.from(r.list).every((i) => BM.xyz(B.map, i)[2] === 0), 'teto da base');
      }
    }
  });

  t.test('Path: custos iguais aos de OV.BMap (edgeInfo/tileTU) em todos os tiles de um mapa gerado', () => {
    for (const opts of [{ ufoType: 'abductor', terrain: 'URBAN', seed: 9, landed: true }, { ufoType: 'large_scout', terrain: 'JUNGLE', seed: 1 }]) {
      const B = BT.create(BT.quickMission(opts));
      const m = B.map;
      const probe = mk(B, 0, 0, 0);
      let compared = 0;
      for (let i = 0; i < m.n; i++) {
        if (!BM.canStand(m, i)) continue;
        const [x, y, z] = BM.xyz(m, i);
        for (let dir = 0; dir < 8; dir++) {
          const e = BM.edgeInfo(m, x, y, z, dir);
          const s = P.stepCost(B, probe, i, dir, { units: 'none' });
          const tag = 'tile ' + [x, y, z] + ' dir ' + dir;
          if (e.to < 0) { t.eq(s, null, tag); continue; }
          const diag = (dir & 1) === 1;
          const doorPass = e.blocked.move && e.door && !diag;
          if (e.blocked.move && !doorPass) { t.eq(s, null, tag + ': aresta bloqueada'); continue; }
          if (!BM.hasFloor(m, e.to)) {
            t.ok(s === null || s.fall, tag + ': queda');
            continue;
          }
          let base;
          if (e.ufoDoor !== null) {
            if (diag) { t.eq(s, null, tag + ': porta de OVNI na diagonal'); continue; }
            const open = D.tileDefs[BM.def(m, e.to, 3).alt];
            base = BM.def(m, e.to, 0).tu + (open ? open.tu : 0);
          } else base = BM.tileTU(m, e.to);
          if (base >= BM.BLOCKED) { t.eq(s, null, tag + ': destino bloqueado'); continue; }
          let tu = diag ? OV.U.idiv(base * 3, 2) : base;
          if (doorPass) tu += D.tileDefs[BM.def(m, e.door.i, e.door.part).alt].tu + TU.TU_DOOR;
          else tu += e.wallTU;
          if (e.ufoDoor !== null) tu += TU.TU_DOOR;
          t.ok(s !== null, tag + ': devia passar');
          t.eq([s.tu, s.energy, s.to, s.fall], [tu, OV.U.idiv(tu - (doorPass || e.ufoDoor !== null ? TU.TU_DOOR : 0), 2), e.to, false], tag);
          t.eq(s.door, doorPass ? e.door : null, tag + ': porta');
          t.eq(s.opensUfoDoor, e.ufoDoor, tag + ': porta de OVNI');
          compared++;
        }
        // ligações verticais iguais às do mapa
        for (const up of [true, false]) {
          const L = BM.verticalLink(m, i, up);
          const s = P.stepCost(B, probe, i, up ? 8 : 9, { units: 'none' });
          if (!L) t.eq(s, null, 'sem ligação ' + [x, y, z]);
          else t.eq([s.tu, s.energy, s.to, s.kind], [L.tu, L.energy, L.to, L.kind]);
        }
      }
      t.ok(compared > 5000, 'arestas comparadas ' + compared);
    }
  });

  // ---- rota da bomba do Blaster -------------------------------------------------------------------------
  t.test('Path.flyRoute: contorna paredes e objetos, sobe pelo ar, evita unidades, null se fechado', () => {
    const B = fixture(10, 10, 3, false);
    for (let y = 0; y < 9; y++) set(B, 5, y, 0, 1, 'FARM.wall');
    set(B, 3, 5, 0, 3, 'FARM.crate');
    const from = I(B, 1, 1), to = I(B, 8, 1);
    const route = P.flyRoute(B, from, to);
    t.ok(route && route[0] === from && route[route.length - 1] === to, 'extremos incluídos');
    for (let k = 1; k < route.length; k++) {
      const d = P.dirBetween(B.map, route[k - 1], route[k]);
      t.ok(d >= 0, 'tiles adjacentes');
      if (route[k] !== to) t.ok(BM.def(B.map, route[k], 3) === null, 'evita objetos');
    }
    // sem telhados: a bomba sobe por cima do muro (rota curta), não contorna pelo fundo
    t.ok(route.some((i) => BM.xyz(B.map, i)[2] > 0), 'passa por cima');
    t.ok(route.length <= 10);
    // com telhado em z1 e muro completo: tem de contornar por y=9
    const C = fixture(10, 10, 2);
    for (let y = 0; y < 9; y++) set(C, 5, y, 0, 1, 'FARM.wall');
    let r2 = P.flyRoute(C, I(C, 1, 1), I(C, 8, 1));
    t.ok(r2 && r2.some((i) => BM.xyz(C.map, i)[1] === 9) && r2.every((i) => BM.xyz(C.map, i)[2] === 0), 'contorna pelo fundo');
    // unidades no caminho: evita se puder; o alvo pode estar ocupado
    const tgt = mk(C, 8, 1, 0, { side: 'xcom' }, true);
    const blocker = mk(C, 6, 9, 0, { side: 'alien' }, true);
    r2 = P.flyRoute(C, I(C, 1, 1), I(C, tgt.x, tgt.y));
    t.ok(r2 && r2.indexOf(I(C, 6, 9)) < 0 && r2.indexOf(I(C, 5, 9)) >= 0 && r2[r2.length - 1] === I(C, 8, 1), 'evita a unidade, chega ao alvo ocupado');
    // única passagem ocupada: passa mesmo assim (2.ª tentativa ignora unidades)
    BU.placeUnit(C, blocker, I(C, 5, 9));
    r2 = P.flyRoute(C, I(C, 1, 1), I(C, 8, 1));
    t.ok(r2 && r2.indexOf(I(C, 5, 9)) >= 0, 'atravessa a unidade quando não há alternativa');
    t.eq(P.flyRoute(C, I(C, 1, 1), I(C, 8, 1), { units: 'all' }), null, 'units:all sem segunda tentativa');
    // alvo fechado por paredes e telhado
    const E = fixture(6, 6, 2);
    for (const [x, y, p] of [[3, 3, 1], [4, 3, 1], [3, 3, 2], [3, 4, 2]]) set(E, x, y, 0, p, p === 1 ? 'FARM.wall' : 'FARM.wall.n');
    t.eq(P.flyRoute(E, I(E, 0, 0), I(E, 3, 3)), null);
    t.eq(P.flyRoute(E, I(E, 0, 0), I(E, 0, 0)), [I(E, 0, 0)]);
    // teto (base alienígena): sem subir
    const F = fixture(10, 10, 2, false);
    for (let y = 0; y < 10; y++) set(F, 5, y, 0, 1, 'FARM.wall');
    t.ok(P.flyRoute(F, I(F, 1, 1), I(F, 8, 1)) !== null);
    F.map.ceiling = true;
    t.eq(P.flyRoute(F, I(F, 1, 1), I(F, 8, 1)), null);
  });

  t.test('Path.dirBetween: 8 direções, subir/descer, quedas e não adjacentes', () => {
    const m = BM.create(5, 5, 3);
    const c = BM.idx(m, 2, 2, 1);
    for (let d = 0; d < 8; d++) t.eq(P.dirBetween(m, c, BM.idx(m, 2 + OV.U.DX[d], 2 + OV.U.DY[d], 1)), d);
    t.eq(P.dirBetween(m, c, BM.idx(m, 2, 2, 2)), 8);
    t.eq(P.dirBetween(m, c, BM.idx(m, 2, 2, 0)), 9);
    t.eq(P.dirBetween(m, c, BM.idx(m, 3, 2, 0)), 2, 'queda');
    t.eq(P.dirBetween(m, c, c), -1);
    t.eq(P.dirBetween(m, c, BM.idx(m, 4, 2, 1)), -1);
  });

  // ---- desempenho -------------------------------------------------------------------------------------------
  t.test('Path: desempenho em 50×50×3 gerado (reachable < 5 ms; find)', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'battleship', terrain: 'URBAN', seed: 3 }));
    t.eq([B.map.w, B.map.h, B.map.d], [50, 50, 3]);
    const u = B.units.find((x) => x.side === 'xcom');
    const ms = (fn, n) => {
      for (let k = 0; k < 5; k++) fn();
      const t0 = process.hrtime.bigint();
      for (let k = 0; k < n; k++) fn();
      return Number(process.hrtime.bigint() - t0) / 1e6 / n;
    };
    let nodes = 0;
    const full = ms(() => { nodes = P.reachable(B, u, 255, 255).list.length; }, 20);
    t.ok(nodes > 1500, 'nós ' + nodes);
    t.ok(full < 5, 'reachable (mapa inteiro, ' + nodes + ' nós) ' + full.toFixed(2) + ' ms');
    const turn = ms(() => P.reachable(B, u), 50);
    t.ok(turn < 2, 'reachable (UT do turno) ' + turn.toFixed(2) + ' ms');
    const fl = Object.assign({}, u, { id: -7, canFly: true });
    const fly = ms(() => P.reachable(B, fl, 80, 80), 20);
    t.ok(fly < 5, 'reachable voador 80 UT ' + fly.toFixed(2) + ' ms');
    const r = P.reachable(B, u, 255, 255);
    const targets = Array.from(r.list).filter((_, k) => k % 50 === 7);
    const fnd = ms(() => { for (const i of targets) P.find(B, u, i); }, 3) / targets.length;
    t.ok(fnd < 5, 'find médio ' + fnd.toFixed(2) + ' ms');
    if (t.args.perf) console.log('  path: reachable ' + full.toFixed(2) + ' ms (' + nodes + ' nós), turno ' + turn.toFixed(2) + ' ms, voador ' + fly.toFixed(2) + ' ms, find ' + fnd.toFixed(3) + ' ms');
  });
};
