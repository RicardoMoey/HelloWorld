/* Testes da apresentação do Battlescape em Node (canvas falso que valida as chamadas):
   js/gfx/sprites_tiles.js (todas as partes de tile desenham, âncoras/caixas, cache, estados),
   js/gfx/fx.js (todos os tipos, projéteis chegam, tremor limitado, decalques) e
   js/gfx/battle_render.js (desenho de uma batalha real sem NaN e sem alterar B, névoa, níveis, pick, câmara). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GFX = path.join(__dirname, '..', '..', 'js', 'gfx');
const load = (OV, name, file) => {
  if (!OV[name]) vm.runInThisContext(fs.readFileSync(path.join(GFX, file), 'utf8'), { filename: path.join(GFX, file) });
};

module.exports = function (OV, t) {
  load(OV, 'TileSprites', 'sprites_tiles.js');
  load(OV, 'UnitSprites', 'sprites_units.js');
  load(OV, 'ItemSprites', 'sprites_items.js');
  load(OV, 'Portraits', 'portraits.js');
  load(OV, 'FX', 'fx.js');
  load(OV, 'BattleRender', 'battle_render.js');
  const TS = OV.TileSprites, FX = OV.FX, BR = OV.BattleRender;

  // ---- canvas falso ------------------------------------------------------------------------------------------
  const bad = [];
  const RADIUS = { arc: [2], ellipse: [2, 3], createRadialGradient: [2, 5] };
  const stats = { drawImage: 0, fillText: [], canvases: 0 };
  function check(name, args) {
    args.forEach((a, i) => {
      if (typeof a === 'number' && !Number.isFinite(a)) bad.push(name + '[' + i + ']=' + a);
    });
    for (const i of RADIUS[name] || []) if (args[i] < 0) bad.push(name + ' raio negativo ' + args[i]);
  }
  function mockCanvas(w, h, dpr) {
    stats.canvases++;
    const c = { width: w, height: h };
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) bad.push('canvas ' + w + '×' + h);
    let T = { a: dpr || 1, b: 0, c: 0, d: dpr || 1, e: 0, f: 0 };
    const stack = [];
    const state = {};
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'canvas') return c;
        if (prop === 'getTransform') return () => Object.assign({}, T);
        if (prop === 'setTransform') return (...a) => { check(prop, a); T = { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] }; };
        if (prop === 'save') return () => stack.push(Object.assign({}, T));
        if (prop === 'restore') return () => { if (stack.length) T = stack.pop(); };
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return (...a) => {
            check(prop, a);
            return { addColorStop: (o, col) => { if (!(o >= 0 && o <= 1) || typeof col !== 'string') bad.push('stop ' + o + ' ' + col); } };
          };
        }
        if (prop === 'createImageData') return (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
        if (prop === 'measureText') return () => ({ width: 20 });
        if (prop === 'getImageData') return undefined;
        if (prop === 'drawImage') return (...a) => { check(prop, a); stats.drawImage++; if (!a[0] || !(a[0].width > 0)) bad.push('drawImage sem fonte'); };
        if (prop === 'fillText') return (...a) => { check(prop, a); stats.fillText.push(a[0]); };
        return (...a) => check(prop, a);
      },
      set(target, prop, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push('set ' + String(prop) + '=' + v);
        target[prop] = v;
        return true;
      },
    });
    c.getContext = () => ctx;
    return c;
  }
  const factory = (w, h) => mockCanvas(w, h);
  TS.setCanvasFactory(factory);
  OV.UnitSprites.setCanvasFactory(factory);
  OV.ItemSprites.setCanvasFactory(factory);
  FX.setCanvasFactory(factory);
  BR.setCanvasFactory(factory);
  const takeBad = () => bad.splice(0, bad.length);

  // ---- sprites de tile ---------------------------------------------------------------------------------------
  t.test('TileSprites: API', () => {
    for (const f of ['get', 'blit', 'blitDev', 'draw', 'silhouette', 'gray', 'clearCache', 'variants', 'frames', 'oriented', 'hasArt', 'stats']) t.ok(typeof TS[f] === 'function', f);
    t.eq(TS.get(0, 0, 1, 0), null, 'id 0 = vazio');
    t.eq(TS.get(99999, 0, 1, 0), null, 'id desconhecido');
  });

  t.test('TileSprites: todas as definições têm arte e desenham geometria válida', () => {
    TS.clearCache();
    takeBad();
    const D = OV.Data.tileDefs;
    let n = 0;
    for (let id = 1; id < D.length; id++) {
      const d = D[id];
      t.ok(TS.hasArt(id), 'sem arte: ' + d.key);
      const box = TS.BOX[d.part === 'floor' ? 'floor' : d.part === 'west' ? 'west' : d.part === 'north' ? 'north' : 'object'];
      const states = TS.oriented(id) ? ['x', 'y'] : Array.from({ length: TS.frames(id) }, (_, k) => k);
      for (let v = 0; v < TS.variants(id); v++) {
        for (const st of states) {
          const s = TS.get(id, v, 1.5, st);
          n++;
          t.ok(s && s.w > 0 && s.h > 0, d.key + ' dimensões');
          t.eq(s.c.width, Math.round(s.w * 1.5), d.key + ' largura do canvas');
          t.eq(s.c.height, Math.round(s.h * 1.5), d.key + ' altura do canvas');
          t.ok(s.ax === -box[0] && s.ay === -box[1], d.key + ' âncora no canto do losango');
          if (s.e) t.ok(s.e.width === s.c.width && s.e.height === s.c.height, d.key + ' camada emissiva do mesmo tamanho');
        }
      }
    }
    t.ok(n > 600, 'sprites gerados: ' + n);
    t.eq(takeBad(), [], 'chamadas de canvas inválidas');
  });

  t.test('TileSprites: animação, orientação e luzes', () => {
    const id = (k) => OV.Data.tileId(k);
    t.eq(TS.frames(id('UFO.powerSource')), 4);
    t.eq(TS.frames(id('UFO.gravlift')), 4);
    t.eq(TS.frames(id('UFO.cabinet')), 4, 'consola pisca');
    t.eq(TS.frames(id('FARM.cabinet')), 1);
    t.eq(TS.frames(id('FARM.ground')), 1);
    t.ok(TS.oriented(id('UFO.ufoDoor')) && TS.oriented(id('UFO.ufoDoorOpen')), 'portas de OVNI orientadas');
    t.ok(TS.get(id('UFO.ufoDoor'), 0, 1, 'x') !== TS.get(id('UFO.ufoDoor'), 0, 1, 'y'), 'orientações distintas');
    t.ok(TS.get(id('UFO.powerSource'), 0, 1, 1) !== TS.get(id('UFO.powerSource'), 0, 1, 2), 'fotogramas distintos');
    t.eq(TS.get(id('UFO.powerSource'), 0, 1, 5), TS.get(id('UFO.powerSource'), 0, 1, 1), 'fotograma reduzido ao ciclo');
    t.ok(TS.get(id('UFO.powerSource'), 0, 1, 0).e, 'fonte de energia emite luz');
    t.ok(TS.get(id('URBAN.lamp'), 0, 1, 0).e, 'candeeiro emite luz');
    t.eq(TS.get(id('FARM.wall'), 0, 1, 0).e, null, 'parede sem camada emissiva');
  });

  t.test('TileSprites: cache por chave e escala quantizada', () => {
    TS.clearCache();
    const g = OV.Data.tileId('FARM.ground');
    const a = TS.get(g, 1, 1, 0);
    t.eq(TS.get(g, 1, 1.1, 0), a, 'escala 1.1 → 1');
    t.eq(TS.get(g, 1 + TS.variants(g), 1, 0), a, 'variante reduzida ao número de variantes');
    t.eq(TS.get('FARM.ground', 1, 1, 0), a, 'por chave de texto');
    t.ok(TS.get(g, 1, 2, 0) !== a, 'outra escala, outro sprite');
    t.eq(TS.get(g, 1, 2, 0).c.width, a.c.width * 2);
    t.ok(TS.stats().entries >= 2);
    TS.setBudget(1);
    TS.get(g, 2, 8, 0);
    TS.get(g, 3, 8, 0);
    t.eq(TS.stats().entries, 1, 'orçamento de píxeis expulsa entradas antigas');
    TS.setBudget(40e6);
  });

  t.test('TileSprites: blit com sombra, névoa e camada emissiva', () => {
    const c = mockCanvas(100, 100, 2), ctx = c.getContext('2d');
    const spr = TS.get(OV.Data.tileId('UFO.powerSource'), 0, 2, 0);
    TS.silhouette(spr);
    TS.gray(spr);
    const before = stats.drawImage;
    TS.blit(ctx, spr, 10, 20, 1, 0, 0);
    t.eq(stats.drawImage - before, 1, 'de dia: uma cópia');
    TS.blit(ctx, spr, 10, 20, 1, 0.6, 0);
    t.eq(stats.drawImage - before, 4, 'de noite: cor + silhueta + luzes');
    TS.blit(ctx, spr, 10, 20, 1, 0.6, 0.6);
    t.eq(stats.drawImage - before, 7, 'névoa: cor + cinzento + silhueta');
    t.ok(spr.sil && spr.gray, 'camadas derivadas criadas a pedido');
    t.eq(takeBad(), []);
  });

  // ---- FX -----------------------------------------------------------------------------------------------------
  t.test('FX: todos os tipos criam, avançam, desenham e expiram', () => {
    FX.clear();
    const kinds = ['muzzle', 'tracer', 'bullet', 'laser', 'plasma', 'rocket', 'thrown', 'explosion', 'smoke', 'fire', 'sparks', 'impact', 'blood', 'psi', 'spotted', 'damage'];
    for (const k of kinds) FX.spawn(k, [100, 100, 12], { to: [200, 150, 12], radius: 3, amount: 12, alien: k === 'blood', itemId: 'grenade', gun: 'laser' });
    FX.spawn('smoke', { x: 3.5, y: 4.5, z: 0 });
    FX.spawn('psi', { vx: 10, vy: 10, vz: 30 }, { to: [50, 60, 10] });
    t.ok(FX.count() > kinds.length, 'partículas criadas');
    t.ok(FX.active());
    const c = mockCanvas(200, 200, 2), ctx = c.getContext('2d');
    for (let k = 0; k < 20; k++) {
      FX.update(50);
      FX.draw(ctx, { x: 0, y: 0, zoom: 1.5 }, 2);
      FX.drawDecals(ctx, { x: 0, y: 0, zoom: 1.5 }, 0);
    }
    t.eq(takeBad(), [], 'chamadas inválidas');
    t.ok(FX.decalCount() >= 2, 'queimado e sangue ficam no chão');
    for (let k = 0; k < 60; k++) FX.update(100);
    t.eq(FX.count(), 0, 'tudo expira');
    t.eq(FX.inFlight(), 0);
    FX.clear();
    t.eq(FX.decalCount(), 0);
  });

  t.test('FX: projéteis chegam ao destino com a velocidade pedida', () => {
    FX.clear();
    FX.projectile('tracer', [0, 0, 0], [16 * 30, 0, 0], 30); // 30 tiles a 30 tiles/s = 1 s
    t.eq(FX.inFlight(), 1);
    for (let k = 0; k < 9; k++) FX.update(100);
    t.eq(FX.inFlight(), 1, 'ainda a voar aos 900 ms');
    FX.update(150);
    t.eq(FX.inFlight(), 0, 'chegou ao fim de 1 s');
    FX.projectile('laser', [0, 0, 0], [100, 0, 0]);
    FX.update(50);
    t.eq(FX.inFlight(), 0, 'laser instantâneo');
    const path = [[0, 0, 20], [32, 0, 40], [64, 0, 20]];
    FX.projectile('thrown', null, path, 2);
    FX.update(500);
    t.eq(FX.inFlight(), 1);
    FX.clear();
    t.eq(FX.inFlight(), 0, 'clear resolve pendentes');
  });

  t.test('FX: tremor de câmara limitado a 8 px e amortecido', () => {
    FX.clear();
    FX.shake(5);
    let mx = 0;
    for (let k = 0; k < 40; k++) {
      FX.update(16);
      const o = FX.offset();
      mx = Math.max(mx, Math.abs(o.x), Math.abs(o.y));
    }
    t.ok(mx > 0.5 && mx <= 8, 'amplitude ' + mx);
    for (let k = 0; k < 100; k++) FX.update(16);
    const o = FX.offset();
    t.ok(Math.abs(o.x) < 1e-9 && Math.abs(o.y) < 1e-9, 'parado');
    t.eq(FX.tileVoxel(2, 3, 1, 10), [40, 56, 34]);
  });

  // ---- renderizador ---------------------------------------------------------------------------------------------
  const mission = OV.Battle.quickMission({ ufoType: 'abductor', terrain: 'FARM', seed: 5, night: true });
  const B = OV.Battle.create(mission);
  const m = B.map;
  const lead = B.units.find((u) => u.side === 'xcom' && u.onMap);
  const alien = B.units.find((u) => u.side === 'alien' && u.onMap && u.z === 0);
  const idx = (x, y, z) => (z * m.h + y) * m.w + x;
  function viewFor(extra) {
    const v = {
      cam: { x: 0, y: 0, zoom: 1 }, w: 1280, h: 800, viewZ: 0, time: 1234, selectedId: lead.id,
      hover: { x: lead.x + 1, y: lead.y + 1, z: 0 }, cursor: 'target', anim: { units: {}, hidden: new Set() },
    };
    BR.centerOn(v, lead.x, lead.y, 0);
    return Object.assign(v, extra || {});
  }
  const screen = mockCanvas(2560, 1600, 2);
  const sctx = screen.getContext('2d');

  t.test('BattleRender: API e limites', () => {
    for (const f of ['draw', 'pick', 'bounds', 'centerOn', 'clampCam', 'markDirty', 'stats']) t.ok(typeof BR[f] === 'function', f);
    const b = BR.bounds(B);
    t.ok(b.x0 < 0 && b.x1 > 0 && b.y1 > b.y0, 'limites do mapa');
    const v = viewFor();
    v.cam.x = -1e6;
    BR.clampCam(v, B);
    t.ok(v.cam.x >= b.x0 - 1280, 'câmara presa aos limites');
  });

  t.test('BattleRender: desenha uma batalha completa sem chamadas inválidas e sem alterar B', () => {
    takeBad();
    m.disc.fill(7);
    m.fire[idx(lead.x + 3, lead.y, 0)] = 4;
    m.smoke[idx(lead.x + 4, lead.y, 0)] = 9;
    OV.BUnits.newItem(B, 'electro_flare', { at: idx(lead.x + 2, lead.y + 2, 0) });
    const h0 = OV.Battle.hash(B);
    const steps = [1, 2, 3].map((k) => ({ i: idx(lead.x + k, lead.y + 1, 0), tu: lead.tu - 4 * k, state: k < 3 ? 'ok' : 'reserve' }));
    const cost = new Int16Array(m.n).fill(-1);
    for (let y = lead.y - 3; y <= lead.y + 3; y++) for (let x = lead.x - 3; x <= lead.x + 3; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h) cost[idx(x, y, 0)] = 4 * Math.max(Math.abs(x - lead.x), Math.abs(y - lead.y));
    const v = viewFor({
      path: { steps, label: 'UT 41/53' }, reach: { cost, budgetOk: 8, budgetReserve: 12 },
      target: alien ? { fromId: lead.id, toI: idx(alien.x, alien.y, 0), hitPct: 38, blocked: false, line: [[lead.x * 16 + 8, lead.y * 16 + 8, 20], [alien.x * 16 + 8, alien.y * 16 + 8, 12]] } : null,
      throwArc: [[lead.x * 16, lead.y * 16, 20], [lead.x * 16 + 30, lead.y * 16 + 30, 50], [lead.x * 16 + 60, lead.y * 16 + 60, 0]],
      anim: { units: { [lead.id]: { fx: lead.x + 0.5, fy: lead.y, fz: 0, dir: 2, pose: 'walk', frame: 2 } }, hidden: new Set() },
      nodes: true, showAll: true,
    });
    for (let k = 0; k < 4; k++) BR.draw(sctx, B, v);
    t.eq(takeBad(), [], 'chamadas inválidas');
    t.eq(OV.Battle.hash(B), h0, 'B não muda ao desenhar');
    const st = BR.stats();
    t.ok(st.chunks > 0, 'regiões de chão desenhadas');
    t.ok(st.units > 0, 'unidades desenhadas');
    t.ok(stats.fillText.indexOf('UT 41/53') >= 0, 'etiqueta do caminho');
    t.ok(stats.fillText.indexOf('38%') >= 0, 'percentagem de acerto');
    t.ok(stats.fillText.indexOf(String(lead.tu - 4)) >= 0, 'UT por passo');
  });

  t.test('BattleRender: pick encontra a unidade e o tile por baixo do cursor', () => {
    const v = viewFor({ hover: null });
    BR.draw(sctx, B, v);
    // centro do losango do tile do líder (px CSS), um pouco acima dos pés
    const p = OV.Iso.tileCenter(lead.x, lead.y, 0, v.cam);
    const hit = BR.pick(v, p.x, p.y - 32 * v.cam.zoom);
    t.ok(hit && hit.unitId === lead.id, 'unidade selecionável pelo corpo');
    // tile vazio no nível 0
    let tx = -1, ty = -1;
    for (let y = 1; y < m.h - 1 && tx < 0; y++) {
      for (let x = 1; x < m.w - 1; x++) {
        const i = idx(x, y, 0);
        if (!B._.unitAt[i] && !m.parts[i * 4 + 3] && !m.parts[idx(x, y, 1) * 4] && Math.abs(x - lead.x) + Math.abs(y - lead.y) < 12 && Math.abs(x - lead.x) + Math.abs(y - lead.y) > 4) { tx = x; ty = y; break; }
      }
    }
    t.ok(tx >= 0, 'há um tile livre perto');
    const q = OV.Iso.tileCenter(tx, ty, 0, v.cam);
    const h2 = BR.pick(Object.assign({}, v, { viewZ: 2 }), q.x, q.y);
    t.eq([h2.x, h2.y, h2.z, h2.unitId], [tx, ty, 0, null], 'cai pelos níveis vazios até ao chão');
    t.eq(BR.pick(v, -1e5, -1e5), null, 'fora do mapa');
  });

  t.test('BattleRender: inimigos só quando vistos; níveis acima cortados; escondidos pela animação', () => {
    const v = viewFor({ hover: null, viewZ: m.d - 1 });
    BR.centerOn(v, B.ufo.x + B.ufo.w / 2, B.ufo.y + B.ufo.h / 2, 0);
    v.cam.zoom = 0.5;
    BR.centerOn(v, B.ufo.x + B.ufo.w / 2, B.ufo.y + B.ufo.h / 2, 0);
    const aliens = B.units.filter((u) => u.side === 'alien' && u.onMap);
    // sem informação de visibilidade (antes do primeiro LOS): inimigos escondidos
    for (const u of aliens) delete u.visible;
    BR.draw(sctx, B, v);
    const noInfo = BR.stats().units;
    for (const u of aliens) u.visible = true;
    BR.draw(sctx, B, v);
    const all = BR.stats().units;
    t.eq(noInfo, all - aliens.length, 'sem B._.visible nem u.visible ⇒ nenhum inimigo desenhado');
    for (const u of aliens) u.visible = false;
    BR.draw(sctx, B, v);
    const hidden = BR.stats().units;
    t.ok(hidden < all, 'aliens não vistos não são desenhados (' + all + ' → ' + hidden + ')');
    BR.draw(sctx, B, Object.assign({}, v, { showAll: true }));
    t.eq(BR.stats().units, all, 'showAll mostra tudo');
    for (const u of aliens) u.visible = true;
    const upper = aliens.filter((u) => u.z > 0).length;
    BR.draw(sctx, B, Object.assign({}, v, { viewZ: 0 }));
    t.eq(BR.stats().units, all - upper, 'unidades acima de viewZ cortadas');
    BR.draw(sctx, B, Object.assign({}, v, { anim: { units: {}, hidden: new Set(aliens.map((u) => u.id)) } }));
    t.eq(BR.stats().units, all - aliens.length, 'anim.hidden esconde');
    for (const u of aliens) delete u.visible;
  });

  t.test('BattleRender: regiões de chão recozidas só quando o chão, a luz ou a névoa mudam', () => {
    BR.setBakesPerFrame(100);
    const v = viewFor({ hover: null, viewZ: 0 });
    BR.draw(sctx, B, v);
    BR.draw(sctx, B, v);
    t.eq(BR.stats().bakes, 0, 'câmara parada: nada a cozer');
    const i = idx(lead.x + 2, lead.y + 3, 0);
    const old = m.parts[i * 4];
    m.parts[i * 4] = OV.Data.tileId('FARM.scorched');
    BR.draw(sctx, B, v);
    t.ok(BR.stats().bakes >= 1, 'chão mudou → recoze');
    m.parts[i * 4] = old;
    BR.markDirty(i, B);
    BR.draw(sctx, B, v);
    t.ok(BR.stats().bakes >= 1, 'markDirty força');
    m.disc[idx(lead.x + 1, lead.y + 1, 0)] = 0;
    BR.draw(sctx, B, v);
    t.ok(BR.stats().bakes >= 1, 'descoberta mudou → recoze');
    m.disc.fill(7);
    BR.setBakesPerFrame(2);
    t.eq(takeBad(), []);
  });
};
