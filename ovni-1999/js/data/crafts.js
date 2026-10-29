/* Naves X-COM, armamento de naves e constantes do dogfight (DESIGN.md §3.13; Lightning cortado).
   OV.Data.crafts, OV.Data.craftWeapons, OV.Data.craftRules, OV.Data.dogfight,
   OV.Data.dogfightHitChance(acc, sizeIdx), OV.Data.craftFuelPer10Min(type, speed),
   OV.Data.craftServiceStatus(craft, from?) → serviço no hangar (reparar → rearmar → reabastecer → pronta).
   As armas e munições de naves também entram em OV.Data.items (kind 'craft_weapon' / 'craft_ammo'). */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  const TUNE = OV.TUNE || {};

  // burn: 'speed' ⇒ floor(velocidade atual/100) por 10 min (querosene); número ⇒ unidades fixas por 10 min (Elerium)
  // refuel: combustível por 30 min; refuelItem: item gasto (1 por cada refuel de combustível)
  // seats = orig; seatsUI = limite da equipa no MVP; block = bloco de batalha (só transportes)
  const CRAFTS = {
    skyranger: {
      speed: 760, accel: 2, fuel: 1500, burn: 'speed', hp: 150, weapons: 0, seats: 14, seatsUI: TUNE.SQUAD_MAX_UI || 10,
      buy: 500000, rent: 500000, score: 200, block: 'CRAFT_SKYRANGER', refuel: 50, refuelItem: null,
      deliveryH: 72, transport: true, spacecraft: false, requires: null,
    },
    interceptor: {
      speed: 2100, accel: 3, fuel: 1000, burn: 'speed', hp: 100, weapons: 2, seats: 0, seatsUI: 0,
      buy: 600000, rent: 600000, score: 250, block: null, refuel: 50, refuelItem: null,
      deliveryH: 96, transport: false, spacecraft: false, requires: null,
    },
    firestorm: {
      speed: 4200, accel: 9, fuel: 20, burn: 1, hp: 500, weapons: 2, seats: 0, seatsUI: 0,
      buy: 0, rent: 0, score: 250, block: null, refuel: 5, refuelItem: 'elerium_115',
      deliveryH: 0, transport: false, spacecraft: false, requires: 'new_fighter',
    },
    avenger: {
      speed: 5400, accel: 10, fuel: 60, burn: 1, hp: 1200, weapons: 2, seats: 26, seatsUI: 12,
      buy: 0, rent: 0, score: 400, block: 'CRAFT_AVENGER', refuel: 5, refuelItem: 'elerium_115',
      deliveryH: 0, transport: true, spacecraft: true, requires: 'ultimate_craft',
    },
  };
  for (const id in CRAFTS) {
    const c = CRAFTS[id];
    c.id = id;
    c.nameKey = 'craft.' + id;
    c.radarRange = TUNE.CRAFT_RADAR_NM || 672;
    c.sprite = id;
  }

  // reload em ticks do dogfight por modo; range × 8 = distância; ammoMax null = ilimitada (feixes)
  // ammoItem/ammoPerItem: munição de armazém usada no rearme; rearmPerHour em munições
  const WEAPONS = {
    stingray: {
      dmg: 70, range: 30, acc: 70, ammoMax: 6, reload: { cautious: 64, standard: 48, aggressive: 32 },
      ammoItem: 'stingray_missile', ammoPerItem: 1, rearmPerHour: 1, projectile: 'missile', beam: false, mvp: true,
    },
    avalanche: {
      dmg: 100, range: 60, acc: 80, ammoMax: 3, reload: { cautious: 96, standard: 72, aggressive: 48 },
      ammoItem: 'avalanche_missile', ammoPerItem: 1, rearmPerHour: 1, projectile: 'missile', beam: false, mvp: true,
    },
    cannon: {
      dmg: 10, range: 10, acc: 25, ammoMax: 200, reload: { cautious: 4, standard: 4, aggressive: 4 },
      ammoItem: 'cannon_rounds', ammoPerItem: 50, rearmPerHour: 100, projectile: 'cannon', beam: false, mvp: true,
    },
    laser_cannon: {
      dmg: 70, range: 21, acc: 35, ammoMax: null, reload: { cautious: 24, standard: 24, aggressive: 24 },
      ammoItem: null, ammoPerItem: 0, rearmPerHour: 0, projectile: 'laser', beam: true, mvp: true,
    },
    plasma_beam: {
      dmg: 140, range: 52, acc: 50, ammoMax: null, reload: { cautious: 24, standard: 24, aggressive: 24 },
      ammoItem: null, ammoPerItem: 0, rearmPerHour: 0, projectile: 'plasma', beam: true, mvp: true,
    },
    fusion_ball: {
      dmg: 230, range: 65, acc: 100, ammoMax: 2, reload: { cautious: 64, standard: 48, aggressive: 32 },
      ammoItem: 'fusion_ball_missile', ammoPerItem: 1, rearmPerHour: 1, projectile: 'fusion', beam: false, mvp: false,
    },
  };
  for (const id in WEAPONS) {
    const w = WEAPONS[id];
    w.id = id;
    w.nameKey = 'cw.' + id;
    w.item = id; // o lançador em armazém tem o mesmo id
  }

  // itens de armazém (orig: preço, venda, espaço de armazém; entrega 48 h); buy 0 = não se compra
  const STORE = {
    stingray: { kind: 'craft_weapon', buy: 16000, sell: 12000, storage: 0.8, research: null },
    avalanche: { kind: 'craft_weapon', buy: 17000, sell: 12750, storage: 1, research: null },
    cannon: { kind: 'craft_weapon', buy: 30000, sell: 22500, storage: 1.5, research: null },
    laser_cannon: { kind: 'craft_weapon', buy: 0, sell: 211000, storage: 2, research: 'laser_cannon' },
    plasma_beam: { kind: 'craft_weapon', buy: 0, sell: 267300, storage: 1.2, research: 'plasma_cannon' },
    fusion_ball: { kind: 'craft_weapon', buy: 0, sell: 281000, storage: 2, research: null },
    stingray_missile: { kind: 'craft_ammo', craftWeapon: 'stingray', rounds: 1, buy: 3000, sell: 2400, storage: 0.4, research: null },
    avalanche_missile: { kind: 'craft_ammo', craftWeapon: 'avalanche', rounds: 1, buy: 9000, sell: 7200, storage: 1.5, research: null },
    cannon_rounds: { kind: 'craft_ammo', craftWeapon: 'cannon', rounds: 50, buy: 1240, sell: 1012, storage: 0.1, research: null },
    fusion_ball_missile: { kind: 'craft_ammo', craftWeapon: 'fusion_ball', rounds: 1, buy: 0, sell: 53300, storage: 0.6, research: null },
  };
  const storeItems = {};
  for (const id in STORE) {
    const s = STORE[id];
    storeItems[id] = Object.assign({
      id, nameKey: 'cw.' + id, craftWeapon: s.kind === 'craft_weapon' ? id : s.craftWeapon,
      weight: 0, size: 0, deliveryH: 48, sprite: 'cw_' + id, mvp: WEAPONS[id] ? WEAPONS[id].mvp : WEAPONS[s.craftWeapon].mvp,
    }, s);
  }
  Object.assign(OV.Data.items = OV.Data.items || {}, storeItems);

  // regras gerais de naves (orig salvo indicação)
  OV.Data.craftRules = {
    patrolSpeedPct: 50,
    burnEveryMin: 10,
    refuelEveryMin: 30,
    takeOffMin: 0, // ours: descolagem imediata (orig 5 min)
    repairHpPerHour: TUNE.CRAFT_REPAIR_HP_H || 5, // ours (orig 1)
    radarRange: TUNE.CRAFT_RADAR_NM || 672,
    lowFuelReturn: true, // regressa quando o combustível só chega para voltar à base
    engageRequiresSpeed: true, // só interceta se a velocidade atual do OVNI ≤ velocidade máxima da nave
  };

  // dogfight (§3.13, orig): distâncias em unidades abstratas, tempos em ticks de 30 ms
  OV.Data.dogfight = {
    tickMs: 30,
    open: 640, // distância inicial
    standoff: 560, // «Distância»: sem disparos
    aggressive: 64,
    disengage: 800, // alvo ao desengatar; termina quando passa de endDist
    endDist: 640,
    approach: 4, // ours: −4 por tick ao aproximar (orig 2); duelos mais curtos e o 1.º abate viável em Veterano
    retreat: 4, // +4 por tick ao recuar
    projectile: 8, // velocidade dos projéteis por tick
    rangeMul: 8, // alcance da arma × 8
    cautiousRetreatDmgPct: 50, // «Cauteloso» recua para «Distância» com dano ≥ 50 %
    craftDmgMinNum: 1, craftDmgMinDen: 2, // dano da nave RNG(dmg/2, dmg)
    ufoHitPct: 60, // tiro do OVNI: 60 %, dano RNG(0, power), primeiro tiro imediato
    ufoReloadCoefMul: 2, // R = max(1, reload − 2·coef); contagem RNG(0,R)+R
    escapeCoefMul: 30, // fuga: breakOff + RNG(0,breakOff) − 30·coef
    maxSimultaneous: TUNE.MAX_DOGFIGHTS || 2, // ours (orig 4)
    retaliationPct: TUNE.RETALIATION_PCT || [4, 12, 20],
    // modos: dist numérica fixa, 'longest'/'shortest' = alcance da arma carregada × 8
    modes: {
      standoff: { dist: 560, fire: false, reload: null },
      cautious: { dist: 'longest', fire: true, reload: 'cautious' },
      standard: { dist: 'shortest', fire: true, reload: 'standard' },
      aggressive: { dist: 64, fire: true, reload: 'aggressive' },
      disengage: { dist: 800, fire: false, reload: null },
    },
    modeOrder: ['standoff', 'cautious', 'standard', 'aggressive', 'disengage'],
  };

  // probabilidade de acerto (inteiro %) de uma arma de nave contra um OVNI de tamanho 0..4 (fórmula orig, divisões inteiras)
  OV.Data.dogfightHitChance = function (acc, sizeIdx) {
    const s = Math.max(0, Math.min(4, sizeIdx | 0));
    const p = Math.trunc((acc * (100 + Math.trunc(300 / (5 - s))) + 100) / 200);
    return Math.max(0, Math.min(100, p));
  };

  /* Serviço de que uma nave no hangar precisa, a partir da etapa `from` (0 reparar, 1 rearmar, 2 reabastecer) →
     'repair'|'rearm'|'refuel'|'ready' (orig Craft::checkup). Definição única: OV.BaseSim e OV.World usam-na. */
  OV.Data.craftServiceStatus = function (craft, from) {
    const f = from | 0;
    const def = OV.Data.crafts[craft.type];
    if (!def) return 'ready';
    if (f <= 0 && craft.hp < def.hp) return 'repair';
    if (f <= 1) {
      for (const w of craft.weapons || []) {
        if (!w || w.ammo === null || w.ammo === undefined) continue;
        const wd = OV.Data.craftWeapons[w.type];
        if (wd && wd.ammoMax !== null && w.ammo < wd.ammoMax) return 'rearm';
      }
    }
    if (f <= 2 && craft.fuel < def.fuel) return 'refuel';
    return 'ready';
  };

  // combustível gasto por cada 10 min de voo à velocidade dada (kn)
  OV.Data.craftFuelPer10Min = function (typeId, speed) {
    const c = OV.Data.crafts[typeId];
    if (!c) return 0;
    if (c.burn === 'speed') return Math.floor(Math.max(0, speed) / 100);
    return c.burn;
  };

  OV.Data.crafts = CRAFTS;
  OV.Data.craftWeapons = WEAPONS;
})(globalThis.OV || (globalThis.OV = {}));
