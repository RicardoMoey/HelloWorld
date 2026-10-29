/* Linha de vista, luz, campo de visão e traçado de tiros (DESIGN.md §8, §3.11; REA 03 §7). Só inteiros.

   Geometria: tile = 16×16×24 voxels; voxel (vx,vy,vz) = (x·16+lx, y·16+ly, z·24+lz).
     chão: lz < 2 (z0 tem sempre chão); parede oeste lx < 2, norte ly < 2, com lz < altura da parte;
     objeto: tile inteiro se fullBlock, senão 12×12 centrado (candeeiro 4×4), lz < altura (altura 0 e escadas
     não têm caixa); unidade: cilindro (lx−8)²+(ly−8)² ≤ 25 (2×2: raio 12 à volta do centro), 0 ≤ lz < altura
     da postura (de pé / ajoelhado). Olhos a altura−2; amostras do alvo: olhos−2, meio, base+4 (+ meio ±lateral).

   OV.LOS.computeLight(B) → B._.light (Uint8Array(n), 0..15): ambiente 15−shade (de dia −2 sob telhado),
       fontes pontuais (fogo, very-lights no chão, unidades a arder, partes com tileDefs.light) com queda
       power − isqrt(dx²+dy²) em todos os níveis. shadeAt(B,i) = 15 − luz.
   OV.LOS.eyeVoxel(B,u) → [vx,vy,vz] ; originVoxel(B,u,toVoxel) → olho + 4 voxels na direção do alvo (boca da arma)
   OV.LOS.fov(B,u) → {spotted:[ids hostis que o lado de u passou a ver], discovered:[i com bits de descoberta novos]}
       cone de 90°, raio 20; X-COM marca map.disc (tile 7, vizinho leste |2, vizinho sul |4) e B._.visTiles;
       atualiza B._.sees[u.id] (Set) e B._.visible = {xcom,alien,civ} (Sets; B._.visUnits = visible.xcom);
       turnsSinceSpotted = 0 nas unidades hostis vistas.
   OV.LOS.canSee(B, viewer, target) → bool (sem cone): alcance, escuridão (X-COM, dist > 9, shade > 9), linha de
       tiles (paredes, blocos inteiros, chãos, fumo) e amostras de altura em voxels (cobertura parcial).
   OV.LOS.inCone(B, viewer, target) ; inView(B, viewer, target) = inCone && canSee ; spotters(B, target, side?) → [ids]
   OV.LOS.canSeeFrom(B, viewer, i, target) → canSee como se o observador estivesse no tile i (sem cone)
   OV.LOS.refreshAll(B) → {spotted:{xcom,alien,civ}, discovered} (luz se mudou, FOV de todas as unidades conscientes)
   OV.LOS.refreshTarget(B, t) → {seenBy:[ids], newlyVisibleTo:[lados]} (quem vê t agora; depois de t se mexer/morrer)
   OV.LOS.unitMoved(B, u) → {spotted, discovered, seenBy, newlyVisibleTo} = fov + refreshTarget
   OV.LOS.resetSide(B, side) — esconde de novo as unidades vistas pelo lado (início de turno; seguir de refreshAll)
   OV.LOS.traceShot(B, from, to, ignore, maxTiles) → {kind:'unit'|'floor'|'west'|'north'|'object'|'none'|'out',
       i, part, unitId, voxel}  Bresenham 3-D de voxel em voxel; maxTiles > 0 ⇒ continua para lá de `to` até
       maxTiles·16 voxels no eixo dominante (também corta aí); sem maxTiles pára em `to`. ignore: id | [ids] | Set.
   OV.LOS.targetVoxel(B, shooter, unidade|tile) → voxel | null (1.ª de 5 amostras com linha de tiro livre)
   OV.LOS.lineClear(B, from, to, ignoreIds) → bool ; unitsVisibleTo(B, side, hostileOnly?) → [ids] ordenados
   OV.LOS.isVisibleTo(B, side, u) → bool (amigos sempre) ; edgeLOS(B,x,y,z,dir) ≡ BMap.edgeInfo(...).blocked.los */
