/* Cor canónica: inteiro 0xRRGGBB. Conversão para CSS só no momento de desenhar. */
(function (OV) {
  'use strict';

  const r8 = (c) => (c >> 16) & 255, g8 = (c) => (c >> 8) & 255, b8 = (c) => c & 255;
  const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  // f < 0 escurece para preto, f > 0 clareia para branco (|f| ≤ 1)
  function shade(c, f) {
    const m = (v) => clamp8(f < 0 ? v * (1 + f) : v + (255 - v) * f);
    return pack(m(r8(c)), m(g8(c)), m(b8(c)));
  }
  function mix(a, b, t) {
    return pack(clamp8(r8(a) + (r8(b) - r8(a)) * t), clamp8(g8(a) + (g8(b) - g8(a)) * t), clamp8(b8(a) + (b8(b) - b8(a)) * t));
  }
  const cache = new Map();
  function css(c, a) {
    if (a === undefined || a >= 1) {
      let s = cache.get(c);
      if (!s) {
        s = '#' + (c & 0xffffff).toString(16).padStart(6, '0');
        cache.set(c, s);
      }
      return s;
    }
    return 'rgba(' + r8(c) + ',' + g8(c) + ',' + b8(c) + ',' + (a < 0 ? 0 : a) + ')';
  }
  const fromHex = (s) => parseInt(String(s).replace('#', ''), 16) & 0xffffff;

  OV.Color = { shade, mix, css, pack, r8, g8, b8, fromHex };
})(globalThis.OV || (globalThis.OV = {}));
