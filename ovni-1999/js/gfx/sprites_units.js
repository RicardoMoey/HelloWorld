/* Sprites vetoriais procedimentais das unidades do Battlescape (DESIGN.md §16), sem imagens.
   Cada unidade é um pequeno modelo 3D de primitivas (esferas, elipsoides, membros cónicos, caixas,
   troncos de cone, polígonos, decalques) no referencial local — a = frente, b = direita, h = cima;
   1 unidade = 1 px vertical a zoom 1, 32 unidades = lado de um tile — rodado para a direção 0..7
   (N = cima-direita no ecrã), projetado em isométrico 2:1, ordenado por profundidade e rasterizado com
   luz de cima-esquerda, traço interno escuro e contorno exterior de 1 px.
   OV.UnitSprites.get(key, dir, pose, frame, scale, opts) → {c, w, h, ax, ay, size, fx, fy}
     w/h/ax/ay em px CSS a zoom 1; canvas com w·scale × h·scale px; (ax, ay) assenta no centro do losango
     do tile da unidade (2×2: tile base, x/y mínimos; o centro da pegada fica em (fx, fy) = (ax, ay + 16)).
   Poses: stand, walk (0..3), kneel, aim, fall (0..2), dead, float (0..3).
   opts: armour, skin 0..3, female, weapon 'none'|'pistol'|'rifle'|'heavy', gun 'ballistic'|'laser'|'plasma',
     team 'xcom'|'alien'|'civ', rank 0..5, variant 0..7 (roupa dos civis). */
