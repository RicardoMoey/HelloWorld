/* RNG determinístico (mulberry32) com estado guardável; streams separadas por domínio */
(function (OV) {
  'use strict';

  function create(seed) {
    const r = {
      s: seed >>> 0,
      // uint32 seguinte
      u32() {
        r.s = (r.s + 0x6d2b79f5) >>> 0;
        let t = r.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
      },
      // float em [0,1) — só para a camada Geoscape/cosmética
      next() {
        return r.u32() / 4294967296;
      },
      // inteiro uniforme em [a, b] (inclusive, como RNG::generate do OpenXcom)
      int(a, b) {
        if (b < a) { const t = a; a = b; b = t; }
        return a + Math.floor((r.u32() / 4294967296) * (b - a + 1));
      },
      // verdadeiro com probabilidade p% (p inteiro 0..100)
      pct(p) {
        return r.int(0, 99) < p;
      },
      pick(arr) {
        return arr[r.int(0, arr.length - 1)];
      },
      // chave escolhida com pesos {chave: peso}; ordem das chaves é estável (insertion order)
      weighted(obj) {
        let total = 0;
        for (const k in obj) total += Math.max(0, obj[k]);
        if (total <= 0) return null;
        let roll = r.int(1, total);
        for (const k in obj) {
          const w = Math.max(0, obj[k]);
          if (roll <= w) return k;
          roll -= w;
        }
        return null;
      },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = r.int(0, i);
          const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      state() {
        return r.s >>> 0;
      },
      setState(u) {
        r.s = u >>> 0;
      },
    };
    return r;
  }

  // streams independentes derivadas de uma semente
  const NAMES = ['geo', 'map', 'combat', 'ai'];
  function streams(seed) {
    const base = create(seed);
    const out = {};
    for (const n of NAMES) out[n] = create(base.u32() ^ OV.U.hash32(n.length, n.charCodeAt(0), seed));
    return out;
  }
  // estado serializável {geo: u32, ...} ⇄ objetos RNG
  function saveStreams(st) {
    const o = {};
    for (const k in st) o[k] = st[k].state();
    return o;
  }
  function loadStreams(o) {
    const st = {};
    for (const k in o) {
      st[k] = create(0);
      st[k].setState(o[k]);
    }
    return st;
  }

  OV.RNG = { create, streams, saveStreams, loadStreams, NAMES };
})(globalThis.OV || (globalThis.OV = {}));
