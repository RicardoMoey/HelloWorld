/* Testes das regras de combate: itens, armaduras, unidades, raças, tripulações, armamento alienígena,
   geração de soldados e textos pt-PT (js/data/items.js, js/data/units.js, js/i18n/pt-PT.data.js) */
module.exports = function (OV, t) {
  const D = OV.Data;
  const keys = (o) => Object.keys(o || {});
  const has = (k) => OV.STR[k] !== undefined;

  const CORE_ITEMS = [
    'pistol', 'pistol_clip', 'rifle', 'rifle_clip', 'heavy_cannon', 'hc_ap', 'hc_he', 'hc_in', 'auto_cannon', 'ac_ap', 'ac_he', 'ac_in',
    'rocket_launcher', 'small_rocket', 'large_rocket', 'incendiary_rocket', 'laser_pistol', 'laser_rifle', 'heavy_laser', 'plasma_pistol',
    'plasma_pistol_clip', 'plasma_rifle', 'plasma_rifle_clip', 'heavy_plasma', 'heavy_plasma_clip', 'small_launcher', 'stun_bomb',
    'blaster_launcher', 'blaster_bomb', 'stun_rod', 'grenade', 'smoke_grenade', 'proximity_grenade', 'high_explosive', 'alien_grenade',
    'electro_flare', 'medikit', 'motion_scanner', 'psi_amp', 'alien_alloys', 'elerium_115', 'ufo_power_source', 'ufo_navigation',
    'alien_food', 'alien_surgery', 'examination_room', 'alien_reproduction', 'alien_entertainment',
    'sectoid_corpse', 'floater_corpse', 'snakeman_corpse', 'muton_corpse', 'ethereal_corpse', 'cyberdisc_corpse', 'sectopod_corpse',
    'reaper_corpse', 'chryssalid_corpse', 'zombie_corpse',
  ];
  const RACES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'mixed'];
  const ARANKS = ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier', 'terrorist'];
  const COUNTRIES = ['usa', 'canada', 'brazil', 'uk', 'france', 'germany', 'italy', 'spain', 'russia', 'egypt', 'nigeria', 'south_africa', 'india', 'china', 'japan', 'australia'];
  const UNITS = [
    'sectoid_soldier', 'sectoid_engineer', 'sectoid_medic', 'sectoid_navigator', 'sectoid_leader', 'sectoid_commander',
    'floater_soldier', 'floater_engineer', 'floater_medic', 'floater_navigator', 'floater_leader', 'floater_commander',
    'snakeman_soldier', 'snakeman_engineer', 'snakeman_navigator', 'snakeman_leader', 'snakeman_commander',
    'muton_soldier', 'muton_engineer', 'muton_navigator', 'ethereal_soldier', 'ethereal_leader', 'ethereal_commander',
    'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f',
  ];
  // contagem fixa de números aleatórios: rng de teste que devolve sempre o mínimo / máximo
  const fixedRng = (hi) => ({
    int: (a, b) => (hi ? b : a), pct: () => hi, pick: (arr) => arr[hi ? arr.length - 1 : 0], weighted: (o) => keys(o)[0],
  });

  t.test('todos os ids fixos de itens, unidades, raças e armaduras existem', () => {
    for (const id of CORE_ITEMS) t.ok(D.items[id], 'item ' + id);
    for (const id of UNITS) t.ok(D.units[id], 'unit ' + id);
    for (const id of RACES) t.ok(D.races[id], 'race ' + id);
    for (const id of ['coveralls', 'personal_armour', 'power_suit', 'flying_suit']) t.ok(D.armours[id], 'armour ' + id);
    for (const id of keys(D.items)) t.eq(D.items[id].id, id);
    for (const id of keys(D.units)) t.eq(D.units[id].id, id);
  });

  t.test('referências: munições, cadáveres, armas embutidas, armaduras de armazém', () => {
    for (const id of keys(D.items)) {
      const it = D.items[id];
      if (it.kind === 'firearm' && it.ammo) {
        for (const a of it.ammo) {
          t.eq(D.items[a] && D.items[a].kind, 'ammo', id + ' → ' + a);
          t.ok(D.items[a].usedBy.indexOf(id) >= 0, 'usedBy ' + a);
        }
      }
      if (it.kind === 'ammo') t.ok(it.usedBy.length > 0, 'munição sem arma: ' + id);
      if (it.kind === 'armour') t.ok(D.armours[it.suit], 'fato ' + id);
    }
    for (const id of keys(D.units)) {
      const u = D.units[id];
      t.eq(D.items[u.corpse] && D.items[u.corpse].kind, 'corpse', 'cadáver de ' + id);
      if (u.weapon) t.ok(D.items[u.weapon].fixed, 'arma embutida ' + id);
    }
    for (const id of keys(D.armours)) {
      const a = D.armours[id];
      if (a.storeItem) t.eq(D.items[a.storeItem].suit, id);
      t.ok(D.items[a.corpse], 'cadáver de soldado');
    }
    t.eq(D.armours.coveralls.storeItem, null);
  });

  t.test('raças: cada patente resolve para uma unidade alienígena', () => {
    for (const r of RACES) {
      for (const rank of ARANKS) {
        for (const pick of [0, 1]) {
          const u = D.raceUnit(r, rank, pick);
          t.ok(u && D.units[u] && D.units[u].side === 'alien', r + '/' + rank + '/' + pick + ' → ' + u);
        }
      }
    }
    t.eq(D.raceUnit('sectoid', 'terrorist', 1), 'cyberdisc');
    t.eq(D.raceUnit('floater', 'terrorist', 0), 'reaper');
    t.eq(D.raceUnit('snakeman', 'medic'), 'snakeman_soldier');
    t.eq(D.raceUnit('snakeman', 'terrorist', 0), 'chryssalid');
    t.eq(D.raceUnit('muton', 'commander'), 'muton_soldier');
    t.eq(D.raceUnit('muton', 'terrorist', 1), 'muton_soldier');
    t.eq(D.raceUnit('ethereal', 'navigator'), 'ethereal_leader');
    t.eq(D.raceUnit('ethereal', 'terrorist', 0), 'sectopod');
    t.eq(D.raceUnit('nao_existe', 'soldier'), null);
  });

  t.test('tripulações: patentes válidas e unidades resolvidas para todas as raças', () => {
    for (const id of keys(D.deployments)) {
      const dep = D.deployments[id];
      t.eq(dep.id, id);
      for (const row of dep.rows) {
        t.ok(ARANKS.indexOf(row.rank) >= 0, id + ': ' + row.rank);
        t.ok(D.ranks.alien[row.rank], 'patente alienígena ' + row.rank);
        const races = dep.race ? [dep.race] : RACES.filter((r) => r !== 'mixed');
        for (const r of races) for (const pick of [0, 1]) t.ok(D.units[D.rowUnit(dep, row, r, pick)], id + '/' + r + '/' + row.rank);
        t.eq([row.min, row.max], row.qty[0]);
      }
    }
    const cyd = D.deployments.dep_cydonia;
    const units = cyd.rows.map((r) => D.rowUnit(cyd, r, 'sectoid', 0)).sort();
    t.eq(units, ['chryssalid', 'ethereal_commander', 'ethereal_leader', 'ethereal_soldier', 'muton_soldier', 'sectopod']);
    t.eq(D.deployments.dep_terror_site.civilians, [10, 14]);
    t.eq(D.deployments.dep_alien_base.map, { w: 40, h: 40, d: 2 });
    t.eq(D.deployments.dep_small_scout.ufo, 'small_scout');
  });

  t.test('tripulações: totais por dificuldade = tabela §3.12', () => {
    const EXPECT = {
      dep_small_scout: [[1, 1], [1, 2], [2, 2]],
      dep_medium_scout: [[3, 4], [4, 5], [5, 6]],
      dep_large_scout: [[4, 5], [5, 6], [6, 8]],
      dep_harvester: [[7, 8], [8, 10], [10, 12]],
      dep_abductor: [[7, 9], [8, 10], [10, 12]],
      dep_supply_ship: [[8, 9], [10, 11], [12, 13]],
      dep_terror_ship: [[9, 9], [11, 11], [13, 13]],
      dep_battleship: [[10, 12], [12, 14], [14, 16]],
      dep_terror_site: [[5, 5], [5, 7], [7, 9]],
      dep_alien_base: [[8, 8], [8, 9], [11, 12]],
      dep_cydonia: [[7, 7], [9, 9], [14, 14]],
    };
    t.eq(keys(D.deployments).sort(), keys(EXPECT).sort());
    for (const id in EXPECT) {
      for (let d = 0; d < 3; d++) {
        const r = D.deploymentRange(id, d);
        t.eq([r.min, r.max], EXPECT[id][d], id + ' dif ' + d);
      }
      t.eq(D.deployments[id].totals, EXPECT[id]);
    }
    // comandantes garantidos nas missões que abrem o caminho para Cidónia
    for (const id of ['dep_battleship', 'dep_alien_base']) t.ok(D.deployments[id].rows.some((r) => r.rank === 'commander' && r.qty[0][0] >= 1), id);
  });

  t.test('percentagem fora do OVNI por patente (§3.12)', () => {
    const rows = D.deployments.dep_harvester.rows;
    const out = {};
    for (const r of rows) out[r.rank] = r.outside;
    t.eq(out, { soldier: 50, navigator: 20, engineer: 20, medic: 20, leader: 0 });
    t.eq(D.deployments.dep_battleship.rows.find((r) => r.rank === 'terrorist').outside, 50);
    t.eq(D.deployments.dep_battleship.rows.find((r) => r.rank === 'commander').outside, 0);
  });

  t.test('armas: precisão e UT dos modos (§3.5)', () => {
    const m = (id) => {
      const o = {};
      for (const x of D.weaponModes(id)) o[x.mode] = [x.acc, x.tu, x.shots];
      return o;
    };
    t.eq(m('rifle'), { snap: [60, 25, 1], aimed: [110, 80, 1], auto: [35, 35, 3] });
    t.eq(m('pistol'), { snap: [60, 18, 1], aimed: [78, 30, 1] });
    t.eq(m('heavy_cannon'), { snap: [60, 33, 1], aimed: [90, 80, 1] });
    t.eq(m('auto_cannon'), { snap: [56, 33, 1], aimed: [82, 80, 1], auto: [32, 40, 3] });
    t.eq(m('rocket_launcher'), { snap: [55, 45, 1], aimed: [115, 75, 1] });
    t.eq(m('laser_pistol'), { snap: [40, 20, 1], aimed: [68, 55, 1], auto: [28, 25, 3] });
    t.eq(m('laser_rifle'), { snap: [65, 25, 1], aimed: [100, 50, 1], auto: [46, 34, 3] });
    t.eq(m('heavy_laser'), { snap: [50, 33, 1], aimed: [84, 75, 1] });
    t.eq(m('plasma_pistol'), { snap: [65, 30, 1], aimed: [85, 60, 1], auto: [50, 30, 3] });
    t.eq(m('plasma_rifle'), { snap: [86, 30, 1], aimed: [100, 60, 1], auto: [55, 36, 3] });
    t.eq(m('heavy_plasma'), { snap: [75, 30, 1], aimed: [110, 60, 1], auto: [50, 35, 3] });
    t.eq(m('small_launcher'), { snap: [65, 40, 1], aimed: [110, 75, 1] });
    t.eq(m('blaster_launcher'), { aimed: [120, 66, 1] });
    t.eq(D.items.blaster_launcher.guided, { acc: 60, alienAcc: 55 });
    t.eq(m('cyberdisc_weapon'), { snap: [75, 30, 1], aimed: [110, 60, 1] });
    t.eq(m('sectopod_weapon'), { snap: [75, 30, 1], aimed: [110, 60, 1], auto: [50, 35, 3] });
    t.eq(m('stun_rod'), { melee: [100, 30, 1] });
    const claw = D.weaponModes('chryssalid_weapon')[0];
    t.eq([claw.mode, claw.tu, claw.flat], ['melee', 15, true]);
    t.eq(D.weaponModes('grenade').map((x) => [x.mode, x.tu]), [['prime', 50], ['throw', 25]]);
    t.eq(D.weaponModes('electro_flare').map((x) => x.mode), ['throw']);
    t.eq(D.weaponModes('sectoid_corpse'), []);
    t.eq(D.weaponModes('nao_existe'), []);
  });

  t.test('munições, explosivos e equipamento (§3.5–3.6)', () => {
    const p = (id) => [D.items[id].power, D.items[id].dmg, D.items[id].rounds];
    t.eq(p('rifle_clip'), [30, 'AP', 20]);
    t.eq(p('pistol_clip'), [26, 'AP', 12]);
    t.eq(p('hc_ap'), [56, 'AP', 6]);
    t.eq(p('ac_ap'), [42, 'AP', 14]);
    t.eq(p('plasma_pistol_clip'), [52, 'PLASMA', 26]);
    t.eq(p('plasma_rifle_clip'), [80, 'PLASMA', 28]);
    t.eq(p('heavy_plasma_clip'), [115, 'PLASMA', 35]);
    t.eq([D.items.hc_he.radius, D.items.hc_in.radius, D.items.small_rocket.radius, D.items.large_rocket.radius, D.items.incendiary_rocket.radius], [2, 3, 3, 5, 4]);
    t.eq([D.items.stun_bomb.power, D.items.stun_bomb.dmg, D.items.stun_bomb.radius], [90, 'STUN', 4]);
    t.eq([D.items.blaster_bomb.power, D.items.blaster_bomb.radius], [200, 10]);
    t.eq([D.items.grenade.power, D.items.grenade.radius, D.items.grenade.buy], [50, 5, 300]);
    t.eq([D.items.smoke_grenade.dmg, D.items.high_explosive.power, D.items.alien_grenade.power], ['SMOKE', 110, 90]);
    t.eq(D.items.proximity_grenade.phase, 'P1');
    t.eq([D.items.grenade.fuseMax, D.items.smoke_grenade.smokeMin, D.items.smoke_grenade.smokeMax], [5, 7, 15]);
    t.eq(D.items.electro_flare.light, 15);
    t.eq([D.items.laser_rifle.power, D.items.laser_rifle.dmg, D.items.laser_rifle.ammo], [60, 'LASER', null]);
    const mk = D.items.medikit;
    t.eq([mk.charges.heal, mk.charges.stim, mk.charges.pain, mk.healHP, mk.stimEnergy, mk.stimStun, mk.useTU], [10, 10, 10, 3, 10, 4, 10]);
    t.eq(D.weaponModes('motion_scanner')[0].tu, 25);
    t.eq([D.items.stun_rod.power, D.items.stun_rod.dmg, D.items.stun_rod.skill], [65, 'STUN', false]);
    t.eq(D.items.chryssalid_weapon.zombify, 'zombie');
    t.ok(D.items.reaper_weapon.strengthPower);
  });

  t.test('armazém: preços, espaço, armadura do item e pontos de recuperação', () => {
    const it = D.items;
    t.eq([it.rifle.buy, it.rifle.sell, it.rifle.storage], [3000, 2250, 0.2]);
    t.eq([it.pistol.buy, it.pistol_clip.buy, it.heavy_cannon.buy, it.auto_cannon.buy, it.rocket_launcher.buy], [800, 70, 6400, 13500, 4000]);
    t.eq([it.stun_rod.buy, it.electro_flare.buy, it.smoke_grenade.buy, it.high_explosive.buy], [1260, 60, 150, 1500]);
    t.eq([it.plasma_rifle.buy, it.plasma_rifle.sell, it.heavy_plasma.sell, it.elerium_115.sell, it.alien_alloys.sell], [0, 126500, 171600, 5000, 6500]);
    t.eq([it.ufo_power_source.sell, it.ufo_navigation.sell, it.sectoid_corpse.sell], [250000, 80000, 20000]);
    t.eq([it.personal_armour.storage, it.ufo_power_source.storage, it.sectoid_corpse.storage], [0.8, 0.7, 0.4]);
    // resistência no chão: 20 por omissão, cadáveres 26, sinalizador 8, plasma 45–50
    t.eq([it.rifle.armour, it.sectoid_corpse.armour, it.electro_flare.armour, it.plasma_pistol.armour, it.heavy_plasma.armour], [20, 26, 8, 45, 50]);
    t.eq([it.ufo_power_source.recoveryPoints, it.ufo_navigation.recoveryPoints, it.sectoid_corpse.recoveryPoints, it.chryssalid_corpse.recoveryPoints], [20, 5, 5, 3]);
    t.eq([it.plasma_pistol.recoveryPoints, it.plasma_rifle.recoveryPoints, it.heavy_plasma.recoveryPoints, it.alien_food.recoveryPoints, it.alien_alloys.recoveryPoints], [3, 4, 5, 2, 1]);
    t.eq([it.elerium_115.recoveryPoints, it.elerium_115.recoveryPer], [5, 50]);
    for (const id of CORE_ITEMS) {
      const x = it[id];
      t.ok(x.buy >= 0 && x.sell >= 0 && x.storage >= 0, 'preços ' + id);
      if (x.kind === 'corpse') t.eq(x.topic, 'autopsy_' + x.species);
    }
    t.eq(it.soldier_corpse.recover, false);
    t.eq(it.cyberdisc_corpse.carry, false);
  });

  t.test('investigação que desbloqueia cada item (ids do §3.15)', () => {
    const it = D.items;
    t.eq([it.rifle.research, it.grenade.research, it.electro_flare.research], [null, null, null]);
    t.eq([it.laser_pistol.research, it.laser_rifle.research, it.heavy_laser.research], ['laser_pistol', 'laser_rifle', 'heavy_laser']);
    t.eq([it.plasma_pistol_clip.research, it.stun_bomb.research, it.blaster_bomb.research], ['plasma_pistol', 'small_launcher', 'blaster_launcher']);
    t.eq([it.medikit.research, it.motion_scanner.research, it.alien_grenade.research], ['medikit', 'motion_scanner', 'alien_grenade']);
    t.eq([it.ufo_power_source.research, it.ufo_navigation.research, it.elerium_115.topic, it.alien_alloys.topic], ['power_source', 'ufo_navigation', 'elerium', 'alien_alloys']);
    t.eq([D.armours.personal_armour.research, D.armours.power_suit.research, D.armours.flying_suit.research], ['personal_armour', 'power_suit', 'flying_suit']);
    // quando a tabela de investigação existe, os tópicos do MVP têm de existir lá
    if (keys(D.research).length) {
      for (const id of keys(D.items)) {
        const x = D.items[id];
        if (x.phase !== 'MVP') continue;
        if (x.research) t.ok(D.research[x.research], id + ': research ' + x.research);
        if (x.topic) t.ok(D.research[x.topic], id + ': topic ' + x.topic);
      }
      for (const id of keys(D.armours)) if (D.armours[id].research) t.ok(D.research[D.armours[id].research], 'armour ' + id);
    }
  });

  t.test('tamanhos de inventário e duas mãos (§3.7)', () => {
    const s = D.itemSize;
    t.eq([s('rifle_clip'), s('grenade'), s('electro_flare'), s('motion_scanner'), s('stun_bomb')], [1, 1, 1, 1, 1]);
    t.eq([s('pistol'), s('medikit'), s('stun_rod'), s('laser_pistol'), s('plasma_pistol')], [2, 2, 2, 2, 2]);
    t.eq([s('rifle'), s('laser_rifle'), s('small_rocket'), s('plasma_rifle')], [3, 3, 3, 3]);
    t.eq([s('heavy_cannon'), s('auto_cannon'), s('rocket_launcher'), s('heavy_plasma'), s('blaster_launcher'), s('sectoid_corpse')], [4, 4, 4, 4, 4, 4]);
    t.eq(s('nao_existe'), 0);
    t.eq([D.isTwoHanded('rifle'), D.isTwoHanded('pistol'), D.isTwoHanded('heavy_plasma'), D.isTwoHanded('plasma_pistol'), D.isTwoHanded('stun_rod')], [true, false, true, false, true]);
    for (const id of keys(D.items)) {
      const x = D.items[id];
      if (x.battle) t.ok(x.size >= 1 && x.size <= 4, 'size ' + id);
    }
  });

  t.test('inventário: capacidades e tabela de UT', () => {
    const S = D.invSlots;
    t.eq([S.R.maxItems, S.L.maxItems, S.belt.capacity, S.belt.maxSize, S.pack.capacity, S.pack.maxSize], [1, 1, 4, 2, 9, 3]);
    const m = D.invMoveTU;
    t.eq([m('R', 'L'), m('R', 'belt'), m('R', 'pack'), m('R', 'ground')], [4, 8, 14, 2]);
    t.eq([m('belt', 'R'), m('belt', 'L'), m('belt', 'pack'), m('belt', 'ground')], [4, 4, 16, 6]);
    t.eq([m('pack', 'R'), m('pack', 'belt'), m('pack', 'ground')], [8, 12, 10]);
    t.eq([m('ground', 'L'), m('ground', 'belt'), m('ground', 'pack')], [8, 12, 20]);
    t.eq([m('belt', 'belt'), m('x', 'R')], [0, null]);
    const f = D.fitsSlot;
    t.ok(f('rifle', 'R', []));
    t.ok(!f('rifle', 'R', ['pistol']), 'mão ocupada');
    t.ok(!f('rifle', 'belt', []), 'espingarda não cabe no cinto');
    t.ok(f('rifle', 'pack', []));
    t.ok(!f('heavy_plasma', 'pack', []), 'armas pesadas só nas mãos');
    t.ok(f('rifle_clip', 'belt', ['grenade', 'grenade', 'rifle_clip']), 'cinto com 3 de 4 unidades');
    t.ok(!f('pistol', 'belt', ['grenade', 'grenade', 'rifle_clip']), 'cinto cheio');
    t.ok(!f('cyberdisc_weapon', 'R', []), 'arma embutida');
    t.ok(!f('cyberdisc_corpse', 'R', []), 'cadáver 2×2');
    t.ok(!f('alien_alloys', 'ground', []), 'material não existe em batalha');
    t.ok(f('sectoid_corpse', 'L', []));
  });

  t.test('alcance de arremesso (§3.6)', () => {
    t.eq(D.throwRange(20, 3), 13);
    t.eq(D.throwRange(30, 3), 18);
    t.eq(D.throwRange(20, 6), 8);
    t.eq(D.throwRange(40, 6), 17);
    t.eq(D.throwRange(5, 30), 3, 'mínimo 3');
    t.eq(D.throwRange(70, 0), 18, 'máximo 18');
  });

  t.test('armaduras de soldado e modificadores (§3.8)', () => {
    const A = D.armours;
    t.eq([A.coveralls.front, A.coveralls.side, A.coveralls.rear, A.coveralls.under], [12, 8, 5, 2]);
    t.eq([A.personal_armour.front, A.power_suit.front, A.flying_suit.under], [50, 100, 70]);
    t.eq([A.coveralls.mods.MELEE, A.coveralls.mods.ACID, A.coveralls.mods.AP], [120, 160, 100]);
    t.eq([A.personal_armour.mods.IN, A.personal_armour.mods.STUN, A.personal_armour.mods.ACID], [80, 90, 110]);
    t.eq([A.power_suit.mods.IN, A.power_suit.mods.SMOKE, A.flying_suit.mods.STUN], [0, 0, 80]);
    t.eq([A.flying_suit.flight, A.power_suit.flight], [true, false]);
    t.eq(D.soldierArmour('personal_armour'), [50, 40, 40, 30, 30]);
    for (const id of keys(A)) t.eq(keys(A[id].mods).sort(), D.DMG_IDS.slice().sort(), 'mods completos ' + id);
  });

  t.test('alienígenas: atributos, armadura e modificadores (§3.9)', () => {
    const U = D.units;
    t.eq(U.sectoid_soldier.stats, { tu: 54, sta: 90, hp: 30, brav: 80, react: 63, fire: 52, thr: 58, str: 30, melee: 76, psiStr: 40, psiSkill: 0 });
    t.eq([U.sectoid_commander.stats.psiStr, U.sectoid_commander.stats.psiSkill, U.sectoid_commander.value, U.sectoid_commander.psi], [50, 60, 25, true]);
    t.eq([U.floater_commander.armour.front, U.floater_commander.armour.side, U.floater_commander.move], [24, 18, 'fly']);
    t.eq([U.muton_engineer.armour.front, U.muton_engineer.armour.mods.AP, U.muton_soldier.stats.hp], [28, 60, 125]);
    t.eq([U.snakeman_leader.armour.side, U.snakeman_commander.stats.tu, U.snakeman_soldier.armour.mods.IN], [24, 45, 70]);
    t.eq([U.ethereal_commander.armour.front, U.ethereal_commander.armour.mods.STUN, U.ethereal_soldier.stats.psiSkill], [45, 80, 40]);
    t.eq([U.cyberdisc.size, U.cyberdisc.weapon, U.cyberdisc.capturable], [2, 'cyberdisc_weapon', false]);
    t.eq(U.cyberdisc.explodeOnDeath, { power: 120, dmg: 'HE', radius: 6 });
    t.eq([U.sectopod.armour.front, U.sectopod.armour.mods.LASER, U.sectopod.armour.mods.PLASMA], [145, 150, 80]);
    t.eq([U.reaper.armour.mods.IN, U.reaper.size, U.reaper.stats.hp], [170, 2, 148]);
    t.eq([U.chryssalid.stats.tu, U.chryssalid.weapon, U.zombie.spawnOnDeath, U.zombie.armour.mods.STUN], [110, 'chryssalid_weapon', 'chryssalid', 0]);
    t.eq([U.civilian_f.female, U.civilian_m.side, U.civilian_m.stats.tu, U.civilian_m.armour.mods.SMOKE], [true, 'civ', 35, 100]);
    for (const id of keys(U)) {
      const u = U[id];
      t.eq(keys(u.armour.mods).sort(), D.DMG_IDS.slice().sort(), 'mods ' + id);
      if (u.side === 'alien') t.eq(u.armour.mods.SMOKE, 0, 'imune ao fumo ' + id);
      t.ok(u.value > 0 && u.int > 0, 'valor/int ' + id);
    }
  });

  t.test('dificuldade: crescimento e «Recruta» com Pontaria e armadura ×0,5', () => {
    const s0 = D.alienStats('sectoid_soldier', 0), s2 = D.alienStats('sectoid_soldier', 2), s1 = D.alienStats('sectoid_soldier', 1);
    t.eq([s0.tu, s0.fire, s0.react], [54, 26, 63]);
    t.eq([s1.tu, s1.fire, s1.react, s1.hp], [58, 58, 70, 30]);
    t.eq([s2.tu, s2.fire, s2.react, s2.str, s2.melee], [62, 64, 78, 32, 88]);
    t.eq(D.alienStats('civilian_m', 2).tu, 35, 'civis não crescem');
    t.eq(D.alienArmour('sectopod', 0), [72, 65, 65, 50, 45]);
    t.eq(D.alienArmour('sectopod', 1), [145, 130, 130, 100, 90]);
    t.eq(D.units.sectoid_soldier.stats.fire, 52, 'tabela não é alterada');
  });

  t.test('armamento alienígena por mês (§3.9)', () => {
    const T = D.alienItemTiers;
    t.eq(T.byMonth, [[90, 10, 0], [70, 25, 5], [45, 40, 15], [30, 50, 20], [0, 30, 70]]);
    for (const row of T.byMonth) t.eq(row.reduce((a, b) => a + b, 0), 100);
    const rng = OV.RNG.create(1234);
    const n = [0, 0, 0];
    for (let i = 0; i < 4000; i++) n[D.rollItemTier(0, rng)]++;
    t.near(n[0] / 4000, 0.9, 0.03, 'mês 0 nível 0');
    t.eq(n[2], 0, 'mês 0 sem nível 2');
    const m9 = [0, 0, 0];
    for (let i = 0; i < 1000; i++) m9[D.rollItemTier(9, rng)]++;
    t.eq(m9[0], 0, 'mês 4+ sem nível 0');
    // extremos do rng: 1 ⇒ primeiro nível com peso, 100 ⇒ último
    t.eq([D.rollItemTier(3, fixedRng(false)), D.rollItemTier(3, fixedRng(true))], [0, 2]);
    // conjuntos e extras
    const lo = fixedRng(false), hi = fixedRng(true);
    t.eq(D.alienLoadout('sectoid_soldier', 'dep_small_scout', 0, hi), ['plasma_pistol', 'plasma_pistol_clip', 'plasma_pistol_clip']);
    t.eq(D.alienLoadout('sectoid_navigator', 'dep_medium_scout', 1, hi), ['plasma_rifle', 'plasma_rifle_clip', 'plasma_rifle_clip', 'alien_grenade']);
    t.eq(D.alienLoadout('sectoid_navigator', 'dep_medium_scout', 1, lo), ['plasma_rifle', 'plasma_rifle_clip', 'plasma_rifle_clip']);
    t.eq(D.alienLoadout('sectoid_medic', 'dep_harvester', 2, hi), ['small_launcher', 'stun_bomb', 'stun_bomb']);
    t.eq(D.alienLoadout('floater_leader', 'dep_harvester', 0, lo), ['plasma_pistol', 'plasma_pistol_clip', 'plasma_pistol_clip', 'alien_grenade']);
    t.eq(D.alienLoadout('sectoid_commander', 'dep_battleship', 0, hi), ['blaster_launcher', 'blaster_bomb', 'blaster_bomb']);
    t.eq(D.alienLoadout('sectoid_commander', 'dep_harvester', 0, hi), ['plasma_pistol', 'plasma_pistol_clip', 'plasma_pistol_clip']);
    t.eq(D.alienLoadout('ethereal_soldier', 'dep_terror_ship', 0, lo)[0], 'heavy_plasma', 'Etéreos com Plasma Pesado');
    t.eq(D.alienLoadout('cyberdisc', 'dep_terror_site', 2, hi), [], 'arma embutida');
    t.eq(D.alienLoadout('civilian_f', 'dep_terror_site', 2, hi), []);
  });

  t.test('geração de soldados: limites, nomes e nacionalidades (§3.2)', () => {
    const G = D.soldierGen;
    t.eq(G.statsMin, { tu: 50, sta: 40, hp: 25, brav: 10, react: 30, fire: 40, thr: 50, str: 20, melee: 20, psiStr: 0, psiSkill: 0 });
    t.eq([G.statsMax.tu, G.statsMax.sta, G.statsMax.hp, G.statsMax.brav, G.statsMax.react, G.statsMax.fire, G.statsMax.thr, G.statsMax.str], [60, 70, 40, 60, 60, 70, 80, 40]);
    t.eq([G.caps.tu, G.caps.sta, G.caps.hp, G.caps.fire, G.caps.str, G.caps.melee], [80, 100, 60, 120, 70, 120]);
    t.eq([G.femalePct, G.standHeight, G.kneelHeight, G.hire, G.salary], [25, 22, 14, 40000, 20000]);
    t.eq(keys(G.nationalities).sort(), COUNTRIES.concat(['pt']).sort());
    t.eq(G.weights.pt, 2);
    for (const c of COUNTRIES) t.eq(G.weights[c], 1, c);
    for (const id of keys(G.names)) {
      const n = G.names[id];
      t.ok(n.m.length >= 12 && n.f.length >= 12 && n.last.length >= 15, 'nomes ' + id);
      t.eq(new Set(n.m).size, n.m.length, 'próprios repetidos ' + id);
      t.eq(new Set(n.last).size, n.last.length, 'apelidos repetidos ' + id);
    }
    const rng = OV.RNG.create(77);
    const cnt = {};
    for (let i = 0; i < 9000; i++) {
      const nat = D.pickNationality(rng);
      cnt[nat] = (cnt[nat] || 0) + 1;
    }
    t.near(cnt.pt / 9000, 2 / 18, 0.02, 'Portugal ×2');
    t.near(cnt.japan / 9000, 1 / 18, 0.015);
    for (let i = 0; i < 300; i++) {
      const s = D.rollSoldierStats(rng);
      for (const k of G.statKeys) t.ok(s[k] >= G.statsMin[k] && s[k] <= G.statsMax[k], 'stat ' + k);
      t.eq(s.brav % 10, 0, 'Bravura em dezenas');
    }
    t.eq(D.soldierName(fixedRng(false), 'pt', false), 'João Silva');
    t.eq(D.soldierName(fixedRng(false), 'russia', true), 'Olga Ivanova');
    t.eq(D.soldierName(fixedRng(false), 'china', false), 'Wang Wei');
    t.ok(/^\S+ \S+/.test(D.soldierName(OV.RNG.create(5), 'germany', true)));
    // determinismo: mesma semente ⇒ mesmos nomes
    const a = OV.RNG.create(9), b = OV.RNG.create(9);
    for (let i = 0; i < 20; i++) t.eq(D.soldierName(a, 'spain', i % 2 === 0), D.soldierName(b, 'spain', i % 2 === 0));
    // nacionalidades dos países financiadores coincidem com a tabela de países, quando existe
    const cids = Array.isArray(D.countries) ? D.countries.map((c) => c.id) : keys(D.countries);
    if (cids.length) for (const c of COUNTRIES) t.ok(cids.indexOf(c) >= 0, 'país ' + c);
  });

  t.test('patentes de soldado e alienígenas', () => {
    const R = D.ranks;
    t.eq(R.soldier.map((r) => r.id), ['rookie', 'squaddie', 'sergeant', 'captain', 'colonel', 'commander']);
    t.eq(R.soldier.map((r) => r.scoreBonus), [0, 0, 1, 3, 6, 10]);
    t.eq(R.soldier.map((r) => r.leaderMod), [100, 100, 110, 115, 125, 150]);
    t.eq(D.soldierRank(3).id, 'captain');
    t.eq(D.soldierRank(99).id, 'commander');
    t.eq(keys(R.alien), ARANKS);
    t.eq(R.alien.soldier.slot, 5);
  });

  t.test('textos pt-PT: todas as nameKey existem', () => {
    const miss = [];
    const chk = (k) => { if (!has(k)) miss.push(k); };
    for (const id of keys(D.items)) chk(D.items[id].nameKey);
    for (const id of keys(D.armours)) chk(D.armours[id].nameKey);
    for (const id of keys(D.units)) chk(D.units[id].nameKey);
    for (const id of keys(D.races)) { chk(D.races[id].nameKey); chk(D.races[id].pluralKey); }
    for (const r of D.ranks.soldier) { chk(r.nameKey); chk(r.abbrKey); }
    for (const id of keys(D.ranks.alien)) chk(D.ranks.alien[id].nameKey);
    for (const id of keys(D.damageTypes)) chk(D.damageTypes[id].nameKey);
    for (const id of keys(D.invSlots)) chk(D.invSlots[id].nameKey);
    for (const id of keys(D.soldierGen.nationalities)) chk(D.soldierGen.nationalities[id].nameKey);
    for (const id of keys(D.items)) for (const m of D.weaponModes(id)) chk(m.nameKey);
    for (const k of D.soldierGen.statKeys) { chk('stat.' + k); chk('stat.' + k + '.abbr'); }
    t.eq(miss, []);
    t.eq(OV.T('item.rifle'), 'Espingarda');
    t.eq(OV.T('armour.coveralls'), 'Fato de Combate');
    t.eq(OV.T('unit.snakeman_leader'), 'Homem-Serpente Líder');
    t.eq(OV.T('rank.captain'), 'Capitão');
    t.eq(OV.T('dmg.SMOKE'), 'Fumo');
  });

  t.test('textos pt-PT: sem formas do português do Brasil', () => {
    const own = [];
    for (const k of keys(OV.STR)) if (/^(item|armour|unit|race|rank|arank|dmg|inv|mode|stat|nat|armourSide)\./.test(k)) own.push(OV.STR[k]);
    const br = /\b(tela|registro|equipe|fumaça|zumbi|detector|celular|ônibus|trem)\b/i;
    for (const s of own) t.ok(!br.test(s), 'pt-BR: ' + s);
  });

  t.test('regras são JSON puro e imutáveis depois do finalize', () => {
    for (const k of ['items', 'armours', 'units', 'races', 'deployments', 'alienItemTiers', 'soldierGen', 'ranks', 'invSlots', 'damageTypes']) {
      const v = D[k];
      t.eq(JSON.parse(JSON.stringify(v)), v, 'JSON ' + k);
      t.ok(Object.isFrozen(v), 'congelado ' + k);
    }
    t.ok(Object.isFrozen(D.items.rifle.modes.snap));
    t.ok(Object.isFrozen(D.units.sectoid_soldier.stats));
    t.throws(() => { 'use strict'; D.items.rifle.weight = 1; });
  });

  t.test('OVNIs e deployments apontam uns para os outros (quando ufos.js existe)', () => {
    if (!keys(D.ufos).length) return;
    for (const id of keys(D.deployments)) {
      const dep = D.deployments[id];
      if (dep.kind === 'ufo') {
        t.ok(D.ufos[dep.ufo], id + ' → ' + dep.ufo);
        t.eq(D.ufos[dep.ufo].deployment, id);
      }
    }
    for (const id of keys(D.ufos)) for (const a of keys(D.ufos[id].artefacts)) t.eq(D.items[a] && D.items[a].kind, 'artefact', id + ': ' + a);
  });
};
