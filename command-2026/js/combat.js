/* Combate: disparo, projéteis, dano com área, poderes de apoio; efeitos de partículas e tremor de ecrã */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const _n = [];

  // ------------------------------------------------------------------ disparo
  CG.fire = function (G, s, t) {
    const w = s.def.weapon;
    s.cd = w.cd * (0.95 + G.rng.next() * 0.1);
    s.firedT = 0;
    if (w.burst > 1) {
      s.burst = w.burst - 1;
      s.burstT = w.burstGap;
      s.burstTarget = t.id;
      s.burstX = t.x;
      s.burstY = t.y;
    }
    CG.launch(G, s, t, w, t.x, t.y);
  };

  CG.launch = function (G, s, t, w, ax, ay) {
    const ang = s.turret;
    const len = s.kind === 'bld' ? 14 : s.def.radius * 0.9 + 4;
    const sz = s.z || 0;
    const mx = s.x + Math.cos(ang) * len, my = s.y + Math.sin(ang) * len;
    let tx = ax, ty = ay;
    if (w.scatter) {
      const a = G.rng.next() * CG.TAU, r = Math.sqrt(G.rng.next()) * w.scatter;
      tx += Math.cos(a) * r;
      ty += Math.sin(a) * r;
    }
    const tz = t && t.kind === 'unit' ? t.z : 0;
    if (CG.audio && w.snd) CG.audio.play(w.snd, s.x, s.y);
    switch (w.proj) {
      case 'bullet':
        if (CG.fx) {
          CG.fx.muzzle(G, mx, my - sz, ang, w.wh === 'SNIPE' ? 1.2 : w.dmg > 10 ? 1 : 0.6);
          CG.fx.tracer(G, mx, my - sz, tx + G.rng.range(-3, 3), ty - tz + G.rng.range(-3, 3), w.wh === 'AA' ? '#ffe28a' : w.wh === 'SNIPE' ? '#ffffff' : '#ffd27a');
        }
        if (t && t.alive) CG.damage(G, t, w.dmg, w.wh, s);
        break;
      case 'zap':
        if (CG.fx) CG.fx.zap(G, mx, my - sz, tx, ty - tz);
        if (t && t.alive) CG.damage(G, t, 0, 'HACK', s, w.hackTime);
        break;
      case 'self':
        CG.explodeAt(G, s.x, s.y, w, s.owner, t ? t.id : 0, s);
        s.silent = true;
        CG.kill(G, s, -1);
        if (CG.fx) CG.fx.explosion(G, s.x, s.y, 0.8);
        break;
      default: {
        if (CG.fx) CG.fx.muzzle(G, mx, my - sz, ang, w.proj === 'shell' ? 1.4 : 0.8);
        const d = Math.hypot(tx - mx, ty - my);
        const sp = w.speed || 400;
        G.projectiles.push({
          kind: w.proj, w, owner: s.owner, srcId: s.id, targetId: t ? t.id : 0,
          x: mx, y: my, z: sz, sz, h: 0, sx: mx, sy: my, tx, ty, tz,
          t: 0, dur: Math.max(0.08, d / sp), ang: Math.atan2(ty - my, tx - mx), trailT: 0,
          arc: w.proj === 'arty' ? Math.min(160, d * 0.35) : w.proj === 'lob' ? Math.min(60, d * 0.3) : w.proj === 'rocket' ? Math.min(50, d * 0.12) : 0,
          alive: true,
        });
      }
    }
  };

  CG.updateProjectiles = function (G, dt) {
    const list = G.projectiles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive) continue;
      if (p.kind === 'missile') {
        const t = G.byId.get(p.targetId);
        if (t && t.alive) {
          p.tx = t.x;
          p.ty = t.y;
          p.tz = t.z || 0;
        }
        const sp = p.w.speed;
        const want = Math.atan2(p.ty - p.y, p.tx - p.x);
        p.ang = CG.turnTo(p.ang, want, 7 * dt);
        p.x += Math.cos(p.ang) * sp * dt;
        p.y += Math.sin(p.ang) * sp * dt;
        p.z = CG.lerp(p.z, p.tz, Math.min(1, dt * 5));
        p.t += dt;
        p.trailT -= dt;
        if (p.trailT <= 0 && CG.fx) { p.trailT = 0.025; CG.fx.smokePuff(G, p.x, p.y - p.z, 0.5); }
        if (Math.hypot(p.tx - p.x, p.ty - p.y) < sp * dt + 6 || p.t > 4) {
          p.alive = false;
          impact(G, p, p.tx, p.ty);
        }
        continue;
      }
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.x = CG.lerp(p.sx, p.tx, k);
      p.y = CG.lerp(p.sy, p.ty, k);
      p.z = CG.lerp(p.sz, p.tz, k);
      p.h = p.arc * 4 * k * (1 - k);
      if (p.kind === 'rocket' || p.kind === 'arty') {
        p.trailT -= dt;
        if (p.trailT <= 0 && CG.fx) { p.trailT = p.kind === 'rocket' ? 0.02 : 0.05; CG.fx.smokePuff(G, p.x, p.y - p.h - p.z, p.kind === 'rocket' ? 0.6 : 0.4); }
      }
      if (k >= 1) {
        p.alive = false;
        impact(G, p, p.tx, p.ty);
      }
    }
    let j = 0;
    for (let i = 0; i < list.length; i++) if (list[i].alive) list[j++] = list[i];
    list.length = j;
  };

  function impact(G, p, x, y) {
    const w = p.w;
    const t = G.byId.get(p.targetId);
    const src = G.byId.get(p.srcId) || { owner: p.owner, id: p.srcId, kind: 'none', x: p.sx, y: p.sy };
    if (w.splash > 0) {
      CG.explodeAt(G, x, y, w, p.owner, p.targetId, src);
    } else if (t && t.alive) {
      const close = t.kind === 'bld' ? CG.edgeDist(t, x, y) < 20 : CG.dist(t.x, t.y, x, y) < t.def.radius + 20;
      if (close) CG.damage(G, t, w.dmg, w.wh, src);
    }
    if (CG.fx) {
      const air = t && t.kind === 'unit' && t.air;
      const size = w.wh === 'HE' ? 0.9 + w.dmg / 120 : w.proj === 'shell' ? 0.7 : 0.55;
      CG.fx.explosion(G, x, air ? y - p.tz : y, size);
      if (!air && (w.proj === 'arty' || w.proj === 'shell' || w.proj === 'rocket')) CG.fx.crater(G, x, y, size);
      if (w.shake) CG.shake(G, w.shake, x, y);
    }
  }

  // dano em área (sem fogo amigo)
  CG.explodeAt = function (G, x, y, w, owner, directId, src) {
    const r = w.splash || 12;
    G.spatial.query(x, y, r + 48, _n);
    for (const e of _n) {
      if (!e.alive || e.owner === owner || e.owner < 0) continue;
      if (e.kind === 'unit' && e.air && !w.hitsAir) continue;
      const d = CG.edgeDist(e, x, y);
      if (d > r && e.id !== directId) continue;
      const f = e.id === directId ? 1 : Math.max(0.25, 1 - (d / r) * 0.6);
      CG.damage(G, e, w.dmg * f, w.wh, src);
    }
  };

  CG.damage = function (G, t, amount, wh, src, hackTime) {
    if (!t.alive) return;
    const mult = CG.WARHEADS[wh][t.def.armor] || 0;
    if (wh === 'HACK') {
      if (mult > 0) {
        t.disabled = Math.max(t.disabled, hackTime || 6);
        if (t.kind === 'bld') { const p = G.players[t.owner]; if (p) CG.refreshPlayer(G, p); }
      }
    } else {
      if (mult <= 0) return;
      t.hp -= amount * mult;
    }
    t.hitT = 0;
    if (src && src.id) t.lastAttacker = src.id;
    // retaliação: unidades paradas respondem ao atacante
    if (t.kind === 'unit' && !t.order && src && src.kind === 'unit' && src.alive && CG.canTarget(G, t, src, false)) {
      if (!t.target) t.target = src.id;
    }
    if (t.owner === G.human && src && src.owner !== undefined && src.owner !== t.owner) {
      if (t.kind === 'bld') CG.notify(G, t.owner, 'A nossa base está sob ataque', { kind: 'alert', sound: 'alarm', key: 'baseAtk', cooldown: 20, x: t.x, y: t.y });
      else if (!t.def.harvester) CG.notify(G, t.owner, 'Unidades sob ataque', { kind: 'alert', key: 'unitAtk', cooldown: 25, x: t.x, y: t.y, voice: false });
      else CG.notify(G, t.owner, 'Extrator sob ataque', { kind: 'alert', key: 'harvAtk', cooldown: 25, x: t.x, y: t.y });
      if (CG.ui && CG.ui.ping) CG.ui.ping(t.x, t.y);
    }
    const ai = G.players[t.owner] && G.players[t.owner].ai;
    if (ai && src && src.owner !== t.owner) ai.onAttacked(t, src);
    if (t.hp <= 0) CG.kill(G, t, src ? src.owner : -1);
    else if (t.kind === 'bld' && t.def.power > 0) {
      const p = G.players[t.owner];
      if (p && G.tick % 6 === 0) CG.refreshPlayer(G, p);
    }
  };

  CG.shake = function (G, amount, x, y) {
    const c = G.cam;
    const vx = c.x + c.vw / 2, vy = c.y + c.vh / 2;
    const d = Math.hypot(x - vx, y - vy);
    const f = CG.clamp(1 - d / (Math.max(c.vw, c.vh) * 1.2), 0, 1);
    G.shakeAmt = Math.min(16, G.shakeAmt + amount * f);
  };

  // ------------------------------------------------------------------ poderes de apoio
  CG.updatePowers = function (G, p, dt) {
    for (const id of p.faction.powers) {
      const pw = p.powers[id];
      const def = CG.POWERS[id];
      if (!pw.avail || p.lowPower) continue;
      if (pw.charge < 1) {
        pw.charge = Math.min(1, pw.charge + dt / def.cd);
        if (pw.charge >= 1) CG.notify(G, p.id, def.name + ' pronto', { sound: 'powerReady', cooldown: 2 });
      }
    }
  };

  CG.usePower = function (G, p, id, x, y) {
    const pw = p.powers[id];
    const def = CG.POWERS[id];
    if (!pw || !pw.avail || pw.charge < 1) return false;
    pw.charge = 0;
    const r = def.radius * T;
    p.stats.powers++;
    const enemyNotice = (txt) => {
      for (const q of G.players) if (q.id !== p.id) CG.notify(G, q.id, txt, { kind: 'alert', sound: 'alarm', x, y, cooldown: 2 });
    };
    switch (def.kind) {
      case 'reveal':
        G.reveals.push({ owner: p.id, x, y, r, t: def.dur });
        if (CG.fx) CG.fx.ring(G, x, y, r, '#7fd8ff', 1.2);
        if (CG.audio) CG.audio.play('scan', x, y);
        break;
      case 'strike':
        G.strikes.push({ kind: id, owner: p.id, x, y, r, dmg: def.dmg, t: def.delay, total: def.delay });
        G.reveals.push({ owner: p.id, x, y, r: r + 2 * T, t: def.delay + 4 });
        enemyNotice(id === 'orbital' ? 'Ataque orbital detetado' : 'Lançamento de míssil detetado');
        if (CG.audio) CG.audio.play(id === 'orbital' ? 'orbitalCharge' : 'missileLaunch', x, y);
        break;
      case 'barrage':
        G.strikes.push({ kind: 'barrage', owner: p.id, x, y, r, dmg: def.dmg, t: def.dur, total: def.dur, shells: def.shells, fired: 0 });
        G.reveals.push({ owner: p.id, x, y, r: r + 2 * T, t: def.dur + 3 });
        enemyNotice('Barragem de artilharia a caminho');
        break;
      case 'cyber': {
        G.spatial.query(x, y, r + 64, _n);
        const victims = new Set();
        for (const e of _n) {
          if (!e.alive || e.owner === p.id || e.owner < 0 || e.kind !== 'bld') continue;
          if (CG.edgeDist(e, x, y) > r) continue;
          e.disabled = Math.max(e.disabled, def.dur);
          victims.add(e.owner);
          if (CG.fx) CG.fx.sparks(G, e.x, e.y, '#7dfcff');
        }
        let stolen = 0;
        for (const vid of victims) {
          const v = G.players[vid];
          const s = Math.min(2000, Math.floor(v.credits * def.steal));
          v.credits -= s;
          stolen += s;
          CG.refreshPlayer(G, v);
          CG.notify(G, vid, 'Ciberataque! Sistemas comprometidos', { kind: 'alert', sound: 'alarm', x, y });
        }
        p.credits += stolen;
        if (stolen > 0) CG.notify(G, p.id, 'Ciberataque: ₵' + CG.fmt(stolen) + ' transferidos', { cooldown: 0 });
        G.reveals.push({ owner: p.id, x, y, r: r + 3 * T, t: 10 });
        if (CG.fx) { CG.fx.ring(G, x, y, r, '#55f7ff', 1); CG.fx.glitch(G, x, y, r); }
        if (CG.audio) CG.audio.play('hack', x, y);
        break;
      }
      case 'emp': {
        G.spatial.query(x, y, r + 64, _n);
        for (const e of _n) {
          if (!e.alive || e.owner === p.id || e.owner < 0) continue;
          if (e.kind === 'unit' && e.def.cat === 'inf') continue;
          if (CG.edgeDist(e, x, y) > r) continue;
          e.disabled = Math.max(e.disabled, def.dur);
          if (e.kind === 'bld') { const q = G.players[e.owner]; if (q) CG.refreshPlayer(G, q); }
        }
        enemyNotice('Pulso EMP! Sistemas desativados');
        if (CG.fx) { CG.fx.ring(G, x, y, r, '#8ad8ff', 1.4); CG.fx.ring(G, x, y, r * 0.6, '#ffffff', 0.8); }
        CG.shake(G, 5, x, y);
        if (CG.audio) CG.audio.play('emp', x, y);
        break;
      }
    }
    return true;
  };

  CG.updateStrikes = function (G, dt) {
    for (const s of G.strikes) {
      s.t -= dt;
      if (s.kind === 'barrage') {
        const due = Math.floor((1 - Math.max(0, s.t) / s.total) * s.shells);
        while (s.fired < due) {
          s.fired++;
          const a = G.rng.next() * CG.TAU, rr = Math.sqrt(G.rng.next()) * s.r;
          const tx = s.x + Math.cos(a) * rr, ty = s.y + Math.sin(a) * rr;
          const w = { wh: 'HE', dmg: s.dmg, splash: 1.3 * T, hitsAir: false, proj: 'arty', speed: 500, shake: 2.5, scatter: 0 };
          G.projectiles.push({ kind: 'arty', w, owner: s.owner, srcId: 0, targetId: 0, x: tx - 300, y: ty - 500, z: 0, sz: 0, h: 0, sx: tx - 300, sy: ty - 500, tx, ty, tz: 0, t: 0, dur: 1.1, ang: 0, trailT: 0, arc: 40, alive: true });
          if (CG.audio && G.rng.chance(0.4)) CG.audio.play('incoming', tx, ty);
        }
        if (s.t <= -1.2) s.done = true;
        continue;
      }
      if (s.t <= 0 && !s.done) {
        s.done = true;
        const w = { wh: 'SUPER', dmg: s.dmg, splash: s.r, hitsAir: true };
        G.spatial.query(s.x, s.y, s.r + 64, _n);
        for (const e of _n) {
          if (!e.alive || e.owner === s.owner || e.owner < 0) continue;
          const d = CG.edgeDist(e, s.x, s.y);
          if (d > s.r) continue;
          CG.damage(G, e, s.dmg * Math.max(0.3, 1 - (d / s.r) * 0.7), 'SUPER', { owner: s.owner, id: 0, kind: 'power', alive: false });
        }
        if (CG.fx) CG.fx.bigBlast(G, s.x, s.y, s.r, s.kind);
        CG.shake(G, 14, s.x, s.y);
        if (CG.audio) CG.audio.play('superBlast', s.x, s.y);
      }
    }
    G.strikes = G.strikes.filter((s) => !s.done || (s.kind !== 'barrage' && s.t > -1.5));
  };

  // ------------------------------------------------------------------ partículas
  const MAX_P = 1800;
  function P(G, o) {
    if (G.particles.length >= MAX_P) G.particles.shift();
    o.t = 0;
    G.particles.push(o);
    return o;
  }
  CG.fx = {
    muzzle(G, x, y, ang, s) {
      P(G, { k: 'flash', x, y, ang, life: 0.06, size: 7 * s });
    },
    tracer(G, x1, y1, x2, y2, color) {
      P(G, { k: 'tracer', x: x1, y: y1, x2, y2, life: 0.07, color });
    },
    zap(G, x1, y1, x2, y2) {
      P(G, { k: 'zap', x: x1, y: y1, x2, y2, life: 0.35, seed: Math.random() * 1000 });
      this.sparks(G, x2, y2, '#7dfcff');
    },
    smokePuff(G, x, y, s) {
      P(G, { k: 'smoke', x, y, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 4, life: 0.7 + Math.random() * 0.5, size: 3 * s, grow: 10 * s, a: 0.35 });
    },
    dust(G, x, y) {
      P(G, { k: 'dust', x, y, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, life: 0.6, size: 4, grow: 8, a: 0.35 });
    },
    sparks(G, x, y, color) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * CG.TAU, sp = 40 + Math.random() * 80;
        P(G, { k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.2, color: color || '#ffd27a' });
      }
    },
    explosion(G, x, y, s) {
      P(G, { k: 'flash2', x, y, life: 0.12, size: 22 * s });
      const n = Math.round(5 + 7 * s);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * CG.TAU, sp = (20 + Math.random() * 60) * s;
        P(G, { k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.35, size: (4 + Math.random() * 6) * s, grow: 8 * s });
      }
      for (let i = 0; i < Math.round(3 + 4 * s); i++) {
        const a = Math.random() * CG.TAU, sp = (10 + Math.random() * 25) * s;
        P(G, { k: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 8, life: 1 + Math.random() * 1.2, size: (6 + Math.random() * 6) * s, grow: 16 * s, a: 0.45 });
      }
      if (s > 0.8) for (let i = 0; i < 5; i++) {
        const a = Math.random() * CG.TAU, sp = 60 + Math.random() * 90;
        P(G, { k: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 80 + Math.random() * 80, z: 0, life: 0.8, size: 2 + Math.random() * 2 });
      }
      if (CG.audio && s >= 0.7) CG.audio.play(s > 1.4 ? 'explodeBig' : 'explodeSmall', x, y);
    },
    ring(G, x, y, r, color, life) {
      P(G, { k: 'ring', x, y, r, life: life || 0.6, color });
    },
    glitch(G, x, y, r) {
      for (let i = 0; i < 14; i++) P(G, { k: 'glitch', x: x + (Math.random() - 0.5) * r * 1.6, y: y + (Math.random() - 0.5) * r * 1.6, life: 0.4 + Math.random() * 0.6, size: 6 + Math.random() * 18 });
    },
    floatText(G, x, y, text, color) {
      P(G, { k: 'text', x, y, vy: -18, vx: 0, life: 1.2, text, color });
    },
    crater(G, x, y, s) {
      G.decals.push({ k: 'crater', x, y, r: 6 + 6 * s, t: 0, life: 40, rot: Math.random() * 6 });
      if (G.decals.length > 220) G.decals.shift();
    },
    unitDeath(G, u) {
      const c = u.def.cat;
      if (c === 'inf') {
        P(G, { k: 'corpse', x: u.x, y: u.y, ang: u.angle, life: 2.5, owner: u.owner });
        this.dust(G, u.x, u.y);
        if (CG.audio) CG.audio.play('infDie', u.x, u.y);
      } else if (c === 'veh') {
        this.explosion(G, u.x, u.y, 1.1 + u.def.radius / 20);
        G.decals.push({ k: 'wreck', x: u.x, y: u.y, r: u.def.radius, t: 0, life: 25, rot: u.angle });
        if (G.decals.length > 220) G.decals.shift();
        CG.shake(G, 2.5, u.x, u.y);
      } else {
        this.explosion(G, u.x, u.y - u.z, u.def.kamikaze ? 0.6 : 1.1);
        if (!u.def.kamikaze) this.crater(G, u.x, u.y, 0.7);
      }
    },
    buildingDeath(G, b) {
      const n = 4 + b.w * b.h;
      for (let i = 0; i < n; i++) {
        P(G, { k: 'delayBlast', x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 + Math.random() * (b.y1 - b.y0), life: 0.05 + i * 0.09, s: 0.9 + Math.random() * 0.8 });
      }
      G.decals.push({ k: 'rubble', x: b.x, y: b.y, w: b.x1 - b.x0, h: b.y1 - b.y0, t: 0, life: 90, seed: b.id });
      if (G.decals.length > 220) G.decals.shift();
      CG.shake(G, 4 + b.w * b.h * 0.6, b.x, b.y);
      if (CG.audio) CG.audio.play('explodeBig', b.x, b.y);
    },
    bigBlast(G, x, y, r, kind) {
      P(G, { k: 'shock', x, y, r, life: 0.9, color: kind === 'orbital' ? '#bfe8ff' : '#ffd08a' });
      P(G, { k: 'flash2', x, y, life: 0.35, size: r * 1.2 });
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * CG.TAU, rr = Math.random() * r * 0.8;
        P(G, { k: 'delayBlast', x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, life: Math.random() * 0.5, s: 1 + Math.random() });
      }
      for (let i = 0; i < 8; i++) G.decals.push({ k: 'crater', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r, r: 10 + Math.random() * 14, t: 0, life: 60, rot: Math.random() * 6 });
      while (G.decals.length > 220) G.decals.shift();
    },
  };

  CG.updateParticles = function (G, dt) {
    const L = G.particles;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t += dt;
      if (p.k === 'delayBlast') {
        if (p.t >= p.life) { CG.fx.explosion(G, p.x, p.y, p.s); continue; }
        L[j++] = p;
        continue;
      }
      if (p.t >= p.life) continue;
      if (p.vx !== undefined) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = p.k === 'spark' ? 0.9 : 0.96;
        p.vx *= Math.pow(drag, dt * 60);
        p.vy *= Math.pow(drag, dt * 60);
      }
      if (p.k === 'debris') {
        p.z += p.vz * dt;
        p.vz -= 400 * dt;
        if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
      }
      L[j++] = p;
    }
    L.length = j;
    for (const d of G.decals) d.t += dt;
    if (G.tick % 60 === 0) G.decals = G.decals.filter((d) => d.t < d.life);
  };
})();
