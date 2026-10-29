/* Testes de linha de vista, luz, campo de visão e traçado de tiros: js/sim/battle/los.js (DESIGN.md §8, §3.11; REA 03 §7) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const LOS = OV.LOS;
  const id = (k) => D.tileId(k);
  const seeds = t.args.seeds ? +t.args.seeds : 3;

  // mapa w×h×d com chão FARM em z0 (roof ⇒ telhado nos níveis acima em [rx0..rx1]×[ry0..ry1])
  function fixture(w, h, d, shade, roof) {
    const m = BM.create(w || 16, h || 16, d || 1);
    for (let i = 0; i < m.plane; i++) m.parts[i * 4] = id('FARM.ground');
    if (roof) {
      for (let z = 1; z < m.d; z++) {
        for (let y = roof[1]; y <= roof[3]; y++) for (let x = roof[0]; x <= roof[2]; x++) m.parts[BM.idx(m, x, y, z) * 4] = id('FARM.roof.up');
      }
    }
    const B = { map: m, units: [], items: [], nextId: 1, mission: { difficulty: 0, shade: shade || 0 }, turn: 1, side: 'xcom' };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  const put = (B, x, y, z, part, key) => BM.setPart(B, I(B, x, y, z), part, key ? id(key) : 0);
  let uid = 900;
  // unidade mínima (soldado 22/14 por omissão), colocada no mapa
  function mk(B, x, y, side, o) {
    const u = Object.assign({
      id: uid++, side: side || 'xcom', size: 1, x, y, z: 0, onMap: false, status: 'ok', dir: 2, kneel: false,
      height: 22, kneelHeight: 14, float: false, burn: 0, turnsSinceSpotted: 255,
    }, o || {});
    B.units.push(u);
    B._.unitById.set(u.id, u);
    BU.placeUnit(B, u, I(B, x, y, u.z));
    return u;
  }
  const moveTo = (B, u, x, y, z) => BU.placeUnit(B, u, I(B, x, y, z || 0));
  const centre = (u, lz) => [u.x * 16 + 8, u.y * 16 + 8, u.z * 24 + lz];

  // ---- paredes, portas, janelas --------------------------------------------------------------------------
  t.test('LOS: parede bloqueia a vista em cada aresta (N, E, S, W) e nas do próprio tile', () => {
    // [direção do observador, alvo dx, dy, tile da parede dx, dy, parte]
    const cases = [
      [0, 0, -4, 0, -1, 2], [2, 4, 0, 2, 0, 1], [4, 0, 4, 0, 2, 2], [6, -4, 0, -1, 0, 1],
      [0, 0, -4, 0, 0, 2], [6, -4, 0, 0, 0, 1], [2, 4, 0, 1, 0, 1], [4, 0, 4, 0, 1, 2],
    ];
    for (const [dir, tx, ty, wx, wy, part] of cases) {
      const B = fixture(12, 12);
      const v = mk(B, 5, 5, 'xcom', { dir });
      const a = mk(B, 5 + tx, 5 + ty, 'alien');
      t.ok(LOS.canSee(B, v, a), 'sem parede, dir ' + dir);
      t.eq(LOS.fov(B, v).spotted, [a.id], 'avistado sem parede');
      put(B, 5 + wx, 5 + wy, 0, part, part === 1 ? 'FARM.wall' : 'FARM.wall.n');
      const tag = 'dir ' + dir + ' parede ' + [wx, wy, part];
      t.ok(!LOS.canSee(B, v, a), 'com parede: ' + tag);
      const B2 = fixture(12, 12);
      const v2 = mk(B2, 5, 5, 'xcom', { dir });
      mk(B2, 5 + tx, 5 + ty, 'alien');
      put(B2, 5 + wx, 5 + wy, 0, part, part === 1 ? 'FARM.wall' : 'FARM.wall.n');
      const r = LOS.fov(B2, v2);
      t.eq(r.spotted, [], 'fov: ' + tag);
      t.eq(B2.map.disc[I(B2, 5 + tx, 5 + ty)] & 1, 0, 'tile atrás da parede por descobrir: ' + tag);
      t.eq(B2.map.disc[I(B2, 5, 5)], 7, 'o próprio tile');
    }
  });

  t.test('LOS: portas de batente (fechada bloqueia, aberta não) e portas de OVNI', () => {
    const B = fixture(12, 12);
    const v = mk(B, 2, 5, 'xcom', { dir: 2 });
    const a = mk(B, 8, 5, 'alien', { dir: 6 });
    put(B, 5, 5, 0, 1, 'FARM.door');
    t.ok(!LOS.canSee(B, v, a) && !LOS.canSee(B, a, v), 'porta fechada');
    t.eq(LOS.traceShot(B, LOS.originVoxel(B, v, centre(a, 11)), centre(a, 11), v.id).kind, 'west', 'tiro acerta a porta');
    put(B, 5, 5, 0, 1, 'FARM.doorOpen');
    t.ok(LOS.canSee(B, v, a) && LOS.canSee(B, a, v), 'porta aberta');
    t.eq(LOS.traceShot(B, LOS.originVoxel(B, v, centre(a, 11)), centre(a, 11), v.id).unitId, a.id, 'tiro passa a porta aberta');
    put(B, 5, 5, 0, 2, 'FARM.door.n');
    t.ok(LOS.canSee(B, v, a), 'porta norte não está no caminho');
    // porta de OVNI: objeto de bloco inteiro; aberta = definição alternativa (sem altura)
    const C = fixture(12, 12);
    const w = mk(C, 2, 5, 'xcom', { dir: 2 });
    const b = mk(C, 8, 5, 'alien');
    put(C, 5, 5, 0, 3, 'UFO.ufoDoor');
    t.ok(!LOS.canSee(C, w, b), 'porta de OVNI fechada');
    LOS.fov(C, w);
    t.eq(C.map.disc[I(C, 6, 5)] & 1, 0, 'atrás da porta de OVNI por descobrir');
    t.eq(C.map.disc[I(C, 5, 5)] & 1, 1, 'a própria porta (alvo da linha) é vista');
    t.eq(LOS.traceShot(C, LOS.eyeVoxel(C, w), centre(b, 11), w.id).kind, 'object');
    C.map.ufoDoorOpen[I(C, 5, 5)] = 1;
    t.ok(LOS.canSee(C, w, b), 'porta de OVNI aberta');
    t.eq(LOS.fov(C, w).spotted, [b.id]);
    t.eq(LOS.traceShot(C, LOS.eyeVoxel(C, w), centre(b, 11), w.id).unitId, b.id);
  });

  t.test('LOS: janelas e vedações não tapam a vista, mas bloqueiam o passo e apanham tiros', () => {
    const B = fixture(12, 12);
    const v = mk(B, 2, 5, 'xcom', { dir: 2 });
    const a = mk(B, 8, 5, 'alien');
    put(B, 5, 5, 0, 1, 'FARM.window');
    t.ok(LOS.canSee(B, v, a), 'janela');
    t.ok(BM.edgeInfo(B.map, 4, 5, 0, 2).blocked.move && !BM.edgeInfo(B.map, 4, 5, 0, 2).blocked.los);
    let r = LOS.traceShot(B, LOS.originVoxel(B, v, centre(a, 11)), centre(a, 11), v.id);
    t.eq([r.kind, r.i, r.part], ['west', I(B, 5, 5), 1], 'o tiro parte a janela');
    t.ok((r.voxel[0] & 15) < 2);
    put(B, 5, 5, 0, 1, 'FARM.fence');
    t.ok(LOS.canSee(B, v, a), 'vedação');
    r = LOS.traceShot(B, LOS.originVoxel(B, v, centre(a, 18)), centre(a, 18), v.id);
    t.eq(r.unitId, a.id, 'tiro alto passa por cima da vedação (h12)');
    r = LOS.traceShot(B, [44, 88, 4], [a.x * 16 + 8, a.y * 16 + 8, 4], v.id);
    t.eq([r.kind, r.i], ['west', I(B, 5, 5)], 'tiro baixo acerta a vedação');
  });

  t.test('LOS: regra das diagonais (só bloqueia com os dois sub-caminhos) e igualdade com BMap.edgeInfo', () => {
    const mkB = () => {
      const B = fixture(12, 12);
      return { B, v: mk(B, 5, 5, 'xcom', { dir: 1 }), a: mk(B, 8, 2, 'alien') };
    };
    let { B, v, a } = mkB();
    put(B, 5, 5, 0, 2, 'FARM.wall.n'); // start.north
    t.ok(LOS.canSee(B, v, a), 'só o sub-caminho norte fechado');
    LOS.fov(B, v);
    t.eq(B.map.disc[I(B, 6, 4)] & 1, 1);
    ({ B, v, a } = mkB());
    put(B, 6, 5, 0, 1, 'FARM.wall'); // E.west
    t.ok(LOS.canSee(B, v, a), 'só o sub-caminho leste fechado');
    put(B, 5, 5, 0, 2, 'FARM.wall.n');
    t.ok(!LOS.canSee(B, v, a), 'os dois fechados');
    LOS.fov(B, v);
    t.eq(B.map.disc[I(B, 6, 4)] & 1, 0, '(6,4) escondido');
    ({ B, v, a } = mkB());
    put(B, 6, 5, 0, 3, 'FARM.tree'); // bloco inteiro no canto leste
    t.ok(LOS.canSee(B, v, a), 'árvore num canto');
    put(B, 5, 5, 0, 2, 'FARM.wall.n');
    t.ok(!LOS.canSee(B, v, a), 'árvore + parede norte');
    // aresta rápida ≡ BMap.edgeInfo em mapas gerados (com portas de OVNI abertas ao acaso)
    for (let s = 0; s < seeds; s++) {
      for (const opts of [{ ufoType: 'medium_scout', terrain: 'FARM' }, { terrain: 'URBAN' }]) {
        const G = BT.create(BT.quickMission(Object.assign({ seed: 40 + s, squadSize: 2 }, opts)));
        const m = G.map;
        const rng = OV.RNG.create(s + 1);
        for (let i = 0; i < m.n; i++) if (BM.isUfoDoor(m, i) && rng.pct(50)) m.ufoDoorOpen[i] = 1;
        let bad = 0, checked = 0;
        for (let z = 0; z < m.d; z++) {
          for (let y = 0; y < m.h; y++) {
            for (let x = 0; x < m.w; x++) {
              for (let dir = 0; dir < 8; dir++) {
                checked++;
                if (LOS.edgeLOS(G, x, y, z, dir) !== BM.edgeInfo(m, x, y, z, dir).blocked.los) bad++;
              }
            }
          }
        }
        t.eq(bad, 0, 'arestas diferentes (' + checked + ')');
      }
    }
  });

  // ---- cone e alcance ---------------------------------------------------------------------------------------
  t.test('FOV: cone de 90° exclui o que está atrás; raio 20', () => {
    const B = fixture(30, 30);
    const v = mk(B, 10, 10, 'xcom', { dir: 0 });
    const front = mk(B, 10, 5, 'alien');
    const behind = mk(B, 10, 15, 'alien');
    const edge = mk(B, 14, 6, 'alien'); // 45° exatos
    const outside = mk(B, 15, 7, 'alien');
    t.ok(LOS.canSee(B, v, behind), 'canSee não usa o cone');
    t.ok(!LOS.inCone(B, v, behind) && LOS.inCone(B, v, front) && LOS.inCone(B, v, edge) && !LOS.inCone(B, v, outside));
    const r = LOS.fov(B, v);
    t.eq(r.spotted, [front.id, edge.id].sort((p, q) => p - q));
    t.ok(!B._.sees[v.id].has(behind.id) && !B._.sees[v.id].has(outside.id));
    t.eq(B.map.disc[I(B, 10, 15)], 0, 'tile atrás não descoberto');
    t.ok(LOS.inView(B, v, front) && !LOS.inView(B, v, behind));
    // diagonal ⇒ quadrante (eixos incluídos)
    v.dir = 1;
    t.ok(LOS.inCone(B, v, mk(B, 18, 10, 'alien')) && !LOS.inCone(B, v, mk(B, 18, 11, 'alien')));
    // raio: 20 tiles exatos sim, 21 não
    const C = fixture(30, 30);
    const w = mk(C, 2, 5, 'xcom', { dir: 2 });
    const far = mk(C, 22, 5, 'alien');
    const farther = mk(C, 23, 6, 'alien');
    t.ok(LOS.canSee(C, w, far) && !LOS.canSee(C, w, farther));
    LOS.fov(C, w);
    t.eq(C.map.disc[I(C, 22, 5)] & 1, 1);
    t.eq(C.map.disc[I(C, 23, 5)] & 1, 0);
  });

  t.test('Unidades 2×2: olhos no centro do quadrado, cone a partir do centro, vistas por qualquer dos tiles', () => {
    const B = fixture(24, 24);
    const big = mk(B, 10, 10, 'alien', { size: 2, height: 24, kneelHeight: 24, dir: 2 });
    t.eq(LOS.eyeVoxel(B, big), [176, 176, 22]);
    const front = mk(B, 16, 11, 'xcom', { dir: 6 });
    const behind = mk(B, 6, 11, 'xcom', { dir: 2 });
    const r = LOS.fov(B, big);
    t.eq(r.discovered, [], 'alienígenas não descobrem');
    t.eq(r.spotted, [front.id]);
    t.ok(LOS.canSee(B, front, big) && LOS.canSee(B, behind, big));
    // parede só à frente da metade norte: a metade sul continua à vista
    put(B, 12, 10, 0, 1, 'FARM.wall');
    t.ok(LOS.canSee(B, front, big), 'vê a metade sul');
    put(B, 12, 11, 0, 1, 'FARM.wall');
    t.ok(!LOS.canSee(B, front, big), 'as duas metades tapadas');
    t.eq(LOS.spotters(B, big), [behind.id]);
    // mortos e fora do mapa nunca são vistos
    BU.removeUnitFromMap(B, behind);
    behind.status = 'dead';
    t.ok(!LOS.canSee(B, big, behind) && !LOS.canSee(B, behind, big));
    t.eq(LOS.spotters(B, big), []);
  });

  // ---- luz e escuridão -------------------------------------------------------------------------------------
  t.test('Luz: ambiente, telhado de dia, candeeiro/fogo com queda isqrt, very-light e unidade a arder', () => {
    const B = fixture(20, 20, 2, 0, [0, 0, 4, 4]);
    LOS.computeLight(B);
    t.eq(LOS.shadeAt(B, I(B, 10, 10)), 0, 'dia');
    t.eq(LOS.shadeAt(B, I(B, 2, 2)), 2, 'sob telhado de dia −2');
    t.eq(LOS.shadeAt(B, I(B, 2, 2, 1)), 0, 'o telhado em si');
    const N = fixture(20, 20, 2, 13, [0, 0, 4, 4]);
    t.eq(LOS.shadeAt(N, I(N, 10, 10)), 13, 'noite');
    t.eq(LOS.shadeAt(N, I(N, 2, 2)), 13, 'de noite o telhado não escurece mais');
    put(N, 10, 10, 0, 3, 'URBAN.lamp');
    t.eq(15 - LOS.shadeAt(N, I(N, 10, 10)), 12, 'candeeiro 12');
    t.eq(15 - LOS.shadeAt(N, I(N, 13, 10)), 9, '3 tiles');
    t.eq(15 - LOS.shadeAt(N, I(N, 13, 14)), 7, '(3,4) ⇒ isqrt(25) = 5');
    t.eq(15 - LOS.shadeAt(N, I(N, 11, 11)), 11, '(1,1) ⇒ isqrt(2) = 1');
    t.eq(15 - LOS.shadeAt(N, I(N, 13, 10, 1)), 9, 'todos os níveis');
    put(N, 10, 10, 0, 3, 'URBAN.rubbleObject');
    t.eq(LOS.shadeAt(N, I(N, 10, 10)), 13, 'candeeiro destruído (setPart ⇒ luz suja)');
    // fogo: deteção sem bandeira suja (assinatura das fontes dinâmicas)
    N.map.fire[I(N, 5, 15)] = 3;
    LOS.refreshAll(N);
    t.eq(LOS.shadeAt(N, I(N, 5, 15)), 0, 'fogo 15');
    t.eq(15 - N._.light[I(N, 5, 10)], 15 - 10, 'fogo a 5 tiles');
    N.map.fire[I(N, 5, 15)] = 0;
    LOS.refreshAll(N);
    t.eq(LOS.shadeAt(N, I(N, 5, 15)), 13, 'fogo apagado');
    // very-light no chão e unidade a arder
    const f = BU.newItem(N, 'electro_flare', { at: I(N, 15, 3) });
    LOS.refreshAll(N);
    t.eq(LOS.shadeAt(N, I(N, 15, 3)), 0, 'very-light');
    t.eq(N._.light[I(N, 15, 9)], 9, 'very-light a 6 tiles');
    f.at = null;
    f.owner = 1;
    const u = mk(N, 3, 12, 'xcom', { burn: 2 });
    LOS.refreshAll(N);
    t.eq(LOS.shadeAt(N, I(N, 15, 3)), 13, 'very-light na mão não ilumina');
    t.eq(LOS.shadeAt(N, I(N, 3, 12)), 0, 'unidade a arder');
    u.burn = 0;
    // fontes do OVNI (consolas, fonte de energia: 10)
    put(N, 18, 18, 0, 3, 'UFO.powerSource');
    t.eq(15 - LOS.shadeAt(N, I(N, 18, 18)), 10);
  });

  t.test('Escuridão: X-COM não vê para lá de 9 tiles num tile escuro; very-light ilumina; alienígenas veem sempre', () => {
    const B = fixture(30, 20, 1, 13);
    const v = mk(B, 2, 10, 'xcom', { dir: 2 });
    const a = mk(B, 14, 10, 'alien', { dir: 6 });
    t.ok(!LOS.canSee(B, v, a), '12 tiles, escuro');
    t.ok(LOS.canSee(B, a, v), 'alienígena ignora a luz');
    t.eq(LOS.fov(B, a).spotted, [v.id]);
    const near = mk(B, 5, 10, 'xcom', { dir: 2 });
    t.ok(LOS.canSee(B, near, a), '9 tiles: vê mesmo no escuro');
    t.eq(LOS.fov(B, v).spotted, [], 'fov do soldado longe');
    t.eq(LOS.fov(B, near).spotted, [a.id], 'avistado por near');
    t.eq(LOS.fov(B, near).spotted, [], 'já visível para o lado X-COM');
    t.ok(LOS.isVisibleTo(B, 'xcom', a));
    // very-light a 9 tiles do alvo: luz 15−9 = 6 ⇒ shade 9 ⇒ visível; a 10 tiles não
    const f = BU.newItem(B, 'electro_flare', { at: I(B, 23, 10) });
    t.ok(LOS.canSee(B, v, a), 'very-light a 9 tiles');
    f.at = I(B, 24, 10);
    t.ok(!LOS.canSee(B, v, a), 'very-light a 10 tiles');
    f.at = I(B, 14, 10);
    t.ok(LOS.canSee(B, v, a), 'very-light no tile do alvo');
    BU.removeUnitFromMap(B, near);
    near.status = 'dead';
    t.eq(LOS.refreshAll(B).spotted.xcom, [], 'continua visível (agora via v)');
    t.ok(B._.sees[v.id].has(a.id));
  });

  // ---- fumo -------------------------------------------------------------------------------------------------
  t.test('Fumo: cada tile custa 3 + fumo (÷3 tiles); fumo denso corta a vista; fogo anula o fumo', () => {
    const B = fixture(20, 12);
    const v = mk(B, 2, 5, 'xcom', { dir: 2 });
    const a = mk(B, 12, 5, 'alien');
    t.ok(LOS.canSee(B, v, a));
    B.map.smoke[I(B, 6, 5)] = 15;
    t.ok(LOS.canSee(B, v, a), '1 tile de fumo: 30 + 15 ≤ 60');
    B.map.smoke[I(B, 7, 5)] = 15;
    B.map.smoke[I(B, 8, 5)] = 15;
    t.ok(!LOS.canSee(B, v, a), '3 tiles de fumo: 75 > 60');
    const near = mk(B, 9, 6, 'alien');
    t.ok(LOS.canSee(B, v, near) === false || LOS.canSee(B, v, near), 'sem erro');
    const r = LOS.fov(B, v);
    t.ok(r.spotted.indexOf(a.id) < 0, 'fov respeita o fumo');
    t.eq(B.map.disc[I(B, 12, 5)] & 1, 0, 'tile depois do fumo por descobrir');
    t.eq(B.map.disc[I(B, 4, 5)] & 1, 1);
    for (const x of [6, 7, 8]) B.map.fire[I(B, x, 5)] = 2;
    t.ok(LOS.canSee(B, v, a), 'tiles a arder não contam o fumo');
    for (const x of [6, 7, 8]) B.map.fire[I(B, x, 5)] = 0;
    // em fumo fresco (15) vê-se ~3 tiles
    const C = fixture(20, 12);
    const w = mk(C, 2, 5, 'xcom', { dir: 2 });
    for (let x = 3; x < 20; x++) for (let y = 0; y < 12; y++) C.map.smoke[I(C, x, y)] = 15;
    const b3 = mk(C, 5, 5, 'alien');
    const b4 = mk(C, 6, 5, 'alien');
    t.ok(LOS.canSee(C, w, b3) && !LOS.canSee(C, w, b4), '3 tiles sim (54), 4 não (72)');
  });

  // ---- cobertura parcial ------------------------------------------------------------------------------------
  t.test('Cobertura: ajoelhado atrás de um caixote (h12) fica escondido de longe, visível de perto e de pé', () => {
    const B = fixture(24, 12);
    const v = mk(B, 1, 5, 'xcom', { dir: 2 });
    const a = mk(B, 12, 5, 'alien', { kneel: true, dir: 6 });
    put(B, 11, 5, 0, 3, 'FARM.crate');
    t.ok(!LOS.canSee(B, v, a), 'ajoelhado, 11 tiles');
    t.eq(LOS.fov(B, v).spotted, []);
    t.eq(B.map.disc[I(B, 12, 5)] & 1, 1, 'o tile do alvo é visto (o caixote não é bloco inteiro)');
    a.kneel = false;
    t.ok(LOS.canSee(B, v, a), 'de pé');
    a.kneel = true;
    const near = mk(B, 8, 5, 'xcom', { dir: 2 });
    t.ok(LOS.canSee(B, near, a), 'perto (4 tiles) vê por cima');
    t.ok(LOS.canSee(B, a, near), 'e o alvo vê o observador');
    // linha de tiro também: de longe nenhuma amostra passa o caixote
    t.eq(LOS.targetVoxel(B, v, a), null, 'sem linha de tiro de longe');
    t.ok(LOS.targetVoxel(B, near, a) !== null, 'linha de tiro de perto');
    // sebe (h12) e consola (h16): a consola tapa mesmo de pé de perto? Não: de pé (22) o topo passa a h16
    put(B, 11, 5, 0, 3, 'FARM.cabinet');
    a.kneel = false;
    t.ok(LOS.canSee(B, v, a), 'de pé atrás de armário h16');
    a.kneel = true;
    t.ok(!LOS.canSee(B, near, a), 'ajoelhado atrás de armário h16, mesmo de perto');
    // candeeiro é fino: não esconde quem está atrás
    put(B, 11, 5, 0, 3, 'URBAN.lamp');
    t.ok(LOS.canSee(B, v, a), 'candeeiro');
    // vantagem da cobertura: ajoelhado atrás do próprio caixote vê e tem linha de tiro por cima dele;
    // o alvo de pé a 10 tiles não o vê
    const C = fixture(24, 12);
    const k = mk(C, 3, 5, 'xcom', { dir: 2, kneel: true });
    const e = mk(C, 13, 5, 'alien', { dir: 6 });
    put(C, 4, 5, 0, 3, 'FARM.crate');
    t.ok(LOS.canSee(C, k, e) && LOS.targetVoxel(C, k, e) !== null, 'ajoelhado vê e atira por cima do caixote');
    t.ok(!LOS.canSee(C, e, k), 'o alienígena de pé não o vê');
    k.kneel = false;
    t.ok(LOS.canSee(C, e, k), 'de pé fica exposto');
  });

  // ---- níveis -----------------------------------------------------------------------------------------------
  t.test('Níveis: chãos tapam entre níveis; do beiral do telhado vê-se o chão; base alienígena com teto', () => {
    const B = fixture(16, 12, 2, 0, [0, 0, 5, 11]);
    const roof = mk(B, 5, 5, 'xcom', { z: 1, dir: 2 });
    const below = mk(B, 3, 5, 'alien');
    const ground = mk(B, 10, 5, 'alien');
    t.ok(LOS.canSee(B, roof, ground), 'do telhado vê o chão a leste');
    t.ok(LOS.canSee(B, ground, roof), 'e é visto');
    t.ok(!LOS.canSee(B, roof, below), 'debaixo do telhado não');
    const r = LOS.fov(B, roof);
    t.eq(r.spotted, [ground.id]);
    t.eq(B.map.disc[I(B, 10, 5, 0)] & 1, 1, 'chão a leste descoberto');
    t.eq(B.map.disc[I(B, 4, 5, 0)] & 1, 0, 'tile sob o telhado por descobrir');
    t.eq(B.map.disc[I(B, 9, 5, 1)] & 1, 1, 'ar ao nível do observador');
    // do chão não se vê o tile do telhado diretamente por cima (chão do nível 1)
    const C = fixture(16, 12, 2, 0, [4, 4, 6, 6]);
    const w = mk(C, 5, 9, 'xcom', { dir: 0 });
    LOS.fov(C, w);
    t.eq(C.map.disc[I(C, 5, 9, 1)] & 1, 1, 'ar por cima do observador');
    t.eq(C.map.disc[I(C, 5, 2, 0)] & 1, 1, 'chão em frente');
    // tiro para cima acerta o telhado (chão do nível 1); de fora do beiral passa por cima dele
    const sh = mk(C, 5, 7, 'xcom', { dir: 0 });
    let s = LOS.traceShot(C, LOS.eyeVoxel(C, sh), [5 * 16 + 8, 5 * 16 + 8, 24 + 10], sh.id);
    t.eq([s.kind, s.part, s.i], ['floor', 0, I(C, 5, 6, 1)], 'acerta o chão do telhado');
    t.ok(s.voxel[2] - 24 < 2);
    s = LOS.traceShot(C, LOS.eyeVoxel(C, w), [5 * 16 + 8, 5 * 16 + 8, 24 + 10], w.id);
    t.eq(s.kind, 'none', 'sobe fora do telhado e passa por cima');
    // teto: base alienígena (d=2) não deixa ver nem atirar acima de z0
    const A = fixture(12, 12, 2);
    A.map.ceiling = true;
    const p = mk(A, 2, 5, 'xcom', { dir: 2 });
    const q = mk(A, 6, 5, 'alien', { z: 1 });
    t.ok(!LOS.canSee(A, p, q));
    LOS.fov(A, p);
    let up = 0;
    for (let i = A.map.plane; i < A.map.n; i++) up += A.map.disc[i];
    t.eq(up, 0, 'nada descoberto em z1');
    t.eq(LOS.traceShot(A, LOS.eyeVoxel(A, p), [100, 88, 40], p.id).kind, 'out');
  });

  // ---- descoberta ---------------------------------------------------------------------------------------------
  t.test('Descoberta: tile visto |7, vizinho leste |2, vizinho sul |4; só observadores X-COM; visTiles', () => {
    const B = fixture(12, 12);
    const v = mk(B, 2, 5, 'xcom', { dir: 2 });
    put(B, 6, 5, 0, 1, 'FARM.wall');
    for (let y = 0; y < 12; y++) if (y !== 5) put(B, 6, y, 0, 1, 'FARM.wall');
    const r = LOS.fov(B, v);
    t.eq(B.map.disc[I(B, 5, 5)], 7);
    t.eq(B.map.disc[I(B, 6, 5)], 2, 'só a parede oeste do tile a leste');
    t.ok(r.discovered.indexOf(I(B, 6, 5)) >= 0 && r.discovered.indexOf(I(B, 5, 5)) >= 0);
    t.eq(r.discovered.slice().sort((p, q) => p - q), r.discovered, 'ordenados');
    t.eq(B._.visTiles[I(B, 5, 5)], 1);
    t.eq(B._.visTiles[I(B, 6, 5)], 0);
    // sul: tile sob o último tile visto
    const C = fixture(12, 12);
    const w = mk(C, 5, 2, 'xcom', { dir: 4 });
    for (let x = 0; x < 12; x++) put(C, x, 6, 0, 2, 'FARM.wall.n');
    LOS.fov(C, w);
    t.eq(C.map.disc[I(C, 5, 5)], 7);
    t.eq(C.map.disc[I(C, 5, 6)], 4, 'só a parede norte do tile a sul');
    t.eq(LOS.fov(C, w).discovered, [], 'nada de novo na segunda vez');
    // alienígenas não descobrem
    const A = fixture(12, 12);
    mk(A, 2, 5, 'alien', { dir: 2 });
    LOS.refreshAll(A);
    t.ok(A.map.disc.every((x) => x === 0));
    t.ok(A._.visTiles.every((x) => x === 0));
    // visTiles = união dos soldados vivos
    const V = fixture(20, 20);
    const s1 = mk(V, 2, 2, 'xcom', { dir: 4 });
    const s2 = mk(V, 17, 17, 'xcom', { dir: 0 });
    LOS.refreshAll(V);
    t.ok(V._.visTiles[I(V, 2, 6)] === 1 && V._.visTiles[I(V, 17, 13)] === 1);
    BU.removeUnitFromMap(V, s2);
    s2.status = 'dead';
    LOS.refreshAll(V);
    t.ok(V._.visTiles[I(V, 2, 6)] === 1 && V._.visTiles[I(V, 17, 13)] === 0, 'morto deixa de ver');
    t.eq(V.map.disc[I(V, 17, 13)], 7, 'a descoberta fica');
    t.ok(s1);
  });

  // ---- visibilidade por lado ----------------------------------------------------------------------------------
  t.test('Visibilidade: sees, uniões por lado, spotted só uma vez, turnsSinceSpotted, refreshTarget, resetSide', () => {
    const B = fixture(24, 16);
    const s = mk(B, 2, 8, 'xcom', { dir: 2 });
    const c = mk(B, 4, 9, 'civ', { dir: 2 });
    const a = mk(B, 10, 8, 'alien', { dir: 6 });
    const hid = mk(B, 20, 2, 'alien', { dir: 6 });
    for (let y = 0; y < 6; y++) put(B, 18, y, 0, 1, 'FARM.wall');
    let r = LOS.refreshAll(B);
    t.eq(r.spotted.xcom, [a.id], 'X-COM vê o alienígena');
    t.eq(r.spotted.alien.sort((p, q) => p - q), [s.id, c.id].sort((p, q) => p - q), 'alienígena vê soldado e civil');
    t.eq(r.spotted.civ, [a.id]);
    t.ok(B._.sees[s.id].has(c.id) || !B._.sees[s.id].has(c.id), 'civil pode estar em sees');
    t.eq(LOS.unitsVisibleTo(B, 'xcom', true), [a.id]);
    t.ok(LOS.unitsVisibleTo(B, 'xcom').indexOf(a.id) >= 0);
    t.eq(LOS.unitsVisibleTo(B, 'alien', true), [s.id, c.id].sort((p, q) => p - q));
    t.ok(LOS.isVisibleTo(B, 'xcom', a) && !LOS.isVisibleTo(B, 'xcom', hid) && LOS.isVisibleTo(B, 'xcom', s));
    t.ok(B._.visUnits === B._.visible.xcom);
    t.eq([a.turnsSinceSpotted, s.turnsSinceSpotted, hid.turnsSinceSpotted], [0, 0, 255]);
    r = LOS.refreshAll(B);
    t.eq([r.spotted.xcom, r.spotted.alien, r.spotted.civ], [[], [], []], 'nada novo');
    t.eq(LOS.fov(B, s).spotted, []);
    // o alienígena escondido sai de trás da parede
    moveTo(B, hid, 14, 4);
    let m = LOS.refreshTarget(B, hid);
    t.ok(m.seenBy.indexOf(s.id) >= 0 && m.newlyVisibleTo.indexOf('xcom') >= 0);
    t.ok(LOS.isVisibleTo(B, 'xcom', hid) && hid.turnsSinceSpotted === 0);
    t.eq(LOS.spotters(B, hid, 'xcom'), [s.id]);
    // volta a esconder-se
    moveTo(B, hid, 20, 2);
    m = LOS.unitMoved(B, hid);
    t.eq(m.seenBy, []);
    t.ok(!LOS.isVisibleTo(B, 'xcom', hid));
    // o soldado vira-se: deixa de ver; o lado deixa de ver
    s.dir = 6;
    t.eq(LOS.fov(B, s).spotted, []);
    t.ok(!LOS.isVisibleTo(B, 'xcom', a), 'ninguém do lado X-COM vê');
    s.dir = 2;
    t.eq(LOS.fov(B, s).spotted, [a.id], 'avistado de novo');
    // início do turno: esconde e recalcula ⇒ spotted outra vez
    LOS.resetSide(B, 'xcom');
    t.ok(!LOS.isVisibleTo(B, 'xcom', a));
    t.eq(LOS.refreshAll(B).spotted.xcom, [a.id]);
    // morte: refreshTarget tira-o de todos os sees
    BU.removeUnitFromMap(B, a);
    a.status = 'dead';
    LOS.refreshTarget(B, a);
    t.ok(!LOS.isVisibleTo(B, 'xcom', a) && !B._.sees[s.id].has(a.id));
    t.eq(LOS.unitsVisibleTo(B, 'xcom', true), []);
    // amigos sempre visíveis; canSeeFrom avalia outra posição
    t.ok(LOS.canSee(B, s, c));
    t.ok(!LOS.canSeeFrom(B, s, I(B, 2, 8), hid) && LOS.canSeeFrom(B, s, I(B, 19, 6), hid));
    t.ok(s.x === 2 && s.y === 8, 'canSeeFrom não mexe na unidade');
  });

  // ---- tiros ----------------------------------------------------------------------------------------------------
  t.test('traceShot: parede oeste/norte, objeto, unidade, chão, fora do mapa, nada, prolongamento', () => {
    const B = fixture(16, 16, 2);
    const s = mk(B, 2, 8, 'xcom', { dir: 2 });
    const eye = LOS.eyeVoxel(B, s);
    t.eq(eye, [40, 136, 20]);
    t.eq(LOS.originVoxel(B, s, [200, 136, 20]), [44, 136, 20], 'boca da arma 4 voxels à frente');
    // parede oeste
    put(B, 6, 8, 0, 1, 'FARM.wall');
    let r = LOS.traceShot(B, eye, [200, 136, 20], s.id);
    t.eq([r.kind, r.i, r.part, r.unitId, r.voxel], ['west', I(B, 6, 8), 1, null, [96, 136, 20]]);
    put(B, 6, 8, 0, 1, null);
    // parede norte (tiro para norte)
    put(B, 2, 5, 0, 2, 'FARM.wall.n');
    r = LOS.traceShot(B, eye, [40, 20, 20], s.id);
    t.eq([r.kind, r.i, r.part], ['north', I(B, 2, 5), 2]);
    t.eq(r.voxel[1], 5 * 16 + 1, 'face sul da parede norte (ly 1)');
    // objeto: caixote h12 apanha tiro baixo, deixa passar o alto
    put(B, 6, 8, 0, 3, 'FARM.crate');
    r = LOS.traceShot(B, [40, 136, 8], [200, 136, 8], s.id);
    t.eq([r.kind, r.i, r.part, r.voxel], ['object', I(B, 6, 8), 3, [98, 136, 8]]);
    r = LOS.traceShot(B, [40, 136, 13], [200, 136, 13], s.id);
    t.eq(r.kind, 'none', 'por cima do caixote');
    t.eq(r.voxel, [200, 136, 13], 'pára no destino');
    put(B, 6, 8, 0, 3, 'FARM.tree');
    r = LOS.traceShot(B, [40, 136, 20], [200, 136, 20], s.id);
    t.eq([r.kind, r.voxel[0]], ['object', 96], 'bloco inteiro ocupa o tile todo');
    put(B, 6, 8, 0, 3, null);
    // unidade: cilindro raio 5, altura da postura; o atirador é ignorado
    const a = mk(B, 9, 8, 'alien');
    r = LOS.traceShot(B, eye, [200, 136, 20], s.id);
    t.eq([r.kind, r.unitId, r.i, r.voxel], ['unit', a.id, I(B, 9, 8), [147, 136, 20]]);
    t.eq(LOS.traceShot(B, eye, [200, 136, 20], [s.id, a.id]).kind, 'none', 'ignora uma lista');
    t.eq(LOS.traceShot(B, eye, [200, 136, 20], new Set([s.id, a.id])).kind, 'none', 'ignora um Set');
    t.eq(LOS.traceShot(B, eye, [200, 142, 20], s.id).unitId, a.id, 'na borda do cilindro');
    t.eq(LOS.traceShot(B, [40, 130, 20], [200, 130, 20], s.id).kind, 'none', '6 voxels ao lado do centro');
    a.kneel = true;
    t.eq(LOS.traceShot(B, eye, [200, 136, 20], s.id).kind, 'none', 'ajoelhado (14): tiro a 20 passa por cima');
    t.eq(LOS.traceShot(B, [40, 136, 10], [200, 136, 10], s.id).unitId, a.id);
    a.kneel = false;
    t.eq(LOS.traceShot(B, eye, [200, 136, 20]).unitId, s.id, 'sem ignorar acerta no próprio atirador');
    // chão: a descer
    r = LOS.traceShot(B, eye, [120, 136, 0], s.id);
    t.eq([r.kind, r.part, r.i], ['floor', 0, I(B, 7, 8)]);
    t.ok(r.voxel[2] < 2);
    // fora do mapa e prolongamento
    BU.removeUnitFromMap(B, a);
    r = LOS.traceShot(B, eye, [56, 136, 20], s.id, 30);
    t.eq([r.kind, r.voxel], ['out', [255, 136, 20]], 'prolongado até à borda');
    r = LOS.traceShot(B, eye, [56, 136, 20], s.id, 3);
    t.eq([r.kind, r.voxel], ['none', [88, 136, 20]], 'corta em maxTiles·16 voxels');
    put(B, 12, 8, 0, 1, 'FARM.wall');
    r = LOS.traceShot(B, eye, [56, 136, 20], s.id, 30);
    t.eq([r.kind, r.i], ['west', I(B, 12, 8)], 'tiro falhado continua e acerta mais longe');
    r = LOS.traceShot(B, eye, eye, s.id);
    t.eq([r.kind, r.voxel], ['none', eye], 'origem = destino');
    // unidade grande: raio 12 à volta do centro 2×2
    const C = fixture(16, 16);
    const big = mk(C, 8, 8, 'alien', { size: 2, height: 24, kneelHeight: 24 });
    for (const tile of BU.unitTiles(big, C.map)) t.eq(C._.unitAt[tile], big.id + 1);
    t.eq(LOS.traceShot(C, [40, 144, 12], [250, 144, 12], null).voxel, [132, 144, 12], 'centro 144 − 12');
    t.eq(LOS.traceShot(C, [40, 133, 12], [250, 133, 12], null).kind, 'unit');
    t.eq(LOS.traceShot(C, [40, 131, 12], [250, 131, 12], null).kind, 'none');
  });

  t.test('targetVoxel/lineClear: linha de tiro com unidades no caminho e alvos em tiles', () => {
    const B = fixture(16, 16);
    const s = mk(B, 2, 8, 'xcom', { dir: 2 });
    const a = mk(B, 10, 8, 'alien');
    let v = LOS.targetVoxel(B, s, a);
    t.eq(v, [168, 136, 11], 'primeiro o meio do alvo');
    t.ok(LOS.lineClear(B, LOS.originVoxel(B, s, v), v, [s.id, a.id]));
    t.ok(!LOS.lineClear(B, LOS.originVoxel(B, s, v), v, [s.id]), 'o próprio alvo está no caminho');
    const blocker = mk(B, 6, 8, 'xcom');
    t.eq(LOS.targetVoxel(B, s, a), null, 'colega de pé à frente');
    blocker.kneel = true;
    v = LOS.targetVoxel(B, s, a);
    t.eq(v, [168, 136, 11], 'por cima do colega ajoelhado');
    blocker.height = 22;
    blocker.kneelHeight = 19;
    t.eq(LOS.targetVoxel(B, s, a), [168, 136, 18], 'só o topo passa');
    BU.removeUnitFromMap(B, blocker);
    put(B, 6, 8, 0, 1, 'FARM.wall');
    t.eq(LOS.targetVoxel(B, s, a), null, 'parede');
    put(B, 6, 8, 0, 1, null);
    // alvo em tile: chão livre, objeto, parede do próprio tile
    v = LOS.targetVoxel(B, s, I(B, 12, 10));
    t.eq(v, [12 * 16 + 8, 10 * 16 + 8, 1], 'chão do tile');
    put(B, 12, 10, 0, 3, 'FARM.crate');
    t.eq(LOS.targetVoxel(B, s, I(B, 12, 10)), [200, 168, 6], 'meio do objeto');
    t.eq(LOS.targetVoxel(B, s, I(B, 10, 8)), LOS.targetVoxel(B, s, a), 'tile com unidade ⇒ a unidade');
    for (let y = 0; y < 16; y++) put(B, 5, y, 0, 1, 'FARM.wall');
    t.eq(LOS.targetVoxel(B, s, I(B, 12, 10)), null, 'atrás de uma parede');
    const w = LOS.targetVoxel(B, s, I(B, 5, 8));
    t.ok(w !== null, 'a parede do próprio tile é alvo válido');
  });

  // ---- determinismo e desempenho ----------------------------------------------------------------------------
  t.test('Determinismo: mesma batalha ⇒ mesma visibilidade, descoberta e hash', () => {
    for (let s = 0; s < seeds; s++) {
      const mi = BT.quickMission({ ufoType: 'abductor', terrain: 'FARM', seed: 70 + s, night: s % 2 === 1, squadSize: 8 });
      const A = BT.create(mi), C = BT.create(mi);
      const ra = LOS.refreshAll(A), rc = LOS.refreshAll(C);
      t.eq(ra, rc, 'resultado');
      t.eq(BT.hash(A), BT.hash(C), 'hash');
      t.eq(A.map.disc, C.map.disc);
      t.eq(A._.light, C._.light);
      for (const side of ['xcom', 'alien', 'civ']) t.eq(LOS.unitsVisibleTo(A, side), LOS.unitsVisibleTo(C, side));
      // idempotente e independente do caminho incremental
      const h = BT.hash(A);
      const r2 = LOS.refreshAll(A);
      t.eq(r2.spotted, { xcom: [], alien: [], civ: [] });
      t.eq(r2.discovered, []);
      t.eq(BT.hash(A), h);
      for (const u of C.units) if (u.onMap && u.status === 'ok') LOS.unitMoved(C, u);
      for (const side of ['xcom', 'alien', 'civ']) t.eq(LOS.unitsVisibleTo(C, side), LOS.unitsVisibleTo(A, side), 'incremental ≡ total ' + side);
      // gravar/carregar: derivados reconstruídos dão o mesmo
      const R = BT.deserialize(JSON.parse(JSON.stringify(BT.serialize(A))));
      LOS.refreshAll(R);
      t.eq(BT.hash(R), BT.hash(A));
      for (const side of ['xcom', 'alien', 'civ']) t.eq(LOS.unitsVisibleTo(R, side), LOS.unitsVisibleTo(A, side));
    }
  });

  t.test('Desempenho: refreshAll de 18 unidades em 50×50×3 < 15 ms; fov de uma unidade < 2 ms', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'battleship', terrain: 'FARM', seed: 5, squadSize: 10 }));
    t.eq([B.map.w, B.map.h, B.map.d], [50, 50, 3]);
    let live = 0;
    for (const u of B.units) {
      if (!(u.onMap && u.status === 'ok')) continue;
      if (live >= 18) BU.removeUnitFromMap(B, u);
      else live++;
    }
    t.eq(live, 18);
    // de noite com very-lights e fumo para exercitar tudo
    B.mission.shade = 13;
    for (let i = 0; i < B.map.n; i += 37) B.map.smoke[i] = 8;
    LOS.refreshAll(B);
    const now = () => Number(process.hrtime.bigint()) / 1e6;
    let best = 1e9;
    for (let k = 0; k < 8; k++) {
      B._.dirty.light = true;
      const t0 = now();
      LOS.refreshAll(B);
      best = Math.min(best, now() - t0);
    }
    t.ok(best < 15, 'refreshAll ' + best.toFixed(2) + ' ms');
    const soldier = B.units.find((u) => u.side === 'xcom' && u.onMap);
    let bestF = 1e9;
    for (let k = 0; k < 20; k++) {
      soldier.dir = k & 7;
      const t0 = now();
      LOS.fov(B, soldier);
      bestF = Math.min(bestF, now() - t0);
    }
    t.ok(bestF < 2, 'fov ' + bestF.toFixed(2) + ' ms');
    let bestL = 1e9;
    for (let k = 0; k < 5; k++) {
      const t0 = now();
      LOS.computeLight(B);
      bestL = Math.min(bestL, now() - t0);
    }
    t.ok(bestL < 3, 'computeLight ' + bestL.toFixed(2) + ' ms');
    if (t.args.perf) console.log('  refreshAll ' + best.toFixed(2) + ' ms · fov ' + bestF.toFixed(2) + ' ms · luz ' + bestL.toFixed(2) + ' ms');
  });
};
