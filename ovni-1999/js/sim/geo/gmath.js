/* Matemática do globo (DESIGN.md §12, docs/rea/05-isometrico-e-globo.md D1–D3; contrato em docs/CAMPAIGN_API.md §5.2).
   Coordenadas em graus: lon −180..180 (este +), lat −90..90 (norte +). 1 milha náutica (mn) = 1 minuto de arco.
   Pontos = qualquer objeto com {lon, lat} (naves, OVNIs, bases, locais) ou pares explícitos nas variantes *LL.
   Vetores = arrays [x, y, z] unitários (x para lon 0 / lat 0, z para o polo norte). Floats só no Geoscape (R4).

   OV.GMath = {
     D2R, NM_PER_DEG, EARTH_RADIUS_NM, wrapLon(lon), clampLat(lat),
     vec(lon, lat) → [x,y,z] ; toLL(v) → {lon, lat} ; dot(a,b) ; cross(a,b) ; normalize(v)
     angle(a, b) → rad entre pontos ; distNm(a, b) ; distNmLL(lon1, lat1, lon2, lat2) ; withinNm(a, b, nm)
     bearing(a, b) → rumo inicial 0..360 (0 = norte, sentido horário) ; destination(p, bearingDeg, nm) → {lon, lat}
     lerp(a, b, f) → ponto a fração f do grande círculo ; moveToward(a, b, nm) → {lon, lat, arrived, remainingNm}
     stepToward(a, b, knots, seconds) → idem (desloca knots·seconds/3600 mn)
     interceptPoint(chaser, chaserKn, target, targetDest, targetKn) → {lon, lat, hours} | null
     inRect(lon, lat, rect) ; inAreas(areas, lon, lat) ; regionAt(lon, lat) ; countryAt(lon, lat) (retângulos orig: pontuação)
     countryAtMap(lon, lat, reach?) (contornos reais: apresentação) ; isLand(lon, lat)
     sunLL(G) → {lon, lat} ; sunVec(G) ; sunElevation(G, lon, lat) → graus ; dayPhase(G, lon, lat) → 'day'|'dusk'|'night'
     isNightAt(G, lon, lat) ; missionShade(G, lon, lat) → 0..15
     randomPointInAreas(rng, areas) ; randomLandPoint(rng, areas, tries?) → {lon, lat, land}
     randomPointAround(rng, center, minDeg, maxDeg) → {lon, lat}
     path(a, b, maxStepDeg?) → [[lon, lat], …] ; smallCircle(center, radiusNm, n?) → [[lon, lat], …] } */
