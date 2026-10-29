/* Geoscape (DESIGN.md §3.1, §12, §15.5; docs/CAMPAIGN_API.md §3, §4, §6.1–§6.3): globo inteiro (OV.GlobeRender),
   relógio com as 6 velocidades, painel lateral (data, fundos, velocidades, ações, listas), cartões de seleção, fluxo
   de interceção com alvo escolhido no globo, avisos dos eventos de G.events (janelas em fila para os que param o
   tempo, toasts agrupados para os restantes) e ligação às outras cenas da campanha (bases, Ufopédia, interceção,
   relatório mensal, gravação, missões). A interface só muda G através de OV.World / OV.Campaign / OV.Save
   (e escreve G.ui.geo: câmara, velocidade, radares).

   Cena: OV.SceneDefs.geoscape({G})  isScreen:true
   API:
   OV.GeoUI = {
     open(G)                         OV.Game.G = G; Scenes.set('geoscape', {G})
     centreOn(G, {lon,lat}|{kind,id}, zoom?)  centra a câmara do Geoscape aberto (sem cena aberta guarda em G.ui.geo)
     intercept(G, ufoId?)            abre o fluxo de interceção (com o OVNI já escolhido como alvo, se dado)
     current() → {G, view, speed, paused, popup:string|null, dialog:string|null, mode} | null   estado (QA/depuração)
     setSpeed(i) ; togglePause() ; select(ref|null)                 controlo programático da cena aberta
     model                           funções puras (sem DOM; testadas em Node)
   }
   Teclas: 1–6 velocidades, P/Espaço pausa, I intercetar, B bases, U Ufopédia, F financiamento, S gravar, Esc opções
   (ou fecha a janela aberta), C centrar na seleção, H centrar na base, R radares, Tab próximo OVNI/local,
   setas rodam, +/− ampliam. */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  const has = (k) => !!(OV.T && OV.T.has && OV.T.has(k));
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const W = () => OV.World;
  const GM = () => OV.GMath;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const D2R = Math.PI / 180;
  const AIR = { out: 1, patrol: 1, returning: 1 };
  const HANGAR = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  const SPEED_N = 6;

  // =================================================================================================================
  // Modelo puro (sem DOM): nomes, formatos, linhas dos cartões, listas da interceção, relógio, reações aos eventos
  // =================================================================================================================
  const fmtInt = (n) => (OV.U && OV.U.fmtInt ? OV.U.fmtInt(n) : String(Math.round(n)));
  const fmtMoney = (n) => (OV.U && OV.U.fmtMoney ? OV.U.fmtMoney(n) : '$' + n);
  const dec1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  const numOf = (id) => String(id || '').replace(/^\D+/, '');

  function fmtDur(hours) {
    if (!(hours >= 0) || !Number.isFinite(hours)) return '—';
    const mins = Math.max(1, Math.round(hours * 60));
    if (mins < 60) return T('geo.dur.m', { m: mins });
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h < 48) return m ? T('geo.dur.hm', { h, m }) : T('geo.dur.h', { h });
    return T('geo.dur.dh', { d: Math.floor(h / 24), h: h % 24 });
  }
  const fmtNm = (nm) => T('geo.nm', { n: fmtInt(nm) });
  const fmtKn = (kn) => T('geo.kn', { n: fmtInt(kn) });
  function fmtLL(lon, lat) {
    return T('geo.ll', {
      lat: dec1(Math.abs(lat)), ns: T(lat >= 0 ? 'geo.ll.n' : 'geo.ll.s'),
      lon: dec1(Math.abs(lon)), ew: T(lon >= 0 ? 'geo.ll.e' : 'geo.ll.w'),
    });
  }
  function compass(deg) {
    const d = ((deg % 360) + 360) % 360;
    return T('geo.heading', { dir: T('geo.dir.' + (Math.round(d / 45) % 8)), deg: Math.round(d) });
  }
  const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

  // ---- nomes -------------------------------------------------------------------------------------------------------
  const ufoDef = (u) => D().ufos[u.type] || { size: 0, sizeKey: 'ufo.size.0', nameKey: 'ufo.small_scout' };
  const ufoName = (u) => T('geo.ufo.label', { n: numOf(u.id) });
  const ufoKnown = (u) => !!(u && u.hyper);
  function ufoTitle(u) {
    return ufoKnown(u) ? ufoName(u) + ' · ' + T(ufoDef(u).nameKey) : ufoName(u) + ' · ' + T(ufoDef(u).sizeKey);
  }
  function craftName(G, c) {
    if (!c) return '—';
    if (c.name) return c.name;
    const def = D().crafts[c.type];
    return T('craft.instance', { type: def ? T(def.nameKey) : c.type, n: c.num });
  }
  const baseName = (b) => (b ? b.name || T('base.defaultName') : '—');
  const cityName = (id) => (has('city.' + id) ? T('city.' + id) : id);
  function countryName(id) {
    if (!id) return null;
    if (has('country.' + id)) return T('country.' + id);
    if (has('geo.country.' + id)) return T('geo.country.' + id);
    return null;
  }
  // lugar para os textos: país (contornos reais) ou região do mundo (inclui oceanos)
  function placeName(lon, lat) {
    const M = GM();
    if (!M || !Number.isFinite(lon)) return '—';
    let c = null;
    try { c = countryName(M.countryAtMap(lon, lat)); } catch (e) { c = null; }
    if (c) return c;
    const r = M.regionAt(lon, lat);
    return r && has('region.' + r) ? T('region.' + r) : fmtLL(lon, lat);
  }
  function targetName(G, ref) {
    if (!ref) return '—';
    if (ref === 'home') return T('geo.tk.home');
    if (ref.kind === 'point') return T('geo.tk.pointAt', { p: fmtLL(ref.lon, ref.lat) });
    const tg = C().targetOf(G, ref);
    if (!tg) return T('geo.tk.gone');
    if (ref.kind === 'ufo') return ufoName(tg.obj);
    if (ref.kind === 'site') return T('geo.site.terror', { city: cityName(tg.obj.cityId) });
    if (ref.kind === 'alienBase') return T('geo.alienBase.name', { place: placeName(tg.lon, tg.lat) });
    if (ref.kind === 'base') return baseName(tg.obj);
    if (ref.kind === 'craft') return craftName(G, tg.obj);
    return '—';
  }
  const raceName = (r) => (r && has('race.' + r) ? T('race.' + r) : T('geo.unknown'));

  // ---- estados ----------------------------------------------------------------------------------------------------
  function craftStatusKey(c, G) {
    if (c.dogfightId) return 'geo.cst.dogfight';
    if (c.status === 'patrol' && !c.patrol) return 'geo.cst.waiting';
    if (c.status === 'out' && c.dest && c.dest.kind === 'ufo') {
      // a caminho de um OVNI pousado ou despenhado não é uma perseguição
      const u = G ? C().findUfo(G, c.dest.id) : null;
      return u && u.status !== 'flying' ? 'geo.cst.out' : 'geo.cst.chasing';
    }
    return 'geo.cst.' + c.status;
  }
  const isAir = (c) => !!AIR[c.status];
  const ufoVisible = (G, u) => !!(u && (u.detected || u.status === 'crashed' || (G.debug && G.debug.revealUfos)));

  // ---- linhas dos cartões: [rótulo, valor, {bar, tone}?] ---------------------------------------------------------
  function ufoRows(G, u) {
    const def = ufoDef(u), rows = [];
    rows.push(['geo.i.status', T('geo.ufo.st.' + u.status)]);
    rows.push(['geo.i.type', ufoKnown(u) ? T(def.nameKey) : T('geo.unknown')]);
    rows.push(['geo.i.size', T(def.sizeKey)]);
    if (u.status === 'flying') {
      const alt = D().altitudes[u.alt] || 'high';
      rows.push(['geo.i.alt', T('alt.' + alt)]);
      if (u.dest) rows.push(['geo.i.heading', compass(GM().bearing(u, u.dest))]);
      rows.push(['geo.i.speed', fmtKn(u.speed)]);
    } else rows.push(['geo.i.alt', T('alt.ground')]);
    if (ufoKnown(u)) {
      rows.push(['geo.i.race', raceName(u.race)]);
      const m = C().findAlienMission(G, u.missionId);
      if (m && has('mission.' + m.type)) rows.push(['geo.i.mission', T('mission.' + m.type)]);
    }
    rows.push(['geo.i.place', placeName(u.lon, u.lat)]);
    if (u.status === 'crashed' && u.crashLeftS > 0) rows.push(['geo.i.crashLeft', T('geo.approx', { t: fmtDur(u.crashLeftS / 3600) })]);
    return rows;
  }
  function weaponsText(c) {
    const parts = [];
    for (const w of c.weapons || []) {
      if (!w) continue;
      const wd = D().craftWeapons[w.type];
      if (!wd) continue;
      parts.push(T(wd.nameKey) + (wd.ammoMax === null || wd.beam ? '' : ' ' + (w.ammo | 0) + '/' + wd.ammoMax));
    }
    return parts.length ? parts.join(' · ') : T('geo.i.unarmed');
  }
  function etaHours(G, c, ref) {
    const def = D().crafts[c.type];
    const tg = ref === 'home' ? C().targetOf(G, { kind: 'base', id: c.baseId }) : C().targetOf(G, ref);
    if (!def || !tg || !Number.isFinite(tg.lon)) return null;
    const nm = GM().distNm(c, tg);
    return { nm, h: nm / def.speed };
  }
  function craftRows(G, c) {
    const def = D().crafts[c.type] || { fuel: 1, hp: 1 };
    const rows = [['geo.i.status', T(craftStatusKey(c, G))]];
    if (c.dest && isAir(c)) {
      rows.push(['geo.i.dest', targetName(G, c.dest)]);
      const e = etaHours(G, c, c.dest);
      if (e && c.status !== 'patrol') rows.push(['geo.i.eta', fmtDur(e.h) + ' · ' + fmtNm(e.nm)]);
    }
    rows.push(['geo.i.fuel', pct(c.fuel, def.fuel) + ' %', { bar: pct(c.fuel, def.fuel), tone: c.lowFuel || c.fuel * 4 < def.fuel ? 'warn' : 'fuel' }]);
    rows.push(['geo.i.hull', pct(c.hp, def.hp) + ' %', { bar: pct(c.hp, def.hp), tone: c.hp * 2 < def.hp ? 'bad' : 'hull' }]);
    if (def.weapons) rows.push(['geo.i.weapons', weaponsText(c)]);
    if (def.transport) rows.push(['geo.i.crew', T('geo.i.crewN', { n: (c.soldiers || []).length, max: def.seatsUI || def.seats || 0 })]);
    if (isAir(c)) rows.push(['geo.i.speed', fmtKn(c.speed)]);
    return rows;
  }
  function baseRows(G, b) {
    const rows = [];
    rows.push(['geo.i.place', placeName(b.lon, b.lat)]);
    let caps = null;
    try { caps = OV.BaseSim && OV.BaseSim.capacities ? OV.BaseSim.capacities(G, b.id) : null; } catch (e) { caps = null; }
    if (caps) {
      const r = caps.radars.map((x) => fmtNm(x.rangeNm) + ' · ' + x.chance + ' %');
      rows.push(['geo.i.radar', r.length ? r.join(', ') : T('common.none')]);
      if (caps.hyper) rows.push(['geo.i.hyper', T('common.yes')]);
    }
    rows.push(['geo.i.crafts', String((b.crafts || []).length)]);
    rows.push(['geo.i.soldiers', String((b.soldiers || []).length)]);
    rows.push(['geo.i.staff', T('geo.i.staffN', { s: b.scientists | 0, e: b.engineers | 0 })]);
    return rows;
  }
  function siteRows(G, s) {
    return [
      ['geo.i.city', cityName(s.cityId)],
      ['geo.i.race', raceName(s.race)],
      ['geo.i.timeLeft', T('geo.approx', { t: fmtDur(Math.max(0, s.leftS) / 3600) }), { tone: s.leftS < 4 * 3600 ? 'bad' : null }],
    ];
  }
  function alienBaseRows(G, a) {
    const rows = [['geo.i.place', placeName(a.lon, a.lat)]];
    if (a.region && has('region.' + a.region)) rows.push(['geo.i.region', T('region.' + a.region)]);
    rows.push(['geo.i.race', raceName(a.race)]);
    return rows;
  }
  function cityRows(G, id) {
    const c = D().citiesById[id];
    if (!c) return [];
    const rows = [['geo.i.place', placeName(c.lon, c.lat)]];
    if (has('region.' + c.region)) rows.push(['geo.i.region', T('region.' + c.region)]);
    return rows;
  }

  // ---- interceção: naves e alvos com validade (World.canOrder) ------------------------------------------------------
  // a nave pode receber uma ordem? (ponto a 1° de distância: só apanha falta de manutenção, combustível ou combate)
  function launchState(G, c) {
    return W().canOrder(G, c.id, { kind: 'point', lon: GM().wrapLon(c.lon + 1), lat: c.lat });
  }
  // alvo em terra (missão com soldados): local de terror, base alienígena, OVNI aterrado ou despenhado
  function groundTarget(G, ref) {
    if (!ref || ref === 'home' || !ref.kind) return false;
    if (ref.kind === 'site' || ref.kind === 'alienBase') return true;
    if (ref.kind !== 'ufo') return false;
    const u = C().findUfo(G, ref.id);
    return !!u && (u.status === 'landed' || u.status === 'crashed');
  }
  const fitCount = (G, c) => (c.soldiers || []).filter((id) => { const s = C().findSoldier(G, id); return s && !(s.woundDays > 0); }).length;
  function craftsFor(G, baseId, target) {
    const out = [];
    const ground = groundTarget(G, target);
    for (const b of G.bases) {
      if (baseId && b.id !== baseId) continue;
      for (const id of b.crafts) {
        const c = G.crafts[id];
        if (!c) continue;
        const r = target ? W().canOrder(G, id, target) : launchState(G, c);
        const e = target ? etaHours(G, c, target) : null;
        const def = D().crafts[c.type] || {};
        const team = !!def.transport && fitCount(G, c) > 0;
        // ours: um intercetor num alvo em terra só sobrevoa — a ordem é válida, mas avisa-se
        const warn = r.warn || (ground && r.ok && !team ? (def.transport ? 'noTeam' : 'noTroops') : null);
        out.push({ craftId: id, baseId: b.id, ok: !!r.ok, reason: r.reason || null, warn, eta: e, team });
      }
    }
    // com alvo: primeiro as que podem ir; em terra, primeiro os transportes com equipa; depois as mais rápidas
    if (target) out.sort((a, b) => (b.ok - a.ok) || (ground ? b.team - a.team : 0) || ((a.eta ? a.eta.h : 1e9) - (b.eta ? b.eta.h : 1e9)));
    return out;
  }
  function targetsFor(G, craftId) {
    const c = G.crafts[craftId];
    if (!c) return [];
    const refs = [];
    for (const u of G.ufos) if (ufoVisible(G, u)) refs.push({ kind: 'ufo', id: u.id });
    for (const s of G.sites) refs.push({ kind: 'site', id: s.id });
    for (const a of G.alienBases) if (a.discovered) refs.push({ kind: 'alienBase', id: a.id });
    const out = refs.map((ref) => {
      const r = W().canOrder(G, craftId, ref);
      return { ref, ok: !!r.ok, reason: r.reason || null, warn: r.warn || null, eta: etaHours(G, c, ref) };
    });
    out.sort((a, b) => (b.ok - a.ok) || ((a.eta ? a.eta.nm : 1e9) - (b.eta ? b.eta.nm : 1e9)));
    if (isAir(c) && c.status !== 'returning') {
      const r = W().canOrder(G, craftId, 'home');
      out.push({ ref: 'home', ok: !!r.ok, reason: r.reason || null, warn: null, eta: etaHours(G, c, 'home') });
    }
    return out;
  }
  const reasonText = (r) => (has('geo.err.' + r) ? T('geo.err.' + r) : T('geo.err.generic', { r }));
  const warnText = (w) => (has('geo.warn.' + w) ? T('geo.warn.' + w) : w);

  // ---- financiamento ------------------------------------------------------------------------------------------------
  function fundingRows(G) {
    const rows = G.countries.map((c) => ({
      id: c.id, name: countryName(c.id) || c.id, funding: c.funding | 0, delta: c.lastDelta | 0, mood: c.mood,
      pact: !!c.pact, history: (c.history || []).slice(),
    }));
    rows.sort((a, b) => b.funding - a.funding || (a.name < b.name ? -1 : 1));
    return rows;
  }

  // ---- equipa a caminho: quem chega primeiro e com que luz ---------------------------------------------------------
  // transporte com soldados aptos que pode partir agora e chega antes; phase = dia/crepúsculo/noite à chegada
  function teamEta(G, ref) {
    const rows = craftsFor(G, null, ref).filter((r) => r.ok && r.team && r.eta);
    if (!rows.length) return null;
    const r = rows[0];
    const tg = C().targetOf(G, ref);
    let phase = null;
    try { phase = tg ? GM().dayPhase({ t: G.t + Math.round(r.eta.h * 3600) }, tg.lon, tg.lat) : null; } catch (e) { phase = null; }
    return { craftId: r.craftId, h: r.eta.h, phase };
  }
  // linha dos avisos de OVNI aterrado/despenhado: «Skyranger-1 chega em 2 h — lá será noite»
  function teamEtaLine(G, ref, leftS) {
    const e = teamEta(G, ref);
    if (!e) return T('geo.ev.terrorSite.noTeam');
    const p = { craft: craftName(G, G.crafts[e.craftId]), t: fmtDur(e.h) };
    if (leftS > 0 && e.h * 3600 > leftS) return T('geo.ev.team.late', p);
    return T('geo.ev.team.eta.' + (e.phase || 'day'), p);
  }

  // ---- pessoal parado (mesma regra das fichas da base) --------------------------------------------------------------
  // cientistas livres com laboratório e projeto possível; engenheiros livres com oficina e algo para fabricar
  function idleStaff(G) {
    const out = { sci: 0, eng: 0, baseId: null };
    const BS = OV.BaseSim;
    if (!BS || !BS.staff || !BS.capacities) return out;
    for (const b of G.bases) {
      let st = null, caps = null;
      try { st = BS.staff(G, b.id); caps = BS.capacities(G, b.id); } catch (e) { st = null; }
      if (!st || !caps) continue;
      let s = 0, e = 0;
      if (st.scientists.free > 0 && caps.labs.used < caps.labs.cap && (b.research.length || C().availableResearch(G, b.id).length)) s = st.scientists.free;
      if (st.engineers.free > 0 && caps.workshops.used < caps.workshops.cap && (b.production.length || (C().availableManufacture && C().availableManufacture(G, b.id).length))) e = st.engineers.free;
      if ((s || e) && !out.baseId) out.baseId = b.id;
      out.sci += s;
      out.eng += e;
    }
    return out;
  }

  // ---- primeiros passos (só no primeiro mês; G.ui.geo.stepsOff esconde) ---------------------------------------------
  const STEP_IDS = ['research', 'hire', 'speed', 'ufo'];
  function nextSteps(G) {
    const geo = (G.ui && G.ui.geo) || {};
    const sci0 = Number.isFinite(geo.sci0) ? geo.sci0 : 10;
    const done = {
      research: G.researched.length > 0 || G.bases.some((b) => b.research.length > 0),
      hire: G.bases.reduce((s, b) => s + (b.scientists | 0), 0) > sci0 || G.bases.some((b) => b.deliveries.some((d) => d.kind === 'scientist')),
      speed: !!geo.sped,
      ufo: ((G.stats && G.stats.ufosDetected) | 0) > 0,
    };
    const steps = STEP_IDS.map((id) => ({ id, done: !!done[id] }));
    return { steps, show: (G.month | 0) === 0 && !geo.stepsOff && steps.some((s) => !s.done) };
  }
  // ataques sem resposta por mês (G.ui.terrorLog) para o relatório mensal separar essa parcela dos pontos alienígenas;
  // um evento na fronteira do mês conta para o mês que acabou (os pontos entram antes do fecho, §3.1)
  function logTerror(G, ev) {
    if (!G.ui) return null;
    const t = Number.isFinite(ev.at) ? ev.at : G.t;
    const mi = OV.Clock && OV.Clock.monthIndex ? OV.Clock.monthIndex(Math.max(0, t - 1)) : G.month | 0;
    const log = (G.ui.terrorLog = G.ui.terrorLog || {});
    const e = (log[mi] = log[mi] || { n: 0, pts: 0 });
    e.n++;
    e.pts += Math.abs(ev.points | 0);
    for (const k of Object.keys(log)) if (+k < mi - 12) delete log[k];
    return e;
  }
  // velocidade sugerida para uma viagem de h horas (índice 0..5): 5 min até 1 h, 30 min até 6 h, depois 1 hora
  const suggestSpeed = (h) => (h <= 1 ? 2 : h <= 6 ? 3 : 4);

  // ---- relógio (contrato §6.3) --------------------------------------------------------------------------------------
  // st = {speed:0..5, paused, acc}; handle(events) recebe cada lote escoado de G.events
  function runClock(G, st, dt, handle, opts) {
    const o = opts || {};
    const speeds = o.speeds || tune('GEO_SPEEDS', [1, 12, 60, 360, 720, 17280]);
    const stepMs = o.stepMs || tune('GEO_STEP_MS', 80);
    const maxSteps = o.maxSteps || tune('GEO_MAX_STEPS_PER_FRAME', 3);
    const chunk = o.chunk || tune('GEO_CHUNK_TICKS', 720);
    const budget = o.budgetMs || tune('GEO_FRAME_BUDGET_MS', 12);
    const clock = o.now || nowMs;
    const out = { steps: 0, ticks: 0, stopped: false, reason: null };
    if (st.paused) { st.acc = 0; return out; }
    st.acc += Math.max(0, dt);
    const t0 = clock();
    while (st.acc >= stepMs && out.steps < maxSteps) {
      st.acc -= stepMs;
      out.steps++;
      let left = speeds[st.speed] || 1;
      while (left > 0) {
        const r = W().step(G, Math.min(left, chunk));
        left -= r.ticks;
        out.ticks += r.ticks;
        const evs = G.events.splice(0);
        if (evs.length && handle) handle(evs);
        if (r.stopped) {
          out.stopped = true;
          out.reason = r.reason;
          st.speed = 0;
          st.acc = 0;
          return out;
        }
        if (r.ticks <= 0) break;
        if (clock() - t0 > budget) { st.acc = 0; return out; }
      }
    }
    // nunca acumular dívida de tempo (fotogramas lentos não disparam rajadas)
    if (st.acc > stepMs * maxSteps) st.acc = stepMs;
    return out;
  }

  // ---- reação a cada tipo de evento (contrato §4) -------------------------------------------------------------------
  // popup: janela em fila (pára o tempo) ; toast: aviso agrupado ; scene: outra cena/módulo ; action: trabalho sem aviso ;
  // debug: só com ?debug=1 ou G.debug ; none: nada (a cena dona trata)
  const REACT = {
    ufoDetected: 'popup', ufoLost: 'popup', ufoLanded: 'popup', ufoLiftOff: 'toast', ufoCrashed: 'popup',
    ufoDestroyed: 'popup', ufoEscaped: 'popup', ufoGone: 'toast',
    craftArrived: 'popup', craftLowFuel: 'popup', craftReturned: 'toast', craftReady: 'toast', craftRearmShort: 'toast',
    craftLost: 'popup', targetLost: 'popup', interceptOrderInvalid: 'toast',
    dogfightStart: 'scene', dogfightEnd: 'none',
    researchDone: 'popup', productionDone: 'popup', productionStalled: 'popup', facilityDone: 'popup',
    deliveryArrived: 'popup', transferArrived: 'toast', soldierRecovered: 'toast',
    terrorSite: 'popup', terrorSiteExpired: 'popup', crashSiteExpired: 'toast', landedUfoGone: 'toast',
    alienBaseFound: 'popup', alienBaseBuilt: 'debug', baseSpotted: 'popup', baseAttack: 'popup', baseDefence: 'popup',
    retaliation: 'debug', pactSigned: 'toast',
    monthEnd: 'scene', gameOver: 'scene', victory: 'scene', autosaveDue: 'action',
  };
  // eventos que só param o tempo quando o sim os marca stop (ufoLost sem perseguidores ⇒ toast)
  function classify(ev) {
    const m = REACT[ev.t] || 'debug';
    if (m === 'popup' && ev.stop === false) return 'toast';
    return m;
  }
  // tipos de janela que se juntam numa só quando ficam em fila (mesmo tipo)
  const MERGE = { facilityDone: 1, productionDone: 1, deliveryArrived: 1, craftLost: 1 };
  // base perdida: as naves destruídas com ela entram no aviso «Defesa da base» em vez de uma janela cada
  function dropBaseLosses(evs) {
    const lost = evs.filter((e) => e.t === 'baseDefence' && e.result === 'lost');
    if (!lost.length) return evs;
    const n = evs.filter((e) => e.t === 'craftLost' && e.reason === 'base').length;
    if (n) lost[0].craftsLost = (lost[0].craftsLost | 0) + n;
    return evs.filter((e) => !(e.t === 'craftLost' && e.reason === 'base'));
  }

  // texto de um toast para n eventos do mesmo tipo
  function toastFor(G, type, evs) {
    const ev = evs[evs.length - 1], n = evs.length;
    const craft = (e) => craftName(G, e.craftId ? G.crafts[e.craftId] : null);
    const ufo = (e) => {
      const u = e.ufoId ? C().findUfo(G, e.ufoId) : null;
      return u ? ufoName(u) : T('geo.ufo.label', { n: numOf(e.ufoId) });
    };
    const k = 'geo.toast.' + type;
    switch (type) {
      case 'ufoLiftOff': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: ufo(ev) }), kind: 'warn' };
      case 'ufoGone': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: ufo(ev) }), kind: 'info' };
      case 'ufoLost': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: ufo(ev) }), kind: 'info' };
      case 'ufoLanded': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: ufo(ev) }), kind: 'warn' };
      case 'craftReturned': {
        const b = C().findBase(G, ev.baseId);
        return { text: n > 1 ? T(k + '.many', { n }) : T(k, { craft: craft(ev), base: baseName(b) }), kind: 'info' };
      }
      case 'craftReady': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { craft: craft(ev) }), kind: 'good' };
      case 'craftRearmShort': {
        const it = D().items[ev.itemId];
        return { text: T(k + '.' + (ev.what === 'fuel' ? 'fuel' : 'ammo'), { craft: craft(ev), item: it ? T(it.nameKey) : ev.itemId || '—' }), kind: 'warn' };
      }
      case 'interceptOrderInvalid': return { text: T(k, { craft: craft(ev), reason: reasonText(ev.reason) }), kind: 'warn' };
      case 'transferArrived': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { base: baseName(C().findBase(G, ev.baseId)) }), kind: 'info' };
      case 'soldierRecovered': {
        const s = C().findSoldier(G, ev.soldierId);
        return { text: n > 1 ? T(k + '.many', { n }) : T(k, { name: s ? s.name : '—' }), kind: 'good' };
      }
      case 'crashSiteExpired': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: T('geo.ufo.label', { n: numOf(ev.ufoId) }) }), kind: 'info' };
      case 'landedUfoGone': return { text: n > 1 ? T(k + '.many', { n }) : T(k, { ufo: T('geo.ufo.label', { n: numOf(ev.ufoId) }) }), kind: 'warn' };
      case 'pactSigned': return { text: evs.map((e) => T(k, { country: countryName(e.countryId) || e.countryId })).join(' · '), kind: 'alert' };
      case 'productionStalled': return { text: T('geo.ev.productionStalled.' + (ev.reason || 'funds'), { item: prodName(ev.item) }), kind: 'warn' };
      case 'alienBaseBuilt': return { text: T('geo.toast.alienBaseBuilt', { n }), kind: 'info' };
      case 'retaliation': return { text: T('geo.toast.retaliation', { region: ev.region && has('region.' + ev.region) ? T('region.' + ev.region) : '—' }), kind: 'info' };
      default: return { text: T('geo.toast.generic', { type, n }), kind: 'info' };
    }
  }
  function prodName(id) {
    const m = D().manufacture[id];
    if (m && m.nameKey) return T(m.nameKey);
    const it = D().items[id];
    return it ? T(it.nameKey) : id;
  }
  function itemName(kind, id) {
    if (kind === 'craft') return D().crafts[id] ? T(D().crafts[id].nameKey) : id;
    const it = D().items[id];
    return it ? T(it.nameKey) : id;
  }
  const researchName = (id) => (has('research.' + id) ? T('research.' + id) : id);

  // chaves montadas dinamicamente (para os testes de cobertura i18n)
  function textKeys() {
    const k = [];
    for (let i = 0; i < SPEED_N; i++) k.push('geo.speed.' + i);
    for (let i = 0; i < 8; i++) k.push('geo.dir.' + i);
    for (const s of ['ready', 'out', 'patrol', 'returning', 'repair', 'rearm', 'refuel', 'dogfight', 'waiting', 'chasing']) k.push('geo.cst.' + s);
    for (const s of ['flying', 'landed', 'crashed']) k.push('geo.ufo.st.' + s);
    for (const s of ['alert', 'warn', 'good', 'info', 'terror']) k.push('geo.pop.kicker.' + s);
    for (const t of ['ufoLiftOff', 'ufoGone', 'ufoLost', 'ufoLanded', 'craftReturned', 'craftReady', 'transferArrived', 'soldierRecovered', 'crashSiteExpired', 'landedUfoGone']) k.push('geo.toast.' + t, 'geo.toast.' + t + '.many');
    k.push('geo.toast.craftRearmShort.ammo', 'geo.toast.craftRearmShort.fuel', 'geo.toast.interceptOrderInvalid', 'geo.toast.pactSigned', 'geo.toast.alienBaseBuilt', 'geo.toast.retaliation', 'geo.toast.generic');
    for (const r of ['funds', 'materials', 'hangar', 'space']) k.push('geo.ev.productionStalled.' + r);
    for (const r of ['dogfight', 'mission', 'base']) k.push('geo.ev.craftLost.body.' + r);
    for (const r of ['patrol', 'agents', 'supply']) k.push('geo.ev.alienBaseFound.' + r);
    for (const r of ['ufoDestroyed', 'repelled', 'lost']) k.push('geo.ev.baseDefence.' + r);
    for (const r of ['item', 'craft']) k.push('geo.ev.delivery.' + r);
    for (const r of ['soldier', 'scientist', 'engineer']) k.push('geo.ev.delivery.' + r + '.one', 'geo.ev.delivery.' + r + '.other');
    for (const r of ['council', 'debt', 'baseLost', 'cydonia']) k.push('geo.end.' + r);
    for (const r of ['busy', 'quota', 'unavailable', 'slot']) k.push('geo.save.err.' + r);
    k.push('geo.ev.researchDone.idle.one', 'geo.ev.researchDone.idle.other', 'geo.ev.craftLost.noTransport', 'geo.ev.terrorSite.eta', 'geo.ev.terrorSite.late', 'geo.ev.terrorSite.noTeam');
    for (const p of ['day', 'dusk', 'night']) k.push('geo.ev.team.eta.' + p);
    for (const id of STEP_IDS) k.push('geo.steps.' + id);
    for (const r of ['sci', 'eng']) k.push('geo.idle.' + r + '.one', 'geo.idle.' + r + '.other');
    return k;
  }
  // razões que o sim pode devolver à interface (World.canOrder/order, Campaign.startMission)
  const WORLD_REASONS = ['noCraft', 'notReady', 'inDogfight', 'noTarget', 'noSoldiers', 'noFuel'];
  const WORLD_WARNS = ['noWeapons', 'tooSlow', 'tooFar', 'noTroops', 'noTeam'];
  const MISSION_REASONS = ['busy', 'ended', 'noCraft', 'notTransport', 'inDogfight', 'noSoldiers', 'noTarget', 'locked', 'craftType', 'notReady', 'notAtSite', 'noBattle', 'generic'];

  const model = {
    fmtDur, fmtNm, fmtKn, fmtLL, compass, ufoName, ufoTitle, craftName, baseName, cityName, countryName, placeName,
    targetName, craftStatusKey, ufoRows, craftRows, baseRows, siteRows, alienBaseRows, cityRows, weaponsText, etaHours,
    launchState, craftsFor, targetsFor, reasonText, warnText, fundingRows, runClock, REACT, MERGE, classify, toastFor,
    prodName, itemName, researchName, textKeys, ufoVisible, WORLD_REASONS, WORLD_WARNS, MISSION_REASONS,
    groundTarget, teamEta, teamEtaLine, idleStaff, nextSteps, suggestSpeed, dropBaseLosses, logTerror,
  };

  // =================================================================================================================
  // Ícones (SVG em linha, traço na cor do texto)
  // =================================================================================================================
  const ICONS = {
    ufo: '<path d="M3 13c0-2 4-3.5 9-3.5s9 1.5 9 3.5-4 3-9 3-9-1-9-3z"/><path d="M8 10c.5-2.6 2-4 4-4s3.5 1.4 4 4"/><path d="M7 16.5l-1.5 2.5M17 16.5l1.5 2.5M12 16v3"/>',
    craft: '<path d="M12 3l2.2 7.5L21 14v2l-7-1.8-.6 4.3L15 20v1.4l-3-.9-3 .9V20l1.6-1.5-.6-4.3L3 16v-2l6.8-3.5z"/>',
    lab: '<path d="M9 3h6M10 3v6l-5.5 9.2A1.8 1.8 0 006 21h12a1.8 1.8 0 001.5-2.8L14 9V3"/><path d="M7.5 15h9"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    base: '<path d="M3 20h18M5 20V10l7-5 7 5v10"/><path d="M9.5 20v-5h5v5"/>',
    skull: '<path d="M12 3c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.5 5v3h10v-3c1.4-1 2.5-2.6 2.5-5 0-4-3.1-7-7.5-7z"/><circle cx="9.2" cy="11" r="1.6"/><circle cx="14.8" cy="11" r="1.6"/><path d="M10 18v3M14 18v3"/>',
    alien: '<path d="M12 3c-4 0-7 2.8-7 6.5 0 4.5 4 9.5 7 11.5 3-2 7-7 7-11.5C19 5.8 16 3 12 3z"/><path d="M7.8 10.5c1.2 0 2.7.8 3 2.4-1.6.4-3.2-.4-3-2.4zM16.2 10.5c-1.2 0-2.7.8-3 2.4 1.6.4 3.2-.4 3-2.4z"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 8.6c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-2.9.9-2.9 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.3-3.1 2.3-1.3 0-2.4-.5-3-1.4M12 5.5v1.9M12 16.5v2"/>',
    radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    fuel: '<path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M3.5 21h13M15 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V8l-3-3"/><path d="M8 7h4"/>',
    box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
    star: '<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z"/>',
  };
  function icon(name, cls) {
    const svg = ICONS[name] || ICONS.alert;
    const span = document.createElement('span');
    span.className = 'geo-ic' + (cls ? ' ' + cls : '');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg>';
    return span;
  }

  // =================================================================================================================
  // Cena
  // =================================================================================================================
  let cur = null; // controlador da cena aberta
  let hintSeen = false; // a dica de controlos só aparece na primeira abertura da sessão
  const el = (...a) => OV.Dom.el(...a);
  function sfx(name) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name); } catch (e) { /* som opcional */ }
  }
  function stinger(name) {
    try { if (OV.audio && OV.audio.stinger && (!OV.audio.stingers || OV.audio.stingers().indexOf(name) >= 0)) OV.audio.stinger(name); } catch (e) { /* idem */ }
  }
  function music(mood) {
    try { if (OV.audio && OV.audio.music && (!OV.audio.moods || OV.audio.moods().indexOf(mood) >= 0)) OV.audio.music(mood); } catch (e) { /* idem */ }
  }
  const fn = (mod, name) => !!(OV[mod] && typeof OV[mod][name] === 'function');
  const debugOn = (G) => !!((OV.Game && OV.Game.debug) || (G && G.debug));
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ZSTEP = Math.log(1.5);

  function makeScene(params) {
    const G = params.G;
    const ui = (G.ui.geo = Object.assign({ lon: null, lat: null, zoom: 1, speed: 0, radar: true }, G.ui.geo || {}));
    const home = G.bases[0] || { lon: -9.14, lat: 38.72 };
    const view = {
      lon: Number.isFinite(ui.lon) ? ui.lon : home.lon, lat: Number.isFinite(ui.lat) ? ui.lat : Math.max(-60, Math.min(60, home.lat - 6)),
      zoom: Number.isFinite(ui.zoom) ? ui.zoom : 1, w: 1, h: 1, dpr: 1, cx: null, cy: null, time: nowMs(),
      selection: null, hover: null, highlights: [], mode: 'normal', cursor: null, targetFrom: null, touch: false,
      showRadar: ui.radar !== false,
    };
    // uma cena nova sobre uma campanha em curso (carregar, «Continuar») abre em pausa a 5 s: o jogador orienta-se primeiro
    const clk = { speed: G.t > 0 ? 0 : Math.max(0, Math.min(SPEED_N - 1, ui.speed | 0)), paused: G.t > 0, acc: 0 };
    const S = {
      root: null, side: null, els: {}, popup: null, dlg: null, queue: [], waiting: false, toasts: new Map(), toastT: 0,
      hl: new Map(), dirty: true, lastDraw: -1e9, lastRefresh: -1e9, sigs: {}, drag: null, pinchT: 0, hidden: false,
      sideW: 0, target: null, lastHoverRef: null, hintGone: false, endShown: false, autosave: false, mood: null,
      blockedBattle: false, fallbackDf: null, introShown: false,
    };

    // ---------------------------------------------------------------------------------------------------------------
    // utilidades da cena
    // ---------------------------------------------------------------------------------------------------------------
    const isTop = () => OV.Scenes.top() === sc;
    const dirty = () => { S.dirty = true; };
    function btn(label, opts) {
      const o = opts || {};
      const b = el('button', { type: 'button', class: 'btn ' + (o.cls || ''), 'aria-label': o.aria || null, 'aria-keyshortcuts': o.key || null });
      if (o.icon) b.appendChild(icon(o.icon));
      if (label) b.appendChild(el('span', { class: 'geo-bl', text: label }));
      if (o.key) b.appendChild(el('kbd', { text: o.key }));
      b.addEventListener('click', (e) => {
        if (b.disabled || !isTop()) return; // outra cena por cima (interceção, relatório): o painel não responde
        if (e.detail > 0) b.blur(); // clique de rato não deixa foco (Espaço/Enter não repetem a ação)
        if (o.why) { sfx('ui_deny'); OV.Dom.toast(o.why, null, 'warn'); return; }
        if (o.sound !== false) sfx(o.sound || 'ui_click');
        o.onClick && o.onClick(e);
      });
      if (o.why) { b.classList.add('disabled'); b.setAttribute('aria-disabled', 'true'); }
      if (o.tip) OV.Dom.tooltip(b, o.tip);
      return b;
    }
    const tip = (text, key) => (key ? OV.U.esc(text) + ' <span class="key">' + OV.U.esc(key) + '</span>' : OV.U.esc(text));
    function kv(rows) {
      const dl = el('dl', { class: 'geo-kv' });
      for (const r of rows) {
        const extra = r[2] || {};
        const dd = el('dd', { class: extra.tone ? 't-' + extra.tone : null });
        if (extra.bar !== undefined) {
          dd.appendChild(el('span', { class: 'geo-mbar ' + (extra.tone ? 't-' + extra.tone : '') }, el('i', { style: { width: extra.bar + '%' } })));
        }
        dd.appendChild(el('span', { text: r[1] }));
        dl.append(el('dt', { text: has(r[0]) ? T(r[0]) : r[0] }), dd);
      }
      return dl;
    }
    function refOf(kind, id) {
      return { kind, id };
    }
    function posOf(ref) {
      if (!ref) return null;
      if (ref.kind === 'point') return { lon: ref.lon, lat: ref.lat };
      if (ref.kind === 'city') { const c = D().citiesById[ref.id]; return c ? { lon: c.lon, lat: c.lat } : null; }
      const tg = C().targetOf(G, ref);
      return tg && Number.isFinite(tg.lon) ? { lon: tg.lon, lat: tg.lat } : null;
    }
    // centra o ponto; dx > 0 deixa-o dx px à esquerda do centro (livre da janela de aviso à direita)
    function centre(ref, zoom, dx) {
      let p = ref && Number.isFinite(ref.lon) && !ref.kind ? ref : posOf(ref);
      if (!p) return;
      const z = Number.isFinite(zoom) ? zoom : Math.max(view.zoom, 1);
      if (dx > 0) {
        const R = OV.GlobeRender.radius({ zoom: z, h: view.h });
        const ang = Math.asin(Math.min(0.8, dx / R)) / D2R;
        p = GM().destination(p, 90, ang * 60);
      }
      OV.GlobeRender.rotateTo(view, p.lon, p.lat, reduceMotion() ? 0 : undefined, z);
      dirty();
    }
    // deslocamento para o alvo ficar visível ao lado de um painel da camada central
    function sideOffset(node) {
      if (!node || OV.View.w < 760) return 0;
      const r = node.getBoundingClientRect();
      const free = r.left - 64;
      if (free < 140) return 0;
      return Math.max(0, view.cx - (64 + free / 2));
    }
    function highlight(ref, ms) {
      if (!ref) return;
      S.hl.set(ref.kind + ':' + ref.id, { ref, until: nowMs() + (ms || 6000) });
      dirty();
    }
    function select(ref) {
      if (ref && ref.kind === 'point') ref = null;
      const same = (view.selection && ref && view.selection.kind === ref.kind && view.selection.id === ref.id);
      view.selection = ref || null;
      if (ref && !same) sfx('ui_select');
      S.sigs.card = null;
      renderCard();
      dirty();
    }
    function selValid(ref) {
      if (!ref) return false;
      if (ref.kind === 'city') return !!D().citiesById[ref.id];
      const tg = C().targetOf(G, ref);
      if (!tg) return false;
      if (ref.kind === 'ufo') return ufoVisible(G, tg.obj);
      if (ref.kind === 'craft') return isAir(tg.obj);
      if (ref.kind === 'alienBase') return !!tg.obj.discovered;
      return true;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // construção do DOM
    // ---------------------------------------------------------------------------------------------------------------
    function build() {
      const root = el('div', { class: 'geo passthru' });
      S.root = root;
      // painel lateral
      const date = el('div', { class: 'geo-date' });
      const time = el('div', { class: 'geo-time' });
      const runDot = el('i', { class: 'geo-run', 'aria-hidden': 'true' });
      const funds = el('b', { class: 'geo-funds-v' });
      const fundsRow = el('button', { type: 'button', class: 'geo-funds' }, icon('coin'), el('span', { class: 'geo-funds-l', text: T('geo.funds') }), funds);
      fundsRow.addEventListener('click', (e) => { if (!isTop()) return; if (e.detail > 0) fundsRow.blur(); sfx('ui_click'); openFunding(); });
      OV.Dom.tooltip(fundsRow, tip(T('geo.funds.tip'), 'F'));
      const pauseB = btn(T('geo.pause'), { cls: 'geo-pause', icon: null, key: 'P', tip: tip(T('geo.pause.tip'), 'P · Espaço'), onClick: () => togglePause() });
      const speeds = [];
      const speedBox = el('div', { class: 'geo-speeds', role: 'radiogroup', 'aria-label': T('geo.speed') });
      for (let i = 0; i < SPEED_N; i++) {
        const b = btn(T('geo.speed.' + i), { cls: 'geo-sp', key: String(i + 1), tip: tip(T('geo.speed.tip', { s: T('geo.speed.' + i) }), String(i + 1)), onClick: () => setSpeed(i) });
        b.setAttribute('role', 'radio');
        speeds.push(b);
        speedBox.appendChild(b);
      }
      const basesB = btn(T('geo.btn.bases'), { icon: 'base', key: 'B', tip: () => basesTip(), onClick: () => openBases() });
      const basesBadge = el('span', { class: 'geo-badge hidden', 'aria-hidden': 'true', text: '!' });
      basesB.appendChild(basesBadge);
      const steps = el('div', { class: 'geo-steps hidden', role: 'status' });
      const nudge = el('div', { class: 'geo-nudge hidden', role: 'status' });
      const acts = el('div', { class: 'geo-acts' },
        btn(T('geo.btn.intercept'), { cls: 'primary geo-int-b', icon: 'craft', key: 'I', tip: tip(T('geo.btn.intercept.tip'), 'I'), onClick: () => openIntercept({}) }),
        basesB,
        btn(T('geo.btn.ufopaedia'), { icon: 'alien', key: 'U', tip: tip(T('geo.btn.ufopaedia.tip'), 'U'), onClick: () => openUfopaedia() }),
        btn(T('geo.btn.funding'), { cls: 'geo-wide', icon: 'coin', key: 'F', tip: tip(T('geo.btn.funding.tip'), 'F'), onClick: () => openFunding() }),
        btn(T('geo.btn.save'), { icon: 'box', key: 'S', tip: tip(T('geo.btn.save.tip'), 'S'), onClick: () => saveGame() }),
        btn(T('geo.btn.options'), { icon: 'gear', key: 'Esc', tip: tip(T('geo.btn.options.tip'), 'Esc'), onClick: () => openOptions() }));
      const lists = el('div', { class: 'geo-lists scroll', 'data-scroll': '' });
      const side = el('aside', { class: 'geo-side', 'aria-label': T('geo.title') },
        el('div', { class: 'geo-clock' }, el('div', { class: 'geo-kicker' }, runDot, el('span', { text: T('geo.title') })), date, time),
        fundsRow,
        el('div', { class: 'geo-timebox' }, pauseB, speedBox),
        nudge,
        acts,
        steps,
        lists);
      // ferramentas do globo (canto superior esquerdo)
      const radarB = btn('', { cls: 'geo-tool', icon: 'radar', aria: T('geo.tool.radar'), tip: tip(T('geo.tool.radar'), 'R'), onClick: () => toggleRadar() });
      const tools = el('div', { class: 'geo-tools' },
        btn('', { cls: 'geo-tool', aria: T('geo.tool.zoomIn'), tip: tip(T('geo.tool.zoomIn'), '+'), onClick: () => zoomStep(1) }),
        btn('', { cls: 'geo-tool', aria: T('geo.tool.zoomOut'), tip: tip(T('geo.tool.zoomOut'), '−'), onClick: () => zoomStep(-1) }),
        radarB,
        btn('', { cls: 'geo-tool', icon: 'base', aria: T('geo.tool.home'), tip: tip(T('geo.tool.home'), 'H'), onClick: () => centre({ kind: 'base', id: (selBase() || G.bases[0] || {}).id }) }));
      tools.children[0].prepend(el('b', { class: 'geo-tool-g', text: '+' }));
      tools.children[1].prepend(el('b', { class: 'geo-tool-g', text: '−' }));
      const zoomInd = el('div', { class: 'geo-zoom', 'aria-hidden': 'true' });
      for (let i = 0; i < SPEED_N; i++) zoomInd.appendChild(el('i'));
      tools.appendChild(zoomInd);
      const card = el('section', { class: 'geo-card hidden', 'aria-live': 'polite' });
      const banner = el('div', { class: 'geo-banner hidden', role: 'status' });
      const layer = el('div', { class: 'geo-layer' });
      const hint = el('div', { class: 'geo-hint', text: T((OV.Input && OV.Input.lastPointerType === 'touch') || (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches) ? 'geo.hint.touch' : 'geo.hint') });
      root.append(side, tools, card, banner, layer, hint);
      OV.Dom.$('hud').appendChild(root);
      S.side = side;
      S.els = { date, time, funds, runDot, pauseB, speeds, lists, card, banner, layer, hint, radarB, zoomInd, fundsRow, basesB, basesBadge, steps, nudge };
      if (hintSeen) hint.classList.add('hidden');
      hintSeen = true;
      setTimeout(() => { if (S.els.hint) S.els.hint.classList.add('fade'); }, 14000);
      measure();
      refreshTime(true);
      refreshLists(true);
      refreshAux(true);
    }
    function measure() {
      const V = OV.View;
      const r = S.side ? S.side.getBoundingClientRect() : null;
      const narrow = V.w < 760;
      S.sideW = r && !narrow ? Math.round(V.w - r.left) : 0;
      if (S.root) S.root.style.setProperty('--geo-side', S.sideW + 'px');
      // os toasts centram-se no globo (css/geo.css), fora do painel lateral
      document.documentElement.style.setProperty('--geo-side', S.sideW + 'px');
      dirty();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // painel lateral: relógio, fundos, listas
    // ---------------------------------------------------------------------------------------------------------------
    function refreshTime(force) {
      const E = S.els;
      const s = OV.U.fmtDate(G.t);
      if (force || S.sigs.time !== s) {
        S.sigs.time = s;
        const i = s.lastIndexOf(' · ');
        E.date.textContent = i > 0 ? s.slice(0, i) : s;
        E.time.textContent = i > 0 ? s.slice(i + 3) : '';
        if (S.side) S.side.title = s;
      }
      const f = G.funds | 0;
      if (force || S.sigs.funds !== f) {
        S.sigs.funds = f;
        E.funds.textContent = fmtMoney(f);
        E.funds.classList.toggle('bad', f < 0);
      }
      const running = !clk.paused && !blocked();
      const sp = clk.speed + (clk.paused ? 'p' : '') + (running ? 'r' : '');
      if (force || S.sigs.speed !== sp) {
        S.sigs.speed = sp;
        E.speeds.forEach((b, i) => {
          b.classList.toggle('on', i === clk.speed);
          b.classList.toggle('dim', i === clk.speed && clk.paused);
          b.setAttribute('aria-checked', i === clk.speed ? 'true' : 'false');
        });
        E.pauseB.classList.toggle('on', clk.paused);
        E.pauseB.querySelector('.geo-bl').textContent = T(clk.paused ? 'geo.resume' : 'geo.pause');
        E.runDot.classList.toggle('on', running);
        E.runDot.style.animationDuration = Math.max(0.25, 1.6 - clk.speed * 0.25) + 's';
      }
      E.radarB.classList.toggle('on', view.showRadar);
      const zi = Math.round(view.zoom);
      if (S.sigs.zoom !== zi) {
        S.sigs.zoom = zi;
        [...E.zoomInd.children].forEach((n, i) => n.classList.toggle('on', i <= zi));
      }
    }
    function listRow(cls, ic, title, sub, right, ref) {
      const b = el('button', { type: 'button', class: 'geo-li ' + cls }, icon(ic), el('span', { class: 'geo-li-t' }, el('b', { text: title }), el('small', { text: sub })), right ? el('span', { class: 'geo-li-r', text: right }) : null);
      if (view.selection && ref && view.selection.kind === ref.kind && view.selection.id === ref.id) b.classList.add('sel');
      b.addEventListener('click', (e) => {
        if (!isTop()) return;
        if (e.detail > 0) b.blur();
        select(ref);
        centre(ref);
      });
      return b;
    }
    function refreshLists(force) {
      const ufos = G.ufos.filter((u) => ufoVisible(G, u));
      const crafts = Object.keys(G.crafts).map((id) => G.crafts[id]).filter(isAir);
      const abs = G.alienBases.filter((a) => a.discovered);
      const selK = view.selection ? view.selection.kind + view.selection.id : '';
      const sig = [selK, ufos.map((u) => u.id + u.status + (u.hyper ? 'h' : '')).join(','), G.sites.map((s) => s.id + Math.ceil(s.leftS / 3600)).join(','),
        abs.map((a) => a.id).join(','), ufos.map((u) => Math.round(u.speed / 50)).join(','),
        crafts.map((c) => c.id + craftStatusKey(c, G) + (c.dest ? c.dest.kind + (c.dest.id || '') : '') + pct(c.fuel, D().crafts[c.type].fuel)).join(',')].join('|');
      if (!force && sig === S.sigs.lists) return;
      S.sigs.lists = sig;
      const box = S.els.lists;
      OV.Dom.clear(box);
      const sec = (title, n, rows, empty) => {
        box.appendChild(el('h3', { class: 'geo-lh' }, el('span', { text: title }), el('i', { text: String(n) })));
        if (!rows.length) box.appendChild(el('p', { class: 'geo-empty', text: empty }));
        for (const r of rows) box.appendChild(r);
      };
      sec(T('geo.list.ufos'), ufos.length, ufos.map((u) => listRow('k-' + u.status, 'ufo', ufoName(u), T('geo.ufo.st.' + u.status) + ' · ' + (ufoKnown(u) ? T(ufoDef(u).nameKey) : T(ufoDef(u).sizeKey)),
        u.status === 'flying' ? fmtKn(u.speed) : placeName(u.lon, u.lat), refOf('ufo', u.id))), T('geo.list.ufos.none'));
      const siteRowsEl = G.sites.map((s) => listRow('k-terror', 'skull', cityName(s.cityId), T('geo.site.kind') + ' · ' + raceName(s.race), fmtDur(Math.max(0, s.leftS) / 3600), refOf('site', s.id)))
        .concat(abs.map((a) => listRow('k-abase', 'alien', T('geo.alienBase.short'), placeName(a.lon, a.lat), '', refOf('alienBase', a.id))));
      sec(T('geo.list.sites'), siteRowsEl.length, siteRowsEl, T('geo.list.sites.none'));
      sec(T('geo.list.crafts'), crafts.length, crafts.map((c) => listRow('k-craft' + (D().crafts[c.type] && D().crafts[c.type].transport ? ' k-transport' : ''), 'craft', craftName(G, c),
        T(craftStatusKey(c, G)) + (c.dest && c.status !== 'returning' ? ' · ' + targetName(G, c.dest) : ''), pct(c.fuel, D().crafts[c.type].fuel) + ' %', refOf('craft', c.id))), T('geo.list.crafts.none'));
    }

    // ---- pessoal parado (ficha no botão «Bases») e primeiros passos -------------------------------------------------
    function basesTip() {
      const idle = S.idle || { sci: 0, eng: 0 };
      const lines = [];
      if (idle.sci) lines.push(Tn('geo.idle.sci', idle.sci));
      if (idle.eng) lines.push(Tn('geo.idle.eng', idle.eng));
      return tip(T('geo.btn.bases.tip'), 'B') + (lines.length ? '<br><span class="warn">' + OV.U.esc(lines.join(' · ')) + '</span>' : '');
    }
    function refreshAux(force) {
      const hour = Math.floor(G.t / 3600);
      if (force || S.sigs.auxHour !== hour) {
        S.sigs.auxHour = hour;
        S.idle = idleStaff(G);
        const on = S.idle.sci > 0 || S.idle.eng > 0;
        S.els.basesBadge.classList.toggle('hidden', !on);
        S.els.basesB.classList.toggle('geo-warnb', on);
      }
      const ns = nextSteps(G);
      const sig = ns.show ? ns.steps.map((x) => x.id + (x.done ? 1 : 0)).join(',') : '';
      if (!force && sig === S.sigs.steps) return;
      S.sigs.steps = sig;
      const box = S.els.steps;
      OV.Dom.clear(box);
      box.classList.toggle('hidden', !ns.show);
      if (!ns.show) return;
      const x = el('button', { type: 'button', class: 'geo-x small', 'aria-label': T('geo.steps.hide'), text: '×' });
      x.addEventListener('click', () => { if (!isTop()) return; sfx('ui_click'); ui.stepsOff = true; refreshAux(true); });
      OV.Dom.tooltip(x, tip(T('geo.steps.hide')));
      box.append(el('div', { class: 'geo-steps-h' }, el('span', { text: T('geo.steps.title') }), x),
        el('ol', null, ns.steps.map((st) => el('li', { class: st.done ? 'done' : '' }, el('i', { 'aria-hidden': 'true', text: st.done ? '✓' : '' }), el('span', { text: T('geo.steps.' + st.id) })))));
    }
    // lembrete do pessoal parado: um toast por dia de jogo, só com o tempo a correr (nunca uma janela)
    function idleReminder() {
      if (clk.paused || blocked() || G.t < 86400 - 43200) return;
      const day = Math.floor((G.t + 43200) / 86400);
      if (ui.idleDay === day) return;
      // a «1 dia» os dias passam em segundos: também nunca mais do que um lembrete por 90 s de tempo real
      const now = nowMs();
      if (S.idleToastT && now - S.idleToastT < 90000) return;
      ui.idleDay = day;
      const idle = S.idle || idleStaff(G);
      if (!idle.sci && !idle.eng) return;
      const parts = [];
      if (idle.sci) parts.push(Tn('geo.idle.sci', idle.sci));
      if (idle.eng) parts.push(Tn('geo.idle.eng', idle.eng));
      S.idleToastT = now;
      OV.Dom.toast(T('geo.idle.toast', { what: parts.join(' · ') }), null, 'warn');
    }
    // sugestão discreta de acelerar o tempo depois de lançar uma nave (some sozinha; «não mostrar» fica em G.ui)
    function showNudge(craftId, h) {
      if (ui.nudgeOff || clk.speed >= suggestSpeed(h) || !(h > 0.15)) return;
      const box = S.els.nudge;
      const sp = suggestSpeed(h);
      OV.Dom.clear(box);
      const go = btn(T('geo.nudge.go', { s: T('geo.speed.' + sp) }), { cls: 'small primary', key: String(sp + 1), tip: tip(T('geo.speed.tip', { s: T('geo.speed.' + sp) }), String(sp + 1)), onClick: () => setSpeed(sp) });
      const off = btn('', { cls: 'small ghost geo-nudge-x', aria: T('geo.nudge.off'), tip: tip(T('geo.nudge.off')), onClick: () => { ui.nudgeOff = true; hideNudge(); } });
      off.prepend(el('b', { text: '×' }));
      box.append(el('span', { class: 'geo-nudge-t', text: T('geo.nudge.text', { craft: craftName(G, G.crafts[craftId]), t: fmtDur(h), k: String(sp + 1) }) }), go, off);
      box.classList.remove('hidden');
      S.nudgeT = nowMs();
    }
    function hideNudge() {
      if (!S.els.nudge || S.els.nudge.classList.contains('hidden')) return;
      S.els.nudge.classList.add('hidden');
      OV.Dom.clear(S.els.nudge);
      OV.Dom.hideTooltip();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // cartão da seleção
    // ---------------------------------------------------------------------------------------------------------------
    // ---- missão final (Cidónia): botões nos cartões da base e no aviso da investigação ------------------------------
    const CU = () => (OV.CampaignUI && typeof OV.CampaignUI.launchCydonia === 'function' ? OV.CampaignUI : null);
    function cydoniaAct(baseId) {
      if (!G.flags.cydoniaUnlocked || !CU()) return null;
      const pick = CU().cydoniaPick(G, baseId);
      return { label: T('geo.a.cydonia'), key: 'X', cls: 'primary cydonia', why: pick.ok ? null : CU().cydoniaWhy(pick.reason), act: () => CU().launchCydonia(G, pick.craftId) };
    }
    function cydoniaRowAct(c) {
      if (!G.flags.cydoniaUnlocked || !CU() || !CU().cydoniaCapable(c)) return null;
      const st = CU().cydoniaState(G, c.id);
      return { why: st.ok ? null : CU().cydoniaWhy(st.reason), act: () => CU().launchCydonia(G, c.id) };
    }

    function cardSpec(ref) {
      if (!ref) return null;
      if (ref.kind === 'city') {
        return { kind: T('geo.k.city'), title: cityName(ref.id), icon: 'globe', rows: cityRows(G, ref.id), acts: [] };
      }
      const tg = C().targetOf(G, ref);
      if (!tg) return null;
      const o = tg.obj;
      if (ref.kind === 'ufo') {
        const acts = [];
        if (o.status === 'flying') acts.push({ label: T('geo.a.intercept'), key: 'I', cls: 'primary', act: () => openIntercept({ target: ref }) });
        else acts.push({ label: T('geo.a.sendTeam'), key: 'E', cls: 'primary', act: () => openIntercept({ target: ref }) });
        if (ufoKnown(o) && fn('Ufopaedia', 'open')) acts.push({ label: T('geo.a.ufopaedia'), act: () => OV.Ufopaedia.open(G, 'ufo_' + o.type) });
        return { kind: T('geo.k.ufo'), title: ufoName(o), sub: ufoKnown(o) ? T(ufoDef(o).nameKey) : null, icon: 'ufo', tone: 'ufo-' + o.status, rows: ufoRows(G, o), acts };
      }
      if (ref.kind === 'craft') {
        const acts = [];
        if (o.status !== 'returning') acts.push({ label: T('geo.a.recall'), act: () => doRecall(o.id) });
        if (o.status === 'out' || o.status === 'returning') acts.push({ label: T('geo.a.patrol'), act: () => doPatrol(o.id) });
        const atSite = o.status === 'patrol' && !o.patrol && o.dest && D().crafts[o.type].transport && o.dest.kind !== 'point' && o.dest.kind !== 'base';
        acts.push({ label: T('geo.a.newDest'), key: 'D', cls: atSite ? '' : 'primary', act: () => openIntercept({ craftId: o.id }) });
        if (atSite) acts.unshift({ label: T('geo.a.startMission'), key: 'M', cls: 'primary', act: () => launchMission({ kind: o.dest.kind, id: o.dest.id }, o.id) });
        return { kind: T('craft.' + o.type), title: craftName(G, o), icon: 'craft', tone: D().crafts[o.type].transport ? 'transport' : 'craft', rows: craftRows(G, o), acts };
      }
      if (ref.kind === 'base') {
        const acts = [{ label: T('geo.a.openBase'), key: 'B', cls: 'primary', act: () => openBase(o.id) }];
        const cy = cydoniaAct(o.id);
        if (cy) { acts[0].cls = ''; acts.unshift(cy); }
        const crafts = (o.crafts || []).map((id) => G.crafts[id]).filter(Boolean);
        return {
          kind: T('geo.k.base'), title: baseName(o), icon: 'base', tone: 'base', rows: baseRows(G, o), acts,
          extra: crafts.length ? crafts.map((c) => ({ c, st: launchState(G, c), cy: cydoniaRowAct(c) })) : null,
        };
      }
      if (ref.kind === 'site') {
        return {
          kind: T('geo.k.terror'), title: cityName(o.cityId), icon: 'skull', tone: 'terror', rows: siteRows(G, o),
          acts: [{ label: T('geo.a.sendTeam'), key: 'E', cls: 'primary', act: () => openIntercept({ target: ref }) }],
        };
      }
      if (ref.kind === 'alienBase') {
        return {
          kind: T('geo.k.alienBase'), title: T('geo.alienBase.short'), icon: 'alien', tone: 'abase', rows: alienBaseRows(G, o),
          acts: [{ label: T('geo.a.sendTeam'), key: 'E', cls: 'primary', act: () => openIntercept({ target: ref }) }],
        };
      }
      return null;
    }
    function renderCard(force) {
      const box = S.els.card;
      if (!box) return;
      const ref = view.selection;
      const spec = ref ? cardSpec(ref) : null;
      if (!spec) {
        if (!box.classList.contains('hidden')) { box.classList.add('hidden'); OV.Dom.clear(box); }
        S.sigs.card = null;
        return;
      }
      const sig = JSON.stringify([spec.title, spec.sub, spec.rows, spec.acts.map((a) => a.label + (a.why || '')), spec.extra ? spec.extra.map((x) => x.c.id + x.c.status + x.st.ok + (x.cy ? x.cy.why || 'ok' : '')) : 0]);
      if (!force && sig === S.sigs.card) return;
      S.sigs.card = sig;
      OV.Dom.clear(box);
      box.className = 'geo-card t-' + (spec.tone || 'none');
      const close = el('button', { type: 'button', class: 'geo-x', 'aria-label': T('common.close'), text: '×', onclick: () => { sfx('ui_click'); select(null); } });
      box.appendChild(el('header', { class: 'geo-card-h' }, icon(spec.icon, 'big'), el('div', { class: 'geo-card-ht' }, el('small', { text: spec.kind }), el('b', { text: spec.title }), spec.sub ? el('span', { text: spec.sub }) : null), close));
      box.appendChild(kv(spec.rows));
      if (spec.extra) {
        const list = el('div', { class: 'geo-card-crafts' });
        for (const x of spec.extra) {
          const c = x.c, def = D().crafts[c.type];
          const row = el('div', { class: 'geo-cc' + (x.st.ok ? '' : ' off') },
            el('span', { class: 'geo-cc-n' }, el('b', { text: craftName(G, c) }), el('small', { text: T(craftStatusKey(c, G)) + ' · ' + T('geo.i.fuel') + ' ' + pct(c.fuel, def.fuel) + ' %' })));
          if (!isAir(c)) {
            if (x.cy) row.appendChild(btn(T('geo.a.cydoniaShort'), { cls: 'small cydonia', why: x.cy.why, tip: tip(T('geo.a.cydonia') + (x.cy.why ? ' — ' + x.cy.why : ''), 'X'), onClick: x.cy.act }));
            const lb = btn(T('geo.a.launch'), { cls: 'small', tip: tip(x.st.ok ? T('geo.a.launch.tip') : reasonText(x.st.reason)), onClick: () => openIntercept({ craftId: c.id }) });
            lb.disabled = !x.st.ok;
            row.appendChild(lb);
          } else row.appendChild(btn(T('geo.a.select'), { cls: 'small ghost', onClick: () => { select(refOf('craft', c.id)); centre(refOf('craft', c.id)); } }));
          list.appendChild(row);
        }
        box.appendChild(list);
      }
      if (spec.acts.length) {
        const ab = el('div', { class: 'geo-card-acts' });
        for (const a of spec.acts) ab.appendChild(btn(a.label, { cls: 'small ' + (a.cls || ''), key: a.key, why: a.why || null, tip: a.key ? tip(a.label + (a.why ? ' — ' + a.why : ''), a.key) : null, onClick: a.act }));
        ab.appendChild(btn(T('geo.a.centre'), { cls: 'small ghost', key: 'C', tip: tip(T('geo.a.centre'), 'C'), onClick: () => centre(ref) }));
        box.appendChild(ab);
      }
      S.cardActs = spec.acts;
    }
    function cardKey(k) {
      if (!view.selection || !S.cardActs) return false;
      const a = S.cardActs.find((x) => x.key && x.key.toLowerCase() === k.toLowerCase());
      if (!a) return false;
      if (a.why) { sfx('ui_deny'); OV.Dom.toast(a.why, null, 'warn'); return true; }
      sfx('ui_click');
      a.act();
      return true;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ordens às naves
    // ---------------------------------------------------------------------------------------------------------------
    function doRecall(craftId) {
      const r = W().recall(G, craftId);
      if (!r.ok) { sfx('ui_deny'); OV.Dom.toast(reasonText(r.reason), null, 'warn'); return; }
      OV.Dom.toast(T('geo.int.recalled', { craft: craftName(G, G.crafts[craftId]) }), null, 'info');
      afterOrder();
    }
    function doPatrol(craftId) {
      const c = G.crafts[craftId];
      if (!c) return;
      const r = W().patrol(G, craftId, c.lon, c.lat);
      if (!r.ok) { sfx('ui_deny'); OV.Dom.toast(reasonText(r.reason), null, 'warn'); return; }
      OV.Dom.toast(T('geo.int.patrolling', { craft: craftName(G, c) }), null, 'info');
      afterOrder();
    }
    function commitOrder(craftId, ref) {
      const c = G.crafts[craftId];
      if (!c) return { ok: false, reason: 'noCraft' };
      const wasReady = c.status === 'ready';
      const r = wasReady ? W().launch(G, craftId, ref) : W().order(G, craftId, ref);
      if (!r.ok) { sfx('ui_deny'); return r; }
      sfx('ui_confirm');
      const name = targetName(G, ref);
      OV.Dom.toast(T(wasReady ? 'geo.int.launched' : 'geo.int.redirected', { craft: craftName(G, c), target: name }) + (r.warn ? ' — ' + warnText(r.warn) : ''), null, r.warn ? 'warn' : 'good');
      select(refOf('craft', craftId));
      afterOrder();
      const e = ref && ref.kind !== 'point' && ref !== 'home' ? etaHours(G, c, ref) : null;
      if (e) showNudge(craftId, e.h);
      return r;
    }
    function afterOrder() {
      S.sigs.lists = null;
      S.sigs.card = null;
      refreshLists();
      renderCard();
      dirty();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // janelas (diálogos) na camada central: interceção, financiamento, escolha de base
    // ---------------------------------------------------------------------------------------------------------------
    function closeDlg() {
      if (!S.dlg) return;
      if (S.dlg.node) S.dlg.node.remove();
      S.dlg = null;
      view.country = null;
      if (view.mode === 'target') endTargetMode();
      OV.Dom.hideTooltip();
      dirty();
      pump();
    }
    function dlgShell(cls, kicker, title, onClose) {
      const close = el('button', { type: 'button', class: 'geo-x', 'aria-label': T('common.close'), text: '×', onclick: () => { sfx('ui_click'); onClose(); } });
      const body = el('div', { class: 'geo-dlg-b' });
      const foot = el('footer', { class: 'geo-dlg-f' });
      const node = el('section', { class: 'geo-dlg ' + cls, role: 'dialog', 'aria-label': title },
        el('header', { class: 'geo-dlg-h' }, el('div', null, el('small', { text: kicker }), el('h2', { text: title })), close), body, foot);
      return { node, body, foot };
    }

    // ---- interceção --------------------------------------------------------------------------------------------------
    // st = {step:'base'|'craft'|'target', baseId, craftId, target}
    function openIntercept(o) {
      if (!G.crafts || !Object.keys(G.crafts).length) { sfx('ui_deny'); OV.Dom.toast(T('geo.int.noCrafts'), null, 'warn'); return; }
      closeDlg();
      // send: «Enviar equipa» (alvo em terra) — título próprio e transportes com soldados no topo da lista
      const st = { baseId: o.baseId || null, craftId: o.craftId || null, target: o.target || null, step: null, err: null, send: !!o.send || (!!o.target && groundTarget(G, o.target)) };
      if (st.target) st.step = 'craft';
      else if (st.craftId) st.step = 'target';
      else st.step = G.bases.length > 1 && !st.baseId ? 'base' : 'craft';
      if (!st.baseId && G.bases.length === 1) st.baseId = G.bases[0].id;
      S.dlg = { kind: 'intercept', st, node: null, t: 0 };
      renderIntercept();
    }
    function interceptTitle(st) {
      if (st.step === 'base') return T('geo.int.chooseBase');
      if (st.step === 'craft') return st.target ? T(st.send ? 'geo.int.chooseTeamFor' : 'geo.int.chooseCraftFor', { target: targetName(G, st.target) }) : T('geo.int.chooseCraft');
      return T('geo.int.chooseTarget', { craft: craftName(G, G.crafts[st.craftId]) });
    }
    function renderIntercept() {
      const d = S.dlg;
      if (!d || d.kind !== 'intercept') return;
      const st = d.st;
      const old = d.node;
      const shell = dlgShell('geo-int', T(st.send && st.step === 'craft' ? 'geo.int.kickerTeam' : 'geo.int.kicker'), interceptTitle(st), () => closeDlg());
      d.node = shell.node;
      const list = el('div', { class: 'geo-rows scroll', 'data-scroll': '' });
      if (st.step === 'base') {
        for (const b of G.bases) {
          const rd = (b.crafts || []).filter((id) => G.crafts[id] && launchState(G, G.crafts[id]).ok).length;
          list.appendChild(rowBtn('base', baseName(b), placeName(b.lon, b.lat), T('geo.int.readyN', { n: rd }), true, null, () => { st.baseId = b.id; st.step = 'craft'; renderIntercept(); }));
        }
      } else if (st.step === 'craft') {
        const rows = craftsFor(G, st.target ? null : st.baseId, st.target);
        if (!rows.length) list.appendChild(el('p', { class: 'geo-empty', text: T('geo.int.noCrafts') }));
        for (const r of rows) {
          const c = G.crafts[r.craftId], def = D().crafts[c.type];
          const sub = T(craftStatusKey(c, G)) + ' · ' + T('geo.i.fuel') + ' ' + pct(c.fuel, def.fuel) + ' % · ' + T('geo.i.hull') + ' ' + pct(c.hp, def.hp) + ' %'
            + (def.transport ? ' · ' + T('geo.i.crewN', { n: (c.soldiers || []).length, max: def.seatsUI || def.seats }) : def.weapons ? ' · ' + weaponsText(c) : '');
          let right = '', note = null;
          if (!r.ok) note = { text: reasonText(r.reason), tone: 'bad' };
          else if (r.warn) note = { text: warnText(r.warn), tone: 'warn' };
          if (r.eta) right = fmtDur(r.eta.h);
          if (G.bases.length > 1) right = baseName(C().findBase(G, r.baseId)) + (right ? ' · ' + right : '');
          const dim = st.send && r.ok && !r.team ? ' dim' : '';
          list.appendChild(rowBtn('craft' + (def.transport ? ' transport' : '') + dim, craftName(G, c), sub, right, r.ok, note, () => {
            if (st.target) {
              const res = commitOrder(c.id, st.target);
              if (res.ok) closeDlg();
              else { st.err = reasonText(res.reason); renderIntercept(); }
            } else { st.craftId = c.id; st.step = 'target'; renderIntercept(); }
          }));
        }
      } else {
        const rows = targetsFor(G, st.craftId);
        if (!rows.length || (rows.length === 1 && rows[0].ref === 'home')) list.appendChild(el('p', { class: 'geo-empty', text: T('geo.int.noTargets') }));
        for (const r of rows) {
          const ref = r.ref;
          let ic = 'ufo', sub = '', cls = 'ufo';
          if (ref === 'home') { ic = 'base'; cls = 'home'; sub = baseName(C().findBase(G, G.crafts[st.craftId].baseId)); }
          else {
            const tg = C().targetOf(G, ref);
            if (ref.kind === 'ufo') { sub = T('geo.ufo.st.' + tg.obj.status) + ' · ' + (ufoKnown(tg.obj) ? T(ufoDef(tg.obj).nameKey) : T(ufoDef(tg.obj).sizeKey)) + ' · ' + placeName(tg.lon, tg.lat); cls = 'ufo k-' + tg.obj.status; }
            else if (ref.kind === 'site') { ic = 'skull'; cls = 'terror'; sub = T('geo.site.kind') + ' · ' + T('geo.approx', { t: fmtDur(tg.obj.leftS / 3600) }); }
            else if (ref.kind === 'alienBase') { ic = 'alien'; cls = 'abase'; sub = placeName(tg.lon, tg.lat); }
          }
          const right = r.eta ? fmtNm(r.eta.nm) + ' · ' + fmtDur(r.eta.h) : '';
          const note = !r.ok ? { text: reasonText(r.reason), tone: 'bad' } : r.warn ? { text: warnText(r.warn), tone: 'warn' } : null;
          list.appendChild(rowBtn(cls, ref === 'home' ? T('geo.tk.home') : targetName(G, ref), sub, right, r.ok, note, () => {
            const res = commitOrder(st.craftId, ref);
            if (res.ok) closeDlg();
            else { st.err = reasonText(res.reason); renderIntercept(); }
          }, ic));
        }
      }
      shell.body.appendChild(list);
      if (st.err) shell.body.appendChild(el('p', { class: 'geo-err', role: 'alert', text: st.err }));
      // rodapé
      const backTo = st.step === 'target' ? 'craft' : st.step === 'craft' && !st.target && G.bases.length > 1 ? 'base' : null;
      if (backTo) shell.foot.appendChild(btn(T('geo.a.back'), { cls: 'ghost', onClick: () => { st.step = backTo; st.err = null; renderIntercept(); } }));
      shell.foot.appendChild(el('span', { class: 'geo-grow' }));
      if (st.step === 'target') shell.foot.appendChild(btn(T('geo.a.pickPoint'), { icon: 'globe', key: 'G', tip: tip(T('geo.a.pickPoint.tip'), 'G'), onClick: () => startTargetMode(st.craftId) }));
      shell.foot.appendChild(btn(T('common.cancel'), { key: 'Esc', onClick: () => closeDlg() }));
      if (old && old.parentNode) old.replaceWith(shell.node);
      else S.els.layer.appendChild(shell.node);
      d.sig = interceptSig(st);
      const first = shell.node.querySelector('.geo-row:not(:disabled)');
      if (first && OV.Input.lastPointerType !== 'touch') setTimeout(() => { if (first.isConnected) first.focus({ preventScroll: true }); }, 0);
    }
    function interceptSig(st) {
      try {
        if (st.step === 'craft') return JSON.stringify(craftsFor(G, st.target ? null : st.baseId, st.target).map((r) => [r.craftId, r.ok, r.reason, r.warn]));
        if (st.step === 'target') return JSON.stringify(targetsFor(G, st.craftId).map((r) => [r.ref, r.ok, r.reason, r.warn]));
      } catch (e) { return ''; }
      return '';
    }
    function rowBtn(cls, title, sub, right, ok, note, onPick, ic) {
      const b = el('button', { type: 'button', class: 'geo-row ' + cls },
        icon(ic || (cls.indexOf('craft') === 0 ? 'craft' : cls)),
        el('span', { class: 'geo-row-t' }, el('b', { text: title }), el('small', { text: sub }), note ? el('em', { class: 't-' + note.tone, text: note.text }) : null),
        right ? el('span', { class: 'geo-row-r', text: right }) : null);
      b.disabled = !ok;
      b.addEventListener('click', (e) => {
        if (b.disabled) return;
        if (e.detail > 0) b.blur();
        onPick();
      });
      return b;
    }

    // ---- alvo escolhido no globo --------------------------------------------------------------------------------------
    function startTargetMode(craftId) {
      const c = G.crafts[craftId];
      if (!c) return;
      S.target = { craftId };
      view.mode = 'target';
      view.targetFrom = { lon: c.lon, lat: c.lat };
      if (S.dlg && S.dlg.node) S.dlg.node.classList.add('hidden');
      showBanner(T('geo.tm.title', { craft: craftName(G, c) }), T('geo.tm.hint'), 'target');
      setCursor('crosshair');
      dirty();
    }
    function endTargetMode(back) {
      S.target = null;
      view.mode = 'normal';
      view.targetFrom = null;
      hideBanner();
      setCursor('');
      if (back && S.dlg && S.dlg.node) { S.dlg.node.classList.remove('hidden'); renderIntercept(); }
      dirty();
    }
    // referência de ordem para o que está sob o cursor (objeto ou ponto)
    function targetRefAt(x, y) {
      const hit = OV.GlobeRender.objectAt(G, view, x, y);
      if (hit) {
        if (hit.kind === 'ufo' || hit.kind === 'site' || hit.kind === 'alienBase') return { kind: hit.kind, id: hit.id };
        if (hit.kind === 'base') {
          const c = S.target && G.crafts[S.target.craftId];
          if (c && c.baseId === hit.id) return 'home';
          return { kind: 'base', id: hit.id };
        }
        if (hit.kind === 'city') { const ct = D().citiesById[hit.id]; if (ct) return { kind: 'point', lon: ct.lon, lat: ct.lat }; }
      }
      const p = OV.GlobeRender.pick(view, x, y);
      return p ? { kind: 'point', lon: p.lon, lat: p.lat } : null;
    }
    function targetHover(x, y) {
      if (!S.target) return;
      const ref = targetRefAt(x, y);
      const key = JSON.stringify(ref && ref.kind === 'point' ? null : ref);
      if (key === S.lastHoverRef && ref && ref.kind !== 'point') return;
      S.lastHoverRef = key;
      if (!ref) { showBanner(T('geo.tm.title', { craft: craftName(G, G.crafts[S.target.craftId]) }), T('geo.tm.hint'), 'target'); return; }
      const r = W().canOrder(G, S.target.craftId, ref);
      const name = ref === 'home' ? T('geo.tk.home') : targetName(G, ref);
      const e = etaHours(G, G.crafts[S.target.craftId], ref);
      const msg = !r.ok ? reasonText(r.reason) : r.warn ? warnText(r.warn) : e ? fmtNm(e.nm) + ' · ' + fmtDur(e.h) : '';
      showBanner(name, msg, !r.ok ? 'bad' : r.warn ? 'warn' : 'ok');
    }
    function targetClick(x, y) {
      const ref = targetRefAt(x, y);
      if (!ref) { sfx('ui_deny'); return; }
      const craftId = S.target.craftId;
      const r = commitOrder(craftId, ref);
      if (!r.ok) {
        showBanner(ref === 'home' ? T('geo.tk.home') : targetName(G, ref), reasonText(r.reason), 'bad');
        return;
      }
      endTargetMode(false);
      closeDlg();
    }

    // ---- financiamento -----------------------------------------------------------------------------------------------
    function openFunding() {
      closeDlg();
      const shell = dlgShell('geo-fund', T('geo.fund.kicker'), T('geo.fund.title'), () => closeDlg());
      S.dlg = { kind: 'funding', node: shell.node };
      const rows = fundingRows(G);
      const income = OV.Economy && OV.Economy.income ? OV.Economy.income(G) : rows.reduce((s, r) => s + (r.pact ? 0 : r.funding), 0);
      const upkeep = OV.Economy && OV.Economy.upkeep ? OV.Economy.upkeep(G).total : 0;
      const rating = OV.Economy && OV.Economy.rating ? OV.Economy.rating(G) : 0;
      const rkey = OV.Economy && OV.Economy.ratingKey ? OV.Economy.ratingKey(G, rating) : null;
      const thr = (tune('RATING_THRESHOLD', [-900, -700, -500]) || [])[G.difficulty | 0];
      const sm = G.score && G.score.month ? G.score.month : null;
      // resumo do mês corrente
      const sum = el('div', { class: 'geo-fund-sum' },
        stat(T('geo.fund.income'), fmtMoney(income), 'good'),
        stat(T('geo.fund.upkeep'), fmtMoney(-upkeep), 'bad'),
        stat(T('geo.fund.balance'), fmtMoney(income - upkeep), income - upkeep >= 0 ? 'good' : 'bad'),
        stat(T('geo.fund.rating'), (rating > 0 ? '+' : '') + fmtInt(rating) + (rkey && has(rkey) ? ' · ' + T(rkey) : ''), Number.isFinite(thr) && rating <= thr ? 'bad' : rating > 0 ? 'good' : 'warn'));
      shell.body.appendChild(sum);
      if (sm) {
        shell.body.appendChild(el('p', { class: 'geo-fund-month' }, T('geo.fund.thisMonth', { x: fmtInt(sm.xcom.total + (sm.research | 0)), a: fmtInt(sm.alien.total) })));
        if (Number.isFinite(thr) && rating <= thr) shell.body.appendChild(el('p', { class: 'geo-err', text: T('geo.fund.councilWarn') }));
      }
      const grid = el('div', { class: 'geo-fund-grid' });
      // tabela de países
      const tbl = el('table', { class: 'tbl geo-fund-t' },
        el('thead', null, el('tr', null, el('th', { text: T('geo.fund.country') }), el('th', { class: 'r', text: T('geo.fund.funding') }), el('th', { class: 'r', text: T('geo.fund.change') }), el('th', { text: T('geo.fund.trend') }))));
      const tb = el('tbody');
      for (const r of rows) {
        const arrow = r.pact ? '✕' : r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '–';
        const cls = r.pact ? 'bad' : r.delta > 0 ? 'good' : r.delta < 0 ? 'bad' : 'muted';
        const tr = el('tr', { class: 'click' + (r.pact ? ' pact' : '') },
          el('td', null, el('b', { text: r.name }), r.pact ? el('small', { class: 'bad', text: ' ' + T('geo.fund.pact') }) : null),
          el('td', { class: 'r mono', text: fmtMoney(r.funding) }),
          el('td', { class: 'r mono ' + cls, text: arrow + ' ' + (r.delta ? fmtMoney(Math.abs(r.delta)) : '') }),
          el('td', null, spark(r.history.concat([r.funding]))));
        tr.addEventListener('click', () => { const c = D().countries[r.id]; if (c && c.label) { centre({ lon: c.label[0], lat: c.label[1] }, 1.5); view.country = r.id; dirty(); } });
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      tbl.appendChild(el('tfoot', null, el('tr', null, el('td', { text: T('geo.fund.total') }), el('td', { class: 'r mono', text: fmtMoney(income) }), el('td'), el('td'))));
      grid.appendChild(el('div', { class: 'geo-fund-l scroll', 'data-scroll': '' }, tbl));
      // gráfico mensal
      const gbox = el('div', { class: 'geo-fund-r' }, el('h3', { class: 'geo-lh' }, el('span', { text: T('geo.fund.graph') })));
      const cv = el('canvas', { class: 'geo-graph', 'aria-label': T('geo.fund.graph') });
      gbox.appendChild(cv);
      gbox.appendChild(el('div', { class: 'geo-legend' }, el('span', { class: 'lx', text: T('geo.fund.legend.xcom') }), el('span', { class: 'la', text: T('geo.fund.legend.alien') }), el('span', { class: 'lf', text: T('geo.fund.legend.funds') })));
      if (!G.history.length) gbox.appendChild(el('p', { class: 'geo-empty', text: T('geo.fund.noHistory') }));
      grid.appendChild(gbox);
      shell.body.appendChild(grid);
      shell.foot.appendChild(el('span', { class: 'geo-grow' }));
      shell.foot.appendChild(btn(T('common.close'), { cls: 'primary', key: 'F', onClick: () => closeDlg() }));
      S.els.layer.appendChild(shell.node);
      requestAnimationFrame(() => drawGraph(cv));
    }
    function stat(label, value, tone) {
      return el('div', { class: 'geo-stat' }, el('small', { text: label }), el('b', { class: tone || '', text: value }));
    }
    function spark(vals) {
      const w = 64, h = 18, dpr = OV.View.dpr || 1;
      const cv = el('canvas', { class: 'geo-spark', width: String(w * dpr), height: String(h * dpr) });
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      const g = cv.getContext('2d');
      if (!g || vals.length < 2) return cv;
      g.scale(dpr, dpr);
      const mx = Math.max(...vals), mn = Math.min(...vals), span = Math.max(1, mx - mn);
      g.strokeStyle = vals[vals.length - 1] >= vals[0] ? '#5fe08a' : '#ff6a5e';
      g.lineWidth = 1.5;
      g.beginPath();
      vals.forEach((v, i) => {
        const x = 2 + (i / (vals.length - 1)) * (w - 4), y = h - 3 - ((v - mn) / span) * (h - 6);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      return cv;
    }
    function drawGraph(cv) {
      if (!cv.isConnected) return;
      const dpr = OV.View.dpr || 1;
      const w = Math.max(160, cv.clientWidth), h = Math.max(110, cv.clientHeight);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      g.clearRect(0, 0, w, h);
      const hist = G.history.slice(-12);
      const sm = G.score && G.score.month;
      const bars = hist.map((x) => ({ m: x.month, xcom: (x.xcom | 0) + (x.research | 0), alien: x.alien | 0, funds: x.funds, cur: false }));
      if (sm) bars.push({ m: G.month, xcom: (sm.xcom.total | 0) + (sm.research | 0), alien: sm.alien.total | 0, funds: G.funds, cur: true });
      const pad = { l: 8, r: 8, t: 10, b: 18 };
      const mx = Math.max(100, ...bars.map((b) => Math.max(b.xcom, b.alien)));
      const n = Math.max(3, bars.length), slot = (w - pad.l - pad.r) / n, bw = Math.max(4, Math.min(16, slot * 0.32));
      const y0 = h - pad.b, sc = (h - pad.t - pad.b) / mx;
      g.strokeStyle = 'rgba(120,160,200,0.18)';
      g.beginPath();
      for (let k = 1; k <= 3; k++) { const y = y0 - (k / 3) * (y0 - pad.t); g.moveTo(pad.l, y + 0.5); g.lineTo(w - pad.r, y + 0.5); }
      g.stroke();
      g.font = '600 9px ' + getComputedStyle(document.body).fontFamily;
      g.textAlign = 'center';
      bars.forEach((b, i) => {
        const cx = pad.l + slot * (i + 0.5);
        g.globalAlpha = b.cur ? 0.55 : 1;
        g.fillStyle = '#3fd7c5';
        g.fillRect(cx - bw - 1, y0 - b.xcom * sc, bw, b.xcom * sc);
        g.fillStyle = '#ff4f43';
        g.fillRect(cx + 1, y0 - b.alien * sc, bw, b.alien * sc);
        g.globalAlpha = 1;
        g.fillStyle = '#9fe9df';
        if (b.xcom) g.fillText(String(b.xcom), cx - bw / 2 - 1, Math.max(9, y0 - b.xcom * sc - 3));
        g.fillStyle = '#ff9a8f';
        if (b.alien) g.fillText(String(b.alien), cx + bw / 2 + 1, Math.max(9, y0 - b.alien * sc - 3));
        g.fillStyle = b.cur ? '#ffb53d' : '#7d93a6';
        g.fillText(OV.U.MONTHS[(b.m % 12 + 12) % 12], cx, h - 5);
      });
      // fundos (linha)
      const fv = bars.map((b) => b.funds);
      const fmx = Math.max(...fv, 1), fmn = Math.min(...fv, 0), fs = Math.max(1, fmx - fmn);
      if (bars.length > 1) {
        g.strokeStyle = '#ffb53d';
        g.lineWidth = 1.6;
        g.beginPath();
        bars.forEach((b, i) => {
          const x = pad.l + slot * (i + 0.5), y = y0 - ((b.funds - fmn) / fs) * (y0 - pad.t);
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        });
        g.stroke();
      }
    }

    // ---- várias bases: escolher qual abrir ----------------------------------------------------------------------------
    function openBases() {
      if (!fn('BaseUI', 'open')) { sfx('ui_deny'); OV.Dom.toast(T('geo.noBaseUI'), null, 'warn'); return; }
      const b = selBase();
      if (b || G.bases.length === 1) { openBase((b || G.bases[0]).id); return; }
      closeDlg();
      const shell = dlgShell('geo-bases', T('geo.btn.bases'), T('geo.int.chooseBase'), () => closeDlg());
      S.dlg = { kind: 'bases', node: shell.node };
      const list = el('div', { class: 'geo-rows' });
      for (const x of G.bases) list.appendChild(rowBtn('base', baseName(x), placeName(x.lon, x.lat), T('geo.i.craftsN', { n: x.crafts.length }), true, null, () => { closeDlg(); openBase(x.id); }, 'base'));
      shell.body.appendChild(list);
      shell.foot.appendChild(el('span', { class: 'geo-grow' }));
      shell.foot.appendChild(btn(T('common.cancel'), { key: 'Esc', onClick: () => closeDlg() }));
      S.els.layer.appendChild(shell.node);
    }
    function selBase() {
      const s = view.selection;
      if (!s) return null;
      if (s.kind === 'base') return C().findBase(G, s.id);
      if (s.kind === 'craft') { const c = G.crafts[s.id]; return c ? C().findBase(G, c.baseId) : null; }
      return null;
    }
    function openBase(baseId, tab) {
      if (!fn('BaseUI', 'open')) { sfx('ui_deny'); OV.Dom.toast(T('geo.noBaseUI'), null, 'warn'); return; }
      closePopupQuiet();
      OV.BaseUI.open(G, baseId, tab);
    }
    function openUfopaedia(article) {
      if (!fn('Ufopaedia', 'open')) { sfx('ui_deny'); return; }
      OV.Ufopaedia.open(G, article);
    }
    function openOptions() {
      if (OV.Screens && typeof OV.Screens.openOptions === 'function') OV.Screens.openOptions();
      else if (OV.SceneDefs.options) OV.Scenes.push('options', { inGame: true });
    }
    function saveGame() {
      if (fn('CampaignUI', 'saveDialog')) { OV.CampaignUI.saveDialog(G); return; }
      if (!OV.Save || typeof OV.Save.save !== 'function') { sfx('ui_deny'); OV.Dom.toast(T('geo.save.err.unavailable'), null, 'warn'); return; }
      const r = OV.Save.save('1', G, null, { label: saveLabel() });
      if (r.ok) { sfx('ui_confirm'); OV.Dom.toast(T('geo.save.done'), null, 'good'); }
      else { sfx('ui_deny'); OV.Dom.toast(T('geo.save.err.' + (has('geo.save.err.' + r.reason) ? r.reason : 'unavailable')), null, 'warn'); }
    }
    const saveLabel = () => T('geo.saveLabel', { date: OV.U.fmtDate(G.t, false), base: baseName(G.bases[0]) });
    function doAutosave() {
      S.autosave = false;
      if (fn('CampaignUI', 'autosave')) { OV.CampaignUI.autosave(G); return; }
      if (!OV.Save || typeof OV.Save.save !== 'function') return;
      const r = OV.Save.save('auto', G, null, { label: saveLabel() });
      if (r.ok) OV.Dom.toast(T('geo.save.auto'), null, 'info');
      else OV.Dom.toast(T('geo.save.autoFail', { reason: T('geo.save.err.' + (has('geo.save.err.' + r.reason) ? r.reason : 'unavailable')) }), null, 'warn');
    }

    // ---------------------------------------------------------------------------------------------------------------
    // faixa superior (modo alvo, missão em curso)
    // ---------------------------------------------------------------------------------------------------------------
    function showBanner(title, text, tone, actions) {
      const b = S.els.banner;
      OV.Dom.clear(b);
      b.className = 'geo-banner t-' + (tone || 'info');
      b.appendChild(el('b', { text: title }));
      if (text) b.appendChild(el('span', { text }));
      for (const a of actions || []) b.appendChild(btn(a.label, { cls: 'small ' + (a.cls || ''), onClick: a.act }));
    }
    function hideBanner() {
      S.els.banner.classList.add('hidden');
      OV.Dom.clear(S.els.banner);
    }
    // interceção aberta por cima: o tempo está parado e o painel não responde — diz-se porquê
    function dfBanner(on) {
      if (on) {
        if (S.target || S.blockedBattle) return;
        S.dfBanner = true;
        showBanner(T('geo.dfBanner.title'), T('geo.dfBanner.text'), 'warn');
      } else if (S.dfBanner) {
        S.dfBanner = false;
        if (!S.target && !S.blockedBattle) hideBanner();
      }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // eventos: fila de janelas, toasts agrupados, cenas de outros módulos
    // ---------------------------------------------------------------------------------------------------------------
    function handle(evs0) {
      const evs = dropBaseLosses(evs0);
      for (const ev of evs) {
        const mode = classify(ev);
        if (ev.t === 'terrorSiteExpired') logTerror(G, ev);
        if (ev.t === 'ufoDetected') highlight(refOf('ufo', ev.ufoId), 8000);
        if (ev.t === 'terrorSite') highlight(refOf('site', ev.siteId), 12000);
        if (ev.t === 'alienBaseFound') highlight(refOf('alienBase', ev.alienBaseId), 12000);
        if (mode === 'popup') enqueuePopup(ev);
        else if (mode === 'toast') addToast(ev);
        else if (mode === 'debug') { if (debugOn(G)) addToast(ev); }
        else if (mode === 'action') { if (ev.t === 'autosaveDue') S.autosave = true; }
        else if (mode === 'scene') enqueueScene(ev);
      }
      S.sigs.lists = null;
      dirty();
    }
    function addToast(ev) {
      const list = S.toasts.get(ev.t) || [];
      list.push(ev);
      S.toasts.set(ev.t, list);
    }
    function flushToasts(force) {
      if (!S.toasts.size) return;
      const t = nowMs();
      if (!force && t - S.toastT < 700) return;
      S.toastT = t;
      for (const [type, evs] of S.toasts) {
        const m = toastFor(G, type, evs);
        OV.Dom.toast(m.text, null, m.kind);
      }
      S.toasts.clear();
    }
    function enqueuePopup(ev) {
      if (MERGE[ev.t]) {
        const q = S.queue.find((x) => x.kind === 'popup' && x.type === ev.t);
        if (q) { q.evs.push(ev); return; }
      }
      if (ev.t === 'ufoDetected' && S.queue.some((x) => x.type === 'ufoDetected' && x.evs[0].ufoId === ev.ufoId)) return;
      S.queue.push({ kind: 'popup', type: ev.t, evs: [ev] });
    }
    function enqueueScene(ev) {
      if (ev.t === 'dogfightStart') {
        // vários combates no mesmo lote abrem uma só vez (o painel junta-os)
        if (S.queue.some((x) => x.kind === 'scene' && x.type === 'dogfightStart')) return;
        S.queue.unshift({ kind: 'scene', type: ev.t, ev, open: () => openDogfights() });
        return;
      }
      if (ev.t === 'monthEnd') {
        S.queue.push({
          kind: 'scene', type: ev.t, ev, open: () => {
            stinger('monthly');
            if (fn('CampaignUI', 'monthReport')) OV.CampaignUI.monthReport(G, ev.report);
            else showPopup({ kind: 'popup', type: 'monthEnd', evs: [ev] });
          },
        });
        return;
      }
      if (ev.t === 'gameOver' || ev.t === 'victory') {
        S.queue.push({ kind: 'scene', type: ev.t, ev, open: () => endFlow(ev) });
      }
    }
    function endFlow(ev) {
      if (S.endShown) return;
      S.endShown = true;
      const won = ev ? ev.t === 'victory' : !!G.flags.won;
      const reason = ev && ev.reason ? ev.reason : G.flags.lostReason;
      if (won && fn('CampaignUI', 'victory')) { OV.CampaignUI.victory(G); return; }
      if (!won && fn('CampaignUI', 'gameOver')) { OV.CampaignUI.gameOver(G, reason); return; }
      showPopup({ kind: 'popup', type: won ? 'victory' : 'gameOver', evs: [{ t: won ? 'victory' : 'gameOver', reason }] });
    }
    function openDogfights() {
      if (!G.dogfights.length) return;
      if (fn('DogfightUI', 'open')) {
        const ok = OV.DogfightUI.open(G);
        if (ok) return;
      }
      fallbackDogfight();
    }
    // pump: mostra a próxima janela da fila quando nada a bloqueia
    function pump() {
      if (S.popup || S.dlg || S.waiting || !isTop() || S.fallbackDf) return;
      while (S.queue.length) {
        const it = S.queue.shift();
        if (it.kind === 'popup') {
          if (showPopup(it)) return;
          continue;
        }
        it.open();
        if (!isTop()) { S.waiting = true; return; }
        if (S.popup || S.dlg || S.fallbackDf) return;
      }
    }
    function closePopupQuiet() {
      if (!S.popup) return;
      S.popup.node.remove();
      S.popup = null;
    }

    // ---- janela de aviso ----------------------------------------------------------------------------------------------
    // spec = {tone, icon, kicker, title, text, lines[], rows[], buttons:[{label, key, cls, act, def, esc}], focus, sound}
    function popupSpec(it) {
      const ev = it.evs[0], evs = it.evs;
      const craftOf = (e) => (e.craftId ? G.crafts[e.craftId] : null);
      const ok = { label: T('common.ok'), key: 'Enter', def: true, esc: true, act: () => {} };
      const centreBtn = (ref) => ({ label: T('geo.a.centre'), key: 'C', act: () => { select(ref); centre(ref); } });
      const sendBtn = (ref, primary) => ({ label: T('geo.a.sendTeam'), key: 'E', cls: primary ? 'primary' : '', act: () => openIntercept({ target: ref, send: true }) });
      const baseBtn = (baseId, tab) => ({ label: T('geo.a.goBase'), key: 'B', disabled: !fn('BaseUI', 'open'), act: () => openBase(baseId, tab) });
      const b = (e) => baseName(C().findBase(G, e.baseId));
      switch (ev.t) {
        case 'ufoDetected': {
          const u = C().findUfo(G, ev.ufoId);
          if (!u || !ufoVisible(G, u)) return null;
          const ref = refOf('ufo', u.id);
          const home = u.targetBaseId ? C().findBase(G, u.targetBaseId) : null;
          if (home && u.status === 'flying') {
            // ours: a nave de assalto da retaliação vem direita à base — interceta-se sem aviso de velocidade
            const h = GM().distNm(u, home) / Math.max(1, u.speed);
            return {
              tone: 'terror', icon: 'base', title: T('geo.ev.assault'), sound: 'siren', focus: ref, kicker: T('geo.ev.terrorSite.kicker'),
              text: T('geo.ev.assault.body', { ufo: ufoName(u), base: baseName(home), t: fmtDur(h) }),
              lines: [T('geo.ev.assault.tips')], rows: ufoRows(G, u),
              buttons: [{ label: T('geo.a.intercept'), key: 'I', cls: 'primary', act: () => openIntercept({ target: ref }) }, baseBtn(home.id, 'crafts'), ok],
            };
          }
          return {
            tone: 'alert', icon: 'ufo', title: T('geo.ev.ufoDetected'), sound: 'ufo_detected', focus: ref,
            text: T(u.status === 'flying' ? 'geo.ev.ufoDetected.body' : 'geo.ev.ufoDetected.bodyGround', { ufo: ufoName(u), place: placeName(u.lon, u.lat) }),
            lines: ev.hyper ? [T('geo.ev.ufoDetected.hyper')] : [], rows: ufoRows(G, u),
            buttons: [u.status === 'flying' ? { label: T('geo.a.intercept'), key: 'I', cls: 'primary', act: () => openIntercept({ target: ref }) } : sendBtn(ref, true), centreBtn(ref), ok],
          };
        }
        case 'ufoLost': {
          const u = C().findUfo(G, ev.ufoId);
          const p = u && u.lastSeen ? { kind: 'point', lon: u.lastSeen.lon, lat: u.lastSeen.lat } : null;
          return { tone: 'warn', icon: 'radar', title: T('geo.ev.ufoLost'), sound: 'radar_ping', focus: p, text: T('geo.ev.ufoLost.body', { ufo: T('geo.ufo.label', { n: numOf(ev.ufoId) }) }), buttons: [ok] };
        }
        case 'ufoLanded': {
          const u = C().findUfo(G, ev.ufoId);
          if (!u) return null;
          // pouso no mar dura 5 s (orig): não há assalto possível, por isso não se interrompe o jogador
          if (u.status !== 'landed' || !GM().isLand(u.lon, u.lat)) return null;
          const ref = refOf('ufo', u.id);
          return {
            tone: 'warn', icon: 'ufo', title: T('geo.ev.ufoLanded'), sound: 'radar_ping', focus: ref,
            text: T('geo.ev.ufoLanded.body', { ufo: ufoName(u), place: placeName(u.lon, u.lat) }), rows: ufoRows(G, u),
            lines: [teamEtaLine(G, ref, 0)],
            buttons: [sendBtn(ref, true), centreBtn(ref), ok],
          };
        }
        case 'ufoCrashed': {
          const u = C().findUfo(G, ev.ufoId);
          if (!u) return null;
          const ref = refOf('ufo', u.id);
          return {
            tone: 'good', icon: 'ufo', title: T('geo.ev.ufoCrashed'), sound: 'ui_confirm', focus: ref,
            text: T('geo.ev.ufoCrashed.body', { ufo: ufoName(u), place: placeName(u.lon, u.lat), craft: craftName(G, craftOf(ev)) }),
            rows: [['geo.i.type', ufoKnown(u) ? T(ufoDef(u).nameKey) : T(ufoDef(u).sizeKey)], ['geo.i.crashLeft', T('geo.approx', { t: fmtDur(u.crashLeftS / 3600) })]],
            lines: [teamEtaLine(G, ref, u.crashLeftS)],
            buttons: [sendBtn(ref, true), centreBtn(ref), ok],
          };
        }
        case 'ufoDestroyed': {
          const def = D().ufos[ev.type];
          return {
            tone: 'good', icon: 'star', title: T('geo.ev.ufoDestroyed'), sound: 'ui_confirm',
            text: T('geo.ev.ufoDestroyed.body', { ufo: T('geo.ufo.label', { n: numOf(ev.ufoId) }), type: def ? T(def.nameKey) : '—', score: fmtInt(ev.score | 0) }),
            lines: [T('geo.ev.ufoDestroyed.note')], buttons: [ok],
          };
        }
        case 'ufoEscaped':
          return { tone: 'warn', icon: 'ufo', title: T('geo.ev.ufoEscaped'), text: T('geo.ev.ufoEscaped.body', { ufo: T('geo.ufo.label', { n: numOf(ev.ufoId) }), craft: craftName(G, craftOf(ev)) }), buttons: [ok] };
        case 'craftArrived': {
          const c = craftOf(ev);
          if (!c) return null;
          const tref = ev.target && ev.target.kind !== 'point' ? { kind: ev.target.kind, id: ev.target.id } : ev.target;
          const recall = { label: T('geo.a.recall'), key: 'R', act: () => doRecall(c.id) };
          const fit = (c.soldiers || []).filter((id) => { const s = C().findSoldier(G, id); return s && !s.woundDays; }).length;
          if (ev.prompt === 'mission') {
            return {
              tone: 'good', icon: 'craft', title: T('geo.ev.arrived.mission'), sound: 'radar_ping', focus: refOf('craft', c.id),
              text: T('geo.ev.arrived.mission.body', { craft: craftName(G, c), target: targetName(G, tref), n: fit }),
              buttons: [{ label: T('geo.a.startMission'), key: 'Enter', cls: 'primary', def: true, act: () => launchMission(tref, c.id) },
                { label: T('geo.a.wait'), key: 'W', esc: true, act: () => {} }, recall],
            };
          }
          if (ev.prompt === 'patrol') {
            return {
              tone: 'info', icon: 'craft', title: T('geo.ev.arrived.patrol'), focus: refOf('craft', c.id),
              text: T('geo.ev.arrived.patrol.body', { craft: craftName(G, c) }),
              buttons: [{ label: T('geo.a.keepPatrol'), key: 'Enter', def: true, esc: true, act: () => {} }, { label: T('geo.a.newDest'), key: 'D', act: () => openIntercept({ craftId: c.id }) }, recall],
            };
          }
          const transport = D().crafts[c.type] && D().crafts[c.type].transport;
          return {
            tone: 'info', icon: 'craft', title: T('geo.ev.arrived.none'), focus: refOf('craft', c.id),
            text: T(transport ? 'geo.ev.arrived.none.body' : 'geo.ev.arrived.none.bodyArmed', { craft: craftName(G, c), target: targetName(G, tref) }),
            buttons: [{ label: T('geo.a.wait'), key: 'Enter', def: true, esc: true, act: () => {} }, { label: T('geo.a.newDest'), key: 'D', act: () => openIntercept({ craftId: c.id }) }, recall],
          };
        }
        case 'craftLowFuel': {
          const c = craftOf(ev);
          if (!c) return null;
          return { tone: 'warn', icon: 'fuel', title: T('geo.ev.craftLowFuel'), sound: 'ui_deny', focus: refOf('craft', c.id), text: T('geo.ev.craftLowFuel.body', { craft: craftName(G, c) }), buttons: [ok] };
        }
        case 'craftLost': {
          const n = evs.reduce((sum, e) => sum + (e.soldiers || []).length, 0);
          const body = (e) => T('geo.ev.craftLost.body.' + (e.reason || 'dogfight'), { craft: D().crafts[e.type] ? T(D().crafts[e.type].nameKey) : e.type });
          // sem transporte a base não consegue responder a nada: diz-se já onde comprar outro
          const noTransport = !Object.keys(G.crafts).some((id) => D().crafts[G.crafts[id].type] && D().crafts[G.crafts[id].type].transport);
          const lines = evs.length > 1 ? evs.map(body) : [];
          if (n) lines.push(Tn('geo.ev.craftLost.crew', n));
          if (noTransport) lines.push(T('geo.ev.craftLost.noTransport'));
          return {
            tone: 'alert', icon: 'alert', title: evs.length > 1 ? Tn('geo.ev.craftLost.many', evs.length) : T('geo.ev.craftLost'), sound: 'ui_deny',
            text: evs.length > 1 ? '' : body(ev),
            lines, buttons: noTransport && G.bases[0] ? [baseBtn(G.bases[0].id, 'market'), ok] : [ok],
          };
        }
        case 'targetLost': {
          const c = craftOf(ev);
          if (!c) return null;
          return {
            tone: 'warn', icon: 'radar', title: T('geo.ev.targetLost'), focus: refOf('craft', c.id),
            text: T('geo.ev.targetLost.body', { craft: craftName(G, c) }),
            buttons: [{ label: T('geo.a.keepPatrol'), key: 'Enter', def: true, esc: true, act: () => {} }, { label: T('geo.a.newDest'), key: 'D', act: () => openIntercept({ craftId: c.id }) }, { label: T('geo.a.recall'), key: 'R', act: () => doRecall(c.id) }],
          };
        }
        case 'researchDone': {
          const lines = [];
          for (const e of evs) {
            if (e.unlocked && e.unlocked.length) lines.push(T('geo.ev.researchDone.unlocked', { list: e.unlocked.map(researchName).join(', ') }));
            if (e.manufacture && e.manufacture.length) lines.push(T('geo.ev.researchDone.manufacture', { list: e.manufacture.map(prodName).join(', ') }));
          }
          // cientistas parados custam salário e tempo: lembra-se aqui, onde o jogador decide o próximo projeto
          let idle = 0;
          try { idle = OV.BaseSim.staff(G, ev.baseId).scientists.free | 0; } catch (e) { idle = 0; }
          if (idle > 0 && C().availableResearch(G, ev.baseId).length) lines.push(Tn('geo.ev.researchDone.idle', idle));
          // a investigação que abre Cidónia: a missão final parte daqui (ou do cartão da base, ou do hangar)
          const final = evs.some((e) => (e.flags || []).indexOf('cydoniaUnlocked') >= 0) && G.flags.cydoniaUnlocked && CU();
          let cyBtn = null;
          if (final) {
            const pick = CU().cydoniaPick(G, null);
            lines.unshift(pick.ok ? T('geo.ev.cydonia.ready', { craft: craftName(G, G.crafts[pick.craftId]) }) : T('geo.ev.cydonia.notYet', { why: CU().cydoniaWhy(pick.reason) }));
            cyBtn = { label: T('geo.a.cydonia'), key: 'X', cls: 'primary cydonia', disabled: !pick.ok, act: () => CU().launchCydonia(G, pick.craftId) };
          }
          return {
            tone: 'good', icon: final ? 'star' : 'lab', title: T(final ? 'geo.ev.cydonia' : 'geo.ev.researchDone'), sound: 'research_done', stinger: 'research',
            text: T('geo.ev.researchDone.body', { topic: researchName(ev.topic), base: b(ev) }), lines,
            buttons: [cyBtn,
              { label: T('geo.a.viewUfopaedia'), key: 'U', cls: final ? '' : 'primary', disabled: !fn('Ufopaedia', 'open'), act: () => openUfopaedia(ev.article || ev.topic) },
              { label: T('geo.a.newProject'), key: 'N', disabled: !fn('BaseUI', 'open'), act: () => openBase(ev.baseId, 'research') }, ok].filter(Boolean),
          };
        }
        case 'productionDone':
          return {
            tone: 'good', icon: 'gear', title: T('geo.ev.productionDone'), sound: 'production_done',
            text: evs.length > 1 ? T('geo.ev.productionDone.many') : T('geo.ev.productionDone.body', { qty: ev.qty | 0, item: prodName(ev.item), base: b(ev) }),
            lines: evs.length > 1 ? evs.map((e) => T('geo.ev.productionDone.line', { qty: e.qty | 0, item: prodName(e.item), base: b(e) })) : [],
            buttons: [baseBtn(ev.baseId, 'production'), ok],
          };
        case 'productionStalled':
          return {
            tone: 'warn', icon: 'gear', title: T('geo.ev.productionStalled'), sound: 'ui_deny',
            text: T('geo.ev.productionStalled.' + (has('geo.ev.productionStalled.' + ev.reason) ? ev.reason : 'funds'), { item: prodName(ev.item) }), lines: [T('geo.ev.atBase', { base: b(ev) })],
            buttons: [baseBtn(ev.baseId, 'production'), ok],
          };
        case 'facilityDone':
          return {
            tone: 'good', icon: 'base', title: T('geo.ev.facilityDone'), sound: 'production_done',
            text: evs.length > 1 ? T('geo.ev.facilityDone.many') : T('geo.ev.facilityDone.body', { facility: T('facility.' + ev.type), base: b(ev) }),
            lines: evs.length > 1 ? evs.map((e) => T('geo.ev.facilityDone.line', { facility: T('facility.' + e.type), base: b(e) })) : [],
            buttons: [baseBtn(ev.baseId, 'facilities'), ok],
          };
        case 'deliveryArrived': {
          const line = (e) => {
            if (e.kind === 'item' || e.kind === 'craft') return T('geo.ev.delivery.' + e.kind, { n: e.n | 0, item: itemName(e.kind, e.itemId), base: b(e) });
            return Tn('geo.ev.delivery.' + e.kind, e.n | 0, { base: b(e) });
          };
          const tab = { soldier: 'soldiers', scientist: 'personnel', engineer: 'personnel', craft: 'crafts', item: 'stores' }[ev.kind] || 'stores';
          return {
            tone: 'good', icon: 'box', title: T('geo.ev.deliveryArrived'), sound: 'production_done',
            text: line(ev), lines: evs.slice(1).map(line), buttons: [baseBtn(ev.baseId, tab), ok],
          };
        }
        case 'terrorSite': {
          const s = C().findSite(G, ev.siteId);
          if (!s) return null;
          const ref = refOf('site', s.id);
          return {
            tone: 'terror', icon: 'skull', title: T('geo.ev.terrorSite'), sound: 'siren', focus: ref, kicker: T('geo.ev.terrorSite.kicker'),
            text: T('geo.ev.terrorSite.body', { city: cityName(s.cityId), race: has('race.' + s.race + '.plural') ? T('race.' + s.race + '.plural') : raceName(s.race) }), rows: siteRows(G, s),
            lines: [T('geo.ev.terrorSite.stakes'), terrorEtaLine(ref, s)],
            buttons: [sendBtn(ref, true), centreBtn(ref), ok],
          };
        }
        case 'terrorSiteExpired':
          return {
            tone: 'alert', icon: 'skull', title: T('geo.ev.terrorSiteExpired'), sound: 'ui_deny',
            text: T('geo.ev.terrorSiteExpired.body', { city: cityName(ev.cityId), points: fmtInt(ev.points | 0) }), buttons: [ok],
          };
        case 'alienBaseFound': {
          const a = C().findAlienBase(G, ev.alienBaseId);
          if (!a) return null;
          const ref = refOf('alienBase', a.id);
          return {
            tone: 'alert', icon: 'alien', title: T('geo.ev.alienBaseFound'), sound: 'ufo_detected', focus: ref,
            text: T('geo.ev.alienBaseFound.' + (has('geo.ev.alienBaseFound.' + ev.how) ? ev.how : 'agents'), { place: placeName(a.lon, a.lat) }),
            rows: alienBaseRows(G, a), lines: [T('geo.ev.alienBaseFound.stakes')], buttons: [sendBtn(ref, true), centreBtn(ref), ok],
          };
        }
        case 'baseSpotted': {
          // aviso de retaliação: há pelo menos um dia para preparar a defesa
          const base = C().findBase(G, ev.baseId);
          const eta = ev.etaS > 0 ? T('geo.approx', { t: fmtDur(ev.etaS / 3600) }) : '—';
          return {
            tone: 'terror', icon: 'base', title: T('geo.ev.baseSpotted'), sound: 'base_alarm', focus: base ? refOf('base', base.id) : null,
            text: T('geo.ev.baseSpotted.body', { base: baseName(base), eta }),
            lines: [T('geo.ev.baseSpotted.tips')], buttons: [baseBtn(ev.baseId, 'facilities'), ok],
          };
        }
        case 'baseAttack': {
          const base = C().findBase(G, ev.baseId);
          return {
            tone: 'terror', icon: 'base', title: T('geo.ev.baseAttack'), sound: 'siren', focus: base ? refOf('base', base.id) : null,
            text: T('geo.ev.baseAttack.body', { base: baseName(base) }), buttons: [ok],
          };
        }
        case 'baseDefence': {
          const shots = ev.shots || [];
          const hits = shots.filter((x) => x.hit).length;
          const lines = [];
          if (shots.length) lines.push(T('geo.ev.baseDefence.shots', { hits, n: shots.length }));
          if ((ev.soldiersLost || []).length) lines.push(Tn('geo.ev.baseDefence.casualties', ev.soldiersLost.length));
          if (ev.craftsLost) lines.push(Tn('geo.ev.baseDefence.craftsLost', ev.craftsLost));
          return {
            tone: ev.result === 'lost' ? 'terror' : 'good', icon: 'base', title: T('geo.ev.baseDefence'), sound: ev.result === 'lost' ? 'ui_deny' : 'ui_confirm',
            text: T('geo.ev.baseDefence.' + ev.result, { base: baseName(C().findBase(G, ev.baseId)) }), lines, buttons: [ok],
          };
        }
        case 'monthEnd': {
          const r = ev.report || {};
          const rows = [
            ['geo.mr.rating', (r.rating > 0 ? '+' : '') + fmtInt(r.rating | 0) + (r.ratingKey && has(r.ratingKey) ? ' · ' + T(r.ratingKey) : '')],
            ['geo.mr.income', fmtMoney(r.income | 0)],
            ['geo.mr.upkeep', fmtMoney(-((r.upkeep && r.upkeep.total) | 0))],
            ['geo.mr.funds', fmtMoney(r.fundsAfter | 0)],
          ];
          const lines = [];
          if (r.councilKey && has(r.councilKey)) lines.push(T(r.councilKey));
          for (const c of r.countries || []) if (c.newPact) lines.push(T('geo.toast.pactSigned', { country: countryName(c.id) || c.id }));
          if (r.debtWarning) lines.push(T('geo.mr.debt'));
          return { tone: 'info', icon: 'coin', title: T('geo.mr.title', { month: OV.U.MONTHS_LONG[r.m | 0] || '', y: r.y || '' }), text: '', rows, lines, buttons: [{ label: T('geo.btn.funding'), key: 'F', act: () => openFunding() }, ok] };
        }
        case 'gameOver':
        case 'victory': {
          const won = ev.t === 'victory';
          return {
            tone: won ? 'good' : 'terror', icon: won ? 'star' : 'alert', title: T(won ? 'geo.end.victory' : 'geo.end.gameOver'), sound: null, stinger: won ? 'victory' : 'defeat',
            text: T(won ? 'geo.end.victory.body' : 'geo.end.' + (has('geo.end.' + ev.reason) ? ev.reason : 'council')), noEsc: true,
            buttons: [{ label: T('geo.end.menu'), key: 'Enter', cls: 'primary', def: true, act: () => { OV.Game.G = null; OV.Game.B = null; OV.Scenes.set('menu'); } }],
          };
        }
        case 'intro':
          return {
            tone: 'info', icon: 'globe', title: T('geo.intro.title'), kicker: T('geo.intro.kicker'), noDate: true, text: T('geo.intro.body', { base: baseName(G.bases[0]) }),
            lines: [T('geo.intro.l1'), T('geo.intro.l2'), T('geo.intro.l3')],
            buttons: [{ label: T('geo.intro.go'), key: 'Enter', cls: 'primary', def: true, esc: true, act: () => {} }],
          };
        default:
          return null;
      }
    }
    // a equipa chega a tempo? (transporte mais rápido que pode partir agora vs. tempo que resta ao ataque)
    function terrorEtaLine(ref, site) {
      const rows = craftsFor(G, null, ref).filter((r) => r.ok && D().crafts[G.crafts[r.craftId].type].transport && r.eta);
      if (!rows.length) return T('geo.ev.terrorSite.noTeam');
      const r = rows[0];
      const left = Math.max(0, site.leftS) / 3600;
      return T(r.eta.h <= left ? 'geo.ev.terrorSite.eta' : 'geo.ev.terrorSite.late', { craft: craftName(G, G.crafts[r.craftId]), t: fmtDur(r.eta.h) });
    }
    function showPopup(it) {
      const spec = popupSpec(it);
      if (!spec) return false;
      const node = el('section', { class: 'geo-pop t-' + (spec.tone || 'info'), role: 'alertdialog', 'aria-label': spec.title });
      const actions = el('div', { class: 'geo-pop-a' });
      const pop = { it, spec, node, buttons: [] };
      for (const bspec of spec.buttons) {
        const b = btn(bspec.label, { cls: bspec.cls || (bspec.def && !spec.buttons.some((x) => x.cls === 'primary') ? 'primary' : ''), key: bspec.key === 'Enter' ? '↵' : bspec.key, sound: 'ui_click', onClick: () => closePopup(bspec) });
        b.disabled = !!bspec.disabled;
        actions.appendChild(b);
        pop.buttons.push({ spec: bspec, el: b });
      }
      const when = OV.U.fmtDate(G.t);
      const kick = spec.noDate ? spec.kicker : (spec.kicker || T('geo.pop.kicker.' + (spec.tone || 'info'))) + ' · ' + when;
      const nq = S.queue.filter((x) => x.kind === 'popup').length;
      node.append(...[
        el('div', { class: 'geo-pop-h' }, icon(spec.icon, 'big'), el('div', null, el('small', { text: kick }), el('h2', { text: spec.title }))),
        spec.text ? el('p', { class: 'geo-pop-t', text: spec.text }) : null,
        spec.rows && spec.rows.length ? kv(spec.rows) : null,
        ...(spec.lines || []).map((l) => el('p', { class: 'geo-pop-l', text: l })),
        actions,
        nq ? el('div', { class: 'geo-pop-q', text: Tn('geo.pop.more', nq) }) : null].filter(Boolean));
      S.popup = pop;
      S.els.layer.appendChild(node);
      if (spec.sound === 'siren') siren();
      else if (spec.sound) sfx(spec.sound);
      if (spec.stinger) stinger(spec.stinger);
      if (spec.focus) { centre(spec.focus, undefined, sideOffset(node)); highlight(spec.focus, 5000); }
      const def = pop.buttons.find((x) => x.spec.def && !x.el.disabled) || pop.buttons.find((x) => !x.el.disabled);
      if (def && OV.Input.lastPointerType !== 'touch') setTimeout(() => { if (def.el.isConnected) def.el.focus({ preventScroll: true }); }, 0);
      dirty();
      return true;
    }
    function closePopup(bspec) {
      const p = S.popup;
      if (!p) return;
      p.node.classList.add('out');
      const node = p.node;
      setTimeout(() => node.remove(), 140);
      S.popup = null;
      OV.Dom.hideTooltip();
      if (bspec && bspec.act) bspec.act();
      pump();
      dirty();
    }
    function popupKey(ev) {
      const p = S.popup;
      if (!p) return false;
      const k = ev.key;
      if (ev.repeat) return true;
      if (k === 'Escape') {
        if (p.spec.noEsc) return true;
        const e = p.buttons.find((x) => x.spec.esc) || p.buttons[p.buttons.length - 1];
        if (e) { sfx('ui_click'); closePopup(e.spec); }
        return true;
      }
      if (k === 'Enter') {
        const d = p.buttons.find((x) => x.spec.def && !x.el.disabled) || p.buttons.find((x) => !x.el.disabled);
        if (d) { sfx('ui_click'); closePopup(d.spec); }
        return true;
      }
      const hit = p.buttons.find((x) => x.spec.key && x.spec.key.length === 1 && x.spec.key.toLowerCase() === k.toLowerCase() && !x.el.disabled);
      if (hit) { sfx('ui_click'); closePopup(hit.spec); return true; }
      return CAMERA_KEYS[k] ? false : true;
    }
    function siren() {
      sfx('ufo_detected');
      setTimeout(() => sfx('reaction_alert'), 420);
      setTimeout(() => sfx('ufo_detected'), 900);
    }

    // ---- interceção automática (sem OV.DogfightUI) ----------------------------------------------------------------------
    function fallbackDogfight() {
      const ids = G.dogfights.map((d) => d.id);
      if (!ids.length) return;
      const node = el('section', { class: 'geo-pop t-alert geo-df', role: 'alertdialog', 'aria-label': T('geo.df.title') });
      const rows = el('div', { class: 'geo-df-rows' });
      const status = el('p', { class: 'geo-pop-t' });
      const closeB = btn(T('common.ok'), { cls: 'primary', key: '↵', onClick: () => endFallbackDf() });
      closeB.disabled = true;
      node.append(el('div', { class: 'geo-pop-h' }, icon('craft', 'big'), el('div', null, el('small', { text: T('geo.pop.kicker.alert') }), el('h2', { text: T('geo.df.title') }))), status, rows, el('div', { class: 'geo-pop-a' }, closeB));
      S.els.layer.appendChild(node);
      for (const id of ids) {
        try { if (OV.Dogfight.setMode) OV.Dogfight.setMode(G, id, 'standard'); } catch (e) { /* modo opcional */ }
      }
      S.fallbackDf = { ids, node, rows, status, closeB, acc: 0, done: false, evs: [], track: {} };
      sfx('dogfight_cannon');
      dirty();
    }
    function thinkFallbackDf(dt) {
      const F = S.fallbackDf;
      if (!F || F.done) return;
      F.acc += dt;
      const tickMs = (D().dogfight && D().dogfight.tickMs) || 30;
      let n = Math.min(8, Math.floor(F.acc / tickMs));
      F.acc -= n * tickMs;
      while (n-- > 0) {
        for (const id of F.ids) {
          const d = C().findDogfight(G, id);
          if (!d) continue;
          F.track[id] = { craftId: d.craftId, ufoId: d.ufoId };
          const n0 = G.events.length;
          for (const e of OV.Dogfight.tick(G, id)) {
            if (e.t === 'df.hit') sfx('dogfight_hit');
            else if (e.t === 'df.fire' && e.from === 'craft') sfx('dogfight_missile');
          }
          if (G.events.length > n0) F.evs.push(...G.events.splice(n0));
        }
      }
      OV.Dom.clear(F.rows);
      let live = 0;
      for (const id of F.ids) {
        const d = C().findDogfight(G, id);
        const tr = F.track[id] || {};
        const c = G.crafts[tr.craftId], u = C().findUfo(G, tr.ufoId);
        if (d) live++;
        const def = c && D().crafts[c.type];
        const udef = u && D().ufos[u.type];
        F.rows.appendChild(kv([
          ['geo.df.craft', craftName(G, c), def ? { bar: pct(c.hp, def.hp), tone: 'hull' } : null],
          ['geo.df.ufo', u ? ufoName(u) : T('geo.ufo.label', { n: numOf(tr.ufoId) }), udef ? { bar: pct(u.dmg, udef.hp), tone: 'bad' } : null],
          ['geo.df.dist', d ? fmtInt(d.dist) : '—'],
        ]));
      }
      if (!live) {
        F.done = true;
        F.status.textContent = T('geo.df.over');
        F.closeB.disabled = false;
        F.closeB.focus({ preventScroll: true });
        if (F.evs.some((e) => e.t === 'ufoCrashed' || e.t === 'ufoDestroyed')) sfx('ufo_crash');
      } else F.status.textContent = T('geo.df.running');
    }
    function endFallbackDf() {
      const F = S.fallbackDf;
      if (!F || !F.done) return;
      F.node.remove();
      S.fallbackDf = null;
      handle(F.evs.filter((e) => e.t !== 'dogfightEnd'));
      pump();
    }

    // ---- missão em terra -------------------------------------------------------------------------------------------------
    function launchMission(siteRef, craftId) {
      if (!siteRef || !G.crafts[craftId]) return;
      if (fn('CampaignUI', 'launchMission')) { OV.CampaignUI.launchMission(G, siteRef, craftId); return; }
      // sem a interface da campanha: batalha direta com o fecho da campanha no fim
      let mission;
      try {
        mission = C().startMission(G, siteRef, craftId, { settings: { instantGrenades: !!(OV.Game.settings && OV.Game.settings.instantGrenades) } });
      } catch (e) {
        const r = String(e && e.message || '').replace('campaign.err.', '');
        sfx('ui_deny');
        OV.Dom.toast(has('geo.err.mission.' + r) ? T('geo.err.mission.' + r) : T('geo.err.mission.generic'), null, 'warn');
        return;
      }
      let B;
      try { B = OV.Battle.create(mission); } catch (e) {
        if (C().cancelMission) C().cancelMission(G);
        OV.Dom.toast(T('geo.err.mission.generic'), null, 'warn');
        return;
      }
      OV.Game.B = B;
      const meta = mission.meta || {};
      let fired = false;
      OV.Scenes.push('battlescape', {
        B, mission, meta, G, onExit: () => {
          if (fired) return;
          fired = true;
          const model2 = C().finishMission(G, B);
          OV.Game.B = null;
          const p = {
            B, debrief: model2.debrief, mission, meta, progression: model2.progression, stingerPlayed: true,
            onDone: () => {
              if (model2.outcome === 'victory' || model2.outcome === 'gameOver') {
                const won = model2.outcome === 'victory';
                if (won && fn('CampaignUI', 'victory')) return OV.CampaignUI.victory(G);
                if (!won && fn('CampaignUI', 'gameOver')) return OV.CampaignUI.gameOver(G, G.flags.lostReason);
              }
              open(G);
            },
          };
          const top = OV.Scenes.top();
          if (top && top.id === 'battlescape') OV.Scenes.replace('debrief', p);
          else OV.Scenes.push('debrief', p);
        },
      });
    }

    // ---------------------------------------------------------------------------------------------------------------
    // tempo
    // ---------------------------------------------------------------------------------------------------------------
    function blocked() {
      return !!(S.popup || S.dlg || S.fallbackDf || S.target || S.queue.length || S.waiting || !isTop() || (OV.Dom.anyModalOpen && OV.Dom.anyModalOpen()));
    }
    function setSpeed(i) {
      clk.speed = Math.max(0, Math.min(SPEED_N - 1, i | 0));
      clk.paused = false;
      ui.speed = clk.speed;
      if (clk.speed > 0) ui.sped = true;
      hideNudge();
      refreshTime();
      refreshAux();
    }
    function togglePause() {
      clk.paused = !clk.paused;
      clk.acc = 0;
      sfx(clk.paused ? 'ui_deny' : 'ui_confirm');
      refreshTime();
    }
    function onStopped(reason) {
      if (reason === 'dogfight' && !S.queue.some((x) => x.type === 'dogfightStart') && !(fn('DogfightUI', 'isOpen') && OV.DogfightUI.isOpen())) {
        S.queue.unshift({ kind: 'scene', type: 'dogfightStart', open: () => openDogfights() });
      }
      if (reason === 'ended' && !S.endShown) endFlow(null);
      if (reason === 'battle') {
        if (!S.blockedBattle) {
          S.blockedBattle = true;
          showBanner(T('geo.battle.title'), T('geo.battle.text'), 'warn', C().cancelMission ? [{ label: T('geo.battle.cancel'), act: () => { C().cancelMission(G); S.blockedBattle = false; hideBanner(); } }] : []);
        }
      } else if (S.blockedBattle && !G.activeMission) { S.blockedBattle = false; hideBanner(); }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // câmara e entrada
    // ---------------------------------------------------------------------------------------------------------------
    const CAMERA_KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, '+': 1, '=': 1, '-': 1, _: 1 };
    function setCursor(c) {
      if (OV.View.canvas) OV.View.canvas.style.cursor = c;
    }
    function zoomStep(d) {
      const z = Math.max(0, Math.min(SPEED_N - 1, Math.round(view.zoom) + d));
      OV.GlobeRender.zoomTo(view, z, reduceMotion() ? 1 : 280);
      dirty();
    }
    function hintGone() {
      if (S.hintGone || !S.els.hint) return;
      S.hintGone = true;
      S.els.hint.classList.add('fade');
    }
    function keyRotate(dt) {
      const k = OV.Input.keysDown;
      if (!k || !k.size || !isTop() || S.popup) return;
      let dx = 0, dy = 0;
      if (k.has('ArrowLeft')) dx += 1;
      if (k.has('ArrowRight')) dx -= 1;
      if (k.has('ArrowUp')) dy += 1;
      if (k.has('ArrowDown')) dy -= 1;
      if (!dx && !dy) return;
      const v = 0.42 * view.h * (dt / 1000);
      OV.GlobeRender.rotateBy(view, dx * v, dy * v);
      dirty();
    }
    function onInput(ev) {
      if (!G) return false;
      if (ev.pointerType) view.touch = ev.pointerType === 'touch';
      switch (ev.kind) {
        case 'key': return onKey(ev);
        case 'hover': {
          view.cursor = OV.GlobeRender.pick(view, ev.x, ev.y);
          const hit = OV.GlobeRender.objectAt(G, view, ev.x, ev.y);
          const prev = view.hover;
          view.hover = hit;
          if (S.target) targetHover(ev.x, ev.y);
          else setCursor(hit ? 'pointer' : 'grab');
          if (S.target || (prev ? !hit || prev.kind !== hit.kind || prev.id !== hit.id : !!hit)) dirty();
          return true;
        }
        case 'leave':
          view.hover = null;
          view.cursor = null;
          dirty();
          return true;
        case 'down':
          OV.GlobeRender.stop(view);
          return true;
        case 'dragstart':
          S.drag = { samples: [] };
          hintGone();
          setCursor(S.target ? 'crosshair' : 'grabbing');
          return true;
        case 'drag': {
          OV.GlobeRender.rotateBy(view, ev.dx, ev.dy);
          if (S.drag) {
            const t = nowMs();
            S.drag.samples.push({ t, dx: ev.dx, dy: ev.dy });
            while (S.drag.samples.length && t - S.drag.samples[0].t > 90) S.drag.samples.shift();
          }
          dirty();
          return true;
        }
        case 'dragend': {
          const sm = S.drag ? S.drag.samples : [];
          S.drag = null;
          setCursor(S.target ? 'crosshair' : 'grab');
          if (sm.length >= 2 && nowMs() - sm[sm.length - 1].t < 60 && !reduceMotion()) {
            const span = Math.max(8, sm[sm.length - 1].t - sm[0].t);
            const vx = sm.reduce((s, x) => s + x.dx, 0) / span, vy = sm.reduce((s, x) => s + x.dy, 0) / span;
            OV.GlobeRender.fling(view, vx, vy);
          }
          dirty();
          return true;
        }
        case 'pan':
          OV.GlobeRender.rotateBy(view, -ev.cx, -ev.cy);
          hintGone();
          dirty();
          return true;
        case 'zoom': {
          const z = Math.max(0, Math.min(SPEED_N - 1, view.zoom + Math.log(ev.factor) / ZSTEP));
          OV.GlobeRender.zoomAt(view, z, ev.x, ev.y);
          hintGone();
          dirty();
          return true;
        }
        case 'wheelnotch': {
          const z = Math.max(0, Math.min(SPEED_N - 1, Math.round(view.zoom) + ev.delta));
          OV.GlobeRender.zoomTo(view, z, 220, ev.x, ev.y);
          dirty();
          return true;
        }
        case 'click': {
          if (S.target) { targetClick(ev.x, ev.y); return true; }
          if (S.popup || S.fallbackDf) return true;
          if (ev.mods && ev.mods.alt) {
            const p = OV.GlobeRender.pick(view, ev.x, ev.y);
            if (p) centre(p);
            return true;
          }
          const hits = OV.GlobeRender.objectsAt(G, view, ev.x, ev.y);
          if (!hits.length) { if (view.selection) select(null); return true; }
          let pickI = 0;
          const s = view.selection;
          if (s) {
            const i = hits.findIndex((h) => h.kind === s.kind && h.id === s.id);
            if (i >= 0) pickI = (i + 1) % hits.length;
          }
          select({ kind: hits[pickI].kind, id: hits[pickI].id });
          return true;
        }
        case 'dblclick': {
          if (S.target) return true;
          const p = OV.GlobeRender.pick(view, ev.x, ev.y);
          if (p) centre(p, Math.min(SPEED_N - 1, Math.max(view.zoom, Math.round(view.zoom) + (view.zoom < 2 ? 1 : 0))));
          return true;
        }
        case 'secondary': {
          if (S.target) { sfx('ui_click'); endTargetMode(true); return true; }
          const p = OV.GlobeRender.pick(view, ev.x, ev.y);
          if (p) centre(p);
          return true;
        }
        default:
          return false;
      }
    }
    function onKey(ev) {
      const k = ev.key;
      if (ev.mods && (ev.mods.meta || ev.mods.ctrl)) return false;
      // um botão com foco trata Enter/Espaço sozinho
      const a = document.activeElement;
      if ((k === 'Enter' || k === ' ') && a && a.tagName === 'BUTTON' && S.root && S.root.contains(a)) return false;
      // ↑/↓ escolhem a linha de um diálogo (naves, alvos, bases), como no diálogo de gravações
      if (S.dlg && S.dlg.node && !S.target && !S.popup && (k === 'ArrowDown' || k === 'ArrowUp')) {
        const rows = [...S.dlg.node.querySelectorAll('.geo-row:not(:disabled)')];
        if (rows.length) {
          const i = rows.indexOf(a);
          const n = i < 0 ? rows[k === 'ArrowDown' ? 0 : rows.length - 1] : rows[(i + (k === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
          n.focus({ preventScroll: true });
          n.scrollIntoView({ block: 'nearest' });
          sfx('ui_select');
          return true;
        }
      }
      if (CAMERA_KEYS[k]) {
        if (k === '+' || k === '=') { if (!ev.repeat) zoomStep(1); }
        else if (k === '-' || k === '_') { if (!ev.repeat) zoomStep(-1); }
        hintGone();
        return true;
      }
      if (S.fallbackDf) {
        if ((k === 'Enter' || k === 'Escape') && S.fallbackDf.done) endFallbackDf();
        return true;
      }
      if (S.popup) return popupKey(ev);
      if (S.target) {
        if (k === 'Escape') { sfx('ui_click'); endTargetMode(true); }
        return true;
      }
      if (S.dlg) {
        if (k === 'Escape' || (S.dlg.kind === 'funding' && (k === 'f' || k === 'F'))) { sfx('ui_click'); closeDlg(); return true; }
        if (S.dlg.kind === 'intercept' && (k === 'g' || k === 'G') && S.dlg.st.step === 'target') { startTargetMode(S.dlg.st.craftId); return true; }
        return false;
      }
      if (ev.repeat && !/^[1-6]$/.test(k)) return true;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      if (/^[1-6]$/.test(k)) { if (!ev.repeat) { sfx('ui_click'); setSpeed(+k - 1); } return true; }
      switch (lower) {
        case ' ':
        case 'p':
          togglePause();
          return true;
        case 'i': sfx('ui_click'); openIntercept(view.selection && view.selection.kind === 'ufo' ? { target: view.selection } : {}); return true;
        case 'b': sfx('ui_click'); openBases(); return true;
        case 'u': sfx('ui_click'); openUfopaedia(); return true;
        case 'f': sfx('ui_click'); openFunding(); return true;
        case 's': saveGame(); return true;
        case 'c': if (view.selection) { centre(view.selection); return true; } centre({ kind: 'base', id: G.bases[0] && G.bases[0].id }); return true;
        case 'h': centre({ kind: 'base', id: (selBase() || G.bases[0] || {}).id }); return true;
        case 'r':
          toggleRadar();
          return true;
        case 'Tab': cycleTargets(ev.mods && ev.mods.shift ? -1 : 1); return true;
        case 'Escape': sfx('ui_click'); openOptions(); return true;
        default:
          return cardKey(k);
      }
    }
    function toggleRadar() {
      view.showRadar = !view.showRadar;
      ui.radar = view.showRadar;
      sfx('ui_click');
      refreshTime();
      dirty();
    }
    function cycleTargets(dir) {
      const refs = G.ufos.filter((u) => ufoVisible(G, u)).map((u) => refOf('ufo', u.id))
        .concat(G.sites.map((s) => refOf('site', s.id)), G.alienBases.filter((a) => a.discovered).map((a) => refOf('alienBase', a.id)),
          Object.keys(G.crafts).filter((id) => isAir(G.crafts[id])).map((id) => refOf('craft', id)));
      if (!refs.length) { sfx('ui_deny'); return; }
      const s = view.selection;
      let i = s ? refs.findIndex((r) => r.kind === s.kind && r.id === s.id) : -1;
      i = (i + dir + refs.length) % refs.length;
      select(refs[i]);
      centre(refs[i]);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // ciclo da cena
    // ---------------------------------------------------------------------------------------------------------------
    function syncView() {
      const V = OV.View;
      if (view.w !== V.w || view.h !== V.h || view.dpr !== V.dpr) {
        view.w = V.w; view.h = V.h; view.dpr = V.dpr;
        measure();
      }
      view.cx = (V.w - S.sideW) / 2;
      view.cy = V.w < 760 ? V.h * 0.42 : V.h / 2;
      const t = nowMs();
      const hl = [];
      for (const [k, x] of S.hl) {
        if (x.until < t || !selValid(x.ref)) S.hl.delete(k);
        else hl.push(x.ref);
      }
      view.highlights = hl;
    }
    function animatedMarkers() {
      if (view.selection || view.highlights.length || view.mode === 'target' || G.sites.length) return true;
      for (const u of G.ufos) if (ufoVisible(G, u) && u.status !== 'crashed') return true;
      return false;
    }
    function updateMood() {
      const mood = G.sites.length ? 'terror' : 'geoscape';
      if (mood !== S.mood) { S.mood = mood; music(mood); }
    }

    function think(dt) {
      if (!G || S.hidden) return;
      view.time = nowMs();
      keyRotate(dt);
      if (S.fallbackDf) thinkFallbackDf(dt);
      if (S.autosave && !G.dogfights.length && !S.fallbackDf) doAutosave();
      if (!blocked()) {
        const r = runClock(G, clk, dt, handle);
        if (r.ticks) S.timeDirty = true;
        if (r.stopped) onStopped(r.reason);
        if (r.stopped || r.ticks) ui.speed = clk.speed;
      } else clk.acc = 0;
      // a janela seguinte (relatório mensal, interceção) abre antes dos toasts do mesmo lote: nada fica por cima dela
      pump();
      if (isTop()) flushToasts();
      const t = nowMs();
      if (t - S.lastRefresh > 220) {
        S.lastRefresh = t;
        if (view.selection && !selValid(view.selection)) select(null);
        if (S.blockedBattle && !G.activeMission) { S.blockedBattle = false; hideBanner(); }
        refreshTime();
        refreshLists();
        renderCard();
        refreshAux();
        idleReminder();
        if (S.nudgeT && t - S.nudgeT > 16000) { S.nudgeT = 0; hideNudge(); }
        updateMood();
        if (S.dlg && S.dlg.kind === 'intercept' && !S.target && t - (S.dlg.t || 0) > 600) {
          S.dlg.t = t;
          const sig = interceptSig(S.dlg.st);
          if (sig !== S.dlg.sig) renderIntercept();
        }
        ui.lon = view.lon; ui.lat = view.lat; ui.zoom = Math.round(view.zoom * 100) / 100;
      }
    }
    function draw(ctx, V) {
      if (!G) return;
      syncView();
      const t = nowMs();
      const running = !clk.paused && !blocked();
      const busy = OV.GlobeRender.busy(view) || !!S.drag;
      let interval = 1000;
      if (S.dirty || busy) interval = 0;
      else if (S.timeDirty && running) interval = 100;
      else if (animatedMarkers()) interval = 33;
      else if (S.timeDirty) interval = 100;
      if (t - S.lastDraw < interval) return;
      S.lastDraw = t;
      S.dirty = false;
      S.timeDirty = false;
      view.time = t;
      const r = OV.GlobeRender.draw(V.ctx || ctx, G, view);
      S.perf = r;
      S.draws = (S.draws | 0) + 1;
      if (OV.GlobeRender.busy(view)) S.dirty = true;
    }

    const sc = {
      id: 'geoscape',
      isScreen: true,
      enter() {
        cur = ctl;
        OV.Game.G = G;
        if (OV.GlobeRender.prewarm) OV.GlobeRender.prewarm();
        build();
        syncView();
        setCursor('grab');
        S.mood = null;
        updateMood();
        // eventos deixados por outras cenas (fim de batalha, base, interceção)
        if (Array.isArray(G.events) && G.events.length) handle(G.events.splice(0));
        if (G.t === 0 && !G.ui.geoIntro) { G.ui.geoIntro = true; S.queue.unshift({ kind: 'popup', type: 'intro', evs: [{ t: 'intro' }] }); }
        if (!Number.isFinite(ui.sci0)) ui.sci0 = G.bases.reduce((n, b) => n + (b.scientists | 0), 0);
        if (G.flags.won || G.flags.lost) endFlow(null);
        dirty();
      },
      exit() {
        if (cur === ctl) cur = null;
        document.documentElement.style.removeProperty('--geo-side');
        ui.lon = view.lon; ui.lat = view.lat; ui.zoom = view.zoom; ui.speed = clk.speed;
        setCursor('');
        OV.Dom.hideTooltip();
        flushToasts(true);
        if (S.root) S.root.remove();
        S.root = null;
      },
      pause() {
        OV.Dom.hideTooltip();
        // com outra cena por cima (interceção, relatório, gravações) o painel fica visível mas não responde
        if (S.root) S.root.inert = true;
        // só esconde o painel se a cena de cima ocupar o ecrã (base, Ufopédia, briefing…)
        Promise.resolve().then(() => {
          const top = OV.Scenes.top();
          if (top && top !== sc && top.isScreen && S.root) { S.root.classList.add('geo-off'); S.hidden = true; }
          if (top && top.id === 'dogfight' && S.root) dfBanner(true);
          if (S.root) refreshTime(true);
        });
        setCursor('');
      },
      resume() {
        S.hidden = false;
        S.waiting = false;
        if (S.root) { S.root.classList.remove('geo-off'); S.root.inert = false; }
        dfBanner(false);
        setCursor(S.target ? 'crosshair' : 'grab');
        S.mood = null;
        updateMood();
        if (Array.isArray(G.events) && G.events.length) handle(G.events.splice(0));
        S.sigs = {};
        refreshTime(true);
        refreshLists(true);
        renderCard(true);
        dirty();
        pump();
      },
      think,
      draw,
      onInput,
      // a interceção por cima chama isto: o painel mostra combustível, casco e listas atuais sem avançar o tempo
      peek() {
        if (!S.root || S.hidden) return;
        refreshTime();
        refreshLists();
        renderCard();
      },
      onResize() { measure(); dirty(); },
      onHidden() { /* rAF pára sozinho; nada a fazer */ },
    };
    const ctl = {
      G, view, clk, S, scene: sc,
      centre, select, openIntercept, setSpeed, togglePause, handle,
      state: () => ({
        t: G.t, funds: G.funds, view: { lon: view.lon, lat: view.lat, zoom: view.zoom, mode: view.mode, selection: view.selection },
        speed: clk.speed, paused: clk.paused, popup: S.popup ? S.popup.it.type : null, dialog: S.dlg ? S.dlg.kind : null,
        mode: view.mode, draws: S.draws | 0, blocked: blocked(), modal: !!(OV.Dom.anyModalOpen && OV.Dom.anyModalOpen()), queue: S.queue.map((x) => x.type), waiting: S.waiting, fallbackDf: !!S.fallbackDf, perf: S.perf || null,
      }),
    };
    return sc;
  }

  // =================================================================================================================
  // API pública
  // =================================================================================================================
  function open(G) {
    if (!G) return null;
    if (OV.Game) OV.Game.G = G;
    return OV.Scenes.set('geoscape', { G });
  }
  function centreOn(G, where, zoom) {
    if (cur && cur.G === G) { cur.centre(where, zoom); return true; }
    let p = where;
    if (where && where.kind && where.kind !== 'point') { const tg = OV.Campaign.targetOf(G, where); p = tg ? { lon: tg.lon, lat: tg.lat } : null; }
    if (!p || !Number.isFinite(p.lon)) return false;
    G.ui.geo = Object.assign({}, G.ui.geo || {}, { lon: p.lon, lat: p.lat });
    if (Number.isFinite(zoom)) G.ui.geo.zoom = zoom;
    return true;
  }
  function intercept(G, ufoId) {
    if (!cur || cur.G !== G) return false;
    cur.openIntercept(ufoId ? { target: { kind: 'ufo', id: ufoId } } : {});
    return true;
  }

  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.geoscape = function (params) {
    const p = params || {};
    if (!p.G) throw new Error('geoscape: falta G');
    return makeScene(p);
  };
  OV.GeoUI = {
    open, centreOn, intercept,
    current: () => (cur ? cur.state() : null),
    setSpeed: (i) => { if (cur) cur.setSpeed(i); },
    togglePause: () => { if (cur) cur.togglePause(); },
    select: (ref) => { if (cur) cur.select(ref); },
    model,
  };
})(globalThis.OV || (globalThis.OV = {}));
