/* Estado de jogo, ciclo de simulação a passo fixo (60 Hz) e condições de vitória/derrota */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;

  const mkQueue = () => ({ items: [], progress: 0, paid: 0, ready: false, stalled: false });

  CG.createGame = function (opts) {
    const seed = (opts.seed >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    const nPlayers = 1 + opts.opponents.length;
    const size = CG.MAP_SIZES[opts.mapSize || 'medium'].size;
    const map = new CG.GameMap({ size, seed, theme: opts.theme });
    const G = {
      opts, seed, map, rng: CG.RNG(seed ^ 0xa5a5a5a5), time: 0, tick: 0,
      players: [], entities: [], byId: new Map(), nextId: 1, dirty: false,
      projectiles: [], particles: [], decals: [], strikes: [], reveals: [],
      spatial: new CG.SpatialHash(map.pxW, map.pxH, 128),
      path: new CG.Pathfinder(map),
      claims: new Uint8Array(map.n),
      human: 0, sel: [], groups: {}, mode: null, msgTimes: {}, lastAlert: null,
      cam: { x: 0, y: 0, zoom: 1, vw: 1280, vh: 800 }, shakeAmt: 0,
      paused: false, speed: opts.speed || 1, over: false, result: null, fogDirty: true,
    };
    const starts = map.startsFor(nPlayers);
    const facIds = Object.keys(CG.FACTIONS);
    const rng = CG.RNG(seed ^ 0x1234567);
    for (let i = 0; i < nPlayers; i++) {
      // com opts.humanAI o jogador 0 também é controlado pela IA (simulações IA-contra-IA)
      const o = i === 0 ? { faction: opts.faction, difficulty: opts.humanAI ? opts.humanDifficulty || 'normal' : null } : opts.opponents[i - 1];
      let fid = o.faction;
      if (!CG.FACTIONS[fid]) fid = facIds[rng.int(facIds.length)];
      const diff = o.difficulty ? CG.DIFFICULTY[o.difficulty] : null;
      const p = {
        id: i, fid, faction: CG.FACTIONS[fid], color: CG.colorOf(i), isAI: i > 0 || !!opts.humanAI, diffId: o.difficulty, diff,
        name: i === 0 ? 'Comandante' : 'IA ' + i + ' (' + (diff ? diff.name : '') + ')',
        credits: opts.credits || 5000, powerProd: 0, powerUse: 0, lowPower: false, hasRadar: false,
        queues: { bld: mkQueue(), inf: mkQueue(), veh: mkQueue(), air: mkQueue() }, prodRR: { bld: 0, inf: 0, veh: 0, air: 0 },
        powers: {}, owned: {}, unitCount: 0, defeated: false, start: starts[i],
        stats: { unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, bldBuilt: 0, bldLost: 0, bldKilled: 0, harvested: 0, powers: 0 },
        vis: new Uint8Array(map.n), explored: new Uint8Array(map.n),
        incomeMult: diff ? diff.income : 1, buildMult: diff ? diff.build : 1, ai: null,
      };
      for (const pid of p.faction.powers) p.powers[pid] = { charge: 0, avail: false };
      G.players.push(p);
    }
    for (const p of G.players) {
      const s = p.start;
      CG.spawnBuilding(G, 'conyard', p.id, s.x - 1, s.y - 1, { instant: true });
      const roster = p.faction.units;
      const inf = roster[0], light = roster[4];
      const dir = s.y < map.h / 2 ? 1 : -1;
      const ly = s.y + 3 * dir;
      for (let k = 0; k < 4; k++) {
        const f = map.nearestFree(s.x - 1 + k, ly, 4);
        if (f) CG.spawnUnit(G, inf, p.id, f.x * T + T / 2, f.y * T + T / 2, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      const fv = map.nearestFree(s.x + 3 * (s.x < map.w / 2 ? 1 : -1), s.y, 4);
      if (fv) CG.spawnUnit(G, light, p.id, fv.x * T + T / 2, fv.y * T + T / 2);
      CG.refreshPlayer(G, p);
    }
    for (const d of map.derricks) CG.spawnBuilding(G, 'derrick', CG.NEUTRAL, d.x, d.y, { instant: true });
    for (const p of G.players) if (p.isAI) p.ai = new CG.AI(G, p);
    rebuildSpatial(G);
    CG.updateFog(G);
    const hs = G.players[0].start;
    G.cam.x = hs.x * T - G.cam.vw / 2;
    G.cam.y = hs.y * T - G.cam.vh / 2;
    return G;
  };

  function rebuildSpatial(G) {
    const sp = G.spatial;
    sp.clear();
    for (const e of G.entities) {
      if (!e.alive) continue;
      if (e.kind === 'bld') sp.insertRect(e, e.x0, e.y0, e.x1 - 1, e.y1 - 1);
      else sp.insert(e);
    }
  }

  CG.update = function (G, dt) {
    G.time += dt;
    G.tick++;
    const ents = G.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      e.px = e.x;
      e.py = e.y;
      e.pangle = e.angle;
      e.pturret = e.turret;
    }
    rebuildSpatial(G);
    for (const p of G.players) {
      if (p.defeated) continue;
      if (G.tick % 15 === p.id) CG.refreshPlayer(G, p);
      CG.updateProduction(G, p, dt);
      CG.updatePowers(G, p, dt);
      if (p.ai) p.ai.update(dt);
    }
    G.path.process(28);
    const n = ents.length;
    for (let i = 0; i < n; i++) {
      const e = ents[i];
      if (!e.alive) continue;
      if (e.kind === 'unit') CG.updateUnit(G, e, dt);
      else CG.updateBuilding(G, e, dt);
    }
    CG.updateProjectiles(G, dt);
    CG.updateStrikes(G, dt);
    CG.updateParticles(G, dt);
    if (G.reveals.length) {
      for (const r of G.reveals) r.t -= dt;
      G.reveals = G.reveals.filter((r) => r.t > 0);
    }
    if (G.tick % 300 === 0) G.map.regrow(G.rng);
    if (G.tick % 6 === 0) CG.updateFog(G);
    G.shakeAmt = Math.max(0, G.shakeAmt - G.shakeAmt * 7 * dt - 0.5 * dt);
    CG.removeDead(G);
    if (G.tick % 30 === 0) checkEnd(G);
  };

  function checkEnd(G) {
    for (const p of G.players) {
      if (p.defeated) continue;
      let alive = false;
      for (const e of G.entities) {
        if (!e.alive || e.owner !== p.id) continue;
        if ((e.kind === 'bld' && !e.def.noCount) || (e.kind === 'unit' && e.def.mcv)) { alive = true; break; }
      }
      if (alive) continue;
      p.defeated = true;
      p.queues.bld.items.length = 0;
      for (const k of ['inf', 'veh', 'air']) p.queues[k].items.length = 0;
      for (const e of G.entities) {
        if (!e.alive || e.owner !== p.id) continue;
        if (e.kind === 'unit') CG.kill(G, e, -1);
        else if (e.def.noCount) { e.owner = CG.NEUTRAL; e.target = 0; }
      }
      for (const q of G.players) {
        if (q.id === p.id) continue;
        CG.notify(G, q.id, p.id === G.human ? 'Fomos derrotados' : 'Inimigo eliminado: ' + p.faction.name, { kind: 'alert', cooldown: 0, sound: 'alarm' });
      }
    }
    const human = G.players[G.human];
    const others = G.players.filter((p) => p.id !== G.human);
    if (!G.over) {
      if (human.defeated) {
        G.over = true;
        G.result = 'defeat';
      } else if (others.length && others.every((p) => p.defeated)) {
        G.over = true;
        G.result = 'victory';
      }
      if (G.over) {
        G.overAt = G.time;
        if (CG.audio) CG.audio.play(G.result === 'victory' ? 'victory' : 'defeat');
        if (CG.audio) CG.audio.speak(G.result === 'victory' ? 'Missão cumprida' : 'Missão falhada');
      }
    }
  }

  // ---------------------------------------------------------------- ciclo principal (navegador)
  let raf = 0, last = 0, acc = 0;
  CG.start = function (opts) {
    CG.stop();
    const G = CG.createGame(opts);
    CG.G = G;
    if (CG.render) CG.render.attach(G);
    if (CG.ui) CG.ui.onStart(G);
    if (CG.input) CG.input.attach();
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
    return G;
  };
  CG.stop = function () {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    CG.G = null;
  };

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const G = CG.G;
    if (!G) return;
    let dtReal = (now - last) / 1000;
    last = now;
    if (dtReal > 0.25) dtReal = 0.25;
    const t0 = performance.now();
    if (!G.paused) {
      acc += dtReal * G.speed;
      let steps = 0;
      while (acc >= CG.DT && steps < 10) {
        CG.update(G, CG.DT);
        acc -= CG.DT;
        steps++;
      }
      if (steps >= 10) acc = 0;
    }
    const t1 = performance.now();
    if (CG.input) CG.input.frame(G, dtReal);
    if (CG.render) CG.render.draw(G, G.paused ? 1 : acc / CG.DT, dtReal);
    if (CG.ui) CG.ui.frame(G, dtReal);
    const t2 = performance.now();
    G.perf = G.perf || { sim: 0, draw: 0, fps: 60 };
    G.perf.sim = G.perf.sim * 0.95 + (t1 - t0) * 0.05;
    G.perf.draw = G.perf.draw * 0.95 + (t2 - t1) * 0.05;
    if (dtReal > 0) G.perf.fps = G.perf.fps * 0.95 + (1 / dtReal) * 0.05;
  }
})();
