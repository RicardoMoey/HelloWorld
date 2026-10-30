/* Regras de equipamento: tipos de dano, itens (armas, munições, explosivos, equipamento, materiais,
   componentes OVNI, artefactos, cadáveres, armaduras em armazém), armaduras de soldado
   e inventário. Valores orig (UFO1/OpenXcom items.rul, armors.rul, inventories.rul) salvo «ours»
   (DESIGN.md §3.3–3.8, §3.17). Armamento e munições de naves entram em OV.Data.items por crafts.js
   (kind craft_weapon/craft_ammo); artefactos por tipo de OVNI em OV.Data.ufos[id].artefacts.
   Campos de cada item (preenchidos por omissão no finalize):
     kind        firearm | ammo | melee | grenade | flare | medikit | scanner | psiamp | material |
                 component | artefact | corpse | armour
     weight      peso em batalha; size 1..4 (unidades de inventário, §3.7); twoHanded
     storage     espaço no armazém (unidades; Armazém = 50); buy (0 = não se compra), sell; deliveryH
     armour      resistência do item no chão a explosões (orig: 20 por omissão)
     research    tópico que desbloqueia usar/comprar/fabricar (null = sempre disponível)
     topic       tópico que «estuda» o item (pontos de recuperação só enquanto não investigado)
     recoveryPoints / recoveryPer  pontos por cada `recoveryPer` unidades recuperadas
     modes       {snap|aimed|auto|melee: {acc, tu, shots?, flat?}} (tu = % das UT máximas salvo flat)
     ammo        [ids de munição] ou null (arma com poder próprio e munição infinita: power, dmg)
     phase       'MVP' | 'P1' | 'P2' (fora do MVP: o mercado/equipar escondem; mvp = phase === 'MVP')
     battle      existe em batalha (pode ser equipado/largado); carry false = não se apanha (cadáver 2×2) */
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

  // ---- tipos de dano (idx = posição no damageModifier do OpenXcom; range = ±% do poder) ---------------
  const DMG_IDS = ['AP', 'IN', 'HE', 'LASER', 'PLASMA', 'STUN', 'MELEE', 'ACID', 'SMOKE'];
  D.damageTypes = Object.assign(D.damageTypes || {}, {
    AP: { idx: 1, range: T.DMG_RANGE, wounds: true, terrain: true, stun: false },
    IN: { idx: 2, range: T.DMG_RANGE, wounds: false, terrain: true, stun: false, ignoresArmour: true, fire: true },
    HE: { idx: 3, range: T.HE_DMG_RANGE, wounds: true, terrain: true, stun: false },
    LASER: { idx: 4, range: T.DMG_RANGE, wounds: true, terrain: true, stun: false },
    PLASMA: { idx: 5, range: T.DMG_RANGE, wounds: true, terrain: true, stun: false },
    STUN: { idx: 6, range: T.DMG_RANGE, wounds: false, terrain: false, stun: true },
    MELEE: { idx: 7, range: T.DMG_RANGE, wounds: true, terrain: false, stun: false },
    ACID: { idx: 8, range: T.DMG_RANGE, wounds: true, terrain: false, stun: false, phase: 'P1' },
    // fumo em unidades conta como atordoamento (SMOKE→STUN)
    SMOKE: { idx: 9, range: T.DMG_RANGE, wounds: false, terrain: false, stun: true, smoke: true },
  });
  D.DMG_IDS = DMG_IDS;

  // modificadores esparsos {IN:80} → mapa completo {AP:100, IN:80, ...}
  D.damageMods = function (sparse) {
    const o = {};
    for (const k of DMG_IDS) o[k] = sparse && sparse[k] !== undefined ? sparse[k] : 100;
    return o;
  };

  // ---- itens ------------------------------------------------------------------------------------------
  const melee = (acc, tu, flat) => ({ melee: { acc, tu, flat: !!flat } });

  D.items = Object.assign(D.items || {}, {
    // armas convencionais (compráveis desde o início)
    pistol: {
      kind: 'firearm', weight: 5, size: 2, storage: 0.1, buy: 800, sell: 600, ammo: ['pistol_clip'],
      modes: { snap: { acc: 60, tu: 18 }, aimed: { acc: 78, tu: 30 } }, sfx: 'pistol',
    },
    pistol_clip: { kind: 'ammo', power: 26, dmg: 'AP', rounds: 12, weight: 3, size: 1, storage: 0.1, buy: 70, sell: 52, armour: 12 },
    rifle: {
      kind: 'firearm', weight: 8, size: 3, twoHanded: true, storage: 0.2, buy: 3000, sell: 2250, ammo: ['rifle_clip'],
      modes: { snap: { acc: 60, tu: 25 }, aimed: { acc: 110, tu: 80 }, auto: { acc: 35, tu: 35, shots: 3 } }, sfx: 'rifle',
    },
    rifle_clip: { kind: 'ammo', power: 30, dmg: 'AP', rounds: 20, weight: 3, size: 1, storage: 0.1, buy: 200, sell: 150 },
    heavy_cannon: {
      kind: 'firearm', weight: 18, size: 4, twoHanded: true, storage: 0.3, buy: 6400, sell: 4800, ammo: ['hc_ap', 'hc_he', 'hc_in'],
      modes: { snap: { acc: 60, tu: 33 }, aimed: { acc: 90, tu: 80 } }, sfx: 'cannon',
    },
    hc_ap: { kind: 'ammo', power: 56, dmg: 'AP', rounds: 6, weight: 6, size: 2, storage: 0.1, buy: 300, sell: 225 },
    hc_he: { kind: 'ammo', power: 52, dmg: 'HE', radius: 2, rounds: 6, weight: 6, size: 2, storage: 0.1, buy: 500, sell: 275 },
    hc_in: { kind: 'ammo', power: 60, dmg: 'IN', radius: 3, rounds: 6, weight: 6, size: 2, storage: 0.1, buy: 400, sell: 300 },
    auto_cannon: {
      kind: 'firearm', weight: 19, size: 4, twoHanded: true, storage: 0.3, buy: 13500, sell: 10125, ammo: ['ac_ap', 'ac_he', 'ac_in'],
      modes: { snap: { acc: 56, tu: 33 }, aimed: { acc: 82, tu: 80 }, auto: { acc: 32, tu: 40, shots: 3 } }, sfx: 'cannon',
    },
    ac_ap: { kind: 'ammo', power: 42, dmg: 'AP', rounds: 14, weight: 5, size: 2, storage: 0.1, buy: 500, sell: 400 },
    ac_he: { kind: 'ammo', power: 44, dmg: 'HE', radius: 2, rounds: 14, weight: 5, size: 2, storage: 0.1, buy: 700, sell: 560 },
    ac_in: { kind: 'ammo', power: 48, dmg: 'IN', radius: 2, rounds: 14, weight: 5, size: 2, storage: 0.1, buy: 650, sell: 520 },
    rocket_launcher: {
      kind: 'firearm', weight: 10, size: 4, twoHanded: true, storage: 0.4, buy: 4000, sell: 3000,
      ammo: ['small_rocket', 'large_rocket', 'incendiary_rocket'],
      modes: { snap: { acc: 55, tu: 45 }, aimed: { acc: 115, tu: 75 } }, sfx: 'rocket',
    },
    small_rocket: { kind: 'ammo', power: 75, dmg: 'HE', radius: 3, rounds: 1, weight: 6, size: 3, storage: 0.2, buy: 600, sell: 480 },
    large_rocket: { kind: 'ammo', power: 100, dmg: 'HE', radius: 5, rounds: 1, weight: 8, size: 3, storage: 0.2, buy: 900, sell: 720 },
    incendiary_rocket: { kind: 'ammo', power: 90, dmg: 'IN', radius: 4, rounds: 1, weight: 8, size: 3, storage: 0.2, buy: 1200, sell: 960 },

    // armas laser (fabrico; munição infinita)
    laser_pistol: {
      kind: 'firearm', weight: 7, size: 2, storage: 0.1, sell: 20000, ammo: null, power: 46, dmg: 'LASER', research: 'laser_pistol',
      modes: { snap: { acc: 40, tu: 20 }, aimed: { acc: 68, tu: 55 }, auto: { acc: 28, tu: 25, shots: 3 } }, sfx: 'laser',
    },
    laser_rifle: {
      kind: 'firearm', weight: 8, size: 3, twoHanded: true, storage: 0.2, sell: 36900, ammo: null, power: 60, dmg: 'LASER', research: 'laser_rifle',
      modes: { snap: { acc: 65, tu: 25 }, aimed: { acc: 100, tu: 50 }, auto: { acc: 46, tu: 34, shots: 3 } }, sfx: 'laser',
    },
    heavy_laser: {
      kind: 'firearm', weight: 18, size: 4, twoHanded: true, storage: 0.3, sell: 61000, ammo: null, power: 85, dmg: 'LASER', research: 'heavy_laser',
      modes: { snap: { acc: 50, tu: 33 }, aimed: { acc: 84, tu: 75 } }, sfx: 'laser',
    },

    // armas alienígenas (recuperadas; uso e fabrico depois de investigadas)
    plasma_pistol: {
      kind: 'firearm', weight: 3, size: 2, storage: 0.1, sell: 84000, ammo: ['plasma_pistol_clip'], research: 'plasma_pistol',
      recoveryPoints: 3, armour: 45, modes: { snap: { acc: 65, tu: 30 }, aimed: { acc: 85, tu: 60 }, auto: { acc: 50, tu: 30, shots: 3 } }, sfx: 'plasma',
    },
    plasma_pistol_clip: { kind: 'ammo', power: 52, dmg: 'PLASMA', rounds: 26, weight: 3, size: 1, storage: 0.1, sell: 4440, research: 'plasma_pistol', recoveryPoints: 1 },
    plasma_rifle: {
      kind: 'firearm', weight: 5, size: 3, twoHanded: true, storage: 0.2, sell: 126500, ammo: ['plasma_rifle_clip'], research: 'plasma_rifle',
      recoveryPoints: 4, armour: 50, modes: { snap: { acc: 86, tu: 30 }, aimed: { acc: 100, tu: 60 }, auto: { acc: 55, tu: 36, shots: 3 } }, sfx: 'plasma',
    },
    plasma_rifle_clip: { kind: 'ammo', power: 80, dmg: 'PLASMA', rounds: 28, weight: 3, size: 1, storage: 0.1, sell: 6290, research: 'plasma_rifle', recoveryPoints: 1 },
    heavy_plasma: {
      kind: 'firearm', weight: 8, size: 4, twoHanded: true, storage: 0.2, sell: 171600, ammo: ['heavy_plasma_clip'], research: 'heavy_plasma',
      recoveryPoints: 5, armour: 50, modes: { snap: { acc: 75, tu: 30 }, aimed: { acc: 110, tu: 60 }, auto: { acc: 50, tu: 35, shots: 3 } }, sfx: 'plasma',
    },
    heavy_plasma_clip: { kind: 'ammo', power: 115, dmg: 'PLASMA', rounds: 35, weight: 3, size: 1, storage: 0.3, sell: 9590, research: 'heavy_plasma', recoveryPoints: 1 },
    small_launcher: {
      kind: 'firearm', weight: 10, size: 4, twoHanded: true, storage: 0.2, sell: 120000, ammo: ['stun_bomb'], research: 'small_launcher',
      recoveryPoints: 4, modes: { snap: { acc: 65, tu: 40 }, aimed: { acc: 110, tu: 75 } }, sfx: 'launcher',
    },
    stun_bomb: { kind: 'ammo', power: 90, dmg: 'STUN', radius: 4, rounds: 1, weight: 3, size: 1, storage: 0.1, sell: 15200, research: 'small_launcher', recoveryPoints: 1 },
    // bomba guiada: a trajetória é calculada (Path.flyRoute); precisão de lançamento fixa
    blaster_launcher: {
      kind: 'firearm', weight: 16, size: 4, twoHanded: true, storage: 0.3, sell: 144000, ammo: ['blaster_bomb'], research: 'blaster_launcher',
      recoveryPoints: 5, armour: 40, modes: { aimed: { acc: 120, tu: 66 } }, guided: { acc: 60, alienAcc: 55 }, sfx: 'launcher',
    },
    blaster_bomb: { kind: 'ammo', power: 200, dmg: 'HE', radius: 10, rounds: 1, weight: 3, size: 2, storage: 0.2, sell: 17028, research: 'blaster_launcher', recoveryPoints: 1 },

    // corpo a corpo: o bastão não usa a perícia de combate corpo a corpo (to-hit 100 × saúde)
    stun_rod: {
      kind: 'melee', weight: 6, size: 2, twoHanded: true, storage: 0.1, buy: 1260, sell: 945, power: 65, dmg: 'STUN',
      modes: melee(100, T.PCT_STUNROD), skill: false, sfx: 'stunrod',
    },

    // explosivos de arremesso (ativar 50 % UT, lançar 25 % UT; espoleta 0..fuseMax turnos, ours 0–5)
    grenade: { kind: 'grenade', weight: 3, size: 1, storage: 0.1, buy: 300, sell: 240, power: 50, dmg: 'HE', radius: 5, prime: true },
    // fumo por tile RNG(7,15)
    smoke_grenade: {
      kind: 'grenade', weight: 3, size: 1, storage: 0.1, buy: 150, sell: 120, power: 60, dmg: 'SMOKE', radius: 5, prime: true,
      smokeMin: T.SMOKE_GRENADE_MIN, smokeMax: T.SMOKE_GRENADE_MAX,
    },
    proximity_grenade: {
      kind: 'grenade', weight: 3, size: 1, storage: 0.1, buy: 500, sell: 400, power: 70, dmg: 'HE', radius: 5, prime: true, proximity: true, phase: 'P1',
    },
    high_explosive: { kind: 'grenade', weight: 6, size: 2, storage: 0.2, buy: 1500, sell: 1200, power: 110, dmg: 'HE', radius: 5, prime: true },
    alien_grenade: {
      kind: 'grenade', weight: 3, size: 1, storage: 0.1, sell: 14850, power: 90, dmg: 'HE', radius: 5, prime: true, research: 'alien_grenade', recoveryPoints: 1,
    },

    // equipamento
    electro_flare: { kind: 'flare', weight: 3, size: 1, storage: 0.1, buy: 60, sell: 40, armour: 8, light: T.LIGHT_FLARE },
    medikit: {
      // ours (DESIGN §3.15: o tópico só abre o fabrico): usa-se sem investigação, como os 3 kits do equipamento inicial
      kind: 'medikit', weight: 5, size: 2, storage: 0.1, sell: 46500,
      charges: { heal: T.MEDIKIT_CHARGES, stim: T.MEDIKIT_CHARGES, pain: T.MEDIKIT_CHARGES },
      healHP: T.MEDIKIT_HEAL_HP, healWounds: 1, stimEnergy: T.MEDIKIT_STIM_ENERGY, stimStun: T.MEDIKIT_STIM_STUN, useTU: T.TU_MEDIKIT,
    },
    motion_scanner: { kind: 'scanner', weight: 3, size: 1, storage: 0.1, sell: 45600, research: 'motion_scanner', usePct: T.PCT_SCANNER },
    // P2: sem tópico de investigação psiónica no MVP (não se compra nem fabrica)
    psi_amp: { kind: 'psiamp', weight: 10, size: 3, twoHanded: true, storage: 0.1, sell: 194700, useTU: T.TU_PSI, phase: 'P2' },

    // armas embutidas de unidades (não se apanham nem recuperam)
    cyberdisc_weapon: {
      kind: 'firearm', fixed: true, recover: false, weight: 0, size: 4, storage: 0, ammo: null, power: 130, dmg: 'PLASMA',
      modes: { snap: { acc: 75, tu: 30 }, aimed: { acc: 110, tu: 60 } }, sfx: 'plasma',
    },
    sectopod_weapon: {
      kind: 'firearm', fixed: true, recover: false, weight: 0, size: 4, storage: 0, ammo: null, power: 100, dmg: 'LASER',
      modes: { snap: { acc: 75, tu: 30 }, aimed: { acc: 110, tu: 60 }, auto: { acc: 50, tu: 35, shots: 3 } }, sfx: 'laser',
    },
    // poder = Força atual da unidade (strengthPower); 15 UT fixas
    reaper_weapon: {
      kind: 'melee', fixed: true, recover: false, weight: 0, size: 4, storage: 0, power: 90, strengthPower: true, dmg: 'MELEE',
      modes: melee(100, T.TU_ALIEN_MELEE, true), sfx: 'claw',
    },
    chryssalid_weapon: {
      kind: 'melee', fixed: true, recover: false, weight: 0, size: 4, storage: 0, power: 110, strengthPower: true, dmg: 'MELEE',
      modes: melee(100, T.TU_ALIEN_MELEE, true), zombify: 'zombie', sfx: 'claw',
    },
    zombie_weapon: {
      kind: 'melee', fixed: true, recover: false, weight: 0, size: 4, storage: 0, power: 84, strengthPower: true, dmg: 'MELEE',
      modes: melee(100, T.TU_ALIEN_MELEE, true), sfx: 'claw',
    },

    // materiais
    alien_alloys: { kind: 'material', battle: false, storage: 0.1, sell: 6500, recoveryPoints: 1, topic: 'alien_alloys' },
    elerium_115: { kind: 'material', battle: false, storage: 0.1, sell: 5000, recoveryPoints: 5, recoveryPer: 50, topic: 'elerium' },

    // componentes OVNI (fabricáveis depois de investigados)
    ufo_power_source: { kind: 'component', battle: false, storage: 0.7, sell: 250000, recoveryPoints: 20, research: 'power_source' },
    ufo_navigation: { kind: 'component', battle: false, storage: 0.2, sell: 80000, recoveryPoints: 5, research: 'ufo_navigation' },

    // artefactos do interior dos OVNIs (quantidades por tipo em OV.Data.ufos[id].artefacts)
    alien_food: { kind: 'artefact', battle: false, storage: 0.2, sell: 5000, recoveryPoints: 2, topic: 'alien_food' },
    alien_surgery: { kind: 'artefact', battle: false, storage: 0.2, sell: 38000, recoveryPoints: 2, topic: 'alien_surgery' },
    examination_room: { kind: 'artefact', battle: false, storage: 0.2, sell: 9000, recoveryPoints: 2, topic: 'examination_room' },
    alien_reproduction: { kind: 'artefact', battle: false, storage: 0.2, sell: 40000, recoveryPoints: 2, topic: 'alien_reproduction' },
    alien_entertainment: { kind: 'artefact', battle: false, storage: 0.2, sell: 20000, recoveryPoints: 2, topic: 'alien_entertainment' },

    // cadáveres (só nas mãos; os de unidades 2×2 não se carregam: carry:false)
    sectoid_corpse: { kind: 'corpse', species: 'sectoid', weight: 30, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 5, topic: 'autopsy_sectoid' },
    floater_corpse: { kind: 'corpse', species: 'floater', weight: 20, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 5, topic: 'autopsy_floater' },
    snakeman_corpse: { kind: 'corpse', species: 'snakeman', weight: 40, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 5, topic: 'autopsy_snakeman' },
    muton_corpse: { kind: 'corpse', species: 'muton', weight: 40, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 5, topic: 'autopsy_muton' },
    ethereal_corpse: { kind: 'corpse', species: 'ethereal', weight: 25, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 5, topic: 'autopsy_ethereal' },
    cyberdisc_corpse: {
      kind: 'corpse', species: 'cyberdisc', weight: 0, size: 4, carry: false, storage: 1, sell: 20000, armour: 26, recoveryPoints: 3, topic: 'autopsy_cyberdisc',
    },
    sectopod_corpse: {
      kind: 'corpse', species: 'sectopod', weight: 0, size: 4, carry: false, storage: 1, sell: 20000, armour: 26, recoveryPoints: 3, topic: 'autopsy_sectopod',
    },
    reaper_corpse: {
      kind: 'corpse', species: 'reaper', weight: 0, size: 4, carry: false, storage: 1, sell: 20000, armour: 26, recoveryPoints: 3, topic: 'autopsy_reaper',
    },
    chryssalid_corpse: { kind: 'corpse', species: 'chryssalid', weight: 40, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 3, topic: 'autopsy_chryssalid' },
    zombie_corpse: { kind: 'corpse', species: 'zombie', weight: 30, size: 4, storage: 0.4, sell: 20000, armour: 26, recoveryPoints: 3, topic: 'autopsy_zombie' },
    // corpos humanos: existem em batalha mas não vão para o armazém
    soldier_corpse: { kind: 'corpse', species: 'human', weight: 22, size: 4, storage: 0, sell: 0, armour: 20, recover: false },
    civilian_corpse: { kind: 'corpse', species: 'human', weight: 30, size: 4, storage: 0, sell: 0, armour: 12, recover: false },

    // armaduras guardadas no armazém (o fato de combate não ocupa espaço)
    personal_armour: { kind: 'armour', suit: 'personal_armour', battle: false, storage: 0.8, sell: 54000, research: 'personal_armour' },
    power_suit: { kind: 'armour', suit: 'power_suit', battle: false, storage: 0.8, sell: 85000, research: 'power_suit' },
    flying_suit: { kind: 'armour', suit: 'flying_suit', battle: false, storage: 0.8, sell: 115000, research: 'flying_suit' },
  });

  // ---- armaduras de soldado (orig; F/S/R/U; mods em %) -------------------------------------------------
  // colour = cor principal do fato em OV.UnitSprites (listas, retratos e boneco coincidem)
  D.armours = Object.assign(D.armours || {}, {
    coveralls: { front: 12, side: 8, rear: 5, under: 2, mods: { MELEE: 120, ACID: 160 }, storeItem: null, research: null, colour: 0x2f7f9b },
    personal_armour: {
      front: 50, side: 40, rear: 30, under: 30, mods: { IN: 80, STUN: 90, ACID: 110 }, storeItem: 'personal_armour', research: 'personal_armour', colour: 0x46583f,
    },
    power_suit: {
      front: 100, side: 80, rear: 70, under: 60, mods: { IN: 0, STUN: 80, SMOKE: 0 }, storeItem: 'power_suit', research: 'power_suit', colour: 0x4a5772,
    },
    // voo: 8 UT por nível (TUNE.TU_GRAVLIFT)
    flying_suit: {
      front: 110, side: 90, rear: 80, under: 70, mods: { IN: 0, STUN: 80, SMOKE: 0 }, flight: true, storeItem: 'flying_suit', research: 'flying_suit', colour: 0x5a76a2,
    },
  });

  // ---- inventário (ours, simplificado; §3.7): mãos 1 item, cinto 4 unidades (≤2), mochila 9 (≤3) -------
  // tu[destino] = UT para mover um item deste compartimento para o destino (tabela orig inventories.rul)
  D.invSlots = Object.assign(D.invSlots || {}, {
    R: { idx: 0, hand: true, maxItems: 1, capacity: null, maxSize: 4, tu: { L: 4, belt: 8, pack: 14, ground: 2 } },
    L: { idx: 1, hand: true, maxItems: 1, capacity: null, maxSize: 4, tu: { R: 4, belt: 8, pack: 14, ground: 2 } },
    belt: { idx: 2, hand: false, maxItems: null, capacity: 4, maxSize: 2, tu: { R: 4, L: 4, pack: 16, ground: 6 } },
    pack: { idx: 3, hand: false, maxItems: null, capacity: 9, maxSize: 3, tu: { R: 8, L: 8, belt: 12, ground: 10 } },
    ground: { idx: 4, hand: false, maxItems: null, capacity: null, maxSize: 4, tu: { R: 8, L: 8, belt: 12, pack: 20 } },
  });

  // ---- helpers puros ----------------------------------------------------------------------------------
  const THROW_MODE = () => ({ mode: 'throw', nameKey: 'mode.throw', acc: 100, tu: T.PCT_THROW, shots: 1, flat: false });

  // modos de ação de um item, por ordem de apresentação; tu = % das UT máximas, ou UT fixas se flat
  function computeModes(it) {
    const out = [];
    if (!it) return out;
    const m = it.modes || {};
    if (it.kind === 'firearm' || it.kind === 'melee') {
      for (const mode of ['snap', 'aimed', 'auto', 'melee']) {
        const s = m[mode];
        if (!s) continue;
        out.push({ mode, nameKey: 'mode.' + mode, acc: s.acc, tu: s.tu, shots: mode === 'auto' ? s.shots || T.AUTO_SHOTS : 1, flat: !!s.flat });
      }
    } else if (it.kind === 'grenade') {
      out.push({ mode: 'prime', nameKey: 'mode.prime', acc: 0, tu: T.PCT_PRIME, shots: 0, flat: false });
      out.push(THROW_MODE());
    } else if (it.kind === 'flare') {
      out.push(THROW_MODE());
    } else if (it.kind === 'medikit') {
      out.push({ mode: 'use', nameKey: 'mode.use', acc: 0, tu: it.useTU || T.TU_MEDIKIT, shots: 0, flat: true });
    } else if (it.kind === 'scanner') {
      out.push({ mode: 'use', nameKey: 'mode.use', acc: 0, tu: it.usePct || T.PCT_SCANNER, shots: 0, flat: false });
    } else if (it.kind === 'psiamp') {
      out.push({ mode: 'use', nameKey: 'mode.use', acc: 0, tu: it.useTU || T.TU_PSI, shots: 0, flat: true });
    }
    return out;
  }

  D.itemSize = function (id) {
    const it = D.items[id];
    return it ? it.size || 1 : 0;
  };
  D.isTwoHanded = function (id) {
    const it = D.items[id];
    return !!(it && it.twoHanded);
  };
  // → [{mode, nameKey, acc, tu, shots, flat}] (array partilhado depois do finalize: não alterar)
  D.weaponModes = function (id) {
    const it = D.items[id];
    if (!it) return [];
    return it.modeList || computeModes(it);
  };
  // alcance de arremesso em tiles (ours, §3.6): clamp(floor(Força × 4 / (peso + 3)), 3, 18)
  D.throwRange = function (strength, weight) {
    const s = Math.max(0, Math.floor(strength || 0));
    const w = Math.max(0, Math.floor(weight || 0));
    return U.clamp(U.idiv(s * T.THROW_STR_MUL, w + T.THROW_WEIGHT_ADD), T.THROW_MIN, T.THROW_MAX);
  };
  // UT para mover um item entre compartimentos (0 no mesmo; null se o movimento não existe)
  D.invMoveTU = function (from, to) {
    if (from === to) return 0;
    const s = D.invSlots[from];
    if (!s || !D.invSlots[to]) return null;
    const v = s.tu[to];
    return v === undefined ? null : v;
  };
  // cabe o item no compartimento, dado o conteúdo atual (ids de tipo)? O chão aceita tudo.
  D.fitsSlot = function (itemId, slotId, contentIds) {
    const it = D.items[itemId], s = D.invSlots[slotId];
    if (!it || !s || it.fixed || it.carry === false || it.battle === false) return false;
    const size = it.size || 1;
    if (size > s.maxSize) return false;
    const list = contentIds || [];
    if (s.maxItems !== null && list.length >= s.maxItems) return false;
    if (s.capacity !== null) {
      let used = 0;
      for (const c of list) used += D.itemSize(c);
      if (used + size > s.capacity) return false;
    }
    return true;
  };
  // [frente, esquerda, direita, traseira, baixo] com percentagem opcional (ex.: ×50 % em «Recruta»)
  D.armourArray = function (a, pct) {
    const p = pct === undefined ? 100 : pct;
    const f = (v) => U.idiv(v * p, 100);
    return [f(a.front), f(a.side), f(a.side), f(a.rear), f(a.under)];
  };
  D.soldierArmour = function (armourId) {
    const a = D.armours[armourId] || D.armours.coveralls;
    return D.armourArray(a, 100);
  };

  // ---- finalização ------------------------------------------------------------------------------------
  const setDef = (o, k, v) => {
    if (o[k] === undefined) o[k] = v;
  };
  const BATTLE_KINDS = ['firearm', 'ammo', 'melee', 'grenade', 'flare', 'medikit', 'scanner', 'psiamp', 'corpse'];
  const KINDS = BATTLE_KINDS.concat(['material', 'component', 'artefact', 'armour', 'craft_weapon', 'craft_ammo']);

  D.onFinalize('items.defaults', () => {
    for (const id in D.damageTypes) {
      const d = D.damageTypes[id];
      d.id = id;
      setDef(d, 'nameKey', 'dmg.' + id);
      setDef(d, 'phase', 'MVP');
      setDef(d, 'ignoresArmour', false);
      setDef(d, 'fire', false);
      setDef(d, 'smoke', false);
    }
    for (const id in D.items) {
      const it = D.items[id];
      it.id = id;
      setDef(it, 'nameKey', 'item.' + id);
      setDef(it, 'weight', 0);
      setDef(it, 'size', 1);
      setDef(it, 'twoHanded', false);
      setDef(it, 'storage', 0.1);
      setDef(it, 'buy', 0);
      setDef(it, 'sell', 0);
      setDef(it, 'deliveryH', T.DELIVERY_ITEMS_H);
      setDef(it, 'armour', 20);
      setDef(it, 'recoveryPoints', 0);
      setDef(it, 'recoveryPer', 1);
      setDef(it, 'recover', true);
      setDef(it, 'research', null);
      setDef(it, 'topic', it.research);
      setDef(it, 'phase', it.mvp === false ? 'P2' : 'MVP');
      setDef(it, 'mvp', it.phase === 'MVP');
      setDef(it, 'battle', BATTLE_KINDS.indexOf(it.kind) >= 0);
      setDef(it, 'fixed', false);
      setDef(it, 'carry', true);
      setDef(it, 'sprite', id);
      if (it.kind === 'firearm' && it.ammo === undefined) it.ammo = null;
      if (it.kind === 'grenade') setDef(it, 'fuseMax', T.GRENADE_FUSE_MAX);
    }
    for (const id in D.armours) {
      const a = D.armours[id];
      a.id = id;
      setDef(a, 'nameKey', 'armour.' + id);
      setDef(a, 'flight', false);
      setDef(a, 'weight', 0);
      setDef(a, 'storeItem', null);
      setDef(a, 'research', null);
      setDef(a, 'corpse', 'soldier_corpse');
      setDef(a, 'sprite', id);
    }
    for (const id in D.invSlots) {
      const s = D.invSlots[id];
      s.id = id;
      setDef(s, 'nameKey', 'inv.' + id);
    }
  }, 10);

  D.onFinalize('items.compile', () => {
    for (const id in D.items) {
      const it = D.items[id];
      if (it.kind === 'ammo') it.usedBy = [];
    }
    for (const id in D.items) {
      const it = D.items[id];
      it.modeList = computeModes(it);
      if (it.kind === 'firearm' && it.ammo) {
        for (const a of it.ammo) if (D.items[a] && D.items[a].usedBy) D.items[a].usedBy.push(id);
      }
    }
    for (const id in D.armours) D.armours[id].mods = D.damageMods(D.armours[id].mods);
  }, 50);

  D.onFinalize('items.validate', () => {
    const err = [];
    for (const id in D.items) {
      const it = D.items[id];
      if (KINDS.indexOf(it.kind) < 0) err.push('item ' + id + ': kind desconhecido ' + it.kind);
      if (it.battle && !(it.size >= 1 && it.size <= 4)) err.push('item ' + id + ': size fora de 1..4');
      if (it.dmg !== undefined && !D.damageTypes[it.dmg]) err.push('item ' + id + ': dano desconhecido ' + it.dmg);
      if (it.kind === 'firearm') {
        if (!it.modeList.length) err.push('item ' + id + ': arma sem modos');
        if (it.ammo) {
          for (const a of it.ammo) if (!D.items[a] || D.items[a].kind !== 'ammo') err.push('item ' + id + ': munição inválida ' + a);
        } else if (!(it.power > 0) || !it.dmg) err.push('item ' + id + ': arma sem munição precisa de power/dmg');
      } else if (it.ammo) {
        for (const a of it.ammo) if (!D.items[a]) err.push('item ' + id + ': munição inexistente ' + a);
      }
      if (it.kind === 'ammo' && !(it.rounds > 0)) err.push('item ' + id + ': rounds inválido');
      if ((it.kind === 'grenade' || it.kind === 'ammo') && it.dmg === 'HE' && !(it.radius > 0)) err.push('item ' + id + ': HE sem raio');
      if (it.kind === 'armour' && !D.armours[it.suit]) err.push('item ' + id + ': armadura inexistente ' + it.suit);
      if (it.zombify && D.units && !D.units[it.zombify]) err.push('item ' + id + ': zombify inexistente ' + it.zombify);
    }
    for (const id in D.armours) {
      const a = D.armours[id];
      if (a.storeItem && (!D.items[a.storeItem] || D.items[a.storeItem].kind !== 'armour')) err.push('armour ' + id + ': storeItem inválido');
      if (!D.items[a.corpse]) err.push('armour ' + id + ': cadáver inexistente');
    }
    for (const id in D.invSlots) {
      for (const to in D.invSlots) if (to !== id && D.invMoveTU(id, to) === null) err.push('invSlots: falta UT ' + id + '→' + to);
    }
    if (err.length) throw new Error(err.join('; '));
  }, 90);

  // regras imutáveis a partir daqui
  D.onFinalize('items.freeze', () => {
    for (const k of ['damageTypes', 'items', 'armours', 'invSlots', 'DMG_IDS']) U.deepFreeze(D[k]);
  }, 99);
})(globalThis.OV || (globalThis.OV = {}));
