/* Comportamento das unidades: ordens, movimento com evitamento local, colheita, engenheiros, MCV, alvos e disparo */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const _n = [];
  const LEASH = 7 * T;

  // ------------------------------------------------------------------ ordens
  CG.setGoal = function (G, u, x, y) {
    u.goal = { x, y };
    u.repaths = 0;
    u.stuckT = 0;
    u.stuckD = 1e9;
    if (u.air) {
      u.path = [{ x: CG.clamp(x, 8, G.map.pxW - 8), y: CG.clamp(y, 8, G.map.pxH - 8) }];
      u.pathIdx = 0;
    } else {
      u.path = null;
      G.path.request(u, x, y);
    }
  };
  function clearMove(u) {
    u.goal = null;
    u.path = null;
    u.pathReq = null;
    u.pathPending = false;
    u.moving = false;
  }
  function releaseClaim(G, u) {
    if (u.resTile >= 0) {
      if (G.claims[u.resTile] > 0) G.claims[u.resTile]--;
      u.resTile = -1;
    }
  }

  CG.orderMove = function (G, u, x, y, amove) {
    if (u.def.harvester) { releaseClaim(G, u); u.hs = null; }
    u.order = { type: amove && u.def.weapon ? 'amove' : 'move', x, y };
    u.target = 0;
    u.guardX = x;
    u.guardY = y;
    CG.setGoal(G, u, x, y);
  };
  CG.orderStop = function (G, u) {
    if (u.def.harvester) { releaseClaim(G, u); u.hs = null; }
    u.order = null;
    u.target = 0;
    u.guardX = u.x;
    u.guardY = u.y;
    clearMove(u);
  };
  CG.orderAttack = function (G, u, t) {
    if (!CG.canTarget(G, u, t, true)) return false;
    u.order = { type: 'attack', id: t.id };
    u.target = t.id;
    u.repathT = 0;
    if (u.air || u.def.weapon.proj === 'self') CG.setGoal(G, u, t.x, t.y);
    return true;
  };
  CG.orderHarvest = function (G, u, tile) {
    releaseClaim(G, u);
    u.order = { type: 'harvest' };
    u.hs = u.carry >= u.def.capacity ? 'toRef' : 'find';
    if (tile !== undefined && tile >= 0) {
      u.fieldX = (tile % G.map.w) * T + T / 2;
      u.fieldY = Math.floor(tile / G.map.w) * T + T / 2;
    }
    clearMove(u);
  };
  CG.orderReturn = function (G, u, ref) {
    releaseClaim(G, u);
    u.order = { type: 'harvest' };
    u.hs = 'toRef';
    u.refId = ref ? ref.id : 0;
    clearMove(u);
  };
  CG.orderCapture = function (G, u, b) {
    u.order = { type: b.owner === u.owner ? 'repair' : 'capture', id: b.id };
    u.repathT = 0;
    clearMove(u);
  };
  CG.orderDeploy = function (G, u) {
    u.order = { type: 'deploy' };
    clearMove(u);
  };

  // formação: distribui destinos em grelha à volta do ponto clicado
  CG.formationSlots = function (G, units, x, y) {
    const m = G.map;
    const n = units.length;
    if (n === 1) return [{ x, y }];
    const air = units.filter((u) => u.air).length > n / 2;
    let sp = 0;
    for (const u of units) sp = Math.max(sp, u.def.radius * 2 + 6);
    sp = Math.max(sp, 16);
    const cols = Math.ceil(Math.sqrt(n));
    const slots = [];
    const used = new Set();
    let ring = 0;
    while (slots.length < n && ring < 40) {
      for (let r = 0; r < cols + ring && slots.length < n * 3; r++)
        for (let c = 0; c < cols + ring; c++) {
          const sx = x + (c - (cols + ring - 1) / 2) * sp, sy = y + (r - (cols + ring - 1) / 2) * sp;
          const key = Math.round(sx) + ',' + Math.round(sy);
          if (used.has(key)) continue;
          used.add(key);
          const tx = Math.floor(sx / T), ty = Math.floor(sy / T);
          if (!air && !m.passable(tx, ty)) continue;
          if (sx < 4 || sy < 4 || sx > m.pxW - 4 || sy > m.pxH - 4) continue;
          slots.push({ x: sx, y: sy, d: CG.dist2(sx, sy, x, y) });
        }
      ring++;
    }
    slots.sort((a, b) => a.d - b.d);
    slots.length = Math.min(slots.length, n);
    while (slots.length < n) slots.push({ x, y });
    return slots;
  };

  // atribuição gulosa: unidade mais distante escolhe primeiro o slot mais próximo
  CG.groupMove = function (G, units, x, y, amove) {
    const slots = CG.formationSlots(G, units, x, y);
    const order = units.slice().sort((a, b) => CG.dist2(b.x, b.y, x, y) - CG.dist2(a.x, a.y, x, y));
    const free = slots.slice();
    for (const u of order) {
      let bi = 0, bd = 1e18;
      for (let i = 0; i < free.length; i++) {
        const d = CG.dist2(u.x, u.y, free[i].x, free[i].y);
        if (d < bd) { bd = d; bi = i; }
      }
      const s = free.splice(bi, 1)[0] || { x, y };
      CG.orderMove(G, u, s.x, s.y, amove);
    }
  };

  // ------------------------------------------------------------------ visibilidade e alvos
  CG.visibleTo = function (G, e, pid) {
    if (e.owner === pid) return true;
    const p = G.players[pid];
    if (!p) return true;
    const m = G.map;
    if (e.kind === 'bld') {
      for (let y = e.ty; y < e.ty + e.h; y++)
        for (let x = e.tx; x < e.tx + e.w; x++) if (p.vis[m.idx(x, y)]) return true;
      return false;
    }
    const tx = CG.clamp(Math.floor(e.x / T), 0, m.w - 1), ty = CG.clamp(Math.floor(e.y / T), 0, m.h - 1);
    if (!p.vis[ty * m.w + tx]) return false;
    if (e.def.stealth && e.firedT > 2.5 && !(e.revealed & (1 << pid))) return false;
    return true;
  };

  CG.canTarget = function (G, s, t, explicit) {
    const w = s.def.weapon;
    if (!w || !t || !t.alive || t === s) return false;
    if (t.owner === s.owner || t.owner < 0) return false;
    if (t.kind === 'unit' && t.air) { if (!w.hitsAir) return false; }
    else if (!w.hitsGround) return false;
    if (CG.WARHEADS[w.wh][t.def.armor] <= 0) return false;
    if (t.kind === 'bld' && t.selling > 0) return false;
    if (explicit && t.kind === 'bld' && (t.seen & (1 << s.owner))) return true;
    return CG.visibleTo(G, t, s.owner);
  };

  CG.weaponRange = function (G, s) {
    const w = s.def.weapon;
    if (!w) return 0;
    if (s.kind === 'bld') return w.range * G.players[s.owner].faction.mods.defRange;
    return w.range;
  };

  CG.acquire = function (G, s, radius) {
    const w = s.def.weapon;
    G.spatial.query(s.x, s.y, radius + 64, _n);
    let best = null, bs = 1e18;
    for (const e of _n) {
      if (!CG.canTarget(G, s, e, false)) continue;
      const d = CG.edgeDist(e, s.x, s.y);
      if (d > radius) continue;
      if (w.minRange && CG.dist(e.x, e.y, s.x, s.y) < w.minRange) continue;
      const mult = CG.WARHEADS[w.wh][e.def.armor];
      let score = d / mult;
      if (e.kind === 'bld') score += e.def.weapon ? 120 : 420;
      else if (!e.def.weapon) score += e.def.harvester ? 40 : 160;
      if (w.wh === 'HACK' && e.disabled > 1) score += 600;
      if (e.id === s.target) score -= 40;
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  };

  CG.aimAndFire = function (G, s, t, dt) {
    const w = s.def.weapon;
    const ang = Math.atan2(t.y - s.y, t.x - s.x);
    let aligned;
    if (s.kind === 'bld' || (s.kind === 'unit' && s.def.cat === 'veh')) {
      s.turret = CG.turnTo(s.turret, ang, (s.kind === 'bld' ? 5 : 4.5) * dt);
      aligned = Math.abs(CG.angDiff(s.turret, ang)) < 0.12;
    } else {
      s.angle = CG.turnTo(s.angle, ang, s.def.turn * dt);
      s.turret = s.angle;
      aligned = Math.abs(CG.angDiff(s.angle, ang)) < 0.18;
    }
    if (aligned && s.cd <= 0 && s.burst <= 0) CG.fire(G, s, t);
  };

  function burstStep(G, s, dt) {
    if (s.burst <= 0) return;
    s.burstT -= dt;
    if (s.burstT > 0) return;
    const w = s.def.weapon;
    const t = G.byId.get(s.burstTarget);
    if (t && t.alive) CG.launch(G, s, t, w, t.x, t.y);
    else CG.launch(G, s, null, w, s.burstX, s.burstY);
    s.burst--;
    s.burstT = w.burstGap;
  }

  // ------------------------------------------------------------------ movimento
  function tryMove(G, u, nx, ny) {
    const m = G.map;
    const r = Math.min(u.def.radius, 10) * 0.6;
    const ok = (x, y) =>
      m.passable(Math.floor(x / T), Math.floor(y / T)) &&
      m.passable(Math.floor((x + r) / T), Math.floor(y / T)) &&
      m.passable(Math.floor((x - r) / T), Math.floor(y / T)) &&
      m.passable(Math.floor(x / T), Math.floor((y + r) / T)) &&
      m.passable(Math.floor(x / T), Math.floor((y - r) / T));
    const inside = !m.passable(Math.floor(u.x / T), Math.floor(u.y / T));
    if (inside) {
      // preso dentro de um obstáculo (ex.: edifício colocado por cima): deixa sair
      u.x = nx;
      u.y = ny;
      return true;
    }
    if (ok(nx, ny)) { u.x = nx; u.y = ny; return true; }
    if (ok(nx, u.y)) { u.x = nx; return true; }
    if (ok(u.x, ny)) { u.y = ny; return true; }
    return false;
  }

  // avança no caminho; devolve true quando chega ao fim
  CG.step = function (G, u, dt) {
    if (u.pathPending) { u.moving = false; return false; }
    if (!u.path || u.pathIdx >= u.path.length) { u.moving = false; return true; }
    const wp = u.path[u.pathIdx];
    const dx = wp.x - u.x, dy = wp.y - u.y;
    const d = Math.hypot(dx, dy);
    const last = u.pathIdx === u.path.length - 1;
    const arriveR = last ? (u.air ? 6 : 4) : u.def.cat === 'veh' ? 14 : 10;
    if (d < arriveR) {
      u.pathIdx++;
      u.stuckT = 0;
      u.stuckD = 1e9;
      if (u.pathIdx >= u.path.length) { u.moving = false; return true; }
      return false;
    }
    const desired = Math.atan2(dy, dx);
    let sp = u.def.speed;
    if (u.air) {
      u.angle = CG.turnTo(u.angle, desired, u.def.turn * dt);
      u.speedNow = Math.min(sp, u.speedNow + sp * 2.5 * dt);
      const st = Math.min(u.speedNow * dt, d);
      u.x = CG.clamp(u.x + (dx / d) * st, 4, G.map.pxW - 4);
      u.y = CG.clamp(u.y + (dy / d) * st, 4, G.map.pxH - 4);
      u.moving = true;
      return false;
    }
    let mx, my, st;
    if (u.def.cat === 'veh') {
      u.angle = CG.turnTo(u.angle, desired, u.def.turn * dt);
      const ad = Math.abs(CG.angDiff(u.angle, desired));
      const f = ad < 0.2 ? 1 : ad > 1.4 ? 0 : Math.cos(ad);
      st = Math.min(sp * f * dt, d);
      mx = Math.cos(u.angle) * st;
      my = Math.sin(u.angle) * st;
    } else {
      u.angle = CG.turnTo(u.angle, desired, u.def.turn * dt);
      st = Math.min(sp * dt, d);
      mx = (dx / d) * st;
      my = (dy / d) * st;
    }
    if (st > 0) tryMove(G, u, u.x + mx, u.y + my);
    u.moving = st > 0;
    // deteção de bloqueio → recalcula caminho
    u.stuckT += dt;
    if (u.stuckT > 1.2) {
      if (d > u.stuckD - 6) {
        u.repaths++;
        if (u.repaths > 4 || !u.goal) { u.path = null; u.moving = false; return true; }
        G.path.request(u, u.goal.x, u.goal.y);
      }
      u.stuckT = 0;
      u.stuckD = d;
    }
    return false;
  };

  // separação local (evita sobreposição); veículos empurram infantaria
  const MASS = { inf: 1, veh: 4, air: 1 };
  function separate(G, u) {
    const r1 = u.def.radius;
    G.spatial.query(u.x, u.y, r1 + 18, _n);
    let px = 0, py = 0;
    for (const o of _n) {
      if (o === u || o.kind !== 'unit' || !o.alive || o.air !== u.air) continue;
      const r = (r1 + o.def.radius) * (u.air ? 1.1 : 0.85);
      const dx = u.x - o.x, dy = u.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 0.01;
      const ov = r - d;
      const m1 = MASS[u.def.cat] * (u.def.harvester ? 1.5 : 1), m2 = MASS[o.def.cat] * (o.def.harvester ? 1.5 : 1);
      let k = m2 / (m1 + m2);
      if (!u.moving && o.moving) k *= 1.2;
      if (u.moving && !o.moving) k *= 0.6;
      if (u.hs === 'unload' || u.hs === 'mine') k *= 0.3;
      const ux = d2 > 0.0001 ? dx / d : Math.cos(u.id), uy = d2 > 0.0001 ? dy / d : Math.sin(u.id);
      px += ux * ov * k * 0.5;
      py += uy * ov * k * 0.5;
    }
    if (px || py) {
      const lim = 2;
      px = CG.clamp(px, -lim, lim);
      py = CG.clamp(py, -lim, lim);
      if (u.air) {
        u.x = CG.clamp(u.x + px, 4, G.map.pxW - 4);
        u.y = CG.clamp(u.y + py, 4, G.map.pxH - 4);
      } else tryMove(G, u, u.x + px, u.y + py);
    }
  }

  // ------------------------------------------------------------------ comportamento por ordem
  function chase(G, u, t, dt) {
    u.repathT -= dt;
    if (!u.goal || u.repathT <= 0 && CG.dist2(u.goal.x, u.goal.y, t.x, t.y) > 40 * 40) {
      u.repathT = 0.8;
      CG.setGoal(G, u, t.x, t.y);
    }
    CG.step(G, u, dt);
  }

  function combatIdle(G, u, dt) {
    const w = u.def.weapon;
    const range = w.range;
    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.3 + G.rng.next() * 0.1;
      const cur = G.byId.get(u.target);
      const leashOk = CG.dist(u.x, u.y, u.guardX, u.guardY) < LEASH;
      if (!cur || !CG.canTarget(G, u, cur, false) || !leashOk || CG.edgeDist(cur, u.x, u.y) > range) {
        const acq = CG.acquire(G, u, leashOk ? Math.max(range, u.def.sight * T * 0.75) : range);
        u.target = acq ? acq.id : 0;
      }
    }
    const t = u.target ? G.byId.get(u.target) : null;
    if (t && t.alive) {
      if (w.proj === 'self') { kamikaze(G, u, t, dt); return; }
      const d = CG.edgeDist(t, u.x, u.y);
      if (d <= range) {
        if (u.path) clearMove(u);
        CG.aimAndFire(G, u, t, dt);
      } else if (CG.dist(u.x, u.y, u.guardX, u.guardY) < LEASH) chase(G, u, t, dt);
      else u.target = 0;
      return;
    }
    u.target = 0;
    // regressa à posição de guarda após perseguição
    if (!u.goal && CG.dist(u.x, u.y, u.guardX, u.guardY) > T * 1.5) CG.setGoal(G, u, u.guardX, u.guardY);
    if (u.goal || u.pathPending) {
      if (CG.step(G, u, dt)) clearMove(u);
    }
    if (u.def.cat === 'veh') u.turret = CG.turnTo(u.turret, u.angle, 1.5 * dt);
  }

  function kamikaze(G, u, t, dt) {
    const tx = t.x, ty = t.y;
    if (!u.goal || CG.dist2(u.goal.x, u.goal.y, tx, ty) > 100) CG.setGoal(G, u, tx, ty);
    CG.step(G, u, dt);
    const reach = t.kind === 'bld' ? CG.edgeDist(t, u.x, u.y) < 8 : CG.dist(u.x, u.y, tx, ty) < t.def.radius + 10;
    if (reach) CG.fire(G, u, t);
  }

  function attackOrder(G, u, dt) {
    const t = G.byId.get(u.order.id);
    if (!t || !CG.canTarget(G, u, t, true)) {
      u.order = null;
      u.target = 0;
      u.guardX = u.x;
      u.guardY = u.y;
      clearMove(u);
      return;
    }
    u.target = t.id;
    const w = u.def.weapon;
    if (w.proj === 'self') { kamikaze(G, u, t, dt); return; }
    const d = CG.edgeDist(t, u.x, u.y);
    if (d <= w.range && !(w.minRange && CG.dist(u.x, u.y, t.x, t.y) < w.minRange)) {
      if (u.path || u.goal) clearMove(u);
      CG.aimAndFire(G, u, t, dt);
    } else if (d > w.range) chase(G, u, t, dt);
  }

  function amoveOrder(G, u, dt) {
    const o = u.order;
    const w = u.def.weapon;
    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.3 + G.rng.next() * 0.1;
      const cur = G.byId.get(u.target);
      if (!cur || !CG.canTarget(G, u, cur, false) || CG.edgeDist(cur, u.x, u.y) > u.def.sight * T) {
        const acq = CG.acquire(G, u, Math.max(w.range, u.def.sight * T * 0.85));
        u.target = acq ? acq.id : 0;
      }
    }
    const t = u.target ? G.byId.get(u.target) : null;
    if (t && t.alive) {
      if (w.proj === 'self') { kamikaze(G, u, t, dt); return; }
      const d = CG.edgeDist(t, u.x, u.y);
      if (d <= w.range) {
        if (u.path) clearMove(u);
        CG.aimAndFire(G, u, t, dt);
      } else chase(G, u, t, dt);
      return;
    }
    u.target = 0;
    if (!u.goal || CG.dist2(u.goal.x, u.goal.y, o.x, o.y) > 4) CG.setGoal(G, u, o.x, o.y);
    if (CG.step(G, u, dt)) {
      u.order = null;
      u.guardX = u.x;
      u.guardY = u.y;
      clearMove(u);
    }
    if (u.def.cat === 'veh') u.turret = CG.turnTo(u.turret, u.angle, 2 * dt);
  }

  // ------------------------------------------------------------------ colheita
  function findResTile(G, u, fx, fy) {
    const m = G.map;
    const cx = Math.floor(fx / T), cy = Math.floor(fy / T);
    let best = -1, bs = 1e18;
    const R = 10;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!m.inBounds(x, y)) continue;
        const i = y * m.w + x;
        if (m.res[i] < 20 || m.block[i] !== 0) continue;
        const s = dx * dx + dy * dy + G.claims[i] * 16;
        if (s < bs) { bs = s; best = i; }
      }
    if (best >= 0) return best;
    // procura noutros campos: o mais próximo com recursos
    let bf = null, bd = 1e18;
    for (const f of m.fields) {
      let any = false;
      for (const i of f.tiles) if (m.res[i] >= 20 && m.block[i] === 0) { any = true; break; }
      if (!any) continue;
      const d = CG.dist2(f.x * T, f.y * T, u.x, u.y);
      if (d < bd) { bd = d; bf = f; }
    }
    if (!bf) return -1;
    for (const i of bf.tiles) {
      if (m.res[i] < 20 || m.block[i] !== 0) continue;
      const s = CG.dist2((i % m.w) * T, Math.floor(i / m.w) * T, u.x, u.y) + G.claims[i] * 16 * T * T;
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }

  function nearestRefinery(G, u) {
    let best = null, bd = 1e18;
    for (const e of G.entities) {
      if (e.kind !== 'bld' || !e.alive || e.owner !== u.owner || !e.def.refinery || e.built < 1 || e.selling > 0) continue;
      const d = CG.dist2(e.dockX, e.dockY, u.x, u.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function harvest(G, u, dt) {
    const m = G.map;
    const cap = u.def.capacity;
    switch (u.hs) {
      case 'find': {
        if (u.carry >= cap) { u.hs = 'toRef'; break; }
        const fx = u.fieldX >= 0 ? u.fieldX : u.x, fy = u.fieldX >= 0 ? u.fieldY : u.y;
        const t = findResTile(G, u, fx, fy);
        if (t < 0) {
          if (u.carry > 0) u.hs = 'toRef';
          else {
            u.waitT += dt;
            if (u.waitT > 4) { u.waitT = 0; u.fieldX = -1; }
          }
          break;
        }
        releaseClaim(G, u);
        u.resTile = t;
        G.claims[t]++;
        CG.setGoal(G, u, (t % m.w) * T + T / 2, Math.floor(t / m.w) * T + T / 2);
        u.hs = 'goto';
        break;
      }
      case 'goto': {
        const t = u.resTile;
        if (t < 0 || m.res[t] < 1) { releaseClaim(G, u); u.hs = 'find'; break; }
        const tx = (t % m.w) * T + T / 2, ty = Math.floor(t / m.w) * T + T / 2;
        const d = CG.dist(u.x, u.y, tx, ty);
        if (d < 12) { clearMove(u); u.hs = 'mine'; u.harvT = 0.3; break; }
        if (CG.step(G, u, dt)) {
          if (d < T * 1.3) { clearMove(u); u.hs = 'mine'; }
          else { releaseClaim(G, u); u.hs = 'find'; u.fieldX = -1; }
        }
        break;
      }
      case 'mine': {
        u.harvT -= dt;
        if (u.harvT > 0) break;
        u.harvT = 0.3;
        const t = u.resTile;
        const got = t >= 0 ? m.takeRes(t, Math.min(25, cap - u.carry)) : 0;
        u.carry += got;
        if (t >= 0) {
          u.fieldX = (t % m.w) * T + T / 2;
          u.fieldY = Math.floor(t / m.w) * T + T / 2;
        }
        if (got > 0 && CG.fx) CG.fx.dust(G, u.x + Math.cos(u.angle) * 12, u.y + Math.sin(u.angle) * 12);
        if (u.carry >= cap - 0.5) { releaseClaim(G, u); u.hs = 'toRef'; }
        else if (got <= 0) { releaseClaim(G, u); u.hs = 'find'; }
        break;
      }
      case 'toRef': {
        let ref = G.byId.get(u.refId);
        if (!ref || !ref.alive || ref.owner !== u.owner || ref.built < 1) ref = nearestRefinery(G, u);
        if (!ref) {
          u.waitT += dt;
          if (u.waitT > 1) { u.waitT = 0; CG.notify(G, u.owner, 'Sem refinaria para descarregar', { kind: 'warn', cooldown: 30 }); }
          break;
        }
        u.refId = ref.id;
        CG.setGoal(G, u, ref.dockX, ref.dockY);
        u.hs = 'goingRef';
        break;
      }
      case 'goingRef': {
        const ref = G.byId.get(u.refId);
        if (!ref || !ref.alive || ref.owner !== u.owner) { u.refId = 0; u.hs = 'toRef'; break; }
        const d = CG.dist(u.x, u.y, ref.dockX, ref.dockY);
        if (d < 14) { clearMove(u); u.hs = 'unload'; u.unloadSnd = false; break; }
        if (CG.step(G, u, dt)) {
          if (d < 40) { clearMove(u); u.hs = 'unload'; u.unloadSnd = false; }
          else u.hs = 'toRef';
        }
        break;
      }
      case 'unload': {
        const ref = G.byId.get(u.refId);
        if (!ref || !ref.alive || ref.owner !== u.owner) { u.hs = 'toRef'; break; }
        u.angle = CG.turnTo(u.angle, -Math.PI / 2, 3 * dt);
        const p = G.players[u.owner];
        const a = Math.min(u.carry, 320 * dt);
        u.carry -= a;
        const inc = a * p.incomeMult;
        p.credits += inc;
        p.stats.harvested += inc;
        ref.anim += dt * 4;
        if (!u.unloadSnd && u.owner === G.human && CG.audio) { u.unloadSnd = true; CG.audio.play('deposit', u.x, u.y); }
        if (u.carry <= 0.01) { u.carry = 0; u.hs = 'find'; }
        break;
      }
      default:
        u.hs = 'find';
    }
  }

  // ------------------------------------------------------------------ engenheiro e MCV
  function engineer(G, u, dt) {
    const b = G.byId.get(u.order.id);
    if (!b || !b.alive || b.kind !== 'bld') { CG.orderStop(G, u); return; }
    const capture = u.order.type === 'capture';
    if (capture && (b.owner === u.owner || !b.def.capturable)) { CG.orderStop(G, u); return; }
    if (!capture && b.owner !== u.owner) { CG.orderStop(G, u); return; }
    const d = CG.edgeDist(b, u.x, u.y);
    if (d < 14) {
      if (capture) {
        CG.capture(G, b, u.owner);
      } else {
        b.hp = b.maxHp;
        if (CG.fx) CG.fx.ring(G, b.x, b.y, 40, '#7dff9a');
        CG.notify(G, u.owner, 'Edifício reparado', { sound: 'buildDone' });
      }
      u.silent = true;
      CG.kill(G, u, -1);
      return;
    }
    u.repathT -= dt;
    if (!u.goal || u.repathT <= 0 && !u.moving) {
      u.repathT = 1.5;
      const cx = CG.clamp(u.x, b.x0, b.x1), cy = CG.clamp(u.y, b.y0, b.y1);
      CG.setGoal(G, u, cx, cy);
    }
    CG.step(G, u, dt);
  }

  CG.deployTile = (u) => ({ x: Math.floor(u.x / T) - 1, y: Math.floor(u.y / T) - 1 });

  function deploy(G, u) {
    const t = CG.deployTile(u);
    const r = CG.canPlace(G, u.owner, 'conyard', t.x, t.y, { anywhere: true, ignore: u.id });
    if (!r.ok) {
      CG.notify(G, u.owner, 'Não é possível implantar aqui', { kind: 'warn', sound: 'error', cooldown: 1 });
      u.order = null;
      return;
    }
    u.silent = true;
    CG.kill(G, u, -1);
    const b = CG.spawnBuilding(G, 'conyard', u.owner, t.x, t.y, {});
    G.players[u.owner].stats.bldBuilt++;
    if (u.owner === G.human && CG.audio) CG.audio.play('place', b.x, b.y);
  }

  // ------------------------------------------------------------------ atualização por tick
  CG.updateUnit = function (G, u, dt) {
    u.firedT += dt;
    u.hitT += dt;
    if (u.cd > 0) u.cd -= dt;
    if (u.disabled > 0) {
      u.disabled -= dt;
      u.moving = false;
      return;
    }
    burstStep(G, u, dt);
    const o = u.order;
    const type = o ? o.type : null;
    if (type === 'harvest') harvest(G, u, dt);
    else if (type === 'capture' || type === 'repair') engineer(G, u, dt);
    else if (type === 'deploy') deploy(G, u);
    else if (type === 'attack') attackOrder(G, u, dt);
    else if (type === 'amove') amoveOrder(G, u, dt);
    else if (type === 'move') {
      if (CG.step(G, u, dt)) {
        u.order = null;
        u.guardX = u.x;
        u.guardY = u.y;
        clearMove(u);
      }
      if (u.def.cat === 'veh') u.turret = CG.turnTo(u.turret, u.angle, 2 * dt);
    } else if (u.def.weapon) combatIdle(G, u, dt);
    else if (u.goal || u.pathPending) {
      if (CG.step(G, u, dt)) clearMove(u);
    }
    if (u.alive) separate(G, u);
  };

  CG.updateBuilding = function (G, b, dt) {
    if (b.built < 1) {
      b.built = Math.min(1, b.built + dt / 1.2);
      if (b.built >= 1) {
        CG.onBuilt(G, b, false);
        if (b.def.conyard) CG.notify(G, b.owner, 'Centro de Comando implantado', { cooldown: 1 });
      }
      return;
    }
    b.firedT += dt;
    b.hitT += dt;
    if (b.selling > 0) {
      b.selling += dt;
      if (b.selling >= 1) {
        const p = G.players[b.owner];
        if (p) p.credits += Math.round(CG.costOf(p, b.def) * 0.5 * (b.hp / b.maxHp));
        b.sold = true;
        CG.kill(G, b, -1);
      }
      return;
    }
    if (b.disabled > 0) {
      b.disabled -= dt;
      if (b.disabled <= 0) {
        b.disabled = 0;
        const p = G.players[b.owner];
        if (p) CG.refreshPlayer(G, p);
      }
      return;
    }
    const p = G.players[b.owner];
    if (!p) return;
    if (b.repairing) {
      if (b.hp >= b.maxHp) b.repairing = false;
      else {
        const amt = b.maxHp * 0.06 * dt;
        const cost = CG.costOf(p, b.def) * 0.5 * (amt / b.maxHp);
        if (p.credits >= cost) {
          p.credits -= cost;
          b.hp = Math.min(b.maxHp, b.hp + amt);
        } else {
          b.repairing = false;
          CG.notify(G, p.id, 'Fundos insuficientes para reparar', { kind: 'warn', cooldown: 10 });
        }
      }
    }
    if (b.def.income) {
      b.incomeT += dt;
      if (b.incomeT >= b.def.incomeEvery) {
        b.incomeT = 0;
        const inc = b.def.income * p.incomeMult;
        p.credits += inc;
        p.stats.harvested += inc;
        if (b.owner === G.human && CG.fx) CG.fx.floatText(G, b.x, b.y - 20, '+' + Math.round(inc), '#ffd34d');
      }
    }
    const w = b.def.weapon;
    if (!w) return;
    if (b.cd > 0) b.cd -= dt;
    burstStep(G, b, dt);
    if (b.def.needsPower && p.lowPower) { b.target = 0; return; }
    const range = CG.weaponRange(G, b);
    b.scanT -= dt;
    if (b.scanT <= 0) {
      b.scanT = 0.3;
      const cur = G.byId.get(b.target);
      if (!cur || !CG.canTarget(G, b, cur, false) || CG.edgeDist(cur, b.x, b.y) > range) {
        const acq = CG.acquire(G, b, range);
        b.target = acq ? acq.id : 0;
      }
    }
    const t = b.target ? G.byId.get(b.target) : null;
    if (t && t.alive) CG.aimAndFire(G, b, t, dt);
  };
})();
