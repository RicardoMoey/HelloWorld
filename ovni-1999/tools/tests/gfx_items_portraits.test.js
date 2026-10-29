/* Testes de js/gfx/sprites_items.js e js/gfx/portraits.js em Node, com um canvas de registo (mock):
   cada item fixo tem arte própria, desenha sem NaN, os tamanhos/âncoras são coerentes, a cache funciona
   e os retratos são determinísticos e variados. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('../load');

// canvas falso que regista operações (com números arredondados) e segue a matriz de transformação
function makeMock() {
  const all = [];
  function Ctx(canvas) {
    this.canvas = canvas;
    this.log = [];
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.bad = 0;
  }
  const P = Ctx.prototype;
  const rec = function (name) {
    return function () {
      const args = [];
      for (const a of arguments) {
        if (typeof a === 'number') {
          if (!Number.isFinite(a)) this.bad++;
          args.push(Math.round(a * 100) / 100);
        } else if (typeof a === 'string') args.push(a);
        else if (a && a.__grad) args.push('grad:' + a.stops.join(','));
        else if (a && a.width !== undefined) args.push('canvas');
        else args.push(typeof a);
      }
      this.log.push(name + '(' + args.join(',') + ')');
    };
  };
  for (const n of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse', 'rect',
    'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'clip', 'drawImage', 'fillText']) P[n] = rec(n);
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  P.save = function () { this.stack.push(this.m.slice()); this.log.push('save'); };
  P.restore = function () { if (this.stack.length) this.m = this.stack.pop(); this.log.push('restore'); };
  P.setTransform = function (a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; rec('setTransform').apply(this, arguments); };
  P.transform = function (a, b, c, d, e, f) { this.m = mul(this.m, [a, b, c, d, e, f]); rec('transform').apply(this, arguments); };
  P.translate = function (x, y) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); rec('translate').apply(this, arguments); };
  P.scale = function (x, y) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); rec('scale').apply(this, arguments); };
  P.rotate = function (r) { const c = Math.cos(r), s = Math.sin(r); this.m = mul(this.m, [c, s, -s, c, 0, 0]); rec('rotate').apply(this, arguments); };
  P.getTransform = function () { const m = this.m; return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; };
  const grad = function () {
    rec('gradient').apply(this, arguments);
    const g = { __grad: true, stops: [], addColorStop: (t, c) => g.stops.push(Math.round(t * 100) + c) };
    return g;
  };
  P.createLinearGradient = grad;
  P.createRadialGradient = grad;
  P.measureText = () => ({ width: 10 });
  for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation', 'lineCap', 'lineJoin', 'font', 'textBaseline']) {
    Object.defineProperty(P, prop, {
      get() { return this['_' + prop]; },
      set(v) {
        if (typeof v === 'number' && !Number.isFinite(v)) this.bad++;
        this['_' + prop] = v;
        this.log.push(prop + '=' + (v && v.__grad ? 'grad:' + v.stops.join(',') : v));
      },
    });
  }
  function factory(w, h) {
    const c = { width: w, height: h };
    c.getContext = () => c.ctx || (c.ctx = new Ctx(c));
    all.push(c);
    return c;
  }
  return { factory, all };
}

function loadGfx(OVbase) {
  const ctx = vm.createContext({ OV: { U: OVbase.U, Color: OVbase.Color } });
  for (const f of ['js/gfx/sprites_items.js', 'js/gfx/portraits.js']) {
    vm.runInContext(fs.readFileSync(path.join(load.ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.OV;
}

const FIXED_ITEMS = ('pistol pistol_clip rifle rifle_clip heavy_cannon hc_ap hc_he hc_in auto_cannon ac_ap ac_he ac_in rocket_launcher ' +
  'small_rocket large_rocket incendiary_rocket laser_pistol laser_rifle heavy_laser plasma_pistol plasma_pistol_clip plasma_rifle ' +
  'plasma_rifle_clip heavy_plasma heavy_plasma_clip small_launcher stun_bomb blaster_launcher blaster_bomb stun_rod grenade ' +
  'smoke_grenade proximity_grenade high_explosive alien_grenade electro_flare medikit motion_scanner psi_amp alien_alloys elerium_115 ' +
  'ufo_power_source ufo_navigation alien_food alien_surgery examination_room alien_reproduction alien_entertainment sectoid_corpse ' +
  'floater_corpse snakeman_corpse muton_corpse ethereal_corpse cyberdisc_corpse sectopod_corpse reaper_corpse chryssalid_corpse ' +
  'zombie_corpse stingray avalanche cannon laser_cannon plasma_beam fusion_ball stingray_missile avalanche_missile cannon_rounds ' +
  'fusion_ball_missile').split(' ');

module.exports = function (OV, t) {
  const mock = makeMock();
  const G = loadGfx(OV);
  const IS = G.ItemSprites, PR = G.Portraits;
  IS.setCanvasFactory(mock.factory);
  PR.setCanvasFactory(mock.factory);

  // assinatura de todas as operações de desenho feitas nos canvas criados desde `from`
  const sigSince = (from) => mock.all.slice(from).map((c) => (c.ctx ? c.ctx.log.join(';') : '')).join('|');
  const badSince = (from) => mock.all.slice(from).reduce((n, c) => n + (c.ctx ? c.ctx.bad : 0), 0);
  const fillsSince = (from) => mock.all.slice(from).reduce((n, c) => n + (c.ctx ? c.ctx.log.filter((s) => s.startsWith('fill(')).length : 0), 0);

  t.test('itens: todos os ids fixos têm arte própria', () => {
    const miss = FIXED_ITEMS.filter((id) => !IS.has(id));
    t.eq(miss, [], 'sem arte');
    t.ok(!IS.has('nao_existe'), 'id desconhecido não tem arte');
  });

  t.test('itens: todos os itens visíveis de OV.Data.items têm arte (exceto armas embutidas)', () => {
    const items = (OV.Data && OV.Data.items) || {};
    const miss = Object.keys(items).filter((id) => !items[id].fixed && !IS.has(id));
    t.eq(miss, [], 'itens sem arte');
  });

  t.test('ícones: 48×48 px CSS × escala, sem NaN, com conteúdo e todos diferentes', () => {
    const sigs = new Map();
    for (const id of FIXED_ITEMS.concat(['personal_armour', 'power_suit', 'flying_suit', 'soldier_corpse', 'civilian_corpse'])) {
      const from = mock.all.length;
      const c = IS.icon(id, 2);
      t.eq([c.width, c.height], [96, 96], id);
      t.eq(badSince(from), 0, 'NaN/Infinity em ' + id);
      t.ok(fillsSince(from) >= 4, 'ícone vazio: ' + id);
      const sig = sigSince(from);
      t.ok(!sigs.has(sig), id + ' igual a ' + sigs.get(sig));
      sigs.set(sig, id);
    }
    t.eq([IS.icon('rifle', 1).width, IS.icon('rifle', 1.5).width], [48, 72]);
  });

  t.test('ícones: ids desconhecidos partilham a caixa genérica', () => {
    const a = IS.icon('coisa_estranha', 1), b = IS.icon('outra_coisa', 1);
    t.ok(a === b, 'mesma entrada de cache');
    t.ok(a !== IS.icon('rifle', 1));
  });

  t.test('chão: dimensões finitas, âncora dentro do canvas, objetos de pé assentes na base', () => {
    for (const id of FIXED_ITEMS.concat(['desconhecido'])) {
      const from = mock.all.length;
      const g = IS.ground(id, 2);
      t.ok([g.w, g.h, g.ax, g.ay].every(Number.isFinite), id + ' finito');
      t.ok(g.ax > 0 && g.ax < g.w && g.ay > 0 && g.ay < g.h, id + ' âncora fora: ' + JSON.stringify([g.w, g.h, g.ax, g.ay]));
      t.eq([g.c.width, g.c.height], [Math.round(g.w * 2), Math.round(g.h * 2)], id + ' tamanho do canvas');
      t.ok(g.w <= 72 && g.h <= 64, id + ' grande demais para um tile: ' + g.w + '×' + g.h);
      t.eq(badSince(from), 0, 'NaN em ' + id);
      if (IS.stands(id)) t.ok(g.ay > g.h * 0.6, id + ' de pé devia assentar perto da base');
      else t.ok(g.h < g.w || id.endsWith('_clip') || id === 'grenade', id + ' deitado devia ser mais largo do que alto');
    }
  });

  t.test('cache: reutiliza, limpa e respeita a escala quantizada', () => {
    const a = IS.icon('pistol', 2);
    t.ok(a === IS.icon('pistol', 2.01), 'escala quantizada a 0,25');
    t.ok(IS.ground('pistol', 1) === IS.ground('pistol', 1));
    IS.clearCache();
    t.ok(a !== IS.icon('pistol', 2), 'clearCache gera de novo');
    t.ok(IS.stats().entries >= 1);
  });

  t.test('drawIcon/drawGround desenham no contexto dado', () => {
    const c = mock.factory(200, 200), ctx = c.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    IS.drawIcon(ctx, 'medikit', 10, 10, 48);
    const spr = IS.drawGround(ctx, 'rifle', 100, 100, 1);
    t.ok(ctx.log.filter((s) => s.startsWith('drawImage')).length === 2);
    t.ok(spr && spr.c && spr.w > 0);
  });

  // ---- retratos ----
  const S = (seed, extra) => Object.assign({ portraitSeed: seed, female: false, nat: 'pt', armour: 'coveralls', rank: 0 }, extra || {});

  t.test('retratos: traços determinísticos pela semente', () => {
    t.eq(PR.traits(S(771)), PR.traits(S(771)));
    t.ok(JSON.stringify(PR.traits(S(771))) !== JSON.stringify(PR.traits(S(772))));
    t.eq(PR.traits(S(5, { rank: 'captain' })), PR.traits(S(5, { rank: 3 })), 'patente por id');
    t.eq(PR.traits(S(5, { armour: 'none' })).armour, 'coveralls', 'armadura desconhecida');
  });

  t.test('retratos: variedade de traços em 400 sementes', () => {
    const set = (k, f) => new Set(Array.from({ length: 400 }, (_, i) => PR.traits(S(i * 31 + 7, f))[k]));
    t.ok(set('style').size >= 8, 'estilos masculinos: ' + set('style').size);
    t.ok(set('style', { female: true }).size >= 7, 'estilos femininos');
    t.ok([...set('style', { female: true })].every((s) => PR.STYLES.f.includes(s)), 'só estilos femininos');
    t.ok(set('skinIdx', { nat: 'usa' }).size >= 8, 'tons de pele');
    t.ok(set('hair', { nat: 'uk' }).size >= 7, 'cores de cabelo');
    t.ok(set('eyeShape').size >= 4, 'formas dos olhos');
    t.ok(set('facial').size >= 4, 'barba/bigode');
    t.ok(set('headwear', { rank: 4 }).size >= 3, 'coberturas de cabeça');
    t.ok(set('headwear', { rank: 0, armour: 'power_suit' }).has('helmet') === false, 'sem capacete com fato energético');
    t.ok(!set('facial', { female: true }).has('beard'), 'sem barba nas mulheres');
  });

  t.test('retratos: pesos por nacionalidade', () => {
    const avg = (nat) => {
      let s = 0;
      for (let i = 0; i < 300; i++) s += PR.traits(S(i * 13 + 1, { nat })).skinIdx;
      return s / 300;
    };
    t.ok(avg('nigeria') > avg('germany') + 3, 'nigeria ' + avg('nigeria') + ' vs germany ' + avg('germany'));
    let mono = 0;
    for (let i = 0; i < 300; i++) if (PR.traits(S(i * 17 + 3, { nat: 'japan' })).eyeShape === 'monolid') mono++;
    t.ok(mono > 60, 'monolid japan ' + mono);
  });

  t.test('retratos: canvas do tamanho pedido, sem NaN, em cache e sensível a armadura/patente', () => {
    const sig = (s, px) => {
      const from = mock.all.length;
      PR.clearCache();
      const c = PR.canvas(s, px);
      t.eq([c.width, c.height], [px, px]);
      t.eq(badSince(from), 0, 'NaN no retrato');
      t.ok(fillsSince(from) > 40, 'retrato pobre');
      return sigSince(from);
    };
    for (let i = 0; i < 60; i++) sig(S(i * 101, { female: i % 3 === 0, nat: ['pt', 'nigeria', 'japan', 'uk'][i % 4], armour: ['coveralls', 'personal_armour', 'power_suit', 'flying_suit'][i % 4], rank: i % 6 }), 48 + (i % 3) * 32);
    const base = sig(S(9), 96);
    t.eq(sig(S(9), 96), base, 'determinístico');
    t.ok(sig(S(9, { armour: 'power_suit' }), 96) !== base, 'armadura muda o retrato');
    t.ok(sig(S(9, { rank: 5 }), 96) !== base, 'patente muda o retrato');
    const c = PR.canvas(S(9), 96);
    t.ok(c === PR.canvas(S(9), 96), 'cache');
  });

  t.test('retratos: draw usa a escala do contexto', () => {
    const c = mock.factory(300, 300), ctx = c.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const p = PR.draw(ctx, S(42), 5, 5, 64);
    t.eq(p.width, 128);
  });

  t.test('sem Math.random nos módulos de arte', () => {
    for (const f of ['js/gfx/sprites_items.js', 'js/gfx/portraits.js']) {
      const src = fs.readFileSync(path.join(load.ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      t.ok(!/Math\.random/.test(src), f);
    }
  });
};
