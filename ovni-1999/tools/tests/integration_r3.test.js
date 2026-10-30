/* Ronda 3 de personas — integração: pendentes que cruzavam ficheiros de vários donos. O carregador dentro da arma não
   ocupa o cinto no combate (BUnits.fromSoldier = ecrã «Equipar»; kits da Batalha Rápida e da campanha com a mesma
   regra), u.deathSide nas mortes, «Abortar missão» no painel Esc, efetivo real de um local já visitado no briefing e
   no Geoscape, noite segura nos primeiros meses, «sem UT para disparar» no caminho ○, «Mostrar» com contexto para o
   leitor de ecrã, conselho «estão dentro do OVNI», CSS do «Equipar»/Ufopédia em janelas baixas e no retrato e o
   DATA_API. O comportamento no navegador está em qa/integration_r3.mjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.BattleUI) load('js/ui/battle_ui.js');
  if (!OV.InventoryUI) load('js/ui/inventory_ui.js');
  if (!OV.Presenter) load('js/ui/presenter.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.Screens || !OV.Screens.loadoutFor) load('js/ui/screens.js');
  if (!OV.CampaignUI || !OV.CampaignUI.autoKit) load('js/ui/campaign_ui.js');
  const D = OV.Data, C = OV.Campaign, IM = OV.InventoryUI.model;
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const stats = { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 40, melee: 30, psiStr: 30, psiSkill: 0 };
  const cap = D.invSlots.belt.capacity;
  const size = (list) => list.reduce((n, id) => n + (D.items[id].size | 0), 0);

  function battle(seed) {
    const B = { map: OV.BMap.create(6, 6, 1), units: [], items: [], nextId: 1, turn: 1, side: 'xcom', pendingBerserk: [], mission: { kind: 'crash', difficulty: 0 }, rng: OV.RNG.streams(seed || 3) };
    OV.Battle.rebuildDerived(B);
    return B;
  }
  function kit(lo) {
    const B = battle();
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'x', name: 'X', nat: 'pt', rank: 0, armour: 'coveralls', stats }, lo);
    const w = (h) => { const it = OV.BUnits.findItem(B, u.items[h]); return it ? it.type + (it.ammo ? '+' + it.ammo.type : '') : null; };
    return { B, u, R: w('R'), L: w('L'), belt: OV.BUnits.item(B, u, 'belt').map((i) => i.type), pack: OV.BUnits.item(B, u, 'pack').map((i) => i.type) };
  }

  // ---- 1. o carregador dentro da arma não ocupa o cinto ---------------------------------------------------------
  t.test('r3 integração: o motor carrega as armas antes de encher o cinto (cinto clássico 4/4, nada na mochila)', () => {
    const k = kit({ R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade', 'grenade', 'electro_flare'], pack: [] });
    t.eq(k.R, 'rifle+rifle_clip', 'arma carregada');
    t.eq(k.belt, ['rifle_clip', 'grenade', 'grenade', 'electro_flare'], 'o cinto do combate é o do ecrã');
    t.eq(k.pack, [], 'nada passa para a mochila');
    t.eq(k.belt, IM.visibleIn({ R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade', 'grenade', 'electro_flare'], pack: [] }, 'belt'), 'igual a visibleIn');
    // duas armas: cada uma leva o 1.º carregador compatível (cinto, depois mochila), como o autoLoad
    const k2 = kit({ R: 'rifle', L: 'pistol', belt: ['grenade', 'rifle_clip', 'grenade', 'smoke_grenade', 'electro_flare'], pack: ['pistol_clip', 'medikit'] });
    t.eq([k2.R, k2.L], ['rifle+rifle_clip', 'pistol+pistol_clip']);
    t.eq(k2.belt, ['grenade', 'grenade', 'smoke_grenade', 'electro_flare']);
    t.eq(k2.pack, ['medikit']);
    // sem autoLoad (opção do motor), o equipamento entra tal como está
    const B = battle();
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'y', name: 'Y', nat: 'pt', rank: 0, armour: 'coveralls', stats }, { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] }, { autoLoad: false });
    t.eq(OV.BUnits.findItem(B, u.items.R).ammo, null, 'autoLoad:false não carrega');
    t.eq(OV.BUnits.item(B, u, 'belt').length, 1);
  });

  t.test('r3 integração: kits da Batalha Rápida com a regra do «Equipar» (o 4.º objeto do cinto cabe)', () => {
    for (let tier = 0; tier <= 4; tier++) {
      for (const heavy of [false, true]) {
        const { lo } = OV.Screens.loadoutFor(tier, 2, true, heavy);
        const vis = IM.visibleIn(lo, 'belt');
        t.ok(size(vis) <= cap, 'nível ' + tier + (heavy ? ' pesada' : '') + ': cinto ' + JSON.stringify(vis));
        t.ok(lo.belt.indexOf('electro_flare') >= 0, 'sinalizador no cinto');
        // o motor reproduz o cinto do ecrã
        const k = kit(Object.assign({ L: null }, lo));
        t.eq(k.belt.slice().sort(), vis.slice().sort(), 'nível ' + tier + ': cinto do combate');
      }
    }
    // nível 1: espingarda + 2 carregadores + 2 granadas + sinalizador — antes uma granada ia para a mochila
    const t1 = OV.Screens.loadoutFor(1, 2, true, false).lo;
    t.eq(t1.belt.filter((x) => x === 'grenade').length, 2, 'as duas granadas ficam no cinto');
    const src = read('js/ui/campaign_ui.js') + read('js/ui/screens.js');
    t.ok(!/fitsSlot\([^)]*, (lo\[(sl|slot)\]|list)\)/.test(src), 'nenhum fitsSlot sobre a lista crua do cinto');
    t.ok((src.match(/visIn\(lo, (sl|slot)\)/g) || []).length >= 4, 'fits/loadAmmo e os kits rápidos usam visibleIn');
  });

  t.test('r3 integração: o combate continua determinista (mesma semente → mesmo hash)', () => {
    const q = { kind: 'crash', ufo: 'small_scout', month: 0, seed: 9191, squad: 6, time: 'day' };
    const h = () => {
      const { mission } = OV.Screens.buildQuickMission(q);
      const B = OV.Battle.create(mission);
      return OV.Battle.hash ? OV.Battle.hash(B) : JSON.stringify(B.units.map((u) => [u.id, u.items]));
    };
    t.eq(h(), h());
  });

  // ---- 2. lado em jogo na morte ----------------------------------------------------------------------------------
  t.test('r3 integração: killUnit regista u.deathSide (o debrief distingue o tiro de reação)', () => {
    const B = battle(5);
    OV.Battle.rebuildDerived(B);
    B.stats = { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 };
    B.pendingExplosions = [];
    const mk = (n) => {
      const u = OV.BUnits.fromSoldier(B, { soldierId: 's' + n, name: 'S' + n, nat: 'pt', rank: 0, armour: 'coveralls', stats }, { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
      OV.BUnits.placeUnit(B, u, OV.BMap.idx(B.map, n, 1, 0));
      return u;
    };
    const a = mk(1), b = mk(3), c = mk(4);
    B.side = 'alien';
    OV.Combat.killUnit(B, b, a.id, 'shot');
    t.eq(b.deathSide, 'alien', 'morto no turno alienígena (reação)');
    B.side = 'xcom';
    OV.Combat.killUnit(B, c, a.id, 'shot');
    t.eq(c.deathSide, 'xcom');
    // o debrief: o morto no turno alienígena foi tiro de reação de um colega; o outro não
    const ff = OV.Screens.lossCauses(B).ff;
    t.eq(ff.map((f) => [f.victim, f.how, f.reaction]), [['S3', 'shot', true], ['S4', 'shot', false]]);
  });

  // ---- 3. «Abortar missão» no painel Esc ---------------------------------------------------------------------------
  t.test('r3 integração: o painel Opções (Esc) tem «Abortar missão» durante a batalha (X, com a confirmação de sempre)', () => {
    const src = read('js/ui/screens.js');
    t.ok(/function abortBtn\(\)[\s\S]{0,400}T\('hud\.btn\.abort'\)[\s\S]{0,200}'aria-keyshortcuts': 'X'/.test(src), 'botão com X');
    t.ok(/function abortNow\(\) \{ close\(\); OV\.BattleUI\.abort\(\); \}/.test(src), 'fecha o painel e pede a confirmação da batalha');
    t.ok(/el\('footer', \{ class: 'scr-foot' \},\s*abortBtn\(\),/.test(src), 'no rodapé');
    t.ok(has('hud.btn.abort') && has('hud.tip.abort'));
    t.ok(typeof OV.BattleUI.abort === 'function');
  });

  // ---- 4. efetivo de um local já visitado ------------------------------------------------------------------------
  t.test('r3 integração: briefing e Geoscape usam a guarnição real de um local já visitado', () => {
    const G = C.newCampaign({ seed: 44, difficulty: 1 });
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon: 2, lat: 45, hyper: false, race: 'sectoid', missionId: null, crashLeftS: 0, groundLeftS: 7200, detected: true, typeKnown: true };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    const M = OV.GeoUI.model;
    u.garrison = { crew: [{ type: 'sectoid_soldier', rank: 'soldier', tier: 0, outside: false }], leftovers: {}, crashed: false };
    t.eq(M.crewEstimate(G, ref), { min: 1, max: 1 }, 'Geoscape: 1 sobrevivente');
    u.garrison.crew = [];
    t.eq(M.crewEstimate(G, ref), { min: 0, max: 0 }, 'só material');
    t.eq(OV.Battle.crewRange({ kind: 'landed', deploymentId: 'dep_small_scout', difficulty: 1, month: 0, garrison: { crew: [{ type: 'sectoid_soldier', rank: 'soldier', tier: 0, outside: false }, { type: 'sectoid_soldier', rank: 'soldier', tier: 0, outside: false }], leftovers: {}, crashed: false } }).max, 2);
    const cu = read('js/ui/campaign_ui.js');
    t.eq((cu.match(/crewRangeOf\(mission, M\)/g) || []).length, 2, 'avisos e cartão do briefing');
    t.ok(!/D\(\)\.deploymentRange\(M\.deploymentId, M\.difficulty, M\.month\);\n/.test(cu.replace(/const crewRangeOf[^\n]*\n/, '')), 'sem a tabela crua no briefing');
    t.ok(/OV\.Battle\.crewRange \? OV\.Battle\.crewRange\(mission\)/.test(read('js/ui/screens.js')), 'briefing da Batalha Rápida');
  });

  // ---- 5. noite segura nos primeiros meses ------------------------------------------------------------------------
  t.test('r3 integração: OVNI aterrado de noite nos meses 0–1 — «Esperar pelo dia» é seguro, por omissão e dito no texto', () => {
    const M = OV.GeoUI.model;
    const G = C.newCampaign({ seed: 45, difficulty: 1 });
    // ponto e hora de noite
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon: 0, lat: 10, hyper: false, race: 'sectoid', missionId: null, crashLeftS: 0, groundLeftS: 0, detected: true };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    let k = 0;
    while (k < 48 && OV.GMath.dayPhase(G, u.lon, u.lat) !== 'night') { G.t += 3600; k++; }
    const nt0 = M.nightAt(G, ref);
    t.ok(nt0 && nt0.h >= 1, 'é noite');
    u.groundLeftS = nt0.h * 3600 + 3600;
    G.month = 0;
    t.eq(M.nightAt(G, ref).safe, true, 'mês 0, fica até amanhecer');
    G.ui = G.ui || {};
    G.ui.geo = Object.assign(G.ui.geo || {}, { nightTried: true });
    t.eq(M.waitIsDefault(G, ref, M.nightAt(G, ref)), true, 'Veterano depois da 1.ª noite, mas seguro: esperar');
    G.month = OV.TUNE.NIGHT_LANDING_MONTHS;
    t.eq(M.nightAt(G, ref).safe, false, 'depois dos meses de aprendizagem: não se promete');
    t.eq(M.waitIsDefault(G, ref, M.nightAt(G, ref)), false);
    G.month = 0;
    u.groundLeftS = 600;
    t.eq(M.nightAt(G, ref).safe, false, 'aterrou de dia e descola antes de amanhecer: não se promete');
    t.ok(/fica no chão até amanhecer/.test(OV.T('geo.ev.arrived.night.safe', { t: '3 h' })) && /3 h/.test(OV.T('geo.ev.arrived.night.safe', { t: '3 h' })));
    t.ok(M.textKeys().indexOf('geo.ev.arrived.night.safe') >= 0);
    // ronda 3 (casual): a chave junta a fase (noite/crepúsculo) e a variante (.crash/.safe)
    t.ok(/T\('geo\.ev\.arrived\.' \+ ph \+ \(nt\.crashed \? '\.crash' : nt\.safe \? '\.safe' : ''\)/.test(read('js/ui/geo_ui.js')));
  });

  // ---- 6–8. Battlescape -----------------------------------------------------------------------------------------
  t.test('r3 integração: caminho ○ sem reserva diz «sem UT para disparar»; «Mostrar» com contexto', () => {
    t.eq(OV.T('hud.path.noShot'), 'sem UT para disparar');
    const src = read('js/ui/battle_ui.js');
    t.ok(/if \(!out && !res && wp\.marks\[wp\.marks\.length - 1\] === 1\) label \+= ' · ' \+ T\('hud\.path\.noShot'\)/.test(src));
    t.eq(OV.T('hud.report.show.aria', { btn: 'Mostrar', what: 'Ana ferida' }), 'Mostrar: Ana ferida');
    t.ok(/b\.setAttribute\('aria-label', T\('hud\.report\.show\.aria'/.test(src));
  });

  t.test('r3 integração: conselho «estão dentro do OVNI» sem contacto há N turnos e com todos lá dentro (de dia também, r4)', () => {
    const due = OV.BattleUI.model.ufoHintDue;
    const N = OV.BattleUI.model.UFO_HINT_TURNS;
    t.eq(N, 5);
    const B = {
      side: 'xcom', phase: 'play', turn: 6, ufo: { x: 10, y: 10, w: 6, h: 6 }, mission: { kind: 'crash', night: true },
      units: [{ side: 'alien', onMap: true, status: 'ok', x: 12, y: 12 }, { side: 'alien', onMap: true, status: 'dead', x: 1, y: 1 }, { side: 'xcom', onMap: true, status: 'ok', x: 2, y: 2 }],
    };
    t.eq(due(B, 1), true, 'turno 6, último contacto no 1');
    t.eq(due(B, 2), false, 'só 4 turnos');
    t.eq(due(Object.assign({}, B, { mission: { kind: 'crash', night: false } }), 1), true, 'de dia também (ronda 4: Batedor Grande com todos lá dentro)');
    t.eq(due(Object.assign({}, B, { turn: 4, mission: { kind: 'landed', night: false, difficulty: 2 } }), 1), false, 'Super-humano de dia: 5 turnos');
    t.eq(due(Object.assign({}, B, { mission: { kind: 'terror', night: true } }), 1), false, 'só OVNIs');
    t.eq(due(Object.assign({}, B, { mission: { kind: 'landed', night: true } }), 1), true, 'aterrado');
    t.eq(due(Object.assign({}, B, { side: 'alien' }), 1), false, 'no turno X-COM');
    t.eq(due(Object.assign({}, B, { units: B.units.concat({ side: 'alien', onMap: true, status: 'ok', x: 3, y: 3 }) }), 1), false, 'um alienígena cá fora: não se diz que estão lá dentro');
    t.eq(due(Object.assign({}, B, { units: B.units.filter((u) => u.side !== 'alien' || u.status !== 'ok') }), 1), false, 'sem alienígenas vivos');
    const txt = OV.T('hud.hint.ufoInside', { n: 5 });
    t.ok(/dentro do OVNI/.test(txt) && /Procurem a porta/.test(txt) && /5 turnos/.test(txt), txt);
    t.ok(!/clique|toque|tecla|Enter/i.test(txt), 'neutro para toque e teclado');
    const src = read('js/ui/battle_ui.js');
    t.ok(/if \(hint\) S\.ufoHinted = true;/.test(src), 'uma vez por batalha');
    t.ok(/ev\.t === 'spotted' && ev\.side === 'xcom'\) S\.contactTurn = S\.B\.turn/.test(src), 'contacto nos avistamentos');
  });

  t.test('r3 integração: soldado com carga acima da Força mostra «⚖ Carga» e as UT que perde', () => {
    t.eq(OV.T('hud.tip.heavy', { w: 30, str: 25, tu: 50, base: 60 }).indexOf('50 UT em vez de 60') >= 0, true);
    t.ok(has('hud.chip.heavy'));
    const src = read('js/ui/battle_ui.js');
    t.ok(/chip\('heavy', T\('hud\.chip\.heavy'\), T\('hud\.tip\.heavy', \{ w: load, str, tu: cut, base \}\)\)/.test(src));
    // a conta é a do motor (BUnits.turnTU sem ferimentos nas pernas)
    const B = battle(7);
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'h', name: 'H', nat: 'pt', rank: 0, armour: 'coveralls', stats: Object.assign({}, stats, { str: 20 }) }, { R: 'heavy_cannon', L: null, belt: ['hc_ap'], pack: ['hc_ap', 'grenade'] });
    const w = OV.BUnits.weight(B, u);
    t.ok(w > 20, 'carga ' + w);
    t.eq(u.tuMax, Math.floor((stats.tu * 20) / w), 'UT do turno = a do aviso');
  });

  // ---- 9. CSS ----------------------------------------------------------------------------------------------------
  t.test('r3 integração: «Equipar» compacto abaixo de 640 px de altura; «Equipar» e Ufopédia com a altura toda no retrato', () => {
    const cp = read('css/campaign.css'), up = read('css/ufopaedia.css');
    t.ok(/@media \(max-height: 640px\) \{[\s\S]*?\.cp-eq \.scr-head \{ padding-bottom: 6px; \}[\s\S]*?\.cp-eq > footer \{ padding-block: 8px; \}/.test(cp));
    t.ok(/@media \(orientation: portrait\) and \(max-width: 900px\) \{ \.cp-eq \{ height: 100%; \} \}/.test(cp));
    t.ok(/@media \(orientation: portrait\) and \(max-width: 900px\) \{ \.up-panel \{ height: 100%; \} \}/.test(up));
  });

  // ---- 10. DATA_API ------------------------------------------------------------------------------------------------
  t.test('r3 integração: DATA_API documenta soldierNamesTaken, o taken de soldierName e dep_alien_base.artefacts', () => {
    const doc = read('docs/DATA_API.md');
    t.ok(/soldierName\(rng, natId, female, taken\?\)/.test(doc) && /soldierNamesTaken\(soldiers, extra\?\)/.test(doc));
    t.ok(/artefacts\?/.test(doc) && /dep_alien_base/.test(doc));
    t.eq(typeof D.soldierNamesTaken, 'function');
    t.ok(D.deployments.dep_alien_base.artefacts && D.deployments.dep_alien_base.artefacts.alien_food === 2);
  });
};
