/* Apresentador do Battlescape (DESIGN.md §10): esgota um gerador de ações evento a evento e anima cada evento
   visível — passos (240 ms, interpolados tile a tile com fotogramas de marcha), rotações (60 ms/45°), portas, tiros
   (clarão, traçadora/laser/plasma/foguete), arremessos em parábola, explosões (anéis, destroços, tremor, tiles a
   cair em anel), mortes (queda), avistamentos («!» vermelho + som + pausa), reações, pânico/berserk, psi, danos,
   fogo e fumo — com durações ÷ velocidade (X-COM e alienígenas separadas, OV.Game.settings). Eventos ocultos
   passam em tempo zero; no turno alienígena mostra «Movimento Oculto…» enquanto correm. A câmara desliza até aos
   eventos visíveis fora do ecrã. Nunca altera B: partículas em OV.FX, poses/posições intermédias em ctx.anim
   (o renderizador lê view.anim = ctx.anim).

   OV.Presenter.play(B, gen, ctx) → Promise<último evento> (as reproduções ficam em fila; nunca em paralelo)
     ctx = {view (cam, w, h, viewZ), side?, anim?, followId?: () → unitId, hooks?: {
              hidden(on), banner(text|null, kind), event(ev), viewZ(z), blips(list, unitId), sound(name, opts),
              log(ev) (todos os eventos, visíveis ou não, antes de animar: registo de mensagens)}}
     ctx.anim = {units: {[id]: {fx, fy, fz, dir, pose, frame, flash, show}}, hidden: Set, hideItems: Set}
   OV.Presenter.playing ; fast (×8 até ao fim da reprodução) ; hurry() ; timeScale() ; wait(ms) ; tween(ms, fn)
   OV.Presenter.lastResult = valor devolvido pelo último gerador ; side = lado cuja velocidade está em uso
   OV.Presenter.reduceMotion (posto pela interface): câmara sem deslizar. Textos no feminino (chave + '.f') para
   soldadas. Movimento oculto: fatias de cálculo maiores entre fotogramas (o turno alienígena acaba mais cedo). */
