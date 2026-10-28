/* Áudio procedimental (Web Audio API): efeitos posicionais, música generativa e voz de comando (síntese de fala) */
'use strict';
(function () {
  const CG = window.CG;

  const A = {
    ctx: null, master: null, sfx: null, mus: null, noise: null,
    sound: true, music: true, voice: true,
    last: {}, voices: 0, listener: null,
    musicOn: false, musicT: 0, step: 0, timer: 0,
  };

  A.configure = function (s) {
    A.sound = s.sound !== false;
    A.music = s.music !== false;
    A.voice = s.voice !== false;
    if (A.sfx) A.sfx.gain.value = A.sound ? 0.9 : 0;
    if (A.mus) A.mus.gain.value = A.music && A.sound ? 0.16 : 0;
    if (!A.voice && window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* ignora */ }
  };

  // criado só após um gesto do utilizador (requisito dos navegadores)
  A.init = function () {
    if (A.ctx) {
      if (A.ctx.state === 'suspended') A.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC();
    } catch (e) {
      return;
    }
    const c = A.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    A.master = c.createGain();
    A.master.gain.value = 0.7;
    A.sfx = c.createGain();
    A.mus = c.createGain();
    A.sfx.connect(comp);
    A.mus.connect(comp);
    comp.connect(A.master);
    A.master.connect(c.destination);
    const len = c.sampleRate;
    A.noise = c.createBuffer(1, len, c.sampleRate);
    const d = A.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.configure({ sound: A.sound, music: A.music, voice: A.voice });
  };

  function out(g, pan) {
    if (pan && A.ctx.createStereoPanner) {
      const p = A.ctx.createStereoPanner();
      p.pan.value = CG.clamp(pan, -1, 1);
      g.connect(p);
      p.connect(A.sfx);
    } else g.connect(A.sfx);
  }

  function noise(t, dur, type, f0, f1, q, gain, pan, attack) {
    const c = A.ctx;
    const src = c.createBufferSource();
    src.buffer = A.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q || 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    out(g, pan);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function tone(t, type, f0, f1, dur, gain, pan, attack) {
    const c = A.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    out(g, pan);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    rifle: (t, v, p) => { noise(t, 0.07, 'bandpass', 1900, 900, 1, 0.22 * v, p); tone(t, 'square', 260, 90, 0.03, 0.04 * v, p); },
    mg: (t, v, p) => noise(t, 0.05, 'bandpass', 1300, 700, 1.2, 0.2 * v, p),
    autocannon: (t, v, p) => { noise(t, 0.1, 'lowpass', 1600, 400, 0.8, 0.3 * v, p); tone(t, 'sine', 150, 60, 0.08, 0.18 * v, p); },
    flak: (t, v, p) => { noise(t, 0.09, 'bandpass', 900, 500, 1, 0.26 * v, p); },
    sniper: (t, v, p) => { noise(t, 0.04, 'highpass', 2600, 2600, 0.7, 0.35 * v, p); noise(t, 0.45, 'lowpass', 700, 200, 0.7, 0.12 * v, p); },
    grenade: (t, v, p) => tone(t, 'sine', 320, 180, 0.07, 0.14 * v, p),
    missile: (t, v, p) => noise(t, 0.5, 'bandpass', 500, 2600, 2, 0.2 * v, p, 0.03),
    rocket: (t, v, p) => noise(t, 0.38, 'bandpass', 400, 1900, 1.5, 0.22 * v, p, 0.02),
    cannon: (t, v, p) => { noise(t, 0.38, 'lowpass', 900, 160, 0.7, 0.55 * v, p); tone(t, 'sine', 95, 38, 0.3, 0.5 * v, p); },
    cannonHeavy: (t, v, p) => { noise(t, 0.5, 'lowpass', 650, 120, 0.7, 0.65 * v, p); tone(t, 'sine', 72, 28, 0.42, 0.65 * v, p); },
    howitzer: (t, v, p) => { noise(t, 0.7, 'lowpass', 500, 90, 0.7, 0.75 * v, p); tone(t, 'sine', 60, 24, 0.55, 0.75 * v, p); },
    hack: (t, v, p) => { for (let i = 0; i < 6; i++) tone(t + i * 0.035, 'square', 400 + Math.random() * 1600, 0, 0.03, 0.06 * v, p); },
    explodeSmall: (t, v, p) => { noise(t, 0.55, 'lowpass', 1000, 180, 0.7, 0.5 * v, p); tone(t, 'sine', 85, 30, 0.4, 0.4 * v, p); },
    explodeBig: (t, v, p) => { noise(t, 1.4, 'lowpass', 700, 90, 0.7, 0.85 * v, p, 0.01); tone(t, 'sine', 58, 20, 1.1, 0.8 * v, p); },
    superBlast: (t, v, p) => { noise(t, 2.8, 'lowpass', 520, 50, 0.7, 1 * v, p, 0.02); tone(t, 'sine', 44, 14, 2.2, 1 * v, p); noise(t, 0.4, 'highpass', 3000, 1200, 0.7, 0.3 * v, p); },
    infDie: (t, v, p) => noise(t, 0.12, 'lowpass', 520, 300, 1, 0.1 * v, p),
    deposit: (t, v, p) => { tone(t, 'triangle', 988, 988, 0.08, 0.08 * v, p); tone(t + 0.07, 'triangle', 1480, 1480, 0.12, 0.08 * v, p); },
    place: (t, v, p) => { tone(t, 'square', 210, 90, 0.1, 0.1 * v, p); noise(t, 0.25, 'lowpass', 500, 120, 0.7, 0.3 * v, p); },
    sell: (t, v, p) => { tone(t, 'triangle', 1320, 1320, 0.07, 0.09 * v, p); tone(t + 0.08, 'triangle', 880, 880, 0.12, 0.09 * v, p); },
    buildDone: (t, v) => { tone(t, 'triangle', 660, 660, 0.12, 0.14 * v); tone(t + 0.12, 'triangle', 990, 990, 0.2, 0.14 * v); },
    unitReady: (t, v) => { tone(t, 'triangle', 523, 523, 0.1, 0.1 * v); tone(t + 0.1, 'triangle', 784, 784, 0.16, 0.1 * v); },
    powerReady: (t, v) => { tone(t, 'sine', 440, 440, 0.12, 0.12 * v); tone(t + 0.12, 'sine', 660, 660, 0.12, 0.12 * v); tone(t + 0.24, 'sine', 880, 880, 0.25, 0.12 * v); },
    powerDown: (t, v) => tone(t, 'sawtooth', 420, 70, 0.7, 0.12 * v),
    error: (t, v) => { tone(t, 'square', 150, 150, 0.1, 0.08 * v); tone(t + 0.13, 'square', 120, 120, 0.12, 0.08 * v); },
    alarm: (t, v) => { for (let i = 0; i < 4; i++) tone(t + i * 0.16, 'sawtooth', i % 2 ? 460 : 620, 0, 0.15, 0.08 * v); },
    select: (t, v) => { tone(t, 'sine', 1250, 1600, 0.05, 0.05 * v); noise(t, 0.04, 'bandpass', 2400, 2400, 2, 0.03 * v); },
    ack: (t, v) => { tone(t, 'sine', 950, 700, 0.07, 0.05 * v); noise(t, 0.05, 'bandpass', 2000, 2000, 2, 0.02 * v); },
    click: (t, v) => tone(t, 'square', 900, 900, 0.02, 0.04 * v),
    scan: (t, v, p) => tone(t, 'sine', 300, 1400, 0.9, 0.12 * v, p, 0.05),
    emp: (t, v, p) => { tone(t, 'sine', 1600, 40, 1.1, 0.3 * v, p); noise(t, 0.9, 'bandpass', 3000, 300, 3, 0.2 * v, p); },
    orbitalCharge: (t, v, p) => tone(t, 'sine', 180, 2200, 2.5, 0.12 * v, p, 0.3),
    missileLaunch: (t, v, p) => noise(t, 2.2, 'lowpass', 300, 1400, 1, 0.3 * v, p, 0.3),
    incoming: (t, v, p) => tone(t, 'sine', 1900, 600, 0.7, 0.05 * v, p, 0.05),
    victory: (t, v) => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.16, 'triangle', f, f, 0.5, 0.14 * v)); },
    defeat: (t, v) => { [392, 311, 262, 196].forEach((f, i) => tone(t + i * 0.25, 'sawtooth', f, f * 0.98, 0.5, 0.08 * v)); },
  };
  const MIN_GAP = { rifle: 0.04, mg: 0.035, flak: 0.04, autocannon: 0.05, infDie: 0.05, explodeSmall: 0.05, deposit: 0.2, select: 0.06, ack: 0.06, incoming: 0.15 };

  A.play = function (name, x, y) {
    if (!A.ctx || !A.sound || A.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    const now = A.ctx.currentTime;
    const gap = MIN_GAP[name] || 0.025;
    if (A.last[name] && now - A.last[name] < gap) return;
    let v = 1, pan = 0;
    if (x !== undefined && A.listener) {
      const L = A.listener;
      const cx = L.x + L.vw / 2, cy = L.y + L.vh / 2;
      const d = Math.hypot(x - cx, y - cy);
      const near = Math.max(L.vw, L.vh) * 0.55;
      v = d <= near ? 1 : Math.max(0, 1 - (d - near) / (near * 1.4));
      if (v < 0.05) return;
      pan = CG.clamp((x - cx) / (L.vw * 0.8), -0.8, 0.8);
    }
    if (A.voices > 24) return;
    A.last[name] = now;
    A.voices++;
    setTimeout(() => A.voices--, 400);
    try {
      fn(now + 0.005, v, pan);
    } catch (e) {
      /* nó de áudio indisponível — ignora o efeito */
    }
  };

  // ------------------------------------------------------------- voz de comando
  let ptVoice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    ptVoice = vs.find((v) => /pt[-_]PT/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
    return ptVoice;
  }
  if (window.speechSynthesis) {
    try {
      speechSynthesis.onvoiceschanged = pickVoice;
      pickVoice();
    } catch (e) { /* ignora */ }
  }
  let lastSpeak = 0;
  A.speak = function (text) {
    if (!A.voice || !A.sound || !window.speechSynthesis || !text) return;
    const now = performance.now();
    if (now - lastSpeak < 1500) return;
    if (speechSynthesis.speaking || speechSynthesis.pending) return;
    lastSpeak = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-PT';
      if (ptVoice || pickVoice()) u.voice = ptVoice;
      u.rate = 1.08;
      u.pitch = 0.75;
      u.volume = 0.8;
      speechSynthesis.speak(u);
    } catch (e) { /* fala indisponível */ }
  };

  // ------------------------------------------------------------- música generativa (tensa, em ré menor)
  const BASS = [38, 38, 41, 38, 36, 38, 33, 36, 38, 38, 41, 43, 41, 38, 36, 33];
  const CHORDS = [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function musicTone(t, type, f, dur, gain, cutoff) {
    const c = A.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl);
    fl.connect(g);
    g.connect(A.mus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function musicNoise(t, dur, type, f, gain) {
    const c = A.ctx;
    const s = c.createBufferSource();
    s.buffer = A.noise;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(A.mus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }
  function schedule() {
    if (!A.ctx || !A.musicOn) return;
    const c = A.ctx;
    const spb = 60 / 96 / 4;
    while (A.musicT < c.currentTime + 0.15) {
      const t = A.musicT, s = A.step % 16, bar = Math.floor(A.step / 16) % 4;
      if (s === 0 || s === 6 || s === 10) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g);
        g.connect(A.mus);
        o.start(t);
        o.stop(t + 0.25);
      }
      if (s === 4 || s === 12) musicNoise(t, 0.12, 'bandpass', 1800, 0.12);
      if (s % 2 === 0) musicNoise(t, 0.03, 'highpass', 7000, 0.04);
      if (s % 2 === 0) musicTone(t, 'sawtooth', mtof(BASS[(s / 2 + bar * 8) % 16]), spb * 1.8, 0.12, 380);
      if (s === 0) for (const n of CHORDS[bar]) musicTone(t, 'sawtooth', mtof(n) * 1.003, spb * 15, 0.025, 900);
      A.musicT += spb;
      A.step++;
    }
  }
  A.startMusic = function () {
    if (!A.ctx || A.musicOn) return;
    A.musicOn = true;
    A.musicT = A.ctx.currentTime + 0.1;
    A.step = 0;
    A.timer = setInterval(schedule, 40);
  };
  A.stopMusic = function () {
    A.musicOn = false;
    if (A.timer) clearInterval(A.timer);
    A.timer = 0;
  };

  CG.audio = A;
})();
