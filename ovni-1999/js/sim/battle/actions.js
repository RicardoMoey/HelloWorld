/* Ações da batalha (DESIGN.md §10, §3.3, §3.6, §3.10, §15.2; REA 03 §2, §5). A única forma de mudar B durante a
   batalha: OV.Act.perform(B, action) é um gerador que altera B um passo atómico de cada vez e faz yield de um
   evento (o estado já está atualizado quando o evento sai). Só inteiros; aleatoriedade só por B.rng.combat.

   OV.Act:
     validate(B, action) → {ok, tu, energy, reason, …}      sem efeitos; reason ∈ REASONS (chave i18n 'bs.' + reason)
                                                              shoot com arma guiada: route [tile…] (Path.flyRoute) ou
                                                              reason 'noRoute'; outras armas: route null
     perform(B, action) → Generator<Event>                  devolve {ok, reason?, …} no fim
     reactions(B, mover|moverId) → Generator<Event>          ciclo de fogo de reação (§3.10); devolve n.º de reações
     reserveTU(B, u, opts?) → int                            UT reservadas (só X-COM; Auto→Snap→Aimed; +4 joelho;
                                                              opts {mode, noKneel, standing: conta o joelho mesmo ajoelhado})
     reserveInfo(B, u, opts?) → {tu, mode|null, asked, kneel} a mesma conta, com o modo que conta de facto
     walkPreview(B, u, toI, opts?) → {steps, tiles, tus, tu, energy, reserve, marks[0|1|2]} | null
     reactionScore(u) ; turnSteps(from, to) ; scannerBlips(B, u) ; reasonKey(reason) ; noteSpotted(B, u) → n.º de novos
     planArc(B, u, toI) → {curve, origin, target, goal}|null ; traceArc(B, u, fromVoxel, toVoxel, curve) → {arc, land, landVoxel}
   Ações: walk {unitId, to, path?, run?, desperate?} · turn {unitId, dir | toI} · kneel {unitId}
     · shoot {unitId, hand, mode, target:{unitId}|{i}|{voxel}, force?} · throw {unitId, itemId, toI}
     · prime {unitId, itemId, fuse} · reload {unitId, hand, clipId?} · unload {unitId, hand} · door {unitId, i, part?}
     · medikit {unitId, targetId, part, kind:'heal'|'stim'|'pain', itemId?} · inv {unitId, itemId, to} · pickup {unitId, itemId, to}
     · scanner {unitId} · melee {unitId, targetId, hand?} · psi {unitId, targetId, kind} · endUnit {unitId} */
