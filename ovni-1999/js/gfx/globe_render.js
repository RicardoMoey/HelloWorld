/* Globo do Geoscape (DESIGN.md §12, docs/rea/05-isometrico-e-globo.md D1–D3, docs/CAMPAIGN_API.md §1, §6).
   Projeção ortográfica; terra Natural Earth (OV.Data.world) com o método limb-collapse + paridade do antípoda (evenodd),
   traços só nos segmentos visíveis, arestas densificadas a ≤ 2° e vetores unitários pré-calculados.
   Camadas: base (espaço, atmosfera, oceano/biomas por amostragem, terra recortada, costas, grelha) → cache por câmara;
   luz (noite/crepúsculo/limbo/brilho do sol, luzes das cidades) → cache por câmara + sol; dinâmica (radares, rotas,
   marcadores, seleção, cursores) em cada fotograma. Só lê G; nunca o altera.

   OV.GlobeRender = {
     ZOOM_RADII                          [0.45, 0.60, 0.90, 1.40, 2.25, 3.60] × view.h
     draw(ctx, G|null, view) → {ms, base:bool, light:bool}   desenha o fotograma inteiro (ctx do canvas w·dpr × h·dpr)
     pick(view, px, py) → {lon, lat} | null                  px/py em px CSS
     project(view, lon, lat) → {x, y, front}
     objectAt(G, view, px, py) → {kind, id} | null           kind 'ufo'|'site'|'base'|'craft'|'alienBase'|'city'
     objectsAt(G, view, px, py) → [{kind, id, d}]            todos ao alcance, do mais próximo
     countryAt(view, px, py) → countryId | null              contornos reais (apresentação)
     screenPos(G, view, ref) → {x, y, front} | null          posição de {kind, id} no ecrã
     radius(view) ; visible(view, lon, lat) ; radarCircles(G)
     rotateBy(view, dx, dy) ; zoomAt(view, zoom, px?, py?) ; rotateTo(view, lon, lat, ms?, zoom?) ; zoomTo(view, zoom, ms?, px?, py?)
     fling(view, vx, vy) ; stop(view) ; update(view, now?) → bool ; busy(view) → bool ; prewarm() ; invalidate() }
   view = {lon, lat, zoom 0..5 (fracionário durante animações), w, h, dpr, cx?, cy?, time (ms), selection, hover,
           highlights:[{kind,id}], mode:'normal'|'placeBase'|'target', cursor:{lon,lat}|null, placeValid?, targetFrom?,
           country?, t? (segundos de jogo quando G é null), touch?, showRadar?, showGrid?, labels?} */
