/* Entidades: criação de unidades/edifícios, colocação com raio de construção, energia, produção, captura, destruição */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  CG.BUILD_RADIUS = 4;

  CG.addEntity = function (G, e) {
    e.id = G.nextId++;
    G.entities.push(e);
    G.byId.set(e.id, e);
    return e;
  };

  CG.notify = function (G, pid, text, opts) {
    if (pid !== G.human) return;
    opts = opts || {};
    const key = opts.key || text;
    const cd = opts.cooldown === undefined ? 4 : opts.cooldown;
    const last = G.msgTimes[key];
    if (last !== undefined && G.time - last < cd) return;
    G.msgTimes[key] = G.time;
    if (opts.x !== undefined) G.lastAlert = { x: opts.x, y: opts.y, t: G.time };
    if (CG.ui && CG.ui.toast) CG.ui.toast(text, opts.kind || 'info');
    if (opts.sound && CG.audio) CG.audio.play(opts.sound);
    if (opts.voice !== false && CG.audio) CG.audio.speak(opts.voice || text);
  };

  // ------------------------------------------------------------------ unidades
  CG.spawnUnit = function (G, typeId, owner, x, y, angle) {
    const def = CG.UNITS[typeId];
    const air = def.cat === 'air';
    const a = angle === undefined ? Math.PI / 2 : angle;
    const u = {
      id: 0, kind: 'unit', type: typeId, def, owner, x, y, px: x, py: y,
      angle: a, pangle: a, turret: a, pturret: a,
      hp: def.hp, maxHp: def.hp, alive: true, air, z: air ? (def.kamikaze ? 18 : 26) : 0,
      order: null, goal: null, path: null, pathIdx: 0, pathPending: false, pathReq: null,
      stuckT: 0, stuckD: 1e9, repaths: 0, repathT: 0, moving: false, speedNow: 0,
      target: 0, scanT: G.rng.next() * 0.35, cd: 0, burst: 0, burstT: 0, burstTarget: 0, burstX: 0, burstY: 0,
      carry: 0, hs: null, resTile: -1, harvT: 0, fieldX: -1, fieldY: -1, waitT: 0, refId: 0, unloadSnd: false,
      disabled: 0, firedT: 99, hitT: 99, revealed: 0, lastAttacker: 0,
      guardX: x, guardY: y, anim: G.rng.next() * 10, sel: false, kills: 0, group: 0, _qs: 0,
    };
    CG.addEntity(G, u);
    const p = G.players[owner];
    if (p) p.unitCount++;
    return u;
  };

  // ------------------------------------------------------------------ edifícios
  CG.spawnBuilding = function (G, typeId, owner, tx, ty, opts) {
    opts = opts || {};
    const def = CG.BUILDINGS[typeId];
    const m = G.map;
    const b = {
      id: 0, kind: 'bld', type: typeId, def, owner, tx, ty, w: def.w, h: def.h,
      x0: tx * T, y0: ty * T, x1: (tx + def.w) * T, y1: (ty + def.h) * T,
      x: (tx + def.w / 2) * T, y: (ty + def.h / 2) * T, px: 0, py: 0,
      hp: def.hp, maxHp: def.hp, alive: true, built: opts.instant ? 1 : 0,
      disabled: 0, repairing: false, selling: 0, turret: Math.PI / 2, pturret: Math.PI / 2, angle: 0, pangle: 0,
      target: 0, scanT: G.rng.next() * 0.3, cd: 0, burst: 0, burstT: 0, burstTarget: 0, burstX: 0, burstY: 0, firedT: 99, hitT: 99,
      rally: null, anim: G.rng.next() * 10, incomeT: 0, seen: 0, sel: false, lastAttacker: 0,
      dockX: 0, dockY: 0, freeHarv: !!def.refinery && !opts.noHarvester, air: false, z: 0, _qs: 0,
    };
    b.px = b.x;
    b.py = b.y;
    if (def.refinery) {
      b.dockX = (tx + 1) * T + T / 2;
      b.dockY = (ty + def.h) * T + T / 2;
      const di = m.idx(tx + 1, ty + def.h);
      if (m.inBounds(tx + 1, ty + def.h)) m.reserve[di] = 1;
    }
    CG.addEntity(G, b);
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        const i = m.idx(x, y);
        m.block[i] = 2;
        m.bld[i] = b.id;
      }
    if (b.built >= 1) CG.onBuilt(G, b, true);
    return b;
  };

  CG.onBuilt = function (G, b, silent) {
    const p = G.players[b.owner];
    if (!p) return;
    CG.refreshPlayer(G, p);
    if (b.freeHarv) {
      b.freeHarv = false;
      const h = CG.spawnUnit(G, 'harv', b.owner, b.dockX, b.dockY, Math.PI / 2);
      CG.orderHarvest(G, h);
    }
    if (!silent && b.owner === G.human && CG.audio) CG.audio.play('place', b.x, b.y);
  };

  CG.costOf = (p, def) => (def.kind === 'bld' ? Math.round(def.cost * p.faction.mods.bldCost) : def.cost);

  function rectGap(ax, ay, aw, ah, bx, by, bw, bh) {
    const dx = Math.max(bx - (ax + aw - 1), 0, ax - (bx + bw - 1));
    const dy = Math.max(by - (ay + ah - 1), 0, ay - (by + bh - 1));
    return Math.max(dx, dy);
  }

  CG.inBuildRadius = function (G, pid, tx, ty, w, h) {
    for (const e of G.entities) {
      if (e.kind !== 'bld' || !e.alive || e.owner !== pid || e.def.defense || e.def.noCount) continue;
      if (rectGap(tx, ty, w, h, e.tx, e.ty, e.w, e.h) <= CG.BUILD_RADIUS) return true;
    }
    return false;
  };

  const _q = [];
  // validação de colocação: terreno, ocupação, unidades, acesso da refinaria e raio de construção
  CG.canPlace = function (G, pid, typeId, tx, ty, opts) {
    opts = opts || {};
    const def = CG.BUILDINGS[typeId];
    const m = G.map;
    const cells = [];
    let ok = true, reason = '';
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        let c = m.inBounds(x, y);
        if (c) {
          const i = m.idx(x, y);
          c = m.terrain[i] === 0 && m.block[i] === 0 && !m.reserve[i] && m.res[i] <= 0;
        }
        if (!c) { ok = false; reason = 'Terreno ocupado ou inválido'; }
        cells.push({ x, y, ok: c });
      }
    if (def.refinery) {
      const x = tx + 1, y = ty + def.h;
      let c = m.inBounds(x, y);
      if (c) {
        const i = m.idx(x, y);
        c = m.terrain[i] === 0 && m.block[i] === 0 && !m.reserve[i];
      }
      if (!c) { ok = false; reason = 'A saída da refinaria está bloqueada'; }
      cells.push({ x, y, ok: c, dock: true });
    }
    // unidades terrestres em cima do local
    const cx = (tx + def.w / 2) * T, cy = (ty + def.h / 2) * T;
    G.spatial.query(cx, cy, Math.max(def.w, def.h) * T, _q);
    for (const e of _q) {
      if (e.kind !== 'unit' || e.air || !e.alive || e.id === opts.ignore) continue;
      const ux = Math.floor(e.x / T), uy = Math.floor(e.y / T);
      for (const c of cells) {
        if (c.x === ux && c.y === uy && !c.dock) {
          if (c.ok) { c.ok = false; ok = false; reason = 'Há unidades no local'; }
        }
      }
    }
    if (!opts.anywhere && !CG.inBuildRadius(G, pid, tx, ty, def.w, def.h)) {
      ok = false;
      reason = 'Fora do raio de construção';
      for (const c of cells) c.ok = false;
    }
    return { ok, cells, reason };
  };

  // ------------------------------------------------------------------ jogadores
  CG.refreshPlayer = function (G, p) {
    let prod = 0, use = 0;
    const owned = p.owned;
    for (const k in owned) owned[k] = 0;
    for (const e of G.entities) {
      if (e.kind !== 'bld' || !e.alive || e.owner !== p.id || e.built < 1) continue;
      owned[e.type] = (owned[e.type] || 0) + 1;
      const pw = e.def.power;
      if (pw > 0) {
        if (e.disabled <= 0) prod += pw * (0.5 + 0.5 * (e.hp / e.maxHp));
      } else use -= pw;
    }
    p.powerProd = Math.round(prod);
    p.powerUse = use;
    const wasLow = p.lowPower;
    p.lowPower = use > p.powerProd;
    if (!wasLow && p.lowPower && G.time > 1) CG.notify(G, p.id, 'Energia insuficiente', { kind: 'warn', sound: 'powerDown', cooldown: 8 });
    p.hasRadar = (owned.radar || 0) > 0 && !p.lowPower && radarActive(G, p);
    for (const pid of p.faction.powers) {
      const pw = p.powers[pid];
      pw.avail = (owned[CG.POWERS[pid].prereq] || 0) > 0;
    }
  };
  function radarActive(G, p) {
    for (const e of G.entities) if (e.kind === 'bld' && e.alive && e.owner === p.id && e.def.radar && e.built >= 1 && e.disabled <= 0) return true;
    return false;
  }

  CG.hasPrereqs = (p, def) => def.prereq.every((r) => (p.owned[r] || 0) > 0);
  CG.missingPrereqs = (p, def) => def.prereq.filter((r) => !((p.owned[r] || 0) > 0));
  CG.available = (p, def) => {
    if (def.hidden) return false;
    if (def.kind === 'unit') return p.faction.units.indexOf(def.id) >= 0;
    return true;
  };
  CG.queueKey = (def) => (def.kind === 'bld' ? 'bld' : def.cat);

  CG.producers = function (G, p, key) {
    const out = [];
    for (const e of G.entities) {
      if (e.kind !== 'bld' || !e.alive || e.owner !== p.id || e.built < 1 || e.disabled > 0 || e.selling > 0) continue;
      if (key === 'bld' ? e.def.conyard : e.def.produces === key) out.push(e);
    }
    return out;
  };

  CG.enqueue = function (G, p, typeId) {
    const def = CG.typeDef(typeId);
    if (!def || !CG.available(p, def)) return 'Indisponível';
    if (!CG.hasPrereqs(p, def)) return 'Requer: ' + CG.missingPrereqs(p, def).map((r) => CG.PREREQ_NAMES[r]).join(', ');
    const key = CG.queueKey(def);
    const q = p.queues[key];
    if (key === 'bld') {
      if (q.items.length) return 'Já há uma estrutura em construção';
    } else if (q.items.length >= 12) return 'Fila cheia';
    q.items.push(typeId);
    return null;
  };

  CG.dequeue = function (G, p, typeId) {
    const def = CG.typeDef(typeId);
    const q = p.queues[CG.queueKey(def)];
    const k = q.items.lastIndexOf(typeId);
    if (k < 0) return false;
    if (k === 0) {
      p.credits += q.paid;
      q.paid = 0;
      q.progress = 0;
      q.ready = false;
    }
    q.items.splice(k, 1);
    return true;
  };

  CG.updateProduction = function (G, p, dt) {
    for (const key of ['bld', 'inf', 'veh', 'air']) {
      const q = p.queues[key];
      q.stalled = false;
      if (!q.items.length || q.ready) continue;
      const def = CG.typeDef(q.items[0]);
      const prods = CG.producers(G, p, key);
      if (!prods.length) { q.stalled = true; continue; }
      if (key !== 'bld' && p.unitCount + (def.squad || 1) > CG.UNIT_CAP) {
        q.stalled = true;
        CG.notify(G, p.id, 'Limite de unidades atingido', { kind: 'warn', cooldown: 20 });
        continue;
      }
      const mods = p.faction.mods;
      let mult = 1 + 0.5 * (Math.min(prods.length, 4) - 1);
      if (key === 'inf') mult *= mods.prodInf;
      if (key === 'veh') mult *= mods.prodVeh;
      if (p.lowPower) mult *= 0.3;
      mult *= p.buildMult;
      const time = def.time / mult;
      const cost = CG.costOf(p, def);
      const want = Math.min((cost / time) * dt, cost - q.paid);
      const pay = Math.min(want, p.credits);
      p.credits -= pay;
      q.paid += pay;
      q.progress = cost > 0 ? q.paid / cost : 1;
      if (pay < want - 1e-6) {
        q.stalled = true;
        CG.notify(G, p.id, 'Fundos insuficientes', { kind: 'warn', sound: 'error', cooldown: 15 });
      }
      if (q.paid >= cost - 1e-6) {
        if (key === 'bld') {
          q.ready = true;
          q.progress = 1;
          CG.notify(G, p.id, 'Construção concluída', { sound: 'buildDone', cooldown: 0.5 });
        } else {
          p.prodRR[key] = (p.prodRR[key] + 1) % prods.length;
          CG.deliverUnit(G, p, def, prods[p.prodRR[key]]);
          q.items.shift();
          q.paid = 0;
          q.progress = 0;
          CG.notify(G, p.id, 'Unidade pronta', { sound: 'unitReady', cooldown: 1.5 });
        }
      }
    }
  };

  CG.deliverUnit = function (G, p, def, fac) {
    const m = G.map;
    const count = def.squad || 1;
    const typeId = def.spawn || def.id;
    const sub = CG.UNITS[typeId];
    let ex, ey;
    if (sub.cat === 'air') {
      ex = fac.x;
      ey = fac.y;
    } else {
      const f = m.nearestFree(fac.tx + Math.floor(fac.w / 2), fac.ty + fac.h, 6) || { x: fac.tx, y: fac.ty + fac.h };
      ex = f.x * T + T / 2;
      ey = f.y * T + T / 2;
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const ox = count > 1 ? (i % 2) * 14 - 7 : 0, oy = count > 1 ? Math.floor(i / 2) * 14 - 7 : 0;
      const u = CG.spawnUnit(G, typeId, p.id, ex + ox, ey + oy, Math.PI / 2);
      p.stats.unitsBuilt++;
      out.push(u);
      if (sub.harvester) {
        CG.orderHarvest(G, u);
      } else if (fac.rally) {
        CG.orderMove(G, u, fac.rally.x + ox, fac.rally.y + oy, false);
      } else if (sub.cat !== 'air') {
        // afasta da porta da fábrica
        const r = m.nearestFree(Math.floor(ex / T) + ((G.rng.int(5) - 2) | 0), Math.floor(ey / T) + 2, 5);
        if (r) CG.orderMove(G, u, r.x * T + T / 2 + ox, r.y * T + T / 2 + oy, false);
      } else {
        CG.orderMove(G, u, fac.x + G.rng.range(-40, 40), fac.y + fac.h * T * 0.5 + 40 + oy, false);
      }
    }
    if (p.ai) p.ai.onUnitBuilt(out);
    return out;
  };

  CG.placeStructure = function (G, p, tx, ty) {
    const q = p.queues.bld;
    if (!q.ready || !q.items.length) return false;
    const typeId = q.items[0];
    const r = CG.canPlace(G, p.id, typeId, tx, ty);
    if (!r.ok) return false;
    CG.spawnBuilding(G, typeId, p.id, tx, ty, {});
    q.items.shift();
    q.ready = false;
    q.paid = 0;
    q.progress = 0;
    p.stats.bldBuilt++;
    if (p.id === G.human && CG.audio) CG.audio.play('place');
    return true;
  };

  CG.sellBuilding = function (G, b) {
    if (!b.alive || b.selling > 0 || b.built < 1) return;
    b.selling = 0.001;
    b.repairing = false;
    if (b.owner === G.human && CG.audio) CG.audio.play('sell', b.x, b.y);
  };

  CG.capture = function (G, b, newOwner) {
    const old = b.owner;
    if (old === newOwner) return;
    b.owner = newOwner;
    b.target = 0;
    b.repairing = false;
    b.rally = null;
    b.sel = false;
    G.sel = G.sel.filter((id) => id !== b.id);
    if (b.def.refinery) b.freeHarv = false;
    const po = G.players[old], pn = G.players[newOwner];
    if (po) {
      CG.refreshPlayer(G, po);
      po.stats.bldLost++;
      CG.notify(G, old, 'Edifício capturado pelo inimigo', { kind: 'alert', sound: 'alarm', x: b.x, y: b.y });
    }
    if (pn) {
      CG.refreshPlayer(G, pn);
      CG.notify(G, newOwner, b.def.noCount ? 'Poço de petróleo capturado' : 'Edifício capturado', { sound: 'buildDone' });
    }
    if (CG.fx) CG.fx.ring(G, b.x, b.y, 50, '#ffffff');
  };

  CG.kill = function (G, e, killer) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    G.dirty = true;
    const p = G.players[e.owner];
    const k = killer !== undefined && killer >= 0 ? G.players[killer] : null;
    if (e.kind === 'unit') {
      if (p) { p.unitCount--; if (!e.silent) p.stats.unitsLost++; }
      if (k && k !== p) k.stats.unitsKilled++;
      if (e.resTile >= 0) { if (G.claims[e.resTile] > 0) G.claims[e.resTile]--; e.resTile = -1; }
      if (!e.silent && CG.fx) CG.fx.unitDeath(G, e);
    } else {
      const m = G.map;
      for (let y = e.ty; y < e.ty + e.h; y++)
        for (let x = e.tx; x < e.tx + e.w; x++) {
          const i = m.idx(x, y);
          m.block[i] = m.terrain[i] === 0 ? 0 : 1;
          m.bld[i] = 0;
        }
      if (e.def.refinery && m.inBounds(e.tx + 1, e.ty + e.h)) m.reserve[m.idx(e.tx + 1, e.ty + e.h)] = 0;
      if (p) {
        if (!e.sold) p.stats.bldLost++;
        CG.refreshPlayer(G, p);
      }
      if (k && k !== p && !e.def.noCount) k.stats.bldKilled++;
      if (!e.sold && CG.fx) CG.fx.buildingDeath(G, e);
    }
    if (e.sel) {
      e.sel = false;
      G.sel = G.sel.filter((id) => id !== e.id);
    }
  };

  CG.removeDead = function (G) {
    if (!G.dirty) return;
    G.dirty = false;
    const out = [];
    for (const e of G.entities) {
      if (e.alive) out.push(e);
      else G.byId.delete(e.id);
    }
    G.entities = out;
  };
})();
