/* Efeitos visuais do Battlescape (DESIGN.md §10, §16), propriedade da apresentação: nunca lê nem altera B.
   O apresentador cria efeitos a partir dos eventos da simulação e avança-os com update(dt); o renderizador
   desenha-os por cima do mapa (draw) e os decalques (queimado, sangue) no passe do chão (drawDecals).
   Posições: [vx, vy, vz] ou {vx, vy, vz} em voxels absolutos (tile = 16×16×24) ou {x, y, z} em coordenadas
   de tile em vírgula flutuante (centro do tile = x + 0.5, y + 0.5; z em níveis).
   OV.FX.spawn(kind, pos, opts) → id; kinds: muzzle, tracer|bullet, laser, plasma, rocket, thrown, explosion,
     smoke, fire, sparks, impact, blood, psi, spotted, damage.
   OV.FX.projectile(kind, from, toOrPath, tilesPerSec?) → Promise (resolvida à chegada; laser = instantâneo)
   OV.FX.update(dtMs) ; draw(ctx, cam, viewZ) ; drawDecals(ctx, cam, z) ; shake(intensity) ; offset() → {x, y}
   OV.FX.clear() ; active() → bool ; inFlight() → projéteis por chegar ; flame(ctx, X, Y, S, t, seed, k) / smokeTile(ctx, X, Y, S, t, seed, density)
   (fogo e fumo dos tiles, chamados pelo renderizador em px do dispositivo, escala S). */
