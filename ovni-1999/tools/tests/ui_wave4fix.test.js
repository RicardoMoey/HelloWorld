/* Correções da interface (vaga 4, revisões adversariais): missão final pela interface, «Enviar equipa» com o
   transporte primeiro, base perdida sem janelas repetidas, pessoal parado, primeiros passos, relatório mensal legível,
   interceção que abre a atacar, textos pt-PT (AO90) e variantes de toque. Carrega os ficheiros de interface em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.cydoniaState) load('js/ui/campaign_ui.js');
  if (!OV.DogfightUI) load('js/ui/dogfight_ui.js');
  const M = OV.GeoUI.model, CU = OV.CampaignUI, DM = OV.DogfightUI.model;
  const newG = (seed) => OV.Campaign.newCampaign({ seed: seed || 7, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const missing = (s) => /⟦/.test(s);
  // OVNI mínimo para os testes (o sim só lê estes campos aqui)
  const addUfo = (G, o) => {
    const u = Object.assign({ id: 'u90', type: 'small_scout', status: 'flying', lon: -8, lat: 40, speed: 2200, alt: 2, dmg: 0, detected: true, hyper: false,
      race: 'sectoid', missionId: null, dest: null, crashLeftS: 0, targetBaseId: null }, o || {});
    G.ufos.push(u);
    return u;
  };

  t.test('i18n: pt-PT AO90 em todos os textos (sem «intercep», «detect», «acção»; «Cidónia»)', () => {
    const bad = [];
    for (const k of Object.keys(OV.STR)) {
      const v = OV.STR[k];
      if (typeof v !== 'string') continue;
      if (/intercep/i.test(v) || /detect/i.test(v) || /\bac[çc]ão/i.test(v) || /Cydonia/.test(v)) bad.push(k + ': ' + v.slice(0, 60));
    }
    t.eq(bad, [], 'grafias anteriores ao AO90');
    t.eq(OV.T('geo.btn.intercept'), 'Intercetar');
    t.eq(OV.T('geo.a.intercept'), 'Intercetar');
  });

  t.test('geoui: «Enviar equipa» a um OVNI aterrado põe o Skyranger com soldados primeiro', () => {
    const G = newG();
    const u = addUfo(G, { status: 'landed', lon: -3.7, lat: 40.4 });
    const rows = M.craftsFor(G, null, { kind: 'ufo', id: u.id });
    t.eq(rows.length, 3);
    t.eq(G.crafts[rows[0].craftId].type, 'skyranger', 'transporte no topo: ' + rows.map((r) => G.crafts[r.craftId].type).join(','));
    t.ok(rows[0].team && rows[0].ok, 'o Skyranger leva equipa');
    for (const r of rows.slice(1)) t.eq(r.warn, 'noTroops', 'intercetor avisa que não leva soldados');
    t.ok(M.groundTarget(G, { kind: 'ufo', id: u.id }));
    u.status = 'flying';
    t.ok(!M.groundTarget(G, { kind: 'ufo', id: u.id }), 'um OVNI em voo não é alvo em terra');
    const air = M.craftsFor(G, null, { kind: 'ufo', id: u.id });
    t.ok(air.every((r) => r.warn !== 'noTroops'), 'interceção: sem aviso de soldados');
    for (const w of M.WORLD_WARNS) t.ok(OV.STR['geo.warn.' + w], 'texto de geo.warn.' + w);
  });

  t.test('geoui: equipa a caminho — chegada, luz e destroços que desaparecem', () => {
    const G = newG();
    const u = addUfo(G, { status: 'crashed', lon: -3.7, lat: 40.4, crashLeftS: 40 * 3600 });
    const e = M.teamEta(G, { kind: 'ufo', id: u.id });
    t.ok(e && e.craftId === 'c1' && e.h > 0 && ['day', 'dusk', 'night'].indexOf(e.phase) >= 0, 'ETA e luz: ' + JSON.stringify(e));
    const line = M.teamEtaLine(G, { kind: 'ufo', id: u.id }, u.crashLeftS);
    t.ok(/Skyranger-1 chega em/.test(line) && !missing(line), line);
    const late = M.teamEtaLine(G, { kind: 'ufo', id: u.id }, 60);
    t.ok(/desaparecem/.test(late), late);
    G.crafts.c1.soldiers = [];
    t.eq(M.teamEtaLine(G, { kind: 'ufo', id: u.id }, 0), OV.T('geo.ev.terrorSite.noTeam'), 'sem soldados: ninguém pode ir');
  });

  t.test('geoui: base perdida — as naves destruídas entram no aviso da defesa', () => {
    const evs = [{ t: 'baseAttack', baseId: 'b1' }, { t: 'baseDefence', baseId: 'b1', result: 'lost', shots: [] },
      { t: 'craftLost', craftId: 'c1', reason: 'base' }, { t: 'craftLost', craftId: 'c2', reason: 'base' }, { t: 'craftLost', craftId: 'c9', reason: 'dogfight' }, { t: 'gameOver' }];
    const out = M.dropBaseLosses(evs);
    t.eq(out.map((e) => e.t + (e.reason ? ':' + e.reason : '')), ['baseAttack', 'baseDefence', 'craftLost:dogfight', 'gameOver']);
    t.eq(out[1].craftsLost, 2);
    t.ok(M.MERGE.craftLost, 'vários «Nave perdida» juntam-se numa janela');
    const kept = [{ t: 'baseDefence', result: 'repelled' }, { t: 'craftLost', reason: 'base' }];
    t.eq(M.dropBaseLosses(kept).length, 2, 'base repelida: nada muda');
    t.ok(OV.Tn('geo.ev.baseDefence.craftsLost', 3).indexOf('3') >= 0 && OV.Tn('geo.ev.craftLost.many', 2).indexOf('2') >= 0);
  });

  t.test('geoui: pessoal parado, primeiros passos e sugestão de velocidade', () => {
    const G = newG();
    const idle = M.idleStaff(G);
    t.eq(idle.sci, 10, 'os 10 cientistas iniciais estão parados');
    t.eq(idle.baseId, 'b1');
    OV.BaseSim.startResearch(G, 'b1', OV.Campaign.availableResearch(G, 'b1')[0], 10);
    t.eq(M.idleStaff(G).sci, 0, 'com um projeto já não há cientistas parados');
    G.ui.geo = { sci0: 10 };
    let ns = M.nextSteps(G);
    t.ok(ns.show, 'mês 0: passos visíveis');
    t.eq(ns.steps.map((s) => s.id + ':' + s.done), ['research:true', 'hire:false', 'speed:false', 'ufo:false']);
    G.ui.geo.sped = true;
    G.stats.ufosDetected = 1;
    G.bases[0].deliveries.push({ kind: 'scientist', n: 5, etaT: G.t + 3600 });
    ns = M.nextSteps(G);
    t.ok(!ns.show, 'tudo feito: passos escondidos');
    const G3 = newG();
    G3.ui.geo = { sci0: 10, stepsOff: true };
    t.ok(!M.nextSteps(G3).show, '«×» esconde os passos (G.ui.geo.stepsOff)');
    G3.ui.geo = { sci0: 10 };
    G3.month = 1;
    t.ok(!M.nextSteps(G3).show, 'só no primeiro mês');
    t.eq(M.suggestSpeed(0.3), 2, '18 min → «5 min» (tecla 3)');
    t.eq(M.suggestSpeed(3), 3);
    t.eq(M.suggestSpeed(20), 4);
    t.ok(/acelera/.test(OV.T('geo.nudge.text', { craft: 'X', t: '18 min', k: '3' })));
  });

  t.test('geoui: registo dos ataques sem resposta por mês (fronteira conta para o mês que acabou)', () => {
    const G = newG();
    const m1 = OV.Clock.monthStartT(1);
    M.logTerror(G, { t: 'terrorSiteExpired', at: m1, points: -1000 });
    M.logTerror(G, { t: 'terrorSiteExpired', at: m1 + 3600, points: -1000 });
    t.eq(G.ui.terrorLog[0], { n: 1, pts: 1000 });
    t.eq(G.ui.terrorLog[1], { n: 1, pts: 1000 });
    const R = { month: 0, alien: 1086, countries: [{ before: 600, delta: -100, after: 500 }, { before: 400, delta: 50, after: 450 }] };
    t.eq(CU.monthAlienSplit(G, R), [{ key: 'cp.mr.alienTerror', n: 1, pts: 1000 }, { key: 'cp.mr.alienOther', pts: 86 }]);
    t.eq(CU.monthAlienSplit(G, { month: 5, alien: 300 }), [{ key: 'cp.mr.alien', pts: 300 }]);
    t.eq(CU.fundingTotals(R), { before: 1000, delta: -50, after: 950 });
    for (const k of ['cp.mr.alienTerror.one', 'cp.mr.alienTerror.other', 'cp.mr.alienOther', 'cp.mr.total', 'cp.mr.nextIncome', 'cp.mr.advice', 'cp.mr.advice.terror']) t.ok(OV.STR[k], k);
  });

  t.test('campaign_ui: missão final — estados, nave escolhida e textos de cada motivo', () => {
    const G = newG();
    t.eq(CU.cydoniaPick(G, null).reason, 'locked');
    G.flags.cydoniaUnlocked = true;
    t.eq(CU.cydoniaPick(G, null), { ok: false, reason: 'noAvenger', craftId: null }, 'sem Vingador');
    t.eq(CU.cydoniaState(G, 'c1').reason, 'craftType', 'o Skyranger não vai a Marte');
    const av = OV.Campaign.addCraft(G, 'b1', 'avenger');
    t.ok(CU.cydoniaCapable(av));
    t.eq(CU.cydoniaState(G, av.id).reason, av.status === 'ready' ? 'noSoldiers' : 'notReady');
    av.status = 'ready';
    t.eq(CU.cydoniaState(G, av.id).reason, 'noSoldiers');
    const sid = G.crafts.c1.soldiers[0];
    OV.BaseSim.assignSoldier(G, sid, av.id);
    t.eq(CU.cydoniaState(G, av.id), { ok: true, reason: null });
    t.eq(CU.cydoniaPick(G, 'b1'), { ok: true, reason: null, craftId: av.id });
    // a mesma decisão que o sim: startMission aceita a nave escolhida
    const m = OV.Campaign.startMission(G, { kind: 'cydonia' }, av.id, {});
    t.eq(m.kind, 'cydonia');
    t.eq(CU.cydoniaState(G, av.id).reason, 'busy', 'com a missão em curso não parte outra');
    OV.Campaign.cancelMission(G);
    av.status = 'refuel';
    t.eq(CU.cydoniaPick(G, null).reason, 'notReady');
    for (const r of ['locked', 'ended', 'busy', 'noCraft', 'craftType', 'inDogfight', 'notReady', 'noSoldiers', 'noAvenger']) {
      const txt = CU.cydoniaWhy(r);
      t.ok(txt && !missing(txt) && !/cp\.err/.test(txt), r + ': ' + txt);
    }
    for (const k of ['cp.cy.title', 'cp.cy.body', 'cp.cy.noReturn', 'cp.cy.tip', 'cp.cy.stay', 'cp.cy.go', 'geo.a.cydonia', 'geo.a.cydoniaShort', 'geo.ev.cydonia', 'geo.ev.cydonia.ready', 'geo.ev.cydonia.notYet', 'base.crafts.cydonia', 'base.crafts.cydoniaTip']) t.ok(OV.STR[k], k);
  });

  t.test('dogfight_ui: abre a atacar (Normal ou a última postura), dica dos mísseis e nave de assalto', () => {
    const G = newG();
    const u = addUfo(G);
    const d = OV.Dogfight.create(G, 'c2', u.id);
    t.eq(d.mode, 'standoff', 'o sim cria em Distância');
    t.eq(DM.startMode(G, d), 'standard', 'a interface abre em Normal');
    G.ui.dfMode = 'aggressive';
    t.eq(DM.startMode(G, d), 'aggressive', 'ou na última postura de ataque do jogador');
    G.ui.dfMode = 'disengage';
    t.eq(DM.startMode(G, d), 'standard', 'nunca numa postura sem fogo');
    const tr = DM.newTrack(G, d);
    t.eq(tr.ufoSize, 0);
    t.ok(DM.missileTip(G, d, tr), 'batedor pequeno com Stingray ligado: aviso');
    OV.Dogfight.toggleWeapon(G, d.id, 0);
    t.ok(!DM.missileTip(G, d, tr), 'Stingray desligado: sem aviso');
    for (const w of G.crafts.c2.weapons) if (w) w.ammo = 0;
    t.eq(DM.startMode(G, d), null, 'sem munições fica em Distância');
    // ataque à base: a nave da base atacada combate em «Defesa da base»; o desengate diz que o assalto segue
    const G2 = newG();
    const a = addUfo(G2, { id: 'u91', type: 'battleship', targetBaseId: 'b1' });
    const d2 = OV.Dogfight.create(G2, 'c3', a.id);
    const tr2 = DM.newTrack(G2, d2);
    t.ok(tr2.assault && tr2.scramble, 'defesa da base');
    tr2.outcome = 'disengaged';
    const sm = DM.summary(tr2);
    t.eq(sm.titleKey, 'df.end.assaultPassed');
    t.ok(sm.subs.some((x) => x.key === 'df.sub.assaultPassed'));
    for (const k of ['df.title.scramble', 'df.hint.modes', 'df.hint.small', 'df.hint.scramble', 'df.hint.scrambleBig', 'df.hint.close', 'df.tip.smallUfo', 'df.minimisedKeys', 'df.end.assaultPassed', 'df.sub.assaultPassed']) t.ok(OV.STR[k], k);
  });

  t.test('base_ui: variantes de toque, venda de naves e textos novos', () => {
    for (const k of ['base.info.idleHint', 'base.build.validHere', 'base.build.clickToPlace', 'base.crafts.crewHint', 'base.equip.hint', 'cp.ng.help', 'cp.ng.gestures']) {
      t.ok(OV.STR[k + '.touch'], k + '.touch');
      t.ok(!/[Cc]lique|Shift/.test(OV.STR[k + '.touch']), k + '.touch sem «clique»: ' + OV.STR[k + '.touch']);
    }
    // cada motivo de BaseSim.canSellCraft tem texto
    const src = fs.readFileSync(path.join(ROOT, 'js', 'sim', 'geo', 'base.js'), 'utf8');
    const fn = src.slice(src.indexOf('function canSellCraft'), src.indexOf('function sellCraft'));
    const reasons = [...new Set([...fn.matchAll(/return '([a-zA-Z]+)'/g)].map((m) => m[1]))];
    t.ok(reasons.length >= 3, 'motivos: ' + reasons.join(','));
    t.eq(reasons.filter((r) => !OV.STR['base.err.' + r]), [], 'base.err.* em falta');
    const G = newG();
    t.eq(OV.BaseSim.canSellCraft(G, 'c1'), 'crew', 'o Skyranger com soldados não se vende');
    t.eq(OV.BaseSim.canSellCraft(G, 'c2'), null);
    for (const k of ['base.crafts.sell', 'base.crafts.sellTip', 'base.crafts.sellConfirm', 'base.crafts.sellNote', 'base.crafts.sellNote.rent', 'base.crafts.sellGo', 'base.toast.craftSold',
      'base.research.leadMake', 'base.research.leadBuild', 'base.research.cancelReturns', 'base.toast.alienReturned']) t.ok(OV.STR[k], k);
    t.ok(/antes de/.test(OV.STR['base.research.hint.leader']) && !/^Só/.test(OV.STR['base.research.hint.leader']), 'regra retroativa do interrogatório');
    t.eq(OV.T('base.research.leadMake', { name: 'Kit Médico' }), 'fabrico de Kit Médico');
  });
};
