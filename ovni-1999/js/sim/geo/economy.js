/* Economia, pontuação e Conselho (DESIGN.md §3.17; REA 02-geoscape §8–§9; contrato docs/CAMPAIGN_API.md §1.5–§1.7, §5.7).
   OV.Economy = {
     addScore(G, side 'xcom'|'alien'|'research', pts, lon|ponto?, lat?)   região/país pelos retângulos orig (GMath)
     ufoActivity30m(G) ; daily(G)                              §3.1 passos 9 e 14
     upkeep(G) → {facilities, salaries, crafts, total} ; baseUpkeep(G, base) → idem para uma base
     income(G) → int ; councilBonus(G, monthIdx?) → int
     rating(G) → int (mês corrente) ; ratingKey(G, rating?) → 'rating.*' ; councilKey(G, rating) → 'council.*'
     fundingChange(fundingK, capK, good, bad, rng) → {delta, mood}   Country::newMonth (orig, passos de $1000)
     monthEnd(G) → report ; checkDefeat(G) → null|'council'|'debt'|'baseLost' }
   Regra R1: sem DOM; as alterações de financiamento sorteiam da stream geo pela ordem de G.countries. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const HISTORY_MAX = 12;

  const SIDES = { xcom: 1, alien: 1, research: 1 };

  // pontos para um lado; xcom/alien acumulam também na região e no país do ponto (oceanos têm região, não país)
  function addScore(G, side, pts, lonOrPoint, lat) {
    if (!SIDES[side]) throw new Error('Economy.addScore: lado ' + side);
    const p = Math.trunc(pts) || 0;
    if (!p) return 0;
    const m = G.score.month;
    if (side === 'research') {
      m.research += p;
      return p;
    }
    let lon = lonOrPoint;
    if (lonOrPoint && typeof lonOrPoint === 'object') {
      lon = lonOrPoint.lon;
      lat = lonOrPoint.lat;
    }
    const s = m[side];
    s.total += p;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const r = OV.GMath.regionAt(lon, lat);
      if (r) s.regions[r] = (s.regions[r] | 0) + p;
      const c = OV.GMath.countryAt(lon, lat);
      if (c) s.countries[c] = (s.countries[c] | 0) + p;
    }
    return p;
  }

  // atividade alienígena a cada 30 min: +1 por OVNI em voo, +2 em terra (no ponto do OVNI)
  function ufoActivity30m(G) {
    const ua = D().scoring.ufoActivity;
    for (const u of G.ufos) {
      if (u.status === 'flying') addScore(G, 'alien', ua.flying, u.lon, u.lat);
      else if (u.status === 'landed') addScore(G, 'alien', ua.landed, u.lon, u.lat);
    }
  }

  // cada base alienígena (descoberta ou não) vale pontos diários aos alienígenas
  function daily(G) {
    const pts = D().scoring.alienBasePerDay;
    for (const ab of G.alienBases) addScore(G, 'alien', pts, ab.lon, ab.lat);
  }

  // manutenção mensal de uma base: instalações concluídas, salários (incluindo pessoal a caminho), aluguer das naves
  // (incluindo naves compradas a caminho) — Base::getMonthlyMaintenace orig
  function baseUpkeep(G, base) {
    const spec = { facilities: [], soldiers: base.soldiers.length, scientists: base.scientists | 0, engineers: base.engineers | 0, crafts: [] };
    for (const f of base.grid) if ((f.daysLeft | 0) === 0) spec.facilities.push(f.type);
    for (const id of base.crafts) {
      const c = C().findCraft(G, id);
      if (c) spec.crafts.push(c.type);
    }
    for (const dl of base.deliveries) {
      if (dl.kind === 'soldier') spec.soldiers += dl.n;
      else if (dl.kind === 'scientist') spec.scientists += dl.n;
      else if (dl.kind === 'engineer') spec.engineers += dl.n;
      else if (dl.kind === 'craft') for (let k = 0; k < dl.n; k++) spec.crafts.push(dl.itemId);
    }
    return D().monthlyUpkeep(spec);
  }
  function upkeep(G) {
    const out = { facilities: 0, salaries: 0, crafts: 0, total: 0 };
    for (const b of G.bases) {
      const u = baseUpkeep(G, b);
      out.facilities += u.facilities;
      out.salaries += u.salaries;
      out.crafts += u.crafts;
      out.total += u.total;
    }
    return out;
  }

  function income(G) {
    let s = 0;
    for (const c of G.countries) if (!c.pact) s += c.funding | 0;
    return s;
  }

  // bónus do Conselho (+400) a partir do relatório de fevereiro (mês terminado + 1 ≥ COUNCIL_BONUS_FROM_MONTH)
  function councilBonus(G, monthIdx) {
    const m = monthIdx === undefined ? G.month : monthIdx;
    return m + 1 >= tune('COUNCIL_BONUS_FROM_MONTH', 2) ? tune('COUNCIL_BONUS', 400) : 0;
  }

  // avaliação do mês corrente: X-COM + investigação + bónus − alienígenas
  function rating(G) {
    const m = G.score.month;
    return m.xcom.total + m.research + councilBonus(G) - m.alien.total;
  }
  const threshold = (G) => {
    const t = tune('RATING_THRESHOLD', [-900, -700, -500]);
    return t[U.clamp(G.difficulty | 0, 0, t.length - 1)];
  };
  function ratingKey(G, r) {
    return D().ratingKey(r === undefined ? rating(G) : r, G.difficulty);
  }
  // texto do Conselho (MonthlyReportState orig): > 500 muito satisfeito, > T satisfeito, senão insatisfeito
  function councilKey(G, r) {
    if (r > D().scoring.rating.excellentAbove) return 'council.pleased';
    if (r > threshold(G)) return 'council.satisfied';
    return 'council.dissatisfied';
  }

  /* Country::newMonth (orig): delta = floor(fundingK × RNG(5,20) / 100) × $1000 (sorteado sempre);
     sobe se bad ≤ good+30, good > bad+30 e RNG(0,good) > bad (até ao teto);
     desce se bad > good+30 e RNG(0,bad) > good (não abaixo de 0). */
  function fundingChange(fundingK, capK, good, bad, rng) {
    const step = U.idiv(fundingK * rng.int(5, 20), 100) * 1000;
    const funding = fundingK * 1000;
    let delta = 0;
    if (bad <= good + 30) {
      if (good > bad + 30 && rng.int(0, good) > bad) delta = Math.max(0, Math.min(step, capK * 1000 - funding));
    } else if (rng.int(0, bad) > good && step) {
      delta = -Math.min(step, funding);
    }
    if (delta < 0 && funding + delta < 0) delta = -funding;
    return { delta, mood: delta > 0 ? 'pleased' : delta < 0 ? 'unhappy' : 'same' };
  }

  // eventos já empurrados neste instante (o passo 17, Missions.monthEnd, corre antes deste)
  function eventsNow(G, type) {
    return (G.events || []).filter((e) => e.t === type && e.at === G.t);
  }

  const pushCapped = (arr, v) => {
    arr.push(v);
    while (arr.length > HISTORY_MAX) arr.shift();
  };

  /* Fim do mês (§3.1 passo 18). O financiamento de cada país muda com a pontuação do mês; os fundos recebem as
     receitas (financiamento do mês que acabou, sem pactos) menos a manutenção; contadores de derrota. */
  function monthEnd(G) {
    const Data = D();
    const month = G.month | 0;
    const m = G.score.month;
    const bonus = councilBonus(G, month);
    const xcomTotal = m.xcom.total + m.research + bonus;
    const alienTotal = m.alien.total;
    const r = xcomTotal - alienTotal;
    const T = threshold(G);

    // receitas e manutenção (SavedGame::monthlyFunding corre com o financiamento ainda por alterar)
    const inc = income(G);
    const up = upkeep(G);
    const fundsBefore = G.funds;
    G.funds = fundsBefore + inc - up.total;

    // pactos novos deste fim de mês
    const newPacts = {};
    for (const e of eventsNow(G, 'pactSigned')) newPacts[e.countryId] = true;

    const geo = C().rng(G, 'geo');
    const countries = [];
    for (const c of G.countries) {
      const def = Data.countries[c.id];
      const before = c.funding | 0;
      const good = U.idiv(xcomTotal, 10) + (m.xcom.countries[c.id] | 0);
      const bad = U.idiv(alienTotal, 20) + (m.alien.countries[c.id] | 0);
      const ch = fundingChange(U.idiv(before, 1000), def ? def.fundingCap : U.idiv(before, 1000), good, bad, geo);
      let after = before + ch.delta;
      let mood = ch.mood;
      if (c.pact) {
        after = 0;
        mood = 'same';
      }
      c.funding = after;
      c.lastDelta = after - before;
      c.mood = c.pact ? (newPacts[c.id] ? 'unhappy' : 'same') : mood;
      pushCapped(c.history, after);
      countries.push({ id: c.id, before, after, delta: after - before, mood: c.mood, pact: !!c.pact, newPact: !!newPacts[c.id] });
    }

    // contadores do Conselho e da dívida
    const council = G.council;
    council.badMonths = r <= T ? (council.badMonths | 0) + 1 : 0;
    council.debtMonths = G.funds <= tune('DEBT_LIMIT', -1000000) ? (council.debtMonths | 0) + 1 : 0;
    council.lastRating = r;

    const revealed = eventsNow(G, 'alienBaseFound').filter((e) => e.how === 'agents');
    const date = OV.Clock.date(OV.Clock.monthStartT(month));
    const report = {
      month, y: date.y, m: date.m, rating: r, ratingKey: Data.ratingKey(r, G.difficulty), councilKey: councilKey(G, r),
      xcom: m.xcom.total, alien: alienTotal, research: m.research, councilBonus: bonus,
      income: inc, upkeep: up, fundsBefore, fundsAfter: G.funds, countries,
      debtWarning: council.debtMonths === 1, badMonths: council.badMonths, debtMonths: council.debtMonths,
      alienBaseRevealed: revealed.length ? revealed[0].alienBaseId : null, defeat: null,
    };
    report.defeat = checkDefeat(G);

    pushCapped(G.history, { month, funds: G.funds, income: inc, upkeep: up.total, xcom: m.xcom.total, alien: alienTotal, research: m.research, rating: r });
    pushCapped(G.reports, report);
    G.score.all.xcom += m.xcom.total;
    G.score.all.alien += alienTotal;
    G.score.all.research += m.research;
    G.score.month = C().newScoreMonth();
    return report;
  }

  // derrota: Conselho (2 meses seguidos ≤ T), dívida (2 fins de mês seguidos ≤ DEBT_LIMIT), sem bases
  function checkDefeat(G) {
    if ((G.council.badMonths | 0) >= 2) return 'council';
    if ((G.council.debtMonths | 0) >= 2) return 'debt';
    if (!G.bases.length) return 'baseLost';
    return null;
  }

  OV.Economy = {
    addScore, ufoActivity30m, daily, upkeep, baseUpkeep, income, councilBonus, rating, ratingKey, councilKey,
    fundingChange, monthEnd, checkDefeat,
  };
})(globalThis.OV || (globalThis.OV = {}));
