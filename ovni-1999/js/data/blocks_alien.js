/* Blocos da BASE ALIENÍGENA e de MARTE (Cydonia) + scripts (DESIGN.md §7.3–7.4). Formato: cabeçalho de
   blocks_farm.js. Base: módulos só com z0 (teto implícito, mapa 40×40×2), borda em casco H com aberturas de 2 tiles
   nas posições 4–5 de cada segmento de 10, por isso módulos vizinhos ligam-se sempre e rodam sem desalinhar.
   Marte: blocos de regolito e ruínas; pirâmide 20×20 com o Cérebro Alienígena (@) em z1, acessível só pelo
   elevador gravítico do santuário (o Avenger pousa numa borda, colocado pelo gerador). */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  const add = D.addTerrainBlock;

  // ---- BASE ALIENÍGENA -----------------------------------------------------------------------------------
  // plataforma do elevador por onde a equipa X-COM desce (X = inícios e zona de recolha)
  add('ALIENBASE_LIFT', 'ALIENBASE', String.raw`
    HHHH==HHHH
    Hk======kH
    H=XXXXXX=H
    H=XXXXXX=H
    ==XXXXXX==
    ==XXXXXX==
    H=XXXXXX=H
    H=XXXXXX=H
    Hk======kH
    HHHH==HHHH
  `, { tags: ['lift', 'start'], weight: 1, maxUses: 1 });

  // centro de comando 20×20: anel de corredores à volta do núcleo do DESIGN §7.4 (ALIEN_BASE_COMMAND). Correção
  // ours na linha 1 do núcleo: «HH4n==n4HH» emparedava os nós 4 (H, n e u à volta) ⇒ «HHn4==4nHH»
  add('ALIENBASE_COMMAND', 'ALIENBASE', String.raw`
    HHHH==HHHHHHHH==HHHH
    HHHH==HHHHHHHH==HHHH
    HH=1============1=HH
    HH================HH
    ====HHHHH==HHHHH====
    ====HHHHH==HHHHH====
    HH==HHHn4==4nHHH==HH
    HH==HH=u====u=HH==HH
    HH==HH========HH==HH
    HH======P@@P======HH
    HH======u@@u======HH
    HH==HH========HH==HH
    HH==HH=1====1=HH==HH
    HH==HHHk2==2kHHH==HH
    ====HHHHH==HHHHH====
    ====HHHHH==HHHHH====
    HH==4==========4==HH
    HH================HH
    HHHH==HHHHHHHH==HHHH
    HHHH==HHHHHHHH==HHHH
  `, { tags: ['command', 'objective'], weight: 1, maxUses: 1 });

  // laboratório: mesas de cirurgia, consolas e dispositivos alienígenas
  add('ALIENBASE_LAB', 'ALIENBASE', String.raw`
    HHHH==HHHH
    Hk==1===kH
    H=tt==tt=H
    H=2====5=H
    ====uu====
    ====uu====
    H=5====2=H
    H=tt==tt=H
    Hk======kH
    HHHH==HHHH
  `, { tags: ['module', 'lab'], weight: 2, maxUses: 2 });

  // camarata: casulos de repouso
  add('ALIENBASE_QUARTERS', 'ALIENBASE', String.raw`
    HHHH==HHHH
    HBB=1==BBH
    H========H
    HBB====BBH
    ====6=====
    ==========
    HBB====BBH
    H===5====H
    HBB=1==BBH
    HHHH==HHHH
  `, { tags: ['module', 'quarters'], weight: 2, maxUses: 2 });

  // hangar 20×20 com uma nave alienígena estacionada e contentores
  add('ALIENBASE_HANGAR', 'ALIENBASE', String.raw`
    HHHH==HHHHHHHH==HHHH
    H==================H
    H=cc============cc=H
    H=c======/\======c=H
    ========/HH\========
    =======/HHHH\=======
    H======\HHHH/======H
    H=======\HH/=======H
    H========\/========H
    H==1============1==H
    H========6=========H
    H==================H
    H==3============3==H
    H==================H
    ====cc========cc====
    ====cc========cc====
    H========1=========H
    H=c====kkkkkk====c=H
    H==================H
    HHHH==HHHHHHHH==HHHH
  `, { tags: ['module', 'hangar'], weight: 1, maxUses: 1 });

  // corredor N–S com nichos e ligações laterais
  add('ALIENBASE_CORRIDOR', 'ALIENBASE', String.raw`
    HHHH==HHHH
    HHk====kHH
    HHHH6=HHHH
    HHHH==HHHH
    ====1=====
    ==========
    HHHH==HHHH
    HHHH==HHHH
    HHk====kHH
    HHHH==HHHH
  `, { tags: ['corridor'], weight: 3 });

  // cruzamento octogonal
  add('ALIENBASE_CROSS', 'ALIENBASE', String.raw`
    HHHH==HHHH
    HHH====HHH
    HH=1====HH
    H========H
    ====6=====
    ==========
    H========H
    HH====1=HH
    HHH====HHH
    HHHH==HHHH
  `, { tags: ['corridor'], weight: 2 });

  // ---- MARTE ---------------------------------------------------------------------------------------------
  add('MARS_A', 'MARS', String.raw`
    ..........
    .##....b..
    .###......
    ..#...,,..
    ....7,,,..
    .b.....##.
    ......###.
    ..,,...#..
    .##.......
    .#....8.b.
  `, { tags: ['nature'], weight: 3 });

  // mesas de regolito: topo plano em z1 e um pináculo de dois níveis
  add('MARS_MESA', 'MARS', String.raw`
    ..........  ~~~~~~~~~~
    ..####....  ~~RRRR~~~~
    .######...  ~RRRRRR~~~
    .######.b.  ~RRR#RR~~~
    ..####....  ~~RRRR~~~~
    ..........  ~~~~~~~~~~
    ......##..  ~~~~~~##~~
    .b...####.  ~~~~~~~~~~
    .7...###..  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['nature'], weight: 2 });

  // cratera: anel de cristas com três passagens
  add('MARS_CRATER', 'MARS', String.raw`
    ..........
    ...hhhh...
    ..h,,,,h..
    .h,,,,,,h.
    .h,,7,,,..
    .,,,,,,,h.
    .h,,,,,,h.
    ..h,,,,h..
    ...hh.h...
    ..........
  `, { tags: ['nature'], weight: 2 });

  // agulhas de rocha
  add('MARS_SPIRES', 'MARS', String.raw`
    .T....T...
    ...T......
    .......T..
    ..T.......
    .....T..T.
    .T..8.....
    ....T..T..
    ..........
    .T..T...T.
    ......T...
  `, { tags: ['nature'], weight: 2 });

  // ruína alienígena: muros de casco partidos, chão de liga e pilares
  add('MARS_RUIN', 'MARS', String.raw`
    ..........
    .HHH..HHH.
    .H......H.
    .H.1==1.H.
    ...=HH=...
    ...=HH=...
    .H.6==..H.
    .H......H.
    .HHH..HHH.
    ..........
  `, { tags: ['ruin'], weight: 2 });

  // crista de dois níveis com garganta
  add('MARS_RIDGE', 'MARS', String.raw`
    ..........  ~~~~~~~~~~
    .....T....  ~~~~~~~~~~
    ###..#####  ##~~~~###~
    .###..###.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
    ..,,7.....  ~~~~~~~~~~
    .......#..  ~~~~~~~~~~
    .T....###.  ~~~~~~##~~
    ..........  ~~~~~~~~~~
    ....b.....  ~~~~~~~~~~
  `, { tags: ['nature'], weight: 2 });

  // pirâmide de Cydonia: anel exterior, santuário com elevador gravítico; câmara do Cérebro em z1
  add('MARS_PYRAMID', 'MARS', String.raw`
    ....................  ~~~~~~~~~~~~~~~~~~~~
    .......b............  ~~~~~~~~~~~~~~~~~~~~
    ../HHHHHHOOHHHHHH\..  ~~RRRRRRRRRRRRRRRR~~
    ..H=2==========2=H..  ~~RRRRRRRRRRRRRRRR~~
    ..H==============H..  ~~RRRRRRRRRRRRRRRR~~
    ..H==k========k==H..  ~~RRRRRRRRRRRRRRRR~~
    ..H===HHHOOHHH===H..  ~~RRRRHHHHHHHHRRRR~~
    ..H===H=4==4=H===H..  ~~RRRRH=4==4=HRRRR~~
    ..H=1=H=k==k=H=1=H..  ~~RRRRH======HRRRR~~
    ..O===O==gg==O===O..  ~~RRRRH==gg==HRRRR~~
    ..O===O=3==3=O===O..  ~~RRRRH======HRRRR~~
    ..H=1=H=k==k=H=1=H..  ~~RRRRH=4@@4=HRRRR~~
    ..H===H=4==4=H===H..  ~~RRRRH==@@==HRRRR~~
    ..H===HHHOOHHH===H..  ~~RRRRHHHHHHHHRRRR~~
    ..H==k========k==H..  ~~RRRRRRRRRRRRRRRR~~
    ..H==============H..  ~~RRRRRRRRRRRRRRRR~~
    ..H=2==========2=H..  ~~RRRRRRRRRRRRRRRR~~
    ..\HHHHHHOOHHHHHH/..  ~~RRRRRRRRRRRRRRRR~~
    ....................  ~~~~~~~~~~~~~~~~~~~~
    ............b.......  ~~~~~~~~~~~~~~~~~~~~
  `, { tags: ['building', 'objective', 'pyramid'], weight: 1, maxUses: 1 });

  // ---- scripts (disposição fixa por regras) --------------------------------------------------------------
  D.mapScripts.ALIENBASE = {
    tileset: 'ALIENBASE',
    sizes: { medium: [40, 40, 2] },
    ceiling: true,
    blocks: ['ALIENBASE_LIFT', 'ALIENBASE_COMMAND', 'ALIENBASE_LAB', 'ALIENBASE_QUARTERS', 'ALIENBASE_HANGAR', 'ALIENBASE_CORRIDOR', 'ALIENBASE_CROSS'],
    commands: [
      // elevador numa célula da borda; comando o mais longe possível dele; 2–3 módulos; corredores no resto
      { type: 'addBlock', weights: { ALIENBASE_LIFT: 1 }, count: 1, at: 'edge', anchor: true },
      { type: 'addBlock', weights: { ALIENBASE_COMMAND: 1 }, count: 1, at: 'far', anchor: true },
      { type: 'addBlock', tags: ['module'], count: [2, 3] },
      { type: 'fill', size: 10, weights: { ALIENBASE_CORRIDOR: 3, ALIENBASE_CROSS: 2 } },
    ],
  };

  D.mapScripts.MARS = {
    tileset: 'MARS',
    sizes: { large: [50, 50, 2] },
    blocks: ['MARS_A', 'MARS_MESA', 'MARS_CRATER', 'MARS_SPIRES', 'MARS_RUIN', 'MARS_RIDGE', 'MARS_PYRAMID'],
    commands: [
      { type: 'addBlock', weights: { MARS_PYRAMID: 1 }, count: 1, at: 'centre', anchor: true },
      { type: 'addCraft', gap: 1 },
      { type: 'fill', size: 10, weights: { MARS_A: 3, MARS_MESA: 2, MARS_CRATER: 2, MARS_SPIRES: 2, MARS_RUIN: 2, MARS_RIDGE: 2 } },
    ],
  };
})(globalThis.OV || (globalThis.OV = {}));
