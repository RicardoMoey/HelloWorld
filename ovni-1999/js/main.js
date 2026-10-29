/* Arranque e ciclo principal: finaliza dados, liga vista/entrada, mantém o jogo corrente e desenha a pilha de cenas.
   Único sítio que guarda o estado corrente (OV.Game). Parâmetros de URL úteis: ?debug=1, ?seed=N, ?nosw=1,
   ?battle=<ufo>&night=1 (atalho de teste: batalha direta). */
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
  };
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('ovni1999.settings') || '{}'); } catch (e) { s = {}; }
    return Object.assign({}, DEFAULT_SETTINGS, s);
  }
  OV.Game.saveSettings = function () {
    try { localStorage.setItem('ovni1999.settings', JSON.stringify(OV.Game.settings)); } catch (e) { /* modo privado */ }
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
