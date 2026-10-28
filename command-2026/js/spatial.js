/* Partição espacial (grid hashing) — consultas por raio em O(k) para 50+ unidades em ecrã */
'use strict';
(function () {
  const CG = window.CG;

  class SpatialHash {
    constructor(pxW, pxH, cell) {
      this.cell = cell;
      this.cols = Math.ceil(pxW / cell) + 1;
      this.rows = Math.ceil(pxH / cell) + 1;
      this.cells = new Array(this.cols * this.rows);
      for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
      this.stamp = 1;
    }
    clear() {
      const c = this.cells;
      for (let i = 0; i < c.length; i++) c[i].length = 0;
    }
    _ci(x, y) {
      const cx = CG.clamp((x / this.cell) | 0, 0, this.cols - 1);
      const cy = CG.clamp((y / this.cell) | 0, 0, this.rows - 1);
      return cy * this.cols + cx;
    }
    insert(e) {
      this.cells[this._ci(e.x, e.y)].push(e);
    }
    insertRect(e, x0, y0, x1, y1) {
      const c0 = CG.clamp((x0 / this.cell) | 0, 0, this.cols - 1), c1 = CG.clamp((x1 / this.cell) | 0, 0, this.cols - 1);
      const r0 = CG.clamp((y0 / this.cell) | 0, 0, this.rows - 1), r1 = CG.clamp((y1 / this.cell) | 0, 0, this.rows - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(e);
    }
    // devolve entidades cujo ponto (ou retângulo, para edifícios) pode estar a <= r de (x,y)
    query(x, y, r, out) {
      out.length = 0;
      const st = ++this.stamp;
      const c0 = CG.clamp(((x - r) / this.cell) | 0, 0, this.cols - 1), c1 = CG.clamp(((x + r) / this.cell) | 0, 0, this.cols - 1);
      const r0 = CG.clamp(((y - r) / this.cell) | 0, 0, this.rows - 1), r1 = CG.clamp(((y + r) / this.cell) | 0, 0, this.rows - 1);
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          const cell = this.cells[rr * this.cols + cc];
          for (let i = 0; i < cell.length; i++) {
            const e = cell[i];
            if (e._qs === st) continue;
            e._qs = st;
            out.push(e);
          }
        }
      }
      return out;
    }
  }
  CG.SpatialHash = SpatialHash;

  // distância de um ponto à entidade (borda do retângulo para edifícios)
  CG.edgeDist = (e, x, y) => {
    if (e.kind === 'bld') {
      const dx = Math.max(e.x0 - x, 0, x - e.x1);
      const dy = Math.max(e.y0 - y, 0, y - e.y1);
      return Math.hypot(dx, dy);
    }
    return Math.max(0, Math.hypot(e.x - x, e.y - y) - e.def.radius);
  };
})();
