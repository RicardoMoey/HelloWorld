/* Verificação do motor de áudio num Chromium real (Playwright), sem servidor:
   1) varre js/ui/*.js e js/main.js à procura de todos os nomes pedidos ao áudio (play/sfx/music/stinger,
      propriedades sound:/stinger:, tabelas *_SFX, funções *Sound, moods().indexOf(...)) — nenhum pode faltar;
   2) render offline (OfflineAudioContext, mesmo grafo e compressor, volumes no máximo) de cada efeito,
      ambiente (24 s) e stinger: sem NaN, pico < 0,98, RMS dentro da banda dos de referência, cauda limpa,
      sem estalido no arranque, motor da interceção em ciclo sem buracos, ambientes sem silêncios longos;
   3) em tempo real: injeta js/audio/audio.js numa página em branco, toca tudo e verifica guardas,
      transições, silêncio e libertação de recursos.
   Uso: node ovni-1999/qa/audio_check.mjs [--table] [--offline]
   (--table lista as medidas de cada nome; --offline salta a parte em tempo real, ~1 min mais rápida) */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'js', 'audio', 'audio.js');
const TABLE = process.argv.includes('--table');
const OFFLINE_ONLY = process.argv.includes('--offline');

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
  // estratégia (vaga 4)
  'dogfight_engine', 'craft_takeoff', 'craft_landing', 'terror_siren', 'siren', 'base_alarm', 'ufo_lost',
  'ufo_landed', 'base_build', 'facility_done', 'funds_in', 'council_bad', 'council_good', 'interrogation',
  'autosave', 'purchase',
];
// efeitos da vaga 4 (medidos com bandas próprias); os restantes servem de referência de volume
const NEW_SFX = EXPECTED.slice(EXPECTED.indexOf('dogfight_engine'));
const SUBTLE = ['autosave', 'ui_click', 'ui_select', 'purchase', 'step_wood', 'step_metal', 'step_alloy', 'step_earth', 'grenade_pin', 'radar_ping'];
const MOODS = ['geoscape', 'battle', 'battle_tense', 'terror', 'menu', 'interception', 'base', 'research',
  'alien_base', 'alien_base_tense', 'cydonia', 'cydonia_tense', 'victory', 'defeat'];
const REF_MOODS = ['menu', 'geoscape', 'battle', 'battle_tense', 'terror'];
const STINGERS = ['victory', 'defeat', 'research', 'monthly'];

const pageErrors = [];
const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};

