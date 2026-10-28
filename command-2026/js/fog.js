/* Nevoeiro de guerra por jogador (visível / explorado) e deteção de unidades furtivas */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const _n = [];

  const circles = [];
  for (let r = 0; r <= 16; r++) {
    const offs = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.8) offs.push(dx, dy);
    circles.push(offs);
  }

  function stamp(m, vis, exp, cx, cy, r) {
    const offs = circles[CG.clamp(Math.round(r), 0, 16)];
    const W = m.w, H = m.h;
    for (let k = 0; k < offs.length; k += 2) {
      const x = cx + offs[k], y = cy + offs[k + 1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      vis[i] = 1;
      exp[i] = 1;
    }
  }

  CG.updateFog = function (G) {
    const m = G.map;
    for (const p of G.players) p.vis.fill(0);
    for (const e of G.entities) {
      if (!e.alive || e.owner < 0) continue;
      const p = G.players[e.owner];
      const r = e.kind === 'bld' && e.built < 1 ? 3 : e.def.sight;
      stamp(m, p.vis, p.explored, CG.clamp(Math.floor(e.x / T), 0, m.w - 1), CG.clamp(Math.floor(e.y / T), 0, m.h - 1), r);
    }
    for (const rv of G.reveals) {
      const p = G.players[rv.owner];
      stamp(m, p.vis, p.explored, Math.floor(rv.x / T), Math.floor(rv.y / T), rv.r / T);
    }
    // furtivos: revelados por proximidade ou por detetores
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit' || !e.def.stealth) continue;
      let mask = 0;
      G.spatial.query(e.x, e.y, 11 * T, _n);
      for (const o of _n) {
        if (!o.alive || o.owner === e.owner || o.owner < 0) continue;
        const det = o.def.detector ? o.def.sight * T : o.def.radar ? 8 * T : 2.6 * T;
        if (CG.dist2(o.x, o.y, e.x, e.y) <= det * det) mask |= 1 << o.owner;
      }
      e.revealed = mask;
    }
    // edifícios avistados ficam memorizados (fantasmas no nevoeiro)
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'bld') continue;
      for (const p of G.players) {
        if (e.seen & (1 << p.id)) continue;
        if (CG.visibleTo(G, e, p.id)) e.seen |= 1 << p.id;
      }
    }
    G.fogDirty = true;
  };

  CG.revealAll = function (G, pid) {
    const p = G.players[pid];
    p.explored.fill(1);
  };
})();
