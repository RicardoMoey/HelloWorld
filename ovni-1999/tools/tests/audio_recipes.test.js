/* Áudio em Node com um grafo Web Audio de imitação: cada efeito, ambiente e stinger agenda-se sem exceções
   (no navegador o try/catch do módulo esconderia o erro e o som ficaria mudo), sem valores inválidos que o
   navegador rejeita (NaN, rampa exponencial para ≤ 0, tempos negativos), sem fontes por parar e com custo
   de nós contido. Também cobre o mapeamento «X_tense», guardas de play() e a lista de nomes da estratégia. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'audio', 'audio.js'), 'utf8');

// ---- grafo de imitação: regista nós e problemas em vez de produzir som
function mockAudio() {
  const log = { nodes: [], problems: [], renders: 0 };
  const bad = (msg) => { if (log.problems.length < 20) log.problems.push(msg); };
  const finite = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) bad(what + ' não finito: ' + v); };
  class Param {
    constructor(v) { this.v = v; }
    get value() { return this.v; }
    set value(x) { finite(x, 'value'); this.v = x; }
    setValueAtTime(v, t) { finite(v, 'setValueAtTime'); finite(t, 'tempo'); if (t < 0) bad('tempo negativo ' + t); return this; }
    linearRampToValueAtTime(v, t) { finite(v, 'linearRamp'); finite(t, 'tempo'); return this; }
    exponentialRampToValueAtTime(v, t) {
      finite(v, 'expRamp'); finite(t, 'tempo');
      if (!(v > 0)) bad('rampa exponencial para ' + v);
      return this;
    }
    setTargetAtTime(v, t, tc) { finite(v, 'setTarget'); finite(t, 'tempo'); if (!(tc > 0)) bad('constante de tempo ' + tc); return this; }
    cancelScheduledValues() { return this; }
  }
  class Node {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; log.nodes.push(this); }
    connect(d) { if (!(d instanceof Node || d instanceof Param)) bad(this.kind + '.connect para destino inválido'); return d; }
    disconnect() {}
  }
  class Source extends Node {
    start(t, off) { finite(t === undefined ? 0 : t, 'start'); if (off !== undefined) finite(off, 'offset'); this.started = t || 0; }
    stop(t) {
      const s = t === undefined ? 0 : t;
      finite(s, 'stop');
      if (this.started === undefined) bad(this.kind + ' parado sem arrancar');
      else if (t !== undefined && s < this.started) bad(this.kind + ' para antes de arrancar');
      this.stopped = s;
    }
  }
  const buffer = (ch, len, sr) => {
    const data = [];
    for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
    return { length: len, sampleRate: sr, duration: len / sr, numberOfChannels: ch, getChannelData: (i) => data[i] };
  };
  const proto = {
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; },
    createOscillator() { const n = new Source(this, 'osc'); n.frequency = new Param(440); n.detune = new Param(0); n.type = 'sine'; return n; },
    createBufferSource() { const n = new Source(this, 'buf'); n.playbackRate = new Param(1); n.buffer = null; n.loop = false; return n; },
    createBiquadFilter() { const n = new Node(this, 'biquad'); n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); n.type = 'lowpass'; return n; },
    createDynamicsCompressor() {
      const n = new Node(this, 'comp');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
      return n;
    },
    createAnalyser() { const n = new Node(this, 'analyser'); n.fftSize = 2048; n.getFloatTimeDomainData = (a) => a.fill(0); return n; },
    createStereoPanner() { const n = new Node(this, 'pan'); n.pan = new Param(0); return n; },
    createBuffer(ch, len, sr) { return buffer(ch, len, sr); },
  };
  function OfflineAudioContext(ch, len, sr) {
    this.sampleRate = sr; this.length = len; this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(this, 'dest');
  }
  Object.assign(OfflineAudioContext.prototype, proto, {
    startRendering() { log.renders++; return Promise.resolve(buffer(2, 1, this.sampleRate)); },
  });
  function AudioContext() {
    this.sampleRate = 8000; this.currentTime = 0; this.state = 'running'; this.destination = new Node(this, 'dest');
  }
  Object.assign(AudioContext.prototype, proto, {
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    close() { return Promise.resolve(); },
  });
  // relógios inertes: o agendador e a libertação de vozes não correm sozinhos (teste síncrono e sem processos pendurados)
  const sandbox = {
    OV: {}, OfflineAudioContext, AudioContext, Math, Date, Object, Array, Float32Array, Float64Array, Promise, isFinite,
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'audio.js' });
  return { audio: sandbox.OV.audio, log };
}

module.exports = function (OV, t) {
  const STRATEGY_SFX = [
    'dogfight_engine', 'craft_takeoff', 'craft_landing', 'terror_siren', 'siren', 'base_alarm', 'ufo_lost', 'ufo_landed',
    'base_build', 'facility_done', 'research_done', 'production_done', 'funds_in', 'council_bad', 'council_good',
    'interrogation', 'autosave', 'purchase', 'ufo_detected', 'radar_ping', 'monthly_report', 'dogfight_cannon',
    'dogfight_missile', 'dogfight_hit', 'ufo_crash',
  ];
  const NEW_MOODS = ['interception', 'base', 'research', 'alien_base', 'alien_base_tense', 'cydonia', 'cydonia_tense', 'victory', 'defeat'];

  t.test('áudio: nomes da estratégia e ambientes novos expostos', () => {
    const { audio } = mockAudio();
    const names = audio.names(), moods = audio.moods();
    for (const n of STRATEGY_SFX) t.ok(names.includes(n), 'efeito em falta: ' + n);
    for (const m of NEW_MOODS) t.ok(moods.includes(m), 'ambiente em falta: ' + m);
    t.eq(new Set(names).size, names.length, 'nomes repetidos');
    for (const m of moods) if (m.endsWith('_tense')) t.ok(moods.includes(m.slice(0, -6)), 'camada sem ambiente base: ' + m);
    t.ok(typeof audio.renderOffline === 'function', 'renderOffline em falta');
  });

  t.test('áudio: cada efeito agenda-se sem erros, sem fontes por parar e com poucos nós', () => {
    const { audio, log } = mockAudio();
    for (const n of audio.names()) {
      const before = log.nodes.length, r0 = log.renders;
      for (const rate of [1, 0.6, 1.4]) audio.renderOffline('sfx', n, { secs: 1, sampleRate: 8000, rate });
      t.eq(log.renders - r0, 3, 'efeito lançou exceção: ' + n);
      t.eq(log.problems, [], 'valores inválidos em ' + n);
      const mine = log.nodes.slice(before);
      const unstopped = mine.filter((x) => (x.kind === 'osc' || x.kind === 'buf') && x.started !== undefined && x.stopped === undefined);
      // só o buffer silencioso de desbloqueio (um por grafo) fica sem stop()
      t.ok(unstopped.length <= 3 && unstopped.every((x) => x.kind === 'buf'), 'fontes por parar em ' + n + ': ' + unstopped.length);
      const perRender = (mine.length - 3 * 8) / 3; // 8 nós fixos do grafo por render
      t.ok(perRender < 90, n + ' cria demasiados nós: ' + perRender);
    }
  });

  t.test('áudio: cada ambiente agenda 40 s sem erros e com custo comparável aos de referência', () => {
    const { audio, log } = mockAudio();
    const cost = {};
    for (const m of audio.moods()) {
      const before = log.nodes.length, r0 = log.renders;
      audio.renderOffline('mood', m, { secs: 40, sampleRate: 8000 });
      t.eq(log.renders - r0, 1, 'ambiente lançou exceção: ' + m);
      t.eq(log.problems, [], 'valores inválidos em ' + m);
      cost[m] = (log.nodes.length - before) / 40;
    }
    const ref = Math.max(cost.terror, cost.battle_tense, cost.geoscape);
    for (const m of NEW_MOODS) t.ok(cost[m] < ref * 1.3, m + ': ' + cost[m].toFixed(1) + ' nós/s (referência ' + ref.toFixed(1) + ')');
    for (const s of audio.stingers()) {
      const r0 = log.renders;
      audio.renderOffline('stinger', s, { secs: 4, sampleRate: 8000 });
      t.eq(log.renders - r0, 1, 'stinger lançou exceção: ' + s);
    }
    t.eq(log.problems, [], 'valores inválidos nos stingers');
  });

  t.test('áudio: renderOffline recusa nomes desconhecidos e não toca no contexto real', () => {
    const { audio, log } = mockAudio();
    const r0 = log.renders;
    audio.renderOffline('sfx', 'nao_existe');
    audio.renderOffline('mood', 'nao_existe');
    audio.renderOffline('stinger', 'nao_existe');
    t.eq(log.renders, r0, 'nome desconhecido não devia renderizar');
    audio.renderOffline('sfx', 'ui_click', { secs: 0.5, sampleRate: 8000 });
    t.eq(audio.status().state, 'none', 'renderOffline não pode criar o contexto real');
    t.eq(audio.play('ui_click'), false, 'play antes de init devia ser ignorado');
  });

  t.test('áudio: «X_tense» reaproveita a instância de X; guardas de play()', () => {
    const { audio } = mockAudio();
    t.eq(audio.music('alien_base'), true, 'music pendente antes de init');
    t.ok(audio.init(), 'init com AudioContext de imitação');
    let st = audio.status();
    t.eq([st.state, st.mood, st.tense], ['running', 'alien_base', false]);
    const serial = st.moodSerial;
    audio.music('alien_base_tense');
    st = audio.status();
    t.eq([st.mood, st.tense, st.moodSerial], ['alien_base_tense', true, serial], 'camada sobre a mesma instância');
    audio.music('alien_base');
    st = audio.status();
    t.eq([st.tense, st.moodSerial], [false, serial], 'retirar a camada');
    audio.music('cydonia_tense');
    st = audio.status();
    t.ok(st.moodSerial !== serial && st.tense && st.mood === 'cydonia_tense', 'cydonia_tense cria instância nova com camada');
    t.eq(audio.music('nao_existe'), false);
    t.eq(audio.music('x_tense'), false, 'camada de ambiente inexistente');

    t.eq(audio.play('dogfight_engine', { vol: 0.5 }), true);
    t.eq(audio.play('dogfight_engine', { vol: 0.5 }), false, 'MIN_GAP do motor');
    t.eq(audio.play('nao_existe'), false);
    t.eq(audio.play('autosave', { vol: 0 }), false, 'vol 0 ignorado');
    audio.configure({ sound: false });
    t.eq(audio.play('funds_in'), false, 'som desligado');
    audio.configure({ sound: true });
    audio.setMuted(true);
    t.eq(audio.play('funds_in'), false, 'silenciado');
    audio.setMuted(false);
    t.eq(audio.play('funds_in'), true);
    audio.configure({ music: false });
    t.eq(audio.stinger('victory'), false, 'stinger com música desligada');
  });
};
