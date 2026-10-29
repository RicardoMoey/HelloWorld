/* Testes dos blocos de terreno e dos scripts de mapa (DESIGN.md §7.2–7.4): blocks_farm/wild/urban/alien.js */
module.exports = function (OV, t) {
  const D = OV.Data;
  const defs = D.tileDefs;

  const EXPECTED = {
    FARM: ['FARM_FIELD', 'FARM_FIELD_B', 'FARM_FIELD_C', 'FARM_BARN', 'FARM_HOUSE', 'FARM_ORCHARD', 'FARM_SILO', 'FARM_HAYSTACKS', 'FARM_YARD'],
    FOREST: ['FOREST_A', 'FOREST_DENSE', 'FOREST_CLEARING', 'FOREST_GLADE', 'FOREST_CABIN', 'FOREST_ROCKS'],
    JUNGLE: ['JUNGLE_DENSE', 'JUNGLE_TEMPLE', 'JUNGLE_HUT', 'JUNGLE_SWAMP'],
    DESERT: ['DESERT_A', 'DESERT_DUNES', 'DESERT_ROCKS', 'DESERT_MESA', 'DESERT_OASIS', 'DESERT_RUIN'],
    MOUNTAIN: ['MOUNTAIN_A', 'MOUNTAIN_RIDGE', 'MOUNTAIN_PASS', 'MOUNTAIN_HUT'],
    POLAR: ['POLAR_A', 'POLAR_PINES', 'POLAR_ICE', 'POLAR_STATION'],
    URBAN: ['URBAN_HOUSE', 'URBAN_HOUSE_B', 'URBAN_SHOP', 'URBAN_PARK', 'URBAN_PARKING', 'URBAN_PETROL', 'URBAN_CAFE', 'URBAN_FLATS',
      'URBAN_PLAZA', 'URBAN_STORE', 'URBAN_APARTMENTS', 'URBAN_OFFICE', 'URBAN_ROAD_NS', 'URBAN_ROAD_EW', 'URBAN_ROAD_X',
      'URBAN_ROAD_TN', 'URBAN_ROAD_TE', 'URBAN_ROAD_TS', 'URBAN_ROAD_TW'],
    ALIENBASE: ['ALIENBASE_LIFT', 'ALIENBASE_COMMAND', 'ALIENBASE_LAB', 'ALIENBASE_QUARTERS', 'ALIENBASE_HANGAR', 'ALIENBASE_CORRIDOR', 'ALIENBASE_CROSS'],
    MARS: ['MARS_A', 'MARS_MESA', 'MARS_CRATER', 'MARS_SPIRES', 'MARS_RUIN', 'MARS_RIDGE', 'MARS_PYRAMID'],
  };
  const ROADS = { URBAN_ROAD_NS: 'NS', URBAN_ROAD_EW: 'EW', URBAN_ROAD_X: 'NESW', URBAN_ROAD_TN: 'NEW', URBAN_ROAD_TE: 'NES', URBAN_ROAD_TS: 'ESW', URBAN_ROAD_TW: 'NSW' };
  const ALL = [].concat(...Object.values(EXPECTED));
  const TERRAINS = Object.keys(EXPECTED);
  const OUTDOOR_SETS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'MARS'];
  const WEST_CH = '|+!L]}deij)fZ';
  const NORTH_CH = '-+^L;}DEI:FJZ';

  const C = (id) => D.compiled[id];
  const at = (c, x, y, z) => (z * c.h + y) * c.w + x;
  const xyz = (c, i) => [i % c.w, ((i / c.w) | 0) % c.h, (i / (c.w * c.h)) | 0];
  const part = (c, i, p) => defs[c.parts[i * 4 + p]];
  const role = (c, i, p) => { const d = part(c, i, p); return d ? d.role : null; };

  // movimento ortogonal (sem cortar esquinas): chão + objeto transponível; portas abrem se `doors`
  const standable = (c, i, doors) => {
    const f = part(c, i, 0), o = part(c, i, 3);
    if (!f) return false;
    if (!o) return true;
    if (o.door) return !!doors;
    return o.tu < 255 && !o.fullBlock;
  };
  const edgeOk = (d, doors) => !d || d.tu < 255 || (!!doors && !!d.door);
  function flood(c, starts, opt) {
    const o = Object.assign({ doors: true, lifts: true }, opt);
    const seen = new Set();
    const q = [];
    for (const s of starts) if (standable(c, s, o.doors) && !seen.has(s)) { seen.add(s); q.push(s); }
    const plane = c.w * c.h;
    while (q.length) {
      const i = q.pop();
      const [x, y, z] = xyz(c, i);
      const next = [];
      if (y > 0 && edgeOk(part(c, i, 2), o.doors)) next.push(i - c.w);
      if (y < c.h - 1 && edgeOk(part(c, i + c.w, 2), o.doors)) next.push(i + c.w);
      if (x > 0 && edgeOk(part(c, i, 1), o.doors)) next.push(i - 1);
      if (x < c.w - 1 && edgeOk(part(c, i + 1, 1), o.doors)) next.push(i + 1);
      const ob = part(c, i, 3);
      if (ob && z + 1 < c.d) {
        const up = part(c, i + plane, 3);
        if (up && ((o.lifts && ob.gravlift && up.gravlift) || (ob.stairs === 'foot' && up.stairs === 'head'))) next.push(i + plane);
      }
      if (ob && z > 0) {
        const dn = part(c, i - plane, 3);
        if (dn && ((o.lifts && ob.gravlift && dn.gravlift) || (ob.stairs === 'head' && dn.stairs === 'foot'))) next.push(i - plane);
      }
      for (const j of next) if (!seen.has(j) && standable(c, j, o.doors)) { seen.add(j); q.push(j); }
    }
    return seen;
  }
  const border = (c) => {
    const out = [];
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (x === 0 || y === 0 || x === c.w - 1 || y === c.h - 1) out.push(at(c, x, y, 0));
    return out;
  };
  const walkable = (c) => {
    const out = [];
    for (let i = 0; i < c.w * c.h * c.d; i++) if (standable(c, i, true) && role(c, i, 0) !== 'roof') out.push(i);
    return out;
  };
  // segmentos de 10 tiles de cada aresta: [{side, k, tiles:[i]}]
  function segments(c) {
    const out = [];
    for (let k = 0; k < c.w / 10; k++) {
      out.push({ side: 'N', k, tiles: Array.from({ length: 10 }, (_, j) => at(c, k * 10 + j, 0, 0)) });
      out.push({ side: 'S', k, tiles: Array.from({ length: 10 }, (_, j) => at(c, k * 10 + j, c.h - 1, 0)) });
    }
    for (let k = 0; k < c.h / 10; k++) {
      out.push({ side: 'W', k, tiles: Array.from({ length: 10 }, (_, j) => at(c, 0, k * 10 + j, 0)) });
      out.push({ side: 'E', k, tiles: Array.from({ length: 10 }, (_, j) => at(c, c.w - 1, k * 10 + j, 0)) });
    }
    return out;
  }
  // quadrado 2×2 livre a partir de (x,y) (unidades grandes)
  function clear2x2(c, x, y, z) {
    if (x + 1 >= c.w || y + 1 >= c.h) return false;
    const a = at(c, x, y, z), b = at(c, x + 1, y, z), d = at(c, x, y + 1, z), e = at(c, x + 1, y + 1, z);
    if (![a, b, d, e].every((i) => standable(c, i, false))) return false;
    return edgeOk(part(c, b, 1)) && edgeOk(part(c, e, 1)) && edgeOk(part(c, d, 2)) && edgeOk(part(c, e, 2));
  }
  const tagged = (id, tag) => (D.blocks[id].tags || []).includes(tag);

  // ---- existência, medidas, sets -------------------------------------------------------------------------
  t.test('terreno: todos os blocos existem, compilam e têm o set do prefixo e medidas válidas', () => {
    t.ok(!OV.__finalizeError, OV.__finalizeError && OV.__finalizeError.message);
    for (const set of TERRAINS) {
      for (const id of EXPECTED[set]) {
        const b = D.blocks[id], c = C(id);
        t.ok(b && c, 'bloco ' + id);
        t.eq(b.set, set, id + ' set');
        t.ok([10, 20].includes(c.w) && [10, 20].includes(c.h) && c.w === c.h, id + ' medidas ' + c.w + '×' + c.h);
        t.ok(c.d <= (set === 'ALIENBASE' ? 1 : set === 'MARS' ? 2 : 3), id + ' níveis ' + c.d);
        t.ok(b.weight > 0, id + ' peso');
      }
    }
    // nenhum bloco de terreno a mais sem teste
    for (const id in D.blocks) {
      const set = id.split('_')[0];
      if (TERRAINS.includes(set)) t.ok(ALL.includes(id), 'bloco não listado no teste ' + id);
    }
    const n = (set, w, f) => EXPECTED[set].filter((id) => C(id).w === w && (!f || f(id))).length;
    t.ok(n('FARM', 10) >= 8 && n('FARM', 20) >= 1, 'quinta 8×10² + 1×20²');
    t.ok(n('URBAN', 10, (id) => !ROADS[id]) >= 8 && n('URBAN', 20) >= 3, 'cidade 8×10² + 3×20²');
    t.ok(n('ALIENBASE', 10) + n('ALIENBASE', 20) >= 7 && C('ALIENBASE_COMMAND').w === 20, 'base: 7 módulos, comando 20×20');
    t.ok(n('MARS', 10) >= 6 && C('MARS_PYRAMID').w === 20, 'Marte 6 + pirâmide 20×20');
  });

  t.test('terreno: exemplos do DESIGN §7.4 copiados à letra', () => {
    t.eq(D.blocks.FARM_FIELD.levels[0], [',,,,,,,,,,', ',,,,,,,,,,', ',,,,,,,,,,', '..........', 'FFFFF..FFF', ',,,,,,,,,,', ',,,,,,,,,,', ',,,,b,,,,,', ',,,,,,,,,,', '..........']);
    t.eq(D.blocks.FARM_BARN.levels, [
      ['..........', '.+------!.', '.|cc===s!.', '.|c=====!.', '.|======j.', '.|c====c!.', '.|cc==cc!.', '.^^^EE^^..', '..........', '.....b....'],
      ['~~~~~~~~~~', '~+------]~', '~|=====S]~', '~|c=====]~', '~|======)~', '~|======]~', '~|cc====]~', '~;;;;;;;~~', '~~~~~~~~~~', '~~~~~~~~~~'],
      ['~~~~~~~~~~', '~RRRRRRR~~', '~RRRRRRR~~', '~RRRRRRR~~', '~RRRRRRR~~', '~RRRRRRR~~', '~RRRRRRR~~', '~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~~~~~'],
    ]);
    t.eq(D.blocks.URBAN_SHOP.levels, [
      ['..........', '.+---D---!', '.|kk===kk!', '.|======c!', '.d==1===c!', '.|======s!', '.+--D---L.', '.|bb==k=!.', '.|======!.', '.^^^^^^^..'],
      ['~~~~~~~~~~', '~+---I---]', '~|B=====t]', '~|===t==B]', '~i======c]', '~|======S]', '~+--D---}~', '~|kk====]~', '~|==1===]~', '~;;;;;;;~~'],
      ['~~~~~~~~~~', '~RRRRRRRR~', '~RRRRRRRR~', '~RRRRRRRR~', '~RRRRRRRR~', '~RRRRRRRR~', '~RRRRRRR~~', '~RRRRRRR~~', '~RRRRRRR~~', '~~~~~~~~~~'],
    ]);
    t.eq(D.blocks.FOREST_A.levels[0], ['..T....b..', '.TT..b....', '..T...#...', 'b.....##..', '...T......', '..TTT..b..', '...T....T.', '.b.....TT.', '....b...T.', 'T.........']);
    t.eq(D.blocks.DESERT_A.levels[0], ['..........', '...##.....', '..###.....', '...#......', '.......b..', '......##..', '.b....###.', '......##..', '..........', '..........']);
    // ALIEN_BASE_COMMAND do DESIGN é o núcleo, ao centro do módulo de comando 20×20; correção ours na linha 1:
    // «HH4n==n4HH» deixava os nós 4 emparedados entre H, n e u ⇒ «HHn4==4nHH» (consolas um tile para fora)
    const core = ['HHHH==HHHH', 'HHn4==4nHH', 'H=u====u=H', 'H========H', '===P@@P===', '===u@@u===', 'H========H', 'H=1====1=H', 'HHk2==2kHH', 'HHHH==HHHH'];
    t.eq(D.blocks.ALIENBASE_COMMAND.levels[0].slice(5, 15).map((r) => r.slice(5, 15)), core);
    // URBAN_ROAD_NS: 1 candeeiro na faixa, 6 linhas simples, 2 com carro, 1 candeeiro no passeio
    const rows = D.blocks.URBAN_ROAD_NS.levels[0];
    const count = (r) => rows.filter((s) => s === r).length;
    t.eq([count('..__l__...'), count('..____....'), count('..__C_....'), count('..____l...')], [1, 6, 2, 1]);
  });

  // ---- autoria: arestas, rotação, níveis --------------------------------------------------------------
  t.test('terreno: sem paredes na aresta norte da linha 0 nem na oeste da coluna 0 (rotação sem perdas)', () => {
    for (const id of ALL) {
      const b = D.blocks[id];
      b.levels.forEach((rows, z) => {
        for (let x = 0; x < b.w; x++) t.ok(!NORTH_CH.includes(rows[0][x]), id + ' z' + z + ' parede norte na linha 0, col ' + x);
        for (let y = 0; y < b.h; y++) t.ok(!WEST_CH.includes(rows[y][0]), id + ' z' + z + ' parede oeste na coluna 0, linha ' + y);
      });
      const c = C(id);
      for (let q = 1; q < 4; q++) t.eq(D.rotateCompiled(c, q).droppedEdges, 0, id + ' rotação ' + q);
      t.eq(typeof b.rotate, 'boolean', id + ' rotate');
    }
    for (const id in ROADS) t.eq(D.blocks[id].rotate, false, id + ' estradas não rodam');
  });

  t.test('terreno: pisos superiores assentam em estrutura e edifícios têm teto', () => {
    for (const id of ALL) {
      const b = D.blocks[id], c = C(id);
      for (let z = 1; z < b.levels.length; z++) {
        for (let y = 0; y < b.h; y++) {
          for (let x = 0; x < b.w; x++) {
            if (!c.parts[at(c, x, y, z) * 4]) continue;
            t.ok(!'.~'.includes(b.levels[z - 1][y][x]), id + ' z' + z + ' (' + x + ',' + y + ') chão sem nada por baixo');
          }
        }
      }
      if (!tagged(id, 'building')) continue;
      const top = b.set === 'MARS' ? 1 : 2; // último nível do mapa (sem teto possível)
      for (let i = 0; i < c.w * c.h * c.d; i++) {
        const [x, y, z] = xyz(c, i);
        if (z >= top || role(c, i, 0) !== 'inner') continue;
        t.ok(z + 1 < c.d && c.parts[at(c, x, y, z + 1) * 4], id + ' interior sem teto em (' + x + ',' + y + ',' + z + ')');
      }
    }
  });

  t.test('terreno: escadas s↔S e elevadores emparelhados; edifícios com andares têm escada', () => {
    for (const id of ALL) {
      const c = C(id);
      let heads = 0;
      for (let i = 0; i < c.w * c.h * c.d; i++) if (part(c, i, 3) && part(c, i, 3).stairs === 'head') heads++;
      t.eq(heads, c.stairs.length, id + ' cabeças = pés');
      for (const i of c.stairs) {
        const [x, y, z] = xyz(c, i);
        t.eq(part(c, at(c, x, y, z + 1), 3).stairs, 'head', id + ' escada em ' + [x, y, z]);
      }
      for (const i of c.gravlifts) {
        const [x, y, z] = xyz(c, i);
        const up = z + 1 < c.d && part(c, at(c, x, y, z + 1), 3), dn = z > 0 && part(c, at(c, x, y, z - 1), 3);
        t.ok((up && up.gravlift) || (dn && dn.gravlift), id + ' elevador sem par em ' + [x, y, z]);
      }
      // interiores acima do piso 0 só existem com escada (ou elevador)
      let upper = false;
      for (let i = c.w * c.h; i < c.w * c.h * c.d; i++) if (role(c, i, 0) === 'inner' && standable(c, i, true)) upper = true;
      if (upper) t.ok(c.stairs.length + c.gravlifts.length > 0, id + ' andar superior sem escada');
    }
    t.ok(C('URBAN_APARTMENTS').stairs.some((i) => xyz(C('URBAN_APARTMENTS'), i)[2] === 1), 'prédio: escada de z1 para z2');
    t.ok(C('FARM_HOUSE').stairs.length >= 1 && C('URBAN_APARTMENTS').d === 3, 'casa da quinta e prédio de 3 pisos');
  });

  // ---- conectividade --------------------------------------------------------------------------------------
  // uma só componente interna: bolsas abertas só para fora do bloco ficariam isoladas junto à borda do mapa
  t.test('terreno: tudo o que é caminhável (exceto telhados) forma uma só componente, com portas abertas', () => {
    for (const id of ALL) {
      const c = C(id);
      const all = walkable(c);
      const seen = flood(c, [border(c).find((i) => standable(c, i, true))]);
      const lost = all.filter((i) => !seen.has(i));
      t.ok(lost.length === 0, id + ': ' + lost.length + ' tiles isolados, ex. ' + (lost.length ? xyz(c, lost[0]) : ''));
    }
  });

  t.test('terreno: arestas transitáveis (≥ 6 por segmento de 10) ligam blocos vizinhos', () => {
    for (const id of ALL) {
      const b = D.blocks[id], c = C(id);
      if (!OUTDOOR_SETS.includes(b.set)) continue;
      for (const s of segments(c)) {
        const n = s.tiles.filter((i) => standable(c, i, true)).length;
        t.ok(n >= 6, id + ' aresta ' + s.side + s.k + ': ' + n + ' tiles transitáveis');
      }
    }
  });

  t.test('terreno: edifícios só se entram pelas portas (selados com portas fechadas)', () => {
    let buildings = 0;
    for (const id of ALL) {
      if (!tagged(id, 'building')) continue;
      buildings++;
      const c = C(id);
      const interior = [];
      for (let i = 0; i < c.w * c.h * c.d; i++) if (role(c, i, 0) === 'inner' && standable(c, i, true)) interior.push(i);
      t.ok(interior.length > 0, id + ' sem interior');
      let doors = 0;
      for (let i = 0; i < c.w * c.h * c.d; i++) for (let p = 1; p < 4; p++) if (part(c, i, p) && part(c, i, p).door) doors++;
      t.ok(doors > 0, id + ' sem portas');
      const outside = border(c).filter((i) => role(c, i, 0) !== 'inner');
      const closed = flood(c, outside, { doors: false });
      const leak = interior.filter((i) => closed.has(i));
      t.ok(leak.length === 0, id + ': interior acessível sem portas em ' + (leak.length ? xyz(c, leak[0]) : ''));
      const open = flood(c, outside, { doors: true });
      const miss = interior.filter((i) => !open.has(i));
      t.ok(miss.length === 0, id + ': interior inacessível em ' + (miss.length ? xyz(c, miss[0]) : ''));
      t.ok(c.nodes.some((nd) => role(c, at(c, nd.x, nd.y, nd.z), 0) === 'inner'), id + ' sem nós de patrulha no interior');
    }
    t.ok(buildings >= 18, 'edifícios: ' + buildings);
  });

  t.test('terreno: nós caminháveis e acessíveis; nós 6 com espaço 2×2', () => {
    for (const id of ALL) {
      const c = C(id);
      const seen = flood(c, border(c));
      for (const nd of c.nodes) {
        const i = at(c, nd.x, nd.y, nd.z);
        t.ok(seen.has(i), id + ' nó inacessível ' + JSON.stringify(nd));
        if (nd.rank === 6) t.ok(clear2x2(c, nd.x, nd.y, nd.z), id + ' nó 6 sem espaço 2×2 ' + JSON.stringify(nd));
      }
    }
    // terror: líderes (4), soldados (1) e unidades de terror (6) têm onde nascer na cidade
    const ranks = (ids) => { const r = {}; for (const id of ids) for (const nd of C(id).nodes) r[nd.rank] = (r[nd.rank] || 0) + 1; return r; };
    const u = ranks(EXPECTED.URBAN);
    t.ok(u[4] >= 3 && u[1] >= 10 && u[6] >= 10, 'nós na cidade ' + JSON.stringify(u));
    t.ok(EXPECTED.URBAN.filter((id) => C(id).w === 20).every((id) => C(id).nodes.some((nd) => nd.rank === 4)), 'blocos 20×20 urbanos com nó de líder');
  });

  // ---- cidade: estradas ---------------------------------------------------------------------------------------
  t.test('cidade: estradas encaixam nas arestas (faixa nas mesmas posições) e ligam os braços', () => {
    const P = D.ROAD_PROFILE;
    t.eq(P, [2, 3, 4, 5]);
    const roadAt = (c, x, y) => role(c, at(c, x, y, 0), 0) === 'road';
    const edgeRoad = (c, side) => {
      const out = [];
      for (let k = 0; k < 10; k++) {
        const [x, y] = side === 'N' ? [k, 0] : side === 'S' ? [k, 9] : side === 'W' ? [0, k] : [9, k];
        if (roadAt(c, x, y)) out.push(k);
      }
      return out;
    };
    for (const id in ROADS) {
      const b = D.blocks[id], c = C(id);
      t.eq(b.arms, ROADS[id], id + ' braços');
      t.ok(tagged(id, 'road') && tagged(id, ROADS[id].length === 2 ? 'straight' : 'junction'), id + ' etiquetas');
      for (const side of 'NESW') t.eq(edgeRoad(c, side), ROADS[id].includes(side) ? P : [], id + ' aresta ' + side);
      // a faixa liga todos os braços (por tiles de estrada transitáveis)
      const armTiles = (side) => P.map((k) => (side === 'N' ? at(c, k, 0, 0) : side === 'S' ? at(c, k, 9, 0) : side === 'W' ? at(c, 0, k, 0) : at(c, 9, k, 0)));
      const roadOnly = { w: c.w, h: c.h, d: 1, parts: c.parts.map((v, j) => ((j & 3) === 0 && defs[v] && defs[v].role !== 'road' ? 0 : v)) };
      const arms = ROADS[id].split('');
      const seen = flood(roadOnly, armTiles(arms[0]));
      for (const a of arms) t.ok(armTiles(a).some((i) => seen.has(i)), id + ' braço ' + a + ' desligado');
    }
    // os outros blocos urbanos não têm estrada na borda (passeio a toda a volta)
    for (const id of EXPECTED.URBAN) {
      if (ROADS[id]) continue;
      const c = C(id);
      for (const side of 'NESW') t.eq(edgeRoad(c, side), [], id + ' estrada na aresta ' + side);
    }
  });

  // ---- base alienígena e Marte ------------------------------------------------------------------------------
  t.test('base alienígena: aberturas de 2 tiles no meio de cada segmento de aresta (também rodado)', () => {
    for (const id of EXPECTED.ALIENBASE) {
      const c0 = C(id);
      t.eq(D.blocks[id].rotate, true, id + ' roda');
      for (let q = 0; q < 4; q++) {
        const c = D.rotateCompiled(c0, q);
        for (const s of segments(c)) {
          s.tiles.forEach((i, k) => {
            const open = k === 4 || k === 5;
            t.eq(standable(c, i, true), open, id + ' q' + q + ' aresta ' + s.side + s.k + ' pos ' + k);
          });
        }
      }
      t.eq(c0.d, 1, id + ' só z0 (teto implícito)');
    }
  });

  t.test('base alienígena: elevador com inícios X; comando com núcleos @ e líderes', () => {
    const lift = C('ALIENBASE_LIFT');
    const seats = Math.max(D.crafts.skyranger.seats, D.crafts.avenger.seats);
    t.ok(lift.startTiles.length >= seats, 'inícios no elevador ' + lift.startTiles.length + ' ≥ ' + seats);
    t.eq(lift.nodes.length, 0, 'sem aliens no elevador');
    t.ok(tagged('ALIENBASE_LIFT', 'lift'), 'etiqueta lift');
    const cmd = C('ALIENBASE_COMMAND');
    t.ok(cmd.specials.OBJECTIVE.length >= 4, 'núcleos @');
    t.ok(cmd.nodes.filter((nd) => nd.rank === 4).length >= 3, 'comandante + 2 líderes');
    for (const id of EXPECTED.ALIENBASE) if (id !== 'ALIENBASE_LIFT') t.eq(C(id).startTiles.length, 0, id + ' sem inícios');
    const nodes = EXPECTED.ALIENBASE.reduce((n, id) => n + C(id).nodes.length, 0);
    t.ok(nodes >= 30, 'nós na base ' + nodes);
  });

  t.test('Marte: pirâmide de 2 níveis, Cérebro em z1 só alcançável pelo elevador gravítico', () => {
    const c = C('MARS_PYRAMID');
    t.eq([c.w, c.h, c.d], [20, 20, 2]);
    t.ok(c.specials.OBJECTIVE.length >= 1 && c.specials.OBJECTIVE.every((i) => xyz(c, i)[2] === 1), 'Cérebro em z1');
    t.ok(c.gravlifts.length >= 2 && c.gravlifts.some((i) => xyz(c, i)[2] === 0) && c.gravlifts.some((i) => xyz(c, i)[2] === 1), 'elevador z0↔z1');
    const chamber = [];
    for (let i = c.w * c.h; i < c.w * c.h * 2; i++) if (role(c, i, 0) === 'inner' && standable(c, i, true)) chamber.push(i);
    t.ok(chamber.length >= 8, 'câmara em z1');
    const noLift = flood(c, border(c), { lifts: false });
    t.ok(chamber.every((i) => !noLift.has(i)), 'câmara sem elevador inacessível');
    const lift = flood(c, border(c));
    t.ok(chamber.every((i) => lift.has(i)), 'câmara acessível pelo elevador');
    t.ok(c.nodes.filter((nd) => nd.rank === 4).length >= 5, 'nós de comandante/líder (2 + 3 em Cydonia)');
  });

  // ---- scripts de mapa -------------------------------------------------------------------------------------
  t.test('scripts: estrutura, tamanhos, referências e pesos do DESIGN', () => {
    const S = D.mapScripts;
    for (const id of TERRAINS) {
      const s = S[id];
      t.ok(s && s.id === id && D.tilesets[s.tileset], id + ' script');
      t.eq(s.nameKey, 'terrain.' + id);
      t.ok(Object.keys(s.sizes).length > 0);
      for (const c of s.commands) {
        t.ok(['addCraft', 'addUFO', 'addRoads', 'addBlock', 'fill'].includes(c.type), id + ' ' + c.type);
        if (c.type === 'addBlock' || c.type === 'fill') {
          for (const bid in c.weights) {
            t.ok(D.blocks[bid] && c.weights[bid] > 0, id + ' ' + bid);
            if (c.type === 'fill') t.eq([C(bid).w, C(bid).h], [10, 10], id + ' fill ' + bid);
            if (c.size) t.eq(C(bid).w, c.size, id + ' addBlock ' + bid);
            t.ok(Number.isInteger(c.maxUses[bid]), id + ' maxUses ' + bid);
            t.ok(D.getCompiled(bid, s.tileset), id + ' compila ' + bid + ' em ' + s.tileset);
          }
        }
      }
    }
    for (const id of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN']) {
      t.eq(S[id].sizes, { small: [30, 30, 3], medium: [40, 40, 3], large: [50, 50, 3] }, id + ' tamanhos');
      t.ok(S[id].commands.some((c) => c.type === 'addCraft') && S[id].commands.some((c) => c.type === 'addUFO'), id + ' nave + OVNI');
    }
    t.eq(S.ALIENBASE.sizes.medium, [40, 40, 2]);
    t.ok(S.ALIENBASE.ceiling && !S.FARM.ceiling, 'teto da base');
    t.eq(S.MARS.sizes.large, [50, 50, 2]);
    t.eq(S.URBAN.sizes.medium, [D.deployments.dep_terror_site.map.w, D.deployments.dep_terror_site.map.h, D.deployments.dep_terror_site.map.d]);
    t.eq(S.ALIENBASE.sizes.medium, [D.deployments.dep_alien_base.map.w, D.deployments.dep_alien_base.map.h, D.deployments.dep_alien_base.map.d]);
    t.eq(S.MARS.sizes.large, [D.deployments.dep_cydonia.map.w, D.deployments.dep_cydonia.map.h, D.deployments.dep_cydonia.map.d]);
    t.ok(S.URBAN.civilians && S.URBAN.civilians.levels.includes(0), 'civis na cidade');
    t.eq([S.JUNGLE.tileset, S.MOUNTAIN.tileset, S.POLAR.tileset], ['JUNGLE', 'MOUNTAIN', 'POLAR']);
    // DESIGN §7.3: quinta com campos 5, celeiro 2 (máx. 2), casa 2, pomar 2, silo 1
    const fill = S.FARM.commands.find((c) => c.type === 'fill');
    t.eq([fill.weights.FARM_FIELD, fill.weights.FARM_BARN, fill.weights.FARM_HOUSE, fill.weights.FARM_ORCHARD, fill.weights.FARM_SILO], [5, 2, 2, 2, 1]);
    t.eq(fill.maxUses.FARM_BARN, 2);
    // estradas da cidade e regras fixas da base e de Marte
    const roads = S.URBAN.commands.find((c) => c.type === 'addRoads');
    t.eq(roads.chance, { ns: 50, ew: 50 });
    t.eq(Object.keys(roads.blocks).sort(), ['cross', 'ew', 'ns', 'tE', 'tN', 'tS', 'tW']);
    for (const k in roads.blocks) t.ok(ROADS[roads.blocks[k]], 'estrada ' + k);
    const ab = S.ALIENBASE.commands;
    t.ok(ab.some((c) => c.type === 'addBlock' && c.weights.ALIENBASE_LIFT && c.at === 'edge'), 'elevador na borda');
    t.ok(ab.some((c) => c.type === 'addBlock' && c.weights.ALIENBASE_COMMAND && c.anchor), 'comando');
    t.ok(!ab.some((c) => c.type === 'addCraft' || c.type === 'addUFO'), 'base sem nave nem OVNI');
    t.ok(S.MARS.commands.some((c) => c.type === 'addBlock' && c.weights.MARS_PYRAMID && c.at === 'centre'), 'pirâmide ao centro');
    // todos os blocos de terreno são usados por algum script
    const used = new Set();
    for (const id in S) {
      for (const c of S[id].commands) {
        if (c.weights) Object.keys(c.weights).forEach((k) => used.add(k));
        if (c.blocks) Object.values(c.blocks).forEach((k) => used.add(k));
      }
    }
    for (const id of ALL) t.ok(used.has(id), 'bloco sem uso nos scripts ' + id);
    t.ok(Object.isFrozen(S.FARM) || !D.isFinal || !D.isFinal(), 'scripts congelados');
  });

  // ---- simulação de referência dos scripts (ocupação, carimbo e conectividade do mapa) ------------------
  function simulate(s, size, spec, seed) {
    const rng = OV.RNG.create(seed);
    const [W, H, DZ] = size;
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
      const p = { id, x, y, fw, fh, rot, kind };
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
    const at2 = (pos, how) => {
      const edge = (p) => p.x === 0 || p.y === 0 || p.x + p.fw === CW || p.y + p.fh === CH;
      if (how === 'edge') return pos.filter(edge);
      if (how === 'inner') { const r = pos.filter((p) => !edge(p)); return r.length ? r : pos; }
      if (how === 'centre') {
        const dist = (p) => (2 * p.x + p.fw - CW) ** 2 + (2 * p.y + p.fh - CH) ** 2;
        const m = Math.min(...pos.map(dist));
        return pos.filter((p) => dist(p) === m);
      }
      if (how === 'far' && anchors.length) {
        const m = Math.max(...pos.map(minSep));
        return pos.filter((p) => minSep(p) === m);
      }
      return pos;
    };
    for (const c of s.commands) {
      if (c.type === 'addCraft') {
        const cid = spec.craftType && D.crafts[spec.craftType].block;
        if (!cid) continue;
        const b = D.blocks[cid];
        const lw = b.w / 10, lh = b.h / 10;
        const cands = [];
        for (const x of [...new Set([0, CW - lw])]) for (let y = 0; y + lh <= CH; y++) cands.push({ x, y, fw: lw, fh: lh, vert: true });
        for (const y of [...new Set([0, CH - lw])]) for (let x = 0; x + lh <= CW; x++) cands.push({ x, y, fw: lh, fh: lw, vert: false });
        const cellsOf = (p) => { const o = []; for (let yy = p.y; yy < p.y + p.fh; yy++) for (let xx = p.x; xx < p.x + p.fw; xx++) o.push(cell[yy * CW + xx]); return o; };
        const straight = (k) => k >= 0 && (D.blocks[P[k].id].tags || []).includes('straight');
        let pick = null;
        if (c.prefer === 'road') {
          const r = cands.filter((p) => inside(p.x, p.y, p.fw, p.fh) && minSep(p) >= c.gap && cellsOf(p).every((k) => k < 0 || straight(k)) && cellsOf(p).some(straight));
          if (r.length) { pick = rng.pick(r); for (const k of new Set(cellsOf(pick))) if (k >= 0) remove(k); }
        }
        for (let g = c.gap; !pick && g >= 0; g--) {
          const r = cands.filter((p) => free(p.x, p.y, p.fw, p.fh) && minSep(p) >= g);
          if (r.length) pick = rng.pick(r);
        }
        if (!pick) {
          const r = positions(lw, lh).map((p) => Object.assign(p, { vert: true })).concat(positions(lh, lw).map((p) => Object.assign(p, { vert: false })));
          if (!r.length) return null;
          pick = rng.pick(r);
        }
        put(cid, pick.x, pick.y, pick.fw, pick.fh, pick.vert ? rng.pick([0, 2]) : rng.pick([1, 3]), 'craft', true);
      } else if (c.type === 'addUFO') {
        const u = spec.ufoType && D.ufos[spec.ufoType];
        if (!u) continue;
        const b = D.blocks[u.block];
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
        if (doNS) { cx = line(CW); for (let y = 0; y < CH; y++) if (free(cx, y, 1, 1)) put(c.blocks.ns, cx, y, 1, 1, 0, 'road'); }
        if (doEW) { cy = line(CH); for (let x = 0; x < CW; x++) if (free(x, cy, 1, 1)) put(c.blocks.ew, x, cy, 1, 1, 0, 'road'); }
        if (doNS && doEW) {
          const k = cell[cy * CW + cx];
          if (k < 0 || P[k].id === c.blocks.ns || P[k].id === c.blocks.ew) { if (k >= 0) remove(k); put(c.blocks.cross, cx, cy, 1, 1, 0, 'road'); }
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
            while (free(x, y, 1, 1)) { put(doNS ? c.blocks.ew : c.blocks.ns, x, y, 1, 1, 0, 'road'); n++; x += dx; y += dy; }
            if (n) { remove(j0); put(c.blocks['t' + side], sx, sy, 1, 1, 0, 'road'); }
          }
        }
      } else if (c.type === 'addBlock' || c.type === 'fill') {
        if (c.type === 'fill') {
          for (let y = 0; y < CH; y++) {
            for (let x = 0; x < CW; x++) {
              if (cell[y * CW + x] >= 0) continue;
              let cand = {};
              for (const id in c.weights) if (!exhausted(c, id)) cand[id] = c.weights[id];
              if (!Object.keys(cand).length) cand = c.weights;
              const id = rng.weighted(cand);
              put(id, x, y, 1, 1, D.blocks[id].rotate ? rng.int(0, 3) : 0, 'block', false);
            }
          }
          continue;
        }
        const n = rng.int(c.count[0], c.count[1]);
        for (let k = 0; k < n; k++) {
          const cand = {};
          for (const id in c.weights) if (!exhausted(c, id)) cand[id] = c.weights[id];
          let placed = false;
          while (!placed) {
            const id = rng.weighted(cand);
            if (!id) break;
            const b = D.blocks[id];
            const rot = b.rotate ? rng.int(0, 3) : 0;
            const fw = (rot & 1 ? b.h : b.w) / 10, fh = (rot & 1 ? b.w : b.h) / 10;
            const pos = at2(positions(fw, fh), c.at);
            if (!pos.length) { delete cand[id]; continue; }
            const p = rng.pick(pos);
            put(id, p.x, p.y, fw, fh, rot, 'block', c.anchor);
            placed = true;
          }
          if (!placed) break;
        }
      }
    }
    if (cell.some((k) => k < 0)) return { error: 'células por preencher' };
    // carimbo
    const N = W * H * DZ;
    const parts = new Uint16Array(N * 4);
    const ground = D.tilesets[s.tileset].ids.ground;
    const nodes = [], starts = [], terrainTiles = [];
    for (const p of P) {
      if (p.removed) continue;
      const special = p.kind === 'craft' || p.kind === 'ufo';
      let c = D.getCompiled(p.id, special ? undefined : s.tileset);
      if (p.rot) c = D.rotateCompiled(c, p.rot);
      const ox = p.x * 10, oy = p.y * 10;
      const map = (si) => { const [x, y, z] = xyz(c, si); return (z * H + oy + y) * W + ox + x; };
      if (special) for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) parts[((oy + y) * W + ox + x) * 4] = ground;
      for (let si = 0; si < c.w * c.h * Math.min(c.d, DZ); si++) {
        if (special && !c.mask[si]) continue;
        parts.set(c.parts.subarray(si * 4, si * 4 + 4), map(si) * 4);
        if (!special && si < c.w * c.h) terrainTiles.push(map(si));
      }
      for (const nd of c.nodes) if (nd.z < DZ) nodes.push(map(at(c, nd.x, nd.y, nd.z)));
      if (p.kind === 'craft' || (!special && c.startTiles.length)) for (const si of c.startTiles) starts.push(map(si));
    }
    return { P, map: { w: W, h: H, d: DZ, parts }, nodes, starts, terrainTiles };
  }

  t.test('scripts: simulação de referência — mapas completos, ligados dos inícios X-COM a todos os nós', () => {
    const seeds = t.args.seeds ? +t.args.seeds : 3;
    const runs = [];
    for (const id of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN']) {
      for (const u in D.ufos) {
        const m = D.ufos[u].map;
        runs.push([id, [m.w, m.h, m.d], { ufoType: u, craftType: 'skyranger' }]);
      }
    }
    const dm = (dep) => { const m = D.deployments[dep].map; return [m.w, m.h, m.d]; };
    runs.push(['URBAN', dm('dep_terror_site'), { ufoType: null, craftType: 'skyranger' }]);
    runs.push(['URBAN', dm('dep_terror_site'), { ufoType: null, craftType: 'avenger' }]);
    runs.push(['ALIENBASE', dm('dep_alien_base'), { ufoType: null, craftType: 'skyranger' }]);
    runs.push(['MARS', dm('dep_cydonia'), { ufoType: null, craftType: 'avenger' }]);
    const blockUse = {};
    for (const [id, size, spec] of runs) {
      const s = D.mapScripts[id];
      t.ok(Object.values(s.sizes).some((z) => z.join() === size.join()), id + ' tamanho ' + size + ' previsto');
      for (let seed = 1; seed <= seeds * (spec.ufoType ? 1 : 8); seed++) {
        let r = null;
        for (let variant = 0; variant < 5 && !(r && !r.error); variant++) r = simulate(s, size, spec, seed * 7919 + variant);
        const tag = id + ' ' + size.join('×') + ' ' + (spec.ufoType || spec.craftType) + ' semente ' + seed;
        t.ok(r && !r.error, tag + ': ' + (r && r.error));
        if (spec.ufoType) t.ok(r.P.some((p) => p.kind === 'ufo'), tag + ' sem OVNI');
        t.ok(r.starts.length >= 14, tag + ' inícios ' + r.starts.length);
        for (const p of r.P) if (!p.removed) blockUse[p.id] = (blockUse[p.id] || 0) + 1;
        const seen = flood(r.map, r.starts);
        const lostNodes = r.nodes.filter((i) => !seen.has(i));
        t.ok(lostNodes.length === 0, tag + ': nós inacessíveis ' + lostNodes.slice(0, 3).map((i) => xyz(r.map, i)).join(' | '));
        const lost = r.terrainTiles.filter((i) => standable(r.map, i, true) && !seen.has(i));
        t.ok(lost.length === 0, tag + ': ' + lost.length + ' tiles de terreno isolados, ex. ' + (lost.length ? xyz(r.map, lost[0]) : ''));
        if (id === 'ALIENBASE') t.ok(r.P.some((p) => p.id === 'ALIENBASE_COMMAND') && r.P.some((p) => p.id === 'ALIENBASE_LIFT'), tag + ' elevador + comando');
        if (id === 'MARS') t.ok(r.P.some((p) => p.id === 'MARS_PYRAMID'), tag + ' pirâmide');
        if (id === 'URBAN' && !spec.ufoType) t.ok(r.P.some((p) => ROADS[p.id] && !p.removed), tag + ' sem estradas');
      }
    }
    // a simulação usa uma boa parte dos blocos (variedade)
    const usedIds = Object.keys(blockUse).filter((k) => ALL.includes(k));
    t.ok(usedIds.length >= ALL.length * 0.8, 'blocos usados na simulação: ' + usedIds.length + '/' + ALL.length);
  });
};
