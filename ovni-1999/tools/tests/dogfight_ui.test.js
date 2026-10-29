/* Janela de interceção (js/ui/dogfight_ui.js): modelo puro em Node — ritmo de ticks por fotograma, contadores do
   resumo a partir dos eventos de OV.Dogfight.tick, estado textual, armas, resultados (queda no mar, nave danificada),
   chaves pt-PT presentes e nenhuma escrita em G pelo modelo. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const file = path.join(__dirname, '..', '..', 'js', 'ui', 'dogfight_ui.js');
  if (!OV.DogfightUI) vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  const M = OV.DogfightUI.model;
  const DF = OV.Dogfight, Camp = OV.Campaign, D = OV.Data;
  const has = (k) => OV.STR[k] !== undefined;

  function setup(type, o) {
    const opt = o || {};
    const G = Camp.newCampaign({ seed: opt.seed || 3, difficulty: opt.difficulty || 0 });
    G.events.length = 0;
    const u = {
      id: Camp.nextId(G, 'u'), type, missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
      lon: 2.35, lat: 48.85, dest: null, alt: 3, speed: opt.speed || 1000, status: 'flying', dmg: 0, detected: true, hyper: false,
      groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    G.crafts.c2.status = 'out';
    const d = DF.create(G, 'c2', u.id);
    return { G, u, d };
  }
  // corre o combate como a interface: tick → absorb → absorbGeo; verifica as chaves do estado a cada tick
  function run(G, d, mode, cap) {
    const tr = M.newTrack(G, d);
    DF.setMode(G, d.id, mode);
    const seen = { fire: 0, hitUfo: 0, dealt: 0, taken: 0 };
    let n = 0, badKey = null;
    while (!tr.outcome && n++ < (cap || 20000)) {
      const st = M.status(G, d, tr);
      if (!has(st.key) || (st.warn && !has(st.warn.key))) badKey = badKey || st.key;
      const n0 = G.events.length;
      const ev = DF.tick(G, d.id);
      for (const e of ev) {
        if (e.t === 'df.fire' && e.from === 'craft') seen.fire++;
        if (e.t === 'df.hit' && e.target === 'ufo') { seen.hitUfo++; seen.dealt += e.dmg; }
        if (e.t === 'df.hit' && e.target === 'craft') seen.taken += e.dmg;
      }
      M.absorb(tr, G, d, ev);
      M.absorbGeo(tr, G.events.splice(n0));
    }
    return { tr, seen, badKey };
  }

  t.test('dogfight_ui: ticks por fotograma (30 ms, máx. 8, resto guardado)', () => {
    const tick = D.dogfight.tickMs;
    let r = M.ticksFor(0, 16, tick, M.MAX_TICKS);
    t.eq(r.n, 0);
    r = M.ticksFor(r.acc, 16, tick, M.MAX_TICKS);
    t.eq(r.n, 1);
    t.eq(r.acc, 2);
    r = M.ticksFor(0, 250, tick, M.MAX_TICKS);
    t.eq(r.n, 8, 'no máximo 8 ticks');
    t.ok(r.acc < tick, 'o excesso é descartado');
    t.eq(M.ticksFor(5, -10, tick, 8).n, 0, 'dt negativo ignorado');
  });

  t.test('dogfight_ui: resumo coincide com os eventos do combate e as chaves existem', () => {
    const { G, u, d } = setup('small_scout');
    const { tr, seen, badKey } = run(G, d, 'standard');
    t.eq(badKey, null, 'chave de estado em falta');
    t.ok(tr.outcome === 'crashed' || tr.outcome === 'destroyed' || tr.outcome === 'escaped', 'resultado ' + tr.outcome);
    const sm = M.summary(tr);
    t.eq(sm.shots, seen.fire);
    t.eq(sm.hits, seen.hitUfo);
    t.eq(sm.dealt, seen.dealt);
    t.eq(sm.taken, seen.taken);
    t.eq(sm.dogfightId, d.id);
    t.ok(has(sm.titleKey), 'título ' + sm.titleKey);
    for (const s of sm.subs) t.ok(has(s.key), 'subtítulo ' + s.key);
    t.ok(sm.events.some((e) => e.t === 'dogfightEnd'), 'eventos de campanha guardados para o Geoscape');
    t.eq(G.dogfights.length, 0);
    t.ok(sm.seconds > 0 && sm.ticks === tr.ticks);
    if (sm.outcome !== 'escaped') t.ok(sm.ufoDmgPct > 50, 'dano > 50 % ao abater');
    t.eq(u.type, 'small_scout');
  });

  t.test('dogfight_ui: o modelo nunca escreve em G', () => {
    const { G, d } = setup('medium_scout');
    const tr = M.newTrack(G, d);
    DF.setMode(G, d.id, 'aggressive');
    for (let i = 0; i < 120; i++) M.absorb(tr, G, d, DF.tick(G, d.id));
    const h0 = Camp.hash(G);
    M.status(G, d, tr);
    for (let s = 0; s < 2; s++) M.weaponInfo(G, d, s, tr);
    M.summary(tr);
    M.craftLabel(G, G.crafts.c2);
    M.ufoLabel(G, G.ufos[0]);
    t.eq(Camp.hash(G), h0);
  });

  t.test('dogfight_ui: estado das armas (espera, alcance, recarga, desligada, sem munições)', () => {
    const { G, d } = setup('medium_scout');
    const tr = M.newTrack(G, d);
    let w = M.weaponInfo(G, d, 0, tr);
    t.eq(w.state, 'hold', 'Distância não dispara');
    t.eq(w.range, D.craftWeapons.stingray.range * D.dogfight.rangeMul);
    t.eq(w.hit, D.dogfightHitChance(D.craftWeapons.stingray.acc, D.ufos.medium_scout.size));
    DF.setMode(G, d.id, 'standard');
    t.eq(M.weaponInfo(G, d, 0, tr).state, 'range');
    let guard = 0;
    while (!d.weapons[0].reload && guard++ < 2000) M.absorb(tr, G, d, DF.tick(G, d.id));
    w = M.weaponInfo(G, d, 0, tr);
    t.eq(w.state, 'reload');
    t.ok(w.progress >= 0 && w.progress < 1);
    DF.toggleWeapon(G, d.id, 1);
    t.eq(M.weaponInfo(G, d, 1, tr).state, 'off');
    G.crafts.c2.weapons[0].ammo = 0;
    d.weapons[0].reload = 0;
    t.eq(M.weaponInfo(G, d, 0, tr).state, 'empty');
    for (const s of ['ready', 'reload', 'range', 'off', 'empty', 'hold']) t.ok(has('df.w.st.' + s), 'df.w.st.' + s);
  });

  t.test('dogfight_ui: OVNI a fugir, recuo do modo Cauteloso e alcance das armas do OVNI', () => {
    const { G, u, d } = setup('abductor', { speed: 1500 });
    const tr = M.newTrack(G, d);
    t.ok(tr.ufoRange === D.ufos.abductor.weapon.range * D.dogfight.rangeMul);
    d.dist = tr.ufoRange - 8;
    DF.setMode(G, d.id, 'aggressive');
    t.eq(M.status(G, d, tr).warn.key, 'df.st.underFire');
    tr.retreatTick = d.ticks;
    t.eq(M.status(G, d, tr).warn.key, 'df.st.retreat');
    u.speed = D.ufos.abductor.speed;
    t.eq(M.status(G, d, tr).key, 'df.st.fleeing');
    t.eq(M.status(G, d, tr).tone, 'alert');
  });

  t.test('dogfight_ui: queda no mar, nave danificada e nave perdida', () => {
    const base = { id: 'd9', craftId: 'c2', ufoId: 'u1', craftType: 'interceptor', ufoType: 'small_scout', craftMaxHp: 100, craftHp: 100, ufoHp: 50, ufoDmg: 30,
      shots: 3, hits: 1, misses: 2, dealt: 30, taken: 0, ufoShots: 0, ufoHits: 0, ticks: 100, reloadMax: {}, weapons: [], events: [], seaCrash: false };
    const sea = Object.assign({}, base, { outcome: 'crashed', events: [] });
    M.absorbGeo(sea, [{ t: 'ufoDestroyed', ufoId: 'u1' }, { t: 'dogfightEnd' }]);
    t.ok(sea.seaCrash);
    t.eq(M.summary(sea).titleKey, 'df.end.seaCrash');
    t.eq(M.summary(sea).tone, 'good');
    const hurt = Object.assign({}, base, { outcome: 'escaped', taken: 60, craftHp: 40 });
    const sh = M.summary(hurt);
    t.eq(sh.titleKey, 'df.end.damaged');
    t.ok(sh.subs.some((s) => s.key === 'df.sub.damaged' && s.params.p === 40));
    const lost = M.summary(Object.assign({}, base, { outcome: 'craftDestroyed', taken: 100, craftHp: 0 }));
    t.eq(lost.titleKey, 'df.end.craftDestroyed');
    t.eq(lost.tone, 'alert');
    t.ok(!lost.subs.some((s) => s.key === 'df.sub.damaged'));
  });

  t.test('dogfight_ui: textos das posturas, resultados e tamanho aparente', () => {
    for (const m of D.dogfight.modeOrder) {
      t.ok(has('df.mode.' + m), 'df.mode.' + m);
      t.ok(has('df.mode.' + m + '.hint'), 'df.mode.' + m + '.hint');
    }
    for (const o of ['crashed', 'destroyed', 'escaped', 'disengaged', 'craftDestroyed', 'craftRetreated']) {
      t.ok(has('df.end.' + o), 'df.end.' + o);
      t.ok(has('df.sub.' + o), 'df.sub.' + o);
    }
    t.ok(has('df.start'));
    for (const id in D.ufos) {
      t.ok(M.SHAPES[id], 'silhueta para ' + id);
      t.ok(M.apparentR(id, 64) > M.apparentR(id, 640), 'cresce ao aproximar: ' + id);
    }
    t.ok(M.apparentR('battleship', 300) > M.apparentR('small_scout', 300) * 2, 'classe de tamanho');
    t.eq(M.depthK(0), 1);
  });
};
