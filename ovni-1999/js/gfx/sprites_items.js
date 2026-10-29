/* Ícones procedimentais dos itens (inventário, armazém, Ufopédia) e versões no chão do Battlescape,
   sem imagens: cada item é desenhado com caminhos Canvas 2D num referencial próprio (px CSS, origem no
   centro, cano para +x, cima = −y) e depois composto com contorno exterior de 1 px, sombra e halos.
   OV.ItemSprites.icon(itemId, scale) → canvas quadrado de 48×48 px CSS (48·scale px no dispositivo);
     item centrado, armas longas na diagonal como no inventário orig, tamanho proporcional ao real.
   OV.ItemSprites.ground(itemId, scale) → {c, w, h, ax, ay}: versão pequena deitada no losango (projeção
     isométrica 2:1 do plano do chão) ou de pé (artefactos, cristais); w/h/ax/ay em px CSS a zoom 1 e
     (ax, ay) assenta no centro do losango do tile.
   drawIcon/drawGround/blit desenham alinhados a píxeis do dispositivo; clearCache() limpa a cache.
   Ids sem arte própria recebem uma caixa de abastecimento genérica. */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css, shade = Col.shade, mix = Col.mix;
  const TAU = Math.PI * 2;
  const BOX = 48;
  const NO = {};

  // ---- paleta ------------------------------------------------------------------------------------------
  const OUT = 0x07090d;
  const GM = 0x3e454e, GM_D = 0x272c33, GM_L = 0x6c7682, POLY = 0x2c2926, STEEL = 0x9ca6b0, HOLE = 0x0b0d10;
  const OR = 0xf08c2a, TEAL = 0x35c4bf, BRASS = 0xd8a948, RED = 0xd8432c, OLIVE = 0x4f5b3a, WHITE = 0xeceee8;
  const LZ = 0x56606c, LZ_D = 0x3a424c, LZ_L = 0xa6b2bf, LZ_GLOW = 0x5ff4ff;
  const AL = 0x6d6478, AL_D = 0x463f51, AL_L = 0x9b91a8, AG = 0x78ff96, PSI = 0xd77dff, STUN = 0x8ec8ff;
  const ELERIUM = 0xf0466a;

  // ---- canvas -----------------------------------------------------------------------------------------
  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('ItemSprites: sem canvas disponível');
  };

  // ---- primitivas (referencial do item) -----------------------------------------------------------------
  function grad(g, c, y0, y1, hi, lo) {
    const gr = g.createLinearGradient(0, y0, 0, y1 > y0 ? y1 : y0 + 1);
    gr.addColorStop(0, css(shade(c, hi)));
    gr.addColorStop(0.5, css(c));
    gr.addColorStop(1, css(shade(c, lo)));
    return gr;
  }
  function edge(g, c, o) {
    if (o.line === false) return;
    g.lineJoin = 'round';
    g.lineWidth = o.lw || 0.75;
    g.strokeStyle = css(o.line === undefined ? shade(c, -0.62) : o.line);
    g.stroke();
  }
  // preenche o caminho atual com gradiente vertical (y0..y1) e traço interno escuro
  function paint(g, c, y0, y1, o) {
    o = o || NO;
    g.fillStyle = o.flat ? css(c, o.a) : grad(g, c, y0, y1, o.hi === undefined ? 0.3 : o.hi, o.lo === undefined ? -0.38 : o.lo);
    g.fill(o.rule || 'nonzero');
    edge(g, c, o);
  }
  function path(g, p) {
    g.beginPath();
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.closePath();
  }
  function yRange(p) {
    let y0 = p[1], y1 = p[1];
    for (let i = 3; i < p.length; i += 2) {
      if (p[i] < y0) y0 = p[i];
      if (p[i] > y1) y1 = p[i];
    }
    return [y0, y1];
  }
  function poly(g, p, c, o) {
    path(g, p);
    const r = yRange(p);
    paint(g, c, r[0], r[1], o);
  }
  function rrPath(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    g.beginPath();
    if (r <= 0) {
      g.rect(x, y, w, h);
      return;
    }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function rr(g, x, y, w, h, r, c, o) {
    rrPath(g, x, y, w, h, r);
    paint(g, c, y, y + h, o);
  }
  function ellPath(g, cx, cy, rx, ry, rot) {
    g.beginPath();
    g.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU);
  }
  function ell(g, cx, cy, rx, ry, c, o) {
    ellPath(g, cx, cy, rx, ry, o && o.rot);
    paint(g, c, cy - ry, cy + ry, o);
  }
  // esfera: gradiente radial com luz de cima-esquerda
  function ball(g, cx, cy, r, c, o) {
    o = o || NO;
    const gr = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r);
    gr.addColorStop(0, css(shade(c, o.hi === undefined ? 0.5 : o.hi)));
    gr.addColorStop(0.55, css(c));
    gr.addColorStop(1, css(shade(c, -0.5)));
    ellPath(g, cx, cy, r, o.ry || r, o.rot);
    g.fillStyle = gr;
    g.fill();
    edge(g, c, o);
  }
  // cilindro deitado (eixo em x): faixa de brilho no terço superior
  function cyl(g, x, y, w, h, c, o) {
    o = o || NO;
    rrPath(g, x, y, w, h, o.r || 0);
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, css(shade(c, -0.12)));
    gr.addColorStop(0.24, css(shade(c, 0.46)));
    gr.addColorStop(0.5, css(c));
    gr.addColorStop(1, css(shade(c, -0.52)));
    g.fillStyle = gr;
    g.fill();
    edge(g, c, o);
  }
  // cilindro de pé (eixo em y)
  function vcyl(g, x, y, w, h, c, o) {
    o = o || NO;
    rrPath(g, x, y, w, h, o.r || 0);
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, css(shade(c, -0.05)));
    gr.addColorStop(0.3, css(shade(c, 0.44)));
    gr.addColorStop(0.55, css(c));
    gr.addColorStop(1, css(shade(c, -0.52)));
    g.fillStyle = gr;
    g.fill();
    edge(g, c, o);
  }
  function ln(g, p, c, w, a, cap) {
    g.beginPath();
    g.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.lineCap = cap || 'round';
    g.lineJoin = 'round';
    g.lineWidth = w;
    g.strokeStyle = css(c, a);
    g.stroke();
  }
  // curva quadrática simples (x0,y0) → (x2,y2) com controlo (x1,y1)
  function qc(g, p, c, w, a) {
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.quadraticCurveTo(p[2], p[3], p[4], p[5]);
    g.lineCap = 'round';
    g.lineWidth = w;
    g.strokeStyle = css(c, a);
    g.stroke();
  }
  const hl = (g, x0, y0, x1, y1, a) => ln(g, [x0, y0, x1, y1], 0xffffff, 0.6, a === undefined ? 0.35 : a);
  // membro com contorno (traço largo escuro + traço da cor)
  function limb(g, p, c, w) {
    ln(g, p, shade(c, -0.66), w + 1.3);
    ln(g, p, c, w);
    ln(g, p, shade(c, 0.28), w * 0.3, 0.55);
  }
  // textura de linhas paralelas recortada ao polígono (punhos, placas)
  function texture(g, p, c, a, step, slope) {
    const r = yRange(p);
    let x0 = p[0], x1 = p[0];
    for (let i = 2; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
    }
    g.save();
    path(g, p);
    g.clip();
    const s = slope || 0;
    for (let y = r[0] + step * 0.6; y < r[1]; y += step) ln(g, [x0 - 2, y + s * 2, x1 + 2, y - s * 2], c, 0.5, a, 'butt');
    g.restore();
  }
  // listras diagonais de aviso recortadas a um retângulo
  function hazard(g, x, y, w, h, c1, c2) {
    g.save();
    rrPath(g, x, y, w, h, 0);
    g.clip();
    g.fillStyle = css(c1);
    g.fillRect(x, y, w, h);
    for (let i = -h; i < w + h; i += h * 1.2) {
      g.beginPath();
      g.moveTo(x + i, y + h);
      g.lineTo(x + i + h * 0.6, y + h);
      g.lineTo(x + i + h * 1.2, y);
      g.lineTo(x + i + h * 0.6, y);
      g.closePath();
      g.fillStyle = css(c2);
      g.fill();
    }
    g.restore();
  }
  // ponto emissivo: núcleo claro + halo aditivo composto no fim
  function lamp(g, d, x, y, r, c, gr, ga) {
    const rg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    rg.addColorStop(0, css(mix(c, 0xffffff, 0.75)));
    rg.addColorStop(0.55, css(c));
    rg.addColorStop(1, css(shade(c, -0.3)));
    ellPath(g, x, y, r, r);
    g.fillStyle = rg;
    g.fill();
    if (gr !== 0) d.glow(x, y, gr || r * 3.2, c, ga === undefined ? 0.5 : ga);
  }
  // faixa emissiva (canal de energia); halos espalhados ao longo do eixo maior
  function strip(g, d, x, y, w, h, c, ga) {
    rrPath(g, x, y, w, h, Math.min(w, h) / 2);
    const vert = h > w;
    const gr = vert ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, css(mix(c, 0xffffff, 0.65)));
    gr.addColorStop(0.5, css(c));
    gr.addColorStop(1, css(shade(c, -0.25)));
    g.fillStyle = gr;
    g.fill();
    if (ga === 0) return;
    const L = vert ? h : w, S = vert ? w : h, n = Math.max(1, Math.round(L / (S * 3.5)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      d.glow(vert ? x + w / 2 : x + w * t, vert ? y + h * t : y + h / 2, S * 2.6, c, ga || 0.3);
    }
  }
  // canal emissivo curvo (traço)
  function glowLine(g, d, p, c, w, ga) {
    ln(g, p, shade(c, -0.35), w + 0.8);
    ln(g, p, c, w);
    ln(g, p, mix(c, 0xffffff, 0.7), w * 0.35);
    if (ga === 0) return;
    for (let i = 0; i + 1 < p.length; i += 2) d.glow(p[i], p[i + 1], w * 3.4, c, ga || 0.28);
  }
  // punho de polímero com estrias
  function grip(g, p, c) {
    poly(g, p, c || POLY);
    texture(g, p, 0xffffff, 0.09, 1.5, 0.2);
  }
  // guarda-mato aberto em (x, y): largura w, profundidade h
  function guard(g, x, y, w, h, c) {
    ln(g, [x, y, x, y + h * 0.75, x + 1.2, y + h, x + w, y + h, x + w + 0.8, y], c || GM_D, 1.2);
    ln(g, [x + w * 0.42, y + 0.3, x + w * 0.55, y + h * 0.72], GM_L, 0.85);
  }
  // símbolos de munição (sem texto): AP ponta, HE estrela, IN chama
  function ammoMark(g, kind, x, y, r) {
    const c = 0xe9e3cf;
    if (kind === 'ap') poly(g, [x, y - r, x + r * 0.8, y + r * 0.8, x - r * 0.8, y + r * 0.8], c, { flat: true, line: 0x1a1a1a, lw: 0.4 });
    else if (kind === 'he') {
      const p = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU - Math.PI / 2, rr2 = i & 1 ? r * 0.45 : r;
        p.push(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
      }
      poly(g, p, c, { flat: true, line: 0x1a1a1a, lw: 0.4 });
    } else {
      g.beginPath();
      g.moveTo(x, y - r);
      g.quadraticCurveTo(x + r * 1.1, y + r * 0.1, x + r * 0.5, y + r);
      g.quadraticCurveTo(x, y + r * 0.6, x - r * 0.5, y + r);
      g.quadraticCurveTo(x - r * 1.1, y + r * 0.1, x, y - r);
      g.closePath();
      paint(g, c, y - r, y + r, { flat: true, line: 0x1a1a1a, lw: 0.4 });
    }
  }
  // munição pesada: código de cor por tipo
  const AMMO = {
    ap: { tip: 0xb9c0c8, band: 0x23272c },
    he: { tip: 0xd8432c, band: 0xe8b83a },
    in: { tip: 0xf2a02e, band: 0xc8382a },
  };
  // obus de pé: casquilho de latão + ogiva
  function shell(g, x, y, w, h, tip) {
    vcyl(g, x, y, w, h, BRASS, { lw: 0.5 });
    g.beginPath();
    g.moveTo(x, y + 0.2);
    g.quadraticCurveTo(x + 0.1, y - w * 0.9, x + w / 2, y - w * 1.25);
    g.quadraticCurveTo(x + w - 0.1, y - w * 0.9, x + w, y + 0.2);
    g.closePath();
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, css(shade(tip, 0.1)));
    gr.addColorStop(0.35, css(shade(tip, 0.45)));
    gr.addColorStop(1, css(shade(tip, -0.45)));
    g.fillStyle = gr;
    g.fill();
    edge(g, tip, { lw: 0.5 });
  }

  // ---- armas convencionais ----------------------------------------------------------------------------
  function pistol(g) {
    grip(g, [-11.8, -1, -4.6, -1, -2.6, 9.6, -9.6, 9.6]);
    guard(g, -3.8, 0, 7.6, 4.8);
    poly(g, [-12.6, -3.8, 7, -3.8, 7, -0.6, 2.4, 0.6, -12.2, 0.6], GM_D);
    rr(g, -13.6, -8.8, 25.6, 5.4, 0.9, GM);
    rr(g, 11.6, -7.9, 2.8, 3.8, 0.5, GM_D);
    for (let i = 0; i < 4; i++) ln(g, [-12.3 + i * 1.1, -8.1, -12.3 + i * 1.1, -4.5], GM_D, 0.45, 0.9);
    rr(g, -1.4, -8.1, 6.4, 1.8, 0.3, HOLE, { flat: true, line: false });
    rr(g, 9.6, -10, 1.6, 1.4, 0.2, GM_D, { flat: true });
    rr(g, -12.8, -10.2, 2.6, 1.6, 0.2, GM_D, { flat: true });
    rr(g, -13.6, -4.9, 5, 1.1, 0.2, OR, { flat: true, line: false });
    hl(g, -12.8, -8.2, 11, -8.2, 0.4);
  }
  // carregador direito (pistola) ou curvo (espingarda)
  function pistolClip(g) {
    ell(g, 0.3, -8.6, 2.4, 1.3, BRASS, { lw: 0.5 });
    poly(g, [-4.2, -7.6, 4.2, -7.6, 5.2, 7.4, -3.4, 7.4], GM);
    rr(g, -1.1, -4.6, 2.4, 9, 1.1, HOLE, { flat: true, line: false });
    for (let i = 0; i < 4; i++) ell(g, 0.2 + i * 0.12, -3.2 + i * 2.2, 0.9, 0.7, BRASS, { flat: true, line: false });
    rr(g, -4.2, 6.2, 10.4, 2.8, 0.7, OR);
    hl(g, -3.5, -6.8, -2.8, 5.8, 0.3);
  }
  function rifleClip(g) {
    ell(g, -1.4, -9.6, 2.7, 1.3, BRASS, { lw: 0.5 });
    g.beginPath();
    g.moveTo(-5, -9);
    g.lineTo(2.4, -9);
    g.quadraticCurveTo(3, 1, 7.4, 8.4);
    g.lineTo(0.4, 10.4);
    g.quadraticCurveTo(-3.6, 2, -5, -9);
    g.closePath();
    paint(g, GM, -9, 10.4);
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      qc(g, [-3.6 + t * 1.6, -6 + t * 13, -0.8 + t * 2.6, -6.4 + t * 13.2, 1.8 + t * 4, -6.8 + t * 13.4], GM_D, 0.5, 0.8);
    }
    poly(g, [0.1, 8.6, 7, 6.8, 8, 9, 1, 11.2], OR);
    qc(g, [-4.2, -8, -2.8, 1.4, 0.6, 9.2], 0xffffff, 0.6, 0.25);
  }
  function rifle(g) {
    poly(g, [-27, -4.6, -15, -3.6, -15, 2.6, -22, 4.4, -27, 6.6], POLY);
    rr(g, -28.2, -5, 1.6, 12, 0.5, GM_D);
    poly(g, [-25.2, -2.8, -17, -2.4, -17, -1, -25.2, -0.8], OR, { flat: true, line: false });
    grip(g, [-13, 1.5, -9, 1.5, -10.2, 9, -14.2, 8.2]);
    g.beginPath();
    g.moveTo(-4.6, 1.4);
    g.lineTo(1.6, 1.4);
    g.quadraticCurveTo(2.2, 6, 4.4, 9.6);
    g.lineTo(-0.6, 11);
    g.quadraticCurveTo(-3.6, 6.4, -4.6, 1.4);
    g.closePath();
    paint(g, GM_D, 1.4, 11);
    guard(g, -8.8, 1.6, 4.2, 4);
    rr(g, -16, -5.6, 24, 7.2, 1, GM);
    rr(g, 7, -5, 11.4, 6, 1.2, GM_D);
    for (let i = 0; i < 3; i++) rr(g, 9 + i * 3, -3.6, 1.6, 3, 0.4, HOLE, { flat: true, line: false });
    cyl(g, 18, -3.4, 8.6, 2.6, GM_L);
    rr(g, 26, -4, 2.2, 3.8, 0.4, GM_D);
    poly(g, [21, -3.4, 21.8, -6.8, 23, -6.8, 23.6, -3.4], GM_D);
    rr(g, -6.4, -6.6, 2, 1.2, 0, GM_D, { flat: true, line: false });
    rr(g, -0.6, -6.6, 2, 1.2, 0, GM_D, { flat: true, line: false });
    rr(g, -9, -9.8, 13, 3.6, 1.4, GM_D);
    ell(g, 4.1, -8, 0.8, 1.6, TEAL, { line: 0x0d3a3a, lw: 0.4 });
    hl(g, -14.6, -5.2, 6.8, -5.2, 0.4);
    hl(g, -8.2, -9.4, 3, -9.4, 0.3);
  }
  function hcAmmo(kind) {
    return function (g) {
      const A = AMMO[kind];
      for (const x of [-5.4, -1.6, 2.2]) shell(g, x, -8.4, 3.4, 4.4, A.tip);
      rr(g, -7.6, -4.6, 15.2, 14.2, 1.4, GM);
      rr(g, -7.6, -1.2, 15.2, 3, 0, A.band, { flat: true, line: false });
      ammoMark(g, kind, 0, 5.2, 2.6);
      hl(g, -6.8, -4, 6.8, -4, 0.35);
    };
  }
  function acAmmo(kind) {
    return function (g) {
      const A = AMMO[kind];
      for (let i = 0; i < 5; i++) shell(g, -9 + i * 3.7, -6.6, 2.6, 3.4, A.tip);
      rr(g, -10.6, -3.6, 21.2, 11.4, 1.2, GM);
      rr(g, -10.6, -1.2, 21.2, 2.6, 0, A.band, { flat: true, line: false });
      rr(g, 10.6, -2.6, 2.2, 6, 0.5, GM_D);
      ammoMark(g, kind, -4, 4.4, 2.2);
      ammoMark(g, kind, 4, 4.4, 2.2);
      hl(g, -9.8, -3, 9.8, -3, 0.35);
    };
  }
  function heavyCannon(g) {
    poly(g, [-29, -4.6, -19, -4.6, -19, 3.8, -24, 4.6, -29, 7.2], POLY);
    rr(g, -30.2, -5, 1.8, 12.6, 0.5, GM_D);
    grip(g, [-16.6, 3.6, -12.4, 3.6, -13.6, 11.2, -17.8, 10.4]);
    guard(g, -12, 3.8, 5, 4.2);
    rr(g, -6.6, 3, 8.6, 8.8, 1, GM_D);
    rr(g, -6.6, 8.6, 8.6, 1.7, 0, OR, { flat: true, line: false });
    rr(g, -20, -8.6, 24, 12.4, 2.2, GM);
    rr(g, -20, -2.4, 24, 1.6, 0, OR, { flat: true, line: false });
    cyl(g, 3.4, -6.4, 21, 6.6, GM_L);
    for (const x of [8, 14, 20]) rr(g, x, -6.9, 1.6, 7.6, 0.4, GM_D, { flat: true });
    rr(g, 24, -8, 5.4, 10, 1, GM_D);
    for (const y of [-6.2, -3.4, -0.6]) rr(g, 25, y, 3.4, 1.1, 0.3, HOLE, { flat: true, line: false });
    ln(g, [-15, -8.4, -13, -12.4, -3, -12.4, -1.2, -8.4], GM_D, 2.4);
    ln(g, [-13.4, -12.4, -3.2, -12.4], GM_L, 0.6, 0.7);
    poly(g, [7, 0.2, 10.6, 0.2, 9.8, 7.2, 7, 7.2], POLY);
    hl(g, -19, -8, 3, -8, 0.4);
  }
  function autoCannon(g) {
    g.beginPath();
    g.moveTo(-30, -4.2);
    g.lineTo(-20, -4.2);
    g.lineTo(-20, 4.2);
    g.lineTo(-30, 6.8);
    g.closePath();
    g.moveTo(-28, -2);
    g.lineTo(-22, -2);
    g.lineTo(-22, 1.8);
    g.lineTo(-28, 3.6);
    g.closePath();
    paint(g, POLY, -4.2, 6.8, { rule: 'evenodd' });
    grip(g, [-19, 3.4, -15.4, 3.4, -16.4, 10.6, -20, 10]);
    rr(g, -21, -8, 26, 12, 1.6, GM);
    for (let x = -17; x <= 1; x += 3) ln(g, [x, -6.2, x, -1.4], GM_D, 0.6, 0.85);
    rr(g, -21, 1.2, 26, 1.4, 0, OR, { flat: true, line: false });
    ell(g, -6, 6.6, 6.8, 5.6, GM_D);
    ell(g, -6, 6.6, 4.6, 3.7, GM, { lw: 0.5 });
    ell(g, -6, 6.6, 1.6, 1.4, OR, { lw: 0.5 });
    cyl(g, 5, -6.6, 19, 6.6, GM_D);
    for (let x = 7.4; x < 23; x += 3.2) ell(g, x, -3.3, 0.9, 1.5, HOLE, { flat: true, line: false });
    cyl(g, 24, -4.8, 6, 3.4, GM_L);
    rr(g, 29.4, -5.6, 1.8, 5, 0.4, GM_D);
    ln(g, [8, 0.6, 21, 2], GM_L, 1);
    ln(g, [8, 1.6, 21, 3.4], GM_L, 1);
    rr(g, -12, -11.4, 9, 3.4, 1, GM_D);
    ell(g, -2.6, -9.7, 0.7, 1.4, TEAL, { line: 0x0d3a3a, lw: 0.4 });
    hl(g, -20, -7.4, 4, -7.4, 0.4);
  }
  function rocketLauncher(g) {
    const T = 0x4d5547;
    poly(g, [-27, -7.2, -30.8, -9, -30.8, 4.4, -27, 2.6], GM_D);
    ell(g, -30.8, -2.3, 1.4, 6.6, HOLE, { flat: true, line: GM_D });
    cyl(g, -27, -6.6, 51, 9.2, T);
    poly(g, [23.6, -7.6, 29.8, -9.4, 29.8, 4.6, 23.6, 2.8], GM_D);
    ell(g, 29.8, -2.4, 1.5, 6.8, HOLE, { flat: true, line: GM_D });
    for (const x of [-23.6, 18.6]) cyl(g, x, -6.6, 2.4, 9.2, OR, { line: false });
    rr(g, -7.4, -12.6, 9.6, 4.8, 1.2, GM_D);
    ln(g, [-4.4, -7.8, -4.4, -6.4], GM_D, 1.6);
    ln(g, [-0.6, -7.8, -0.6, -6.4], GM_D, 1.6);
    ell(g, 2.2, -10.2, 0.8, 1.9, TEAL, { line: 0x0d3a3a, lw: 0.4 });
    grip(g, [-3.6, 2.4, 0.2, 2.4, -0.8, 10.4, -4.6, 9.8]);
    guard(g, 0.4, 2.6, 4.2, 3.6);
    poly(g, [9, 2.4, 12.2, 2.4, 11.6, 8.8, 9, 8.8], POLY);
    rr(g, -18, 2.4, 9, 2.8, 1, POLY);
    hl(g, -26, -4.8, 23, -4.8, 0.25);
  }
  function rocket(body, nose, band, fin, big, flames) {
    return function (g) {
      const r = big ? 4.2 : 3.3, L = big ? 28 : 23, x0 = -L / 2 - 3;
      poly(g, [x0 + 2, -r + 0.4, x0 - 2.6, -r - 3.8, x0 - 4.6, -r - 3.8, x0 - 1.6, -r + 0.4], fin);
      poly(g, [x0 + 2, r - 0.4, x0 - 2.6, r + 3.8, x0 - 4.6, r + 3.8, x0 - 1.6, r - 0.4], fin);
      rr(g, x0 - 3, -r * 0.62, 3.6, r * 1.24, 0.5, GM_D);
      cyl(g, x0, -r, L, 2 * r, body);
      g.beginPath();
      g.moveTo(x0 + L, -r);
      g.quadraticCurveTo(x0 + L + r * 2.3, -r * 0.82, x0 + L + r * 2.9, 0);
      g.quadraticCurveTo(x0 + L + r * 2.3, r * 0.82, x0 + L, r);
      g.closePath();
      const gr = g.createLinearGradient(0, -r, 0, r);
      gr.addColorStop(0, css(shade(nose, -0.1)));
      gr.addColorStop(0.25, css(shade(nose, 0.45)));
      gr.addColorStop(0.5, css(nose));
      gr.addColorStop(1, css(shade(nose, -0.5)));
      g.fillStyle = gr;
      g.fill();
      edge(g, nose, NO);
      cyl(g, x0 + L * 0.62, -r, 2.2, 2 * r, band, { line: false });
      if (flames) {
        for (let i = 0; i < 3; i++) {
          const x = x0 + 3 + i * 4.2;
          poly(g, [x, r * 0.75, x + 1.6, -r * 0.55, x + 3.2, r * 0.75, x + 1.6, r * 0.2], flames, { flat: true, line: false });
        }
      }
      ln(g, [x0 - 4.2, 0, x0 + 1.4, 0], shade(fin, -0.5), 1.1);
      hl(g, x0 + 0.5, -r * 0.5, x0 + L - 0.5, -r * 0.5, 0.3);
    };
  }

  // ---- armas laser (fabrico X-COM: metal claro, emissores azul-petróleo) -------------------------------
  function laserPistol(g, d) {
    grip(g, [-11.4, -1.2, -4.8, -1.2, -3.2, 9.6, -9.8, 9.6], LZ_D);
    strip(g, d, -8.8, 2.2, 1.7, 5.6, LZ_GLOW, 0.22);
    guard(g, -3.6, -0.6, 7, 4.6, LZ_D);
    g.beginPath();
    g.moveTo(-13.4, -8.4);
    g.lineTo(5, -8.4);
    g.quadraticCurveTo(9.8, -8.2, 10.6, -5.6);
    g.lineTo(10.6, -2.4);
    g.lineTo(-2.6, -0.8);
    g.lineTo(-13, -1.4);
    g.closePath();
    paint(g, LZ, -8.4, -0.8);
    poly(g, [-10.4, -8.4, -8.4, -10.6, 2.2, -10.6, 4.2, -8.4], LZ_D);
    cyl(g, 10.2, -6.6, 4.4, 3.6, LZ_L);
    rr(g, 11, -7, 0.9, 4.4, 0.2, LZ_D, { flat: true, line: false });
    rr(g, 12.6, -7, 0.9, 4.4, 0.2, LZ_D, { flat: true, line: false });
    lamp(g, d, 14.8, -4.8, 1.4, LZ_GLOW, 5.5);
    strip(g, d, -11, -6.2, 13, 1.3, LZ_GLOW, 0.26);
    hl(g, -12.6, -7.8, 7, -7.8, 0.45);
  }
  function laserRifle(g, d) {
    g.beginPath();
    g.moveTo(-27, -5.2);
    g.lineTo(-16, -4.2);
    g.lineTo(-16, 2);
    g.lineTo(-23, 4.6);
    g.lineTo(-27, 4.6);
    g.closePath();
    g.moveTo(-25, -2.8);
    g.lineTo(-19, -2.4);
    g.lineTo(-19, 0.4);
    g.lineTo(-25, 2.2);
    g.closePath();
    paint(g, LZ_D, -5.2, 4.6, { rule: 'evenodd' });
    grip(g, [-16.4, 1.4, -12.6, 1.4, -13.6, 9, -17.2, 8.4], LZ_D);
    guard(g, -12.2, 1.6, 4.4, 4, LZ_D);
    rr(g, -10.4, 1.4, 10, 5.6, 1.2, GM_D);
    strip(g, d, -9.2, 3, 7.6, 2, LZ_GLOW, 0.24);
    g.beginPath();
    g.moveTo(-17, -6.6);
    g.lineTo(8, -6.6);
    g.quadraticCurveTo(12.4, -6.4, 13.4, -4.4);
    g.lineTo(13.4, 0.6);
    g.lineTo(-17, 2);
    g.closePath();
    paint(g, LZ, -6.6, 2);
    poly(g, [-11, -6.6, -8.6, -9.4, 5, -9.4, 7.4, -6.6], LZ_D);
    lamp(g, d, 4.8, -8, 0.8, 0xff7a3a, 2.6, 0.4);
    cyl(g, 13.2, -4.4, 13, 3.4, LZ_L);
    for (const x of [15, 18.4, 21.8]) rr(g, x, -5.2, 1.4, 5, 0.3, LZ_D, { flat: true });
    rr(g, 25.4, -5.4, 1.8, 5.4, 0.5, LZ_D);
    lamp(g, d, 27.8, -2.7, 1.5, LZ_GLOW, 6);
    strip(g, d, -14, -4.4, 24, 1.3, LZ_GLOW, 0.24);
    hl(g, -16, -6, 10, -6, 0.45);
  }
  function heavyLaser(g, d) {
    poly(g, [-29, -6, -20, -6, -20, 3.6, -25, 5, -29, 7], LZ_D);
    rr(g, -30, -6.4, 1.6, 13.8, 0.5, GM_D);
    grip(g, [-17.4, 4.6, -13.4, 4.6, -14.6, 12, -18.6, 11.2], LZ_D);
    guard(g, -13, 4.8, 5, 4.2, LZ_D);
    rr(g, -9, 4.4, 13, 6, 1.2, GM_D);
    for (let i = 0; i < 3; i++) strip(g, d, -7.6 + i * 4, 6, 2.6, 2.6, LZ_GLOW, 0.2);
    rr(g, -21, -9.6, 27, 14.4, 2.6, LZ);
    for (let x = -17; x <= 2; x += 3.2) rr(g, x, -12.8, 1.8, 3.4, 0.4, LZ_D);
    strip(g, d, -18, -3.4, 21, 1.4, LZ_GLOW, 0.24);
    cyl(g, 6, -7, 16, 8.4, LZ_L);
    for (const x of [8.4, 12.6, 16.8]) rr(g, x, -7.8, 1.6, 10, 0.4, LZ_D, { flat: true });
    rr(g, 21.6, -9, 5.6, 13, 1.4, LZ_D);
    ell(g, 27.4, -2.5, 1.8, 5, shade(LZ_GLOW, -0.3), { line: LZ_D, lw: 0.6 });
    lamp(g, d, 27.6, -2.5, 1.6, LZ_GLOW, 8, 0.55);
    poly(g, [9, 1.4, 12.6, 1.4, 11.8, 8, 9, 8], POLY);
    hl(g, -20, -9, 5, -9, 0.45);
  }

  // ---- armas alienígenas (orgânicas, púrpura-cinza, brilho verde) ------------------------------------
  // furo do punho em anel (preenchido com evenodd)
  function hole(g, cx, cy, rx, ry, rot) {
    g.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
    g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
  }
  function plasmaPistol(g, d) {
    g.beginPath();
    g.moveTo(-12.6, -4.6);
    g.bezierCurveTo(-12.2, -9.4, -4, -9.8, 4, -8.4);
    g.bezierCurveTo(9, -7.6, 13.6, -6.2, 13.8, -3.6);
    g.bezierCurveTo(13.8, -1.2, 10, -0.8, 5, -0.6);
    g.bezierCurveTo(1, -0.4, -1.2, 1.2, -2.2, 4.4);
    g.bezierCurveTo(-3.2, 8, -5.2, 9.8, -8.6, 9.6);
    g.bezierCurveTo(-12, 9.4, -13.4, 6.6, -13.2, 2.4);
    g.closePath();
    hole(g, -7.4, 3.8, 2.1, 3.1, -0.35);
    paint(g, AL, -9.8, 9.8, { rule: 'evenodd' });
    qc(g, [-9.6, -6.6, -2, -8.6, 8, -6.4], AL_L, 0.8, 0.8);
    qc(g, [-11, -2.4, -4, -1.6, 2, -2], AL_D, 0.7, 0.9);
    glowLine(g, d, [-6, -4.4, 0, -4.8, 6, -4.2, 10.6, -3.8], AG, 1.1, 0.22);
    lamp(g, d, 13.4, -3.6, 1.3, AG, 5);
    ball(g, -10, -4.2, 2.6, AL_L);
    lamp(g, d, -10, -4.2, 1.1, AG, 3, 0.3);
  }
  function plasmaRifle(g, d) {
    g.beginPath();
    g.moveTo(-26.4, -2);
    g.bezierCurveTo(-26.4, -7, -20, -8.2, -14, -7.6);
    g.bezierCurveTo(-4, -6.8, 10, -6.4, 22, -4.8);
    g.bezierCurveTo(26, -4.2, 28.4, -3.2, 28.4, -1.6);
    g.bezierCurveTo(28.4, 0, 25, 0.6, 20, 0.6);
    g.bezierCurveTo(10, 0.8, 0, 1.2, -4, 1.6);
    g.bezierCurveTo(-6, 2, -7, 4.6, -7.8, 7.4);
    g.bezierCurveTo(-8.4, 9.6, -11, 10.4, -13.4, 10);
    g.bezierCurveTo(-15.6, 9.6, -16, 7.6, -15.6, 5.4);
    g.bezierCurveTo(-15.2, 3.2, -17, 2.6, -20, 2.6);
    g.bezierCurveTo(-24, 2.6, -26.4, 1, -26.4, -2);
    g.closePath();
    hole(g, -11.6, 5.2, 1.8, 2.8, 0.25);
    paint(g, AL, -8.2, 10.4, { rule: 'evenodd' });
    g.beginPath();
    g.moveTo(-14, -7.5);
    g.bezierCurveTo(-11, -10.6, -2, -10.4, 9, -6.6);
    g.lineTo(-14, -7.5);
    g.closePath();
    paint(g, AL_D, -10.4, -6.6);
    qc(g, [-20, -6, 0, -6.4, 22, -4], AL_L, 0.8, 0.7);
    for (const x of [14, 17, 20]) qc(g, [x, -5.6, x + 0.8, -2.4, x, 0.4], AL_D, 0.7, 0.9);
    glowLine(g, d, [-13, -3.2, -4, -3.2, 5, -3, 12, -2.6], AG, 1.2, 0.2);
    lamp(g, d, 28, -1.6, 1.5, AG, 6);
    ball(g, -21.4, -2.4, 3.4, AL_D);
    lamp(g, d, -21.4, -2.4, 1.7, AG, 4.5, 0.35);
  }
  function heavyPlasma(g, d) {
    g.beginPath();
    g.moveTo(-28.6, -1);
    g.bezierCurveTo(-28.6, -8.6, -20, -10.6, -12, -9.4);
    g.bezierCurveTo(-2, -8.2, 12, -7.8, 22, -6.2);
    g.bezierCurveTo(26, -5.6, 29, -4, 29, -1.6);
    g.bezierCurveTo(29, 1, 25, 2, 20, 2);
    g.bezierCurveTo(10, 2.2, 0, 2.8, -3, 3.4);
    g.bezierCurveTo(-5.4, 4, -6.4, 7, -7.4, 9.6);
    g.bezierCurveTo(-8.2, 11.8, -11, 12.4, -13.4, 12);
    g.bezierCurveTo(-15.8, 11.4, -16.2, 9.2, -15.6, 7);
    g.bezierCurveTo(-15, 4.6, -17.4, 4.2, -20, 4.4);
    g.bezierCurveTo(-25, 4.6, -28.6, 3, -28.6, -1);
    g.closePath();
    hole(g, -11.4, 7, 1.9, 3, 0.25);
    paint(g, AL, -10.6, 12.4, { rule: 'evenodd' });
    g.beginPath();
    g.moveTo(-18, -9.8);
    g.bezierCurveTo(-14, -14, -2, -14.4, 12, -7.8);
    g.lineTo(-18, -9.8);
    g.closePath();
    paint(g, AL_D, -14.4, -7.8);
    for (const x of [-8, -2, 4]) qc(g, [x, -11.6, x + 1.6, -10, x + 2.6, -8.6], AL_L, 0.6, 0.7);
    rr(g, 19, -9.2, 10.6, 2.8, 1.4, AL_D);
    rr(g, 19, 2, 10.6, 2.8, 1.4, AL_D);
    lamp(g, d, 29.6, -7.8, 1, AG, 3.6, 0.35);
    lamp(g, d, 29.6, 3.4, 1, AG, 3.6, 0.35);
    qc(g, [-24, -7, 0, -8, 24, -5.4], AL_L, 0.9, 0.6);
    glowLine(g, d, [-14, -3.6, -4, -3.8, 6, -3.4, 14, -3], AG, 1.5, 0.22);
    lamp(g, d, 28.6, -1.6, 1.8, AG, 7.5);
    ball(g, -22, -1.6, 4.6, AL_D);
    lamp(g, d, -22, -1.6, 2.2, AG, 6, 0.38);
  }
  function plasmaClip(kind) {
    return function (g, d) {
      const w = kind === 2 ? 7 : kind === 1 ? 5.8 : 5, h = kind === 2 ? 7.4 : kind === 1 ? 8 : 6.8;
      rrPath(g, -w, -h, w * 2, h * 2, w);
      paint(g, AL, -h, h, { hi: 0.36 });
      rr(g, -w * 0.8, -h - 1.4, w * 1.6, 2.6, 1.2, AL_D);
      rr(g, -w * 0.8, h - 1.2, w * 1.6, 2.6, 1.2, AL_D);
      const n = kind === 1 ? 2 : 1, wh = kind === 2 ? h * 1.1 : (h * 1.2) / n;
      for (let i = 0; i < n; i++) {
        const y = -wh * n / 2 + i * wh + 0.4;
        rr(g, -w * 0.46, y, w * 0.92, wh - 0.8, w * 0.4, HOLE, { flat: true, line: AL_D, lw: 0.5 });
        strip(g, d, -w * 0.3, y + 0.6, w * 0.6, wh - 2, AG, kind === 2 ? 0.4 : 0.3);
      }
      qc(g, [-w * 0.75, -h * 0.6, -w * 0.9, 0, -w * 0.75, h * 0.6], 0xffffff, 0.6, 0.3);
    };
  }
  function smallLauncher(g, d) {
    g.beginPath();
    g.moveTo(-24, -3.6);
    g.bezierCurveTo(-24, -7.6, -18, -8, -12, -7);
    g.lineTo(18, -6);
    g.bezierCurveTo(21, -8.6, 24, -9, 25, -8.4);
    g.lineTo(25, 4.2);
    g.bezierCurveTo(24, 4.8, 21, 4.6, 18, 2.4);
    g.lineTo(-2, 2.6);
    g.bezierCurveTo(-4, 3, -5, 5.6, -5.8, 8);
    g.bezierCurveTo(-6.6, 10.2, -9.2, 10.8, -11.4, 10.4);
    g.bezierCurveTo(-13.6, 9.8, -14, 7.8, -13.6, 5.6);
    g.bezierCurveTo(-13.2, 3.6, -15, 3, -18, 3);
    g.bezierCurveTo(-22, 3, -24, 1.4, -24, -3.6);
    g.closePath();
    hole(g, -9.6, 5.8, 1.7, 2.7, 0.25);
    paint(g, AL, -9, 10.8, { rule: 'evenodd' });
    for (const x of [-4, 2, 8, 14]) qc(g, [x, -6.6, x + 1, -2, x, 2.4], AL_D, 1.1, 0.9);
    ell(g, 25, -2.1, 1.8, 6.2, HOLE, { flat: true, line: AL_D });
    lamp(g, d, 24.6, -2.1, 1.3, STUN, 4.5, 0.35);
    rr(g, -10, -10.4, 10, 3.6, 1.8, AL_D);
    lamp(g, d, -1.6, -8.6, 1, AG, 3.4, 0.4);
    qc(g, [-20, -6.4, 0, -6.8, 18, -5.4], AL_L, 0.8, 0.7);
    ball(g, -19.4, -2.4, 3, AL_D);
    lamp(g, d, -19.4, -2.4, 1.3, STUN, 3.6, 0.3);
  }
  function stunBomb(g, d) {
    for (const a of [0.6, 2.2, 3.8, 5.4]) ln(g, [Math.cos(a) * 4, Math.sin(a) * 4, Math.cos(a) * 7, Math.sin(a) * 7], AL_D, 1.6);
    ball(g, 0, 0, 5.6, AL);
    g.save();
    ellPath(g, 0, 0, 5.6, 5.6);
    g.clip();
    strip(g, d, -6, -1, 12, 2, STUN, 0.35);
    g.restore();
    lamp(g, d, 0, 0, 1.2, STUN, 4, 0.4);
  }
  function blasterLauncher(g, d) {
    g.beginPath();
    g.moveTo(-17, -6.4);
    g.lineTo(24, -5);
    g.bezierCurveTo(27, -7, 30, -7, 31, -5.6);
    g.lineTo(31, 2.4);
    g.bezierCurveTo(30, 3.8, 27, 3.8, 24, 1.8);
    g.lineTo(-2, 3);
    g.bezierCurveTo(-4.4, 3.4, -5.4, 6.4, -6.2, 8.8);
    g.bezierCurveTo(-7, 11, -9.6, 11.6, -11.8, 11.2);
    g.bezierCurveTo(-14, 10.6, -14.4, 8.6, -14, 6.4);
    g.lineTo(-17, 4.4);
    g.closePath();
    hole(g, -10, 6.8, 1.7, 2.7, 0.25);
    paint(g, AL, -7, 11.6, { rule: 'evenodd' });
    for (let x = 0; x < 22; x += 3.4) qc(g, [x, -5.6, x + 0.8, -1.4, x, 2.6], AL_D, 0.8, 0.85);
    ell(g, 31, -1.6, 1.4, 4.4, HOLE, { flat: true, line: AL_D });
    ball(g, -21, -1, 9.4, AL, { ry: 8.6 });
    ell(g, -21, -1, 5.6, 5.2, AL_D, { lw: 0.6 });
    lamp(g, d, -21, -1, 2.6, AG, 7, 0.38);
    rr(g, -2, -9.4, 16, 3.4, 1.7, AL_D);
    for (let i = 0; i < 3; i++) lamp(g, d, 0.8 + i * 5, -7.7, 0.9, AG, 3, 0.4);
    qc(g, [-12, -5.6, 8, -5.4, 24, -4.2], AL_L, 0.8, 0.6);
  }
  function blasterBomb(g, d) {
    poly(g, [-9, -2, -13, -6, -14.6, -6, -12.4, -1.4], AL_D);
    poly(g, [-9, 2, -13, 6, -14.6, 6, -12.4, 1.4], AL_D);
    ball(g, 0, 0, 10.4, AL, { ry: 5.2, hi: 0.42 });
    ln(g, [-3, -5, -3.4, 5], AL_D, 0.7, 0.9);
    ln(g, [3.6, -4.8, 4, 4.8], AL_D, 0.7, 0.9);
    lamp(g, d, 9.6, 0, 1.8, AG, 6, 0.45);
    strip(g, d, -8.4, -0.7, 4.6, 1.4, AG, 0.25);
  }

  // ---- corpo a corpo, explosivos, equipamento --------------------------------------------------------
  function stunRod(g, d) {
    cyl(g, -23, -2.6, 14, 5.2, POLY, { r: 1.2 });
    for (let x = -21; x < -10; x += 2.2) ln(g, [x, -2.2, x, 2.2], 0xffffff, 0.5, 0.12);
    rr(g, -9, -4.2, 2.6, 8.4, 0.8, OR);
    cyl(g, -6.4, -1.7, 22, 3.4, STEEL);
    rr(g, 15.6, -2.6, 2.6, 5.2, 0.6, GM_D);
    ln(g, [18, -1.8, 22, -2.2], STEEL, 1);
    ln(g, [18, 1.8, 22, 2.2], STEEL, 1);
    ln(g, [19.4, -2.4, 20.6, -0.6, 19.6, 0.4, 21, 2.2], mix(STUN, 0xffffff, 0.5), 0.6);
    d.glow(20.6, 0, 6, STUN, 0.55);
    hl(g, -5.6, -1, 15, -1, 0.4);
  }
  function grenade(g) {
    g.save();
    ellPath(g, 0, 2.6, 6.2, 7.2);
    g.clip();
    ball(g, 0.4, 3, 7.4, OLIVE, { line: false });
    for (let y = -2; y < 10; y += 2.6) ln(g, [-7, y, 7, y], shade(OLIVE, -0.5), 0.6, 0.85);
    for (let x = -4.2; x < 6; x += 2.8) ln(g, [x, -4, x, 10], shade(OLIVE, -0.5), 0.6, 0.85);
    g.restore();
    ellPath(g, 0, 2.6, 6.2, 7.2);
    edge(g, OLIVE, NO);
    rr(g, -2.6, -6.8, 5.2, 3.4, 0.6, GM);
    poly(g, [1.8, -6.6, 5.2, -5.6, 6.4, 1, 5.4, 1.2, 4.2, -4.4], STEEL);
    g.beginPath();
    g.arc(-4.8, -6.4, 2.4, 0, TAU);
    g.lineWidth = 0.9;
    g.strokeStyle = css(OR);
    g.stroke();
    ln(g, [-2.6, -5.8, -2.2, -5.6], STEEL, 0.8);
  }
  function smokeGrenade(g) {
    vcyl(g, -4.8, -5.6, 9.6, 14.4, 0x7f878f, { r: 1.2 });
    rr(g, -4.8, -1, 9.6, 2.6, 0, WHITE, { flat: true, line: false });
    vcyl(g, -4.8, -1, 9.6, 2.6, 0xd9dcd8, { line: false });
    for (let x = -2.6; x < 3; x += 2.4) ell(g, x, 6.6, 0.6, 0.6, HOLE, { flat: true, line: false });
    rr(g, -2.4, -8.6, 4.8, 3.2, 0.6, GM);
    poly(g, [1.6, -8.4, 4.6, -7.4, 5.8, -1.6, 4.8, -1.4, 3.8, -6.2], STEEL);
    g.beginPath();
    g.arc(-4.4, -8.2, 2.2, 0, TAU);
    g.lineWidth = 0.9;
    g.strokeStyle = css(OR);
    g.stroke();
  }
  function proximityGrenade(g, d) {
    ell(g, 0, 2.2, 9.2, 4.2, GM_D);
    ell(g, 0, 0.2, 9.2, 4.2, GM, { hi: 0.4 });
    ellPath(g, 0, 0.2, 7, 3);
    g.lineWidth = 0.8;
    g.strokeStyle = css(OR);
    g.stroke();
    ell(g, 0, -0.4, 3.6, 1.9, GM_D);
    lamp(g, d, 0, -0.8, 1.1, 0xff4a3a, 4.5, 0.5);
    ln(g, [5.6, -1.4, 7.6, -6.6], STEEL, 0.6);
    ell(g, 7.6, -6.8, 0.6, 0.6, OR, { flat: true, line: false });
  }
  function highExplosive(g, d) {
    const K = 0xb4a06a;
    poly(g, [-11.4, -3.6, -8.4, -6.8, 12.4, -6.8, 9.4, -3.6], shade(K, 0.2));
    poly(g, [9.4, -3.6, 12.4, -6.8, 12.4, 4.4, 9.4, 7.6], shade(K, -0.32));
    rr(g, -11.4, -3.6, 20.8, 11.2, 0.8, K);
    for (const x of [-6.4, 3.2]) {
      rr(g, x, -3.6, 2.2, 11.2, 0, 0x3b3a30, { flat: true, line: false });
      poly(g, [x, -3.6, x + 2.2, -3.6, x + 5, -6.8, x + 2.8, -6.8], 0x45443a, { flat: true, line: false });
    }
    rr(g, -2.8, -9.8, 6.4, 3.4, 0.6, GM_D);
    lamp(g, d, 1.8, -8.1, 0.9, 0xff5a2a, 3.6, 0.5);
    qc(g, [-1.6, -6.6, -6, -10.8, -9, -7.2], RED, 0.7);
    qc(g, [-0.6, -6.6, -4, -12, -7, -7], 0x3a7fd8, 0.7);
    hazard(g, -9.6, 3.6, 7.4, 2.2, OR, GM_D);
  }
  function alienGrenade(g, d) {
    ball(g, 0, 0, 6.6, AL, { hi: 0.45 });
    g.save();
    ellPath(g, 0, 0, 6.6, 6.6);
    g.clip();
    for (const ry of [2.2, 4.4]) {
      ellPath(g, 0, 0, 6.6, ry);
      g.lineWidth = 0.6;
      g.strokeStyle = css(AL_D);
      g.stroke();
    }
    strip(g, d, -7, -0.6, 14, 1.2, AG, 0.3);
    g.restore();
    lamp(g, d, 0, -4.4, 1.3, AG, 4, 0.45);
  }
  function flare(g, d) {
    cyl(g, -11, -2.8, 4, 5.6, GM_D, { r: 0.8 });
    cyl(g, -7.4, -2.6, 13, 5.2, 0xe2772a);
    for (const x of [-4, 1]) rr(g, x, -2.6, 1, 5.2, 0, shade(0xe2772a, -0.4), { flat: true, line: false });
    d.glow(7, 0, 14, 0xffd27a, 0.55);
    d.glow(7, 0, 6, 0xffffff, 0.6);
    ell(g, 7.2, 0, 2.6, 3, 0xfff4c8, { flat: true, line: 0xffb45a, lw: 0.6 });
  }
  function medikit(g) {
    ln(g, [-5, -7, -4, -10, 4, -10, 5, -7], GM_D, 1.8);
    rr(g, -13, -7.2, 26, 16.4, 2.2, 0xe4e6df);
    rr(g, -13, 4.4, 26, 4.8, 0, 0xb9bdb6, { flat: true, line: false });
    rrPath(g, -13, -7.2, 26, 16.4, 2.2);
    edge(g, 0xe4e6df, NO);
    for (const x of [-12.4, 10.6]) rr(g, x, -6.6, 1.8, 15.2, 0.6, GM_D, { flat: true, line: false });
    rr(g, -3.2, -5.4, 6.4, 12, 0.4, 0x2f9e57, { line: 0xffffff, lw: 0.6 });
    rr(g, -6.2, -2.4, 12.4, 6, 0.4, 0x2f9e57, { line: 0xffffff, lw: 0.6 });
    rr(g, -3, -2.2, 6, 5.6, 0, 0x2f9e57, { flat: true, line: false });
    rr(g, -8.4, -8.2, 3, 2, 0.4, GM_D);
    rr(g, 5.4, -8.2, 3, 2, 0.4, GM_D);
  }
  function motionScanner(g, d) {
    ln(g, [5, -11, 6.4, -15.4], GM_L, 0.9);
    ell(g, 6.5, -15.6, 0.8, 0.8, OR, { flat: true, line: false });
    rr(g, -8.2, -11.4, 16.4, 23, 2.6, GM_D);
    rr(g, -6.4, -9, 12.8, 10.6, 1.2, 0x0b2a2c, { flat: true, line: 0x05090a });
    g.save();
    rrPath(g, -6.4, -9, 12.8, 10.6, 1.2);
    g.clip();
    for (const r of [3, 6, 9]) {
      g.beginPath();
      g.arc(0, 1.6, r, Math.PI, TAU);
      g.lineWidth = 0.5;
      g.strokeStyle = css(TEAL, 0.7);
      g.stroke();
    }
    ln(g, [0, 1.6, 4.6, -6.4], TEAL, 0.6, 0.9);
    g.restore();
    lamp(g, d, -2.4, -4.6, 0.7, OR, 2.4, 0.45);
    lamp(g, d, 3, -2.4, 0.6, OR, 2, 0.4);
    rr(g, -5.8, 3.4, 3, 2, 0.4, OR, { flat: true });
    rr(g, -1.5, 3.4, 3, 2, 0.4, TEAL, { flat: true });
    rr(g, 2.8, 3.4, 3, 2, 0.4, GM_L, { flat: true });
    for (let y = 7; y < 11; y += 1.4) ln(g, [-5.6, y, 5.6, y], 0xffffff, 0.5, 0.12);
    hl(g, -7.2, -10.6, 7.2, -10.6, 0.35);
  }
  function psiAmp(g, d) {
    g.beginPath();
    g.arc(2, 0, 11.4, -2.3, 2.3);
    g.arc(2, 0, 6.6, 2.1, -2.1, true);
    g.closePath();
    paint(g, AL, -11, 11, { hi: 0.4 });
    for (const a of [-1.4, -0.7, 0, 0.7, 1.4]) ln(g, [2 + Math.cos(a) * 7.4, Math.sin(a) * 7.4, 2 + Math.cos(a) * 10.6, Math.sin(a) * 10.6], AL_D, 0.7);
    rr(g, -14.6, -1.8, 9.8, 3.6, 1.8, AL_D);
    ball(g, -15, 0, 2.6, AL);
    lamp(g, d, 2.6, 0, 3, PSI, 11, 0.5);
    for (const a of [-2, 2]) lamp(g, d, 2 + Math.cos(a) * 9, Math.sin(a) * 9, 1.1, PSI, 3.4, 0.4);
  }

  // ---- materiais, componentes e artefactos -------------------------------------------------------------
  function plate(g, p, c) {
    path(g, p);
    const r = yRange(p);
    const gr = g.createLinearGradient(p[0], r[0], p[4], r[1]);
    gr.addColorStop(0, css(shade(c, 0.45)));
    gr.addColorStop(0.35, css(mix(c, 0x9ad8e0, 0.25)));
    gr.addColorStop(0.65, css(mix(c, 0xb08ad8, 0.3)));
    gr.addColorStop(1, css(shade(c, -0.4)));
    g.fillStyle = gr;
    g.fill();
    edge(g, c, NO);
    texture(g, p, 0xffffff, 0.08, 2.2, 0.6);
  }
  function alienAlloys(g) {
    const A = 0x8d93a6;
    plate(g, [-16, 2, -5, -4, 15, -1, 6, 8.6, -13, 9.6], shade(A, -0.15));
    plate(g, [-14, -4.4, -2, -10.6, 16, -6.4, 9, 2.4, -10, 3.4], A);
    plate(g, [-6, -1, 3, -6.4, 13, -3.4, 7, 3, -3.4, 4.2], shade(A, 0.12));
    hl(g, -12.6, -4.8, -2, -10.2, 0.5);
  }
  function crystal(g, x, y, w, h, lean, c) {
    const tx = x + lean, top = y - h;
    poly(g, [x - w, y, tx - w * 0.8, top + w, tx, top, x, y + w * 0.5], shade(c, 0.25), { line: shade(c, -0.6), lw: 0.5 });
    poly(g, [x, y + w * 0.5, tx, top, tx + w * 0.8, top + w, x + w, y], shade(c, -0.25), { line: shade(c, -0.6), lw: 0.5 });
    ln(g, [tx - w * 0.3, top + w * 0.8, x - w * 0.4, y - 0.6], 0xffffff, 0.5, 0.45);
  }
  function elerium(g, d) {
    poly(g, [-10.4, 7.4, -7, 4.6, 7, 4.6, 10.4, 7.4, 7.6, 11.6, -7.6, 11.6], AL_D);
    d.glow(0, 0, 16, ELERIUM, 0.4);
    crystal(g, -5, 6.4, 2.8, 11, -2.4, ELERIUM);
    crystal(g, 4.6, 6.6, 2.6, 10, 2.6, ELERIUM);
    crystal(g, 0, 6.2, 3.4, 17, 0.4, mix(ELERIUM, 0xff9a6a, 0.3));
    crystal(g, -1.6, 7.6, 2, 7, -3.4, mix(ELERIUM, 0xffffff, 0.15));
    crystal(g, 3, 7.8, 1.8, 5.6, 3.6, ELERIUM);
    d.glow(0, -2, 7, 0xffd0dc, 0.4);
  }
  function powerSource(g, d) {
    poly(g, [-12, 14, -8, 8, 8, 8, 12, 14], AL_D);
    rr(g, -9, 6, 18, 3, 0.8, AL);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 6, 7);
      g.quadraticCurveTo(s * 14.6, 0, s * 9, -11);
      g.lineTo(s * 7.4, -10.4);
      g.quadraticCurveTo(s * 11.4, -0.4, s * 3.6, 7);
      g.closePath();
      paint(g, AL, -11, 7);
    }
    d.glow(0, -3, 17, AG, 0.5);
    ball(g, 0, -3, 7.4, 0x6fe88a, { line: 0x2a6a3a, hi: 0.7 });
    ellPath(g, 0, -3, 9.6, 2.8, -0.3);
    g.lineWidth = 0.8;
    g.strokeStyle = css(0xd8ffd8, 0.8);
    g.stroke();
    d.glow(0, -3, 6, 0xffffff, 0.6);
  }
  function navigation(g, d) {
    poly(g, [-13, -2, -9, -6, 13, -6, 9, -2], AL_L);
    poly(g, [9, -2, 13, -6, 13, 8, 9, 12], AL_D);
    rr(g, -13, -2, 22, 14, 0.6, AL);
    poly(g, [-10.4, -6.4, -7, -13, 10.4, -13, 7.6, -6.4], 0x101c18, { flat: true, line: AL_D });
    for (let i = 0; i < 4; i++) ln(g, [-7.6 + i * 0.6, -7.6 - i * 1.4, 2 + i * 1.2 - (i & 1) * 3, -7.6 - i * 1.4], AG, 0.5, 0.75);
    d.glow(0, -9.6, 8, AG, 0.25);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
      const c = (i + r) % 3 === 0 ? PSI : (i + r) % 3 === 1 ? AG : 0xffc04a;
      lamp(g, d, -10 + i * 4, 2 + r * 4.4, 0.9, c, 2.4, 0.35);
    }
    hl(g, -12.4, -1.4, 8.4, -1.4, 0.35);
  }
  function alienFood(g) {
    vcyl(g, -7.6, -10, 15.2, 21, 0x7d8a34, { line: false });
    g.save();
    rrPath(g, -7.6, -10, 15.2, 21, 0);
    g.clip();
    for (const [x, y, r] of [[-3, -4, 2.6], [3, 1, 3.2], [-2, 6, 2.2], [4, -7, 1.6], [-4.4, 1.4, 1.4]]) ball(g, x, y, r, 0x5a5a24, { line: false });
    rr(g, -7.6, -10, 15.2, 3, 0, 0xc8e080, { flat: true, a: 0.25, line: false });
    g.restore();
    rrPath(g, -7.6, -10, 15.2, 21, 0);
    edge(g, 0x5f6a30, NO);
    ln(g, [-5, -8, -5, 9], 0xffffff, 1.2, 0.35);
    ln(g, [-3.4, -8, -3.4, 4], 0xffffff, 0.5, 0.3);
    vcyl(g, -8.6, -13, 17.2, 3.4, AL, { r: 1 });
    vcyl(g, -8.6, 10.6, 17.2, 3.4, AL, { r: 1 });
  }
  function alienSurgery(g, d) {
    poly(g, [-12, 13, -9, 9, 9, 9, 12, 13], AL_D);
    vcyl(g, -2.4, -2, 4.8, 11.4, AL);
    limb(g, [0, -1, -8, -7, -2, -13], AL_L, 2.2);
    ell(g, -8, -7, 1.8, 1.8, AL_D);
    for (const a of [-0.5, 0.3, 1.1]) ln(g, [-2, -13, -2 + Math.cos(a) * 5, -13 + Math.sin(a) * 5], STEEL, 0.8);
    lamp(g, d, -2, -13, 1.1, 0xff5a4a, 3.6, 0.45);
    rr(g, 3, 1, 10, 2.2, 0.6, AL);
    for (let i = 0; i < 3; i++) ln(g, [4.6 + i * 3, 0.6, 5.6 + i * 3, -2.6], STEEL, 0.7);
    lamp(g, d, 0, 4, 0.9, AG, 3, 0.35);
  }
  function examRoom(g, d) {
    poly(g, [-6, 10, -3, 4, 5, 4, 8, 10], AL_D);
    vcyl(g, -1.4, -1, 3.6, 6, AL);
    poly(g, [-16, -4, -12, -6.4, 8, -2.4, 16, -6.6, 17, -4.4, 9, 1, -13, -1], AL_L);
    for (const x of [-7, 1]) ln(g, [x, -4.6, x + 1, -0.6], 0x302838, 1.2);
    ln(g, [-14, -10, -14, -5], AL_D, 1.2);
    ln(g, [-14, -10, 14, -10.6], AL_D, 1.2);
    for (let i = 0; i < 3; i++) lamp(g, d, -6 + i * 7, -10.3, 0.9, AG, 3, 0.35);
    lamp(g, d, 16.2, -5.6, 1, PSI, 3, 0.4);
  }
  function reproduction(g, d) {
    vcyl(g, -7, 10, 14, 4, AL_D, { r: 1 });
    ellPath(g, 0, -2.6, 9, 12.4);
    const rg = g.createRadialGradient(-2.6, -6, 1, 0, -2.6, 12.4);
    rg.addColorStop(0, css(0xf4b0c8));
    rg.addColorStop(0.6, css(0xb86a8e));
    rg.addColorStop(1, css(0x5a2a44));
    g.fillStyle = rg;
    g.fill();
    g.beginPath();
    g.moveTo(2.6, -6);
    g.bezierCurveTo(-3.6, -8.6, -5, 2, 0, 3.6);
    g.bezierCurveTo(3, 4.4, 4, 0.6, 1.4, -0.4);
    g.bezierCurveTo(-0.6, -1, 0.4, -3.6, 2.6, -2.6);
    g.closePath();
    paint(g, 0x6a2a48, -8, 4, { flat: true, a: 0.75, line: false });
    for (const [x, y, r] of [[4, -9, 0.8], [5.4, -4, 0.6], [-4.6, 1, 0.7], [3, 4, 0.5]]) {
      ellPath(g, x, y, r, r);
      g.lineWidth = 0.4;
      g.strokeStyle = css(0xffffff, 0.6);
      g.stroke();
    }
    ellPath(g, 0, -2.6, 9, 12.4);
    edge(g, 0x5a2a44, NO);
    ln(g, [-5.4, -9, -6.4, -1.6], 0xffffff, 1, 0.35);
    vcyl(g, -4, -16, 8, 2.6, AL_D, { r: 1 });
    d.glow(0, -2.6, 12, 0xff8ac0, 0.25);
  }
  function entertainment(g, d) {
    ell(g, 0, 12, 10, 2.6, AL_D);
    vcyl(g, -8, 8, 16, 4, AL, { r: 1.4 });
    g.beginPath();
    g.moveTo(-3, 8);
    g.bezierCurveTo(-8, 2, 5, -2, -1, -8);
    g.bezierCurveTo(-4, -11, 1, -14, 0, -16);
    g.bezierCurveTo(3, -13, 2, -10, 4, -7);
    g.bezierCurveTo(8, -1, -3, 2, 3, 8);
    g.closePath();
    paint(g, 0x8a6ab8, -16, 8);
    lamp(g, d, -7, -6, 1.6, AG, 4.6, 0.45);
    lamp(g, d, 7.4, -9, 1.4, PSI, 4.4, 0.45);
    lamp(g, d, 5, 0.6, 1.2, LZ_GLOW, 3.8, 0.45);
    d.glow(0, -6, 10, 0xb08aff, 0.2);
  }

  // ---- cadáveres (deitados, vistos de cima, cabeça à esquerda) -------------------------------------------
  function torso(g, x0, x1, w0, w1, c) {
    g.beginPath();
    g.moveTo(x0 + 1.6, -w0);
    g.lineTo(x1, -w1);
    g.quadraticCurveTo(x1 + 2, 0, x1, w1);
    g.lineTo(x0 + 1.6, w0);
    g.quadraticCurveTo(x0 - 1.2, w0, x0 - 1, 0);
    g.quadraticCurveTo(x0 - 1.2, -w0, x0 + 1.6, -w0);
    g.closePath();
    paint(g, c, -w0, w0);
  }
  function humanCorpse(o) {
    return function (g) {
      limb(g, [3.4, -2.8, 12, -4.4, 19.4, -5.6], o.legs, 3.6);
      limb(g, [3.4, 2.8, 12, 4.2, 19.6, 6.4], o.legs, 3.6);
      ell(g, 21, -5.8, 1.7, 2.3, o.boot);
      ell(g, 21.2, 6.6, 1.7, 2.3, o.boot);
      limb(g, [-9.6, -6, -3, -8.2, 3.6, -8.8], o.arms || o.suit, 2.8);
      limb(g, [-9.6, 6, -2.6, 8.4, 3.4, 9.6], o.arms || o.suit, 2.8);
      ell(g, 4.8, -8.9, 1.5, 1.5, o.hand || o.skin);
      ell(g, 4.6, 9.8, 1.5, 1.5, o.hand || o.skin);
      torso(g, -11.4, 4.6, 6.6, 4.4, o.suit);
      if (o.belt) rr(g, 2.4, -4.6, 1.4, 9.2, 0, o.belt, { flat: true, line: false });
      if (o.torn) for (const [x, y] of [[-5, -3], [-1, 2.6], [-7, 3]]) ell(g, x, y, 1.4, 0.9, shade(o.suit, -0.45), { flat: true, line: false });
      ell(g, -12.6, 0, 1.8, 2.6, shade(o.skin, -0.15), { line: false });
      ball(g, -16.4, 0, 4.4, o.skin, { ry: 3.9 });
      g.save();
      ellPath(g, -16.4, 0, 4.4, 3.9);
      g.clip();
      ell(g, -20.4, 0, 3.6, 4.6, o.hair, { line: false });
      g.restore();
      ln(g, [-15.6, -2.2, -15.4, -0.9], shade(o.skin, -0.6), 0.6);
      ln(g, [-15.6, 0.9, -15.4, 2.2], shade(o.skin, -0.6), 0.6);
    };
  }
  function sectoidCorpse(g) {
    const S = 0xa9a79d;
    limb(g, [2.6, -2, 10, -3.4, 15.6, -5], S, 2);
    limb(g, [2.6, 2, 10, 3.2, 15.8, 5.4], S, 2);
    limb(g, [-7.4, -4.6, -2, -7.2, 3.4, -8], S, 1.7);
    limb(g, [-7.4, 4.6, -1.6, 7.4, 3.2, 8.6], S, 1.7);
    for (const s of [-1, 1]) for (const a of [-0.5, 0, 0.5]) ln(g, [3.4, s * (8.2 + (s > 0 ? 0.4 : 0)), 3.4 + Math.cos(a) * 2, s * (8.2 + Math.sin(a) * 1.4)], S, 0.7);
    torso(g, -8.4, 3.6, 4.4, 3, S);
    ball(g, -14.4, 0, 6.6, S, { ry: 5.8 });
    for (const s of [-1, 1]) ell(g, -13.6, s * 2.6, 2.6, 1.3, 0x0b0a0e, { rot: s * 0.55, line: false });
    ln(g, [-10, -0.6, -10, 0.6], shade(S, -0.5), 0.6);
  }
  function floaterCorpse(g, d) {
    const S = 0xa06c7e, M = 0x3a4048;
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * TAU, r = 6.4 + (i & 1 ? 1.4 : 0);
      const x = 8 + Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    paint(g, 0x7a3a5a, -8, 8);
    ball(g, 8, 0, 5, M);
    lamp(g, d, 8, 0, 1.2, 0x5a3040, 0);
    limb(g, [-8, -5, -2, -8, 2.6, -9.6], S, 1.8);
    limb(g, [-8, 5, -1.6, 8.2, 2.4, 10], S, 1.8);
    torso(g, -10, 3.6, 5.8, 4, S);
    poly(g, [-8.4, -3.4, -2, -4, -2, 4, -8.4, 3.4], M, { hi: 0.4 });
    ball(g, -14.4, 0, 4.6, S, { ry: 4.2 });
    poly(g, [-14, -3.4, -11, -2, -11, 2, -14, 3.4], M);
    for (const s of [-1, 1]) ell(g, -15.6, s * 1.8, 0.9, 0.7, 0x2a0812, { flat: true, line: false });
  }
  function snakemanCorpse(g) {
    const S = 0x98a23a;
    g.beginPath();
    g.moveTo(2, 0);
    g.bezierCurveTo(10, -10, 14, 8, 22, -2);
    g.lineCap = 'round';
    for (const [w, c] of [[7.6, shade(S, -0.66)], [6.4, S], [2, shade(S, 0.3)]]) {
      g.lineWidth = w;
      g.strokeStyle = css(c);
      g.stroke();
    }
    ell(g, 22.4, -2.2, 1.6, 1.4, shade(S, -0.2));
    limb(g, [-8, -4.2, -3, -6.4, 1.6, -7], S, 1.8);
    limb(g, [-8, 4.2, -2.6, 6.6, 1.4, 7.6], S, 1.8);
    torso(g, -9, 3, 4.8, 3.4, S);
    for (let x = -6; x < 2; x += 2.6) qc(g, [x, -2.6, x + 1.4, 0, x, 2.6], shade(S, -0.35), 0.5);
    g.beginPath();
    g.moveTo(-10, -3.4);
    g.quadraticCurveTo(-21, -3, -22, 0);
    g.quadraticCurveTo(-21, 3, -10, 3.4);
    g.closePath();
    paint(g, S, -3.4, 3.4, { hi: 0.4 });
    for (const s of [-1, 1]) ell(g, -15, s * 2.4, 1, 0.6, 0xffd23a, { line: 0x2a2a08, lw: 0.4 });
  }
  function mutonCorpse(g) {
    const SK = 0x63a23c, SU = 0x3d5d30, PL = 0x6e7d6a;
    limb(g, [4, -3.6, 12.6, -5.2, 20, -6.4], SU, 4.6);
    limb(g, [4, 3.6, 12.6, 5.2, 20.2, 7], SU, 4.6);
    ell(g, 21.4, -6.6, 2, 2.6, 0x2c3a26);
    ell(g, 21.6, 7.2, 2, 2.6, 0x2c3a26);
    limb(g, [-9, -8, -2.6, -10.6, 4, -11], SK, 3.8);
    limb(g, [-9, 8, -2.2, 10.6, 3.8, 11.6], SK, 3.8);
    torso(g, -12, 5, 9, 6, SU);
    rr(g, -10, -5, 9, 10, 2, PL);
    for (const s of [-1, 1]) ell(g, -9, s * 8, 2.8, 2.4, PL);
    ball(g, -16, 0, 4.6, SK);
    for (const s of [-1, 1]) ell(g, -16.4, s * 1.7, 0.8, 0.6, 0x200a08, { flat: true, line: false });
  }
  function etherealCorpse(g) {
    const R = 0xc89a34, F = 0xd8c6b4, T = 0x5a2a3a;
    // túnica que alarga até à bainha, cinto e braços cruzados sobre o peito
    g.beginPath();
    g.moveTo(-11.4, -6.2);
    g.quadraticCurveTo(4, -7, 17.6, -9.4);
    g.quadraticCurveTo(20.6, 0, 17.6, 9.4);
    g.quadraticCurveTo(4, 7, -11.4, 6.2);
    g.quadraticCurveTo(-13.4, 0, -11.4, -6.2);
    g.closePath();
    paint(g, R, -9.4, 9.4);
    g.save();
    g.clip();
    g.beginPath();
    g.moveTo(15.4, -12);
    g.quadraticCurveTo(18.2, 0, 15.4, 12);
    g.lineTo(24, 12);
    g.lineTo(24, -12);
    g.closePath();
    g.fillStyle = css(T);
    g.fill();
    g.restore();
    for (const y of [-4.4, 4.4]) qc(g, [4, y * 0.85, 10, y * 1.05, 15.4, y * 1.5], shade(R, -0.4), 0.55, 0.75);
    rr(g, 2.6, -7.4, 2.2, 14.8, 0.6, T);
    limb(g, [-9.4, -5.4, -5, -4.6, -1.4, -1.2], shade(R, -0.12), 2.8);
    limb(g, [-9.4, 5.4, -5, 4.6, -1.4, 1.2], shade(R, -0.12), 2.8);
    ell(g, -0.6, -1, 1.3, 1.1, F);
    ell(g, -0.6, 1, 1.3, 1.1, F);
    rr(g, -13.4, -5, 3.6, 10, 1.8, T);
    ball(g, -17, 0, 4.6, F, { ry: 4 });
    g.save();
    ellPath(g, -17, 0, 4.6, 4);
    g.clip();
    ell(g, -21.4, 0, 3.8, 5.6, 0x2a1830, { line: false });
    g.restore();
    for (const sd of [-1, 1]) ell(g, -16.2, sd * 1.6, 1.1, 0.7, 0x1e1028, { flat: true, line: false, rot: sd * 0.3 });
    ln(g, [-13.4, -0.7, -13.4, 0.7], shade(F, -0.45), 0.5);
  }
  function chryssalidCorpse(g) {
    const SH = 0x262a3e, S2 = 0x31354c, CL = 0xb4a98c;
    for (const s of [-1, 1]) {
      limb(g, [4, s * 3, 10, s * 8, 16, s * 6, 20, s * 9], SH, 1.8);
      limb(g, [-6, s * 3.6, -10, s * 9, -16, s * 9.6], SH, 1.8);
      poly(g, [-16, s * 9.6, -22, s * 7.4, -17.4, s * 10.8], CL, { lw: 0.5 });
      poly(g, [-16, s * 9.6, -21, s * 11.4, -15.6, s * 11], CL, { lw: 0.5 });
    }
    ball(g, 8, 0, 6.6, S2, { ry: 5 });
    for (const x of [5, 8, 11]) qc(g, [x, -4.6, x + 1.4, 0, x, 4.6], SH, 0.7);
    ball(g, -3, 0, 5, SH, { ry: 4.4 });
    g.beginPath();
    g.moveTo(-6.6, -2.6);
    g.quadraticCurveTo(-16, -2.4, -18, 0);
    g.quadraticCurveTo(-16, 2.4, -6.6, 2.6);
    g.closePath();
    paint(g, S2, -2.6, 2.6, { hi: 0.4 });
    for (const s of [-1, 1]) ell(g, -12, s * 1.6, 0.8, 0.6, 0x7a2a1a, { flat: true, line: false });
  }
  function reaperCorpse(g) {
    const F = 0xc4582a;
    for (const s of [-1, 1]) {
      limb(g, [8, s * 5, 15, s * 10, 22, s * 9], shade(F, -0.1), 4.4);
      for (const a of [-0.5, 0, 0.5]) ln(g, [22, s * 9, 22 + Math.cos(a) * 3, s * (9 + Math.sin(a) * 2)], 0xe8dcc0, 0.8);
    }
    poly(g, [16, -2, 24, -1, 24, 1, 16, 2], shade(F, -0.2));
    ball(g, 5, 0, 12.6, F, { ry: 8 });
    for (let x = -2; x < 14; x += 3.4) qc(g, [x, -7, x + 2, 0, x, 7], shade(F, -0.38), 0.9);
    ball(g, -13, 0, 8.6, shade(F, 0.08), { ry: 7.4 });
    g.beginPath();
    g.moveTo(-15, -4.6);
    g.quadraticCurveTo(-24, -3, -23, 0);
    g.quadraticCurveTo(-24, 3, -15, 4.6);
    g.quadraticCurveTo(-17, 0, -15, -4.6);
    g.closePath();
    paint(g, 0x3a0c0a, -4.6, 4.6, { flat: true, line: 0x1a0505 });
    for (let i = 0; i < 4; i++) {
      const x = -22 + i * 2;
      poly(g, [x, -2.6 - i * 0.3, x + 0.9, -1.2, x + 1.8, -2.6 - i * 0.3], 0xf0e6cc, { flat: true, line: false });
      poly(g, [x, 2.6 + i * 0.3, x + 0.9, 1.2, x + 1.8, 2.6 + i * 0.3], 0xf0e6cc, { flat: true, line: false });
    }
    for (const s of [-1, 1]) ell(g, -11, s * 4.6, 1, 0.8, 0xffd84a, { line: 0x3a1a05, lw: 0.4 });
  }
  function cyberdiscCorpse(g, d) {
    const M = 0x8d949c, R = 0x5a6068;
    ell(g, 0, 2, 21, 10, R);
    ell(g, -1, 0, 20, 9.4, M, { hi: 0.4 });
    poly(g, [8, -8, 18, -12, 23, -5, 13, -2], M);
    ln(g, [8, -8, 13, -2], HOLE, 1.2);
    ell(g, -3, -1, 8, 4.4, R);
    ell(g, -3, -1.6, 5.4, 2.8, shade(M, -0.15));
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * 0.85 + i * 0.32;
      ell(g, -1 + Math.cos(a) * 15, Math.sin(a) * 6.8, 1, 0.8, 0x2b5f6c, { flat: true, line: false });
    }
    ln(g, [-14, -3, -8, 1, -10, 5], HOLE, 0.8);
    ln(g, [4, 3, 9, 6, 7, 9], HOLE, 0.8);
    ell(g, 6, 2, 3.4, 1.8, 0x1a1a1a, { flat: true, a: 0.45, line: false });
    lamp(g, d, 13, -3, 0.9, 0xff8a3a, 3.4, 0.5);
  }
  function sectopodCorpse(g, d) {
    const M = 0x7d8693;
    limb(g, [2, 4, 10, 10, 20, 8], M, 4.2);
    ell(g, 21, 8, 3, 2.4, shade(M, -0.3));
    limb(g, [-2, -4, 6, -11, 16, -12], M, 4.2);
    ell(g, 17, -12, 3, 2.4, shade(M, -0.3));
    ln(g, [-4, 2, -10, 9, -9, 12], OR, 0.7);
    ln(g, [-3, 3, -7, 10], TEAL, 0.7);
    rr(g, -19, -8, 22, 15, 5, M, { hi: 0.4 });
    rr(g, -15, -5, 13, 8, 3, shade(M, -0.25));
    ell(g, -20, -0.6, 2.6, 4.4, 0x3a1a18, { line: 0x1a0a08 });
    ell(g, -20.4, -1.4, 0.8, 1.4, 0x8a3a30, { flat: true, line: false });
    lamp(g, d, 0, 4, 0.8, 0xffb04a, 3, 0.45);
  }

  // ---- armaduras em armazém -------------------------------------------------------------------------
  function vest(g, suit, plateC) {
    g.beginPath();
    g.moveTo(-5.6, -12);
    g.quadraticCurveTo(0, -7.4, 5.6, -12);
    g.lineTo(12.6, -9.6);
    g.quadraticCurveTo(9.4, -4, 10.4, 0);
    g.lineTo(10.4, 13);
    g.lineTo(-10.4, 13);
    g.lineTo(-10.4, 0);
    g.quadraticCurveTo(-9.4, -4, -12.6, -9.6);
    g.closePath();
    paint(g, suit, -12, 13);
    rr(g, -8.6, -6.6, 8, 10, 2, plateC);
    rr(g, 0.6, -6.6, 8, 10, 2, plateC);
    for (let i = 0; i < 3; i++) rr(g, -8, 4.4 + i * 2.8, 16, 2.4, 0.8, shade(plateC, -0.12));
    for (const s of [-1, 1]) ell(g, s * 11, -9.6, 3.4, 2.4, plateC, { rot: s * 0.4 });
  }
  function personalArmour(g) {
    vest(g, 0x46583f, 0x80996f);
    ln(g, [-10.4, 1, -12.4, 1.6], 0x2c3426, 1.2);
    ln(g, [10.4, 1, 12.4, 1.6], 0x2c3426, 1.2);
  }
  function suitBust(P) {
    return function (g, d) {
      if (P.wings) for (const s of [-1, 1]) poly(g, [s * 9, -2, s * 17, -9, s * 16, 2, s * 10, 6], P.plate);
      g.beginPath();
      g.moveTo(-9, -2);
      g.lineTo(9, -2);
      g.lineTo(11, 15);
      g.lineTo(-11, 15);
      g.closePath();
      paint(g, P.suit, -2, 15);
      poly(g, [-7.6, 0, 7.6, 0, 6, 9, 0, 11.6, -6, 9], P.plate, { hi: 0.4 });
      ln(g, [-5.4, 2.6, 0, 8.8, 5.4, 2.6], P.trim, 0.7, 0.9);
      for (const s of [-1, 1]) ball(g, s * 11.6, 1.6, 5.4, P.plate, { ry: 4.6 });
      if (P.pack) for (const s of [-1, 1]) lamp(g, d, s * 15.4, 6, 1, P.visor, 3.4, 0.4);
      rr(g, -6, -4, 12, 3.4, 1.2, shade(P.trim, -0.2));
      ball(g, 0, -10.6, 7.6, P.plate, { ry: 7.2 });
      rrPath(g, -5.4, -12.4, 10.8, 4, 2);
      g.fillStyle = css(shade(P.visor, -0.25));
      g.fill();
      strip(g, d, -4.8, -12, 9.6, 3.2, P.visor, 0.3);
      ln(g, [-3, -17, 3, -17], P.trim, 0.8, 0.9);
    };
  }

  // ---- armamento e munição de naves (armazém) ------------------------------------------------------------
  function missile(body, nose, band, big) {
    return function (g) {
      const r = big ? 3.6 : 2.6, L = big ? 32 : 26, x0 = -L / 2 - 2;
      for (const s of [-1, 1]) poly(g, [x0 + 3, s * r * 0.8, x0 - 1, s * (r + 4), x0 - 3.4, s * (r + 4), x0 - 1.6, s * r * 0.8], GM_D);
      for (const s of [-1, 1]) poly(g, [x0 + L * 0.55, s * r * 0.9, x0 + L * 0.62, s * (r + 1.8), x0 + L * 0.72, s * (r + 1.8), x0 + L * 0.74, s * r * 0.9], GM_D);
      cyl(g, x0, -r, L, 2 * r, body);
      g.beginPath();
      g.moveTo(x0 + L, -r);
      g.quadraticCurveTo(x0 + L + r * 2.6, -r * 0.7, x0 + L + r * 3.4, 0);
      g.quadraticCurveTo(x0 + L + r * 2.6, r * 0.7, x0 + L, r);
      g.closePath();
      paint(g, nose, -r, r, { hi: 0.4 });
      cyl(g, x0 + L * 0.28, -r, 1.8, 2 * r, band, { line: false });
      rr(g, x0 - 2.4, -r * 0.6, 2.6, r * 1.2, 0.4, GM_D);
    };
  }
  function stingray(g) {
    rr(g, -16, 3, 30, 4.6, 1.4, GM);
    for (const y of [-5.2, 0.6]) {
      cyl(g, -15, y - 2.4, 22, 4.8, WHITE);
      g.beginPath();
      g.moveTo(7, y - 2.4);
      g.quadraticCurveTo(12, y - 1.6, 14, y);
      g.quadraticCurveTo(12, y + 1.6, 7, y + 2.4);
      g.closePath();
      paint(g, OR, y - 2.4, y + 2.4);
    }
    rr(g, -18, -9, 4, 18, 1, GM_D);
    hazard(g, -12, 4.2, 10, 2.2, OR, GM_D);
  }
  function avalanche(g) {
    rr(g, -20, 4, 38, 4.6, 1.4, GM);
    for (const x of [-12, 8]) rr(g, x, 2.6, 2.6, 2.6, 0.4, GM_D);
    missile(0x4f5647, RED, 0xe8b83a, true)(g);
    rr(g, -22, -8, 4, 18, 1, GM_D);
  }
  function craftCannon(g) {
    rr(g, -20, -6, 20, 12, 2, GM);
    rr(g, -16, 6, 12, 5, 1, GM_D);
    for (let i = 0; i < 4; i++) shell(g, -15 + i * 3, 9.6, 2, 2, BRASS);
    cyl(g, 0, -3.6, 20, 5.2, GM_L);
    for (let x = 3; x < 19; x += 3.4) rr(g, x, -4.2, 1.2, 6.4, 0.3, GM_D, { flat: true });
    rr(g, 19, -4.6, 4, 7.2, 1, GM_D);
    rr(g, -20, -1, 20, 1.6, 0, OR, { flat: true, line: false });
    ln(g, [-14, -6, -12, -9.4, -6, -9.4, -4, -6], GM_D, 1.8);
  }
  function laserCannon(g, d) {
    rr(g, -22, -8, 24, 16, 3, LZ);
    for (let x = -18; x <= -2; x += 3.2) rr(g, x, -11, 1.8, 3.4, 0.4, LZ_D);
    strip(g, d, -19, -1, 18, 1.6, LZ_GLOW, 0.24);
    cyl(g, 2, -5.6, 16, 9.6, LZ_L);
    for (const x of [5, 9, 13]) rr(g, x, -6.4, 1.6, 11.2, 0.4, LZ_D, { flat: true });
    rr(g, 18, -7, 4, 12, 1, LZ_D);
    lamp(g, d, 22.4, -1, 2, LZ_GLOW, 8, 0.55);
  }
  function plasmaBeam(g, d) {
    rr(g, -22, -8, 22, 16, 3, GM);
    rr(g, -16, -4.6, 10, 9, 4.4, AL_D);
    lamp(g, d, -11, 0, 2.6, AG, 7, 0.4);
    g.beginPath();
    g.moveTo(0, -6.4);
    g.bezierCurveTo(10, -6.4, 18, -4.6, 22, -1);
    g.bezierCurveTo(18, 2.6, 10, 4.4, 0, 4.4);
    g.closePath();
    paint(g, AL, -6.4, 4.4);
    glowLine(g, d, [2, -1, 10, -1, 18, -1], AG, 1.4, 0.25);
    lamp(g, d, 22, -1, 1.8, AG, 7, 0.55);
    rr(g, -22, 2.6, 22, 1.6, 0, OR, { flat: true, line: false });
  }
  function fusionBall(g, d) {
    rr(g, -20, -8, 26, 16, 4, GM);
    ell(g, 8, 0, 9, 9, AL_D);
    lamp(g, d, 8, 0, 5.6, 0xffe27a, 12, 0.5);
    ellPath(g, 8, 0, 7.6, 7.6);
    g.lineWidth = 0.8;
    g.strokeStyle = css(AL_L);
    g.stroke();
    rr(g, -20, 2.6, 26, 1.6, 0, OR, { flat: true, line: false });
    for (let x = -16; x < 0; x += 3.4) ln(g, [x, -6, x, -2], GM_D, 0.7);
  }
  function cannonRounds(g) {
    for (let i = 0; i < 5; i++) shell(g, -10 + i * 4.2, -6, 3, 4, BRASS);
    poly(g, [-12.6, -2, -10, -5, 14, -5, 12.6, -2], shade(OLIVE, 0.25));
    rr(g, -12.6, -2, 25.2, 12, 1, OLIVE);
    hazard(g, -10, 2, 20, 2.4, OR, 0x2a2a20);
    rr(g, -2.6, 5.6, 5.2, 2.6, 0.5, GM_D);
  }
  function fusionMissile(g, d) {
    poly(g, [-10, 10, -6, 6, 6, 6, 10, 10], GM_D);
    for (const s of [-1, 1]) ln(g, [s * 5, 6, s * 9, -1, s * 5, -8], GM_L, 1.6);
    lamp(g, d, 0, -1, 6.4, 0xffe27a, 14, 0.5);
    ellPath(g, 0, -1, 8.6, 2.4, 0.2);
    g.lineWidth = 0.7;
    g.strokeStyle = css(0xfff4c8, 0.8);
    g.stroke();
  }

  // ---- caixa genérica (ids sem arte própria) -----------------------------------------------------------
  function crate(g) {
    const C = 0x56604a;
    poly(g, [-13, -5, -9, -9.4, 15, -9.4, 11, -5], shade(C, 0.25));
    poly(g, [11, -5, 15, -9.4, 15, 7, 11, 11.4], shade(C, -0.35));
    rr(g, -13, -5, 24, 16.4, 0.6, C);
    hazard(g, -11, 1.6, 20, 3, OR, 0x22261e);
    for (const [x, y] of [[-13, -5], [8.6, -5], [-13, 8.8], [8.6, 8.8]]) rr(g, x, y, 2.4, 2.6, 0.3, OR, { flat: true, line: shade(OR, -0.6), lw: 0.4 });
    rr(g, -3.4, -3.4, 4.8, 2.6, 0.5, GM_D);
    hl(g, -12.4, -4.4, 10.4, -4.4, 0.3);
  }

  // ---- tabela: id → {w, h (caixa natural em px CSS), rot (ícone), stand (de pé no chão), draw} --------------
  const SPEC = {};
  const def = (ids, o) => {
    for (const id of [].concat(ids)) SPEC[id] = o;
  };
  const LONG = -0.42;
  def('pistol', { sz: 2, w: 30, h: 21, rot: -0.08, draw: pistol });
  def('pistol_clip', { sz: 1, w: 11, h: 19, rot: 0.12, draw: pistolClip });
  def('rifle', { sz: 3, w: 57, h: 21, rot: LONG, draw: rifle });
  def('rifle_clip', { sz: 1, w: 14, h: 22, rot: 0, draw: rifleClip });
  def('heavy_cannon', { sz: 4, w: 61, h: 26, rot: LONG, draw: heavyCannon });
  def('hc_ap', { sz: 2, w: 16, h: 24, rot: 0, draw: hcAmmo('ap') });
  def('hc_he', { sz: 2, w: 16, h: 24, rot: 0, draw: hcAmmo('he') });
  def('hc_in', { sz: 2, w: 16, h: 24, rot: 0, draw: hcAmmo('in') });
  def('auto_cannon', { sz: 4, w: 62, h: 24, rot: LONG, draw: autoCannon });
  def('ac_ap', { sz: 2, w: 24, h: 20, rot: 0, draw: acAmmo('ap') });
  def('ac_he', { sz: 2, w: 24, h: 20, rot: 0, draw: acAmmo('he') });
  def('ac_in', { sz: 2, w: 24, h: 20, rot: 0, draw: acAmmo('in') });
  def('rocket_launcher', { sz: 4, w: 62, h: 24, rot: LONG, draw: rocketLauncher });
  def('small_rocket', { sz: 3, w: 40, h: 16, rot: -0.78, draw: rocket(0xc9ccc6, OR, GM_D, GM, false) });
  def('large_rocket', { sz: 3, w: 46, h: 18, rot: -0.78, draw: rocket(0x5c6450, RED, 0xe8b83a, GM_D, true) });
  def('incendiary_rocket', { sz: 3, w: 46, h: 18, rot: -0.78, draw: rocket(0xd9a03a, 0x9a2a1a, RED, GM_D, true, 0xc8382a) });
  def('laser_pistol', { sz: 2, w: 30, h: 21, rot: -0.08, draw: laserPistol });
  def('laser_rifle', { sz: 3, w: 57, h: 19, rot: LONG, draw: laserRifle });
  def('heavy_laser', { sz: 4, w: 60, h: 26, rot: LONG, draw: heavyLaser });
  def('plasma_pistol', { sz: 2, w: 28, h: 20, rot: -0.08, draw: plasmaPistol });
  def('plasma_pistol_clip', { sz: 1, w: 11, h: 17, rot: 0, draw: plasmaClip(0) });
  def('plasma_rifle', { sz: 3, w: 56, h: 20, rot: LONG, draw: plasmaRifle });
  def('plasma_rifle_clip', { sz: 1, w: 13, h: 19, rot: 0, draw: plasmaClip(1) });
  def('heavy_plasma', { sz: 4, w: 60, h: 27, rot: LONG, draw: heavyPlasma });
  def('heavy_plasma_clip', { sz: 1, w: 15, h: 18, rot: 0, draw: plasmaClip(2) });
  def('small_launcher', { sz: 4, w: 50, h: 21, rot: LONG, draw: smallLauncher });
  def('stun_bomb', { sz: 1, w: 15, h: 15, rot: 0, draw: stunBomb });
  def('blaster_launcher', { sz: 4, w: 62, h: 24, rot: LONG, draw: blasterLauncher });
  def('blaster_bomb', { sz: 2, w: 26, h: 14, rot: -0.5, draw: blasterBomb });
  def('stun_rod', { sz: 2, w: 46, h: 10, rot: -0.72, draw: stunRod });
  def('grenade', { sz: 1, w: 14, h: 19, rot: 0, draw: grenade });
  def('smoke_grenade', { sz: 1, w: 13, h: 20, rot: 0, draw: smokeGrenade });
  def('proximity_grenade', { sz: 1, w: 20, h: 16, rot: 0, draw: proximityGrenade });
  def('high_explosive', { sz: 2, w: 25, h: 18, rot: 0, draw: highExplosive });
  def('alien_grenade', { sz: 1, w: 14, h: 14, rot: 0, draw: alienGrenade });
  def('electro_flare', { sz: 1, w: 22, h: 8, rot: -0.6, draw: flare });
  def('medikit', { sz: 2, w: 27, h: 20, rot: 0, draw: medikit });
  def('motion_scanner', { sz: 1, w: 17, h: 28, rot: 0, draw: motionScanner });
  def('psi_amp', { sz: 3, w: 30, h: 24, rot: -0.2, draw: psiAmp });
  def('alien_alloys', { sz: 3, w: 34, h: 22, rot: 0, draw: alienAlloys });
  def('elerium_115', { sz: 3, w: 22, h: 30, rot: 0, stand: true, draw: elerium });
  def('ufo_power_source', { sz: 3, w: 30, h: 28, rot: 0, stand: true, draw: powerSource });
  def('ufo_navigation', { sz: 3, w: 28, h: 26, rot: 0, stand: true, draw: navigation });
  def('alien_food', { sz: 3, w: 18, h: 28, rot: 0, stand: true, draw: alienFood });
  def('alien_surgery', { sz: 3, w: 26, h: 28, rot: 0, stand: true, draw: alienSurgery });
  def('examination_room', { sz: 3, w: 34, h: 22, rot: 0, stand: true, draw: examRoom });
  def('alien_reproduction', { sz: 3, w: 20, h: 32, rot: 0, stand: true, draw: reproduction });
  def('alien_entertainment', { sz: 3, w: 22, h: 30, rot: 0, stand: true, draw: entertainment });
  def('sectoid_corpse', { w: 38, h: 20, rot: -0.2, corpse: true, draw: sectoidCorpse });
  def('floater_corpse', { w: 40, h: 22, rot: -0.2, corpse: true, draw: floaterCorpse });
  def('snakeman_corpse', { w: 48, h: 18, rot: -0.2, corpse: true, draw: snakemanCorpse });
  def('muton_corpse', { w: 48, h: 28, rot: -0.2, corpse: true, draw: mutonCorpse });
  def('ethereal_corpse', { w: 42, h: 22, rot: -0.2, corpse: true, draw: etherealCorpse });
  def('chryssalid_corpse', { w: 44, h: 26, rot: -0.2, corpse: true, draw: chryssalidCorpse });
  def('reaper_corpse', { gt: 44, w: 50, h: 26, rot: -0.2, corpse: true, draw: reaperCorpse });
  def('cyberdisc_corpse', { gt: 46, w: 48, h: 26, rot: -0.12, corpse: true, draw: cyberdiscCorpse });
  def('sectopod_corpse', { gt: 46, w: 46, h: 30, rot: -0.12, corpse: true, draw: sectopodCorpse });
  def('zombie_corpse', {
    w: 46, h: 24, rot: -0.2, corpse: true,
    draw: humanCorpse({ suit: 0x5a5448, legs: 0x4a4a40, skin: 0x7f9e6a, hair: 0x2b2b20, boot: 0x2a2620, torn: true }),
  });
  def('soldier_corpse', {
    w: 46, h: 24, rot: -0.2, corpse: true,
    draw: humanCorpse({ suit: 0x2f7f9b, legs: 0x27607c, skin: 0xcf9d74, hand: 0x3b3128, hair: 0x3a2a1c, boot: 0x2b2520, belt: 0x8a7f5c }),
  });
  def('civilian_corpse', {
    w: 46, h: 24, rot: -0.2, corpse: true,
    draw: humanCorpse({ suit: 0x8a5a3a, arms: 0x8a5a3a, legs: 0x3e5470, skin: 0xe0b08a, hair: 0x5c3a1f, boot: 0x2e2620 }),
  });
  def('personal_armour', { sz: 3, w: 28, h: 28, rot: 0, draw: personalArmour });
  def('power_suit', { sz: 3, w: 30, h: 34, rot: 0, draw: suitBust({ suit: 0x4a5772, plate: 0x66748f, trim: 0x8e9bb4, visor: 0x7fe4ff }) });
  def('flying_suit', { sz: 3, w: 36, h: 34, rot: 0, draw: suitBust({ suit: 0x5a76a2, plate: 0x8fa6c9, trim: 0xc9d4e6, visor: 0xffc65a, wings: true, pack: true }) });
  def('stingray', { sz: 4, w: 34, h: 20, rot: -0.3, draw: stingray });
  def('avalanche', { sz: 4, w: 46, h: 20, rot: -0.36, draw: avalanche });
  def('cannon', { sz: 4, w: 46, h: 22, rot: -0.3, draw: craftCannon });
  def('laser_cannon', { sz: 4, w: 48, h: 24, rot: -0.3, draw: laserCannon });
  def('plasma_beam', { sz: 4, w: 48, h: 18, rot: -0.3, draw: plasmaBeam });
  def('fusion_ball', { sz: 4, w: 42, h: 20, rot: -0.3, draw: fusionBall });
  def('stingray_missile', { sz: 2, w: 34, h: 14, rot: -0.7, draw: missile(WHITE, OR, GM_D, false) });
  def('avalanche_missile', { sz: 3, w: 44, h: 18, rot: -0.7, draw: missile(0x4f5647, RED, 0xe8b83a, true) });
  def('cannon_rounds', { sz: 2, w: 28, h: 18, rot: 0, draw: cannonRounds });
  def('fusion_ball_missile', { sz: 2, w: 20, h: 22, rot: 0, stand: true, draw: fusionMissile });
  const CRATE = { sz: 2, w: 30, h: 22, rot: 0, stand: true, draw: crate };
  const IDS = Object.keys(SPEC);

  // ---- composição: contorno exterior, sombra e halos aditivos ------------------------------------------
  const OFFS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  function recorder(g, glows) {
    return {
      glow(x, y, r, c, a) {
        const m = g.getTransform();
        glows.push({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, r: r * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), c, a });
      },
    };
  }
  function tinted(src, col) {
    const c = makeCanvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = css(col);
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  // o: {s, shadow:{dx, dy, a}, pre(ctx)} — pre desenha por baixo (sombra elíptica dos objetos de pé)
  function compose(art, glows, o) {
    const out = makeCanvas(art.width, art.height), x = out.getContext('2d');
    const sil = tinted(art, OUT);
    const px = Math.max(1, Math.round(o.s));
    if (o.pre) o.pre(x);
    if (o.shadow) {
      x.globalAlpha = o.shadow.a;
      x.drawImage(sil, Math.round(o.shadow.dx * o.s), Math.round(o.shadow.dy * o.s));
    }
    x.globalAlpha = 0.92;
    for (const f of OFFS) x.drawImage(sil, f[0] * px, f[1] * px);
    x.globalAlpha = 1;
    x.drawImage(art, 0, 0);
    if (glows.length) {
      x.globalCompositeOperation = 'lighter';
      for (const q of glows) {
        if (!(q.r > 0)) continue;
        const rg = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
        rg.addColorStop(0, css(q.c, q.a));
        rg.addColorStop(0.35, css(q.c, q.a * 0.45));
        rg.addColorStop(1, css(q.c, 0));
        x.fillStyle = rg;
        x.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
      }
      x.globalCompositeOperation = 'source-over';
    }
    return out;
  }
  const specOf = (id) => SPEC[id] || CRATE;

  // caixa real do desenho (alfa > 6 %) rodado de `rot`, em unidades do item; null sem leitura de píxeis
  const MEAS = new Map();
  function measure(id, sp, rot) {
    const key = id + '|' + rot;
    if (MEAS.has(key)) return MEAS.get(key);
    let m = null;
    try {
      const S = 2, N = 192;
      const c = makeCanvas(N, N), g = c.getContext('2d', { willReadFrequently: true });
      g.setTransform(S, 0, 0, S, N / 2, N / 2);
      g.rotate(rot);
      sp.draw(g, { glow() {} });
      const px = g.getImageData(0, 0, N, N).data;
      let x0 = N, y0 = N, x1 = -1, y1 = -1;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (px[(y * N + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0) m = { x0: (x0 - N / 2) / S, y0: (y0 - N / 2) / S, x1: (x1 + 1 - N / 2) / S, y1: (y1 + 1 - N / 2) / S };
    } catch (e) {
      m = null;
    }
    // sem leitura (Node, canvas contaminado): retângulo nominal rodado
    if (!m) {
      const ca = Math.abs(Math.cos(rot)), sa = Math.abs(Math.sin(rot));
      const bw = sp.w * ca + sp.h * sa, bh = sp.w * sa + sp.h * ca;
      m = { x0: -bw / 2, y0: -bh / 2, x1: bw / 2, y1: bh / 2 };
    }
    MEAS.set(key, m);
    return m;
  }
  // maior dimensão alvo por classe de tamanho de inventário (§3.7): ícone (px CSS) e no chão (antes da projeção)
  const ICON_TARGET = [0, 25, 33, 42, 46];
  const GROUND_TARGET = [0, 15, 20, 27, 32];
  const sizeOf = (sp) => sp.sz || (sp.corpse ? 4 : 2);

  function renderIcon(id, s) {
    const sp = specOf(id);
    const W = Math.max(8, Math.round(BOX * s));
    const art = makeCanvas(W, W), g = art.getContext('2d');
    const glows = [];
    const rot = sp.rot || 0;
    const m = measure(id, sp, rot);
    const bw = m.x1 - m.x0, bh = m.y1 - m.y0;
    const fit = Math.min(ICON_TARGET[sizeOf(sp)] / Math.max(bw, bh), (BOX - 4) / bw, (BOX - 4) / bh);
    g.setTransform(s, 0, 0, s, 0, 0);
    g.translate(BOX / 2, BOX / 2);
    g.scale(fit, fit);
    g.translate(-(m.x0 + m.x1) / 2, -(m.y0 + m.y1) / 2);
    g.rotate(rot);
    sp.draw(g, recorder(g, glows));
    return compose(art, glows, { s, shadow: { dx: 0.8, dy: 1.3, a: 0.3 } });
  }

  // orientações no chão (rad no plano do chão, antes da projeção); escolhidas pelo id
  const GANG = [-0.44, -0.18, 0.2, 0.46];
  const SQUASH = 0.56; // um pouco acima de 0,5: objetos deitados têm espessura e leem-se melhor
  function strHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function renderGround(id, s) {
    const sp = specOf(id);
    const stand = !!sp.stand;
    const m = measure(id, sp, 0);
    const mw = m.x1 - m.x0, mh = m.y1 - m.y0;
    const k = stand ? (sp.sz >= 3 ? 23 : 19) / mh : (sp.gt || GROUND_TARGET[sizeOf(sp)] + (sp.corpse ? 6 : 0)) / Math.max(mw, mh);
    let a, b, c, dd;
    if (stand) {
      a = k;
      b = 0;
      c = 0;
      dd = k;
    } else {
      const ang = GANG[OV.U.hash32(strHash(String(id)), 7, 3) & 3];
      const co = Math.cos(ang), si = Math.sin(ang);
      a = k * co;
      b = SQUASH * k * si;
      c = -k * si;
      dd = SQUASH * k * co;
    }
    // de pé: a base do desenho assenta 2 px abaixo do centro do losango; deitado: centrado
    const ox = stand ? -((m.x0 + m.x1) / 2) * k : 0;
    const oy = stand ? -m.y1 * k + 2 : 0;
    const cx0 = stand ? 0 : (m.x0 + m.x1) / 2, cy0 = stand ? 0 : (m.y0 + m.y1) / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[m.x0, m.y0], [m.x1, m.y0], [m.x1, m.y1], [m.x0, m.y1]]) {
      const qx = px - cx0, qy = py - cy0;
      const X = a * qx + c * qy + ox, Y = b * qx + dd * qy + oy;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    const pad = 4;
    const ax = Math.ceil(-x0 + pad), ay = Math.ceil(-y0 + pad);
    const w = Math.ceil(ax + x1 + pad), h = Math.ceil(ay + Math.max(y1, 3) + pad);
    const art = makeCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))), g = art.getContext('2d');
    const glows = [];
    g.setTransform(s, 0, 0, s, 0, 0);
    g.translate(ax + ox, ay + oy);
    g.transform(a, b, c, dd, 0, 0);
    g.translate(-cx0, -cy0);
    sp.draw(g, recorder(g, glows));
    const shadowEll = (x) => {
      const rx = Math.max(4, mw * k * 0.5) * s, cx = ax * s, cy = (ay + 0.5) * s;
      const rg = x.createRadialGradient(cx, cy, 0, cx, cy, rx);
      rg.addColorStop(0, 'rgba(0,0,0,0.45)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      x.save();
      x.translate(cx, cy);
      x.scale(1, 0.5);
      x.translate(-cx, -cy);
      x.fillStyle = rg;
      x.beginPath();
      x.arc(cx, cy, rx, 0, TAU);
      x.fill();
      x.restore();
    };
    const out = compose(art, glows, stand ? { s, pre: shadowEll } : { s, shadow: { dx: 1.4, dy: 1.1, a: 0.42 } });
    return { c: out, w, h, ax, ay };
  }

  // ---- cache LRU por orçamento de píxeis -------------------------------------------------------------
  const cache = new Map();
  let pixels = 0, budget = 12e6;
  const areaOf = (v) => (v.c || v).width * (v.c || v).height;
  function remember(k, v) {
    cache.set(k, v);
    pixels += areaOf(v);
    while (pixels > budget && cache.size > 1) {
      const first = cache.keys().next().value;
      pixels -= areaOf(cache.get(first));
      cache.delete(first);
    }
  }
  function cached(k, make) {
    let v = cache.get(k);
    if (v) {
      cache.delete(k);
      cache.set(k, v);
      return v;
    }
    v = make();
    remember(k, v);
    return v;
  }
  const qScale = (s) => Math.min(8, Math.max(0.25, Math.round((+s || 1) * 4) / 4));

  function icon(itemId, scale) {
    const s = qScale(scale), id = String(itemId);
    return cached('i|' + (SPEC[id] ? id : '?') + '|' + s, () => renderIcon(id, s));
  }
  function ground(itemId, scale) {
    const s = qScale(scale), id = String(itemId);
    return cached('g|' + (SPEC[id] ? id : '?') + '|' + s, () => renderGround(SPEC[id] ? id : '?', s));
  }
  const devScale = (ctx) => {
    const t = ctx.getTransform ? ctx.getTransform() : null;
    return t ? Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1 : 1;
  };
  // ícone numa caixa de size×size px CSS com canto superior esquerdo em (x, y)
  function drawIcon(ctx, itemId, x, y, size) {
    size = size || BOX;
    const c = icon(itemId, (size / BOX) * devScale(ctx));
    ctx.drawImage(c, x, y, size, size);
    return c;
  }
  // sprite do chão com a âncora em (x, y), alinhado a píxeis do dispositivo
  function blit(ctx, spr, x, y, zoom) {
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 };
    const sx = t.a || 1, sy = t.d || 1;
    const dx = Math.round((x - spr.ax * zoom) * sx + t.e), dy = Math.round((y - spr.ay * zoom) * sy + t.f);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(spr.c, dx, dy, Math.round(spr.w * zoom * sx), Math.round(spr.h * zoom * sy));
    ctx.restore();
  }
  function drawGround(ctx, itemId, x, y, zoom) {
    zoom = zoom || 1;
    const spr = ground(itemId, zoom * devScale(ctx));
    blit(ctx, spr, x, y, zoom);
    return spr;
  }
  function clearCache() {
    cache.clear();
    pixels = 0;
  }

  OV.ItemSprites = {
    BOX, IDS,
    icon, ground, drawIcon, drawGround, blit, clearCache,
    has: (id) => !!SPEC[id],
    stands: (id) => !!specOf(id).stand,
    stats: () => ({ entries: cache.size, pixels, budget }),
    setBudget: (px) => { budget = Math.max(1e5, +px || 12e6); },
    setCanvasFactory: (fn) => { makeCanvas = fn; clearCache(); },
  };
})(globalThis.OV || (globalThis.OV = {}));
