/* Testes da arte do Basescape (js/gfx/base_render.js) em Node com um canvas falso que valida as chamadas:
   todas as instalações e naves têm arte, desenho da base inicial e de uma base completa sem NaN nem raios
   negativos, obras/fantasmas/desmantelar, geometria (cellAt, layout, facilityAt, hangarSlots), ícones e caches. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', '..', 'js', 'gfx', 'base_render.js');

module.exports = function (OV, t) {
  if (!OV.BaseRender || !OV.BaseRender.draw) vm.runInThisContext(fs.readFileSync(FILE, 'utf8'), { filename: FILE });
  const BR = OV.BaseRender;

  // ---- canvas falso -----------------------------------------------------------------------------------------
  const bad = [];
  const stats = { drawImage: 0, fillText: [], canvases: 0 };
  const RADIUS = { arc: [2], arcTo: [4], ellipse: [2, 3], createRadialGradient: [2, 5] };
  function check(name, args) {
    args.forEach((a, i) => { if (typeof a === 'number' && !Number.isFinite(a)) bad.push(name + '[' + i + ']=' + a); });
    for (const i of RADIUS[name] || []) if (args[i] < 0) bad.push(name + ' raio negativo ' + args[i]);
  }
  function mockCanvas(w, h) {
    stats.canvases++;
    const c = { width: w, height: h };
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) bad.push('canvas ' + w + '×' + h);
    let depth = 0;
    const state = {};
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'canvas') return c;
        if (prop === 'save') return () => { depth++; };
        if (prop === 'restore') return () => { if (--depth < 0) bad.push('restore sem save'); };
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return (...a) => {
            check(prop, a);
            return { addColorStop: (o, col) => { if (!(o >= 0 && o <= 1) || typeof col !== 'string') bad.push('stop ' + o + ' ' + col); } };
          };
        }
        if (prop === 'createImageData') return (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
        if (prop === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (prop === 'drawImage') return (...a) => { check(prop, a); stats.drawImage++; if (!a[0] || !(a[0].width > 0)) bad.push('drawImage sem fonte'); };
        if (prop === 'fillText') return (...a) => { check(prop, a); stats.fillText.push(String(a[0])); };
        return (...a) => check(prop, a);
      },
      set(target, prop, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push('set ' + String(prop) + '=' + v);
        if ((prop === 'fillStyle' || prop === 'strokeStyle') && typeof v === 'string' && /NaN|undefined/.test(v)) bad.push('cor ' + v);
        target[prop] = v;
        return true;
      },
    });
    c.getContext = () => ctx;
    c.toDataURL = () => 'data:image/png;base64,AAAA';
    c._depth = () => depth;
    return c;
  }
  BR.setCanvasFactory(mockCanvas);
  const takeBad = () => bad.splice(0, bad.length);
  const screen = () => mockCanvas(1200, 900);

  const G = OV.Campaign.newCampaign({ seed: 3 });
  const base = G.bases[0];
  const F = (type, x, y, daysLeft) => ({ type, x, y, daysLeft: daysLeft || 0 });
  const late = {
    grid: [
      F('hangar', 0, 0), F('hangar', 2, 0), F('hangar', 4, 0),
      F('large_radar', 0, 2), F('laboratory', 1, 2), F('access_lift', 2, 2), F('living_quarters', 3, 2), F('living_quarters', 4, 2, 4), F('hyper_wave_decoder', 5, 2),
      F('alien_containment', 0, 3), F('laboratory', 1, 3), F('workshop', 2, 3), F('workshop', 3, 3), F('general_stores', 4, 3), F('psi_lab', 5, 3),
      F('hangar', 0, 4, 7), F('laser_defence', 2, 4), F('plasma_defence', 3, 4), F('grav_shield', 4, 4), F('mind_shield', 5, 4),
      F('fusion_defence', 2, 5), F('missile_defence', 3, 5), F('small_radar', 4, 5), F('instalacao_futura', 5, 5),
    ],
    crafts: ['a', 'b', 'c', 'd'],
    aliens: { sectoid_soldier: 4, muton_soldier: 2 },
  };
  const lateCrafts = [{ type: 'avenger', status: 'ready' }, { type: 'firestorm', status: 'refuel' }, { type: 'interceptor', status: 'out' }, { type: 'nave_futura', status: 'ready' }];

  t.test('BaseRender: API', () => {
    for (const f of ['draw', 'cellAt', 'layout', 'facilityAt', 'facilityRect', 'hangarSlots', 'animated', 'facilityIcon', 'craftIcon',
      'facilityIconURL', 'craftIconURL', 'hasArt', 'hasCraftArt', 'clearCache', 'stats', 'setCanvasFactory']) t.ok(typeof BR[f] === 'function', f);
    t.ok(BR.ANIM_FPS > 0, 'ANIM_FPS');
  });

  t.test('BaseRender: todas as instalações e naves dos dados têm arte própria', () => {
    for (const id of Object.keys(OV.Data.facilities)) t.ok(BR.hasArt(id), 'instalação sem arte: ' + id);
    for (const id of Object.keys(OV.Data.crafts)) t.ok(BR.hasCraftArt(id), 'nave sem arte: ' + id);
    for (const id of ['fusion_defence', 'grav_shield', 'mind_shield', 'psi_lab']) t.ok(BR.hasArt(id), 'P2 sem arte: ' + id);
  });

  t.test('BaseRender: base inicial com cursor, seleção, fantasma e desmantelar', () => {
    BR.clearCache();
    takeBad();
    const before = JSON.stringify(G);
    const c = screen();
    const g = c.getContext('2d');
    BR.draw(g, base, { x: 10, y: 20, cell: 64, dpr: 2, time: 1.25, G, hover: { x: 4, y: 3 }, selection: { x: 3, y: 3 } });
    BR.draw(g, base, { x: 10, y: 20, cell: 64, dpr: 2, time: 2, G, ghost: { type: 'hangar', x: 0, y: 0, valid: true } });
    BR.draw(g, base, { x: 10, y: 20, cell: 64, dpr: 2, time: 2, G, ghost: { type: 'laboratory', x: 5, y: 5, valid: false }, dismantle: { x: 4, y: 3 } });
    BR.draw(g, base, { x: 10, y: 20, cell: 64, dpr: 2, time: 2, G, ghost: { type: 'hangar', x: 5, y: 5, valid: false }, dismantle: { x: 2, y: 2, ok: false }, highlight: ['laboratory'] });
    t.eq(takeBad(), [], 'chamadas de canvas inválidas');
    t.eq(c._depth(), 0, 'save/restore equilibrados');
    t.eq(JSON.stringify(G), before, 'draw não altera G');
  });

  t.test('BaseRender: base completa com obras, naves, contenção e tipos desconhecidos', () => {
    takeBad();
    stats.fillText.length = 0;
    const c = screen();
    for (const dpr of [1, 2]) BR.draw(c.getContext('2d'), late, { x: 0, y: 0, cell: 80, dpr, time: 3.3, crafts: lateCrafts });
    t.eq(takeBad(), [], 'chamadas de canvas inválidas');
    t.ok(stats.fillText.includes('4') && stats.fillText.includes('7'), 'distintivos de dias em falta: ' + stats.fillText.join(','));
    // sem tempo ⇒ imagem estática válida
    BR.draw(c.getContext('2d'), late, { x: 0, y: 0, cell: 80 });
    t.eq(takeBad(), [], 'sem view.time');
  });

  t.test('BaseRender: camada estática em cache até a grelha mudar', () => {
    const g = screen().getContext('2d');
    const view = { x: 0, y: 0, cell: 60, dpr: 1, time: 0, G };
    BR.draw(g, base, view);
    const k1 = BR.stats().staticKey, n1 = stats.canvases;
    BR.draw(g, base, Object.assign({}, view, { time: 5, hover: { x: 1, y: 1 } }));
    t.eq(stats.canvases, n1, 'fotograma seguinte não cria canvases');
    t.eq(BR.stats().staticKey, k1);
    const b2 = JSON.parse(JSON.stringify(base));
    b2.grid.push({ type: 'laboratory', x: 1, y: 2, daysLeft: 10 });
    BR.draw(g, b2, view);
    t.ok(BR.stats().staticKey !== k1, 'nova obra ⇒ nova camada');
    b2.grid[b2.grid.length - 1].daysLeft = 9;
    const k2 = BR.stats().staticKey;
    BR.draw(g, b2, view);
    t.ok(BR.stats().staticKey !== k2, 'dia de obra ⇒ nova camada');
  });

  t.test('BaseRender: geometria', () => {
    const v = { x: 100, y: 50, cell: 40 };
    t.eq(BR.cellAt(v, 100, 50), { x: 0, y: 0 });
    t.eq(BR.cellAt(v, 100 + 239, 50 + 239), { x: 5, y: 5 });
    t.eq(BR.cellAt(v, 99, 60), null);
    t.eq(BR.cellAt(v, 100 + 240, 60), null);
    t.eq(BR.cellAt({ x: 0, y: 0, cell: 0 }, 5, 5), null);
    const L = BR.layout(1000, 700);
    t.ok(Number.isInteger(L.cell) && L.cell * 6 <= 700 - 24 && L.x === Math.round((1000 - 6 * L.cell) / 2), 'layout ' + JSON.stringify(L));
    t.eq(BR.layout(100, 100).cell, 28, 'célula mínima');
    t.eq(BR.facilityAt(base, 3, 1).type, 'hangar', 'célula interior do hangar 2×2');
    t.eq(BR.facilityAt(base, 0, 0), null);
    t.eq(BR.facilityRect(v, BR.facilityAt(base, 3, 1)), { x: 180, y: 50, w: 80, h: 80 });
    const slots = BR.hangarSlots(base, { G });
    t.eq(slots.map((s) => [s.x, s.y, s.craft && s.craft.type]), [[2, 0, 'skyranger'], [0, 4, 'interceptor'], [4, 4, 'interceptor']]);
    const ls = BR.hangarSlots(late, { crafts: lateCrafts });
    t.eq(ls.length, 3, 'hangar em obra não conta');
    t.ok(BR.animated(base) && !BR.animated({ grid: [] }), 'animated');
  });

  t.test('BaseRender: ícones', () => {
    takeBad();
    for (const id of Object.keys(OV.Data.facilities).concat(['psi_lab'])) {
      const a = BR.facilityIcon(id, 48, 2);
      t.ok(a.width === 96 && a.height === 96, id + ' 96×96');
      t.ok(BR.facilityIcon(id, 48, 2) !== a, 'cópia nova a cada chamada (vai para o DOM)');
    }
    for (const id of Object.keys(OV.Data.crafts).concat(['nave_futura'])) t.eq(BR.craftIcon(id, 40, 1).width, 40, id);
    t.ok(BR.facilityIconURL('laboratory', 32, 2).startsWith('data:image/png'), 'URL');
    t.eq(takeBad(), [], 'chamadas de canvas inválidas');
  });
};
