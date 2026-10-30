/* Combate (DESIGN.md §3.4, §3.6, §8; REA 03 §3–4): precisão, desvio de projéteis (applyAccuracy do OpenXcom,
   inteiro), traçado de tiros, dano em unidades (lado/parte do corpo, armadura, feridas, atordoamento, morte,
   inconsciência, zombificação), dano em terreno, explosões com raios inteiros pré-calculados e explosões
   em cadeia (B.pendingExplosions). Só inteiros; aleatoriedade só pelas streams de B.rng (combat por omissão).

   OV.Combat:
     accuracy(B, u, itemId|tipo, mode, opts?{berserk}) → int %
     healthMod(u, hand, twoHanded) → int %
     deviate(rng, origin, target, acc) → voxel
     shotPath(B, shooter, aimVoxel, rng?, acc?, opts?) → {origin, aim, to, hit, path}
     hitChance(B, u, itemId, mode, target, uiRng, samples?, opts?) → int %
     resolveShot(B, shooter, itemId, mode, target, rng?, opts?) → events
     resolveMelee(B, attacker, itemId, target, rng?, opts?) → events
     applyImpact(B, hit, power, dmgType, attackerId, opts?) → events
     damageUnit(B, u, power, dmgType, side, part, attackerId, opts?) → events
     killUnit(B, u, killerId, cause, opts?) → events ; knockOut(B, u, attackerId, opts?) → events
     damageTerrain(B, i, part, power, opts?) → events
     explode(B, centreVoxel, power, dmgType, radius, attackerId, opts?) → events
     resolvePendingExplosions(B, rng?, opts?{keepLast}) → events
   Lados da armadura: 0 frente, 1 esquerda, 2 direita, 3 traseira, 4 baixo.
   Partes do corpo (u.wounds): 0 cabeça, 1 tronco, 2 braço D, 3 braço E, 4 perna D, 5 perna E. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const idiv = U.idiv;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const VX = 16, VZ = 24;
  const SIDE_FRONT = 0, SIDE_LEFT = 1, SIDE_RIGHT = 2, SIDE_REAR = 3, SIDE_UNDER = 4;
  const P_HEAD = 0, P_TORSO = 1, P_RARM = 2, P_LARM = 3, P_RLEG = 4, P_LLEG = 5;
  const LIVE = { ok: 1, panic: 1 };
  const AREA_TYPES = { SMOKE: 1 };

  // arredondamento simétrico inteiro de a/b (b > 0)
  function rdiv(a, b) {
    const s = a < 0 ? -1 : 1;
    return s * idiv(2 * Math.abs(a) + b, 2 * b);
  }
  const hostile = (a, b) => (a === 'alien') !== (b === 'alien');

  // ---- raios de explosão pré-calculados (R = 1..11): linhas inteiras de (0,0) ao perímetro do quadrado --------
  const RAYS = [];
  (function buildRays() {
    const maxR = tune('MAX_BLAST_RADIUS', 11);
    for (let R = 0; R <= maxR; R++) {
      const rays = [];
      if (R > 0) {
        const perim = [];
        for (let k = -R; k <= R; k++) {
          perim.push([k, -R], [k, R]);
          if (k > -R && k < R) perim.push([-R, k], [R, k]);
        }
        for (const [px, py] of perim) {
          const N = Math.max(Math.abs(px), Math.abs(py));
          const pts = [];
          for (let k = 1; k <= N; k++) pts.push(rdiv(px * k, N), rdiv(py * k, N));
          rays.push(pts);
        }
      }
      RAYS.push(rays);
    }
  })();
  // direção 0..7 de um passo unitário (dx,dy ∈ −1..1)
  const STEP_DIR = [[7, 0, 1], [6, -1, 2], [5, 4, 3]]; // [dy+1][dx+1]
  const stepDir = (dx, dy) => STEP_DIR[dy + 1][dx + 1];

  // ---- utilidades de estado -------------------------------------------------------------------------------
  function derived(B) {
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    return B._;
  }
  function stats(B) {
    if (!B.stats) B.stats = { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 };
    return B.stats;
  }
  function pending(B) {
    if (!Array.isArray(B.pendingExplosions)) B.pendingExplosions = [];
    return B.pendingExplosions;
  }
  function markDirty(B) {
    const _ = derived(B);
    if (_ && _.dirty) {
      _.dirty.light = true;
      _.dirty.los = true;
      _.dirty.path = true;
    }
  }
  const rngOf = (B, rng) => rng || B.rng.combat;
  const tileOfUnit = (B, u) => (u && u.x >= 0 ? (u.z * B.map.h + u.y) * B.map.w + u.x : -1);
  const findUnit = (B, id) => (id === null || id === undefined ? null : BU().findUnit(B, id));

  // visível para o jogador: unidades X-COM sempre; as restantes pelo LOS
  function visOf(B, u) {
    if (!u) return false;
    if (u.side === 'xcom' || u.origSide === 'xcom') return true;
    return !!(OV.LOS && OV.LOS.isVisibleTo && OV.LOS.isVisibleTo(B, 'xcom', u));
  }
  // tile visível agora ou já descoberto (o terreno descoberto é desenhado)
  function tileVis(B, i) {
    if (i < 0 || i >= B.map.n) return false;
    const _ = B._;
    return !!((_ && _.visTiles && _.visTiles[i]) || (B.map.disc[i] & 1));
  }

  // centro do volume da unidade (voxel), meia altura
  function unitCentre(u) {
    const off = u.size > 1 ? VX : VX >> 1;
    return [u.x * VX + off, u.y * VX + off, u.z * VZ + idiv(stanceHeight(u), 2)];
  }
  const stanceHeight = (u) => (u.kneel ? u.kneelHeight : u.height) | 0;

  // ---- precisão -------------------------------------------------------------------------------------------
  // max(10, 75 + 25·HP/HPmáx − 10·(cabeça + braço(s) da arma)); hand null ⇒ só a cabeça (arremesso, como
  // getAccuracyModifier() sem item do OpenXcom)
  function healthMod(u, hand, twoHanded) {
    const w = u.wounds || [0, 0, 0, 0, 0, 0];
    let n = w[P_HEAD] | 0;
    if (twoHanded) n += (w[P_RARM] | 0) + (w[P_LARM] | 0);
    else if (hand === 'L') n += w[P_LARM] | 0;
    else if (hand === 'R') n += w[P_RARM] | 0;
    return Math.max(10, 75 + idiv(25 * Math.max(0, u.hp), Math.max(1, u.hpMax)) - 10 * n);
  }

  function itemRef(B, itemId) {
    if (typeof itemId === 'string') return { item: null, type: itemId };
    const it = BU().findItem(B, itemId);
    return { item: it, type: it ? it.type : null };
  }

  /* Precisão (REA §3.1), inteira passo a passo:
     tiro: Pontaria × acc/100 → ×115/100 de joelhos → ×80/100 arma de duas mãos com a outra mão ocupada → × saúde/100;
     arremesso: Lançamento × saúde/100; corpo a corpo: acc (× Corpo-a-corpo/100 salvo skill:false) × saúde/100;
     opts.berserk divide por BERSERK_ACC_DIV. */
  function accuracy(B, u, itemId, mode, opts) {
    const o = opts || {};
    const { item, type } = itemRef(B, itemId);
    const def = type ? D().items[type] : null;
    let hand = item ? BU().slotOf(u, item.id) : 'R';
    if (hand !== 'R' && hand !== 'L') hand = 'R';
    if (mode === 'throw') return Math.max(0, idiv((u.stats.thr | 0) * healthMod(u, null, false), 100));
    if (!def) return 0;
    const m = D().weaponModes(type).find((x) => x.mode === mode);
    if (!m) return 0;
    const two = !!def.twoHanded;
    let acc;
    if (mode === 'melee') {
      acc = def.skill === false ? m.acc : idiv(m.acc * (u.stats.melee | 0), 100);
      acc = idiv(acc * healthMod(u, hand, two), 100);
    } else {
      acc = idiv((u.stats.fire | 0) * m.acc, 100);
      if (u.kneel) acc = idiv(acc * tune('KNEEL_ACC', 115), 100);
      const other = hand === 'R' ? u.items.L : u.items.R;
      if (two && other !== null && other !== undefined) acc = idiv(acc * tune('TWO_HAND_PENALTY', 80), 100);
      acc = idiv(acc * healthMod(u, hand, two), 100);
    }
    if (o.berserk) acc = idiv(acc, tune('BERSERK_ACC_DIV', 2));
    return Math.max(0, acc);
  }

  // ---- desvio (Projectile::applyAccuracy, inteiro) ---------------------------------------------------------
  function deviate(rng, origin, target, acc) {
    const xd = Math.abs(origin[0] - target[0]), yd = Math.abs(origin[1] - target[1]), zd = Math.abs(origin[2] - target[2]);
    const xy = idiv(xd, 2) <= yd ? idiv(xd, 4) + yd : idiv(xd + yd, 2);
    const zs = xy <= zd ? idiv(xy, 2) + zd : xy + idiv(zd, 2);
    let d = rng.int(0, 100) - (acc | 0);
    d += d >= 0 ? 50 : 10;
    d = Math.max(1, idiv(zs * d, 200));
    const x = target[0] + rng.int(0, d) - idiv(d, 2);
    const y = target[1] + rng.int(0, d) - idiv(d, 2);
    const z = target[2] + idiv(rng.int(0, idiv(d, 2)), 2) - idiv(d, 8);
    return [x, y, z];
  }

  // pontos da trajetória para animação: origem, amostras de 2 em 2 tiles, ponto final
  function samplePath(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const out = [a.slice()];
    const STEP = 2 * VX;
    for (let k = STEP; k < N; k += STEP) out.push([a[0] + rdiv(dx * k, N), a[1] + rdiv(dy * k, N), a[2] + rdiv(dz * k, N)]);
    if (N) out.push(b.slice());
    return out;
  }

  /* Trajetória de um tiro: origem na boca da arma, alvo desviado (se rng e acc), linha prolongada até
     SHOT_EXTEND_TILES; o primeiro voxel ocupado fica com o tiro. → {origin, aim, to, hit, path} */
  function shotPath(B, shooter, aim, rng, acc, opts) {
    const o = opts || {};
    const origin = o.origin ? o.origin.slice() : OV.LOS.originVoxel(B, shooter, aim);
    const to = rng && acc !== null && acc !== undefined ? deviate(rng, origin, aim, acc) : aim.slice();
    const ext = o.extend === undefined ? tune('SHOT_EXTEND_TILES', 30) : o.extend;
    const ignore = o.ignore !== undefined ? o.ignore : shooter ? shooter.id : null;
    const hit = OV.LOS.traceShot(B, origin, to, ignore, ext);
    return { origin, aim: aim.slice(), to, hit, path: samplePath(origin, hit.voxel) };
  }

  // alvo: unidade (objeto), índice de tile ou voxel [x,y,z] → {aim, unit, tile}
  function resolveTarget(B, shooter, target) {
    const m = B.map;
    if (Array.isArray(target)) {
      const t = [target[0] | 0, target[1] | 0, target[2] | 0];
      const tz = U.clamp(idiv(t[2], VZ), 0, m.d - 1);
      return { aim: t, unit: null, tile: BM().idx(m, U.clamp(t[0] >> 4, 0, m.w - 1), U.clamp(t[1] >> 4, 0, m.h - 1), tz) };
    }
    if (target && typeof target === 'object') {
      const u = target.id !== undefined && target.x !== undefined ? target : findUnit(B, target.unitId);
      if (!u || u.x < 0) return null;
      const aim = (u.onMap && OV.LOS.targetVoxel(B, shooter, u)) || unitCentre(u);
      return { aim, unit: u, tile: tileOfUnit(B, u) };
    }
    const i = target | 0;
    if (i < 0 || i >= m.n) return null;
    const occ = derived(B).unitAt[i] ? findUnit(B, B._.unitAt[i] - 1) : null;
    let aim = OV.LOS.targetVoxel(B, shooter, i);
    if (!aim) {
      const [x, y, z] = BM().xyz(m, i);
      aim = occ && occ !== shooter ? unitCentre(occ) : [x * VX + 8, y * VX + 8, z * VZ + 2];
    }
    return { aim, unit: occ && occ !== shooter ? occ : null, tile: i };
  }

  // acertou no alvo pretendido?
  function hitsTarget(hit, tgt) {
    if (tgt.unit) return hit.kind === 'unit' && hit.unitId === tgt.unit.id;
    return hit.kind !== 'out' && hit.kind !== 'none' && hit.i === tgt.tile;
  }

  /* Probabilidade efetiva de acertar (Monte Carlo do modelo real) com uma stream NÃO simulada (ui).
     Não altera B. Corpo a corpo: a precisão; tiro guiado: a precisão fixa do lançador. */
  function hitChance(B, u, itemId, mode, target, uiRng, samples, opts) {
    const n = samples > 0 ? samples | 0 : tune('HIT_PREVIEW_SAMPLES', 100);
    const { type } = itemRef(B, itemId);
    const def = type ? D().items[type] : null;
    if (!def) return 0;
    if (mode === 'melee') return Math.min(100, accuracy(B, u, itemId, mode, opts));
    if (def.guided) return u.side === 'alien' ? def.guided.alienAcc : def.guided.acc;
    const tgt = resolveTarget(B, u, target);
    if (!tgt) return 0;
    const acc = accuracy(B, u, itemId, mode, opts);
    const origin = OV.LOS.originVoxel(B, u, tgt.aim);
    const ext = tune('SHOT_EXTEND_TILES', 30);
    let hits = 0;
    for (let k = 0; k < n; k++) {
      const to = deviate(uiRng, origin, tgt.aim, acc);
      if (hitsTarget(OV.LOS.traceShot(B, origin, to, u.id, ext), tgt)) hits++;
    }
    return idiv(100 * hits, n);
  }

  // munição da arma: carregador carregado, ou poder próprio (laser, armas embutidas)
  function ammoOf(it) {
    const items = D().items;
    const def = items[it.type];
    if (def.ammo && def.ammo.length) {
      if (!it.ammo || !(it.ammo.rounds > 0)) return null;
      const a = items[it.ammo.type];
      return { type: it.ammo.type, power: a.power | 0, dmg: a.dmg, radius: a.radius | 0 };
    }
    if (def.power === undefined) return null;
    return { type: null, power: def.power | 0, dmg: def.dmg, radius: def.radius | 0 };
  }
  function consumeRound(it) {
    if (!it.ammo) return;
    it.ammo.rounds--;
    if (it.ammo.rounds <= 0) it.ammo = null; // carregador vazio desaparece (orig)
  }

  // bomba guiada: rota de voo (Path.flyRoute) pelos centros dos tiles; desvio só no último troço (precisão fixa)
  function guidedPath(B, shooter, tgt, rng, def) {
    const m = B.map;
    const from = tileOfUnit(B, shooter);
    const route = OV.Path && OV.Path.flyRoute && from >= 0 && tgt.tile >= 0 ? OV.Path.flyRoute(B, from, tgt.tile) : null;
    const acc = shooter.side === 'alien' ? def.guided.alienAcc : def.guided.acc;
    if (!route || route.length < 3) return shotPath(B, shooter, tgt.aim, rng, acc);
    const way = [OV.LOS.originVoxel(B, shooter, tgt.aim)];
    for (let k = 1; k < route.length - 1; k++) {
      const [x, y, z] = BM().xyz(m, route[k]);
      way.push([x * VX + 8, y * VX + 8, z * VZ + 12]);
    }
    const path = [way[0].slice()];
    for (let k = 0; k + 1 < way.length; k++) {
      const hit = OV.LOS.traceShot(B, way[k], way[k + 1], shooter.id, 0);
      if (hit.kind !== 'none') {
        path.push(hit.voxel.slice());
        return { origin: way[0], aim: tgt.aim.slice(), to: way[k + 1], hit, path };
      }
      path.push(way[k + 1].slice());
    }
    const last = way[way.length - 1];
    const to = deviate(rng, last, tgt.aim, acc);
    const hit = OV.LOS.traceShot(B, last, to, shooter.id, tune('SHOT_EXTEND_TILES', 30));
    path.push(hit.voxel.slice());
    return { origin: way[0], aim: tgt.aim.slice(), to, hit, path };
  }

  /* Disparo completo (snap/aimed/auto): cada bala gasta munição, desvia-se e é traçada; eventos por bala:
     {t:'shot', …} e depois os do impacto (applyImpact). opts: {berserk}. */
  function resolveShot(B, shooter, itemId, mode, target, rng, opts) {
    const o = opts || {};
    const r = rngOf(B, rng);
    const out = [];
    derived(B);
    const it = BU().findItem(B, itemId);
    if (!it) return [{ t: 'interrupt', reason: 'noWeapon', unitId: shooter.id, vis: visOf(B, shooter), pos: tileOfUnit(B, shooter) }];
    const def = D().items[it.type];
    if (mode === 'melee' || def.kind === 'melee') return resolveMelee(B, shooter, itemId, target, r, o);
    const m = D().weaponModes(it.type).find((x) => x.mode === mode);
    if (!m) return [{ t: 'interrupt', reason: 'noMode', unitId: shooter.id, vis: visOf(B, shooter), pos: tileOfUnit(B, shooter) }];
    const shots = Math.max(1, m.shots | 0 || 1);
    const tgt = resolveTarget(B, shooter, target);
    if (!tgt) return [{ t: 'interrupt', reason: 'noTarget', unitId: shooter.id, vis: visOf(B, shooter), pos: tileOfUnit(B, shooter) }];
    const acc = accuracy(B, shooter, itemId, mode, o);
    for (let k = 0; k < shots; k++) {
      if (!LIVE[shooter.status] || !shooter.onMap) break;
      const ammo = ammoOf(it);
      if (!ammo) {
        if (k === 0) out.push({ t: 'interrupt', reason: 'noAmmo', unitId: shooter.id, vis: visOf(B, shooter), pos: tileOfUnit(B, shooter) });
        break;
      }
      consumeRound(it);
      const sp = def.guided ? guidedPath(B, shooter, tgt, r, def) : shotPath(B, shooter, tgt.aim, r, acc);
      const svis = visOf(B, shooter) || tileVis(B, sp.hit.i) || (!!tgt.unit && visOf(B, tgt.unit));
      out.push({
        t: 'shot', shooterId: shooter.id, weapon: it.type, ammo: ammo.type, mode, dmgType: ammo.dmg, round: k, shots,
        from: sp.origin, to: sp.hit.voxel.slice(), path: sp.path,
        hit: { kind: sp.hit.kind, i: sp.hit.i, part: sp.hit.part, unitId: sp.hit.unitId, voxel: sp.hit.voxel.slice() },
        targetId: tgt.unit ? tgt.unit.id : null, targetI: tgt.tile, vis: svis, pos: tileOfUnit(B, shooter),
      });
      const evs = applyImpact(B, sp.hit, ammo.power, ammo.dmg, shooter.id, { from: sp.path[sp.path.length - 2] || sp.origin, radius: ammo.radius, rng: r, cause: 'shot' });
      // experiência de pontaria: bala/explosão que fere um inimigo
      if (OV.Morale && evs.some((e) => e.t === 'damage' && (e.amount > 0 || e.stun > 0) && hostile(shooter.side, (findUnit(B, e.unitId) || {}).side))) {
        OV.Morale.gainExp(shooter, 'fire');
      }
      for (const e of evs) out.push(e);
    }
    return out;
  }

  /* Corpo a corpo: to-hit RNG(0,99) < precisão; poder = Força (armas vivas) ou o da arma; a garra da Crisálida
     marca a vítima humana para renascer como Zombie. → events */
  function resolveMelee(B, attacker, itemId, target, rng, opts) {
    const o = opts || {};
    const r = rngOf(B, rng);
    derived(B);
    const { type } = itemRef(B, itemId);
    const def = type ? D().items[type] : null;
    const tu = target && typeof target === 'object' ? (target.x !== undefined ? target : findUnit(B, target.unitId))
      : typeof target === 'number' && B._.unitAt[target] ? findUnit(B, B._.unitAt[target] - 1) : null;
    const pos = tu ? tileOfUnit(B, tu) : typeof target === 'number' ? target : -1;
    const vis = visOf(B, attacker) || (tu ? visOf(B, tu) : false);
    if (!def || !tu || !LIVE[tu.status]) {
      return [{ t: 'melee', attackerId: attacker.id, targetId: tu ? tu.id : null, weapon: type, hit: false, vis, pos }];
    }
    const acc = accuracy(B, attacker, itemId, 'melee', o);
    const hit = r.int(0, 99) < acc;
    const out = [{ t: 'melee', attackerId: attacker.id, targetId: tu.id, weapon: type, hit, vis, pos }];
    if (!hit) return out;
    const power = def.strengthPower ? attacker.stats.str | 0 : def.power | 0;
    const a = unitCentre(attacker), c = unitCentre(tu);
    const side = impactSide(tu, a[0] - c[0], a[1] - c[1], r);
    const part = bodyPart(tu, idiv(stanceHeight(tu), 2), side, r);
    const evs = damageUnit(B, tu, power, def.dmg, side, part, attacker.id, { rng: r, cause: 'melee', zombify: attacker.zombify || def.zombify || null, hitMorale: true });
    if (OV.Morale && hostile(attacker.side, tu.side) && evs.some((e) => e.t === 'damage' && e.unitId === tu.id)) OV.Morale.gainExp(attacker, 'melee');
    for (const e of evs) out.push(e);
    return out;
  }

  // lado atingido a partir do ponto de impacto relativo ao centro (BattleUnit::damage): zonas de 45° 2/3–1/3
  function impactSide(u, rx, ry, rng) {
    if (rx === 0 && ry === 0) return SIDE_UNDER;
    const ax = Math.abs(rx), ay = Math.abs(ry);
    let rel;
    if (ay > ax * 2) rel = 8 + 4 * (ry > 0 ? 1 : 0);
    else if (ax > ay * 2) rel = 10 + 4 * (rx < 0 ? 1 : 0);
    else if (rx < 0) rel = ry > 0 ? 13 : 15;
    else rel = ry > 0 ? 11 : 9;
    switch ((rel - (u.dir & 7)) & 7) {
      case 0: return SIDE_FRONT;
      case 1: return rng.int(0, 2) < 2 ? SIDE_FRONT : SIDE_RIGHT;
      case 2: return SIDE_RIGHT;
      case 3: return rng.int(0, 2) < 2 ? SIDE_REAR : SIDE_RIGHT;
      case 4: return SIDE_REAR;
      case 5: return rng.int(0, 2) < 2 ? SIDE_REAR : SIDE_LEFT;
      case 6: return SIDE_LEFT;
      default: return rng.int(0, 2) < 2 ? SIDE_FRONT : SIDE_LEFT;
    }
  }
  // parte do corpo pela altura do impacto acima do chão: cabeça só na camada de cima (relZ ≥ altura no OpenXcom,
  // com a unidade em (tz, tz+h]; aqui o cilindro é 0..h−1), braços/tronco acima de 4, pernas
  function bodyPart(u, relZ, side, rng) {
    if (side === SIDE_UNDER) return P_TORSO;
    const h = stanceHeight(u);
    if (relZ >= h - 1) return P_HEAD;
    if (relZ > 4) return side === SIDE_LEFT ? P_LARM : side === SIDE_RIGHT ? P_RARM : P_TORSO;
    if (side === SIDE_LEFT) return P_LLEG;
    if (side === SIDE_RIGHT) return P_RLEG;
    return rng.int(P_RLEG, P_LLEG);
  }

  // centro de uma explosão de projétil: o voxel livre imediatamente antes do impacto
  function stepBack(hit, from) {
    const v = hit.voxel;
    if (!from || hit.kind === 'unit' || hit.kind === 'none') return v.slice();
    const dx = from[0] - v[0], dy = from[1] - v[1], dz = from[2] - v[2];
    const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (!N) return v.slice();
    return [v[0] + rdiv(dx, N), v[1] + rdiv(dy, N), v[2] + rdiv(dz, N)];
  }

  /* Efeito de um impacto: {t:'impact'} e depois dano direto (unidade: lado/parte pelo ponto; terreno:
     RNG(25,75) % do poder contra a armadura da parte) ou explosão (munição com raio, fumo).
     opts: {from: voxel de onde vinha o projétil, radius, rng, cause}. */
  function applyImpact(B, hit, power, dmgType, attackerId, opts) {
    const o = opts || {};
    const r = rngOf(B, o.rng);
    derived(B);
    const out = [];
    if (!hit || hit.kind === 'out') return out;
    const unit = hit.kind === 'unit' ? findUnit(B, hit.unitId) : null;
    out.push({
      t: 'impact', voxel: hit.voxel.slice(), kind: hit.kind, i: hit.i, part: hit.part === undefined ? null : hit.part,
      unitId: hit.unitId === undefined ? null : hit.unitId, dmgType, vis: tileVis(B, hit.i) || (!!unit && visOf(B, unit)), pos: hit.i,
    });
    const radius = o.radius | 0;
    if (radius > 0 || AREA_TYPES[dmgType]) {
      const c = stepBack(hit, o.from);
      for (const e of explode(B, c, power, dmgType, radius, attackerId, { rng: r, cause: o.cause || 'shot' })) out.push(e);
      return out;
    }
    if (hit.kind === 'none') return out;
    if (unit) {
      const c = unitCentre(unit);
      const side = impactSide(unit, hit.voxel[0] - c[0], hit.voxel[1] - c[1], r);
      const part = bodyPart(unit, hit.voxel[2] - unit.z * VZ, side, r);
      for (const e of damageUnit(B, unit, power, dmgType, side, part, attackerId, { rng: r, cause: o.cause || 'shot', zombify: o.zombify, hitMorale: true })) out.push(e);
      return out;
    }
    const dt = D().damageTypes[dmgType];
    if (dt && dt.terrain === false) return out;
    const pct = r.int(tune('TERRAIN_HIT_MIN', 25), tune('TERRAIN_HIT_MAX', 75));
    for (const e of damageTerrain(B, hit.i, hit.part, idiv(power * pct, 100), { rng: r, attackerId })) out.push(e);
    return out;
  }

  /* Dano numa unidade (BattleUnit::damage). power é rolado 0–200 % (HE 50–150 %) salvo opts.roll === false;
     ×modificador da armadura do tipo original (SMOKE lê o de SMOKE e só depois conta como STUN); −armadura do lado
     (IN ignora). Se p > 0: STUN ⇒ atordoa; senão HP −p e, se não for IN: atordoamento RNG(0,p/4) (se atordoável),
     feridas fatais em soldados (RNG(0,10) < p ⇒ RNG(1,3)) e moral −(feridas na parte), desgaste da armadura
     p/10+1. Moral do impacto (−100·(p·B/10)/mod, qualquer tipo) só com opts.hitMorale (golpes diretos, como
     TileEngine::hit; explosões e fogo não). Revelação do atacante, morte/inconsciência.
     opts: {rng, roll, ignoreArmour, cause, zombify, hitMorale, keepLast: lado cujo último consciente não cai} */
  function damageUnit(B, u, power, dmgType, side, part, attackerId, opts) {
    const o = opts || {};
    const out = [];
    if (!u || u.status === 'dead') return out;
    derived(B);
    const r = rngOf(B, o.rng);
    const Data = D();
    const dt = Data.damageTypes[dmgType] || { range: 100 };
    const type = dmgType === 'SMOKE' ? 'STUN' : dmgType;
    const s = side === undefined || side === null ? SIDE_FRONT : side;
    const bp = part === undefined || part === null ? P_TORSO : part;
    const vis = visOf(B, u);
    const pos = tileOfUnit(B, u);
    const R = dt.range === undefined ? 100 : dt.range;
    const pw = Math.max(0, power | 0);
    const rnd = o.roll === false ? pw : r.int(idiv(pw * (100 - R), 100), idiv(pw * (100 + R), 100));
    const mod = u.mods && u.mods[dmgType] !== undefined ? u.mods[dmgType] : 100;
    let p = idiv(rnd * mod, 100);
    const ignore = !!(o.ignoreArmour || dt.ignoresArmour);
    if (!ignore) p -= u.armour[s] | 0;
    let hpLoss = 0, stunAdd = 0, wounds = 0;
    const moraleEv = [];
    if (p > 0) {
      if (type === 'STUN') {
        stunAdd = p;
        u.stun += p;
      } else {
        hpLoss = Math.min(p, Math.max(0, u.hp));
        u.hp = Math.max(0, u.hp - p);
        if (type !== 'IN') {
          if ((u.mods && u.mods.STUN !== undefined ? u.mods.STUN : 100) > 0) {
            stunAdd = r.int(0, idiv(p, 4));
            u.stun += stunAdd;
          }
          if (u.type === 'soldier' && dt.wounds !== false) {
            if (r.int(0, 10) < p) {
              wounds = r.int(1, 3);
              u.wounds[bp] += wounds;
            }
            // moral −(todas as feridas da parte atingida), haja ou não ferida nova
            if (OV.Morale && u.wounds[bp] > 0) for (const e of OV.Morale.onWounds(B, u, u.wounds[bp])) moraleEv.push(e);
          }
          u.armour[s] = Math.max(0, (u.armour[s] | 0) - (idiv(p, 10) + 1));
        }
        // a garra da Crisálida: a vítima humana renasce como Zombie quando morrer
        if (o.zombify && u.size === 1 && u.origSide !== 'alien' && !u.spawnOnDeath) u.spawnOnDeath = o.zombify;
      }
      if (o.hitMorale && OV.Morale) for (const e of OV.Morale.onHit(B, u, p)) moraleEv.push(e);
    }
    // opts.keepLast = lado: o último consciente desse lado sobrevive acordado (explosões da queda antes do 1.º turno)
    if (o.keepLast && u.side === o.keepLast && LIVE[u.status] && (u.hp <= 0 || u.stun >= u.hp)
      && !B.units.some((x) => x !== u && x.side === o.keepLast && LIVE[x.status])) {
      const hp0 = u.hp + hpLoss;
      u.hp = Math.max(1, u.hp);
      if (u.stun >= u.hp) u.stun = u.hp - 1;
      hpLoss = Math.max(0, hp0 - u.hp);
    }
    // quem fere um alienígena fica conhecido; a vítima lembra-se de quem a atingiu
    const atk = findUnit(B, attackerId);
    if (atk && atk !== u && hostile(atk.side, u.side)) {
      if (u.side === 'alien') atk.turnsSinceSpotted = 0;
      if (u.ai && Array.isArray(u.ai.wasHitBy) && u.ai.wasHitBy.indexOf(atk.id) < 0) u.ai.wasHitBy.push(atk.id);
    }
    out.push({
      t: 'damage', unitId: u.id, attackerId: atk ? atk.id : null, dmgType, cause: o.cause || 'damage', amount: hpLoss, stun: stunAdd,
      armourHit: s, part: bp, wounds, hp: u.hp, stunLevel: u.stun, absorbed: p <= 0, vis, pos,
    });
    for (const e of moraleEv) out.push(e);
    if (u.hp <= 0) {
      for (const e of killUnit(B, u, atk ? atk.id : null, o.cause || 'damage', { rng: r })) out.push(e);
    } else if (u.stun >= u.hp && LIVE[u.status]) {
      for (const e of knockOut(B, u, atk ? atk.id : null, { rng: r })) out.push(e);
    }
    return out;
  }

  // larga todo o inventário no tile (armas embutidas desaparecem se dropFixed) → [itemIds largados]
  function dropAll(B, u, tile, dropFixed) {
    const dropped = [];
    for (const it of BU().allItems(B, u)) {
      if (D().items[it.type].fixed) {
        if (dropFixed) BU().deleteItem(B, it.id);
        continue;
      }
      if (BU().dropItem(B, u, it.id, tile)) dropped.push(it.id);
    }
    return dropped;
  }
  const bodyItem = (B, u) => B.items.find((it) => it.unitId === u.id) || null;
  function bodyTile(B, it) {
    if (!it) return -1;
    if (it.at !== null && it.at !== undefined) return it.at;
    const c = findUnit(B, it.owner);
    return c ? tileOfUnit(B, c) : -1;
  }
  function refreshSight(B, u) {
    if (OV.LOS && OV.LOS.refreshTarget) OV.LOS.refreshTarget(B, u);
  }

  /* Morte: sai do mapa, larga o inventário, cadáver (type = u.corpse, unitId) no tile; contagens em B.stats e
     abates do atacante; moral (Morale.onDeath); explodeOnDeath ⇒ explosão em B.pendingExplosions (o cadáver
     é poupado); spawnOnDeath (Zombie → Crisálida, vítima da Crisálida → Zombie) ⇒ nova unidade sem cadáver. */
  function killUnit(B, u, killerId, cause, opts) {
    const o = opts || {};
    const out = [];
    if (!u || u.status === 'dead') return out;
    derived(B);
    const r = rngOf(B, o.rng);
    const Data = D();
    const wasOut = u.status === 'out';
    const vis = visOf(B, u) || (wasOut && tileVis(B, bodyTile(B, bodyItem(B, u))));
    let body = wasOut ? bodyItem(B, u) : null;
    const tile = wasOut ? bodyTile(B, body) : tileOfUnit(B, u);
    const centre = wasOut || tile < 0 ? null : unitCentre(u);
    BU().removeUnitFromMap(B, u);
    u.status = 'dead';
    u.hp = 0;
    u.kneel = false;
    u.killedBy = killerId === undefined ? null : killerId;
    u.deathCause = cause || 'damage';
    u.deathTurn = B.turn | 0;
    u.deathSide = B.side || null; // lado em jogo na morte (≠ 'xcom' = tiro de reação/turno alienígena)
    const dropped = tile >= 0 ? dropAll(B, u, tile, true) : [];
    const spawnType = u.spawnOnDeath && Data.units[u.spawnOnDeath] ? u.spawnOnDeath : null;
    if (!body && !spawnType && tile >= 0 && u.corpse && Data.items[u.corpse]) body = BU().newItem(B, u.corpse, { at: tile, unitId: u.id });
    // contagens
    const st = stats(B);
    const killer = findUnit(B, killerId);
    if (wasOut && u.origSide === 'alien' && st.aliensStunned > 0) st.aliensStunned--;
    if (u.origSide === 'alien') st.aliensKilled++;
    else if (u.origSide === 'xcom') st.xcomKilled++;
    else if (killer && killer.side === 'xcom') st.civKilledByXcom++;
    else st.civKilledByAliens++;
    if (killer && killer !== u && hostile(killer.side, u.side)) killer.kills = (killer.kills | 0) + 1;
    out.push({
      t: 'death', unitId: u.id, killerId: killer ? killer.id : null, cause: u.deathCause, i: tile, bodyId: body && !spawnType ? body.id : null,
      dropped, vis, pos: tile,
    });
    refreshSight(B, u);
    if (OV.Morale) for (const e of OV.Morale.onDeath(B, u, killer ? killer.id : null)) out.push(e);
    if (u.explodeOnDeath && tile >= 0) {
      const x = u.explodeOnDeath;
      const c = centre || (() => { const [tx, ty, tz] = BM().xyz(B.map, tile); return [tx * VX + 8, ty * VX + 8, tz * VZ + 8]; })();
      pending(B).push({
        i: tile, part: null, power: x.power | 0, radius: x.radius | 0, dmg: x.dmg || 'HE', voxel: c, cause: 'unitDeath',
        attackerId: killer ? killer.id : null, spare: body ? [body.id] : [],
      });
    }
    if (spawnType && tile >= 0) {
      if (body) BU().deleteItem(B, body.id);
      const nu = BU().fromAlien(B, spawnType, 0, r, B.mission ? B.mission.deploymentId : null);
      let at = BU().fits(B, nu, tile) ? tile : OV.Battle && OV.Battle.nearestFree ? OV.Battle.nearestFree(B, nu, tile, null) : -1;
      if (at < 0) {
        B.units.splice(B.units.indexOf(nu), 1);
        if (B._ && B._.unitById) B._.unitById.delete(nu.id);
      } else {
        BU().placeUnit(B, nu, at);
        nu.dir = u.dir;
        nu.turnsSinceSpotted = 255;
        const zombify = u.origSide !== 'alien';
        out.push({ t: zombify ? 'zombify' : 'spawn', unitId: nu.id, fromId: u.id, type: spawnType, i: at, vis: vis || visOf(B, nu), pos: at });
      }
    }
    return out;
  }

  // inconsciente: sai do mapa, larga o que tem nas mãos e no corpo; corpo (unitId) no tile
  function knockOut(B, u, attackerId, opts) {
    const out = [];
    if (!u || !LIVE[u.status]) return out;
    derived(B);
    const vis = visOf(B, u);
    const tile = tileOfUnit(B, u);
    BU().removeUnitFromMap(B, u);
    u.status = 'out';
    u.kneel = false;
    const dropped = tile >= 0 ? dropAll(B, u, tile, false) : [];
    let body = null;
    if (tile >= 0 && u.corpse && D().items[u.corpse]) body = BU().newItem(B, u.corpse, { at: tile, unitId: u.id });
    if (u.origSide === 'alien') stats(B).aliensStunned++;
    out.push({ t: 'stun', unitId: u.id, attackerId: attackerId === undefined ? null : attackerId, i: tile, bodyId: body ? body.id : null, dropped, vis, pos: tile });
    refreshSight(B, u);
    return out;
  }

  // ---- terreno -----------------------------------------------------------------------------------------------
  // parte que fica quando esta é destruída: die; chão térreo sem die ⇒ «queimado» do mesmo conjunto
  function dieId(m, i, part, d) {
    let id = d.die | 0;
    if (part === 0 && id === 0 && i < m.w * m.h) {
      const s = D().tileDefByKey[d.set + '.scorched'];
      id = s && s.id !== d.id ? s.id : d.id;
    }
    return id;
  }
  function partCentre(m, i, d) {
    const [x, y, z] = BM().xyz(m, i);
    return [x * VX + 8, y * VX + 8, z * VZ + Math.max(1, idiv((d && d.height) | 0, 2))];
  }
  // parte explosiva destruída ⇒ explosão em cadeia (rola o poder agora)
  function queueChain(B, i, d, rng, attackerId) {
    const x = d.explosive;
    const pw = Array.isArray(x.power) ? rng.int(x.power[0], x.power[1]) : x.power | 0;
    pending(B).push({ i, part: null, power: pw, radius: x.radius | 0, dmg: x.type || 'HE', voxel: partCentre(B.map, i, d), cause: 'tile', attackerId: attackerId === undefined ? null : attackerId });
  }
  function tileEvent(B, ev) {
    ev.vis = tileVis(B, ev.i);
    ev.pos = ev.i;
    return ev;
  }

  /* Projétil/golpe numa parte: destruída se power ≥ armadura (255 indestrutível) → die (chão térreo ⇒
     queimado). Partes explosivas entram em B.pendingExplosions; chão destruído ⇒ gravidade. */
  function damageTerrain(B, i, part, power, opts) {
    const o = opts || {};
    const m = B.map;
    const out = [];
    if (i < 0 || i >= m.n || part === null || part === undefined) return out;
    const d = BM().def(m, i, part);
    if (!d || (d.armour | 0) >= 255 || (power | 0) < (d.armour | 0)) return out;
    const id = dieId(m, i, part, d);
    if (id === d.id) return out;
    out.push(tileEvent(B, BM().setPart(B, i, part, id)));
    if (d.explosive) queueChain(B, i, d, rngOf(B, o.rng), o.attackerId);
    if (part === 0 && !BM().hasFloor(m, i) && OV.Env) for (const e of OV.Env.applyGravity(B, i)) out.push(e);
    return out;
  }

  // inflamabilidade do tile (a menor das partes; 255 = à prova de fogo) e combustível (o maior)
  function tileFlam(m, i) {
    let f = 255;
    for (let p = 0; p < 4; p++) {
      const d = p === 3 ? BM().objectDef(m, i) : BM().def(m, i, p);
      if (d && d.flammable < f) f = d.flammable;
    }
    return f;
  }
  function tileFuel(m, i) {
    let f = 0;
    for (let p = 0; p < 4; p++) {
      const d = p === 3 ? BM().objectDef(m, i) : BM().def(m, i, p);
      if (d && (d.fuel | 0) > f) f = d.fuel | 0;
    }
    return f;
  }
  function markFresh(B, i) {
    if (!Array.isArray(B.freshFire)) B.freshFire = [];
    if (B.freshFire.indexOf(i) < 0) B.freshFire.push(i);
  }

  /* Detonação do tile (explosão HE): cada parte, com o poder todo, é destruída enquanto 2·armadura ≤ restante,
     seguindo a cadeia die; partes destruídas largam fumo 5; sobra > 2·inflamabilidade pega fogo. */
  function detonate(B, i, power, rng, attackerId, out, parts) {
    const m = B.map;
    let floorGone = false, leftObj = -1, leftFloor = power;
    for (const part of parts || [3, 1, 2, 0]) {
      let rem = power;
      let d = BM().def(m, i, part);
      if (part === 3 && d) leftObj = rem;
      let changed = false;
      for (let guard = 0; d && (d.armour | 0) < 255 && 2 * (d.armour | 0) <= rem && guard < 8; guard++) {
        rem -= 2 * (d.armour | 0);
        const id = dieId(m, i, part, d);
        if (id === d.id) break;
        if (d.explosive) queueChain(B, i, d, rng, attackerId);
        out.push(tileEvent(B, BM().setPart(B, i, part, id)));
        changed = true;
        d = id ? D().tileDefs[id] : null;
      }
      if (changed) {
        m.smoke[i] = Math.max(m.smoke[i], tune('SMOKE_FROM_DESTRUCTION', 5));
        if (part === 0 && !BM().hasFloor(m, i)) floorGone = true;
      }
      if (part === 3 && leftObj >= 0) leftObj = rem;
      if (part === 0) leftFloor = rem;
    }
    if (parts && parts.length === 1) return floorGone;
    const left = leftObj >= 0 ? leftObj : leftFloor;
    const flam = tileFlam(m, i), fuel = tileFuel(m, i);
    if (flam !== 255 && fuel > 0 && !m.fire[i] && left > 2 * flam) {
      m.fire[i] = Math.min(255, fuel + 1);
      m.smoke[i] = Math.max(m.smoke[i], 15 - U.clamp(idiv(flam, 10), 1, 12));
      markFresh(B, i);
      out.push({ t: 'fire', i, tiles: [i], vis: tileVis(B, i), pos: i });
    }
    return floorGone;
  }

  // ---- explosões -----------------------------------------------------------------------------------------------
  function blastRadius(power, type) {
    if (type === 'IN') return idiv(power, tune('IN_RADIUS_DIV', 30)) + 1;
    return idiv(power, tune('HE_RADIUS_DIV', 20));
  }

  /* Explosão (DESIGN §8): raios inteiros do centro ao perímetro do quadrado de raio R (círculo isqrt ≤ R),
     −10 por tile (fogo −5 extra nas diagonais), −2·heBlock da aresta atravessada e do objeto de bloco inteiro
     que se deixa; máximo por tile, mesmo nível. Ours: o chão do nível de cima leva p − 30 onde p > 30.
     HE: unidades RNG(50,150) % uma vez por tile ocupado (3×3 do centro por BAIXO, senão tronco/braços pelo lado),
     itens com poder > armadura destruídos (corpo inconsciente destruído ⇒ morte), terreno detonado (também a parede
     oeste/norte dos vizinhos a leste/sul); STUN: atordoamento 0–200 % (também corpos); SMOKE: fumo RNG(7,15) e apaga
     fogo; IN: fogo + fumo, unidades RNG(5,10) IN por tile ocupado e a arder RNG(0,5·mod). Depois gravidade nas colunas com chão
     destruído e luz/LOS marcadas como sujas. Explosões em cadeia ficam em B.pendingExplosions.
     opts: {rng, cause, spare:[itemIds poupados], keepLast: lado (ver damageUnit)} */
  function explode(B, centre, power, dmgType, radius, attackerId, opts) {
    const o = opts || {};
    const r = rngOf(B, o.rng);
    derived(B);
    const m = B.map;
    const type = dmgType || 'HE';
    const out = [];
    const maxR = tune('MAX_BLAST_RADIUS', 11);
    let R = radius > 0 ? radius | 0 : blastRadius(power | 0, type);
    R = U.clamp(R, 0, maxR);
    const cx = U.clamp(centre[0] >> 4, 0, m.w - 1), cy = U.clamp(centre[1] >> 4, 0, m.h - 1);
    const cz = U.clamp(idiv(Math.max(0, centre[2]), VZ), 0, m.d - 1);
    const p0 = type === 'IN' ? idiv(power | 0, 2) : power | 0;
    const plane = m.w * m.h;
    const best = new Map();
    const ci = BM().idx(m, cx, cy, cz);
    if (p0 > 0) best.set(ci, p0);
    const falloff = tune('HE_FALLOFF', 10);
    const lim = (R + 1) * (R + 1);
    for (const ray of RAYS[R]) {
      let p = p0, px = 0, py = 0;
      for (let k = 0; k < ray.length && p > 0; k += 2) {
        const rx = ray[k], ry = ray[k + 1];
        const x = cx + rx, y = cy + ry;
        if (!BM().inB(m, x, y, cz) || rx * rx + ry * ry >= lim) break;
        const dir = stepDir(rx - px, ry - py);
        const e = BM().edgeInfo(m, cx + px, cy + py, cz, dir);
        p -= falloff + 2 * e.heBlock;
        if (type === 'IN' && (dir & 1)) p -= 5;
        if (px || py) {
          const ob = BM().objectDef(m, BM().idx(m, cx + px, cy + py, cz));
          if (ob && ob.fullBlock) p -= 2 * (ob.heBlock | 0);
        }
        if (p <= 0) break;
        const i = BM().idx(m, x, y, cz);
        if (!(best.get(i) >= p)) best.set(i, p);
        px = rx;
        py = ry;
      }
    }
    const tiles = [...best.keys()].sort((a, b) => a - b);
    let vis = false;
    for (const i of tiles) if (tileVis(B, i)) { vis = true; break; }
    out.push({ t: 'explosion', voxel: [centre[0] | 0, centre[1] | 0, centre[2] | 0], i: ci, radius: R, power: power | 0, dmgType: type, tiles, powers: tiles.map((i) => best.get(i)), cause: o.cause || 'explosion', attackerId: attackerId === undefined ? null : attackerId, vis, pos: ci });

    /* unidades conscientes nos tiles, um golpe por tile ocupado (TileEngine::explode: uma 2×2 pode levar até 4);
       instantâneo antes do dano para não atingir quem nasce durante a explosão */
    const unitHits = [];
    for (const i of tiles) {
      const a = B._.unitAt[i];
      if (a) unitHits.push([i, a - 1]);
    }
    // lado por tile: 3×3 do centro ⇒ por baixo; senão pela direção do centro da explosão ao centro do tile
    const sideAt = (u, i) => {
      const [tx, ty] = BM().xyz(m, i);
      if (Math.abs(tx - cx) <= 1 && Math.abs(ty - cy) <= 1) return SIDE_UNDER;
      return impactSide(u, centre[0] - (tx * VX + 8), centre[1] - (ty * VX + 8), r);
    };
    // itens que já estavam no chão (o que cai durante a explosão — armas, corpos novos — sobrevive a esta)
    const tileSet = new Set(tiles);
    const ground = new Map();
    for (const it of B.items) {
      if (it.owner !== null || it.at === null || it.at === undefined || !tileSet.has(it.at)) continue;
      if (!ground.has(it.at)) ground.set(it.at, []);
      ground.get(it.at).push(it);
    }
    for (const l of ground.values()) l.sort((a, b) => a.id - b.id);
    const bodiesOn = (i) => (ground.get(i) || []).filter((it) => it.unitId !== null && it.unitId !== undefined)
      .map((it) => findUnit(B, it.unitId)).filter((u) => u && u.status === 'out');
    const bodies = new Map();
    for (const i of tiles) bodies.set(i, bodiesOn(i));
    const cause = o.cause || 'explosion';
    const floors = [];

    if (type === 'HE' || type === 'STUN') {
      // altura relativa fixa de 5 voxels (centro + (0,0,5) − tile no OpenXcom): tronco/braços pelo lado, nunca pernas
      const relZ = tune('BLAST_BODY_Z', 5);
      for (const [i, id] of unitHits) {
        const u = findUnit(B, id);
        if (!u || !LIVE[u.status]) continue;
        const side = sideAt(u, i);
        const part = bodyPart(u, relZ, side, r);
        for (const e of damageUnit(B, u, best.get(i), type, side, part, attackerId, { rng: r, cause, keepLast: o.keepLast })) out.push(e);
      }
      // corpos inconscientes no chão (por baixo): só atordoamento; o HE só os atinge pela destruição do item-corpo
      if (type === 'STUN') {
        for (const i of tiles) {
          for (const u of bodies.get(i)) {
            if (u.status === 'out') for (const e of damageUnit(B, u, best.get(i), type, SIDE_UNDER, P_TORSO, attackerId, { rng: r, cause, keepLast: o.keepLast })) out.push(e);
          }
        }
      }
    }
    if (type === 'HE') {
      // itens no chão: destruídos se poder > armadura do item (corpo inconsciente destruído ⇒ morte)
      const spare = new Set(o.spare || []);
      for (const i of tiles) {
        const p = best.get(i);
        const list = (ground.get(i) || []).filter((it) => !spare.has(it.id) && it.owner === null && it.at === i);
        const gone = [];
        for (const it of list) {
          const def = D().items[it.type];
          if (!(p > (def.armour | 0))) continue;
          const lu = it.unitId !== null && it.unitId !== undefined ? findUnit(B, it.unitId) : null;
          if (lu && lu.status === 'out') for (const e of killUnit(B, lu, attackerId, cause, { rng: r })) out.push(e);
          if (BU().findItem(B, it.id)) {
            BU().deleteItem(B, it.id);
            gone.push(it.id);
          }
        }
        if (gone.length) out.push({ t: 'itemsDestroyed', i, items: gone, vis: tileVis(B, i), pos: i });
      }
      // terreno do nível (cada tile também detona a parede oeste do vizinho a leste e a norte do vizinho a sul, com o
      // seu poder, como TileEngine::detonate) e (ours) chão do nível de cima
      for (const i of tiles) {
        if (detonate(B, i, best.get(i), r, attackerId, out)) floors.push(i);
        const [tx, ty] = BM().xyz(m, i);
        if (tx + 1 < m.w) detonate(B, i + 1, best.get(i), r, attackerId, out, [1]);
        if (ty + 1 < m.h) detonate(B, i + m.w, best.get(i), r, attackerId, out, [2]);
      }
      if (cz + 1 < m.d && !m.ceiling) {
        for (const i of tiles) {
          const p = best.get(i) - 30;
          if (p > 0 && detonate(B, i + plane, p, r, attackerId, out, [0])) floors.push(i + plane);
        }
      }
    } else if (type === 'SMOKE') {
      const lo = tune('SMOKE_GRENADE_MIN', 7), hi = tune('SMOKE_GRENADE_MAX', 15);
      for (const i of tiles) {
        m.smoke[i] = Math.max(m.smoke[i], r.int(lo, hi));
        m.fire[i] = 0;
      }
      out.push({ t: 'smoke', i: ci, tiles, vis, pos: ci });
    } else if (type === 'IN') {
      const lit = [];
      for (const i of tiles) {
        if (!BM().hasFloor(m, i) && !BM().def(m, i, 3)) continue;
        if (!m.fire[i]) {
          const flam = tileFlam(m, i);
          m.fire[i] = Math.min(255, tileFuel(m, i) + 1);
          m.smoke[i] = Math.max(m.smoke[i], U.clamp(15 - idiv(flam, 10), 1, 12));
          markFresh(B, i);
        }
        lit.push(i);
      }
      if (lit.length) out.push({ t: 'fire', i: lit[0], tiles: lit, vis, pos: ci });
      for (const [, id] of unitHits) {
        const u = findUnit(B, id);
        if (!u || !LIVE[u.status]) continue;
        for (const e of damageUnit(B, u, r.int(tune('FIRE_UNIT_MIN', 5), tune('FIRE_UNIT_MAX', 10)), 'IN', SIDE_UNDER, P_TORSO, attackerId, { rng: r, roll: false, cause, keepLast: o.keepLast })) out.push(e);
        const mod = u.mods && u.mods.IN !== undefined ? u.mods.IN : 100;
        if (u.status !== 'dead') {
          const bt = r.int(0, idiv(5 * mod, 100));
          if ((u.burn | 0) < bt) u.burn = bt;
        }
      }
    }
    // gravidade nas colunas com chão destruído
    if (OV.Env) for (const i of floors.sort((a, b) => a - b)) for (const e of OV.Env.applyGravity(B, i)) out.push(e);
    markDirty(B);
    return out;
  }

  /* Explosões pendentes (OVNI despenhado no início, partes explosivas e mortes explosivas depois de cada ação):
     entradas com part ≠ null destroem primeiro essa parte (se ainda for explosiva; senão já rebentou). */
  function resolvePendingExplosions(B, rng, opts) {
    const keepLast = opts && opts.keepLast ? opts.keepLast : null;
    const r = rngOf(B, rng);
    const out = [];
    const q = pending(B);
    derived(B);
    for (let guard = 0; q.length && guard < 512; guard++) {
      const e = q.shift();
      if (e.part !== null && e.part !== undefined) {
        const d = BM().def(B.map, e.i, e.part);
        if (!d || !d.explosive) continue;
        const id = dieId(B.map, e.i, e.part, d);
        if (id !== d.id) out.push(tileEvent(B, BM().setPart(B, e.i, e.part, id)));
        if (e.part === 0 && !BM().hasFloor(B.map, e.i) && OV.Env) for (const g of OV.Env.applyGravity(B, e.i)) out.push(g);
      }
      const ev = explode(B, e.voxel, e.power | 0, e.dmg || 'HE', e.radius | 0, e.attackerId === undefined ? null : e.attackerId,
        { rng: r, cause: e.cause || 'chain', spare: e.spare, keepLast });
      for (const x of ev) out.push(x);
    }
    return out;
  }

  OV.Combat = {
    accuracy, healthMod, deviate, shotPath, hitChance, resolveShot, resolveMelee, applyImpact, damageUnit, killUnit,
    knockOut, damageTerrain, explode, resolvePendingExplosions, impactSide, bodyPart, unitCentre, tileFlam, tileFuel,
    RAYS, SIDES: ['front', 'left', 'right', 'rear', 'under'], PARTS: ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'],
  };
})(globalThis.OV || (globalThis.OV = {}));
