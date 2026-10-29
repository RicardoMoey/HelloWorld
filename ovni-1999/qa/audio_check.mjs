/* Verificação do motor de áudio num Chromium real (Playwright), sem servidor:
   injeta js/audio/audio.js numa página em branco, toca todos os efeitos, ambientes e stingers,
   e falha em erros de página/consola, efeitos mudos, nomes em falta ou guardas desrespeitadas.
   Uso: node ovni-1999/qa/audio_check.mjs [--table]   (--table lista o pico de cada efeito) */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'js', 'audio', 'audio.js');

const EXPECTED = [
  'ui_click', 'ui_confirm', 'ui_deny', 'ui_select', 'step_earth', 'step_wood', 'step_metal', 'step_alloy',
  'door_open', 'ufo_door', 'kneel', 'pistol', 'rifle', 'rifle_auto', 'heavy_cannon', 'auto_cannon',
  'rocket_launch', 'laser', 'plasma', 'stun_rod', 'grenade_pin', 'throw', 'bounce', 'explosion_small',
  'explosion_large', 'fire_loop_tick', 'glass_break', 'wall_crumble', 'alien_death_sectoid',
  'alien_death_floater', 'alien_death_snakeman', 'alien_death_muton', 'alien_death_ethereal',
  'alien_death_chryssalid', 'alien_death_mech', 'soldier_hit', 'soldier_death', 'alien_spotted',
  'reaction_alert', 'medikit', 'psi', 'chryssalid_skitter', 'ufo_detected', 'radar_ping', 'research_done',
  'production_done', 'dogfight_cannon', 'dogfight_missile', 'dogfight_hit', 'ufo_crash', 'monthly_report',
  'end_turn', 'hidden_movement',
];
const MOODS = ['geoscape', 'battle', 'battle_tense', 'terror', 'menu'];
const STINGERS = ['victory', 'defeat', 'research', 'monthly'];

