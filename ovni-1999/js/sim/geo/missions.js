/* Estratégia alienígena (DESIGN.md §3.18, §3.17; REA 02-geoscape §5; contrato docs/CAMPAIGN_API.md §1.11–§1.14,
   §3.1–§3.2, §5.4). Dono de G.alienMissions, G.sites, G.alienBases (criação, abastecimento, revelação por agentes e
   abastecimento) e G.alien; ciclo de vida dos OVNIs (o movimento e a deteção são do OV.World).

   OV.Missions = {
     planMonth(G)                         guião do mês (Data.scriptsForMonth); G.plannedMonth = G.month
     think30m(G) ; scan10m(G) ; daily(G) ; monthEnd(G)          passos 10, 6, 15 e 17 do contrato §3.1
     spawnMission(G, type, {region?, race?, cityId?, delayMin?, targetBaseId?, alienBaseId?, script?}) → alienMission
     spawnUfo(G, missionId) → ufo        próximo OVNI da vaga atual (entrada na zona 5)
     onUfoWaypoint(G, ufoId) ; onUfoLiftOff(G, ufoId)
     onUfoDown(G, ufoId, 'crashed'|'destroyed', craftId|null)   queda no mar a ≤ crashCoastNm da costa plana até terra
     onSiteCleared(G, siteRef, 'win'|'abort'|'loss') ; onResearch(G, topicId)
     removeUfo(G, ufoId) → ufo|null      retira um OVNI (missão, naves que o seguiam); usado pelo World nos ataques à base
   Retaliação (ours): ao encontrar a base, baseSpotted {baseId, missionId, etaS} (paragem) e pelo menos
   RETALIATION_WARNING_MIN até o Couraçado partir; o Couraçado do ataque nasce já detetado (ufoDetected).
     regionWeights(G) → {regionId: peso}  pesos das missões da tabela (×nearBaseWeightMul a ≤ nearBaseNm de uma base X-COM)
     expiredPoints(G) → int               pontos alienígenas de um terror ignorado neste mês (ours: −500 nos meses 0–1)
   }
   Trajetórias: a perna i → i+1 voa à altitude pts[i][1] e a pts[i][2] % da velocidade máxima; um ponto com altitude 0
   significa «aterra no ponto anterior durante groundTimer × 5 s» (5 s se não for terra; cidades não se testam). O último
   ponto é a saída. Exceções: a Nave de Abastecimento (objetivo 'supply') voa para a base alienígena e aterra lá; o
   Couraçado do ataque à base voa para a base X-COM (o World trata a chegada).
   G.alien (além de tables, cities, retaliations do contrato): pendingPacts [{countryId, missionId}] — pactos de
   infiltração que se assinam no fim do mês; newPacts {month, countries:[id]} — pactos assinados no último fim de mês;
   lastReveal {month, alienBaseId} | null — base revelada pelos agentes no último fim de mês (relatório mensal).
   Streams: 'ai' para escolhas estratégicas (região, tipo, raça, cidade, retaliação, país do pacto, busca da base X-COM);
   'geo' para pontos, temporizadores e abastecimento/revelação. */
