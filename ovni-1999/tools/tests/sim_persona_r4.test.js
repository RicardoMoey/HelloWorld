/* Persona ronda 4 (simulação/dados): moral por dificuldade e pausa no pânico em Recruta (+ contagem para o relatório);
   defesa da base pela tripulação do OVNI (raça, dificuldade, mês), defesas limitadas e baixas proporcionais; centro de
   controlo da base alienígena ganha a missão; rendição limitada à tripulação e à parte no relatório; equipamento por mês
   da ferramenta de equilíbrio alinhado com a campanha. Contrato: docs/CAMPAIGN_API.md §5.9, §11.11; DESIGN §22. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign, D = OV.Data, T = OV.TUNE, BT = OV.Battle, M = OV.Morale;
  const LIVE = { ok: 1, panic: 1 };
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };
  const xcomOf = (B) => B.units.filter((u) => u.origSide === 'xcom' && LIVE[u.status]);
  const battle = (o) => BT.create(BT.quickMission(Object.assign({ ufoType: 'small_scout', terrain: 'FARM', seed: 5, squadSize: 6 }, o)));

  // ---- 1. moral ---------------------------------------------------------------------------------------------
  t.test('moral: em Recruta a morte de um colega e os ferimentos custam metade; Veterano e alienígenas como no original', () => {
    t.eq(T.MORALE_LOSS_PCT, [50, 100, 100]);
    const loss = (diff) => {
      const B = battle({ difficulty: diff });
      const xs = xcomOf(B);
      for (const u of xs) { u.stats.brav = 10; u.rank = 0; }
      const victim = xs[0];
      victim.status = 'dead';
      M.onDeath(B, victim, null);
      const deathLoss = 100 - xs[1].morale;
      xs[2].morale = 100;
      M.onHit(B, xs[2], 30);
      return { deathLoss, hitLoss: 100 - xs[2].morale, B };
    };
    const rec = loss(0), vet = loss(1);
    t.eq(vet.deathLoss, 20, 'recruta Bravura 10: 100·200·10/100/100');
    t.eq(rec.deathLoss, 10, 'Recruta: metade');
    t.eq([vet.hitLoss, rec.hitLoss], [30, 15]);
    // três baixas seguidas em Recruta: a equipa de Bravura 10 fica longe do pânico (moral 70 ⇒ 0 %)
    const B = battle({ difficulty: 0 });
    const xs = xcomOf(B);
    for (const u of xs) { u.stats.brav = 10; u.rank = 0; }
    for (const v of xs.slice(0, 3)) { v.status = 'dead'; M.onDeath(B, v, null); }
    t.eq(M.panicChance(xs[4].morale), 0, 'moral ' + xs[4].morale);
    // o lado alienígena não muda com a dificuldade
    const al = B.units.find((u) => u.origSide === 'alien' && LIVE[u.status] && (u.size | 0) <= 1);
    t.eq(M.lossPct(B, al), 100);
  });

  t.test('pânico: em Recruta o mesmo soldado não volta a entrar em pânico no turno seguinte; os episódios contam para o relatório', () => {
    const run = (diff) => {
      const B = battle({ difficulty: diff });
      drain(BT.beginBattle(B));
      const u = xcomOf(B)[0];
      for (const x of xcomOf(B)) x.morale = 100;
      u.morale = 0;
      u.panicTurn = B.turn - 1; // episódio no turno anterior
      const before = (B.stats.xcomPanics | 0);
      const evs = [];
      const g = M.panicPhase(B, 'xcom');
      let r;
      while (!(r = g.next()).done) evs.push(r.value);
      return { B, n: evs.filter((e) => e.t === 'morale' && e.unitId === u.id && (e.kind === 'panic' || e.kind === 'berserk')).length, before };
    };
    const rec = run(0);
    t.eq(rec.n, 0, 'Recruta: pausa de 1 turno');
    t.eq(rec.B.stats.xcomPanics | 0, rec.before);
    const vet = run(1);
    t.eq(vet.n, 1, 'Veterano: moral 0 ⇒ pânico certo');
    t.eq(vet.B.stats.xcomPanics, vet.before + 1, 'B.stats.xcomPanics');
    t.eq(vet.B.units.find((u) => u.panicTurn === vet.B.turn) !== undefined, true, 'panicTurn marcado');
    t.eq(BT.debrief(vet.B).panics, vet.B.stats.xcomPanics, 'debrief.panics');
  });

  // ---- 2. defesa da base -----------------------------------------------------------------------------------
  function baseG(seed, diff, month) {
    const G = C.newCampaign({ seed, difficulty: diff });
    G.alienMissions = [];
    G.events.length = 0;
    G.month = month;
    return G;
  }
  function assault(G, race, type) {
    const b = G.bases[0];
    const u = {
      id: C.nextId(G, 'u'), type: type || 'battleship', missionId: null, race, region: OV.GMath.regionAt(b.lon, b.lat), traj: 'P0', wp: 0,
      lon: b.lon, lat: b.lat, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 3600,
      crashLeftS: 86400, lastSeen: null, objective: false, targetBaseId: b.id, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }
  // deixa `home` soldados em casa; os restantes ficam numa Skyranger em voo
  function keepHome(G, home) {
    const sky = Object.values(G.crafts).find((c) => c.type === 'skyranger');
    sky.status = 'patrol';
    const all = Object.values(G.soldiers);
    for (const s of all) { if (s.craftId) C.removeById(sky.soldiers, s.id); s.craftId = null; }
    for (const s of all.slice(home)) { s.craftId = sky.id; sky.soldiers.push(s.id); }
    return all.slice(0, home);
  }
  function addDefences(G, n) {
    const b = G.bases[0];
    let k = 0;
    for (let y = 0; y < 6 && k < n; y++) for (let x = 0; x < 6 && k < n; x++) {
      if (OV.BaseSim.canPlace(G, b.id, 'missile_defence', x, y) === null) { b.grid.push({ type: 'missile_defence', x, y, daysLeft: 0 }); k++; }
    }
    return k;
  }

  t.test('defesa da base: 1 soldado + Defesas de Mísseis nunca aguentam um Couraçado (Veterano e Super-humano)', () => {
    for (const [diff, defs] of [[1, 2], [2, 3]]) {
      for (let seed = 1; seed <= 8; seed++) {
        const G = baseG(seed, diff, 3);
        keepHome(G, 1);
        t.eq(addDefences(G, defs), defs);
        const r = C.baseDefence(G, 'b1', assault(G, 'sectoid').id);
        t.ok(r.result !== 'repelled', 'dif ' + diff + ' semente ' + seed + ': ' + r.result);
      }
    }
  });

  t.test('defesa da base: a exigência depende da raça, da dificuldade e do mês; as defesas valem ≤ 66 % dos soldados', () => {
    const need = (diff, month, race) => {
      const G = baseG(1, diff, month);
      return C.assaultForce(G, { type: 'battleship', race });
    };
    t.ok(need(1, 3, 'muton') > need(1, 3, 'sectoid') * 1.3, 'Mutões ≫ Sectoides');
    t.ok(need(1, 3, 'ethereal') > need(1, 3, 'sectoid') * 1.5, 'Etéreos ≫ Sectoides');
    t.ok(need(2, 3, 'sectoid') > need(1, 3, 'sectoid') && need(1, 3, 'sectoid') > need(0, 3, 'sectoid'), 'dificuldade');
    t.ok(need(1, 4, 'sectoid') > need(1, 2, 'sectoid'), 'armamento do mês');
    // 10 recrutas aguentam Sectoides em Veterano mas não Mutões
    const G = baseG(4, 1, 3);
    t.eq(C.baseDefence(G, 'b1', assault(G, 'sectoid').id).result, 'repelled');
    const G2 = baseG(4, 1, 3);
    t.eq(C.baseDefence(G2, 'b1', assault(G2, 'muton').id).result, 'lost');
    // 3 soldados + 6 defesas: o bónus das defesas fica nos 66 % dos soldados (a salva ainda tira casco)
    for (let seed = 1; seed <= 6; seed++) {
      const G3 = baseG(seed, 1, 3);
      const home = keepHome(G3, 3);
      t.eq(addDefences(G3, 6), 6);
      const men = home.reduce((a, s) => a + C.defenderPower(s), 0);
      const u = assault(G3, 'sectoid');
      const r = C.baseDefence(G3, 'b1', u.id);
      const shot = r.shots.reduce((a, x) => a + x.dmg, 0);
      if (r.result === 'ufoDestroyed') continue;
      const full = Math.floor((C.assaultForce(G3, u) * T.BASE_DEFENCE_CREW_PCT) / 100);
      const needLeft = Math.floor((full * Math.max(0, D.ufos.battleship.hp - shot)) / D.ufos.battleship.hp);
      const strength = men + Math.min(6 * Math.floor((D.facilities.missile_defence.defence * T.BASE_DEFENCE_FACILITY_PCT) / 100), Math.floor((men * T.BASE_DEFENCE_FACILITY_CAP_PCT) / 100));
      t.eq(r.result, strength >= needLeft ? 'repelled' : 'lost', 'semente ' + seed);
    }
  });

  t.test('defesa da base: as baixas crescem com o rácio exigência / força (guarnição grande perde menos)', () => {
    const lost = (home) => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const G = baseG(seed, 0, 3);
        for (let k = 0; k < 10; k++) C.addSoldier(G, C.makeSoldier(G, { baseId: 'b1' }));
        keepHome(G, home);
        const r = C.baseDefence(G, 'b1', assault(G, 'sectoid').id);
        t.eq(r.result, 'repelled');
        n += r.soldiersLost.length;
      }
      return n / 6;
    };
    const small = lost(7), big = lost(20);
    t.ok(small >= 1 && big >= 1, small + ' / ' + big);
    t.ok(big / 20 < small / 7, 'proporção de baixas: 20 → ' + big + ', 7 → ' + small);
  });

  // ---- 3. centro de controlo da base alienígena -----------------------------------------------------------
  function clearObjective(B) {
    for (const i of B.objectiveTiles) {
      for (let p = 0; p < 4; p++) {
        const d = OV.BMap.def(B.map, i, p);
        if (d && d.special === 'OBJECTIVE') B.map.parts[i * 4 + p] = 0;
      }
    }
  }

  t.test('base alienígena: destruir o centro de controlo ganha a missão (como diz o briefing); o que os vivos levam fica', () => {
    for (const seed of [1, 2]) {
      const B = BT.create(BT.quickMission({ kind: 'alienBase', month: 3, seed, difficulty: 1 }));
      drain(BT.beginBattle(B));
      t.ok(B.objectiveTiles.length > 0, 'tiles do objetivo');
      t.eq(BT.outcome(B), null);
      clearObjective(B);
      t.ok(BT.objectiveDestroyed(B));
      t.eq(BT.outcome(B), 'win', 'semente ' + seed);
      const alive = B.units.filter((u) => u.origSide === 'alien' && u.side === 'alien' && LIVE[u.status]);
      t.ok(alive.length > 0);
      const deb = BT.debrief(B);
      t.eq(deb.result, 'win');
      t.eq(deb.objective, true);
      t.eq(deb.kills, B.units.filter((u) => u.origSide === 'alien' && u.status === 'dead' && !u.crashDead).length, 'vivos não contam como abatidos');
      t.ok(deb.lines.some((l) => l.key === 'bs.debrief.alienBaseDestroyed'));
      // armas: só as que não estão nas mãos de um alienígena de pé
      const held = new Set(alive.map((u) => u.id));
      const types = new Set(B.items.filter((it) => it.owner !== null && held.has(it.owner) && D.items[it.type].kind === 'firearm').map((it) => it.type));
      t.ok(types.size > 0, 'há armas nas mãos dos vivos');
      for (const ty of types) {
        const free = B.items.filter((it) => it.type === ty && (it.unitId === null || it.unitId === undefined) && !(it.owner !== null && held.has(it.owner))).length;
        t.eq((deb.recovered[ty] | 0) + (deb.returned[ty] | 0), free, ty);
      }
    }
    // um OVNI não tem objetivo; Cidónia continua a ganhar pelo Cérebro
    const mars = BT.create(BT.quickMission({ kind: 'cydonia', month: 6, seed: 1, difficulty: 1 }));
    drain(BT.beginBattle(mars));
    clearObjective(mars);
    t.eq(BT.outcome(mars), 'win');
  });

  // ---- 4. rendição -----------------------------------------------------------------------------------------
  function alienBaseFight(diff, before) {
    const G = C.newCampaign({ seed: 17, difficulty: diff });
    G.alienMissions = [];
    G.events.length = 0;
    G.bases[0].grid.push({ type: 'alien_containment', x: 5, y: 3, daysLeft: 0 });
    const a = {
      id: C.nextId(G, 'a'), lon: 10, lat: 50, race: 'floater', region: OV.GMath.regionAt(10, 50), country: OV.GMath.countryAt(10, 50),
      missionId: null, discovered: true, foundT: 0, supplyT: null,
    };
    G.alienBases.push(a);
    const sky = Object.values(G.crafts).find((c) => c.type === 'skyranger');
    Object.assign(sky, { status: 'patrol', dest: { kind: 'alienBase', id: a.id }, lon: a.lon, lat: a.lat, speed: 0 });
    const B = BT.create(C.startMission(G, { kind: 'alienBase', id: a.id }, sky.id));
    drain(BT.beginBattle(B));
    if (before) before(B);
    for (const u of B.units) if (u.side === 'alien' && LIVE[u.status]) OV.Combat.killUnit(B, u, null, 'test');
    return { G, B, model: C.finishMission(G, B) };
  }

  t.test('rendição: no máximo as patentes da tripulação (1 líder ⇒ 1 líder), à parte no modelo; capturas na batalha contam', () => {
    const { G, B, model } = alienBaseFight(1);
    const leaders = B.crew.filter((c) => c.rank === 'leader').length;
    t.eq(leaders, 1, 'Veterano: 1 líder na tripulação');
    t.eq(model.debrief.captured.length, 0);
    t.eq(model.surrendered, { floater_commander: 1, floater_leader: 1 });
    t.eq(model.capturedStored, { floater_commander: 1, floater_leader: 1 });
    t.eq(G.bases[0].aliens, { floater_commander: 1, floater_leader: 1 });
    // comandante atordoado na batalha: vai como captura, só o líder se rende
    const st = alienBaseFight(1, (B2) => {
      const cmd = B2.units.find((u) => u.type === 'floater_commander');
      OV.Combat.knockOut(B2, cmd, null);
    });
    t.eq(st.model.debrief.captured.map((c) => c.unitType), ['floater_commander']);
    t.eq(st.model.surrendered, { floater_leader: 1 });
    t.eq(st.model.capturedStored, { floater_commander: 1, floater_leader: 1 });
    // Super-humano: 2 líderes na tripulação ⇒ 2 rendem-se
    const sup = alienBaseFight(2);
    t.eq(sup.model.surrendered, { floater_commander: 1, floater_leader: 2 });
  });

  // ---- 5. equipamento da ferramenta de equilíbrio ---------------------------------------------------------
  t.test('sim.js: equipamento por mês alinhado com a campanha (mês 1 lasers + Armadura Pessoal, mês 3 plasma pesado)', () => {
    const sim = require('../sim.js');
    const gear = (month) => {
      const s = sim.missionFor({ ufo: 'abductor', month, diff: 1, seed: 1 }).squad[0];
      return [s.loadout.R, s.armour];
    };
    t.eq(gear(0), ['rifle', 'coveralls']);
    t.eq(gear(1), ['laser_rifle', 'personal_armour']);
    t.eq(gear(2), ['laser_rifle', 'personal_armour']);
    t.eq(gear(3), ['heavy_plasma', 'personal_armour']);
    t.eq(gear(6), ['heavy_plasma', 'power_suit']);
    const m = BT.quickMission({ ufoType: 'abductor', month: 1, seed: 2, squadSize: 8 });
    t.eq(m.squad.filter((s) => s.loadout.pack.indexOf('medikit') >= 0).length, 1, 'kit médico');
    // ninguém passa a Força com o equipamento do mês (as UT do turno desceriam)
    for (const month of [0, 1, 3, 6]) {
      for (const s of BT.quickMission({ ufoType: 'abductor', month, night: true, seed: 3, squadSize: 10 }).squad) {
        const lo = s.loadout;
        const w = [lo.R, lo.L].concat(lo.belt, lo.pack).filter(Boolean).reduce((a, id) => a + (D.items[id].weight | 0), 0);
        t.ok(w <= s.stats.str, 'mês ' + month + ': peso ' + w + ' > Força ' + s.stats.str);
      }
    }
  });
};
