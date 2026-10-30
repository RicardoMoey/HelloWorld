/* Entrada normalizada (Mac primeiro): rato, trackpad, teclado e toque → eventos para a cena do topo.
   Tipos emitidos (ev.kind):
     'hover'     {x,y}                      movimento do rato sem botões
     'leave'                                cursor saiu do canvas
     'down'      {x,y,button}               botão primário pressionado (para arrastos)
     'click'     {x,y,mods,pointerType,detail}  clique primário sem arrasto (toque curto incluído); detail 2 = 2.º de um duplo
     'dblclick'  {x,y,mods}
     'secondary' {x,y,mods}                 botão direito, ctrl+clique (Mac), toque de dois dedos, toque longo
     'dragstart'/'drag'/'dragend' {x,y,dx,dy,button,pointerType}  arrasto (dx,dy = delta do ponteiro)
     'pan'       {cx,cy}                    mover a câmara (px CSS; positivo = câmara para a direita/baixo)
     'zoom'      {factor,x,y}               zoom multiplicativo ancorado em (x,y)
     'wheelnotch'{delta,x,y}                roda de rato "clássica" (±1 por entalhe): nível ou zoom (decide a cena)
     'key'       {key,code,mods,repeat}     a cena devolve true se consumiu (preventDefault)
     'keyup'     {key,code}
   mods = {shift, alt, ctrl, meta}. A cena recebe ev e pode devolver true.
   Fora do canvas (HUD, modais): pinça/ctrl+roda dá 'zoom' e nunca amplia a página; roda sem ctrl só desloca
   listas que realmente rolam ([data-scroll] ou overflow auto/scroll); menu de contexto nativo e gestos do Safari
   bloqueados no documento inteiro. Roda: entalhe = evento isolado com wheelDeltaY múltiplo de 120 fora de uma
   rajada de trackpad; usedTrackpad liga-se com qualquer evento de trackpad e desliga-se com um entalhe. */
