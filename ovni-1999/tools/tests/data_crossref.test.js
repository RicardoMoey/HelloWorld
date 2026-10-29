/* Auditoria de referências cruzadas entre todas as tabelas de OV.Data (integração da vaga 1).
   Cada teste junta todas as falhas numa lista para o relatório mostrar tudo de uma vez. */
'use strict';

module.exports = function (OV, t) {
  const D = OV.Data;
  const has = (tab, id) => !!tab && typeof id === 'string' && Object.prototype.hasOwnProperty.call(tab, id);
  const check = (errs, ok, msg) => { if (!ok) errs.push(msg); };
  const done = (errs, what) => t.ok(errs.length === 0, what + ': ' + errs.length + ' falha(s)\n      ' + errs.slice(0, 40).join(' | '));
  const vals = (tab) => Object.values(tab || {});

  const UFO_IDS = ['small_scout', 'medium_scout', 'large_scout', 'harvester', 'abductor', 'supply_ship', 'terror_ship', 'battleship'];
  const DEP_IDS = UFO_IDS.map((u) => 'dep_' + u).concat(['dep_terror_site', 'dep_alien_base', 'dep_cydonia']);
  const CRAFT_IDS = ['skyranger', 'interceptor', 'firestorm', 'avenger'];
  const CW_IDS = ['stingray', 'avalanche', 'cannon', 'laser_cannon', 'plasma_beam', 'fusion_ball'];
  const RACES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'mixed'];
  const RANKS = ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier', 'terrorist'];
  const SPRITES = ['soldier', 'sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f'];
  const ARMOURS = ['coveralls', 'personal_armour', 'power_suit', 'flying_suit'];
  const COUNTRIES = ['usa', 'canada', 'brazil', 'uk', 'france', 'germany', 'italy', 'spain', 'russia', 'egypt', 'nigeria', 'south_africa', 'india', 'china', 'japan', 'australia', 'portugal'];
  const REGIONS = ['north_america', 'arctic', 'antarctica', 'south_america', 'south_africa', 'north_africa', 'europe', 'russia', 'asia', 'southeast_asia', 'australasia', 'pacific', 'north_atlantic', 'south_atlantic', 'indian_ocean'];
  const TERRAINS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS'];
  const FACILITIES = ['access_lift', 'living_quarters', 'laboratory', 'workshop', 'general_stores', 'alien_containment', 'hangar', 'small_radar', 'large_radar', 'missile_defence', 'laser_defence', 'plasma_defence', 'hyper_wave_decoder'];
  const CORE_ITEMS = ['pistol', 'pistol_clip', 'rifle', 'rifle_clip', 'heavy_cannon', 'hc_ap', 'hc_he', 'hc_in', 'auto_cannon', 'ac_ap', 'ac_he', 'ac_in',
    'rocket_launcher', 'small_rocket', 'large_rocket', 'incendiary_rocket', 'laser_pistol', 'laser_rifle', 'heavy_laser', 'plasma_pistol', 'plasma_pistol_clip',
    'plasma_rifle', 'plasma_rifle_clip', 'heavy_plasma', 'heavy_plasma_clip', 'small_launcher', 'stun_bomb', 'blaster_launcher', 'blaster_bomb', 'stun_rod',
    'grenade', 'smoke_grenade', 'proximity_grenade', 'high_explosive', 'alien_grenade', 'electro_flare', 'medikit', 'motion_scanner', 'psi_amp', 'alien_alloys',
    'elerium_115', 'ufo_power_source', 'ufo_navigation', 'alien_food', 'alien_surgery', 'examination_room', 'alien_reproduction', 'alien_entertainment',
    'sectoid_corpse', 'floater_corpse', 'snakeman_corpse', 'muton_corpse', 'ethereal_corpse', 'cyberdisc_corpse', 'sectopod_corpse', 'reaper_corpse',
    'chryssalid_corpse', 'zombie_corpse', 'stingray_missile', 'avalanche_missile', 'cannon_rounds', 'fusion_ball_missile'];

  // ── ids fixos ──
  t.test('crossref: todas as tabelas têm exatamente os ids fixos e cada registo tem .id igual à chave', () => {
    const e = [];
    const exact = (name, tab, ids) => {
      const keys = Object.keys(tab || {});
      for (const id of ids) check(e, has(tab, id), name + ': falta ' + id);
      for (const k of keys) check(e, ids.includes(k), name + ': id não fixo ' + k);
    };
    exact('ufos', D.ufos, UFO_IDS);
    exact('deployments', D.deployments, DEP_IDS);
    exact('crafts', D.crafts, CRAFT_IDS);
    exact('craftWeapons', D.craftWeapons, CW_IDS);
    exact('races', D.races, RACES);
    exact('armours', D.armours, ARMOURS);
    exact('countries', D.countries, COUNTRIES);
    exact('regions', D.regions, REGIONS);
    exact('mapScripts', D.mapScripts, TERRAINS);
    exact('facilities', D.facilities, FACILITIES);
    for (const id of CORE_ITEMS) check(e, has(D.items, id), 'items: falta ' + id);
    for (const r of Object.keys(D.ranks.alien)) check(e, RANKS.includes(r), 'ranks.alien: ' + r);
    for (const tn of ['units', 'items', 'research', 'manufacture', 'ufos', 'crafts', 'craftWeapons', 'facilities', 'armours', 'races', 'deployments',
      'regions', 'countries', 'alienMissions', 'mapScripts', 'tilesets', 'citiesById']) {
      for (const [k, r] of Object.entries(D[tn] || {})) check(e, r && r.id === k, tn + '.' + k + ': .id = ' + (r && r.id));
    }
    done(e, 'ids fixos');
  });

  // ── naves alienígenas e deployments ──
  t.test('crossref: OVNIs → deployments, blocos compilados e artefactos', () => {
    const e = [];
    for (const u of vals(D.ufos)) {
      check(e, has(D.deployments, u.deployment), u.id + ': deployment ' + u.deployment);
      check(e, u.deployment === 'dep_' + u.id, u.id + ': deployment devia ser dep_' + u.id);
      check(e, has(D.compiled, u.block), u.id + ': bloco ' + u.block + ' não compilado');
      const c = D.compiled[u.block];
      if (c) {
        check(e, c.w === u.blockSize.w && c.h === u.blockSize.h, u.id + ': blockSize ≠ bloco ' + c.w + '×' + c.h);
        check(e, c.specials.POWER_SOURCE.length === u.powerSources, u.id + ': fontes de energia ' + c.specials.POWER_SOURCE.length + ' ≠ ' + u.powerSources);
        check(e, c.specials.NAVIGATION.length === u.navigation, u.id + ': navegação ' + c.specials.NAVIGATION.length + ' ≠ ' + u.navigation);
        check(e, c.ufo === u.id, u.block + ': ufo = ' + c.ufo);
      }
      for (const it of Object.keys(u.artefacts || {})) check(e, has(D.items, it), u.id + ': artefacto ' + it);
      const loot = D.ufoRecovery(u.id, { crashed: true, powerSources: u.powerSources, navigation: u.navigation });
      for (const it of Object.keys(loot)) check(e, has(D.items, it), u.id + ': espólio ' + it);
    }
    for (const dep of vals(D.deployments)) {
      if (dep.ufo !== null && dep.ufo !== undefined) {
        check(e, has(D.ufos, dep.ufo), dep.id + ': ufo ' + dep.ufo);
        if (has(D.ufos, dep.ufo)) check(e, D.ufos[dep.ufo].deployment === dep.id, dep.id + ': OVNI ' + dep.ufo + ' aponta para ' + D.ufos[dep.ufo].deployment);
      }
      check(e, dep.race === null || dep.race === undefined || has(D.races, dep.race), dep.id + ': raça ' + dep.race);
      check(e, dep.terrain === null || dep.terrain === undefined || has(D.mapScripts, dep.terrain), dep.id + ': terreno ' + dep.terrain);
      for (const row of dep.rows) {
        check(e, RANKS.includes(row.rank), dep.id + ': posto ' + row.rank);
        check(e, row.unit === null || row.unit === undefined || has(D.units, row.unit), dep.id + ': unidade ' + row.unit);
        check(e, Array.isArray(row.qty) && row.qty.length === 3, dep.id + ': qty por dificuldade');
      }
    }
    check(e, D.deployments.dep_terror_site.terrain === 'URBAN', 'dep_terror_site devia ser URBAN');
    check(e, D.deployments.dep_alien_base.terrain === 'ALIENBASE', 'dep_alien_base devia ser ALIENBASE');
    check(e, D.deployments.dep_cydonia.terrain === 'MARS', 'dep_cydonia devia ser MARS');
    done(e, 'OVNIs/deployments');
  });

  t.test('crossref: missões alienígenas → OVNIs, sítios, trajetórias, raças', () => {
    const e = [];
    for (const m of vals(D.alienMissions)) {
      check(e, !m.siteType || has(D.deployments, m.siteType), m.id + ': siteType ' + m.siteType);
      check(e, !m.spawnUfo || has(D.ufos, m.spawnUfo), m.id + ': spawnUfo ' + m.spawnUfo);
      check(e, !m.assaultTraj || has(D.trajectories, m.assaultTraj), m.id + ': assaultTraj ' + m.assaultTraj);
      for (const w of m.waves) {
        check(e, has(D.ufos, w.ufo), m.id + ': vaga ufo ' + w.ufo);
        check(e, has(D.trajectories, w.traj), m.id + ': vaga traj ' + w.traj);
      }
    }
    for (const s of D.missionScripts) {
      for (const k of Object.keys(s.missionWeights || {})) check(e, has(D.alienMissions, k), 'script ' + s.id + ': missão ' + k);
      for (const k of Object.keys(s.races || {})) check(e, has(D.races, k), 'script ' + s.id + ': raça ' + k);
      for (const r of Object.keys(s.researchTriggers || {})) check(e, has(D.research, r), 'script ' + s.id + ': investigação ' + r);
    }
    for (const [mk, sched] of Object.entries(D.raceSchedule)) {
      check(e, mk === 'default' || has(D.alienMissions, mk), 'raceSchedule: missão ' + mk);
      for (const w of Object.values(sched)) for (const r of Object.keys(w)) check(e, has(D.races, r), 'raceSchedule.' + mk + ': raça ' + r);
    }
    for (const r of vals(D.regions)) {
      for (const k of Object.keys(r.missionWeights || {})) check(e, has(D.alienMissions, k), r.id + ': missionWeights ' + k);
      check(e, r.missionRegion === null || r.missionRegion === undefined || has(D.regions, r.missionRegion), r.id + ': missionRegion ' + r.missionRegion);
    }
    for (const k of Object.keys(D.scoring.missionPoints || {})) check(e, has(D.alienMissions, k), 'scoring.missionPoints: ' + k);
    done(e, 'missões');
  });

  // ── naves X-COM ──
  t.test('crossref: naves X-COM → blocos, armas, munições, investigação, fabrico', () => {
    const e = [];
    for (const c of vals(D.crafts)) {
      check(e, c.block === null || has(D.compiled, c.block), c.id + ': bloco ' + c.block);
      if (c.transport) check(e, has(D.compiled, c.block), c.id + ': transporte sem bloco');
      if (c.block && D.compiled[c.block]) check(e, D.compiled[c.block].startTiles.length >= c.seats, c.id + ': ' + D.compiled[c.block].startTiles.length + ' casas de partida < ' + c.seats + ' lugares');
      check(e, c.requires === null || has(D.research, c.requires), c.id + ': requires ' + c.requires);
      check(e, c.refuelItem === null || has(D.items, c.refuelItem), c.id + ': refuelItem ' + c.refuelItem);
    }
    for (const w of vals(D.craftWeapons)) {
      check(e, has(D.items, w.item), w.id + ': item ' + w.item);
      check(e, w.ammoItem === null || w.ammoItem === undefined || has(D.items, w.ammoItem), w.id + ': ammoItem ' + w.ammoItem);
    }
    for (const it of vals(D.items)) {
      if (it.kind === 'craft_ammo') check(e, has(D.craftWeapons, it.craftWeapon), it.id + ': craftWeapon ' + it.craftWeapon);
    }
    done(e, 'naves');
  });

  // ── itens, armaduras, unidades ──
  t.test('crossref: itens → munições, investigação, tópicos; armaduras → itens de armazém', () => {
    const e = [];
    for (const it of vals(D.items)) {
      for (const a of it.ammo || []) check(e, has(D.items, a), it.id + ': munição ' + a);
      for (const u of it.usedBy || []) check(e, has(D.items, u), it.id + ': usedBy ' + u);
      check(e, !it.research || has(D.research, it.research), it.id + ': research ' + it.research);
      check(e, !it.topic || has(D.research, it.topic), it.id + ': topic ' + it.topic);
      check(e, !it.zombify || has(D.units, it.zombify), it.id + ': zombify ' + it.zombify);
      check(e, !it.suit || has(D.armours, it.suit), it.id + ': suit ' + it.suit);
      if (it.kind === 'armour') check(e, has(D.armours, it.suit || it.id), it.id + ': armadura de armazém sem armours');
    }
    for (const a of vals(D.armours)) {
      check(e, !a.storeItem || has(D.items, a.storeItem), a.id + ': storeItem ' + a.storeItem);
      check(e, !a.research || has(D.research, a.research), a.id + ': research ' + a.research);
      check(e, has(D.items, a.corpse), a.id + ': corpse ' + a.corpse);
    }
    for (const k of Object.keys(D.sellPrices)) check(e, has(D.items, k), 'sellPrices: ' + k);
    for (const [k, n] of Object.entries(D.startingBase.stores)) check(e, has(D.items, k) && n > 0, 'startingBase.stores: ' + k);
    check(e, has(D.armours, D.startingBase.soldierArmour), 'startingBase.soldierArmour');
    for (const f of D.startingBase.facilities) check(e, has(D.facilities, f.type), 'startingBase: instalação ' + f.type);
    check(e, D.gridConnected(D.startingBase.facilities).ok, 'startingBase: grelha ligada');
    for (const c of D.startingBase.crafts) {
      check(e, has(D.crafts, c.type), 'startingBase: nave ' + c.type);
      for (const w of c.weapons) check(e, has(D.craftWeapons, w.type), 'startingBase: arma ' + w.type);
      for (const k of Object.keys(c.cargo)) check(e, has(D.items, k), 'startingBase: carga ' + k);
    }
    done(e, 'itens/armaduras');
  });

  t.test('crossref: unidades → sprites, cadáveres, armas, raças; plantéis de raça → unidades', () => {
    const e = [];
    for (const u of vals(D.units)) {
      check(e, SPRITES.includes(u.sprite), u.id + ': sprite ' + u.sprite);
      check(e, has(D.items, u.corpse), u.id + ': corpse ' + u.corpse);
      check(e, !u.weapon || has(D.items, u.weapon), u.id + ': weapon ' + u.weapon);
      check(e, !u.spawnOnDeath || has(D.units, u.spawnOnDeath), u.id + ': spawnOnDeath ' + u.spawnOnDeath);
      check(e, u.race === null || has(D.races, u.race), u.id + ': raça ' + u.race);
      check(e, u.rank === null || u.rank === undefined || RANKS.includes(u.rank), u.id + ': posto ' + u.rank);
      if (u.side === 'alien' && u.race && u.rank) check(e, u.id === u.race + '_' + u.rank, u.id + ': devia chamar-se ' + u.race + '_' + u.rank);
    }
    for (const r of vals(D.races)) {
      for (const rank of RANKS) {
        const m = r.members[rank];
        check(e, m !== undefined, r.id + ': falta posto ' + rank);
        for (const id of [].concat(m || [])) check(e, has(D.units, id), r.id + '.' + rank + ': unidade ' + id);
      }
    }
    if (OV.UnitSprites && OV.UnitSprites.KEYS) for (const k of SPRITES) check(e, OV.UnitSprites.KEYS.includes(k), 'UnitSprites sem ' + k);
    done(e, 'unidades');
  });

  t.test('crossref: cada linha de deployment resolve para uma unidade alienígena em todas as raças', () => {
    const e = [];
    for (const dep of vals(D.deployments)) {
      const races = dep.race ? [dep.race] : RACES.filter((r) => r !== 'mixed');
      for (const race of races) for (const row of dep.rows) for (const pick of [0, 1]) {
        const u = D.rowUnit(dep, row, race, pick);
        check(e, has(D.units, u) && D.units[u].side === 'alien', dep.id + '/' + race + '/' + row.rank + ': ' + u);
      }
      for (let d = 0; d < 3; d++) {
        const r = D.deploymentRange(dep.id, d);
        check(e, r.min >= 1 && r.max >= r.min, dep.id + ': deploymentRange(' + d + ')');
      }
    }
    // comandantes garantidos (caminho de vitória) em couraçados e bases, salvo a raça Muton (fiel ao original)
    for (const id of ['dep_battleship', 'dep_alien_base', 'dep_cydonia']) {
      const dep = D.deployments[id];
      const row = dep.rows.find((r) => r.rank === 'commander');
      check(e, !!row && row.min >= 1, id + ': sem comandante garantido');
      for (const race of dep.race ? [dep.race] : ['sectoid', 'floater', 'snakeman', 'ethereal']) {
        if (row) check(e, D.units[D.rowUnit(dep, row, race, 0)].rank === 'commander', id + '/' + race + ': comandante não é comandante');
      }
    }
    done(e, 'deployments → unidades');
  });

  t.test('crossref: tiers de armas alienígenas e extras referem itens e deployments existentes', () => {
    const e = [];
    const T = D.alienItemTiers;
    for (const set of T.sets) for (const id of set) check(e, has(D.items, id), 'sets: ' + id);
    for (const row of T.byMonth) check(e, row.length === T.sets.length, 'byMonth: largura ' + row.length);
    for (const r of Object.keys(T.raceTier || {})) check(e, has(D.races, r), 'raceTier: ' + r);
    for (const x of T.extras || []) {
      for (const id of (x.replace || []).concat(x.add || [])) check(e, has(D.items, id), 'extras: ' + id);
      for (const d of x.deployments || []) check(e, has(D.deployments, d), 'extras: deployment ' + d);
      for (const r of x.ranks || []) check(e, RANKS.includes(r), 'extras: posto ' + r);
    }
    // equipamento gerado de facto: todas as unidades em todos os deployments e tiers
    const rng = OV.RNG.create(7);
    if (rng) {
      for (const dep of DEP_IDS) for (const u of Object.keys(D.units)) for (let tier = 0; tier < T.sets.length; tier++) {
        for (const id of D.alienLoadout(u, dep, tier, rng)) check(e, has(D.items, id), dep + '/' + u + ': ' + id);
      }
    }
    done(e, 'tiers');
  });

  // ── investigação e fabrico ──
  t.test('crossref: investigação e fabrico resolvem todas as referências', () => {
    const e = [];
    for (const r of vals(D.research)) {
      if (r.template) continue;
      for (const k of (r.requires || []).concat(r.requiresAny || [], r.unlocks || [])) check(e, has(D.research, k), r.id + ': ' + k);
      for (const k of r.needItem || []) check(e, has(D.items, k), r.id + ': needItem ' + k);
      for (const k of r.items || []) check(e, has(D.items, k), r.id + ': items ' + k);
      for (const k of r.armours || []) check(e, has(D.armours, k), r.id + ': armours ' + k);
      for (const k of (r.requiresFlags || []).concat(r.setsFlags || [])) check(e, D.researchFlags.includes(k), r.id + ': flag ' + k);
      const en = r.enables || {};
      for (const k of en.manufacture || []) check(e, has(D.manufacture, k), r.id + ': manufacture ' + k);
      for (const k of en.facilities || []) check(e, has(D.facilities, k), r.id + ': facility ' + k);
      for (const k of en.crafts || []) check(e, has(D.crafts, k), r.id + ': craft ' + k);
    }
    for (const race of D.AUTOPSY_RACES) {
      check(e, has(D.research, 'autopsy_' + race), 'falta autopsy_' + race);
      check(e, has(D.items, race + '_corpse'), 'falta ' + race + '_corpse');
    }
    for (const u of D.interrogableUnits()) {
      check(e, has(D.units, u), 'interrogável ' + u);
      const tp = D.researchTopic(D.interrogationId(u));
      check(e, tp && tp.interrogation, 'tópico ' + D.interrogationId(u));
      check(e, (D.interrogationId(u).replace('interrogate_', 'research.interrogate_')) in OV.STR, 'texto research.interrogate_' + u);
    }
    for (const m of vals(D.manufacture)) {
      check(e, has(D.research, m.requires), m.id + ': requires ' + m.requires);
      for (const k of Object.keys(m.materials || {})) check(e, has(D.items, k), m.id + ': material ' + k);
      const p = m.produces;
      if (p.item) check(e, has(D.items, p.item), m.id + ': produz ' + p.item);
      if (p.armour) check(e, has(D.armours, p.armour), m.id + ': produz armadura ' + p.armour);
      if (p.craft) check(e, has(D.crafts, p.craft), m.id + ': produz nave ' + p.craft);
    }
    for (const f of vals(D.facilities)) check(e, !f.research || has(D.research, f.research), f.id + ': research ' + f.research);
    for (const c of vals(D.crafts)) if (c.requires) check(e, D.manufacture[c.id] && D.manufacture[c.id].produces.craft === c.id, c.id + ': sem fabrico');
    check(e, D.researchCycle() === null, 'ciclo na árvore: ' + JSON.stringify(D.researchCycle()));
    check(e, D.validateStrategy({ quiet: true }).length === 0, 'validateStrategy: ' + JSON.stringify(D.validateStrategy({ quiet: true })));
    done(e, 'investigação/fabrico');
  });

  t.test('crossref: caminho de vitória alcançável (cidónia investigável a partir do início)', () => {
    // fecho transitivo: todos os itens e alienígenas vivos disponíveis, flags obtidas por interrogatórios
    const done_ = new Set();
    const flags = {};
    const live = D.interrogableUnits();
    const stores = () => true;
    for (let guard = 0; guard < 400; guard++) {
      const av = D.researchAvailable(done_, flags, stores, live).filter((id) => !done_.has(id) || D.researchTopic(id).interrogation);
      const nxt = av.find((id) => !done_.has(id));
      if (!nxt) break;
      const fx = D.researchEffects(nxt, done_, flags);
      for (const f of fx.flags) flags[f] = true;
      done_.add(nxt);
    }
    for (const k of ['alien_origins', 'martian_solution', 'cydonia', 'ultimate_craft', 'hyper_wave']) t.ok(done_.has(k), 'inalcançável: ' + k);
    t.ok(flags.cydoniaUnlocked, 'cydoniaUnlocked nunca é ativada');
    // todos os tópicos estáticos acabam por ficar disponíveis
    const never = Object.keys(D.research).filter((k) => !D.research[k].template && !done_.has(k));
    t.eq(never, [], 'tópicos nunca disponíveis');
  });

  // ── geografia ──
  t.test('crossref: países geo ↔ world ↔ regiões ↔ cidades ↔ nacionalidades', () => {
    const e = [];
    for (const c of vals(D.countries)) {
      check(e, has(D.regions, c.region), c.id + ': região ' + c.region);
      check(e, has(D.world.countries, c.id), c.id + ': sem contorno em world');
      check(e, D.world.countryIds.includes(c.id), c.id + ': sem índice em world.countryIds');
      check(e, D.countryAt(c.label[0], c.label[1]) === c.id, c.id + ': label fora do retângulo');
      check(e, D.world.countryAt(c.label[0], c.label[1], 3) === c.id, c.id + ': label não cai no contorno real (' + D.world.countryAt(c.label[0], c.label[1], 3) + ')');
    }
    for (const id of Object.keys(D.world.countries)) check(e, has(D.countries, id), 'world: país extra ' + id);
    for (const city of D.cities) {
      check(e, has(D.regions, city.region), city.id + ': região ' + city.region);
      check(e, D.regions[city.region] && D.regions[city.region].cities.includes(city.id), city.id + ': região não a lista');
      check(e, D.citiesById[city.id] === city, city.id + ': citiesById');
    }
    for (const r of vals(D.regions)) {
      for (const cid of r.cities) check(e, has(D.citiesById, cid), r.id + ': cidade ' + cid);
      for (const z of r.missionZones || []) for (const a of z || []) if (a.length > 4 && a[4]) check(e, has(D.citiesById, a[4]), r.id + ': zona com cidade ' + a[4]);
    }
    for (const n of vals(D.soldierGen.nationalities)) check(e, n.country === null || has(D.countries, n.country), 'nacionalidade ' + n.id + ': país ' + n.country);
    for (const k of Object.keys(D.soldierGen.names)) check(e, has(D.soldierGen.nationalities, k), 'nomes sem nacionalidade ' + k);
    for (const k of Object.keys(D.soldierGen.nationalities)) check(e, has(D.soldierGen.names, k), 'nacionalidade sem nomes ' + k);
    for (const k of Object.keys(D.geoConst.radar)) check(e, k === 'craft' || has(D.facilities, k), 'geoConst.radar: ' + k);
    for (const [k, rr] of Object.entries(D.geoConst.radar)) {
      if (has(D.facilities, k)) check(e, Math.abs(D.facilities[k].radarRange - rr.nm) <= 1, k + ': alcance ' + D.facilities[k].radarRange + ' ≠ ' + rr.nm);
    }
    check(e, D.geoConst.radar.craft.nm === D.craftRules.radarRange, 'radar de nave geo ≠ craftRules');
    done(e, 'geografia');
  });

  t.test('crossref: terrainAt só devolve terrenos com mapScript; terreno URBAN existe para cidades', () => {
    const e = [];
    const seen = new Set();
    for (let lat = -89.5; lat < 90; lat += 1) {
      for (let lon = -179.5; lon < 180; lon += 1) {
        const tr = D.terrainAt(lon, lat);
        if (!seen.has(tr)) { seen.add(tr); check(e, has(D.mapScripts, tr), 'terrainAt(' + lon + ',' + lat + ') = ' + tr); }
        if (lon === -179.5) for (let h = 0; h < 100; h += 37) check(e, has(D.mapScripts, D.terrainAt(lon, lat, h)), 'hash ' + h);
      }
    }
    for (const tr of ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR']) check(e, seen.has(tr), 'terrainAt nunca devolve ' + tr);
    for (const k of Object.keys(D.terrainBoxes)) check(e, has(D.mapScripts, k), 'terrainBoxes: ' + k);
    done(e, 'terrenos');
  });

  // ── mapas ──
  t.test('crossref: mapScripts → blocos compilados, tilesets e tamanhos de OVNI', () => {
    const e = [];
    for (const s of vals(D.mapScripts)) {
      check(e, has(D.tilesets, s.tileset), s.id + ': tileset ' + s.tileset);
      for (const b of s.blocks) {
        check(e, has(D.blocks, b), s.id + ': bloco ' + b);
        check(e, has(D.compiled, b), s.id + ': bloco não compilado ' + b);
      }
      for (const c of s.commands) {
        for (const b of Object.keys(c.weights || {})) check(e, s.blocks.includes(b) && has(D.compiled, b), s.id + '/' + c.type + ': ' + b);
        for (const b of Object.keys(c.maxUses || {})) check(e, has(D.compiled, b), s.id + '/' + c.type + ' maxUses: ' + b);
        for (const b of Object.values(c.blocks || {})) check(e, has(D.compiled, b), s.id + '/' + c.type + ' blocks: ' + b);
      }
    }
    for (const u of vals(D.ufos)) {
      const c = D.compiled[u.block];
      const m = u.map;
      check(e, m.w >= c.w + 10 && m.h >= c.h + 10, u.id + ': mapa ' + m.w + '×' + m.h + ' sem margem para o bloco');
      check(e, m.d >= c.d, u.id + ': profundidade do mapa < bloco');
      check(e, Object.values(D.MAP_SIZES_UFO).some((s) => s[0] === m.w && s[1] === m.h), u.id + ': tamanho ' + m.w + '×' + m.h + ' não é tamanho de OVNI');
    }
    for (const c of vals(D.compiled)) {
      const pre = c.id.split('_')[0];
      check(e, pre === 'UFO' || pre === 'CRAFT' || TERRAINS.includes(pre), c.id + ': prefixo');
      check(e, has(D.tilesets, c.tileset), c.id + ': tileset ' + c.tileset);
    }
    for (const dep of vals(D.deployments)) {
      if (dep.map && dep.terrain) {
        const sz = Object.values(D.mapScripts[dep.terrain].sizes || {});
        check(e, sz.some((s) => s[0] === dep.map.w && s[1] === dep.map.h), dep.id + ': mapa ' + dep.map.w + '×' + dep.map.h + ' não está em mapScripts.' + dep.terrain + '.sizes');
      }
    }
    done(e, 'mapScripts');
  });

  t.test('crossref: papéis usados pela legenda existem em todos os tilesets', () => {
    const e = [];
    const roles = new Set();
    const addL = (L) => { for (const ch of Object.keys(L || {})) for (const p of ['floor', 'west', 'north', 'object']) if (L[ch][p]) roles.add(L[ch][p]); };
    addL(D.legend);
    addL(D.TERRAIN_LEGEND);
    for (const b of vals(D.blocks)) addL(b.legend);
    for (const r of roles) {
      if (r.includes('.')) { check(e, has(D.tileDefByKey, r), 'chave direta ' + r); continue; }
      check(e, D.TILE_ROLES.includes(r), 'papel desconhecido ' + r);
      for (const ts of vals(D.tilesets)) {
        const key = ts.roles[r];
        check(e, typeof key === 'string' && has(D.tileDefByKey, key), ts.id + ': papel ' + r + ' → ' + key);
        if (key) check(e, D.tileDefs[ts.ids[r]] && D.tileDefs[ts.ids[r]].key === key, ts.id + ': ids.' + r);
      }
    }
    // cadeias de destruição e portas fecham dentro da tabela
    for (const d of D.tileDefs) {
      if (!d) continue;
      check(e, d.die === 0 || !!D.tileDefs[d.die], d.key + ': die ' + d.die);
      check(e, !d.alt || !!D.tileDefs[d.alt], d.key + ': alt ' + d.alt);
      check(e, d.set === null || has(D.tilesets, d.set), d.key + ': set ' + d.set);
    }
    done(e, 'tilesets');
  });

  // ── textos ──
  t.test('crossref: todas as chaves *Key em OV.Data têm texto em OV.STR', () => {
    const e = [];
    const seen = new Set();
    let n = 0;
    const walk = (o, path, depth) => {
      if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o) || depth > 8) return;
      seen.add(o);
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && /Key$/.test(k)) { n++; check(e, v in OV.STR, path + '.' + k + ' = ' + v); }
        else if (v && typeof v === 'object') walk(v, path + '.' + k, depth + 1);
      }
    };
    for (const k of Object.keys(D)) if (k !== 'world' && k !== 'compiled') walk(D[k], k, 0);
    t.ok(n > 300, 'poucas chaves encontradas: ' + n);
    // chaves devolvidas por funções
    for (const r of [0, 50, 100, 200, 500, 1000, 5000]) for (let d = 0; d < 3; d++) check(e, D.ratingKey(r, d) in OV.STR, 'ratingKey ' + D.ratingKey(r, d));
    for (const [c, s, n2] of [[100, 0, 0], [100, 10, 5], [100, 50, 3], [100, 50, 10], [100, 50, 20], [100, 50, 40]]) check(e, D.progressLabelKey(c, s, n2) in OV.STR, 'progressLabelKey ' + D.progressLabelKey(c, s, n2));
    for (const tr of TERRAINS) check(e, ('terrain.' + tr) in OV.STR, 'terrain.' + tr);
    for (const a of D.altitudes) check(e, ('alt.' + a) in OV.STR, 'alt.' + a);
    for (const id of Object.keys(D.research)) check(e, ('research.' + id) in OV.STR, 'research.' + id);
    for (const d of D.DMG_IDS) check(e, ('dmg.' + d) in OV.STR, 'dmg.' + d);
    for (const r of Object.values(D.ufos)) check(e, OV.T(r.nameKey).indexOf('⟦') < 0, r.nameKey);
    done(e, 'textos');
  });

  t.test('crossref: textos em pt-PT sem formas brasileiras comuns', () => {
    const bad = /\b(equipe|tela|registro|trem|ônibus|celular|planejamento|time de|usuário|arquivo|aterrissa|aterrisagem|Sectóide|contato|fato de que)\b/i;
    const hits = Object.entries(OV.STR).filter(([k, v]) => typeof v === 'string' && bad.test(v)).map(([k, v]) => k + ' = ' + v);
    t.eq(hits, [], 'formas não pt-PT');
  });
};
