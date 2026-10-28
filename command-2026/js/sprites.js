/* Desenho vetorial de unidades e edifícios (nítido em ecrãs Retina) + ícones da barra lateral */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const S = (CG.sprites = {});

  // ---------------------------------------------------------------- cores
  const rgbCache = {};
  // aceita '#rrggbb' e 'rgb(r,g,b)' (saída de shade())
  function rgb(col) {
    if (rgbCache[col]) return rgbCache[col];
    let v;
    if (col[0] === '#') {
      const h = col.slice(1);
      v = [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    } else {
      const m = col.match(/[\d.]+/g) || ['0', '0', '0'];
      v = [+m[0], +m[1], +m[2]];
    }
    rgbCache[col] = v;
    return v;
  }
  const shadeCache = {};
  function shade(hex, f) {
    const k = hex + f;
    if (shadeCache[k]) return shadeCache[k];
    const [r, g, b] = rgb(hex);
    const m = (c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
    const out = 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
    shadeCache[k] = out;
    return out;
  }
  function mix(a, b, t) {
    const A = rgb(a), B = rgb(b);
    const c = (i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
    return '#' + c(0) + c(1) + c(2);
  }
  function rgba(hex, a) {
    const [r, g, b] = rgb(hex);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  S.shade = shade;
  S.rgba = rgba;
  S.mix = mix;

  const FSTYLE = {
    atl: { metal: '#7f8a91', roof: '#8a949a', roof2: '#6d777e', pad: '#8e9396', uniform: '#5a6447', accent: '#dfe5ea' },
    eur: { metal: '#6c6a5c', roof: '#7a7466', roof2: '#5f5a4f', pad: '#8a857a', uniform: '#4e523e', accent: '#d2c49c' },
    van: { metal: '#7d6f57', roof: '#9a8564', roof2: '#7c684b', pad: '#a09079', uniform: '#6f6248', accent: '#e8cf93' },
    neutral: { metal: '#77746a', roof: '#8a867a', roof2: '#6d6a60', pad: '#8d8a80', uniform: '#5b5b4b', accent: '#ddd8c8' },
  };
  S.FSTYLE = FSTYLE;
  const hullCol = (col, st) => mix(col.main, st.metal, 0.38);

  // ---------------------------------------------------------------- primitivas
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  S.rr = rr;
  function circ(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, CG.TAU);
  }
  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, CG.TAU);
  }
  function line(ctx, x1, y1, x2, y2, w, c) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function hullFill(ctx, base, x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, shade(base, 0.25));
    g.addColorStop(0.5, base);
    g.addColorStop(1, shade(base, -0.3));
    return g;
  }

  // ---------------------------------------------------------------- infantaria
  function infantry(ctx, kind, col, st, t, moving) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ell(ctx, 1.2, 1.4, 4.6, 3.6);
    ctx.fill();
    const sw = moving ? Math.sin(t * 13) * 2.2 : 0;
    ctx.fillStyle = shade(st.uniform, -0.35);
    rr(ctx, -2 + sw, -3.4, 3.4, 2.1, 1);
    ctx.fill();
    rr(ctx, -2 - sw, 1.3, 3.4, 2.1, 1);
    ctx.fill();
    ctx.fillStyle = kind === 'militia' ? '#6b5e43' : kind === 'hacker' ? '#2d3038' : st.uniform;
    ell(ctx, 0, 0, 3.1, 4.3);
    ctx.fill();
    ctx.fillStyle = col.main;
    rr(ctx, -3.9, -2.2, 2, 4.4, 0.8);
    ctx.fill();
    switch (kind) {
      case 'sniper':
        line(ctx, 0.5, 1.6, 11, 1.6, 1.3, '#1c1c1c');
        ctx.fillStyle = '#333';
        ctx.fillRect(3, 0.5, 3, 1.1);
        break;
      case 'manpads':
        line(ctx, -4, -1.5, 7, -1.5, 2.6, '#4c5a33');
        ctx.fillStyle = '#222';
        ctx.fillRect(6.5, -2.8, 1.2, 2.6);
        break;
      case 'grenadier':
        line(ctx, 0.5, 1.6, 6.5, 1.6, 2.2, '#2a2a2a');
        break;
      case 'engineer':
        ctx.fillStyle = '#e8b923';
        ctx.fillRect(1.6, 1.2, 3.6, 2.6);
        ctx.fillStyle = '#7a5d0c';
        ctx.fillRect(2.6, 0.8, 1.6, 0.6);
        break;
      case 'hacker':
        ctx.fillStyle = '#1b1d22';
        ctx.fillRect(2, -2, 4.2, 4);
        ctx.fillStyle = 'rgba(80,250,255,' + (0.6 + Math.sin(t * 8) * 0.3) + ')';
        ctx.fillRect(2.4, -1.6, 3.4, 3.2);
        break;
      default:
        line(ctx, 0.5, 1.6, 8, 1.6, 1.4, '#1f1f1f');
    }
    let hc = shade(st.uniform, -0.15);
    if (kind === 'engineer') hc = '#f2c230';
    else if (kind === 'militia') hc = '#d9cfb4';
    else if (kind === 'hacker') hc = '#202228';
    ctx.fillStyle = hc;
    circ(ctx, 0.6, 0, 2.5);
    ctx.fill();
    if (kind !== 'engineer' && kind !== 'militia' && kind !== 'hacker') {
      ctx.fillStyle = col.light;
      ctx.fillRect(-0.3, -0.5, 1.6, 1);
    }
  }

  // ---------------------------------------------------------------- veículos
  function tracks(ctx, L, W, tw, t, moving) {
    for (const sy of [-1, 1]) {
      const y = sy * (W / 2 - tw / 2) - tw / 2;
      ctx.fillStyle = '#26282a';
      rr(ctx, -L / 2, y, L, tw, tw / 2.5);
      ctx.fill();
      ctx.strokeStyle = '#4a4d50';
      ctx.lineWidth = 1;
      const off = moving ? (t * 30) % 4 : 0;
      ctx.beginPath();
      for (let x = -L / 2 + 1 + off; x < L / 2 - 1; x += 4) {
        ctx.moveTo(x, y + 0.8);
        ctx.lineTo(x, y + tw - 0.8);
      }
      ctx.stroke();
    }
  }
  function wheels(ctx, xs, W, r) {
    ctx.fillStyle = '#1f2123';
    for (const x of xs) for (const sy of [-1, 1]) {
      ell(ctx, x, sy * (W / 2), r * 1.25, r * 0.75);
      ctx.fill();
    }
  }
  function barrel(ctx, x0, x1, w, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x0, -w / 2, x1 - x0, w);
    ctx.fillStyle = shade(c, -0.35);
    ctx.fillRect(x1 - 2.5, -w / 2 - 0.6, 2.5, w + 1.2);
  }
  function vShadow(ctx, L, W) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rr(ctx, -L / 2 + 2, -W / 2 + 2.5, L, W, 4);
    ctx.fill();
  }

  // a torre é desenhada já rodada (ta = ângulo relativo ao casco)
  const VEH = {
    tankA(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 27, 19);
      tracks(ctx, 27, 19, 5, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -7, 0, 14);
      rr(ctx, -12, -6.5, 24, 13, 2.5);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.25);
      ctx.fillRect(-11, -4, 4, 8);
      ctx.save();
      ctx.rotate(ta);
      barrel(ctx, 3, 19, 2.4, shade(h, -0.2));
      ctx.fillStyle = hullFill(ctx, shade(h, 0.08), 0, -6, 0, 12);
      poly(ctx, [-7, -5.5, 3, -6, 7, -3, 7, 3, 3, 6, -7, 5.5]);
      ctx.fill();
      ctx.strokeStyle = shade(h, -0.4);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = shade(h, -0.3);
      circ(ctx, -2.5, -2, 1.8);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-6.5, 2.5, 5, 1.6);
      ctx.restore();
    },
    tankE(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 30, 21);
      tracks(ctx, 30, 21, 6, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -7, 0, 14);
      rr(ctx, -13.5, -7, 27, 14, 2);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.3);
      for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 2.6, -4, 1.4, 8);
      ctx.save();
      ctx.rotate(ta);
      barrel(ctx, 4, 22, 2.8, shade(h, -0.25));
      ctx.fillStyle = hullFill(ctx, shade(h, 0.05), 0, -7, 0, 14);
      circ(ctx, -1, 0, 7.2);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.2);
      for (let k = 0; k < 6; k++) {
        const a = -1.2 + k * 0.48;
        ctx.fillRect(-1 + Math.cos(a) * 6 - 1, Math.sin(a) * 6 - 1, 2, 2);
      }
      ctx.fillStyle = c.main;
      circ(ctx, -3, 2.5, 1.6);
      ctx.fill();
      ctx.restore();
    },
    phantom(ctx, c, st, t, mv, ta) {
      const h = mix(hullCol(c, st), '#2c3036', 0.35);
      vShadow(ctx, 25, 17);
      tracks(ctx, 25, 17, 4.5, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -7, 0, 14);
      poly(ctx, [-12, -6.5, 8, -6.5, 13, 0, 8, 6.5, -12, 6.5]);
      ctx.fill();
      ctx.strokeStyle = shade(h, 0.25);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-9, -4);
      ctx.lineTo(7, -4);
      ctx.moveTo(-9, 4);
      ctx.lineTo(7, 4);
      ctx.stroke();
      ctx.save();
      ctx.rotate(ta);
      barrel(ctx, 3, 16, 2, shade(h, -0.2));
      ctx.fillStyle = shade(h, 0.1);
      poly(ctx, [-6, -4.5, 2, -5, 6, 0, 2, 5, -6, 4.5]);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-5, -1, 4, 2);
      ctx.restore();
    },
    ifv(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 23, 15);
      tracks(ctx, 23, 15, 3.6, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -6, 0, 12);
      poly(ctx, [-11, -5.5, 8, -5.5, 11.5, -2, 11.5, 2, 8, 5.5, -11, 5.5]);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.3);
      ctx.fillRect(-11, -3, 2, 6);
      ctx.save();
      ctx.rotate(ta);
      barrel(ctx, 2, 13, 1.4, '#2b2d2f');
      ctx.fillStyle = shade(h, 0.12);
      rr(ctx, -4, -3.5, 7, 7, 1.5);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-3.5, -1, 2.4, 2);
      ctx.restore();
    },
    apc(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 25, 15);
      wheels(ctx, [-8, -3, 3, 8], 13, 2.2);
      ctx.fillStyle = hullFill(ctx, h, 0, -6, 0, 12);
      poly(ctx, [-12, -5.5, 9, -5.5, 13, 0, 9, 5.5, -12, 5.5]);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.25);
      ctx.fillRect(-10, -2, 3, 4);
      ctx.save();
      ctx.rotate(ta);
      barrel(ctx, 2, 11, 1.3, '#2b2d2f');
      ctx.fillStyle = shade(h, 0.12);
      circ(ctx, 0, 0, 3.6);
      ctx.fill();
      ctx.fillStyle = c.main;
      circ(ctx, -1, 0, 1.2);
      ctx.fill();
      ctx.restore();
    },
    technical(ctx, c, st, t, mv, ta, rocket) {
      const h = mix(c.main, '#c9b48a', 0.55);
      vShadow(ctx, 21, 12);
      wheels(ctx, [-6, 6], 11, 2.4);
      ctx.fillStyle = hullFill(ctx, h, 0, -5, 0, 10);
      rr(ctx, -10, -5, 20, 10, 2);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.2);
      ctx.fillRect(-9, -4, 9, 8);
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(3, -4, 2.2, 8);
      ctx.fillStyle = shade(h, 0.2);
      ctx.fillRect(5.2, -4, 3.5, 8);
      ctx.save();
      ctx.translate(-4.5, 0);
      ctx.rotate(ta);
      if (rocket) {
        ctx.fillStyle = '#4a4f3a';
        rr(ctx, -4, -3.5, 9, 7, 1);
        ctx.fill();
        ctx.fillStyle = '#1d1f20';
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { circ(ctx, 2.4 + j * 1.8, -2 + i * 2, 0.7); ctx.fill(); }
      } else {
        barrel(ctx, 0, 9, 1.3, '#202224');
        ctx.fillStyle = '#3a3c3e';
        ctx.fillRect(-1.5, -1.5, 3, 3);
      }
      ctx.restore();
      ctx.fillStyle = c.main;
      ctx.fillRect(-9.5, -5, 1.4, 10);
    },
    rtech(ctx, c, st, t, mv, ta) {
      VEH.technical(ctx, c, st, t, mv, ta, true);
    },
    aa(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 25, 17);
      tracks(ctx, 25, 17, 4.5, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -6, 0, 12);
      rr(ctx, -11.5, -6, 23, 12, 2);
      ctx.fill();
      ctx.save();
      ctx.rotate(ta);
      ctx.fillStyle = '#2a2c2e';
      ctx.fillRect(2, -4.2, 13, 1.5);
      ctx.fillRect(2, 2.7, 13, 1.5);
      ctx.fillStyle = shade(h, 0.1);
      rr(ctx, -5, -5, 10, 10, 2);
      ctx.fill();
      ctx.save();
      ctx.translate(-3, 0);
      ctx.rotate(t * 4);
      ctx.fillStyle = '#c8d0d6';
      ctx.fillRect(-0.8, -3.5, 1.6, 7);
      ctx.restore();
      ctx.fillStyle = c.main;
      ctx.fillRect(1, -1, 3, 2);
      ctx.restore();
    },
    himars(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 27, 14);
      wheels(ctx, [-9, -3, 8], 13, 2.3);
      ctx.fillStyle = hullFill(ctx, h, 0, -6, 0, 12);
      rr(ctx, -13, -6, 26, 12, 2);
      ctx.fill();
      ctx.fillStyle = shade(h, 0.18);
      ctx.fillRect(6, -5.5, 6.5, 11);
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(11, -4.5, 1.5, 9);
      ctx.save();
      ctx.translate(-4, 0);
      ctx.rotate(ta);
      ctx.fillStyle = shade(h, -0.1);
      rr(ctx, -6, -5, 13, 10, 1);
      ctx.fill();
      ctx.fillStyle = '#1d1f20';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { circ(ctx, 3.5 + j * 2.2, -3 + i * 3, 0.9); ctx.fill(); }
      ctx.fillStyle = c.main;
      ctx.fillRect(-5, -1, 6, 2);
      ctx.restore();
    },
    arty(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 29, 19);
      tracks(ctx, 29, 19, 5, t, mv);
      ctx.fillStyle = hullFill(ctx, h, 0, -7, 0, 14);
      rr(ctx, -13.5, -6.5, 27, 13, 2);
      ctx.fill();
      ctx.save();
      ctx.translate(-3, 0);
      ctx.rotate(ta);
      barrel(ctx, 5, 24, 2.6, shade(h, -0.25));
      ctx.fillStyle = hullFill(ctx, shade(h, 0.06), 0, -7, 0, 14);
      rr(ctx, -8, -6.5, 14, 13, 2);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-7, -1.2, 5, 2.4);
      ctx.restore();
    },
    grad(ctx, c, st, t, mv, ta) {
      const h = hullCol(c, st);
      vShadow(ctx, 28, 15);
      wheels(ctx, [-9, -3, 3, 9], 13, 2.2);
      ctx.fillStyle = hullFill(ctx, h, 0, -6, 0, 12);
      rr(ctx, -13.5, -6, 27, 12, 2);
      ctx.fill();
      ctx.fillStyle = shade(h, 0.2);
      ctx.fillRect(7, -5.5, 6, 11);
      ctx.save();
      ctx.translate(-4, 0);
      ctx.rotate(ta);
      ctx.fillStyle = '#3c4232';
      rr(ctx, -7, -5.5, 15, 11, 1);
      ctx.fill();
      ctx.fillStyle = '#16181a';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) ctx.fillRect(1 + i * 1.7, -4.6 + j * 2.1, 1.2, 1.2);
      ctx.restore();
    },
    harvester(ctx, c, st, t, mv, ta, carry) {
      const h = mix(c.main, '#c7a43d', 0.55);
      vShadow(ctx, 31, 21);
      wheels(ctx, [-10, -2, 9], 19, 3.2);
      ctx.fillStyle = hullFill(ctx, h, 0, -9, 0, 18);
      rr(ctx, -14, -8.5, 25, 17, 2.5);
      ctx.fill();
      ctx.fillStyle = '#3d3f41';
      rr(ctx, 11, -9.5, 5, 19, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#6d7073';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let y = -8; y <= 8; y += 3) { ctx.moveTo(11.5, y); ctx.lineTo(15.5, y); }
      ctx.stroke();
      ctx.fillStyle = shade(h, -0.35);
      rr(ctx, -12.5, -6.5, 15, 13, 1.5);
      ctx.fill();
      if (carry > 0) {
        const n = Math.ceil(carry * 9);
        for (let i = 0; i < n; i++) {
          const x = -11 + (i % 3) * 4.6, y = -5 + Math.floor(i / 3) * 4;
          ctx.fillStyle = i % 2 ? '#3ff0cf' : '#9c6bff';
          poly(ctx, [x, y + 3, x + 1.8, y, x + 3.6, y + 3]);
          ctx.fill();
        }
      }
      ctx.fillStyle = shade(h, 0.15);
      rr(ctx, 3, -8, 7, 7, 1.5);
      ctx.fill();
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(8, -7, 1.6, 5);
      ctx.fillStyle = c.main;
      ctx.fillRect(3, 2, 7, 2);
    },
    mcv(ctx, c, st, t, mv) {
      const h = hullCol(c, st);
      vShadow(ctx, 35, 23);
      wheels(ctx, [-12, -5, 4, 11], 21, 3.2);
      ctx.fillStyle = hullFill(ctx, h, 0, -10, 0, 20);
      rr(ctx, -16, -10, 32, 20, 3);
      ctx.fill();
      ctx.fillStyle = shade(h, 0.18);
      rr(ctx, 8, -9, 8, 18, 2);
      ctx.fill();
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(14, -7.5, 1.8, 15);
      ctx.fillStyle = shade(h, -0.25);
      rr(ctx, -14, -7, 20, 14, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#e1b52b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, 4);
      ctx.lineTo(4, -4);
      ctx.stroke();
      ctx.fillStyle = c.main;
      ctx.fillRect(-15, -9.5, 3, 19);
      ctx.fillRect(-4, -1, 6, 2);
      ctx.fillStyle = '#ddd';
      circ(ctx, -6, 4, 1.2);
      ctx.fill();
    },
  };

  // ---------------------------------------------------------------- aeronaves (sem sombra; o renderizador desenha-a)
  function rotor(ctx, r, n, t, col) {
    ctx.fillStyle = 'rgba(20,20,20,0.16)';
    circ(ctx, 0, 0, r);
    ctx.fill();
    ctx.strokeStyle = col || 'rgba(30,30,30,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = t * 28 + (i * CG.TAU) / n;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
  }
  const AIR = {
    heliA(ctx, c, st, t) {
      const h = mix(c.main, '#3d4a3a', 0.45);
      line(ctx, -6, 0, -21, 0, 2.2, shade(h, -0.2));
      ctx.fillStyle = shade(h, -0.1);
      ctx.fillRect(-22, -4, 2.5, 8);
      ctx.fillStyle = '#222';
      ctx.fillRect(-7, -7.5, 4, 15);
      ctx.fillStyle = '#5b5f55';
      ctx.fillRect(-6.5, -8.5, 3, 2);
      ctx.fillRect(-6.5, 6.5, 3, 2);
      ctx.fillStyle = hullFill(ctx, h, 0, -4, 0, 8);
      ell(ctx, 0, 0, 11, 3.8);
      ctx.fill();
      ctx.fillStyle = '#9fd0e8';
      ell(ctx, 5.5, 0, 2.4, 1.6);
      ctx.fill();
      ell(ctx, 1.5, 0, 2.2, 1.5);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-4, -0.8, 3, 1.6);
      rotor(ctx, 15, 4, t);
    },
    heliE(ctx, c, st, t) {
      const h = mix(c.main, '#4a4a3a', 0.45);
      line(ctx, -7, 0, -22, 0, 2.6, shade(h, -0.2));
      ctx.fillStyle = shade(h, -0.1);
      ctx.fillRect(-23, -4.5, 3, 9);
      ctx.fillStyle = shade(h, -0.25);
      ctx.fillRect(-6, -10, 6, 20);
      ctx.fillStyle = '#2b2b2b';
      for (const y of [-9, -6, 6, 9]) { circ(ctx, -3, y, 1.4); ctx.fill(); }
      ctx.fillStyle = hullFill(ctx, h, 0, -5, 0, 10);
      ell(ctx, 0, 0, 12.5, 5);
      ctx.fill();
      ctx.fillStyle = '#a8d4e8';
      ell(ctx, 8, 0, 2.6, 2.4);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-5, -1, 4, 2);
      rotor(ctx, 16.5, 5, t);
    },
    droneScout(ctx, c, st, t) {
      ctx.fillStyle = '#c9ced2';
      rr(ctx, -2, -12, 4, 24, 1.5);
      ctx.fill();
      ctx.fillStyle = hullFill(ctx, '#d6dadd', 0, -2, 0, 4);
      ell(ctx, 0, 0, 7.5, 2);
      ctx.fill();
      ctx.fillStyle = '#bfc4c8';
      poly(ctx, [-6, 0, -9, -4, -8, 0, -9, 4]);
      ctx.fill();
      ctx.fillStyle = c.main;
      ctx.fillRect(-1.5, -11, 3, 2);
      ctx.fillRect(-1.5, 9, 3, 2);
      ctx.fillStyle = 'rgba(40,40,40,0.35)';
      ell(ctx, -8.5, 0, 0.8, 3.5 + Math.sin(t * 60));
      ctx.fill();
    },
    adrone(ctx, c, st, t) {
      const h = mix(c.main, '#9aa0a4', 0.6);
      ctx.fillStyle = shade(h, -0.05);
      poly(ctx, [1, -12, 3, -12, 2, 12, 0, 12]);
      ctx.fill();
      ctx.fillStyle = hullFill(ctx, h, 0, -2.5, 0, 5);
      ell(ctx, 0, 0, 9, 2.5);
      ctx.fill();
      ctx.fillStyle = shade(h, 0.25);
      ell(ctx, 6.5, 0, 3, 2.4);
      ctx.fill();
      ctx.fillStyle = shade(h, -0.2);
      poly(ctx, [-7, 0, -11, -5, -9.5, 0, -11, 5]);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(-1, -8, 4, 1.4);
      ctx.fillRect(-1, 6.6, 4, 1.4);
      ctx.fillStyle = c.main;
      ctx.fillRect(-4, -1, 3, 2);
      ctx.fillStyle = 'rgba(40,40,40,0.35)';
      ell(ctx, -9.5, 0, 0.8, 3 + Math.sin(t * 60));
      ctx.fill();
    },
    kdrone(ctx, c) {
      ctx.fillStyle = mix(c.main, '#5a5a50', 0.3);
      poly(ctx, [6, 0, -4, -5, -2, 0, -4, 5]);
      ctx.fill();
      ctx.fillStyle = '#ff5a3a';
      circ(ctx, 3, 0, 1);
      ctx.fill();
    },
    swarmIcon(ctx, c, st, t) {
      for (const [x, y] of [[-6, -6], [6, -4], [-4, 6], [7, 7]]) {
        ctx.save();
        ctx.translate(x, y);
        AIR.kdrone(ctx, c, st, t);
        ctx.restore();
      }
    },
  };

  const INF_KIND = { rifle: 'rifle', sniper: 'sniper', manpads: 'manpads', grenadier: 'grenadier', engineer: 'engineer', hacker: 'hacker', militia: 'militia' };

  // desenha a unidade centrada na origem (o chamador faz translate)
  S.drawUnit = function (ctx, def, owner, fid, angle, turret, t, moving, carry) {
    const c = CG.colorOf(owner);
    const st = FSTYLE[fid] || FSTYLE.neutral;
    ctx.save();
    ctx.rotate(angle);
    const d = def.draw;
    if (INF_KIND[d]) infantry(ctx, INF_KIND[d], c, st, t, moving);
    else if (VEH[d]) VEH[d](ctx, c, st, t, moving, CG.angDiff(angle, turret), carry);
    else if (AIR[d]) AIR[d](ctx, c, st, t);
    ctx.restore();
  };
  S.airShadow = function (ctx, def, angle) {
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    if (def.draw === 'kdrone') { poly(ctx, [6, 0, -4, -5, -2, 0, -4, 5]); ctx.fill(); }
    else if (def.draw === 'droneScout' || def.draw === 'adrone') {
      ctx.fillRect(-1, -11, 3, 22);
      ell(ctx, 0, 0, 8, 2.2);
      ctx.fill();
    } else {
      ell(ctx, 0, 0, 12, 4.5);
      ctx.fill();
      ctx.fillRect(-21, -1, 14, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      circ(ctx, 0, 0, 15);
      ctx.fill();
    }
    ctx.restore();
  };

  // ---------------------------------------------------------------- edifícios (parte estática)
  function slab(ctx, W, H, st) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(4, 5, W, H);
    ctx.fillStyle = st.pad;
    rr(ctx, 1, 1, W - 2, H - 2, 3);
    ctx.fill();
    ctx.strokeStyle = shade(st.pad, -0.15);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = T; x < W - 1; x += T) { ctx.moveTo(x, 2); ctx.lineTo(x, H - 2); }
    for (let y = T; y < H - 1; y += T) { ctx.moveTo(2, y); ctx.lineTo(W - 2, y); }
    ctx.stroke();
    ctx.strokeStyle = shade(st.pad, -0.35);
    rr(ctx, 1, 1, W - 2, H - 2, 3);
    ctx.stroke();
  }
  // bloco em perspetiva 3/4: telhado + parede sul
  function block(ctx, x, y, w, h, wall, roof) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x + 4, y + 4, w, h);
    const wg = ctx.createLinearGradient(0, y + h - wall, 0, y + h);
    wg.addColorStop(0, shade(roof, -0.35));
    wg.addColorStop(1, shade(roof, -0.55));
    ctx.fillStyle = wg;
    ctx.fillRect(x, y + h - wall, w, wall);
    const rg = ctx.createLinearGradient(x, y, x + w, y + h);
    rg.addColorStop(0, shade(roof, 0.18));
    rg.addColorStop(1, shade(roof, -0.08));
    ctx.fillStyle = rg;
    ctx.fillRect(x, y, w, h - wall);
    ctx.strokeStyle = shade(roof, 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - wall - 1);
  }
  function stripes(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#e5b82a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1e1e1e';
    for (let i = -h; i < w; i += 6) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + 3, y + h);
      ctx.lineTo(x + i + 3 + h, y);
      ctx.lineTo(x + i + h, y);
      ctx.fill();
    }
    ctx.restore();
  }
  function silo(ctx, x, y, r, col) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    circ(ctx, x + 3, y + 4, r);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(col, 0.4));
    g.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = g;
    circ(ctx, x, y, r);
    ctx.fill();
    ctx.strokeStyle = shade(col, -0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function sandbags(ctx, cx, cy, r, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * CG.TAU;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = i % 2 ? '#b7a57a' : '#a8966b';
      rr(ctx, -3.4, -2, 6.8, 4, 1.8);
      ctx.fill();
      ctx.restore();
    }
  }

  const BLD = {
    conyard(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      block(ctx, 8, 10, 62, 58, 12, st.roof);
      ctx.fillStyle = c.main;
      ctx.fillRect(10, 14, 58, 5);
      ctx.fillStyle = shade(st.roof, -0.2);
      for (let i = 0; i < 4; i++) ctx.fillRect(14 + i * 14, 24, 8, 18);
      stripes(ctx, 24, 58, 30, 8);
      block(ctx, 72, 40, 18, 40, 8, st.roof2);
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(74, 44, 14, 6);
      ctx.fillStyle = shade(st.pad, -0.25);
      circ(ctx, 22, 82, 9);
      ctx.fill();
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(18.5, 77.5); ctx.lineTo(18.5, 86.5);
      ctx.moveTo(25.5, 77.5); ctx.lineTo(25.5, 86.5);
      ctx.moveTo(18.5, 82); ctx.lineTo(25.5, 82);
      ctx.stroke();
    },
    power(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      silo(ctx, 20, 21, 13, '#b9b4a8');
      silo(ctx, 44, 40, 13, '#b9b4a8');
      for (const [x, y] of [[20, 21], [44, 40]]) {
        ctx.fillStyle = '#3a3a36';
        circ(ctx, x, y, 7.5);
        ctx.fill();
      }
      block(ctx, 40, 6, 18, 18, 6, st.roof2);
      stripes(ctx, 41, 18, 16, 3);
      block(ctx, 6, 42, 20, 16, 6, st.roof2);
      ctx.fillStyle = c.main;
      ctx.fillRect(8, 44, 16, 3);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(26, 50);
      ctx.lineTo(31, 40);
      ctx.stroke();
    },
    refinery(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      block(ctx, 6, 6, 44, 46, 11, st.roof);
      ctx.fillStyle = c.main;
      ctx.fillRect(8, 9, 40, 4);
      ctx.fillStyle = shade(st.roof, -0.2);
      ctx.fillRect(12, 18, 10, 14);
      ctx.fillRect(28, 18, 14, 8);
      silo(ctx, 68, 18, 12, '#cfc7b4');
      silo(ctx, 84, 40, 10, '#cfc7b4');
      ctx.fillStyle = '#6a6e70';
      ctx.fillRect(48, 22, 10, 3);
      ctx.fillRect(70, 30, 3, 14);
      ctx.fillStyle = '#4b4f52';
      ctx.fillRect(40, 50, 16, 14);
      stripes(ctx, 40, 59, 16, 5);
      ctx.fillStyle = '#3ff0cf';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(43, 52, 10, 4);
      ctx.globalAlpha = 1;
    },
    barracks(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      for (const [x, y] of [[6, 8], [6, 34]]) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 4, y + 4, 40, 20);
        const g = ctx.createLinearGradient(0, y, 0, y + 20);
        g.addColorStop(0, shade(st.uniform, 0.3));
        g.addColorStop(0.5, st.uniform);
        g.addColorStop(1, shade(st.uniform, -0.4));
        ctx.fillStyle = g;
        rr(ctx, x, y, 40, 20, 9);
        ctx.fill();
        ctx.strokeStyle = shade(st.uniform, -0.35);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 6; i < 40; i += 6) { ctx.moveTo(x + i, y + 1); ctx.lineTo(x + i, y + 19); }
        ctx.stroke();
      }
      ctx.fillStyle = '#b7a57a';
      for (let i = 0; i < 6; i++) { rr(ctx, 48 + (i % 2) * 6, 6 + i * 8, 7, 5, 2); ctx.fill(); }
      ctx.fillStyle = '#555';
      ctx.fillRect(55, 52, 2, 2);
    },
    factory(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      block(ctx, 4, 6, 88, 72, 16, st.roof);
      ctx.strokeStyle = shade(st.roof, -0.18);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 12; x < 90; x += 10) { ctx.moveTo(x, 8); ctx.lineTo(x, 60); }
      ctx.stroke();
      ctx.fillStyle = c.main;
      ctx.fillRect(6, 9, 84, 5);
      ctx.fillStyle = 'rgba(160,210,240,0.55)';
      ctx.fillRect(20, 30, 14, 8);
      ctx.fillRect(62, 30, 14, 8);
      ctx.fillStyle = '#2e3133';
      ctx.fillRect(30, 62, 36, 16);
      stripes(ctx, 30, 62, 36, 3);
      ctx.fillStyle = shade(st.pad, -0.2);
      ctx.fillRect(34, 80, 28, 14);
    },
    radar(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      block(ctx, 6, 26, 52, 32, 10, st.roof);
      ctx.fillStyle = c.main;
      ctx.fillRect(8, 29, 48, 3);
      ctx.fillStyle = '#2a3a44';
      ctx.fillRect(12, 50, 10, 4);
      ctx.fillRect(28, 50, 10, 4);
      ctx.fillStyle = '#5c6064';
      ctx.fillRect(29, 12, 6, 18);
      silo(ctx, 32, 14, 6, '#8a8f93');
    },
    airfield(ctx, W, H, c, st) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(4, 5, W, H);
      ctx.fillStyle = '#4a4d50';
      rr(ctx, 1, 1, W - 2, H - 2, 3);
      ctx.fill();
      ctx.strokeStyle = '#e8e8e8';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(6, H - 8);
      ctx.lineTo(W - 30, H - 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#5b5f62';
      circ(ctx, 26, 26, 18);
      ctx.fill();
      ctx.strokeStyle = '#e8c33a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(20, 18); ctx.lineTo(20, 34);
      ctx.moveTo(32, 18); ctx.lineTo(32, 34);
      ctx.moveTo(20, 26); ctx.lineTo(32, 26);
      ctx.stroke();
      block(ctx, 64, 8, 26, 30, 9, st.roof);
      ctx.fillStyle = 'rgba(150,215,245,0.8)';
      ctx.fillRect(68, 12, 18, 8);
      ctx.fillStyle = c.main;
      ctx.fillRect(66, 26, 22, 3);
    },
    tech(ctx, W, H, c, st) {
      slab(ctx, W, H, st);
      block(ctx, 6, 8, 52, 48, 10, st.roof2);
      const g = ctx.createRadialGradient(28, 24, 2, 32, 28, 16);
      g.addColorStop(0, '#e8f4ff');
      g.addColorStop(1, '#7c8a96');
      ctx.fillStyle = g;
      circ(ctx, 32, 28, 15);
      ctx.fill();
      ctx.fillStyle = '#26323e';
      for (let i = 0; i < 3; i++) ctx.fillRect(9 + i * 9, 12, 7, 5);
      ctx.fillStyle = c.main;
      ctx.fillRect(8, 44, 48, 3);
    },
    towerMg(ctx, W, H, c, st) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      circ(ctx, 19, 20, 13);
      ctx.fill();
      ctx.fillStyle = shade(st.pad, -0.1);
      circ(ctx, 16, 16, 12);
      ctx.fill();
      sandbags(ctx, 16, 16, 11.5, 12);
    },
    towerAt(ctx, W, H, c, st) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(6, 6, 28, 28);
      ctx.fillStyle = shade(st.pad, -0.05);
      poly(ctx, [4, 8, 8, 4, 24, 4, 28, 8, 28, 24, 24, 28, 8, 28, 4, 24]);
      ctx.fill();
      ctx.strokeStyle = shade(st.pad, -0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = c.main;
      ctx.fillRect(6, 24, 20, 2);
    },
    sam(ctx, W, H, c, st) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      circ(ctx, 19, 19, 13);
      ctx.fill();
      ctx.fillStyle = shade(st.pad, -0.05);
      circ(ctx, 16, 16, 13);
      ctx.fill();
      ctx.strokeStyle = '#e5b82a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = c.main;
      circ(ctx, 16, 16, 4);
      ctx.fill();
    },
    derrick(ctx, W, H, c, st) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(4, 5, 30, 30);
      ctx.fillStyle = '#5d564a';
      rr(ctx, 1, 1, 30, 30, 3);
      ctx.fill();
      for (const [x, y] of [[6, 25], [11, 26], [25, 6]]) {
        ctx.fillStyle = '#3d3a33';
        circ(ctx, x, y, 3);
        ctx.fill();
        ctx.fillStyle = c.main;
        circ(ctx, x, y, 1.6);
        ctx.fill();
      }
    },
  };

  const MARGIN = 10;
  const bldCache = new Map();
  S.buildingSprite = function (type, owner, fid, scale) {
    const key = type + '|' + owner + '|' + fid + '|' + scale;
    let cv = bldCache.get(key);
    if (cv) return cv;
    const def = CG.BUILDINGS[type];
    const W = def.w * T, H = def.h * T;
    cv = document.createElement('canvas');
    cv.width = Math.ceil((W + MARGIN * 2) * scale);
    cv.height = Math.ceil((H + MARGIN * 2) * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(MARGIN, MARGIN);
    BLD[def.draw](ctx, W, H, CG.colorOf(owner), FSTYLE[fid] || FSTYLE.neutral);
    bldCache.set(key, cv);
    return cv;
  };
  S.MARGIN = MARGIN;
  S.clearCache = () => { bldCache.clear(); iconCache.clear(); };

  // partes animadas/rotativas dos edifícios (coordenadas locais: canto superior esquerdo do edifício)
  S.drawBuildingLive = function (ctx, b, fid, t) {
    const def = b.def;
    const c = CG.colorOf(b.owner);
    const st = FSTYLE[fid] || FSTYLE.neutral;
    const off = b.disabled > 0 || (def.needsPower && CG.G && CG.G.players[b.owner] && CG.G.players[b.owner].lowPower);
    switch (def.draw) {
      case 'conyard': {
        ctx.save();
        ctx.translate(81, 30);
        ctx.rotate(Math.sin(t * 0.4 + b.anim) * 0.9 - 0.6);
        ctx.fillStyle = '#e5b82a';
        ctx.fillRect(-2, -2, 30, 4);
        ctx.fillStyle = '#7a6a2a';
        ctx.fillRect(24, -1, 6, 2);
        ctx.restore();
        ctx.fillStyle = '#e5b82a';
        circ(ctx, 81, 30, 4);
        ctx.fill();
        break;
      }
      case 'radar': {
        ctx.save();
        ctx.translate(32, 14);
        const a = off ? 0.3 : t * 1.6 + b.anim;
        ctx.scale(Math.cos(a), 1);
        ctx.fillStyle = '#d7dde2';
        ell(ctx, 0, 0, 12, 7);
        ctx.fill();
        ctx.strokeStyle = '#7d868c';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'tech': {
        const pulse = off ? 0 : 0.35 + Math.sin(t * 3 + b.anim) * 0.25;
        ctx.strokeStyle = 'rgba(120,230,255,' + pulse + ')';
        ctx.lineWidth = 3;
        circ(ctx, 32, 28, 17);
        ctx.stroke();
        break;
      }
      case 'barracks': {
        ctx.fillStyle = '#555';
        ctx.fillRect(56, 30, 1.5, 24);
        ctx.fillStyle = c.main;
        ctx.beginPath();
        ctx.moveTo(57.5, 30);
        for (let i = 0; i <= 4; i++) ctx.lineTo(57.5 + i * 3, 30 + Math.sin(t * 6 + i) * 1.2);
        for (let i = 4; i >= 0; i--) ctx.lineTo(57.5 + i * 3, 37 + Math.sin(t * 6 + i) * 1.2);
        ctx.fill();
        break;
      }
      case 'power': {
        if (off) break;
        for (const [x, y] of [[20, 21], [44, 40]]) {
          for (let k = 0; k < 3; k++) {
            const ph = (t * 0.6 + k / 3 + x * 0.01) % 1;
            ctx.fillStyle = 'rgba(235,235,235,' + (0.35 * (1 - ph)) + ')';
            circ(ctx, x + ph * 6, y - ph * 18, 4 + ph * 8);
            ctx.fill();
          }
        }
        break;
      }
      case 'airfield': {
        ctx.fillStyle = '#ff8a2a';
        ctx.save();
        ctx.translate(90, 44);
        ctx.rotate(0.4 + Math.sin(t * 2) * 0.2);
        poly(ctx, [0, -2, 8, -1, 8, 1, 0, 2]);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = (Math.floor(t * 2) % 2) ? '#ff3a3a' : '#5a1a1a';
        circ(ctx, 64, 8, 1.6);
        ctx.fill();
        break;
      }
      case 'derrick': {
        const a = Math.sin(t * 2.5 + b.anim) * 0.35;
        ctx.fillStyle = '#2f2c27';
        ctx.fillRect(14, 10, 3, 14);
        ctx.save();
        ctx.translate(15.5, 12);
        ctx.rotate(a);
        ctx.fillStyle = b.owner >= 0 ? c.main : '#8a8576';
        ctx.fillRect(-12, -2, 22, 4);
        ctx.fillStyle = '#2f2c27';
        poly(ctx, [-14, -5, -10, -5, -10, 5, -14, 5]);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'towerMg':
      case 'towerAt':
      case 'sam': {
        ctx.save();
        ctx.translate(16, 16);
        ctx.rotate(b.turret);
        if (def.draw === 'towerMg') {
          ctx.fillStyle = '#2b2d2f';
          ctx.fillRect(0, -1.2, 13, 2.4);
          ctx.fillStyle = shade(st.uniform, 0);
          circ(ctx, 0, 0, 5);
          ctx.fill();
          ctx.fillStyle = c.main;
          circ(ctx, -1, 0, 2);
          ctx.fill();
        } else if (def.draw === 'towerAt') {
          ctx.fillStyle = shade(st.metal, 0.1);
          rr(ctx, -7, -7, 14, 14, 2);
          ctx.fill();
          ctx.fillStyle = '#35393c';
          ctx.fillRect(2, -6, 11, 4.5);
          ctx.fillRect(2, 1.5, 11, 4.5);
          ctx.fillStyle = c.main;
          ctx.fillRect(-6, -1.5, 5, 3);
        } else {
          ctx.fillStyle = shade(st.metal, 0.05);
          rr(ctx, -6, -8, 12, 16, 2);
          ctx.fill();
          ctx.fillStyle = '#e8e8e8';
          for (const y of [-6.5, -2.5, 1.5, 5.5]) {
            ctx.fillRect(-4, y - 0.9, 13, 1.8);
            ctx.fillStyle = '#c33';
            ctx.fillRect(8, y - 0.9, 2, 1.8);
            ctx.fillStyle = '#e8e8e8';
          }
        }
        ctx.restore();
        break;
      }
    }
  };

  // ---------------------------------------------------------------- ícones
  const iconCache = new Map();
  S.icon = function (typeId, owner, fid) {
    const key = typeId + '|' + owner + '|' + fid;
    let cv = iconCache.get(key);
    if (cv) return cv;
    const def = CG.typeDef(typeId);
    const R = 2;
    cv = document.createElement('canvas');
    cv.width = 112 * R;
    cv.height = 64 * R;
    const ctx = cv.getContext('2d');
    ctx.scale(R, R);
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#2a3440');
    g.addColorStop(1, '#141a20');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 112, 64);
    ctx.strokeStyle = 'rgba(120,200,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 8; x < 112; x += 8) { ctx.moveTo(x, 0); ctx.lineTo(x, 64); }
    for (let y = 8; y < 64; y += 8) { ctx.moveTo(0, y); ctx.lineTo(112, y); }
    ctx.stroke();
    if (def.kind === 'bld') {
      const W = def.w * T, H = def.h * T;
      const sc = Math.min(96 / (W + 20), 56 / (H + 20));
      ctx.save();
      ctx.translate(56 - (W / 2) * sc, 32 - (H / 2) * sc);
      ctx.scale(sc, sc);
      BLD[def.draw](ctx, W, H, CG.colorOf(owner), FSTYLE[fid] || FSTYLE.neutral);
      const fake = { def, owner, turret: -0.6, anim: 0, disabled: 0 };
      S.drawBuildingLive(ctx, fake, fid, 0.7);
      ctx.restore();
    } else {
      const sc = def.cat === 'inf' ? 3.4 : def.cat === 'air' ? 1.7 : def.radius > 14 ? 1.45 : 1.75;
      ctx.save();
      ctx.translate(56, 34);
      ctx.scale(sc, sc);
      if (def.cat === 'inf') {
        for (const [x, y] of [[-6, 2], [5, -3]]) {
          ctx.save();
          ctx.translate(x, y);
          S.drawUnit(ctx, def, owner, fid, -0.5, -0.5, 0.3, false, 0);
          ctx.restore();
        }
      } else {
        S.drawUnit(ctx, def, owner, fid, -0.45, -0.75, 0.13, false, def.harvester ? 0.7 : 0);
      }
      ctx.restore();
    }
    iconCache.set(key, cv);
    return cv;
  };

  // símbolos dos poderes de apoio
  S.powerIcon = function (ctx, kind, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.6;
    switch (kind) {
      case 'sat':
        ctx.fillRect(-3, -3, 6, 6);
        ctx.fillRect(-11, -2, 6, 4);
        ctx.fillRect(5, -2, 6, 4);
        ctx.beginPath();
        ctx.arc(0, 6, 5, 0.3, Math.PI - 0.3);
        ctx.stroke();
        break;
      case 'orbital':
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 6);
        ctx.stroke();
        ell(ctx, 0, 8, 8, 3);
        ctx.stroke();
        circ(ctx, 0, 8, 2);
        ctx.fill();
        break;
      case 'barrage':
        for (const [dx, dy] of [[-6, 0], [0, -4], [6, 1]]) {
          circ(ctx, dx, dy + 4, 2.4);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(dx - 3, dy - 6);
          ctx.lineTo(dx, dy + 2);
          ctx.stroke();
        }
        break;
      case 'missile':
        ctx.save();
        ctx.rotate(-0.8);
        rr(ctx, -2.5, -11, 5, 18, 2.5);
        ctx.fill();
        poly(ctx, [-2.5, 5, -6, 10, -2.5, 8]);
        ctx.fill();
        poly(ctx, [2.5, 5, 6, 10, 2.5, 8]);
        ctx.fill();
        ctx.restore();
        break;
      case 'cyber':
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('</>', 0, 0);
        break;
      case 'emp':
        ctx.beginPath();
        ctx.moveTo(2, -11);
        ctx.lineTo(-5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, 11);
        ctx.lineTo(5, -2);
        ctx.lineTo(0, -2);
        ctx.closePath();
        ctx.fill();
        circ(ctx, 0, 0, 11);
        ctx.stroke();
        break;
    }
    ctx.restore();
  };
})();
