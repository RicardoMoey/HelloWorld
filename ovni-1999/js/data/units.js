/* Unidades alienígenas e civis (orig units.rul/armors.rul; DESIGN.md §3.9), raças e plantéis por patente,
   tripulações por missão (ours, §3.12), níveis de armamento alienígena por mês (ours, §3.9), patentes e
   geração de soldados (§3.2: atributos, nomes por nacionalidade — Portugal com peso ×2, ours).
   Unidade: {id, nameKey, side 'alien'|'civ', race (id de OV.Data.races ou null), rank (patente alienígena
   ou null), species (cadáver/autópsia/arte), sprite, stats{tu,sta,hp,brav,react,fire,thr,str,melee,psiStr,psiSkill},
   armour{front,side,rear,under,mods{AP..SMOKE: %}}, size 1|2, height, kneel, float, move 'walk'|'fly'|'slide',
   energyRecovery, int (memória em turnos), aggr 0..2, value (pontos), corpse, weapon (arma embutida) | null,
   psi, capturable, noInventory, explodeOnDeath {power,dmg,radius} | null, spawnOnDeath (unidade) | null}.
   Dificuldade: índice 0..2 («Recruta», «Veterano», «Super-humano») ⇒ coef 0/2/4. */
(function (OV) {
  'use strict';

  const D = (OV.Data = OV.Data || {});
  const T = OV.TUNE;
  const U = OV.U;
  // finalize.js carrega no fim de js/data/ e reaproveita esta lista (mesma semântica de registo)
  D.finalizers = D.finalizers || [];
  D.onFinalize = D.onFinalize || function (name, fn, order) {
    D.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };

  const ALIEN_RANKS = ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier', 'terrorist'];
  const STAT_KEYS = ['tu', 'sta', 'hp', 'brav', 'react', 'fire', 'thr', 'str', 'melee', 'psiStr', 'psiSkill'];
  const SPRITES = ['soldier', 'sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f'];
  // % de cada patente que começa fora do OVNI (ours, §3.12)
  const OUTSIDE = { commander: 0, leader: 0, engineer: 20, medic: 20, navigator: 20, soldier: 50, terrorist: 50 };

  const st = (tu, sta, hp, brav, react, fire, thr, str, melee, psiStr, psiSkill) => ({ tu, sta, hp, brav, react, fire, thr, str, melee, psiStr, psiSkill });
  const arm = (front, side, rear, under, mods) => ({ front, side, rear, under, mods });

  // ---- unidades -----------------------------------------------------------------------------------------
  const UNITS = {};
  function alien(race, rank, base, o) {
    const u = Object.assign({ side: 'alien', race, rank, species: race, sprite: race, corpse: race + '_corpse' }, base, o);
    u.stats = Object.assign({}, base.stats, o.stats);
    const a = o.armour || base.armour;
    u.armour = arm(a.front, a.side, a.rear, a.under, Object.assign({}, a.mods));
    UNITS[race + '_' + rank] = u;
  }
  function terror(id, o) {
    UNITS[id] = Object.assign({ side: 'alien', race: null, rank: 'terrorist', species: id, sprite: id, corpse: id + '_corpse', noInventory: true }, o);
  }

  // Sectoides: psíquicos (líder/comandante)
  const SECTOID = { stats: st(54, 90, 30, 80, 63, 52, 58, 30, 76, 40, 0), armour: arm(4, 3, 2, 2, { MELEE: 120, ACID: 160, SMOKE: 0 }), height: 16, kneel: 12 };
  alien('sectoid', 'soldier', SECTOID, { int: 3, aggr: 2, value: 10 });
  alien('sectoid', 'engineer', SECTOID, { int: 6, aggr: 2, value: 16 });
  alien('sectoid', 'medic', SECTOID, { int: 5, aggr: 1, value: 14 });
  alien('sectoid', 'navigator', SECTOID, { int: 4, aggr: 2, value: 12 });
  alien('sectoid', 'leader', SECTOID, { stats: { psiStr: 50, psiSkill: 50 }, int: 7, aggr: 1, value: 20, psi: true });
  alien('sectoid', 'commander', SECTOID, { stats: { psiStr: 50, psiSkill: 60 }, int: 8, aggr: 0, value: 25, psi: true });

  // Flutuantes: voam
  const FLOATER = {
    stats: st(50, 90, 35, 80, 50, 50, 58, 40, 70, 35, 0), armour: arm(8, 6, 4, 12, { MELEE: 120, ACID: 160, SMOKE: 0 }),
    height: 21, kneel: 16, float: 2, move: 'fly',
  };
  alien('floater', 'soldier', FLOATER, { int: 4, aggr: 2, value: 12 });
  alien('floater', 'engineer', FLOATER, { int: 7, aggr: 2, value: 18 });
  alien('floater', 'navigator', FLOATER, { int: 5, aggr: 2, value: 14 });
  alien('floater', 'medic', FLOATER, { int: 6, aggr: 1, value: 16 });
  alien('floater', 'leader', FLOATER, {
    stats: { tu: 55, sta: 95, hp: 40, react: 60, fire: 60, str: 47, psiStr: 40 }, armour: arm(16, 12, 8, 12, FLOATER.armour.mods), int: 8, aggr: 0, value: 25,
  });
  alien('floater', 'commander', FLOATER, {
    stats: { tu: 60, sta: 100, hp: 45, react: 66, fire: 63, thr: 65, str: 48, melee: 76, psiStr: 45 }, armour: arm(24, 18, 12, 16, FLOATER.armour.mods),
    int: 8, aggr: 0, value: 35,
  });

  // Homens-Serpente: deslizam; IN 70
  const SNAKEMAN = { stats: st(40, 80, 45, 80, 45, 58, 65, 47, 76, 40, 0), armour: arm(20, 18, 16, 12, { IN: 70, SMOKE: 0 }), height: 18, kneel: 18, move: 'slide' };
  alien('snakeman', 'soldier', SNAKEMAN, { int: 2, aggr: 2, value: 15 });
  alien('snakeman', 'navigator', SNAKEMAN, { int: 3, aggr: 2, value: 17 });
  alien('snakeman', 'engineer', SNAKEMAN, { int: 4, aggr: 2, value: 20 });
  alien('snakeman', 'leader', SNAKEMAN, { stats: { react: 55, fire: 65, psiStr: 45 }, armour: arm(20, 24, 22, 20, SNAKEMAN.armour.mods), int: 5, aggr: 2, value: 28 });
  alien('snakeman', 'commander', SNAKEMAN, {
    stats: { tu: 45, sta: 84, hp: 55, react: 65, fire: 58, psiStr: 50 }, armour: arm(26, 26, 22, 20, SNAKEMAN.armour.mods), int: 6, aggr: 2, value: 36, energyRecovery: 40,
  });

  // Mutons: AP 60, armadura cresce com a patente
  const MUTON = { stats: st(56, 90, 125, 80, 60, 54, 62, 70, 76, 25, 0), armour: arm(20, 20, 20, 10, { AP: 60, SMOKE: 0 }), height: 21, kneel: 16, energyRecovery: 40 };
  alien('muton', 'soldier', MUTON, { int: 2, aggr: 2, value: 15 });
  alien('muton', 'navigator', MUTON, { armour: arm(24, 24, 24, 15, MUTON.armour.mods), int: 3, aggr: 2, value: 17 });
  alien('muton', 'engineer', MUTON, { armour: arm(28, 28, 28, 20, MUTON.armour.mods), int: 4, aggr: 2, value: 19 });

  // Etéreos: voam, psíquicos, IN 70 / STUN 80
  const ETHEREAL = {
    stats: st(68, 96, 55, 80, 75, 74, 80, 48, 85, 50, 40), armour: arm(35, 35, 35, 35, { IN: 70, STUN: 80, SMOKE: 0 }),
    height: 20, kneel: 15, move: 'fly', energyRecovery: 40, psi: true,
  };
  alien('ethereal', 'soldier', ETHEREAL, { int: 6, aggr: 1, value: 20 });
  alien('ethereal', 'leader', ETHEREAL, { stats: { psiStr: 60, psiSkill: 45 }, armour: arm(40, 40, 40, 40, ETHEREAL.armour.mods), int: 7, aggr: 1, value: 30 });
  alien('ethereal', 'commander', ETHEREAL, { stats: { psiStr: 65, psiSkill: 50 }, armour: arm(45, 45, 45, 45, ETHEREAL.armour.mods), int: 8, aggr: 1, value: 40 });

  // unidades de terror (armas embutidas; sem inventário)
  terror('cyberdisc', {
    stats: st(62, 90, 120, 110, 64, 60, 0, 90, 0, 100, 0), armour: arm(34, 34, 34, 34, { AP: 80, HE: 60, SMOKE: 0 }), size: 2, height: 15, kneel: 15, float: 2,
    move: 'fly', energyRecovery: 50, int: 5, aggr: 1, value: 20, weapon: 'cyberdisc_weapon', capturable: false,
    explodeOnDeath: { power: 120, dmg: 'HE', radius: 6 },
  });
  terror('sectopod', {
    stats: st(62, 90, 96, 110, 64, 60, 0, 90, 80, 100, 0), armour: arm(145, 130, 100, 90, { HE: 80, LASER: 150, PLASMA: 80, SMOKE: 0 }), size: 2, height: 23,
    kneel: 16, energyRecovery: 50, int: 4, aggr: 1, value: 30, weapon: 'sectopod_weapon', capturable: false,
  });
  terror('reaper', {
    stats: st(62, 90, 148, 90, 64, 0, 0, 90, 80, 35, 0), armour: arm(28, 28, 28, 4, { IN: 170, SMOKE: 0 }), size: 2, height: 23, kneel: 16,
    energyRecovery: 34, int: 2, aggr: 2, value: 25, weapon: 'reaper_weapon',
  });
  // golpe da Crisálida transforma o alvo em Zombie (arma: zombify)
  terror('chryssalid', {
    stats: st(110, 140, 96, 100, 70, 0, 0, 110, 80, 50, 0), armour: arm(34, 34, 34, 34, { IN: 80, STUN: 90, SMOKE: 0 }), height: 21, kneel: 16,
    energyRecovery: 40, int: 4, aggr: 1, value: 25, weapon: 'chryssalid_weapon',
  });
  // Zombie morto liberta uma Crisálida
  terror('zombie', {
    stats: st(40, 110, 84, 110, 40, 0, 0, 84, 80, 80, 0), armour: arm(4, 4, 4, 4, { AP: 60, HE: 80, LASER: 70, PLASMA: 70, STUN: 0, SMOKE: 0 }), height: 18,
    kneel: 18, energyRecovery: 20, int: 3, aggr: 2, value: 18, weapon: 'zombie_weapon', spawnOnDeath: 'chryssalid',
  });

  // civis (terror): fogem, nunca disparam
  for (const [id, female] of [['civilian_m', false], ['civilian_f', true]]) {
    UNITS[id] = {
      side: 'civ', race: null, rank: null, species: 'human', sprite: id, female, corpse: 'civilian_corpse',
      stats: st(35, 65, 30, 80, 30, 30, 50, 20, 50, 5, 0), armour: arm(0, 0, 0, 0, { MELEE: 120, ACID: 160 }), height: 21, kneel: 14,
      energyRecovery: 20, int: 4, aggr: 0, value: 30, capturable: false,
    };
  }

  D.units = Object.assign(D.units || {}, UNITS);

  // ---- raças: unidade por patente (terrorist = 2 posições, como TER/TER2 do orig) --------------------------
  const full = (r, ter) => ({
    commander: r + '_commander', leader: r + '_leader', engineer: r + '_engineer', medic: r + '_medic',
    navigator: r + '_navigator', soldier: r + '_soldier', terrorist: [ter, ter],
  });
  D.races = Object.assign(D.races || {}, {
    sectoid: { members: full('sectoid', 'cyberdisc') },
    floater: { members: full('floater', 'reaper') },
    snakeman: { members: Object.assign(full('snakeman', 'chryssalid'), { medic: 'snakeman_soldier' }) },
    // ours MVP: Mutons de terror em vez de Silacoide/Celatídeo (P1)
    muton: {
      members: {
        commander: 'muton_soldier', leader: 'muton_soldier', engineer: 'muton_engineer', medic: 'muton_soldier',
        navigator: 'muton_navigator', soldier: 'muton_soldier', terrorist: ['muton_soldier', 'muton_soldier'],
      },
    },
    ethereal: {
      members: {
        commander: 'ethereal_commander', leader: 'ethereal_leader', engineer: 'ethereal_leader', medic: 'ethereal_leader',
        navigator: 'ethereal_leader', soldier: 'ethereal_soldier', terrorist: ['sectopod', 'sectopod'],
      },
    },
    // Cidónia: Etéreos + Crisálida + Muton + Sectopodes
    mixed: {
      members: {
        commander: 'ethereal_commander', leader: 'ethereal_leader', engineer: 'chryssalid', medic: 'muton_soldier',
        navigator: 'muton_soldier', soldier: 'ethereal_soldier', terrorist: ['sectopod', 'sectopod'],
      },
    },
  });

  // ---- tripulações (ours, §3.12): qty[dificuldade] = [mín, máx]; unit opcional substitui a raça -------
  // A tabela §3.12 é a referência dos totais (Veterano/Super-humano reforçam soldados e terroristas).
  const same = (a, b) => [[a, b], [a, b], [a, b]];
  const row = (rank, qty, extra) => Object.assign({ rank, qty, outside: OUTSIDE[rank] }, extra);
  const ufoDep = (ufo, rows) => ({ kind: 'ufo', ufo, rows });
  D.deployments = Object.assign(D.deployments || {}, {
    dep_small_scout: ufoDep('small_scout', [row('soldier', [[1, 1], [1, 2], [2, 2]])]),
    dep_medium_scout: ufoDep('medium_scout', [row('soldier', [[2, 3], [3, 4], [4, 5]]), row('navigator', same(1, 1))]),
    dep_large_scout: ufoDep('large_scout', [row('soldier', [[2, 3], [3, 4], [4, 6]]), row('navigator', same(1, 1)), row('engineer', same(1, 1))]),
    dep_harvester: ufoDep('harvester', [
      row('soldier', [[3, 4], [4, 6], [6, 8]]), row('navigator', same(1, 1)), row('engineer', same(1, 1)), row('medic', same(1, 1)), row('leader', same(1, 1)),
    ]),
    dep_abductor: ufoDep('abductor', [
      row('soldier', [[3, 4], [4, 5], [6, 7]]), row('navigator', same(1, 1)), row('engineer', same(1, 1)), row('medic', same(1, 2)), row('leader', same(1, 1)),
    ]),
    dep_supply_ship: ufoDep('supply_ship', [
      row('soldier', [[4, 5], [6, 7], [8, 9]]), row('navigator', same(1, 1)), row('engineer', same(1, 1)), row('medic', same(1, 1)), row('leader', same(1, 1)),
    ]),
    dep_terror_ship: ufoDep('terror_ship', [
      row('soldier', [[3, 3], [4, 4], [5, 5]]), row('navigator', same(1, 1)), row('engineer', same(1, 1)), row('medic', same(1, 1)), row('leader', same(1, 1)),
      row('terrorist', [[2, 2], [3, 3], [4, 4]]),
    ]),
    dep_battleship: ufoDep('battleship', [
      row('commander', same(1, 1)), row('leader', same(1, 1)), row('engineer', same(1, 1)), row('medic', same(1, 1)), row('navigator', same(1, 1)),
      row('soldier', [[4, 5], [5, 6], [6, 7]]), row('terrorist', [[1, 2], [2, 3], [3, 4]]),
    ]),
    // cidade 40×40×3; civis RNG(10,14)
    dep_terror_site: {
      kind: 'terror', terrain: 'URBAN', map: { w: 40, h: 40, d: 3 }, civilians: [10, 14],
      // ours (varrimento): menos soldados e unidades de terror do que a tabela §3.12 — o terror chega cedo na campanha
      rows: [row('leader', same(1, 1)), row('soldier', [[2, 2], [2, 3], [3, 4]]), row('terrorist', [[2, 2], [2, 3], [3, 4]])],
    },
    // base alienígena (ours, afinada por varrimento): guarnição pequena — o assalto é com a Skyranger cheia (10)
    dep_alien_base: {
      kind: 'alienBase', terrain: 'ALIENBASE', map: { w: 40, h: 40, d: 2 }, objective: 'base_control',
      rows: [
        row('commander', same(1, 1)), row('leader', [[1, 1], [1, 1], [2, 2]]), row('engineer', same(1, 1)), row('medic', same(1, 1)),
        row('navigator', same(1, 1)), row('soldier', [[2, 2], [2, 3], [3, 4]]), row('terrorist', [[1, 1], [1, 1], [2, 2]]),
      ],
    },
    // Marte 50×50×2, uma só fase; o Cérebro Alienígena é o objetivo (ours: guarnição reduzida, Avenger cheio)
    dep_cydonia: {
      kind: 'cydonia', race: 'mixed', terrain: 'MARS', map: { w: 50, h: 50, d: 2 }, objective: 'alien_brain',
      rows: [
        row('commander', [[1, 1], [1, 1], [2, 2]], { outside: 0 }), row('leader', [[1, 1], [2, 2], [3, 3]], { outside: 0 }),
        row('soldier', [[2, 2], [2, 2], [3, 3]]),
        row('terrorist', [[1, 1], [1, 1], [2, 2]], { unit: 'chryssalid' }), row('terrorist', [[1, 1], [1, 1], [2, 2]], { unit: 'sectopod' }),
        row('soldier', [[1, 1], [2, 2], [2, 2]], { unit: 'muton_soldier' }),
      ],
    },
  });

  // ---- armamento alienígena (ours, §3.9): nível por mês de campanha, conjuntos e extras por patente ------
  D.alienItemTiers = {
    // % dos níveis 0/1/2 nos meses 0, 1, 2, 3 e 4+
    byMonth: [[90, 10, 0], [70, 25, 5], [45, 40, 15], [30, 50, 20], [0, 30, 70]],
    sets: [
      ['plasma_pistol', 'plasma_pistol_clip', 'plasma_pistol_clip'],
      ['plasma_rifle', 'plasma_rifle_clip', 'plasma_rifle_clip'],
      ['heavy_plasma', 'heavy_plasma_clip', 'heavy_plasma_clip'],
    ],
    // raças com nível fixo (os Etéreos levam sempre Plasma Pesado)
    raceTier: { ethereal: 2 },
    // aplicados por ordem: replace substitui o conjunto, add acrescenta; deployments limita a missões
    extras: [
      { ranks: ['medic'], pct: 40, replace: ['small_launcher', 'stun_bomb', 'stun_bomb'] },
      { ranks: ['commander'], pct: 25, deployments: ['dep_battleship', 'dep_alien_base'], replace: ['blaster_launcher', 'blaster_bomb', 'blaster_bomb'] },
      { ranks: ['navigator', 'engineer'], pct: 50, add: ['alien_grenade'] },
      { ranks: ['leader'], pct: 100, add: ['alien_grenade'] },
    ],
  };

  // crescimento por dificuldade (orig): stat += stat × pct × coef / 100; «Recruta»: Pontaria e armadura ×0,5
  D.alienGrowth = {
    coef: [0, 2, 4],
    pct: { tu: 4, sta: 4, react: 6, fire: 6, str: 2, psiStr: 4, psiSkill: 4, melee: 4 },
    beginnerFirePct: 50,
    beginnerArmourPct: 50,
  };

  // ---- patentes -------------------------------------------------------------------------------------------
  // soldados: índice = soldier.rank em G; scoreBonus = valor extra ao morrer (§3.2); leaderMod/deathWeight (§3.10)
  const SOLDIER_RANKS = ['rookie', 'squaddie', 'sergeant', 'captain', 'colonel', 'commander'];
  const SCORE_BONUS = [0, 0, 1, 3, 6, 10];
  D.ranks = {
    soldier: SOLDIER_RANKS.map((id, i) => ({
      id, idx: i, nameKey: 'rank.' + id, abbrKey: 'rank.' + id + '.abbr', scoreBonus: SCORE_BONUS[i],
      leaderMod: T.LEADER_MOD[i], deathWeight: T.RANK_WEIGHT[i],
    })),
    // slot = posição orig (CMD, LDR, ENG, MED, NAV, SOL, TER); outside = % fora do OVNI por omissão
    alien: {},
  };
  ALIEN_RANKS.forEach((id, i) => {
    D.ranks.alien[id] = { id, slot: i, nameKey: 'arank.' + id, outside: OUTSIDE[id] };
  });

  // ---- geração de soldados (orig, §3.2) --------------------------------------------------------------------
  // nomes: m/f = nomes próprios, last = apelidos (lastF = forma feminina, mesmo índice); familyFirst = apelido primeiro
  const NAMES = {
    pt: {
      m: ['João', 'José', 'António', 'Manuel', 'Francisco', 'Pedro', 'Rui', 'Nuno', 'Tiago', 'Miguel', 'Ricardo', 'Luís', 'Duarte', 'Gonçalo'],
      f: ['Maria', 'Ana', 'Joana', 'Inês', 'Beatriz', 'Catarina', 'Sofia', 'Rita', 'Marta', 'Teresa', 'Leonor', 'Mariana', 'Carolina', 'Filipa'],
      last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Sousa', 'Fernandes', 'Gonçalves', 'Gomes', 'Lopes', 'Marques', 'Ribeiro', 'Carvalho', 'Almeida', 'Pinto', 'Teixeira', 'Moreira'],
    },
    usa: {
      m: ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Thomas', 'Mark', 'Steven', 'Brian', 'Kevin'],
      f: ['Mary', 'Jennifer', 'Linda', 'Patricia', 'Susan', 'Karen', 'Lisa', 'Nancy', 'Michelle', 'Laura', 'Sarah', 'Amy'],
      last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris'],
    },
    canada: {
      m: ['Jean', 'Pierre', 'Marc', 'Luc', 'Daniel', 'Scott', 'Ryan', 'Jason', 'Patrick', 'Martin', 'Andrew', 'Kyle'],
      f: ['Marie', 'Isabelle', 'Nathalie', 'Chantal', 'Heather', 'Melissa', 'Stephanie', 'Julie', 'Karine', 'Megan', 'Jessica', 'Amanda'],
      last: ['Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'MacDonald', 'Campbell', 'Fraser', 'Stewart', 'Wilson', 'Leblanc', 'Bélanger'],
    },
    brazil: {
      m: ['Carlos', 'Paulo', 'Marcos', 'Rafael', 'Thiago', 'Lucas', 'Felipe', 'Rodrigo', 'Fábio', 'Leandro', 'Anderson', 'Márcio'],
      f: ['Adriana', 'Juliana', 'Fernanda', 'Patrícia', 'Aline', 'Camila', 'Vanessa', 'Renata', 'Luciana', 'Simone', 'Daniela', 'Priscila'],
      last: ['da Silva', 'dos Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Carvalho', 'Rocha', 'Alves', 'Ramos', 'Barbosa', 'Nascimento', 'Araújo', 'Cavalcanti', 'Moura'],
    },
    uk: {
      m: ['Oliver', 'Harry', 'George', 'Jack', 'Charles', 'Edward', 'Henry', 'Alistair', 'Gareth', 'Ian', 'Nigel', 'Simon'],
      f: ['Emma', 'Charlotte', 'Sophie', 'Emily', 'Hannah', 'Lucy', 'Victoria', 'Claire', 'Fiona', 'Gemma', 'Kirsty', 'Rebecca'],
      last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Davies', 'Evans', 'Wright', 'Walker', 'Hughes', 'Roberts', 'Edwards', 'Hall', 'Clarke', 'Thompson', 'Murray'],
    },
    france: {
      m: ['Jean', 'Pierre', 'Michel', 'Philippe', 'Alain', 'Nicolas', 'Christophe', 'Laurent', 'Olivier', 'Sébastien', 'Thierry', 'François'],
      f: ['Marie', 'Nathalie', 'Isabelle', 'Sylvie', 'Catherine', 'Valérie', 'Sandrine', 'Céline', 'Aurélie', 'Élodie', 'Camille', 'Manon'],
      last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garnier'],
    },
    germany: {
      m: ['Thomas', 'Michael', 'Andreas', 'Stefan', 'Frank', 'Jürgen', 'Klaus', 'Wolfgang', 'Markus', 'Jens', 'Uwe', 'Dieter'],
      f: ['Sabine', 'Claudia', 'Susanne', 'Petra', 'Andrea', 'Birgit', 'Katrin', 'Anja', 'Heike', 'Monika', 'Ute', 'Julia'],
      last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann'],
    },
    italy: {
      m: ['Giuseppe', 'Giovanni', 'Marco', 'Luca', 'Alessandro', 'Andrea', 'Francesco', 'Matteo', 'Stefano', 'Roberto', 'Paolo', 'Davide'],
      f: ['Giulia', 'Francesca', 'Chiara', 'Sara', 'Valentina', 'Federica', 'Alessia', 'Silvia', 'Elena', 'Paola', 'Laura', 'Martina'],
      last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa'],
    },
    spain: {
      m: ['Antonio', 'José', 'Manuel', 'Francisco', 'Javier', 'Carlos', 'Miguel', 'Alejandro', 'Pablo', 'Sergio', 'Jorge', 'Álvaro'],
      f: ['Carmen', 'María', 'Lucía', 'Laura', 'Marta', 'Elena', 'Cristina', 'Pilar', 'Isabel', 'Rocío', 'Nuria', 'Montserrat'],
      last: ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno'],
    },
    russia: {
      m: ['Ivan', 'Serguei', 'Dmitri', 'Alexei', 'Andrei', 'Mikhail', 'Nikolai', 'Vladimir', 'Iúri', 'Oleg', 'Pavel', 'Boris'],
      f: ['Olga', 'Natalia', 'Elena', 'Irina', 'Svetlana', 'Tatiana', 'Anna', 'Ekaterina', 'Marina', 'Ludmila', 'Galina', 'Ksenia'],
      last: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Volkov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov', 'Petrov', 'Fiodorov', 'Orlov', 'Pavlov', 'Vasiliev'],
      lastF: ['Ivanova', 'Smirnova', 'Kuznetsova', 'Popova', 'Volkova', 'Sokolova', 'Lebedeva', 'Kozlova', 'Novikova', 'Morozova', 'Petrova', 'Fiodorova', 'Orlova', 'Pavlova', 'Vasilieva'],
    },
    egypt: {
      m: ['Mohamed', 'Ahmed', 'Mahmoud', 'Mostafa', 'Omar', 'Khaled', 'Tarek', 'Hassan', 'Youssef', 'Amr', 'Karim', 'Sherif'],
      f: ['Fatma', 'Mona', 'Nour', 'Heba', 'Amira', 'Dina', 'Yasmin', 'Rania', 'Salma', 'Mariam', 'Aya', 'Laila'],
      last: ['Hassan', 'Ibrahim', 'Mahmoud', 'Mostafa', 'Abdel-Rahman', 'El-Sayed', 'Fahmy', 'Mansour', 'Nasser', 'Shalaby', 'Farouk', 'Gamal', 'Saleh', 'Soliman', 'Hegazy'],
    },
    nigeria: {
      m: ['Chukwuemeka', 'Oluwaseun', 'Emeka', 'Babatunde', 'Ibrahim', 'Musa', 'Tunde', 'Chinedu', 'Adebayo', 'Yusuf', 'Obinna', 'Segun'],
      f: ['Ngozi', 'Chioma', 'Funmilayo', 'Aisha', 'Folake', 'Adaeze', 'Bisi', 'Amaka', 'Halima', 'Yetunde', 'Nkechi', 'Zainab'],
      last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Balogun', 'Eze', 'Abubakar', 'Ogunleye', 'Nwosu', 'Bello', 'Adebayo', 'Obi', 'Danjuma', 'Olawale', 'Chukwu', 'Ibrahim'],
    },
    south_africa: {
      m: ['Thabo', 'Sipho', 'Johan', 'Pieter', 'Mandla', 'Willem', 'Bongani', 'Andile', 'Hendrik', 'Jacques', 'Lwazi', 'Kagiso'],
      f: ['Nomvula', 'Thandiwe', 'Lerato', 'Anneke', 'Zanele', 'Nandi', 'Marelize', 'Palesa', 'Elmarie', 'Busisiwe', 'Lindiwe', 'Karin'],
      last: ['Nkosi', 'Dlamini', 'Botha', 'van der Merwe', 'Mokoena', 'Pretorius', 'Ndlovu', 'Venter', 'Khumalo', 'du Plessis', 'Mthembu', 'Steyn', 'Zulu', 'Coetzee', 'Molefe'],
    },
    india: {
      m: ['Rahul', 'Amit', 'Vikram', 'Rajesh', 'Sanjay', 'Arjun', 'Anil', 'Suresh', 'Deepak', 'Ravi', 'Manoj', 'Karan'],
      f: ['Priya', 'Anjali', 'Sunita', 'Kavita', 'Pooja', 'Neha', 'Deepa', 'Lakshmi', 'Meera', 'Anita', 'Shalini', 'Rekha'],
      last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Rao', 'Mehta', 'Joshi', 'Chopra', 'Verma', 'Das', 'Menon'],
    },
    china: {
      familyFirst: true,
      m: ['Wei', 'Jun', 'Lei', 'Hao', 'Ming', 'Jian', 'Tao', 'Bo', 'Qiang', 'Yong', 'Peng', 'Gang'],
      f: ['Li', 'Na', 'Fang', 'Jing', 'Mei', 'Yan', 'Xiu', 'Ying', 'Hui', 'Lan', 'Xia', 'Juan'],
      last: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu'],
    },
    japan: {
      m: ['Hiroshi', 'Takashi', 'Kenji', 'Satoshi', 'Kazuo', 'Makoto', 'Daisuke', 'Shinji', 'Yuji', 'Akira', 'Tetsuya', 'Kenta'],
      f: ['Yuko', 'Keiko', 'Naoko', 'Akiko', 'Yumi', 'Tomoko', 'Mayumi', 'Kumiko', 'Emi', 'Sachiko', 'Haruka', 'Megumi'],
      last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue'],
    },
    australia: {
      m: ['Matthew', 'Daniel', 'Michael', 'Ben', 'Luke', 'Nathan', 'Craig', 'Shane', 'Bradley', 'Jason', 'Lachlan', 'Mitchell'],
      f: ['Sarah', 'Rebecca', 'Kylie', 'Michelle', 'Jessica', 'Nicole', 'Amanda', 'Emma', 'Rachel', 'Kate', 'Tanya', 'Leanne'],
      last: ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White', 'Martin', 'Anderson', 'Thompson', 'Nguyen', 'Walker', 'Ryan', 'Kelly'],
    },
  };
  // nacionalidades: os 16 países financiadores (id = país) + Portugal ('pt', fora do conselho) com peso ×2
  const nationalities = {};
  for (const id in NAMES) nationalities[id] = { weight: id === 'pt' ? 2 : 1, country: id === 'pt' ? null : id };

  D.soldierGen = {
    statKeys: STAT_KEYS.slice(),
    statsMin: st(50, 40, 25, 10, 30, 40, 50, 20, 20, 0, 0),
    statsMax: st(60, 70, 40, 60, 60, 70, 80, 40, 40, 100, 0),
    caps: st(80, 100, 60, 100, 100, 120, 120, 70, 120, 100, 100),
    step: { brav: 10 }, // Bravura = RNG(1,6) × 10
    femalePct: 25,
    standHeight: 22,
    kneelHeight: 14,
    sprite: 'soldier',
    armour: 'coveralls',
    hire: T.SOLDIER_HIRE,
    salary: T.SOLDIER_SALARY,
    // subida pós-missão por experiência (orig): exp ≤ upTo ⇒ RNG(min, max)
    improve: [
      { upTo: 0, min: 0, max: 0 }, { upTo: 2, min: 0, max: 1 }, { upTo: 5, min: 1, max: 3 }, { upTo: 10, min: 1, max: 4 }, { upTo: 1e9, min: 2, max: 6 },
    ],
    nationalities,
    names: NAMES,
    weights: {}, // compilado: {natId: peso}
  };

  // ---- helpers puros ----------------------------------------------------------------------------------------
  const diffIdx = (diff) => U.clamp(diff | 0, 0, 2);

  // unidade de uma raça para uma patente; pick (0/1) escolhe entre as duas posições de terrorista
  D.raceUnit = function (raceId, rank, pick) {
    const r = D.races[raceId];
    if (!r) return null;
    const m = r.members[rank];
    if (Array.isArray(m)) return m[(pick | 0) & 1];
    return m || null;
  };
  // unidade de uma linha de tripulação (a linha pode fixar a unidade; a missão pode fixar a raça)
  D.rowUnit = function (dep, row, raceId, pick) {
    if (row.unit) return row.unit;
    return D.raceUnit((dep && dep.race) || raceId, row.rank, pick);
  };
  D.rowQty = function (row, diff) {
    return row.qty[diffIdx(diff)];
  };
  // total de alienígenas de uma missão (sem civis) → {min, max}
  D.deploymentRange = function (depId, diff) {
    const dep = D.deployments[depId];
    if (!dep) return null;
    let min = 0, max = 0;
    for (const r of dep.rows) {
      const q = D.rowQty(r, diff);
      min += q[0];
      max += q[1];
    }
    return { min, max };
  };

  // nível de armamento (0..2) para o mês de campanha (consome 1 número do rng)
  D.rollItemTier = function (month, rng) {
    const rows = D.alienItemTiers.byMonth;
    const row = rows[U.clamp(month | 0, 0, rows.length - 1)];
    let roll = rng.int(1, 100);
    for (let t = 0; t < row.length; t++) {
      if (roll <= row[t]) return t;
      roll -= row[t];
    }
    return row.length - 1;
  };
  // itens de um alienígena (o primeiro é a arma) → [itemId]; unidades com arma embutida → []
  D.alienLoadout = function (unitId, depId, tier, rng) {
    const u = D.units[unitId];
    if (!u || u.side !== 'alien' || u.weapon || u.noInventory) return [];
    const tiers = D.alienItemTiers;
    let t = tiers.raceTier[u.race];
    if (t === undefined) t = U.clamp(tier | 0, 0, tiers.sets.length - 1);
    let set = tiers.sets[t].slice();
    for (const ex of tiers.extras) {
      if (ex.ranks.indexOf(u.rank) < 0) continue;
      if (ex.deployments && ex.deployments.indexOf(depId) < 0) continue;
      if (ex.pct < 100 && !rng.pct(ex.pct)) continue;
      if (ex.replace) set = ex.replace.slice();
      if (ex.add) for (const a of ex.add) set.push(a);
    }
    return set;
  };

  // atributos de um alienígena na dificuldade dada (novo objeto; civis sem alterações)
  D.alienStats = function (unitId, diff) {
    const u = D.units[unitId];
    if (!u) return null;
    const out = Object.assign({}, u.stats);
    if (u.side !== 'alien') return out;
    const g = D.alienGrowth, d = diffIdx(diff), coef = g.coef[d];
    for (const k in out) out[k] += U.idiv(out[k] * (g.pct[k] || 0) * coef, 100);
    if (d === 0) out.fire = U.idiv(out.fire * g.beginnerFirePct, 100);
    return out;
  };
  // armadura [frente, esquerda, direita, traseira, baixo] na dificuldade dada («Recruta»: ×0,5 nos alienígenas)
  D.alienArmour = function (unitId, diff) {
    const u = D.units[unitId];
    if (!u) return null;
    const pct = u.side === 'alien' && diffIdx(diff) === 0 ? D.alienGrowth.beginnerArmourPct : 100;
    return D.armourArray(u.armour, pct);
  };

  // nacionalidade de um recruta novo (consome 1 número do rng)
  D.pickNationality = function (rng) {
    return rng.weighted(D.soldierGen.weights);
  };
  // nome completo para a nacionalidade (consome 2 números do rng)
  D.soldierName = function (rng, natId, female) {
    const n = D.soldierGen.names[natId] || D.soldierGen.names.pt;
    const first = rng.pick(female ? n.f : n.m);
    const li = rng.int(0, n.last.length - 1);
    const last = female && n.lastF ? n.lastF[li] : n.last[li];
    return n.familyFirst ? last + ' ' + first : first + ' ' + last;
  };
  // atributos iniciais de um recruta (consome 1 número por atributo, pela ordem de statKeys)
  D.rollSoldierStats = function (rng) {
    const g = D.soldierGen, out = {};
    for (const k of g.statKeys) {
      const s = g.step[k] || 1;
      out[k] = rng.int(U.idiv(g.statsMin[k], s), U.idiv(g.statsMax[k], s)) * s;
    }
    return out;
  };
  D.soldierRank = function (idx) {
    const r = D.ranks.soldier;
    return r[U.clamp(idx | 0, 0, r.length - 1)];
  };

  // ---- finalização ------------------------------------------------------------------------------------------
  const setDef = (o, k, v) => {
    if (o[k] === undefined) o[k] = v;
  };

  D.onFinalize('units.defaults', () => {
    for (const id in D.units) {
      const u = D.units[id];
      u.id = id;
      setDef(u, 'nameKey', 'unit.' + id);
      setDef(u, 'side', 'alien');
      setDef(u, 'race', null);
      setDef(u, 'rank', null);
      setDef(u, 'species', id);
      setDef(u, 'sprite', u.species);
      setDef(u, 'size', 1);
      setDef(u, 'float', 0);
      setDef(u, 'move', 'walk');
      setDef(u, 'energyRecovery', 30);
      setDef(u, 'weapon', null);
      setDef(u, 'psi', false);
      setDef(u, 'capturable', u.side === 'alien');
      setDef(u, 'noInventory', false);
      setDef(u, 'explodeOnDeath', null);
      setDef(u, 'spawnOnDeath', null);
      setDef(u, 'female', false);
    }
    for (const id in D.races) {
      const r = D.races[id];
      r.id = id;
      setDef(r, 'nameKey', 'race.' + id);
      setDef(r, 'pluralKey', 'race.' + id + '.plural');
    }
    for (const id in D.deployments) {
      const d = D.deployments[id];
      d.id = id;
      setDef(d, 'ufo', null);
      setDef(d, 'race', null);
      setDef(d, 'terrain', null);
      setDef(d, 'map', null);
      setDef(d, 'civilians', null);
      setDef(d, 'objective', null);
    }
    const nat = D.soldierGen.nationalities;
    for (const id in nat) {
      nat[id].id = id;
      setDef(nat[id], 'nameKey', 'nat.' + id);
    }
  }, 10);

  D.onFinalize('units.compile', () => {
    for (const id in D.units) D.units[id].armour.mods = D.damageMods(D.units[id].armour.mods);
    for (const id in D.deployments) {
      const d = D.deployments[id];
      for (const r of d.rows) {
        r.min = r.qty[0][0];
        r.max = r.qty[0][1];
        setDef(r, 'unit', null);
      }
      d.totals = [0, 1, 2].map((k) => {
        const t = D.deploymentRange(id, k);
        return [t.min, t.max];
      });
    }
    const w = {};
    for (const id in D.soldierGen.nationalities) w[id] = D.soldierGen.nationalities[id].weight;
    D.soldierGen.weights = w;
  }, 50);

  D.onFinalize('units.validate', () => {
    const err = [];
    const item = (id) => D.items && D.items[id];
    for (const id in D.units) {
      const u = D.units[id];
      if (u.race !== null && !D.races[u.race]) err.push('unit ' + id + ': raça desconhecida ' + u.race);
      if (u.rank !== null && ALIEN_RANKS.indexOf(u.rank) < 0) err.push('unit ' + id + ': patente desconhecida ' + u.rank);
      if (!item(u.corpse) || item(u.corpse).kind !== 'corpse') err.push('unit ' + id + ': cadáver inválido ' + u.corpse);
      if (u.weapon && (!item(u.weapon) || !item(u.weapon).fixed)) err.push('unit ' + id + ': arma embutida inválida ' + u.weapon);
      if (u.spawnOnDeath && !D.units[u.spawnOnDeath]) err.push('unit ' + id + ': spawnOnDeath inexistente');
      if (u.explodeOnDeath && !D.damageTypes[u.explodeOnDeath.dmg]) err.push('unit ' + id + ': explosão com dano desconhecido');
      if (SPRITES.indexOf(u.sprite) < 0) err.push('unit ' + id + ': sprite desconhecido ' + u.sprite);
      for (const k of STAT_KEYS) if (typeof u.stats[k] !== 'number') err.push('unit ' + id + ': falta stat ' + k);
      if (['walk', 'fly', 'slide'].indexOf(u.move) < 0) err.push('unit ' + id + ': move inválido');
    }
    for (const id in D.races) {
      const m = D.races[id].members;
      for (const rank of ALIEN_RANKS) {
        const v = m[rank];
        const list = rank === 'terrorist' ? v : [v];
        if (!Array.isArray(list) || (rank === 'terrorist' && list.length !== 2)) {
          err.push('race ' + id + ': posição ' + rank + ' inválida');
          continue;
        }
        for (const u of list) if (!D.units[u] || D.units[u].side !== 'alien') err.push('race ' + id + ': unidade inexistente ' + u);
      }
    }
    for (const id in D.deployments) {
      const d = D.deployments[id];
      if (d.race && !D.races[d.race]) err.push('deployment ' + id + ': raça desconhecida');
      if (!d.rows.length) err.push('deployment ' + id + ': sem linhas');
      for (const r of d.rows) {
        if (ALIEN_RANKS.indexOf(r.rank) < 0) err.push('deployment ' + id + ': patente ' + r.rank);
        if (r.unit && !D.units[r.unit]) err.push('deployment ' + id + ': unidade ' + r.unit);
        if (!Array.isArray(r.qty) || r.qty.length !== 3) err.push('deployment ' + id + ': qty sem 3 dificuldades');
        else for (const q of r.qty) if (!(q[0] >= 0 && q[1] >= q[0])) err.push('deployment ' + id + ': qty inválido');
        if (!(r.outside >= 0 && r.outside <= 100)) err.push('deployment ' + id + ': outside inválido');
      }
      if (d.civilians && !(d.civilians[0] >= 0 && d.civilians[1] >= d.civilians[0])) err.push('deployment ' + id + ': civis inválidos');
    }
    const tiers = D.alienItemTiers;
    for (const row of tiers.byMonth) {
      if (row.length !== tiers.sets.length || row.reduce((a, b) => a + b, 0) !== 100) err.push('alienItemTiers: linha não soma 100');
    }
    const items = [];
    for (const s of tiers.sets) items.push(...s);
    for (const ex of tiers.extras) {
      items.push(...(ex.replace || []), ...(ex.add || []));
      for (const r of ex.ranks) if (ALIEN_RANKS.indexOf(r) < 0) err.push('alienItemTiers: patente ' + r);
      for (const dp of ex.deployments || []) if (!D.deployments[dp]) err.push('alienItemTiers: deployment ' + dp);
    }
    for (const it of items) if (!item(it)) err.push('alienItemTiers: item inexistente ' + it);
    const g = D.soldierGen;
    for (const id in g.nationalities) {
      const n = g.names[id];
      if (!n || n.m.length < 12 || n.f.length < 12 || n.last.length < 15) err.push('soldierGen: nomes insuficientes ' + id);
      else if (n.lastF && n.lastF.length !== n.last.length) err.push('soldierGen: lastF ≠ last ' + id);
    }
    for (const k of STAT_KEYS) if (!(g.statsMin[k] <= g.statsMax[k] && g.statsMax[k] <= g.caps[k])) err.push('soldierGen: limites de ' + k);
    if (err.length) throw new Error(err.join('; '));
  }, 90);

  D.onFinalize('units.freeze', () => {
    for (const k of ['units', 'races', 'deployments', 'alienItemTiers', 'alienGrowth', 'ranks', 'soldierGen']) U.deepFreeze(D[k]);
  }, 99);
})(globalThis.OV || (globalThis.OV = {}));
