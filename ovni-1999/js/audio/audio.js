/* Áudio procedimental (Web Audio): efeitos sintetizados, música generativa por ambiente com transição
   cruzada, stingers e voz (speechSynthesis pt-PT). Só no navegador; qualquer falha fica em silêncio.
   Motor adaptado de command-2026/js/audio.js (DESIGN.md §17; durações alinhadas com §10).
   API: init, configure, play(nome, {vol, pan, rate, delay}), music(ambiente|null), stinger, setMuted, speak,
   stop, spatial, level, status, setVolumes, names(), moods(), stingers(), renderOffline (QA).
   Ambientes: menu, geoscape, battle(_tense), terror, interception, base, research, alien_base(_tense),
   cydonia(_tense), victory, defeat — «X_tense» junta a camada de intensidade a X sem reiniciar.
   Nomes desconhecidos são ignorados (devolvem false): a interface pode testar names()/moods() antes. */
(function (OV) {
  'use strict';

  const W = typeof window !== 'undefined' ? window : globalThis;
  const DOC = typeof document !== 'undefined' ? document : null;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const rnd = Math.random; // só cosmética: nunca toca nas streams da simulação
  const pick = (arr) => arr[(rnd() * arr.length) | 0];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noop = () => {};

  const MAX_VOICES = 24;
  const LOOKAHEAD = 0.12; // s de música agendada à frente do relógio
  const TICK_MS = 30;
  const FADE = 1.6; // s de transição cruzada entre ambientes
  const SCALE = { master: 0.9, sfx: 1, music: 0.42, stinger: 2 };
  // «<ambiente>_tense» acrescenta a camada de intensidade ao ambiente base sem o reiniciar
  const MOOD_LIST = [
    'menu', 'geoscape', 'battle', 'battle_tense', 'terror', 'interception', 'base', 'research',
    'alien_base', 'alien_base_tense', 'cydonia', 'cydonia_tense', 'victory', 'defeat',
  ];

  const A = {
    ctx: null, comp: null, master: null, meter: null, sfx: null, mus: null, moodMix: null, stBus: null,
    buf: {},
    settings: { sound: true, music: true, voice: false, volMaster: 0.8, volSfx: 0.9, volMusic: 0.5 },
    muted: false,
    hidden: !!(DOC && DOC.hidden),
    suspendedByUs: false,
    last: Object.create(null),
    voices: 0,
    mood: null, wantMood: null, insts: [], timer: 0,
    duckUntil: 0, duckLevel: 1,
  };

  // voz em construção: destino, multiplicador de altura/tempo e fim previsto (para libertar a voz)
  let cur = null;

  const audible = () => A.settings.sound && !A.muted && !A.hidden;
  const musicAudible = () => audible() && A.settings.music;

  function ramp(param, v, tc) {
    try {
      param.setTargetAtTime(v, A.ctx.currentTime, tc || 0.03);
    } catch (e) {
      param.value = v;
    }
  }

  function apply() {
    if (!A.ctx) return;
    const s = A.settings;
    ramp(A.master.gain, audible() ? clamp(s.volMaster, 0, 1) * SCALE.master : 0, 0.02);
    ramp(A.sfx.gain, clamp(s.volSfx, 0, 1) * SCALE.sfx);
    ramp(A.mus.gain, s.music ? clamp(s.volMusic, 0, 1) * SCALE.music : 0, 0.15);
  }

  function cancelSpeech() {
    try {
      if (W.speechSynthesis) W.speechSynthesis.cancel();
    } catch (e) { /* fala indisponível */ }
  }

  function resume() {
    if (!A.ctx || A.hidden || A.ctx.state !== 'suspended') return;
    try {
      const p = A.ctx.resume();
      if (p && p.catch) p.catch(noop);
    } catch (e) { /* ignora */ }
  }

  // ------------------------------------------------------------------ grafo e buffers
  function build() {
    const c = A.ctx;
    A.comp = c.createDynamicsCompressor();
    A.comp.threshold.value = -16;
    A.comp.knee.value = 12;
    A.comp.ratio.value = 6;
    A.comp.attack.value = 0.003;
    A.comp.release.value = 0.25;
    A.master = c.createGain();
    A.master.gain.value = 0;
    A.meter = c.createAnalyser();
    A.meter.fftSize = 2048;
    A.sfx = c.createGain();
    A.mus = c.createGain();
    A.mus.gain.value = 0;
    A.moodMix = c.createGain(); // ambientes passam aqui (para baixar a música sob alertas e stingers)
    A.moodMix.connect(A.mus);
    A.stBus = c.createGain(); // stingers: à frente dos ambientes, mas sob o volume da música
    A.stBus.gain.value = SCALE.stinger;
    A.stBus.connect(A.mus);
    A.sfx.connect(A.comp);
    A.mus.connect(A.comp);
    A.comp.connect(A.master);
    A.master.connect(A.meter);
    A.meter.connect(c.destination);

    const sr = c.sampleRate;
    const white = c.createBuffer(1, sr, sr);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = rnd() * 2 - 1;

    // ruído castanho (graves para explosões, passos, desabamentos), normalizado a pico 1
    const brown = c.createBuffer(1, sr * 2, sr);
    const b = brown.getChannelData(0);
    let last = 0, peak = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      b[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    for (let i = 0; i < b.length; i++) b[i] /= peak || 1;

    // estalidos esparsos (fogo, eletricidade, insetos, detritos)
    const crackle = c.createBuffer(1, sr, sr);
    const k = crackle.getChannelData(0);
    let i = 0;
    while (i < k.length) {
      i += 20 + ((rnd() * sr) / 260) | 0;
      const len = 3 + ((rnd() * 40) | 0), amp = (0.3 + rnd() * 0.7) * (rnd() < 0.5 ? -1 : 1);
      // ataque de 3 amostras: estala sem picos isolados de uma amostra
      for (let j = 0; j < len && i + j < k.length; j++) k[i + j] = amp * Math.min(1, (j + 1) / 3) * (1 - j / len) * (rnd() * 2 - 1);
    }
    A.buf = { white, brown, crackle };

    // desbloqueio (Safari): buffer silencioso tocado dentro do gesto
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, sr);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* ignora */ }
  }

  // ------------------------------------------------------------------ primitivas
  function done(end) {
    if (cur && end > cur.end) cur.end = end;
  }

  // envolvente exponencial: ataque curto, patamar opcional, decaimento até t+dur
  function env(p, t, a, peak, dur, hold) {
    const at = Math.min(a, dur * 0.6);
    const pk = Math.max(0.0002, peak);
    // valor intrínseco antes do primeiro evento: sem isto a primeira amostra (fracionária) sai com ganho 1 — estalido
    p.value = 0.0001;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(pk, t + at);
    const h = hold ? Math.min(hold, dur - at - 0.01) : 0;
    if (h > 0) p.setValueAtTime(pk, t + at + h);
    p.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // filtro [tipo, f0, f1?, q?] com varrimento exponencial ao longo de dur
  function filt(src, spec, t, dur) {
    const f = A.ctx.createBiquadFilter();
    const r = cur.r;
    f.type = spec[0];
    f.frequency.setValueAtTime(clamp(spec[1] * r, 20, 20000), t);
    if (spec[2] && spec[2] !== spec[1]) f.frequency.exponentialRampToValueAtTime(clamp(spec[2] * r, 20, 20000), t + dur);
    if (spec[3]) f.Q.value = spec[3];
    src.connect(f);
    return f;
  }

  function lfo(param, rate, depth, t, dur) {
    const c = A.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function tremolo(head, o, t, dur) {
    const tg = A.ctx.createGain();
    tg.gain.value = 1 - o.trem[1] / 2;
    lfo(tg.gain, o.trem[0], o.trem[1] / 2, t, dur);
    head.connect(tg);
    return tg;
  }

  // oscilador: {t, type, f, f1, glide, dur, g, a, hold, det, vib:[Hz, profundidade Hz], trem:[Hz, 0..1], flt}
  function osc(o) {
    const c = A.ctx, r = cur.r, t = o.t, dur = o.dur / r;
    const n = c.createOscillator();
    n.type = o.type || 'sine';
    n.frequency.setValueAtTime(o.f * r, t);
    if (o.f1 && o.f1 !== o.f) n.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1 * r), t + (o.glide ? o.glide / r : dur));
    if (o.det) n.detune.value = o.det;
    if (o.vib) lfo(n.frequency, o.vib[0], o.vib[1] * r, t, dur);
    let head = o.flt ? filt(n, o.flt, t, dur) : n;
    if (o.trem) head = tremolo(head, o, t, dur);
    const g = c.createGain();
    env(g.gain, t, o.a || 0.005, o.g, dur, o.hold);
    head.connect(g);
    g.connect(cur.dest);
    n.start(t);
    n.stop(t + dur + 0.05);
    done(t + dur);
  }

  // ruído: {t, dur, flt, flt2, g, a, hold, buf:'white'|'brown'|'crackle', rate}
  function nz(o) {
    const c = A.ctx, t = o.t, dur = o.dur / cur.r;
    const b = A.buf[o.buf || 'white'];
    const s = c.createBufferSource();
    s.buffer = b;
    s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    let head = o.flt ? filt(s, o.flt, t, dur) : s;
    if (o.flt2) head = filt(head, o.flt2, t, dur);
    const g = c.createGain();
    env(g.gain, t, o.a || 0.004, o.g, dur, o.hold);
    head.connect(g);
    g.connect(cur.dest);
    s.start(t, rnd() * (b.duration - 0.1));
    s.stop(t + dur + 0.05);
    done(t + dur);
  }

  // síntese FM: {t, f, f1, ratio, idx, idx1, dur, g, a, hold, type, vib, flt}
  function fm(o) {
    const c = A.ctx, r = cur.r, t = o.t, dur = o.dur / r;
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
    const f = o.f * r, mf = f * o.ratio;
    car.type = o.type || 'sine';
    car.frequency.setValueAtTime(f, t);
    mod.frequency.setValueAtTime(mf, t);
    if (o.f1 && o.f1 !== o.f) {
      car.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1 * r), t + dur);
      mod.frequency.exponentialRampToValueAtTime(Math.max(5, o.f1 * r * o.ratio), t + dur);
    }
    mg.gain.setValueAtTime(Math.max(0.01, o.idx * mf), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, num(o.idx1, o.idx) * mf), t + dur);
    mod.connect(mg);
    mg.connect(car.frequency);
    if (o.vib) lfo(car.frequency, o.vib[0], o.vib[1] * r, t, dur);
    const head = o.flt ? filt(car, o.flt, t, dur) : car;
    const g = c.createGain();
    env(g.gain, t, o.a || 0.004, o.g, dur, o.hold);
    head.connect(g);
    g.connect(cur.dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
    done(t + dur);
  }

  // fonte com formantes (gritos): {t, type, f, f1, dur, g, a, vib, forms:[[f0, f1, q, ganho], ...]}
  function formant(o) {
    const c = A.ctx, r = cur.r, t = o.t, dur = o.dur / r;
    const src = c.createOscillator();
    src.type = o.type || 'sawtooth';
    src.frequency.setValueAtTime(o.f * r, t);
    if (o.f1 && o.f1 !== o.f) src.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1 * r), t + dur);
    if (o.vib) lfo(src.frequency, o.vib[0], o.vib[1] * r, t, dur);
    const g = c.createGain();
    env(g.gain, t, o.a || 0.01, o.g, dur, o.hold);
    for (const fo of o.forms) {
      const bp = filt(src, ['bandpass', fo[0], fo[1], fo[2]], t, dur);
      const fg = c.createGain();
      fg.gain.value = fo[3] || 1;
      bp.connect(fg);
      fg.connect(g);
    }
    g.connect(cur.dest);
    src.start(t);
    src.stop(t + dur + 0.05);
    done(t + dur);
  }

  // metais: dois dentes de serra desafinados com filtro que abre no ataque
  function brass(t, f, dur, gain, o) {
    o = o || {};
    const c = A.ctx, r = cur.r, d = dur / r, fr = f * r;
    const a = Math.min(o.a || 0.025, d * 0.4);
    const lo = o.lo || 300, hi = o.hi || 2600;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = o.q || 1.6;
    lp.frequency.setValueAtTime(lo, t);
    lp.frequency.exponentialRampToValueAtTime(hi, t + Math.min(a * 2.5, d * 0.5));
    lp.frequency.exponentialRampToValueAtTime(Math.max(lo, hi * 0.35), t + d);
    const g = c.createGain();
    env(g.gain, t, a, gain, d, o.hold);
    lp.connect(g);
    g.connect(cur.dest);
    for (const det of [-7, 6]) {
      const n = c.createOscillator();
      n.type = o.type || 'sawtooth';
      n.frequency.value = fr;
      n.detune.value = det;
      n.connect(lp);
      n.start(t);
      n.stop(t + d + 0.05);
    }
    done(t + d);
  }

  const bell = (t, f, dur, g, ratio) => fm({ t, f, ratio: ratio || 3.5, idx: 3, idx1: 0.05, dur, g, a: 0.003 });
  const timp = (t, f, dur, g) => {
    osc({ t, f, f1: f * 0.82, dur: dur || 0.8, g: g || 0.16 });
    nz({ t, dur: 0.08, flt: ['lowpass', 700, 200], g: 0.06 });
  };
  const tone = (t, type, f0, f1, dur, g, a) => osc({ t, type, f: f0, f1, dur, g, a });
  const noise = (t, dur, type, f0, f1, q, g, a, buf) => nz({ t, dur, flt: [type, f0, f1, q], g, a, buf });
  // agenda notas para outro destino (camada de intensidade)
  function into(dest, fn) {
    const prev = cur.dest;
    cur.dest = dest;
    try { fn(); } finally { cur.dest = prev; }
  }

  // grupo com envolvente linear (motores e sirenes: sobreposições sem buracos nem estalidos);
  // as vozes lá dentro usam patamar longo e só o grupo dá a forma
  function group(t, dur, a, rel, peak, fn) {
    const c = A.ctx, r = cur.r, d = dur / r, at = a / r;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + at);
    g.gain.setValueAtTime(peak, t + Math.max(at, d - rel / r));
    g.gain.linearRampToValueAtTime(0, t + d);
    g.connect(cur.dest);
    into(g, fn);
    done(t + d);
  }

  // oscilador com curva de altura por pontos [[s, Hz], ...] (rampas lineares); ganho fixo, para usar dentro de group()
  function glide(t, type, pts, dur, g, flt, det, vib) {
    const c = A.ctx, r = cur.r, d = dur / r;
    const n = c.createOscillator();
    n.type = type || 'sine';
    n.frequency.setValueAtTime(pts[0][1] * r, t);
    for (let i = 1; i < pts.length; i++) n.frequency.linearRampToValueAtTime(pts[i][1] * r, t + pts[i][0] / r);
    if (det) n.detune.value = det;
    if (vib) lfo(n.frequency, vib[0], vib[1] * r, t, d);
    const head = flt ? filt(n, flt, t, d) : n;
    const gg = c.createGain();
    gg.gain.value = g;
    head.connect(gg);
    gg.connect(cur.dest);
    n.start(t);
    n.stop(t + d + 0.05);
    done(t + d);
  }

  // ------------------------------------------------------------------ receitas de efeitos
  const SFX = {
    // interface
    ui_click: (t) => { tone(t, 'square', 1150, 0, 0.018, 0.03); noise(t, 0.012, 'bandpass', 3200, 0, 2, 0.025); },
    ui_confirm: (t) => { tone(t, 'triangle', 784, 0, 0.07, 0.07); tone(t + 0.065, 'triangle', 1175, 0, 0.13, 0.07); },
    ui_deny: (t) => {
      // zumbido «sem UT»: duas notas graves desafinadas
      for (const [d, f, len] of [[0, 150, 0.1], [0.12, 118, 0.15]]) {
        osc({ t: t + d, type: 'square', f, dur: len, g: 0.055, hold: len * 0.5, flt: ['lowpass', 900] });
        osc({ t: t + d, type: 'sawtooth', f: f * 1.025, dur: len, g: 0.04, hold: len * 0.5, flt: ['lowpass', 900] });
      }
    },
    ui_select: (t) => { tone(t, 'sine', 1250, 1650, 0.05, 0.05); noise(t, 0.035, 'bandpass', 2400, 0, 2, 0.025); },

    // passos (discretos; um por quadrado, 240 ms)
    step_earth: (t) => { noise(t, 0.09, 'lowpass', 700, 220, 0.8, 0.11, 0.006, 'brown'); noise(t + 0.01, 0.04, 'bandpass', 1900, 1400, 1.2, 0.03); },
    step_wood: (t) => { tone(t, 'sine', 210, 130, 0.07, 0.055); noise(t, 0.05, 'bandpass', 950, 700, 3, 0.045); },
    step_metal: (t) => {
      noise(t, 0.03, 'highpass', 3000, 0, 0.7, 0.03);
      tone(t, 'triangle', 540, 530, 0.11, 0.02);
      tone(t, 'triangle', 1370, 1350, 0.08, 0.015);
      tone(t, 'triangle', 2230, 2200, 0.06, 0.01);
      noise(t, 0.06, 'lowpass', 500, 200, 0.8, 0.05, 0.004, 'brown');
    },
    step_alloy: (t) => {
      fm({ t, f: 620, ratio: 1.41, idx: 2.5, idx1: 0.2, dur: 0.16, g: 0.022 });
      noise(t, 0.025, 'bandpass', 4200, 0, 3, 0.02);
      noise(t, 0.05, 'lowpass', 400, 200, 0.8, 0.045, 0.004, 'brown');
    },

    // portas e postura
    door_open: (t) => {
      osc({ t, type: 'sawtooth', f: 55, f1: 92, dur: 0.3, g: 0.3, a: 0.04, vib: [11, 6], flt: ['bandpass', 1100, 700, 7] });
      noise(t, 0.25, 'bandpass', 600, 400, 1.5, 0.05, 0.05);
      tone(t + 0.27, 'sine', 120, 70, 0.07, 0.1);
    },
    ufo_door: (t) => {
      noise(t, 0.34, 'highpass', 3600, 1400, 0.8, 0.07, 0.025);
      tone(t, 'sine', 230, 150, 0.3, 0.035, 0.03);
      osc({ t, type: 'square', f: 115, f1: 75, dur: 0.3, g: 0.012, flt: ['lowpass', 600] });
      tone(t + 0.28, 'sine', 95, 50, 0.1, 0.09);
      noise(t + 0.28, 0.06, 'lowpass', 600, 200, 0.8, 0.05);
    },
    kneel: (t) => {
      noise(t, 0.16, 'bandpass', 1300, 700, 1, 0.07, 0.03);
      noise(t + 0.1, 0.12, 'bandpass', 1000, 600, 1, 0.045, 0.02);
      noise(t + 0.14, 0.07, 'lowpass', 350, 150, 0.8, 0.1, 0.004, 'brown');
    },

    // armas
    pistol: (t) => {
      noise(t, 0.06, 'bandpass', 2500, 1100, 1, 0.22);
      tone(t, 'square', 330, 110, 0.03, 0.05);
      tone(t, 'sine', 160, 70, 0.05, 0.1);
      noise(t + 0.02, 0.2, 'lowpass', 900, 200, 0.7, 0.05, 0.01);
    },
    rifle: (t) => {
      noise(t, 0.08, 'bandpass', 1900, 850, 1, 0.26);
      tone(t, 'square', 260, 90, 0.035, 0.05);
      tone(t, 'sine', 140, 55, 0.08, 0.16);
      noise(t + 0.03, 0.3, 'lowpass', 800, 160, 0.7, 0.07, 0.01, 'brown');
    },
    // um disparo da rajada (tocar por bala): cauda curta para não embrulhar
    rifle_auto: (t) => {
      noise(t, 0.06, 'bandpass', 2050, 950, 1, 0.24);
      tone(t, 'square', 280, 100, 0.03, 0.045);
      tone(t, 'sine', 150, 60, 0.06, 0.13);
      noise(t + 0.02, 0.14, 'lowpass', 900, 220, 0.7, 0.045, 0.01, 'brown');
    },
    heavy_cannon: (t) => {
      noise(t, 0.05, 'highpass', 2200, 1200, 0.7, 0.2);
      noise(t, 0.5, 'lowpass', 1300, 140, 0.7, 0.5, 0.004, 'brown');
      tone(t, 'sine', 95, 34, 0.38, 0.55);
      tone(t, 'square', 190, 60, 0.05, 0.07);
      noise(t + 0.42, 0.035, 'bandpass', 2600, 0, 4, 0.05);
      noise(t + 0.5, 0.03, 'bandpass', 1900, 0, 4, 0.045);
    },
    auto_cannon: (t) => {
      noise(t, 0.12, 'lowpass', 1700, 420, 0.8, 0.34);
      tone(t, 'sine', 150, 58, 0.1, 0.26);
      noise(t, 0.04, 'bandpass', 2400, 1200, 1, 0.12);
    },
    rocket_launch: (t) => {
      tone(t, 'sine', 115, 45, 0.16, 0.3);
      noise(t, 0.08, 'lowpass', 1800, 400, 0.7, 0.25);
      noise(t + 0.02, 0.55, 'bandpass', 420, 2300, 1.6, 0.22, 0.03);
      noise(t + 0.05, 0.6, 'highpass', 4200, 2500, 0.7, 0.05, 0.12);
    },
    laser: (t) => {
      osc({ t, type: 'sawtooth', f: 2600, f1: 620, dur: 0.16, g: 0.11, flt: ['lowpass', 5000, 1500, 2] });
      tone(t, 'square', 1800, 900, 0.12, 0.04);
      tone(t, 'sine', 160, 70, 0.06, 0.08);
      tone(t, 'sine', 4200, 3100, 0.14, 0.02);
      noise(t, 0.05, 'highpass', 5000, 0, 0.7, 0.03);
    },
    plasma: (t) => {
      fm({ t, f: 320, f1: 150, ratio: 0.5, idx: 9, idx1: 1, dur: 0.36, g: 0.12, vib: [22, 25] });
      noise(t, 0.3, 'bandpass', 1100, 300, 2, 0.11, 0.01);
      tone(t, 'sine', 90, 40, 0.18, 0.2);
      osc({ t, type: 'sawtooth', f: 640, f1: 200, dur: 0.12, g: 0.03, flt: ['lowpass', 2400, 600] });
    },
    stun_rod: (t) => {
      nz({ t, dur: 0.32, flt: ['bandpass', 3200, 2200, 1.2], g: 0.45, buf: 'crackle', a: 0.01 });
      tone(t, 'sine', 140, 60, 0.07, 0.12);
      osc({ t, type: 'square', f: 120, dur: 0.3, g: 0.05, trem: [28, 0.7], flt: ['lowpass', 1500] });
      tone(t, 'sine', 1900, 280, 0.14, 0.04);
    },

    // granadas
    grenade_pin: (t) => {
      noise(t, 0.012, 'highpass', 6000, 0, 0.7, 0.05);
      tone(t, 'triangle', 3150, 3100, 0.06, 0.035);
      tone(t, 'triangle', 4700, 4650, 0.04, 0.02);
      tone(t + 0.085, 'triangle', 2100, 1750, 0.07, 0.03);
      noise(t + 0.085, 0.02, 'bandpass', 5000, 0, 3, 0.03);
    },
    throw: (t) => { nz({ t, dur: 0.28, flt: ['bandpass', 500, 1600, 1.4], g: 0.12, a: 0.12 }); },
    bounce: (t) => {
      tone(t, 'sine', 270, 150, 0.08, 0.13);
      noise(t, 0.04, 'bandpass', 1500, 1100, 2, 0.06);
      tone(t + 0.13, 'sine', 250, 150, 0.06, 0.05);
      noise(t + 0.13, 0.03, 'bandpass', 1500, 1100, 2, 0.025);
    },

    // explosões e cenário
    explosion_small: (t) => {
      noise(t, 0.08, 'highpass', 2400, 900, 0.7, 0.2);
      noise(t, 0.6, 'lowpass', 1100, 180, 0.7, 0.5);
      noise(t, 0.9, 'lowpass', 500, 90, 0.7, 0.3, 0.01, 'brown');
      tone(t, 'sine', 85, 30, 0.45, 0.45);
      nz({ t: t + 0.08, dur: 0.6, flt: ['bandpass', 2200, 900, 0.8], g: 0.08, buf: 'crackle', a: 0.02 });
    },
    explosion_large: (t) => {
      noise(t, 0.12, 'highpass', 2600, 800, 0.7, 0.32);
      noise(t, 1.7, 'lowpass', 800, 70, 0.7, 0.85, 0.01, 'brown');
      noise(t, 0.7, 'lowpass', 1300, 200, 0.7, 0.35);
      tone(t, 'sine', 58, 20, 1.2, 0.8);
      tone(t + 0.05, 'sine', 42, 18, 1.4, 0.4, 0.05);
      nz({ t: t + 0.1, dur: 1.3, flt: ['bandpass', 1800, 600, 0.7], g: 0.12, buf: 'crackle', a: 0.05 });
    },
    // um troço de crepitar (a cena chama-o periodicamente enquanto houver fogo à vista)
    fire_loop_tick: (t) => {
      nz({ t, dur: 0.3, flt: ['bandpass', 2600, 1800, 0.7], g: 0.08, buf: 'crackle', a: 0.03 });
      noise(t, 0.34, 'lowpass', 420, 300, 0.7, 0.06, 0.1, 'brown');
    },
    glass_break: (t) => {
      noise(t, 0.05, 'highpass', 3000, 0, 0.7, 0.16);
      noise(t, 0.28, 'highpass', 5500, 3500, 0.7, 0.07);
      for (let i = 0; i < 7; i++) tone(t + rnd() * 0.09, 'triangle', 2600 + rnd() * 4200, 0, 0.06 + rnd() * 0.16, 0.025);
      nz({ t: t + 0.02, dur: 0.35, flt: ['highpass', 4500], g: 0.1, buf: 'crackle' });
    },
    wall_crumble: (t) => {
      noise(t, 1.0, 'lowpass', 520, 110, 0.7, 0.38, 0.03, 'brown');
      noise(t, 0.12, 'lowpass', 1600, 400, 0.7, 0.2);
      for (let i = 0; i < 6; i++) tone(t + 0.06 + rnd() * 0.55, 'sine', 150 + rnd() * 120, 50, 0.12, 0.1 + rnd() * 0.08);
      nz({ t: t + 0.05, dur: 0.8, flt: ['bandpass', 1300, 700, 0.8], g: 0.14, buf: 'crackle', a: 0.03 });
    },

    // mortes alienígenas (varrimentos de formantes por raça)
    alien_death_sectoid: (t) => {
      formant({ t, f: 540, f1: 230, dur: 0.6, g: 0.42, a: 0.02, vib: [9, 24], forms: [[1100, 650, 8, 1], [2700, 1900, 10, 0.7]] });
      noise(t + 0.35, 0.3, 'lowpass', 600, 200, 1, 0.09, 0.03);
    },
    alien_death_floater: (t) => {
      formant({ t, type: 'square', f: 190, f1: 85, dur: 0.75, g: 0.3, a: 0.03, vib: [15, 40], forms: [[650, 380, 6, 1], [1250, 900, 7, 0.6]] });
      nz({ t: t + 0.1, dur: 0.6, flt: ['lowpass', 900, 300, 2], g: 0.35, buf: 'crackle', rate: 0.35 });
    },
    alien_death_snakeman: (t) => {
      noise(t, 0.6, 'bandpass', 5200, 2600, 2, 0.2, 0.03);
      formant({ t, f: 280, f1: 120, dur: 0.55, g: 0.3, a: 0.02, vib: [7, 10], forms: [[750, 420, 6, 1], [1900, 1300, 8, 0.6]] });
    },
    alien_death_muton: (t) => {
      formant({ t, f: 118, f1: 52, dur: 0.9, g: 0.45, a: 0.03, vib: [6, 5], forms: [[520, 300, 5, 1], [1150, 700, 6, 0.7], [2400, 1800, 8, 0.25]] });
      noise(t, 0.8, 'lowpass', 450, 150, 0.8, 0.12, 0.03, 'brown');
      tone(t + 0.6, 'sine', 80, 40, 0.2, 0.18);
    },
    alien_death_ethereal: (t) => {
      for (let i = 0; i < 3; i++) {
        const d = i * 0.17, k = Math.pow(0.45, i);
        osc({ t: t + d, f: 900, f1: 430, dur: 1.0, g: 0.06 * k, a: 0.05, vib: [5, 9] });
        osc({ t: t + d, f: 1353, f1: 651, dur: 0.9, g: 0.04 * k, a: 0.05 });
      }
      fm({ t, f: 220, f1: 110, ratio: 2.01, idx: 1.5, idx1: 0.1, dur: 1.2, g: 0.05, a: 0.1 });
      noise(t, 0.9, 'bandpass', 3000, 1500, 4, 0.025, 0.2);
    },
    alien_death_chryssalid: (t) => {
      formant({ t, type: 'square', f: 1400, f1: 520, dur: 0.45, g: 0.25, a: 0.01, vib: [31, 80], forms: [[2600, 1800, 10, 1], [4200, 3000, 12, 0.6]] });
      nz({ t, dur: 0.45, flt: ['bandpass', 3400, 2500, 2], g: 0.3, buf: 'crackle', rate: 1.6 });
      noise(t + 0.3, 0.2, 'lowpass', 500, 200, 1, 0.06);
    },
    // ciberdisco/sectópode: avaria elétrica e rebentamento
    alien_death_mech: (t) => {
      osc({ t, type: 'sawtooth', f: 420, f1: 38, dur: 0.85, g: 0.07, flt: ['lowpass', 2400, 300, 3] });
      osc({ t, type: 'square', f: 62, dur: 0.6, g: 0.03, trem: [17, 0.8], flt: ['lowpass', 900] });
      nz({ t, dur: 0.5, flt: ['highpass', 2500], g: 0.12, buf: 'crackle', a: 0.01 });
      noise(t + 0.15, 0.55, 'lowpass', 1000, 150, 0.7, 0.28, 0.01, 'brown');
      tone(t + 0.15, 'sine', 80, 30, 0.4, 0.3);
    },

    // soldados (ruído filtrado, sem voz)
    soldier_hit: (t) => {
      tone(t, 'sine', 125, 70, 0.08, 0.16);
      noise(t, 0.12, 'bandpass', 750, 420, 3, 0.14, 0.006);
      formant({ t: t + 0.01, f: 165, f1: 125, dur: 0.15, g: 0.05, forms: [[650, 500, 5, 1], [1100, 900, 6, 0.5]] });
    },
    soldier_death: (t) => {
      formant({ t, f: 160, f1: 78, dur: 0.55, g: 0.25, a: 0.02, vib: [5, 3], forms: [[620, 380, 5, 1], [1050, 750, 6, 0.6]] });
      noise(t, 0.45, 'bandpass', 640, 260, 2, 0.22, 0.02);
      tone(t + 0.4, 'sine', 95, 45, 0.16, 0.3);
      noise(t + 0.4, 0.14, 'lowpass', 420, 160, 0.8, 0.22, 0.004, 'brown');
    },

    // alertas táticos
    // o «stab» de alien avistado: golpe curto e acorde dissonante sustentado (segunda menor + trítono)
    alien_spotted: (t) => {
      for (const m of [50, 51, 56]) brass(t, mtof(m), 0.13, 0.07, { a: 0.008, lo: 400, hi: 3200 });
      tone(t, 'sine', 110, 55, 0.14, 0.2);
      noise(t, 0.05, 'bandpass', 1500, 800, 1, 0.12);
      for (const m of [61, 62, 68]) brass(t + 0.13, mtof(m), 0.55, 0.065, { a: 0.01, lo: 500, hi: 3800, hold: 0.12 });
      tone(t + 0.13, 'sine', 73.4, 70, 0.5, 0.18, 0.01);
      fm({ t: t + 0.13, f: 1180, ratio: 1.41, idx: 3, idx1: 0.1, dur: 0.6, g: 0.03 });
    },
    reaction_alert: (t) => {
      for (let i = 0; i < 2; i++) osc({ t: t + i * 0.09, type: 'square', f: 1480, dur: 0.06, g: 0.08, hold: 0.03, flt: ['lowpass', 4000] });
      osc({ t: t + 0.2, type: 'sawtooth', f: 740, f1: 1480, dur: 0.18, g: 0.075, flt: ['lowpass', 3000] });
    },
    medikit: (t) => {
      tone(t, 'sine', 1046, 0, 0.08, 0.06);
      tone(t + 0.11, 'sine', 1568, 0, 0.12, 0.06);
      noise(t + 0.22, 0.22, 'highpass', 6000, 4500, 0.7, 0.04, 0.03);
    },
    psi: (t) => {
      fm({ t, f: 220, f1: 330, ratio: 1.5, idx: 3, idx1: 6, dur: 1.3, g: 0.07, a: 0.45, vib: [6.5, 18] });
      osc({ t, f: 440, dur: 1.2, g: 0.04, a: 0.4, trem: [7.3, 0.8] });
      osc({ t, f: 446, dur: 1.2, g: 0.04, a: 0.4 });
      noise(t, 1.1, 'bandpass', 1800, 3600, 8, 0.03, 0.5);
    },
    chryssalid_skitter: (t) => {
      for (let i = 0; i < 9; i++) noise(t + i * 0.032 + rnd() * 0.012, 0.012, 'bandpass', 2600 + rnd() * 2400, 0, 4, 0.16 + rnd() * 0.08);
      nz({ t, dur: 0.34, flt: ['bandpass', 3000, 3300, 3], g: 0.16, buf: 'crackle', rate: 1.4 });
    },

    // Geoscape
    ufo_detected: (t) => {
      for (let i = 0; i < 4; i++) {
        const ti = t + i * 0.2, f = i % 2 ? 470 : 620;
        osc({ t: ti, type: 'sawtooth', f, f1: f * 1.06, dur: 0.19, g: 0.06, a: 0.01, hold: 0.12, flt: ['lowpass', 2200, 1400, 3] });
        osc({ t: ti, type: 'square', f: f * 0.5, dur: 0.19, g: 0.03, a: 0.01, hold: 0.12, flt: ['lowpass', 900] });
      }
    },
    radar_ping: (t) => {
      tone(t, 'sine', 1500, 1480, 0.7, 0.06, 0.004);
      tone(t, 'sine', 3000, 2960, 0.2, 0.012);
      tone(t + 0.3, 'sine', 1500, 1480, 0.5, 0.018);
    },
    research_done: (t) => { bell(t, 1046.5, 1.2, 0.07); bell(t + 0.16, 1568, 1.4, 0.06); bell(t + 0.32, 2093, 1.6, 0.04); },
    production_done: (t) => {
      noise(t, 0.06, 'lowpass', 900, 300, 1, 0.12, 0.004, 'brown');
      tone(t, 'sine', 140, 80, 0.08, 0.12);
      tone(t + 0.08, 'triangle', 523, 0, 0.1, 0.08);
      tone(t + 0.18, 'triangle', 784, 0, 0.2, 0.08);
    },
    dogfight_cannon: (t) => {
      for (let i = 0; i < 4; i++) {
        noise(t + i * 0.07, 0.06, 'bandpass', 1500, 650, 1, 0.2);
        tone(t + i * 0.07, 'sine', 140, 60, 0.06, 0.12);
      }
    },
    dogfight_missile: (t) => {
      tone(t, 'sine', 100, 50, 0.12, 0.2);
      noise(t, 0.6, 'bandpass', 500, 2600, 2, 0.2, 0.03);
      noise(t + 0.05, 0.7, 'highpass', 3800, 2500, 0.7, 0.04, 0.1);
    },
    dogfight_hit: (t) => {
      noise(t, 0.35, 'lowpass', 1600, 200, 0.7, 0.4);
      tone(t, 'sine', 90, 40, 0.28, 0.35);
      fm({ t, f: 420, ratio: 2.76, idx: 4, idx1: 0.1, dur: 0.4, g: 0.05 });
      nz({ t, dur: 0.3, flt: ['bandpass', 2400, 1000], g: 0.08, buf: 'crackle' });
    },
    ufo_crash: (t) => {
      // queda: assobio descendente em crescendo até ao impacto
      osc({ t, type: 'sawtooth', f: 1300, f1: 120, dur: 1.3, g: 0.04, a: 0.7, hold: 0.4, flt: ['lowpass', 2600, 500, 4] });
      osc({ t, f: 1300, f1: 120, dur: 1.3, g: 0.05, a: 0.7, hold: 0.4 });
      noise(t + 1.2, 1.4, 'lowpass', 700, 70, 0.7, 0.8, 0.01, 'brown');
      tone(t + 1.2, 'sine', 60, 20, 1.1, 0.7);
      noise(t + 1.2, 0.12, 'highpass', 2600, 800, 0.7, 0.25);
    },
    // teletipo + acorde menor curto (o stinger «monthly» é a versão musical longa)
    monthly_report: (t) => {
      for (let i = 0; i < 10; i++) noise(t + i * 0.045 + rnd() * 0.01, 0.015, 'bandpass', 2600, 0, 3, 0.04);
      const s = t + 0.5;
      for (const m of [50, 53, 57]) brass(s, mtof(m), 0.16, 0.03);
      for (const m of [50, 53, 57, 62]) brass(s + 0.2, mtof(m), 0.7, 0.026, { hold: 0.2 });
      tone(s, 'sine', 98, 60, 0.3, 0.1);
    },

    // estratégia: naves, alarmes, base, finanças
    // rugido de reator (~2 s): a interceção repete-o a cada 1,7 s e as rampas lineares cruzam-se sem buraco
    dogfight_engine: (t) => group(t, 2.1, 0.3, 0.5, 0.6, () => {
      nz({ t, dur: 2.15, flt: ['lowpass', 480, 380, 0.9], g: 0.3, a: 0.02, hold: 2.2, buf: 'brown' });
      nz({ t, dur: 2.15, flt: ['bandpass', 950, 1150, 0.8], g: 0.045, a: 0.02, hold: 2.2 });
      osc({ t, type: 'sawtooth', f: 47, dur: 2.15, g: 0.05, a: 0.02, hold: 2.2, trem: [7.5, 0.4], flt: ['lowpass', 170] });
      osc({ t, f: 2330, f1: 2410, dur: 2.15, g: 0.006, a: 0.02, hold: 2.2, vib: [5, 9] });
    }),
    craft_takeoff: (t) => {
      tone(t, 'sine', 110, 60, 0.14, 0.12);
      noise(t, 0.3, 'highpass', 3000, 1500, 0.7, 0.05, 0.01);
      const s = t + 0.08;
      group(s, 2.4, 0.6, 0.9, 0.7, () => {
        nz({ t: s, dur: 2.45, flt: ['lowpass', 220, 1400, 0.9], g: 0.3, a: 0.02, hold: 2.5, buf: 'brown' });
        nz({ t: s, dur: 2.45, flt: ['bandpass', 500, 2600, 1], g: 0.06, a: 0.02, hold: 2.5 });
        osc({ t: s, f: 700, f1: 2600, glide: 1.6, dur: 2.45, g: 0.01, a: 0.02, hold: 2.5 });
        osc({ t: s, type: 'sawtooth', f: 42, f1: 70, glide: 1.4, dur: 2.45, g: 0.05, a: 0.02, hold: 2.5, flt: ['lowpass', 200] });
      });
    },
    craft_landing: (t) => {
      group(t, 1.9, 0.25, 0.9, 0.8, () => {
        nz({ t, dur: 1.95, flt: ['lowpass', 1300, 260, 0.9], g: 0.28, a: 0.02, hold: 2, buf: 'brown' });
        nz({ t, dur: 1.95, flt: ['bandpass', 2200, 500, 1], g: 0.055, a: 0.02, hold: 2 });
        osc({ t, f: 2500, f1: 650, dur: 1.95, g: 0.01, a: 0.02, hold: 2 });
      });
      tone(t + 1.55, 'sine', 95, 45, 0.3, 0.2);
      noise(t + 1.55, 0.15, 'lowpass', 600, 200, 0.8, 0.12, 0.004, 'brown');
      noise(t + 1.7, 0.5, 'highpass', 3200, 2200, 0.7, 0.04, 0.03);
    },
    // sirene de defesa civil (sobe, mantém, desce) com eco tardio da cidade
    terror_siren: (t) => group(t, 3.2, 0.35, 0.9, 1, () => {
      const pts = [[0, 330], [1.1, 700], [1.8, 700], [3.2, 360]];
      glide(t, 'sawtooth', pts, 3.25, 0.045, ['lowpass', 2200], 0, [6, 4]);
      glide(t, 'sawtooth', pts, 3.25, 0.03, ['lowpass', 1400], 11);
      glide(t + 0.14, 'triangle', pts, 3.1, 0.02, ['lowpass', 1100]);
    }),
    // klaxon de base sob ataque: dois «whoop»
    base_alarm: (t) => {
      for (let i = 0; i < 2; i++) {
        const s = t + i * 0.8;
        group(s, 0.7, 0.03, 0.12, 1, () => {
          glide(s, 'square', [[0, 300], [0.55, 760], [0.72, 780]], 0.72, 0.03, ['lowpass', 2000]);
          glide(s, 'sawtooth', [[0, 302], [0.55, 765], [0.72, 785]], 0.72, 0.022, ['lowpass', 1600]);
        });
      }
    },
    // sinal perdido: ecos de radar a esmorecer em estática
    ufo_lost: (t) => {
      for (const [d, f, g] of [[0, 1500, 0.05], [0.28, 1180, 0.032], [0.56, 900, 0.02]]) tone(t + d, 'sine', f, f * 0.98, 0.5, g, 0.004);
      nz({ t: t + 0.1, dur: 1.2, flt: ['bandpass', 2600, 1800, 1.2], g: 0.06, a: 0.3, buf: 'crackle' });
      osc({ t: t + 0.6, type: 'sawtooth', f: 330, f1: 160, dur: 0.7, g: 0.018, a: 0.05, flt: ['lowpass', 900] });
    },
    ufo_landed: (t) => {
      fm({ t, f: 73.4, f1: 55, ratio: 1.5, idx: 2.5, idx1: 0.3, dur: 1.6, g: 0.1, a: 0.2, vib: [5, 2] });
      tone(t, 'sine', 1200, 1180, 0.5, 0.03);
      tone(t + 0.25, 'sine', 900, 880, 0.6, 0.02);
      noise(t + 0.1, 1.2, 'bandpass', 300, 160, 2, 0.06, 0.4, 'brown');
    },
    // obra: pancada, três golpes de metal e um berbequim
    base_build: (t) => {
      noise(t, 0.12, 'lowpass', 900, 200, 0.8, 0.2, 0.004, 'brown');
      tone(t, 'sine', 120, 55, 0.18, 0.18);
      for (const [d, f] of [[0.18, 420], [0.42, 520], [0.62, 380]]) {
        fm({ t: t + d, f, ratio: 1.41, idx: 3, idx1: 0.1, dur: 0.35, g: 0.035 });
        noise(t + d, 0.03, 'bandpass', 2800, 0, 3, 0.05);
      }
      osc({ t: t + 0.8, type: 'sawtooth', f: 170, f1: 250, dur: 0.5, g: 0.03, trem: [32, 0.8], flt: ['lowpass', 1400] });
      nz({ t: t + 0.8, dur: 0.5, flt: ['bandpass', 2400, 3000, 1], g: 0.05, buf: 'crackle' });
    },
    facility_done: (t) => {
      noise(t, 0.08, 'lowpass', 700, 200, 0.8, 0.16, 0.004, 'brown');
      tone(t, 'sine', 140, 70, 0.12, 0.14);
      noise(t + 0.05, 0.4, 'highpass', 3600, 1600, 0.7, 0.05, 0.02);
      tone(t + 0.3, 'triangle', 659, 0, 0.16, 0.06);
      tone(t + 0.42, 'triangle', 988, 0, 0.3, 0.06);
      bell(t + 0.42, 1976, 0.9, 0.02);
    },
    // receita: clique de caixa, moedas e dois sinos claros
    funds_in: (t) => {
      noise(t, 0.03, 'bandpass', 3000, 0, 2, 0.06);
      tone(t, 'square', 180, 90, 0.05, 0.03);
      nz({ t: t + 0.04, dur: 0.18, flt: ['bandpass', 5000, 4000, 2], g: 0.08, buf: 'crackle' });
      fm({ t: t + 0.1, f: 2637, ratio: 2.01, idx: 2, idx1: 0.05, dur: 0.8, g: 0.035 });
      fm({ t: t + 0.18, f: 3520, ratio: 2.01, idx: 2, idx1: 0.05, dur: 0.9, g: 0.03 });
    },
    // conselho insatisfeito: acorde menor com segunda menor, tímpano e teletipo
    council_bad: (t) => {
      for (const m of [45, 46, 52]) brass(t, mtof(m), 1.3, 0.035, { a: 0.03, lo: 250, hi: 1500, hold: 0.25 });
      timp(t, 55, 1.0, 0.16);
      osc({ t: t + 0.35, type: 'sawtooth', f: mtof(57), f1: mtof(52), dur: 1.2, g: 0.02, a: 0.08, flt: ['lowpass', 1200, 500] });
      for (let i = 0; i < 6; i++) noise(t + 0.9 + i * 0.05, 0.015, 'bandpass', 2600, 0, 3, 0.025);
    },
    council_good: (t) => {
      for (const [m, d] of [[62, 0], [66, 0.1], [69, 0.2]]) brass(t + d, mtof(m), 0.9 - d, 0.032, { a: 0.02, hold: 0.2, hi: 2400 });
      timp(t, 73.4, 0.6, 0.12);
      bell(t + 0.25, mtof(86), 1.1, 0.02);
    },
    // interrogatório: monitor, oscilação psiónica e voz alienígena
    interrogation: (t) => {
      tone(t, 'sine', 1046, 0, 0.07, 0.035);
      tone(t + 0.35, 'sine', 1046, 0, 0.07, 0.035);
      fm({ t: t + 0.1, f: 165, f1: 220, ratio: 1.5, idx: 4, idx1: 7, dur: 1.8, g: 0.045, a: 0.5, vib: [5.5, 12] });
      formant({ t: t + 0.4, f: 260, f1: 180, dur: 1.4, g: 0.06, a: 0.25, vib: [7, 14], forms: [[700, 500, 7, 1], [1600, 2100, 9, 0.6]] });
      nz({ t: t + 0.2, dur: 1.6, flt: ['highpass', 3500], g: 0.03, a: 0.4, buf: 'crackle' });
    },
    // gravação automática: discreto, quase subliminar
    autosave: (t) => {
      tone(t, 'sine', 1318.5, 0, 0.12, 0.016);
      tone(t + 0.09, 'sine', 1760, 0, 0.2, 0.012);
      noise(t, 0.05, 'bandpass', 4200, 0, 3, 0.008);
    },
    purchase: (t) => {
      osc({ t, type: 'square', f: 880, dur: 0.05, g: 0.03, flt: ['lowpass', 3000] });
      osc({ t: t + 0.05, type: 'square', f: 1320, dur: 0.09, g: 0.03, flt: ['lowpass', 3000] });
      noise(t + 0.04, 0.06, 'bandpass', 3500, 2500, 2, 0.04);
    },

    // ritmo de turnos
    end_turn: (t) => {
      fm({ t, f: 110, ratio: 1.4, idx: 3, idx1: 0.1, dur: 1.1, g: 0.08 });
      noise(t, 0.5, 'lowpass', 300, 1400, 1, 0.05, 0.2);
      tone(t, 'sine', 220, 110, 0.35, 0.08);
    },
    hidden_movement: (t) => {
      osc({ t, f: 55, dur: 1.2, g: 0.14, a: 0.35 });
      osc({ t, type: 'sawtooth', f: 110, dur: 1.1, g: 0.03, a: 0.3, flt: ['lowpass', 260, 420] });
      osc({ t, type: 'sawtooth', f: 111.6, dur: 1.1, g: 0.03, a: 0.3, flt: ['lowpass', 260, 420] });
      noise(t, 1.0, 'bandpass', 2800, 2200, 5, 0.018, 0.4);
    },
  };

  SFX.siren = SFX.terror_siren; // nome usado pelos alertas do Geoscape

  // intervalo mínimo entre repetições do mesmo efeito (s); por omissão 25 ms
  const MIN_GAP = {
    ui_click: 0.03, ui_select: 0.05, ui_confirm: 0.06, ui_deny: 0.15,
    step_earth: 0.07, step_wood: 0.07, step_metal: 0.07, step_alloy: 0.07, kneel: 0.1,
    pistol: 0.04, rifle: 0.04, rifle_auto: 0.035, auto_cannon: 0.05, heavy_cannon: 0.1, laser: 0.05, plasma: 0.06,
    bounce: 0.05, explosion_small: 0.06, explosion_large: 0.12, fire_loop_tick: 0.1, glass_break: 0.05, wall_crumble: 0.08,
    soldier_hit: 0.05, soldier_death: 0.08, chryssalid_skitter: 0.2,
    alien_spotted: 0.4, reaction_alert: 0.3, hidden_movement: 1.2, end_turn: 0.5,
    ufo_detected: 1.0, radar_ping: 0.4, research_done: 0.5, production_done: 0.5, monthly_report: 1.0,
    dogfight_cannon: 0.06, dogfight_hit: 0.06, ufo_crash: 1.0,
    dogfight_engine: 1.0, craft_takeoff: 0.8, craft_landing: 0.8, terror_siren: 2.5, siren: 2.5, base_alarm: 1.5,
    ufo_lost: 1.0, ufo_landed: 1.0, base_build: 0.3, facility_done: 0.5, funds_in: 0.5, council_bad: 1.0,
    council_good: 1.0, interrogation: 1.0, autosave: 2.0, purchase: 0.06,
  };
  // variação aleatória de altura (fração) para não soar a «metralhadora de amostras»
  const VARY = {
    ui_click: 0.02, step_earth: 0.07, step_wood: 0.07, step_metal: 0.06, step_alloy: 0.06, kneel: 0.08,
    pistol: 0.035, rifle: 0.035, rifle_auto: 0.04, auto_cannon: 0.035, heavy_cannon: 0.025, laser: 0.03, plasma: 0.03,
    throw: 0.08, bounce: 0.08, explosion_small: 0.06, explosion_large: 0.04, fire_loop_tick: 0.1,
    glass_break: 0.05, wall_crumble: 0.05, soldier_hit: 0.06, soldier_death: 0.04, chryssalid_skitter: 0.06,
    dogfight_cannon: 0.03, dogfight_hit: 0.05, dogfight_engine: 0.02, craft_takeoff: 0.03, craft_landing: 0.03,
    base_build: 0.04, purchase: 0.02,
  };
  for (const k in SFX) if (k.startsWith('alien_death_')) VARY[k] = 0.05;
  // baixar a música sob alertas: [nível, duração s]
  const DUCK = {
    alien_spotted: [0.35, 0.5], ufo_detected: [0.5, 0.8], explosion_large: [0.6, 0.6],
    ufo_crash: [0.5, 2.0], monthly_report: [0.4, 1.4], research_done: [0.6, 1.0],
    terror_siren: [0.45, 3.0], siren: [0.45, 3.0], base_alarm: [0.45, 1.8], council_bad: [0.5, 1.6],
    interrogation: [0.6, 1.8], funds_in: [0.7, 0.8], facility_done: [0.7, 0.8],
  };

  function duck(level, hold, release) {
    if (!A.moodMix) return;
    const c = A.ctx, now = c.currentTime;
    if (now < A.duckUntil) {
      level = Math.min(level, A.duckLevel);
      hold = Math.max(hold, A.duckUntil - now);
    }
    A.duckLevel = level;
    A.duckUntil = now + hold;
    const p = A.moodMix.gain;
    try {
      const v = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
      p.setTargetAtTime(level, now, 0.04);
      p.setTargetAtTime(1, now + hold, (release || 0.9) / 3);
    } catch (e) { /* ignora */ }
  }

  function play(name, opts) {
    const fn = SFX[name];
    if (!fn || !A.ctx || !audible() || A.ctx.state !== 'running') return false;
    const c = A.ctx, now = c.currentTime;
    const prev = A.last[name];
    if (prev !== undefined && now - prev < (MIN_GAP[name] || 0.025)) return false;
    if (A.voices >= MAX_VOICES) return false;
    const o = opts || {};
    const vol = o.vol === undefined ? 1 : clamp(num(+o.vol, 0), 0, 1);
    if (vol < 0.02) return false;
    const vary = VARY[name] || 0;
    const rate = clamp((o.rate > 0 ? o.rate : 1) * (1 + (rnd() * 2 - 1) * vary), 0.25, 4);
    const t = now + 0.005 + clamp(num(+o.delay, 0), 0, 2);
    let dest = null, pan = null, end = t;
    try {
      dest = c.createGain();
      dest.gain.value = vol;
      const p = clamp(num(+o.pan, 0), -1, 1);
      if (p && c.createStereoPanner) {
        pan = c.createStereoPanner();
        pan.pan.value = p;
        dest.connect(pan);
        pan.connect(A.sfx);
      } else dest.connect(A.sfx);
      cur = { dest, r: rate, end: t };
      fn(t);
      end = cur.end;
    } catch (e) {
      /* nó de áudio indisponível — o efeito fica (parcialmente) mudo */
    }
    cur = null;
    A.last[name] = now;
    A.voices++;
    setTimeout(() => {
      A.voices = Math.max(0, A.voices - 1);
      try {
        if (dest) dest.disconnect();
        if (pan) pan.disconnect();
      } catch (e) { /* ignora */ }
    }, Math.max(0.05, end - now) * 1000 + 120);
    if (DUCK[name]) duck(DUCK[name][0], DUCK[name][1]);
    return true;
  }

  // ------------------------------------------------------------------ música generativa
  function drone(m, f, g, cutoff, type) {
    const c = A.ctx, t = c.currentTime + 0.05;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 1.5;
    const lo = c.createOscillator(), lg = c.createGain();
    lo.frequency.value = 0.07 + rnd() * 0.04;
    lg.gain.value = cutoff * 0.45;
    lo.connect(lg);
    lg.connect(lp.frequency);
    const ge = c.createGain();
    ge.gain.value = 0.0001;
    ge.gain.setValueAtTime(0.0001, t);
    ge.gain.exponentialRampToValueAtTime(g, t + 2.5);
    lp.connect(ge);
    ge.connect(m.bus);
    const nodes = [lo];
    for (const det of [-6, 5]) {
      const o = c.createOscillator();
      o.type = type || 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      nodes.push(o);
    }
    for (const n of nodes) n.start(t);
    m.nodes.push(...nodes);
  }

  // leito de ruído contínuo (ar, vento, zumbido) filtrado; ruído branco em ciclo não tem costura audível
  function bed(m, type, f, q, g) {
    const c = A.ctx, t = c.currentTime + 0.05;
    const s = c.createBufferSource();
    s.buffer = A.buf.white;
    s.loop = true;
    const f1 = c.createBiquadFilter();
    f1.type = type;
    f1.frequency.value = f;
    f1.Q.value = q;
    const ge = c.createGain();
    ge.gain.value = 0.0001;
    ge.gain.setValueAtTime(0.0001, t);
    ge.gain.exponentialRampToValueAtTime(g, t + 3);
    s.connect(f1);
    f1.connect(ge);
    ge.connect(m.bus);
    s.start(t, rnd() * (s.buffer.duration - 0.1));
    m.nodes.push(s);
  }

  const pad = (t, notes, dur, g, cutoff, a, hold) => {
    for (const n of notes) osc({ t, type: 'sawtooth', f: mtof(n), dur, g, a, hold, det: rnd() * 8 - 4, flt: ['lowpass', cutoff] });
  };

  const MENU_CH = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
  const GEO_CH = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]];
  const TOM = [0, 3, 6, 10, 12];
  const TERROR_BASS = [40, 41, 40, 43, 40, 41, 40, 46, 40, 41, 40, 43, 40, 44, 43, 41];
  const TERROR_SHIFT = [0, 0, 1, -2];
  const INT_CH = [[52, 55, 59], [52, 55, 59], [48, 52, 55], [50, 54, 57]];
  const BASE_CH = [[53, 57, 60, 64], [48, 52, 55, 59], [50, 53, 57, 60], [46, 50, 53, 57]];
  const BASE_ARP = [0, 1, 2, 3, 2, 1, 0, 2];
  const RES_CH = [[57, 60, 64, 71], [53, 57, 60, 64], [48, 52, 55, 59], [52, 55, 59, 62]];
  const RES_STEPS = [0, 3, 6, 8, 11, 14];
  const CYD_CH = [[48, 51, 55], [49, 53, 56], [46, 49, 53], [48, 51, 55]];
  const CYD_OST = [0, 12, 0, 7, 0, 12, 1, 0];
  const VIC_CH = [[62, 66, 69], [55, 59, 62], [59, 62, 66], [57, 61, 64], [62, 66, 69], [52, 55, 59], [55, 59, 62], [57, 61, 64]];
  const VIC_MEL = [[0, 2], [6, 1], [8, 0], [12, 1]];
  const DEF_CH = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
  const tenseOn = (m) => m.tenseOn || A.ctx.currentTime < m.tenseUntil;

  const MOODS = {
    // menu: ré menor lento, pad sombrio e sinos esparsos com eco
    menu: {
      bpm: 58,
      start: (m) => drone(m, mtof(38), 0.03, 260, 'triangle'),
      step(m, t, s, bar, spb) {
        const ch = MENU_CH[bar % 4];
        if (s === 0) {
          pad(t, ch, spb * 17, 0.022, 700, 0.9, spb * 8);
          osc({ t, f: mtof(ch[0] - 12), dur: spb * 16, g: 0.09, a: 0.5, hold: spb * 8 });
        }
        if ((s === 0 || s === 6 || s === 10 || s === 12) && rnd() < 0.55) {
          const n = ch[(rnd() * 3) | 0] + 24;
          bell(t, mtof(n), 2.2, 0.03, 2);
          bell(t + spb * 3, mtof(n), 1.6, 0.012, 2);
        }
      },
    },
    // Geoscape: lá menor a 70 BPM, pad a pulsar por tempo e arpejo de sino esparso
    geoscape: {
      bpm: 70,
      start: (m) => drone(m, mtof(45), 0.035, 300, 'triangle'),
      step(m, t, s, bar, spb) {
        const ch = GEO_CH[bar % 4];
        if (s % 4 === 0) pad(t, ch, spb * 3.6, s === 0 ? 0.016 : 0.011, 900, 0.06);
        if (s === 0) osc({ t, type: 'triangle', f: mtof(ch[0] - 24), dur: spb * 16, g: 0.08, a: 0.2, hold: spb * 10 });
        if (s % 2 === 0 && rnd() < 0.24) bell(t, mtof(ch[(rnd() * 3) | 0] + (rnd() < 0.5 ? 12 : 24)), 1.8, 0.028, 2);
        if (bar % 4 === 3 && s === 8) osc({ t, f: 1760, f1: 1740, dur: 1.6, g: 0.012 });
      },
    },
    // Battlescape: drone grave, golpes metálicos irregulares; camada de intensidade com aliens à vista
    battle: {
      bpm: 76,
      start: (m) => drone(m, mtof(38), 0.05, 240),
      step(m, t, s, bar, spb) {
        if ((bar % 2 === 0 && (s === 0 || s === 3)) || (bar % 2 === 1 && s === 0)) osc({ t, f: 68, f1: 40, dur: 0.3, g: 0.12 });
        if (s !== m.lastHit + 1 && rnd() < 0.075) {
          m.lastHit = s;
          fm({ t, f: pick([147, 156, 208, 233, 311]), ratio: pick([1.41, 2.76, 3.17]), idx: 5, idx1: 0.05, dur: 1.4, g: 0.035 });
        }
        if (s === 0 && bar % 2 === 0) pad(t, [50, 51], spb * 32, 0.012, 480, 1.2, spb * 14);
        if (s === 8 && bar % 4 === 2) osc({ t, f: 1180, f1: 1130, dur: 2.4, g: 0.01, a: 1.0 });
        if (tenseOn(m)) {
          into(m.layer, () => {
            if (s % 2 === 0) noise(t, 0.035, 'highpass', 7000, 0, 0.7, s % 4 === 0 ? 0.035 : 0.02);
            if (TOM.includes(s)) osc({ t, f: 98, f1: 52, dur: 0.2, g: 0.13 });
            if (s % 2 === 0) for (const n of [62, 63]) osc({ t, type: 'sawtooth', f: mtof(n + (bar % 4 === 3 ? 5 : 0)), dur: spb * 1.8, g: 0.009, flt: ['lowpass', 1600] });
            if (s === 0) osc({ t, type: 'sawtooth', f: mtof(38), dur: spb * 15, g: 0.04, a: 0.03, flt: ['lowpass', 300, 160] });
          });
        }
      },
    },
    // terror: ostinato frígio rápido, bateria irregular e acordes dissonantes
    terror: {
      bpm: 118,
      start: (m) => drone(m, mtof(40), 0.045, 220),
      step(m, t, s, bar, spb) {
        const k = TERROR_SHIFT[bar % 4];
        osc({ t, type: 'sawtooth', f: mtof(TERROR_BASS[s] + k), dur: spb * 0.9, g: s % 4 === 0 ? 0.075 : 0.05, a: 0.004, flt: ['lowpass', 620, 260, 3] });
        if (s === 0 || s === 6 || s === 8 || s === 11) osc({ t, f: 130, f1: 42, dur: 0.18, g: 0.3 });
        if (s === 4 || s === 12) noise(t, 0.12, 'bandpass', 1900, 1400, 1, 0.1);
        if (s % 2 === 1) noise(t, 0.025, 'highpass', 8000, 0, 0.7, 0.025);
        if (bar % 2 === 1 && s === 14) for (const n of [64, 65, 70]) brass(t, mtof(n + k), 0.18, 0.025, { a: 0.006 });
        if (s === 0 && bar % 4 === 0) pad(t, [52, 53], spb * 30, 0.012, 600, 0.8, spb * 12);
        if (rnd() < 0.04) fm({ t, f: pick([311, 330, 466]), ratio: 2.76, idx: 4, idx1: 0.05, dur: 1, g: 0.025 });
      },
    },
    // interceção: mi menor a 128 BPM, baixo pulsante em colcheias; frases de 4 compassos
    // (base → arpejo → metais → pausa com subida de ruído) para não cansar
    interception: {
      bpm: 128,
      start: (m) => drone(m, mtof(40), 0.03, 220),
      step(m, t, s, bar, spb) {
        const ch = INT_CH[bar % 4], root = ch[0] - 12, sec = (bar >> 2) % 4;
        if (s % 2 === 0) osc({ t, type: 'sawtooth', f: mtof(root + (s % 8 === 6 ? 12 : 0)), dur: spb * 1.7, g: s % 4 === 0 ? 0.055 : 0.04, a: 0.004, flt: ['lowpass', 900, 260, 4] });
        if (sec !== 3 && (s === 0 || s === 8 || (s === 10 && bar % 2 === 1))) osc({ t, f: 120, f1: 44, dur: 0.2, g: 0.2 });
        if (s === 4 || s === 12) noise(t, 0.11, 'bandpass', 1800, 1200, 1, sec === 3 ? 0.035 : 0.065);
        if (s % 2 === 1) noise(t, 0.03, 'highpass', 7500, 0, 0.7, s % 4 === 3 ? 0.018 : 0.011);
        if ((sec === 1 || sec === 2) && s % 2 === 0) {
          const i = s >> 1;
          osc({ t, type: 'square', f: mtof(ch[i % 3] + 12 * (1 + (((i / 3) | 0) % 2))), dur: spb * 1.4, g: 0.009, a: 0.003, flt: ['lowpass', 2400, 1200] });
        }
        if (sec === 2 && bar % 2 === 1 && (s === 0 || s === 3 || s === 6)) for (const n of ch) brass(t, mtof(n), 0.16, 0.016, { a: 0.006, lo: 400, hi: 2600 });
        if (s === 0) pad(t, ch, spb * 17, 0.007, 700, 0.5, spb * 8);
        if (bar % 4 === 3 && s === 14 && sec !== 3) osc({ t, f: 1760, f1: 1740, dur: 0.9, g: 0.01 });
        if (sec === 3 && bar % 4 === 3 && s === 0) nz({ t, dur: spb * 16, flt: ['bandpass', 400, 3200, 2], g: 0.03, a: spb * 14 });
      },
    },
    // Basescape: zumbido subterrâneo, piano elétrico em arpejo suave (fá lídio), máquinas ao longe
    base: {
      bpm: 84,
      start: (m) => {
        drone(m, mtof(31), 0.035, 170, 'triangle');
        bed(m, 'lowpass', 240, 0.7, 0.012);
      },
      step(m, t, s, bar, spb) {
        const ch = BASE_CH[(bar >> 1) % 4], sec = (bar >> 3) % 2;
        if (s === 0 && bar % 2 === 0) {
          pad(t, ch.slice(0, 3), spb * 33, 0.007, 650, 1.6, spb * 16);
          osc({ t, type: 'triangle', f: mtof(ch[0] - 24), dur: spb * 30, g: 0.065, a: 0.6, hold: spb * 16 });
        }
        if (s % 2 === 0 && (sec === 0 || s % 4 === 0) && rnd() > 0.12) {
          fm({ t, f: mtof(ch[BASE_ARP[(s >> 1) % 8]] + 12), ratio: 2, idx: 1.1, idx1: 0.1, dur: spb * 5, g: 0.017 });
        }
        if (s === 4 || s === 12) noise(t, 0.05, 'lowpass', 320, 160, 0.8, 0.04, 0.004, 'brown');
        if (s === 6 && bar % 2 === 1) fm({ t, f: pick([210, 236, 280]), ratio: 2.76, idx: 3, idx1: 0.05, dur: 0.9, g: 0.008, flt: ['lowpass', 1500] });
        if (s === 12 && bar % 4 === 2) nz({ t, dur: 0.7, flt: ['bandpass', 3500, 2500, 1.5], g: 0.006, a: 0.08 });
        if (sec === 1 && (s === 0 || s === 10) && rnd() < 0.5) bell(t, mtof(ch[(rnd() * 4) | 0] + 24), 2, 0.014, 2);
      },
    },
    // investigação: lá menor contemplativo, arpejo de vidro esparso com eco e filtro do pad a respirar
    research: {
      bpm: 66,
      start: (m) => drone(m, mtof(33), 0.028, 240, 'triangle'),
      step(m, t, s, bar, spb) {
        const ch = RES_CH[bar % 4];
        if (s === 0) {
          pad(t, ch.slice(0, 3), spb * 18, 0.009, (bar >> 2) % 2 ? 900 : 600, 1.0, spb * 8);
          osc({ t, f: mtof(ch[0] - 24), dur: spb * 16, g: 0.07, a: 0.4, hold: spb * 8 });
        }
        const i = RES_STEPS.indexOf(s);
        if (i >= 0 && rnd() < 0.62) {
          const f = mtof(ch[i % 4] + 12 + (i >= 4 ? 12 : 0));
          bell(t, f, 1.4, 0.014, 3.01);
          bell(t + spb * 3, f, 1.0, 0.005, 3.01);
        }
        if ((s === 4 || s === 12) && bar % 2 === 1) osc({ t, f: 2093, dur: 0.06, g: 0.005 });
        if (s === 8 && bar % 4 === 2) osc({ t, type: 'triangle', f: mtof(ch[3]), dur: spb * 10, g: 0.02, a: 0.5, hold: spb * 3, vib: [4.5, 3] });
      },
    },
    // base alienígena: orgânico e estranho — batimento grave, respiração filtrada, gotas, gemidos formantes
    alien_base: {
      bpm: 60,
      start: (m) => {
        drone(m, mtof(37), 0.035, 200);
        drone(m, mtof(38), 0.02, 160, 'triangle');
      },
      step(m, t, s, bar, spb) {
        if (s === 0 || s === 3) osc({ t, f: s ? 52 : 60, f1: 34, dur: 0.28, g: s ? 0.08 : 0.12 });
        if (s === 0 && bar % 2 === 0) nz({ t, dur: spb * 30, flt: ['bandpass', 380, 900, 3], g: 0.02, a: spb * 12, hold: spb * 2 });
        if (rnd() < 0.06) osc({ t, f: 1400 + rnd() * 900, f1: 500, dur: 0.07, g: 0.01 });
        if (s === 8 && bar % 4 === 1) formant({ t, f: mtof(pick([44, 49, 50])), f1: mtof(46), dur: spb * 22, g: 0.035, a: 0.9, vib: [3.3, 4], forms: [[500, 700, 6, 1], [1100, 900, 8, 0.5]] });
        if (s === 0 && bar % 4 === 0) pad(t, [49, 50, 56], spb * 64, 0.006, 420, 2.5, spb * 30);
        if (s === 12 && bar % 2 === 1 && rnd() < 0.6) fm({ t, f: pick([185, 196, 277]), ratio: 1.41, idx: 4, idx1: 0.05, dur: 2.2, g: 0.011, flt: ['lowpass', 1400] });
        if (tenseOn(m)) {
          into(m.layer, () => {
            if (s === 8 || s === 11) osc({ t, f: s === 8 ? 60 : 52, f1: 34, dur: 0.24, g: 0.09 });
            if (s % 2 === 1) nz({ t, dur: 0.05, flt: ['bandpass', 3200, 2600, 3], g: 0.06, buf: 'crackle' });
            if (s === 0) for (const n of [61, 62]) osc({ t, type: 'sawtooth', f: mtof(n), dur: spb * 15, g: 0.007, a: 0.4, hold: spb * 6, trem: [9, 0.6], flt: ['lowpass', 1800] });
          });
        }
      },
    },
    // Cydonia: dó frígio, ostinato grave, metais em crescendo, coro de formantes e sino fúnebre
    cydonia: {
      bpm: 72,
      start: (m) => drone(m, mtof(24), 0.045, 140),
      step(m, t, s, bar, spb) {
        const ch = CYD_CH[bar % 4], r = ch[0] - 24;
        if (s % 2 === 0) osc({ t, type: 'sawtooth', f: mtof(r + CYD_OST[s >> 1]), dur: spb * 1.8, g: s === 0 ? 0.055 : 0.038, a: 0.005, flt: ['lowpass', 500, 200, 3] });
        if (s === 0) {
          timp(t, mtof(r + 12), 0.9, 0.15);
          for (const n of ch) brass(t, mtof(n), spb * 15, 0.018, { a: spb * 6, lo: 200, hi: 1400, hold: spb * 4 });
        }
        if (s === 12 && bar % 2 === 1) {
          timp(t, mtof(r + 19), 0.4, 0.08);
          timp(t + spb * 2, mtof(r + 19), 0.4, 0.1);
        }
        if (s === 0 && bar % 2 === 0 && (bar >> 2) % 2 === 1) {
          for (const n of [ch[0] + 12, ch[2] + 12]) formant({ t, f: mtof(n), dur: spb * 30, g: 0.04, a: 1.2, hold: spb * 14, vib: [5, 2], forms: [[750, 750, 6, 1], [1150, 1150, 8, 0.6]] });
        }
        if (s === 0 && bar % 4 === 0) bell(t, mtof(r + 36), 4, 0.028, 1.41);
        if (tenseOn(m)) {
          into(m.layer, () => {
            if (s % 2 === 0 || s === 15) noise(t, 0.06, 'bandpass', 1500, 1100, 1.2, s % 4 === 0 ? 0.04 : 0.02);
            if (s === 0) for (const n of [60, 61]) osc({ t, type: 'sawtooth', f: mtof(n), dur: spb * 15, g: 0.007, a: 0.3, hold: spb * 6, trem: [11, 0.7], flt: ['lowpass', 1800] });
            if (bar % 2 === 1 && (s === 0 || s === 3 || s === 6)) for (const n of ch) brass(t, mtof(n + 12), 0.2, 0.012, { a: 0.006 });
          });
        }
      },
    },
    // vitória: hino em ré maior, metais calmos, sinos e tímpanos espaçados
    victory: {
      bpm: 76,
      start: (m) => drone(m, mtof(38), 0.02, 300, 'triangle'),
      step(m, t, s, bar, spb) {
        const ch = VIC_CH[bar % 8];
        if (s === 0) {
          pad(t, ch, spb * 17, 0.008, 1100, 0.5, spb * 8);
          osc({ t, type: 'triangle', f: mtof(ch[0] - 24), dur: spb * 16, g: 0.075, a: 0.1, hold: spb * 8 });
        }
        if (s === 0 || s === 8) for (const n of ch) brass(t, mtof(n), spb * 7.5, 0.014, { a: 0.08, hold: spb * 3, lo: 300, hi: 1800 });
        if (s % 4 === 2 && rnd() < 0.5) bell(t, mtof(ch[(s >> 2) % 3] + 24), 1.6, 0.016, 2);
        if (s === 0 && bar % 4 === 0) timp(t, mtof(ch[0] - 24), 1, 0.12);
        if ((bar >> 2) % 2 === 1) for (const [st, k] of VIC_MEL) if (s === st) osc({ t, type: 'triangle', f: mtof(ch[k] + 12), dur: spb * (st === 8 ? 4 : 2.5), g: 0.03, a: 0.02, vib: [5, 3] });
      },
    },
    // derrota: ré menor lento, pad a esmorecer, linha descendente esparsa e vento
    defeat: {
      bpm: 50,
      start: (m) => {
        drone(m, mtof(26), 0.03, 180);
        bed(m, 'bandpass', 520, 1.5, 0.01);
      },
      step(m, t, s, bar, spb) {
        const ch = DEF_CH[bar % 4];
        if (s === 0) {
          pad(t, ch, spb * 18, 0.01, 520, 1.5, spb * 8);
          osc({ t, f: mtof(ch[0] - 24), dur: spb * 16, g: 0.08, a: 0.8, hold: spb * 8 });
        }
        if (s % 4 === 0 && rnd() < 0.5) fm({ t, f: mtof(ch[2 - ((s >> 2) % 3)] + 12), ratio: 1, idx: 1.5, idx1: 0.05, dur: 2.8, g: 0.02 });
        if (s === 8 && bar % 4 === 3) bell(t, mtof(62), 3, 0.014, 1.41);
      },
    },
  };

  let serial = 0;
  function newInst(id, fadeIn) {
    const c = A.ctx, now = c.currentTime;
    const bus = c.createGain();
    bus.gain.value = 0.0001;
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.setTargetAtTime(1, now, fadeIn / 3);
    bus.connect(A.moodMix);
    const layer = c.createGain();
    layer.gain.value = 0;
    layer.connect(bus);
    const m = {
      id, def: MOODS[id], bus, layer, nodes: [], t: now + 0.06, step: 0, serial: ++serial,
      tenseOn: false, tenseUntil: 0, dying: false, dieAt: 0, lastHit: -9,
    };
    try {
      if (m.def.start) m.def.start(m);
    } catch (e) { /* drone indisponível */ }
    return m;
  }

  function setTense(m, on) {
    if (on === m.tenseOn) return;
    const now = A.ctx.currentTime;
    m.tenseOn = on;
    ramp(m.layer.gain, on ? 1 : 0, on ? 0.25 : 0.8);
    if (!on) m.tenseUntil = now + 4;
  }

  function fadeOut(m, dur) {
    m.dying = true;
    ramp(m.bus.gain, 0, dur / 4);
    m.dieAt = A.ctx.currentTime + dur + 0.2;
  }

  function killInst(m) {
    for (const n of m.nodes) {
      try { n.stop(); } catch (e) { /* já parado */ }
    }
    m.nodes.length = 0;
    try { m.bus.disconnect(); } catch (e) { /* ignora */ }
  }

  function tick() {
    if (!A.ctx) return;
    const now = A.ctx.currentTime;
    const silent = !musicAudible();
    for (let i = A.insts.length - 1; i >= 0; i--) {
      const m = A.insts[i];
      if (m.dying && now >= m.dieAt) {
        killInst(m);
        A.insts.splice(i, 1);
        continue;
      }
      // atrasado (separador em segundo plano): salta em vez de despejar notas de uma vez
      if (m.t < now - 0.08) m.t = now + 0.02;
      const spb = 60 / m.def.bpm / 4;
      while (m.t < now + LOOKAHEAD) {
        if (!silent) {
          cur = { dest: m.bus, r: 1, end: 0 };
          try {
            m.def.step(m, m.t, m.step % 16, Math.floor(m.step / 16), spb);
          } catch (e) { /* nota perdida */ }
          cur = null;
        }
        m.t += spb;
        m.step++;
      }
    }
    if (!A.insts.length && A.timer) {
      clearInterval(A.timer);
      A.timer = 0;
    }
  }

  const moodBase = (id) => (id && id.endsWith('_tense') ? id.slice(0, -6) : id);

  function switchMood(id) {
    const base = moodBase(id), tense = !!id && base !== id;
    const live = A.insts.find((m) => !m.dying);
    A.mood = id;
    if (live && base && live.id === base) {
      setTense(live, tense);
      return;
    }
    if (live) fadeOut(live, FADE);
    if (!base) return;
    const m = newInst(base, live ? FADE : 0.5);
    setTense(m, tense);
    A.insts.push(m);
    if (!A.timer) A.timer = setInterval(tick, TICK_MS);
    tick();
  }

  function music(mood) {
    const id = mood || null;
    if (id && MOOD_LIST.indexOf(id) < 0) return false;
    A.wantMood = id;
    if (!A.ctx) return true; // fica pendente até ao primeiro gesto
    try {
      switchMood(id);
    } catch (e) {
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ stingers (no barramento da música)
  const STINGERS = {
    victory: (t) => {
      for (const [m, d, len] of [[62, 0, 0.16], [66, 0.15, 0.16], [69, 0.3, 0.16], [74, 0.45, 0.3]]) brass(t + d, mtof(m), len, 0.07, { a: 0.015 });
      for (const m of [62, 66, 69, 74, 78]) brass(t + 0.75, mtof(m), 1.8, 0.05, { a: 0.03, hold: 0.6, hi: 3000 });
      timp(t, 98, 0.5);
      timp(t + 0.75, 73.4, 1.2);
      bell(t + 0.75, mtof(86), 1.6, 0.03);
      return 2.6;
    },
    defeat: (t) => {
      for (const [m, d] of [[57, 0], [53, 0.42], [50, 0.84]]) brass(t + d, mtof(m), 0.5, 0.06, { a: 0.04, lo: 250, hi: 1100 });
      for (const m of [38, 45, 50, 51]) brass(t + 1.26, mtof(m), 2.2, 0.045, { a: 0.15, lo: 200, hi: 800, hold: 0.8 });
      osc({ t: t + 1.26, f: 73.4, f1: 70, dur: 2.2, g: 0.15, a: 0.2 });
      timp(t + 1.26, 55, 1.4);
      return 3.6;
    },
    research: (t) => {
      [74, 81, 88, 90, 93].forEach((m, i) => bell(t + i * 0.11, mtof(m), 1.5, 0.075));
      for (const m of [50, 57, 64, 66]) osc({ t, type: 'sawtooth', f: mtof(m), dur: 2.2, g: 0.032, a: 0.5, hold: 0.6, flt: ['lowpass', 500, 1400] });
      return 2.4;
    },
    // fanfarra menor (ré menor, cadência suspensa em lá)
    monthly: (t) => {
      for (const [m, d, len] of [[62, 0, 0.16], [62, 0.18, 0.1], [65, 0.3, 0.16], [69, 0.48, 0.5]]) brass(t + d, mtof(m), len, 0.065, { a: 0.015 });
      for (const m of [58, 62, 65]) brass(t + 1.05, mtof(m), 0.6, 0.05, { hold: 0.2 });
      for (const m of [57, 61, 64]) brass(t + 1.7, mtof(m), 1.5, 0.05, { hold: 0.5 });
      timp(t, 73.4, 0.6);
      timp(t + 1.05, 58.3, 0.6);
      timp(t + 1.7, 55, 1.2);
      return 3.3;
    },
  };

  function stinger(name) {
    const fn = STINGERS[name];
    if (!fn || !A.ctx || !musicAudible() || A.ctx.state !== 'running') return false;
    const now = A.ctx.currentTime, key = 'stinger:' + name;
    if (A.last[key] !== undefined && now - A.last[key] < 1) return false;
    A.last[key] = now;
    let len = 2;
    cur = { dest: A.stBus, r: 1, end: now };
    try {
      len = fn(now + 0.02) || len;
    } catch (e) { /* ignora */ }
    cur = null;
    duck(0.2, len, 1.2);
    return true;
  }

  // ------------------------------------------------------------------ voz (desligada por omissão)
  let ptVoice = null, lastSpeak = 0;
  function pickVoice() {
    const ss = W.speechSynthesis;
    if (!ss) return null;
    try {
      const vs = ss.getVoices() || [];
      ptVoice = vs.find((v) => /^pt[-_]PT$/i.test(v.lang)) || vs.find((v) => /pt[-_]PT/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
    } catch (e) {
      ptVoice = null;
    }
    return ptVoice;
  }
  if (W.speechSynthesis) {
    try {
      if (W.speechSynthesis.addEventListener) W.speechSynthesis.addEventListener('voiceschanged', pickVoice);
      else W.speechSynthesis.onvoiceschanged = pickVoice;
      pickVoice();
    } catch (e) { /* ignora */ }
  }

  function speak(text) {
    const ss = W.speechSynthesis;
    if (!A.settings.voice || !audible() || !ss || !text || !W.SpeechSynthesisUtterance) return false;
    const now = Date.now();
    if (now - lastSpeak < 1500) return false;
    try {
      if (ss.speaking || ss.pending) return false;
      lastSpeak = now;
      const u = new W.SpeechSynthesisUtterance(String(text));
      u.lang = 'pt-PT';
      const v = ptVoice || pickVoice();
      if (v) u.voice = v;
      u.rate = 1.05;
      u.pitch = 0.85;
      u.volume = clamp(A.settings.volMaster, 0, 1);
      ss.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ controlo
  function init() {
    if (A.ctx) {
      resume();
      return true;
    }
    const AC = W.AudioContext || W.webkitAudioContext;
    if (!AC) return false;
    try {
      A.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        A.ctx = new AC();
      } catch (e2) {
        A.ctx = null;
        return false;
      }
    }
    try {
      build();
    } catch (e) {
      try { A.ctx.close(); } catch (e2) { /* ignora */ }
      A.ctx = null;
      return false;
    }
    apply();
    resume();
    if (A.wantMood) music(A.wantMood);
    return true;
  }

  function configure(s) {
    if (!s) return;
    const S = A.settings;
    if (s.sound !== undefined) S.sound = s.sound !== false;
    if (s.music !== undefined) S.music = s.music !== false;
    if (s.voice !== undefined) S.voice = !!s.voice;
    S.volMaster = clamp(num(s.volMaster, S.volMaster), 0, 1);
    S.volSfx = clamp(num(s.volSfx, S.volSfx), 0, 1);
    S.volMusic = clamp(num(s.volMusic, S.volMusic), 0, 1);
    if (!S.voice || !S.sound) cancelSpeech();
    apply();
  }

  function setMuted(b) {
    A.muted = !!b;
    if (A.muted) cancelSpeech();
    apply();
  }

  function stop() {
    cancelSpeech();
    A.wantMood = null;
    if (!A.ctx) return;
    A.mood = null;
    for (const m of A.insts) if (!m.dying) fadeOut(m, 0.3);
  }

  // pan/volume a partir de um ponto no ecrã (px) e do tamanho da vista: o que está fora de vista ouve-se mais baixo
  function spatial(sx, sy, vw, vh) {
    const cx = vw / 2, cy = vh / 2;
    const d = Math.hypot(sx - cx, sy - cy);
    const near = Math.max(vw, vh) * 0.55;
    const vol = d <= near ? 1 : Math.max(0.15, 1 - (d - near) / (near * 1.4));
    return { pan: clamp((sx - cx) / (vw * 0.8 || 1), -0.8, 0.8), vol };
  }

  // pico do sinal final (para QA e medidores)
  let lvBuf = null;
  function level() {
    if (!A.meter) return 0;
    try {
      if (!lvBuf) lvBuf = new Float32Array(A.meter.fftSize);
      A.meter.getFloatTimeDomainData(lvBuf);
    } catch (e) {
      return 0;
    }
    let p = 0;
    for (let i = 0; i < lvBuf.length; i++) {
      const v = lvBuf[i] < 0 ? -lvBuf[i] : lvBuf[i];
      if (v > p) p = v;
    }
    return p;
  }

  function status() {
    const live = A.insts.find((m) => !m.dying);
    return {
      state: A.ctx ? A.ctx.state : 'none',
      voices: A.voices,
      mood: A.mood,
      moodSerial: live ? live.serial : 0,
      tense: live ? live.tenseOn : false,
      insts: A.insts.length,
      scheduler: !!A.timer,
      muted: A.muted,
      hidden: A.hidden,
    };
  }

  // separador escondido: silencia e suspende o contexto (poupa CPU); retoma ao voltar
  if (DOC && DOC.addEventListener) {
    DOC.addEventListener('visibilitychange', () => {
      A.hidden = !!DOC.hidden;
      if (A.hidden) cancelSpeech();
      if (!A.ctx) return;
      apply();
      try {
        if (A.hidden && A.ctx.state === 'running') {
          const p = A.ctx.suspend();
          if (p && p.catch) p.catch(noop);
          A.suspendedByUs = true;
        } else if (!A.hidden && A.suspendedByUs) {
          A.suspendedByUs = false;
          resume();
        }
      } catch (e) { /* ignora */ }
    });
  }

  // render offline (QA): toca um efeito, ambiente ou stinger num OfflineAudioContext com o mesmo grafo
  // (compressor, barramentos) e devolve Promise<{buffer, end}> ou null. Volumes no máximo (pior caso de
  // saturação) salvo o.settings. Não toca no contexto real: o estado é trocado e reposto de forma síncrona.
  // o: {secs, sampleRate, at:[s,…] (efeitos: instantes de disparo), rate, settings:{volMaster,volSfx,volMusic}}
  const SWAP = ['ctx', 'comp', 'master', 'meter', 'sfx', 'mus', 'moodMix', 'stBus', 'buf'];
  function renderOffline(kind, name, o) {
    o = o || {};
    const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
    const known = kind === 'mood' ? MOOD_LIST.indexOf(name) >= 0 : kind === 'stinger' ? !!STINGERS[name] : !!SFX[name];
    if (!OAC || !known) return Promise.resolve(null);
    const sr = clamp(num(o.sampleRate, 44100), 8000, 96000), secs = clamp(num(o.secs, 3), 0.1, 120);
    let c;
    try {
      c = new OAC(2, Math.ceil(secs * sr), sr);
    } catch (e) {
      return Promise.resolve(null);
    }
    const keep = {}, keepCur = cur;
    for (const k of SWAP) keep[k] = A[k];
    let end = 0;
    try {
      A.ctx = c;
      build();
      const st = o.settings || {};
      A.master.gain.value = clamp(num(st.volMaster, 1), 0, 1) * SCALE.master;
      A.sfx.gain.value = clamp(num(st.volSfx, 1), 0, 1) * SCALE.sfx;
      A.mus.gain.value = clamp(num(st.volMusic, 1), 0, 1) * SCALE.music;
      if (kind === 'sfx') {
        for (const at of o.at || [0]) {
          const dest = c.createGain();
          dest.connect(A.sfx);
          const t = 0.01 + num(at, 0);
          cur = { dest, r: o.rate > 0 ? o.rate : 1, end: t };
          SFX[name](t);
          end = Math.max(end, cur.end);
        }
      } else if (kind === 'stinger') {
        cur = { dest: A.stBus, r: 1, end: 0 };
        end = 0.02 + (STINGERS[name](0.02) || 2);
        end = Math.max(end, cur.end);
      } else {
        const base = moodBase(name);
        const m = newInst(base, 0.5);
        if (base !== name) {
          m.tenseOn = true;
          m.layer.gain.value = 1;
        }
        const spb = 60 / m.def.bpm / 4;
        while (m.t < secs) {
          cur = { dest: m.bus, r: 1, end: 0 };
          m.def.step(m, m.t, m.step % 16, Math.floor(m.step / 16), spb);
          m.t += spb;
          m.step++;
        }
        end = secs;
      }
    } catch (e) {
      end = -1;
    } finally {
      cur = keepCur;
      for (const k of SWAP) A[k] = keep[k];
    }
    if (end < 0) return Promise.resolve(null);
    try {
      return c.startRendering().then((buffer) => ({ buffer, end }), () => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  OV.audio = {
    init,
    configure,
    play,
    music,
    stinger,
    setMuted,
    speak,
    stop,
    spatial,
    level,
    status,
    setVolumes: (v) => configure({ volMaster: v && v.master, volSfx: v && v.sfx, volMusic: v && v.music }),
    names: () => Object.keys(SFX),
    moods: () => MOOD_LIST.slice(),
    stingers: () => Object.keys(STINGERS),
    renderOffline,
  };
})(globalThis.OV || (globalThis.OV = {}));
