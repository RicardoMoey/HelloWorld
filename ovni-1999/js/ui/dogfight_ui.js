/* Interceção (dogfight) — janela sobreposta ao Geoscape (DESIGN.md §3.13, §12; CAMPAIGN_API.md §5.5, §6.1, §6.4).
   Cena OV.SceneDefs.dogfight {G, dogfightIds:[id], opts?} com isScreen:false: até MAX_DOGFIGHTS painéis; um está
   aberto (foco), os outros ficam como fichas minimizadas no canto. A simulação avança com OV.Dogfight.tick a cada
   Data.dogfight.tickMs de tempo real (no máximo 8 ticks por fotograma), independente da velocidade do globo; pára
   com P/Espaço, com um modal aberto ou com outra cena por cima. A interface só muda G através da API OV.Dogfight.

   API:
   OV.DogfightUI = {
     open(G, dogfightId?, opts?) → bool   empilha a cena 'dogfight' ou junta um painel à que já existe; sem id adota
                                          todos os G.dogfights ainda sem painel. opts (da 1.ª chamada, ou por painel):
                                            onEnd(summary)            ao fechar cada painel (resumo abaixo)
                                            onEvents(events, summary) eventos de campanha criados por finish (ufoCrashed,
                                                                      ufoDestroyed, ufoEscaped, craftLost, dogfightEnd…);
                                                                      sem este gancho voltam para G.events, pela ordem,
                                                                      e o próximo escoamento do Geoscape mostra-os
                                            onClose(summaries)        quando o último painel fecha (a cena sai)
     close(dogfightId?)                   fecha já um painel (todos sem id); um combate ainda a decorrer termina por
                                          OV.Dogfight.finish (resultado 'disengaged')
     minimise(dogfightId?) ; restore(dogfightId?) ; toggle(dogfightId?)   (sem id: o painel em foco / o mais recente)
     active() → [{dogfightId, craftId, ufoId, minimised, over, outcome}] ; isOpen(dogfightId?) → bool
     isPaused() → bool ; setPaused(bool, quiet?) (quiet: sem aviso «Pausa» nem som)
     model: funções puras (sem DOM) usadas pela interface e pelos testes
   }
   summary = {dogfightId, craftId, ufoId, craftType, ufoType, outcome, seaCrash, titleKey, tone, subs:[{key, params}],
              shots, hits, dealt, taken, ufoShots, ufoHits, ticks, seconds, craftHp, craftMaxHp, ufoDmgPct, events}
   Ao sair, a cena faz OV.Scenes.pop({dogfight: summaries}) — a cena de baixo recebe-o em resume(result).
   Com tudo minimizado, os gestos de câmara (arrastar, pinça, roda, setas, +/−) passam para a cena de baixo.
   Abre na última postura de ataque do jogador (G.ui.dfMode) ou em Normal; uma dica das posturas aparece no primeiro
   combate da campanha (G.ui.dfHintSeen). Com tudo minimizado, Esc reabre e o Geoscape por baixo é atualizado (peek).
   Teclas: 1–5 posturas, Q/E ligar/desligar arma 1/2, M ou Esc minimizar, Tab outra interceção, P/Espaço pausa,
   Enter fecha o resultado. Sons: OV.audio (ambiente «interception» e efeito «dogfight_engine» se existirem). */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  // iPad: os textos que citam teclas (2–5, Q/E) têm uma variante «.touch» sem elas
  const touchNow = () => !!(OV.Input && OV.Input.lastPointerType === 'touch') || (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches);
  const TT = (k, p) => (touchNow() && OV.T.has(k + '.touch') ? T(k + '.touch', p) : T(k, p));
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const DFS = () => OV.Dogfight;
  const TAU = Math.PI * 2;
  const MAX_TICKS = 8; // ticks por fotograma (§6.4)
  const OUTCOME_MS = 2400; // resultado visível antes de fechar sozinho
  const RETREAT_SHOW_TICKS = 110; // aviso do recuo automático (~3 s)
  const HINT_MS = 12000; // dica das posturas (uma vez por campanha) visível durante o combate
  const PEEK_MS = 250; // o Geoscape por baixo atualiza o painel a este ritmo (sem avançar o tempo)
  const GEO_KEYS = /^[1-6bufsicrhBUFSICRH]$/;
  const SLOT_KEYS = ['Q', 'E'];
  const MODE_KEYS = ['1', '2', '3', '4', '5'];
  const CAMERA_KINDS = { hover: 1, leave: 1, pan: 1, zoom: 1, wheelnotch: 1, dragstart: 1, drag: 1, dragend: 1, down: 1, dblclick: 1 };
  const CAMERA_KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, '+': 1, '-': 1, '=': 1, _: 1 };

  const hasAmmo = (w) => !!w && (w.ammo === null || w.ammo > 0);

  // =================================================================================================================
  // Modelo puro (sem DOM; testado em Node)
  // =================================================================================================================

  // acumulador de tempo real → ticks deste fotograma (no máximo max; o excesso descarta-se)
  function ticksFor(acc, dt, tickMs, max) {
    let a = acc + Math.max(0, dt);
    let n = Math.floor(a / tickMs);
    if (n > max) {
      n = max;
      a = a % tickMs;
    } else a -= n * tickMs;
    return { n, acc: a };
  }

  function craftLabel(G, craft) {
    if (!craft) return '';
    if (craft.name) return craft.name;
    const def = D().crafts[craft.type];
    return T('craft.instance', { type: T(def ? def.nameKey : craft.type), n: craft.num });
  }
  function ufoLabel(G, ufo) {
    if (!ufo) return '';
    const def = D().ufos[ufo.type];
    const n = String(ufo.id).replace(/^\D+/, '');
    // a mesma regra do Geoscape (typeKnown: hiperonda, tipo já visto ou OVNI identificado no briefing/aterrado):
    // identificado → «Batedor Grande (médio)»; senão só o eco do radar
    const gm = OV.GeoUI && OV.GeoUI.model;
    const known = gm && gm.typeKnown ? gm.typeKnown(G, ufo) : !!(ufo.hyper || (G.seen && G.seen.ufoTypes && G.seen.ufoTypes.indexOf(ufo.type) >= 0));
    const what = known ? T('df.ufoKnown', { type: T(def.nameKey), size: T(def.sizeKey).toLowerCase() }) : T(def.sizeKey);
    return T('df.ufoLabel', { n }) + ' · ' + what;
  }

  function newTrack(G, d) {
    const craft = C().findCraft(G, d.craftId);
    const ufo = C().findUfo(G, d.ufoId);
    const cdef = craft ? D().crafts[craft.type] : null;
    const udef = ufo ? D().ufos[ufo.type] : null;
    const DF = D().dogfight;
    const uw = udef ? udef.weapon : null;
    let phase = 'day', sea = false;
    if (ufo && OV.GMath) {
      try { phase = OV.GMath.dayPhase(G, ufo.lon, ufo.lat) || 'day'; } catch (e) { phase = 'day'; }
      try { sea = !OV.GMath.isLand(ufo.lon, ufo.lat); } catch (e) { sea = false; }
    }
    // ours: nave de assalto da retaliação a caminho de uma base; scramble = nave dessa base que descolou para a defender
    const assault = !!(ufo && ufo.targetBaseId);
    return {
      id: d.id, craftId: d.craftId, ufoId: d.ufoId, assault, scramble: assault && !!craft && craft.baseId === ufo.targetBaseId,
      ufoSize: udef ? udef.size | 0 : 0,
      craftType: craft ? craft.type : null, ufoType: ufo ? ufo.type : null,
      craftLabel: craftLabel(G, craft), ufoLabel: ufoLabel(G, ufo),
      craftMaxHp: cdef ? cdef.hp : 1, craftHp: craft ? craft.hp : 0, craftHp0: craft ? craft.hp : 0,
      ufoHp: udef ? udef.hp : 1, ufoDmg: ufo ? ufo.dmg : 0, ufoDmg0: ufo ? ufo.dmg : 0,
      ufoRange: uw && uw.power > 0 && uw.range > 0 ? uw.range * DF.rangeMul : 0,
      alt: ufo ? ufo.alt | 0 : 2, phase, sea,
      weapons: craft ? craft.weapons.map((w, slot) => (w ? {
        slot, type: w.type, ammo: w.ammo, ammo0: w.ammo, hit: udef ? D().dogfightHitChance(D().craftWeapons[w.type].acc, udef.size) : 0,
      } : null)) : [],
      shots: 0, hits: 0, misses: 0, dealt: 0, taken: 0, ufoShots: 0, ufoHits: 0, ticks: 0,
      reloadMax: {}, retreatTick: -1e9, breakOffTick: -1e9,
      outcome: null, seaCrash: false, events: [],
    };
  }

  // eventos de tick (OV.Dogfight.tick) → contadores do resumo; lê o estado já atualizado
  function absorb(track, G, d, evs) {
    for (const e of evs) {
      switch (e.t) {
        case 'df.fire':
          if (e.from === 'craft') {
            track.shots++;
            const ws = d.weapons.find((x) => x.slot === e.slot);
            if (ws && ws.reload > 0) track.reloadMax[e.slot] = ws.reload;
          } else track.ufoShots++;
          break;
        case 'df.hit':
          if (e.target === 'ufo') { track.hits++; track.dealt += e.dmg | 0; } else { track.ufoHits++; track.taken += e.dmg | 0; }
          break;
        case 'df.miss':
          if (e.from === 'craft') track.misses++;
          break;
        case 'df.retreat': track.retreatTick = d.ticks; break;
        case 'df.breakOff': track.breakOffTick = d.ticks; break;
        case 'df.end': track.outcome = e.outcome; break;
        default: break;
      }
    }
    track.ticks = d.ticks;
    const craft = C().findCraft(G, track.craftId);
    if (craft) {
      track.craftHp = craft.hp;
      for (const w of track.weapons) if (w && craft.weapons[w.slot]) w.ammo = craft.weapons[w.slot].ammo;
    } else if (track.outcome === 'craftDestroyed') track.craftHp = 0;
    const ufo = C().findUfo(G, track.ufoId);
    if (ufo) track.ufoDmg = ufo.dmg;
    else if (track.outcome === 'destroyed') track.ufoDmg = Math.max(track.ufoDmg, track.ufoHp);
    return track;
  }
  // eventos de campanha criados no mesmo tick (finish): guardados para entregar ao Geoscape
  function absorbGeo(track, evs) {
    for (const e of evs) {
      track.events.push(e);
      if (e.t === 'ufoDestroyed' && e.ufoId === track.ufoId && track.outcome === 'crashed') track.seaCrash = true;
    }
    return track;
  }

  // estado textual do combate: {key, params, tone, warn:{key, tone}|null}
  function status(G, d, track) {
    if (track.outcome) return { key: 'df.end.' + track.outcome, params: null, tone: outcomeTone(track), warn: null };
    const craft = C().findCraft(G, d.craftId);
    const ufo = C().findUfo(G, d.ufoId);
    if (!craft || !ufo) return { key: 'df.st.disengage', params: null, tone: 'info', warn: null };
    const DF = D().dogfight;
    const mode = T('df.mode.' + d.mode);
    let warn = null;
    if (d.ticks - track.retreatTick < RETREAT_SHOW_TICKS) warn = { key: 'df.st.retreat', tone: 'warn' };
    else if (d.ticks - track.breakOffTick < RETREAT_SHOW_TICKS) warn = { key: 'df.st.breakOff', tone: 'alert' };
    else if (track.ufoRange && d.dist <= track.ufoRange) warn = { key: 'df.st.underFire', tone: 'alert' };
    if (DFS().breakingOff(G, d.id)) return { key: 'df.st.fleeing', params: null, tone: 'alert', warn: null };
    if (!craft.weapons.some(hasAmmo) && !d.projectiles.length && d.mode !== 'disengage') return { key: 'df.st.noAmmo', params: null, tone: 'warn', warn };
    if (d.mode === 'disengage') return { key: 'df.st.disengage', params: null, tone: 'info', warn };
    const target = DFS().targetDist(G, d.id);
    const live = [];
    for (const ws of d.weapons) {
      const w = craft.weapons[ws.slot];
      if (!w || !ws.enabled || !hasAmmo(w)) continue;
      if (d.dist <= D().craftWeapons[w.type].range * DF.rangeMul) live.push(T(D().craftWeapons[w.type].nameKey));
    }
    const fires = !!(DF.modes[d.mode] && DF.modes[d.mode].fire);
    if (d.mode === 'standoff' || !fires) {
      if (d.dist < target) return { key: 'df.st.retreating', params: { mode }, tone: 'info', warn };
      if (d.dist > target) return { key: 'df.st.approach', params: { mode }, tone: 'info', warn };
      return { key: 'df.st.standoff', params: null, tone: 'info', warn };
    }
    if (live.length) return { key: 'df.st.inRange', params: { w: live.join(' + ') }, tone: 'good', warn };
    if (d.dist > target) return { key: 'df.st.approach', params: { mode }, tone: 'info', warn };
    if (d.dist < target) return { key: 'df.st.retreating', params: { mode }, tone: 'info', warn };
    return { key: 'df.st.holding', params: { mode }, tone: 'info', warn };
  }

  // estado de uma arma da nave: {slot, empty} ou {slot, type, nameKey, ammo, ammoMax, enabled, state, progress, range, hit, projectile}
  function weaponInfo(G, d, slot, track) {
    const craft = C().findCraft(G, d.craftId);
    const tw = track && track.weapons[slot];
    const w = craft ? craft.weapons[slot] : tw ? { type: tw.type, ammo: tw.ammo } : null;
    if (!w) return { slot, empty: true };
    const DF = D().dogfight;
    const wd = D().craftWeapons[w.type];
    const ws = d.weapons.find((x) => x.slot === slot) || { enabled: false, reload: 0 };
    const mdef = DF.modes[d.mode] || {};
    const range = wd.range * DF.rangeMul;
    let state;
    if (!ws.enabled) state = 'off';
    else if (!hasAmmo(w)) state = 'empty';
    else if (ws.reload > 0) state = 'reload';
    else if (!mdef.fire) state = 'hold';
    else if (d.dist > range) state = 'range';
    else state = 'ready';
    const rmax = (track && track.reloadMax[slot]) || wd.reload[mdef.reload || 'standard'] || 1;
    const progress = ws.reload > 0 ? Math.max(0, Math.min(1, 1 - ws.reload / rmax)) : 1;
    return {
      slot, type: w.type, nameKey: wd.nameKey, ammo: w.ammo, ammoMax: wd.ammoMax, enabled: !!ws.enabled, state, progress,
      range, hit: C().findDogfight(G, d.id) ? DFS().hitChance(G, d.id, slot) : tw ? tw.hit : 0, projectile: wd.projectile, beam: !!wd.beam,
    };
  }

  // postura de abertura: a última que o jogador escolheu (G.ui.dfMode) ou Normal; nunca «Distância» com armas carregadas
  const FIRE_MODES = { cautious: 1, standard: 1, aggressive: 1 };
  function startMode(G, d) {
    const craft = C().findCraft(G, d.craftId);
    if (!craft || !craft.weapons.some(hasAmmo)) return null;
    const last = G.ui && G.ui.dfMode;
    return FIRE_MODES[last] ? last : 'standard';
  }
  // dica fixa: OVNI muito pequeno com mísseis ligados (desintegram-no: não há destroços para recuperar)
  function missileTip(G, d, track) {
    if (track.outcome || track.ufoSize > 0 || track.assault) return false;
    const craft = C().findCraft(G, d.craftId);
    if (!craft) return false;
    return d.weapons.some((ws) => {
      const w = craft.weapons[ws.slot];
      const wd = w && D().craftWeapons[w.type];
      return ws.enabled && hasAmmo(w) && wd && wd.projectile === 'missile';
    });
  }

  function outcomeTone(track) {
    switch (track.outcome) {
      case 'crashed': case 'destroyed': return 'good';
      case 'craftDestroyed': return 'alert';
      case 'escaped': case 'craftRetreated': return 'warn';
      default: return 'info';
    }
  }
  // resumo final (para o banner, onEnd e o resultado da cena)
  function summary(track) {
    const o = track.outcome || 'disengaged';
    const hpPct = Math.round((Math.max(0, track.craftHp) * 100) / Math.max(1, track.craftMaxHp));
    let titleKey = 'df.end.' + o;
    const subs = [];
    if (o === 'crashed' && track.seaCrash) {
      titleKey = 'df.end.seaCrash';
      subs.push({ key: 'df.sub.seaCrash' });
    } else if (track.assault && (o === 'disengaged' || o === 'escaped')) {
      // a nave de assalto não foge: passa e segue para a base, onde as defesas e a guarnição a esperam
      titleKey = 'df.end.assaultPassed';
      subs.push({ key: 'df.sub.assaultPassed' });
    } else subs.push({ key: 'df.sub.' + o });
    const survived = o !== 'craftDestroyed';
    if (survived && track.taken > 0 && hpPct <= 50 && (o === 'escaped' || o === 'disengaged' || o === 'craftRetreated')) {
      subs.unshift({ key: 'df.end.' + o });
      titleKey = 'df.end.damaged';
    }
    if (survived && track.taken > 0) subs.push({ key: 'df.sub.damaged', params: { p: hpPct } });
    const tickMs = D().dogfight.tickMs;
    return {
      dogfightId: track.id, craftId: track.craftId, ufoId: track.ufoId, craftType: track.craftType, ufoType: track.ufoType,
      outcome: o, seaCrash: track.seaCrash, titleKey, tone: titleKey === 'df.end.damaged' ? 'warn' : outcomeTone(track), subs,
      shots: track.shots, hits: track.hits, dealt: track.dealt, taken: track.taken, ufoShots: track.ufoShots, ufoHits: track.ufoHits,
      ticks: track.ticks, seconds: Math.round((track.ticks * tickMs) / 100) / 10,
      craftHp: Math.max(0, track.craftHp), craftMaxHp: track.craftMaxHp,
      ufoDmgPct: Math.min(100, Math.round((track.ufoDmg * 100) / Math.max(1, track.ufoHp))),
      events: track.events.slice(),
    };
  }

  // tamanho aparente (raio em px CSS) de um OVNI à distância dada; base por tipo (classe de tamanho)
  const SHAPES = {
    small_scout: { base: 26, ax: 1, dome: 0.44, lobes: 0, pods: 0 },
    medium_scout: { base: 32, ax: 1, dome: 0.38, lobes: 4, pods: 0, ring: true },
    large_scout: { base: 37, ax: 1.05, dome: 0.36, lobes: 0, pods: 2, ring: true },
    harvester: { base: 46, ax: 1, dome: 0.4, lobes: 0, pods: 3, claws: true, ring: true },
    abductor: { base: 48, ax: 1, dome: 0.46, lobes: 0, pods: 3, ring: true },
    supply_ship: { base: 58, ax: 1.45, dome: 0.3, lobes: 0, pods: 4, box: true },
    terror_ship: { base: 60, ax: 1.35, dome: 0.34, lobes: 3, pods: 2, spikes: true, ring: true },
    battleship: { base: 80, ax: 1.12, dome: 0.42, lobes: 8, pods: 4, ring: true },
  };
  function apparentR(type, dist) {
    const sh = SHAPES[type] || SHAPES.medium_scout;
    return Math.max(3, (sh.base * 360) / (Math.max(0, dist) + 180));
  }
  // perspetiva: escala relativa de um ponto à profundidade z (z = 0 junto à câmara)
  const Z0 = 150;
  const depthK = (z) => Z0 / (Math.max(0, z) + Z0);

  // =================================================================================================================
  // Apresentação
  // =================================================================================================================
  const el = (...a) => OV.Dom.el(...a);
  const uiRng = OV.RNG ? OV.RNG.create(0xd06f16) : { next: () => 0.5 };
  const rnd = () => uiRng.next();
  const reduceMotion = () => (OV.Game && typeof OV.Game.reduceMotion === 'function' ? OV.Game.reduceMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dprNow = () => Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function sfx(name, opts) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name, opts); } catch (e) { /* som opcional */ }
  }
  function hasSfx(name) {
    try { return !!(OV.audio && OV.audio.names && OV.audio.names().indexOf(name) >= 0); } catch (e) { return false; }
  }
  function tipHtml(title, key, extra) {
    let h = '<b>' + esc(title) + '</b>';
    if (key) h += ' <span class="key">' + esc(key) + '</span>';
    if (extra) h += '<br><span class="muted">' + esc(extra) + '</span>';
    return h;
  }
  function tip(node, title, key, extra) {
    const t0 = typeof title === 'function' ? title() : title;
    node.setAttribute('aria-label', t0 + (key ? ' (' + key + ')' : ''));
    OV.Dom.tooltip(node, () => tipHtml(typeof title === 'function' ? title() : title, key, typeof extra === 'function' ? extra() : extra));
    return node;
  }
  const ICONS = {
    min: '<path d="M5 17h14"/>',
    max: '<rect x="5" y="6" width="14" height="12" rx="1.5"/><path d="M5 9.5h14"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
    jet: '<path d="M12 3l2 7 7 3v2l-7-1-1 5 2 2v1l-3-1-3 1v-1l2-2-1-5-7 1v-2l7-3z"/>',
  };
  const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  function setText(node, v) {
    const s = String(v);
    if (node && node.textContent !== s) node.textContent = s;
  }
  function setCls(node, cls, on) {
    if (node && node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
  }
  const fmtClock = (s) => {
    const t = Math.max(0, Math.floor(s));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };

  // ---- estado da sobreposição ---------------------------------------------------------------------------------
  let S = null; // {G, scene, root, stage, dock, panels, opts, paused, acc, vt, results, prevMood, popPending, engineT}

  const panelOf = (id) => (S ? S.panels.find((p) => p.id === id) || null : null);
  const focused = () => (S ? S.panels.find((p) => !p.minimised) || null : null);

  function addPanel(id, opts) {
    if (!S || panelOf(id)) return null;
    const d = C().findDogfight(S.G, id);
    if (!d) return null;
    // abre já a atacar (Normal ou a última postura): em «Distância» o OVNI ganhava tempo para fugir
    if (d.mode === 'standoff' && !d.ticks) {
      const m = startMode(S.G, d);
      if (m) DFS().setMode(S.G, id, m);
    }
    const track = newTrack(S.G, d);
    const p = {
      id, d, track, opts: opts || {}, minimised: true, endVt: null, bannerVt: null, closeVt: null, bannerShown: false,
      lastBolt: 0, el: {}, cache: {}, vis: newVis(track, d),
    };
    S.panels.push(p);
    buildPanel(p);
    buildChip(p);
    if (p.el.hint) {
      p.hintUntil = S.vt + HINT_MS;
      if (S.G.ui) S.G.ui.dfHintSeen = true;
    }
    if (!focused()) restore(id, true);
    else flashChip(p);
    sfx('reaction_alert');
    // OVNI muito pequeno com mísseis ligados: pergunta já (uma linha, combate em pausa) se quer destroços
    if (missileTip(S.G, d, track) && !((S.G.ui && S.G.ui.dfMissileKeep | 0) >= 2)) askMissiles(p);
    return p;
  }
  function askMissiles(p) {
    const E = p.el;
    if (!E.ask || p.track.outcome) return;
    p.ask = true;
    setCls(E.ask, 'hidden', false);
    setCls(E.tip, 'hidden', true);
    if (E.ask.parentNode) setCls(E.ask.parentNode, 'df-asking', true);
    setPaused(true, true);
    if (p.minimised) restore(p.id, true);
    setTimeout(() => { if (p.ask && E.askOff.isConnected && !(OV.Input && OV.Input.lastPointerType === 'touch')) E.askOff.focus({ preventScroll: true }); }, 0);
  }
  // resposta: off = desligar os mísseis (há destroços para a equipa); senão continua como está
  function answerMissiles(p, off) {
    if (!p.ask || !S) return;
    p.ask = false;
    setCls(p.el.ask, 'hidden', true);
    if (p.el.ask.parentNode) setCls(p.el.ask.parentNode, 'df-asking', false);
    if (off) {
      const craft = C().findCraft(S.G, p.d.craftId);
      for (const ws of p.d.weapons) {
        const w = craft && craft.weapons[ws.slot];
        const wd = w && D().craftWeapons[w.type];
        if (ws.enabled && wd && wd.projectile === 'missile') DFS().toggleWeapon(S.G, p.id, ws.slot);
      }
      sfx('ui_confirm');
    } else {
      if (S.G.ui) S.G.ui.dfMissileKeep = (S.G.ui.dfMissileKeep | 0) + 1;
      sfx('ui_click');
    }
    setPaused(false, true);
    refreshPanel(p);
  }

  function newVis(track, d) {
    const stars = [], clouds = [];
    for (let i = 0; i < 90; i++) stars.push({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, r: 0.3 + Math.pow(rnd(), 3) * 1.4, a: 0.3 + rnd() * 0.7, f: 0.5 + rnd() * 2 });
    for (let i = 0; i < 16; i++) clouds.push(newCloud(track, rnd()));
    return {
      stars, clouds, parts: [], nums: [], bolts: [], beams: [], ghosts: [], proj: new Map(),
      shake: 0, flash: 0, flashCol: '255,255,255', red: 0, roll: 0, rollV: 0,
      distPrev: d.dist, distNow: d.dist, craftHp: track.craftHp, ufoDmg: track.ufoDmg, lastVt: 0,
      ux: 0, uy: 0, uR: 4, seed: rnd() * 100, cracks: null,
    };
  }
  function newCloud(track, z) {
    const high = track.alt >= 3;
    return { x: (rnd() * 2 - 1) * 1.6, y: high ? 0.35 + rnd() * 0.5 : (rnd() * 2 - 1) * 0.55, z: z === undefined ? 1 : z, s: 0.6 + rnd() * 1.1, a: 0.35 + rnd() * 0.5 };
  }

  // ---- DOM do painel --------------------------------------------------------------------------------------------
  function buildPanel(p) {
    const tr = p.track;
    const E = p.el;
    E.pause = el('button', { type: 'button', class: 'btn small ghost df-hbtn', html: icon('pause'), onclick: () => togglePause() });
    tip(E.pause, () => T(S && S.paused ? 'df.btn.resume' : 'df.btn.pause'), 'P / Espaço');
    E.min = el('button', { type: 'button', class: 'btn small ghost df-hbtn', html: icon('min'), onclick: () => minimise(p.id) });
    tip(E.min, T('df.btn.minimise'), 'M / Esc', T('df.btn.minimise.hint'));
    E.clock = el('span', { class: 'df-clock mono', text: '00:00' });
    tip(E.clock, T('df.elapsed'));
    const head = el('header', { class: 'df-head' },
      el('span', { class: 'df-tag' + (tr.scramble ? ' df-tag-def' : ''), html: icon('jet') + '<span>' + esc(T(tr.scramble ? 'df.title.scramble' : 'df.title')) + '</span>' }),
      el('span', { class: 'df-names' },
        el('b', { class: 'df-craft', text: tr.craftLabel }),
        el('span', { class: 'df-vs', text: T('df.vs') }),
        el('b', { class: 'df-ufo', text: tr.ufoLabel })),
      el('span', { class: 'grow' }),
      E.clock, E.pause, E.min);

    E.canvas = el('canvas', { class: 'df-canvas', 'aria-hidden': 'true' });
    E.ctx = E.canvas.getContext('2d');
    E.st = el('b', { class: 'df-st-main' });
    E.warn = el('span', { class: 'df-st-warn' });
    E.alt = el('span', { class: 'df-alt', text: T('df.alt', { alt: T('alt.' + (D().altitudes[tr.alt] || 'low')) }) });
    E.pauseTag = el('div', { class: 'df-pausetag', text: T('df.hud.paused') });
    E.banner = el('div', { class: 'df-banner hidden', role: 'status', 'aria-live': 'polite' });
    E.tip = el('div', { class: 'df-tip hidden', text: T('df.tip.smallUfo') });
    E.askOff = el('button', { type: 'button', class: 'btn primary', 'aria-keyshortcuts': 'Q Enter' }, T('df.ask.off'), el('kbd', { text: 'Q' }));
    E.askOff.addEventListener('click', () => answerMissiles(p, true));
    tip(E.askOff, T('df.ask.off'), 'Q / Enter', T('df.ask.off.hint'));
    const askKeep = el('button', { type: 'button', class: 'btn', 'aria-keyshortcuts': 'N Escape' }, T('df.ask.keep'), el('kbd', { text: 'N' }));
    askKeep.addEventListener('click', () => answerMissiles(p, false));
    tip(askKeep, T('df.ask.keep'), 'N / Esc', T('df.ask.keep.hint'));
    E.ask = el('div', { class: 'df-ask hidden', role: 'alertdialog', 'aria-label': T('df.ask.q') }, el('b', { class: 'df-ask-q', text: T('df.ask.q') }), el('div', { class: 'df-ask-a' }, E.askOff, askKeep));
    const hintLines = [];
    if (tr.scramble) hintLines.push(TT(tr.ufoType === 'battleship' ? 'df.hint.scrambleBig' : 'df.hint.scramble'));
    if (S.G.ui && !S.G.ui.dfHintSeen) {
      hintLines.push(TT('df.hint.modes'));
      if (tr.ufoSize === 0) hintLines.push(TT('df.hint.small'));
    }
    if (hintLines.length) {
      const x = el('button', { type: 'button', class: 'btn small ghost df-hint-x', text: '×', onclick: () => hideHint(p) });
      tip(x, T('df.hint.close'));
      E.hint = el('div', { class: 'df-hint', role: 'note' }, el('div', null, hintLines.map((l) => el('p', { text: l }))), x);
      p.hintUntil = null;
    }
    const view = el('div', { class: 'df-view' }, E.canvas, el('div', { class: 'df-status', 'aria-live': 'polite' }, E.st, E.warn, E.tip), E.alt, E.pauseTag, E.hint || null, E.banner, E.ask);

    // barra de distância: nave à esquerda (0), OVNI no marcador; zonas e marcas de alcance
    const DF = D().dogfight;
    const maxD = DF.disengage;
    const pct = (v) => Math.max(0, Math.min(100, (v / maxD) * 100)).toFixed(2) + '%';
    const track = el('div', { class: 'df-rtrack' });
    if (tr.ufoRange) track.appendChild(el('i', { class: 'df-rzone', style: { width: pct(tr.ufoRange) } }));
    track.appendChild(el('i', { class: 'df-rstand', style: { left: pct(DF.standoff) } }));
    tr.weapons.forEach((w, slot) => {
      if (!w) return;
      const wd = D().craftWeapons[w.type];
      track.appendChild(el('i', { class: 'df-rmark s' + slot, style: { left: pct(wd.range * DF.rangeMul) } }, el('span', { text: T(wd.nameKey) })));
    });
    E.target = el('i', { class: 'df-rtarget' });
    E.ufoMark = el('i', { class: 'df-rufo' }, el('span', { class: 'mono' }));
    track.append(E.target, E.ufoMark, el('i', { class: 'df-rcraft' }));
    const legend = el('div', { class: 'df-rlegend' },
      el('span', { class: 'df-rl-craft', text: tr.craftLabel }),
      el('span', { class: tr.ufoRange ? 'df-rl-zone' : 'df-rl-safe', text: tr.ufoRange ? T('df.ufoWeapon') + ' ≤ ' + tr.ufoRange : T('df.ufoUnarmed') }),
      el('span', { class: 'grow' }),
      el('span', { class: 'df-rl-dist' }, T('df.dist') + ' ', E.dist = el('b', { class: 'mono', text: String(p.d.dist) })));
    const range = el('div', { class: 'df-range' }, legend, track);
    tip(range, T('df.dist'), null, T('df.range.tip'));

    // posturas
    E.modes = DF.modeOrder.map((m, i) => {
      const b = el('button', { type: 'button', class: 'btn df-mode m-' + m, role: 'radio', dataset: { mode: m } },
        el('span', { class: 'key', text: MODE_KEYS[i] }), el('span', { text: T('df.mode.' + m) }));
      b.addEventListener('click', () => { setMode(p, m); b.blur(); });
      tip(b, T('df.mode.' + m), MODE_KEYS[i], T('df.mode.' + m + '.hint'));
      return b;
    });
    const modes = el('div', { class: 'df-modes', role: 'radiogroup', 'aria-label': T('df.modes') }, E.modes);

    // cascos
    E.hpCraft = el('div', { class: 'df-hbar craft' }, el('i'), el('span', { class: 'mono' }));
    E.hpUfo = el('div', { class: 'df-hbar ufo' }, el('i'), el('em', { class: 'df-crashmark', title: T('df.crashMark') }), el('span', { class: 'mono' }));
    const hulls = el('div', { class: 'df-hulls' },
      tip(el('div', { class: 'df-hull' }, el('label', { text: T('df.hull') }), E.hpCraft), T('df.hull'), null, T('df.hull.tip')),
      tip(el('div', { class: 'df-hull' }, el('label', { text: T('df.ufoDmg') }), E.hpUfo), T('df.ufoDmg'), null, T('df.ufoDmg.tip')));

    // armas
    E.wpns = tr.weapons.map((w, slot) => buildWeapon(p, w, slot));
    if (!E.wpns.length) E.wpns.push(el('div', { class: 'df-wpn empty' }, el('span', { class: 'muted', text: T('df.w.empty') })));
    const bottom = el('div', { class: 'df-bottom' }, hulls, el('div', { class: 'df-wpns' }, E.wpns.map((x) => x.root || x)));

    E.root = el('section', { class: 'df-panel panel hidden', role: 'dialog', 'aria-label': T('df.title') + ': ' + tr.craftLabel + ' — ' + tr.ufoLabel, dataset: { id: p.id } },
      head, view, range, modes, bottom);
    S.stage.appendChild(E.root);
  }

  function buildWeapon(p, w, slot) {
    if (!w) return { root: el('div', { class: 'df-wpn empty' }, el('span', { class: 'muted', text: T('df.w.empty') })), slot };
    const wd = D().craftWeapons[w.type];
    const name = T(wd.nameKey);
    const key = SLOT_KEYS[slot] || null;
    const o = { slot };
    o.toggle = el('button', { type: 'button', class: 'df-tgl', 'aria-pressed': 'true' }, el('i'), el('span', { text: T('df.w.on') }));
    o.toggle.addEventListener('click', () => { toggleWeapon(p, slot); o.toggle.blur(); });
    tip(o.toggle, T('df.w.toggle', { w: name }), key, T('df.w.toggle.hint'));
    o.ammo = el('span', { class: 'df-ammo mono' });
    o.pips = wd.ammoMax && wd.ammoMax <= 8 ? el('span', { class: 'df-pips' }) : null;
    if (o.pips) for (let i = 0; i < wd.ammoMax; i++) o.pips.appendChild(el('i'));
    o.hit = el('span', { class: 'df-whit' });
    o.bar = el('div', { class: 'df-wbar' }, el('i'), el('span'));
    o.root = el('div', { class: 'df-wpn s' + slot, dataset: { slot: String(slot) } },
      el('div', { class: 'df-wtop' }, key ? el('span', { class: 'key', text: key }) : null, el('b', { class: 'df-wname', text: name }), el('span', { class: 'grow' }), o.toggle),
      el('div', { class: 'df-wmid' }, o.pips, o.ammo, el('span', { class: 'grow' }), o.hit, el('span', { class: 'df-wrange muted', text: T('df.w.range', { r: wd.range * D().dogfight.rangeMul }) })),
      o.bar);
    return o;
  }

  function buildChip(p) {
    const E = p.el;
    E.chip = el('button', { type: 'button', class: 'df-chip', dataset: { id: p.id } },
      el('span', { class: 'df-chip-dot' }),
      el('span', { class: 'df-chip-txt' },
        el('b', { text: p.track.craftLabel }),
        E.chipSt = el('small', { text: '' })),
      el('span', { class: 'df-chip-bars' }, E.chipCraft = el('i', { class: 'c' }), E.chipUfo = el('i', { class: 'u' })),
      E.chipDist = el('span', { class: 'df-chip-dist mono' }));
    E.chip.addEventListener('click', () => { sfx('ui_click'); restore(p.id); });
    tip(E.chip, T('df.btn.restore', { craft: p.track.craftLabel }), 'M / Tab');
    S.dock.appendChild(E.chip);
  }
  function flashChip(p) {
    const c = p.el.chip;
    if (!c) return;
    c.classList.remove('ping');
    void c.offsetWidth;
    c.classList.add('ping');
  }

  // ---- ações ------------------------------------------------------------------------------------------------------
  function setMode(p, mode) {
    if (!S || p.track.outcome) return false;
    if (p.d.mode === mode) return true;
    const ok = DFS().setMode(S.G, p.id, mode);
    if (ok) {
      if (FIRE_MODES[mode] && S.G.ui) S.G.ui.dfMode = mode;
      sfx('ui_select');
      p.vis.rollV += mode === 'disengage' ? 0.0006 : (DFTargetDelta(p) > 0 ? -0.00035 : 0.00035);
    } else {
      sfx('ui_deny');
      p.cache.denyVt = S.vt;
    }
    refreshPanel(p);
    return ok;
  }
  function DFTargetDelta(p) {
    const t = DFS().targetDist(S.G, p.id);
    return t === null ? 0 : t - p.d.dist;
  }
  function toggleWeapon(p, slot) {
    if (!S || p.track.outcome) return false;
    const ok = DFS().toggleWeapon(S.G, p.id, slot);
    sfx(ok ? 'ui_click' : 'ui_deny');
    refreshPanel(p);
    return ok;
  }
  function hideHint(p) {
    if (!p.el.hint) return;
    p.el.hint.remove();
    p.el.hint = null;
    OV.Dom.hideTooltip();
  }
  function togglePause() { setPaused(!(S && S.paused)); }
  // quiet: pausa sem aviso nem som (capturas, popups do Geoscape por cima)
  function setPaused(v, quiet) {
    if (!S) return;
    S.paused = !!v;
    S.quietPause = !!v && !!quiet;
    if (!quiet) sfx('ui_click');
    for (const p of S.panels) refreshPanel(p);
  }

  function restore(id, silent) {
    if (!S) return false;
    const p = id ? panelOf(id) : focused() || S.panels[S.panels.length - 1];
    if (!p) return false;
    for (const q of S.panels) if (q !== p) setMin(q, true);
    setMin(p, false);
    if (!silent) sfx('ui_select');
    return true;
  }
  function minimise(id) {
    if (!S) return false;
    const p = id ? panelOf(id) : focused();
    if (!p || p.minimised) return false;
    setMin(p, true);
    sfx('ui_click');
    OV.Dom.hideTooltip();
    return true;
  }
  function toggle(id) {
    const p = id ? panelOf(id) : focused() || (S && S.panels[S.panels.length - 1]);
    if (!p) return false;
    return p.minimised ? restore(p.id) : minimise(p.id);
  }
  function setMin(p, min) {
    p.minimised = min;
    setCls(p.el.root, 'hidden', min);
    setCls(p.el.chip, 'hidden', !min);
    setCls(S.root, 'df-has-open', !!focused());
    if (!min) refreshPanel(p);
  }
  function cycle() {
    if (!S || S.panels.length < 2) return false;
    const f = focused();
    const i = f ? S.panels.indexOf(f) : -1;
    return restore(S.panels[(i + 1) % S.panels.length].id);
  }

  // ---- ciclo de simulação ----------------------------------------------------------------------------------------
  function stepPanel(p) {
    const G = S.G;
    if (!C().findDogfight(G, p.id)) {
      // removido por fora (World.loseCraft, carregamento…): fecha com o que se sabe
      p.track.outcome = p.d.outcome || 'disengaged';
      beginEnding(p, []);
      return;
    }
    const before = p.d.projectiles.slice();
    const distBefore = p.d.dist;
    const n0 = G.events.length;
    const ev = DFS().tick(G, p.id);
    const geo = G.events.splice(n0);
    absorb(p.track, G, p.d, ev);
    absorbGeo(p.track, geo);
    p.vis.distPrev = distBefore;
    p.vis.distNow = p.d.dist;
    for (const pr of before) if (p.d.projectiles.indexOf(pr) < 0) resolveProjectile(p, pr);
    animEvents(p, ev);
    if (p.track.outcome) beginEnding(p, ev);
  }

  function think(dt) {
    if (!S) return;
    const halted = S.paused || (OV.Dom.anyModalOpen && OV.Dom.anyModalOpen());
    if (!halted) {
      S.vt += dt;
      const r = ticksFor(S.acc, dt, D().dogfight.tickMs, MAX_TICKS);
      S.acc = r.acc;
      for (let i = 0; i < r.n; i++) for (const p of S.panels.slice()) if (!p.track.outcome) stepPanel(p);
      for (const p of S.panels) arriveBolts(p);
      engineHum();
    }
    for (const p of S.panels.slice()) {
      if (p.el.hint && p.hintUntil !== null && (S.vt >= p.hintUntil || p.track.outcome)) hideHint(p);
      if (p.bannerVt !== null && !p.bannerShown && S.vt >= p.bannerVt) showBanner(p);
      if (p.closeVt !== null && S.vt >= p.closeVt) closePanel(p);
    }
    if (S) for (const p of S.panels) refreshPanel(p);
    // o Geoscape por baixo não pensa: mostra combustível, casco e listas atuais da nave em combate
    if (S && (S.peekT = (S.peekT || 0) + dt) >= PEEK_MS) {
      S.peekT = 0;
      const b = below();
      if (b && typeof b.peek === 'function') { try { b.peek(); } catch (e) { console.error(e); } }
    }
  }

  function engineHum() {
    if (!S.hasEngine) return;
    if (S.vt - S.engineT < 1700) return;
    S.engineT = S.vt;
    const f = focused();
    if (f && !f.track.outcome) sfx('dogfight_engine', { vol: 0.5 });
  }

  // ---- resultado e fecho -----------------------------------------------------------------------------------------
  function beginEnding(p, ev) {
    if (p.endVt !== null) return;
    const o = p.track.outcome;
    p.endVt = S.vt;
    const lastBolt = p.vis.bolts.reduce((m, b) => Math.max(m, b.t0 + b.dur), S.vt);
    let delay = 650;
    if (o === 'crashed' && !p.track.seaCrash) delay = 900;
    p.vis.lossAt = Math.max(0, lastBolt - S.vt) + 40;
    if (o === 'craftDestroyed') delay = Math.max(900, lastBolt - S.vt + 700);
    p.bannerVt = S.vt + delay;
    p.closeVt = p.bannerVt + OUTCOME_MS;
    const v = p.vis;
    if (o === 'destroyed' || (o === 'crashed' && p.track.seaCrash)) {
      explode(p, v.ux, v.uy, v.uR * 2.2, true);
      v.flash = 1;
      v.flashCol = '255,240,220';
      v.shake = Math.max(v.shake, 9);
      sfx('explosion_large');
    } else if (o === 'crashed') {
      sfx('ufo_crash');
      v.shake = Math.max(v.shake, 5);
    } else if (o === 'escaped') sfx('radar_ping');
    else if (o === 'disengaged' || o === 'craftRetreated') sfx('ui_confirm');
    // um combate minimizado que acaba abre-se para mostrar o resultado, se nada mais estiver aberto
    const f = focused();
    if (p.minimised && (!f || f.track.outcome)) restore(p.id, true);
    else if (p.minimised) flashChip(p);
  }

  function showBanner(p) {
    p.bannerShown = true;
    const sm = summary(p.track);
    p.summary = sm;
    const b = p.el.banner;
    OV.Dom.clear(b);
    const cont = el('button', { type: 'button', class: 'btn primary df-cont' }, T('df.btn.continue'), el('kbd', { text: '↵' }));
    cont.addEventListener('click', () => closePanel(p));
    tip(cont, T('df.btn.continue'), 'Enter');
    const stat = (k, v) => el('div', { class: 'df-bstat' }, el('small', { text: T(k) }), el('b', { class: 'mono', text: v }));
    const acc = sm.shots ? Math.round((sm.hits * 100) / sm.shots) + ' %' : '—';
    b.append(
      el('div', { class: 'df-btitle', text: T(sm.titleKey) }),
      el('div', { class: 'df-bsub' }, sm.subs.map((s) => el('p', { text: T(s.key, s.params) }))),
      el('div', { class: 'df-bstats' },
        stat('df.sum.shots', String(sm.shots)),
        stat('df.sum.hits', sm.hits + ' · ' + acc),
        stat('df.sum.dealt', sm.dealt + ' · ' + sm.ufoDmgPct + ' %'),
        stat('df.sum.taken', String(sm.taken)),
        stat('df.sum.time', T('df.sum.seconds', { s: String(sm.seconds).replace('.', ',') }))),
      el('div', { class: 'df-bfoot' }, el('div', { class: 'df-bprog' }, el('i', { style: { animationDuration: OUTCOME_MS + 'ms' } })), cont));
    b.dataset.tone = sm.tone;
    b.classList.remove('hidden');
    p.el.root.classList.add('ended');
    p.el.root.dataset.tone = sm.tone;
    if (p.el.chip) p.el.chip.dataset.tone = sm.tone;
    if (sm.tone === 'good' && OV.audio && OV.audio.play) sfx('ui_confirm');
  }

  function deliver(p, sm) {
    const o = p.opts.onEvents ? p.opts : S.opts;
    try {
      if (o && typeof o.onEvents === 'function') o.onEvents(sm.events.slice(), sm);
      else if (S.G && Array.isArray(S.G.events)) for (const e of sm.events) S.G.events.push(e);
    } catch (e) { console.error(e); }
    const e2 = p.opts.onEnd ? p.opts : S.opts;
    try { if (e2 && typeof e2.onEnd === 'function') e2.onEnd(sm); } catch (e) { console.error(e); }
  }

  // fecha um painel; um combate ainda a decorrer termina por OV.Dogfight.finish
  function closePanel(p) {
    if (!S || S.panels.indexOf(p) < 0) return;
    if (!p.track.outcome) {
      const G = S.G;
      if (C().findDogfight(G, p.id)) {
        const n0 = G.events.length;
        DFS().finish(G, p.id);
        p.track.outcome = p.d.outcome || 'disengaged';
        absorb(p.track, G, p.d, []);
        absorbGeo(p.track, G.events.splice(n0));
      } else p.track.outcome = p.d.outcome || 'disengaged';
    }
    const sm = p.summary || summary(p.track);
    const wasOpen = !p.minimised;
    S.panels.splice(S.panels.indexOf(p), 1);
    if (p.el.root) p.el.root.remove();
    if (p.el.chip) p.el.chip.remove();
    OV.Dom.hideTooltip();
    S.results.push(sm);
    deliver(p, sm);
    if (!S) return;
    if (!S.panels.length) { finishOverlay(); return; }
    if (wasOpen) restore(S.panels[0].id, true);
    setCls(S.root, 'df-has-open', !!focused());
  }

  function finishOverlay() {
    const sc = S.scene;
    const top = OV.Scenes.top();
    if (top === sc) OV.Scenes.pop({ dogfight: S.results.slice() });
    else S.popPending = true; // outra cena por cima: sai quando voltar ao topo
  }

  // ---- animação dos eventos ---------------------------------------------------------------------------------------
  const WCOL = { missile: '255,190,110', cannon: '255,226,120', laser: '255,70,60', plasma: '120,255,170', fusion: '190,220,255' };

  function animEvents(p, ev) {
    const v = p.vis;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'df.fire' && e.from === 'craft') {
        const wd = D().craftWeapons[e.weapon];
        const pan = e.slot === 0 ? -0.35 : 0.35;
        const card = p.el.wpns && p.el.wpns.find((x) => x.slot === e.slot);
        if (card && card.root) { card.root.classList.remove('fire'); void card.root.offsetWidth; card.root.classList.add('fire'); }
        v.parts.push({ kind: 'muzzle', slot: e.slot, t0: S.vt, life: 120 });
        if (wd.beam) {
          const res = ev.slice(i + 1).find((x) => (x.t === 'df.hit' && x.target === 'ufo' && x.slot === e.slot) || (x.t === 'df.miss' && x.from === 'craft' && x.slot === e.slot));
          v.beams.push({ slot: e.slot, t0: S.vt, life: 190, hit: !!(res && res.t === 'df.hit'), col: WCOL[wd.projectile] || WCOL.laser, off: (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5) });
          sfx(wd.projectile === 'plasma' ? 'plasma' : 'laser', { pan });
        } else if (wd.projectile === 'cannon') sfx('dogfight_cannon', { pan, vol: 0.8 });
        else sfx('dogfight_missile', { pan });
      } else if (e.t === 'df.fire' && e.from === 'ufo') {
        const res = ev.slice(i + 1).find((x) => (x.t === 'df.hit' && x.target === 'craft') || (x.t === 'df.miss' && x.from === 'ufo'));
        const hit = !!(res && res.t === 'df.hit');
        v.bolts.push({ t0: S.vt, dur: 300 + Math.min(260, p.d.dist * 0.5), hit, dmg: hit ? res.dmg : 0, side: rnd() < 0.5 ? -1 : 1, z0: p.d.dist, done: false });
        sfx('plasma', { rate: 0.6, vol: 0.7 });
      } else if (e.t === 'df.hit' && e.target === 'ufo') {
        const big = Math.min(1, e.dmg / 120);
        explode(p, v.ux + (rnd() - 0.5) * v.uR, v.uy + (rnd() - 0.5) * v.uR * 0.4, v.uR * (0.5 + big), false);
        v.nums.push({ x: v.ux + (rnd() - 0.5) * v.uR, y: v.uy - v.uR * 0.6, text: '−' + e.dmg, col: '#ffcf6b', t0: S.vt, life: 1000, big: e.dmg >= 40 });
        v.ufoDmg += e.dmg;
        v.shake = Math.max(v.shake, 1.5 + big * 3);
        v.flash = Math.max(v.flash, 0.12 + big * 0.2);
        v.flashCol = '255,230,190';
        sfx(e.dmg >= 30 ? 'explosion_small' : 'dogfight_hit', { vol: 0.8 });
      } else if (e.t === 'df.miss' && e.from === 'craft') {
        const w = p.track.weapons[e.slot];
        if (w && w.type !== 'cannon') v.nums.push({ x: v.ux + v.uR * 1.3, y: v.uy - v.uR * 0.2, text: T('df.hud.miss'), col: '#9fb2c4', t0: S.vt, life: 800, small: true });
      } else if (e.t === 'df.retreat') {
        sfx('ui_deny');
        v.rollV += 0.0007;
      } else if (e.t === 'df.breakOff') {
        sfx('alien_spotted');
      }
    }
  }

  function resolveProjectile(p, pr) {
    const rec = p.vis.proj.get(pr);
    p.vis.proj.delete(pr);
    const reached = pr.pos >= p.d.dist;
    if (reached && pr.hit && pr.dmg > 0) return; // o impacto é desenhado pelo df.hit
    // falhou ou ficou sem alcance: segue em frente e apaga-se (míssil autodestrói-se no fim do alcance)
    if (rec) p.vis.ghosts.push({ x: rec.x, y: rec.y, vx: rec.vx * 1.4 + (rnd() - 0.5) * 0.2, vy: rec.vy * 1.4 - 0.05, t0: S.vt, life: reached ? 380 : 160, kind: pr.weapon, size: rec.size, puff: !reached });
  }

  function explode(p, x, y, size, huge) {
    const v = p.vis;
    const n = huge ? 34 : 12;
    v.parts.push({ kind: 'flash', x, y, r: size * (huge ? 2.4 : 1.4), t0: S.vt, life: huge ? 360 : 180 });
    v.parts.push({ kind: 'ring', x, y, r: size, t0: S.vt, life: huge ? 700 : 380 });
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, s = (0.05 + rnd() * 0.25) * (huge ? 1.6 : 1) * Math.max(0.6, size / 20);
      v.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, t0: S.vt, life: 300 + rnd() * 400, r: 1 + rnd() * 1.6 });
    }
    for (let i = 0; i < (huge ? 14 : 5); i++) {
      const a = rnd() * TAU, s = rnd() * 0.04 * Math.max(0.6, size / 20);
      v.parts.push({ kind: 'smoke', x: x + Math.cos(a) * size * 0.3, y: y + Math.sin(a) * size * 0.2, vx: Math.cos(a) * s, vy: -0.01 - rnd() * 0.02, t0: S.vt, life: 900 + rnd() * 900, r: size * (0.35 + rnd() * 0.4), g: 0.0012 });
    }
    if (huge) {
      for (let i = 0; i < 16; i++) {
        const a = rnd() * TAU, s = 0.1 + rnd() * 0.3;
        v.parts.push({ kind: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.1, t0: S.vt, life: 900 + rnd() * 700, r: 1.5 + rnd() * 3, rot: rnd() * TAU, vr: (rnd() - 0.5) * 0.02 });
      }
    }
  }

  // ---- atualização do DOM -----------------------------------------------------------------------------------------
  function refreshPanel(p) {
    if (!S) return;
    const G = S.G, d = p.d, tr = p.track, E = p.el, c = p.cache;
    const DF = D().dogfight;
    const st = status(G, d, tr);
    const blocked = !tr.outcome && DFS().breakingOff(G, d.id);
    const paused = (S.paused && !S.quietPause) || (OV.Dom.anyModalOpen && OV.Dom.anyModalOpen());
    const deny = c.denyVt !== undefined && S.vt - c.denyVt < 1600;
    const mainKey = paused && !tr.outcome ? 'df.st.paused' : deny ? 'df.mode.blocked' : st.key;
    const mainTxt = TT(mainKey, st.params || undefined);
    const mainTone = paused && !tr.outcome ? 'info' : deny ? 'alert' : st.tone;
    const dist = Math.round(d.dist);
    const craftHp = Math.max(0, Math.round(p.vis.craftHp));
    const ufoPct = Math.min(100, Math.round((p.vis.ufoDmg * 100) / Math.max(1, tr.ufoHp)));
    const craftPct = Math.round((craftHp * 100) / Math.max(1, tr.craftMaxHp));
    // ficha minimizada
    setText(E.chipSt, mainKey === 'df.st.standoff' ? T('df.st.standoff.short') : mainTxt);
    if (E.chip) {
      E.chip.dataset.tone = tr.outcome ? outcomeTone(tr) : mainTone;
      setText(E.chipDist, dist);
      E.chipCraft.style.width = craftPct + '%';
      E.chipUfo.style.width = ufoPct + '%';
    }
    if (p.minimised) return;
    setText(E.st, mainTxt);
    E.st.dataset.tone = mainTone;
    setText(E.warn, st.warn ? T(st.warn.key) : '');
    // com a pergunta «Desligar mísseis?» aberta a mesma informação já está nela: o parágrafo sai
    setCls(E.tip, 'hidden', !missileTip(G, d, tr) || !!p.ask);
    E.warn.dataset.tone = st.warn ? st.warn.tone : '';
    setCls(E.pauseTag, 'on', !!paused && !tr.outcome);
    setCls(E.root, 'paused', !!paused);
    if (c.pauseIcon !== S.paused) { c.pauseIcon = S.paused; E.pause.innerHTML = icon(S.paused ? 'play' : 'pause'); }
    setText(E.clock, fmtClock((tr.ticks * DF.tickMs) / 1000));
    // distância
    const maxD = DF.disengage;
    const pc = (x) => Math.max(0, Math.min(100, (x / maxD) * 100)).toFixed(2) + '%';
    if (c.dist !== dist) {
      c.dist = dist;
      setText(E.dist, dist);
      E.ufoMark.style.left = pc(dist);
      setText(E.ufoMark.firstChild, dist);
    }
    const target = tr.outcome ? null : DFS().targetDist(G, d.id);
    if (c.target !== target) {
      c.target = target;
      setCls(E.target, 'hidden', target === null);
      if (target !== null) E.target.style.left = pc(Math.min(maxD, target));
    }
    setCls(E.ufoMark, 'danger', !!(tr.ufoRange && dist <= tr.ufoRange));
    // posturas
    for (const b of E.modes) {
      const on = b.dataset.mode === d.mode;
      setCls(b, 'on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const dis = !!tr.outcome || blocked;
      if (b.disabled !== dis) b.disabled = dis;
    }
    // cascos
    E.hpCraft.firstChild.style.width = craftPct + '%';
    setCls(E.hpCraft, 'low', craftPct <= 50);
    setCls(E.hpCraft, 'crit', craftPct <= 25);
    setText(E.hpCraft.lastChild, craftHp + ' / ' + tr.craftMaxHp);
    E.hpUfo.firstChild.style.width = ufoPct + '%';
    setCls(E.hpUfo, 'over', ufoPct > 50);
    setText(E.hpUfo.lastChild, ufoPct + ' %');
    // armas
    for (const o of E.wpns) {
      if (!o.toggle) continue;
      const wi = weaponInfo(G, d, o.slot, tr);
      if (wi.empty) continue;
      const key = wi.state + '|' + wi.ammo + '|' + wi.enabled + '|' + wi.hit + '|' + Math.round(wi.progress * 40);
      if (c['w' + o.slot] === key) continue;
      c['w' + o.slot] = key;
      o.root.dataset.state = wi.state;
      setCls(o.root, 'off', !wi.enabled);
      o.toggle.setAttribute('aria-pressed', wi.enabled ? 'true' : 'false');
      setText(o.toggle.lastChild, T(wi.enabled ? 'df.w.on' : 'df.w.off'));
      o.toggle.disabled = !!tr.outcome;
      setText(o.ammo, wi.ammoMax === null ? '∞' : wi.ammo + '/' + wi.ammoMax);
      if (o.pips) [...o.pips.children].forEach((x, i) => setCls(x, 'on', i < wi.ammo));
      setText(o.hit, T('df.w.hit', { p: wi.hit }));
      o.bar.firstChild.style.width = Math.round((wi.state === 'reload' ? wi.progress : wi.state === 'empty' ? 0 : 1) * 100) + '%';
      setText(o.bar.lastChild, T('df.w.st.' + wi.state));
    }
  }

  // ---- desenho do canvas ------------------------------------------------------------------------------------------
  const SKY = {
    day: [['#0d2a55', '#3f78b4', '#9cc4e2'], ['#081d40', '#2c5f9c', '#7fb0dc'], ['#030c22', '#163f78', '#5a8fc4']],
    dusk: [['#151838', '#4a3a6a', '#e08a5a'], ['#0e1230', '#3a2f5c', '#c87650'], ['#060a1c', '#22224a', '#9a5a50']],
    night: [['#02040a', '#060e1d', '#0e1d34'], ['#02040a', '#050c19', '#0c1a30'], ['#010208', '#030814', '#0a1628']],
  };
  const GROUND = { day: ['#2f4a32', '#1c3b5c'], dusk: ['#2a2430', '#1d2440'], night: ['#05080d', '#040a14'] };

  function draw() {
    if (!S) return;
    const f = focused();
    if (!f || !f.el.canvas) return;
    render(f);
  }

  function render(p) {
    const cv = p.el.canvas, g = p.el.ctx;
    const dpr = dprNow();
    const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const v = p.vis, tr = p.track, d = p.d;
    v.w = w; v.h = h;
    const now = S.vt;
    const dtv = Math.min(64, Math.max(0, now - v.lastVt));
    v.lastVt = now;
    const calm = reduceMotion();
    const alpha = S.paused ? 0 : Math.min(1, S.acc / D().dogfight.tickMs);
    const dist = tr.outcome ? d.dist : v.distPrev + (v.distNow - v.distPrev) * alpha;
    const e = p.endVt === null ? -1 : now - p.endVt;
    const o = tr.outcome;

    // balanço da nave (roll) e abanão
    v.roll += v.rollV * dtv;
    v.rollV *= Math.pow(0.996, dtv);
    v.roll *= Math.pow(0.9985, dtv);
    if (o === 'disengaged' || o === 'craftRetreated') v.roll = Math.min(0.5, v.roll + dtv * 0.0004);
    const sway = calm ? 0 : Math.sin(now * 0.0005 + v.seed) * 0.03;
    const roll = v.roll + sway;
    v.shake *= Math.pow(0.992, dtv);
    const sh = calm ? 0 : v.shake;
    const sx = (rnd() - 0.5) * sh * 2, sy = (rnd() - 0.5) * sh * 2;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(sx, sy);
    const cx = w / 2, cy = h * 0.46;

    // mundo (céu, chão, nuvens, OVNI, projéteis) roda com o balanço
    g.save();
    g.translate(cx, cy);
    g.rotate(roll);
    g.translate(-cx, -cy);
    drawSky(g, w, h, tr, now, v);
    drawClouds(g, w, h, cx, cy, tr, v, dtv, d, o);

    // posição do OVNI
    let R = apparentR(tr.ufoType, dist);
    let ux = cx + Math.sin(now * 0.0007 + v.seed) * w * 0.05;
    let uy = cy - h * 0.06 + Math.sin(now * 0.0011 + v.seed * 2) * h * 0.035;
    let tilt = Math.sin(now * 0.0009) * 0.05;
    let drawU = true;
    const fleeing = !o && DFS().breakingOff(S.G, d.id);
    if (fleeing) uy -= h * 0.05;
    if (o === 'crashed' && !tr.seaCrash) {
      const k = e / 1000;
      uy += k * k * h * 0.9;
      ux += k * w * 0.12;
      tilt = 0.25 + k * 0.9;
      if (e < 1600 && rnd() < 0.6) v.parts.push({ kind: 'smoke', x: ux, y: uy, vx: (rnd() - 0.5) * 0.02, vy: -0.02, t0: now, life: 1200, r: R * (0.4 + rnd() * 0.4), g: 0.001, dark: true });
      if (e < 1400 && rnd() < 0.5) v.parts.push({ kind: 'fire', x: ux + (rnd() - 0.5) * R, y: uy, vx: 0, vy: -0.03, t0: now, life: 300, r: R * 0.35 });
      if (uy - R > h) drawU = false;
    } else if (o === 'destroyed' || (o === 'crashed' && tr.seaCrash)) drawU = e < 90;
    else if (o === 'escaped') {
      const k = Math.min(1, e / 700);
      R *= Math.max(0.02, 1 - k);
      uy -= k * h * 0.25;
      if (k >= 1) drawU = false;
    } else if (o === 'disengaged' || o === 'craftRetreated') {
      ux -= Math.min(1, e / 1200) * w * 0.6;
      R *= Math.max(0.3, 1 - e / 1500);
    }
    v.ux = ux; v.uy = uy; v.uR = R;

    // rasto de dano do OVNI
    const dmgFrac = v.ufoDmg / Math.max(1, tr.ufoHp);
    if (drawU && !o && dmgFrac > 0.18 && rnd() < dmgFrac * 0.5 * (dtv / 16)) {
      v.parts.push({ kind: 'smoke', x: ux + (rnd() - 0.5) * R, y: uy + R * 0.1, vx: (rnd() - 0.5) * 0.01, vy: 0.015, t0: now, life: 900, r: R * (0.25 + rnd() * 0.3), g: 0.0008, dark: true });
    }

    if (drawU) drawUfo(g, tr.ufoType, ux, uy, R, now, tilt, dmgFrac, o === 'crashed');
    drawParts(g, v, now, dtv);
    drawShots(p, g, w, h, cx, cy, dist, now, dtv);
    g.restore();

    drawHud(p, g, w, h, cx, cy, dist, now, R, drawU, o, roll);
    drawNums(g, v, now);
    g.restore();

    // clarões e efeitos de ecrã
    if (v.flash > 0.01) {
      g.fillStyle = 'rgba(' + v.flashCol + ',' + Math.min(0.85, v.flash).toFixed(3) + ')';
      g.fillRect(0, 0, w, h);
      v.flash *= Math.pow(0.988, dtv);
    }
    if (v.red > 0.01) {
      const rg = g.createRadialGradient(cx, h * 0.6, h * 0.2, cx, h * 0.6, Math.max(w, h) * 0.75);
      rg.addColorStop(0, 'rgba(255,40,30,0)');
      rg.addColorStop(1, 'rgba(255,40,30,' + Math.min(0.75, v.red).toFixed(3) + ')');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
      v.red *= Math.pow(0.994, dtv);
    }
    if (o === 'craftDestroyed') drawCraftLoss(g, w, h, v, e - (v.lossAt || 0));
    // vinheta
    const vg = g.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.35, cx, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  function drawSky(g, w, h, tr, now, v) {
    const ph = SKY[tr.phase] ? tr.phase : 'day';
    const band = tr.alt >= 4 ? 2 : tr.alt >= 3 ? 1 : 0;
    const cols = SKY[ph][band];
    const pad = Math.max(w, h) * 0.6;
    const hy = h * (0.7 + band * 0.06); // horizonte desce com a altitude
    const sg = g.createLinearGradient(0, -pad, 0, hy);
    sg.addColorStop(0, cols[0]);
    sg.addColorStop(0.6, cols[1]);
    sg.addColorStop(1, cols[2]);
    g.fillStyle = sg;
    g.fillRect(-pad, -pad, w + pad * 2, hy + pad);
    // estrelas (noite ou grande altitude)
    const starA = ph === 'night' ? 1 : band === 2 ? 0.45 : ph === 'dusk' ? 0.25 : 0;
    if (starA > 0) {
      for (const s of v.stars) {
        const a = s.a * starA * (0.65 + 0.35 * Math.sin(now * 0.002 * s.f + s.x * 9));
        g.fillStyle = 'rgba(235,242,255,' + a.toFixed(3) + ')';
        g.fillRect(w / 2 + s.x * w * 0.75, hy * 0.5 + s.y * hy * 0.75, s.r, s.r);
      }
    }
    // chão / mar com a curvatura da Terra a grande altitude
    const gc = GROUND[ph] || GROUND.day;
    const groundCol = tr.sea ? gc[1] : gc[0];
    const curve = band === 2 ? h * 0.12 : band === 1 ? h * 0.05 : h * 0.015;
    g.beginPath();
    g.moveTo(-pad, hy + curve);
    g.quadraticCurveTo(w / 2, hy - curve, w + pad, hy + curve);
    g.lineTo(w + pad, h + pad);
    g.lineTo(-pad, h + pad);
    g.closePath();
    const gg = g.createLinearGradient(0, hy - curve, 0, h);
    gg.addColorStop(0, ph === 'night' ? '#0d1a2c' : cols[2]);
    gg.addColorStop(0.08, groundCol);
    gg.addColorStop(1, '#03060a');
    g.fillStyle = gg;
    g.fill();
    // névoa no horizonte
    const hz = g.createLinearGradient(0, hy - h * 0.08, 0, hy + h * 0.06);
    hz.addColorStop(0, 'rgba(255,255,255,0)');
    hz.addColorStop(0.5, ph === 'night' ? 'rgba(80,120,170,0.12)' : 'rgba(255,255,255,0.18)');
    hz.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hz;
    g.fillRect(-pad, hy - h * 0.08, w + pad * 2, h * 0.14);
    // luzes de cidades à noite em terra
    if (ph === 'night' && !tr.sea) {
      for (let i = 0; i < 40; i++) {
        const s = v.stars[i];
        const yy = hy + 6 + Math.abs(s.y) * (h - hy);
        const xx = ((s.x * 0.5 + 0.5) * (w + 200) + now * 0.02 * (1 + Math.abs(s.y) * 3)) % (w + 200) - 100;
        g.fillStyle = 'rgba(255,200,120,' + (0.25 + s.a * 0.4).toFixed(2) + ')';
        g.fillRect(xx, yy, 1.4, 1.4);
      }
    }
  }

  function drawClouds(g, w, h, cx, cy, tr, v, dtv, d, o) {
    const night = tr.phase === 'night';
    const closing = v.distNow < v.distPrev ? 1.6 : v.distNow > v.distPrev ? 0.6 : 1;
    const speed = (o ? 0.5 : closing) * 0.00028;
    const scale = Math.max(w, h);
    const order = v.clouds.slice().sort((a, b) => b.z - a.z);
    for (const c of order) {
      c.z -= speed * dtv;
      if (c.z <= 0.04) Object.assign(c, newCloud(tr, 1));
      const k = 0.08 / (c.z + 0.08);
      const x = cx + c.x * scale * k;
      const y = cy + c.y * scale * k * 0.6;
      const r = c.s * scale * k * 0.22;
      if (x < -r * 2 || x > w + r * 2 || y < -r || y > h + r) continue;
      const fade = Math.min(1, (1 - c.z) * 2.5) * Math.min(1, c.z * 6);
      const a = c.a * fade * (night ? 0.35 : 0.7);
      if (a < 0.01) continue;
      const cg = g.createRadialGradient(x, y, 0, x, y, r);
      const col = night ? '120,140,170' : tr.phase === 'dusk' ? '255,200,180' : '245,248,255';
      cg.addColorStop(0, 'rgba(' + col + ',' + a.toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = cg;
      g.save();
      g.translate(x, y);
      g.scale(1.9, 0.6);
      g.translate(-x, -y);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  // OVNI em vista de três quartos (ligeiramente de baixo), com luzes da orla a rodar
  function drawUfo(g, type, x, y, R, now, tilt, dmgFrac, falling) {
    const sh = SHAPES[type] || SHAPES.medium_scout;
    const rx = R * sh.ax, ry = R * 0.3;
    const spin = now * 0.0016;
    g.save();
    g.translate(x, y);
    g.rotate(tilt);
    // brilho dos motores por baixo
    const flick = falling ? 0.15 + rnd() * 0.2 : 0.32 + Math.sin(now * 0.02) * 0.05;
    const eg = g.createRadialGradient(0, ry * 1.2, 0, 0, ry * 1.2, R * 1.1);
    eg.addColorStop(0, 'rgba(255,150,70,' + flick.toFixed(3) + ')');
    eg.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = eg;
    g.beginPath(); g.ellipse(0, ry * 1.2, R * 1.1, R * 0.55, 0, 0, TAU); g.fill();
    const hullG = (y0, y1, a, b) => {
      const lg = g.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, a);
      lg.addColorStop(1, b);
      return lg;
    };
    const line = Math.max(0.6, R * 0.03);
    g.lineJoin = 'round';
    g.strokeStyle = '#0a0a12';
    g.lineWidth = line;
    // espigões (Nave de Terror) e garras (Ceifeira) atrás do casco
    if (sh.spikes) {
      for (const s of [-1, 1]) {
        g.fillStyle = '#4c4560';
        g.beginPath(); g.moveTo(s * rx * 0.6, -ry * 0.2); g.lineTo(s * rx * 1.45, ry * 0.15); g.lineTo(s * rx * 0.65, ry * 0.75); g.closePath(); g.fill(); g.stroke();
      }
    }
    if (sh.claws) {
      for (const s of [-1, 1]) {
        g.fillStyle = '#3d3750';
        g.beginPath(); g.moveTo(s * rx * 0.75, ry * 0.3); g.lineTo(s * rx * 1.15, ry * 1.4); g.lineTo(s * rx * 1.02, ry * 1.6); g.lineTo(s * rx * 0.6, ry * 0.7); g.closePath(); g.fill(); g.stroke();
      }
    }
    // lóbulos de trás
    const lobe = (front) => {
      for (let i = 0; i < sh.lobes; i++) {
        const a = (i / sh.lobes) * TAU + spin * 0.3;
        const sn = Math.sin(a);
        if ((sn > 0) !== front) continue;
        g.fillStyle = front ? '#5a536e' : '#3a3449';
        g.beginPath(); g.ellipse(Math.cos(a) * rx * 0.98, sn * ry * 0.98 + ry * 0.15, R * 0.2, R * 0.13, 0, 0, TAU); g.fill(); g.stroke();
      }
    };
    lobe(false);
    if (sh.box) {
      // Nave de Abastecimento: corpo em caixa
      g.fillStyle = hullG(-ry * 1.5, ry * 2.2, '#9a93ad', '#2c2838');
      g.beginPath();
      if (g.roundRect) g.roundRect(-rx, -ry * 1.4, rx * 2, ry * 3.4, R * 0.12); else g.rect(-rx, -ry * 1.4, rx * 2, ry * 3.4);
      g.fill(); g.stroke();
      g.strokeStyle = 'rgba(15,12,22,0.6)';
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-rx + (rx * 2 * i) / 4, -ry * 1.3); g.lineTo(-rx + (rx * 2 * i) / 4, ry * 1.9); g.stroke(); }
      g.strokeStyle = '#0a0a12';
    } else {
      // casco inferior
      g.fillStyle = hullG(0, ry * 2.2, '#5d5670', '#1d1a26');
      g.beginPath(); g.moveTo(-rx, 0); g.quadraticCurveTo(0, ry * 2.6, rx, 0); g.closePath(); g.fill(); g.stroke();
      // casulos por baixo
      for (let i = 0; i < sh.pods; i++) {
        const px = sh.pods === 1 ? 0 : -rx * 0.5 + (rx * i) / Math.max(1, sh.pods - 1);
        g.fillStyle = '#2f2a3c';
        g.beginPath(); g.ellipse(px, ry * 1.1, R * 0.13, R * 0.09, 0, 0, TAU); g.fill(); g.stroke();
        const pg = g.createRadialGradient(px, ry * 1.18, 0, px, ry * 1.18, R * 0.1);
        pg.addColorStop(0, 'rgba(255,170,80,0.9)');
        pg.addColorStop(1, 'rgba(255,120,40,0)');
        g.fillStyle = pg;
        g.beginPath(); g.arc(px, ry * 1.18, R * 0.1, 0, TAU); g.fill();
      }
      // casco superior
      g.fillStyle = hullG(-ry * 2, ry * 0.4, '#bcb4cf', '#4d4660');
      g.beginPath(); g.moveTo(-rx, 0); g.quadraticCurveTo(0, -ry * 2.1, rx, 0); g.ellipse(0, 0, rx, ry * 0.35, 0, 0, Math.PI); g.closePath(); g.fill(); g.stroke();
      // orla
      g.strokeStyle = 'rgba(210,200,230,0.55)';
      g.lineWidth = Math.max(0.6, R * 0.05);
      g.beginPath(); g.ellipse(0, 0, rx * 0.99, ry * 0.36, 0, 0, Math.PI); g.stroke();
      g.lineWidth = line;
      g.strokeStyle = '#0a0a12';
      if (sh.ring) {
        g.strokeStyle = 'rgba(30,26,40,0.55)';
        g.beginPath(); g.ellipse(0, -ry * 0.55, rx * 0.62, ry * 0.42, 0, Math.PI, TAU); g.stroke();
        g.strokeStyle = '#0a0a12';
      }
    }
    // cúpula
    const dy = sh.box ? -ry * 1.4 : -ry * 0.8;
    const dr = R * sh.dome;
    const dg = g.createLinearGradient(0, dy - dr * 0.7, 0, dy);
    dg.addColorStop(0, '#e6e0f2');
    dg.addColorStop(0.5, '#8d84a6');
    dg.addColorStop(1, '#3d3650');
    g.fillStyle = dg;
    g.beginPath(); g.ellipse(0, dy, dr, dr * 0.62, 0, Math.PI, TAU); g.closePath(); g.fill(); g.stroke();
    // reflexo
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(-dr * 0.3, dy - dr * 0.35, dr * 0.25, dr * 0.1, -0.3, 0, TAU); g.fill();
    lobe(true);
    // luzes da orla (só as da frente)
    const nL = sh.box ? 6 : 10;
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * TAU + spin;
      const sn = Math.sin(a);
      if (sn < 0.05) continue;
      const lx = sh.box ? -rx * 0.85 + (rx * 1.7 * ((i + now * 0.0005) % nL)) / nL : Math.cos(a) * rx * 0.97;
      const ly = sh.box ? ry * 1.6 : sn * ry * 0.33 + ry * 0.05;
      const on = falling ? rnd() < 0.4 : true;
      if (!on) continue;
      const lr = Math.max(1.2, R * 0.075);
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, lr * 2.4);
      lg.addColorStop(0, 'rgba(255,230,170,' + (0.6 + sn * 0.4).toFixed(2) + ')');
      lg.addColorStop(0.35, 'rgba(255,150,60,' + (0.45 * sn + 0.2).toFixed(2) + ')');
      lg.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = lg;
      g.beginPath(); g.arc(lx, ly, lr * 2.4, 0, TAU); g.fill();
    }
    // fogo nos rombos
    if (dmgFrac > 0.35) {
      const fx = Math.sin(spin * 2) * rx * 0.4, fy = -ry * 0.2;
      const fr = R * (0.12 + rnd() * 0.08);
      const fg = g.createRadialGradient(fx, fy, 0, fx, fy, fr * 2);
      fg.addColorStop(0, 'rgba(255,240,180,0.9)');
      fg.addColorStop(0.4, 'rgba(255,120,30,0.7)');
      fg.addColorStop(1, 'rgba(255,60,20,0)');
      g.fillStyle = fg;
      g.beginPath(); g.arc(fx, fy, fr * 2, 0, TAU); g.fill();
    }
    g.restore();
  }

  // posição no ecrã de um ponto entre a nave (z = 0, na asa da arma) e o OVNI (z = dist)
  function muzzle(w, h, cx, cy, slot) {
    return { x: cx + (slot === 0 ? -1 : 1) * w * 0.3, y: h * 0.98 };
  }
  function project(w, h, cx, cy, v, slot, z, dist) {
    const m = muzzle(w, h, cx, cy, slot);
    const ku = depthK(dist);
    const f = dist > 0 ? Math.max(0, Math.min(1.4, z / dist)) : 1;
    const wx = (m.x - cx) * (1 - f) + ((v.ux - cx) / ku) * f;
    const wy = (m.y - cy) * (1 - f) + ((v.uy - cy) / ku) * f;
    const k = depthK(z);
    return { x: cx + wx * k, y: cy + wy * k, k };
  }

  function drawShots(p, g, w, h, cx, cy, dist, now, dtv) {
    const v = p.vis, d = p.d;
    const alpha = S.paused ? 0 : Math.min(1, S.acc / D().dogfight.tickMs);
    const step = D().dogfight.projectile;
    // projéteis em voo (estado da simulação; posição interpolada)
    for (const pr of d.projectiles) {
      const z = pr.pos + step * alpha;
      const pt = project(w, h, cx, cy, v, pr.slot, z, dist);
      let rec = v.proj.get(pr);
      const size = Math.max(1.2, 7 * pt.k);
      if (!rec) { rec = { x: pt.x, y: pt.y, vx: 0, vy: 0, size, trail: [] }; v.proj.set(pr, rec); }
      if (dtv > 0) { rec.vx = (pt.x - rec.x) / dtv; rec.vy = (pt.y - rec.y) / dtv; }
      rec.x = pt.x; rec.y = pt.y; rec.size = size;
      const wd = D().craftWeapons[pr.weapon] || {};
      if (wd.projectile === 'cannon') {
        // traçadoras
        g.strokeStyle = 'rgba(' + WCOL.cannon + ',0.9)';
        g.lineWidth = Math.max(1, size * 0.35);
        g.beginPath(); g.moveTo(pt.x, pt.y); g.lineTo(pt.x - rec.vx * 22, pt.y - rec.vy * 22); g.stroke();
      } else {
        // míssil: rasto de fumo, corpo em movimento e chama
        if (dtv > 0) {
          for (let i = 0; i < 2; i++) {
            const f = rnd();
            v.parts.push({ kind: 'smoke', x: pt.x - rec.vx * dtv * f, y: pt.y - rec.vy * dtv * f, vx: (rnd() - 0.5) * 0.006, vy: -0.003, t0: now, life: 650 + rnd() * 450, r: Math.max(2, size * 0.55), g: 0.0035, trail: true });
          }
        }
        const col = wd.projectile === 'fusion' ? WCOL.fusion : WCOL.missile;
        const fs = Math.max(3.5, size * 1.5);
        g.strokeStyle = 'rgba(255,245,220,0.9)';
        g.lineWidth = Math.max(1.4, size * 0.4);
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(pt.x, pt.y); g.lineTo(pt.x - rec.vx * 26, pt.y - rec.vy * 26); g.stroke();
        g.lineCap = 'butt';
        const fg = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, fs * 1.6);
        fg.addColorStop(0, 'rgba(255,255,235,1)');
        fg.addColorStop(0.3, 'rgba(' + col + ',0.9)');
        fg.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = fg;
        g.beginPath(); g.arc(pt.x, pt.y, fs * 1.6, 0, TAU); g.fill();
      }
    }
    // projéteis que falharam: seguem e apagam-se
    v.ghosts = v.ghosts.filter((gh) => {
      const t = now - gh.t0;
      if (t > gh.life) {
        if (gh.puff) v.parts.push({ kind: 'smoke', x: gh.x, y: gh.y, vx: 0, vy: -0.01, t0: now, life: 600, r: gh.size * 2, g: 0.002 });
        return false;
      }
      gh.x += gh.vx * dtv; gh.y += gh.vy * dtv;
      const a = 1 - t / gh.life;
      g.fillStyle = 'rgba(' + (gh.kind === 'cannon' ? WCOL.cannon : WCOL.missile) + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(gh.x, gh.y, Math.max(1, gh.size * 0.7 * a), 0, TAU); g.fill();
      return true;
    });
    // feixes (laser/plasma)
    v.beams = v.beams.filter((b) => {
      const t = now - b.t0;
      if (t > b.life) return false;
      const m = muzzle(w, h, cx, cy, b.slot);
      const tx = b.hit ? v.ux : v.ux + b.off * v.uR * 2.2;
      const ty = b.hit ? v.uy : v.uy - v.uR * 0.4;
      const a = 1 - t / b.life;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(' + b.col + ',' + (0.35 * a).toFixed(3) + ')';
      g.lineWidth = 9 * a + 2;
      g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(tx, ty); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,' + (0.9 * a).toFixed(3) + ')';
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(tx, ty); g.stroke();
      g.restore();
      return true;
    });
    // tiros do OVNI (plasma) em direção à câmara
    v.bolts = v.bolts.filter((b) => {
      const t = now - b.t0;
      const f = Math.min(1, t / b.dur);
      if (f >= 1) return t < b.dur + 60;
      const z = b.z0 * (1 - f);
      const k = depthK(z) / depthK(b.z0);
      const ex = b.hit ? cx + b.side * w * 0.08 : cx + b.side * w * 0.9;
      const ey = b.hit ? h * 0.72 : h * 0.55;
      const e2 = f * f;
      const x = v.ux + (ex - v.ux) * e2, y = v.uy + (ey - v.uy) * e2;
      const r = Math.max(2, v.uR * 0.18 * Math.min(14, k));
      const bg = g.createRadialGradient(x, y, 0, x, y, r * 2.6);
      bg.addColorStop(0, 'rgba(235,255,240,1)');
      bg.addColorStop(0.3, 'rgba(110,255,170,0.85)');
      bg.addColorStop(1, 'rgba(60,255,140,0)');
      g.fillStyle = bg;
      g.beginPath(); g.arc(x, y, r * 2.6, 0, TAU); g.fill();
      return true;
    });
  }

  // chegada dos tiros do OVNI (fora do desenho: também conta com o painel minimizado)
  function arriveBolts(p) {
    const v = p.vis, now = S.vt;
    const w = v.w || 700, h = v.h || 260, cx = w / 2;
    for (const b of v.bolts) {
      if (b.done || now - b.t0 < b.dur) continue;
      b.done = true;
      if (!b.hit) { sfx('ui_select', { rate: 0.5, vol: 0.4 }); continue; }
      v.craftHp = Math.max(0, v.craftHp - b.dmg);
      v.shake = Math.max(v.shake, 6 + Math.min(10, b.dmg / 4));
      v.red = Math.max(v.red, 0.35 + Math.min(0.4, b.dmg / 60));
      v.nums.push({ x: cx + b.side * w * 0.12, y: h * 0.78, text: '−' + b.dmg, col: '#ff6b5e', t0: now, life: 1100, big: true });
      sfx('dogfight_hit');
      sfx('explosion_small', { vol: 0.7 });
      if (p.el.root) { p.el.root.classList.remove('hit'); void p.el.root.offsetWidth; p.el.root.classList.add('hit'); }
      if (p.minimised) flashChip(p);
    }
    if (p.minimised) v.bolts = v.bolts.filter((b) => !b.done);
  }

  function drawParts(g, v, now, dtv) {
    const keep = [];
    for (const q of v.parts) {
      const t = now - q.t0;
      if (t > q.life) continue;
      keep.push(q);
      const a = 1 - t / q.life;
      if (q.vx !== undefined) { q.x += q.vx * dtv; q.y += q.vy * dtv; }
      switch (q.kind) {
        case 'smoke': {
          const r = q.r * (1 + t * (q.g || 0.001));
          const c = q.dark ? '40,36,44' : q.trail ? '236,238,242' : '200,205,215';
          const sg = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
          sg.addColorStop(0, 'rgba(' + c + ',' + ((q.trail ? 0.6 : 0.45) * a).toFixed(3) + ')');
          sg.addColorStop(1, 'rgba(' + c + ',0)');
          g.fillStyle = sg;
          g.beginPath(); g.arc(q.x, q.y, r, 0, TAU); g.fill();
          break;
        }
        case 'fire': {
          const fg = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
          fg.addColorStop(0, 'rgba(255,240,180,' + a.toFixed(3) + ')');
          fg.addColorStop(1, 'rgba(255,90,20,0)');
          g.fillStyle = fg;
          g.beginPath(); g.arc(q.x, q.y, q.r, 0, TAU); g.fill();
          break;
        }
        case 'spark':
          q.vy += 0.0003 * dtv;
          g.fillStyle = 'rgba(255,' + (180 + Math.round(70 * a)) + ',90,' + a.toFixed(3) + ')';
          g.fillRect(q.x, q.y, q.r, q.r);
          break;
        case 'debris':
          q.vy += 0.0004 * dtv;
          q.rot += q.vr * dtv;
          g.save(); g.translate(q.x, q.y); g.rotate(q.rot);
          g.fillStyle = 'rgba(70,64,86,' + a.toFixed(3) + ')';
          g.fillRect(-q.r, -q.r * 0.5, q.r * 2, q.r);
          g.restore();
          break;
        case 'flash': {
          const fg = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
          fg.addColorStop(0, 'rgba(255,255,240,' + a.toFixed(3) + ')');
          fg.addColorStop(0.4, 'rgba(255,190,90,' + (0.7 * a).toFixed(3) + ')');
          fg.addColorStop(1, 'rgba(255,120,40,0)');
          g.fillStyle = fg;
          g.beginPath(); g.arc(q.x, q.y, q.r, 0, TAU); g.fill();
          break;
        }
        case 'ring':
          g.strokeStyle = 'rgba(255,220,170,' + (0.7 * a).toFixed(3) + ')';
          g.lineWidth = 2 * a + 0.5;
          g.beginPath(); g.arc(q.x, q.y, q.r * (0.4 + (1 - a) * 1.4), 0, TAU); g.stroke();
          break;
        default: break;
      }
    }
    v.parts = keep;
    if (v.parts.length > 600) v.parts.splice(0, v.parts.length - 600);
  }

  // HUD do intercetor: mira fixa, escala de inclinação, retículo no alvo, moldura do cockpit
  function drawHud(p, g, w, h, cx, cy, dist, now, R, drawU, o, roll) {
    const G = S.G, d = p.d, tr = p.track;
    const teal = 'rgba(95,240,200,';
    g.lineWidth = 1.2;
    // mira central
    g.strokeStyle = teal + '0.55)';
    g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.beginPath(); g.moveTo(cx + dx * 14, cy + dy * 14); g.lineTo(cx + dx * 24, cy + dy * 24); g.stroke();
    }
    // escala de inclinação (roda com o balanço)
    g.save();
    g.translate(cx, cy); g.rotate(roll);
    g.strokeStyle = teal + '0.28)';
    for (let i = -2; i <= 2; i++) {
      if (!i) continue;
      const y = i * h * 0.12;
      g.beginPath(); g.moveTo(-w * 0.2, y); g.lineTo(-w * 0.14, y); g.moveTo(w * 0.14, y); g.lineTo(w * 0.2, y); g.stroke();
    }
    g.strokeStyle = teal + '0.45)';
    g.beginPath(); g.moveTo(-w * 0.26, 0); g.lineTo(-w * 0.16, 0); g.moveTo(w * 0.16, 0); g.lineTo(w * 0.26, 0); g.stroke();
    g.restore();
    // retículo no alvo
    if (drawU && !o) {
      let lock = false;
      const craft = C().findCraft(G, d.craftId);
      const mdef = D().dogfight.modes[d.mode];
      if (craft && mdef && mdef.fire) {
        for (const ws of d.weapons) {
          const wpn = craft.weapons[ws.slot];
          if (wpn && ws.enabled && hasAmmo(wpn) && d.dist <= D().craftWeapons[wpn.type].range * D().dogfight.rangeMul) lock = true;
        }
      }
      const col = lock ? 'rgba(95,224,138,' : 'rgba(255,181,61,';
      const bx = Math.max(R * 1.35 * ((SHAPES[tr.ufoType] || {}).ax || 1), 16) + 6;
      const by = Math.max(R * 0.8, 14) + 6;
      const ux = p.vis.ux, uy = p.vis.uy;
      const pulse = lock ? 1 : 0.75 + Math.sin(now * 0.008) * 0.25;
      g.strokeStyle = col + (0.9 * pulse).toFixed(3) + ')';
      g.lineWidth = 1.6;
      const c = Math.min(bx, by) * 0.45;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        g.beginPath();
        g.moveTo(ux + sx * bx, uy + sy * by - sy * c);
        g.lineTo(ux + sx * bx, uy + sy * by);
        g.lineTo(ux + sx * bx - sx * c, uy + sy * by);
        g.stroke();
      }
      g.font = '800 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      g.fillStyle = col + '0.95)';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(T(lock ? 'df.hud.lock' : 'df.hud.track'), ux, uy + by + 5);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = '700 11px ui-monospace, Menlo, monospace';
      g.fillText(String(Math.round(dist)), ux + bx + 6, uy - by + 6);
      if (lock) {
        g.strokeStyle = col + '0.35)';
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(ux, uy); g.stroke();
      }
    }
    // moldura do cockpit (cantos inferiores) e pontos das armas
    g.fillStyle = 'rgba(6,10,16,0.85)';
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.8); g.lineTo(w * 0.1, h * 0.9); g.lineTo(w * 0.24, h); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(w, h); g.lineTo(w, h * 0.8); g.lineTo(w * 0.9, h * 0.9); g.lineTo(w * 0.76, h); g.closePath(); g.fill();
    for (const m of p.vis.parts) {
      if (m.kind !== 'muzzle') continue;
      const t = now - m.t0;
      if (t > m.life) continue;
      const mz = muzzle(w, h, cx, cy, m.slot);
      const a = 1 - t / m.life;
      const mg = g.createRadialGradient(mz.x, mz.y, 0, mz.x, mz.y, 26);
      mg.addColorStop(0, 'rgba(255,240,200,' + a.toFixed(3) + ')');
      mg.addColorStop(1, 'rgba(255,170,60,0)');
      g.fillStyle = mg;
      g.beginPath(); g.arc(mz.x, mz.y, 26, 0, TAU); g.fill();
    }
  }

  function drawNums(g, v, now) {
    v.nums = v.nums.filter((n) => {
      const t = now - n.t0;
      if (t > n.life) return false;
      const a = Math.min(1, 2.2 * (1 - t / n.life));
      const y = n.y - (t / n.life) * 30;
      const size = n.small ? 11 : n.big ? 20 : 15;
      g.font = '800 ' + size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,' + (0.7 * a).toFixed(3) + ')';
      g.strokeText(n.text, n.x, y);
      g.fillStyle = n.col;
      g.globalAlpha = a;
      g.fillText(n.text, n.x, y);
      g.globalAlpha = 1;
      return true;
    });
  }

  // perda da nave: vidro estalado, estática e escurecer
  function drawCraftLoss(g, w, h, v, e) {
    if (e < 0) return;
    const k = Math.min(1, e / 900);
    if (!v.cracks) {
      v.cracks = [];
      const ox = w * (0.35 + rnd() * 0.3), oy = h * (0.4 + rnd() * 0.3);
      for (let i = 0; i < 9; i++) {
        const a = rnd() * TAU;
        const pts = [[ox, oy]];
        let x = ox, y = oy;
        for (let s = 0; s < 5; s++) { x += Math.cos(a + (rnd() - 0.5) * 0.8) * w * 0.08; y += Math.sin(a + (rnd() - 0.5) * 0.8) * h * 0.12; pts.push([x, y]); }
        v.cracks.push(pts);
      }
      v.red = 0.8;
      v.shake = 14;
      sfx('explosion_large');
    }
    g.strokeStyle = 'rgba(230,240,255,' + (0.7 * (1 - k * 0.5)).toFixed(3) + ')';
    g.lineWidth = 1.2;
    for (const pts of v.cracks) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    for (let i = 0; i < 160 * k; i++) {
      g.fillStyle = 'rgba(200,210,220,' + (rnd() * 0.25 * k).toFixed(3) + ')';
      g.fillRect(rnd() * w, rnd() * h, 2, 1);
    }
    g.fillStyle = 'rgba(0,0,0,' + (0.75 * k).toFixed(3) + ')';
    g.fillRect(0, 0, w, h);
  }

  // ---- entrada ------------------------------------------------------------------------------------------------
  function below() {
    if (!S) return null;
    const st = OV.Scenes.stack;
    const i = st.indexOf(S.scene);
    return i > 0 ? st[i - 1] : null;
  }
  function forward(ev) {
    const b = below();
    return b && b.onInput ? !!b.onInput(ev) : false;
  }
  function onInput(ev) {
    if (!S) return false;
    const f = focused();
    if (ev.kind !== 'key') return !f && CAMERA_KINDS[ev.kind] ? forward(ev) : false;
    const k = ev.key;
    if (ev.mods && (ev.mods.meta || ev.mods.ctrl || ev.mods.alt)) return false;
    // pergunta dos mísseis aberta: só as respostas contam (Espaço/P também continuam, sem mudar nada)
    if (f && f.ask) {
      if (ev.repeat) return true;
      if (k === 'Enter' || k === 'q' || k === 'Q') { answerMissiles(f, true); return true; }
      if (k === 'Escape' || k === 'n' || k === 'N' || k === ' ' || k === 'p' || k === 'P') { answerMissiles(f, false); return true; }
      return !CAMERA_KEYS[k];
    }
    if (k === ' ' || k === 'p' || k === 'P') { if (!ev.repeat) togglePause(); return true; }
    if (k === 'Tab') { cycle(); return true; }
    if (k === 'm' || k === 'M') { if (!ev.repeat) toggle(); return true; }
    if (!f) {
      if (CAMERA_KEYS[k]) return forward(ev);
      // tudo minimizado: Esc reabre a interceção; as teclas do Geoscape explicam porque não respondem
      if (k === 'Escape') { if (!ev.repeat) restore(); return true; }
      if (GEO_KEYS.test(k) || k === 'Enter') {
        const t = Date.now();
        if (!ev.repeat && t - (S.keyToastT || 0) > 1500) { S.keyToastT = t; OV.Dom.toast(T('df.minimisedKeys'), null, 'info'); }
        return true;
      }
      return false;
    }
    if (k === 'Escape') { if (!ev.repeat) minimise(f.id); return true; }
    if (k === 'Enter') {
      if (f.track.outcome && f.bannerShown && !ev.repeat) closePanel(f);
      return true;
    }
    const mi = MODE_KEYS.indexOf(k);
    if (mi >= 0) { if (!ev.repeat) setMode(f, D().dogfight.modeOrder[mi]); return true; }
    if (k === 'q' || k === 'Q') { if (!ev.repeat) toggleWeapon(f, 0); return true; }
    if (k === 'e' || k === 'E') { if (!ev.repeat) toggleWeapon(f, 1); return true; }
    return false;
  }

  // ---- cena ---------------------------------------------------------------------------------------------------
  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.dogfight = function (params) {
    const prm = params || {};
    const sc = {
      id: 'dogfight',
      isScreen: false,
      enter() {
        if (S) teardown(true);
        const hud = OV.Dom.$('hud') || document.body;
        const stage = el('div', { class: 'df-stage' });
        const dock = el('div', { class: 'df-dock', role: 'toolbar', 'aria-label': T('df.title') });
        const root = el('div', { class: 'df-root' }, el('div', { class: 'df-dim' }), stage, dock);
        hud.appendChild(root);
        S = {
          G: prm.G, scene: sc, root, stage, dock, panels: [], opts: prm.opts || {}, paused: false, acc: 0, vt: 0,
          results: [], prevMood: null, popPending: false, engineT: -1e9, hasEngine: hasSfx('dogfight_engine'),
        };
        try {
          if (OV.audio && OV.audio.moods && OV.audio.moods().indexOf('interception') >= 0) {
            S.prevMood = OV.audio.status ? OV.audio.status().mood : null;
            OV.audio.music('interception');
          }
        } catch (e) { /* som opcional */ }
        const ids = prm.dogfightIds && prm.dogfightIds.length ? prm.dogfightIds : (prm.G.dogfights || []).map((x) => x.id);
        for (const id of ids) addPanel(id, prm.opts);
        if (!S.panels.length) setTimeout(() => { if (S && S.scene === sc && !S.panels.length) finishOverlay(); }, 0);
      },
      exit() { if (S && S.scene === sc) teardown(false); },
      pause() { if (S) for (const p of S.panels) refreshPanel(p); },
      resume() {
        if (!S || S.scene !== sc) { if (OV.Scenes.top() === sc) OV.Scenes.pop(); return; }
        if (S && S.popPending && OV.Scenes.top() === sc) { S.popPending = false; OV.Scenes.pop({ dogfight: S.results.slice() }); }
      },
      think,
      draw,
      onInput,
      onResize() {},
      onHidden() { if (S && !S.paused) setPaused(true); },
    };
    return sc;
  };

  // sai da cena: combates ainda a decorrer terminam (desengate) e os eventos seguem para o Geoscape
  function teardown(silent) {
    const st = S;
    if (!st) return;
    for (const p of st.panels.slice()) closePanelSilently(p);
    const sums = st.results.slice();
    try { if (st.prevMood && OV.audio && OV.audio.music) OV.audio.music(st.prevMood); } catch (e) { /* som opcional */ }
    if (st.root) st.root.remove();
    OV.Dom.hideTooltip();
    S = null;
    if (!silent && st.opts && typeof st.opts.onClose === 'function') {
      try { st.opts.onClose(sums); } catch (e) { console.error(e); }
    }
  }
  function closePanelSilently(p) {
    // como closePanel, mas sem sair da cena (já a sair)
    if (!p.track.outcome && C().findDogfight(S.G, p.id)) {
      const n0 = S.G.events.length;
      DFS().finish(S.G, p.id);
      p.track.outcome = p.d.outcome || 'disengaged';
      absorb(p.track, S.G, p.d, []);
      absorbGeo(p.track, S.G.events.splice(n0));
    } else if (!p.track.outcome) p.track.outcome = p.d.outcome || 'disengaged';
    const sm = p.summary || summary(p.track);
    S.panels.splice(S.panels.indexOf(p), 1);
    S.results.push(sm);
    deliver(p, sm);
  }

  // ---- API pública ------------------------------------------------------------------------------------------------
  function open(G, dogfightId, opts) {
    if (!G || !Array.isArray(G.dogfights)) return false;
    if (S && S.G !== G) { close(); if (S) teardown(false); }
    if (!S) {
      const ids = dogfightId ? [dogfightId] : G.dogfights.filter((x) => !x.over).map((x) => x.id);
      if (!ids.some((id) => C().findDogfight(G, id))) return false;
      OV.Scenes.push('dogfight', { G, dogfightIds: ids, opts: opts || {} });
      return !!S;
    }
    if (opts && !S.opts.onEvents && !S.opts.onEnd && !S.opts.onClose) S.opts = opts;
    const ids = dogfightId ? [dogfightId] : G.dogfights.map((x) => x.id);
    let any = false;
    for (const id of ids) if (addPanel(id, opts)) any = true;
    return any || !!(dogfightId && panelOf(dogfightId));
  }
  function close(dogfightId) {
    if (!S) return false;
    const list = dogfightId ? [panelOf(dogfightId)].filter(Boolean) : S.panels.slice();
    for (const p of list) closePanel(p);
    return list.length > 0;
  }
  const active = () => (S ? S.panels.map((p) => ({ dogfightId: p.id, craftId: p.track.craftId, ufoId: p.track.ufoId, minimised: p.minimised, over: !!p.track.outcome, outcome: p.track.outcome })) : []);
  const isOpen = (id) => (S ? (id ? !!panelOf(id) : S.panels.length > 0) : false);

  OV.DogfightUI = {
    open, close, minimise, restore, toggle, active, isOpen,
    isPaused: () => !!(S && S.paused),
    setPaused,
    model: { ticksFor, newTrack, absorb, absorbGeo, status, weaponInfo, summary, outcomeTone, apparentR, depthK, craftLabel, ufoLabel, startMode, missileTip, SHAPES, MAX_TICKS, OUTCOME_MS },
  };
})(globalThis.OV || (globalThis.OV = {}));
