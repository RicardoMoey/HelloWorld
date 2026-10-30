/* Moral, pânico, berserk, psiónica e experiência (DESIGN.md §3.10, §3.2; REA 03 §6, §1.2–1.5; semântica de
   BattleUnit::moraleChange / checkForCasualties / prepareNewTurn / handlePanickingUnit / psiAttack /
   postMissionProcedures do OpenXcom). Só inteiros; aleatoriedade só pelas streams de B.rng (combat por omissão).

   Fórmulas (B = (110 − Bravura)/10 inteiro, ≥ 0; moral limitada a 0..100; unidades 2×2 imunes):
     dano p:            −100·(p·B/10)/teamMod          teamMod = leaderMod se a unidade está do lado X-COM, senão 100
     feridas fatais n:  −n
     morte de um amigo: −peso(vítima)·200·B/loserMod/100 (todos os do lado original da vítima, conscientes)
     morte de inimigo:  +10·winnerMod/100 (todos os restantes conscientes)
     assassino:         +20·mod/100 (inimigo) ; −2000/mod (amigo) ; civil: X-COM −1000/mod, outros +10
     pânico/berserk:    chance = 100 − 2·moral; 33 % berserk, senão 50 % paralisa / 50 % larga as armas e foge;
                        depois UT = 0, moral +15; passar com chance > 1 ⇒ exp. de bravura +1
     dificuldade (ours): as perdas do dano e das mortes no lado X-COM × TUNE.MORALE_LOSS_PCT[dif] / 100 (Recruta 50 %);
                        TUNE.PANIC_COOLDOWN_TURNS[dif] turnos sem novo pânico para o soldado X-COM que acabou de ter um
                        episódio (u.panicTurn = B.turn); cada episódio X-COM soma 1 a B.stats.xcomPanics (relatório)
     psi:               ataque = PsiStr·PsiSkill/50 − dist + RNG(0,55) ; defesa = PsiStr + 10 + PsiSkill/5 (+20 MC)

   API (OV.Morale):
     leaderMod(B, side, exclude?) → 100|110|115|125|150 (patente mais alta X-COM consciente; exclude = unidade|id
       ignorada, p. ex. a vítima) ; outros lados → 100
     teamMod(B, u, exclude?) ; rankWeight(u) → 100..175 ; bravFactor(u) → B ; panicChance(morale) → 0..100
     moraleChange(B, u, delta) → variação aplicada (0 se imune) ; lossPct(B, u) → % das perdas (100 fora do lado X-COM)
     onHit(B, u, damage) → events ; onWounds(B, u, n) → events ; painkiller(B, u) → events
     onDeath(B, victim, killerId) → events (também killer.turnsSinceSpotted = 0 quando a vítima é alienígena)
       events de variação: {t:'morale', kind:'change', unitId, delta, morale} (informativos: sem pos/vis)
     panicPhase(B, side, rng?) → Generator (devolve {panicked:[ids], berserk:[ids]}); faz yield de
       {t:'morale', unitId, kind:'panic', mode:'freeze'|'flee', side, morale, vis, pos}
       {t:'morale', unitId, kind:'freeze'|'flee'(+to: tile|−1)|'berserk'(+shots, targetI, targetId, hand, mode), …}
       {t:'drop', unitId, itemId, i, vis, pos} ; na fuga, os eventos do passeio (OV.Act.perform 'walk' ou step/kneel)
       Berserk (rajada se houver, senão tiro rápido): B.pendingBerserk.push({unitId, targetI, targetId, hand, mode, shots:[ação]}) com ação =
       {type:'shoot', unitId, hand, mode, targetI, targetId, force:true, berserk:true, free:true} (UT já contadas:
       n = min(10, UT/custo) e munição; precisão ÷ BERSERK_ACC_DIV). Estado no fim de cada episódio:
       status 'panic' (até ao próximo panicPhase do mesmo lado), tu 0, moral +15.
     runBerserk(B) → Generator: esvazia B.pendingBerserk executando cada ação por OV.Act.perform (se existir); para
       assim que a batalha acaba (como o panicPhase)
     psiAttack(B, attacker, target, kind 'panic'|'control', rng?) → {success, events:[{t:'psi', attackerId, targetId,
       kind, success, vis, pos}, …variações de moral], sight} ; exp. psi do atacante +1 (+2 se resultar)
       Controlo: target.side = lado do atacante, target.control = {by, revertOn, turn, attackerId}, UT cheias; a visão
       é refeita logo (OV.LOS.refreshAll) e sight é o resultado ({spotted, discovered}; null sem controlo).
     revertControl(B, side) → events [{t:'psi', kind:'revert', targetId, from, side, vis, pos}] (refaz a visão) — chamar no início do
       turno de `side`, antes do panicPhase: devolve ao lado original as unidades com control.revertOn === side
       (= o lado controlador: o controlo dura até ao início do próximo turno de quem controla, como no OpenXcom).
     psiAttackStrength(u) ; psiDefense(u, kind) ; tileDist(a, b) ; psiChance(B, attacker, target, kind) → % exato
     controlOdds(B, target) → % de a IA preferir Controlo Mental a Pânico (REA §6.4)
     gainExp(u, kind 'fire'|'react'|'thr'|'melee'|'brav'|'psi'|'psiStr', n=1) → contador
     improveStat(exp, rng) → ganho ; postMission(stats, exp, rng) → {stats, gains, secondary}
       secondary = houve exp. de Bravura/Reações/Pontaria/Psi/Corpo a corpo (⇒ Recruta passa a Soldado). */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);

  const LIVE = { ok: 1, panic: 1 };
  const DEF_LEADER = [100, 100, 110, 115, 125, 150];
  const DEF_WEIGHT = [100, 100, 120, 130, 150, 175];
  const EXP_KINDS = ['fire', 'react', 'thr', 'melee', 'brav', 'psi', 'psiStr'];
  // modo do berserk: rajada se a arma a tiver, senão tiro rápido (UnitPanicBState «make autoshots if possible»)
  const BERSERK_MODES = ['auto', 'snap'];

  const conscious = (u) => !!u && LIVE[u.status] === 1;
  const active = (u) => conscious(u) && u.onMap !== false && u.x >= 0;
  const fearable = (u) => !!u && (u.size | 0 || 1) === 1;
  const isSoldier = (u) => !!u && u.type === 'soldier' && typeof u.rank === 'number';
  const hostile = (a, b) => (a === 'alien') !== (b === 'alien');
  const moraleOf = (u) => (u.morale === undefined || u.morale === null ? 100 : u.morale | 0);
  const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
  // a batalha já acabou? (OV.Act.perform fixa phase 'over' ao emitir battleEnd; nada corre depois dele)
  const over = (B) => B.phase === 'over' || !!B.aborted;
  // visão refeita quando uma unidade muda de lado (as uniões de B._.visible não podem guardar o observador antigo)
  function refreshSides(B) {
    if (OV.LOS && typeof OV.LOS.refreshAll === 'function' && B._) return OV.LOS.refreshAll(B);
    if (B._ && B._.dirty) B._.dirty.los = true;
    return null;
  }

  function tile(B, u) {
    if (!u || !(u.x >= 0) || !B.map) return -1;
    return (u.z * B.map.h + u.y) * B.map.w + u.x;
  }
  // visível para o jogador? (unidades X-COM sempre; restantes pelo LOS se existir)
  function visOf(B, u) {
    if (!u) return false;
    if (u.side === 'xcom' || u.origSide === 'xcom') return true;
    return !!(OV.LOS && typeof OV.LOS.isVisibleTo === 'function' && OV.LOS.isVisibleTo(B, 'xcom', u));
  }
  const rngOf = (B, rng) => rng || (B.rng && B.rng.combat) || null;

  // ---- modificadores ---------------------------------------------------------------------------------------
  function rankTable(key, def, idx) {
    const t = tune(key, def);
    return t[U.clamp(idx | 0, 0, t.length - 1)] | 0;
  }

  // liderança: patente mais alta entre os soldados X-COM (lado original) conscientes; aliens/civis 100
  function leaderMod(B, side, exclude) {
    if (side !== 'xcom') return 100;
    const ex = idOf(exclude);
    let best = -1;
    for (const u of B.units) {
      if (u.origSide !== 'xcom' || !isSoldier(u) || !conscious(u) || u.id === ex) continue;
      if (u.rank > best) best = u.rank;
    }
    return best < 0 ? 100 : rankTable('LEADER_MOD', DEF_LEADER, best);
  }
  const teamMod = (B, u, exclude) => (u.side === 'xcom' ? leaderMod(B, 'xcom', exclude) : 100);
  // peso da patente da vítima (só soldados do lado X-COM; restantes 100)
  const rankWeight = (u) => (u.side === 'xcom' && isSoldier(u) ? rankTable('RANK_WEIGHT', DEF_WEIGHT, u.rank) : 100);
  const bravFactor = (u) => Math.max(0, U.idiv(110 - ((u && u.stats ? u.stats.brav : 0) | 0), 10));
  const panicChance = (morale) => U.clamp(100 - 2 * (morale | 0), 0, 100);
  const diffOf = (B) => U.clamp(((B && B.mission && B.mission.difficulty) | 0), 0, 2);
  const byDiff = (B, key, def) => {
    const t = tune(key, def);
    return (Array.isArray(t) ? t[Math.min(diffOf(B), t.length - 1)] : t) | 0;
  };
  // ours (persona r4): perdas de moral do lado X-COM escaladas pela dificuldade (Recruta 50 %)
  const lossPct = (B, u) => (u && u.origSide === 'xcom' ? byDiff(B, 'MORALE_LOSS_PCT', [50, 100, 100]) : 100);
  const lossOf = (B, u, loss) => U.idiv(Math.max(0, loss | 0) * lossPct(B, u), 100);

  // ---- variações de moral ----------------------------------------------------------------------------------
  function moraleChange(B, u, delta) {
    if (!fearable(u) || !delta) return 0;
    const before = moraleOf(u);
    u.morale = U.clamp(before + (delta | 0), 0, 100);
    return u.morale - before;
  }
  function change(B, u, delta, out) {
    const d = moraleChange(B, u, delta);
    if (d) out.push({ t: 'morale', kind: 'change', unitId: u.id, delta: d, morale: u.morale });
    return d;
  }

  function onHit(B, u, damage) {
    const out = [];
    const p = Math.max(0, damage | 0);
    if (!u || !p) return out;
    change(B, u, -lossOf(B, u, U.idiv(100 * U.idiv(p * bravFactor(u), 10), teamMod(B, u))), out);
    return out;
  }

  function onWounds(B, u, n) {
    const out = [];
    if (u && (n | 0) > 0) change(B, u, -(n | 0), out);
    return out;
  }

  // analgésico: moral += HP perdidos ainda não compensados (OpenXcom painKillers, até 100)
  function painkiller(B, u) {
    const out = [];
    if (!u || !u.stats) return out;
    const lost = (u.stats.hp | 0) - (u.hp | 0);
    const done = u.moraleRestored | 0;
    if (lost > done) {
      const before = moraleOf(u);
      u.morale = Math.min(100, lost - done + before);
      u.moraleRestored = lost;
      if (u.morale !== before) out.push({ t: 'morale', kind: 'change', unitId: u.id, delta: u.morale - before, morale: u.morale });
    }
    return out;
  }

  /* Morte (checkForCasualties): a vítima não conta como líder (morte de um comandante: −28 com Bravura 30).
     Lados: atuais (side) para modificadores e civis; originais (origSide) para "amigo"/"equipa". */
  function onDeath(B, victim, killerId) {
    const out = [];
    if (!victim) return out;
    const killer = killerId === null || killerId === undefined ? null : BU().findUnit(B, killerId);
    if (killer) {
      const mod = killer.side === 'xcom' ? leaderMod(B, 'xcom', victim) : 100;
      if ((victim.origSide === 'xcom' && killer.side === 'alien') || (victim.origSide === 'alien' && killer.side === 'xcom')) {
        change(B, killer, U.idiv(20 * mod, 100), out);
      }
      if (victim.origSide === killer.origSide) change(B, killer, -lossOf(B, killer, U.idiv(2000, mod)), out);
      if (victim.origSide === 'civ') change(B, killer, killer.origSide === 'xcom' ? -lossOf(B, killer, U.idiv(1000, mod)) : 10, out);
    }
    if (victim.side !== 'civ') {
      const w = rankWeight(victim);
      const xmod = leaderMod(B, 'xcom', victim);
      const loserMod = victim.side === 'alien' ? 100 : xmod;
      const winnerMod = victim.side === 'alien' ? xmod : 100;
      for (const u of B.units) {
        if (u === victim || !conscious(u) || !fearable(u)) continue;
        if (u.origSide === victim.origSide) change(B, u, -lossOf(B, u, U.idiv(U.idiv(w * 200 * bravFactor(u), loserMod), 100)), out);
        else change(B, u, U.idiv(10 * winnerMod, 100), out);
      }
      // quem matou um alienígena fica conhecido dos alienígenas
      if (victim.side === 'alien' && killer) killer.turnsSinceSpotted = 0;
    }
    return out;
  }

  // ---- experiência ----------------------------------------------------------------------------------------
  function gainExp(u, kind, n) {
    if (!u || EXP_KINDS.indexOf(kind) < 0) return 0;
    if (!u.exp) u.exp = { fire: 0, react: 0, thr: 0, melee: 0, brav: 0, psi: 0 };
    u.exp[kind] = (u.exp[kind] | 0) + (n === undefined ? 1 : n | 0);
    return u.exp[kind];
  }

  // improveStat (orig): 0 → 0 (sem RNG) ; 1–2 → 0..1 ; 3–5 → 1..3 ; 6–10 → 1..4 ; >10 → 2..6
  function improveStat(exp, rng) {
    const e = exp | 0;
    if (e <= 0) return 0;
    const g = D().soldierGen;
    const table = g && g.improve ? g.improve : [{ upTo: 2, min: 0, max: 1 }, { upTo: 5, min: 1, max: 3 }, { upTo: 10, min: 1, max: 4 }, { upTo: 1e9, min: 2, max: 6 }];
    for (const b of table) if (e <= b.upTo) return b.max > 0 ? rng.int(b.min, b.max) : 0;
    return 0;
  }

  /* Subida pós-missão (postMissionProcedures). Ordem de consumo do RNG fixa: Bravura, Reações, Pontaria, Corpo a
     corpo, Lançamento, Psi Skill, Psi Str; depois UT, Saúde, Força, Energia. Só sobe abaixo do limite e não volta a
     limitar (pode passar o limite em até 2 na subida secundária, como no original). */
  function postMission(soldierStats, exp, rng) {
    const caps = D().soldierGen.caps;
    const s = Object.assign({}, soldierStats);
    const e = exp || {};
    const gains = {};
    const add = (k, v) => {
      if (!v) return;
      s[k] = (s[k] | 0) + v;
      gains[k] = (gains[k] | 0) + v;
    };
    const below = (k) => (s[k] | 0) < caps[k];
    if ((e.brav | 0) > 0 && below('brav') && (e.brav | 0) > rng.int(0, 10)) add('brav', 10);
    for (const [ek, sk] of [['react', 'react'], ['fire', 'fire'], ['melee', 'melee'], ['thr', 'thr'], ['psi', 'psiSkill'], ['psiStr', 'psiStr']]) {
      if ((e[ek] | 0) > 0 && below(sk)) add(sk, improveStat(e[ek], rng));
    }
    // o Lançamento não conta para a subida secundária (peculiaridade do OpenXcom)
    const secondary = ['brav', 'react', 'fire', 'psi', 'psiStr', 'melee'].some((k) => (e[k] | 0) > 0);
    if (secondary) {
      for (const [k, div] of [['tu', 10], ['hp', 10], ['str', 10], ['sta', 15]]) {
        const v = caps[k] - (s[k] | 0);
        if (v > 0) add(k, rng.int(0, U.idiv(v, div) + 2));
      }
    }
    return { stats: s, gains, secondary };
  }

  // ---- pânico e berserk -----------------------------------------------------------------------------------
  function episodeEvent(B, u, kind, extra) {
    return Object.assign({ t: 'morale', unitId: u.id, kind, side: u.side, morale: moraleOf(u), vis: visOf(B, u), pos: tile(B, u) }, extra);
  }
  // fim de episódio: UT 0, +15 de moral, estado 'panic' até ao próximo turno do lado
  function endEpisode(B, u) {
    if (u.origSide === 'xcom') {
      u.panicTurn = B.turn | 0;
      if (B.stats) B.stats.xcomPanics = (B.stats.xcomPanics | 0) + 1;
    }
    if (!conscious(u)) return;
    u.status = 'panic';
    u.tu = 0;
    moraleChange(B, u, tune('MORALE_AFTER_PANIC', 15));
  }

  // arma principal para o berserk: arma de fogo carregada (ou sem carregador) na mão; com duas, a mais rápida
  function berserkWeapon(B, u) {
    const items = D().items;
    const prefs = tune('BERSERK_MODES', BERSERK_MODES);
    const cands = [];
    for (const hand of ['R', 'L']) {
      const it = BU().item(B, u, hand);
      const def = it ? items[it.type] : null;
      if (!def || def.kind !== 'firearm') continue;
      const needsAmmo = Array.isArray(def.ammo) && def.ammo.length > 0;
      if (needsAmmo && !(it.ammo && it.ammo.rounds > 0)) continue;
      const modes = D().weaponModes(it.type);
      let m = null;
      for (const p of prefs) {
        m = modes.find((x) => x.mode === p) || null;
        if (m) break;
      }
      if (!m) continue;
      const cost = BU().actionTU(B, u, it.id, m.mode);
      if (cost === null || cost === undefined) continue;
      cands.push({ item: it, hand, mode: m.mode, cost, per: Math.max(1, m.shots | 0), rounds: needsAmmo ? it.ammo.rounds : null });
    }
    if (cands.length === 2 && cands[1].cost < cands[0].cost) return cands[1];
    return cands[0] || null;
  }

  // vê o alvo? (sem cone: o berserker roda sobre si próprio)
  function sees(B, u, t) {
    if (OV.LOS && typeof OV.LOS.canSee === 'function') return OV.LOS.canSee(B, u, t);
    const s = B._ && B._.sees ? B._.sees[u.id] : null;
    return !!(s && typeof s.has === 'function' && s.has(t.id));
  }

  function nearestVisibleEnemy(B, u) {
    let best = null, bd = Infinity;
    for (const t of B.units) {
      if (t === u || !active(t) || !hostile(u.side, t.side) || !sees(B, u, t)) continue;
      const dx = t.x - u.x, dy = t.y - u.y, dz = t.z - u.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd || (d === bd && t.id < best.id)) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  function* berserk(B, u, rng) {
    const m = B.map;
    const target = nearestVisibleEnemy(B, u);
    let targetI, targetId = null;
    if (target) {
      targetI = tile(B, target);
      targetId = target.id;
    } else {
      const R = tune('BERSERK_RANDOM_RADIUS', 6);
      const tx = U.clamp(u.x + rng.int(-R, R), 0, m.w - 1);
      const ty = U.clamp(u.y + rng.int(-R, R), 0, m.h - 1);
      targetI = (u.z * m.h + ty) * m.w + tx;
    }
    const w = berserkWeapon(B, u);
    const shots = [];
    if (w) {
      const max = tune('BERSERK_MAX_SHOTS', 10);
      let n = w.cost > 0 ? Math.min(max, U.idiv(Math.max(0, u.tu | 0), w.cost)) : max;
      if (w.rounds !== null) n = Math.min(n, U.idiv(w.rounds + w.per - 1, w.per));
      for (let k = 0; k < n; k++) {
        shots.push({ type: 'shoot', unitId: u.id, hand: w.hand, mode: w.mode, targetI, targetId, force: true, berserk: true, free: true });
      }
    }
    if (!Array.isArray(B.pendingBerserk)) B.pendingBerserk = [];
    if (shots.length) B.pendingBerserk.push({ unitId: u.id, targetI, targetId, hand: w.hand, mode: w.mode, shots });
    endEpisode(B, u);
    yield episodeEvent(B, u, 'berserk', { shots: shots.length, targetI, targetId, hand: w ? w.hand : null, mode: w ? w.mode : null });
  }

  /* Destino da fuga: tile ao acaso a ±5 (desce até haver chão, como Pathfinding::calculate). Se não for alcançável
     com as UT atuais, anda pelo caminho sem limite até onde as UT chegarem. −1 sem OV.Path ou sem caminho. */
  function fleeTarget(B, u, dx, dy) {
    const P = OV.Path;
    if (!P || typeof P.reachable !== 'function') return -1;
    const m = B.map;
    const tx = U.clamp(u.x + dx, 0, m.w - 1), ty = U.clamp(u.y + dy, 0, m.h - 1);
    const goal = BM().dropTarget(m, (u.z * m.h + ty) * m.w + tx);
    const from = tile(B, u);
    if (goal < 0 || goal === from) return -1;
    const reach = P.reachable(B, u);
    if (!reach || !reach.cost) return -1;
    if (reach.cost[goal] >= 0) return goal;
    if (typeof P.find === 'function') {
      const path = P.find(B, u, goal);
      if (path && path.tiles) {
        for (let k = path.tiles.length - 1; k >= 0; k--) if (reach.cost[path.tiles[k]] >= 0 && path.tiles[k] !== from) return path.tiles[k];
      }
    }
    return -1;
  }

  // passeio da fuga: pela ação 'walk' (portas, LOS, reações) se existir; senão passo a passo sem portas
  function* fleeWalk(B, u, dest) {
    if (OV.Act && typeof OV.Act.perform === 'function') {
      yield* OV.Act.perform(B, { type: 'walk', unitId: u.id, to: dest, panic: true, desperate: true });
      return;
    }
    const P = OV.Path;
    if (!P || typeof P.pathTo !== 'function' || typeof P.stepCost !== 'function') return;
    const route = P.pathTo(P.reachable(B, u), dest);
    if (!route) return;
    if (u.kneel) {
      const c = tune('TU_STAND', 8);
      if ((u.tu | 0) < c) return;
      u.tu -= c;
      u.kneel = false;
      yield { t: 'kneel', unitId: u.id, down: false, vis: visOf(B, u), pos: tile(B, u) };
    }
    let cur = tile(B, u);
    for (const dir of route.steps) {
      if (!active(u)) return;
      const s = P.stepCost(B, u, cur, dir);
      if (!s || s.occupant !== null || s.door || s.opensUfoDoor !== null || s.tu > (u.tu | 0) || s.energy > (u.energy | 0)) return;
      u.tu -= s.tu;
      u.energy -= s.energy;
      if (dir < 8) u.dir = dir;
      u.float = !!s.float;
      BU().placeUnit(B, u, s.to);
      u.motion = (u.motion | 0) + tune('MOTION_PER_STEP', 30);
      if (OV.LOS && typeof OV.LOS.unitMoved === 'function') OV.LOS.unitMoved(B, u);
      yield { t: 'step', unitId: u.id, from: cur, to: s.to, dir, vis: visOf(B, u), pos: s.to };
      cur = s.to;
    }
  }

  function* panic(B, u, rng) {
    const flee = rng.int(0, 99) < 50;
    yield episodeEvent(B, u, 'panic', { mode: flee ? 'flee' : 'freeze' });
    if (!flee) {
      endEpisode(B, u);
      yield episodeEvent(B, u, 'freeze');
      return;
    }
    for (const hand of ['R', 'L']) {
      const it = BU().dropItem(B, u, hand);
      if (it) yield { t: 'drop', unitId: u.id, itemId: it.id, i: it.at, vis: visOf(B, u), pos: it.at };
    }
    const R = tune('PANIC_FLEE_RADIUS', 5);
    const dx = rng.int(-R, R), dy = rng.int(-R, R);
    const dest = fleeTarget(B, u, dx, dy);
    yield episodeEvent(B, u, 'flee', { to: dest });
    if (dest >= 0) yield* fleeWalk(B, u, dest);
    endEpisode(B, u);
  }

  // soldado X-COM com um episódio há ≤ PANIC_COOLDOWN_TURNS turnos (Recruta: 1) não volta a rolar (não consome RNG)
  function coolingDown(B, u) {
    if (u.origSide !== 'xcom' || u.panicTurn === undefined || u.panicTurn === null) return false;
    const cd = byDiff(B, 'PANIC_COOLDOWN_TURNS', [1, 0, 0]);
    return cd > 0 && (B.turn | 0) - (u.panicTurn | 0) <= cd;
  }

  /* Fase de pânico no início do turno de `side` (depois da recuperação de UT). Repõe 'panic' → 'ok' das unidades do
     lado, depois rola por unidade consciente no mapa (ordem de B.units). Só consome RNG quando chance > 0. */
  function* panicPhase(B, side, rng) {
    const r = rngOf(B, rng);
    const res = { panicked: [], berserk: [] };
    for (const u of B.units) if (u.side === side && u.status === 'panic') u.status = 'ok';
    if (!r) return res;
    const list = B.units.filter((u) => u.side === side && active(u) && fearable(u));
    for (const u of list) {
      if (over(B)) break;
      if (u.side !== side || !active(u)) continue;
      const chance = panicChance(moraleOf(u));
      if (chance <= 0 || coolingDown(B, u)) continue;
      if (r.int(1, 100) > chance) {
        if (chance > 1) gainExp(u, 'brav');
        continue;
      }
      if (r.int(0, 99) < tune('BERSERK_PCT', 33)) {
        res.berserk.push(u.id);
        yield* berserk(B, u, r);
      } else {
        res.panicked.push(u.id);
        yield* panic(B, u, r);
      }
    }
    return res;
  }

  // executa (e esvazia) a fila de tiros do berserk pela ação 'shoot'; sem OV.Act a fila é descartada
  function* runBerserk(B) {
    const q = Array.isArray(B.pendingBerserk) ? B.pendingBerserk : [];
    B.pendingBerserk = [];
    if (!OV.Act || typeof OV.Act.perform !== 'function') return;
    for (const entry of q) {
      for (const shot of entry.shots) {
        if (over(B)) return;
        const u = BU().findUnit(B, entry.unitId);
        if (!active(u)) break;
        yield* OV.Act.perform(B, shot);
      }
    }
  }

  // ---- psiónica -------------------------------------------------------------------------------------------
  const PSI_KINDS = { panic: 'panic', control: 'control', mc: 'control', mindControl: 'control' };
  const psiAttackStrength = (u) => U.idiv((u.stats.psiStr | 0) * (u.stats.psiSkill | 0), 50);
  const psiDefense = (u, kind) => (u.stats.psiStr | 0) + 10 + U.idiv(u.stats.psiSkill | 0, 5) + (PSI_KINDS[kind] === 'control' ? 20 : 0);
  // distância em tiles (euclidiana 3-D, arredondada)
  function tileDist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    const n = dx * dx + dy * dy + dz * dz;
    const r = U.isqrt(n);
    return n - r * r > r ? r + 1 : r;
  }
  // probabilidade exata (%) de sucesso: ataque − dist + RNG(0,55) > defesa
  function psiChance(B, attacker, target, kind) {
    const base = psiAttackStrength(attacker) - tileDist(attacker, target);
    const need = psiDefense(target, kind) - base; // precisa de RNG > need
    const wins = U.clamp(55 - need, 0, 56);
    return U.idiv(wins * 100, 56);
  }

  // probabilidade de a IA escolher Controlo Mental em vez de Pânico (REA §6.4)
  function controlOdds(B, target) {
    const morale = moraleOf(target);
    const b = bravFactor(target);
    let odds = 40;
    if (b > 6) odds -= 15;
    if (b < 4) odds += 15;
    if (morale >= 40) {
      if (morale - 10 * b < 50) odds -= 15;
    } else odds += 15;
    if (morale === 0) odds = 100;
    return odds;
  }

  function takeControl(B, u, side, attacker) {
    u.side = side;
    u.control = side === u.origSide ? null : { by: side, revertOn: side, turn: B.turn | 0, attackerId: attacker ? attacker.id : null };
    if (u.status === 'panic') u.status = 'ok';
    u.tuMax = BU().turnTU(B, u);
    u.tu = u.tuMax;
    return refreshSides(B);
  }

  function psiAttack(B, attacker, target, kind, rng) {
    const k = PSI_KINDS[kind];
    const r = rngOf(B, rng);
    if (!k || !r || !attacker || !target || attacker === target || !conscious(target) || target.side === attacker.side) {
      return { success: false, events: [] };
    }
    const attack = psiAttackStrength(attacker) - tileDist(attacker, target) + r.int(0, 55);
    const success = attack > psiDefense(target, k);
    gainExp(attacker, 'psi', success ? 3 : 1);
    const extra = [];
    let sight = null;
    if (success) {
      if (k === 'panic') {
        const loss = 110 - (target.stats.brav | 0);
        if (loss > 0) change(B, target, -loss, extra);
      } else sight = takeControl(B, target, attacker.side, attacker);
    }
    const ev = {
      t: 'psi', attackerId: attacker.id, targetId: target.id, kind: k, success,
      vis: visOf(B, target) || visOf(B, attacker), pos: tile(B, target),
    };
    return { success, events: [ev].concat(extra), sight };
  }

  function revertControl(B, side) {
    const out = [];
    for (const u of B.units) {
      if (!u.control || u.control.revertOn !== side) continue;
      const from = u.side;
      u.side = u.origSide;
      u.control = null;
      if (u.status === 'panic') u.status = 'ok';
      out.push({ t: 'psi', kind: 'revert', targetId: u.id, from, side: u.side, vis: visOf(B, u), pos: tile(B, u) });
    }
    if (out.length) {
      refreshSides(B);
      for (const e of out) {
        const u = BU().findUnit(B, e.targetId);
        e.vis = visOf(B, u);
      }
    }
    return out;
  }

  OV.Morale = {
    leaderMod, teamMod, rankWeight, bravFactor, panicChance, lossPct, moraleChange, onHit, onWounds, onDeath, painkiller,
    panicPhase, runBerserk, berserkWeapon, nearestVisibleEnemy, psiAttack, revertControl, psiAttackStrength,
    psiDefense, tileDist, psiChance, controlOdds, gainExp, improveStat, postMission, EXP_KINDS,
  };
})(globalThis.OV || (globalThis.OV = {}));
