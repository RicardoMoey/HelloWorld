/* Testes do núcleo: utilitários, RNG, cor, isométrico, i18n e regra de camadas (R1) */
const fs = require('fs');
const path = require('path');
const load = require('../load');

module.exports = function (OV, t) {
  const U = OV.U;

  t.test('idiv trunca para zero', () => {
    t.eq(U.idiv(7, 2), 3);
    t.eq(U.idiv(-7, 2), -3);
  });
  t.test('isqrt exato', () => {
    for (let n = 0; n < 5000; n++) {
      const r = U.isqrt(n);
      t.ok(r * r <= n && (r + 1) * (r + 1) > n, 'isqrt(' + n + ')');
    }
  });
  t.test('dirTo: 8 direções', () => {
    t.eq(U.dirTo(0, -5), 0);
    t.eq(U.dirTo(4, -4), 1);
    t.eq(U.dirTo(5, 0), 2);
    t.eq(U.dirTo(3, 3), 3);
    t.eq(U.dirTo(0, 2), 4);
    t.eq(U.dirTo(-2, 2), 5);
    t.eq(U.dirTo(-9, 1), 6);
    t.eq(U.dirTo(-3, -3), 7);
    for (let d = 0; d < 8; d++) t.eq(U.dirTo(U.DX[d], U.DY[d]), d, 'DX/DY ' + d);
  });
  t.test('base64 de typed arrays (ida e volta)', () => {
    const a = new Uint16Array([0, 1, 65535, 1234, 42, 7]);
    t.eq(U.b64dec(U.b64enc(a), Uint16Array), a);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    t.eq(U.b64dec(U.b64enc(b), Uint8Array), b);
    const c = new Int32Array([-1, 2147483647, -2147483648]);
    t.eq(U.b64dec(U.b64enc(c), Int32Array), c);
  });
  t.test('fmtDate começa a 1 jan 1999 12:00', () => {
    t.eq(U.fmtDate(0), '1 jan 1999 · 12:00');
    t.eq(U.fmtDate(86400 * 31, false), '1 fev 1999');
  });

  t.test('RNG determinístico e com estado', () => {
    const a = OV.RNG.create(123), b = OV.RNG.create(123);
    for (let i = 0; i < 100; i++) t.eq(a.int(0, 1000), b.int(0, 1000));
    const s = a.state();
    const x = [a.int(1, 6), a.int(1, 6), a.int(1, 6)];
    a.setState(s);
    t.eq([a.int(1, 6), a.int(1, 6), a.int(1, 6)], x);
  });
  t.test('RNG.int inclusivo em ambos os extremos', () => {
    const r = OV.RNG.create(9);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(r.int(0, 3));
    t.eq([...seen].sort(), [0, 1, 2, 3]);
  });
  t.test('RNG streams independentes e serializáveis', () => {
    const st = OV.RNG.streams(77);
    t.ok(st.geo.state() !== st.combat.state());
    const saved = OV.RNG.saveStreams(st);
    const v = st.combat.int(0, 1e6);
    const st2 = OV.RNG.loadStreams(saved);
    t.eq(st2.combat.int(0, 1e6), v);
    t.eq(JSON.parse(JSON.stringify(saved)), saved);
  });

  t.test('cor: shade/mix compõem sem NaN', () => {
    const C = OV.Color;
    const c = C.shade(C.shade(0x336699, 0.2), -0.3);
    t.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff);
    t.eq(C.mix(0x000000, 0xffffff, 0.5), 0x808080);
    t.eq(C.css(0x0a0b0c), '#0a0b0c');
    t.eq(C.css(0xff0000, 0.5), 'rgba(255,0,0,0.5)');
    t.eq(C.shade(0x808080, 0), 0x808080);
  });

  t.test('isométrico: tile ↔ ecrã (ida e volta) em vários níveis e zooms', () => {
    const I = OV.Iso;
    for (const zoom of [0.5, 1, 2]) {
      const cam = { x: -300, y: -120, zoom };
      for (let z = 0; z < 3; z++)
        for (let x = 0; x < 20; x += 3)
          for (let y = 0; y < 20; y += 4) {
            const c = I.tileCenter(x, y, z, cam);
            const back = I.screenToTile(c.x, c.y, z, cam);
            t.eq([back.x, back.y], [x, y], 'tile ' + [x, y, z, zoom]);
          }
    }
  });

  t.test('i18n: T, Tn e chaves em falta visíveis', () => {
    t.eq(OV.T('common.ok'), 'OK');
    t.eq(OV.Tn('common.days', 1), '1 dia');
    t.eq(OV.Tn('common.days', 3), '3 dias');
    t.eq(OV.T('nao.existe.x'), '⟦nao.existe.x⟧');
  });

  // R1: camadas de simulação/dados sem DOM nem aleatoriedade não determinística
  t.test('R1: js/core, js/i18n, js/data, js/sim sem DOM/Math.random/globais de apresentação', () => {
    const files = load.nodeFiles().filter((f) => !f.startsWith('js/gfx/'));
    const bad = [];
    const forbidden = [
      /\bdocument\s*[.[]/, /\bwindow\s*[.[]/, /Math\.random\s*\(/, /\bperformance\s*\./, /requestAnimationFrame/,
      /\bOV\.(audio|Dom|Input|Scenes|View|Presenter|BattleRender|GlobeRender|BaseRender|FX|Game)\b/,
    ];
    for (const f of files) {
      const abs = path.join(load.ROOT, f);
      if (!fs.existsSync(abs)) continue;
      const src = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const re of forbidden) if (re.test(src) && !(f === 'js/sim/save.js' && /localStorage/.test(re.source))) bad.push(f + ' ⇢ ' + re);
    }
    t.eq(bad, [], 'violações');
  });

  t.test('index.html: todos os scripts listados existem', () => {
    const list = load.scriptList();
    const miss = list.filter((f) => !fs.existsSync(path.join(load.ROOT, f)));
    t.eq(miss, []);
  });
};
