/* Constantes de jogabilidade com nome (orig = UFO1/OpenXcom; ours = alteração deliberada, ver DESIGN.md §22) */
(function (OV) {
  'use strict';

  OV.TUNE = Object.assign(OV.TUNE || {}, {
    // ---- geometria de batalha
    VX: 16, // voxels por tile em x/y
    VZ: 24, // voxels por nível
    SHOT_EXTEND_TILES: 30, // ours (orig 1000): até onde um tiro desviado continua

    // ---- unidades de tempo (orig)
    TU_WALK: 4,
    TU_TURN: 1, // por 45°
    TU_KNEEL: 4,
    TU_STAND: 8,
    TU_GRAVLIFT: 8, // também voo vertical
    TU_STAIRS: 6, // ours: escadas como ligação vertical
    EN_STAIRS: 3,
    TU_DOOR: 4, // ours: valor fixo
    TU_RELOAD: 15,
    TU_UNLOAD: 8, // orig/OpenXcom (costUnload)
    TU_MEDIKIT: 10,
    TU_ALIEN_MELEE: 15,
    TU_PSI: 25,
    PCT_PRIME: 50,
    PCT_THROW: 25,
    PCT_SCANNER: 25,
    PCT_STUNROD: 30,
    DIAG_NUM: 3, DIAG_DEN: 2, // diagonal ×1.5
    RUN_TU_NUM: 3, RUN_TU_DEN: 4, // correr (P1)
    RUN_EN_NUM: 3, RUN_EN_DEN: 2,

    // ---- precisão (orig)
    KNEEL_ACC: 115,
    TWO_HAND_PENALTY: 80,
    AUTO_SHOTS: 3,
    BERSERK_ACC_DIV: 2,
    HIT_PREVIEW_SAMPLES: 100,

    // ---- dano (orig)
    DMG_RANGE: 100, // 0–200 %
    HE_DMG_RANGE: 50, // 50–150 %
    HE_FALLOFF: 10, // poder perdido por tile
    HE_RADIUS_DIV: 20,
    IN_RADIUS_DIV: 30,
    MAX_BLAST_RADIUS: 11,
    TERRAIN_HIT_MIN: 25, TERRAIN_HIT_MAX: 75, // % do poder contra a parte atingida
    WOUND_CHANCE_DIV: 10, // RNG(0,10) < p ⇒ ferida
    ARMOUR_WEAR_DIV: 10, // armadura −(p/10 + 1)

    // ---- medicina (orig)
    MEDIKIT_HEAL_HP: 3,
    MEDIKIT_STIM_ENERGY: 10,
    MEDIKIT_STIM_STUN: 4,
    MEDIKIT_CHARGES: 10,

    // ---- visão e luz (orig; algoritmo ours §8)
    VIEW_DIST: 20,
    NIGHT_VIEW: 9,
    DARK_SHADE: 9, // tile com shade > 9 é "escuro"
    SMOKE_SIGHT_BUDGET: 60, // custo ×3 por tile (3 + fumo) até 60 = 20 tiles
    SHADE_DAY: 0, SHADE_DUSK: 6, SHADE_NIGHT: 13,
    SHADE_ALIEN_BASE: 8, SHADE_MARS: 8, SHADE_XBASE: 5, // ours: base e Marte na penumbra (≤ DARK_SHADE: a X-COM vê)
    LIGHT_FIRE: 15, LIGHT_FLARE: 15, LIGHT_BURNING_UNIT: 15, LIGHT_LAMP: 12, LIGHT_UFO: 10,
    ROOF_DAY_DARKEN: 2,

    // ---- fumo e fogo (orig)
    SMOKE_GRENADE_MIN: 7, SMOKE_GRENADE_MAX: 15,
    SMOKE_FROM_DESTRUCTION: 5,
    FIRE_UNIT_MIN: 5, FIRE_UNIT_MAX: 10,
    FIRE_IGNITE_UNIT_PCT: 40,
    FIRE_SPREAD_BASE: 15,

    // ---- moral (orig)
    MORALE_START: 100,
    MORALE_AFTER_PANIC: 15,
    BERSERK_PCT: 33,
    BERSERK_MAX_SHOTS: 10,
    PANIC_FLEE_RADIUS: 5,
    BERSERK_RANDOM_RADIUS: 6,
    LEADER_MOD: [100, 100, 110, 115, 125, 150], // por patente: recruta, soldado, sargento, capitão, coronel, comandante
    RANK_WEIGHT: [100, 100, 120, 130, 150, 175],

    // ---- granadas (ours)
    GRENADE_FUSE_MAX: 5,
    INSTANT_GRENADES_DEFAULT: true,
    THROW_STR_MUL: 4, THROW_WEIGHT_ADD: 3, THROW_MIN: 3, THROW_MAX: 18,

    // ---- desova alienígena (ours): distâncias de Chebyshev aos inícios X-COM na preparação (ver BUnits.spawnAllowed)
    SPAWN_SAFE_DIST: 10,
    SPAWN_TERROR_DIST: 14, // unidades de terror (Crisálida, Ciberdisco, …)
    SPAWN_PREFER_DIST: 12, // mapgen: variantes de mapa com nós a esta distância são preferidas
    LARGE_SPAWN_MIN_REACH: 40, // 2×2 só em tiles ligados a ≥ 40 tiles alcançáveis

    // ---- detetor de movimento (orig)
    MOTION_PER_STEP: 30,

    // ---- IA (orig; cheat turn ours)
    CHEAT_TURN: [12, 10, 8], // por dificuldade 0/1/2
    AI_MAX_ACTIONS: 3,
    AI_PASSES: 2,
    AI_GRENADE_FROM_TURN: 3,
    AI_BURNING_PATH_COST: 32,

    // ---- soldados (orig; quotas ours)
    PROMO_SGT_DIV: 4, PROMO_CPT_DIV: 8, PROMO_COL_DIV: 15, PROMO_CMD_MIN: 20,
    SOLDIER_HIRE: 40000, SOLDIER_SALARY: 20000,
    SCIENTIST_HIRE: 30000, SCIENTIST_SALARY: 30000,
    ENGINEER_HIRE: 25000, ENGINEER_SALARY: 25000,
    WOUND_RECOVERY_MIN: 25, WOUND_RECOVERY_MAX: 75, // % do HP perdido em dias (ours)
    SQUAD_MAX_UI: 10,

    // ---- Geoscape (orig salvo indicação)
    GEO_TICK_S: 5,
    GEO_SPEEDS: [1, 12, 60, 360, 720, 17280], // ticks de 5 s por passo de 80 ms
    GEO_STEP_MS: 80,
    RADAR_CHECK_MIN: 30,
    CRAFT_RADAR_NM: 672,
    FUNDING_TOTAL: 6000000,
    DEBT_LIMIT: -1000000,
    COUNCIL_BONUS_FROM_MONTH: 2,
    COUNCIL_BONUS: 400,
    RATING_THRESHOLD: [-900, -700, -500], // por dificuldade 0/1/2
    TERROR_SITE_HOURS: [8, 16], // ours
    CRASH_SITE_HOURS: [24, 72], // ours
    DELIVERY_PERSONNEL_H: 48, // ours
    DELIVERY_ITEMS_H: 24,
    CRAFT_REPAIR_HP_H: 5, // ours
    MAX_DOGFIGHTS: 2, // ours
    RETALIATION_PCT: [4, 12, 20],
    GEO_MAX_STEPS_PER_FRAME: 3, // ciclo do Geoscape na UI (contrato §6.3)
    GEO_CHUNK_TICKS: 720,
    GEO_FRAME_BUDGET_MS: 12,
    AUTOSAVE_DAYS: [1, 10, 20], // dias do mês com gravação automática
    LOW_FUEL_MARGIN_10M: 1, // margem (passos de 10 min) no regresso por falta de combustível
    BASE_DEFENCE_BASE: 1800, // defesa automática da base: guarnição necessária
    BASE_DEFENCE_PER_COEF: 300,
    GEO_IDLE_COALESCE: true, // ours: sem nada no ar, o relógio salta até à fronteira seguinte (hash idêntico)
    UFO_BASE_SIGHT_NM: 268, // OVNI de retaliação vê a base X-COM (orig)
    ALIEN_BASE_SUPPLY_PCT: 6, // abastecimento diário de cada base alienígena (orig)
    RETALIATION_FIRST_MIN: 3000, // primeiro OVNI de uma retaliação provocada por abate (orig, 50 h)
    RETALIATION_UFO_REGION_PCT: 50, // …na região do OVNI abatido com 50 − 6·coef %, senão na região da base (orig)
    RETALIATION_UFO_REGION_PER_COEF: 6,
    TERROR_CITIES_MEMORY: 12, // cidades atacadas há pouco que o terror evita

    // ---- campanha (ours)
    MAX_SAVE_SLOTS: 3,
  });
})(globalThis.OV || (globalThis.OV = {}));
