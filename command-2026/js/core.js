/* Command & Geopolitics: 2026 — núcleo: namespace, matemática, RNG, ruído, armazenamento */
'use strict';
(function () {
  const CG = (window.CG = window.CG || {});

  CG.TILE = 32;
  CG.DT = 1 / 60;
  CG.TAU = Math.PI * 2;

  CG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  CG.lerp = (a, b, t) => a + (b - a) * t;
  CG.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  CG.dist2 = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  };
  CG.angDiff = (a, b) => {
    let d = (b - a) % CG.TAU;
    if (d > Math.PI) d -= CG.TAU;
    else if (d < -Math.PI) d += CG.TAU;
    return d;
  };
  CG.turnTo = (cur, target, step) => {
    const d = CG.angDiff(cur, target);
    if (Math.abs(d) <= step) return target;
    return cur + Math.sign(d) * step;
  };
  CG.lerpAngle = (a, b, t) => a + CG.angDiff(a, b) * t;

  // mulberry32 — determinístico por semente
  CG.RNG = function (seed) {
    let s = seed >>> 0 || 1;
    const next = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      int: (n) => Math.floor(next() * n),
      range: (a, b) => a + (b - a) * next(),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
    };
  };

  CG.hash2 = (x, y, seed) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  // ruído de valor 2D suave em [0,1]
  CG.valueNoise = function (seed) {
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = sm(x - xi), yf = sm(y - yi);
      const a = CG.hash2(xi, yi, seed), b = CG.hash2(xi + 1, yi, seed);
      const c = CG.hash2(xi, yi + 1, seed), d = CG.hash2(xi + 1, yi + 1, seed);
      return CG.lerp(CG.lerp(a, b, xf), CG.lerp(c, d, xf), yf);
    };
  };
  CG.fbm = (noise, x, y, oct) => {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      v += noise(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / norm;
  };

  CG.fmt = (n) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  CG.fmtTime = (s) => {
    s = Math.floor(s);
    const m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  };
  CG.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  CG.store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : def;
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* armazenamento indisponível (modo privado) — ignora */
      }
    },
  };

  CG.PLAYER_COLORS = [
    { main: '#2f9bff', dark: '#14548f', light: '#a8d6ff', name: 'Azul' },
    { main: '#ff4a3d', dark: '#981d16', light: '#ffb7ad', name: 'Vermelho' },
    { main: '#ffb21f', dark: '#935f00', light: '#ffe2a3', name: 'Âmbar' },
    { main: '#b35cff', dark: '#5b2a99', light: '#e3c4ff', name: 'Violeta' },
  ];
  CG.NEUTRAL = -1;
  CG.NEUTRAL_COLOR = { main: '#a9a48e', dark: '#5c594c', light: '#dedac8', name: 'Neutro' };
  CG.colorOf = (owner) => (owner < 0 ? CG.NEUTRAL_COLOR : CG.PLAYER_COLORS[owner % CG.PLAYER_COLORS.length]);

  CG.isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
})();
