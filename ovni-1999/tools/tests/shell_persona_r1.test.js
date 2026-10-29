/* Ronda de personas 1 — correções do «shell» (estratégia, menus, campanha): caminho guiado depois de perder o
   Skyranger (embarcar os aptos, equipar com o armazém, kit básico), Batalha Rápida (arma pesada pela Força, sinalizador
   no cinto, armazém por mês), efetivo estimado com o mês, causas das baixas, encomendas somadas, tipo do OVNI coerente
   e textos pt-PT novos. Carrega os ficheiros de interface em Node (sem DOM no carregamento). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.autoKit) load('js/ui/campaign_ui.js');
  const SC = OV.Screens, CU = OV.CampaignUI, M = OV.GeoUI.model, D = OV.Data, C = OV.Campaign;
  const has = (k) => typeof OV.STR[k] === 'string';
  const lo = (s) => [s.loadout.R, s.loadout.L].concat(s.loadout.belt, s.loadout.pack).filter(Boolean);
  const weight = (l) => [l.R, l.L].concat(l.belt || [], l.pack || []).filter(Boolean).reduce((w, id) => w + (D.items[id].weight | 0), 0);

  // ---- Batalha Rápida ------------------------------------------------------------------------------------------
  t.test('quick: a arma pesada vai para os dois soldados com mais Força (não pela posição)', () => {
    for (const month of [0, 1, 2, 3, 4]) {
      const { mission } = SC.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month, seed: 4242, squad: 8, time: 'day' });
      const heavy = { rocket_launcher: 1, heavy_cannon: 1, heavy_laser: 1, blaster_launcher: 1 };
      const idx = mission.squad.map((s, k) => k).filter((k) => heavy[mission.squad[k].loadout.R]);
      t.eq(idx.length, 2, 'mês ' + month + ': duas armas pesadas');
      const strs = mission.squad.map((s) => s.stats.str).sort((a, b) => b - a);
      for (const k of idx) t.ok(mission.squad[k].stats.str >= strs[1], 'mês ' + month + ': Força ' + mission.squad[k].stats.str + ' entre as 2 maiores');
    }
  });
  t.test('quick: de noite um sinalizador vai no cinto (13 UT) e outro na mochila, em todos os níveis', () => {
    for (let tier = 0; tier <= 4; tier++) {
      for (const heavy of [false, true]) {
        const { lo: l } = SC.loadoutFor(tier, 2, true, heavy);
        t.ok(l.belt.indexOf('electro_flare') >= 0, 'nível ' + tier + (heavy ? ' pesada' : '') + ': sinalizador no cinto');
        t.ok(l.pack.indexOf('electro_flare') >= 0, 'nível ' + tier + ': segundo sinalizador na mochila');
        t.ok(D.fitsSlot('grenade', 'belt', []) && l.belt.reduce((n, id) => n + (D.items[id].size | 0), 0) <= D.invSlots.belt.capacity, 'cinto dentro da capacidade');
      }
    }
    // compatibilidade: sem o 4.º argumento as posições 3 e 7 levam a arma pesada
    t.eq(SC.loadoutFor(0, 3, false).lo.R, 'rocket_launcher');
    t.eq(SC.loadoutFor(0, 2, false).lo.R, 'rifle');
  });
  t.test('quick: armazém da nave por mês (fumo sempre, bastão do mês 1, lança-bombas e bombas atordoantes do mês 3)', () => {
    const s0 = SC.quickStore(0, false), s1 = SC.quickStore(1, false), s3 = SC.quickStore(3, true);
    t.ok(s0.smoke_grenade > 0 && !s0.stun_rod && !s0.small_launcher, 'mês 0');
    t.ok(s1.stun_rod > 0 && !s1.small_launcher, 'mês 1');
    t.ok(s3.small_launcher > 0 && s3.stun_bomb > 0 && s3.stun_rod > 0 && s3.electro_flare > 0, 'mês 3, noite');
    for (const id of Object.keys(s3)) t.ok(!!D.items[id], id + ' existe');
    const { mission } = SC.buildQuickMission({ kind: 'crash', month: 3, seed: 5, squad: 6, time: 'night' });
    t.ok(mission.craftItems.small_launcher > 0, 'a missão leva o armazém no chão da nave');
  });
  t.test('quick: efetivo estimado com o mês e sem intervalo degenerado («1 alienígena»)', () => {
    t.eq(SC.crewText({ min: 1, max: 1 }), '1 alienígena');
    t.eq(SC.crewText({ min: 3, max: 3 }), '3 alienígenas');
    t.eq(SC.crewText({ min: 3, max: 4 }), OV.T('scr.qb.crewRange', { min: 3, max: 4 }));
    t.eq(SC.crewText(null), '—');
    // o mês muda a tabela (crewRules.earlyMonths): a interface tem de o passar
    const a = D.deploymentRange('dep_medium_scout', 1), b = D.deploymentRange('dep_medium_scout', 1, 0);
    t.ok(a && b, 'intervalos');
    const src = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'campaign_ui.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'js', 'ui', 'screens.js'), 'utf8');
    t.eq((src.match(/deploymentRange\([^)]*\)/g) || []).filter((x) => x.split(',').length < 3), [], 'todas as chamadas passam o mês');
  });

  // ---- causas das baixas -----------------------------------------------------------------------------------------
  t.test('relatório: causas das baixas (fogo amigo, inimigo, ferimentos) e dica da causa principal', () => {
    const B = { units: [
      { id: 1, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 2 },
      { id: 2, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 2 },
      { id: 3, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9 },
      { id: 4, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 2 },
      { id: 5, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: null, deathCause: 'wounds' },
      { id: 6, origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 9, origSide: 'alien', type: 'sectoid_soldier', status: 'ok' },
    ] };
    const c = SC.lossCauses(B);
    t.eq([c.friendly, c.enemy, c.wounds, c.total, c.main], [3, 1, 1, 5, 'friendly']);
    t.ok(has(c.tip) && has('scr.db.tip.enemy') && has('scr.db.tip.wounds'), 'dicas com texto');
    t.eq(SC.lossCauses({ units: [] }).main, null);
  });

  // ---- caminho guiado depois de perder o Skyranger --------------------------------------------------------------
  function lostSkyranger() {
    const G = C.newCampaign({ seed: 31, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const base = G.bases[0];
    const sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => c.type === 'skyranger');
    OV.World.loseCraft(G, sky.id, 'mission');
    G.events.length = 0;
    // 10 recrutas novos (sem nave, sem equipamento), como depois de «Contratar»
    for (let i = 0; i < 10; i++) C.addSoldier(G, OV.Soldiers.generate(G, { baseId: base.id }));
    const nc = C.addCraft(G, base.id, 'skyranger');
    return { G, base, craft: nc };
  }
  const invariant = (G, c) => {
    const tpl = {};
    for (const id of c.soldiers) for (const it of lo(C.findSoldier(G, id))) tpl[it] = (tpl[it] | 0) + 1;
    return Object.keys(tpl).every((k) => (c.equipment[k] | 0) >= tpl[k]);
  };

  t.test('equipa: «Embarcar todos os aptos» enche os lugares e equipa com o armazém (sem armas por investigar)', () => {
    const { G, base, craft } = lostSkyranger();
    base.stores = { rifle: 3, rifle_clip: 5, pistol: 2, pistol_clip: 4, grenade: 2, plasma_pistol: 2, plasma_pistol_clip: 4, heavy_cannon: 1, hc_ap: 2 };
    t.eq(CU.idleFit(G, base.id).length, 10, '10 aptos sem nave');
    const r = CU.crewUp(G, craft.id);
    t.eq(r.boarded, 10, 'embarcaram 10');
    t.eq(craft.soldiers.length, 10);
    const team = craft.soldiers.map((id) => C.findSoldier(G, id));
    for (const s of team) {
      t.ok(s.loadout.R !== 'plasma_pistol' && s.loadout.L !== 'plasma_pistol', s.name + ': nunca a pistola de plasma por investigar');
      t.ok(weight(s.loadout) <= s.stats.str, s.name + ': peso ≤ Força');
      if (s.loadout.R && D.items[s.loadout.R].ammo) t.ok(s.loadout.belt.some((x) => D.items[s.loadout.R].ammo.indexOf(x) >= 0), s.name + ': arma com munição');
    }
    const armed = team.filter((s) => CU.armedLo(s.loadout)).length;
    t.ok(armed >= 5 && r.equipped === armed, 'armados: ' + armed + ' (3 espingardas, 2 pistolas, canhão se a Força deixar)');
    t.eq(r.unarmed, 10 - armed, 'os restantes contam como sem arma');
    t.ok(invariant(G, craft), 'equipamento a bordo ⊇ modelos');
    t.ok(has('cp.crew.boarded.other') && CU.crewText(G, craft.id, r).indexOf('⟦') < 0, 'texto do resultado');
  });
  t.test('equipa: kit básico conta o que falta (espingarda, 2 carregadores, granada) e encomenda pelo BaseSim', () => {
    const { G, base, craft } = lostSkyranger();
    base.stores = { rifle: 2, rifle_clip: 1 };
    CU.crewUp(G, craft.id);
    const n = CU.unarmedAboard(G, craft.id).length;
    t.ok(n >= 8, 'sem arma: ' + n);
    const kit = CU.starterKit(G, base.id, n);
    const by = {};
    for (const x of kit.items) by[x.id] = x.n;
    const spare = (base.stores.rifle | 0) + ((OV.BaseSim.loose(G, craft.id) || {}).rifle | 0);
    t.eq(by.rifle, n - spare, 'uma espingarda por soldado sem arma, menos as que já há (' + spare + ')');
    t.ok(by.rifle_clip >= 2 * n - 1 && by.grenade === n, 'carregadores e granadas');
    t.eq(kit.cost, kit.items.reduce((s2, x) => s2 + D.items[x.id].buy * x.n, 0));
    const f0 = G.funds;
    const r = CU.buyStarterKit(G, base.id, kit);
    t.ok(r.ok, 'encomenda: ' + (r.reason || ''));
    t.eq(G.funds, f0 - kit.cost);
    t.ok(base.deliveries.some((d) => d.kind === 'item' && d.itemId === 'rifle'), 'entrega marcada');
    // sem dinheiro: recusa sem gastar nada
    G.funds = 10;
    t.eq(CU.buyStarterKit(G, base.id, CU.starterKit(G, base.id, n)).ok, false);
    t.eq(G.funds, 10);
  });
  t.test('equipa: a interface trata a chegada dos soldados e das armas (o Skyranger de substituição parte tripulado)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'geo_ui.js'), 'utf8');
    t.ok(/crewOnDelivery\(ev, evs\.filter\(\(e\) => e\.t === 'deliveryArrived'/.test(src), 'geo_ui trata a equipa uma vez por base em cada lote de entregas');
    t.ok(/transportFix\(c\)/.test(src), '«Enviar equipa» explica e corrige o transporte sem tropas');
  });

  // ---- Geoscape --------------------------------------------------------------------------------------------------
  t.test('geo: encomendas do mesmo tipo e base somadas («Chegaram 10 soldados»)', () => {
    const out = M.mergeDeliveries([
      { t: 'deliveryArrived', kind: 'soldier', itemId: null, n: 5, baseId: 'b1' },
      { t: 'deliveryArrived', kind: 'soldier', itemId: null, n: 5, baseId: 'b1' },
      { t: 'deliveryArrived', kind: 'item', itemId: 'rifle', n: 2, baseId: 'b1' },
      { t: 'deliveryArrived', kind: 'item', itemId: 'rifle', n: 3, baseId: 'b1' },
      { t: 'deliveryArrived', kind: 'scientist', itemId: null, n: 2, baseId: 'b1' },
    ]);
    t.eq(out.map((e) => e.kind + ':' + e.n), ['soldier:10', 'item:5', 'scientist:2']);
    t.eq(OV.Tn('geo.ev.delivery.soldier', 10, { base: 'X' }), 'Chegaram 10 soldados (X).');
  });
  t.test('geo: o tipo do OVNI é o mesmo em todos os ecrãs (eco de radar até ser identificado)', () => {
    const G = C.newCampaign({ seed: 9, difficulty: 1 });
    const u = { id: 'u7', type: 'large_scout', status: 'crashed', lon: 0, lat: 40, hyper: false, race: 'sectoid', missionId: null };
    G.ufos.push(u);
    t.eq(M.typeKnown(G, u), false);
    t.ok(M.ufoWhat(G, u).indexOf(OV.T(D.ufos.large_scout.nameKey)) < 0 && /^Eco /.test(M.ufoWhat(G, u)), 'eco: ' + M.ufoWhat(G, u));
    CU.markUfoKnown(G, 'u7');
    t.eq(M.typeKnown(G, u), true, 'o briefing identificou-o');
    t.eq(M.ufoWhat(G, u), OV.T(D.ufos.large_scout.nameKey));
    const G2 = C.newCampaign({ seed: 9, difficulty: 1 });
    G2.seen.ufoTypes.push('large_scout');
    t.eq(M.typeKnown(G2, u), true, 'tipo já visto numa batalha (como no combate aéreo)');
    t.eq(OV.T('geo.i.size'), 'Eco de radar');
  });
  t.test('geo: o aviso do ataque terrorista usa o valor real da penalização', () => {
    t.ok(/\{points\}/.test(OV.STR['geo.ev.terrorSite.stakes']) && /\{points\}/.test(OV.STR['cp.mr.advice.terror']), 'textos com {points}');
    const G = C.newCampaign({ seed: 3 });
    t.eq(OV.Missions.expiredPoints(G), 500, 'mês 0: 500');
  });

  // ---- textos ----------------------------------------------------------------------------------------------------
  t.test('i18n: chaves novas do shell (acessibilidade, equipa, repetir, mísseis, variantes de toque)', () => {
    const keys = ['scr.opt.acc.title', 'scr.opt.acc.palette', 'scr.opt.acc.palette.normal', 'scr.opt.acc.palette.cvd', 'scr.opt.acc.kbCursor',
      'scr.opt.acc.motion', 'scr.opt.acc.motion.auto', 'scr.opt.acc.motion.on', 'scr.opt.acc.motion.off', 'scr.opt.acc.textScale', 'scr.opt.objective',
      'scr.br.equip', 'scr.qe.title', 'scr.db.tip', 'scr.db.friendly.one', 'scr.db.friendly.other', 'scr.howto.geo.9',
      'cp.db.retry', 'cp.db.retry.tip', 'cp.db.retry.fail', 'cp.sl.slot.auto2', 'cp.sl.slot.preMission', 'cp.save.labelPre', 'cp.db.storedLost',
      'cp.br.autoKit', 'cp.br.warn.unarmed.one', 'cp.kit.title', 'cp.kit.buy', 'cp.ng.kbd', 'cp.ng.kbd.touch',
      'geo.fix.boardBtn', 'geo.fix.hire', 'geo.fix.unarmed.one', 'geo.fix.seats.other', 'geo.ev.craftLost.kit', 'geo.ev.craftLost.noTransport.touch',
      'geo.intro.l1.touch', 'geo.steps.speed.touch', 'geo.tm.hint.touch', 'geo.ufo.echo', 'geo.ev.arrived.unarmed.other',
      'base.crafts.boardAll', 'base.crafts.unarmed.one', 'base.pers.soldierAuto', 'base.research.startAria', 'base.market.lessOf',
      'df.ask.q', 'df.ask.off', 'df.ask.keep'];
    t.eq(keys.filter((k) => !has(k)), [], 'chaves em falta');
    // as variantes de toque não falam de teclas
    for (const k of ['geo.intro.l1.touch', 'geo.steps.speed.touch', 'geo.ev.craftLost.noTransport.touch', 'geo.tm.hint.touch']) t.ok(!/tecla|Esc|secundário|\(\d\)/.test(OV.STR[k]), k + ' sem teclas');
    for (const k of Object.keys(OV.STR)) if (/^(scr\.opt\.acc|cp\.kit|cp\.crew|geo\.fix|df\.ask)\./.test(k)) t.ok(!/acção|detect|intercep/i.test(OV.STR[k]), k + ': AO90');
  });
  t.test('screens/geo/base: as chaves literais novas existem', () => {
    const miss = [];
    for (const f of ['js/ui/screens.js', 'js/ui/base_ui.js', 'js/ui/dogfight_ui.js', 'js/ui/campaign_ui.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/\bT\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.') && !has(m[1])) miss.push(f + ': ' + m[1]);
      for (const m of src.matchAll(/\bTn\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.') && (!has(m[1] + '.one') || !has(m[1] + '.other'))) miss.push(f + ': ' + m[1]);
    }
    t.eq([...new Set(miss)], []);
  });
};