(function (OV) {
  'use strict';

  // durações a velocidade 1 (ms)
  const DUR = {
    step: 240, lift: 420, stairs: 300, turn: 60, kneel: 140, door: 220, ufoDoor: 300, death: 520, spotted: 350,
    reaction: 280, explosion: 420, tileBudget: 380, tileGap: 34, fall: 260, banner: 900, morale: 1000, psi: 650,
    between: 70, reload: 260, prime: 220, medikit: 380, melee: 240, pan: 280, damage: 140, shotHold: 200, endBeat: 120,
  };
  const TPS = { tracer: 30, plasma: 18, rocket: 11, thrown: 12 };
  const FLOOR_SFX = { earth: 'step_earth', wood: 'step_wood', metal: 'step_metal', alloy: 'step_alloy', brick: 'step_earth', glass: 'step_metal' };
  const DEATH_SFX = {
    sectoid: 'alien_death_sectoid', floater: 'alien_death_floater', snakeman: 'alien_death_snakeman', muton: 'alien_death_muton',
    ethereal: 'alien_death_ethereal', chryssalid: 'alien_death_chryssalid', cyberdisc: 'alien_death_mech', sectopod: 'alien_death_mech',
    reaper: 'alien_death_muton',
  };
  // eventos que justificam esconder o aviso «Movimento Oculto…»
  const SHOWY = { step: 1, shot: 1, throw: 1, explosion: 1, death: 1, spotted: 1, reaction: 1, door: 1, damage: 1, psi: 1, melee: 1, fall: 1, morale: 1 };

  const P = {
    playing: false, fast: false, side: 'xcom', lastResult: null, clock: 0,
    DUR,
  };

  // ---- relógio próprio (escalado pela velocidade) ---------------------------------------------------------
  const timers = [];
  const tweens = [];
  let raf = 0, lastReal = 0;
  const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function settings() {
    return (OV.Game && OV.Game.settings) || {};
  }
  function timeScale() {
    const s = settings();
    const base = P.side === 'xcom' ? +s.speedXcom || 1 : +s.speedAlien || 2;
    return Math.max(0.25, base) * (P.fast ? 8 : 1);
  }
  function pump(t) {
    raf = 0;
    const dt = Math.min(100, Math.max(0, t - lastReal));
    lastReal = t;
    P.clock += dt * timeScale();
    for (const tw of tweens.slice()) {
      const p = tw.dur > 0 ? Math.min(1, (P.clock - tw.t0) / tw.dur) : 1;
      try { tw.fn(p); } catch (e) { console.error(e); }
      if (p >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        tw.res();
      }
    }
    for (let k = timers.length - 1; k >= 0; k--) {
      if (P.clock >= timers[k].at) {
        const tm = timers[k];
        timers.splice(k, 1);
        tm.res();
      }
    }
    if (timers.length || tweens.length) schedule();
  }
  function schedule() {
    if (raf) return;
    lastReal = realNow();
    raf = requestAnimationFrame(pump);
  }
  // espera ms de tempo de jogo (dividido pela velocidade)
  function wait(ms) {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((res) => {
      timers.push({ at: P.clock + ms, res });
      schedule();
    });
  }
  // interpolação 0..1 durante ms (fn chamada em cada fotograma)
  function tween(ms, fn) {
    fn(0);
    if (!(ms > 0)) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((res) => {
      tweens.push({ t0: P.clock, dur: ms, fn, res });
      schedule();
    });
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // ---- utilitários --------------------------------------------------------------------------------------
  function xyz(B, i) {
    const m = B.map, plane = m.w * m.h;
    const z = (i / plane) | 0, r = i - z * plane;
    return [r % m.w, (r / m.w) | 0, z];
  }
  const unit = (B, id) => (id === null || id === undefined ? null : OV.BUnits.findUnit(B, id));
  const name = (u) => (u ? u.name || (u.nameKey ? OV.T(u.nameKey) : OV.T('hud.unit.alien')) : '');
  // variante no feminino quando existe («ferida», «morta», «paralisada»)
  const gk = (key, u) => (u && u.female && OV.T.has(key + '.f') ? key + '.f' : key);
  const isPlayer = (u) => !!u && u.side === 'xcom';
  function tileVoxel(B, i, h) {
    const [x, y, z] = xyz(B, i);
    return [x * 16 + 8, y * 16 + 8, z * 24 + (h || 0)];
  }
  // voxel do meio do corpo (ou da cabeça) de uma unidade
  function unitVoxel(u, part) {
    const s = u.size || 1;
    const h = (u.kneel ? u.kneelHeight : u.height) || 20;
    const hz = part === 'head' ? h + 6 : part === 'feet' ? 2 : Math.round(h * 0.6);
    return [u.x * 16 + 8 * s, u.y * 16 + 8 * s, u.z * 24 + hz];
  }
  function screenOf(C, B, pos) {
    const cam = C.view.cam;
    if (Array.isArray(pos)) return OV.Iso.voxelToScreen(pos[0], pos[1], pos[2], cam);
    if (typeof pos === 'number' && pos >= 0) {
      const [x, y, z] = xyz(B, pos);
      return OV.Iso.tileCenter(x, y, z, cam);
    }
    return { x: (C.view.w || 1280) / 2, y: (C.view.h || 800) / 2 };
  }
  function sfx(C, B, nameId, pos, opts) {
    if (!OV.audio || !nameId) return;
    const o = Object.assign({}, opts || {});
    if (pos !== undefined && pos !== null && OV.audio.spatial) {
      const p = screenOf(C, B, pos);
      const sp = OV.audio.spatial(p.x, p.y, C.view.w || 1280, C.view.h || 800);
      o.pan = sp.pan;
      o.vol = (o.vol === undefined ? 1 : o.vol) * sp.vol;
    }
    if (C.hooks.sound) C.hooks.sound(nameId, o);
    else OV.audio.play(nameId, o);
  }
  function toast(C, key, params, kind) {
    if (C.hooks.toast) C.hooks.toast(key, params, kind);
    else if (OV.Dom) OV.Dom.toast(key, params, kind);
  }

  // entrada de animação de uma unidade (posição atual de B se ainda não existir)
  function entry(C, u, at) {
    let a = C.anim.units[u.id];
    if (!a) {
      let x = u.x, y = u.y, z = u.z;
      if (at !== undefined && at !== null && at >= 0) [x, y, z] = xyz(C.B, at);
      a = { fx: x, fy: y, fz: z, dir: u.dir, token: 0 };
      C.anim.units[u.id] = a;
    }
    return a;
  }
  function dropEntry(C, id) {
    delete C.anim.units[id];
  }

  // ---- câmara -------------------------------------------------------------------------------------------
  function onScreen(C, B, pos) {
    const v = C.view;
    const p = screenOf(C, B, pos);
    const w = v.w || 1280, h = v.h || 800;
    return p.x > w * 0.1 && p.x < w * 0.9 && p.y > h * 0.14 && p.y < h * 0.74;
  }
  /* desloca o centro do ecrã (em px de mundo) até ao tile; o canto da câmara é recalculado em cada fotograma com o
     zoom desse momento, por isso um zoom do jogador a meio não desvia o destino. Quem quiser tomar conta da câmara
     (arrasto, pinça, roda) incrementa C.panTok e a deslocação para. */
  function panTo(C, B, i, ms) {
    const v = C.view;
    const [x, y, z] = xyz(B, i);
    const w = v.w || 1280, h = v.h || 800;
    const tc = { x: v.cam.x, y: v.cam.y, zoom: v.cam.zoom };
    OV.Iso.centerOn(tc, x, y, z, w, h);
    if (OV.BattleRender && OV.BattleRender.clampCam) OV.BattleRender.clampCam({ cam: tc, w, h, viewZ: z }, B);
    if (Math.abs(tc.x - v.cam.x) < 2 && Math.abs(tc.y - v.cam.y) < 2) return Promise.resolve();
    const cx0 = v.cam.x + w / 2 / v.cam.zoom, cy0 = v.cam.y + h / 2 / v.cam.zoom;
    const cx1 = tc.x + w / 2 / tc.zoom, cy1 = tc.y + h / 2 / tc.zoom;
    const tok = (C.panTok = (C.panTok || 0) + 1);
    if (P.reduceMotion) ms = 0;
    return tween(ms, (p) => {
      if (C.panTok !== tok) return;
      const e = easeOut(p), zz = v.cam.zoom;
      v.cam.x = cx0 + (cx1 - cx0) * e - w / 2 / zz;
      v.cam.y = cy0 + (cy1 - cy0) * e - h / 2 / zz;
    });
  }
  // câmara e nível para um evento visível (devolve promessa se a deslocação tiver de ser aguardada)
  function frame(C, B, ev, pos, block) {
    if (pos === undefined || pos === null || pos < 0 || pos >= B.map.n) return null;
    const z = xyz(B, pos)[2];
    const follow = C.followId ? C.followId() : null;
    const uid = ev.unitId !== undefined ? ev.unitId : ev.shooterId !== undefined ? ev.shooterId : null;
    if (C.hooks.viewZ) {
      if (uid !== null && uid === follow && z !== C.view.viewZ) C.hooks.viewZ(z);
      else if (z > C.view.viewZ) C.hooks.viewZ(z);
    }
    if (onScreen(C, B, pos)) return null;
    const pr = panTo(C, B, pos, DUR.pan);
    return block ? pr : null;
  }

  // ---- tipo de projétil e som de cada arma --------------------------------------------------------------
  function gunOf(type, dmg) {
    const d = (OV.Data.items && OV.Data.items[type]) || {};
    const s = d.sfx;
    if (s === 'laser') return 'laser';
    if (s === 'plasma' || dmg === 'PLASMA') return 'plasma';
    if (s === 'rocket' || s === 'launcher') return 'rocket';
    return 'tracer';
  }
  function shotSound(type, mode) {
    const d = (OV.Data.items && OV.Data.items[type]) || {};
    switch (d.sfx) {
      case 'pistol': return 'pistol';
      case 'rifle': return mode === 'auto' ? 'rifle_auto' : 'rifle';
      case 'cannon': return type === 'auto_cannon' ? 'auto_cannon' : 'heavy_cannon';
      case 'rocket':
      case 'launcher': return 'rocket_launch';
      case 'laser': return 'laser';
      case 'plasma': return 'plasma';
      case 'stunrod': return 'stun_rod';
      case 'claw': return 'chryssalid_skitter';
      default: return 'rifle';
    }
  }
  const IMPACT_COL = { LASER: 0xff6a5a, PLASMA: 0x8aff9a, STUN: 0x8ec8ff, IN: 0xff9a40 };

  // ---- animações por tipo de evento --------------------------------------------------------------------
  const H = {};

  H.step = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    const [x0, y0, z0] = xyz(B, ev.from);
    const [x1, y1, z1] = xyz(B, ev.to);
    const a = entry(C, u, ev.from);
    a.show = true;
    a.dir = ev.dir < 8 ? ev.dir : a.dir;
    const fly = !!u.float || u.move === 'fly';
    const dur = ev.kind === 'gravlift' ? DUR.lift : ev.kind === 'stairs' ? DUR.stairs : DUR.step;
    // passos: classe do chão do destino
    if (!fly && ev.kind !== 'gravlift') {
      if (u.sprite === 'chryssalid') sfx(C, B, 'chryssalid_skitter', ev.to, { vol: 0.7 });
      else {
        const f = OV.BMap.def(B.map, ev.to, 0);
        sfx(C, B, FLOOR_SFX[(f && f.sfx) || 'earth'] || 'step_earth', ev.to, { vol: isPlayer(u) ? 0.8 : 0.6 });
      }
    }
    frame(C, B, ev, ev.to, P.side !== 'xcom');
    const start = (C.walkN = (C.walkN || 0) + 1) * 2;
    await tween(dur, (p) => {
      a.fx = x0 + (x1 - x0) * p;
      a.fy = y0 + (y1 - y0) * p;
      a.fz = z0 + (z1 - z0) * (ev.kind === 'stairs' || ev.kind === 'gravlift' || ev.kind === 'fly' ? easeInOut(p) : p);
      a.pose = fly ? 'float' : 'walk';
      a.frame = (start + Math.floor(p * 2)) & 3;
    });
    a.fx = x1;
    a.fy = y1;
    a.fz = z1;
  };

  H.fall = async function (C, B, ev) {
    if (ev.unitId === null || ev.unitId === undefined) return;
    const u = unit(B, ev.unitId);
    if (!u) return;
    const [x, y] = xyz(B, ev.to);
    const a = entry(C, u, ev.from);
    a.show = true;
    a.fx = x;
    a.fy = y;
    const zA = ev.fromZ, zB = ev.toZ;
    frame(C, B, ev, ev.to, true);
    await tween(DUR.fall * Math.max(1, Math.abs(zA - zB)), (p) => {
      a.fz = zA + (zB - zA) * p * p;
      a.pose = u.float ? 'float' : 'stand';
    });
    a.fz = zB;
  };

  H.turn = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    const a = entry(C, u);
    a.show = true;
    a.dir = ev.to;
    if (a.pose === 'walk') a.pose = undefined;
    await wait(DUR.turn);
  };

  H.kneel = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    const a = C.anim.units[u.id];
    if (a) a.pose = undefined;
    sfx(C, B, 'kneel', ev.pos, { vol: 0.8 });
    await wait(DUR.kneel);
  };

  H.door = async function (C, B, ev) {
    if (OV.BattleRender && OV.BattleRender.markDirty) for (const i of ev.tiles || [ev.i]) OV.BattleRender.markDirty(i, B);
    if (ev.open === false) {
      sfx(C, B, 'ufo_door', ev.i, { vol: 0.6 });
      return;
    }
    const pr = frame(C, B, ev, ev.i, true);
    if (pr) await pr;
    sfx(C, B, ev.kind === 'ufo' ? 'ufo_door' : 'door_open', ev.i);
    await wait(ev.kind === 'ufo' ? DUR.ufoDoor : DUR.door);
  };

  H.spotted = async function (C, B, ev) {
    if (ev.side !== 'xcom') return;
    const u = unit(B, ev.unitId);
    if (!u || u.side === 'xcom') return;
    if (P.side !== 'xcom') {
      const pr = frame(C, B, ev, ev.pos, true);
      if (pr) await pr;
    }
    if (OV.FX) OV.FX.spawn('spotted', unitVoxel(u, 'head'), {});
    if (!C.spottedSound) {
      C.spottedSound = true;
      sfx(C, B, 'alien_spotted', ev.pos);
      if (!C.spottedToast) {
        C.spottedToast = true;
        toast(C, 'bs.ev.spotted', null, 'alert');
      }
    }
    await wait(DUR.spotted);
  };

  H.interrupt = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!isPlayer(u) || B.side !== 'xcom') return;
    if (ev.reason === 'spotted' || ev.reason === 'stopped') return;
    // parou para não comer a reserva de UT: dizer porquê e como ir mais longe (a etiqueta do caminho já o avisava)
    const touch = OV.Input && OV.Input.lastPointerType === 'touch';
    toast(C, ev.reason === 'reserved' ? (touch ? 'hud.stop.reserved.touch' : 'hud.stop.reserved') : 'bs.' + ev.reason, null, 'warn');
    sfx(C, B, 'ui_deny');
  };

  H.reaction = async function (C, B, ev) {
    const r = unit(B, ev.reactorId);
    if (!r) return;
    const pr = frame(C, B, ev, ev.pos, true);
    if (pr) await pr;
    const a = entry(C, r);
    a.show = true;
    if (OV.FX) OV.FX.spawn('damage', unitVoxel(r, 'head'), { text: OV.T('hud.reaction'), colour: 0xffc23a });
    sfx(C, B, 'reaction_alert', ev.pos);
    toast(C, 'bs.ev.reaction', { name: name(r) }, r.side === 'xcom' ? 'good' : 'alert');
    await wait(DUR.reaction);
  };

  H.shot = async function (C, B, ev) {
    const sh = unit(B, ev.shooterId);
    if (ev.round === 0 || ev.round === undefined) {
      const pr = frame(C, B, ev, ev.pos, true);
      if (pr) await pr;
    }
    let tok = 0;
    if (sh) {
      const a = entry(C, sh);
      a.show = true;
      a.pose = 'aim';
      tok = a.token = (a.token | 0) + 1;
    }
    const kind = gunOf(ev.weapon, ev.dmgType);
    const snd = shotSound(ev.weapon, ev.mode);
    if (!(snd === 'rifle_auto' && ev.round > 0)) sfx(C, B, snd, ev.from);
    if (OV.FX) {
      OV.FX.spawn('muzzle', ev.from, { gun: kind === 'laser' ? 'laser' : kind === 'plasma' ? 'plasma' : 'ballistic', size: kind === 'rocket' ? 1.4 : 1 });
      const path = ev.path && ev.path.length > 1 ? ev.path : [ev.from, ev.to];
      const flight = OV.FX.projectile(kind, ev.from, path, TPS[kind] || 0, {});
      let L = 0;
      for (let k = 1; k < path.length; k++) L += Math.hypot((path[k][0] - path[k - 1][0]) / 16, (path[k][1] - path[k - 1][1]) / 16, (path[k][2] - path[k - 1][2]) / 24);
      const maxMs = kind === 'laser' ? 200 : (L / (TPS[kind] || 20)) * 1000 + 300;
      await Promise.race([flight, wait(maxMs)]);
    }
    if (ev.shots > 1 && ev.round < ev.shots - 1) await wait(DUR.between);
    else if (sh) {
      wait(DUR.shotHold).then(() => {
        const a = C.anim.units[sh.id];
        if (a && a.token === tok && a.pose === 'aim') a.pose = undefined;
      });
    }
  };

  H.melee = async function (C, B, ev) {
    const at = unit(B, ev.attackerId);
    const pr = frame(C, B, ev, ev.pos, true);
    if (pr) await pr;
    if (at) {
      const a = entry(C, at);
      a.show = true;
      a.pose = 'aim';
      sfx(C, B, shotSound(ev.weapon, 'melee'), ev.pos);
    }
    await wait(DUR.melee);
    if (at && C.anim.units[at.id]) C.anim.units[at.id].pose = undefined;
  };

  H.impact = async function (C, B, ev) {
    if (!OV.FX || ev.kind === 'none' || ev.kind === 'out' || ev.kind === 'unit') return;
    const area = ev.dmgType === 'HE' || ev.dmgType === 'IN' || ev.dmgType === 'SMOKE' || ev.dmgType === 'STUN';
    if (area) return;
    OV.FX.spawn('impact', ev.voxel, { colour: IMPACT_COL[ev.dmgType], count: 8 });
  };

  H.explosion = async function (C, B, ev) {
    const pr = frame(C, B, ev, ev.pos, true);
    if (pr) await pr;
    if (OV.FX) OV.FX.spawn('explosion', ev.voxel, { radius: ev.radius, dmg: ev.dmgType });
    const big = (ev.radius | 0) >= 4 || (ev.power | 0) >= 90;
    if (ev.dmgType !== 'SMOKE') sfx(C, B, big ? 'explosion_large' : 'explosion_small', ev.voxel);
    else sfx(C, B, 'grenade_pin', ev.voxel);
    C.tileLeft = DUR.tileBudget;
    await wait(DUR.explosion * 0.55);
  };

  H.tile = async function (C, B, ev) {
    if (OV.BattleRender && OV.BattleRender.markDirty) OV.BattleRender.markDirty(ev.i, B);
    if (OV.FX && ev.part !== 0) {
      const v = tileVoxel(B, ev.i, ev.part === 3 ? 10 : 14);
      if (ev.part === 1) v[0] -= 7;
      if (ev.part === 2) v[1] -= 7;
      OV.FX.spawn('sparks', v, { colour: 0x8a8378, count: 6 });
    }
    sfx(C, B, 'wall_crumble', ev.i, { vol: 0.7 });
    if (C.tileLeft > 0) {
      const g = Math.min(DUR.tileGap, C.tileLeft);
      C.tileLeft -= g;
      await wait(g);
    }
  };

  H.damage = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    const at = ev.pos >= 0 ? ev.pos : null;
    const v = at !== null && (u.x < 0 || !u.onMap) ? tileVoxel(B, at, 14) : unitVoxel(u);
    const alien = u.origSide === 'alien' || u.side === 'alien';
    if (OV.FX) {
      if (ev.amount > 0 && ev.dmgType !== 'STUN' && ev.cause !== 'burn') OV.FX.spawn('blood', v, { alien, colour: alien ? 0x7ad040 : undefined });
      if (ev.amount > 0) OV.FX.spawn('damage', v, { amount: ev.amount });
      else if (ev.stun > 0) OV.FX.spawn('damage', v, { amount: ev.stun, stun: true });
      else if (ev.absorbed) OV.FX.spawn('damage', v, { text: '0', colour: 0xc8d2dc });
    }
    if (ev.amount > 0 && !alien) sfx(C, B, 'soldier_hit', ev.pos);
    if (u.status === 'ok' || u.status === 'panic') {
      const a = entry(C, u);
      a.show = true;
      const tok = (a.token = (a.token | 0) + 1);
      tween(DUR.damage * 1.4, (p) => {
        if (a.token === tok) a.flash = 1 - p;
      });
    }
    if (isPlayer(u) && ev.wounds > 0 && ev.cause !== 'wounds' && u.status !== 'dead') toast(C, gk('bs.ev.wounded', u), { name: name(u) }, 'alert');
    await wait(DUR.damage);
  };

  async function topple(C, B, ev, u, sound) {
    const i = ev.i !== undefined && ev.i >= 0 ? ev.i : ev.pos;
    if (i === undefined || i < 0) return;
    const pr = frame(C, B, ev, i, true);
    if (pr) await pr;
    const [x, y, z] = xyz(B, i);
    const a = entry(C, u, i);
    a.show = true;
    a.fx = x;
    a.fy = y;
    a.fz = z;
    a.flash = 0;
    const tok = (a.token = (a.token | 0) + 1);
    if (ev.bodyId !== null && ev.bodyId !== undefined) C.anim.hideItems.add(ev.bodyId);
    if (sound) sfx(C, B, sound, i);
    await tween(DUR.death, (p) => {
      if (a.token !== tok) return;
      a.pose = 'fall';
      a.frame = Math.min(2, Math.floor(p * 3));
    });
    if (C.anim.units[u.id] === a && a.token === tok) dropEntry(C, u.id);
    if (ev.bodyId !== null && ev.bodyId !== undefined) C.anim.hideItems.delete(ev.bodyId);
  }

  H.death = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    const alien = u.origSide === 'alien';
    const snd = alien ? DEATH_SFX[u.sprite] || 'alien_death_sectoid' : 'soldier_death';
    if (u.origSide === 'xcom') toast(C, gk('bs.ev.kia', u), { name: name(u) }, 'alert');
    await topple(C, B, ev, u, snd);
  };

  H.stun = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (!u) return;
    if (u.origSide === 'xcom') toast(C, gk('bs.ev.stunned', u), { name: name(u) }, 'warn');
    await topple(C, B, ev, u, u.origSide === 'alien' ? null : 'soldier_hit');
  };

  H.wake = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    if (u && u.origSide === 'xcom') toast(C, 'bs.ev.wake', { name: name(u) }, 'good');
    dropEntry(C, ev.unitId);
  };

  H.zombify = async function (C, B, ev) {
    // o nome é o de quem se transformou (fromId), não o do zombie novo (unitId)
    const u = unit(B, ev.fromId);
    if (u) toast(C, gk('bs.ev.zombify', u), { name: name(u) }, 'alert');
    dropEntry(C, ev.unitId);
    await wait(DUR.endBeat);
  };

  H.throw = async function (C, B, ev) {
    const u = unit(B, ev.unitId);
    const pr = frame(C, B, ev, ev.pos, true);
    if (pr) await pr;
    let tok = 0;
    if (u) {
      const a = entry(C, u);
      a.show = true;
      a.pose = 'aim';
      tok = a.token = (a.token | 0) + 1;
    }
    sfx(C, B, 'throw', ev.from);
    if (OV.FX && ev.arc && ev.arc.length > 1) {
      let L = 0;
      for (let k = 1; k < ev.arc.length; k++) L += Math.hypot((ev.arc[k][0] - ev.arc[k - 1][0]) / 16, (ev.arc[k][1] - ev.arc[k - 1][1]) / 16, (ev.arc[k][2] - ev.arc[k - 1][2]) / 24);
      const ms = Math.max(450, Math.min(800, (L / TPS.thrown) * 1000));
      const flight = OV.FX.projectile('thrown', ev.from, ev.arc, (L * 1000) / ms, { itemId: ev.type });
      await Promise.race([flight, wait(ms + 300)]);
    } else await wait(450);
    if (u) {
      const a = C.anim.units[u.id];
      if (a && a.token === tok) a.pose = undefined;
    }
    sfx(C, B, 'bounce', ev.land);
    frame(C, B, ev, ev.land, false);
  };

  H.prime = async function (C, B, ev) {
    sfx(C, B, 'grenade_pin', ev.pos);
    // espoleta 0: rebenta ao aterrar (granadas instantâneas) ou no fim do turno
    const instant = !B.settings || B.settings.instantGrenades !== false;
    toast(C, ev.fuse > 0 ? OV.Tn('bs.fuse', ev.fuse) : OV.T(instant ? 'bs.fuse.now.instant' : 'bs.fuse.now.end'), null, 'info');
    await wait(DUR.prime);
  };

  H.reload = async function (C, B, ev) {
    sfx(C, B, 'grenade_pin', ev.pos, { rate: 0.7 });
    toast(C, 'bs.ev.reload', null, 'info');
    await wait(DUR.reload);
  };

  H.medikit = async function (C, B, ev) {
    const t = unit(B, ev.targetId);
    sfx(C, B, 'medikit', ev.pos);
    if (t && OV.FX && t.onMap) OV.FX.spawn('damage', unitVoxel(t), { text: '+', colour: 0x5fe08a });
    if (t) toast(C, gk('bs.ev.healed', t), { name: name(t) }, 'good');
    await wait(DUR.medikit);
  };

  H.scanner = async function (C, B, ev) {
    const n = (ev.blips || []).length;
    if (n) toast(C, OV.T('bs.ev.scanner.some.' + (n === 1 ? 'one' : 'other'), { n }), null, 'info');
    else toast(C, 'bs.ev.scanner.none', null, 'info');
    if (C.hooks.blips) C.hooks.blips(ev.blips || [], ev.unitId);
    sfx(C, B, 'radar_ping', ev.pos);
    await wait(DUR.endBeat);
  };

  H.morale = async function (C, B, ev) {
    if (ev.kind === 'change') return;
    const u = unit(B, ev.unitId);
    if (!u) return;
    const key = gk(ev.kind === 'berserk' ? 'bs.morale.berserk' : ev.kind === 'freeze' ? 'bs.morale.freeze' : ev.kind === 'flee' ? 'bs.morale.flee' : 'bs.morale.panic', u);
    if (ev.kind === 'panic' || ev.kind === 'berserk') {
      const pr = frame(C, B, ev, ev.pos, true);
      if (pr) await pr;
      if (OV.FX && u.onMap) OV.FX.spawn('damage', unitVoxel(u, 'head'), { text: '!!', colour: 0xb48cff });
      sfx(C, B, 'psi', ev.pos, { vol: 0.6, rate: 0.6 });
      if (C.hooks.banner) C.hooks.banner(OV.T(key, { name: name(u) }), 'morale');
      await wait(DUR.morale);
      if (C.hooks.banner) C.hooks.banner(null);
    } else toast(C, key, { name: name(u) }, 'warn');
  };

  H.psi = async function (C, B, ev) {
    const t = unit(B, ev.targetId);
    if (ev.kind === 'revert') {
      if (t) toast(C, 'bs.psi.revert', { name: name(t) }, 'info');
      return;
    }
    const a = unit(B, ev.attackerId);
    const pr = frame(C, B, ev, ev.pos, true);
    if (pr) await pr;
    if (OV.FX && t) OV.FX.spawn('psi', a && a.onMap ? unitVoxel(a, 'head') : unitVoxel(t, 'head'), { to: unitVoxel(t, 'head') });
    sfx(C, B, 'psi', ev.pos);
    await wait(DUR.psi);
    if (!ev.success) toast(C, 'bs.psi.fail', null, 'info');
    else if (ev.kind === 'control') toast(C, gk('bs.psi.control', t), { name: name(t) }, 'alert');
    else toast(C, 'bs.psi.panic', null, 'alert');
  };

  H.fire = async function (C, B, ev) {
    const tiles = (ev.tiles || [ev.i]).slice(0, 6);
    if (OV.FX) for (const i of tiles) OV.FX.spawn('fire', tileVoxel(B, i, 4), { size: 0.9 });
    sfx(C, B, 'fire_loop_tick', ev.pos, { vol: 0.8 });
  };

  H.smoke = async function (C, B, ev) {
    const tiles = (ev.tiles || [ev.i]).slice(0, 10);
    if (OV.FX) for (const i of tiles) OV.FX.spawn('smoke', tileVoxel(B, i, 6), { life: 1600, size: 1.1, delay: Math.random() * 200 });
  };

  H.drop = H.pickup = H.inv = async function (C, B, ev) {
    if (ev.vis) sfx(C, B, 'ui_click', ev.pos, { vol: 0.6 });
  };

  H.spawn = async function (C, B, ev) {
    dropEntry(C, ev.unitId);
  };

  H.turnStart = async function (C, B, ev) {
    P.side = ev.side;
    if (ev.side === 'xcom') {
      if (C.hiddenOn) setHidden(C, false);
      if (C.hooks.banner) {
        C.hooks.banner(OV.T('bs.turn.banner', { turn: ev.turn, side: OV.T('bs.side.xcom') }), 'turn');
        sfx(C, B, 'end_turn');
        await wait(DUR.banner);
        C.hooks.banner(null);
      }
    }
  };

  // ---- aviso de movimento oculto ------------------------------------------------------------------------
  function setHidden(C, on) {
    if (C.hiddenOn === on) return;
    C.hiddenOn = on;
    if (C.hooks.hidden) C.hooks.hidden(on);
  }
  // evento oculto: só contabilidade (posições antigas deixam de valer, tiles mudados)
  function skip(C, B, ev) {
    const id = ev.unitId !== undefined ? ev.unitId : null;
    if (id !== null && C.anim.units[id] && ev.t !== 'damage') {
      const u = unit(B, id);
      if (!u || u.side !== 'xcom') dropEntry(C, id);
    }
    if (ev.t === 'tile' && OV.BattleRender && OV.BattleRender.markDirty) OV.BattleRender.markDirty(ev.i, B);
    if (ev.t === 'door' && OV.BattleRender && OV.BattleRender.markDirty) for (const i of ev.tiles || [ev.i]) OV.BattleRender.markDirty(i, B);
    if (ev.t === 'turnStart') P.side = ev.side;
  }

  // ---- ciclo principal ----------------------------------------------------------------------------------
  let chain = Promise.resolve();

  function makeCtx(B, ctx) {
    const C = ctx || {};
    C.B = B;
    C.hooks = C.hooks || {};
    if (!C.view) C.view = { cam: { x: 0, y: 0, zoom: 1 }, w: 1280, h: 800, viewZ: 0 };
    if (!C.anim) C.anim = { units: {}, hidden: new Set(), hideItems: new Set() };
    if (!C.anim.units) C.anim.units = {};
    if (!C.anim.hidden) C.anim.hidden = new Set();
    if (!C.anim.hideItems) C.anim.hideItems = new Set();
    C.view.anim = C.anim;
    C.spottedSound = false;
    C.spottedToast = false;
    C.tileLeft = 0;
    C.hiddenOn = false;
    return C;
  }

  async function run(B, gen, ctx) {
    const C = makeCtx(B, ctx);
    P.playing = true;
    P.fast = false;
    P.side = C.side || B.side || 'xcom';
    let last = null, r = null;
    let slice = realNow();
    try {
      for (;;) {
        r = gen.next();
        if (r.done) break;
        const ev = r.value;
        if (!ev) continue;
        last = ev;
        if (C.hooks.log) {
          try { C.hooks.log(ev); } catch (e) { console.error(e); }
        }
        // turno alienígena/civil: o próprio anúncio é «Movimento Oculto…»
        const hiddenTurn = ev.t === 'turnStart' && ev.side !== 'xcom';
        if (!ev.vis || hiddenTurn) {
          skip(C, B, ev);
          if (P.side !== 'xcom') {
            if (!C.hiddenOn) {
              setHidden(C, true);
              if (hiddenTurn && ev.side === 'alien') sfx(C, B, 'hidden_movement');
            }
          }
          // turno alienígena escondido: mais cálculo por fotograma (o aviso pisca na mesma), menos espera
          if (realNow() - slice > (C.hiddenOn ? 45 : 14)) {
            if (C.hooks.event) C.hooks.event(ev);
            await nextFrame();
            slice = realNow();
          }
          continue;
        }
        if (C.hiddenOn && SHOWY[ev.t]) setHidden(C, false);
        const h = H[ev.t];
        if (h) await h(C, B, ev);
        if (C.hooks.event) C.hooks.event(ev);
        slice = realNow();
      }
      P.lastResult = r ? r.value : null;
      if (last && last.t !== 'battleEnd') await wait(DUR.endBeat * 0.5);
    } finally {
      setHidden(C, false);
      if (C.hooks.banner && C.bannerOn) C.hooks.banner(null);
      for (const id of Object.keys(C.anim.units)) delete C.anim.units[id];
      C.anim.hideItems.clear();
      P.playing = false;
      P.fast = false;
    }
    return last;
  }

  // reproduções em fila (uma de cada vez)
  function play(B, gen, ctx) {
    const p = chain.then(() => run(B, gen, ctx));
    chain = p.catch(() => null);
    return p;
  }

  Object.assign(P, {
    play, wait, tween, timeScale,
    hurry() { if (P.playing) P.fast = true; },
    gunOf, shotSound,
  });
  OV.Presenter = P;
})(globalThis.OV || (globalThis.OV = {}));
