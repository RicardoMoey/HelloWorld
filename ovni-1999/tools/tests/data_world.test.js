/* Testes do mapa-mundo gerado (js/data/world.js): máscaras de terra/países, antimeridiano, Antártida,
   formato dos anéis e tamanho. Regeneração opcional: node tools/test.js data_world --world-atlas <pasta> */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const load = require('../load');

const WORLD_JS = path.join(load.ROOT, 'js/data/world.js');
const IDS = ['usa', 'canada', 'brazil', 'uk', 'france', 'germany', 'italy', 'spain', 'russia', 'egypt', 'nigeria',
  'south_africa', 'india', 'china', 'japan', 'australia', 'portugal'];

module.exports = function (OV, t) {
  const W = OV.Data.world;

  t.test('world: isLand nos pontos de referência', () => {
    t.eq(W.isLand(-9.14, 38.72), true, 'Lisboa');
    t.eq(W.isLand(-30, 30), false, 'meio do Atlântico');
    t.eq(W.isLand(10, 23), true, 'Sara');
    t.eq(W.isLand(-150, 0), false, 'Pacífico');
    t.eq(W.isLand(-99, 39), true, 'Kansas');
    t.eq(W.isLand(-40, 72), true, 'Gronelândia');
    t.eq(W.isLand(80, -10), false, 'Índico');
  });

  t.test('world: countryAt nas cidades de referência', () => {
    t.eq(W.countryAt(2.35, 48.85), 'france', 'Paris');
    t.eq(W.countryAt(-99, 39), 'usa');
    t.eq(W.countryAt(37.6, 55.75), 'russia', 'Moscovo');
    t.eq(W.countryAt(-9.14, 38.72), 'portugal', 'Lisboa');
    t.eq(W.countryAt(139.7, 35.7), 'japan', 'Tóquio');
    const more = {
      uk: [-0.12, 51.5], germany: [13.4, 52.5], italy: [12.5, 41.9], spain: [-3.7, 40.4], egypt: [31.2, 30.0],
      nigeria: [7.5, 9.1], south_africa: [28.0, -26.2], india: [77.2, 28.6], china: [116.4, 39.9],
      australia: [149.1, -35.3], canada: [-75.7, 45.4], brazil: [-47.9, -15.8],
    };
    for (const id in more) t.eq(W.countryAt(more[id][0], more[id][1]), id, id);
    t.eq(W.countryAt(-8.6, 41.15), 'portugal', 'Porto');
    t.eq(W.countryAt(10, 23), null, 'Sara sem país financiador');
    t.eq(W.countryAt(-30, 30), null, 'oceano');
  });

  t.test('world: antimeridiano (Chukotka, Wrangel, Alasca, Kamchatka)', () => {
    t.eq(W.countryAt(178, 67), 'russia', 'Chukotka a oeste de 180°');
    t.eq(W.countryAt(-178, 67.5), 'russia', 'Chukotka a este de 180°');
    t.eq(W.countryAt(-179.5, 71.2), 'russia', 'ilha de Wrangel');
    t.eq(W.countryAt(-150, 64), 'usa', 'Alasca');
    t.eq(W.countryAt(160, 56), 'russia', 'Kamchatka');
    t.eq(W.isLand(-170, 50), false, 'mar de Bering a sul das Aleutas');
  });

  t.test('world: Antártida até ao polo, sem terra no polo norte', () => {
    t.eq(W.isLand(0, -89.9), true);
    t.eq(W.isLand(123, -90), true, 'o próprio polo');
    t.eq(W.isLand(45, -80), true);
    t.eq(W.isLand(-120, -85), true);
    t.eq(W.isLand(-170, -72), false, 'mar de Ross');
    t.eq(W.isLand(-45, -70), false, 'mar de Weddell');
    t.eq(W.isLand(0, 89.9), false, 'polo norte é mar');
    t.eq(W.isLand(0, -55), false, 'oceano Austral');
  });

  t.test('world: longitude dá a volta e latitude é limitada', () => {
    t.eq(W.isLand(-9.14 + 360, 38.72), true);
    t.eq(W.isLand(-9.14 - 720, 38.72), true);
    t.eq(W.countryAt(2.35 + 360, 48.85), 'france');
    t.eq(W.countryAt(-99 - 360, 39), 'usa');
    t.eq(W.isLand(180, -95), true, 'abaixo do polo sul');
    t.eq(W.isLand(180, 95), false);
  });

  t.test('world: Cáspio é água (buraco no anel da Eurásia)', () => {
    t.eq(W.isLand(50.5, 42), false);
    t.eq(W.isLand(45, 48), true, 'margem norte');
  });

  t.test('world: fronteiras de 1999 (Crimeia, Guiana Francesa)', () => {
    t.eq(W.isLand(34.1, 44.95), true, 'Crimeia é terra');
    t.eq(W.countryAt(34.1, 44.95), null, 'Crimeia não é Rússia em 1999');
    t.eq(W.isLand(-53, 4), true, 'Guiana Francesa é terra');
    t.eq(W.countryAt(-53, 4), null, 'Guiana Francesa não conta como França');
    t.eq(W.countryAt(9.1, 42.1), 'france', 'Córsega continua francesa');
    t.eq(W.countryAt(20.5, 54.7), 'russia', 'Kaliningrado');
  });

  t.test('world: countryAt com alcance apanha costas sem mudar o interior', () => {
    t.eq(W.countryAt(-10.5, 38.7), null, 'ao largo de Lisboa');
    t.eq(W.countryAt(-10.5, 38.7, 3), 'portugal');
    t.eq(W.countryAt(3.4, 6.4, 3), 'nigeria', 'Lagos');
    t.eq(W.countryAt(2.35, 48.85, 10), 'france', 'alcance não altera células com país');
    t.eq(W.countryAt(-150, 0, 5), null, 'Pacífico continua vazio');
    t.eq(W.countryAt(-179.9, 67.5, 2), 'russia', 'procura atravessa o antimeridiano');
  });

  t.test('world: entradas inválidas', () => {
    t.eq(W.isLand(NaN, 10), false);
    t.eq(W.isLand(10, undefined), false);
    t.eq(W.countryAt(Infinity, 0), null);
    t.eq(W.countryAt(0, NaN, 3), null);
  });

  t.test('world: estrutura, países e formato dos anéis', () => {
    t.eq(W.countryIds, IDS);
    t.eq(Object.keys(W.countries).sort(), IDS.slice().sort());
    t.eq(W.ringCount, W.land.length);
    t.ok(W.ringCount > 100, 'anéis de terra: ' + W.ringCount);
    t.eq([W.COLS, W.ROWS, W.CELL], [720, 360, 0.5]);
    const check = (r, what) => {
      t.ok(Array.isArray(r) && r.length >= 8 && r.length % 2 === 0, what + ': tamanho ' + r.length);
      t.ok(r[0] === r[r.length - 2] && r[1] === r[r.length - 1], what + ': anel fechado');
      for (let i = 0; i < r.length; i += 2) {
        const lon = r[i], lat = r[i + 1];
        if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) throw new Error(what + ': fora do globo ' + lon + ',' + lat);
        if (Math.abs(lon * 10 - Math.round(lon * 10)) > 1e-6 || Math.abs(lat * 10 - Math.round(lat * 10)) > 1e-6) throw new Error(what + ': mais de 1 casa decimal');
      }
    };
    W.land.forEach((r, i) => check(r, 'land[' + i + ']'));
    for (const id of IDS) {
      t.ok(W.countries[id].length >= 1, id + ' sem anéis');
      W.countries[id].forEach((r, i) => check(r, id + '[' + i + ']'));
    }
    // contorno de cada país envolve a sua cidade de referência (caixa envolvente)
    const inBox = (id, lon, lat) => W.countries[id].some((r) => {
      let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
        y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
      }
      return lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1;
    });
    t.ok(inBox('portugal', -9.14, 38.72) && inBox('japan', 139.7, 35.7) && inBox('france', 2.35, 48.85), 'contornos no sítio');
  });

  t.test('world: máscaras com as dimensões certas e coerentes', () => {
    const bits = OV.U.b64dec(W.landMask, Uint8Array);
    t.eq(bits.length, 720 * 360 / 8);
    t.ok(/^([A-R][0-9a-z]+)+$/.test(W.countryMask), 'alfabeto RLE');
    let total = 0;
    for (const m of W.countryMask.matchAll(/[A-R]([0-9a-z]+)/g)) total += parseInt(m[1], 36);
    t.eq(total, 720 * 360, 'RLE cobre a grelha');
    let land = 0, ctry = 0, ctryLand = 0;
    const seen = new Set();
    for (let r = 0; r < 360; r++) {
      for (let c = 0; c < 720; c++) {
        const lon = -179.75 + c * 0.5, lat = 89.75 - r * 0.5;
        const l = W.isLand(lon, lat), k = W.countryAt(lon, lat);
        if (l) land++;
        if (k) {
          ctry++;
          seen.add(k);
          if (l) ctryLand++;
        }
      }
    }
    const frac = land / (720 * 360);
    t.ok(frac > 0.28 && frac < 0.38, 'fração de terra na grelha ' + frac.toFixed(3));
    t.ok(ctryLand / ctry > 0.99, 'células de país são terra');
    t.eq([...seen].sort(), IDS.slice().sort(), 'todos os países presentes na máscara');
  });

  t.test('world: ficheiro ≤ 200 KB, com proveniência e congelado após finalize', () => {
    const src = fs.readFileSync(WORLD_JS, 'utf8');
    t.ok(fs.statSync(WORLD_JS).size <= 200 * 1024, 'tamanho ' + fs.statSync(WORLD_JS).size);
    for (const s of ['Natural Earth', 'world-atlas@2.0.2', 'ISC', 'Michael Bostock', 'tools/build_world.mjs']) t.ok(src.includes(s), 'cabeçalho sem ' + s);
    if (OV.Data.isFinal && OV.Data.isFinal()) {
      t.ok(Object.isFrozen(W) && Object.isFrozen(W.land) && Object.isFrozen(W.countries.usa), 'dados congelados');
      t.eq(W.isLand(-9.14, 38.72), true, 'consultas funcionam após congelar');
    }
  });

  // regenera a partir do pacote world-atlas e confirma que o ficheiro versionado está atualizado
  const src = t.args['world-atlas'];
  if (typeof src === 'string') {
    t.test('world: build_world.mjs reproduz o ficheiro versionado', () => {
      const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ovni-world-')), 'world.js');
      execFileSync(process.execPath, [path.join(load.ROOT, 'tools/build_world.mjs'), src, '--out', out], { stdio: 'pipe' });
      t.ok(fs.readFileSync(out, 'utf8') === fs.readFileSync(WORLD_JS, 'utf8'), 'world.js desatualizado: volte a correr o gerador');
    });
  }
};
