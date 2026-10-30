/* Testes de moral, pânico, berserk, psiónica e experiência: js/sim/battle/morale.js
   (DESIGN.md §3.10, §3.2; REA 03 §6, §1.2–1.5) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const M = OV.Morale;
  const id = (k) => D.tileId(k);

  // mapa aberto w×h×1 de chão FARM, de dia
  function fixture(w, h, seed) {
    const m = BM.create(w || 12, h || 12, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = id('FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', aborted: false, pendingBerserk: [],
      mission: { kind: 'crash', difficulty: 0, shade: 0, deploymentId: 'dep_small_scout' }, rng: OV.RNG.streams(seed || 7),
    };
    BT.rebuildDerived(B);
    return B;
  }
  // Veterano: perdas de moral orig e sem pausa no pânico (Recruta: MORALE_LOSS_PCT 50, PANIC_COOLDOWN_TURNS 1)
  function fixtureVet(w, h, seed) {
    const B = fixture(w, h, seed);
    B.mission.difficulty = 1;
    return B;
  }
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  const tileOf = (B, u) => BU.unitTile(B, u);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'S' + sid++, name: 'Teste', nat: 'pt', rank: opt.rank | 0, armour: 'coveralls',
      stats: Object.assign({ tu: 60, sta: 60, hp: 35, brav: 30, react: 50, fire: 60, thr: 60, str: 35, melee: 30, psiStr: 40, psiSkill: 0 }, opt.stats),
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: null, L: null, belt: [], pack: [] });
    BU.placeUnit(B, u, I(B, x, y));
    return u;
  }
  function alien(B, type, x, y) {
    const u = BU.fromAlien(B, type, 0, B.rng.map, 'dep_small_scout');
    BU.placeUnit(B, u, I(B, x, y));
    return u;
  }
  // RNG com valores pré-definidos (verifica que cada valor cabe no intervalo pedido)
  function scripted(vals) {
    const q = vals.slice();
    const r = {
      int(a, b) {
        if (!q.length) throw new Error('RNG roteirizado esgotado (pedido [' + a + ',' + b + '])');
        const v = q.shift();
        if (v < Math.min(a, b) || v > Math.max(a, b)) throw new Error('valor ' + v + ' fora de [' + a + ',' + b + ']');
        return v;
      },
      pct(p) { return r.int(0, 99) < p; },
      left: () => q.length,
    };
    return r;
  }
  const drain = (gen) => {
    const evs = [];
    let r;
    while (!(r = gen.next()).done) evs.push(r.value);
    return { evs, ret: r.value };
  };
  function withAct(act, fn) {
    const saved = OV.Act;
    OV.Act = act;
    try {
      return fn();
    } finally {
      OV.Act = saved;
    }
  }
  const RIFLE = { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] };

  // ---- modificadores ------------------------------------------------------------------------------------
  t.test('Moral: liderança pela patente mais alta consciente (vítima excluída); aliens 100', () => {
    const B = fixture();
    t.eq(M.leaderMod(B, 'xcom'), 100, 'sem soldados');
    soldier(B, 1, 1, { rank: 0 });
    t.eq(M.leaderMod(B, 'xcom'), 100, 'recruta');
    soldier(B, 2, 1, { rank: 1 });
    t.eq(M.leaderMod(B, 'xcom'), 100, 'soldado');
    const exp = [110, 115, 125, 150];
    const units = [];
    for (let r = 2; r <= 5; r++) {
      units.push(soldier(B, r + 1, 1, { rank: r }));
      t.eq(M.leaderMod(B, 'xcom'), exp[r - 2], 'patente ' + r);
    }
    const cmd = units[3];
    t.eq(M.leaderMod(B, 'xcom', cmd), 125, 'comandante excluído (unidade)');
    t.eq(M.leaderMod(B, 'xcom', cmd.id), 125, 'comandante excluído (id)');
    cmd.status = 'dead';
    t.eq(M.leaderMod(B, 'xcom'), 125, 'morto não lidera');
    cmd.status = 'out';
    t.eq(M.leaderMod(B, 'xcom'), 125, 'inconsciente não lidera');
    t.eq([M.leaderMod(B, 'alien'), M.leaderMod(B, 'civ')], [100, 100]);
    // peso da patente da vítima e fator B
    t.eq([0, 1, 2, 3, 4, 5].map((r) => M.rankWeight({ side: 'xcom', type: 'soldier', rank: r })), [100, 100, 120, 130, 150, 175]);
    t.eq(M.rankWeight({ side: 'alien', type: 'sectoid_leader', rank: 'leader' }), 100);
    t.eq([10, 30, 50, 80, 100, 110].map((b) => M.bravFactor({ stats: { brav: b } })), [10, 8, 6, 3, 1, 0]);
  });

  t.test('Moral: dano −100·(p·B/10)/teamMod, feridas −n, grandes imunes, limite 0', () => {
    const B = fixtureVet();
    const u = soldier(B, 1, 1, { stats: { brav: 30 } });
    let ev = M.onHit(B, u, 15);
    t.eq(u.morale, 88, 'B=8, p=15, sem líder: −12');
    t.eq(ev, [{ t: 'morale', kind: 'change', unitId: u.id, delta: -12, morale: 88 }]);
    soldier(B, 2, 1, { rank: 5 });
    M.onHit(B, u, 15);
    t.eq(u.morale, 80, 'com comandante: 1200/150 = 8');
    M.onHit(B, u, 3);
    t.eq(u.morale, 79, 'p=3: (3·8/10)=2 → 200/150 = 1');
    t.eq(M.onHit(B, u, 0), [], 'sem dano');
    const s = alien(B, 'sectoid_soldier', 8, 8);
    M.onHit(B, s, 20);
    t.eq(s.morale, 94, 'sectóide B=3: 20·3/10 = 6, mod 100');
    const disc = alien(B, 'cyberdisc', 5, 5);
    t.eq(M.onHit(B, disc, 50), [], 'disco 2×2 imune');
    t.eq(disc.morale, 100);
    M.onHit(B, u, 1000);
    t.eq(u.morale, 0, 'limitado a 0');
    u.morale = 50;
    t.eq(M.onWounds(B, u, 2)[0].delta, -2);
    t.eq(u.morale, 48);
    t.eq(M.onWounds(B, disc, 3), []);
  });

  t.test('Moral: morte de recruta −16 e de comandante −28 (Bravura 30, sem líder)', () => {
    const B = fixtureVet();
    const a = soldier(B, 1, 1, { stats: { brav: 30 } });
    const b = soldier(B, 2, 1, { stats: { brav: 30 } });
    const v = soldier(B, 3, 1);
    v.status = 'dead';
    M.onDeath(B, v, null);
    t.eq([a.morale, b.morale], [84, 84], 'recruta');
    const B2 = fixtureVet();
    const o = soldier(B2, 1, 1, { stats: { brav: 30 } });
    const cmd = soldier(B2, 2, 1, { rank: 5 });
    M.onDeath(B2, cmd, null); // ainda 'ok': a vítima nunca conta como líder
    t.eq(o.morale, 72, 'comandante: 175·200·8/100/100');
    // sargento morto com um capitão presente: 120·200·8/115/100 = 16; Bravura 100 ⇒ B=1
    const B3 = fixtureVet();
    const p = soldier(B3, 1, 1, { stats: { brav: 30 } });
    const brave = soldier(B3, 4, 1, { stats: { brav: 100 } });
    soldier(B3, 2, 1, { rank: 3 });
    const sgt = soldier(B3, 3, 1, { rank: 2 });
    sgt.status = 'dead';
    M.onDeath(B3, sgt, null);
    t.eq(p.morale, 84, 'sargento com capitão');
    t.eq(brave.morale, 98, 'Bravura 100: 120·200·1/115/100 = 2');
  });

  t.test('Moral: inimigo morto, assassino, fogo amigo, civis, grandes imunes, assassino conhecido', () => {
    const B = fixtureVet();
    const sgt = soldier(B, 1, 1, { rank: 2 }); // líder 110
    const k = soldier(B, 2, 1);
    const al = alien(B, 'sectoid_soldier', 8, 8);
    const al2 = alien(B, 'sectoid_soldier', 9, 8);
    const disc = alien(B, 'cyberdisc', 5, 5);
    const civ = BU.fromCivilian(B, 'civilian_m', B.rng.map);
    BU.placeUnit(B, civ, I(B, 6, 9));
    for (const u of [k, al, disc, civ]) u.morale = 50;
    al2.status = 'dead';
    M.onDeath(B, al2, k.id);
    t.eq(k.morale, 50 + 22 + 11, 'assassino: +20·110/100 e +10·110/100 da equipa vencedora');
    t.eq(sgt.morale, 100, 'limite 100');
    t.eq(al.morale, 44, 'aliens perdem 100·200·3/100/100 = 6');
    t.eq(disc.morale, 50, 'disco imune');
    t.eq(civ.morale, 61, 'civis ficam do lado vencedor');
    t.eq(k.turnsSinceSpotted, 0, 'assassino de alien fica conhecido');
    // fogo amigo: −2000/mod e ainda a perda da equipa
    const B2 = fixtureVet();
    const s1 = soldier(B2, 1, 1, { stats: { brav: 30 } });
    const s2 = soldier(B2, 2, 1);
    s2.status = 'dead';
    M.onDeath(B2, s2, s1.id);
    t.eq(s1.morale, 100 - 20 - 16);
    const B3 = fixtureVet();
    const s3 = soldier(B3, 1, 1, { stats: { brav: 30 } });
    soldier(B3, 3, 3, { rank: 5 });
    const s4 = soldier(B3, 2, 1);
    s4.status = 'dead';
    M.onDeath(B3, s4, s3.id);
    t.eq(s3.morale, 100 - 13 - 10, 'com comandante: −2000/150 e −16000·…/150');
    // civis: X-COM −1000/mod, alien +10; sem efeito na equipa
    const B4 = fixtureVet();
    const x = soldier(B4, 1, 1);
    const y = soldier(B4, 2, 1);
    const a = alien(B4, 'sectoid_soldier', 8, 8);
    a.morale = 50;
    const c1 = BU.fromCivilian(B4, 'civilian_f', B4.rng.map);
    BU.placeUnit(B4, c1, I(B4, 5, 5));
    c1.status = 'dead';
    M.onDeath(B4, c1, x.id);
    t.eq([x.morale, y.morale, a.morale], [90, 100, 50]);
    M.onDeath(B4, c1, a.id);
    t.eq(a.morale, 60, 'alien que mata civil +10');
    soldier(B4, 3, 1, { rank: 4 });
    x.morale = 50;
    M.onDeath(B4, c1, x.id);
    t.eq(x.morale, 42, 'com coronel: −1000/125');
    // alien mata soldado: assassino +20, aliens +10, X-COM perde
    const B5 = fixtureVet();
    const s5 = soldier(B5, 1, 1, { stats: { brav: 30 } });
    const s6 = soldier(B5, 2, 1);
    const ak = alien(B5, 'sectoid_soldier', 8, 8);
    const ao = alien(B5, 'sectoid_soldier', 9, 9);
    ak.morale = 40;
    ao.morale = 40;
    s6.status = 'dead';
    const ev = M.onDeath(B5, s6, ak.id);
    t.eq([ak.morale, ao.morale, s5.morale], [70, 50, 84]);
    t.eq(ak.turnsSinceSpotted, 255, 'só a morte de aliens revela o assassino');
    t.ok(ev.every((e) => e.t === 'morale' && e.kind === 'change' && e.delta !== 0));
    t.eq(M.onDeath(B5, null, null), []);
  });

  t.test('Moral: analgésico repõe os HP perdidos uma só vez', () => {
    const B = fixture();
    const u = soldier(B, 1, 1, { stats: { hp: 35 } });
    u.hp = 25;
    u.morale = 50;
    t.eq(M.painkiller(B, u)[0].delta, 10);
    t.eq(u.morale, 60);
    t.eq(M.painkiller(B, u), [], 'mesmos HP: nada');
    u.hp = 20;
    M.painkiller(B, u);
    t.eq(u.morale, 65);
    u.hp = 0;
    u.morale = 90;
    M.painkiller(B, u);
    t.eq(u.morale, 100, 'até 100');
  });

  // ---- pânico -------------------------------------------------------------------------------------------
  t.test('Pânico: tabela de chance 100 − 2·moral', () => {
    const table = [[100, 0], [60, 0], [50, 0], [49, 2], [40, 20], [25, 50], [10, 80], [0, 100]];
    t.eq(table.map(([m]) => M.panicChance(m)), table.map(([, c]) => c));
  });

  t.test('Pânico: moral ≥ 50 não rola; resistir com chance > 1 dá exp. de bravura', () => {
    const B = fixture();
    const u = soldier(B, 1, 1);
    const st = B.rng.combat.state();
    t.eq(drain(M.panicPhase(B, 'xcom')).evs, []);
    t.eq(B.rng.combat.state(), st, 'nenhum número consumido');
    u.morale = 45; // chance 10
    let r = scripted([11]);
    t.eq(drain(M.panicPhase(B, 'xcom', r)).evs, []);
    t.eq([u.exp.brav, r.left()], [1, 0]);
    u.morale = 49; // chance 2
    drain(M.panicPhase(B, 'xcom', scripted([3])));
    t.eq(u.exp.brav, 2);
    // o lado errado não rola
    drain(M.panicPhase(B, 'alien', scripted([])));
    t.eq(u.exp.brav, 2);
  });

  t.test('Pânico: paralisia — UT 0, moral +15, estado panic até ao próximo turno do lado', () => {
    const B = fixtureVet();
    const u = soldier(B, 4, 4);
    u.morale = 0;
    const { evs, ret } = drain(M.panicPhase(B, 'xcom', scripted([1, 50, 99])));
    t.eq(evs.map((e) => [e.t, e.kind, e.mode]), [['morale', 'panic', 'freeze'], ['morale', 'freeze', undefined]]);
    t.eq([evs[1].unitId, evs[1].vis, evs[1].pos, evs[1].side], [u.id, true, I(B, 4, 4), 'xcom']);
    t.eq([u.tu, u.morale, u.status, BU.isConscious(u)], [0, 15, 'panic', true]);
    t.eq(ret, { panicked: [u.id], berserk: [] });
    drain(M.panicPhase(B, 'alien', scripted([])));
    t.eq(u.status, 'panic', 'o turno alienígena não repõe');
    drain(M.panicPhase(B, 'xcom', scripted([100]))); // chance 70, resiste
    t.eq([u.status, u.exp.brav], ['ok', 1]);
  });

  t.test('Pânico: fuga — larga as armas e foge até ±5 tiles (sem OV.Act: passo a passo)', () => {
    const B = fixture();
    const u = soldier(B, 5, 5, { loadout: RIFLE });
    const rifle = BU.item(B, u, 'R');
    u.morale = 0;
    const tu0 = u.tu;
    const { evs } = withAct(undefined, () => drain(M.panicPhase(B, 'xcom', scripted([1, 50, 0, 3, 0]))));
    t.eq(evs.map((e) => e.t + ':' + (e.kind || '')), ['morale:panic', 'drop:', 'morale:flee', 'step:', 'step:', 'step:']);
    t.eq(evs[0].mode, 'flee');
    t.eq([evs[1].itemId, evs[1].i], [rifle.id, I(B, 5, 5)]);
    t.eq(evs[2].to, I(B, 8, 5));
    t.eq(evs.slice(3).map((e) => e.to), [I(B, 6, 5), I(B, 7, 5), I(B, 8, 5)]);
    t.eq([u.x, u.y, u.dir], [8, 5, 2]);
    t.eq([rifle.owner, rifle.at, u.items.R], [null, I(B, 5, 5), null]);
    t.eq(BT.unitAt(B, I(B, 8, 5)), u);
    t.eq(BT.unitAt(B, I(B, 5, 5)), null);
    t.ok(u.energy < u.energyMax, 'gastou energia');
    t.ok(tu0 >= 12);
    t.eq([u.tu, u.morale, u.status], [0, 15, 'panic']);
    // destino = o próprio tile (limite do mapa) ⇒ não anda, mas larga na mesma
    const B2 = fixture();
    const v = soldier(B2, 0, 3, { loadout: RIFLE });
    v.morale = 0;
    const r2 = withAct(undefined, () => drain(M.panicPhase(B2, 'xcom', scripted([1, 50, 0, -5, 0]))));
    t.eq(r2.evs.map((e) => e.t + ':' + (e.kind || '')), ['morale:panic', 'drop:', 'morale:flee']);
    t.eq(r2.evs[2].to, -1);
    t.eq([v.x, v.y, v.tu], [0, 3, 0]);
  });

  t.test('Pânico: fuga cercada anda até onde as UT chegarem; delega em OV.Act.perform quando existe', () => {
    const B = fixture(30, 5);
    const u = soldier(B, 2, 2);
    u.morale = 0;
    u.tu = 9; // só 2 passos
    // alvo fora do alcance das UT mas com caminho: fica no último tile alcançável do caminho
    const r = withAct(undefined, () => drain(M.panicPhase(B, 'xcom', scripted([1, 50, 0, 5, 0]))));
    t.eq(r.evs.filter((e) => e.t === 'step').length, 2);
    t.eq([u.x, u.y], [4, 2]);
    // com o módulo de ações: a fuga é uma ação 'walk' de pânico
    const B2 = fixture();
    const v = soldier(B2, 5, 5);
    v.morale = 0;
    const calls = [];
    const act = { perform: function* (B_, a) { calls.push(a); yield { t: 'stub' }; } };
    const r2 = withAct(act, () => drain(M.panicPhase(B2, 'xcom', scripted([1, 50, 0, 3, 0]))));
    t.eq(calls, [{ type: 'walk', unitId: v.id, to: I(B2, 8, 5), panic: true, desperate: true }]);
    t.eq(r2.evs.map((e) => e.t), ['morale', 'morale', 'stub']);
    t.eq([v.tu, v.status], [0, 'panic']);
  });

  t.test('Berserk: fila de rajadas (auto se a arma tiver, UnitPanicBState) ao inimigo visível mais próximo; UT já contadas', () => {
    const B = fixture();
    const u = soldier(B, 2, 2, { loadout: RIFLE });
    const near = alien(B, 'sectoid_soldier', 6, 2);
    alien(B, 'sectoid_soldier', 9, 2);
    u.morale = 0;
    t.eq(u.tu, 60);
    const { evs, ret } = drain(M.panicPhase(B, 'xcom', scripted([1, 0])));
    t.eq(evs.length, 1);
    const e = evs[0];
    // espingarda: rajada 35 % de 60 = 21 ⇒ 60/21 = 2
    t.eq([e.t, e.kind, e.shots, e.targetId, e.targetI, e.hand, e.mode], ['morale', 'berserk', 2, near.id, I(B, 6, 2), 'R', 'auto']);
    t.eq(ret.berserk, [u.id]);
    t.eq(B.pendingBerserk.length, 1);
    const q = B.pendingBerserk[0];
    t.eq([q.unitId, q.targetId, q.targetI, q.hand, q.mode, q.shots.length], [u.id, near.id, I(B, 6, 2), 'R', 'auto', 2]);
    t.eq(q.shots[0], { type: 'shoot', unitId: u.id, hand: 'R', mode: 'auto', targetI: I(B, 6, 2), targetId: near.id, force: true, berserk: true, free: true });
    t.eq([u.tu, u.morale, u.status], [0, 15, 'panic']);
    t.ok(JSON.parse(JSON.stringify(B.pendingBerserk)).length === 1, 'fila serializável');
  });

  t.test('Berserk: sem inimigo à vista ⇒ tile ao acaso ±6; máximo 10 tiros; munição; duas mãos', () => {
    const B = fixture();
    // pistola (sem rajada ⇒ tiro rápido 18 % de 60 = 10)
    const u = soldier(B, 5, 8, { loadout: { R: 'pistol', L: null, belt: ['pistol_clip'], pack: [] } });
    u.morale = 0;
    u.tu = 200;
    drain(M.panicPhase(B, 'xcom', scripted([1, 0, 4, -6])));
    const q = B.pendingBerserk[0];
    t.eq([q.targetI, q.targetId, q.shots.length, q.mode], [I(B, 9, 2), null, 10, 'snap'], '200/10 = 20 → 10');
    const W = fixture();
    const wu = soldier(W, 5, 8, { loadout: RIFLE });
    wu.morale = 0;
    wu.tu = 200;
    drain(M.panicPhase(W, 'xcom', scripted([1, 0, 4, -6])));
    t.eq([W.pendingBerserk[0].mode, W.pendingBerserk[0].shots.length], ['auto', 7], 'rajadas: 200/21 = 9; 20 balas ⇒ 7 rajadas');
    // munição: 3 balas ⇒ 1 rajada; tile alvo limitado ao mapa
    const B2 = fixture();
    const v = soldier(B2, 1, 1, { loadout: RIFLE });
    BU.item(B2, v, 'R').ammo.rounds = 3;
    v.morale = 0;
    drain(M.panicPhase(B2, 'xcom', scripted([1, 0, -6, -6])));
    t.eq([B2.pendingBerserk[0].shots.length, B2.pendingBerserk[0].targetI], [1, I(B2, 0, 0)]);
    // sem arma: evento sem tiros e sem fila
    const B3 = fixture();
    const w = soldier(B3, 1, 1);
    w.morale = 0;
    const r3 = drain(M.panicPhase(B3, 'xcom', scripted([1, 0, 0, 0])));
    t.eq([r3.evs[0].kind, r3.evs[0].shots, r3.evs[0].hand, B3.pendingBerserk.length, w.tu], ['berserk', 0, null, 0, 0]);
    // duas armas: a de snap mais barato (pistola 18 % < pistola laser 20 %)
    const B4 = fixture();
    const z = soldier(B4, 1, 1, { loadout: { R: 'laser_pistol', L: 'pistol', belt: ['pistol_clip'], pack: [] } });
    t.ok(BU.item(B4, z, 'L').ammo, 'pistola carregada');
    t.eq(M.berserkWeapon(B4, z).hand, 'L');
    BU.item(B4, z, 'L').ammo = null;
    t.eq(M.berserkWeapon(B4, z).hand, 'R', 'arma descarregada não conta');
    t.eq(M.berserkWeapon(B4, z).rounds, null, 'laser sem carregador');
  });

  t.test('Berserk: runBerserk executa e esvazia a fila (descarta sem OV.Act)', () => {
    const B = fixture();
    const u = soldier(B, 2, 2, { loadout: RIFLE });
    alien(B, 'sectoid_soldier', 6, 2);
    u.morale = 0;
    drain(M.panicPhase(B, 'xcom', scripted([1, 0])));
    const shots = B.pendingBerserk[0].shots.slice();
    const calls = [];
    const act = { perform: function* (B_, a) { calls.push(a); yield { t: 'shot' }; } };
    const r = withAct(act, () => drain(M.runBerserk(B)));
    t.eq(calls, shots);
    t.eq(r.evs.length, shots.length);
    t.eq(B.pendingBerserk, []);
    B.pendingBerserk = [{ unitId: u.id, shots: shots.slice() }];
    withAct(undefined, () => drain(M.runBerserk(B)));
    t.eq(B.pendingBerserk, []);
    // unidade morta a meio: pára
    B.pendingBerserk = [{ unitId: u.id, shots: shots.slice() }];
    const act2 = { perform: function* (B_, a) { calls.push(a); u.status = 'dead'; yield { t: 'shot' }; } };
    calls.length = 0;
    withAct(act2, () => drain(M.runBerserk(B)));
    t.eq(calls.length, 1);
  });

  t.test('Pânico: distribuição berserk 33 % / paralisia / fuga (Monte Carlo)', () => {
    const B = fixtureVet();
    const u = soldier(B, 5, 5);
    const rng = OV.RNG.create(12345);
    const n = 3000;
    const count = { berserk: 0, freeze: 0, flee: 0 };
    withAct(undefined, () => {
      for (let k = 0; k < n; k++) {
        u.morale = 0;
        u.status = 'ok';
        u.tu = 60;
        u.energy = 60;
        BU.placeUnit(B, u, I(B, 5, 5));
        const e = drain(M.panicPhase(B, 'xcom', rng)).evs[0];
        count[e.kind === 'berserk' ? 'berserk' : e.mode]++;
      }
    });
    t.near(count.berserk / n, 0.33, 0.03, 'berserk');
    t.near(count.freeze / n, 0.335, 0.03, 'paralisia');
    t.near(count.flee / n, 0.335, 0.03, 'fuga');
    // moral 25 ⇒ 50 % de pânico
    let hits = 0;
    for (let k = 0; k < 2000; k++) {
      u.morale = 25;
      u.status = 'ok';
      u.tu = 60;
      BU.placeUnit(B, u, I(B, 5, 5));
      if (withAct(undefined, () => drain(M.panicPhase(B, 'xcom', rng)).evs.length)) hits++;
    }
    t.near(hits / 2000, 0.5, 0.04, 'chance 50 %');
  });

  // ---- psiónica -----------------------------------------------------------------------------------------
  t.test('Psi: ataque PsiStr·PsiSkill/50 − dist + RNG(0,55) vs defesa PsiStr + 10 + PsiSkill/5; Pânico', () => {
    const B = fixture();
    const ldr = alien(B, 'sectoid_leader', 2, 2); // 50/50
    const s = soldier(B, 5, 6, { stats: { psiStr: 40, psiSkill: 0, brav: 30 } }); // dist 5
    t.eq([M.psiAttackStrength(ldr), M.psiDefense(s, 'panic'), M.psiDefense(s, 'control'), M.tileDist(ldr, s)], [50, 50, 70, 5]);
    let r = M.psiAttack(B, ldr, s, 'panic', scripted([5]));
    t.eq(r.success, false, '45 + 5 = 50 não supera 50');
    t.eq(r.events, [{ t: 'psi', attackerId: ldr.id, targetId: s.id, kind: 'panic', success: false, vis: true, pos: I(B, 5, 6) }]);
    t.eq([ldr.exp.psi, s.morale], [1, 100]);
    r = M.psiAttack(B, ldr, s, 'panic', scripted([6]));
    t.eq(r.success, true);
    t.eq([s.morale, ldr.exp.psi], [20, 4], 'moral −(110 − 30); exp +1 +2');
    t.eq(r.events.map((e) => e.t + ':' + e.kind), ['psi:panic', 'morale:change']);
    t.eq(r.events[1].delta, -80);
    t.eq([M.psiChance(B, ldr, s, 'panic'), M.psiChance(B, ldr, s, 'control')], [89, 53]);
    // inválidos não consomem RNG
    t.eq(M.psiAttack(B, ldr, ldr, 'panic', scripted([])), { success: false, events: [] });
    t.eq(M.psiAttack(B, ldr, alien(B, 'sectoid_soldier', 9, 9), 'panic', scripted([])), { success: false, events: [] });
    t.eq(M.psiAttack(B, ldr, s, 'nope', scripted([])), { success: false, events: [] });
    s.status = 'dead';
    t.eq(M.psiAttack(B, ldr, s, 'panic', scripted([])).events, []);
    // unidade grande: Pânico resulta mas sem efeito na moral
    const B2 = fixture();
    const sx = soldier(B2, 1, 1, { stats: { psiStr: 100, psiSkill: 100 } });
    const disc = alien(B2, 'cyberdisc', 3, 3);
    const r2 = M.psiAttack(B2, sx, disc, 'panic', scripted([55]));
    t.eq([r2.success, disc.morale, r2.events.length], [true, 100, 1]);
    // distâncias arredondadas
    const at = (x, y, z) => ({ x, y, z });
    t.eq([M.tileDist(at(0, 0, 0), at(1, 1, 0)), M.tileDist(at(0, 0, 0), at(1, 1, 1)), M.tileDist(at(0, 0, 0), at(3, 4, 0)), M.tileDist(at(0, 0, 0), at(2, 2, 1))], [1, 2, 5, 3]);
  });

  t.test('Psi: Controlo Mental muda de lado com UT cheias e reverte no próximo turno de quem controla', () => {
    const B = fixture();
    const ldr = alien(B, 'sectoid_leader', 2, 2);
    const s = soldier(B, 5, 6, { stats: { psiStr: 40, psiSkill: 0 } });
    const other = soldier(B, 1, 9);
    s.tu = 3;
    s.status = 'panic';
    let r = M.psiAttack(B, ldr, s, 'control', scripted([25]));
    t.eq(r.success, false, '45 + 25 = 70 não supera 70');
    t.eq(s.side, 'xcom');
    B.turn = 4;
    r = M.psiAttack(B, ldr, s, 'mc', scripted([26]));
    t.eq(r.success, true);
    t.eq(r.events[0].kind, 'control');
    t.eq([s.side, s.origSide, s.status, s.tu, s.tuMax], ['alien', 'xcom', 'ok', BU.turnTU(B, s), BU.turnTU(B, s)]);
    t.eq(s.control, { by: 'alien', revertOn: 'alien', turn: 4, attackerId: ldr.id });
    t.eq(BT.unitsOf(B, 'xcom').map((u) => u.id), [other.id]);
    t.eq(M.revertControl(B, 'xcom'), [], 'continua alienígena durante o turno X-COM');
    t.eq(s.side, 'alien');
    const ev = M.revertControl(B, 'alien');
    t.eq(ev, [{ t: 'psi', kind: 'revert', targetId: s.id, from: 'alien', side: 'xcom', vis: true, pos: I(B, 5, 6) }]);
    t.eq([s.side, s.control], ['xcom', null]);
    // X-COM controla o último alienígena consciente ⇒ vitória; reverte no início do próximo turno X-COM
    const B2 = fixture();
    const psy = soldier(B2, 1, 1, { stats: { psiStr: 80, psiSkill: 60 } }); // 96
    const sec = alien(B2, 'sectoid_soldier', 3, 1); // defesa vs MC 40 + 10 + 20 = 70
    t.eq(BT.outcome(B2), null);
    t.ok(M.psiAttack(B2, psy, sec, 'control', scripted([0])).success);
    t.eq([sec.side, sec.control.revertOn], ['xcom', 'xcom']);
    t.eq(BT.outcome(B2), 'win');
    t.eq(M.revertControl(B2, 'alien'), []);
    t.eq(M.revertControl(B2, 'xcom').length, 1);
    t.eq(sec.side, 'alien');
    // recuperar o próprio soldado controlado: volta ao lado original sem estado de controlo
    const B3 = fixture();
    const l3 = alien(B3, 'sectoid_leader', 2, 2);
    const s3 = soldier(B3, 4, 2);
    const p3 = soldier(B3, 6, 2, { stats: { psiStr: 90, psiSkill: 90 } });
    t.ok(M.psiAttack(B3, l3, s3, 'control', scripted([55])).success);
    t.ok(M.psiAttack(B3, p3, s3, 'control', scripted([55])).success);
    t.eq([s3.side, s3.control], ['xcom', null]);
    t.eq(M.revertControl(B3, 'alien'), []);
    // estado JSON (serializa com B)
    t.ok(JSON.stringify(B3.units).indexOf('"control":null') >= 0);
  });

  t.test('Psi: Monte Carlo coincide com psiChance (Pânico e Controlo)', () => {
    const B = fixture();
    const eth = alien(B, 'ethereal_leader', 2, 2); // 60/45 ⇒ 54
    const s = soldier(B, 9, 8, { stats: { psiStr: 35, psiSkill: 20 } }); // defesa 49 / 69; dist 9
    const rng = OV.RNG.create(99);
    for (const kind of ['panic', 'control']) {
      const exp = M.psiChance(B, eth, s, kind);
      let ok = 0;
      const n = 20000;
      for (let k = 0; k < n; k++) {
        if (M.psiAttack(B, eth, s, kind, rng).success) ok++;
        s.morale = 100;
        s.side = 'xcom';
        s.control = null;
      }
      t.near((ok * 100) / n, exp, 1.5, kind + ' (esperado ' + exp + ' %)');
    }
    // contagem exata: RNG(0,55) > defesa − (ataque − dist)
    const base = M.psiAttackStrength(eth) - M.tileDist(eth, s);
    t.eq(M.tileDist(eth, s), 9);
    for (const kind of ['panic', 'control']) {
      let wins = 0;
      for (let v = 0; v <= 55; v++) if (base + v > M.psiDefense(s, kind)) wins++;
      t.eq(M.psiChance(B, eth, s, kind), OV.U.idiv(wins * 100, 56), kind);
    }
  });

  t.test('Psi: probabilidade de Controlo Mental da IA (controlOdds)', () => {
    const tg = (brav, morale) => ({ stats: { brav }, morale });
    t.eq(M.controlOdds(null, tg(30, 100)), 10, 'B=8: 40 −15 −15');
    t.eq(M.controlOdds(null, tg(30, 30)), 40, 'moral < 40: +15');
    t.eq(M.controlOdds(null, tg(30, 0)), 100, 'moral 0');
    t.eq(M.controlOdds(null, tg(90, 100)), 55, 'B=2: +15');
    t.eq(M.controlOdds(null, tg(60, 100)), 40, 'B=5, 100 − 50 ≥ 50');
    t.eq(M.controlOdds(null, tg(60, 90)), 25, 'B=5, 90 − 50 < 50');
  });

  // ---- experiência ----------------------------------------------------------------------------------------
  t.test('Experiência: contadores por tipo', () => {
    const B = fixture();
    const u = soldier(B, 1, 1);
    t.eq(M.gainExp(u, 'fire'), 1);
    t.eq(M.gainExp(u, 'fire', 2), 3);
    t.eq(M.gainExp(u, 'react'), 1);
    t.eq(M.gainExp(u, 'psiStr'), 1);
    t.eq(M.gainExp(u, 'bogus'), 0);
    t.eq(M.gainExp(null, 'fire'), 0);
    t.eq([u.exp.fire, u.exp.react, u.exp.thr, u.exp.psiStr], [3, 1, 0, 1]);
    const bare = {};
    M.gainExp(bare, 'thr');
    t.eq(bare.exp, { fire: 0, react: 0, thr: 1, melee: 0, brav: 0, psi: 0 });
  });

  t.test('Experiência: improveStat por escalões (0, 1–2, 3–5, 6–10, >10)', () => {
    const rng = OV.RNG.create(5);
    const st = rng.state();
    t.eq(M.improveStat(0, rng), 0);
    t.eq(rng.state(), st, 'exp 0 não consome RNG');
    const buckets = [[[1, 2], 0, 1], [[3, 4, 5], 1, 3], [[6, 8, 10], 1, 4], [[11, 30, 200], 2, 6]];
    for (const [exps, lo, hi] of buckets) {
      for (const e of exps) {
        const seen = new Set();
        for (let k = 0; k < 400; k++) {
          const g = M.improveStat(e, rng);
          t.ok(g >= lo && g <= hi, 'exp ' + e + ': ' + g + ' ∉ [' + lo + ',' + hi + ']');
          seen.add(g);
        }
        t.eq(seen.size, hi - lo + 1, 'exp ' + e + ' cobre o intervalo');
      }
    }
  });

  t.test('Experiência: postMission segue a ordem e os limites do original (RNG roteirizado)', () => {
    const stats = { tu: 55, sta: 50, hp: 30, brav: 30, react: 40, fire: 50, thr: 60, str: 30, melee: 25, psiStr: 40, psiSkill: 0 };
    const exp = { fire: 7, react: 2, thr: 12, melee: 0, brav: 3, psi: 0 };
    // bravura RNG(0,10)=2 (<3 ⇒ +10); reações RNG(0,1); pontaria RNG(1,4); lançamento RNG(2,6);
    // UT RNG(0,25/10+2=4); saúde RNG(0,3+2=5); força RNG(0,4+2=6); energia RNG(0,50/15+2=5)
    const r = scripted([2, 1, 4, 6, 3, 5, 0, 5]);
    const out = M.postMission(stats, exp, r);
    t.eq(r.left(), 0, 'todos os números consumidos pela ordem');
    t.eq(out.gains, { brav: 10, react: 1, fire: 4, thr: 6, tu: 3, hp: 5, sta: 5 });
    t.eq(out.secondary, true);
    t.eq(out.stats, { tu: 58, sta: 55, hp: 35, brav: 40, react: 41, fire: 54, thr: 66, str: 30, melee: 25, psiStr: 40, psiSkill: 0 });
    t.eq(stats.tu, 55, 'entrada intacta');
    // bravura falha quando exp ≤ RNG(0,10)
    t.eq(M.postMission(stats, { brav: 3 }, scripted([3, 0, 0, 0, 0])).gains, {});
    // só Lançamento ⇒ sem subida secundária
    const thr = M.postMission(stats, { thr: 4 }, scripted([2]));
    t.eq([thr.gains, thr.secondary], [{ thr: 2 }, false]);
    // psi: Psi Skill pela exp. psi, Psi Str pela exp. psiStr; ambos contam para a secundária
    const ps = M.postMission(stats, { psi: 11, psiStr: 1 }, scripted([6, 1, 0, 0, 0, 0]));
    t.eq([ps.gains, ps.secondary], [{ psiSkill: 6, psiStr: 1 }, true]);
    t.eq(M.postMission(stats, {}, scripted([])), { stats, gains: {}, secondary: false });
  });

  t.test('Experiência: limites (OV.Data.soldierGen.caps) — no limite não sobe; secundária ultrapassa no máximo 2', () => {
    const caps = D.soldierGen.caps;
    const all = { fire: 20, react: 20, thr: 20, melee: 20, brav: 20, psi: 20, psiStr: 20 };
    const r = OV.RNG.create(3);
    const st = r.state();
    const top = M.postMission(Object.assign({}, caps), all, r);
    t.eq([top.gains, top.stats, top.secondary], [{}, caps, true]);
    t.eq(r.state(), st, 'nada a rolar no limite');
    const rng = OV.RNG.create(77);
    for (let k = 0; k < 300; k++) {
      const s = { tu: 79, sta: 99, hp: 59, brav: 90, react: 99, fire: 119, thr: 119, str: 69, melee: 119, psiStr: 99, psiSkill: 99 };
      const o = M.postMission(s, { fire: 1, brav: 0 }, rng).stats;
      t.ok(o.tu <= caps.tu + 2 && o.hp <= caps.hp + 2 && o.str <= caps.str + 2 && o.sta <= caps.sta + 2, 'secundária ≤ limite + 2');
      t.ok(o.fire <= 120, 'exp 1: no máximo +1');
      const big = M.postMission(s, { fire: 11, brav: 11 }, rng).stats;
      t.ok(big.fire >= 121 && big.fire <= 125 && big.brav === 100);
    }
    // determinismo
    const a = M.postMission({ tu: 50, sta: 40, hp: 25, brav: 10, react: 30, fire: 40, thr: 50, str: 20, melee: 20, psiStr: 30, psiSkill: 0 }, all, OV.RNG.create(42));
    const b = M.postMission({ tu: 50, sta: 40, hp: 25, brav: 10, react: 30, fire: 40, thr: 50, str: 20, melee: 20, psiStr: 30, psiSkill: 0 }, all, OV.RNG.create(42));
    t.eq(a, b);
  });

  // ---- integração ---------------------------------------------------------------------------------------
  t.test('Integração: batalha gerada, toda a equipa a moral 0 — resultado determinístico', () => {
    const run = () => {
      const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 11, month: 0, squadSize: 6 }));
      for (const u of BT.unitsOf(B, 'xcom')) u.morale = 0;
      const r = withAct(undefined, () => drain(M.panicPhase(B, 'xcom')));
      return { B, r };
    };
    const a = run(), b = run();
    t.eq(BT.hash(a.B), BT.hash(b.B), 'mesmo hash');
    t.eq(a.r.evs.map((e) => e.t + ':' + e.kind), b.r.evs.map((e) => e.t + ':' + e.kind));
    const xs = BT.unitsOf(a.B, 'xcom', true);
    t.eq(a.r.ret.panicked.length + a.r.ret.berserk.length, xs.length, 'todos entram em pânico');
    for (const u of xs) t.eq([u.tu, u.morale, u.status], [0, 15, 'panic']);
    t.eq(a.B.pendingBerserk.map((q) => q.unitId), a.r.ret.berserk.filter((uid) => BU.item(a.B, BU.findUnit(a.B, uid), 'R')));
    const ser = BT.deserialize(JSON.parse(JSON.stringify(BT.serialize(a.B))));
    t.eq(BT.hash(ser), BT.hash(a.B), 'serializa');
    t.eq(ser.pendingBerserk, a.B.pendingBerserk);
  });
  // ---- regressões da revisão (onda 2) --------------------------------------------------------------------------------
  t.test('Berserk: runBerserk pára quando um tiro acaba a batalha (nada depois do battleEnd)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const B = fixture(12, 12, seed);
      B.phase = 'play';
      B.side = 'xcom';
      B.mission.kind = 'crash';
      const u = soldier(B, 2, 2, { loadout: RIFLE, stats: { fire: 250 } });
      const a = alien(B, 'sectoid_soldier', 4, 2);
      a.hp = 1;
      OV.LOS.refreshAll(B);
      const shot = { type: 'shoot', unitId: u.id, hand: 'R', mode: 'snap', targetI: tileOf(B, a), targetId: a.id, force: true, berserk: true, free: true };
      B.pendingBerserk = [{ unitId: u.id, targetI: shot.targetI, targetId: a.id, hand: 'R', mode: 'snap', shots: [0, 1, 2, 3, 4, 5].map(() => Object.assign({}, shot)) }];
      const evs = drain(M.runBerserk(B)).evs.map((e) => e.t);
      const end = evs.indexOf('battleEnd');
      if (end < 0) continue;
      checked++;
      t.eq(end, evs.length - 1, 'semente ' + seed + ': battleEnd é o último evento (' + evs.join(' ') + ')');
      t.eq(evs.indexOf('interrupt'), -1);
    }
    t.ok(checked > 0, 'pelo menos uma batalha acabou pelo berserk');
    // panicPhase também pára
    const P = fixture();
    P.phase = 'over';
    const v = soldier(P, 5, 5);
    v.morale = 0;
    t.eq(drain(M.panicPhase(P, 'xcom', scripted([]))).evs, [], 'batalha acabada ⇒ sem pânico');
  });

  t.test('Psi: mudar de lado refaz a visão (sem ids vistos só pelo observador antigo); revert também', () => {
    const B = fixture(16, 16);
    B.phase = 'play';
    const s = soldier(B, 2, 2);
    s.dir = 2;
    const a = alien(B, 'sectoid_soldier', 6, 2);
    a.dir = 6;
    const hidden = alien(B, 'sectoid_soldier', 14, 14);
    OV.LOS.refreshAll(B);
    t.ok(B._.visible.xcom.has(a.id), 'o soldado vê o alien');
    const mc = alien(B, 'sectoid_leader', 13, 13);
    mc.stats.psiSkill = 200;
    mc.stats.psiStr = 200;
    let res = null;
    for (let k = 0; k < 20 && !(res && res.success); k++) res = M.psiAttack(B, mc, s, 'control', scripted([55]));
    t.ok(res.success, 'controlado');
    t.eq(s.side, 'alien');
    t.ok(!B._.visible.xcom.has(a.id), 'a X-COM deixa de ver o que só o soldado via');
    t.ok(res.sight && res.sight.spotted, 'resultado da visão devolvido');
    t.ok(!B._.visible.xcom.has(hidden.id));
    const ev = M.revertControl(B, 'alien');
    t.eq(ev.length, 1);
    t.eq(s.side, 'xcom');
    t.ok(B._.visible.xcom.has(a.id), 'de volta: vê outra vez');
  });

  t.test('Berserk: modo por omissão rajada → tiro rápido (nunca apontado)', () => {
    const B = fixture();
    const u = soldier(B, 2, 2, { loadout: RIFLE });
    t.eq([M.berserkWeapon(B, u).mode, M.berserkWeapon(B, u).cost], ['auto', 21]);
    const B2 = fixture();
    const v = soldier(B2, 2, 2, { loadout: { R: 'pistol', L: null, belt: ['pistol_clip'], pack: [] } });
    t.eq(M.berserkWeapon(B2, v).mode, 'snap');
  });
};