(function (OV) {
  'use strict';

  const D2R = Math.PI / 180;
  const NM_PER_DEG = 60;
  const EARTH_RADIUS_NM = (180 * NM_PER_DEG) / Math.PI;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);

  const wrapLon = (lon) => {
    if (lon >= -180 && lon <= 180) return lon;
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  };
  const clampLat = (lat) => (lat < -90 ? -90 : lat > 90 ? 90 : lat);

  function vec(lon, lat) {
    const l = lon * D2R, p = lat * D2R, cp = Math.cos(p);
    return [cp * Math.cos(l), cp * Math.sin(l), Math.sin(p)];
  }
  function toLL(v) {
    const h = Math.hypot(v[0], v[1]);
    const lat = Math.atan2(v[2], h) / D2R;
    // nos polos a longitude é indefinida: 0 por convenção
    const lon = h < 1e-12 ? 0 : Math.atan2(v[1], v[0]) / D2R;
    return { lon: lon + 0, lat: lat + 0 };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function normalize(v) {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  }
  const vp = (p) => vec(p.lon, p.lat);
  // ângulo entre vetores unitários (atan2: estável para distâncias pequenas e quase antípodas)
  const angleV = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));

  const angle = (a, b) => angleV(vp(a), vp(b));
  const distNm = (a, b) => (angle(a, b) / D2R) * NM_PER_DEG;
  const distNmLL = (lon1, lat1, lon2, lat2) => (angleV(vec(lon1, lat1), vec(lon2, lat2)) / D2R) * NM_PER_DEG;
  const withinNm = (a, b, nm) => distNm(a, b) <= nm;

  // rumo inicial de a para b (graus, 0 = norte, 90 = este)
  function bearing(a, b) {
    const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) return 0;
    return ((Math.atan2(y, x) / D2R) + 360) % 360;
  }
  // ponto a nm milhas de p no rumo dado
  function destination(p, bearingDeg, nm) {
    const d = (nm / NM_PER_DEG) * D2R, th = bearingDeg * D2R;
    const p1 = p.lat * D2R, l1 = p.lon * D2R;
    const sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th);
    const p2 = Math.asin(Math.max(-1, Math.min(1, sp2)));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sp2);
    return { lon: wrapLon(l2 / D2R) + 0, lat: p2 / D2R + 0 };
  }

  // interpolação esférica entre vetores (fração f do arco)
  function slerpV(a, b, f) {
    const w = angleV(a, b);
    if (w < 1e-12) return a.slice();
    const s = Math.sin(w);
    if (s < 1e-12) {
      // antípodas: qualquer grande círculo serve; escolhe-se o que passa pelo norte local (determinístico)
      const north = normalize(cross(cross(a, [0, 0, 1]), a));
      const ok = Math.hypot(...north) > 0.5 ? north : [1, 0, 0];
      const th = f * Math.PI;
      return normalize([a[0] * Math.cos(th) + ok[0] * Math.sin(th), a[1] * Math.cos(th) + ok[1] * Math.sin(th), a[2] * Math.cos(th) + ok[2] * Math.sin(th)]);
    }
    const k1 = Math.sin((1 - f) * w) / s, k2 = Math.sin(f * w) / s;
    return normalize([a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2]);
  }
  const lerp = (a, b, f) => toLL(slerpV(vp(a), vp(b), f));

  // desloca nm milhas de a para b pelo grande círculo; chega a b exatamente quando a distância não excede nm
  function moveToward(a, b, nm) {
    const va = vp(a), vb = vp(b);
    const total = (angleV(va, vb) / D2R) * NM_PER_DEG;
    if (total <= nm) return { lon: b.lon, lat: b.lat, arrived: true, remainingNm: 0 };
    const p = toLL(slerpV(va, vb, nm / total));
    return { lon: p.lon, lat: p.lat, arrived: false, remainingNm: total - nm };
  }
  const stepToward = (a, b, knots, seconds) => moveToward(a, b, Math.max(0, (knots * seconds) / 3600));

  /* Ponto de encontro: o alvo segue de target para targetDest a targetKn e para lá fica; devolve o primeiro instante
     (em horas) em que a perseguidora, a chaserKn em linha reta (grande círculo), o alcança. Sem destino (ou alvo
     parado) é a posição atual. null só se chaserKn ≤ 0. */
  function interceptPoint(chaser, chaserKn, target, targetDest, targetKn) {
    if (!(chaserKn > 0)) return null;
    const vc = vp(chaser), vt = vp(target);
    const distToT = (angleV(vc, vt) / D2R) * NM_PER_DEG;
    if (!targetDest || !(targetKn > 0)) return { lon: target.lon, lat: target.lat, hours: distToT / chaserKn };
    const vd = vp(targetDest);
    const legNm = (angleV(vt, vd) / D2R) * NM_PER_DEG;
    if (legNm < 1e-9) return { lon: target.lon, lat: target.lat, hours: distToT / chaserKn };
    const tLeg = legNm / targetKn;
    const posAt = (h) => slerpV(vt, vd, Math.min(1, (h * targetKn) / legNm));
    const gap = (h) => (angleV(vc, posAt(h)) / D2R) * NM_PER_DEG - chaserKn * h;
    if (gap(0) <= 0) return { lon: target.lon, lat: target.lat, hours: 0 };
    const N = 64;
    let lo = 0, hi = -1;
    for (let k = 1; k <= N; k++) {
      const h = (tLeg * k) / N;
      if (gap(h) <= 0) { hi = h; break; }
      lo = h;
    }
    if (hi < 0) {
      // o alvo chega ao destino antes do encontro: espera-se lá
      const p = toLL(vd);
      return { lon: p.lon, lat: p.lat, hours: ((angleV(vc, vd) / D2R) * NM_PER_DEG) / chaserKn };
    }
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) <= 0) hi = mid;
      else lo = mid;
    }
    const p = toLL(posAt(hi));
    return { lon: p.lon, lat: p.lat, hours: hi };
  }

  // ---- regiões, países e terra (delegam em OV.Data) -----------------------------------------------------------
  const inAreas = (areas, lon, lat) => OV.Data.inAreas(areas, lon, lat);
  const inRect = (lon, lat, rect) => OV.Data.inAreas([rect], lon, lat);
  const regionAt = (lon, lat) => OV.Data.regionAt(wrapLon(lon), lat);
  const countryAt = (lon, lat) => OV.Data.countryAt(wrapLon(lon), lat);
  const countryAtMap = (lon, lat, reach) => OV.Data.world.countryAt(wrapLon(lon), lat, reach);
  const isLand = (lon, lat) => OV.Data.world.isLand(wrapLon(lon), lat);

  // ---- sol e noite -------------------------------------------------------------------------------------------
  const sunLL = (G) => ({ lon: OV.Clock.sunLon(G), lat: OV.Clock.declination(G) });
  const sunVec = (G) => vp(sunLL(G));
  function sunElevation(G, lon, lat) {
    const s = dot(sunVec(G), vec(lon, lat));
    return Math.asin(Math.max(-1, Math.min(1, s))) / D2R;
  }
  // > dayElevDeg dia, ≥ duskElevDeg crepúsculo, abaixo noite (geoConst.sun)
  function dayPhase(G, lon, lat) {
    const sun = (OV.Data.geoConst && OV.Data.geoConst.sun) || {};
    const e = sunElevation(G, lon, lat);
    const day = sun.dayElevDeg === undefined ? 0 : sun.dayElevDeg;
    const dusk = sun.duskElevDeg === undefined ? -6 : sun.duskElevDeg;
    if (e > day) return 'day';
    if (e >= dusk) return 'dusk';
    return 'night';
  }
  const isNightAt = (G, lon, lat) => dayPhase(G, lon, lat) === 'night';
  function missionShade(G, lon, lat) {
    const ph = dayPhase(G, lon, lat);
    if (ph === 'day') return tune('SHADE_DAY', 0);
    if (ph === 'dusk') return tune('SHADE_DUSK', 6);
    return tune('SHADE_NIGHT', 13);
  }

  // ---- pontos aleatórios (só com uma stream da simulação: rng.next/int) ---------------------------------------
  // retângulo escolhido uniformemente, ponto uniforme em lon/lat dentro dele (orig RuleRegion::getRandomPoint)
  function randomPointInAreas(rng, areas) {
    const a = areas[rng.int(0, areas.length - 1)];
    const lon = a[0] + rng.next() * (a[1] - a[0]);
    const lat = a[2] + rng.next() * (a[3] - a[2]);
    return { lon: wrapLon(lon), lat: clampLat(lat) };
  }
  // até `tries` tentativas em terra (orig: 10; senão o OVNI descola logo); devolve sempre um ponto
  function randomLandPoint(rng, areas, tries) {
    const n = tries === undefined ? ((OV.Data.missionRules && OV.Data.missionRules.landPointTries) || 10) : Math.max(1, tries | 0);
    let p = null;
    for (let k = 0; k < n; k++) {
      p = randomPointInAreas(rng, areas);
      if (isLand(p.lon, p.lat)) return { lon: p.lon, lat: p.lat, land: true };
    }
    return { lon: p.lon, lat: p.lat, land: false };
  }
  // ponto a uma distância angular uniforme em [minDeg, maxDeg] e rumo uniforme (zona 5: entrada/saída)
  function randomPointAround(rng, center, minDeg, maxDeg) {
    const d = minDeg + rng.next() * (maxDeg - minDeg);
    const b = rng.next() * 360;
    return destination(center, b, d * NM_PER_DEG);
  }

  // ---- geometria para desenho (apresentação usa; puro) --------------------------------------------------------
  function path(a, b, maxStepDeg) {
    const step = maxStepDeg > 0 ? maxStepDeg : 2;
    const va = vp(a), vb = vp(b);
    const n = Math.max(1, Math.ceil(angleV(va, vb) / D2R / step));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const p = toLL(slerpV(va, vb, k / n));
      out.push([p.lon, p.lat]);
    }
    return out;
  }
  function smallCircle(center, radiusNm, n) {
    const N = n > 0 ? n | 0 : 48;
    const out = [];
    for (let k = 0; k <= N; k++) {
      const p = destination(center, (360 * k) / N, radiusNm);
      out.push([p.lon, p.lat]);
    }
    return out;
  }

  OV.GMath = {
    D2R, NM_PER_DEG, EARTH_RADIUS_NM, wrapLon, clampLat,
    vec, toLL, dot, cross, normalize, angle, distNm, distNmLL, withinNm, bearing, destination,
    lerp, moveToward, stepToward, interceptPoint,
    inRect, inAreas, regionAt, countryAt, countryAtMap, isLand,
    sunLL, sunVec, sunElevation, dayPhase, isNightAt, missionShade,
    randomPointInAreas, randomLandPoint, randomPointAround, path, smallCircle,
  };
})(globalThis.OV || (globalThis.OV = {}));
