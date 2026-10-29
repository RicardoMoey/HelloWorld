/* Testes dos dados estratégicos: OVNIs, naves, dogfight, instalações, base inicial, investigação e fabrico */
module.exports = function (OV, t) {
  const D = OV.Data;

  // ids fixos partilhados entre ficheiros (tarefa de integração)
  const CORPSES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie'].map((r) => r + '_corpse');
  const FIXED_ITEMS = new Set([
    'pistol', 'pistol_clip', 'rifle', 'rifle_clip', 'heavy_cannon', 'hc_ap', 'hc_he', 'hc_in', 'auto_cannon', 'ac_ap', 'ac_he', 'ac_in',
    'rocket_launcher', 'small_rocket', 'large_rocket', 'incendiary_rocket', 'laser_pistol', 'laser_rifle', 'heavy_laser',
    'plasma_pistol', 'plasma_pistol_clip', 'plasma_rifle', 'plasma_rifle_clip', 'heavy_plasma', 'heavy_plasma_clip',
    'small_launcher', 'stun_bomb', 'blaster_launcher', 'blaster_bomb', 'stun_rod', 'grenade', 'smoke_grenade', 'proximity_grenade',
    'high_explosive', 'alien_grenade', 'electro_flare', 'medikit', 'motion_scanner', 'psi_amp', 'alien_alloys', 'elerium_115',
    'ufo_power_source', 'ufo_navigation', 'alien_food', 'alien_surgery', 'examination_room', 'alien_reproduction', 'alien_entertainment',
    'stingray', 'avalanche', 'cannon', 'laser_cannon', 'plasma_beam', 'fusion_ball',
    'stingray_missile', 'avalanche_missile', 'cannon_rounds', 'fusion_ball_missile',
  ].concat(CORPSES));
  const FIXED_ARMOURS = new Set(['coveralls', 'personal_armour', 'power_suit', 'flying_suit']);
  const all = () => true;

  t.test('dogfight: Stingray acerta 56 % num muito pequeno, 61 % num pequeno e 70 % num médio', () => {
    const acc = D.craftWeapons.stingray.acc;
    t.eq(D.dogfightHitChance(acc, D.ufos.small_scout.size), 56);
    t.eq(D.dogfightHitChance(acc, D.ufos.medium_scout.size), 61);
    t.eq(D.dogfightHitChance(acc, D.ufos.abductor.size), 70);
  });

  t.test('dogfight: tabela completa de acerto (REA §6.2, limitada a 100 %)', () => {
    const table = {
      stingray: [56, 61, 70, 88, 100],
      avalanche: [64, 70, 80, 100, 100],
      cannon: [20, 22, 25, 31, 50],
      laser_cannon: [28, 31, 35, 44, 70],
      plasma_beam: [40, 44, 50, 63, 100],
      fusion_ball: [80, 88, 100, 100, 100],
    };
    for (const w in table) for (let s = 0; s < 5; s++) t.eq(D.dogfightHitChance(D.craftWeapons[w].acc, s), table[w][s], w + ' tamanho ' + s);
  });

  t.test('dogfight: constantes orig', () => {
    const F = D.dogfight;
    t.eq([F.open, F.standoff, F.aggressive, F.disengage, F.approach, F.retreat, F.projectile, F.tickMs], [640, 560, 64, 800, 4, 4, 8, 30]);
    t.eq(F.modeOrder.length, 5);
    for (const m of F.modeOrder) t.ok(F.modes[m], 'modo ' + m);
  });

  t.test('OVNIs: números do §3.12', () => {
    const U = D.ufos;
    t.eq(Object.keys(U).sort(), ['abductor', 'battleship', 'harvester', 'large_scout', 'medium_scout', 'small_scout', 'supply_ship', 'terror_ship']);
    t.eq([U.small_scout.hp, U.small_scout.speed, U.small_scout.weapon.power, U.small_scout.breakOff, U.small_scout.score], [50, 2200, 0, 360, 50]); // breakOff ours (orig 200)
    t.eq([U.terror_ship.hp, U.terror_ship.weapon.power, U.terror_ship.weapon.range, U.terror_ship.weapon.reload], [1200, 120, 42, 24]);
    t.eq([U.battleship.size, U.battleship.scoreDestroyed, U.battleship.map.w, U.battleship.alloys], [4, 1400, 50, 36]);
    t.eq(U.abductor.weapon.reload, 32);
    for (const id in U) {
      const u = U[id];
      t.eq(u.scoreDestroyed, u.score * 2, id + ' destruído = ×2');
      t.eq(u.block, 'UFO_' + id.toUpperCase(), id + ' bloco');
      t.eq(u.deployment, 'dep_' + id, id + ' deployment');
      t.eq(u.visibility, [-30, -15, 0, 15, 30][u.size], id + ' visibilidade');
      t.ok(u.map.d === 3 && u.map.w >= u.blockSize.w + 10 && u.map.h >= u.blockSize.h + 10, id + ' mapa');
    }
  });

  t.test('OVNIs: recuperação (aterrado completo, caído ×0,7)', () => {
    t.eq(D.ufoRecovery('small_scout'), { ufo_power_source: 1, elerium_115: 50, ufo_navigation: 1, alien_alloys: 3 });
    const c = D.ufoRecovery('harvester', { crashed: true, powerSources: 0 });
    t.eq(c.alien_alloys, 11);
    t.eq(c.alien_food, 3);
    t.ok(!c.ufo_power_source && !c.elerium_115, 'sem fontes intactas');
  });

  t.test('naves: §3.13 e blocos de batalha só nos transportes', () => {
    const C = D.crafts;
    t.eq([C.skyranger.speed, C.skyranger.fuel, C.skyranger.seats, C.skyranger.buy, C.skyranger.score], [760, 1500, 14, 500000, 200]);
    t.eq([C.interceptor.speed, C.interceptor.weapons, C.interceptor.rent], [2100, 2, 600000]);
    t.eq([C.firestorm.speed, C.firestorm.fuel, C.firestorm.hp], [4200, 20, 500]);
    t.eq([C.avenger.speed, C.avenger.hp, C.avenger.score, C.avenger.spacecraft], [5400, 1200, 400, true]);
    t.eq(C.skyranger.block, 'CRAFT_SKYRANGER');
    t.eq(C.avenger.block, 'CRAFT_AVENGER');
    t.eq(C.interceptor.block, null);
    t.eq(C.firestorm.block, null);
    t.eq(D.craftFuelPer10Min('interceptor', 2100), 21);
    t.eq(D.craftFuelPer10Min('interceptor', 1050), 10);
    t.eq(D.craftFuelPer10Min('avenger', 5400), 1);
  });

  t.test('armas de nave também são itens de armazém', () => {
    for (const id in D.craftWeapons) {
      const w = D.craftWeapons[id];
      t.eq(D.items[w.item].kind, 'craft_weapon', id);
      if (w.ammoItem) {
        t.eq(D.items[w.ammoItem].kind, 'craft_ammo', w.ammoItem);
        t.eq(D.items[w.ammoItem].craftWeapon, id);
      } else t.ok(w.beam && w.ammoMax === null, id + ' feixe sem munição');
    }
    t.eq(D.items.cannon_rounds.rounds, 50);
    t.eq([D.items.stingray.buy, D.items.stingray_missile.buy, D.items.laser_cannon.buy], [16000, 3000, 0]);
  });

  t.test('instalações: dias = orig × 0,4 (mínimo 1), radares ours, portas de investigação', () => {
    for (const id in D.facilities) {
      const f = D.facilities[id];
      t.eq(f.days, Math.max(1, Math.round(f.daysOrig * 0.4)), id);
      if (f.research) t.ok(D.research[f.research], id + ' → ' + f.research);
    }
    t.eq([D.facilities.small_radar.radarRange, D.facilities.small_radar.radarChance], [1695, 15]);
    t.eq([D.facilities.large_radar.radarRange, D.facilities.large_radar.radarChance], [2577, 30]);
    t.eq([D.facilities.missile_defence.defence, D.facilities.missile_defence.hitRatio], [500, 50]);
    t.eq(D.facilities.hangar.size, 2);
  });

  t.test('base inicial ligada ao elevador na grelha 6×6', () => {
    const sb = D.startingBase;
    const r = D.gridConnected(sb.facilities);
    t.ok(r.ok, 'ligada: ' + JSON.stringify(r));
    let cells = 0;
    for (const f of sb.facilities) cells += D.facilityCells(f.type, f.x, f.y).length;
    t.eq(cells, 6 + 3 * 4);
    t.eq([sb.soldiers, sb.scientists, sb.engineers], [8, 10, 10]);
    t.eq([sb.stores.medikit, sb.stores.electro_flare], [3, 6]);
    // casos negativos
    const cut = sb.facilities.filter((f) => f.type !== 'general_stores' && f.type !== 'small_radar');
    t.eq(D.gridConnected(cut).ok, false, 'hangar (0,4) isolado');
    t.eq(D.gridConnected(sb.facilities.concat([{ type: 'laboratory', x: 3, y: 3 }])).reason, 'overlap');
    t.eq(D.gridConnected(sb.facilities.concat([{ type: 'hangar', x: 5, y: 0 }])).reason, 'outOfGrid');
    t.eq(D.gridConnected([{ type: 'laboratory', x: 0, y: 0 }]).reason, 'noLift');
  });

  t.test('manutenção mensal da base inicial ≈ $2,58 M', () => {
    const sb = D.startingBase;
    const u = D.monthlyUpkeep({ facilities: sb.facilities, soldiers: sb.soldiers, scientists: sb.scientists, engineers: sb.engineers, crafts: sb.crafts });
    t.eq(u.facilities, 169000);
    t.eq(u.salaries, 710000);
    t.eq(u.crafts, 1700000);
    t.eq(u.total, 2579000);
  });

  t.test('investigação: grafo de pré-requisitos sem ciclos (DAG)', () => {
    t.eq(D.researchCycle(), null);
    // ordenação topológica de Kahn cobre todos os tópicos
    const ids = Object.keys(D.research).filter((id) => !D.research[id].template);
    const indeg = {};
    for (const id of ids) indeg[id] = D.research[id].requires.length + D.research[id].requiresAny.length;
    const q = ids.filter((id) => indeg[id] === 0);
    let seen = 0;
    while (q.length) {
      const id = q.shift();
      seen++;
      for (const u of D.research[id].unlocks) if (--indeg[u] === 0) q.push(u);
    }
    t.eq(seen, ids.length);
  });

  t.test('investigação: caminho mínimo de vitória ≈ 1 525 dias-cientista (±5 %)', () => {
    // plano: fecho dos pré-requisitos de «Nave Suprema» (Vingador) e «Cidónia ou Desastre»
    const plan = new Set();
    const addClosure = (id) => {
      if (plan.has(id)) return;
      plan.add(id);
      const r = D.research[id];
      for (const d of r.requires) addClosure(d);
      if (r.requiresAny.length) addClosure(r.requiresAny.slice().sort((a, b) => D.research[a].cost - D.research[b].cost)[0]);
    };
    addClosure('ultimate_craft');
    addClosure('cydonia');
    const live = ['sectoid_soldier', 'sectoid_leader', 'sectoid_commander'];
    const researched = new Set();
    const flags = {};
    let spent = 0, interrogations = 0;
    for (let guard = 0; guard < 40 && !researched.has('cydonia'); guard++) {
      const avail = D.researchAvailable(researched, flags, all, live);
      let pick = avail.find((id) => plan.has(id));
      if (!pick) {
        // interrogatório mais barato que dê uma bandeira ainda em falta
        const opts = avail.filter((id) => id.startsWith('interrogate_') && D.researchEffects(id, researched, flags).flags.length);
        opts.sort((a, b) => D.researchTopic(a).cost - D.researchTopic(b).cost);
        pick = opts[0];
        interrogations++;
      }
      t.ok(pick, 'sem tópico disponível em ' + [...researched].join(','));
      const eff = D.researchEffects(pick, researched, flags);
      for (const f of eff.flags) flags[f] = true;
      researched.add(pick);
      spent += D.researchTopic(pick).cost;
    }
    t.ok(researched.has('cydonia') && researched.has('ultimate_craft'), 'vitória alcançável');
    t.ok(flags.cydoniaUnlocked, 'missão final desbloqueada');
    t.eq(interrogations, 3);
    t.near(spent, 1525, 1525 * 0.05, 'dias-cientista');
  });

  t.test('investigação: disponibilidade (itens, requiresAny, alienígenas vivos, bandeiras)', () => {
    t.eq(D.researchAvailable([], {}, {}, []), ['laser_weapons', 'medikit', 'motion_scanner']);
    const a = D.researchAvailable(new Set(['laser_weapons']), {}, { alien_alloys: 2, sectoid_corpse: 1, plasma_rifle_clip: 1 }, []);
    t.ok(a.includes('laser_pistol') && a.includes('alien_alloys') && a.includes('autopsy_sectoid') && a.includes('plasma_rifle'));
    t.ok(!a.includes('elerium') && !a.includes('plasma_cannon'));
    t.ok(D.researchAvailable(['plasma_rifle'], {}, {}, []).includes('plasma_cannon'), 'qualquer arma de plasma pesada/espingarda');
    const live = D.researchAvailable([], {}, {}, [{ type: 'sectoid_navigator' }, { type: 'civilian_m' }, { type: 'sectoid_navigator' }]);
    t.eq(live.filter((id) => id.startsWith('interrogate_')), ['interrogate_sectoid_navigator']);
    t.ok(!D.researchAvailable([], {}, {}, []).includes('alien_origins'));
    t.ok(D.researchAvailable([], { interrogated: true }, {}, []).includes('alien_origins'));
    t.ok(D.researchAvailable([], { navigatorInterrogated: true }, {}, []).includes('hyper_wave'));
    t.ok(!D.researchAvailable(['alien_origins'], { interrogated: true }, {}, []).includes('martian_solution'));
    t.ok(D.researchAvailable(['alien_origins'], { interrogated: true, leaderInterrogated: true }, {}, []).includes('martian_solution'));
  });

  t.test('interrogatório: custo por patente e bandeiras pela ordem orig', () => {
    t.eq(D.researchTopic('interrogate_sectoid_soldier').cost, 45);
    t.eq(D.researchTopic('interrogate_floater_leader').cost, 55);
    t.eq(D.researchTopic('interrogate_ethereal_commander').cost, 65);
    t.eq(D.researchTopic('interrogate_chryssalid').rank, 'terrorist');
    t.eq(D.researchTopic('interrogate_civilian_f'), null);
    t.eq(D.researchTopic('interrogate'), null, 'o modelo não é tópico');
    // líder antes de «Origens Alienígenas» não conta para a Solução Marciana…
    const e1 = D.researchEffects('interrogate_sectoid_leader', [], {});
    t.eq(e1.flags, ['interrogated']);
    t.eq(e1.points, 50);
    // …mas o mesmo tipo pode ser interrogado outra vez depois (sem becos sem saída)
    const done = ['interrogate_sectoid_leader', 'alien_origins'];
    t.ok(D.researchAvailable(done, { interrogated: true }, {}, ['sectoid_leader']).includes('interrogate_sectoid_leader'));
    t.ok(!D.researchAvailable(['interrogate_sectoid_soldier'], { interrogated: true }, {}, ['sectoid_soldier']).includes('interrogate_sectoid_soldier'));
    const e2 = D.researchEffects('interrogate_sectoid_leader', done, { interrogated: true });
    t.eq(e2.flags, ['leaderInterrogated']);
    t.eq(e2.points, 0, 'pontos só na primeira vez');
    const e3 = D.researchEffects('interrogate_muton_navigator', [], {});
    t.eq(e3.flags, ['interrogated', 'navigatorInterrogated']);
    const e4 = D.researchEffects('interrogate_snakeman_commander', ['alien_origins', 'martian_solution'], { interrogated: true });
    t.eq(e4.flags, ['leaderInterrogated', 'commanderInterrogated']);
    t.eq(D.researchEffects('interrogate_sectoid_engineer', [], {}).freeArticle, 'ufo');
    t.eq(D.researchEffects('interrogate_sectoid_medic', [], {}).freeArticle, 'race');
    t.eq(D.researchEffects('interrogate_sectoid_soldier', [], {}).consumes, { liveAlien: 'sectoid_soldier' });
    const fin = D.researchEffects('cydonia', ['martian_solution'], { commanderInterrogated: true });
    t.ok(fin.finalMission && fin.flags.includes('cydoniaUnlocked'));
    t.eq(D.researchEffects('martian_solution', [], {}).flags, ['martianSolution']);
  });

  t.test('investigação: item consumido ao começar', () => {
    t.eq(D.researchConsumable('plasma_pistol', { plasma_pistol_clip: 3 }), 'plasma_pistol_clip');
    t.eq(D.researchConsumable('plasma_pistol', { plasma_pistol: 1, plasma_pistol_clip: 3 }), 'plasma_pistol');
    t.eq(D.researchConsumable('laser_weapons', {}), null);
    t.eq(D.researchConsumable('autopsy_zombie', (id) => id === 'zombie_corpse'), 'zombie_corpse');
  });

  t.test('rótulos de progresso (§3.15)', () => {
    t.eq(D.progressLabelKey(100, 50, 0), 'research.progress.none');
    t.eq(D.progressLabelKey(100, 33, 50), 'research.progress.unknown');
    t.eq(D.progressLabelKey(100, 34, 7), 'research.progress.poor');
    t.eq(D.progressLabelKey(100, 34, 8), 'research.progress.average');
    t.eq(D.progressLabelKey(100, 60, 13), 'research.progress.average');
    t.eq(D.progressLabelKey(100, 60, 25), 'research.progress.good');
    t.eq(D.progressLabelKey(100, 60, 26), 'research.progress.excellent');
  });

  t.test('fabrico: desbloqueio, materiais e Elerium nunca fabricado', () => {
    t.eq(D.manufactureAvailable([]), []);
    t.eq(D.manufactureAvailable(['laser_pistol', 'medikit']), ['laser_pistol', 'medikit']);
    t.eq(D.manufactureAvailable(['plasma_pistol']), ['plasma_pistol', 'plasma_pistol_clip']);
    const M = D.manufacture;
    t.eq([M.firestorm.hours, M.firestorm.cost, M.firestorm.materials], [1400, 400000, { alien_alloys: 25, ufo_power_source: 1, ufo_navigation: 1 }]);
    t.eq(M.avenger.produces, { craft: 'avenger', n: 1 });
    t.ok(M.avenger.needsHangar && !M.laser_rifle.needsHangar);
    t.eq(M.personal_armour.produces, { item: 'personal_armour', armour: 'personal_armour', n: 1 });
    t.ok(!M.elerium_115 && !Object.values(M).some((m) => m.produces.item === 'elerium_115'));
    t.eq(D.research.ultimate_craft.enables.manufacture, ['avenger']);
    t.eq(D.research.laser_defense.enables.facilities, ['laser_defence']);
    t.eq(D.research.new_fighter.enables.crafts, ['firestorm']);
  });

  t.test('referências a itens/armaduras usam só os ids fixos', () => {
    const bad = [];
    const item = (id, where) => { if (!FIXED_ITEMS.has(id)) bad.push(where + ':' + id); };
    for (const id in D.research) {
      const r = D.research[id];
      if (r.template) continue;
      for (const it of (r.needItem || []).concat(r.items)) item(it, id);
      for (const a of r.armours) if (!FIXED_ARMOURS.has(a)) bad.push(id + ':' + a);
    }
    for (const id in D.manufacture) {
      const m = D.manufacture[id];
      for (const it in m.materials) item(it, id);
      if (m.produces.armour) {
        if (!FIXED_ARMOURS.has(m.produces.armour) || m.produces.item !== m.produces.armour) bad.push(id + ':' + m.produces.armour);
      } else if (m.produces.item) item(m.produces.item, id);
    }
    for (const id in D.ufos) for (const it in D.ufos[id].artefacts) item(it, id);
    const sb = D.startingBase;
    for (const it in sb.stores) item(it, 'stores');
    for (const c of sb.crafts) for (const it in c.cargo) item(it, c.type);
    for (const it in D.sellPrices) if (!FIXED_ARMOURS.has(it)) item(it, 'sell');
    t.eq(bad, []);
    t.eq(D.validateStrategy({ quiet: true }), []);
  });

  t.test('todas as nameKeys dos dados estratégicos têm texto', () => {
    const miss = [];
    const chk = (k) => { if (!OV.T.has(k)) miss.push(k); };
    for (const tab of [D.ufos, D.crafts, D.craftWeapons, D.facilities, D.research]) for (const id in tab) chk(tab[id].nameKey);
    for (const id in D.ufos) chk(D.ufos[id].sizeKey);
    for (const id in D.items) if (/^craft_/.test(D.items[id].kind)) chk(D.items[id].nameKey);
    for (const u of D.interrogableUnits()) chk(D.researchTopic(D.interrogationId(u)).nameKey);
    for (const r of ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal']) for (const k of D.ALIEN_RANKS) if (k !== 'terrorist') chk('research.interrogate_' + r + '_' + k);
    for (const u of D.TERROR_UNITS) chk('research.interrogate_' + u);
    for (const k of ['none', 'unknown', 'poor', 'average', 'good', 'excellent']) chk('research.progress.' + k);
    for (const id in D.research) chk('research.cat.' + D.research[id].cat);
    for (const id in D.manufacture) {
      const m = D.manufacture[id];
      chk('base.prod.cat.' + m.cat);
      // nomes de itens comuns vêm de outro ficheiro; aqui só as naves e as armas de nave
      if (m.produces.craft || (D.items[id] && /^craft_/.test(D.items[id].kind))) chk(m.nameKey);
    }
    chk(D.startingBase.nameKey);
    t.eq(miss, []);
  });
};
