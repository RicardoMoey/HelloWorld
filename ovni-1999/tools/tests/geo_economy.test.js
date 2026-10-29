/* OV.Economy: pontuação por região/país, manutenção, financiamento (Country::newMonth), avaliação, Conselho e derrota.
   Contrato: docs/CAMPAIGN_API.md §1.5–§1.7, §5.7; REA 02-geoscape §8.1, §9.3. */
module.exports = function (OV, t) {
  const E = OV.Economy, Camp = OV.Campaign, D = OV.Data;
  const fresh = (o) => {
    const G = Camp.newCampaign(Object.assign({ seed: 21 }, o || {}));
    G.events.length = 0;
    return G;
  };
  // gerador com valores impostos: regista os pedidos (a, b) e devolve o próximo valor da fila
  const scripted = (vals) => {
    const calls = [];
    return {
      calls,
      int(a, b) { calls.push([a, b]); return vals.length ? vals.shift() : a; },
    };
  };
  const PARIS = { lon: 2.35, lat: 48.85 };

  t.test('fundingChange: sobe com good > bad+30 e RNG(0,good) > bad (delta = floor(k × RNG(5,20)/100) × 1000)', () => {
    const r = scripted([10, 100]);
    t.eq(E.fundingChange(500, 8000, 200, 50, r), { delta: 50000, mood: 'pleased' });
    t.eq(r.calls, [[5, 20], [0, 200]]);
    t.eq(E.fundingChange(500, 8000, 200, 50, scripted([10, 50])), { delta: 0, mood: 'same' }, 'RNG(0,good) = bad não chega');
    t.eq(E.fundingChange(333, 8000, 200, 50, scripted([7, 51])), { delta: 23000, mood: 'pleased' }, 'floor(333×7/100)=23 k$');
  });
  t.test('fundingChange: teto do país e zona neutra (sem segundo sorteio)', () => {
    t.eq(E.fundingChange(9990, 10000, 500, 0, scripted([20, 400])), { delta: 10000, mood: 'pleased' }, 'só até ao teto');
    t.eq(E.fundingChange(10000, 10000, 500, 0, scripted([20, 400])), { delta: 0, mood: 'same' }, 'no teto');
    const r = scripted([20]);
    t.eq(E.fundingChange(400, 4000, 60, 40, r), { delta: 0, mood: 'same' });
    t.eq(r.calls.length, 1, 'good ≤ bad+30: só o sorteio do delta');
    const r2 = scripted([20]);
    t.eq(E.fundingChange(400, 4000, 40, 70, r2), { delta: 0, mood: 'same' }, 'bad = good+30 ainda é neutro');
    t.eq(r2.calls.length, 1);
  });
  t.test('fundingChange: desce com bad > good+30 e RNG(0,bad) > good; nunca abaixo de 0', () => {
    const r = scripted([20, 90]);
    t.eq(E.fundingChange(600, 10000, 10, 100, r), { delta: -120000, mood: 'unhappy' });
    t.eq(r.calls, [[5, 20], [0, 100]]);
    t.eq(E.fundingChange(600, 10000, 10, 100, scripted([20, 10])), { delta: 0, mood: 'same' }, 'RNG(0,bad) = good');
    t.eq(E.fundingChange(4, 10000, 0, 100, scripted([20, 50])), { delta: 0, mood: 'same' }, 'delta 0 k$ (4×20/100 = 0)');
  });

  t.test('upkeep da base inicial = $2 619 000 (instalações 169 k + aluguer 1 700 k + salários 750 k: 10 soldados, ours)', () => {
    const G = fresh();
    t.eq(E.upkeep(G), { facilities: 169000, salaries: 750000, crafts: 1700000, total: 2619000 });
    t.eq(E.income(G), 6000000);
    // pessoal e naves encomendados já contam (Base::getMonthlyMaintenace orig); obras não
    G.bases[0].deliveries.push({ id: 'dl9', kind: 'scientist', itemId: null, n: 2, etaT: 999999 });
    G.bases[0].deliveries.push({ id: 'dl10', kind: 'craft', itemId: 'interceptor', n: 1, etaT: 999999 });
    G.bases[0].grid.push({ type: 'laboratory', x: 1, y: 2, daysLeft: 5 });
    t.eq(E.upkeep(G).total, 2619000 + 60000 + 600000);
    G.countries[0].pact = true;
    t.eq(E.income(G), 6000000 - G.countries[0].funding);
  });

  t.test('addScore: total, região e país pelos retângulos orig; investigação sem posição', () => {
    const G = fresh();
    const m = G.score.month;
    E.addScore(G, 'xcom', 50, PARIS.lon, PARIS.lat);
    E.addScore(G, 'alien', 7, PARIS);
    E.addScore(G, 'alien', 3, -30, 40); // Atlântico Norte: região sem país
    E.addScore(G, 'research', 20);
    E.addScore(G, 'xcom', -10);
    t.eq(m.xcom.total, 40);
    t.eq(m.xcom.regions, { europe: 50 });
    t.eq(m.xcom.countries, { france: 50 });
    t.eq(m.alien.total, 10);
    t.eq(Object.keys(m.alien.regions).length, 2);
    t.eq(m.alien.countries, { france: 7 });
    t.eq(m.research, 20);
    t.throws(() => E.addScore(G, 'nobody', 1));
  });

  t.test('ufoActivity30m (+1 em voo, +2 em terra, 0 caído) e daily (+5 por base alienígena)', () => {
    const G = fresh();
    const u = (status) => ({ id: 'u' + G.ufos.length, type: 'small_scout', status, lon: PARIS.lon, lat: PARIS.lat });
    G.ufos.push(u('flying'), u('landed'), u('crashed'));
    E.ufoActivity30m(G);
    t.eq(G.score.month.alien.total, 3);
    t.eq(G.score.month.alien.countries.france, 3);
    G.alienBases.push({ id: 'a1', lon: PARIS.lon, lat: PARIS.lat }, { id: 'a2', lon: 100, lat: 60 });
    E.daily(G);
    t.eq(G.score.month.alien.total, 13);
  });

  t.test('rating: X-COM + investigação + bónus do Conselho (a partir do relatório de fevereiro) − alienígenas', () => {
    const G = fresh();
    E.addScore(G, 'xcom', 300, PARIS);
    E.addScore(G, 'research', 100);
    E.addScore(G, 'alien', 150, PARIS);
    t.eq(E.councilBonus(G, 0), 0);
    t.eq(E.councilBonus(G, 1), 400);
    t.eq(E.rating(G), 250);
    G.month = 1;
    t.eq(E.rating(G), 650);
  });

  t.test('ratingKey e councilKey (Veterano: T = −700)', () => {
    const G = fresh({ difficulty: 1 });
    const cases = [[-1001, 'terrible'], [-1000, 'terrible'], [-999, 'poor'], [-700, 'poor'], [-699, 'ok'], [0, 'ok'], [1, 'good'], [500, 'good'], [501, 'excellent']];
    for (const [r, k] of cases) t.eq(E.ratingKey(G, r), 'rating.' + k, String(r));
    t.eq([E.councilKey(G, -700), E.councilKey(G, -699), E.councilKey(G, 500), E.councilKey(G, 501)],
      ['council.dissatisfied', 'council.satisfied', 'council.satisfied', 'council.pleased']);
    t.eq(E.ratingKey(fresh({ difficulty: 0 }), -900), 'rating.poor');
    t.eq(E.ratingKey(fresh({ difficulty: 2 }), -500), 'rating.poor');
  });

  t.test('monthEnd: fundos, relatório, histórico, países e reinício da pontuação', () => {
    const G = fresh();
    E.addScore(G, 'xcom', 600, PARIS);
    E.addScore(G, 'research', 40);
    E.addScore(G, 'alien', 200, -100, 40); // EUA
    const before = G.countries.map((c) => c.funding);
    const fundsBefore = G.funds;
    const rep = E.monthEnd(G);
    t.eq(rep.month, 0);
    t.eq([rep.y, rep.m], [1999, 0]);
    t.eq([rep.xcom, rep.alien, rep.research, rep.councilBonus, rep.rating], [600, 200, 40, 0, 440]);
    t.eq([rep.ratingKey, rep.councilKey], ['rating.good', 'council.satisfied']);
    t.eq(rep.income, 6000000);
    t.eq(rep.upkeep.total, 2619000);
    t.eq([rep.fundsBefore, rep.fundsAfter, G.funds], [fundsBefore, fundsBefore + 6000000 - 2619000, fundsBefore + 3381000]);
    t.eq(rep.countries.length, 17); // 16 orig + Portugal (ours)
    rep.countries.forEach((c, i) => {
      t.eq(c.before, before[i]);
      t.eq(c.after, G.countries[i].funding);
      t.eq(c.delta, c.after - c.before);
      t.eq(c.delta % 1000, 0, 'passos de $1000');
      t.eq(G.countries[i].history, [c.after]);
      t.eq(G.countries[i].lastDelta, c.delta);
      t.ok(c.after <= D.countries[c.id].fundingCap * 1000);
      t.eq(c.mood, c.delta > 0 ? 'pleased' : c.delta < 0 ? 'unhappy' : 'same');
    });
    t.eq(rep.countries.find((c) => c.id === 'france').mood !== 'unhappy', true, 'França com 600 pontos locais nunca desce');
    t.eq([rep.debtWarning, rep.badMonths, rep.debtMonths, rep.defeat, rep.alienBaseRevealed], [false, 0, 0, null, null]);
    t.eq(G.history, [{ month: 0, funds: G.funds, income: 6000000, upkeep: 2619000, xcom: 600, alien: 200, research: 40, rating: 440 }]);
    t.eq(G.reports.length, 1);
    t.eq(G.score.all, { xcom: 600, alien: 200, research: 40 });
    t.eq(G.score.month, Camp.newScoreMonth());
    t.eq(G.council.lastRating, 440);
    t.eq(JSON.parse(JSON.stringify(rep)), rep, 'relatório em JSON puro');
  });

  t.test('monthEnd: pactos (financiamento 0, newPact pelo evento pactSigned) e base revelada pelos agentes', () => {
    const G = fresh();
    G.countries[3].pact = true;
    Camp.event(G, 'pactSigned', { countryId: G.countries[3].id });
    Camp.event(G, 'alienBaseFound', { alienBaseId: 'a4', how: 'agents' });
    const rep = E.monthEnd(G);
    const c = rep.countries[3];
    t.eq([c.after, c.pact, c.newPact, c.mood], [0, true, true, 'unhappy']);
    t.eq(rep.income, 6000000, 'o país do pacto ainda paga o mês que acabou (monthlyFunding orig)');
    t.eq(rep.alienBaseRevealed, 'a4');
    G.events.length = 0; // a interface esvazia a fila; o mês seguinte acaba noutro instante
    G.t = OV.Clock.monthStartT(1);
    G.month = 1;
    const rep2 = E.monthEnd(G);
    t.eq(rep2.alienBaseRevealed, null);
    t.eq([rep2.countries[3].after, rep2.countries[3].newPact, rep2.countries[3].mood], [0, false, 'same']);
    t.eq(rep2.income, 6000000 - c.before, 'depois do pacto o país já não paga');
  });

  t.test('monthEnd: os pontos do pacto (Missions.monthEnd) ficam no registo do mês mas fora da avaliação', () => {
    const pts = OV.Data.scoring.missionPoints.alien_infiltration;
    const G = fresh();
    E.addScore(G, 'xcom', 300, -9.14, 38.72);
    const G0 = JSON.parse(JSON.stringify(G));
    Camp.rebuildDerived(G0);
    const ref = E.monthEnd(G0);
    const cid = G.countries[3].id;
    G.countries[3].pact = true;
    const def = OV.Data.countries[cid];
    E.addScore(G, 'alien', pts, def.label[0], def.label[1]);
    Camp.event(G, 'pactSigned', { countryId: cid });
    const rep = E.monthEnd(G);
    t.eq(rep.rating, ref.rating, 'avaliação igual à de um mês sem pacto');
    t.eq(rep.alien, ref.alien);
    t.eq(G.score.all.alien, pts, 'os pontos ficam no total de sempre');
  });

  t.test('derrota pelo Conselho: avaliação ≤ T dois meses seguidos', () => {
    const G = fresh({ difficulty: 1 });
    E.addScore(G, 'alien', 800, PARIS);
    const r1 = E.monthEnd(G);
    t.eq([r1.rating, r1.badMonths, r1.defeat, r1.councilKey], [-800, 1, null, 'council.dissatisfied']);
    t.eq(E.checkDefeat(G), null);
    G.month = 1;
    E.addScore(G, 'alien', 1200, PARIS); // fevereiro: bónus +400 ⇒ −800
    const r2 = E.monthEnd(G);
    t.eq([r2.councilBonus, r2.rating, r2.badMonths, r2.defeat], [400, -800, 2, 'council']);
    t.eq(E.checkDefeat(G), 'council');
    // um mês bom pelo meio reinicia a contagem
    const H = fresh({ difficulty: 1 });
    E.addScore(H, 'alien', 800, PARIS);
    E.monthEnd(H);
    E.monthEnd(H);
    t.eq(H.council.badMonths, 0);
  });

  t.test('dívida: aviso no primeiro fim de mês ≤ −$1 M, derrota no segundo', () => {
    const G = fresh();
    G.funds = -5000000;
    const r1 = E.monthEnd(G);
    t.ok(G.funds <= -1000000);
    t.eq([r1.debtMonths, r1.debtWarning, r1.defeat], [1, true, null]);
    G.funds = -5000000;
    const r2 = E.monthEnd(G);
    t.eq([r2.debtMonths, r2.debtWarning, r2.defeat], [2, false, 'debt']);
    G.funds = 0;
    E.monthEnd(G);
    t.eq(G.council.debtMonths, 0);
  });

  t.test('checkDefeat: sem bases ⇒ baseLost; histórico limitado a 12 meses', () => {
    const G = fresh();
    for (let k = 0; k < 14; k++) {
      E.monthEnd(G);
      G.month++;
    }
    t.eq(G.history.length, 12);
    t.eq(G.reports.length, 12);
    t.eq(G.history[0].month, 2);
    t.eq(G.countries[0].history.length, 12);
    G.bases.length = 0;
    t.eq(E.checkDefeat(G), 'baseLost');
  });

  t.test('determinismo: monthEnd em duas cópias dá o mesmo hash', () => {
    const run = () => {
      const G = fresh({ seed: 99 });
      E.addScore(G, 'xcom', 900, PARIS);
      E.addScore(G, 'alien', 300, -100, 40);
      E.monthEnd(G);
      G.month = 1;
      E.addScore(G, 'alien', 2000, 139, 36);
      E.monthEnd(G);
      return Camp.hash(G);
    };
    t.eq(run(), run());
  });
};
