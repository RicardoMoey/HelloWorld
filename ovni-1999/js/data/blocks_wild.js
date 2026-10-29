/* Blocos de terreno natural: FLORESTA, SELVA, DESERTO, MONTANHA e POLAR (DESIGN.md §7.3–7.4) + scripts.
   Formato e regras de autoria: cabeçalho de blocks_farm.js. Os scripts SELVA/MONTANHA/POLAR reutilizam blocos de
   floresta e de deserto com a paleta do seu tileset (OV.Data.getCompiled(id, script.tileset)). */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  const add = D.addTerrainBlock;
  const SIZES = D.MAP_SIZES_UFO;
  const NATURE = ['nature'];

  // ---- FLORESTA ---------------------------------------------------------------------------------------------
  // DESIGN §7.4 (igual)
  add('FOREST_A', 'FOREST', String.raw`
    ..T....b..
    .TT..b....
    ..T...#...
    b.....##..
    ...T......
    ..TTT..b..
    ...T....T.
    .b.....TT.
    ....b...T.
    T.........
  `, { tags: NATURE, weight: 3 });

  // mata cerrada com carreiros
  add('FOREST_DENSE', 'FOREST', String.raw`
    ..TT..T...
    .T...TT.T.
    .T.T.b...T
    ...TT.T.T.
    TT........
    .T.TT.T..T
    ..bT...TT.
    .TT..T....
    .T..TT.TT.
    ...T..b..T
  `, { tags: NATURE, weight: 3 });

  // clareira ao centro, orla de árvores
  add('FOREST_CLEARING', 'FOREST', String.raw`
    ..T..T..T.
    ..T...b.T.
    T.........
    .b........
    T.........
    ..........
    T.........
    .......b.T
    T...T...TT
    ..T..T....
  `, { tags: NATURE, weight: 2 });

  // clareira com troncos caídos e um penedo
  add('FOREST_GLADE', 'FOREST', String.raw`
    .T..T...T.
    .T.....TT.
    .....y....
    ..b..y..#.
    T.........
    ......b...
    .y........
    .y..T....T
    .T.....b..
    .T..T.TT..
  `, { tags: NATURE, weight: 2 });

  // cabana de madeira: porta a leste, janelas nos quatro lados, telhado de ripas
  add('FOREST_CABIN', 'FOREST', String.raw`
    .T...T..T.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
    ..+--I-!..  ~~RRRRR~~~
    .Ti=B=k!.T  ~~RRRRR~~~
    ..|=1=tj..  ~~RRRRR~~~
    .y|c===e..  ~~RRRRR~~~
    ..^^JJ^...  ~~~~~~~~~~
    .b......T.  ~~~~~~~~~~
    T...b.....  ~~~~~~~~~~
    ..T....T..  ~~~~~~~~~~
  `, { tags: ['building', 'cabin'], weight: 1, maxUses: 2 });

  // leito de ribeiro seco: penedos em diagonal com vaus
  add('FOREST_ROCKS', 'FOREST', String.raw`
    ..##......
    ...#...T..
    ..........
    .T..##....
    .....#....
    ..b.......
    ......##..
    .T.....#b.
    ...T......
    ........##
  `, { tags: NATURE, weight: 2 });

  // ---- SELVA (palmeiras, fetos, lianas; templo em pedra) -----------------------------------------------------
  add('JUNGLE_DENSE', 'JUNGLE', String.raw`
    .T,,T..T,.
    ,TT,..T,,T
    ..,,h,T...
    .T...hh,T.
    T,.T,,....
    ,,..T.,TT,
    .T,,..,,..
    ..TT,h...T
    T,,...T,T.
    .,.T,,..,.
  `, { tags: NATURE, weight: 4 });

  // ruína de templo: muros de pedra com quatro entradas, altar e pilares
  add('JUNGLE_TEMPLE', 'JUNGLE', String.raw`
    .T........
    ..HHH.HHH.
    .H.......H
    .H.,HH,..H
    ......#8..
    .H.,HH,..H
    .H.......H
    ..HHH.HHH.
    .T..b...T.
    T.....T...
  `, { tags: ['ruin'], weight: 1, maxUses: 1 });

  // palhota de bambu com cobertura de colmo
  add('JUNGLE_HUT', 'JUNGLE', String.raw`
    .T..T...T.  ~~~~~~~~~~
    ..,,..T...  ~~~~~~~~~~
    .T.......T  ~~~~~~~~~~
    ..T+---!..  ~~~RRRR~~~
    .,.i=1=j..  ~~~RRRR~~~
    ...|c=B!..  ~~~RRRR~~~
    .b.^^E^...  ~~~~~~~~~~
    ....,,..T.  ~~~~~~~~~~
    .T......,.  ~~~~~~~~~~
    ...T..T...  ~~~~~~~~~~
  `, { tags: ['building', 'hut'], weight: 1, maxUses: 2 });

  // pântano de fetos e lianas
  add('JUNGLE_SWAMP', 'JUNGLE', String.raw`
    ,,..T.,,,.
    ,b,,..,h,,
    ..,,,T,,..
    .T.,,,..b.
    ,,,b..,,,,
    ..,,,,T,..
    hh.,.,,,.T
    ,.,T,,b,,.
    ..,,..,,T,
    .T,,.,,...
  `, { tags: NATURE, weight: 3 });

  // ---- DESERTO ----------------------------------------------------------------------------------------------
  // DESIGN §7.4 (igual)
  add('DESERT_A', 'DESERT', String.raw`
    ..........
    ...##.....
    ..###.....
    ...#......
    .......b..
    ......##..
    .b....###.
    ......##..
    ..........
    ..........
  `, { tags: NATURE, weight: 3 });

  // dunas baixas com mato rasteiro
  add('DESERT_DUNES', 'DESERT', String.raw`
    ..........
    ..,,,.....
    .,,,,,..T.
    ..,,,.....
    .......,,.
    ...b..,,,,
    .......,,.
    .T........
    ....,,,...
    ...,,,,,..
  `, { tags: NATURE, weight: 3 });

  // afloramentos de arenito
  add('DESERT_ROCKS', 'DESERT', String.raw`
    ..........
    .##....#..
    .###..###.
    ..##...##.
    .....b....
    ...##.....
    ..####..T.
    ..###.....
    ......##..
    ..........
  `, { tags: NATURE, weight: 2 });

  // mesa de dois níveis: topo plano (z1) só ao alcance de quem voa
  add('DESERT_MESA', 'DESERT', String.raw`
    ..........  ~~~~~~~~~~
    ....b.....  ~~~~~~~~~~
    ..#####...  ~~RRRRR~~~
    .#######..  ~RRR#RRR~~
    .#######.T  ~RRRRRRR~~
    ..######..  ~~RRRRRR~~
    ...###....  ~~~RRR~~~~
    ..........  ~~~~~~~~~~
    .T....,,..  ~~~~~~~~~~
    ......,...  ~~~~~~~~~~
  `, { tags: NATURE, weight: 2 });

  // oásis seco: catos e mato
  add('DESERT_OASIS', 'DESERT', String.raw`
    ..........
    ..T...b...
    .,,,,.....
    .,bb,,..T.
    .,b,,,,...
    ..,,,,b...
    ...,,.....
    .T......T.
    ....b.....
    ..........
  `, { tags: NATURE, weight: 1 });

  // ruína de adobe sem telhado, paredes derrubadas em quatro sítios
  add('DESERT_RUIN', 'DESERT', String.raw`
    ..........
    .+--=--!..
    .|==c=b!..
    .===|==...
    .|=c|=1!..
    .^^.^^^...
    ..........
    ..b...#...
    ......##..
    ..........
  `, { tags: ['ruin'], weight: 1, maxUses: 1 });

  // ---- MONTANHA ---------------------------------------------------------------------------------------------
  add('MOUNTAIN_A', 'MOUNTAIN', String.raw`
    ..........
    .##...T...
    .###......
    ..#...,,..
    ......##..
    .T...###..
    .....##...
    ..,,......
    .##.....T.
    .#........
  `, { tags: NATURE, weight: 3 });

  // crista de granito com garganta; falésia de dois níveis
  add('MOUNTAIN_RIDGE', 'MOUNTAIN', String.raw`
    ..........  ~~~~~~~~~~
    ..T....T..  ~~~~~~~~~~
    ##..######  ~~~~####~~
    ###..#####  ~~~~~###~~
    .#.....##.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
    .,,...T...  ~~~~~~~~~~
    ......,,..  ~~~~~~~~~~
    .T........  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: NATURE, weight: 2 });

  // desfiladeiro em diagonal entre dois maciços
  add('MOUNTAIN_PASS', 'MOUNTAIN', String.raw`
    ####......  ###~~~~~~~
    ####...T..  ##~~~~~~~~
    ###.......  ~~~~~~~~~~
    ##....,...  ~~~~~~~~~~
    .....##...  ~~~~~~~~~~
    ....####..  ~~~~~~~~~~
    ...######.  ~~~~~~~~~~
    .T..######  ~~~~~~###~
    ....######  ~~~~~~####
    ......####  ~~~~~~~###
  `, { tags: NATURE, weight: 2 });

  // abrigo de pastor em pedra com telhado de lousa
  add('MOUNTAIN_HUT', 'MOUNTAIN', String.raw`
    ..........  ~~~~~~~~~~
    .T....#...  ~~~~~~~~~~
    ..+---!...  ~~RRRR~~~~
    ..|B=c!.T.  ~~RRRR~~~~
    ..d=1t!...  ~~RRRR~~~~
    ..^^^^....  ~~~~~~~~~~
    ....,,....  ~~~~~~~~~~
    .#..,,..#.  ~~~~~~~~~~
    .##.....##  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['building', 'hut'], weight: 1, maxUses: 1 });

  // ---- POLAR ------------------------------------------------------------------------------------------------
  add('POLAR_A', 'POLAR', String.raw`
    ..........
    ..hh....#.
    ...h......
    .......b..
    .#.....hh.
    .##.......
    ......T...
    ..b.....#.
    .hh.......
    ..........
  `, { tags: NATURE, weight: 3 });

  add('POLAR_PINES', 'POLAR', String.raw`
    .T...T..T.
    ..T.....T.
    T...T.....
    ...TT..T..
    .T......T.
    ....T.....
    T..T...TT.
    .........T
    ..T..T....
    .T......T.
  `, { tags: NATURE, weight: 2 });

  // cristas de gelo
  add('POLAR_ICE', 'POLAR', String.raw`
    ..........
    .####..##.
    ..........
    ....b.....
    ##..####..
    ..........
    .....h....
    .###...###
    ..........
    ....##....
  `, { tags: NATURE, weight: 2 });

  // estação científica: módulo de painéis, mota de neve na pista gelada
  add('POLAR_STATION', 'POLAR', String.raw`
    ..........  ~~~~~~~~~~
    .+----!...  ~RRRRR~~~~
    .|kk=t!.y.  ~RRRRR~~~~
    .d=1==j...  ~RRRRR~~~~
    .|B=c=!...  ~RRRRR~~~~
    .^^JJ^....  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
    .______...  ~~~~~~~~~~
    .__C___.y.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['building', 'station'], weight: 1, maxUses: 1 });

  // ---- scripts ------------------------------------------------------------------------------------------------
  const ufoSite = (tileset, blocks, weights) => ({
    tileset, sizes: SIZES, blocks,
    commands: [{ type: 'addCraft' }, { type: 'addUFO', gap: 1 }, { type: 'fill', size: 10, weights }],
  });

  D.mapScripts.FOREST = ufoSite('FOREST',
    ['FOREST_A', 'FOREST_DENSE', 'FOREST_CLEARING', 'FOREST_GLADE', 'FOREST_CABIN', 'FOREST_ROCKS'],
    { FOREST_A: 3, FOREST_DENSE: 3, FOREST_CLEARING: 2, FOREST_GLADE: 2, FOREST_ROCKS: 2, FOREST_CABIN: 1 });

  D.mapScripts.JUNGLE = ufoSite('JUNGLE',
    ['JUNGLE_DENSE', 'JUNGLE_TEMPLE', 'JUNGLE_HUT', 'JUNGLE_SWAMP', 'FOREST_A', 'FOREST_DENSE', 'FOREST_CLEARING'],
    { JUNGLE_DENSE: 4, JUNGLE_SWAMP: 3, JUNGLE_TEMPLE: 1, JUNGLE_HUT: 1, FOREST_DENSE: 2, FOREST_A: 2, FOREST_CLEARING: 1 });

  D.mapScripts.DESERT = ufoSite('DESERT',
    ['DESERT_A', 'DESERT_DUNES', 'DESERT_ROCKS', 'DESERT_MESA', 'DESERT_OASIS', 'DESERT_RUIN'],
    { DESERT_A: 3, DESERT_DUNES: 3, DESERT_ROCKS: 2, DESERT_MESA: 2, DESERT_OASIS: 1, DESERT_RUIN: 1 });

  D.mapScripts.MOUNTAIN = ufoSite('MOUNTAIN',
    ['MOUNTAIN_A', 'MOUNTAIN_RIDGE', 'MOUNTAIN_PASS', 'MOUNTAIN_HUT', 'DESERT_A', 'DESERT_ROCKS', 'FOREST_ROCKS'],
    { MOUNTAIN_A: 3, MOUNTAIN_RIDGE: 2, MOUNTAIN_PASS: 2, MOUNTAIN_HUT: 1, DESERT_ROCKS: 2, DESERT_A: 1, FOREST_ROCKS: 1 });

  D.mapScripts.POLAR = ufoSite('POLAR',
    ['POLAR_A', 'POLAR_PINES', 'POLAR_ICE', 'POLAR_STATION', 'DESERT_DUNES', 'FOREST_CLEARING'],
    { POLAR_A: 3, POLAR_PINES: 2, POLAR_ICE: 2, POLAR_STATION: 1, DESERT_DUNES: 2, FOREST_CLEARING: 1 });
})(globalThis.OV || (globalThis.OV = {}));
