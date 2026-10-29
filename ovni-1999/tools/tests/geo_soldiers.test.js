/* OV.Soldiers: recrutamento (== Campaign.makeSoldier), pós-missão, baixas, promoções por quotas, memorial.
   Contrato: docs/CAMPAIGN_API.md §1.9, §5.8; DESIGN §3.2. */
module.exports = function (OV, t) {
  const S = OV.Soldiers, Camp = OV.Campaign, D = OV.Data;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fresh = (seed) => Camp.newCampaign({ seed: seed || 5 });
  // gerador com valores impostos (int devolve o próximo da fila, limitado a [a,b])
  const scripted = (vals) => ({
    int(a, b) { const v = vals.length ? vals.shift() : a; return Math.max(a, Math.min(b, v)); },
    pct() { return false; },
  });

  t.test('Soldiers.generate == Campaign.makeSoldier (mesma ordem de sorteios, 16 números da stream geo)', () => {
    const G1 = fresh(11), G2 = fresh(11);
    for (let k = 0; k < 5; k++) {
      const a = S.generate(G1, { baseId: 'b1' });
      const b = Camp.makeSoldier(G2, { baseId: 'b1' });
      t.eq(a, b, 'recruta ' + k);
    }
    t.eq(G1.rng, G2.rng, 'estado das streams');
    t.eq(G1.ids, G2.ids);
    const s = S.generate(G1, { baseId: 'b1' });
    t.eq([s.rank, s.missions, s.kills, s.woundDays, s.armour, s.craftId], [0, 0, 0, 0, 'coveralls', null]);
    t.ok(!G1.soldiers[s.id], 'não inserido');
    for (const k of D.soldierGen.statKeys) t.ok(s.stats[k] >= D.soldierGen.statsMin[k] && s.stats[k] <= D.soldierGen.statsMax[k], k);
  });

  t.test('woundDaysFor: ceil(HP perdido × pct / 100), 25–75 % (ours)', () => {
    t.eq(S.woundDaysFor(10, 25), 3);
    t.eq(S.woundDaysFor(10, 75), 8);
    t.eq(S.woundDaysFor(20, 50), 10);
    t.eq(S.woundDaysFor(1, 25), 1);
    t.eq(S.woundDaysFor(0, 75), 0);
  });

  t.test('applyMission: Recruta → Soldado com exp. secundária, missões/abates, baixa e saída da nave', () => {
    const G = fresh(3);
    const sid = G.crafts.c1.soldiers[0];
    const s = G.soldiers[sid];
    const before = clone(s.stats);
    const r = S.applyMission(G, sid, { exp: { fire: 3, react: 1 }, hpLost: 12, kills: 2 }, Camp.rng(G, 'combat'));
    t.eq(r.promotedTo, 1);
    t.eq(s.rank, 1);
    t.eq([s.missions, s.kills], [1, 2]);
    t.ok(s.stats.fire >= before.fire + 1 && s.stats.fire <= before.fire + 3, 'Pontaria +1..3 com 3 de exp.');
    t.ok(s.woundDays >= 3 && s.woundDays <= 9, 'baixa ' + s.woundDays);
    t.eq(r.woundDays, s.woundDays);
    t.eq(s.craftId, null, 'ferido sai da nave');
    t.ok(G.crafts.c1.soldiers.indexOf(sid) < 0);
    // sem experiência: não é promovido nem fica ferido
    const sid2 = G.crafts.c1.soldiers[0];
    const r2 = S.applyMission(G, sid2, { exp: {}, hpLost: 0, kills: 0 }, Camp.rng(G, 'combat'));
    t.eq([r2.promotedTo, G.soldiers[sid2].rank, G.soldiers[sid2].woundDays, G.soldiers[sid2].craftId], [null, 0, 0, 'c1']);
  });

  t.test('applyMission: dias de baixa cobrem exatamente 25–75 % do HP perdido', () => {
    const G = fresh(4);
    const sid = Object.keys(G.soldiers)[0];
    let lo = 99, hi = 0;
    const rng = OV.RNG.create(77);
    for (let k = 0; k < 400; k++) {
      G.soldiers[sid].woundDays = 0;
      const r = S.applyMission(G, sid, { exp: {}, hpLost: 20, kills: 0 }, rng);
      lo = Math.min(lo, r.woundDays);
      hi = Math.max(hi, r.woundDays);
    }
    t.eq([lo, hi], [5, 15]);
    // pct imposta: postMission não sorteia sem exp; a única tiragem é a percentagem
    G.soldiers[sid].woundDays = 0;
    t.eq(S.applyMission(G, sid, { exp: {}, hpLost: 7, kills: 0 }, scripted([50])).woundDays, 4);
  });

  t.test('quotas de patente (ours): N/4, N/8, N/15, comandante com N ≥ 20', () => {
    t.eq(S.quotas(8), { sergeant: 2, captain: 1, colonel: 0, commander: 0 });
    t.eq(S.quotas(16), { sergeant: 4, captain: 2, colonel: 1, commander: 0 });
    t.eq(S.quotas(20), { sergeant: 5, captain: 2, colonel: 1, commander: 1 });
    t.eq(S.quotas(3), { sergeant: 0, captain: 0, colonel: 0, commander: 0 });
  });

  t.test('promotionScore: fórmula orig (2·HP + 2·Ene + 4·Rea + 4·Bra + 3·(UT + 2·Pon) + CaC + Lan + For + 10·(missões+abates))', () => {
    const s = { stats: { tu: 55, sta: 50, hp: 30, brav: 40, react: 45, fire: 60, thr: 60, str: 30, melee: 30, psiStr: 50, psiSkill: 0 }, missions: 2, kills: 3 };
    t.eq(S.promotionScore(s), 60 + 100 + 180 + 160 + 3 * (55 + 120) + 30 + 60 + 30 + 50);
    s.stats.psiSkill = 10;
    t.eq(S.promotionScore(s), 60 + 100 + 180 + 160 + 525 + 120 + 50 + 50 + 20);
  });

  t.test('promotions: vagas de cima para baixo, maior pontuação primeiro; recrutas nunca sobem por quota', () => {
    const G = fresh(6);
    for (let k = 0; k < 8; k++) Camp.addSoldier(G, S.generate(G, { baseId: 'b1' })); // 16 soldados
    const ids = Object.keys(G.soldiers);
    ids.forEach((id, i) => {
      G.soldiers[id].rank = i < 14 ? 1 : 0;
      G.soldiers[id].missions = i * 100; // pontuação cresce com i (domina os atributos)
      G.soldiers[id].kills = 0;
    });
    // o melhor de todos é recruta: não conta
    G.soldiers[ids[15]].missions = 9999;
    const p1 = S.promotions(G);
    t.eq(p1.map((p) => [p.id, p.from, p.to]), [[ids[13], 1, 2], [ids[12], 1, 2], [ids[11], 1, 2], [ids[10], 1, 2]],
      'quatro sargentos (16/4), os de maior pontuação');
    // 2.ª ronda: sem capitães não há coronel; dois capitães (de sargento) e repõe dois sargentos
    const p2 = S.promotions(G);
    t.eq(p2.map((p) => [p.id, p.to]), [[ids[13], 3], [ids[12], 3], [ids[9], 2], [ids[8], 2]]);
    // 3.ª ronda: coronel (16/15) do melhor capitão, repõe capitão e sargento
    const p3 = S.promotions(G);
    t.eq(p3.map((p) => [p.id, p.to]), [[ids[13], 4], [ids[11], 3], [ids[7], 2]]);
    const ranks = [0, 0, 0, 0, 0, 0];
    for (const id of ids) ranks[G.soldiers[id].rank]++;
    t.eq(ranks, [2, 7, 4, 2, 1, 0]);
    t.eq(S.promotions(G), [], 'quotas cheias');
  });

  t.test('daily: baixa −1 por dia e soldierRecovered ao chegar a 0', () => {
    const G = fresh(7);
    const sid = Object.keys(G.soldiers)[2];
    G.soldiers[sid].woundDays = 2;
    G.events.length = 0;
    S.daily(G);
    t.eq(G.soldiers[sid].woundDays, 1);
    t.eq(G.events.length, 0);
    S.daily(G);
    t.eq(G.soldiers[sid].woundDays, 0);
    t.eq(G.events.map((e) => [e.t, e.soldierId, e.baseId, e.stop]), [['soldierRecovered', sid, 'b1', false]]);
  });

  t.test('kill: memorial, saída da base e da nave, contador de baixas; value = 20 + missões + bónus', () => {
    const G = fresh(8);
    const sid = G.crafts.c1.soldiers[1];
    const s = G.soldiers[sid];
    s.rank = 2;
    s.missions = 3;
    s.kills = 4;
    t.eq(S.value(s), 20 + 3 + 1);
    G.t = 3600;
    const e = S.kill(G, sid, 'kia', { kind: 'ufo', lon: 10, lat: 45 });
    t.eq(e, {
      id: sid, name: s.name, nat: s.nat, female: s.female, rank: 2, portraitSeed: s.portraitSeed, missions: 3, kills: 4,
      armour: 'coveralls', diedT: 3600, cause: 'kia', where: { kind: 'ufo', lon: 10, lat: 45 },
    });
    t.ok(!G.soldiers[sid]);
    t.ok(G.bases[0].soldiers.indexOf(sid) < 0 && G.crafts.c1.soldiers.indexOf(sid) < 0);
    t.eq(G.dead.length, 1);
    t.eq(G.stats.soldiersLost, 1);
    t.eq(S.kill(G, sid, 'kia'), null, 'segunda vez não faz nada');
    t.eq(S.value({ rank: 5, missions: 0 }), 30);
  });

  t.test('rename: aparado, limite de 24 caracteres, vazio recusado', () => {
    const G = fresh(9);
    const sid = Object.keys(G.soldiers)[0];
    t.eq(S.rename(G, sid, '  Ana   Ribeiro  ').ok, true);
    t.eq(G.soldiers[sid].name, 'Ana Ribeiro');
    t.eq(S.rename(G, sid, '   '), { ok: false, reason: 'name' });
    S.rename(G, sid, 'x'.repeat(40));
    t.eq(G.soldiers[sid].name.length, 24);
  });

  t.test('determinismo: pós-missão e promoções iguais em duas cópias (hash)', () => {
    const run = () => {
      const G = fresh(12);
      for (const sid of G.crafts.c1.soldiers.slice()) S.applyMission(G, sid, { exp: { fire: 4, brav: 2, react: 1 }, hpLost: 5, kills: 1 }, Camp.rng(G, 'combat'));
      S.promotions(G);
      for (let d = 0; d < 5; d++) S.daily(G);
      return Camp.hash(G);
    };
    t.eq(run(), run());
  });
};
