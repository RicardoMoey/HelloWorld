/* Renderizador do Battlescape (js/gfx/battle_render.js) em Node com um canvas falso: pré-aquecimento dos sprites de
   tile depois de carregar a batalha (o primeiro desenho já não gera sprites) e invalidação das regiões de chão
   vizinhas quando um tile muda (o recorte do chão depende dos objetos à volta e do nível de baixo). */
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
  const TS = OV.TileSprites, BR = OV.BattleRender;

  function mockCanvas(w, h, dpr) {
    const c = { width: w, height: h };
    let T = { a: dpr || 1, b: 0, c: 0, d: dpr || 1, e: 0, f: 0 };
    const stack = [];
    const ctx = new Proxy({}, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'canvas') return c;
        if (prop === 'getTransform') return () => Object.assign({}, T);
        if (prop === 'setTransform') return (...a) => { T = { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] }; };
        if (prop === 'save') return () => stack.push(Object.assign({}, T));
        if (prop === 'restore') return () => { if (stack.length) T = stack.pop(); };
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (prop === 'createImageData') return (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
        if (prop === 'measureText') return () => ({ width: 20 });
        if (prop === 'getImageData') return undefined;
        return () => {};
      },
      set(target, prop, v) {
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
  OV.FX.setCanvasFactory(factory);
  BR.setCanvasFactory(factory);

  const B = OV.Battle.create(OV.Battle.quickMission({ ufoType: 'large_scout', terrain: 'FARM', seed: 3 }));
  const m = B.map;
  m.disc.fill(7);
  const lead = B.units.find((u) => u.side === 'xcom' && u.onMap);
  function viewAt(x, y, z) {
    const v = { cam: { x: 0, y: 0, zoom: 1 }, w: 1280, h: 800, viewZ: m.d - 1, time: 0, anim: { units: {}, hidden: new Set() }, showAll: true };
    BR.centerOn(v, x, y, z || 0);
    return v;
  }
  const screen = mockCanvas(2560, 1600, 2);

  t.test('BattleRender.prewarm: gera os sprites do mapa (escala atual + zoom vizinho); o primeiro desenho não gera mais', () => {
    TS.clearCache();
    BR.reset(B); // em Node (sem document) não agenda nada
    t.ok(BR.warmStats().finished, 'reset em Node não deixa trabalho pendente');
    const r = BR.prewarm(B, { sync: true, dpr: 2, scales: [2, 3] });
    const w = BR.warmStats();
    t.ok(r.total > 20 && w.finished && w.done === r.total, 'pré-aquecidos ' + w.done + '/' + r.total);
    t.eq(w.scales, [2, 3]);
    const n0 = TS.stats().entries;
    t.ok(n0 >= r.total / 2, 'sprites na cache');
    BR.draw(screen.getContext('2d'), B, viewAt(lead.x, lead.y, 0));
    t.eq(TS.stats().entries, n0, 'desenho a zoom 1 @2× sem sprites de tile novos');
    const v = viewAt(lead.x, lead.y, 0);
    v.cam.zoom = 1.5;
    BR.draw(screen.getContext('2d'), B, v);
    t.eq(TS.stats().entries, n0, 'zoom 1.5 @2× também já estava pronto');
  });

  t.test('BattleRender.prewarm: escalas por omissão começam no zoom atual; nova chamada cancela a anterior', () => {
    const r = BR.prewarm(B, { sync: true, dpr: 1 });
    const w = BR.warmStats();
    t.eq(w.scales[0], 1.5, 'zoom do último desenho (1.5) primeiro');
    t.ok(w.scales.length >= 4 && w.done <= r.total, 'zooms vizinhos: ' + w.scales.join(', '));
    t.eq(BR.prewarm({}, {}).total, 0, 'sem mapa: nada');
  });

  t.test('BattleRender.markDirty: tile mudado recoze as regiões do bloco 3×3 neste nível e no de cima', () => {
    BR.setBakesPerFrame(10000);
    const x = lead.x + 2, y = lead.y + 2;
    const ctx = screen.getContext('2d');
    const v = viewAt(x, y, 0);
    BR.draw(ctx, B, v);
    BR.draw(ctx, B, v);
    t.eq(BR.stats().bakes, 0, 'estável: nada para recozer');
    const i = (0 * m.h + y) * m.w + x;
    BR.markDirty(i, B);
    BR.draw(ctx, B, v);
    const [RW, RH] = BR.REGION;
    const keys = new Set();
    for (let z = 0; z <= Math.min(m.d - 1, 1); z++) {
      for (let yy = y - 1; yy <= y + 1; yy++) {
        for (let xx = x - 1; xx <= x + 1; xx++) {
          const wx = (xx - yy) * 32, wy = (xx + yy) * 16;
          for (let ry = Math.floor(wy / RH); ry <= Math.floor((wy + 32) / RH); ry++) {
            for (let rx = Math.floor((wx - 32) / RW); rx <= Math.floor((wx + 32) / RW); rx++) keys.add(z + ':' + rx + ':' + ry);
          }
        }
      }
    }
    t.eq(BR.stats().bakes, keys.size, 'regiões recozidas');
    BR.draw(ctx, B, v);
    t.eq(BR.stats().bakes, 0, 'e depois estável');
    BR.setBakesPerFrame(2);
  });
};