const pageErrors = [];
const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
  await page.goto('about:blank');
  await page.evaluate(() => { window.OV = {}; });
  await page.addScriptTag({ path: AUDIO });

  // utilitários dentro da página
  await page.evaluate(() => {
    const A = window.OV.audio;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__qa = {
      sleep,
      async peak(ms) {
        let p = 0;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          p = Math.max(p, A.level());
          await sleep(12);
        }
        return p;
      },
      // silêncio contínuo durante 150 ms (há efeitos com pausas internas, ex.: ufo_crash)
      async quiet(maxMs) {
        const end = performance.now() + maxMs;
        let since = 0;
        while (performance.now() < end) {
          const now = performance.now();
          if (A.level() < 0.002) {
            if (!since) since = now;
            if (now - since >= 150) return true;
          } else since = 0;
          await sleep(15);
        }
        return false;
      },
    };
  });

  // API e comportamento antes do primeiro gesto
  const pre = await page.evaluate(() => {
    const A = window.OV.audio;
    const api = ['init', 'configure', 'play', 'music', 'stinger', 'setMuted', 'speak', 'names', 'stop', 'setVolumes', 'spatial', 'level', 'status']
      .filter((k) => typeof A[k] !== 'function');
    return { api, playBefore: A.play('ui_click'), musicBefore: A.music('menu'), state: A.status().state };
  });
  check(pre.api.length === 0, 'API em falta: ' + pre.api.join(', '));
  check(pre.playBefore === false, 'play() antes de init() devia ser ignorado');
  check(pre.musicBefore === true, 'music() antes de init() devia ficar pendente');
  check(pre.state === 'none', 'contexto criado antes de init()');

  const boot = await page.evaluate(async () => {
    const A = window.OV.audio;
    A.configure({ sound: true, music: true, voice: false, volMaster: 0.8, volSfx: 0.9, volMusic: 0.5 });
    const first = A.init();
    const second = A.init();
    for (let i = 0; i < 50 && A.status().state !== 'running'; i++) await window.__qa.sleep(20);
    await window.__qa.sleep(300);
    const st = A.status();
    const lvl = await window.__qa.peak(500);
    return { first, second, st, lvl, names: A.names() };
  });
  check(boot.first && boot.second, 'init() falhou ou não é idempotente');
  check(boot.st.state === 'running', 'AudioContext não está a correr: ' + boot.st.state);
  check(boot.st.mood === 'menu' && boot.st.scheduler, 'ambiente pendente não arrancou com init(): ' + JSON.stringify(boot.st));
  check(boot.lvl > 1e-5, 'música do menu muda (pico ' + boot.lvl + ')');
  const missing = EXPECTED.filter((n) => !boot.names.includes(n));
  const extra = boot.names.filter((n) => !EXPECTED.includes(n));
  check(missing.length === 0, 'efeitos em falta: ' + missing.join(', '));
  check(extra.length === 0, 'efeitos não especificados: ' + extra.join(', '));

  // cada efeito isolado: aceite e audível
  await page.evaluate(() => window.OV.audio.music(null));
  await page.evaluate(() => window.__qa.quiet(3000));
  const sfx = await page.evaluate(async (names) => {
    const A = window.OV.audio;
    const out = [];
    for (const n of names) {
      await window.__qa.quiet(2600);
      const ok = A.play(n, { pan: (Math.random() * 2 - 1) * 0.6, vol: 1 });
      const p = await window.__qa.peak(700);
      out.push({ n, ok, p });
    }
    return out;
  }, boot.names);
  for (const r of sfx) {
    check(r.ok, 'play(' + r.n + ') recusado');
    check(r.p > 1e-4, 'efeito mudo: ' + r.n + ' (pico ' + r.p.toExponential(2) + ')');
  }
  const loudest = sfx.reduce((a, b) => (b.p > a.p ? b : a), sfx[0]);
  console.log('efeitos: ' + sfx.length + ' tocados; mais forte ' + loudest.n + ' ' + loudest.p.toFixed(3) +
    '; mais fraco ' + sfx.reduce((a, b) => (b.p < a.p ? b : a), sfx[0]).n);
  if (process.argv.includes('--table')) for (const r of sfx) console.log('  ' + r.n.padEnd(24) + r.p.toFixed(4));
  check(loudest.p <= 1.0, 'saturação: ' + loudest.n + ' pico ' + loudest.p);

  // guardas: MIN_GAP, limite de vozes, nomes desconhecidos, opções
  const guards = await page.evaluate(async (names) => {
    const A = window.OV.audio;
    await window.__qa.quiet(2500);
    await window.__qa.sleep(1500); // deixar libertar as vozes anteriores
    const g1 = A.play('ui_click');
    const g2 = A.play('ui_click');
    let accepted = 0;
    for (const n of names) if (A.play(n, { rate: 1.1, vol: 0.5, pan: -1, delay: 0.01 })) accepted++;
    const voices = A.status().voices;
    const unknown = [A.play('nao_existe'), A.music('nao_existe'), A.stinger('nao_existe')];
    const quietVol = A.play('ui_select', { vol: 0 });
    const sp = A.spatial(2000, 300, 800, 600);
    await window.__qa.sleep(3500);
    return { g1, g2, accepted, voices, unknown, quietVol, sp, after: A.status().voices };
  }, boot.names);
  check(guards.g1 === true && guards.g2 === false, 'MIN_GAP não respeitado (ui_click duplo)');
  check(guards.voices <= 24 && guards.accepted <= 24, 'limite de 24 vozes excedido: ' + guards.voices + '/' + guards.accepted);
  check(guards.accepted >= 20, 'rajada recusou demasiado: ' + guards.accepted);
  check(guards.unknown.every((v) => v === false), 'nomes desconhecidos deviam devolver false');
  check(guards.quietVol === false, 'vol 0 devia ser ignorado');
  check(guards.sp.pan > 0 && guards.sp.vol < 1 && guards.sp.vol > 0, 'spatial() incoerente: ' + JSON.stringify(guards.sp));
  check(guards.after === 0, 'vozes não libertadas: ' + guards.after);

  // ambientes: 0,3 s cada, com transição cruzada; battle → battle_tense reaproveita a instância
  const moods = await page.evaluate(async (list) => {
    const A = window.OV.audio;
    const out = [];
    for (const m of list) {
      const ok = A.music(m);
      const p = await window.__qa.peak(300);
      const st = A.status();
      out.push({ m, ok, p, st });
    }
    A.music('battle');
    await window.__qa.sleep(200);
    const s1 = A.status().moodSerial;
    A.music('battle_tense');
    await window.__qa.sleep(400);
    const st2 = A.status();
    A.music('battle');
    await window.__qa.sleep(100);
    const st3 = A.status();
    return { out, s1, st2, st3 };
  }, MOODS);
  for (const r of moods.out) {
    check(r.ok && r.st.mood === r.m, 'music(' + r.m + ') não ficou ativo: ' + JSON.stringify(r.st));
    check(r.p > 1e-5, 'ambiente mudo: ' + r.m);
  }
  check(moods.s1 && moods.st2.moodSerial === moods.s1 && moods.st2.tense === true, 'battle_tense devia acrescentar a camada sem reiniciar: ' + JSON.stringify(moods.st2));
  check(moods.st3.tense === false && moods.st3.moodSerial === moods.s1, 'voltar a battle devia retirar a camada');

  // stingers sobre a música (com «ducking»)
  const st = await page.evaluate(async (list) => {
    const A = window.OV.audio;
    const out = [];
    for (const s of list) {
      const ok = A.stinger(s);
      const p = await window.__qa.peak(300);
      out.push({ s, ok, p });
      await window.__qa.sleep(200);
    }
    return out;
  }, STINGERS);
  for (const r of st) check(r.ok && r.p > 1e-4, 'stinger(' + r.s + ') falhou (ok=' + r.ok + ', pico ' + r.p + ')');

  // silêncio: setMuted, separador escondido, música desligada, voz
  const mute = await page.evaluate(async () => {
    const A = window.OV.audio;
    A.music('terror');
    await window.__qa.sleep(500);
    A.setMuted(true);
    await window.__qa.sleep(300);
    const mutedLvl = await window.__qa.peak(200);
    const playMuted = A.play('rifle');
    A.setMuted(false);
    await window.__qa.sleep(200);
    const back = await window.__qa.peak(400);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await window.__qa.sleep(250);
    const hiddenSt = A.status();
    const playHidden = A.play('laser');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 50 && A.status().state !== 'running'; i++) await window.__qa.sleep(20);
    const visibleSt = A.status();
    await window.__qa.sleep(100);
    const playVisible = A.play('laser');

    A.configure({ music: false });
    const stingOff = A.stinger('victory');
    await window.__qa.sleep(1200);
    const musicOffLvl = await window.__qa.peak(300);
    A.configure({ music: true, volMusic: 0.6 });
    A.setVolumes({ master: 0.7, sfx: 0.8 });

    const speakOff = A.speak('Alienígenas avistados');
    A.configure({ voice: true });
    let speakErr = null;
    try { A.speak('Alienígenas avistados'); } catch (e) { speakErr = String(e); }
    A.configure({ voice: false });
    return { mutedLvl, playMuted, back, hiddenSt, playHidden, visibleSt, playVisible, stingOff, musicOffLvl, speakOff, speakErr };
  });
  check(mute.mutedLvl < 1e-3, 'setMuted(true) não silenciou (pico ' + mute.mutedLvl + ')');
  check(mute.playMuted === false, 'play() com som silenciado devia ser ignorado');
  check(mute.back > 1e-5, 'setMuted(false) não repôs o som');
  check(mute.hiddenSt.hidden && mute.hiddenSt.state === 'suspended', 'separador escondido devia suspender: ' + JSON.stringify(mute.hiddenSt));
  check(mute.playHidden === false, 'play() com separador escondido devia ser ignorado');
  check(!mute.visibleSt.hidden && mute.visibleSt.state === 'running', 'ao voltar ao separador o contexto devia retomar: ' + JSON.stringify(mute.visibleSt));
  check(mute.playVisible === true, 'play() depois de retomar devia tocar');
  check(mute.stingOff === false, 'stinger com música desligada devia ser ignorado');
  check(mute.musicOffLvl < 1e-3, 'música desligada continua audível (pico ' + mute.musicOffLvl + ')');
  check(mute.speakOff === false, 'speak() com voz desligada devia ser ignorado');
  check(mute.speakErr === null, 'speak() lançou exceção: ' + mute.speakErr);

  // fim da música: instâncias e agendador libertados
  const end = await page.evaluate(async () => {
    const A = window.OV.audio;
    A.music(null);
    await window.__qa.sleep(2300);
    const s1 = A.status();
    A.music('geoscape');
    await window.__qa.sleep(200);
    A.stop();
    await window.__qa.sleep(800);
    return { s1, s2: A.status() };
  });
  check(end.s1.insts === 0 && !end.s1.scheduler && end.s1.mood === null, 'music(null) não libertou: ' + JSON.stringify(end.s1));
  check(end.s2.insts === 0 && !end.s2.scheduler, 'stop() não libertou: ' + JSON.stringify(end.s2));
} finally {
  await browser.close();
}

for (const e of pageErrors) fails.push(e);
if (fails.length) {
  console.log('✗ audio_check: ' + fails.length + ' problema(s) em ' + checks + ' verificações');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ audio_check: ' + checks + ' verificações, sem erros de página/consola');
