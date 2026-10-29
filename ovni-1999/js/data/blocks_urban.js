/* Blocos de terreno CIDADE (URBAN, missões de terror e OVNIs caídos em cidades; DESIGN.md §7.3–7.4) + script.
   Formato e regras de autoria: cabeçalho de blocks_farm.js. Estradas: faixa nas posições ROAD_PROFILE (x 2–5
   nas arestas N/S, y 2–5 nas E/O), orientação fixa; os restantes blocos têm passeio a toda a volta. */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  const add = D.addTerrainBlock;

  // ---- casas e comércio 10×10 --------------------------------------------------------------------------------
  // moradia térrea com jardim de sebes
  add('URBAN_HOUSE', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~
    .+---+--!.  ~RRRRRRR~~
    .|kt=|B=!.  ~RRRRRRR~~
    .|=1=d=1j.  ~RRRRRRR~~
    .|=B=|=k!.  ~RRRRRRR~~
    .^^E^^J^..  ~~~~~~~~~~
    .h...7..h.  ~~~~~~~~~~
    .h.T..b.h.  ~~~~~~~~~~
    .h......h.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['building', 'house'], weight: 3 });

  // casa geminada de dois pisos com escada no vestíbulo
  add('URBAN_HOUSE_B', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    ..T.....b.  ~~~~~~~~~~  ~~~~~~~~~~
    .+---+--!.  ~+---+--]~  ~RRRRRRR~~
    .|kk=|=s!.  ~|B==|=S]~  ~RRRRRRR~~
    .|=t=d==j.  ~i=t=d==)~  ~RRRRRRR~~
    .+-D-+D-!.  ~+-D-+--]~  ~RRRRRRR~~
    .|B==|1=e.  ~|BB=|=k)~  ~RRRRRRR~~
    .|=1k|=t!.  ~|=1=d1=]~  ~RRRRRRR~~
    .^J^^^E^..  ~;:;;;:;~~  ~~~~~~~~~~
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
  `, { tags: ['building', 'house'], weight: 2 });

  // DESIGN §7.4 (igual): loja com armazém e apartamento em cima
  add('URBAN_SHOP', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .+---D---!  ~+---I---]  ~RRRRRRRR~
    .|kk===kk!  ~|B=====t]  ~RRRRRRRR~
    .|======c!  ~|===t==B]  ~RRRRRRRR~
    .d==1===c!  ~i======c]  ~RRRRRRRR~
    .|======s!  ~|======S]  ~RRRRRRRR~
    .+--D---L.  ~+--D---}~  ~RRRRRRR~~
    .|bb==k=!.  ~|kk====]~  ~RRRRRRR~~
    .|======!.  ~|==1===]~  ~RRRRRRR~~
    .^^^^^^^..  ~;;;;;;;~~  ~~~~~~~~~~
  `, { tags: ['building', 'shop'], weight: 3, nodes: [[6, 3, 0, 4], [3, 3, 1, 1]] });

  // jardim público: canteiros, bancos, fonte
  add('URBAN_PARK', 'URBAN', String.raw`
    ..........
    .T..,,7.T.
    ..8.......
    .,.q..q.,.
    .,..##..,.
    .,..##..,.
    .,.q..q.,.
    ......7...
    .T..bb..T.
    ..........
  `, { tags: ['park', 'nature'], weight: 2 });

  // parque de estacionamento com candeeiros
  add('URBAN_PARKING', 'URBAN', String.raw`
    ..........
    .l_C_C_Cl.
    .________.
    .____0___.
    .________.
    .C_C__C_C.
    .__0_____.
    .________.
    .lC_C_C_l.
    ..........
  `, { tags: ['parking'], weight: 2 });

  // bomba de gasolina: alpendre sobre pilares, bombas e loja de conveniência
  add('URBAN_PETROL', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~
    ._____+--!  ~~~~~~RRR~
    .#___#|1k!  ~RRRRRRRR~
    ._p_p_d=k!  ~RRRRRRRR~
    ._____^^^.  ~RRRRR~~~~
    ._p_p_....  ~RRRRR~~~~
    .#___#..C.  ~RRRRR~~~~
    ._____..b.  ~~~~~~~~~~
    ..7......l  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['building', 'petrol'], weight: 1, maxUses: 1 });

  // café com cozinha, despensa e esplanada
  add('URBAN_CAFE', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~
    .+---+--!.  ~RRRRRRR~~
    .|=kk|=c!.  ~RRRRRRR~~
    .+D---D-!.  ~RRRRRRR~~
    .|t=t=t=j.  ~RRRRRRR~~
    .d=1==4=!.  ~RRRRRRR~~
    .|t=t=t=!.  ~RRRRRRR~~
    .^JJEJJ^..  ~~~~~~~~~~
    .q.q.q.q7.  ~~~~~~~~~~
    ..........  ~~~~~~~~~~
  `, { tags: ['building', 'cafe'], weight: 2 });

  // pequeno prédio: dois apartamentos por piso, escada no átrio
  add('URBAN_FLATS', 'URBAN', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .+--+-+--!  ~+--+-+--]  ~RRRRRRRR~
    .|B=|c|=B!  ~|B=|=|=B]  ~RRRRRRRR~
    .i==|=|==j  ~|==|=|==)  ~RRRRRRRR~
    .|1=+D|=1!  ~|1=+D|=1]  ~RRRRRRRR~
    .|==dsd==!  ~|==dSd==]  ~RRRRRRRR~
    .|t=|=|t=!  ~|B=|4|B=]  ~RRRRRRRR~
    .|k=|=|=k!  ~|t=|=|=t]  ~RRRRRRRR~
    .^J^EE^J^.  ~;:;;;;:;~  ~~~~~~~~~~
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
  `, { tags: ['building', 'flats'], weight: 2 });

  // praça: monumento, candeeiros, bancos e canteiros
  add('URBAN_PLAZA', 'URBAN', String.raw`
    ..........
    .l..,,..l.
    ..7.......
    .q......q.
    .,..##..,.
    .,..##..,.
    .q......q.
    ......7...
    .l..T...l.
    ..........
  `, { tags: ['plaza'], weight: 1, maxUses: 1 });

  // ---- edifícios 20×20 ---------------------------------------------------------------------------------------
  // supermercado: sala de vendas com prateleiras e caixas, armazém com cais de carga, escritório
  add('URBAN_STORE', 'URBAN', String.raw`
    ....................  ~~~~~~~~~~~~~~~~~~~~
    .+-----------+----!.  ~RRRRRRRRRRRRRRRRR~~
    .|=kkkk=kkkk=|cccc!.  ~RRRRRRRRRRRRRRRRR~~
    .|===========|=1=c!.  ~RRRRRRRRRRRRRRRRR~~
    .|=kkkk=kkkk=d====e.  ~RRRRRRRRRRRRRRRRR~~
    .|===========|c==c!.  ~RRRRRRRRRRRRRRRRR~~
    .|=kkkk=kkkk=|cc=c!.  ~RRRRRRRRRRRRRRRRR~~
    .|====1======|c==c!.  ~RRRRRRRRRRRRRRRRR~~
    .|=kkkk=kkkk=+-D--!.  ~RRRRRRRRRRRRRRRRR~~
    .|===========|t=k=!.  ~RRRRRRRRRRRRRRRRR~~
    .|=kkkk=kkkk=d==4=j.  ~RRRRRRRRRRRRRRRRR~~
    .|===========|t==k!.  ~RRRRRRRRRRRRRRRRR~~
    .|=tt=1==tt==|====!.  ~RRRRRRRRRRRRRRRRR~~
    .|===========|k==k!.  ~RRRRRRRRRRRRRRRRR~~
    .^^^EE^JJJJJ^^^J^^..  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~
    .l....7.....l....7..  ~~~~~~~~~~~~~~~~~~~~
    ..q.q.......yy......  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~
  `, { tags: ['building', 'store'], weight: 2, maxUses: 1 });

  // prédio de três pisos: corredor central, oito apartamentos por piso, escadas z0→z1 e z1→z2, logradouro
  add('URBAN_APARTMENTS', 'URBAN', String.raw`
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .+---+---+---+---!..  ~+---+---+---+---]~~  ~+---+---+---+---]~~
    .|BB=|k=B|B=k|=BB!..  ~|B=B|=BB|k=B|B==]~~  ~|B==|BB=|=BB|=B=]~~
    .i=1=|===|=1=|===j..  ~i===|=1=|===|=1=)~~  ~i=1=|===|=1=|===)~~
    .|=t=|t==|==t|=t=!..  ~|=t=|===|=t=|===]~~  ~|===|=t=|===|=t=]~~
    .|=k=|===|=k=|=4=!..  ~|=k=|=k=|===|=k4]~~  ~|=k=|4==|=k=|===]~~
    .+D---D---D---D--!..  ~+D---D---D---D--]~~  ~+D---D---D---D--]~~
    .d======s========e..  ~i======Ss=======)~~  ~i=======S=======)~~
    .+-D-+-D-+-D-+-D-!..  ~+-D-+-D-+-D-+-D-]~~  ~+-D-+-D-+-D-+-D-]~~
    .|=B=|B==|=B=|==B!..  ~|==B|B==|=B=|=B=]~~  ~|=B=|==B|=B=|B==]~~
    .i=1=|=1=|===|=1=j..  ~i=1=|=1=|=1=|===)~~  ~i=1=|===|=1=|=1=)~~
    .|t=k|=t=|k=t|t==!..  ~|t==|=t=|k=t|t=k]~~  ~|=t=|t==|=t=|==t]~~
    .|===|k==|===|==k!..  ~|===|k==|===|===]~~  ~|k==|===|k==|===]~~
    .^J^^^J^^^J^^^J^^...  ~;:;;;:;;;:;;;:;;~~~  ~;:;;;:;;;:;;;:;;~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ..l__C__C__C__l.....  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ...___0_____0_......  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ...___________......  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .....b.....b...T....  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
  `, { tags: ['building', 'apartments'], weight: 2, maxUses: 1 });

  // escritórios de dois pisos: átrio com receção e escada, open space, sala de reuniões, gabinete
  add('URBAN_OFFICE', 'URBAN', String.raw`
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .+--------+----!....  ~+--------+----]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|t=t=t=t=|=tt=!....  ~|t=t=t=t=|B==k]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .i========d=tt=j....  ~i========d====)~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|t=t=t=t=|=4==!....  ~|t=t=t=t=|=t==]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|========+-D--!....  ~|========+-D--]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .i=t=t=t=t|k==k!.T..  ~i=t=t=t=t|k=4k)~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|=1======d=t4=j....  ~|=1======d=t==]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|t=t=t=t=|k==k!....  ~|t=t=t=t=|k==k]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .+---DD--------!....  ~+---DD--------]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|k===========k!....  ~|k===========k]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .i=====1=======j....  ~i=====1=======)~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|==tt=======s=!.T..  ~|==tt=======S=]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|=============!....  ~|======4======]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .|k===========k!....  ~|k===========k]~~~~  ~RRRRRRRRRRRRRR~~~~~
    .^^JJ^EE^JJ^^^^.....  ~;;::;;;::;;;;~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ..l..q..7..q..l..T..  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .................T..  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
  `, { tags: ['building', 'office'], weight: 2, maxUses: 1 });

  // ---- estradas (orientação fixa; candeeiros l nos passeios, carros C na faixa) ------------------------------
  const road = (id, arms, text, nodes) => add(id, 'URBAN', text, {
    tags: ['road', arms.length === 2 ? 'straight' : 'junction'], arms, rotate: false, weight: 1, nodes: nodes || [],
  });

  // DESIGN §7.4: N–S com candeeiro numa placa central e outro no passeio, dois carros
  road('URBAN_ROAD_NS', 'NS', String.raw`
    ..____....
    ..____l...
    ..____....
    ..__C_....
    ..____....
    ..__l__...
    ..____....
    ..__C_....
    ..____....
    ..____....
  `, [[2, 8, 0, 6], [7, 1, 0, 6]]);

  road('URBAN_ROAD_EW', 'EW', String.raw`
    ..........
    .l......l.
    __________
    ___C______
    __________
    ______C___
    ...l....l.
    ....7.....
    ..T.....T.
    ..........
  `);

  road('URBAN_ROAD_X', 'NESW', String.raw`
    ..____....
    .l____.l..
    __________
    __________
    ____0_____
    __________
    ..____....
    .l____.l..
    ..____.7..
    ..____....
  `);

  // entroncamentos: braços indicados (haste do T para o lado da letra)
  road('URBAN_ROAD_TN', 'NEW', String.raw`
    ..____....
    .l____.l..
    __________
    ___C______
    __________
    __________
    ..........
    .l...7..l.
    ..........
    ..........
  `);

  road('URBAN_ROAD_TE', 'NES', String.raw`
    ..____....
    .l____.l..
    ..________
    ..________
    ..__C_____
    ..________
    ..____....
    .7____..l.
    ..____....
    ..____....
  `);

  road('URBAN_ROAD_TS', 'ESW', String.raw`
    ..........
    .l..7...l.
    __________
    ______C___
    __________
    __________
    ..____....
    .l____.l..
    ..____....
    ..____....
  `);

  road('URBAN_ROAD_TW', 'NSW', String.raw`
    ..____....
    .l____.l..
    ______....
    ______..7.
    ______....
    ___C__....
    ..____....
    ..____.l..
    ..____....
    ..____....
  `);

  // ---- script (terror: 40×40×3; OVNIs caídos em cidade usam o tamanho do OVNI) ------------------------------
  D.mapScripts.URBAN = {
    tileset: 'URBAN',
    sizes: D.MAP_SIZES_UFO,
    blocks: ['URBAN_HOUSE', 'URBAN_HOUSE_B', 'URBAN_SHOP', 'URBAN_PARK', 'URBAN_PARKING', 'URBAN_PETROL', 'URBAN_CAFE',
      'URBAN_FLATS', 'URBAN_PLAZA', 'URBAN_STORE', 'URBAN_APARTMENTS', 'URBAN_OFFICE'],
    // civis em qualquer chão caminhável, exterior ou interior, nos pisos 0 e 1
    civilians: { levels: [0, 1], floors: ['ground', 'road', 'inner'], minCraftDist: 6 },
    commands: [
      { type: 'addUFO', gap: 1 },
      {
        type: 'addRoads', chance: { ns: 50, ew: 50 }, spur: 50,
        blocks: { ns: 'URBAN_ROAD_NS', ew: 'URBAN_ROAD_EW', cross: 'URBAN_ROAD_X', tN: 'URBAN_ROAD_TN', tE: 'URBAN_ROAD_TE', tS: 'URBAN_ROAD_TS', tW: 'URBAN_ROAD_TW' },
      },
      { type: 'addCraft', prefer: 'road' },
      { type: 'addBlock', size: 20, tags: ['building'], count: [1, 2] },
      {
        type: 'fill', size: 10,
        weights: { URBAN_HOUSE: 3, URBAN_HOUSE_B: 2, URBAN_SHOP: 3, URBAN_PARK: 2, URBAN_PARKING: 2, URBAN_PETROL: 1, URBAN_CAFE: 2, URBAN_FLATS: 2, URBAN_PLAZA: 1 },
      },
    ],
  };
})(globalThis.OV || (globalThis.OV = {}));
