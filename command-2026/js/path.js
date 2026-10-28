/* A* em grelha (8 direções, heap binária, arrays tipados com carimbos de geração) + suavização por linha de vista */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const SQ2 = Math.SQRT2;

  class Pathfinder {
    constructor(map) {
      this.map = map;
      const n = map.n;
      this.g = new Float32Array(n);
      this.f = new Float32Array(n);
      this.par = new Int32Array(n);
      this.seen = new Uint32Array(n);
      this.closed = new Uint32Array(n);
      this.heap = new Int32Array(n * 2);
      this.hpos = new Int32Array(n);
      this.size = 0;
      this.gen = 0;
      this.queue = [];
      this.maxIter = Math.min(n, 14000);
      this.stats = { searches: 0, iters: 0 };
    }

    _push(i) {
      const h = this.heap, f = this.f;
      let k = this.size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[h[p]] <= f[i]) break;
        h[k] = h[p];
        this.hpos[h[k]] = k;
        k = p;
      }
      h[k] = i;
      this.hpos[i] = k;
    }
    _up(i) {
      const h = this.heap, f = this.f;
      let k = this.hpos[i];
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[h[p]] <= f[i]) break;
        h[k] = h[p];
        this.hpos[h[k]] = k;
        k = p;
      }
      h[k] = i;
      this.hpos[i] = k;
    }
    _pop() {
      const h = this.heap, f = this.f;
      const top = h[0];
      const last = h[--this.size];
      let k = 0;
      const n = this.size;
      while (true) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && f[h[c + 1]] < f[h[c]]) c++;
        if (f[h[c]] >= f[last]) break;
        h[k] = h[c];
        this.hpos[h[k]] = k;
        k = c;
      }
      if (n > 0) {
        h[k] = last;
        this.hpos[last] = k;
      }
      return top;
    }

    // devolve índices de tiles do início (exclusive) ao destino; se inalcançável, até ao nó mais próximo
    find(sx, sy, tx, ty) {
      const m = this.map, W = m.w, block = m.block;
      if (!m.inBounds(sx, sy) || !m.inBounds(tx, ty)) return null;
      const start = sy * W + sx, goal = ty * W + tx;
      if (start === goal) return [];
      const gen = ++this.gen;
      if (gen === 0xffffffff) {
        this.seen.fill(0);
        this.closed.fill(0);
        this.gen = 1;
      }
      const g = this.g, f = this.f, par = this.par, seen = this.seen, closed = this.closed;
      const hfn = (i) => {
        const dx = Math.abs((i % W) - tx), dy = Math.abs(((i / W) | 0) - ty);
        return dx + dy + (SQ2 - 2) * Math.min(dx, dy);
      };
      this.size = 0;
      g[start] = 0;
      f[start] = hfn(start);
      par[start] = -1;
      seen[start] = gen;
      this._push(start);
      let best = start, bestH = f[start];
      let iter = 0;
      let found = false;
      while (this.size > 0 && iter < this.maxIter) {
        iter++;
        const cur = this._pop();
        if (cur === goal) { found = true; break; }
        closed[cur] = gen;
        const cx = cur % W, cy = (cur / W) | 0;
        const hc = f[cur] - g[cur];
        if (hc < bestH) { bestH = hc; best = cur; }
        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= m.h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= W) continue;
            const ni = ny * W + nx;
            if (block[ni] !== 0) continue;
            if (dx !== 0 && dy !== 0) {
              // sem cortar cantos
              if (block[cy * W + nx] !== 0 || block[ny * W + cx] !== 0) continue;
            }
            if (closed[ni] === gen) continue;
            const ng = g[cur] + (dx !== 0 && dy !== 0 ? SQ2 : 1);
            if (seen[ni] !== gen) {
              seen[ni] = gen;
              g[ni] = ng;
              f[ni] = ng + hfn(ni);
              par[ni] = cur;
              this._push(ni);
            } else if (ng < g[ni] - 1e-6) {
              g[ni] = ng;
              f[ni] = ng + hfn(ni);
              par[ni] = cur;
              this._up(ni);
            }
          }
        }
      }
      this.stats.searches++;
      this.stats.iters += iter;
      let end = found ? goal : best;
      const out = [];
      while (end !== start && end >= 0) {
        out.push(end);
        end = par[end];
      }
      out.reverse();
      return out;
    }

    request(u, x, y) {
      if (!u.pathReq) this.queue.push(u);
      u.pathReq = { x, y };
      u.pathPending = true;
    }

    process(budget) {
      let n = 0;
      while (this.queue.length && n < budget) {
        const u = this.queue.shift();
        if (!u.alive || !u.pathReq) {
          if (u) { u.pathReq = null; u.pathPending = false; }
          continue;
        }
        const r = u.pathReq;
        u.pathReq = null;
        u.pathPending = false;
        u.path = this.computeWaypoints(u.x, u.y, r.x, r.y, Math.min(u.def.radius, 10));
        u.pathIdx = 0;
        u.stuckT = 0;
        n++;
      }
    }

    computeWaypoints(x, y, gx, gy, rad) {
      const m = this.map;
      const sx = CG.clamp(Math.floor(x / T), 0, m.w - 1), sy = CG.clamp(Math.floor(y / T), 0, m.h - 1);
      let tx = CG.clamp(Math.floor(gx / T), 0, m.w - 1), ty = CG.clamp(Math.floor(gy / T), 0, m.h - 1);
      let exact = true;
      if (!m.passable(tx, ty)) {
        const nf = m.nearestFree(tx, ty, 8);
        if (!nf) return [];
        tx = nf.x;
        ty = nf.y;
        exact = false;
      }
      const tiles = this.find(sx, sy, tx, ty);
      if (!tiles) return [];
      const pts = tiles.map((i) => ({ x: (i % m.w) * T + T / 2, y: ((i / m.w) | 0) * T + T / 2 }));
      const reached = tiles.length === 0 || tiles[tiles.length - 1] === ty * m.w + tx;
      if (exact && reached) {
        if (pts.length) pts[pts.length - 1] = { x: gx, y: gy };
        else pts.push({ x: gx, y: gy });
      }
      // suavização: salta para o waypoint mais distante com linha de vista
      const out = [];
      let ax = x, ay = y, k = 0;
      while (k < pts.length) {
        let j = Math.min(k + 14, pts.length - 1);
        while (j > k && !CG.lineClear(m, ax, ay, pts[j].x, pts[j].y, rad)) j--;
        out.push(pts[j]);
        ax = pts[j].x;
        ay = pts[j].y;
        k = j + 1;
      }
      return out;
    }
  }
  CG.Pathfinder = Pathfinder;

  // linha livre de obstáculos com "espessura" rad (amostragem a cada 8 px)
  CG.lineClear = function (m, x0, y0, x1, y1, rad) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) return true;
    const nx = (-dy / len) * rad, ny = (dx / len) * rad;
    const steps = Math.ceil(len / 8);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t, py = y0 + dy * t;
      if (!m.passable(Math.floor(px / T), Math.floor(py / T))) {
        if (i === 0) continue; // o próprio ponto de partida pode estar num tile ocupado
        return false;
      }
      if (rad > 0 && i > 0 && i < steps) {
        if (!m.passable(Math.floor((px + nx) / T), Math.floor((py + ny) / T))) return false;
        if (!m.passable(Math.floor((px - nx) / T), Math.floor((py - ny) / T))) return false;
      }
    }
    return true;
  };
})();
