/* Persona ronda 5 (simulação/dados): dano alienígena por dificuldade (Recruta 60 %) e baixas em grupo no relatório;
   bomba do Blaster só por casas descobertas e base alienígena pela regra orig (centro destruído ⇒ sair é a vitória);
   defesa da base com armas, probabilidades suaves, aguentar a custo e estimativa para a interface; terror do mês 0
   com a tabela de uma dificuldade abaixo. Contrato: docs/CAMPAIGN_API.md §5.9, §11.12; DESIGN §22. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign, D = OV.Data, T = OV.TUNE, BT = OV.Battle, BM = OV.BMap, BU = OV.BUnits, A = OV.Act;
  const LIVE = { ok: 1, panic: 1 };
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };

  // ---- 0. dano alienígena em Recruta e baixas em grupo ---------------------------------------------------
  function duel(diff) {
    const B = BT.create(BT.quickMission({ ufoType: 'small_scout', terrain: 'FARM', seed: 3, squadSize: 4, difficulty: diff }));
    const x = B.units.find((u) => u.origSide === 'xcom');
    const a = B.units.find((u) => u.origSide === 'alien' && (u.size | 0) <= 1);
    return { B, x, a };
  }
  t.test('dano: em Recruta as armas alienígenas fazem 50 % às unidades X-COM; Veterano, fogo amigo e alienígenas a 100 %', () => {
    t.eq(T.ALIEN_DAMAGE_PCT, [50, 100, 100]);
    const hit = (diff, from, to, power) => {
      const d = duel(diff);
      const victim = to === 'x' ? d.x : d.a;
      victim.hp = 200;
      victim.armour = [0, 0, 0, 0, 0];
      const atk = from === 'a' ? d.a : d.B.units.filter((u) => u.origSide === 'xcom')[1];
      const ev = OV.Combat.damageUnit(d.B, victim, power, 'PLASMA' in D.damageTypes ? 'PLASMA' : 'AP', 0, null, atk.id, { roll: false });
      return ev.find((e) => e.t === 'damage').amount;
    };
    t.eq(hit(0, 'a', 'x', 52), 26, 'pistola de plasma em Recruta: 52 × 50 %');
    t.eq(hit(1, 'a', 'x', 52), 52, 'Veterano: dano inteiro');
    t.eq(hit(0, 'x', 'x', 52), 52, 'fogo amigo em Recruta: dano inteiro');
    t.eq(hit(0, 'x', 'a', 52), 52, 'a X-COM contra alienígenas: dano inteiro');
    // um tiro de pistola de plasma (rolagem máxima 200 %) contra um recruta de fato com 35 de Saúde: em Recruta o
    // máximo é 52 − 12 de armadura = 40 → raramente mata; a chance de matar desce de 55 % para 11 %
    const kill = (pct) => {
      const p = Math.floor((52 * pct) / 100);
      let n = 0;
      for (let r = 0; r <= 2 * p; r++) if (r - 12 >= 35) n++;
      return Math.round((100 * n) / (2 * p + 1));
    };
    t.ok(kill(100) >= 50 && kill(50) <= 12, kill(100) + ' → ' + kill(50));
  });

  t.test('relatório: baixas em grupo no turno alienígena (≤ 2 casas, mesmo turno) contam em debrief.clustered', () => {
    const d = duel(0);
    const xs = d.B.units.filter((u) => u.origSide === 'xcom' && LIVE[u.status]);
    d.B.side = 'alien';
    d.B.turn = 3;
    const [x0, y0] = [xs[0].x, xs[0].y];
    // dois soldados lado a lado e um terceiro longe morrem no mesmo turno alienígena
    OV.Combat.killUnit(d.B, xs[0], d.a.id, 'shot');
    OV.Combat.killUnit(d.B, xs[1], d.a.id, 'shot');
    t.ok(Math.max(Math.abs(xs[1].x - x0), Math.abs(xs[1].y - y0)) <= 2, 'vizinhos na formação');
    t.eq(BT.clusteredDeaths(d.B), 2);
    t.eq(xs[0].deathTile >= 0, true);
    // um morto noutro turno não conta; um morto no turno X-COM (fogo amigo/granada própria) também não
    d.B.turn = 4;
    OV.Combat.killUnit(d.B, xs[2], d.a.id, 'shot');
    d.B.side = 'xcom';
    OV.Combat.killUnit(d.B, xs[3], null, 'shot');
    t.eq(BT.clusteredDeaths(d.B), 2);
    t.eq(BT.debrief(d.B).clustered, 2);
  });

  // ---- 1. armas para o equipamento automático -----------------------------------------------------------
  t.test('kitGuns: depois das espingardas, os Lança-Foguetes com foguetes vêm antes das pistolas; sem munição, atordoar ou Blaster não', () => {
    const G = C.newCampaign({ seed: 1, difficulty: 0 });
    // o caso do Tiago: 11 Lança-Foguetes e 14 foguetes no armazém, sem espingardas
    t.eq(C.kitGuns(G, { rocket_launcher: 11, small_rocket: 14, pistol: 4, pistol_clip: 6 }), ['rocket_launcher', 'pistol']);
    t.eq(C.kitGuns(G, { rifle: 2, rifle_clip: 4, rocket_launcher: 1, small_rocket: 2, pistol: 1, pistol_clip: 2 }), ['rifle', 'rocket_launcher', 'pistol']);
    // sem foguetes o lança-foguetes não serve; atordoar e a bomba guiada são escolha do jogador
    t.eq(C.kitGuns(G, { rocket_launcher: 3, pistol: 1, pistol_clip: 1, small_launcher: 1, stun_bomb: 4, blaster_launcher: 1, blaster_bomb: 2 }), ['pistol']);
    // por investigar não entra; investigado entra pela ordem (plasma pesado primeiro, pistolas no fim)
    const mix = { heavy_plasma: 1, heavy_plasma_clip: 2, laser_pistol: 2, pistol: 1, pistol_clip: 1, heavy_cannon: 1, hc_ap: 3 };
    t.eq(C.kitGuns(G, mix), ['heavy_cannon', 'pistol']);
    G.researched.push('heavy_plasma', 'laser_pistol');
    t.eq(C.kitGuns(G, mix), ['heavy_plasma', 'heavy_cannon', 'laser_pistol', 'pistol']);
  });

  // ---- 2. Blaster e base alienígena -----------------------------------------------------------------------
  t.test('Blaster: no turno 1 de uma base alienígena a bomba não voa às cegas até ao centro de controlo (noRoute)', () => {
    const sim = require('../sim.js');
    for (let seed = 1; seed <= 4; seed++) {
      const mission = sim.missionFor({ kind: 'alienBase', diff: 2, month: 6, seed });
      mission.squad[0].loadout = { R: 'blaster_launcher', L: null, belt: ['blaster_bomb'], pack: [] };
      mission.squad[0].stats.str = 60;
      mission.researched = Object.keys(D.research);
      const B = BT.create(mission);
      B.researched = mission.researched;
      drain(BT.beginBattle(B));
      const u = B.units.find((x) => x.side === 'xcom');
      const R = BU.findItem(B, u.items.R);
      if (!R.ammo) R.ammo = { type: 'blaster_bomb', rounds: 1 };
      u.tu = u.tuMax;
      const target = B.objectiveTiles[0];
      t.ok(!(B.map.disc[target] & 1), 'o centro de controlo está por descobrir');
      const v = A.validate(B, { type: 'shoot', unitId: u.id, hand: 'R', mode: 'aimed', target: { i: target } });
      t.eq([v.ok, v.reason], [false, 'noRoute'], 'semente ' + seed);
      // a rota que existe sem a restrição passa por casas escuras
      const blind = OV.Path.flyRoute(B, BM.idx(B.map, u.x, u.y, u.z), target);
      t.ok(blind && blind.slice(1, -1).some((i) => !(B.map.disc[i] & 1)), 'sem a regra a rota atravessava o escuro');
      // com o mapa descoberto a rota volta a existir
      B.map.disc.fill(7);
      t.eq(A.validate(B, { type: 'shoot', unitId: u.id, hand: 'R', mode: 'aimed', target: { i: target } }).ok, true);
      // e mesmo destruindo o centro, a batalha continua (sair é que dá a vitória)
      for (const i of B.objectiveTiles) for (let p = 0; p < 4; p++) { const d = BM.def(B.map, i, p); if (d && d.special === 'OBJECTIVE') B.map.parts[i * 4 + p] = 0; }
      t.eq([BT.outcome(B), BT.exitWin(B)], [null, true]);
    }
  });

  t.test('Blaster: os alienígenas continuam a usar a rota sem restrição de descoberta', () => {
    const sim = require('../sim.js');
    const B = BT.create(sim.missionFor({ kind: 'alienBase', diff: 1, month: 6, seed: 2 }));
    drain(BT.beginBattle(B));
    const a = B.units.find((x) => x.origSide === 'alien' && LIVE[x.status] && (x.size | 0) <= 1);
    const x = B.units.find((u) => u.side === 'xcom');
    const from = BM.idx(B.map, a.x, a.y, a.z), to = BM.idx(B.map, x.x, x.y, x.z);
    t.eq(JSON.stringify(OV.Path.flyRoute(B, from, to, { side: 'alien' })), JSON.stringify(OV.Path.flyRoute(B, from, to)));
  });

  // ---- 3. defesa da base -----------------------------------------------------------------------------------
  function baseG(seed, diff, month) {
    const G = C.newCampaign({ seed, difficulty: diff });
    G.alienMissions = [];
    G.events.length = 0;
    G.month = month;
    return G;
  }
  function assault(G, race) {
    const b = G.bases[0];
    const u = {
      id: C.nextId(G, 'u'), type: 'battleship', missionId: null, race, region: OV.GMath.regionAt(b.lon, b.lat), traj: 'P0', wp: 0,
      lon: b.lon, lat: b.lat, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 3600,
      crashLeftS: 86400, lastSeen: null, objective: false, targetBaseId: b.id, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }

  t.test('defesa: a arma conta (espingarda 0, plasma pesado +42, desarmado −15) e os desarmados pegam no armazém', () => {
    const G = baseG(4, 1, 3);
    const s = Object.values(G.soldiers)[0];
    const base = s.stats.tu + s.stats.fire + s.stats.hp + D.armours[s.armour].front;
    t.eq(C.defenderPower(s, D.items.rifle_clip.power), base, 'espingarda');
    t.eq(C.defenderPower(s, 115), base + 42, 'plasma pesado');
    t.eq(C.defenderPower(s, 0), base - 15, 'desarmado');
    // guarnição sem armas nas mãos: o armazém tem 2 espingardas e 2 pistolas com munição (base inicial)
    const G2 = baseG(4, 1, 3);
    for (const x of Object.values(G2.soldiers)) x.loadout = C.emptyLoadout();
    const bare = C.defenceOdds(G2, 'b1', { race: 'sectoid' });
    G2.bases[0].stores.heavy_plasma = 10;
    G2.bases[0].stores.heavy_plasma_clip = 10;
    G2.researched.push('heavy_plasma', 'heavy_plasma_clip');
    const armed = C.defenceOdds(G2, 'b1', { race: 'sectoid' });
    // sem nada: 7 armas do armazém inicial (Lança-Foguetes +22, Canhões +13/+6, espingardas 0, pistolas −2) e 3 desarmados
    t.eq(armed.men - bare.men, 10 * 42 - (22 + 13 + 6 + 0 + 0 - 2 - 2 - 3 * 15), 'plasma pesado do armazém: ' + bare.men + ' → ' + armed.men);
    // por investigar não conta
    const G3 = baseG(4, 1, 3);
    for (const x of Object.values(G3.soldiers)) x.loadout = C.emptyLoadout();
    const b3 = C.defenceOdds(G3, 'b1', { race: 'sectoid' }).men;
    G3.bases[0].stores.heavy_plasma = 10;
    G3.bases[0].stores.heavy_plasma_clip = 10;
    t.eq(C.defenceOdds(G3, 'b1', { race: 'sectoid' }).men, b3, 'plasma por investigar não se usa');
  });

  t.test('defesa: probabilidades suaves pelo rácio (≤ 50 % cai, ≥ 150 % repele, no meio aguenta a custo)', () => {
    // a tabela pelo rácio, com a estimativa a bater certo com o sorteio
    const rows = [];
    for (const race of ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal']) {
      const g = baseG(4, 1, 3);
      const e = C.defenceOdds(g, 'b1', { race });
      t.eq(e.lostPct + e.repelPct + e.holdPct, 100, race);
      t.eq(e.ratio, Math.floor((100 * e.strength) / e.need), race);
      if (e.ratio <= T.BASE_DEFENCE_RATIO_LO) t.eq(e.lostPct, 100);
      if (e.ratio >= T.BASE_DEFENCE_RATIO_HI) t.eq(e.repelPct, 100);
      if (e.ratio >= T.BASE_DEFENCE_RATIO_MID) t.eq(e.lostPct, 0);
      rows.push(e);
      // o assalto real usa as mesmas contas (sem defesas, a salva não tira casco)
      const r = C.baseDefence(g, 'b1', assault(g, race).id);
      t.eq([r.odds.ratio, r.odds.lostPct, r.odds.repelPct], [e.ratio, e.lostPct, e.repelPct], race);
    }
    // monotonia: mais forte ⇒ menos perda
    const sorted = rows.slice().sort((a, b) => a.ratio - b.ratio);
    for (let k = 1; k < sorted.length; k++) t.ok(sorted[k].lostPct <= sorted[k - 1].lostPct);
  });

  t.test('defesa: aguentar a custo mata ≥ 60 % da guarnição (fica alguém), desfaz radares/defesas e não dá pontos', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40 && seen < 3; seed++) {
      const G = baseG(seed, 1, 3);
      const b = G.bases[0];
      b.grid.push({ type: 'missile_defence', x: 1, y: 2, daysLeft: 0 }); // ao lado do radar inicial
      const before = b.grid.length;
      const garrison = Object.values(G.soldiers).length;
      const scoreBefore = G.score.month.xcom.total | 0;
      const r = C.baseDefence(G, 'b1', assault(G, 'muton').id);
      if (r.result === 'ufoDestroyed') continue;
      t.ok(r.odds.lostPct < 100 && r.odds.repelPct < 100, JSON.stringify(r.odds));
      if (!r.held) continue;
      seen++;
      t.eq(r.result, 'repelled');
      t.ok(r.soldiersLost.length >= Math.ceil(garrison * T.BASE_DEFENCE_HOLD_CASUALTY_PCT / 100) && r.soldiersLost.length <= garrison - 1, r.soldiersLost.length + '/' + garrison);
      t.eq(b.grid.length, before, 'nada é demolido');
      t.ok(r.facilitiesDamaged.length >= 1 && r.facilitiesDamaged.length <= T.BASE_DEFENCE_HOLD_FACILITIES, JSON.stringify(r.facilitiesDamaged));
      for (const f of r.facilitiesDamaged) {
        const def = D.facilities[f];
        t.ok(!def.lift && !(def.personnel > 0) && !(def.crafts > 0) && !(def.storage > 0), f);
      }
      t.ok(b.grid.filter((f) => f.daysLeft > 0).length === r.facilitiesDamaged.length, 'voltam a obra');
      t.eq(G.score.month.xcom.total | 0, scoreBefore, 'sem pontos');
      t.ok(C.findBase(G, 'b1'), 'a base continua');
      const ev = G.events.find((e) => e.t === 'baseDefence');
      t.eq([ev.result, ev.held, ev.facilitiesDamaged], ['repelled', true, r.facilitiesDamaged]);
    }
    t.ok(seen >= 1, 'pelo menos um assalto aguentado a custo em 40 sementes');
  });

  t.test('defesa: estimativa para a interface (raça da retaliação ou a pior do mês; quantos soldados/defesas faltam)', () => {
    const G = baseG(5, 1, 3);
    const e = C.defenceOdds(G, 'b1');
    const worst = Math.max(...Object.keys(D.raceWeights('alien_retaliation', 3)).map((r) => C.defenceOdds(G, 'b1', { race: r }).need));
    t.eq(e.need, worst, 'sem retaliação à vista: a raça mais forte do mês (' + e.race + ')');
    t.eq(e.ufoType, 'battleship');
    t.eq(e.garrison, 10);
    if (e.ratio < T.BASE_DEFENCE_RATIO_MID) {
      t.ok(e.soldiersShort > 0);
      // com os soldados em falta (da mesma força média) chega-se ao rácio 100
      const avg = Math.floor(e.men / e.garrison);
      t.ok(e.strength + e.soldiersShort * avg * 1.66 >= e.need, JSON.stringify(e));
    }
    // retaliação já a caminho da base: a raça é a dela
    G.alienMissions.push({ id: 'm9', type: 'alien_retaliation', region: G.bases[0].region, race: 'sectoid', targetBaseId: 'b1', wave: 0 });
    t.eq(C.defenceOdds(G, 'b1').race, 'sectoid');
    // muitos soldados fortes: nada falta
    const G2 = baseG(5, 0, 1);
    const ok = C.defenceOdds(G2, 'b1');
    t.eq([ok.lostPct, ok.soldiersShort, ok.defencesShort], [0, 0, 0], JSON.stringify(ok));
    // guarnição vazia: perda certa
    const G3 = baseG(5, 1, 3);
    for (const s of Object.values(G3.soldiers)) s.woundDays = 5;
    const none = C.defenceOdds(G3, 'b1');
    t.eq([none.garrison, none.lostPct], [0, 100]);
  });

  // ---- 5. terror do mês 0 ----------------------------------------------------------------------------------
  t.test('terror do mês 0: tabela de uma dificuldade abaixo e −1 terrorista (Veterano 4, Super-humano 4–6); mês 1 inteiro', () => {
    const r = (diff, month) => { const x = D.deploymentRange('dep_terror_site', diff, month); return [x.min, x.max]; };
    t.eq(r(1, 0), [4, 4]);
    t.eq(r(2, 0), [4, 6]);
    t.eq(r(0, 0), [4, 4]);
    t.eq(r(1, 1), [5, 7]);
    t.eq(r(1), [5, 7], 'sem mês: tabela da dificuldade');
    const ter = D.deployments.dep_terror_site.rows.find((x) => x.rank === 'terrorist');
    t.eq(D.crewQty('dep_terror_site', ter, 1, 0), [1, 1]);
    // um OVNI do mês 0 não perde terroristas (só a tabela de uma dificuldade abaixo)
    const ls = D.deployments.dep_large_scout.rows;
    t.eq(ls.map((x) => D.crewQty('dep_large_scout', x, 1, 0)), ls.map((x) => D.rowQty(x, 0)));
    for (const seed of [1, 2, 3]) {
      const B = BT.create(BT.quickMission({ kind: 'terror', difficulty: 1, month: 0, seed, squadSize: 8 }));
      t.eq(B.units.filter((u) => u.origSide === 'alien').length, 4, 'semente ' + seed);
    }
  });
};