(function (OV) {
  'use strict';

  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const RADII = [0.45, 0.6, 0.9, 1.4, 2.25, 3.6];
  const ZMAX = RADII.length - 1;
  const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  const DENSIFY = 2 * D2R;
  const css = (c, a) => OV.Color.css(c, a);

  // paleta (0xRRGGBB)
  const PAL = {
    space: 0x02050b, atmo: 0x5aa8ff,
    coast: 0xcdeee0, grid: 0x9cc3e6,
    base: 0x2f86ff, baseHi: 0x9fd0ff,
    craft: 0xffcc3d, transport: 0x8fe86a,
    ufo: 0xff3434, landed: 0xffd23f, crashed: 0xff8a2e, terror: 0xff2b2b,
    alienBase: 0xb873ff,
    radar: 0x45d8c8, hyper: 0xc28cff, craftRadar: 0xffcc3d,
    country: 0xffbf47, city: 0xf6e7c1, cityLight: 0xffc879,
    sel: 0xffffff, valid: 0x5cff9d, invalid: 0xff5252, label: 0xeef4fa, shadow: 0x000000,
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const wrap180 = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const T = (k, p) => (OV.T ? OV.T(k, p) : k);
  const strHash = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0) / 4294967296;
  };
  const vec = (lon, lat) => {
    const l = lon * D2R, p = lat * D2R, cp = Math.cos(p);
    return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
  };
  const norm3 = (v) => {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  };

  // ---- câmara ---------------------------------------------------------------------------------------------------
  function radius(view) {
    const z = clamp(+view.zoom || 0, 0, ZMAX), i = Math.min(ZMAX - 1, Math.floor(z)), f = z - i;
    return RADII[i] * Math.pow(RADII[i + 1] / RADII[i], f) * (view.h || 1);
  }
  function camOf(view) {
    const lat = clamp(+view.lat || 0, -89.9, 89.9), lon = +view.lon || 0;
    const l = lon * D2R, p = lat * D2R, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cpp = Math.cos(p);
    const w = view.w || 1, h = view.h || 1;
    return {
      lon, lat, w, h, dpr: view.dpr || 1, R: radius(view),
      cx: view.cx === undefined || view.cx === null ? w / 2 : view.cx,
      cy: view.cy === undefined || view.cy === null ? h / 2 : view.cy,
      e0: -sl, e1: cl, e2: 0,
      n0: -sp * cl, n1: -sp * sl, n2: cpp,
      c0: cpp * cl, c1: cpp * sl, c2: sp,
    };
  }
  function projV(cam, x, y, z) {
    return {
      x: cam.cx + cam.R * (x * cam.e0 + y * cam.e1 + z * cam.e2),
      y: cam.cy - cam.R * (x * cam.n0 + y * cam.n1 + z * cam.n2),
      front: x * cam.c0 + y * cam.c1 + z * cam.c2 > 0,
    };
  }
  const project = (view, lon, lat) => {
    const v = vec(lon, lat);
    return projV(camOf(view), v[0], v[1], v[2]);
  };
  function pickCam(cam, px, py) {
    const u = (px - cam.cx) / cam.R, v = (cam.cy - py) / cam.R, rr = u * u + v * v;
    if (!(rr <= 1)) return null;
    const z = Math.sqrt(1 - rr);
    const wx = u * cam.e0 + v * cam.n0 + z * cam.c0, wy = u * cam.e1 + v * cam.n1 + z * cam.c1, wz = u * cam.e2 + v * cam.n2 + z * cam.c2;
    return { lon: Math.atan2(wy, wx) * R2D + 0, lat: Math.asin(clamp(wz, -1, 1)) * R2D + 0 };
  }
  const pick = (view, px, py) => pickCam(camOf(view), px, py);
  const visible = (view, lon, lat) => project(view, lon, lat).front;

  // ---- geometria (preparada uma vez) -------------------------------------------------------------------------------
  function unwrapRing(pts) {
    const o = [pts[0][0], pts[0][1]];
    for (let i = 1; i < pts.length; i++) {
      let x = pts[i][0];
      const px = o[o.length - 2];
      while (x - px > 180) x -= 360;
      while (x - px < -180) x += 360;
      o.push(x, pts[i][1]);
    }
    const net = o[o.length - 2] - o[0];
    if (Math.abs(net) >= 1) {
      // anel polar (Antártida): fecha pelo polo
      let s = 0;
      for (let i = 1; i < o.length; i += 2) s += o[i];
      const pole = s / (o.length / 2) < 0 ? -90 : 90;
      o.push(o[o.length - 2], pole, o[0], pole);
    }
    return Float64Array.from(o);
  }
  function prepRing(flat) {
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    if (pts.length < 3) return null;
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
    const vs = pts.map((p) => vec(p[0], p[1]));
    const out = [];
    const n = vs.length;
    for (let i = 0; i < n; i++) {
      const a = vs[i], b = vs[(i + 1) % n];
      out.push(a[0], a[1], a[2]);
      const d = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
      const k = Math.ceil(d / DENSIFY);
      if (k > 1 && d < Math.PI - 1e-6) {
        const s = Math.sin(d);
        for (let j = 1; j < k; j++) {
          const t = j / k, k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
          out.push(a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2);
        }
      }
    }
    // calote envolvente (centro + raio angular) para o abate rápido
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < out.length; i += 3) { sx += out[i]; sy += out[i + 1]; sz += out[i + 2]; }
    const cen = norm3([sx, sy, sz]);
    let minDot = 1;
    for (let i = 0; i < out.length; i += 3) minDot = Math.min(minDot, out[i] * cen[0] + out[i + 1] * cen[1] + out[i + 2] * cen[2]);
    const rad = Math.acos(clamp(minDot, -1, 1));
    const planar = unwrapRing(pts.concat([pts[0]]));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < planar.length; i += 2) {
      x0 = Math.min(x0, planar[i]); x1 = Math.max(x1, planar[i]);
      y0 = Math.min(y0, planar[i + 1]); y1 = Math.max(y1, planar[i + 1]);
    }
    return { xyz: Float64Array.from(out), cen, sinR: Math.sin(Math.min(Math.PI, rad + 0.002)), rad, planar, bb: [x0, x1, y0, y1] };
  }
  function pipPlanar(ring, lon, lat) {
    const r = ring.planar, bb = ring.bb;
    if (lat < bb[2] || lat > bb[3]) return false;
    for (const L of [lon, lon - 360, lon + 360]) {
      if (L < bb[0] || L > bb[1]) continue;
      let ins = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
        if ((yi > lat) !== (yj > lat) && L < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
      }
      if (ins) return true;
    }
    return false;
  }
  function lineXYZ(pts) {
    // polilinha densificada a partir de [[lon,lat]...]
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = vec(pts[i][0], pts[i][1]);
      out.push(a[0], a[1], a[2]);
      if (i + 1 < pts.length) {
        const b = vec(pts[i + 1][0], pts[i + 1][1]);
        const d = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
        const k = Math.ceil(d / DENSIFY);
        const s = Math.sin(d);
        for (let j = 1; j < k && s > 1e-9; j++) {
          const t = j / k, k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
          out.push(a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2);
        }
      }
    }
    return Float64Array.from(out);
  }

  let GEO = null;
  function geo() {
    if (GEO) return GEO;
    const W = OV.Data.world;
    const land = [];
    for (const r of W.land) {
      const p = prepRing(r);
      if (p) land.push(p);
    }
    const grid = [];
    for (let lon = -180; lon < 180; lon += 15) {
      const pts = [];
      for (let lat = -80; lat <= 80; lat += 2) pts.push([lon, lat]);
      grid.push({ xyz: lineXYZ(pts), major: lon === 0 });
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 2) pts.push([lon, lat]);
      grid.push({ xyz: lineXYZ(pts), major: lat === 0 });
    }
    // luzes das cidades: núcleo + arredores deterministas, só em terra
    const lights = [];
    for (const c of OV.Data.cities || []) {
      const r = OV.RNG.create((strHash(c.id) * 4294967296) >>> 0);
      const v = vec(c.lon, c.lat);
      lights.push(v[0], v[1], v[2], 1, 1);
      const n = 12 + r.int(0, 10);
      for (let k = 0; k < n; k++) {
        const d = (r.next() + r.next()) * 1.6 * (k < 4 ? 0.35 : 1);
        const b = r.next() * 360;
        const p = OV.GMath ? OV.GMath.destination(c, b, d * 60) : { lon: c.lon + d * Math.cos(b * D2R), lat: c.lat + d * Math.sin(b * D2R) };
        if (!W.isLand(p.lon, p.lat)) continue;
        const u = vec(p.lon, p.lat);
        lights.push(u[0], u[1], u[2], 0.35 + r.next() * 0.45, 0.45 + r.next() * 0.35);
      }
    }
    GEO = { land, grid, countries: {}, lights: Float64Array.from(lights) };
    return GEO;
  }
  function countryRings(id) {
    const g = geo();
    if (g.countries[id] !== undefined) return g.countries[id];
    const src = OV.Data.world.countries[id];
    g.countries[id] = src ? src.map(prepRing).filter(Boolean) : null;
    return g.countries[id];
  }

  // ---- texturas equiretangulares (biomas e oceano), 0,5° -------------------------------------------------------
  const TW = 720, TH = 360;
  let TEX = null;
  // ruído de valor 3D com tabela de permutação (sem costuras no antimeridiano)
  const PERM = new Uint8Array(512), VAL = new Float32Array(256);
  (function () {
    const r = OV.RNG.create(0x6c0be);
    const p = [];
    for (let i = 0; i < 256; i++) { p.push(i); VAL[i] = r.next(); }
    for (let i = 255; i > 0; i--) {
      const j = r.int(0, i), t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const A = PERM[X] + Y, B = PERM[X + 1] + Y;
    const AA = PERM[A] + Z, AB = PERM[A + 1] + Z, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
    const a = VAL[PERM[AA]], b = VAL[PERM[BA]], c = VAL[PERM[AB]], d = VAL[PERM[BB]];
    const e = VAL[PERM[AA + 1]], f = VAL[PERM[BA + 1]], g = VAL[PERM[AB + 1]], k = VAL[PERM[BB + 1]];
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (k - g) * u;
    const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  }
  const fbm = (v, s) => 0.55 * vnoise(v[0] * s, v[1] * s, v[2] * s) + 0.3 * vnoise(v[0] * s * 2.07 + 17, v[1] * s * 2.07, v[2] * s * 2.07)
    + 0.15 * vnoise(v[0] * s * 4.31, v[1] * s * 4.31 + 31, v[2] * s * 4.31);

  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // faixas de latitude (graus absolutos) → cor da terra
  const BANDS = [
    [0, rgb(0x3c7a34)], [11, rgb(0x4f8436)], [19, rgb(0x8a8a4a)], [28, rgb(0x76843f)], [40, rgb(0x56783a)],
    [52, rgb(0x3f6640)], [61, rgb(0x52664c)], [67, rgb(0x8b9580)], [74, rgb(0xdce6ec)], [90, rgb(0xeef4f8)],
  ];
  const SAND = rgb(0xd2b178), ROCK = rgb(0x8f8068), JUNGLE = rgb(0x2a6a2c), ICE = rgb(0xe9f1f6);
  const ABYSS = rgb(0x061731), DEEP = rgb(0x0c2d55), SHELF = rgb(0x185d7d), COASTAL = rgb(0x237c8e), POLARSEA = rgb(0x8fa9ba);

  function bandColour(alat) {
    for (let i = 1; i < BANDS.length; i++) {
      if (alat <= BANDS[i][0]) {
        const a = BANDS[i - 1], b = BANDS[i];
        return mixA(a[1], b[1], smooth(0, 1, (alat - a[0]) / (b[0] - a[0])));
      }
    }
    return BANDS[BANDS.length - 1][1];
  }
  // máscara suave de um conjunto de retângulos [lonMin, lonMax, latMin, latMax] (achatados em Float64Array)
  function boxMask(fb, lon, lat, soft, wob) {
    let m = 0;
    for (let i = 0; i < fb.length; i += 4) {
      const a = fb[i], b = fb[i + 1], c = fb[i + 2], e = fb[i + 3];
      if (lon < a - soft - 4 || lon > b + soft + 4 || lat < c - soft - 4 || lat > e + soft + 4) continue;
      let d = lon - a;
      if (b - lon < d) d = b - lon;
      if (lat - c < d) d = lat - c;
      if (e - lat < d) d = e - lat;
      d += wob;
      if (d > -soft) {
        const k = smooth(-soft, soft, d);
        if (k > m) m = k;
      }
    }
    return m;
  }
  const flatBoxes = (list) => Float64Array.from([].concat(...(list || []).map((r) => [r[0], r[1], r[2], r[3]])));
  function buildTextures() {
    if (TEX) return TEX;
    const W = OV.Data.world, tb = OV.Data.terrainBoxes || {};
    const boxes = { JUNGLE: flatBoxes(tb.JUNGLE), DESERT: flatBoxes(tb.DESERT), MOUNTAIN: flatBoxes(tb.MOUNTAIN) };
    const N = TW * TH;
    const mask = new Uint8Array(N);
    for (let j = 0; j < TH; j++) {
      const lat = 90 - (j + 0.5) * 0.5;
      for (let i = 0; i < TW; i++) mask[j * TW + i] = W.isLand(-180 + (i + 0.5) * 0.5, lat) ? 1 : 0;
    }
    // distância à costa (células; chanfro com custo horizontal cos(lat) e envolvimento em longitude)
    const dist = new Float32Array(N).fill(1e9);
    for (let k = 0; k < N; k++) if (mask[k]) dist[k] = 0;
    const cw = new Float32Array(TH);
    for (let j = 0; j < TH; j++) cw[j] = Math.max(0.05, Math.cos((90 - (j + 0.5) * 0.5) * D2R));
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < TH; j++) {
        const h = cw[j], dg = Math.sqrt(1 + h * h);
        for (let i = 0; i < TW; i++) {
          const k = j * TW + i;
          let d = dist[k];
          const il = (i + TW - 1) % TW;
          d = Math.min(d, dist[j * TW + il] + h);
          if (j > 0) {
            d = Math.min(d, dist[k - TW] + 1, dist[(j - 1) * TW + il] + dg, dist[(j - 1) * TW + ((i + 1) % TW)] + dg);
          }
          dist[k] = d;
        }
      }
      for (let j = TH - 1; j >= 0; j--) {
        const h = cw[j], dg = Math.sqrt(1 + h * h);
        for (let i = TW - 1; i >= 0; i--) {
          const k = j * TW + i;
          let d = dist[k];
          const ir = (i + 1) % TW;
          d = Math.min(d, dist[j * TW + ir] + h);
          if (j < TH - 1) {
            d = Math.min(d, dist[k + TW] + 1, dist[(j + 1) * TW + ir] + dg, dist[(j + 1) * TW + ((i + TW - 1) % TW)] + dg);
          }
          dist[k] = d;
        }
      }
    }
    const landT = new Uint8Array(N * 3), seaT = new Uint8Array(N * 3);
    for (let j = 0; j < TH; j++) {
      const lat = 90 - (j + 0.5) * 0.5, alat = Math.abs(lat);
      for (let i = 0; i < TW; i++) {
        const lon = -180 + (i + 0.5) * 0.5, k = j * TW + i;
        const v = vec(lon, lat);
        const n1 = fbm(v, 7), n2 = fbm(v, 23);
        // terra (só onde conta: em terra e junto à costa, para a interpolação)
        if (dist[k] <= 3) {
        let c = bandColour(clamp(alat + (n1 - 0.5) * 9, 0, 90));
        const wob = (n1 - 0.5) * 5;
        c = mixA(c, JUNGLE, 0.85 * boxMask(boxes.JUNGLE, lon, lat, 3, wob));
        c = mixA(c, SAND, 0.92 * boxMask(boxes.DESERT, lon, lat, 3.5, wob));
        c = mixA(c, ROCK, 0.75 * boxMask(boxes.MOUNTAIN, lon, lat, 2, wob * 0.6));
        let ice = lat > 0 ? smooth(69, 75, lat + (n1 - 0.5) * 8) : smooth(-58, -64, lat);
        if (lon > -75 && lon < -10 && lat > 58) ice = Math.max(ice, smooth(58, 63, lat + (n1 - 0.5) * 3)); // Gronelândia
        c = mixA(c, ICE, ice);
        const lum = 0.86 + 0.26 * n2 + (ice > 0.5 ? 0.06 : 0);
        landT[k * 3] = clamp(c[0] * lum, 0, 255);
        landT[k * 3 + 1] = clamp(c[1] * lum, 0, 255);
        landT[k * 3 + 2] = clamp(c[2] * lum, 0, 255);
        }
        // oceano: plataforma junto à costa, abismo ao largo
        const d = dist[k] + (n1 - 0.5) * 2.5;
        let o = mixA(COASTAL, SHELF, smooth(0, 1.2, d));
        o = mixA(o, DEEP, smooth(0.8, 6, d));
        o = mixA(o, ABYSS, smooth(14, 40, d) * 0.8);
        o = mixA(o, POLARSEA, smooth(72, 86, alat) * 0.45);
        const ol = 0.92 + 0.14 * n2;
        seaT[k * 3] = clamp(o[0] * ol, 0, 255);
        seaT[k * 3 + 1] = clamp(o[1] * ol, 0, 255);
        seaT[k * 3 + 2] = clamp(o[2] * ol, 0, 255);
      }
    }
    TEX = { landT, seaT, mask };
    return TEX;
  }

  // ---- canvases auxiliares -------------------------------------------------------------------------------------
  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }
  function sized(c, w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (!c) return newCanvas(w, h);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
  }
  const L = {
    base: null, stat: null, ocean: null, landc: null, shade: null, stars: null, glow: null,
    baseKey: '', lightKey: '', starKey: '', camKey: '', direct: false, baseFine: true, lastChange: -1e9, grid: null,
    landPath: null, landPathKey: '', countryPaths: {}, countryKey: '', radarPaths: {}, radarCount: 0,
    anims: typeof WeakMap !== 'undefined' ? new WeakMap() : null,
  };

  // ---- caminhos ------------------------------------------------------------------------------------------------
  // preenchimento de anéis com limb-collapse + paridade do antípoda (REA D2); devolve Path2D (evenodd)
  function fillPath(rings, cam, p) {
    const path = p || new Path2D();
    const { cx, cy, R } = cam;
    // antípoda ligeiramente deslocado: nunca cai exatamente no corte ±180 dos anéis planos
    const aLon = wrap180(cam.lon + 180 + 1e-7), aLat = -cam.lat + 1e-7;
    let parity = 0;
    for (const ring of rings) {
      const dc = ring.cen[0] * cam.c0 + ring.cen[1] * cam.c1 + ring.cen[2] * cam.c2;
      if (dc < -ring.sinR - 1e-6) continue;
      const a = ring.xyz;
      let lx = 1, ly = 0;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2];
        let sx = R * (x * cam.e0 + y * cam.e1 + z * cam.e2), sy = -R * (x * cam.n0 + y * cam.n1 + z * cam.n2);
        if (x * cam.c0 + y * cam.c1 + z * cam.c2 <= 0) {
          const d = Math.hypot(sx, sy);
          if (d > 1e-9) { lx = sx / d; ly = sy / d; }
          sx = lx * R;
          sy = ly * R;
        }
        if (i) path.lineTo(cx + sx, cy + sy);
        else path.moveTo(cx + sx, cy + sy);
      }
      path.closePath();
      if (pipPlanar(ring, aLon, aLat)) parity ^= 1;
    }
    if (parity) {
      path.moveTo(cx + R, cy);
      path.arc(cx, cy, R, 0, TAU);
    }
    return path;
  }
  // traço só da parte visível; nas passagens pelo horizonte interpola o ponto do limbo
  function strokeXYZ(p, cam, a, closed) {
    const { cx, cy, R } = cam;
    const n = a.length / 3;
    if (n < 2) return;
    let pz = 0, px = 0, py = 0, ax = 0, ay = 0, az = 0, down = false;
    const end = closed ? n + 1 : n;
    for (let s = 0; s < end; s++) {
      const k = (s % n) * 3, x = a[k], y = a[k + 1], z = a[k + 2];
      const zz = x * cam.c0 + y * cam.c1 + z * cam.c2;
      const sx = cx + R * (x * cam.e0 + y * cam.e1 + z * cam.e2), sy = cy - R * (x * cam.n0 + y * cam.n1 + z * cam.n2);
      if (s > 0) {
        if (zz > 0 && pz > 0) {
          if (!down) { p.moveTo(px, py); down = true; }
          p.lineTo(sx, sy);
        } else if (zz > 0 || pz > 0) {
          const t = pz / (pz - zz);
          const m = norm3([ax + (x - ax) * t, ay + (y - ay) * t, az + (z - az) * t]);
          const mx = cx + R * (m[0] * cam.e0 + m[1] * cam.e1 + m[2] * cam.e2), my = cy - R * (m[0] * cam.n0 + m[1] * cam.n1 + m[2] * cam.n2);
          if (zz > 0) {
            p.moveTo(mx, my);
            p.lineTo(sx, sy);
            down = true;
          } else {
            if (!down) p.moveTo(px, py);
            p.lineTo(mx, my);
            down = false;
          }
        } else down = false;
      }
      pz = zz; px = sx; py = sy; ax = x; ay = y; az = z;
    }
  }
  // circunferência menor (calote) de raio angular rho (rad) em torno de c (vetor unitário)
  const CIRC_N = 96;
  function capXYZ(c, rho, n) {
    const N = n || CIRC_N;
    const a = Math.abs(c[2]) < 0.9 ? norm3([-c[1], c[0], 0]) : norm3([0, -c[2], c[1]]);
    const b = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
    const cr = Math.cos(rho), sr = Math.sin(rho);
    const out = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * TAU, ct = Math.cos(t) * sr, st = Math.sin(t) * sr;
      out[i * 3] = c[0] * cr + a[0] * ct + b[0] * st;
      out[i * 3 + 1] = c[1] * cr + a[1] * ct + b[1] * st;
      out[i * 3 + 2] = c[2] * cr + a[2] * ct + b[2] * st;
    }
    return out;
  }
  function capFill(cam, c, rho, xyz) {
    const p = new Path2D();
    const { cx, cy, R } = cam;
    let lx = 1, ly = 0;
    for (let i = 0; i < xyz.length; i += 3) {
      const x = xyz[i], y = xyz[i + 1], z = xyz[i + 2];
      let sx = R * (x * cam.e0 + y * cam.e1 + z * cam.e2), sy = -R * (x * cam.n0 + y * cam.n1 + z * cam.n2);
      if (x * cam.c0 + y * cam.c1 + z * cam.c2 <= 0) {
        const d = Math.hypot(sx, sy);
        if (d > 1e-9) { lx = sx / d; ly = sy / d; }
        sx = lx * R;
        sy = ly * R;
      }
      if (i) p.lineTo(cx + sx, cy + sy);
      else p.moveTo(cx + sx, cy + sy);
    }
    p.closePath();
    // antípoda dentro da calote ⇔ ângulo(c, −centro da vista) < rho
    if (-(c[0] * cam.c0 + c[1] * cam.c1 + c[2] * cam.c2) > Math.cos(rho)) {
      p.moveTo(cx + R, cy);
      p.arc(cx, cy, R, 0, TAU);
    }
    return p;
  }
  function gcXYZ(a, b, stepRad) {
    const d = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
    const n = Math.max(1, Math.ceil(d / (stepRad || DENSIFY)));
    const out = new Float64Array((n + 1) * 3);
    const s = Math.sin(d);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      let x, y, z;
      if (s < 1e-9) { x = a[0]; y = a[1]; z = a[2]; } else {
        const k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
        x = a[0] * k1 + b[0] * k2; y = a[1] * k1 + b[1] * k2; z = a[2] * k1 + b[2] * k2;
      }
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    }
    return out;
  }

  // ---- amostragem por pixel (biomas e luz) -------------------------------------------------------------------------
  function gridFor(cam, step) {
    const x0 = Math.max(0, Math.floor(cam.cx - cam.R - step)), x1 = Math.min(cam.w, Math.ceil(cam.cx + cam.R + step));
    const y0 = Math.max(0, Math.floor(cam.cy - cam.R - step)), y1 = Math.min(cam.h, Math.ceil(cam.cy + cam.R + step));
    const gw = Math.max(1, Math.ceil((x1 - x0) / step)), gh = Math.max(1, Math.ceil((y1 - y0) / step));
    return { x0, y0, step, gw, gh };
  }
  function imgOf(c, gw, gh) {
    const g = c.getContext('2d');
    if (!c._img || c._img.width !== gw || c._img.height !== gh) c._img = g.createImageData(gw, gh);
    return c._img;
  }
  function renderBiome(cam, grid) {
    const tex = buildTextures();
    const { x0, y0, step, gw, gh } = grid;
    L.ocean = sized(L.ocean, gw, gh);
    L.landc = sized(L.landc, gw, gh);
    const io = imgOf(L.ocean, gw, gh), il = imgOf(L.landc, gw, gh);
    const od = io.data, ld = il.data, sea = tex.seaT, lt = tex.landT;
    const R = cam.R;
    for (let j = 0; j < gh; j++) {
      const v0 = (cam.cy - (y0 + (j + 0.5) * step)) / R;
      for (let i = 0; i < gw; i++) {
        let u = (x0 + (i + 0.5) * step - cam.cx) / R, v = v0;
        const rr = u * u + v * v;
        let z = 0;
        if (rr >= 1) {
          const s = 1 / Math.sqrt(rr);
          u *= s; v *= s;
        } else z = Math.sqrt(1 - rr);
        const wx = u * cam.e0 + v * cam.n0 + z * cam.c0, wy = u * cam.e1 + v * cam.n1 + z * cam.c1, wz = v * cam.n2 + z * cam.c2;
        const lat = Math.asin(wz > 1 ? 1 : wz < -1 ? -1 : wz) * R2D, lon = Math.atan2(wy, wx) * R2D;
        // bilinear na textura 0,5°
        const fx = (lon + 180) * 2 - 0.5, fy = (90 - lat) * 2 - 0.5;
        let ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const ix1 = (ix + 1 + TW) % TW;
        ix = (ix + TW) % TW;
        const iy0 = iy < 0 ? 0 : iy >= TH ? TH - 1 : iy, iy1 = iy + 1 >= TH ? TH - 1 : iy + 1 < 0 ? 0 : iy + 1;
        const k00 = (iy0 * TW + ix) * 3, k10 = (iy0 * TW + ix1) * 3, k01 = (iy1 * TW + ix) * 3, k11 = (iy1 * TW + ix1) * 3;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const o = (j * gw + i) * 4;
        od[o] = sea[k00] * w00 + sea[k10] * w10 + sea[k01] * w01 + sea[k11] * w11;
        od[o + 1] = sea[k00 + 1] * w00 + sea[k10 + 1] * w10 + sea[k01 + 1] * w01 + sea[k11 + 1] * w11;
        od[o + 2] = sea[k00 + 2] * w00 + sea[k10 + 2] * w10 + sea[k01 + 2] * w01 + sea[k11 + 2] * w11;
        od[o + 3] = 255;
        ld[o] = lt[k00] * w00 + lt[k10] * w10 + lt[k01] * w01 + lt[k11] * w11;
        ld[o + 1] = lt[k00 + 1] * w00 + lt[k10 + 1] * w10 + lt[k01 + 1] * w01 + lt[k11 + 1] * w11;
        ld[o + 2] = lt[k00 + 2] * w00 + lt[k10 + 2] * w10 + lt[k01 + 2] * w01 + lt[k11 + 2] * w11;
        ld[o + 3] = 255;
      }
    }
    L.ocean.getContext('2d').putImageData(io, 0, 0);
    L.landc.getContext('2d').putImageData(il, 0, 0);
  }
  // sombra: noite, crepúsculo quente, atenuação de Lambert, escurecimento do limbo e névoa azul atmosférica
  function renderShade(cam, grid, s) {
    const { x0, y0, step, gw, gh } = grid;
    L.shade = sized(L.shade, gw, gh);
    const img = imgOf(L.shade, gw, gh), d = img.data;
    const R = cam.R;
    const se = s[0] * cam.e0 + s[1] * cam.e1 + s[2] * cam.e2;
    const sn = s[0] * cam.n0 + s[1] * cam.n1 + s[2] * cam.n2;
    const sc = s[0] * cam.c0 + s[1] * cam.c1 + s[2] * cam.c2;
    for (let j = 0; j < gh; j++) {
      const v0 = (cam.cy - (y0 + (j + 0.5) * step)) / R;
      for (let i = 0; i < gw; i++) {
        let u = (x0 + (i + 0.5) * step - cam.cx) / R, v = v0;
        const rr = u * u + v * v;
        let z = 0;
        if (rr >= 1) {
          const q = 1 / Math.sqrt(rr);
          u *= q; v *= q;
        } else z = Math.sqrt(1 - rr);
        const sd = u * se + v * sn + z * sc;
        const N = smooth(0.1, -0.16, sd);
        let r = 0, g = 0, b = 0, a = 0, al;
        // atenuação diurna (Lambert suave)
        const dl = 1 - (sd > 0 ? sd : 0);
        al = (1 - N) * 0.3 * dl * Math.sqrt(dl);
        r = 2 * al; g = 6 * al; b = 16 * al; a = al;
        // noite
        al = 0.68 * N;
        r = 5 * al + r * (1 - al); g = 11 * al + g * (1 - al); b = 34 * al + b * (1 - al); a = al + a * (1 - al);
        // crepúsculo quente junto ao terminador
        const tw = (sd - 0.035) / 0.06;
        al = 0.08 * Math.exp(-tw * tw);
        r = 190 * al + r * (1 - al); g = 100 * al + g * (1 - al); b = 45 * al + b * (1 - al); a = al + a * (1 - al);
        // limbo
        const lz = 1 - z;
        al = lz * lz * lz * 0.6;
        r = 1 * al + r * (1 - al); g = 3 * al + g * (1 - al); b = 10 * al + b * (1 - al); a = al + a * (1 - al);
        // névoa atmosférica no lado de dia
        al = lz * lz * lz * lz * (1 - N) * 0.55 * (0.35 + 0.65 * smooth(-0.25, 0.4, sd));
        r = 112 * al + r * (1 - al); g = 172 * al + g * (1 - al); b = 255 * al + b * (1 - al); a = al + a * (1 - al);
        const o = (j * gw + i) * 4;
        if (a > 0.002) {
          d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = a * 255;
        } else {
          d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
        }
      }
    }
    L.shade.getContext('2d').putImageData(img, 0, 0);
  }

  // ---- sprites --------------------------------------------------------------------------------------------------
  function glowSprite() {
    if (L.glow) return L.glow;
    const c = newCanvas(32, 32), g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,240,205,1)');
    gr.addColorStop(0.18, 'rgba(255,205,120,0.8)');
    gr.addColorStop(0.5, 'rgba(255,160,70,0.22)');
    gr.addColorStop(1, 'rgba(255,140,50,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    L.glow = c;
    return c;
  }
  // brilho radial de uma cor (sprite em cache; alfa via globalAlpha)
  const glowCache = {};
  function glowOf(col) {
    if (glowCache[col]) return glowCache[col];
    const c = newCanvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, css(col, 1));
    gr.addColorStop(0.45, css(col, 0.4));
    gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache[col] = c;
    return c;
  }
  function starsCanvas(cam) {
    const key = cam.w + 'x' + cam.h + '@' + cam.dpr;
    if (L.stars && L.starKey === key) return L.stars;
    const c = sized(L.stars, cam.w * cam.dpr, cam.h * cam.dpr), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = css(PAL.space);
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    const r = OV.RNG.create(0x51a25);
    const n = Math.round((cam.w * cam.h) / 1900);
    for (let i = 0; i < n; i++) {
      const x = r.next() * cam.w, y = r.next() * cam.h, m = r.next();
      const s = m > 0.985 ? 1.6 : m > 0.9 ? 1.1 : 0.7;
      const tint = r.next();
      g.fillStyle = tint > 0.8 ? 'rgba(255,214,170,' : tint > 0.6 ? 'rgba(170,200,255,' : 'rgba(225,235,255,';
      g.fillStyle += (0.25 + 0.6 * m * m).toFixed(2) + ')';
      g.fillRect(x, y, s, s);
    }
    // faixa ténue da Via Láctea
    g.save();
    g.translate(cam.w * 0.5, cam.h * 0.5);
    g.rotate(-0.45);
    const mw = g.createLinearGradient(0, -cam.h * 0.25, 0, cam.h * 0.25);
    mw.addColorStop(0, 'rgba(120,140,200,0)');
    mw.addColorStop(0.5, 'rgba(120,140,200,0.06)');
    mw.addColorStop(1, 'rgba(120,140,200,0)');
    g.fillStyle = mw;
    g.fillRect(-cam.w, -cam.h * 0.25, cam.w * 2, cam.h * 0.5);
    g.restore();
    L.stars = c;
    L.starKey = key;
    return c;
  }

  // ---- camada base (depende só da câmara) ----------------------------------------------------------------------------
  function landPathFor(cam, key) {
    if (L.landPath && L.landPathKey === key) return L.landPath;
    L.landPath = fillPath(geo().land, cam);
    L.landPathKey = key;
    L.countryPaths = {};
    return L.landPath;
  }
  function discPath(cam, extra) {
    const p = new Path2D();
    p.arc(cam.cx, cam.cy, cam.R + (extra || 0), 0, TAU);
    return p;
  }
  // o disco cobre a janela inteira? (então não há espaço nem halo para desenhar)
  function coversView(cam) {
    const dx = Math.max(cam.cx, cam.w - cam.cx), dy = Math.max(cam.cy, cam.h - cam.cy);
    return dx * dx + dy * dy < cam.R * cam.R * 0.995;
  }
  const haloWidth = (R) => Math.min(R * 0.11, 70);
  function renderBase(g, cam, key, fine, view) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    const covered = coversView(cam);
    if (!covered) g.drawImage(starsCanvas(cam), 0, 0);
    g.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    const { cx, cy, R } = cam;
    // atmosfera exterior (só o anel)
    const th = haloWidth(R);
    if (!covered) {
      const ag = g.createRadialGradient(cx, cy, R * 0.97, cx, cy, R + th);
      ag.addColorStop(0, 'rgba(120,190,255,0.62)');
      ag.addColorStop(0.18, 'rgba(80,150,255,0.30)');
      ag.addColorStop(0.5, 'rgba(50,100,220,0.10)');
      ag.addColorStop(1, 'rgba(30,60,160,0)');
      g.fillStyle = ag;
      const ringP = new Path2D();
      ringP.arc(cx, cy, R + th, 0, TAU);
      ringP.arc(cx, cy, R - 1, 0, TAU, true);
      g.fill(ringP);
    }
    // oceano e biomas amostrados
    const area = Math.min(cam.w, 2 * R) * Math.min(cam.h, 2 * R);
    let step = fine ? 3 : 6;
    step = Math.max(step, Math.ceil(Math.sqrt(area / (fine ? 140000 : 45000))));
    const grid = gridFor(cam, step);
    renderBiome(cam, grid);
    L.grid = grid;
    const disc = discPath(cam);
    const land = landPathFor(cam, key);
    g.save();
    g.clip(disc);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(L.ocean, grid.x0, grid.y0, grid.gw * step, grid.gh * step);
    g.save();
    g.clip(land, 'evenodd');
    g.drawImage(L.landc, grid.x0, grid.y0, grid.gw * step, grid.gh * step);
    g.restore();
    // costas (só segmentos visíveis)
    const coast = new Path2D();
    for (const ring of geo().land) {
      const dc = ring.cen[0] * cam.c0 + ring.cen[1] * cam.c1 + ring.cen[2] * cam.c2;
      if (dc < -ring.sinR - 1e-6) continue;
      strokeXYZ(coast, cam, ring.xyz, true);
    }
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(8,30,40,0.45)';
    g.lineWidth = 2.2;
    g.stroke(coast);
    g.strokeStyle = css(PAL.coast, 0.5);
    g.lineWidth = 0.8;
    g.stroke(coast);
    // grelha
    if (view.showGrid !== false) {
      const gp = new Path2D(), gm = new Path2D();
      for (const l of geo().grid) strokeXYZ(l.major ? gm : gp, cam, l.xyz, false);
      g.strokeStyle = css(PAL.grid, 0.09);
      g.lineWidth = 0.7;
      g.stroke(gp);
      g.strokeStyle = css(PAL.grid, 0.17);
      g.lineWidth = 0.9;
      g.stroke(gm);
    }
    g.restore();
    // aresta fina do disco
    g.strokeStyle = 'rgba(150,200,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
  }

  // ---- camada de luz (câmara + sol) ----------------------------------------------------------------------------------
  function renderLight(g, cam, s, baseCanvas) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    if (baseCanvas) g.drawImage(baseCanvas, 0, 0);
    g.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    const { cx, cy, R } = cam;
    const grid = gridFor(cam, Math.max(4, L.grid ? L.grid.step : 4));
    renderShade(cam, grid, s);
    g.save();
    g.clip(discPath(cam));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(L.shade, grid.x0, grid.y0, grid.gw * grid.step, grid.gh * grid.step);
    g.restore();
    // halo exterior: apaga-se do lado noturno (gradiente ao longo da direção do sol no ecrã)
    if (!coversView(cam)) {
      const se = s[0] * cam.e0 + s[1] * cam.e1 + s[2] * cam.e2, sn = s[0] * cam.n0 + s[1] * cam.n1 + s[2] * cam.n2;
      const m = Math.hypot(se, sn);
      const dx = m > 1e-6 ? se / m : 1, dy = m > 1e-6 ? -sn / m : 0;
      const th = haloWidth(R) + 2;
      const gr = g.createLinearGradient(cx - dx * (R + th), cy - dy * (R + th), cx + dx * (R + th), cy + dy * (R + th));
      for (let k = 0; k <= 8; k++) {
        const tt = -1 + k / 4;
        const N = smooth(0.1, -0.16, tt * m);
        gr.addColorStop(k / 8, 'rgba(2,5,11,' + (0.85 * N).toFixed(3) + ')');
      }
      const ringP = new Path2D();
      ringP.arc(cx, cy, R + th, 0, TAU);
      ringP.arc(cx, cy, R - 0.5, 0, TAU, true);
      g.fillStyle = gr;
      g.fill(ringP);
    }
    g.save();
    g.clip(discPath(cam));
    // brilho especular do sol no oceano (vetor médio sol/observador)
    const sc = s[0] * cam.c0 + s[1] * cam.c1 + s[2] * cam.c2;
    if (sc > -0.35) {
      const hv = norm3([s[0] + cam.c0, s[1] + cam.c1, s[2] + cam.c2]);
      const hx = cx + R * (hv[0] * cam.e0 + hv[1] * cam.e1 + hv[2] * cam.e2), hy = cy - R * (hv[0] * cam.n0 + hv[1] * cam.n1 + hv[2] * cam.n2);
      const k = smooth(-0.35, 0.3, sc);
      const ocean = new Path2D(L.landPath);
      ocean.moveTo(cx + R, cy);
      ocean.arc(cx, cy, R, 0, TAU);
      g.save();
      g.clip(ocean, 'evenodd');
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(hx, hy, 0, hx, hy, R * 0.3);
      gr.addColorStop(0, 'rgba(255,246,220,' + (0.26 * k).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(160,210,255,' + (0.08 * k).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(120,180,255,0)');
      g.fillStyle = gr;
      g.fillRect(hx - R * 0.3, hy - R * 0.3, R * 0.6, R * 0.6);
      g.restore();
    }
    // luzes das cidades no lado noturno
    const lights = geo().lights, spr = glowSprite();
    g.globalCompositeOperation = 'lighter';
    const base = clamp(R / 110, 3, 15);
    for (let i = 0; i < lights.length; i += 5) {
      const x = lights[i], y = lights[i + 1], z = lights[i + 2];
      const zz = x * cam.c0 + y * cam.c1 + z * cam.c2;
      if (zz < 0.02) continue;
      const sd = x * s[0] + y * s[1] + z * s[2];
      const N = smooth(0.04, -0.1, sd);
      if (N < 0.02) continue;
      const px = cx + R * (x * cam.e0 + y * cam.e1 + z * cam.e2), py = cy - R * (x * cam.n0 + y * cam.n1 + z * cam.n2);
      if (px < -20 || py < -20 || px > cam.w + 20 || py > cam.h + 20) continue;
      const sz = base * lights[i + 4] * (0.5 + 0.5 * zz);
      g.globalAlpha = clamp(N * lights[i + 3] * (0.55 + 0.45 * zz) * 1.25, 0, 1);
      g.drawImage(spr, px - sz, py - sz, sz * 2, sz * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }

  // ---- radares --------------------------------------------------------------------------------------------------
  function radarCircles(G) {
    if (!G) return [];
    if (OV.World && typeof OV.World.radarCircles === 'function') {
      try {
        const r = OV.World.radarCircles(G);
        if (Array.isArray(r)) return r;
      } catch (e) {
        // módulo do mundo indisponível: recorre ao cálculo local
      }
    }
    const out = [];
    const F = OV.Data.facilities || {};
    for (const b of G.bases || []) {
      for (const f of b.grid || []) {
        const d = F[f.type];
        if (!d || !(d.radarRange > 0) || (f.daysLeft | 0) > 0) continue;
        out.push({ lon: b.lon, lat: b.lat, rangeNm: d.radarRange, kind: f.type, baseId: b.id });
      }
    }
    for (const id in G.crafts || {}) {
      const c = G.crafts[id];
      if (!airborne(c)) continue;
      const d = OV.Data.crafts[c.type];
      out.push({ lon: c.lon, lat: c.lat, rangeNm: (d && d.radarRange) || 672, kind: 'craft', craftId: c.id });
    }
    return out;
  }
  const airborne = (c) => c && (c.status === 'out' || c.status === 'patrol' || c.status === 'returning');

  // ---- objetos visíveis ------------------------------------------------------------------------------------------
  const PRIORITY = { ufo: 0, site: 1, craft: 2, alienBase: 3, base: 4, city: 5 };
  function ufoShown(G, u) {
    return u.detected || u.status === 'crashed' || !!(G.debug && G.debug.revealUfos);
  }
  function markerScale(view) {
    return 0.86 + 0.09 * clamp(+view.zoom || 0, 0, ZMAX);
  }
  function collect(G, view, cam) {
    const out = [];
    const ms = markerScale(view);
    const push = (kind, id, lon, lat, r, obj, extra) => {
      const v = vec(lon, lat);
      const p = projV(cam, v[0], v[1], v[2]);
      out.push(Object.assign({ kind, id, lon, lat, x: p.x, y: p.y, front: p.front, r: r * ms, obj, v }, extra));
    };
    const z = +view.zoom || 0;
    if (z >= 2.6) {
      for (const c of OV.Data.cities || []) push('city', c.id, c.lon, c.lat, 3, c, { fade: smooth(2.6, 3, z) });
    }
    if (!G) return out;
    for (const b of G.bases || []) push('base', b.id, b.lon, b.lat, 7, b);
    const reveal = !!(G.debug && G.debug.revealUfos);
    for (const a of G.alienBases || []) if (a.discovered || reveal) push('alienBase', a.id, a.lon, a.lat, 8, a, { hidden: !a.discovered });
    for (const s of G.sites || []) push('site', s.id, s.lon, s.lat, 9, s);
    for (const u of G.ufos || []) {
      if (!ufoShown(G, u)) continue;
      const def = OV.Data.ufos[u.type];
      const size = def ? def.size : 1;
      push('ufo', u.id, u.lon, u.lat, u.status === 'flying' ? 4 + size * 1.1 : 8, u, { size, status: u.status, hidden: !u.detected && u.status !== 'crashed' });
    }
    for (const id in G.crafts || {}) {
      const c = G.crafts[id];
      if (airborne(c)) push('craft', c.id, c.lon, c.lat, 7, c);
    }
    return out;
  }
  function hitList(G, view, px, py) {
    const cam = camOf(view);
    const reach = view.touch ? 22 : 14;
    const z = +view.zoom || 0;
    const hits = [];
    for (const m of collect(G, view, cam)) {
      if (!m.front) continue;
      if (m.kind === 'city' && z < 2.75) continue;
      const d = Math.hypot(m.x - px, m.y - py);
      const lim = Math.max(reach, m.r + 6);
      if (d <= lim) hits.push({ kind: m.kind, id: m.id, d });
    }
    hits.sort((a, b) => (Math.abs(a.d - b.d) > 5 ? a.d - b.d : PRIORITY[a.kind] - PRIORITY[b.kind] || a.d - b.d));
    return hits;
  }
  const objectsAt = (G, view, px, py) => hitList(G, view, px, py);
  function objectAt(G, view, px, py) {
    const h = hitList(G, view, px, py);
    return h.length ? { kind: h[0].kind, id: h[0].id } : null;
  }
  function countryAt(view, px, py) {
    const p = pick(view, px, py);
    if (!p) return null;
    return OV.Data.world.countryAt(p.lon, p.lat, 1);
  }
  function refPos(G, ref) {
    if (!ref) return null;
    if (ref.kind === 'city') {
      const c = OV.Data.citiesById && OV.Data.citiesById[ref.id];
      return c ? { lon: c.lon, lat: c.lat } : null;
    }
    if (ref.kind === 'point') return { lon: ref.lon, lat: ref.lat };
    if (!G || !OV.Campaign || !OV.Campaign.targetOf) return null;
    const t = OV.Campaign.targetOf(G, ref);
    return t && Number.isFinite(t.lon) ? { lon: t.lon, lat: t.lat } : null;
  }
  function screenPos(G, view, ref) {
    const p = refPos(G, ref);
    return p ? project(view, p.lon, p.lat) : null;
  }

  // ---- desenho de marcadores ------------------------------------------------------------------------------------------
  function label(ctx, text, x, y, col, size, align) {
    ctx.font = '600 ' + size + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,6,14,0.82)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = css(col);
    ctx.fillText(text, x, y);
  }
  function drawBase(ctx, m, s) {
    const h = 5.2 * s;
    ctx.fillStyle = 'rgba(0,8,24,0.55)';
    ctx.fillRect(m.x - h - 1.5, m.y - h - 0.5, h * 2 + 3, h * 2 + 3);
    ctx.fillStyle = css(PAL.base);
    ctx.fillRect(m.x - h, m.y - h, h * 2, h * 2);
    ctx.fillStyle = css(PAL.baseHi, 0.85);
    ctx.fillRect(m.x - h, m.y - h, h * 2, h * 0.55);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(m.x - h, m.y - h, h * 2, h * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(m.x - 1.2, m.y - 1.2, 2.4, 2.4);
  }
  function drawAlienBase(ctx, m, s, t) {
    const r = 7 * s;
    const pulse = 0.5 + 0.5 * Math.sin(t / 420 + m.ph * 6);
    ctx.save();
    ctx.globalAlpha = m.obj.discovered ? 1 : 0.5;
    ctx.fillStyle = css(PAL.alienBase, 0.18 + 0.12 * pulse);
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 1.9, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6;
      ctx.lineTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,6,48,0.9)';
    ctx.fill();
    ctx.strokeStyle = css(PAL.alienBase);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = css(PAL.alienBase);
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, r * 0.5, r * 0.26, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a0628';
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.16, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  function ping(ctx, x, y, col, t, period, r0, r1, ph, width) {
    const f = ((t / period + ph) % 1 + 1) % 1;
    ctx.strokeStyle = css(col, (1 - f) * 0.75);
    ctx.lineWidth = width || 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r0 + (r1 - r0) * f, 0, TAU);
    ctx.stroke();
  }
  function drawUfo(ctx, m, s, t) {
    const u = m.obj;
    if (u.status === 'crashed') {
      const r = 6.5 * s;
      ping(ctx, m.x, m.y, PAL.crashed, t, 2600, r, r * 3, m.ph, 1.2);
      ctx.fillStyle = 'rgba(40,14,0,0.75)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, r * 1.15, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = css(PAL.crashed);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x - r * 0.6, m.y - r * 0.6);
      ctx.lineTo(m.x + r * 0.6, m.y + r * 0.6);
      ctx.moveTo(m.x + r * 0.6, m.y - r * 0.6);
      ctx.lineTo(m.x - r * 0.6, m.y + r * 0.6);
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r * 1.15, 0, TAU);
      ctx.stroke();
      ctx.lineCap = 'butt';
      return;
    }
    if (u.status === 'landed') {
      const r = 6 * s;
      ping(ctx, m.x, m.y, PAL.landed, t, 1800, r, r * 3.2, m.ph, 1.4);
      ctx.save();
      ctx.globalAlpha = m.hidden ? 0.45 : 1;
      ctx.fillStyle = 'rgba(40,30,0,0.7)';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - r * 1.25);
      ctx.lineTo(m.x + r * 1.25, m.y);
      ctx.lineTo(m.x, m.y + r * 1.25);
      ctx.lineTo(m.x - r * 1.25, m.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(PAL.landed);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = css(PAL.landed);
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, r * 0.55, r * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    // em voo: ponto vermelho intermitente, tamanho pelo tamanho do OVNI
    const r = (2.6 + m.size * 0.9) * s;
    const blink = ((t / 900 + m.ph) % 1 + 1) % 1;
    const on = blink < 0.62 ? 1 : 0.28;
    ping(ctx, m.x, m.y, PAL.ufo, t, 2200, r + 1, r + 20 * s, m.ph, 1.3);
    ctx.save();
    ctx.globalAlpha = m.hidden ? 0.45 : 1;
    const gl = r * 3.2;
    ctx.globalAlpha = (m.hidden ? 0.45 : 1) * 0.55 * on;
    ctx.drawImage(glowOf(PAL.ufo), m.x - gl, m.y - gl, gl * 2, gl * 2);
    ctx.globalAlpha = m.hidden ? 0.45 : 1;
    if (m.hidden) {
      ctx.strokeStyle = css(PAL.ufo);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, TAU);
      ctx.stroke();
    } else {
      ctx.fillStyle = css(on > 0.5 ? 0xff5a4a : 0x9a1a14);
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = css(0xffd6cc, on > 0.5 ? 0.95 : 0.3);
      ctx.beginPath();
      ctx.arc(m.x - r * 0.25, m.y - r * 0.25, r * 0.38, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,0,0,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r + 0.5, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
  function skull(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y - r * 0.18, r * 0.78, Math.PI * 0.82, Math.PI * 2.18);
    ctx.lineTo(x + r * 0.5, y + r * 0.62);
    ctx.lineTo(x - r * 0.5, y + r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.12, r * 0.22, 0, TAU);
    ctx.arc(x + r * 0.32, y - r * 0.12, r * 0.22, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.12);
    ctx.lineTo(x - r * 0.1, y + r * 0.3);
    ctx.lineTo(x + r * 0.1, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - r * 0.04, y + r * 0.45, r * 0.08, r * 0.2);
    ctx.fillRect(x - r * 0.26, y + r * 0.45, r * 0.08, r * 0.2);
    ctx.fillRect(x + r * 0.18, y + r * 0.45, r * 0.08, r * 0.2);
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawTerror(ctx, m, s, t) {
    const r = 8 * s;
    const pulse = 0.5 + 0.5 * Math.sin(t / 260 + m.ph * 6);
    ping(ctx, m.x, m.y, PAL.terror, t, 1300, r, r * 3.6, m.ph, 2);
    ping(ctx, m.x, m.y, PAL.terror, t, 1300, r, r * 3.6, m.ph + 0.5, 1.2);
    const gl = r * 2.2;
    ctx.globalAlpha = 0.5 + 0.3 * pulse;
    ctx.drawImage(glowOf(PAL.terror), m.x - gl, m.y - gl, gl * 2, gl * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(40,0,0,0.85)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 1.08, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = css(PAL.terror);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // caveira num canvas isolado do destino (destination-out só apaga a própria caveira)
    const k = Math.ceil(r * 2.4);
    const sc = skullSprite(k);
    ctx.drawImage(sc, m.x - k / 2, m.y - k / 2, k, k);
  }
  const skullCache = {};
  function skullSprite(k) {
    if (skullCache[k]) return skullCache[k];
    const d = 2;
    const c = newCanvas(k * d, k * d), g = c.getContext('2d');
    g.scale(d, d);
    g.fillStyle = '#ffe9e4';
    skull(g, k / 2, k / 2, k * 0.36);
    skullCache[k] = c;
    return c;
  }
  function drawCraft(ctx, m, s, ang, t) {
    const c = m.obj, def = OV.Data.crafts[c.type] || {};
    const col = def.transport ? PAL.transport : PAL.craft;
    const r = (def.transport ? 7.5 : 6.5) * s;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(ang);
    ctx.beginPath();
    if (def.transport) {
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(-r * 0.7, r * 0.9);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(-r * 0.7, -r * 0.9);
    } else {
      ctx.moveTo(r * 1.2, 0);
      ctx.lineTo(-r * 0.8, r * 0.75);
      ctx.lineTo(-r * 0.3, 0);
      ctx.lineTo(-r * 0.8, -r * 0.75);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(0,8,16,0.75)';
    ctx.stroke();
    ctx.fillStyle = css(col);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(OV.Color.shade(col, 0.6));
    ctx.stroke();
    ctx.restore();
    if (c.status === 'patrol') {
      ctx.strokeStyle = css(col, 0.55);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -t / 60;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r * 1.9, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function drawCity(ctx, m, s) {
    ctx.globalAlpha = m.fade;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.8 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = css(PAL.city);
    ctx.beginPath();
    ctx.arc(m.x, m.y, 1.8 * s, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function ring(ctx, x, y, r, col, t, strong) {
    ctx.save();
    ctx.strokeStyle = css(col, strong ? 0.95 : 0.6);
    ctx.lineWidth = strong ? 1.6 : 1.2;
    ctx.setLineDash(strong ? [6, 4] : [3, 3]);
    ctx.lineDashOffset = -t / 45;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (strong) {
      // cantoneiras
      const b = r + 5 + Math.sin(t / 250) * 1.5, q = 5;
      ctx.lineWidth = 2;
      ctx.strokeStyle = css(col);
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + sx * b, y + sy * (b - q));
        ctx.lineTo(x + sx * b, y + sy * b);
        ctx.lineTo(x + sx * (b - q), y + sy * b);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function colourOf(m) {
    if (m.kind === 'ufo') return m.status === 'crashed' ? PAL.crashed : m.status === 'landed' ? PAL.landed : PAL.ufo;
    if (m.kind === 'site') return PAL.terror;
    if (m.kind === 'alienBase') return PAL.alienBase;
    if (m.kind === 'craft') return (OV.Data.crafts[m.obj.type] || {}).transport ? PAL.transport : PAL.craft;
    if (m.kind === 'base') return PAL.base;
    return PAL.city;
  }
  function nameOf(G, m) {
    const o = m.obj;
    if (m.kind === 'base') return o.name || T('base.defaultName');
    if (m.kind === 'city') return T(o.nameKey);
    if (m.kind === 'site') return T('city.' + o.cityId);
    if (m.kind === 'craft') {
      const def = OV.Data.crafts[o.type];
      return o.name || T('craft.instance', { type: def ? T(def.nameKey) : o.type, n: o.num });
    }
    if (m.kind === 'ufo') {
      const def = OV.Data.ufos[o.type];
      if (!def) return '';
      return o.hyper ? T(def.nameKey) : T(def.sizeKey);
    }
    return '';
  }

  // seta junto ao limbo/borda para objetos importantes fora de vista
  function edgeArrow(ctx, cam, m, col, t) {
    let dx, dy, dist;
    if (!m.front) {
      dx = m.x - cam.cx;
      dy = m.y - cam.cy;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      dist = cam.R + 12;
    } else {
      dx = m.x - cam.w / 2;
      dy = m.y - cam.h / 2;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      dist = d;
    }
    const ox = m.front ? cam.w / 2 : cam.cx, oy = m.front ? cam.h / 2 : cam.cy;
    let x = ox + dx * dist, y = oy + dy * dist;
    const pad = 16;
    // recorta à janela
    const kx = dx > 0 ? (cam.w - pad - ox) / dx : dx < 0 ? (pad - ox) / dx : Infinity;
    const ky = dy > 0 ? (cam.h - pad - oy) / dy : dy < 0 ? (pad - oy) / dy : Infinity;
    const kmax = Math.min(kx, ky);
    if (dist > kmax) { x = ox + dx * kmax; y = oy + dy * kmax; }
    const a = Math.atan2(dy, dx);
    const bob = Math.sin(t / 300) * 2;
    ctx.save();
    ctx.translate(x + dx * bob, y + dy * bob);
    ctx.rotate(a);
    ctx.globalAlpha = m.front ? 0.95 : 0.75;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 5.5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, -5.5);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,6,14,0.8)';
    ctx.stroke();
    ctx.fillStyle = css(col);
    ctx.fill();
    ctx.restore();
  }

  // ---- camada dinâmica --------------------------------------------------------------------------------------------
  function countryOutline(ctx, cam, id, strong, key) {
    const rings = countryRings(id);
    if (!rings || !rings.length) return;
    let fp = L.countryPaths[id];
    if (!fp || L.countryKey !== key) {
      if (L.countryKey !== key) { L.countryPaths = {}; L.countryKey = key; }
      fp = { fill: fillPath(rings, cam), line: new Path2D() };
      for (const r of rings) strokeXYZ(fp.line, cam, r.xyz, true);
      L.countryPaths[id] = fp;
    }
    ctx.save();
    ctx.fillStyle = css(PAL.country, strong ? 0.16 : 0.1);
    ctx.fill(fp.fill, 'evenodd');
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,10,0,0.55)';
    ctx.lineWidth = strong ? 3.4 : 2.6;
    ctx.stroke(fp.line);
    ctx.strokeStyle = css(PAL.country, strong ? 0.95 : 0.75);
    ctx.lineWidth = strong ? 1.6 : 1.1;
    ctx.stroke(fp.line);
    ctx.restore();
    const def = OV.Data.countries && OV.Data.countries[id];
    if (def && def.label) {
      const lv = vec(def.label[0], def.label[1]);
      const p = projV(cam, lv[0], lv[1], lv[2]);
      if (p.front) {
        ctx.globalAlpha = 0.85;
        label(ctx, T('country.' + id).toUpperCase(), p.x, p.y, PAL.country, 11, 'center');
        ctx.globalAlpha = 1;
      }
    }
  }
  function drawRadar(ctx, cam, G, view, t, keyCam) {
    if (L.radarCount > 64) { L.radarPaths = {}; L.radarCount = 0; }
    const list = radarCircles(G);
    const seen = {};
    for (const rc of list) {
      const key = rc.lon.toFixed(3) + ',' + rc.lat.toFixed(3) + ',' + rc.rangeNm;
      if (seen[key]) continue;
      seen[key] = 1;
      const c = vec(rc.lon, rc.lat), rho = (rc.rangeNm / 60) * D2R;
      // abate: calote toda atrás
      const dc = c[0] * cam.c0 + c[1] * cam.c1 + c[2] * cam.c2;
      if (dc < -Math.sin(Math.min(Math.PI / 2, rho)) - 0.01 && rho < Math.PI / 2) continue;
      const craft = rc.kind === 'craft';
      const col = craft ? PAL.craftRadar : rc.kind === 'hyper_wave_decoder' ? PAL.hyper : PAL.radar;
      const ck = keyCam + '#' + key;
      let cp = L.radarPaths[ck];
      if (!cp) {
        const xyz = capXYZ(c, rho);
        cp = { fill: craft ? null : capFill(cam, c, rho, xyz), line: new Path2D() };
        strokeXYZ(cp.line, cam, xyz, true);
        L.radarPaths[ck] = cp;
        L.radarCount++;
      }
      if (cp.fill) {
        ctx.fillStyle = css(col, 0.045);
        ctx.fill(cp.fill, 'evenodd');
      }
      const p = cp.line;
      ctx.strokeStyle = css(col, craft ? 0.42 : 0.62);
      ctx.lineWidth = craft ? 1 : 1.3;
      ctx.setLineDash(craft ? [3, 5] : [7, 5]);
      ctx.lineDashOffset = -t / (craft ? 90 : 160);
      ctx.stroke(p);
    }
    ctx.setLineDash([]);
  }
  function headingAngle(cam, v, toV) {
    // tangente do grande círculo para o destino, projetada no ecrã
    const d = v[0] * toV[0] + v[1] * toV[1] + v[2] * toV[2];
    let tx = toV[0] - d * v[0], ty = toV[1] - d * v[1], tz = toV[2] - d * v[2];
    const n = Math.hypot(tx, ty, tz);
    if (n < 1e-9) return null;
    tx /= n; ty /= n; tz /= n;
    const ex = tx * cam.e0 + ty * cam.e1 + tz * cam.e2, ny = tx * cam.n0 + ty * cam.n1 + tz * cam.n2;
    return Math.atan2(-ny, ex);
  }
  function drawDynamic(ctx, cam, G, view, t, keyCam) {
    const z = +view.zoom || 0;
    const s = markerScale(view);
    const mode = view.mode || 'normal';
    const labels = view.labels !== false;
    // países realçados
    const countries = [];
    if (view.country) countries.push([view.country, false]);
    if (view.selection && view.selection.kind === 'country') countries.push([view.selection.id, true]);
    for (const h of view.highlights || []) if (h && h.kind === 'country') countries.push([h.id, true]);
    if (mode === 'placeBase' && view.cursor) {
      const cid = OV.Data.world.countryAt(view.cursor.lon, view.cursor.lat, 1);
      if (cid) countries.push([cid, false]);
    }
    const doneC = {};
    for (const [id, strong] of countries) {
      if (doneC[id] && !strong) continue;
      doneC[id] = 1;
      countryOutline(ctx, cam, id, strong, keyCam);
    }
    if (G && view.showRadar !== false) drawRadar(ctx, cam, G, view, t, keyCam);
    const ms = collect(G, view, cam);
    for (const m of ms) m.ph = strHash(m.kind + m.id);
    // rotas das naves
    if (G) {
      for (const m of ms) {
        if (m.kind !== 'craft') continue;
        const c = m.obj;
        let dp = null;
        if (c.dest) dp = c.dest.kind === 'point' ? { lon: c.dest.lon, lat: c.dest.lat } : refPos(G, c.dest);
        if (!dp) continue;
        const dv = vec(dp.lon, dp.lat);
        m.toV = dv;
        if (c.status === 'patrol') continue;
        const pth = new Path2D();
        strokeXYZ(pth, cam, gcXYZ(m.v, dv, 1.5 * D2R), false);
        const col = colourOf(m);
        ctx.strokeStyle = 'rgba(0,6,14,0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.stroke(pth);
        ctx.strokeStyle = css(col, c.status === 'returning' ? 0.45 : 0.85);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -t / 40;
        ctx.stroke(pth);
        ctx.setLineDash([]);
        if (c.dest.kind === 'point') {
          const q = projV(cam, dv[0], dv[1], dv[2]);
          if (q.front) {
            ctx.strokeStyle = css(col, 0.9);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(q.x - 4, q.y - 4); ctx.lineTo(q.x + 4, q.y + 4);
            ctx.moveTo(q.x + 4, q.y - 4); ctx.lineTo(q.x - 4, q.y + 4);
            ctx.stroke();
          }
        }
      }
    }
    // marcadores, de baixo para cima
    const order = (m) => (m.kind === 'city' ? 0 : m.kind === 'base' ? 1 : m.kind === 'alienBase' ? 2 : m.kind === 'site' ? 3
      : m.kind === 'ufo' && m.status !== 'flying' ? 4 : m.kind === 'craft' ? 5 : 6);
    const drawn = ms.filter((m) => m.front).sort((a, b) => order(a) - order(b));
    for (const m of drawn) {
      if (m.x < -60 || m.y < -60 || m.x > cam.w + 60 || m.y > cam.h + 60) continue;
      if (m.kind === 'city') drawCity(ctx, m, s);
      else if (m.kind === 'base') drawBase(ctx, m, s);
      else if (m.kind === 'alienBase') drawAlienBase(ctx, m, s, t);
      else if (m.kind === 'site') drawTerror(ctx, m, s, t);
      else if (m.kind === 'ufo') drawUfo(ctx, m, s, t);
      else if (m.kind === 'craft') {
        let a = m.toV ? headingAngle(cam, m.v, m.toV) : null;
        if (a === null || m.obj.status === 'patrol') a = t / 900 + m.ph * TAU;
        drawCraft(ctx, m, s, a, t);
      }
    }
    // realces, passagem do rato e seleção
    const find = (ref) => (ref ? ms.find((m) => m.kind === ref.kind && m.id === ref.id) : null);
    for (const h of view.highlights || []) {
      const m = find(h);
      if (!m) continue;
      if (m.front) {
        ping(ctx, m.x, m.y, colourOf(m), t, 1000, m.r + 4, m.r + 34, 0, 2.2);
        ping(ctx, m.x, m.y, colourOf(m), t, 1000, m.r + 4, m.r + 34, 0.5, 1.4);
      }
    }
    const hov = find(view.hover);
    if (hov && hov.front) ring(ctx, hov.x, hov.y, hov.r + 7, PAL.sel, t, false);
    const sel = find(view.selection);
    if (sel && sel.front) ring(ctx, sel.x, sel.y, sel.r + 9, PAL.sel, t, true);
    // rótulos com prioridade (seleção, terror, bases, OVNIs, naves, cidades) e sem sobreposições
    if (labels) {
      const fs = Math.round(10 + Math.min(2, z * 0.5));
      const rank = (m) => (m === sel ? 0 : m === hov ? 1 : m.kind === 'site' ? 2 : m.kind === 'base' ? 3 : m.kind === 'ufo' ? 4 : m.kind === 'craft' ? 5 : 6);
      const want = [];
      for (const m of drawn) {
        if (m.x < -60 || m.y < -60 || m.x > cam.w + 60 || m.y > cam.h + 60) continue;
        let show = m === sel || m === hov;
        if (m.kind === 'base') show = show || z >= 2;
        else if (m.kind === 'city') show = show || z >= 3;
        else if (m.kind === 'site') show = true;
        else if (m.kind === 'craft') show = show || z >= 3;
        if (show) want.push(m);
      }
      want.sort((p, q) => rank(p) - rank(q));
      const boxes = [];
      for (const m of drawn) boxes.push([m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r, m]);
      const hit = (r, self) => r[0] < 4 || r[2] > cam.w - 4 || r[1] < 2 || r[3] > cam.h - 2
        || boxes.some((b) => b[4] !== self && r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]);
      for (const m of want) {
        let txt = nameOf(G, m);
        if (!txt) continue;
        if (m.kind === 'site') txt = txt.toUpperCase();
        const size = m.kind === 'city' ? fs - 1 : fs;
        ctx.font = '600 ' + size + 'px ' + FONT;
        const tw = ctx.measureText(txt).width;
        // à direita; se colidir, à esquerda; senão por baixo; cidades simplesmente desistem
        const cand = [[m.x + m.r + 6, m.y, 'left'], [m.x - m.r - 6, m.y, 'right'], [m.x, m.y + m.r + size * 0.5 + 5, 'center']];
        let placed = null;
        for (const [lx, ly, al] of cand) {
          const x0 = al === 'left' ? lx : al === 'right' ? lx - tw : lx - tw / 2;
          const r = [x0 - 2, ly - size * 0.6, x0 + tw + 2, ly + size * 0.6];
          if (!hit(r, m)) { placed = [lx, ly, al, r]; break; }
          if (m.kind === 'city') break;
        }
        if (!placed) {
          if (m.kind === 'city' || m.kind === 'craft') continue;
          const lx = m.x + m.r + 6;
          placed = [lx, m.y, 'left', [lx, m.y - size * 0.6, lx + tw, m.y + size * 0.6]];
        }
        boxes.push(placed[3].concat(['own']));
        const col = m.kind === 'city' ? PAL.city : m.kind === 'base' ? PAL.label : colourOf(m);
        ctx.globalAlpha = m.kind === 'city' ? m.fade : 1;
        label(ctx, txt, placed[0], placed[1], col, size, placed[2]);
        ctx.globalAlpha = 1;
      }
    }
    // modos de interação
    if (mode === 'placeBase' && view.cursor) drawPlaceBase(ctx, cam, view, t);
    if (mode === 'target' && view.cursor) drawTarget(ctx, cam, G, view, t, ms);
    // setas para o que importa fora de vista
    const arrows = [];
    for (const m of ms) {
      const important = (m.kind === 'ufo' && !m.hidden && m.status === 'flying') || m.kind === 'site'
        || (view.selection && m.kind === view.selection.kind && m.id === view.selection.id)
        || (view.highlights || []).some((h) => h && h.kind === m.kind && h.id === m.id);
      if (!important) continue;
      const off = m.x < 0 || m.y < 0 || m.x > cam.w || m.y > cam.h;
      if (!m.front || off) arrows.push(m);
    }
    for (const m of arrows) edgeArrow(ctx, cam, m, colourOf(m), t);
  }
  function drawPlaceBase(ctx, cam, view, t) {
    const c = view.cursor;
    const ok = view.placeValid === undefined || view.placeValid === null ? OV.Data.world.isLand(c.lon, c.lat) : !!view.placeValid;
    const col = ok ? PAL.valid : PAL.invalid;
    const v = vec(c.lon, c.lat);
    const p = projV(cam, v[0], v[1], v[2]);
    if (!p.front) return;
    const sr = OV.Data.facilities && OV.Data.facilities.small_radar;
    const rho = (((sr && sr.radarRange) || 1695) / 60) * D2R;
    const xyz = capXYZ(v, rho);
    ctx.fillStyle = css(col, 0.07);
    ctx.fill(capFill(cam, v, rho, xyz), 'evenodd');
    const rp = new Path2D();
    strokeXYZ(rp, cam, xyz, true);
    ctx.strokeStyle = css(col, 0.7);
    ctx.lineWidth = 1.3;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -t / 120;
    ctx.stroke(rp);
    ctx.setLineDash([]);
    // fantasma da base + mira
    const s = markerScale(view), h = 6 * s;
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t / 200);
    ctx.fillStyle = css(ok ? PAL.base : PAL.invalid);
    ctx.fillRect(p.x - h, p.y - h, h * 2, h * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css(col);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(p.x - h, p.y - h, h * 2, h * 2);
    const g = 14 + Math.sin(t / 220) * 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, g, 0, TAU);
    ctx.moveTo(p.x - g - 6, p.y); ctx.lineTo(p.x - g + 4, p.y);
    ctx.moveTo(p.x + g - 4, p.y); ctx.lineTo(p.x + g + 6, p.y);
    ctx.moveTo(p.x, p.y - g - 6); ctx.lineTo(p.x, p.y - g + 4);
    ctx.moveTo(p.x, p.y + g - 4); ctx.lineTo(p.x, p.y + g + 6);
    ctx.stroke();
    if (!ok) {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(p.x - h * 0.7, p.y - h * 0.7); ctx.lineTo(p.x + h * 0.7, p.y + h * 0.7);
      ctx.moveTo(p.x + h * 0.7, p.y - h * 0.7); ctx.lineTo(p.x - h * 0.7, p.y + h * 0.7);
      ctx.stroke();
    }
  }
  function drawTarget(ctx, cam, G, view, t, ms) {
    let c = view.cursor;
    const snap = view.hover ? ms.find((m) => m.kind === view.hover.kind && m.id === view.hover.id) : null;
    if (snap) c = { lon: snap.lon, lat: snap.lat };
    const v = vec(c.lon, c.lat);
    const p = projV(cam, v[0], v[1], v[2]);
    const col = snap ? colourOf(snap) : PAL.craft;
    if (view.targetFrom) {
      const f = vec(view.targetFrom.lon, view.targetFrom.lat);
      const pth = new Path2D();
      strokeXYZ(pth, cam, gcXYZ(f, v, 1.5 * D2R), false);
      ctx.strokeStyle = 'rgba(0,6,14,0.55)';
      ctx.lineWidth = 3.4;
      ctx.stroke(pth);
      ctx.strokeStyle = css(col, 0.95);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([8, 5]);
      ctx.lineDashOffset = -t / 30;
      ctx.stroke(pth);
      ctx.setLineDash([]);
    }
    if (!p.front) return;
    const g = (snap ? snap.r + 10 : 11) + Math.sin(t / 180) * 1.5;
    ctx.strokeStyle = css(col);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + t / 900;
      ctx.moveTo(p.x + Math.cos(a) * g, p.y + Math.sin(a) * g);
      ctx.arc(p.x, p.y, g, a, a + 0.9);
    }
    ctx.stroke();
    if (!snap) {
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y);
      ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4);
      ctx.stroke();
    }
  }

  // ---- animação da câmara ----------------------------------------------------------------------------------------
  const animOf = (view) => (L.anims ? L.anims.get(view) : view.__globeAnim);
  function setAnim(view, a) {
    if (L.anims) {
      if (a) L.anims.set(view, a);
      else L.anims.delete(view);
    } else view.__globeAnim = a;
  }
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const timeOf = (view, t) => (Number.isFinite(t) ? t : Number.isFinite(view.time) ? view.time : now());

  function rotateBy(view, dx, dy) {
    const a = animOf(view);
    if (a && (a.rot || a.fling)) setAnim(view, a.zoom ? { zoom: a.zoom } : null);
    const R = radius(view);
    view.lon = wrap180((+view.lon || 0) - (dx / R) * R2D);
    view.lat = clamp((+view.lat || 0) + (dy / R) * R2D, -89, 89);
  }
  function zoomAt(view, zoom, px, py) {
    const z = clamp(zoom, 0, ZMAX);
    const anchor = Number.isFinite(px) && Number.isFinite(py) ? pick(view, px, py) : null;
    view.zoom = z;
    if (!anchor) return;
    for (let k = 0; k < 4; k++) {
      const q = pick(view, px, py);
      if (!q) break;
      view.lon = wrap180(view.lon + wrap180(anchor.lon - q.lon));
      view.lat = clamp(view.lat + (anchor.lat - q.lat), -89, 89);
    }
  }
  function rotateTo(view, lon, lat, ms, zoom) {
    const t0 = timeOf(view);
    const a = vec(+view.lon || 0, clamp(+view.lat || 0, -89, 89)), b = vec(lon, clamp(lat, -89, 89));
    const ang = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
    const dur = Number.isFinite(ms) ? Math.max(0, ms) : 450 + 450 * Math.min(1, ang / Math.PI);
    const z0 = +view.zoom || 0, z1 = Number.isFinite(zoom) ? clamp(zoom, 0, ZMAX) : z0;
    if (dur <= 0) {
      view.lon = wrap180(lon);
      view.lat = clamp(lat, -89, 89);
      view.zoom = z1;
      setAnim(view, null);
      return;
    }
    // viagens longas afastam um pouco a câmara a meio («voo»)
    const dip = Math.min(z0, z1) > 0.5 ? Math.min(1.3, (ang / (Math.PI / 2)) * 0.9) : 0;
    setAnim(view, { rot: { a, b, ang, t0, dur, z0, z1, dip, lon, lat } });
  }
  function zoomTo(view, zoom, ms, px, py) {
    const t0 = timeOf(view);
    const z1 = clamp(zoom, 0, ZMAX);
    const prev = animOf(view);
    const keep = prev && prev.rot ? { rot: prev.rot } : {};
    keep.zoom = { z0: +view.zoom || 0, z1, t0, dur: Number.isFinite(ms) ? Math.max(1, ms) : 280, px, py };
    setAnim(view, keep);
  }
  function fling(view, vx, vy) {
    if (!(Math.hypot(vx, vy) > 0.05)) return;
    const prev = animOf(view);
    setAnim(view, { fling: { vx, vy, t: timeOf(view) }, zoom: prev && prev.zoom });
  }
  const stop = (view) => setAnim(view, null);
  function update(view, nowMs) {
    const a = animOf(view);
    if (!a) return false;
    const tn = timeOf(view, nowMs);
    let active = false;
    if (a.rot) {
      const r = a.rot, f = clamp((tn - r.t0) / r.dur, 0, 1), e = easeIO(f);
      const w = r.ang;
      let v;
      if (w < 1e-9) v = r.b;
      else {
        const s = Math.sin(w), k1 = Math.sin((1 - e) * w) / s, k2 = Math.sin(e * w) / s;
        v = [r.a[0] * k1 + r.b[0] * k2, r.a[1] * k1 + r.b[1] * k2, r.a[2] * k1 + r.b[2] * k2];
      }
      const ll = OV.GMath ? OV.GMath.toLL(v) : { lon: Math.atan2(v[1], v[0]) * R2D, lat: Math.asin(clamp(v[2], -1, 1)) * R2D };
      view.lon = ll.lon;
      view.lat = clamp(ll.lat, -89, 89);
      if (!a.zoom) view.zoom = r.z0 + (r.z1 - r.z0) * e - r.dip * Math.sin(Math.PI * f);
      if (f >= 1) {
        view.lon = wrap180(r.lon);
        view.lat = clamp(r.lat, -89, 89);
        if (!a.zoom) view.zoom = r.z1;
        delete a.rot;
      } else active = true;
    }
    if (a.zoom) {
      const zz = a.zoom, f = clamp((tn - zz.t0) / zz.dur, 0, 1), e = 1 - Math.pow(1 - f, 3);
      zoomAt(view, zz.z0 + (zz.z1 - zz.z0) * e, zz.px, zz.py);
      if (f >= 1) delete a.zoom;
      else active = true;
    }
    if (a.fling) {
      const fl = a.fling, dt = Math.max(0, Math.min(64, tn - fl.t));
      fl.t = tn;
      const R = radius(view);
      view.lon = wrap180(view.lon - ((fl.vx * dt) / R) * R2D);
      view.lat = clamp(view.lat + ((fl.vy * dt) / R) * R2D, -89, 89);
      const k = Math.exp(-dt / 260);
      fl.vx *= k;
      fl.vy *= k;
      if (Math.hypot(fl.vx, fl.vy) < 0.01) delete a.fling;
      else active = true;
    }
    if (!active) setAnim(view, null);
    return active;
  }
  function busy(view) {
    const a = animOf(view);
    return !!(a && (a.rot || a.zoom || a.fling)) || !L.baseFine;
  }

  // ---- desenho -------------------------------------------------------------------------------------------------
  function sunVecAt(G, view) {
    const t = G ? G.t : Number.isFinite(view.t) ? view.t : 0;
    if (OV.Clock && OV.Clock.sunLon) {
      const lon = OV.Clock.sunLon(t), lat = OV.Clock.declination ? OV.Clock.declination(t) : 0;
      const ql = Math.round(lon * 10) / 10, qa = Math.round(lat * 10) / 10;
      return { v: vec(ql, qa), key: ql + ',' + qa };
    }
    const lon = Math.round((12 - ((t / 3600 + 12) % 24)) * 150) / 10;
    return { v: vec(lon, 0), key: String(lon) };
  }
  /* Em movimento (a câmara mudou há < 260 ms) a base e a luz desenham-se diretamente no ecrã, em resolução de
     amostragem grosseira, sem caches intermédias; parado, a base (fina) e a luz ficam em caches e cada fotograma é só
     uma cópia mais a camada dinâmica. */
  const SETTLE_MS = 260;
  function draw(ctx, G, view) {
    const t0 = now();
    update(view);
    const t = timeOf(view);
    const cam = camOf(view);
    geo();
    const keyCam = [cam.lon.toFixed(4), cam.lat.toFixed(4), cam.R.toFixed(2), cam.cx, cam.cy, cam.w, cam.h, cam.dpr,
      view.showGrid === false ? 0 : 1].join('|');
    const sun = sunVecAt(G, view);
    const keyLight = keyCam + '#' + sun.key;
    let didBase = false, didLight = false;
    const changed = keyCam !== L.camKey;
    const moving = changed && t - L.lastChange < SETTLE_MS;
    if (changed) {
      L.camKey = keyCam;
      L.lastChange = t;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (moving || (L.direct && t - L.lastChange < SETTLE_MS)) {
      renderBase(ctx, cam, keyCam, false, view);
      renderLight(ctx, cam, sun.v, null);
      L.direct = true;
      didBase = didLight = true;
    } else {
      L.direct = false;
      const W = Math.round(cam.w * cam.dpr), H = Math.round(cam.h * cam.dpr);
      if (L.baseKey !== keyCam) {
        L.base = sized(L.base, W, H);
        renderBase(L.base.getContext('2d'), cam, keyCam, true, view);
        L.baseKey = keyCam;
        L.lightKey = '';
        didBase = true;
      }
      if (L.lightKey !== keyLight) {
        L.stat = sized(L.stat, W, H);
        renderLight(L.stat.getContext('2d'), cam, sun.v, L.base);
        L.lightKey = keyLight;
        didLight = true;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(L.stat, 0, 0);
    }
    L.baseFine = !L.direct;
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    drawDynamic(ctx, cam, G, view, t, keyCam);
    ctx.restore();
    return { ms: now() - t0, base: didBase, light: didLight };
  }
  function prewarm() {
    geo();
    buildTextures();
  }
  function invalidate() {
    L.camKey = '';
    L.baseKey = '';
    L.lightKey = '';
    L.landPathKey = '';
    L.countryPaths = {};
    L.starKey = '';
  }

  OV.GlobeRender = {
    ZOOM_RADII: RADII.slice(), PAL,
    draw, pick, project, objectAt, objectsAt, countryAt, screenPos, radius, visible, radarCircles,
    rotateBy, zoomAt, rotateTo, zoomTo, fling, stop, update, busy, prewarm, invalidate,
  };
})(globalThis.OV || (globalThis.OV = {}));
