/* OV.Dogfight: tabela de acerto (REA §6.2), distâncias por modo, aproximação/recuo, munições, tiro e fuga do OVNI,
   recuo do modo Cauteloso a 50 %, resultados aplicados por finish. Contrato: docs/CAMPAIGN_API.md §1.15, §5.5. */
module.exports = function (OV, t) {
  const DF = OV.Dogfight, Camp = OV.Campaign, D = OV.Data;

  function setup(type, o) {
    const opt = o || {};
    const G = Camp.newCampaign({ seed: opt.seed || 1, difficulty: opt.difficulty || 0 });
    G.events.length = 0;
    const u = {
      id: Camp.nextId(G, 'u'), type, missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
      lon: 2.35, lat: 48.85, dest: null, alt: 3, speed: 1000, status: 'flying', dmg: 0, detected: true, hyper: false,
      groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    for (const id of ['c2', 'c3']) G.crafts[id].status = 'out';
    const d = DF.create(G, opt.craft || 'c2', u.id);
    return { G, u, d, craft: G.crafts[opt.craft || 'c2'] };
  }
  // substitui temporariamente um gancho de outro módulo (OV partilhado entre ficheiros de teste)
  function withHook(obj, key, fn, body) {
    const had = Object.prototype.hasOwnProperty.call(obj, key);
    const old = obj[key];
    obj[key] = fn;
    try {
      body();
    } finally {
      if (had) obj[key] = old;
      else delete obj[key];
    }
  }
  const runUntil = (G, id, pred, max) => {
    let all = [];
    for (let k = 0; k < (max || 5000); k++) {
      const ev = DF.tick(G, id);
      all = all.concat(ev);
      if (pred(ev) || !ev.length && !Camp.findDogfight(G, id)) break;
    }
    return all;
  };

  t.test('tabela de acerto (REA §6.2): (acc × (100 + 300/(5 − tamanho)) + 100) / 200', () => {
    const table = {
      stingray: [56, 61, 70, 88, 100], avalanche: [64, 70, 80, 100, 100], cannon: [20, 22, 25, 31, 50],
      laser_cannon: [28, 31, 35, 44, 70], plasma_beam: [40, 44, 50, 63, 100], fusion_ball: [80, 88, 100, 100, 100],
    };
    for (const w in table) {
      t.eq([0, 1, 2, 3, 4].map((s) => D.dogfightHitChance(D.craftWeapons[w].acc, s)), table[w], w);
    }
    const { G, d } = setup('large_scout');
    t.eq([DF.hitChance(G, d.id, 0), DF.hitChance(G, d.id, 1)], [61, 22]);
  });

  t.test('create: distância 640, modo Distância, uma entrada por arma montada, máximo de dogfights', () => {
    const { G, u, d, craft } = setup('small_scout');
    t.eq([d.dist, d.mode, d.ticks, d.over, d.outcome, d.ufoReload], [640, 'standoff', 0, false, null, 0]);
    t.eq(d.weapons, [{ slot: 0, enabled: true, reload: 0 }, { slot: 1, enabled: true, reload: 0 }]);
    t.eq(craft.dogfightId, d.id);
    t.eq(G.dogfights, [d]);
    const bo = D.ufos.small_scout.breakOff;
    t.ok(d.escapeT >= bo && d.escapeT <= 2 * bo, 'fuga breakOff + RNG(0, breakOff) em Recruta');
    t.eq(DF.create(G, 'c2', u.id), null, 'nave já em combate');
    const d2 = DF.create(G, 'c3', u.id);
    t.eq([d2.escapeT, d2.ufoReload], [d.escapeT, d.ufoReload], 'o mesmo OVNI partilha as contagens');
    G.ufos.push(Object.assign({}, u, { id: 'u99' }));
    G.crafts.c1.status = 'out';
    t.eq(DF.create(G, 'c1', 'u99'), null, 'MAX_DOGFIGHTS = 2');
    t.eq(JSON.parse(JSON.stringify(G.dogfights)), G.dogfights);
  });

  t.test('distâncias por modo: Cauteloso = maior alcance ×8, Normal = menor, Agressivo 64, Desengatar 800', () => {
    const { G, d } = setup('small_scout');
    const td = (m) => {
      DF.setMode(G, d.id, m);
      return DF.targetDist(G, d.id);
    };
    t.eq([td('standoff'), td('cautious'), td('standard'), td('aggressive')], [560, 240, 80, 64]);
    DF.toggleWeapon(G, d.id, 1); // canhão desligado
    t.eq([td('standard'), td('cautious')], [240, 240]);
    DF.toggleWeapon(G, d.id, 1);
    G.crafts.c2.weapons[0].ammo = 0;
    t.eq([td('cautious'), td('standard')], [80, 80], 'sem mísseis conta só o canhão');
    t.eq(td('disengage'), 800);
    t.eq(DF.setMode(G, d.id, 'voar'), false);
  });

  t.test('movimento: aproxima ' + D.dogfight.approach + ' por tick, recua +4 por tick até ao alvo', () => {
    const { G, d } = setup('small_scout');
    const A = D.dogfight.approach;
    DF.setMode(G, d.id, 'standard');
    const ev = DF.tick(G, d.id);
    t.eq(d.dist, 640 - A);
    t.ok(ev.some((e) => e.t === 'df.move' && e.dist === 640 - A));
    d.dist = 500;
    DF.setMode(G, d.id, 'standoff');
    DF.tick(G, d.id);
    t.eq(d.dist, 504);
    d.dist = 558;
    DF.tick(G, d.id);
    t.eq(d.dist, 560, 'não passa do alvo');
    DF.tick(G, d.id);
    t.eq(d.dist, 560);
  });

  t.test('armas: dispara ao entrar no alcance, gasta munição, recarga pelo modo, míssil voa 8 por tick', () => {
    const { G, d, craft } = setup('medium_scout');
    const A = D.dogfight.approach;
    DF.setMode(G, d.id, 'aggressive');
    d.dist = 240 + A;
    let ev = DF.tick(G, d.id); // 240: Stingray no alcance
    t.eq(d.dist, 240);
    t.eq(ev.filter((e) => e.t === 'df.fire').map((e) => [e.from, e.slot, e.weapon]), [['craft', 0, 'stingray']]);
    t.eq(craft.weapons[0].ammo, 5);
    t.eq(d.weapons[0].reload, D.craftWeapons.stingray.reload.aggressive);
    t.eq(d.projectiles.length, 1);
    t.eq(d.projectiles[0].pos, 0);
    ev = DF.tick(G, d.id);
    t.eq(d.projectiles[0].pos, 8 - A, '+8 do míssil, −A da nave que avança');
    // chega quando pos ≥ dist: ~30 ticks
    const all = runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.hit' && x.target === 'ufo' || x.t === 'df.miss' && x.from === 'craft'), 40);
    t.ok(all.some((x) => x.t === 'df.hit' && x.target === 'ufo' || x.t === 'df.miss' && x.from === 'craft'), 'míssil resolvido');
    t.eq(d.weapons[0].reload > 0, true);
  });

  t.test('tiro do OVNI: só dentro do alcance ×8, primeiro tiro imediato, contagem RNG(0,R)+R', () => {
    const { G, d, craft } = setup('large_scout', { difficulty: 1 });
    DF.setMode(G, d.id, 'standoff');
    for (let k = 0; k < 50; k++) t.ok(!DF.tick(G, d.id).some((e) => e.from === 'ufo'), 'fora do alcance (272)');
    d.dist = 272;
    DF.setMode(G, d.id, 'aggressive');
    const ev = DF.tick(G, d.id);
    t.eq(ev.filter((e) => e.t === 'df.fire' && e.from === 'ufo').length, 1);
    const R = Math.max(1, 48 - 2 * 2);
    t.ok(d.ufoReload >= R && d.ufoReload <= 2 * R, 'recarga ' + d.ufoReload);
    t.ok(craft.hp >= 80 && craft.hp <= 100, 'dano RNG(0, 20)');
  });

  t.test('o OVNI só dispara contra um dogfight de cada vez', () => {
    const { G, u, d } = setup('large_scout');
    const d2 = DF.create(G, 'c3', u.id);
    d.dist = d2.dist = 200;
    let shots = [0, 0];
    for (let k = 0; k < 200; k++) {
      shots[0] += DF.tick(G, d.id).filter((e) => e.t === 'df.fire' && e.from === 'ufo').length;
      if (Camp.findDogfight(G, d2.id)) shots[1] += DF.tick(G, d2.id).filter((e) => e.t === 'df.fire' && e.from === 'ufo').length;
      if (!Camp.findDogfight(G, d.id)) break;
    }
    t.ok(shots[0] > 0, 'o primeiro leva os tiros');
    t.eq(shots[1], 0);
  });

  t.test('Cauteloso: com dano ≥ 50 % recua para a Distância', () => {
    const { G, d, craft } = setup('large_scout', { seed: 4 });
    DF.setMode(G, d.id, 'cautious');
    d.dist = 240;
    craft.hp = 52;
    const all = runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.retreat'), 3000);
    t.ok(all.some((x) => x.t === 'df.retreat'), 'recuou');
    t.ok(craft.hp <= 50 && craft.hp > 0);
    t.eq(d.mode, 'standoff');
    t.eq(DF.targetDist(G, d.id), 560);
  });

  t.test('fuga: aos breakOff + RNG(0,breakOff) − 30·coef ticks o OVNI acelera e sai a > 640', () => {
    for (const diff of [0, 1, 2]) {
      const { G, u, d } = setup('small_scout', { seed: 7 + diff, difficulty: diff });
      const e0 = d.escapeT;
      const bo = D.ufos.small_scout.breakOff;
      t.ok(e0 >= bo - 60 * diff && e0 <= 2 * bo - 60 * diff, 'contagem ' + e0);
      DF.setMode(G, d.id, 'standoff');
      const ufoId = u.id;
      let breakAt = -1, outcome = null;
      for (let k = 1; k < 1000 && !outcome; k++) {
        const ev = DF.tick(G, d.id);
        if (ev.some((e) => e.t === 'df.breakOff')) breakAt = k;
        const end = ev.find((e) => e.t === 'df.end');
        if (end) outcome = [end.outcome, k];
      }
      t.eq(breakAt, e0);
      t.eq(outcome, ['escaped', e0 + 20], '560 → 644 a +4 por tick, a contar do tick da fuga');
      t.eq(Camp.findUfo(G, ufoId).speed, D.ufos.small_scout.speed);
      t.eq(G.events.map((e) => e.t), ['ufoEscaped', 'dogfightEnd']);
      t.eq([G.crafts.c2.status, G.crafts.c2.dest, G.crafts.c2.dogfightId], ['returning', { kind: 'base', id: 'b1' }, null]);
      t.eq(G.dogfights, []);
    }
  });

  t.test('Intercetor (Stingray + Canhão) contra Pequeno Batedor: abatido em ≤ 320 ticks na maioria de 20 sementes', () => {
    let down = 0, worst = 0;
    const seen = {};
    for (let s = 1; s <= 20; s++) {
      const { G, d } = setup('small_scout', { seed: s });
      const o = DF.autoResolve(G, d.id, 'standard');
      seen[o] = (seen[o] | 0) + 1;
      if (o === 'crashed' || o === 'destroyed') {
        down++;
        worst = Math.max(worst, d.ticks);
      }
    }
    t.ok(down >= 10, 'abatidos ' + JSON.stringify(seen));
    t.ok(worst <= 320, 'pior ' + worst);
    t.ok(seen.crashed > 0 && seen.destroyed > 0, 'há quedas (missão em terra) e destruições');
  });

  t.test('finish: queda ⇒ Missions.onUfoDown e regresso; nave destruída ⇒ World.loseCraft', () => {
    const calls = [];
    withHook(OV.Missions, 'onUfoDown', (G, ufoId, how, craftId) => {
      calls.push([ufoId, how, craftId]);
      const u = Camp.findUfo(G, ufoId);
      u.status = 'crashed';
      Camp.event(G, 'ufoCrashed', { ufoId, craftId, lon: u.lon, lat: u.lat });
    }, () => {
      const { G, u, d } = setup('medium_scout');
      u.dmg = 99;
      DF.setMode(G, d.id, 'aggressive');
      d.dist = 64;
      d.weapons[0].enabled = false; // só o canhão: quedas sem destruir
      const all = runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.end'), 3000);
      const end = all.find((x) => x.t === 'df.end');
      t.eq(end.outcome, 'crashed');
      t.eq(calls, [[u.id, 'crashed', 'c2']]);
      t.eq(G.events.map((e) => e.t), ['ufoCrashed', 'dogfightEnd']);
      t.eq(G.events[1], Object.assign({}, G.events[1], { dogfightId: d.id, craftId: 'c2', ufoId: u.id, outcome: 'crashed' }));
      t.eq([G.crafts.c2.status, G.crafts.c2.dogfightId, G.dogfights.length], ['returning', null, 0]);
      t.eq(DF.tick(G, d.id), [], 'dogfight terminado não avança');
    });
    const lost = [];
    withHook(OV.World, 'loseCraft', (G, craftId, reason) => lost.push([craftId, reason]), () => {
      const { G, d, craft } = setup('battleship');
      DF.setMode(G, d.id, 'aggressive');
      craft.hp = 1;
      d.dist = 400;
      const all = runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.end'), 3000);
      t.eq(all.find((x) => x.t === 'df.end').outcome, 'craftDestroyed');
      t.eq(lost, [['c2', 'dogfight']]);
      t.eq(G.events.map((e) => e.t), ['dogfightEnd']);
    });
  });

  t.test('finish sem OV.Missions/OV.World (depuração): queda simples e perda da nave pelas regras do contrato', () => {
    withHook(OV.Missions, 'onUfoDown', undefined, () => {
      const { G, u, d } = setup('small_scout');
      u.dmg = 40;
      d.dist = 80;
      DF.setMode(G, d.id, 'aggressive');
      runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.end'), 3000);
      const ufo = Camp.findUfo(G, u.id);
      t.ok(!ufo || ufo.status === 'crashed');
      t.ok(G.events.some((e) => e.t === 'ufoCrashed' || e.t === 'ufoDestroyed'));
    });
    withHook(OV.World, 'loseCraft', undefined, () => {
      const { G, d, craft } = setup('battleship', { craft: 'c3' });
      DF.setMode(G, d.id, 'aggressive');
      craft.hp = 1;
      d.dist = 400;
      runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.end'), 3000);
      t.ok(!G.crafts.c3);
      t.ok(G.bases[0].crafts.indexOf('c3') < 0);
      t.eq(G.stats.craftsLost, 1);
      t.eq(G.score.month.xcom.total, -D.crafts.interceptor.score);
      t.eq(G.events.map((e) => e.t), ['craftLost', 'dogfightEnd']);
    });
  });

  t.test('desengatar e nave sem munições: regresso à base', () => {
    const { G, d } = setup('small_scout');
    DF.disengage(G, d.id);
    const ev = runUntil(G, d.id, (e) => e.some((x) => x.t === 'df.end'), 100);
    t.eq(ev.find((x) => x.t === 'df.end').outcome, 'disengaged');
    t.eq(G.crafts.c2.status, 'returning');
    const s2 = setup('medium_scout', { seed: 2 });
    s2.craft.weapons[0].ammo = 0;
    s2.craft.weapons[1].ammo = 0;
    DF.setMode(s2.G, s2.d.id, 'aggressive');
    s2.d.dist = 400;
    const ev2 = runUntil(s2.G, s2.d.id, (e) => e.some((x) => x.t === 'df.end'), 1000);
    t.eq(ev2.find((x) => x.t === 'df.end').outcome, 'craftRetreated');
  });

  t.test('determinismo: a mesma semente dá o mesmo resultado, ticks e hash', () => {
    const run = () => {
      const { G, d } = setup('large_scout', { seed: 12, difficulty: 1 });
      const o = DF.autoResolve(G, d.id, 'aggressive');
      return [o, d.ticks, G.crafts.c2 ? G.crafts.c2.hp : -1, Camp.hash(G)];
    };
    t.eq(run(), run());
  });
};
