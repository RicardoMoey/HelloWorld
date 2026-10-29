/* Entrada normalizada (Mac primeiro): rato, trackpad, teclado e toque → eventos para a cena do topo.
   Tipos emitidos (ev.kind):
     'hover'     {x,y}                      movimento do rato sem botões
     'leave'                                cursor saiu do canvas
     'down'      {x,y,button}               botão primário pressionado (para arrastos)
     'click'     {x,y,mods,pointerType}     clique primário sem arrasto (toque curto incluído)
     'dblclick'  {x,y,mods}
     'secondary' {x,y,mods}                 botão direito, ctrl+clique (Mac), toque de dois dedos, toque longo
     'dragstart'/'drag'/'dragend' {x,y,dx,dy,button,pointerType}  arrasto (dx,dy = delta do ponteiro)
     'pan'       {cx,cy}                    mover a câmara (px CSS; positivo = câmara para a direita/baixo)
     'zoom'      {factor,x,y}               zoom multiplicativo ancorado em (x,y)
     'wheelnotch'{delta,x,y}                roda de rato "clássica" (±1 por entalhe): nível ou zoom (decide a cena)
     'key'       {key,code,mods,repeat}     a cena devolve true se consumiu (preventDefault)
     'keyup'     {key,code}
   mods = {shift, alt, ctrl, meta}. A cena recebe ev e pode devolver true. */
(function (OV) {
  'use strict';

  const isMac = /Mac|iPhone|iPad|iPod/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');
  const DRAG_PX = 5, LONG_MS = 450, DBL_MS = 320;

  const I = {
    isMac,
    sink: null, // função (ev) => bool
    lastPointerType: 'mouse',
    usedTrackpad: false,
    keysDown: new Set(),
  };

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
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: false, t0: performance.now() };
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

    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        const t = touches.get(e.pointerId);
        if (t) { t.x = p.x; t.y = p.y; }
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (pinch.d > 10 && Math.abs(d - pinch.d) > 1) {
            emit({ kind: 'zoom', factor: d / pinch.d, x: mx, y: my });
            pinch.moved = true;
          }
          if (mx !== pinch.mx || my !== pinch.my) {
            emit({ kind: 'pan', cx: -(mx - pinch.mx), cy: -(my - pinch.my) });
            pinch.moved = true;
          }
          pinch.d = d; pinch.mx = mx; pinch.my = my;
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
      emit({ kind: 'click', x: p.x, y: p.y, mods: pr.mods, pointerType: pr.pointerType });
      if (isDbl) {
        emit({ kind: 'dblclick', x: p.x, y: p.y, mods: pr.mods, pointerType: pr.pointerType });
        lastClick.t = 0;
      } else lastClick = { t: now, x: p.x, y: p.y };
    };
    canvas.addEventListener('pointerup', (e) => finish(e, false));
    canvas.addEventListener('pointercancel', (e) => finish(e, true));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !press) emit({ kind: 'leave' }); });

    // roda / trackpad: ctrl = pinça (Chrome) ou ctrl+roda; entalhe clássico = roda de rato; resto = deslocar
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (e.ctrlKey) {
        emit({ kind: 'zoom', factor: Math.exp(-e.deltaY * 0.01), x: p.x, y: p.y });
        return;
      }
      const wd = e.wheelDeltaY;
      const notch = e.deltaMode === 1 || (typeof wd === 'number' && wd !== 0 && wd % 120 === 0 && e.deltaX === 0 && !I.usedTrackpad);
      if (notch) {
        emit({ kind: 'wheelnotch', delta: e.deltaY < 0 ? 1 : -1, x: p.x, y: p.y });
        return;
      }
      if (Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) > 0) I.usedTrackpad = true;
      const mul = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? 400 : 1;
      emit({ kind: 'pan', cx: e.deltaX * mul, cy: e.deltaY * mul });
    }, { passive: false });

    // Safari: gestos de pinça
    let gScale = 1;
    canvas.addEventListener('gesturestart', (e) => { e.preventDefault(); gScale = 1; });
    canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      emit({ kind: 'zoom', factor: e.scale / gScale, x: (e.clientX || r.width / 2 + r.left) - r.left, y: (e.clientY || r.height / 2 + r.top) - r.top });
      gScale = e.scale;
    });
    canvas.addEventListener('gestureend', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      // nunca roubar atalhos do navegador/macOS (⌘W/Q/R/T/1–9/setas)
      if (e.metaKey && !e.shiftKey) return;
      I.keysDown.add(e.code);
      const handled = emit({ kind: 'key', key: e.key, code: e.code, mods: mods(e), repeat: e.repeat });
      if (handled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      I.keysDown.delete(e.code);
      emit({ kind: 'keyup', key: e.key, code: e.code });
    });
    window.addEventListener('blur', () => I.keysDown.clear());
  };

  OV.Input = I;
})(globalThis.OV || (globalThis.OV = {}));
