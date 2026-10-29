#!/usr/bin/env node
/* Gerador do mapa-mundo offline do Geoscape → js/data/world.js (o ficheiro gerado é versionado).
   Fonte: Natural Earth 1:110m (domínio público) no pacote npm world-atlas@2.0.2
   (land-110m.json, countries-110m.json; © 2013-2019 Michael Bostock, licença ISC).
   Uso:  node ovni-1999/tools/build_world.mjs <pasta do pacote world-atlas> [--out js/data/world.js]
   Os ficheiros de entrada são dados não confiáveis: só JSON.parse e validação, nunca executados.
   Saída: anéis de terra (1 casa decimal), contornos dos 17 países financiadores (16 orig + Portugal, ours)
   (Douglas–Peucker por arco, fronteiras partilhadas coincidem), máscara de terra 720×360 em bits
   (base64) e máscara de países 720×360 em RLE, ambas por par-ímpar com o antimeridiano e a
   Antártida (anel que contorna o polo) tratados. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const COLS = 720, ROWS = 360, CELL = 0.5;
const SIMPLIFY_DEG = 0.15;
const SIZE_TARGET = 150 * 1024;
const SIZE_LIMIT = 200 * 1024;

// ordem fixa: índice 1..16 = países financiadores orig, 17 = Portugal (financiador desde o wave 4, ours)
const COUNTRIES = [
  ['usa', 'United States of America'], ['canada', 'Canada'], ['brazil', 'Brazil'], ['uk', 'United Kingdom'],
  ['france', 'France'], ['germany', 'Germany'], ['italy', 'Italy'], ['spain', 'Spain'], ['russia', 'Russia'],
  ['egypt', 'Egypt'], ['nigeria', 'Nigeria'], ['south_africa', 'South Africa'], ['india', 'India'],
  ['china', 'China'], ['japan', 'Japan'], ['australia', 'Australia'], ['portugal', 'Portugal'],
];
// polígonos excluídos (centro da caixa envolvente dentro de [lonMin, latMin, lonMax, latMax]):
// fronteiras de 1999 e países do jogo como no original — a Guiana Francesa não é França e a Crimeia
// (atribuída à Rússia no Natural Earth 4.1) era ucraniana, logo fica sem país financiador
const DROP_BOXES = {
  france: [[-60, 0, -50, 10]],
  russia: [[32, 44, 37, 46.5]],
};

// ---- argumentos ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { src: null, out: path.join(ROOT, 'js/data/world.js') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = path.resolve(argv[++i]);
    else if (!opts.src) opts.src = path.resolve(argv[i]);
    else throw new Error('argumento inesperado: ' + argv[i]);
  }
  if (!opts.src) throw new Error('uso: node tools/build_world.mjs <pasta do pacote world-atlas> [--out ficheiro]');
  return opts;
}

// ---- TopoJSON ------------------------------------------------------------------------------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// lê e valida uma topologia; devolve {topo, arcs:[[ [lon,lat], ... ]]} com arcos já descodificados
function readTopology(file) {
  const topo = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!topo || topo.type !== 'Topology' || !Array.isArray(topo.arcs) || !topo.objects || typeof topo.objects !== 'object') {
    throw new Error(file + ': não é uma Topology TopoJSON');
  }
  const tr = topo.transform;
  let sx = 1, sy = 1, tx = 0, ty = 0;
  if (tr) {
    if (!Array.isArray(tr.scale) || !Array.isArray(tr.translate) || ![...tr.scale, ...tr.translate].every(isNum)) {
      throw new Error(file + ': transform inválido');
    }
    [sx, sy] = tr.scale;
    [tx, ty] = tr.translate;
  }
  // arcos quantizados: posições em delta acumulado, depois escala/translação
  const arcs = topo.arcs.map((arc, ai) => {
    if (!Array.isArray(arc) || arc.length < 2) throw new Error(file + ': arco ' + ai + ' inválido');
    let x = 0, y = 0;
    return arc.map((p) => {
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) throw new Error(file + ': posição inválida no arco ' + ai);
      if (tr) {
        x += p[0];
        y += p[1];
        return [x * sx + tx, y * sy + ty];
      }
      return [p[0], p[1]];
    });
  });
  for (const arc of arcs) for (const p of arc) if (p[0] < -180.0001 || p[0] > 180.0001 || p[1] < -90.0001 || p[1] > 90.0001) throw new Error(file + ': coordenada fora do globo');
  return { topo, arcs };
}

// anel = sequência de índices de arco (~i = arco i invertido); o 1.º ponto de cada arco seguinte repete o último
function ringFromArcs(arcs, ids) {
  const out = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || (id < 0 ? ~id : id) >= arcs.length) throw new Error('índice de arco inválido: ' + id);
    const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
    for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]);
  }
  return out;
}

// polígonos (listas de índices de anéis) de uma geometria Polygon/MultiPolygon/GeometryCollection
function geometryPolys(g) {
  if (!g || typeof g !== 'object') return [];
  if (g.type === 'Polygon' && Array.isArray(g.arcs)) return [g.arcs];
  if (g.type === 'MultiPolygon' && Array.isArray(g.arcs)) return g.arcs;
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) return g.geometries.flatMap(geometryPolys);
  return [];
}

// centro da caixa envolvente de um anel (desdobrado no antimeridiano)
function ringCentre(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of unwrap(ring)) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

// todos os anéis (exteriores e buracos); drop = caixas cujos polígonos (pelo anel exterior) são excluídos
function geometryRings(arcs, g, drop) {
  const out = [];
  for (const poly of geometryPolys(g)) {
    const rings = poly.map((r) => ringFromArcs(arcs, r));
    if (drop) {
      const [cx, cy] = ringCentre(rings[0]);
      if (drop.some((b) => cx >= b[0] && cy >= b[1] && cx <= b[2] && cy <= b[3])) continue;
    }
    out.push(...rings);
  }
  return out;
}

// ---- antimeridiano ---------------------------------------------------------------------------
// longitudes contínuas (sem saltos > 180°); um anel que contorna um polo termina deslocado ±360°
function unwrap(ring) {
  const out = [[ring[0][0], ring[0][1]]];
  let lon = ring[0][0];
  for (let k = 1; k < ring.length; k++) {
    let d = ring[k][0] - ring[k - 1][0];
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    lon += d;
    out.push([lon, ring[k][1]]);
  }
  return out;
}

// anel desdobrado e fechado no plano; anéis polares (Antártida) fecham-se pelo polo
function planarRing(ring) {
  const f = ring[0], l = ring[ring.length - 1];
  const closed = f[1] === l[1] && (f[0] === l[0] || Math.abs(Math.abs(f[0] - l[0]) - 360) < 1e-9);
  const u = unwrap(closed ? ring : ring.concat([f]));
  const first = u[0];
  const net = u[u.length - 1][0] - first[0];
  if (Math.abs(net) > 180) {
    let sum = 0;
    for (const p of u) sum += p[1];
    const pole = sum / u.length < 0 ? -90 : 90;
    const end = u[u.length - 1];
    u.push([end[0], pole], [first[0], pole], [first[0], first[1]]);
  }
  return u;
}

// ---- rasterização par-ímpar ----------------------------------------------------------------------
// célula (row, col): row 0 = lat 90..89.5, col 0 = lon −180..−179.5; amostra no centro da célula
const rowLat = (r) => 90 - (r + 0.5) * CELL;

// alterna (XOR) em buf as células interiores de um anel; o lado é decidido no plano desdobrado
function rasterRing(buf, ring) {
  const u = planarRing(ring);
  const rows = new Map();
  for (let k = 1; k < u.length; k++) {
    const a = u[k - 1], b = u[k];
    if (a[1] === b[1]) continue;
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    // linhas cujo centro y cumpre lo ≤ y < hi (equivale a (a.lat > y) ≠ (b.lat > y))
    const r0 = Math.max(0, Math.floor((90 - CELL / 2 - hi) / CELL) + 1);
    const r1 = Math.min(ROWS - 1, Math.floor((90 - CELL / 2 - lo) / CELL));
    for (let r = r0; r <= r1; r++) {
      const y = rowLat(r);
      if (!(lo <= y && y < hi)) continue;
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      let list = rows.get(r);
      if (!list) rows.set(r, (list = []));
      list.push(x);
    }
  }
  for (const [r, xs] of rows) {
    if (xs.length % 2) throw new Error('número ímpar de cruzamentos na linha ' + r);
    xs.sort((p, q) => p - q);
    for (let i = 0; i < xs.length; i += 2) {
      // centros c_k = −179.75 + 0.5·k com s ≤ c_k < e; k reduzido módulo 720 (cópias ±360°)
      const k0 = Math.ceil((xs[i] + 180 - CELL / 2) / CELL);
      const k1 = Math.ceil((xs[i + 1] + 180 - CELL / 2) / CELL) - 1;
      for (let k = k0; k <= k1; k++) buf[r * COLS + (((k % COLS) + COLS) % COLS)] ^= 1;
    }
  }
}

function rasterRings(rings) {
  const buf = new Uint8Array(COLS * ROWS);
  for (const ring of rings) rasterRing(buf, ring);
  return buf;
}

// bits MSB primeiro, linha a linha (720 bits = 90 bytes por linha)
function packBits(cells) {
  const bytes = new Uint8Array(cells.length >> 3);
  for (let i = 0; i < cells.length; i++) if (cells[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  return bytes;
}

// RLE em linha (row-major): por troço, letra do valor ('A' + índice) seguida do comprimento em base 36
function rle(cells) {
  let out = '';
  for (let i = 0; i < cells.length; ) {
    let j = i + 1;
    while (j < cells.length && cells[j] === cells[i]) j++;
    out += String.fromCharCode(65 + cells[i]) + (j - i).toString(36);
    i = j;
  }
  return out;
}

// ---- simplificação Douglas–Peucker -----------------------------------------------------------------
function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

// marca em keep os pontos a manter entre i0 e i1 (inclusive), coordenadas desdobradas
function dpMark(pts, i0, i1, tol2, keep) {
  const stack = [[i0, i1]];
  keep[i0] = keep[i1] = 1;
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1, bestD = tol2;
    for (let k = s + 1; k < e; k++) {
      const d = segDist2(pts[k], pts[s], pts[e]);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
}

// simplifica um arco mantendo os extremos (fronteiras partilhadas ficam iguais); devolve pontos originais
function simplifyArc(arc, tol) {
  const n = arc.length;
  if (n <= 2) return arc.slice();
  const u = unwrap(arc);
  const keep = new Uint8Array(n);
  const closed = arc[0][0] === arc[n - 1][0] && arc[0][1] === arc[n - 1][1];
  if (closed) {
    // ilha num só arco: parte no ponto mais afastado do início
    let far = 1, farD = -1;
    for (let k = 1; k < n - 1; k++) {
      const d = (u[k][0] - u[0][0]) ** 2 + (u[k][1] - u[0][1]) ** 2;
      if (d > farD) {
        farD = d;
        far = k;
      }
    }
    dpMark(u, 0, far, tol * tol, keep);
    dpMark(u, far, n - 1, tol * tol, keep);
  } else dpMark(u, 0, n - 1, tol * tol, keep);
  return arc.filter((_, k) => keep[k]);
}

// ---- formatação dos anéis ---------------------------------------------------------------------------
const round1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};

// anel → [lon,lat,lon,lat,...] com 1 casa decimal, sem repetidos consecutivos, fechado; null se < 4 pontos
function flatRing(ring) {
  const pts = [];
  for (const p of ring) {
    const q = [round1(p[0]), round1(p[1])];
    const prev = pts[pts.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) pts.push(q);
  }
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 1 && (f[0] !== l[0] || f[1] !== l[1])) pts.push([f[0], f[1]]);
  if (pts.length < 4) return null;
  return pts.flat();
}

const ringsJS = (rings, indent) => '[\n' + rings.map((r) => indent + '  [' + r.join(',') + ']').join(',\n') + '\n' + indent + ']';

// ---- código de execução incluído no ficheiro gerado ----------------------------------------------------
const RUNTIME = String.raw`
  W.ringCount = W.land.length;

  // caches descodificados na primeira consulta (fora de W, que é congelado no finalize)
  let landBits = null;
  let countryCells = null;

  function landGrid() {
    if (!landBits) landBits = OV.U.b64dec(W.landMask, Uint8Array);
    return landBits;
  }
  function countryGrid() {
    if (!countryCells) {
      countryCells = new Uint8Array(COLS * ROWS);
      const re = /([A-Z])([0-9a-z]+)/g;
      let m, i = 0;
      while ((m = re.exec(W.countryMask))) {
        const v = m[1].charCodeAt(0) - 65, n = parseInt(m[2], 36);
        if (v) countryCells.fill(v, i, i + n);
        i += n;
      }
    }
    return countryCells;
  }

  // linha/coluna da célula de 0,5° que contém (lon, lat); lon dá a volta, lat é limitada a ±90
  const colOf = (lon) => {
    const c = Math.floor(((((lon + 180) % 360) + 360) % 360) / CELL);
    return c >= COLS ? COLS - 1 : c;
  };
  const rowOf = (lat) => {
    const r = Math.floor((90 - lat) / CELL);
    return r < 0 ? 0 : r >= ROWS ? ROWS - 1 : r;
  };

  // terra firme na célula de (lon, lat)?
  W.isLand = function (lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const i = rowOf(lat) * COLS + colOf(lon);
    return (landGrid()[i >> 3] & (0x80 >> (i & 7))) !== 0;
  };

  // id do país na célula de (lon, lat) ou null; reach > 0 procura o país mais próximo até reach células
  // (útil para costas e mar territorial)
  W.countryAt = function (lon, lat, reach) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const g = countryGrid();
    const r0 = rowOf(lat), c0 = colOf(lon);
    const v = g[r0 * COLS + c0];
    if (v || !(reach > 0)) return v ? W.countryIds[v - 1] : null;
    let best = 0, bestD = Infinity;
    const R = Math.min(Math.floor(reach), 60);
    for (let dr = -R; dr <= R; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= ROWS) continue;
      for (let dc = -R; dc <= R; dc++) {
        const k = g[r * COLS + ((((c0 + dc) % COLS) + COLS) % COLS)];
        const d = dr * dr + dc * dc;
        if (k && d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    return best ? W.countryIds[best - 1] : null;
  };

  OV.Data.world = W;

  // validação cruzada: todos os países financiadores definidos noutros dados têm contorno aqui
  OV.Data.onFinalize('world.validate', (D) => {
    const errs = [];
    if (D.countries && typeof D.countries === 'object') {
      for (const id of Object.keys(D.countries)) if (!W.countries[id]) errs.push('país sem contorno: ' + id);
    }
    if (errs.length) throw new Error(errs.join('; '));
  }, 90);
  OV.Data.onFinalize('world.freeze', () => {
    if (OV.U && OV.U.deepFreeze) OV.U.deepFreeze(W);
  }, 95);
`;

// ---- principal ------------------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const landT = readTopology(path.join(opts.src, 'land-110m.json'));
  const ctryT = readTopology(path.join(opts.src, 'countries-110m.json'));

  // terra: todos os anéis do objeto 'land'
  const landObj = landT.topo.objects.land;
  if (!landObj) throw new Error('land-110m.json sem objeto land');
  const landRings = geometryRings(landT.arcs, landObj);
  const landMask = rasterRings(landRings);
  const landOut = landRings.map(flatRing).filter(Boolean);

  // países: geometrias por nome; contornos a partir dos arcos simplificados, máscara a partir dos originais
  const geoms = (ctryT.topo.objects.countries && ctryT.topo.objects.countries.geometries) || [];
  const simpleArcs = ctryT.arcs.map((a) => simplifyArc(a, SIMPLIFY_DEG));
  const countryMask = new Uint8Array(COLS * ROWS);
  const outlines = {};
  let overlaps = 0;
  COUNTRIES.forEach(([id, name], idx) => {
    const g = geoms.find((x) => x && x.properties && x.properties.name === name);
    if (!g) throw new Error('país não encontrado em countries-110m: ' + name);
    const cells = rasterRings(geometryRings(ctryT.arcs, g, DROP_BOXES[id]));
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      if (countryMask[i]) overlaps++;
      else countryMask[i] = idx + 1;
    }
    outlines[id] = geometryRings(simpleArcs, g, DROP_BOXES[id]).map(flatRing).filter(Boolean);
    if (!outlines[id].length) throw new Error('contorno vazio após simplificação: ' + id);
  });

  const landB64 = Buffer.from(packBits(landMask)).toString('base64');
  const countryRle = rle(countryMask);
  const ids = COUNTRIES.map((c) => c[0]);

  const rel = (p) => path.relative(path.dirname(ROOT), p).split(path.sep).join('/');
  const pt = (v) => String(v).replace('.', ',');
  const header = `/* Mapa-mundo offline do Geoscape — GERADO por tools/build_world.mjs; não editar à mão.
   Fontes: Natural Earth 1:110m (domínio público, naturalearthdata.com) através do pacote npm
   world-atlas@2.0.2 (land-110m.json, countries-110m.json), © 2013-2019 Michael Bostock, licença ISC.
   Gerar:  node ${rel(path.join(ROOT, 'tools/build_world.mjs'))} <pasta do pacote world-atlas> [--out js/data/world.js]
   Conteúdo (lon −180..180 este, lat norte positiva, graus):
     land        anéis de terra [lon,lat,lon,lat,...] (1 casa decimal, fechados; podem atravessar o
                 antimeridiano e o da Antártida contorna o polo sem fecho — tal como na fonte)
     countries   {id: [anéis]} dos 17 países financiadores, 16 orig + portugal (Douglas–Peucker ${pt(SIMPLIFY_DEG)}° por arco;
                 fronteiras de 1999: França só metropolitana, Crimeia fora da Rússia)
     landMask    base64 de ${COLS}×${ROWS} bits (células de ${pt(CELL)}°, linha 0 = lat 90..89,5, coluna 0 = lon −180..−179,5,
                 bit mais significativo primeiro), par-ímpar sobre todos os anéis de terra
     countryMask RLE de ${COLS}×${ROWS} índices de país (0 nenhum, 1..${ids.length} = countryIds): letra 'A'+índice e
                 comprimento em base 36, por linhas
   API: isLand(lon, lat) → bool ; countryAt(lon, lat, reach?) → id|null ; ringCount */
