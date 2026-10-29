/* OVNIs (DESIGN.md §3.12): estatísticas orig; mapas, recuperação e artefactos ours.
   OV.Data.ufos[id], OV.Data.ufoRules, OV.Data.ufoRecovery(ufoId, opts) */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};

  // índice de tamanho (dogfight/sprites) e modificador de visibilidade no radar (orig Ufo::getVisibility)
  const VIS = [-30, -15, 0, 15, 30];

  // power/range/reload = arma do OVNI no dogfight (range × 8 = distância); score = queda, scoreDestroyed = abate total
  // decks/navigation acompanham os modelos de interior do §7.5; artefacts = dispositivos 'u' por tipo (ours)
  const UFOS = {
    small_scout: {
      size: 0, hp: 50, speed: 2200, weapon: { power: 0, range: 0, reload: 56 }, breakOff: 360, // ours (orig 200): o canhão sozinho chega a alcance antes da fuga
      score: 50, scoreDestroyed: 100, block: 'UFO_SMALL_SCOUT', blockSize: { w: 10, h: 10 }, decks: 1,
      map: { w: 30, h: 30, d: 3 }, powerSources: 1, navigation: 1, alloys: 3, artefacts: {},
      deployment: 'dep_small_scout',
    },
    medium_scout: {
      size: 1, hp: 200, speed: 2400, weapon: { power: 20, range: 15, reload: 56 }, breakOff: 250,
      score: 75, scoreDestroyed: 150, block: 'UFO_MEDIUM_SCOUT', blockSize: { w: 10, h: 10 }, decks: 1,
      map: { w: 30, h: 30, d: 3 }, powerSources: 1, navigation: 1, alloys: 6, artefacts: {},
      deployment: 'dep_medium_scout',
    },
    large_scout: {
      size: 1, hp: 250, speed: 2700, weapon: { power: 20, range: 34, reload: 48 }, breakOff: 300,
      score: 125, scoreDestroyed: 250, block: 'UFO_LARGE_SCOUT', blockSize: { w: 20, h: 20 }, decks: 1,
      map: { w: 40, h: 40, d: 3 }, powerSources: 1, navigation: 2, alloys: 10, artefacts: {},
      deployment: 'dep_large_scout',
    },
    harvester: {
      size: 2, hp: 500, speed: 4000, weapon: { power: 40, range: 22, reload: 48 }, breakOff: 500,
      score: 250, scoreDestroyed: 500, block: 'UFO_HARVESTER', blockSize: { w: 20, h: 20 }, decks: 2,
      map: { w: 40, h: 40, d: 3 }, powerSources: 2, navigation: 2, alloys: 16, artefacts: { alien_food: 4 },
      deployment: 'dep_harvester',
    },
    abductor: {
      size: 2, hp: 500, speed: 4300, weapon: { power: 40, range: 20, reload: 32 }, breakOff: 500,
      score: 250, scoreDestroyed: 500, block: 'UFO_ABDUCTOR', blockSize: { w: 20, h: 20 }, decks: 2,
      map: { w: 40, h: 40, d: 3 }, powerSources: 2, navigation: 2, alloys: 16,
      artefacts: { examination_room: 2, alien_surgery: 2 },
      deployment: 'dep_abductor',
    },
    supply_ship: {
      size: 3, hp: 2200, speed: 3200, weapon: { power: 60, range: 36, reload: 24 }, breakOff: 3000,
      score: 400, scoreDestroyed: 800, block: 'UFO_SUPPLY_SHIP', blockSize: { w: 30, h: 20 }, decks: 2,
      map: { w: 40, h: 40, d: 3 }, powerSources: 4, navigation: 2, alloys: 24,
      artefacts: { alien_food: 4, alien_reproduction: 2 },
      deployment: 'dep_supply_ship',
    },
    terror_ship: {
      size: 3, hp: 1200, speed: 4800, weapon: { power: 120, range: 42, reload: 24 }, breakOff: 2000,
      score: 500, scoreDestroyed: 1000, block: 'UFO_TERROR_SHIP', blockSize: { w: 30, h: 20 }, decks: 2,
      map: { w: 40, h: 40, d: 3 }, powerSources: 4, navigation: 2, alloys: 24,
      artefacts: { alien_entertainment: 2, alien_reproduction: 2 },
      deployment: 'dep_terror_ship',
    },
    battleship: {
      size: 4, hp: 3000, speed: 5000, weapon: { power: 140, range: 65, reload: 24 }, breakOff: 4000,
      score: 700, scoreDestroyed: 1400, block: 'UFO_BATTLESHIP', blockSize: { w: 30, h: 30 }, decks: 2,
      map: { w: 50, h: 50, d: 3 }, powerSources: 4, navigation: 2, alloys: 36,
      artefacts: { alien_entertainment: 2, alien_reproduction: 2, alien_food: 2 },
      deployment: 'dep_battleship',
    },
  };

  for (const id in UFOS) {
    const u = UFOS[id];
    u.id = id;
    u.nameKey = 'ufo.' + id;
    u.sizeKey = 'ufo.size.' + u.size;
    u.visibility = VIS[u.size];
    u.sprite = id;
  }

  // regras comuns de OVNIs (§3.12)
  OV.Data.ufoRules = {
    sizes: 5, // 0 muito pequeno … 4 muito grande
    visibilityBySize: VIS,
    crashDamagePct: 50, // dano > 50 % ⇒ queda; ≥ 100 % ⇒ destruído
    crashAlloyPct: 70, // ours: ligas e artefactos recuperados de um OVNI caído
    eleriumPerPowerSource: 50,
    powerSourceExplodePct: 75, // ours: cada fonte de energia de um OVNI caído explode
    powerSourceBlast: { power: [120, 180], radius: 6, type: 'HE' }, // ours (orig 180–250 r10)
    crashCrewDeathPct: 20,
    crashHullBreaches: [3, 6],
    ufoShotHitPct: 60, // tiro do OVNI no dogfight; dano RNG(0, power)
  };

  // recuperação de um OVNI tomado: {itemId: n}. opts.crashed reduz ligas/artefactos a 70 %;
  // opts.powerSources / opts.navigation = peças intactas no fim da batalha (por omissão todas)
  OV.Data.ufoRecovery = function (ufoId, opts) {
    const u = OV.Data.ufos[ufoId];
    if (!u) return {};
    opts = opts || {};
    const crashed = !!opts.crashed;
    const scale = (n) => (crashed ? Math.floor((n * OV.Data.ufoRules.crashAlloyPct + 50) / 100) : n);
    const ps = opts.powerSources !== undefined ? opts.powerSources : u.powerSources;
    const out = {};
    const add = (k, n) => { if (n > 0) out[k] = (out[k] || 0) + n; };
    add('ufo_power_source', ps);
    add('elerium_115', ps * OV.Data.ufoRules.eleriumPerPowerSource);
    add('ufo_navigation', opts.navigation !== undefined ? opts.navigation : u.navigation);
    add('alien_alloys', scale(u.alloys));
    for (const k in u.artefacts) add(k, scale(u.artefacts[k]));
    return out;
  };

  OV.Data.ufos = UFOS;
})(globalThis.OV || (globalThis.OV = {}));
