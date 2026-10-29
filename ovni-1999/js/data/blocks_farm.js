/* Blocos de terreno QUINTA (FARM) + infraestrutura comum dos blocos de terreno e dos scripts de mapa
   (DESIGN.md §7.2–7.4). Carrega antes de blocks_wild/urban/alien.js, que usam o que este ficheiro exporta:

     OV.Data.addTerrainBlock(id, set, texto, opts)  regista um bloco a partir de texto com os níveis lado a lado
     OV.Data.parseLevels(texto)                     → [[linhas z0], [linhas z1], …]
     OV.Data.TERRAIN_LEGEND                         legenda extra destes blocos (sobreposições por bloco, §7.2)
     OV.Data.ROAD_PROFILE                           [2,3,4,5]: posições da faixa de rodagem em cada aresta com braço
     OV.Data.MAP_SIZES_UFO                          {small:[30,30,3], medium:[40,40,3], large:[50,50,3]}
     OV.Data.mapScripts[TERRENO]                    scripts de mapa (dados para sim/battle/mapgen.js)

   ══ Blocos de terreno ══════════════════════════════════════════════════════════════════════════════════
   Texto com uma coluna por nível (z0 à esquerda), separadas por espaços; cada coluna tem h linhas de w carateres.
   Campos além dos de tiles.js: tags (vocabulário: building, field, nature, road, straight, junction, plaza,
   module, lift, command, hangar, corridor, objective, …), weight (peso nas escolhas por etiqueta), maxUses
   (0 = sem limite), rotate (true ⇒ o gerador pode rodar o bloco ¼ de volta k vezes; false ⇒ orientação fixa),
   arms (só estradas: arestas com faixa, ex. 'NS', 'NEW'), nodes [[x,y,z,patente,prio]] (nós exteriores).
   rotate e arms ficam só em OV.Data.blocks[id] (o compilado de tiles.js não os copia).
   Regras de autoria (verificadas em tools/tests/data_terrain_blocks.test.js):
   · nenhuma parede/vedação na aresta norte da linha 0 nem na aresta oeste da coluna 0 (a rotação perdê-las-ia);
   · em blocos exteriores cada segmento de 10 tiles de cada aresta tem ≥ 6 tiles transitáveis, por isso dois
     blocos vizinhos quaisquer partilham ≥ 2 passagens; tudo o que é caminhável (exceto telhados) forma uma só
     componente dentro do bloco (sem bolsas abertas só para fora, que ficariam isoladas junto à borda do mapa);
   · edifícios ('building') só se entram pelas portas e têm teto sobre o interior; escadas s(z) ↔ S(z+1);
   · nós de patente 6 (unidades de terror, algumas 2×2) têm um quadrado 2×2 livre a partir do nó;
   · base alienígena: borda maciça exceto aberturas de 2 tiles nas posições 4–5 de cada segmento de 10.

   Legenda extra (além da tabela do DESIGN §7.2; é passada como block.legend):
     J  chão exterior + janela norte (janela na fachada sul, piso 0)   Z  chão exterior + vedação oeste e norte
     y  chão exterior + caixote (fardo de palha, toros, caixas)         q  chão exterior + mesa (esplanada, banco)
     p  estrada + armário (bomba de gasolina)                            0  estrada + nó 6
     7  chão exterior + nó 6 (terror)   8  chão exterior + nó 1 (soldado)   9  chão exterior + nó 0 (batedor)

   ══ Scripts de mapa: OV.Data.mapScripts[TERRENO] ═══════════════════════════════════════════════════════════
   { id, nameKey, tileset, sizes:{small:[w,h,d], medium:[…], large:[…]}, ceiling, blocks:[ids], civilians, commands:[…] }
   · tileset: os blocos de terreno são usados com OV.Data.getCompiled(id, script.tileset) (ex.: blocos FOREST com a
     paleta JUNGLE). Blocos de OVNI e de nave mantêm o seu set (UFO/CRAFT).
   · sizes: tamanhos válidos [w,h,d] em tiles (w,h múltiplos de 10). O gerador usa o tamanho pedido pela missão
     (ufos.js map / deployment map); sem pedido usa `medium`. A grelha é de células 10×10: cx ∈ [0,w/10), cy ∈ [0,h/10).
   · ceiling (base alienígena): o teto está implícito; nada voa nem se vê acima do nível 0 fora do que os blocos
     tenham escrito em z ≥ 1 (os blocos ALIENBASE só têm z0; o mapa tem d = 2).
   · blocks: lista de blocos disponíveis para escolhas por etiqueta (addBlock com tags).
   · civilians: null ou {levels:[z…], floors:['ground','road','inner'], minCraftDist:n} — civis em tiles caminháveis
     dos níveis indicados cujo chão tem um desses papéis, fora das pegadas da nave/OVNI e a distância de Chebyshev
     ≥ minCraftDist de qualquer tile da nave. Quantidade: deployment.civilians.
   · commands correm por ordem; tudo o que é aleatório usa o RNG `map` dado ao gerador; todos são "melhor esforço"
     (nunca falham, exceto addCraft/addUFO sem espaço nenhum ⇒ o gerador repete com a variante seguinte da semente).
     Uma "pegada" é o retângulo de células ocupado por um bloco (w/10 × h/10, trocado em rotações ímpares).
     Separação entre pegadas A e B (em células) = max(folgaX, folgaY), folgaX = max(0, B.x0 − A.x1, A.x0 − B.x1)
     com x1 exclusivo; pegadas encostadas têm separação 0. «Âncoras» = pegadas postas por addCraft, addUFO e por
     addBlock com anchor:true.

     {type:'addCraft', gap:0, prefer:null|'road'}
       Bloco = OV.Data.crafts[spec.craftType].block (sem nave ⇒ nada). Pegada 1×2 células (rot 0/2) ou 2×1 (rot 1/3),
       sempre encostada à borda do mapa pelo lado comprido: vertical na coluna 0 ou na última (rot 0 ou 2 ao acaso),
       horizontal na linha 0 ou na última (rot 1 ou 3 ao acaso). Candidatas: células livres, separação ≥ gap das
       âncoras; escolha uniforme. prefer:'road' ⇒ primeiro tenta, entre as encostadas com separação ≥ gap, as
       posições cujas células são livres ou têm estrada reta (tags road+straight, nunca junction), com pelo menos
       uma estrada; essas estradas são retiradas e a nave fica pousada no fim da rua. Sem candidatas: gap baixa até
       0; depois aceita qualquer posição livre (não encostada); sem nenhuma ⇒ falha. Torna-se âncora.
       Inícios X-COM = startTiles; zona de recolha = craftTiles.
     {type:'addUFO', gap:1}
       Bloco = OV.Data.ufos[spec.ufoType].block (sem OVNI, ex. terror ⇒ nada). Rotação rng.int(0,3); qualquer
       posição livre com separação ≥ gap das âncoras (gap baixa até 0 se preciso); escolha uniforme. Âncora.
       OVNI e nave: na pegada estende-se primeiro o chão `ground` do tileset do script em z0 e depois carimbam-se
       só os tiles com compiled.mask = 1 (os '.' do bloco ficam terreno).
     {type:'addRoads', chance:{ns:50, ew:50}, spur:50, blocks:{ns, ew, cross, tN, tE, tS, tW}}
       Como o addLine do URBAN original: pct(ns) ⇒ só uma rua N–S; senão pct(ew) ⇒ só uma rua E–O; senão ambas.
       Rua N–S na coluna cx = rng.int(1, células−2) (0..células−1 se houver menos de 3): todas as células livres
       dessa coluna recebem `ns`. Rua E–O na linha cy = rng.int(1, células−2) com `ew`. Com ambas, a célula (cx,cy)
       recebe `cross` (se estiver livre ou tiver uma das ruas). Células ocupadas são saltadas (a rua acaba aí).
       spur (só com uma rua): pct(spur) ⇒ escolhe uma célula da rua que não esteja na borda do mapa e um dos dois
       lados perpendiculares; desde a célula vizinha até à borda põe o bloco reto perpendicular nas células livres,
       parando na primeira ocupada; se pôs pelo menos um, a célula de partida passa a T com a haste para esse lado
       (tN haste a norte: braços E, O, N; tE: N, S, E; tS: E, O, S; tW: N, S, O). Estradas nunca rodam.
       Todas as estradas encaixam: faixa nas posições ROAD_PROFILE (x 2–5 nas arestas N/S, y 2–5 nas E/O).
     {type:'addBlock', size:null|10|20, tags:[], weights:{id:peso}, maxUses:{id:n}, count:[min,max], at, anchor}
       Candidatos = weights (depois do finalize está sempre preenchido: se o script só deu tags, recebe os blocos
       de script.blocks com todas as tags e w = h = size, com peso block.weight). maxUses[id] (finalize: do comando
       ou do bloco; 0 = sem limite) conta todas as utilizações no mapa. n = rng.int(min,max); repete n vezes:
       escolhe com rng.weighted entre os candidatos não esgotados; rotação rng.int(0,3) se block.rotate, senão 0;
       posições livres para a pegada, filtradas por `at`:
         'any' todas · 'edge' a pegada toca a borda do mapa · 'inner' não toca a borda (se não houver, todas) ·
         'centre' a(s) de centro mais próximo do centro do mapa · 'far' a(s) de maior separação mínima às âncoras
         (sem âncoras = todas); escolha uniforme entre as que restam.
       Se o bloco escolhido não cabe, sai dos candidatos e escolhe-se outro; sem candidatos o comando termina.
       anchor:true ⇒ a pegada passa a âncora.
     {type:'fill', size:10, weights:{id:peso}, maxUses:{id:n}}
       Cada célula livre, por ordem (cy, depois cx), recebe rng.weighted entre os blocos não esgotados (se todos
       estiverem esgotados ignora maxUses). Rotação como em addBlock.

   Depois dos comandos (responsabilidade do gerador): carimbar cada bloco (rodado) no seu canto (cx·10, cy·10) para
   z < min(block.d, mapa.d); nós do bloco com o mesmo deslocamento; 2 nós de batedor (patente 0) por célula 10×10
   de terreno, ao acaso em tiles caminháveis de z0 com chão ground/road (nunca telhados nem tiles de nave/OVNI);
   objetivos = specials.OBJECTIVE de todos os blocos; inícios X-COM da nave ou, sem nave (base alienígena), os START
   dos blocos (módulo do elevador). Os nós dos blocos de terreno servem os aliens «fora do OVNI» (todos, em
   terror/base/Marte); os dos OVNIs servem a tripulação.
   Validação do DESIGN §7.3: a partir dos inícios X-COM chega-se a todos os nós de desova (senão nova variante).
   Implementação de referência destas regras (ocupação, carimbo, conectividade): simulate() em
   tools/tests/data_terrain_blocks.test.js. */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  D.blocks = D.blocks || {};
  D.mapScripts = D.mapScripts || {};
  D.onFinalize = D.onFinalize || function (name, fn, order) {
    (D.finalizers = D.finalizers || []).push({ name, fn, order: order === undefined ? 50 : order });
  };

  // ---- legenda extra e registo de blocos --------------------------------------------------------------
  const TERRAIN_LEGEND = {
    J: { floor: 'ground', north: 'window' },
    Z: { floor: 'ground', west: 'fence', north: 'fence' },
    y: { floor: 'ground', object: 'crate' },
    q: { floor: 'ground', object: 'table' },
    p: { floor: 'road', object: 'cabinet' },
    0: { floor: 'road', node: 6 },
    7: { floor: 'ground', node: 6 },
    8: { floor: 'ground', node: 1 },
    9: { floor: 'ground', node: 0 },
  };
  const ROAD_PROFILE = [2, 3, 4, 5];

  // texto com níveis lado a lado → [[linhas z0], [linhas z1], …]; colunas em falta ficam '' (o compilador acusa)
  function parseLevels(text) {
    const lines = String(text).split('\n').map((s) => s.trim()).filter((s) => s !== '');
    const cols = lines.map((s) => s.split(/\s+/));
    const nz = cols.reduce((m, c) => Math.max(m, c.length), 0);
    const levels = [];
    for (let z = 0; z < nz; z++) levels.push(cols.map((c) => (c[z] === undefined ? '' : c[z])));
    return levels;
  }

  function addTerrainBlock(id, set, text, opts) {
    const levels = parseLevels(text);
    const o = opts || {};
    const block = Object.assign({
      id, set, w: levels.length ? levels[0][0].length : 0, h: levels.length ? levels[0].length : 0,
      tags: [], weight: 1, maxUses: 0, rotate: true, levels,
    }, o);
    block.legend = Object.assign({}, TERRAIN_LEGEND, o.legend || {});
    D.blocks[id] = block;
    return block;
  }

  // ---- scripts: valores por omissão e validação cruzada --------------------------------------------------
  const COMMANDS = ['addCraft', 'addUFO', 'addRoads', 'addBlock', 'fill'];
  const AT = ['any', 'edge', 'inner', 'centre', 'far'];
  const ROAD_KEYS = { ns: 'NS', ew: 'EW', cross: 'NESW', tN: 'NEW', tE: 'NES', tS: 'ESW', tW: 'NSW' };
  const range = (v, def) => (Array.isArray(v) ? [v[0] | 0, v[1] | 0] : v === undefined ? [def, def] : [v | 0, v | 0]);

  // pesos e limites explícitos para o gerador (candidatos por etiqueta resolvidos aqui)
  function resolveCandidates(Data, s, c) {
    if (!c.weights) {
      const w = {};
      for (const id of s.blocks) {
        const b = Data.blocks[id];
        if (!b) continue;
        if (c.size && !(b.w === c.size && b.h === c.size)) continue;
        if (!c.tags.every((t) => (b.tags || []).includes(t))) continue;
        w[id] = b.weight === undefined ? 1 : b.weight;
      }
      c.weights = w;
    }
    const mu = {};
    for (const id in c.weights) {
      const b = Data.blocks[id];
      const own = c.maxUses && c.maxUses[id] !== undefined ? c.maxUses[id] : b && b.maxUses ? b.maxUses : 0;
      mu[id] = own | 0;
    }
    c.maxUses = mu;
  }

  D.onFinalize('mapScripts.defaults', (Data) => {
    for (const id in Data.mapScripts) {
      const s = Data.mapScripts[id];
      s.id = id;
      s.nameKey = s.nameKey || 'terrain.' + id;
      s.tileset = s.tileset || id;
      s.ceiling = !!s.ceiling;
      s.blocks = (s.blocks || []).slice();
      s.civilians = s.civilians || null;
      s.commands = (s.commands || []).map((c0) => {
        const c = Object.assign({}, c0);
        if (c.type === 'addCraft') Object.assign(c, { gap: c.gap | 0, prefer: c.prefer || null });
        else if (c.type === 'addUFO') c.gap = c.gap === undefined ? 1 : c.gap | 0;
        else if (c.type === 'addRoads') {
          c.chance = Object.assign({ ns: 50, ew: 50 }, c.chance || {});
          c.spur = c.spur | 0;
          c.blocks = Object.assign({}, c.blocks);
        } else if (c.type === 'addBlock') {
          Object.assign(c, {
            size: c.size || null, tags: (c.tags || []).slice(), count: range(c.count, 1),
            at: c.at || 'any', anchor: !!c.anchor,
          });
          resolveCandidates(Data, s, c);
        } else if (c.type === 'fill') {
          c.size = c.size || 10;
          c.tags = [];
          resolveCandidates(Data, s, c);
        }
        return c;
      });
    }
  }, 10);

  D.onFinalize('mapScripts.validate', (Data) => {
    const errs = [];
    for (const id in Data.mapScripts) {
      const s = Data.mapScripts[id];
      const fail = (m) => errs.push('mapScripts.' + id + ': ' + m);
      if (!Data.tilesets || !Data.tilesets[s.tileset]) fail('tileset desconhecido ' + s.tileset);
      const sizes = Object.keys(s.sizes || {});
      if (!sizes.length) fail('sem tamanhos');
      for (const k of sizes) {
        const [w, h, d] = s.sizes[k];
        if (!(w >= 20 && h >= 20 && w % 10 === 0 && h % 10 === 0 && d >= 1 && d <= 3)) fail('tamanho inválido ' + k + ' ' + s.sizes[k]);
      }
      // o bloco tem de existir, ter as medidas do comando e compilar no tileset do script
      const check = (bid, size, what) => {
        const b = Data.blocks[bid];
        if (!b) return fail(what + ': bloco desconhecido ' + bid);
        if (size && !(b.w === size && b.h === size)) fail(what + ': ' + bid + ' tem ' + b.w + '×' + b.h + ' (esperado ' + size + ')');
        try {
          Data.getCompiled(bid, s.tileset);
        } catch (e) {
          fail(what + ': ' + bid + ' não compila em ' + s.tileset + ' (' + e.message + ')');
        }
      };
      for (const bid of s.blocks) check(bid, 0, 'blocks');
      s.commands.forEach((c, k) => {
        const what = 'comando ' + k + ' ' + c.type;
        if (!COMMANDS.includes(c.type)) return fail(what + ': tipo desconhecido');
        if (c.type === 'addRoads') {
          for (const key in ROAD_KEYS) {
            const bid = c.blocks[key];
            check(bid, 10, what + '.' + key);
            const b = Data.blocks[bid];
            if (b && (b.rotate || b.arms !== ROAD_KEYS[key])) fail(what + ': ' + bid + ' tem de ser fixo com braços ' + ROAD_KEYS[key]);
          }
        }
        if (c.type === 'addBlock' || c.type === 'fill') {
          const ids = Object.keys(c.weights);
          if (!ids.length) fail(what + ': sem candidatos');
          for (const bid of ids) {
            check(bid, c.type === 'fill' ? 10 : c.size, what);
            if (!(c.weights[bid] > 0)) fail(what + ': peso inválido para ' + bid);
          }
          if (c.type === 'addBlock' && !AT.includes(c.at)) fail(what + ': at inválido ' + c.at);
          if (c.count && !(c.count[0] >= 0 && c.count[1] >= c.count[0])) fail(what + ': count inválido');
        }
      });
    }
    if (errs.length) throw new Error(errs.join('\n    '));
    if (OV.U && OV.U.deepFreeze) OV.U.deepFreeze(Data.mapScripts);
  }, 90);

  Object.assign(D, { addTerrainBlock, parseLevels, TERRAIN_LEGEND, ROAD_PROFILE });

  // ---- QUINTA ---------------------------------------------------------------------------------------------
  const add = addTerrainBlock;

  // DESIGN §7.4 (igual)
  add('FARM_FIELD', 'FARM', String.raw`
    ,,,,,,,,,,
    ,,,,,,,,,,
    ,,,,,,,,,,
    ..........
    FFFFF..FFF
    ,,,,,,,,,,
    ,,,,,,,,,,
    ,,,,b,,,,,
    ,,,,,,,,,,
    ..........
  `, { tags: ['field', 'nature'], weight: 5 });

  // seara cortada por uma sebe e um caminho de terra batida
  add('FARM_FIELD_B', 'FARM', String.raw`
    ,,,,,,h,,,
    ,,,,,,h,,,
    ,,,,,,h,,,
    ,,,,,,.,,,
    ,,,,,,h,,,
    __________
    ,,,,,,h,,,
    ,,b,,,h,,,
    ,,,,,,.,,,
    ,,,,,,h,,,
  `, { tags: ['field', 'nature'], weight: 4 });

  // pasto vedado com cancela a sul e fardos de palha
  add('FARM_FIELD_C', 'FARM', String.raw`
    ..........
    .ZFFFFFFFf
    .f.......f
    .f..y....f
    .f.....y.f
    .f.......f
    .f.yy....f
    .f.......f
    .FFFF..FF.
    ...b......
  `, { tags: ['field', 'nature'], weight: 3 });

  // DESIGN §7.4 (igual): celeiro com palheiro (z1) e telhado (z2)
  add('FARM_BARN', 'FARM', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .+------!.  ~+------]~  ~RRRRRRR~~
    .|cc===s!.  ~|=====S]~  ~RRRRRRR~~
    .|c=====!.  ~|c=====]~  ~RRRRRRR~~
    .|======j.  ~|======)~  ~RRRRRRR~~
    .|c====c!.  ~|======]~  ~RRRRRRR~~
    .|cc==cc!.  ~|cc====]~  ~RRRRRRR~~
    .^^^EE^^..  ~;;;;;;;~~  ~~~~~~~~~~
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .....b....  ~~~~~~~~~~  ~~~~~~~~~~
  `, { tags: ['building', 'barn'], weight: 2, maxUses: 2, nodes: [[4, 4, 0, 1], [4, 4, 1, 1]] });

  // casa da quinta: cozinha, sala, oficina e vestíbulo com escada; três quartos em cima
  add('FARM_HOUSE', 'FARM', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .+--+---!.  ~+--+---]~  ~RRRRRRR~~
    .|ktd=B=j.  ~|B=d=BB)~  ~RRRRRRR~~
    .i==|t==!.  ~i==|=t=]~  ~RRRRRRR~~
    .+D-+D--!.  ~+D-+---]~  ~RRRRRRR~~
    .d=s|c=c!.  ~|=S|B=k]~  ~RRRRRRR~~
    .|1=|=1=e.  ~|1=d===)~  ~RRRRRRR~~
    .|==d=k=!.  ~|==|=1=]~  ~RRRRRRR~~
    .^^^^JJ^..  ~;;;;::;~~  ~~~~~~~~~~
    ...b...b..  ~~~~~~~~~~  ~~~~~~~~~~
  `, { tags: ['building', 'house'], weight: 2, maxUses: 2 });

  // pomar em filas
  add('FARM_ORCHARD', 'FARM', String.raw`
    ..........
    .T..T..T..
    ..........
    .T..T..T..
    ....b.....
    .T..T..T..
    ..........
    .T..T..T..
    .....y....
    ..........
  `, { tags: ['orchard', 'nature'], weight: 2 });

  // silo de cereal (3 níveis), trator no terreiro e alpendre de ração
  add('FARM_SILO', 'FARM', String.raw`
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
    .____.....  ~~~~~~~~~~  ~~~~~~~~~~
    .##__.....  ~##~~~~~~~  ~RR~~~~~~~
    .##_C.....  ~##~~~~~~~  ~RR~~~~~~~
    .____.....  ~~~~~~~~~~  ~~~~~~~~~~
    .....+--!.  ~~~~~RRR~~  ~~~~~~~~~~
    ..y..d=c!.  ~~~~~RRR~~  ~~~~~~~~~~
    .....|1c!.  ~~~~~RRR~~  ~~~~~~~~~~
    .....^^^..  ~~~~~~~~~~  ~~~~~~~~~~
    ..........  ~~~~~~~~~~  ~~~~~~~~~~
  `, { tags: ['building', 'silo'], weight: 1, maxUses: 1 });

  // medas de palha, restolho e sebes
  add('FARM_HAYSTACKS', 'FARM', String.raw`
    ..........
    ..yy......
    ..yy...y..
    .......y..
    ...,,,,...
    .y.,,,,.yy
    ...,,,,...
    ..........
    .hhh..hhh.
    ..........
  `, { tags: ['field', 'nature'], weight: 2 });

  // terreiro 20×20: casa de dois pisos, celeiro, terreiro com trator, pocilga vedada e horta
  add('FARM_YARD', 'FARM', String.raw`
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .+--+--!...+------!.  ~+--+--]~~~RRRRRRR~~  ~RRRRRR~~~~~~~~~~~~~
    .|kt|=B!...|cc===c!.  ~|BB|=t)~~~RRRRRRR~~  ~RRRRRR~~~~~~~~~~~~~
    .|==d==j...|c=====!.  ~|==d==]~~~RRRRRRR~~  ~RRRRRR~~~~~~~~~~~~~
    .i1=|=s!...|==1===e.  ~i==|=S]~~~RRRRRRR~~  ~RRRRRR~~~~~~~~~~~~~
    .|==|1=!...|=====c!.  ~|1=|==]~~~RRRRRRR~~  ~RRRRRR~~~~~~~~~~~~~
    .^E^^J^....|c=====j.  ~;;:;;;~~~~RRRRRRR~~  ~~~~~~~~~~~~~~~~~~~~
    .......b...|c===cc!.  ~~~~~~~~~~~RRRRRRR~~  ~~~~~~~~~~~~~~~~~~~~
    ...........^^EE^^^..  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .........________...  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ..y......__C_____...  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .........________.y.  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ....b....________...  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .............__.....  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    ....................  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .ZFF..Ff.....__.....  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .f.yy..f.....__.,,,.  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .f..b..f.....__.,,,.  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .f.....f.....__.,,,.  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
    .FFFFFF......__.....  ~~~~~~~~~~~~~~~~~~~~  ~~~~~~~~~~~~~~~~~~~~
  `, { tags: ['building', 'farmyard'], weight: 1, maxUses: 1 });

  // tamanhos dos mapas de OVNI (ufos.js map: 30, 40 ou 50)
  D.MAP_SIZES_UFO = { small: [30, 30, 3], medium: [40, 40, 3], large: [50, 50, 3] };

  D.mapScripts.FARM = {
    tileset: 'FARM',
    sizes: D.MAP_SIZES_UFO,
    blocks: ['FARM_FIELD', 'FARM_FIELD_B', 'FARM_FIELD_C', 'FARM_BARN', 'FARM_HOUSE', 'FARM_ORCHARD', 'FARM_SILO', 'FARM_HAYSTACKS', 'FARM_YARD'],
    commands: [
      { type: 'addCraft' },
      { type: 'addUFO', gap: 1 },
      { type: 'addBlock', size: 20, tags: ['farmyard'], count: [0, 1] },
      {
        type: 'fill', size: 10,
        weights: { FARM_FIELD: 5, FARM_FIELD_B: 4, FARM_FIELD_C: 3, FARM_BARN: 2, FARM_HOUSE: 2, FARM_ORCHARD: 2, FARM_SILO: 1, FARM_HAYSTACKS: 2 },
      },
    ],
  };
})(globalThis.OV || (globalThis.OV = {}));
