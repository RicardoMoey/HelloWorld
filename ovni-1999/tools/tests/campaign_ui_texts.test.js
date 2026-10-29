/* Textos do fluxo da campanha (js/i18n/pt-PT.campaign.js): todas as chaves usadas por js/ui/campaign_ui.js existem e
   cada motivo de erro que a simulação pode devolver (campaign.err.*, save.err.*, escrita, equipar) tem texto pt-PT. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function (OV, t) {
  const ROOT = path.resolve(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const missingOf = (keys) => keys.filter((k) => !has(k));

  t.test('campaign_ui: todas as chaves literais de T()/Tn() existem', () => {
    const src = read('js/ui/campaign_ui.js');
    const miss = [];
    for (const m of src.matchAll(/\bT\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.') && !has(m[1])) miss.push(m[1]);
    for (const m of src.matchAll(/\bTn\(\s*'([a-zA-Z0-9_.]+)'/g)) for (const s of ['.one', '.other']) if (!has(m[1] + s)) miss.push(m[1] + s);
    // chaves em tabelas (estatísticas finais)
    for (const m of src.matchAll(/\['(cp\.[a-zA-Z0-9_.]+)',/g)) if (!has(m[1])) miss.push(m[1]);
    t.eq([...new Set(miss)], [], 'chaves em falta');
  });

  t.test('campaign_ui: cada campaign.err.<motivo> lançado pela simulação tem texto', () => {
    const src = read('js/sim/campaign.js');
    const reasons = [...new Set([...src.matchAll(/fail\('([a-zA-Z]+)'\)/g)].map((m) => m[1]))];
    t.ok(reasons.length >= 10, 'motivos encontrados: ' + reasons.join(','));
    for (const r of ['busy', 'ended', 'noCraft', 'notTransport', 'inDogfight', 'noSoldiers', 'noTarget', 'locked', 'craftType', 'notReady', 'notAtSite', 'noBattle']) {
      if (reasons.indexOf(r) < 0) reasons.push(r);
    }
    t.eq(missingOf(reasons.map((r) => 'campaign.err.' + r)), []);
  });

  t.test('campaign_ui: erros e motivos de escrita das gravações têm texto', () => {
    const src = read('js/sim/save.js');
    const errs = [...new Set([...src.matchAll(/err\('([a-zA-Z]+)'\)/g)].map((m) => m[1]))];
    t.ok(errs.indexOf('parse') >= 0 && errs.indexOf('busy') >= 0, 'erros lidos de save.js');
    t.eq(missingOf(errs.map((r) => 'save.err.' + r)), []);
    const writes = [...new Set([...src.matchAll(/reason: (?:isQuota\(e\) \? )?'([a-zA-Z]+)'(?: : '([a-zA-Z]+)')?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean))];
    for (const r of ['slot', 'quota', 'unavailable']) if (writes.indexOf(r) < 0) writes.push(r);
    t.eq(missingOf(writes.map((r) => 'save.write.' + r)), []);
    t.eq(OV.STR['save.write.quota'], 'Espaço insuficiente — exporte o jogo');
  });

  t.test('campaign_ui: Conselho, fim de jogo, ataque à base e famílias dinâmicas', () => {
    const keys = ['council.pleased', 'council.satisfied', 'council.dissatisfied'];
    for (const r of ['council', 'debt', 'baseLost', 'cydonia']) keys.push('cp.go.title.' + r, 'cp.go.text.' + r);
    for (const r of ['council', 'debt', 'baseLost']) keys.push('cp.mr.warn.defeat.' + r);
    for (const r of ['ufoDestroyed', 'repelled', 'lost']) keys.push('cp.bd.title.' + r, 'cp.bd.text.' + r);
    for (const c of ['kia', 'mia', 'craft', 'base']) keys.push('cp.cause.' + c);
    for (const r of ['noCraft', 'item', 'mismatch']) keys.push('cp.eq.err.' + r);
    for (let m = 0; m < 12; m++) keys.push('cp.month.' + m, 'cp.monthShort.' + m);
    for (let d = 0; d < 3; d++) keys.push('diff.' + d, 'cp.ng.diff.' + d, 'cp.ng.fact.aim.' + d, 'cp.ng.fact.crew.' + d);
    for (const k of ['N', 'S', 'E', 'W']) keys.push('cp.ng.' + k);
    for (const r of Object.keys(OV.Data.regions)) keys.push('region.' + r);
    for (const c of OV.Data.world.countryIds) keys.push('country.' + c);
    t.eq(missingOf(keys), []);
  });

  t.test('campaign_ui: chaves do Conselho devolvidas pela Economia existem', () => {
    const G = OV.Campaign.newCampaign({ difficulty: 1, seed: 3 });
    for (const r of [-2000, -700, 0, 300, 2000]) {
      const k = OV.Economy.councilKey(G, r);
      t.ok(has(k), k);
      t.ok(has(OV.Economy.ratingKey(G, r)), 'rating ' + r);
    }
  });

  t.test('campaign_ui: avisos de reasons de applyEquip existem para o que a simulação devolve', () => {
    const G = OV.Campaign.newCampaign({ difficulty: 0, seed: 9 });
    const r1 = OV.Campaign.applyEquip(G, 'c999', { loadouts: {}, stores: {} });
    t.ok(!r1.ok && has('cp.eq.err.' + r1.reason), r1.reason);
    const craft = Object.values(G.crafts).find((c) => OV.Data.crafts[c.type].transport);
    const pool = OV.Campaign.equipPool(G, craft.id);
    const extra = Object.assign({}, pool.stores, { rifle: (pool.stores.rifle | 0) + 5 });
    const r2 = OV.Campaign.applyEquip(G, craft.id, { loadouts: {}, stores: extra });
    t.ok(!r2.ok && has('cp.eq.err.' + r2.reason), r2.reason);
  });
};
