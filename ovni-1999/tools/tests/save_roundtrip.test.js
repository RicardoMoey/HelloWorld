/* Gravações (contrato docs/CAMPAIGN_API.md §5.10, §7; DESIGN §18): ida e volta com hash igual (G e B), campanha
   interrompida por gravar/carregar == campanha seguida, batalha a meio, ranhuras com armazenamento falso (quota,
   indisponível, corrompido), migrações, ficheiros exportados/importados e rejeição limpa de importações más. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign;
  const S = OV.Save;
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };
  const errOf = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };

  // armazenamento falso com quota em caracteres
  function fakeStorage(quota) {
    const m = new Map();
    return {
      map: m,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => {
        let used = 0;
        for (const [kk, vv] of m) if (kk !== k) used += vv.length;
        if (quota && used + String(v).length > quota) {
          const e = new Error('The quota has been exceeded.');
          e.name = 'QuotaExceededError';
          throw e;
        }
        m.set(k, String(v));
      },
      removeItem: (k) => { m.delete(k); },
    };
  }
  function crashScenario(seed) {
    const G = C.newCampaign({ seed, difficulty: 1 });
    G.events.length = 0;
    const sky = Object.values(G.crafts).find((c) => c.type === 'skyranger');
    const ufo = { id: C.nextId(G, 'u'), type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2.35, lat: 48.85,
      dest: null, alt: 0, speed: 0, status: 'crashed', dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 86400, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null };
    G.ufos.push(ufo);
    Object.assign(sky, { status: 'patrol', dest: { kind: 'ufo', id: ufo.id }, lon: ufo.lon, lat: ufo.lat });
    const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    return { G, B };
  }
  function botTurns(B, n) {
    for (let k = 0; k < n && B.phase !== 'over'; k++) {
      drain(OV.AI.turn(B, 'xcom'));
      if (B.phase !== 'over') drain(OV.Battle.endPlayerTurn(B));
    }
  }


  t.test('toJSON/fromJSON: forma DESIGN §18, sem events nem _, hash igual, streams vivas depois de carregar', () => {
    const G = C.newCampaign({ seed: 5, difficulty: 2 });
    G.ui = { cam: { lon: 1, lat: 2 } };
    C.event(G, 'craftReady', { craftId: 'c1' });
    const h = C.hash(G);
    const obj = S.toJSON(G, null, { label: 'Jan 1999 — Base', savedAt: '2026-10-29T12:00:00.000Z', build: 'test' });
    t.eq(Object.keys(obj), ['game', 'schema', 'savedAt', 'label', 'build', 'campaign', 'battle']);
    t.eq([obj.game, obj.schema, obj.label, obj.savedAt, obj.build, obj.battle], ['ovni-1999', 1, 'Jan 1999 — Base', '2026-10-29T12:00:00.000Z', 'test', null]);
    t.ok(!('events' in obj.campaign) && !('_' in obj.campaign), 'sem events nem caches');
    t.eq(G.events.length, 1, 'o G original não é tocado');
    const st = S.fromJSON(JSON.parse(JSON.stringify(obj)));
    t.eq(C.hash(st.G), h);
    t.eq(st.B, null);
    t.eq(st.meta, { label: 'Jan 1999 — Base', savedAt: '2026-10-29T12:00:00.000Z', build: 'test' });
    t.eq(st.G.events, []);
    t.eq(st.G.ui, { cam: { lon: 1, lat: 2 } });
    t.ok(st.G._ && !Object.keys(st.G).includes('_'), 'G._ reconstruído e não enumerável');
    // a stream ligada depois de carregar continua a mesma sequência
    const a = C.rng(G, 'geo').u32(), b = C.rng(st.G, 'geo').u32();
    t.eq(a, b);
    t.eq(C.hash(st.G), C.hash(G));
    t.ok(typeof S.toJSON(G).savedAt === 'string' && !Number.isNaN(Date.parse(S.toJSON(G).savedAt)), 'savedAt ISO por omissão');
    // gravado no briefing (missão marcada, batalha por criar): ao carregar o Geoscape volta a andar
    G.activeMission = { siteRef: { kind: 'ufo', id: 'u1' }, craftId: 'c1', startedT: 0 };
    t.eq(S.fromJSON(S.toJSON(G)).G.activeMission, null);
  });

  t.test('gravar com uma interceção em curso é recusado (save.err.busy)', () => {
    const G = C.newCampaign({ seed: 6 });
    G.dogfights.push({ id: 'd1', craftId: 'c2', ufoId: 'u1' });
    t.eq(errOf(() => S.toJSON(G)), 'save.err.busy');
    S.setStorage(fakeStorage());
    t.eq(S.save('1', G), { ok: false, reason: 'busy' });
    S.setStorage(null);
  });

  t.test('campanha: 45 dias → gravar → carregar → 45 dias == 90 dias seguidos (hash)', () => {
    if (!OV.World || typeof OV.World.step !== 'function') {
      t.ok(true, 'OV.World ainda não existe: teste da campanha corrida fica por fazer');
      return;
    }
    const DAY = 17280;
    function runDays(G, days) {
      let left = days * DAY;
      let guard = 0;
      while (left > 0 && guard++ < 200000) {
        if (G.flags.won || G.flags.lost) break;
        const r = OV.World.step(G, Math.min(left, 720));
        left -= r.ticks;
        G.events.splice(0);
        // jogador que mantém o conselho satisfeito: a campanha ociosa perderia no fim de fevereiro
        G.council.badMonths = 0;
        if (r.reason === 'dogfight' && OV.Dogfight && OV.Dogfight.autoResolve) for (const d of G.dogfights.slice()) OV.Dogfight.autoResolve(G, d.id);
        if (r.stopped && r.ticks === 0 && r.reason !== 'event') break;
      }
      return G;
    }
    const A = runDays(C.newCampaign({ seed: 21, difficulty: 1 }), 90);
    const B0 = runDays(C.newCampaign({ seed: 21, difficulty: 1 }), 45);
    const text = JSON.stringify(S.toJSON(B0, null, { savedAt: 'x' }));
    const Bl = S.importFile(text).G;
    t.eq(C.hash(Bl), C.hash(B0), 'hash igual logo após carregar');
    runDays(Bl, 45);
    t.eq([A.t, A.flags.lost], [90 * 86400, false], 'os 90 dias correram');
    t.eq([A.month, A.reports.length, A.history.length], [3, 3, 3], 'três fins de mês');
    t.eq(Bl.t, A.t);
    t.eq(C.hash(Bl), C.hash(A), 'gravar/carregar a meio não muda a campanha');
  });

  t.test('batalha a meio: gravar no início do turno → carregar → mesmo hash; continuar dá o mesmo resultado', () => {
    const run = (saveAt) => {
      let { G, B } = crashScenario(3);
      botTurns(B, 2);
      if (saveAt) {
        const text = JSON.stringify(S.toJSON(G, B, { label: 'x' }));
        const h = OV.Battle.hash(B), hg = C.hash(G);
        const st = S.importFile(text);
        t.eq(OV.Battle.hash(st.B), h, 'hash da batalha');
        t.eq(C.hash(st.G), hg, 'hash da campanha');
        t.eq(st.G.activeMission, G.activeMission);
        G = st.G;
        B = st.B;
      }
      botTurns(B, 2);
      return { hb: OV.Battle.hash(B), hg: C.hash(G), G, B };
    };
    const a = run(false), b = run(true);
    t.eq(b.hb, a.hb, 'batalha continua igual');
    const ma = C.finishMission(a.G, a.B), mb = C.finishMission(b.G, b.B);
    t.eq(C.hash(b.G), C.hash(a.G), 'campanha igual depois do debriefing');
    t.eq(mb.progression, ma.progression);
  });

  t.test('ranhuras: write/read/list/load/remove; quota; indisponível; ranhura inválida; corrompida', () => {
    const fs = fakeStorage();
    S.setStorage(fs);
    for (const slot of S.SLOTS) S.remove(slot);
    t.eq(S.list(), []);
    t.eq(S.load('1'), null);
    const G = C.newCampaign({ seed: 8 });
    t.eq(S.KEY('2'), 'ovni1999.save.2');
    t.eq(S.write('2', S.toJSON(G, null, { label: 'Dois', savedAt: '2026-01-01T00:00:00.000Z' })), { ok: true });
    t.ok(fs.map.has('ovni1999.save.2'));
    t.eq(S.save('auto', G, null, { label: 'Auto' }), { ok: true });
    const L = S.list();
    t.eq(L.map((e) => e.slot), ['auto', '2']);
    const e2 = L[1];
    t.eq([e2.slot, e2.label, e2.savedAt, e2.t, e2.date, e2.month, e2.funds, e2.battle], ['2', 'Dois', '2026-01-01T00:00:00.000Z', 0, '1999-01-01', 0, G.funds, false]);
    t.eq(S.slots(), S.list());
    const st = S.load('2');
    t.eq(C.hash(st.G), C.hash(G));
    t.eq(S.read('9'), null);
    t.eq(S.write('9', {}), { ok: false, reason: 'slot' });
    t.ok(S.remove('auto'));
    t.eq(S.list().length, 1);
    // corrompida: aparece marcada e carregar lança save.err.parse
    fs.setItem('ovni1999.save.3', '{"game":"ovni-1999","schema":1,"campaign":');
    const c = S.list().find((e) => e.slot === '3');
    t.ok(c && c.corrupt === true);
    t.eq(errOf(() => S.load('3')), 'save.err.parse');
    t.eq(S.read('3'), null);
    // batalha da campanha: list() marca battle
    const sc = crashScenario(4);
    t.eq(S.save('autoTurn', sc.G, sc.B, { label: 'Turno' }).ok, true);
    t.eq(S.list().find((e) => e.slot === 'autoTurn').battle, true);
    // quota
    S.setStorage(fakeStorage(1000));
    t.eq(S.save('1', G), { ok: false, reason: 'quota' });
    // indisponível (sem localStorage em Node)
    S.setStorage(null);
    t.eq(S.write('1', S.toJSON(G)), { ok: false, reason: 'unavailable' });
    t.eq(S.list(), []);
    t.eq(S.load('1'), null);
    // armazenamento que lança ao ler (Safari privado)
    S.setStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
    t.eq(S.list(), []);
    t.eq(S.write('1', S.toJSON(G)), { ok: false, reason: 'unavailable' });
    t.eq(S.remove('1'), false);
    S.setStorage(null);
  });

  t.test('importações más rejeitadas com motivo (parse/game/schema) sem lançar outra coisa', () => {
    const G = C.newCampaign({ seed: 12 });
    const good = S.toJSON(G);
    const text = JSON.stringify(good);
    const bad = (mut) => { const o = JSON.parse(text); mut(o); return JSON.stringify(o); };
    const cases = [
      ['', 'save.err.parse'], ['não é json', 'save.err.parse'], ['null', 'save.err.parse'], ['[1,2]', 'save.err.parse'], ['42', 'save.err.parse'],
      ['{}', 'save.err.game'],
      [bad((o) => { o.game = 'xcom'; }), 'save.err.game'],
      [bad((o) => { o.schema = 0; }), 'save.err.schema'],
      [bad((o) => { o.schema = 99; }), 'save.err.schema'],
      [bad((o) => { o.schema = '1'; }), 'save.err.schema'],
      [bad((o) => { delete o.campaign; }), 'save.err.parse'],
      [bad((o) => { o.campaign = null; }), 'save.err.parse'],
      [bad((o) => { delete o.campaign.bases; }), 'save.err.parse'],
      [bad((o) => { o.campaign.t = 'ontem'; }), 'save.err.parse'],
      [bad((o) => { o.campaign.rng.geo = null; }), 'save.err.parse'],
      [bad((o) => { o.campaign.game = 'outro'; }), 'save.err.game'],
      [bad((o) => { o.campaign.crafts.c1.id = 'c9'; }), 'save.err.parse'],
      [bad((o) => { o.battle = { schema: 1, map: 'lixo' }; }), 'save.err.parse'],
      [bad((o) => { o.battle = 'lixo'; }), 'save.err.parse'],
      [bad((o) => { o.battle = { schema: 77 }; }), 'save.err.schema'],
    ];
    for (const [txt, want] of cases) t.eq(errOf(() => S.importFile(txt)), want, 'importar ' + txt.slice(0, 40));
    t.eq(errOf(() => S.fromJSON(null)), 'save.err.parse');
    t.eq(C.hash(S.importFile('﻿' + text).G), C.hash(G), 'BOM no início aceite');
  });

  t.test('migrações: cadeia n → n+1 aplicada por ordem; falta de passo ⇒ save.err.schema', () => {
    t.eq(S.MIGRATIONS.length, S.SCHEMA - 1, 'uma migração por esquema anterior');
    const steps = [null, (o) => { o.campaign.extra = 1; return o; }, (o) => { o.campaign.extra++; o.schema = 3; return o; }];
    const o = S.migrate({ schema: 1, campaign: { schema: 1 } }, steps, 3);
    t.eq(o, { schema: 3, campaign: { schema: 3, extra: 2 } });
    t.eq(errOf(() => S.migrate({ schema: 1, campaign: {} }, [], 2)), 'save.err.schema');
    t.eq(S.migrate({ schema: 1 }), { schema: 1 }, 'esquema atual: nada a fazer');
  });

  t.test('exportFile/importFile: nome pela data do jogo; G direto ou gravação; ida e volta', () => {
    const G = C.newCampaign({ seed: 14 });
    G.t = 86400 * 40;
    const f = S.exportFile(S.toJSON(G));
    t.eq([f.filename, f.name, f.mime], ['ovni1999-1999-02-10.json', 'ovni1999-1999-02-10.json', 'application/json']);
    t.eq(C.hash(S.importFile(f.text).G), C.hash(G));
    t.eq(S.exportFile(G).filename, f.filename, 'aceita G');
    t.eq(errOf(() => S.exportFile({ game: 'x' })), 'save.err.game');
    // batalha rápida (sem campanha) também grava
    const B = OV.Battle.create(OV.Battle.quickMission({ seed: 2 }));
    drain(OV.Battle.beginBattle(B));
    const st = S.importFile(S.exportFile(S.toJSON(null, B)).text);
    t.eq(st.G, null);
    t.eq(OV.Battle.hash(st.B), OV.Battle.hash(B));
  });

};