(function (OV) {
  'use strict';

  const Col = OV.Color;
  const css = Col.css, shade = Col.shade;
  const TAU = Math.PI * 2;
  const INV_SQ3 = 1 / Math.sqrt(3);

  const KEYS = ['soldier', 'sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f'];
  const POSES = ['stand', 'walk', 'kneel', 'aim', 'fall', 'dead', 'float'];
  const FRAMES = { stand: 1, walk: 4, kneel: 1, aim: 1, fall: 3, dead: 1, float: 4 };
  const SIZE2 = { cyberdisc: true, sectopod: true, reaper: true };
  const ARMED = { soldier: true, sectoid: true, floater: true, snakeman: true, muton: true, ethereal: true };
  const SKINNED = { soldier: true, civilian_m: true, civilian_f: true };
  const WEAPONS = ['none', 'pistol', 'rifle', 'heavy'];
  const GUNS = ['ballistic', 'laser', 'plasma'];
  const TEAMS = ['xcom', 'alien', 'civ'];

  // ---- constantes de arte ----------------------------------------------------------------------------
  const OUTLINE = 0x07090d;
  const NIGHT = 0x050a1e; // rgb(5,10,30)
  const HI = 0.34, LO = -0.46; // claro / escuro dos gradientes
  const SKIN = [0xecc6a2, 0xcf9d74, 0x9a6845, 0x5c3c2a];
  const HAIR = [0xcfa855, 0x5c3a1f, 0x2b211b, 0x17120f];
  // shade 0..15 da escala OpenXcom → alfa da silhueta noturna
  const SHADE_ALPHA = Array.from({ length: 16 }, (_, s) => Math.min(0.85, (s / 15) * 0.85));

  // ---- vetores [a, b, h] -----------------------------------------------------------------------------
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const mul = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const vlen = (p) => Math.sqrt(dot(p, p));
  const norm = (p) => {
    const l = vlen(p);
    return l > 1e-9 ? mul(p, 1 / l) : [0, 0, 1];
  };
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // rotações: em b (t > 0 deita o topo para trás), em a (t > 0 deita o topo para a esquerda), em h (t > 0 roda a frente para a direita)
  function rotB(p, t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  }
  function rotA(p, t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }
  function rotH(p, t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }
  // luz em coordenadas de mapa (x, y, h): vem de cima-esquerda no ecrã
  const LIGHT = norm([-0.5, 0.3, 0.8]);

  // cinemática inversa de 2 ossos: raiz → articulação → alvo, articulação puxada para o polo
  function ik(root, target, l1, l2, pole) {
    let d = sub(target, root);
    let dist = vlen(d);
    if (dist < 1e-6) {
      d = [0, 0, -1];
      dist = 1;
    }
    const u = mul(d, 1 / dist);
    const dc = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
    const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    let q = sub(pole, mul(u, dot(pole, u)));
    if (vlen(q) < 1e-6) q = Math.abs(u[2]) < 0.9 ? cross(u, [0, 0, 1]) : cross(u, [1, 0, 0]);
    q = norm(q);
    return { j: add(root, add(mul(u, x), mul(q, y))), e: add(root, mul(u, dc)) };
  }

  // eixos de um elipsoide/caixa com orientação opcional (roll em a, tilt para a frente, yaw)
  function axesOf(rr, o) {
    let A = [[rr[0], 0, 0], [0, rr[1], 0], [0, 0, rr[2]]];
    if (o) {
      if (o.roll) A = A.map((v) => rotA(v, o.roll));
      if (o.tilt) A = A.map((v) => rotB(v, -o.tilt));
      if (o.yaw) A = A.map((v) => rotH(v, o.yaw));
    }
    return A;
  }
  // ponto e normal na superfície de um elipsoide alinhado (centro c, semi-eixos rr) na direção v
  function surf(c, rr, v) {
    const n = norm(v);
    const t = 1 / Math.sqrt((n[0] / rr[0]) ** 2 + (n[1] / rr[1]) ** 2 + (n[2] / rr[2]) ** 2);
    const p = mul(n, t);
    return { p: add(c, p), n: norm([p[0] / (rr[0] * rr[0]), p[1] / (rr[1] * rr[1]), p[2] / (rr[2] * rr[2])]) };
  }

  // ---- modelo: recolhe primitivas locais, aplica a queda/assentamento e projeta --------------------------
  function Model(dir, size) {
    const s = dir & 1 ? Math.SQRT1_2 : 1;
    this.dir = dir;
    this.size = size;
    this.fx = OV.U.DX[dir] * s;
    this.fy = OV.U.DY[dir] * s;
    this.off = size > 1 ? 16 : 0; // centro da pegada 2×2 a (+½, +½) tile do tile base
    this.prims = [];
    this.halos = [];
    this.marks = {};
    this.rots = [];
    this.center = 0;
    this.settle = false;
  }
  const MP = Model.prototype;
  MP.push = function (q, o) {
    q.o = o || {};
    q.n = this.prims.length;
    this.prims.push(q);
    return q;
  };
  MP.ball = function (p, r, col, o) { return this.push({ t: 'ball', pts: [p], vecs: [], r, col }, o); };
  MP.ell = function (p, rr, col, o) { return this.push({ t: 'ell', pts: [p], vecs: axesOf(rr, o), col }, o); };
  MP.ellAx = function (p, A, col, o) { return this.push({ t: 'ell', pts: [p], vecs: A, col }, o); };
  MP.limb = function (p1, p2, r1, r2, col, o) { return this.push({ t: 'limb', pts: [p1, p2], vecs: [], r1, r2, col }, o); };
  MP.box = function (p, hh, col, o) { return this.push({ t: 'box', pts: [p], vecs: axesOf(hh, o), col }, o); };
  MP.boxAx = function (p, A, col, o) { return this.push({ t: 'box', pts: [p], vecs: A, col }, o); };
  // tronco de cone de p0 (raio r0) a p1 (raio r1); o.sa / o.sb achatam a secção
  MP.cyl = function (p0, p1, r0, r1, col, o) {
    o = o || {};
    const ax = norm(sub(p1, p0));
    const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ref, ax)), v = cross(ax, u);
    return this.push({ t: 'cyl', pts: [p0, p1], vecs: [mul(u, o.sa || 1), mul(v, o.sb || 1)], r0, r1, col }, o);
  };
  MP.poly = function (pts, col, o) { return this.push({ t: 'poly', pts, vecs: [], col }, o); };
  MP.line = function (pts, w, col, o) { return this.push({ t: 'line', pts, vecs: [], w, col }, o); };
  // decalque (olhos, viseira, galões): só visível se a normal n estiver virada para a câmara
  MP.feat = function (p, n, A1, A2, col, o) { return this.push({ t: 'feat', pts: [p], vecs: [norm(n), A1, A2], col }, o); };
  MP.halo = function (p, r, col, a, n) { this.halos.push({ p, r, col, a, n: n ? norm(n) : null }); };
  MP.mark = function (name, p) { this.marks[name] = p; };
  // rotação rígida (queda, inclinação); from = só as primitivas criadas a partir deste índice
  MP.rotate = function (axis, t, c, from) { this.rots.push({ f: axis === 'a' ? rotA : axis === 'h' ? rotH : rotB, t, c: c || [0, 0, 0], from: from || 0 }); };

  MP.xp = function (p, n) {
    for (const r of this.rots) if (n === undefined || n >= r.from) p = add(r.c, r.f(sub(p, r.c), r.t));
    return p;
  };
  MP.xv = function (v, n) {
    for (const r of this.rots) if (n === undefined || n >= r.from) v = r.f(v, r.t);
    return v;
  };
  // extensão local de uma primitiva (para centrar e assentar no chão)
  function extent(q) {
    const e = [Infinity, -Infinity, Infinity, -Infinity, Infinity];
    const acc = (p, ra, rb, rh) => {
      e[0] = Math.min(e[0], p[0] - ra);
      e[1] = Math.max(e[1], p[0] + ra);
      e[2] = Math.min(e[2], p[1] - rb);
      e[3] = Math.max(e[3], p[1] + rb);
      e[4] = Math.min(e[4], p[2] - rh);
    };
    const comp = (k, sq) => {
      let s = 0;
      for (const v of q.vecs) s += sq ? v[k] * v[k] : Math.abs(v[k]);
      return sq ? Math.sqrt(s) : s;
    };
    switch (q.t) {
      case 'ball': acc(q.pts[0], q.r, q.r, q.r); break;
      case 'limb': acc(q.pts[0], q.r1, q.r1, q.r1); acc(q.pts[1], q.r2, q.r2, q.r2); break;
      case 'ell': acc(q.pts[0], comp(0, true), comp(1, true), comp(2, true)); break;
      case 'box': acc(q.pts[0], comp(0), comp(1), comp(2)); break;
      case 'cyl': {
        const [u, v] = q.vecs;
        const ext = (k, r) => r * Math.sqrt(u[k] * u[k] + v[k] * v[k]);
        acc(q.pts[0], ext(0, q.r0), ext(1, q.r0), ext(2, q.r0));
        acc(q.pts[1], ext(0, q.r1), ext(1, q.r1), ext(2, q.r1));
        break;
      }
      case 'poly': case 'line': for (const p of q.pts) acc(p, 0, 0, 0); break;
      default: return null;
    }
    return e;
  }
  MP.finish = function () {
    if (this.done) return;
    this.done = true;
    for (const q of this.prims) {
      q.pts = q.pts.map((p) => this.xp(p, q.n));
      q.vecs = q.vecs.map((v) => this.xv(v, q.n));
    }
    for (const h of this.halos) {
      h.p = this.xp(h.p);
      if (h.n) h.n = this.xv(h.n);
    }
    for (const k in this.marks) this.marks[k] = this.xp(this.marks[k]);
    if (!this.center && !this.settle) return;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, h0 = Infinity;
    for (const q of this.prims) {
      const e = extent(q);
      if (!e) continue;
      a0 = Math.min(a0, e[0]); a1 = Math.max(a1, e[1]); b0 = Math.min(b0, e[2]); b1 = Math.max(b1, e[3]); h0 = Math.min(h0, e[4]);
    }
    if (h0 === Infinity) return;
    const d = [this.center ? (-(a0 + a1) / 2) * this.center : 0, this.center ? (-(b0 + b1) / 2) * this.center : 0, this.settle ? -h0 : 0];
    for (const q of this.prims) q.pts = q.pts.map((p) => add(p, d));
    for (const h of this.halos) h.p = add(h.p, d);
    for (const k in this.marks) this.marks[k] = add(this.marks[k], d);
  };

  // local → ecrã [X, Y, profundidade]; profundidade cresce para a câmara (vista ao longo de (1,1,1))
  MP.P = function (p) {
    const vx = p[0] * this.fx - p[1] * this.fy + this.off, vy = p[0] * this.fy + p[1] * this.fx + this.off;
    return [vx - vy, (vx + vy) * 0.5 - p[2], vx + vy + p[2]];
  };
  MP.V = function (v) {
    const vx = v[0] * this.fx - v[1] * this.fy, vy = v[0] * this.fy + v[1] * this.fx;
    return [vx - vy, (vx + vy) * 0.5 - v[2]];
  };
  MP.W = function (v) { return [v[0] * this.fx - v[1] * this.fy, v[0] * this.fy + v[1] * this.fx, v[2]]; };
  MP.facing = function (n) {
    const w = this.W(n);
    return (w[0] + w[1] + w[2]) * INV_SQ3;
  };
  MP.lit = function (n) { return dot(this.W(n), LIGHT); };
  // meia-profundidade de um conjunto de eixos ao longo da vista
  MP.viewExt = function (A) {
    let s = 0;
    for (const v of A) {
      const w = this.W(v);
      s += (w[0] + w[1] + w[2]) ** 2 / 3;
    }
    return Math.sqrt(s) * Math.sqrt(3);
  };

  // elipse projetada de um elipsoide de eixos A (matriz de forma S = Σ c·cᵀ)
  function ellOf(m, A) {
    let sxx = 0, syy = 0, sxy = 0;
    for (const v of A) {
      const c = m.V(v);
      sxx += c[0] * c[0];
      syy += c[1] * c[1];
      sxy += c[0] * c[1];
    }
    const tr = (sxx + syy) / 2, df = (sxx - syy) / 2, rt = Math.sqrt(df * df + sxy * sxy);
    return { rx: Math.sqrt(tr + rt), ry: Math.sqrt(Math.max(tr - rt, 1e-6)), th: 0.5 * Math.atan2(2 * sxy, sxx - syy), ex: Math.sqrt(sxx), ey: Math.sqrt(syy) };
  }
  // invólucro convexo (cadeia monótona) de pontos [x, y]
  function hull(pts) {
    pts = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    lo.pop();
    up.pop();
    return lo.concat(up);
  }
  function bbOf(pts, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }

  // primitiva local → parte de ecrã (ou null se invisível)
  MP.proj1 = function (q) {
    const o = q.o, bias = o.bias || 0;
    const base = { t: q.t, col: q.col, o, n: q.n };
    switch (q.t) {
      case 'ball': {
        const s = this.P(q.pts[0]), ry = q.r * (o.sq || 1);
        return Object.assign(base, { x: s[0], y: s[1], rx: q.r, ry, th: 0, d: s[2] - q.r * 0.5 + bias, bb: [s[0] - q.r, s[1] - ry, s[0] + q.r, s[1] + ry] });
      }
      case 'ell': case 'feat': {
        let A = q.vecs;
        if (q.t === 'feat') {
          if (this.facing(A[0]) < (o.vis == null ? 0.1 : o.vis)) return null;
          A = A.slice(1);
        }
        const s = this.P(q.pts[0]), e = ellOf(this, A);
        const d = q.t === 'feat' ? s[2] + 0.5 + bias : s[2] - this.viewExt(A) * 0.6 + bias;
        return Object.assign(base, { t: 'ell', feat: q.t === 'feat', x: s[0], y: s[1], rx: e.rx, ry: e.ry, th: e.th, d, bb: [s[0] - e.ex, s[1] - e.ey, s[0] + e.ex, s[1] + e.ey] });
      }
      case 'limb': {
        const s1 = this.P(q.pts[0]), s2 = this.P(q.pts[1]);
        const r = Math.max(q.r1, q.r2);
        return Object.assign(base, {
          x1: s1[0], y1: s1[1], x2: s2[0], y2: s2[1], r1: q.r1, r2: q.r2, d: (s1[2] + s2[2]) / 2 + bias,
          bb: [Math.min(s1[0] - q.r1, s2[0] - q.r2), Math.min(s1[1] - q.r1, s2[1] - q.r2), Math.max(s1[0] + q.r1, s2[0] + q.r2), Math.max(s1[1] + q.r1, s2[1] + q.r2)],
          rmax: r,
        });
      }
      case 'box': {
        const c = q.pts[0], A = q.vecs, faces = [], all = [];
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3, k = (i + 2) % 3;
          for (const sg of [1, -1]) {
            const nrm = norm(mul(A[i], sg));
            const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => this.P(add(add(add(c, mul(A[i], sg)), mul(A[j], u)), mul(A[k], v))));
            for (const p of corners) all.push(p);
            if (this.facing(nrm) > 0.015) faces.push({ pts: corners, l: this.lit(nrm) });
          }
        }
        const s = this.P(c);
        return Object.assign(base, { faces, d: s[2] - this.viewExt(A) * 0.6 + bias, bb: bbOf(all, 0) });
      }
      case 'cyl': {
        const [p0, p1] = q.pts, [u, v] = q.vecs, N = 18, ring = [];
        for (let i = 0; i < N; i++) {
          const t = (i / N) * TAU, cu = Math.cos(t), sv = Math.sin(t);
          ring.push(this.P(add(p0, add(mul(u, cu * q.r0), mul(v, sv * q.r0)))));
          ring.push(this.P(add(p1, add(mul(u, cu * q.r1), mul(v, sv * q.r1)))));
        }
        const h = hull(ring.map((p) => [p[0], p[1]]));
        const axis = norm(sub(p1, p0)), top = this.facing(axis) > 0;
        const cp = top ? p1 : p0, cr = top ? q.r1 : q.r0;
        let cap = null;
        if (cr > 0.25 && o.cap !== false) {
          const s = this.P(cp), e = ellOf(this, [mul(u, cr), mul(v, cr)]);
          cap = { x: s[0], y: s[1], rx: e.rx, ry: e.ry, th: e.th, top };
        }
        const s0 = this.P(p0), s1 = this.P(p1);
        const ext = this.viewExt([mul(u, Math.max(q.r0, q.r1)), mul(v, Math.max(q.r0, q.r1)), mul(sub(p1, p0), 0.5)]);
        return Object.assign(base, { hull: h, cap, ax0: s0, ax1: s1, rmax: Math.max(q.r0, q.r1), d: (s0[2] + s1[2]) / 2 - ext * 0.6 + bias, bb: bbOf(h, 0) });
      }
      case 'poly': {
        const sp = q.pts.map((p) => this.P(p));
        let nrm = norm(cross(sub(q.pts[1], q.pts[0]), sub(q.pts[2], q.pts[0])));
        if (this.facing(nrm) < 0) nrm = mul(nrm, -1);
        let d = 0;
        for (const p of sp) d += p[2];
        return Object.assign(base, { pts: sp, l: this.lit(nrm), d: d / sp.length + bias, bb: bbOf(sp, 0.5) });
      }
      case 'line': {
        const sp = q.pts.map((p) => this.P(p));
        let d = 0;
        for (const p of sp) d += p[2];
        return Object.assign(base, { pts: sp, w: q.w, d: d / sp.length + bias, bb: bbOf(sp, q.w) });
      }
    }
    return null;
  };
  MP.project = function () {
    const out = [];
    for (const q of this.prims) {
      const s = this.proj1(q);
      if (s) out.push(s);
    }
    out.sort((x, y) => x.d - y.d || x.n - y.n);
    return out;
  };
  MP.projHalos = function () {
    const out = [];
    for (const h of this.halos) {
      if (h.n && this.facing(h.n) < -0.05) continue;
      const s = this.P(h.p);
      out.push({ x: s[0], y: s[1], r: h.r, col: h.col, a: h.a, d: s[2] + 1 });
    }
    return out;
  };
  MP.projMarks = function () {
    const out = {};
    for (const k in this.marks) {
      const s = this.P(this.marks[k]);
      out[k] = { x: s[0], y: s[1], d: s[2] };
    }
    return out;
  };

  // ---- pintura ---------------------------------------------------------------------------------------
  function edge(ctx, col, o) {
    if (o.edge === false) return;
    ctx.lineWidth = o.lw || 0.5;
    ctx.strokeStyle = css(shade(col, -0.6), 0.85);
    ctx.stroke();
  }
  // gradiente linear perpendicular a um eixo de ecrã, claro do lado de cima-esquerda
  function sideGrad(ctx, x1, y1, x2, y2, r, col) {
    let nx = -(y2 - y1), ny = x2 - x1;
    const l = Math.hypot(nx, ny);
    if (l < 1e-3) {
      nx = -0.7071;
      ny = -0.7071;
    } else {
      nx /= l;
      ny /= l;
      if (nx + ny * 1.15 > 0) {
        nx = -nx;
        ny = -ny;
      }
    }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const g = ctx.createLinearGradient(mx + nx * r, my + ny * r, mx - nx * r, my - ny * r);
    g.addColorStop(0, css(shade(col, HI)));
    g.addColorStop(0.42, css(col));
    g.addColorStop(1, css(shade(col, LO)));
    return g;
  }
  function roundGrad(ctx, x, y, rx, ry, col) {
    const R = Math.max(rx, ry, 0.1);
    const g = ctx.createRadialGradient(x - rx * 0.38, y - ry * 0.45, R * 0.08, x, y, R * 1.08);
    g.addColorStop(0, css(shade(col, HI)));
    g.addColorStop(0.5, css(col));
    g.addColorStop(1, css(shade(col, LO)));
    return g;
  }
  function limbPath(ctx, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, d = Math.hypot(dx, dy);
    ctx.beginPath();
    if (d <= Math.abs(s.r1 - s.r2) + 0.01) {
      const big = s.r1 >= s.r2;
      ctx.arc(big ? s.x1 : s.x2, big ? s.y1 : s.y2, Math.max(s.r1, s.r2), 0, TAU);
      return;
    }
    const th = Math.atan2(dy, dx), al = Math.acos(clamp((s.r1 - s.r2) / d, -1, 1));
    ctx.arc(s.x1, s.y1, s.r1, th + al, th + TAU - al);
    ctx.arc(s.x2, s.y2, s.r2, th - al, th + al);
    ctx.closePath();
  }
  function paint(ctx, s) {
    const o = s.o, col = s.col;
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    switch (s.t) {
      case 'ball': case 'ell': {
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, Math.max(s.rx, 0.05), Math.max(s.ry, 0.05), s.th, 0, TAU);
        const ex = (s.bb[2] - s.bb[0]) / 2, ey = (s.bb[3] - s.bb[1]) / 2;
        ctx.fillStyle = o.flat ? css(col) : roundGrad(ctx, s.x, s.y, ex, ey, col);
        ctx.fill();
        edge(ctx, col, s.feat && o.edge !== true ? { edge: false } : o);
        if (o.spec) {
          ctx.beginPath();
          const r = Math.max(0.35, Math.min(ex, ey) * 0.3);
          ctx.ellipse(s.x - ex * 0.36, s.y - ey * 0.42, r, r * 0.75, -0.6, 0, TAU);
          ctx.fillStyle = 'rgba(255,255,255,' + (o.spec === true ? 0.5 : o.spec) + ')';
          ctx.fill();
        }
        break;
      }
      case 'limb':
        limbPath(ctx, s);
        ctx.fillStyle = o.flat ? css(col) : sideGrad(ctx, s.x1, s.y1, s.x2, s.y2, s.rmax, col);
        ctx.fill();
        edge(ctx, col, o);
        break;
      case 'box':
        for (const f of s.faces) {
          ctx.beginPath();
          ctx.moveTo(f.pts[0][0], f.pts[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i][0], f.pts[i][1]);
          ctx.closePath();
          const c = shade(col, clamp(f.l * 0.5, -0.5, 0.38));
          ctx.fillStyle = css(c);
          ctx.fill();
          edge(ctx, col, o);
        }
        break;
      case 'cyl': {
        const h = s.hull;
        if (h.length < 3) break;
        ctx.beginPath();
        ctx.moveTo(h[0][0], h[0][1]);
        for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
        ctx.closePath();
        ctx.fillStyle = o.flat ? css(col) : sideGrad(ctx, s.ax0[0], s.ax0[1], s.ax1[0], s.ax1[1], (s.bb[2] - s.bb[0]) / 2, col);
        ctx.fill();
        edge(ctx, col, o);
        if (s.cap) {
          const cc = !s.cap.top && o.capCol != null ? o.capCol : shade(col, s.cap.top ? 0.16 : -0.3);
          ctx.beginPath();
          ctx.ellipse(s.cap.x, s.cap.y, Math.max(s.cap.rx, 0.05), Math.max(s.cap.ry, 0.05), s.cap.th, 0, TAU);
          ctx.fillStyle = o.flat ? css(cc) : roundGrad(ctx, s.cap.x, s.cap.y, s.cap.rx, s.cap.ry, cc);
          ctx.fill();
          edge(ctx, cc, o);
        }
        break;
      }
      case 'poly': {
        ctx.beginPath();
        ctx.moveTo(s.pts[0][0], s.pts[0][1]);
        for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = css(o.flat ? col : shade(col, clamp(s.l * 0.45, -0.45, 0.35)));
        ctx.fill();
        edge(ctx, col, o);
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(s.pts[0][0], s.pts[0][1]);
        for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
        ctx.lineWidth = s.w;
        ctx.strokeStyle = css(col);
        ctx.stroke();
        break;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- canvas ----------------------------------------------------------------------------------------
  let makeCanvas = function (w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('UnitSprites: sem canvas disponível');
  };
  const OFFS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  function glow(g, hl) {
    const gr = g.createRadialGradient(hl.x, hl.y, 0, hl.x, hl.y, hl.r);
    gr.addColorStop(0, css(hl.col, hl.a));
    gr.addColorStop(0.45, css(hl.col, hl.a * 0.45));
    gr.addColorStop(1, css(hl.col, 0));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr;
    g.beginPath();
    g.arc(hl.x, hl.y, hl.r, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }

  function raster(m, scale) {
    m.finish();
    const parts = m.project(), halos = m.projHalos();
    let x0 = -2, y0 = -2, x1 = 2, y1 = 2; // a âncora fica sempre dentro do canvas
    for (const s of parts) {
      x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]); x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]);
    }
    for (const h of halos) {
      x0 = Math.min(x0, h.x - h.r); y0 = Math.min(y0, h.y - h.r); x1 = Math.max(x1, h.x + h.r); y1 = Math.max(y1, h.y + h.r);
    }
    const pad = 2;
    x0 = Math.floor(x0) - pad;
    y0 = Math.floor(y0) - pad;
    // múltiplos de 4 ⇒ w·scale inteiro para escalas quantizadas a 0.25
    const w = (Math.ceil(x1) + pad - x0 + 3) & ~3, h = (Math.ceil(y1) + pad - y0 + 3) & ~3;
    const W = Math.round(w * scale), H = Math.round(h * scale);
    const layer = (withHalos) => {
      const c = makeCanvas(W, H), g = c.getContext('2d');
      g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      let i = 0;
      for (const s of parts) {
        // brilhos aditivos intercalados por profundidade: o que está à frente tapa-os
        while (withHalos && i < halos.length && halos[i].d <= s.d) glow(g, halos[i++]);
        paint(g, s);
      }
      while (withHalos && i < halos.length) glow(g, halos[i++]);
      return c;
    };
    halos.sort((p, q) => p.d - q.d);
    // silhueta sólida (sem brilhos) para o contorno; camada de cor com brilhos
    const base = layer(false), colour = halos.length ? layer(true) : base;
    const out = makeCanvas(W, H), oc = out.getContext('2d');
    const d = Math.max(1, Math.round(scale * 0.8));
    for (const [dx, dy] of OFFS) oc.drawImage(base, dx * d, dy * d);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = css(OUTLINE, 0.88);
    oc.fillRect(0, 0, W, H);
    oc.globalCompositeOperation = 'source-over';
    oc.drawImage(colour, 0, 0);
    const big = m.size > 1;
    return { c: out, w, h, ax: -x0, ay: -y0, size: m.size, fx: -x0, fy: -y0 + (big ? 16 : 0), scale, sil: null, white: null };
  }

  // ---- esqueleto humanoide -----------------------------------------------------------------------------
  const BASEP = {
    k: 1, hip: 21, ankle: 1.7, thigh: 10.3, shin: 10.0, torso: 14, neck: 1.0, headR: 3.3, shW: 5.6, hipW: 2.9, shDrop: 1.6,
    upArm: 7.6, foreArm: 7.2, rThigh: 2.9, rKnee: 2.4, rAnkle: 1.9, rUp: 2.3, rElbow: 2.0, rWrist: 1.6, rHand: 1.6,
    chest: [3.4, 5.0, 6.4], pelvis: [2.9, 3.7, 3.0], footA: 2.9, footB: 1.6, footH: 1.4,
    lean: 0.05, stride: 6.0, lift: 3.0, bob: 0.9, armSwing: 4.2, floatH: 8,
  };
  const P_ = (o) => Object.assign({}, BASEP, o);
  const PH = (frame) => (frame * Math.PI) / 2;

  // bacia e pernas da pose
  function legRig(P, pose, frame) {
    const hw = P.hipW, k = P.k;
    const S = { lean: P.lean, toeL: [1, 0, 0], toeR: [1, 0, 0], swing: 0, bob: 0 };
    let pel = [0, 0, P.hip];
    let aL = [0.3 * k, -hw - 0.3 * k, P.ankle], aR = [0.3 * k, hw + 0.3 * k, P.ankle];
    let poleL = [1, 0, 0.1], poleR = [1, 0, 0.1], kR = null;
    if (pose === 'walk') {
      const c = Math.cos(PH(frame)), s = Math.sin(PH(frame));
      aL = [P.stride * c, -hw, P.ankle + P.lift * Math.max(0, -s)];
      aR = [-P.stride * c, hw, P.ankle + P.lift * Math.max(0, s)];
      S.bob = -P.bob * (1 - Math.abs(s));
      pel = [0.5 * k, 0, P.hip + S.bob];
      S.lean += 0.07;
      S.swing = c;
      if (s < 0) S.toeL = norm([1, 0, -0.5]);
      if (s > 0) S.toeR = norm([1, 0, -0.5]);
    } else if (pose === 'aim') {
      aL = [3.2 * k, -hw - 0.9 * k, P.ankle];
      aR = [-2.8 * k, hw + 0.9 * k, P.ankle];
      pel = [0, 0, P.hip - 0.7 * k];
      S.lean += 0.03;
    } else if (pose === 'kneel') {
      // joelho direito no chão, pé esquerdo à frente
      kR = [P.thigh * 0.3, hw + 0.4 * k, P.rKnee * 0.85];
      const pa = -1.2 * k, dx = kR[0] - pa;
      pel = [pa, 0, kR[2] + Math.sqrt(Math.max(1, P.thigh * P.thigh - dx * dx))];
      aR = [kR[0] - P.shin * 0.97, hw + 0.6 * k, P.rAnkle * 0.9];
      S.toeR = norm([0.25, 0, -1]);
      aL = [P.thigh * 0.8, -hw - 0.5 * k, P.ankle];
      poleL = [1, 0, 0.9];
      S.lean += 0.1;
    } else if (pose === 'float') {
      const b = Math.sin(PH(frame)) * 0.8;
      pel = [0, 0, P.hip + P.floatH + b];
      aL = [-1.0 * k, -hw + 0.3 * k, P.floatH + P.ankle + 1.6 + b];
      aR = [-2.0 * k, hw - 0.3 * k, P.floatH + P.ankle + 0.9 + b];
      S.toeL = S.toeR = norm([0.5, 0, -0.85]);
      S.bob = P.floatH + b;
    } else if (pose === 'fall') {
      if (frame === 0) {
        pel = [-0.8 * k, 0, P.hip - 3 * k];
        S.lean -= 0.12;
      } else if (frame === 1) {
        pel = [-1.5 * k, 0, P.hip * 0.62];
        aL[0] = aR[0] = 3 * k;
        S.lean -= 0.3;
      } else {
        pel = [-1 * k, 0, P.hip * 0.5];
        aL[0] = 7 * k;
        aR[0] = 6 * k;
        S.lean -= 0.45;
      }
    } else if (pose === 'dead') {
      aL = [2.5 * k, -hw - 1.8 * k, P.ankle + P.thigh * 0.35];
      aR = [3.5 * k, hw + 1.2 * k, P.ankle + P.thigh * 0.7];
      poleL = [1, -0.4, 0];
      poleR = [1, 0.3, 0];
      S.lean = 0;
    }
    S.pel = pel;
    S.hipL = add(pel, [0, -hw, 0]);
    S.hipR = add(pel, [0, hw, 0]);
    const L = ik(S.hipL, aL, P.thigh, P.shin, poleL);
    S.kneeL = L.j;
    S.ankL = L.e;
    if (kR) {
      S.kneeR = kR;
      S.ankR = aR;
    } else {
      const R = ik(S.hipR, aR, P.thigh, P.shin, poleR);
      S.kneeR = R.j;
      S.ankR = R.e;
    }
    return S;
  }
  // tronco, ombros e cabeça a partir da bacia
  function upperRig(S, P, pose) {
    const up = [Math.sin(S.lean), 0, Math.cos(S.lean)];
    S.up = up;
    S.chest = add(S.pel, mul(up, P.torso * 0.6));
    S.neck = add(S.pel, mul(up, P.torso));
    S.shC = add(S.pel, mul(up, P.torso - P.shDrop));
    S.shL = add(S.shC, [0, -P.shW, 0]);
    S.shR = add(S.shC, [0, P.shW, 0]);
    const hu = pose === 'aim' ? norm([up[0] + 0.22, 0, up[2]]) : up;
    S.head = add(S.neck, mul(hu, P.neck + P.headR * 1.15));
    if (pose === 'aim') S.head = add(S.head, [0, 0.25 * P.k, -0.3 * P.k]);
    return S;
  }
  // mãos, cotovelos e arma
  function armRig(S, P, pose, frame, wpn) {
    const k = P.k, sw = S.swing * P.armSwing, pel = S.pel;
    let hL, hR, g = null;
    const reach = (P.upArm + P.foreArm) * 0.97;
    const hang = (sd, swing) => {
      const th = 0.06 + swing / (P.upArm + P.foreArm);
      return add(sd < 0 ? S.shL : S.shR, [reach * Math.sin(th), sd * 1.2 * k, -reach * Math.cos(th)]);
    };
    if (pose === 'dead') {
      hL = add(S.shL, [2 * k, -5.5 * k, 4.5 * k]);
      hR = add(S.chest, [3.5 * k, -1.5 * k, -1 * k]);
    } else if (pose === 'fall') {
      if (frame === 0) {
        hL = add(S.shL, [3.5 * k, -1.2 * k, 3 * k]);
        hR = add(S.shR, [3.5 * k, 1.2 * k, 3 * k]);
      } else {
        const sp = frame === 1 ? 5.5 : 7;
        hL = add(S.shL, [1 * k, -sp * k, 4 * k]);
        hR = add(S.shR, [0.5 * k, sp * k, 5 * k]);
      }
    } else if (wpn === 'zombie') {
      const r = (P.upArm + P.foreArm) * 0.86, w = Math.sin(PH(frame)) * (pose === 'walk' ? 1.2 : 0);
      const lift = pose === 'aim' ? 4 * k : 0;
      hL = add(S.shL, [r, 1.2 * k, -1.5 * k + w + lift]);
      hR = add(S.shR, [r * 0.95, -1.2 * k, -2.2 * k - w + lift]);
    } else if (wpn === 'rifle' || wpn === 'heavy') {
      const heavy = wpn === 'heavy';
      if (pose === 'aim') {
        const grip = add(S.shR, [4.0 * k, -2.4 * k, -2.4 * k]);
        g = { grip, axis: [1, 0, 0], kind: wpn, shoulder: heavy };
        hR = grip;
        hL = add(grip, [7.5 * k, -1.6 * k, heavy ? -0.8 * k : 0.2 * k]);
      } else {
        const lift = pose === 'kneel' ? 3.5 * k : 0;
        const grip = add(pel, [4.4 * k, 2.6 * k, (heavy ? 4.4 : 4.6) * k + lift]);
        const axis = heavy ? norm([1, -0.12, 0.1]) : norm([1, -0.2, 0.16]);
        g = { grip, axis, kind: wpn };
        hR = grip;
        hL = add(add(grip, mul(axis, (heavy ? 8 : 7) * k)), [0, -0.8 * k, heavy ? -1.6 * k : 0.3 * k]);
      }
    } else if (wpn === 'pistol') {
      if (pose === 'aim') {
        const grip = add(S.shC, [(P.upArm + P.foreArm) * 0.85, 1.0 * k, -1.5 * k]);
        g = { grip, axis: [1, 0, 0], kind: 'pistol' };
        hR = grip;
        hL = add(grip, [-0.6 * k, -1.5 * k, -0.5 * k]);
      } else {
        const grip = add(pel, [3.6 * k, P.shW + 0.4 * k, (pose === 'kneel' ? 4.5 : 2.2) * k]);
        g = { grip, axis: norm([1, 0, -0.25]), kind: 'pistol' };
        hR = grip;
        hL = hang(-1, -sw);
      }
    } else if (pose === 'aim') {
      hR = add(S.shR, [(P.upArm + P.foreArm) * 0.9, -1.5 * k, 1.2 * k]);
      hL = hang(-1, 0);
    } else if (pose === 'kneel') {
      hL = add(S.kneeL, [0.6 * k, 0, 2.2 * k]);
      hR = add(pel, [3 * k, P.shW * 0.85, 3 * k]);
    } else {
      hL = hang(-1, -sw);
      hR = hang(1, sw);
    }
    const eL = ik(S.shL, hL, P.upArm, P.foreArm, [-0.5, -0.9, -0.9]);
    const eR = ik(S.shR, hR, P.upArm, P.foreArm, [-0.5, 0.9, -0.9]);
    S.elL = eL.j;
    S.handL = eL.e;
    S.elR = eR.j;
    S.handR = eR.e;
    if (g) {
      g.grip = S.handR;
      g.k = Math.max(0.75, k);
      g.up = norm(sub([0, 0, 1], mul(g.axis, g.axis[2])));
    }
    S.gun = g;
    return S;
  }
  function human(P, pose, frame, wpn) {
    const S = legRig(P, pose, frame);
    upperRig(S, P, pose);
    return armRig(S, P, pose, frame, wpn);
  }
  // corpo só da cintura para cima (Flutuante, Etéreo, Homem-Serpente)
  function upperOnly(P, pel, lean, pose, frame, wpn) {
    const S = { pel, lean, swing: 0, bob: 0 };
    if (pose === 'walk') S.swing = Math.cos(PH(frame)) * 0.6;
    if (pose === 'fall') S.lean = lean - [0.1, 0.3, 0.45][frame];
    upperRig(S, P, pose);
    S.kneeL = add(pel, [3, -P.hipW, -6]);
    return armRig(S, P, pose, frame, wpn);
  }
  // arma só nas mãos de quem está de pé/ajoelhado/a apontar
  const wield = (pose, w) => (pose === 'fall' || pose === 'dead' ? 'none' : w);

  // queda genérica: rotação em torno dos pés, centrar no tile e assentar no chão
  const FALL_F = [0.08, 0.3, 0.68], FALL_C = [0, 0.3, 0.7];
  function fallRig(m, pose, frame, axis, full, pivot) {
    full = full || 1.5;
    if (pose === 'dead') {
      m.rotate(axis || 'b', full, pivot);
      m.center = 1;
      m.settle = true;
    } else if (pose === 'fall') {
      m.rotate(axis || 'b', full * FALL_F[frame], pivot);
      m.center = FALL_C[frame];
      m.settle = true;
    }
  }

  // ---- peças humanoides --------------------------------------------------------------------------------
  function drawFoot(m, ank, toe, P, col) {
    const side = [0, 1, 0], upv = norm(cross(toe, side));
    const c = add(add(ank, mul(toe, P.footA * 0.55)), mul(upv, -P.footH * 0.3));
    m.ellAx(c, [mul(toe, P.footA), mul(side, P.footB), mul(upv, P.footH)], col, { bias: -0.4 });
  }
  function drawLegs(m, S, P, c) {
    for (const sd of [-1, 1]) {
      const L = sd < 0;
      const hip = L ? S.hipL : S.hipR, knee = L ? S.kneeL : S.kneeR, ank = L ? S.ankL : S.ankR, toe = L ? S.toeL : S.toeR;
      m.limb(hip, knee, P.rThigh, P.rKnee, c.thigh);
      m.limb(knee, ank, P.rKnee * 0.95, P.rAnkle, c.shin == null ? c.thigh : c.shin);
      if (c.pad != null) {
        const fwd = norm(cross([0, sd, 0], sub(ank, knee)));
        m.ball(add(knee, mul(fwd, P.rKnee * -0.35 * sd)), P.rKnee * 0.95, c.pad, { bias: 0.6 });
      }
      if (c.boot != null) drawFoot(m, ank, toe, P, c.boot);
    }
  }
  function drawArms(m, S, P, c) {
    for (const sd of [-1, 1]) {
      const L = sd < 0;
      const sh = L ? S.shL : S.shR, el = L ? S.elL : S.elR, hd = L ? S.handL : S.handR;
      m.limb(sh, el, P.rUp, P.rElbow, c.arm, { bias: 0.4 });
      m.limb(el, hd, P.rElbow * 0.95, P.rWrist, c.fore == null ? c.arm : c.fore, { bias: 0.5 });
      if (c.hand != null) m.ball(hd, P.rHand, c.hand, { bias: 0.6 });
      if (c.pad != null) m.ell(add(sh, [0, sd * 0.4, 0.6 * P.k]), [P.rUp * 0.95, P.rUp * 1.05, P.rUp * 0.85], c.pad, { bias: 0.7, tilt: S.lean });
    }
  }
  function drawTorso(m, S, P, cPel, cChest, o) {
    m.ell(S.pel, P.pelvis, cPel, { tilt: S.lean });
    m.ell(S.chest, P.chest, cChest, Object.assign({ tilt: S.lean }, o));
  }
  // par de decalques na superfície de um elipsoide (olhos)
  function eyes(m, c, rr, o) {
    for (const sd of [-1, 1]) {
      const s = surf(c, rr, [1, sd * o.spread, o.dz || 0]);
      const t1 = norm(cross([0, 0, 1], s.n)), t2 = norm(cross(s.n, t1));
      const A1 = add(mul(t1, o.w), mul(t2, (o.slant || 0) * sd));
      m.feat(s.p, s.n, A1, mul(t2, o.h), o.col, { flat: true, bias: 0.6, vis: o.vis == null ? 0.05 : o.vis, spec: o.spec });
    }
  }
  function headFeat(m, c, rr, v, w, h, col, o) {
    const s = surf(c, rr, v), t1 = norm(cross([0, 0, 1], s.n)), t2 = norm(cross(s.n, t1));
    m.feat(s.p, s.n, mul(t1, w), mul(t2, h), col, Object.assign({ flat: true, bias: 0.6, vis: 0.05 }, o));
    return s;
  }

  // ---- armas ----------------------------------------------------------------------------------------
  const GUNCOL = {
    ballistic: { body: 0x3d4148, dark: 0x25282c, stock: 0x6b5236, tip: null },
    laser: { body: 0x7d8896, dark: 0x4a525d, stock: 0x5b6572, tip: 0xff5a46 },
    plasma: { body: 0x949f86, dark: 0x5b6555, stock: 0x7a866e, tip: 0x7dffa6 },
  };
  function drawGun(m, g, style) {
    const C = GUNCOL[style] || GUNCOL.ballistic, ax = g.axis, up = g.up, sd = norm(cross(up, ax)), k = g.k;
    const at = (s, u, w) => add(add(add(g.grip, mul(ax, s * k)), mul(up, u * k)), mul(sd, (w || 0) * k));
    const bx = (c, la, lw, lh, col, o) => m.boxAx(c, [mul(ax, la * k), mul(sd, lw * k), mul(up, lh * k)], col, Object.assign({ bias: 1.2 }, o));
    const glow = (p, r) => {
      m.ball(p, r * k, C.tip, { flat: true, edge: false, bias: 1.6 });
      m.halo(p, r * 3.2 * k, C.tip, 0.55);
    };
    const plasma = style === 'plasma';
    let tip;
    if (g.kind === 'pistol') {
      if (plasma) m.ellAx(at(2, 1.1), [mul(ax, 3.4 * k), mul(sd, 0.9 * k), mul(up, 1.2 * k)], C.body, { bias: 1.2 });
      else bx(at(2.2, 1.1), 2.8, 0.6, 0.9, C.body);
      bx(at(-0.2, -0.5), 0.7, 0.55, 1.3, C.dark);
      tip = at(5.4, 1.1);
      if (C.tip) glow(tip, 0.7);
    } else if (g.kind === 'rifle') {
      if (plasma) {
        m.ellAx(at(4, 1.3), [mul(ax, 7.5 * k), mul(sd, 1.25 * k), mul(up, 1.7 * k)], C.body, { bias: 1.2 });
        bx(at(0.4, -0.9), 0.8, 0.6, 1.4, C.dark);
        tip = at(11.8, 1.3);
        glow(tip, 1.0);
      } else {
        bx(at(3, 1.0), 6, 0.9, 1.5, C.body);
        bx(at(11.2, 1.5), 2.4, 0.5, 0.6, C.dark);
        bx(at(3.4, -1.4), 0.9, 0.7, 1.5, C.dark, { tilt: 0.2 });
        bx(at(-4.6, 0.4), 2.2, 0.75, 1.35, C.stock);
        tip = at(13.6, 1.5);
        if (C.tip) glow(tip, 0.8);
      }
    } else {
      // pesada: canhão/lança-foguetes; ao ombro quando aponta
      const u0 = g.shoulder ? 3.4 : 1.6;
      if (plasma) {
        m.ellAx(at(5, u0), [mul(ax, 10 * k), mul(sd, 2.0 * k), mul(up, 2.3 * k)], C.body, { bias: 1.2 });
        m.ellAx(at(1.5, u0 + 1.8), [mul(ax, 3 * k), mul(sd, 1.3 * k), mul(up, 1.0 * k)], C.dark, { bias: 1.3 });
        tip = at(15.5, u0);
        glow(tip, 1.4);
      } else {
        bx(at(4.5, u0), 9.5, 1.7, 2.0, C.body);
        bx(at(15.5, u0 + 0.2), 2.2, 1.0, 1.0, C.dark);
        bx(at(2.5, u0 - 2.6), 1.6, 1.3, 1.4, C.dark);
        bx(at(-6, u0 - 0.4), 1.5, 1.1, 1.6, C.stock);
        tip = at(17.8, u0 + 0.2);
        if (C.tip) glow(tip, 1.1);
      }
      bx(at(0, -0.6), 0.8, 0.6, 1.3, C.dark);
    }
    m.mark('muzzle', tip);
  }

  // ---- galões de patente no braço visível ----------------------------------------------------------------
  function rankPips(m, S, P, o) {
    const col = o.team === 'alien' ? 0xe060ff : o.team === 'civ' ? 0xf2f2f2 : 0xffc23a;
    const sd = m.facing([0, 1, 0]) >= -0.01 ? 1 : -1;
    const sh = sd > 0 ? S.shR : S.shL, el = sd > 0 ? S.elR : S.elL;
    const dir = norm(sub(el, sh)), n = norm([0, sd, 0.3]);
    const base = add(add(sh, mul(dir, P.rUp * 0.9)), [0, sd * P.rUp * 0.92, 0]);
    if (o.rank >= 4) {
      m.feat(base, n, [0.9, 0, 0], [0, 0, 0.9], col, { flat: true, bias: 2, vis: -0.3, spec: 0.6 });
      if (o.rank === 5) m.feat(add(base, mul(dir, 2)), n, [0.7, 0, 0], [0, 0, 0.7], col, { flat: true, bias: 2, vis: -0.3 });
      return;
    }
    for (let i = 0; i < o.rank; i++) m.feat(add(base, mul(dir, i * 1.15)), n, [1.0, 0, 0], [0, 0, 0.32], col, { flat: true, bias: 2, vis: -0.3 });
  }

  // ---- soldado X-COM ---------------------------------------------------------------------------------
  const ARMOUR = {
    coveralls: { suit: 0x2f7f9b, suit2: 0x27607c, trim: 0x8a7f5c, boot: 0x2b2520, glove: 0x3b3128, plate: null, bulk: 0, helmet: null },
    personal_armour: { suit: 0x46583f, suit2: 0x384830, trim: 0x2c3426, boot: 0x2a2c26, glove: 0x30362c, plate: 0x80996f, bulk: 0.35, helmet: 'open' },
    power_suit: { suit: 0x4a5772, suit2: 0x3b4660, trim: 0x8e9bb4, boot: 0x2b3240, glove: 0x353e50, plate: 0x66748f, bulk: 1, helmet: 'full', visor: 0x7fe4ff },
    flying_suit: { suit: 0x5a76a2, suit2: 0x4a6288, trim: 0xc9d4e6, boot: 0x303a52, glove: 0x3b4862, plate: 0x8fa6c9, bulk: 0.7, helmet: 'full', visor: 0xffc65a, pack: true },
  };
  function soldierP(A, female) {
    const b = A.bulk;
    return P_({
      shW: (female ? 5.0 : 5.6) + b * 1.0, hipW: 2.9 + b * 0.4, torso: 13.4 + b * 0.5, headR: 3.3,
      rThigh: 2.9 + b * 0.9, rKnee: 2.4 + b * 0.8, rAnkle: 1.9 + b * 0.6, rUp: 2.3 + b * 0.9, rElbow: 2.0 + b * 0.8, rWrist: 1.6 + b * 0.6, rHand: 1.6 + b * 0.4,
      chest: [3.4 + b * 0.9, (female ? 4.5 : 5.0) + b * 1.1, 6.4 + b * 0.3], pelvis: [2.9 + b * 0.5, (female ? 3.9 : 3.7) + b * 0.5, 3.0],
      footA: 2.9 + b * 0.6, footB: 1.6 + b * 0.5, footH: 1.4 + b * 0.4,
    });
  }
  function soldierHead(m, S, P, A, o) {
    const hc = S.head, r = P.headR;
    if (A.helmet === 'full') {
      const hr = [r * 1.15, r * 1.08, r * 1.3];
      m.ell(hc, hr, A.plate, { spec: 0.35 });
      const v = headFeat(m, hc, hr, [1, 0, 0.08], r * 0.98, r * 0.42, A.visor, { spec: 0.6 });
      m.halo(v.p, 3.2, A.visor, 0.28, v.n);
      m.limb(add(hc, [r * 0.5, 0, hr[2] * 0.85]), add(hc, [-r * 0.9, 0, hr[2] * 0.7]), 0.8, 0.8, shade(A.plate, 0.12), { bias: 0.3 });
      return;
    }
    const rr = [r, r * 0.92, r * 1.18], skin = SKIN[o.skin];
    m.ell(hc, rr, skin);
    eyes(m, hc, rr, { spread: 0.42, dz: 0.05, w: 0.42, h: 0.42, col: 0x231710, vis: 0.15 });
    if (A.helmet === 'open') {
      m.ell(add(hc, [-0.45 * r, 0, 0.42 * r]), [r * 1.1, r * 1.04, r * 1.02], A.plate, { spec: 0.3, bias: 0.15 });
      m.ell(add(hc, [0.1 * r, 0, 0.12 * r]), [r * 1.12, r * 1.06, r * 0.32], shade(A.plate, -0.2), { bias: 0.25 });
    } else {
      const hair = HAIR[o.skin];
      m.ell(add(hc, [-0.42 * r, 0, 0.42 * r]), [r * 0.93, r * 0.94, r * 0.92], hair, { bias: 0.05 });
      if (o.female) {
        m.limb(add(hc, [-r * 0.95, 0, r * 0.35]), add(hc, [-r * 1.45, 0, -r * 1.0]), 1.5, 1.0, hair, { bias: 0.1 });
      }
    }
  }
  function jetpack(m, S, P, A, flame) {
    const bk = [-Math.cos(S.lean), 0, Math.sin(S.lean)];
    const c = add(add(S.chest, mul(bk, P.chest[0] + 1.5)), mul(S.up, 0.6));
    m.box(c, [1.6, 3.5, 4.3], A.plate, { tilt: S.lean });
    for (const sd of [-1, 1]) {
      const top = add(c, add(mul(S.up, -2.8), [0, sd * 2.2, 0])), bot = add(top, [-0.4, sd * 0.2, -4.4]);
      m.cyl(top, bot, 1.35, 1.1, 0x353d4e, {});
      if (flame >= 0) {
        const fl = 3.2 + ((flame + (sd > 0 ? 1 : 0)) % 2) * 1.2;
        m.limb(add(bot, [0, 0, -0.2]), add(bot, [-0.3, 0, -fl]), 1.05, 0.15, 0xffd27a, { flat: true, edge: false, alpha: 0.9 });
        m.halo(add(bot, [0, 0, -1.8]), 4.5, 0xff9a3a, 0.5);
      }
    }
  }
  const BUILD = {};
  BUILD.soldier = function (m, pose, frame, o) {
    const A = ARMOUR[o.armour];
    if (pose === 'float' && !A.pack) pose = 'stand';
    const P = soldierP(A, o.female);
    const S = human(P, pose, frame, wield(pose, o.weapon));
    fallRig(m, pose, frame);
    drawLegs(m, S, P, { thigh: A.suit2, boot: A.boot, pad: A.plate });
    drawTorso(m, S, P, A.suit2, A.suit);
    m.ell(add(S.pel, mul(S.up, 2.2)), [P.pelvis[0] * 1.08, P.pelvis[1] * 1.05, 0.95], A.trim, { tilt: S.lean, bias: 4.5 });
    if (A.plate) {
      const fw = [Math.cos(S.lean), 0, -Math.sin(S.lean)];
      m.box(add(add(S.chest, mul(fw, P.chest[0] * 0.55)), mul(S.up, 0.8)), [P.chest[0] * 0.55, P.chest[1] * 0.82, P.chest[2] * 0.62], A.plate, { tilt: S.lean, bias: 1 });
    } else {
      // correias de lona sobre o fato-macaco
      const fw = [Math.cos(S.lean), 0, -Math.sin(S.lean)];
      for (const sd of [-1, 1]) {
        const a = add(add(S.shC, [0, sd * P.shW * 0.55, 0]), mul(fw, P.chest[0] * 0.7));
        const b = add(add(S.pel, mul(S.up, 3)), add(mul(fw, P.pelvis[0] * 1.02), [0, -sd * P.pelvis[1] * 0.35, 0]));
        m.line([a, lerp(a, b, 0.5), b], 0.9, A.trim, { bias: 4 });
      }
    }
    if (A.pack) jetpack(m, S, P, A, pose === 'float' ? frame : -1);
    drawArms(m, S, P, { arm: A.suit, hand: A.glove, pad: A.plate });
    soldierHead(m, S, P, A, o);
    if (S.gun) drawGun(m, S.gun, o.gun);
    if (o.rank) rankPips(m, S, P, o);
  };

  // ---- civis e Zombie ----------------------------------------------------------------------------------
  const CIV_SHIRT = [0xb84a3a, 0x3a6ab8, 0xd6c8a0, 0x4a8a5a, 0x8a5aa8, 0xd08a30, 0x5a5a62, 0x2a8a8a];
  const CIV_PANTS = [0x3a4a6a, 0x5a4a3a, 0x2a2a2e, 0x6a6a52, 0x394e74, 0x4a3a30, 0x25303e, 0x5e5446];
  const CIV_DRESS = [0xc85a8a, 0x7a5ac8, 0xd8a83a, 0x3aa8a8, 0xc84848, 0x5a8ad0, 0x8ab04a, 0xe0e0d0];
  function civHead(m, S, P, skin, hair, female) {
    const hc = S.head, r = P.headR, rr = [r, r * 0.92, r * 1.18];
    m.ell(hc, rr, skin);
    eyes(m, hc, rr, { spread: 0.42, dz: 0.05, w: 0.42, h: 0.42, col: 0x231710, vis: 0.15 });
    m.ell(add(hc, [-0.42 * r, 0, 0.42 * r]), [r * 0.93, r * 0.94, r * 0.92], hair, { bias: 0.05 });
    if (female) m.ell(add(hc, [-0.65 * r, 0, -0.35 * r]), [r * 0.8, r * 1.05, r * 0.95], hair, { bias: 0.08 });
  }
  BUILD.civilian_m = function (m, pose, frame, o) {
    const P = P_({ shW: 5.3, chest: [3.3, 4.8, 6.3], torso: 13.6, lean: 0.04 });
    const S = human(P, pose === 'float' ? 'stand' : pose, frame, 'none');
    fallRig(m, pose, frame);
    const v = (o.variant + o.skin * 3) & 7, skin = SKIN[o.skin];
    drawLegs(m, S, P, { thigh: CIV_PANTS[v], boot: 0x2e2620 });
    drawTorso(m, S, P, CIV_PANTS[v], CIV_SHIRT[v]);
    drawArms(m, S, P, { arm: CIV_SHIRT[v], fore: skin, hand: skin });
    civHead(m, S, P, skin, HAIR[(o.skin + o.variant) & 3], false);
  };
  BUILD.civilian_f = function (m, pose, frame, o) {
    const P = P_({ hip: 20, thigh: 9.9, shin: 9.6, torso: 13, shW: 4.7, hipW: 2.6, chest: [3.1, 4.3, 6.0], pelvis: [3.0, 4.0, 3.0], headR: 3.2, rThigh: 2.5, rKnee: 2.0, rAnkle: 1.5, rUp: 1.9, rElbow: 1.7, rWrist: 1.4, rHand: 1.4, footA: 2.4, footB: 1.3, footH: 1.1, stride: 5.2, lean: 0.03 });
    const S = human(P, pose === 'float' ? 'stand' : pose, frame, 'none');
    fallRig(m, pose, frame);
    const v = (o.variant + o.skin * 3) & 7, skin = SKIN[o.skin], dress = CIV_DRESS[v];
    drawLegs(m, S, P, { thigh: skin, boot: 0x5a2a2a });
    m.ell(S.pel, P.pelvis, dress, { tilt: S.lean });
    // saia em tronco de cone até aos joelhos
    const kneeH = (S.kneeL[2] + S.kneeR[2]) / 2, kneeA = (S.kneeL[0] + S.kneeR[0]) / 2;
    m.cyl(add(S.pel, mul(S.up, 1.5)), [kneeA * 0.7 + S.pel[0] * 0.3, 0, kneeH + 1.5], 3.6, 5.2, dress, { bias: 0.5 });
    m.ell(S.chest, P.chest, shade(dress, 0.12), { tilt: S.lean });
    drawArms(m, S, P, { arm: shade(dress, 0.12), fore: skin, hand: skin });
    civHead(m, S, P, skin, HAIR[(o.skin + o.variant + 1) & 3], true);
  };
  BUILD.zombie = function (m, pose, frame, o) {
    const P = P_({ hip: 19.5, thigh: 9.6, shin: 9.4, torso: 13, lean: 0.34, shW: 5.2, stride: 3.6, lift: 1.4, bob: 0.5, armSwing: 0 });
    const S = human(P, pose === 'float' ? 'stand' : pose, frame, pose === 'fall' || pose === 'dead' ? 'none' : 'zombie');
    fallRig(m, pose, frame);
    const skin = 0x7f9e6a, rag = 0x5e5946, pants = 0x3d3a34;
    drawLegs(m, S, P, { thigh: pants, boot: shade(skin, -0.15) });
    drawTorso(m, S, P, pants, rag);
    // rasgões e feridas na camisa
    const fw = [Math.cos(S.lean), 0, -Math.sin(S.lean)];
    m.feat(add(add(S.chest, mul(fw, P.chest[0] * 0.95)), [0, 1.4, -1]), mul(fw, 1), [0, 1.4, 0], [0, 0, 1.6], shade(skin, -0.1), { flat: true, bias: 0.4, vis: 0 });
    m.feat(add(add(S.chest, mul(fw, P.chest[0] * 0.9)), [0, -2.2, 1.5]), mul(fw, 1), [0, 0.9, 0.4], [0, -0.3, 0.9], 0x5a1e1a, { flat: true, bias: 0.5, vis: 0 });
    drawArms(m, S, P, { arm: rag, fore: skin, hand: skin });
    const hc = S.head, r = P.headR, rr = [r, r * 0.92, r * 1.15];
    m.ell(hc, rr, skin);
    eyes(m, hc, rr, { spread: 0.42, dz: 0.08, w: 0.5, h: 0.45, col: 0xe8e0a0, vis: 0.12 });
    m.ell(add(hc, [-0.45 * r, 0.2, 0.55 * r]), [r * 0.85, r * 0.8, r * 0.7], 0x3a3428, { bias: 0.05 });
  };

  // ---- Sectoide ---------------------------------------------------------------------------------------
  const SECTOID_P = P_({
    k: 0.62, hip: 10.6, ankle: 1.0, thigh: 5.5, shin: 5.3, torso: 7.6, neck: 0.6, headR: 3.6, shW: 3.2, hipW: 1.6, shDrop: 1.0,
    upArm: 5.0, foreArm: 4.8, rThigh: 1.6, rKnee: 1.3, rAnkle: 1.1, rUp: 1.35, rElbow: 1.15, rWrist: 1.0, rHand: 1.1,
    chest: [2.1, 3.1, 4.1], pelvis: [1.8, 2.3, 1.9], footA: 1.9, footB: 1.0, footH: 0.8, lean: 0.03, stride: 3.8, lift: 1.9, bob: 0.5, armSwing: 2.6,
  });
  BUILD.sectoid = function (m, pose, frame, o) {
    const P = SECTOID_P;
    const S = human(P, pose === 'float' ? 'stand' : pose, frame, wield(pose, o.weapon));
    fallRig(m, pose, frame);
    const skin = 0xa9a79d, limbs = 0x96948a;
    drawLegs(m, S, P, { thigh: limbs, boot: limbs });
    drawTorso(m, S, P, limbs, skin);
    drawArms(m, S, P, { arm: limbs, hand: limbs });
    // crânio enorme em ovo invertido, queixo pequeno, olhos negros amendoados
    const hc = add(S.head, [-0.6, 0, 1.4]), rr = [5.3, 4.7, 5.6];
    m.ell(add(S.head, [1.5, 0, -2.0]), [2.6, 2.4, 2.4], skin);
    m.ell(hc, rr, shade(skin, 0.06));
    eyes(m, hc, rr, { spread: 0.6, dz: -0.3, w: 1.95, h: 1.15, slant: 0.55, col: 0x0b0a0e, vis: -0.1, spec: 0.55 });
    headFeat(m, hc, rr, [1, 0, -0.75], 0.7, 0.18, 0x55534c, { vis: 0.1 });
    if (S.gun) drawGun(m, S.gun, o.gun);
  };

  // ---- Muton -----------------------------------------------------------------------------------------
  const MUTON_P = P_({
    k: 1.1, hip: 21, ankle: 1.9, thigh: 10.7, shin: 10.3, torso: 17, neck: 0.5, headR: 3.4, shW: 7.6, hipW: 3.8, shDrop: 2.2,
    upArm: 8.0, foreArm: 7.6, rThigh: 3.9, rKnee: 3.3, rAnkle: 2.7, rUp: 3.4, rElbow: 3.0, rWrist: 2.5, rHand: 2.4,
    chest: [4.7, 7.0, 7.8], pelvis: [3.7, 4.8, 3.6], footA: 3.4, footB: 2.1, footH: 1.8, lean: 0.08, stride: 6.2, lift: 3, bob: 1.0, armSwing: 3.6,
  });
  BUILD.muton = function (m, pose, frame, o) {
    const P = MUTON_P;
    const S = human(P, pose === 'float' ? 'stand' : pose, frame, wield(pose, o.weapon));
    fallRig(m, pose, frame);
    const skin = 0x63a23c, suit = 0x3d5d30, plate = 0x6e7d6a, trim = 0x2c3a26;
    drawLegs(m, S, P, { thigh: suit, boot: trim, pad: plate });
    drawTorso(m, S, P, suit, suit);
    const fw = [Math.cos(S.lean), 0, -Math.sin(S.lean)];
    m.box(add(add(S.chest, mul(fw, P.chest[0] * 0.5)), mul(S.up, 1.2)), [P.chest[0] * 0.6, P.chest[1] * 0.78, P.chest[2] * 0.6], plate, { tilt: S.lean, bias: 1 });
    m.ell(add(S.pel, mul(S.up, 2.4)), [P.pelvis[0] * 1.06, P.pelvis[1] * 1.04, 1.0], trim, { tilt: S.lean, bias: 4.5 });
    drawArms(m, S, P, { arm: suit, fore: skin, hand: skin, pad: plate });
    const hc = S.head, r = P.headR, rr = [r * 1.05, r * 1.05, r * 1.1];
    m.ell(add(hc, [0.6, 0, -1.8]), [r * 0.9, r * 0.95, r * 0.6], skin);
    m.ell(hc, rr, skin);
    eyes(m, hc, rr, { spread: 0.45, dz: 0.12, w: 0.65, h: 0.4, col: 0x200a08, vis: 0.1 });
    headFeat(m, hc, rr, [1, 0, 0.42], r * 0.85, r * 0.3, shade(skin, -0.32), { vis: 0.05 });
    if (S.gun) drawGun(m, S.gun, o.gun);
  };

  // ---- Flutuante ---------------------------------------------------------------------------------------
  const FLOATER_P = P_({ k: 0.95, torso: 11, neck: 0.2, headR: 2.9, shW: 5.4, hipW: 2.4, shDrop: 1.8, upArm: 7.0, foreArm: 6.6, rUp: 2.1, rElbow: 1.8, rWrist: 1.5, rHand: 1.6, chest: [3.9, 5.2, 5.6], lean: 0.22, armSwing: 2 });
  BUILD.floater = function (m, pose, frame, o) {
    const P = FLOATER_P, ph = PH(frame);
    const bob = pose === 'walk' || pose === 'float' ? Math.sin(ph) * 1.2 : 0;
    let L = 9 + bob;
    if (pose === 'kneel') L = 5;
    else if (pose === 'fall') L = [6, 3, 1][frame];
    else if (pose === 'dead') L = 0;
    fallRig(m, pose, frame);
    const S = upperOnly(P, [0, 0, L + 11], P.lean, pose, frame, wield(pose, o.weapon));
    const skin = 0xa06c7e, flesh = 0x6c4254, metal = 0x8a8796, sway = Math.sin(ph + 1) * 0.8;
    const alive = pose !== 'dead' && !(pose === 'fall' && frame > 0);
    // aparelho de suporte de vida: cápsula metálica em cone, anel e lente antigravítica
    m.cyl([0, 0, L - 0.5], [0, 0, L + 7], 1.5, 4.6, metal, { cap: false });
    m.ell([0, 0, L + 7.2], [5.0, 5.0, 1.2], shade(metal, -0.25));
    m.ball([0, 0, L - 0.4], 1.5, alive ? 0x9fe8ff : 0x3a4048, { flat: true, edge: false, bias: 1 });
    // saia de carne curta e franjas pendentes à volta da cápsula
    m.cyl([0, 0, L + 13], [0, 0, L + 7.5], 4.3, 5.6, flesh, { bias: 0.5 });
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * TAU + 0.2, r = 5.1;
      const p = [Math.cos(t) * r, Math.sin(t) * r, L + 7.8];
      const e = add(p, [Math.cos(t) * 0.9 - sway * 0.7, Math.sin(t) * 0.9, -5.0 - (i % 3) * 1.3]);
      m.limb(p, e, 1.0, 0.35, shade(flesh, -0.05));
    }
    m.ell(S.chest, P.chest, skin, { tilt: S.lean });
    // tubos do aparelho de respiração
    const bk = add(S.chest, [-P.chest[0] * 0.9, 0, 0]);
    for (const sd of [-1, 1]) m.line([add(bk, [0, sd * 1.8, 2]), add(bk, [-1.8, sd * 2.4, -1]), [-2.8, sd * 2.6, L + 9]], 0.9, 0x3c3644, {});
    drawArms(m, S, P, { arm: skin, hand: shade(skin, -0.1) });
    // cabeça enrugada, metida entre os ombros
    const hc = S.head, rr = [3.0, 2.8, 3.1];
    m.ell(hc, rr, skin);
    eyes(m, hc, rr, { spread: 0.5, dz: 0.2, w: 0.65, h: 0.5, col: 0x2a0812, vis: 0.08, spec: 0.4 });
    headFeat(m, hc, rr, [1, 0, -0.4], 1.3, 0.6, 0x3a1424, {});
    m.ell(add(hc, [-0.8, 0, 1.4]), [2.4, 2.4, 1.6], shade(skin, -0.12), { bias: 0.1 });
    if (alive) m.halo([0, 0, L - 1.5], 8, 0x9fe8ff, 0.4);
    if (S.gun) drawGun(m, S.gun, o.gun);
  };

  // ---- Homem-Serpente ----------------------------------------------------------------------------------
  const SNAKE_P = P_({ k: 0.95, torso: 12.5, neck: 1.2, headR: 2.8, shW: 4.8, hipW: 2.6, shDrop: 1.4, upArm: 7.0, foreArm: 6.6, rUp: 2.0, rElbow: 1.8, rWrist: 1.5, rHand: 1.5, chest: [3.3, 4.4, 6.0], lean: 0.12, armSwing: 2.5 });
  BUILD.snakeman = function (m, pose, frame, o) {
    const P = SNAKE_P, ph = PH(frame);
    const fallK = pose === 'dead' ? 1 : pose === 'fall' ? [0.15, 0.45, 0.8][frame] : 0;
    const low = pose === 'kneel' ? -3 : -fallK * 9;
    const pel = [0.5, 0, 15 + low];
    const S = upperOnly(P, pel, P.lean + (pose === 'kneel' ? 0.15 : 0), pose, frame, wield(pose, o.weapon));
    const sc = 0x98a23a, sc2 = 0x76822a, belly = 0xd2c97c;
    // cauda enrolada em espiral no chão
    const T = [[0.5, 0, 15 + low, 4.0], [-0.4, 0, 9.5 + low * 0.6, 4.4], [-2.5, 0.4, 4.8, 4.2], [-6, 2.6, 3.4, 3.8], [-9.6, 0.6, 2.9, 3.3], [-9.2, -3.4, 2.5, 2.8], [-5.8, -4.8, 2.1, 2.3], [-2.6, -3.6, 1.8, 1.8], [-1.0, -1.0, 1.5, 1.3], [-1.8, 1.2, 1.2, 0.7]];
    if (pose === 'walk') {
      for (let i = 2; i < T.length; i++) {
        T[i][1] += Math.sin(ph + i * 0.9) * 0.9;
        T[i][0] += Math.cos(ph + i * 0.9) * 0.5;
      }
    }
    for (let i = 0; i + 1 < T.length; i++) m.limb(T[i].slice(0, 3), T[i + 1].slice(0, 3), T[i][3], T[i + 1][3], i & 1 ? sc2 : sc);
    if (fallK) {
      m.rotate('b', -1.5 * fallK, [1.5, 0, 3], m.prims.length);
      m.settle = true;
      m.center = fallK * 0.6;
    }
    m.ell(S.chest, P.chest, sc, { tilt: S.lean });
    const fw = [Math.cos(S.lean), 0, -Math.sin(S.lean)];
    m.ell(add(add(S.chest, mul(fw, P.chest[0] * 0.55)), mul(S.up, -1.5)), [P.chest[0] * 0.55, P.chest[1] * 0.6, P.chest[2] * 0.85], belly, { tilt: S.lean, bias: 0.5 });
    drawArms(m, S, P, { arm: sc, fore: sc2, hand: shade(sc, -0.2) });
    // cabeça de réptil com focinho
    const hc = add(S.head, [0.2, 0, -0.4]), rr = [3.4, 2.6, 2.8];
    m.ell(hc, rr, sc);
    m.ell(add(hc, [3.0, 0, -0.7]), [2.5, 1.7, 1.5], sc, { bias: 0.2 });
    eyes(m, hc, rr, { spread: 0.95, dz: 0.4, w: 0.7, h: 0.55, col: 0xffd23a, vis: 0.0 });
    m.ell(add(hc, [-1.2, 0, 1.6]), [2.0, 1.0, 1.4], sc2, { bias: 0.15 });
    if (S.gun) drawGun(m, S.gun, o.gun);
  };

  // ---- Etéreo ------------------------------------------------------------------------------------------
  const ETH_P = P_({ k: 0.95, torso: 11.5, neck: 1.2, headR: 3.0, shW: 4.6, hipW: 2.6, shDrop: 1.4, upArm: 7.2, foreArm: 6.8, rUp: 2.0, rElbow: 2.2, rWrist: 2.3, rHand: 1.3, chest: [3.2, 4.4, 5.8], lean: 0.02, armSwing: 1.6 });
  BUILD.ethereal = function (m, pose, frame, o) {
    const P = ETH_P, ph = PH(frame);
    let lift = 3 + (pose === 'walk' || pose === 'float' ? Math.sin(ph) * 0.9 : 0);
    if (pose === 'kneel') lift = 1.2;
    else if (pose === 'fall' || pose === 'dead') lift = 0;
    fallRig(m, pose, frame);
    const S = upperOnly(P, [0, 0, lift + 18], P.lean, pose, frame, wield(pose, o.weapon));
    const robe = 0xcfa53a, dark = 0x8c6820, trim = 0x6e3a7e, pale = 0xc9b8a0;
    const sway = pose === 'walk' ? Math.cos(ph) * 0.9 : 0;
    // manto longo em tronco de cone, bainha roxa e pregas
    const down = pose === 'dead' || pose === 'fall';
    m.cyl([sway, 0, lift + 0.8], add(S.chest, [0, 0, 2]), 7.0, 4.2, robe, { sb: 1.08, capCol: 0x2a1830 });
    if (!down) m.cyl([sway, 0, lift + 0.2], [sway, 0, lift + 1.8], 7.1, 6.95, trim, { sb: 1.08, bias: 0.4, cap: false });
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * TAU + 0.3;
      const a = [Math.cos(t) * 6.6 + sway, Math.sin(t) * 7.1, lift + 2.2], b = add(S.chest, [Math.cos(t) * 3.6, Math.sin(t) * 3.8, 0]);
      m.line([a, lerp(a, b, 0.6)], 0.7, dark, { bias: 0.9, alpha: 0.85 });
    }
    m.ell(S.chest, P.chest, robe, { tilt: S.lean, bias: 0.3 });
    m.ell(add(S.neck, [0, 0, -0.6]), [3.1, 4.6, 1.6], dark, { bias: 0.4 });
    drawArms(m, S, P, { arm: robe, hand: pale });
    const hc = add(S.head, [-0.3, 0, 0.6]), rr = [3.0, 2.7, 4.1];
    m.ell(add(hc, [-1.3, 0, -0.6]), [3.0, 3.6, 4.0], dark, { bias: -0.2 });
    m.ell(hc, rr, pale);
    eyes(m, hc, rr, { spread: 0.48, dz: 0.0, w: 1.0, h: 0.5, slant: 0.3, col: 0x1e1028, vis: 0.0, spec: 0.35 });
    headFeat(m, hc, rr, [1, 0, -0.55], 0.6, 0.2, 0x8a6a6a, { vis: 0.1 });
    if (pose !== 'dead' && pose !== 'fall') m.halo([0, 0, 0.5], 9, 0xe0b8ff, 0.22);
    if (S.gun) drawGun(m, S.gun, o.gun);
  };

  // ---- Crisálida --------------------------------------------------------------------------------------
  BUILD.chryssalid = function (m, pose, frame, o) {
    const ph = PH(frame), walk = pose === 'walk', atk = pose === 'aim';
    const low = pose === 'kneel' ? -3 : 0;
    fallRig(m, pose, frame, 'a', 1.55);
    const curl = pose === 'dead' ? 1 : pose === 'fall' ? [0.1, 0.4, 0.75][frame] : 0;
    const tuck = (base, p) => lerp(p, base, curl * 0.55);
    const shell = 0x262a3e, shell2 = 0x31354c, claw = 0xb4a98c, eye = 0xff5a2a;
    const c = walk ? Math.cos(ph) : 0, s = walk ? Math.sin(ph) : 0;
    const bob = walk ? -Math.abs(c) * 0.6 : 0;
    const H = 19 + low + bob;
    // pernas digitígradas
    for (const sd of [-1, 1]) {
      const st = sd * c * 3.4, up = Math.max(0, sd * s) * 2.2;
      const hip = [-3.5, sd * 3.0, H - 5], knee = tuck(hip, [1.8 + st * 0.5, sd * 5.0, H - 10 + up * 0.5]), ank = tuck(hip, [-2.4 + st, sd * 5.2, 4.2 + up]), ft = tuck(hip, [0.9 + st * 1.2, sd * 5.0, 0.7 + up]);
      m.limb(hip, knee, 2.7, 2.1, shell);
      m.limb(knee, ank, 2.0, 1.4, shell2);
      m.limb(ank, ft, 1.4, 0.7, shell);
    }
    m.ell([-7.5, 0, H - 4], [5.2, 4.3, 4.2], shell2, { tilt: -0.25 });
    m.ell([-1.2, 0, H], [5.4, 3.9, 4.6], shell, { tilt: 0.55 });
    for (let i = 0; i < 3; i++) m.limb([-3 - i * 3.2, 0, H + 3.4 - i * 0.6], [-4.4 - i * 3.2, 0, H + 6.4 - i * 0.6], 1.0, 0.25, claw, { bias: 0.2 });
    const hc = [4.6, 0, H + 3.4 + (atk ? -1.5 : 0)], rr = [3.2, 2.6, 2.8];
    m.ell(hc, rr, shell);
    eyes(m, hc, rr, { spread: 0.55, dz: 0.25, w: 0.65, h: 0.5, col: eye, vis: 0.0, spec: 0.5 });
    for (const sd of [-1, 1]) m.limb(add(hc, [2.2, sd * 1.0, -1.2]), add(hc, [4.0, sd * 0.4, -3.4]), 0.75, 0.25, claw, { bias: 0.3 });
    if (eye && pose !== 'dead') m.halo(add(hc, [2.4, 0, 0.6]), 2.6, eye, 0.3, [1, 0, 0.3]);
    // tenazes
    for (const sd of [-1, 1]) {
      const sw = walk ? sd * c * 1.2 : 0;
      const sh = [2.4, sd * 3.8, H + 2];
      const el = tuck(sh, atk ? [7.2, sd * 6.4, H + 11] : [5.4 + sw, sd * 6.8, H + 7]), cl = tuck(sh, atk ? [14, sd * 3.4, H + 5] : [10.4 + sw, sd * 4.4, H - 2.5]), tip = tuck(sh, atk ? [15.4, sd * 2.4, H - 0.4] : [9.2 + sw, sd * 3.4, H - 6]);
      m.limb(sh, el, 2.2, 1.8, shell2, { bias: 0.4 });
      m.limb(el, cl, 1.8, 1.1, shell, { bias: 0.5 });
      m.limb(cl, tip, 1.1, 0.3, claw, { bias: 0.6 });
    }
  };

  // ---- Ciberdisco (2×2) ----------------------------------------------------------------------------------
  BUILD.cyberdisc = function (m, pose, frame, o) {
    const ph = PH(frame), dead = pose === 'dead', fall = pose === 'fall';
    let H = 13 + (pose === 'walk' || pose === 'float' || pose === 'stand' ? Math.sin(ph) * 1.5 : 0);
    if (pose === 'kneel') H = 9;
    if (fall) H = [9, 4.5, 1.2][frame];
    if (dead) H = 0;
    const metal = dead ? 0x5c6168 : 0x8d949c, dark = dead ? 0x34383e : 0x5a6068, lit = !dead && !(fall && frame > 1);
    const tilt = fall ? [0.2, 0.42, 0.55][frame] : dead ? 0.32 : pose === 'aim' ? -0.14 : 0;
    if (tilt) m.rotate('b', -tilt, [0, 0, H + 6]);
    if (fall || dead) m.settle = true;
    m.cyl([0, 0, H], [0, 0, H + 6], 7, 20, dark);
    m.cyl([0, 0, H + 6], [0, 0, H + 8.5], 20, 20.5, shade(metal, 0.1), { cap: false });
    m.cyl([0, 0, H + 8.5], [0, 0, H + 13], 20.5, 9, metal);
    m.ell([0, 0, H + 13.4], [8.5, 8.5, 3.6], shade(metal, 0.18), { spec: 0.35 });
    // luzes do bordo (piscam por frame)
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * TAU, p = [Math.cos(t) * 20.6, Math.sin(t) * 20.6, H + 7.25], n = [Math.cos(t), Math.sin(t), 0];
      const on = lit && (i + frame) % 3 !== 0, col = !lit ? 0x2a2e33 : i & 1 ? 0xffc646 : 0x56e2ff;
      m.feat(p, n, [0, 0, 1.0], [-Math.sin(t) * 1.4, Math.cos(t) * 1.4, 0], on ? col : shade(col, -0.55), { flat: true, vis: -0.02, bias: 1 });
      if (on && i % 2 === 0) m.halo(p, 3.2, col, 0.4, n);
    }
    // casulo da arma virado para a frente
    m.ell([17.2, 0, H + 5.2], [4.4, 3.4, 2.4], 0x3e444c, { bias: 1 });
    const lens = [21.2, 0, H + 4.8];
    m.feat(lens, [1, 0, -0.15], [0, 1.6, 0], [0, 0, 1.2], lit ? 0xff8a3a : 0x3a2a22, { flat: true, vis: -0.3, bias: 2, spec: lit ? 0.6 : 0 });
    m.mark('muzzle', lens);
    if (lit) m.halo(lens, pose === 'aim' ? 7 : 4, 0xff8a3a, pose === 'aim' ? 0.7 : 0.4, [1, 0, -0.15]);
    if (lit) m.halo([0, 0, H - 2], 14, 0x6fd8ff, 0.3);
    if (dead) {
      m.line([[-6, -12, H + 12], [-1, -4, H + 13.5], [3, -7, H + 12.5], [8, 2, H + 13]], 0.9, 0x1a1c20, { bias: 3 });
      for (const [a, b, r] of [[-22, 8, 2.2], [14, 20, 1.8], [24, -10, 1.6], [-12, -22, 1.4]]) m.box([a, b, r * 0.6], [r * 1.4, r, r * 0.6], dark, { yaw: a * 0.1 });
    }
  };

  // ---- Sectópode (2×2) ----------------------------------------------------------------------------------
  BUILD.sectopod = function (m, pose, frame, o) {
    const ph = PH(frame), walk = pose === 'walk';
    const metal = 0x7d8693, dark = 0x3b414b, light = 0x9ba4b0;
    const c = walk ? Math.cos(ph) : 0, s = walk ? Math.sin(ph) : 0;
    let drop = pose === 'kneel' ? 3 : 0, tilt = pose === 'aim' ? 0.1 : 0, spread = 11;
    if (pose === 'fall') {
      drop = [5, 13, 21][frame];
      tilt = [0.1, 0.2, 0.3][frame];
      spread = 11 + frame * 2;
    } else if (pose === 'dead') {
      drop = 24;
      tilt = 0.28;
      spread = 16;
    }
    const BH = 35 - drop + (walk ? -Math.abs(c) * 0.8 : 0);
    for (const sd of [-1, 1]) {
      const st = sd * c * 7, up = Math.max(0, -sd * s) * 4;
      const hip = [-1, sd * 8.5, BH - 5], ft = [st, sd * spread, 2.2 + up];
      const kn = ik(hip, ft, 14, 15, [1, sd * 0.3, 0]);
      m.ball(hip, 4.2, dark);
      m.limb(hip, kn.j, 4.2, 3.4, metal);
      m.ball(kn.j, 3.6, dark, { bias: 0.4 });
      m.limb(kn.j, kn.e, 3.3, 2.5, metal);
      m.cyl(add(kn.e, [0, 0, -0.6]), add(kn.e, [0, 0, 1.6]), 2.6, 2.2, dark, {});
      m.box(add(kn.e, [1.4, 0, -1.0]), [5.6, 3.4, 1.9], dark, { yaw: sd * 0.12 });
    }
    if (tilt) m.rotate('b', -tilt, [0, 0, BH]);
    if (pose === 'fall' || pose === 'dead') m.settle = true;
    m.ell([0, 0, BH], [11.5, 10.5, 7.2], metal);
    m.ell([-0.8, 0, BH + 4.2], [9.8, 9.2, 4.2], light, { spec: 0.3 });
    m.box([-1, 0, BH - 6.2], [6.2, 6.2, 1.5], dark);
    m.ell([7.2, 0, BH + 2.4], [3.6, 5.2, 3.0], shade(metal, -0.12), { bias: 0.3 });
    const alive = pose !== 'dead' && !(pose === 'fall' && frame === 2);
    const eyeP = [10.6, 0, BH + 2.4];
    m.feat(eyeP, [1, 0, 0.15], [0, 2.4, 0], [0, 0, 1.1], alive ? 0xff3a2a : 0x3a1a18, { flat: true, vis: -0.2, bias: 1, spec: alive ? 0.5 : 0 });
    if (alive) m.halo(eyeP, pose === 'aim' ? 6 : 4, 0xff4a2a, 0.5, [1, 0, 0.15]);
    // canhão sob o corpo
    m.box([12, 0, BH - 4.8], [5.6, 1.8, 1.8], dark, { bias: 0.5 });
    m.box([18.6, 0, BH - 4.8], [1.2, 1.2, 1.2], 0x24282e, { bias: 0.6 });
    m.mark('muzzle', [19.8, 0, BH - 4.8]);
    if (pose === 'aim') m.halo([20.2, 0, BH - 4.8], 5, 0xff7a40, 0.55);
    for (const sd of [-1, 1]) m.line([[-5, sd * 10.2, BH + 1], [3, sd * 10.2, BH + 1.8]], 0.8, dark, { bias: 2 });
  };

  // ---- Ceifador (2×2) ----------------------------------------------------------------------------------
  BUILD.reaper = function (m, pose, frame, o) {
    const ph = PH(frame), walk = pose === 'walk', atk = pose === 'aim';
    const fur = 0xc4582a, furD = 0x7c2e16, tooth = 0xeee2b4, mouth = 0x4a1010;
    const c = walk ? Math.cos(ph) : 0, s = walk ? Math.sin(ph) : 0;
    fallRig(m, pose, frame, 'a', 1.45);
    const bob = walk ? -Math.abs(c) * 1.2 : 0, low = pose === 'kneel' ? -3 : 0;
    const BH = 31 + bob + low;
    for (const sd of [-1, 1]) {
      const st = sd * c * 6, up = Math.max(0, -sd * s) * 3.5;
      const hip = [-3, sd * 6.5, BH - 4], kn = [4 + st * 0.4, sd * 7.5, BH - 13.5 + up * 0.6], ank = [-3 + st, sd * 7.5, 5.5 + up], ft = [2.6 + st * 1.1, sd * 7.5, 0.9 + up];
      m.limb(hip, kn, 5.4, 4.0, fur);
      m.limb(kn, ank, 3.3, 2.5, shade(fur, -0.1));
      m.limb(ank, ft, 2.3, 1.3, shade(fur, -0.15));
      for (const tw of [-1, 0, 1]) m.limb(ft, add(ft, [2.2, tw * 1.2, -0.5]), 0.8, 0.25, tooth, { bias: 0.3 });
    }
    m.ell([0, 0, BH], [11.5, 7.5, 7.6], fur, { tilt: 0.06 });
    for (let i = 0; i < 3; i++) m.ell([4 - i * 5, 0, BH + 6.6 - Math.abs(i - 1) * 0.6], [1.6, 5.6, 1.2], furD, { bias: 0.8 + i * 0.05 });
    m.limb([-10, 0, BH + 1], [-16, 3, BH + 0.5], 4.4, 3.0, fur);
    m.limb([-16, 3, BH + 0.5], [-19.5, 8.5 + s * 1.5, BH - 3.5], 3.0, 1.0, shade(fur, -0.1));
    const lunge = atk ? 3.5 : 0;
    const hc = [14.5 + lunge, 0, BH + 9 - lunge * 0.8];
    m.limb([8, 0, BH + 3], hc, 5.4, 4.6, fur, { bias: 0.2 });
    m.ell(hc, [6.2, 5.0, 5.2], fur, { bias: 0.3 });
    const jaw = atk ? 0.6 : 0.25;
    m.ell(add(hc, [5.4, 0, -0.6]), [4.0, 3.7, 2.6], fur, { tilt: -0.1, bias: 0.4 });
    m.ball(add(hc, [5.6, 0, -3.2 - jaw * 2]), 2.6, mouth, { bias: 0.35 });
    m.ell(add(hc, [4.6, 0, -4.8 - jaw * 3]), [4.0, 3.2, 1.6], shade(fur, -0.12), { tilt: -jaw, bias: 0.45 });
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) m.limb(add(hc, [7.5 - i * 1.6, sd * 2.2, -2.4]), add(hc, [7.5 - i * 1.6, sd * 2.0, -3.6 - jaw]), 0.55, 0.15, tooth, { bias: 0.6 });
    eyes(m, add(hc, [0, 0, 1.4]), [6.2, 5.0, 5.2], { spread: 0.75, dz: 0.45, w: 0.8, h: 0.55, col: 0xffd84a, vis: -0.1 });
    m.mark('muzzle', add(hc, [9.4, 0, -2.4]));
  };

  // ---- cache LRU com orçamento em píxeis ------------------------------------------------------------------
  const cache = new Map();
  let pixels = 0;
  let budget = 24e6;
  const area = (s) => s.c.width * s.c.height * (1 + (s.sil ? 1 : 0) + (s.white ? 1 : 0));
  function remember(k, spr) {
    cache.set(k, spr);
    pixels += area(spr);
    while (pixels > budget && cache.size > 1) {
      const first = cache.keys().next().value;
      pixels -= area(cache.get(first));
      cache.delete(first);
    }
  }
  const qScale = (s) => clamp(Math.round((+s || 1) * 4) / 4, 0.25, 8);
  const intIn = (v, a, b) => clamp(Math.round(+v || 0), a, b);
  function normOpts(key, opts) {
    opts = opts || {};
    const o = {};
    o.armour = key === 'soldier' && ARMOUR[opts.armour] ? opts.armour : 'coveralls';
    o.skin = SKINNED[key] ? intIn(opts.skin, 0, 3) : 0;
    o.female = key === 'soldier' ? !!opts.female : key === 'civilian_f';
    o.weapon = ARMED[key] && WEAPONS.indexOf(opts.weapon) >= 0 ? opts.weapon : 'none';
    o.gun = o.weapon === 'none' ? '-' : GUNS.indexOf(opts.gun) >= 0 ? opts.gun : key === 'soldier' ? 'ballistic' : 'plasma';
    o.team = TEAMS.indexOf(opts.team) >= 0 ? opts.team : key === 'soldier' ? 'xcom' : SKINNED[key] ? 'civ' : 'alien';
    o.rank = key === 'soldier' ? intIn(opts.rank, 0, 5) : 0;
    o.variant = key === 'civilian_m' || key === 'civilian_f' ? intIn(opts.variant, 0, 7) : 0;
    o.sig = o.armour + ',' + o.skin + ',' + (o.female ? 1 : 0) + ',' + o.weapon + ',' + o.gun + ',' + o.team + ',' + o.rank + ',' + o.variant;
    return o;
  }
  function normPose(pose, frame) {
    const p = FRAMES[pose] ? pose : 'stand', n = FRAMES[p];
    let f = Math.round(+frame || 0);
    f = p === 'fall' ? clamp(f, 0, n - 1) : ((f % n) + n) % n;
    return { pose: p, frame: f };
  }
  function build(key, dir, pose, frame, o) {
    const m = new Model(dir, SIZE2[key] ? 2 : 1);
    BUILD[key](m, pose, frame, o);
    return m;
  }

  function get(key, dir, pose, frame, scale, opts) {
    if (!BUILD[key]) key = 'soldier';
    dir = (((Math.round(+dir || 0)) % 8) + 8) % 8;
    const pf = normPose(pose, frame);
    scale = qScale(scale);
    const o = normOpts(key, opts);
    const k = key + '|' + dir + '|' + pf.pose + '|' + pf.frame + '|' + scale + '|' + o.sig;
    let spr = cache.get(k);
    if (spr) {
      cache.delete(k);
      cache.set(k, spr);
      return spr;
    }
    spr = raster(build(key, dir, pf.pose, pf.frame, o), scale);
    remember(k, spr);
    return spr;
  }
  // modelo projetado sem rasterizar (testes e depuração)
  function model(key, dir, pose, frame, opts) {
    if (!BUILD[key]) key = 'soldier';
    const pf = normPose(pose, frame);
    const m = build(key, (((dir | 0) % 8) + 8) % 8, pf.pose, pf.frame, normOpts(key, opts));
    m.finish();
    const parts = m.project();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of parts) {
      x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]); x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]);
    }
    return { parts, halos: m.projHalos(), marks: m.projMarks(), bbox: [x0, y0, x1, y1], size: m.size };
  }
  // ponto local (a, b, h) de uma unidade virada para dir → deslocamento de ecrã a zoom 1
  function project(dir, a, b, h) {
    const p = Model.prototype.P.call(new Model(((dir | 0) % 8 + 8) % 8, 1), [a, b, h]);
    return { x: p[0], y: p[1] };
  }

  // silhueta (noite rgb(5,10,30) ou branco para o clarão de dano), criada a pedido
  function silhouette(spr, white) {
    const f = white ? 'white' : 'sil';
    if (spr[f]) return spr[f];
    const c = makeCanvas(spr.c.width, spr.c.height), g = c.getContext('2d');
    g.drawImage(spr.c, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = white ? '#ffffff' : css(NIGHT);
    g.fillRect(0, 0, c.width, c.height);
    spr[f] = c;
    pixels += c.width * c.height;
    return c;
  }
  // desenha um sprite com a âncora em (x, y) (px CSS do contexto), alinhado a píxeis do dispositivo;
  // shade 0..15 escurece com a silhueta noturna (16 = não desenha), flash 0..1 = clarão branco
  function blit(ctx, spr, x, y, zoom, shade, flash) {
    if (shade >= 16) return;
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0, b: 0, c: 0 };
    const sx = t.a || 1, sy = t.d || 1;
    const dx = Math.round((x - spr.ax * zoom) * sx + t.e), dy = Math.round((y - spr.ay * zoom) * sy + t.f);
    const dw = Math.round(spr.w * zoom * sx), dh = Math.round(spr.h * zoom * sy);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(spr.c, dx, dy, dw, dh);
    if (shade > 0) {
      ctx.globalAlpha = SHADE_ALPHA[Math.min(15, shade | 0)];
      ctx.drawImage(silhouette(spr, false), dx, dy, dw, dh);
    }
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash) * 0.75;
      ctx.drawImage(silhouette(spr, true), dx, dy, dw, dh);
    }
    ctx.restore();
  }
  // atalho: escolhe a escala pelo zoom × DPR do contexto e desenha
  function draw(ctx, key, dir, pose, frame, x, y, zoom, opts, shade, flash) {
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1 };
    const spr = get(key, dir, pose, frame, zoom * (t.a || 1), opts);
    blit(ctx, spr, x, y, zoom, shade || 0, flash || 0);
    return spr;
  }

  // sombra elíptica no chão; (x, y) = centro do losango do tile base, size 1 ou 2 (pegada)
  function drawShadow(ctx, x, y, size, zoom) {
    const big = size > 1, r = (big ? 27 : 13) * zoom;
    const cy = y + (big ? 16 * zoom : 0);
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(1, 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.26)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // anel de seleção isométrico aos pés (cor 0xRRGGBB ou string CSS)
  function selectionRing(ctx, x, y, zoom, colour, size) {
    const big = size > 1, rx = (big ? 34 : 17) * zoom, ry = rx / 2;
    const cy = y + (big ? 16 * zoom : 0);
    const col = typeof colour === 'number' ? css(colour) : colour || css(0xffc23a);
    ctx.save();
    ctx.lineWidth = Math.max(1, 3 * zoom);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, cy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.5 * zoom);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, cy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    // marcas nos quatro cantos do losango
    ctx.lineWidth = Math.max(1, 2 * zoom);
    ctx.beginPath();
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + ux * rx * 0.86, cy + uy * ry * 0.86);
      ctx.lineTo(x + ux * rx * 1.14, cy + uy * ry * 1.14);
    }
    ctx.stroke();
    ctx.restore();
  }

  function clearCache() {
    cache.clear();
    pixels = 0;
  }

  OV.UnitSprites = {
    KEYS, POSES, FRAMES, ARMOURS: Object.keys(ARMOUR), WEAPONS, GUNS, SHADE_ALPHA,
    get, blit, draw, drawShadow, selectionRing, clearCache, model, project, silhouette,
    sizeOf: (key) => (SIZE2[key] ? 2 : 1),
    stats: () => ({ entries: cache.size, pixels, budget }),
    setBudget: (px) => { budget = Math.max(1e4, +px || 24e6); },
    setCanvasFactory: (fn) => { makeCanvas = fn; clearCache(); },
  };
})(globalThis.OV || (globalThis.OV = {}));
