/* Instalações da base, base inicial e ajudas puras de grelha/manutenção (DESIGN.md §3.14).
   OV.Data.facilities, OV.Data.startingBase, OV.Data.BASE_GRID,
   OV.Data.facilityCells(type, x, y), OV.Data.gridConnected(list), OV.Data.monthlyUpkeep(spec) */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  const GRID = 6;

  // cost/upkeep orig; days = ours (orig × 0,4, mínimo 1); research = investigação que desbloqueia a construção
  // capacidades: personnel, labs, workshops, storage, aliens, crafts; radar: radarRange (mn) + radarChance (%)
  // defesa: defence (poder; dano por tiro poder/2 + RNG(0, poder)) + hitRatio (%)
  const FAC = {
    access_lift: { size: 1, cost: 300000, daysOrig: 1, days: 1, upkeep: 4000, lift: true },
    living_quarters: { size: 1, cost: 400000, daysOrig: 16, days: 6, upkeep: 10000, personnel: 50 },
    laboratory: { size: 1, cost: 750000, daysOrig: 26, days: 10, upkeep: 30000, labs: 50 },
    workshop: { size: 1, cost: 800000, daysOrig: 32, days: 13, upkeep: 35000, workshops: 50 },
    general_stores: { size: 1, cost: 150000, daysOrig: 10, days: 4, upkeep: 5000, storage: 50 },
    alien_containment: { size: 1, cost: 400000, daysOrig: 18, days: 7, upkeep: 15000, aliens: 10 },
    hangar: { size: 2, cost: 200000, daysOrig: 25, days: 10, upkeep: 25000, crafts: 1 },
    small_radar: { size: 1, cost: 500000, daysOrig: 12, days: 5, upkeep: 10000, radarRange: 1695, radarChance: 15 },
    large_radar: { size: 1, cost: 800000, daysOrig: 25, days: 10, upkeep: 15000, radarRange: 2577, radarChance: 30 },
    missile_defence: { size: 1, cost: 200000, daysOrig: 16, days: 6, upkeep: 5000, defence: 500, hitRatio: 50 },
    laser_defence: { size: 1, cost: 400000, daysOrig: 24, days: 10, upkeep: 10000, defence: 600, hitRatio: 60, research: 'laser_defense' },
    plasma_defence: { size: 1, cost: 600000, daysOrig: 34, days: 14, upkeep: 12000, defence: 900, hitRatio: 70, research: 'plasma_defense' },
    hyper_wave_decoder: {
      size: 1, cost: 1400000, daysOrig: 26, days: 10, upkeep: 30000, radarRange: 2759, radarChance: 100, hyper: true,
      research: 'hyper_wave',
    },
  };
  const CAPS = ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts', 'radarRange', 'radarChance', 'defence', 'hitRatio'];
  for (const id in FAC) {
    const f = FAC[id];
    f.id = id;
    f.nameKey = 'facility.' + id;
    f.sprite = id;
    f.lift = !!f.lift;
    f.hyper = !!f.hyper;
    if (f.research === undefined) f.research = null;
    for (const k of CAPS) if (f[k] === undefined) f[k] = 0;
  }

  // base inicial (orig startingBase.rul; ours: +3 kits médicos e +6 sinalizadores no armazém)
  OV.Data.startingBase = {
    nameKey: 'base.defaultName',
    facilities: [
      { type: 'access_lift', x: 2, y: 2 },
      { type: 'hangar', x: 2, y: 0 },
      { type: 'hangar', x: 0, y: 4 },
      { type: 'hangar', x: 4, y: 4 },
      { type: 'living_quarters', x: 3, y: 2 },
      { type: 'general_stores', x: 2, y: 3 },
      { type: 'laboratory', x: 3, y: 3 },
      { type: 'workshop', x: 4, y: 3 },
      { type: 'small_radar', x: 1, y: 3 },
    ],
    soldiers: 8,
    // ours: Recruta e Veterano começam com a Skyranger cheia (10); Super-humano fica com os 8 orig
    soldiersByDifficulty: [10, 10, 8],
    scientists: 10,
    engineers: 10,
    soldierArmour: 'coveralls',
    crafts: [
      {
        type: 'skyranger', weapons: [],
        cargo: { grenade: 8, hc_ap: 2, hc_he: 2, heavy_cannon: 1, pistol: 3, pistol_clip: 5, rifle: 6, rifle_clip: 12 },
      },
      { type: 'interceptor', weapons: [{ type: 'stingray', ammo: 6 }, { type: 'cannon', ammo: 200 }], cargo: {} },
      { type: 'interceptor', weapons: [{ type: 'stingray', ammo: 6 }, { type: 'cannon', ammo: 200 }], cargo: {} },
    ],
    stores: {
      ac_ap: 6, auto_cannon: 1, avalanche: 1, avalanche_missile: 10, cannon: 2, cannon_rounds: 1, grenade: 5,
      hc_ap: 6, heavy_cannon: 1, pistol: 2, pistol_clip: 8, rifle: 2, rifle_clip: 8, rocket_launcher: 1,
      small_rocket: 4, smoke_grenade: 5, stingray: 1, stingray_missile: 25,
      medikit: 3, electro_flare: 6,
    },
  };

  // células ocupadas por uma instalação com canto superior esquerdo (x, y)
  OV.Data.facilityCells = function (type, x, y) {
    const f = FAC[type];
    const n = f ? f.size : 1;
    const out = [];
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([x + dx, y + dy]);
    return out;
  };

  // verifica uma lista [{type,x,y}] na grelha 6×6: dentro dos limites, sem sobreposições, um só elevador
  // e todas as instalações ligadas ortogonalmente ao elevador → {ok, reason, unreachable:[índices]}
  OV.Data.gridConnected = function (list) {
    const owner = new Int16Array(GRID * GRID).fill(-1);
    let lift = -1;
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      if (!FAC[f.type]) return { ok: false, reason: 'unknownType', unreachable: [k] };
      if (FAC[f.type].lift) {
        if (lift >= 0) return { ok: false, reason: 'twoLifts', unreachable: [k] };
        lift = k;
      }
      for (const [cx, cy] of OV.Data.facilityCells(f.type, f.x, f.y)) {
        if (cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) return { ok: false, reason: 'outOfGrid', unreachable: [k] };
        if (owner[cy * GRID + cx] >= 0) return { ok: false, reason: 'overlap', unreachable: [k] };
        owner[cy * GRID + cx] = k;
      }
    }
    if (lift < 0) return { ok: false, reason: 'noLift', unreachable: list.map((_, k) => k) };
    const seen = new Uint8Array(list.length);
    const queue = [lift];
    seen[lift] = 1;
    while (queue.length) {
      const k = queue.shift();
      const f = list[k];
      for (const [cx, cy] of OV.Data.facilityCells(f.type, f.x, f.y)) {
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
          const o = owner[ny * GRID + nx];
          if (o >= 0 && !seen[o]) {
            seen[o] = 1;
            queue.push(o);
          }
        }
      }
    }
    const unreachable = [];
    for (let k = 0; k < list.length; k++) if (!seen[k]) unreachable.push(k);
    return { ok: unreachable.length === 0, reason: unreachable.length ? 'notConnected' : null, unreachable };
  };

  // manutenção mensal: spec = {facilities:[type|{type}], soldiers, scientists, engineers, crafts:[type|{type}]}
  // instalações + salários + aluguer das naves compradas (as fabricadas têm rent 0)
  OV.Data.monthlyUpkeep = function (spec) {
    const T = OV.TUNE || {};
    let fac = 0, crafts = 0;
    for (const f of spec.facilities || []) {
      const d = FAC[typeof f === 'string' ? f : f.type];
      if (d) fac += d.upkeep;
    }
    for (const c of spec.crafts || []) {
      const d = OV.Data.crafts && OV.Data.crafts[typeof c === 'string' ? c : c.type];
      if (d) crafts += d.rent;
    }
    const salaries = (spec.soldiers || 0) * (T.SOLDIER_SALARY || 20000) +
      (spec.scientists || 0) * (T.SCIENTIST_SALARY || 30000) +
      (spec.engineers || 0) * (T.ENGINEER_SALARY || 25000);
    return { facilities: fac, salaries, crafts, total: fac + salaries + crafts };
  };

  OV.Data.BASE_GRID = GRID;
  OV.Data.facilities = FAC;
})(globalThis.OV || (globalThis.OV = {}));
