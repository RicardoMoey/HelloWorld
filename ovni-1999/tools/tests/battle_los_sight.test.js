/* Coerência vista ⇔ tiro (js/sim/battle/los.js, DESIGN.md §8): um soldado que avista um alienígena tem de ter pelo
   menos uma linha de tiro, salvo se outra unidade estiver no caminho. Regressão: a árvore mesmo à frente do
   observador cujo canto o raio atravessa (a linha de tiles passa ao lado) deixava ver mas não disparar. */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const LOS = OV.LOS;
  const id = (k) => D.tileId(k);

  function fixture(w, h) {
    const m = BM.create(w, h, 1);
    for (let i = 0; i < m.plane; i++) m.parts[i * 4] = id('FARM.ground');
    const B = { map: m, units: [], items: [], nextId: 1, mission: { difficulty: 0, shade: 0 }, turn: 1, side: 'xcom' };
    BT.rebuildDerived(B);
    return B;
  }
  let uid = 1700;
  function mk(B, x, y, side, o) {
    const u = Object.assign({
      id: uid++, side, size: 1, x, y, z: 0, onMap: false, status: 'ok', dir: 4, kneel: false,
      height: 22, kneelHeight: 14, float: false, burn: 0, turnsSinceSpotted: 255,
    }, o || {});
    B.units.push(u);
    B._.unitById.set(u.id, u);
    BU.placeUnit(B, u, BM.idx(B.map, x, y, 0));
    return u;
  }

  t.test('LOS: árvore adjacente atravessada no canto — não se vê sem se poder disparar (caso seed 7)', () => {
    const B = fixture(30, 30);
    const v = mk(B, 16, 12, 'xcom', { dir: 4 });
    const a = mk(B, 11, 19, 'alien', { height: 21 });
    t.ok(LOS.canSee(B, v, a), 'sem a árvore vê');
    t.ok(!!LOS.targetVoxel(B, v, a), 'sem a árvore dispara');
    BM.setPart(B, BM.idx(B.map, 16, 13, 0), 3, id('FARM.tree'));
    const sees = LOS.canSee(B, v, a), lof = !!LOS.targetVoxel(B, v, a);
    t.eq(sees, lof, 'com a árvore em (16,13): vê=' + sees + ' tiro=' + lof);
  });

  t.test('LOS: árvores até 2 tiles do observador — avistar implica linha de tiro (200 casos)', () => {
    const rng = OV.RNG.create(0x7ee5);
    let seen = 0, bad = 0;
    const fails = [];
    for (let n = 0; n < 200; n++) {
      const B = fixture(24, 24);
      const v = mk(B, 12, 12, 'xcom', { dir: rng.int(0, 7), kneel: rng.int(0, 3) === 0 });
      let ax, ay;
      do {
        ax = rng.int(1, 22);
        ay = rng.int(1, 22);
      } while (Math.max(Math.abs(ax - 12), Math.abs(ay - 12)) < 4);
      const a = mk(B, ax, ay, 'alien', { kneel: rng.int(0, 3) === 0 });
      for (let k = rng.int(1, 4); k > 0; k--) {
        const tx = 12 + rng.int(-2, 2), ty = 12 + rng.int(-2, 2);
        if ((tx === 12 && ty === 12) || (tx === ax && ty === ay)) continue;
        BM.setPart(B, BM.idx(B.map, tx, ty, 0), 3, id('FARM.tree'));
      }
      BT.rebuildDerived(B);
      if (!LOS.canSee(B, v, a)) continue;
      seen++;
      if (!LOS.targetVoxel(B, v, a)) {
        bad++;
        if (fails.length < 3) fails.push([v.dir, ax, ay]);
      }
    }
    t.ok(seen > 40, 'casos com o alienígena à vista: ' + seen);
    t.eq(bad, 0, 'vistos sem linha de tiro ' + JSON.stringify(fails));
  });
};
