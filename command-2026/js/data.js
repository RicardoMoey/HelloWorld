/* Dados de jogo: ogivas, armas, unidades, edifícios, fações, poderes de apoio */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;

  // Multiplicador de dano: ogiva × classe de blindagem.
  // Triângulo tático: Infantaria < Veículos < Aéreo < Infantaria.
  CG.WARHEADS = {
    SMALL: { inf: 1.0, veh: 0.15, air: 0.55, bld: 0.1 },
    MG: { inf: 1.4, veh: 0.45, air: 0.4, bld: 0.2 },
    AP: { inf: 0.8, veh: 1.0, air: 0, bld: 0.7 },
    HE: { inf: 1.25, veh: 0.6, air: 0, bld: 0.9 },
    AT: { inf: 0.3, veh: 1.25, air: 0, bld: 0.6 },
    AA: { inf: 0, veh: 0, air: 1.3, bld: 0 },
    AIR: { inf: 0.5, veh: 1.5, air: 0, bld: 0.6 },
    SNIPE: { inf: 3.0, veh: 0.05, air: 0, bld: 0.02 },
    DEMO: { inf: 0.8, veh: 1.2, air: 0, bld: 1.0 },
    HACK: { inf: 0, veh: 1, air: 0, bld: 1 },
    SUPER: { inf: 1, veh: 1, air: 1, bld: 1 },
  };

  // range/minRange/splash em tiles (convertidos para px abaixo); cd em segundos
  const W = {
    rifle: { wh: 'SMALL', dmg: 9, cd: 0.7, range: 4.2, targets: 'ga', proj: 'bullet', snd: 'rifle' },
    hmg: { wh: 'MG', dmg: 6, cd: 0.26, range: 4.8, targets: 'ga', proj: 'bullet', snd: 'mg' },
    autocannon: { wh: 'MG', dmg: 12, cd: 0.42, range: 5, targets: 'ga', proj: 'bullet', snd: 'autocannon' },
    sniper: { wh: 'SNIPE', dmg: 70, cd: 2.2, range: 7.5, targets: 'g', proj: 'bullet', snd: 'sniper' },
    grenade: { wh: 'HE', dmg: 30, cd: 1.6, range: 4.5, splash: 0.9, targets: 'g', proj: 'lob', speed: 260, snd: 'grenade' },
    manpads: { wh: 'AA', dmg: 40, cd: 2.0, range: 6.5, targets: 'a', proj: 'missile', speed: 420, snd: 'missile' },
    flak: { wh: 'AA', dmg: 14, cd: 0.35, range: 7, targets: 'a', proj: 'bullet', snd: 'flak' },
    cannon105: { wh: 'AP', dmg: 40, cd: 1.5, range: 5.2, splash: 0.75, targets: 'g', proj: 'shell', speed: 720, snd: 'cannon' },
    cannon125: { wh: 'AP', dmg: 56, cd: 2.0, range: 5.6, splash: 0.85, targets: 'g', proj: 'shell', speed: 680, snd: 'cannonHeavy' },
    cannon90: { wh: 'AP', dmg: 32, cd: 1.3, range: 4.8, splash: 0.65, targets: 'g', proj: 'shell', speed: 740, snd: 'cannon' },
    gmlrs: { wh: 'HE', dmg: 70, cd: 3.2, burst: 2, burstGap: 0.25, range: 9, minRange: 2, splash: 1.1, targets: 'g', proj: 'rocket', speed: 330, scatter: 0.3, snd: 'rocket' },
    howitzer: { wh: 'HE', dmg: 110, cd: 4.0, range: 11, minRange: 3, splash: 1.4, targets: 'g', proj: 'arty', speed: 300, scatter: 0.7, snd: 'howitzer', shake: 3 },
    grad: { wh: 'HE', dmg: 40, cd: 8, burst: 8, burstGap: 0.12, range: 10, minRange: 3, splash: 1.0, targets: 'g', proj: 'rocket', speed: 300, scatter: 1.5, snd: 'rocket', shake: 1.5 },
    rocketTech: { wh: 'HE', dmg: 30, cd: 6, burst: 4, burstGap: 0.18, range: 8.5, minRange: 2, splash: 0.9, targets: 'g', proj: 'rocket', speed: 300, scatter: 1.2, snd: 'rocket' },
    hellfire: { wh: 'AIR', dmg: 45, cd: 1.5, range: 5.5, targets: 'g', proj: 'missile', speed: 460, snd: 'missile' },
    rockets80: { wh: 'AIR', dmg: 28, cd: 0.8, range: 5, splash: 0.5, targets: 'g', proj: 'rocket', speed: 480, scatter: 0.25, snd: 'rocket' },
    droneMissile: { wh: 'AIR', dmg: 40, cd: 1.6, range: 6, targets: 'g', proj: 'missile', speed: 440, snd: 'missile' },
    hack: { wh: 'HACK', dmg: 0, cd: 9, range: 5.5, targets: 'g', proj: 'zap', hackTime: 7, snd: 'hack' },
    towerMg: { wh: 'MG', dmg: 7, cd: 0.22, range: 5.5, targets: 'ga', proj: 'bullet', snd: 'mg' },
    towerAt: { wh: 'AT', dmg: 70, cd: 1.8, range: 6.5, targets: 'g', proj: 'missile', speed: 480, snd: 'missile' },
    sam: { wh: 'AA', dmg: 60, cd: 1.6, range: 8, targets: 'a', proj: 'missile', speed: 560, snd: 'missile' },
    kamikaze: { wh: 'DEMO', dmg: 90, cd: 1, range: 0.4, splash: 0.95, targets: 'g', proj: 'self', snd: 'explodeSmall' },
  };
  for (const id in W) {
    const w = W[id];
    w.id = id;
    w.range *= T;
    w.minRange = (w.minRange || 0) * T;
    w.splash = (w.splash || 0) * T;
    w.scatter = (w.scatter || 0) * T;
    w.burst = w.burst || 1;
    w.burstGap = w.burstGap || 0;
    w.speed = w.speed || 0;
    w.shake = w.shake || 0;
    w.hitsAir = w.targets.indexOf('a') >= 0;
    w.hitsGround = w.targets.indexOf('g') >= 0;
  }
  CG.WEAPONS = W;

  // cat: inf | veh | air. speed em px/s, sight em tiles, time em s
  const U = {
    // ---------- comuns ----------
    mcv: { name: 'Veículo de Base (MCV)', cat: 'veh', cost: 3000, time: 30, hp: 1100, speed: 38, sight: 5, radius: 16, draw: 'mcv', prereq: ['factory', 'radar'], mcv: true,
      desc: 'Implanta um novo Centro de Comando. Tecla D para implantar.' },
    harv: { name: 'Extrator de Terras Raras', cat: 'veh', cost: 1000, time: 14, hp: 900, speed: 48, sight: 4, radius: 14, draw: 'harvester', prereq: ['refinery'], harvester: true, capacity: 700,
      desc: 'Recolhe terras raras e entrega-as na Refinaria.' },
    eng: { name: 'Engenheiro', cat: 'inf', cost: 500, time: 8, hp: 40, speed: 40, sight: 4, draw: 'engineer', prereq: ['barracks'], engineer: true,
      desc: 'Captura edifícios inimigos ou poços de petróleo; repara edifícios aliados.' },
    manpads: { name: 'Equipa MANPADS', cat: 'inf', cost: 250, time: 6, hp: 50, speed: 40, sight: 6, weapon: 'manpads', draw: 'manpads', prereq: ['barracks'],
      desc: 'Mísseis portáteis antiaéreos. Só ataca alvos aéreos.' },
    aa: { name: 'Antiaéreo Móvel', cat: 'veh', cost: 700, time: 10, hp: 340, speed: 70, sight: 7, radius: 12, weapon: 'flak', draw: 'aa', prereq: ['factory'],
      desc: 'Canhões antiaéreos rápidos. Só ataca alvos aéreos.' },

    // ---------- Aliança Atlântica ----------
    rifle_a: { name: 'Fuzileiro', cat: 'inf', cost: 100, time: 4, hp: 55, speed: 46, sight: 5, weapon: 'rifle', draw: 'rifle', prereq: ['barracks'],
      desc: 'Infantaria polivalente. Eficaz contra infantaria e aeronaves.' },
    sniper: { name: 'Atirador de Elite', cat: 'inf', cost: 450, time: 9, hp: 45, speed: 44, sight: 8, weapon: 'sniper', draw: 'sniper', prereq: ['barracks', 'radar'],
      desc: 'Elimina infantaria a longa distância com um só disparo.' },
    ifv_a: { name: 'Blindado Ágil', cat: 'veh', cost: 500, time: 8, hp: 260, speed: 108, sight: 7, radius: 11, weapon: 'autocannon', draw: 'ifv', prereq: ['factory'],
      desc: 'Muito rápido; canhão automático contra infantaria e helicópteros.' },
    tank_a: { name: 'Tanque Centurião', cat: 'veh', cost: 850, time: 12, hp: 460, speed: 74, sight: 6, radius: 13, weapon: 'cannon105', draw: 'tankA', prereq: ['factory'],
      desc: 'Carro de combate equilibrado e móvel.' },
    himars: { name: 'Lança-Foguetes de Precisão', cat: 'veh', cost: 1100, time: 14, hp: 220, speed: 72, sight: 6, radius: 12, weapon: 'gmlrs', draw: 'himars', prereq: ['factory', 'radar'],
      desc: 'Foguetes guiados de longo alcance. Não dispara a curta distância.' },
    heli_a: { name: 'Helicóptero de Ataque', cat: 'air', cost: 1100, time: 14, hp: 260, speed: 125, sight: 7, weapon: 'hellfire', draw: 'heliA', prereq: ['airfield'],
      desc: 'Mísseis anticarro. Destrói veículos; vulnerável a infantaria e antiaéreos.' },
    dscout: { name: 'Drone de Vigilância', cat: 'air', cost: 300, time: 6, hp: 100, speed: 165, sight: 11, draw: 'droneScout', prereq: ['airfield'], detector: true,
      desc: 'Desarmado. Grande visão e deteta unidades furtivas.' },

    // ---------- Eixo Euroasiático ----------
    conscript: { name: 'Recruta', cat: 'inf', cost: 80, time: 3, hp: 50, speed: 42, sight: 5, weapon: 'rifle', draw: 'rifle', prereq: ['barracks'],
      desc: 'Infantaria barata, produzida em massa.' },
    grenadier: { name: 'Granadeiro', cat: 'inf', cost: 250, time: 6, hp: 60, speed: 40, sight: 5, weapon: 'grenade', draw: 'grenadier', prereq: ['barracks'],
      desc: 'Granadas com dano de área contra infantaria e edifícios.' },
    ifv_e: { name: 'Blindado BTR', cat: 'veh', cost: 450, time: 8, hp: 290, speed: 92, sight: 6, radius: 11, weapon: 'hmg', draw: 'apc', prereq: ['factory'],
      desc: 'Metralhadora pesada contra infantaria e aeronaves.' },
    tank_e: { name: 'Tanque Pesado', cat: 'veh', cost: 1050, time: 15, hp: 700, speed: 52, sight: 6, radius: 14, weapon: 'cannon125', draw: 'tankE', prereq: ['factory'],
      desc: 'Blindagem pesada e canhão de 125 mm. Lento mas temível.' },
    arty: { name: 'Artilharia Autopropulsada', cat: 'veh', cost: 1000, time: 14, hp: 200, speed: 46, sight: 6, radius: 13, weapon: 'howitzer', draw: 'arty', prereq: ['factory', 'radar'],
      desc: 'Obus de longo alcance com grande dano de área. Não dispara a curta distância.' },
    grad: { name: 'Lança-Foguetes Múltiplo', cat: 'veh', cost: 1300, time: 16, hp: 230, speed: 55, sight: 6, radius: 13, weapon: 'grad', draw: 'grad', prereq: ['factory', 'tech'],
      desc: 'Salva de 8 foguetes que satura uma área inteira.' },
    heli_e: { name: 'Helicóptero Blindado', cat: 'air', cost: 1300, time: 16, hp: 380, speed: 98, sight: 7, weapon: 'rockets80', draw: 'heliE', prereq: ['airfield'],
      desc: 'Helicóptero robusto com foguetes contra veículos.' },

    // ---------- Vanguarda do Sul Global ----------
    militia: { name: 'Guerrilheiro', cat: 'inf', cost: 90, time: 3.5, hp: 48, speed: 54, sight: 6, weapon: 'rifle', draw: 'militia', prereq: ['barracks'],
      desc: 'Infantaria ligeira e rápida.' },
    hacker: { name: 'Hacker', cat: 'inf', cost: 600, time: 10, hp: 40, speed: 42, sight: 7, weapon: 'hack', draw: 'hacker', prereq: ['barracks', 'radar'],
      desc: 'Ciberataque à distância: desativa veículos e edifícios durante uns segundos.' },
    technical: { name: 'Técnica', cat: 'veh', cost: 300, time: 5, hp: 190, speed: 135, sight: 7, radius: 10, weapon: 'hmg', draw: 'technical', prereq: ['factory'],
      desc: 'Pick-up armada. Barata e muito rápida.' },
    rtech: { name: 'Técnica Lança-Foguetes', cat: 'veh', cost: 700, time: 9, hp: 160, speed: 115, sight: 6, radius: 10, weapon: 'rocketTech', draw: 'rtech', prereq: ['factory', 'radar'],
      desc: 'Artilharia móvel improvisada: dispara e foge.' },
    phantom: { name: 'Tanque Fantasma', cat: 'veh', cost: 900, time: 13, hp: 400, speed: 82, sight: 6, radius: 12, weapon: 'cannon90', draw: 'phantom', prereq: ['factory', 'radar'], stealth: true,
      desc: 'Furtivo: invisível ao inimigo enquanto não dispara (exceto muito perto).' },
    swarm: { name: 'Enxame de Drones', cat: 'air', cost: 500, time: 8, draw: 'swarmIcon', prereq: ['airfield'], squad: 4, spawn: 'kdrone',
      desc: '4 drones kamikaze que explodem contra o alvo.' },
    kdrone: { name: 'Drone Kamikaze', cat: 'air', cost: 125, time: 2, hp: 35, speed: 175, sight: 5, weapon: 'kamikaze', draw: 'kdrone', prereq: ['airfield'], hidden: true, kamikaze: true,
      desc: 'Explode contra o alvo.' },
    adrone: { name: 'Drone de Ataque', cat: 'air', cost: 800, time: 12, hp: 180, speed: 138, sight: 8, weapon: 'droneMissile', draw: 'adrone', prereq: ['airfield'],
      desc: 'Drone armado com mísseis anticarro.' },
  };
  const TURN = { inf: 12, veh: 3.2, air: 5 };
  const RADIUS = { inf: 5, veh: 12, air: 12 };
  const FACTORY = { inf: 'barracks', veh: 'factory', air: 'airfield' };
  for (const id in U) {
    const u = U[id];
    u.id = id;
    u.kind = 'unit';
    u.armor = u.cat;
    u.turn = u.turn || TURN[u.cat];
    u.radius = u.radius || (u.cat === 'air' && u.kamikaze ? 6 : RADIUS[u.cat]);
    u.factory = FACTORY[u.cat];
    u.weapon = u.weapon ? W[u.weapon] : null;
    u.hp = u.hp || 1;
    u.speed = u.speed || 0;
    u.sight = u.sight || 4;
  }
  CG.UNITS = U;

  // w/h em tiles; power positivo = produz, negativo = consome
  const B = {
    conyard: { name: 'Centro de Comando', w: 3, h: 3, cost: 3000, time: 30, hp: 2200, power: 10, sight: 7, tab: 'bld', draw: 'conyard', prereq: [], conyard: true, hidden: true,
      desc: 'Constrói todos os edifícios. Protege-o a todo o custo.' },
    power: { name: 'Central Elétrica', w: 2, h: 2, cost: 300, time: 7, hp: 650, power: 100, sight: 4, tab: 'bld', draw: 'power', prereq: ['conyard'],
      desc: 'Produz +100 de energia. Sem energia, a produção abranda e as defesas desligam-se.' },
    refinery: { name: 'Refinaria', w: 3, h: 2, cost: 1500, time: 16, hp: 1100, power: -40, sight: 5, tab: 'bld', draw: 'refinery', prereq: ['conyard', 'power'], refinery: true,
      desc: 'Processa terras raras em capital. Inclui um Extrator.' },
    barracks: { name: 'Quartel', w: 2, h: 2, cost: 400, time: 8, hp: 800, power: -20, sight: 5, tab: 'bld', draw: 'barracks', prereq: ['conyard', 'power'], produces: 'inf',
      desc: 'Treina infantaria.' },
    factory: { name: 'Fábrica de Guerra', w: 3, h: 3, cost: 1800, time: 18, hp: 1400, power: -30, sight: 5, tab: 'bld', draw: 'factory', prereq: ['conyard', 'refinery'], produces: 'veh',
      desc: 'Produz veículos.' },
    radar: { name: 'Centro de Comunicações', w: 2, h: 2, cost: 1000, time: 12, hp: 1000, power: -40, sight: 8, tab: 'bld', draw: 'radar', prereq: ['conyard', 'refinery'], radar: true,
      desc: 'Ativa o radar (minimapa), unidades avançadas e o 1.º poder de apoio.' },
    airfield: { name: 'Base Aérea', w: 3, h: 2, cost: 1200, time: 14, hp: 900, power: -30, sight: 5, tab: 'bld', draw: 'airfield', prereq: ['conyard', 'radar'], produces: 'air',
      desc: 'Produz helicópteros e drones.' },
    tech: { name: 'Laboratório Tecnológico', w: 2, h: 2, cost: 1800, time: 20, hp: 1000, power: -100, sight: 5, tab: 'bld', draw: 'tech', prereq: ['conyard', 'factory', 'radar'], tech: true,
      desc: 'Desbloqueia a tecnologia de topo e o poder de apoio supremo.' },
    tower_mg: { name: 'Torre de Metralhadora', w: 1, h: 1, cost: 400, time: 6, hp: 650, power: 0, sight: 6, tab: 'def', draw: 'towerMg', prereq: ['conyard', 'barracks'], weapon: 'towerMg', defense: true,
      desc: 'Defesa contra infantaria. Não precisa de energia.' },
    tower_at: { name: 'Torre Antitanque', w: 1, h: 1, cost: 700, time: 9, hp: 750, power: -20, sight: 7, tab: 'def', draw: 'towerAt', prereq: ['conyard', 'factory'], weapon: 'towerAt', defense: true, needsPower: true,
      desc: 'Mísseis anticarro. Desliga-se sem energia.' },
    sam: { name: 'Bateria SAM', w: 1, h: 1, cost: 750, time: 9, hp: 600, power: -20, sight: 8, tab: 'def', draw: 'sam', prereq: ['conyard', 'radar'], weapon: 'sam', defense: true, needsPower: true,
      desc: 'Mísseis terra-ar. Desliga-se sem energia.' },
    derrick: { name: 'Poço de Petróleo', w: 1, h: 1, cost: 0, time: 0, hp: 600, power: 0, sight: 3, tab: null, draw: 'derrick', prereq: [], hidden: true, capturable: true, noCount: true, income: 30, incomeEvery: 3,
      desc: 'Captura com um Engenheiro para receber capital regular.' },
  };
  for (const id in B) {
    const b = B[id];
    b.id = id;
    b.kind = 'bld';
    b.armor = 'bld';
    b.weapon = b.weapon ? W[b.weapon] : null;
    if (b.capturable === undefined) b.capturable = !b.defense;
  }
  CG.BUILDINGS = B;
  CG.typeDef = (id) => U[id] || B[id];

  // Poderes de apoio (radius em tiles, cd/dur/delay em s)
  CG.POWERS = {
    scan: { name: 'Varredura de Satélite', icon: 'sat', prereq: 'radar', cd: 70, radius: 9, dur: 12, kind: 'reveal',
      desc: 'Revela uma área do mapa durante 12 s.' },
    orbital: { name: 'Ataque Orbital', icon: 'orbital', prereq: 'tech', cd: 240, radius: 3.2, dmg: 1000, delay: 2.5, kind: 'strike',
      desc: 'Um feixe orbital devasta a área alvo após 2,5 s.' },
    barrage: { name: 'Barragem de Artilharia', icon: 'barrage', prereq: 'radar', cd: 110, radius: 4, shells: 16, dmg: 110, dur: 4, kind: 'barrage',
      desc: '16 granadas de artilharia sobre a área alvo.' },
    hypersonic: { name: 'Míssil Hipersónico', icon: 'missile', prereq: 'tech', cd: 300, radius: 4.5, dmg: 1500, delay: 3, kind: 'strike',
      desc: 'Míssil impossível de intercetar; enorme raio de destruição.' },
    cyber: { name: 'Ciberataque', icon: 'cyber', prereq: 'radar', cd: 100, radius: 3, dur: 15, steal: 0.15, kind: 'cyber',
      desc: 'Desativa edifícios na área, rouba 15% do capital inimigo e revela a zona.' },
    emp: { name: 'Pulso EMP', icon: 'emp', prereq: 'tech', cd: 210, radius: 6, dur: 18, kind: 'emp',
      desc: 'Desativa todos os veículos, aeronaves e edifícios inimigos na área durante 18 s.' },
  };
  for (const id in CG.POWERS) CG.POWERS[id].id = id;

  CG.FACTIONS = {
    atl: {
      id: 'atl', name: 'Aliança Atlântica', bloc: 'Bloco NATO/UE',
      motto: 'Tecnologia equilibrada, alta mobilidade e uma rede de satélites defensiva.',
      traits: ['Defesas com +20% de alcance', 'Veículos rápidos e versáteis', 'Varredura de Satélite e Ataque Orbital'],
      units: ['rifle_a', 'manpads', 'sniper', 'eng', 'ifv_a', 'tank_a', 'aa', 'himars', 'harv', 'mcv', 'heli_a', 'dscout'],
      powers: ['scan', 'orbital'],
      mods: { defRange: 1.2, prodInf: 1, prodVeh: 1, bldCost: 1 },
    },
    eur: {
      id: 'eur', name: 'Eixo Euroasiático', bloc: 'Doutrina blindada',
      motto: 'Blindados pesados, artilharia superior e produção em massa.',
      traits: ['Produção 20% mais rápida', 'Tanque Pesado e artilharia de longo alcance', 'Barragem de Artilharia e Míssil Hipersónico'],
      units: ['conscript', 'manpads', 'grenadier', 'eng', 'ifv_e', 'tank_e', 'aa', 'arty', 'grad', 'harv', 'mcv', 'heli_e'],
      powers: ['barrage', 'hypersonic'],
      mods: { defRange: 1, prodInf: 1.2, prodVeh: 1.2, bldCost: 1 },
    },
    van: {
      id: 'van', name: 'Vanguarda do Sul Global', bloc: 'Guerra assimétrica',
      motto: 'Furtividade, ciberguerra e enxames de drones.',
      traits: ['Edifícios 15% mais baratos', 'Tanque Fantasma furtivo e Hacker', 'Ciberataque e Pulso EMP'],
      units: ['militia', 'manpads', 'hacker', 'eng', 'technical', 'phantom', 'aa', 'rtech', 'harv', 'mcv', 'swarm', 'adrone'],
      powers: ['cyber', 'emp'],
      mods: { defRange: 1, prodInf: 1, prodVeh: 1, bldCost: 0.85 },
    },
  };

  CG.BUILD_TABS = [
    { id: 'bld', name: 'Estruturas', short: 'EST' },
    { id: 'def', name: 'Defesas', short: 'DEF' },
    { id: 'inf', name: 'Infantaria', short: 'INF' },
    { id: 'veh', name: 'Veículos', short: 'VEÍ' },
    { id: 'air', name: 'Aéreo', short: 'AÉR' },
  ];
  CG.STRUCT_ORDER = ['power', 'refinery', 'barracks', 'factory', 'radar', 'airfield', 'tech'];
  CG.DEF_ORDER = ['tower_mg', 'tower_at', 'sam'];

  CG.PREREQ_NAMES = {
    conyard: 'Centro de Comando', power: 'Central Elétrica', refinery: 'Refinaria', barracks: 'Quartel',
    factory: 'Fábrica de Guerra', radar: 'Centro de Comunicações', airfield: 'Base Aérea', tech: 'Laboratório Tecnológico',
  };

  CG.DIFFICULTY = {
    easy: { name: 'Fácil', think: 1.4, income: 0.85, build: 0.85, harvPerRef: 1, firstWave: 420, waveBase: 3200, waveGrow: 1400, counters: false, powers: false, engineers: false },
    normal: { name: 'Normal', think: 0.8, income: 1, build: 1, harvPerRef: 2, firstWave: 270, waveBase: 2600, waveGrow: 1500, counters: true, powers: true, engineers: true },
    hard: { name: 'Difícil', think: 0.5, income: 1.15, build: 1.15, harvPerRef: 2.5, firstWave: 180, waveBase: 2200, waveGrow: 1800, counters: true, powers: true, engineers: true },
  };

  CG.MAP_SIZES = { small: { name: 'Pequeno', size: 64 }, medium: { name: 'Médio', size: 88 }, large: { name: 'Grande', size: 112 } };
  CG.UNIT_CAP = 150;
})();
