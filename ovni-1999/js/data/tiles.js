/* Modelo de tiles do Battlescape (DESIGN.md §7.1, §7.2, §6): definições de partes com ids numéricos
   globais, conjuntos de tiles por terreno (papel → definição + paleta), legenda ASCII dos blocos,
   compilador de blocos (com a regra do tejadilho dos OVNIs) e rotação de blocos compilados.

   OV.Data.tileDefs[id]          definição de parte; id 0 = vazio (null)
   OV.Data.tileDefByKey[key]     chaves 'SET.papel' ('FARM.wall'); gémea norte 'SET.papel.n' (arestas);
                                 chão de níveis z>0 'SET.papel.up' (morre para 0 = buraco)
   OV.Data.tileId(key)           id numérico (lança se a chave não existir); OV.Data.tileKeys[id] = chave
   OV.Data.tilesets[id]          {id, nameKey, hull, roles:{papel→chave|null}, ids:{papel→id}, palette:{…}}
   OV.Data.legend[char]          {floor, west, north, object, node} (papéis; node = patente 0..6)
   OV.Data.blocks[id]            registo de blocos ASCII (blocks_*.js acrescentam)
   OV.Data.compileBlock(def, tilesetId?) → {id, set, tileset, w, h, d, authored, parts:Uint16Array(w·h·d·4)
                                 [chão, oeste, norte, objeto] por i=(z·h+y)·w+x, mask:Uint8Array (1 = estrutura,
                                 0 = '.'/'~' simples), nodes:[{x,y,z,rank,prio}], startTiles, craftTiles, specials:
                                 {POWER_SOURCE,NAVIGATION,DEVICE,OBJECTIVE,START,CRAFT:[i]}, ufoDoors, gravlifts,
                                 stairs (pés), tags, weight, maxUses (0 = sem limite), ufo, craft, decks, rot, droppedEdges}
   OV.Data.rotateCompiled(c, quartos) → cópia rodada 90°·quartos no sentido horário
   OV.Data.compiled[id]          compilados no finalize (tileset do próprio bloco)
   OV.Data.getCompiled(id, tilesetId?) → compilado noutro tileset (memorizado; ex. FOREST com paleta JUNGLE)
   OV.Data.levelRows(w, h, fill, texto) → linhas de um nível a partir de texto (numerado ou grelha completa) */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  const TUNE = OV.TUNE || {};
  // finalize.js carrega no fim de js/data/ e reaproveita esta lista (mesma semântica de registo)
  D.finalizers = D.finalizers || [];
  D.onFinalize = D.onFinalize || function (name, fn, order) {
    D.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };

  const PARTS = ['floor', 'west', 'north', 'object']; // índice da parte no tile (CONVENTIONS §8)
  const MAX_LEVELS = 3;
  const NODE_PRIO = 5; // prioridade dos nós de patrulha escritos na legenda
  const HULL_SETS = new Set(['UFO', 'CRAFT']); // blocos com regra do tejadilho
  const SETS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS', 'UFO', 'CRAFT'];
  const TU_WALK = TUNE.TU_WALK || 4;
  const LIGHT_LAMP = TUNE.LIGHT_LAMP || 12;
  const LIGHT_UFO = TUNE.LIGHT_UFO || 10;
  const PS_BLAST = (D.ufoRules && D.ufoRules.powerSourceBlast) || { power: [120, 180], radius: 6, type: 'HE' };

  // patentes dos nós (DESIGN §7.4): dígito da legenda → patente; 0 = batedor/exterior
  const NODE_RANKS = ['scout', 'soldier', 'engineer', 'navigator', 'leader', 'medic', 'terrorist'];
  const NODE_RANK = { scout: 0, soldier: 1, engineer: 2, navigator: 3, leader: 4, commander: 4, medic: 5, terrorist: 6 };
  // preferência de nós por patente (orig Node::nodeRank adaptado; terroristas preferem os nós 6)
  const NODE_RANK_PREFS = {
    commander: [4, 3, 2, 5, 1], leader: [4, 3, 2, 5, 1], engineer: [2, 4, 3, 1], medic: [5, 1, 3, 4],
    navigator: [3, 4, 2, 1], soldier: [1, 6, 2, 3], terrorist: [6, 1, 2, 3],
  };

  // ---- papéis base (valores por omissão; os tilesets afinam material, armadura, cor) ---------------
  // tu: chão = custo do passo; objeto/aresta = custo extra (255 bloqueia). die/alt = papéis no mesmo set.
  const HULL = { part: 'object', tu: 255, armour: 255, heBlock: 100, height: 24, fullBlock: true, blockLOS: true, smokeBlock: true, sfx: 'alloy', mat: 'alloy' };
  const ROLE_BASE = {
    ground: { part: 'floor', armour: 40, die: 'scorched', sfx: 'earth', mat: 'grass', variantCount: 4 },
    crop: { part: 'object', tu: 2, armour: 5, height: 8, flammable: 20, fuel: 2, sfx: 'earth', mat: 'wheat', variantCount: 2 },
    road: { part: 'floor', armour: 60, die: 'scorched', sfx: 'earth', mat: 'asphalt', variantCount: 2 },
    inner: { part: 'floor', armour: 30, die: 'scorched', sfx: 'wood', mat: 'planks', variantCount: 2 },
    roof: { part: 'floor', armour: 30, die: 'scorched', sfx: 'brick', mat: 'tiles', variantCount: 2 },
    craftFloor: { part: 'floor', armour: 255, special: 'START', sfx: 'metal', mat: 'deck' },
    craftRamp: { part: 'floor', armour: 255, special: 'CRAFT', sfx: 'metal', mat: 'ramp' },
    wall: { part: 'west', tu: 255, armour: 40, heBlock: 20, blockLOS: true, smokeBlock: true, height: 24, die: 'rubbleWall', sfx: 'brick', mat: 'brick', variantCount: 2 },
    door: { part: 'west', tu: 255, armour: 20, heBlock: 10, blockLOS: true, smokeBlock: true, height: 24, door: 'swing', alt: 'doorOpen', die: 'rubbleWall', flammable: 30, fuel: 3, sfx: 'wood', mat: 'wood' },
    doorOpen: { part: 'west', tu: 0, armour: 20, height: 24, door: 'swing', open: true, alt: 'door', die: 'rubbleWall', flammable: 30, fuel: 3, sfx: 'wood', mat: 'wood' },
    window: { part: 'west', tu: 255, armour: 10, smokeBlock: true, height: 24, window: true, die: 'windowBroken', sfx: 'glass', mat: 'glass' },
    windowBroken: { part: 'west', tu: 4, armour: 10, height: 8, window: true, die: 'rubbleWall', sfx: 'glass', mat: 'glass' },
    fence: { part: 'west', tu: 255, armour: 10, height: 12, die: 'rubbleWall', flammable: 40, fuel: 2, sfx: 'wood', mat: 'wood' },
    rock: { part: 'object', tu: 255, armour: 60, heBlock: 30, height: 24, fullBlock: true, blockLOS: true, smokeBlock: true, die: 'rubbleObject', sfx: 'brick', mat: 'stone', variantCount: 3 },
    tree: { part: 'object', tu: 255, armour: 30, heBlock: 10, height: 24, fullBlock: true, blockLOS: true, flammable: 30, fuel: 4, die: 'rubbleObject', sfx: 'wood', mat: 'oak', variantCount: 3 },
    bush: { part: 'object', tu: 4, armour: 5, height: 8, flammable: 20, fuel: 2, sfx: 'wood', mat: 'shrub', variantCount: 2 },
    hedge: { part: 'object', tu: 255, armour: 10, height: 12, flammable: 30, fuel: 3, die: 'rubbleObject', sfx: 'wood', mat: 'hedge' },
    crate: { part: 'object', tu: 255, armour: 20, heBlock: 5, height: 12, flammable: 40, fuel: 4, die: 'rubbleObject', sfx: 'wood', mat: 'crate', variantCount: 2 },
    table: { part: 'object', tu: 4, armour: 15, height: 8, flammable: 40, fuel: 3, die: 'rubbleObject', sfx: 'wood', mat: 'wood' },
    bed: { part: 'object', tu: 4, armour: 15, height: 8, flammable: 30, fuel: 4, die: 'rubbleObject', sfx: 'wood', mat: 'bed' },
    cabinet: { part: 'object', tu: 255, armour: 30, heBlock: 10, height: 16, die: 'rubbleObject', sfx: 'metal', mat: 'cabinet' },
    lamp: { part: 'object', tu: 255, armour: 20, height: 24, light: LIGHT_LAMP, die: 'rubbleObject', sfx: 'metal', mat: 'post' },
    car: { part: 'object', tu: 255, armour: 30, heBlock: 10, height: 12, explosive: { power: [40, 40], radius: 3, type: 'HE' }, flammable: 50, fuel: 3, die: 'wreck', sfx: 'metal', mat: 'car', variantCount: 4 },
    stairsFoot: { part: 'object', tu: 0, armour: 40, height: 12, stairs: 'foot', die: 'rubbleObject', sfx: 'wood', mat: 'wood' },
    stairsHead: { part: 'object', tu: 0, armour: 40, height: 0, stairs: 'head', sfx: 'wood', mat: 'wood' },
    gravlift: { part: 'object', tu: 0, armour: 255, height: 0, gravlift: true, sfx: 'alloy', mat: 'alloy' },
    hull: HULL,
    hullDiag2: Object.assign({}, HULL, { diagonal: 2, mirror: 'hullDiag3' }),
    hullDiag3: Object.assign({}, HULL, { diagonal: 3, mirror: 'hullDiag2' }),
    ufoDoor: Object.assign({}, HULL, { door: 'ufo', alt: 'ufoDoorOpen' }),
    ufoDoorOpen: { part: 'object', tu: 0, armour: 255, height: 0, door: 'ufo', open: true, alt: 'ufoDoor', sfx: 'alloy', mat: 'alloy' },
    powerSource: { part: 'object', tu: 255, armour: 60, heBlock: 20, height: 16, explosive: PS_BLAST, special: 'POWER_SOURCE', light: LIGHT_UFO, die: 'rubbleObject', sfx: 'alloy', mat: 'alloy' },
    navigation: { part: 'object', tu: 255, armour: 50, heBlock: 10, height: 12, special: 'NAVIGATION', light: LIGHT_UFO, die: 'rubbleObject', sfx: 'alloy', mat: 'alloy' },
    device: { part: 'object', tu: 255, armour: 40, heBlock: 10, height: 12, special: 'DEVICE', die: 'rubbleObject', sfx: 'alloy', mat: 'alloy' },
    objective: { part: 'object', tu: 255, armour: 60, heBlock: 20, height: 24, special: 'OBJECTIVE', light: LIGHT_UFO, die: 'rubbleObject', sfx: 'alloy', mat: 'core' },
    rubbleWall: { part: 'west', tu: 2, armour: 30, height: 8, sfx: 'brick', mat: 'rubble' },
    rubbleObject: { part: 'object', tu: 2, armour: 30, height: 8, sfx: 'brick', mat: 'rubble', variantCount: 2 },
    scorched: { part: 'floor', armour: 255, sfx: 'earth', mat: 'burnt', variantCount: 2 },
    wreck: { part: 'object', tu: 255, armour: 40, heBlock: 10, height: 12, die: 'rubbleObject', sfx: 'metal', mat: 'burnt', variantCount: 2 },
  };
  // ordem estável (define os ids); 'air' não tem definição (chão vazio)
  const ROLES = ['ground', 'crop', 'road', 'inner', 'roof', 'air', 'craftFloor', 'craftRamp', 'wall', 'door', 'doorOpen',
    'window', 'windowBroken', 'fence', 'rock', 'tree', 'bush', 'hedge', 'crate', 'table', 'bed', 'cabinet', 'lamp', 'car',
    'stairsFoot', 'stairsHead', 'gravlift', 'hull', 'hullDiag2', 'hullDiag3', 'ufoDoor', 'ufoDoorOpen', 'powerSource',
    'navigation', 'device', 'objective', 'rubbleWall', 'rubbleObject', 'scorched', 'wreck'];

  // cor base por papel: [slot da paleta, fator de sombra] ou [cor fixa]
  const COLOUR_FROM = {
    ground: ['ground', 0], crop: ['ground2', 0.1], road: ['road', 0], inner: ['inner', 0], roof: ['roof', 0],
    craftFloor: ['inner', -0.1], craftRamp: ['inner', 0.12], wall: ['wall', 0], door: ['wall', -0.3], doorOpen: ['wall', -0.3],
    window: [0x9ec8d8], windowBroken: [0x7a9aa8], fence: ['wall', -0.15], rock: ['ground2', -0.25], tree: [0x3e6a2e],
    bush: [0x4f7a34], hedge: [0x3a5e2a], crate: ['accent', -0.1], table: ['inner', -0.25], bed: ['inner', 0.2],
    cabinet: ['wall', -0.2], lamp: [0x6a7078], car: [0x8a3030], stairsFoot: ['inner', -0.15], stairsHead: ['inner', -0.15],
    gravlift: ['accent', 0], hull: ['wall', 0], hullDiag2: ['wall', 0], hullDiag3: ['wall', 0], ufoDoor: ['wall', 0.15],
    ufoDoorOpen: ['wall', 0.15], powerSource: ['accent', 0], navigation: ['accent', -0.15], device: ['accent', -0.3],
    objective: ['accent', 0.1], rubbleWall: ['wall', -0.35], rubbleObject: ['ground2', -0.35], scorched: [0x2e2a26], wreck: [0x3a3634],
  };

  // sombra local (a camada de dados não depende de OV.Color): f < 0 escurece, f > 0 clareia
  function shade(c, f) {
    const m = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return (m((c >> 16) & 255) << 16) | (m((c >> 8) & 255) << 8) | m(c & 255);
  }

  // ---- tilesets: paleta + materiais + afinações por papel --------------------------------------------
  // casco/porta de OVNI/diagonais com a mesma armadura (DESIGN §7.2: 255 OVNI/nave, 100 base, 60 Marte)
  function hullFamily(armour, heBlock, mat, sfx) {
    const o = { armour, heBlock, mat, sfx };
    return { hull: o, hullDiag2: o, hullDiag3: o, ufoDoor: o, ufoDoorOpen: { armour, mat, sfx } };
  }
  const NO_FIRE = { flammable: 255, fuel: 0 };
  const nf = (o) => Object.assign({}, NO_FIRE, o);
  // adereços genéricos em interiores alienígenas (OVNI, base, Marte)
  const ALIEN_PROPS = {
    crop: nf({ mat: 'growth', sfx: 'earth' }), bush: nf({ mat: 'growth' }), hedge: nf({ mat: 'growth' }),
    tree: nf({ mat: 'organic' }), crate: nf({ mat: 'container', sfx: 'alloy' }), table: nf({ mat: 'surgery', sfx: 'alloy' }),
    bed: nf({ mat: 'pod', sfx: 'alloy' }), cabinet: { mat: 'console', sfx: 'alloy' }, lamp: { mat: 'beacon', sfx: 'alloy' },
    car: nf({ mat: 'vehicle', sfx: 'alloy' }), stairsFoot: nf({ mat: 'alloy', sfx: 'alloy' }), stairsHead: nf({ mat: 'alloy', sfx: 'alloy' }),
    door: nf({ mat: 'alloy', sfx: 'alloy' }), doorOpen: nf({ mat: 'alloy', sfx: 'alloy' }), fence: nf({ mat: 'rail', sfx: 'metal' }),
    window: { mat: 'viewport' }, windowBroken: { mat: 'viewport' }, wreck: { mat: 'alloy' }, rubbleObject: { mat: 'alloy', sfx: 'alloy' },
    rubbleWall: { mat: 'alloy', sfx: 'alloy' },
  };
  // partes estruturais indestrutíveis em OVNIs e naves X-COM
  function indestructible(roles) {
    const o = {};
    for (const r of roles) o[r] = { armour: 255 };
    return o;
  }
  const HARD = ['inner', 'roof', 'wall', 'door', 'doorOpen', 'window', 'fence', 'stairsFoot', 'stairsHead', 'cabinet', 'craftFloor', 'craftRamp'];
  // junta afinações por papel (as últimas ganham)
  function merge() {
    const out = {};
    for (const src of arguments) for (const r in src) out[r] = Object.assign({}, out[r] || {}, src[r]);
    return out;
  }

  const TILESET_SPECS = {
    FARM: {
      palette: { ground: 0x5f7f3a, ground2: 0x7d6a3e, road: 0x8a7656, inner: 0x8a6a45, wall: 0x9a6b4a, roof: 0x7a3b2e, accent: 0xd8c070 },
      roles: merge(hullFamily(80, 40, 'concrete', 'brick'), {
        ground: { mat: 'grass', flammable: 50, fuel: 1 }, crop: { mat: 'wheat', colour: 0xc0a040 }, road: { mat: 'dirt' },
        inner: { mat: 'planks', flammable: 40, fuel: 3 }, roof: { mat: 'tiles' }, wall: { mat: 'brick' },
        crate: { mat: 'hay', flammable: 10, fuel: 6, colour: 0xd8c070, sfx: 'earth' }, cabinet: { mat: 'wood', sfx: 'wood', flammable: 40, fuel: 3 },
        car: { mat: 'tractor', colour: 0x9a3a2a }, tree: { mat: 'oak' }, fence: { mat: 'wood', colour: 0x7a5a38 },
      }),
    },
    FOREST: {
      palette: { ground: 0x3f5f2e, ground2: 0x55452c, road: 0x6a5838, inner: 0x7a5a38, wall: 0x6e4e30, roof: 0x4a3a2a, accent: 0x8a6a3a },
      roles: merge(hullFamily(60, 30, 'boulder', 'brick'), {
        ground: { mat: 'forest', flammable: 50, fuel: 1 }, crop: { mat: 'fern', colour: 0x4a7a3a }, road: { mat: 'dirt' },
        inner: { mat: 'planks', flammable: 40, fuel: 3 }, roof: { mat: 'shingle', flammable: 30, fuel: 4 },
        wall: { mat: 'timber', armour: 30, heBlock: 10, flammable: 25, fuel: 5, sfx: 'wood' }, rock: { mat: 'boulder' },
        tree: { mat: 'pine', colour: 0x2f5a2e }, hedge: { mat: 'thicket' }, crate: { mat: 'logs', colour: 0x7a5a38 },
        cabinet: { mat: 'wood', sfx: 'wood', flammable: 40, fuel: 3 }, car: { mat: 'jeep', colour: 0x4a5a3a },
      }),
    },
    JUNGLE: {
      palette: { ground: 0x2f5a2a, ground2: 0x4a3a22, road: 0x5c4a30, inner: 0x6a5030, wall: 0x5a4426, roof: 0x7a6a3a, accent: 0xa08040 },
      roles: merge(hullFamily(70, 30, 'temple', 'brick'), {
        ground: { mat: 'jungle', flammable: 60, fuel: 1 }, crop: { mat: 'fern', colour: 0x3a7a3a }, road: { mat: 'mud' },
        inner: { mat: 'bamboo', flammable: 30, fuel: 3 }, roof: { mat: 'thatch', flammable: 15, fuel: 5 },
        wall: { mat: 'bamboo', armour: 25, heBlock: 10, flammable: 20, fuel: 5, sfx: 'wood' }, rock: { mat: 'mossy' },
        tree: { mat: 'palm', colour: 0x2a6a32 }, bush: { mat: 'fern', colour: 0x3a7a34 }, hedge: { mat: 'vines', colour: 0x2a5a26 },
        cabinet: { mat: 'wood', sfx: 'wood', flammable: 40, fuel: 3 }, car: { mat: 'jeep', colour: 0x5a5a32 },
      }),
    },
    DESERT: {
      palette: { ground: 0xc8a868, ground2: 0xb08a50, road: 0x9a8460, inner: 0xa08060, wall: 0xb89a6a, roof: 0x9a7a52, accent: 0x7a8a4a },
      roles: merge(hullFamily(60, 30, 'sandstone', 'brick'), {
        ground: nf({ mat: 'sand' }), crop: { mat: 'scrub', colour: 0x9a9a5a }, road: { mat: 'gravel' },
        inner: { mat: 'tile', sfx: 'brick', flammable: 255, fuel: 0 }, roof: nf({ mat: 'adobe' }),
        wall: { mat: 'adobe', armour: 40, heBlock: 15 }, rock: { mat: 'sandstone' },
        tree: { mat: 'cactus', colour: 0x6a8a4a, flammable: 40, fuel: 2 }, bush: { mat: 'scrub', colour: 0x8a8a52 },
        hedge: { mat: 'thorn', colour: 0x7a7a4a }, car: { mat: 'jeep', colour: 0xa08a5a },
      }),
    },
    MOUNTAIN: {
      palette: { ground: 0x7a7a62, ground2: 0x6a6050, road: 0x6a645a, inner: 0x7a6a50, wall: 0x8a8478, roof: 0x5a5048, accent: 0x4a5e3a },
      roles: merge(hullFamily(80, 40, 'granite', 'brick'), {
        ground: { mat: 'rocky', flammable: 70, fuel: 1 }, crop: { mat: 'grass', colour: 0x6a7a4a }, road: { mat: 'gravel' },
        inner: { mat: 'planks', flammable: 40, fuel: 3 }, roof: nf({ mat: 'slate' }), wall: { mat: 'stone', armour: 45, heBlock: 30 },
        rock: { mat: 'granite', armour: 80, heBlock: 40 }, tree: { mat: 'pine', colour: 0x34503a }, car: { mat: 'jeep', colour: 0x5a6a7a },
      }),
    },
    POLAR: {
      palette: { ground: 0xe4ecf0, ground2: 0xc8d4dc, road: 0x9aa4ac, inner: 0x8a8478, wall: 0x9aa0a8, roof: 0xb8c0c8, accent: 0xc84a3a },
      roles: merge(hullFamily(60, 30, 'ice', 'glass'), {
        ground: nf({ mat: 'snow' }), crop: nf({ mat: 'tussock', colour: 0xb0b89a }), road: nf({ mat: 'ice' }),
        inner: nf({ mat: 'metal', sfx: 'metal' }), roof: nf({ mat: 'metal', sfx: 'metal' }),
        wall: nf({ mat: 'panel', armour: 40, heBlock: 20, sfx: 'metal' }), rock: { mat: 'ice', sfx: 'glass' },
        tree: { mat: 'snowpine', colour: 0x587a6a }, bush: { mat: 'snowbush', colour: 0x8a9a8a }, hedge: nf({ mat: 'drift', colour: 0xdce4ea, sfx: 'earth' }),
        crate: { mat: 'crate' }, cabinet: { mat: 'cabinet' }, car: { mat: 'snowcat', colour: 0xc84a3a },
      }),
    },
    URBAN: {
      palette: { ground: 0x8a8a84, ground2: 0x5f7f3a, road: 0x3e3e44, inner: 0xa08a6a, wall: 0xb0a898, roof: 0x5a5a60, accent: 0xd0b040 },
      roles: merge(hullFamily(80, 40, 'pillar', 'brick'), {
        ground: nf({ mat: 'pavement', sfx: 'brick' }), crop: { mat: 'flowerbed', colour: 0x7a8a3a }, road: nf({ mat: 'asphalt' }),
        inner: { mat: 'tile', sfx: 'brick', flammable: 60, fuel: 2 }, roof: nf({ mat: 'tarmac' }),
        wall: { mat: 'concrete', armour: 45, heBlock: 30 }, fence: nf({ mat: 'railing', sfx: 'metal', colour: 0x5a5e66 }),
        rock: { mat: 'concrete' }, tree: { mat: 'plane', colour: 0x46703a }, crate: { mat: 'boxes', colour: 0xa08050 },
        bed: { mat: 'sofa', colour: 0x7a4a5a }, cabinet: { mat: 'shelf' }, lamp: { mat: 'streetlamp' }, car: { mat: 'car' },
      }),
    },
    ALIENBASE: {
      palette: { ground: 0x4a3f5a, ground2: 0x3a3048, road: 0x40384e, inner: 0x5a4a6a, wall: 0x6a5a80, roof: 0x3a3048, accent: 0x50e0c0 },
      roles: merge(ALIEN_PROPS, hullFamily(100, 60, 'alloy', 'alloy'), {
        ground: nf({ mat: 'alienfloor', armour: 80, sfx: 'alloy' }), road: nf({ mat: 'channel', armour: 80, sfx: 'alloy' }),
        inner: nf({ mat: 'alloy', armour: 80, sfx: 'alloy' }), roof: nf({ mat: 'alloy', armour: 80, sfx: 'alloy' }),
        craftFloor: { mat: 'pad' }, craftRamp: { mat: 'pad' },
        wall: nf({ mat: 'alloy', armour: 100, heBlock: 60, sfx: 'alloy' }), door: { armour: 100 }, doorOpen: { armour: 100 },
        rock: nf({ mat: 'bulkhead', armour: 100, heBlock: 60, sfx: 'alloy' }), tree: { mat: 'organic', colour: 0x7a4a8a },
        bush: { colour: 0x6a4a7a }, hedge: { colour: 0x5a3a6a }, crop: { colour: 0x6a5a7a }, scorched: { mat: 'alloy', colour: 0x2a2430 },
      }),
    },
    MARS: {
      palette: { ground: 0xa0583a, ground2: 0x8a4a30, road: 0x7a4a36, inner: 0x6a5a58, wall: 0x8a5040, roof: 0x5a3a30, accent: 0xd08040 },
      roles: merge(ALIEN_PROPS, hullFamily(60, 40, 'regolith', 'brick'), {
        ground: nf({ mat: 'regolith' }), crop: nf({ mat: 'dust', colour: 0xb06a48 }), road: nf({ mat: 'dust' }),
        inner: nf({ mat: 'alloy', armour: 80, sfx: 'alloy' }), roof: nf({ mat: 'alloy', armour: 80, sfx: 'alloy' }),
        wall: nf({ mat: 'regolith', armour: 60, heBlock: 40 }), rock: nf({ mat: 'mesa', armour: 80, heBlock: 40 }),
        tree: nf({ mat: 'spire', colour: 0x7a4030, sfx: 'brick' }), bush: nf({ mat: 'pebbles', colour: 0x8a4a34, sfx: 'earth' }),
        hedge: nf({ mat: 'ridge', colour: 0x7a4430, sfx: 'brick' }), objective: { mat: 'brain', armour: 80 },
        scorched: { mat: 'burnt', colour: 0x4a2a20 },
      }),
    },
    UFO: {
      palette: { ground: 0x5a5448, ground2: 0x4a463e, road: 0x504a40, inner: 0x5f6a78, wall: 0x7a8798, roof: 0x8a96a6, accent: 0x60d0ff },
      roles: merge(ALIEN_PROPS, hullFamily(255, 100, 'alloy', 'alloy'), indestructible(HARD), {
        ground: nf({ mat: 'burnt' }), road: nf({ mat: 'burnt' }), inner: nf({ mat: 'alloy', sfx: 'alloy' }),
        roof: nf({ mat: 'alloy', sfx: 'alloy' }), wall: nf({ mat: 'alloy', heBlock: 100, sfx: 'alloy' }),
        rock: nf({ mat: 'alloy', armour: 255, heBlock: 100, sfx: 'alloy' }), craftFloor: { mat: 'alloy' }, craftRamp: { mat: 'alloy' },
      }),
    },
    CRAFT: {
      palette: { ground: 0x5a5a56, ground2: 0x4a4a46, road: 0x46464a, inner: 0x5a6066, wall: 0x6a7076, roof: 0x7a8086, accent: 0xe0a020 },
      roles: merge(ALIEN_PROPS, hullFamily(255, 100, 'steel', 'metal'), indestructible(HARD), {
        ground: nf({ mat: 'tarmac' }), road: nf({ mat: 'tarmac' }), inner: nf({ mat: 'deck', sfx: 'metal' }),
        roof: nf({ mat: 'hull', sfx: 'metal' }), wall: nf({ mat: 'steel', heBlock: 100, sfx: 'metal' }),
        craftFloor: { mat: 'deck' }, craftRamp: { mat: 'ramp' }, cabinet: { mat: 'console', sfx: 'metal' },
        rock: nf({ mat: 'steel', armour: 255, heBlock: 100, sfx: 'metal' }),
      }),
    },
  };

  // ---- geração das definições -----------------------------------------------------------------------
  const DEF_DEFAULTS = {
    tu: TU_WALK, armour: 255, die: 0, alt: 0, door: null, open: false, window: false, blockLOS: false, heBlock: 0,
    smokeBlock: false, flammable: 255, fuel: 0, height: 0, fullBlock: false, diagonal: 0, stairs: null, gravlift: false,
    light: 0, explosive: null, special: null, sfx: 'earth', variantCount: 1,
  };
  const defs = [null];
  const byKey = {};

  function addDef(o) {
    o.id = defs.length;
    defs.push(o);
    byKey[o.key] = o;
    return o;
  }

  function buildDefs() {
    for (const set of SETS) {
      const spec = TILESET_SPECS[set];
      for (const role of ROLES) {
        if (role === 'air') continue;
        const base = ROLE_BASE[role];
        const over = spec.roles[role] || {};
        const src = COLOUR_FROM[role];
        const colour = over.colour !== undefined ? over.colour
          : src.length === 1 ? src[0] : shade(spec.palette[src[0]], src[1]);
        const o = Object.assign({ key: set + '.' + role, set, role }, DEF_DEFAULTS, base, over, { art: role, colour });
        if (o.explosive) o.explosive = { power: o.explosive.power.slice(), radius: o.explosive.radius, type: o.explosive.type };
        // referências por papel resolvidas depois de todas as definições do set existirem
        o._die = o.die || null;
        o._alt = o.alt || null;
        o._mirror = o.mirror || null;
        o.die = 0;
        o.alt = 0;
        delete o.mirror;
        const def = addDef(o);
        if (def.part === 'west') {
          // gémea norte: mesma aresta noutra orientação (rotação e parede norte)
          const n = addDef(Object.assign({}, def, { key: def.key + '.n', part: 'north' }));
          def.pair = n.id;
          n.pair = def.id;
        } else if (def.part === 'floor' && def._die) {
          // chão de níveis superiores: destruído ⇒ buraco (die 0)
          const up = addDef(Object.assign({}, def, { key: def.key + '.up', _die: null }));
          def.upper = up.id;
          def.lower = def.id;
          up.upper = up.id;
          up.lower = def.id;
        }
      }
    }
    // resolução das cadeias die/alt/mirror e campos por omissão
    for (let id = 1; id < defs.length; id++) {
      const d = defs[id];
      const ref = (role) => {
        if (!role) return 0;
        const t = byKey[d.set + '.' + role];
        if (!t) throw new Error('tiles: papel desconhecido ' + role + ' em ' + d.key);
        // a orientação da aresta mantém-se (parede norte morre em entulho norte)
        if (d.part === 'north' && t.part === 'west') return t.pair;
        return t.id;
      };
      d.die = ref(d._die);
      d.alt = ref(d._alt);
      d.mirror = d._mirror ? ref(d._mirror) : 0;
      if (d.pair === undefined) d.pair = 0;
      if (d.part === 'floor') {
        if (d.upper === undefined) d.upper = d.id;
        if (d.lower === undefined) d.lower = d.id;
      } else {
        d.upper = 0;
        d.lower = 0;
      }
      delete d._die;
      delete d._alt;
      delete d._mirror;
    }
  }
  buildDefs();

  // ---- tilesets públicos ----------------------------------------------------------------------------
  const TERRAINS = new Set(['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS']);
  const tilesets = {};
  for (const set of SETS) {
    const roles = {};
    const ids = {};
    for (const role of ROLES) {
      roles[role] = role === 'air' ? null : set + '.' + role;
      ids[role] = role === 'air' ? 0 : byKey[set + '.' + role].id;
    }
    tilesets[set] = {
      id: set, nameKey: TERRAINS.has(set) ? 'terrain.' + set : null, hull: HULL_SETS.has(set),
      roles, ids, palette: Object.assign({}, TILESET_SPECS[set].palette),
    };
  }

  // ---- legenda (DESIGN §7.2) ------------------------------------------------------------------------
  const L = (floor, west, north, object, node) => ({ floor: floor || null, west: west || null, north: north || null, object: object || null, node: node === undefined ? null : node });
  const LEGEND = {
    '.': L('ground'), ',': L('ground', 0, 0, 'crop'), '_': L('road'), '=': L('inner'), 'R': L('roof'), '~': L(),
    'X': L('craftFloor'), 'r': L('craftRamp'),
    '|': L('inner', 'wall'), '-': L('inner', 0, 'wall'), '+': L('inner', 'wall', 'wall'),
    '!': L('ground', 'wall'), '^': L('ground', 0, 'wall'), 'L': L('ground', 'wall', 'wall'),
    ']': L(0, 'wall'), ';': L(0, 0, 'wall'), '}': L(0, 'wall', 'wall'),
    'd': L('inner', 'door'), 'D': L('inner', 0, 'door'), 'e': L('ground', 'door'), 'E': L('ground', 0, 'door'),
    'i': L('inner', 'window'), 'I': L('inner', 0, 'window'), 'j': L('ground', 'window'), ')': L(0, 'window'), ':': L(0, 0, 'window'),
    'f': L('ground', 'fence'), 'F': L('ground', 0, 'fence'),
    '#': L('ground', 0, 0, 'rock'), 'T': L('ground', 0, 0, 'tree'), 'b': L('ground', 0, 0, 'bush'), 'h': L('ground', 0, 0, 'hedge'),
    'c': L('inner', 0, 0, 'crate'), 't': L('inner', 0, 0, 'table'), 'B': L('inner', 0, 0, 'bed'), 'k': L('inner', 0, 0, 'cabinet'),
    'l': L('ground', 0, 0, 'lamp'), 'C': L('road', 0, 0, 'car'),
    's': L('inner', 0, 0, 'stairsFoot'), 'S': L('inner', 0, 0, 'stairsHead'), 'g': L('inner', 0, 0, 'gravlift'),
    'H': L('inner', 0, 0, 'hull'), '/': L('inner', 0, 0, 'hullDiag2'), '\\': L('inner', 0, 0, 'hullDiag3'),
    'O': L('inner', 0, 0, 'ufoDoor'), 'P': L('inner', 0, 0, 'powerSource'), 'n': L('inner', 0, 0, 'navigation'),
    'u': L('inner', 0, 0, 'device'), '@': L('inner', 0, 0, 'objective'),
  };
  for (let r = 1; r <= 6; r++) LEGEND[String(r)] = L('inner', 0, 0, 0, r);
  // carateres sem estrutura (máscara 0): chão exterior simples e ar
  const PLAIN = new Set(['.', '~']);

  // ---- utilitários de blocos --------------------------------------------------------------------------
  // texto → linhas de um nível. Formato numerado («  3 ../=n=1\..», restantes linhas = fill) ou grelha completa.
  function levelRows(w, h, fill, text) {
    const lines = String(text).split('\n').map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim() !== '');
    const numbered = lines.some((s) => /\s/.test(s.trim()));
    if (!numbered) return lines.map((s) => s.trim());
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(fill.repeat(w));
    for (const s of lines) {
      const m = s.trim().match(/^(\d+)\s+(\S+)$/);
      if (!m) throw new Error('levelRows: linha inválida «' + s + '»');
      const y = +m[1];
      if (y < 0 || y >= h) throw new Error('levelRows: linha ' + y + ' fora do bloco (h=' + h + ')');
      rows[y] = m[2];
    }
    return rows;
  }

  // papel (ou chave 'SET.papel') → id da definição para a parte pedida e o nível z
  function resolvePart(ts, role, part, z) {
    if (!role) return 0;
    const key = role.indexOf('.') >= 0 ? role : ts.roles[role];
    if (key === null) return 0;
    if (key === undefined) throw new Error('papel desconhecido «' + role + '» no tileset ' + ts.id);
    let def = byKey[key];
    if (!def) throw new Error('definição desconhecida «' + key + '»');
    if (def.part !== part) {
      if (def.pair && defs[def.pair].part === part) def = defs[def.pair];
      else throw new Error('«' + role + '» (' + def.part + ') não serve como parte ' + part);
    }
    if (part === 'floor') def = defs[z > 0 ? def.upper : def.lower];
    return def.id;
  }

  function normaliseSpec(s) {
    return L(s.floor, s.west, s.north, s.object, s.node === undefined || s.node === null ? null : s.node);
  }

  const SPECIAL_KEYS = ['POWER_SOURCE', 'NAVIGATION', 'DEVICE', 'OBJECTIVE', 'START', 'CRAFT'];

  // ---- compilador -------------------------------------------------------------------------------------
  function compileBlock(block, tilesetId) {
    const id = (block && block.id) || '?';
    const errs = [];
    const fail = (msg) => errs.push(id + ' ' + msg);
    const abort = () => {
      const e = new Error(errs.join('\n'));
      e.errors = errs.slice();
      throw e;
    };
    if (!block || typeof block !== 'object') {
      fail('definição de bloco inválida');
      abort();
    }
    const tsId = tilesetId || block.set;
    const ts = tilesets[tsId];
    if (!ts) fail('tileset desconhecido «' + tsId + '»');
    if (!tilesets[block.set]) fail('set desconhecido «' + block.set + '»');
    const w = block.w, h = block.h;
    if (!(Number.isInteger(w) && w > 0 && w % 10 === 0)) fail('largura inválida ' + w + ' (múltiplo de 10)');
    if (!(Number.isInteger(h) && h > 0 && h % 10 === 0)) fail('altura inválida ' + h + ' (múltiplo de 10)');
    const levels = block.levels;
    if (!Array.isArray(levels) || !levels.length) fail('sem níveis');
    if (errs.length) abort();
    if (levels.length > MAX_LEVELS) fail(levels.length + ' níveis (máximo ' + MAX_LEVELS + ')');
    levels.forEach((rows, z) => {
      if (!Array.isArray(rows)) return fail('z' + z + ': nível não é uma lista de linhas');
      if (rows.length !== h) fail('z' + z + ': ' + rows.length + ' linhas (esperado ' + h + ')');
      rows.forEach((row, y) => {
        if (typeof row !== 'string' || row.length !== w) {
          fail('z' + z + ' linha ' + y + ': largura ' + (typeof row === 'string' ? row.length : typeof row) + ' (esperado ' + w + ') «' + row + '»');
        }
      });
    });
    if (errs.length) abort();

    const legend = Object.assign({}, LEGEND);
    if (block.legend) for (const ch in block.legend) legend[ch] = normaliseSpec(block.legend[ch]);
    const authored = levels.length;
    const hullRule = HULL_SETS.has(block.set);
    const charAt = (x, y, z) => (z < authored ? levels[z][y][x] : '~');

    // regra do tejadilho (OVNI/nave): tiles com estrutura no topo e por baixo de '~' recebem chão em z+1
    const roofAt = [];
    let roofTop = false;
    if (hullRule) {
      for (let z = 0; z < authored; z++) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const ch = levels[z][y][x];
            if (PLAIN.has(ch) || !legend[ch]) continue;
            if (legend[ch].floor === 'craftRamp') continue; // rampa descida fica a céu aberto
            if (z === authored - 1 || charAt(x, y, z + 1) === '~') {
              roofAt.push([x, y, z + 1]);
              if (z + 1 === authored) roofTop = true;
            }
          }
        }
      }
    }
    const d = authored + (roofTop ? 1 : 0);
    if (d > MAX_LEVELS) fail(d + ' níveis com o tejadilho (máximo ' + MAX_LEVELS + ')');
    if (errs.length) abort();

    const n = w * h * d;
    const parts = new Uint16Array(n * 4);
    const mask = new Uint8Array(n);
    const nodes = [];
    const cache = {};
    for (let z = 0; z < authored; z++) {
      for (let y = 0; y < h; y++) {
        const row = levels[z][y];
        for (let x = 0; x < w; x++) {
          const ch = row[x];
          const spec = legend[ch];
          const where = 'z' + z + ' linha ' + y + ' col ' + x;
          if (!spec) {
            fail(where + ': carácter desconhecido «' + ch + '» em «' + row + '»');
            continue;
          }
          const ck = ch + (z > 0 ? '+' : '0');
          let ids = cache[ck];
          if (!ids) {
            try {
              ids = PARTS.map((p) => resolvePart(ts, spec[p], p, z));
            } catch (e) {
              fail(where + ': «' + ch + '» ' + e.message);
              continue;
            }
            cache[ck] = ids;
          }
          if (z === 0 && !ids[0]) fail(where + ': «' + ch + '» sem chão no nível 0');
          const i = (z * h + y) * w + x;
          parts.set(ids, i * 4);
          if (!PLAIN.has(ch)) mask[i] = 1;
          if (spec.node !== null) nodes.push({ x, y, z, rank: spec.node, prio: NODE_PRIO });
        }
      }
    }
    if (errs.length) abort();
    for (const [x, y, z] of roofAt) {
      const i = (z * h + y) * w + x;
      if (!parts[i * 4]) parts[i * 4] = resolvePart(ts, 'roof', 'floor', z);
      mask[i] = 1;
    }
    for (const nd of block.nodes || []) {
      const [x, y, z, rank, prio] = nd;
      if (!(x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d)) fail('nó fora do bloco ' + JSON.stringify(nd));
      else if (!(rank >= 0 && rank < NODE_RANKS.length)) fail('nó com patente inválida ' + JSON.stringify(nd));
      else nodes.push({ x, y, z, rank: rank | 0, prio: prio === undefined ? NODE_PRIO : prio | 0 });
    }

    // varrimento: especiais, portas de OVNI, elevadores, escadas
    const specials = {};
    for (const k of SPECIAL_KEYS) specials[k] = [];
    const ufoDoors = [], gravlifts = [], stairs = [];
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < 4; p++) {
        const v = parts[i * 4 + p];
        if (!v) continue;
        const def = defs[v];
        if (def.special && specials[def.special].indexOf(i) < 0) specials[def.special].push(i);
        if (p === 3) {
          if (def.door === 'ufo') ufoDoors.push(i);
          if (def.gravlift) gravlifts.push(i);
          if (def.stairs === 'foot') stairs.push(i);
        }
      }
    }
    const objAt = (x, y, z) => (z >= 0 && z < d ? defs[parts[((z * h + y) * w + x) * 4 + 3]] : null);
    const xyz = (i) => [i % w, ((i / w) | 0) % h, (i / (w * h)) | 0];
    // escadas: pé s(z) ↔ cabeça S(z+1) na mesma coluna
    for (let i = 0; i < n; i++) {
      const o = defs[parts[i * 4 + 3]];
      if (!o || !o.stairs) continue;
      const [x, y, z] = xyz(i);
      const where = 'z' + z + ' linha ' + y + ' col ' + x;
      if (o.stairs === 'foot') {
        const up = objAt(x, y, z + 1);
        if (!up || up.stairs !== 'head') fail(where + ': pé de escada sem cabeça «S» em z' + (z + 1));
      } else {
        const dn = objAt(x, y, z - 1);
        if (!dn || dn.stairs !== 'foot') fail(where + ': cabeça de escada sem pé «s» em z' + (z - 1));
      }
    }
    // elevadores gravíticos alinhados entre conveses
    for (const i of gravlifts) {
      const [x, y, z] = xyz(i);
      const up = objAt(x, y, z + 1), dn = objAt(x, y, z - 1);
      if (!(up && up.gravlift) && !(dn && dn.gravlift)) fail('z' + z + ' linha ' + y + ' col ' + x + ': elevador gravítico sem par noutro convés');
    }
    // nós em tiles caminháveis
    for (const nd of nodes) {
      const i = (nd.z * h + nd.y) * w + nd.x;
      const o = defs[parts[i * 4 + 3]];
      if (!parts[i * 4] || (o && o.tu === 255)) fail('z' + nd.z + ' linha ' + nd.y + ' col ' + nd.x + ': nó num tile não caminhável');
    }
    // OVNI/nave: convés superior assente sobre o casco
    if (hullRule) {
      for (let z = 1; z < authored; z++) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (levels[z][y][x] !== '~' && PLAIN.has(levels[z - 1][y][x])) {
              fail('z' + z + ' linha ' + y + ' col ' + x + ': convés superior sem casco por baixo');
            }
          }
        }
      }
    }
    if (errs.length) abort();

    const craftTiles = specials.START.concat(specials.CRAFT).sort((a, b) => a - b);
    return {
      id, set: block.set, tileset: tsId, w, h, d, authored, parts, mask, nodes,
      startTiles: specials.START.slice(), craftTiles, specials, ufoDoors, gravlifts, stairs,
      tags: (block.tags || []).slice(), weight: block.weight === undefined ? 1 : block.weight,
      maxUses: block.maxUses === undefined ? 0 : block.maxUses,
      ufo: block.ufo || null, craft: block.craft || null, decks: block.decks || authored, rot: 0, droppedEdges: 0,
    };
  }

  // ---- rotação ----------------------------------------------------------------------------------------
  function copyCompiled(c) {
    const specials = {};
    for (const k in c.specials) specials[k] = c.specials[k].slice();
    return Object.assign({}, c, {
      parts: c.parts.slice(), mask: c.mask.slice(), nodes: c.nodes.map((nd) => Object.assign({}, nd)),
      startTiles: c.startTiles.slice(), craftTiles: c.craftTiles.slice(), specials, ufoDoors: c.ufoDoors.slice(),
      gravlifts: c.gravlifts.slice(), stairs: c.stairs.slice(), tags: c.tags.slice(),
    });
  }

  // 90° no sentido horário: (x, y) → (h−1−y, x). Parede oeste de A passa a parede norte de A';
  // parede norte de A passa a parede oeste do vizinho leste de A' (perdida se cair fora do bloco).
  function rotateOnce(c) {
    const W = c.h, H = c.w, d = c.d, ow = c.w, oh = c.h;
    const n = W * H * d;
    const parts = new Uint16Array(n * 4);
    const mask = new Uint8Array(n);
    let dropped = c.droppedEdges || 0;
    const map = (i) => {
      const x = i % ow, y = ((i / ow) | 0) % oh, z = (i / (ow * oh)) | 0;
      return (z * H + x) * W + (oh - 1 - y);
    };
    for (let i = 0; i < n; i++) {
      const ni = map(i);
      const s = i * 4, t = ni * 4;
      parts[t] = c.parts[s];
      const o = c.parts[s + 3];
      parts[t + 3] = o && defs[o].mirror ? defs[o].mirror : o;
      const west = c.parts[s + 1];
      if (west) parts[t + 2] = defs[west].pair;
      const north = c.parts[s + 2];
      if (north) {
        if ((ni % W) + 1 < W) parts[t + 4 + 1] = defs[north].pair;
        else dropped++;
      }
      mask[ni] = c.mask[i];
    }
    const mapList = (a) => a.map(map);
    const specials = {};
    for (const k in c.specials) specials[k] = mapList(c.specials[k]);
    return Object.assign({}, c, {
      w: W, h: H, parts, mask, rot: ((c.rot || 0) + 1) & 3, droppedEdges: dropped,
      nodes: c.nodes.map((nd) => ({ x: oh - 1 - nd.y, y: nd.x, z: nd.z, rank: nd.rank, prio: nd.prio })),
      startTiles: mapList(c.startTiles), craftTiles: mapList(c.craftTiles), specials,
      ufoDoors: mapList(c.ufoDoors), gravlifts: mapList(c.gravlifts), stairs: mapList(c.stairs), tags: c.tags.slice(),
    });
  }

  function rotateCompiled(c, quarterTurns) {
    const q = (((quarterTurns | 0) % 4) + 4) % 4;
    let r = copyCompiled(c);
    for (let k = 0; k < q; k++) r = rotateOnce(r);
    return r;
  }

  // ---- registo, compilação no finalize e consulta ----------------------------------------------------
  D.blocks = D.blocks || {};
  D.compiled = D.compiled || {};
  const altCache = new Map();

  function getCompiled(id, tilesetId) {
    const block = D.blocks[id];
    if (!block) throw new Error('bloco desconhecido ' + id);
    if (!tilesetId || tilesetId === block.set) {
      if (D.compiled[id]) return D.compiled[id];
      tilesetId = block.set;
    }
    const k = id + '|' + tilesetId;
    let c = altCache.get(k);
    if (!c) {
      c = OV.U && OV.U.deepFreeze ? OV.U.deepFreeze(compileBlock(block, tilesetId)) : compileBlock(block, tilesetId);
      altCache.set(k, c);
    }
    return c;
  }

  function tileId(key) {
    const d = byKey[key];
    if (!d) throw new Error('tile desconhecido ' + key);
    return d.id;
  }

  D.onFinalize('tiles.ids', (Data) => {
    for (const id in Data.blocks) {
      const b = Data.blocks[id];
      if (b && typeof b === 'object' && !b.id) b.id = id;
    }
  }, 10);

  D.onFinalize('tiles.compile', (Data) => {
    const errors = [];
    for (const id in Data.blocks) {
      const b = Data.blocks[id];
      if (!b || b.id !== id) {
        errors.push(id + ' id do bloco não corresponde à chave do registo');
        continue;
      }
      try {
        Data.compiled[id] = compileBlock(b);
      } catch (e) {
        if (e.errors) errors.push.apply(errors, e.errors);
        else errors.push(id + ' ' + e.message);
      }
    }
    if (errors.length) throw new Error('blocos inválidos:\n    ' + errors.join('\n    '));
    const freeze = OV.U && OV.U.deepFreeze;
    if (freeze) {
      for (const id in Data.compiled) freeze(Data.compiled[id]);
      for (let i = 1; i < defs.length; i++) freeze(defs[i]);
      freeze(defs);
      freeze(tilesets);
      freeze(LEGEND);
    }
  }, 50);

  Object.assign(D, {
    tileDefs: defs,
    tileDefByKey: byKey,
    tileKeys: defs.map((d) => (d ? d.key : '')),
    tileId,
    tilesets,
    legend: LEGEND,
    TILE_PARTS: PARTS,
    TILE_ROLES: ROLES,
    TILE_SETS: SETS,
    MAX_LEVELS,
    NODE_RANKS,
    NODE_RANK,
    NODE_RANK_PREFS,
    levelRows,
    compileBlock,
    rotateCompiled,
    getCompiled,
  });
})(globalThis.OV || (globalThis.OV = {}));
