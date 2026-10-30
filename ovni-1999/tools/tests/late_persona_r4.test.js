/* Ronda 4 de personas — achados tardios (Rui, veterano; Sofia, casual) testados num instantâneo anterior às outras
   correções da ronda: reserva com o modo efetivo, arremesso sem arco com o motivo verdadeiro e as casas com arco,
   conselho «estão dentro do OVNI» também de dia, «Ficaram em …» sem esconder material, noite nos ataques
   terroristas, armas melhores oferecidas aos veteranos, armazém sobrelotado no Geoscape, dicas de «Ritmo» e
   «h de engenheiro», dica do relatório contra corpo a corpo. O comportamento no navegador está em
   qa/persona_r4_late.mjs. */
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
  if (!OV.Screens || !OV.Screens.lossCauses) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.gunUpgrades) load('js/ui/campaign_ui.js');
  const BM = OV.BattleUI.model, GM = OV.GeoUI.model, CU = OV.CampaignUI, D = OV.Data, C = OV.Campaign;
  const has = (k) => typeof OV.STR[k] === 'string';
  const NEW = (seed, difficulty) => C.newCampaign({ seed, difficulty, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const transportOf = (G) => Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => D.crafts[c.type].transport);
  const stats = { tu: 60, stamina: 60, hp: 40, brav: 50, react: 50, fire: 60, throw: 60, str: 40, psiStr: 30, psiSkill: 0, melee: 40 };

  // ---- #0 reserva: o modo que conta de facto -----------------------------------------------------------------------
  t.test('late r4 (Rui): Lançador Blaster com «Reservar tiro rápido» reserva o apontado e o rótulo di-lo', () => {
    const B = OV.Battle.create(OV.Battle.quickMission({ seed: 4, ufoType: 'small_scout', terrain: 'FARM', landed: true, difficulty: 2 }));
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'r', name: 'Rui', nat: 'pt', rank: 0, armour: 'coveralls', stats }, { R: 'blaster_launcher', L: null, belt: ['blaster_bomb'], pack: [] });
    B.reserve = 'snap';
    B.reserveKneel = true;
    const info = OV.Act.reserveInfo(B, u, { standing: true });
    t.eq(info.asked, 'snap');
    t.eq(info.mode, 'aimed', 'a arma não tem tiro rápido: conta o apontado');
    t.eq(info.tu, OV.Act.reserveTU(B, u, { standing: true }), 'a mesma soma que o motor usa');
    t.eq(info.kneel, OV.TUNE.TU_KNEEL);
    const what = BM.reserveWhat(info);
    t.eq(what, 'Tiro apontado (a arma não tem tiro rápido) + ajoelhar', what);
    t.ok(!/Tiro rápido \+/.test(what), 'nunca diz que reserva um tiro que a arma não tem');
    // arma com tiro rápido: sem a nota
    const v = OV.BUnits.fromSoldier(B, { soldierId: 's', name: 'S', nat: 'pt', rank: 0, armour: 'coveralls', stats }, { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
    const iv = OV.Act.reserveInfo(B, v, { standing: true });
    t.eq(iv.mode, 'snap');
    t.eq(BM.reserveWhat(iv), 'Tiro rápido + ajoelhar');
    B.reserve = 'auto';
    t.eq(BM.reserveWhat(OV.Act.reserveInfo(B, u, { standing: true })), 'Tiro apontado (a arma não tem rajada) + ajoelhar');
    t.ok(/reserveWhat\(info\)/.test(read('js/ui/battle_ui.js')), 'a etiqueta do caminho e a recusa usam o modo efetivo');
    t.ok(/toast\('hud\.reserve\.fallback'/.test(read('js/ui/battle_ui.js')), 'ao escolher a reserva, avisa logo');
    t.eq(OV.T('hud.reserve.fallback', { name: 'Rui', lack: OV.T('hud.reserve.lack.snap'), mode: OV.T('hud.reserve.eff.aimed'), tu: 38 }), 'Rui: a arma não tem tiro rápido — fica reservado o tiro apontado (38 UT).');
  });

  // ---- #1 arremesso sem arco ----------------------------------------------------------------------------------------
  t.test('late r4 (Rui): sem arco o texto diz o motivo (caminho), não «o alvo está debaixo de um teto»; casas com arco marcadas', () => {
    const B = OV.Battle.create(OV.Battle.quickMission({ seed: 5, ufoType: 'medium_scout', terrain: 'FARM', landed: true, difficulty: 0 }));
    B.map.disc.fill(1);
    const r = B.ufo, m = B.map;
    const u = B.units.find((x) => x.side === 'xcom' && x.onMap);
    // o soldado dentro do OVNI (casa com teto por cima)
    let placed = false;
    for (let y = r.y; y < r.y + r.h && !placed; y++) {
      for (let x = r.x; x < r.x + r.w && !placed; x++) {
        const i = y * m.w + x;
        if (OV.BMap.canStand(m, i) && !OV.Battle.unitAt(B, i) && m.parts[(i + m.w * m.h) * 4]) { u.x = x; u.y = y; u.z = 0; placed = true; }
      }
    }
    t.ok(placed, 'casa livre dentro do OVNI');
    OV.Battle.rebuildDerived(B);
    const range = 12;
    const tiles = BM.arcTiles(B, u, 0, range);
    let ok = 0, roofOk = 0, roofNo = 0;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        const dx = x - u.x, dy = y - u.y;
        if (OV.U.isqrt(dx * dx + dy * dy) > range || !OV.BMap.hasFloor(m, i)) continue;
        const plan = OV.Act.planArc(B, u, i);
        const arc = !!(plan && plan.goal === i);
        t.eq(!!tiles[i], arc, 'marca = planArc do motor em ' + x + ',' + y);
        if (arc) ok++;
        const roof = !!m.parts[(i + m.w * m.h) * 4];
        if (roof && arc) roofOk++;
        if (roof && !arc) roofNo++;
      }
    }
    t.ok(ok > 0, 'há casas com arco');
    t.ok(roofOk > 0 && roofNo > 0, 'debaixo do mesmo teto umas casas têm arco e outras não (' + roofOk + '/' + roofNo + '): o teto do alvo não é o motivo');
    const src = read('js/ui/battle_ui.js');
    t.ok(src.indexOf("hud.throw.targetRoof") < 0, 'o texto enganador saiu');
    t.ok(/label = T\(av\.n \? 'hud\.throw\.noArc\.marked' : underRoof\(u\) \? 'hud\.throw\.roof' : 'hud\.throw\.noArc\.why'\)/.test(src));
    t.ok(/S\.view\.arcTiles = av\.n \? \{ z: p\.z, tiles: av\.tiles \} : null;/.test(src), 'as casas com arco ficam realçadas');
    t.ok(/drawArcTiles\(ctx, B, F, z\);/.test(read('js/gfx/battle_render.js')), 'o renderizador desenha-as');
    t.ok(/paredes ou teto no caminho/.test(OV.T('hud.throw.noArc.marked')) && /tracejado/.test(OV.T('hud.throw.noArc.marked')));
    t.ok(!has('hud.throw.targetRoof'));
  });

  // ---- #5 conselho do OVNI de dia -----------------------------------------------------------------------------------
  t.test('late r4 (Sofia): de dia, Batedor Grande com todos lá dentro → conselho ao fim de 3/4/5 turnos; «Mostrar» vai à porta', () => {
    const base = { side: 'xcom', phase: 'play', ufo: { x: 20, y: 20, w: 20, h: 20 }, units: [{ side: 'alien', onMap: true, status: 'ok', x: 31, y: 31 }, { side: 'alien', onMap: true, status: 'ok', x: 35, y: 30 }] };
    const at = (turn, night, difficulty) => BM.ufoHintDue(Object.assign({}, base, { turn, mission: { kind: 'landed', night, difficulty } }), 1);
    t.eq([at(3, false, 0), at(4, false, 0)], [false, true], 'Recruta de dia: 3 turnos sem contacto');
    t.eq([at(4, false, 1), at(5, false, 1)], [false, true], 'Veterano de dia: 4');
    t.eq([at(5, false, 2), at(6, false, 2)], [false, true], 'Super-humano de dia: 5');
    t.eq([at(4, true, 0), at(5, true, 0)], [false, true], 'Recruta de noite: 4');
    t.eq(at(6, true, 1), true, 'Veterano de noite: 5 (como antes)');
    t.eq(BM.ufoHintTurns({ mission: { night: false, difficulty: 0 } }), 3);
    // verdade: com um alienígena cá fora não se diz nada
    const out = Object.assign({}, base, { turn: 9, mission: { kind: 'landed', night: false, difficulty: 0 }, units: base.units.concat({ side: 'alien', onMap: true, status: 'ok', x: 5, y: 5 }) });
    t.eq(BM.ufoHintDue(out, 1), false);
    // entrada: porta do OVNI (objeto door 'ufo') dentro do retângulo, a mais perto da equipa
    const B = OV.Battle.create(OV.Battle.quickMission({ seed: 5, ufoType: 'large_scout', terrain: 'FARM', landed: true, difficulty: 0 }));
    const e = BM.ufoEntry(B);
    t.ok(e >= 0, 'há entrada');
    const x = e % B.map.w, y = (e / B.map.w) | 0;
    t.ok(x >= B.ufo.x && x < B.ufo.x + B.ufo.w && y >= B.ufo.y && y < B.ufo.y + B.ufo.h, 'dentro do OVNI');
    t.ok(OV.BMap.isUfoDoor(B.map, e), 'é uma porta de OVNI');
    const txt = OV.T('hud.hint.ufoInside.door', { n: 4 });
    t.ok(/4 turnos/.test(txt) && /dentro do OVNI/.test(txt) && /«Mostrar»/.test(txt) && /2 ou 3 de cada vez/.test(txt), txt);
    t.ok(!/clique|toque|tecla|Enter/i.test(txt), 'neutro para toque e teclado');
  });

  // ---- #2 «Ficaram em …» --------------------------------------------------------------------------------------------
  t.test('late r4 (Rui): «Ficaram em …» põe o material de captura primeiro e diz «e mais N tipos» em vez de esconder', () => {
    const G = NEW(36, 1);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    b.stores.stun_rod = 2;
    b.stores.smoke_grenade = 10;
    b.stores.rocket_launcher = 1;
    c.status = 'out';
    const pool = C.equipPool(G, c.id);
    const all = CU.leftAtBaseAll(G, c, pool);
    t.ok(all.length > 4, 'há mais de 4 tipos: ' + all.length);
    t.eq(all.slice(0, 2).map((x) => x.id).sort(), ['smoke_grenade', 'stun_rod'], 'captura primeiro: ' + JSON.stringify(all.slice(0, 3)));
    const rl = all.findIndex((x) => x.id === 'rocket_launcher'), sr = all.findIndex((x) => x.id === 'small_rocket');
    t.ok(rl >= 0 && (sr < 0 || sr === rl + 1), 'a munição fica junto da sua arma');
    t.eq(CU.leftAtBase(G, c, pool), all.slice(0, 4));
    const txt = CU.leftText(G, c, pool, b);
    t.ok(/Bastão/.test(txt) && /Granada de Fumo/.test(txt), txt);
    t.ok(new RegExp('e mais ' + (all.length - 4) + ' tipos: ').test(txt), 'diz quantos faltam: ' + txt);
    for (const x of all.slice(4)) t.ok(txt.indexOf(OV.T(D.items[x.id].nameKey)) >= 0, 'nomeia ' + x.id);
    t.eq(OV.Tn('cp.eq.leftMore', 1, { list: 'Pistola' }), 'e mais 1 tipo: Pistola');
  });

  // ---- #4 corpo a corpo no relatório ---------------------------------------------------------------------------------
  t.test('late r4 (Rui): derrota para Crisálidas → dica de distância e fogo de reação, não «ajoelhe-se»', () => {
    const units = [
      { id: 1, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9, deathCause: 'melee', spawnOnDeath: 'zombie', name: 'A' },
      { id: 2, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9, deathCause: 'melee', name: 'B' },
      { id: 3, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 8, deathCause: 'shot', name: 'C' },
      { id: 4, origSide: 'xcom', type: 'soldier', status: 'ok', name: 'D' },
      { id: 8, origSide: 'alien', type: 'snakeman_soldier', status: 'ok' },
      { id: 9, origSide: 'alien', type: 'chryssalid', status: 'ok' },
    ];
    const c = OV.Screens.lossCauses({ units, items: [], mission: { difficulty: 1, kind: 'terror' } });
    t.eq(c.melee, 2);
    t.eq(c.tip, 'scr.db.tip.melee');
    const txt = OV.T('scr.db.tip.melee');
    t.ok(/Ajoelhar não protege/.test(txt) && /fogo de reação/.test(txt) && /zombies/.test(txt), txt);
    // mortes a tiro: a dica de sempre
    units[0].deathCause = 'shot'; delete units[0].spawnOnDeath; units[1].deathCause = 'shot';
    t.ok(OV.Screens.lossCauses({ units, items: [], mission: { difficulty: 1 } }).tip !== 'scr.db.tip.melee');
  });

  // ---- #6 terror de noite --------------------------------------------------------------------------------------------
  t.test('late r4 (Sofia): ataque terrorista de noite → aviso de noite e «Esperar pelo dia» só se o ataque durar até lá', () => {
    const G = NEW(37, 0);
    let lon = null;
    for (let L = -180; L < 180; L += 5) {
      if (OV.GMath.dayPhase(G, L, 40) === 'night') {
        let h = 1;
        while (h < 24 && OV.GMath.dayPhase({ t: G.t + h * 3600 }, L, 40) !== 'day') h++;
        if (h >= 3 && h <= 10) { lon = L; break; }
      }
    }
    t.ok(lon !== null, 'há um sítio de noite');
    const site = { id: 'ts1', cityId: null, lon, lat: 40, race: 'sectoid', leftS: 20 * 3600 };
    G.sites.push(site);
    const ref = { kind: 'site', id: 'ts1' };
    const nt = GM.nightAt(G, ref);
    t.ok(nt && nt.site && nt.lasts && nt.h >= 3, JSON.stringify(nt));
    t.eq(GM.waitIsDefault(G, ref, nt), true, 'Recruta, 1.ª noite: esperar por omissão quando o ataque dura');
    site.leftS = (nt.h - 1) * 3600;
    const n2 = GM.nightAt(G, ref);
    t.eq(n2.lasts, false, 'acaba antes de amanhecer');
    t.eq(GM.waitIsDefault(G, ref, n2), false, 'não se propõe esperar');
    const src = read('js/ui/geo_ui.js');
    t.ok(/const wait = nt && !\(nt\.site && !nt\.lasts\) \?/.test(src), 'sem botão de esperar quando o ataque acaba antes');
    t.ok(/teamEtaText\(G, \{ craftId: r\.craftId, h: r\.eta\.h, phase \}, site\.leftS\)/.test(src), 'o pop-up do ataque diz «lá será noite»');
    for (const k of ['geo.ev.arrived.night.site', 'geo.ev.arrived.night.site.asked', 'geo.ev.arrived.night.site.ends', 'geo.ev.arrived.dusk.site', 'geo.ev.arrived.dusk.site.asked', 'geo.ev.arrived.dusk.site.ends']) {
      t.ok(has(k) && GM.textKeys().indexOf(k) >= 0, k);
    }
    t.ok(/acaba antes de amanhecer/.test(OV.T('geo.ev.arrived.night.site.ends', { left: '2 h' })));
    // a pergunta curta não repete as horas nem o «pode esperar»
    t.ok(!/esperar pelo dia \(/.test(OV.T('geo.ev.arrived.night.site.asked', { left: '9 h', t: '4 h' })));
    t.ok(/siteRef\.kind === 'site' && gm && gm\.nightAt \? gm\.nightAt\(G, siteRef\) : null/.test(read('js/ui/campaign_ui.js')), 'o briefing também oferece esperar');
  });

  // ---- #7 armas melhores ---------------------------------------------------------------------------------------------
  t.test('late r4 (Sofia): Espingardas Laser no armazém → os veteranos armados trocam (Trocar armas), as pesadas não', () => {
    const G = NEW(38, 0);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    t.eq(CU.gunUpgrades(G, c.id).length, 0, 'sem armas novas não há troca (a pistola do kit inicial não passa a espingarda)');
    G.researched.push('laser_rifle');
    b.stores.laser_rifle = 3;
    const sol = c.soldiers.map((id) => C.findSoldier(G, id));
    sol[1].rank = 3;
    sol[2].loadout = { R: 'heavy_cannon', L: null, belt: ['hc_ap'], pack: [] };
    b.stores.heavy_cannon = (b.stores.heavy_cannon | 0) - 1;
    b.stores.hc_ap = (b.stores.hc_ap | 0) - 1;
    const up = CU.gunUpgrades(G, c.id);
    t.eq(up.length, 3, 'três armas para três soldados');
    t.eq(up[0].sid, sol[1].id, 'o sargento primeiro');
    t.ok(up.every((x) => x.from === 'rifle' && x.to === 'laser_rifle'));
    t.ok(!up.some((x) => x.sid === sol[2].id), 'o canhão pesado fica');
    const clips0 = b.stores.rifle_clip | 0;
    const r = CU.upgradeKit(G, c.id);
    t.ok(r.ok && r.upgraded.length === 3, JSON.stringify(r));
    const s1 = C.findSoldier(G, sol[1].id);
    t.eq(s1.loadout.R, 'laser_rifle');
    t.ok(s1.loadout.belt.indexOf('rifle_clip') < 0, 'os carregadores da espingarda voltam ao armazém');
    t.ok((b.stores.rifle_clip | 0) > clips0, 'carregadores devolvidos');
    t.eq(b.stores.laser_rifle | 0, 0);
    t.ok(s1.loadout.belt.indexOf('grenade') >= 0, 'o resto do equipamento fica');
    t.eq(CU.gunUpgrades(G, c.id).length, 0, 'depois da troca não há mais');
    t.ok(/Rui: Espingarda → Espingarda Laser/.test(CU.upgradeText([{ name: 'Rui', from: 'rifle', to: 'laser_rifle' }])));
    // oferta no Geoscape (fabrico e entrega) e no briefing
    const gsrc = read('js/ui/geo_ui.js');
    t.ok(/const up = upgradeOffer\(evs\.filter\(\(e\) => D\(\)\.items\[e\.item\]/.test(gsrc), 'fabrico concluído oferece a troca');
    t.ok(/buttons: \[kitBtn, up \? up\.btn : null, eqBtn/.test(gsrc), 'entrega oferece a troca');
    t.ok(/id: 'upgrade', text: Tn\('cp\.br\.warn\.upgrade'/.test(read('js/ui/campaign_ui.js')), 'briefing avisa e troca (U)');
    for (const k of ['geo.a.upgrade', 'geo.ev.upgrade.one', 'geo.ev.upgrade.other', 'cp.br.upgrade', 'cp.br.upgrade.tip', 'cp.up.done.one', 'cp.up.done.other', 'cp.up.none', 'cp.br.warn.upgrade.one', 'cp.br.warn.upgrade.other']) t.ok(has(k), k);
  });

  // ---- #9 armazém sobrelotado no Geoscape --------------------------------------------------------------------------
  t.test('late r4 (Sofia): armazém sobrelotado aparece no «!» de Bases e nos avisos, com vírgula decimal', () => {
    const G = NEW(39, 0);
    t.eq(GM.storesOver(G), []);
    const b = G.bases[0];
    b.stores.alien_alloys = (b.stores.alien_alloys | 0) + 400;
    const o = GM.storesOver(G);
    t.eq(o.length, 1);
    t.ok(o[0].used > o[0].cap, JSON.stringify(o));
    const txt = OV.T('geo.alert.stores', { base: 'Lusitânia', used: '57,9', cap: '50' });
    t.ok(/57,9\/50/.test(txt) && /munição/.test(txt), txt);
    const src = read('js/ui/geo_ui.js');
    t.ok(/S\.over = storesOver\(G\);/.test(src) && /S\.over\.length > 0/.test(src), 'o «!» de Bases liga-se');
    t.ok(/dataset: \{ alert: 'stores' \}/.test(src) && /openBase\(o\.baseId, 'market'\)/.test(src), 'aviso persistente com «Vender material»');
    t.ok(/used: fmtDec1\(model\.storage\.used\), cap: fmtDec1\(model\.storage\.cap\)/.test(read('js/ui/campaign_ui.js')), 'relatório com vírgula (já corrigido na ronda 4)');
  });

  // ---- #11 dicas ---------------------------------------------------------------------------------------------------
  t.test('late r4 (Sofia): «Desconhecido» e «h de engenheiro» explicados (dica + rótulo acessível)', () => {
    const src = read('js/ui/base_ui.js');
    t.eq((src.match(/progChip\(lbl\)/g) || []).length, 2, 'os dois selos de ritmo usam progChip');
    t.ok(/'aria-label': tip \? txt \+ '\. ' \+ tip : txt, title: tip/.test(src));
    t.ok(/hoursSub\(T\('base\.prod\.specs'/.test(src) && /hoursSub\(T\('base\.prod\.unitHours'/.test(src));
    t.eq(OV.T('base.research.prog', { p: OV.T('research.progress.unknown') }), 'Ritmo: Desconhecido');
    t.ok(/ainda não sabem quanto tempo vai demorar/.test(OV.T('base.research.progTip.unknown')));
    for (const k of ['none', 'unknown', 'poor', 'average', 'good', 'excellent']) t.ok(has('base.research.progTip.' + k), k);
    t.eq(OV.Tn('base.prod.hoursTip', 10, { hours: 60, t: 6 }), '60 horas de trabalho de engenheiro por unidade: com 10 engenheiros, cerca de 6 h por unidade.');
    t.ok(!/h-eng/.test(OV.T('base.prod.specs', { hours: 60, cost: '$1', space: 2 })), 'sem a abreviatura opaca');
  });

  // ---- #3/#8 e #10: já corrigidos na ronda 4 (verificação) -----------------------------------------------------------
  t.test('late r4: parágrafo da noite sem repetição e lista de construção fixa (corrigidos pelos fixers da ronda 4)', () => {
    t.eq(GM.nightLineKey('night', { crashed: true }, true), 'geo.ev.arrived.night.crash.short');
    t.ok(!/esperar pelo dia \(cerca/i.test(OV.T('geo.ev.arrived.night.crash.short', { t: '5 h' })), 'a variante curta não repete as horas');
    const bsrc = read('js/ui/base_ui.js');
    t.ok(bsrc.indexOf("section(T('base.build.title')") < bsrc.indexOf("section(T('base.fac.underway')"), '«Em construção» por baixo da lista');
  });
};
