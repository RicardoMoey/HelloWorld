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
    TU_ALIEN_MELEE: 22, // ours (orig 15 fixo): Crisálidas/Ceifadores atacam menos vezes por turno (terror vencível)
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
    MUZZLE_FLASH_LIGHT: 6, // ours: o tile de quem dispara no escuro fica iluminado até ao próximo turno do seu lado (6 = só o tile)
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
    // ours (persona r4, DESIGN §22): % das perdas de moral do lado X-COM (feridas, mortes de aliados) por dificuldade
    // 0/1/2 — em Recruta 2–3 baixas já não arrastam a equipa inteira para o pânico em cadeia
    MORALE_LOSS_PCT: [50, 100, 100],
    // ours: turnos X-COM seguintes a um episódio de pânico/berserk em que o mesmo soldado não volta a entrar em pânico
    PANIC_COOLDOWN_TURNS: [1, 0, 0],
    // ours (persona r5, DESIGN §22): % do dano que as armas alienígenas fazem às unidades X-COM, por dificuldade 0/1/2 —
    // em Recruta um tiro de pistola de plasma (52 → 26, máx. 52 − 12 de armadura) raramente mata um recruta de fato
    // (28–40 de Saúde): ≈ 11 % em vez de 55 %; principiante (--novice) no Batedor Grande 2,3 → 1,6 baixas (16 sementes)
    ALIEN_DAMAGE_PCT: [50, 100, 100],

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
    AI_GRENADE_FUSE: [1, 0, 0], // ours: espoleta das granadas alienígenas por dificuldade (Recruta: rebenta no fim do turno X-COM)
    AI_BURNING_PATH_COST: 32,

    // ---- soldados e pessoal (orig; quotas ours)
    PROMO_SGT_DIV: 4, PROMO_CPT_DIV: 8, PROMO_COL_DIV: 15, PROMO_CMD_MIN: 20,
    SOLDIER_HIRE: 40000, SOLDIER_SALARY: 20000,
    // ours (ritmo, DESIGN §22): contratar cientistas/engenheiros custa um salário (orig 60 000 / 50 000 $ = 2 salários);
    // com os custos orig o bot de Veterano ganhou 7/24 campanhas contra 12/24 e perdeu 2 no Conselho (CAMPAIGN_API §11.10)
    SCIENTIST_HIRE: 30000, SCIENTIST_SALARY: 30000,
    ENGINEER_HIRE: 25000, ENGINEER_SALARY: 25000,
    MANUFACTURE_PROFIT_CAP_H: 100, // $ por hora-engenheiro: teto do lucro de fabricar para vender (data/research.js)
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
    NIGHT_LANDING_MONTHS: 2, // ours: nos meses 0–1, um OVNI que aterra de noite fica no chão até ao dia (+ margem)…
    NIGHT_LANDING_DAY_MARGIN_S: 3600, NIGHT_LANDING_MAX_S: 57600, // …1 h depois de amanhecer, no máximo 16 h no chão
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
    // defesa automática da base (ours, persona r4; contrato §5.9 / §11.11): exigência = CREW_PCT % da força esperada da
    // tripulação do OVNI (Σ UT+Pontaria+Saúde+armadura frontal por raça, dificuldade e mês) × casco que resta, contra a
    // força da guarnição (Σ UT+Pontaria+Saúde+armadura frontal dos soldados em casa)…
    BASE_DEFENCE_CREW_PCT: 50,
    BASE_DEFENCE_TIER_PCT: 20, // …+20 % por nível médio de armamento alienígena do mês (mês 3: +18 %, mês 4+: +34 %, Etéreos +40 %)
    RETALIATION_WARNING_MIN: 1440, // ours: base encontrada (baseSpotted) ⇒ pelo menos 24 h até o Couraçado do ataque partir
    BASE_DEFENCE_FACILITY_PCT: 25, // …+25 % do poder de cada defesa concluída (que já atirou ao casco na salva)…
    BASE_DEFENCE_FACILITY_CAP_PCT: 66, // …mas no máximo 66 % da força dos soldados (≥ 60 % da força vem deles)
    BASE_DEFENCE_CASUALTY_PCT: 40, // baixas da vitória = round(guarnição × exigência / força × 40 %), 1..guarnição
    // ours (persona r5, contrato §11.12): a arma conta — força += (poder da arma − 30) × 50 % (espingarda 0, laser +15,
    // plasma pesado +42, desarmado −15; poder até 120); os desarmados pegam nas melhores armas do armazém
    BASE_DEFENCE_WEAPON_PCT: 50, BASE_DEFENCE_GUN_BASE: 30, BASE_DEFENCE_GUN_CAP: 120,
    // …e o resultado é sorteado pelo rácio r = 100 × força / exigência: perdida (MID − r)/(MID − LO), repelida
    // (r − LO)/(HI − LO), senão aguentada a custo (≥ 60 % da guarnição morre, alguém fica; 2 instalações destruídas)
    BASE_DEFENCE_RATIO_LO: 50, BASE_DEFENCE_RATIO_MID: 100, BASE_DEFENCE_RATIO_HI: 150,
    BASE_DEFENCE_HOLD_CASUALTY_PCT: 60, BASE_DEFENCE_HOLD_FACILITIES: 2,
    MISSION_ARRIVE_NM: 5, // nave em patrulha a ≤ 5 mn de um local conta como chegada (startMission)
    // ours (persona r5): o posto de comando de uma base alienígena tomada pela força (todos os alienígenas da batalha
    // neutralizados) rende-se e vai vivo para a contenção — pessoal à parte da tripulação da batalha (contrato §11.12)
    ALIEN_BASE_SURRENDER: ['commander', 'leader'],
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
