/* Soldados da campanha (DESIGN.md §3.2; contrato docs/CAMPAIGN_API.md §1.9, §5.8).
   OV.Soldiers = {
     generate(G, {baseId, rng?}) → soldado novo (id atribuído, NÃO inserido; mesma ordem de sorteio que Campaign.makeSoldier)
     applyMission(G, soldierId, {exp, hpLost, kills}, rng) → {gains, promotedTo:int|null, woundDays}
     promotions(G) → [{id, from, to}]      quotas TUNE.PROMO_* sobre todos os soldados vivos (maior pontuação primeiro)
     daily(G)                              recuperação: woundDays −1 → evento soldierRecovered
     kill(G, soldierId, cause, where?) → entrada do memorial (cause 'kia'|'mia'|'craft'|'base')
     rename(G, soldierId, name) → {ok, reason?}
     value(soldier) → 20 + missões + bónus de patente ; promotionScore(soldier) → int
     quotas(n) → {sergeant, captain, colonel, commander} ; woundDaysFor(hpLost, pct) → dias }
   Regra R1: sem DOM; aleatoriedade só pelas streams de G (geo no recrutamento, combat no pós-missão). */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const RANK = { rookie: 0, squaddie: 1, sergeant: 2, captain: 3, colonel: 4, commander: 5 };
  const NAME_MAX = 24;

  // recruta novo: nacionalidade (1), sexo (1), nome (2, +2 por cada repetição de um nome vivo), atributos (11), semente do retrato (1) — contrato §1.9
  function generate(G, opts) {
    const o = opts || {};
    const Data = D();
    const r = o.rng || C().rng(G, 'geo');
    const gen = Data.soldierGen;
    const nat = Data.pickNationality(r);
    const female = r.pct(gen.femalePct);
    const name = Data.soldierName(r, nat, female, Data.soldierNamesTaken(G.soldiers));
    const stats = Data.rollSoldierStats(r);
    const portraitSeed = r.int(0, 0x7fffffff);
    return {
      id: C().nextId(G, 's'), name, nat, female, rank: 0, stats, initial: U.clone(stats),
      missions: 0, kills: 0, woundDays: 0, armour: gen.armour, baseId: o.baseId === undefined ? null : o.baseId, craftId: null,
      loadout: C().emptyLoadout(), portraitSeed, hiredT: G.t | 0, psi: { training: false },
    };
  }

  // tira o soldado da nave (o modelo de equipamento fica a bordo como carga solta)
  function leaveCraft(G, s) {
    if (!s.craftId) return;
    const craft = C().findCraft(G, s.craftId);
    if (craft) C().removeById(craft.soldiers, s.id);
    s.craftId = null;
  }

  // dias de baixa (ours): ceil(HP perdido × pct / 100), pct = RNG(WOUND_RECOVERY_MIN, MAX)
  const woundDaysFor = (hpLost, pct) => (hpLost > 0 ? U.idiv(hpLost * pct + 99, 100) : 0);

  /* Pós-missão: subida de atributos (OV.Morale.postMission, stream combat), Recruta → Soldado se houve experiência
     secundária, missões +1, abates, baixa médica. Ordem de sorteio: postMission, depois a percentagem da baixa. */
  function applyMission(G, soldierId, res, rng) {
    const s = C().findSoldier(G, soldierId);
    if (!s) return { gains: {}, promotedTo: null, woundDays: 0 };
    const r = rng || C().rng(G, 'combat');
    const o = res || {};
    const pm = OV.Morale.postMission(s.stats, o.exp || {}, r);
    s.stats = pm.stats;
    let promotedTo = null;
    if (s.rank === RANK.rookie && pm.secondary) {
      s.rank = RANK.squaddie;
      promotedTo = RANK.squaddie;
    }
    s.missions = (s.missions | 0) + 1;
    s.kills = (s.kills | 0) + Math.max(0, o.kills | 0);
    const hpLost = Math.max(0, o.hpLost | 0);
    let days = 0;
    if (hpLost > 0) {
      days = woundDaysFor(hpLost, r.int(tune('WOUND_RECOVERY_MIN', 25), tune('WOUND_RECOVERY_MAX', 75)));
      s.woundDays = Math.max(s.woundDays | 0, days);
    }
    if (s.woundDays > 0) leaveCraft(G, s);
    return { gains: pm.gains, promotedTo, woundDays: days };
  }

  // pontuação de promoção (SavedGame::getSoldierScore, orig; psi só conta com Psi Skill > 0)
  function promotionScore(s) {
    const st = s.stats || {};
    let v = 2 * (st.hp | 0) + 2 * (st.sta | 0) + 4 * (st.react | 0) + 4 * (st.brav | 0);
    v += 3 * ((st.tu | 0) + 2 * (st.fire | 0));
    v += (st.melee | 0) + (st.thr | 0) + (st.str | 0);
    if ((st.psiSkill | 0) > 0) v += (st.psiStr | 0) + 2 * (st.psiSkill | 0);
    return v + 10 * ((s.missions | 0) + (s.kills | 0));
  }

  // valor do soldado para a pontuação (§3.2): 20 + missões + bónus de patente
  function value(s) {
    const r = D().soldierRank(s.rank | 0);
    return 20 + (s.missions | 0) + ((r && r.scoreBonus) | 0);
  }

  // quotas de patente (ours, plantel pequeno): sargentos N/4, capitães N/8, coronéis N/15, comandante se N ≥ 20
  function quotas(n) {
    return {
      sergeant: U.idiv(n, tune('PROMO_SGT_DIV', 4)),
      captain: U.idiv(n, tune('PROMO_CPT_DIV', 8)),
      colonel: U.idiv(n, tune('PROMO_COL_DIV', 15)),
      commander: n >= tune('PROMO_CMD_MIN', 20) ? 1 : 0,
    };
  }

  /* Promoções (SavedGame::handlePromotions, orig): de cima para baixo — comandante (de coronel), coronéis (de
     capitão), capitães (de sargento), sargentos (de soldado). Em cada vaga sobe o de maior pontuação na patente
     abaixo; empate ⇒ o primeiro por ordem de G.soldiers. */
  function promotions(G) {
    const list = [];
    for (const id in G.soldiers) list.push(G.soldiers[id]);
    const n = list.length;
    const q = quotas(n);
    const count = [0, 0, 0, 0, 0, 0];
    for (const s of list) count[U.clamp(s.rank | 0, 0, 5)]++;
    const out = [];
    const promoteBest = (fromRank) => {
      let best = null, bestScore = -1;
      for (const s of list) {
        if ((s.rank | 0) !== fromRank) continue;
        const sc = promotionScore(s);
        if (sc > bestScore) {
          best = s;
          bestScore = sc;
        }
      }
      if (!best) return false;
      best.rank = fromRank + 1;
      count[fromRank]--;
      count[fromRank + 1]++;
      out.push({ id: best.id, from: fromRank, to: fromRank + 1 });
      return true;
    };
    if (count[RANK.commander] < q.commander) promoteBest(RANK.colonel);
    while (count[RANK.colonel] < q.colonel && promoteBest(RANK.captain));
    while (count[RANK.captain] < q.captain && promoteBest(RANK.sergeant));
    while (count[RANK.sergeant] < q.sergeant && promoteBest(RANK.squaddie));
    return out;
  }

  // recuperação diária (§3.1 passo 13)
  function daily(G) {
    for (const id in G.soldiers) {
      const s = G.soldiers[id];
      if ((s.woundDays | 0) <= 0) continue;
      s.woundDays--;
      if (s.woundDays === 0) C().event(G, 'soldierRecovered', { soldierId: s.id, baseId: s.baseId });
    }
  }

  // morte: sai de G.soldiers, da base e da nave; a armadura perde-se; entra no memorial
  function kill(G, soldierId, cause, where) {
    const s = C().findSoldier(G, soldierId);
    if (!s) return null;
    leaveCraft(G, s);
    const b = C().findBase(G, s.baseId);
    if (b) C().removeById(b.soldiers, s.id);
    delete G.soldiers[s.id];
    const w = where && Number.isFinite(where.lon) && Number.isFinite(where.lat)
      ? { kind: where.kind || null, lon: where.lon, lat: where.lat } : null;
    const entry = {
      id: s.id, name: s.name, nat: s.nat, female: !!s.female, rank: s.rank | 0, portraitSeed: s.portraitSeed,
      missions: s.missions | 0, kills: s.kills | 0, armour: s.armour, diedT: G.t | 0, cause: cause || 'kia', where: w,
    };
    G.dead.push(entry);
    G.stats.soldiersLost = (G.stats.soldiersLost | 0) + 1;
    return entry;
  }

  function rename(G, soldierId, name) {
    const s = C().findSoldier(G, soldierId);
    if (!s) return { ok: false, reason: 'noSoldier' };
    const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
    if (!n) return { ok: false, reason: 'name' };
    s.name = n;
    return { ok: true };
  }

  OV.Soldiers = {
    generate, applyMission, promotions, daily, kill, rename, value, promotionScore, quotas, woundDaysFor, RANK,
  };
})(globalThis.OV || (globalThis.OV = {}));
