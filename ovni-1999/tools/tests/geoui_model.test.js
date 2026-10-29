/* Geoscape (js/ui/geo_ui.js): modelo puro — relógio do contrato §6.3, reações a todos os eventos, textos pt-PT de
   todas as razões do sim, listas da interceção e formatos. Carrega o ficheiro de interface em Node (sem DOM no load). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  if (!OV.GeoUI) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ui', 'geo_ui.js'), 'utf8'), { filename: 'geo_ui.js' });
  const M = OV.GeoUI.model;
  const newG = (seed) => OV.Campaign.newCampaign({ seed: seed || 11, difficulty: 1 });
  const hasKey = (k) => OV.STR[k] !== undefined;

  t.test('geoui: todos os tipos de evento do catálogo têm reação', () => {
    const miss = Object.keys(OV.Campaign.EVENTS).filter((k) => !M.REACT[k]);
    t.eq(miss, [], 'eventos sem reação');
    for (const k of Object.keys(M.REACT)) t.ok(['popup', 'toast', 'scene', 'action', 'debug', 'none'].indexOf(M.REACT[k]) >= 0, k);
    t.eq(M.classify({ t: 'ufoLost', stop: false }), 'toast');
    t.eq(M.classify({ t: 'ufoLost', stop: true }), 'popup');
    t.eq(M.classify({ t: 'dogfightStart', stop: true }), 'scene');
    t.eq(M.classify({ t: 'tipoNovo', stop: false }), 'debug');
  });

  t.test('geoui: razões e avisos do sim têm texto pt-PT', () => {
    const miss = [];
    for (const r of M.WORLD_REASONS) if (!hasKey('geo.err.' + r)) miss.push('geo.err.' + r);
    for (const w of M.WORLD_WARNS) if (!hasKey('geo.warn.' + w)) miss.push('geo.warn.' + w);
    for (const r of M.MISSION_REASONS) if (!hasKey('geo.err.mission.' + r)) miss.push('geo.err.mission.' + r);
    for (const k of M.textKeys()) if (!hasKey(k)) miss.push(k);
    t.eq(miss, [], 'chaves em falta');
    // a fonte estática: todas as chaves geo.* literais do ficheiro existem
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ui', 'geo_ui.js'), 'utf8');
    const lit = [...new Set((src.match(/'geo\.[a-zA-Z0-9_.]*[a-zA-Z0-9_]'/g) || []).map((s) => s.slice(1, -1)))];
    const plural = (k) => hasKey(k + '.one') && hasKey(k + '.other');
    t.eq(lit.filter((k) => !hasKey(k) && !plural(k) && !/\.$/.test(k)), [], 'chaves literais em falta');
  });

  t.test('geoui: toasts agrupados para todos os tipos não bloqueantes', () => {
    const G = newG();
    for (const type of Object.keys(M.REACT)) {
      if (M.REACT[type] !== 'toast' && M.REACT[type] !== 'debug') continue;
      const one = M.toastFor(G, type, [{ t: type, craftId: 'c2', ufoId: 'u1', baseId: 'b1', soldierId: Object.keys(G.soldiers)[0], countryId: 'usa', itemId: 'stingray_missile', what: 'ammo', reason: 'noFuel', region: 'europe' }]);
      t.ok(one.text && one.text.indexOf('⟦') < 0, type + ': ' + one.text);
      const many = M.toastFor(G, type, [{ t: type, ufoId: 'u1', craftId: 'c2', baseId: 'b1' }, { t: type, ufoId: 'u2', craftId: 'c3', baseId: 'b1' }, { t: type, ufoId: 'u3', craftId: 'c1', baseId: 'b1' }]);
      t.ok(many.text && many.text.indexOf('⟦') < 0, type + ' ×3: ' + many.text);
    }
    t.eq(M.toastFor(G, 'craftReady', [{ craftId: 'c2' }, { craftId: 'c3' }]).text, '2 naves prontas para descolar.');
  });

  t.test('geoui: relógio avança SPEEDS ticks por passo de 80 ms e respeita o orçamento', () => {
    const speeds = OV.TUNE.GEO_SPEEDS;
    for (let i = 0; i < speeds.length; i++) {
      const G = newG(3);
      G.debug = null;
      const st = { speed: i, paused: false, acc: 0 };
      const seen = [];
      const r = M.runClock(G, st, 80, (evs) => seen.push(...evs), { now: () => 0 });
      if (!r.stopped) t.eq(r.ticks, speeds[i], 'velocidade ' + i);
      else t.ok(r.ticks <= speeds[i] && st.speed === 0, 'parou e caiu para 5 s');
      t.eq(r.steps, 1);
    }
    // pausa: nada avança
    const G = newG(3);
    const t0 = G.t;
    const st = { speed: 5, paused: true, acc: 0 };
    t.eq(M.runClock(G, st, 500, null, { now: () => 0 }).ticks, 0);
    t.eq(G.t, t0);
    // no máximo 3 passos por fotograma; a dívida de tempo não se acumula
    const st2 = { speed: 0, paused: false, acc: 0 };
    const r2 = M.runClock(G, st2, 1000, null, { now: () => 0 });
    t.ok(r2.steps <= 3, 'passos ' + r2.steps);
    t.ok(st2.acc <= 80 * 3, 'acc ' + st2.acc);
    // orçamento de 12 ms: o relógio de teste "salta" 20 ms por chamada ⇒ um só bloco
    let fake = 0;
    const st3 = { speed: 5, paused: false, acc: 0 };
    const r3 = M.runClock(G, st3, 80, null, { now: () => (fake += 20) });
    t.ok(r3.ticks <= OV.TUNE.GEO_CHUNK_TICKS || r3.stopped, 'orçamento respeitado: ' + r3.ticks);
  });

  t.test('geoui: relógio pára num evento stop, cai para 5 s e entrega os eventos', () => {
    const G = newG(7);
    const st = { speed: 5, paused: false, acc: 0 };
    const got = [];
    let stopped = null;
    for (let i = 0; i < 400 && !stopped; i++) {
      const r = M.runClock(G, st, 80, (evs) => got.push(...evs), { now: () => 0 });
      if (r.stopped) stopped = r;
    }
    t.ok(stopped, 'parou');
    t.eq(st.speed, 0, 'velocidade 5 s');
    t.ok(got.some((e) => e.stop), 'evento stop entregue');
    t.eq(G.events.length, 0, 'fila escoada');
    // batalha em curso: World recusa e o relógio não avança
    const G2 = newG(7);
    G2.activeMission = { siteRef: { kind: 'ufo', id: 'u1' }, craftId: 'c1', startedT: 0 };
    const st2 = { speed: 3, paused: false, acc: 0 };
    const r2 = M.runClock(G2, st2, 80, null, { now: () => 0 });
    t.eq([r2.ticks, r2.reason], [0, 'battle']);
  });

  t.test('geoui: listas da interceção usam World.canOrder', () => {
    const G = newG(5);
    const rows = M.craftsFor(G, 'b1', null);
    t.eq(rows.map((r) => r.craftId), ['c1', 'c2', 'c3']);
    t.ok(rows.every((r) => r.ok), 'todas prontas');
    // um OVNI em voo detetado: o Skyranger só o pode seguir (noWeapons)
    G.ufos.push({ id: 'u90', type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1, lon: -5, lat: 41, dest: { lon: 0, lat: 45 }, alt: 2, speed: 1000, status: 'flying', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null });
    const ref = { kind: 'ufo', id: 'u90' };
    const r2 = M.craftsFor(G, null, ref);
    const sky = r2.find((r) => r.craftId === 'c1');
    t.eq([sky.ok, sky.warn], [true, 'noWeapons']);
    const icp = r2.find((r) => r.craftId === 'c2');
    t.ok(icp.ok && !icp.warn && icp.eta && icp.eta.h > 0, 'intercetor pronto com ETA');
    const tg = M.targetsFor(G, 'c2');
    t.eq(tg.map((x) => x.ref.kind || x.ref), ['ufo']);
    // em manutenção abaixo de 50 %: recusada com notReady
    G.crafts.c3.status = 'refuel';
    G.crafts.c3.fuel = 100;
    const r3 = M.craftsFor(G, 'b1', null).find((r) => r.craftId === 'c3');
    t.eq([r3.ok, r3.reason], [false, 'notReady']);
    t.ok(M.reasonText('notReady').indexOf('⟦') < 0);
    // no ar: o alvo «regressar à base» aparece
    t.ok(OV.World.launch(G, 'c2', ref).ok);
    t.ok(M.targetsFor(G, 'c2').some((x) => x.ref === 'home'), 'regressar à base');
  });

  t.test('geoui: cartão do OVNI só identifica o tipo com hiper-onda', () => {
    const G = newG(5);
    const u = { id: 'u7', type: 'large_scout', missionId: null, race: 'floater', region: 'europe', lon: 2, lat: 48, dest: { lon: 10, lat: 50 }, alt: 3, speed: 1800, status: 'flying', detected: true, hyper: false, crashLeftS: 0 };
    const rows = M.ufoRows(G, u);
    const get = (k) => (rows.find((r) => r[0] === k) || [])[1];
    t.eq(get('geo.i.type'), OV.T('geo.unknown'));
    t.eq(get('geo.i.race'), undefined);
    t.eq(get('geo.i.size'), OV.T('ufo.size.1'));
    t.ok(/Nordeste|Este/.test(get('geo.i.heading')), get('geo.i.heading'));
    t.eq(get('geo.i.place'), 'França');
    u.hyper = true;
    const rows2 = M.ufoRows(G, u);
    t.eq((rows2.find((r) => r[0] === 'geo.i.type') || [])[1], OV.T('ufo.large_scout'));
    t.eq((rows2.find((r) => r[0] === 'geo.i.race') || [])[1], OV.T('race.floater'));
    t.eq(M.ufoName(u), 'OVNI-7');
  });

  t.test('geoui: formatos e financiamento', () => {
    t.eq(M.fmtDur(0.5), '30 min');
    t.eq(M.fmtDur(2), '2 h');
    t.eq(M.fmtDur(2.25), '2 h 15 min');
    t.eq(M.fmtDur(50), '2 d 2 h');
    t.eq(M.fmtLL(-9.14, 38.72), '38,7° N · 9,1° O');
    t.eq(M.compass(0), 'Norte (0°)');
    t.eq(M.compass(225), 'Sudoeste (225°)');
    t.eq(M.placeName(-9.14, 38.72), 'Portugal');
    t.eq(M.placeName(-30, 40), OV.T('region.north_atlantic'));
    const G = newG(5);
    const rows = M.fundingRows(G);
    t.eq(rows.length, G.countries.length);
    t.eq(rows.reduce((s, r) => s + r.funding, 0), OV.Economy.income(G));
    t.ok(rows[0].funding >= rows[rows.length - 1].funding, 'ordenado');
    t.eq(M.craftName(G, G.crafts.c2), 'Intercetor-1');
    t.eq(M.craftStatusKey(G.crafts.c2), 'geo.cst.ready');
  });
};