`;
  const body = `(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  OV.Data.finalizers = OV.Data.finalizers || [];
  OV.Data.onFinalize = OV.Data.onFinalize || function (name, fn, order) {
    OV.Data.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };

  const COLS = ${COLS}, ROWS = ${ROWS}, CELL = ${CELL};

  const W = {
    COLS, ROWS, CELL,
    countryIds: [${ids.map((id) => "'" + id + "'").join(', ')}],
    land: ${ringsJS(landOut, '    ')},
    countries: {
${ids.map((id) => '      ' + id + ': ' + ringsJS(outlines[id], '      ')).join(',\n')},
    },
    landMask: '${landB64}',
    countryMask: '${countryRle}',
  };
${RUNTIME}})(globalThis.OV || (globalThis.OV = {}));
`;
  const text = header + body;
  fs.writeFileSync(opts.out, text);

  const size = Buffer.byteLength(text);
  const landCells = landMask.reduce((s, v) => s + v, 0);
  const report = [
    'escrito ' + rel(opts.out) + ': ' + (size / 1024).toFixed(1) + ' KB',
    'terra: ' + landOut.length + ' anéis (' + landRings.length + ' na fonte), ' + landOut.reduce((s, r) => s + r.length / 2, 0) + ' pontos, ' + ((100 * landCells) / landMask.length).toFixed(1) + '% das células',
    'países: ' + ids.map((id) => id + ' ' + outlines[id].reduce((s, r) => s + r.length / 2, 0)).join(', '),
    'landMask ' + (landB64.length / 1024).toFixed(1) + ' KB, countryMask ' + (countryRle.length / 1024).toFixed(1) + ' KB, sobreposições ' + overlaps,
  ];
  console.log(report.join('\n'));
  if (size > SIZE_LIMIT) throw new Error('world.js excede ' + SIZE_LIMIT / 1024 + ' KB');
  if (size > SIZE_TARGET) console.log('aviso: acima do alvo de ' + SIZE_TARGET / 1024 + ' KB');
}

try {
  main();
} catch (e) {
  console.error('build_world: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
