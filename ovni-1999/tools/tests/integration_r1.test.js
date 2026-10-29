/* Ronda 1 de personas — integração: pendentes que cruzavam ficheiros de vários donos. Textos pt-PT dos motivos novos
   do sim (bs.noRoute, paragem 'storage'), bomba guiada e contorno de alcance com standing:true, feminino no relatório e
   no memorial, «Confirmar explosivos» nas Opções, «Como Jogar» com o cursor de teclado, ranhuras auto2/preMission no
   OV.Save, «Esperar pelo dia» (noite no OVNI, relógio parado ao amanhecer), aviso de granadas em Recruta, conselhos da
   primeira missão, cabeçalho do Equipar a bordo e o canhão sozinho contra o Batedor Pequeno em Veterano. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.InventoryUI) load('js/ui/inventory_ui.js');
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const C = OV.Campaign;

  t.test('r1 integração: todos os motivos de OV.Act têm texto (bs.noRoute incluído)', () => {
    t.ok(OV.Act.REASONS.indexOf('noRoute') >= 0);
    t.eq(OV.Act.REASONS.filter((r) => !has('bs.' + r)), [], 'bs.<motivo> em falta');
    t.eq(OV.T('bs.noRoute'), 'Bomba sem rota até ao alvo');
  });

  t.test('r1 integração: cada paragem do fabrico que o sim devolve tem texto na base e no Geoscape', () => {
    const src = read('js/sim/geo/base.js');
    const m = /function payBlock[\s\S]*?\n {2}}\n/.exec(src);
    t.ok(m, 'payBlock não encontrado');
    const reasons = [...new Set([...m[0].matchAll(/return '([a-z]+)'/g)].map((x) => x[1]))];
    t.ok(reasons.indexOf('storage') >= 0, 'storage: ' + reasons);
    const miss = [];
    for (const r of reasons) {
      for (const k of ['base.prod.stalled.', 'base.prod.stalledHelp.', 'base.prod.stalledToast.', 'geo.ev.productionStalled.']) if (!has(k + r)) miss.push(k + r);
    }
    t.eq(miss, []);
    t.ok(OV.GeoUI.model.textKeys().indexOf('geo.ev.productionStalled.storage') >= 0, 'textKeys do Geoscape');
  });

  t.test('r1 integração: bomba guiada (rota tracejada) e contorno de alcance com a reserva de quem se levanta', () => {
    const src = read('js/ui/battle_ui.js');
    t.ok(/reserveTU\(S\.B, u, \{ mode: reserveMode\(\), standing: true \}\)/.test(src), 'updateReach usa standing:true');
    t.ok(/v\.route/.test(src) && /'hud\.target\.guided'/.test(src), 'pré-visualização pela rota');
    t.eq(OV.T('hud.target.guided', { n: 7, pct: 60, tu: 66 }), 'Bomba guiada · rota 7 casas · Acerto ≈ 60 % · 66 UT');
    for (const k of ['hud.target.guided.blast', 'hud.report.revealed', 'hud.report.nowSeen', 'hud.report.showRevealed.tip', 'hud.alienGrenade', 'hud.alienGrenade.clear',
      'hud.tips.title', 'hud.tips.ok', 'hud.tips.spread', 'hud.tips.kneel', 'hud.tips.keepTU', 'hud.tips.kneel.touch', 'hud.tips.keepTU.touch',
      'hud.equip.noWeapons', 'hud.equip.noWeapons.touch', 'hud.equip.hint.touch']) t.ok(has(k), k);
    t.ok(/o clarão revelou-o/.test(OV.T('hud.report.revealed')));
    t.ok(/^Granada alienígena! Afaste os soldados/.test(OV.T('hud.alienGrenade')));
  });

  t.test('r1 integração: reserva standing:true conta o joelho de quem está ajoelhado (igual ao walkPreview)', () => {
    const u = { side: 'xcom', kneel: true, tu: 60, items: { R: null, L: null, belt: [], pack: [] }, stats: { tu: 60 } };
    const B = { reserve: 'none', reserveKneel: true, units: [u], items: [] };
    const a = OV.Act.reserveTU(B, u, { mode: 'none' });
    const b = OV.Act.reserveTU(B, u, { mode: 'none', standing: true });
    t.ok(b >= a, 'standing não reserva menos');
  });

  t.test('r1 integração: auto-equipar sem arma com munição → aviso (armedLo)', () => {
    const armed = OV.InventoryUI.model.armedLo;
    t.eq(armed({ R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] }), true);
    t.eq(armed({ R: 'rifle', L: null, belt: [], pack: [] }), false, 'espingarda sem carregador');
    t.eq(armed({ R: null, L: null, belt: ['grenade'], pack: [] }), false, 'só granadas');
    t.eq(armed({ R: 'stun_rod', L: null, belt: [], pack: [] }), false, 'bastão não é arma de fogo');
    const auto = OV.InventoryUI.model.autoLoadout;
    const s = { id: 's1', stats: { str: 30 } };
    t.eq(armed(auto(s, { rifle: 2 }, { researched: null })), false, 'armazém só com espingardas sem munição');
    t.eq(armed(auto(s, { rifle: 2, rifle_clip: 4 }, { researched: null })), true);
  });

  t.test('r1 integração: feminino no relatório da missão e no memorial', () => {
    const miss = [];
    for (const k of ['scr.db.kia', 'scr.db.mia', 'base.mem.cause.kia', 'base.mem.cause.mia', 'base.mem.cause.craft', 'base.mem.cause.base', 'cp.cause.kia', 'cp.cause.mia', 'cp.cause.craft']) if (!has(k + '.f')) miss.push(k + '.f');
    t.eq(miss, []);
    t.ok(/gk\(f\.kia \? 'scr\.db\.kia' : 'scr\.db\.mia', w\)/.test(read('js/ui/screens.js')), 'screens.js');
    t.ok(/gk\(f\.kia \? 'scr\.db\.kia' : 'scr\.db\.mia', w\)/.test(read('js/ui/campaign_ui.js')) && /gk\('cp\.cause\.'/.test(read('js/ui/campaign_ui.js')), 'campaign_ui.js');
    t.ok(/gk\('base\.mem\.cause\.'/.test(read('js/ui/base_ui.js')), 'base_ui.js');
    // o memorial guarda o sexo do soldado
    const G = C.newCampaign({ seed: 5, difficulty: 0 });
    const sid = Object.keys(G.soldiers)[0];
    G.soldiers[sid].female = true;
    OV.Soldiers.kill(G, sid, 'kia', 'battle');
    t.eq(G.dead[G.dead.length - 1].female, true);
  });

  t.test('r1 integração: Opções «Confirmar explosivos» e «Como Jogar» com o cursor de teclado', () => {
    t.ok(/sseg\('confirmBlast'/.test(read('js/ui/screens.js')), 'linha nas Opções');
    t.ok(/confirmBlast: 'auto'/.test(read('js/main.js')), 'predefinição em main.js');
    for (const v of ['', '.auto', '.always', '.never', '.hint']) t.ok(has('scr.opt.confirmBlast' + v), 'scr.opt.confirmBlast' + v);
    t.eq(OV.BattleUI ? OV.BattleUI.model.blastConfirm({ confirmBlast: 'never' }, 0) : false, false);
    // linhas seguidas (a tabela conta-as sozinha)
    let n = 0;
    while (has('scr.howto.key.' + (n + 1))) n++;
    t.eq(n, 21, 'linhas do teclado');
    t.ok(!has('scr.howto.key.22'));
    const all = Array.from({ length: n }, (_, i) => OV.T('scr.howto.key.' + (i + 1)));
    t.ok(all.every((r) => r.split('|').length === 2), 'tecla|efeito');
    t.ok(all.some((r) => /^Setas\|Mover o cursor/.test(r)) && all.some((r) => /^N\|/.test(r)) && all.some((r) => /^\?\|/.test(r)));
    t.ok(has('scr.howto.touch.4') && has('scr.howto.touch.5'));
    t.ok(/rowsOf\('scr\.howto\.key'\)/.test(read('js/ui/screens.js')), 'sem contagem fixa');
    t.ok(/20 casas/.test(OV.T('scr.br.note.dusk')), 'crepúsculo sem efeito na visão');
  });

  t.test('r1 integração: OV.Save conhece auto2 e preMission; a campanha grava as ranhuras extra pelo OV.Save', () => {
    const S = OV.Save;
    t.eq(S.SLOTS, ['auto', 'auto2', 'preMission', 'autoTurn', '1', '2', '3']);
    const mem = {};
    S.setStorage({ getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } });
    try {
      const G = C.newCampaign({ seed: 9, difficulty: 1 });
      G.events.length = 0;
      const obj = S.toJSON(G, null, { label: 'x' });
      obj.preMission = { siteRef: { kind: 'ufo', id: 'u1' }, craftId: 'c2', t: G.t, seed: G.seed };
      t.eq(S.write('preMission', obj).ok, true);
      t.eq(S.write('auto2', S.toJSON(G)).ok, true);
      t.eq(S.read('preMission').preMission.craftId, 'c2');
      t.eq(S.list().map((e) => e.slot), ['auto2', 'preMission']);
      t.eq(S.load('preMission').G.seed, G.seed);
      t.eq(S.remove('auto2'), true);
      t.eq(S.list().map((e) => e.slot), ['preMission']);
    } finally {
      S.setStorage(null);
    }
    const cu = read('js/ui/campaign_ui.js');
    t.ok(!/lsRaw|extraKey|KEY\('(auto|preMission)/.test(cu), 'campaign_ui grava as ranhuras extra pelo OV.Save');
  });

  t.test('r1 integração: noite no OVNI → «Esperar pelo dia» com as horas até ao dia', () => {
    const M = OV.GeoUI.model;
    const G = C.newCampaign({ seed: 21, difficulty: 1 });
    G.events.length = 0;
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
      lon: 0, lat: 10, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false,
      groundLeftS: 3600, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    let night = 0, day = 0;
    for (let h = 0; h < 24; h++) {
      const g = Object.assign({}, G, { t: G.t + h * 3600 });
      const ph = OV.GMath.dayPhase(g, u.lon, u.lat);
      const r = M.nightAt(g, ref);
      if (ph === 'night') {
        night++;
        t.ok(r && r.h >= 1 && r.h <= 24 && r.crashed === false, 'h ' + h + ': ' + JSON.stringify(r));
        t.eq(OV.GMath.dayPhase({ t: g.t + r.h * 3600 }, u.lon, u.lat), 'day', 'ao fim de ' + r.h + ' h é dia');
      } else {
        day++;
        t.eq(r, null);
      }
    }
    t.ok(night > 0 && day > 0, 'dia e noite num dia: ' + night + '/' + day);
    t.eq(M.nightAt(G, { kind: 'site', id: 'x' }), null, 'só OVNIs');
    for (const k of ['geo.ev.arrived.night', 'geo.ev.arrived.night.crash', 'geo.ev.arrived.dawn', 'geo.a.waitDay', 'geo.toast.waitDay', 'cp.br.note.waitDay', 'cp.br.waitDay.tip', 'cp.br.waitDay.toast']) t.ok(has(k), k);
    t.ok(/runClock\(G, clk, dt, handle, \{ halt: checkWaitDay \}\)/.test(read('js/ui/geo_ui.js')), 'o relógio para ao amanhecer');
  });

  t.test('r1 integração: runClock para entre blocos quando a interface pede (halt)', () => {
    const M = OV.GeoUI.model;
    const G = C.newCampaign({ seed: 3, difficulty: 0 });
    G.events.length = 0;
    const st = { speed: 5, paused: false, acc: 0 };
    let calls = 0;
    const r = M.runClock(G, st, 80, null, { now: () => 0, halt: () => ++calls >= 2 });
    t.eq([r.stopped, r.reason, st.speed], [true, 'ui', 0]);
    t.eq(r.ticks, 2 * OV.TUNE.GEO_CHUNK_TICKS, 'dois blocos');
  });

  t.test('r1 integração: Equipar a bordo diz onde está a nave; investigação passada explicitamente', () => {
    t.ok(has('cp.eq.kicker.away'));
    t.eq(OV.T('cp.eq.kicker.away', { craft: 'Skyranger-1', place: 'França' }), 'Equipar a bordo · Skyranger-1 (França)');
    const cu = read('js/ui/campaign_ui.js'), bu = read('js/ui/base_ui.js'), sc = read('js/ui/screens.js');
    t.ok(/equipScreen\([^)]*researched: G\.researched/.test(cu), 'campaign_ui');
    t.ok(/researched: g\.researched/.test(bu), 'base_ui');
    t.ok(/equipScreen\(host, \{ squad: squad\(\),.*researched: null \}\)/.test(sc), 'Batalha Rápida: tudo conhecido');
    t.ok(!/\.cp-eq \.inv-equip/.test(read('css/campaign.css')), 'regras mortas do campaign.css removidas');
  });

  t.test('r1 integração: primeira missão da campanha passa tips à batalha', () => {
    t.ok(/tips: first/.test(read('js/ui/campaign_ui.js')));
    t.ok(/if \(p\.tips\) openTips\(\)/.test(read('js/ui/battle_ui.js')));
  });

  t.test('r1 integração: DESIGN §15.5 e o contrato estão em dia (T/⇧T, auto2/preMission)', () => {
    const d = read('DESIGN.md');
    const sec = d.slice(d.indexOf('### 15.5'), d.indexOf('### 15.6'));
    t.ok(/T \/ ⇧T/.test(sec) && /Tab moves through the side-panel buttons/.test(sec), '§15.5');
    t.ok(/'auto2','preMission'/.test(read('docs/CAMPAIGN_API.md')), 'CAMPAIGN_API §5.10');
  });

  t.test('r1 integração: Intercetor só com o canhão abate o Batedor Pequeno em Veterano (breakOff 360)', () => {
    const DF = OV.Dogfight;
    let crashed = 0;
    const N = 30;
    for (let seed = 1; seed <= N; seed++) {
      const G = C.newCampaign({ seed, difficulty: 1 });
      G.events.length = 0;
      const u = { id: C.nextId(G, 'u'), type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
        lon: 2.35, lat: 48.85, dest: null, alt: 3, speed: 1000, status: 'flying', dmg: 0, detected: true, hyper: false,
        groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null };
      G.ufos.push(u);
      const c = G.crafts.c2;
      const d = DF.create(G, 'c2', u.id);
      c.weapons.forEach((w, s) => { if (w && w.type !== 'cannon') DF.toggleWeapon(G, d.id, s); });
      t.ok(c.weapons.some((w) => w && w.type === 'cannon'), 'o Intercetor leva canhão');
      DF.setMode(G, d.id, 'standard');
      for (let k = 0; k < 20000; k++) {
        const e = DF.tick(G, d.id).find((x) => x.t === 'df.end');
        if (e) { if (e.outcome === 'crashed') crashed++; break; }
      }
    }
    t.ok(crashed >= N * 0.8, 'abatidos ' + crashed + '/' + N);
  });
};
