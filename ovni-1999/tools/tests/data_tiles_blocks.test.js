/* Testes do modelo de tiles e dos blocos (DESIGN.md §7.1, §7.2, §7.4, §7.5, §3.12) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const defs = D.tileDefs;
  const UFO_BLOCKS = {
    small_scout: 'UFO_SMALL_SCOUT', medium_scout: 'UFO_MEDIUM_SCOUT', large_scout: 'UFO_LARGE_SCOUT', harvester: 'UFO_HARVESTER',
    abductor: 'UFO_ABDUCTOR', supply_ship: 'UFO_SUPPLY_SHIP', terror_ship: 'UFO_TERROR_SHIP', battleship: 'UFO_BATTLESHIP',
  };
  // DESIGN §3.12, coluna «Power sources»
  const POWER = { small_scout: 1, medium_scout: 1, large_scout: 1, harvester: 2, abductor: 2, supply_ship: 4, terror_ship: 4, battleship: 4 };
  const SETS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS', 'UFO', 'CRAFT'];

  const id = (key) => D.tileId(key);
  const at = (c, x, y, z) => (z * c.h + y) * c.w + x;
  const part = (c, i, p) => defs[c.parts[i * 4 + p]];
  const xyz = (c, i) => [i % c.w, ((i / c.w) | 0) % c.h, (i / (c.w * c.h)) | 0];
  const block = (o) => Object.assign({ id: 'TESTE', set: 'FARM', w: 10, h: 10 }, o);
  const blank = (fill) => Array.from({ length: 10 }, () => fill.repeat(10));

  // caminhável: chão presente, objeto ausente/transponível (portas abrem-se), paredes entre tiles
  function walker(c) {
    const edgeOk = (def) => !def || def.tu < 255 || !!def.door;
    const stand = (i) => {
      const f = part(c, i, 0), o = part(c, i, 3);
      return !!f && (!o || !!o.door || (o.tu < 255 && !o.fullBlock));
    };
    const plane = c.w * c.h;
    return function flood(start) {
      const seen = new Set([start]);
      const q = [start];
      while (q.length) {
        const i = q.pop();
        const [x, y, z] = xyz(c, i);
        const next = [];
        if (y > 0 && edgeOk(part(c, i, 2))) next.push(at(c, x, y - 1, z));
        if (y < c.h - 1 && edgeOk(part(c, at(c, x, y + 1, z), 2))) next.push(at(c, x, y + 1, z));
        if (x > 0 && edgeOk(part(c, i, 1))) next.push(at(c, x - 1, y, z));
        if (x < c.w - 1 && edgeOk(part(c, at(c, x + 1, y, z), 1))) next.push(at(c, x + 1, y, z));
        const o = part(c, i, 3);
        for (const dz of [-1, 1]) {
          const j = i + dz * plane;
          if (z + dz < 0 || z + dz >= c.d) continue;
          const oj = part(c, j, 3);
          if (o && o.gravlift && oj && oj.gravlift) next.push(j);
          if (o && oj && o.stairs === 'foot' && dz === 1 && oj.stairs === 'head') next.push(j);
          if (o && oj && o.stairs === 'head' && dz === -1 && oj.stairs === 'foot') next.push(j);
        }
        for (const j of next) if (!seen.has(j) && stand(j)) { seen.add(j); q.push(j); }
      }
      return seen;
    };
  }

  // ---- definições -------------------------------------------------------------------------------------
  t.test('tiles: ids densos, chaves únicas, id 0 vazio', () => {
    t.eq(defs[0], null);
    const keys = new Set();
    for (let i = 1; i < defs.length; i++) {
      const d = defs[i];
      t.eq(d.id, i, 'id ' + d.key);
      t.ok(!keys.has(d.key), 'chave repetida ' + d.key);
      keys.add(d.key);
      t.eq(D.tileDefByKey[d.key], d);
      t.eq(D.tileKeys[i], d.key);
      t.ok(['floor', 'west', 'north', 'object'].includes(d.part), d.key + ' part');
      t.ok(['earth', 'wood', 'metal', 'alloy', 'glass', 'brick'].includes(d.sfx), d.key + ' sfx ' + d.sfx);
      t.ok([0, 8, 12, 16, 24].includes(d.height), d.key + ' altura ' + d.height);
      t.ok([0, 2, 3].includes(d.diagonal), d.key + ' diagonal');
      t.ok(Number.isInteger(d.colour) && d.colour >= 0 && d.colour <= 0xffffff, d.key + ' cor');
      t.ok(d.variantCount >= 1 && typeof d.art === 'string' && typeof d.mat === 'string', d.key + ' arte');
      t.ok(d.tu >= 0 && d.tu <= 255 && d.armour >= 0 && d.armour <= 255, d.key + ' tu/armadura');
      for (const f of ['die', 'alt', 'pair', 'mirror', 'upper', 'lower']) t.ok(d[f] === 0 || !!defs[d[f]], d.key + '.' + f);
    }
    t.throws(() => D.tileId('FARM.inexistente'));
  });

  t.test('tilesets: todos os papéis resolvem com a parte certa e têm paleta', () => {
    const expectPart = {};
    for (const ch in D.legend) {
      for (const p of ['floor', 'west', 'north', 'object']) {
        const r = D.legend[ch][p];
        if (r) expectPart[r] = p === 'north' ? 'west' : p; // arestas são definidas como oeste + gémea norte
      }
    }
    for (const s of SETS) {
      const ts = D.tilesets[s];
      t.ok(ts && ts.id === s, 'tileset ' + s);
      for (const k of ['ground', 'ground2', 'road', 'inner', 'wall', 'roof', 'accent']) t.ok(Number.isInteger(ts.palette[k]), s + ' paleta ' + k);
      t.eq(ts.roles.air, null);
      for (const role of D.TILE_ROLES) {
        if (role === 'air') continue;
        const def = D.tileDefByKey[ts.roles[role]];
        t.ok(def && def.role === role && ts.ids[role] === def.id, s + '.' + role);
        if (expectPart[role]) t.eq(def.part, expectPart[role], s + '.' + role + ' parte');
      }
    }
  });

  t.test('tilesets: todos os carateres da legenda resolvem em todos os tilesets (z0 e z>0)', () => {
    const chars = Object.keys(D.legend);
    const lower = chars.filter((ch) => D.legend[ch].floor);
    for (const s of SETS) {
      const z = (list, fill) => {
        const rows = blank(fill || '.');
        list.forEach((ch, k) => {
          const y = (k / 10) | 0, x = k % 10;
          rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
        });
        return rows;
      };
      // sem escadas nem elevadores (exigem par); verificados à parte
      const noLinks = (ch) => !'sSg'.includes(ch);
      const c0 = D.compileBlock(block({ levels: [z(lower.filter(noLinks))] }), s);
      t.ok(c0.parts.some((v) => v), s + ' z0');
      const c1 = D.compileBlock(block({ levels: [blank('='), z(chars.filter(noLinks), '~')] }), s);
      t.eq(c1.d, 2, s + ' d');
      for (const ch of chars.filter(noLinks)) {
        const spec = D.legend[ch];
        const k = chars.filter(noLinks).indexOf(ch);
        const i = at(c1, k % 10, (k / 10) | 0, 1);
        for (const [p, slot] of [['floor', 0], ['west', 1], ['north', 2], ['object', 3]]) {
          const v = c1.parts[i * 4 + slot];
          if (spec[p]) t.ok(v && defs[v].role === spec[p] && defs[v].part === p && defs[v].set === s, s + ' «' + ch + '» ' + p);
          else t.eq(v, 0, s + ' «' + ch + '» ' + p + ' vazio');
        }
      }
    }
  });

  t.test('legenda: exatamente a tabela do DESIGN §7.2', () => {
    const E = {
      '.': ['ground'], ',': ['ground', 0, 0, 'crop'], '_': ['road'], '=': ['inner'], 'R': ['roof'], '~': [],
      'X': ['craftFloor'], 'r': ['craftRamp'], '|': ['inner', 'wall'], '-': ['inner', 0, 'wall'], '+': ['inner', 'wall', 'wall'],
      '!': ['ground', 'wall'], '^': ['ground', 0, 'wall'], 'L': ['ground', 'wall', 'wall'],
      ']': [0, 'wall'], ';': [0, 0, 'wall'], '}': [0, 'wall', 'wall'],
      'd': ['inner', 'door'], 'D': ['inner', 0, 'door'], 'e': ['ground', 'door'], 'E': ['ground', 0, 'door'],
      'i': ['inner', 'window'], 'I': ['inner', 0, 'window'], 'j': ['ground', 'window'], ')': [0, 'window'], ':': [0, 0, 'window'],
      'f': ['ground', 'fence'], 'F': ['ground', 0, 'fence'], '#': ['ground', 0, 0, 'rock'], 'T': ['ground', 0, 0, 'tree'],
      'b': ['ground', 0, 0, 'bush'], 'h': ['ground', 0, 0, 'hedge'], 'c': ['inner', 0, 0, 'crate'], 't': ['inner', 0, 0, 'table'],
      'B': ['inner', 0, 0, 'bed'], 'k': ['inner', 0, 0, 'cabinet'], 'l': ['ground', 0, 0, 'lamp'], 'C': ['road', 0, 0, 'car'],
      's': ['inner', 0, 0, 'stairsFoot'], 'S': ['inner', 0, 0, 'stairsHead'], 'g': ['inner', 0, 0, 'gravlift'],
      'H': ['inner', 0, 0, 'hull'], '/': ['inner', 0, 0, 'hullDiag2'], '\\': ['inner', 0, 0, 'hullDiag3'],
      'O': ['inner', 0, 0, 'ufoDoor'], 'P': ['inner', 0, 0, 'powerSource'], 'n': ['inner', 0, 0, 'navigation'],
      'u': ['inner', 0, 0, 'device'], '@': ['inner', 0, 0, 'objective'],
    };
    for (let r = 1; r <= 6; r++) E[String(r)] = ['inner', 0, 0, 0, r];
    t.eq(Object.keys(D.legend).sort(), Object.keys(E).sort(), 'conjunto de carateres');
    for (const ch in E) {
      const [floor, west, north, object, node] = E[ch];
      t.eq(D.legend[ch], { floor: floor || null, west: west || null, north: north || null, object: object || null, node: node || null }, '«' + ch + '»');
    }
    t.eq(D.NODE_RANKS.slice(1), ['soldier', 'engineer', 'navigator', 'leader', 'medic', 'terrorist']);
    t.eq(D.NODE_RANK.commander, 4);
  });

  t.test('tiles: cadeias die, portas alt, gémeas e materiais por tileset', () => {
    for (const s of SETS) {
      const g = (r) => defs[id(s + '.' + r)];
      t.eq(g('wall').die, id(s + '.rubbleWall'), s + ' parede → entulho');
      t.eq(defs[g('wall').pair].die, id(s + '.rubbleWall.n'), s + ' parede norte → entulho norte');
      for (const r of ['tree', 'crate', 'table', 'rock', 'powerSource', 'navigation', 'objective']) t.eq(g(r).die, id(s + '.rubbleObject'), s + ' ' + r);
      t.eq(g('car').die, id(s + '.wreck'));
      t.eq(g('window').die, id(s + '.windowBroken'));
      for (const r of ['ground', 'road', 'inner', 'roof']) {
        t.eq(g(r).die, id(s + '.scorched'), s + ' ' + r + ' z0 → queimado');
        t.eq(defs[g(r).upper].die, 0, s + ' ' + r + ' z>0 → buraco');
        t.eq(defs[g(r).upper].lower, g(r).id);
      }
      t.eq(g('door').alt, id(s + '.doorOpen'));
      t.eq(g('doorOpen').alt, id(s + '.door'));
      t.ok(g('doorOpen').open && g('doorOpen').tu < 255 && !g('doorOpen').blockLOS);
      t.eq(defs[g('door').pair].alt, id(s + '.doorOpen.n'), s + ' porta norte abre para porta norte');
      t.eq(g('ufoDoor').alt, id(s + '.ufoDoorOpen'));
      t.eq(g('ufoDoorOpen').alt, id(s + '.ufoDoor'));
      t.ok(g('ufoDoor').fullBlock && g('ufoDoor').door === 'ufo' && !g('ufoDoorOpen').fullBlock);
      t.eq(g('hullDiag2').mirror, id(s + '.hullDiag3'));
      t.eq(g('hullDiag3').diagonal, 3);
      t.ok(g('hullDiag2').fullBlock);
      t.eq(g('stairsFoot').stairs, 'foot');
      t.eq(g('stairsHead').stairs, 'head');
      t.ok(g('gravlift').gravlift && g('gravlift').armour === 255, s + ' elevador indestrutível');
      t.eq(g('powerSource').special, 'POWER_SOURCE');
      t.eq(g('powerSource').explosive.radius, 6);
      t.eq(g('powerSource').explosive.power, [120, 180]);
      t.eq(g('car').explosive, { power: [40, 40], radius: 3, type: 'HE' });
      t.eq(g('lamp').light, 12);
      t.eq(g('craftFloor').special, 'START');
      t.eq(g('craftRamp').special, 'CRAFT');
      t.eq(g('crop').tu, 2);
      t.eq(g('bush').tu, 4);
      // OVNI e nave: estrutura toda indestrutível (casco selado)
      const thin = s === 'UFO' || s === 'CRAFT' ? 255 : 10;
      t.ok(g('window').tu === 255 && !g('window').blockLOS && g('window').armour === thin, s + ' janela');
      t.ok(g('fence').tu === 255 && !g('fence').blockLOS && g('fence').armour === thin, s + ' vedação');
    }
    const hull = (s) => defs[id(s + '.hull')].armour;
    t.eq([hull('UFO'), hull('CRAFT'), hull('ALIENBASE'), hull('MARS')], [255, 255, 100, 60]);
    t.eq(defs[id('UFO.ufoDoor')].armour, 255);
    t.eq(defs[id('UFO.wall')].armour, 255);
    const mat = (k) => defs[id(k)].mat;
    t.eq([mat('FARM.wall'), mat('FOREST.wall'), mat('URBAN.wall'), mat('UFO.wall'), mat('ALIENBASE.wall'), mat('MARS.wall')],
      ['brick', 'timber', 'concrete', 'alloy', 'alloy', 'regolith']);
    t.ok(defs[id('FOREST.wall')].flammable < 255 && defs[id('FARM.wall')].flammable === 255);
    t.ok(defs[id('FARM.tree')].flammable < 255 && defs[id('MARS.tree')].flammable === 255);
  });

  // ---- blocos -----------------------------------------------------------------------------------------
  t.test('blocos: todos os registados compilam (incluindo os de outros ficheiros)', () => {
    t.ok(!OV.__finalizeError || !/tiles\./.test(OV.__finalizeError.message), OV.__finalizeError && OV.__finalizeError.message);
    for (const k in D.blocks) {
      t.ok(D.compiled[k], 'compilado ' + k);
      t.eq(D.compiled[k].parts.length, D.compiled[k].w * D.compiled[k].h * D.compiled[k].d * 4);
    }
    for (const u in UFO_BLOCKS) t.ok(D.compiled[UFO_BLOCKS[u]], UFO_BLOCKS[u]);
    t.ok(D.compiled.CRAFT_SKYRANGER && D.compiled.CRAFT_AVENGER);
  });

  t.test('OVNIs: porta «O» em z0, fontes de energia (§3.12), navegação e dimensões', () => {
    for (const u in UFO_BLOCKS) {
      const c = D.compiled[UFO_BLOCKS[u]];
      t.eq(c.ufo, u);
      t.ok(c.tags.includes('ufo'));
      t.ok(c.ufoDoors.some((i) => xyz(c, i)[2] === 0), u + ' sem porta em z0');
      t.eq(c.specials.POWER_SOURCE.length, POWER[u], u + ' fontes de energia');
      const rule = D.ufos && D.ufos[u];
      if (rule) {
        t.eq(c.specials.POWER_SOURCE.length, rule.powerSources, u + ' = ufos.js');
        t.eq(c.specials.NAVIGATION.length, rule.navigation, u + ' navegação = ufos.js');
        t.eq([c.w, c.h], [rule.blockSize.w, rule.blockSize.h], u + ' dimensões');
        t.eq(c.decks, rule.decks, u + ' conveses');
        t.eq(c.id, rule.block);
      }
      t.ok(c.d <= 3, u + ' cabe num mapa de 3 níveis');
      t.ok(c.nodes.length > 0 && c.nodes.every((nd) => nd.rank >= 1 && nd.rank <= 6), u + ' nós');
    }
    t.ok(D.compiled.UFO_TERROR_SHIP.nodes.some((nd) => nd.rank === 6), 'nave de terror com nós de terror');
  });

  t.test('OVNIs: de cada porta chega-se a todos os nós alienígenas, em todos os conveses', () => {
    for (const u in UFO_BLOCKS) {
      const c = D.compiled[UFO_BLOCKS[u]];
      const flood = walker(c);
      for (const door of c.ufoDoors) {
        const seen = flood(door);
        for (const nd of c.nodes) t.ok(seen.has(at(c, nd.x, nd.y, nd.z)), u + ': nó ' + JSON.stringify(nd) + ' inacessível da porta ' + xyz(c, door));
        if (c.decks > 1) t.ok(c.gravlifts.every((i) => seen.has(i)), u + ' elevadores');
      }
    }
  });

  t.test('OVNIs: regra do tejadilho (topo e casco sob «~» com chão em z+1; exterior sem tejadilho)', () => {
    const roofUp = id('UFO.roof.up');
    const s = D.compiled.UFO_SMALL_SCOUT;
    t.eq(s.d, 2);
    const src = D.blocks.UFO_SMALL_SCOUT.levels[0];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const roof = s.parts[at(s, x, y, 1) * 4];
        if (src[y][x] === '.') t.eq(roof, 0, 'exterior ' + x + ',' + y);
        else t.eq(roof, roofUp, 'tejadilho ' + x + ',' + y);
      }
    }
    const a = D.compiled.UFO_ABDUCTOR;
    const L = D.blocks.UFO_ABDUCTOR.levels;
    t.eq(a.d, 3);
    let lowerRoofs = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const c0 = L[0][y][x], c1 = L[1][y][x];
        const f1 = a.parts[at(a, x, y, 1) * 4], f2 = a.parts[at(a, x, y, 2) * 4];
        if (c0 !== '.' && c1 === '~') { t.eq(f1, roofUp, 'casco inferior coberto ' + x + ',' + y); lowerRoofs++; }
        if (c0 === '.') t.eq(f1, 0);
        if (c1 !== '~') {
          t.eq(f2, roofUp, 'convés superior coberto ' + x + ',' + y);
          t.eq(defs[f1].role === 'inner' || defs[f1].role === 'roof', true);
          t.eq(defs[f1].die, 0, 'chão em z1 morre para buraco');
        } else t.eq(f2, 0);
      }
    }
    t.ok(lowerRoofs > 20, 'tejadilho do convés inferior');
    t.ok(a.mask[at(a, 3, 7, 1)] === 1 && a.mask[at(a, 0, 0, 0)] === 0, 'máscara de estrutura');
    // terreno: sem regra automática
    const farm = D.compileBlock(block({ levels: [blank('=')] }));
    t.eq(farm.d, 1);
  });

  t.test('naves: inícios, rampa sem tejadilho e todos os lugares acessíveis da rampa', () => {
    const sky = D.compiled.CRAFT_SKYRANGER, av = D.compiled.CRAFT_AVENGER;
    t.eq([sky.w, sky.h, sky.d], [10, 20, 2]);
    t.eq([av.w, av.h, av.d], [10, 20, 2]);
    t.eq(sky.startTiles.length, 30);
    t.ok(sky.startTiles.length >= ((D.crafts && D.crafts.skyranger.seats) || 14), 'lugares do Skyranger');
    t.ok(av.startTiles.length >= ((D.crafts && D.crafts.avenger.seats) || 26), 'lugares do Avenger');
    for (const c of [sky, av]) {
      t.eq(c.specials.CRAFT.length, 4, c.id + ' rampa 2×2');
      t.eq(c.craftTiles.length, c.startTiles.length + 4);
      t.ok(c.startTiles.every((i) => part(c, i, 0).special === 'START'));
      t.eq(c.specials.POWER_SOURCE.length + c.specials.NAVIGATION.length + c.specials.DEVICE.length, 0, c.id + ' sem recuperáveis');
      for (const i of c.specials.CRAFT) t.eq(c.parts[(i + c.w * c.h) * 4], 0, c.id + ' rampa a céu aberto');
      for (const i of c.startTiles) t.eq(defs[c.parts[(i + c.w * c.h) * 4]].role, 'roof', c.id + ' porão coberto');
      const seen = walker(c)(c.specials.CRAFT[0]);
      for (const i of c.startTiles) t.ok(seen.has(i), c.id + ' início inacessível ' + xyz(c, i));
      t.eq(defs[id('CRAFT.hull')].armour, 255);
      t.ok(c.parts.every((v) => !v || defs[v].set === 'CRAFT'));
    }
  });

  // ---- rotação ----------------------------------------------------------------------------------------
  const ROT_BLOCK = block({
    id: 'TESTE_ROT', tags: ['teste'], nodes: [[8, 8, 0, 0, 3]],
    levels: [[
      '..........',
      '.+--D--!..',
      '.|==1==!..',
      '.d=/\\==j..',
      '.|=\\/=s!..',
      '.^^^E^^...',
      '..........',
      '....#.....',
      '..T...b...',
      '..........',
    ], [
      '~~~~~~~~~~',
      '~+-----]~~',
      '~|=====]~~',
      '~|=====)~~',
      '~|====S]~~',
      '~;;;;;;~~~',
      '~~~~~~~~~~',
      '~~~~~~~~~~',
      '~~~~~~~~~~',
      '~~~~~~~~~~',
    ]],
  });

  t.test('rotação: 4 quartos devolvem o bloco idêntico', () => {
    const list = Object.keys(D.compiled).map((k) => D.compiled[k]).concat([D.compileBlock(ROT_BLOCK)]);
    for (const c of list) {
      const r4 = D.rotateCompiled(c, 4);
      t.eq(r4.parts, c.parts, c.id + ' partes');
      t.eq(r4.mask, c.mask, c.id + ' máscara');
      t.eq([r4.w, r4.h, r4.d, r4.rot, r4.droppedEdges], [c.w, c.h, c.d, 0, 0], c.id);
      t.eq(r4.nodes, c.nodes);
      t.eq(r4.specials, c.specials);
      t.eq([r4.startTiles, r4.craftTiles, r4.ufoDoors, r4.gravlifts, r4.stairs], [c.startTiles, c.craftTiles, c.ufoDoors, c.gravlifts, c.stairs]);
      let r = c;
      for (let k = 0; k < 4; k++) r = D.rotateCompiled(r, 1);
      t.eq(r.parts, c.parts, c.id + ' 4×1');
      t.eq(D.rotateCompiled(c, -1).parts, D.rotateCompiled(c, 3).parts, c.id + ' −1 = 3');
    }
  });

  t.test('rotação: paredes, diagonais, nós e especiais movem-se corretamente (90° horário)', () => {
    const c = D.compileBlock(ROT_BLOCK);
    const r = D.rotateCompiled(c, 1);
    t.eq([r.w, r.h, r.rot], [10, 10, 1]);
    const R = (x, y) => [c.h - 1 - y, x]; // (x,y) → (x',y')
    const wall = id('FARM.wall'), wallN = id('FARM.wall.n');
    // parede oeste de (1,2) → parede norte de (7,1)
    let [x, y] = R(1, 2);
    t.eq(r.parts[at(r, x, y, 0) * 4 + 2], wallN, 'oeste → norte');
    // parede norte de (2,1) → parede oeste do vizinho leste de (8,2) = (9,2)
    [x, y] = R(2, 1);
    t.eq(r.parts[at(r, x + 1, y, 0) * 4 + 1], wall, 'norte → oeste do vizinho leste');
    // porta norte «D» de (4,1) → porta oeste
    [x, y] = R(4, 1);
    t.eq(r.parts[at(r, x + 1, y, 0) * 4 + 1], id('FARM.door'), 'porta norte → porta oeste');
    t.eq(defs[r.parts[at(r, x + 1, y, 0) * 4 + 1]].alt, id('FARM.doorOpen'));
    // diagonal «/» (2) passa a «\» (3)
    [x, y] = R(3, 3);
    t.eq(defs[r.parts[at(r, x, y, 0) * 4 + 3]].diagonal, 3);
    [x, y] = R(4, 3);
    t.eq(defs[r.parts[at(r, x, y, 0) * 4 + 3]].diagonal, 2);
    // objetos e chão acompanham o tile
    [x, y] = R(4, 7);
    t.eq(defs[r.parts[at(r, x, y, 0) * 4 + 3]].role, 'rock');
    [x, y] = R(6, 4);
    t.eq(r.stairs, [at(r, x, y, 0)]);
    t.eq(defs[r.parts[at(r, x, y, 1) * 4 + 3]].stairs, 'head');
    // nós
    const n1 = r.nodes.find((nd) => nd.rank === 1);
    t.eq([n1.x, n1.y, n1.z], R(4, 2).concat([0]));
    const n0 = r.nodes.find((nd) => nd.rank === 0);
    t.eq([n0.x, n0.y, n0.prio], R(8, 8).concat([3]));
    // contagens preservadas em todas as orientações
    const count = (cc, key) => { let k = 0; for (let i = 0; i < cc.parts.length; i++) if (cc.parts[i] === id(key)) k++; return k; };
    for (let q = 0; q < 4; q++) {
      const rq = D.rotateCompiled(c, q);
      t.eq(count(rq, 'FARM.wall') + count(rq, 'FARM.wall.n'), count(c, 'FARM.wall') + count(c, 'FARM.wall.n'), 'paredes q' + q);
      t.eq(rq.droppedEdges, 0);
    }
    // OVNI rodado: portas continuam a dar acesso a todos os nós
    const ab = D.rotateCompiled(D.compiled.UFO_ABDUCTOR, 1);
    const seen = walker(ab)(ab.ufoDoors[0]);
    for (const nd of ab.nodes) t.ok(seen.has(at(ab, nd.x, nd.y, nd.z)), 'Raptor rodado ' + JSON.stringify(nd));
    t.eq(ab.specials.POWER_SOURCE.map((i) => defs[ab.parts[i * 4 + 3]].special), ['POWER_SOURCE', 'POWER_SOURCE']);
    // o original não muda
    t.eq(D.compiled.UFO_ABDUCTOR.rot, 0);
  });

  t.test('rotação: paredes na fronteira norte/oeste são contadas como perdidas', () => {
    const rows = blank('.');
    rows[0] = '.^........';
    const c = D.compileBlock(block({ levels: [rows] }));
    t.eq(D.rotateCompiled(c, 1).droppedEdges, 1);
  });

  // ---- compilador: validação --------------------------------------------------------------------------
  t.test('compilador: erros com id do bloco e linha', () => {
    const err = (b, re) => {
      let msg = '';
      try { D.compileBlock(b); } catch (e) { msg = e.message; }
      t.ok(re.test(msg) && msg.indexOf(b.id) >= 0, 'esperado ' + re + ' obtido «' + msg + '»');
    };
    const rows = blank('.');
    err(block({ id: 'B_CHAR', levels: [rows.map((r, y) => (y === 3 ? '...Q......' : r))] }), /z0 linha 3 col 3: carácter desconhecido «Q»/);
    err(block({ id: 'B_LARG', levels: [rows.map((r, y) => (y === 2 ? '.........' : r))] }), /z0 linha 2: largura 9/);
    err(block({ id: 'B_LINHAS', levels: [rows.slice(1)] }), /9 linhas/);
    err(block({ id: 'B_W', w: 15, levels: [rows] }), /largura inválida/);
    err(block({ id: 'B_NIV', levels: [rows, blank('~'), blank('~'), blank('~')] }), /4 níveis/);
    err(block({ id: 'B_AR', levels: [rows.map((r, y) => (y === 0 ? '~.........' : r))] }), /sem chão no nível 0/);
    err(block({ id: 'B_PE', levels: [rows.map((r, y) => (y === 5 ? '.....s....' : r)), blank('~')] }), /pé de escada sem cabeça/);
    err(block({ id: 'B_CABECA', levels: [blank('='), blank('~').map((r, y) => (y === 5 ? '~~~~~S~~~~' : r))] }), /cabeça de escada sem pé/);
    err(block({ id: 'B_ELEV', levels: [rows.map((r, y) => (y === 5 ? '.....g....' : r)), blank('~')] }), /elevador gravítico sem par/);
    err(block({ id: 'B_CONVES', set: 'UFO', levels: [rows, blank('~').map((r, y) => (y === 1 ? '~~~=~~~~~~' : r))] }), /convés superior sem casco/);
    err(block({ id: 'B_SET', set: 'LUA', levels: [rows] }), /set desconhecido/);
    err(block({ id: 'B_RANK', levels: [rows], nodes: [[1, 1, 0, 9]] }), /patente inválida/);
    err(block({ id: 'B_NO', levels: [rows.map((r, y) => (y === 1 ? '.#........' : r))], nodes: [[1, 1, 0, 1]] }), /nó num tile não caminhável/);
    err(block({ id: 'B_LEG', legend: { Z: { floor: 'ground', object: 'pedra' } }, levels: [rows.map((r, y) => (y === 1 ? '.Z........' : r))] }), /papel desconhecido «pedra»/);
    // erros agregados
    let e1 = null;
    try {
      D.compileBlock(block({ id: 'B_VARIOS', levels: [rows.map((r, y) => (y === 1 ? 'QQ........' : r))] }));
    } catch (e) { e1 = e; }
    t.ok(e1 && e1.errors.length === 2, 'dois erros agregados');
    // o finalizador agrega erros de vários blocos
    const fin = D.finalizers.find((f) => f.name === 'tiles.compile');
    let msg = '';
    try {
      fin.fn({ blocks: { B1: block({ id: 'B1', levels: [['?']] }), B2: block({ id: 'B2', w: 7, levels: [rows] }) }, compiled: {} });
    } catch (e) { msg = e.message; }
    t.ok(/B1/.test(msg) && /B2/.test(msg), 'finalizador agrega: ' + msg);
  });

  t.test('compilador: escadas s↔S, legenda própria do bloco, nós e chave direta', () => {
    const c = D.compileBlock(block({
      legend: { Y: { floor: 'inner', object: 'URBAN.car' }, Z: { floor: 'inner', node: 0 } },
      nodes: [[0, 9, 0, 2, 9]],
      levels: [
        blank('=').map((r, y) => (y === 2 ? '==s==Y==Z=' : r)),
        blank('~').map((r, y) => (y === 2 ? '~~S~~~~~~~' : r)),
      ],
    }));
    t.eq(c.stairs, [at(c, 2, 2, 0)]);
    t.eq(defs[c.parts[at(c, 5, 2, 0) * 4 + 3]].key, 'URBAN.car');
    t.eq(c.nodes, [{ x: 8, y: 2, z: 0, rank: 0, prio: 5 }, { x: 0, y: 9, z: 0, rank: 2, prio: 9 }]);
    t.eq(defs[c.parts[at(c, 2, 2, 1) * 4]].key, 'FARM.inner.up', 'chão em z1 usa a gémea superior');
    t.eq(defs[c.parts[at(c, 0, 0, 0) * 4]].key, 'FARM.inner');
    t.eq([c.weight, c.maxUses, c.tags], [1, 0, []]);
  });

  t.test('levelRows: texto numerado e grelha completa', () => {
    const a = D.levelRows(10, 10, '.', '\n   2 ...HH.....\n  9 ........H.\n');
    t.eq(a.length, 10);
    t.eq(a[2], '...HH.....');
    t.eq(a[9], '........H.');
    t.eq(a[0], '..........');
    const b = D.levelRows(10, 2, '.', '\n  ..........\n  .H........\n');
    t.eq(b, ['..........', '.H........']);
    t.throws(() => D.levelRows(10, 10, '.', ' 12 ..........'));
  });

  t.test('getCompiled: o mesmo bloco noutro tileset (paleta alternativa) e memorização', () => {
    const c = D.getCompiled('UFO_SMALL_SCOUT');
    t.eq(c, D.compiled.UFO_SMALL_SCOUT);
    const m = D.getCompiled('UFO_SMALL_SCOUT', 'MARS');
    t.eq(m, D.getCompiled('UFO_SMALL_SCOUT', 'MARS'), 'memorizado');
    t.eq(m.tileset, 'MARS');
    t.ok(m.parts.every((v) => !v || defs[v].set === 'MARS'));
    t.eq(m.specials.POWER_SOURCE.length, 1);
    t.throws(() => D.getCompiled('NAO_EXISTE'));
  });

  t.test('dados imutáveis depois do finalize', () => {
    if (!OV.Data.isFinal || !OV.Data.isFinal()) return;
    t.ok(Object.isFrozen(defs) && Object.isFrozen(defs[1]) && Object.isFrozen(D.tilesets.FARM.roles));
    t.ok(Object.isFrozen(D.compiled.UFO_BATTLESHIP.nodes));
    const r = D.rotateCompiled(D.compiled.UFO_BATTLESHIP, 2);
    t.ok(!Object.isFrozen(r) && r.parts !== D.compiled.UFO_BATTLESHIP.parts, 'rotação devolve cópia editável');
  });
};
