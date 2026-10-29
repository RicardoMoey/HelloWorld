/* Canvas principal com escala Retina (DPR ≤ 2) e notificação de redimensionamento */
(function (OV) {
  'use strict';

  const V = {
    canvas: null, ctx: null, dpr: 1, w: 1, h: 1, listeners: [],
    init(canvas) {
      V.canvas = canvas;
      V.ctx = canvas.getContext('2d');
      V.resize();
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => V.resize()).observe(canvas);
      else window.addEventListener('resize', () => V.resize());
      // mudança de DPR (arrastar a janela entre ecrãs)
      const watch = () => {
        const mq = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
        const fn = () => { V.resize(); watch(); };
        if (mq.addEventListener) mq.addEventListener('change', fn, { once: true });
      };
      watch();
    },
    resize() {
      const c = V.canvas;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === V.w && h === V.h && dpr === V.dpr && c.width === Math.round(w * dpr)) return;
      V.w = w;
      V.h = h;
      V.dpr = dpr;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      for (const fn of V.listeners) fn(V);
    },
    onResize(fn) {
      V.listeners.push(fn);
      return () => { V.listeners = V.listeners.filter((f) => f !== fn); };
    },
    // contexto pronto para desenhar em px CSS
    begin(clear) {
      const ctx = V.ctx;
      ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      if (clear !== false) {
        ctx.fillStyle = clear || '#05070a';
        ctx.fillRect(0, 0, V.w, V.h);
      }
      return ctx;
    },
  };
  OV.View = V;
})(globalThis.OV || (globalThis.OV = {}));
