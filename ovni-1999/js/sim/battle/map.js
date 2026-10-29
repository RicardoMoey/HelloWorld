/* Mapa de batalha (DESIGN.md §5.3, §7.1, §9): tiles com 4 partes [chão, parede oeste, parede norte, objeto],
   fogo, fumo, portas de OVNI abertas e descoberta. Modelo de paredes X-COM: as paredes vivem nas arestas
   oeste/norte de cada tile. Só leitura do mapa + setPart (a única escrita, emite evento 'tile').

   OV.BMap.create(w,h,d) → {w,h,d,n,plane, parts:Uint16Array(n·4), fire, smoke, ufoDoorOpen, disc:Uint8Array(n), ceiling}
     disc: bit0 chão/conteúdo descoberto, bit1 parede oeste, bit2 parede norte (DESIGN §8)
     ufoDoorOpen[i] ≠ 0 ⇒ a porta de OVNI do objeto do tile i está aberta (a parte guarda a porta fechada;
     objectDef() devolve a definição aberta). Portas de batente trocam de parte (alt) e ficam abertas.
   idx/xyz/inB/neighbour; def(m,i,part); objectDef(m,i); setPart(B,i,part,defId) → {t:'tile',i,part,defId};
   hasFloor; canStand; tileTU; isFullBlock; edgeInfo(m,x,y,z,dir); edgeBlocks(m,x,y,z,dir,kind);
   verticalLink(m,i,up); isUfoDoor; isDoorOpen; ufoDoorGroup; dropTarget. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const DX = U.DX, DY = U.DY;
  const BLOCKED = 255;

  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);
  const defs = () => OV.Data.tileDefs;

  function create(w, h, d) {
    const n = w * h * d;
    return {
      w, h, d, n, plane: w * h,
      parts: new Uint16Array(n * 4),
      fire: new Uint8Array(n),
      smoke: new Uint8Array(n),
      ufoDoorOpen: new Uint8Array(n),
      disc: new Uint8Array(n),
      ceiling: false,
    };
  }

  const idx = (m, x, y, z) => (z * m.h + y) * m.w + x;
  function xyz(m, i) {
    const plane = m.w * m.h;
    const z = (i / plane) | 0;
    const r = i - z * plane;
    const y = (r / m.w) | 0;
    return [r - y * m.w, y, z];
  }
  const inB = (m, x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < m.w && y < m.h && z < m.d;

  // vizinho na direção 0..7 (mesmo nível), 8 acima, 9 abaixo; −1 fora do mapa
  function neighbour(m, i, dir) {
    const [x, y, z] = xyz(m, i);
    if (dir === 8) return z + 1 < m.d ? i + m.w * m.h : -1;
    if (dir === 9) return z > 0 ? i - m.w * m.h : -1;
    const nx = x + DX[dir], ny = y + DY[dir];
    return inB(m, nx, ny, z) ? idx(m, nx, ny, z) : -1;
  }

  // definição crua da parte (0 chão, 1 oeste, 2 norte, 3 objeto)
  function def(m, i, part) {
    if (i < 0 || i >= m.n) return null;
    const v = m.parts[i * 4 + part];
    return v ? defs()[v] : null;
  }

  const isUfoDoor = (m, i) => {
    const o = def(m, i, 3);
    return !!(o && o.door === 'ufo');
  };

  // objeto efetivo: porta de OVNI aberta (ufoDoorOpen) ⇒ definição alternativa (aberta)
  function objectDef(m, i) {
    const o = def(m, i, 3);
    if (o && o.door === 'ufo' && !o.open && m.ufoDoorOpen[i]) return o.alt ? defs()[o.alt] : null;
    return o;
  }

  // porta aberta? part 3 = porta de OVNI; 1/2 = porta de batente na aresta
  function isDoorOpen(m, i, part) {
    const p = part === undefined ? 3 : part;
    const d = def(m, i, p);
    if (!d || !d.door) return false;
    if (p === 3 && d.door === 'ufo') return !!d.open || m.ufoDoorOpen[i] > 0;
    return !!d.open;
  }

  // segmentos de porta de OVNI ligados ortogonalmente no mesmo nível (abrem juntos, DESIGN §7.2 «O»)
  function ufoDoorGroup(m, i) {
    if (!isUfoDoor(m, i)) return [];
    const out = [i];
    const seen = new Set(out);
    for (let k = 0; k < out.length; k++) {
      for (const dir of [0, 2, 4, 6]) {
        const j = neighbour(m, out[k], dir);
        if (j >= 0 && !seen.has(j) && isUfoDoor(m, j)) {
          seen.add(j);
          out.push(j);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  function setPart(B, i, part, defId) {
    const m = B.map;
    m.parts[i * 4 + part] = defId | 0;
    if (part === 3) {
      const o = defId ? defs()[defId] : null;
      if (!o || o.door !== 'ufo') m.ufoDoorOpen[i] = 0;
    }
    if (B._ && B._.dirty) {
      B._.dirty.light = true;
      B._.dirty.los = true;
      B._.dirty.path = true;
    }
    return { t: 'tile', i, part, defId: defId | 0 };
  }

  // nível 0 tem sempre chão (o chão térreo morre para «queimado», nunca para vazio)
  const hasFloor = (m, i) => m.parts[i * 4] !== 0 || i < m.w * m.h;

  function isFullBlock(m, i) {
    const o = objectDef(m, i);
    return !!(o && o.fullBlock);
  }

  // pode-se estar neste tile (chão + objeto transponível; porta de OVNI fechada não)
  function canStand(m, i) {
    if (i < 0 || i >= m.n || !hasFloor(m, i)) return false;
    const o = objectDef(m, i);
    return !o || (o.tu < BLOCKED && !o.fullBlock);
  }

  // custo de entrar no tile (chão + objeto); 255 = bloqueado. Sem chão: custo base (a unidade cai)
  function tileTU(m, i) {
    const f = def(m, i, 0);
    const o = objectDef(m, i);
    if (o && (o.tu >= BLOCKED || o.fullBlock)) return BLOCKED;
    const base = f ? f.tu : tune('TU_WALK', 4);
    if (base >= BLOCKED) return BLOCKED;
    return base + (o ? o.tu : 0);
  }

  // parede atravessada por um passo ortogonal a partir de (x,y,z): {def, i, part} ou null
  function crossedWall(m, x, y, z, dir) {
    let wx = x, wy = y, part;
    if (dir === 0) part = 2;
    else if (dir === 2) { wx = x + 1; part = 1; }
    else if (dir === 4) { wy = y + 1; part = 2; }
    else part = 1;
    if (!inB(m, wx, wy, z)) return null;
    const i = idx(m, wx, wy, z);
    const d = def(m, i, part);
    return d ? { def: d, i, part } : null;
  }

  const wallBlocks = {
    move: (d) => d.tu >= BLOCKED,
    los: (d) => !!d.blockLOS,
    smoke: (d) => !!d.smokeBlock,
    fire: (d) => !!(d.blockLOS || d.smokeBlock),
  };
  const KINDS = ['move', 'los', 'smoke', 'fire'];

  function closedDoor(w) {
    return w && w.def.door && !w.def.open ? { i: w.i, part: w.part } : null;
  }

  /* Informação da aresta entre (x,y,z) e o vizinho na direção dir (0..7):
     {to, blocked:{move,los,smoke,fire}, heBlock, door:{i,part}|null, ufoDoor:i|null, wallTU}
     Ortogonal: a parede atravessada (N: norte de (x,y); E: oeste de (x+1,y); S: norte de (x,y+1); W: oeste de (x,y)).
     Diagonal (tabela do DESIGN §9): dois sub-caminhos pelos vizinhos ortogonais; MOVE bloqueia se qualquer parede
     ou objeto de bloco inteiro intermédio bloquear (sem cortar esquinas); LOS/fumo/fogo só se ambos bloquearem.
     door: porta de batente fechada na aresta (só passos ortogonais; o passo abre-a). ufoDoor: destino com porta
     de OVNI fechada. heBlock: soma das paredes atravessadas (+ objeto de bloco inteiro intermédio nas diagonais,
     o mínimo dos dois sub-caminhos); o objeto do destino não conta. wallTU: custo das paredes transponíveis
     atravessadas (média nas diagonais). */
  function edgeInfo(m, x, y, z, dir) {
    const nx = x + DX[dir], ny = y + DY[dir];
    const out = {
      to: -1, blocked: { move: true, los: true, smoke: true, fire: true },
      heBlock: 0, door: null, ufoDoor: null, wallTU: 0,
    };
    if (!inB(m, x, y, z) || !inB(m, nx, ny, z)) return out;
    const to = idx(m, nx, ny, z);
    out.to = to;
    const dst = def(m, to, 3);
    if (dst && dst.door === 'ufo' && !dst.open && !m.ufoDoorOpen[to]) out.ufoDoor = to;
    if ((dir & 1) === 0) {
      const w = crossedWall(m, x, y, z, dir);
      for (const k of KINDS) out.blocked[k] = !!(w && wallBlocks[k](w.def));
      if (w) {
        out.heBlock = w.def.heBlock | 0;
        out.door = closedDoor(w);
        if (w.def.tu < BLOCKED) out.wallTU = w.def.tu;
      }
      return out;
    }
    const a = (dir + 7) & 7, b = (dir + 1) & 7;
    const subs = [[a, b], [b, a]];
    const subBlocked = { move: [false, false], los: [false, false], smoke: [false, false], fire: [false, false] };
    const subHE = [0, 0];
    let tuSum = 0, tuCount = 0, anyMove = false;
    subs.forEach(([first, second], s) => {
      const mx = x + DX[first], my = y + DY[first];
      const walls = [crossedWall(m, x, y, z, first), crossedWall(m, mx, my, z, second)];
      const mid = inB(m, mx, my, z) ? objectDef(m, idx(m, mx, my, z)) : null;
      for (const w of walls) {
        if (!w) continue;
        for (const k of KINDS) if (wallBlocks[k](w.def)) subBlocked[k][s] = true;
        subHE[s] += w.def.heBlock | 0;
        if (w.def.tu < BLOCKED) { tuSum += w.def.tu; tuCount++; } else anyMove = true;
      }
      if (mid && mid.fullBlock) {
        anyMove = true;
        if (mid.blockLOS) subBlocked.los[s] = true;
        if (mid.smokeBlock) subBlocked.smoke[s] = true;
        if (mid.blockLOS || mid.smokeBlock) subBlocked.fire[s] = true;
        subHE[s] += mid.heBlock | 0;
      }
    });
    out.blocked.move = anyMove;
    out.blocked.los = subBlocked.los[0] && subBlocked.los[1];
    out.blocked.smoke = subBlocked.smoke[0] && subBlocked.smoke[1];
    out.blocked.fire = subBlocked.fire[0] && subBlocked.fire[1];
    out.heBlock = Math.min(subHE[0], subHE[1]);
    out.wallTU = tuCount ? U.idiv(tuSum, tuCount) : 0;
    return out;
  }

  // atalho do DESIGN §5.3: kind 'MOVE'|'LOS'|'SMOKE'|'FIRE' → bool; 'HE' → heBlock
  function edgeBlocks(m, x, y, z, dir, kind) {
    const e = edgeInfo(m, x, y, z, dir);
    const k = String(kind).toLowerCase();
    if (k === 'he') return e.heBlock;
    return e.blocked[k] === undefined ? true : e.blocked[k];
  }

  // ligação vertical a partir de i: elevador gravítico g↔g ou escadas s(z)↔S(z+1); voo fica para path.js
  function verticalLink(m, i, up) {
    const plane = m.w * m.h;
    const z = (i / plane) | 0;
    const j = up ? i + plane : i - plane;
    if (up ? z + 1 >= m.d : z <= 0) return null;
    const o = objectDef(m, i), t = objectDef(m, j);
    if (!o || !t) return null;
    if (o.gravlift && t.gravlift) return { to: j, tu: tune('TU_GRAVLIFT', 8), energy: 0, kind: 'gravlift' };
    if (up ? o.stairs === 'foot' && t.stairs === 'head' : o.stairs === 'head' && t.stairs === 'foot') {
      return { to: j, tu: tune('TU_STAIRS', 6), energy: tune('EN_STAIRS', 3), kind: 'stairs' };
    }
    return null;
  }

  // tile onde se aterra ao cair de i (primeiro tile com chão a descer; i se já tiver chão)
  function dropTarget(m, i) {
    const plane = m.w * m.h;
    let j = i;
    while (j >= plane && !hasFloor(m, j)) j -= plane;
    return j;
  }

  OV.BMap = {
    create, idx, xyz, inB, neighbour, def, objectDef, setPart, hasFloor, canStand, tileTU, isFullBlock,
    edgeInfo, edgeBlocks, verticalLink, isUfoDoor, isDoorOpen, ufoDoorGroup, dropTarget, BLOCKED,
  };
})(globalThis.OV || (globalThis.OV = {}));
