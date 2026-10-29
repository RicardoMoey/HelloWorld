/* Investigação (DESIGN.md §3.15), fabrico (§3.16) e preços de venda de material alienígena (§3.17).
   OV.Data.research, OV.Data.manufacture, OV.Data.sellPrices, OV.Data.researchRules, OV.Data.researchFlags
   Ajudas puras: researchAvailable, researchTopic, researchEffects, researchConsumable, manufactureAvailable,
   progressLabelKey, interrogationId, unitRankRace, interrogableUnits, validateStrategy. */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  // finalize.js carrega no fim e reaproveita esta lista; até lá o registo é feito aqui com a mesma semântica
  OV.Data.finalizers = OV.Data.finalizers || [];
  OV.Data.onFinalize = OV.Data.onFinalize || function (name, fn, order) {
    OV.Data.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };

  const IPFX = 'interrogate_';
  const RANKS = ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier', 'terrorist'];
  const TERROR_UNITS = ['cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie'];
  // plantéis por raça (§3.9) — só para nomes e validação quando a tabela de unidades ainda não existe
  const ROSTERS = {
    sectoid: ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier'],
    floater: ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier'],
    snakeman: ['commander', 'leader', 'engineer', 'navigator', 'soldier'],
    muton: ['engineer', 'navigator', 'soldier'],
    ethereal: ['commander', 'leader', 'soldier'],
  };
  const AUTOPSIES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'reaper', 'sectopod', 'chryssalid', 'zombie'];
  // bandeiras de campanha tocadas pela investigação (G.flags)
  const FLAGS = ['interrogated', 'navigatorInterrogated', 'leaderInterrogated', 'commanderInterrogated', 'martianSolution', 'cydoniaUnlocked'];

  // cost = dias-cientista ours (≈ orig × 0,25); costOrig; points = pontos orig ao concluir
  // requires = todos; requiresAny = pelo menos um; requiresFlags = bandeiras de G.flags
  // needItem = item(s) em armazém para começar (qualquer um; consome 1, orig); items/armours = o que fica conhecido
  // setsFlags = bandeiras ligadas ao concluir; cat = grupo na lista
  const R = {
    laser_weapons: { cost: 20, costOrig: 50, points: 10, cat: 'weapons' },
    laser_pistol: { cost: 35, costOrig: 100, points: 10, requires: ['laser_weapons'], items: ['laser_pistol'], cat: 'weapons' },
    laser_rifle: { cost: 90, costOrig: 300, points: 10, requires: ['laser_pistol'], items: ['laser_rifle'], cat: 'weapons' },
    heavy_laser: { cost: 140, costOrig: 460, points: 10, requires: ['laser_rifle'], items: ['heavy_laser'], cat: 'weapons' },
    laser_cannon: { cost: 120, costOrig: 420, points: 15, requires: ['heavy_laser'], items: ['laser_cannon'], cat: 'craft' },
    laser_defense: { cost: 140, costOrig: 510, points: 15, requires: ['laser_cannon'], cat: 'facility' },
    medikit: { cost: 40, costOrig: 210, points: 20, items: ['medikit'], cat: 'equipment' },
    motion_scanner: { cost: 50, costOrig: 180, points: 20, items: ['motion_scanner'], cat: 'equipment' },

    alien_alloys: { cost: 110, costOrig: 400, points: 30, needItem: 'alien_alloys', items: ['alien_alloys'], cat: 'alien_tech' },
    elerium: { cost: 120, costOrig: 450, points: 60, needItem: 'elerium_115', items: ['elerium_115'], cat: 'alien_tech' },
    power_source: { cost: 120, costOrig: 450, points: 30, needItem: 'ufo_power_source', items: ['ufo_power_source'], cat: 'alien_tech' },
    ufo_navigation: { cost: 120, costOrig: 450, points: 30, needItem: 'ufo_navigation', items: ['ufo_navigation'], cat: 'alien_tech' },
    ufo_construction: {
      cost: 120, costOrig: 450, points: 30, requires: ['alien_alloys', 'elerium', 'power_source', 'ufo_navigation'], cat: 'alien_tech',
    },
    alien_food: { cost: 40, costOrig: 150, points: 30, needItem: 'alien_food', items: ['alien_food'], cat: 'alien_tech' },
    alien_surgery: { cost: 40, costOrig: 150, points: 30, needItem: 'alien_surgery', items: ['alien_surgery'], cat: 'alien_tech' },
    examination_room: { cost: 40, costOrig: 150, points: 30, needItem: 'examination_room', items: ['examination_room'], cat: 'alien_tech' },
    alien_reproduction: { cost: 40, costOrig: 150, points: 30, needItem: 'alien_reproduction', items: ['alien_reproduction'], cat: 'alien_tech' },
    alien_entertainment: { cost: 40, costOrig: 150, points: 30, needItem: 'alien_entertainment', items: ['alien_entertainment'], cat: 'alien_tech' },

    personal_armour: { cost: 50, costOrig: 180, points: 20, requires: ['alien_alloys'], armours: ['personal_armour'], cat: 'armour' },
    power_suit: { cost: 70, costOrig: 205, points: 20, requires: ['elerium', 'power_source', 'personal_armour'], armours: ['power_suit'], cat: 'armour' },
    flying_suit: { cost: 100, costOrig: 330, points: 20, requires: ['power_suit', 'ufo_navigation'], armours: ['flying_suit'], cat: 'armour' },

    plasma_pistol: {
      cost: 160, costOrig: 1000, points: 25, needItem: ['plasma_pistol', 'plasma_pistol_clip'],
      items: ['plasma_pistol', 'plasma_pistol_clip'], cat: 'weapons',
    },
    plasma_rifle: {
      cost: 190, costOrig: 1100, points: 31, needItem: ['plasma_rifle', 'plasma_rifle_clip'],
      items: ['plasma_rifle', 'plasma_rifle_clip'], cat: 'weapons',
    },
    heavy_plasma: {
      cost: 220, costOrig: 1200, points: 37, needItem: ['heavy_plasma', 'heavy_plasma_clip'],
      items: ['heavy_plasma', 'heavy_plasma_clip'], cat: 'weapons',
    },
    plasma_cannon: { cost: 180, costOrig: 660, points: 25, requiresAny: ['heavy_plasma', 'plasma_rifle'], items: ['plasma_beam'], cat: 'craft' },
    plasma_defense: { cost: 170, costOrig: 620, points: 25, requires: ['plasma_cannon'], cat: 'facility' },
    small_launcher: {
      cost: 150, costOrig: 730, points: 40, needItem: ['small_launcher', 'stun_bomb'], items: ['small_launcher', 'stun_bomb'], cat: 'weapons',
    },
    blaster_launcher: {
      cost: 240, costOrig: 1200, points: 20, needItem: ['blaster_launcher', 'blaster_bomb'],
      items: ['blaster_launcher', 'blaster_bomb'], cat: 'weapons',
    },
    alien_grenade: { cost: 55, costOrig: 200, points: 20, needItem: 'alien_grenade', items: ['alien_grenade'], cat: 'weapons' },

    alien_origins: { cost: 80, costOrig: 300, points: 60, requiresFlags: ['interrogated'], cat: 'story' },
    martian_solution: {
      cost: 130, costOrig: 500, points: 60, requires: ['alien_origins'], requiresFlags: ['leaderInterrogated'],
      setsFlags: ['martianSolution'], cat: 'story',
    },
    cydonia: {
      cost: 160, costOrig: 600, points: 60, requires: ['martian_solution'], requiresFlags: ['commanderInterrogated'],
      setsFlags: ['cydoniaUnlocked'], cat: 'story',
    },
    new_fighter: { cost: 160, costOrig: 600, points: 30, requires: ['ufo_construction'], cat: 'craft' },
    ultimate_craft: { cost: 240, costOrig: 900, points: 30, requires: ['new_fighter'], cat: 'craft' }, // passo Lightning cortado
    hyper_wave: { cost: 180, costOrig: 670, points: 25, requiresFlags: ['navigatorInterrogated'], cat: 'facility' },
  };

  for (const race of AUTOPSIES) {
    R['autopsy_' + race] = { cost: 50, costOrig: 180, points: 50, needItem: race + '_corpse', items: [race + '_corpse'], race, cat: 'alien_life' };
  }

  // interrogatório: modelo (não é um tópico); tópicos concretos 'interrogate_<unidade>' sintetizados por researchTopic
  // outcomes: flag ganha se 'after' já estiver investigado quando o interrogatório termina (sequência orig); ours
  // (retroativo): quando 'after' termina, a flag também é ganha se uma patente de 'ranks' já tiver sido interrogada
  R.interrogate = {
    template: true, cat: 'alien_life', points: 50, consumes: 'liveAlien',
    costByRank: { soldier: 45, navigator: 45, engineer: 45, medic: 45, terrorist: 45, leader: 55, commander: 65 },
    costOrigByRank: { soldier: 192, navigator: 192, engineer: 192, medic: 192, terrorist: 170, leader: 192, commander: 190 },
    outcomes: [
      { ranks: '*', flag: 'interrogated' }, // qualquer ⇒ «Origens Alienígenas»
      { ranks: ['navigator'], flag: 'navigatorInterrogated' }, // ⇒ Descodificador Hiper-Onda
      { ranks: ['leader', 'commander'], flag: 'leaderInterrogated', after: 'alien_origins' },
      { ranks: ['commander'], flag: 'commanderInterrogated', after: 'martian_solution' },
      { ranks: ['engineer'], freeArticle: 'ufo' },
      { ranks: ['medic'], freeArticle: 'race' },
    ],
  };

  // normalização: listas sempre presentes; needItem → array ou null
  for (const id in R) {
    const t = R[id];
    t.id = id;
    t.nameKey = 'research.' + id;
    if (t.template) continue;
    t.requires = t.requires || [];
    t.requiresAny = t.requiresAny || [];
    t.requiresFlags = t.requiresFlags || [];
    t.needItem = t.needItem ? [].concat(t.needItem) : null;
    t.consumesItem = !!t.needItem;
    t.items = t.items || [];
    t.armours = t.armours || [];
    t.setsFlags = t.setsFlags || [];
    t.article = t.article || id;
    t.unlocks = []; // compilado: tópicos que dependem deste
    t.enables = { manufacture: [], facilities: [], crafts: [] }; // compilado
  }
  const ORDER = Object.keys(R).filter((id) => !R[id].template);

  // fabrico: hours = horas-engenheiro ours (≈ orig × 0,2); cost $ por unidade; materials ours (≈ orig × 0,35); space orig.
  // Com as horas a 1/5 e os preços de venda orig, fabricar para vender rendia ~5× o original por hora de engenheiro:
  // cost = max(costOrig, venda − materiais à venda − MANUFACTURE_PROFIT_CAP_H × hours), arredondado a 500 $, para que nada
  // renda mais de 100 $/h-eng (o melhor do original: canhão laser, 97). costOrig fica como referência.
  const M = {
    laser_pistol: { hours: 60, hoursOrig: 300, cost: 14000, costOrig: 8000, space: 2, requires: 'laser_pistol', cat: 'weapon' },
    laser_rifle: { hours: 80, hoursOrig: 400, cost: 29000, costOrig: 20000, space: 3, requires: 'laser_rifle', cat: 'weapon' },
    heavy_laser: { hours: 140, hoursOrig: 700, cost: 47000, costOrig: 32000, space: 4, requires: 'heavy_laser', cat: 'weapon' },
    medikit: { hours: 80, hoursOrig: 420, cost: 38500, costOrig: 28000, space: 4, requires: 'medikit', cat: 'equipment' },
    motion_scanner: { hours: 45, hoursOrig: 220, cost: 41500, costOrig: 34000, space: 4, requires: 'motion_scanner', cat: 'equipment' },
    plasma_pistol: { hours: 120, hoursOrig: 600, cost: 65500, costOrig: 56000, materials: { alien_alloys: 1 }, space: 3, requires: 'plasma_pistol', cat: 'weapon' },
    plasma_pistol_clip: { hours: 12, hoursOrig: 60, cost: 2000, materials: { elerium_115: 1 }, space: 4, requires: 'plasma_pistol', cat: 'ammo' },
    plasma_rifle: { hours: 160, hoursOrig: 820, cost: 104000, costOrig: 88000, materials: { alien_alloys: 1 }, space: 4, requires: 'plasma_rifle', cat: 'weapon' },
    plasma_rifle_clip: { hours: 16, hoursOrig: 80, cost: 3000, materials: { elerium_115: 1 }, space: 4, requires: 'plasma_rifle', cat: 'ammo' },
    heavy_plasma: { hours: 200, hoursOrig: 1000, cost: 145500, costOrig: 122000, materials: { alien_alloys: 1 }, space: 4, requires: 'heavy_plasma', cat: 'weapon' },
    heavy_plasma_clip: { hours: 16, hoursOrig: 80, cost: 6000, materials: { elerium_115: 1 }, space: 4, requires: 'heavy_plasma', cat: 'ammo' },
    small_launcher: { hours: 180, hoursOrig: 900, cost: 95500, costOrig: 78000, materials: { alien_alloys: 1 }, space: 3, requires: 'small_launcher', cat: 'weapon' },
    stun_bomb: { hours: 40, hoursOrig: 200, cost: 7000, materials: { elerium_115: 1 }, space: 2, requires: 'small_launcher', cat: 'ammo' },
    blaster_launcher: { hours: 240, hoursOrig: 1200, cost: 113500, costOrig: 90000, materials: { alien_alloys: 1 }, space: 5, requires: 'blaster_launcher', cat: 'weapon' },
    blaster_bomb: { hours: 45, hoursOrig: 220, cost: 8000, materials: { elerium_115: 2 }, space: 3, requires: 'blaster_launcher', cat: 'ammo' },
    alien_grenade: { hours: 40, hoursOrig: 200, cost: 6700, materials: { elerium_115: 1 }, space: 2, requires: 'alien_grenade', cat: 'weapon' },
    personal_armour: {
      hours: 160, hoursOrig: 800, cost: 25000, costOrig: 22000, materials: { alien_alloys: 2 }, space: 12, requires: 'personal_armour',
      produces: { item: 'personal_armour', armour: 'personal_armour', n: 1 }, cat: 'armour',
    },
    power_suit: {
      hours: 200, hoursOrig: 1000, cost: 42000, materials: { alien_alloys: 3, elerium_115: 2 }, space: 16, requires: 'power_suit',
      produces: { item: 'power_suit', armour: 'power_suit', n: 1 }, cat: 'armour',
    },
    flying_suit: {
      hours: 280, hoursOrig: 1400, cost: 58000, materials: { alien_alloys: 3, elerium_115: 6 }, space: 16, requires: 'flying_suit',
      produces: { item: 'flying_suit', armour: 'flying_suit', n: 1 }, cat: 'armour',
    },
    laser_cannon: { hours: 60, hoursOrig: 300, cost: 205000, costOrig: 182000, space: 6, requires: 'laser_cannon', cat: 'craft_weapon' },
    plasma_beam: { hours: 100, hoursOrig: 500, cost: 227500, costOrig: 226000, materials: { elerium_115: 6 }, space: 8, requires: 'plasma_cannon', cat: 'craft_weapon' },
    ufo_power_source: {
      hours: 280, hoursOrig: 1400, cost: 162500, costOrig: 130000, materials: { alien_alloys: 3, elerium_115: 8 }, space: 22, requires: 'power_source',
      cat: 'ufo_component',
    },
    ufo_navigation: { hours: 320, hoursOrig: 1600, cost: 150000, materials: { alien_alloys: 2 }, space: 18, requires: 'ufo_navigation', cat: 'ufo_component' },
    firestorm: {
      hours: 1400, hoursOrig: 14000, cost: 400000, materials: { alien_alloys: 25, ufo_power_source: 1, ufo_navigation: 1 }, space: 30,
      requires: 'new_fighter', produces: { craft: 'firestorm', n: 1 }, cat: 'craft',
    },
    avenger: {
      hours: 2400, hoursOrig: 34000, cost: 900000, materials: { alien_alloys: 25, ufo_power_source: 2, ufo_navigation: 1 }, space: 36, // ligas ours 40 → 25 (ritmo do fim)
      requires: 'ultimate_craft', produces: { craft: 'avenger', n: 1 }, cat: 'craft',
    },
  };
  for (const id in M) {
    const m = M[id];
    m.id = id;
    m.kind = 'manufacture';
    m.materials = m.materials || {};
    m.produces = m.produces || { item: id, n: 1 };
    m.needsHangar = !!m.produces.craft;
    m.nameKey = null; // resolvido na compilação a partir do item/nave/armadura produzido
  }
  const MORDER = Object.keys(M);

  // preços de venda orig de material alienígena e fabricado (armas de nave em crafts.js); aplicados aos itens sem preço
  OV.Data.sellPrices = {
    plasma_pistol: 84000, plasma_pistol_clip: 4440, plasma_rifle: 126500, plasma_rifle_clip: 6290,
    heavy_plasma: 171600, heavy_plasma_clip: 9590, small_launcher: 120000, stun_bomb: 15200,
    blaster_launcher: 144000, blaster_bomb: 17028, alien_grenade: 14850,
    elerium_115: 5000, alien_alloys: 6500, ufo_power_source: 250000, ufo_navigation: 80000,
    alien_food: 5000, alien_reproduction: 40000, alien_entertainment: 20000, alien_surgery: 38000, examination_room: 9000,
    laser_pistol: 20000, laser_rifle: 36900, heavy_laser: 61000, motion_scanner: 45600, medikit: 46500, psi_amp: 194700,
    personal_armour: 54000, power_suit: 85000, flying_suit: 115000,
  };
  for (const race of AUTOPSIES) OV.Data.sellPrices[race + '_corpse'] = 20000;
  OV.Data.liveAliensSellable = false; // orig

  OV.Data.researchRules = {
    costRandPct: [80, 120], // ours: custo do projeto × RNG(80..120)/100 ao começar
    unknownPermille: 333, // «Desconhecido» até 33,3 % gasto
    poorPct: 7, averagePct: 13, goodPct: 25, // cientistas/custo
  };
  OV.Data.researchFlags = FLAGS.slice();

  // ---- ajudas puras -------------------------------------------------------------------------------------

  // aceita Set, array, {id:true} ou função
  function hasFn(s) {
    if (!s) return () => false;
    if (typeof s === 'function') return s;
    if (s instanceof Set) return (id) => s.has(id);
    if (Array.isArray(s)) {
      const set = new Set(s);
      return (id) => set.has(id);
    }
    return (id) => !!s[id];
  }
  // armazém: função (itemId) → bool, ou objeto {itemId: quantidade}
  function storeFn(s) {
    if (!s) return () => false;
    if (typeof s === 'function') return (id) => !!s(id);
    return (id) => (s[id] || 0) > 0;
  }
  // alienígenas vivos: ['sectoid_soldier'], [{type}], {type: n} → tipos distintos por ordem
  function alienTypes(live) {
    const out = [];
    const push = (t) => { if (t && !out.includes(t)) out.push(t); };
    if (!live) return out;
    if (Array.isArray(live)) for (const a of live) push(typeof a === 'string' ? a : a && (a.type || a.typeId));
    else if (live instanceof Set) for (const a of live) push(a);
    else for (const k in live) if (live[k] > 0) push(k);
    return out;
  }

  // patente e raça de um tipo de unidade alienígena (ids fixos <raça>_<patente> e unidades de terror)
  function unitRankRace(unitId) {
    if (typeof unitId !== 'string' || unitId.startsWith('civilian')) return null;
    if (TERROR_UNITS.includes(unitId)) return { rank: 'terrorist', race: unitId };
    const k = unitId.lastIndexOf('_');
    if (k > 0 && RANKS.includes(unitId.slice(k + 1))) return { rank: unitId.slice(k + 1), race: unitId.slice(0, k) };
    const u = OV.Data.units && OV.Data.units[unitId];
    if (u && RANKS.includes(u.rank)) return { rank: u.rank, race: u.race || unitId };
    return null;
  }

  const interrogationId = (unitId) => IPFX + unitId;

  // tipos de alienígena interrogáveis: da tabela de unidades se existir, senão dos plantéis do §3.9
  function interrogableUnits() {
    const out = [];
    const units = OV.Data.units || {};
    const ids = Object.keys(units);
    if (ids.length) {
      for (const id of ids) if (unitRankRace(id)) out.push(id);
      return out;
    }
    for (const race in ROSTERS) for (const rank of ROSTERS[race]) out.push(race + '_' + rank);
    return out.concat(TERROR_UNITS);
  }

  const synth = new Map();
  // tópico por id: estático ou interrogatório sintetizado a partir do modelo
  function researchTopic(id) {
    const t = R[id];
    if (t) return t.template ? null : t;
    if (typeof id !== 'string' || !id.startsWith(IPFX)) return null;
    if (synth.has(id)) return synth.get(id);
    const unit = id.slice(IPFX.length);
    const rr = unitRankRace(unit);
    if (!rr) return null;
    const tpl = R.interrogate;
    const topic = {
      id, nameKey: 'research.' + id, cat: 'alien_life', interrogation: true, unit, rank: rr.rank, race: rr.race,
      cost: tpl.costByRank[rr.rank], costOrig: tpl.costOrigByRank[rr.rank], points: tpl.points,
      requires: [], requiresAny: [], requiresFlags: [], needItem: null, consumesItem: false, consumes: { liveAlien: unit },
      items: [], armours: [], setsFlags: [], article: 'race_' + rr.race, unlocks: [], enables: { manufacture: [], facilities: [], crafts: [] },
    };
    OV.U.deepFreeze(topic); // partilhado pela cache: imutável como os restantes tópicos
    synth.set(id, topic);
    return topic;
  }

  // bandeiras novas que um interrogatório daria agora
  function interrogationFlags(topic, has, flags) {
    const out = [];
    for (const o of R.interrogate.outcomes) {
      if (!o.flag) continue;
      if (o.ranks !== '*' && !o.ranks.includes(topic.rank)) continue;
      if (o.after && !has(o.after)) continue;
      if (!flags[o.flag] && !out.includes(o.flag)) out.push(o.flag);
    }
    return out;
  }

  // tópicos que se podem começar agora (ordem da tabela; interrogatórios no fim pela ordem dos alienígenas)
  // um interrogatório repete-se se o tipo já foi interrogado mas agora daria uma bandeira nova (sem becos sem saída)
  function researchAvailable(researchedSet, flags, storesHas, liveAliens) {
    const has = hasFn(researchedSet);
    const fl = flags || {};
    const inStore = storeFn(storesHas);
    const out = [];
    for (const id of ORDER) {
      const t = R[id];
      if (has(id)) continue;
      if (!t.requires.every(has)) continue;
      if (t.requiresAny.length && !t.requiresAny.some(has)) continue;
      if (!t.requiresFlags.every((f) => fl[f])) continue;
      if (t.needItem && !t.needItem.some(inStore)) continue;
      out.push(id);
    }
    for (const unit of alienTypes(liveAliens)) {
      const t = researchTopic(interrogationId(unit));
      if (!t || out.includes(t.id)) continue;
      if (!has(t.id) || interrogationFlags(t, has, fl).length) out.push(t.id);
    }
    return out;
  }

  // patentes já interrogadas (pelos tópicos interrogate_<unidade> investigados)
  function interrogatedRanks(has) {
    const out = [];
    for (const unit of interrogableUnits()) {
      const t = researchTopic(interrogationId(unit));
      if (t && has(t.id) && !out.includes(t.rank)) out.push(t.rank);
    }
    return out;
  }

  // efeitos de concluir um tópico, calculados ANTES de o marcar como investigado
  // → {id, points, flags:[novas], freeArticle, consumes, finalMission} | null
  function researchEffects(topicId, researchedSet, flags) {
    const t = researchTopic(topicId);
    if (!t) return null;
    const has = hasFn(researchedSet);
    const fl = flags || {};
    const out = { id: t.id, points: has(t.id) ? 0 : t.points, flags: [], freeArticle: null, consumes: t.consumes || null, finalMission: false };
    for (const f of t.setsFlags) if (!fl[f] && !out.flags.includes(f)) out.flags.push(f);
    // ours (retroativo): o conhecimento de um líder/comandante interrogado antes do tempo não se perde
    const late = R.interrogate.outcomes.filter((o) => o.flag && o.after === t.id && !fl[o.flag]);
    if (late.length) {
      const ranks = interrogatedRanks(has);
      for (const o of late) {
        if (!out.flags.includes(o.flag) && (o.ranks === '*' || o.ranks.some((r) => ranks.includes(r)))) out.flags.push(o.flag);
      }
    }
    if (t.interrogation) {
      for (const f of interrogationFlags(t, has, fl)) if (!out.flags.includes(f)) out.flags.push(f);
      for (const o of R.interrogate.outcomes) {
        if (o.freeArticle && (o.ranks === '*' || o.ranks.includes(t.rank))) out.freeArticle = o.freeArticle;
      }
    }
    out.finalMission = out.flags.includes('cydoniaUnlocked');
    return out;
  }

  // item consumido ao começar um tópico (o primeiro de needItem que exista em armazém) ou null
  function researchConsumable(topicId, storesHas) {
    const t = researchTopic(topicId);
    if (!t || !t.needItem) return null;
    const inStore = storeFn(storesHas);
    for (const it of t.needItem) if (inStore(it)) return it;
    return null;
  }

  // fabricos desbloqueados pela investigação feita (ordem da tabela)
  function manufactureAvailable(researchedSet) {
    const has = hasFn(researchedSet);
    return MORDER.filter((id) => has(M[id].requires));
  }

  // chave i18n do rótulo de progresso (§3.15; limiares orig ResearchProject::getResearchProgress)
  function progressLabelKey(costTotal, spent, scientists) {
    const RR = OV.Data.researchRules;
    if (!(scientists > 0) || !(costTotal > 0)) return 'research.progress.none';
    if (spent * 1000 <= costTotal * RR.unknownPermille) return 'research.progress.unknown';
    if (scientists * 100 <= costTotal * RR.poorPct) return 'research.progress.poor';
    if (scientists * 100 <= costTotal * RR.averagePct) return 'research.progress.average';
    if (scientists * 100 <= costTotal * RR.goodPct) return 'research.progress.good';
    return 'research.progress.excellent';
  }

  // ciclo nos pré-requisitos (requires + requiresAny) → lista de ids do ciclo ou null
  function findCycle() {
    const state = {};
    const stack = [];
    let cycle = null;
    const visit = (id) => {
      if (cycle) return;
      state[id] = 1;
      stack.push(id);
      const t = R[id];
      for (const d of t ? t.requires.concat(t.requiresAny) : []) {
        if (!R[d] || R[d].template) continue;
        if (state[d] === 1) {
          cycle = stack.slice(stack.indexOf(d)).concat(d);
          return;
        }
        if (!state[d]) visit(d);
        if (cycle) return;
      }
      stack.pop();
      state[id] = 2;
    };
    for (const id of ORDER) if (!state[id]) visit(id);
    return cycle;
  }

  const armourTable = () => OV.Data.armours || OV.Data.armour || OV.Data.armors || null;
  const count = (o) => (o ? Object.keys(o).length : 0);

  // validação cruzada dos dados estratégicos → lista de erros (texto técnico, não é para o jogador)
  // as referências a itens só são verificadas quando OV.Data.items já está completo (≥ 30 entradas)
  function validateStrategy(opts) {
    opts = opts || {};
    const D = OV.Data;
    const errs = [];
    const items = D.items || {};
    const itemsReady = opts.items !== undefined ? !!opts.items : count(items) >= 30;
    const arm = armourTable();
    const armReady = count(arm) > 0;
    const itemOk = (id) => !itemsReady || !!items[id];
    // armaduras: tabela própria (outro ficheiro) ou, em alternativa, item de armazém com o mesmo id
    const armourOk = (id) => (armReady ? !!arm[id] || !!items[id] : true);
    const topicOk = (id) => !!R[id] && !R[id].template;

    for (const id of ORDER) {
      const t = R[id];
      if (!(t.cost > 0)) errs.push('research.' + id + ': custo inválido');
      for (const d of t.requires.concat(t.requiresAny)) if (!topicOk(d)) errs.push('research.' + id + ': requisito desconhecido ' + d);
      for (const f of t.requiresFlags.concat(t.setsFlags)) if (!FLAGS.includes(f)) errs.push('research.' + id + ': bandeira desconhecida ' + f);
      for (const it of (t.needItem || []).concat(t.items)) if (!itemOk(it)) errs.push('research.' + id + ': item desconhecido ' + it);
      for (const a of t.armours) if (!armourOk(a)) errs.push('research.' + id + ': armadura desconhecida ' + a);
    }
    const tpl = R.interrogate;
    for (const rank of RANKS) if (!(tpl.costByRank[rank] > 0)) errs.push('research.interrogate: sem custo para ' + rank);
    for (const o of tpl.outcomes) {
      if (o.flag && !FLAGS.includes(o.flag)) errs.push('research.interrogate: bandeira desconhecida ' + o.flag);
      if (o.after && !topicOk(o.after)) errs.push('research.interrogate: tópico desconhecido ' + o.after);
    }
    const cyc = findCycle();
    if (cyc) errs.push('research: ciclo de pré-requisitos ' + cyc.join(' → '));

    for (const id of MORDER) {
      const m = M[id];
      if (!topicOk(m.requires)) errs.push('manufacture.' + id + ': investigação desconhecida ' + m.requires);
      for (const it in m.materials) if (!itemOk(it)) errs.push('manufacture.' + id + ': material desconhecido ' + it);
      if (m.materials.elerium_115 && m.produces.item === 'elerium_115') errs.push('manufacture.' + id + ': o Elerium não se fabrica');
      const p = m.produces;
      if (p.craft && !(D.crafts && D.crafts[p.craft])) errs.push('manufacture.' + id + ': nave desconhecida ' + p.craft);
      if (p.item && !itemOk(p.item)) errs.push('manufacture.' + id + ': item desconhecido ' + p.item);
      if (p.armour && !armourOk(p.armour)) errs.push('manufacture.' + id + ': armadura desconhecida ' + p.armour);
    }

    for (const id in D.facilities || {}) {
      const f = D.facilities[id];
      if (f.research && !topicOk(f.research)) errs.push('facility.' + id + ': investigação desconhecida ' + f.research);
    }
    const blocks = D.blocks || {};
    const blocksReady = Object.keys(blocks).some((k) => k.startsWith('UFO_') || k.startsWith('CRAFT_'));
    for (const id in D.crafts || {}) {
      const c = D.crafts[id];
      if (c.requires && !topicOk(c.requires)) errs.push('craft.' + id + ': investigação desconhecida ' + c.requires);
      if (c.refuelItem && !itemOk(c.refuelItem)) errs.push('craft.' + id + ': item de combustível desconhecido ' + c.refuelItem);
      if (c.block && blocksReady && !blocks[c.block]) errs.push('craft.' + id + ': bloco desconhecido ' + c.block);
    }
    for (const id in D.craftWeapons || {}) {
      const w = D.craftWeapons[id];
      if (!items[w.item]) errs.push('craftWeapon.' + id + ': item de armazém em falta ' + w.item);
      if (w.ammoItem && !items[w.ammoItem]) errs.push('craftWeapon.' + id + ': munição em falta ' + w.ammoItem);
    }
    const deps = D.deployments || {};
    for (const id in D.ufos || {}) {
      const u = D.ufos[id];
      if (count(deps) && !deps[u.deployment]) errs.push('ufo.' + id + ': deployment desconhecido ' + u.deployment);
      if (blocksReady && !blocks[u.block]) errs.push('ufo.' + id + ': bloco desconhecido ' + u.block);
      for (const it in u.artefacts) if (!itemOk(it)) errs.push('ufo.' + id + ': artefacto desconhecido ' + it);
    }

    const sb = D.startingBase;
    if (sb) {
      for (const f of sb.facilities) if (!(D.facilities && D.facilities[f.type])) errs.push('startingBase: instalação desconhecida ' + f.type);
      if (D.gridConnected && !D.gridConnected(sb.facilities).ok) errs.push('startingBase: grelha inválida ou desligada do elevador');
      for (const c of sb.crafts) {
        if (!(D.crafts && D.crafts[c.type])) errs.push('startingBase: nave desconhecida ' + c.type);
        for (const w of c.weapons || []) if (!(D.craftWeapons && D.craftWeapons[w.type])) errs.push('startingBase: arma de nave desconhecida ' + w.type);
        for (const it in c.cargo || {}) if (!itemOk(it)) errs.push('startingBase: item de carga desconhecido ' + it);
      }
      for (const it in sb.stores) if (!itemOk(it)) errs.push('startingBase: item de armazém desconhecido ' + it);
    }
    for (const it in D.sellPrices) if (!itemOk(it) && !armourOk(it)) errs.push('sellPrices: item desconhecido ' + it);
    // sentido inverso: itens e armaduras do MVP só podem apontar para tópicos existentes
    if (itemsReady) {
      for (const id in items) {
        const it = items[id];
        if (it.mvp === false || (it.phase && it.phase !== 'MVP')) continue;
        for (const ref of [it.research, it.topic]) if (ref && !topicOk(ref)) errs.push('item.' + id + ': investigação desconhecida ' + ref);
      }
    }
    for (const id in (armReady && arm) || {}) {
      if (arm[id].research && !topicOk(arm[id].research)) errs.push('armour.' + id + ': investigação desconhecida ' + arm[id].research);
    }

    if (!itemsReady && !opts.quiet) {
      console.log('[dados estratégicos] OV.Data.items tem ' + count(items) + ' entradas: verificações cruzadas de itens adiadas');
    }
    return errs;
  }

  // ---- finalizadores ------------------------------------------------------------------------------------

  // preços de venda para itens/armaduras ainda sem preço (o ficheiro de itens tem prioridade)
  OV.Data.onFinalize('strategy.sellPrices', (D) => {
    const arm = armourTable() || {};
    for (const id in D.sellPrices) {
      const target = (D.items && D.items[id]) || arm[id];
      if (target && !target.sell) target.sell = D.sellPrices[id];
    }
  }, 15);

  // compilação: inversos dos pré-requisitos e o que cada tópico permite fabricar/construir/comprar
  OV.Data.onFinalize('strategy.compile', (D) => {
    for (const id of ORDER) {
      for (const d of R[id].requires.concat(R[id].requiresAny)) if (R[d] && !R[d].unlocks.includes(id)) R[d].unlocks.push(id);
    }
    const arm = armourTable() || {};
    for (const id of MORDER) {
      const m = M[id];
      if (R[m.requires]) R[m.requires].enables.manufacture.push(id);
      const p = m.produces;
      const src = p.craft ? D.crafts && D.crafts[p.craft] : (D.items && D.items[p.item]) || (p.armour && arm[p.armour]);
      m.nameKey = (src && src.nameKey) || (p.craft ? 'craft.' + p.craft : 'item.' + p.item);
    }
    for (const id in D.facilities || {}) {
      const f = D.facilities[id];
      if (f.research && R[f.research]) R[f.research].enables.facilities.push(id);
    }
    for (const id in D.crafts || {}) {
      const c = D.crafts[id];
      if (c.requires && R[c.requires]) R[c.requires].enables.crafts.push(id);
    }
  }, 50);

  OV.Data.onFinalize('strategy.validate', () => {
    const errs = validateStrategy();
    if (errs.length) throw new Error(errs.join('; '));
  }, 90);

  // regras estratégicas imutáveis a partir daqui (a campanha copia startingBase com OV.U.clone)
  OV.Data.onFinalize('strategy.freeze', (D) => {
    const keys = ['ufos', 'ufoRules', 'crafts', 'craftWeapons', 'craftRules', 'dogfight', 'facilities', 'startingBase',
      'research', 'manufacture', 'sellPrices', 'researchRules', 'researchFlags'];
    for (const k of keys) if (D[k]) OV.U.deepFreeze(D[k]);
  }, 99);

  Object.assign(OV.Data, {
    research: R,
    manufacture: M,
    researchAvailable,
    researchTopic,
    researchEffects,
    researchConsumable,
    manufactureAvailable,
    progressLabelKey,
    interrogationId,
    unitRankRace,
    interrogableUnits,
    validateStrategy,
    researchCycle: findCycle,
    ALIEN_RANKS: RANKS,
    TERROR_UNITS,
    AUTOPSY_RACES: AUTOPSIES,
  });
})(globalThis.OV || (globalThis.OV = {}));
