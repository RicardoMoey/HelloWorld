/* Mapa procedimental simétrico (rotação de 90°): terreno, terras raras, poços de petróleo */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;

  CG.TERRAIN = { GROUND: 0, WATER: 1, ROCK: 2, FOREST: 3 };

  CG.THEMES = {
    desert: {
      name: 'Deserto', ground: [189, 163, 116], ground2: [166, 138, 92], shore: [214, 196, 150], water: [52, 118, 134], deep: [22, 66, 92],
      rock: [126, 104, 82], rockLight: [176, 152, 120], rockDark: [74, 58, 46], tree: ['#6f7d3c', '#5c6c30', '#7b8a44'], treeDark: '#38451c',
      names: ['Bacia do Lítio', 'Corredor de Cobalto', 'Planalto das Terras Raras', 'Deserto do Oleoduto'],
    },
    steppe: {
      name: 'Estepe', ground: [118, 128, 76], ground2: [96, 108, 60], shore: [160, 156, 112], water: [44, 102, 126], deep: [20, 58, 86],
      rock: [108, 104, 92], rockLight: [160, 156, 142], rockDark: [62, 60, 54], tree: ['#3d5a2a', '#2f4a22', '#4b6a32'], treeDark: '#1d2e14',
      names: ['Estepe do Gasoduto', 'Vale do Corredor Norte', 'Planície da Rede Elétrica', 'Fronteira das Terras Negras'],
    },
    tundra: {
      name: 'Tundra', ground: [214, 220, 222], ground2: [186, 196, 200], shore: [168, 186, 194], water: [52, 96, 126], deep: [24, 52, 84],
      rock: [104, 110, 118], rockLight: [158, 166, 176], rockDark: [58, 62, 70], tree: ['#2f4d3e', '#264236', '#3a5a48'], treeDark: '#16261e',
      names: ['Passagem do Ártico', 'Rota do Gelo', 'Plataforma Polar', 'Estreito das Sondas'],
    },
  };

  class GameMap {
    constructor(opts) {
      this.size = opts.size;
      this.w = this.h = opts.size;
      this.n = this.w * this.h;
      this.seed = opts.seed >>> 0;
      this.pxW = this.w * T;
      this.pxH = this.h * T;
      const rng = CG.RNG(this.seed ^ 0x9e3779b9);
      const themeIds = Object.keys(CG.THEMES);
      this.themeId = opts.theme && CG.THEMES[opts.theme] ? opts.theme : themeIds[rng.int(themeIds.length)];
      this.theme = CG.THEMES[this.themeId];
      this.name = rng.pick(this.theme.names);

      this.terrain = new Uint8Array(this.n);
      this.block = new Uint8Array(this.n); // 0 livre, 1 terreno, 2 edifício
      this.bld = new Int32Array(this.n); // id do edifício que ocupa o tile
      this.reserve = new Uint8Array(this.n); // tiles de acesso das refinarias
      this.res = new Float32Array(this.n);
      this.resMax = new Float32Array(this.n);
      this.shade = new Float32Array(this.n);
      this.depth = new Uint8Array(this.n);
      this.fields = [];
      this.derricks = [];
      this.generate(rng);
    }

    idx(tx, ty) { return ty * this.w + tx; }
    inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
    tileOf(px) { return Math.floor(px / T); }
    passable(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h && this.block[ty * this.w + tx] === 0; }
    terrainOk(tx, ty) { return this.inBounds(tx, ty) && this.terrain[ty * this.w + tx] === 0; }

    // aplica fn às 4 posições simétricas (rotação de 90° em torno do centro)
    sym(x, y, fn) {
      const W = this.w;
      let px = x, py = y;
      for (let k = 0; k < 4; k++) {
        fn(px, py, k);
        const nx = W - 1 - py, ny = px;
        px = nx; py = ny;
      }
    }

    generate(rng) {
      const W = this.w, H = this.h, G = CG.TERRAIN;
      const nE = CG.valueNoise(this.seed * 7 + 11);
      const nM = CG.valueNoise(this.seed * 13 + 3);
      const nS = CG.valueNoise(this.seed * 3 + 29);
      const symAvg = (x, y, f) => {
        let s = 0;
        this.sym(x, y, (px, py) => { s += f(px, py); });
        return CG.clamp((s / 4 - 0.5) * 2 + 0.5, 0, 1);
      };
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const e = symAvg(x, y, (px, py) => CG.fbm(nE, px / 10, py / 10, 4));
          const m = symAvg(x, y, (px, py) => CG.fbm(nM, px / 6 + 40, py / 6 + 40, 3));
          let t = G.GROUND;
          if (e < 0.3) t = G.WATER;
          else if (e > 0.71) t = G.ROCK;
          else if (m > 0.66) t = G.FOREST;
          const i = y * W + x;
          this.terrain[i] = t;
          this.shade[i] = CG.fbm(nS, x / 5, y / 5, 3);
        }
      }
      // bordas do mapa: rocha nas extremidades dá moldura natural
      for (let i = 0; i < W; i++) {
        this.terrain[i] = this.terrain[(H - 1) * W + i] = G.ROCK;
        this.terrain[i * W] = this.terrain[i * W + W - 1] = G.ROCK;
      }

      const s = Math.max(8, Math.round(W * 0.12));
      const starts = [];
      this.sym(s, s, (px, py) => starts.push({ x: px, y: py }));
      // ordem: TL, TR, BR, BL — para 2 jogadores usamos cantos opostos
      this.allStarts = starts;

      const setDisk = (cx, cy, r, t) => {
        this.sym(cx, cy, (px, py) => {
          const R = Math.ceil(r);
          for (let dy = -R; dy <= R; dy++)
            for (let dx = -R; dx <= R; dx++) {
              if (dx * dx + dy * dy > r * r) continue;
              const x = px + dx, y = py + dy;
              if (x > 0 && y > 0 && x < W - 1 && y < H - 1) this.terrain[y * W + x] = t;
            }
        });
      };
      const carve = (ax, ay, bx, by, r) => {
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.ceil(len * 2);
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        const wob = rng.range(2, 4);
        const ph = rng.range(0, 6);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const off = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 2 + ph) * wob;
          setDisk(Math.round(ax + (bx - ax) * t + nx * off), Math.round(ay + (by - ay) * t + ny * off), r, G.GROUND);
        }
      };
      const c = W / 2 - 0.5;
      carve(s, s, c, c, 1.7);
      carve(s, s, W / 2, s, 1.5);
      setDisk(Math.floor(W / 2) - 1, Math.floor(H / 2) - 1, 3.2, G.GROUND);
      setDisk(s, s, 7.5, G.GROUND);

      // campos de terras raras (coordenadas canónicas no quadrante superior esquerdo)
      const fieldSpecs = [
        { x: s + 8, y: s + 1, r: 2.7, amt: 900 },
        { x: s + 1, y: s + 8, r: 2.4, amt: 800 },
        { x: Math.floor(W / 2) - 6, y: Math.floor(H / 2) - 6, r: 3.0, amt: 1500 },
        { x: Math.floor(W / 2) - 4, y: Math.max(4, s - 3), r: 2.4, amt: 1100 },
      ];
      for (const f of fieldSpecs) {
        setDisk(f.x, f.y, f.r + 1.2, G.GROUND);
        this.sym(f.x, f.y, (px, py) => {
          const field = { x: px, y: py, r: f.r, tiles: [], rich: f.amt > 1000 };
          const R = Math.ceil(f.r);
          for (let dy = -R; dy <= R; dy++)
            for (let dx = -R; dx <= R; dx++) {
              const d = Math.hypot(dx, dy);
              if (d > f.r + CG.hash2(px + dx, py + dy, this.seed) * 0.8 - 0.4) continue;
              const x = px + dx, y = py + dy;
              if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
              const i = y * W + x;
              const amt = f.amt * (1 - (d / (f.r + 1)) * 0.5);
              this.res[i] = this.resMax[i] = Math.round(amt);
              field.tiles.push(i);
            }
          this.fields.push(field);
        });
      }

      // poços de petróleo neutros
      const dspec = { x: s + 3, y: Math.floor(H / 2) - 3 };
      setDisk(dspec.x, dspec.y, 1.6, G.GROUND);
      this.sym(dspec.x, dspec.y, (px, py) => {
        const i = py * W + px;
        this.res[i] = this.resMax[i] = 0;
        this.derricks.push({ x: px, y: py });
      });

      // conectividade: tudo o que não é alcançável a partir do 1.º início vira rocha
      const reach = new Uint8Array(this.n);
      const q = [starts[0].y * W + starts[0].x];
      reach[q[0]] = 1;
      while (q.length) {
        const i = q.pop();
        const x = i % W, y = (i / W) | 0;
        const nb = [i - 1, i + 1, i - W, i + W];
        for (let k = 0; k < 4; k++) {
          const j = nb[k];
          if (k === 0 && x === 0) continue;
          if (k === 1 && x === W - 1) continue;
          if (k === 2 && y === 0) continue;
          if (k === 3 && y === H - 1) continue;
          if (!reach[j] && this.terrain[j] === G.GROUND) {
            reach[j] = 1;
            q.push(j);
          }
        }
      }
      for (let i = 0; i < this.n; i++) {
        if (this.terrain[i] === G.GROUND && !reach[i]) {
          this.terrain[i] = G.ROCK;
          this.res[i] = this.resMax[i] = 0;
        }
      }
      for (const f of this.fields) f.tiles = f.tiles.filter((i) => this.resMax[i] > 0);
      this.fields = this.fields.filter((f) => f.tiles.length > 3);
      this.derricks = this.derricks.filter((d) => reach[d.y * W + d.x]);

      // profundidade da água (para sombreado)
      const dq = [];
      for (let i = 0; i < this.n; i++) {
        if (this.terrain[i] === G.WATER) this.depth[i] = 255;
        else { this.depth[i] = 0; dq.push(i); }
      }
      let head = 0;
      while (head < dq.length) {
        const i = dq[head++];
        const x = i % W, y = (i / W) | 0, d = this.depth[i];
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nb) {
          if (j >= 0 && this.depth[j] > d + 1) {
            this.depth[j] = d + 1;
            dq.push(j);
          }
        }
      }

      for (let i = 0; i < this.n; i++) this.block[i] = this.terrain[i] === G.GROUND ? 0 : 1;
    }

    startsFor(count) {
      const s = this.allStarts;
      if (count <= 2) return [s[0], s[2]];
      if (count === 3) return [s[0], s[2], s[1]];
      return [s[0], s[2], s[1], s[3]];
    }

    takeRes(i, amount) {
      const a = Math.min(amount, this.res[i]);
      this.res[i] -= a;
      if (this.res[i] < 1) this.res[i] = 0;
      return a;
    }

    // regeneração lenta: os campos nunca se esgotam por completo
    regrow(rng) {
      for (const f of this.fields) {
        for (let k = 0; k < 3; k++) {
          const i = f.tiles[rng.int(f.tiles.length)];
          if (this.block[i] !== 0) continue;
          this.res[i] = Math.min(this.resMax[i], this.res[i] + this.resMax[i] * 0.06);
        }
      }
    }

    // tile livre mais próximo (procura em espiral)
    nearestFree(tx, ty, maxR, pred) {
      const ok = pred || ((x, y) => this.passable(x, y));
      if (ok(tx, ty)) return { x: tx, y: ty };
      for (let r = 1; r <= maxR; r++) {
        let best = null, bd = 1e9;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = tx + dx, y = ty + dy;
            if (!ok(x, y)) continue;
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = { x, y }; }
          }
        if (best) return best;
      }
      return null;
    }
  }
  CG.GameMap = GameMap;
})();
