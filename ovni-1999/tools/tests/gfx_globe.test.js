/* Globo do Geoscape (js/gfx/globe_render.js) em Node: projeção/inversa, raios de zoom, escolha de objetos, radares,
   animações da câmara, um desenho completo com canvas falso (caches por câmara/sol e paridade do antípoda no
   preenchimento da terra) e o caminho do fotograma em movimento (meia resolução, assentamento pelo relógio). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', '..', 'js', 'gfx', 'globe_render.js');

// canvas e Path2D falsos: registam operações para inspeção
class FakePath {
  constructor(p) { this.ops = p && p.ops ? p.ops.slice() : []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
  closePath() { this.ops.push(['Z']); }
  arc(x, y, r, a0, a1) { this.ops.push(['A', x, y, r, a0, a1]); }
}
const CUR = { log: null };
function fakeCanvas() {
  const c = { width: 1, height: 1 };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'canvas') return c;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (prop === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return (...a) => { if (CUR.log) CUR.log.push([prop, a]); };
    },
    set(target, prop, v) { target[prop] = v; return true; },
  });
  c.getContext = () => ctx;
  return c;
}

// globais do navegador só durante o teste de desenho (não contaminam os outros ficheiros)
function withDom(fn) {
  const had = { doc: Object.prototype.hasOwnProperty.call(globalThis, 'document'), p2d: Object.prototype.hasOwnProperty.call(globalThis, 'Path2D') };
  const prev = { doc: globalThis.document, p2d: globalThis.Path2D };
  globalThis.document = { createElement: () => fakeCanvas() };
  globalThis.Path2D = FakePath;
  try { return fn(); } finally {
    if (had.doc) globalThis.document = prev.doc; else delete globalThis.document;
    if (had.p2d) globalThis.Path2D = prev.p2d; else delete globalThis.Path2D;
  }
}

module.exports = function (OV, t) {
  if (!OV.Color) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'gfx', 'color.js'), 'utf8'));
  vm.runInThisContext(fs.readFileSync(FILE, 'utf8'), { filename: FILE });
  const GR = OV.GlobeRender;
  const view0 = () => ({ lon: -9, lat: 38.7, zoom: 1, w: 1440, h: 900, dpr: 2, time: 1000, mode: 'normal', selection: null, hover: null, highlights: [] });

  t.test('globo: raios de zoom orig × altura e interpolação geométrica', () => {
    const v = view0();
    const R = [0.45, 0.6, 0.9, 1.4, 2.25, 3.6];
    for (let z = 0; z <= 5; z++) { v.zoom = z; t.near(GR.radius(v), R[z] * 900, 1e-9, 'zoom ' + z); }
    v.zoom = 2.5;
    t.near(GR.radius(v), Math.sqrt(0.9 * 1.4) * 900, 1e-9);
    v.zoom = 9;
    t.near(GR.radius(v), 3.6 * 900, 1e-9, 'limitado a 5');
  });

  t.test('globo: pick∘project é a identidade na face visível (vários centros e zooms, polos incluídos)', () => {
    let n = 0, worst = 0;
    for (const [lon0, lat0, z] of [[-9, 38.7, 1], [170, -80, 0], [100, 89, 3], [-120, 10, 5], [0, 0, 2.3]]) {
      const v = Object.assign(view0(), { lon: lon0, lat: lat0, zoom: z });
      for (let i = 0; i < 300; i++) {
        const lon = -180 + ((i * 137.507) % 360), lat = -89 + ((i * 59.3) % 178);
        const p = GR.project(v, lon, lat);
        if (!p.front) continue;
        const q = GR.pick(v, p.x, p.y);
        if (!q) continue;
        n++;
        worst = Math.max(worst, OV.GMath.distNmLL(lon, lat, q.lon, q.lat));
      }
    }
    t.ok(n > 500, 'pontos testados ' + n);
    t.ok(worst < 1e-6, 'erro máximo ' + worst + ' mn');
  });

  t.test('globo: centro, limbo, face oculta e espaço', () => {
    const v = view0();
    const c = GR.project(v, -9, 38.7);
    t.near(c.x, 720, 1e-9);
    t.near(c.y, 450, 1e-9);
    t.ok(c.front);
    t.eq(GR.project(v, 171, -38.7).front, false, 'antípoda atrás');
    t.ok(GR.visible(v, 0, 40) && !GR.visible(v, 171, -38.7));
    t.eq(GR.pick(v, 2, 2), null, 'canto da janela é espaço');
    const R = GR.radius(v);
    t.ok(GR.pick(v, 720 + R * 0.999, 450) !== null && GR.pick(v, 720 + R * 1.001, 450) === null, 'limbo em R');
    const n = GR.project(v, -9, 50);
    t.ok(n.y < 450, 'norte para cima');
    const e = GR.project(v, 0, 38.7);
    t.ok(e.x > 720, 'este à direita');
    const off = GR.project(Object.assign(view0(), { cx: 500, cy: 400 }), -9, 38.7);
    t.ok(Math.abs(off.x - 500) < 1e-9 && Math.abs(off.y - 400) < 1e-9, 'centro do globo deslocado (cx, cy)');
  });

  function scene() {
    const G = OV.Campaign.newCampaign({ seed: 5 });
    const C = OV.Campaign;
    const ufo = (lon, lat, status, extra) => {
      const u = Object.assign({ id: C.nextId(G, 'u'), type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 1,
        lon, lat, dest: null, alt: 3, speed: 2000, status, dmg: 0, detected: true, hyper: false, groundLeftS: 0, crashLeftS: 0,
        lastSeen: null, objective: false, targetBaseId: null, siteCity: null }, extra || {});
      G.ufos.push(u);
      return u;
    };
    const u1 = ufo(5, 45, 'flying');
    const u2 = ufo(20, 50, 'flying', { detected: false });
    const u3 = ufo(171, -38, 'flying');
    const u4 = ufo(-3, 42, 'crashed', { detected: false });
    const cid = Object.keys(G.crafts).find((id) => G.crafts[id].type === 'interceptor');
    Object.assign(G.crafts[cid], { status: 'out', lon: 5, lat: 45, dest: { kind: 'ufo', id: u1.id }, speed: 2100 });
    const city = OV.Data.citiesById.rome;
    G.sites.push({ id: 't1', kind: 'terror', missionId: null, deployment: 'dep_terror_site', cityId: 'rome', lon: city.lon, lat: city.lat, race: 'floater', region: 'europe', country: 'italy', leftS: 3600 });
    G.alienBases.push({ id: 'a1', lon: 25, lat: 62, race: 'sectoid', region: 'europe', country: null, missionId: null, discovered: false, foundT: null, supplyT: null });
    return { G, u1, u2, u3, u4, cid };
  }

  t.test('globo: objectAt — prioridade OVNI sobre nave, ocultos, face de trás, bases, cidades só a zoom ≥ 3', () => {
    const { G, u1, u2, u3, u4, cid } = scene();
    const v = view0();
    const p = GR.screenPos(G, v, { kind: 'ufo', id: u1.id });
    t.eq(GR.objectAt(G, v, p.x + 3, p.y - 2), { kind: 'ufo', id: u1.id }, 'OVNI ganha à nave no mesmo ponto');
    const all = GR.objectsAt(G, v, p.x, p.y).map((h) => h.kind + ':' + h.id);
    t.ok(all.includes('craft:' + cid), 'a nave também está ao alcance: ' + all.join(','));
    const p2 = GR.project(v, u2.lon, u2.lat);
    t.eq(GR.objectAt(G, v, p2.x, p2.y), null, 'OVNI não detetado é invisível');
    const p4 = GR.project(v, u4.lon, u4.lat);
    t.eq(GR.objectAt(G, v, p4.x, p4.y), { kind: 'ufo', id: u4.id }, 'local de queda sempre visível');
    const p3 = GR.project(v, u3.lon, u3.lat);
    t.ok(!p3.front && !GR.objectsAt(G, v, p3.x, p3.y).some((h) => h.id === u3.id), 'face de trás não responde');
    const ab = GR.project(v, 25, 62);
    t.eq(GR.objectAt(G, v, ab.x, ab.y), null, 'base alienígena por descobrir');
    G.alienBases[0].discovered = true;
    t.eq(GR.objectAt(G, v, ab.x, ab.y), { kind: 'alienBase', id: 'a1' });
    const b = GR.project(v, G.bases[0].lon, G.bases[0].lat);
    t.eq(GR.objectAt(G, v, b.x + 6, b.y + 4), { kind: 'base', id: G.bases[0].id });
    t.eq(GR.objectAt(G, v, b.x + 40, b.y + 40), null, 'longe de tudo');
    const st = GR.screenPos(G, v, { kind: 'site', id: 't1' });
    t.eq(GR.objectAt(G, v, st.x, st.y), { kind: 'site', id: 't1' }, 'terror por cima da cidade');
    const paris = OV.Data.citiesById.paris;
    const pc = GR.project(v, paris.lon, paris.lat);
    t.eq(GR.objectAt(G, v, pc.x, pc.y), null, 'cidades escondidas a zoom 1');
    const v3 = Object.assign(view0(), { zoom: 3, lon: paris.lon, lat: paris.lat });
    t.eq(GR.objectAt(G, v3, 720, 450), { kind: 'city', id: 'paris' });
    t.eq(GR.objectAt(null, v3, 720, 450), { kind: 'city', id: 'paris' }, 'sem campanha (colocar a 1.ª base)');
    const touch = Object.assign(view0(), { touch: true });
    t.eq(GR.objectAt(G, touch, b.x + 19, b.y), { kind: 'base', id: G.bases[0].id }, 'alcance maior em toque');
    t.eq(GR.countryAt(v, GR.project(v, 2.5, 46.5).x, GR.project(v, 2.5, 46.5).y), 'france');
  });

  t.test('globo: radarCircles — radares concluídos da base e naves no ar', () => {
    const { G, cid } = scene();
    const saved = OV.World && OV.World.radarCircles;
    if (OV.World) OV.World.radarCircles = undefined;
    try {
      const r = GR.radarCircles(G);
      const base = r.filter((c) => c.baseId);
      t.ok(base.length >= 1 && base.every((c) => c.rangeNm === OV.Data.facilities[c.kind].radarRange), JSON.stringify(base));
      const craft = r.filter((c) => c.craftId);
      t.eq(craft.length, 1);
      t.eq(craft[0].craftId, cid);
      G.bases[0].grid.forEach((f) => { if (OV.Data.facilities[f.type].radarRange) f.daysLeft = 3; });
      t.eq(GR.radarCircles(G).filter((c) => c.baseId).length, 0, 'em construção não conta');
    } finally {
      if (OV.World) OV.World.radarCircles = saved;
    }
  });

  t.test('globo: câmara — rotateBy, zoomAt ancorado, rotateTo com «voo», zoomTo, fling', () => {
    const v = view0();
    GR.rotateBy(v, -100, 0);
    t.ok(v.lon > -9, 'arrastar para a esquerda leva a vista para este');
    GR.rotateBy(v, 0, 1e6);
    t.eq(v.lat, 89, 'latitude limitada a ±89');
    const w = view0();
    const a = GR.pick(w, 1000, 300);
    GR.zoomAt(w, 4, 1000, 300);
    const b = GR.pick(w, 1000, 300);
    t.ok(OV.GMath.distNmLL(a.lon, a.lat, b.lon, b.lat) < 2, 'ponto sob o cursor fica');
    t.eq(w.zoom, 4);
    const r = Object.assign(view0(), { time: 0, zoom: 2 });
    GR.rotateTo(r, 140, 35, 800);
    t.ok(GR.update(r, 400) && GR.busy(r), 'a meio');
    t.ok(r.zoom < 2, 'afasta-se a meio de uma viagem longa');
    t.eq(GR.update(r, 900), false);
    t.near(r.lon, 140, 1e-9);
    t.near(r.lat, 35, 1e-9);
    t.eq(r.zoom, 2);
    const z = Object.assign(view0(), { time: 0 });
    GR.zoomTo(z, 3, 200);
    GR.update(z, 100);
    t.ok(z.zoom > 1 && z.zoom < 3);
    GR.update(z, 250);
    t.eq(z.zoom, 3);
    const f = Object.assign(view0(), { time: 0 });
    GR.fling(f, 1, 0);
    let k = 0;
    for (let ms = 16; GR.update(f, ms) && k < 1000; ms += 16) k++;
    t.ok(f.lon < -9 && k > 5 && k < 1000, 'inércia decai até parar (' + k + ' passos)');
    GR.rotateTo(f, 0, 0, 0);
    t.ok(f.lon === 0 && f.lat === 0, 'ms 0 é imediato');
  });

  // espera síncrona sem gastar CPU (o assentamento também conta tempo real)
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const isCanvas = (o) => o && typeof o.getContext === 'function';

  t.test('globo: em movimento (dpr 2) o globo desenha-se a meia resolução e é ampliado ×2 de uma vez', () => withDom(() => {
    const { G } = scene();
    const main = fakeCanvas().getContext('2d');
    const v = Object.assign(view0(), { time: 2e7 });
    GR.invalidate();
    let r = GR.draw(main, G, v);
    t.ok(r.base && !GR.busy(v), 'primeira imagem logo fina');
    GR.rotateBy(v, 7, 2);
    v.time += 16;
    CUR.log = [];
    r = GR.draw(main, G, v);
    const lg = CUR.log;
    CUR.log = null;
    t.ok(r.base && GR.busy(v), 'fotograma grosseiro, ainda por refinar');
    const up = lg.filter((e) => e[0] === 'drawImage' && e[1].length === 9 && isCanvas(e[1][0]) && e[1][7] === 2 * e[1][3] && e[1][8] === 2 * e[1][4]);
    t.eq(up.length, 1, 'uma só ampliação exata ×2');
    const lo = up[0][1][0], R = GR.radius(v);
    t.ok(lo.width <= 1440 && lo.height <= 900, 'canvas reduzido no máximo do tamanho CSS: ' + lo.width + '×' + lo.height);
    t.ok(lo.height === 900 && lo.width >= 2 * R && lo.width < 2 * R + 2 * 75, 'só o globo e o halo em largura: ' + lo.width);
    t.ok(up[0][1][5] >= 0 && up[0][1][5] + up[0][1][7] <= 2880 + 1e-9, 'dentro do ecrã');
    const fineOps = lg.filter((e) => e[0] === 'putImageData').length;
    t.eq(fineOps, 3, 'biomas e sombra numa só passagem (3 imagens)');
    // gesto em pausa (câmara e sol iguais) antes de assentar: reaproveita o globo reduzido
    v.time += 16;
    CUR.log = [];
    r = GR.draw(main, G, v);
    const lg2 = CUR.log;
    CUR.log = null;
    t.ok(GR.busy(v), 'ainda à espera de assentar');
    t.eq(lg2.filter((e) => e[0] === 'putImageData').length, 0, 'sem nova amostragem');
    t.ok(lg2.some((e) => e[0] === 'drawImage' && e[1][0] === lo), 'volta a ampliar o mesmo canvas reduzido');
  }));

  t.test('globo: em movimento com dpr 1 desenha diretamente; assenta pelo relógio real mesmo com view.time parado', () => withDom(() => {
    const { G } = scene();
    const main = fakeCanvas().getContext('2d');
    const v = Object.assign(view0(), { dpr: 1, time: 3e7 });
    GR.invalidate();
    GR.draw(main, G, v);
    GR.rotateBy(v, -9, 0);
    CUR.log = [];
    let r = GR.draw(main, G, v);
    const lg = CUR.log;
    CUR.log = null;
    t.ok(r.base && GR.busy(v), 'grosseiro');
    t.ok(!lg.some((e) => e[0] === 'drawImage' && e[1].length === 9 && e[1][7] === 2 * e[1][3]), 'sem ampliação');
    t.ok(lg.some((e) => e[0] === 'clip' && e[1][1] === 'evenodd'), 'terra recortada diretamente');
    // view.time congelado (capturas estáticas): só o relógio real avança
    r = GR.draw(main, G, v);
    t.ok(GR.busy(v), 'logo a seguir ainda grosseiro');
    sleep(300);
    r = GR.draw(main, G, v);
    t.ok(r.base && r.light && !GR.busy(v), 'assentou: imagem fina');
    // voltar exatamente a uma câmara já em cache não passa pelo fotograma grosseiro
    const lon0 = v.lon;
    GR.rotateBy(v, 40, 0);
    GR.draw(main, G, v);
    v.lon = lon0;
    r = GR.draw(main, G, v);
    t.ok(!r.base && !GR.busy(v), 'cache fina reutilizada');
  }));

  t.test('globo: arrastos lentos (fotogramas > 260 ms) nunca forçam a imagem fina a meio do gesto', () => withDom(() => {
    const { G } = scene();
    const main = fakeCanvas().getContext('2d');
    const v = Object.assign(view0(), { time: 4e7 });
    GR.invalidate();
    GR.draw(main, G, v);
    let fine = 0;
    for (let k = 0; k < 4; k++) {
      v.time += 400;
      GR.rotateBy(v, 6, 1);
      const r = GR.draw(main, G, v);
      if (!GR.busy(v) || (r.base && !r.light)) fine++;
    }
    t.eq(fine, 0, 'cada fotograma com a câmara a mudar é grosseiro');
    v.time += 400;
    t.ok(GR.draw(main, G, v).base && !GR.busy(v), 'parado: fina');
  }));

  t.test('globo: draw com canvas falso — caches, modos, e paridade do antípoda no preenchimento da terra', () => withDom(() => {
    const { G, u1 } = scene();
    const main = fakeCanvas().getContext('2d');
    const v = Object.assign(view0(), { time: 1e7, selection: { kind: 'ufo', id: u1.id }, highlights: [{ kind: 'site', id: 't1' }], country: 'france' });
    GR.invalidate();
    let r = GR.draw(main, G, v);
    t.ok(r.base && r.light, 'primeiro desenho constrói as duas camadas');
    v.time += 16;
    r = GR.draw(main, G, v);
    t.ok(!r.base && !r.light, 'mesma câmara e mesmo sol: só a camada dinâmica');
    G.t += 3600;
    v.time += 16;
    r = GR.draw(main, G, v);
    t.ok(!r.base && r.light, 'o sol mexeu: só a luz');
    // a rodar: desenho direto (sem caches) e depois assenta
    for (let k = 0; k < 4; k++) {
      v.time += 16;
      GR.rotateBy(v, 5, 0);
      r = GR.draw(main, G, v);
    }
    t.ok(r.base && GR.busy(v), 'em movimento: desenho direto, ainda por refinar');
    v.time += 400;
    r = GR.draw(main, G, v);
    t.ok(r.base && !GR.busy(v), 'parado: cache fina');
    for (const mode of ['placeBase', 'target']) {
      Object.assign(v, { mode, cursor: { lon: 10, lat: 45 }, targetFrom: { lon: -9, lat: 38 }, time: v.time + 16 });
      GR.draw(main, G, v);
    }
    GR.draw(main, null, Object.assign(view0(), { mode: 'placeBase', cursor: { lon: -40, lat: 30 }, t: 0, time: v.time + 5000 }));
    // paridade: quando o antípoda do centro está em terra, o recorte evenodd da terra leva o anel do limbo
    const W = OV.Data.world;
    let clock = 1e8;
    const rimIn = (lon, lat) => {
      CUR.log = [];
      GR.invalidate();
      const cv = Object.assign(view0(), { lon, lat, zoom: 0, time: (clock += 1e6) });
      GR.draw(fakeCanvas().getContext('2d'), null, cv);
      const lg = CUR.log;
      CUR.log = null;
      const clip = lg.find((e) => e[0] === 'clip' && e[1][1] === 'evenodd');
      const R = GR.radius(cv);
      t.ok(!!clip, 'recorte da terra presente');
      return !!clip && clip[1][0].ops.some((o) => o[0] === 'A' && Math.abs(o[3] - R) < 1e-6);
    };
    // antípoda de (lon, lat) = (lon+180, −lat): Chade, Atlântico, Índico, Tibete, Oregon, Atlântico Sul
    // (um anel todo atrás é abatido junto com a sua paridade: o resultado visível é o mesmo)
    const cases = [[-160, -20], [140, -40], [-60, 40], [-100, -30], [60, -45], [170, 10]];
    let lands = 0;
    for (const [lon, lat] of cases) {
      const aLon = ((lon + 360) % 360) - 180, aLat = -lat;
      const land = W.isLand(aLon, aLat);
      if (land) lands++;
      t.eq(rimIn(lon, lat), land, 'centro ' + lon + ',' + lat + ' (antípoda em terra: ' + land + ')');
    }
    t.ok(lands >= 3 && lands <= 4, 'casos mistos (' + lands + ' em terra)');
  }));
};
