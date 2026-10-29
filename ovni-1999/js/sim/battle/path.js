/* Pathfinding da batalha (DESIGN.md §9, §3.3; REA 03 §2.1 — semântica de Pathfinding::getTUCost do OpenXcom).

   OV.Path.stepCost(B, unit, fromI, dir 0..9, opts) → {tu, energy, to, via, dir, kind, door:{i,part}|null,
       opensUfoDoor:i|null, fall, float, occupant:unitId|null, penalty} | null
     to = tile onde a unidade fica (canto noroeste nas 2×2); via = tile em que entra (≠ to só nas quedas).
     kind 'walk'|'fall'|'gravlift'|'stairs'|'fly'. float = fica a voar (voador sobre tile sem chão).
     occupant = unidade não vista que ocupa o destino (não bloqueia o planeamento; o passo descobre-a).
     penalty = custo extra só de pesquisa (fogo para a IA, «sneaky»); nunca é cobrado.
   OV.Path.reachable(B, unit, tuBudget?, energyBudget?, opts) → {cost:Int16Array(n) (−1 inalcançável),
       energy:Int16Array(n), parent:Int32Array(n), dir:Int8Array(n), list:Int32Array (origem incluída, por custo),
       origin, unitId, tuBudget, energyBudget}   Dijkstra; orçamentos por omissão = budget(unit)
   OV.Path.pathTo(reach, toI) → {steps:[dir], tiles:[i] (sem a origem), tus:[UT acumuladas], tu, energy} | null
   OV.Path.find(B, unit, toI, maxTU?, opts) → igual a pathTo | null   A* (linha reta primeiro, no mesmo nível)
   OV.Path.flyRoute(B, fromI, toI, opts?) → [fromI … toI] | null   rota da bomba do Blaster (ignora UT)
   OV.Path.dirBetween(m, a, b) → 0..7 | 8 subir | 9 descer | −1 ; OV.Path.budget(unit) → {tu, energy}
   opts = {run, ai, sneaky:Uint8Array(n), units:'plan'|'all'|'none', seen:fn(u)|Set|[ids], energy (só find)}
     units 'plan' (omissão): bloqueiam as unidades do mesmo lado e os inimigos vistos pelo lado da unidade;
     'all': todas; 'none': nenhuma. seen por omissão: OV.LOS.isVisibleTo(B, side, u) se existir, senão a união
     de u.vis (ids) das unidades conscientes do lado (+ u.visible para o lado X-COM). */
