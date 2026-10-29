/* Ambiente da batalha (DESIGN.md §3.3, §3.6, §3.11; REA 03 §1.5, §4.4, §8): portas, gravidade, fogo e fumo
   por ronda, recuperação das unidades no início do turno e granadas ativadas no fim do turno.
   Só inteiros; aleatoriedade só pelas streams de B.rng (combat por omissão).

   OV.Env:
     openDoor(B, u|null, i, part?) → events   batente: troca para alt (fica aberta); OVNI: ufoDoorOpen=1 no grupo «O»
     closeUfoDoors(B) → events                fim de turno: fecha os grupos sem unidades na porta
     applyGravity(B, i) → events              unidades/itens sem chão na coluna de i (de z(i) para cima) caem
     roundUpkeep(B, rng?) → events            fogo (dura combustível+1, espalha-se, queima), fumo (−1, espalha, média)
     unitTurnStart(B, u, rng?) → events       UT, energia, feridas, a arder, fogo/fumo no tile, atordoamento, acordar
     armedGrenadesEndTurn(B, rng?) → events   granadas no chão com espoleta 0 rebentam; as outras ativadas −1
     itemsOnTile(B, i) → [item]               itens no chão do tile (por id) */
(function (OV) {
  'use strict';

  const U = OV.U;
  const idiv = U.idiv;
  const D = () => OV.Data;
  const BU = () => OV.BUnits;
  const BM = () => OV.BMap;
  const CB = () => OV.Combat;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const LIVE = { ok: 1, panic: 1 };
  const ORTHO = [0, 2, 4, 6];
  const VX = 16, VZ = 24;

  function derived(B) {
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    return B._;
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
  function visOf(B, u) {
    if (!u) return false;
    if (u.side === 'xcom' || u.origSide === 'xcom') return true;
    return !!(OV.LOS && OV.LOS.isVisibleTo && OV.LOS.isVisibleTo(B, 'xcom', u));
  }
  function tileVis(B, i) {
    if (i < 0 || i >= B.map.n) return false;
    const _ = B._;
    return !!((_ && _.visTiles && _.visTiles[i]) || (B.map.disc[i] & 1));
  }

  function itemsOnTile(B, i) {
    return B.items.filter((it) => it.owner === null && it.at === i).sort((a, b) => a.id - b.id);
  }

  // ---- portas ------------------------------------------------------------------------------------------------
  /* Abre a porta da parte (1/2 batente na aresta do tile i, 3 porta de OVNI no objeto). As UT são das ações.
     Unidades 2×2 não abrem portas de batente. Porta já aberta ou inexistente ⇒ []. */
  function openDoor(B, u, i, part) {
    derived(B);
    const m = B.map;
    if (i < 0 || i >= m.n) return [];
    const p = part === undefined || part === null ? (BM().isUfoDoor(m, i) ? 3 : -1) : part;
    const unitId = u ? u.id : null;
    const vis = tileVis(B, i) || (!!u && visOf(B, u));
    if (p === 3) {
      if (!BM().isUfoDoor(m, i) || BM().isDoorOpen(m, i, 3)) return [];
      const group = BM().ufoDoorGroup(m, i);
      for (const j of group) m.ufoDoorOpen[j] = 1;
      markDirty(B);
      return [{ t: 'door', i, part: 3, kind: 'ufo', open: true, tiles: group, unitId, vis, pos: i }];
    }
    if (p !== 1 && p !== 2) return [];
    const d = BM().def(m, i, p);
    if (!d || d.door !== 'swing' || d.open || !d.alt) return [];
    if (u && u.size > 1) return [];
    const ev = BM().setPart(B, i, p, d.alt);
    ev.vis = vis;
    ev.pos = i;
    return [ev, { t: 'door', i, part: p, kind: 'swing', open: true, tiles: [i], unitId, vis, pos: i }];
  }

  // fim de turno: portas de OVNI fecham-se, salvo se houver uma unidade em algum segmento do grupo
  function closeUfoDoors(B) {
    derived(B);
    const m = B.map;
    const out = [];
    const seen = new Uint8Array(m.n);
    for (let i = 0; i < m.n; i++) {
      if (!m.ufoDoorOpen[i] || seen[i]) continue;
      if (!BM().isUfoDoor(m, i)) {
        m.ufoDoorOpen[i] = 0;
        continue;
      }
      const group = BM().ufoDoorGroup(m, i);
      for (const j of group) seen[j] = 1;
      if (group.some((j) => B._.unitAt[j])) continue;
      for (const j of group) m.ufoDoorOpen[j] = 0;
      out.push({ t: 'door', i: group[0], part: 3, kind: 'ufo', open: false, tiles: group, unitId: null, vis: group.some((j) => tileVis(B, j)), pos: group[0] });
    }
    if (out.length) markDirty(B);
    return out;
  }

  // ---- gravidade -----------------------------------------------------------------------------------------------
  /* Coluna de i, de z(i) para cima: unidades sem chão em nenhum dos seus tiles caem até ao primeiro chão (0 de
     dano, orig); quem voa fica a pairar (float). Itens no chão caem também. */
  function applyGravity(B, i) {
    derived(B);
    const m = B.map;
    const out = [];
    if (i < 0 || i >= m.n) return out;
    const [x, y, z0] = BM().xyz(m, i);
    for (let z = z0; z < m.d; z++) {
      const j = BM().idx(m, x, y, z);
      if (BM().hasFloor(m, j)) continue;
      const a = B._.unitAt[j];
      if (a) {
        const u = BU().findUnit(B, a - 1);
        if (u && u.z === z) {
          const tiles = BU().unitTiles(u, m);
          if (!tiles.some((t) => BM().hasFloor(m, t))) {
            if (u.canFly) {
              u.float = true;
            } else {
              const from = tileOfUnit(B, u);
              const target = BM().dropTarget(m, from);
              let to = BU().fits(B, u, target) ? target : OV.Battle && OV.Battle.nearestFree ? OV.Battle.nearestFree(B, u, target, null) : -1;
              if (to >= 0 && to !== from) {
                const fromZ = u.z;
                BU().placeUnit(B, u, to);
                u.float = false;
                out.push({ t: 'fall', unitId: u.id, itemId: null, from, to, fromZ, toZ: u.z, vis: visOf(B, u) || tileVis(B, from), pos: to });
              }
            }
          }
        }
      }
      for (const it of itemsOnTile(B, j)) {
        const to = BM().dropTarget(m, j);
        if (to === j) continue;
        it.at = to;
        out.push({ t: 'fall', unitId: null, itemId: it.id, from: j, to, fromZ: z, toZ: BM().xyz(m, to)[2], vis: tileVis(B, j) || tileVis(B, to), pos: to });
      }
    }
    if (out.length) markDirty(B);
    return out;
  }

  // ---- fogo e fumo (SavedBattleGame::prepareNewTurn) ------------------------------------------------------------
  // destrói a parte para a sua die (chão térreo ⇒ queimado); devolve o evento ou null
  function burnPart(B, i, part) {
    const m = B.map;
    const d = BM().def(m, i, part);
    if (!d || d.flammable === 255 || (d.armour | 0) >= 255) return null;
    let id = d.die | 0;
    if (part === 0 && id === 0 && i < m.w * m.h) {
      const s = D().tileDefByKey[d.set + '.scorched'];
      id = s ? s.id : d.id;
    }
    if (id === d.id) return null;
    const ev = BM().setPart(B, i, part, id);
    ev.vis = tileVis(B, i);
    ev.pos = i;
    return ev;
  }

  /* Ronda: (1) fogo — cada tile a arder (não aceso nesta ronda) −1; se continua, tenta pegar aos 4 vizinhos
     ortogonais sem parede que trave o fogo (chance fumo − inflam/10 + 15 %, precisa de combustível); se acaba,
     fumo 0 e o objeto inflamável (e o chão) queimam → gravidade. (2) fumo — sem fogo: −1 e espalha para vizinhos
     vazios (ou com fumo novo); com fogo: metade para o nível de cima (sem chão) e vizinhos; no fim a média
     fumo/sobreposições − 1. Os very-lights continuam acesos (luz dos itens). */
  function roundUpkeep(B, rng) {
    derived(B);
    const r = rngOf(B, rng);
    const m = B.map;
    const n = m.n, plane = m.w * m.h;
    const out = [];
    const overlaps = new Uint8Array(n);
    for (const i of B.freshFire || []) if (i >= 0 && i < n && m.fire[i]) overlaps[i] = 1;
    const ignited = [];

    function ignite(t, power) {
      const flam = CB().tileFlam(m, t);
      if (flam === 255) return;
      const chance = Math.max(0, power - idiv(flam, 10) + tune('FIRE_SPREAD_BASE', 15));
      if (r.int(0, 99) < chance && CB().tileFuel(m, t) > 0 && m.fire[t] === 0) {
        m.smoke[t] = 15 - U.clamp(idiv(flam, 10), 1, 12);
        overlaps[t] = 1;
        m.fire[t] = Math.min(255, CB().tileFuel(m, t) + 1);
        ignited.push(t);
      }
    }
    const onFire = [];
    for (let i = 0; i < n; i++) if (m.fire[i]) onFire.push(i);
    const burnt = [];
    for (const i of onFire) {
      if (overlaps[i]) continue;
      m.fire[i]--;
      const [x, y, z] = BM().xyz(m, i);
      if (m.fire[i]) {
        for (const dir of ORTHO) {
          const e = BM().edgeInfo(m, x, y, z, dir);
          if (e.to < 0 || e.blocked.fire) continue;
          ignite(e.to, m.smoke[i]);
        }
      } else {
        m.smoke[i] = 0;
        const evs = [];
        const o = BM().def(m, i, 3);
        if (o) {
          if (o.flammable !== 255 && (o.armour | 0) < 255) {
            evs.push(burnPart(B, i, 3));
            evs.push(burnPart(B, i, 0));
          }
        } else if (BM().def(m, i, 0)) {
          evs.push(burnPart(B, i, 0));
        }
        for (const ev of evs) if (ev) out.push(ev);
        burnt.push(i);
        for (const g of applyGravity(B, i)) out.push(g);
      }
    }

    function addSmoke(t, s) {
      if (m.fire[t] !== 0) return;
      if (overlaps[t] === 0) m.smoke[t] = Math.max(1, Math.min(m.smoke[t] + s, 15));
      else m.smoke[t] = Math.min(255, m.smoke[t] + s);
      if (overlaps[t] < 255) overlaps[t]++;
    }
    const onSmoke = [];
    for (let i = 0; i < n; i++) if (m.smoke[i]) onSmoke.push(i);
    for (const i of onSmoke) {
      const [x, y, z] = BM().xyz(m, i);
      if (!m.fire[i]) {
        if (m.smoke[i] > 0) m.smoke[i]--;
        if (!m.smoke[i]) continue;
        for (const dir of ORTHO) {
          const e = BM().edgeInfo(m, x, y, z, dir);
          if (e.to < 0 || e.blocked.smoke) continue;
          const t = e.to;
          if (m.smoke[t] === 0 || (m.fire[t] === 0 && overlaps[t] !== 0)) addSmoke(t, m.smoke[i]);
        }
      } else {
        const half = m.smoke[i] >> 1;
        if (z + 1 < m.d && !m.ceiling && !BM().hasFloor(m, i + plane)) addSmoke(i + plane, half);
        for (const dir of ORTHO) {
          const e = BM().edgeInfo(m, x, y, z, dir);
          if (e.to < 0 || e.blocked.smoke) continue;
          addSmoke(e.to, half);
        }
      }
    }
    for (let t = 0; t < n; t++) {
      if (overlaps[t] && m.smoke[t] && !m.fire[t]) m.smoke[t] = U.clamp(idiv(m.smoke[t], overlaps[t]) - 1, 0, 15);
    }
    B.freshFire = [];
    if (ignited.length) out.push({ t: 'fire', i: ignited[0], tiles: ignited.slice(), vis: ignited.some((i) => tileVis(B, i)), pos: ignited[0] });
    if (burnt.length) out.push({ t: 'burnout', i: burnt[0], tiles: burnt, vis: burnt.some((i) => tileVis(B, i)), pos: burnt[0] });
    markDirty(B);
    return out;
  }

  // ---- início do turno da unidade (BattleUnit::prepareNewTurn) ---------------------------------------------------
  /* Fogo/fumo no tile (fogo: dano IN = fumo do tile, 40 %·mod de pegar fogo por RNG(0,5·mod) turnos; fumo sem fogo:
     +(fumo/4+1) de atordoamento a quem respira e tem mod > 0); UT = base × min(1, Força/peso) − 10 %/ferida
     na perna; energia + recuperação (soldados UT/3, aliens energyRecovery) − 10 % da energia por ferida no tronco,
     até à Vigor; −1 HP por ferida fatal; a arder: −RNG(5,10)×mod IN e −1 turno (não no turno em que levou fogo
     do tile); morte; atordoamento −1; inconsciente com stun < HP acorda num tile livre. Ajoelhar mantém-se. */
  function unitTurnStart(B, u, rng) {
    derived(B);
    const out = [];
    if (!u || u.status === 'dead') return out;
    const r = rngOf(B, rng);
    const m = B.map;
    const push = (evs) => { for (const e of evs) out.push(e); };
    const dead = () => u.status === 'dead';
    let hitByFire = false;
    // fogo/fumo do tile
    if (LIVE[u.status] && u.onMap) {
      const tiles = BU().unitTiles(u, m);
      const fireT = tiles.find((t) => m.fire[t] > 0);
      const smokeT = tiles.find((t) => m.smoke[t] > 0);
      const modIN = u.mods && u.mods.IN !== undefined ? u.mods.IN : 100;
      if (fireT !== undefined) {
        hitByFire = true;
        push(CB().damageUnit(B, u, m.smoke[fireT], 'IN', 4, 1, null, { rng: r, roll: false, ignoreArmour: true, cause: 'fire' }));
        if (!dead() && r.int(0, 99) < idiv(tune('FIRE_IGNITE_UNIT_PCT', 40) * modIN, 100)) {
          const bt = r.int(0, idiv(5 * modIN, 100));
          if ((u.burn | 0) < bt) u.burn = bt;
        }
      } else if (smokeT !== undefined && u.origSide !== 'alien' && u.size === 1 && (u.mods && u.mods.SMOKE !== undefined ? u.mods.SMOKE : 100) > 0) {
        push(CB().damageUnit(B, u, idiv(m.smoke[smokeT], 4) + 1, 'SMOKE', 4, 1, null, { rng: r, roll: false, ignoreArmour: true, cause: 'smoke' }));
      }
      if (dead()) return out;
    }
    const isOut = u.status === 'out';
    // UT
    u.tuMax = BU().turnTU(B, u);
    u.tu = u.tuMax;
    // energia
    if (!isOut) {
      const rec = (u.stats.energyRecovery | 0) - idiv(u.energy * (u.wounds[1] | 0) * 10, 100);
      u.energy = U.clamp(u.energy + rec, 0, u.stats.sta | 0);
    }
    const pos = tileOfUnit(B, u);
    // feridas fatais
    const bleed = u.wounds.reduce((a, b) => a + (b | 0), 0);
    if (bleed > 0) {
      const loss = Math.min(bleed, u.hp);
      u.hp -= loss;
      out.push({ t: 'damage', unitId: u.id, attackerId: null, dmgType: null, cause: 'wounds', amount: loss, stun: 0, armourHit: null, part: null, wounds: 0, hp: u.hp, stunLevel: u.stun, absorbed: false, vis: visOf(B, u), pos });
    }
    // a arder
    if (!hitByFire && (u.burn | 0) > 0) {
      const modIN = u.mods && u.mods.IN !== undefined ? u.mods.IN : 100;
      const loss = Math.min(u.hp, idiv(modIN * r.int(tune('FIRE_UNIT_MIN', 5), tune('FIRE_UNIT_MAX', 10)), 100));
      u.hp -= loss;
      u.burn--;
      out.push({ t: 'damage', unitId: u.id, attackerId: null, dmgType: 'IN', cause: 'burn', amount: loss, stun: 0, armourHit: null, part: null, wounds: 0, hp: u.hp, stunLevel: u.stun, absorbed: false, vis: visOf(B, u), pos });
    }
    if (u.hp <= 0) {
      push(CB().killUnit(B, u, null, bleed > 0 ? 'wounds' : 'burn', { rng: r }));
      return out;
    }
    // atordoamento
    if (u.stun > 0) u.stun--;
    if (u.status === 'out' && u.stun < u.hp) push(wake(B, u));
    else if (LIVE[u.status] && u.onMap && u.stun >= u.hp) push(CB().knockOut(B, u, null, { rng: r }));
    u.motion = 0;
    return out;
  }

  // acorda: o corpo sai do chão (ou do inventário de quem o leva) e a unidade volta num tile livre perto dele
  function wake(B, u) {
    const body = B.items.find((it) => it.unitId === u.id) || null;
    let tile = -1;
    if (body) {
      if (body.at !== null && body.at !== undefined) tile = body.at;
      else {
        const c = BU().findUnit(B, body.owner);
        tile = c ? tileOfUnit(B, c) : -1;
      }
    }
    if (tile < 0) tile = tileOfUnit(B, u);
    if (tile < 0) return [];
    const at = BU().fits(B, u, tile) ? tile : OV.Battle && OV.Battle.nearestFree ? OV.Battle.nearestFree(B, u, tile, null) : -1;
    if (at < 0) return [];
    if (body) BU().deleteItem(B, body.id);
    u.status = 'ok';
    u.kneel = false;
    BU().placeUnit(B, u, at);
    if (u.origSide === 'alien' && B.stats && B.stats.aliensStunned > 0) B.stats.aliensStunned--;
    if (OV.LOS && OV.LOS.refreshTarget) OV.LOS.refreshTarget(B, u);
    return [{ t: 'wake', unitId: u.id, i: at, vis: visOf(B, u) || tileVis(B, at), pos: at }];
  }

  // ---- granadas ----------------------------------------------------------------------------------------------
  /* Fim do turno: granadas ativadas no chão com espoleta 0 rebentam (por id; quem a ativou = it.primedBy);
     depois todas as granadas ativadas com espoleta > 0 (no chão ou no inventário) descontam 1. As de
     proximidade (P1) ficam de fora. No fim, as explosões em cadeia pendentes. */
  function armedGrenadesEndTurn(B, rng) {
    derived(B);
    const r = rngOf(B, rng);
    const items = D().items;
    const out = [];
    const isTimed = (it) => {
      const def = items[it.type];
      return def && def.kind === 'grenade' && !def.proximity && it.fuse >= 0;
    };
    const hot = B.items.filter((it) => isTimed(it) && it.fuse === 0 && it.owner === null && it.at !== null && it.at !== undefined)
      .sort((a, b) => a.id - b.id).map((it) => it.id);
    for (const id of hot) {
      const it = BU().findItem(B, id);
      if (!it || it.owner !== null || it.at === null) continue;
      const def = items[it.type];
      const [x, y, z] = BM().xyz(B.map, it.at);
      const attacker = it.primedBy === undefined ? null : it.primedBy;
      BU().deleteItem(B, id);
      for (const e of CB().explode(B, [x * VX + 8, y * VX + 8, z * VZ + 2], def.power | 0, def.dmg, def.radius | 0, attacker, { rng: r, cause: 'grenade' })) out.push(e);
    }
    for (const it of B.items) if (isTimed(it) && it.fuse > 0) it.fuse--;
    for (const e of CB().resolvePendingExplosions(B, r)) out.push(e);
    return out;
  }

  OV.Env = { openDoor, closeUfoDoors, applyGravity, roundUpkeep, unitTurnStart, armedGrenadesEndTurn, itemsOnTile, wake };
})(globalThis.OV || (globalThis.OV = {}));
