/* Regras do Geoscape (DESIGN.md §3.1, §3.17–3.19, §7.3, §12): regiões, países, cidades, terrenos, trajetórias,
   missões alienígenas, guião mensal, raças por mês, constantes do globo e pontuação.
   Exporta em OV.Data: regions, countries, cities, citiesById, terrainBoxes, terrainAt, trajectories, altitudes,
   alienMissions, missionScripts, scriptsForMonth, raceSchedule, raceWeights, missionRules, geoConst, scoring,
   ratingKey, inAreas, regionAt, countryAt.
   Coordenadas em graus, normais: lon −180..180 (este +), lat −90..90 (norte +). Áreas = [lonMin, lonMax, latMin,
   latMax], meio-abertas [min, max) exceto nos bordos 180/90. Convertidas de OpenXcom xcom1 (regions.rul,
   countries.rul: lon 0..360, lat negativa a norte); os retângulos que atravessam o antimeridiano estão partidos
   em dois. As 15 regiões cobrem o globo sem sobreposições (verificado em testes). */
(function (OV) {
  'use strict';

  OV.Data = OV.Data || {};
  // finalize.js carrega no fim; até lá o registo de finalizadores usa a mesma lista
  OV.Data.finalizers = OV.Data.finalizers || [];
  OV.Data.onFinalize = OV.Data.onFinalize || function (name, fn, order) {
    OV.Data.finalizers.push({ name, fn, order: order === undefined ? 50 : order });
  };
  const TUNE = OV.TUNE || {};

  // ids fixos partilhados entre ficheiros
  const UFO_IDS = ['small_scout', 'medium_scout', 'large_scout', 'harvester', 'abductor', 'supply_ship', 'terror_ship', 'battleship'];
  const RACE_IDS = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal', 'mixed'];
  const TERRAIN_IDS = ['FARM', 'FOREST', 'JUNGLE', 'DESERT', 'MOUNTAIN', 'POLAR', 'URBAN', 'ALIENBASE', 'MARS'];

  // ---- regiões (orig regions.rul) -----------------------------------------------------------------------------
  // baseCost $ para construir uma base na região; weight = regionWeight (tabela de missões); missionWeights =
  // tabela de missões da região (orig); missionRegion = região que recebe as missões de uma região oceânica.
  // missionZones[z] (z = 0..5, como nas trajetórias): 0–2 e 4 = áreas de aterragem (4 = bases alienígenas),
  // 3 = cidades [lon, lon, lat, lat, cityId] (nas regiões polares e no Pacífico só áreas sem cidade: sem terror),
  // 5 = entrada/saída (orig; o simulador usa o anel geoConst.entryRingDeg em torno do centróide, §12).
  const REGIONS = {
    north_america: {
      baseCost: 800000, weight: 18,
      areas: [
        [-165, -55, 55, 70], [-130, -55, 30, 55], [-120, -60, 10, 30],
      ],
      missionWeights: { alien_research: 14, alien_harvest: 17, alien_abduction: 20, alien_infiltration: 20, alien_base: 20 },
      missionZones: [
        [ // 0
          [-160, -140, 60, 65], [-130, -100, 55, 65], [-80, -70, 40, 50], [-130, -110, 40, 50], [-100, -80, 40, 50],
          [-130, -110, 30, 40], [-110, -88, 28, 40], [-90, -70, 25, 42], [-85, -65, 10, 35], [-120, -80, 10, 30],
        ],
        [ // 1
          [-160, -135, 60.75, 63.75], [-115, -100, 50, 54], [-110, -100, 40, 50], [-90, -80, 34, 37],
          [-105, -100, 30, 40], [-105, -100, 20, 25], [-101.25, -96.25, 17.5, 19], [-73.5, -70.5, 18.625, 19.375],
          [-120, -118, 44, 45], [-100, -90, 34, 44],
        ],
        [ // 2
          [-124, -120, 45, 50], [-100, -98, 45, 50], [-95, -90, 17, 18], [-86.875, -84.25, 12.25, 13.25],
          [-118.125, -114.125, 34.625, 36.5], [-73.625, -69, 45, 46.625], [-107.25, -96.875, 39, 42.25],
          [-73.125, -71, 18.5, 19], [-85.5, -83.75, 43.375, 44.375], [-159.375, -143.25, 62.25, 64.75],
        ],
        [ // 3
          [-73.875, -73.875, 40.75, 40.75, 'new_york'], [-77.125, -77.125, 38.75, 38.75, 'washington'],
          [-118.25, -118.25, 34.125, 34.125, 'los_angeles'], [-75.75, -75.75, 45.5, 45.5, 'montreal'],
          [-82.375, -82.375, 22.5, 22.5, 'havana'], [-99.125, -99.125, 19.375, 19.375, 'mexico_city'],
          [-87.625, -87.625, 41.875, 41.875, 'chicago'], [-123.25, -123.25, 49.375, 49.375, 'vancouver'],
          [-96.625, -96.625, 32.75, 32.75, 'dallas'],
        ],
        [ // 4
          [-110, -90, 64, 66], [-80, -67.5, 46, 51], [-92.5, -90.5, 29.5, 30], [-120, -114, 38, 45],
          [-82.5, -81.5, 28, 31], [-73.125, -71.25, 18.75, 19.5], [-86.75, -84.25, 11.875, 13.125],
          [-113, -112.5, 26.75, 27.25], [-137.125, -120.75, 59.875, 63.625], [-101.875, -92.875, 36.875, 40.75],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-5, 5, -5, 5], [170, 180, 40, 60],
          [-180, -170, 40, 60], [-55, -35, 30, 60], [-80, -60, -36.125, -16.125], [4.75, 27.625, 44.375, 52],
          [75, 89, 34.375, 39], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    arctic: {
      baseCost: 950000, weight: 4,
      areas: [
        [-180, 180, 70, 90],
      ],
      missionWeights: { alien_research: 25, alien_base: 35 },
      missionZones: [
        [ // 0
          [-54.75, -26.875, 75.25, 79.25], [-86.75, -77.875, 71.625, 73.375], [159.375, 180, 75, 78.625],
          [-180, -154.25, 75, 78.625], [8.5, 72.75, 74.125, 80.375], [74.875, 165.875, 74, 79.75],
          [-180, 180, 85, 90],
        ],
        [ // 1
          [-57.75, -36.375, 78.625, 80.75], [62, 66, 75.25, 76.125], [13.625, 20.875, 78.5, 79.25],
          [168.5, 180, 82.25, 83.375], [-180, -175.375, 82.25, 83.375], [-91.375, -79.25, 76.75, 78.875],
          [-180, 180, 88.125, 90],
        ],
        [ // 2
          [-57.75, -36.375, 78.625, 80.75], [62, 66, 75.25, 76.125], [13.625, 20.875, 78.5, 79.25],
          [168.5, 180, 82.25, 83.375], [-180, -175.375, 82.25, 83.375], [-91.375, -79.25, 76.75, 78.875],
          [-180, 180, 88.125, 90],
        ],
        [ // 3
          [-57.75, -36.375, 78.625, 80.75], [62, 66, 75.25, 76.125],
        ],
        [ // 4
          [-57.75, -36.375, 78.625, 80.75], [62, 66, 75.25, 76.125], [13.625, 20.875, 78.5, 79.25],
          [168.5, 180, 82.25, 83.375], [-180, -175.375, 82.25, 83.375], [-91.375, -79.25, 76.75, 78.875],
          [-180, 180, 88.125, 90],
        ],
        [ // 5
          [121.625, 176.125, 21.75, 46.25], [-180, 180, -90, -80], [-180, -160, -10, 0], [-5, 5, -5, 5],
          [170, 180, 40, 60], [-180, -170, 40, 60], [-55, -35, 30, 60], [-80, -60, -36.125, -16.125],
          [4.75, 27.625, 44.375, 52], [75, 89, 34.375, 39], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    antarctica: {
      baseCost: 900000, weight: 4,
      areas: [
        [-180, 180, -90, -60],
      ],
      missionWeights: { alien_research: 25, alien_base: 35 },
      missionZones: [
        [ // 0
          [77, 108.125, -76.125, -62.125], [-19.25, 48.5, -72.75, -57.25], [104.375, 148.875, -66.25, -49.625],
          [175.75, 180, -73.625, -55.625], [-180, -102.875, -73.625, -55.625], [-180, 180, -90, -85],
        ],
        [ // 1
          [-68.875, -63.75, -70.5, -68.25], [129.625, 152.75, -73.625, -69.75], [6.625, 35.125, -77, -72.875],
          [148.125, 154.75, -72.75, -70], [-180, 180, -90, -87.5],
        ],
        [ // 2
          [-68.875, -63.75, -70.5, -68.25], [129.625, 152.75, -73.625, -69.75], [6.625, 35.125, -77, -72.875],
          [148.125, 154.75, -72.75, -70], [-180, 180, -90, -87.5],
        ],
        [ // 3
          [-68.875, -63.75, -70.5, -68.25], [129.625, 152.75, -73.625, -69.75],
        ],
        [ // 4
          [-68.875, -63.75, -70.5, -68.25], [129.625, 152.75, -73.625, -69.75], [6.625, 35.125, -77, -72.875],
          [148.125, 154.75, -72.75, -70], [-180, 180, -90, -87.5],
        ],
        [ // 5
          [121.625, 176.125, 21.75, 46.25], [-164.25, -122, -2, 29], [-180, -160, -10, 0], [-5, 5, -5, 5],
          [170, 180, 40, 60], [-180, -170, 40, 60], [-55, -35, 30, 60], [-80, -60, -36.125, -16.125],
          [4.75, 27.625, 44.375, 52], [75, 89, 34.375, 39], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    south_america: {
      baseCost: 600000, weight: 10,
      areas: [
        [-90, -45, 0, 10], [-85, -30, -15, 0], [-85, -35, -60, -15],
      ],
      missionWeights: { alien_research: 10, alien_harvest: 24, alien_abduction: 12, alien_infiltration: 18, alien_base: 22 },
      missionZones: [
        [ // 0
          [-79.625, -62.375, 4.125, 11.875], [-80.875, -58.625, -7.75, 1], [-54.5, -36.25, -11, -0.875],
          [-78.375, -67.75, -26.625, -10.75], [-58, -45.625, -31.875, -22.75], [-70.875, -62.25, -49.5, -38.5],
          [-78.625, -56.25, -56.125, -48],
        ],
        [ // 1
          [-47.125, -39.75, -11.5, -6.25], [-69.25, -66.25, 6.125, 8.625], [-69.5, -65.625, -31.5, -28.875],
          [-57, -47.25, -24.5, -21.75],
        ],
        [ // 2
          [-75.75, -70.25, 6.5, 8.375], [-54.625, -48, -16.125, -13.25], [-70.125, -65.375, -37.625, -34.625],
          [-72.125, -67.75, -49.25, -47.25], [-60.5, -58.875, -51.875, -51.375],
        ],
        [ // 3
          [-47.875, -47.875, -15.75, -15.75, 'brasilia'], [-74.125, -74.125, 4.5, 4.5, 'bogota'],
          [-57.5, -57.5, -34.5, -34.5, 'buenos_aires'], [-70.625, -70.625, -33.375, -33.375, 'santiago'],
          [-43.125, -43.125, -22.875, -22.875, 'rio_de_janeiro'], [-77, -77, -12, -12, 'lima'],
          [-66.875, -66.875, 10.5, 10.5, 'caracas'],
        ],
        [ // 4
          [-69.875, -54.5, -7.625, -1.5], [-74.125, -70.5, -15.625, -13.625], [-70, -65.875, -44.875, -41.25],
          [-70.625, -65.875, -27.125, -22.875],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-5, 5, -5, 5], [170, 180, 40, 60],
          [-180, -170, 40, 60], [21.5, 51.75, 15.875, 31.875], [-121.375, -101.375, 33.375, 53.375],
          [4.75, 27.625, 44.375, 52], [75, 89, 34.375, 39], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    europe: {
      baseCost: 1000000, weight: 16,
      areas: [
        [-25, 60, 35, 70],
      ],
      missionWeights: { alien_research: 10, alien_harvest: 10, alien_abduction: 15, alien_infiltration: 20, alien_base: 6 },
      missionZones: [
        [ // 0
          [-26, 36.125, 58.125, 66.125], [-12, 1.875, 49.375, 59.375], [9.125, 27.75, 37.875, 43.875],
          [17.125, 50.25, 48, 53.75], [-13.125, 3.5, 38.5, 45.125],
        ],
        [ // 1
          [-3.5, 0.25, 51.875, 53], [-7.25, -2.5, 39.125, 41.625], [3.625, 12.5, 48.25, 49.625],
          [19.125, 24.75, 45.5, 47.875],
        ],
        [ // 2
          [-21.5, -18.5, 64, 65.25], [-5.75, -4.25, 56.625, 57.5], [8.625, 10.375, 56, 57],
          [17.125, 27.875, 43.125, 45.75], [-7.375, -1.125, 37.75, 39.375],
        ],
        [ // 3
          [-0.125, -0.125, 51.5, 51.5, 'london'], [2.375, 2.375, 48.75, 48.75, 'paris'],
          [13.375, 13.375, 52.5, 52.5, 'berlin'], [37.625, 37.625, 55.75, 55.75, 'moscow'],
          [12.5, 12.5, 41.875, 41.875, 'rome'], [-3.75, -3.75, 40.375, 40.375, 'madrid'],
          [19.125, 19.125, 47.5, 47.5, 'budapest'],
        ],
        [ // 4
          [-4.125, -2.75, 57, 57.625], [17.5, 29, 67.625, 69.375], [-8.375, -6.75, 38, 40.125],
          [45.625, 51.5, 47, 49.5], [13.625, 26.625, 47.625, 52.375],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [9.375, 45.375, -35.75, 1], [21.5, 51.75, 15.875, 31.875], [-121.375, -101.375, 33.375, 53.375],
          [64.5, 125.5, 44, 55.5], [72.875, 105.25, 11.75, 25], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    north_africa: {
      baseCost: 650000, weight: 12,
      areas: [
        [-25, 40, 15, 35], [-25, 55, 0, 15],
      ],
      missionWeights: { alien_research: 8, alien_harvest: 8, alien_abduction: 8, alien_infiltration: 8, alien_base: 19 },
      missionZones: [
        [ // 0
          [-11.5, 24.5, 25, 34.5], [-20.375, 5.75, 4.75, 18.375], [13, 48.5, 7.25, 14.625],
          [29.625, 50.125, 17.25, 30.75],
        ],
        [ // 1
          [-5.75, 5.125, 32.875, 34.5], [-14.375, 0.25, 11.25, 13.875], [29.5, 41.25, 5.25, 13.25],
          [20.625, 24.625, 31.125, 32.125],
        ],
        [ // 2
          [-11.375, -1.25, 20.125, 27.125], [23.375, 40.125, 3.875, 13.75], [-12, -2.875, 7.5, 10.75],
          [2.25, 8.5, 34.625, 35.875],
        ],
        [ // 3
          [3.125, 3.125, 6.5, 6.5, 'lagos'], [31.25, 31.25, 30, 30, 'cairo'],
          [-7.625, -7.625, 33.5, 33.5, 'casablanca'],
        ],
        [ // 4
          [5.625, 9, 5, 6.125], [15.75, 31.75, 18.75, 26.125], [-9.625, -4.375, 6.125, 8.375],
          [-11.875, -2.625, 19, 26],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [66, 102, -39.375, -2.625], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [64.5, 125.5, 44, 55.5], [72.875, 105.25, 11.75, 25], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    south_africa: {
      baseCost: 550000, weight: 8,
      areas: [
        [5, 55, -40, 0],
      ],
      missionWeights: { alien_research: 7, alien_harvest: 8, alien_abduction: 8, alien_infiltration: 8, alien_base: 9 },
      missionZones: [
        [ // 0
          [7.125, 27, -7.625, 0.375], [40.875, 56.625, -30.625, -12], [11.25, 37, -35.875, -21.75],
          [27, 45.375, -11, 3.875],
        ],
        [ // 1
          [19.875, 24.25, -31.25, -28.5], [44.75, 48.75, -21.375, -16.875], [14.125, 20.625, -10.875, -6.125],
          [13.375, 21.375, -20.5, -16.625],
        ],
        [ // 2
          [12.375, 23.25, -4.625, 1.5], [30.5, 38.375, -16.75, -11.625], [17.75, 29.75, -29.875, -26.25],
          [45, 48.75, -18.75, -16.25],
        ],
        [ // 3
          [28.125, 28.125, -26.25, -26.25, 'pretoria'], [36.75, 36.75, -1.25, -1.25, 'nairobi'],
          [18.5, 18.5, -34, -34, 'cape_town'], [15.375, 15.375, -4.375, -4.375, 'kinshasa'],
        ],
        [ // 4
          [17.125, 23.25, -27.125, -22.75], [12, 26.875, -4, 2.625], [48.5, 49.875, -17, -15.25],
          [31.25, 36.75, -15.625, -12.25],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [66, 102, -39.375, -2.625], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [64.5, 125.5, 44, 55.5], [72.875, 105.25, 11.75, 25], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    asia: {
      baseCost: 500000, weight: 12,
      areas: [
        [40, 70, 15, 35], [60, 90, 35, 50], [70, 90, 5, 35],
      ],
      missionWeights: { alien_research: 5, alien_harvest: 5, alien_abduction: 6, alien_infiltration: 10, alien_base: 8 },
      missionZones: [
        [ // 0
          [39.5, 53.125, 16.125, 27.625], [46.75, 65.25, 29.75, 36.75], [69.75, 86.625, 5.25, 24.125],
          [27.875, 49.25, 35.625, 40.375], [67.25, 86, 31.5, 45.875],
        ],
        [ // 1
          [38.25, 47, 35, 38.625], [74.25, 79.75, 15.375, 20.125], [65.5, 70.25, 31.875, 36.375],
          [62.25, 80.625, 46, 49.25],
        ],
        [ // 2
          [33.625, 47, 37.875, 39.5], [79.875, 81.125, 6.875, 8.25], [66.75, 81.5, 43.5, 46.125],
          [77.875, 89.375, 23.375, 27],
        ],
        [ // 3
          [32.75, 32.75, 39.875, 39.875, 'ankara'], [77.25, 77.25, 28.625, 28.625, 'delhi'],
          [67, 67, 24.875, 24.875, 'karachi'], [44.5, 44.5, 33.25, 33.25, 'baghdad'],
          [51.5, 51.5, 35.625, 35.625, 'tehran'], [73.125, 73.125, 18.875, 18.875, 'bombay'],
          [88.375, 88.375, 22.625, 22.625, 'calcutta'],
        ],
        [ // 4
          [42.375, 52.125, 18.375, 23.5], [77.75, 84.875, 32.75, 36], [80.75, 84.875, 20.625, 22.875],
          [80.125, 81.625, 6.75, 7.375],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [66, 102, -39.375, -2.625], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [7.5, 38.625, -18.625, -4.125], [137.125, 169.5, 40.75, 54], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    southeast_asia: {
      baseCost: 750000, weight: 15,
      areas: [
        [90, 105, -10, 50], [105, 150, 5, 50],
      ],
      missionWeights: { alien_research: 8, alien_harvest: 13, alien_abduction: 21, alien_infiltration: 13, alien_base: 8 },
      missionZones: [
        [ // 0
          [90.125, 108.25, 22.625, 36.625], [93.125, 124.75, -6.75, 16.375], [113.75, 143, 20.75, 40],
          [115.125, 148, 39.625, 54.5],
        ],
        [ // 1
          [92.875, 102.5, 31.125, 36.5], [100.625, 106.375, 13.625, 16.75], [113.75, 129.375, 41.375, 46.625],
          [91.625, 104.75, 46.875, 49.5],
        ],
        [ // 2
          [111.125, 117.5, 0.375, 2], [141, 143.75, 42.625, 44.125], [127, 137, 45, 48.5],
          [101.25, 111.875, 37.875, 43.875],
        ],
        [ // 3
          [139.75, 139.75, 35.625, 35.625, 'tokyo'], [116.375, 116.375, 39.875, 39.875, 'beijing'],
          [100.625, 100.625, 13.625, 13.625, 'bangkok'], [121, 121, 14.625, 14.625, 'manila'],
          [127, 127, 37.5, 37.5, 'seoul'], [103.875, 103.875, 1.375, 1.375, 'singapore'],
          [106.75, 106.75, -6.25, -6.25, 'jakarta'], [121.5, 121.5, 31.25, 31.25, 'shanghai'],
          [114.125, 114.125, 22.25, 22.25, 'hong_kong'],
        ],
        [ // 4
          [100.625, 103.125, -0.75, 0.375], [96.125, 104.75, 39, 42.625], [142.125, 143.875, 49.125, 51.25],
          [122.875, 123.625, 7.875, 8.375],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [53.125, 89.125, -41.25, -4.5], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [7.5, 38.625, -18.625, -4.125], [50.5, 82.875, 51.25, 64.5], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    russia: {
      baseCost: 800000, weight: 10,
      areas: [
        [60, 180, 50, 70],
      ],
      missionWeights: { alien_research: 6, alien_abduction: 4, alien_base: 9 },
      missionZones: [
        [ // 0
          [49.875, 80.125, 46.5, 66.75], [67.25, 180, 57.75, 72.5], [-180, -171.25, 57.75, 72.5],
          [86.25, 164.25, 52.875, 61.75], [65, 85.125, 49.25, 52.25],
        ],
        [ // 1
          [63.125, 78.375, 62, 66.5], [157.75, 162.5, 55.625, 57.25], [166.125, 180, 66, 68.625],
          [-180, -178.75, 66, 68.625], [99.625, 139.125, 58.125, 66.125],
        ],
        [ // 2
          [53.25, 66.625, 61, 64.875], [86, 97.75, 68.875, 73.25], [125.875, 141.5, 59.5, 64.25],
          [91.375, 108.875, 57.375, 61.375],
        ],
        [ // 3
          [82.75, 82.75, 55, 55, 'novosibirsk'],
        ],
        [ // 4
          [63.125, 78.375, 62, 66.5], [157.75, 162.5, 55.625, 57.25], [166.125, 180, 66, 68.625],
          [-180, -178.75, 66, 68.625], [99.625, 139.125, 58.125, 66.125],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [53.125, 89.125, -41.25, -4.5], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [7.5, 38.625, -18.625, -4.125], [91.875, 124.25, 17.5, 30.75], [115, 132.5, -25.5, -21],
        ],
      ],
    },
    australasia: {
      baseCost: 750000, weight: 10,
      areas: [
        [105, 180, -60, 5],
      ],
      missionWeights: { alien_research: 15, alien_harvest: 11, alien_abduction: 4, alien_infiltration: 8, alien_base: 16 },
      missionZones: [
        [ // 0
          [129.625, 155.375, -9.75, 1.875], [165.75, 179.5, -47.125, -33.125], [136.125, 153.25, -46, -11.5],
          [109, 134.75, -35.125, -13.375],
        ],
        [ // 1
          [115.75, 123.125, -33.125, -30.375], [129.875, 134.25, -16.5, -14], [141.125, 147, -32.75, -29.875],
          [175, 177, -39.375, -37.875],
        ],
        [ // 2
          [138.125, 144.125, -5, -2.5], [145.625, 147.625, -41.75, -41], [168.5, 170.375, -45.25, -44.25],
          [141.375, 150.125, -36.375, -32.875],
        ],
        [ // 3
          [149.125, 149.125, -35.375, -35.375, 'canberra'], [175.125, 175.125, -41.25, -41.25, 'wellington'],
          [145, 145, -37.875, -37.875, 'melbourne'], [115.75, 115.75, -32, -32, 'perth'],
        ],
        [ // 4
          [122.25, 135.375, -27.5, -21], [149.875, 151.25, -5.5, -4.75], [140.875, 143.625, -8.875, -8.125],
          [145.75, 147.625, -41.625, -41],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [-180, -160, -10, 0], [-77.75, -37.125, -38.375, -9.375],
          [53.125, 89.125, -41.25, -4.5], [-5.5, 33.375, 46.375, 56.625], [-121.375, -101.375, 33.375, 53.375],
          [7.5, 38.625, -18.625, -4.125], [91.875, 124.25, 17.5, 30.75], [62.125, 101.375, 57.125, 66.625],
        ],
      ],
    },
    pacific: {
      baseCost: 600000, weight: 5,
      areas: [
        [-180, -165, 55, 70], [-180, -130, 30, 55], [-180, -120, 10, 30], [-180, -90, 0, 10], [-180, -85, -60, 0],
        [150, 180, 5, 50],
      ],
      missionWeights: { alien_research: 15, alien_base: 27 },
      missionZones: [
        [ // 0
          [-165.5, -134.375, 15.25, 29.25], [172.5, 180, -26.375, -10.875], [-180, -173.125, -26.375, -10.875],
          [158.375, 171.375, -27.75, -12.25], [-157.375, -114.375, -18.375, 2.25],
        ],
        [ // 1
          [-150.875, -150.375, 19.375, 19.875], [-153, -152.875, 21.5, 21.625], [177.75, 178.25, -17.875, -17.5],
          [164.625, 164.75, -20.75, -20.5],
        ],
        [ // 2
          [-150.875, -150.375, 19.375, 19.875], [-153, -152.875, 21.5, 21.625], [177.75, 178.25, -17.875, -17.5],
          [164.625, 164.75, -20.75, -20.5],
        ],
        [ // 3
          [-150.875, -150.375, 19.375, 19.875], [-153, -152.875, 21.5, 21.625],
        ],
        [ // 4
          [-150.875, -150.375, 19.375, 19.875], [-153, -152.875, 21.5, 21.625], [177.75, 178.25, -17.875, -17.5],
          [164.625, 164.75, -20.75, -20.5],
        ],
        [ // 5
          [-180, 180, 80, 90], [-180, 180, -90, -80], [119.625, 139.625, -29.25, -19.25],
          [-77.75, -37.125, -38.375, -9.375], [53.125, 89.125, -41.25, -4.5], [-5.5, 33.375, 46.375, 56.625],
          [-121.375, -101.375, 33.375, 53.375], [7.5, 38.625, -18.625, -4.125], [91.875, 124.25, 17.5, 30.75],
          [62.125, 101.375, 57.125, 66.625],
        ],
      ],
    },
    north_atlantic: {
      baseCost: 500000, weight: 0, missionRegion: 'north_america',
      areas: [
        [-55, -25, 30, 70], [-60, -25, 10, 30], [-45, -25, 0, 10],
      ],
      missionWeights: {},
      missionZones: [],
    },
    south_atlantic: {
      baseCost: 500000, weight: 0, missionRegion: 'antarctica',
      areas: [
        [-30, 5, -15, 0], [-35, 5, -60, -15], [5, 55, -60, -40],
      ],
      missionWeights: {},
      missionZones: [],
    },
    indian_ocean: {
      baseCost: 500000, weight: 0, missionRegion: 'south_africa',
      areas: [
        [55, 70, -10, 15], [70, 90, -10, 5], [55, 105, -60, -10],
      ],
      missionWeights: {},
      missionZones: [],
    },
  };

  // ---- países financiadores (orig countries.rul; §3.17) --------------------------------------------------------
  // fundingBase/fundingCap em milhares de $; region = região da etiqueta (label); áreas para atribuir pontuação.
  const COUNTRIES = {
    usa: {
      region: 'north_america', fundingBase: 600, fundingCap: 10000, label: [-100, 40],
      areas: [
        [-125, -105, 32, 49], [-105, -82.5, 29, 49], [-100, -95, 26, 29], [-83, -80, 25, 32], [-82.5, -74, 32, 44],
        [-74, -67.5, 40, 45.5],
      ],
    },
    russia: {
      region: 'russia', fundingBase: 230, fundingCap: 8000, label: [60, 60],
      areas: [
        [30, 50, 45, 70], [24, 30, 42, 60], [50, 75, 40, 77], [75, 165, 50, 80], [165, 170, 59, 70],
      ],
    },
    uk: {
      region: 'europe', fundingBase: 240, fundingCap: 7000, label: [-2, 53.625],
      areas: [
        [-8, 2, 50, 60],
      ],
    },
    france: {
      region: 'europe', fundingBase: 320, fundingCap: 8000, label: [2.5, 46.5],
      areas: [
        [-5, 7, 43, 50],
      ],
    },
    germany: {
      region: 'europe', fundingBase: 250, fundingCap: 9000, label: [11.5, 50],
      areas: [
        [6, 15, 47.5, 55],
      ],
    },
    italy: {
      region: 'europe', fundingBase: 160, fundingCap: 6000, label: [12.5, 43.875],
      areas: [
        [7, 15, 43, 46.5], [11, 18, 37, 43],
      ],
    },
    spain: {
      region: 'europe', fundingBase: 140, fundingCap: 5000, label: [-2.5, 42.625],
      areas: [
        [-7, 3, 36.5, 43], [-9, -7, 42.25, 43],
      ],
    },
    china: {
      region: 'southeast_asia', fundingBase: 245, fundingCap: 7000, label: [100, 35],
      areas: [
        [75, 98, 30, 50], [98, 122, 22, 50], [122, 133, 40, 54],
      ],
    },
    japan: {
      region: 'southeast_asia', fundingBase: 400, fundingCap: 10000, label: [138, 38.25],
      areas: [
        [130, 143, 30, 40], [138, 147, 40, 46],
      ],
    },
    india: {
      region: 'asia', fundingBase: 150, fundingCap: 5000, label: [80, 24],
      areas: [
        [70, 85, 8, 30], [74, 79, 30, 35], [85, 95, 20, 27],
      ],
    },
    brazil: {
      region: 'south_america', fundingBase: 300, fundingCap: 4000, label: [-55, -5],
      areas: [
        [-70, -58, -17, 2.5], [-58, -50, -22, 2.5], [-50, -35, -24, 0], [-55, -47, -32, -22],
      ],
    },
    australia: {
      region: 'australasia', fundingBase: 280, fundingCap: 5000, label: [135, -25],
      areas: [
        [110, 156, -40, -10],
      ],
    },
    nigeria: {
      region: 'north_africa', fundingBase: 180, fundingCap: 2000, label: [7.5, 10],
      areas: [
        [3, 14, 4, 14],
      ],
    },
    south_africa: {
      region: 'south_africa', fundingBase: 230, fundingCap: 3000, label: [25, -30],
      areas: [
        [15, 25, -35, -26], [25, 32.5, -35, -22],
      ],
    },
    egypt: {
      region: 'north_africa', fundingBase: 230, fundingCap: 2000, label: [29, 26],
      areas: [
        [25, 35, 22, 32],
      ],
    },
    canada: {
      region: 'north_america', fundingBase: 230, fundingCap: 4000, label: [-100, 55],
      areas: [
        [-141, -130, 55, 70], [-130, -55, 40, 75],
      ],
    },
  };

  // ours: Lisboa e Porto como alvos de terror na Europa (sabor local)
  REGIONS.europe.missionZones[3].push([-9.125, -9.125, 38.75, 38.75, 'lisbon'], [-8.625, -8.625, 41.125, 41.125, 'porto']);

  // ---- áreas e pesquisa por coordenadas -------------------------------------------------------------------------
  const D2R = Math.PI / 180;
  const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

  function inArea(a, lon, lat) {
    const okLon = (lon >= a[0] && lon < a[1]) || (lon === 180 && a[1] === 180);
    const okLat = (lat >= a[2] && lat < a[3]) || (lat === 90 && a[3] === 90);
    return okLon && okLat;
  }
  // verdadeiro se (lon, lat) está numa das áreas; lon fora de −180..180 é normalizada
  function inAreas(areas, lon, lat) {
    if (lon < -180 || lon > 180) lon = wrapLon(lon);
    for (let i = 0; i < areas.length; i++) if (inArea(areas[i], lon, lat)) return true;
    return false;
  }
  function firstContaining(table, lon, lat) {
    for (const id in table) if (inAreas(table[id].areas, lon, lat)) return id;
    return null;
  }

  // centróide esférico das áreas (média dos vetores unitários ponderada pela área), arredondado a 0,01°
  function centroidOf(areas) {
    let x = 0, y = 0, z = 0;
    for (const a of areas) {
      const nl = Math.max(1, Math.ceil(a[1] - a[0])), nt = Math.max(1, Math.ceil(a[3] - a[2]));
      const dl = (a[1] - a[0]) / nl, dt = (a[3] - a[2]) / nt;
      for (let i = 0; i < nl; i++) {
        const lo = (a[0] + (i + 0.5) * dl) * D2R;
        for (let j = 0; j < nt; j++) {
          const la = (a[2] + (j + 0.5) * dt) * D2R;
          const w = Math.cos(la) * dl * dt;
          x += w * Math.cos(la) * Math.cos(lo);
          y += w * Math.cos(la) * Math.sin(lo);
          z += w * Math.sin(la);
        }
      }
    }
    const h = Math.hypot(x, y);
    const r2 = (v) => Math.round(v * 100) / 100 + 0;
    return [h < 1e-9 * Math.abs(z) ? 0 : r2(Math.atan2(y, x) / D2R), r2(Math.atan2(z, h) / D2R)];
  }

  // ---- registos: ids, nomes, centróides, cidades --------------------------------------------------------------
  const CITIES = [];
  const CITIES_BY_ID = {};
  for (const id in REGIONS) {
    const r = REGIONS[id];
    r.id = id;
    r.nameKey = 'region.' + id;
    r.ocean = r.missionZones.length === 0; // sem missões próprias: delega em missionRegion
    if (!r.missionRegion) r.missionRegion = null;
    r.centroid = centroidOf(r.areas);
    r.cities = [];
    for (const a of r.missionZones[3] || []) {
      if (typeof a[4] !== 'string') continue;
      const c = { id: a[4], nameKey: 'city.' + a[4], lon: a[0], lat: a[2], region: id };
      CITIES.push(c);
      CITIES_BY_ID[c.id] = c;
      r.cities.push(c.id);
    }
  }
  for (const id in COUNTRIES) {
    const c = COUNTRIES[id];
    c.id = id;
    c.nameKey = 'country.' + id;
  }

  // ---- terreno das missões (§7.3) --------------------------------------------------------------------------------
  // cidade ⇒ URBAN (decidido por quem chama); |lat| > 60 ⇒ POLAR; depois as caixas por ordem DESERT, MOUNTAIN,
  // JUNGLE (as mais específicas primeiro: o Atacama fica deserto dentro dos Andes, os Andes peruanos ficam
  // montanha dentro da Amazónia); senão FARM 55 % / FOREST 45 % pelo hash.
  const TERRAIN_BOXES = {
    DESERT: [
      [-17, 34, 16, 31], // Sara
      [36, 59, 15, 30], // Arábia
      [90, 118, 38, 46], // Gobi
      [76, 90, 36.5, 42], // Taklamakan (com o Gobi)
      [-117, -104, 28, 37], // sudoeste dos EUA e norte do México
      [118, 142, -30, -20], // interior da Austrália
      [-71, -68, -27, -18], // Atacama
    ],
    MOUNTAIN: [
      [-116, -104, 37, 49], // Montanhas Rochosas (EUA)
      [-126, -114, 49, 60], // Montanhas Rochosas (Canadá)
      [-79, -72, -2, 11], // Andes do norte
      [-80, -73, -16, -2], // Andes peruanos
      [-72, -64, -28, -16], // Altiplano
      [-72, -68, -40, -28], // Andes centrais
      [-76, -71, -55, -40], // Andes da Patagónia
      [73, 80, 30.5, 37], // Caraquórum e Caxemira
      [80, 100, 27.5, 36.5], // Himalaias e Tibete
      [5.5, 16.5, 43.75, 48], // Alpes
    ],
    JUNGLE: [
      [-78, -46, -12, 6], // Amazónia
      [8, 31, -7, 5], // Congo
      [92, 110, 5, 22], // Sudeste Asiático continental
      [95, 152, -11, 5], // Indonésia, Malásia e Nova Guiné
      [117, 127, 5, 19], // Filipinas
    ],
  };
  const TERRAIN_RULES = { polarLat: 60, farmPct: 55, order: ['DESERT', 'MOUNTAIN', 'JUNGLE'] };

  // terreno de batalha num ponto; hash opcional (inteiro) escolhe FARM/FOREST, por omissão derivado da posição
  function terrainAt(lon, lat, hash) {
    if (lon < -180 || lon > 180) lon = wrapLon(lon);
    if (Math.abs(lat) > TERRAIN_RULES.polarLat) return 'POLAR';
    for (const t of TERRAIN_RULES.order) if (inAreas(TERRAIN_BOXES[t], lon, lat)) return t;
    const h = hash === undefined || hash === null ? OV.U.hash32(Math.floor(lon * 4), Math.floor(lat * 4), 0x6e0) : hash >>> 0;
    return h % 100 < TERRAIN_RULES.farmPct ? 'FARM' : 'FOREST';
  }

  // ---- trajetórias dos OVNIs (orig ufoTrajectories.rul) ------------------------------------------------------
  // pts = [zona da região 0..5, altitude 0..4 (0 = solo), % da velocidade máxima]; em terra groundTimer × 5 s
  const ALTITUDES = ['ground', 'very_low', 'low', 'high', 'very_high'];
  const TRAJECTORIES = {
    P0: { groundTimer: 3000, pts: [[5, 4, 100], [0, 3, 74], [0, 1, 28], [1, 1, 47], [5, 2, 100]] },
    P1: { groundTimer: 4000, pts: [[5, 4, 100], [0, 2, 76], [0, 2, 20], [1, 1, 44], [0, 0, 20], [0, 2, 32], [2, 1, 65], [5, 0, 100]] },
    P2: { groundTimer: 5000, pts: [[5, 4, 100], [0, 3, 57], [0, 2, 26], [1, 1, 50], [5, 0, 100]] },
    P3: { groundTimer: 6000, pts: [[5, 4, 100], [0, 3, 30], [0, 2, 25], [2, 1, 20], [5, 0, 100]] },
    P4: { groundTimer: 7000, pts: [[5, 4, 100], [0, 2, 67], [0, 2, 52], [2, 1, 40], [0, 0, 30], [0, 2, 20], [2, 1, 30], [5, 0, 100]] },
    P5: { groundTimer: 4000, pts: [[5, 4, 100], [0, 2, 50], [0, 2, 20], [4, 1, 15], [0, 0, 20], [0, 2, 29], [4, 1, 42], [5, 0, 90]] },
    P6: { groundTimer: 5000, pts: [[5, 4, 100], [0, 3, 50], [0, 2, 25], [4, 1, 16], [5, 0, 100]] },
    P7: { groundTimer: 9000, pts: [[5, 4, 100], [0, 3, 60], [0, 2, 30], [3, 1, 20], [5, 0, 100]] },
    P8: { groundTimer: 6000, pts: [[5, 4, 100], [1, 1, 60], [2, 1, 20], [3, 1, 30], [4, 1, 20], [0, 1, 42], [2, 1, 56], [5, 4, 100]] },
    P9: { groundTimer: 2000, pts: [[5, 4, 80], [5, 0, 100]] },
    // orig __RETALIATION_ASSAULT_RUN: voo final do Couraçado contra a base X-COM (só conta a altitude 0)
    assault: { groundTimer: 1000, pts: [[5, 4, 100], [5, 0, 100]] },
  };
  for (const id in TRAJECTORIES) {
    const t = TRAJECTORIES[id];
    t.id = id;
    t.groundS = t.groundTimer * 5;
  }

  // ---- missões alienígenas (orig alienMissions.rul; temporizadores ours) -------------------------------------
  // timer = minutos antes de cada vaga (ours = orig × 0,5 arredondado a 30 min; timerOrig guardado); a contagem
  // real é (⌊t/30/2⌋ + RNG(0, ⌊t/30⌋)) × 30 (orig, missionRules.countdown).
  // objective: 'score' — cada OVNI que descola depois de aterrar dá points à região/país (orig ufoLifting);
  //   'infiltration' — após a última vaga um país da região assina o pacto e surge uma base alienígena na zona 4;
  //     a missão recomeça (orig); 'base' — após a última vaga surge a base alienígena na zona 4 (+points);
  //   'site' — o OVNI da vaga objective, ao chegar à zona spawnZone (cidade), cria o local siteType e desaparece;
  //   'retaliation' — os OVNIs procuram a base X-COM; descoberta, spawnUfo voa a trajetória assaultTraj contra ela;
  //   'supply' — a Nave de Abastecimento aterra na base alienígena (raça da base).
  // table = aparece nas tabelas de missões das regiões; raceFrom 'trigger' = raça do OVNI que a provocou,
  // 'base' = raça da base alienígena.
  const WAVE_TIMER_SCALE = 0.7; // ours (era 0,5: tráfego a mais para 12–16 batalhas; a abertura e o terror têm tempos fixos)
  function wave(ufo, n, traj, timerOrig, opts) {
    const o = opts || {};
    const timer = o.timer !== undefined ? o.timer : Math.max(30, Math.round((timerOrig * WAVE_TIMER_SCALE) / 30) * 30);
    return { ufo, n, traj, timer, timerOrig, objective: !!o.objective };
  }
  const MISSIONS = {
    alien_research: {
      points: 0, objective: 'score', table: true,
      // abertura (guião gameStart): tempos fixos de 0,5 × orig — o primeiro Batedor Médio chega nos primeiros dias
      waves: [wave('small_scout', 1, 'P0', 9000, { timer: 4500 }), wave('medium_scout', 1, 'P2', 7800, { timer: 3900 }), wave('large_scout', 2, 'P4', 9000, { timer: 4500 })],
    },
    alien_harvest: {
      points: 30, objective: 'score', table: true,
      waves: [
        wave('small_scout', 1, 'P0', 7800), wave('small_scout', 1, 'P2', 7800), wave('medium_scout', 1, 'P2', 6000),
        wave('large_scout', 1, 'P0', 7800), wave('large_scout', 1, 'P3', 9000), wave('harvester', 1, 'P4', 3000),
        wave('harvester', 1, 'P4', 750), wave('battleship', 1, 'P2', 1500),
      ],
    },
    alien_abduction: {
      points: 50, objective: 'score', table: true,
      waves: [
        wave('small_scout', 1, 'P0', 15000), wave('medium_scout', 1, 'P1', 18000), wave('large_scout', 1, 'P3', 9000),
        wave('abductor', 1, 'P3', 9000), wave('abductor', 2, 'P4', 60),
      ],
    },
    alien_infiltration: {
      points: 150, objective: 'infiltration', siteType: 'dep_alien_base', spawnZone: 4, table: true,
      waves: [
        wave('small_scout', 1, 'P0', 16500), wave('medium_scout', 1, 'P1', 15000), wave('medium_scout', 1, 'P6', 13800),
        wave('large_scout', 1, 'P7', 9000), wave('large_scout', 1, 'P7', 60), wave('terror_ship', 1, 'P7', 60),
        wave('supply_ship', 1, 'P7', 60), wave('battleship', 2, 'P7', 60),
      ],
    },
    alien_base: {
      points: 50, objective: 'base', siteType: 'dep_alien_base', spawnZone: 4, table: true,
      waves: [
        wave('small_scout', 1, 'P1', 13500), wave('medium_scout', 1, 'P5', 15000), wave('large_scout', 1, 'P5', 60),
        wave('supply_ship', 2, 'P5', 60), wave('battleship', 1, 'P6', 60),
      ],
    },
    // ours: menos vagas (orig MS P1 15000, LS P1 9600, TS P0 12000, TS P7 9000 objetivo)
    alien_terror: {
      points: 10, objective: 'site', siteType: 'dep_terror_site', spawnZone: 3, cityOnly: true,
      waves: [wave('medium_scout', 1, 'P1', 15000, { timer: 6000 }), wave('terror_ship', 1, 'P7', 9000, { timer: 4500, objective: true })],
    },
    alien_retaliation: {
      points: 0, objective: 'retaliation', spawnUfo: 'battleship', assaultTraj: 'assault', raceFrom: 'trigger',
      waves: [
        wave('small_scout', 1, 'P8', 3000), wave('medium_scout', 2, 'P8', 3000), wave('large_scout', 3, 'P8', 3000),
        wave('battleship', 2, 'P8', 3000),
      ],
    },
    alien_supply: {
      points: 0, objective: 'supply', raceFrom: 'base',
      waves: [wave('supply_ship', 1, 'P9', 6000, { objective: true })],
    },
  };
  for (const id in MISSIONS) {
    const m = MISSIONS[id];
    m.id = id;
    m.nameKey = 'mission.' + id;
    m.table = !!m.table;
    m.cityOnly = !!m.cityOnly;
    if (m.siteType === undefined) m.siteType = null;
    if (m.spawnZone === undefined) m.spawnZone = null;
    if (m.spawnUfo === undefined) m.spawnUfo = null;
    if (m.assaultTraj === undefined) m.assaultTraj = null;
    if (m.raceFrom === undefined) m.raceFrom = null;
  }

  // ---- guião mensal (ours, comprimido; §3.18) -----------------------------------------------------------------
  // Corre por ordem no início de cada mês (mês 0 = novo jogo). Campos (semântica de missionScripts.rul):
  //   missionWeights {missão: peso} ou null ⇒ missão da tabela (região por peso × proximidade, tipo pela tabela
  //   da região, removido até a tabela esvaziar); count = nº de missões; target: 'table' | 'baseRegion' (região
  //   da base X-COM, ou a sua missionRegion se for oceânica) | 'city' (região uniforme entre as que têm cidades
  //   e não correm já esta missão, depois cidade uniforme) | 'nearBase' (região não oceânica com centróide a
  //   ≤ maxBaseDistNm da base, por peso; senão a mais próxima); startDelay em minutos (0 = temporizador da
  //   1.ª vaga); races substitui a tabela de raças; useTable remove a missão da tabela da região escolhida;
  //   firstMonthByDifficulty [Recruta, Veterano, Super-humano]; researchTriggers {tópico: tem/não tem};
  //   label/conditionals como nos mapscripts (−n = só se o rótulo n não correu este mês); immediate = corre
  //   também no momento em que o gatilho de investigação se cumpre (ours).
  const SCRIPTS = [
    {
      id: 'gameStart', lastMonth: 0, missionWeights: { alien_research: 100 }, target: 'baseRegion', races: { sectoid: 100 },
      startDelay: 120, useTable: false,
    },
    {
      id: 'firstTerror', lastMonth: 0, missionWeights: { alien_terror: 100 }, target: 'city',
      startDelay: 3 * 24 * 60, useTable: false, // ours: o primeiro terror só 3 dias depois do arranque
    },
    {
      id: 'recurringTerror', firstMonth: 1, missionWeights: { alien_terror: 100 }, target: 'city',
      startDelay: 150, useTable: false,
    },
    {
      id: 'seedAlienBase', firstMonth: 1, lastMonth: 1, missionWeights: { alien_base: 100 }, target: 'nearBase',
      maxBaseDistNm: 4000, // ours: garante uma base alienígena perto da base X-COM no mês 1–2
    },
    { id: 'recon', firstMonth: 1 },
    { id: 'invasion', firstMonth: 2 },
    { id: 'escalation', firstMonth: 3 },
    {
      id: 'researchRetaliation', missionWeights: { alien_retaliation: 100 }, researchTriggers: { martian_solution: true },
      target: 'baseRegion', startDelay: 150, useTable: false, label: 1, immediate: true,
    },
    {
      id: 'scheduledRetaliation', firstMonthByDifficulty: [3, 3, 2], missionWeights: { alien_retaliation: 100 },
      target: 'baseRegion', startDelay: 150, useTable: false, conditionals: [-1],
    },
  ];
  const SCRIPT_DEFAULTS = {
    firstMonth: 0, lastMonth: -1, firstMonthByDifficulty: null, minDifficulty: 0, missionWeights: null, count: 1,
    target: null, races: null, startDelay: 0, useTable: true, researchTriggers: {}, conditionals: [], label: 0,
    immediate: false, maxBaseDistNm: null, executionOdds: 100,
  };
  for (const s of SCRIPTS) {
    for (const k in SCRIPT_DEFAULTS) if (s[k] === undefined) s[k] = OV.U.clone(SCRIPT_DEFAULTS[k]);
    if (!s.target) s.target = s.missionWeights ? 'any' : 'table';
  }

  const hasTopic = (researched, id) => {
    if (!researched) return false;
    if (Array.isArray(researched)) return researched.indexOf(id) >= 0;
    if (typeof researched.has === 'function') return researched.has(id);
    return !!researched[id];
  };
  // comandos do guião que se aplicam a um mês (filtro estático: meses, dificuldade 0..2, gatilhos de investigação,
  // condicionais); researched = array, Set ou objeto de tópicos concluídos
  function scriptsForMonth(month, difficulty, researched) {
    const diff = OV.U.clamp(difficulty | 0, 0, 2);
    const ran = new Set();
    const out = [];
    for (const s of SCRIPTS) {
      const first = s.firstMonthByDifficulty ? s.firstMonthByDifficulty[diff] : s.firstMonth;
      if (month < first || (s.lastMonth >= 0 && month > s.lastMonth) || diff < s.minDifficulty) continue;
      let ok = true;
      for (const k in s.researchTriggers) if (hasTopic(researched, k) !== s.researchTriggers[k]) ok = false;
      for (const c of s.conditionals) if (c < 0 ? ran.has(-c) : !ran.has(c)) ok = false;
      if (!ok) continue;
      out.push(s);
      if (s.label) ran.add(s.label);
    }
    return out;
  }

  // ---- raças por mês (ours; §3.18) -----------------------------------------------------------------------------
  // por tabela: {mês inicial: {raça: peso}}; vale a entrada com o maior mês ≤ mês atual. 'default' serve todas as
  // missões sem tabela própria; alien_terror tem a sua (Homens-Serpente ⇒ Crisálidas a partir do mês 1).
  const RACE_SCHEDULE = {
    default: {
      0: { sectoid: 60, floater: 40 },
      1: { sectoid: 30, floater: 30, snakeman: 20, muton: 20 },
      2: { sectoid: 30, floater: 30, snakeman: 20, muton: 20, ethereal: 20 },
      3: { muton: 30, ethereal: 30, snakeman: 20, floater: 10, sectoid: 10 },
    },
    // ours (varrimentos de batalha, 10 soldados, Veterano): Flutuantes nos meses 0–1 (espingardas, também de noite);
    // Ciberdiscos (Sectoides) só com lasers, Crisálidas (Homens-Serpente) só com plasma; Etéreos fora do terror
    alien_terror: {
      0: { floater: 100 },
      2: { floater: 40, sectoid: 40, muton: 20 },
      3: { sectoid: 25, muton: 30, snakeman: 25, floater: 20 },
    },
  };
  // pesos {raça: peso} para uma missão num mês (cópia; retaliação/abastecimento usam a raça de origem quando há)
  function raceWeights(missionId, month) {
    const table = RACE_SCHEDULE[missionId] || RACE_SCHEDULE.default;
    let best = -1;
    for (const k in table) if (+k <= month && +k > best) best = +k;
    return Object.assign({}, table[best < 0 ? 0 : best]);
  }

  // ---- regras das missões (orig salvo indicação) --------------------------------------------------------------
  const MISSION_RULES = {
    waveTimerScale: WAVE_TIMER_SCALE, // ours
    countdownStepMin: 30, // as missões pensam a cada 30 min
    shootDownDelay: { base: 48, rand: 200, stepMin: 30 }, // ours: 30 × (RNG(0,200) + 48) min (orig RNG(0,400))
    nearBaseNm: 4000, // ours: regiões com centróide a ≤ 4 000 mn da base X-COM…
    nearBaseWeightMul: 3, // …pesam ×3 na escolha da região
    terrorNearBaseWeightMul: 4, // ours: o terror escolhe regiões com centróide a ≤ nearBaseNm de uma base X-COM ×4 (uma só base no MVP)
    shootDownRetaliationFromMonth: 2, // ours: a partir do mês 2 cada abate pode provocar retaliação
    retaliationPct: TUNE.RETALIATION_PCT || [4, 12, 20],
    landPointTries: 10, // pontos de aterragem: 10 tentativas em terra, senão descola logo (orig)
    crashCoastNm: 180, // ours: OVNI abatido no mar a ≤ 180 mn da costa cai em terra (orig: afunda sempre ⇒ destruído)
    terrorSiteHours: TUNE.TERROR_SITE_HOURS || [8, 16], // ours (orig 4–10)
    alienBaseRevealMonthlyPct: 50, // ours (orig 20): agentes revelam a base no fim do mês
    patrolReveal: { pct: 50, rangeNm: 1696, everyMin: 10 }, // nave em patrulha: 50 − 50·d/1696 % a cada 10 min
    supplyLandingRevealsBase: true,
    // minutos até à próxima vaga a partir do timer (orig AlienMission::think)
    countdown(timerMin, rng) {
      const steps = Math.floor(timerMin / 30);
      return (Math.floor(steps / 2) + rng.int(0, steps)) * 30;
    },
    // atraso extra da próxima vaga quando um OVNI da missão é abatido
    shootDownDelayMin(rng) {
      const d = MISSION_RULES.shootDownDelay;
      return d.stepMin * (rng.int(0, d.rand) + d.base);
    },
  };

  // ---- constantes do globo (§12) --------------------------------------------------------------------------------
  const NM_PER_DEG = 60; // 1 milha náutica = 1 minuto de arco
  const radar = (nm) => ({ nm, deg: nm / NM_PER_DEG });
  const GEO_CONST = {
    nmPerDeg: NM_PER_DEG,
    earthRadiusNm: (180 * NM_PER_DEG) / Math.PI,
    radar: {
      small_radar: radar(1695),
      large_radar: radar(2577),
      hyper_wave_decoder: radar(2759),
      craft: radar(TUNE.CRAFT_RADAR_NM || 672),
    },
    sun: {
      // longitude subsolar = (12 − hora UTC) × 15°; declinação 0 (globeSeasons do OpenXcom desligado por omissão)
      subsolarLonAtNoon: 0, degPerHour: 15, seasons: false, declinationMaxDeg: 23.44, declinationDayOffset: 10,
      nightRadiusDeg: 90, // noite = círculo de 90° em torno do ponto antissolar
      twilightDeg: [84, 96], twilightAlpha: 0.2,
      nightColour: 0x000028, nightAlpha: 0.55,
      dayElevDeg: 0, duskElevDeg: -6, // elevação do sol no local da missão: > 0 dia, −6..0 crepúsculo, < −6 noite
    },
    zoomRadii: [0.45, 0.6, 0.9, 1.4, 2.25, 3.6], // × altura da área do globo (orig)
    dogfightZoom: 3,
    zoomSmoothSteps: 10,
    latClampDeg: 89,
    cityMinZoom: 3, // cidades visíveis a partir deste nível de zoom
    entryRingDeg: [25, 35], // ours: zona 5 = ponto a 25–35° do centróide da região
    terrain: TERRAIN_RULES,
  };

  // ---- pontuação (§3.17) -------------------------------------------------------------------------------------
  const missionPoints = {};
  for (const id in MISSIONS) missionPoints[id] = MISSIONS[id].points;
  const SCORING = {
    // aliens: cada OVNI ganha pontos para a região e o país onde está, a cada 30 min (em terra conta a dobrar)
    ufoActivity: { flying: 1, landed: 2, everyMin: 120 }, // ours: a cada 2 h (orig 30 min) — uma só base no MVP não cobre o globo
    missionPoints, // ver objective em alienMissions (infiltração: pacto contado no fim do mês)
    alienBasePerDay: 5,
    terrorSiteExpired: 1000, // local de terror que expira sem ataque
    // X-COM
    alienBaseDestroyed: 500,
    councilBonus: TUNE.COUNCIL_BONUS || 400,
    councilBonusFromMonth: TUNE.COUNCIL_BONUS_FROM_MONTH || 2,
    // avaliação mensal: T = limiar por dificuldade; ≤ T−300 Terrível, > T−300 Fraco, > T Razoável, > 0 Bom, > 500 Excelente
    rating: { thresholds: TUNE.RATING_THRESHOLD || [-900, -700, -500], terribleMargin: 300, goodAbove: 0, excellentAbove: 500 },
  };
  // chave i18n da avaliação mensal
  function ratingKey(rating, difficulty) {
    const R = SCORING.rating;
    const T = R.thresholds[OV.U.clamp(difficulty | 0, 0, 2)];
    if (rating > R.excellentAbove) return 'rating.excellent';
    if (rating > R.goodAbove) return 'rating.good';
    if (rating > T) return 'rating.ok';
    if (rating > T - R.terribleMargin) return 'rating.poor';
    return 'rating.terrible';
  }

  // ---- validação cruzada ----------------------------------------------------------------------------------
  OV.Data.onFinalize('geo.validate', (D) => {
    const err = [];
    const ufoOk = (id) => UFO_IDS.indexOf(id) >= 0 && (!D.ufos || !!D.ufos[id]);
    for (const id in REGIONS) {
      const r = REGIONS[id];
      if (r.missionRegion && !REGIONS[r.missionRegion]) err.push('região ' + id + ': missionRegion ' + r.missionRegion);
      if (r.ocean && !r.missionRegion) err.push('região oceânica ' + id + ' sem missionRegion');
      if (!r.ocean && r.missionZones.length !== 6) err.push('região ' + id + ': precisa de 6 zonas');
      for (const m in r.missionWeights) if (!MISSIONS[m] || !MISSIONS[m].table) err.push('região ' + id + ': missão ' + m);
    }
    for (const id in COUNTRIES) {
      const c = COUNTRIES[id];
      if (!REGIONS[c.region]) err.push('país ' + id + ': região ' + c.region);
      if (!inAreas(c.areas, c.label[0], c.label[1])) err.push('país ' + id + ': etiqueta fora das áreas');
    }
    for (const id in MISSIONS) {
      const m = MISSIONS[id];
      for (const w of m.waves) {
        if (!ufoOk(w.ufo)) err.push('missão ' + id + ': OVNI ' + w.ufo);
        if (!TRAJECTORIES[w.traj]) err.push('missão ' + id + ': trajetória ' + w.traj);
      }
      if (m.spawnUfo && !ufoOk(m.spawnUfo)) err.push('missão ' + id + ': spawnUfo ' + m.spawnUfo);
      if (m.assaultTraj && !TRAJECTORIES[m.assaultTraj]) err.push('missão ' + id + ': assaultTraj ' + m.assaultTraj);
      if (m.siteType && D.deployments && !D.deployments[m.siteType]) err.push('missão ' + id + ': siteType ' + m.siteType);
    }
    for (const s of SCRIPTS) {
      for (const m in s.missionWeights || {}) if (!MISSIONS[m]) err.push('guião ' + s.id + ': missão ' + m);
      for (const r in s.races || {}) if (RACE_IDS.indexOf(r) < 0) err.push('guião ' + s.id + ': raça ' + r);
      for (const k in s.researchTriggers) if (D.research && !D.research[k]) err.push('guião ' + s.id + ': investigação ' + k);
    }
    for (const t in RACE_SCHEDULE) {
      if (t !== 'default' && !MISSIONS[t]) err.push('raças: missão ' + t);
      for (const mo in RACE_SCHEDULE[t]) {
        for (const r in RACE_SCHEDULE[t][mo]) {
          if (RACE_IDS.indexOf(r) < 0 || (D.races && !D.races[r])) err.push('raças: ' + r);
        }
      }
    }
    if (Object.keys(CITIES_BY_ID).length !== CITIES.length) err.push('cidades com ids repetidos');
    for (const t in TERRAIN_BOXES) if (TERRAIN_IDS.indexOf(t) < 0) err.push('terreno ' + t);
    if (err.length) throw new Error(err.join('; '));
  }, 90);

  // regras do Geoscape imutáveis a partir daqui
  OV.Data.onFinalize('geo.freeze', (D) => {
    const keys = ['regions', 'countries', 'cities', 'citiesById', 'terrainBoxes', 'trajectories', 'altitudes', 'alienMissions',
      'missionScripts', 'raceSchedule', 'missionRules', 'geoConst', 'scoring'];
    for (const k of keys) OV.U.deepFreeze(D[k]);
  }, 99);

  // regionAt/countryAt usam os retângulos orig (pontuação e financiamento, como no jogo original);
  // OV.Data.world.countryAt usa os contornos reais (apresentação)
  Object.assign(OV.Data, {
    regions: REGIONS,
    countries: COUNTRIES,
    cities: CITIES,
    citiesById: CITIES_BY_ID,
    terrainBoxes: TERRAIN_BOXES,
    terrainAt,
    trajectories: TRAJECTORIES,
    altitudes: ALTITUDES,
    alienMissions: MISSIONS,
    missionScripts: SCRIPTS,
    scriptsForMonth,
    raceSchedule: RACE_SCHEDULE,
    raceWeights,
    missionRules: MISSION_RULES,
    geoConst: GEO_CONST,
    scoring: SCORING,
    ratingKey,
    inAreas,
    regionAt: (lon, lat) => firstContaining(REGIONS, lon, lat),
    countryAt: (lon, lat) => firstContaining(COUNTRIES, lon, lat),
  });
})(globalThis.OV || (globalThis.OV = {}));
