/* Relógio do Geoscape (DESIGN.md §3.1; contrato em docs/CAMPAIGN_API.md §2).
   G.t = segundos inteiros desde 1999-01-01 12:00 UTC (múltiplo de 5). Um tick = 5 s.
   Fronteiras (alinhadas com a hora UTC): 10 min, 30 min, 1 h, dia (00:00 UTC) e mês (dia 1 às 00:00 UTC).

   OV.Clock = {
     TICK_S, T5S, T10M, T30M, T1H, T1D, T1MO, SPEEDS, SPEED_KEYS,
     advance(G, ticks=1) → máscara das fronteiras atravessadas em (t, t + 5·ticks]
     crossed(t0, t1) → máscara (puro) ; ticksUntil(G|t, bit) → ticks (≥ 1) até à próxima fronteira desse tipo
     date(G|t) → {y, m 0..11, d 1..31, h, min, s, wd} ; monthIndex(G|t) → meses desde jan 1999
     monthStartT(monthIndex) → t do dia 1 às 00:00 ; daysInMonth(G|t) ; dayOfYear(G|t) → 0..365
     hourUTC(G|t) → hora decimal 0..24 ; sunLon(G|t) → longitude subsolar ; declination(G|t) → graus (0 sem estações)
     isNightAt(G, lon, lat) → atalho para OV.GMath.isNightAt }
   Só aritmética inteira no tempo; sem Date.now (apenas Date.UTC/OV.U.dateOf, determinísticos). */
(function (OV) {
  'use strict';

  const TICK_S = 5;
  const T5S = 1, T10M = 2, T30M = 4, T1H = 8, T1D = 16, T1MO = 32;
  const DAY = 86400;
  const NOON = 43200; // t = 0 é meio-dia: a meia-noite UTC cai em t ≡ 43 200 (mod 86 400)
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const SPEEDS = tune('GEO_SPEEDS', [1, 12, 60, 360, 720, 17280]);
  const SPEED_KEYS = ['5s', '1m', '5m', '30m', '1h', '1d'];

  const tOf = (x) => (typeof x === 'number' ? x : x && typeof x.t === 'number' ? x.t : 0);
  const fdiv = (a, b) => Math.floor(a / b);

  function date(x) {
    return OV.U.dateOf(tOf(x));
  }
  function monthIndex(x) {
    const d = date(x);
    return (d.y - 1999) * 12 + d.m;
  }
  // t do primeiro dia do mês (índice desde jan 1999) às 00:00 UTC; o mês 0 começa antes do início do jogo
  function monthStartT(mi) {
    const y = 1999 + fdiv(mi, 12), m = ((mi % 12) + 12) % 12;
    return Math.round((Date.UTC(y, m, 1) - OV.U.EPOCH_MS) / 1000);
  }
  function daysInMonth(x) {
    const d = date(x);
    return new Date(Date.UTC(d.y, d.m + 1, 0)).getUTCDate();
  }
  function dayOfYear(x) {
    const d = date(x);
    return Math.round((Date.UTC(d.y, d.m, d.d) - Date.UTC(d.y, 0, 1)) / 86400000);
  }

  // fronteiras atravessadas no intervalo (t0, t1]
  function crossed(t0, t1) {
    if (!(t1 > t0)) return 0;
    let mask = T5S;
    if (fdiv(t1, 600) > fdiv(t0, 600)) mask |= T10M;
    if (fdiv(t1, 1800) > fdiv(t0, 1800)) mask |= T30M;
    if (fdiv(t1, 3600) > fdiv(t0, 3600)) mask |= T1H;
    if (fdiv(t1 + NOON, DAY) > fdiv(t0 + NOON, DAY)) {
      mask |= T1D;
      if (monthIndex(t1) > monthIndex(t0)) mask |= T1MO;
    }
    return mask;
  }

  // avança o relógio; quem chama decide o tamanho do passo (World.step usa 1 ou ticksUntil)
  function advance(G, ticks) {
    const n = ticks === undefined ? 1 : Math.max(0, Math.floor(ticks));
    const t0 = G.t | 0;
    const t1 = t0 + n * TICK_S;
    G.t = t1;
    return crossed(t0, t1);
  }

  // ticks até à próxima fronteira do tipo `bit` (a contar do instante atual, exclusivo)
  function ticksUntil(x, bit) {
    const t = tOf(x);
    let next;
    if (bit === T10M) next = (fdiv(t, 600) + 1) * 600;
    else if (bit === T30M) next = (fdiv(t, 1800) + 1) * 1800;
    else if (bit === T1H) next = (fdiv(t, 3600) + 1) * 3600;
    else if (bit === T1D) next = (fdiv(t + NOON, DAY) + 1) * DAY - NOON;
    else if (bit === T1MO) next = monthStartT(monthIndex(t) + 1);
    else return 1;
    return Math.max(1, Math.ceil((next - t) / TICK_S));
  }

  // ---- sol (sem estações por omissão: geoConst.sun.seasons = false, como o OpenXcom) ----------------------
  function hourUTC(x) {
    const s = (((tOf(x) + NOON) % DAY) + DAY) % DAY;
    return s / 3600;
  }
  // longitude subsolar = (12 − hora UTC) × 15°, normalizada a −180..180
  function sunLon(x) {
    const sun = (OV.Data && OV.Data.geoConst && OV.Data.geoConst.sun) || {};
    const per = sun.degPerHour || 15;
    let lon = (sun.subsolarLonAtNoon || 0) + (12 - hourUTC(x)) * per;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return lon;
  }
  function declination(x) {
    const sun = (OV.Data && OV.Data.geoConst && OV.Data.geoConst.sun) || {};
    if (!sun.seasons) return 0;
    const n = dayOfYear(x) + (sun.declinationDayOffset || 10);
    return -(sun.declinationMaxDeg || 23.44) * Math.cos((2 * Math.PI * n) / 365);
  }
  const isNightAt = (G, lon, lat) => OV.GMath.isNightAt(G, lon, lat);

  OV.Clock = {
    TICK_S, T5S, T10M, T30M, T1H, T1D, T1MO, SPEEDS, SPEED_KEYS,
    advance, crossed, ticksUntil, date, monthIndex, monthStartT, daysInMonth, dayOfYear,
    hourUTC, sunLon, declination, isNightAt,
  };
})(globalThis.OV || (globalThis.OV = {}));
