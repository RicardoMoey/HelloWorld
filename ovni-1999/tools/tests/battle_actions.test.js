/* Testes das ações e do fluxo de turnos: js/sim/battle/actions.js + OV.Battle.beginBattle/endPlayerTurn/abort/debrief
   (DESIGN.md §10, §3.3, §3.6, §3.10, §3.17; REA 03 §2, §5, §14) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const A = OV.Act;
  const TU = OV.TUNE;
  const id = (k) => D.tileId(k);

  // mapa aberto de chão FARM, de dia, em pleno turno X-COM; um alienígena fora do mapa mantém a batalha viva
  function fixture(w, h, d, seed, noDummy) {
    const m = BM.create(w || 20, h || 16, d || 1);
    const plane = m.w * m.h;
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = i < plane ? id('FARM.ground') : 0;
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', phase: 'play', aborted: false, pendingExplosions: [],
      reserve: 'none', reserveKneel: false, craftTiles: [], specials: {}, settings: { instantGrenades: true },
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 0, shade: 0, deploymentId: 'dep_terror_site', craftType: 'skyranger' }, rng: OV.RNG.streams(seed || 11),
    };
    BT.rebuildDerived(B);
    if (!noDummy) BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(9), 'dep_terror_site');
    return B;
  }
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'A' + sid++, name: 'Teste', nat: 'pt', rank: opt.rank | 0, armour: opt.armour || 'coveralls', missions: opt.missions | 0,
      stats: Object.assign({ tu: 60, sta: 60, hp: 40, brav: 50, react: 50, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 }, opt.stats),
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
    BU.placeUnit(B, u, I(B, x, y, opt.z));
    u.dir = opt.dir === undefined ? 2 : opt.dir;
    return u;
  }
  function alien(B, type, x, y, o) {
    const opt = o || {};
    const u = BU.fromAlien(B, type, 0, OV.RNG.create(5), 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y, opt.z));
    u.dir = opt.dir === undefined ? 6 : opt.dir;
    return u;
  }
  // arma na mão direita, carregada
  function arm(B, u, weapon, clip) {
    for (const it of BU.handItems(B, u)) BU.deleteItem(B, it.id);
    const it = BU.newItem(B, weapon, clip ? { ammo: clip } : {});
    BU.giveItem(B, u, it.id, 'R', true);
    return it;
  }
  const run = (gen) => {
    const ev = [];
    let r;
    while (!(r = gen.next()).done) ev.push(r.value);
    return { ev, ret: r.value };
  };
  const act = (B, a) => run(A.perform(B, a));
  const types = (ev) => ev.map((e) => e.t);
  const ofType = (ev, ty) => ev.filter((e) => e.t === ty);
  const sight = (B) => OV.LOS.refreshAll(B);
  // sem IA (o módulo da IA é escrito noutra etapa): retira-a durante fn
  function withoutAI(fn) {
    const saved = OV.AI;
    delete OV.AI;
    try { return fn(); } finally { if (saved !== undefined) OV.AI = saved; }
  }

  // ---- andar ---------------------------------------------------------------------------------------------
  t.test('Andar: 4 UT/2 En ortogonal, 6/3 diagonal, motion +30 por passo, eventos step', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    const v = A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 5, 2) });
    t.eq([v.ok, v.tu, v.energy, v.steps], [true, 12, 6, [2, 2, 2]]);
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 5, 2) });
    t.eq(types(r.ev), ['step', 'step', 'step']);
    t.eq([s.x, s.y, s.tu, s.energy, s.motion, s.dir], [5, 2, 48, 54, 90, 2]);
    t.eq(r.ret.ok, true);
    const d = act(B, { type: 'walk', unitId: s.id, to: I(B, 7, 4) });
    t.eq(types(d.ev), ['step', 'step']);
    t.eq([s.tu, s.energy, s.dir], [36, 48, 3], 'diagonal 6 UT, 3 energia');
  });

  t.test('Andar de joelhos: levanta-se primeiro (8 UT, evento kneel down:false)', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    run(A.perform(B, { type: 'kneel', unitId: s.id }));
    t.eq([s.kneel, s.tu], [true, 56]);
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 3, 2) }).tu, 12);
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 3, 2) });
    t.eq(types(r.ev), ['kneel', 'step']);
    t.eq([r.ev[0].down, s.kneel, s.tu], [false, false, 44]);
  });

  t.test('Andar: sem UT para o passo seguinte ⇒ interrupt noTU; sem energia ⇒ noEnergy; destino bloqueado', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    s.tu = 9;
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 8, 2) });
    t.eq(types(r.ev), ['step', 'step', 'interrupt']);
    t.eq([r.ev[2].reason, r.ev[2].key, s.x, s.tu], ['noTU', 'bs.noTU', 4, 1]);
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 5, 2) }).reason, 'noTU');
    s.tu = 60;
    s.energy = 3;
    const e = act(B, { type: 'walk', unitId: s.id, to: I(B, 8, 2) });
    t.eq([types(e.ev), e.ev[1].reason, s.x], [['step', 'interrupt'], 'noEnergy', 5]);
    B.map.parts[I(B, 9, 9) * 4 + 3] = id('FARM.crate');
    s.energy = 60;
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 9, 9) }).reason, 'blocked');
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 5, 2) }).reason, 'invalid', 'destino = posição atual');
  });

  t.test('Avistar um alienígena a meio do caminho para a marcha e mantém as UT; desesperado continua', () => {
    const B = fixture();
    // parede (oeste) em x=4, y=0..4: esconde o alienígena até o soldado passar a parede
    for (let y = 0; y <= 4; y++) B.map.parts[I(B, 4, y) * 4 + 1] = id('FARM.wall');
    const s = soldier(B, 2, 5, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 9, 1, { dir: 0 });
    sight(B);
    t.ok(!OV.LOS.isVisibleTo(B, 'xcom', a), 'escondido no início');
    const alienTU = a.tu;
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 9, 5) });
    const steps = ofType(r.ev, 'step').length;
    t.ok(steps >= 1 && steps <= 2, 'para logo depois de passar a parede');
    t.eq(types(r.ev).slice(steps), ['spotted', 'interrupt']);
    t.eq([r.ev[steps].unitId, r.ev[steps].vis, r.ev[steps + 1].reason], [a.id, true, 'spotted']);
    t.eq([s.x, s.y, s.tu, r.ret.ok, r.ret.reason], [2 + steps, 5, 60 - 4 * steps, false, 'spotted']);
    t.eq(a.tu, alienTU, 'o alienígena virado para norte não reage');
    // já avistado neste turno: a marcha seguinte não volta a parar por ele
    const r2 = act(B, { type: 'walk', unitId: s.id, to: I(B, s.x + 2, 5) });
    t.eq(types(r2.ev), ['step', 'step']);
    // desesperado (pânico/IA) ignora avistamentos
    const C = fixture();
    for (let y = 0; y <= 4; y++) C.map.parts[I(C, 4, y) * 4 + 1] = id('FARM.wall');
    const s2 = soldier(C, 2, 5, { dir: 2 });
    alien(C, 'sectoid_soldier', 9, 1, { dir: 0 });
    sight(C);
    const r3 = act(C, { type: 'walk', unitId: s2.id, to: I(C, 7, 5), desperate: true });
    t.eq(ofType(r3.ev, 'interrupt').length, 0);
    t.eq(ofType(r3.ev, 'spotted').length, 1);
    t.eq(s2.x, 7);
  });

  // ---- reserva -------------------------------------------------------------------------------------------
  t.test('Reserva de UT: andar/rodar/ajoelhar recusados com «reserved»; disparar não; Auto→Snap; +4 joelho', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    t.eq(A.reserveTU(B, s), 0);
    B.reserve = 'snap';
    t.eq(A.reserveTU(B, s), 15, 'snap da espingarda = 25 % de 60');
    B.reserve = 'auto';
    t.eq(A.reserveTU(B, s), 21);
    B.reserve = 'aimed';
    t.eq(A.reserveTU(B, s), 48);
    B.reserveKneel = true;
    t.eq(A.reserveTU(B, s), 52, '+4 para ajoelhar');
    B.reserveKneel = false;
    // pistola sem rajada: Auto → Snap
    const p = soldier(B, 2, 8, { loadout: { R: 'pistol', L: null, belt: ['pistol_clip'], pack: [] } });
    B.reserve = 'auto';
    t.eq(A.reserveTU(B, p), 10, 'snap da pistola = 18 % de 60');
    B.reserve = 'snap';
    // 60 − 15 = 45 ⇒ 11 passos de 4 UT
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 16, 2) });
    t.eq(ofType(r.ev, 'step').length, 11);
    t.eq([r.ev[r.ev.length - 1].reason, s.tu], ['reserved', 16]);
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 14, 3) }).reason, 'reserved');
    t.eq(A.validate(B, { type: 'turn', unitId: s.id, dir: 6 }).reason, 'reserved');
    t.eq(A.validate(B, { type: 'kneel', unitId: s.id }).reason, 'reserved', 'ajoelhar: 16 − 4 = 12 < 15');
    s.tu = 19;
    t.eq(A.validate(B, { type: 'kneel', unitId: s.id }).ok, true, '19 − 4 = 15: a parte «joelho» da reserva não conta para ajoelhar');
    s.tu = 16;
    const al = alien(B, 'sectoid_soldier', 16, 2);
    sight(B);
    t.ok(A.validate(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'snap', target: { unitId: al.id } }).ok, 'o tiro usa a reserva');
    // alienígenas não têm reserva X-COM
    t.eq(A.reserveTU(B, al), 0);
    // desesperado ignora a reserva
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 13, 3), desperate: true }).ok, true);
  });

  t.test('walkPreview: marcas 0 mantém reserva, 1 come reserva, 2 inalcançável', () => {
    const B = fixture();
    const s = soldier(B, 1, 2);
    sight(B);
    B.reserve = 'snap';
    s.tu = 30;
    const p = A.walkPreview(B, s, I(B, 10, 2));
    t.eq(p.reserve, 15);
    t.eq(p.marks, [0, 0, 0, 1, 1, 1, 1, 2, 2]);
    t.eq(p.tus.slice(0, 3), [4, 8, 12]);
  });

  t.test('Reserva só conta enquanto se pode pagar (checkReservedTU): abaixo dela anda e roda livremente', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    B.reserve = 'aimed';
    t.eq(A.reserveTU(B, s), 48);
    for (const tu of [60, 52]) {
      s.tu = tu;
      t.ok(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 3, 2) }).ok, 'UT ' + tu + ': andar 4 mantém 48');
    }
    s.tu = 50;
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 3, 2) }).reason, 'reserved', '50 − 4 < 48 com a reserva pagável');
    for (const tu of [47, 30, 10]) {
      s.tu = tu;
      t.ok(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 3, 2) }).ok, 'UT ' + tu + ' < reserva: andar');
      t.ok(A.validate(B, { type: 'turn', unitId: s.id, dir: 6 }).ok, 'UT ' + tu + ' < reserva: rodar');
    }
    s.tu = 30;
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 6, 2) });
    t.eq([ofType(r.ev, 'step').length, s.tu], [4, 14], 'marcha inteira');
    s.tu = 30;
    const p = A.walkPreview(B, s, I(B, 12, 2));
    t.ok(p.marks.indexOf(1) < 0, 'pré-visualização sem marcas «come a reserva»: ' + p.marks.join(''));
  });

  t.test('Reação: pontuação do reator truncada contra a do mover exata (empates a favor do mover)', () => {
    const tryReact = (moverTU) => {
      const B = fixture();
      const s = soldier(B, 2, 5, { dir: 2, armour: 'power_suit', stats: { react: 50, tu: 60, hp: 80 } });
      const a = alien(B, 'sectoid_soldier', 10, 5, { dir: 6 });
      a.stats.react = 63;
      a.tu = 29;
      arm(B, a, 'plasma_pistol', 'plasma_pistol_clip');
      sight(B);
      s.tu = moverTU + 4;
      const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 3, 5) });
      t.eq(A.reactionScore(a) >= 0, true);
      return ofType(r.ev, 'reaction').length;
    };
    t.eq(tryReact(40), 0, 'alien 33.83 → 33 < soldado 33.33');
    t.eq(tryReact(39), 1, 'alien 33 ≥ soldado 32.5');
  });

  // ---- portas --------------------------------------------------------------------------------------------
  t.test('Portas: a marcha abre a porta de batente (UT incluídas, eventos tile+door); ação door sem entrar; porta OVNI', () => {
    const B = fixture();
    for (let y = 0; y < 16; y++) B.map.parts[I(B, 5, y) * 4 + 1] = id(y === 3 ? 'FARM.door' : 'FARM.wall');
    const s = soldier(B, 3, 3);
    sight(B);
    const v = A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 6, 3) });
    const doorStep = 4 + (D.tileDefByKey['FARM.doorOpen'].tu | 0) + TU.TU_DOOR;
    t.eq(v.tu, 4 + doorStep + 4);
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 6, 3) });
    t.eq(types(r.ev).filter((x) => x !== 'spotted'), ['step', 'tile', 'door', 'step', 'step']);
    t.eq(BM.def(B.map, I(B, 5, 3), 1).key, 'FARM.doorOpen');
    t.eq([s.x, s.tu], [6, 60 - v.tu]);
    // abrir sem entrar (botão secundário): adjacente, vira-se para a porta, 4 UT
    const C = fixture();
    C.map.parts[I(C, 5, 3) * 4 + 1] = id('FARM.door');
    const s2 = soldier(C, 4, 3, { dir: 0 });
    sight(C);
    t.eq(A.validate(C, { type: 'door', unitId: s2.id, i: I(C, 5, 3), part: 1 }).tu, TU.TU_DOOR + 2, '+2 UT de rotação');
    t.eq(A.validate(C, { type: 'door', unitId: s2.id, i: I(C, 9, 3), part: 1 }).reason, 'noDoor');
    const s3 = soldier(C, 8, 8);
    t.eq(A.validate(C, { type: 'door', unitId: s3.id, i: I(C, 5, 3) }).reason, 'tooFar');
    const d = act(C, { type: 'door', unitId: s2.id, i: I(C, 5, 3) });
    t.eq(types(d.ev).filter((x) => x !== 'spotted'), ['turn', 'turn', 'tile', 'door']);
    t.eq([s2.dir, s2.tu, s2.x], [2, 54, 4]);
    t.eq(A.validate(C, { type: 'door', unitId: s2.id, i: I(C, 5, 3), part: 1 }).reason, 'invalid', 'já aberta');
    // porta OVNI: abre o grupo (ufoDoorOpen), a peça fica fechada
    const E = fixture();
    E.map.parts[I(E, 6, 3) * 4 + 3] = id('UFO.ufoDoor');
    E.map.parts[I(E, 6, 4) * 4 + 3] = id('UFO.ufoDoor');
    const s4 = soldier(E, 5, 3, { dir: 2 });
    sight(E);
    const u = act(E, { type: 'door', unitId: s4.id, i: I(E, 6, 3) });
    t.eq(types(u.ev).filter((x) => x !== 'spotted'), ['door']);
    t.eq([u.ev[0].kind, E.map.ufoDoorOpen[I(E, 6, 3)], E.map.ufoDoorOpen[I(E, 6, 4)], s4.tu], ['ufo', 1, 1, 56]);
    t.eq(BM.def(E.map, I(E, 6, 3), 3).key, 'UFO.ufoDoor');
  });

  // ---- rodar / ajoelhar ------------------------------------------------------------------------------------
  t.test('Rodar: 1 UT por 45°, pelo caminho mais curto (180° no sentido horário); ajoelhar 4 / levantar 8', () => {
    const B = fixture();
    const s = soldier(B, 5, 5, { dir: 0 });
    sight(B);
    const r = act(B, { type: 'turn', unitId: s.id, dir: 6 });
    t.eq(r.ev.map((e) => [e.from, e.to]), [[0, 7], [7, 6]]);
    t.eq(s.tu, 58);
    const h = act(B, { type: 'turn', unitId: s.id, dir: 2 });
    t.eq(h.ev.map((e) => e.to), [7, 0, 1, 2], 'meia-volta 6→2 no sentido horário');
    t.eq(s.tu, 54);
    t.eq(A.validate(B, { type: 'turn', unitId: s.id, toI: I(B, 5, 9) }).dir, 4, 'virar para um tile');
    t.eq(A.validate(B, { type: 'turn', unitId: s.id, dir: 2 }).reason, 'invalid');
    act(B, { type: 'kneel', unitId: s.id });
    t.eq([s.kneel, s.tu], [true, 50]);
    act(B, { type: 'kneel', unitId: s.id });
    t.eq([s.kneel, s.tu], [false, 42]);
    const a = alien(B, 'sectoid_soldier', 10, 10);
    B.side = 'alien';
    t.eq(A.validate(B, { type: 'kneel', unitId: a.id }).reason, 'cantKneel', 'só soldados');
    t.eq(A.validate(B, { type: 'kneel', unitId: s.id }).reason, 'notYourTurn');
  });

  // ---- fogo de reação --------------------------------------------------------------------------------------
  t.test('Reação: alienígena rápido com UT completas reage ao soldado que entra na vista (só tiro rápido, UT gastas)', () => {
    const B = fixture();
    const s = soldier(B, 2, 5, { dir: 2, armour: 'power_suit' });
    const a = alien(B, 'sectoid_soldier', 10, 5, { dir: 6 });
    const gun = arm(B, a, 'plasma_pistol', 'plasma_pistol_clip');
    sight(B);
    t.eq(A.reactionScore(a), 63);
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 3, 5) });
    const reac = ofType(r.ev, 'reaction');
    t.eq(reac.length, 1, 'uma reação: depois do tiro a pontuação do alien (44) fica abaixo da do soldado (46)');
    t.eq([reac[0].reactorId, reac[0].targetId, reac[0].mode], [a.id, s.id, 'snap']);
    t.ok(ofType(r.ev, 'shot').every((e) => e.mode === 'snap' && e.shooterId === a.id));
    t.eq(ofType(r.ev, 'shot').length, 1);
    t.eq(a.tu, 54 - BU.actionTU(B, a, gun.id, 'snap'));
    t.eq(gun.ammo.rounds, 25);
    t.eq(types(r.ev).indexOf('step'), 0, 'o passo vem antes da reação');
  });

  t.test('Reação: o ciclo reavalia (vários tiros do mesmo reator até a pontuação descer ou faltarem UT)', () => {
    const B = fixture();
    const s = soldier(B, 2, 5, { dir: 2, armour: 'power_suit', stats: { hp: 60 } });
    const a = alien(B, 'sectoid_soldier', 10, 5, { dir: 6 });
    a.stats.react = 200;
    const gun = arm(B, a, 'plasma_pistol', 'plasma_pistol_clip');
    sight(B);
    const cost = BU.actionTU(B, a, gun.id, 'snap');
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 3, 5) });
    const n = ofType(r.ev, 'reaction').length;
    // 54 UT, 16 por tiro, exige UT > custo: 54→38→22→6
    t.eq(n, 3);
    t.eq(a.tu, 54 - 3 * cost);
    t.ok(ofType(r.ev, 'shot').every((e) => e.mode === 'snap'), 'nunca rajada nem apontado');
    // um segundo alien com pontuação menor que o soldado não reage
    t.eq(a.exp.react, 0, 'só a X-COM ganha experiência de reação');
  });

  t.test('Reação X-COM no turno alienígena: soldado vigilante dispara e ganha +1 exp de reação; nada no turno civil', () => {
    const B = fixture();
    const s = soldier(B, 2, 5, { dir: 2, stats: { react: 100 } });
    const a = alien(B, 'sectoid_soldier', 10, 5, { dir: 6 });
    arm(B, a, 'plasma_pistol', 'plasma_pistol_clip');
    a.armour = [200, 200, 200, 200, 200];
    sight(B);
    B.side = 'alien';
    const r = act(B, { type: 'walk', unitId: a.id, to: I(B, 9, 5) });
    const reac = ofType(r.ev, 'reaction');
    t.ok(reac.length >= 1);
    t.eq([reac[0].reactorId, reac[0].mode], [s.id, 'snap']);
    t.eq(s.exp.react, reac.length);
    t.eq(s.tu, 60 - reac.length * 15);
    // turno civil: sem reações
    const C = fixture();
    const s2 = soldier(C, 2, 5, { dir: 2, stats: { react: 100 } });
    const c = BU.fromCivilian(C, 'civilian_m', OV.RNG.create(1));
    BU.placeUnit(C, c, I(C, 10, 5));
    sight(C);
    C.side = 'civ';
    const rc = act(C, { type: 'walk', unitId: c.id, to: I(C, 9, 5) });
    t.eq(ofType(rc.ev, 'reaction').length, 0);
    t.eq(s2.tu, 60);
  });

  t.test('Reação corpo a corpo primeiro quando adjacente e virado (Crisálida), e explosivos alienígenas evitam amigos', () => {
    const B = fixture();
    const s = soldier(B, 3, 5, { dir: 2, armour: 'power_suit', stats: { hp: 60 } });
    alien(B, 'chryssalid', 6, 5, { dir: 6 });
    sight(B);
    const r = act(B, { type: 'walk', unitId: s.id, to: I(B, 5, 5) });
    const reac = ofType(r.ev, 'reaction');
    t.ok(reac.length >= 1, 'a Crisálida reage');
    t.eq(reac[0].mode, 'melee');
    t.ok(ofType(r.ev, 'melee').length >= 1);
    // lançador de atordoamento: com um alienígena junto ao alvo não dispara
    const C = fixture();
    const s2 = soldier(C, 2, 5, { dir: 2 });
    const a = alien(C, 'sectoid_medic', 10, 5, { dir: 6 });
    arm(C, a, 'small_launcher', 'stun_bomb');
    alien(C, 'sectoid_soldier', 4, 6, { dir: 0 });
    sight(C);
    const r2 = act(C, { type: 'walk', unitId: s2.id, to: I(C, 3, 5) });
    t.eq(ofType(r2.ev, 'reaction').filter((e) => e.reactorId === a.id).length, 0);
  });

  // ---- disparar --------------------------------------------------------------------------------------------
  t.test('Disparar: snap gasta 25 % UT + rotação e 1 bala; rajada 3 balas e 35 % UT; sem munição; noLOF/força', () => {
    const B = fixture();
    const s = soldier(B, 2, 5, { dir: 1 });
    const a = alien(B, 'sectoid_soldier', 9, 5, { dir: 0 });
    a.armour = [255, 255, 255, 255, 255];
    a.hp = a.hpMax = 999;
    a.stats.react = 0; // não responde aos tiros
    sight(B);
    const gun = BU.item(B, s, 'R');
    const v = A.validate(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'snap', target: { unitId: a.id } });
    t.eq([v.ok, v.tu, v.actionTU, v.turnTU, v.accuracy], [true, 16, 15, 1, 33]);
    const r = act(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'snap', target: { unitId: a.id } });
    t.eq(types(r.ev).slice(0, 2), ['turn', 'shot']);
    t.eq(ofType(r.ev, 'shot').length, 1);
    t.eq([s.tu, gun.ammo.rounds, s.dir], [44, 19, 2]);
    const au = act(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'auto', target: { unitId: a.id } });
    t.eq(ofType(au.ev, 'shot').map((e) => e.round), [0, 1, 2]);
    t.eq([s.tu, gun.ammo.rounds], [23, 16]);
    t.eq(A.validate(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'aimed', target: { unitId: a.id } }).reason, 'noTU');
    gun.ammo = null;
    t.eq(A.validate(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'snap', target: { unitId: a.id } }).reason, 'noAmmo');
    t.eq(A.validate(B, { type: 'shoot', unitId: s.id, hand: 'L', mode: 'snap', target: { unitId: a.id } }).reason, 'noWeapon');
    // parede no caminho: sem linha de tiro, salvo forçado (Ctrl)
    const C = fixture();
    for (let y = 0; y < 16; y++) C.map.parts[I(C, 6, y) * 4 + 1] = id('FARM.wall');
    const s2 = soldier(C, 2, 5, { dir: 2 });
    sight(C);
    t.eq(A.validate(C, { type: 'shoot', unitId: s2.id, hand: 'R', mode: 'snap', target: { i: I(C, 9, 5) } }).reason, 'noLOF');
    t.ok(A.validate(C, { type: 'shoot', unitId: s2.id, hand: 'R', mode: 'snap', target: { i: I(C, 9, 5) }, force: true }).ok);
    const al = alien(C, 'sectoid_soldier', 9, 5);
    sight(C);
    t.eq(A.validate(C, { type: 'shoot', unitId: s2.id, hand: 'R', mode: 'snap', target: { unitId: al.id } }).reason, 'notVisible');
    t.eq(A.validate(C, { type: 'shoot', unitId: s2.id, hand: 'R', mode: 'snap', target: { i: I(C, 2, 5) } }).reason, 'invalid', 'o próprio tile');
    // equipamento por investigar
    C.researched = ['laser_weapons'];
    const p = soldier(C, 2, 9, { loadout: { R: 'plasma_rifle', L: null, belt: ['plasma_rifle_clip'], pack: [] } });
    t.eq(A.validate(C, { type: 'shoot', unitId: p.id, hand: 'R', mode: 'snap', target: { i: I(C, 4, 9) } }).reason, 'notResearched');
  });

  t.test('Disparar mata o último alienígena ⇒ battleEnd «win» e mais ações recusadas', () => {
    const B = fixture(20, 16, 1, 11, true);
    const s = soldier(B, 2, 5, { dir: 2, stats: { fire: 120 } });
    const a = alien(B, 'sectoid_soldier', 4, 5, { dir: 0 });
    a.hp = 1;
    a.armour = [0, 0, 0, 0, 0];
    sight(B);
    let r = null;
    for (let k = 0; k < 4 && BT.outcome(B) === null; k++) r = act(B, { type: 'shoot', unitId: s.id, hand: 'R', mode: 'snap', target: { unitId: a.id } });
    t.eq(BT.outcome(B), 'win');
    t.eq(r.ev[r.ev.length - 1], { t: 'battleEnd', result: 'win', vis: true, pos: -1 });
    t.eq(B.phase, 'over');
    t.eq(A.validate(B, { type: 'kneel', unitId: s.id }).reason, 'battleOver');
  });

  // ---- arremesso -------------------------------------------------------------------------------------------
  t.test('Granada: ativar 50 % + lançar 25 %; sem «instantâneas» rebenta no fim do turno; com elas ao aterrar', () => {
    const B = fixture();
    B.settings.instantGrenades = false;
    const s = soldier(B, 2, 5, { dir: 2, loadout: { R: 'grenade', L: null, belt: [], pack: [] } });
    sight(B);
    const g = BU.item(B, s, 'R');
    t.eq(A.validate(B, { type: 'throw', unitId: s.id, itemId: g.id, toI: I(B, 19, 15) }).reason, 'tooFar');
    t.eq(A.validate(B, { type: 'prime', unitId: s.id, itemId: g.id, fuse: 9 }).reason, 'invalid', 'espoleta 0..5');
    const p = act(B, { type: 'prime', unitId: s.id, itemId: g.id, fuse: 0 });
    t.eq(types(p.ev), ['prime']);
    t.eq([g.fuse, g.primedBy, s.tu], [0, s.id, 30]);
    t.eq(A.validate(B, { type: 'prime', unitId: s.id, itemId: g.id, fuse: 0 }).reason, 'alreadyPrimed');
    const v = A.validate(B, { type: 'throw', unitId: s.id, itemId: g.id, toI: I(B, 9, 5) });
    t.eq([v.ok, v.tu, v.range], [true, 15, 18], 'alcance: Força 40 × 4 / (3 + 3) = 26 → máximo 18');
    const r = act(B, { type: 'throw', unitId: s.id, itemId: g.id, toI: I(B, 9, 5) });
    const th = ofType(r.ev, 'throw')[0];
    t.ok(th && th.arc.length >= 3, 'arco');
    t.eq([g.owner, g.at, s.tu, s.exp.thr], [null, th.land, 15, 1]);
    t.eq(ofType(r.ev, 'explosion').length, 0, 'ainda não rebentou');
    const [lx, ly] = BM.xyz(B.map, th.land);
    t.ok(Math.abs(lx - 9) <= 3 && Math.abs(ly - 5) <= 3, 'aterra perto do alvo (' + lx + ',' + ly + ')');
    const e = withoutAI(() => run(BT.endPlayerTurn(B)));
    t.eq(ofType(e.ev, 'explosion').length, 1, 'rebenta no fim do turno X-COM');
    t.eq(BU.findItem(B, g.id), null);
    // com granadas instantâneas
    const C = fixture();
    const s2 = soldier(C, 2, 5, { dir: 2, loadout: { R: 'grenade', L: null, belt: [], pack: [] } });
    sight(C);
    const g2 = BU.item(C, s2, 'R');
    act(C, { type: 'prime', unitId: s2.id, itemId: g2.id, fuse: 0 });
    const r2 = act(C, { type: 'throw', unitId: s2.id, itemId: g2.id, toI: I(C, 9, 5) });
    t.eq(ofType(r2.ev, 'explosion').length, 1);
    t.ok(types(r2.ev).indexOf('throw') < types(r2.ev).indexOf('explosion'));
    t.eq(BU.findItem(C, g2.id), null);
    // espoleta 2: não rebenta ao aterrar mesmo com instantâneas
    const s3 = soldier(C, 2, 12, { dir: 2, loadout: { R: 'grenade', L: null, belt: [], pack: [] } });
    const g3 = BU.item(C, s3, 'R');
    act(C, { type: 'prime', unitId: s3.id, itemId: g3.id, fuse: 2 });
    const r3 = act(C, { type: 'throw', unitId: s3.id, itemId: g3.id, toI: I(C, 8, 12) });
    t.eq(ofType(r3.ev, 'explosion').length, 0);
    t.ok(BU.findItem(C, g3.id).at !== null);
  });

  t.test('Arremesso: uma parede alta no meio obriga a arco; sem arco possível ⇒ noArc; sinalizador ilumina', () => {
    const B = fixture(20, 16, 1);
    // caixa fechada à volta do alvo (paredes nos 4 lados) num mapa de 1 nível: nenhum arco lá chega
    const tx = 10, ty = 5;
    B.map.parts[I(B, tx, ty) * 4 + 1] = id('FARM.wall');
    B.map.parts[I(B, tx + 1, ty) * 4 + 1] = id('FARM.wall');
    B.map.parts[I(B, tx, ty) * 4 + 2] = id('FARM.wall.n');
    B.map.parts[I(B, tx, ty + 1) * 4 + 2] = id('FARM.wall.n');
    B.map.ceiling = true;
    const s = soldier(B, 4, 5, { dir: 2, loadout: { R: 'electro_flare', L: null, belt: [], pack: [] } });
    sight(B);
    const f = BU.item(B, s, 'R');
    t.eq(A.validate(B, { type: 'throw', unitId: s.id, itemId: f.id, toI: I(B, tx, ty) }).reason, 'noArc');
    // de noite: o sinalizador no chão ilumina e revela
    const C = fixture(20, 16, 1);
    C.mission.shade = 13;
    const s2 = soldier(C, 2, 5, { dir: 2, loadout: { R: 'electro_flare', L: null, belt: [], pack: [] } });
    const a = alien(C, 'sectoid_soldier', 14, 5, { dir: 0 });
    sight(C);
    t.ok(!OV.LOS.isVisibleTo(C, 'xcom', a), 'às escuras não se vê a 12 tiles');
    const f2 = BU.item(C, s2, 'R');
    const r = act(C, { type: 'throw', unitId: s2.id, itemId: f2.id, toI: I(C, 13, 5) });
    t.ok(OV.LOS.isVisibleTo(C, 'xcom', a), 'o sinalizador revela o alienígena');
    t.ok(ofType(r.ev, 'spotted').some((e) => e.unitId === a.id));
  });

  // ---- recarregar / inventário -----------------------------------------------------------------------------
  t.test('Recarregar: 15 UT, carregador do cinto consumido; já carregada ⇒ loaded; sem carregador ⇒ noAmmo', () => {
    const B = fixture();
    const s = soldier(B, 2, 2, { loadout: { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip'], pack: [] } });
    sight(B);
    const gun = BU.item(B, s, 'R');
    t.eq(A.validate(B, { type: 'reload', unitId: s.id, hand: 'R' }).reason, 'loaded');
    gun.ammo = null;
    const clip = BU.item(B, s, 'belt')[0];
    const r = act(B, { type: 'reload', unitId: s.id, hand: 'R' });
    t.eq(types(r.ev), ['reload']);
    t.eq([gun.ammo, s.tu, BU.findItem(B, clip.id), s.items.belt.length], [{ type: 'rifle_clip', rounds: 20 }, 45, null, 0]);
    gun.ammo = null;
    t.eq(A.validate(B, { type: 'reload', unitId: s.id, hand: 'R' }).reason, 'noAmmo');
    const l = soldier(B, 5, 5, { loadout: { R: 'laser_rifle', L: null, belt: [], pack: [] } });
    t.eq(A.validate(B, { type: 'reload', unitId: l.id, hand: 'R' }).reason, 'invalid', 'laser não tem carregador');
  });

  t.test('Inventário: tabela de UT (cinto→mão 4, mochila→mão 8, mão→chão 2, chão→mochila 20), mão ocupada, apanhar', () => {
    const B = fixture();
    const s = soldier(B, 2, 2, { loadout: { R: null, L: null, belt: ['grenade'], pack: ['rifle_clip'] } });
    sight(B);
    const g = BU.item(B, s, 'belt')[0];
    const c = BU.item(B, s, 'pack')[0];
    let r = act(B, { type: 'inv', unitId: s.id, itemId: g.id, to: 'R' });
    t.eq([types(r.ev), s.items.R, s.tu], [['inv'], g.id, 56]);
    r = act(B, { type: 'inv', unitId: s.id, itemId: c.id, to: 'L' });
    t.eq([s.items.L, s.tu], [c.id, 48]);
    t.eq(A.validate(B, { type: 'inv', unitId: s.id, itemId: g.id, to: 'L' }).reason, 'slotFull');
    r = act(B, { type: 'inv', unitId: s.id, itemId: g.id, to: 'ground' });
    t.eq([types(r.ev), g.at, g.owner, s.tu], [['drop'], I(B, 2, 2), null, 46]);
    r = act(B, { type: 'pickup', unitId: s.id, itemId: g.id, to: 'pack' });
    t.eq([types(r.ev), s.items.pack, s.tu], [['pickup'], [g.id], 26]);
    // corpo de unidade 2×2 não se carrega
    const body = BU.newItem(B, 'cyberdisc_corpse', { at: I(B, 2, 2) });
    t.eq(A.validate(B, { type: 'pickup', unitId: s.id, itemId: body.id, to: 'R' }).reason, 'tooHeavy');
    const far = BU.newItem(B, 'grenade', { at: I(B, 9, 9) });
    t.eq(A.validate(B, { type: 'pickup', unitId: s.id, itemId: far.id, to: 'R' }).reason, 'tooFar');
    // mochila cheia
    for (let k = 0; k < 3; k++) BU.giveItem(B, s, BU.newItem(B, 'rifle').id, 'pack', true);
    const x = BU.newItem(B, 'pistol', { at: I(B, 2, 2) });
    t.eq(A.validate(B, { type: 'pickup', unitId: s.id, itemId: x.id, to: 'pack' }).reason, 'noRoom');
  });

  // ---- kit médico / corpo a corpo / detetor ----------------------------------------------------------------
  t.test('Kit médico: curar −1 ferida +3 HP, estimulante +10 energia −4 atordoamento (acorda), analgésico; 10 UT', () => {
    const B = fixture();
    const m = soldier(B, 2, 2, { loadout: { R: 'medikit', L: null, belt: [], pack: [] } });
    const p = soldier(B, 3, 2);
    sight(B);
    p.wounds[1] = 2;
    p.hp = 20;
    const kit = BU.item(B, m, 'R');
    const r = act(B, { type: 'medikit', unitId: m.id, targetId: p.id, part: 1, kind: 'heal' });
    t.eq(types(r.ev), ['medikit']);
    t.eq([p.wounds[1], p.hp, kit.charges.heal, m.tu], [1, 23, 9, 50]);
    t.eq(A.validate(B, { type: 'medikit', unitId: m.id, targetId: p.id, part: 0, kind: 'heal' }).reason, 'noWound');
    p.morale = 40;
    act(B, { type: 'medikit', unitId: m.id, targetId: p.id, kind: 'pain' });
    t.eq([p.morale, kit.charges.pain], [57, 9], 'moral + HP perdidos (17)');
    // estimulante num inconsciente adjacente
    p.stun = 30;
    p.hp = 25;
    OV.Combat.knockOut(B, p, null);
    t.eq(p.status, 'out');
    p.stun = 27;
    const st = act(B, { type: 'medikit', unitId: m.id, targetId: p.id, kind: 'stim' });
    t.eq([p.stun, p.status], [23, 'ok']);
    t.ok(ofType(st.ev, 'wake').length === 1, 'acorda');
    const far = soldier(B, 9, 9);
    far.wounds[0] = 1;
    t.eq(A.validate(B, { type: 'medikit', unitId: m.id, targetId: far.id, part: 0, kind: 'heal' }).reason, 'tooFar');
    kit.charges.heal = 0;
    t.eq(A.validate(B, { type: 'medikit', unitId: m.id, targetId: m.id, part: 0, kind: 'heal' }).reason, 'noCharges');
  });

  t.test('Bastão atordoador: 30 % UT, adjacente; longe ⇒ tooFar; detetor de movimento (25 %) devolve blips', () => {
    const B = fixture();
    const s = soldier(B, 2, 2, { dir: 2, loadout: { R: 'stun_rod', L: null, belt: [], pack: [] } });
    const a = alien(B, 'sectoid_soldier', 3, 2, { dir: 0 });
    sight(B);
    const v = A.validate(B, { type: 'melee', unitId: s.id, targetId: a.id });
    t.eq([v.ok, v.tu], [true, 18]);
    const r = act(B, { type: 'melee', unitId: s.id, targetId: a.id });
    t.eq(types(r.ev)[0], 'melee');
    t.eq(s.tu, 42);
    const b = alien(B, 'sectoid_soldier', 8, 8);
    t.eq(A.validate(B, { type: 'melee', unitId: s.id, targetId: b.id }).reason, 'tooFar');
    // detetor
    const C = fixture();
    const d = soldier(C, 5, 5, { loadout: { R: 'motion_scanner', L: null, belt: [], pack: [] } });
    const x1 = alien(C, 'sectoid_soldier', 9, 9);
    const x2 = alien(C, 'sectoid_soldier', 7, 3);
    alien(C, 'sectoid_soldier', 18, 5).motion = 90; // fora do alcance
    x1.motion = 120;
    x2.motion = 0;
    sight(C);
    const sc = act(C, { type: 'scanner', unitId: d.id });
    t.eq(d.tu, 45);
    t.eq(sc.ret.blips, [{ i: I(C, 9, 9), x: 9, y: 9, z: 0, size: 4 }]);
    t.eq(ofType(sc.ev, 'scanner')[0].blips.length, 1);
  });

  t.test('Ações inválidas: unidade inconsciente, pânico, tipo desconhecido; endUnit marca done', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    sight(B);
    t.eq(A.validate(B, { type: 'dance', unitId: s.id }).reason, 'invalid');
    s.status = 'panic';
    t.eq(A.validate(B, { type: 'kneel', unitId: s.id }).reason, 'panicking');
    s.status = 'ok';
    const r = act(B, { type: 'endUnit', unitId: s.id });
    t.eq([types(r.ev), s.done], [['endUnit'], true]);
    const bad = act(B, { type: 'walk', unitId: 999, to: 3 });
    t.eq([types(bad.ev), bad.ret.ok, bad.ret.reason], [['interrupt'], false, 'invalid']);
  });

  // ---- fluxo de turnos -------------------------------------------------------------------------------------
  t.test('Turno completo sem IA: beginBattle, endPlayerTurn → turnStart alien/xcom, UT repostas, turno 2', () => {
    withoutAI(() => {
      const C = BT.create(BT.quickMission({ seed: 21, ufoType: 'small_scout', terrain: 'FARM' }));
      t.eq(C.pendingExplosions.length, 1, 'fonte de energia do OVNI caído');
      const c = run(BT.beginBattle(C));
      t.eq([C.pendingExplosions.length, ofType(c.ev, 'explosion').length], [0, 1], 'explosão da queda resolvida no início');
      const B = BT.create(BT.quickMission({ seed: 21, ufoType: 'medium_scout', terrain: 'FARM', landed: true }));
      const b = run(BT.beginBattle(B));
      t.eq(B.phase, 'play');
      t.ok(types(b.ev).indexOf('turnStart') >= 0);
      t.ok(B.brought && B.brought.rifle >= 1, 'equipamento levado registado');
      const s = B.units.find((u) => u.side === 'xcom');
      const to = BM.idx(B.map, Math.min(B.map.w - 1, s.x + 2), s.y, s.z);
      act(B, { type: 'walk', unitId: s.id, to });
      const used = s.tu;
      t.ok(used < s.tuMax);
      const e = run(BT.endPlayerTurn(B));
      const starts = ofType(e.ev, 'turnStart').map((x) => x.side + x.turn);
      t.eq(starts, ['alien1', 'xcom2']);
      t.eq([B.turn, B.side, s.tu, e.ret.outcome], [2, 'xcom', s.tuMax, null]);
      t.ok(B.units.filter((u) => u.side === 'alien' && u.status === 'ok').every((u) => u.tu === u.tuMax), 'alienígenas recuperaram');
      t.ok(B.units.filter((u) => u.side === 'xcom').every((u) => u.turnsSinceSpotted >= 1 || u.turnsSinceSpotted === 0));
      t.ok(B.units.filter((u) => u.side === 'xcom').every((u) => u.done === false && Array.isArray(u.spottedThisTurn)));
    });
  });

  t.test('Fim do turno: portas OVNI fecham, memória dos alienígenas +1, civis jogam o seu turno', () => {
    withoutAI(() => {
      const B = fixture();
      B.map.parts[I(B, 10, 3) * 4 + 3] = id('UFO.ufoDoor');
      B.map.ufoDoorOpen[I(B, 10, 3)] = 1;
      const s = soldier(B, 2, 12, { dir: 4 });
      s.turnsSinceSpotted = 3;
      const a = alien(B, 'sectoid_soldier', 18, 1, { dir: 0 });
      const c = BU.fromCivilian(B, 'civilian_f', OV.RNG.create(2));
      BU.placeUnit(B, c, I(B, 2, 1));
      c.tu = 0;
      sight(B);
      const e = run(BT.endPlayerTurn(B));
      t.eq(ofType(e.ev, 'turnStart').map((x) => x.side), ['alien', 'civ', 'xcom']);
      t.eq(B.map.ufoDoorOpen[I(B, 10, 3)], 0);
      t.ok(ofType(e.ev, 'door').some((x) => x.open === false));
      t.eq(s.turnsSinceSpotted, 4);
      t.eq(c.tu, c.tuMax, 'civis recuperam UT no seu turno');
      t.eq(a.tu, a.tuMax);
    });
  });

  t.test('Fase de pânico X-COM no início do turno: berserk dispara pelas ações (sem UT), estado panic', () => {
    withoutAI(() => {
      const B = fixture();
      const s = soldier(B, 2, 5, { dir: 2 });
      const a = alien(B, 'sectoid_soldier', 9, 5, { dir: 0 });
      a.armour = [255, 255, 255, 255, 255];
      a.hp = a.hpMax = 999;
      for (const it of BU.handItems(B, a)) BU.deleteItem(B, it.id); // desarmado: sem fogo de reação
      s.morale = 0;
      sight(B);
      // procura uma semente que produza berserk
      let found = null;
      for (let seed = 1; seed < 60 && !found; seed++) {
        const C = BT.deserialize(BT.serialize(B));
        C.rng.combat = OV.RNG.create(seed);
        sight(C);
        const e = run(BT.endPlayerTurn(C));
        if (ofType(e.ev, 'morale').some((m) => m.kind === 'berserk' && m.shots > 0)) found = { C, e };
      }
      t.ok(found, 'berserk encontrado');
      const { C, e } = found;
      const u = C.units.find((x) => x.side === 'xcom');
      t.ok(ofType(e.ev, 'shot').length >= 1, 'tiros do berserk');
      t.eq([u.status, u.tu], ['panic', 0]);
      t.eq(A.validate(C, { type: 'walk', unitId: u.id, to: I(C, 3, 5) }).reason, 'panicking');
    });
  });

  // ---- abortar e debriefing --------------------------------------------------------------------------------
  t.test('Abortar: quem está na nave sobrevive, o resto fica desaparecido; debriefing −valor por desaparecido', () => {
    const B = fixture();
    B.craftTiles = [I(B, 1, 1), I(B, 2, 1)];
    const s1 = soldier(B, 1, 1, { missions: 3, rank: 2 });
    const s2 = soldier(B, 10, 10);
    const s3 = soldier(B, 2, 1);
    alien(B, 'sectoid_soldier', 15, 15);
    // s3 inconsciente na nave sobrevive
    OV.Combat.knockOut(B, s3, null);
    const r = BT.abort(B);
    t.eq([r.survivors.sort(), r.mia, r.craftLost], [[s1.id, s3.id].sort(), [s2.id], false]);
    t.eq([s2.mia, s2.onMap, BT.outcome(B), B.phase], [true, false, 'abort', 'over']);
    const db = BT.debrief(B);
    t.eq(db.result, 'abort');
    t.eq(db.mia, [s2.soldierId]);
    t.eq(db.lines, [{ key: 'bs.debrief.xcomMia', n: 1, points: -20 }]);
    t.eq(db.score, -20);
    t.eq(s1.value, 20 + 3 + 1, 'valor = 20 + missões + bónus de patente (Sargento 1)');
  });

  t.test('Debriefing: abates, captura (2×valor / +10 interrogado), civis, soldado morto, nave perdida, artefactos', () => {
    const B = fixture(20, 16, 1, 11, true);
    const s = soldier(B, 1, 1, { missions: 2 });
    const dead = soldier(B, 3, 3);
    const k1 = alien(B, 'sectoid_soldier', 10, 10);
    const k2 = alien(B, 'sectoid_engineer', 11, 10);
    const cap = alien(B, 'sectoid_leader', 12, 10);
    const civ1 = BU.fromCivilian(B, 'civilian_m', OV.RNG.create(3));
    BU.placeUnit(B, civ1, I(B, 5, 5));
    const civ2 = BU.fromCivilian(B, 'civilian_f', OV.RNG.create(4));
    BU.placeUnit(B, civ2, I(B, 6, 5));
    const kill = (u, by) => OV.Combat.killUnit(B, u, by ? by.id : null, 'shot');
    kill(k1, s);
    kill(k2, s);
    kill(civ2, k1);
    kill(dead, k2);
    OV.Combat.knockOut(B, cap, s.id);
    t.eq(BT.outcome(B), 'win');
    B.brought = { rifle: 2, rifle_clip: 2 };
    const db = BT.debrief(B);
    const pts = (k) => (db.lines.find((l) => l.key === k) || { points: null }).points;
    t.eq(db.result, 'win');
    t.eq([db.kills, pts('bs.debrief.aliensKilled')], [2, k1.value + k2.value]);
    t.eq(db.captured, [{ unitType: 'sectoid_leader', unitId: cap.id }]);
    t.eq(pts('bs.debrief.aliensCaptured'), 2 * cap.value);
    t.eq([pts('bs.debrief.civSaved'), pts('bs.debrief.civKilledByAliens')], [30, -30]);
    t.eq(pts('bs.debrief.xcomKilled'), -20);
    t.eq(pts('bs.debrief.craftLost'), null);
    t.eq(db.dead, [dead.soldierId]);
    t.eq(db.recovered.sectoid_corpse, 2);
    t.eq(db.recovered.plasma_pistol >= 2, true, 'armas alienígenas recuperadas');
    t.eq(pts('item.sectoid_corpse'), 10, 'cadáver 5 pontos enquanto não autopsiado');
    t.eq(db.returned.rifle, 2);
    t.ok(!('soldier_corpse' in db.recovered), 'corpos humanos não vão para a base');
    t.eq(db.score, db.lines.reduce((a, l) => a + l.points, 0));
    // com a autópsia e o líder já interrogado
    const db2 = BT.debrief(B, { researched: ['autopsy_sectoid', 'plasma_pistol'], interrogated: ['sectoid_leader'] });
    t.eq((db2.lines.find((l) => l.key === 'bs.debrief.aliensCaptured') || {}).points, 10);
    t.eq(db2.lines.some((l) => l.key === 'item.sectoid_corpse' || l.key === 'item.plasma_pistol'), false);
    // derrota: nave perdida, todos os não mortos desaparecidos, nada recuperado
    const C = fixture();
    const z = soldier(C, 2, 2);
    alien(C, 'sectoid_soldier', 9, 9);
    OV.Combat.knockOut(C, z, null);
    t.eq(BT.outcome(C), 'loss');
    const dl = BT.debrief(C);
    t.eq([dl.result, dl.mia, dl.craftLost, Object.keys(dl.recovered).length], ['loss', [z.soldierId], true, 0]);
    t.eq((dl.lines.find((l) => l.key === 'bs.debrief.craftLost') || {}).points, -D.crafts.skyranger.score);
  });

  t.test('Debriefing de OVNI tomado: fontes de energia/navegação intactas, Elerium, ligas (70 % se caído)', () => {
    withoutAI(() => {
      const win = (B) => {
        for (const u of B.units) if (u.side === 'alien' && u.status !== 'dead') OV.Combat.killUnit(B, u, null, 'shot');
        t.eq(BT.outcome(B), 'win');
        return BT.debrief(B);
      };
      const L = BT.create(BT.quickMission({ seed: 5, ufoType: 'small_scout', terrain: 'FARM', landed: true }));
      run(BT.beginBattle(L));
      const dl = win(L);
      t.eq([dl.recovered.ufo_power_source, dl.recovered.ufo_navigation, dl.recovered.elerium_115, dl.recovered.alien_alloys], [1, 1, 50, 3]);
      t.eq((dl.lines.find((l) => l.key === 'item.ufo_power_source') || {}).points, 20);
      // caído: a explosão da fonte de energia destruiu a consola de navegação (semente 5)
      const C = BT.create(BT.quickMission({ seed: 5, ufoType: 'small_scout', terrain: 'FARM' }));
      run(BT.beginBattle(C));
      const dc = win(C);
      const ps = dc.recovered.ufo_power_source | 0;
      t.eq(dc.recovered.elerium_115 | 0, ps * D.ufoRules.eleriumPerPowerSource);
      t.eq([dc.recovered.ufo_navigation | 0, dc.recovered.alien_alloys], [0, 2]);
    });
  });

  // ---- determinismo e gravação -----------------------------------------------------------------------------
  // lista fixa de ações sobre uma batalha gerada: os soldados avançam, ajoelham e disparam se virem algo;
  // cnt (opcional) conta os eventos por tipo
  function script(B, cnt) {
    const out = [];
    const go = (a) => {
      const ev = run(A.perform(B, a)).ev;
      if (cnt) for (const e of ev) cnt[e.t] = (cnt[e.t] || 0) + 1;
      out.push(ev.map((e) => e.t).join(','));
    };
    const xs = B.units.filter((u) => u.side === 'xcom');
    for (let k = 0; k < xs.length; k++) {
      const u = xs[k];
      if (u.status !== 'ok' || !u.onMap) continue;
      const tx = U.clamp(u.x + ((k * 5) % 9) - 4, 0, B.map.w - 1), ty = U.clamp(u.y + ((k * 3) % 7) - 3, 0, B.map.h - 1);
      go({ type: 'walk', unitId: u.id, to: BM.idx(B.map, tx, ty, u.z) });
      if (k % 3 === 0) go({ type: 'kneel', unitId: u.id });
      const seen = OV.LOS.unitsVisibleTo(B, 'xcom', true);
      if (seen.length) go({ type: 'shoot', unitId: u.id, hand: 'R', mode: 'snap', target: { unitId: seen[0] } });
    }
    return out;
  }
  const U = OV.U;
  // preparação do teste: põe 3 alienígenas a 7–14 tiles do primeiro soldado, virados para ele (há reações e tiros)
  function ambush(B) {
    const s = B.units.find((u) => u.side === 'xcom');
    const al = B.units.filter((u) => u.side === 'alien' && u.status === 'ok').slice(0, 3);
    const dx = Math.sign((B.map.w >> 1) - s.x), dy = Math.sign((B.map.h >> 1) - s.y);
    al.forEach((a, k) => {
      for (let r = 7; r < 15; r++) {
        const x = U.clamp(s.x + dx * r + k * 2, 0, B.map.w - 1), y = U.clamp(s.y + dy * r - k, 0, B.map.h - 1);
        const i = BM.idx(B.map, x, y, 0);
        if (BU.fits(B, a, i)) {
          BU.placeUnit(B, a, i);
          a.dir = U.dirTo(s.x - x, s.y - y);
          break;
        }
      }
    });
    OV.LOS.refreshAll(B);
  }
  t.test('Determinismo: mesma semente + mesmas ações ⇒ mesmo hash (2 turnos completos)', () => {
    withoutAI(() => {
      const play = () => {
        const B = BT.create(BT.quickMission({ seed: 3, ufoType: 'medium_scout', terrain: 'FARM', landed: true }));
        run(BT.beginBattle(B));
        ambush(B);
        const log = [];
        const cnt = {};
        for (let turn = 0; turn < 2; turn++) {
          log.push(script(B, cnt));
          log.push(run(BT.endPlayerTurn(B)).ev.map((e) => e.t).join(','));
        }
        return { h: BT.hash(B), log, cnt };
      };
      const a = play(), b = play();
      t.ok(a.cnt.shot > 0 && a.cnt.reaction > 0, 'houve tiros e reações (' + a.cnt.shot + '/' + a.cnt.reaction + ')');
      t.eq(a.log, b.log);
      t.eq(a.h, b.h);
    });
  });

  t.test('Gravar/carregar entre ações e continuar ⇒ mesmo hash', () => {
    withoutAI(() => {
      const mk = () => {
        const B = BT.create(BT.quickMission({ seed: 3, ufoType: 'medium_scout', terrain: 'FARM', landed: true }));
        run(BT.beginBattle(B));
        ambush(B);
        script(B);
        return B;
      };
      const A1 = mk();
      const saved = JSON.parse(JSON.stringify(BT.serialize(A1)));
      const A2 = BT.deserialize(saved);
      OV.LOS.refreshAll(A2);
      t.eq(BT.hash(A2), BT.hash(A1), 'logo após carregar');
      for (const B of [A1, A2]) {
        script(B);
        run(BT.endPlayerTurn(B));
        script(B);
      }
      t.eq(BT.hash(A2), BT.hash(A1));
    });
  });
};
