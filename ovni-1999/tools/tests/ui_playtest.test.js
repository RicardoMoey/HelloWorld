/* Correções do playtest da campanha inteira (qa/full_campaign.mjs): textos novos e a base do aviso «a equipa chega a
   tempo?» do ataque terrorista (GeoUI.model.craftsFor com ETA do transporte). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  if (!OV.GeoUI) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ui', 'geo_ui.js'), 'utf8'), { filename: 'geo_ui.js' });
  const M = OV.GeoUI.model;

  t.test('playtest: textos novos em pt-PT', () => {
    const keys = ['base.build.liftOne', 'geo.ev.craftLost.noTransport', 'geo.ev.researchDone.idle.one', 'geo.ev.researchDone.idle.other',
      'geo.ev.terrorSite.eta', 'geo.ev.terrorSite.late', 'geo.ev.terrorSite.noTeam', 'cp.resume.geo'];
    t.eq(keys.filter((k) => OV.STR[k] === undefined), [], 'chaves em falta');
    t.ok(/pausa/.test(OV.T('cp.resume.geo', { date: 'x' })), 'retomar avisa que o jogo está em pausa');
    t.eq(OV.Tn('geo.ev.researchDone.idle', 15), 'Há 15 cientistas sem projeto — escolha «Novo projeto».');
    t.ok(!/desmantel/.test(OV.T('base.build.liftOne')), 'o motivo do elevador na lista de obras não fala em desmantelar');
  });

  t.test('playtest: transporte com ETA para um ataque terrorista', () => {
    const G = OV.Campaign.newCampaign({ seed: 5, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
    // local de terror em Madrid (perto de Lisboa): o Skyranger chega muito antes do fim
    G.sites.push({ id: 't1', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: 'madrid', lon: -3.7, lat: 40.4, race: 'sectoid', region: 'europe', country: null, leftS: 12 * 3600 });
    const rows = M.craftsFor(G, null, { kind: 'site', id: 't1' }).filter((r) => r.ok && OV.Data.crafts[G.crafts[r.craftId].type].transport);
    t.eq(rows.length, 1, 'um transporte pronto');
    t.ok(rows[0].eta && rows[0].eta.h > 0 && rows[0].eta.h < 12, 'ETA em horas, antes do fim do ataque: ' + (rows[0].eta && rows[0].eta.h));
    t.ok(M.textKeys().indexOf('geo.ev.terrorSite.eta') >= 0, 'chave dinâmica coberta pelo teste de i18n');
  });
};
