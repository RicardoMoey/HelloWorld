/* Arranque e ciclo principal: finaliza dados, liga vista/entrada, mantém o jogo corrente e desenha a pilha de cenas.
   Único sítio que guarda o estado corrente (OV.Game). Parâmetros de URL úteis: ?debug=1, ?seed=N, ?nosw=1,
   ?battle=<ufo>&night=1 (atalho de teste: batalha direta).
   OV.Game = {G, B, settings, debug, params, saveSettings(), applySettings(), reduceMotion() → bool}
   settings de acessibilidade: palette 'normal'|'cvd', kbCursor bool, reduceMotion 'auto'|'on'|'off', textScale 1|1.15|1.3
   (no <html>: data-palette, data-motion 'reduce'|'full' e --ui-scale). */
(function (OV) {
  'use strict';

  const params = new URLSearchParams(location.search);
  OV.Game = {
    G: null, // campanha atual
    B: null, // batalha atual
    settings: null,
    debug: params.get('debug') === '1',
    params,
  };

  const DEFAULT_SETTINGS = {
    sound: true, music: true, voice: false, volMaster: 0.8, volSfx: 0.9, volMusic: 0.5,
    speedXcom: 1, speedAlien: 2, confirmMove: 'auto', edgeScroll: false, wheel: 'level',
    instantGrenades: true, confirmEndTurn: true, hitPreview: true,
    // acessibilidade (contrato partilhado com a batalha): paleta 'normal'|'cvd', cursor de teclado no Battlescape,
    // reduzir movimento 'auto'|'on'|'off' ('auto' segue prefers-reduced-motion), escala do texto 1|1.15|1.3
    palette: 'normal', kbCursor: true, reduceMotion: 'auto', textScale: 1,
  };
  const SCALES = [1, 1.15, 1.3];
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('ovni1999.settings') || '{}'); } catch (e) { s = {}; }
    const o = Object.assign({}, DEFAULT_SETTINGS, s);
    if (o.palette !== 'cvd') o.palette = 'normal';
    if (['auto', 'on', 'off'].indexOf(o.reduceMotion) < 0) o.reduceMotion = 'auto';
    if (SCALES.indexOf(+o.textScale) < 0) o.textScale = 1;
    o.textScale = +o.textScale;
    o.kbCursor = o.kbCursor !== false;
    return o;
  }
  // movimento reduzido efetivo (opção do jogo ou, em 'auto', a preferência do sistema)
  OV.Game.reduceMotion = function () {
    const m = (OV.Game.settings && OV.Game.settings.reduceMotion) || 'auto';
    if (m === 'on') return true;
    if (m === 'off') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  // atributos no <html>: data-palette, data-motion e a variável --ui-scale (as folhas de estilo de cada área usam-nos)
  OV.Game.applySettings = function () {
    const st = OV.Game.settings || DEFAULT_SETTINGS;
    const root = document.documentElement;
    root.dataset.palette = st.palette === 'cvd' ? 'cvd' : 'normal';
    root.dataset.motion = OV.Game.reduceMotion() ? 'reduce' : 'full';
    root.style.setProperty('--ui-scale', String(SCALES.indexOf(+st.textScale) >= 0 ? +st.textScale : 1));
  };
  OV.Game.saveSettings = function () {
    try { localStorage.setItem('ovni1999.settings', JSON.stringify(OV.Game.settings)); } catch (e) { /* modo privado */ }
    OV.Game.applySettings();
    if (OV.audio && OV.audio.configure) OV.audio.configure(OV.Game.settings);
  };

  function fatal(err) {
    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.remove('hidden');
      boot.innerHTML = '<div class="boot-title">Erro ao arrancar</div><pre class="boot-err"></pre>';
      boot.querySelector('pre').textContent = String(err && err.stack ? err.stack : err);
    }
    console.error(err);
  }

  function boot() {
    if (params.get('nosw') === '1' && navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    }
    OV.Game.settings = loadSettings();
    OV.Game.applySettings();
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      const upd = () => OV.Game.applySettings();
      if (mq.addEventListener) mq.addEventListener('change', upd);
    }
    OV.Data.finalize();
    OV.View.init(document.getElementById('view'));
    OV.View.onResize((v) => OV.Scenes.resize(v));
    OV.Input.attach(OV.View.canvas, (ev) => {
      if (OV.Dom.anyModalOpen() && ev.kind !== 'keyup') return false;
      // primeiro gesto do utilizador ativa o áudio (requisito dos navegadores)
      if (OV.audio && (ev.kind === 'click' || ev.kind === 'down' || ev.kind === 'key')) OV.audio.init();
      return OV.Scenes.dispatch(ev);
    });
    document.addEventListener('pointerdown', () => { if (OV.audio) OV.audio.init(); }, { once: true });
    if (OV.audio && OV.audio.configure) OV.audio.configure(OV.Game.settings);
    document.addEventListener('visibilitychange', () => {
      const top = OV.Scenes.top();
      if (document.hidden && top && top.onHidden) top.onHidden();
      if (OV.audio && OV.audio.setMuted) OV.audio.setMuted(document.hidden);
    });
    document.getElementById('boot').classList.add('hidden');

    const start = params.get('battle') && OV.SceneDefs.quickbattle ? 'quickbattle' : 'menu';
    if (OV.SceneDefs[start]) OV.Scenes.push(start, { params });
    else fatal(new Error('Cena inicial em falta: ' + start));

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(250, now - last);
      last = now;
      try {
        OV.Scenes.think(dt);
        OV.Scenes.draw(OV.View.ctx, OV.View);
      } catch (e) {
        fatal(e);
        throw e;
      }
    }
    requestAnimationFrame(frame);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http') && params.get('nosw') !== '1') {
      navigator.serviceWorker.register('../sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { boot(); } catch (e) { fatal(e); } });
  else try { boot(); } catch (e) { fatal(e); }
})(globalThis.OV || (globalThis.OV = {}));
