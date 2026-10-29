/* Basescape (js/ui/base_ui.js): cobertura pt-PT de todas as razões de recusa da simulação e das chaves usadas
   pela interface (estáticas e famílias dinâmicas). Corre sem DOM: lê os ficheiros como texto. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function (OV, t) {
  const ROOT = path.resolve(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const has = (k) => Object.prototype.hasOwnProperty.call(OV.STR, k);
  const missingOf = (keys) => keys.filter((k) => !has(k));

  // razões devolvidas pelas funções da simulação usadas pela base: fail('x'), return 'x' em can*, {reason:'x'}
  function reasonsIn(src) {
    const out = new Set();
    for (const re of [/fail\('([a-zA-Z]+)'\)/g, /return '([a-zA-Z]+)';/g, /reason: '([a-zA-Z]+)'/g]) {
      let m;
      while ((m = re.exec(src))) out.add(m[1]);
    }
    return out;
  }

  t.test('base ui: todas as razões de OV.BaseSim têm texto base.err.*', () => {
    const src = read('js/sim/geo/base.js');
    const rs = [...reasonsIn(src)].filter((r) => !['repair', 'rearm', 'refuel', 'ready'].includes(r));
    t.ok(rs.length >= 25, 'poucas razões encontradas: ' + rs.length);
    t.eq(missingOf(rs.map((r) => 'base.err.' + r)), [], 'base.err em falta');
  });

  t.test('base ui: razões de Soldiers.rename, applyEquip e equipPool cobertas', () => {
    const extra = ['name', 'noSoldier', 'noCraft', 'item', 'mismatch', 'generic'];
    t.eq(missingOf(extra.map((r) => 'base.err.' + r)), [], 'base.err em falta');
    // equipPool lança Error('campaign.err.<r>'): a interface usa base.err.<r>
    const camp = read('js/sim/campaign.js');
    const m = /function equipPool[\s\S]*?\n {2}}\n/.exec(camp);
    t.ok(m, 'equipPool não encontrado');
    const thrown = [...m[0].matchAll(/fail\('([a-zA-Z]+)'\)/g)].map((x) => x[1]);
    t.eq(missingOf(thrown.map((r) => 'base.err.' + r)), [], 'equipPool');
  });

  t.test('base ui: chaves estáticas de base_ui.js existem (e plurais .one/.other)', () => {
    const src = read('js/ui/base_ui.js');
    const re = /\b(T|Tn)\('([a-zA-Z0-9_.]+)'/g;
    const miss = [];
    let m, n = 0;
    while ((m = re.exec(src))) {
      const k = m[2];
      if (k.endsWith('.')) continue;
      n++;
      if (m[1] === 'Tn') { if (!has(k + '.one') || !has(k + '.other')) miss.push(k + ' (plural)'); } else if (!has(k)) miss.push(k);
    }
    t.ok(n > 250, 'poucas chaves: ' + n);
    t.eq(miss, [], 'chaves em falta');
  });

  t.test('base ui: famílias dinâmicas completas', () => {
    const TABS = ['facilities', 'research', 'production', 'personnel', 'stores', 'crafts', 'soldiers', 'market', 'containment'];
    const keys = [];
    for (const tab of TABS) keys.push('base.tab.' + tab, 'base.tabtip.' + tab);
    for (const c of ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts']) keys.push('base.cap.' + c, 'base.captip.' + c);
    for (const r of ['funds', 'materials', 'hangar', 'space']) keys.push('base.prod.stalled.' + r, 'base.prod.stalledHelp.' + r, 'base.prod.stalledToast.' + r, 'ev.productionStalled.' + r);
    for (const s of ['ready', 'out', 'patrol', 'returning', 'repair', 'rearm', 'refuel']) keys.push('craft.status.' + s);
    for (const s of ['repair', 'rearm', 'refuel']) keys.push('base.crafts.service.' + s);
    for (const k of ['soldier', 'scientist', 'engineer']) keys.push('base.kind.' + k + '.one', 'base.kind.' + k + '.other', 'base.personnel.' + k + 's');
    for (const c of ['rank', 'name', 'missions', 'kills', 'tu', 'hp', 'fire', 'react', 'brav', 'wound', 'craft']) keys.push('base.sol.col.' + c, 'base.sol.colTip.' + c);
    for (const c of ['kia', 'mia', 'craft', 'base']) keys.push('base.mem.cause.' + c);
    for (const c of ['rank', 'name', 'missions', 'kills', 'date', 'cause']) keys.push('base.mem.col.' + c);
    for (const c of ['craft', 'craft_weapon', 'craft_ammo', 'weapon', 'ammo', 'explosive', 'equipment', 'armour', 'material', 'component', 'artefact', 'corpse', 'other', 'live']) keys.push('base.cat.' + c);
    for (const r of ['commander', 'leader', 'engineer', 'medic', 'navigator', 'soldier', 'terrorist']) keys.push('base.cont.hint.' + r, 'arank.' + r);
    for (const id of Object.keys(OV.Data.facilities)) keys.push(OV.Data.facilities[id].nameKey);
    for (const id of Object.keys(OV.Data.manufacture)) keys.push('base.prod.cat.' + OV.Data.manufacture[id].cat);
    for (const id of Object.keys(OV.Data.research)) if (!OV.Data.research[id].template) keys.push('research.cat.' + OV.Data.research[id].cat);
    for (const k of ['weapons', 'equipment', 'armour', 'craft', 'facility', 'alien_tech', 'alien_life', 'story']) keys.push('research.cat.' + k);
    for (const s of OV.Data.soldierGen.statKeys) keys.push('stat.' + s);
    // ev.productionStalled.* pertence ao Geoscape; só exigimos as nossas
    const mine = keys.filter((k) => !k.startsWith('ev.'));
    t.eq(missingOf([...new Set(mine)]), [], 'chaves dinâmicas em falta');
  });

  t.test('base ui: cada item comprável, vendável e cada nave tem nome', () => {
    const miss = [];
    for (const id of Object.keys(OV.Data.items)) {
      const it = OV.Data.items[id];
      if ((it.buy > 0 || it.sell > 0) && !has(it.nameKey)) miss.push(it.nameKey);
    }
    for (const id of Object.keys(OV.Data.crafts)) if (!has(OV.Data.crafts[id].nameKey)) miss.push(OV.Data.crafts[id].nameKey);
    for (const id of Object.keys(OV.Data.craftWeapons)) if (!has(OV.Data.craftWeapons[id].nameKey)) miss.push(OV.Data.craftWeapons[id].nameKey);
    for (const id of Object.keys(OV.Data.armours)) if (!has(OV.Data.armours[id].nameKey)) miss.push(OV.Data.armours[id].nameKey);
    t.eq(miss, [], 'nomes em falta');
  });

  t.test('base ui: rótulos de progresso da investigação e interrogatórios têm texto', () => {
    const miss = [];
    const D = OV.Data;
    for (const [c, s, n] of [[100, 0, 0], [100, 10, 5], [100, 50, 3], [100, 50, 10], [100, 50, 20], [100, 50, 40]]) {
      const k = D.progressLabelKey(c, s, n);
      if (!has(k)) miss.push(k);
    }
    for (const u of D.interrogableUnits()) {
      const k = 'research.' + D.interrogationId(u);
      if (!has(k)) miss.push(k);
      if (!has('unit.' + u)) miss.push('unit.' + u);
    }
    t.eq(miss, [], 'chaves em falta');
  });

  t.test('base ui: os textos novos interpolam os parâmetros que a interface passa', () => {
    const T = OV.T;
    t.eq(T('base.prod.have', { name: 'Elerium-115', have: 0, need: 1 }), 'Elerium-115 0/1');
    t.ok(T('base.toast.hired', { n: 5, kind: OV.Tn('base.kind.scientist', 5), h: 48 }).indexOf('5 cientistas') >= 0, 'contratação');
    t.ok(OV.Tn('base.sol.woundedDays', 1).indexOf('1 dia') >= 0, 'plural de dias');
    t.ok(!/\{\w+\}/.test(T('base.market.priceLine', { price: '$1', h: 24, have: 2 })), 'parâmetros por substituir');
  });
};
