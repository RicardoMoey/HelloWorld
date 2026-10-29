/* Testes de combate: js/sim/battle/combat.js (DESIGN.md §3.4, §3.6, §8; REA 03 §3–4) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const C = OV.Combat;
  const id = (k) => D.tileId(k);

  // mapa aberto w×h×d de chão FARM (níveis de cima: chão interior), de dia
  function fixture(w, h, d, seed) {
    const m = BM.create(w || 16, h || 16, d || 1);
    const plane = m.w * m.h;
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = i < plane ? id('FARM.ground') : 0;
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', aborted: false, pendingExplosions: [],
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 0, shade: 0, deploymentId: 'dep_terror_site' }, rng: OV.RNG.streams(seed || 11),
    };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y, z) => BM.idx(B.map, x, y, z || 0);
  let sid = 1;
  function soldier(B, x, y, o) {
    const opt = o || {};
    const s = {
      soldierId: 'C' + sid++, name: 'Teste', nat: 'pt', rank: opt.rank | 0, armour: opt.armour || 'coveralls',
      stats: Object.assign({ tu: 60, sta: 60, hp: 40, brav: 50, react: 50, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 }, opt.stats),
    };
    const u = BU.fromSoldier(B, s, opt.loadout || { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
    BU.placeUnit(B, u, I(B, x, y, opt.z));
    u.dir = opt.dir === undefined ? 2 : opt.dir;
    return u;
  }
  function alien(B, type, x, y, z) {
    const u = BU.fromAlien(B, type, 0, B.rng.map, 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y, z));
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
  // RNG que devolve sempre o mínimo/máximo do intervalo
  const lowRng = { int: (a, b) => Math.min(a, b), pct: () => true };
  const highRng = { int: (a, b) => Math.max(a, b), pct: () => false };
  const ofType = (evs, ty) => evs.filter((e) => e.t === ty);

  // ---- precisão ------------------------------------------------------------------------------------------
  t.test('Precisão: Pontaria 55 com espingarda — snap 33/37, aimed 60/69, auto 19 (REA §3.1)', () => {
    const B = fixture();
    const s = soldier(B, 2, 2);
    const w = s.items.R;
    t.eq([C.accuracy(B, s, w, 'snap'), C.accuracy(B, s, w, 'aimed'), C.accuracy(B, s, w, 'auto')], [33, 60, 19]);
    s.kneel = true;
    t.eq([C.accuracy(B, s, w, 'snap'), C.accuracy(B, s, w, 'aimed')], [37, 69], 'de joelhos ×115/100');
    s.kneel = false;
    t.eq(C.accuracy(B, s, 'rifle', 'snap'), 33, 'por tipo de item');
    // arma de duas mãos com a outra mão ocupada ×80/100
    const g = BU.newItem(B, 'grenade');
    BU.giveItem(B, s, g.id, 'L');
    t.eq(C.accuracy(B, s, w, 'aimed'), 48, '60 × 80/100');
    BU.dropItem(B, s, 'L');
    // saúde: 75 + 25·HP/máx − 10·(cabeça + braços da arma de duas mãos)
    s.hp = 20;
    t.eq(C.healthMod(s, 'R', true), 87);
    t.eq(C.accuracy(B, s, w, 'aimed'), 52, '60 × 87/100');
    s.hp = s.hpMax;
    s.wounds[0] = 1;
    s.wounds[3] = 2;
    t.eq(C.healthMod(s, 'R', true), 70, 'cabeça 1 + braço esquerdo 2 (duas mãos)');
    t.eq(C.healthMod(s, 'R', false), 90, 'uma mão: só o braço direito conta');
    s.wounds = [9, 0, 0, 0, 0, 0];
    t.eq(C.healthMod(s, 'R', false), 10, 'mínimo 10');
    s.wounds = [0, 0, 0, 0, 0, 0];
    t.eq(C.accuracy(B, s, w, 'aimed', { berserk: true }), 30, 'berserk ÷2');
    t.eq(C.accuracy(B, s, w, 'throw'), 60, 'arremesso = Lançamento × saúde');
    t.eq(C.accuracy(B, s, w, 'melee'), 0, 'modo inexistente');
    const rod = soldier(B, 4, 4, { loadout: { R: 'stun_rod', L: null, belt: [], pack: [] } });
    t.eq(C.accuracy(B, rod, rod.items.R, 'melee'), 100, 'bastão: 100 × saúde (sem perícia)');
    const cr = alien(B, 'chryssalid', 8, 8);
    t.eq(C.accuracy(B, cr, cr.items.R, 'melee'), 80, 'garra: 100 × Corpo-a-corpo 80/100');
  });

  // ---- desvio ----------------------------------------------------------------------------------------------
  t.test('Desvio: fórmula inteira de applyAccuracy (ramo largo, ramo estreito, mínimo 1)', () => {
    const o = [0, 0, 20], tg = [96, 0, 11];
    // xDist 96, yDist 0 ⇒ xyShift 48; zDist 9 ⇒ zShift 52. RNG(0,100)=80, acc 60 ⇒ d=20+50=70 ⇒ 52·70/200 = 18
    let r = scripted([80, 18, 0, 9]);
    t.eq(C.deviate(r, o, tg, 60), [96 + 18 - 9, 0 - 9, 11 + 4 - 2]);
    t.eq(r.left(), 0, 'consome 4 valores');
    // ramo estreito: RNG 10, acc 60 ⇒ −50+10 = −40 ⇒ máx(1, negativo) = 1
    r = scripted([10, 1, 0, 0]);
    t.eq(C.deviate(r, o, tg, 60), [97, 0, 11], 'd = 1: RNG(0,1)=1 − 0');
    // yDist dominante: xDist 10, yDist 100 ⇒ xyShift 10/4 + 100 = 102
    r = scripted([100, 0, 0, 0]);
    const v = C.deviate(r, [0, 0, 0], [10, 100, 0], 0);
    // d = 100 + 50 = 150 ⇒ zShift = 102 (z 0) ⇒ 102·150/200 = 76 ⇒ x −38, y −38, z −9
    t.eq(v, [10 - 38, 100 - 38, 0 - 9]);
  });

  t.test('Desvio: 60 % a 6 tiles ⇒ 76–86 % de acertos; 35 % mais disperso; hitChance não toca no estado', () => {
    const B = fixture(40, 20);
    const s = soldier(B, 5, 10, { dir: 2 });
    const tg = soldier(B, 11, 10, { dir: 6 });
    tg.side = 'alien';
    const h0 = BT.hash(B);
    const pct = C.hitChance(B, s, s.items.R, 'aimed', tg, OV.RNG.create(99), 2000);
    t.ok(pct >= 76 && pct <= 86, 'acc 60 a 6 tiles: ' + pct);
    t.eq(BT.hash(B), h0, 'hash intacto (só a stream ui foi usada)');
    s.stats.fire = 32; // aimed 110 ⇒ 35
    t.eq(C.accuracy(B, s, s.items.R, 'aimed'), 35);
    const p35 = C.hitChance(B, s, s.items.R, 'aimed', tg, OV.RNG.create(99), 2000);
    t.ok(p35 >= 60 && p35 <= 76 && p35 < pct, 'acc 35 a 6 tiles: ' + p35);
    t.eq(B.items.find((i) => i.id === s.items.R).ammo.rounds, 20, 'sem gastar munição');
    // alvo atrás de uma rocha: probabilidade baixa
    B.map.parts[I(B, 8, 10) * 4 + 3] = id('FARM.rock');
    s.stats.fire = 55;
    const blocked = C.hitChance(B, s, s.items.R, 'aimed', tg, OV.RNG.create(99), 500);
    t.ok(blocked < 20, 'coberto pela rocha: ' + blocked);
    t.eq(C.hitChance(B, s, s.items.R, 'melee', tg, OV.RNG.create(1), 10), 0, 'espingarda sem corpo a corpo');
  });

  // ---- dano em unidades ---------------------------------------------------------------------------------------
  t.test('Dano: 0–200 % (HE 50–150 %), armadura do lado, desgaste p/10+1, atordoamento RNG(0,p/4), feridas', () => {
    const B = fixture();
    const s = soldier(B, 5, 5);
    // poder 30 AP, rolo 45 ⇒ ×100 % = 45 − frente 12 = 33; stun RNG(0,8)=3; ferida RNG(0,10)=2<33 ⇒ RNG(1,3)=2
    let r = scripted([45, 3, 2, 2]);
    let ev = C.damageUnit(B, s, 30, 'AP', 0, 1, null, { rng: r });
    t.eq(r.left(), 0, 'ordem de consumo: rolo, stun, ferida, nº de feridas');
    t.eq(s.hp, 40 - 33);
    t.eq(s.stun, 3);
    t.eq(s.wounds, [0, 2, 0, 0, 0, 0]);
    t.eq(s.armour[0], 12 - (3 + 1), 'frente 12 − (33/10 + 1)');
    const dmg = ofType(ev, 'damage')[0];
    t.eq([dmg.amount, dmg.stun, dmg.wounds, dmg.armourHit, dmg.part, dmg.hp], [33, 3, 2, 0, 1, 7]);
    t.ok(ofType(ev, 'morale').length >= 1, 'moral pelo ferimento');
    // intervalo do rolo
    const seen = { AP: [1e9, -1], HE: [1e9, -1] };
    const q = fixture(4, 4);
    const v = soldier(q, 1, 1, { stats: { hp: 1000 } });
    v.armour = [0, 0, 0, 0, 0];
    v.armourMax = [0, 0, 0, 0, 0];
    for (let k = 0; k < 3000; k++) {
      for (const ty of ['AP', 'HE']) {
        const hp0 = v.hp;
        v.hp = 1000;
        v.stun = 0;
        v.wounds = [0, 0, 0, 0, 0, 0];
        v.armour = [0, 0, 0, 0, 0];
        C.damageUnit(q, v, 50, ty, 0, 1, null, {});
        const p = 1000 - v.hp;
        seen[ty][0] = Math.min(seen[ty][0], p);
        seen[ty][1] = Math.max(seen[ty][1], p);
        void hp0;
      }
    }
    t.ok(seen.AP[0] <= 3 && seen.AP[1] >= 97 && seen.AP[1] <= 100, 'AP 0–200 %: ' + seen.AP);
    t.ok(seen.HE[0] >= 25 && seen.HE[0] <= 28 && seen.HE[1] >= 72 && seen.HE[1] <= 75, 'HE 50–150 %: ' + seen.HE);
    // armadura absorve tudo
    const pa = soldier(B, 8, 8, { armour: 'power_suit' });
    ev = C.damageUnit(B, pa, 30, 'AP', 0, 1, null, { rng: scripted([60]) });
    t.eq([pa.hp, pa.armour[0], ofType(ev, 'damage')[0].absorbed], [40, 100, true], 'fato energético: 60 − 100 ⇒ nada');
    // STUN só atordoa; IN ignora a armadura e não fere nem desgasta
    const b = soldier(B, 10, 10);
    C.damageUnit(B, b, 20, 'STUN', 0, 1, null, { rng: scripted([30]) });
    t.eq([b.hp, b.stun, b.armour[0]], [40, 30 - 12, 12 - 0], 'STUN: 30 − 12 = 18 de atordoamento');
    C.damageUnit(B, b, 10, 'IN', 0, 1, null, { rng: scripted([10]) });
    t.eq([b.hp, b.armour[0], b.wounds], [30, 12, [0, 0, 0, 0, 0, 0]], 'IN ignora armadura');
    // modificador: Muton AP 60 %
    const mu = alien(B, 'muton_soldier', 12, 12);
    const hp = mu.hp;
    C.damageUnit(B, mu, 50, 'AP', 0, 1, null, { rng: scripted([100, 0]) });
    t.eq(hp - mu.hp, 60 - mu.armourMax[0], 'Muton: 100 × 60 % − frente');
    t.eq(mu.wounds, [0, 0, 0, 0, 0, 0], 'aliens não sangram');
  });

  t.test('Dano: lado do impacto (frente/lados/traseira, zonas de 45°) e parte do corpo pela altura', () => {
    const u = { dir: 0, height: 22, kneelHeight: 14, kneel: false };
    t.eq(C.impactSide(u, 0, -5, lowRng), 0, 'impacto a norte, virado a norte ⇒ frente');
    t.eq(C.impactSide(u, 0, 5, lowRng), 3, 'sul ⇒ traseira');
    t.eq(C.impactSide(u, 5, 0, lowRng), 2, 'este ⇒ direita');
    t.eq(C.impactSide(u, -5, 0, lowRng), 1, 'oeste ⇒ esquerda');
    t.eq([C.impactSide(u, 3, -3, scripted([0])), C.impactSide(u, 3, -3, scripted([2]))], [0, 2], 'NE: 2/3 frente, 1/3 direita');
    t.eq(C.impactSide(u, 0, 0, lowRng), 4, 'mesmo ponto ⇒ por baixo');
    t.eq(C.impactSide(Object.assign({}, u, { dir: 4 }), 0, -5, lowRng), 3, 'virado a sul, impacto a norte ⇒ traseira');
    t.eq([C.bodyPart(u, 21, 0, lowRng), C.bodyPart(u, 20, 0, lowRng), C.bodyPart(u, 19, 2, lowRng)], [0, 1, 2], 'cabeça só na camada de cima (relZ ≥ h − 1)');
    t.eq([C.bodyPart(u, 10, 0, lowRng), C.bodyPart(u, 10, 1, lowRng), C.bodyPart(u, 10, 2, lowRng)], [1, 3, 2], 'tronco/braços');
    t.eq([C.bodyPart(u, 2, 1, lowRng), C.bodyPart(u, 2, 2, lowRng), C.bodyPart(u, 2, 0, scripted([5]))], [5, 4, 5], 'pernas');
    t.eq(C.bodyPart(u, 2, 4, lowRng), 1, 'por baixo ⇒ tronco');
  });

  // ---- tiros ---------------------------------------------------------------------------------------------------
  t.test('Tiro: auto = 3 balas com munição gasta; carregador vazio desaparece; eventos shot/impact/damage', () => {
    const B = fixture(30, 12);
    const s = soldier(B, 2, 5, { dir: 2 });
    const a = alien(B, 'sectoid_soldier', 6, 5);
    a.dir = 6;
    const w = BU.findItem(B, s.items.R);
    const ev = C.resolveShot(B, s, w.id, 'auto', a, B.rng.combat);
    const shots = ofType(ev, 'shot');
    t.eq(shots.length, 3, 'três balas (a rajada continua mesmo que o alvo caia)');
    t.eq(w.ammo ? w.ammo.rounds : 0, 20 - shots.length, 'munição gasta');
    for (const sh of shots) {
      t.ok(Array.isArray(sh.path) && sh.path.length >= 2, 'trajetória amostrada');
      t.eq([sh.shooterId, sh.weapon, sh.mode, sh.dmgType, sh.ammo], [s.id, 'rifle', 'auto', 'AP', 'rifle_clip']);
      t.eq(sh.to, sh.hit.voxel);
    }
    t.eq(ofType(ev, 'impact').length, shots.length, 'um impacto por bala');
    // carregador com 1 bala: dispara uma e o carregador desaparece
    w.ammo = { type: 'rifle_clip', rounds: 1 };
    const ev2 = C.resolveShot(B, s, w.id, 'auto', I(B, 20, 5), B.rng.combat);
    t.eq(ofType(ev2, 'shot').length, 1);
    t.eq(w.ammo, null, 'vazio ⇒ null');
    const ev3 = C.resolveShot(B, s, w.id, 'snap', I(B, 20, 5), B.rng.combat);
    t.eq(ev3.map((e) => [e.t, e.reason]), [['interrupt', 'noAmmo']]);
    // laser: munição infinita
    const l = soldier(B, 2, 9, { loadout: { R: 'laser_rifle', L: null, belt: [], pack: [] } });
    const evL = C.resolveShot(B, l, l.items.R, 'auto', I(B, 25, 9), B.rng.combat);
    t.eq(ofType(evL, 'shot').length, 3);
    t.eq(ofType(evL, 'shot')[0].ammo, null);
  });

  t.test('Tiro: acerto certeiro (rng baixo) fere o alvo; experiência de pontaria só contra inimigos', () => {
    const B = fixture(20, 12);
    const s = soldier(B, 2, 5, { dir: 2, stats: { fire: 120 } });
    const a = alien(B, 'muton_soldier', 6, 5);
    a.dir = 6;
    const hp = a.hp;
    // RNG baixo: desvio mínimo, rolo de dano mínimo; usar o máximo para o rolo do dano
    const r = { int: (lo, hi) => (lo === 0 && hi === 100 ? 0 : hi === 200 || hi >= 40 ? hi : lo), pct: () => true };
    const ev = C.resolveShot(B, s, s.items.R, 'snap', a, r);
    const sh = ofType(ev, 'shot')[0];
    t.eq([sh.hit.kind, sh.hit.unitId], ['unit', a.id], 'acertou');
    t.ok(a.hp < hp, 'feriu');
    t.eq(s.exp.fire, 1, 'exp +1');
    t.eq(a.ai.wasHitBy, [s.id], 'o alien lembra-se de quem o atingiu');
    t.eq(s.turnsSinceSpotted, 0, 'atirador revelado');
    // tiro contra o chão: experiência não sobe
    C.resolveShot(B, s, s.items.R, 'snap', I(B, 15, 9), r);
    t.eq(s.exp.fire, 1);
  });

  t.test('Impacto em terreno: RNG(25,75) % do poder contra a armadura → entulho; chão térreo → queimado', () => {
    const B = fixture();
    const i = I(B, 5, 5);
    B.map.parts[i * 4 + 1] = id('FARM.wall'); // armadura 40
    const hit = { kind: 'west', i, part: 1, unitId: null, voxel: [5 * 16, 5 * 16 + 8, 10] };
    let ev = C.applyImpact(B, hit, 70, 'AP', null, { rng: scripted([50]) });
    t.eq(BM.def(B.map, i, 1).key, 'FARM.wall', '70 × 50 % = 35 < 40');
    t.eq(ofType(ev, 'impact').length, 1);
    ev = C.applyImpact(B, hit, 70, 'AP', null, { rng: scripted([75]) });
    t.eq(BM.def(B.map, i, 1).key, 'FARM.rubbleWall', '52 ≥ 40 ⇒ entulho');
    t.eq(ofType(ev, 'tile').map((e) => [e.i, e.part]), [[i, 1]]);
    const fl = { kind: 'floor', i, part: 0, unitId: null, voxel: [88, 88, 0] };
    C.applyImpact(B, fl, 200, 'LASER', null, { rng: scripted([50]) });
    t.eq(BM.def(B.map, i, 0).key, 'FARM.scorched', 'chão do nível 0 ⇒ queimado');
    C.applyImpact(B, fl, 255, 'PLASMA', null, { rng: scripted([75]) });
    t.eq(BM.def(B.map, i, 0).key, 'FARM.scorched', 'queimado é indestrutível');
    t.eq(C.applyImpact(B, fl, 100, 'STUN', null, { rng: scripted([]) }).length, 1, 'atordoamento não estraga terreno');
    t.eq(C.damageTerrain(B, i, 3, 999), [], 'parte vazia');
  });

  // ---- morte, inconsciência, zombificação ----------------------------------------------------------------------------
  t.test('Morte: cadáver (unitId) + itens no chão, fora de unitAt, contagens e abates', () => {
    const B = fixture();
    const s = soldier(B, 3, 3);
    const a = alien(B, 'sectoid_soldier', 5, 5);
    const ti = BU.unitTile(B, a);
    const items = BU.allItems(B, a).map((x) => x.id);
    s.morale = 50;
    const ev = C.damageUnit(B, a, 100, 'AP', 0, 1, s.id, { rng: highRng });
    t.eq(a.status, 'dead');
    t.eq(B._.unitAt[ti], 0, 'saiu de unitAt');
    const death = ofType(ev, 'death')[0];
    t.eq([death.unitId, death.killerId, death.i], [a.id, s.id, ti]);
    const corpse = BU.findItem(B, death.bodyId);
    t.eq([corpse.type, corpse.at, corpse.unitId, corpse.owner], ['sectoid_corpse', ti, a.id, null]);
    for (const iid of items) t.eq(BU.findItem(B, iid).at, ti, 'item largado');
    t.eq(death.dropped.slice().sort(), items.slice().sort());
    t.eq([B.stats.aliensKilled, s.kills, a.killedBy], [1, 1, s.id]);
    t.ok(ofType(ev, 'morale').length > 0, 'moral do esquadrão');
    t.eq(C.damageUnit(B, a, 100, 'AP', 0, 1, s.id, {}), [], 'morto não leva mais dano');
    // soldado morto: cadáver humano, contagem X-COM; civil morto por X-COM
    C.killUnit(B, s, a.id, 'test');
    t.eq(B.stats.xcomKilled, 1);
    t.ok(B.items.some((x) => x.type === 'soldier_corpse' && x.unitId === s.id));
    const civ = BU.fromCivilian(B, 'civilian_f', null);
    BU.placeUnit(B, civ, I(B, 9, 9));
    const s2 = soldier(B, 10, 10);
    C.killUnit(B, civ, s2.id, 'shot');
    t.eq([B.stats.civKilledByXcom, B.stats.civKilledByAliens, s2.kills], [1, 0, 0], 'civil não conta como abate');
  });

  t.test('Inconsciente: stun ≥ HP ⇒ corpo (unitId) no chão, sai do mapa, mãos vazias; morrer depois reaproveita o corpo', () => {
    const B = fixture();
    const a = alien(B, 'sectoid_soldier', 5, 5);
    const ti = BU.unitTile(B, a);
    const ev = C.damageUnit(B, a, 200, 'STUN', 0, 1, null, { rng: highRng });
    t.eq(a.status, 'out');
    const st = ofType(ev, 'stun')[0];
    t.eq([st.unitId, st.i], [a.id, ti]);
    const body = BU.findItem(B, st.bodyId);
    t.eq([body.type, body.unitId, body.at], ['sectoid_corpse', a.id, ti]);
    t.eq([a.items.R, B._.unitAt[ti], B.stats.aliensStunned], [null, 0, 1]);
    C.killUnit(B, a, null, 'explosion');
    t.eq(B.items.filter((x) => x.unitId === a.id).length, 1, 'um só corpo');
    t.eq([B.stats.aliensStunned, B.stats.aliensKilled], [0, 1]);
  });

  t.test('Crisálida: golpe marca a vítima humana; ao morrer vira Zombie (sem cadáver); o Zombie liberta uma Crisálida', () => {
    const B = fixture();
    const cr = alien(B, 'chryssalid', 5, 5);
    cr.dir = 2;
    const civ = BU.fromCivilian(B, 'civilian_m', null);
    BU.placeUnit(B, civ, I(B, 6, 5));
    civ.dir = 6;
    const ti = BU.unitTile(B, civ);
    // to-hit RNG(0,99)=0, lado (frente direta, sem rolo), rolo de dano máximo
    const ev = C.resolveMelee(B, cr, cr.items.R, civ, highRngWith0());
    t.eq(ofType(ev, 'melee')[0].hit, true);
    t.eq(civ.status, 'dead');
    const z = ofType(ev, 'zombify')[0];
    t.ok(z, 'evento zombify');
    const zombie = BU.findUnit(B, z.unitId);
    t.eq([zombie.type, zombie.side, BU.unitTile(B, zombie)], ['zombie', 'alien', ti]);
    t.eq(B.items.filter((x) => x.unitId === civ.id).length, 0, 'sem cadáver de civil');
    t.eq(B.stats.civKilledByAliens, 1);
    // o Zombie morre ⇒ Crisálida
    const ev2 = C.killUnit(B, zombie, null, 'shot');
    const sp = ofType(ev2, 'spawn')[0];
    t.eq(BU.findUnit(B, sp.unitId).type, 'chryssalid');
    t.eq(B.items.filter((x) => x.unitId === zombie.id).length, 0);
    // falhar o golpe não marca
    const s = soldier(B, 10, 10, { dir: 6 });
    const cr2 = alien(B, 'chryssalid', 9, 10);
    const miss = C.resolveMelee(B, cr2, cr2.items.R, s, scripted([99]));
    t.eq([ofType(miss, 'melee')[0].hit, s.spawnOnDeath], [false, null]);
  });
  function highRngWith0() {
    return { int: (a, b) => (a === 0 && b === 99 ? 0 : Math.max(a, b)), pct: () => true };
  }

  // ---- explosões -----------------------------------------------------------------------------------------------
  t.test('Explosão: −10 por tile, raio, parede HE e paredes que só abrandam', () => {
    const B = fixture(24, 24);
    const c = [12 * 16 + 8, 12 * 16 + 8, 2];
    let cur = B;
    const pw = (ev, x, y) => {
      const e = ofType(ev, 'explosion')[0];
      const k = e.tiles.indexOf(I(cur, x, y));
      return k < 0 ? 0 : e.powers[k];
    };
    let ev = C.explode(B, c, 50, 'HE', 5, null, { rng: lowRng });
    t.eq([pw(ev, 12, 12), pw(ev, 13, 12), pw(ev, 14, 12), pw(ev, 15, 12), pw(ev, 16, 12), pw(ev, 17, 12)], [50, 40, 30, 20, 10, 0]);
    t.eq([pw(ev, 13, 13), pw(ev, 15, 15)], [40, 20], 'diagonais em passos de tile');
    const big = cur = fixture(30, 30);
    ev = C.explode(big, [15 * 16 + 8, 15 * 16 + 8, 2], 200, 'HE', 5, null, { rng: lowRng });
    t.eq([pw(ev, 20, 15), pw(ev, 21, 15), pw(ev, 19, 19), pw(ev, 20, 18), pw(ev, 20, 19)], [150, 0, 160, 150, 0], 'círculo isqrt ≤ R (5,3 dentro; 5,4 fora)');
    // parede de tijolo (heBlock 20) a leste do centro: −40 extra
    const W = cur = fixture(24, 24);
    W.map.parts[I(W, 14, 12) * 4 + 1] = id('FARM.wall');
    ev = C.explode(W, c, 50, 'HE', 5, null, { rng: lowRng });
    t.eq([pw(ev, 13, 12), pw(ev, 14, 12), pw(ev, 15, 12)], [40, 0, 0], 'parede detém a onda');
    t.eq(pw(ev, 12, 15), 20, 'outras direções intactas');
    // vedação (heBlock 0) não abranda
    const F = cur = fixture(24, 24);
    F.map.parts[I(F, 14, 12) * 4 + 1] = id('FARM.fence');
    ev = C.explode(F, c, 50, 'HE', 5, null, { rng: lowRng });
    t.eq(pw(ev, 14, 12), 30);
    // rocha (bloco inteiro, heBlock 30): o tile da rocha leva a onda, o de trás fica protegido
    const R = cur = fixture(24, 24);
    R.map.parts[I(R, 14, 12) * 4 + 3] = id('FARM.rock');
    ev = C.explode(R, c, 100, 'HE', 5, null, { rng: lowRng });
    t.eq([pw(ev, 14, 12), pw(ev, 15, 12)], [80, 10], 'rocha: 80; atrás 80 − 10 − 60');
    t.eq(ofType(ev, 'explosion')[0].radius, 5);
    t.eq(C.explode(fixture(), [8, 8, 2], 100, 'HE', 0, null, { rng: lowRng }).find((e) => e.t === 'explosion').radius, 5, 'raio por omissão = poder/20');
  });

  t.test('Explosão HE: unidades RNG(50,150) % (por baixo no centro), itens destruídos, terreno → entulho, fumo 5', () => {
    const B = fixture(20, 20);
    const s = soldier(B, 10, 10, { stats: { hp: 200 } });
    const far = soldier(B, 13, 10, { stats: { hp: 200 } });
    const i0 = I(B, 10, 11);
    B.map.parts[i0 * 4 + 1] = id('FARM.wall');
    const clip = BU.newItem(B, 'rifle_clip', { at: I(B, 11, 10) });
    const pistolClip = BU.newItem(B, 'pistol_clip', { at: I(B, 9, 9) }); // armadura 12
    const ev = C.explode(B, [10 * 16 + 8, 10 * 16 + 8, 2], 110, 'HE', 5, null, { rng: lowRng });
    const dm = ofType(ev, 'damage');
    const ds = dm.find((e) => e.unitId === s.id), df = dm.find((e) => e.unitId === far.id);
    t.eq(ds.armourHit, 4, 'centro ⇒ por baixo');
    t.eq(ds.amount, 55 - 2, '110 × 50 % − baixo 2');
    t.eq(df.armourHit === 4, false, 'longe ⇒ de lado');
    t.eq(df.amount, 40 - [12, 8, 8, 5][df.armourHit], '80 × 50 % − armadura do lado');
    t.eq(BU.findItem(B, clip.id), null, 'carregador destruído (100 > 20)');
    t.eq(BU.findItem(B, pistolClip.id), null, '100 > 12');
    // a parede oeste de (10,11) é detonada por (9,11) (vizinho a oeste, 100: parede → entulho) e pelo próprio tile
    // (100: entulho 30 ⇒ 60 ≤ 100 ⇒ desaparece), cada detonação independente como no OpenXcom
    t.eq(BM.def(B.map, i0, 1), null, 'parede (50) → entulho (30) → nada');
    t.eq(BM.def(B.map, I(B, 10, 10), 0).key, 'FARM.scorched', 'chão (40): 80 ≤ 110 ⇒ queimado');
    t.ok(B.map.smoke[i0] >= 5, 'fumo da destruição');
    t.ok(ofType(ev, 'itemsDestroyed').length >= 1);
    t.ok(B._.dirty.light && B._.dirty.los, 'luz/LOS sujos');
  });

  t.test('Explosão: tecto do nível de cima (p − 30) abre buraco e quem está em cima cai (ours)', () => {
    const B = fixture(12, 12, 2);
    const up = I(B, 5, 5, 1);
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) B.map.parts[I(B, x, y, 1) * 4] = id('FARM.roof.up');
    const top = soldier(B, 5, 5, { z: 1 });
    const it = BU.newItem(B, 'grenade', { at: I(B, 6, 5, 1) });
    const hp = top.hp;
    const ev = C.explode(B, [5 * 16 + 8, 5 * 16 + 8, 2], 110, 'HE', 3, null, { rng: lowRng });
    t.eq(B.map.parts[up * 4], 0, 'chão de cima (30): 2·30 ≤ 80 ⇒ buraco');
    const fall = ofType(ev, 'fall').find((e) => e.unitId === top.id);
    t.ok(fall, 'caiu');
    t.eq([top.z, fall.fromZ, fall.toZ], [0, 1, 0]);
    t.eq(top.hp, hp, 'queda sem dano; unidades de cima não levam a explosão');
    t.eq(BU.findItem(B, it.id).at, I(B, 6, 5, 0), 'o item também cai');
  });

  t.test('Explosão em cadeia: fonte de energia pendente (OVNI despenhado) e carro destruído', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 4, squadSize: 4 }));
    // força uma entrada pendente sobre a fonte de energia
    const ps = B.specials.POWER_SOURCE[0];
    t.ok(ps >= 0, 'há fonte de energia');
    if (!B.pendingExplosions.length) {
      const [x, y, z] = BM.xyz(B.map, ps);
      B.pendingExplosions.push({ i: ps, part: 3, power: 150, radius: 6, dmg: 'HE', voxel: [x * 16 + 8, y * 16 + 8, z * 24 + 8], cause: 'powerSource' });
    }
    const n = B.pendingExplosions.length;
    const ev = C.resolvePendingExplosions(B);
    t.eq(B.pendingExplosions, []);
    const ex = ofType(ev, 'explosion');
    t.ok(ex.length >= n, 'uma explosão por fonte');
    t.eq(ex[0].cause, 'powerSource');
    t.ok(ofType(ev, 'tile').some((e) => e.i === ps && e.part === 3), 'a fonte é destruída');
    t.ok(!BM.def(B.map, ps, 3) || !BM.def(B.map, ps, 3).explosive, 'já não é explosiva');
    t.eq(C.resolvePendingExplosions(B), [], 'nada pendente');
    // entrada sobre uma parte que já não é explosiva é ignorada
    B.pendingExplosions.push({ i: ps, part: 3, power: 150, radius: 6, dmg: 'HE', voxel: [8, 8, 8], cause: 'powerSource' });
    t.eq(C.resolvePendingExplosions(B), []);
    // carro (armadura 30, explosivo 40 r3) apanhado por uma granada forte
    const F = fixture(20, 20);
    const car = I(F, 11, 10);
    F.map.parts[car * 4 + 3] = id('URBAN.car');
    C.explode(F, [10 * 16 + 8, 10 * 16 + 8, 2], 110, 'HE', 5, null, { rng: lowRng });
    t.eq(BM.def(F.map, car, 3).key, 'URBAN.wreck', 'carro → destroços');
    t.eq(F.pendingExplosions.length, 1);
    t.eq([F.pendingExplosions[0].power, F.pendingExplosions[0].radius, F.pendingExplosions[0].part], [40, 3, null]);
    const ev2 = C.resolvePendingExplosions(F, lowRng);
    t.eq(ofType(ev2, 'explosion').length, 1);
    t.eq(ofType(ev2, 'explosion')[0].cause, 'tile');
  });

  t.test('Ciberdisco explode ao morrer (cadáver poupado); STUN, fumo e fogo em área', () => {
    const B = fixture(20, 20);
    const disc = alien(B, 'cyberdisc', 8, 8);
    const s = soldier(B, 12, 9, { stats: { hp: 300 } });
    const ev = C.killUnit(B, disc, s.id, 'shot');
    t.eq(B.pendingExplosions.length, 1);
    const pe = B.pendingExplosions[0];
    t.eq([pe.power, pe.radius, pe.dmg, pe.cause, pe.attackerId], [120, 6, 'HE', 'unitDeath', s.id]);
    const body = ofType(ev, 'death')[0].bodyId;
    const ev2 = C.resolvePendingExplosions(B, lowRng);
    t.ok(ofType(ev2, 'damage').some((e) => e.unitId === s.id), 'o soldado leva a explosão');
    t.ok(BU.findItem(B, body), 'cadáver do disco sobrevive');
    // STUN em área: atordoa e também os corpos inconscientes
    const S = fixture(12, 12);
    const a = alien(S, 'sectoid_soldier', 5, 5);
    C.explode(S, [5 * 16 + 8, 5 * 16 + 8, 2], 90, 'STUN', 4, null, { rng: highRng });
    t.eq(a.status, 'out', 'stun bomb');
    t.eq(BM.def(S.map, I(S, 5, 5), 0).key, 'FARM.ground', 'STUN não estraga terreno');
    // fumo: RNG(7,15) por tile e apaga o fogo
    const M = fixture(12, 12);
    M.map.fire[I(M, 6, 5)] = 3;
    const evS = C.explode(M, [5 * 16 + 8, 5 * 16 + 8, 2], 60, 'SMOKE', 5, null, { rng: lowRng });
    t.eq([M.map.smoke[I(M, 5, 5)], M.map.smoke[I(M, 9, 5)], M.map.fire[I(M, 6, 5)]], [7, 7, 0]);
    t.eq(ofType(evS, 'smoke').length, 1);
    // incendiário: fogo combustível+1 e fumo; unidades RNG(5,10) IN a arder
    const N = fixture(12, 12);
    const v = soldier(N, 5, 5);
    const hp = v.hp;
    C.explode(N, [5 * 16 + 8, 5 * 16 + 8, 2], 90, 'IN', 4, null, { rng: highRng });
    t.eq([N.map.fire[I(N, 5, 5)], N.map.smoke[I(N, 5, 5)]], [2, 10], 'relva: combustível 1 + 1; fumo 15 − 50/10');
    t.eq([hp - v.hp, v.burn], [10, 5], 'IN 10 sem armadura; arde 5 turnos');
    t.ok(N.freshFire.indexOf(I(N, 5, 5)) >= 0, 'fogo novo marcado');
  });

  t.test('Determinismo: a mesma sequência de tiros e explosões dá o mesmo hash', () => {
    const run = () => {
      const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 21, squadSize: 6 }));
      C.resolvePendingExplosions(B);
      const xs = B.units.filter((u) => u.side === 'xcom' && u.status === 'ok');
      const al = B.units.filter((u) => u.side === 'alien' && u.onMap);
      for (let k = 0; k < xs.length; k++) {
        const u = xs[k];
        if (u.status !== 'ok' || !u.items.R) continue;
        const tg = al.length ? al[k % al.length] : null;
        if (tg && tg.status === 'ok') C.resolveShot(B, u, u.items.R, 'auto', tg);
        else C.resolveShot(B, u, u.items.R, 'snap', BU.unitTile(B, u) + 3);
      }
      C.explode(B, [B.map.w * 8, B.map.h * 8, 2], 110, 'HE', 5, xs[0].id);
      C.resolvePendingExplosions(B);
      return [BT.hash(B), JSON.stringify(B.stats)];
    };
    const a = run(), b = run();
    t.eq(a, b);
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 21, squadSize: 6 }));
    C.resolvePendingExplosions(B);
    const back = BT.deserialize(JSON.parse(JSON.stringify(BT.serialize(B))));
    t.eq(BT.hash(back), BT.hash(B), 'serialização depois das explosões');
  });
  // ---- regressões da revisão (onda 2) --------------------------------------------------------------------------------
  t.test('Explosão: unidade 2×2 leva um golpe por tile ocupado (TileEngine::explode)', () => {
    const B = fixture(20, 20);
    const rp = alien(B, 'reaper', 5, 5);
    rp.hp = rp.hpMax = 999;
    const ev = C.explode(B, [8 * 16 + 8, 6 * 16 + 8, 2], 110, 'HE', 5, null, { rng: lowRng });
    const dm = ofType(ev, 'damage').filter((e) => e.unitId === rp.id);
    t.eq(dm.length, 4, 'quatro tiles na explosão ⇒ quatro golpes');
    // morta ao primeiro golpe ⇒ não leva mais
    const B2 = fixture(20, 20);
    const r2 = alien(B2, 'reaper', 5, 5);
    r2.hp = 1;
    const ev2 = C.explode(B2, [8 * 16 + 8, 6 * 16 + 8, 2], 110, 'HE', 5, null, { rng: highRng });
    t.eq(ofType(ev2, 'damage').filter((e) => e.unitId === r2.id).length, 1, 'para quando morre');
    t.eq(ofType(ev2, 'death').length, 1);
  });

  t.test('Explosão HE fora do centro: tronco/braços pelo lado, nunca pernas (centro + 5 voxels)', () => {
    const parts = {};
    for (let seed = 1; seed <= 60; seed++) {
      const B = fixture(16, 16, 1, seed);
      const s = soldier(B, 8, 8, { stats: { hp: 999 }, dir: seed & 7 });
      const ev = C.explode(B, [5 * 16 + 8, 8 * 16 + 8, 2], 50, 'HE', 5, null, {});
      const d = ofType(ev, 'damage').find((e) => e.unitId === s.id);
      if (d) parts[d.part] = (parts[d.part] | 0) + 1;
    }
    t.ok(!parts[4] && !parts[5] && !parts[0], 'sem pernas nem cabeça: ' + JSON.stringify(parts));
    t.ok((parts[1] | 0) > 0 && (parts[2] | 0) + (parts[3] | 0) > 0, 'tronco e braços: ' + JSON.stringify(parts));
  });

  t.test('Explosão HE: paredes destruídas dos dois lados (vizinho a leste/sul detona a parede oeste/norte)', () => {
    for (const side of ['west', 'east']) {
      const B = fixture(12, 12);
      const wi = I(B, 6, 5);
      B.map.parts[wi * 4 + 1] = id('FARM.wall');
      const cx = side === 'west' ? 5 : 6;
      C.explode(B, [cx * 16 + 8, 5 * 16 + 8, 2], 110, 'HE', 5, null, { rng: lowRng });
      const d = BM.def(B.map, wi, 1);
      t.ok(!d || d.key !== 'FARM.wall', 'parede destruída com a explosão a ' + side);
    }
    // parede norte: explosão a norte (tile de cima) também a derruba
    const N = fixture(12, 12);
    const ni = I(N, 5, 6);
    N.map.parts[ni * 4 + 2] = id('FARM.wall.n');
    C.explode(N, [5 * 16 + 8, 5 * 16 + 8, 2], 110, 'HE', 5, null, { rng: lowRng });
    t.ok(!BM.def(N.map, ni, 2) || BM.def(N.map, ni, 2).key !== 'FARM.wall.n', 'parede norte destruída do lado norte');
  });

  t.test('Paredes de edifícios: HE pesado abre brechas, a granada (50) não (2·armadura ≤ poder)', () => {
    const tryWall = (key, power) => {
      const B = fixture(12, 12);
      const wi = I(B, 6, 5);
      B.map.parts[wi * 4 + 1] = id(key);
      C.explode(B, [6 * 16 + 8, 5 * 16 + 8, 2], power, 'HE', 5, null, { rng: lowRng });
      const d = BM.def(B.map, wi, 1);
      return !d || d.key !== key;
    };
    for (const key of ['URBAN.wall', 'FARM.wall', 'MOUNTAIN.wall']) {
      t.ok(tryWall(key, D.items.high_explosive.power), key + ': Explosivo (110) abre brecha');
      t.ok(tryWall(key, D.items.alien_grenade.power), key + ': granada alienígena (90) abre brecha');
      t.ok(!tryWall(key, D.items.grenade.power), key + ': granada (50) não');
    }
    t.ok(!tryWall('ALIENBASE.wall', D.items.high_explosive.power), 'base alienígena resiste ao Explosivo');
  });

  t.test('Explosão HE não fere corpos inconscientes; só os mata ao destruir o corpo (poder > armadura)', () => {
    for (const [power, dies] of [[26, false], [27, true]]) {
      const B = fixture(12, 12);
      const a = alien(B, 'sectoid_soldier', 5, 5);
      C.knockOut(B, a, null);
      const hp = a.hp;
      const ev = C.explode(B, [5 * 16 + 8, 5 * 16 + 8, 2], power, 'HE', 1, null, { rng: highRng });
      t.eq(ofType(ev, 'damage').filter((e) => e.unitId === a.id).length, 0, 'sem dano direto (' + power + ')');
      t.eq(a.status, dies ? 'dead' : 'out', 'corpo armadura 26 vs poder ' + power);
      if (!dies) t.eq(a.hp, hp);
    }
    // STUN continua a atordoar corpos
    const S = fixture(12, 12);
    const b = alien(S, 'sectoid_soldier', 5, 5);
    C.knockOut(S, b, null);
    const st = b.stun;
    C.explode(S, [5 * 16 + 8, 5 * 16 + 8, 2], 60, 'STUN', 1, null, { rng: highRng });
    t.ok(b.stun > st, 'STUN atinge corpos');
  });

  t.test('Fumo: modificador SMOKE da armadura (não o de STUN); alienígenas imunes', () => {
    const B = fixture();
    const pa = soldier(B, 3, 3, { armour: 'personal_armour' });
    t.eq(pa.mods.STUN, 90);
    const evs = C.damageUnit(B, pa, 1, 'SMOKE', 4, 1, null, { rng: lowRng, roll: false, ignoreArmour: true, cause: 'smoke' });
    t.eq([pa.stun, ofType(evs, 'damage')[0].stun], [1, 1], 'fumo 3 ⇒ 3/4 + 1 = 1 (SMOKE 100), não 0 (STUN 90)');
    C.damageUnit(B, pa, 4, 'SMOKE', 4, 1, null, { rng: lowRng, roll: false, ignoreArmour: true });
    t.eq(pa.stun, 5, 'fumo 15 ⇒ +4');
    const a = alien(B, 'sectoid_soldier', 6, 6);
    C.damageUnit(B, a, 4, 'SMOKE', 4, 1, null, { rng: lowRng, roll: false, ignoreArmour: true });
    t.eq(a.stun, 0, 'Sectoid: SMOKE 0');
  });

  t.test('Moral: feridas = total na parte atingida (mesmo sem ferida nova); impacto só em golpes diretos, também STUN', () => {
    const B = fixture();
    const s = soldier(B, 3, 3, { stats: { brav: 50, hp: 60 } });
    s.wounds[1] = 2;
    s.morale = 80;
    // rnd 20 − frente 12 = 8; atordoamento RNG(0,2)=0; ferida RNG(0,10)=10 ≥ 8 ⇒ nenhuma
    C.damageUnit(B, s, 10, 'AP', 0, 1, null, { rng: scripted([20, 0, 10]), hitMorale: true });
    t.eq([s.wounds[1], s.morale], [2, 80 - 4 - 2], 'impacto −100·(8·6/10)/100 = −4; feridas −2');
    // com ferida nova (+1 ⇒ 3)
    s.morale = 80;
    s.armour[0] = 12;
    C.damageUnit(B, s, 10, 'AP', 0, 1, null, { rng: scripted([20, 0, 0, 1]), hitMorale: true });
    t.eq([s.wounds[1], s.morale], [3, 80 - 4 - 3]);
    // explosão: só o termo das feridas
    s.morale = 80;
    s.armour = [0, 0, 0, 0, 0];
    const before = s.wounds[1] + s.wounds[2] + s.wounds[3];
    const ev = C.explode(B, [3 * 16 + 8, 5 * 16 + 8, 2], 60, 'HE', 4, null, { rng: lowRng });
    const d = ofType(ev, 'damage').find((e) => e.unitId === s.id);
    t.ok(d && d.amount > 0, 'explosão fere');
    t.eq(s.morale, 80 - s.wounds[d.part], 'explosão: moral só pelas feridas da parte (' + before + ')');
    // STUN direto: moral do impacto
    const a = alien(B, 'sectoid_soldier', 8, 8);
    a.morale = 100;
    const c = C.unitCentre(a);
    C.applyImpact(B, { kind: 'unit', unitId: a.id, voxel: [c[0], c[1] - 4, a.z * 24 + 8], i: BU.unitTile(B, a) }, 40, 'STUN', null, { rng: scripted([80]) });
    const p = 80 - a.armourMax[0];
    t.eq(a.morale, 100 - OV.U.idiv(100 * OV.U.idiv(p * OV.Morale.bravFactor(a), 10), 100), 'STUN direto ⇒ −100·(p·B/10)/100');
  });

  t.test('Arremesso: precisão só com feridas na cabeça (getAccuracyModifier sem item)', () => {
    const B = fixture();
    const s = soldier(B, 3, 3, { stats: { thr: 70 } });
    s.wounds[2] = 2;
    t.eq(C.accuracy(B, s, 'grenade', 'throw'), 70, 'braço direito ferido não conta');
    s.wounds[0] = 1;
    t.eq(C.accuracy(B, s, 'grenade', 'throw'), OV.U.idiv(70 * 90, 100), 'cabeça −10');
  });
};
