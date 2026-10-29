/* Ufopédia (js/ui/ufopaedia.js + js/i18n/pt-PT.ufopaedia.js): catálogo completo, resolução de ids (tópicos,
   itens, munições, cadáveres, unidades, interrogatórios), regra de desbloqueio (CAMPAIGN_API §5.11), textos pt-PT
   de 2–4 frases e tabelas de características geradas das regras sem chaves em falta nem NaN. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('../load');

module.exports = function (OV, t) {
  // a camada de interface não é carregada em Node: o catálogo é puro e não toca no DOM ao carregar
  if (!OV.Ufopaedia) vm.runInThisContext(fs.readFileSync(path.join(load.ROOT, 'js/ui/ufopaedia.js'), 'utf8'), { filename: 'ufopaedia.js' });
  const U = OV.Ufopaedia;
  const D = OV.Data;
  const has = (k) => OV.T.has(k);
  const bad = (s) => /⟦|NaN|undefined|\[object/.test(s);

  t.test('catálogo: 8 secções, ids únicos, todas as secções com artigos', () => {
    const list = U.articles();
    t.eq(U.SECTIONS.length, 8);
    t.eq(new Set(list.map((a) => a.id)).size, list.length, 'ids repetidos');
    for (const s of U.SECTIONS) t.ok(list.some((a) => a.sec === s), 'secção vazia ' + s);
    t.ok(list.length >= 75, 'artigos: ' + list.length);
  });

  t.test('todos os tópicos de investigação resolvem para um artigo', () => {
    for (const id in D.research) {
      const tp = D.research[id];
      if (tp.template) continue;
      t.ok(U.resolve(tp.article), 'artigo do tópico ' + id + ' (' + tp.article + ')');
      t.ok(U.resolve(id), 'tópico ' + id);
    }
    for (const unit of D.interrogableUnits()) {
      const tp = D.researchTopic(D.interrogationId(unit));
      t.ok(tp && U.resolve(tp.article), 'interrogatório de ' + unit);
      t.eq(U.resolve(tp.article), U.resolve(tp.id), 'interrogatório ' + unit + ' coerente');
    }
  });

  t.test('cada item, armadura, nave, instalação, unidade alienígena e OVNI tem artigo', () => {
    for (const id in D.items) {
      const it = D.items[id];
      if (it.mvp === false || it.recover === false) continue;
      t.ok(U.resolve(id), 'item ' + id);
    }
    for (const id in D.armours) t.ok(U.resolve(id), 'armadura ' + id);
    for (const id in D.crafts) t.eq(U.resolve(id), 'craft_' + id);
    for (const id in D.facilities) t.eq(U.resolve(id), 'facility_' + id);
    for (const id in D.ufos) t.eq(U.resolve(id), 'ufo_' + id);
    for (const id in D.units) if (D.units[id].side === 'alien') t.ok(U.resolve(id), 'unidade ' + id);
    t.eq(U.resolve('hc_he'), 'item_heavy_cannon', 'munição → arma');
    t.eq(U.resolve('stingray_missile'), 'item_stingray', 'míssil → lançador');
    t.eq(U.resolve('sectoid_corpse'), 'race_sectoid', 'cadáver → raça');
    t.eq(U.resolve('autopsy_chryssalid'), 'race_chryssalid');
    t.eq(U.resolve('interrogate_floater_navigator'), 'race_floater');
    t.eq(U.resolve('laser_defense'), 'facility_laser_defence');
    t.eq(U.resolve('hyper_wave'), 'facility_hyper_wave_decoder');
    t.eq(U.resolve('new_fighter'), 'craft_firestorm');
    t.eq(U.resolve('ultimate_craft'), 'craft_avenger');
    t.eq(U.resolve('plasma_cannon'), 'item_plasma_beam');
    t.eq(U.resolve('elerium'), 'item_elerium_115');
    t.eq(U.resolve('nada_disto'), null);
    t.eq(U.resolve(null), null);
  });

  t.test('textos pt-PT: título e 2–4 frases originais por artigo', () => {
    const seen = new Set();
    for (const a of U.articles()) {
      t.ok(has(a.titleKey), 'título ' + a.id);
      t.ok(has(a.textKey), 'texto ' + a.id);
      const s = OV.T(a.textKey);
      const n = (s.match(/[.!?](?=\s|$)/g) || []).length;
      t.ok(n >= 2 && n <= 4, a.id + ': ' + n + ' frases');
      t.ok(s.length >= 90 && s.length <= 520, a.id + ': comprimento ' + s.length);
      t.ok(!seen.has(s), a.id + ': texto repetido');
      seen.add(s);
    }
    for (const s of U.SECTIONS) t.ok(has('up.sec.' + s), 'secção ' + s);
  });

  t.test('características geradas para todos os artigos, sem chaves em falta nem NaN', () => {
    const G = OV.Campaign.newCampaign({ difficulty: 2, seed: 3 });
    for (const a of U.articles()) {
      for (const g of [null, G]) {
        const blocks = U.stats(a.id, g);
        t.ok(blocks.length > 0, a.id + ': sem características');
        const s = JSON.stringify(blocks);
        t.ok(!bad(s), a.id + ': ' + (s.match(/.{0,40}(⟦|NaN|undefined|\[object).{0,30}/) || [''])[0]);
        for (const b of blocks) {
          if (b.table) for (const r of b.table.rows) { t.eq(r.length, b.table.head.length, a.id + ': colunas'); t.ok(r.every((v) => typeof v === 'string'), a.id + ': células'); }
          if (b.kv) for (const r of b.kv) t.ok(typeof r[0] === 'string' && typeof r[1] === 'string', a.id + ': par');
        }
      }
    }
  });

  t.test('raças: estatísticas por dificuldade e por patente; coluna da dificuldade realçada', () => {
    const a = U.article('race_sectoid');
    const units = U.unitsOf(a);
    t.eq(units, ['sectoid_soldier', 'sectoid_navigator', 'sectoid_engineer', 'sectoid_medic', 'sectoid_leader', 'sectoid_commander']);
    const b = U.stats('race_sectoid', { difficulty: 1 }, { unit: 'sectoid_commander' })[0].table;
    t.eq(b.head.length, 4);
    t.eq(b.hi, 2);
    const tu = b.rows.find((r) => r[0] === OV.T('stat.tu'));
    t.eq(tu.slice(1), [0, 1, 2].map((d) => String(D.alienStats('sectoid_commander', d).tu)));
    t.ok(b.rows.some((r) => r[0] === OV.T('stat.psiSkill')), 'comandante psiónico');
    t.eq(U.unitsOf(U.article('race_muton')).length, 3);
    t.eq(U.unitsOf(U.article('race_cyberdisc')), ['cyberdisc']);
  });

  t.test('regra de desbloqueio (§5.11) e distintivo «Novo»', () => {
    const G = OV.Campaign.newCampaign({ difficulty: 0, seed: 11 });
    for (const id of ['craft_skyranger', 'craft_interceptor', 'item_rifle', 'item_stingray', 'armour_coveralls', 'facility_laboratory', 'facility_hangar']) {
      t.ok(U.isOpen(G, id), 'sempre aberto ' + id);
      t.ok(!U.isNew(G, id), 'sempre aberto não é novo ' + id);
    }
    for (const id of ['item_laser_pistol', 'race_sectoid', 'ufo_small_scout', 'craft_firestorm', 'facility_laser_defence', 'item_alien_alloys',
      'cydonia', 'alien_interrogation', 'item_personal_armour']) t.ok(!U.isOpen(G, id), 'fechado no início ' + id);
    G.researched.push('laser_pistol', 'personal_armour', 'new_fighter');
    t.ok(U.isOpen(G, 'item_laser_pistol') && U.isOpen(G, 'laser_pistol'), 'tópico investigado abre o artigo do item');
    t.ok(U.isOpen(G, 'item_personal_armour') && U.isOpen(G, 'craft_firestorm'));
    t.ok(!U.isOpen(G, 'item_laser_rifle'));
    G.ufopaedia.push('race_floater', 'ufo_medium_scout', 'sectoid');
    t.ok(U.isOpen(G, 'race_floater') && U.isOpen(G, 'ufo_medium_scout') && U.isOpen(G, 'race_sectoid'));
    G.researched.push('interrogate_muton_navigator');
    t.ok(U.isOpen(G, 'race_muton'), 'interrogatório abre a raça');
    G.flags.interrogated = true;
    t.ok(U.isOpen(G, 'alien_interrogation'));
    t.ok(U.isNew(G, 'race_floater'));
    U.markRead(G, 'race_floater');
    t.ok(!U.isNew(G, 'race_floater'));
    t.eq(JSON.parse(JSON.stringify(G.ui)).ufopaediaRead, ['race_floater']);
    const counts = U.sectionCounts(G);
    t.eq(Object.values(counts).reduce((s, c) => s + c.open, 0), U.openArticles(G).length);
    t.eq(U.openArticles(null).length, U.articles().length, 'Arquivo: tudo aberto');
    t.ok(!U.isOpen(G, 'nada_disto') && !U.isOpen(null, 'nada_disto'));
  });

  t.test('pesquisa sem acentos e com prioridade ao início do título', () => {
    const all = U.articles();
    t.eq(U.search(all, 'crisalida')[0].id, 'race_chryssalid');
    t.eq(U.search(all, 'ESPINGARDA')[0].id, 'item_rifle');
    t.ok(U.search(all, 'comandante').some((a) => a.id === 'race_sectoid'), 'patentes das raças entram na pesquisa');
    t.eq(U.search(all, 'zzzz').length, 0);
    t.eq(U.search(all, '').length, all.length);
  });
};