(function (OV) {
  'use strict';

  const U = OV.U;
  const idiv = U.idiv;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const VX = 16, VZ = 24;
  const LIVE = { ok: 1, panic: 1 };
  const TYPES = ['walk', 'turn', 'kneel', 'shoot', 'throw', 'prime', 'reload', 'unload', 'door', 'medikit', 'inv', 'pickup', 'scanner', 'melee', 'psi', 'endUnit'];
  // ações sujeitas à reserva de UT (como no OpenXcom: andar, rodar, ajoelhar; ours: abrir porta)
  const RESERVE_CHECKED = { walk: 1, turn: 1, kneel: 1, door: 1 };
  const REASONS = ['noTU', 'reserved', 'noLOF', 'noAmmo', 'noEnergy', 'blocked', 'tooFar', 'notVisible', 'invalid',
    'tooHeavy', 'spotted', 'noWeapon', 'noMode', 'noTarget', 'noArc', 'notInHand', 'alreadyPrimed', 'loaded', 'slotFull', 'noRoom',
    'noCharges', 'noWound', 'cantKneel', 'notYourTurn', 'panicking', 'battleOver', 'notResearched', 'noDoor', 'noPsi', 'noRoute'];
  // eventos que mudam o que se vê (⇒ LOS.refreshAll)
  const CHANGES = { tile: 1, explosion: 1, death: 1, stun: 1, door: 1, fire: 1, smoke: 1, fall: 1, wake: 1, spawn: 1, zombify: 1, burnout: 1, itemsDestroyed: 1 };
  const ARC_CURVES = [3, 2, 1, 0]; // altura do arco = distância × c / 8 (do lançamento alto ao rasteiro)
  const MAX_REACTIONS = 64;

  // ---- utilitários -----------------------------------------------------------------------------------------
  function derived(B) {
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    return B._;
  }
  const conscious = (u) => !!u && LIVE[u.status] === 1;
  const active = (u) => conscious(u) && u.onMap && u.x >= 0;
  const hostile = (a, b) => (a === 'alien') !== (b === 'alien');
  const tileOf = (B, u) => (u && u.x >= 0 ? (u.z * B.map.h + u.y) * B.map.w + u.x : -1);
  const findUnit = (B, id) => (id === null || id === undefined ? null : BU().findUnit(B, id));
  const reasonKey = (r) => 'bs.' + r;

  // visível para o jogador: unidades X-COM sempre; as restantes pelo LOS
  function visOf(B, u) {
    if (!u) return false;
    if (u.side === 'xcom' || u.origSide === 'xcom') return true;
    return !!(OV.LOS && OV.LOS.isVisibleTo && OV.LOS.isVisibleTo(B, 'xcom', u));
  }
  function tileVis(B, i) {
    if (i < 0 || i >= B.map.n) return false;
    return !!((B._ && B._.visTiles && B._.visTiles[i]) || (B.map.disc[i] & 1));
  }
  function interrupt(B, u, reason, extra) {
    return Object.assign({ t: 'interrupt', reason, key: reasonKey(reason), unitId: u ? u.id : null, vis: u ? visOf(B, u) : false, pos: u ? tileOf(B, u) : -1 }, extra || {});
  }
  function fail(reason, extra) {
    return Object.assign({ ok: false, reason, key: reasonKey(reason), tu: 0, energy: 0 }, extra || {});
  }
  function setting(B, key) {
    if (B.settings && B.settings[key] !== undefined) return B.settings[key];
    if (key === 'instantGrenades') return !!tune('INSTANT_GRENADES_DEFAULT', true);
    return undefined;
  }
  function outcomeOf(B) {
    return OV.Battle && OV.Battle.outcome ? OV.Battle.outcome(B) : null;
  }
  const defOf = (it) => (it ? D().items[it.type] || null : null);
  const modeOf = (type, mode) => D().weaponModes(type).find((m) => m.mode === mode) || null;
  const handItem = (B, u, hand) => (hand === 'R' || hand === 'L' ? BU().item(B, u, hand) : null);

  function hasAmmo(it) {
    const def = defOf(it);
    if (!def) return false;
    if (Array.isArray(def.ammo) && def.ammo.length) return !!(it.ammo && it.ammo.rounds > 0);
    return def.power !== undefined;
  }
  // munição efetiva (carregador carregado ou a própria arma)
  function ammoDefOf(it) {
    const def = defOf(it);
    if (!def) return null;
    if (Array.isArray(def.ammo) && def.ammo.length) return it.ammo ? D().items[it.ammo.type] || null : null;
    return def;
  }
  // a X-COM só usa equipamento investigado (B.researched ou B.mission.researched; sem lista ⇒ tudo)
  function researched(B, u, type) {
    const list = B.researched || (B.mission && B.mission.researched);
    if (!u || u.origSide !== 'xcom' || !Array.isArray(list)) return true;
    const def = D().items[type];
    return !def || !def.research || list.indexOf(def.research) >= 0;
  }

  // ---- rotação ---------------------------------------------------------------------------------------------
  function turnSteps(from, to) {
    const s = (((to - from) % 8) + 8) % 8;
    return s <= 4 ? s : 8 - s;
  }
  // sentido como BattleUnit::turn do OpenXcom (meia-volta no sentido horário)
  function turnSign(from, to) {
    const a = to - from;
    if (a === 0) return 0;
    if (a > 0) return a <= 4 ? 1 : -1;
    return a > -4 ? -1 : 1;
  }
  // direção do centro de u para o centro de um retângulo (meios tiles)
  function faceDir(u, tx, ty, ts) {
    const dx = 2 * tx + (ts || 1) - (2 * u.x + (u.size || 1));
    const dy = 2 * ty + (ts || 1) - (2 * u.y + (u.size || 1));
    return dx === 0 && dy === 0 ? u.dir : U.dirTo(dx, dy);
  }
  const turnTU = (u, dir) => turnSteps(u.dir, dir) * tune('TU_TURN', 1);

  // distância entre retângulos de unidades/tiles ({x,y,z,size}); 0 = sobrepostos, 1 = adjacentes
  function rectGap(a, b) {
    const as = a.size || 1, bs = b.size || 1;
    const gx = Math.max(0, b.x - (a.x + as - 1), a.x - (b.x + bs - 1));
    const gy = Math.max(0, b.y - (a.y + as - 1), a.y - (b.y + bs - 1));
    return Math.max(gx, gy);
  }
  // alcance corpo a corpo: adjacente no mesmo nível, sem parede entre unidades 1×1
  function meleeReach(B, a, b) {
    if (a.z !== b.z || rectGap(a, b) !== 1) return false;
    if ((a.size || 1) > 1 || (b.size || 1) > 1) return true;
    const dir = U.dirTo(b.x - a.x, b.y - a.y);
    return !BM().edgeInfo(B.map, a.x, a.y, a.z, dir).blocked.move;
  }

  // ---- avistamentos ----------------------------------------------------------------------------------------
  // eventos 'spotted' a partir do resultado de LOS.fov/unitMoved do agente u
  function sightings(B, u, res) {
    const out = [];
    if (!res) return out;
    for (const id of res.spotted || []) {
      const t = findUnit(B, id);
      if (t) out.push({ t: 'spotted', unitId: id, by: u.id, side: u.side, vis: u.side === 'xcom', pos: tileOf(B, t) });
    }
    if (u.side !== 'xcom' && hostile('xcom', u.side) && res.newlyVisibleTo && res.newlyVisibleTo.indexOf('xcom') >= 0) {
      let by = null;
      for (const id of res.seenBy || []) {
        const v = findUnit(B, id);
        if (v && v.side === 'xcom') { by = v.id; break; }
      }
      out.push({ t: 'spotted', unitId: u.id, by, side: 'xcom', vis: true, pos: tileOf(B, u) });
    }
    return out;
  }
  // eventos 'spotted' de LOS.refreshAll (só os que o jogador passou a ver)
  function refreshSightings(B, res) {
    const out = [];
    const list = res && res.spotted && res.spotted.xcom ? res.spotted.xcom : [];
    for (const id of list) {
      const t = findUnit(B, id);
      if (t) out.push({ t: 'spotted', unitId: id, by: null, side: 'xcom', vis: true, pos: tileOf(B, t) });
    }
    return out;
  }
  /* Unidades avistadas por u neste turno (OpenXcom _unitsSpottedThisTurn): regista os hostis que vê agora;
     devolve quantos são novos (⇒ interrompe a marcha). */
  function newSpots(B, u) {
    if (!Array.isArray(u.spottedThisTurn)) u.spottedThisTurn = [];
    const sees = B._ && B._.sees ? B._.sees[u.id] : null;
    if (!sees) return 0;
    let n = 0;
    for (const id of Array.from(sees).sort((a, b) => a - b)) {
      if (u.spottedThisTurn.indexOf(id) >= 0) continue;
      const t = findUnit(B, id);
      if (!t || !conscious(t) || !hostile(u.side, t.side)) continue;
      u.spottedThisTurn.push(id);
      n++;
    }
    return n;
  }

  // explosões em cadeia pendentes e visão atualizada depois de um efeito
  function* settle(B, evs, force) {
    let changed = !!force;
    if (!changed) for (const e of evs || []) if (CHANGES[e.t]) { changed = true; break; }
    if (OV.Combat && B.pendingExplosions && B.pendingExplosions.length) {
      const pend = OV.Combat.resolvePendingExplosions(B);
      if (pend.length) changed = true;
      for (const e of pend) yield e;
    }
    if (changed && OV.LOS) for (const e of refreshSightings(B, OV.LOS.refreshAll(B))) yield e;
  }

  // roda u até dir, 45° de cada vez (charge: paga 1 UT por passo; interruptible: para ao avistar)
  function* turnTo(B, u, dir, o) {
    while (u.dir !== dir) {
      const from = u.dir;
      const to = (from + turnSign(from, dir) + 8) & 7;
      if (o.charge) {
        const c = tune('TU_TURN', 1);
        if ((u.tu | 0) < c) {
          yield interrupt(B, u, 'noTU');
          return false;
        }
        u.tu -= c;
      }
      u.dir = to;
      const res = OV.LOS ? OV.LOS.fov(B, u) : null;
      yield { t: 'turn', unitId: u.id, from, to, vis: visOf(B, u), pos: tileOf(B, u) };
      for (const e of sightings(B, u, res)) yield e;
      if (newSpots(B, u) && o.interruptible) {
        yield interrupt(B, u, 'spotted');
        return false;
      }
    }
    return true;
  }

  // ---- reserva de UT ---------------------------------------------------------------------------------------
  function mainFirearm(B, u) {
    for (const hand of ['R', 'L']) {
      const it = handItem(B, u, hand);
      const def = defOf(it);
      if (def && def.kind === 'firearm') return { it, hand };
    }
    return null;
  }
  /* reserva efetiva da X-COM: modo pedido (opts.mode ou B.reserve) na arma principal, Auto→Snap→Aimed quando a arma
     não tem o modo pedido, + joelho → {tu, mode: modo que conta de facto (null se nenhum tiro conta), asked, kneel} */
  function reserveInfo(B, u, opts) {
    const o = opts || {};
    const out = { tu: 0, mode: null, asked: 'none', kneel: 0 };
    if (!B || !u || u.side !== 'xcom') return out;
    const asked = o.mode || B.reserve || 'none';
    out.asked = asked;
    if (asked !== 'none') {
      const w = mainFirearm(B, u);
      if (w) {
        const cost = (m) => {
          if (!modeOf(w.it.type, m)) return 0;
          const c = BU().actionTU(B, u, w.it.id, m);
          return c > 0 ? c : 0;
        };
        let m = asked;
        if (m === 'auto' && !cost('auto')) m = 'snap';
        if (m === 'snap' && !cost('snap')) m = 'aimed';
        const c = cost(m);
        if (c > 0) {
          out.tu = c;
          out.mode = m;
        }
      }
    }
    // standing: a ação levanta a unidade (andar), por isso o joelho conta mesmo que ela esteja ajoelhada agora
    if (!o.noKneel && B.reserveKneel && (o.standing || !u.kneel) && BU().canKneel(u)) {
      out.kneel = tune('TU_KNEEL', 4);
      out.tu += out.kneel;
    }
    return out;
  }
  // UT reservadas para a X-COM (a soma de reserveInfo)
  function reserveTU(B, u, opts) {
    return reserveInfo(B, u, opts).tu;
  }
  function reserveFor(B, u, a) {
    if (!RESERVE_CHECKED[a.type] || a.desperate || a.panic || a.free) return 0;
    if (a.type === 'walk') return reserveTU(B, u, { standing: true });
    return reserveTU(B, u, a.type === 'kneel' && !u.kneel ? { noKneel: true } : null);
  }
  // a reserva só conta enquanto ainda se pode pagar (BattlescapeGame::checkReservedTU): com menos UT que a
  // reserva, a unidade anda/vira livremente
  const liveReserve = (u, reserve) => (reserve > 0 && reserve <= (u.tu | 0) ? reserve : 0);
  function tuReason(u, a, cost, reserve) {
    if (a.free) return null;
    if ((u.tu | 0) < cost) return 'noTU';
    const res = liveReserve(u, reserve);
    if (res > 0 && (u.tu | 0) - cost < res) return 'reserved';
    return null;
  }

  // ---- alvos -----------------------------------------------------------------------------------------------
  // {target:{unitId}|{i}|{voxel}} ou legado {targetId, targetI} → {kind, unit, i, x, y, z, ts, voxel}
  function parseTarget(B, u, a) {
    const m = B.map;
    const tg = a.target || {};
    const unitId = tg.unitId !== undefined ? tg.unitId : a.targetId;
    const i = tg.i !== undefined ? tg.i : a.targetI !== undefined ? a.targetI : a.toI;
    const voxel = Array.isArray(tg.voxel) ? tg.voxel : Array.isArray(a.voxel) ? a.voxel : null;
    if (unitId !== undefined && unitId !== null) {
      const t = findUnit(B, unitId);
      if (t && active(t) && t !== u) return { kind: 'unit', unit: t, i: tileOf(B, t), x: t.x, y: t.y, z: t.z, ts: t.size || 1, voxel: null };
      if (i === undefined || i === null) return null;
    }
    if (voxel) {
      const v = [voxel[0] | 0, voxel[1] | 0, voxel[2] | 0];
      const x = U.clamp(v[0] >> 4, 0, m.w - 1), y = U.clamp(v[1] >> 4, 0, m.h - 1), z = U.clamp(idiv(Math.max(0, v[2]), VZ), 0, m.d - 1);
      return { kind: 'voxel', unit: null, i: BM().idx(m, x, y, z), x, y, z, ts: 1, voxel: v };
    }
    if (typeof i === 'number' && i >= 0 && i < m.n) {
      const [x, y, z] = BM().xyz(m, i);
      return { kind: 'tile', unit: null, i, x, y, z, ts: 1, voxel: null };
    }
    return null;
  }
  const combatTarget = (tg) => (tg.unit ? tg.unit : tg.voxel ? tg.voxel : tg.i);
  const onOwnTiles = (B, u, i) => BU().unitTiles(u, B.map).indexOf(i) >= 0;

  // ---- arremesso -------------------------------------------------------------------------------------------
  function dropTile(m, i) {
    const j = BM().dropTarget(m, i);
    return j >= 0 ? j : i;
  }
  function floorVoxel(m, i) {
    const [x, y, z] = BM().xyz(m, i);
    return [x * VX + 8, y * VX + 8, z * VZ + 2];
  }
  function voxelTile(m, v) {
    const x = U.clamp(v[0] >> 4, 0, m.w - 1), y = U.clamp(v[1] >> 4, 0, m.h - 1);
    const z = U.clamp(idiv(Math.max(0, v[2]), VZ), 0, m.d - 1);
    return BM().idx(m, x, y, z);
  }
  /* Arco parabólico de from a to (voxels) com altura distância×curve/8 (limitada ao teto do mapa), traçado por
     segmentos de ≤ 8 voxels com LOS.traceShot. Colide com paredes, objetos, unidades e tetos: o item cai do último
     ponto livre; no chão fica onde bateu. → {arc:[voxel], land: tile, landVoxel} */
  function traceArc(B, u, from, to, curve) {
    const m = B.map;
    const hx = to[0] - from[0], hy = to[1] - from[1], hz = to[2] - from[2];
    const dist = U.isqrt(hx * hx + hy * hy);
    const top = (m.ceiling ? 1 : m.d) * VZ - 2;
    const apex = Math.max(0, Math.min(idiv(dist * curve, 8), top - Math.max(from[2], to[2])));
    const N = Math.max(4, idiv(dist, 8) + 1);
    const arc = [from.slice()];
    let prev = from.slice();
    let landV = to.slice();
    // quem está no tile de destino não trava o arco: a granada cai-lhe aos pés (como no original)
    const goalTile = dropTile(m, voxelTile(m, to));
    const goalUnit = OV.Battle && OV.Battle.unitAt ? OV.Battle.unitAt(B, goalTile) : null;
    const ignore = goalUnit && (!u || goalUnit.id !== u.id) ? (u ? [u.id, goalUnit.id] : goalUnit.id) : (u ? u.id : null);
    for (let k = 1; k <= N; k++) {
      const p = [
        from[0] + idiv(hx * k, N), from[1] + idiv(hy * k, N),
        from[2] + idiv(hz * k, N) + idiv(4 * apex * k * (N - k), N * N),
      ];
      const hit = OV.LOS.traceShot(B, prev, p, ignore, 0);
      if (hit.kind === 'none') {
        arc.push(p);
        prev = p;
        continue;
      }
      const falling = p[2] <= prev[2];
      // objeto baixo (seara, caixote) ou unidade no próprio tile de destino: o item fica nesse tile
      if (falling && (hit.kind === 'object' || hit.kind === 'unit') && dropTile(m, hit.i) === goalTile) {
        arc.push(hit.voxel.slice());
        landV = to.slice();
        break;
      }
      landV = hit.kind === 'floor' && falling ? hit.voxel.slice() : prev.slice();
      arc.push(hit.voxel.slice());
      break;
    }
    return { arc, land: dropTile(m, voxelTile(m, landV)), landVoxel: landV };
  }
  // primeiro arco (do mais alto ao mais rasteiro) que chega ao tile pretendido → {curve, origin, target, goal} | null
  function planArc(B, u, toI) {
    const m = B.map;
    const goal = dropTile(m, toI);
    const target = floorVoxel(m, goal);
    const origin = OV.LOS.originVoxel(B, u, target);
    for (const c of ARC_CURVES) {
      if (traceArc(B, u, origin, target, c).land === goal) return { curve: c, origin, target, goal };
    }
    return null;
  }

  // ---- detetor de movimento --------------------------------------------------------------------------------
  // blips: unidades de outros lados com pontos de movimento ≠ 0 num quadrado de ±SCANNER_RANGE (todos os níveis)
  function scannerBlips(B, u) {
    const R = tune('SCANNER_RANGE', 10);
    const per = tune('MOTION_PER_STEP', 30);
    const out = [];
    for (const t of B.units) {
      if (t === u || t.side === u.side || t.status === 'dead' || !t.onMap || !(t.motion > 0)) continue;
      if (Math.abs(t.x - u.x) > R || Math.abs(t.y - u.y) > R) continue;
      out.push({ i: tileOf(B, t), x: t.x, y: t.y, z: t.z, size: U.clamp(idiv(t.motion + per - 1, per), 1, 6) });
    }
    out.sort((a, b) => a.i - b.i);
    return out;
  }

  // ---- fogo de reação (§3.10, REA §5) ----------------------------------------------------------------------
  const reactionScore = (u) => idiv((u.stats.react | 0) * Math.max(0, u.tu | 0), Math.max(1, u.stats.tu | 0));

  // tipo de reação possível de r contra o mover: corpo a corpo (adjacente e virado) ou tiro rápido
  function reactionKind(B, r, mover) {
    for (const hand of ['R', 'L']) {
      const it = handItem(B, r, hand);
      const def = defOf(it);
      if (!def || def.kind !== 'melee' || !modeOf(it.type, 'melee')) continue;
      const cost = BU().actionTU(B, r, it.id, 'melee');
      if (cost === null || (r.tu | 0) <= cost || !researched(B, r, it.type)) continue;
      if (meleeReach(B, r, mover) && r.dir === faceDir(r, mover.x, mover.y, mover.size)) return { kind: 'melee', item: it, hand, mode: 'melee', cost };
    }
    for (const hand of ['R', 'L']) {
      const it = handItem(B, r, hand);
      const def = defOf(it);
      if (!def || def.kind !== 'firearm' || !modeOf(it.type, 'snap') || !hasAmmo(it) || !researched(B, r, it.type)) continue;
      const cost = BU().actionTU(B, r, it.id, 'snap');
      if (cost === null || (r.tu | 0) <= cost) continue;
      // os alienígenas não disparam explosivos que apanhem amigos (ou a si próprios)
      const ad = ammoDefOf(it);
      if (r.side === 'alien' && ad && (ad.radius | 0) > 0) {
        const R = ad.radius | 0;
        const near = B.units.some((f) => f.side === 'alien' && active(f) && f.z === mover.z && rectGap(f, mover) <= R);
        if (near) continue;
      }
      if (!OV.LOS.targetVoxel(B, r, mover)) continue;
      return { kind: 'snap', item: it, hand, mode: 'snap', cost };
    }
    return null;
  }
  function seesMover(B, r, mover) {
    const sees = B._ && B._.sees ? B._.sees[r.id] : null;
    if (sees) {
      if (sees.has(mover.id)) return true;
    } else if (OV.LOS.inView(B, r, mover)) return true;
    // atingido pelo mover neste turno: reage mesmo fora do cone, se o vir
    const hitBy = r.ai && Array.isArray(r.ai.wasHitBy) ? r.ai.wasHitBy : [];
    return hitBy.indexOf(mover.id) >= 0 && OV.LOS.canSee(B, r, mover);
  }
  /* pontuação do reator truncada (int bestScore do OpenXcom) contra a do mover exata (double):
     reage sse sc ≥ Reações·UT/UTbase do mover, em inteiros por multiplicação cruzada */
  const beatsMover = (sc, mover) => sc * Math.max(1, mover.stats.tu | 0) >= (mover.stats.react | 0) * Math.max(0, mover.tu | 0);
  function bestReactor(B, mover) {
    const R2 = tune('VIEW_DIST', 20) * tune('VIEW_DIST', 20);
    let best = null;
    for (const r of B.units) {
      if (!active(r) || r.status === 'panic' || r.side === 'civ' || !hostile(r.side, mover.side)) continue;
      const dx = r.x - mover.x, dy = r.y - mover.y;
      if (dx * dx + dy * dy > R2) continue;
      const sc = reactionScore(r);
      if (!beatsMover(sc, mover) || (best && sc <= best.score)) continue;
      if (!seesMover(B, r, mover)) continue;
      const k = reactionKind(B, r, mover);
      if (k) best = Object.assign(k, { unit: r, score: sc });
    }
    return best;
  }
  function* reactionAttack(B, r, mover, pick) {
    const dir = faceDir(r, mover.x, mover.y, mover.size);
    if (r.dir !== dir) {
      const from = r.dir;
      r.dir = dir; // a rotação da reação não custa UT (UnitTurnBState sem cobrança)
      if (OV.LOS) OV.LOS.fov(B, r);
      yield { t: 'turn', unitId: r.id, from, to: dir, vis: visOf(B, r), pos: tileOf(B, r) };
    }
    r.tu -= pick.cost;
    const evs = pick.kind === 'melee'
      ? OV.Combat.resolveMelee(B, r, pick.item.id, mover, B.rng.combat)
      : OV.Combat.resolveShot(B, r, pick.item.id, 'snap', mover, B.rng.combat);
    for (const e of evs) yield e;
    yield* settle(B, evs);
  }
  /* Ciclo de reação depois de um passo/ajoelhar/tiro do lado ativo: o melhor observador hostil (pontuação
     Reações × UT/UT base ≥ a do mover) reage; recalcula depois de cada reação. Nunca no turno dos civis. */
  function* reactions(B, moverRef) {
    derived(B);
    const mover = typeof moverRef === 'object' ? moverRef : findUnit(B, moverRef);
    if (!mover || !OV.LOS || !OV.Combat || B.side === 'civ' || mover.side !== B.side) return 0;
    let n = 0;
    for (let k = 0; k < MAX_REACTIONS; k++) {
      if (!active(mover) || outcomeOf(B)) break;
      const pick = bestReactor(B, mover);
      if (!pick) break;
      n++;
      const r = pick.unit;
      yield { t: 'reaction', reactorId: r.id, targetId: mover.id, mode: pick.mode, vis: visOf(B, r) || visOf(B, mover), pos: tileOf(B, r) };
      if (r.side === 'xcom' && r.type === 'soldier' && OV.Morale) OV.Morale.gainExp(r, 'react');
      yield* reactionAttack(B, r, mover, pick);
    }
    return n;
  }

  // ---- validação por tipo ----------------------------------------------------------------------------------
  const V = {};
  const P = {};

  // -- andar
  function simulatePath(B, u, steps, run) {
    let cur = tileOf(B, u);
    const tiles = [], tus = [];
    let tu = 0, energy = 0;
    for (const dir of steps) {
      const s = OV.Path.stepCost(B, u, cur, dir, { run });
      if (!s) break;
      tu += s.tu;
      energy += s.energy;
      tiles.push(s.to);
      tus.push(tu);
      cur = s.to;
    }
    return { steps: steps.slice(0, tiles.length), tiles, tus, tu, energy };
  }
  V.walk = function (B, u, a) {
    const m = B.map;
    if (typeof a.to !== 'number' || a.to < 0 || a.to >= m.n) return fail('invalid');
    const from = tileOf(B, u);
    if (a.to === from) return fail('invalid');
    if (!OV.Path) return fail('blocked');
    const run = !!a.run;
    const path = Array.isArray(a.path) ? simulatePath(B, u, a.path, run) : OV.Path.find(B, u, a.to, null, { run });
    if (!path || !path.steps.length) return fail('blocked');
    const first = OV.Path.stepCost(B, u, from, path.steps[0], { run });
    if (!first) return fail('blocked');
    const stand = u.kneel ? tune('TU_STAND', 8) : 0;
    const reserve = reserveFor(B, u, a);
    const r = tuReason(u, a, stand + first.tu, reserve);
    if (r) return fail(r, { tu: stand + path.tu, energy: path.energy });
    if (!a.free && (u.energy | 0) < first.energy) return fail('noEnergy', { tu: stand + path.tu, energy: path.energy });
    const tu = stand + path.tu;
    return {
      ok: true, tu, energy: path.energy, steps: path.steps.slice(), tiles: path.tiles.slice(), stand, reserve,
      full: tu <= (u.tu | 0) - liveReserve(u, reserve) && path.energy <= (u.energy | 0),
    };
  };
  P.walk = function* (B, u, a, v) {
    const run = !!a.run;
    const desperate = !!(a.desperate || a.panic);
    const reserve = desperate ? 0 : reserveTU(B, u, { standing: true });
    newSpots(B, u); // quem já vê agora não interrompe
    if (u.kneel) {
      const c = tune('TU_STAND', 8);
      if (!a.free && (u.tu | 0) < c) {
        yield interrupt(B, u, 'noTU');
        return { ok: false, reason: 'noTU' };
      }
      if (!a.free) u.tu -= c;
      u.kneel = false;
      const res = OV.LOS ? OV.LOS.unitMoved(B, u) : null;
      yield { t: 'kneel', unitId: u.id, down: false, vis: visOf(B, u), pos: tileOf(B, u) };
      for (const e of sightings(B, u, res)) yield e;
      newSpots(B, u);
      yield* reactions(B, u);
      if (!active(u) || outcomeOf(B)) return { ok: false, reason: 'stopped' };
    }
    let cur = tileOf(B, u);
    let moved = 0;
    for (const dir of v.steps) {
      const s = OV.Path.stepCost(B, u, cur, dir, { run });
      if (!s || s.occupant !== null) {
        yield interrupt(B, u, 'blocked');
        return { ok: false, reason: 'blocked', moved };
      }
      const r = tuReason(u, a, s.tu, reserve);
      if (r) {
        yield interrupt(B, u, r);
        return { ok: false, reason: r, moved };
      }
      if (!a.free && (u.energy | 0) < s.energy) {
        yield interrupt(B, u, 'noEnergy');
        return { ok: false, reason: 'noEnergy', moved };
      }
      // portas no caminho abrem-se sozinhas (UT da porta já incluídas no passo)
      let doorEvs = [];
      if (s.door && OV.Env) doorEvs = OV.Env.openDoor(B, u, s.door.i, s.door.part);
      if (s.opensUfoDoor !== null && s.opensUfoDoor !== undefined && OV.Env) doorEvs = doorEvs.concat(OV.Env.openDoor(B, u, s.opensUfoDoor, 3));
      for (const e of doorEvs) yield e;
      if (doorEvs.length && OV.LOS) for (const e of refreshSightings(B, OV.LOS.refreshAll(B))) yield e;
      if (!a.free) {
        u.tu -= s.tu;
        u.energy -= s.energy;
      }
      if (dir < 8) u.dir = dir;
      const visBefore = visOf(B, u);
      let res;
      if (s.fall) {
        BU().placeUnit(B, u, s.via);
        yield { t: 'step', unitId: u.id, from: cur, to: s.via, dir, kind: s.kind, vis: visBefore || tileVis(B, s.via), pos: s.via };
        const fromZ = u.z;
        BU().placeUnit(B, u, s.to);
        u.float = !!s.float;
        res = OV.LOS ? OV.LOS.unitMoved(B, u) : null;
        yield { t: 'fall', unitId: u.id, itemId: null, from: s.via, to: s.to, fromZ, toZ: u.z, vis: visBefore || visOf(B, u), pos: s.to };
      } else {
        BU().placeUnit(B, u, s.to);
        u.float = !!s.float;
        res = OV.LOS ? OV.LOS.unitMoved(B, u) : null;
        yield { t: 'step', unitId: u.id, from: cur, to: s.to, dir, kind: s.kind, vis: visBefore || visOf(B, u), pos: s.to };
      }
      u.motion = (u.motion | 0) + tune('MOTION_PER_STEP', 30);
      moved++;
      for (const e of sightings(B, u, res)) yield e;
      const grew = newSpots(B, u);
      yield* reactions(B, u);
      if (!active(u)) return { ok: false, reason: 'stopped', moved };
      if (outcomeOf(B)) return { ok: true, moved };
      if (grew && !desperate) {
        yield interrupt(B, u, 'spotted');
        return { ok: false, reason: 'spotted', moved };
      }
      cur = tileOf(B, u);
    }
    return { ok: true, moved };
  };

  // -- rodar
  function turnTarget(B, u, a) {
    if (typeof a.dir === 'number' && a.dir >= 0 && a.dir <= 7) return a.dir | 0;
    if (typeof a.toI === 'number' && a.toI >= 0 && a.toI < B.map.n) {
      const [x, y] = BM().xyz(B.map, a.toI);
      return faceDir(u, x, y, 1);
    }
    return -1;
  }
  V.turn = function (B, u, a) {
    const dir = turnTarget(B, u, a);
    if (dir < 0 || dir === u.dir) return fail('invalid');
    const tu = turnTU(u, dir);
    const r = tuReason(u, a, tu, reserveFor(B, u, a));
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, dir };
  };
  P.turn = function* (B, u, a, v) {
    newSpots(B, u);
    const done = yield* turnTo(B, u, v.dir, { charge: !a.free, interruptible: !a.desperate });
    return done ? { ok: true } : { ok: false, reason: 'spotted' };
  };

  // -- ajoelhar / levantar
  V.kneel = function (B, u, a) {
    if (!BU().canKneel(u)) return fail('cantKneel');
    const tu = u.kneel ? tune('TU_STAND', 8) : tune('TU_KNEEL', 4);
    const r = tuReason(u, a, tu, reserveFor(B, u, a));
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, down: !u.kneel };
  };
  P.kneel = function* (B, u, a, v) {
    if (!a.free) u.tu -= v.tu;
    u.kneel = v.down;
    const res = OV.LOS ? OV.LOS.unitMoved(B, u) : null;
    yield { t: 'kneel', unitId: u.id, down: u.kneel, vis: visOf(B, u), pos: tileOf(B, u) };
    for (const e of sightings(B, u, res)) yield e;
    newSpots(B, u);
    yield* reactions(B, u);
    return { ok: true };
  };

  /* ours: o clarão do disparo ilumina o tile do atirador (MUZZLE_FLASH_LIGHT) até ao início do próximo turno do seu lado,
     se lá estiver escuro: quem dispara de noite deixa de ser um atirador invisível. B.flashes = [{i, side}].
     → true se acendeu uma luz nova (a visão tem de ser refeita) */
  function muzzleFlash(B, u) {
    const p = tune('MUZZLE_FLASH_LIGHT', 0) | 0;
    const i = tileOf(B, u);
    if (p <= 0 || i < 0 || !OV.LOS || OV.LOS.shadeAt(B, i) <= tune('DARK_SHADE', 9)) return false;
    if (!Array.isArray(B.flashes)) B.flashes = [];
    if (B.flashes.some((f) => f.i === i)) return false;
    B.flashes.push({ i, side: u.side });
    if (B._ && B._.dirty) B._.dirty.light = true;
    return true;
  }

  // -- disparar
  V.shoot = function (B, u, a) {
    const hand = a.hand === 'L' ? 'L' : a.hand === 'R' ? 'R' : (mainFirearm(B, u) || { hand: 'R' }).hand;
    const it = handItem(B, u, hand);
    const def = defOf(it);
    if (!def) return fail('noWeapon');
    if (a.mode === 'melee' || def.kind === 'melee') {
      const tg = parseTarget(B, u, a);
      return V.melee(B, u, Object.assign({}, a, { type: 'melee', hand, targetId: tg && tg.unit ? tg.unit.id : null }));
    }
    if (def.kind !== 'firearm') return fail('noWeapon');
    if (!researched(B, u, it.type)) return fail('notResearched');
    const mode = a.mode || 'snap';
    if (!modeOf(it.type, mode)) return fail('noMode');
    if (!hasAmmo(it)) return fail('noAmmo');
    const tg = parseTarget(B, u, a);
    if (!tg) return fail('noTarget');
    if (!tg.unit && onOwnTiles(B, u, tg.i)) return fail('invalid');
    if (tg.unit && !a.force && OV.LOS && !OV.LOS.isVisibleTo(B, u.side, tg.unit)) return fail('notVisible');
    const action = BU().actionTU(B, u, it.id, mode);
    if (action === null) return fail('noMode');
    const dir = faceDir(u, tg.x, tg.y, tg.ts);
    const turn = turnTU(u, dir);
    const tu = action + turn;
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    // bomba guiada (Lançador Blaster): voa pela rota de Path.flyRoute, por isso só falha sem rota, não sem linha de tiro
    let route = null;
    if (def.guided) {
      route = OV.Path && OV.Path.flyRoute ? OV.Path.flyRoute(B, tileOf(B, u), tg.i, { side: u.side }) : null;
      if (!route && !a.force) return fail('noRoute', { tu });
    } else if (!a.force && !tg.voxel && OV.LOS && !OV.LOS.targetVoxel(B, u, tg.unit || tg.i)) return fail('noLOF', { tu });
    return {
      ok: true, tu, energy: 0, actionTU: action, turnTU: turn, dir, hand, itemId: it.id, mode, route,
      accuracy: OV.Combat ? OV.Combat.accuracy(B, u, it.id, mode, { berserk: !!a.berserk }) : 0,
    };
  };
  P.shoot = function* (B, u, a, v) {
    if (v.type === 'melee') return yield* P.melee(B, u, a, v);
    yield* turnTo(B, u, v.dir, { charge: !a.free, interruptible: false });
    const tg = parseTarget(B, u, a);
    if (!tg || !active(u)) return { ok: false, reason: 'noTarget' };
    if (!a.free) u.tu -= v.actionTU;
    const evs = OV.Combat.resolveShot(B, u, v.itemId, v.mode, combatTarget(tg), B.rng.combat, { berserk: !!a.berserk });
    for (const e of evs) yield e;
    yield* settle(B, evs, muzzleFlash(B, u));
    if (!a.reaction) yield* reactions(B, u);
    return { ok: true };
  };

  // -- corpo a corpo
  function meleeWeapon(B, u, a) {
    const hands = a.hand === 'R' || a.hand === 'L' ? [a.hand] : ['R', 'L'];
    for (const hand of hands) {
      const it = handItem(B, u, hand);
      if (it && modeOf(it.type, 'melee')) return { it, hand };
    }
    return null;
  }
  V.melee = function (B, u, a) {
    const w = meleeWeapon(B, u, a);
    if (!w) return fail('noWeapon');
    if (!researched(B, u, w.it.type)) return fail('notResearched');
    const tg = findUnit(B, a.targetId !== undefined ? a.targetId : a.target && a.target.unitId);
    if (!tg || !active(tg) || tg === u) return fail('noTarget');
    if (!meleeReach(B, u, tg)) return fail('tooFar');
    const action = BU().actionTU(B, u, w.it.id, 'melee');
    if (action === null) return fail('noMode');
    const dir = faceDir(u, tg.x, tg.y, tg.size);
    const tu = action + turnTU(u, dir);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, type: 'melee', tu, energy: 0, actionTU: action, dir, hand: w.hand, itemId: w.it.id, targetId: tg.id, mode: 'melee' };
  };
  P.melee = function* (B, u, a, v) {
    yield* turnTo(B, u, v.dir, { charge: !a.free, interruptible: false });
    const tg = findUnit(B, v.targetId);
    if (!active(u) || !tg || !active(tg)) return { ok: false, reason: 'noTarget' };
    if (!a.free) u.tu -= v.actionTU;
    const evs = OV.Combat.resolveMelee(B, u, v.itemId, tg, B.rng.combat, { berserk: !!a.berserk });
    for (const e of evs) yield e;
    yield* settle(B, evs);
    if (!a.reaction) yield* reactions(B, u);
    return { ok: true };
  };

  // -- lançar
  V.throw = function (B, u, a) {
    const m = B.map;
    const it = BU().findItem(B, a.itemId);
    const slot = it ? BU().slotOf(u, it.id) : null;
    if (!it || (slot !== 'R' && slot !== 'L')) return fail('notInHand');
    const def = defOf(it);
    if (!def || def.fixed) return fail('invalid');
    if (!researched(B, u, it.type)) return fail('notResearched');
    if (typeof a.toI !== 'number' || a.toI < 0 || a.toI >= m.n) return fail('invalid');
    const [tx, ty, tz] = BM().xyz(m, a.toI);
    const w = (def.weight | 0) + (it.ammo && D().items[it.ammo.type] ? D().items[it.ammo.type].weight | 0 : 0);
    const range = D().throwRange(u.stats.str | 0, w);
    const dx = tx - u.x, dy = ty - u.y, dz = idiv((tz - u.z) * 3, 2);
    const dist = U.isqrt(dx * dx + dy * dy + dz * dz);
    if (dist > range) return fail('tooFar', { range, dist });
    const action = BU().actionTU(B, u, it.id, 'throw');
    const dir = tx === u.x && ty === u.y ? u.dir : faceDir(u, tx, ty, 1);
    const tu = action + turnTU(u, dir);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu, range, dist });
    const plan = planArc(B, u, a.toI);
    if (!plan) return fail('noArc', { tu, range, dist });
    return {
      ok: true, tu, energy: 0, actionTU: action, dir, range, dist, curve: plan.curve, land: plan.goal,
      accuracy: OV.Combat ? OV.Combat.accuracy(B, u, it.id, 'throw') : 0,
    };
  };
  P.throw = function* (B, u, a, v) {
    const m = B.map;
    yield* turnTo(B, u, v.dir, { charge: !a.free, interruptible: false });
    const it = BU().findItem(B, a.itemId);
    if (!active(u) || !it || it.owner !== u.id) return { ok: false, reason: 'notInHand' };
    if (!a.free) u.tu -= v.actionTU;
    const def = defOf(it);
    const goal = dropTile(m, a.toI);
    const target = floorVoxel(m, goal);
    const origin = OV.LOS.originVoxel(B, u, target);
    // desvio do arremesso (mesmo modelo inteiro dos tiros, só no plano)
    const acc = OV.Combat.accuracy(B, u, it.id, 'throw');
    const dev = OV.Combat.deviate(B.rng.combat, origin, target, acc);
    const aim = [U.clamp(dev[0], 0, m.w * VX - 1), U.clamp(dev[1], 0, m.h * VX - 1), target[2]];
    const tr = traceArc(B, u, origin, aim, v.curve);
    BU().takeFromUnit(u, it.id);
    it.owner = null;
    it.at = tr.land;
    if (OV.Morale) OV.Morale.gainExp(u, 'thr');
    yield {
      t: 'throw', unitId: u.id, itemId: it.id, type: it.type, arc: tr.arc, land: tr.land, from: origin, to: tr.arc[tr.arc.length - 1].slice(),
      vis: visOf(B, u) || tileVis(B, tr.land), pos: tileOf(B, u),
    };
    let evs = [];
    // granada com espoleta 0 rebenta ao aterrar com «Granadas instantâneas»
    if (def.kind === 'grenade' && it.fuse === 0 && !def.proximity && setting(B, 'instantGrenades')) {
      const [x, y, z] = BM().xyz(m, tr.land);
      BU().deleteItem(B, it.id);
      evs = OV.Combat.explode(B, [x * VX + 8, y * VX + 8, z * VZ + 2], def.power | 0, def.dmg, def.radius | 0, u.id, { rng: B.rng.combat, cause: 'grenade' });
      for (const e of evs) yield e;
    }
    yield* settle(B, evs, true);
    if (!a.reaction) yield* reactions(B, u);
    return { ok: true, land: tr.land };
  };

  // -- ativar granada
  V.prime = function (B, u, a) {
    const it = BU().findItem(B, a.itemId);
    const slot = it ? BU().slotOf(u, it.id) : null;
    if (!it || (slot !== 'R' && slot !== 'L')) return fail('notInHand');
    const def = defOf(it);
    if (!def || def.kind !== 'grenade' || !def.prime) return fail('invalid');
    if (!researched(B, u, it.type)) return fail('notResearched');
    if (it.fuse >= 0) return fail('alreadyPrimed');
    const fuse = a.fuse === undefined || a.fuse === null ? 0 : a.fuse;
    if (fuse !== (fuse | 0) || fuse < 0 || fuse > tune('GRENADE_FUSE_MAX', 5)) return fail('invalid');
    const tu = BU().actionTU(B, u, it.id, 'prime');
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, fuse };
  };
  P.prime = function* (B, u, a, v) {
    const it = BU().findItem(B, a.itemId);
    if (!a.free) u.tu -= v.tu;
    it.fuse = v.fuse;
    it.primedBy = u.id;
    yield { t: 'prime', unitId: u.id, itemId: it.id, fuse: it.fuse, vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true };
  };

  // -- recarregar
  function findClip(B, u, weapon, clipId, hand) {
    const def = defOf(weapon);
    const ok = (c) => c && def.ammo.indexOf(c.type) >= 0 && c.owner === u.id;
    if (clipId !== undefined && clipId !== null) {
      const c = BU().findItem(B, clipId);
      return ok(c) && c.id !== weapon.id ? c : null;
    }
    for (const s of ['belt', 'pack']) {
      const c = BU().item(B, u, s).find(ok);
      if (c) return c;
    }
    const other = handItem(B, u, hand === 'R' ? 'L' : 'R');
    return ok(other) ? other : null;
  }
  V.reload = function (B, u, a) {
    const hand = a.hand === 'L' ? 'L' : 'R';
    const it = handItem(B, u, hand);
    const def = defOf(it);
    if (!def || def.kind !== 'firearm') return fail('noWeapon');
    if (!Array.isArray(def.ammo) || !def.ammo.length) return fail('invalid');
    if (it.ammo && it.ammo.rounds > 0) return fail('loaded');
    const clip = findClip(B, u, it, a.clipId, hand);
    if (!clip) return fail('noAmmo');
    const tu = tune('TU_RELOAD', 15);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, hand, itemId: it.id, clipId: clip.id };
  };
  P.reload = function* (B, u, a, v) {
    const it = BU().findItem(B, v.itemId);
    const clip = BU().findItem(B, v.clipId);
    if (!a.free) u.tu -= v.tu;
    it.ammo = { type: clip.type, rounds: clip.rounds === null || clip.rounds === undefined ? D().items[clip.type].rounds : clip.rounds };
    BU().deleteItem(B, clip.id);
    yield { t: 'reload', unitId: u.id, hand: v.hand, itemId: it.id, clipId: v.clipId, ammo: it.ammo.type, rounds: it.ammo.rounds, vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true };
  };

  // -- descarregar (orig/OpenXcom: 8 UT): o carregador sai da arma para a outra mão, que tem de estar livre
  V.unload = function (B, u, a) {
    const hand = a.hand === 'L' ? 'L' : 'R';
    const it = handItem(B, u, hand);
    const def = defOf(it);
    if (!def || def.kind !== 'firearm') return fail('noWeapon');
    if (!Array.isArray(def.ammo) || !def.ammo.length) return fail('invalid');
    if (!it.ammo || !(it.ammo.rounds > 0) || !D().items[it.ammo.type]) return fail('noAmmo');
    const other = hand === 'R' ? 'L' : 'R';
    if (u.items[other] !== null) return fail('slotFull');
    const tu = tune('TU_UNLOAD', 8);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, hand, other, itemId: it.id };
  };
  P.unload = function* (B, u, a, v) {
    const it = BU().findItem(B, v.itemId);
    if (!a.free) u.tu -= v.tu;
    const clip = BU().newItem(B, it.ammo.type, { rounds: it.ammo.rounds });
    it.ammo = null;
    BU().giveItem(B, u, clip.id, v.other);
    yield { t: 'unload', unitId: u.id, hand: v.hand, to: v.other, itemId: it.id, clipId: clip.id, ammo: clip.type, rounds: clip.rounds, vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true, clipId: clip.id };
  };

  // -- abrir porta sem entrar
  // tiles de cada lado da aresta da porta (parte 1 = parede oeste de i, 2 = parede norte; 3 = porta OVNI no tile i)
  function doorSides(m, i, part) {
    const [x, y, z] = BM().xyz(m, i);
    if (part === 1) return [[x, y, z], [x - 1, y, z]];
    if (part === 2) return [[x, y, z], [x, y - 1, z]];
    return [[x, y - 1, z], [x + 1, y, z], [x, y + 1, z], [x - 1, y, z]];
  }
  function doorPart(m, i, part) {
    if (part === 1 || part === 2 || part === 3) return part;
    if (BM().isUfoDoor(m, i)) return 3;
    for (const p of [1, 2]) {
      const d = BM().def(m, i, p);
      if (d && d.door === 'swing') return p;
    }
    return -1;
  }
  V.door = function (B, u, a) {
    const m = B.map;
    if (typeof a.i !== 'number' || a.i < 0 || a.i >= m.n) return fail('invalid');
    const part = doorPart(m, a.i, a.part);
    if (part < 0) return fail('noDoor');
    if (part === 3) {
      if (!BM().isUfoDoor(m, a.i)) return fail('noDoor');
      if (BM().isDoorOpen(m, a.i, 3)) return fail('invalid');
    } else {
      const d = BM().def(m, a.i, part);
      if (!d || d.door !== 'swing') return fail('noDoor');
      if (d.open || !d.alt) return fail('invalid');
      if ((u.size || 1) > 1) return fail('invalid');
    }
    const [dx, dy, dz] = BM().xyz(m, a.i);
    const mine = BU().unitTiles(u, m);
    let face = -1;
    if (part === 3) {
      for (const [x, y, z] of doorSides(m, a.i, 3)) {
        if (BM().inB(m, x, y, z) && mine.indexOf(BM().idx(m, x, y, z)) >= 0) face = faceDir(u, dx, dy, 1);
      }
    } else {
      const [inside, outside] = doorSides(m, a.i, part);
      if (mine.indexOf(BM().idx(m, inside[0], inside[1], inside[2])) >= 0) face = part === 1 ? 6 : 0;
      else if (BM().inB(m, outside[0], outside[1], outside[2]) && mine.indexOf(BM().idx(m, outside[0], outside[1], outside[2])) >= 0) face = part === 1 ? 2 : 4;
    }
    if (face < 0 || dz !== u.z) return fail('tooFar');
    const tu = tune('TU_DOOR', 4) + turnTU(u, face);
    const r = tuReason(u, a, tu, reserveFor(B, u, a));
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, part, dir: face };
  };
  P.door = function* (B, u, a, v) {
    if (!(yield* turnTo(B, u, v.dir, { charge: !a.free, interruptible: false }))) return { ok: false, reason: 'noTU' };
    if (!a.free) u.tu -= tune('TU_DOOR', 4);
    const evs = OV.Env.openDoor(B, u, a.i, v.part);
    for (const e of evs) yield e;
    yield* settle(B, evs, true);
    return { ok: true };
  };

  // -- kit médico
  // posição do paciente: a própria unidade ou o corpo (inconsciente) no chão
  function patientRect(B, t) {
    if (active(t)) return { x: t.x, y: t.y, z: t.z, size: t.size || 1 };
    if (t.status !== 'out') return null;
    const body = B.items.find((it) => it.unitId === t.id && it.at !== null && it.at !== undefined);
    if (!body) return null;
    const [x, y, z] = BM().xyz(B.map, body.at);
    return { x, y, z, size: 1 };
  }
  V.medikit = function (B, u, a) {
    let it = a.itemId !== undefined ? BU().findItem(B, a.itemId) : null;
    if (!it) it = ['R', 'L'].map((h) => handItem(B, u, h)).find((x) => x && defOf(x).kind === 'medikit') || null;
    const slot = it ? BU().slotOf(u, it.id) : null;
    if (!it || (slot !== 'R' && slot !== 'L')) return fail('notInHand');
    const def = defOf(it);
    if (!def || def.kind !== 'medikit') return fail('invalid');
    if (!researched(B, u, it.type)) return fail('notResearched');
    const t = a.targetId === undefined || a.targetId === null ? u : findUnit(B, a.targetId);
    if (!t || t.status === 'dead') return fail('noTarget');
    const rect = patientRect(B, t);
    if (!rect) return fail('noTarget');
    if (t !== u && (rect.z !== u.z || rectGap(u, rect) > 1)) return fail('tooFar');
    const kind = a.kind === 'stim' || a.kind === 'pain' ? a.kind : a.kind === 'heal' || a.kind === undefined ? 'heal' : null;
    if (!kind) return fail('invalid');
    if (!it.charges || !(it.charges[kind] > 0)) return fail('noCharges');
    let part = a.part;
    if (kind === 'heal') {
      if (part === undefined || part === null) part = t.wounds.findIndex((w) => w > 0);
      if (!(part >= 0 && part <= 5)) return fail('noWound');
      if (!(t.wounds[part] > 0)) return fail('noWound');
    }
    const tu = def.useTU || tune('TU_MEDIKIT', 10);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, itemId: it.id, targetId: t.id, kind, part: kind === 'heal' ? part : null };
  };
  P.medikit = function* (B, u, a, v) {
    const it = BU().findItem(B, v.itemId);
    const def = defOf(it);
    const t = findUnit(B, v.targetId);
    if (!a.free) u.tu -= v.tu;
    it.charges[v.kind]--;
    const extra = [];
    if (v.kind === 'heal') {
      t.wounds[v.part] = Math.max(0, t.wounds[v.part] - (def.healWounds || 1));
      t.hp = Math.min(t.hpMax, t.hp + (def.healHP || tune('MEDIKIT_HEAL_HP', 3)));
    } else if (v.kind === 'stim') {
      t.energy = Math.min(t.stats.sta | 0, (t.energy | 0) + (def.stimEnergy || tune('MEDIKIT_STIM_ENERGY', 10)));
      t.stun = Math.max(0, (t.stun | 0) - (def.stimStun || tune('MEDIKIT_STIM_STUN', 4)));
      if (t.status === 'out' && t.stun < t.hp && OV.Env) for (const e of OV.Env.wake(B, t)) extra.push(e);
    } else if (OV.Morale) {
      for (const e of OV.Morale.painkiller(B, t)) extra.push(e);
    }
    yield {
      t: 'medikit', unitId: u.id, targetId: t.id, itemId: it.id, kind: v.kind, part: v.part, hp: t.hp, wounds: v.part === null ? null : t.wounds[v.part],
      energy: t.energy, stun: t.stun, morale: t.morale, charges: it.charges[v.kind], vis: visOf(B, u), pos: tileOf(B, u),
    };
    for (const e of extra) yield e;
    if (extra.some((e) => e.t === 'wake')) yield* settle(B, extra, true);
    return { ok: true };
  };

  // -- inventário (tabela de UT §3.7)
  function invFrom(B, u, it) {
    const s = BU().slotOf(u, it.id);
    if (s) return s;
    if (it.owner === null && it.at !== null && it.at !== undefined && BU().unitTiles(u, B.map).indexOf(it.at) >= 0) return 'ground';
    return null;
  }
  V.inv = function (B, u, a) {
    const it = BU().findItem(B, a.itemId);
    if (!it) return fail('invalid');
    const from = invFrom(B, u, it);
    if (!from) return fail('tooFar');
    const to = a.to;
    if (['R', 'L', 'belt', 'pack', 'ground'].indexOf(to) < 0 || to === from) return fail('invalid');
    const def = defOf(it);
    if (!def || def.fixed) return fail('invalid');
    if (from === 'ground' && (def.carry === false || def.battle === false)) return fail('tooHeavy');
    if (to === 'R' || to === 'L') {
      if (u.items[to] !== null) return fail('slotFull');
    } else if (to !== 'ground') {
      const types = BU().item(B, u, to).filter((x) => x.id !== it.id).map((x) => x.type);
      if (!D().fitsSlot(it.type, to, types)) return fail('noRoom');
    }
    const tu = D().invMoveTU(from, to);
    if (tu === null || tu === undefined) return fail('invalid');
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, from, to };
  };
  V.pickup = function (B, u, a) {
    const it = BU().findItem(B, a.itemId);
    if (it && invFrom(B, u, it) !== 'ground') return fail('tooFar');
    return V.inv(B, u, Object.assign({}, a, { to: a.to || 'R' }));
  };
  P.inv = function* (B, u, a, v) {
    const it = BU().findItem(B, a.itemId);
    if (!a.free) u.tu -= v.tu;
    if (v.to === 'ground') BU().dropItem(B, u, it.id);
    else if (v.from === 'ground') {
      it.at = null;
      BU().giveItem(B, u, it.id, v.to);
    } else {
      BU().takeFromUnit(u, it.id);
      it.owner = null;
      BU().giveItem(B, u, it.id, v.to);
    }
    const t = v.to === 'ground' ? 'drop' : v.from === 'ground' ? 'pickup' : 'inv';
    yield { t, unitId: u.id, itemId: it.id, from: v.from, to: v.to, i: v.to === 'ground' ? it.at : tileOf(B, u), vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true };
  };
  P.pickup = P.inv;

  // -- detetor de movimento
  V.scanner = function (B, u, a) {
    let it = a.itemId !== undefined ? BU().findItem(B, a.itemId) : null;
    if (!it) it = ['R', 'L'].map((h) => handItem(B, u, h)).find((x) => x && defOf(x).kind === 'scanner') || null;
    const slot = it ? BU().slotOf(u, it.id) : null;
    if (!it || (slot !== 'R' && slot !== 'L') || defOf(it).kind !== 'scanner') return fail('notInHand');
    if (!researched(B, u, it.type)) return fail('notResearched');
    const tu = BU().actionTU(B, u, it.id, 'use');
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, itemId: it.id };
  };
  P.scanner = function* (B, u, a, v) {
    if (!a.free) u.tu -= v.tu;
    const blips = scannerBlips(B, u);
    yield { t: 'scanner', unitId: u.id, itemId: v.itemId, blips, vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true, blips };
  };

  // -- psiónica
  const PSI_KINDS = { panic: 'panic', control: 'control', mc: 'control', mindControl: 'control' };
  V.psi = function (B, u, a) {
    const amp = ['R', 'L'].map((h) => handItem(B, u, h)).find((x) => x && defOf(x).kind === 'psiamp') || null;
    if (!u.psi && !amp) return fail('noPsi');
    const kind = PSI_KINDS[a.kind || 'panic'];
    if (!kind) return fail('invalid');
    const t = findUnit(B, a.targetId);
    if (!t || !active(t) || t === u || t.side === u.side) return fail('noTarget');
    const known = u.side === 'alien' ? (t.turnsSinceSpotted | 0) <= (u.int | 0) || (OV.LOS && OV.LOS.isVisibleTo(B, 'alien', t))
      : OV.LOS && OV.LOS.isVisibleTo(B, u.side, t);
    if (!known) return fail('notVisible');
    const tu = amp && !u.psi ? defOf(amp).useTU || tune('TU_PSI', 25) : tune('TU_PSI', 25);
    const r = tuReason(u, a, tu, 0);
    if (r) return fail(r, { tu });
    return { ok: true, tu, energy: 0, kind, targetId: t.id };
  };
  P.psi = function* (B, u, a, v) {
    if (!a.free) u.tu -= v.tu;
    const t = findUnit(B, v.targetId);
    const res = OV.Morale ? OV.Morale.psiAttack(B, u, t, v.kind, B.rng.combat) : { success: false, events: [] };
    for (const e of res.events) yield e;
    // o controlo já refez a visão (Morale.takeControl): anunciar aqui o que o novo lado passou a ver
    if (res.sight) for (const e of refreshSightings(B, res.sight)) yield e;
    yield* settle(B, res.events, res.success && v.kind === 'control');
    return { ok: true, success: res.success };
  };

  // -- terminar a unidade
  V.endUnit = function () {
    return { ok: true, tu: 0, energy: 0 };
  };
  P.endUnit = function* (B, u) {
    u.done = true;
    yield { t: 'endUnit', unitId: u.id, vis: visOf(B, u), pos: tileOf(B, u) };
    return { ok: true };
  };

  // ---- interface pública -----------------------------------------------------------------------------------
  function validate(B, a) {
    if (!B || !a || TYPES.indexOf(a.type) < 0) return fail('invalid');
    derived(B);
    if (B.phase === 'over' || B.aborted) return fail('battleOver');
    const u = findUnit(B, a.unitId);
    if (!u || !active(u)) return fail('invalid');
    if (u.side !== B.side) return fail('notYourTurn');
    if (u.status === 'panic' && !(a.panic || a.berserk)) return fail('panicking');
    const v = V[a.type](B, u, a);
    if (v.ok && !v.type) v.type = a.type;
    return v;
  }

  function* perform(B, a) {
    derived(B);
    const v = validate(B, a);
    const u = a ? findUnit(B, a.unitId) : null;
    if (!v.ok) {
      yield interrupt(B, u, v.reason);
      return v;
    }
    const res = (yield* P[v.type](B, u, a, v)) || { ok: true };
    const o = outcomeOf(B);
    if (o && B.phase !== 'over') {
      B.phase = 'over';
      B.result = o;
      yield { t: 'battleEnd', result: o, vis: true, pos: -1 };
    }
    return Object.assign({ type: v.type, tu: v.tu }, res);
  }

  // pré-visualização do caminho: marks por passo 0 = mantém a reserva, 1 = come a reserva, 2 = inalcançável
  function walkPreview(B, u, toI, opts) {
    const o = opts || {};
    if (!OV.Path || !u || !active(u)) return null;
    const path = OV.Path.find(B, u, toI, null, { run: !!o.run });
    if (!path) return null;
    const stand = u.kneel ? tune('TU_STAND', 8) : 0;
    const reserve = reserveTU(B, u, { mode: o.reserveMode || null, standing: true });
    const live = liveReserve(u, reserve);
    const marks = [];
    for (let k = 0; k < path.steps.length; k++) {
      const tu = stand + path.tus[k];
      marks.push(tu > (u.tu | 0) ? 2 : live > 0 && tu > (u.tu | 0) - live ? 1 : 0);
    }
    // energia: o passo que a esgota e os seguintes ficam inalcançáveis
    if (path.energy > (u.energy | 0)) {
      let cur = tileOf(B, u), e = 0;
      for (let k = 0; k < path.steps.length; k++) {
        const s = OV.Path.stepCost(B, u, cur, path.steps[k], { run: !!o.run });
        if (!s) break;
        e += s.energy;
        if (e > (u.energy | 0)) {
          for (let j = k; j < marks.length; j++) marks[j] = 2;
          break;
        }
        cur = s.to;
      }
    }
    return { steps: path.steps, tiles: path.tiles, tus: path.tus.map((x) => x + stand), tu: path.tu + stand, energy: path.energy, reserve, marks };
  }

  OV.Act = {
    TYPES, REASONS, validate, perform, reactions, reserveTU, reserveInfo, walkPreview, reactionScore, turnSteps, scannerBlips, reasonKey,
    planArc, traceArc, noteSpotted: newSpots,
  };
})(globalThis.OV || (globalThis.OV = {}));
