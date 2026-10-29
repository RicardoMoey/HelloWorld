/* Arte procedimental do Basescape (DESIGN.md §13): grelha 6×6 vista de cima em corte, sobre rocha/terra,
   com corredores entre instalações adjacentes, obras (andaimes + dias em falta), naves estacionadas nos
   hangares, fantasma de colocação verde/vermelho, destaque de desmantelamento e animação subtil
   (pratos de radar a rodar, ecrãs a tremeluzir, brilho da contenção). Só lê `base`; nunca altera G.
   Coordenadas: px CSS do contexto (o chamador já aplicou a escala DPR, como OV.View.begin).
   OV.BaseRender.draw(ctx, base, view)
     view = { x, y, cell,            // canto superior esquerdo da grelha e lado da célula, px CSS
              dpr,                   // resolução dos sprites (1..2)
              time,                  // segundos (float) para a animação; omitido ⇒ imagem estática
              hover:{x,y}|null, selection:{x,y}|null, ghost:{type,x,y,valid}|null,
              dismantle:{x,y,ok?}|null, highlight:type|[type]|null,
              G | crafts:[craft|{type,status}] (ordem de base.crafts) — naves desenhadas nos hangares }
   cellAt(view, px, py) → {x,y}|null ; layout(w, h, opts) → {x,y,cell} ; facilityAt(base, x, y) → entrada|null
   hangarSlots(base, view?) → [{x,y,craftId,craft}] ; facilityRect(view, entrada) → {x,y,w,h}
   facilityIcon(type, size, dpr?) / craftIcon(type, size, dpr?) → canvas novo (size px CSS, size·dpr px)
   facilityIconURL / craftIconURL → data URL em cache (listas DOM) ; animated(base) → bool */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css, shade = Col.shade, mix = Col.mix;
  const TAU = Math.PI * 2;
  const INSET = 0.065; // folga entre a célula e a parede exterior da sala (unidades de célula)
  const WT = 0.05; // espessura da parede
  const ANIM_FPS = 20;

  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('BaseRender: sem canvas disponível');
  };

  // ---- paleta (tokens de css/base.css + tileset CRAFT do Battlescape) --------------------------------------
  const P = {
    ink: 0xdbe6ef, amber: 0xffb53d, amber2: 0xc98a1d, teal: 0x3fd7c5, cyan: 0x58c8ff, red: 0xff4f43,
    green: 0x5fe08a, violet: 0xb48cff, line2: 0x31506d,
    wall: 0x3e4a57, wallHi: 0x66788a, wallLo: 0x232b34,
    steel: 0x6a7076, steel2: 0x7a8086, deck: 0x5a6066, dark: 0x14181d,
    rock: 0x3b3229, rock2: 0x2a231d, rockHi: 0x5a4c3e, vein: 0x6a4a34,
  };
  const FLOOR = {
    access_lift: 0x2f3943, living_quarters: 0x43392f, laboratory: 0x36485a, workshop: 0x3b3b37,
    general_stores: 0x3c372f, alien_containment: 0x262a37, hangar: 0x363b40, small_radar: 0x313c47,
    large_radar: 0x313c47, hyper_wave_decoder: 0x2b2a3c, missile_defence: 0x353830, laser_defence: 0x353830,
    plasma_defence: 0x353830, fusion_defence: 0x353830, grav_shield: 0x24304a, mind_shield: 0x2d2638,
    psi_lab: 0x2b2636,
  };

  // ---- aleatório e ruído determinísticos (só cosméticos) -------------------------------------------------
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
  function h2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // tremeluzir em degraus (0..1), estável dentro de cada degrau
  const flick = (t, k, hz) => h2(Math.floor(t * (hz || 8)), k | 0, 77);
  const pulse = (t, period, ph) => 0.5 + 0.5 * Math.sin(((t / period) + (ph || 0)) * TAU);

  // ---- primitivas em unidades de célula ----------------------------------------------------------------
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function fillRR(g, x, y, w, h, r, col, a) {
    rr(g, x, y, w, h, r);
    g.fillStyle = css(col, a);
    g.fill();
  }
  function rect(g, x, y, w, h, col, a) {
    g.fillStyle = css(col, a);
    g.fillRect(x, y, w, h);
  }
  function disc(g, x, y, r, col, a) {
    g.beginPath();
    g.arc(x, y, Math.max(0, r), 0, TAU);
    g.fillStyle = css(col, a);
    g.fill();
  }
  function ring(g, x, y, r, col, w, a) {
    g.beginPath();
    g.arc(x, y, Math.max(0, r), 0, TAU);
    g.strokeStyle = css(col, a);
    g.lineWidth = w;
    g.stroke();
  }
  function line(g, x0, y0, x1, y1, col, w, a) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.strokeStyle = css(col, a);
    g.lineWidth = w;
    g.stroke();
  }
  function poly(g, pts) {
    g.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      if (k) g.lineTo(pts[k], pts[k + 1]);
      else g.moveTo(pts[k], pts[k + 1]);
    }
    g.closePath();
  }
  function fillPoly(g, pts, col, a) {
    poly(g, pts);
    g.fillStyle = css(col, a);
    g.fill();
  }
  function ngon(g, cx, cy, r, n, rot) {
    const p = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * TAU;
      p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    poly(g, p);
  }
  function glow(g, x, y, r, col, a) {
    if (!(r > 0)) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, css(col, a));
    gr.addColorStop(0.45, css(col, a * 0.45));
    gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // caixa com sombra projetada (luz de cima-esquerda, como no Battlescape) e bisel
  function box(g, x, y, w, h, col, u, opt) {
    opt = opt || {};
    const r = opt.r === undefined ? 0.012 : opt.r;
    if (opt.shadow !== false) fillRR(g, x + 0.014, y + 0.02, w, h, r, 0x000000, 0.38);
    fillRR(g, x, y, w, h, r, col);
    if (opt.bevel !== false && w > 3 * u && h > 3 * u) {
      line(g, x + r, y + u * 0.6, x + w - r, y + u * 0.6, shade(col, 0.32), u, 0.9);
      line(g, x + u * 0.6, y + r, x + u * 0.6, y + h - r, shade(col, 0.2), u, 0.8);
      line(g, x + r, y + h - u * 0.6, x + w - r, y + h - u * 0.6, shade(col, -0.45), u, 0.9);
      line(g, x + w - u * 0.6, y + r, x + w - u * 0.6, y + h - r, shade(col, -0.35), u, 0.8);
    }
  }
  function hazard(g, x, y, w, h, s, u) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    rect(g, x, y, w, h, 0x1a1a18);
    g.strokeStyle = css(P.amber, 0.9);
    g.lineWidth = s * 0.5;
    const n = Math.ceil((w + h) / s) + 1;
    for (let k = -1; k < n; k++) {
      g.beginPath();
      g.moveTo(x + k * s, y);
      g.lineTo(x + k * s - h, y + h);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = css(0x000000, 0.4);
    g.lineWidth = u;
    g.strokeRect(x, y, w, h);
  }

  // ---- sala: parede exterior, chão texturado, sombra interior ----------------------------------------------
  function interior(W, H) {
    const m = INSET + WT;
    return { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  }
  function shell(g, W, H, floor, u, tex) {
    const i = INSET;
    fillRR(g, i + 0.022, i + 0.034, W - 2 * i, H - 2 * i, 0.05, 0x000000, 0.5);
    fillRR(g, i, i, W - 2 * i, H - 2 * i, 0.05, P.wall);
    // bisel exterior da parede
    rr(g, i + u * 0.5, i + u * 0.5, W - 2 * i - u, H - 2 * i - u, 0.046);
    g.strokeStyle = css(P.wallLo, 0.9);
    g.lineWidth = u;
    g.stroke();
    line(g, i + 0.05, i + u * 1.2, W - i - 0.05, i + u * 1.2, P.wallHi, u, 0.9);
    line(g, i + u * 1.2, i + 0.05, i + u * 1.2, H - i - 0.05, P.wallHi, u, 0.6);
    const R = interior(W, H);
    rect(g, R.x, R.y, R.w, R.h, floor);
    // textura do chão
    g.save();
    g.beginPath();
    g.rect(R.x, R.y, R.w, R.h);
    g.clip();
    if (tex === 'plank') {
      for (let y = R.y, k = 0; y < R.y + R.h; y += 0.075, k++) {
        line(g, R.x, y, R.x + R.w, y, shade(floor, -0.35), u, 0.6);
        for (let x = R.x + ((k % 2) ? 0.09 : 0.2); x < R.x + R.w; x += 0.24) line(g, x, y, x, y + 0.075, shade(floor, -0.3), u, 0.5);
      }
    } else if (tex === 'plate') {
      for (let y = R.y + 0.03, k = 0; y < R.y + R.h; y += 0.05, k++) {
        for (let x = R.x + 0.03 + (k % 2) * 0.025; x < R.x + R.w; x += 0.05) {
          line(g, x - 0.008, y + 0.006, x + 0.008, y - 0.006, shade(floor, 0.18), u * 1.2, 0.5);
        }
      }
    } else if (tex !== 'none') {
      const s = tex === 'big' ? 0.25 : 0.125;
      for (let x = R.x + s; x < R.x + R.w; x += s) line(g, x, R.y, x, R.y + R.h, shade(floor, -0.3), u, 0.55);
      for (let y = R.y + s; y < R.y + R.h; y += s) line(g, R.x, y, R.x + R.w, y, shade(floor, -0.3), u, 0.55);
      for (let x = R.x + s; x < R.x + R.w; x += s) line(g, x + u, R.y, x + u, R.y + R.h, shade(floor, 0.12), u, 0.35);
    }
    g.restore();
    // sombra da parede no chão (luz de cima-esquerda)
    let gr = g.createLinearGradient(0, R.y, 0, R.y + 0.07);
    gr.addColorStop(0, css(0x000000, 0.42));
    gr.addColorStop(1, css(0x000000, 0));
    g.fillStyle = gr;
    g.fillRect(R.x, R.y, R.w, 0.07);
    gr = g.createLinearGradient(R.x, 0, R.x + 0.05, 0);
    gr.addColorStop(0, css(0x000000, 0.32));
    gr.addColorStop(1, css(0x000000, 0));
    g.fillStyle = gr;
    g.fillRect(R.x, R.y, 0.05, R.h);
    // pilares nos cantos
    for (const [cx, cy] of [[R.x, R.y], [R.x + R.w, R.y], [R.x, R.y + R.h], [R.x + R.w, R.y + R.h]]) {
      fillRR(g, cx - 0.035, cy - 0.035, 0.07, 0.07, 0.012, shade(P.wall, -0.15));
      fillRR(g, cx - 0.025, cy - 0.025, 0.05, 0.05, 0.01, shade(P.wall, 0.12));
    }
    return R;
  }

  // ---- interiores (estáticos) -------------------------------------------------------------------------
  // PAINT[tipo](g, R, u, r) desenha dentro da sala; R = interior em unidades de célula; u = 1 px CSS
  const PAINT = {};
  // ANIM[tipo](g, R, t, u, ctx) camada viva (ctx = {f, occupants}); também usada nos ícones com t fixo
  const ANIM = {};
  const TEX = {
    access_lift: 'plate', living_quarters: 'plank', laboratory: 'tile', workshop: 'big', general_stores: 'big',
    alien_containment: 'tile', hangar: 'big', small_radar: 'plate', large_radar: 'plate', hyper_wave_decoder: 'tile',
    missile_defence: 'plate', laser_defence: 'plate', plasma_defence: 'plate', fusion_defence: 'plate',
    grav_shield: 'tile', mind_shield: 'tile', psi_lab: 'tile',
  };

  // elevador: poço octogonal com anel de risco e plataforma
  PAINT.access_lift = function (g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    ngon(g, cx + 0.012, cy + 0.02, 0.33, 8, Math.PI / 8);
    g.fillStyle = css(0x000000, 0.4);
    g.fill();
    ngon(g, cx, cy, 0.33, 8, Math.PI / 8);
    g.fillStyle = css(0x111418);
    g.fill();
    // anel de risco
    g.save();
    ngon(g, cx, cy, 0.315, 8, Math.PI / 8);
    g.clip();
    hazard(g, cx - 0.33, cy - 0.33, 0.66, 0.66, 0.06, u);
    g.restore();
    ngon(g, cx, cy, 0.255, 8, Math.PI / 8);
    g.fillStyle = css(0x0b0d10);
    g.fill();
    // plataforma
    ngon(g, cx + 0.01, cy + 0.016, 0.225, 8, Math.PI / 8);
    g.fillStyle = css(0x000000, 0.55);
    g.fill();
    ngon(g, cx, cy, 0.225, 8, Math.PI / 8);
    g.fillStyle = css(0x6e7b88);
    g.fill();
    g.strokeStyle = css(0xa8b4c0, 0.8);
    g.lineWidth = u;
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      line(g, cx, cy, cx + Math.cos(a) * 0.21, cy + Math.sin(a) * 0.21, 0x4a5560, u * 1.4, 0.9);
    }
    ring(g, cx, cy, 0.13, 0x4a5560, u * 1.5, 0.9);
    ring(g, cx, cy, 0.07, P.amber, u * 2, 0.85);
    // calhas guia
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const x = cx + Math.cos(a) * 0.29, y = cy + Math.sin(a) * 0.29;
      fillRR(g, x - 0.025, y - 0.025, 0.05, 0.05, 0.008, 0x8a96a2);
    }
  };
  ANIM.access_lift = function (g, R, t, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const x = cx + Math.cos(a) * 0.36, y = cy + Math.sin(a) * 0.36;
      const on = Math.floor(t * 2.5) % 4 === k ? 1 : 0.25;
      glow(g, x, y, 0.07, P.amber, 0.55 * on);
      disc(g, x, y, 0.016, mix(0x6a4a10, P.amber, on));
    }
  };

  // alojamentos: cacifos, beliches, mesa
  PAINT.living_quarters = function (g, R, u, r) {
    const n = 7, lw = R.w / n;
    for (let k = 0; k < n; k++) {
      box(g, R.x + k * lw + u, R.y + u, lw - 2 * u, 0.075, k % 3 === 1 ? 0x5a6672 : 0x505c68, u, { r: 0.004 });
      line(g, R.x + k * lw + lw * 0.7, R.y + 0.02, R.x + k * lw + lw * 0.7, R.y + 0.05, 0xc0c8d0, u, 0.6);
    }
    const blankets = [0x4f5e3e, 0x3e566a, 0x5a4a3a, 0x4a5a48, 0x3a4a5a, 0x5e5240];
    const bw = 0.27, bh = 0.13;
    const rows = [R.y + 0.13, R.y + 0.31, R.y + 0.49];
    let k = 0;
    for (const y of rows) {
      for (const side of [0, 1]) {
        const x = side ? R.x + R.w - bw - 0.02 : R.x + 0.02;
        box(g, x, y, bw, bh, 0x7d8894, u, { r: 0.01 });
        rect(g, x + 0.012, y + 0.012, bw - 0.024, bh - 0.024, 0xa4b0bc);
        const head = side ? x + bw - 0.07 : x + 0.012;
        fillRR(g, head + 0.005, y + 0.025, 0.05, bh - 0.05, 0.015, 0xdfe4ea);
        const bx = side ? x + 0.012 : x + 0.07;
        rect(g, bx, y + 0.012, bw - 0.082, bh - 0.024, blankets[k++ % blankets.length]);
        line(g, bx + (side ? bw - 0.09 : 0.004), y + 0.014, bx + (side ? bw - 0.09 : 0.004), y + bh - 0.014, 0xffffff, u, 0.25);
        if (r() < 0.5) line(g, bx + 0.03, y + 0.04, bx + 0.12, y + 0.08, 0x000000, u, 0.25);
      }
    }
    // mesa e cadeiras
    const tx = R.x + R.w / 2, ty = R.y + R.h - 0.12;
    disc(g, tx + 0.012, ty + 0.018, 0.075, 0x000000, 0.35);
    disc(g, tx, ty, 0.075, 0x6a5a48);
    ring(g, tx, ty, 0.06, 0x8a7a64, u, 0.6);
    for (let a = 0; a < 4; a++) {
      const x = tx + Math.cos(a * Math.PI / 2 + 0.4) * 0.11, y = ty + Math.sin(a * Math.PI / 2 + 0.4) * 0.11;
      fillRR(g, x - 0.025, y - 0.025, 0.05, 0.05, 0.01, 0x3a4450);
    }
    disc(g, tx + 0.02, ty - 0.01, 0.014, 0xe8e0d0);
  };
  ANIM.living_quarters = function (g, R, t, u) {
    // candeeiro de mesa quente, quase parado
    const tx = R.x + R.w / 2, ty = R.y + R.h - 0.12;
    glow(g, tx - 0.02, ty, 0.14, 0xffc070, 0.16 + 0.03 * pulse(t, 3.7));
  };

  // laboratório: bancadas em U, monitores, mesa de análise central
  const LAB_SCREENS = [[0.12, 0.012], [0.33, 0.012], [0.55, 0.012], [0.012, 0.3], [0.012, 0.52], [0.79, 0.3], [0.79, 0.52]];
  PAINT.laboratory = function (g, R, u) {
    const c = 0xb4c0ca, d = 0.11;
    box(g, R.x, R.y, R.w, d, c, u, { r: 0.006 });
    box(g, R.x, R.y + d, d, R.h * 0.62, c, u, { r: 0.006 });
    box(g, R.x + R.w - d, R.y + d, d, R.h * 0.62, c, u, { r: 0.006 });
    for (const [sx, sy] of LAB_SCREENS) {
      const x = R.x + sx * R.w, y = R.y + sy * R.h;
      const w = sy < 0.05 ? 0.1 : 0.07, h = sy < 0.05 ? 0.07 : 0.1;
      fillRR(g, x, y, w, h, 0.008, 0x101820);
    }
    // frascos e amostras
    const vials = [[0.27, 0.05, P.green], [0.48, 0.06, P.violet], [0.7, 0.05, P.amber], [0.05, 0.44, P.cyan], [0.9, 0.44, P.green]];
    for (const [vx, vy, vc] of vials) {
      disc(g, R.x + vx * R.w, R.y + vy * R.h + 0.008, 0.016, 0xe0eef4, 0.9);
      disc(g, R.x + vx * R.w, R.y + vy * R.h + 0.008, 0.01, vc, 0.9);
    }
    // mesa de análise
    const cx = R.x + R.w / 2, cy = R.y + R.h * 0.58;
    disc(g, cx + 0.014, cy + 0.02, 0.15, 0x000000, 0.38);
    disc(g, cx, cy, 0.15, 0x5f6f7c);
    ring(g, cx, cy, 0.14, 0x9aa8b4, u, 0.7);
    disc(g, cx, cy, 0.1, 0x1a2630);
    ring(g, cx, cy, 0.1, P.cyan, u, 0.35);
    // cadeiras
    for (const a of [0.6, 2.2, 3.9]) disc(g, cx + Math.cos(a) * 0.22, cy + Math.sin(a) * 0.22, 0.03, 0x2a3440);
    // amostra alienígena no tabuleiro
    rect(g, R.x + R.w - 0.2, R.y + R.h - 0.1, 0.16, 0.07, 0x6a7680);
    disc(g, R.x + R.w - 0.12, R.y + R.h - 0.065, 0.02, 0x7a5a8a);
  };
  ANIM.laboratory = function (g, R, t, u) {
    LAB_SCREENS.forEach(([sx, sy], k) => {
      const x = R.x + sx * R.w, y = R.y + sy * R.h;
      const w = sy < 0.05 ? 0.1 : 0.07, h = sy < 0.05 ? 0.07 : 0.1;
      const f = flick(t, k, 6);
      const col = k % 3 === 0 ? P.teal : k % 3 === 1 ? P.cyan : P.green;
      rect(g, x + 0.008, y + 0.008, w - 0.016, h - 0.016, col, 0.45 + 0.4 * f);
      // linhas de "texto" a rolar
      const off = Math.floor(t * 4 + k) % 4;
      for (let L = 0; L < 3; L++) {
        const ly = y + 0.016 + ((L + off) % 4) * (h - 0.03) / 4;
        line(g, x + 0.014, ly, x + 0.014 + (w - 0.03) * (0.4 + 0.5 * h2(L, k + off, 3)), ly, 0xffffff, u, 0.45);
      }
      glow(g, x + w / 2, y + h / 2, 0.08, col, 0.12 + 0.12 * f);
    });
    // holograma a rodar sobre a mesa
    const cx = R.x + R.w / 2, cy = R.y + R.h * 0.58;
    glow(g, cx, cy, 0.16, P.cyan, 0.25 + 0.1 * pulse(t, 2.1));
    const a = t * 0.9;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.strokeStyle = css(0xbff0ff, 0.75);
    g.lineWidth = u;
    ngon(g, 0, 0, 0.07, 3, 0);
    g.stroke();
    g.rotate(-2 * a);
    ngon(g, 0, 0, 0.05, 3, Math.PI);
    g.stroke();
    g.restore();
    ring(g, cx, cy, 0.03 + 0.05 * ((t * 0.7) % 1), P.cyan, u, 0.6 * (1 - ((t * 0.7) % 1)));
  };

  // oficina: torno, prensa, bancada, carris da ponte rolante, peça em fabrico
  PAINT.workshop = function (g, R, u) {
    hazard(g, R.x + 0.2, R.y + R.h * 0.42, R.w - 0.4, 0.025, 0.04, u);
    hazard(g, R.x + 0.2, R.y + R.h * 0.42 + 0.27, R.w - 0.4, 0.025, 0.04, u);
    // torno
    box(g, R.x + 0.03, R.y + 0.06, 0.36, 0.13, 0x6f7a84, u);
    rect(g, R.x + 0.1, R.y + 0.1, 0.26, 0.05, 0x2a3036);
    disc(g, R.x + 0.08, R.y + 0.125, 0.04, 0x8a96a0);
    disc(g, R.x + 0.08, R.y + 0.125, 0.016, 0x2a3036);
    // prensa CNC
    box(g, R.x + R.w - 0.24, R.y + 0.05, 0.2, 0.22, 0x5e6a76, u);
    rect(g, R.x + R.w - 0.2, R.y + 0.09, 0.12, 0.12, 0x20262c);
    rect(g, R.x + R.w - 0.18, R.y + 0.11, 0.08, 0.08, 0x3a444e);
    // bancada de madeira com ferramentas
    box(g, R.x + 0.03, R.y + R.h - 0.16, 0.34, 0.12, 0x7a5a3a, u);
    rect(g, R.x + 0.06, R.y + R.h - 0.13, 0.08, 0.02, 0xb0b8c0);
    rect(g, R.x + 0.17, R.y + R.h - 0.14, 0.02, 0.07, 0xc04a30);
    rect(g, R.x + 0.22, R.y + R.h - 0.12, 0.1, 0.03, 0x4a5058);
    // peça em fabrico (casulo de arma de nave)
    const cx = R.x + R.w / 2 + 0.03, cy = R.y + R.h * 0.42 + 0.15;
    fillRR(g, cx - 0.13 + 0.014, cy - 0.045 + 0.02, 0.26, 0.09, 0.045, 0x000000, 0.35);
    fillRR(g, cx - 0.13, cy - 0.045, 0.26, 0.09, 0.045, 0x8d98a4);
    rect(g, cx - 0.05, cy - 0.045, u * 1.5, 0.09, 0x4a5058);
    rect(g, cx + 0.04, cy - 0.045, u * 1.5, 0.09, 0x4a5058);
    disc(g, cx + 0.11, cy, 0.02, 0x3a2a2a);
    // armário de ferramentas
    box(g, R.x + R.w - 0.16, R.y + R.h - 0.18, 0.13, 0.15, 0xa03a2a, u);
    for (let k = 0; k < 3; k++) line(g, R.x + R.w - 0.15, R.y + R.h - 0.14 + k * 0.04, R.x + R.w - 0.04, R.y + R.h - 0.14 + k * 0.04, 0x000000, u, 0.4);
    // carris da ponte rolante
    line(g, R.x, R.y + 0.012, R.x + R.w, R.y + 0.012, 0x8a8a7a, u * 2, 0.8);
    line(g, R.x, R.y + R.h - 0.012, R.x + R.w, R.y + R.h - 0.012, 0x8a8a7a, u * 2, 0.8);
  };
  ANIM.workshop = function (g, R, t, u) {
    // lâmpada de estado da prensa
    const on = Math.floor(t * 1.5) % 2;
    glow(g, R.x + R.w - 0.06, R.y + 0.07, 0.05, on ? P.green : P.amber, 0.6);
    disc(g, R.x + R.w - 0.06, R.y + 0.07, 0.012, on ? P.green : P.amber);
    // faíscas de soldadura na peça
    const cx = R.x + R.w / 2 + 0.03, cy = R.y + R.h * 0.42 + 0.15;
    const f = flick(t, 3, 14);
    if (f > 0.35) {
      const sx = cx - 0.03 + 0.06 * h2(Math.floor(t * 3), 1, 9), sy = cy - 0.05;
      glow(g, sx, sy, 0.07, 0xfff0c0, 0.7 * f);
      for (let k = 0; k < 5; k++) {
        const a = h2(Math.floor(t * 14), k, 5) * TAU, l = 0.02 + 0.03 * h2(k, Math.floor(t * 14), 6);
        line(g, sx, sy, sx + Math.cos(a) * l, sy + Math.sin(a) * l, 0xffd080, u, 0.9);
      }
    }
    // ponte rolante a deslizar
    const k = 0.5 + 0.5 * Math.sin(t * 0.35);
    const bx = R.x + 0.08 + k * (R.w - 0.16);
    rect(g, bx - 0.02 + 0.012, R.y + 0.02, 0.04, R.h - 0.02, 0x000000, 0.25);
    hazard(g, bx - 0.02, R.y, 0.04, R.h, 0.05, u);
    const hy = R.y + R.h * (0.35 + 0.25 * Math.sin(t * 0.23));
    fillRR(g, bx - 0.035, hy - 0.03, 0.07, 0.06, 0.01, 0x3a3e44);
    line(g, bx, hy + 0.03, bx, hy + 0.06, 0x9aa0a8, u, 0.9);
  };

  // armazém: estantes com caixotes, paletes, empilhador, linhas de corredor
  PAINT.general_stores = function (g, R, u, r) {
    line(g, R.x + R.w * 0.5, R.y + 0.02, R.x + R.w * 0.5, R.y + R.h - 0.02, P.amber, u * 1.5, 0.55);
    const crates = [0x8a6a3a, 0x6f5530, 0x4f5f3a, 0x5a6470, 0x7a4a2a, 0x9a7a44];
    // estantes ao longo das paredes esquerda e direita
    for (const side of [0, 1]) {
      const x = side ? R.x + R.w - 0.2 : R.x + 0.02;
      rect(g, x - 0.008, R.y + 0.02, 0.196, R.h - 0.04, 0x1e2226);
      for (let k = 0; k < 5; k++) {
        const y = R.y + 0.03 + k * (R.h - 0.06) / 5;
        line(g, x - 0.008, y, x + 0.188, y, 0x8a96a2, u, 0.7);
        for (let j = 0; j < 2; j++) {
          if (r() < 0.15) continue;
          const c = crates[Math.floor(r() * crates.length)];
          const cw = 0.07 + 0.015 * r(), ch = (R.h - 0.06) / 5 - 0.025;
          box(g, x + 0.01 + j * 0.09, y + 0.01, cw, ch, c, u, { r: 0.004, shadow: false });
          line(g, x + 0.01 + j * 0.09, y + 0.01 + ch / 2, x + 0.01 + j * 0.09 + cw, y + 0.01 + ch / 2, shade(c, -0.4), u, 0.6);
        }
      }
    }
    // paletes centrais
    for (const [px, py] of [[0.34, 0.12], [0.34, 0.5]]) {
      const x = R.x + px * R.w, y = R.y + py * R.h;
      rect(g, x - 0.01, y - 0.01, 0.2, 0.2, 0x6a5a40);
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        if (r() < 0.2) continue;
        const c = crates[Math.floor(r() * crates.length)];
        box(g, x + a * 0.09, y + b * 0.09, 0.085, 0.085, c, u, { r: 0.004 });
        line(g, x + a * 0.09, y + b * 0.09, x + a * 0.09 + 0.085, y + b * 0.09 + 0.085, shade(c, -0.35), u, 0.5);
        line(g, x + a * 0.09 + 0.085, y + b * 0.09, x + a * 0.09, y + b * 0.09 + 0.085, shade(c, -0.35), u, 0.5);
      }
    }
    // empilhador
    const fx = R.x + R.w * 0.42, fy = R.y + R.h - 0.17;
    box(g, fx, fy, 0.1, 0.13, 0xe0a020, u, { r: 0.012 });
    rect(g, fx + 0.02, fy + 0.03, 0.06, 0.05, 0x1a1e22);
    line(g, fx + 0.025, fy, fx + 0.025, fy - 0.05, 0x9aa0a8, u * 1.6, 0.9);
    line(g, fx + 0.075, fy, fx + 0.075, fy - 0.05, 0x9aa0a8, u * 1.6, 0.9);
  };
  ANIM.general_stores = function (g, R, t) {
    const fx = R.x + R.w * 0.42, fy = R.y + R.h - 0.17;
    const on = Math.floor(t * 1.6) % 2 ? 0.8 : 0.15;
    glow(g, fx + 0.05, fy + 0.11, 0.05, P.amber, on * 0.6);
  };

  // contenção alienígena: 4 celas com campo de força, consola central
  function pens(R) {
    const w = 0.27, h = (R.h - 0.06) / 2;
    return [
      [R.x + 0.02, R.y + 0.02, w, h, 1], [R.x + 0.02, R.y + 0.04 + h, w, h, 1],
      [R.x + R.w - 0.02 - w, R.y + 0.02, w, h, -1], [R.x + R.w - 0.02 - w, R.y + 0.04 + h, w, h, -1],
    ];
  }
  PAINT.alien_containment = function (g, R, u) {
    for (const [x, y, w, h, dir] of pens(R)) {
      fillRR(g, x, y, w, h, 0.012, 0x4a4f62);
      rect(g, x + 0.018, y + 0.018, w - 0.036, h - 0.036, 0x14121c);
      // grelha de ventilação no fundo
      for (let k = 1; k < 4; k++) line(g, x + 0.03, y + k * h / 4, x + w - 0.03, y + k * h / 4, 0x2a2638, u, 0.9);
      // emissores do campo de força na face aberta
      const fx = dir > 0 ? x + w - 0.012 : x + 0.012;
      rect(g, fx - 0.012, y + 0.005, 0.024, 0.03, 0x6a7088);
      rect(g, fx - 0.012, y + h - 0.035, 0.024, 0.03, 0x6a7088);
    }
    // corredor central com consola
    const cx = R.x + R.w / 2;
    line(g, cx, R.y + 0.03, cx, R.y + R.h - 0.18, P.violet, u, 0.25);
    box(g, cx - 0.08, R.y + R.h - 0.15, 0.16, 0.1, 0x3a4050, u);
    rect(g, cx - 0.06, R.y + R.h - 0.13, 0.12, 0.04, 0x0e1218);
  };
  // silhueta de um alienígena (vista de cima): cabeça grande, ombros
  function alienTop(g, x, y, s, col, t, k) {
    const sway = Math.sin(t * 1.3 + k * 1.7) * 0.01;
    disc(g, x + sway + 0.01, y + 0.012, s * 1.05, 0x000000, 0.5);
    fillPoly(g, [x - s * 0.9 + sway, y + s * 0.3, x + s * 0.9 + sway, y + s * 0.3, x + s * 0.5 + sway, y + s * 1.1, x - s * 0.5 + sway, y + s * 1.1], shade(col, -0.35));
    disc(g, x + sway, y, s * 0.62, col);
    const blink = flick(t, k * 7 + 1, 0.7) > 0.9 ? 0.15 : 1;
    disc(g, x - s * 0.24 + sway, y - s * 0.08, s * 0.14, 0x101010, blink);
    disc(g, x + s * 0.24 + sway, y - s * 0.08, s * 0.14, 0x101010, blink);
  }
  const ALIEN_TINTS = [0x8a9a8a, 0x8a7aa0, 0x7a9a6a, 0xa08a6a, 0x9aa0b0];
  ANIM.alien_containment = function (g, R, t, u, ctx) {
    const occ = ctx && ctx.occupants ? ctx.occupants : [];
    pens(R).forEach(([x, y, w, h, dir], k) => {
      const fx = dir > 0 ? x + w - 0.012 : x + 0.012;
      const col = k % 2 ? P.green : P.violet;
      const p = 0.55 + 0.45 * pulse(t, 2.4, k * 0.25);
      if (occ[k]) alienTop(g, x + w / 2 - dir * 0.02, y + h / 2, 0.06, ALIEN_TINTS[occ[k] % ALIEN_TINTS.length], t, k);
      rect(g, x + 0.018, y + 0.018, w - 0.036, h - 0.036, col, 0.06 + 0.05 * p);
      const gr = g.createLinearGradient(fx, 0, fx - dir * 0.08, 0);
      gr.addColorStop(0, css(col, 0.4 * p));
      gr.addColorStop(1, css(col, 0));
      g.fillStyle = gr;
      g.fillRect(Math.min(fx, fx - dir * 0.08), y + 0.03, 0.08, h - 0.06);
      line(g, fx, y + 0.035, fx, y + h - 0.035, mix(col, 0xffffff, 0.4), u * 1.5, 0.55 + 0.4 * p);
    });
    const cx = R.x + R.w / 2;
    for (let k = 0; k < 3; k++) {
      const f = flick(t, k + 20, 3);
      rect(g, cx - 0.05 + k * 0.035, R.y + R.h - 0.125, 0.025, 0.02, k === 1 ? P.red : P.violet, 0.4 + 0.5 * f);
    }
  };

  // hangar 2×2: plataforma de aterragem com marcas
  PAINT.hangar = function (g, R, u, r) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    // manchas de óleo e marcas de pneus
    for (let k = 0; k < 6; k++) disc(g, R.x + 0.2 + r() * (R.w - 0.4), R.y + 0.2 + r() * (R.h - 0.4), 0.03 + r() * 0.06, 0x000000, 0.12);
    disc(g, cx, cy, 0.8, 0x2b3036);
    ring(g, cx, cy, 0.8, 0x1c2024, u * 2, 0.9);
    ring(g, cx, cy, 0.74, P.amber, 0.03, 0.85);
    g.save();
    g.setLineDash([0.06, 0.05]);
    ring(g, cx, cy, 0.6, 0xdde4ea, u * 1.5, 0.35);
    g.restore();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      line(g, cx + Math.cos(a) * 0.62, cy + Math.sin(a) * 0.62, cx + Math.cos(a) * 0.72, cy + Math.sin(a) * 0.72, P.amber, 0.025, 0.8);
    }
    line(g, cx - 0.12, cy, cx + 0.12, cy, 0xdde4ea, u * 1.5, 0.25);
    line(g, cx, cy - 0.12, cx, cy + 0.12, 0xdde4ea, u * 1.5, 0.25);
    // cantos com risco
    const s = 0.16;
    for (const [x, y] of [[R.x, R.y], [R.x + R.w - s, R.y], [R.x, R.y + R.h - s], [R.x + R.w - s, R.y + R.h - s]]) {
      g.save();
      poly(g, x === R.x ? (y === R.y ? [x, y, x + s, y, x, y + s] : [x, y + s, x + s, y + s, x, y]) : (y === R.y ? [x + s, y, x + s, y + s, x, y] : [x + s, y + s, x, y + s, x + s, y]));
      g.clip();
      hazard(g, x, y, s, s, 0.05, u);
      g.restore();
    }
    // carrinho de combustível e caixa de ferramentas
    box(g, R.x + 0.08, R.y + R.h * 0.42, 0.08, 0.18, 0x6a7a4a, u, { r: 0.015 });
    disc(g, R.x + 0.12, R.y + R.h * 0.42 + 0.05, 0.022, 0x2a3020);
    box(g, R.x + R.w - 0.14, R.y + R.h * 0.44, 0.07, 0.12, 0xa03a2a, u);
  };
  ANIM.hangar = function (g, R, t, u, ctx) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const n = 16, head = Math.floor(t * 6) % n;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU - Math.PI / 2;
      const d = (head - k + n) % n;
      const on = d < 3 ? 1 - d / 3 : 0;
      const x = cx + Math.cos(a) * 0.77, y = cy + Math.sin(a) * 0.77;
      if (on > 0) glow(g, x, y, 0.06, P.amber, 0.5 * on);
      disc(g, x, y, 0.011, mix(0x5a4010, 0xffe0a0, on));
    }
    // nave em manutenção: luzes de serviço a piscar
    if (ctx && ctx.service) {
      const on = Math.floor(t * 2) % 2;
      for (const [x, y] of [[R.x + 0.1, R.y + 0.1], [R.x + R.w - 0.1, R.y + 0.1], [R.x + 0.1, R.y + R.h - 0.1], [R.x + R.w - 0.1, R.y + R.h - 0.1]]) {
        glow(g, x, y, 0.1, ctx.service === 'repair' ? P.red : P.cyan, on ? 0.55 : 0.12);
      }
    }
  };

  // radares: plataforma, bastidor e prato rotativo
  function radarBase(g, R, u, big) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const r = big ? 0.32 : 0.22;
    disc(g, cx + 0.014, cy + 0.02, r + 0.03, 0x000000, 0.35);
    disc(g, cx, cy, r + 0.03, 0x4a5662);
    ring(g, cx, cy, r + 0.03, 0x6a7a88, u, 0.8);
    ring(g, cx, cy, r - 0.02, 0x2a3440, u * 1.5, 0.9);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      disc(g, cx + Math.cos(a) * (r + 0.005), cy + Math.sin(a) * (r + 0.005), 0.008, 0x8a96a2);
    }
    // bastidor eletrónico
    const n = big ? 2 : 3;
    for (let k = 0; k < n; k++) {
      box(g, R.x + R.w - 0.12, R.y + 0.03 + k * 0.1, 0.09, 0.08, 0x2a323c, u, { r: 0.005 });
    }
    if (big) {
      for (const [x, y] of [[R.x + 0.1, R.y + R.h - 0.1], [R.x + 0.1, R.y + 0.1]]) {
        disc(g, x + 0.01, y + 0.014, 0.05, 0x000000, 0.35);
        disc(g, x, y, 0.05, 0xb0bcc8);
        disc(g, x, y, 0.035, 0xd0dae2);
        line(g, x, y, x + 0.03, y - 0.03, 0x4a5662, u * 1.5, 0.9);
      }
    }
  }
  function dish(g, cx, cy, a, rw, rd, u, lattice) {
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    // sombra
    g.save();
    g.translate(0.02, 0.03);
    g.scale(1, rd / rw);
    disc(g, 0, 0, rw, 0x000000, 0.35);
    g.restore();
    // braço de suporte
    rect(g, -0.02, -0.02, 0.04, rd + 0.04, 0x5a6672);
    g.save();
    g.scale(1, rd / rw);
    const gr = g.createRadialGradient(-rw * 0.3, -rw * 0.3, 0, 0, 0, rw);
    gr.addColorStop(0, css(0xe8eef2));
    gr.addColorStop(1, css(0x8a98a6));
    disc(g, 0, 0, rw, 0x9aa8b4);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rw, 0, TAU);
    g.fill();
    g.restore();
    g.strokeStyle = css(0x4a5662, 0.8);
    g.lineWidth = u;
    g.beginPath();
    g.ellipse(0, 0, rw, rd, 0, 0, TAU);
    g.stroke();
    const ribs = lattice ? 9 : 5;
    for (let k = 1; k < ribs; k++) {
      const x = -rw + (2 * rw * k) / ribs;
      const hh = rd * Math.sqrt(Math.max(0, 1 - (x / rw) * (x / rw)));
      line(g, x, -hh, x, hh, 0x4a5662, u * 0.8, lattice ? 0.7 : 0.45);
    }
    if (lattice) {
      g.beginPath();
      g.ellipse(0, 0, rw * 0.6, rd * 0.6, 0, 0, TAU);
      g.stroke();
    }
    // alimentador à frente do prato
    line(g, 0, 0, 0, -rd - 0.08, 0x3a4450, u * 1.8, 1);
    line(g, -rw * 0.5, -rd * 0.3, 0, -rd - 0.08, 0x3a4450, u, 0.9);
    line(g, rw * 0.5, -rd * 0.3, 0, -rd - 0.08, 0x3a4450, u, 0.9);
    disc(g, 0, -rd - 0.08, 0.016, 0xd0d8e0);
    g.restore();
  }
  function radarAnim(g, R, t, u, big) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    const a = t * (big ? 0.9 : 1.4);
    // cunha de varrimento no chão
    const r = big ? 0.34 : 0.25;
    g.save();
    g.globalAlpha = 0.28;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, a - Math.PI / 2 - 0.12 * (k + 1), a - Math.PI / 2 - 0.12 * k);
      g.closePath();
      g.fillStyle = css(P.teal, 0.5 * (1 - k / 6));
      g.fill();
    }
    g.restore();
    dish(g, cx, cy, a, big ? 0.24 : 0.15, big ? 0.13 : 0.08, u, big);
    const n = big ? 2 : 3;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < 3; j++) {
        const f = flick(t, k * 3 + j, 4);
        disc(g, R.x + R.w - 0.1 + j * 0.025, R.y + 0.06 + k * 0.1, 0.007, j === 0 ? P.green : P.amber, 0.3 + 0.7 * f);
      }
    }
  }
  PAINT.small_radar = (g, R, u) => radarBase(g, R, u, false);
  ANIM.small_radar = (g, R, t, u) => radarAnim(g, R, t, u, false);
  PAINT.large_radar = (g, R, u) => radarBase(g, R, u, true);
  ANIM.large_radar = (g, R, t, u) => radarAnim(g, R, t, u, true);

  // descodificador hiper-onda: anel de antenas e cristal central
  PAINT.hyper_wave_decoder = function (g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    disc(g, cx + 0.014, cy + 0.02, 0.32, 0x000000, 0.35);
    disc(g, cx, cy, 0.32, 0x3a3850);
    ring(g, cx, cy, 0.31, 0x6a6890, u * 1.5, 0.8);
    ring(g, cx, cy, 0.2, 0x24223a, 0.03, 0.9);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6;
      const x = cx + Math.cos(a) * 0.27, y = cy + Math.sin(a) * 0.27;
      line(g, cx + Math.cos(a) * 0.12, cy + Math.sin(a) * 0.12, x, y, 0x5a5878, u * 2, 0.9);
      disc(g, x + 0.008, y + 0.012, 0.035, 0x000000, 0.35);
      disc(g, x, y, 0.035, 0x8a88a8);
      disc(g, x, y, 0.018, 0x24223a);
    }
    ngon(g, cx, cy, 0.09, 4, 0);
    g.fillStyle = css(0x6a4aa0);
    g.fill();
    ngon(g, cx, cy, 0.05, 4, 0);
    g.fillStyle = css(0xc8b0ff);
    g.fill();
  };
  ANIM.hyper_wave_decoder = function (g, R, t, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 0.5) + k / 3) % 1;
      ring(g, cx, cy, 0.08 + ph * 0.3, P.violet, u * 1.5, 0.6 * (1 - ph));
    }
    glow(g, cx, cy, 0.16, P.violet, 0.35 + 0.2 * pulse(t, 1.6));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6;
      const on = Math.floor(t * 3) % 6 === k ? 1 : 0.3;
      disc(g, cx + Math.cos(a) * 0.27, cy + Math.sin(a) * 0.27, 0.012, P.cyan, on);
    }
  };

  // defesas: base de torre comum e cabeças por tipo (a cabeça roda na camada viva)
  function turretBase(g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (const [x, y, sx, sy] of [[R.x, R.y, 1, 1], [R.x + R.w, R.y, -1, 1], [R.x, R.y + R.h, 1, -1], [R.x + R.w, R.y + R.h, -1, -1]]) {
      g.save();
      poly(g, [x, y, x + sx * 0.14, y, x, y + sy * 0.14]);
      g.clip();
      hazard(g, Math.min(x, x + sx * 0.14), Math.min(y, y + sy * 0.14), 0.14, 0.14, 0.04, u);
      g.restore();
    }
    disc(g, cx + 0.014, cy + 0.02, 0.29, 0x000000, 0.35);
    ngon(g, cx, cy, 0.29, 12, 0);
    g.fillStyle = css(0x4a5048);
    g.fill();
    ring(g, cx, cy, 0.24, 0x2a2e28, 0.02, 0.9);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + Math.PI / 12;
      disc(g, cx + Math.cos(a) * 0.265, cy + Math.sin(a) * 0.265, 0.009, 0x8a9088);
    }
    // contentores de munição
    box(g, R.x + 0.03, R.y + R.h / 2 - 0.08, 0.06, 0.16, 0x5a6448, u, { r: 0.006 });
  }
  const TURRET = {
    missile_defence(g, u, t) {
      box(g, -0.15, -0.13, 0.3, 0.26, 0x6a7462, u, { r: 0.02 });
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
        const x = -0.09 + a * 0.09, y = -0.055 + b * 0.11;
        disc(g, x, y, 0.035, 0x1a1e18);
        disc(g, x, y, 0.022, 0xd0d4c8);
        disc(g, x, y - 0.004, 0.012, P.red);
      }
    },
    laser_defence(g, u, t) {
      rect(g, -0.025, -0.36, 0.05, 0.3, 0x5a6270);
      rect(g, -0.012, -0.36, 0.024, 0.3, 0x8a929e);
      disc(g, 0, 0, 0.14, 0x6a7280);
      disc(g, 0, 0, 0.1, 0x4a5260);
      disc(g, 0, -0.36, 0.022, 0xffd0c8);
      if (t !== null) glow(g, 0, -0.36, 0.08, P.red, 0.45 + 0.35 * pulse(t, 1.3));
    },
    plasma_defence(g, u, t) {
      rect(g, -0.07, -0.34, 0.035, 0.26, 0x5a6a5a);
      rect(g, 0.035, -0.34, 0.035, 0.26, 0x5a6a5a);
      disc(g, 0, 0, 0.15, 0x5f6a62);
      disc(g, 0, 0, 0.1, 0x3a4440);
      if (t !== null) {
        const p = pulse(t, 0.9);
        glow(g, 0, -0.3, 0.1, P.green, 0.5 + 0.3 * p);
        disc(g, 0, -0.3, 0.025 + 0.008 * p, 0xd0ffd8);
      }
    },
    fusion_defence(g, u, t) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU - Math.PI / 2;
        fillPoly(g, [Math.cos(a - 0.3) * 0.14, Math.sin(a - 0.3) * 0.14, Math.cos(a) * 0.28, Math.sin(a) * 0.28, Math.cos(a + 0.3) * 0.14, Math.sin(a + 0.3) * 0.14], 0x7a6a5a);
      }
      disc(g, 0, 0, 0.17, 0x8a7a6a);
      disc(g, 0, 0, 0.12, 0x2a2420);
      if (t !== null) {
        glow(g, 0, 0, 0.2, 0xff9040, 0.5 + 0.3 * pulse(t, 1.8));
        disc(g, 0, 0, 0.05, 0xfff0d0);
      }
    },
  };
  for (const id of Object.keys(TURRET)) {
    PAINT[id] = turretBase;
    ANIM[id] = function (g, R, t, u) {
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      const a = Math.sin(t * 0.25 + hashStr(id) % 7) * 0.9;
      g.save();
      g.translate(cx + 0.015, cy + 0.024);
      g.rotate(a);
      g.globalAlpha = 0.35;
      g.scale(1, 1);
      TURRET[id](shadowCtx(g), u, null);
      g.restore();
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      TURRET[id](g, u, t);
      g.restore();
    };
  }
  // contexto "sombra": as mesmas chamadas pintadas a preto (sem gradientes de brilho)
  function shadowCtx(g) {
    return new Proxy(g, {
      get(target, prop) {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return () => ({ addColorStop() {} });
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, prop, v) {
        if (prop === 'fillStyle' || prop === 'strokeStyle') v = typeof v === 'string' ? '#000' : 'rgba(0,0,0,0)';
        target[prop] = v;
        return true;
      },
    });
  }

  // escudo gravítico: grande emissor circular com 4 pilones
  PAINT.grav_shield = function (g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    disc(g, cx + 0.014, cy + 0.02, 0.3, 0x000000, 0.35);
    disc(g, cx, cy, 0.3, 0x34405a);
    for (let k = 1; k <= 4; k++) ring(g, cx, cy, 0.06 * k + 0.04, 0x1c2438, u * 1.5, 0.9);
    disc(g, cx, cy, 0.06, 0x8aa0d0);
    for (const [x, y] of [[R.x + 0.08, R.y + 0.08], [R.x + R.w - 0.08, R.y + 0.08], [R.x + 0.08, R.y + R.h - 0.08], [R.x + R.w - 0.08, R.y + R.h - 0.08]]) {
      box(g, x - 0.04, y - 0.04, 0.08, 0.08, 0x4a5670, u, { r: 0.01 });
      disc(g, x, y, 0.018, 0x1c2438);
    }
  };
  ANIM.grav_shield = function (g, R, t, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 0.35) + k / 3) % 1;
      ring(g, cx, cy, 0.06 + ph * 0.32, 0x7ab0ff, 0.012, 0.55 * (1 - ph));
    }
    glow(g, cx, cy, 0.14, 0x7ab0ff, 0.4 + 0.2 * pulse(t, 2.2));
    for (const [x, y] of [[R.x + 0.08, R.y + 0.08], [R.x + R.w - 0.08, R.y + 0.08], [R.x + 0.08, R.y + R.h - 0.08], [R.x + R.w - 0.08, R.y + R.h - 0.08]]) {
      glow(g, x, y, 0.05, 0x7ab0ff, 0.5 * pulse(t, 2.2, 0.5));
    }
  };

  // escudo mental: cúpula com espirais e três emissores
  PAINT.mind_shield = function (g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU - Math.PI / 2;
      const x = cx + Math.cos(a) * 0.3, y = cy + Math.sin(a) * 0.3;
      line(g, cx, cy, x, y, 0x4a3a60, 0.03, 0.9);
      disc(g, x + 0.008, y + 0.012, 0.045, 0x000000, 0.35);
      disc(g, x, y, 0.045, 0x6a5a88);
      disc(g, x, y, 0.02, 0x2a1e3a);
    }
    disc(g, cx + 0.014, cy + 0.02, 0.2, 0x000000, 0.4);
    const gr = g.createRadialGradient(cx - 0.06, cy - 0.06, 0, cx, cy, 0.2);
    gr.addColorStop(0, css(0xb8a8d8));
    gr.addColorStop(1, css(0x4a3a6a));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cy, 0.2, 0, TAU);
    g.fill();
    g.strokeStyle = css(0x2a1e3a, 0.6);
    g.lineWidth = u;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(cx + (k % 2 ? 0.04 : -0.04), cy + (k < 2 ? -0.04 : 0.04), 0.07, k, k + 3.6);
      g.stroke();
    }
  };
  ANIM.mind_shield = function (g, R, t, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    for (let k = 0; k < 2; k++) {
      const ph = ((t * 0.4) + k / 2) % 1;
      ring(g, cx, cy, 0.2 + ph * 0.16, P.violet, u * 1.5, 0.5 * (1 - ph));
    }
    glow(g, cx, cy, 0.24, P.violet, 0.18 + 0.12 * pulse(t, 2.8));
  };

  // laboratório psi: cadeiras em círculo à volta do amplificador
  PAINT.psi_lab = function (g, R, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    ring(g, cx, cy, 0.3, 0x5e5080, 0.02, 0.8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const x = cx + Math.cos(a) * 0.28, y = cy + Math.sin(a) * 0.28;
      g.save();
      g.translate(x, y);
      g.rotate(a + Math.PI / 2);
      box(g, -0.045, -0.035, 0.09, 0.08, 0x8a7ea6, u, { r: 0.016 });
      rect(g, -0.045, 0.025, 0.09, 0.025, 0x4a3e62);
      disc(g, 0, -0.012, 0.016, 0xd8ccf0, 0.5);
      g.restore();
    }
    disc(g, cx + 0.012, cy + 0.018, 0.1, 0x000000, 0.4);
    ngon(g, cx, cy, 0.1, 6, 0);
    g.fillStyle = css(0x3a3050);
    g.fill();
    ngon(g, cx, cy, 0.055, 6, Math.PI / 6);
    g.fillStyle = css(0xa080e0);
    g.fill();
  };
  ANIM.psi_lab = function (g, R, t, u) {
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
    glow(g, cx, cy, 0.22, P.violet, 0.3 + 0.2 * pulse(t, 3.1));
    g.save();
    g.translate(cx, cy);
    g.rotate(t * 0.6);
    g.strokeStyle = css(0xd8c8ff, 0.5);
    g.lineWidth = u;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(0, 0, 0.16, (k / 3) * TAU, (k / 3) * TAU + 0.8);
      g.stroke();
    }
    g.restore();
  };

  // instalação desconhecida: sala genérica com caixotes (não deve acontecer, mas nunca fica vazia)
  function paintGeneric(g, R, u, r) {
    for (let k = 0; k < 4; k++) box(g, R.x + 0.05 + r() * (R.w - 0.2), R.y + 0.05 + r() * (R.h - 0.2), 0.1, 0.1, 0x5a6470, u);
  }

  // ---- naves (vista de cima, nariz para cima; unidades 0..1) --------------------------------------------
  const CRAFT_ART = {
    skyranger(g, u, sh) {
      const body = sh ? 0 : 0x5f6b58, dk = sh ? 0 : 0x3e4838, hi = sh ? 0 : 0x7d8a72;
      // asa alta
      fillPoly(g, [0.5, 0.36, 0.95, 0.56, 0.93, 0.64, 0.5, 0.6, 0.07, 0.64, 0.05, 0.56], body);
      if (!sh) {
        line(g, 0.5, 0.38, 0.94, 0.57, hi, u, 0.8);
        line(g, 0.5, 0.38, 0.06, 0.57, hi, u, 0.8);
        fillPoly(g, [0.9, 0.555, 0.95, 0.56, 0.93, 0.64, 0.89, 0.62], P.amber);
        fillPoly(g, [0.1, 0.555, 0.05, 0.56, 0.07, 0.64, 0.11, 0.62], P.amber);
      }
      // motores de propulsão vertical
      for (const x of [0.26, 0.74]) {
        fillRR(g, x - 0.06, 0.5, 0.12, 0.3, 0.05, dk);
        if (!sh) {
          disc(g, x, 0.6, 0.04, 0x1a1e18);
          ring(g, x, 0.6, 0.04, 0x8a9480, u, 0.8);
          rect(g, x - 0.04, 0.78, 0.08, 0.02, 0x2a2e26);
        }
      }
      // fuselagem
      fillPoly(g, [0.5, 0.04, 0.6, 0.12, 0.63, 0.3, 0.63, 0.88, 0.58, 0.95, 0.42, 0.95, 0.37, 0.88, 0.37, 0.3, 0.4, 0.12], body);
      if (!sh) {
        fillPoly(g, [0.5, 0.07, 0.565, 0.14, 0.565, 0.21, 0.435, 0.21, 0.435, 0.14], 0x1e3a44);
        line(g, 0.47, 0.1, 0.45, 0.19, 0x8ad0e0, u, 0.6);
        line(g, 0.37, 0.32, 0.63, 0.32, dk, u, 0.9);
        line(g, 0.37, 0.7, 0.63, 0.7, dk, u, 0.9);
        line(g, 0.5, 0.22, 0.5, 0.92, hi, u, 0.5);
        rect(g, 0.38, 0.44, 0.24, 0.03, P.amber);
        // rampa traseira
        rect(g, 0.42, 0.88, 0.16, 0.06, dk);
      }
      // estabilizadores
      fillPoly(g, [0.37, 0.84, 0.22, 0.95, 0.37, 0.93], body);
      fillPoly(g, [0.63, 0.84, 0.78, 0.95, 0.63, 0.93], body);
    },
    interceptor(g, u, sh) {
      const body = sh ? 0 : 0x6f7c8a, dk = sh ? 0 : 0x48525e, hi = sh ? 0 : 0x9aa6b2;
      // asa delta
      fillPoly(g, [0.5, 0.34, 0.9, 0.78, 0.88, 0.84, 0.5, 0.78, 0.12, 0.84, 0.1, 0.78], body);
      // canards
      fillPoly(g, [0.5, 0.24, 0.68, 0.34, 0.66, 0.37, 0.5, 0.33, 0.34, 0.37, 0.32, 0.34], body);
      // derivas duplas
      fillPoly(g, [0.42, 0.7, 0.36, 0.93, 0.4, 0.93, 0.45, 0.78], dk);
      fillPoly(g, [0.58, 0.7, 0.64, 0.93, 0.6, 0.93, 0.55, 0.78], dk);
      // fuselagem
      fillPoly(g, [0.5, 0.02, 0.55, 0.14, 0.565, 0.4, 0.56, 0.9, 0.44, 0.9, 0.435, 0.4, 0.45, 0.14], body);
      if (!sh) {
        line(g, 0.5, 0.36, 0.89, 0.79, hi, u, 0.7);
        line(g, 0.5, 0.36, 0.11, 0.79, hi, u, 0.7);
        fillPoly(g, [0.5, 0.1, 0.53, 0.16, 0.53, 0.26, 0.47, 0.26, 0.47, 0.16], 0x1e3a50);
        line(g, 0.49, 0.13, 0.485, 0.22, 0x9ad8f0, u, 0.6);
        line(g, 0.5, 0.28, 0.5, 0.88, dk, u, 0.6);
        // mísseis nos pilones
        for (const x of [0.28, 0.72]) {
          rect(g, x - 0.012, 0.55, 0.024, 0.16, 0xd8dcd8);
          rect(g, x - 0.012, 0.55, 0.024, 0.025, P.red);
        }
        rect(g, 0.46, 0.9, 0.08, 0.025, 0x2a2e34);
        // marcas
        rect(g, 0.75, 0.73, 0.06, 0.02, P.amber);
        rect(g, 0.19, 0.73, 0.06, 0.02, P.amber);
      }
    },
    firestorm(g, u, sh) {
      const body = sh ? 0 : 0x7a7f96, dk = sh ? 0 : 0x4a4e64, hi = sh ? 0 : 0xaab0c8;
      // asas em crescente, varridas para a frente
      g.beginPath();
      g.moveTo(0.5, 0.42);
      g.quadraticCurveTo(0.8, 0.5, 0.96, 0.3);
      g.quadraticCurveTo(0.9, 0.62, 0.62, 0.8);
      g.lineTo(0.5, 0.72);
      g.lineTo(0.38, 0.8);
      g.quadraticCurveTo(0.1, 0.62, 0.04, 0.3);
      g.quadraticCurveTo(0.2, 0.5, 0.5, 0.42);
      g.closePath();
      g.fillStyle = css(body);
      g.fill();
      fillPoly(g, [0.5, 0.03, 0.59, 0.2, 0.62, 0.62, 0.56, 0.94, 0.44, 0.94, 0.38, 0.62, 0.41, 0.2], body);
      if (!sh) {
        fillPoly(g, [0.5, 0.08, 0.55, 0.18, 0.55, 0.3, 0.45, 0.3, 0.45, 0.18], 0x241c3a);
        line(g, 0.5, 0.32, 0.5, 0.9, dk, u, 0.8);
        // costuras de liga alienígena a brilhar
        g.strokeStyle = css(P.cyan, 0.75);
        g.lineWidth = u;
        g.beginPath();
        g.moveTo(0.52, 0.48);
        g.quadraticCurveTo(0.78, 0.53, 0.92, 0.36);
        g.moveTo(0.48, 0.48);
        g.quadraticCurveTo(0.22, 0.53, 0.08, 0.36);
        g.stroke();
        for (const x of [0.45, 0.55]) {
          glow(g, x, 0.95, 0.06, P.violet, 0.6);
          disc(g, x, 0.94, 0.02, 0xd8c8ff);
        }
      }
    },
    avenger(g, u, sh) {
      const body = sh ? 0 : 0x5c6274, dk = sh ? 0 : 0x3a3e4c, hi = sh ? 0 : 0x8a90a6;
      fillPoly(g, [0.5, 0.03, 0.98, 0.8, 0.86, 0.9, 0.62, 0.84, 0.5, 0.94, 0.38, 0.84, 0.14, 0.9, 0.02, 0.8], body);
      if (!sh) {
        line(g, 0.5, 0.05, 0.96, 0.79, hi, u, 0.7);
        line(g, 0.5, 0.05, 0.04, 0.79, hi, u, 0.5);
        // corcova central e cabina
        fillPoly(g, [0.5, 0.16, 0.6, 0.4, 0.6, 0.8, 0.4, 0.8, 0.4, 0.4], dk);
        fillPoly(g, [0.5, 0.2, 0.55, 0.3, 0.45, 0.3], 0x3a2a5a);
        line(g, 0.5, 0.32, 0.5, 0.78, hi, u, 0.4);
        // painéis
        for (const k of [0.45, 0.6, 0.72]) {
          const hw = (k - 0.03) * 0.62;
          line(g, 0.5 - hw, k + 0.03, 0.4, k + 0.03, dk, u, 0.7);
          line(g, 0.5 + hw, k + 0.03, 0.6, k + 0.03, dk, u, 0.7);
        }
        // motores de elério
        for (const [x, y] of [[0.26, 0.84], [0.5, 0.88], [0.74, 0.84]]) {
          glow(g, x, y, 0.08, P.teal, 0.6);
          disc(g, x, y, 0.025, 0xc8fff4);
        }
        disc(g, 0.15, 0.82, 0.012, P.red);
        disc(g, 0.85, 0.82, 0.012, P.green);
      }
    },
  };
  function craftGeneric(g, u, sh) {
    fillPoly(g, [0.5, 0.06, 0.85, 0.85, 0.5, 0.74, 0.15, 0.85], sh ? 0 : 0x6a7280);
  }

  // ---- caches ---------------------------------------------------------------------------------------------
  const cache = new Map(); // chave → canvas
  let pixels = 0;
  const BUDGET = 48e6;
  function put(key, c) {
    cache.set(key, c);
    pixels += c.width * c.height;
    while (pixels > BUDGET && cache.size > 1) {
      const k = cache.keys().next().value;
      const old = cache.get(k);
      cache.delete(k);
      pixels -= old.width * old.height;
    }
    return c;
  }
  function get(key) {
    const c = cache.get(key);
    if (c) {
      cache.delete(key);
      cache.set(key, c);
    }
    return c;
  }
  function clearCache() {
    cache.clear();
    pixels = 0;
    urls.clear();
  }
  const facDef = (type) => (OV.Data && OV.Data.facilities && OV.Data.facilities[type]) || null;
  const sizeOf = (type) => {
    const d = facDef(type);
    return d && d.size ? d.size : type === 'hangar' ? 2 : 1;
  };
  const GRID = () => (OV.Data && OV.Data.BASE_GRID) || 6;

  // sprite estático de uma instalação: px = lado de UMA célula em px do dispositivo
  function facilitySprite(type, cell, dpr) {
    const px = Math.max(8, Math.round(cell * dpr));
    const key = 'f|' + type + '|' + px + '|' + dpr;
    let c = get(key);
    if (c) return c;
    const n = sizeOf(type);
    c = makeCanvas(n * px, n * px);
    const g = c.getContext('2d');
    g.setTransform(px, 0, 0, px, 0, 0);
    const u = dpr / px; // 1 px CSS em unidades de célula
    const R = shell(g, n, n, FLOOR[type] || 0x353a40, u, TEX[type] || 'tile');
    (PAINT[type] || paintGeneric)(g, R, u, rng(hashStr(type)));
    return put(key, c);
  }
  // nave com sombra projetada embutida; px = lado do quadrado
  function craftSprite(type, sizeCss, dpr) {
    const px = Math.max(8, Math.round(sizeCss * dpr));
    const key = 'c|' + type + '|' + px + '|' + dpr;
    let c = get(key);
    if (c) return c;
    const pad = Math.ceil(px * 0.06);
    c = makeCanvas(px + pad, px + pad);
    const g = c.getContext('2d');
    const art = CRAFT_ART[type] || craftGeneric;
    const u = Math.min(0.02, dpr / px);
    g.setTransform(px, 0, 0, px, pad, pad);
    g.globalAlpha = 0.42;
    art(shadowCtx(g), u, true);
    g.globalAlpha = 1;
    g.setTransform(px, 0, 0, px, 0, 0);
    art(g, u, false);
    return put(key, c);
  }

  // fundo de rocha/terra (ruído calculado a 1 px CSS e ampliado) + pedras e marcas de célula
  function rockLayer(cell, dpr) {
    const key = 'r|' + cell + '|' + dpr;
    let c = get(key);
    if (c) return c;
    const N = GRID();
    const S = Math.round(N * cell);
    const lo = makeCanvas(S, S);
    const lg = lo.getContext('2d');
    if (lg.createImageData && lg.putImageData) {
      const img = lg.createImageData(S, S);
      const d = img.data;
      const R0 = Col.r8(P.rock2), G0 = Col.g8(P.rock2), B0 = Col.b8(P.rock2);
      const R1 = Col.r8(P.rockHi), G1 = Col.g8(P.rockHi), B1 = Col.b8(P.rockHi);
      const RV = Col.r8(P.vein), GV = Col.g8(P.vein), BV = Col.b8(P.vein);
      for (let y = 0; y < S; y++) {
        const cy = y / cell;
        for (let x = 0; x < S; x++) {
          const cx = x / cell;
          const n1 = vnoise(cx * 1.6, cy * 1.6, 11);
          const n2 = vnoise(cx * 5, cy * 5, 12);
          const n3 = vnoise(cx * 16, cy * 16, 13);
          // estratos inclinados
          const st = 0.5 + 0.5 * Math.sin((cy * 3.2 + cx * 0.5 + n1 * 2.2) * Math.PI);
          let v = 0.38 * n1 + 0.27 * n2 + 0.15 * n3 + 0.2 * st;
          v = Math.max(0, Math.min(1, (v - 0.22) * 1.5));
          let r = R0 + (R1 - R0) * v, gg = G0 + (G1 - G0) * v, b = B0 + (B1 - B0) * v;
          const vein = Math.abs(n2 - 0.5);
          if (vein < 0.025) {
            const k = (0.025 - vein) / 0.025 * 0.55;
            r += (RV - r) * k;
            gg += (GV - gg) * k;
            b += (BV - b) * k;
          }
          const i = (y * S + x) * 4;
          d[i] = r;
          d[i + 1] = gg;
          d[i + 2] = b;
          d[i + 3] = 255;
        }
      }
      lg.putImageData(img, 0, 0);
    } else {
      lg.fillStyle = css(P.rock);
      lg.fillRect(0, 0, S, S);
    }
    const W = Math.round(S * dpr);
    c = makeCanvas(W, W);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(lo, 0, 0, W, W);
    g.setTransform(cell * dpr, 0, 0, cell * dpr, 0, 0);
    const u = 1 / cell;
    const r = rng(0x5eed + cell);
    // pedras
    for (let k = 0; k < N * N * 7; k++) {
      const x = r() * N, y = r() * N, s = 0.012 + r() * r() * 0.05;
      g.save();
      g.translate(x, y);
      g.rotate(r() * TAU);
      g.scale(1, 0.55 + r() * 0.4);
      disc(g, 0.006, 0.008, s, 0x000000, 0.35);
      disc(g, 0, 0, s, mix(P.rock, P.rockHi, 0.2 + r() * 0.6));
      disc(g, -s * 0.3, -s * 0.3, s * 0.45, 0xffffff, 0.08);
      g.restore();
    }
    // fissuras
    g.lineCap = 'round';
    for (let k = 0; k < N * 2; k++) {
      let x = r() * N, y = r() * N, a = r() * TAU;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        a += (r() - 0.5) * 1.2;
        x += Math.cos(a) * 0.08;
        y += Math.sin(a) * 0.08;
        g.lineTo(x, y);
      }
      g.strokeStyle = css(0x120e0a, 0.45);
      g.lineWidth = u * 1.2;
      g.stroke();
    }
    // marcas de escavação nas células (ajuda a ver a grelha vazia)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const m = 0.1, l = 0.12;
        g.strokeStyle = css(0xc8b090, 0.16);
        g.lineWidth = u;
        g.beginPath();
        for (const [px, py, sx, sy] of [[x + m, y + m, 1, 1], [x + 1 - m, y + m, -1, 1], [x + m, y + 1 - m, 1, -1], [x + 1 - m, y + 1 - m, -1, -1]]) {
          g.moveTo(px + sx * l, py);
          g.lineTo(px, py);
          g.lineTo(px, py + sy * l);
        }
        g.stroke();
      }
    }
    // vinheta suave nas bordas
    const gr = g.createRadialGradient(N / 2, N / 2, N * 0.3, N / 2, N / 2, N * 0.75);
    gr.addColorStop(0, css(0x000000, 0));
    gr.addColorStop(1, css(0x000000, 0.45));
    g.fillStyle = gr;
    g.fillRect(0, 0, N, N);
    return put(key, c);
  }

  // ---- grelha: ocupação e corredores ----------------------------------------------------------------------
  function ownerMap(base) {
    const N = GRID();
    const own = new Int16Array(N * N).fill(-1);
    const grid = (base && base.grid) || [];
    for (let k = 0; k < grid.length; k++) {
      const f = grid[k];
      const n = sizeOf(f.type);
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
        const x = f.x + dx, y = f.y + dy;
        if (x >= 0 && y >= 0 && x < N && y < N) own[y * N + x] = k;
      }
    }
    return own;
  }
  // corredores entre células ortogonais de instalações diferentes
  function corridors(base, own) {
    const N = GRID();
    const out = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const a = own[y * N + x];
        if (a < 0) continue;
        if (x + 1 < N) {
          const b = own[y * N + x + 1];
          if (b >= 0 && b !== a) out.push({ x: x + 1, y: y + 0.5, h: true, a, b });
        }
        if (y + 1 < N) {
          const b = own[(y + 1) * N + x];
          if (b >= 0 && b !== a) out.push({ x: x + 0.5, y: y + 1, h: false, a, b });
        }
      }
    }
    return out;
  }
  function drawCorridor(g, c, building, u) {
    const L = (INSET + WT) * 2 + 0.02, W = 0.2;
    const x = c.h ? c.x - L / 2 : c.x - W / 2, y = c.h ? c.y - W / 2 : c.y - L / 2;
    const w = c.h ? L : W, h = c.h ? W : L;
    rect(g, x + 0.012, y + 0.02, w, h, 0x000000, 0.4);
    rect(g, x, y, w, h, P.wall);
    const fx = c.h ? x : x + 0.035, fy = c.h ? y + 0.035 : y, fw = c.h ? w : W - 0.07, fh = c.h ? W - 0.07 : h;
    rect(g, fx, fy, fw, fh, building ? 0x2a2824 : 0x4a5560);
    // grelha do pavimento
    for (let k = 1; k < 5; k++) {
      if (c.h) line(g, fx + (k * fw) / 5, fy, fx + (k * fw) / 5, fy + fh, 0x000000, u, 0.3);
      else line(g, fx, fy + (k * fh) / 5, fx + fw, fy + (k * fh) / 5, 0x000000, u, 0.3);
    }
    if (c.h) {
      line(g, x, y + 0.035, x + w, y + 0.035, P.wallHi, u, 0.6);
      line(g, x, y + h - 0.035, x + w, y + h - 0.035, P.wallLo, u, 0.9);
    } else {
      line(g, x + 0.035, y, x + 0.035, y + h, P.wallHi, u, 0.6);
      line(g, x + w - 0.035, y, x + w - 0.035, y + h, P.wallLo, u, 0.9);
    }
    // luz de presença
    disc(g, c.x, c.y, 0.012, building ? P.amber : 0xa8f0e8, 0.8);
  }

  // obra: fundações, sprite a meio tom, linhas de projeto, andaimes
  function drawConstruction(g, f, n, sprite, u) {
    const def = facDef(f.type);
    const total = Math.max(1, (def && def.days) || f.daysLeft || 1);
    const p = Math.max(0, Math.min(1, 1 - f.daysLeft / total));
    const i = INSET;
    const x0 = f.x + i, y0 = f.y + i, w = n - 2 * i, h = n - 2 * i;
    fillRR(g, x0 + 0.02, y0 + 0.03, w, h, 0.05, 0x000000, 0.45);
    fillRR(g, x0, y0, w, h, 0.05, 0x3a3027);
    g.save();
    rr(g, x0, y0, w, h, 0.05);
    g.clip();
    const r = rng(hashStr(f.type) ^ (f.x * 31 + f.y * 7));
    // terra remexida e laje de betão a crescer com o progresso
    for (let k = 0; k < 14 * n * n; k++) disc(g, x0 + r() * w, y0 + r() * h, 0.01 + r() * 0.035, r() < 0.5 ? 0x2a221a : 0x4a3e30, 0.6);
    const sw = w * (0.15 + 0.85 * p);
    rect(g, x0, y0, sw, h, 0x55534e);
    for (let k = 0.25; k < sw; k += 0.25) line(g, x0 + k, y0, x0 + k, y0 + h, 0x2e2c28, u, 0.8);
    for (let k = 0.25; k < h; k += 0.25) line(g, x0, y0 + k, x0 + sw, y0 + k, 0x2e2c28, u, 0.8);
    // varões de ferro na frente da laje
    for (let k = 0.04; k < h; k += 0.05) line(g, x0 + sw - 0.005, y0 + k, x0 + sw + 0.05, y0 + k, 0x9a6a48, u * 1.2, 0.9);
    // a instalação "cresce" sobre a laje, da esquerda para a direita
    g.save();
    g.beginPath();
    g.rect(x0, y0, sw, h);
    g.clip();
    g.globalAlpha = 0.5 + 0.4 * p;
    g.drawImage(sprite, f.x, f.y, n, n);
    g.restore();
    g.globalAlpha = 1;
    g.restore();
    // linhas de projeto
    g.save();
    g.setLineDash([0.04, 0.03]);
    rr(g, x0 + 0.05, y0 + 0.05, w - 0.1, h - 0.1, 0.03);
    g.strokeStyle = css(P.cyan, 0.45);
    g.lineWidth = u;
    g.stroke();
    g.restore();
    // andaimes: tubos ao longo das paredes, prumos e travamentos
    const tube = 0xb8c0c8, plank = 0x8a6a3a;
    const s = 0.035;
    for (const [ax, ay, bx, by] of [[x0, y0 + s, x0 + w, y0 + s], [x0, y0 + h - s, x0 + w, y0 + h - s], [x0 + s, y0, x0 + s, y0 + h], [x0 + w - s, y0, x0 + w - s, y0 + h]]) {
      line(g, ax + 0.01, ay + 0.015, bx + 0.01, by + 0.015, 0x000000, 0.022, 0.35);
      line(g, ax, ay, bx, by, plank, 0.04, 0.95);
      line(g, ax, ay, bx, by, shade(plank, -0.4), u, 0.6);
      const hz = ay === by ? 1 : 0;
      line(g, ax - 0.016 * (1 - hz), ay - 0.016 * hz, bx - 0.016 * (1 - hz), by - 0.016 * hz, tube, u * 1.6, 0.95);
      line(g, ax + 0.016 * (1 - hz), ay + 0.016 * hz, bx + 0.016 * (1 - hz), by + 0.016 * hz, tube, u * 1.6, 0.95);
    }
    const step = n > 1 ? 0.25 : 0.2;
    for (let k = 0; k <= w + 1e-6; k += step) {
      for (const yy of [y0 + s, y0 + h - s]) disc(g, x0 + k, yy, 0.016, tube);
      for (const xx of [x0 + s, x0 + w - s]) disc(g, xx, y0 + k, 0.016, tube);
    }
    // materiais: vigas e tubos empilhados, contentor de entulho
    const mx = Math.max(x0 + sw + 0.08, x0 + w - 0.26), my = y0 + h * 0.3;
    for (let k = 0; k < (sw < w - 0.3 ? 3 : 0); k++) {
      rect(g, mx + 0.012, my + k * 0.035 + 0.016, 0.2, 0.024, 0x000000, 0.35);
      rect(g, mx, my + k * 0.035, 0.2, 0.024, 0x8a8f96);
      line(g, mx, my + k * 0.035 + 0.012, mx + 0.2, my + k * 0.035 + 0.012, 0x4a5058, u, 0.9);
    }
    if (sw < w - 0.3) for (let k = 0; k < 4; k++) disc(g, mx + 0.03 + k * 0.032, y0 + h * 0.72, 0.016, 0x6a7078);
    box(g, x0 + 0.07, y0 + h * 0.55 - 0.05, 0.14, 0.09, 0xc07a20, u, { r: 0.008 });
    rect(g, x0 + 0.09, y0 + h * 0.55 - 0.03, 0.1, 0.05, 0x3a2e22);
    // fita de risco nos cantos
    hazard(g, x0 + w - 0.2, y0 + h - 0.05, 0.18, 0.03, 0.03, u);
  }

  // ---- camada estática da base (fundo + corredores + instalações + obras), em cache por assinatura ---------
  let staticKey = null, staticLayer = null;
  function signature(base, cell, dpr) {
    let s = cell + '|' + dpr + '|' + GRID();
    for (const f of (base && base.grid) || []) s += '|' + f.type + ',' + f.x + ',' + f.y + ',' + (f.daysLeft | 0);
    return s;
  }
  function buildStatic(base, cell, dpr) {
    const N = GRID();
    const m = Math.ceil(cell * 0.1);
    const W = Math.round((N * cell + 2 * m) * dpr);
    const c = makeCanvas(W, W);
    const g = c.getContext('2d');
    const k = cell * dpr;
    g.drawImage(rockLayer(cell, dpr), Math.round(m * dpr), Math.round(m * dpr));
    g.setTransform(k, 0, 0, k, m * dpr, m * dpr);
    const u = 1 / cell;
    const own = ownerMap(base);
    const grid = (base && base.grid) || [];
    for (const cor of corridors(base, own)) drawCorridor(g, cor, grid[cor.a].daysLeft > 0 || grid[cor.b].daysLeft > 0, u);
    for (const f of grid) {
      const n = sizeOf(f.type);
      const spr = facilitySprite(f.type, cell, dpr);
      if (f.daysLeft > 0) drawConstruction(g, f, n, spr, u);
      else g.drawImage(spr, f.x, f.y, n, n);
    }
    return { c, m };
  }

  // ---- geometria pública ---------------------------------------------------------------------------------
  function facilityAt(base, x, y) {
    const grid = (base && base.grid) || [];
    for (const f of grid) {
      const n = sizeOf(f.type);
      if (x >= f.x && y >= f.y && x < f.x + n && y < f.y + n) return f;
    }
    return null;
  }
  function cellAt(view, px, py) {
    const N = GRID();
    if (!view || !(view.cell > 0)) return null;
    const cell = cellOf(view);
    const x = Math.floor((px - view.x) / cell), y = Math.floor((py - view.y) / cell);
    return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
  }
  // encaixa a grelha num retângulo w×h (px CSS); célula inteira entre min e max
  function layout(w, h, opts) {
    opts = opts || {};
    const N = GRID();
    const pad = opts.pad === undefined ? 12 : opts.pad;
    const max = opts.maxCell || 112, min = opts.minCell || 28;
    const cell = Math.max(min, Math.min(max, Math.floor(Math.min(w - 2 * pad, h - 2 * pad) / N)));
    return { x: Math.round((w - N * cell) / 2), y: Math.round((h - N * cell) / 2), cell };
  }
  const cellOf = (view) => Math.max(8, Math.round(view.cell || 64));
  function facilityRect(view, f) {
    const n = sizeOf(f.type), c = cellOf(view);
    return { x: view.x + f.x * c, y: view.y + f.y * c, w: n * c, h: n * c };
  }
  const HOME = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  function craftList(base, view) {
    const ids = (base && base.crafts) || [];
    if (view && Array.isArray(view.crafts)) return ids.map((id, k) => view.crafts[k] || null);
    const G = view && view.G;
    return ids.map((id) => (G && G.crafts && G.crafts[id]) || null);
  }
  // hangares concluídos por ordem da grelha; a nave i de base.crafts ocupa o hangar i
  function hangarSlots(base, view) {
    const list = craftList(base, view);
    const ids = (base && base.crafts) || [];
    const out = [];
    for (const f of (base && base.grid) || []) {
      if (f.type !== 'hangar' && !(facDef(f.type) && facDef(f.type).crafts > 0)) continue;
      if (f.daysLeft > 0) continue;
      const k = out.length;
      out.push({ x: f.x, y: f.y, craftId: ids[k] || null, craft: list[k] || null });
    }
    return out;
  }
  // ocupantes por cela das instalações de contenção (até 4 silhuetas por instalação)
  function occupants(base) {
    const out = new Map();
    const al = (base && base.aliens) || {};
    const kinds = [];
    for (const id of Object.keys(al).sort()) for (let k = 0; k < (al[id] | 0); k++) kinds.push(hashStr(id) % 97);
    let left = kinds.length;
    let j = 0;
    for (const f of (base && base.grid) || []) {
      if (f.type !== 'alien_containment' || f.daysLeft > 0) continue;
      const cap = (facDef(f.type) && facDef(f.type).aliens) || 10;
      const here = Math.min(left, cap);
      left -= here;
      const pens = here > 0 ? Math.min(4, Math.ceil((here * 4) / cap)) : 0;
      const occ = [];
      for (let k = 0; k < 4; k++) occ.push(k < pens ? 1 + kinds[(j + k) % kinds.length] : 0);
      j += here;
      out.set(f, occ);
    }
    return out;
  }
  function animated(base) {
    for (const f of (base && base.grid) || []) if (f.daysLeft > 0 || ANIM[f.type]) return true;
    return false;
  }

  // ---- sobreposições vivas ---------------------------------------------------------------------------------
  function clockGlyph(g, x, y, r, col, lw) {
    ring(g, x, y, r, col, lw, 1);
    line(g, x, y, x, y - r * 0.65, col, lw, 1);
    line(g, x, y, x + r * 0.5, y, col, lw, 1);
  }
  function badge(g, X, Y, cell, days, t) {
    const h = Math.max(14, Math.round(cell * 0.24));
    const fs = Math.round(h * 0.68);
    g.font = '700 ' + fs + 'px "SF Mono", ui-monospace, Menlo, Consolas, monospace';
    const txt = String(days);
    const tw = g.measureText(txt).width;
    const w = Math.ceil(h * 0.95 + tw + h * 0.35);
    const x = X - w, y = Y;
    fillRR(g, x + 1, y + 2, w, h, h / 2, 0x000000, 0.45);
    fillRR(g, x, y, w, h, h / 2, 0x1b1203, 0.92);
    rr(g, x + 0.5, y + 0.5, w - 1, h - 1, h / 2);
    g.strokeStyle = css(P.amber, 0.95);
    g.lineWidth = 1;
    g.stroke();
    clockGlyph(g, x + h * 0.5, y + h / 2, h * 0.26, P.amber, Math.max(1, h / 12));
    g.fillStyle = css(P.amber);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(txt, x + h * 0.85, y + h / 2 + 0.5);
  }
  function outline(g, x, y, w, h, col, a, lw, dash, off) {
    g.save();
    if (dash) {
      g.setLineDash(dash);
      g.lineDashOffset = off || 0;
    }
    g.strokeStyle = css(col, a);
    g.lineWidth = lw;
    g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
    g.restore();
  }
  function brackets(g, x, y, w, h, col, a, lw, len) {
    g.strokeStyle = css(col, a);
    g.lineWidth = lw;
    g.beginPath();
    for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      g.moveTo(px + sx * len, py);
      g.lineTo(px, py);
      g.lineTo(px, py + sy * len);
    }
    g.stroke();
  }
  function hatch(g, x, y, w, h, col, a, gap, lw) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = css(col, a);
    g.lineWidth = lw;
    g.beginPath();
    for (let k = -h; k < w; k += gap) {
      g.moveTo(x + k, y + h);
      g.lineTo(x + k + h, y);
    }
    g.stroke();
    g.restore();
  }
  const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // ---- desenho principal -----------------------------------------------------------------------------------
  function draw(ctx, base, view) {
    const N = GRID();
    const cell = cellOf(view);
    const dpr = Math.max(1, Math.min(3, view.dpr || 1));
    const ox = Math.round((view.x || 0) * dpr) / dpr, oy = Math.round((view.y || 0) * dpr) / dpr;
    const t = typeof view.time === 'number' && Number.isFinite(view.time) ? view.time : 0;
    const grid = (base && base.grid) || [];
    const u = 1 / cell;

    // 1) camada estática
    const key = signature(base, cell, dpr);
    if (key !== staticKey || !staticLayer) {
      staticLayer = buildStatic(base, cell, dpr);
      staticKey = key;
    }
    const L = staticLayer;
    ctx.drawImage(L.c, ox - L.m, oy - L.m, L.c.width / dpr, L.c.height / dpr);
    // moldura discreta da grelha
    ctx.strokeStyle = css(P.line2, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, N * cell + 1, N * cell + 1);

    // 2) realce por tipo (ex.: o painel de capacidades aponta os laboratórios)
    const hl = asList(view.highlight);
    if (hl.length) {
      for (const f of grid) {
        if (!hl.includes(f.type)) continue;
        const n = sizeOf(f.type);
        const X = ox + f.x * cell, Y = oy + f.y * cell;
        fillRR(ctx, X + INSET * cell, Y + INSET * cell, (n - 2 * INSET) * cell, (n - 2 * INSET) * cell, 0.05 * cell, P.teal, 0.1 + 0.06 * pulse(t, 1.4));
        outline(ctx, X + 2, Y + 2, n * cell - 4, n * cell - 4, P.teal, 0.85, 2);
      }
    }

    // 3) animação + naves + ocupantes, em unidades de célula
    const occ = occupants(base);
    const slots = hangarSlots(base, view);
    const slotAt = new Map(slots.map((s) => [s.x + ',' + s.y, s]));
    for (const f of grid) {
      if (f.daysLeft > 0) continue;
      const n = sizeOf(f.type);
      const R = interior(n, n);
      const s = slotAt.get(f.x + ',' + f.y);
      const craft = s && s.craft && (!s.craft.status || HOME[s.craft.status]) ? s.craft : null;
      ctx.save();
      ctx.translate(ox + f.x * cell, oy + f.y * cell);
      ctx.scale(cell, cell);
      if (ANIM[f.type]) ANIM[f.type](ctx, R, t, u, { f, occupants: occ.get(f), service: craft && craft.status !== 'ready' ? craft.status : null });
      if (craft) {
        const def = OV.Data && OV.Data.crafts && OV.Data.crafts[craft.type];
        const scale = craft.type === 'avenger' ? 1.62 : craft.type === 'skyranger' ? 1.42 : craft.type === 'interceptor' ? 1.12 : def && def.transport ? 1.4 : 1.2;
        const spr = craftSprite(craft.type, scale * cell, dpr);
        const w = (spr.width / dpr) / cell;
        const pad = w - scale;
        ctx.drawImage(spr, n / 2 - scale / 2, n / 2 - scale / 2, scale + pad, scale + pad);
      }
      ctx.restore();
    }

    // 4) obras: farol a piscar, distintivo de dias e barra de progresso
    for (const f of grid) {
      if (!(f.daysLeft > 0)) continue;
      const n = sizeOf(f.type);
      const X = ox + f.x * cell, Y = oy + f.y * cell;
      const def = facDef(f.type);
      const total = Math.max(1, (def && def.days) || f.daysLeft);
      const p = Math.max(0, Math.min(1, 1 - f.daysLeft / total));
      const bx = X + (INSET + 0.06) * cell, by = Y + (INSET + 0.06) * cell;
      const on = Math.floor(t * 2.2 + f.x + f.y) % 2;
      glow(ctx, bx, by, cell * 0.16, P.amber, on ? 0.6 : 0.15);
      disc(ctx, bx, by, Math.max(2, cell * 0.028), on ? 0xffe0a0 : 0x7a5a20);
      badge(ctx, X + n * cell - (INSET + 0.03) * cell, Y + (INSET + 0.03) * cell, cell, f.daysLeft, t);
      const pw = (n - 2 * INSET - 0.12) * cell, ph = Math.max(3, Math.round(cell * 0.05));
      const px = X + (INSET + 0.06) * cell, py = Y + n * cell - (INSET + 0.06) * cell - ph;
      fillRR(ctx, px, py, pw, ph, ph / 2, 0x000000, 0.6);
      fillRR(ctx, px, py, Math.max(ph, pw * p), ph, ph / 2, P.amber, 0.9);
    }

    // 5) desmantelar
    if (view.dismantle) {
      const f = facilityAt(base, view.dismantle.x, view.dismantle.y);
      if (f) {
        const n = sizeOf(f.type);
        const X = ox + f.x * cell, Y = oy + f.y * cell, S = n * cell;
        const ok = view.dismantle.ok !== false;
        const col = ok ? P.red : P.amber;
        const a = 0.55 + 0.35 * pulse(t, 0.9);
        fillRR(ctx, X + INSET * cell, Y + INSET * cell, S - 2 * INSET * cell, S - 2 * INSET * cell, 0.05 * cell, col, 0.16);
        hatch(ctx, X + INSET * cell, Y + INSET * cell, S - 2 * INSET * cell, S - 2 * INSET * cell, col, 0.35, Math.max(6, cell * 0.12), Math.max(1.5, cell * 0.03));
        outline(ctx, X + 1, Y + 1, S - 2, S - 2, col, a, 2.5);
        const cx = X + S / 2, cy = Y + S / 2, r = Math.max(8, cell * 0.16);
        disc(ctx, cx, cy, r * 1.25, 0x000000, 0.55);
        if (ok) {
          line(ctx, cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6, col, Math.max(2, r * 0.28), 1);
          line(ctx, cx + r * 0.6, cy - r * 0.6, cx - r * 0.6, cy + r * 0.6, col, Math.max(2, r * 0.28), 1);
        } else {
          ring(ctx, cx, cy, r * 0.75, col, Math.max(2, r * 0.22), 1);
          line(ctx, cx - r * 0.5, cy + r * 0.5, cx + r * 0.5, cy - r * 0.5, col, Math.max(2, r * 0.22), 1);
        }
      }
    }

    // 6) seleção
    if (view.selection) {
      const f = facilityAt(base, view.selection.x, view.selection.y);
      const n = f ? sizeOf(f.type) : 1;
      const fx = f ? f.x : view.selection.x, fy = f ? f.y : view.selection.y;
      const X = ox + fx * cell, Y = oy + fy * cell, S = n * cell;
      outline(ctx, X + 1, Y + 1, S - 2, S - 2, P.amber, 0.45, 1.5);
      brackets(ctx, X + 1, Y + 1, S - 2, S - 2, P.amber, 1, 3, Math.max(8, cell * 0.2));
    }

    // 7) cursor (sem fantasma)
    if (view.hover && !view.ghost) {
      const hx = view.hover.x, hy = view.hover.y;
      if (hx >= 0 && hy >= 0 && hx < N && hy < N) {
        const f = facilityAt(base, hx, hy);
        const n = f ? sizeOf(f.type) : 1;
        const X = ox + (f ? f.x : hx) * cell, Y = oy + (f ? f.y : hy) * cell, S = n * cell;
        if (!f) fillRR(ctx, X + 3, Y + 3, S - 6, S - 6, 3, P.cyan, 0.08);
        outline(ctx, X + 1, Y + 1, S - 2, S - 2, P.cyan, 0.85, 1.5);
      }
    }

    // 8) fantasma de colocação
    const gh = view.ghost;
    if (gh && gh.type) {
      const n = sizeOf(gh.type);
      const X = ox + gh.x * cell, Y = oy + gh.y * cell, S = n * cell;
      const col = gh.valid ? P.green : P.red;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, N * cell, N * cell);
      ctx.clip();
      ctx.globalAlpha = gh.valid ? 0.78 : 0.5;
      ctx.drawImage(facilitySprite(gh.type, cell, dpr), X, Y, S, S);
      if (ANIM[gh.type]) {
        ctx.save();
        ctx.translate(X, Y);
        ctx.scale(cell, cell);
        ANIM[gh.type](ctx, interior(n, n), t, u, { f: gh, occupants: null, service: null });
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      fillRR(ctx, X + 2, Y + 2, S - 4, S - 4, 4, col, gh.valid ? 0.16 : 0.26);
      if (!gh.valid) hatch(ctx, X, Y, S, S, col, 0.45, Math.max(6, cell * 0.12), Math.max(1.5, cell * 0.025));
      outline(ctx, X + 1, Y + 1, S - 2, S - 2, col, 0.95, 2.5, [Math.max(4, cell * 0.1), Math.max(3, cell * 0.06)], -t * 18);
      ctx.restore();
    }
  }

  // ---- ícones para listas ------------------------------------------------------------------------------------
  const ICON_T = 0.6; // instante fixo da camada animada nos ícones
  function copyOf(w, h) {
    const c = makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    return c;
  }
  function facilityIcon(type, size, dpr) {
    dpr = Math.max(1, dpr || 1);
    size = Math.max(8, size || 48);
    const W = Math.round(size * dpr);
    const c = copyOf(W, W);
    const g = c.getContext('2d');
    const n = sizeOf(type);
    const k = W / n; // px por célula no ícone
    g.drawImage(facilitySprite(type, k / dpr, dpr), 0, 0, W, W);
    if (ANIM[type]) {
      g.setTransform(k, 0, 0, k, 0, 0);
      ANIM[type](g, interior(n, n), ICON_T, dpr / k, { f: { type, x: 0, y: 0, daysLeft: 0 }, occupants: type === 'alien_containment' ? [1, 0, 3, 0] : null, service: null });
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    return c;
  }
  function craftIcon(type, size, dpr) {
    dpr = Math.max(1, dpr || 1);
    size = Math.max(8, size || 48);
    const W = Math.round(size * dpr);
    const c = copyOf(W, W);
    const g = c.getContext('2d');
    const inner = Math.round(W * 0.92);
    const spr = craftSprite(type, inner / dpr, dpr);
    const off = Math.round((W - inner) / 2);
    g.drawImage(spr, off, off);
    return c;
  }
  const urls = new Map();
  function toURL(key, make) {
    let s = urls.get(key);
    if (s) return s;
    const c = make();
    s = c && typeof c.toDataURL === 'function' ? c.toDataURL('image/png') : '';
    if (s) urls.set(key, s);
    return s;
  }

  OV.BaseRender = {
    ANIM_FPS,
    draw,
    cellAt,
    layout,
    facilityAt,
    facilityRect,
    hangarSlots,
    animated,
    facilityIcon,
    craftIcon,
    facilityIconURL: (type, size, dpr) => toURL('f|' + type + '|' + size + '|' + (dpr || 1), () => facilityIcon(type, size, dpr)),
    craftIconURL: (type, size, dpr) => toURL('c|' + type + '|' + size + '|' + (dpr || 1), () => craftIcon(type, size, dpr)),
    hasArt: (type) => !!PAINT[type],
    hasCraftArt: (type) => !!CRAFT_ART[type],
    TYPES: Object.keys(PAINT),
    CRAFT_TYPES: Object.keys(CRAFT_ART),
    clearCache() {
      clearCache();
      staticKey = null;
      staticLayer = null;
    },
    stats: () => ({ entries: cache.size, pixels, staticKey }),
    setCanvasFactory(fn) {
      makeCanvas = fn;
      clearCache();
      staticKey = null;
      staticLayer = null;
    },
  };
})(globalThis.OV || (globalThis.OV = {}));
