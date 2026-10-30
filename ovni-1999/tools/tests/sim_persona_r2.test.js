/* Persona ronda 2 (simulação/dados): terror abandonado custa pelo menos o mesmo que ignorá-lo; o kit médico do
   equipamento inicial usa-se sem investigação; captura sem lugar na contenção conta como abate, não como captura.
   Contrato: docs/CAMPAIGN_API.md §11.8; DESIGN §22. */
'use strict';

module.exports = function (OV, t) {
  const C = OV.Campaign;
  const D = OV.Data;
  const BU = OV.BUnits;
  const LIVE = { ok: 1, panic: 1 };
  const drain = (g) => { let x; while (!(x = g.next()).done); return x.value; };
  const skyOf = (G) => Object.values(G.crafts).find((c) => c.type === 'skyranger');
  const arrive = (craft, kind, obj) => Object.assign(craft, { status: 'patrol', dest: { kind, id: obj.id }, lon: obj.lon, lat: obj.lat, speed: 0 });
  const lineOf = (deb, key) => deb.lines.find((l) => l.key === key) || null;
  const civPts = (deb) => deb.lines.filter((l) => /^bs\.debrief\.civ/.test(l.key) || l.key === OV.Battle.TERROR_ABANDONED_KEY)
    .reduce((s, l) => s + l.points, 0);

  function freshG(seed, diff) {
    const G = C.newCampaign({ seed, difficulty: diff === undefined ? 1 : diff });
    G.events.length = 0;
    return G;
  }
  function placeSite(G, cityId, race) {
    const city = D.citiesById[cityId];
    const s = { id: C.nextId(G, 't'), kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId, lon: city.lon, lat: city.lat, race,
      region: city.region, country: OV.GMath.countryAt(city.lon, city.lat), leftS: 36000 };
    G.sites.push(s);
    return s;
  }
  function placeUfo(G, status, type, lon, lat) {
    const u = {
      id: C.nextId(G, 'u'), type, missionId: null, race: 'sectoid', region: OV.GMath.regionAt(lon, lat), traj: 'P0', wp: 0, lon, lat,
      dest: null, alt: 0, speed: 0, status, dmg: 0, detected: true, hyper: false, groundLeftS: 3600, crashLeftS: 86400, lastSeen: null,
      objective: false, targetBaseId: null, siteCity: null,
    };
    G.ufos.push(u);
    return u;
  }
  // «resposta simbólica»: chega, inicia a batalha e aborta logo no 1.º turno
  function tokenTerror(seed, month) {
    const G = freshG(seed, 2);
    G.month = month;
    const sky = skyOf(G);
    const site = placeSite(G, 'paris', 'floater');
    arrive(sky, 'site', site);
    const B = OV.Battle.create(C.startMission(G, { kind: 'site', id: site.id }, sky.id));
    drain(OV.Battle.beginBattle(B));
    const before = G.score.month.xcom.total - G.score.month.alien.total;
    const model = C.abortMission(G, B);
    return { G, model, delta: G.score.month.xcom.total - G.score.month.alien.total - before };
  }

  t.test('terror abortado no turno 1 custa pelo menos o terror ignorado (meses 0 e 2), com linha própria no relatório', () => {
    for (const month of [0, 2]) {
      for (const seed of [3, 8]) {
        const { G, model, delta } = tokenTerror(seed, month);
        const deb = model.debrief;
        const stake = OV.Missions.expiredPoints(G);
        t.eq(deb.result, 'abort');
        t.ok(!model.craftLost, 'a nave volta');
        t.ok(civPts(deb) <= -stake, 'civis + abandono ≤ −' + stake + ' (mês ' + month + '): ' + civPts(deb));
        t.ok(delta <= -stake, 'pontuação do mês desce pelo menos ' + stake + ': ' + delta);
        const ab = lineOf(deb, OV.Battle.TERROR_ABANDONED_KEY);
        t.ok(ab && ab.points < 0, 'linha «Ataque terrorista sem resposta»');
        t.eq(deb.score, deb.lines.reduce((s, l) => s + l.points, 0));
        t.eq(model.scoreAdded, deb.score);
        t.eq(G.sites.length, 0, 'o local desaparece (sem −expirado a dobrar)');
        t.eq(G.stats.missionsAborted, 1);
      }
    }
  });

  t.test('terror: civis mortos acima do valor de ignorar não somam abandono; vitória e escaramuça sem linha', () => {
    const G = freshG(5, 1);
    const sky = skyOf(G);
    const site = placeSite(G, 'paris', 'floater');
    arrive(sky, 'site', site);
    const B = OV.Battle.create(C.startMission(G, { kind: 'site', id: site.id }, sky.id));
    drain(OV.Battle.beginBattle(B));
    // escaramuça (sem ctx): só os civis contam, como antes
    OV.Battle.abort(B);
    t.eq(lineOf(OV.Battle.debrief(B), OV.Battle.TERROR_ABANDONED_KEY), null);
    const civ = B.units.filter((u) => u.origSide === 'civ').length;
    const lo = OV.Battle.debrief(B, { terrorFloor: civ * 30 - 1 });
    t.eq(lineOf(lo, OV.Battle.TERROR_ABANDONED_KEY), null, 'civis já pesam mais do que o terror ignorado');
    const hi = OV.Battle.debrief(B, { terrorFloor: civ * 30 + 70 });
    t.eq(lineOf(hi, OV.Battle.TERROR_ABANDONED_KEY).points, -70);
    // vitória: nada
    const G2 = freshG(6, 0);
    const sky2 = skyOf(G2);
    const s2 = placeSite(G2, 'paris', 'floater');
    arrive(sky2, 'site', s2);
    const B2 = OV.Battle.create(C.startMission(G2, { kind: 'site', id: s2.id }, sky2.id));
    drain(OV.Battle.beginBattle(B2));
    for (const u of B2.units) if (u.side === 'alien' && LIVE[u.status]) OV.Combat.killUnit(B2, u, null, 'test');
    const m2 = C.finishMission(G2, B2);
    t.eq(m2.debrief.result, 'win');
    t.eq(lineOf(m2.debrief, OV.Battle.TERROR_ABANDONED_KEY), null);
  });

  t.test('kit médico do equipamento inicial: usa-se sem investigação (o tópico só abre o fabrico)', () => {
    t.eq(D.items.medikit.research, null);
    t.eq(D.manufacture.medikit.requires, 'medikit');
    t.ok(D.research.medikit && D.research.medikit.items.indexOf('medikit') >= 0, 'o tópico continua a existir');
    const G = freshG(9, 1);
    t.eq(G.researched, []);
    t.ok((G.bases[0].stores.medikit | 0) > 0 || (skyOf(G).equipment.medikit | 0) > 0, 'há kits no início');
    t.ok(C.availableResearch(G, 'b1').indexOf('medikit') >= 0, 'investigação «Kit Médico» disponível');
    const sky = skyOf(G);
    const ufo = placeUfo(G, 'crashed', 'small_scout', 2.35, 48.85);
    arrive(sky, 'ufo', ufo);
    const m = C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id);
    t.eq(m.researched, []);
    const B = OV.Battle.create(m);
    drain(OV.Battle.beginBattle(B));
    const kit = B.items.find((it) => it.type === 'medikit' && it.owner !== null);
    t.ok(kit, 'o médico leva o kit');
    const medic = B.units.find((u) => u.id === kit.owner);
    if (medic.items.L !== null) BU.giveItem(B, medic, medic.items.L, 'pack', true);
    t.ok(BU.giveItem(B, medic, kit.id, 'L'), 'kit na mão esquerda');
    medic.wounds[1] = 1;
    const v = OV.Act.validate(B, { type: 'medikit', unitId: medic.id, targetId: medic.id, part: 1, kind: 'heal', itemId: kit.id });
    t.eq([v.ok, v.reason], [true, undefined], 'curar sem investigação');
    t.eq(OV.Act.validate(B, { type: 'medikit', unitId: medic.id, targetId: medic.id, kind: 'stim', itemId: kit.id }).ok, true);
  });

  t.test('captura sem lugar na contenção: conta como abate (valor), não como captura (2 × valor)', () => {
    for (const containment of [false, true]) {
      const G = freshG(11, 1);
      if (containment) G.bases[0].grid.push({ type: 'alien_containment', x: 5, y: 0, daysLeft: 0 });
      const sky = skyOf(G);
      const ufo = placeUfo(G, 'landed', 'medium_scout', -3.7, 40.4);
      arrive(sky, 'ufo', ufo);
      const B = OV.Battle.create(C.startMission(G, { kind: 'ufo', id: ufo.id }, sky.id));
      drain(OV.Battle.beginBattle(B));
      const aliens = B.units.filter((u) => u.side === 'alien' && LIVE[u.status]);
      const victim = aliens.find((u) => u.capturable);
      OV.Combat.knockOut(B, victim, null);
      for (const u of aliens) if (u !== victim && LIVE[u.status]) OV.Combat.killUnit(B, u, null, 'test');
      const deadVal = aliens.filter((u) => u !== victim && !u.crashDead).reduce((s, u) => s + (u.value | 0), 0);
      const model = C.finishMission(G, B);
      const deb = model.debrief;
      const cap = lineOf(deb, 'bs.debrief.aliensCaptured');
      const kil = lineOf(deb, 'bs.debrief.aliensKilled');
      t.eq(deb.captured.length, 1, 'o atordoado continua listado (a campanha decide o destino)');
      if (containment) {
        t.eq([cap.n, cap.points], [1, 2 * victim.value]);
        t.eq(kil.points, deadVal);
        t.eq(model.capturedStored, { [victim.type]: 1 });
        t.eq(G.stats.aliensCaptured, 1);
      } else {
        t.eq(cap, null, 'sem linha «capturados vivos»');
        t.eq(kil.points, deadVal + victim.value, 'o que não sobreviveu conta como abatido');
        t.eq(kil.n, deb.kills);
        t.eq(model.capturedLost, { [victim.type]: 1 });
        t.eq(G.stats.aliensCaptured, 0);
      }
      t.eq(G.stats.aliensKilled, deb.kills);
    }
  });
};