(function (OV) {
  'use strict';

  const U = OV.U;
  const DX = U.DX, DY = U.DY;
  const LIVE = { ok: 1, panic: 1 };
  const SIDES = ['xcom', 'alien', 'civ'];
  const VX = 16, VZ = 24;
  const tune = (k, def) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : def);

  // arredondamento simétrico de a/b (b > 0): metade afasta-se do zero
  const rdiv = (a, b) => (a >= 0 ? U.idiv(2 * a + b, 2 * b) : -U.idiv(-2 * a + b, 2 * b));
  const alive = (u) => !!u && u.onMap === true && LIVE[u.status] === 1 && u.x >= 0;
  const hostile = (a, b) => (a === 'alien') !== (b === 'alien');
  const stanceHeight = (u) => Math.max(1, (u.kneel ? u.kneelHeight : u.height) | 0);

  // ---- tabelas por id de definição (tileDefs é imutável depois do finalize) ----------------------------
  const W_LOS = 1, W_SHOT = 2, O_FULL = 4, O_LOS = 8, O_UFO = 16, O_SLIM = 32, O_NOBOX = 64;
  let TB = null;
  function tables() {
    const defs = OV.Data.tileDefs;
    if (TB && TB.defs === defs && TB.len === defs.length) return TB;
    const len = defs.length;
    const fl = new Uint8Array(len), hg = new Uint8Array(len), alt = new Uint16Array(len), light = new Uint8Array(len);
    for (let id = 1; id < len; id++) {
      const d = defs[id];
      if (!d) continue;
      let f = 0;
      if (d.part === 'west' || d.part === 'north') {
        if (d.blockLOS) f |= W_LOS;
        if (d.blockLOS || (d.tu | 0) >= 255) f |= W_SHOT;
      } else if (d.part === 'object') {
        if (d.fullBlock) f |= O_FULL;
        if (d.fullBlock && d.blockLOS) f |= O_LOS;
        if (d.door === 'ufo' && !d.open) f |= O_UFO;
        if (d.role === 'lamp') f |= O_SLIM;
        if (d.stairs || d.gravlift) f |= O_NOBOX;
      }
      fl[id] = f;
      hg[id] = U.clamp(d.height | 0, 0, VZ);
      alt[id] = d.alt | 0;
      light[id] = U.clamp(d.light | 0, 0, 15);
    }
    TB = { defs, len, fl, hg, alt, light };
    return TB;
  }

  // raiz inteira para a queda da luz (|dx|,|dy| ≤ 15)
  const ISQ = new Uint8Array(2 * 15 * 15 + 1);
  for (let k = 0; k < ISQ.length; k++) ISQ[k] = U.isqrt(k);

  // ---- buffers de trabalho por tamanho de mapa (carimbos de geração) --------------------------------------
  const SCR = new Map();
  function scratch(n, plane) {
    let S = SCR.get(n);
    if (!S || S.plane !== plane) {
      if (SCR.size >= 4) SCR.clear();
      S = { n, plane, gen: 0, stamp: new Int32Array(n), list: new Int32Array(n), dgen: 0, dstamp: new Int32Array(n),
        col: new Uint8Array(plane), colPow: new Uint8Array(plane) };
      SCR.set(n, S);
    }
    return S;
  }
  function nextGen(S) {
    if (++S.gen >= 0x3fffffff) { S.gen = 1; S.stamp.fill(0); }
    return S.gen;
  }
  function nextDGen(S) {
    if (++S.dgen >= 0x3fffffff) { S.dgen = 1; S.dstamp.fill(0); }
    return S.dgen;
  }

  // ---- estado derivado em B._ ------------------------------------------------------------------------------
  function state(B) {
    if (!B._ && OV.Battle && OV.Battle.rebuildDerived) OV.Battle.rebuildDerived(B);
    const _ = B._;
    const n = B.map.n;
    if (!_.caches) _.caches = {};
    let st = _.caches.los;
    if (!st || st.n !== n || st.parts !== B.map.parts) {
      st = _.caches.los = { n, parts: B.map.parts, lightOK: false, lightSig: 0, seenTiles: {} };
    }
    if (!_.dirty) _.dirty = { light: true, los: true, path: true };
    if (!_.sees) _.sees = {};
    if (!_.visible) _.visible = { xcom: new Set(), alien: new Set(), civ: new Set() };
    for (const s of SIDES) if (!_.visible[s]) _.visible[s] = new Set();
    _.visUnits = _.visible.xcom;
    if (!_.light || _.light.length !== n) { _.light = new Uint8Array(n); st.lightOK = false; }
    if (!_.visTiles || _.visTiles.length !== n) _.visTiles = new Uint8Array(n);
    return st;
  }

  function ctx(B) {
    const m = B.map, T = tables();
    return {
      B, m, fl: T.fl, hg: T.hg, alt: T.alt, parts: m.parts, uo: m.ufoDoorOpen, smoke: m.smoke, fire: m.fire,
      w: m.w, h: m.h, d: m.d, plane: m.w * m.h, ceiling: !!m.ceiling, light: B._.light,
      unitAt: B._.unitAt, budget: tune('SMOKE_SIGHT_BUDGET', 60),
    };
  }

  const findUnit = (B, id) => (B._ && B._.unitById && B._.unitById.get(id)) || (OV.BUnits ? OV.BUnits.findUnit(B, id) : null);

  // ---- consultas de partes ----------------------------------------------------------------------------------
  // objeto efetivo (porta de OVNI aberta ⇒ definição alternativa)
  function objAt(c, i) {
    const o = c.parts[i * 4 + 3];
    return o && (c.fl[o] & O_UFO) && c.uo[i] ? c.alt[o] : o;
  }
  const wallN = (c, x, y, z) => y < c.h && (c.fl[c.parts[((z * c.h + y) * c.w + x) * 4 + 2]] & W_LOS) !== 0;
  const wallW = (c, x, y, z) => x < c.w && (c.fl[c.parts[((z * c.h + y) * c.w + x) * 4 + 1]] & W_LOS) !== 0;
  const fullLOS = (c, x, y, z) => (c.fl[objAt(c, (z * c.h + y) * c.w + x)] & O_LOS) !== 0;
  // atravessar o chão do nível zu na coluna (x,y); com teto (base alienígena) nunca se muda de nível
  const vBlock = (c, x, y, zu) => c.ceiling || c.parts[((zu * c.h + y) * c.w + x) * 4] !== 0;

  // aresta horizontal (dx,dy ∈ −1..1) no nível z, semântica de BMap.edgeInfo para LOS: ortogonal = parede
  // atravessada; diagonal = bloqueia só se os dois sub-caminhos (paredes + bloco inteiro intermédio) bloquearem
  function hBlock(c, x, y, z, dx, dy) {
    if (dx === 0) return dy < 0 ? wallN(c, x, y, z) : wallN(c, x, y + 1, z);
    if (dy === 0) return dx < 0 ? wallW(c, x, y, z) : wallW(c, x + 1, y, z);
    const viaX = (dx < 0 ? wallW(c, x, y, z) : wallW(c, x + 1, y, z))
      || (dy < 0 ? wallN(c, x + dx, y, z) : wallN(c, x + dx, y + 1, z)) || fullLOS(c, x + dx, y, z);
    if (!viaX) return false;
    return (dy < 0 ? wallN(c, x, y, z) : wallN(c, x, y + 1, z))
      || (dx < 0 ? wallW(c, x, y + dy, z) : wallW(c, x + 1, y + dy, z)) || fullLOS(c, x, y + dy, z);
  }

  // passo da linha de tiles (o)→(n); com mudança de nível e de coluna: dois sub-caminhos (horizontal primeiro
  // ou vertical primeiro), bloqueia só se ambos bloquearem
  function stepBlocked(c, ox, oy, oz, nx, ny, nz) {
    const dx = nx - ox, dy = ny - oy;
    if (nz === oz) return hBlock(c, ox, oy, oz, dx, dy);
    const zu = nz > oz ? nz : oz;
    if (dx === 0 && dy === 0) return vBlock(c, ox, oy, zu);
    if (!(hBlock(c, ox, oy, oz, dx, dy) || fullLOS(c, nx, ny, oz) || vBlock(c, nx, ny, zu))) return false;
    return vBlock(c, ox, oy, zu) || fullLOS(c, ox, oy, nz) || hBlock(c, ox, oy, nz, dx, dy);
  }

  // caixa de um objeto (não fullBlock incluído) no voxel local
  function boxHit(c, o, lx, ly, lz) {
    const f = c.fl[o];
    const hh = c.hg[o];
    if (!hh || (f & O_NOBOX) || lz >= hh) return false;
    if (f & O_FULL) return true;
    if (f & O_SLIM) return lx >= 6 && lx <= 9 && ly >= 6 && ly <= 9;
    return lx >= 2 && lx <= 13 && ly >= 2 && ly <= 13;
  }

  // linha de tiles até ao alvo: paredes, blocos inteiros (exceto o alvo), chãos e orçamento de fumo (×3)
  function tileLineClear(c, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    let px = x0, py = y0, pz = z0, cost = 0;
    for (let k = 1; k <= N; k++) {
      const x = x0 + rdiv(dx * k, N), y = y0 + rdiv(dy * k, N), z = z0 + rdiv(dz * k, N);
      if (stepBlocked(c, px, py, pz, x, y, z)) return false;
      const i = (z * c.h + y) * c.w + x;
      if (k < N && (c.fl[objAt(c, i)] & O_LOS)) return false;
      cost += 3 + (c.fire[i] ? 0 : c.smoke[i]);
      if (cost > c.budget) return false;
      px = x; py = y; pz = z;
    }
    return true;
  }

  // ---- olhos e cone -----------------------------------------------------------------------------------------
  const centreOff = (u) => (u.size > 1 ? VX : VX >> 1);
  function eyeVoxel(B, u) {
    const eh = OV.BUnits ? OV.BUnits.eyeHeight(u) : stanceHeight(u) - 2;
    return [u.x * VX + centreOff(u), u.y * VX + centreOff(u), u.z * VZ + U.clamp(eh | 0, 1, VZ - 1)];
  }
  // boca da arma: 4 voxels do olho na direção (plana) do alvo
  function originVoxel(B, u, to) {
    const e = eyeVoxel(B, u);
    const dx = to[0] - e[0], dy = to[1] - e[1];
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (!m) return e;
    return [e[0] + rdiv(4 * dx, m), e[1] + rdiv(4 * dy, m), e[2]];
  }

  // 90°: direção cardeal ⇒ |lateral| ≤ frente; diagonal ⇒ quadrante
  function coneOK(dir, dx, dy) {
    const fx = DX[dir & 7], fy = DY[dir & 7];
    if (dir & 1) return dx * fx >= 0 && dy * fy >= 0;
    const fwd = dx * fx + dy * fy;
    const lat = Math.abs(dx * fy - dy * fx);
    return lat <= fwd;
  }

  /* núcleo de canSee: v vê t? needCone ⇒ só tiles de t dentro do cone. ox/oy/oz substituem a posição do
     observador (canSeeFrom). Por tile de t: alcance, cone, escuridão, linha de tiles; depois amostras de voxels. */
  function canSeeCore(c, v, t, needCone, pos) {
    const vx0 = pos ? pos[0] : v.x, vy0 = pos ? pos[1] : v.y, vz0 = pos ? pos[2] : v.z;
    const off = centreOff(v);
    const ex = vx0 * VX + off, ey = vy0 * VX + off;
    const eh = OV.BUnits ? OV.BUnits.eyeHeight(v) : stanceHeight(v) - 2;
    const ez = vz0 * VZ + U.clamp(eh | 0, 1, VZ - 1);
    const etx = ex >> 4, ety = ey >> 4;
    if (c.ceiling && t.z !== vz0) return false;
    const R = tune('VIEW_DIST', 20) * VX, NV = tune('NIGHT_VIEW', 9) * VX, DARK = tune('DARK_SHADE', 9);
    const xcom = v.side === 'xcom';
    const size = t.size > 1 ? t.size : 1;
    let gate = false;
    for (let oy = 0; oy < size && !gate; oy++) {
      for (let ox = 0; ox < size && !gate; ox++) {
        const tx = t.x + ox, ty = t.y + oy;
        const ddx = tx * VX + 8 - ex, ddy = ty * VX + 8 - ey;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > R * R) continue;
        if (needCone && !coneOK(v.dir | 0, ddx, ddy)) continue;
        const ti = (t.z * c.h + ty) * c.w + tx;
        if (xcom && d2 > NV * NV && 15 - c.light[ti] > DARK) continue;
        if (tileLineClear(c, etx, ety, vz0, tx, ty, t.z)) gate = true;
      }
    }
    if (!gate) return false;
    return samplesVisible(c, v, t, ex, ey, ez, vx0, vy0, vz0);
  }

  // alturas das amostras (topo = olhos = altura−2): {topo−2, meio, base+4}
  function sampleHeights(u) {
    const h = stanceHeight(u);
    return [U.clamp(h - 4, 1, VZ - 1), U.clamp(h >> 1, 1, VZ - 1), U.clamp(4, 1, Math.max(1, h - 1))];
  }

  // amostras de altura + meio ±lateral; qualquer uma livre ⇒ visível
  function samplesVisible(c, v, t, ex, ey, ez, vx0, vy0, vz0) {
    const base = t.z * VZ;
    const off = centreOff(t);
    const cx = t.x * VX + off, cy = t.y * VX + off;
    const [top, mid, bot] = sampleHeights(t);
    const lat = t.size > 1 ? 8 : 4;
    const alongX = Math.abs(cx - ex) >= Math.abs(cy - ey);
    const vs = v.size > 1 ? v.size : 1;
    if (sightClear(c, ex, ey, ez, cx, cy, base + top, vx0, vy0, vz0, vs)) return true;
    if (sightClear(c, ex, ey, ez, cx, cy, base + mid, vx0, vy0, vz0, vs)) return true;
    if (sightClear(c, ex, ey, ez, cx, cy, base + bot, vx0, vy0, vz0, vs)) return true;
    if (alongX) {
      if (sightClear(c, ex, ey, ez, cx, cy + lat, base + mid, vx0, vy0, vz0, vs)) return true;
      return sightClear(c, ex, ey, ez, cx, cy - lat, base + mid, vx0, vy0, vz0, vs);
    }
    if (sightClear(c, ex, ey, ez, cx + lat, cy, base + mid, vx0, vy0, vz0, vs)) return true;
    return sightClear(c, ex, ey, ez, cx - lat, cy, base + mid, vx0, vy0, vz0, vs);
  }

  /* traço de vista em voxels, passo ≤ 4: chãos atravessados (ponto exato de passagem do nível) e caixas de
     objetos parciais (caixotes, sebes, consolas…). Paredes e blocos inteiros já foram decididos pela linha de
     tiles (regra das arestas/diagonais); os tiles do observador não contam. */
  function sightClear(c, ax, ay, az, bx, by, bz, vx0, vy0, vz0, vs) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (!N) return true;
    const K = (N + 3) >> 2;
    const W = c.w * VX, H = c.h * VX, DZ = c.d * VZ;
    let px = ax, py = ay, pz = az, ptz = (az / VZ) | 0;
    for (let j = 1; j <= K; j++) {
      const qx = ax + rdiv(dx * j, K), qy = ay + rdiv(dy * j, K), qz = az + rdiv(dz * j, K);
      if (qx < 0 || qy < 0 || qz < 0 || qx >= W || qy >= H || qz >= DZ) return false;
      const qtx = qx >> 4, qty = qy >> 4, qtz = (qz / VZ) | 0;
      if (qtz !== ptz) {
        const zu = qtz > ptz ? qtz : ptz;
        const bzv = zu * VZ;
        const cxv = px + U.idiv((qx - px) * (bzv - pz), qz - pz);
        const cyv = py + U.idiv((qy - py) * (bzv - pz), qz - pz);
        if (vBlock(c, U.clamp(cxv >> 4, 0, c.w - 1), U.clamp(cyv >> 4, 0, c.h - 1), zu)) return false;
      }
      if (!(qtz === vz0 && qtx >= vx0 && qtx < vx0 + vs && qty >= vy0 && qty < vy0 + vs)) {
        const o = objAt(c, (qtz * c.h + qty) * c.w + qtx);
        if (o && !(c.fl[o] & O_FULL) && boxHit(c, o, qx & 15, qy & 15, qz - qtz * VZ)) return false;
      }
      px = qx; py = qy; pz = qz; ptz = qtz;
    }
    return true;
  }

  // ---- luz --------------------------------------------------------------------------------------------------
  const shadeOf = (B) => U.clamp((typeof B.shade === 'number' ? B.shade : B.mission && typeof B.mission.shade === 'number' ? B.mission.shade : 0) | 0, 0, 15);

  // assinatura das fontes dinâmicas (fogo, very-lights no chão, unidades a arder) — deteta mudanças sem dirty
  function dynamicSig(B) {
    const m = B.map, fire = m.fire, n = m.n;
    let h = Math.imul(2166136261 ^ shadeOf(B), 16777619);
    for (let i = 0; i < n; i++) if (fire[i]) h = Math.imul(h ^ i, 16777619);
    const items = OV.Data.items;
    for (const it of B.items || []) {
      if (it.at === null || it.at === undefined || it.owner !== null) continue;
      const def = items[it.type];
      if (def && def.light) h = Math.imul(Math.imul(h ^ it.at, 16777619) ^ def.light, 16777619);
    }
    for (const u of B.units || []) if (u.burn > 0 && u.onMap && u.x >= 0) h = Math.imul(Math.imul(h ^ u.id, 16777619) ^ ((u.z * m.h + u.y) * m.w + u.x), 16777619);
    return h >>> 0;
  }

  function computeLight(B) {
    const st = state(B);
    const m = B.map, n = m.n, w = m.w, hgt = m.h, plane = w * hgt;
    const T = tables();
    const S = scratch(n, plane);
    const L = B._.light;
    const shade = shadeOf(B);
    const amb = U.clamp(15 - shade, 0, 15);
    const roofDark = shade <= 4 ? tune('ROOF_DAY_DARKEN', 2) : 0;
    // potência máxima por coluna (todas as fontes iluminam todos os níveis)
    const pow = S.colPow;
    pow.fill(0);
    const put = (i, p) => {
      const j = i % plane;
      if (p > pow[j]) pow[j] = p > 15 ? 15 : p;
    };
    const parts = m.parts, uo = m.ufoDoorOpen, fire = m.fire;
    const LF = tune('LIGHT_FIRE', 15);
    for (let i = 0; i < n; i++) {
      if (fire[i]) put(i, LF);
      for (let p = 0; p < 4; p++) {
        let id = parts[i * 4 + p];
        if (!id) continue;
        if (p === 3 && (T.fl[id] & O_UFO) && uo[i]) id = T.alt[id];
        if (T.light[id]) put(i, T.light[id]);
      }
    }
    const items = OV.Data.items;
    for (const it of B.items || []) {
      if (it.at === null || it.at === undefined || it.owner !== null || it.at < 0 || it.at >= n) continue;
      const def = items[it.type];
      if (def && def.light) put(it.at, def.light | 0);
    }
    const LB = tune('LIGHT_BURNING_UNIT', 15);
    for (const u of B.units || []) if (u.burn > 0 && u.onMap && u.x >= 0) put((u.z * hgt + u.y) * w + u.x, LB);
    // queda inteira power − isqrt(dx²+dy²)
    const col = S.col;
    col.fill(0);
    for (let j = 0; j < plane; j++) {
      const p = pow[j];
      if (!p) continue;
      const sx = j % w, sy = (j / w) | 0;
      const y0 = Math.max(0, sy - p), y1 = Math.min(hgt - 1, sy + p), x0 = Math.max(0, sx - p), x1 = Math.min(w - 1, sx + p);
      for (let y = y0; y <= y1; y++) {
        const dy2 = (y - sy) * (y - sy);
        for (let x = x0; x <= x1; x++) {
          const v = p - ISQ[(x - sx) * (x - sx) + dy2];
          const k = y * w + x;
          if (v > col[k]) col[k] = v;
        }
      }
    }
    // ambiente por coluna, de cima para baixo (telhado = chão ou bloco inteiro num nível acima)
    for (let j = 0; j < plane; j++) {
      let covered = !!m.ceiling;
      for (let z = m.d - 1; z >= 0; z--) {
        const i = z * plane + j;
        const base = covered ? Math.max(0, amb - roofDark) : amb;
        L[i] = base > col[j] ? base : col[j];
        if ((z > 0 && parts[i * 4]) || (T.fl[parts[i * 4 + 3]] & O_FULL)) covered = true;
      }
    }
    st.lightOK = true;
    st.lightSig = dynamicSig(B);
    B._.dirty.light = false;
    return L;
  }

  function ensureLight(B, st) {
    if (!st.lightOK || B._.dirty.light || st.lightSig !== dynamicSig(B)) computeLight(B);
  }

  function shadeAt(B, i) {
    const st = state(B);
    if (!st.lightOK || B._.dirty.light) computeLight(B);
    return 15 - B._.light[i];
  }

  // ---- campo de visão ---------------------------------------------------------------------------------------
  // tiles vistos por um observador X-COM (linhas de tiles até cada candidato do cone, todos os níveis)
  function traceTiles(c, S, u) {
    const gen = nextGen(S);
    const stamp = S.stamp, list = S.list;
    let len = 0;
    const ex = (u.x * VX + centreOff(u)) >> 4, ey = (u.y * VX + centreOff(u)) >> 4, ez = u.z;
    const R = tune('VIEW_DIST', 20), R2 = R * R;
    const w = c.w, h = c.h, plane = c.plane;
    const dir = u.dir | 0;
    const z0 = c.ceiling ? ez : 0, z1 = c.ceiling ? ez : c.d - 1;
    const i0 = (ez * h + ey) * w + ex;
    stamp[i0] = gen;
    list[len++] = i0;
    for (let dy = -R; dy <= R; dy++) {
      const cy = ey + dy;
      if (cy < 0 || cy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const cx = ex + dx;
        if (cx < 0 || cx >= w || dx * dx + dy * dy > R2 || !coneOK(dir, dx, dy)) continue;
        for (let cz = z0; cz <= z1; cz++) {
          const dz = cz - ez;
          const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
          let px = ex, py = ey, pz = ez, cost = 0;
          for (let k = 1; k <= N; k++) {
            const x = ex + rdiv(dx * k, N), y = ey + rdiv(dy * k, N), z = ez + rdiv(dz * k, N);
            if (stepBlocked(c, px, py, pz, x, y, z)) break;
            const i = z * plane + y * w + x;
            if (k < N && (c.fl[objAt(c, i)] & O_LOS)) break;
            cost += 3 + (c.fire[i] ? 0 : c.smoke[i]);
            if (cost > c.budget) break;
            if (stamp[i] !== gen) { stamp[i] = gen; list[len++] = i; }
            px = x; py = y; pz = z;
          }
        }
      }
    }
    return list.slice(0, len);
  }

  // descoberta (bits de map.disc) dos tiles vistos; devolve os índices alterados
  function discover(c, S, tiles, out) {
    const disc = c.m.disc, w = c.w, h = c.h, plane = c.plane;
    const g = S.dgen;
    const touch = (i, bits) => {
      const old = disc[i];
      if ((old | bits) !== old) {
        disc[i] = old | bits;
        if (S.dstamp[i] !== g) { S.dstamp[i] = g; out.push(i); }
      }
    };
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k];
      const r = i % plane, x = r % w, y = (r / w) | 0;
      touch(i, 7);
      if (x + 1 < w) touch(i + 1, 2);
      if (y + 1 < h) touch(i + w, 4);
    }
  }

  function computeSees(c, B, u) {
    const out = new Set();
    for (const t of B.units) {
      if (t === u || t.side === u.side || !alive(t)) continue;
      if (canSeeCore(c, u, t, true, null)) out.add(t.id);
    }
    return out;
  }

  function rebuildUnion(B, side) {
    const set = B._.visible[side];
    set.clear();
    for (const u of B.units) {
      if (u.side !== side || !alive(u)) continue;
      const s = B._.sees[u.id];
      if (!s) continue;
      for (const id of s) {
        const t = findUnit(B, id);
        if (t && alive(t) && t.side !== side) set.add(id);
      }
    }
  }

  function rebuildVisTiles(B, st) {
    const vt = B._.visTiles;
    vt.fill(0);
    for (const u of B.units) {
      if (u.side !== 'xcom' || !alive(u)) continue;
      const L = st.seenTiles[u.id];
      if (L) for (let k = 0; k < L.length; k++) vt[L[k]] = 1;
    }
  }

  function markSpotted(B, viewer, ids) {
    for (const id of ids) {
      const t = findUnit(B, id);
      if (t && hostile(viewer.side, t.side)) t.turnsSinceSpotted = 0;
    }
  }

  function fov(B, u) {
    const st = state(B);
    ensureLight(B, st);
    const c = ctx(B);
    const S = scratch(c.m.n, c.plane);
    if (!alive(u)) {
      delete B._.sees[u.id];
      delete st.seenTiles[u.id];
      rebuildUnion(B, u.side);
      if (u.side === 'xcom') rebuildVisTiles(B, st);
      return { spotted: [], discovered: [] };
    }
    const discovered = [];
    if (u.side === 'xcom') {
      const tiles = traceTiles(c, S, u);
      st.seenTiles[u.id] = tiles;
      nextDGen(S);
      discover(c, S, tiles, discovered);
      discovered.sort((a, b) => a - b);
      rebuildVisTiles(B, st);
    }
    const before = B._.visible[u.side];
    const sees = computeSees(c, B, u);
    const spotted = [];
    for (const id of sees) {
      const t = findUnit(B, id);
      if (t && hostile(u.side, t.side) && !before.has(id)) spotted.push(id);
    }
    spotted.sort((a, b) => a - b);
    B._.sees[u.id] = sees;
    rebuildUnion(B, u.side);
    markSpotted(B, u, sees);
    return { spotted, discovered };
  }

  function refreshAll(B) {
    const st = state(B);
    ensureLight(B, st);
    const c = ctx(B);
    const S = scratch(c.m.n, c.plane);
    const before = {};
    for (const s of SIDES) before[s] = new Set(B._.visible[s]);
    for (const k of Object.keys(B._.sees)) if (!alive(findUnit(B, +k))) delete B._.sees[k];
    for (const k of Object.keys(st.seenTiles)) if (!alive(findUnit(B, +k))) delete st.seenTiles[k];
    const discovered = [];
    nextDGen(S);
    for (const u of B.units) {
      if (!alive(u)) continue;
      if (u.side === 'xcom') {
        const tiles = traceTiles(c, S, u);
        st.seenTiles[u.id] = tiles;
        discover(c, S, tiles, discovered);
      }
      B._.sees[u.id] = computeSees(c, B, u);
    }
    discovered.sort((a, b) => a - b);
    for (const s of SIDES) rebuildUnion(B, s);
    rebuildVisTiles(B, st);
    const spotted = {};
    for (const s of SIDES) {
      spotted[s] = [];
      for (const id of B._.visible[s]) {
        const t = findUnit(B, id);
        if (t && hostile(s, t.side) && !before[s].has(id)) spotted[s].push(id);
      }
      spotted[s].sort((a, b) => a - b);
    }
    for (const u of B.units) if (alive(u) && B._.sees[u.id]) markSpotted(B, u, B._.sees[u.id]);
    B._.dirty.los = false;
    return { spotted, discovered };
  }

  // quem vê t agora (depois de t se mexer, ajoelhar, morrer…); atualiza B._.sees e as uniões
  function refreshTarget(B, t) {
    const st = state(B);
    ensureLight(B, st);
    const c = ctx(B);
    const was = {};
    for (const s of SIDES) was[s] = B._.visible[s].has(t.id);
    const seenBy = [];
    const tAlive = alive(t);
    for (const v of B.units) {
      if (v === t || v.side === t.side || !alive(v)) continue;
      let s = B._.sees[v.id];
      if (!s) { s = new Set(); B._.sees[v.id] = s; }
      if (tAlive && canSeeCore(c, v, t, true, null)) {
        s.add(t.id);
        seenBy.push(v.id);
        if (hostile(v.side, t.side)) t.turnsSinceSpotted = 0;
      } else s.delete(t.id);
    }
    for (const s of SIDES) if (s !== t.side) rebuildUnion(B, s);
    const newlyVisibleTo = SIDES.filter((s) => s !== t.side && !was[s] && B._.visible[s].has(t.id));
    return { seenBy, newlyVisibleTo };
  }

  function unitMoved(B, u) {
    const a = fov(B, u);
    const b = refreshTarget(B, u);
    return { spotted: a.spotted, discovered: a.discovered, seenBy: b.seenBy, newlyVisibleTo: b.newlyVisibleTo };
  }

  // volta a esconder as unidades vistas pelo lado (o chamador recalcula depois com refreshAll)
  function resetSide(B, side) {
    state(B);
    for (const u of B.units) if (u.side === side && B._.sees[u.id]) B._.sees[u.id] = new Set();
    B._.visible[side].clear();
  }

  // ---- consultas públicas de visibilidade -------------------------------------------------------------------
  function canSee(B, viewer, target) {
    if (!alive(viewer) || !alive(target)) return false;
    if (viewer.side === target.side) return true;
    const st = state(B);
    ensureLight(B, st);
    return canSeeCore(ctx(B), viewer, target, false, null);
  }

  function canSeeFrom(B, viewer, i, target) {
    if (!alive(target) || i < 0 || i >= B.map.n) return false;
    if (viewer.side === target.side) return true;
    const st = state(B);
    ensureLight(B, st);
    return canSeeCore(ctx(B), viewer, target, false, OV.BMap.xyz(B.map, i));
  }

  function inCone(B, viewer, target) {
    if (!viewer || !target || target.x < 0) return false;
    const off = centreOff(viewer);
    const ex = viewer.x * VX + off, ey = viewer.y * VX + off;
    const R = tune('VIEW_DIST', 20) * VX;
    const size = target.size > 1 ? target.size : 1;
    for (let oy = 0; oy < size; oy++) {
      for (let ox = 0; ox < size; ox++) {
        const ddx = (target.x + ox) * VX + 8 - ex, ddy = (target.y + oy) * VX + 8 - ey;
        if (ddx * ddx + ddy * ddy <= R * R && coneOK(viewer.dir | 0, ddx, ddy)) return true;
      }
    }
    return false;
  }

  function inView(B, viewer, target) {
    if (!alive(viewer) || !alive(target)) return false;
    const st = state(B);
    ensureLight(B, st);
    return canSeeCore(ctx(B), viewer, target, true, null);
  }

  // observadores (de outro lado, ou do lado indicado) com t no cone e à vista
  function spotters(B, target, side) {
    if (!alive(target)) return [];
    const st = state(B);
    ensureLight(B, st);
    const c = ctx(B);
    const out = [];
    for (const v of B.units) {
      if (v === target || !alive(v) || v.side === target.side || (side && v.side !== side)) continue;
      if (canSeeCore(c, v, target, true, null)) out.push(v.id);
    }
    return out;
  }

  function isVisibleTo(B, side, u) {
    if (!u) return false;
    if (u.side === side) return true;
    if (!B._ || !B._.visible || !B._.visible[side]) return false;
    return alive(u) && B._.visible[side].has(u.id);
  }

  function unitsVisibleTo(B, side, hostileOnly) {
    state(B);
    const out = [];
    for (const id of B._.visible[side] || []) {
      const t = findUnit(B, id);
      if (!t || !alive(t) || (hostileOnly && !hostile(side, t.side))) continue;
      out.push(id);
    }
    return out.sort((a, b) => a - b);
  }

  // aresta de LOS rápida (mesma semântica de BMap.edgeInfo(...).blocked.los)
  function edgeLOS(B, x, y, z, dir) {
    const m = B.map || B;
    const nx = x + DX[dir], ny = y + DY[dir];
    if (!OV.BMap.inB(m, x, y, z) || !OV.BMap.inB(m, nx, ny, z)) return true;
    const T = tables();
    const c = { fl: T.fl, alt: T.alt, parts: m.parts, uo: m.ufoDoorOpen, w: m.w, h: m.h };
    return hBlock(c, x, y, z, DX[dir], DY[dir]);
  }

  // ---- traçado de tiros (voxel a voxel) ---------------------------------------------------------------------
  function ignoreFn(ignore) {
    if (ignore === null || ignore === undefined) return null;
    if (typeof ignore === 'number') return (id) => id === ignore;
    if (ignore instanceof Set) return (id) => ignore.has(id);
    if (Array.isArray(ignore)) return (id) => ignore.indexOf(id) >= 0;
    return null;
  }

  function traceShot(B, from, to, ignoreUnitId, maxTiles) {
    state(B);
    const c = ctx(B);
    const ign = ignoreFn(ignoreUnitId);
    const W = c.w * VX, H = c.h * VX, DZ = (c.ceiling ? 1 : c.d) * VZ;
    const fx = from[0] | 0, fy = from[1] | 0, fz = from[2] | 0;
    const dx = (to[0] | 0) - fx, dy = (to[1] | 0) - fy, dz = (to[2] | 0) - fz;
    const N = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const inMap = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < DZ;
    const tileOf = (x, y, z) => (((z / VZ) | 0) * c.h + (y >> 4)) * c.w + (x >> 4);
    let lx0 = fx, ly0 = fy, lz0 = fz;
    let lastI = inMap(fx, fy, fz) ? tileOf(fx, fy, fz) : -1;
    const originTile = lastI;
    const res = (kind, i, part, unitId, x, y, z) => ({ kind, i, part, unitId, voxel: [x, y, z] });
    if (!N) return res('none', lastI, null, null, fx, fy, fz);
    const K = maxTiles > 0 ? maxTiles * VX : N;
    const ua = c.unitAt;
    for (let k = 1; k <= K; k++) {
      const vx = fx + rdiv(dx * k, N), vy = fy + rdiv(dy * k, N), vz = fz + rdiv(dz * k, N);
      if (vz < 0 && vx >= 0 && vy >= 0 && vx < W && vy < H) {
        return res('floor', (vy >> 4) * c.w + (vx >> 4), 0, null, vx, vy, 0);
      }
      if (!inMap(vx, vy, vz)) return res('out', lastI, null, null, lx0, ly0, lz0);
      const tz = (vz / VZ) | 0, tx = vx >> 4, ty = vy >> 4;
      const lx = vx & 15, ly = vy & 15, lz = vz - tz * VZ;
      const i = (tz * c.h + ty) * c.w + tx;
      const p4 = i * 4;
      if (lz < 2 && (tz === 0 || c.parts[p4] !== 0)) return res('floor', i, 0, null, vx, vy, vz);
      if (lx < 2) {
        const wd = c.parts[p4 + 1];
        if (wd && (c.fl[wd] & W_SHOT) && lz < c.hg[wd]) return res('west', i, 1, null, vx, vy, vz);
      }
      if (ly < 2) {
        const wd = c.parts[p4 + 2];
        if (wd && (c.fl[wd] & W_SHOT) && lz < c.hg[wd]) return res('north', i, 2, null, vx, vy, vz);
      }
      if (i !== originTile) {
        const o = objAt(c, i);
        if (o && boxHit(c, o, lx, ly, lz)) return res('object', i, 3, null, vx, vy, vz);
      }
      const a = ua ? ua[i] : 0;
      if (a) {
        const id = a - 1;
        if (!ign || !ign(id)) {
          const u = findUnit(B, id);
          if (u && u.z === tz) {
            const big = u.size > 1;
            const ox = vx - (u.x * VX + (big ? VX : 8)), oy = vy - (u.y * VX + (big ? VX : 8));
            const r = big ? 12 : 5;
            if (ox * ox + oy * oy <= r * r && lz < stanceHeight(u)) return res('unit', i, null, id, vx, vy, vz);
          }
        }
      }
      lx0 = vx; ly0 = vy; lz0 = vz; lastI = i;
    }
    return res('none', lastI, null, null, lx0, ly0, lz0);
  }

  function lineClear(B, from, to, ignoreIds) {
    return traceShot(B, from, to, ignoreIds, 0).kind === 'none';
  }

  // linha de tiro: 1.ª amostra do alvo alcançável sem acertar noutra coisa (unidade: meio, topo, base, ±lateral;
  // tile: unidade lá, objeto, chão, meio do tile, paredes)
  function targetVoxel(B, shooter, target) {
    state(B);
    const m = B.map;
    const eye = eyeVoxel(B, shooter);
    if (target && typeof target === 'object') {
      if (!target.onMap || target.x < 0) return null;
      const base = target.z * VZ, off = centreOff(target);
      const cx = target.x * VX + off, cy = target.y * VX + off;
      const [top, mid, bot] = sampleHeights(target);
      const lat = target.size > 1 ? 8 : 4;
      const alongX = Math.abs(cx - eye[0]) >= Math.abs(cy - eye[1]);
      const samples = [[cx, cy, base + mid], [cx, cy, base + top], [cx, cy, base + bot],
        alongX ? [cx, cy + lat, base + mid] : [cx + lat, cy, base + mid],
        alongX ? [cx, cy - lat, base + mid] : [cx - lat, cy, base + mid]];
      for (const s of samples) {
        const r = traceShot(B, originVoxel(B, shooter, s), s, shooter.id, 0);
        if ((r.kind === 'unit' && r.unitId === target.id) || r.kind === 'none') return s;
      }
      return null;
    }
    const ti = target | 0;
    if (ti < 0 || ti >= m.n) return null;
    const [x, y, z] = OV.BMap.xyz(m, ti);
    const occ = B._.unitAt[ti] ? findUnit(B, B._.unitAt[ti] - 1) : null;
    if (occ && occ !== shooter) {
      const v = targetVoxel(B, shooter, occ);
      if (v) return v;
    }
    const T = tables();
    const bx = x * VX, by = y * VX, bz = z * VZ;
    const samples = [];
    let o = m.parts[ti * 4 + 3];
    if (o && (T.fl[o] & O_UFO) && m.ufoDoorOpen[ti]) o = T.alt[o];
    if (o && T.hg[o] && !(T.fl[o] & O_NOBOX)) samples.push([bx + 8, by + 8, bz + Math.max(2, T.hg[o] >> 1)]);
    samples.push([bx + 8, by + 8, bz + 1]);
    samples.push([bx + 8, by + 8, bz + 12]);
    if (m.parts[ti * 4 + 1]) samples.push([bx + 1, by + 8, bz + 12]);
    if (m.parts[ti * 4 + 2]) samples.push([bx + 8, by + 1, bz + 12]);
    for (const s of samples.slice(0, 5)) {
      const r = traceShot(B, originVoxel(B, shooter, s), s, shooter.id, 0);
      if (r.kind === 'none' || (r.kind !== 'out' && r.i === ti)) return s;
    }
    return null;
  }

  OV.LOS = {
    computeLight, shadeAt, eyeVoxel, originVoxel, fov, canSee, canSeeFrom, inCone, inView, spotters, refreshAll,
    refreshTarget, unitMoved, resetSide, traceShot, targetVoxel, lineClear, unitsVisibleTo, isVisibleTo, edgeLOS,
    VX, VZ,
  };
})(globalThis.OV || (globalThis.OV = {}));
