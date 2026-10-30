/* Ronda 3 de personas — jogadora casual (Sofia, Recruta, trackpad): mortes no fim do turno X-COM no relatório do
   turno (granadas alienígenas com espoleta), nave já a caminho de um ataque terrorista no «Enviar equipa» / «OVNI
   aterrou» (para onde vai e o que custa desviá-la), crepúsculo à chegada, concordância de género e plurais, munição de
   intercetor em caixas inteiras (quantidade sugerida no Mercado). O comportamento no navegador está em
   qa/persona_r3_casual.mjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.alsoPromotedKey) load('js/ui/campaign_ui.js');
  if (!OV.BattleUI) load('js/ui/battle_ui.js');
  const M = OV.GeoUI.model, BM = OV.BattleUI.model, D = OV.Data, C = OV.Campaign, S = OV.STR;
  const has = (k) => typeof S[k] === 'string' && S[k].length > 0;
  const NEW = (seed, difficulty) => C.newCampaign({ seed, difficulty: difficulty | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const crafts = (G) => Object.keys(G.crafts).map((id) => G.crafts[id]);
  const LIVE = { ok: 1, panic: 1, berserk: 1 };
  function withoutAI(fn) {
    const saved = OV.AI;
    delete OV.AI;
    try { return fn(); } finally { if (saved !== undefined) OV.AI = saved; }
  }

  // ---- (a) explosões no fim do turno X-COM ---------------------------------------------------------------------
  t.test('relatório do turno: fim do turno X-COM, turno alienígena e início do turno seguinte, pela ordem', () => {
    const e = (key, name, side, turn) => ({ key, params: { name }, kind: 'bad', own: true, side, turn });
    const entries = [
      e('hud.log.kia', 'Liu Yan', 'xcom', 9),
      e('hud.log.hit', 'Hendrik', 'xcom', 9),
      { key: 'hud.log.alienKilled', params: { name: 'Sectoide' }, kind: 'good', own: false, side: 'xcom', turn: 9 },
      e('hud.log.hit', 'Pieter', 'alien', 9),
      e('bs.morale.panic', 'Zhao', 'xcom', 10),
    ];
    const rows = BM.turnReportRows(entries, 9);
    t.eq(rows.map((r) => r.key), ['hud.report.turnEnd', 'hud.log.kia', 'hud.log.hit', 'hud.report.alienTurn', 'hud.log.hit', 'hud.report.turnStart', 'bs.morale.panic']);
    t.eq(BM.reportSummary(rows), '1 morto · 2 feridos · 1 em pânico');
    // só o fim do turno X-COM: sem a secção do turno alienígena
    t.eq(BM.turnReportRows(entries.slice(0, 2), 9).map((r) => r.key), ['hud.report.turnEnd', 'hud.log.kia', 'hud.log.hit']);
    // sem endNo (chamada antiga): tudo o que é X-COM conta como início do turno — nenhuma baixa se perde
    t.eq(BM.turnReportRows(entries).filter((r) => r.kind !== 'sect').length, 4);
    for (const k of ['hud.report.turnEnd', 'hud.report.alienTurn', 'hud.report.title.since', 'hud.log.how.alienGrenade', 'hud.log.how.alienGrenadeBy']) t.ok(has(k), k);
  });

  t.test('granada alienígena com espoleta 0 no fim do turno X-COM: a baixa chega ao relatório, com a causa', () => {
    const B = OV.Battle.create(OV.Battle.quickMission({ seed: 21, ufoType: 'medium_scout', terrain: 'FARM', landed: true, difficulty: 0 }));
    const ctx = { last: {}, seenAt: {} };
    const entries = [];
    const play = (gen) => {
      let r;
      while (!(r = gen.next()).done) {
        const en = BM.logEntry(B, r.value, ctx);
        // como o noteEvent da interface: lado e turno no momento do evento
        if (en) { en.turn = B.turn; en.side = B.side; entries.push(en); }
      }
      return r.value;
    };
    withoutAI(() => play(OV.Battle.beginBattle(B)));
    const sq = B.units.filter((u) => u.side === 'xcom' && LIVE[u.status] && u.onMap);
    const al = B.units.find((u) => u.side === 'alien');
    t.ok(sq.length >= 2 && al, 'equipa e um alienígena');
    const victim = sq[0];
    const tile = (victim.z * B.map.h + victim.y) * B.map.w + victim.x;
    const g = OV.BUnits.newItem(B, 'alien_grenade', { at: tile });
    g.fuse = 0;
    g.primedBy = al.id;
    OV.Battle.rebuildDerived(B);
    const hp0 = victim.hp;
    entries.length = 0;
    const endNo = B.turn;
    withoutAI(() => play(OV.Battle.endPlayerTurn(B)));
    t.ok(victim.status === 'dead' || victim.hp < hp0, 'a granada atingiu o soldado');
    const own = entries.filter((x) => x.own);
    t.ok(own.length >= 1, 'entradas nossas: ' + own.length);
    const rows = BM.turnReportRows(entries, endNo);
    t.eq(rows.filter((r) => r.kind !== 'sect').length, own.length, 'nenhuma entrada nossa fica fora do relatório');
    t.eq(rows[0].key, 'hud.report.turnEnd', 'a secção do fim do turno vem primeiro');
    const vrow = rows.find((r) => r.params && r.params.name === victim.name);
    t.ok(vrow && rows.indexOf(vrow) > 0, 'a vítima está no relatório');
    const txt = OV.T(vrow.key, vrow.params);
    t.ok(/granada alienígena/.test(txt), txt);
    // a interface usa este caminho (número de série, não índice: o registo corta a 400 entradas)
    const ui = read('js/ui/battle_ui.js');
    t.ok(/const mark = S\.logSeq, endNo = S\.B\.turn \| 0;/.test(ui) && /e\.seq = \+\+S\.logSeq;/.test(ui), 'marca por número de série');
    t.ok(/hurt\.some\(\(e\) => e\.key === 'hud\.report\.turnEnd'\) \? 'hud\.report\.title\.since'/.test(ui), 'título «Desde o fim do seu turno»');
    // o registo (📄) também separa o fim do turno X-COM das ações do jogador
    t.ok(/\(S\.B\.turn \| 0\) === S\.endNo\) e\.end = true;/.test(ui) && /e\.end \? T\('hud\.log\.turnEnd', \{ n: e\.turn \}\)/.test(ui), 'registo com «fim do turno X-COM»');
    t.eq(OV.T('hud.log.turnEnd', { n: 9 }), 'Turno 9 — fim do turno X-COM (granadas)');
  });

  // ---- (b) nave já a caminho de outro alvo -------------------------------------------------------------------
  function busyScene(seed) {
    const G = NEW(seed, 0);
    const sky = crafts(G).find((c) => D.crafts[c.type].transport);
    const city = Object.keys(D.citiesById)[0];
    const site = { id: C.nextId(G, 't'), kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: city, lon: 19.04, lat: 47.5, race: 'sectoid', leftS: 9 * 3600 };
    G.sites.push(site);
    const ufo = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon: 2, lat: 45, hyper: false, race: 'sectoid', missionId: null, crashLeftS: 0, groundLeftS: 5 * 3600, detected: true };
    G.ufos.push(ufo);
    Object.assign(sky, { status: 'out', lon: 5, lat: 45, dest: { kind: 'site', id: site.id } });
    return { G, sky, site, ufo, sref: { kind: 'site', id: site.id }, uref: { kind: 'ufo', id: ufo.id } };
  }
  t.test('nave a caminho de um ataque terrorista: busyDest diz para onde e o que custa desviá-la', () => {
    const { G, sky, uref, sref } = busyScene(41);
    const bd = M.busyDest(G, sky, uref);
    t.ok(bd && bd.stake === 'terror' && bd.points === OV.Missions.expiredPoints(G) && bd.leftS === 9 * 3600, JSON.stringify(bd));
    t.eq(M.busyDest(G, sky, sref), null, 'para o próprio destino não é desvio');
    t.ok(/^a caminho do ataque em /.test(M.headingText(G, bd.ref)), M.headingText(G, bd.ref));
    t.eq(M.headingText(G, uref), 'a caminho do ' + M.ufoName(G.ufos[G.ufos.length - 1]));
    // a regressar ou no hangar: livre
    sky.status = 'returning';
    t.eq(M.busyDest(G, sky, uref), null);
    sky.status = 'ready';
    t.eq(M.busyDest(G, sky, uref), null);
    // transporte com equipa a caminho de outro OVNI em terra: missão; intercetor a perseguir: 'other'
    const u2 = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon: 10, lat: 40, hyper: false, race: 'sectoid', missionId: null, groundLeftS: 3600, detected: true };
    G.ufos.push(u2);
    Object.assign(sky, { status: 'out', dest: { kind: 'ufo', id: u2.id } });
    t.eq(M.busyDest(G, sky, uref).stake, 'mission');
    const icp = crafts(G).find((c) => !D.crafts[c.type].transport);
    Object.assign(icp, { status: 'out', lon: 5, lat: 45, dest: { kind: 'ufo', id: u2.id } });
    t.eq(M.busyDest(G, icp, uref).stake, 'other');
  });
  t.test('«Enviar equipa» e «OVNI aterrou»: destino na linha, transportes livres primeiro, aviso e confirmação', () => {
    const { G, sky, uref } = busyScene(42);
    const line = M.teamEtaLine(G, uref, 0);
    t.ok(/já segue a caminho do ataque em .* sem resposta \(−500 pontos\)/.test(line), line);
    // um segundo transporte livre passa à frente na lista (mesmo que mais lento)
    const rows0 = M.craftsFor(G, null, uref).filter((r) => D.crafts[G.crafts[r.craftId].type].transport);
    t.eq(rows0[0].busy, 1, 'só um transporte: está ocupado');
    const src = read('js/ui/geo_ui.js');
    t.ok(/\(a\.busy - b\.busy\)/.test(src), 'ordenação: livres antes dos ocupados');
    t.ok(/const bd = busyDest\(G, c, st\.target \|\| null\);/.test(src) && /\(bd \? ' · ' \+ headingText\(G, bd\.ref\) : ''\)/.test(src), 'linha da nave com «· a caminho de …»');
    t.ok(/if \(!divertAsk\(c\.id, st\.target, send\)\) send\(\);/.test(src), 'escolher a nave pergunta antes de desviar');
    t.ok(/if \(!divertAsk\(st\.craftId, ref, send\)\) send\(\);/.test(src), 'escolher o alvo pergunta antes de desviar');
    t.ok(/if \(!divertAsk\(craftId, ref, send\)\) send\(\);/.test(src), 'clique no globo pergunta antes de desviar');
    t.ok(/label: T\('geo\.int\.divert\.keep'\), value: false, kind: 'primary'/.test(src), '«Manter rumo» é o Enter');
    const p = { craft: 'Skyranger-1', heading: 'a caminho do ataque em Budapeste', target: 'OVNI-4', dest: 'Ataque em Budapeste', points: '500', t: '9 h' };
    t.eq(OV.T('geo.int.divert.now', p), 'Skyranger-1 já segue a caminho do ataque em Budapeste.');
    t.ok(/ninguém responde ao ataque.*500 pontos/.test(OV.T('geo.int.divert.terror', p)));
    for (const k of M.textKeys()) if (!has(k)) t.ok(false, 'texto em falta: ' + k);
    sky.status = 'ready';
    sky.dest = null;
    t.ok(!/já segue/.test(M.teamEtaLine(G, uref, 0)), 'nave livre: sem aviso');
  });

  // ---- (c) crepúsculo à chegada ------------------------------------------------------------------------------
  t.test('crepúsculo à chegada: nightAt devolve dusk, «Esperar pelo dia» oferecido, atacar continua por omissão', () => {
    const G = NEW(5, 0);
    let lon = null;
    for (let x = -180; x < 180 && lon === null; x++) if (OV.GMath.dayPhase(G, x, 52) === 'dusk') lon = x;
    t.ok(lon !== null, 'há um ponto ao crepúsculo');
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon, lat: 52, hyper: false, race: 'sectoid', missionId: null, groundLeftS: 3600, detected: true };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    const nt = M.nightAt(G, ref);
    t.ok(nt && nt.dusk === true && nt.h >= 1, JSON.stringify(nt));
    t.eq(OV.GMath.dayPhase({ t: G.t + nt.h * 3600 }, lon, 52), 'day', 'ao fim de h horas é dia pleno');
    // a luz do crepúsculo não escurece as casas para a visão X-COM (SHADE_DUSK ≤ DARK_SHADE): a escolha por omissão é atacar
    t.ok(OV.TUNE.SHADE_DUSK <= OV.TUNE.DARK_SHADE, 'crepúsculo não é «escuro» para a visão');
    t.eq(M.waitIsDefault(G, ref, nt), false);
    t.eq(M.waitIsDefault(G, ref, Object.assign({}, nt, { dusk: false })), true, 'a mesma situação de noite, em Recruta: esperar');
    const txt = OV.T('geo.ev.arrived.dusk', { t: '2 h', d: 20 });
    t.ok(/crepúsculo/.test(txt) && /20 casas/.test(txt) && /2 h/.test(txt), txt);
    const src = read('js/ui/geo_ui.js');
    t.ok(/const ph = nt && nt\.dusk \? 'dusk' : 'night';/.test(src), 'popup escolhe o texto do crepúsculo');
    t.ok(/title: T\(ev\.dawn && !nt \? 'geo\.ev\.arrived\.dawn'/.test(src), '«Amanheceu» só com dia pleno');
    t.ok(/const wait = nt && !\(nt\.site && !nt\.lasts\) \? \{ label: T\('geo\.a\.waitDay'\)/.test(src), 'botão «Esperar pelo dia» com noite ou crepúsculo (terror só se o ataque durar até ao dia)');
    // o briefing diz o mesmo (visão até 20 casas)
    t.ok(/20 casas/.test(S['scr.br.note.dusk']));
  });

  // ---- (d) género e plurais ----------------------------------------------------------------------------------
  t.test('género e plurais: Promovida, fabrico neutro, 1 apto / 1 ferido, «Também promovida»', () => {
    t.eq(OV.T('scr.db.promoted.f', { rank: 'Sargento' }), 'Promovida a Sargento');
    for (const f of ['js/ui/screens.js', 'js/ui/campaign_ui.js']) t.ok(/T\(gk\('scr\.db\.promoted', w\), \{ rank: T\(promo\.nameKey\) \}\)/.test(read(f)), f + ': promoção com género');
    t.ok(!/prontos/.test(S['geo.ev.productionDone.body']) && /\{qty\} × \{item\}/.test(S['geo.ev.productionDone.body']), 'fabrico neutro');
    t.ok(!/entregues/.test(S['geo.ev.delivery.item']), 'entrega neutra');
    t.eq(OV.Tn('base.pers.fit', 1) + ' · ' + OV.Tn('base.pers.wounded', 1), '1 apto · 1 ferido');
    t.eq(OV.Tn('base.pers.fit', 0) + ' · ' + OV.Tn('base.pers.wounded', 3), '0 aptos · 3 feridos');
    t.eq(OV.Tn('base.pers.free', 1) + ' · ' + OV.Tn('base.pers.busy', 1), '1 livre · 1 ocupado');
    t.eq(OV.Tn('base.crafts.n', 1) + ' · ' + OV.Tn('base.crafts.cap', 1), '1 nave · 1 hangar');
    t.eq(OV.Tn('geo.ev.arrived.mission.body', 1, { craft: 'S', target: 'OVNI-1' }), 'S chegou a OVNI-1 com 1 soldado pronto. Iniciar a missão?');
    t.eq(OV.Tn('hud.medk.charges', 1), '1 carga');
    t.eq(OV.Tn('hud.med.wounds', 1), '1 ferida');
    t.eq(OV.Tn('up.locked', 1).indexOf('1 artigo ainda'), 0);
    t.eq(OV.Tn('geo.int.readyN', 1), '1 pronta');
    t.eq(OV.T('cp.br.warn.heavy.f', { name: 'Ana', w: 30, str: 25 }), 'Ana vai sobrecarregada (30/25): perde UT e energia.');
    const K = OV.CampaignUI.alsoPromotedKey;
    t.eq([K(1, true), K(1, false), K(2, true), K(3, false)], ['cp.db.alsoPromoted.one.f', 'cp.db.alsoPromoted.one', 'cp.db.alsoPromoted.other.f', 'cp.db.alsoPromoted.other']);
    for (const k of ['one', 'one.f', 'other', 'other.f']) t.ok(has('cp.db.alsoPromoted.' + k), k);
    // nenhuma chave substituída por .one/.other continua a ser pedida sem plural
    const ui = ['js/ui/base_ui.js', 'js/ui/geo_ui.js', 'js/ui/inventory_ui.js', 'js/ui/battle_ui.js', 'js/ui/screens.js', 'js/ui/ufopaedia.js', 'js/ui/campaign_ui.js'].map(read).join('\n');
    for (const k of ['base.pers.soldierFit', 'base.pers.freeBusy', 'base.sol.sub', 'base.stores.sub', 'base.crafts.sub', 'geo.i.craftsN', 'geo.int.readyN', 'geo.fix.noTroops', 'geo.ev.arrived.mission.body', 'hud.med.wounds', 'hud.medk.charges', 'hud.medk.partSel', 'hud.medk.partBtn', 'hud.equip.missing', 'scr.qb.squadN', 'up.locked', 'cp.db.alsoPromoted']) {
      t.ok(!new RegExp("[^n]\\(\\s*'" + k.replace(/\./g, '\\.') + "'\\s*,\\s*\\{").test(ui), k + ' sem T() de singular/plural fixo');
    }
  });

  // ---- (e) munição de intercetor ------------------------------------------------------------------------------
  t.test('munição em caixas: sugestão que enche as naves e guarda uma recarga, Mercado já com a quantidade', () => {
    const G = NEW(9, 0);
    const b = G.bases[0];
    const icps = crafts(G).filter((c) => (c.weapons || []).some((w) => w && w.type === 'cannon'));
    t.ok(icps.length >= 1, 'intercetores com canhão');
    const per = Math.ceil(D.craftWeapons.cannon.ammoMax / D.craftWeapons.cannon.ammoPerItem);
    b.stores.cannon_rounds = 0;
    const cannon0 = icps[0].weapons.find((w) => w && w.type === 'cannon');
    cannon0.ammo = D.craftWeapons.cannon.ammoMax - 6;
    const s1 = M.ammoSuggest(G, b.id, 'cannon_rounds');
    t.eq(s1.clip, 50);
    t.eq(s1.qty, 1 + per * icps.length, 'falta 1 caixa + uma recarga completa por canhão');
    b.stores.cannon_rounds = 2;
    b.deliveries = (b.deliveries || []).concat([{ id: 'd-x', kind: 'item', itemId: 'cannon_rounds', n: 3, etaT: G.t + 3600 }]);
    const s2 = M.ammoSuggest(G, b.id, 'cannon_rounds');
    t.eq([s2.have, s2.coming, s2.qty], [2, 3, Math.max(1, s1.qty - 5)], 'desconta armazém e encomendas');
    G.funds = D.items.cannon_rounds.buy * 2 + 10;
    t.eq(M.ammoSuggest(G, b.id, 'cannon_rounds').qty, 2, 'não sugere mais do que os fundos pagam');
    G.funds = 0;
    t.eq(M.ammoSuggest(G, b.id, 'cannon_rounds').qty, 1, 'pelo menos 1');
    // a regra do rearme (caixas inteiras, como no original) não mudou
    t.ok(/const need = U\.idiv\(Math\.min\(wd\.rearmPerHour, wd\.ammoMax - w\.ammo \+ clip - 1\), clip\);/.test(read('js/sim/geo/base.js')), 'BaseSim.rearm gasta caixas inteiras');
    const src = read('js/ui/geo_ui.js');
    t.ok(/openBase\(c\.baseId, 'market', \{ item: items\[0\], qty: sug\.qty \}\)/.test(src), 'aviso abre o Mercado com a sugestão');
    t.ok(/openBase\(c\.baseId, 'market', \{ item, qty: item \? ammoSuggest\(G, c\.baseId, item\)\.qty : null \}\)/.test(src), 'confirmação «sem munição» também');
    const bui = read('js/ui/base_ui.js');
    t.ok(/if \(P\.qty > 0\) S\.qty\[P\.item\] = P\.qty \| 0;/.test(bui) && /qty: \(opts && opts\.qty\) \|\| null/.test(bui), 'o Mercado aceita a quantidade');
    t.ok(/def\.kind === 'craft_ammo' && def\.rounds > 1 \? el\('div', \{ class: 'bsc-row-sub', text: T\('base\.market\.clip'/.test(bui), 'linha do Mercado explica as caixas');
    t.ok(/caixas inteiras de 50 munições/.test(OV.T('geo.int.noAmmo.clip', { clip: 50 })));
    t.eq(OV.T('geo.a.buyAmmoN', { n: 9 }), 'Comprar munição (×9)');
    t.ok(/rearme .* caixas inteiras/.test(OV.T('base.market.clip', { n: 50 })));
  });
};