(function (OV) {
  'use strict';

  const css = (c, a) => OV.Color.css(c, a);
  const TAU = Math.PI * 2;
  const MAX_DECALS = 160;
  const SHAKE_MAX = 8;
  const SPEED = { tracer: 30, bullet: 30, plasma: 18, rocket: 11, thrown: 12, laser: 0 };
  const GUN_COL = { ballistic: 0xffd27a, laser: 0xff5a4a, plasma: 0x7aff8a, stun: 0x8ec8ff, psi: 0xd77dff };

  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('FX: sem canvas disponível');
  };

  const S = { parts: [], decals: [], nextId: 1, time: 0, trauma: 0, off: { x: 0, y: 0 }, pending: [] };

  // ---- posições --------------------------------------------------------------------------------------------
  function vox(p) {
    if (!p) return [0, 0, 0];
    if (Array.isArray(p) || ArrayBuffer.isView(p)) return [+p[0] || 0, +p[1] || 0, +p[2] || 0];
    if (p.vx !== undefined) return [+p.vx || 0, +p.vy || 0, +p.vz || 0];
    return [(+p.x || 0) * 16, (+p.y || 0) * 16, (+p.z || 0) * 24];
  }
  const tileVoxel = (x, y, z, h) => [x * 16 + 8, y * 16 + 8, z * 24 + (h || 0)];
  function scr(v, cam) {
    const tx = v[0] / 16, ty = v[1] / 16, tz = v[2] / 24;
    return [((tx - ty) * 32 - cam.x) * cam.zoom, ((tx + ty) * 16 - tz * 48 - cam.y) * cam.zoom];
  }
  const levelOf = (v) => Math.floor((v[2] + 0.01) / 24);
  function pathLen(path) {
    let L = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      L += Math.hypot((b[0] - a[0]) / 16, (b[1] - a[1]) / 16, (b[2] - a[2]) / 24);
    }
    return L;
  }
  // ponto ao longo do caminho na fração f (0..1) do comprimento
  function along(path, cum, f) {
    const L = cum[cum.length - 1];
    const d = f * L;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const a = path[k - 1], b = path[k] || a;
    const seg = cum[k] - cum[k - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - cum[k - 1]) / seg));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function cumOf(path) {
    const cum = [0];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      cum.push(cum[k - 1] + Math.hypot((b[0] - a[0]) / 16, (b[1] - a[1]) / 16, (b[2] - a[2]) / 24));
    }
    return cum;
  }

  // ---- sprites de brilho em cache (radiais brancos tingidos) ----------------------------------------------------
  const glowCache = new Map();
  function glowSprite(col) {
    let c = glowCache.get(col);
    if (c) return c;
    c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, css(0xffffff, 1));
    gr.addColorStop(0.18, css(col, 0.9));
    gr.addColorStop(0.5, css(col, 0.35));
    gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(col, c);
    return c;
  }
  let smokeSpr = null;
  function smokeSprite() {
    if (smokeSpr) return smokeSpr;
    smokeSpr = makeCanvas(64, 64);
    const g = smokeSpr.getContext('2d');
    const gr = g.createRadialGradient(26, 26, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(190,192,196,0.9)');
    gr.addColorStop(0.5, 'rgba(140,142,148,0.55)');
    gr.addColorStop(1, 'rgba(110,112,118,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return smokeSpr;
  }
  function glow(ctx, x, y, r, col, a) {
    if (!(r > 0.5) || !(a > 0.005)) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  }

  // aleatório cosmético próprio (não usa as streams da simulação)
  let seed = 0x2545f491;
  function rnd() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- criação --------------------------------------------------------------------------------------------------
  function add(p) {
    p.id = S.nextId++;
    p.t = 0;
    S.parts.push(p);
    return p.id;
  }
  function decal(kind, v, r, col) {
    S.decals.push({ kind, v, r, col, seed: (rnd() * 1e9) | 0, a: 1 });
    if (S.decals.length > MAX_DECALS) S.decals.splice(0, S.decals.length - MAX_DECALS);
  }
  function debris(v, n, spd, col, life, grav) {
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU, up = 0.3 + rnd() * 0.9, s = spd * (0.4 + rnd() * 0.8);
      add({ kind: 'chunk', v: v.slice(), vel: [Math.cos(a) * s, Math.sin(a) * s, up * s * 1.6], life: life * (0.6 + rnd() * 0.6), col, grav, size: 0.8 + rnd() * 1.4 });
    }
  }

  function spawn(kind, pos, opts) {
    const o = opts || {};
    const v = vox(pos);
    switch (kind) {
      case 'muzzle':
        return add({ kind, v, life: 90, col: o.colour !== undefined ? o.colour : GUN_COL[o.gun] || GUN_COL.ballistic, size: o.size || 1 });
      case 'tracer':
      case 'bullet':
      case 'plasma':
      case 'rocket':
      case 'thrown':
      case 'laser': {
        const to = o.to ? vox(o.to) : v;
        projectile(kind, v, o.path || to, o.speed, o);
        return S.nextId - 1;
      }
      case 'explosion': {
        const r = Math.max(1, +o.radius || 2);
        const col = o.dmg === 'STUN' ? 0x8ec8ff : o.dmg === 'SMOKE' ? 0x9a9ca0 : o.dmg === 'IN' ? 0xff7a20 : 0xffa040;
        add({ kind: 'flash', v, life: 110, r });
        add({ kind: 'fireball', v, life: 380 + r * 40, r, col });
        add({ kind: 'ring', v: [v[0], v[1], Math.floor(v[2] / 24) * 24 + 1], life: 420, r });
        debris(v, 6 + r * 3, 0.06, 0x2a2420, 900, true);
        for (let k = 0; k < 3 + r; k++) {
          const a = rnd() * TAU, d = rnd() * r * 8;
          add({ kind: 'smoke', v: [v[0] + Math.cos(a) * d, v[1] + Math.sin(a) * d, v[2]], life: 1300 + rnd() * 900, size: 1 + r * 0.25, delay: 150 + rnd() * 250, rise: 0.012 });
        }
        if (o.dmg !== 'SMOKE' && o.dmg !== 'STUN') decal('scorch', [v[0], v[1], Math.floor(v[2] / 24) * 24], r * 9, 0x0a0806);
        shake(Math.min(1, 0.35 + r * 0.1));
        return S.nextId - 1;
      }
      case 'smoke':
        return add({ kind, v, life: o.life || 1500, size: o.size || 1, rise: o.rise === undefined ? 0.01 : o.rise, delay: o.delay || 0 });
      case 'fire':
        return add({ kind: 'flameBurst', v, life: o.life || 700, size: o.size || 1, seed: (rnd() * 1000) | 0 });
      case 'sparks':
      case 'impact': {
        const col = o.colour !== undefined ? o.colour : 0xffd27a;
        for (let k = 0; k < (o.count || 9); k++) {
          const a = rnd() * TAU, s = 0.05 + rnd() * 0.08;
          add({ kind: 'spark', v: v.slice(), vel: [Math.cos(a) * s, Math.sin(a) * s, 0.04 + rnd() * 0.08], life: 220 + rnd() * 200, col, grav: true });
        }
        if (kind === 'impact') {
          add({ kind: 'smoke', v, life: 600, size: 0.45, rise: 0.008 });
          add({ kind: 'muzzle', v, life: 70, col, size: 0.6 });
        }
        return S.nextId - 1;
      }
      case 'blood': {
        const col = o.colour !== undefined ? o.colour : o.alien ? 0x6ad040 : 0xb01818;
        for (let k = 0; k < 10; k++) {
          const a = rnd() * TAU, s = 0.02 + rnd() * 0.05;
          add({ kind: 'drop', v: v.slice(), vel: [Math.cos(a) * s, Math.sin(a) * s, 0.02 + rnd() * 0.05], life: 380 + rnd() * 200, col, grav: true, size: 0.7 + rnd() * 0.6 });
        }
        decal('blood', [v[0], v[1], Math.floor(v[2] / 24) * 24], 4 + rnd() * 3, col);
        return S.nextId - 1;
      }
      case 'psi':
        return add({ kind, v, to: o.to ? vox(o.to) : null, life: 800 });
      case 'spotted':
        return add({ kind, v, life: o.life || 1100 });
      case 'damage':
        return add({ kind, v, life: 1000, text: o.text !== undefined ? String(o.text) : String(o.amount | 0), col: o.colour !== undefined ? o.colour : o.stun ? 0x8ec8ff : 0xff5a4a });
      default:
        return add({ kind: 'impact', v, life: 1 });
    }
  }

  // projétil ao longo de um caminho (lista de voxels) ou em linha reta; resolve à chegada
  function projectile(kind, from, to, tilesPerSec, opts) {
    const o = opts || {};
    let path;
    if (Array.isArray(to) && to.length && (Array.isArray(to[0]) || (to[0] && typeof to[0] === 'object'))) path = to.map(vox);
    else path = [vox(from), vox(to)];
    if (from && path.length && (path[0][0] !== vox(from)[0] || path[0][1] !== vox(from)[1] || path[0][2] !== vox(from)[2])) path.unshift(vox(from));
    if (path.length < 2) path.push(path[0].slice());
    const cum = cumOf(path);
    const L = cum[cum.length - 1];
    const k = kind === 'bullet' ? 'tracer' : kind;
    return new Promise((resolve) => {
      if (k === 'laser') {
        add({ kind: 'beam', path, life: 170, col: o.colour !== undefined ? o.colour : GUN_COL.laser });
        add({ kind: 'muzzle', v: path[0], life: 80, col: GUN_COL.laser, size: 0.8 });
        const p = { resolve, at: S.time + 40 };
        S.pending.push(p);
        return;
      }
      const spd = +tilesPerSec > 0 ? +tilesPerSec : SPEED[k] || 20;
      const dur = Math.max(60, (L / spd) * 1000);
      const col = o.colour !== undefined ? o.colour : k === 'plasma' ? GUN_COL.plasma : GUN_COL.ballistic;
      add({ kind: 'proj', pk: k, path, cum, life: dur, dur, col, resolve, itemId: o.itemId || null, puffAt: 0, trail: [] });
    });
  }

  // ---- avanço ---------------------------------------------------------------------------------------------------
  function update(dtMs) {
    const dt = Math.max(0, Math.min(250, +dtMs || 0));
    S.time += dt;
    S.trauma = Math.max(0, S.trauma - dt * 0.0022);
    const tr = S.trauma * S.trauma * SHAKE_MAX;
    S.off.x = tr * Math.sin(S.time * 0.071) * (0.7 + 0.3 * Math.sin(S.time * 0.013));
    S.off.y = tr * Math.cos(S.time * 0.083) * (0.7 + 0.3 * Math.cos(S.time * 0.017));
    for (let k = S.pending.length - 1; k >= 0; k--) {
      if (S.time >= S.pending[k].at) {
        S.pending[k].resolve();
        S.pending.splice(k, 1);
      }
    }
    const keep = [];
    for (const p of S.parts) {
      if (p.delay > 0) {
        p.delay -= dt;
        keep.push(p);
        continue;
      }
      p.t += dt;
      if (p.vel) {
        p.v[0] += p.vel[0] * dt;
        p.v[1] += p.vel[1] * dt;
        p.v[2] += p.vel[2] * dt;
        if (p.grav) p.vel[2] -= 0.00028 * dt;
        const floor = Math.floor((p.v[2] - p.vel[2] * dt + 0.01) / 24) * 24;
        if (p.grav && p.v[2] < floor) {
          p.v[2] = floor;
          p.vel[0] *= 0.4;
          p.vel[1] *= 0.4;
          p.vel[2] = Math.abs(p.vel[2]) * 0.25;
        }
      }
      if (p.kind === 'proj') {
        const f = Math.min(1, p.t / p.dur);
        const head = along(p.path, p.cum, f);
        p.trail.unshift(head);
        if (p.trail.length > 7) p.trail.length = 7;
        p.head = head;
        if (p.pk === 'rocket' && p.t >= p.puffAt) {
          p.puffAt = p.t + 22;
          add({ kind: 'smoke', v: head.slice(), life: 900 + rnd() * 400, size: 0.4, rise: 0.006 });
        }
        if (f >= 1) {
          if (p.resolve) {
            p.resolve();
            p.resolve = null;
          }
          if (p.pk === 'plasma' || p.pk === 'tracer') add({ kind: 'muzzle', v: head.slice(), life: 90, col: p.col, size: 0.7 });
          continue;
        }
      }
      if (p.t < p.life) keep.push(p);
    }
    S.parts = keep;
  }

  function shake(intensity) {
    S.trauma = Math.min(1, S.trauma + Math.max(0, +intensity || 0));
  }

  // ---- desenho --------------------------------------------------------------------------------------------------
  function drawSmokePuff(ctx, x, y, r, a) {
    if (!(a > 0.01)) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(smokeSprite(), x - r, y - r, r * 2, r * 2);
  }
  // chama animada (px do dispositivo): base em (X, Y), escala S, k = intensidade 0..1
  function flame(ctx, X, Y, s, t, sd, k) {
    k = k === undefined ? 1 : Math.max(0.3, Math.min(1.4, k));
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, X, Y - 10 * s, 30 * s * k, 0xff7a20, 0.35);
    ctx.globalCompositeOperation = op;
    for (let j = 0; j < 3; j++) {
      const ph = (t * 0.006 + sd * 0.37 + j * 2.1) % TAU;
      const h = (16 + 8 * Math.sin(ph) + j * 3) * s * k;
      const w = (6 - j) * s * k;
      const dx = (j - 1) * 6 * s * k + Math.sin(ph * 1.7) * 1.5 * s;
      const gr = ctx.createLinearGradient(0, Y, 0, Y - h);
      gr.addColorStop(0, 'rgba(255,90,20,0.95)');
      gr.addColorStop(0.5, 'rgba(255,170,40,0.9)');
      gr.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(X + dx - w, Y);
      ctx.quadraticCurveTo(X + dx - w * 1.1, Y - h * 0.55, X + dx + Math.sin(ph) * 2 * s, Y - h);
      ctx.quadraticCurveTo(X + dx + w * 1.1, Y - h * 0.55, X + dx + w, Y);
      ctx.closePath();
      ctx.globalAlpha = 0.9;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // fumo de um tile (px do dispositivo): densidade 1..15+
  function smokeTile(ctx, X, Y, s, t, sd, density) {
    const n = density > 12 ? 5 : density > 6 ? 4 : 3;
    const base = 0.25 + 0.12 * Math.min(3, Math.floor(density / 6));
    for (let j = 0; j < n; j++) {
      const ph = ((t / 1700 + ((sd * 0.61803 + j * 0.37) % 1)) % 1);
      const ox = (((sd * 13 + j * 29) % 17) - 8) * 2.2 * s;
      const oy = (((sd * 7 + j * 11) % 9) - 4) * 1.4 * s;
      const r = (14 + ph * 10) * s;
      drawSmokePuff(ctx, X + ox, Y + oy - ph * 26 * s, r, base * Math.sin(ph * Math.PI));
    }
    ctx.globalAlpha = 1;
  }

  function drawPart(ctx, p, cam, z) {
    const life = p.life || 1, f = Math.min(1, p.t / life);
    switch (p.kind) {
      case 'muzzle': {
        const [x, y] = scr(p.v, cam);
        const r = (14 * (1 - f * 0.6)) * z * p.size;
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, x, y, r * 1.6, p.col, 1 - f);
        ctx.strokeStyle = css(0xffffff, 0.9 * (1 - f));
        ctx.lineWidth = 1.2 * z;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + 0.4;
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'proj': {
        if (!p.head) break;
        const [hx, hy] = scr(p.head, cam);
        if (p.pk === 'thrown') {
          const g = [p.head[0], p.head[1], Math.floor(p.head[2] / 24) * 24];
          const [gx, gy] = scr(g, cam);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(gx, gy, 4 * z, 2 * z, 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
          const IS = OV.ItemSprites;
          if (p.itemId && IS && IS.ground) {
            const spr = IS.ground(p.itemId, z * 1);
            ctx.save();
            ctx.translate(hx, hy);
            ctx.rotate(p.t * 0.012);
            ctx.drawImage(spr.c, -spr.w * z * 0.35, -spr.h * z * 0.35, spr.w * z * 0.7, spr.h * z * 0.7);
            ctx.restore();
          } else {
            ctx.fillStyle = '#2a3020';
            ctx.beginPath();
            ctx.arc(hx, hy, 3 * z, 0, TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = z;
            ctx.stroke();
          }
          break;
        }
        ctx.globalCompositeOperation = 'lighter';
        if (p.pk === 'plasma') {
          for (let k = p.trail.length - 1; k >= 0; k--) {
            const [tx, ty] = scr(p.trail[k], cam);
            glow(ctx, tx, ty, (10 - k) * z, p.col, 0.5 * (1 - k / p.trail.length));
          }
          glow(ctx, hx, hy, 14 * z, p.col, 1);
        } else if (p.pk === 'rocket') {
          glow(ctx, hx, hy, 10 * z, 0xffa040, 0.9);
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#d8d0c0';
          ctx.beginPath();
          ctx.arc(hx, hy, 2.4 * z, 0, TAU);
          ctx.fill();
        } else {
          const tail = p.trail[p.trail.length - 1];
          const [tx, ty] = scr(tail, cam);
          const gr = ctx.createLinearGradient(tx, ty, hx, hy);
          gr.addColorStop(0, css(p.col, 0));
          gr.addColorStop(1, css(p.col, 0.95));
          ctx.strokeStyle = gr;
          ctx.lineWidth = 2 * z;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          glow(ctx, hx, hy, 5 * z, 0xfff0c0, 0.9);
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'beam': {
        const a = 1 - f;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (const [w, col, al] of [[7, p.col, 0.35], [3, p.col, 0.8], [1.2, 0xffffff, 0.95]]) {
          ctx.strokeStyle = css(col, al * a);
          ctx.lineWidth = w * z;
          ctx.beginPath();
          p.path.forEach((v, k) => {
            const [x, y] = scr(v, cam);
            if (k) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          });
          ctx.stroke();
        }
        const [ex, ey] = scr(p.path[p.path.length - 1], cam);
        glow(ctx, ex, ey, 12 * z, p.col, a);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'flash': {
        const [x, y] = scr(p.v, cam);
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, x, y, (40 + p.r * 22) * z, 0xfff4d0, 1 - f);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'fireball': {
        const [x, y] = scr(p.v, cam);
        const e = 1 - Math.pow(1 - f, 3);
        const r = (10 + p.r * 26 * e) * z;
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, x, y - r * 0.2, r * 1.3, p.col, (1 - f) * 0.9);
        glow(ctx, x, y - r * 0.1, r * 0.7, 0xffe0a0, (1 - f) * (1 - f));
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'ring': {
        const [x, y] = scr(p.v, cam);
        const e = 1 - Math.pow(1 - f, 2);
        const rx = p.r * 45 * e * z, ry = rx / 2;
        ctx.strokeStyle = css(0xfff0d0, 0.75 * (1 - f));
        ctx.lineWidth = (3 * (1 - f) + 1) * z;
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = css(0xffa040, 0.5 * (1 - f));
        ctx.lineWidth = 1.5 * z;
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.1, rx * 0.75), Math.max(0.1, ry * 0.75), 0, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'chunk':
      case 'spark':
      case 'drop': {
        const [x, y] = scr(p.v, cam);
        if (p.kind === 'spark') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = css(p.col, 1 - f);
          ctx.lineWidth = 1.2 * z;
          ctx.beginPath();
          ctx.moveTo(x, y);
          const [px, py] = scr([p.v[0] - p.vel[0] * 25, p.v[1] - p.vel[1] * 25, p.v[2] - p.vel[2] * 25], cam);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.globalAlpha = p.kind === 'drop' ? 0.9 * (1 - f * 0.5) : 1 - f * f;
          ctx.fillStyle = css(p.col);
          ctx.fillRect(x - p.size * z, y - p.size * z, p.size * 2 * z, p.size * 2 * z);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'smoke': {
        const [x, y] = scr([p.v[0], p.v[1], p.v[2] + p.t * p.rise * 24], cam);
        const r = (10 + 18 * f) * z * p.size;
        drawSmokePuff(ctx, x, y, r, 0.6 * Math.sin(Math.min(1, f * 1.05) * Math.PI));
        ctx.globalAlpha = 1;
        break;
      }
      case 'flameBurst': {
        const [x, y] = scr(p.v, cam);
        flame(ctx, x, y, z * p.size, S.time, p.seed, 1 - f * 0.7);
        break;
      }
      case 'psi': {
        const [x, y] = scr(p.v, cam);
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 3; k++) {
          const ff = (f + k * 0.22) % 1;
          ctx.strokeStyle = css(GUN_COL.psi, 0.8 * (1 - ff));
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          ctx.ellipse(x, y, Math.max(0.1, 50 * ff * z), Math.max(0.1, 25 * ff * z), 0, 0, TAU);
          ctx.stroke();
        }
        if (p.to) {
          const [tx, ty] = scr(p.to, cam);
          ctx.strokeStyle = css(GUN_COL.psi, 0.7 * (1 - f));
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          const n = 24;
          for (let k = 0; k <= n; k++) {
            const u = k / n;
            const wx = x + (tx - x) * u, wy = y + (ty - y) * u + Math.sin(u * 18 - S.time * 0.02) * 4 * z;
            if (k) ctx.lineTo(wx, wy);
            else ctx.moveTo(wx, wy);
          }
          ctx.stroke();
          glow(ctx, tx, ty, 20 * z, GUN_COL.psi, 1 - f);
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'spotted': {
        const [x, y0] = scr(p.v, cam);
        const bounce = f < 0.25 ? Math.sin((f / 0.25) * Math.PI) * 8 : 0;
        const a = f > 0.8 ? (1 - f) / 0.2 : 1;
        const y = y0 - 14 * z - bounce * z;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#d0201a';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 2 * Math.max(0.75, z * 0.75);
        const r = 9 * Math.max(0.75, z * 0.75);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.15);
        ctx.lineTo(x + r, y + r * 0.6);
        ctx.lineTo(x - r, y + r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff4e0';
        ctx.font = 'bold ' + Math.round(r * 1.25) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', x, y + r * 0.05);
        ctx.globalAlpha = 1;
        break;
      }
      case 'damage': {
        const [x, y0] = scr(p.v, cam);
        const y = y0 - 10 * z - f * 30;
        const a = f > 0.7 ? (1 - f) / 0.3 : 1;
        const sz = Math.round(13 + 4 * Math.max(0, 1 - f * 4));
        ctx.globalAlpha = a;
        ctx.font = 'bold ' + sz + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(p.text, x, y);
        ctx.fillStyle = css(p.col);
        ctx.fillText(p.text, x, y);
        ctx.globalAlpha = 1;
        break;
      }
      default:
        break;
    }
  }

  // efeitos por cima do mapa (px CSS do contexto); viewZ esconde os efeitos acima do nível visto
  function draw(ctx, cam, viewZ) {
    if (!S.parts.length) return;
    const z = cam.zoom || 1;
    ctx.save();
    for (const p of S.parts) {
      if (p.delay > 0) continue;
      const ref = p.head || p.v || (p.path && p.path[0]);
      if (viewZ !== undefined && viewZ !== null && ref && levelOf(ref) > viewZ && p.kind !== 'damage' && p.kind !== 'spotted') continue;
      drawPart(ctx, p, cam, z);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  // decalques no chão do nível lz (chamado pelo renderizador depois do chão)
  function drawDecals(ctx, cam, lz) {
    if (!S.decals.length) return;
    const z = cam.zoom || 1;
    ctx.save();
    for (const d of S.decals) {
      if (levelOf(d.v) !== lz) continue;
      const [x, y] = scr(d.v, cam);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, 0.5);
      const r = d.r * 2.6 * z;
      if (d.kind === 'scorch') {
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        gr.addColorStop(0, 'rgba(8,6,4,0.75)');
        gr.addColorStop(0.6, 'rgba(20,14,10,0.45)');
        gr.addColorStop(1, 'rgba(20,14,10,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = css(d.col, 0.75);
        let s = d.seed;
        const rr = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
        for (let k = 0; k < 6; k++) {
          const a = rr() * TAU, dd = rr() * r * 0.8, q = r * (0.25 + rr() * 0.35);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * dd, Math.sin(a) * dd, q, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function clear() {
    for (const p of S.parts) if (p.resolve) p.resolve();
    for (const p of S.pending) p.resolve();
    S.parts = [];
    S.pending = [];
    S.decals = [];
    S.trauma = 0;
    S.off.x = 0;
    S.off.y = 0;
  }

  OV.FX = {
    spawn, projectile, update, draw, drawDecals, shake, clear, flame, smokeTile, tileVoxel,
    offset: () => ({ x: S.off.x, y: S.off.y }),
    active: () => S.parts.length > 0 || S.trauma > 0 || S.pending.length > 0,
    count: () => S.parts.length,
    inFlight: () => S.pending.length + S.parts.filter((p) => p.resolve).length,
    decalCount: () => S.decals.length,
    setCanvasFactory: (fn) => { makeCanvas = fn; glowCache.clear(); smokeSpr = null; },
  };
})(globalThis.OV || (globalThis.OV = {}));