(function (OV) {
  'use strict';

  const U = OV.U;
  const DX = U.DX, DY = U.DY;
  const BLOCKED = 255;
  const LIVE = { ok: 1, panic: 1 };
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  // direção a partir de (dx+1) + 3·(dy+1)
  const DIR_OF = [7, 0, 1, 6, -1, 2, 5, 4, 3];

  // ---- tabelas por id de definição (OV.Data.tileDefs é imutável depois do finalize) --------------------
  const F_FULL = 1, F_SWING = 2, F_UFO = 4, F_GRAV = 8, F_FOOT = 16, F_HEAD = 32;
  let TB = null;
  function tables() {
    const defs = OV.Data.tileDefs;
    if (TB && TB.defs === defs && TB.len === defs.length) return TB;
    const len = defs.length;
    const tu = new Uint8Array(len), fl = new Uint8Array(len), alt = new Uint16Array(len);
    let minFloor = tune('TU_WALK', 4);
    for (let id = 1; id < len; id++) {
      const d = defs[id];
      if (!d) continue;
      tu[id] = Math.min(BLOCKED, Math.max(0, d.tu | 0));
      let f = 0;
      if (d.fullBlock) f |= F_FULL;
      if (d.door === 'swing' && !d.open) f |= F_SWING;
      if (d.door === 'ufo' && !d.open) f |= F_UFO;
      if (d.gravlift) f |= F_GRAV;
      if (d.stairs === 'foot') f |= F_FOOT;
      if (d.stairs === 'head') f |= F_HEAD;
      fl[id] = f;
      alt[id] = d.alt | 0;
      if (d.part === 'floor' && tu[id] < minFloor) minFloor = tu[id];
    }
    TB = { defs, len, tu, fl, alt, minFloor };
    return TB;
  }

  // ---- buffers de trabalho por tamanho de mapa (carimbos de geração: nada é limpo entre chamadas) ------
  const SCR = new Map();
  const BMASK = 4095; // baldes do Dial (> maior custo de pesquisa de uma aresta)
  function scratch(n) {
    let S = SCR.get(n);
    if (!S) {
      if (SCR.size >= 4) SCR.clear();
      S = {
        n, gen: 0, stamp: new Int32Array(n), done: new Int32Array(n), block: new Int32Array(n),
        g: new Int32Array(n), tu: new Int32Array(n), en: new Int32Array(n), par: new Int32Array(n), pd: new Int8Array(n),
        list: new Int32Array(n), hn: new Int32Array(1024), hk: new Float64Array(1024), hs: 0,
        bHead: new Int32Array(BMASK + 1), eNode: new Int32Array(4 * n), eNext: new Int32Array(4 * n),
      };
      SCR.set(n, S);
    }
    if (++S.gen >= 0x3fffffff) {
      S.gen = 1;
      S.stamp.fill(0);
      S.done.fill(0);
      S.block.fill(0);
    }
    S.hs = 0;
    return S;
  }

  // heap binário mínimo (nós + chaves)
  function hpush(S, node, key) {
    if (S.hs >= S.hn.length) {
      const hn = new Int32Array(S.hn.length * 2), hk = new Float64Array(S.hk.length * 2);
      hn.set(S.hn);
      hk.set(S.hk);
      S.hn = hn;
      S.hk = hk;
    }
    const hn = S.hn, hk = S.hk;
    let i = S.hs++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hn[i] = hn[p];
      hk[i] = hk[p];
      i = p;
    }
    hn[i] = node;
    hk[i] = key;
  }
  function hpop(S) {
    const hn = S.hn, hk = S.hk;
    const top = hn[0];
    const n = --S.hs;
    if (n > 0) {
      const node = hn[n], key = hk[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= key) break;
        hn[i] = hn[c];
        hk[i] = hk[c];
        i = c;
      }
      hn[i] = node;
      hk[i] = key;
    }
    return top;
  }

  // ---- visibilidade de inimigos para o planeamento -----------------------------------------------------
  function seenPredicate(B, side, opts) {
    const s = opts && opts.seen;
    if (typeof s === 'function') return s;
    if (s instanceof Set) return (u) => s.has(u.id);
    if (Array.isArray(s)) return (u) => s.indexOf(u.id) >= 0;
    if (OV.LOS && typeof OV.LOS.isVisibleTo === 'function') return (u) => !!OV.LOS.isVisibleTo(B, side, u);
    const ids = new Set();
    for (const v of B.units) {
      if (v.side !== side || !v.onMap || !LIVE[v.status] || !Array.isArray(v.vis)) continue;
      for (const id of v.vis) ids.add(id);
    }
    return (u) => ids.has(u.id) || (side === 'xcom' && u.visible === true);
  }

  // ---- contexto de uma pesquisa -----------------------------------------------------------------------
  function makeCtx(B, unit, opts) {
    const m = B.map, o = opts || {};
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    const S = scratch(m.n);
    const size = unit.size > 1 ? unit.size | 0 : 1;
    const c = {
      B, m, T: tables(), S, gen: S.gen, w: m.w, h: m.h, d: m.d, plane: m.w * m.h, n: m.n,
      parts: m.parts, uo: m.ufoDoorOpen, fire: m.fire, unitAt: B._ ? B._.unitAt : null,
      size, fly: !!unit.canFly, uid: unit.id, run: !!o.run, ai: !!o.ai, sneaky: o.sneaky || null,
      doors: size === 1, ufoDoors: true, ceiling: !!m.ceiling, target: -1, bomb: false,
      TU_WALK: tune('TU_WALK', 4), TU_DOOR: tune('TU_DOOR', 4), TU_LIFT: tune('TU_GRAVLIFT', 8),
      TU_STAIRS: tune('TU_STAIRS', 6), EN_STAIRS: tune('EN_STAIRS', 3), FIRE_PEN: tune('AI_BURNING_PATH_COST', 32),
      RTN: tune('RUN_TU_NUM', 3), RTD: tune('RUN_TU_DEN', 4), REN: tune('RUN_EN_NUM', 3), RED: tune('RUN_EN_DEN', 2),
      DN: tune('DIAG_NUM', 3), DD: tune('DIAG_DEN', 2),
    };
    markUnits(c, unit, o);
    return c;
  }

  // marca (carimbo gen em S.block) os tiles das unidades que bloqueiam esta pesquisa
  function markUnits(c, unit, o) {
    const mode = o.units || 'plan';
    if (mode === 'none') return;
    const B = c.B, m = c.m, block = c.S.block, gen = c.gen;
    let seen = null;
    for (const u of B.units) {
      if (u === unit || u.id === unit.id || !u.onMap || !LIVE[u.status] || u.x < 0) continue;
      if (mode !== 'all' && u.side !== unit.side) {
        if (!seen) seen = seenPredicate(B, unit.side, o);
        if (!seen(u)) continue;
      }
      const s = u.size > 1 ? u.size : 1;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const x = u.x + dx, y = u.y + dy;
          if (x < m.w && y < m.h && u.z >= 0 && u.z < m.d) block[(u.z * m.h + y) * m.w + x] = gen;
        }
      }
    }
  }

  // ---- peças do custo -------------------------------------------------------------------------------------
  // id da parede atravessada por um passo ortogonal a partir de (x,y) no nível zo (0 = nenhuma)
  function wallAt(c, x, y, zo, dir) {
    let wx = x, wy = y, part = 1;
    if (dir === 0) part = 2;
    else if (dir === 2) wx++;
    else if (dir === 4) { wy++; part = 2; }
    if (wx < 0 || wy < 0 || wx >= c.w || wy >= c.h) return 0;
    return c.parts[(zo + wy * c.w + wx) * 4 + part];
  }

  // objeto efetivo (porta de OVNI aberta ⇒ definição aberta)
  function effObj(c, i) {
    const o = c.parts[i * 4 + 3];
    return o && (c.T.fl[o] & F_UFO) && c.uo[i] ? c.T.alt[o] : o;
  }
  function fullAt(c, i) {
    const o = effObj(c, i);
    return o !== 0 && (c.T.fl[o] & F_FULL) !== 0;
  }
  function passObj(c, i) {
    const o = effObj(c, i);
    return o === 0 || ((c.T.fl[o] & (F_FULL | F_UFO)) === 0 && c.T.tu[o] < BLOCKED);
  }
  const hasFloorAt = (c, i) => c.parts[i * 4] !== 0 || i < c.plane;

  // paredes internas de uma pegada s×s com canto (x,y) no nível zo: alguma bloqueia?
  function innerBlocked(c, x, y, zo) {
    const s = c.size, P = c.parts, tu = c.T.tu, w = c.w;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const i = zo + (y + dy) * w + x + dx;
        if (dx > 0) {
          const wd = P[i * 4 + 1];
          if (wd && tu[wd] >= BLOCKED) return true;
        }
        if (dy > 0) {
          const wd = P[i * 4 + 2];
          if (wd && tu[wd] >= BLOCKED) return true;
        }
      }
    }
    return false;
  }

  // unidades na pegada (canto x,y no nível lz): bloqueia? (regista em out.occ a primeira não vista)
  function unitsBlock(c, x, y, lz, out) {
    const s = c.size, block = c.S.block, gen = c.gen, ua = c.unitAt;
    const zo = lz * c.plane;
    if (s === 1) {
      const i = zo + y * c.w + x;
      if (i === c.target) return false;
      if (block[i] === gen) return true;
      if (ua && ua[i] && out.occ < 0 && ua[i] - 1 !== c.uid) out.occ = ua[i] - 1;
      return false;
    }
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const i = zo + (y + dy) * c.w + x + dx;
        if (i === c.target) continue;
        if (block[i] === gen) return true;
        if (ua && ua[i] && out.occ < 0 && ua[i] - 1 !== c.uid) out.occ = ua[i] - 1;
      }
    }
    return false;
  }

  // penalização de pesquisa (fogo para a IA; tiles vistos pelo X-COM com «sneaky»)
  function penalty(c, x, y, lz, tu) {
    let pen = 0;
    const zo = lz * c.plane;
    if (c.ai) {
      for (let dy = 0; dy < c.size && !pen; dy++) {
        for (let dx = 0; dx < c.size; dx++) {
          if (c.fire[zo + (y + dy) * c.w + x + dx] > 0) {
            pen = c.FIRE_PEN;
            break;
          }
        }
      }
    }
    if (c.sneaky && c.sneaky[zo + y * c.w + x]) pen += tu;
    return pen;
  }

  // resultado de uma parte (passo horizontal 1×1)
  const R = { door: -1, part: 0, ufo: -1, floor: false };

  /* Custo de uma parte 1×1 a andar na horizontal (OpenXcom getTUCost): chão + objeto do destino; diagonal
     ×3/2 e depois a média das paredes transponíveis atravessadas; −1 = bloqueado. Paredes pela tabela do
     DESIGN §9 (as mesmas de OV.BMap.edgeInfo); sem cortar esquinas (objeto de bloco inteiro num canto).
     Porta de batente fechada num passo ortogonal: passável (abre-se; parede aberta = alt). Porta de OVNI
     fechada no destino: passável num passo ortogonal (abre-se). */
  function partStep(c, x, y, z, dir) {
    const w = c.w, nx = x + DX[dir], ny = y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= w || ny >= c.h) return -1;
    const T = c.T, P = c.parts, tuT = T.tu, flT = T.fl;
    const zo = z * c.plane;
    const from = zo + y * w + x, t = zo + ny * w + nx;
    let wallTU = 0;
    if ((dir & 1) === 0) {
      const wi = dir === 0 || dir === 6 ? from : t;
      const part = dir === 0 || dir === 4 ? 2 : 1;
      const wd = P[wi * 4 + part];
      if (wd) {
        const wt = tuT[wd];
        if (wt >= BLOCKED) {
          if (!(flT[wd] & F_SWING) || !c.doors) return -1;
          R.door = wi;
          R.part = part;
          const at = tuT[T.alt[wd]];
          if (at < BLOCKED) wallTU = at;
        } else wallTU = wt;
      }
    } else {
      const a = (dir + 7) & 7, b = (dir + 1) & 7;
      const ax = x + DX[a], ay = y + DY[a], bx = x + DX[b], by = y + DY[b];
      if (fullAt(c, zo + ay * w + ax) || fullAt(c, zo + by * w + bx)) return -1;
      let sum = 0, cnt = 0, wd, v;
      wd = wallAt(c, x, y, zo, a);
      if (wd) { v = tuT[wd]; if (v >= BLOCKED) return -1; sum += v; cnt++; }
      wd = wallAt(c, ax, ay, zo, b);
      if (wd) { v = tuT[wd]; if (v >= BLOCKED) return -1; sum += v; cnt++; }
      wd = wallAt(c, x, y, zo, b);
      if (wd) { v = tuT[wd]; if (v >= BLOCKED) return -1; sum += v; cnt++; }
      wd = wallAt(c, bx, by, zo, a);
      if (wd) { v = tuT[wd]; if (v >= BLOCKED) return -1; sum += v; cnt++; }
      if (cnt) wallTU = U.idiv(sum, cnt);
    }
    let o = P[t * 4 + 3];
    if (o && (flT[o] & F_UFO)) {
      if (!c.uo[t]) {
        if ((dir & 1) || !c.ufoDoors) { if (t !== c.target) return -1; } else R.ufo = t;
      }
      o = T.alt[o];
    }
    let otu = 0;
    if (o) {
      otu = tuT[o];
      if ((flT[o] & F_FULL) || otu >= BLOCKED) {
        if (t !== c.target) return -1;
        otu = 0;
      }
    }
    const f = P[t * 4];
    R.floor = f !== 0 || t < c.plane;
    const ft = f ? tuT[f] : c.TU_WALK;
    if (ft >= BLOCKED) return -1;
    let cost = ft + otu;
    if (dir & 1) cost = U.idiv(cost * c.DN, c.DD);
    return cost + wallTU;
  }

  // passo horizontal da unidade (todas as partes; 2×2 = média das partes, como no OpenXcom)
  function hStep(c, x, y, z, dir, out) {
    const size = c.size, w = c.w, plane = c.plane;
    let sum = 0, floors = 0, door = -1, part = 0, ufo = -1;
    if (size === 1) {
      R.door = -1;
      R.ufo = -1;
      sum = partStep(c, x, y, z, dir);
      if (sum < 0) return false;
      if (R.floor) floors = 1;
      door = R.door;
      part = R.part;
      ufo = R.ufo;
    } else {
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          R.door = -1;
          R.ufo = -1;
          const k = partStep(c, x + px, y + py, z, dir);
          if (k < 0) return false;
          sum += k;
          if (R.floor) floors++;
          if (R.door >= 0) { door = R.door; part = R.part; }
          if (R.ufo >= 0 && ufo < 0) ufo = R.ufo;
        }
      }
      sum = U.idiv(sum, size * size);
    }
    const nx = x + DX[dir], ny = y + DY[dir];
    if (size > 1 && innerBlocked(c, nx, ny, z * plane)) return false;
    let tz = z, fall = false, float = false;
    if (floors === 0) {
      if (c.fly) float = true;
      else {
        // cai até ao primeiro nível com chão (orig: a queda custa 0 UT)
        for (;;) {
          tz--;
          const zo = tz * plane;
          let fl = 0;
          for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
              const i = zo + (ny + py) * w + nx + px;
              if (!passObj(c, i)) return false;
              if (hasFloorAt(c, i)) fl++;
            }
          }
          if (size > 1 && innerBlocked(c, nx, ny, zo)) return false;
          if (fl) break;
        }
        fall = true;
      }
    }
    out.occ = -1;
    for (let lz = z; lz >= tz; lz--) if (unitsBlock(c, nx, ny, lz, out)) return false;
    let tu = sum, en = sum >> 1;
    if (c.run) {
      tu = U.idiv(tu * c.RTN, c.RTD);
      en = U.idiv(en * c.REN, c.RED);
    }
    if (door >= 0) tu += c.TU_DOOR;
    if (ufo >= 0) tu += c.TU_DOOR;
    out.tu = tu;
    out.en = en;
    out.door = door;
    out.part = part;
    out.ufo = ufo;
    out.fall = fall;
    out.float = float;
    out.kind = fall ? 'fall' : 'walk';
    out.via = z * plane + ny * w + nx;
    out.to = tz * plane + ny * w + nx;
    out.pen = c.ai || c.sneaky ? penalty(c, nx, ny, tz, tu) : 0;
    return true;
  }

  // passo vertical: elevador gravítico (8 UT), escadas s↔S (6 UT, 3 energia; só 1×1) ou voo (8 UT)
  function vStep(c, x, y, z, up, out) {
    out.door = -1; out.part = 0; out.ufo = -1; out.fall = false; out.float = false; out.occ = -1; out.pen = 0;
    const nz = up ? z + 1 : z - 1;
    if (nz < 0 || nz >= c.d) return false;
    const size = c.size, w = c.w, plane = c.plane, fl = c.T.fl;
    const dz = up ? plane : -plane;
    // sem voo, só há ligação se o canto tiver elevador ou escadas
    if (!c.fly && !(fl[effObj(c, z * plane + y * w + x)] & (size === 1 ? F_GRAV | F_FOOT | F_HEAD : F_GRAV))) return false;
    let kind = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const i = z * plane + (y + py) * w + x + px;
        const fo = fl[effObj(c, i)], to = fl[effObj(c, i + dz)];
        let k = 0;
        if ((fo & F_GRAV) && (to & F_GRAV)) k = 1;
        else if (size === 1 && (up ? (fo & F_FOOT) && (to & F_HEAD) : (fo & F_HEAD) && (to & F_FOOT))) k = 2;
        if (!k || (kind && k !== kind)) { kind = -1; break; }
        kind = k;
      }
      if (kind < 0) break;
    }
    // escadas/elevador só levam a tiles com chão (o de cima pode ter sido destruído por uma explosão); sem ele só voando
    if (kind > 0) {
      for (let py = 0; py < size && kind > 0; py++) {
        for (let px = 0; px < size; px++) {
          if (!hasFloorAt(c, nz * plane + (y + py) * w + x + px)) { kind = 0; break; }
        }
      }
    }
    if (kind <= 0) {
      if (!c.fly || (up && c.ceiling)) return false;
      // voo: o chão do tile de cima é o teto do de baixo
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const i = z * plane + (y + py) * w + x + px;
          if (hasFloorAt(c, up ? i + dz : i)) return false;
        }
      }
      kind = 3;
    }
    let floors = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const j = nz * plane + (y + py) * w + x + px;
        if (j !== c.target && !passObj(c, j)) return false;
        if (hasFloorAt(c, j)) floors++;
      }
    }
    if (size > 1 && innerBlocked(c, x, y, nz * plane)) return false;
    if (unitsBlock(c, x, y, nz, out)) return false;
    out.kind = kind === 1 ? 'gravlift' : kind === 2 ? 'stairs' : 'fly';
    out.tu = kind === 2 ? c.TU_STAIRS : c.TU_LIFT;
    out.en = kind === 2 ? c.EN_STAIRS : 0;
    out.float = kind === 3 && floors === 0;
    out.to = out.via = nz * plane + y * w + x;
    out.pen = c.ai || c.sneaky ? penalty(c, x, y, nz, out.tu) : 0;
    return true;
  }

  /* vizinho direto da pegada (−1 = fora do mapa). Um vizinho já fechado com chão não pode ser melhorado
     (o passo só leva a outro tile numa queda, e quedas exigem destino sem chão) */
  function neighbourOf(c, x, y, z, v, d) {
    if (d >= 8) return d === 8 ? (z + 1 < c.d ? v + c.plane : -1) : z > 0 ? v - c.plane : -1;
    const nx = x + DX[d], ny = y + DY[d];
    if (nx < 0 || ny < 0 || nx + c.size > c.w || ny + c.size > c.h) return -1;
    return v + DY[d] * c.w + DX[d];
  }

  function step(c, x, y, z, dir, out) {
    if (dir < 8) return hStep(c, x, y, z, dir, out);
    return vStep(c, x, y, z, dir === 8, out);
  }

  const OUT = { tu: 0, en: 0, pen: 0, to: -1, via: -1, door: -1, part: 0, ufo: -1, fall: false, float: false, occ: -1, kind: 'walk' };

  function originOf(B, unit) {
    const m = B.map;
    if (!unit || !unit.onMap || unit.x < 0 || unit.y < 0 || unit.z < 0) return -1;
    if (unit.x >= m.w || unit.y >= m.h || unit.z >= m.d) return -1;
    return (unit.z * m.h + unit.y) * m.w + unit.x;
  }

  // pegada s×s cabe no mapa com canto (x,y)?
  const footprintIn = (c, x, y) => x >= 0 && y >= 0 && x + c.size <= c.w && y + c.size <= c.h;

  // ---- API pública ------------------------------------------------------------------------------------------
  // UT/energia disponíveis para andar (de joelhos levanta-se primeiro: TU_STAND)
  function budget(unit) {
    const tu = (unit.tu | 0) - (unit.kneel ? tune('TU_STAND', 8) : 0);
    return { tu: Math.max(0, tu), energy: Math.max(0, unit.energy | 0) };
  }

  function stepCost(B, unit, fromI, dir, opts) {
    const m = B.map;
    if (!(fromI >= 0 && fromI < m.n) || !(dir >= 0 && dir <= 9)) return null;
    const c = makeCtx(B, unit, opts);
    const z = (fromI / c.plane) | 0, r = fromI - z * c.plane, y = (r / c.w) | 0, x = r - y * c.w;
    if (!footprintIn(c, x, y) || !step(c, x, y, z, dir | 0, OUT)) return null;
    return {
      tu: OUT.tu, energy: OUT.en, to: OUT.to, via: OUT.via, dir: dir | 0, kind: OUT.kind,
      door: OUT.door >= 0 ? { i: OUT.door, part: OUT.part } : null, opensUfoDoor: OUT.ufo >= 0 ? OUT.ufo : null,
      fall: OUT.fall, float: OUT.float, occupant: OUT.occ >= 0 ? OUT.occ : null, penalty: OUT.pen,
    };
  }

  // Dijkstra limitado por UT e energia; ordem por custo de pesquisa (UT + penalização), desempate pela energia
  function reachable(B, unit, tuBudget, energyBudget, opts) {
    const m = B.map, n = m.n;
    const bud = budget(unit);
    const tuB = tuBudget === undefined || tuBudget === null ? bud.tu : tuBudget;
    const enB = energyBudget === undefined || energyBudget === null ? bud.energy : energyBudget;
    const cost = new Int16Array(n).fill(-1), energy = new Int16Array(n).fill(-1);
    const parent = new Int32Array(n).fill(-1), dirA = new Int8Array(n).fill(-1);
    const origin = originOf(B, unit);
    const res = { cost, energy, parent, dir: dirA, list: null, origin, unitId: unit.id, tuBudget: tuB, energyBudget: enB };
    if (origin < 0) {
      res.list = new Int32Array(0);
      return res;
    }
    const c = makeCtx(B, unit, opts);
    const S = c.S, gen = c.gen, g = S.g, tuA = S.tu, enA = S.en, par = S.par, pd = S.pd, stamp = S.stamp, done = S.done;
    const list = S.list, w = c.w, plane = c.plane, out = OUT;
    // fila de baldes circular (Dial): custos inteiros pequenos e sem arestas de custo 0
    const head = S.bHead;
    head.fill(-1);
    let eN = 0, popped = 0, cur = 0, count = 0;
    const bpush = (node, key) => {
      if (eN >= S.eNode.length) {
        const a = new Int32Array(S.eNode.length * 2), b = new Int32Array(S.eNode.length * 2);
        a.set(S.eNode);
        b.set(S.eNext);
        S.eNode = a;
        S.eNext = b;
      }
      const k = key & BMASK;
      S.eNode[eN] = node;
      S.eNext[eN] = head[k];
      head[k] = eN++;
    };
    stamp[origin] = gen;
    g[origin] = 0;
    tuA[origin] = 0;
    enA[origin] = 0;
    par[origin] = -1;
    pd[origin] = -1;
    bpush(origin, 0);
    while (popped < eN) {
      while (head[cur & BMASK] < 0) cur++;
      const e = head[cur & BMASK];
      head[cur & BMASK] = S.eNext[e];
      popped++;
      const v = S.eNode[e];
      if (done[v] === gen || g[v] !== cur) continue;
      done[v] = gen;
      list[count++] = v;
      const z = (v / plane) | 0, rr = v - z * plane, y = (rr / w) | 0, x = rr - y * w;
      const gv = g[v], tv = tuA[v], ev = enA[v];
      for (let d = 0; d < 10; d++) {
        const t0 = neighbourOf(c, x, y, z, v, d);
        if (t0 < 0 || (done[t0] === gen && (c.fly || d >= 8 || hasFloorAt(c, t0)))) continue;
        if (!step(c, x, y, z, d, out)) continue;
        const t = out.to;
        if (done[t] === gen) continue;
        const nt = tv + out.tu, ne = ev + out.en;
        if (nt > tuB || ne > enB) continue;
        const ng = gv + out.tu + out.pen;
        if (stamp[t] !== gen || ng < g[t] || (ng === g[t] && ne < enA[t])) {
          stamp[t] = gen;
          g[t] = ng;
          tuA[t] = nt;
          enA[t] = ne;
          par[t] = v;
          pd[t] = d;
          bpush(t, ng);
        }
      }
    }
    for (let k = 0; k < count; k++) {
      const v = list[k];
      cost[v] = tuA[v];
      energy[v] = enA[v];
      parent[v] = par[v];
      dirA[v] = pd[v];
    }
    res.list = list.slice(0, count);
    return res;
  }

  function pathTo(reach, toI) {
    if (!reach || !(toI >= 0) || toI >= reach.cost.length || reach.cost[toI] < 0) return null;
    const steps = [], tiles = [], tus = [];
    let v = toI;
    while (v !== reach.origin && reach.parent[v] >= 0) {
      steps.push(reach.dir[v]);
      tiles.push(v);
      tus.push(reach.cost[v]);
      v = reach.parent[v];
    }
    if (v !== reach.origin) return null;
    steps.reverse();
    tiles.reverse();
    tus.reverse();
    return { steps, tiles, tus, tu: reach.cost[toI], energy: reach.energy[toI] };
  }

  // coeficientes da heurística octile 3-D (admissível com os custos mínimos reais)
  function heurCoef(c) {
    if (c.bomb) return { a: 4, b: 2, up: 8, down: 8 };
    let orth = c.T.minFloor, diag = U.idiv(orth * c.DN, c.DD);
    if (c.run) {
      orth = U.idiv(orth * c.RTN, c.RTD);
      diag = U.idiv(diag * c.RTN, c.RTD);
    }
    const up = c.size > 1 ? c.TU_LIFT : Math.min(c.TU_LIFT, c.TU_STAIRS);
    return { a: orth, b: diag - orth, up, down: c.fly ? up : 0 };
  }

  // custo de aresta na pesquisa: UT reais (ou uniformes para a bomba)
  const bombCost = (d) => (d >= 8 ? 8 : d & 1 ? 6 : 4);

  // linha reta de Bresenham no mesmo nível: aceite só se o custo igualar o limite inferior (logo é ótima)
  function straight(c, origin, toI, hc, maxT, maxE) {
    const plane = c.plane, w = c.w;
    const oz = (origin / plane) | 0, orr = origin - oz * plane, oy = (orr / w) | 0, ox = orr - oy * w;
    const tz = (toI / plane) | 0, trr = toI - tz * plane, ty = (trr / w) | 0, tx = trr - ty * w;
    if (oz !== tz) return null;
    const adx = Math.abs(tx - ox), ady = Math.abs(ty - oy), sx = tx > ox ? 1 : -1, sy = ty > oy ? 1 : -1;
    const lower = hc.a * Math.max(adx, ady) + hc.b * Math.min(adx, ady);
    let x = ox, y = oy, err = adx - ady, gs = 0, tu = 0, en = 0;
    const steps = [], tiles = [], tus = [];
    while (x !== tx || y !== ty) {
      const e2 = 2 * err;
      let mx = 0, my = 0;
      if (e2 > -ady) { err -= ady; mx = sx; }
      if (e2 < adx) { err += adx; my = sy; }
      const d = DIR_OF[mx + 1 + 3 * (my + 1)];
      if (!hStep(c, x, y, oz, d, OUT) || OUT.fall) return null;
      x += mx;
      y += my;
      gs += OUT.tu + OUT.pen;
      tu += OUT.tu;
      en += OUT.en;
      if (gs > lower || tu > maxT || en > maxE) return null;
      steps.push(d);
      tiles.push(OUT.to);
      tus.push(tu);
    }
    if (gs !== lower) return null;
    return { steps, tiles, tus, tu, energy: en };
  }

  // A* com carimbos; heurística a·max(|dx|,|dy|) + b·min + up/down·|dz|
  function astar(c, origin, toI, maxT, maxE) {
    const S = c.S, gen = c.gen, g = S.g, tuA = S.tu, enA = S.en, par = S.par, pd = S.pd, stamp = S.stamp, done = S.done;
    const w = c.w, plane = c.plane, out = OUT, hc = heurCoef(c);
    const tz = (toI / plane) | 0, trr = toI - tz * plane, ty = (trr / w) | 0, tx = trr - ty * w;
    const heur = (i) => {
      const z = (i / plane) | 0, rr = i - z * plane, y = (rr / w) | 0, x = rr - y * w;
      const adx = Math.abs(x - tx), ady = Math.abs(y - ty), dz = tz - z;
      return hc.a * (adx > ady ? adx : ady) + hc.b * (adx > ady ? ady : adx) + (dz > 0 ? hc.up * dz : -dz * hc.down);
    };
    stamp[origin] = gen;
    g[origin] = 0;
    tuA[origin] = 0;
    enA[origin] = 0;
    par[origin] = -1;
    pd[origin] = -1;
    const h0 = heur(origin);
    hpush(S, origin, h0 * 65536 + h0);
    while (S.hs > 0) {
      const v = hpop(S);
      if (done[v] === gen) continue;
      done[v] = gen;
      if (v === toI) return true;
      const z = (v / plane) | 0, rr = v - z * plane, y = (rr / w) | 0, x = rr - y * w;
      const gv = g[v], tv = tuA[v], ev = enA[v];
      for (let d = 0; d < 10; d++) {
        const t0 = neighbourOf(c, x, y, z, v, d);
        if (t0 < 0 || (done[t0] === gen && (c.fly || d >= 8 || hasFloorAt(c, t0)))) continue;
        if (!step(c, x, y, z, d, out)) continue;
        const t = out.to;
        if (done[t] === gen) continue;
        const nt = tv + out.tu, ne = ev + out.en;
        if (nt > maxT || ne > maxE) continue;
        const ng = gv + (c.bomb ? bombCost(d) : out.tu + out.pen);
        if (stamp[t] !== gen || ng < g[t] || (ng === g[t] && ne < enA[t])) {
          stamp[t] = gen;
          g[t] = ng;
          tuA[t] = nt;
          enA[t] = ne;
          par[t] = v;
          pd[t] = d;
          const ht = heur(t);
          hpush(S, t, (ng + ht) * 65536 + ht);
        }
      }
    }
    return false;
  }

  function collect(c, origin, toI) {
    const S = c.S, steps = [], tiles = [], tus = [];
    for (let v = toI; v !== origin; v = S.par[v]) {
      steps.push(S.pd[v]);
      tiles.push(v);
      tus.push(S.tu[v]);
    }
    steps.reverse();
    tiles.reverse();
    tus.reverse();
    return { steps, tiles, tus, tu: S.tu[toI], energy: S.en[toI] };
  }

  function find(B, unit, toI, maxTU, opts) {
    const m = B.map, o = opts || {};
    const origin = originOf(B, unit);
    if (origin < 0 || !(toI >= 0) || toI >= m.n) return null;
    if (origin === toI) return { steps: [], tiles: [], tus: [], tu: 0, energy: 0 };
    const maxT = maxTU === undefined || maxTU === null ? Infinity : maxTU;
    const maxE = o.energy === undefined || o.energy === null ? Infinity : o.energy;
    const c = makeCtx(B, unit, o);
    const sr = straight(c, origin, toI, heurCoef(c), maxT, maxE);
    if (sr) return sr;
    c.S.hs = 0;
    return astar(c, origin, toI, maxT, maxE) ? collect(c, origin, toI) : null;
  }

  // rota da bomba do Blaster: voo 1×1 sem UT, evita objetos sólidos, paredes e (se possível) unidades
  function flyRoute(B, fromI, toI, opts) {
    const m = B.map;
    if (!(fromI >= 0) || !(toI >= 0) || fromI >= m.n || toI >= m.n) return null;
    if (fromI === toI) return [fromI];
    const o = opts || {};
    const modes = o.units ? [o.units] : ['all', 'none'];
    const probe = { id: -1, side: null, size: 1, canFly: true };
    for (const mode of modes) {
      const c = makeCtx(B, probe, { units: mode });
      c.bomb = true;
      c.doors = false;
      c.ufoDoors = false;
      c.target = toI;
      c.S.block[fromI] = 0;
      if (astar(c, fromI, toI, Infinity, Infinity)) return [fromI].concat(collect(c, fromI, toI).tiles);
    }
    return null;
  }

  function dirBetween(m, a, b) {
    const plane = m.w * m.h;
    const az = (a / plane) | 0, ar = a - az * plane, ay = (ar / m.w) | 0, ax = ar - ay * m.w;
    const bz = (b / plane) | 0, br = b - bz * plane, by = (br / m.w) | 0, bx = br - by * m.w;
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return bz > az ? 8 : bz < az ? 9 : -1;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1) return -1;
    return DIR_OF[dx + 1 + 3 * (dy + 1)];
  }

  OV.Path = { stepCost, reachable, pathTo, find, flyRoute, dirBetween, budget };
})(globalThis.OV || (globalThis.OV = {}));