(function (OV) {
  'use strict';

  const D = () => OV.Data;
  const Camp = () => OV.Campaign;
  const GM = () => OV.GMath;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);

  // ---- ajudas ----------------------------------------------------------------------------------------------------
  function mem(G) {
    if (!G.alien || typeof G.alien !== 'object') G.alien = {};
    const A = G.alien;
    if (!A.tables || typeof A.tables !== 'object') A.tables = {};
    if (!Array.isArray(A.cities)) A.cities = [];
    if (!Array.isArray(A.retaliations)) A.retaliations = [];
    if (!Array.isArray(A.pendingPacts)) A.pendingPacts = [];
    if (A.newPacts === undefined) A.newPacts = null;
    if (A.lastReveal === undefined) A.lastReveal = null;
    return A;
  }
  const ai = (G) => Camp().rng(G, 'ai');
  const geo = (G) => Camp().rng(G, 'geo');
  const ev = (G, type, data) => Camp().event(G, type, data);
  function score(G, side, pts, lon, lat) {
    if (!pts || !OV.Economy || typeof OV.Economy.addScore !== 'function') return;
    if (lon === undefined || lon === null) OV.Economy.addScore(G, side, pts);
    else OV.Economy.addScore(G, side, pts, lon, lat);
  }
  function dropTarget(G, kind, id, lon, lat) {
    if (OV.World && typeof OV.World.dropTarget === 'function') OV.World.dropTarget(G, kind, id, lon, lat);
  }
  const findMission = (G, id) => Camp().findAlienMission(G, id);
  const regionDef = (rid) => D().regions[rid] || null;
  // região que recebe as missões (as oceânicas delegam)
  function missionRegionOf(rid) {
    const r = regionDef(rid);
    if (!r) return null;
    return r.ocean ? r.missionRegion : rid;
  }
  const centroidLL = (rid) => {
    const c = regionDef(rid).centroid;
    return { lon: c[0], lat: c[1] };
  };
  const running = (G, type, region) => G.alienMissions.some((m) => m.type === type && m.region === region);
  const commanderKnown = (G) => !!(G.flags && G.flags.commanderInterrogated);
  // escolha com pesos sem gastar sorteios quando só há uma opção
  function weightedKey(r, w) {
    const keys = Object.keys(w).filter((k) => w[k] > 0);
    if (!keys.length) return null;
    if (keys.length === 1) return keys[0];
    return r.weighted(w);
  }
  function withoutMuton(w) {
    const o = {};
    for (const k in w) if (k !== 'muton') o[k] = w[k];
    return o;
  }
  function countdownS(G, timerMin) {
    return D().missionRules.countdown(timerMin, geo(G)) * 60;
  }
  function completedFacilities(base) {
    return (base.grid || []).filter((f) => (f.daysLeft | 0) === 0);
  }

  // ---- regiões --------------------------------------------------------------------------------------------------
  function nearAnyBase(G, rid, nm) {
    const c = centroidLL(rid);
    return G.bases.some((b) => GM().distNm(b, c) <= nm);
  }
  // pesos das regiões para as missões da tabela: regionWeight × nearBaseWeightMul perto de uma base (§3.18, ours)
  function regionWeights(G) {
    const R = D().missionRules;
    const out = {};
    for (const rid in D().regions) {
      const r = D().regions[rid];
      if (r.ocean || !(r.weight > 0)) continue;
      out[rid] = r.weight * (nearAnyBase(G, rid, R.nearBaseNm) ? R.nearBaseWeightMul : 1);
    }
    return out;
  }
  function tableOf(G, rid) {
    const A = mem(G);
    return A.tables[rid] || Object.assign({}, D().regions[rid].missionWeights);
  }
  function freeTypes(G, rid, table) {
    const out = {};
    for (const k in table) if (table[k] > 0 && !running(G, k, rid)) out[k] = table[k];
    return out;
  }
  function takeFromTable(G, rid, type) {
    const A = mem(G);
    const t = tableOf(G, rid);
    delete t[type];
    if (Object.keys(t).length) A.tables[rid] = t;
    else delete A.tables[rid];
  }
  // missão da tabela: região por peso, tipo pela tabela da região (retirado até a tabela esvaziar)
  function pickTableMission(G) {
    const r = ai(G);
    const w = regionWeights(G);
    const cand = {};
    for (const rid in w) {
      const full = D().regions[rid].missionWeights;
      if (Object.keys(freeTypes(G, rid, tableOf(G, rid))).length || Object.keys(freeTypes(G, rid, full)).length) cand[rid] = w[rid];
    }
    const region = weightedKey(r, cand);
    if (!region) return null;
    let avail = freeTypes(G, region, tableOf(G, region));
    if (!Object.keys(avail).length) {
      delete mem(G).tables[region];
      avail = freeTypes(G, region, tableOf(G, region));
    }
    const type = weightedKey(r, avail);
    if (!type) return null;
    takeFromTable(G, region, type);
    return { type, region };
  }
  function baseRegion(G) {
    if (!G.bases.length) return null;
    const b = G.bases.length > 1 ? ai(G).pick(G.bases) : G.bases[0];
    return missionRegionOf(b.region || GM().regionAt(b.lon, b.lat));
  }
  function pickRegionByWeight(G, type) {
    const w = regionWeights(G);
    const cand = {};
    for (const rid in w) if (!running(G, type, rid)) cand[rid] = w[rid];
    return weightedKey(ai(G), cand);
  }
  // região terrestre com centróide a ≤ maxNm de uma base X-COM (por peso); senão a mais próxima
  function pickNearBaseRegion(G, type, maxNm) {
    const nm = maxNm || D().missionRules.nearBaseNm;
    const cand = {};
    let best = null, bestD = Infinity;
    for (const rid in D().regions) {
      const r = D().regions[rid];
      if (r.ocean || !(r.missionZones[4] && r.missionZones[4].length) || running(G, type, rid)) continue;
      const c = centroidLL(rid);
      let d = Infinity;
      for (const b of G.bases) d = Math.min(d, GM().distNm(b, c));
      if (d <= nm && r.weight > 0) cand[rid] = r.weight;
      if (d < bestD) { bestD = d; best = rid; }
    }
    return weightedKey(ai(G), cand) || best;
  }
  // terror: região (×terrorNearBaseWeightMul perto de uma base X-COM) entre as que têm cidades não atacadas há pouco,
  // depois cidade uniforme
  function pickTerrorCity(G, type) {
    const A = mem(G);
    const r = ai(G);
    const regionsWith = () => Object.keys(D().regions).filter((rid) => {
      const reg = D().regions[rid];
      return reg.cities.length && !running(G, type, rid) && reg.cities.some((c) => A.cities.indexOf(c) < 0);
    });
    let regs = regionsWith();
    if (!regs.length) {
      A.cities = [];
      regs = regionsWith();
    }
    if (!regs.length) return null;
    // ours: regiões perto de uma base X-COM pesam missionRules.terrorNearBaseWeightMul (orig: uniforme)
    const R = D().missionRules;
    const w = {};
    for (const rid of regs) w[rid] = nearAnyBase(G, rid, R.terrorNearBaseNm || R.nearBaseNm) ? R.terrorNearBaseWeightMul || 1 : 1;
    const rid = regs.length === 1 ? regs[0] : weightedKey(r, w);
    const cities = D().regions[rid].cities.filter((c) => A.cities.indexOf(c) < 0);
    const cityId = cities.length === 1 ? cities[0] : r.pick(cities);
    A.cities.push(cityId);
    const max = tune('TERROR_CITIES_MEMORY', 12);
    while (A.cities.length > max) A.cities.shift();
    return { region: rid, cityId };
  }

  // ---- raças ---------------------------------------------------------------------------------------------------
  // bases alienígenas sem Mutões enquanto nenhum comandante foi interrogado (o caminho da vitória precisa de um)
  function pickRace(G, type) {
    const r = ai(G);
    const w = D().raceWeights(type, G.month);
    let race = weightedKey(r, w);
    if (race === 'muton' && type === 'alien_base' && !commanderKnown(G)) race = weightedKey(r, withoutMuton(w)) || race;
    return race || 'sectoid';
  }
  function battleshipRace(G, m, race) {
    if (race !== 'muton' || commanderKnown(G)) return race;
    return weightedKey(ai(G), withoutMuton(D().raceWeights(m.type, G.month))) || race;
  }

  // ---- missões --------------------------------------------------------------------------------------------------
  function spawnMission(G, type, opts) {
    const o = opts || {};
    const def = D().alienMissions[type];
    if (!def) throw new Error('Missions.spawnMission: tipo ' + type);
    mem(G);
    const region = missionRegionOf(o.region || baseRegion(G)) || 'europe';
    const race = o.race || pickRace(G, type);
    const delay = o.delayMin !== undefined && o.delayMin !== null && o.delayMin > 0 ? Math.floor(o.delayMin) : null;
    const m = {
      id: Camp().nextId(G, 'm'), type, region, race, wave: 0, ufoCounter: 0,
      countdownS: delay !== null ? delay * 60 : countdownS(G, def.waves[0].timer),
      liveUfos: [], cityId: o.cityId || null, targetBaseId: o.targetBaseId || null, alienBaseId: o.alienBaseId || null,
      startedT: G.t | 0, script: o.script || null,
    };
    G.alienMissions.push(m);
    if (def.objective === 'retaliation') {
      G.alien.retaliations.push({ month: G.month | 0, region });
      ev(G, 'retaliation', { missionId: m.id, region });
    }
    return m;
  }

  // ainda há OVNIs por lançar? (retaliação: o ataque à base conta como uma vaga extra quando a base foi encontrada)
  function spawnsLeft(m, def) {
    if (def.objective === 'retaliation' && m.targetBaseId) return m.wave <= def.waves.length;
    return m.wave < def.waves.length;
  }

  function runScript(G, s) {
    const r = ai(G);
    if (s.executionOdds < 100 && !r.pct(s.executionOdds)) return [];
    const out = [];
    for (let n = 0; n < (s.count || 1); n++) {
      let type, region, cityId = null;
      if (!s.missionWeights) {
        const pick = pickTableMission(G);
        if (!pick) continue;
        type = pick.type;
        region = pick.region;
      } else {
        type = weightedKey(r, s.missionWeights);
        if (!type) continue;
        if (s.target === 'city') {
          const c = pickTerrorCity(G, type);
          if (!c) continue;
          region = c.region;
          cityId = c.cityId;
        } else if (s.target === 'baseRegion') region = baseRegion(G);
        else if (s.target === 'nearBase') region = pickNearBaseRegion(G, type, s.maxBaseDistNm);
        else region = pickRegionByWeight(G, type);
        if (!region) continue;
        if (type === 'alien_retaliation' && running(G, type, region)) continue;
        if (s.useTable && D().regions[region].missionWeights[type]) takeFromTable(G, region, type);
      }
      const race = s.races ? weightedKey(r, s.races) : null;
      out.push(spawnMission(G, type, { region, race, cityId, delayMin: s.startDelay > 0 ? s.startDelay : null, script: s.id }));
    }
    return out;
  }

  function planMonth(G) {
    mem(G);
    if (G.plannedMonth >= G.month) return [];
    const out = [];
    for (const s of D().scriptsForMonth(G.month, G.difficulty, G.researched)) out.push(...runScript(G, s));
    G.plannedMonth = G.month;
    return out;
  }

  // guiões 'immediate' cujo gatilho de investigação acabou de se cumprir (ex.: Solução Marciana → retaliação)
  function onResearch(G, topicId) {
    const done = new Set(G.researched || []);
    done.add(topicId);
    for (const s of D().missionScripts) {
      if (!s.immediate || !(topicId in s.researchTriggers)) continue;
      let ok = true;
      for (const k in s.researchTriggers) if (done.has(k) !== s.researchTriggers[k]) ok = false;
      if (ok) runScript(G, s);
    }
  }

  function endMission(G, m) {
    const def = D().alienMissions[m.type];
    if (def.objective === 'base') buildAlienBase(G, m);
    Camp().removeById(G.alienMissions, m.id);
  }
  function checkEnd(G, m) {
    if (!m || !findMission(G, m.id)) return;
    const def = D().alienMissions[m.type];
    if (def.objective === 'infiltration') return; // a infiltração nunca acaba (orig)
    if (!spawnsLeft(m, def) && m.liveUfos.length === 0) endMission(G, m);
  }

  // ---- bases alienígenas e locais de terror ----------------------------------------------------------------------
  function scriptMaxDist(m) {
    if (!m.script) return null;
    const s = D().missionScripts.find((x) => x.id === m.script);
    return s && s.maxBaseDistNm ? s.maxBaseDistNm : null;
  }
  function nearestBaseNm(G, p) {
    let d = Infinity;
    for (const b of G.bases) d = Math.min(d, GM().distNm(b, p));
    return d;
  }
  function buildAlienBase(G, m) {
    const reg = regionDef(m.region);
    const areas = reg && reg.missionZones[4] && reg.missionZones[4].length ? reg.missionZones[4] : reg.areas;
    const g = geo(G);
    const maxNm = scriptMaxDist(m);
    let p = GM().randomLandPoint(g, areas);
    if (maxNm) {
      // ours: o guião seedAlienBase quer a base ao alcance da patrulha; até 8 candidatos, fica o primeiro perto
      let best = p, bestD = nearestBaseNm(G, p);
      for (let k = 0; k < 7 && bestD > maxNm; k++) {
        const q = GM().randomLandPoint(g, areas);
        const dq = nearestBaseNm(G, q);
        if (dq < bestD) { best = q; bestD = dq; }
      }
      p = best;
    }
    const ab = {
      id: Camp().nextId(G, 'a'), lon: p.lon, lat: p.lat, race: m.race, region: m.region,
      country: GM().countryAt(p.lon, p.lat), missionId: m.id, discovered: false, foundT: null, supplyT: null,
    };
    G.alienBases.push(ab);
    if (D().alienMissions[m.type].objective === 'base') score(G, 'alien', D().scoring.missionPoints[m.type], ab.lon, ab.lat);
    ev(G, 'alienBaseBuilt', { alienBaseId: ab.id });
    return ab;
  }
  function revealAlienBase(G, ab, how) {
    if (!ab || ab.discovered) return false;
    ab.discovered = true;
    ab.foundT = G.t | 0;
    ev(G, 'alienBaseFound', { alienBaseId: ab.id, how });
    return true;
  }
  function createSite(G, m, ufo) {
    const def = D().alienMissions[m.type];
    const city = m.cityId ? D().citiesById[m.cityId] : null;
    const lon = city ? city.lon : ufo.lon, lat = city ? city.lat : ufo.lat;
    const h = D().missionRules.terrorSiteHours;
    const site = {
      id: Camp().nextId(G, 't'), kind: 'terror', missionId: m.id, deployment: def.siteType || 'dep_terror_site',
      cityId: m.cityId || null, lon, lat, race: m.race, region: m.region, country: GM().countryAt(lon, lat),
      leftS: geo(G).int(h[0], h[1]) * 3600,
    };
    G.sites.push(site);
    score(G, 'alien', D().scoring.missionPoints[m.type], lon, lat);
    ev(G, 'terrorSite', { siteId: site.id, cityId: site.cityId, lon, lat, race: site.race });
    return site;
  }
  // infiltração concluída: um país da região assina o pacto no fim do mês e surge uma base alienígena (orig)
  function infiltrate(G, m) {
    const A = mem(G);
    const taken = new Set(A.pendingPacts.map((p) => p.countryId));
    const cands = G.countries.filter((c) => {
      const def = D().countries[c.id];
      if (!def || c.pact || taken.has(c.id)) return false;
      return def.region === m.region || GM().regionAt(def.label[0], def.label[1]) === m.region;
    }).map((c) => c.id);
    if (cands.length) A.pendingPacts.push({ countryId: cands.length === 1 ? cands[0] : ai(G).pick(cands), missionId: m.id });
    buildAlienBase(G, m);
  }

  // ---- OVNIs -----------------------------------------------------------------------------------------------------
  function trajOf(ufo) {
    return D().trajectories[ufo.traj];
  }
  const legSpeed = (ufo, pct) => Math.floor((D().ufos[ufo.type].speed * pct) / 100);
  // posição do ponto i da trajetória (zona da região da missão); i além do fim = saída (zona 5)
  function zonePoint(G, ufo, m, i) {
    const pts = trajOf(ufo).pts;
    const g = geo(G);
    const reg = regionDef(ufo.region);
    const def = m ? D().alienMissions[m.type] : null;
    if (i === 1 && ufo.targetBaseId) {
      const b = Camp().findBase(G, ufo.targetBaseId);
      if (b) return { lon: b.lon, lat: b.lat };
    }
    if (i === 1 && ufo.objective && def && def.objective === 'supply') {
      const ab = Camp().findAlienBase(G, m.alienBaseId);
      if (ab) return { lon: ab.lon, lat: ab.lat };
    }
    const z = i < pts.length ? pts[i][0] : 5;
    if (z === 5 || !reg || !reg.missionZones[z] || !reg.missionZones[z].length) {
      const ring = D().geoConst.entryRingDeg;
      return GM().randomPointAround(g, centroidLL(ufo.region), ring[0], ring[1]);
    }
    if (z === 3) {
      // cidades: sem teste de terra (há cidades costeiras em células de mar)
      const cityId = m && m.cityId ? m.cityId : reg.cities.length ? (reg.cities.length === 1 ? reg.cities[0] : g.pick(reg.cities)) : null;
      const c = cityId ? D().citiesById[cityId] : null;
      if (c) return { lon: c.lon, lat: c.lat };
      return GM().randomPointInAreas(g, reg.missionZones[3]);
    }
    const lands = i + 1 < pts.length && pts[i + 1][1] === 0;
    const p = lands ? GM().randomLandPoint(g, reg.missionZones[z]) : GM().randomPointInAreas(g, reg.missionZones[z]);
    return { lon: p.lon, lat: p.lat };
  }

  function spawnUfo(G, missionId) {
    const m = findMission(G, missionId);
    if (!m) return null;
    const def = D().alienMissions[m.type];
    const assault = def.objective === 'retaliation' && !!m.targetBaseId && !!Camp().findBase(G, m.targetBaseId);
    let type, trajId, objective = false;
    const w = def.waves[Math.min(m.wave, def.waves.length - 1)];
    if (assault) {
      type = def.spawnUfo;
      trajId = def.assaultTraj;
      objective = true;
    } else {
      type = w.ufo;
      trajId = w.traj;
      objective = !!w.objective;
    }
    const traj = D().trajectories[trajId];
    const race = type === 'battleship' ? battleshipRace(G, m, m.race) : m.race;
    const ufo = {
      id: Camp().nextId(G, 'u'), type, missionId: m.id, race, region: m.region, traj: trajId, wp: 1,
      lon: 0, lat: 0, dest: null, alt: traj.pts[0][1], speed: 0, status: 'flying', dmg: 0, detected: false, hyper: false,
      groundLeftS: 0, crashLeftS: 0, lastSeen: null, objective,
      targetBaseId: assault ? m.targetBaseId : null, siteCity: objective && def.objective === 'site' ? m.cityId : null,
      siege: null,
    };
    ufo.speed = legSpeed(ufo, traj.pts[0][2]);
    const ring = D().geoConst.entryRingDeg;
    const from = assault ? Camp().findBase(G, m.targetBaseId) : centroidLL(m.region);
    const p0 = GM().randomPointAround(geo(G), { lon: from.lon, lat: from.lat }, ring[0], ring[1]);
    ufo.lon = p0.lon;
    ufo.lat = p0.lat;
    ufo.dest = zonePoint(G, ufo, m, 1);
    G.ufos.push(ufo);
    m.liveUfos.push(ufo.id);

    if (assault) {
      m.wave = def.waves.length + 1;
      m.ufoCounter = 0;
      // ours: a base foi avisada (baseSpotted) — o Couraçado do ataque aparece logo no radar
      ufo.detected = true;
      ufo.lastSeen = { lon: ufo.lon, lat: ufo.lat, t: G.t | 0 };
      G.stats.ufosDetected++;
      ev(G, 'ufoDetected', { ufoId: ufo.id, hyper: false });
      return ufo;
    }
    m.ufoCounter++;
    if (m.ufoCounter >= w.n) {
      m.ufoCounter = 0;
      m.wave++;
    }
    if (m.wave >= def.waves.length && def.objective === 'infiltration') {
      infiltrate(G, m);
      m.wave = 0;
    }
    if (m.wave < def.waves.length) m.countdownS = countdownS(G, def.waves[m.wave].timer);
    return ufo;
  }

  function removeUfo(G, ufoId) {
    const ufo = Camp().findUfo(G, ufoId);
    if (!ufo) return null;
    Camp().removeById(G.ufos, ufoId);
    const m = findMission(G, ufo.missionId);
    if (m) Camp().removeById(m.liveUfos, ufoId);
    dropTarget(G, 'ufo', ufoId, ufo.lon, ufo.lat);
    if (m) checkEnd(G, m);
    return ufo;
  }

  function land(G, ufo, onGround) {
    ufo.status = 'landed';
    ufo.alt = 0;
    ufo.speed = 0;
    ufo.dest = null;
    ufo.groundLeftS = onGround ? Math.max(trajOf(ufo).groundS, nightLandingS(G, ufo)) : 5;
    if (ufo.detected) ev(G, 'ufoLanded', { ufoId: ufo.id, stop: true });
  }
  /* ours (meses de aprendizagem, §11.10): um OVNI que aterra de noite nos primeiros NIGHT_LANDING_MONTHS meses fica no
     chão até NIGHT_LANDING_DAY_MARGIN_S depois de amanhecer no local (máx. NIGHT_LANDING_MAX_S) — «Esperar pelo dia»
     é uma escolha real. → segundos mínimos no chão (0 = regra normal) */
  function nightLandingS(G, ufo) {
    if ((G.month | 0) >= tune('NIGHT_LANDING_MONTHS', 0) || GM().dayPhase(G, ufo.lon, ufo.lat) !== 'night') return 0;
    const max = tune('NIGHT_LANDING_MAX_S', 57600), step = 1800;
    for (let s = step; s <= max; s += step) {
      if (GM().dayPhase({ t: (G.t | 0) + s }, ufo.lon, ufo.lat) === 'day') return Math.min(max, s + tune('NIGHT_LANDING_DAY_MARGIN_S', 3600));
    }
    return max;
  }
  // Nave de Abastecimento na base alienígena: abastece-a; se estiver a ser seguida, revela a base
  function supplyAt(G, ufo, m) {
    const ab = m ? Camp().findAlienBase(G, m.alienBaseId) : null;
    if (!ab || GM().distNm(ab, ufo) > 1) return;
    ab.supplyT = G.t | 0;
    // reabastecida: a guarnição volta a estar completa (§11.10)
    delete ab.garrison;
    if (ufo.detected && D().missionRules.supplyLandingRevealsBase) revealAlienBase(G, ab, 'supply');
  }

  function onUfoWaypoint(G, ufoId) {
    const ufo = Camp().findUfo(G, ufoId);
    if (!ufo || ufo.status !== 'flying') return;
    if (ufo.targetBaseId) return; // ataque à base: a chegada é tratada pelo World.contacts
    const m = findMission(G, ufo.missionId);
    const def = m ? D().alienMissions[m.type] : null;
    const pts = trajOf(ufo).pts;
    const i = ufo.wp;
    if (def && def.objective === 'supply' && ufo.objective && i === 1) {
      land(G, ufo, true);
      ufo.wp = 2;
      supplyAt(G, ufo, m);
      return;
    }
    if (i >= pts.length - 1) {
      if (ufo.detected) ev(G, 'ufoGone', { ufoId: ufo.id });
      removeUfo(G, ufo.id);
      return;
    }
    if (ufo.objective && def && def.objective === 'site' && pts[i][0] === def.spawnZone) {
      createSite(G, m, ufo);
      removeUfo(G, ufo.id);
      return;
    }
    if (pts[i + 1][1] === 0) {
      land(G, ufo, pts[i][0] === 3 || GM().isLand(ufo.lon, ufo.lat));
      ufo.wp = i + 1;
      return;
    }
    ufo.wp = i + 1;
    ufo.alt = Math.max(1, pts[i][1]);
    ufo.speed = legSpeed(ufo, pts[i][2]);
    ufo.dest = zonePoint(G, ufo, m, i + 1);
  }

  function onUfoLiftOff(G, ufoId) {
    const ufo = Camp().findUfo(G, ufoId);
    if (!ufo || ufo.status !== 'landed') return;
    const m = findMission(G, ufo.missionId);
    const def = m ? D().alienMissions[m.type] : null;
    const pts = trajOf(ufo).pts;
    const i = Math.min(Math.max(0, ufo.wp - 1), pts.length - 1);
    ufo.status = 'flying';
    ufo.groundLeftS = 0;
    ufo.alt = Math.max(1, pts[i][1]);
    ufo.speed = legSpeed(ufo, pts[i][2]);
    if (def && def.objective === 'score') score(G, 'alien', D().scoring.missionPoints[m.type], ufo.lon, ufo.lat);
    if (def && def.objective === 'supply' && ufo.objective) supplyAt(G, ufo, m);
    ufo.dest = zonePoint(G, ufo, m, ufo.wp);
    const after = craftsAfter(G, ufo.id);
    // transportes de tropas a caminho do OVNI aterrado voltam à base (não perseguem uma nave em voo)
    const recalled = recallTransports(G, ufo.id);
    if (ufo.detected) ev(G, 'ufoLiftOff', { ufoId: ufo.id, recalled });
    else if (after) ev(G, 'landedUfoGone', { ufoId: ufo.id, recalled });
  }
  /* transporte em terra: sem armas, ou com soldados a bordo (o mesmo critério de OV.GeoUI.model.groundTransport);
     fora do hangar, sem combate aéreo em curso → World.recall. Devolve os ids recolhidos (ordem estável). */
  function recallTransports(G, ufoId) {
    const out = [];
    if (!OV.World || !OV.World.recall) return out;
    for (const id of Object.keys(G.crafts).sort()) {
      const c = G.crafts[id];
      const def = c && D().crafts[c.type];
      if (!def || !def.transport || !c.dest || c.dest.kind !== 'ufo' || c.dest.id !== ufoId || c.dogfightId) continue;
      if ((def.weapons | 0) > 0 && !(c.soldiers || []).length) continue;
      if (c.status !== 'out' && c.status !== 'patrol') continue;
      const r = OV.World.recall(G, c.id);
      if (r && r.ok) out.push(c.id);
    }
    return out;
  }
  function craftsAfter(G, ufoId) {
    for (const id in G.crafts) {
      const d = G.crafts[id].dest;
      if (d && d.kind === 'ufo' && d.id === ufoId) return true;
    }
    return false;
  }

  function onUfoDown(G, ufoId, how, craftId) {
    const ufo = Camp().findUfo(G, ufoId);
    if (!ufo) return null;
    const R = D().missionRules;
    const udef = D().ufos[ufo.type];
    const m = findMission(G, ufo.missionId);
    const mdef = m ? D().alienMissions[m.type] : null;
    let crashed = how === 'crashed' && GM().isLand(ufo.lon, ufo.lat);
    if (how === 'crashed' && !crashed) {
      // ours: um OVNI a cair perto da costa plana até terra (missionRules.crashCoastNm); longe dela afunda (orig)
      const p = coastPoint(ufo, R.crashCoastNm | 0);
      if (p) {
        ufo.lon = p.lon;
        ufo.lat = p.lat;
        crashed = true;
      }
    }
    // a missão atrasa a vaga seguinte (geo), depois o temporizador do local da queda (geo), depois a retaliação (ai)
    if (m && spawnsLeft(m, mdef)) m.countdownS += R.shootDownDelayMin(geo(G)) * 60;
    const h = tune('CRASH_SITE_HOURS', [24, 72]);
    const crashS = crashed ? geo(G).int(h[0], h[1]) * 3600 : 0;
    retaliationRoll(G, ufo, craftId);
    if (crashed) {
      ufo.status = 'crashed';
      ufo.speed = 0;
      ufo.alt = 0;
      ufo.dest = null;
      ufo.groundLeftS = 0;
      ufo.crashLeftS = crashS;
      G.stats.ufosShotDown++;
      score(G, 'xcom', udef.score, ufo.lon, ufo.lat);
      ev(G, 'ufoCrashed', { ufoId, craftId: craftId || null, lon: ufo.lon, lat: ufo.lat });
      return ufo;
    }
    G.stats.ufosDestroyed++;
    score(G, 'xcom', udef.scoreDestroyed, ufo.lon, ufo.lat);
    ev(G, 'ufoDestroyed', { ufoId, craftId: craftId || null, type: ufo.type, score: udef.scoreDestroyed });
    removeUfo(G, ufoId);
    return ufo;
  }
  // ponto de terra mais próximo a ≤ maxNm (anéis de 20 mn, rumos de 30° a partir do norte) ou null; sem sorteios
  function coastPoint(p, maxNm) {
    for (let r = 20; r <= maxNm; r += 20) {
      for (let b = 0; b < 360; b += 30) {
        const q = GM().destination(p, b, r);
        if (GM().isLand(q.lon, q.lat)) return q;
      }
    }
    return null;
  }
  // cada abate pode provocar uma retaliação (4/12/20 %), a partir de missionRules.shootDownRetaliationFromMonth
  function retaliationRoll(G, ufo, craftId) {
    const R = D().missionRules;
    if ((G.month | 0) < R.shootDownRetaliationFromMonth) return null;
    const diff = Math.max(0, Math.min(2, G.difficulty | 0));
    const r = ai(G);
    if (!r.pct(R.retaliationPct[diff])) return null;
    const craft = craftId ? Camp().findCraft(G, craftId) : null;
    const home = (craft && Camp().findBase(G, craft.baseId)) || G.bases[0] || null;
    const ufoPct = tune('RETALIATION_UFO_REGION_PCT', 50) - tune('RETALIATION_UFO_REGION_PER_COEF', 6) * 2 * diff;
    const region = r.pct(ufoPct) || !home ? ufo.region : missionRegionOf(home.region);
    if (!region || running(G, 'alien_retaliation', region)) return null;
    return spawnMission(G, 'alien_retaliation', { region, race: ufo.race, delayMin: tune('RETALIATION_FIRST_MIN', 3000) });
  }

  // ---- temporizadores ------------------------------------------------------------------------------------------
  // pontos alienígenas de um terror ignorado: scoring.terrorSiteExpiredByMonth[mês] (ours, meses 0–1) ou terrorSiteExpired
  function expiredPoints(G) {
    const S = D().scoring;
    const by = S.terrorSiteExpiredByMonth || [];
    const m = G.month | 0;
    return m < by.length ? by[m] | 0 : S.terrorSiteExpired | 0;
  }

  function think30m(G) {
    mem(G);
    for (const m of G.alienMissions.slice()) {
      if (!findMission(G, m.id)) continue;
      const def = D().alienMissions[m.type];
      if (spawnsLeft(m, def)) {
        m.countdownS -= 1800;
        if (m.countdownS <= 0) spawnUfo(G, m.id);
      }
      checkEnd(G, m);
    }
    for (const site of G.sites.slice()) {
      site.leftS -= 1800;
      if (site.leftS > 0) continue;
      const pts = expiredPoints(G);
      score(G, 'alien', pts, site.lon, site.lat);
      G.stats.terrorIgnored++;
      Camp().removeById(G.sites, site.id);
      ev(G, 'terrorSiteExpired', { siteId: site.id, cityId: site.cityId, points: pts });
      dropTarget(G, 'site', site.id, site.lon, site.lat);
    }
    for (const ufo of G.ufos.slice()) {
      if (ufo.status !== 'crashed') continue;
      ufo.crashLeftS -= 1800;
      if (ufo.crashLeftS > 0) continue;
      ev(G, 'crashSiteExpired', { ufoId: ufo.id });
      removeUfo(G, ufo.id);
    }
  }

  // OVNIs de retaliação procuram a base X-COM (REA §3.2): a partir do 2.º ponto, fora da zona 5, a ≤ 268 mn
  function scan10m(G) {
    const sight = tune('UFO_BASE_SIGHT_NM', 268);
    for (const ufo of G.ufos) {
      if (ufo.status !== 'flying' || ufo.targetBaseId) continue;
      const m = findMission(G, ufo.missionId);
      if (!m || m.targetBaseId || D().alienMissions[m.type].objective !== 'retaliation') continue;
      const pts = trajOf(ufo).pts;
      if (ufo.wp < 2 || ufo.wp >= pts.length || pts[ufo.wp][0] === 5 || pts[ufo.wp - 1][0] === 5) continue;
      for (const b of G.bases) {
        if (GM().distNm(ufo, b) > sight) continue;
        const fac = completedFacilities(b);
        let tiles = 0, shields = 0;
        for (const f of fac) {
          const fd = D().facilities[f.type];
          const s = fd ? fd.size | 0 : 1;
          tiles += s * s;
          if (f.type === 'mind_shield') shields++;
        }
        const chance = Math.floor((tiles / 6 + 15) / (shields + 1));
        if (!ai(G).pct(chance)) continue;
        b.spotted = true;
        m.targetBaseId = b.id;
        const def = D().alienMissions[m.type];
        if (m.wave >= def.waves.length) m.countdownS = countdownS(G, def.waves[def.waves.length - 1].timer);
        // ours: aviso com tempo para reagir (trazer a equipa, guardar os intercetores, construir defesas)
        m.countdownS = Math.max(m.countdownS, tune('RETALIATION_WARNING_MIN', 1440) * 60);
        ev(G, 'baseSpotted', { baseId: b.id, missionId: m.id, etaS: m.countdownS });
        break;
      }
    }
  }

  // abastecimento das bases alienígenas (6 %/dia cada; uma missão de cada vez por base)
  function daily(G) {
    const pct = tune('ALIEN_BASE_SUPPLY_PCT', 6);
    for (const ab of G.alienBases.slice()) {
      if (!geo(G).pct(pct)) continue;
      if (G.alienMissions.some((m) => m.type === 'alien_supply' && m.alienBaseId === ab.id)) continue;
      spawnMission(G, 'alien_supply', { region: ab.region, race: ab.race, alienBaseId: ab.id });
    }
  }

  // fim do mês: os agentes revelam uma base (50 %); os pactos de infiltração pendentes assinam-se
  function monthEnd(G) {
    const A = mem(G);
    A.lastReveal = null;
    const hidden = G.alienBases.filter((ab) => !ab.discovered);
    if (hidden.length) {
      const g = geo(G);
      if (g.pct(D().missionRules.alienBaseRevealMonthlyPct)) {
        const ab = hidden.length === 1 ? hidden[0] : g.pick(hidden);
        revealAlienBase(G, ab, 'agents');
        A.lastReveal = { month: G.month | 0, alienBaseId: ab.id };
      }
    }
    const signed = [];
    for (const p of A.pendingPacts) {
      const c = G.countries.find((x) => x.id === p.countryId);
      if (!c || c.pact) continue;
      c.pact = true;
      const def = D().countries[c.id];
      score(G, 'alien', D().scoring.missionPoints.alien_infiltration, def.label[0], def.label[1]);
      ev(G, 'pactSigned', { countryId: c.id });
      signed.push(c.id);
    }
    A.pendingPacts = [];
    A.newPacts = { month: G.month | 0, countries: signed };
  }

  /* Depois de uma batalha. Vitória: o local desaparece (e a sua missão termina quando não tiver mais OVNIs).
     Local de terror: desaparece depois de qualquer batalha (OpenXcom; a pontuação da batalha já conta os civis, sem
     terrorSiteExpired). Queda/aterragem e base alienígena perdidas ou abortadas ficam (com o seu temporizador). */
  function onSiteCleared(G, siteRef, result) {
    if (!siteRef) return;
    if (siteRef.kind === 'site') {
      const s = Camp().removeById(G.sites, siteRef.id);
      if (s) dropTarget(G, 'site', s.id, s.lon, s.lat);
      return;
    }
    if (result !== 'win') return;
    if (siteRef.kind === 'ufo') removeUfo(G, siteRef.id);
    else if (siteRef.kind === 'alienBase') {
      const ab = Camp().removeById(G.alienBases, siteRef.id);
      if (!ab) return;
      for (const m of G.alienMissions.slice()) {
        if (m.type !== 'alien_supply' || m.alienBaseId !== ab.id) continue;
        m.wave = D().alienMissions[m.type].waves.length;
        checkEnd(G, m);
      }
      dropTarget(G, 'alienBase', ab.id, ab.lon, ab.lat);
    }
  }

  OV.Missions = {
    planMonth, think30m, scan10m, daily, monthEnd, spawnMission, spawnUfo, onUfoWaypoint, onUfoLiftOff, onUfoDown,
    onSiteCleared, onResearch, removeUfo, regionWeights, expiredPoints,
  };
})(globalThis.OV || (globalThis.OV = {}));
