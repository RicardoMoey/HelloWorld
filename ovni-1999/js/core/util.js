/* Utilitários puros: inteiros, direções, base64 de typed arrays, formatação */
(function (OV) {
  'use strict';

  // direções 0..7 = N, NE, E, SE, S, SW, W, NW (N = y−1)
  const DX = [0, 1, 1, 1, 0, -1, -1, -1];
  const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // divisão inteira truncada para zero (como C/C++), determinística em qualquer motor
  const idiv = (a, b) => Math.trunc(a / b);

  // raiz quadrada inteira (floor), exata para n < 2^31
  function isqrt(n) {
    if (n <= 0) return 0;
    let x = Math.floor(Math.sqrt(n));
    while (x * x > n) x--;
    while ((x + 1) * (x + 1) <= n) x++;
    return x;
  }

  // hash inteiro de 3 valores → uint32 (variantes de sprites, decisões cosméticas)
  function hash32(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // direção 0..7 a partir de um delta (o eixo dominante decide; diagonais quando |dx|≈|dy|)
  function dirTo(dx, dy) {
    if (dx === 0 && dy === 0) return 0;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    // sectores de 45°: eixo dominante se |maior| > tan(67.5°)·|menor| ≈ 2.414·|menor| (comparação inteira)
    if (ay * 1000 > ax * 2414) return dy < 0 ? 0 : 4;
    if (ax * 1000 > ay * 2414) return dx > 0 ? 2 : 6;
    if (dx > 0) return dy < 0 ? 1 : 3;
    return dy < 0 ? 7 : 5;
  }

  const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  // ---- base64 de typed arrays (para gravações) -------------------------------------------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64I = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;

  function bytesToB64(bytes) {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rem = bytes.length - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    return out;
  }
  function b64ToBytes(s) {
    const len = s.length;
    let pad = 0;
    if (len && s[len - 1] === '=') pad++;
    if (len > 1 && s[len - 2] === '=') pad++;
    const out = new Uint8Array((len / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < len; i += 4) {
      const a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)];
      const c = s[i + 2] === '=' ? 0 : B64I[s.charCodeAt(i + 2)];
      const d = s[i + 3] === '=' ? 0 : B64I[s.charCodeAt(i + 3)];
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      if (o < out.length) out[o++] = (n >> 16) & 255;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
    }
    return out;
  }
  // typed array → string base64 (little-endian dos bytes subjacentes)
  const b64enc = (ta) => bytesToB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength));
  function b64dec(str, Ctor) {
    const bytes = b64ToBytes(str);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Ctor(copy.buffer, 0, copy.byteLength / Ctor.BYTES_PER_ELEMENT);
  }

  // ---- formatação pt-PT -------------------------------------------------------------------
  const thin = ' ';
  function fmtInt(n) {
    const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, thin);
    return (n < 0 ? '−' : '') + s;
  }
  const fmtMoney = (n) => (n < 0 ? '−' : '') + '$' + fmtInt(Math.abs(n));

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // t = segundos desde 1999-01-01 12:00 UTC (relógio do Geoscape)
  const EPOCH_MS = Date.UTC(1999, 0, 1, 12, 0, 0);
  function dateOf(t) {
    const d = new Date(EPOCH_MS + Math.floor(t) * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
  }
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function fmtDate(t, withTime) {
    const d = dateOf(t);
    const s = d.d + ' ' + MONTHS[d.m] + ' ' + d.y;
    return withTime === false ? s : s + ' · ' + pad2(d.h) + ':' + pad2(d.min);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }

  // cópia profunda de JSON puro (inclui typed arrays)
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v)) return v.slice();
    if (Array.isArray(v)) return v.map(clone);
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }

  OV.U = {
    DX, DY, clamp, idiv, isqrt, hash32, dirTo, chebyshev, dist2,
    b64enc, b64dec, fmtInt, fmtMoney, fmtDate, dateOf, pad2, MONTHS, MONTHS_LONG, EPOCH_MS,
    esc, deepFreeze, clone,
  };
})(globalThis.OV || (globalThis.OV = {}));
