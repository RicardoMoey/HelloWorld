/* Testes do núcleo da batalha: js/sim/battle/map.js, mapgen.js, bunits.js, battle.js (DESIGN.md §5.3, §6, §7) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const id = (k) => D.tileId(k);
  const seeds = t.args.seeds ? +t.args.seeds : 3;

  // mapa de teste 5×5×2 de chão FARM
  function fixture() {
    const m = BM.create(5, 5, 2);
    for (let i = 0; i < 25; i++) m.parts[i * 4] = id('FARM.ground');
    for (let i = 25; i < 50; i++) m.parts[i * 4] = id('FARM.roof.up');
    return m;
  }
  const set = (m, x, y, z, part, key) => { m.parts[BM.idx(m, x, y, z) * 4 + part] = key ? id(key) : 0; };

  // ---- mapa: arestas e paredes ------------------------------------------------------------------------
  t.test('BMap: índices, limites e vizinhos', () => {
    const m = fixture();
    t.eq(m.n, 50);
    t.eq(BM.idx(m, 3, 2, 1), (1 * 5 + 2) * 5 + 3);
    t.eq(BM.xyz(m, BM.idx(m, 3, 2, 1)), [3, 2, 1]);
    t.ok(BM.inB(m, 4, 4, 1) && !BM.inB(m, 5, 0, 0) && !BM.inB(m, 0, -1, 0) && !BM.inB(m, 0, 0, 2));
    t.eq(BM.neighbour(m, BM.idx(m, 2, 2, 0), 0), BM.idx(m, 2, 1, 0));
    t.eq(BM.neighbour(m, BM.idx(m, 2, 2, 0), 3), BM.idx(m, 3, 3, 0));
    t.eq(BM.neighbour(m, BM.idx(m, 2, 2, 0), 8), BM.idx(m, 2, 2, 1));
    t.eq(BM.neighbour(m, BM.idx(m, 0, 0, 0), 6), -1);
    t.eq(BM.neighbour(m, BM.idx(m, 0, 0, 0), 9), -1);
  });

  t.test('BMap: paredes nas arestas oeste/norte (N, E, S, W)', () => {
    const m = fixture();
    set(m, 2, 2, 0, 2, 'FARM.wall.n'); // parede norte de (2,2)
    set(m, 3, 2, 0, 1, 'FARM.wall'); // parede oeste de (3,2) = aresta leste de (2,2)
    const e = (x, y, dir) => BM.edgeInfo(m, x, y, 0, dir);
    t.ok(e(2, 2, 0).blocked.move && e(2, 2, 0).blocked.los, 'N cruza a parede norte do próprio tile');
    t.ok(e(2, 1, 4).blocked.move, 'S cruza a parede norte do tile de baixo');
    t.ok(e(2, 2, 2).blocked.move, 'E cruza a parede oeste do tile a leste');
    t.ok(e(3, 2, 6).blocked.move, 'W cruza a parede oeste do próprio tile');
    t.ok(!e(2, 2, 4).blocked.move && !e(2, 2, 6).blocked.move, 'S e W de (2,2) livres');
    t.ok(!e(3, 2, 2).blocked.move, 'E de (3,2) livre');
    t.eq(e(2, 2, 0).to, BM.idx(m, 2, 1, 0));
    t.eq(e(2, 2, 2).heBlock, D.tileDefByKey['FARM.wall'].heBlock);
    t.ok(e(0, 0, 0).blocked.move && e(0, 0, 0).to === -1, 'fora do mapa bloqueia');
    t.eq(BM.edgeBlocks(m, 2, 2, 0, 0, 'LOS'), true);
    t.eq(BM.edgeBlocks(m, 2, 2, 0, 4, 'MOVE'), false);
    t.eq(BM.edgeBlocks(m, 2, 2, 0, 2, 'HE'), D.tileDefByKey['FARM.wall'].heBlock);
  });

  t.test('BMap: diagonais — MOVE bloqueia com qualquer parede, LOS só com os dois sub-caminhos', () => {
    const m = fixture();
    set(m, 2, 2, 0, 2, 'FARM.wall.n'); // start.north do passo NE a partir de (2,2)
    let e = BM.edgeInfo(m, 2, 2, 0, 1);
    t.ok(e.blocked.move, 'NE com start.north');
    t.ok(!e.blocked.los, 'NE: via leste livre ⇒ vê');
    set(m, 3, 2, 0, 1, 'FARM.wall'); // E.west fecha o outro sub-caminho
    e = BM.edgeInfo(m, 2, 2, 0, 1);
    t.ok(e.blocked.los && e.blocked.smoke, 'NE com os dois sub-caminhos fechados');
    t.eq(e.to, BM.idx(m, 3, 1, 0));
    // SW: start.west, S.west, S.north, SW.north
    const m2 = fixture();
    set(m2, 1, 3, 0, 2, 'FARM.wall.n'); // SW.north de (2,2) → SW = (1,3)
    t.ok(BM.edgeInfo(m2, 2, 2, 0, 5).blocked.move && !BM.edgeInfo(m2, 2, 2, 0, 5).blocked.los);
    // objeto de bloco inteiro intermédio (sem cortar esquinas)
    const m3 = fixture();
    set(m3, 3, 2, 0, 3, 'FARM.tree');
    t.ok(BM.edgeInfo(m3, 2, 2, 0, 1).blocked.move, 'árvore a leste impede NE');
    t.ok(!BM.edgeInfo(m3, 2, 2, 0, 1).blocked.los, 'via norte continua a ver');
    t.ok(!BM.edgeInfo(m3, 2, 2, 0, 0).blocked.move, 'N livre');
    // caixote (não é bloco inteiro) não impede a diagonal
    const m4 = fixture();
    set(m4, 3, 2, 0, 3, 'FARM.crate');
    t.ok(!BM.edgeInfo(m4, 2, 2, 0, 1).blocked.move);
  });

  t.test('BMap: portas, janelas, vedações, entulho', () => {
    const m = fixture();
    set(m, 2, 2, 0, 1, 'FARM.door');
    let e = BM.edgeInfo(m, 2, 2, 0, 6);
    t.ok(e.blocked.move && e.blocked.los, 'porta fechada bloqueia');
    t.eq(e.door, { i: BM.idx(m, 2, 2, 0), part: 1 });
    t.eq(BM.edgeInfo(m, 1, 2, 0, 2).door, { i: BM.idx(m, 2, 2, 0), part: 1 }, 'mesma porta do outro lado');
    t.eq(BM.edgeInfo(m, 2, 3, 0, 7).door, null, 'diagonal não abre portas');
    t.ok(BM.edgeInfo(m, 2, 3, 0, 7).blocked.move);
    set(m, 2, 2, 0, 1, 'FARM.doorOpen');
    e = BM.edgeInfo(m, 2, 2, 0, 6);
    t.ok(!e.blocked.move && !e.blocked.los && e.door === null, 'porta aberta');
    t.ok(BM.isDoorOpen(m, BM.idx(m, 2, 2, 0), 1));
    set(m, 3, 3, 0, 2, 'FARM.window.n');
    e = BM.edgeInfo(m, 3, 3, 0, 0);
    t.ok(e.blocked.move && !e.blocked.los && e.blocked.smoke, 'janela: vê-se, não se passa');
    set(m, 1, 1, 0, 1, 'FARM.fence');
    e = BM.edgeInfo(m, 1, 1, 0, 6);
    t.ok(e.blocked.move && !e.blocked.los, 'vedação');
    set(m, 4, 4, 0, 1, 'FARM.rubbleWall');
    e = BM.edgeInfo(m, 4, 4, 0, 6);
    t.ok(!e.blocked.move && e.wallTU === D.tileDefByKey['FARM.rubbleWall'].tu, 'entulho custa UT');
  });

  t.test('BMap: portas de OVNI (estado em ufoDoorOpen, grupo de segmentos)', () => {
    const m = fixture();
    set(m, 2, 1, 0, 3, 'UFO.ufoDoor');
    set(m, 2, 2, 0, 3, 'UFO.ufoDoor');
    set(m, 2, 3, 0, 3, 'UFO.hull');
    const a = BM.idx(m, 2, 1, 0), b = BM.idx(m, 2, 2, 0);
    t.ok(BM.isUfoDoor(m, a) && !BM.isDoorOpen(m, a));
    t.ok(!BM.canStand(m, a) && BM.isFullBlock(m, a));
    t.eq(BM.edgeInfo(m, 1, 1, 0, 2).ufoDoor, a);
    t.eq(BM.ufoDoorGroup(m, a), [a, b]);
    m.ufoDoorOpen[a] = 1;
    t.ok(BM.isDoorOpen(m, a) && BM.canStand(m, a) && !BM.isFullBlock(m, a));
    t.eq(BM.objectDef(m, a).key, 'UFO.ufoDoorOpen');
    t.eq(BM.edgeInfo(m, 1, 1, 0, 2).ufoDoor, null);
    t.eq(BM.tileTU(m, BM.idx(m, 2, 3, 0)), 255);
    t.eq(BM.tileTU(m, BM.idx(m, 0, 0, 0)), D.tileDefByKey['FARM.ground'].tu);
  });

  t.test('BMap: ligações verticais e quedas', () => {
    const m = fixture();
    set(m, 1, 1, 0, 3, 'UFO.gravlift');
    set(m, 1, 1, 1, 3, 'UFO.gravlift');
    set(m, 3, 3, 0, 3, 'FARM.stairsFoot');
    set(m, 3, 3, 1, 3, 'FARM.stairsHead');
    const g0 = BM.idx(m, 1, 1, 0), g1 = BM.idx(m, 1, 1, 1), s0 = BM.idx(m, 3, 3, 0), s1 = BM.idx(m, 3, 3, 1);
    t.eq(BM.verticalLink(m, g0, true), { to: g1, tu: OV.TUNE.TU_GRAVLIFT, energy: 0, kind: 'gravlift' });
    t.eq(BM.verticalLink(m, g1, false), { to: g0, tu: OV.TUNE.TU_GRAVLIFT, energy: 0, kind: 'gravlift' });
    t.eq(BM.verticalLink(m, g1, true), null, 'topo do mapa');
    t.eq(BM.verticalLink(m, s0, true), { to: s1, tu: OV.TUNE.TU_STAIRS, energy: OV.TUNE.EN_STAIRS, kind: 'stairs' });
    t.eq(BM.verticalLink(m, s1, false).to, s0);
    t.eq(BM.verticalLink(m, s0, false), null);
    t.eq(BM.verticalLink(m, s1, true), null);
    t.eq(BM.verticalLink(m, BM.idx(m, 0, 0, 0), true), null);
    set(m, 4, 4, 1, 0, null);
    const air = BM.idx(m, 4, 4, 1);
    t.ok(!BM.hasFloor(m, air));
    t.eq(BM.dropTarget(m, air), BM.idx(m, 4, 4, 0));
    t.eq(BM.dropTarget(m, BM.idx(m, 0, 0, 1)), BM.idx(m, 0, 0, 1), 'com chão fica');
    t.ok(BM.hasFloor(m, BM.idx(m, 0, 0, 0)), 'z0 tem sempre chão');
  });

  t.test('BMap.setPart: evento tile e estado derivado sujo', () => {
    const B = { map: fixture(), units: [], items: [] };
    BT.rebuildDerived(B);
    B._.dirty.light = false;
    B._.dirty.los = false;
    const i = BM.idx(B.map, 1, 1, 0);
    const ev = BM.setPart(B, i, 3, id('FARM.crate'));
    t.eq(ev, { t: 'tile', i, part: 3, defId: id('FARM.crate') });
    t.eq(BM.def(B.map, i, 3).key, 'FARM.crate');
    t.ok(B._.dirty.light && B._.dirty.los);
    t.ok(Object.keys(B).indexOf('_') < 0, 'B._ não é enumerável');
  });

  // ---- geração de mapas e batalhas ----------------------------------------------------------------------
  // verificação completa de uma batalha criada
  function checkBattle(B, tag) {
    const m = B.map;
    t.ok(B.gen.validated, tag + ': mapa validado');
    t.ok(B.xcomStarts.length >= 14, tag + ': inícios ' + B.xcomStarts.length);
    const reach = OV.MapGen.flood(m, B.xcomStarts);
    const lost = B.nodes.filter((n) => !reach[BM.idx(m, n.x, n.y, n.z)]);
    t.eq(lost.length, 0, tag + ': nós inacessíveis');
    const occ = new Map();
    for (const u of B.units) {
      if (!BU.isConscious(u)) {
        t.ok(!u.onMap || u.status === 'ok', tag + ': morto fora do mapa');
        continue;
      }
      t.ok(u.onMap, tag + ': unidade ' + u.type + ' fora do mapa');
      const tiles = BU.unitTiles(u, m);
      t.eq(tiles.length, u.size * u.size);
      for (const i of tiles) {
        t.ok(BM.canStand(m, i), tag + ': ' + u.type + ' num tile inválido ' + BM.xyz(m, i));
        t.ok(!occ.has(i), tag + ': duas unidades no tile ' + BM.xyz(m, i));
        occ.set(i, u.id);
        t.eq(B._.unitAt[i], u.id + 1, tag + ': unitAt');
        t.eq(BT.unitAt(B, i), u);
      }
      if (u.size === 2) {
        const [x, y, z] = [u.x, u.y, u.z];
        t.ok(!BM.edgeInfo(m, x, y, z, 2).blocked.move && !BM.edgeInfo(m, x, y + 1, z, 2).blocked.move
          && !BM.edgeInfo(m, x, y, z, 4).blocked.move && !BM.edgeInfo(m, x + 1, y, z, 4).blocked.move, tag + ': 2×2 sem paredes internas');
      }
      t.ok(u.tu === u.tuMax && u.tuMax > 0, tag + ': UT iniciais');
    }
    let count = 0;
    for (let i = 0; i < m.n; i++) if (B._.unitAt[i]) count++;
    t.eq(count, occ.size, tag + ': unitAt sem lixo');
    // tripulação completa (vivos + mortos na queda) dentro dos limites das linhas
    const dep = D.deployments[B.mission.deploymentId];
    const tot = D.deploymentRange(dep.id, B.mission.difficulty, B.mission.month); // tabela do mês (crewRules)
    const aliens = B.units.filter((u) => u.origSide === 'alien').length;
    t.ok(aliens >= tot.min && aliens <= tot.max, tag + ': aliens ' + aliens + ' fora de ' + tot.min + '..' + tot.max);
    t.eq(BT.outcome(B), null, tag + ': sem resultado no início');
    // itens: cada item com dono ou tile, e o dono tem-no no inventário
    for (const it of B.items) {
      if (it.owner !== null) t.ok(BU.slotOf(BU.findUnit(B, it.owner), it.id) !== null, tag + ': item ' + it.type + ' sem compartimento');
      else t.ok(it.at !== null && it.at >= 0 && it.at < m.n, tag + ': item solto sem tile');
    }
  }

  t.test('MapGen: todos os terrenos × todos os OVNIs geram mapas válidos (' + seeds + ' sementes)', () => {
    for (const terrain of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN']) {
      for (const ufoType in D.ufos) {
        for (let s = 1; s <= seeds; s++) {
          const mission = BT.quickMission({ ufoType, terrain, seed: s * 101 + terrain.length, difficulty: s % 3, month: s, landed: s === 2, squadSize: 10 });
          const B = BT.create(mission);
          const tag = terrain + ' ' + ufoType + ' s' + s;
          t.ok(B.ufo && B.ufo.blockId === D.ufos[ufoType].block, tag + ': OVNI no mapa');
          t.eq(B.gen.size, [D.ufos[ufoType].map.w, D.ufos[ufoType].map.h, D.ufos[ufoType].map.d], tag + ': tamanho do OVNI');
          t.eq(B.units.filter((u) => u.side === 'xcom').length, 10, tag + ': equipa');
          checkBattle(B, tag);
        }
      }
    }
  });

  t.test('MapGen: terror (civis), base alienígena (teto, d=2) e Marte (Cérebro em z1)', () => {
    for (let s = 1; s <= seeds; s++) {
      const terror = BT.create(BT.quickMission({ terrain: 'URBAN', seed: s, difficulty: 1 }));
      checkBattle(terror, 'terror s' + s);
      t.eq(terror.mission.kind, 'terror');
      t.eq(terror.ufo, null);
      const civ = terror.units.filter((u) => u.side === 'civ');
      const [lo, hi] = D.deployments.dep_terror_site.civilians;
      t.ok(civ.length >= lo && civ.length <= hi, 'civis ' + civ.length);
      for (const c of civ) t.ok(BT.unitAt(terror, BM.idx(terror.map, c.x, c.y, c.z)) === c && c.items.R === null);

      const base = BT.create(BT.quickMission({ terrain: 'ALIENBASE', seed: s, difficulty: 2 }));
      checkBattle(base, 'base s' + s);
      t.ok(base.map.ceiling && base.map.d === 2 && base.mission.shade === OV.TUNE.SHADE_ALIEN_BASE);
      t.ok(base.objectiveTiles.length > 0, 'núcleos da base');
      t.ok(base.layout.some((l) => l.blockId === 'ALIENBASE_LIFT') && base.craft === null);
      t.eq(base.units.filter((u) => u.side === 'xcom').length, 8);

      const mars = BT.create(BT.quickMission({ terrain: 'MARS', seed: s, difficulty: 0 }));
      checkBattle(mars, 'marte s' + s);
      t.eq(mars.mission.kind, 'cydonia');
      t.eq(mars.mission.craftType, 'avenger');
      t.ok(mars.map.d === 2 && !mars.map.ceiling && mars.mission.shade === OV.TUNE.SHADE_MARS);
      t.ok(mars.objectiveTiles.length > 0 && mars.objectiveTiles.every((i) => BM.xyz(mars.map, i)[2] === 1), 'Cérebro em z1');
      t.ok(mars.units.some((u) => u.type === 'sectopod') && mars.units.some((u) => u.type === 'chryssalid'), 'linhas com unidade fixa');
    }
  });

  t.test('MapGen: nave rodada encostada à borda; inícios = START; especiais varridos', () => {
    for (let s = 1; s <= 8; s++) {
      const g = OV.MapGen.generate({ terrain: 'FARM', ufoType: 'large_scout', craftType: 'skyranger' }, OV.RNG.create(s));
      const c = g.craft;
      t.ok(c.x === 0 || c.y === 0 || c.x + c.w === g.map.w || c.y + c.h === g.map.h, 'nave na borda');
      t.eq(g.xcomStarts.length, D.compiled.CRAFT_SKYRANGER.startTiles.length);
      for (const i of g.xcomStarts) t.eq(BM.def(g.map, i, 0).special, 'START');
      t.ok(g.specials.POWER_SOURCE.length === D.ufos.large_scout.powerSources, 'fontes de energia');
      t.ok(g.nodes.some((n) => n.inside) && g.nodes.some((n) => n.scout), 'nós do OVNI e de batedor');
      t.ok(g.layout.length >= 3);
    }
    t.throws(() => OV.MapGen.generate({ terrain: 'NOPE' }, OV.RNG.create(1)));
    t.eq(OV.MapGen.resolveSize({ terrain: 'FARM', size: 'small' }), [30, 30, 3]);
    t.eq(OV.MapGen.resolveSize({ terrain: 'FARM', w: 20, h: 30, d: 2 }), [20, 30, 2]);
  });

  t.test('OVNI despenhado: fontes de energia marcadas (75 %), brechas 3–6; pousado intacto', () => {
    let marked = 0, total = 0;
    for (let s = 1; s <= 24; s++) {
      const B = BT.create(BT.quickMission({ ufoType: 'supply_ship', terrain: 'DESERT', seed: s }));
      t.eq(B.mission.kind, 'crash');
      total += B.specials.POWER_SOURCE.length;
      marked += B.pendingExplosions.length;
      for (const e of B.pendingExplosions) {
        const o = BM.def(B.map, e.i, 3);
        t.ok(o && o.special === 'POWER_SOURCE', 'explosão marcada numa fonte de energia');
        t.ok(e.power >= 120 && e.power <= 180 && e.radius === 6 && e.dmg === 'HE' && e.cause === 'powerSource');
        const [x, y, z] = BM.xyz(B.map, e.i);
        t.eq([e.voxel[0] >> 4, e.voxel[1] >> 4, (e.voxel[2] / 24) | 0], [x, y, z]);
      }
      t.ok(B.breaches.length >= 3 && B.breaches.length <= 6, 'brechas ' + B.breaches.length);
      for (const i of B.breaches) t.ok(BM.canStand(B.map, i), 'brecha transitável');
      const dead = B.units.filter((u) => u.crashDead);
      for (const u of dead) {
        t.ok(u.status === 'dead' && !u.onMap);
        t.ok(B.items.some((it) => it.unitId === u.id && it.type === u.corpse && it.at !== null), 'cadáver no chão');
      }
      t.eq(B.stats.crashDead, dead.length);
      const L = BT.create(BT.quickMission({ ufoType: 'supply_ship', terrain: 'DESERT', seed: s, landed: true }));
      t.eq(L.pendingExplosions.length, 0);
      t.eq(L.breaches.length, 0);
      t.ok(!L.units.some((u) => u.crashDead));
    }
    const pct = Math.round((marked * 100) / total);
    t.ok(pct >= 60 && pct <= 90, 'percentagem de fontes que explodem ' + pct);
  });

  // ---- unidades e itens ------------------------------------------------------------------------------------
  t.test('BUnits: soldado, UT de ações, peso, UT do turno, inventário', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 7, night: true }));
    const u = B.units.find((x) => x.side === 'xcom');
    const rifle = BU.item(B, u, 'R');
    t.eq(rifle.type, 'rifle');
    t.eq(rifle.ammo, { type: 'rifle_clip', rounds: 20 }, 'espingarda carregada');
    t.eq(BU.item(B, u, 'belt').map((i) => i.type), ['rifle_clip', 'grenade', 'electro_flare']);
    t.eq(BU.weight(B, u), 8 + 3 + 3 + 3 + 3 + (BU.item(B, u, 'pack').length ? 5 : 0));
    const tu = u.stats.tu;
    t.eq(BU.actionTU(B, u, rifle.id, 'snap'), Math.trunc(tu * 25 / 100));
    t.eq(BU.actionTU(B, u, rifle.id, 'aimed'), Math.trunc(tu * 80 / 100));
    t.eq(BU.actionTU(B, u, rifle.id, 'auto'), Math.trunc(tu * 35 / 100));
    t.eq(BU.actionTU(B, u, rifle.id, 'melee'), null);
    const gren = BU.item(B, u, 'belt')[1];
    t.eq(BU.actionTU(B, u, gren.id, 'prime'), Math.trunc(tu / 2));
    t.eq(BU.actionTU(B, u, gren.id, 'throw'), Math.trunc(tu / 4));
    t.eq(BU.actionTU(B, u, 'chryssalid_weapon', 'melee'), OV.TUNE.TU_ALIEN_MELEE, 'flat');
    t.eq(BU.actionTU(B, u, 'medikit', 'use'), OV.TUNE.TU_MEDIKIT);
    t.eq(BU.invMoveCost('belt', 'R'), 4);
    t.eq(BU.invMoveCost('ground', 'pack'), 20);
    t.eq(BU.eyeHeight(u), 20);
    t.ok(BU.canKneel(u));
    u.kneel = true;
    t.eq(BU.eyeHeight(u), 12);
    u.kneel = false;
    // Força < peso ⇒ UT × Força/peso; feridas nas pernas −10 % cada
    u.stats.str = 10;
    const w = BU.weight(B, u);
    t.eq(BU.turnTU(B, u), Math.trunc(tu * 10 / w));
    u.stats.str = 100;
    u.wounds[4] = 1;
    u.wounds[5] = 1;
    t.eq(BU.turnTU(B, u), tu - Math.trunc(tu * 20 / 100));
    u.wounds[4] = u.wounds[5] = 0;
    // cinto cheio (4 unidades): um medikit (2) não cabe
    const kit = BU.newItem(B, 'medikit');
    t.eq(kit.charges, { heal: 10, stim: 10, pain: 10 });
    t.ok(!BU.giveItem(B, u, kit.id, 'belt'), 'cinto cheio');
    t.ok(BU.giveItem(B, u, kit.id, 'L'), 'mão esquerda livre');
    t.ok(!BU.giveItem(B, u, BU.newItem(B, 'pistol').id, 'L'), 'mão ocupada');
    t.eq(BU.slotOf(u, kit.id), 'L');
    t.eq(BU.handItems(B, u).length, 2);
    const tile = BU.unitTile(B, u);
    const dropped = BU.dropItem(B, u, 'L');
    t.ok(dropped === kit && kit.owner === null && kit.at === tile && u.items.L === null);
    t.ok(BU.giveItem(B, u, kit.id, 'L') && kit.at === null && kit.owner === u.id);
    t.ok(BU.dropItem(B, u, kit.id, 0) === kit && kit.at === 0);
    t.ok(BU.deleteItem(B, kit.id) && BU.findItem(B, kit.id) === null);
  });

  t.test('BUnits: alienígenas (armas, dificuldade, 2×2, armas embutidas) e civis', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'terror_ship', terrain: 'FARM', seed: 3, race: 'sectoid', difficulty: 0 }));
    const sol = B.units.find((u) => u.type === 'sectoid_soldier');
    t.ok(sol, 'soldado sectoide');
    const w = BU.item(B, sol, 'R');
    t.ok(w && /^(plasma_pistol|plasma_rifle|heavy_plasma)$/.test(w.type), 'arma de plasma');
    t.ok(w.ammo && w.ammo.rounds === D.items[w.ammo.type].rounds, 'carregada');
    t.eq(sol.armour, D.alienArmour('sectoid_soldier', 0), '«Recruta»: armadura ×0,5');
    t.eq(sol.stats.fire, D.alienStats('sectoid_soldier', 0).fire);
    t.eq(sol.mods.MELEE, 120);
    t.eq(sol.stats.energyRecovery, 30);
    const disc = B.units.find((u) => u.type === 'cyberdisc');
    t.ok(disc && disc.size === 2 && disc.canFly, 'Ciberdisco 2×2');
    t.eq(BU.item(B, disc, 'R').type, 'cyberdisc_weapon');
    t.eq(BU.unitTiles(disc, B.map).length, 4);
    t.eq(BU.unitTiles(disc).length, 4);
    t.ok(disc.explodeOnDeath && disc.explodeOnDeath.radius === 6);
    const civ = BU.fromCivilian(B, 'civilian_f', B.rng.map);
    t.ok(civ.side === 'civ' && civ.female && civ.items.R === null && civ.stats.tu === D.units.civilian_f.stats.tu);
    const crys = BU.fromAlien(B, 'chryssalid', 0, B.rng.map, 'dep_terror_site');
    t.eq(crys.zombify, 'zombie');
    const z = BU.fromAlien(B, 'zombie', 0, B.rng.map, 'dep_terror_site');
    t.eq(z.spawnOnDeath, 'chryssalid');
    t.ok(!BU.canKneel(disc) && !BU.canKneel(sol));
  });

  t.test('Battle: alienígenas preferem nós da sua patente; tripulação do OVNI dentro dele', () => {
    let inside = 0, all = 0;
    for (let s = 1; s <= 10; s++) {
      const B = BT.create(BT.quickMission({ ufoType: 'harvester', terrain: 'FOREST', seed: s, landed: true }));
      const r = B.ufo;
      for (const u of B.units) {
        if (u.side !== 'alien') continue;
        if (u.rank === 'leader' || u.rank === 'commander') t.ok(u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h, 'líder dentro do OVNI');
        all++;
        if (u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h) inside++;
        if (u.ai.node >= 0) {
          const n = B.nodes[u.ai.node];
          t.ok(Math.abs(n.x - u.x) <= 1 && Math.abs(n.y - u.y) <= 1 && n.z === u.z, 'no nó atribuído');
        }
      }
    }
    t.ok(inside > all / 3 && inside < all, 'parte dentro, parte fora: ' + inside + '/' + all);
  });

  // ---- serialização, hash, determinismo, resultado ---------------------------------------------------------
  t.test('Battle: serialize → JSON → deserialize mantém o hash', () => {
    for (const opts of [{ ufoType: 'battleship', terrain: 'POLAR', seed: 11 }, { terrain: 'URBAN', seed: 5, night: true }, { terrain: 'MARS', seed: 2 }]) {
      const B = BT.create(BT.quickMission(opts));
      B.rng.combat.int(0, 100);
      const h = BT.hash(B);
      const text = JSON.stringify(BT.serialize(B));
      t.ok(text.indexOf('"_"') < 0, 'sem derivados');
      const B2 = BT.deserialize(JSON.parse(text));
      t.eq(BT.hash(B2), h, 'hash igual');
      t.ok(B2.map.parts instanceof Uint16Array && B2.map.parts.length === B.map.parts.length);
      t.eq(B2.rng.combat.state(), B.rng.combat.state());
      t.eq(B2.rng.ai.int(0, 1000), B.rng.ai.int(0, 1000), 'streams continuam iguais');
      t.eq(B2._.unitAt, B._.unitAt);
      t.eq(BT.serialize(B2), BT.serialize(B));
      // o hash muda com o estado
      B2.units[0].tu--;
      t.ok(BT.hash(B2) !== BT.hash(B));
      B2.units[0].tu++;
      B2.map.smoke[3] = 4;
      t.ok(BT.hash(B2) !== BT.hash(B));
    }
  });

  t.test('Battle: determinismo (mesma semente ⇒ mesmo hash; outra semente ⇒ outro)', () => {
    const m = BT.quickMission({ ufoType: 'abductor', terrain: 'JUNGLE', seed: 1234, difficulty: 2, month: 4 });
    const h1 = BT.hash(BT.create(m)), h2 = BT.hash(BT.create(BT.quickMission({ ufoType: 'abductor', terrain: 'JUNGLE', seed: 1234, difficulty: 2, month: 4 })));
    t.eq(h1, h2);
    t.ok(BT.hash(BT.create(BT.quickMission({ ufoType: 'abductor', terrain: 'JUNGLE', seed: 1235, difficulty: 2, month: 4 }))) !== h1);
    t.eq(JSON.stringify(BT.serialize(BT.create(m))), JSON.stringify(BT.serialize(BT.create(m))));
  });

  t.test('Battle.quickMission: equipa gerada, equipamento por mês e B jogável', () => {
    const m = BT.quickMission({ ufoType: 'medium_scout', terrain: 'FARM', night: false, difficulty: 1, month: 0, squadSize: 6, seed: 9 });
    t.eq(m.squad.length, 6);
    t.eq(m.kind, 'crash');
    t.eq(m.squad.filter((s) => s.loadout.pack.indexOf('medikit') >= 0).length, 1, 'um medikit');
    for (const s of m.squad) {
      t.eq(s.loadout.R, 'rifle');
      t.eq(s.loadout.belt, ['rifle_clip', 'rifle_clip', 'grenade']);
      t.ok(s.name && s.stats.tu >= 50 && s.stats.tu <= 60 && D.soldierGen.nationalities[s.nat]);
    }
    // equipamento da progressão da campanha (persona r4): mês 1–2 laser + armadura, 3–5 plasma pesado, 6+ fato energético
    const night = BT.quickMission({ ufoType: 'medium_scout', terrain: 'FARM', night: true, month: 1, seed: 9 });
    t.ok(night.squad[0].loadout.R === 'laser_rifle' && night.squad[0].loadout.belt.indexOf('electro_flare') >= 0 && night.squad[0].armour === 'personal_armour');
    t.eq([BT.quickMission({ month: 4, seed: 1 }).squad[0].loadout.R, BT.quickMission({ month: 4, seed: 1 }).squad[0].armour], ['heavy_plasma', 'personal_armour']);
    t.eq([BT.quickMission({ month: 7, seed: 1 }).squad[0].loadout.R, BT.quickMission({ month: 7, seed: 1 }).squad[0].armour], ['heavy_plasma', 'power_suit']);
    const B = BT.create(m);
    t.eq(B.turn, 1);
    t.eq(B.side, 'xcom');
    t.eq(B.mission.shade, 0);
    t.ok(B.rng.combat && B.rng.ai && B.rng.map);
    t.eq(BT.unitsOf(B, 'xcom').length, 6);
    t.ok(BT.unitsOf(B, 'alien').length > 0);
    const s0 = BT.unitsOf(B, 'xcom')[0];
    t.ok(B.craftTiles.indexOf(BU.unitTile(B, s0)) >= 0, 'soldado na nave');
    t.ok(BU.item(B, s0, 'R').ammo, 'arma carregada');
    t.eq(s0.dir, (4 + 2 * B.gen.craftRot) & 7, 'virado para a rampa');
    // carga da nave no chão
    const B2 = BT.create(Object.assign({}, m, { craftItems: { grenade: 3, smoke_grenade: 1, alien_alloys: 2 } }));
    t.eq(B2.items.filter((it) => it.at === B2.items.find((x) => x.type === 'smoke_grenade').at && it.owner === null).length, 4);
    t.ok(!B2.items.some((it) => it.type === 'alien_alloys'));
    // create(G, mission) também é aceite
    t.eq(BT.hash(BT.create({}, m)), BT.hash(B));
  });

  t.test('Battle.outcome: vitória com aliens neutralizados, derrota sem X-COM conscientes, Cérebro', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 21 }));
    t.eq(BT.outcome(B), null);
    for (const u of BT.unitsOf(B, 'alien')) {
      u.status = 'out';
      BU.removeUnitFromMap(B, u);
    }
    t.eq(BT.outcome(B), 'win', 'atordoados contam como neutralizados');
    for (const u of BT.unitsOf(B, 'xcom')) {
      u.status = 'dead';
      BU.removeUnitFromMap(B, u);
    }
    t.eq(BT.outcome(B), 'loss', 'derrota tem prioridade');
    B.aborted = true;
    t.eq(BT.outcome(B), 'abort');
    const M = BT.create(BT.quickMission({ terrain: 'MARS', seed: 4 }));
    t.eq(BT.outcome(M), null);
    for (const i of M.objectiveTiles) BM.setPart(M, i, 3, 0);
    t.ok(BT.objectiveDestroyed(M));
    t.eq(BT.outcome(M), 'win', 'Cérebro destruído');
  });

  t.test('BUnits.placeUnit / removeUnitFromMap mantêm unitAt (2×2 incluído)', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'terror_ship', terrain: 'DESERT', seed: 8, race: 'floater', landed: true }));
    const r = B.units.find((u) => u.size === 2 && BU.isConscious(u));
    t.ok(r, 'unidade 2×2 (Ceifeiro)');
    const before = BU.unitTiles(r, B.map);
    const target = BT.nearestFree(B, r, B.xcomStarts[0], null);
    t.ok(target >= 0 && BU.fits(B, r, target));
    BU.placeUnit(B, r, target);
    for (const i of before) if (BU.unitTiles(r, B.map).indexOf(i) < 0) t.eq(B._.unitAt[i], 0);
    for (const i of BU.unitTiles(r, B.map)) t.eq(BT.unitAt(B, i), r);
    BU.removeUnitFromMap(B, r);
    for (const i of BU.unitTiles(r, B.map)) t.eq(B._.unitAt[i], 0);
    t.ok(!r.onMap);
    const copy = BT.rebuildDerived(B);
    for (const i of BU.unitTiles(r, B.map)) t.eq(copy.unitAt[i], 0);
  });
  // ---- regressões da revisão (onda 2) --------------------------------------------------------------------------------
  const drain = (gen) => {
    const ev = [];
    let r;
    while (!(r = gen.next()).done) ev.push(r.value);
    return ev;
  };
  const LIVE = { ok: 1, panic: 1 };

  t.test('OVNI despenhado: as explosões da queda nunca acabam a missão antes da primeira ação X-COM', () => {
    let blasts = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', month: 1, seed, squadSize: 4 }));
      const aliens = new Set(B.units.filter((u) => u.side === 'alien').map((u) => u.id));
      const ev = drain(BT.beginBattle(B));
      const after = B.units.filter((u) => u.side === 'alien' && LIVE[u.status]).length;
      if (ev.some((e) => e.t === 'damage' && aliens.has(e.unitId) && e.amount > 0)) blasts++;
      t.ok(B.phase !== 'over' && !ev.some((e) => e.t === 'battleEnd'), 'semente ' + seed + ': ainda em jogo');
      t.ok(after >= 1, 'pelo menos um alienígena consciente');
    }
    t.ok(blasts > 0, 'as explosões da queda ainda ferem a tripulação (' + blasts + ' missões)');
  });

  t.test('Battle.deserialize refaz a visibilidade (alvo visível continua válido; sem refreshAll manual)', () => {
    let checked = 0;
    for (const seed of [17, 20, 24, 3, 5]) {
      const B = BT.create(BT.quickMission({ ufoType: 'medium_scout', terrain: 'FARM', month: 1, seed, squadSize: 8 }));
      drain(BT.beginBattle(B));
      // um soldado à frente de um alienígena (de dia, a 2 tiles)
      const al = B.units.find((u) => u.side === 'alien' && LIVE[u.status] && u.onMap);
      const so = B.units.find((u) => u.side === 'xcom' && LIVE[u.status]);
      const spot = BT.nearestFree(B, so, BM.idx(B.map, Math.max(0, al.x - 2), al.y, al.z), null);
      if (spot >= 0) {
        BU.removeUnitFromMap(B, so);
        BU.placeUnit(B, so, spot);
        so.dir = OV.U.dirTo(al.x - so.x, al.y - so.y);
        OV.LOS.refreshAll(B);
      }
      const seen = [...B._.visible.xcom].filter((id) => (BU.findUnit(B, id) || {}).side === 'alien');
      const B2 = BT.deserialize(JSON.parse(JSON.stringify(BT.serialize(B))));
      t.ok(B2._.visible && B2._.visible.xcom, 'B._.visible existe depois de carregar');
      t.eq([...B2._.visible.xcom].sort((a, b) => a - b), [...B._.visible.xcom].sort((a, b) => a - b), 'mesma visibilidade');
      t.eq(BT.hash(B2), BT.hash(B), 'refazer a visão não altera o estado');
      if (!seen.length) continue;
      const tgt = BU.findUnit(B, seen[0]);
      for (const u of B.units) {
        if (u.side !== 'xcom' || !LIVE[u.status] || !B._.sees[u.id] || !B._.sees[u.id].has(tgt.id)) continue;
        const a = { type: 'shoot', unitId: u.id, hand: 'R', mode: 'snap', target: { unitId: tgt.id } };
        const v1 = OV.Act.validate(B, a), v2 = OV.Act.validate(B2, a);
        t.eq(v2.ok, v1.ok, 'validate igual antes/depois (' + (v1.reason || 'ok') + ' / ' + (v2.reason || 'ok') + ')');
        t.ok(v2.reason !== 'notVisible', 'nunca notVisible depois de carregar');
        checked++;
        break;
      }
    }
    t.ok(checked > 0, 'houve um alienígena à vista');
  });

  t.test('Battle.hash cobre pontuação, memória da IA, fogo novo, berserk, batota, fase e reservas', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 3, squadSize: 4 }));
    const h = BT.hash(B);
    const probes = [
      () => { B.stats.aliensKilled++; }, () => { B.aiMem = { xcom: { seen: {}, goal: 3, visited: [] } }; }, () => { B.freshFire = [7]; },
      () => { B.pendingBerserk = [{ unitId: 1, shots: [] }]; }, () => { B.cheat = true; }, () => { B.phase = 'play'; },
      () => { B.reserve = 'snap'; }, () => { B.reserveKneel = true; },
    ];
    for (const f of probes) {
      const snap = JSON.parse(JSON.stringify(BT.serialize(B)));
      f();
      t.ok(BT.hash(B) !== h, 'muda com ' + f.toString());
      const back = BT.deserialize(snap);
      Object.assign(B, { stats: back.stats, aiMem: back.aiMem, freshFire: back.freshFire, pendingBerserk: back.pendingBerserk, cheat: back.cheat, phase: back.phase, reserve: back.reserve, reserveKneel: back.reserveKneel });
      if (back.aiMem === undefined) delete B.aiMem;
      if (back.freshFire === undefined) delete B.freshFire;
      t.eq(BT.hash(B), h, 'repõe');
    }
  });

  t.test('Debriefing: alienígena sob Controlo Mental X-COM no fim da vitória é capturado', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 5, squadSize: 4 }));
    drain(BT.beginBattle(B));
    const crew = B.units.filter((u) => u.side === 'alien' && LIVE[u.status]);
    const keep = crew.find((u) => u.capturable);
    t.ok(keep, 'tripulante capturável');
    for (const u of crew) if (u !== keep) OV.Combat.killUnit(B, u, null, 'test');
    keep.side = 'xcom';
    keep.control = { by: 'xcom', revertOn: 'xcom', turn: B.turn, attackerId: null };
    t.eq(BT.outcome(B), 'win');
    const d = BT.debrief(B);
    t.ok(d.captured.some((c) => c.unitId === keep.id), 'capturado');
    t.ok(d.lines.some((l) => l.key === 'bs.debrief.aliensCaptured'), 'linha de captura');
  });

  t.test('Battle: alienígenas 2×2 só desovam em zonas ligadas ao resto do mapa (≥ 40 tiles alcançáveis)', () => {
    let n = 0;
    for (const [ufoType, seed] of [['terror_ship', 2], ['terror_ship', 12], ['terror_ship', 13], ['battleship', 2]]) {
      const B = BT.create(BT.quickMission({ ufoType, terrain: 'FARM', month: 6, seed, squadSize: 4 }));
      for (const u of B.units) {
        if (u.side !== 'alien' || (u.size | 0) < 2 || !u.onMap) continue;
        const r = OV.Path.reachable(B, Object.assign({}, u, { tu: 9999, energy: 9999 }), 9999, 9999, { units: 'none' });
        t.ok(r.list.length >= 40, u.type + ' em ' + ufoType + '/' + seed + ': ' + r.list.length + ' tiles');
        n++;
      }
    }
    t.ok(n >= 0);
  });
};
