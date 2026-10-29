/* Gerador de mapas de batalha (DESIGN.md §7.3; semântica dos comandos no cabeçalho de js/data/blocks_farm.js;
   implementação de referência: simulate() em tools/tests/data_terrain_blocks.test.js).

   OV.MapGen.generate(spec, rng) → {map, nodes:[{x,y,z,rank,prio,inside}], xcomStarts:[i], craftTiles:[i],
     ufo:{x,y,w,h,blockId,rot}|null, craft:{x,y,w,h,blockId,rot}|null, objectiveTiles:[i],
     specials:{POWER_SOURCE,NAVIGATION,DEVICE,OBJECTIVE,START,CRAFT:[i]}, layout:[{blockId,x,y,rot,kind}],
     explosions:[{i,part,power,radius,dmg,voxel,cause}], breaches:[i], footprint:Uint8Array(n) (1 nave, 2 OVNI),
     reach:Uint8Array(n) (1 = alcançável a partir dos inícios X-COM), terrain, size:[w,h,d], attempts, validated}
   spec = {deploymentId, terrain, ufoType|null, crashed, craftType, size:'small'|'medium'|'large' | w,h,d, shade, seed}
   rng  = stream 'map' (OV.RNG); sem rng usa OV.RNG.create(spec.seed).
   Validação: a partir dos inícios X-COM chega-se a todos os nós; até 5 variantes (o mesmo rng continua).
   OV.MapGen.flood(map, starts) → Uint8Array(n) de tiles alcançáveis a pé (portas abrem, elevadores, escadas,
   quedas). OV.MapGen.resolveSize(spec) → [w,h,d]. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const BM = () => OV.BMap;
  const D = () => OV.Data;
  const MAX_VARIANTS = 5;
  const SCOUTS_PER_CELL = 2;
  const SCOUT_PRIO = 2;

  // ---- tamanho ----------------------------------------------------------------------------------------
  function resolveSize(spec) {
    const Data = D();
    const s = Data.mapScripts[spec.terrain];
    if (!s) throw new Error('MapGen: terreno desconhecido ' + spec.terrain);
    if (spec.w && spec.h) return [spec.w, spec.h, spec.d || 3];
    const list = s.sizes;
    if (spec.size && list[spec.size]) return list[spec.size].slice();
    const want = [];
    const ufo = spec.ufoType && Data.ufos[spec.ufoType];
    if (ufo && ufo.map) want.push([ufo.map.w, ufo.map.h, ufo.map.d]);
    const dep = spec.deploymentId && Data.deployments[spec.deploymentId];
    if (dep && dep.map) want.push([dep.map.w, dep.map.h, dep.map.d]);
    const keys = Object.keys(list);
    for (const wz of want) for (const k of keys) if (list[k].join() === wz.join()) return list[k].slice();
    if (want.length) return want[0];
    return (list.medium || list[keys[0]]).slice();
  }

  // ---- interpretador dos comandos (ocupação de células 10×10) -----------------------------------------
  function runScript(s, size, spec, rng) {
    const Data = D();
    const [W, H] = size;
    const CW = W / 10, CH = H / 10;
    const cell = new Array(CW * CH).fill(-1);
    const P = [];
    const anchors = [];
    const uses = {};
    const inside = (x, y, fw, fh) => x >= 0 && y >= 0 && x + fw <= CW && y + fh <= CH;
    const free = (x, y, fw, fh) => {
      if (!inside(x, y, fw, fh)) return false;
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) if (cell[yy * CW + xx] >= 0) return false;
      return true;
    };
    const sep = (a, b) => Math.max(Math.max(0, b.x - (a.x + a.fw), a.x - (b.x + b.fw)), Math.max(0, b.y - (a.y + a.fh), a.y - (b.y + b.fh)));
    const minSep = (r) => anchors.reduce((m, a) => Math.min(m, sep(r, a)), Infinity);
    const put = (id, x, y, fw, fh, rot, kind, anchor) => {
      const p = { id, x, y, fw, fh, rot, kind, removed: false };
      const k = P.push(p) - 1;
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) cell[yy * CW + xx] = k;
      uses[id] = (uses[id] || 0) + 1;
      if (anchor) anchors.push(p);
      return p;
    };
    const remove = (k) => {
      const p = P[k];
      for (let yy = p.y; yy < p.y + p.fh; yy++) for (let xx = p.x; xx < p.x + p.fw; xx++) cell[yy * CW + xx] = -1;
      p.removed = true;
      uses[p.id]--;
    };
    const positions = (fw, fh) => {
      const out = [];
      for (let y = 0; y + fh <= CH; y++) for (let x = 0; x + fw <= CW; x++) if (free(x, y, fw, fh)) out.push({ x, y, fw, fh });
      return out;
    };
    const exhausted = (c, id) => c.maxUses[id] > 0 && (uses[id] || 0) >= c.maxUses[id];
    const filterAt = (pos, how) => {
      const edge = (p) => p.x === 0 || p.y === 0 || p.x + p.fw === CW || p.y + p.fh === CH;
      if (how === 'edge') return pos.filter(edge);
      if (how === 'inner') { const r = pos.filter((p) => !edge(p)); return r.length ? r : pos; }
      if (how === 'centre') {
        const dist = (p) => (2 * p.x + p.fw - CW) * (2 * p.x + p.fw - CW) + (2 * p.y + p.fh - CH) * (2 * p.y + p.fh - CH);
        let m = Infinity;
        for (const p of pos) m = Math.min(m, dist(p));
        return pos.filter((p) => dist(p) === m);
      }
      if (how === 'far' && anchors.length) {
        let m = -1;
        for (const p of pos) m = Math.max(m, minSep(p));
        return pos.filter((p) => minSep(p) === m);
      }
      return pos;
    };

    for (const c of s.commands) {
      if (c.type === 'addCraft') {
        const craft = spec.craftType && Data.crafts[spec.craftType];
        const cid = craft && craft.block;
        if (!cid) continue;
        const b = Data.blocks[cid];
        const lw = b.w / 10, lh = b.h / 10;
        const cands = [];
        for (const x of [...new Set([0, CW - lw])]) for (let y = 0; y + lh <= CH; y++) cands.push({ x, y, fw: lw, fh: lh, vert: true });
        for (const y of [...new Set([0, CH - lw])]) for (let x = 0; x + lh <= CW; x++) cands.push({ x, y, fw: lh, fh: lw, vert: false });
        const cellsOf = (p) => {
          const o = [];
          for (let yy = p.y; yy < p.y + p.fh; yy++) for (let xx = p.x; xx < p.x + p.fw; xx++) o.push(cell[yy * CW + xx]);
          return o;
        };
        const straight = (k) => {
          if (k < 0) return false;
          const tags = Data.blocks[P[k].id].tags || [];
          return tags.includes('road') && tags.includes('straight') && !tags.includes('junction');
        };
        let pick = null;
        if (c.prefer === 'road') {
          const r = cands.filter((p) => inside(p.x, p.y, p.fw, p.fh) && minSep(p) >= c.gap
            && cellsOf(p).every((k) => k < 0 || straight(k)) && cellsOf(p).some(straight));
          if (r.length) {
            pick = rng.pick(r);
            for (const k of new Set(cellsOf(pick))) if (k >= 0) remove(k);
          }
        }
        for (let g = c.gap; !pick && g >= 0; g--) {
          const r = cands.filter((p) => free(p.x, p.y, p.fw, p.fh) && minSep(p) >= g);
          if (r.length) pick = rng.pick(r);
        }
        if (!pick) {
          const r = positions(lw, lh).map((p) => Object.assign(p, { vert: true }))
            .concat(positions(lh, lw).map((p) => Object.assign(p, { vert: false })));
          if (!r.length) return null;
          pick = rng.pick(r);
        }
        put(cid, pick.x, pick.y, pick.fw, pick.fh, pick.vert ? rng.pick([0, 2]) : rng.pick([1, 3]), 'craft', true);
      } else if (c.type === 'addUFO') {
        const u = spec.ufoType && Data.ufos[spec.ufoType];
        if (!u) continue;
        const b = Data.blocks[u.block];
        const rot = rng.int(0, 3);
        const fw = (rot & 1 ? b.h : b.w) / 10, fh = (rot & 1 ? b.w : b.h) / 10;
        let pick = null;
        for (let g = c.gap; !pick && g >= 0; g--) {
          const r = positions(fw, fh).filter((p) => minSep(p) >= g);
          if (r.length) pick = rng.pick(r);
        }
        if (!pick) return null;
        put(u.block, pick.x, pick.y, fw, fh, rot, 'ufo', true);
      } else if (c.type === 'addRoads') {
        const ns = rng.pct(c.chance.ns), ew = !ns && rng.pct(c.chance.ew);
        const doNS = ns || (!ns && !ew), doEW = ew || (!ns && !ew);
        const line = (n) => (n >= 3 ? rng.int(1, n - 2) : rng.int(0, n - 1));
        let cx = -1, cy = -1;
        if (doNS) {
          cx = line(CW);
          for (let y = 0; y < CH; y++) if (free(cx, y, 1, 1)) put(c.blocks.ns, cx, y, 1, 1, 0, 'road');
        }
        if (doEW) {
          cy = line(CH);
          for (let x = 0; x < CW; x++) if (free(x, cy, 1, 1)) put(c.blocks.ew, x, cy, 1, 1, 0, 'road');
        }
        if (doNS && doEW) {
          const k = cell[cy * CW + cx];
          if (k < 0 || P[k].id === c.blocks.ns || P[k].id === c.blocks.ew) {
            if (k >= 0) remove(k);
            put(c.blocks.cross, cx, cy, 1, 1, 0, 'road');
          }
        } else if (rng.pct(c.spur)) {
          const own = doNS ? c.blocks.ns : c.blocks.ew;
          const list = [];
          for (let k = 1; k < (doNS ? CH : CW) - 1; k++) {
            const x = doNS ? cx : k, y = doNS ? k : cy;
            const j = cell[y * CW + x];
            if (j >= 0 && P[j].id === own) list.push([x, y, j]);
          }
          if (list.length) {
            const [sx, sy, j0] = rng.pick(list);
            const side = rng.pick(doNS ? ['E', 'W'] : ['N', 'S']);
            const [dx, dy] = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[side];
            let x = sx + dx, y = sy + dy, n = 0;
            while (free(x, y, 1, 1)) {
              put(doNS ? c.blocks.ew : c.blocks.ns, x, y, 1, 1, 0, 'road');
              n++;
              x += dx;
              y += dy;
            }
            if (n) {
              remove(j0);
              put(c.blocks['t' + side], sx, sy, 1, 1, 0, 'road');
            }
          }
        }
      } else if (c.type === 'fill') {
        for (let y = 0; y < CH; y++) {
          for (let x = 0; x < CW; x++) {
            if (cell[y * CW + x] >= 0) continue;
            let cand = {};
            let any = false;
            for (const id in c.weights) if (!exhausted(c, id)) { cand[id] = c.weights[id]; any = true; }
            if (!any) cand = c.weights;
            const id = rng.weighted(cand);
            put(id, x, y, 1, 1, Data.blocks[id].rotate ? rng.int(0, 3) : 0, 'block', false);
          }
        }
      } else if (c.type === 'addBlock') {
        const n = rng.int(c.count[0], c.count[1]);
        for (let k = 0; k < n; k++) {
          const cand = {};
          for (const id in c.weights) if (!exhausted(c, id)) cand[id] = c.weights[id];
          let placed = false;
          while (!placed) {
            const id = rng.weighted(cand);
            if (!id) break;
            const b = Data.blocks[id];
            const rot = b.rotate ? rng.int(0, 3) : 0;
            const fw = (rot & 1 ? b.h : b.w) / 10, fh = (rot & 1 ? b.w : b.h) / 10;
            const pos = filterAt(positions(fw, fh), c.at);
            if (!pos.length) {
              delete cand[id];
              continue;
            }
            const p = rng.pick(pos);
            put(id, p.x, p.y, fw, fh, rot, 'block', c.anchor);
            placed = true;
          }
          if (!placed) break;
        }
      }
    }
    if (cell.some((k) => k < 0)) return null;
    return P.filter((p) => !p.removed);
  }

  // ---- carimbo ------------------------------------------------------------------------------------------
  function stamp(s, size, placed) {
    const Data = D();
    const [W, H, DZ] = size;
    const map = BM().create(W, H, DZ);
    map.ceiling = !!s.ceiling;
    const ground = Data.tilesets[s.tileset].ids.ground;
    const footprint = new Uint8Array(map.n);
    const nodes = [];
    const layout = [];
    const terrainCells = [];
    let ufo = null, craft = null;
    let craftRot = 0;
    for (const p of placed) {
      const special = p.kind === 'craft' || p.kind === 'ufo';
      let c = Data.getCompiled(p.id, special ? undefined : s.tileset);
      if (p.rot) c = Data.rotateCompiled(c, p.rot);
      const ox = p.x * 10, oy = p.y * 10;
      const cplane = c.w * c.h;
      const to = (si) => {
        const z = (si / cplane) | 0, r = si - z * cplane, y = (r / c.w) | 0, x = r - y * c.w;
        return (z * H + oy + y) * W + ox + x;
      };
      const mark = p.kind === 'craft' ? 1 : p.kind === 'ufo' ? 2 : 0;
      if (special) {
        for (let y = 0; y < c.h; y++) {
          for (let x = 0; x < c.w; x++) {
            const i = (oy + y) * W + ox + x;
            map.parts[i * 4] = ground;
            for (let z = 0; z < DZ; z++) footprint[i + z * W * H] = mark;
          }
        }
      }
      const lim = cplane * Math.min(c.d, DZ);
      for (let si = 0; si < lim; si++) {
        if (special && !c.mask[si]) continue;
        map.parts.set(c.parts.subarray(si * 4, si * 4 + 4), to(si) * 4);
      }
      for (const nd of c.nodes) {
        if (nd.z >= DZ) continue;
        nodes.push({ x: ox + nd.x, y: oy + nd.y, z: nd.z, rank: nd.rank, prio: nd.prio, inside: p.kind === 'ufo' });
      }
      const rec = { blockId: p.id, x: ox, y: oy, w: c.w, h: c.h, rot: p.rot, kind: p.kind };
      layout.push(rec);
      if (p.kind === 'ufo') ufo = { x: ox, y: oy, w: c.w, h: c.h, blockId: p.id, rot: p.rot };
      if (p.kind === 'craft') {
        craft = { x: ox, y: oy, w: c.w, h: c.h, blockId: p.id, rot: p.rot };
        craftRot = p.rot;
      }
      if (!special) for (let cy = 0; cy < c.h / 10; cy++) for (let cx = 0; cx < c.w / 10; cx++) terrainCells.push([ox + cx * 10, oy + cy * 10]);
    }
    return { map, footprint, nodes, layout, terrainCells, ufo, craft, craftRot };
  }

  // varrimento dos especiais (inícios, recolha, componentes, objetivos)
  function scanSpecials(map) {
    const defs = D().tileDefs;
    const out = { POWER_SOURCE: [], NAVIGATION: [], DEVICE: [], OBJECTIVE: [], START: [], CRAFT: [] };
    for (let i = 0; i < map.n; i++) {
      for (let p = 0; p < 4; p++) {
        const v = map.parts[i * 4 + p];
        if (!v) continue;
        const sp = defs[v].special;
        if (sp && out[sp] && out[sp][out[sp].length - 1] !== i) out[sp].push(i);
      }
    }
    return out;
  }

  // ---- alcance a pé (portas abertas, elevadores, escadas, quedas) -----------------------------------------
  function flood(map, starts) {
    const B = BM();
    const seen = new Uint8Array(map.n);
    const q = [];
    const ok = (i) => {
      if (!B.hasFloor(map, i)) return false;
      const o = B.def(map, i, 3);
      if (!o) return true;
      if (o.door === 'ufo') return true;
      return o.tu < B.BLOCKED && !o.fullBlock;
    };
    const push = (i) => {
      if (i < 0 || seen[i]) return;
      const j = B.hasFloor(map, i) ? i : B.dropTarget(map, i);
      if (seen[j] || !ok(j)) return;
      seen[j] = 1;
      q.push(j);
    };
    for (const s of starts) push(s);
    while (q.length) {
      const i = q.pop();
      const [x, y, z] = B.xyz(map, i);
      for (const dir of [0, 2, 4, 6]) {
        const e = B.edgeInfo(map, x, y, z, dir);
        if (e.to < 0 || (e.blocked.move && !e.door)) continue;
        if (seen[e.to]) continue;
        // sem chão no destino: a unidade cai (o tile de queda tem de ser transponível)
        if (B.hasFloor(map, e.to)) {
          if (ok(e.to)) { seen[e.to] = 1; q.push(e.to); }
        } else push(e.to);
      }
      for (const up of [true, false]) {
        const v = B.verticalLink(map, i, up);
        if (v) push(v.to);
      }
    }
    return seen;
  }

  // ---- danos de queda (OVNI despenhado) ----------------------------------------------------------------
  function crashDamage(map, footprint, specials, rng) {
    const Data = D();
    const B = BM();
    const defs = Data.tileDefs;
    const rules = Data.ufoRules;
    const explosions = [];
    for (const i of specials.POWER_SOURCE) {
      const o = B.def(map, i, 3);
      if (!o || !o.explosive) continue;
      if (!rng.pct(rules.powerSourceExplodePct)) continue;
      const [x, y, z] = B.xyz(map, i);
      const ex = o.explosive;
      explosions.push({
        i, part: 3, power: rng.int(ex.power[0], ex.power[1]), radius: ex.radius, dmg: ex.type,
        voxel: [x * 16 + 8, y * 16 + 8, z * 24 + U.idiv(o.height || 12, 2)], cause: 'powerSource',
      });
    }
    // brechas no casco: segmentos de casco entre dois tiles transitáveis em lados opostos
    const rubble = Data.tilesets.UFO.ids.rubbleObject;
    const hullRoles = { hull: 1, hullDiag2: 1, hullDiag3: 1 };
    const cands = [];
    for (let i = 0; i < map.n; i++) {
      if (footprint[i] !== 2) continue;
      const o = B.def(map, i, 3);
      if (!o || !hullRoles[o.role] || !B.hasFloor(map, i)) continue;
      const st = (dir) => {
        const j = B.neighbour(map, i, dir);
        return j >= 0 && B.canStand(map, j);
      };
      if ((st(0) && st(4)) || (st(2) && st(6))) cands.push(i);
    }
    const breaches = [];
    const want = Math.min(cands.length, rng.int(rules.crashHullBreaches[0], rules.crashHullBreaches[1]));
    rng.shuffle(cands);
    for (let k = 0; k < want; k++) {
      map.parts[cands[k] * 4 + 3] = defs[rubble] ? rubble : 0;
      breaches.push(cands[k]);
    }
    breaches.sort((a, b) => a - b);
    return { explosions, breaches };
  }

  // 2 nós de batedor (patente 0) por célula 10×10 de terreno, em chão ground/road de z0 alcançável
  function scoutNodes(map, cells, footprint, reach, nodes, rng) {
    const B = BM();
    const taken = new Set(nodes.map((n) => B.idx(map, n.x, n.y, n.z)));
    const out = [];
    for (const [cx, cy] of cells) {
      const cand = [];
      for (let y = cy; y < cy + 10; y++) {
        for (let x = cx; x < cx + 10; x++) {
          const i = B.idx(map, x, y, 0);
          if (footprint[i] || !reach[i] || taken.has(i) || !B.canStand(map, i)) continue;
          const f = B.def(map, i, 0);
          const o = B.def(map, i, 3);
          if (!f || (f.role !== 'ground' && f.role !== 'road') || (o && o.door)) continue;
          cand.push(i);
        }
      }
      for (let k = 0; k < SCOUTS_PER_CELL && cand.length; k++) {
        const j = rng.int(0, cand.length - 1);
        const i = cand[j];
        cand[j] = cand[cand.length - 1];
        cand.pop();
        taken.add(i);
        const [x, y, z] = B.xyz(map, i);
        out.push({ x, y, z, rank: 0, prio: SCOUT_PRIO, inside: false, scout: true });
      }
    }
    return out;
  }

  // ---- gerador --------------------------------------------------------------------------------------------
  function generate(spec, rng) {
    const Data = D();
    const B = BM();
    const s = Data.mapScripts[spec.terrain];
    if (!s) throw new Error('MapGen: terreno desconhecido ' + spec.terrain);
    rng = rng || OV.RNG.create((spec.seed | 0) >>> 0);
    const size = resolveSize(spec);
    let best = null;
    let attempts = 0;
    for (let v = 0; v < MAX_VARIANTS; v++) {
      attempts++;
      const placed = runScript(s, size, spec, rng);
      if (!placed) continue;
      const st = stamp(s, size, placed);
      const map = st.map;
      let specials = scanSpecials(map);
      let explosions = [], breaches = [];
      if (spec.crashed && st.ufo) {
        const cd = crashDamage(map, st.footprint, specials, rng);
        explosions = cd.explosions;
        breaches = cd.breaches;
        specials = scanSpecials(map);
      }
      const xcomStarts = specials.START.slice();
      const craftTiles = specials.START.concat(specials.CRAFT).sort((a, b) => a - b);
      if (!xcomStarts.length) continue;
      const reach = flood(map, xcomStarts);
      const nodes = st.nodes.concat(scoutNodes(map, st.terrainCells, st.footprint, reach, st.nodes, rng));
      const lost = nodes.filter((n) => !reach[B.idx(map, n.x, n.y, n.z)]);
      const res = {
        map, nodes, xcomStarts, craftTiles, ufo: st.ufo, craft: st.craft, craftRot: st.craftRot,
        objectiveTiles: specials.OBJECTIVE.slice(), specials, layout: st.layout, explosions, breaches,
        footprint: st.footprint, reach, terrain: spec.terrain, tileset: s.tileset, size, attempts, validated: lost.length === 0,
      };
      if (!lost.length) return res;
      if (!best || lost.length < best.lostCount) {
        res.lostCount = lost.length;
        best = res;
      }
    }
    if (!best) throw new Error('MapGen: sem espaço para a nave/OVNI em ' + spec.terrain + ' ' + size.join('×'));
    // último recurso: descarta os nós inacessíveis (nunca bloqueia a missão)
    best.nodes = best.nodes.filter((n) => best.reach[B.idx(best.map, n.x, n.y, n.z)]);
    best.attempts = attempts;
    delete best.lostCount;
    return best;
  }

  OV.MapGen = { generate, flood, resolveSize, runScript, MAX_VARIANTS };
})(globalThis.OV || (globalThis.OV = {}));
