/* Entrada: rato, trackpad, teclado e toque — seleção por caixa, ordens contextuais, modos (atacar-mover, colocar, vender, reparar, poderes) */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;
  const I = (CG.input = {
    mouse: null, box: null, hover: 0, markers: [], keys: {}, attached: false,
    lastClick: { t: 0, id: 0 }, lastGroupKey: { k: 0, t: 0 }, touches: new Map(), touchState: null, cursor: '',
  });

  const svgCursor = (svg, hx, hy, fb) => 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") ' + hx + ' ' + hy + ', ' + fb;
  const CUR = {
    move: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#000" stroke-width="4"><path d="M16 4v24M4 16h24"/></g><g fill="none" stroke="#5dff8a" stroke-width="2"><path d="M16 4v24M4 16h24"/><path d="M12 8l4-4 4 4M12 24l4 4 4-4M8 12l-4 4 4 4M24 12l4 4-4 4"/></g></svg>', 16, 16, 'pointer'),
    attack: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="9" fill="none" stroke="#000" stroke-width="4"/><circle cx="16" cy="16" r="9" fill="none" stroke="#ff4a3a" stroke-width="2"/><path d="M16 2v9M16 21v9M2 16h9M21 16h9" stroke="#ff4a3a" stroke-width="2"/></svg>', 16, 16, 'crosshair'),
    amove: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="9" fill="none" stroke="#000" stroke-width="4"/><circle cx="16" cy="16" r="9" fill="none" stroke="#ffb21f" stroke-width="2"/><path d="M16 2v9M16 21v9M2 16h9M21 16h9" stroke="#ffb21f" stroke-width="2"/></svg>', 16, 16, 'crosshair'),
    capture: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="7" y="7" width="18" height="18" fill="none" stroke="#000" stroke-width="4"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#3ff0ff" stroke-width="2"/><path d="M11 16h10M16 11v10" stroke="#3ff0ff" stroke-width="2"/></svg>', 16, 16, 'copy'),
    sell: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="11" fill="#1d2a1d" stroke="#ffd23a" stroke-width="2"/><text x="16" y="21" font-size="15" font-weight="bold" text-anchor="middle" fill="#ffd23a" font-family="sans-serif">$</text></svg>', 16, 16, 'pointer'),
    repair: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="11" fill="#14301c" stroke="#5dff8a" stroke-width="2"/><path d="M10 16h12M16 10v12" stroke="#5dff8a" stroke-width="3"/></svg>', 16, 16, 'pointer'),
    no: 'not-allowed',
  };

  function view() { return document.getElementById('view'); }
  const ownUnits = (G) => G.sel.map((id) => G.byId.get(id)).filter((e) => e && e.alive && e.kind === 'unit' && e.owner === G.human);
  const ownBuilding = (G) => {
    if (G.sel.length !== 1) return null;
    const e = G.byId.get(G.sel[0]);
    return e && e.alive && e.kind === 'bld' && e.owner === G.human ? e : null;
  };
  I.ownUnits = ownUnits;
  I.ownBuilding = ownBuilding;

  // ---------------------------------------------------------------- seleção
  I.setSelection = function (G, ids, add) {
    if (!add) {
      for (const id of G.sel) { const e = G.byId.get(id); if (e) e.sel = false; }
      G.sel = [];
    }
    for (const id of ids) {
      const e = G.byId.get(id);
      if (!e || !e.alive || e.sel) continue;
      e.sel = true;
      G.sel.push(id);
    }
    if (ids.length && CG.audio) CG.audio.play('select');
    if (CG.ui) CG.ui.selectionChanged(G);
  };
  I.toggleSelect = function (G, e) {
    if (e.sel) {
      e.sel = false;
      G.sel = G.sel.filter((id) => id !== e.id);
      if (CG.ui) CG.ui.selectionChanged(G);
    } else I.setSelection(G, [e.id], true);
  };

  I.pick = function (G, wx, wy) {
    let best = null, bd = 1e9;
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit') continue;
      if (e.owner !== G.human && !CG.visibleTo(G, e, G.human) && !G.revealMap) continue;
      const ey = e.y - e.z;
      const d = Math.hypot(e.x - wx, ey - wy);
      const r = e.def.radius + (e.def.cat === 'inf' ? 5 : 3);
      if (d <= r && d - (e.air ? 4 : 0) < bd) { bd = d - (e.air ? 4 : 0); best = e; }
    }
    if (best) return best;
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'bld') continue;
      if (wx < e.x0 || wx >= e.x1 || wy < e.y0 || wy >= e.y1) continue;
      if (e.owner !== G.human && e.owner >= 0 && !(e.seen & (1 << G.human)) && !G.revealMap) continue;
      if (e.owner < 0 && !G.players[G.human].explored[G.map.idx(e.tx, e.ty)]) continue;
      return e;
    }
    return null;
  };

  function selectAt(G, sx, sy, add, dbl) {
    const w = CG.render.screenToWorld(sx, sy);
    const e = I.pick(G, w.x, w.y);
    if (!e) {
      if (!add) I.setSelection(G, [], false);
      return;
    }
    if (e.owner !== G.human) {
      I.setSelection(G, [e.id], false);
      return;
    }
    if (dbl && e.kind === 'unit') {
      I.setSelection(G, unitsOnScreen(G, (u) => u.type === e.type), add);
      return;
    }
    if (add) {
      if (e.kind === 'unit') I.toggleSelect(G, e);
      return;
    }
    I.setSelection(G, [e.id], false);
  }

  function unitsOnScreen(G, filter) {
    const c = G.cam;
    const out = [];
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit' || e.owner !== G.human) continue;
      if (e.x < c.x || e.x > c.x + c.vw || e.y < c.y || e.y > c.y + c.vh) continue;
      if (filter(e)) out.push(e.id);
    }
    return out;
  }
  I.unitsOnScreen = unitsOnScreen;
  const isCombat = (u) => !!u.def.weapon;

  function boxSelect(G, b, add) {
    const c = G.cam;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    let ids = [];
    const units = [];
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit' || e.owner !== G.human) continue;
      const sx = (e.x - c.x) * c.zoom, sy = (e.y - e.z - c.y) * c.zoom;
      if (sx >= x0 - 4 && sx <= x1 + 4 && sy >= y0 - 4 && sy <= y1 + 4) units.push(e);
    }
    const combat = units.filter((u) => !u.def.harvester);
    ids = (combat.length ? combat : units).map((u) => u.id);
    I.setSelection(G, ids, add);
  }

  // ---------------------------------------------------------------- ordens
  function marker(x, y, color) {
    I.markers.push({ x, y, t: 0, color });
  }

  I.command = function (G, wx, wy, forceAmove) {
    const units = ownUnits(G);
    const bsel = ownBuilding(G);
    if (!units.length) {
      if (bsel && (bsel.def.produces || bsel.def.conyard)) {
        bsel.rally = { x: wx, y: wy };
        marker(wx, wy, '#ffffff');
        if (CG.audio) CG.audio.play('ack');
      }
      return;
    }
    const t = I.pick(G, wx, wy);
    const m = G.map;
    if (CG.audio) CG.audio.play('ack');
    if (t && t.owner !== G.human && t.owner >= 0) {
      const movers = [];
      for (const u of units) {
        if (u.def.engineer && t.kind === 'bld' && t.def.capturable) CG.orderCapture(G, u, t);
        else if (u.def.weapon && CG.orderAttack(G, u, t)) { /* ataque atribuído */ }
        else movers.push(u);
      }
      if (movers.length) CG.groupMove(G, movers, t.x, t.y, false);
      marker(t.x, t.y, '#ff4a3a');
      return;
    }
    if (t && t.kind === 'bld' && t.owner < 0) {
      const movers = [];
      for (const u of units) {
        if (u.def.engineer && t.def.capturable) CG.orderCapture(G, u, t);
        else movers.push(u);
      }
      if (movers.length) CG.groupMove(G, movers, t.x, t.y + T, false);
      marker(t.x, t.y, '#3ff0ff');
      return;
    }
    if (t && t.kind === 'bld' && t.owner === G.human) {
      const movers = [];
      for (const u of units) {
        if (u.def.engineer && t.hp < t.maxHp) CG.orderCapture(G, u, t);
        else if (u.def.harvester && t.def.refinery) CG.orderReturn(G, u, t);
        else movers.push(u);
      }
      if (movers.length) CG.groupMove(G, movers, t.x, t.y1 + T, forceAmove);
      marker(t.x, t.y, '#5dff8a');
      return;
    }
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    const onRes = m.inBounds(tx, ty) && m.res[m.idx(tx, ty)] > 0;
    const movers = [];
    for (const u of units) {
      if (u.def.harvester && onRes) CG.orderHarvest(G, u, m.idx(tx, ty));
      else movers.push(u);
    }
    if (movers.length) CG.groupMove(G, movers, wx, wy, forceAmove);
    marker(wx, wy, forceAmove ? '#ffb21f' : '#5dff8a');
  };

  I.stop = function (G) {
    for (const u of ownUnits(G)) CG.orderStop(G, u);
  };
  I.deploy = function (G) {
    let any = false;
    for (const u of ownUnits(G)) if (u.def.mcv) { CG.orderDeploy(G, u); any = true; }
    return any;
  };
  I.setMode = function (G, mode) {
    G.mode = mode;
    if (CG.ui) CG.ui.modeChanged(G);
  };

  function leftAction(G, sx, sy, shift, dbl) {
    const w = CG.render.screenToWorld(sx, sy);
    const mode = G.mode;
    if (mode) {
      const H = G.players[G.human];
      if (mode.type === 'place') {
        if (CG.placeStructure(G, H, mode.tx, mode.ty)) {
          I.setMode(G, null);
        } else {
          CG.notify(G, G.human, mode.reason || 'Local inválido', { kind: 'warn', sound: 'error', cooldown: 0.5, voice: false });
        }
        return;
      }
      if (mode.type === 'amove') {
        I.command(G, w.x, w.y, true);
        if (!shift) I.setMode(G, null);
        return;
      }
      if (mode.type === 'power') {
        if (CG.usePower(G, H, mode.id, w.x, w.y)) I.setMode(G, null);
        return;
      }
      const e = I.pick(G, w.x, w.y);
      if (mode.type === 'sell') {
        if (e && e.kind === 'bld' && e.owner === G.human) {
          CG.sellBuilding(G, e);
          if (!shift) I.setMode(G, null);
        } else if (CG.audio) CG.audio.play('error');
        return;
      }
      if (mode.type === 'repair') {
        if (e && e.kind === 'bld' && e.owner === G.human) {
          e.repairing = !e.repairing && e.hp < e.maxHp;
          if (CG.audio) CG.audio.play('click');
          if (!shift) I.setMode(G, null);
        } else if (CG.audio) CG.audio.play('error');
        return;
      }
    }
    selectAt(G, sx, sy, shift, dbl);
  }

  function rightAction(G, sx, sy) {
    if (G.mode) {
      I.setMode(G, null);
      return;
    }
    const w = CG.render.screenToWorld(sx, sy);
    I.command(G, w.x, w.y, false);
  }

  // ---------------------------------------------------------------- câmara
  I.setZoom = function (G, z, sx, sy) {
    const c = G.cam;
    const nz = CG.clamp(z, 0.6, 1.6);
    if (Math.abs(nz - c.zoom) < 1e-4) return;
    const ax = sx === undefined ? CG.render.cssW / 2 : sx, ay = sy === undefined ? CG.render.cssH / 2 : sy;
    const wx = c.x + ax / c.zoom, wy = c.y + ay / c.zoom;
    c.zoom = nz;
    c.x = wx - ax / nz;
    c.y = wy - ay / nz;
    CG.render.clampCam(G);
    CG.render.zoomChanged();
  };
  I.centerOn = function (G, x, y) {
    G.cam.x = x - G.cam.vw / 2;
    G.cam.y = y - G.cam.vh / 2;
    CG.render.clampCam(G);
  };

  // ---------------------------------------------------------------- eventos
  function localPos(ev) {
    const r = view().getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  }
  function isRightClick(ev) {
    return ev.button === 2 || (ev.button === 0 && ev.ctrlKey && CG.isMac);
  }

  I.attach = function () {
    I.mouse = null;
    I.box = null;
    I.hover = 0;
    I.markers = [];
    I.keys = {};
    I.touches.clear();
    I.touchState = null;
    if (I.attached) return;
    I.attached = true;
    const cv = view();
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onCancel);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && I.mouse && !I.drag) I.mouse.inside = false; });
    cv.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && I.mouse) I.mouse.inside = true; });
    cv.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('mouseleave', () => { if (I.mouse) I.mouse.inside = false; });
    window.addEventListener('blur', () => { I.keys = {}; if (I.mouse) I.mouse.inside = false; });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { I.keys[e.key] = false; });
    const mm = document.getElementById('minimap');
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    mm.addEventListener('pointerdown', onMinimap);
    mm.addEventListener('pointermove', (e) => { if (I.mmDrag) onMinimap(e); });
    mm.addEventListener('pointerup', () => { I.mmDrag = false; });
    mm.addEventListener('pointercancel', () => { I.mmDrag = false; });
    // Safari: gestos de pinça
    cv.addEventListener('gesturestart', (e) => e.preventDefault());
    cv.addEventListener('gesturechange', (e) => e.preventDefault());
  };

  function onDown(ev) {
    const G = CG.G;
    if (!G || G.over) return;
    if (CG.audio) CG.audio.init();
    const p = localPos(ev);
    if (ev.pointerType === 'touch') { touchDown(G, ev, p); return; }
    I.mouse = I.mouse || {};
    Object.assign(I.mouse, { sx: p.x, sy: p.y, world: CG.render.screenToWorld(p.x, p.y), inside: true });
    if (ev.button === 1) {
      I.pan = { x: p.x, y: p.y, cx: G.cam.x, cy: G.cam.y };
      view().setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (isRightClick(ev)) {
      rightAction(G, p.x, p.y);
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    view().setPointerCapture(ev.pointerId);
    I.drag = { x0: p.x, y0: p.y, moved: false, shift: ev.shiftKey || ev.metaKey };
  }

  function onMove(ev) {
    const G = CG.G;
    if (!G) return;
    const p = localPos(ev);
    if (ev.pointerType === 'touch') { touchMove(G, ev, p); return; }
    I.mouse = I.mouse || {};
    I.mouse.sx = p.x;
    I.mouse.sy = p.y;
    I.mouse.inside = true;
    I.mouse.world = CG.render.screenToWorld(p.x, p.y);
    if (I.pan) {
      G.cam.x = I.pan.cx - (p.x - I.pan.x) / G.cam.zoom;
      G.cam.y = I.pan.cy - (p.y - I.pan.y) / G.cam.zoom;
      CG.render.clampCam(G);
      return;
    }
    if (I.drag) {
      const d = Math.hypot(p.x - I.drag.x0, p.y - I.drag.y0);
      if (d > 6 && (!G.mode || G.mode.type === 'amove')) I.drag.moved = true;
      if (I.drag.moved && !G.mode) {
        I.box = { x0: I.drag.x0, y0: I.drag.y0, x1: CG.clamp(p.x, 0, p.w), y1: CG.clamp(p.y, 0, p.h) };
        I.drag.wx0 = I.drag.wx0 || CG.render.screenToWorld(I.drag.x0, I.drag.y0);
      }
    }
  }

  function onUp(ev) {
    const G = CG.G;
    if (!G) return;
    const p = localPos(ev);
    if (ev.pointerType === 'touch') { touchUp(G, ev, p); return; }
    if (I.pan && ev.button === 1) { I.pan = null; return; }
    if (!I.drag || ev.button !== 0) return;
    const dr = I.drag;
    I.drag = null;
    if (dr.moved && I.box) {
      // a caixa acompanha a câmara se esta se moveu durante o arrasto (scroll nas bordas)
      if (dr.wx0) {
        const s0 = CG.render.worldToScreen(dr.wx0.x, dr.wx0.y);
        I.box.x0 = s0.x;
        I.box.y0 = s0.y;
      }
      boxSelect(G, I.box, dr.shift);
      I.box = null;
      return;
    }
    I.box = null;
    const now = performance.now();
    const w = CG.render.screenToWorld(p.x, p.y);
    const e = I.pick(G, w.x, w.y);
    const dbl = e && I.lastClick.id === e.id && now - I.lastClick.t < 350;
    I.lastClick = { t: now, id: e ? e.id : 0 };
    leftAction(G, p.x, p.y, dr.shift, dbl);
  }

  function onCancel(ev) {
    if (ev.pointerType === 'touch') { I.touches.delete(ev.pointerId); I.touchState = null; I.box = null; return; }
    I.drag = null;
    I.box = null;
    I.pan = null;
  }

  function onWheel(ev) {
    const G = CG.G;
    if (!G) return;
    ev.preventDefault();
    const p = localPos(ev);
    if (ev.ctrlKey) {
      I.setZoom(G, G.cam.zoom * Math.exp(-ev.deltaY * 0.01), p.x, p.y);
    } else {
      const mul = ev.deltaMode === 1 ? 24 : ev.deltaMode === 2 ? 400 : 1;
      G.cam.x += (ev.deltaX * mul) / G.cam.zoom;
      G.cam.y += (ev.deltaY * mul) / G.cam.zoom;
      CG.render.clampCam(G);
    }
  }

  function onMinimap(ev) {
    const G = CG.G;
    if (!G || !CG.render.mmTransform) return;
    ev.preventDefault();
    if (CG.audio) CG.audio.init();
    const r = ev.currentTarget.getBoundingClientRect();
    const t = CG.render.mmTransform;
    const wx = (ev.clientX - r.left - t.ox) / t.s, wy = (ev.clientY - r.top - t.oy) / t.s;
    if (ev.type === 'pointerdown' && isRightClick(ev)) {
      I.command(G, CG.clamp(wx, 0, G.map.pxW - 1), CG.clamp(wy, 0, G.map.pxH - 1), false);
      return;
    }
    if (ev.type === 'pointerdown') {
      I.mmDrag = true;
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* ignora */ }
    }
    I.centerOn(G, wx, wy);
  }

  // ---------------------------------------------------------------- toque (iPad)
  function touchDown(G, ev, p) {
    view().setPointerCapture(ev.pointerId);
    I.touches.set(ev.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now() });
    if (I.touches.size === 2) {
      const [a, b] = [...I.touches.values()];
      I.touchState = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: G.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      I.box = null;
    } else if (I.touches.size === 1) {
      I.touchState = { kind: 'tap', cx: G.cam.x, cy: G.cam.y };
      I.mouse = { sx: p.x, sy: p.y, world: CG.render.screenToWorld(p.x, p.y), inside: false };
    }
  }
  function touchMove(G, ev, p) {
    const t = I.touches.get(ev.pointerId);
    if (!t) return;
    t.x = p.x;
    t.y = p.y;
    const st = I.touchState;
    if (!st) return;
    I.mouse = { sx: p.x, sy: p.y, world: CG.render.screenToWorld(p.x, p.y), inside: false };
    if (st.kind === 'pinch' && I.touches.size >= 2) {
      const [a, b] = [...I.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      I.setZoom(G, st.z0 * (d / Math.max(10, st.d0)), mx, my);
      G.cam.x -= (mx - st.mx) / G.cam.zoom;
      G.cam.y -= (my - st.my) / G.cam.zoom;
      st.mx = mx;
      st.my = my;
      CG.render.clampCam(G);
      return;
    }
    const moved = Math.hypot(p.x - t.x0, p.y - t.y0);
    if (st.kind === 'tap') {
      if (performance.now() - t.t0 > 450 && moved > 8 && !G.mode) st.kind = 'box';
      else if (moved > 10) st.kind = 'pan';
    }
    if (st.kind === 'pan') {
      G.cam.x = st.cx - (p.x - t.x0) / G.cam.zoom;
      G.cam.y = st.cy - (p.y - t.y0) / G.cam.zoom;
      CG.render.clampCam(G);
    } else if (st.kind === 'box') {
      I.box = { x0: t.x0, y0: t.y0, x1: p.x, y1: p.y };
    }
  }
  function touchUp(G, ev, p) {
    const t = I.touches.get(ev.pointerId);
    I.touches.delete(ev.pointerId);
    const st = I.touchState;
    if (!t || !st) return;
    if (st.kind === 'pinch') {
      if (I.touches.size === 0) I.touchState = null;
      return;
    }
    I.touchState = null;
    if (st.kind === 'box' && I.box) {
      boxSelect(G, I.box, false);
      I.box = null;
      return;
    }
    if (st.kind !== 'tap') return;
    if (performance.now() - t.t0 > 450 && Math.hypot(p.x - t.x0, p.y - t.y0) < 8 && !G.mode) {
      // toque longo sem arrastar: seleciona todas as unidades do mesmo tipo
      const w0 = CG.render.screenToWorld(p.x, p.y);
      const e0 = I.pick(G, w0.x, w0.y);
      if (e0 && e0.owner === G.human && e0.kind === 'unit') { I.setSelection(G, unitsOnScreen(G, (u) => u.type === e0.type), false); return; }
    }
    const w = CG.render.screenToWorld(p.x, p.y);
    if (G.mode) { leftAction(G, p.x, p.y, false, false); return; }
    const e = I.pick(G, w.x, w.y);
    const now = performance.now();
    const dbl = e && I.lastClick.id === e.id && now - I.lastClick.t < 350;
    I.lastClick = { t: now, id: e ? e.id : 0 };
    const units = ownUnits(G);
    if (e && e.owner === G.human) {
      // com engenheiros/extratores selecionados, tocar num edifício próprio é uma ordem (reparar/descarregar)
      const cmdOnOwn = e.kind === 'bld' && units.some((u) => (u.def.engineer && e.hp < e.maxHp) || (u.def.harvester && e.def.refinery));
      if (!cmdOnOwn) {
        if (dbl && e.kind === 'unit') I.setSelection(G, unitsOnScreen(G, (u) => u.type === e.type), false);
        else if (e.kind === 'unit' && units.length && !e.sel) I.toggleSelect(G, e);
        else I.setSelection(G, [e.id], false);
        return;
      }
    }
    if (units.length || ownBuilding(G)) I.command(G, w.x, w.y, false);
    else if (e) I.setSelection(G, [e.id], false);
  }

  // ---------------------------------------------------------------- teclado
  function onKey(ev) {
    const G = CG.G;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!G || !CG.ui || !CG.ui.inGame()) return;
    I.keys[ev.key] = true;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const mod = ev.ctrlKey || ev.altKey;
    if (/^[1-9]$/.test(ev.key) || (ev.code && /^Digit[1-9]$/.test(ev.code))) {
      const n = ev.code && ev.code.startsWith('Digit') ? +ev.code.slice(5) : +ev.key;
      ev.preventDefault();
      if (mod) {
        for (const e of G.entities) if (e.group === n && e.owner === G.human) e.group = 0;
        for (const u of ownUnits(G)) u.group = n;
        CG.notify(G, G.human, 'Grupo ' + n + ' definido', { cooldown: 0, voice: false });
        return;
      }
      const ids = G.entities.filter((e) => e.alive && e.group === n && e.owner === G.human).map((e) => e.id);
      if (!ids.length) return;
      const now = performance.now();
      if (I.lastGroupKey.k === n && now - I.lastGroupKey.t < 350) {
        const u = G.byId.get(ids[0]);
        if (u) I.centerOn(G, u.x, u.y);
      }
      I.lastGroupKey = { k: n, t: now };
      I.setSelection(G, ids, ev.shiftKey);
      return;
    }
    if (G.over && k !== 'Escape') return;
    switch (k) {
      case 'Escape':
        if (G.mode) I.setMode(G, null);
        else if (G.sel.length) I.setSelection(G, [], false);
        else CG.ui.togglePause();
        break;
      case 'p':
      case 'F10':
        CG.ui.togglePause();
        break;
      case 'a':
        if (ownUnits(G).some(isCombat)) I.setMode(G, { type: 'amove' });
        break;
      case 's':
        I.stop(G);
        break;
      case 'd':
        if (!I.deploy(G) && CG.audio) CG.audio.play('error');
        break;
      case 'h': {
        const cy = G.entities.find((e) => e.alive && e.owner === G.human && e.def.conyard) || G.entities.find((e) => e.alive && e.owner === G.human && e.kind === 'bld');
        if (cy) I.centerOn(G, cy.x, cy.y);
        break;
      }
      case ' ':
        ev.preventDefault();
        if (G.lastAlert) I.centerOn(G, G.lastAlert.x, G.lastAlert.y);
        break;
      case 'q':
        I.setSelection(G, unitsOnScreen(G, (u) => isCombat(u)), false);
        break;
      case 'w':
        I.setSelection(G, G.entities.filter((e) => e.alive && e.kind === 'unit' && e.owner === G.human && isCombat(e)).map((e) => e.id), false);
        break;
      case 'e': {
        const types = new Set(ownUnits(G).map((u) => u.type));
        if (types.size) I.setSelection(G, unitsOnScreen(G, (u) => types.has(u.type)), false);
        break;
      }
      case 'r':
        I.setMode(G, G.mode && G.mode.type === 'repair' ? null : { type: 'repair' });
        break;
      case 'v':
        I.setMode(G, G.mode && G.mode.type === 'sell' ? null : { type: 'sell' });
        break;
      case '+':
      case '=':
        I.setZoom(G, G.cam.zoom * 1.15);
        break;
      case '-':
      case '_':
        I.setZoom(G, G.cam.zoom / 1.15);
        break;
      case 'F2':
        CG.ui.toggleFps();
        break;
      case 'Tab':
        ev.preventDefault();
        CG.ui.cycleTab(ev.shiftKey ? -1 : 1);
        break;
    }
  }

  // ---------------------------------------------------------------- por fotograma
  I.frame = function (G, dt) {
    const c = G.cam;
    let vx = 0, vy = 0;
    const K = I.keys;
    if (K.ArrowLeft) vx -= 1;
    if (K.ArrowRight) vx += 1;
    if (K.ArrowUp) vy -= 1;
    if (K.ArrowDown) vy += 1;
    const m = I.mouse;
    if (m && m.inside && !I.pan && document.hasFocus()) {
      const edge = 14;
      const W = CG.render.cssW, H = CG.render.cssH;
      if (m.sx < edge) vx -= 1;
      else if (m.sx > W - edge) vx += 1;
      if (m.sy < edge) vy -= 1;
      else if (m.sy > H - edge) vy += 1;
    }
    if (vx || vy) {
      const sp = 950 / c.zoom;
      c.x += vx * sp * dt;
      c.y += vy * sp * dt;
      CG.render.clampCam(G);
      if (m) m.world = CG.render.screenToWorld(m.sx, m.sy);
    }
    for (const mk of I.markers) mk.t += dt;
    I.markers = I.markers.filter((mk) => mk.t < 0.6);
    // entidade sob o cursor e cursor contextual
    let cur = 'default';
    if (m && m.world) {
      const e = I.pick(G, m.world.x, m.world.y);
      I.hover = e ? e.id : 0;
      const mode = G.mode;
      const units = ownUnits(G);
      if (mode) {
        if (mode.type === 'amove') cur = CUR.amove;
        else if (mode.type === 'sell') cur = e && e.kind === 'bld' && e.owner === G.human ? CUR.sell : CUR.no;
        else if (mode.type === 'repair') cur = e && e.kind === 'bld' && e.owner === G.human ? CUR.repair : CUR.no;
        else if (mode.type === 'power') cur = CUR.attack;
        else if (mode.type === 'place') cur = 'crosshair';
      } else if (e && e.owner === G.human) cur = 'pointer';
      else if (units.length) {
        if (e && e.owner !== G.human && e.owner >= 0 && units.some((u) => CG.canTarget(G, u, e, true))) cur = CUR.attack;
        else if (e && e.kind === 'bld' && e.def.capturable && units.some((u) => u.def.engineer)) cur = CUR.capture;
        else cur = CUR.move;
      }
    }
    if (cur !== I.cursor) {
      I.cursor = cur;
      view().style.cursor = cur;
    }
  };
})();