// ---------------------------------------------------------------- 1) nomes pedidos pela interface
const NAME_RE = /^[a-z][a-z0-9_]*$/;
// fecho equilibrado a partir de src[i] (que é '(' ou '{'), ignorando strings
function balanced(src, i) {
  const open = src[i], close = open === '(' ? ')' : '}';
  let d = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (q) {
      if (ch === '\\') j++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if (ch === open) d++;
    else if (ch === close && --d === 0) return src.slice(i + 1, j);
  }
  return '';
}
// expressão até à vírgula/chaveta/parêntese de fecho ao nível 0
function exprAt(src, i) {
  let d = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (q) {
      if (ch === '\\') j++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') q = ch;
    else if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { if (d === 0) return src.slice(i, j); d--; }
    else if ((ch === ',' || ch === ';' || ch === '\n') && d === 0) return src.slice(i, j);
  }
  return src.slice(i);
}
// literais que são nomes: sem índices [..] nem lados de comparações
function literals(expr) {
  let e = expr;
  for (let k = 0; k < 4; k++) e = e.replace(/\[[^\[\]]*\]/g, '').replace(/[\w$.]+\s*\([^()]*\)/g, '0');
  e = e.replace(/(===|!==|==|!=)\s*(['"])[^'"]*\2/g, '').replace(/(['"])[^'"]*\1\s*(===|!==|==|!=)/g, '');
  const out = [];
  for (const m of e.matchAll(/(['"])([^'"\n]*)\1/g)) if (NAME_RE.test(m[2])) out.push(m[2]);
  return out;
}
function scanUi() {
  const files = fs.readdirSync(path.join(ROOT, 'js', 'ui')).filter((f) => f.endsWith('.js')).map((f) => path.join('js', 'ui', f));
  files.push(path.join('js', 'main.js'));
  const req = { sfx: new Map(), mood: new Map(), stinger: new Map() };
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    const add = (kind, names, at) => {
      const where = rel + ':' + src.slice(0, at).split('\n').length;
      for (const n of names) {
        if (!req[kind].has(n)) req[kind].set(n, []);
        req[kind].get(n).push(where);
      }
    };
    const kindOf = (fn) => (fn === 'music' ? 'mood' : fn === 'stinger' ? 'stinger' : 'sfx');
    for (const m of src.matchAll(/(function\s+)?\b(sfx|play|music|stinger|hasSfx)\s*\(/g)) {
      if (m[1]) continue; // definição
      add(kindOf(m[2]), literals(balanced(src, m.index + m[0].length - 1)), m.index);
    }
    for (const m of src.matchAll(/\b(sound|stinger)\s*:/g)) add(m[1] === 'sound' ? 'sfx' : 'stinger', literals(exprAt(src, m.index + m[0].length)), m.index);
    for (const m of src.matchAll(/\b(moods|names|stingers)\b(?:\(\))?\.indexOf\(\s*(['"])([a-z0-9_]+)\2/g)) {
      add(m[1] === 'moods' ? 'mood' : m[1] === 'stingers' ? 'stinger' : 'sfx', [m[3]], m.index);
    }
    for (const m of src.matchAll(/\b[A-Z_]*(?:SFX|SND|SOUND)[A-Z_]*\s*=\s*\{/g)) {
      const body = balanced(src, m.index + m[0].length - 1);
      add('sfx', [...body.matchAll(/:\s*(['"])([a-z0-9_]+)\1/g)].map((x) => x[2]), m.index);
    }
    for (const m of src.matchAll(/function\s+\w*[sS]ound\w*\s*\([^)]*\)\s*\{/g)) {
      const body = balanced(src, m.index + m[0].length - 1);
      for (const r of body.matchAll(/return\s+([^;]*);/g)) add('sfx', literals(r[1]), m.index);
    }
  }
  return req;
}

globalThis.OV = {};
require(AUDIO);
const LIB = { sfx: OV.audio.names(), mood: OV.audio.moods(), stinger: OV.audio.stingers() };
const REQ = scanUi();
const missingUi = [];
for (const kind of ['sfx', 'mood', 'stinger']) {
  for (const [n, where] of REQ[kind]) if (!LIB[kind].includes(n)) missingUi.push(kind + ' «' + n + '» (' + where.slice(0, 3).join(', ') + ')');
}
console.log('interface: ' + REQ.sfx.size + ' efeitos, ' + REQ.mood.size + ' ambientes, ' + REQ.stinger.size + ' stingers pedidos; em falta: ' + (missingUi.length ? missingUi.join('; ') : 'nenhum'));
check(missingUi.length === 0, 'nomes pedidos pela interface sem implementação: ' + missingUi.join('; '));
check(REQ.sfx.size >= 20 && REQ.mood.size >= 4, 'varrimento da interface encontrou poucos nomes (regex partido?)');
check(LIB.mood.slice().sort().join() === MOODS.slice().sort().join(), 'moods() difere do esperado: ' + LIB.mood.join(','));
check(LIB.stinger.slice().sort().join() === STINGERS.slice().sort().join(), 'stingers() difere do esperado: ' + LIB.stinger.join(','));

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

  // ---------------------------------------------------------------- 2) render offline
  await page.evaluate(() => {
    // medidas de um render: pico, NaN, RMS na zona ativa, brilho (RMS da derivada / RMS), janelas de RMS, cauda e arranque
    // contador de nós criados (custo de CPU): conta as fábricas do contexto durante o agendamento
    const P = (window.BaseAudioContext || window.AudioContext).prototype;
    window.__qa.nodes = 0;
    for (const k of Object.getOwnPropertyNames(P)) {
      if (!/^create/.test(k) || k === 'createBuffer' || k === 'createPeriodicWave' || typeof P[k] !== 'function') continue;
      const f = P[k];
      P[k] = function () { window.__qa.nodes++; return f.apply(this, arguments); };
    }
    window.__qa.render = async (kind, name, o) => {
      window.__qa.nodes = 0;
      const pr = window.OV.audio.renderOffline(kind, name, o);
      const nodes = window.__qa.nodes;
      const r = await pr;
      if (!r) return null;
      const b = r.buffer, sr = b.sampleRate, n = b.length;
      const L = b.getChannelData(0), R = b.getChannelData(1);
      const from = Math.floor((o.from || 0) * sr), endI = Math.min(n, Math.ceil((o.to || r.end) * sr));
      let peak = 0, nan = 0, ss = 0, sd = 0, prev = 0, head = 0, tail = 0;
      const win = Math.max(1, Math.floor((o.win || 0.1) * sr)), wins = [];
      let ws = 0, wn = 0;
      for (let i = 0; i < n; i++) {
        const l = L[i], rr = R[i];
        if (l !== l || rr !== rr) { nan++; continue; }
        const a = Math.max(Math.abs(l), Math.abs(rr));
        if (a > peak) peak = a;
        if (i < sr * 0.002 && a > head) head = a;
        if (i > endI + sr * 0.3 && a > tail) tail = a;
        if (i >= from && i < endI) {
          const v = (l + rr) / 2;
          ss += v * v;
          sd += (v - prev) * (v - prev);
          prev = v;
          ws += v * v;
          if (++wn === win) { wins.push(Math.sqrt(ws / win)); ws = 0; wn = 0; }
        }
      }
      // estalidos: amostra isolada muito acima da 2.ª diferença local (±32 amostras sem as vizinhas); o limiar
      // (25×) ignora o estalar intencional do buffer «crackle» e apanha degraus de ganho e arranques a seco
      const m = new Float32Array(n);
      for (let i = 1; i < n - 1; i++) m[i] = (L[i] - (L[i - 1] + L[i + 1]) / 2) ** 2;
      const pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + m[i];
      let clicks = 0, clickAt = -1;
      for (let i = 33; i < n - 33; i++) {
        const d = Math.sqrt(m[i]);
        if (d < 0.04) continue;
        const loc = Math.sqrt((pre[i + 33] - pre[i - 32] - (pre[i + 2] - pre[i - 1])) / 62);
        if (d > 25 * loc) { clicks++; if (clickAt < 0) clickAt = i / sr; }
      }
      const cnt = Math.max(1, endI - from), rms = Math.sqrt(ss / cnt);
      const sorted = wins.slice().sort((x, y) => x - y);
      return {
        name, end: r.end, peak, nan, rms, bright: rms > 0 ? Math.sqrt(sd / cnt) / rms : 0, head, tail,
        winMin: sorted[0] || 0, winMax: sorted[sorted.length - 1] || 0, winMed: sorted[sorted.length >> 1] || 0,
        tailChecked: endI + sr * 0.3 < n, clicks, clickAt, nodes, nps: nodes / r.end,
      };
    };
  });
  const off = await page.evaluate(async ({ sfx, moods, stingers }) => {
    const Q = window.__qa;
    const out = { sfx: [], moods: [], stingers: [] };
    for (const n of sfx) out.sfx.push(await Q.render('sfx', n, { secs: 4.5, sampleRate: 44100 }));
    for (const n of moods) out.moods.push(await Q.render('mood', n, { secs: 24, sampleRate: 32000, from: 3, to: 24, win: 2 }));
    for (const n of stingers) out.stingers.push(await Q.render('stinger', n, { secs: 5, sampleRate: 44100 }));
    // o motor da interceção repete-se a cada 1,7 s: entre disparos o nível não pode cair a pique
    out.engine = await Q.render('sfx', 'dogfight_engine', { secs: 6, sampleRate: 32000, at: [0, 1.7, 3.4], from: 0.45, to: 5.0, win: 0.15 });
    out.unknown = await window.OV.audio.renderOffline('sfx', 'nao_existe');
    return out;
  }, { sfx: EXPECTED, moods: MOODS, stingers: STINGERS });

  const fmt = (x) => (x < 0.001 ? x.toExponential(1) : x.toFixed(4));
  check(off.unknown === null, 'renderOffline de nome desconhecido devia devolver null');
  const allR = [...off.sfx, ...off.moods, ...off.stingers];
  check(allR.every(Boolean), 'renderOffline falhou para: ' + [...EXPECTED, ...MOODS, ...STINGERS].filter((n, i) => !allR[i]).join(', '));
  for (const r of allR.filter(Boolean)) {
    check(r.nan === 0, 'NaN no render de ' + r.name);
    check(r.peak < 0.98, 'saturação no render de ' + r.name + ' (pico ' + r.peak.toFixed(3) + ')');
    check(r.clicks === 0, 'estalido(s) no render de ' + r.name + ': ' + r.clicks + ' (primeiro a ' + r.clickAt.toFixed(3) + ' s)');
  }
  const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const refSfx = off.sfx.filter((r) => r && !NEW_SFX.includes(r.name) && !SUBTLE.includes(r.name));
  const refRms = median(refSfx.map((r) => r.rms));
  for (const r of off.sfx.filter(Boolean)) {
    check(r.peak > 1e-3, 'efeito mudo offline: ' + r.name);
    check(r.tailChecked && r.tail < 2e-3, 'cauda não termina (vozes penduradas?): ' + r.name + ' ' + fmt(r.tail));
    check(r.head < 0.05, 'estalido no arranque: ' + r.name + ' ' + fmt(r.head));
    if (NEW_SFX.includes(r.name)) {
      const lo = SUBTLE.includes(r.name) ? refRms * 0.04 : refRms * 0.25, hi = refRms * 4;
      check(r.rms > lo && r.rms < hi, 'RMS fora da banda (' + fmt(lo) + '..' + fmt(hi) + '): ' + r.name + ' ' + fmt(r.rms));
    }
  }
  const e = off.engine;
  check(e && e.winMin > e.winMax * 0.45, 'motor da interceção com buracos entre repetições: min ' + (e && fmt(e.winMin)) + ' / max ' + (e && fmt(e.winMax)));
  const ref = off.moods.filter((r) => r && REF_MOODS.includes(r.name));
  const mLo = Math.min(...ref.map((r) => r.rms)), mHi = Math.max(...ref.map((r) => r.rms)), bHi = Math.max(...ref.map((r) => r.bright));
  for (const r of off.moods.filter(Boolean)) {
    check(r.rms > mLo * 0.4 && r.rms < mHi * 2, 'ambiente ' + r.name + ' fora da banda de volume dos de referência (' + fmt(mLo) + '..' + fmt(mHi) + '): ' + fmt(r.rms));
    check(r.winMin > r.winMed * 0.2, 'ambiente ' + r.name + ' com silêncios longos (janela mínima ' + fmt(r.winMin) + ' vs mediana ' + fmt(r.winMed) + ')');
    check(r.bright < bHi * 1.5, 'ambiente ' + r.name + ' demasiado agudo/áspero (brilho ' + r.bright.toFixed(3) + ' vs ' + bHi.toFixed(3) + ')');
  }
  const npsHi = Math.max(...ref.map((r) => r.nps));
  for (const r of off.moods.filter(Boolean)) check(r.nps < npsHi * 1.3, 'ambiente ' + r.name + ' cria demasiados nós (' + r.nps.toFixed(0) + '/s vs ' + npsHi.toFixed(0) + '/s)');
  for (const r of off.sfx.filter(Boolean)) check(r.nodes < 90, 'efeito ' + r.name + ' cria demasiados nós: ' + r.nodes);
  for (const r of off.stingers.filter(Boolean)) check(r.peak > 1e-3, 'stinger mudo offline: ' + r.name);
  const sfxMax = Math.max(...off.sfx.filter(Boolean).map((r) => r.rms));
  check(mHi * 2 < sfxMax, 'ambientes não ficam por baixo dos efeitos');
  console.log('offline: ' + allR.length + ' renders; RMS ref. efeitos ' + fmt(refRms) + ', ambientes ' + fmt(mLo) + '..' + fmt(mHi) +
    '; nós/s ambientes ≤ ' + npsHi.toFixed(0) + ' (ref.)' +
    '; motor min/max ' + fmt(e.winMin) + '/' + fmt(e.winMax));
  if (TABLE) {
    console.log('  nome                     pico    rms     brilho  fim    estal. nós   nós/s');
    for (const r of allR.filter(Boolean)) console.log('  ' + r.name.padEnd(24) + ' ' + r.peak.toFixed(3) + '  ' + fmt(r.rms).padEnd(7) + ' ' + r.bright.toFixed(3) + '   ' + r.end.toFixed(2).padEnd(6) + ' ' + String(r.clicks).padEnd(6) + ' ' + String(r.nodes).padEnd(5) + ' ' + r.nps.toFixed(0));
  }

  if (!OFFLINE_ONLY) await realtime(page);
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- 3) tempo real
async function realtime(page) {
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
  if (TABLE) for (const r of sfx) console.log('  ' + r.n.padEnd(24) + r.p.toFixed(4));
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
    // camada de intensidade genérica: alien_base → alien_base_tense → cydonia_tense (troca de instância)
    A.music('alien_base');
    await window.__qa.sleep(200);
    const s4 = A.status().moodSerial;
    A.music('alien_base_tense');
    await window.__qa.sleep(300);
    const st5 = A.status();
    const p5 = await window.__qa.peak(200);
    A.music('cydonia_tense');
    await window.__qa.sleep(200);
    const st6 = A.status();
    return { out, s1, st2, st3, s4, st5, p5, st6 };
  }, MOODS);
  for (const r of moods.out) {
    check(r.ok && r.st.mood === r.m, 'music(' + r.m + ') não ficou ativo: ' + JSON.stringify(r.st));
    check(r.p > 1e-5, 'ambiente mudo: ' + r.m);
  }
  check(moods.s1 && moods.st2.moodSerial === moods.s1 && moods.st2.tense === true, 'battle_tense devia acrescentar a camada sem reiniciar: ' + JSON.stringify(moods.st2));
  check(moods.st3.tense === false && moods.st3.moodSerial === moods.s1, 'voltar a battle devia retirar a camada');
  check(moods.st5.moodSerial === moods.s4 && moods.st5.tense === true && moods.p5 > 1e-5, 'alien_base_tense devia reaproveitar alien_base: ' + JSON.stringify(moods.st5));
  check(moods.st6.moodSerial !== moods.s4 && moods.st6.tense === true && moods.st6.mood === 'cydonia_tense', 'cydonia_tense devia criar instância nova com camada: ' + JSON.stringify(moods.st6));

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
}

for (const e of pageErrors) fails.push(e);
if (fails.length) {
  console.log('✗ audio_check: ' + fails.length + ' problema(s) em ' + checks + ' verificações');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ audio_check: ' + checks + ' verificações, sem erros de página/consola');
