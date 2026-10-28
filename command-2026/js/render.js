/* Renderizador Canvas 2D: terreno pré-calculado, atlas de sprites por escala (Retina), entidades interpoladas,
   efeitos, nevoeiro suave, sobreposições de interface e minimapa */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const PPT = 8; // píxeis por tile na textura base do terreno
  const R = (CG.render = {});
  let G = null, cv = null, ctx = null, dpr = 1;
  let base = null, fogCv = null, fogCtx = null, fogImg = null;
  let atlas = null, atlasScale = 0, atlasPending = 0;
  let mm = null, mmCtx = null, mmBase = null, mmFrame = 0;
  const visible = [];
  const airList = [];
  let effT = 0;

  // ---------------------------------------------------------------- terreno base
  function buildBase(map) {
    const W = map.w * PPT, H = map.h * PPT;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const img = x.createImageData(W, H);
    const d = img.data;
    const th = map.theme;
    const TER = CG.TERRAIN;
    const col = new Float32Array(map.n * 3);
    for (let ty = 0; ty < map.h; ty++)
      for (let tx = 0; tx < map.w; tx++) {
        const i = ty * map.w + tx;
        const t = map.terrain[i];
        let r, g, b;
        if (t === TER.WATER) {
          const k = Math.min(1, map.depth[i] / 5);
          r = CG.lerp(th.water[0], th.deep[0], k); g = CG.lerp(th.water[1], th.deep[1], k); b = CG.lerp(th.water[2], th.deep[2], k);
        } else if (t === TER.ROCK) {
          const s = map.shade[i];
          r = th.rock[0] * (0.85 + s * 0.3); g = th.rock[1] * (0.85 + s * 0.3); b = th.rock[2] * (0.85 + s * 0.3);
        } else {
          const s = map.shade[i];
          r = CG.lerp(th.ground[0], th.ground2[0], s); g = CG.lerp(th.ground[1], th.ground2[1], s); b = CG.lerp(th.ground[2], th.ground2[2], s);
          let shore = false;
          for (let dy = -1; dy <= 1 && !shore; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = tx + dx, ny = ty + dy;
              if (map.inBounds(nx, ny) && map.terrain[ny * map.w + nx] === TER.WATER) { shore = true; break; }
            }
          if (shore) { r = CG.lerp(r, th.shore[0], 0.7); g = CG.lerp(g, th.shore[1], 0.7); b = CG.lerp(b, th.shore[2], 0.7); }
          if (t === TER.FOREST) { r *= 0.82; g *= 0.86; b *= 0.8; }
          if (map.resMax[i] > 0) { r = r * 0.8 + 10; g = g * 0.85 + 18; b = b * 0.85 + 22; }
        }
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        const i = ((py / PPT) | 0) * map.w + ((px / PPT) | 0);
        const o = (py * W + px) * 4;
        d[o] = col[i * 3]; d[o + 1] = col[i * 3 + 1]; d[o + 2] = col[i * 3 + 2]; d[o + 3] = 255;
      }
    blur(d, W, H, 3);
    blur(d, W, H, 2);
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        const o = (py * W + px) * 4;
        const n = (CG.hash2(px, py, map.seed) - 0.5) * 14;
        d[o] = CG.clamp(d[o] + n, 0, 255); d[o + 1] = CG.clamp(d[o + 1] + n, 0, 255); d[o + 2] = CG.clamp(d[o + 2] + n * 0.8, 0, 255);
      }
    x.putImageData(img, 0, 0);
    return c;
  }
  function blur(d, W, H, r) {
    const tmp = new Float32Array(W * H * 3);
    const win = r * 2 + 1;
    for (let y = 0; y < H; y++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const o = (y * W + CG.clamp(k, 0, W - 1)) * 4;
        sr += d[o]; sg += d[o + 1]; sb += d[o + 2];
      }
      for (let x = 0; x < W; x++) {
        const t = (y * W + x) * 3;
        tmp[t] = sr / win; tmp[t + 1] = sg / win; tmp[t + 2] = sb / win;
        const a = (y * W + CG.clamp(x - r, 0, W - 1)) * 4, b = (y * W + CG.clamp(x + r + 1, 0, W - 1)) * 4;
        sr += d[b] - d[a]; sg += d[b + 1] - d[a + 1]; sb += d[b + 2] - d[a + 2];
      }
    }
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let k = -r; k <= r; k++) {
        const t = (CG.clamp(k, 0, H - 1) * W + x) * 3;
        sr += tmp[t]; sg += tmp[t + 1]; sb += tmp[t + 2];
      }
      for (let y = 0; y < H; y++) {
        const o = (y * W + x) * 4;
        d[o] = sr / win; d[o + 1] = sg / win; d[o + 2] = sb / win;
        const a = (CG.clamp(y - r, 0, H - 1) * W + x) * 3, b = (CG.clamp(y + r + 1, 0, H - 1) * W + x) * 3;
        sr += tmp[b] - tmp[a]; sg += tmp[b + 1] - tmp[a + 1]; sb += tmp[b + 2] - tmp[a + 2];
      }
    }
  }

  // ---------------------------------------------------------------- atlas de sprites do mapa
  function mkCanvas(w, h, s) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * s);
    c.height = Math.ceil(h * s);
    const x = c.getContext('2d');
    x.scale(s, s);
    return [c, x];
  }
  function buildAtlas(map, s) {
    const th = map.theme;
    const rng = CG.RNG(map.seed ^ 0x51ed);
    const A = { rocks: [], trees: [], details: [], crystals: [], scale: s };
    for (let v = 0; v < 6; v++) {
      const [c, x] = mkCanvas(52, 52, s);
      x.translate(26, 26);
      const n = 2 + rng.int(3);
      for (let k = 0; k < n; k++) {
        const cx = rng.range(-8, 8), cy = rng.range(-8, 8), r = rng.range(8, 14);
        const pts = [];
        const m = 6 + rng.int(3);
        for (let j = 0; j < m; j++) {
          const a = (j / m) * CG.TAU + rng.range(-0.2, 0.2), rr = r * rng.range(0.7, 1.15);
          pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85);
        }
        x.fillStyle = 'rgba(0,0,0,0.25)';
        x.beginPath();
        for (let j = 0; j < pts.length; j += 2) x[j ? 'lineTo' : 'moveTo'](pts[j] + 4, pts[j + 1] + 5);
        x.fill();
        const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        g.addColorStop(0, 'rgb(' + th.rockLight.join(',') + ')');
        g.addColorStop(0.55, 'rgb(' + th.rock.join(',') + ')');
        g.addColorStop(1, 'rgb(' + th.rockDark.join(',') + ')');
        x.fillStyle = g;
        x.beginPath();
        for (let j = 0; j < pts.length; j += 2) x[j ? 'lineTo' : 'moveTo'](pts[j], pts[j + 1]);
        x.closePath();
        x.fill();
        x.strokeStyle = 'rgba(0,0,0,0.25)';
        x.lineWidth = 0.8;
        x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.18)';
        x.beginPath();
        x.moveTo(pts[0] * 0.5 + cx * 0.5, pts[1] * 0.5 + cy * 0.5);
        x.lineTo(cx - r * 0.3, cy - r * 0.2);
        x.stroke();
      }
      A.rocks.push(c);
    }
    for (let v = 0; v < 6; v++) {
      const [c, x] = mkCanvas(48, 48, s);
      x.translate(24, 24);
      const n = 2 + rng.int(3);
      const blobs = [];
      for (let k = 0; k < n; k++) blobs.push({ x: rng.range(-7, 7), y: rng.range(-7, 7), r: rng.range(6, 10), c: rng.pick(th.tree) });
      for (const b of blobs) {
        x.fillStyle = 'rgba(0,0,0,0.28)';
        x.beginPath();
        x.ellipse(b.x + 5, b.y + 6, b.r, b.r * 0.8, 0, 0, CG.TAU);
        x.fill();
      }
      for (const b of blobs) {
        const g = x.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.4, 1, b.x, b.y, b.r);
        g.addColorStop(0, CG.sprites.shade(b.c, 0.25));
        g.addColorStop(0.7, b.c);
        g.addColorStop(1, th.treeDark);
        x.fillStyle = g;
        x.beginPath();
        x.arc(b.x, b.y, b.r, 0, CG.TAU);
        x.fill();
        if (map.themeId === 'tundra') {
          x.fillStyle = 'rgba(255,255,255,0.55)';
          x.beginPath();
          x.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.45, 0, CG.TAU);
          x.fill();
        }
      }
      A.trees.push(c);
    }
    for (let v = 0; v < 8; v++) {
      const [c, x] = mkCanvas(32, 32, s);
      const k = v % 4;
      if (k === 0) {
        for (let j = 0; j < 5; j++) {
          x.fillStyle = 'rgba(' + th.rockDark.join(',') + ',0.5)';
          x.beginPath();
          x.ellipse(rng.range(4, 28), rng.range(4, 28), rng.range(1, 2.5), rng.range(0.8, 1.8), 0, 0, CG.TAU);
          x.fill();
        }
      } else if (k === 1) {
        x.strokeStyle = map.themeId === 'tundra' ? 'rgba(120,130,120,0.5)' : 'rgba(70,90,40,0.55)';
        x.lineWidth = 1;
        const bx = rng.range(8, 24), by = rng.range(8, 24);
        for (let j = 0; j < 6; j++) {
          x.beginPath();
          x.moveTo(bx, by);
          x.lineTo(bx + rng.range(-4, 4), by - rng.range(2, 6));
          x.stroke();
        }
      } else if (k === 2) {
        x.strokeStyle = 'rgba(0,0,0,0.12)';
        x.lineWidth = 0.8;
        x.beginPath();
        let px = rng.range(2, 30), py = rng.range(2, 30);
        x.moveTo(px, py);
        for (let j = 0; j < 4; j++) { px += rng.range(-8, 8); py += rng.range(-8, 8); x.lineTo(px, py); }
        x.stroke();
      } else {
        x.fillStyle = 'rgba(255,255,255,0.07)';
        x.beginPath();
        x.ellipse(16, 16, rng.range(6, 12), rng.range(4, 8), rng.range(0, 3), 0, CG.TAU);
        x.fill();
      }
      A.details.push(c);
    }
    for (let lvl = 0; lvl < 4; lvl++) {
      const row = [];
      for (let v = 0; v < 3; v++) {
        const [c, x] = mkCanvas(32, 32, s);
        const g = x.createRadialGradient(16, 16, 1, 16, 16, 15);
        g.addColorStop(0, 'rgba(80,255,220,' + (0.12 + lvl * 0.06) + ')');
        g.addColorStop(1, 'rgba(80,255,220,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 32, 32);
        const n = 2 + lvl * 2;
        for (let j = 0; j < n; j++) {
          const cx = rng.range(6, 26), cy = rng.range(8, 26), h = rng.range(4, 7) + lvl * 1.5, w = rng.range(1.6, 3);
          const violet = rng.chance(0.35);
          const g2 = x.createLinearGradient(cx - w, cy - h, cx + w, cy);
          g2.addColorStop(0, violet ? '#e2c8ff' : '#c8fff3');
          g2.addColorStop(0.5, violet ? '#9c62ff' : '#2fe6c4');
          g2.addColorStop(1, violet ? '#4a2a8a' : '#0d7d6c');
          x.fillStyle = 'rgba(0,0,0,0.25)';
          x.beginPath();
          x.moveTo(cx + 2, cy + 1);
          x.lineTo(cx + w + 3, cy - h * 0.4 + 2);
          x.lineTo(cx + 2 + w * 2, cy + 1);
          x.fill();
          x.fillStyle = g2;
          x.beginPath();
          x.moveTo(cx - w, cy);
          x.lineTo(cx, cy - h);
          x.lineTo(cx + w, cy);
          x.lineTo(cx, cy + w * 0.6);
          x.closePath();
          x.fill();
        }
        row.push(c);
      }
      A.crystals.push(row);
    }
    return A;
  }

  // ---------------------------------------------------------------- inicialização
  R.attach = function (game) {
    G = game;
    cv = document.getElementById('view');
    ctx = cv.getContext('2d');
    mm = document.getElementById('minimap');
    mmCtx = mm.getContext('2d');
    base = buildBase(G.map);
    fogCv = document.createElement('canvas');
    fogCv.width = G.map.w;
    fogCv.height = G.map.h;
    fogCtx = fogCv.getContext('2d');
    fogImg = fogCtx.createImageData(G.map.w, G.map.h);
    mmBase = document.createElement('canvas');
    mmBase.width = G.map.w * 2;
    mmBase.height = G.map.h * 2;
    const mb = mmBase.getContext('2d');
    mb.imageSmoothingEnabled = true;
    mb.drawImage(base, 0, 0, mmBase.width, mmBase.height);
    const m = G.map;
    for (let i = 0; i < m.n; i++) {
      const t = m.terrain[i];
      if (t === CG.TERRAIN.ROCK || t === CG.TERRAIN.FOREST) {
        mb.fillStyle = t === CG.TERRAIN.ROCK ? 'rgba(40,34,30,0.45)' : 'rgba(20,50,20,0.4)';
        mb.fillRect((i % m.w) * 2, Math.floor(i / m.w) * 2, 2, 2);
      }
    }
    atlas = null;
    atlasScale = 0;
    CG.sprites.clearCache();
    R.resize();
  };

  R.resize = function () {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    R.cssW = w;
    R.cssH = h;
    const mr = mm.getBoundingClientRect();
    mm.width = Math.max(1, Math.round(mr.width * dpr));
    mm.height = Math.max(1, Math.round(mr.height * dpr));
    if (G) R.clampCam(G);
  };

  R.clampCam = function (game) {
    const c = game.cam;
    c.vw = R.cssW / c.zoom;
    c.vh = R.cssH / c.zoom;
    const m = game.map;
    if (c.vw >= m.pxW) c.x = (m.pxW - c.vw) / 2;
    else c.x = CG.clamp(c.x, 0, m.pxW - c.vw);
    if (c.vh >= m.pxH) c.y = (m.pxH - c.vh) / 2;
    else c.y = CG.clamp(c.y, 0, m.pxH - c.vh);
  };

  R.screenToWorld = function (sx, sy) {
    const c = G.cam;
    return { x: c.x + sx / c.zoom, y: c.y + sy / c.zoom };
  };
  R.worldToScreen = function (wx, wy) {
    const c = G.cam;
    return { x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom };
  };

  function ensureAtlas() {
    const s = Math.round(dpr * G.cam.zoom * 4) / 4;
    if (atlas && Math.abs(atlasScale - s) < 0.01) return;
    if (atlas && performance.now() < atlasPending) return;
    atlas = buildAtlas(G.map, s);
    atlasScale = s;
  }
  R.zoomChanged = function () {
    atlasPending = performance.now() + 220;
  };

  // ---------------------------------------------------------------- desenho principal
  R.draw = function (game, alpha, dtReal) {
    G = game;
    if (!ctx) return;
    effT += dtReal;
    const cam = G.cam;
    R.clampCam(G);
    ensureAtlas();
    const z = cam.zoom;
    const sh = G.shakeAmt > 0.2 ? G.shakeAmt : 0;
    const shx = sh ? (Math.random() - 0.5) * sh : 0, shy = sh ? (Math.random() - 0.5) * sh : 0;
    const cx = cam.x + shx, cy = cam.y + shy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const k = dpr * z;
    ctx.setTransform(k, 0, 0, k, -cx * k, -cy * k);
    const m = G.map;
    const x0 = Math.max(0, cx), y0 = Math.max(0, cy);
    const x1 = Math.min(m.pxW, cx + cam.vw + 2), y1 = Math.min(m.pxH, cy + cam.vh + 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, (x0 / T) * PPT, (y0 / T) * PPT, ((x1 - x0) / T) * PPT, ((y1 - y0) / T) * PPT, x0, y0, x1 - x0, y1 - y0);

    const tx0 = Math.max(0, Math.floor(x0 / T) - 1), ty0 = Math.max(0, Math.floor(y0 / T) - 1);
    const tx1 = Math.min(m.w - 1, Math.ceil(x1 / T) + 1), ty1 = Math.min(m.h - 1, Math.ceil(y1 / T) + 1);
    const H = G.players[G.human];
    const now = G.time;
    drawTiles(m, tx0, ty0, tx1, ty1, H, now);
    drawDecals(x0 - 64, y0 - 64, x1 + 64, y1 + 64);

    // entidades visíveis, ordenadas por profundidade
    visible.length = 0;
    airList.length = 0;
    for (const e of G.entities) {
      if (!e.alive) continue;
      const ex = e.kind === 'unit' ? CG.lerp(e.px, e.x, alpha) : e.x;
      const ey = e.kind === 'unit' ? CG.lerp(e.py, e.y, alpha) : e.y;
      if (ex < x0 - 96 || ex > x1 + 96 || ey < y0 - 96 || ey > y1 + 96) continue;
      if (e.kind === 'bld') {
        if (e.owner !== G.human && e.owner >= 0 && !(e.seen & (1 << G.human)) && !G.revealMap) continue;
        if (e.owner < 0 && !H.explored[m.idx(e.tx, e.ty)] && !G.revealMap) continue;
      } else if (!G.revealMap && !CG.visibleTo(G, e, G.human)) {
        if (!(e.owner === G.human)) continue;
      }
      e._rx = ex;
      e._ry = ey;
      if (e.kind === 'unit' && e.air) airList.push(e);
      else visible.push(e);
    }
    visible.sort((a, b) => (a.kind === 'bld' ? a.y1 - 6 : a._ry) - (b.kind === 'bld' ? b.y1 - 6 : b._ry));
    drawParticles(true);
    for (const e of visible) {
      if (e.kind === 'bld') drawBuilding(e, now);
      else drawUnit(e, alpha, now);
    }
    drawProjectiles();
    for (const e of airList) {
      ctx.save();
      ctx.translate(e._rx + 5 + e.z * 0.15, e._ry + 4 + e.z * 0.1);
      CG.sprites.airShadow(ctx, e.def, CG.lerpAngle(e.pangle, e.angle, alpha));
      ctx.restore();
    }
    for (const e of airList) drawUnit(e, alpha, now);
    drawParticles(false);
    drawStrikes(now);
    if (!G.revealMap) drawFog();
    drawOverlays(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScreenOverlays();
    mmFrame++;
    if (mmFrame % 5 === 0) drawMinimap();
  };

  function drawTiles(m, tx0, ty0, tx1, ty1, H, now) {
    const A = atlas;
    const TER = CG.TERRAIN;
    const seed = m.seed;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * m.w + tx;
        const t = m.terrain[i];
        const hsh = CG.hash2(tx, ty, seed);
        const px = tx * T, py = ty * T;
        if (t === TER.ROCK) {
          ctx.drawImage(A.rocks[(hsh * 6) | 0], px + T / 2 - 26, py + T / 2 - 26, 52, 52);
        } else if (t === TER.FOREST) {
          ctx.drawImage(A.trees[(hsh * 6) | 0], px + T / 2 - 24 + (hsh - 0.5) * 6, py + T / 2 - 24, 48, 48);
        } else if (t === TER.WATER) {
          if (hsh < 0.18) {
            const a = 0.12 + 0.12 * Math.sin(now * 1.5 + hsh * 40);
            ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const ox = ((now * 4 + hsh * 50) % 12) - 6;
            ctx.moveTo(px + 8 + ox, py + 14 + hsh * 8);
            ctx.lineTo(px + 18 + ox, py + 14 + hsh * 8);
            ctx.stroke();
          }
        } else {
          const r = m.res[i];
          if (r > 0) {
            const lvl = r > m.resMax[i] * 0.7 ? 3 : r > m.resMax[i] * 0.4 ? 2 : r > m.resMax[i] * 0.15 ? 1 : 0;
            ctx.drawImage(A.crystals[lvl][(hsh * 3) | 0], px, py, T, T);
          } else if (hsh > 0.55) {
            ctx.drawImage(A.details[((hsh - 0.55) * 17.7) | 0], px, py, T, T);
          }
        }
      }
    }
    // plataformas de descarga das refinarias
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'bld' || !e.def.refinery) continue;
      if (e.owner !== G.human && !(e.seen & (1 << G.human))) continue;
      const dx = e.dockX - T / 2, dy = e.dockY - T / 2;
      ctx.fillStyle = '#55595c';
      ctx.fillRect(dx + 2, dy, T - 4, T - 2);
      ctx.fillStyle = '#e5b82a';
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.moveTo(dx + 9, dy + 6 + j * 8);
        ctx.lineTo(dx + 16, dy + 2 + j * 8);
        ctx.lineTo(dx + 23, dy + 6 + j * 8);
        ctx.lineTo(dx + 23, dy + 8 + j * 8);
        ctx.lineTo(dx + 16, dy + 4 + j * 8);
        ctx.lineTo(dx + 9, dy + 8 + j * 8);
        ctx.fill();
      }
    }
  }

  function drawDecals(ax, ay, bx, by) {
    for (const d of G.decals) {
      if (d.x < ax || d.x > bx || d.y < ay || d.y > by) continue;
      const fade = CG.clamp(1 - (d.t - d.life * 0.7) / (d.life * 0.3), 0, 1);
      ctx.globalAlpha = fade;
      if (d.k === 'crater') {
        ctx.fillStyle = 'rgba(30,24,18,0.45)';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r, d.r * 0.8, d.rot, 0, CG.TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(15,12,10,0.35)';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r * 0.5, d.r * 0.4, d.rot, 0, CG.TAU);
        ctx.fill();
      } else if (d.k === 'wreck') {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.fillStyle = '#2b2622';
        CG.sprites.rr(ctx, -d.r, -d.r * 0.65, d.r * 2, d.r * 1.3, 3);
        ctx.fill();
        ctx.fillStyle = '#151210';
        ctx.fillRect(-d.r * 0.4, -d.r * 0.4, d.r * 0.8, d.r * 0.8);
        ctx.restore();
        if (d.t < 6 && Math.random() < 0.12) CG.fx.smokePuff(G, d.x + (Math.random() - 0.5) * 8, d.y - 4, 0.9);
      } else if (d.k === 'rubble') {
        const rng = CG.RNG(d.seed * 7 + 1);
        ctx.fillStyle = 'rgba(25,22,20,0.55)';
        ctx.fillRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
        for (let j = 0; j < (d.w * d.h) / 120; j++) {
          ctx.fillStyle = rng.chance(0.5) ? '#5a554d' : '#3d3934';
          ctx.fillRect(d.x - d.w / 2 + rng.next() * d.w, d.y - d.h / 2 + rng.next() * d.h, 2 + rng.next() * 5, 2 + rng.next() * 4);
        }
        if (d.t < 12 && Math.random() < 0.15) CG.fx.smokePuff(G, d.x + (Math.random() - 0.5) * d.w * 0.7, d.y + (Math.random() - 0.5) * d.h * 0.6, 1.2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function hpBar(x, y, w, f) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 4.5);
    ctx.fillStyle = f > 0.5 ? '#3fe36b' : f > 0.25 ? '#ffd23a' : '#ff4433';
    ctx.fillRect(x - w / 2, y, w * CG.clamp(f, 0, 1), 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let s = x - w / 2 + 5; s < x + w / 2; s += 5) ctx.fillRect(s, y, 0.6, 2.5);
  }
  function brackets(x, y, w, h, col) {
    const l = Math.min(6, w / 3, h / 3);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
  }

  function fidOf(owner) {
    return owner < 0 ? 'neutral' : G.players[owner].fid;
  }

  function drawBuilding(b, now) {
    const sc = Math.round(dpr * G.cam.zoom * 4) / 4;
    const fid = fidOf(b.owner);
    const spr = CG.sprites.buildingSprite(b.type, b.owner, fid, sc);
    const M = CG.sprites.MARGIN;
    const W = b.x1 - b.x0, Hh = b.y1 - b.y0;
    if (b.built < 1) {
      ctx.save();
      const h = (Hh + 2 * M) * b.built;
      ctx.beginPath();
      ctx.rect(b.x0 - M, b.y1 + M - h, W + 2 * M, h);
      ctx.clip();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spr, b.x0 - M, b.y0 - M, W + 2 * M, Hh + 2 * M);
      ctx.restore();
      ctx.strokeStyle = 'rgba(110,210,255,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, W - 1, Hh - 1);
      ctx.beginPath();
      for (let x = b.x0 + 8; x < b.x1; x += 8) { ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); }
      ctx.strokeStyle = 'rgba(110,210,255,0.18)';
      ctx.stroke();
      return;
    }
    ctx.save();
    if (b.selling > 0) {
      ctx.globalAlpha = 1 - b.selling;
      ctx.translate(0, b.selling * 6);
    }
    ctx.drawImage(spr, b.x0 - M, b.y0 - M, W + 2 * M, Hh + 2 * M);
    ctx.translate(b.x0, b.y0);
    CG.sprites.drawBuildingLive(ctx, b, fid, now + b.anim);
    ctx.restore();
    const p = G.players[b.owner];
    const unpowered = p && p.lowPower && b.def.power < 0;
    if (b.disabled > 0 || unpowered) {
      ctx.fillStyle = b.disabled > 0 ? 'rgba(60,140,255,0.18)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x0, b.y0, W, Hh);
      if (b.disabled > 0 && Math.random() < 0.3) CG.fx.sparks(G, b.x0 + Math.random() * W, b.y0 + Math.random() * Hh, '#7dfcff');
      if (unpowered && b.owner === G.human && Math.floor(now * 2) % 2 === 0) {
        CG.sprites.powerIcon(ctx, 'emp', b.x, b.y - 4, 0.6, '#ffd23a');
      }
    }
    if (b.repairing && Math.floor(now * 2.5) % 2 === 0) {
      ctx.fillStyle = 'rgba(30,200,90,0.9)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7, 0, CG.TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x - 4, b.y - 1.2, 8, 2.4);
      ctx.fillRect(b.x - 1.2, b.y - 4, 2.4, 8);
    }
    const f = b.hp / b.maxHp;
    if (f < 0.5 && Math.random() < (f < 0.25 ? 0.25 : 0.1)) {
      const px = b.x0 + Math.random() * W, py = b.y0 + Math.random() * Hh * 0.7;
      CG.fx.smokePuff(G, px, py, 1.4);
      if (f < 0.25 && Math.random() < 0.4) CG.fx.explosion(G, px, py, 0.25);
    }
  }

  function drawUnit(u, alpha, now) {
    const x = u._rx, y = u._ry - u.z;
    const ang = CG.lerpAngle(u.pangle, u.angle, alpha);
    const tur = CG.lerpAngle(u.pturret, u.turret, alpha);
    ctx.save();
    ctx.translate(x, y);
    if (u.def.stealth && u.firedT > 2.5) {
      if (u.owner === G.human) ctx.globalAlpha = 0.45 + Math.sin(now * 3) * 0.08;
      else ctx.globalAlpha = 0.75;
    }
    if (u.air && !u.def.kamikaze) ctx.translate(0, Math.sin(now * 2 + u.anim) * 1.2);
    CG.sprites.drawUnit(ctx, u.def, u.owner, G.players[u.owner].fid, ang, tur, now + u.anim, u.moving, u.def.harvester ? u.carry / u.def.capacity : 0);
    ctx.restore();
    if (u.disabled > 0) {
      ctx.strokeStyle = 'rgba(120,230,255,' + (0.5 + Math.random() * 0.5) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j < 3; j++) {
        const a = Math.random() * CG.TAU, r = u.def.radius + 2;
        ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        ctx.lineTo(x + Math.cos(a + 0.4) * (r + 4), y + Math.sin(a + 0.4) * (r + 4));
      }
      ctx.stroke();
    }
    if (u.def.cat === 'veh' && u.hp < u.maxHp * 0.35 && Math.random() < 0.08) CG.fx.smokePuff(G, x, y - 4, 0.7);
  }

  function drawProjectiles() {
    for (const p of G.projectiles) {
      const x = p.x, y = p.y - (p.h || 0) - (p.z || 0);
      if (p.kind === 'shell') {
        const a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
        ctx.strokeStyle = 'rgba(255,230,160,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * 8, y - Math.sin(a) * 8);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (p.kind === 'missile' || p.kind === 'rocket') {
        const a = p.kind === 'missile' ? p.ang : Math.atan2(p.ty - p.sy, p.tx - p.sx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(-4, -1, 7, 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,170,60,0.9)';
        ctx.beginPath();
        ctx.moveTo(-4, -1.5);
        ctx.lineTo(-9 - Math.random() * 3, 0);
        ctx.lineTo(-4, 1.5);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, CG.TAU);
        ctx.fill();
        ctx.fillStyle = p.kind === 'lob' ? '#4a4f3a' : '#2b2b2b';
        ctx.beginPath();
        ctx.arc(x, y, p.kind === 'lob' ? 2 : 2.8, 0, CG.TAU);
        ctx.fill();
      }
    }
  }

  function drawParticles(ground) {
    const L = G.particles;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const k = p.k;
      const isGround = k === 'corpse' || k === 'dust';
      if (isGround !== ground) continue;
      const f = p.t / p.life;
      switch (k) {
        case 'flash': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(p.x, p.y);
          ctx.rotate(p.ang);
          ctx.fillStyle = 'rgba(255,240,170,' + (1 - f) + ')';
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.35);
          ctx.lineTo(p.size * 1.4, 0);
          ctx.lineTo(0, p.size * 0.35);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'flash2': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const r = p.size * (0.6 + f * 0.6);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, 'rgba(255,255,230,' + (1 - f) + ')');
          g.addColorStop(0.4, 'rgba(255,180,60,' + 0.8 * (1 - f) + ')');
          g.addColorStop(1, 'rgba(255,80,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          ctx.restore();
          break;
        }
        case 'tracer':
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 1 - f;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x2, p.y2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'zap': {
          ctx.strokeStyle = 'rgba(120,250,255,' + (1 - f) + ')';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          const n = 7;
          for (let j = 1; j < n; j++) {
            const t = j / n;
            ctx.lineTo(CG.lerp(p.x, p.x2, t) + (Math.random() - 0.5) * 8, CG.lerp(p.y, p.y2, t) + (Math.random() - 0.5) * 8);
          }
          ctx.lineTo(p.x2, p.y2);
          ctx.stroke();
          break;
        }
        case 'fire': {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const r = p.size + p.grow * f;
          const a = 1 - f;
          ctx.fillStyle = f < 0.3 ? 'rgba(255,230,140,' + a + ')' : f < 0.6 ? 'rgba(255,140,40,' + a * 0.8 + ')' : 'rgba(200,60,20,' + a * 0.6 + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, CG.TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'smoke':
        case 'dust': {
          const r = p.size + p.grow * f;
          ctx.fillStyle = k === 'dust' ? 'rgba(150,130,100,' + p.a * (1 - f) + ')' : 'rgba(70,70,70,' + p.a * (1 - f) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, CG.TAU);
          ctx.fill();
          break;
        }
        case 'spark':
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 1 - f;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'debris':
          ctx.fillStyle = '#2a2622';
          ctx.fillRect(p.x - p.size / 2, p.y - p.z - p.size / 2, p.size, p.size);
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 1 - f;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.1, p.r * (0.2 + f * 0.8)), 0, CG.TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'shock':
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - f) * 0.9;
          ctx.lineWidth = 6 * (1 - f) + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.1, p.r * (0.3 + f * 1.2)), 0, CG.TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'glitch':
          if (Math.random() < 0.5) {
            ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,255,255,0.5)' : 'rgba(255,0,200,0.45)';
            ctx.fillRect(p.x + (Math.random() - 0.5) * 6, p.y, p.size, 2 + Math.random() * 3);
          }
          break;
        case 'text':
          ctx.globalAlpha = 1 - f;
          ctx.fillStyle = p.color;
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.text, p.x, p.y);
          ctx.globalAlpha = 1;
          break;
        case 'corpse':
          if (!G.players[G.human] || !G.players[G.human].vis[G.map.idx(CG.clamp(Math.floor(p.x / T), 0, G.map.w - 1), CG.clamp(Math.floor(p.y / T), 0, G.map.h - 1))]) break;
          ctx.save();
          ctx.globalAlpha = 0.6 * (1 - f);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.ang + 1.3);
          ctx.fillStyle = '#3b3d30';
          ctx.beginPath();
          ctx.ellipse(0, 0, 5, 2.4, 0, 0, CG.TAU);
          ctx.fill();
          ctx.restore();
          break;
      }
    }
  }

  function drawStrikes(now) {
    for (const s of G.strikes) {
      if (s.done) continue;
      const f = 1 - Math.max(0, s.t) / s.total;
      ctx.strokeStyle = 'rgba(255,60,40,' + (0.5 + Math.sin(now * 12) * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 - f * 0.25), 0, CG.TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
      ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10);
      ctx.stroke();
      if (s.kind === 'orbital') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const w = 2 + f * 14;
        const g = ctx.createLinearGradient(s.x - w, 0, s.x + w, 0);
        g.addColorStop(0, 'rgba(120,200,255,0)');
        g.addColorStop(0.5, 'rgba(200,240,255,' + (0.3 + f * 0.6) + ')');
        g.addColorStop(1, 'rgba(120,200,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(s.x - w, s.y - 2000, w * 2, 2000);
        ctx.restore();
      } else if (s.kind === 'hypersonic') {
        const hgt = (1 - f) * 600;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, 6 + f * 6, 3 + f * 3, 0, 0, CG.TAU);
        ctx.fill();
        ctx.save();
        ctx.translate(s.x, s.y - hgt);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#ddd';
        ctx.fillRect(-10, -2.5, 20, 5);
        ctx.fillStyle = 'rgba(255,160,50,0.9)';
        ctx.fillRect(-22, -2, 12, 4);
        ctx.restore();
      }
    }
  }

  // ---------------------------------------------------------------- nevoeiro
  function drawFog() {
    const m = G.map;
    if (G.fogDirty) {
      G.fogDirty = false;
      const p = G.players[G.human];
      const d = fogImg.data;
      for (let i = 0; i < m.n; i++) {
        const o = i * 4;
        d[o] = 4; d[o + 1] = 6; d[o + 2] = 9;
        d[o + 3] = p.vis[i] ? 0 : p.explored[i] ? 150 : 255;
      }
      fogCtx.putImageData(fogImg, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCv, 0, 0, m.w, m.h, 0, 0, m.pxW, m.pxH);
  }

  // ---------------------------------------------------------------- sobreposições
  function drawOverlays(now) {
    const I = CG.input || {};
    const sel = G.sel;
    const H = G.players[G.human];
    // raio de construção durante a colocação
    if (G.mode && G.mode.type === 'place' && I.mouse) {
      const def = CG.BUILDINGS[G.mode.item];
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(120,220,255,0.35)';
      ctx.lineWidth = 1;
      for (const e of G.entities) {
        if (!e.alive || e.kind !== 'bld' || e.owner !== G.human || e.def.defense || e.def.noCount) continue;
        const r = CG.BUILD_RADIUS * T;
        ctx.strokeRect(e.x0 - r, e.y0 - r, e.x1 - e.x0 + 2 * r, e.y1 - e.y0 + 2 * r);
      }
      ctx.setLineDash([]);
      const wpos = I.mouse.world;
      const tx = Math.floor(wpos.x / T - def.w / 2 + 0.5), ty = Math.floor(wpos.y / T - def.h / 2 + 0.5);
      const r = CG.canPlace(G, G.human, G.mode.item, tx, ty);
      G.mode.tx = tx;
      G.mode.ty = ty;
      G.mode.ok = r.ok;
      G.mode.reason = r.reason;
      const sc = Math.round(dpr * G.cam.zoom * 4) / 4;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(CG.sprites.buildingSprite(G.mode.item, G.human, H.fid, sc), tx * T - CG.sprites.MARGIN, ty * T - CG.sprites.MARGIN, def.w * T + 2 * CG.sprites.MARGIN, def.h * T + 2 * CG.sprites.MARGIN);
      ctx.globalAlpha = 1;
      for (const c of r.cells) {
        ctx.fillStyle = c.ok ? (c.dock ? 'rgba(255,220,60,0.35)' : 'rgba(60,255,120,0.3)') : 'rgba(255,50,50,0.42)';
        ctx.fillRect(c.x * T + 1, c.y * T + 1, T - 2, T - 2);
      }
    }
    // pontos de reunião
    for (const id of sel) {
      const e = G.byId.get(id);
      if (!e || e.kind !== 'bld' || !e.rally) continue;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.rally.x, e.rally.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = H.color.main;
      ctx.fillRect(e.rally.x, e.rally.y - 12, 8, 5);
      ctx.fillStyle = '#ddd';
      ctx.fillRect(e.rally.x - 1, e.rally.y - 12, 1.5, 12);
    }
    // seleção, barras de vida
    const hover = I.hover ? G.byId.get(I.hover) : null;
    for (const e of G.entities) {
      if (!e.alive) continue;
      const show = e.sel || e === hover || (e.kind === 'unit' && e.owner === G.human && e.hitT < 2);
      if (!show) continue;
      if (e.kind === 'unit' && e.owner !== G.human && !CG.visibleTo(G, e, G.human)) continue;
      if (e.kind === 'bld') {
        if (e.sel) brackets(e.x0 - 2, e.y0 - 2, e.x1 - e.x0 + 4, e.y1 - e.y0 + 4, e.owner === G.human ? '#ffffff' : '#ff8a7a');
        hpBar(e.x, e.y0 - 7, e.x1 - e.x0 - 10, e.hp / e.maxHp);
      } else {
        const x = e._rx !== undefined ? e._rx : e.x, y = (e._ry !== undefined ? e._ry : e.y) - e.z;
        const r = e.def.radius + 3;
        if (e.sel) brackets(x - r, y - r, r * 2, r * 2, e.owner === G.human ? '#ffffff' : '#ff8a7a');
        hpBar(x, y - r - 6, Math.max(14, r * 2), e.hp / e.maxHp);
        if (e.sel && e.def.harvester) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - r, y + r + 2, r * 2, 3);
          ctx.fillStyle = '#3ff0cf';
          ctx.fillRect(x - r, y + r + 2, (r * 2 * e.carry) / e.def.capacity, 3);
        }
        if (e.sel && e.group) {
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(String(e.group), x + r - 2, y + r + 2);
        }
      }
    }
    // marcadores de ordens
    if (I.markers) {
      for (const mk of I.markers) {
        const f = mk.t / 0.6;
        ctx.strokeStyle = mk.color;
        ctx.globalAlpha = 1 - f;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(mk.x, mk.y, 12 * (1 - f) + 3, 0, CG.TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // alvo do poder de apoio
    if (G.mode && G.mode.type === 'power' && I.mouse) {
      const def = CG.POWERS[G.mode.id];
      const w = I.mouse.world;
      ctx.strokeStyle = def.kind === 'reveal' ? 'rgba(120,220,255,0.9)' : 'rgba(255,80,60,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -now * 30;
      ctx.beginPath();
      ctx.arc(w.x, w.y, def.radius * T, 0, CG.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawScreenOverlays() {
    const I = CG.input;
    if (I && I.box) {
      const b = I.box;
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
      ctx.fillStyle = 'rgba(120,220,255,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(160,235,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    // vinheta de baixa energia
    const H = G.players[G.human];
    if (H.lowPower) {
      const g = ctx.createRadialGradient(R.cssW / 2, R.cssH / 2, Math.min(R.cssW, R.cssH) * 0.45, R.cssW / 2, R.cssH / 2, Math.max(R.cssW, R.cssH) * 0.75);
      g.addColorStop(0, 'rgba(255,40,0,0)');
      g.addColorStop(1, 'rgba(255,40,0,' + (0.12 + Math.sin(effT * 4) * 0.04) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, R.cssW, R.cssH);
    }
  }

  // ---------------------------------------------------------------- minimapa
  const pings = [];
  R.ping = function (x, y) {
    if (pings.length > 6) pings.shift();
    pings.push({ x, y, t: 0 });
  };
  function drawMinimap() {
    if (!mmCtx || !G) return;
    const m = G.map;
    const W = mm.width, Hh = mm.height;
    const s = Math.min(W / m.pxW, Hh / m.pxH);
    const ox = (W - m.pxW * s) / 2, oy = (Hh - m.pxH * s) / 2;
    R.mmTransform = { s: s / dpr, ox: ox / dpr, oy: oy / dpr };
    mmCtx.setTransform(1, 0, 0, 1, 0, 0);
    mmCtx.fillStyle = '#05070a';
    mmCtx.fillRect(0, 0, W, Hh);
    mmCtx.imageSmoothingEnabled = true;
    mmCtx.drawImage(mmBase, ox, oy, m.pxW * s, m.pxH * s);
    const H = G.players[G.human];
    const ts = T * s;
    mmCtx.fillStyle = 'rgba(70,255,220,0.8)';
    for (let i = 0; i < m.n; i++) {
      if (m.res[i] > 0 && (H.explored[i] || G.revealMap)) mmCtx.fillRect(ox + (i % m.w) * ts, oy + Math.floor(i / m.w) * ts, ts + 0.5, ts + 0.5);
    }
    for (const e of G.entities) {
      if (!e.alive) continue;
      const c = CG.colorOf(e.owner);
      if (e.kind === 'bld') {
        if (e.owner !== G.human && !(e.seen & (1 << G.human)) && !G.revealMap) continue;
        mmCtx.fillStyle = c.main;
        mmCtx.fillRect(ox + e.x0 * s, oy + e.y0 * s, Math.max(2, (e.x1 - e.x0) * s), Math.max(2, (e.y1 - e.y0) * s));
      } else {
        if (e.owner !== G.human && !CG.visibleTo(G, e, G.human) && !G.revealMap) continue;
        mmCtx.fillStyle = e.sel ? '#ffffff' : c.light;
        const sz = Math.max(2, 2.2 * dpr);
        mmCtx.fillRect(ox + e.x * s - sz / 2, oy + e.y * s - sz / 2, sz, sz);
      }
    }
    if (!G.revealMap) {
      mmCtx.imageSmoothingEnabled = true;
      mmCtx.drawImage(fogCv, 0, 0, m.w, m.h, ox, oy, m.pxW * s, m.pxH * s);
    }
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      p.t += 5 / 60;
      if (p.t > 2.5) { pings.splice(i, 1); continue; }
      mmCtx.strokeStyle = 'rgba(255,60,40,' + (1 - p.t / 2.5) + ')';
      mmCtx.lineWidth = 2 * dpr;
      mmCtx.beginPath();
      mmCtx.arc(ox + p.x * s, oy + p.y * s, (4 + (p.t % 0.8) * 14) * dpr, 0, CG.TAU);
      mmCtx.stroke();
    }
    const c = G.cam;
    mmCtx.strokeStyle = 'rgba(255,255,255,0.9)';
    mmCtx.lineWidth = 1.2 * dpr;
    mmCtx.strokeRect(ox + c.x * s, oy + c.y * s, c.vw * s, c.vh * s);
  }
  R.drawMinimapNow = drawMinimap;
})();
