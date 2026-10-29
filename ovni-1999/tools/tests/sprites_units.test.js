/* Testes dos sprites vetoriais de unidades (js/gfx/sprites_units.js) com um canvas falso que valida
   todas as chamadas (números finitos, raios não negativos): geometria, âncoras, direções, cache. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', '..', 'js', 'gfx', 'sprites_units.js');

module.exports = function (OV, t) {
  // a camada gfx não é carregada pelo carregador Node: carregar só este módulo (precisa de OV.U e OV.Color)
  if (!OV.UnitSprites) vm.runInThisContext(fs.readFileSync(FILE, 'utf8'), { filename: FILE });
  const US = OV.UnitSprites;

  // ---- canvas falso que regista problemas -------------------------------------------------------------
  const bad = [];
  let draws = [];
  const RADIUS_ARGS = { arc: [2], ellipse: [2, 3], createRadialGradient: [2, 5] };
  function check(name, args) {
    args.forEach((a, i) => {
      if (typeof a === 'number' && !Number.isFinite(a)) bad.push(name + '[' + i + ']=' + a);
    });
    for (const i of RADIUS_ARGS[name] || []) if (args[i] < 0) bad.push(name + ' raio negativo ' + args[i]);
  }
  function mockCanvas(w, h, transform) {
    const c = { width: w, height: h };
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) bad.push('canvas ' + w + '×' + h);
    const state = {};
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'canvas') return c;
        if (prop === 'getTransform') return () => Object.assign({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, transform);
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return (...a) => {
            check(prop, a);
            return { addColorStop: (o, col) => { if (!(o >= 0 && o <= 1) || typeof col !== 'string') bad.push('stop ' + o); } };
          };
        }
        if (prop === 'drawImage') return (...a) => { check(prop, a); draws.push(a); };
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
  US.setCanvasFactory((w, h) => mockCanvas(w, h));
  const takeBad = () => bad.splice(0, bad.length);

  const WPN = { soldier: 'rifle', sectoid: 'pistol', floater: 'rifle', snakeman: 'rifle', muton: 'heavy', ethereal: 'pistol' };

  t.test('API e listas fixas', () => {
    t.eq(US.KEYS, ['soldier', 'sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f']);
    t.eq(US.POSES, ['stand', 'walk', 'kneel', 'aim', 'fall', 'dead', 'float']);
    t.eq(US.ARMOURS, ['coveralls', 'personal_armour', 'power_suit', 'flying_suit']);
    for (const f of ['get', 'clearCache', 'drawShadow', 'selectionRing', 'blit', 'draw', 'model', 'project']) t.ok(typeof US[f] === 'function', f);
    t.eq(US.sizeOf('sectopod'), 2);
    t.eq(US.sizeOf('cyberdisc'), 2);
    t.eq(US.sizeOf('reaper'), 2);
    t.eq(US.sizeOf('sectoid'), 1);
  });

  t.test('todas as chaves × direções × poses × frames: geometria válida', () => {
    US.clearCache();
    let n = 0;
    for (const key of US.KEYS) {
      for (let dir = 0; dir < 8; dir++) {
        for (const pose of US.POSES) {
          for (let f = 0; f < US.FRAMES[pose]; f++) {
            const opts = { weapon: WPN[key] || 'none', armour: US.ARMOURS[(dir + f) & 3], skin: dir & 3, female: !!(dir & 1), rank: dir % 6, variant: dir };
            const s = US.get(key, dir, pose, f, 1.5, opts);
            n++;
            t.ok(s.w > 0 && s.h > 0 && s.w % 4 === 0 && s.h % 4 === 0, key + ' dimensões ' + s.w + '×' + s.h);
            t.eq(s.c.width, s.w * 1.5, key + ' largura do canvas');
            t.eq(s.c.height, s.h * 1.5, key + ' altura do canvas');
            t.ok(s.ax >= 2 && s.ax <= s.w - 2 && s.ay >= 2 && s.ay <= s.h - 2, key + ' âncora dentro do canvas');
            t.eq(s.size, US.sizeOf(key));
            t.eq(s.fy - s.ay, s.size > 1 ? 16 : 0, key + ' centro da pegada');
            const b = takeBad();
            t.ok(!b.length, key + ' ' + dir + ' ' + pose + ' ' + f + ': ' + b.slice(0, 3).join('; '));
          }
        }
      }
    }
    t.eq(n, 13 * 8 * 15);
  });

  t.test('cache: mesma chave devolve o mesmo sprite; escala quantizada a 0.25', () => {
    US.clearCache();
    const a = US.get('soldier', 3, 'stand', 0, 1, { weapon: 'rifle' });
    t.ok(US.get('soldier', 3, 'stand', 0, 1, { weapon: 'rifle' }) === a);
    t.ok(US.get('soldier', 3, 'stand', 0, 1.1, { weapon: 'rifle' }) === a, '1.1 → 1');
    t.ok(US.get('soldier', 3, 'stand', 0, 1.25, { weapon: 'rifle' }) !== a, '1.25 é outra escala');
    t.ok(US.get('soldier', 4, 'stand', 0, 1, { weapon: 'rifle' }) !== a, 'outra direção');
    t.ok(US.get('soldier', 3, 'stand', 0, 1, { weapon: 'pistol' }) !== a, 'outra arma');
    // opções irrelevantes para a chave não duplicam a cache
    const d = US.get('cyberdisc', 1, 'stand', 0, 1);
    t.ok(US.get('cyberdisc', 1, 'stand', 0, 1, { armour: 'power_suit', weapon: 'rifle', skin: 3, rank: 4 }) === d);
    t.ok(US.get('sectoid', 1, 'stand', 0, 1, { armour: 'power_suit' }) === US.get('sectoid', 1, 'stand', 0, 1));
    // frames: queda prende no último, marcha dá a volta; direções fora de 0..7 dão a volta
    t.ok(US.get('muton', 2, 'fall', 9, 1) === US.get('muton', 2, 'fall', 2, 1));
    t.ok(US.get('muton', 2, 'walk', 5, 1) === US.get('muton', 2, 'walk', 1, 1));
    t.ok(US.get('muton', 10, 'stand', 0, 1) === US.get('muton', 2, 'stand', 0, 1));
    t.ok(US.get('muton', -1, 'stand', 0, 1) === US.get('muton', 7, 'stand', 0, 1));
    t.ok(US.stats().entries > 0);
    US.clearCache();
    t.eq(US.stats().entries, 0);
    t.ok(US.get('soldier', 3, 'stand', 0, 1, { weapon: 'rifle' }) !== a, 'nova após clearCache');
  });

  t.test('cache respeita o orçamento de píxeis (LRU)', () => {
    US.clearCache();
    US.setBudget(40000);
    for (let d = 0; d < 8; d++) US.get('soldier', d, 'walk', d & 3, 2);
    t.ok(US.stats().pixels <= 40000 || US.stats().entries === 1, 'dentro do orçamento');
    t.ok(US.stats().entries < 8, 'expulsou os mais antigos');
    US.setBudget(24e6);
    US.clearCache();
  });

  t.test('projeção: direções 0..7 no ecrã (N = cima-direita)', () => {
    const sgn = (v) => (Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1);
    const want = [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    for (let d = 0; d < 8; d++) {
      const p = US.project(d, 10, 0, 0);
      t.eq([sgn(p.x), sgn(p.y)], want[d], 'dir ' + d);
    }
    // altura sobe no ecrã, 1 px por unidade
    t.eq(US.project(0, 0, 0, 44).y, -44);
    // um tile (32 unidades) para E desloca 32 px em x e 16 px em y
    const e = US.project(2, 32, 0, 0);
    t.near(e.x, 32, 1e-9);
    t.near(e.y, 16, 1e-9);
  });

  t.test('a arma aponta na direção da unidade (pose aim)', () => {
    const cases = [['soldier', { weapon: 'rifle' }], ['soldier', { weapon: 'pistol' }], ['soldier', { weapon: 'heavy' }], ['sectoid', { weapon: 'pistol' }], ['muton', { weapon: 'heavy' }], ['floater', { weapon: 'rifle' }], ['cyberdisc', {}], ['sectopod', {}]];
    for (const [key, opts] of cases) {
      const mz = [];
      for (let d = 0; d < 8; d++) {
        const m = US.model(key, d, 'aim', 0, opts);
        mz[d] = m.marks.muzzle;
        t.ok(mz[d], key + ' sem marca de boca');
        // N/NE/E à direita do corpo, S/SW/W à esquerda (x relativo ao centro da pegada)
        const fx = US.project(d, 1, 0, 0).x;
        if (Math.abs(fx) > 0.1) t.ok(Math.sign(mz[d].x) === Math.sign(fx), key + ' dir ' + d + ' boca em x=' + mz[d].x.toFixed(1));
      }
      // SE vira-se para a câmara, NW de costas: a boca fica bem mais perto da câmara em SE
      t.ok(mz[3].d > mz[7].d + 15, key + ' profundidade da boca SE ' + mz[3].d.toFixed(1) + ' vs NW ' + mz[7].d.toFixed(1));
    }
  });

  t.test('alturas de pé e pés na âncora', () => {
    const top = (key, o) => -US.model(key, 3, 'stand', 0, o).bbox[1];
    const bottom = (key, d) => US.model(key, d, 'stand', 0, { weapon: 'none' }).bbox[3];
    const hs = top('soldier', { weapon: 'none' });
    t.ok(hs >= 40 && hs <= 48, 'soldado ' + hs.toFixed(1));
    const hc = top('sectoid', {});
    t.ok(hc >= 27 && hc <= 34, 'sectoide ' + hc.toFixed(1));
    const hm = top('muton', { weapon: 'none' });
    t.ok(hm >= 43 && hm <= 51 && hm > hs, 'muton ' + hm.toFixed(1));
    for (const key of ['soldier', 'sectoid', 'muton', 'snakeman', 'chryssalid', 'zombie', 'civilian_m', 'civilian_f']) {
      for (let d = 0; d < 8; d++) {
        const b = bottom(key, d);
        t.ok(b >= -1 && b <= (key === 'snakeman' ? 12 : 7), key + ' ' + d + ' base em ' + b.toFixed(1));
      }
    }
    // flutuantes: a base fica acima do chão (âncora)
    const fl = US.model('floater', 3, 'stand', 0, {}).bbox[3];
    t.ok(fl < -1, 'Flutuante paira (' + fl.toFixed(1) + ')');
    const fs1 = US.model('soldier', 3, 'float', 0, { armour: 'flying_suit' }).bbox[3];
    t.ok(fs1 < -3, 'fato de voo paira (' + fs1.toFixed(1) + ')');
    const fs2 = US.model('soldier', 3, 'float', 0, { armour: 'coveralls' }).bbox[3];
    t.ok(fs2 > -1, 'fato-macaco não voa');
  });

  t.test('2×2: corpo centrado na pegada, 16 px abaixo da âncora', () => {
    for (const key of ['cyberdisc', 'sectopod', 'reaper']) {
      const m = US.model(key, 3, 'stand', 0, {});
      const cx = (m.bbox[0] + m.bbox[2]) / 2;
      t.ok(Math.abs(cx) < 8, key + ' centrado em x (' + cx.toFixed(1) + ')');
      if (key !== 'cyberdisc') t.ok(m.bbox[3] > 16, key + ' assenta abaixo do tile base');
      else t.ok(m.bbox[3] < 16, 'ciberdisco paira');
      t.ok(16 - m.bbox[1] > 34, key + ' altura ' + (16 - m.bbox[1]).toFixed(1));
      const s = US.get(key, 3, 'stand', 0, 1);
      t.eq(s.fy - s.ay, 16);
    }
  });

  t.test('olhos só visíveis de frente', () => {
    const feats = (key, d) => US.model(key, d, 'stand', 0, {}).parts.filter((p) => p.feat).length;
    t.ok(feats('sectoid', 3) >= 2, 'sectoide de frente');
    t.eq(feats('sectoid', 7), 0, 'sectoide de costas');
    t.ok(feats('sectoid', 2) >= 1, 'sectoide de perfil');
  });

  t.test('cadáveres deitados no chão', () => {
    for (const key of ['soldier', 'sectoid', 'muton', 'floater', 'ethereal', 'zombie', 'civilian_f', 'chryssalid', 'snakeman']) {
      for (let d = 0; d < 8; d++) {
        const b = US.model(key, d, 'dead', 0, { weapon: WPN[key] || 'none' }).bbox;
        t.ok(-b[1] < 30, key + ' ' + d + ' deitado (topo ' + (-b[1]).toFixed(1) + ')');
        t.ok(b[2] - b[0] < 80, key + ' ' + d + ' largura ' + (b[2] - b[0]).toFixed(1));
      }
    }
    // a queda progride: o topo desce frame a frame
    const tops = [0, 1, 2].map((f) => -US.model('soldier', 2, 'fall', f, {}).bbox[1]);
    t.ok(tops[0] > tops[1] && tops[1] > tops[2], 'queda ' + tops.map((v) => v.toFixed(0)).join(' > '));
  });

  t.test('blit alinha a píxeis do dispositivo e aplica sombra/clarão', () => {
    US.clearCache();
    const spr = US.get('soldier', 2, 'stand', 0, 2, {});
    const target = mockCanvas(400, 400, { a: 2, d: 2, e: 0, f: 0 });
    draws = [];
    US.blit(target.getContext('2d'), spr, 100.3, 80.7, 1, 0, 0);
    t.eq(draws.length, 1);
    const [img, dx, dy, dw, dh] = draws[0];
    t.ok(img === spr.c);
    t.ok(Number.isInteger(dx) && Number.isInteger(dy), 'posição inteira');
    t.eq([dw, dh], [spr.w * 2, spr.h * 2]);
    t.eq(dx, Math.round((100.3 - spr.ax) * 2));
    US.silhouette(spr, false);
    US.silhouette(spr, true);
    draws = [];
    US.blit(target.getContext('2d'), spr, 100, 80, 1, 8, 0.5);
    t.eq(draws.length, 3, 'base + noite + clarão');
    draws = [];
    US.blit(target.getContext('2d'), spr, 100, 80, 1, 16, 0);
    t.eq(draws.length, 0, 'shade 16 não desenha');
    draws = [];
    const s2 = US.draw(target.getContext('2d'), 'reaper', 1, 'walk', 2, 50, 50, 1.5, {});
    t.eq(s2.c.width, s2.w * 3, 'escala = zoom × dpr');
    t.ok(!takeBad().length);
  });

  t.test('sombra e anel de seleção sem erros', () => {
    const ctx = mockCanvas(200, 200).getContext('2d');
    US.drawShadow(ctx, 50, 50, 1, 1);
    US.drawShadow(ctx, 50, 50, 2, 2);
    US.selectionRing(ctx, 50, 50, 1, 0xffc23a);
    US.selectionRing(ctx, 50, 50, 0.5, '#00ff00', 2);
    t.ok(!takeBad().length);
  });

  t.test('sem aleatoriedade nem estado global', () => {
    const src = fs.readFileSync(FILE, 'utf8');
    t.ok(src.indexOf('Math.random') < 0, 'Math.random');
    t.ok(src.indexOf('localStorage') < 0, 'localStorage');
    const a = US.model('chryssalid', 5, 'walk', 3, {}), b = US.model('chryssalid', 5, 'walk', 3, {});
    t.eq(JSON.stringify(a.bbox), JSON.stringify(b.bbox));
  });
};