(function (OV) {
  'use strict';

  const isMac = /Mac|iPhone|iPad|iPod/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');
  const DRAG_PX = 5, LONG_MS = 450, DBL_MS = 320, PINCH_DEAD = 0.06;

  const I = {
    isMac,
    sink: null, // função (ev) => bool
    lastPointerType: 'mouse',
    usedTrackpad: false,
    keysDown: new Set(),
    _wheelT: -1e9, // último evento de roda
    _tpAt: -1e9, // último evento claramente de trackpad
    _streakTP: false, // a rajada atual contém eventos de trackpad
  };
  const WHEEL_STREAK_MS = 150, TP_QUIET_MS = 300;

  // classificação de um evento de roda: {notch} (entalhe de rato) ou deslocação contínua (trackpad / roda livre)
  I.classifyWheel = function (e, now) {
    const gap = now - I._wheelT;
    I._wheelT = now;
    if (gap > WHEEL_STREAK_MS) I._streakTP = false;
    const wd = e.wheelDeltaY;
    const notchLike = e.deltaMode === 1 || (e.deltaMode === 0 && e.deltaX === 0 && e.deltaY !== 0
      && typeof wd === 'number' && Math.abs(wd) >= 120 && wd % 120 === 0);
    if (!notchLike && e.deltaMode === 0) {
      I._streakTP = true;
      I._tpAt = now;
      I.usedTrackpad = true;
    }
    const notch = notchLike && (e.deltaMode === 1 || (!I._streakTP && now - I._tpAt > TP_QUIET_MS));
    // um entalhe verdadeiro: há um rato — comportamento de rato (sem confirmação, roda = nível)
    if (notch) I.usedTrackpad = false;
    return notch;
  };
  // antepassado (até ao corpo) que consegue rolar na direção pedida
  function scrollerFor(t, dx, dy) {
    for (let n = t; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const force = n.hasAttribute && n.hasAttribute('data-scroll');
      const cs = force ? null : getComputedStyle(n);
      const oy = force || /(auto|scroll)/.test(cs.overflowY), ox = !force && /(auto|scroll)/.test(cs.overflowX);
      if (Math.abs(dy) >= Math.abs(dx) && oy && n.scrollHeight > n.clientHeight + 1) return n;
      if (Math.abs(dx) > Math.abs(dy) && ox && n.scrollWidth > n.clientWidth + 1) return n;
    }
    return null;
  }
  const editable = (t) => !!t && !!t.closest && !!t.closest('input, textarea, select, [contenteditable]');

  const mods = (e) => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
  function emit(ev) {
    return I.sink ? !!I.sink(ev) : false;
  }

  I.attach = function (canvas, sink) {
    I.sink = sink;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let press = null; // ponteiro primário em curso
    const touches = new Map();
    let pinch = null;
    let lastClick = { t: 0, x: 0, y: 0 };
    let longTimer = 0;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // menu de contexto nativo (clique direito / dois dedos no trackpad) nunca aparece por cima do jogo
    window.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });

    canvas.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      I.lastPointerType = e.pointerType;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now() });
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
        if (touches.size === 2) {
          clearTimeout(longTimer);
          if (press && press.dragging) emit({ kind: 'dragend', x: p.x, y: p.y, dx: 0, dy: 0, pointerType: 'touch' });
          press = null;
          const [a, b] = [...touches.values()];
          const d0 = Math.hypot(a.x - b.x, a.y - b.y);
          pinch = { d0, d: d0, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: false, zooming: false, t0: performance.now(), raf: 0 };
          return;
        }
        if (touches.size > 2) return;
        press = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, button: 0, dragging: false, pointerType: 'touch', mods: mods(e) };
        longTimer = setTimeout(() => {
          if (press && !press.dragging) {
            emit({ kind: 'secondary', x: press.x, y: press.y, mods: press.mods, pointerType: 'touch' });
            press = null;
          }
        }, LONG_MS);
        emit({ kind: 'down', x: p.x, y: p.y, button: 0, pointerType: 'touch', mods: mods(e) });
        return;
      }
      // rato / caneta
      const secondary = e.button === 2 || (e.button === 0 && e.ctrlKey && isMac);
      if (secondary) {
        emit({ kind: 'secondary', x: p.x, y: p.y, mods: mods(e), pointerType: e.pointerType });
        e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.button !== 1) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
      press = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, button: e.button, dragging: false, pointerType: e.pointerType, mods: mods(e) };
      emit({ kind: 'down', x: p.x, y: p.y, button: e.button, pointerType: e.pointerType, mods: mods(e) });
      if (e.button === 1) e.preventDefault();
    });

    /* pinça: o zoom só arranca quando a distância entre os dedos muda mais de PINCH_DEAD (fração) desde o início
       do gesto — um deslize com dois dedos não mexe no zoom (no limite de zoom, o fator > 1 cortado e o < 1
       seguinte faziam-no descer sozinho). Depois de arrancar, o fator é relativo ao fotograma anterior. */
    function pinchStep() {
      if (!pinch) return;
      pinch.raf = 0;
      if (touches.size < 2) return;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!pinch.zooming && pinch.d0 > 10 && Math.abs(d / pinch.d0 - 1) > PINCH_DEAD) {
        pinch.zooming = true;
        pinch.d = pinch.d0;
      }
      if (pinch.zooming && pinch.d > 10 && Math.abs(d - pinch.d) > 0.5) {
        emit({ kind: 'zoom', factor: d / pinch.d, x: mx, y: my });
        pinch.moved = true;
        pinch.d = d;
      }
      if (mx !== pinch.mx || my !== pinch.my) {
        emit({ kind: 'pan', cx: -(mx - pinch.mx), cy: -(my - pinch.my) });
        pinch.moved = true;
      }
      pinch.mx = mx; pinch.my = my;
    }
    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        const t = touches.get(e.pointerId);
        if (t) { t.x = p.x; t.y = p.y; }
        if (pinch && touches.size >= 2) {
          // um pointermove por dedo: processar a pinça uma vez por fotograma, já com os dois dedos atualizados
          if (!pinch.raf) pinch.raf = requestAnimationFrame(pinchStep);
          return;
        }
      }
      if (press && press.id === e.pointerId) {
        const dx = p.x - press.x, dy = p.y - press.y;
        press.x = p.x; press.y = p.y;
        if (!press.dragging && Math.hypot(p.x - press.x0, p.y - press.y0) > DRAG_PX) {
          press.dragging = true;
          clearTimeout(longTimer);
          emit({ kind: 'dragstart', x: press.x0, y: press.y0, dx: 0, dy: 0, button: press.button, pointerType: press.pointerType, mods: press.mods });
        }
        if (press.dragging) emit({ kind: 'drag', x: p.x, y: p.y, dx, dy, button: press.button, pointerType: press.pointerType, mods: press.mods });
        return;
      }
      if (e.pointerType !== 'touch') emit({ kind: 'hover', x: p.x, y: p.y, mods: mods(e) });
    });

    const finish = (e, cancelled) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (pinch) {
          if (touches.size < 2 && pinch.raf) { cancelAnimationFrame(pinch.raf); pinch.raf = 0; }
          if (touches.size === 0) {
            // toque de dois dedos sem mexer = secundário (como no trackpad)
            if (!pinch.moved && performance.now() - pinch.t0 < 350 && !cancelled) emit({ kind: 'secondary', x: pinch.mx, y: pinch.my, mods: mods(e), pointerType: 'touch' });
            pinch = null;
          }
          return;
        }
      }
      if (!press || press.id !== e.pointerId) return;
      clearTimeout(longTimer);
      const pr = press;
      press = null;
      if (pr.dragging) {
        emit({ kind: 'dragend', x: p.x, y: p.y, dx: 0, dy: 0, button: pr.button, pointerType: pr.pointerType, mods: pr.mods });
        return;
      }
      if (cancelled || pr.button !== 0) return;
      const now = performance.now();
      const isDbl = now - lastClick.t < DBL_MS && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 8;
      // detail: 1 = clique simples, 2 = 2.º clique de um duplo clique (como MouseEvent.detail)
      emit({ kind: 'click', x: p.x, y: p.y, mods: pr.mods, pointerType: pr.pointerType, detail: isDbl ? 2 : 1 });
      if (isDbl) {
        emit({ kind: 'dblclick', x: p.x, y: p.y, mods: pr.mods, pointerType: pr.pointerType });
        lastClick.t = 0;
      } else lastClick = { t: now, x: p.x, y: p.y };
    };
    canvas.addEventListener('pointerup', (e) => finish(e, false));
    canvas.addEventListener('pointercancel', (e) => finish(e, true));
    // toque: o navegador ainda gera um «click» de compatibilidade depois do pointerup, no elemento que estiver então
    // por baixo do dedo — se o toque abriu um modal ou uma janela, esse clique fantasma fechava-a (fundo) ou carregava
    // num botão. Cancelar o touchend no canvas suprime-o (os pointer events já trataram o toque).
    canvas.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !press) emit({ kind: 'leave' }); });

    // roda / trackpad: ctrl = pinça (Chrome) ou ctrl+roda; entalhe clássico = roda de rato; resto = deslocar
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (e.ctrlKey) {
        emit({ kind: 'zoom', factor: Math.exp(-e.deltaY * 0.01), x: p.x, y: p.y });
        return;
      }
      if (I.classifyWheel(e, performance.now())) {
        emit({ kind: 'wheelnotch', delta: e.deltaY < 0 ? 1 : -1, x: p.x, y: p.y });
        return;
      }
      const mul = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? 400 : 1;
      emit({ kind: 'pan', cx: e.deltaX * mul, cy: e.deltaY * mul });
    }, { passive: false });
    // por cima do HUD/modais: a pinça amplia a câmara (nunca a página); a roda só rola listas que rolam e nunca
    // dispara o «voltar» por gesto horizontal
    window.addEventListener('wheel', (e) => {
      if (e.target === canvas) return;
      if (e.ctrlKey) {
        e.preventDefault();
        const p = pos(e);
        emit({ kind: 'zoom', factor: Math.exp(-e.deltaY * 0.01), x: p.x, y: p.y });
        return;
      }
      if (!scrollerFor(e.target, e.deltaX, e.deltaY)) e.preventDefault();
    }, { passive: false });

    // Safari (macOS e iPadOS): gestos de pinça. No canvas ampliam a câmara; em qualquer outro sítio só se
    // cancelam — o iOS ignora user-scalable=no e ampliaria a página sem forma de voltar
    let gScale = 1;
    const gesture = (e) => {
      e.preventDefault();
      if (e.type === 'gesturestart') { gScale = 1; return; }
      // iPad: os dedos já chegam como pointer events (pinça acima); o gesto do Safari só serve o trackpad do Mac
      if (e.type !== 'gesturechange' || e.target !== canvas || touches.size >= 2 || pinch) return;
      const r = canvas.getBoundingClientRect();
      emit({ kind: 'zoom', factor: e.scale / gScale, x: (e.clientX || r.width / 2 + r.left) - r.left, y: (e.clientY || r.height / 2 + r.top) - r.top });
      gScale = e.scale;
    };
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, gesture, { passive: false });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      // nunca roubar atalhos do navegador/macOS (⌘W/Q/R/T/1–9/setas, ⌘⇧⌫…); só a tecla ⌘ sozinha passa
      // (pré-visualização do tiro forçado)
      if (e.metaKey && e.key !== 'Meta') return;
      I.keysDown.add(e.code);
      // Esc/Enter mantidos premidos não atravessam vários ecrãs (Equipar → briefing → Geoscape): só a 1.ª pressão conta
      if (e.repeat && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); return; }
      const handled = emit({ kind: 'key', key: e.key, code: e.code, mods: mods(e), repeat: e.repeat });
      if (handled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      I.keysDown.delete(e.code);
      // o macOS não envia keyup das teclas largadas com ⌘ premido: esquecer tudo ao largar ⌘
      if (e.key === 'Meta') I.keysDown.clear();
      emit({ kind: 'keyup', key: e.key, code: e.code });
    });
    window.addEventListener('blur', () => I.keysDown.clear());
  };

  OV.Input = I;
})(globalThis.OV || (globalThis.OV = {}));
