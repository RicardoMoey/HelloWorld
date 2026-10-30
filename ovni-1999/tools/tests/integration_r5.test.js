/* Integração da ronda 5 de personas: porta com alguém atrás abre-se no motor (como no original), recolha dos
   transportes quando o OVNI levanta voo (bot e interface), kit automático com armas pesadas, AUTO-EQUIPAR não tira o
   kit médico, dica das baixas em grupo, saída-vitória da base alienígena, ferido a sangrar na fila da equipa,
   probabilidades de defesa da base nas Instalações e cabeçalhos da Ufopédia. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function (OV, t) {
  const D = OV.Data, BM = OV.BMap, BU = OV.BUnits, BT = OV.Battle, A = OV.Act, TU = OV.TUNE;
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const vm = require('vm');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Dom) load('js/ui/dom.js');
  if (!OV.BattleUI) load('js/ui/battle_ui.js');
  if (!OV.InventoryUI) load('js/ui/inventory_ui.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.Screens || !OV.Screens.lossCauses) load('js/ui/screens.js');
  if (!OV.CampaignUI || !OV.CampaignUI.heavyLeft) load('js/ui/campaign_ui.js');
  const STR = OV.STR;
  const has = (k) => typeof STR[k] === 'string' && STR[k].length > 0 && STR[k].indexOf('⟦') < 0;
  const id = (k) => D.tileId(k);
  const run = (gen) => {
    const ev = [];
    let r;
    while (!(r = gen.next()).done) ev.push(r.value);
    return { ev, ret: r.value };
  };

  function fixture() {
    const m = BM.create(20, 16, 1);
    const plane = m.w * m.h;
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = i < plane ? id('FARM.ground') : 0;
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', phase: 'play', aborted: false, pendingExplosions: [],
      reserve: 'none', reserveKneel: false, craftTiles: [], specials: {}, settings: { instantGrenades: true },
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 1, shade: 0, deploymentId: 'dep_terror_site', craftType: 'skyranger' }, rng: OV.RNG.streams(11),
    };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y) => BM.idx(B.map, x, y, 0);

  t.test('r5 #5 (motor): a marcha contra uma porta com alguém não visto atrás abre a porta, paga 4 UT e pára', () => {
    const B = fixture();
    // parede em x=5 com porta em y=3; o alienígena está logo do outro lado
    for (let y = 0; y < 16; y++) B.map.parts[I(B, 5, y) * 4 + 1] = id(y === 3 ? 'FARM.door' : 'FARM.wall');
    const s = BU.fromSoldier(B, { soldierId: 'Z1', name: 'Teste', nat: 'pt', rank: 0, armour: 'coveralls', missions: 0,
      stats: { tu: 60, sta: 60, hp: 40, brav: 50, react: 0, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 } },
    { R: 'rifle', L: null, belt: [], pack: [] });
    BU.placeUnit(B, s, I(B, 3, 3));
    s.dir = 2;
    const al = BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(5), 'dep_terror_site');
    BU.placeUnit(B, al, I(B, 5, 3));
    al.dir = 6;
    al.tu = 0; // sem reação
    OV.LOS.refreshAll(B);
    t.ok(!OV.LOS.isVisibleTo(B, 'xcom', al), 'atrás da porta fechada não se vê');
    const v = A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 7, 3) });
    t.ok(v.ok, 'o planeamento não sabe do ocupante');
    const tu0 = s.tu;
    const r = run(A.perform(B, { type: 'walk', unitId: s.id, to: I(B, 7, 3) }));
    t.eq([s.x, s.y], [4, 3], 'fica diante da porta');
    t.eq(BM.def(B.map, I(B, 5, 3), 1).key, 'FARM.doorOpen', 'a porta abriu');
    t.ok(r.ev.some((e) => e.t === 'door' && e.open), 'evento door');
    const it = r.ev.filter((e) => e.t === 'interrupt');
    t.eq(it.length && it[it.length - 1].reason, 'spotted', 'pára como ao avistar (sem «Caminho bloqueado»)');
    t.ok(!r.ev.some((e) => e.t === 'interrupt' && e.reason === 'blocked'));
    t.eq(tu0 - s.tu, 4 + TU.TU_DOOR, 'um passo (4) + abrir a porta (' + TU.TU_DOOR + ')');
    t.ok(OV.LOS.isVisibleTo(B, 'xcom', al), 'e vê quem lá está');
    t.eq(r.ret.reason, 'spotted');
  });

  t.test('r5 (bot e Geoscape): quando o OVNI aterrado levanta voo, o transporte a caminho regressa à base (ev.recalled)', () => {
    const C = OV.Campaign, Mi = OV.Missions;
    const G = C.newCampaign({ seed: 77, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const m = Mi.spawnMission(G, 'alien_research', { region: 'europe', race: 'sectoid' });
    const u = Mi.spawnUfo(G, m.id);
    u.status = 'landed'; u.alt = 0; u.speed = 0; u.dest = null; u.groundLeftS = 0; u.detected = true;
    u.wp = Math.max(1, u.wp | 0);
    const crafts = Object.keys(G.crafts).map((k) => G.crafts[k]);
    const sky = crafts.find((c) => D.crafts[c.type].transport);
    const fighter = crafts.find((c) => !D.crafts[c.type].transport);
    t.ok(sky && sky.soldiers.length > 0, 'transporte com equipa');
    Object.assign(sky, { status: 'out', lon: -5, lat: 40, dest: { kind: 'ufo', id: u.id } });
    if (fighter) Object.assign(fighter, { status: 'out', lon: -5, lat: 41, dest: { kind: 'ufo', id: u.id } });
    G.events = [];
    Mi.onUfoLiftOff(G, u.id);
    t.eq(u.status, 'flying');
    t.eq(sky.status, 'returning', 'transporte volta para casa');
    t.eq(sky.dest && sky.dest.kind, 'base');
    if (fighter) t.eq(fighter.status, 'out', 'o intercetor continua a perseguir');
    const ev = (G.events || []).find((e) => e.t === 'ufoLiftOff');
    t.ok(ev && ev.recalled.indexOf(sky.id) >= 0, JSON.stringify(ev));
    // a interface só dá o aviso (não volta a chamar recall por cima)
    const src = read('js/ui/geo_ui.js');
    t.ok(/for \(const id of recalled \|\| \[\]\) if \(G\.crafts\[id\]\) addToast\(\{ t: 'transportHome'/.test(src));
  });

  // ---- equipamento automático com armas pesadas (Tiago) ---------------------------------------------------
  t.test('r5 #1 (Tiago): autoKit usa Campaign.kitGuns — Lança-Foguetes e 2 foguetes (na mochila) antes da pistola', () => {
    const C = OV.Campaign, CU = OV.CampaignUI;
    const G = C.newCampaign({ seed: 5, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const sky = Object.keys(G.crafts).map((k) => G.crafts[k]).find((c) => D.crafts[c.type].transport);
    const b = C.findBase(G, sky.baseId);
    for (const id of sky.soldiers) G.soldiers[id].loadout = { R: null, L: null, belt: [], pack: [] };
    sky.equipment = {};
    b.stores = { rocket_launcher: 11, small_rocket: 14, pistol: 4, pistol_clip: 6 };
    const r = CU.autoKit(G, sky.id);
    t.ok(r.ok && r.unarmed === 0, JSON.stringify(r));
    const los = sky.soldiers.map((id) => G.soldiers[id].loadout);
    const rl = los.filter((lo) => lo.R === 'rocket_launcher');
    t.eq(rl.length, 7, '14 foguetes → 7 Lança-Foguetes com 2 cada');
    t.ok(rl.every((lo) => lo.pack.filter((x) => x === 'small_rocket').length === 2), 'foguetes na mochila (não cabem no cinto)');
    t.ok(los.filter((lo) => lo.R === 'pistol').length === sky.soldiers.length - 7, 'só depois as pistolas');
    // aviso do briefing (informativo): armas pesadas que ficaram na base com soldados só de pistola
    const G2 = C.newCampaign({ seed: 6, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const c2 = Object.keys(G2.crafts).map((k) => G2.crafts[k]).find((c) => D.crafts[c.type].transport);
    const b2 = C.findBase(G2, c2.baseId);
    c2.status = 'out';
    b2.stores = Object.assign({}, b2.stores, { rocket_launcher: 3, small_rocket: 6 });
    const hl = CU.heavyLeft(G2, c2);
    t.ok(hl.some((x) => x.id === 'rocket_launcher' && x.n === 3), JSON.stringify(hl));
    t.ok(has('cp.br.leftHeavy.one') && has('cp.br.leftHeavy.other'));
    t.ok(/prepare-os na base/.test(OV.Tn('cp.br.leftHeavy', 2, { n: 2, list: '3 × Lança-Foguetes', base: 'Lisboa' })), 'longe do hangar não promete «E para levar»');
    t.ok(/o posto de comando rendeu-se/.test(OV.T('cp.db.surrendered', { name: 'Comandante', n: 1, base: 'X' })));
  });

  t.test('r5 #4 (Tiago): AUTO-EQUIPAR não tira o kit médico a quem o levava', () => {
    const auto = OV.InventoryUI.model.autoLoadout;
    const mk = (id, hp, str) => ({ id, stats: { hp, str, tu: 60 }, armour: 'coveralls' });
    const a = mk('A', 30, 40), big = mk('B', 60, 40);
    const stores = () => ({ rifle: 2, rifle_clip: 4, medikit: 1 });
    const own = auto(a, stores(), { squad: [a, big], researched: null, keepMed: true });
    t.ok(own.pack.indexOf('medikit') >= 0, 'keepMed: fica com o kit');
    const other = auto(a, stores(), { squad: [a, big], researched: null });
    t.ok(other.pack.indexOf('medikit') < 0, 'sem kit antes: vai para quem tem mais saúde');
    const src = read('js/ui/inventory_ui.js');
    t.ok(/const hadMed = loTypes\(E\.loadouts\[s\.id\] \|\| emptyLo\(\)\)\.indexOf\('medikit'\) >= 0;/.test(src) && /E\.loadouts\[s\.id\] = autoFor\(s, hadMed\);/.test(src));
  });

  // ---- relatório: baixas em grupo e causa de cada morte -----------------------------------------------------
  t.test('r5 #0: dica «espalhe os soldados» quando o mesmo turno alienígena matou vários juntos', () => {
    const units = [
      { id: 1, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9, name: 'A' },
      { id: 2, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9, name: 'B' },
      { id: 3, origSide: 'xcom', type: 'soldier', status: 'ok', name: 'C' },
      { id: 4, origSide: 'xcom', type: 'soldier', status: 'ok', name: 'D' },
      { id: 9, origSide: 'alien', type: 'sectoid_soldier', status: 'ok' },
    ];
    const B = { units, items: [], mission: { difficulty: 1, kind: 'crash' }, stats: {} };
    const saved = BT.clusteredDeaths;
    try {
      BT.clusteredDeaths = () => 2;
      const c = OV.Screens.lossCauses(B);
      t.eq(c.tip, 'scr.db.tip.clustered');
      t.eq(c.tip2, 'scr.db.tip.enemy', 'a dica genérica passa a segunda');
      BT.clusteredDeaths = () => 0;
      t.eq(OV.Screens.lossCauses(B).tip, 'scr.db.tip.enemy');
    } finally { BT.clusteredDeaths = saved; }
    t.ok(/espalhe os soldados/i.test(OV.T('scr.db.tip.clustered')) && /acertam no do lado/.test(OV.T('scr.db.tip.clustered')));
    // memorial com a causa: o registo guarda a unidade e o relatório pede OV.BattleUI.causesFor(B)
    const ui = read('js/ui/battle_ui.js');
    t.ok(/hid: hidOf\(u, ev\.killerId\), uid: u\.id \};/.test(ui) && /lastCauses = \{ B, map: deathCauses\(\) \};/.test(ui));
    t.eq(OV.BattleUI.causesFor({}), {}, 'outra batalha: sem causas');
    t.ok(/causes\[f\.sid\]/.test(read('js/ui/screens.js')) && /causes\[f\.sid\]/.test(read('js/ui/campaign_ui.js')));
  });

  // ---- base alienígena: sair é a vitória --------------------------------------------------------------------
  t.test('r5 #2: centro de controlo destruído — aviso uma vez, Abortar verde e a confirmação diz que é vitória', () => {
    const ui = read('js/ui/battle_ui.js');
    t.ok(/function exitHint\(\)/.test(ui) && /exitHint\(\);\n\s*\/\/ toque:/.test(ui), 'verificado depois de cada ação');
    t.ok(/S\.hud\.bAbort\.classList\.add\('exit-win'\)/.test(ui) && /pushLog\(Object\.assign\(\{\}, row, \{ own: false \}\)\)/.test(ui));
    t.ok(/const exit = !!\(OV\.Battle\.exitWin && OV\.Battle\.exitWin\(S\.B\)\) && n > 0;/.test(ui));
    t.ok(/T\(exit \? 'hud\.abort\.exitWin' : 'bs\.abort\.confirm'\)/.test(ui) && /kind: exit \? 'primary' : 'danger'/.test(ui));
    for (const k of ['bs.obj.exitWin', 'hud.exit.toast', 'hud.exit.title', 'hud.abort.exitWin', 'hud.abort.exitWinBtn', 'hud.abort.exitTitle', 'hud.abort.exitNoOne', 'hud.tip.abort.exitWin']) t.ok(has(k), k);
    t.ok(/VITÓRIA/.test(OV.T('hud.abort.exitWin')) && /volte à nave e aborte para vencer/.test(OV.T('hud.exit.toast')));
    t.ok(/Abortar/.test(OV.T('scr.br.obj.alienBase.1')) && /a equipa saiu/.test(OV.T('scr.db.objective')));
    t.ok(/casas já vistas/.test(OV.T('bs.noRoute')));
    const css = read('css/battle.css');
    t.ok(/\.bs-btn\.danger\.exit-win \{/.test(css) && /prefers-reduced-motion: reduce\) \{ \.bs-btn\.exit-win/.test(css));
    // e o motor: abortar com alguém a bordo depois do centro destruído dá 'win'
    t.ok(typeof BT.exitWin === 'function');
  });

  t.test('r5 #13: fila da equipa mostra quem sangra (✚ + nome acessível)', () => {
    const ui = read('js/ui/battle_ui.js');
    t.ok(/const bleeding = \(u\) => \(u\.wounds \|\| \[\]\)\.some\(\(w\) => w > 0\);/.test(ui) && /bleeding\(u\) \? 1 : 0\]/.test(ui), 'a assinatura muda quando começa a sangrar');
    t.ok(/class: 'bs-sq-bleed', 'aria-hidden': 'true', text: '✚'/.test(ui) && /\+ \(bleed \? T\('hud\.sq\.bleeding'\) : ''\)\);/.test(ui));
    t.eq(OV.T('hud.sq.bleeding'), ', ferido a sangrar');
    t.ok(/\.bs-sq-bleed \{ position: absolute;/.test(read('css/battle.css')));
  });

  // ---- defesa da base -----------------------------------------------------------------------------------------
  t.test('r5 #3: Instalações mostra a defesa da base (defenceOdds); avisos do ataque e do «aguentámos a custo»', () => {
    const C = OV.Campaign;
    const G = C.newCampaign({ seed: 9, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const b = G.bases[0];
    const o = C.defenceOdds(G, b.id);
    t.ok(o.need > 0 && o.lostPct + o.repelPct + o.holdPct === 100, JSON.stringify(o));
    const src = read('js/ui/base_ui.js');
    t.ok(/const dfn = defenceBar\(g, b\);/.test(src) && /C\(\)\.defenceOdds\(g, b\.id\)/.test(src));
    for (const k of ['base.def.title', 'base.def.value', 'base.def.lost', 'base.def.repel', 'base.def.hold', 'base.def.short.one', 'base.def.short.other', 'base.def.short.md.one', 'base.def.short.md.other', 'base.def.tip.garrison.one', 'base.def.tip.garrison.other', 'base.def.tip.how', 'base.def.tip.defences.one', 'base.def.tip.defences.other', 'base.def.threat', 'base.def.noThreat']) t.ok(has(k), k);
    t.ok(/Risco de perder a base: 40 %/.test(OV.T('base.def.lost', { n: 40 })));
    const geo = read('js/ui/geo_ui.js');
    t.ok(/C\(\)\.defenceOdds\(G, base\.id, \{ ufoId: ev\.ufoId \}\)/.test(geo) && /if \(ev\.held\) \{/.test(geo));
    for (const k of ['geo.ev.baseDefence.held', 'geo.ev.baseDefence.held.none', 'geo.ev.baseAttack.odds', 'geo.ev.baseAttack.short.one', 'geo.ev.baseAttack.short.other', 'geo.ev.baseAttack.shortMd']) t.ok(has(k), k);
    t.ok(/Aguentámos a custo: Radar Pequeno ficaram/.test(OV.T('geo.ev.baseDefence.held', { list: 'Radar Pequeno' })));
  });

  // ---- disposição: «Equipar» em janelas baixas, Ufopédia, Como Jogar ---------------------------------------------
  t.test('r5 #8 e Ufopédia: rodapé do Equipar em 2 linhas, nota «Ficaram em» sem 3.ª linha cortada, cabeçalhos por grupo', () => {
    const css = read('css/campaign.css');
    t.ok(/\.cp-eq > footer \{ flex-wrap: nowrap; \}/.test(css) && /\.cp-eq > footer \.scr-hint \{ flex: 1 1 0; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2;/.test(css), 'rodapé: 2 linhas ao lado do botão, sem reticências');
    t.ok(/\.cp-eq-left \{[^}]*-webkit-line-clamp: 2;[^}]*max-height: calc\(2\.7em \+ 10px\);/.test(css));
    const up = read('js/ui/ufopaedia.js');
    t.ok(/nav\.appendChild\(el\('div', \{ class: 'up-nav-group' \}, head, ul\)\);/.test(up), 'cada secção no seu grupo');
    const ucss = read('css/ufopaedia.css');
    t.ok(/\.up-nav-group \{ position: relative; \}/.test(ucss) && /\.up-nav-item \{ scroll-margin-top: 40px; \}/.test(ucss));
    t.ok(/Alt\+clique numa porta/.test(OV.T('scr.howto.ptr.4')) && /abre-a sozinho/.test(OV.T('scr.howto.ptr.4')));
    t.ok(/⌥ Option\+clique numa porta/.test(STR['scr.howto.ptr.4.mac']));
  });
};
