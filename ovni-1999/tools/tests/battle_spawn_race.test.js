/* Criação da batalha (js/sim/battle/battle.js): segurança da desova alienígena verificada pelo próprio spawnAlien
   (BUnits.spawnAllowed + distância mínima à nave = TUNE.SPAWN_SAFE_DIST) e raça dos locais de terror da batalha rápida
   pelo calendário da campanha (Data.raceSchedule.alien_terror). Também a iluminação da base alienígena e de Marte
   (penumbra: a X-COM vê) e as guarnições afinadas pelo varrimento. */
module.exports = function (OV, t) {
  const BT = OV.Battle, BU = OV.BUnits, D = OV.Data, TU = OV.TUNE;

  // distância de Chebyshev aos inícios X-COM no mesmo nível ou a ±1 (como BUnits.spawnAllowed)
  function startDist(B, u) {
    let d = 1e9;
    for (const i of B.xcomStarts) {
      const [x, y, z] = OV.BMap.xyz(B.map, i);
      if (Math.abs(z - u.z) > 1) continue;
      for (let dy = 0; dy < (u.size || 1); dy++) for (let dx = 0; dx < (u.size || 1); dx++) d = Math.min(d, Math.max(Math.abs(u.x + dx - x), Math.abs(u.y + dy - y)));
    }
    return d;
  }

  t.test('desova: distância mínima à nave = SPAWN_SAFE_DIST e nenhum alienígena perto dos inícios X-COM', () => {
    t.eq(TU.SPAWN_SAFE_DIST, 10);
    t.eq(TU.SPAWN_TERROR_DIST, 14);
    let n = 0, near = 0;
    for (let s = 1; s <= 6; s++) {
      for (const o of [{ ufoType: 'abductor', terrain: 'FARM' }, { kind: 'terror' }, { kind: 'alienBase' }]) {
        const B = BT.create(BT.quickMission(Object.assign({ seed: s * 37, difficulty: 2, month: 3 }, o)));
        for (const u of B.units) {
          if (u.side !== 'alien' || !u.onMap) continue;
          n++;
          // os tripulantes dentro do OVNI podem estar mais perto (o casco protege); os restantes respeitam o limiar
          const node = B.nodes[u.ai.node];
          if (node && node.inside) continue;
          if (startDist(B, u) < 6) near++;
        }
      }
    }
    t.ok(n > 100, 'alienígenas colocados: ' + n);
    t.eq(near, 0, 'nenhum alienígena exterior a menos de 6 tiles dos inícios');
  });

  t.test('desova: spawnAllowed só restringe na preparação e só alienígenas fora do mapa', () => {
    const B = BT.create(BT.quickMission({ kind: 'alienBase', seed: 5, difficulty: 1 }));
    const a = B.units.find((u) => u.side === 'alien' && u.onMap);
    const start = B.xcomStarts[0];
    t.ok(BU.spawnAllowed(B, a, start), 'unidade já no mapa: sem restrição');
    const probe = Object.assign({}, a, { onMap: false });
    B.phase = 'setup';
    t.ok(!BU.spawnAllowed(B, probe, start), 'na preparação não desova em cima dos inícios');
    B.phase = 'play';
    t.ok(BU.spawnAllowed(B, probe, start), 'fora da preparação: sem restrição');
  });

  t.test('batalha rápida: raça do terror pelo calendário da campanha (raceSchedule.alien_terror)', () => {
    for (const month of [0, 1, 2, 5]) {
      const w = D.raceWeights('alien_terror', month);
      const seen = {};
      for (let s = 1; s <= 40; s++) {
        const m = BT.quickMission({ kind: 'terror', month, seed: s });
        t.ok(w[m.race] > 0, 'mês ' + month + ': ' + m.race + ' está no calendário');
        seen[m.race] = 1;
      }
      t.ok(Object.keys(seen).length >= Math.min(2, Object.keys(w).length), 'mês ' + month + ': variedade ' + Object.keys(seen).join(','));
    }
    t.eq(BT.quickMission({ kind: 'terror', month: 1, seed: 3, race: 'muton' }).race, 'muton', 'raça pedida respeitada');
    // OVNIs continuam com a tabela da batalha rápida (sem Mutões no mês 0)
    for (let s = 1; s <= 30; s++) t.ok(['sectoid', 'floater'].indexOf(BT.quickMission({ ufoType: 'small_scout', month: 0, seed: s }).race) >= 0);
  });

  t.test('base alienígena e Marte na penumbra: a X-COM vê (sombra ≤ DARK_SHADE); noite continua escura', () => {
    t.ok(TU.SHADE_ALIEN_BASE <= TU.DARK_SHADE && TU.SHADE_MARS <= TU.DARK_SHADE);
    for (const kind of ['alienBase', 'cydonia']) {
      const M = BT.normalizeMission({ kind });
      t.eq([M.night, M.shade > 0], [false, true], kind);
    }
    t.ok(BT.normalizeMission({ ufoType: 'small_scout', night: true }).night, 'noite');
  });

  t.test('guarnições afinadas: terror, base alienígena e Cidónia por dificuldade; armamento por mês', () => {
    t.eq([0, 1, 2].map((d) => { const r = D.deploymentRange('dep_terror_site', d); return [r.min, r.max]; }), [[5, 5], [5, 7], [7, 9]]);
    t.eq([0, 1, 2].map((d) => { const r = D.deploymentRange('dep_alien_base', d); return [r.min, r.max]; }), [[8, 8], [8, 9], [11, 12]]);
    t.eq([0, 1, 2].map((d) => { const r = D.deploymentRange('dep_cydonia', d); return [r.min, r.max]; }), [[7, 7], [9, 9], [14, 14]]);
    t.eq(D.alienItemTiers.byMonth, [[90, 10, 0], [70, 25, 5], [45, 40, 15], [30, 50, 20], [0, 30, 70]]);
    const cmd = D.alienItemTiers.extras.find((e) => e.ranks.indexOf('commander') >= 0);
    t.eq([cmd.pct, cmd.replace[0]], [25, 'blaster_launcher']);
  });
};
