/* Pilha de cenas (como a State stack do OpenXcom): só a cena do topo "pensa" e recebe entrada;
   desenham-se as cenas a partir da última com isScreen:true. Popups/modais pausam o que está por baixo.
   Registo: OV.SceneDefs.nome = (params, ctx) => cena
   Cena: { id, isScreen, enter(), exit(), pause(), resume(), think(dtMs), draw(ctx, view), onInput(ev) → bool, onResize(view) } */
(function (OV) {
  'use strict';

  OV.SceneDefs = OV.SceneDefs || {};

  // a dica e a etiqueta de toque longo pertencem ao ecrã que as mostrou: nunca passam para a cena seguinte
  function dropTips() {
    if (!OV.Dom) return;
    if (OV.Dom.hideTooltip) OV.Dom.hideTooltip();
    if (OV.Dom.hideLongPress) OV.Dom.hideLongPress();
  }

  const S = {
    stack: [],
    pending: [],
    top() {
      return S.stack[S.stack.length - 1] || null;
    },
    create(name, params) {
      const def = OV.SceneDefs[name];
      if (!def) throw new Error('Cena desconhecida: ' + name);
      const sc = def(params || {});
      sc.id = sc.id || name;
      return sc;
    },
    push(name, params) {
      const prev = S.top();
      dropTips();
      if (prev && prev.pause) prev.pause();
      const sc = typeof name === 'string' ? S.create(name, params) : name;
      // um ecrã novo por cima (briefing, base, relatório) leva os avisos antigos consigo
      if (sc.isScreen && prev && OV.Dom && OV.Dom.clearToasts) OV.Dom.clearToasts();
      S.stack.push(sc);
      if (sc.enter) sc.enter(params || {});
      S.dirty = true;
      return sc;
    },
    pop(result) {
      dropTips();
      const sc = S.stack.pop();
      if (sc && sc.exit) sc.exit();
      const top = S.top();
      if (top && top.resume) top.resume(result, sc);
      S.dirty = true;
      return sc;
    },
    // substitui toda a pilha
    set(name, params) {
      dropTips();
      while (S.stack.length) {
        const sc = S.stack.pop();
        if (sc.exit) sc.exit();
      }
      return S.push(name, params);
    },
    replace(name, params) {
      dropTips();
      const sc = S.stack.pop();
      if (sc && sc.exit) sc.exit();
      return S.push(name, params);
    },
    // ciclo principal
    think(dt) {
      const top = S.top();
      if (top && top.think) top.think(dt);
    },
    draw(ctx, view) {
      let from = 0;
      for (let i = S.stack.length - 1; i >= 0; i--) {
        if (S.stack[i].isScreen) { from = i; break; }
      }
      for (let i = from; i < S.stack.length; i++) if (S.stack[i].draw) S.stack[i].draw(ctx, view);
    },
    dispatch(ev) {
      const top = S.top();
      return top && top.onInput ? !!top.onInput(ev) : false;
    },
    resize(view) {
      for (const sc of S.stack) if (sc.onResize) sc.onResize(view);
      S.dirty = true;
    },
    dirty: true,
  };
  OV.Scenes = S;
})(globalThis.OV || (globalThis.OV = {}));
