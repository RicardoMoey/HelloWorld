/* Sprites vetoriais procedimentais das partes de tile do Battlescape (DESIGN.md §16), sem imagens.
   Cada definição de OV.Data.tileDefs é desenhada pelo seu papel (art) e material (mat), com a cor da
   paleta do tileset, num referencial de voxels do tile (lx, ly 0..16, lz 0..24; 1 voxel = 2 px na
   horizontal, 2 px por voxel de altura) projetado em isométrico 2:1; luz de cima-esquerda como os
   sprites de unidades (faces +y claras, faces +x escuras, topo mais claro).
   OV.TileSprites.get(defId, variant, scale, state) → {c, w, h, ax, ay, e, scale, key}
     w/h/ax/ay em px CSS a zoom 1; (ax, ay) = canto superior do losango do tile; c tem w·scale × h·scale px;
     e = camada emissiva (luzes, ecrãs, núcleos) ou null — o renderizador repõe-na sobre a sombra noturna.
     variant: inteiro qualquer (reduzido ao número de variantes da arte); scale quantizada a 0.25;
     state: fotograma de animação 0..3 (fonte de energia, consolas, elevador, núcleo) ou orientação
     'x'|'y' da parede onde está a porta de OVNI (a linha do casco corre ao longo de x ou de y).
   blit(ctx, spr, x, y, zoom, dark, gray) desenha em px CSS; blitDev(...) em px do dispositivo (transformação
   identidade); silhouette(spr) / gray(spr) camadas para sombra noturna (rgb 5,10,30) e névoa dessaturada. */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css, shade = Col.shade, mix = Col.mix;
  const TAU = Math.PI * 2;
  const NIGHT = 0x050a1e;
  const GLASS = 0x9ec8d8;

  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('TileSprites: sem canvas disponível');
  };

  // caixas por parte em px CSS relativas ao canto superior do losango [x0, y0, x1, y1] (múltiplos de 4)
  const BOX = {
    floor: [-36, -4, 36, 36],
    west: [-36, -56, 24, 24],
    north: [-24, -56, 36, 24],
    object: [-36, -72, 36, 36],
  };
  // fotogramas por papel animado
  const ANIM = { powerSource: 4, navigation: 4, objective: 4, gravlift: 4, device: 4 };
  const FLOOR_VARIANTS = 4;

  // ---- aleatório determinístico (só cosmético) ------------------------------------------------------------
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };

  // ---- projeção e primitivas (referencial do tile: x → baixo-direita, y → baixo-esquerda, z ↑) ----------
  const PX = (x, y) => (x - y) * 2;
  const PY = (x, y, z) => x + y - z * 2;
  function poly(g, pts) {
    g.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const X = (p[0] - p[1]) * 2, Y = p[0] + p[1] - (p[2] || 0) * 2;
      if (k) g.lineTo(X, Y);
      else g.moveTo(X, Y);
    }
    g.closePath();
  }
  function fillPoly(g, pts, col, a) {
    poly(g, pts);
    g.fillStyle = css(col, a);
    g.fill();
  }
  function edgeStroke(g, col, a, w) {
    g.strokeStyle = css(shade(col, -0.62), a === undefined ? 0.5 : a);
    g.lineWidth = w || 0.6;
    g.stroke();
  }
  // faces com textura: o callback desenha em (s, t) da face, t para baixo a partir do topo
  function faceX(g, x, y0, y1, z0, z1, fn) {
    g.save();
    g.transform(-2, 1, 0, 2, (x - y0) * 2, x + y0 - 2 * z1);
    g.beginPath();
    g.rect(0, 0, y1 - y0, z1 - z0);
    g.clip();
    fn(y1 - y0, z1 - z0);
    g.restore();
  }
  function faceY(g, y, x0, x1, z0, z1, fn) {
    g.save();
    g.transform(2, 1, 0, 2, (x0 - y) * 2, x0 + y - 2 * z1);
    g.beginPath();
    g.rect(0, 0, x1 - x0, z1 - z0);
    g.clip();
    fn(x1 - x0, z1 - z0);
    g.restore();
  }
  function faceTop(g, z, x0, y0, x1, y1, fn) {
    g.save();
    g.transform(2, 1, -2, 1, (x0 - y0) * 2, x0 + y0 - 2 * z);
    g.beginPath();
    g.rect(0, 0, x1 - x0, y1 - y0);
    g.clip();
    fn(x1 - x0, y1 - y0);
    g.restore();
  }
  // face ao longo da aresta a→b (pegada), entre z0 e z1
  function faceEdge(g, a, b, z0, z1, fn) {
    const ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1;
    const ux = ex / len, uy = ey / len;
    g.save();
    g.transform((ux - uy) * 2, ux + uy, 0, 2, (a[0] - a[1]) * 2, a[0] + a[1] - 2 * z1);
    g.beginPath();
    g.rect(0, 0, len, z1 - z0);
    g.clip();
    fn(len, z1 - z0);
    g.restore();
  }
  // oclusão ambiente: escurece a base de uma face (em espaço de face)
  function aoFace(g, W, H, a) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,' + (a === undefined ? 0.22 : a) + ')');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }

  // caixa alinhada; o = {top, left (+y), right (+x), texX, texY, texTop, ao, edge}
  function box(g, x0, y0, z0, x1, y1, z1, col, o) {
    o = o || {};
    const cTop = o.top !== undefined ? o.top : shade(col, 0.16);
    const cL = o.left !== undefined ? o.left : shade(col, 0.03);
    const cR = o.right !== undefined ? o.right : shade(col, -0.3);
    const ea = o.edge === undefined ? 0.45 : o.edge;
    const fy = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    fillPoly(g, fy, cL);
    if (o.texY || o.ao !== false) faceY(g, y1, x0, x1, z0, z1, (W, H) => { if (o.texY) o.texY(W, H, cL); if (o.ao !== false && H > 3) aoFace(g, W, H, 0.16); });
    if (ea) { poly(g, fy); edgeStroke(g, cL, ea); }
    const fx = [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]];
    fillPoly(g, fx, cR);
    if (o.texX || o.ao !== false) faceX(g, x1, y0, y1, z0, z1, (W, H) => { if (o.texX) o.texX(W, H, cR); if (o.ao !== false && H > 3) aoFace(g, W, H, 0.16); });
    if (ea) { poly(g, fx); edgeStroke(g, cR, ea); }
    const ft = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    fillPoly(g, ft, cTop);
    if (o.texTop) faceTop(g, z1, x0, y0, x1, y1, (W, H) => o.texTop(W, H, cTop));
    if (ea) { poly(g, ft); edgeStroke(g, cTop, ea * 0.8); }
  }

  // prisma vertical de pegada convexa; faces visíveis (normal para +x+y) sombreadas pela luz
  function prism(g, pts, z0, z1, col, o) {
    o = o || {};
    const n = pts.length;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= n;
    cy /= n;
    const faces = [];
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]);
      const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      if (nx + ny > 0.02) faces.push({ a, b, nx, ny, d: (a[0] + b[0] + a[1] + b[1]) / 2 });
    }
    faces.sort((p, q) => p.d - q.d);
    const ea = o.edge === undefined ? 0.45 : o.edge;
    for (const f of faces) {
      const c = shade(col, -0.3 * f.nx + 0.04 * f.ny + (o.sideBias || 0));
      const q = [[f.a[0], f.a[1], z0], [f.b[0], f.b[1], z0], [f.b[0], f.b[1], z1], [f.a[0], f.a[1], z1]];
      fillPoly(g, q, c);
      if (o.tex || o.ao !== false) faceEdge(g, f.a, f.b, z0, z1, (W, H) => { if (o.tex) o.tex(W, H, c); if (o.ao !== false && H > 3) aoFace(g, W, H, 0.16); });
      if (ea) { poly(g, q); edgeStroke(g, c, ea); }
    }
    const top = pts.map((p) => [p[0], p[1], z1]);
    const ct = o.top !== undefined ? o.top : shade(col, 0.16);
    fillPoly(g, top, ct);
    if (o.texTop) {
      g.save();
      poly(g, top);
      g.clip();
      faceTop(g, z1, 0, 0, 16, 16, (W, H) => o.texTop(W, H, ct));
      g.restore();
    }
    if (ea) { poly(g, top); edgeStroke(g, ct, ea * 0.8); }
  }

  // cilindro vertical de raio r (voxels)
  function cyl(g, cx, cy, r, z0, z1, col, o) {
    o = o || {};
    const X = PX(cx, cy), Y0 = PY(cx, cy, z0), Y1 = PY(cx, cy, z1);
    const rx = r * 2.83, ry = r * 1.41;
    const gr = g.createLinearGradient(X - rx, 0, X + rx, 0);
    gr.addColorStop(0, css(shade(col, 0.05)));
    gr.addColorStop(0.32, css(shade(col, 0.2)));
    gr.addColorStop(0.7, css(shade(col, -0.18)));
    gr.addColorStop(1, css(shade(col, -0.42)));
    g.beginPath();
    g.moveTo(X - rx, Y1);
    g.lineTo(X - rx, Y0);
    g.ellipse(X, Y0, rx, ry, 0, Math.PI, 0, true);
    g.lineTo(X + rx, Y1);
    g.closePath();
    g.fillStyle = gr;
    g.fill();
    if (o.edge !== false) edgeStroke(g, col, 0.45);
    if (o.top !== false) {
      g.beginPath();
      g.ellipse(X, Y1, rx, ry, 0, 0, TAU);
      g.fillStyle = css(o.topCol !== undefined ? o.topCol : shade(col, 0.22));
      g.fill();
      if (o.edge !== false) edgeStroke(g, col, 0.35);
    }
  }
  // esfera/bolha com brilho à esquerda-cima
  function ball(g, cx, cy, cz, r, col, o) {
    o = o || {};
    const X = PX(cx, cy), Y = PY(cx, cy, cz);
    const rx = r * (o.sx || 2.5), ry = r * (o.sy || 2.3);
    const gr = g.createRadialGradient(X - rx * 0.35, Y - ry * 0.4, r * 0.3, X, Y, Math.max(rx, ry) * 1.05);
    gr.addColorStop(0, css(shade(col, o.hi === undefined ? 0.3 : o.hi)));
    gr.addColorStop(0.55, css(col));
    gr.addColorStop(1, css(shade(col, -0.42)));
    g.beginPath();
    g.ellipse(X, Y, rx, ry, 0, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    if (o.edge !== false) edgeStroke(g, col, o.edgeA === undefined ? 0.4 : o.edgeA, 0.5);
  }
  // sombra de contacto no chão (elipse) centrada em (cx, cy)
  function contact(g, cx, cy, r, a) {
    const X = PX(cx, cy), Y = PY(cx, cy, 0);
    g.save();
    g.translate(X, Y);
    g.scale(1, 0.5);
    const rr = r * 2.83;
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rr);
    gr.addColorStop(0, 'rgba(0,0,0,' + (a === undefined ? 0.32 : a) + ')');
    gr.addColorStop(0.7, 'rgba(0,0,0,' + (a === undefined ? 0.16 : a / 2) + ')');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rr, 0, TAU);
    g.fill();
    g.restore();
  }
  // brilho aditivo (radial) em px do sprite
  function glowAt(g, X, Y, r, col, a) {
    const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
    gr.addColorStop(0, css(col, a));
    gr.addColorStop(0.4, css(col, a * 0.45));
    gr.addColorStop(1, css(col, 0));
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr;
    g.beginPath();
    g.arc(X, Y, r, 0, TAU);
    g.fill();
    g.globalCompositeOperation = op;
  }
  function line(g, x0, y0, x1, y1, col, a, w) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.strokeStyle = css(col, a === undefined ? 1 : a);
    g.lineWidth = w || 0.3;
    g.stroke();
  }
  function dot(g, x, y, r, col, a) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fillStyle = css(col, a === undefined ? 1 : a);
    g.fill();
  }

  // ---- texturas de faces verticais (espaço da face: s ao longo, t para baixo) ----------------------------
  const TEX = {};
  TEX.brick = (g, W, H, col, R) => {
    const ch = 2, bl = 4;
    for (let t = 0, row = 0; t < H; t += ch, row++) {
      const off = row & 1 ? bl / 2 : 0;
      for (let s = -off; s < W; s += bl) {
        g.fillStyle = css(shade(col, (R() - 0.5) * 0.2));
        g.fillRect(s + 0.15, t + 0.15, bl - 0.3, ch - 0.3);
      }
    }
    g.fillStyle = css(shade(col, 0.32), 0.55);
    for (let t = 0; t < H; t += ch) g.fillRect(0, t, W, 0.18);
  };
  TEX.stone = (g, W, H, col, R) => {
    for (let t = 0; t < H;) {
      const ch = 2.6 + R() * 1.8;
      for (let s = -R() * 3; s < W;) {
        const bl = 3 + R() * 3.5;
        g.fillStyle = css(shade(col, (R() - 0.5) * 0.28));
        g.fillRect(s + 0.25, t + 0.25, bl - 0.5, ch - 0.5);
        g.fillStyle = css(shade(col, 0.25), 0.35);
        g.fillRect(s + 0.25, t + 0.25, bl - 0.5, 0.35);
        s += bl;
      }
      t += ch;
    }
  };
  TEX.timber = (g, W, H, col, R) => {
    const lh = 3;
    for (let t = 0; t < H; t += lh) {
      const c = shade(col, (R() - 0.5) * 0.14);
      const gr = g.createLinearGradient(0, t, 0, t + lh);
      gr.addColorStop(0, css(shade(c, 0.18)));
      gr.addColorStop(0.5, css(c));
      gr.addColorStop(1, css(shade(c, -0.35)));
      g.fillStyle = gr;
      g.fillRect(0, t, W, lh);
      for (let k = 0; k < 3; k++) line(g, R() * W, t + 0.8 + R() * 1.4, R() * W, t + 0.8 + R() * 1.4, shade(c, -0.3), 0.4, 0.15);
    }
  };
  TEX.planksV = (g, W, H, col, R) => {
    for (let s = 0; s < W; s += 2.5) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.16));
      g.fillRect(s, 0, 2.4, H);
      line(g, s, 0, s, H, shade(col, -0.45), 0.6, 0.2);
    }
  };
  TEX.bamboo = (g, W, H, col, R) => {
    for (let s = 0; s < W; s += 1.6) {
      const c = shade(col, (R() - 0.5) * 0.2);
      const gr = g.createLinearGradient(s, 0, s + 1.6, 0);
      gr.addColorStop(0, css(shade(c, 0.2)));
      gr.addColorStop(1, css(shade(c, -0.3)));
      g.fillStyle = gr;
      g.fillRect(s, 0, 1.5, H);
      for (let t = R() * 5; t < H; t += 5 + R() * 2) line(g, s, t, s + 1.5, t, shade(c, -0.45), 0.8, 0.25);
    }
  };
  TEX.adobe = (g, W, H, col, R) => {
    for (let k = 0; k < 5; k++) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.18), 0.6);
      g.beginPath();
      g.ellipse(R() * W, R() * H, 1.5 + R() * 3, 1 + R() * 2, 0, 0, TAU);
      g.fill();
    }
    for (let k = 0; k < 2; k++) {
      let s = R() * W, t = R() * H * 0.6;
      g.beginPath();
      g.moveTo(s, t);
      for (let j = 0; j < 4; j++) { s += (R() - 0.5) * 2; t += 1 + R() * 1.5; g.lineTo(s, t); }
      g.strokeStyle = css(shade(col, -0.45), 0.6);
      g.lineWidth = 0.18;
      g.stroke();
    }
  };
  TEX.concrete = (g, W, H, col, R) => {
    for (let k = 0; k < 40; k++) dot(g, R() * W, R() * H, 0.12 + R() * 0.12, shade(col, (R() - 0.5) * 0.5), 0.5);
    for (let k = 0; k < 3; k++) {
      const s = R() * W;
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, css(shade(col, -0.3), 0.25));
      gr.addColorStop(1, css(shade(col, -0.3), 0));
      g.fillStyle = gr;
      g.fillRect(s, 0, 0.6 + R(), H * (0.4 + R() * 0.5));
    }
    for (let s = 8; s < W; s += 8) line(g, s, 0, s, H, shade(col, -0.4), 0.7, 0.22);
    for (let t = 12; t < H; t += 12) line(g, 0, t, W, t, shade(col, -0.4), 0.7, 0.22);
  };
  TEX.panel = (g, W, H, col, R) => {
    for (let s = 0; s < W; s += 4) {
      line(g, s + 0.2, 0, s + 0.2, H, shade(col, 0.3), 0.6, 0.2);
      line(g, s + 3.8, 0, s + 3.8, H, shade(col, -0.4), 0.6, 0.2);
    }
    line(g, 0, H * 0.5, W, H * 0.5, shade(col, -0.35), 0.6, 0.3);
  };
  TEX.steel = (g, W, H, col, R) => {
    for (let s0 = 0; s0 < W; s0 += 5.33) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.08));
      g.fillRect(s0, 0, 5.33, H);
      line(g, s0 + 0.12, 0, s0 + 0.12, H, shade(col, 0.28), 0.6, 0.18);
      line(g, s0 + 5.2, 0, s0 + 5.2, H, shade(col, -0.45), 0.7, 0.2);
      for (let t = 1; t < H; t += 2.2) {
        dot(g, s0 + 0.8, t, 0.16, shade(col, 0.4), 0.8);
        dot(g, s0 + 4.5, t, 0.16, shade(col, 0.4), 0.8);
      }
    }
    g.fillStyle = css(0xd8a020, 0.85);
    g.fillRect(0, H * 0.62, W, 0.9);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, H * 0.62 + 0.9, W, 0.25);
  };
  TEX.alloy = (g, W, H, col, R, glow) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, css(shade(col, 0.16), 0.5));
    gr.addColorStop(0.5, css(col, 0));
    gr.addColorStop(1, css(shade(col, -0.2), 0.4));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let s = 0; s < W; s += 8) {
      line(g, s + 0.15, 0, s + 0.15, H, shade(col, 0.35), 0.5, 0.18);
      line(g, s + 7.85, 0, s + 7.85, H, shade(col, -0.45), 0.6, 0.18);
    }
    line(g, 0, H * 0.25, W, H * 0.25, shade(col, -0.4), 0.6, 0.2);
    line(g, 0, H * 0.25 + 0.25, W, H * 0.25 + 0.25, shade(col, 0.3), 0.5, 0.15);
    if (glow !== undefined && glow !== null) {
      g.fillStyle = css(glow, 0.85);
      g.fillRect(0, H * 0.25 + 0.6, W, 0.45);
    }
  };
  TEX.regolith = (g, W, H, col, R) => {
    for (let t = 0; t < H; t += 2 + R() * 2.5) {
      g.beginPath();
      g.moveTo(0, t);
      for (let s = 0; s <= W; s += 2) g.lineTo(s, t + (R() - 0.5) * 0.9);
      g.strokeStyle = css(shade(col, R() < 0.5 ? -0.35 : 0.2), 0.55);
      g.lineWidth = 0.25;
      g.stroke();
    }
    for (let k = 0; k < 24; k++) dot(g, R() * W, R() * H, 0.15 + R() * 0.2, shade(col, (R() - 0.5) * 0.6), 0.6);
  };
  TEX.ice = (g, W, H, col, R) => {
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(R() * W, 0);
      g.lineTo(R() * W, H * (0.4 + R() * 0.6));
      g.strokeStyle = css(0xffffff, 0.5);
      g.lineWidth = 0.25;
      g.stroke();
    }
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  TEX.leafy = (g, W, H, col, R) => {
    const n = Math.round(W * H * 0.55);
    for (let k = 0; k < n; k++) {
      const s = R() * W, t = R() * H;
      dot(g, s, t, 0.5 + R() * 0.7, shade(col, (R() - 0.55) * 0.5 - (t / H) * 0.15), 0.85);
    }
  };
  TEX.strata = (g, W, H, col, R) => {
    for (let t = 1; t < H; t += 1.5 + R() * 2) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.3), 0.6);
      g.fillRect(0, t, W, 0.6 + R() * 0.8);
    }
  };
  // material → textura de parede/bloco
  const MAT_TEX = {
    brick: TEX.brick, stone: TEX.stone, timber: TEX.timber, bamboo: TEX.bamboo, adobe: TEX.adobe, panel: TEX.panel,
    concrete: TEX.concrete, alloy: TEX.alloy, regolith: TEX.regolith, steel: TEX.steel, boulder: TEX.stone, granite: TEX.stone,
    sandstone: TEX.strata, temple: TEX.stone, pillar: TEX.concrete, ice: TEX.ice, mesa: TEX.strata, bulkhead: TEX.alloy,
    mossy: TEX.stone, wood: TEX.planksV, metal: TEX.panel,
  };
  const texFor = (mat) => MAT_TEX[mat] || TEX.concrete;
  const isAlloyMat = (mat) => mat === 'alloy' || mat === 'bulkhead' || mat === 'steel';

  // ---- chãos ----------------------------------------------------------------------------------------------
  const FLOOR_TEX = {};
  const speck = (g, R, n, col, amp, r0, r1, a) => {
    for (let k = 0; k < n; k++) dot(g, R() * 16, R() * 16, r0 + R() * (r1 - r0), shade(col, (R() - 0.5) * amp), a);
  };
  FLOOR_TEX.grass = (g, col, R, v, mat) => {
    for (let k = 0; k < 4; k++) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.22), 0.45);
      g.beginPath();
      g.ellipse(R() * 16, R() * 16, 2 + R() * 3, 1.5 + R() * 2.5, R() * 3, 0, TAU);
      g.fill();
    }
    speck(g, R, 70, col, 0.5, 0.15, 0.35, 0.8);
    if (mat === 'forest' || mat === 'jungle') speck(g, R, 18, mix(col, 0x6a4a2a, 0.5), 0.3, 0.2, 0.45, 0.7);
    if (mat === 'grass' && v === 3) for (let k = 0; k < 5; k++) dot(g, R() * 16, R() * 16, 0.35, [0xf0e070, 0xffffff, 0xd07ad0][k % 3], 0.9);
  };
  FLOOR_TEX.forest = FLOOR_TEX.grass;
  FLOOR_TEX.jungle = FLOOR_TEX.grass;
  FLOOR_TEX.rocky = (g, col, R) => {
    speck(g, R, 40, col, 0.4, 0.15, 0.3, 0.7);
    for (let k = 0; k < 7; k++) {
      const s = R() * 16, t = R() * 16, r = 0.6 + R();
      dot(g, s + 0.2, t + 0.2, r, shade(col, -0.45), 0.6);
      dot(g, s, t, r, shade(col, 0.12 + R() * 0.15), 1);
    }
  };
  FLOOR_TEX.sand = (g, col, R) => {
    for (let k = 0; k < 4; k++) {
      const t0 = R() * 16;
      g.beginPath();
      for (let s = -1; s <= 17; s += 1) {
        const t = t0 + Math.sin(s * 0.7 + k) * 0.8;
        if (s < 0) g.moveTo(s, t);
        else g.lineTo(s, t);
      }
      g.strokeStyle = css(shade(col, k & 1 ? 0.18 : -0.18), 0.6);
      g.lineWidth = 0.35;
      g.stroke();
    }
    speck(g, R, 40, col, 0.3, 0.1, 0.22, 0.7);
  };
  FLOOR_TEX.snow = (g, col, R) => {
    for (let k = 0; k < 4; k++) {
      g.fillStyle = css(0x9ab0c8, 0.16);
      g.beginPath();
      g.ellipse(R() * 16, R() * 16, 2 + R() * 3, 1 + R() * 2, R() * 3, 0, TAU);
      g.fill();
    }
    speck(g, R, 18, 0xb8c8d8, 0.2, 0.1, 0.2, 0.8);
    for (let k = 0; k < 6; k++) dot(g, R() * 16, R() * 16, 0.18, 0xffffff, 1);
  };
  FLOOR_TEX.pavement = (g, col, R) => {
    for (let a = 0; a < 16; a += 8) {
      for (let b = 0; b < 16; b += 8) {
        g.fillStyle = css(shade(col, (R() - 0.5) * 0.12));
        g.fillRect(a + 0.3, b + 0.3, 7.4, 7.4);
      }
    }
    g.strokeStyle = css(shade(col, -0.4), 0.8);
    g.lineWidth = 0.3;
    g.beginPath();
    for (let k = 0; k <= 16; k += 8) { g.moveTo(k, 0); g.lineTo(k, 16); g.moveTo(0, k); g.lineTo(16, k); }
    g.stroke();
    speck(g, R, 20, col, 0.3, 0.1, 0.2, 0.6);
  };
  FLOOR_TEX.alienfloor = (g, col, R, v) => {
    g.strokeStyle = css(shade(col, -0.35), 0.8);
    g.lineWidth = 0.3;
    g.beginPath();
    g.moveTo(0, 8); g.lineTo(16, 8); g.moveTo(8, 0); g.lineTo(8, 16);
    g.stroke();
    g.strokeStyle = css(shade(col, 0.25), 0.5);
    g.beginPath();
    g.arc(8, 8, 4.5, 0, TAU);
    g.stroke();
    if (v & 1) for (let k = 2; k < 16; k += 4) dot(g, k, 8, 0.3, 0x50e0c0, 0.9);
  };
  FLOOR_TEX.regolith = (g, col, R) => {
    speck(g, R, 50, col, 0.45, 0.12, 0.32, 0.7);
    for (let k = 0; k < 2; k++) {
      const s = 3 + R() * 10, t = 3 + R() * 10, r = 1 + R() * 1.6;
      g.beginPath();
      g.ellipse(s, t, r, r, 0, 0, TAU);
      g.fillStyle = css(shade(col, -0.22), 0.7);
      g.fill();
      g.strokeStyle = css(shade(col, 0.22), 0.7);
      g.lineWidth = 0.3;
      g.beginPath();
      g.arc(s, t, r, Math.PI * 0.1, Math.PI * 1.1);
      g.stroke();
    }
  };
  FLOOR_TEX.dust = FLOOR_TEX.regolith;
  FLOOR_TEX.burnt = (g, col, R, v) => {
    for (let k = 0; k < 5; k++) {
      g.fillStyle = css(R() < 0.5 ? 0x5a5650 : 0x141210, 0.45);
      g.beginPath();
      g.ellipse(R() * 16, R() * 16, 1.5 + R() * 3, 1 + R() * 2, R() * 3, 0, TAU);
      g.fill();
    }
    speck(g, R, 40, col, 0.6, 0.12, 0.3, 0.8);
    if (v & 1) for (let k = 0; k < 3; k++) dot(g, R() * 16, R() * 16, 0.25, 0xff7a2a, 0.75);
  };
  FLOOR_TEX.tarmac = (g, col, R) => {
    speck(g, R, 70, col, 0.35, 0.1, 0.22, 0.7);
    line(g, 0, 15.8, 16, 15.8, shade(col, -0.4), 0.4, 0.3);
  };
  FLOOR_TEX.asphalt = (g, col, R, v) => {
    speck(g, R, 90, col, 0.4, 0.08, 0.2, 0.75);
    if (v === 1) {
      g.strokeStyle = css(shade(col, -0.35), 0.6);
      g.lineWidth = 0.35;
      g.beginPath();
      let s = R() * 16, t = 0;
      g.moveTo(s, t);
      for (let k = 0; k < 6; k++) { s += (R() - 0.5) * 3; t += 2.7; g.lineTo(s, t); }
      g.stroke();
    }
  };
  FLOOR_TEX.dirt = (g, col, R) => {
    speck(g, R, 55, col, 0.45, 0.12, 0.3, 0.75);
    for (let k = 0; k < 4; k++) dot(g, R() * 16, R() * 16, 0.4 + R() * 0.4, shade(col, 0.2), 0.8);
  };
  FLOOR_TEX.mud = (g, col, R) => {
    for (let k = 0; k < 4; k++) {
      const s = R() * 16, t = R() * 16;
      g.fillStyle = css(shade(col, -0.3), 0.55);
      g.beginPath();
      g.ellipse(s, t, 1.5 + R() * 2, 1 + R() * 1.5, R() * 3, 0, TAU);
      g.fill();
      dot(g, s - 0.5, t - 0.4, 0.3, 0xffffff, 0.25);
    }
    speck(g, R, 30, col, 0.4, 0.12, 0.25, 0.7);
  };
  FLOOR_TEX.gravel = (g, col, R) => speck(g, R, 140, col, 0.6, 0.15, 0.32, 0.9);
  FLOOR_TEX.ice = (g, col, R) => {
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 0.25;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      let s = R() * 16, t = R() * 16;
      g.moveTo(s, t);
      for (let j = 0; j < 4; j++) { s += (R() - 0.5) * 6; t += (R() - 0.5) * 6; g.lineTo(s, t); }
      g.stroke();
    }
  };
  FLOOR_TEX.channel = (g, col, R, v) => {
    g.fillStyle = css(shade(col, -0.25));
    g.fillRect(6.5, 0, 3, 16);
    g.fillStyle = css(0x50e0c0, 0.55);
    g.fillRect(7.6, 0, 0.8, 16);
    speck(g, R, 20, col, 0.3, 0.1, 0.2, 0.6);
  };
  FLOOR_TEX.planks = (g, col, R) => {
    for (let t = 0; t < 16; t += 2.67) {
      const c = shade(col, (R() - 0.5) * 0.18);
      g.fillStyle = css(c);
      g.fillRect(0, t, 16, 2.67);
      for (let k = 0; k < 2; k++) line(g, R() * 16, t + 0.6 + R() * 1.4, R() * 16, t + 0.6 + R() * 1.4, shade(c, -0.25), 0.5, 0.12);
      line(g, 0, t, 16, t, shade(col, -0.5), 0.75, 0.22);
      const j = 3 + R() * 10;
      line(g, j, t, j, t + 2.67, shade(col, -0.5), 0.7, 0.2);
    }
  };
  FLOOR_TEX.bamboo = (g, col, R) => {
    for (let t = 0; t < 16; t += 1.6) {
      g.fillStyle = css(shade(col, (R() - 0.5) * 0.2));
      g.fillRect(0, t, 16, 1.5);
      line(g, 0, t, 16, t, shade(col, -0.45), 0.6, 0.18);
    }
  };
  FLOOR_TEX.tile = (g, col, R) => {
    for (let a = 0; a < 16; a += 4) {
      for (let b = 0; b < 16; b += 4) {
        g.fillStyle = css(shade(col, ((a + b) / 4) & 1 ? -0.08 : 0.06));
        g.fillRect(a, b, 4, 4);
      }
    }
    g.strokeStyle = css(shade(col, -0.45), 0.55);
    g.lineWidth = 0.18;
    g.beginPath();
    for (let k = 0; k <= 16; k += 4) { g.moveTo(k, 0); g.lineTo(k, 16); g.moveTo(0, k); g.lineTo(16, k); }
    g.stroke();
  };
  FLOOR_TEX.metal = (g, col, R) => {
    for (let a = 1; a < 16; a += 2.5) {
      for (let b = 1; b < 16; b += 2.5) {
        const o = ((a + b) / 2.5) & 1;
        line(g, a + (o ? 0 : 0.6), b, a + (o ? 0.8 : -0.2), b + 0.8, shade(col, 0.3), 0.7, 0.3);
      }
    }
    line(g, 0, 8, 16, 8, shade(col, -0.45), 0.6, 0.25);
  };
  FLOOR_TEX.deck = FLOOR_TEX.metal;
  FLOOR_TEX.alloy = (g, col, R, v) => {
    const gr = g.createRadialGradient(5, 5, 0, 8, 8, 12);
    gr.addColorStop(0, css(shade(col, 0.16), 0.6));
    gr.addColorStop(1, css(shade(col, -0.12), 0.3));
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 16);
    g.strokeStyle = css(shade(col, -0.45), 0.75);
    g.lineWidth = 0.25;
    g.beginPath();
    g.moveTo(8, 0); g.lineTo(8, 16); g.moveTo(0, 8); g.lineTo(16, 8);
    g.stroke();
    g.strokeStyle = css(shade(col, 0.32), 0.45);
    g.beginPath();
    g.moveTo(8.3, 0); g.lineTo(8.3, 16); g.moveTo(0, 8.3); g.lineTo(16, 8.3);
    g.stroke();
    for (const [a, b] of [[1, 1], [15, 1], [1, 15], [15, 15], [7, 7], [9, 9]]) dot(g, a, b, 0.25, shade(col, 0.35), 0.8);
    if (v === 2) { g.fillStyle = css(shade(col, -0.2), 0.5); g.fillRect(2, 2, 4, 4); }
  };
  FLOOR_TEX.ramp = (g, col, R) => {
    FLOOR_TEX.metal(g, col, R);
    g.save();
    g.beginPath();
    g.rect(0, 12.5, 16, 3.5);
    g.clip();
    g.fillStyle = css(0x1a1a1a);
    g.fillRect(0, 12.5, 16, 3.5);
    g.fillStyle = css(0xe0b020);
    for (let s = -4; s < 18; s += 3) {
      g.beginPath();
      g.moveTo(s, 16); g.lineTo(s + 1.5, 16); g.lineTo(s + 3, 12.5); g.lineTo(s + 1.5, 12.5);
      g.closePath();
      g.fill();
    }
    g.restore();
  };
  FLOOR_TEX.pad = (g, col, R) => {
    g.strokeStyle = css(0x50e0c0, 0.6);
    g.lineWidth = 0.35;
    g.beginPath();
    g.arc(8, 8, 6, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(8, 8, 3, 0, TAU);
    g.stroke();
  };
  FLOOR_TEX.tiles = (g, col, R) => {
    for (let t = 0; t < 16; t += 2.4) {
      const c = shade(col, (R() - 0.5) * 0.1);
      for (let s = (t / 2.4) & 1 ? -1 : 0; s < 16; s += 2) {
        g.fillStyle = css(shade(c, (R() - 0.5) * 0.12));
        g.beginPath();
        g.moveTo(s, t);
        g.lineTo(s + 2, t);
        g.lineTo(s + 2, t + 1.8);
        g.quadraticCurveTo(s + 1, t + 2.6, s, t + 1.8);
        g.closePath();
        g.fill();
      }
      line(g, 0, t + 2.2, 16, t + 2.2, shade(col, -0.5), 0.7, 0.25);
    }
  };
  FLOOR_TEX.shingle = (g, col, R) => {
    for (let t = 0; t < 16; t += 2) {
      for (let s = (t / 2) & 1 ? -1.5 : 0; s < 16; s += 3) {
        g.fillStyle = css(shade(col, (R() - 0.5) * 0.25));
        g.fillRect(s + 0.1, t + 0.1, 2.8, 1.8);
      }
      line(g, 0, t + 1.95, 16, t + 1.95, shade(col, -0.5), 0.7, 0.2);
    }
  };
  FLOOR_TEX.slate = FLOOR_TEX.shingle;
  FLOOR_TEX.thatch = (g, col, R) => {
    for (let k = 0; k < 120; k++) {
      const s = R() * 16, t = R() * 16;
      line(g, s, t, s + 0.4, t + 1.6, shade(col, (R() - 0.5) * 0.5), 0.8, 0.18);
    }
  };
  FLOOR_TEX.adobe = (g, col, R) => {
    speck(g, R, 30, col, 0.25, 0.2, 0.5, 0.5);
    line(g, 0, 15.6, 16, 15.6, shade(col, -0.35), 0.5, 0.4);
  };
  FLOOR_TEX.hull = (g, col, R) => {
    FLOOR_TEX.alloy(g, col, R, 0);
    for (let k = 1; k < 16; k += 2) dot(g, k, 4, 0.2, shade(col, 0.4), 0.8);
  };

  // ---- pintores por papel ----------------------------------------------------------------------------------
  // ctx de pintura: {def, v, st, R, pal, glow(fn)} — glow desenha na camada base e na emissiva
  const PAINT = {};

  function paintFloor(g, P) {
    const d = P.def;
    const col = shade(d.colour, (P.R() - 0.5) * 0.06 + (P.v - 1.5) * 0.012);
    const e = 0.6; // losango ligeiramente expandido (sem frestas)
    g.beginPath();
    g.moveTo(0, -e);
    g.lineTo(32 + e * 2, 16);
    g.lineTo(0, 32 + e);
    g.lineTo(-32 - e * 2, 16);
    g.closePath();
    g.fillStyle = css(col);
    g.fill();
    g.save();
    g.clip();
    let mat = d.mat;
    if (d.role === 'craftRamp' && mat !== 'pad') mat = 'ramp';
    if (d.role === 'scorched') mat = mat === 'alloy' ? 'alloyBurnt' : 'burnt';
    const fn = mat === 'alloyBurnt' ? (gg, c, R, v) => { FLOOR_TEX.alloy(gg, c, R, v); FLOOR_TEX.burnt(gg, shade(c, -0.3), R, v); }
      : FLOOR_TEX[mat] || FLOOR_TEX.dirt;
    faceTop(g, 0, 0, 0, 16, 16, () => fn(g, col, P.R, P.v, mat));
    // luz de cima-esquerda: aresta superior-esquerda clara, inferior-direita escura
    g.restore();
    line(g, -32, 16, 0, 0, shade(col, 0.22), 0.25, 0.6);
    line(g, 0, 32, 32, 16, shade(col, -0.5), 0.22, 0.6);
    if (d.role === 'craftFloor' || d.role === 'craftRamp') {
      line(g, 0, 0, 32, 16, shade(col, 0.3), 0.35, 0.5);
    }
  }
  for (const r of ['ground', 'road', 'inner', 'roof', 'craftFloor', 'craftRamp', 'scorched']) PAINT[r] = paintFloor;

  // ---- paredes (arestas oeste/norte) ------------------------------------------------------------------------
  const T = 1.6; // espessura
  // caixa de aresta: west → lx 0..T, ly a..b; north → ly 0..T, lx a..b
  function edgeBox(g, side, a, b, z0, z1, col, o) {
    if (side === 'west') box(g, 0, a, z0, T, b, z1, col, o && { top: o.top, texX: o.tex, ao: o.ao, edge: o.edge, left: o.cap, right: o.face });
    else box(g, a, 0, z0, b, T, z1, col, o && { top: o.top, texY: o.tex, ao: o.ao, edge: o.edge, right: o.cap, left: o.face });
  }
  // textura na face principal (visível) da aresta
  function edgeFace(g, side, a, b, z0, z1, fn) {
    if (side === 'west') faceX(g, T, a, b, z0, z1, fn);
    else faceY(g, T, a, b, z0, z1, fn);
  }
  const mainShade = (side, col) => (side === 'west' ? shade(col, -0.22) : shade(col, 0.04));
  function wallSolid(g, P, side, z0, z1, col, a, b) {
    const mat = P.def.art === 'wall' ? P.def.mat : P.wallMat;
    const tex = texFor(mat);
    const alien = P.def.set === 'UFO' || P.def.set === 'ALIENBASE';
    const glow = alien && isAlloyMat(mat) ? P.pal.accent : null;
    const face = mainShade(side, col);
    edgeBox(g, side, a === undefined ? 0 : a, b === undefined ? 16 : b, z0, z1, col, {
      face, cap: side === 'west' ? shade(col, 0.06) : shade(col, -0.32), top: shade(col, 0.28),
      tex: (W, H, c) => tex(g, W, H, c, P.R, glow),
    });
  }

  PAINT.wall = (g, P, side) => {
    wallSolid(g, P, side, 0, 24, P.def.colour);
    // base e topo marcados
    edgeFace(g, side, 0, 16, 0, 24, (W, H) => {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, H - 1.2, W, 1.2);
    });
  };

  function doorLeafColour(P) {
    return P.def.mat === 'alloy' ? shade(P.pal.wall, 0.12) : P.def.set === 'URBAN' ? 0x6a4a32 : 0x7a5434;
  }
  PAINT.door = (g, P, side) => {
    const wallCol = P.wallCol;
    wallSolid(g, P, side, 0, 24, wallCol);
    const leaf = doorLeafColour(P);
    const alloy = P.def.mat === 'alloy';
    edgeFace(g, side, 0, 16, 0, 24, (W, H) => {
      g.fillStyle = css(shade(leaf, -0.55));
      g.fillRect(3.2, 4.2, 9.6, H - 4.2);
      g.fillStyle = css(mainShade(side, leaf));
      g.fillRect(3.8, 4.8, 8.4, H - 4.8);
      if (alloy) {
        line(g, 8, 4.8, 8, H, shade(leaf, -0.5), 0.9, 0.3);
        g.fillStyle = css(P.pal.accent, 0.9);
        g.fillRect(3.8, 4.8, 8.4, 0.5);
      } else {
        g.strokeStyle = css(shade(leaf, -0.45), 0.8);
        g.lineWidth = 0.25;
        g.strokeRect(5, 6.5, 6, 5.5);
        g.strokeRect(5, 14, 6, 7.5);
        dot(g, 10.8, 14.5, 0.45, 0xd8c070, 1);
      }
    });
  };
  PAINT.doorOpen = (g, P, side) => {
    const wallCol = P.wallCol;
    const leaf = doorLeafColour(P);
    // ombreiras e verga
    wallSolid(g, P, side, 0, 24, wallCol, 0, 3.2);
    wallSolid(g, P, side, 0, 24, wallCol, 12.8, 16);
    wallSolid(g, P, side, 19.5, 24, wallCol, 3.2, 12.8);
    if (P.def.mat !== 'alloy') {
      // folha aberta perpendicular à aresta, dobradiça do lado da frente
      if (side === 'west') box(g, 0.2, 11.6, 0, 9, 12.8, 19.4, leaf, { top: shade(leaf, 0.2) });
      else box(g, 11.6, 0.2, 0, 12.8, 9, 19.4, leaf, { top: shade(leaf, 0.2) });
    }
  };
  PAINT.window = (g, P, side) => {
    const wallCol = P.wallCol;
    const viewport = P.def.mat === 'viewport';
    wallSolid(g, P, side, 0, 8, wallCol);
    wallSolid(g, P, side, 19, 24, wallCol);
    // vidro (translúcido) com caixilho
    const glass = viewport ? 0x5ad8e0 : GLASS;
    const pts = side === 'west' ? [[T * 0.5, 0, 8], [T * 0.5, 16, 8], [T * 0.5, 16, 19], [T * 0.5, 0, 19]]
      : [[0, T * 0.5, 8], [16, T * 0.5, 8], [16, T * 0.5, 19], [0, T * 0.5, 19]];
    fillPoly(g, pts, glass, viewport ? 0.45 : 0.38);
    edgeFace(g, side, 0, 16, 8, 19, (W, H) => {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, 'rgba(255,255,255,0.45)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.05)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.3)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      const fr = viewport ? shade(wallCol, -0.2) : 0xe8e4dc;
      g.strokeStyle = css(fr);
      g.lineWidth = 0.6;
      g.strokeRect(0.3, 0.3, W - 0.6, H - 0.6);
      if (!viewport) {
        line(g, W / 2, 0, W / 2, H, fr, 1, 0.5);
        line(g, 0, H / 2, W, H / 2, fr, 1, 0.4);
      }
    });
    if (viewport) P.glow((e) => { poly(e, pts); e.fillStyle = css(glass, 0.18); e.fill(); });
  };
  PAINT.windowBroken = (g, P, side) => {
    const wallCol = P.wallCol;
    wallSolid(g, P, side, 0, 8, wallCol);
    // cacos de vidro sobre o parapeito
    for (let k = 0; k < 6; k++) {
      const s = 1 + P.R() * 14, h = 1 + P.R() * 3;
      const pts = side === 'west' ? [[T * 0.5, s - 0.8, 8], [T * 0.5, s + 0.8, 8], [T * 0.5, s + (P.R() - 0.5), 8 + h]]
        : [[s - 0.8, T * 0.5, 8], [s + 0.8, T * 0.5, 8], [s + (P.R() - 0.5), T * 0.5, 8 + h]];
      fillPoly(g, pts, GLASS, 0.75);
    }
  };
  PAINT.fence = (g, P, side) => {
    const col = P.def.colour, mat = P.def.mat;
    if (mat === 'railing' || mat === 'rail') {
      for (let s = 0.5; s < 16; s += 2.5) edgeBox(g, side, s, s + 0.5, 0, 11, col, { edge: 0.3, ao: false });
      edgeBox(g, side, 0, 16, 10.5, 12, col, { ao: false });
      edgeBox(g, side, 0, 16, 4, 4.8, col, { ao: false, edge: 0.3 });
      if (mat === 'rail') P.glow((e) => { glowAt(e, side === 'west' ? -16 : 16, 8 - 22, 10, P.pal.accent, 0.35); });
      return;
    }
    for (const s of [0.4, 7.6, 14.8]) edgeBox(g, side, s, s + 1, 0, 12.5, shade(col, -0.1), { ao: false });
    edgeBox(g, side, 0, 16, 8.5, 10, col, { ao: false, tex: (W, H, c) => TEX.planksV(g, W, H, c, P.R) });
    edgeBox(g, side, 0, 16, 3.5, 5, col, { ao: false });
  };
  function rubblePile(g, P, pts, col, hmax) {
    const alloy = P.def.mat === 'alloy';
    for (const p of pts) {
      const c = shade(col, (P.R() - 0.5) * 0.3 + (alloy ? 0.1 : 0));
      const s = 0.8 + P.R() * 1.6, h = 1 + P.R() * hmax;
      if (alloy) prism(g, [[p[0] - s, p[1]], [p[0] + s, p[1] - s * 0.5], [p[0] + s * 0.6, p[1] + s]], 0, h, c, { ao: false });
      else box(g, p[0] - s, p[1] - s, 0, p[0] + s, p[1] + s, h, c, { ao: false });
    }
  }
  const rubbleCol = (P) => mix(P.def.colour, P.def.mat === 'alloy' ? shade(P.wallCol, -0.1) : shade(P.wallCol, -0.25), 0.6);
  PAINT.rubbleWall = (g, P, side) => {
    const pts = [];
    for (let k = 0; k < 7; k++) {
      const s = 1 + P.R() * 14, o = P.R() * 3;
      pts.push(side === 'west' ? [o + 1, s] : [s, o + 1]);
    }
    pts.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    rubblePile(g, P, pts, rubbleCol(P), 4);
  };

  // ---- objetos ------------------------------------------------------------------------------------------------
  const scatter = (R, n, m) => {
    const pts = [];
    for (let k = 0; k < n; k++) pts.push([m + R() * (16 - 2 * m), m + R() * (16 - 2 * m)]);
    return pts.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  };

  // vegetação alienígena (OVNI) puxa para violeta
  const vegCol = (d) => (d.set === 'UFO' && (d.mat === 'growth' || d.mat === 'organic') ? mix(d.colour, 0x7a4a8a, 0.75) : d.colour);
  PAINT.crop = (g, P) => {
    const d = P.def, col = vegCol(d), R = P.R, mat = d.mat;
    if (mat === 'flowerbed') {
      box(g, 1, 1, 0, 15, 15, 2, 0x8a8478, { ao: false, top: 0x4a3a28 });
      for (const [x, y] of scatter(R, 26, 2)) ball(g, x, y, 3 + R(), 0.9, R() < 0.5 ? 0x4f7a34 : 0x5f8a3a, { edge: false });
      for (const [x, y] of scatter(R, 14, 2.5)) dot(g, PX(x, y), PY(x, y, 4.5), 0.9, [0xe04050, 0xf0d040, 0xf0f0f0, 0xd070e0][(R() * 4) | 0]);
      return;
    }
    if (mat === 'dust') {
      for (const [x, y] of scatter(R, 5, 3)) ball(g, x, y, 0.5, 2 + R(), col, { sy: 1.0, edge: false });
      return;
    }
    if (mat === 'growth') {
      for (const [x, y] of scatter(R, 9, 2)) {
        const h = 3 + R() * 4;
        line(g, PX(x, y), PY(x, y, 0), PX(x, y) + (R() - 0.5) * 2, PY(x, y, h), shade(col, -0.2), 1, 1.2);
        ball(g, x, y, h, 0.9, shade(col, 0.2), { edge: false });
        P.glow((e) => dot(e, PX(x, y), PY(x, y, h) - 0.5, 0.7, 0x9af0ff, 0.9));
      }
      return;
    }
    const n = mat === 'wheat' ? 70 : mat === 'grass' || mat === 'tussock' ? 50 : 26;
    const h0 = mat === 'wheat' ? 6.5 : mat === 'fern' ? 4.5 : 5;
    contact(g, 8, 8, 7, 0.18);
    for (const [x, y] of scatter(R, n, 0.8)) {
      const X = PX(x, y), Y = PY(x, y, 0), h = h0 * (0.75 + R() * 0.4);
      const c = shade(col, (R() - 0.5) * 0.3);
      if (mat === 'fern') {
        for (let k = -1; k <= 1; k += 2) {
          g.beginPath();
          g.moveTo(X, Y);
          g.quadraticCurveTo(X + k * 2, Y - h * 2, X + k * (3 + R() * 2), Y - h * 1.2);
          g.strokeStyle = css(c);
          g.lineWidth = 0.8;
          g.stroke();
        }
      } else if (mat === 'scrub') {
        ball(g, x, y, 1.5, 1.1, c, { edge: false, sy: 1.6 });
      } else {
        const lean = (R() - 0.5) * 2;
        line(g, X, Y, X + lean, Y - h * 2, shade(c, -0.15), 1, 0.6);
        if (mat === 'wheat') {
          g.beginPath();
          g.ellipse(X + lean, Y - h * 2, 0.7, 1.6, lean * 0.2, 0, TAU);
          g.fillStyle = css(shade(c, 0.15));
          g.fill();
        } else if (mat === 'tussock') {
          dot(g, X + lean, Y - h * 2, 0.5, 0xf0f4f8, 0.9);
        }
      }
    }
  };

  PAINT.bush = (g, P) => {
    const d = P.def, col = vegCol(d), R = P.R, mat = d.mat;
    contact(g, 8, 8, 7, 0.28);
    if (mat === 'pebbles') {
      for (const [x, y] of scatter(R, 9, 2.5)) ball(g, x, y, 0.6, 0.8 + R() * 0.8, shade(col, (R() - 0.5) * 0.3), { sy: 1.4 });
      return;
    }
    const n = 4 + ((R() * 3) | 0);
    const blobs = [];
    for (let k = 0; k < n; k++) blobs.push([4 + R() * 8, 4 + R() * 8, 2.5 + R() * 3, 2.2 + R() * 1.6]);
    blobs.sort((a, b) => a[0] + a[1] - a[2] * 0.3 - (b[0] + b[1] - b[2] * 0.3));
    for (const [x, y, z, r] of blobs) {
      ball(g, x, y, z, r, shade(col, (R() - 0.5) * 0.18));
      const X = PX(x, y), Y = PY(x, y, z);
      for (let k = 0; k < 8; k++) dot(g, X + (R() - 0.5) * r * 3.5, Y + (R() - 0.6) * r * 3, 0.5, shade(col, R() < 0.5 ? 0.3 : -0.3), 0.7);
      if (mat === 'snowbush') {
        g.beginPath();
        g.ellipse(X - r * 0.4, Y - r * 1.5, r * 1.7, r * 0.8, 0, 0, TAU);
        g.fillStyle = css(0xf0f4f8, 0.92);
        g.fill();
      }
      if (mat === 'growth') P.glow((e) => dot(e, X, Y - r, 0.8, 0xc890ff, 0.8));
    }
  };

  PAINT.hedge = (g, P) => {
    const d = P.def, col = vegCol(d), R = P.R, mat = d.mat;
    if (mat === 'drift') {
      contact(g, 8, 8, 8, 0.2);
      ball(g, 8, 8, 3, 6.5, col, { sx: 2.7, sy: 1.5, hi: 0.15, edgeA: 0.25 });
      return;
    }
    if (mat === 'ridge') {
      const pts = [[1, 3], [6, 0.5], [14, 1.5], [15.5, 9], [12, 15], [3, 14]];
      prism(g, pts, 0, 10 + R() * 2, col, { tex: (W, H, c) => TEX.strata(g, W, H, c, R) });
      return;
    }
    const top = 12;
    box(g, 0.6, 0.6, 0, 15.4, 15.4, top - 1, col, {
      texX: (W, H, c) => TEX.leafy(g, W, H, c, R), texY: (W, H, c) => TEX.leafy(g, W, H, c, R),
      texTop: (W, H, c) => TEX.leafy(g, W, H, c, R), edge: 0.25,
    });
    // topo irregular
    for (const [x, y] of scatter(R, 9, 2)) ball(g, x, y, top - 0.6, 1.6 + R(), shade(col, 0.05 + (R() - 0.5) * 0.2), { edge: false });
    if (mat === 'vines') {
      for (let k = 0; k < 6; k++) {
        const x = 15.4, y = 1 + R() * 14;
        line(g, PX(x, y), PY(x, y, 11), PX(x, y), PY(x, y, 3 + R() * 5), shade(col, -0.35), 0.9, 0.6);
      }
    }
    if (mat === 'thorn') for (let k = 0; k < 12; k++) dot(g, -24 + R() * 48, -4 + R() * 24, 0.35, 0xd8c8a0, 0.8);
    if (mat === 'growth') P.glow((e) => { for (let k = 0; k < 4; k++) dot(e, -16 + R() * 32, -8 + R() * 16, 0.8, 0xc890ff, 0.7); });
  };

  function boulder(g, P, col, h, mat) {
    const R = P.R;
    const pts = [];
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + R() * 0.4;
      const r = 6.4 + R() * 1.5;
      pts.push([8 + Math.cos(a) * r, 8 + Math.sin(a) * r]);
    }
    contact(g, 8, 8, 8.5, 0.3);
    const tex = mat === 'sandstone' || mat === 'mesa' ? TEX.strata : mat === 'ice' ? TEX.ice : TEX.stone;
    prism(g, pts, 0, h * 0.82, col, { tex: (W, H, c) => tex(g, W, H, c, R), edge: 0.5 });
    // cimo arredondado
    const top = pts.map((p) => [8 + (p[0] - 8) * 0.72, 8 + (p[1] - 8) * 0.72]);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n], c = top[(k + 1) % n], dd = top[k];
      const q = [[a[0], a[1], h * 0.82], [b[0], b[1], h * 0.82], [c[0], c[1], h], [dd[0], dd[1], h]];
      const m = mid(a, b);
      const nx = m[0] - 8, ny = m[1] - 8, l = Math.hypot(nx, ny) || 1;
      if (nx / l + ny / l < -0.6) continue;
      fillPoly(g, q, shade(col, 0.08 - 0.25 * (nx / l) + 0.05 * (ny / l)));
      poly(g, q);
      edgeStroke(g, col, 0.3, 0.4);
    }
    fillPoly(g, top.map((p) => [p[0], p[1], h]), shade(col, 0.2));
    if (mat === 'mossy') for (let k = 0; k < 10; k++) dot(g, PX(4 + R() * 8, 4 + R() * 8), PY(8, 8, h) + (R() - 0.5) * 6, 1 + R(), 0x4a7a3a, 0.8);
    if (mat === 'ice') {
      P.glow((e) => {
        poly(e, top.map((p) => [p[0], p[1], h]));
        e.fillStyle = 'rgba(200,240,255,0.18)';
        e.fill();
      });
    }
  }
  function block(g, P, col, mat, x0, y0, x1, y1, h, glow) {
    const tex = texFor(mat);
    box(g, x0, y0, 0, x1, y1, h, col, {
      texX: (W, H, c) => tex(g, W, H, c, P.R, glow), texY: (W, H, c) => tex(g, W, H, c, P.R, glow),
      texTop: (W, H, c) => {
        if (isAlloyMat(mat)) FLOOR_TEX.alloy(g, c, P.R, 0);
        else TEX.concrete(g, W, H, c, P.R);
      },
    });
  }
  PAINT.rock = (g, P) => {
    const d = P.def, mat = d.mat;
    if (mat === 'concrete' || mat === 'bulkhead' || isAlloyMat(mat)) {
      const glow = (d.set === 'UFO' || d.set === 'ALIENBASE') ? P.pal.accent : null;
      block(g, P, shade(P.wallCol, mat === 'concrete' ? -0.05 : -0.12), mat, 0, 0, 16, 16, 24, glow);
      return;
    }
    boulder(g, P, d.colour, mat === 'mesa' ? 24 : 18 + P.R() * 5, mat);
  };

  function canopy(g, P, col, cz, rad, n) {
    const R = P.R;
    const blobs = [];
    for (let k = 0; k < n; k++) {
      const a = R() * TAU, r = R() * rad * 0.55;
      blobs.push([8 + Math.cos(a) * r, 8 + Math.sin(a) * r, cz + (R() - 0.4) * rad * 0.7, rad * (0.5 + R() * 0.25)]);
    }
    blobs.sort((a, b) => a[0] + a[1] + a[2] * 0.6 - (b[0] + b[1] + b[2] * 0.6));
    for (const [x, y, z, r] of blobs) {
      ball(g, x, y, z, r, shade(col, (R() - 0.5) * 0.16), { edgeA: 0.35 });
      const X = PX(x, y), Y = PY(x, y, z);
      for (let k = 0; k < 14; k++) {
        const a = R() * TAU, rr = R() * r * 2.2;
        dot(g, X + Math.cos(a) * rr, Y + Math.sin(a) * rr * 0.9, 0.6 + R() * 0.5, shade(col, (Math.sin(a) < 0 && Math.cos(a) < 0.3) ? 0.28 : -0.3), 0.75);
      }
    }
  }
  PAINT.tree = (g, P) => {
    const d = P.def, col = vegCol(d), R = P.R, mat = d.mat;
    contact(g, 8, 8, 9, 0.34);
    const trunk = mat === 'organic' ? shade(col, -0.2) : 0x5a3e28;
    if (mat === 'pine' || mat === 'snowpine') {
      cyl(g, 8, 8, 0.9, 0, 6, trunk, { top: false });
      const layers = [[4, 7.5, 9], [9, 6, 8], [14, 4.4, 7], [18.5, 2.8, 6]];
      for (const [z, r, h] of layers) {
        const X = PX(8, 8), Yb = PY(8, 8, z), Yt = PY(8, 8, z + h);
        const rx = r * 2.83, ry = r * 1.41;
        const gr = g.createLinearGradient(X - rx, 0, X + rx, 0);
        gr.addColorStop(0, css(shade(col, 0.15)));
        gr.addColorStop(0.45, css(col));
        gr.addColorStop(1, css(shade(col, -0.45)));
        g.beginPath();
        g.moveTo(X, Yt);
        g.lineTo(X - rx, Yb);
        g.ellipse(X, Yb, rx, ry, 0, Math.PI, 0, true);
        g.closePath();
        g.fillStyle = gr;
        g.fill();
        edgeStroke(g, col, 0.4, 0.5);
        for (let k = 0; k < 10; k++) dot(g, X + (R() - 0.5) * rx * 1.4, Yb - R() * (Yb - Yt) * 0.7, 0.5, shade(col, -0.35), 0.6);
        if (mat === 'snowpine') {
          g.beginPath();
          g.moveTo(X, Yt);
          g.lineTo(X - rx * 0.55, Yt + (Yb - Yt) * 0.55);
          g.quadraticCurveTo(X, Yt + (Yb - Yt) * 0.4, X + rx * 0.45, Yt + (Yb - Yt) * 0.5);
          g.closePath();
          g.fillStyle = css(0xf2f6fa, 0.95);
          g.fill();
        }
      }
      return;
    }
    if (mat === 'palm') {
      const top = [9.5, 6.5, 21];
      g.beginPath();
      g.moveTo(PX(8, 8), PY(8, 8, 0));
      g.quadraticCurveTo(PX(8, 8) - 3, PY(8, 8, 12), PX(top[0], top[1]), PY(top[0], top[1], top[2]));
      g.strokeStyle = css(0x7a5a38);
      g.lineWidth = 2.6;
      g.stroke();
      g.strokeStyle = css(0x4a3420, 0.6);
      g.setLineDash([0.8, 1.6]);
      g.lineWidth = 2.6;
      g.stroke();
      g.setLineDash([]);
      const X = PX(top[0], top[1]), Y = PY(top[0], top[1], top[2]);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + R() * 0.3;
        const ex = X + Math.cos(a) * 16, ey = Y + Math.sin(a) * 7 + 5;
        g.beginPath();
        g.moveTo(X, Y);
        g.quadraticCurveTo((X + ex) / 2, Y - 6 + Math.sin(a) * 3, ex, ey);
        g.quadraticCurveTo((X + ex) / 2 + 1.5, Y - 3 + Math.sin(a) * 3, X, Y);
        g.fillStyle = css(shade(col, Math.sin(a) < 0 ? 0.12 : -0.2));
        g.fill();
        edgeStroke(g, col, 0.35, 0.4);
      }
      dot(g, X, Y + 1, 1.3, 0x6a4a2a, 1);
      return;
    }
    if (mat === 'cactus') {
      cyl(g, 8, 8, 1.6, 0, 19, col, {});
      cyl(g, 8, 6, 1, 7, 10, col, { top: false });
      cyl(g, 8, 4.8, 1, 9, 15, col, {});
      cyl(g, 9.5, 8, 0.9, 5, 8, col, { top: false });
      cyl(g, 10.6, 8, 0.9, 7, 12, col, {});
      for (let k = 0; k < 10; k++) dot(g, PX(8, 8) + (R() - 0.5) * 7, PY(8, 8, 3 + R() * 15), 0.25, 0xf0f0d0, 0.8);
      return;
    }
    if (mat === 'spire') {
      prism(g, [[5, 6], [9, 4], [12, 7], [11, 12], [6, 11]], 0, 14, col, { tex: (W, H, c) => TEX.strata(g, W, H, c, R) });
      prism(g, [[6.5, 7], [9, 6], [10.5, 8], [9.5, 10.5], [7, 10]], 14, 26, shade(col, 0.05), { tex: (W, H, c) => TEX.strata(g, W, H, c, R) });
      return;
    }
    if (mat === 'organic') {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + R(), x = 8 + Math.cos(a) * 3, y = 8 + Math.sin(a) * 3;
        const h = 14 + R() * 8;
        g.beginPath();
        g.moveTo(PX(8, 8), PY(8, 8, 0));
        g.quadraticCurveTo(PX(x, y), PY(x, y, h * 0.5), PX(x, y) + (R() - 0.5) * 6, PY(x, y, h));
        g.strokeStyle = css(shade(col, (R() - 0.5) * 0.3));
        g.lineWidth = 2;
        g.stroke();
        ball(g, x, y, h, 2.2, shade(col, 0.15));
        P.glow((e) => dot(e, PX(x, y) + (R() - 0.5) * 2, PY(x, y, h) - 1, 1.2, 0xe090ff, 0.8));
      }
      return;
    }
    // folhosas (carvalho, plátano)
    cyl(g, 8, 8, 1.3, 0, 12, trunk, { top: false });
    line(g, PX(8, 8), PY(8, 8, 10), PX(8, 8) - 5, PY(8, 8, 15), trunk, 1, 1.4);
    line(g, PX(8, 8), PY(8, 8, 9), PX(8, 8) + 5, PY(8, 8, 14), trunk, 1, 1.2);
    canopy(g, P, col, 18, 8.5, 7);
  };

  PAINT.crate = (g, P) => {
    const d = P.def, col = d.colour, R = P.R, mat = d.mat;
    contact(g, 8, 8, 8, 0.3);
    if (mat === 'hay') {
      const straw = (W, H, c) => { for (let k = 0; k < W * H * 0.9; k++) { const s = R() * W, t = R() * H; line(g, s, t, s + 1.2, t + (R() - 0.5) * 0.4, shade(c, (R() - 0.5) * 0.45), 0.8, 0.18); } };
      box(g, 1.5, 2, 0, 14.5, 14, 11, col, { texX: straw, texY: straw, texTop: straw });
      for (const t of [0.3, 0.7]) {
        line(g, PX(1.5, 14) + 26 * t, PY(1.5, 14, 0) + 13 * t, PX(1.5, 14) + 26 * t, PY(1.5, 14, 11) + 13 * t, 0x8a5a30, 0.8, 0.5);
      }
      return;
    }
    if (mat === 'logs') {
      for (const [z, y0] of [[0, 3], [0, 8.5], [4.5, 5.75]]) {
        box(g, 1, y0, z, 15, y0 + 4.5, z + 4.5, col, { edge: 0.3, texX: (W, H, c) => {
          g.beginPath();
          g.ellipse(W / 2, H / 2, W / 2 - 0.2, H / 2 - 0.2, 0, 0, TAU);
          g.fillStyle = css(0xc8a070);
          g.fill();
          g.strokeStyle = css(0x8a6a40);
          g.lineWidth = 0.2;
          g.beginPath();
          g.ellipse(W / 2, H / 2, W / 4, H / 4, 0, 0, TAU);
          g.stroke();
        }, texY: (W, H, c) => { for (let k = 0; k < 4; k++) line(g, 0, R() * H, W, R() * H, shade(c, -0.3), 0.6, 0.2); } });
      }
      return;
    }
    if (mat === 'boxes') {
      box(g, 1, 2, 0, 9, 10, 7, col, { texY: (W, H) => line(g, W / 2, 0, W / 2, H, 0xd8c8a0, 0.9, 0.8), texTop: (W, H) => line(g, W / 2, 0, W / 2, H, 0xd8c8a0, 0.9, 0.8) });
      box(g, 7, 6, 0, 15, 14, 9, shade(col, -0.08), { texY: (W, H) => line(g, W / 2, 0, W / 2, H, 0xd8c8a0, 0.9, 0.8), texTop: (W, H) => line(g, W / 2, 0, W / 2, H, 0xd8c8a0, 0.9, 0.8) });
      box(g, 3, 4, 7, 9, 10, 12, shade(col, 0.06), { texTop: (W, H) => line(g, 0, H / 2, W, H / 2, 0xd8c8a0, 0.9, 0.8) });
      return;
    }
    if (mat === 'container') {
      cyl(g, 6, 9, 3.6, 0, 11, col, {});
      cyl(g, 11.5, 5.5, 2.6, 0, 8, shade(col, 0.1), {});
      P.glow((e) => {
        e.fillStyle = css(P.pal.accent, 0.85);
        e.fillRect(PX(6, 9) - 10, PY(6, 9, 6), 20, 1.4);
      });
      return;
    }
    // caixote de madeira (ou metálico no polar) com travessas
    const metal = d.set === 'POLAR';
    const plank = (W, H, c) => {
      if (metal) { TEX.panel(g, W, H, c, R); return; }
      for (let t = 0; t < H; t += 2.4) line(g, 0, t, W, t, shade(c, -0.4), 0.7, 0.18);
      g.strokeStyle = css(shade(c, -0.35));
      g.lineWidth = 0.7;
      g.strokeRect(0.4, 0.4, W - 0.8, H - 0.8);
      g.beginPath();
      g.moveTo(0.4, 0.4);
      g.lineTo(W - 0.4, H - 0.4);
      g.stroke();
    };
    const s = 1.5 + (P.v & 1) * 0.8;
    box(g, s, s, 0, 16 - s, 16 - s, 11.5, col, { texX: plank, texY: plank, texTop: plank });
  };

  PAINT.table = (g, P) => {
    const d = P.def, col = d.colour;
    contact(g, 8, 8, 7, 0.22);
    if (d.mat === 'surgery') {
      cyl(g, 8, 8, 2, 0, 5, shade(col, -0.2), { top: false });
      box(g, 3, 1.5, 5, 13, 14.5, 7, col, { texTop: (W, H) => { g.fillStyle = css(0xe0e8f0, 0.5); g.fillRect(1, 1, W - 2, H - 2); } });
      P.glow((e) => glowAt(e, PX(8, 8), PY(8, 8, 7), 12, P.pal.accent, 0.35));
      return;
    }
    const leg = shade(col, -0.25);
    for (const [x, y] of [[2.5, 2.5], [12.5, 2.5], [2.5, 12.5], [12.5, 12.5]]) box(g, x, y, 0, x + 1, y + 1, 6, leg, { ao: false, edge: 0.3 });
    box(g, 1.5, 1.5, 6, 14.5, 14.5, 7.5, col, { texTop: (W, H, c) => { for (let t = 0; t < H; t += 3.2) line(g, 0, t, W, t, shade(c, -0.3), 0.6, 0.2); } });
  };

  PAINT.bed = (g, P) => {
    const d = P.def, col = d.colour, mat = d.mat;
    contact(g, 8, 8, 8, 0.24);
    if (mat === 'sofa') {
      box(g, 1, 3, 0, 15, 13, 4, col, {});
      box(g, 1, 3, 4, 15, 5.5, 9, shade(col, -0.05), {});
      box(g, 1, 5.5, 4, 2.6, 13, 6.5, col, { edge: 0.3 });
      box(g, 13.4, 5.5, 4, 15, 13, 6.5, col, { edge: 0.3 });
      box(g, 2.6, 5.5, 4, 13.4, 13, 5, shade(col, 0.1), { edge: 0.3 });
      return;
    }
    if (mat === 'pod') {
      box(g, 2, 1, 0, 14, 15, 3, shade(col, -0.2), {});
      ball(g, 8, 8, 4.5, 5, 0x6ad0d8, { sx: 1.8, sy: 1.6, hi: 0.4, edgeA: 0.3 });
      P.glow((e) => glowAt(e, PX(8, 8), PY(8, 8, 4.5), 10, 0x6ad0d8, 0.3));
      return;
    }
    box(g, 1.5, 1, 0, 14.5, 15, 3.5, 0x6a4a30, {});
    box(g, 2, 1.5, 3.5, 14, 14.5, 5.5, 0xe8e4d8, { edge: 0.3 });
    box(g, 2, 5, 5.5, 14, 14.5, 6.5, col, { edge: 0.3 });
    box(g, 3, 1.8, 5.5, 13, 4.5, 7, 0xf4f2ec, { edge: 0.3 });
    box(g, 1.2, 0.5, 0, 14.8, 1.5, 9, 0x5a3e28, { edge: 0.35 });
  };

  PAINT.cabinet = (g, P) => {
    const d = P.def, col = d.colour, mat = d.mat, R = P.R;
    contact(g, 8, 8, 8, 0.28);
    if (mat === 'console') {
      const dark = shade(col, -0.25);
      box(g, 2, 3, 0, 14, 13, 8, dark, { texY: (W, H, c) => TEX.panel(g, W, H, c, R) });
      // tampo inclinado com ecrã
      const pts = [[2, 3, 8], [14, 3, 12], [14, 13, 12], [2, 13, 8]];
      fillPoly(g, [[14, 3, 8], [14, 13, 8], [14, 13, 12], [14, 3, 12]], shade(dark, -0.2));
      fillPoly(g, pts, shade(dark, 0.15));
      poly(g, pts);
      edgeStroke(g, dark, 0.5);
      const scr = [[4, 5, 8.8], [12, 5, 11.2], [12, 11, 11.2], [4, 11, 8.8]];
      const glowC = d.set === 'CRAFT' ? 0x60ff90 : P.pal.accent;
      fillPoly(g, scr, shade(glowC, -0.55));
      const on = P.st;
      P.glow((e) => {
        poly(e, scr);
        e.fillStyle = css(glowC, 0.5);
        e.fill();
        for (let k = 0; k < 4; k++) {
          const lit = ((k + on) & 3) !== 0;
          const p = [4.5 + k * 2, 12.3, 8 + (4.5 + k * 2 - 2) / 3];
          dot(e, PX(p[0], p[1]), PY(p[0], p[1], p[2]), 0.6, k & 1 ? 0xff5040 : 0xffe060, lit ? 1 : 0.15);
        }
      });
      return;
    }
    if (mat === 'shelf') {
      box(g, 1.5, 4, 0, 14.5, 12, 16, shade(col, -0.1), {
        texY: (W, H, c) => {
          for (let t = 0; t < H; t += 4) {
            g.fillStyle = css(shade(c, -0.5));
            g.fillRect(0.6, t + 0.4, W - 1.2, 3.2);
            for (let s = 0.8; s < W - 1; s += 0.9 + R() * 0.5) {
              g.fillStyle = css([0xb84a3a, 0x3a6ab8, 0xd6c8a0, 0x4a8a5a, 0x8a5aa8][(R() * 5) | 0]);
              g.fillRect(s, t + 0.8 + R() * 0.6, 0.75, 2.8);
            }
          }
        },
      });
      return;
    }
    const drawers = (W, H, c) => {
      for (let t = 0; t < H - 1; t += H / 3) {
        g.strokeStyle = css(shade(c, -0.45), 0.8);
        g.lineWidth = 0.25;
        g.strokeRect(0.8, t + 0.6, W - 1.6, H / 3 - 1.2);
        dot(g, W / 2, t + H / 6, 0.35, 0xd8d0b0, 1);
      }
    };
    box(g, 2, 4, 0, 14, 12, 16, col, { texY: drawers, texX: mat === 'wood' ? (W, H, c) => TEX.planksV(g, W, H, c, R) : undefined });
  };

  PAINT.lamp = (g, P) => {
    const d = P.def, col = d.colour, mat = d.mat;
    contact(g, 8, 8, 3, 0.3);
    if (mat === 'beacon') {
      cyl(g, 8, 8, 0.9, 0, 20, col, {});
      ball(g, 8, 8, 21.5, 1.8, P.pal.accent, { hi: 0.6 });
      P.glow((e) => { glowAt(e, PX(8, 8), PY(8, 8, 21.5), 12, P.pal.accent, 0.55); });
      return;
    }
    cyl(g, 8, 8, 0.5, 0, 22, col, {});
    cyl(g, 8, 8, 0.9, 0, 2.5, shade(col, -0.1), {});
    const hx = mat === 'streetlamp' ? 11.5 : 8, hy = mat === 'streetlamp' ? 4.5 : 8;
    if (mat === 'streetlamp') {
      g.beginPath();
      g.moveTo(PX(8, 8), PY(8, 8, 22));
      g.quadraticCurveTo(PX(9, 6), PY(9, 6, 24.5), PX(hx, hy), PY(hx, hy, 23));
      g.strokeStyle = css(col);
      g.lineWidth = 1;
      g.stroke();
    }
    box(g, hx - 1.4, hy - 1.4, 21.4, hx + 1.4, hy + 1.4, 23.4, shade(col, -0.2), { edge: 0.4, ao: false });
    fillPoly(g, [[hx - 1.2, hy - 1.2, 21.3], [hx + 1.2, hy - 1.2, 21.3], [hx + 1.2, hy + 1.2, 21.3], [hx - 1.2, hy + 1.2, 21.3]], 0xfff0b0);
    P.glow((e) => glowAt(e, PX(hx, hy), PY(hx, hy, 21), 9, 0xffe8a0, 0.6));
  };

  const CAR_COLS = [null, 0x2a4a8a, 0xd8d8d0, 0x3a6a3a];
  PAINT.car = (g, P) => {
    const d = P.def, mat = d.mat, R = P.R;
    const col = P.v === 0 || d.role === 'wreck' ? d.colour : (mat === 'car' ? CAR_COLS[P.v] : shade(d.colour, (P.v - 1.5) * 0.08));
    const burnt = d.role === 'wreck';
    contact(g, 8, 8, 8.5, 0.38);
    const wheel = (x, y, r) => {
      const X = PX(x, y), Y = PY(x, y, r);
      g.beginPath();
      g.ellipse(X, Y, r * 1.1, r * 2, -0.45, 0, TAU);
      g.fillStyle = css(0x16181a);
      g.fill();
      g.beginPath();
      g.ellipse(X - 0.5, Y, r * 0.45, r * 0.9, -0.45, 0, TAU);
      g.fillStyle = css(burnt ? 0x3a3634 : 0x8a8e94);
      g.fill();
    };
    const glassC = burnt ? 0x141210 : 0x3a5260;
    if (mat === 'tractor') {
      wheel(4, 14, 3.4);
      wheel(12.5, 14, 2.2);
      box(g, 6, 5, 2.5, 15, 11, 7, col, {});
      box(g, 2, 4, 2.5, 7.5, 12, 12, col, { texY: (W, H) => { g.fillStyle = css(glassC, 0.9); g.fillRect(1, 1, W - 2, H * 0.45); } });
      box(g, 1.5, 3.5, 12, 8, 12.5, 13, shade(col, -0.2), { ao: false });
      cyl(g, 13, 7, 0.4, 7, 11, 0x2a2a2a, {});
      wheel(4, 2.2, 3.4);
      return;
    }
    if (mat === 'vehicle') {
      box(g, 1.5, 4, 2.5, 14.5, 12, 6, col, { texY: (W, H, c) => TEX.alloy(g, W, H, c, R, P.pal.accent) });
      ball(g, 8, 8, 7, 3, 0x6ad0d8, { sx: 2.2, sy: 1.4, hi: 0.5 });
      P.glow((e) => glowAt(e, PX(8, 8), PY(8, 8, 1), 14, P.pal.accent, 0.35));
      return;
    }
    // automóvel / jipe / snowcat ao longo de x
    wheel(4, 12.2, 1.9);
    wheel(12, 12.2, 1.9);
    if (mat === 'snowcat') {
      box(g, 1.5, 3.2, 0, 14.5, 4.8, 3, 0x2a2a2a, { ao: false });
      box(g, 1.5, 11.2, 0, 14.5, 12.8, 3, 0x2a2a2a, { ao: false });
    }
    box(g, 1, 4, 1.6, 15, 12, 5.6, col, {
      texY: (W, H, c) => { line(g, 0, H * 0.45, W, H * 0.45, shade(c, -0.4), 0.7, 0.2); g.fillStyle = css(0xe8e0a0, burnt ? 0 : 0.9); g.fillRect(W - 1.2, 0.6, 0.8, 1.2); },
      texX: (W, H) => { g.fillStyle = css(burnt ? 0x2a2420 : 0xf0f0d8, 0.9); g.fillRect(1, 0.8, 1.6, 1.2); g.fillRect(W - 2.6, 0.8, 1.6, 1.2); },
    });
    if (mat === 'jeep') {
      box(g, 3, 4.5, 5.6, 4, 11.5, 8.5, glassC, { edge: 0.3, ao: false });
      box(g, 9, 5, 5.6, 14, 11, 7, shade(col, -0.25), { ao: false });
    } else {
      box(g, 4, 4.6, 5.6, 11.5, 11.4, 9.4, col, {
        texY: (W, H) => { g.fillStyle = css(glassC, 0.95); g.fillRect(0.8, 0.6, W / 2 - 1.2, H - 1); g.fillRect(W / 2 + 0.4, 0.6, W / 2 - 1.2, H - 1); },
        texX: (W, H) => { g.fillStyle = css(glassC, 0.95); g.fillRect(0.6, 0.6, W - 1.2, H - 1); },
        texTop: (W, H, c) => { if (!burnt) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0.5, 0.5, W - 1, H / 2); } },
      });
    }
    wheel(4, 4, 1.9);
    if (burnt) for (let k = 0; k < 14; k++) dot(g, PX(1 + R() * 14, 4 + R() * 8), PY(8, 8, 3 + R() * 4), 0.6 + R(), R() < 0.5 ? 0x7a3a1a : 0x0a0a0a, 0.7);
  };
  PAINT.wreck = (g, P) => {
    if (P.def.mat === 'alloy') {
      rubblePile(g, P, scatter(P.R, 8, 3), rubbleCol(P), 6);
      return;
    }
    PAINT.car(g, P);
  };

  PAINT.stairsFoot = (g, P) => {
    const col = P.def.colour, alloy = P.def.mat === 'alloy';
    const n = 6;
    contact(g, 8, 8, 8, 0.2);
    // degraus a subir para norte (−y); desenha de trás para a frente
    for (let k = n - 1; k >= 0; k--) {
      const y0 = 16 - ((k + 1) * 16) / n, y1 = 16 - (k * 16) / n;
      box(g, 2, y0, 0, 14, y1, ((k + 1) * 24) / n, col, {
        top: shade(col, 0.22), edge: 0.5,
        texTop: alloy ? (W, H, c) => { for (let s = 0.5; s < W; s += 1.2) line(g, s, 0, s, H, shade(c, -0.3), 0.6, 0.2); } : undefined,
      });
    }
    // corrimão
    box(g, 13.4, 0.5, 0, 14.4, 15.5, 1, shade(col, -0.3), { ao: false, edge: 0.3 });
    g.beginPath();
    g.moveTo(PX(14, 15.5), PY(14, 15.5, 8));
    g.lineTo(PX(14, 0.5), PY(14, 0.5, 30));
    g.strokeStyle = css(shade(col, -0.35));
    g.lineWidth = 0.9;
    g.stroke();
  };
  PAINT.stairsHead = (g, P) => {
    const col = P.def.colour;
    // abertura da escada junto à aresta sul e guarda
    fillPoly(g, [[2, 10, 0.05], [14, 10, 0.05], [14, 16, 0.05], [2, 16, 0.05]], 0x0a0c10, 0.55);
    for (const x of [2, 14]) box(g, x - 0.4, 2, 0, x + 0.4, 2.8, 9, shade(col, -0.3), { ao: false, edge: 0.3 });
    box(g, 1.6, 2, 8.4, 14.4, 2.8, 9.2, shade(col, -0.2), { ao: false, edge: 0.3 });
  };

  PAINT.gravlift = (g, P) => {
    const acc = P.pal.accent;
    const k = P.st / 4;
    const X = PX(8, 8), Y = PY(8, 8, 0);
    g.save();
    g.translate(X, Y);
    g.scale(1, 0.5);
    g.beginPath();
    g.arc(0, 0, 19, 0, TAU);
    g.fillStyle = css(shade(P.pal.inner || 0x404850, -0.45));
    g.fill();
    g.strokeStyle = css(shade(acc, -0.2));
    g.lineWidth = 1.6;
    g.stroke();
    g.restore();
    P.glow((e) => {
      e.save();
      e.translate(X, Y);
      e.scale(1, 0.5);
      for (let r = 0; r < 3; r++) {
        const rr = 4 + ((r / 3 + k) % 1) * 15;
        e.beginPath();
        e.arc(0, 0, rr, 0, TAU);
        e.strokeStyle = css(acc, 0.75 * (1 - rr / 20));
        e.lineWidth = 1.4;
        e.stroke();
      }
      e.restore();
      const gr = e.createLinearGradient(0, Y, 0, Y - 60);
      gr.addColorStop(0, css(acc, 0.3));
      gr.addColorStop(1, css(acc, 0));
      e.fillStyle = gr;
      e.beginPath();
      e.moveTo(X - 18, Y);
      e.lineTo(X - 14, Y - 60);
      e.lineTo(X + 14, Y - 60);
      e.lineTo(X + 18, Y);
      e.ellipse(X, Y, 18, 9, 0, 0, Math.PI, false);
      e.fill();
    });
  };

  function hullBlock(g, P, door) {
    const d = P.def, col = d.colour;
    const alien = d.set === 'UFO' || d.set === 'ALIENBASE';
    const glow = alien && isAlloyMat(d.mat) ? P.pal.accent : null;
    const tex = texFor(d.mat);
    const doorFace = (W, H, c) => {
      tex(g, W, H, c, P.R, glow);
      g.fillStyle = css(shade(c, -0.5));
      g.fillRect(2.6, 2.6, W - 5.2, H - 2.6);
      g.fillStyle = css(shade(c, 0.12));
      g.fillRect(3.1, 3.1, W / 2 - 3.3, H - 3.1);
      g.fillRect(W / 2 + 0.2, 3.1, W / 2 - 3.3, H - 3.1);
      for (const s of [5, W - 5]) for (let t = 6; t < H; t += 4) line(g, s - 1, t, s + 1, t, shade(c, -0.35), 0.7, 0.3);
      if (glow !== null) { g.fillStyle = css(glow, 0.9); g.fillRect(2.6, 2.6, W - 5.2, 0.5); }
    };
    const ori = door ? P.st : null;
    box(g, 0, 0, 0, 16, 16, 24, col, {
      texX: ori === 'y' || ori === 'b' ? doorFace : (W, H, c) => tex(g, W, H, c, P.R, glow),
      texY: ori === 'x' || ori === 'b' ? doorFace : (W, H, c) => tex(g, W, H, c, P.R, glow),
      texTop: (W, H, c) => (isAlloyMat(d.mat) ? FLOOR_TEX.hull(g, c, P.R) : TEX.concrete(g, W, H, c, P.R)),
    });
    if (glow !== null && door) {
      P.glow((e) => {
        if (ori === 'x' || ori === 'b') faceY(e, 16, 0, 16, 0, 24, (W) => { e.fillStyle = css(glow, 0.8); e.fillRect(2.6, 2.6, W - 5.2, 0.5); });
        if (ori === 'y' || ori === 'b') faceX(e, 16, 0, 16, 0, 24, (W) => { e.fillStyle = css(glow, 0.8); e.fillRect(2.6, 2.6, W - 5.2, 0.5); });
      });
    }
  }
  PAINT.hull = (g, P) => hullBlock(g, P, false);
  PAINT.ufoDoor = (g, P) => hullBlock(g, P, true);
  function diagHull(g, P, pts) {
    const d = P.def, col = d.colour;
    const alien = d.set === 'UFO' || d.set === 'ALIENBASE';
    const glow = alien && isAlloyMat(d.mat) ? P.pal.accent : null;
    const tex = texFor(d.mat);
    prism(g, pts, 0, 24, col, { tex: (W, H, c) => tex(g, W, H, c, P.R, glow), texTop: (W, H, c) => (isAlloyMat(d.mat) ? FLOOR_TEX.hull(g, c, P.R) : null) });
  }
  // 2: NE–SO (canto direito ↔ canto esquerdo do losango); 3: NO–SE (cima ↔ baixo)
  PAINT.hullDiag2 = (g, P) => diagHull(g, P, [[11, 0], [16, 0], [16, 5], [5, 16], [0, 16], [0, 11]]);
  PAINT.hullDiag3 = (g, P) => diagHull(g, P, [[0, 0], [5, 0], [16, 11], [16, 16], [11, 16], [0, 5]]);
  PAINT.ufoDoorOpen = (g, P) => {
    const d = P.def, col = d.colour;
    const alien = d.set === 'UFO' || d.set === 'ALIENBASE';
    const acc = alien ? P.pal.accent : 0xe0c060;
    const tex = texFor(d.mat);
    const t = (W, H, c) => tex(g, W, H, c, P.R, null);
    if (P.st === 'y') {
      box(g, 4, 0, 0, 12, 2.4, 24, col, { texY: t });
      box(g, 4, 2.4, 20, 12, 13.6, 24, col, { texY: t, texX: t });
      box(g, 4, 13.6, 0, 12, 16, 24, col, { texY: t, texX: t });
    } else {
      box(g, 0, 4, 0, 2.4, 12, 24, col, { texX: t });
      box(g, 2.4, 4, 20, 13.6, 12, 24, col, { texY: t, texX: t });
      box(g, 13.6, 4, 0, 16, 12, 24, col, { texY: t, texX: t });
    }
    const track = P.st === 'y' ? [[7.5, 2, 0.05], [8.5, 2, 0.05], [8.5, 14, 0.05], [7.5, 14, 0.05]] : [[2, 7.5, 0.05], [14, 7.5, 0.05], [14, 8.5, 0.05], [2, 8.5, 0.05]];
    fillPoly(g, track, acc, 0.6);
    P.glow((e) => { poly(e, track); e.fillStyle = css(acc, 0.5); e.fill(); });
  };

  PAINT.powerSource = (g, P) => {
    const pulse = [0, 0.5, 1, 0.5][P.st | 0];
    const base = shade(P.pal.wall || 0x7a8798, -0.2);
    contact(g, 8, 8, 8, 0.35);
    cyl(g, 8, 8, 6, 0, 3, base, {});
    cyl(g, 8, 8, 4.2, 3, 7, shade(base, -0.15), {});
    for (const a of [0.8, 2.4, 4, 5.6]) {
      const x = 8 + Math.cos(a) * 4.6, y = 8 + Math.sin(a) * 4.6;
      if (x + y > 15) cyl(g, x, y, 0.5, 3, 14, shade(base, 0.1), {});
    }
    const core = 0xff9a30;
    ball(g, 8, 8, 11.5, 3.6, core, { hi: 0.6, edgeA: 0.2 });
    for (const a of [0.8, 2.4, 4, 5.6]) {
      const x = 8 + Math.cos(a) * 4.6, y = 8 + Math.sin(a) * 4.6;
      if (x + y <= 15) cyl(g, x, y, 0.5, 3, 14, shade(base, 0.1), {});
    }
    cyl(g, 8, 8, 4.6, 14, 15.5, base, {});
    P.glow((e) => {
      glowAt(e, PX(8, 8), PY(8, 8, 11.5), 16 + pulse * 6, core, 0.55 + pulse * 0.25);
      dot(e, PX(8, 8) - 1.5, PY(8, 8, 12.5), 2.2, 0xfff0c0, 0.7);
    });
  };
  PAINT.navigation = (g, P) => {
    const R = P.R;
    const base = shade(P.pal.wall || 0x7a8798, -0.25);
    contact(g, 8, 8, 8, 0.3);
    box(g, 3, 4, 0, 13, 12, 7, base, { texY: (W, H, c) => TEX.panel(g, W, H, c, R) });
    const top = [[3, 4, 7], [13, 4, 11], [13, 12, 11], [3, 12, 7]];
    fillPoly(g, [[13, 4, 7], [13, 12, 7], [13, 12, 11], [13, 4, 11]], shade(base, -0.25));
    fillPoly(g, top, shade(base, 0.15));
    poly(g, top);
    edgeStroke(g, base, 0.5);
    const acc = P.pal.accent;
    const scr = [[4.5, 5, 7.7], [11.5, 5, 10.3], [11.5, 11, 10.3], [4.5, 11, 7.7]];
    fillPoly(g, scr, shade(acc, -0.6));
    P.glow((e) => {
      poly(e, scr);
      e.fillStyle = css(acc, 0.45);
      e.fill();
      // traços do ecrã (gráfico a passar)
      e.beginPath();
      for (let k = 0; k <= 8; k++) {
        const x = 5 + k * 0.8, y = 8 + Math.sin(k * 1.3 + P.st * 1.6) * 2;
        const X = PX(x, y), Y = PY(x, y, 7.7 + (x - 4.5) * 0.37 + 0.1);
        if (k) e.lineTo(X, Y);
        else e.moveTo(X, Y);
      }
      e.strokeStyle = css(0xffffff, 0.7);
      e.lineWidth = 0.5;
      e.stroke();
    });
  };
  PAINT.device = (g, P) => {
    const acc = 0x8aff6a, base = shade(P.pal.wall || 0x7a8798, -0.3);
    contact(g, 8, 8, 8, 0.3);
    cyl(g, 8, 8, 5, 0, 3, base, {});
    cyl(g, 5.5, 9, 1.8, 3, 9, 0x6a5a7a, {});
    cyl(g, 10, 6, 1.4, 3, 11, 0x5a6a7a, {});
    ball(g, 8.5, 10, 6, 2.4, 0x8a6a9a, {});
    g.beginPath();
    g.moveTo(PX(5.5, 9), PY(5.5, 9, 9));
    g.bezierCurveTo(PX(6, 5), PY(6, 5, 14), PX(9, 4), PY(9, 4, 14), PX(10, 6), PY(10, 6, 11));
    g.strokeStyle = css(0x4a3a5a);
    g.lineWidth = 1.1;
    g.stroke();
    const f = P.st | 0;
    P.glow((e) => {
      dot(e, PX(5.5, 9), PY(5.5, 9, 9), 2.3, acc, 0.5 + 0.15 * (f & 1));
      dot(e, PX(10, 6), PY(10, 6, 11), 1.8, 0xd890ff, 0.4 + 0.2 * ((f >> 1) & 1));
    });
  };
  PAINT.objective = (g, P) => {
    const d = P.def;
    const pulse = [0, 0.5, 1, 0.5][P.st | 0];
    contact(g, 8, 8, 8.5, 0.4);
    if (d.mat === 'brain') {
      const base = 0x5a4a58;
      cyl(g, 8, 8, 7, 0, 4, base, {});
      cyl(g, 8, 8, 5.5, 4, 6, shade(base, 0.1), {});
      const pink = 0xd87a90;
      ball(g, 8, 8, 14, 6.4, pink, { hi: 0.25, sx: 2.6, sy: 2.2 });
      const X = PX(8, 8), Y = PY(8, 8, 14);
      g.strokeStyle = css(shade(pink, -0.45), 0.8);
      g.lineWidth = 0.7;
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        const y0 = Y - 12 + k * 2.8;
        g.moveTo(X - 14 + Math.abs(k - 4) * 1.5, y0);
        for (let s = -12; s <= 12; s += 3) g.lineTo(X + s, y0 + Math.sin(s * 0.8 + k) * 1.4);
        g.stroke();
      }
      line(g, X - 1, Y - 14, X + 1, Y + 13, shade(pink, -0.5), 0.8, 0.8);
      // cúpula de vidro
      g.beginPath();
      g.ellipse(X, Y - 2, 20, 18, 0, Math.PI, 0);
      g.strokeStyle = 'rgba(200,240,255,0.45)';
      g.lineWidth = 0.8;
      g.stroke();
      P.glow((e) => glowAt(e, X, Y, 22 + pulse * 6, 0xff6a9a, 0.3 + pulse * 0.25));
      return;
    }
    const acc = P.pal.accent;
    const base = shade(P.pal.wall || 0x6a5a80, -0.1);
    cyl(g, 8, 8, 6.5, 0, 3, shade(base, -0.2), {});
    cyl(g, 8, 8, 4.4, 3, 24, base, {
      topCol: shade(base, 0.2),
    });
    const X = PX(8, 8);
    for (const z of [7, 12, 17]) {
      g.beginPath();
      g.ellipse(X, PY(8, 8, z), 12.4, 6.2, 0, 0, Math.PI);
      g.strokeStyle = css(shade(base, -0.45));
      g.lineWidth = 0.8;
      g.stroke();
    }
    const Yc = PY(8, 8, 13);
    g.fillStyle = css(shade(acc, -0.3));
    g.fillRect(X - 6, Yc - 14, 12, 18);
    P.glow((e) => {
      e.fillStyle = css(acc, 0.55 + pulse * 0.3);
      e.fillRect(X - 5, Yc - 13, 10, 16);
      glowAt(e, X, Yc - 5, 20 + pulse * 6, acc, 0.35 + pulse * 0.2);
    });
  };
  PAINT.rubbleObject = (g, P) => {
    contact(g, 8, 8, 8, 0.25);
    rubblePile(g, P, scatter(P.R, 9, 2), rubbleCol(P), 5);
  };

  // ---- composição do sprite --------------------------------------------------------------------------------
  const defs = () => (OV.Data && OV.Data.tileDefs) || [];
  function partOf(def) {
    return def.part === 'floor' ? 'floor' : def.part === 'west' ? 'west' : def.part === 'north' ? 'north' : 'object';
  }
  function variantsOf(def) {
    if (!def) return 1;
    if (def.part === 'floor') return Math.max(FLOOR_VARIANTS, def.variantCount | 0);
    return Math.max(1, def.variantCount | 0);
  }
  const framesOf = (def) => {
    if (!def) return 1;
    if (def.art === 'cabinet' && def.mat === 'console') return 4;
    return ANIM[def.art] || 1;
  };
  const isOriented = (def) => !!def && (def.art === 'ufoDoor' || def.art === 'ufoDoorOpen');
  function normState(def, st) {
    if (isOriented(def)) return st === 'y' || st === 'b' ? st : 'x';
    const f = framesOf(def);
    if (f <= 1) return 0;
    const n = Math.round(+st || 0);
    return ((n % f) + f) % f;
  }
  const qScale = (s) => Math.min(8, Math.max(0.25, Math.round((+s || 1) * 4) / 4));

  function render(def, v, st, scale) {
    const part = partOf(def);
    const bx = BOX[part];
    const w = bx[2] - bx[0], h = bx[3] - bx[1];
    const W = Math.round(w * scale), H = Math.round(h * scale);
    // canvas de trabalho legível (recorte); o sprite final é uma cópia recortada
    const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(scale, 0, 0, scale, -bx[0] * scale, -bx[1] * scale);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    let ec = null;
    const pal = (OV.Data && OV.Data.tilesets && OV.Data.tilesets[def.set] && OV.Data.tilesets[def.set].palette) || {};
    const byKey = (OV.Data && OV.Data.tileDefByKey) || {};
    const wallDef = byKey[def.set + '.wall'];
    const P = {
      def, v, st, pal,
      wallMat: wallDef ? wallDef.mat : def.mat,
      wallCol: wallDef ? wallDef.colour : pal.wall || def.colour,
      R: rng(hashStr(def.key || String(def.id)) ^ Math.imul(v + 1, 0x9e3779b1)),
      glow(fn) {
        fn(g);
        if (!ec) {
          ec = makeCanvas(W, H);
          const eg = ec.getContext('2d', { willReadFrequently: true });
          eg.setTransform(scale, 0, 0, scale, -bx[0] * scale, -bx[1] * scale);
          eg.lineJoin = 'round';
          eg.lineCap = 'round';
          P.eg = eg;
        }
        fn(P.eg);
      },
    };
    const painter = PAINT[def.art] || PAINT[def.role];
    if (painter) painter(g, P, part);
    return trim({ c, w, h, ax: -bx[0], ay: -bx[1], e: ec, scale, part, sil: null, gray: null });
  }

  // recorta a margem transparente (menos píxeis a compor por fotograma); a âncora mantém-se exata
  function trim(spr) {
    const c = spr.c, g = c.getContext('2d');
    if (!g.getImageData || c.width < 4 || c.height < 4) return spr;
    let d;
    try {
      d = g.getImageData(0, 0, c.width, c.height).data;
    } catch (e) {
      return spr;
    }
    const W = c.width, H = c.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const scan = (data) => {
      for (let y = 0; y < H; y++) {
        const row = y * W * 4;
        for (let x = 0; x < W; x++) {
          if (data[row + x * 4 + 3] > 2) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    };
    scan(d);
    if (spr.e) {
      try {
        scan(spr.e.getContext('2d').getImageData(0, 0, W, H).data);
      } catch (e) {
        x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1;
      }
    }
    if (x1 < 0) {
      x0 = 0; y0 = 0; x1 = 0; y1 = 0;
    }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
    const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
    const crop = (src) => {
      const n = makeCanvas(cw, chh);
      n.getContext('2d').drawImage(src, -x0, -y0);
      return n;
    };
    const k = spr.scale;
    spr.c = crop(c);
    if (spr.e) spr.e = crop(spr.e);
    spr.ax -= x0 / k;
    spr.ay -= y0 / k;
    spr.w = cw / k;
    spr.h = chh / k;
    return spr;
  }

  // ---- cache LRU com orçamento em píxeis --------------------------------------------------------------------
  const cache = new Map();
  let pixels = 0;
  let budget = 40e6;
  const area = (s) => s.c.width * s.c.height * (1 + (s.e ? 1 : 0) + (s.sil ? 1 : 0) + (s.gray ? 1 : 0));
  function remember(k, spr) {
    cache.set(k, spr);
    pixels += area(spr);
    while (pixels > budget && cache.size > 1) {
      const first = cache.keys().next().value;
      pixels -= area(cache.get(first));
      cache.delete(first);
    }
  }

  // defId: id numérico (ou chave 'SET.papel'); null/0 ⇒ null
  function get(defId, variant, scale, state) {
    const all = defs();
    const def = typeof defId === 'string' ? (OV.Data.tileDefByKey || {})[defId] : all[defId | 0];
    if (!def) return null;
    const nv = variantsOf(def);
    const v = ((Math.round(+variant || 0) % nv) + nv) % nv;
    const st = normState(def, state);
    const s = qScale(scale);
    const k = def.id + '|' + v + '|' + st + '|' + s;
    let spr = cache.get(k);
    if (spr) {
      cache.delete(k);
      cache.set(k, spr);
      return spr;
    }
    spr = render(def, v, st, s);
    spr.key = k;
    remember(k, spr);
    return spr;
  }

  // camadas derivadas criadas a pedido
  function silhouette(spr) {
    if (spr.sil) return spr.sil;
    const c = makeCanvas(spr.c.width, spr.c.height), g = c.getContext('2d');
    g.drawImage(spr.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = css(NIGHT);
    g.fillRect(0, 0, c.width, c.height);
    spr.sil = c;
    pixels += c.width * c.height;
    return c;
  }
  function gray(spr) {
    if (spr.gray) return spr.gray;
    const c = makeCanvas(spr.c.width, spr.c.height), g = c.getContext('2d');
    g.drawImage(spr.c, 0, 0);
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#808080';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(spr.c, 0, 0);
    spr.gray = c;
    pixels += c.width * c.height;
    return c;
  }

  // desenho em px do dispositivo (contexto com transformação identidade); X, Y = âncora; S = px por px CSS
  // dark 0..1 = sombra noturna; grayA 0..1 = dessaturação (névoa); a camada emissiva repõe as luzes
  function blitDev(ctx, spr, X, Y, S, dark, grayA) {
    const same = Math.abs(S - spr.scale) < 1e-6;
    const dx = Math.round(X - spr.ax * S), dy = Math.round(Y - spr.ay * S);
    const dw = same ? spr.c.width : Math.round(spr.w * S), dh = same ? spr.c.height : Math.round(spr.h * S);
    ctx.drawImage(spr.c, dx, dy, dw, dh);
    if (grayA > 0.01) {
      ctx.globalAlpha = Math.min(1, grayA);
      ctx.drawImage(gray(spr), dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (dark > 0.01) {
      ctx.globalAlpha = Math.min(1, dark);
      ctx.drawImage(silhouette(spr), dx, dy, dw, dh);
      if (spr.e && !(grayA > 0.01)) ctx.drawImage(spr.e, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
  }
  // desenho em px CSS com a âncora em (x, y), alinhado a píxeis do dispositivo
  function blit(ctx, spr, x, y, zoom, dark, grayA) {
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 };
    const S = t.a || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    blitDev(ctx, spr, x * S + t.e, y * (t.d || 1) + t.f, (zoom || 1) * S, dark || 0, grayA || 0);
    ctx.restore();
  }
  function draw(ctx, defId, variant, state, x, y, zoom, dark, grayA) {
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1 };
    const spr = get(defId, variant, (zoom || 1) * (t.a || 1), state);
    if (spr) blit(ctx, spr, x, y, zoom || 1, dark, grayA);
    return spr;
  }

  function clearCache() {
    cache.clear();
    pixels = 0;
  }

  OV.TileSprites = {
    BOX, get, blit, blitDev, draw, silhouette, gray, clearCache,
    variants: (defId) => variantsOf(defs()[defId | 0]),
    frames: (defId) => framesOf(defs()[defId | 0]),
    oriented: (defId) => isOriented(defs()[defId | 0]),
    hasArt: (defId) => {
      const d = defs()[defId | 0];
      return !!(d && (PAINT[d.art] || PAINT[d.role]));
    },
    stats: () => ({ entries: cache.size, pixels, budget }),
    setBudget: (px) => { budget = Math.max(1e5, +px || 40e6); },
    setCanvasFactory: (fn) => { makeCanvas = fn; clearCache(); },
  };
})(globalThis.OV || (globalThis.OV = {}));
