/* Ecrãs e menus (DESIGN.md §5.2, §15): cenas OV.SceneDefs.menu, quickbattle, briefing, debrief, options, howto e
   credits, mais o fundo animado partilhado (Terra noturna, estrelas, aurora, OVNI ocasional).
   A interface nunca altera B: só constrói a especificação da missão e entrega-a a OV.Battle.create.
   Parâmetros das cenas:
     quickbattle {params?: URLSearchParams}  ?battle=<ufo|terror|alienBase|cydonia>&night=1&seed=N&diff=0..2&month=0..4
                 (&landed=1 &dusk=1 &terrain=FARM &squad=8) ⇒ salta o formulário e entra direto na batalha
     briefing    {mission, meta?, quick?}
     debrief     {B, debrief?, outcome?, mission?, meta?, quick?, progression?, onDone?(debrief)}
     options     {inGame?}   (sobreposição; isScreen:false)
   API: OV.Screens = { VERSION, Backdrop, startBattle, buildQuickMission, quickFromURL, missionTitle, loadoutFor,
                       defaultQuick, openOptions, saves, resumeGame } */
(function (OV) {
  'use strict';

  const VERSION = '0.9.0';
  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  const el = (...a) => OV.Dom.el(...a);
  const D = () => OV.Data;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const RAD = Math.PI / 180;
  const TAU = Math.PI * 2;
  // stream de interface (cosmética): nunca as streams da simulação
  const uiRng = OV.RNG.create((Date.now() ^ 0x5c4ee5) >>> 0);
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = () => (OV.View && OV.View.dpr) || Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);

  const UFO_KINDS = { crash: 1, landed: 1 };
  const KINDS = ['crash', 'landed', 'terror', 'alienBase', 'cydonia'];
  const KIND_TERRAIN = { terror: 'URBAN', alienBase: 'ALIENBASE', cydonia: 'MARS' };
  const UFO_TERRAINS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR'];
  const TERRAINS = ['auto', 'FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN'];
  const TIMES = ['day', 'dusk', 'night'];
  const GAME_SCENES = { battlescape: 1, geoscape: 1, basescape: 1, dogfight: 1, equip: 1, inventory: 1, ufopaedia: 1 };
  const MY_SCENES = { menu: 1, quickbattle: 1, briefing: 1, debrief: 1, options: 1, howto: 1, credits: 1 };

  function sfx(name) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name); } catch (e) { /* som é opcional */ }
  }
  function music(mood) {
    try { if (OV.audio && OV.audio.music) OV.audio.music(mood); } catch (e) { /* idem */ }
  }
  function stinger(name) {
    try { if (OV.audio && OV.audio.stinger) OV.audio.stinger(name); } catch (e) { /* idem */ }
  }
  function lsGet(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* modo privado */ }
  }
  const settings = () => (OV.Game && OV.Game.settings) || {};

  // cópia de um canvas em cache para um novo elemento (o mesmo canvas não pode estar em dois sítios do DOM)
  function canvasCopy(src, cssW, cssH, cls) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, src.width);
    c.height = Math.max(1, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    if (cls) c.className = cls;
    return c;
  }
  function portraitEl(s, size, cls) {
    if (!OV.Portraits) return el('div', { class: 'scr-portrait-ph ' + (cls || ''), style: { width: size + 'px', height: size + 'px' } });
    const like = { portraitSeed: s.portraitSeed | 0, female: !!s.female, nat: s.nat, armour: s.armour || s.armourId, rank: s.rank | 0 };
    try { return canvasCopy(OV.Portraits.canvas(like, Math.round(size * dpr())), size, size, 'scr-portrait ' + (cls || '')); } catch (e) {
      return el('div', { class: 'scr-portrait-ph ' + (cls || ''), style: { width: size + 'px', height: size + 'px' } });
    }
  }
  function itemIconEl(itemId, size) {
    const def = D().items[itemId];
    const title = def ? T(def.nameKey) : itemId;
    if (!OV.ItemSprites) return el('span', { class: 'scr-icon-ph', title });
    try {
      const c = canvasCopy(OV.ItemSprites.icon(itemId, (size / 48) * dpr()), size, size, 'scr-icon');
      c.title = title;
      return c;
    } catch (e) { return el('span', { class: 'scr-icon-ph', title }); }
  }
  function unitSpriteEl(unitType, h) {
    const def = D().units[unitType];
    if (!def || !OV.UnitSprites) return null;
    try {
      const scale = 1.6;
      const s = OV.UnitSprites.get(def.sprite || def.species || unitType, 3, 'stand', 0, scale * dpr(), { team: def.side || 'alien' });
      if (!s || !s.c) return null;
      const k = h / Math.max(1, s.h * scale);
      return canvasCopy(s.c, Math.round(s.w * scale * k), Math.round(s.h * scale * k), 'scr-alien');
    } catch (e) { return null; }
  }

  // ================================================================================================
  // Fundo animado: Terra noturna a rodar devagar, luzes das cidades, aurora, estrelas e um OVNI ocasional
  // ================================================================================================
  const Backdrop = (function () {
    let ready = false;
    const stars = [];
    let land = null, lights = null, ufo = null, nextUfo = 0, landLayer = null;
    const R0 = OV.RNG.create(0x0e47b5);
    const rnd = () => R0.next();

    function init() {
      ready = true;
      for (let i = 0; i < 360; i++) {
        const k = rnd();
        stars.push({ x: rnd(), y: rnd(), r: 0.35 + Math.pow(rnd(), 4) * 1.6, a: 0.25 + rnd() * 0.75, f: 0.4 + rnd() * 2.2, p: rnd() * TAU,
          c: k < 0.1 ? '255,214,170' : k < 0.25 ? '170,205,255' : '235,242,255' });
      }
      const W = D() && D().world;
      const lo = [], la = [], lit = [];
      if (W && W.isLand) {
        for (let lat = -82; lat <= 84; lat += 1.7) {
          const step = 1.7 / Math.max(0.2, Math.cos(lat * RAD));
          for (let lon = -180 + rnd() * step; lon < 180; lon += step) {
            if (!W.isLand(lon, lat)) continue;
            lo.push(lon * RAD); la.push(lat * RAD);
            if (rnd() < 0.2) lit.push(lon + (rnd() - 0.5) * 1.4, lat + (rnd() - 0.5) * 1.4, 0.25 + rnd() * 0.5);
          }
        }
      }
      for (const c of (D() && D().cities) || []) {
        for (let k = 0; k < 26; k++) {
          const r = Math.pow(rnd(), 1.8) * 2.2, a = rnd() * TAU;
          lit.push(c.lon + Math.cos(a) * r / Math.max(0.3, Math.cos(c.lat * RAD)), c.lat + Math.sin(a) * r, k < 3 ? 1 : 0.45 + rnd() * 0.5);
        }
      }
      land = pack(lo, la);
      const llo = [], lla = [], lb = [];
      for (let i = 0; i < lit.length; i += 3) { llo.push(lit[i] * RAD); lla.push(lit[i + 1] * RAD); lb.push(lit[i + 2]); }
      lights = pack(llo, lla);
      lights.b = Float32Array.from(lb);
      lights.p = Float32Array.from(lb.map(() => rnd() * TAU));
    }
    function pack(lo, la) {
      const n = lo.length;
      const o = { n, lon: Float32Array.from(lo), sl: new Float32Array(n), cl: new Float32Array(n) };
      for (let i = 0; i < n; i++) { o.sl[i] = Math.sin(la[i]); o.cl[i] = Math.cos(la[i]); }
      return o;
    }

    // geometria do planeta conforme o formato do ecrã
    function geom(w, h) {
      if (w >= h * 1.05) return { cx: w * 0.7, cy: h * 1.03, R: Math.max(w * 0.47, h * 0.72) };
      return { cx: w * 0.5, cy: h * 1.08, R: Math.max(w * 0.85, h * 0.45) };
    }

    const SUN = (() => { const v = [0.78, 0.34, -0.52]; const m = Math.hypot(...v); return v.map((x) => x / m); })();
    const TILT = 0.5;
    const cT = Math.cos(TILT), sT = Math.sin(TILT);

    // o fundo completo é pintado numa tela própria a ~12 fps (o planeta roda devagar) e copiado nos outros
    // fotogramas; só o risco do OVNI anima a cada fotograma. Poupa ~10 gradientes de ecrã inteiro por fotograma.
    const SNAP_DT = 1 / 12;
    let snap = null, snapT = -1, snapKey = '';
    function draw(ctx, view, opts) {
      if (!ready) init();
      const o = opts || {};
      const t = now() / 1000;
      const w = view.w, h = view.h, dpr = view.dpr || 1;
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      const key = w + 'x' + h + '@' + dpr + '|' + (o.dim || 0) + '|' + (o.tint || '');
      if (!snap || snap.width !== W || snap.height !== H) {
        snap = document.createElement('canvas');
        snap.width = W;
        snap.height = H;
        snapKey = '';
      }
      if (key !== snapKey || t - snapT >= SNAP_DT || t < snapT) {
        const g = snap.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint(g, w, h, t, o);
        snapKey = key;
        snapT = t;
      }
      ctx = view.begin(false);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(snap, 0, 0);
      ctx.restore();
      ctx.globalAlpha = Math.max(0.2, 1 - (o.dim || 0));
      drawUfo(ctx, w, h, t);
      ctx.globalAlpha = 1;
    }
    // camadas estáticas (gradientes de ecrã inteiro) cozidas uma vez por tamanho/escurecimento:
    // base = céu + halo + brilho do sol + disco do planeta; over = limbo + aresta + vinheta + escurecimento
    let stat = null;
    function layer(W, H, dpr, fn) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      fn(g);
      return c;
    }
    function statics(ctx, w, h, o) {
      const T = ctx.getTransform(), dpr = T.a || 1;
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      const key = W + 'x' + H + '|' + (o.dim || 0) + '|' + (o.tint || '');
      if (stat && stat.key === key) return stat;
      const { cx, cy, R } = geom(w, h);
      const base = layer(W, H, dpr, (g) => {
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#02040a');
        bg.addColorStop(0.6, '#050c18');
        bg.addColorStop(1, '#081a2c');
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        // halo atmosférico exterior
        const halo = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.09);
        halo.addColorStop(0, 'rgba(70,160,255,0.32)');
        halo.addColorStop(0.35, 'rgba(50,120,230,0.12)');
        halo.addColorStop(1, 'rgba(30,80,200,0)');
        g.fillStyle = halo;
        g.beginPath();
        g.arc(cx, cy, R * 1.09, 0, TAU);
        g.fill();
        // brilho do sol a nascer atrás do limbo
        const sx = cx + SUN[0] * R * 0.98, sy = cy - SUN[1] * R * 0.98;
        const sg = g.createRadialGradient(sx, sy, 0, sx, sy, R * 0.55);
        sg.addColorStop(0, 'rgba(255,214,150,0.30)');
        sg.addColorStop(0.3, 'rgba(120,180,255,0.10)');
        sg.addColorStop(1, 'rgba(60,120,255,0)');
        g.fillStyle = sg;
        g.fillRect(sx - R * 0.55, sy - R * 0.55, R * 1.1, R * 1.1);
        g.save();
        g.beginPath();
        g.arc(cx, cy, R, 0, TAU);
        g.clip();
        const og = g.createRadialGradient(cx - R * 0.15, cy - R * 0.45, R * 0.1, cx, cy, R);
        og.addColorStop(0, '#0b1a2e');
        og.addColorStop(1, '#040a14');
        g.fillStyle = og;
        g.fillRect(cx - R, cy - R, R * 2, R * 2);
        // lado de dia (crescente)
        const dg = g.createRadialGradient(cx + SUN[0] * R, cy - SUN[1] * R, R * 0.05, cx + SUN[0] * R, cy - SUN[1] * R, R * 1.05);
        dg.addColorStop(0, 'rgba(90,150,215,0.55)');
        dg.addColorStop(0.45, 'rgba(40,90,150,0.18)');
        dg.addColorStop(0.75, 'rgba(20,50,90,0)');
        g.fillStyle = dg;
        g.fillRect(cx - R, cy - R, R * 2, R * 2);
        g.restore();
      });
      const over = layer(W, H, dpr, (g) => {
        // escurecimento do limbo
        g.save();
        g.beginPath();
        g.arc(cx, cy, R, 0, TAU);
        g.clip();
        const lg = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
        lg.addColorStop(0, 'rgba(0,0,0,0)');
        lg.addColorStop(1, 'rgba(2,6,14,0.55)');
        g.fillStyle = lg;
        g.fillRect(cx - R, cy - R, R * 2, R * 2);
        g.restore();
        // aresta iluminada do limbo
        g.strokeStyle = 'rgba(120,200,255,0.35)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(cx, cy, R + 0.5, Math.PI * 1.05, Math.PI * 1.98);
        g.stroke();
        // vinheta e escurecimento para ecrãs secundários
        const vg = g.createRadialGradient(w * 0.45, h * 0.45, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.55)');
        g.fillStyle = vg;
        g.fillRect(0, 0, w, h);
        if (o.dim) {
          g.fillStyle = 'rgba(3,7,12,' + o.dim + ')';
          g.fillRect(0, 0, w, h);
        }
        if (o.tint) {
          g.fillStyle = o.tint;
          g.fillRect(0, 0, w, h);
        }
      });
      stat = { key, base, over };
      return stat;
    }
    function blitLayer(ctx, c) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    }

    function paint(ctx, w, h, t, o) {
      const L = statics(ctx, w, h, o);
      blitLayer(ctx, L.base);
      const { cx, cy, R } = geom(w, h);

      // estrelas (deriva lenta; o disco do planeta tapa-as)
      const drift = reduceMotion() ? 0 : t * 1.2;
      for (const s of stars) {
        const tw = 0.6 + 0.4 * Math.sin(t * s.f + s.p);
        const x = (s.x * w + drift * s.r) % w, y = s.y * h;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < R * R) continue;
        ctx.fillStyle = 'rgba(' + s.c + ',' + (s.a * tw).toFixed(3) + ')';
        ctx.fillRect(x, y, s.r * 1.4, s.r * 1.4);
      }

      const lon0 = -0.35 + (reduceMotion() ? 0 : t * 0.012);
      // continentes (pontos agrupados por luminosidade)
      // cada amostra de terra é uma mancha elíptica (escorço radial) — juntas desenham os continentes
      const LK = 1 / 3; // camada de terra a 1/3 da resolução, ampliada com suavização (continentes macios)
      const blob = Math.max(1.2, R * 1.7 * RAD * 0.8 * LK);
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const LC = ['rgba(28,50,72,0.95)', 'rgba(36,62,80,0.95)', 'rgba(52,86,88,0.95)', 'rgba(72,104,88,0.95)'];
      for (let i = 0; i < land.n; i++) {
        const a = land.lon[i] - lon0;
        const x = land.cl[i] * Math.sin(a), z0 = land.cl[i] * Math.cos(a), y0 = land.sl[i];
        const y = y0 * cT - z0 * sT, z = y0 * sT + z0 * cT;
        if (z <= 0.02) continue;
        const px = cx + R * x, py = cy - R * y;
        if (py > h + 4 || px < -4 || px > w + 4) continue;
        const d = x * SUN[0] + y * SUN[1] + z * SUN[2];
        const k = d > 0.18 ? 3 : d > 0.05 ? 2 : d > -0.06 ? 1 : 0;
        const rot = Math.atan2(-y, x), rx = blob * Math.max(0.22, z), qx = px * LK, qy = py * LK;
        paths[k].moveTo(qx + rx * Math.cos(rot), qy + rx * Math.sin(rot));
        paths[k].ellipse(qx, qy, rx, blob, rot, 0, TAU);
      }
      const lw = Math.ceil(w * LK) + 2, lh = Math.ceil(h * LK) + 2;
      if (!landLayer || landLayer.width !== lw || landLayer.height !== lh) {
        landLayer = document.createElement('canvas');
        landLayer.width = lw;
        landLayer.height = lh;
      }
      const lc = landLayer.getContext('2d');
      lc.clearRect(0, 0, lw, lh);
      for (let k = 0; k < 4; k++) { lc.fillStyle = LC[k]; lc.fill(paths[k]); }
      // recorte ao disco na camada pequena (um recorte no ecrã inteiro custa muito mais)
      lc.globalCompositeOperation = 'destination-in';
      lc.beginPath();
      lc.arc(cx * LK, cy * LK, R * LK, 0, TAU);
      lc.fill();
      lc.globalCompositeOperation = 'source-over';
      // bilinear chega (manchas macias); 'high' custa várias vezes mais em ecrã inteiro
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(landLayer, 0, 0, lw / LK, lh / LK);

      // luzes das cidades no lado noturno
      ctx.globalCompositeOperation = 'lighter';
      const lp = [new Path2D(), new Path2D(), new Path2D()];
      const glow = new Path2D();
      const ls = Math.max(1.1, R / 520);
      for (let i = 0; i < lights.n; i++) {
        const a = lights.lon[i] - lon0;
        const x = lights.cl[i] * Math.sin(a), z0 = lights.cl[i] * Math.cos(a), y0 = lights.sl[i];
        const y = y0 * cT - z0 * sT, z = y0 * sT + z0 * cT;
        if (z <= 0.04) continue;
        const d = x * SUN[0] + y * SUN[1] + z * SUN[2];
        if (d > 0.08) continue;
        const px = cx + R * x, py = cy - R * y;
        if (py > h + 4 || px < -4 || px > w + 4) continue;
        const b = lights.b[i] * Math.min(1, (0.08 - d) * 6) * (0.8 + 0.2 * Math.sin(t * 1.7 + lights.p[i]));
        const k = b > 0.7 ? 2 : b > 0.4 ? 1 : 0;
        if (b < 0.12) continue;
        lp[k].rect(px, py, ls * (k + 1) * 0.8, ls * (k + 1) * 0.8 * (0.5 + 0.5 * z));
        if (k === 2) { glow.moveTo(px + ls * 5, py); glow.arc(px, py, ls * 5, 0, TAU); }
      }
      ctx.fillStyle = 'rgba(255,170,70,0.05)';
      ctx.fill(glow);
      const LL = ['rgba(255,170,80,0.45)', 'rgba(255,196,110,0.7)', 'rgba(255,230,170,0.95)'];
      for (let k = 0; k < 3; k++) { ctx.fillStyle = LL[k]; ctx.fill(lp[k]); }
      ctx.globalCompositeOperation = 'source-over';

      drawAurora(ctx, cx, cy, R, lon0, t, w, h);
      blitLayer(ctx, L.over);
    }

    // cortinas de aurora boreal sobre o anel de latitude ~66°N, só do lado noturno
    function drawAurora(ctx, cx, cy, R, lon0, t, w, h) {
      const lat = 66 * RAD, sl = Math.sin(lat), cl = Math.cos(lat);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const N = 110;
      const pulse = 0.65 + 0.35 * Math.sin(t * 0.31);
      for (let i = 0; i < N; i++) {
        const lon = (i / N) * TAU;
        const a = lon - lon0;
        const x = cl * Math.sin(a), z0 = cl * Math.cos(a);
        const y = sl * cT - z0 * sT, z = sl * sT + z0 * cT;
        // só as cortinas junto ao horizonte (a aurora vista de lado, a erguer-se sobre o limbo)
        if (z < -0.06 || z > 0.4) continue;
        const d = x * SUN[0] + y * SUN[1] + z * SUN[2];
        if (d > 0.1) continue;
        const px = cx + R * x, py = cy - R * y;
        if (px < -20 || px > w + 20 || py > h) continue;
        const wave = 0.5 + 0.5 * Math.sin(t * 0.9 + i * 0.37) * Math.sin(t * 0.23 + i * 0.11 + Math.sin(i * 1.7));
        const L = R * (0.03 + 0.08 * wave) * (1.2 - z);
        const al = 0.06 * pulse * (0.3 + wave) * Math.min(1, (0.1 - d) * 5) * (1 - z * 2);
        if (al < 0.004) continue;
        const bw = Math.max(1.5, R / 260);
        ctx.fillStyle = 'rgba(70,255,170,' + (al * 1.6).toFixed(3) + ')';
        ctx.fillRect(px, py - L * 0.35, bw, L * 0.35);
        ctx.fillStyle = 'rgba(80,240,200,' + al.toFixed(3) + ')';
        ctx.fillRect(px, py - L * 0.75, bw, L * 0.4);
        ctx.fillStyle = 'rgba(150,120,255,' + (al * 0.55).toFixed(3) + ')';
        ctx.fillRect(px, py - L, bw, L * 0.25);
      }
      ctx.restore();
    }

    // OVNI ocasional: risco luminoso a atravessar o céu
    function drawUfo(ctx, w, h, t) {
      if (reduceMotion()) return;
      if (!ufo && t > nextUfo) {
        const ltr = rnd() < 0.5;
        const y0 = h * (0.08 + rnd() * 0.3), y1 = y0 + h * (rnd() * 0.25 - 0.05);
        ufo = { x0: ltr ? -40 : w + 40, x1: ltr ? w * (0.55 + rnd() * 0.5) : w * (0.45 - rnd() * 0.5), y0, y1, t0: t, dur: 1.6 + rnd() * 1.4 };
        nextUfo = t + 10 + rnd() * 12;
      }
      if (!ufo) {
        if (nextUfo === 0) nextUfo = t + 4;
        return;
      }
      const k = (t - ufo.t0) / ufo.dur;
      if (k >= 1) { ufo = null; return; }
      const e = 1 - Math.pow(1 - k, 2);
      const x = ufo.x0 + (ufo.x1 - ufo.x0) * e, y = ufo.y0 + (ufo.y1 - ufo.y0) * e;
      const dx = ufo.x1 - ufo.x0, dy = ufo.y1 - ufo.y0, m = Math.hypot(dx, dy) || 1;
      const len = 140 * (1 - k * 0.6);
      const fade = k < 0.8 ? 1 : (1 - k) / 0.2;
      const tx = x - (dx / m) * len, ty = y - (dy / m) * len;
      const g = ctx.createLinearGradient(tx, ty, x, y);
      g.addColorStop(0, 'rgba(120,255,220,0)');
      g.addColorStop(1, 'rgba(160,255,230,' + (0.55 * fade).toFixed(3) + ')');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      const pul = 0.6 + 0.4 * Math.sin(t * 24);
      ctx.fillStyle = 'rgba(255,120,90,' + (0.25 * fade * pul).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(230,255,250,' + (0.95 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(x, y, 3.2, 1.3, Math.atan2(dy, dx), 0, TAU);
      ctx.fill();
    }

    // larga as telas em cache (fundo e camadas estáticas); draw() volta a criá-las quando o menu reaparece
    function release() {
      snap = null;
      snapKey = '';
      snapT = -1;
      stat = null;
    }
    return { draw, geom, release };
  })();

  // ================================================================================================
  // Infraestrutura comum dos ecrãs: raiz DOM com transição, Esc = voltar, navegação por setas
  // ================================================================================================
  function mount(cls) {
    const host = OV.Dom.$('hud');
    const root = el('div', { class: 'scr ' + cls });
    root.addEventListener('keydown', (e) => {
      // Esc dentro de um campo: sai do campo (o segundo Esc volta atrás)
      const tag = (e.target && e.target.tagName) || '';
      if (e.key === 'Escape' && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')) { e.preventDefault(); e.target.blur(); }
    });
    host.appendChild(root);
    return root;
  }
  function unmount(root) {
    if (!root) return;
    root.classList.add('scr-leaving');
    root.setAttribute('aria-hidden', 'true');
    setTimeout(() => root.remove(), 170);
  }

  // setas ←/→ dentro de um grupo segmentado e ↑/↓ entre focáveis do ecrã
  function arrowNav(root, ev) {
    const a = document.activeElement;
    if (!a || !root.contains(a)) return false;
    if (a.classList.contains('scr-seg-b') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      const sibs = [...a.parentNode.querySelectorAll('.scr-seg-b:not(:disabled)')];
      const i = sibs.indexOf(a) + (ev.key === 'ArrowRight' ? 1 : -1);
      const b = sibs[(i + sibs.length) % sibs.length];
      if (b) { b.focus(); b.click(); }
      return true;
    }
    return false;
  }

  function makeScreen(id, spec) {
    const sc = {
      id,
      isScreen: spec.isScreen !== false,
      root: null,
      enter() {
        sc.root = mount('scr-' + id + (spec.cls ? ' ' + spec.cls : ''));
        spec.build(sc.root, sc);
        if (spec.focus) setTimeout(() => { const f = spec.focus(sc); if (f && sc.root && sc.root.isConnected) f.focus({ preventScroll: true }); }, 0);
      },
      exit() {
        if (spec.exit) spec.exit(sc);
        unmount(sc.root);
        sc.root = null;
      },
      pause() { if (sc.root) sc.root.classList.add('scr-paused'); },
      resume(result) {
        if (sc.root) sc.root.classList.remove('scr-paused');
        if (spec.resume) spec.resume(sc, result);
      },
      think(dt) { if (spec.think) spec.think(dt, sc); },
      draw(ctx, view) { if (spec.backdrop !== false) Backdrop.draw(ctx, view, spec.backdrop); },
      onInput(ev) {
        if (ev.kind !== 'key') return false;
        if (spec.keys && spec.keys(ev, sc)) return true;
        if (sc.root && arrowNav(sc.root, ev)) return true;
        if (ev.key === 'Escape' && spec.back) { sfx('ui_click'); spec.back(sc); return true; }
        return false;
      },
      onResize() {},
    };
    return sc;
  }

  // pop seguro: nunca deixa a pilha vazia
  function goBack() {
    if (OV.Scenes.stack.length > 1) OV.Scenes.pop();
    else OV.Scenes.set('menu');
  }

  // controlo segmentado: [{v, label, title?}]
  function seg(spec) {
    const wrap = el('div', { class: 'scr-seg' + (spec.cls ? ' ' + spec.cls : ''), role: 'radiogroup', 'aria-label': spec.label || null });
    const btns = spec.options.map((o) => {
      const b = el('button', { type: 'button', class: 'scr-seg-b', role: 'radio', title: o.title || null, dataset: { v: String(o.v) } }, o.label);
      b.addEventListener('click', () => {
        if (b.disabled || spec.get() === o.v) return;
        sfx('ui_click');
        spec.set(o.v);
      });
      wrap.appendChild(b);
      return { b, v: o.v };
    });
    wrap.refresh = () => {
      const cur = spec.get();
      for (const { b, v } of btns) {
        const on = v === cur;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        b.disabled = !!(spec.disabled && spec.disabled(v));
      }
      if (!btns.some(({ v }) => v === cur)) for (const x of btns) if (!x.b.disabled) { x.b.tabIndex = 0; break; }
    };
    wrap.refresh();
    return wrap;
  }
  // interruptor ligado/desligado
  function toggleBtn(get, set, label) {
    const b = el('button', { type: 'button', class: 'scr-switch', role: 'switch', 'aria-label': label || null });
    const knob = el('i');
    const txt = el('span');
    b.append(knob, txt);
    b.refresh = () => {
      const on = !!get();
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      txt.textContent = T(on ? 'scr.opt.on' : 'scr.opt.off');
    };
    b.addEventListener('click', () => { set(!get()); sfx('ui_click'); b.refresh(); });
    b.refresh();
    return b;
  }
  function slider(get, set, label) {
    const out = el('output', { class: 'scr-range-v' });
    const inp = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': label || null });
    inp.value = String(Math.round((get() || 0) * 100));
    const upd = () => { out.textContent = inp.value + ' %'; inp.style.setProperty('--p', inp.value + '%'); };
    inp.addEventListener('input', () => { set(+inp.value / 100); upd(); });
    inp.addEventListener('change', () => sfx('ui_click'));
    upd();
    return el('div', { class: 'scr-range' }, inp, out);
  }
  function header(kicker, title, extra) {
    return el('header', { class: 'scr-head' },
      el('div', { class: 'scr-kicker', text: kicker }),
      el('h1', { class: 'scr-title', text: title }),
      extra || null);
  }
  function panelSection(title, ...children) {
    return el('section', { class: 'scr-sec' }, el('h2', { class: 'scr-sec-t', text: title }), ...children);
  }

  // ================================================================================================
  // Gravações (OV.Save opcional: list() ou slots(); read()/fromJSON() ou load())
  // ================================================================================================
  function saves() {
    const S = OV.Save;
    if (!S || (typeof S.list !== 'function' && typeof S.slots !== 'function')) return [];
    let raw;
    try { raw = typeof S.list === 'function' ? S.list() : S.slots(); } catch (e) { return []; }
    if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = Object.keys(raw).map((k) => Object.assign({ slot: k }, raw[k]));
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => (e !== null && typeof e === 'object' ? e : { slot: e }))
      .filter((e) => e && e.empty !== true && e.exists !== false && (e.slot !== undefined || e.id !== undefined || e.key !== undefined))
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }
  const slotOf = (e) => (e.slot !== undefined ? e.slot : e.id !== undefined ? e.id : e.key);
  function saveLabel(e) {
    const s = slotOf(e);
    if (e.label) return e.label;
    if (s === 'auto' || s === 'autoTurn') return T('scr.load.auto');
    return T('scr.load.slot', { n: s });
  }
  function loadFailed() {
    OV.Dom.modal({ title: T('scr.load.title'), body: T('scr.load.failed'), cls: 'alert' });
  }
  function openSave(entry) {
    const S = OV.Save;
    let st = null;
    try {
      if (typeof S.load === 'function') st = S.load(slotOf(entry));
      else if (typeof S.read === 'function') {
        const obj = S.read(slotOf(entry));
        st = obj && typeof S.fromJSON === 'function' ? S.fromJSON(obj) : obj;
      }
    } catch (e) { st = null; }
    resumeGame(st);
  }
  function resumeGame(st) {
    if (!st || (!st.G && !st.B)) { loadFailed(); return false; }
    OV.Game.G = st.G || null;
    OV.Game.B = st.B || null;
    if (st.B && OV.SceneDefs.battlescape) {
      OV.Scenes.set('battlescape', { B: st.B, G: st.G || null, onExit: battleExit(st.B, { G: st.G || null }) });
      return true;
    }
    if (st.G && OV.SceneDefs.geoscape) {
      OV.Scenes.set('geoscape', { G: st.G });
      return true;
    }
    OV.Dom.modal({ title: T('scr.load.title'), body: T('scr.load.noScene') });
    return false;
  }
  function loadDialog() {
    const S = OV.Save;
    if (!S) { OV.Dom.modal({ title: T('scr.load.title'), body: T('scr.load.unavailable') }); return; }
    const list = saves();
    const body = el('div', { class: 'scr-load' });
    let chosen = null;
    if (!list.length) body.appendChild(el('p', { class: 'scr-muted', text: T('scr.load.empty') }));
    const done = (v) => { chosen = v; const b = document.querySelector('#modals .modal-back:last-child'); if (b) b.click(); };
    for (const e of list) {
      body.appendChild(el('button', { type: 'button', class: 'scr-load-row', onclick: () => done(e) },
        el('b', { text: saveLabel(e) }),
        el('span', { class: 'scr-muted', text: e.savedAt ? new Date(e.savedAt).toLocaleString('pt-PT') : '' })));
    }
    const buttons = [{ label: T('common.cancel'), value: null }];
    if (typeof S.importFile === 'function') buttons.unshift({ label: T('scr.load.import'), value: 'import' });
    OV.Dom.modal({ title: T('scr.load.title'), body, buttons, wide: false }).then((v) => {
      if (chosen) { openSave(chosen); return; }
      if (v === 'import') {
        OV.Dom.pickFile().then((text) => {
          if (!text) return;
          let st = null;
          try {
            const r = S.importFile(text);
            st = r && (r.G || r.B) ? r : r && typeof S.fromJSON === 'function' ? S.fromJSON(r) : null;
          } catch (e) { st = null; }
          resumeGame(st);
        });
      }
    });
  }

  // ================================================================================================
  // Missão rápida: definições → especificação de missão (OV.Battle.quickMission + equipamento por nível)
  // ================================================================================================
  function defaultQuick() {
    return { kind: 'crash', ufo: 'small_scout', terrain: 'auto', time: 'day', diff: 0, month: 0, squad: 8, seed: uiRng.int(1, 99999) };
  }
  function sanitizeQuick(q) {
    const d = defaultQuick();
    const o = Object.assign({}, d, q || {});
    if (KINDS.indexOf(o.kind) < 0) o.kind = d.kind;
    if (!D().ufos[o.ufo]) o.ufo = d.ufo;
    if (TERRAINS.indexOf(o.terrain) < 0) o.terrain = 'auto';
    if (TIMES.indexOf(o.time) < 0) o.time = 'day';
    o.diff = OV.U.clamp(o.diff | 0, 0, 2);
    o.month = OV.U.clamp(o.month | 0, 0, 4);
    o.squad = OV.U.clamp(o.squad | 0 || 8, 4, maxSquad(o.kind));
    o.seed = (o.seed >>> 0) || 1;
    return o;
  }
  function maxSquad(kind) {
    const craft = D().crafts[kind === 'cydonia' ? 'avenger' : 'skyranger'];
    return Math.min(10, (craft && craft.seatsUI) || 10);
  }

  /* Equipamento por nível tecnológico («Mês»): 0 espingardas; 1 + armadura pessoal; 2 lasers + kits médicos;
     3 laser pesado/plasma + fato energético; 4 kit de Cidónia. k = posição na equipa (3 e 7 levam a arma pesada). */
  function loadoutFor(tier, k, night) {
    const heavy = k === 3 || k === 7;
    let lo, armour;
    switch (OV.U.clamp(tier | 0, 0, 4)) {
      case 0:
        lo = heavy ? { R: 'rocket_launcher', belt: ['grenade'], pack: ['small_rocket', 'small_rocket'] }
          : { R: 'rifle', belt: ['rifle_clip', 'rifle_clip', 'grenade'], pack: [] };
        armour = 'coveralls';
        break;
      case 1:
        lo = heavy ? { R: 'heavy_cannon', belt: ['hc_ap', 'hc_he'], pack: [] }
          : { R: 'rifle', belt: ['rifle_clip', 'rifle_clip', 'grenade', 'grenade'], pack: [] };
        armour = 'personal_armour';
        break;
      case 2:
        lo = heavy ? { R: 'heavy_laser', belt: ['grenade', 'grenade'], pack: [] }
          : { R: 'laser_rifle', belt: ['grenade', 'grenade', 'smoke_grenade'], pack: [] };
        armour = 'personal_armour';
        break;
      case 3:
        lo = heavy ? { R: 'heavy_laser', belt: ['grenade', 'grenade', 'proximity_grenade'], pack: [] }
          : { R: 'plasma_rifle', belt: ['plasma_rifle_clip', 'plasma_rifle_clip', 'grenade'], pack: [] };
        armour = 'power_suit';
        break;
      default:
        lo = heavy ? { R: 'blaster_launcher', belt: ['high_explosive'], pack: ['blaster_bomb', 'blaster_bomb'] }
          : { R: 'heavy_plasma', belt: ['heavy_plasma_clip', 'heavy_plasma_clip', 'high_explosive'], pack: [] };
        armour = 'flying_suit';
    }
    lo.L = null;
    if (tier >= 2 && (k === 1 || k === 5)) lo.pack.push('medikit');
    if (tier >= 1 && k === 0) lo.pack.push('motion_scanner');
    if (night) lo.pack.push('electro_flare', 'electro_flare');
    return { lo, armour };
  }

  function shadeFor(time) {
    if (time === 'night') return tune('SHADE_NIGHT', 13);
    if (time === 'dusk') return tune('SHADE_DUSK', 6);
    return tune('SHADE_DAY', 0);
  }

  // definições rápidas → {mission, meta}
  function buildQuickMission(q) {
    const qs = sanitizeQuick(q);
    const Data = D();
    const pickRng = OV.RNG.create((qs.seed ^ 0x9e3779b9) >>> 0);
    const ufoKind = !!UFO_KINDS[qs.kind];
    const terrain = KIND_TERRAIN[qs.kind] || (qs.terrain === 'auto' ? pickRng.pick(UFO_TERRAINS) : qs.terrain);
    const fixedShade = qs.kind === 'alienBase' || qs.kind === 'cydonia';
    const mission = OV.Battle.quickMission({
      kind: qs.kind, ufoType: ufoKind ? qs.ufo : null, landed: qs.kind === 'landed', terrain,
      night: qs.time === 'night', shade: fixedShade ? undefined : shadeFor(qs.time),
      difficulty: qs.diff, month: qs.month, squadSize: qs.squad, seed: qs.seed,
    });
    mission.squad.forEach((s, k) => {
      const { lo, armour } = loadoutFor(qs.month, k, qs.time === 'night' || fixedShade);
      s.loadout = lo;
      s.armour = armour;
    });
    mission.settings = { instantGrenades: settings().instantGrenades !== false };
    const meta = { quick: qs, time: fixedShade ? 'night' : qs.time, terrain };
    if (qs.kind === 'terror' && Data.cities && Data.cities.length) meta.cityKey = pickRng.pick(Data.cities).nameKey;
    return { mission, meta };
  }

  // ?battle=… (QA e atalhos)
  function quickFromURL(p) {
    const b = p && p.get && p.get('battle');
    if (!b) return null;
    const q = defaultQuick();
    if (b === 'terror' || b === 'alienBase' || b === 'cydonia') q.kind = b;
    else {
      q.kind = p.get('landed') === '1' ? 'landed' : 'crash';
      q.ufo = D().ufos[b] ? b : 'small_scout';
    }
    q.time = p.get('night') === '1' ? 'night' : p.get('dusk') === '1' ? 'dusk' : 'day';
    q.seed = p.get('seed') !== null ? (+p.get('seed') >>> 0) || 1 : 1;
    if (p.get('diff') !== null) q.diff = +p.get('diff') | 0;
    if (p.get('month') !== null) q.month = +p.get('month') | 0;
    if (p.get('terrain')) q.terrain = String(p.get('terrain')).toUpperCase();
    if (p.get('squad') !== null) q.squad = +p.get('squad') | 0;
    return sanitizeQuick(q);
  }

  function missionTitle(M, meta) {
    const kind = T('bs.mission.' + M.kind);
    const ufo = M.ufoType && D().ufos[M.ufoType];
    if (UFO_KINDS[M.kind] && ufo) return T('scr.br.title.sub', { kind, name: T(ufo.nameKey) });
    if (M.kind === 'terror' && meta && meta.cityKey) return T('scr.br.title.sub', { kind, name: T(meta.cityKey) });
    return kind;
  }

  // fim da batalha → relatório (substitui o battlescape se ainda estiver no topo)
  function battleExit(B, extra) {
    let fired = false;
    return function (result) {
      if (fired) return;
      fired = true;
      const r = result || {};
      let deb = r.debrief;
      if (!deb) { try { deb = OV.Battle.debrief(B); } catch (e) { deb = null; } }
      if (OV.Game.B === B) OV.Game.B = null;
      const p = Object.assign({ B, outcome: r.outcome || (deb && deb.result) || 'abort', debrief: deb, stingerPlayed: true }, extra || {});
      const top = OV.Scenes.top();
      if (top && top.id === 'battlescape') OV.Scenes.replace('debrief', p);
      else OV.Scenes.push('debrief', p);
    };
  }

  // cria B e entra no battlescape (substitui a cena do topo)
  function startBattle(mission, meta) {
    if (!OV.SceneDefs.battlescape) {
      OV.Dom.modal({ title: missionTitle(OV.Battle.normalizeMission(mission), meta), body: T('scr.br.noBattle') });
      return false;
    }
    let B;
    try { B = OV.Battle.create(mission); } catch (e) {
      OV.Dom.modal({ title: T('scr.br.errorTitle'), body: OV.U.esc(T('scr.br.error', { msg: e && e.message ? e.message : String(e) })), cls: 'alert' });
      return false;
    }
    OV.Game.B = B;
    sfx('ui_confirm');
    const m = meta || {};
    OV.Scenes.replace('battlescape', { B, mission, meta: m, onExit: battleExit(B, { mission, meta: m, quick: m.quick || null }) });
    return true;
  }

  // ================================================================================================
  // Cena: menu principal
  // ================================================================================================
  OV.SceneDefs.menu = function () {
    let items = [];
    let sel = 0;
    let cont = null;

    function newCampaign() {
      if (OV.SceneDefs.newgame) { OV.Scenes.push('newgame', {}); return; }
      OV.Dom.modal({
        title: T('scr.newgame.title'), body: T('scr.newgame.soon'),
        buttons: [{ label: T('common.close'), value: false }, { label: T('scr.newgame.quick'), value: true, kind: 'primary' }],
      }).then((v) => { if (v) OV.Scenes.push('quickbattle', {}); });
    }
    function continueGame() {
      const latest = saves()[0];
      if (latest) openSave(latest);
    }
    const ENTRIES = [
      { id: 'new', key: 'scr.menu.new', act: newCampaign },
      { id: 'continue', key: 'scr.menu.continue', act: continueGame },
      { id: 'quick', key: 'scr.menu.quick', act: () => OV.Scenes.push('quickbattle', {}) },
      { id: 'load', key: 'scr.menu.load', act: loadDialog },
      { id: 'options', key: 'scr.menu.options', act: () => OV.Scenes.push('options', {}) },
      { id: 'howto', key: 'scr.menu.howto', act: () => OV.Scenes.push('howto', {}) },
      { id: 'credits', key: 'scr.menu.credits', act: () => OV.Scenes.push('credits', {}) },
    ];

    function setSel(i, focus) {
      const n = items.length;
      const dir = i >= sel ? 1 : -1;
      i = ((i % n) + n) % n;
      for (let k = 0; k < n && items[i].b.disabled; k++) i = (((i + dir) % n) + n) % n;
      if (i !== sel) sfx('ui_select');
      sel = i;
      items.forEach((it, k) => it.b.classList.toggle('sel', k === sel));
      if (focus !== false) items[sel].b.focus({ preventScroll: true });
    }
    function refreshContinue() {
      const latest = saves()[0];
      cont.b.disabled = !latest;
      cont.hint.textContent = latest ? T('scr.menu.continue.hint', { label: saveLabel(latest) }) : T('scr.menu.continue.none');
    }

    return makeScreen('menu', {
      backdrop: {},
      build(root) {
        items = ENTRIES.map((e) => {
          const hint = el('span', { class: 'scr-mi-hint', text: T(e.key + '.hint') });
          const b = el('button', { type: 'button', class: 'scr-mi', role: 'menuitem', dataset: { id: e.id } },
            el('span', { class: 'scr-mi-mark', 'aria-hidden': 'true' }),
            el('span', { class: 'scr-mi-label', text: T(e.key) }), hint);
          const it = { b, hint, e };
          b.addEventListener('click', () => { sfx('ui_confirm'); e.act(); });
          b.addEventListener('pointerenter', () => { if (!b.disabled) setSel(items.indexOf(it), false); });
          b.addEventListener('focus', () => { if (items[sel] !== it) setSel(items.indexOf(it), false); });
          return it;
        });
        cont = items[1];
        root.append(
          el('div', { class: 'scr-menu-col' },
            el('header', { class: 'scr-logo' },
              el('div', { class: 'scr-logo-big', text: T('scr.logo.big') }),
              el('div', { class: 'scr-logo-small', text: T('scr.logo.small') }),
              el('div', { class: 'scr-logo-sub', text: T('game.subtitle') })),
            el('nav', { class: 'scr-menu-list', role: 'menu', 'aria-label': T('game.title') }, items.map((it) => it.b)),
            el('div', { class: 'scr-menu-foot' },
              el('a', { class: 'scr-family', href: '../index.html', text: T('scr.menu.family') }),
              el('span', { class: 'scr-keys', text: T('scr.menu.keys') }))),
          el('div', { class: 'scr-version', text: T('scr.version', { v: VERSION }) }));
        refreshContinue();
        sel = cont.b.disabled ? 2 : 1;
        setSel(sel, false);
        music('menu');
      },
      focus: () => items[sel] && items[sel].b,
      resume() {
        refreshContinue();
        if (items[sel].b.disabled) setSel(2, false);
        setTimeout(() => { if (items[sel]) items[sel].b.focus({ preventScroll: true }); }, 0);
        music('menu');
      },
      keys(ev) {
        const k = ev.key;
        if (k === 'ArrowDown' || k === 's' || k === 'S') { setSel(sel + 1); return true; }
        if (k === 'ArrowUp' || k === 'w' || k === 'W') { setSel(sel - 1); return true; }
        if (k === 'Home') { setSel(0); return true; }
        if (k === 'End') { setSel(items.length - 1); return true; }
        if (k === 'Enter' || k === ' ') {
          const a = document.activeElement;
          if (a && a.classList.contains('scr-family')) { a.click(); return true; }
          const it = items[sel];
          if (it && !it.b.disabled) it.b.click();
          return true;
        }
        return false;
      },
    });
  };

  // ================================================================================================
  // Cena: batalha rápida (formulário)
  // ================================================================================================
  OV.SceneDefs.quickbattle = function (params) {
    const urlQuick = params && params.params && !OV.Screens._urlUsed ? quickFromURL(params.params) : null;
    if (urlQuick) OV.Screens._urlUsed = true;
    let q = sanitizeQuick(lsGet('ovni1999.quick') || {});
    if (!(lsGet('ovni1999.quick') || {}).seed) q.seed = uiRng.int(1, 99999);
    const controls = [];
    let summary = null, startBtn = null, seedInp = null, squadOut = null, squadInp = null, autoGo = !!urlQuick;

    function set(k, v) {
      q[k] = v;
      q = sanitizeQuick(q);
      refresh();
    }
    function refresh() {
      for (const c of controls) c.refresh();
      if (squadInp) {
        squadInp.max = String(maxSquad(q.kind));
        squadInp.value = String(q.squad);
        squadOut.textContent = T('scr.qb.squadN', { n: q.squad });
        squadInp.style.setProperty('--p', ((q.squad - 4) / Math.max(1, maxSquad(q.kind) - 4)) * 100 + '%');
      }
      if (seedInp && +seedInp.value !== q.seed) seedInp.value = String(q.seed);
      renderSummary();
    }
    function renderSummary() {
      if (!summary) return;
      OV.Dom.clear(summary);
      let built;
      try { built = buildQuickMission(q); } catch (e) { built = null; }
      if (!built) return;
      const M = OV.Battle.normalizeMission(built.mission);
      const range = D().deploymentRange(M.deploymentId, q.diff);
      const race = D().races[M.race];
      const sprite = race && race.members && race.members.soldier ? unitSpriteEl(race.members.soldier, 64) : null;
      const s0 = built.mission.squad[0], s3 = built.mission.squad[3];
      const kit = el('div', { class: 'scr-kit' }, itemIconEl(s0.loadout.R, 44), s3 ? itemIconEl(s3.loadout.R, 44) : null,
        built.mission.squad.some((s) => s.loadout.pack.indexOf('medikit') >= 0) ? itemIconEl('medikit', 36) : null,
        built.meta.time === 'night' ? itemIconEl('electro_flare', 32) : null);
      summary.append(
        el('div', { class: 'scr-sum-kicker', text: T('scr.qb.summary') }),
        el('div', { class: 'scr-sum-title', text: missionTitle(M, built.meta) }),
        el('div', { class: 'scr-chips' },
          el('span', { class: 'scr-chip', text: T('terrain.' + M.terrain) }),
          el('span', { class: 'scr-chip t-' + built.meta.time, text: T('scr.time.' + built.meta.time) }),
          el('span', { class: 'scr-chip', text: T('diff.' + q.diff) })),
        el('div', { class: 'scr-sum-race' }, sprite || null,
          el('div', null,
            el('div', { class: 'scr-sum-k', text: T('scr.br.race') }),
            el('div', { class: 'scr-sum-v', text: race ? T(race.pluralKey || race.nameKey) : '—' }),
            el('div', { class: 'scr-sum-k', text: T('scr.qb.crew') }),
            el('div', { class: 'scr-sum-v', text: range ? T('scr.qb.crewRange', range) : '—' }))),
        el('div', { class: 'scr-sum-k', text: T('scr.qb.kit') }),
        kit,
        el('div', { class: 'scr-sum-k', text: T('scr.qb.armour') }),
        el('div', { class: 'scr-sum-v', text: T(D().armours[s0.armour].nameKey) }));
    }
    function start() {
      lsSet('ovni1999.quick', q);
      let built;
      try { built = buildQuickMission(q); } catch (e) {
        OV.Dom.modal({ title: T('scr.br.errorTitle'), body: OV.U.esc(T('scr.br.error', { msg: e.message || String(e) })), cls: 'alert' });
        return;
      }
      sfx('ui_confirm');
      OV.Scenes.push('briefing', { mission: built.mission, meta: built.meta, quick: q });
    }
    function row(label, ctl, note) {
      return el('div', { class: 'scr-frow' }, el('div', { class: 'scr-flabel', text: label }), el('div', { class: 'scr-fctl' }, ctl, note || null));
    }

    return makeScreen('quickbattle', {
      backdrop: { dim: 0.45 },
      build(root) {
        const ufoIds = Object.keys(D().ufos);
        const cKind = seg({ label: T('scr.qb.mission'), options: KINDS.map((k) => ({ v: k, label: T('scr.qb.kind.' + k) })), get: () => q.kind, set: (v) => set('kind', v), cls: 'wrap' });
        const cUfo = seg({
          label: T('scr.qb.ufo'), options: ufoIds.map((id) => ({ v: id, label: T(D().ufos[id].nameKey) })), get: () => (UFO_KINDS[q.kind] ? q.ufo : null),
          set: (v) => set('ufo', v), disabled: () => !UFO_KINDS[q.kind], cls: 'grid4',
        });
        const ufoNote = el('div', { class: 'scr-fnote' });
        const cTerrain = seg({
          label: T('scr.qb.terrain'), options: TERRAINS.map((t) => ({ v: t, label: t === 'auto' ? T('scr.qb.terrain.auto') : T('terrain.' + t) })),
          get: () => (KIND_TERRAIN[q.kind] ? null : q.terrain), set: (v) => set('terrain', v), disabled: () => !!KIND_TERRAIN[q.kind], cls: 'grid4',
        });
        const terrNote = el('div', { class: 'scr-fnote' });
        const cTime = seg({
          label: T('scr.qb.time'), options: TIMES.map((t) => ({ v: t, label: T('scr.time.' + t) })),
          get: () => (q.kind === 'alienBase' || q.kind === 'cydonia' ? null : q.time), set: (v) => set('time', v),
          disabled: () => q.kind === 'alienBase' || q.kind === 'cydonia',
        });
        const cDiff = seg({ label: T('scr.qb.diff'), options: [0, 1, 2].map((d) => ({ v: d, label: T('diff.' + d) })), get: () => q.diff, set: (v) => set('diff', v) });
        const cMonth = seg({
          label: T('scr.qb.month'), options: [0, 1, 2, 3, 4].map((m) => ({ v: m, label: String(m), title: T('scr.tier.' + m) })),
          get: () => q.month, set: (v) => set('month', v), cls: 'months',
        });
        const monthNote = el('div', { class: 'scr-fnote' });
        controls.push(cKind, cUfo, cTerrain, cTime, cDiff, cMonth,
          { refresh: () => { ufoNote.textContent = UFO_KINDS[q.kind] ? '' : T('scr.qb.ufo.none'); } },
          { refresh: () => { terrNote.textContent = KIND_TERRAIN[q.kind] ? T('scr.qb.terrain.fixed', { terrain: T('terrain.' + KIND_TERRAIN[q.kind]) }) : ''; } },
          { refresh: () => { monthNote.textContent = T('scr.tier.' + q.month); } });

        squadInp = el('input', { type: 'range', min: '4', max: String(maxSquad(q.kind)), step: '1', 'aria-label': T('scr.qb.squad') });
        squadOut = el('output', { class: 'scr-range-v' });
        squadInp.addEventListener('input', () => set('squad', +squadInp.value));
        squadInp.addEventListener('change', () => sfx('ui_click'));
        seedInp = el('input', { type: 'number', min: '1', max: '4294967295', class: 'scr-seed', 'aria-label': T('scr.qb.seed') });
        seedInp.addEventListener('change', () => set('seed', (+seedInp.value >>> 0) || 1));
        seedInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set('seed', (+seedInp.value >>> 0) || 1); start(); } });
        const reroll = el('button', { type: 'button', class: 'btn small ghost', text: T('scr.qb.seed.random'), onclick: () => { sfx('ui_click'); set('seed', uiRng.int(1, 99999)); } });

        startBtn = el('button', { type: 'button', class: 'btn primary scr-big', text: T('scr.qb.start'), onclick: start });
        summary = el('aside', { class: 'scr-summary' });
        root.append(el('div', { class: 'scr-panel scr-qb' },
          header(T('scr.qb.kicker'), T('scr.qb.title')),
          el('div', { class: 'scr-qb-body' },
            el('div', { class: 'scr-form' },
              row(T('scr.qb.mission'), cKind),
              row(T('scr.qb.ufo'), cUfo, ufoNote),
              row(T('scr.qb.terrain'), cTerrain, terrNote),
              row(T('scr.qb.time'), cTime),
              row(T('scr.qb.diff'), cDiff),
              row(T('scr.qb.month'), cMonth, monthNote),
              row(T('scr.qb.squad'), el('div', { class: 'scr-range' }, squadInp, squadOut)),
              row(T('scr.qb.seed'), el('div', { class: 'row' }, seedInp, reroll))),
            summary),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('scr.qb.hint') }),
            el('div', { class: 'scr-foot-btns' },
              el('button', { type: 'button', class: 'btn', text: T('scr.qb.back'), onclick: () => { sfx('ui_click'); goBack(); } }),
              startBtn))));
        refresh();
        if (autoGo) root.classList.add('scr-paused');
      },
      focus: () => startBtn,
      think() {
        if (!autoGo) return;
        autoGo = false;
        let built;
        try { built = buildQuickMission(urlQuick); } catch (e) { built = null; }
        const top = OV.Scenes.top();
        if (!built || !startBattle(built.mission, built.meta)) {
          if (top && top.root) top.root.classList.remove('scr-paused');
        }
      },
      keys(ev) {
        if (ev.key === 'Enter') {
          const a = document.activeElement;
          if (!a || a === document.body || a === startBtn) { start(); return true; }
        }
        return false;
      },
      back: goBack,
    });
  };

  // ================================================================================================
  // Cena: briefing
  // ================================================================================================
  OV.SceneDefs.briefing = function (params) {
    const p = params || {};
    const mission = p.mission;
    const meta = p.meta || {};
    const M = OV.Battle.normalizeMission(mission);
    let startBtn = null;

    function soldierCard(s) {
      const rank = D().soldierRank(s.rank | 0);
      const st = s.stats || {};
      const statCell = (k) => el('span', { class: 'scr-st' }, el('i', { text: T('stat.' + k + '.abbr') }), el('b', { text: String(st[k] | 0) }));
      return el('div', { class: 'scr-soldier' },
        portraitEl(s, 58),
        el('div', { class: 'scr-soldier-info' },
          el('div', { class: 'scr-soldier-name' }, el('span', { class: 'scr-rank r' + (s.rank | 0), text: rank ? T(rank.abbrKey) : '' }), el('b', { text: s.name || '' })),
          el('div', { class: 'scr-soldier-sub', text: [s.nat ? T('nat.' + s.nat) : '', Tn('scr.br.missions', s.missions | 0)].filter(Boolean).join(' · ') }),
          el('div', { class: 'scr-stats' }, ['tu', 'hp', 'fire', 'react', 'brav'].map(statCell))),
        el('div', { class: 'scr-soldier-kit' }, s.loadout && s.loadout.R ? itemIconEl(s.loadout.R, 40) : null));
    }

    return makeScreen('briefing', {
      backdrop: { dim: 0.55, tint: M.kind === 'terror' ? 'rgba(120,20,10,0.10)' : null },
      build(root) {
        const race = D().races[M.race];
        const range = D().deploymentRange(M.deploymentId, M.difficulty);
        const time = meta.time || (M.night ? 'night' : 'day');
        const sprite = race && race.members && race.members.soldier ? unitSpriteEl(race.members.soldier, 86) : null;
        const notes = [];
        if (time === 'night') notes.push(T('scr.br.note.night'));
        if (time === 'dusk') notes.push(T('scr.br.note.dusk'));
        if (M.kind === 'crash') notes.push(T('scr.br.note.crash'));
        if (M.kind === 'terror') notes.push(T('scr.br.note.terror'));
        const craft = D().crafts[M.craftType];
        startBtn = el('button', { type: 'button', class: 'btn primary scr-big', text: T('scr.br.start'), onclick: () => startBattle(mission, meta) });
        root.append(el('div', { class: 'scr-panel scr-brief k-' + M.kind },
          header(T('scr.br.kicker'), missionTitle(M, meta),
            el('div', { class: 'scr-chips' },
              el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.terrain') }), T('terrain.' + M.terrain)),
              el('span', { class: 'scr-chip t-' + time }, el('i', { text: T('scr.br.time') }), T('scr.time.' + time)),
              el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.diff') }), T('diff.' + M.difficulty)),
              el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.tech') }), T('scr.tier.n', { n: M.month }) + ' · ' + T('scr.tier.' + OV.U.clamp(M.month, 0, 4))),
              craft ? el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.craft') }), T(craft.nameKey)) : null)),
          el('div', { class: 'scr-brief-body' },
            el('div', { class: 'scr-brief-left' },
              panelSection(T('scr.br.objectives'),
                el('ol', { class: 'scr-obj' },
                  el('li', { text: T('scr.br.obj.' + M.kind + '.1') }),
                  el('li', { text: T('scr.br.obj.' + M.kind + '.2') }),
                  el('li', { class: 'scr-muted', text: T('scr.br.obj.abort') }))),
              panelSection(T('scr.br.intel'),
                el('div', { class: 'scr-intel' }, sprite ? el('div', { class: 'scr-intel-sprite' }, sprite) : null,
                  el('dl', null,
                    el('dt', { text: T('scr.br.race') }), el('dd', { text: race ? T(race.pluralKey || race.nameKey) : '—' }),
                    el('dt', { text: T('scr.br.crew') }), el('dd', { text: range ? T('scr.qb.crewRange', range) : '—' }))),
                notes.map((n) => el('p', { class: 'scr-note', text: n })))),
            panelSection(T('scr.br.squad') + ' · ' + (mission.squad || []).length,
              el('div', { class: 'scr-roster' }, (mission.squad || []).map(soldierCard)))),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('scr.br.hint') }),
            el('div', { class: 'scr-foot-btns' },
              el('button', { type: 'button', class: 'btn', text: T('scr.br.back'), onclick: () => { sfx('ui_click'); backFromBrief(); } }),
              startBtn))));
      },
      focus: () => startBtn,
      keys(ev) {
        if (ev.key === 'Enter') { startBattle(mission, meta); return true; }
        return false;
      },
      back: backFromBrief,
    });
  };
  function backFromBrief() {
    if (OV.Scenes.stack.length > 1) { OV.Scenes.pop(); return; }
    OV.Scenes.set('menu');
    OV.Scenes.push('quickbattle', {});
  }

  // ================================================================================================
  // Cena: relatório da missão
  // ================================================================================================
  // avaliação da missão (orig: ≤ −200 terrível, ≤ 0 fraco, ≤ 200 razoável, ≤ 500 bom, senão excelente)
  function missionRating(total) {
    if (total <= -200) return 'terrible';
    if (total <= 0) return 'poor';
    if (total <= 200) return 'ok';
    if (total <= 500) return 'good';
    return 'excellent';
  }

  OV.SceneDefs.debrief = function (params) {
    const p = params || {};
    const B = p.B || null;
    const deb = p.debrief || (B ? OV.Battle.debrief(B) : null) || { result: p.outcome || 'abort', score: 0, lines: [], captured: [], recovered: {}, dead: [], mia: [], wounded: {}, soldiers: [], turns: 0 };
    const result = deb.result || p.outcome || 'abort';
    const mission = p.mission || (B && B.mission) || null;
    const quick = p.quick || (p.meta && p.meta.quick) || null;
    let contBtn = null;

    const unitBySid = new Map();
    if (B) for (const u of B.units) if (u.origSide === 'xcom' && u.type === 'soldier') unitBySid.set(u.soldierId !== null && u.soldierId !== undefined ? u.soldierId : u.id, u);
    const squadBySid = new Map();
    for (const s of (mission && mission.squad) || []) squadBySid.set(s.soldierId, s);
    const who = (sid) => {
      const s = squadBySid.get(sid) || {};
      const u = unitBySid.get(sid) || {};
      return { name: s.name || u.name || '?', rank: s.rank !== undefined ? s.rank : u.rank | 0, nat: s.nat || u.nat, female: s.female !== undefined ? s.female : u.female,
        portraitSeed: s.portraitSeed !== undefined ? s.portraitSeed : u.portraitSeed, armour: s.armour || u.armourId, stats: s.stats || u.stats, kills: u.kills | 0 };
    };

    // abatidos/capturados por tipo
    function alienTally() {
      const killed = {}, captured = {};
      if (B) for (const u of B.units) if (u.origSide === 'alien' && u.status === 'dead' && !u.crashDead) killed[u.type] = (killed[u.type] || 0) + 1;
      for (const c of deb.captured || []) captured[c.unitType] = (captured[c.unitType] || 0) + 1;
      return { killed, captured };
    }

    // progressão: a campanha pode fornecer p.progression; na batalha rápida é uma pré-visualização (stream de interface)
    function progression() {
      if (Array.isArray(p.progression)) return p.progression;
      const out = [];
      const rng = OV.RNG.create(((mission && mission.seed) ^ 0xdeb1ef) >>> 0);
      for (const s of deb.soldiers || []) {
        if (s.status !== 'ok') continue;
        const w = who(s.soldierId);
        let gains = {}, secondary = false;
        if (OV.Morale && OV.Morale.postMission && w.stats) {
          const r = OV.Morale.postMission(w.stats, s.exp || {}, rng);
          gains = r.gains;
          secondary = r.secondary;
        }
        const promoted = (w.rank | 0) === 0 && secondary ? 1 : null;
        out.push({ soldierId: s.soldierId, gains, promoted, kills: s.kills | 0 });
      }
      return out;
    }

    function again() {
      if (!quick) return;
      const q = Object.assign({}, quick, { seed: uiRng.int(1, 99999) });
      lsSet('ovni1999.quick', q);
      let built;
      try { built = buildQuickMission(q); } catch (e) { return; }
      sfx('ui_confirm');
      OV.Scenes.replace('briefing', { mission: built.mission, meta: built.meta, quick: q });
    }
    function cont() {
      sfx('ui_confirm');
      if (typeof p.onDone === 'function') { p.onDone(deb); return; }
      OV.Scenes.set('menu');
    }

    return makeScreen('debrief', {
      backdrop: { dim: 0.6, tint: result === 'win' ? null : 'rgba(110,16,10,0.10)' },
      build(root) {
        if (!p.stingerPlayed) stinger(result === 'win' ? 'victory' : 'defeat');
        const total = deb.score | 0;
        const rating = missionRating(total);
        const M = mission ? OV.Battle.normalizeMission(mission) : null;

        // pontuação
        const anyIcon = (deb.lines || []).some((l) => l.itemId);
        const scoreRows = (deb.lines || []).map((l) => {
          const icon = l.itemId ? itemIconEl(l.itemId, 26) : anyIcon ? el('span', { class: 'scr-sl-gap', 'aria-hidden': 'true' }) : null;
          return el('tr', null,
            el('td', { class: 'scr-sl' }, icon, el('span', { text: T(l.key) })),
            el('td', { class: 'scr-sn', text: '×' + (l.n | 0) }),
            el('td', { class: 'scr-sp ' + (l.points > 0 ? 'good' : l.points < 0 ? 'bad' : ''), text: (l.points > 0 ? '+' : '') + OV.U.fmtInt(l.points | 0) }));
        });
        const scoreSec = panelSection(T('bs.debrief.score'),
          scoreRows.length ? el('table', { class: 'scr-score' }, el('tbody', null, scoreRows)) : el('p', { class: 'scr-muted', text: T('scr.db.noScore') }),
          el('div', { class: 'scr-total r-' + rating },
            el('span', { text: T('bs.debrief.total') }),
            el('b', { text: (total > 0 ? '+' : '') + OV.U.fmtInt(total) }),
            el('span', { class: 'scr-rating' }, el('i', { text: T('scr.db.rating') }), T('rating.' + rating))));

        // alienígenas
        const tally = alienTally();
        const types = [...new Set(Object.keys(tally.killed).concat(Object.keys(tally.captured)))].sort();
        const alienSec = panelSection(T('scr.db.aliens'),
          types.length ? el('div', { class: 'scr-aliens' }, types.map((ty) => {
            const def = D().units[ty];
            return el('div', { class: 'scr-alien-row' },
              el('div', { class: 'scr-alien-pic' }, unitSpriteEl(ty, 40)),
              el('span', { class: 'scr-alien-name', text: def ? T(def.nameKey) : ty }),
              tally.killed[ty] ? el('span', { class: 'scr-tag bad', text: T('scr.db.killed') + ' ×' + tally.killed[ty] }) : null,
              tally.captured[ty] ? el('span', { class: 'scr-tag good', text: T('scr.db.captured') + ' ×' + tally.captured[ty] }) : null);
          })) : el('p', { class: 'scr-muted', text: T('scr.db.noAliens') }));

        // baixas (memorial)
        const fallen = (deb.dead || []).map((sid) => ({ sid, kia: true })).concat((deb.mia || []).map((sid) => ({ sid, kia: false })));
        const lossSec = panelSection(T('scr.db.losses'),
          fallen.length ? el('div', { class: 'scr-memorial' },
            el('div', { class: 'scr-mem-title', text: T('scr.db.memorial') }),
            fallen.map((f) => {
              const w = who(f.sid);
              const rank = D().soldierRank(w.rank | 0);
              return el('div', { class: 'scr-mem' }, portraitEl(w, 48, 'mem'),
                el('div', null,
                  el('div', { class: 'scr-mem-name' }, el('span', { class: 'scr-rank r' + (w.rank | 0), text: rank ? T(rank.abbrKey) : '' }), el('b', { text: w.name })),
                  el('div', { class: 'scr-muted', text: T(f.kia ? 'scr.db.kia' : 'scr.db.mia') + (w.kills ? ' · ' + Tn('bs.debrief.soldier.kills', w.kills) : '') })));
            })) : el('p', { class: 'scr-good-note', text: T('scr.db.noLosses') }));

        // feridos
        const wounded = Object.keys(deb.wounded || {});
        const woundSec = wounded.length ? panelSection(T('bs.debrief.wounded'),
          el('div', { class: 'scr-wounded' }, wounded.map((sid) => {
            const w = who(isNaN(+sid) ? sid : sid);
            return el('div', { class: 'scr-wound' }, el('b', { text: w.name }), el('span', { class: 'bad', text: T('scr.db.hpLost', { n: deb.wounded[sid] }) }));
          }))) : null;

        // material recuperado
        const rec = Object.keys(deb.recovered || {}).sort();
        const recSec = panelSection(T('bs.debrief.recovered'),
          rec.length ? el('div', { class: 'scr-items' }, rec.map((id) => {
            const def = D().items[id];
            return el('div', { class: 'scr-item' }, itemIconEl(id, 40), el('span', { text: def ? T(def.nameKey) : id }), el('b', { text: '×' + deb.recovered[id] }));
          })) : el('p', { class: 'scr-muted', text: T('scr.db.nothing') }));

        // progressão
        const prog = progression();
        const progSec = prog.length ? panelSection(T('scr.db.progress'),
          el('div', { class: 'scr-prog' }, prog.map((g) => {
            const w = who(g.soldierId);
            const rank = D().soldierRank(w.rank | 0);
            const gainEls = Object.keys(g.gains || {}).map((k) => el('span', { class: 'scr-gain' }, el('i', { text: T('stat.' + k + '.abbr') }), '+' + g.gains[k]));
            const promo = g.promoted !== null && g.promoted !== undefined ? D().soldierRank(g.promoted) : null;
            return el('div', { class: 'scr-prog-row' },
              portraitEl(w, 36),
              el('div', { class: 'scr-prog-name' }, el('span', { class: 'scr-rank r' + (w.rank | 0), text: rank ? T(rank.abbrKey) : '' }), el('b', { text: w.name }),
                g.kills ? el('span', { class: 'scr-muted', text: ' · ' + Tn('bs.debrief.soldier.kills', g.kills) }) : null),
              el('div', { class: 'scr-gains' }, gainEls.length ? gainEls : el('span', { class: 'scr-muted', text: T('scr.db.noGains') })),
              promo ? el('span', { class: 'scr-promo', text: T('scr.db.promoted', { rank: T(promo.nameKey) }) }) : null);
          })),
          !p.onDone ? el('p', { class: 'scr-muted small', text: T('scr.db.preview') }) : null) : null;

        contBtn = el('button', { type: 'button', class: 'btn primary scr-big', text: T('scr.db.continue'), onclick: cont });
        root.append(el('div', { class: 'scr-panel scr-deb res-' + result },
          el('header', { class: 'scr-banner' },
            el('div', { class: 'scr-kicker', text: T('bs.debrief.title') + (M ? ' · ' + missionTitle(M, p.meta) : '') }),
            el('h1', { class: 'scr-result', text: T('scr.db.result.' + result) }),
            el('div', { class: 'scr-result-sub', text: T('scr.db.sub.' + result) + (deb.turns ? ' · ' + Tn('scr.db.turns', deb.turns | 0) : '') })),
          el('div', { class: 'scr-deb-body' },
            el('div', { class: 'scr-deb-col' }, scoreSec, alienSec),
            el('div', { class: 'scr-deb-col' }, lossSec, woundSec, recSec),
            progSec ? el('div', { class: 'scr-deb-wide' }, progSec) : null),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint' }),
            el('div', { class: 'scr-foot-btns' },
              quick ? el('button', { type: 'button', class: 'btn', text: T('scr.db.again'), onclick: again }) : null,
              contBtn))));
      },
      focus: () => contBtn,
      keys(ev) {
        if (ev.key === 'Enter') { const a = document.activeElement; if (!a || a === document.body || a === contBtn) { cont(); return true; } }
        return false;
      },
    });
  };

  // ================================================================================================
  // Cena: opções (sobreposição sobre a cena atual)
  // ================================================================================================
  function inGame() {
    return OV.Scenes.stack.some((s) => GAME_SCENES[s.id] || (!MY_SCENES[s.id] && s.id !== 'newgame'));
  }
  function openOptions() {
    const top = OV.Scenes.top();
    if (top && top.id === 'options') return top;
    return OV.Scenes.push('options', { inGame: inGame() });
  }

  OV.SceneDefs.options = function (params) {
    const p = params || {};
    const S = () => OV.Game.settings;
    const playing = p.inGame !== undefined ? !!p.inGame : inGame();
    let closeBtn = null;
    const save = () => { if (OV.Game.saveSettings) OV.Game.saveSettings(); };
    const setK = (k) => (v) => { S()[k] = v; save(); };
    const getK = (k) => () => S()[k];
    const segs = [];
    function optRow(label, ctl, hint) {
      return el('div', { class: 'scr-orow' }, el('div', { class: 'scr-olabel' }, el('span', { text: label }), hint ? el('small', { text: hint }) : null), ctl);
    }
    function sseg(k, opts) {
      const s = seg({ label: k, options: opts, get: getK(k), set: (v) => { setK(k)(v); s.refresh(); } });
      segs.push(s);
      return s;
    }
    const speeds = [1, 2, 4].map((n) => ({ v: n, label: '×' + n }));
    function close() { sfx('ui_click'); if (OV.Scenes.top() && OV.Scenes.top().id === 'options') OV.Scenes.pop(); }
    function quit() {
      OV.Dom.modal({
        title: T('scr.opt.quit.title'), body: T('scr.opt.quit.confirm'), cls: 'alert',
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('scr.opt.quit'), value: true, kind: 'danger' }],
      }).then((v) => {
        if (!v) return;
        OV.Game.B = null;
        OV.Game.G = null;
        OV.Scenes.set('menu');
      });
    }

    return makeScreen('options', {
      isScreen: false,
      backdrop: false,
      cls: 'scr-overlay',
      build(root) {
        closeBtn = el('button', { type: 'button', class: 'btn primary', text: T('scr.opt.close'), onclick: close });
        const back = el('div', { class: 'scr-ov-back', onclick: close });
        root.append(back, el('div', { class: 'scr-panel scr-opts', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('scr.opt.title') },
          header(T('game.title'), T('scr.opt.title')),
          el('div', { class: 'scr-opts-body' },
            el('div', { class: 'scr-deb-col' },
              panelSection(T('scr.opt.sec.sound'),
                optRow(T('scr.opt.sound'), toggleBtn(getK('sound'), setK('sound'), T('scr.opt.sound'))),
                optRow(T('scr.opt.music'), toggleBtn(getK('music'), setK('music'), T('scr.opt.music'))),
                optRow(T('scr.opt.voice'), toggleBtn(getK('voice'), setK('voice'), T('scr.opt.voice'))),
                optRow(T('scr.opt.volMaster'), slider(getK('volMaster'), setK('volMaster'), T('scr.opt.volMaster'))),
                optRow(T('scr.opt.volSfx'), slider(getK('volSfx'), setK('volSfx'), T('scr.opt.volSfx'))),
                optRow(T('scr.opt.volMusic'), slider(getK('volMusic'), setK('volMusic'), T('scr.opt.volMusic')))),
              panelSection(T('scr.opt.sec.speed'),
                optRow(T('scr.opt.speedXcom'), sseg('speedXcom', speeds)),
                optRow(T('scr.opt.speedAlien'), sseg('speedAlien', speeds), T('scr.opt.speed.hint')))),
            el('div', { class: 'scr-deb-col' },
              panelSection(T('scr.opt.sec.controls'),
                optRow(T('scr.opt.confirmMove'), sseg('confirmMove', ['auto', 'always', 'never'].map((v) => ({ v, label: T('scr.opt.confirmMove.' + v) }))), T('scr.opt.confirmMove.hint')),
                optRow(T('scr.opt.edgeScroll'), toggleBtn(getK('edgeScroll'), setK('edgeScroll'), T('scr.opt.edgeScroll'))),
                optRow(T('scr.opt.wheel'), sseg('wheel', ['level', 'zoom'].map((v) => ({ v, label: T('scr.opt.wheel.' + v) }))))),
              panelSection(T('scr.opt.sec.game'),
                optRow(T('scr.opt.instantGrenades'), toggleBtn(getK('instantGrenades'), setK('instantGrenades'), T('scr.opt.instantGrenades')), T('scr.opt.instantGrenades.hint')),
                optRow(T('scr.opt.confirmEndTurn'), toggleBtn(getK('confirmEndTurn'), setK('confirmEndTurn'), T('scr.opt.confirmEndTurn'))),
                optRow(T('scr.opt.hitPreview'), toggleBtn(getK('hitPreview'), setK('hitPreview'), T('scr.opt.hitPreview')))))),
          el('footer', { class: 'scr-foot' },
            playing ? el('button', { type: 'button', class: 'btn danger', text: T('scr.opt.quit'), onclick: quit }) : el('span', { class: 'scr-hint', text: T('scr.version', { v: VERSION }) }),
            el('div', { class: 'scr-foot-btns' }, closeBtn))));
      },
      focus: () => closeBtn,
      back: close,
    });
  };

  // ================================================================================================
  // Cena: como jogar
  // ================================================================================================
  function table(prefix, n, colA, keys) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const [a, b] = T(prefix + '.' + i).split('|');
      rows.push(el('tr', null, el('td', { class: 'scr-ka', text: a }), el('td', { text: b || '' })));
    }
    return el('table', { class: 'scr-ktable' + (keys ? ' keys' : '') },
      el('thead', null, el('tr', null, el('th', { text: T(colA) }), el('th', { text: T('scr.howto.col.effect') }))),
      el('tbody', null, rows));
  }
  function card(titleKey, bodyKey) {
    return el('div', { class: 'scr-card' }, el('h3', { text: T(titleKey) }), el('p', { html: T(bodyKey) }));
  }

  OV.SceneDefs.howto = function (params) {
    const tabs = ['controls', 'battle', 'geo'];
    let cur = (params && tabs.indexOf(params.tab) >= 0) ? params.tab : 'controls';
    let tabBar = null, body = null, backBtn = null;
    function pages() {
      return {
        controls: [
          el('div', { class: 'scr-two' },
            panelSection(T('scr.howto.ptr.title'), table('scr.howto.ptr', 10, 'scr.howto.col.gesture')),
            el('div', null,
              panelSection(T('scr.howto.key.title'), table('scr.howto.key', 17, 'scr.howto.col.key', true)),
              panelSection(T('scr.howto.touch.title'), table('scr.howto.touch', 3, 'scr.howto.col.gesture')))),
        ],
        battle: [
          el('div', { class: 'scr-cards' },
            card('scr.howto.tu.title', 'scr.howto.tu.body'),
            card('scr.howto.react.title', 'scr.howto.react.body'),
            card('scr.howto.kneel.title', 'scr.howto.kneel.body'),
            card('scr.howto.night.title', 'scr.howto.night.body'),
            card('scr.howto.panic.title', 'scr.howto.panic.body'),
            card('scr.howto.wounds.title', 'scr.howto.wounds.body')),
        ],
        geo: [
          el('div', { class: 'scr-two' },
            el('div', null, el('div', { class: 'scr-cards one' }, card('scr.howto.geo.title', 'scr.howto.geo.body'), card('scr.howto.base.title', 'scr.howto.base.body'))),
            panelSection(T('scr.howto.key.title'), table('scr.howto.geo', 8, 'scr.howto.col.gesture'))),
        ],
      };
    }
    function show(t) {
      cur = t;
      for (const b of tabBar.children) {
        const on = b.dataset.tab === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      OV.Dom.clear(body);
      body.append(...pages()[t]);
      body.scrollTop = 0;
    }
    return makeScreen('howto', {
      backdrop: { dim: 0.6 },
      build(root) {
        tabBar = el('div', { class: 'scr-tabs', role: 'tablist' }, tabs.map((t, i) =>
          el('button', { type: 'button', class: 'scr-tab', role: 'tab', dataset: { tab: t }, onclick: () => { sfx('ui_click'); show(t); } },
            el('kbd', { text: String(i + 1) }), T('scr.howto.tab.' + t))));
        body = el('div', { class: 'scr-scroll scr-howto-body' });
        backBtn = el('button', { type: 'button', class: 'btn primary', text: T('scr.back'), onclick: () => { sfx('ui_click'); goBack(); } });
        root.append(el('div', { class: 'scr-panel scr-howto-p' },
          header(T('scr.howto.kicker'), T('scr.howto.title'), tabBar),
          body,
          el('footer', { class: 'scr-foot' }, el('span', { class: 'scr-hint', text: '1 · 2 · 3 · ← →' }), el('div', { class: 'scr-foot-btns' }, backBtn))));
        show(cur);
      },
      focus: () => backBtn,
      keys(ev) {
        const i = tabs.indexOf(cur);
        if (ev.key >= '1' && ev.key <= '3') { sfx('ui_click'); show(tabs[+ev.key - 1]); return true; }
        if (ev.key === 'ArrowRight') { sfx('ui_click'); show(tabs[(i + 1) % tabs.length]); return true; }
        if (ev.key === 'ArrowLeft') { sfx('ui_click'); show(tabs[(i + tabs.length - 1) % tabs.length]); return true; }
        if (ev.key === 'ArrowDown' || ev.key === 'PageDown') { body.scrollBy({ top: ev.key === 'PageDown' ? body.clientHeight * 0.8 : 60 }); return true; }
        if (ev.key === 'ArrowUp' || ev.key === 'PageUp') { body.scrollBy({ top: ev.key === 'PageUp' ? -body.clientHeight * 0.8 : -60 }); return true; }
        return false;
      },
      back: goBack,
    });
  };

  // ================================================================================================
  // Cena: créditos
  // ================================================================================================
  const REA_DOCS = ['01-auditoria-framework-rts.md', '02-geoscape.md', '03-battlescape.md', '04-arquitetura-openxcom.md', '05-isometrico-e-globo.md'];
  OV.SceneDefs.credits = function () {
    let backBtn = null;
    return makeScreen('credits', {
      backdrop: { dim: 0.5 },
      build(root) {
        backBtn = el('button', { type: 'button', class: 'btn primary', text: T('scr.back'), onclick: () => { sfx('ui_click'); goBack(); } });
        root.append(el('div', { class: 'scr-panel scr-cr-p' },
          header(T('scr.cr.kicker'), T('scr.cr.title')),
          el('div', { class: 'scr-scroll scr-cr-body' },
            el('div', { class: 'scr-cr-logo' }, el('div', { class: 'scr-logo-big', text: T('scr.logo.big') }), el('div', { class: 'scr-logo-small', text: T('scr.logo.small') })),
            el('div', { class: 'scr-cards' },
              card('scr.cr.orig', 'scr.cr.orig.body'),
              card('scr.cr.oxc', 'scr.cr.oxc.body'),
              card('scr.cr.ne', 'scr.cr.ne.body'),
              card('scr.cr.this', 'scr.cr.this.body')),
            panelSection(T('scr.cr.docs'),
              el('ul', { class: 'scr-docs' }, REA_DOCS.map((f, i) => el('li', null,
                el('a', { href: 'docs/rea/' + f, target: '_blank', rel: 'noopener' }, el('span', { class: 'scr-doc-n', text: String(i + 1).padStart(2, '0') }), T('scr.cr.doc.' + (i + 1))))))),
            el('p', { class: 'scr-thanks', text: T('scr.cr.thanks') })),
          el('footer', { class: 'scr-foot' }, el('span', { class: 'scr-hint', text: T('scr.version', { v: VERSION }) }), el('div', { class: 'scr-foot-btns' }, backBtn))));
      },
      focus: () => backBtn,
      back: goBack,
    });
  };

  OV.Screens = Object.assign(OV.Screens || {}, {
    VERSION, Backdrop, startBattle, buildQuickMission, quickFromURL, missionTitle, loadoutFor, defaultQuick,
    openOptions, saves, resumeGame, missionRating, battleExit, _urlUsed: false,
  });
})(globalThis.OV || (globalThis.OV = {}));
