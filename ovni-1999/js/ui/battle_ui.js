/* Battlescape: cena, câmara, seleção, pré-visualizações e HUD (DESIGN.md §15.1–15.3, §17).
   OV.SceneDefs.battlescape(params) com params = {B, onExit(result), onPlayerTurn?(B), tips?} (tips: conselhos da 1.ª missão); result = {outcome, debrief, B}.
   Quem chama onExit decide a cena seguinte; sem onExit abre 'debrief' (se existir) ou um resumo em modal.
   onPlayerTurn(B) corre no início de cada turno do jogador (ponto quiescente: gravação automática da campanha).
   A interface nunca altera B diretamente: ações por OV.Act.validate/perform, turnos por OV.Battle.* (a reserva
   de UT é a preferência do jogador guardada em B.reserve / B.reserveKneel), animação por OV.Presenter.
   Cursor de teclado (settings.kbCursor, por omissão ligado): setas movem um cursor de tiles (segurar repete; a
   câmara segue-o), ⇧+setas ou W A S D deslocam a câmara, Enter/Espaço confirmam movimento, tiro ou lançamento
   com a mesma pré-visualização do rato (Ctrl+Enter tiro forçado, ⌥+Enter abre a porta, T roda para o cursor),
   Tab e 1–0 saltam para os alienígenas à vista ao apontar ou lançar. O rato esconde o cursor.
   Explosivos com aliados no raio pedem 2.ª confirmação (settings.confirmBlast 'auto' = Recruta/Veterano).
   Acessibilidade: settings.palette 'cvd' (cores seguras para daltonismo; as formas estão sempre ligadas),
   settings.reduceMotion ('auto' segue prefers-reduced-motion), settings.textScale (etiquetas do mapa; o HUD usa
   --ui-scale). Relatório «Durante o turno alienígena» no início de cada turno e registo de mensagens (N).
   OV.BattleUI = {scene (cena ativa | null), open(B, opts), openInventory(unitId), refresh(), abort() (pede confirmação,
     como o botão e a tecla X), model: {kbStep(m, x, y,
     dir, anchor) → {x, y, anchor}, logEntry(B, ev, ctx) → entrada|null, blastConfirm(settings, difficulty) → bool,
     handName(type) → texto curto, confirmEarly(pointerType, detail, dtMs) → bool (2.º clique de um duplo clique ou
     depressa demais não confirma um explosivo), reportSummary(rows) → texto, turnReportRows(entradas) → linhas do
     relatório do turno (turno alienígena + secção «No início do turno X-COM»)}, debug: {tileToScreen(x,y,z), unitScreen(id), selectAndMove(id,x,y,z) → Promise,
     state(), hover(x,y), perf() → {fps, avg, p95, chunks, sprites}|null (só com ?debug=1, que também mostra a leitura
     no topo do ecrã), showAll(on) (só a vista), centre(x,y,z) (câmara), log() → [entrada], kb(x,y,z) (cursor de
     teclado), noteEvent(ev), report('turn'|'log'), grenades() → n (aviso de granadas alienígenas, Recruta)}} */
(function (OV) {
  'use strict';

  const SNAPS = [0.5, 0.75, 1, 1.5, 2];
  const ZMIN = 0.5, ZMAX = 2;
  const PAN_SPEED = 600, PAN_MAX = 1600, PAN_ACCEL = 1.6; // px CSS/s e aceleração por segundo
  const EDGE = 14;
  const LIVE = { ok: 1, panic: 1 };
  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  const el = (...a) => OV.Dom.el(...a);
  const esc = (s) => (OV.U && OV.U.esc ? OV.U.esc(String(s)) : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]));
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const settings = () => (OV.Game && OV.Game.settings) || {};
  const realNow = () => performance.now();
  const kbOn = () => settings().kbCursor !== false;
  const KB_HOLD = 230, KB_RATE = 95; // cursor de teclado: atraso e intervalo da repetição ao segurar uma seta (ms)
  function reduceMotion() {
    const v = settings().reduceMotion || 'auto';
    if (v === 'on' || v === true) return true;
    if (v === 'off' || v === false) return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  // chave no feminino quando existe (soldadas: «ferida», «morta», «paralisada»…)
  const gk = (key, u) => (u && u.female && OV.T.has(key + '.f') ? key + '.f' : key);
  // 2.ª confirmação de explosivos com aliados no raio: 'auto' liga em Recruta e Veterano
  function blastConfirm(st, difficulty) {
    const v = (st && st.confirmBlast) || 'auto';
    if (v === 'always' || v === 'on' || v === true) return true;
    if (v === 'never' || v === 'off' || v === false) return false;
    return (difficulty | 0) <= 1;
  }
  // nome curto para a ranhura da mão (o nome completo fica na dica)
  function handName(type) {
    const d = OV.Data.items[type];
    if (OV.T.has('hud.short.' + type)) return T('hud.short.' + type);
    return d ? T(d.nameKey) : String(type);
  }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- ícones (SVG 24×24, traço) ---------------------------------------------------------------------------
  const ICONS = {
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    map: '<path d="M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>',
    centre: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    inventory: '<path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7"/><rect x="5" y="7" width="14" height="14" rx="3"/><path d="M9 13h6M5 16h14"/>',
    kneel: '<circle cx="10" cy="4.5" r="2"/><path d="M10 7.5v6l5 .5v6M10 13.5l-4.5 1.5v5M7 10h6"/>',
    next: '<path d="M5 5l7 7-7 7"/><path d="M13 5l7 7-7 7"/>',
    prev: '<path d="M19 5l-7 7 7 7"/><path d="M11 5l-7 7 7 7"/>',
    done: '<path d="M4.5 12.5l4.5 4.5 10.5-11"/>',
    options: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    abort: '<path d="M10 4H5v16h5"/><path d="M14.5 8l4 4-4 4M18.5 12H9"/>',
    endturn: '<path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/>',
    grenade: '<circle cx="11" cy="14.5" r="5.5"/><path d="M9 9.2V7h4v2.2M13 7l3-2.5 2.5 1.5"/>',
    flare: '<circle cx="12" cy="12" r="2.6"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5"/>',
    reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v5h-5"/>',
    rNone: '<circle cx="12" cy="12" r="7"/><path d="M7 17L17 7"/>',
    rSnap: '<path d="M10 20.5V9.5L12 4l2 5.5v11z"/>',
    rAimed: '<circle cx="12" cy="12" r="6"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>',
    rAuto: '<path d="M4 20.5V11l2-4.5L8 11v9.5zM10 20.5V11l2-4.5 2 4.5v9.5zM16 20.5V11l2-4.5 2 4.5v9.5z"/>',
    log: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4M9 11h6.5M9 14.5h6.5M9 18h4"/>',
    medikit: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5h6v2M12 10.5v6M9 13.5h6"/>',
  };
  function icon(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || '') + '</svg>';
  }
  function tipHtml(title, key, extra) {
    let h = '<b>' + esc(title) + '</b>';
    if (key) h += ' <span class="key">' + esc(key) + '</span>';
    if (extra) h += '<br><span class="muted">' + esc(extra) + '</span>';
    return h;
  }
  function tip(node, title, key, extra) {
    const t0 = typeof title === 'function' ? title() : title;
    node.setAttribute('aria-label', t0 + (key ? ' (' + key + ')' : ''));
    const html = () => tipHtml(typeof title === 'function' ? title() : title, key, typeof extra === 'function' ? extra() : extra);
    OV.Dom.tooltip(node, html); // no toque, o toque longo mostra a mesma etiqueta (OV.Dom)
    return node;
  }
  const hideLongPress = () => OV.Dom.hideLongPress && OV.Dom.hideLongPress();

  // ---- estado da cena ativa ---------------------------------------------------------------------------------
  let S = null;
  let current = null;

  const unitOf = (id) => (S && id !== null && id !== undefined ? OV.BUnits.findUnit(S.B, id) : null);
  const sel = () => unitOf(S && S.selId);
  const selectable = (u) => !!u && u.side === 'xcom' && u.onMap && u.x >= 0 && LIVE[u.status] === 1;
  const uname = (u) => (u ? u.name || (u.nameKey ? T(u.nameKey) : T('hud.unit.alien')) : '');
  const idxOf = (x, y, z) => (z * S.B.map.h + y) * S.B.map.w + x;
  function xyzOf(i) {
    const m = S.B.map, plane = m.w * m.h;
    const z = (i / plane) | 0, r = i - z * plane;
    return [r % m.w, (r / m.w) | 0, z];
  }
  const tileOfUnit = (u) => idxOf(u.x, u.y, u.z);
  const itemOf = (id) => (id === null || id === undefined ? null : OV.BUnits.findItem(S.B, id));
  const defOf = (it) => (it ? OV.Data.items[it.type] || null : null);
  const handItem = (u, h) => (u ? itemOf(u.items[h]) : null);
  const seen = (u) => !!u && (u.side === 'xcom' || (OV.LOS && OV.LOS.isVisibleTo(S.B, 'xcom', u)));
  const isTouch = () => OV.Input && OV.Input.lastPointerType === 'touch';
  // modo de confirmação: toque, teclado (cursor) ou rato
  // variante '.touch' de um texto quando se joga com toque (sem teclas nem clique secundário)
  const tk = (key) => (isTouch() && OV.T.has(key + '.touch') ? key + '.touch' : key);
  const confirmVia = () => (S && S.kcur && S.kcur.armed ? 'key' : isTouch() ? 'tap' : 'click');
  const isMac = () => !!(OV.Input && OV.Input.isMac);
  // «Toque / Clique / Enter de novo para disparar|lançar» pelo meio de entrada em uso
  const confirmKey = (base) => (confirmVia() === 'tap' ? base : base + '.' + confirmVia());
  // tiro forçado: ⌘ no Mac (lá Ctrl+clique é o clique secundário), Ctrl nos outros sistemas
  const forceMods = (m) => !!(m && (m.meta || (!isMac() && m.ctrl)));
  const forceKey = (key) => key === 'Meta' || (!isMac() && key === 'Control');

  function sfx(name, opts) {
    if (OV.audio) OV.audio.play(name, opts);
  }
  function toast(key, params, kind) {
    OV.Dom.toast(key, params, kind);
  }
  function deny(reason, params) {
    sfx('ui_deny');
    if (reason) toast(OV.T.has('bs.' + reason) ? 'bs.' + reason : reason, params, 'warn');
  }

  // ---- regras auxiliares de leitura -----------------------------------------------------------------------
  function weaponOf(u) {
    for (const h of ['R', 'L']) {
      const it = handItem(u, h);
      const d = defOf(it);
      if (d && d.kind === 'firearm') return { it, hand: h, def: d };
    }
    return null;
  }
  function snapTU(u) {
    const w = weaponOf(u);
    if (!w) return null;
    const m = OV.Data.weaponModes(w.it.type).find((x) => x.mode === 'snap') || OV.Data.weaponModes(w.it.type)[0];
    return m ? OV.BUnits.actionTU(S.B, u, w.it.id, m.mode) : null;
  }
  // ainda pode fazer algo útil (andar 4 tiles ou um tiro rápido)
  function canAct(u) {
    if (!selectable(u) || u.done || u.status === 'panic') return false;
    const snap = snapTU(u);
    return (u.tu | 0) >= Math.min(4 * tune('TU_WALK', 4), snap === null ? 99 : snap);
  }
  function hasTU(u) {
    return selectable(u) && !u.done && u.status !== 'panic' && (u.tu | 0) >= tune('TU_WALK', 4);
  }
  function squad() {
    return S.B.units.filter((u) => u.side === 'xcom' || u.origSide === 'xcom');
  }
  function visibleAliens() {
    if (!OV.LOS || !OV.LOS.unitsVisibleTo) return [];
    return OV.LOS.unitsVisibleTo(S.B, 'xcom', true).map(unitOf).filter((u) => u && u.onMap && LIVE[u.status]);
  }
  function itemWeight(it) {
    const d = defOf(it);
    let w = d ? d.weight | 0 : 0;
    if (it && it.ammo && OV.Data.items[it.ammo.type]) w += OV.Data.items[it.ammo.type].weight | 0;
    return w;
  }
  function slotOf(u, it) {
    return OV.BUnits.slotOf(u, it.id);
  }

  // ---- câmara ---------------------------------------------------------------------------------------------
  function clampCam() {
    OV.BattleRender.clampCam(S.view, S.B);
  }
  // faixas do ecrã ocupadas pelo HUD (topo e fundo): as etiquetas do cursor ficam fora delas
  function measureSafe() {
    if (!S || !S.hud) return;
    const H = S.hud, vh = S.view.h || window.innerHeight;
    const top = H.top.getBoundingClientRect(), bot = [H.card, H.console, H.end].map((n) => n.getBoundingClientRect().top).filter((y) => y > 0);
    S.view.safe = { t: Math.max(0, top.bottom), b: bot.length ? Math.max(0, vh - Math.min(...bot)) : 0, l: 0, r: 0 };
    // altura real do HUD de baixo (no retrato a reserva passa a 2.ª linha): a dica e os avisos ficam por cima dele
    const bb = Math.round(S.view.safe.b) + 'px';
    if (bb !== S.botVar) {
      S.botVar = bb;
      document.body.style.setProperty('--bs-bot', bb);
    }
  }
  function camFor(x, y, z) {
    const tc = { x: S.view.cam.x, y: S.view.cam.y, zoom: S.view.cam.zoom };
    OV.Iso.centerOn(tc, x, y, z, S.view.w, S.view.h);
    // o HUD ocupa a parte de baixo: centro ótico um pouco acima
    tc.y += 40 / tc.zoom;
    OV.BattleRender.clampCam({ cam: tc, w: S.view.w, h: S.view.h, viewZ: z }, S.B);
    return tc;
  }
  function centreOn(x, y, z, ms) {
    const tc = camFor(x, y, z);
    if (!(ms > 0)) {
      S.view.cam.x = tc.x;
      S.view.cam.y = tc.y;
      S.camTween = null;
      return;
    }
    S.camTween = { x0: S.view.cam.x, y0: S.view.cam.y, x1: tc.x, y1: tc.y, t: 0, dur: ms };
  }
  function centreUnit(u, ms) {
    if (!u) return;
    centreOn(u.x + ((u.size || 1) - 1) / 2, u.y + ((u.size || 1) - 1) / 2, u.z, ms === undefined ? 260 : ms);
  }
  function zoomAround(z, px, py) {
    const nz = Math.max(ZMIN, Math.min(ZMAX, z));
    OV.Iso.zoomAt(S.view.cam, px, py, nz);
    clampCam();
  }
  function scheduleSnap(px, py) {
    clearTimeout(S.snapTimer);
    S.snapTimer = setTimeout(() => {
      if (!S) return;
      const z = S.view.cam.zoom;
      let best = SNAPS[0];
      for (const s of SNAPS) if (Math.abs(s - z) < Math.abs(best - z)) best = s;
      zoomTo(best, px, py);
    }, 220);
  }
  function zoomTo(target, px, py) {
    S.zoomTween = { z0: S.view.cam.zoom, z1: target, px, py, t: 0, dur: 160 };
  }
  function zoomStep(dir) {
    const z = S.view.cam.zoom;
    let t = z;
    if (dir > 0) t = SNAPS.find((s) => s > z + 0.01) || ZMAX;
    else t = SNAPS.slice().reverse().find((s) => s < z - 0.01) || ZMIN;
    zoomTo(t, S.view.w / 2, S.view.h / 2);
  }
  function setViewZ(z) {
    const d = S.B.map.d;
    const nz = Math.max(0, Math.min(d - 1, z | 0));
    if (nz === S.view.viewZ) return;
    S.view.viewZ = nz;
    clampCam();
    S.hoverKey = '';
    refreshHover();
    S.hudDirty = true;
  }

  // ---- seleção ---------------------------------------------------------------------------------------------
  function select(id, opts) {
    const o = opts || {};
    const u = unitOf(id);
    if (!selectable(u)) return false;
    const changed = S.selId !== id;
    S.selId = id;
    S.view.selectedId = id;
    if (changed) {
      cancelMode(true);
      closeMenu();
    }
    S.lock = -1;
    if (changed && isTouch()) S.mouse = null;
    // cursor de teclado acompanha o soldado escolhido (Tab)
    if (changed && S.kcur.armed) {
      S.kcur.x = u.x;
      S.kcur.y = u.y;
      S.kcur.anchor = null;
    }
    setViewZ(u.z);
    if (o.centre) centreUnit(u);
    if (changed && !o.quiet) sfx('ui_select');
    invalidate();
    return true;
  }
  function cycle(dir, onlyTU) {
    const list = squad().filter(selectable);
    if (!list.length) return;
    const ok = onlyTU === false ? list : list.filter(hasTU);
    // quem está em pânico é saltado: dizê-lo uma vez por turno (senão o Tab parece avariado)
    const panicked = list.filter((u) => u.status === 'panic').length;
    if (panicked && S.panicNote !== S.B.turn) {
      S.panicNote = S.B.turn;
      toast(Tn('hud.panicSkip', panicked), null, 'warn');
    }
    if (!ok.length) {
      if (!panicked) toast('hud.noTUSoldiers', null, 'info');
      return;
    }
    let k = list.findIndex((u) => u.id === S.selId);
    for (let n = 0; n < list.length; n++) {
      k = (k + dir + list.length) % list.length;
      if (ok.indexOf(list[k]) >= 0) {
        select(list[k].id, { centre: true });
        return;
      }
    }
  }
  function ensureSelection() {
    const u = sel();
    if (selectable(u)) return;
    const list = squad().filter(selectable);
    const pick = list.find(hasTU) || list[0];
    if (pick) select(pick.id, { centre: true, quiet: true });
    else {
      S.selId = null;
      S.view.selectedId = null;
    }
  }

  // ---- caches de pré-visualização --------------------------------------------------------------------------
  function invalidate() {
    S.ver++;
    S.reachKey = '';
    S.hoverKey = '';
    S.hudDirty = true;
    S.mapDirty = true;
    refreshHover();
  }
  function reserveMode() {
    return S.B.reserve && S.B.reserve !== 'none' ? S.B.reserve : 'snap';
  }
  function updateReach() {
    const u = sel();
    if (!u || S.playing || S.mode !== 'move' || S.B.side !== 'xcom' || S.ended || u.status === 'panic') {
      S.view.reach = null;
      return;
    }
    const key = S.ver + '|' + u.id;
    if (key === S.reachKey) return;
    S.reachKey = key;
    const stand = u.kneel ? tune('TU_STAND', 8) : 0;
    const budget = Math.max(0, (u.tu | 0) - stand);
    const r = OV.Path.reachable(S.B, u, budget, u.energy | 0);
    // standing: andar levanta o soldado, por isso a reserva de ajoelhar conta como no walkPreview
    const res = OV.Act.reserveTU(S.B, u, { mode: reserveMode(), standing: true });
    const live = res > 0 && res <= (u.tu | 0) ? res : 0;
    S.view.reach = { cost: r.cost, budgetOk: Math.max(0, budget - live), budgetReserve: budget, count: r.list.length };
  }

  // ---- cursor de teclado -------------------------------------------------------------------------------------
  /* passo do cursor na direção do ecrã ('up'|'down'|'left'|'right'). Cada passo vai para um vizinho ortogonal
     (meia casa na diagonal do ecrã) e alterna entre os dois candidatos à volta de uma coluna/linha de ecrã de
     referência (anchor = {d: x−y, s: x+y, flip}), por isso segurar ↑ sobe a direito e todas as casas são
     alcançáveis. Ao trocar de eixo (↓ depois ←), o empate escolhe o vizinho que segue a seta anterior: ↓ ← ↓ ←
     anda ao longo de uma fila da grelha (diagonal do ecrã) em vez de saltar entre duas casas. m = {w, h}. Pura
     (testada em Node). */
  const PERP = { up: 0, down: 1, left: 0, right: 1 }; // 0 = a seta baixa a referência do outro eixo, 1 = sobe-a
  function kbStep(m, x, y, dir, anchor) {
    const a = anchor ? { d: anchor.d, s: anchor.s, flip: !!anchor.flip, last: anchor.last || null } : { d: x - y, s: x + y, flip: false, last: null };
    const vert = dir === 'up' || dir === 'down';
    const turned = !!a.last && (a.last === 'up' || a.last === 'down') !== vert;
    let opts;
    if (dir === 'up') opts = [[x - 1, y], [x, y - 1]];
    else if (dir === 'down') opts = [[x, y + 1], [x + 1, y]];
    else if (dir === 'left') opts = [[x - 1, y], [x, y + 1]];
    else opts = [[x, y - 1], [x + 1, y]];
    // opts[0] baixa a referência (d ou s), opts[1] sobe-a
    const ref = vert ? x - y : x + y, want = vert ? a.d : a.s;
    let order;
    if (ref > want) order = [0, 1];
    else if (ref < want) order = [1, 0];
    else if (turned) order = PERP[a.last] ? [1, 0] : [0, 1];
    else {
      order = a.flip ? [1, 0] : [0, 1];
      a.flip = !a.flip;
    }
    a.last = dir;
    const inMap = (q) => q[0] >= 0 && q[1] >= 0 && q[0] < m.w && q[1] < m.h;
    const pick = inMap(opts[order[0]]) ? opts[order[0]] : inMap(opts[order[1]]) ? opts[order[1]] : null;
    if (!pick) return { x, y, anchor: a };
    if (vert) a.s = pick[0] + pick[1];
    else a.d = pick[0] - pick[1];
    return { x: pick[0], y: pick[1], anchor: a };
  }
  function kbArm(at) {
    const K = S.kcur;
    if (K.armed) return;
    let p = at;
    if (!p) {
      const u = sel();
      const sp = u ? OV.Iso.tileCenter(u.x, u.y, S.view.viewZ, S.view.cam) : null;
      if (u && sp && sp.x > 0 && sp.y > 0 && sp.x < S.view.w && sp.y < S.view.h) p = { x: u.x, y: u.y };
      else {
        const t = OV.Iso.screenToTileF(S.view.w / 2, S.view.h / 2, S.view.viewZ, S.view.cam);
        p = { x: Math.max(0, Math.min(S.B.map.w - 1, Math.floor(t.x))), y: Math.max(0, Math.min(S.B.map.h - 1, Math.floor(t.y))) };
      }
    }
    K.x = p.x;
    K.y = p.y;
    K.anchor = null;
    K.armed = true;
    S.mouse = null;
  }
  function kbDisarm() {
    if (!S.kcur.armed) return false;
    S.kcur.armed = false;
    S.kcur.hold = null;
    S.view.kcur = null;
    S.hoverKey = '';
    refreshHover();
    return true;
  }
  function kbPlace(x, y, z) {
    kbArm({ x, y });
    S.kcur.x = x;
    S.kcur.y = y;
    S.kcur.anchor = null;
    if (z !== undefined && z !== S.view.viewZ) setViewZ(z);
    kbFollow();
    S.hoverKey = '';
    refreshHover();
  }
  function kbMove(dir) {
    const fresh = !S.kcur.armed;
    kbArm();
    S.kcur.auto = false;
    if (!fresh) {
      const r = kbStep(S.B.map, S.kcur.x, S.kcur.y, dir, S.kcur.anchor);
      S.kcur.x = r.x;
      S.kcur.y = r.y;
      S.kcur.anchor = r.anchor;
    }
    kbFollow();
    S.hoverKey = '';
    refreshHover();
  }
  // a câmara segue o cursor quando ele sai da zona útil do ecrã (fora do HUD)
  function kbFollow() {
    const K = S.kcur, v = S.view;
    const p = OV.Iso.tileCenter(K.x, K.y, v.viewZ, v.cam);
    const sf = v.safe || { t: 0, b: 0 };
    const mx = Math.min(160, v.w * 0.14), my = 50;
    if (p.x < mx || p.x > v.w - mx || p.y < sf.t + my || p.y > v.h - sf.b - my) centreOn(K.x, K.y, v.viewZ, reduceMotion() ? 0 : 170);
  }
  // alienígenas à vista por distância ao soldado (Tab no modo de alvo/lançamento)
  function aliensByDistance() {
    const u = sel();
    const list = visibleAliens().filter((a) => a.z <= S.B.map.d - 1);
    if (u) list.sort((a, b) => (a.x - u.x) ** 2 + (a.y - u.y) ** 2 + (a.z - u.z) ** 2 * 4 - ((b.x - u.x) ** 2 + (b.y - u.y) ** 2 + (b.z - u.z) ** 2 * 4));
    return list;
  }
  function kbJumpAlien(a) {
    if (!a) {
      toast('hud.kb.noAliens', null, 'info');
      return;
    }
    kbPlace(a.x, a.y, a.z);
    sfx('ui_click', { vol: 0.6 });
  }
  function kbCycleAlien(dir) {
    const list = aliensByDistance();
    if (!list.length) return kbJumpAlien(null);
    const K = S.kcur;
    let k = K.armed ? list.findIndex((a) => OV.BUnits.unitTiles(a, S.B.map).indexOf(idxOf(K.x, K.y, S.view.viewZ)) >= 0) : -1;
    k = k < 0 ? (dir > 0 ? 0 : list.length - 1) : (k + dir + list.length) % list.length;
    kbJumpAlien(list[k]);
  }
  // ao entrar em modo de alvo/lançamento pelo teclado: cursor no alienígena mais próximo (ou fica onde estava)
  function kbAutoAim() {
    if (!kbOn() || S.lastInput !== 'kb') return;
    const K = S.kcur;
    // quem usou o rato há pouco aponta com o rato: o cursor só aparece sozinho a quem joga só com o teclado
    if (!K.armed && realNow() - (S.lastPtrT || 0) < 3000) return;
    const fresh = !K.armed;
    const list = aliensByDistance();
    if (K.armed && list.some((a) => OV.BUnits.unitTiles(a, S.B.map).indexOf(idxOf(K.x, K.y, S.view.viewZ)) >= 0)) return;
    if (list.length) kbPlace(list[0].x, list[0].y, list[0].z);
    else kbArm();
    // posto automaticamente: cancelar a pontaria esconde-o outra vez (Enter volta a terminar o turno)
    K.auto = fresh;
  }
  // unidade visível num tile (inclui as 2×2)
  function unitOnTile(i) {
    for (const u of S.B.units) {
      if (!u.onMap || !LIVE[u.status] || u.x < 0) continue;
      if ((u.size || 1) === 1 ? tileOfUnit(u) !== i : OV.BUnits.unitTiles(u, S.B.map).indexOf(i) < 0) continue;
      if (seen(u)) return u;
    }
    return null;
  }
  function kbPick() {
    const K = S.kcur, z = S.view.viewZ;
    const i = idxOf(K.x, K.y, z);
    const u = unitOnTile(i);
    return { x: K.x, y: K.y, z, unitId: u ? u.id : null };
  }
  // Enter / Espaço com o cursor armado
  function kbConfirm(m) {
    const p = kbPick();
    const mods = { shift: !!(m && m.shift), alt: !!(m && m.alt), ctrl: false, meta: false };
    if (S.mode === 'target') clickTarget(p, mods, 'kb', !!(m && (m.ctrl || m.meta)));
    else if (S.mode === 'throw') clickThrow(p, 'kb');
    else {
      const u = p.unitId !== null ? unitOf(p.unitId) : null;
      if (u && u.side === 'xcom') {
        if (u.id !== S.selId) select(u.id);
      } else if (u && u.side !== 'xcom') toast('hud.hint.aim.kb', null, 'info');
      else clickMove(p, mods, 'kb');
    }
    S.hoverKey = '';
    refreshHover();
  }
  // o cursor está numa casa onde Enter faz alguma coisa (senão Enter termina o turno)
  function kbActive() {
    if (!kbOn() || !S.kcur.armed) return false;
    if (S.mode !== 'move') return true;
    const u = sel();
    return !u || idxOf(S.kcur.x, S.kcur.y, S.view.viewZ) !== tileOfUnit(u) || S.lock >= 0;
  }

  // ---- foco do cursor / pré-visualizações -----------------------------------------------------------------
  function pickAt(px, py) {
    const p = OV.BattleRender.pick(S.view, px, py, S.B);
    if (!p) return null;
    if (p.unitId !== null && p.unitId !== undefined && !seen(unitOf(p.unitId))) p.unitId = null;
    return p;
  }
  function refreshHover() {
    if (!S) return;
    const kb = S.kcur.armed && kbOn();
    S.view.kcur = kb && !S.playing && !S.ended ? { x: S.kcur.x, y: S.kcur.y, z: S.view.viewZ } : null;
    if ((!S.mouse && !kb) || S.playing || S.ended) {
      clearPreview();
      return;
    }
    const p = kb ? kbPick() : pickAt(S.mouse.x, S.mouse.y);
    const key = (p ? p.x + ',' + p.y + ',' + p.z + ',' + p.unitId : '-') + '|' + S.mode + '|' + S.ver + '|' + S.lock + '|' + S.tapLock + '|' + S.view.viewZ + '|' + (S.force ? 1 : 0) + '|' + (S.alt ? 1 : 0) + '|' + (kb ? 'k' : 'm') + '|' + S.view.cam.zoom.toFixed(2);
    if (key === S.hoverKey) return;
    S.hoverKey = key;
    S.pick = p;
    S.view.hover = p ? { x: p.x, y: p.y, z: p.z } : null;
    S.view.path = null;
    S.view.target = null;
    S.view.throwArc = null;
    S.view.throwInfo = null;
    if (!p) return;
    if (S.mode === 'move') previewMove(p);
    else if (S.mode === 'target') previewTarget(p);
    else if (S.mode === 'throw') previewThrow(p);
  }
  function clearPreview() {
    S.view.hover = null;
    S.view.path = null;
    S.view.target = null;
    S.view.throwArc = null;
    S.view.throwInfo = null;
    S.hoverKey = '';
  }

  function previewMove(p) {
    const u = sel();
    S.view.cursor = 'move';
    if (!u || S.B.side !== 'xcom' || u.status === 'panic') return;
    if (p.unitId !== null && p.unitId !== undefined) {
      const t = unitOf(p.unitId);
      S.view.cursor = t && t.side === 'xcom' ? 'move' : 'target';
      return;
    }
    const i = idxOf(p.x, p.y, p.z);
    // ⌥ premido: abrir a porta sem entrar (custo da porta, sem caminho)
    const door = doorAt(u, p);
    if (S.alt && door) {
      S.view.cursor = door.ok ? 'move' : 'none';
      const label = door.ok ? T('hud.door.open', { tu: door.tu }) : door.reason === 'noTU' ? T('hud.target.noTU', { tu: door.tu, have: u.tu | 0 }) : door.reason === 'tooFar' ? T('hud.door.far') : T('bs.' + door.reason);
      S.view.path = { steps: [{ i: door.i, tu: null, state: door.ok ? 'ok' : 'out' }], label, lock: false, noLine: true, door: true };
      return;
    }
    if (i === tileOfUnit(u)) return;
    const wp = OV.Act.walkPreview(S.B, u, i, { reserveMode: reserveMode() });
    if (!wp || !wp.tiles.length) {
      // sem caminho: destino a vermelho e o motivo (não esperar pelo clique para o saber)
      S.view.cursor = 'none';
      const known = !!(S.B.map.disc[i] & 1);
      S.view.path = { steps: [{ i, tu: null, state: 'out' }], label: T(known ? 'bs.blocked' : 'hud.path.unknown'), lock: false, noLine: true };
      return;
    }
    const STATES = ['ok', 'reserve', 'out'];
    const many = S.view.cam.zoom >= 1;
    const steps = wp.tiles.map((t, k) => ({ i: t, tu: many && k < wp.tiles.length - 1 ? wp.tus[k] : null, state: STATES[wp.marks[k]] || 'ok' }));
    const out = wp.marks.some((m) => m === 2);
    // custo e o que sobra (as duas partes dizem o mesmo: UT gastas → UT que ficam)
    const left = Math.max(0, (u.tu | 0) - wp.tu);
    // destino que come a reserva de UT: o motor recusa-o — dizê-lo já, com o mesmo texto da recusa
    const res = out ? null : walkReserve(u, wp.tu);
    let label = out ? T('hud.path.out', { tu: wp.tu, have: u.tu | 0 })
      : res ? T('hud.path.reserve', { tu: wp.tu, left, res: res.tu, what: res.what })
        : T('hud.path', { tu: wp.tu, left, energy: Math.max(0, (u.energy | 0) - wp.energy) });
    if (S.lock === i) label = T(confirmVia() === 'tap' ? 'hud.confirmMove.tap' : confirmVia() === 'key' ? 'hud.confirmMove.key' : 'hud.confirmMove') + ' · ' + label;
    // porta no destino: ⌥ + clique abre-a sem entrar — com o custo só quando o soldado está ao lado dela (sem ⌥ no toque)
    let sub = null;
    if (door && !out && !isTouch()) {
      const via = confirmVia() === 'key' ? '.key' : isMac() ? '.mac' : '';
      if (door.ok || door.reason === 'noTU') sub = T('hud.door.hint' + via, { tu: door.tu });
      else if (door.reason === 'tooFar') sub = T('hud.door.hint.far' + via);
    }
    if (res) sub = T(isTouch() ? 'hud.path.reserve.fix.touch' : 'hud.path.reserve.fix');
    S.view.path = { steps, label, sub, subCol: res ? 'reserve' : null, lock: S.lock === i };
  }
  // reserva de UT que um passeio de `tu` UT comeria (a mesma conta do motor: OV.Act.validate → 'reserved') ou null
  function walkReserve(u, tu) {
    const r = OV.Act.reserveTU(S.B, u, { standing: true }) | 0;
    if (!(r > 0 && r <= (u.tu | 0)) || (u.tu | 0) - tu >= r) return null;
    const parts = [];
    if (S.B.reserve && S.B.reserve !== 'none') parts.push(T('mode.' + S.B.reserve));
    if (S.B.reserveKneel) parts.push(T('hud.path.reserve.kneel'));
    return { tu: r, what: parts.join(' + ') || T('hud.reserve') };
  }

  // probabilidade de acerto em cache (RNG próprio da interface: nunca as streams da simulação)
  function hitChance(u, it, mode, target, tkey) {
    const key = [u.id, u.x, u.y, u.z, u.kneel ? 1 : 0, u.dir, it.id, mode, tkey, S.ver].join('|');
    const c = S.hitCache.get(key);
    if (c !== undefined) return c;
    const pct = OV.Combat.hitChance(S.B, u, it.id, mode, target, S.uiRng, tune('HIT_PREVIEW_SAMPLES', 100));
    if (S.hitCache.size > 300) S.hitCache.clear();
    S.hitCache.set(key, pct);
    return pct;
  }
  function previewTarget(p) {
    const u = sel();
    S.view.cursor = 'target';
    if (!u || !S.aim) return;
    const it = itemOf(S.aim.itemId);
    if (!it) return;
    const i = idxOf(p.x, p.y, p.z);
    const tu = p.unitId !== null && p.unitId !== undefined ? unitOf(p.unitId) : null;
    const tgtUnit = tu && tu !== u ? tu : null;
    const toI = tgtUnit ? tileOfUnit(tgtUnit) : i;
    const T0 = { fromId: u.id, toI, hitPct: null, blocked: false, line: null, label: null, sub: null };
    if (S.aim.kind === 'psi') {
      const v = OV.Act.validate(S.B, { type: 'psi', unitId: u.id, targetId: tgtUnit ? tgtUnit.id : -1, kind: S.aim.psiKind });
      T0.blocked = !v.ok;
      T0.label = v.ok ? T('hud.target.psi', { tu: v.tu }) : T('bs.' + v.reason);
      S.view.target = T0;
      return;
    }
    if (S.aim.mode === 'melee') {
      const v = OV.Act.validate(S.B, { type: 'melee', unitId: u.id, hand: S.aim.hand, targetId: tgtUnit ? tgtUnit.id : -1 });
      T0.blocked = !v.ok;
      if (v.ok) {
        const pct = Math.min(100, OV.Combat.accuracy(S.B, u, it.id, 'melee'));
        T0.hitPct = pct;
        T0.label = T('hud.target.melee', { pct, tu: v.tu });
      } else T0.label = v.reason === 'noTU' ? T('hud.target.noTU', { tu: v.tu, have: u.tu | 0 }) : T('bs.' + v.reason);
      S.view.target = T0;
      return;
    }
    const target = tgtUnit ? { unitId: tgtUnit.id } : { i };
    const v = OV.Act.validate(S.B, { type: 'shoot', unitId: u.id, hand: S.aim.hand, mode: S.aim.mode, target, force: !!S.force });
    const blocked = !v.ok && v.reason === 'noLOF';
    // linha de tiro: da boca da arma até ao primeiro obstáculo
    let aim = OV.LOS.targetVoxel(S.B, u, tgtUnit || toI);
    if (!aim) {
      const [x, y, z] = xyzOf(toI);
      aim = tgtUnit ? OV.Combat.unitCentre(tgtUnit) : [x * 16 + 8, y * 16 + 8, z * 24 + 2];
    }
    const origin = OV.LOS.originVoxel(S.B, u, aim);
    const tr = OV.LOS.traceShot(S.B, origin, aim, u.id, 0);
    T0.line = [origin, tr.kind === 'none' ? aim : tr.voxel];
    // bomba guiada: a rota (Path.flyRoute) contorna obstáculos — desenhá-la em vez da linha reta tapada
    const guided = !!(OV.Data.items[it.type] && OV.Data.items[it.type].guided);
    const route = guided && v.ok && Array.isArray(v.route) && v.route.length > 1 ? v.route : null;
    if (route) {
      T0.line = route.map((ti, k) => {
        if (k === 0) return origin;
        if (k === route.length - 1) return aim;
        const [x, y, z] = xyzOf(ti);
        return [x * 16 + 8, y * 16 + 8, z * 24 + 12];
      });
      T0.route = true;
    }
    // aliado (ou civil) visível no caminho do tiro: é sempre o aviso principal
    const fr = !route && tr.kind === 'unit' && (!tgtUnit || tr.unitId !== tgtUnit.id) ? unitOf(tr.unitId) : null;
    const friend = fr && fr.side !== 'alien' && seen(fr) ? fr : null;
    if (friend) {
      T0.sub = T('bs.friendlyRisk');
      T0.subCol = 'out';
    }
    // o menu mostra o custo do tiro; aqui pode somar-se o rodar até ao alvo — dizê-lo evita a surpresa
    const baseTU = OV.BUnits.actionTU(S.B, u, it.id, S.aim.mode) | 0;
    if (v.ok) {
      if (S.force && !tgtUnit) T0.label = T('hud.target.force', { tu: v.tu });
      else if (settings().hitPreview === false) T0.label = T('bs.cost', { tu: v.tu });
      else {
        const pct = hitChance(u, it, S.aim.mode, tgtUnit || toI, tgtUnit ? 'u' + tgtUnit.id + '@' + toI : 't' + toI);
        T0.hitPct = pct;
        T0.label = T(v.tu > baseTU ? 'hud.target.turn' : 'hud.target', { pct, tu: v.tu });
      }
    } else {
      T0.blocked = true;
      if (blocked) {
        if (friend) T0.label = T('hud.target.friendBlocks', { name: uname(friend) });
        else {
          const what = { object: 'object', west: 'wall', north: 'wall', floor: 'floor', unit: 'unit' }[tr.kind];
          T0.label = what ? T('hud.target.blockedBy', { what: T('hud.target.what.' + what) }) : T('hud.target.noLOF');
          if (what && what !== 'unit' && tr.i >= 0 && tr.i !== toI) T0.blockI = tr.i;
        }
      } else if (v.reason === 'noTU') {
        T0.label = T(v.tu > baseTU ? 'hud.target.noTUTurn' : 'hud.target.noTU', { tu: v.tu, have: u.tu | 0 });
      }
      else T0.label = T('bs.' + v.reason);
      if (blocked && !friend) T0.sub = T(isMac() ? 'hud.hint.forceFire.mac' : 'hud.hint.forceFire');
    }
    // munição explosiva: área prevista, o rótulo fala da explosão (não do acerto direto) e aviso de aliados no raio
    if (v.ok && S.aim.mode !== 'melee') {
      T0.blast = blastPreview(u, it, toI);
      if (T0.blast && !T0.blast.smoke) {
        T0.label = T(S.force && !tgtUnit ? 'hud.target.blastForce' : tgtUnit ? 'hud.target.blast' : 'hud.target.blastTile', { r: T0.blast.r, tu: v.tu });
        T0.hitPct = null;
      }
      if (route) {
        T0.hitPct = hitChance(u, it, S.aim.mode, tgtUnit || toI, 'g' + toI);
        T0.label = T('hud.target.guided', { n: route.length - 1, pct: T0.hitPct, tu: v.tu });
        if (T0.blast && !T0.blast.smoke && !T0.sub) T0.sub = T('hud.target.guided.blast', { r: T0.blast.r });
      }
      if (T0.blast && T0.blast.risk && (!T0.sub || route)) {
        T0.sub = Tn('hud.throw.risk', T0.blast.risk, { n: T0.blast.risk });
        T0.subCol = 'out';
      }
    }
    if (S.tapLock === toI && !T0.blocked) {
      const risk = T0.blast && T0.blast.risk && blastConfirm(settings(), S.B.mission && S.B.mission.difficulty) ? T0.blast.risk : 0;
      T0.sub = risk ? Tn('hud.confirmBlast.' + confirmVia(), risk, { n: risk }) : T(confirmKey('hud.confirmFire'));
      T0.subCol = risk ? 'out' : null;
      T0.lock = true;
    }
    S.view.target = T0;
  }

  // plano de arremesso: TU totais (mover para a mão + ativar + lançar + rodar)
  function throwPlanTU(u, plan, toI) {
    const it = itemOf(plan.itemId);
    let tu = 0;
    if (plan.inv) tu += OV.Data.invMoveTU(slotOf(u, it), plan.inv) | 0;
    if (plan.fuse !== null && plan.fuse !== undefined) tu += OV.BUnits.actionTU(S.B, u, it.id, 'prime') | 0;
    tu += OV.BUnits.actionTU(S.B, u, it.id, 'throw') | 0;
    const [tx, ty] = xyzOf(toI);
    if (tx !== u.x || ty !== u.y) tu += OV.Act.turnSteps(u.dir, OV.U.dirTo(tx - u.x, ty - u.y)) * tune('TU_TURN', 1);
    return tu;
  }
  function previewThrow(p) {
    const u = sel();
    S.view.cursor = 'throw';
    if (!u || !S.throwPlan) return;
    const it = itemOf(S.throwPlan.itemId);
    if (!it) return;
    const i = idxOf(p.x, p.y, p.z);
    const range = OV.Data.throwRange(u.stats.str | 0, itemWeight(it));
    const dx = p.x - u.x, dy = p.y - u.y, dz = OV.U.idiv((p.z - u.z) * 3, 2);
    const dist = OV.U.isqrt(dx * dx + dy * dy + dz * dz);
    const plan = OV.Act.planArc(S.B, u, i);
    const tu = throwPlanTU(u, S.throwPlan, i);
    let label, ok = false;
    if (dist > range) label = T('hud.throw.far', { r: range });
    else if (!plan) label = T(underRoof(u) ? 'hud.throw.roof' : underRoof(p) ? 'hud.throw.targetRoof' : 'hud.throw.noArc');
    else if (tu > (u.tu | 0)) label = T('hud.throw.noTU', { tu, have: u.tu | 0 });
    else {
      ok = true;
      label = T('hud.throw', { tu });
    }
    if (plan) S.view.throwArc = OV.Act.traceArc(S.B, u, plan.origin, plan.target, plan.curve).arc;
    const toI = plan ? plan.goal : i;
    const blast = blastPreview(u, it, toI);
    let sub = blast && blast.risk ? Tn('hud.throw.risk', blast.risk, { n: blast.risk }) : null;
    if (ok && S.tapLock === i) {
      const risk = blast && blast.risk && blastConfirm(settings(), S.B.mission && S.B.mission.difficulty) ? blast.risk : 0;
      if (risk) sub = Tn('hud.confirmBlast.' + confirmVia(), risk, { n: risk });
      else label = T(confirmKey('hud.confirmThrow')) + ' · ' + label;
    }
    S.view.throwInfo = { toI, ok, label, range, from: { x: u.x, y: u.y, z: u.z }, blast, sub, lock: ok && S.tapLock === i };
  }
  // há chão no nível de cima (teto da nave, de um OVNI, de um edifício): nenhum arco sai daqui nem lá entra
  function underRoof(u) {
    const m = S.B.map;
    return u.z + 1 < m.d && !!m.parts[idxOf(u.x, u.y, u.z + 1) * 4];
  }
  // raio útil da explosão de uma granada (alcance até a potência se esgotar: −HE_FALLOFF por tile, máx. o raio do item)
  // e quantos aliados visíveis lá estão — só pré-visualização, o motor decide o resto
  function blastPreview(u, it, toI) {
    const d0 = defOf(it);
    if (!d0) return null;
    // granada: o próprio item; arma de explosivos (foguete, canhão HE, Blaster): a munição carregada
    const d = d0.kind === 'grenade' ? d0 : d0.kind === 'firearm' && it.ammo ? OV.Data.items[it.ammo.type] : d0.kind === 'firearm' ? d0 : null;
    if (!d || !(d.radius > 0) || !d.dmg || d.dmg === 'AP' || d.dmg === 'LASER' || d.dmg === 'PLASMA') return null;
    const smoke = d.dmg === 'SMOKE';
    const pw = d.dmg === 'IN' ? (d.power | 0) >> 1 : d.power | 0;
    const r = smoke ? d.radius | 0 : Math.max(1, Math.min(d.radius | 0, Math.floor((pw - 1) / tune('HE_FALLOFF', 10))));
    const [x, y, z] = xyzOf(toI);
    let risk = 0;
    if (!smoke) {
      for (const f of S.B.units) {
        if (f.side === 'alien' || !f.onMap || !LIVE[f.status] || f.z !== z || !seen(f)) continue;
        const dx = f.x - x, dy = f.y - y;
        if (dx * dx + dy * dy <= r * r) risk++;
      }
    }
    return { x, y, z, r, smoke, risk };
  }

  // ---- modos ------------------------------------------------------------------------------------------------
  /* a dica permanente do cursor de teclado (setas, Enter…) fica KB_HINT_MS à vista no início de cada turno e some
     (não tapa os soldados do fundo do ecrã o combate inteiro); ? volta a mostrá-la. As dicas de apontar/lançar ficam. */
  const KB_HINT_MS = 6000;
  function setHint(text) {
    if (!S.hud) return;
    let t = text || '';
    if (t && t === T('hud.hint.kb')) {
      const now = realNow();
      if (!S.kbHint || S.kbHint.turn !== S.B.turn) S.kbHint = { turn: S.B.turn, until: now + KB_HINT_MS };
      if (now >= S.kbHint.until) t = '';
    }
    S.hud.hint.textContent = t;
    S.hud.hint.classList.toggle('on', !!t);
  }
  // ? : mostrar de novo a dica do teclado durante KB_HINT_MS
  function showKbHint() {
    if (!S || !S.hud) return;
    S.kbHint = { turn: S.B.turn, until: realNow() + KB_HINT_MS };
    setHint(modeHint());
  }
  function cancelMode(silent) {
    const was = S.mode !== 'move' || S.lock >= 0;
    S.mode = 'move';
    S.aim = null;
    S.throwPlan = null;
    S.lock = -1;
    S.tapLock = -1;
    S.view.cursor = 'move';
    S.view.throwRange = null;
    if (isTouch()) S.mouse = null;
    if (S.kcur.armed && S.kcur.auto) {
      S.kcur.armed = false;
      S.kcur.auto = false;
      S.view.kcur = null;
    }
    setHint(kbHint());
    S.hoverKey = '';
    refreshHover();
    S.hudDirty = true;
    if (was && !silent) sfx('ui_click');
    return was;
  }
  // dica permanente enquanto o cursor de teclado está à vista (modo de movimento)
  function kbHint() {
    return S.kcur.armed && kbOn() && S.mode === 'move' ? T('hud.hint.kb') : '';
  }
  // dica do modo atual para o meio de entrada em uso (teclado, toque ou rato)
  function modeHint() {
    const via = S.kcur.armed && kbOn() ? '.kb' : isTouch() ? '.touch' : '';
    if (S.mode === 'target') return T('hud.hint.target' + via, { mode: S.aimLabel || '' });
    if (S.mode === 'throw') return T('hud.hint.throw' + via);
    return kbHint();
  }
  function enterTarget(hand, mode, psiKind) {
    const u = sel();
    const it = handItem(u, hand);
    if (!u || !it) return;
    closeMenu();
    S.mode = 'target';
    S.aim = { hand, mode, itemId: it.id, kind: mode === 'psi' ? 'psi' : 'shoot', psiKind: psiKind || null };
    S.throwPlan = null;
    S.lock = -1;
    S.tapLock = -1;
    S.view.cursor = 'target';
    S.view.throwRange = null;
    const label = mode === 'psi' ? T(psiKind === 'control' ? 'hud.menu.psiControl' : 'hud.menu.psiPanic') : T('mode.' + mode);
    S.aimLabel = label;
    kbAutoAim();
    setHint(modeHint());
    S.hoverKey = '';
    refreshHover();
    S.hudDirty = true;
    sfx('ui_click');
  }
  function enterThrow(plan) {
    const u = sel();
    if (!u) return;
    closeMenu();
    S.mode = 'throw';
    S.throwPlan = plan;
    S.aim = null;
    S.lock = -1;
    S.tapLock = -1;
    S.view.cursor = 'throw';
    const it = itemOf(plan.itemId);
    S.view.throwRange = { x: u.x, y: u.y, z: u.z, r: OV.Data.throwRange(u.stats.str | 0, itemWeight(it)) };
    kbAutoAim();
    setHint(modeHint());
    S.hoverKey = '';
    refreshHover();
    S.hudDirty = true;
    sfx('ui_click');
  }

  // ---- execução de ações ---------------------------------------------------------------------------------
  async function playGen(gen) {
    S.playing = true;
    // um Espaço premido agora ou a meio da reprodução acelera-a e nunca conta como «Feito»; um clique de pressa
    // vale só para esta reprodução
    S.spaceIdle = false;
    S.clickFast = false;
    S.view.reach = null;
    clearPreview();
    closeMenu();
    if (S.hud) S.hud.root.classList.add('playing');
    try {
      await OV.Presenter.play(S.B, gen, S.pctx);
    } catch (e) {
      console.error(e);
    }
    if (!S) return;
    S.playing = false;
    if (S.hud) S.hud.root.classList.remove('playing');
    afterAction();
  }
  function afterAction() {
    S.hitCache.clear();
    if (S.B.phase === 'over' || OV.Battle.outcome(S.B)) {
      finishBattle();
      return;
    }
    // toque: a pré-visualização só vive entre o 1.º e o 2.º toque (nada de caminhos «fantasma» no último toque)
    if (isTouch()) S.mouse = null;
    ensureSelection();
    invalidate();
    updateMusic();
  }
  async function act(a) {
    if (!S || S.playing || S.ended) return { ok: false };
    closeReport();
    const v = OV.Act.validate(S.B, a);
    if (!v.ok) {
      deny(v.reason);
      return v;
    }
    await playGen(OV.Act.perform(S.B, a));
    return v;
  }
  async function actSeq(list) {
    for (const a of list) {
      if (!S || S.ended) return;
      const v = await act(a);
      if (!v.ok || !S || S.B.phase === 'over') return;
    }
  }

  function clickMove(p, mods, pointerType) {
    const u = sel();
    if (!u) {
      toast('hud.selectFirst', null, 'info');
      return;
    }
    if (u.status === 'panic') {
      deny(null);
      toast('hud.panicking', { name: uname(u) }, 'warn');
      return;
    }
    const i = idxOf(p.x, p.y, p.z);
    if (mods && mods.alt) {
      tryDoor(u, p);
      return;
    }
    if (i === tileOfUnit(u)) return;
    const confirm = needConfirm(pointerType);
    if (confirm && S.lock !== i) {
      S.lock = i;
      S.hoverKey = '';
      if (!S.mouse && !S.kcur.armed) S.mouse = { x: 0, y: 0 };
      refreshHover();
      sfx('ui_click');
      return;
    }
    S.lock = -1;
    const a = { type: 'walk', unitId: u.id, to: i };
    const v = OV.Act.validate(S.B, a);
    if (!v.ok && v.reason === 'reserved') {
      // o mesmo texto da etiqueta do caminho: quanto está reservado e para quê
      const wp = OV.Act.walkPreview(S.B, u, i, { reserveMode: reserveMode() });
      const res = wp ? walkReserve(u, wp.tu) : null;
      deny(res ? 'hud.path.reserve.deny' + (isTouch() ? '.touch' : '') : 'reserved', res ? { res: res.tu, what: res.what } : null);
      return;
    }
    act(a);
  }
  function needConfirm(pointerType) {
    const m = settings().confirmMove || 'auto';
    // teclado: o caminho já está à vista antes do Enter — só com «Sempre»
    if (pointerType === 'kb') return m === 'always' || m === 'on' || m === true;
    if (pointerType === 'touch' || isTouch()) return true;
    // o ecrã de opções grava 'always'/'never' (aceitam-se também 'on'/'off' e booleanos antigos)
    if (m === 'always' || m === 'on' || m === true) return true;
    if (m === 'never' || m === 'off' || m === false) return false;
    return !!(OV.Input && OV.Input.usedTrackpad);
  }
  // porta no tile apontado (ou nas arestas este/sul, que pertencem aos vizinhos): {ok, tu, reason, i, a} | null
  function doorAt(u, p) {
    const m = S.B.map;
    const cands = [{ i: idxOf(p.x, p.y, p.z) }];
    if (p.x + 1 < m.w) cands.push({ i: idxOf(p.x + 1, p.y, p.z), part: 1 });
    if (p.y + 1 < m.h) cands.push({ i: idxOf(p.x, p.y + 1, p.z), part: 2 });
    let first = null;
    for (const c of cands) {
      const a = { type: 'door', unitId: u.id, i: c.i, part: c.part };
      const v = OV.Act.validate(S.B, a);
      if (v.ok) return { ok: true, tu: v.tu | 0, reason: null, i: c.i, a };
      if (!first && v.reason !== 'noDoor' && v.reason !== 'invalid') first = { ok: false, tu: v.tu | 0, reason: v.reason, i: c.i, a };
    }
    return first;
  }
  function tryDoor(u, p) {
    const d = doorAt(u, p);
    if (d && d.ok) {
      act(d.a);
      return;
    }
    deny(d ? d.reason : 'noDoor');
  }
  // aliados (e o próprio atirador) no raio de uma explosão que exige 2.ª confirmação
  function blastRisk(u, it, i) {
    if (!it || !blastConfirm(settings(), S.B.mission && S.B.mission.difficulty)) return 0;
    const b = blastPreview(u, it, i);
    return b && !b.smoke ? b.risk | 0 : 0;
  }
  /* 2.ª confirmação de explosivos com aliados no raio: o 2.º clique de um duplo clique (detail > 1) ou um clique a
     menos de CONFIRM_GAP ms do que armou a confirmação não conta — a criança que clica depressa vê sempre o aviso */
  const CONFIRM_GAP = 400;
  // pura (testada em Node): o clique que chega dt ms depois de armar a confirmação ainda não conta?
  function confirmEarly(pointerType, detail, dt) {
    if (pointerType === 'kb') return false;
    return (detail | 0) > 1 || dt < CONFIRM_GAP;
  }
  const confirmTooSoon = (pointerType, detail) => confirmEarly(pointerType, detail, realNow() - (S.tapLockT || 0));
  function armConfirm(i, risky) {
    S.tapLock = i;
    S.tapLockT = realNow();
    S.hoverKey = '';
    refreshHover();
    sfx(risky ? 'ui_deny' : 'ui_click');
  }
  function clickTarget(p, mods, pointerType, kbForce, detail) {
    const u = sel();
    if (!u || !S.aim) return;
    const tu = p.unitId !== null && p.unitId !== undefined ? unitOf(p.unitId) : null;
    const tgt = tu && tu !== u ? tu : null;
    const i = tgt ? tileOfUnit(tgt) : idxOf(p.x, p.y, p.z);
    const force = kbForce === undefined ? forceMods(mods) : !!kbForce;
    let a;
    if (S.aim.kind === 'psi') a = { type: 'psi', unitId: u.id, targetId: tgt ? tgt.id : -1, kind: S.aim.psiKind };
    else if (S.aim.mode === 'melee') a = { type: 'melee', unitId: u.id, hand: S.aim.hand, targetId: tgt ? tgt.id : -1 };
    else a = { type: 'shoot', unitId: u.id, hand: S.aim.hand, mode: S.aim.mode, target: tgt ? { unitId: tgt.id } : { i }, force };
    const v = OV.Act.validate(S.B, a);
    if (!v.ok) {
      S.tapLock = -1;
      deny(v.reason);
      return;
    }
    // toque: 1.º toque mostra, 2.º dispara; explosivo com aliados no raio: 2.º clique/Enter no mesmo alvo
    const risky = a.type === 'shoot' && blastRisk(u, itemOf(S.aim.itemId), i) > 0;
    if ((pointerType === 'touch' || isTouch() || risky) && S.tapLock !== i) {
      armConfirm(i, risky);
      return;
    }
    if (risky && confirmTooSoon(pointerType, detail)) return;
    S.tapLock = -1;
    S.lastFire = { unitId: u.id, action: a };
    cancelMode(true);
    act(a);
  }
  function clickThrow(p, pointerType, detail) {
    const u = sel();
    if (!u || !S.throwPlan) return;
    const i = idxOf(p.x, p.y, p.z);
    const info = S.view.throwInfo;
    if (!info || !info.ok) {
      deny(null);
      if (info) toast(info.label, null, 'warn');
      return;
    }
    const risky = !!(info.blast && !info.blast.smoke && info.blast.risk && blastConfirm(settings(), S.B.mission && S.B.mission.difficulty));
    if ((pointerType === 'touch' || isTouch() || risky) && S.tapLock !== i) {
      armConfirm(i, risky);
      return;
    }
    if (risky && confirmTooSoon(pointerType, detail)) return;
    S.tapLock = -1;
    const plan = S.throwPlan;
    const steps = [];
    if (plan.inv) steps.push({ type: 'inv', unitId: u.id, itemId: plan.itemId, to: plan.inv });
    if (plan.fuse !== null && plan.fuse !== undefined) steps.push({ type: 'prime', unitId: u.id, itemId: plan.itemId, fuse: plan.fuse });
    steps.push({ type: 'throw', unitId: u.id, itemId: plan.itemId, toI: i });
    cancelMode(true);
    actSeq(steps);
  }

  // ---- comandos de teclado / botões -----------------------------------------------------------------------
  function cmdKneel() {
    const u = sel();
    if (!u) return toast('hud.selectFirst', null, 'info');
    act({ type: 'kneel', unitId: u.id });
  }
  function cmdReload() {
    const u = sel();
    if (!u) return toast('hud.selectFirst', null, 'info');
    let reason = null;
    for (const h of ['R', 'L']) {
      const it = handItem(u, h);
      const d = defOf(it);
      if (!d || d.kind !== 'firearm' || !Array.isArray(d.ammo) || !d.ammo.length) continue;
      const a = { type: 'reload', unitId: u.id, hand: h };
      const v = OV.Act.validate(S.B, a);
      if (v.ok) {
        act(a);
        return;
      }
      if (!reason) reason = v.reason;
    }
    if (reason) deny(reason);
    else toast('hud.noReload', null, 'info');
  }
  function cmdDone() {
    const u = sel();
    if (!u) return;
    act({ type: 'endUnit', unitId: u.id }).then(() => {
      if (S && !S.ended) cycle(1);
    });
  }
  function freeHand(u) {
    if (u.items.L === null || u.items.L === undefined) return 'L';
    if (u.items.R === null || u.items.R === undefined) return 'R';
    return null;
  }
  // melhor granada/sinalizador: mãos primeiro, depois cinto e mochila (maior poder)
  function findThrowable(u, kinds) {
    const cands = [];
    for (const slot of ['R', 'L', 'belt', 'pack']) {
      const ids = slot === 'R' || slot === 'L' ? [u.items[slot]] : u.items[slot] || [];
      for (const id of ids) {
        const it = itemOf(id);
        const d = defOf(it);
        if (!d || kinds.indexOf(d.kind) < 0 || d.proximity || (d.dmg === 'SMOKE' && kinds[0] === 'grenade')) continue;
        cands.push({ it, d, slot, score: (slot === 'R' || slot === 'L' ? 1000 : slot === 'belt' ? 500 : 0) + (d.power | 0) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0] || null;
  }
  function cmdQuickThrow(kind) {
    const u = sel();
    if (!u) return toast('hud.selectFirst', null, 'info');
    const c = findThrowable(u, kind === 'flare' ? ['flare'] : ['grenade']);
    if (!c) return toast(kind === 'flare' ? 'hud.noFlare' : 'hud.noGrenade', null, 'info');
    let inv = null;
    if (c.slot !== 'R' && c.slot !== 'L') {
      inv = freeHand(u);
      if (!inv) {
        deny(null);
        toast('hud.handsFull', null, 'warn');
        return;
      }
    }
    const fuse = c.d.kind === 'grenade' && c.d.prime && !(c.it.fuse >= 0) ? 0 : null;
    enterThrow({ itemId: c.it.id, inv, fuse });
  }
  function cmdFireAgain() {
    const u = sel();
    const lf = S.lastFire;
    if (!u || !lf || lf.unitId !== u.id) return toast('hud.noLastShot', null, 'info');
    const a = Object.assign({}, lf.action);
    if (a.target && a.target.unitId !== undefined) {
      const t = unitOf(a.target.unitId);
      if (!t || !LIVE[t.status] || !t.onMap) return toast('bs.noTarget', null, 'warn');
    }
    act(a);
  }
  function setReserve(mode) {
    if (S.playing) return;
    // preferência do jogador (não decide resultados por si: só limita as próprias ações)
    S.B.reserve = mode;
    sfx('ui_click');
    invalidate();
  }
  function toggleReserveKneel() {
    if (S.playing) return;
    S.B.reserveKneel = !S.B.reserveKneel;
    sfx('ui_click');
    invalidate();
  }
  function centreAlien(n) {
    const list = visibleAliens();
    const a = list[n];
    if (!a) return;
    if (a.z > S.view.viewZ) setViewZ(a.z);
    centreUnit(a);
    sfx('ui_click');
  }
  function openInventory(unitId) {
    const id = unitId === undefined || unitId === null ? S && S.selId : unitId;
    if (!S || id === null || id === undefined || S.playing) return;
    if (OV.InventoryUI && typeof OV.InventoryUI.open === 'function') {
      closeMenu();
      cancelMode(true);
      const r = OV.InventoryUI.open(S.B, id, invOpts());
      if (r && typeof r.then === 'function') r.then(() => S && invalidate());
    } else toast('hud.noInventory', null, 'info');
  }
  // o inventário e o kit médico executam pelas mesmas ações animadas do Battlescape
  function invOpts() {
    return {
      onClose: () => S && invalidate(),
      perform: (a) => (S ? act(a) : Promise.resolve({ ok: false })),
      select: (uid) => S && select(uid, { quiet: true }),
    };
  }
  function openMedikit(u, it) {
    if (OV.InventoryUI && typeof OV.InventoryUI.medikit === 'function') {
      closeMenu();
      cancelMode(true);
      const r = OV.InventoryUI.medikit(S.B, u.id, it.id, invOpts());
      if (r && typeof r.then === 'function') r.then(() => S && invalidate());
    } else openMedPage(u, it);
  }

  async function endTurn() {
    if (!S || S.playing || S.ended || S.B.side !== 'xcom') return;
    if (settings().confirmEndTurn !== false && squad().some(canAct)) {
      const box = el('label', { class: 'bs-check' }, el('input', { type: 'checkbox' }), ' ' + T('bs.endTurn.dontAsk'));
      const body = el('div', null, el('p', { class: 'modal-text', text: T('bs.endTurn.confirm') }), box);
      const ok = await OV.Dom.modal({
        title: T('hud.endTurn.title'), body,
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('bs.endTurn'), value: true, kind: 'primary' }],
      });
      if (!ok || !S) return;
      if (box.querySelector('input').checked) {
        settings().confirmEndTurn = false;
        if (OV.Game.saveSettings) OV.Game.saveSettings();
      }
    }
    cancelMode(true);
    closeMenu();
    closeReport();
    sfx('ui_confirm');
    S.lastFire = null;
    const mark = S.log.length;
    await playGen(OV.Battle.endPlayerTurn(S.B));
    if (!S || S.ended) return;
    if (isTouch()) S.mouse = null;
    playerTurnHook();
    const u = squad().filter(selectable).find(hasTU);
    if (u) select(u.id, { centre: true, quiet: true });
    // o que aconteceu aos nossos durante o turno alienígena (os avisos passam depressa demais)
    // e as granadas alienígenas ativadas à vista (Recruta): a mesma janela, com «Mostrar» a centrar em cada uma
    const hurt = turnReportRows(S.log.slice(mark)).concat(warnGrenades());
    if (hurt.length) openReport('turn', hurt);
  }
  /* Recruta: granadas alienígenas ativadas no chão à vista (rebentam no fim deste turno) ficam com o raio marcado
     e um aviso, para o principiante ter tempo de afastar os soldados */
  function grenadeDangers() {
    const out = [], vt = S.B._ && S.B._.visTiles;
    for (const it of S.B.items) {
      if (!(it.fuse >= 0) || typeof it.at !== 'number' || it.at < 0 || !S.alienNades.has(it.id)) continue;
      if (vt ? !vt[it.at] : !(S.B.map.disc[it.at] & 1)) continue;
      const b = blastPreview(null, it, it.at);
      if (b && !b.smoke) out.push({ x: b.x, y: b.y, z: b.z, r: b.r, risk: b.risk, itemId: it.id, i: it.at });
    }
    return out;
  }
  // → linhas para o relatório do turno (vazio fora de Recruta ou sem granadas à vista)
  function warnGrenades() {
    if (!S || S.ended || ((S.B.mission && S.B.mission.difficulty) | 0) !== 0) {
      if (S) S.view.dangers = null;
      return [];
    }
    const list = grenadeDangers();
    S.view.dangers = list.length ? list : null;
    return list.map((g) => ({ key: g.risk ? 'hud.alienGrenade' : 'hud.alienGrenade.clear', params: null, kind: 'bad', ic: '✱', at: g.i, from: -1, own: true }));
  }
  // as marcas somem quando a granada rebenta ou é apanhada
  function pruneDangers() {
    const D0 = S.view.dangers;
    if (!D0) return;
    const keep = D0.filter((g) => {
      const it = itemOf(g.itemId);
      return it && it.fuse >= 0 && it.at === g.i;
    });
    if (keep.length !== D0.length) S.view.dangers = keep.length ? keep : null;
  }

  // ---- relatório do turno alienígena e registo de mensagens --------------------------------------------------
  /* entrada do registo a partir de um evento (pura: lê B, nunca o altera). ctx = {last: {}, seenAt: {}} guarda
     entre eventos o último dano de cada unidade e onde se viu cada atacante. Devolve {key, params, kind, own, at,
     from} (texto por OV.T) ou null. */
  function logEntry(B, ev, ctx) {
    const C = ctx || { last: {}, seenAt: {} };
    const find = (id) => (id === null || id === undefined ? null : OV.BUnits.findUnit(B, id));
    const nm = (u) => (u ? u.name || (u.nameKey ? T(u.nameKey) : T('hud.unit.alien')) : '');
    const mine = (u) => !!u && u.origSide === 'xcom';
    const seenNow = (u) => !!u && (u.side === 'xcom' || (OV.LOS && OV.LOS.isVisibleTo && OV.LOS.isVisibleTo(B, 'xcom', u)));
    const atkId = ev.shooterId !== undefined ? ev.shooterId : ev.attackerId !== undefined ? ev.attackerId : ev.t === 'throw' ? ev.unitId : null;
    if ((ev.t === 'shot' || ev.t === 'throw' || ev.t === 'melee' || ev.t === 'psi') && atkId !== null && atkId !== undefined) {
      const a = find(atkId);
      if (a && a.side !== 'xcom' && ev.vis && seenNow(a)) C.seenAt[a.id] = typeof ev.pos === 'number' ? ev.pos : (a.z * B.map.h + a.y) * B.map.w + a.x;
    }
    const how = (u, killerId) => {
      const L = C.last[u.id] || {};
      const a = find(killerId !== undefined && killerId !== null ? killerId : L.attackerId);
      const who = !a ? null : mine(a) ? nm(a) : C.seenAt[a.id] !== undefined || seenNow(a) ? nm(a) : T('hud.log.unseen');
      const area = L.dmgType === 'HE' || L.dmgType === 'IN' || (L.dmgType === 'STUN' && L.cause !== 'melee');
      let k = 'other';
      if (L.cause === 'fire' || L.cause === 'burn') k = 'fire';
      else if (L.cause === 'wounds') k = 'wounds';
      else if (L.cause === 'smoke') k = 'smoke';
      else if (L.cause === 'melee') k = 'melee';
      else if (area || L.cause === 'grenade' || L.cause === 'unitDeath' || L.cause === 'tile' || L.cause === 'powerSource') k = who ? 'explosion' : 'blast';
      else if (L.cause === 'shot') k = 'shot';
      if (!who && (k === 'shot' || k === 'melee' || k === 'other')) return T('hud.log.how.' + k, { who: T('hud.log.unseen') });
      return T('hud.log.how.' + k, { who: who || '' });
    };
    const fromOf = (u, killerId) => {
      const a = find(killerId !== undefined && killerId !== null ? killerId : (C.last[u.id] || {}).attackerId);
      return a && C.seenAt[a.id] !== undefined ? C.seenAt[a.id] : -1;
    };
    // atacante que ninguém viu (id) ou -1: no início do turno seguinte o clarão pode tê-lo revelado
    const hidOf = (u, killerId) => {
      const a = find(killerId !== undefined && killerId !== null ? killerId : (C.last[u.id] || {}).attackerId);
      return a && !mine(a) && C.seenAt[a.id] === undefined && !seenNow(a) ? a.id : -1;
    };
    const tileOf = (u) => (typeof ev.pos === 'number' && ev.pos >= 0 ? ev.pos : typeof ev.i === 'number' ? ev.i : u && u.x >= 0 ? (u.z * B.map.h + u.y) * B.map.w + u.x : -1);
    if (ev.t === 'damage') {
      const u = find(ev.unitId);
      if (!u) return null;
      C.last[u.id] = { dmgType: ev.dmgType, cause: ev.cause, attackerId: ev.attackerId };
      if (!mine(u) || !(ev.amount > 0) || u.hp <= 0 || ev.cause === 'wounds' || ev.cause === 'burn' || ev.cause === 'fire' || ev.cause === 'smoke') return null;
      return { key: gk(ev.wounds > 0 ? 'hud.log.hitWound' : 'hud.log.hit', u), params: { name: nm(u), n: ev.amount, how: how(u) }, kind: 'warn', own: true, at: tileOf(u), from: fromOf(u), hid: hidOf(u) };
    }
    if (ev.t === 'death') {
      const u = find(ev.unitId);
      if (!u) return null;
      if (mine(u)) return { key: gk('hud.log.kia', u), params: { name: nm(u), how: how(u, ev.killerId) }, kind: 'bad', own: true, at: tileOf(u), from: fromOf(u, ev.killerId), hid: hidOf(u, ev.killerId) };
      const k = find(ev.killerId);
      if (u.origSide === 'alien' && k && mine(k)) return { key: 'hud.log.alienKilled', params: { name: nm(u), by: nm(k) }, kind: 'good', own: false, at: tileOf(u), from: -1 };
      if (u.origSide === 'civ' && ev.vis) return { key: 'hud.log.civKilled', params: { name: nm(u) }, kind: 'warn', own: false, at: tileOf(u), from: -1 };
      return null;
    }
    if (ev.t === 'stun') {
      const u = find(ev.unitId);
      if (!u) return null;
      if (mine(u)) return { key: 'hud.log.stunned', params: { name: nm(u), how: how(u, ev.attackerId) }, kind: 'bad', own: true, at: tileOf(u), from: fromOf(u, ev.attackerId), hid: hidOf(u, ev.attackerId) };
      if (u.origSide === 'alien' && ev.vis) return { key: 'hud.log.alienStunned', params: { name: nm(u) }, kind: 'good', own: false, at: tileOf(u), from: -1 };
      return null;
    }
    if (ev.t === 'morale' && ev.kind !== 'change') {
      const u = find(ev.unitId);
      if (!mine(u)) return null;
      const key = { berserk: 'bs.morale.berserk', freeze: 'bs.morale.freeze', flee: 'bs.morale.flee' }[ev.kind] || 'bs.morale.panic';
      return { key: gk(key, u), params: { name: nm(u) }, kind: 'warn', own: true, at: tileOf(u), from: -1 };
    }
    if (ev.t === 'psi' && ev.kind === 'control' && ev.success) {
      const u = find(ev.targetId);
      if (!mine(u)) return null;
      return { key: gk('bs.psi.control', u), params: { name: nm(u) }, kind: 'bad', own: true, at: tileOf(u), from: fromOf(u, ev.attackerId) };
    }
    if (ev.t === 'zombify') {
      // unitId é o zombie novo; fromId é o soldado (ou civil) que se transformou
      const u = find(ev.fromId);
      if (!mine(u)) return null;
      return { key: gk('bs.ev.zombify', u), params: { name: nm(u) }, kind: 'bad', own: true, at: tileOf(find(ev.unitId)), from: -1 };
    }
    return null;
  }
  function noteEvent(ev) {
    if (!S) return;
    if (ev.t === 'throw') {
      const a = unitOf(ev.unitId);
      if (a && a.side === 'alien') S.alienNades.add(ev.itemId);
    }
    const e = logEntry(S.B, ev, S.logCtx);
    if (!e) return;
    e.turn = S.B.turn;
    e.side = S.B.side;
    S.log.push(e);
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
  }
  function closeReport() {
    if (!S || !S.hud || !S.report) return false;
    S.report = null;
    // o foco estava num botão do painel: devolvê-lo ao jogo (nunca fica num nó removido)
    if (S.hud.report.contains(document.activeElement)) document.activeElement.blur();
    S.hud.report.classList.add('hidden');
    OV.Dom.clear(S.hud.report);
    return true;
  }
  // Tab / ⇧Tab com o painel aberto: percorre Fechar e os «Mostrar» (Enter ou Espaço ativa o botão com foco)
  function reportTab(dir) {
    const list = Array.from(S.hud.report.querySelectorAll('button'));
    if (!list.length) return;
    const k = list.indexOf(document.activeElement);
    const n = list[k < 0 ? (dir > 0 ? 0 : list.length - 1) : (k + dir + list.length) % list.length];
    n.focus({ preventScroll: true });
    n.scrollIntoView({ block: 'nearest' });
  }
  // kind 'turn' (início do turno: só o que aconteceu aos nossos) ou 'log' (registo inteiro, mais recente primeiro)
  function openReport(kind, list) {
    if (!S || !S.hud) return;
    if (S.report && S.report.kind === kind && kind === 'log') {
      closeReport();
      return;
    }
    const R = S.hud.report;
    OV.Dom.clear(R);
    S.report = { kind };
    const rows = kind === 'log' ? S.log.slice(-80).reverse() : list;
    R.classList.toggle('tips', kind === 'tips');
    const head = el('div', { class: 'bs-report-head' },
      el('span', { class: 'bs-report-title', text: T(kind === 'log' ? 'hud.log.title' : kind === 'tips' ? 'hud.tips.title' : 'hud.report.title') }),
      kind === 'turn' ? el('span', { class: 'bs-report-sum', text: reportSummary(rows) }) : null);
    const closeLabel = T(kind === 'tips' ? 'hud.tips.ok' : 'hud.report.close');
    const close = el('button', { class: 'btn small', type: 'button' }, closeLabel, el('span', { class: 'key', text: 'Esc' }));
    close.addEventListener('click', () => {
      sfx('ui_click');
      closeReport();
    });
    tip(close, closeLabel, 'Esc');
    head.appendChild(close);
    const listEl = el('div', { class: 'bs-report-list', 'data-scroll': '1', role: 'log' });
    let lastTurn = null;
    for (const e of rows) {
      if (kind === 'log' && (e.turn + ':' + e.side) !== lastTurn) {
        lastTurn = e.turn + ':' + e.side;
        listEl.appendChild(el('div', { class: 'bs-report-turn', text: T('hud.log.turn', { n: e.turn, side: T('bs.side.' + e.side) }) }));
      }
      if (e.kind === 'sect') {
        listEl.appendChild(el('div', { class: 'bs-report-turn', text: T(e.key) }));
        continue;
      }
      // atacante não visto que agora está à vista (o clarão do disparo revelou-o): dizê-lo e mostrar onde está
      const rev = kind === 'turn' ? revealed(e) : null;
      const row = el('div', { class: 'bs-report-row ' + e.kind },
        el('span', { class: 'bs-report-ic', 'aria-hidden': 'true', text: e.ic || (e.kind === 'bad' ? '✖' : e.kind === 'good' ? '✔' : '!') }),
        el('span', { class: 'bs-report-txt', text: T(e.key, e.params) + (rev ? T(rev.flash ? 'hud.report.revealed' : 'hud.report.nowSeen') : '') }));
      const from = rev ? rev.i : e.from;
      const where = from >= 0 ? from : e.at;
      if (where >= 0) {
        const b = el('button', { class: 'btn small', type: 'button', text: T(from >= 0 ? 'hud.report.showFrom' : 'hud.report.show') });
        b.addEventListener('click', () => {
          const [x, y, z] = xyzOf(where);
          if (z !== S.view.viewZ) setViewZ(z);
          centreOn(x, y, z, reduceMotion() ? 0 : 260);
          if (S.kcur.armed) {
            S.kcur.x = x;
            S.kcur.y = y;
            S.hoverKey = '';
            refreshHover();
          }
          sfx('ui_click');
        });
        tip(b, T(rev ? 'hud.report.showRevealed.tip' : from >= 0 ? 'hud.report.showFrom.tip' : 'hud.report.show.tip'));
        row.appendChild(b);
      }
      listEl.appendChild(row);
    }
    if (!rows.length) listEl.appendChild(el('div', { class: 'bs-report-none muted', text: T('hud.log.empty') }));
    R.append(head, listEl);
    R.classList.remove('hidden');
    // quem joga com o teclado fica com o foco no painel (Tab chega aos «Mostrar», Esc fecha)
    if (S.lastInput === 'kb') close.focus({ preventScroll: true });
    sfx(kind === 'turn' ? 'ui_deny' : 'ui_click', { vol: 0.7 });
  }
  // {i: tile do atacante, flash: o tile dele tem um clarão} se o atacante escondido da entrada está agora à vista
  function revealed(e) {
    if (!(e.hid >= 0)) return null;
    const a = OV.BUnits.findUnit(S.B, e.hid);
    if (!a || !a.onMap || !LIVE[a.status] || a.side === 'xcom' || !OV.LOS.isVisibleTo(S.B, 'xcom', a)) return null;
    const i = idxOf(a.x, a.y, a.z);
    return { i, flash: (S.B.flashes || []).some((f) => f.i === i) };
  }
  // primeira missão: três conselhos (não bloqueia o mapa; Esc ou «Fechar» fecha)
  function tipRows() {
    return ['spread', 'kneel', 'keepTU'].map((k, n) => ({ key: 'hud.tips.' + k + (isTouch() && OV.T.has('hud.tips.' + k + '.touch') ? '.touch' : ''), params: null, kind: 'tip', ic: String(n + 1), at: -1, from: -1 }));
  }
  function openTips() {
    openReport('tips', tipRows());
  }
  function reportSummary(rows) {
    // por soldado: quem morreu não conta também como ferido; pânico/descontrolo do início do turno à parte
    const deadN = new Set(rows.filter((e) => /^hud\.log\.kia/.test(e.key)).map((e) => e.params.name));
    const hurtN = new Set(rows.filter((e) => (/^hud\.log\.hit/.test(e.key) || /^hud\.log\.stunned/.test(e.key)) && !deadN.has(e.params.name)).map((e) => e.params.name));
    const panicN = new Set(rows.filter((e) => /^bs\.morale\./.test(e.key) && !deadN.has(e.params.name)).map((e) => e.params.name));
    const dead = deadN.size, hurt = hurtN.size, panic = panicN.size;
    const parts = [];
    if (dead) parts.push(Tn('hud.report.dead', dead));
    if (hurt) parts.push(Tn('hud.report.hurt', hurt));
    if (panic) parts.push(Tn('hud.report.panic', panic));
    return parts.join(' · ');
  }
  /* entradas do registo desde o fim do turno X-COM → linhas do relatório: o que aconteceu aos nossos no turno
     alienígena e, à parte, no início do turno X-COM (pânico, descontrolo, mortes por hemorragia) */
  function turnReportRows(entries) {
    const rows = entries.filter((e) => e.own && e.side !== 'xcom');
    const start = entries.filter((e) => e.own && e.side === 'xcom');
    if (start.length) rows.push({ key: 'hud.report.turnStart', params: null, kind: 'sect', at: -1, from: -1 }, ...start);
    return rows;
  }

  // início de um turno do jogador sem gerador ativo: avisa quem abriu a cena (gravação automática da campanha)
  function playerTurnHook() {
    if (!S || S.ended || !S.onPlayerTurn || S.B.side !== 'xcom' || S.B.phase === 'over') return;
    try { S.onPlayerTurn(S.B); } catch (e) { console.warn('onPlayerTurn', e); }
  }

  async function abortMission() {
    if (!S || S.playing || S.ended) return;
    const craft = new Set(S.B.craftTiles || []);
    const n = squad().filter((u) => selectable(u) && OV.BUnits.unitTiles(u, S.B.map).some((i) => craft.has(i))).length;
    const body = el('div', null, el('p', { class: 'modal-text', text: T('bs.abort.confirm') }), el('p', { class: 'modal-text muted', text: Tn('hud.abort.onCraft', n) }));
    // ninguém a bordo: a nave fica no terreno e perde-se (o relatório desconta-a)
    if (!n) body.appendChild(el('p', { class: 'modal-text bs-abort-lose', text: T('hud.abort.loseCraft') }));
    const ok = await OV.Dom.modal({
      title: T('hud.abort.title'), body, cls: 'alert',
      buttons: [{ label: T('common.cancel'), value: false }, { label: T(n ? 'bs.abort' : 'hud.abort.loseCraftBtn'), value: true, kind: 'danger' }],
    });
    if (!ok || !S || S.ended) return;
    OV.Battle.abort(S.B);
    finishBattle();
  }

  async function finishBattle() {
    if (!S || S.ended) return;
    S.ended = true;
    const B = S.B;
    const outcome = B.result || OV.Battle.outcome(B) || 'abort';
    cancelMode(true);
    closeMenu();
    clearPreview();
    S.view.reach = null;
    if (S.hud) S.hud.root.classList.add('ended');
    if (OV.audio) OV.audio.stinger(outcome === 'win' ? 'victory' : 'defeat');
    showBanner(T('hud.banner.' + outcome), outcome === 'win' ? 'win' : 'loss');
    await delay(1700);
    if (!S || S.B !== B) return;
    showBanner(null);
    const debrief = OV.Battle.debrief(B);
    const result = { outcome, debrief, B };
    if (S.onExit) {
      S.onExit(result);
      return;
    }
    if (OV.SceneDefs.debrief) {
      OV.Scenes.replace('debrief', { B, debrief, outcome });
      return;
    }
    await summaryModal(debrief, outcome);
    if (OV.SceneDefs.menu && S && S.B === B) OV.Scenes.set('menu');
  }
  function summaryModal(d, outcome) {
    const rows = d.lines.map((l) => el('tr', null,
      el('td', { text: T(l.key) }), el('td', { class: 'num', text: String(l.n) }), el('td', { class: 'num ' + (l.points < 0 ? 'bad' : 'good'), text: (l.points > 0 ? '+' : '') + l.points })));
    const body = el('div', { class: 'bs-summary' },
      el('p', { class: 'modal-text', text: Tn('hud.end.turns', d.turns) }),
      el('table', { class: 'tbl' }, el('tbody', null, rows)),
      el('p', { class: 'bs-summary-score', text: T('hud.end.score', { n: d.score }) }));
    return OV.Dom.modal({ title: T('bs.result.' + outcome), body, wide: false, buttons: [{ label: T('hud.end.continue'), value: true, kind: 'primary' }], cls: outcome === 'win' ? '' : 'alert' });
  }

  // ---- opções ------------------------------------------------------------------------------------------------
  function openOptions() {
    if (OV.SceneDefs.options) {
      OV.Scenes.push('options', { from: 'battlescape' });
      return;
    }
    const s = settings();
    const save = () => {
      if (OV.Game.saveSettings) OV.Game.saveSettings();
      if (S) invalidate();
    };
    const seg = (key, opts) => {
      const box = el('div', { class: 'bs-seg' });
      for (const [v, label] of opts) {
        const b = el('button', { class: 'btn small' + (String(s[key]) === String(v) ? ' on' : ''), type: 'button', text: label });
        b.addEventListener('click', () => {
          s[key] = v;
          for (const c of box.children) c.classList.remove('on');
          b.classList.add('on');
          save();
        });
        box.appendChild(b);
      }
      return box;
    };
    const check = (key, def) => {
      const inp = el('input', { type: 'checkbox' });
      inp.checked = s[key] === undefined ? def : !!s[key];
      inp.addEventListener('change', () => {
        s[key] = inp.checked;
        save();
      });
      return inp;
    };
    const row = (label, ctrl) => el('div', { class: 'bs-opt-row' }, el('span', { text: label }), ctrl);
    const crow = (label, ctrl) => el('label', { class: 'bs-opt-row check' }, ctrl, el('span', { text: label }));
    const speeds = [[1, '×1'], [2, '×2'], [4, '×4']];
    const body = el('div', { class: 'bs-opts' },
      row(T('hud.opt.speedXcom'), seg('speedXcom', speeds)),
      row(T('hud.opt.speedAlien'), seg('speedAlien', speeds)),
      row(T('hud.opt.confirmMove'), seg('confirmMove', [['auto', T('hud.opt.confirm.auto')], ['always', T('hud.opt.confirm.on')], ['never', T('hud.opt.confirm.off')]])),
      row(T('hud.opt.wheel'), seg('wheel', [['level', T('hud.opt.wheel.level')], ['zoom', T('hud.opt.wheel.zoom')]])),
      crow(T('hud.opt.edgeScroll'), check('edgeScroll', false)),
      crow(T('hud.opt.confirmEndTurn'), check('confirmEndTurn', true)),
      crow(T('hud.opt.hitPreview'), check('hitPreview', true)),
      crow(T('hud.opt.sound'), check('sound', true)),
      crow(T('hud.opt.music'), check('music', true)),
      el('p', { class: 'bs-opt-keys' }, el('b', { text: T('hud.opt.keys') + ': ' }), T('hud.opt.keysList')));
    OV.Dom.modal({
      title: T('hud.opt.title'), body, wide: false,
      buttons: [{ label: T('bs.abort'), value: 'abort', kind: 'danger' }, { label: T('hud.opt.resume'), value: true, kind: 'primary' }],
    }).then((v) => {
      if (v === 'abort') abortMission();
    });
  }

  // ---- música --------------------------------------------------------------------------------------------
  function updateMusic() {
    if (!S || !OV.audio) return;
    const mood = S.B.mission.kind === 'terror' ? 'terror' : visibleAliens().length ? 'battle_tense' : 'battle';
    if (mood !== S.mood) {
      S.mood = mood;
      OV.audio.music(mood);
    }
  }

  // ---- HUD ---------------------------------------------------------------------------------------------------
  function btn(cls, iconName, title, key, onClick, extra) {
    const b = el('button', { class: 'bs-btn ' + (cls || ''), type: 'button', html: icon(iconName) });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (!S || S.ended) return;
      if (S.playing) {
        OV.Presenter.hurry();
        return;
      }
      onClick(e);
    });
    tip(b, title, key, extra);
    return b;
  }

  function buildHud() {
    const host = document.getElementById('hud');
    const root = el('div', { class: 'bs-hud passthru' });
    const H = { root };

    // topo esquerdo: missão e turno
    H.top = el('div', { class: 'bs-top panel' });
    // esquerda: equipa
    H.squad = el('div', { class: 'bs-squad' });
    // direita: mapa e alienígenas
    H.right = el('div', { class: 'bs-right passthru' });
    H.mini = el('div', { class: 'bs-mini panel hidden' });
    H.miniCanvas = el('canvas', { class: 'bs-mini-canvas' });
    H.mini.appendChild(H.miniCanvas);
    H.miniCanvas.addEventListener('click', onMiniClick);
    H.aliens = el('div', { class: 'bs-aliens' });
    H.right.append(H.mini, H.aliens);

    // banners
    H.hiddenHurry = el('small', { class: 'bs-hidden-hurry' });
    H.hidden = el('div', { class: 'bs-hidden', role: 'status' }, el('span', { class: 'bs-hidden-dot' }), el('span', { text: T('hud.banner.hidden') }), H.hiddenHurry);
    H.report = el('div', { class: 'bs-report panel hidden', role: 'dialog', 'aria-label': T('hud.report.title') });
    H.bLog = el('button', { class: 'bs-btn bs-logbtn', type: 'button', html: icon('log') });
    H.bLog.addEventListener('click', (e) => {
      e.preventDefault();
      if (!S || S.ended) return;
      openReport('log');
    });
    tip(H.bLog, T('hud.log.title'), 'N', T('hud.log.tip'));
    H.banner = el('div', { class: 'bs-banner' });
    H.hint = el('div', { class: 'bs-hint' });

    // baixo: cartão, consola, fim de turno
    H.card = el('div', { class: 'bs-card panel' });
    H.console = el('div', { class: 'bs-console panel' });
    H.hands = el('div', { class: 'bs-hands' });
    H.handL = el('button', { class: 'bs-hand', type: 'button', dataset: { hand: 'L' } });
    H.handR = el('button', { class: 'bs-hand', type: 'button', dataset: { hand: 'R' } });
    for (const [b, h, k] of [[H.handL, 'L', 'Q'], [H.handR, 'R', 'E']]) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (!S || S.ended) return;
        if (S.playing) return OV.Presenter.hurry();
        openMenu(h);
      });
      tip(b, () => T('hud.hand.' + h), k, () => T('hud.tip.hand'));
    }
    H.hands.append(H.handL, H.handR);

    H.tools = el('div', { class: 'bs-tools' });
    H.level = el('div', { class: 'bs-level' },
      btn('bs-lv', 'up', T('hud.levelUp'), '.', () => setViewZ(S.view.viewZ + 1)),
      H.levelText = el('span', { class: 'bs-level-txt' }),
      btn('bs-lv', 'down', T('hud.levelDown'), ',', () => setViewZ(S.view.viewZ - 1)));
    H.bKneel = btn('', 'kneel', T('hud.btn.kneel'), 'K', cmdKneel);
    H.bInv = btn('', 'inventory', T('hud.btn.inventory'), 'I', () => openInventory());
    H.bCentre = btn('', 'centre', T('hud.btn.centre'), 'C', () => centreUnit(sel()));
    H.bMap = btn('', 'map', T('hud.btn.map'), 'M', toggleMini);
    H.bPrev = btn('', 'prev', T('hud.btn.prev'), '⇧Tab', () => cycle(-1));
    H.bNext = btn('', 'next', T('hud.btn.next'), 'Tab', () => cycle(1));
    H.bDone = btn('', 'done', T('hud.btn.done'), T('hud.key.space'), cmdDone);
    H.bReload = btn('', 'reload', T('hud.btn.reload'), 'R', cmdReload);
    H.bGrenade = btn('', 'grenade', T('hud.btn.grenade'), 'G', () => cmdQuickThrow('grenade'), T('hud.tip.grenade'));
    H.bFlare = btn('', 'flare', T('hud.btn.flare'), 'L', () => cmdQuickThrow('flare'));
    H.bOpts = btn('', 'options', T('hud.btn.options'), 'Esc', openOptions);
    H.bAbort = btn('danger', 'abort', T('hud.btn.abort'), 'X', abortMission, T('hud.tip.abort'));
    H.grid = el('div', { class: 'bs-grid' }, H.bKneel, H.bInv, H.bReload, H.bGrenade, H.bFlare, H.bMap, H.bPrev, H.bNext, H.bDone, H.bCentre, H.bOpts, H.bAbort);
    H.tools.append(H.level, H.grid);

    // reservas de UT
    H.reserve = el('div', { class: 'bs-reserve' });
    H.res = {};
    const RES = [['none', 'rNone', 'Shift+1'], ['snap', 'rSnap', 'Shift+2'], ['aimed', 'rAimed', 'Shift+3'], ['auto', 'rAuto', 'Shift+4']];
    for (const [mode, ic, key] of RES) {
      const b = btn('bs-res', ic, T('bs.reserve.' + mode), key, () => setReserve(mode), T('hud.reserve.tip'));
      H.res[mode] = b;
      H.reserve.appendChild(b);
    }
    H.resKneel = btn('bs-res', 'kneel', T('bs.reserve.kneel'), 'J', toggleReserveKneel);
    H.reserve.appendChild(H.resKneel);
    H.reserveBox = el('div', { class: 'bs-reserve-box' }, el('div', { class: 'bs-cap', text: T('hud.reserve') }), H.reserve);

    H.console.append(H.hands, H.tools, H.reserveBox);

    H.end = el('button', { class: 'bs-end', type: 'button' }, el('span', { class: 'bs-end-ic', html: icon('endturn') }), el('span', { class: 'bs-end-txt', text: T('hud.btn.endTurnShort') }), el('span', { class: 'key', text: '↵' }));
    H.end.addEventListener('click', (e) => {
      e.preventDefault();
      if (!S || S.ended) return;
      if (S.playing) return OV.Presenter.hurry();
      endTurn();
    });
    tip(H.end, T('hud.btn.endTurn'), 'Enter', T('hud.tip.endTurn'));

    H.bottom = el('div', { class: 'bs-bottom passthru' }, H.card, H.console, H.end);
    H.menu = el('div', { class: 'bs-menu panel hidden', role: 'menu' });

    // leitura de desempenho (só com ?debug=1): fps e tempo de desenho
    H.perf = OV.Game && OV.Game.debug ? el('div', { class: 'bs-perf', 'aria-hidden': 'true' }) : null;
    root.append(H.top, H.squad, H.right, H.hidden, H.banner, H.hint, H.report, H.bottom, H.menu);
    if (H.perf) root.appendChild(H.perf);
    host.appendChild(root);
    S.hud = H;
    S.sig = {};
  }

  // banner central (turno, pânico, resultado)
  function showBanner(text, kind) {
    if (!S || !S.hud) return;
    const b = S.hud.banner;
    clearTimeout(S.bannerTimer);
    if (!text) {
      b.classList.remove('on');
      return;
    }
    b.className = 'bs-banner ' + (kind || '');
    b.textContent = '';
    b.appendChild(el('span', { text }));
    void b.offsetWidth;
    b.classList.add('on');
  }
  function showHidden(on) {
    if (!S || !S.hud) return;
    clearTimeout(S.hiddenTimer);
    if (on) S.hud.hiddenHurry.textContent = T(isTouch() ? 'hud.banner.hurry.touch' : 'hud.banner.hurry');
    if (on) S.hud.hidden.classList.add('on');
    else S.hiddenTimer = setTimeout(() => S && S.hud && S.hud.hidden.classList.remove('on'), 350);
  }

  function rankAbbr(u) {
    if (u.type !== 'soldier' || typeof u.rank !== 'number') return '';
    const r = OV.Data.ranks.soldier[u.rank];
    return r ? T(r.abbrKey) : '';
  }
  function rankName(u) {
    if (u.type !== 'soldier' || typeof u.rank !== 'number') return '';
    const r = OV.Data.ranks.soldier[u.rank];
    return r ? T(r.nameKey) : '';
  }
  const woundsOf = (u) => (u.wounds || []).reduce((s, w) => s + (w | 0), 0);

  function portraitCanvas(u, size) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = el('canvas', { class: 'bs-portrait-c', width: Math.round(size * dpr), height: Math.round(size * dpr) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      if (u.type === 'soldier' && OV.Portraits) {
        OV.Portraits.draw(g, { portraitSeed: u.portraitSeed, female: u.female, nat: u.nat, armour: u.armourId, rank: u.rank }, 0, 0, size);
      } else if (OV.UnitSprites) {
        g.fillStyle = '#16222e';
        g.fillRect(0, 0, size, size);
        const spr = OV.UnitSprites.get(u.sprite || 'soldier', 3, 'stand', 0, dpr * 1.3, { team: u.origSide || u.side, armour: u.armourId || 'coveralls' });
        const sc = Math.min((size * 0.92) / spr.h, (size * 0.92) / spr.w, 1.3);
        g.drawImage(spr.c, size / 2 - spr.ax * sc, size * 0.95 - spr.ay * sc, spr.w * sc, spr.h * sc);
      }
    } catch (e) {
      g.fillStyle = '#16222e';
      g.fillRect(0, 0, size, size);
    }
    return c;
  }
  function iconCanvas(type, size) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = el('canvas', { class: 'bs-item-c', width: Math.round(size * dpr), height: Math.round(size * dpr) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (OV.ItemSprites) OV.ItemSprites.drawIcon(g, type, 0, 0, size);
    return c;
  }
  function barRow(kind, label, long, v, max, extra, tipExtra) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    const bar = el('div', { class: 'bar bar-' + kind }, el('i', { style: { width: pct.toFixed(1) + '%' } }));
    if (extra) bar.appendChild(extra);
    bar.appendChild(el('span', { text: v + '/' + max }));
    const r = el('div', { class: 'bs-bar-row' }, el('label', { text: label }), bar);
    tip(r, long, null, tipExtra || null);
    return r;
  }

  function renderCard(u) {
    const H = S.hud;
    const sig = u ? [u.id, u.tu, u.energy, u.hp, u.stun, u.morale, u.kneel, u.status, u.done, woundsOf(u), u.burn, u.kills, u.armourId, (u.armour || []).join(',')].join('|') : 'none';
    if (S.sig.card === sig) return;
    S.sig.card = sig;
    OV.Dom.clear(H.card);
    if (!u) {
      H.card.appendChild(el('div', { class: 'bs-card-empty muted', text: T('hud.noSoldier') }));
      return;
    }
    const port = el('div', { class: 'bs-portrait' }, portraitCanvas(u, 72));
    const ab = rankAbbr(u);
    if (ab) port.appendChild(el('span', { class: 'bs-rank r' + (u.rank | 0), text: ab }));
    const stunPct = u.hpMax > 0 ? Math.max(0, Math.min(100, (Math.min(u.stun | 0, u.hp) / u.hpMax) * 100)) : 0;
    const stunEl = stunPct > 0 ? el('b', { class: 'stun', style: { width: stunPct.toFixed(1) + '%' } }) : null;
    const bars = el('div', { class: 'bs-bars' },
      barRow('tu', T('hud.bar.tu'), T('hud.bar.tu.long'), u.tu | 0, u.tuMax | 0),
      barRow('en', T('hud.bar.en'), T('hud.bar.en.long'), u.energy | 0, u.energyMax | 0 || u.stats.sta | 0),
      barRow('hp', T('hud.bar.hp'), T('hud.bar.hp.long') + ((u.stun | 0) > 0 ? ' · ' + T('hud.stun', { n: u.stun }) : ''), Math.max(0, u.hp | 0), u.hpMax | 0, stunEl,
        (u.stun | 0) > 0 ? T('hud.tip.stun') : null),
      barRow('mo', T('hud.bar.mo'), T('hud.bar.mo.long'), u.morale | 0, 100, null, T('hud.tip.morale')));
    const chips = el('div', { class: 'bs-status' });
    const chip = (cls, text, title) => {
      const c = el('span', { class: 'bs-chip ' + cls, text });
      if (title) tip(c, title);
      chips.appendChild(c);
    };
    if (u.kneel) chip('kneel', T(gk('bs.status.kneel', u)));
    const w = woundsOf(u);
    if (w > 0) chip('bleed', T('bs.status.bleeding', { n: w }), T('hud.wounds', { n: w }));
    if (u.status === 'panic') chip('panic', T('bs.status.panic'));
    if (u.burn > 0) chip('burn', T('bs.status.burning'));
    if (u.done) chip('done', T('hud.done'));
    const ar = u.armour || [];
    const armourTip = T('hud.armourValues', { f: ar[0] | 0, s: Math.min(ar[1] | 0, ar[2] | 0), r: ar[3] | 0, u: ar[4] | 0 });
    const sub = el('div', { class: 'bs-sub' }, el('span', { text: [rankName(u), u.armourId ? T('armour.' + u.armourId) : ''].filter(Boolean).join(' · ') }));
    tip(sub, T('hud.armour', { name: u.armourId ? T('armour.' + u.armourId) : '—' }), null, armourTip);
    if (u.kills) sub.appendChild(el('span', { class: 'bs-kills', text: Tn('hud.kills', u.kills | 0) }));
    const main = el('div', { class: 'bs-card-main' }, el('div', { class: 'bs-name', text: uname(u) }), sub, bars, chips);
    H.card.append(port, main);
  }

  function renderHand(b, u, h) {
    const it = handItem(u, h);
    const d = defOf(it);
    const ammo = it && it.ammo ? it.ammo.rounds + '/' + ((OV.Data.items[it.ammo.type] || {}).rounds | 0) : '';
    const sig = u ? [u.id, h, it ? it.id + ':' + it.type + ':' + ammo + ':' + it.fuse : '-', S.menu && S.menu.hand === h ? 1 : 0, S.mode, S.aim ? S.aim.hand : ''].join('|') : '-';
    if (S.sig['hand' + h] === sig) return;
    S.sig['hand' + h] = sig;
    OV.Dom.clear(b);
    b.classList.toggle('open', !!(S.menu && S.menu.hand === h));
    b.classList.toggle('aiming', !!(S.aim && S.aim.hand === h));
    b.classList.toggle('empty', !it);
    b.appendChild(el('span', { class: 'bs-hand-key', text: h === 'L' ? 'Q' : 'E' }));
    if (!it) {
      b.appendChild(el('span', { class: 'bs-hand-name muted', text: T('hud.hand.empty') }));
      return;
    }
    b.appendChild(iconCanvas(it.type, 46));
    b.appendChild(el('span', { class: 'bs-hand-name', text: handName(it.type) }));
    b.setAttribute('aria-label', T('hud.hand.' + h) + ': ' + T(d.nameKey) + ' (' + (h === 'L' ? 'Q' : 'E') + ')');
    if (!researchedOk(u, it.type)) b.appendChild(el('span', { class: 'bs-hand-lock', text: '?', title: T('bs.notResearched') }));
    if (d.kind === 'firearm' && Array.isArray(d.ammo) && d.ammo.length) {
      b.appendChild(el('span', { class: 'bs-hand-ammo' + (it.ammo ? '' : ' empty'), text: it.ammo ? ammo : T('hud.ammo.empty') }));
    }
    if (d.kind === 'grenade' && it.fuse >= 0) {
      const fz = el('span', { class: 'bs-hand-fuse', text: T('hud.fuse.badge', { n: it.fuse }) });
      fz.title = fuseText('hud.tip.fuse', it.fuse);
      b.appendChild(fz);
    }
  }

  function renderSquad() {
    const H = S.hud;
    const list = squad();
    const sig = list.map((u) => [u.id, u.tu, u.hp, u.status, u.done, u.side, u.onMap ? 1 : 0, u.id === S.selId ? 1 : 0].join(':')).join('|');
    if (S.sig.squad === sig) return;
    S.sig.squad = sig;
    OV.Dom.clear(H.squad);
    for (const u of list) {
      const alive = selectable(u);
      const row = el('button', { class: 'bs-sq' + (u.id === S.selId ? ' sel' : '') + (alive ? '' : ' gone') + (alive && !hasTU(u) ? ' spent' : '') + (u.status === 'panic' ? ' panic' : ''), type: 'button' });
      const tuPct = u.tuMax ? Math.max(0, Math.min(100, ((u.tu | 0) / u.tuMax) * 100)) : 0;
      const hpPct = u.hpMax ? Math.max(0, Math.min(100, ((u.hp | 0) / u.hpMax) * 100)) : 0;
      row.append(
        el('span', { class: 'bs-sq-rank r' + (u.rank | 0), text: rankAbbr(u) || '·' }),
        el('span', { class: 'bs-sq-name', text: uname(u) }),
        el('span', { class: 'bs-sq-bars' }, el('i', { class: 'tu', style: { width: tuPct.toFixed(0) + '%' } }), el('i', { class: 'hp', style: { width: hpPct.toFixed(0) + '%' } })));
      // pânico: ícone e texto (não só a cor da risca), também para leitores de ecrã
      const panic = alive && u.status === 'panic';
      if (panic) row.appendChild(el('span', { class: 'bs-sq-st', 'aria-hidden': 'true' }, el('b', { text: '⚠' }), T('hud.sq.panic')));
      const st = alive ? '' : u.status === 'dead' ? T(gk('bs.ev.kia', u), { name: uname(u) }) : u.mia ? T(gk('bs.status.mia', u)) : T('bs.status.stunned');
      if (alive) {
        row.addEventListener('click', () => {
          if (!S || S.playing || S.ended) return;
          select(u.id, { centre: false });
        });
        row.addEventListener('dblclick', () => S && centreUnit(u));
        tip(row, uname(u), null, (rankName(u) ? rankName(u) + ' · ' : '') + T('hud.bar.tu') + ' ' + (u.tu | 0) + ' · ' + T('hud.bar.hp') + ' ' + (u.hp | 0) + ' — ' + T(tk('hud.tip.squad')));
      } else {
        tip(row, uname(u), null, st);
      }
      // nome acessível com o estado (depois de tip, que o põe só com o nome)
      row.setAttribute('aria-label', !alive ? (u.status === 'dead' ? st : T('hud.sq.gone.aria', { name: uname(u), st }))
        : panic ? T('hud.sq.panic.aria', { name: uname(u) }) : hasTU(u) ? T('hud.sq.aria', { name: uname(u), tu: u.tu | 0, hp: u.hp | 0 }) : T('hud.sq.spent.aria', { name: uname(u) }));
      H.squad.appendChild(row);
    }
  }

  function renderAliens() {
    const H = S.hud;
    const list = visibleAliens();
    const sig = list.map((u) => u.id).join(',');
    if (S.sig.aliens === sig) return;
    S.sig.aliens = sig;
    OV.Dom.clear(H.aliens);
    list.forEach((u, k) => {
      const n = k + 1;
      const b = el('button', { class: 'bs-alien', type: 'button' },
        el('span', { class: 'bs-alien-ic', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><path d="M12 2.5c-5 0-8 3.6-8 8 0 4.6 4.3 9.6 8 11 3.7-1.4 8-6.4 8-11 0-4.4-3-8-8-8z" fill="currentColor"/><path d="M6.6 10.2c1.9-.2 3.7.8 4.2 2.6-1.9.4-3.7-.6-4.2-2.6zM17.4 10.2c-1.9-.2-3.7.8-4.2 2.6 1.9.4 3.7-.6 4.2-2.6z" fill="#120406"/></svg>' }),
        el('span', { class: 'bs-alien-n', text: String(n) }));
      b.addEventListener('click', () => S && centreAlien(k));
      tip(b, T('hud.tip.alien', { n, name: uname(u) }), n <= 10 ? String(n % 10) : null, T(tk('hud.tip.alienKeys'), { n: n % 10 }));
      H.aliens.appendChild(b);
    });
  }

  function renderTop() {
    const H = S.hud;
    const B = S.B;
    const sig = [B.turn, B.side, B.mission.kind, B.mission.night, B.mission.shade, S.log.length ? 1 : 0].join('|');
    if (S.sig.top === sig) return;
    S.sig.top = sig;
    OV.Dom.clear(H.top);
    // luz: noite (visão curta), meia-luz (crepúsculo, base alienígena, Marte: visão normal) ou dia
    const shade = B.mission.shade | 0;
    const phase = B.mission.night ? 'night' : shade > 0 ? (B.mission.kind === 'alienBase' || B.mission.kind === 'cydonia' ? 'dim' : 'dusk') : 'day';
    const pars = { nv: tune('NIGHT_VIEW', 9), d: tune('VIEW_DIST', 20) };
    H.top.append(
      el('span', { class: 'bs-top-title', text: T('bs.mission.' + B.mission.kind) }),
      el('span', { class: 'bs-top-sep' }),
      el('span', { class: 'bs-top-turn', text: T('hud.turn', { n: B.turn }) }),
      el('span', { class: 'bs-top-side ' + B.side, text: T('bs.side.' + B.side) }),
      tip(el('span', { class: 'bs-top-time ' + (phase === 'night' ? 'night' : phase === 'day' ? 'day' : 'dusk'), text: T('hud.' + phase) }),
        T('hud.' + phase), null, T(tk('hud.tip.' + phase), pars)),
      H.bLog);
  }

  function renderTools(u) {
    const H = S.hud;
    const B = S.B;
    H.levelText.textContent = T('hud.level', { z: S.view.viewZ + 1, d: B.map.d });
    const sig = [u ? u.id + ':' + u.kneel + ':' + u.tu : '-', B.reserve, B.reserveKneel, S.miniOn, S.mode, S.view.viewZ].join('|');
    if (S.sig.tools === sig) return;
    S.sig.tools = sig;
    for (const k of Object.keys(H.res)) H.res[k].classList.toggle('on', (B.reserve || 'none') === k);
    H.resKneel.classList.toggle('on', !!B.reserveKneel);
    H.bKneel.classList.toggle('on', !!(u && u.kneel));
    H.bMap.classList.toggle('on', !!S.miniOn);
    const noUnit = !u;
    for (const b of [H.bKneel, H.bInv, H.bReload, H.bGrenade, H.bFlare, H.bDone, H.bCentre]) b.disabled = noUnit;
  }

  function refreshHud() {
    if (!S || !S.hud) return;
    const u = sel();
    renderTop();
    renderCard(u);
    renderHand(S.hud.handL, u, 'L');
    renderHand(S.hud.handR, u, 'R');
    renderSquad();
    renderAliens();
    renderTools(u);
    S.hud.root.classList.toggle('alien-turn', S.B.side !== 'xcom');
    applyA11y();
  }
  // acessibilidade: paleta segura para daltonismo, movimento reduzido e escala das etiquetas do mapa
  function applyA11y() {
    const st = settings();
    const cvd = st.palette === 'cvd', rm = reduceMotion();
    const sig = (cvd ? 1 : 0) + '|' + (rm ? 1 : 0) + '|' + (+st.textScale || 1);
    if (S.sig.a11y === sig) return;
    S.sig.a11y = sig;
    S.hud.root.classList.toggle('cvd', cvd);
    S.hud.root.classList.toggle('rm', rm);
    document.body.classList.toggle('bs-cvd', cvd);
    document.body.classList.toggle('bs-rm', rm);
    S.view.palette = cvd ? 'cvd' : 'normal';
    S.view.reduceMotion = rm;
    S.view.textScale = Math.max(1, Math.min(1.5, +st.textScale || 1));
    if (OV.FX) OV.FX.reduceMotion = rm;
    OV.Presenter.reduceMotion = rm;
  }

  // ---- menu de ações -----------------------------------------------------------------------------------------
  // o motor recusa armas alienígenas por investigar (mesma regra que OV.Act: só lê B)
  function researchedOk(u, type) {
    const list = S.B.researched || (S.B.mission && S.B.mission.researched);
    if (!u || u.origSide !== 'xcom' || !Array.isArray(list)) return true;
    const d = OV.Data.items[type];
    return !d || !d.research || list.indexOf(d.research) >= 0;
  }
  function closeMenu() {
    if (!S || !S.hud || !S.menu) return;
    S.menu = null;
    S.hud.menu.classList.add('hidden');
    OV.Dom.clear(S.hud.menu);
    S.hudDirty = true;
  }
  function menuEntries(u, hand, it) {
    const d = defOf(it);
    const out = [];
    const tuOf = (mode) => OV.BUnits.actionTU(S.B, u, it.id, mode);
    const add = (e) => out.push(e);
    if (d.kind === 'firearm' || d.kind === 'melee') {
      const needsAmmo = Array.isArray(d.ammo) && d.ammo.length;
      const loaded = !needsAmmo || (it.ammo && it.ammo.rounds > 0);
      const known = researchedOk(u, it.type);
      for (const m of OV.Data.weaponModes(it.type)) {
        const tu = tuOf(m.mode);
        if (tu === null) continue;
        const acc = OV.Combat.accuracy(S.B, u, it.id, m.mode);
        const enabled = known && (m.mode === 'melee' || loaded) && tu <= (u.tu | 0);
        add({
          label: T('mode.' + m.mode) + (m.mode === 'auto' && m.shots > 1 ? ' ×' + m.shots : ''), cost: tu, acc,
          enabled, why: !known ? T('bs.notResearched') : !loaded && m.mode !== 'melee' ? T('bs.noAmmo') : tu > (u.tu | 0) ? T('bs.noTU') : '',
          run: () => enterTarget(hand, m.mode),
        });
      }
      if (needsAmmo) {
        const v = OV.Act.validate(S.B, { type: 'reload', unitId: u.id, hand });
        if (v.ok || v.reason === 'noTU') {
          add({ label: T('bs.action.reload'), cost: v.tu || tune('TU_RELOAD', 15), enabled: v.ok, why: v.ok ? '' : T('bs.noTU'), run: () => { closeMenu(); act({ type: 'reload', unitId: u.id, hand }); } });
        }
      }
    }
    if (d.kind === 'grenade') {
      if (d.prime && !(it.fuse >= 0)) {
        const tu = tuOf('prime');
        add({ label: T('bs.action.prime') + '…', cost: tu, enabled: tu <= (u.tu | 0), why: tu > (u.tu | 0) ? T('bs.noTU') : '', run: () => openFusePage(u, hand, it) });
      } else if (it.fuse >= 0) add({ label: T('hud.menu.primed', { n: it.fuse }), info: true, enabled: false });
    }
    if (d.kind === 'medikit') {
      add({ label: T('mode.use') + '…', cost: d.useTU || tune('TU_MEDIKIT', 10), enabled: true, run: () => openMedikit(u, it) });
    }
    if (d.kind === 'scanner') {
      const v = OV.Act.validate(S.B, { type: 'scanner', unitId: u.id, itemId: it.id });
      add({ label: T('bs.action.scanner'), cost: v.tu || tuOf('use') || 0, enabled: v.ok, why: v.ok ? '' : T('bs.' + v.reason), run: () => { closeMenu(); act({ type: 'scanner', unitId: u.id, itemId: it.id }); } });
    }
    if (d.kind === 'psiamp') {
      const tu = d.useTU || tune('TU_PSI', 25);
      for (const k of ['panic', 'control']) {
        add({ label: T(k === 'panic' ? 'hud.menu.psiPanic' : 'hud.menu.psiControl'), cost: tu, enabled: tu <= (u.tu | 0), why: tu > (u.tu | 0) ? T('bs.noTU') : '', run: () => enterTarget(hand, 'psi', k) });
      }
    }
    if (!d.fixed && d.kind !== 'firearm' && d.kind !== 'psiamp' && d.kind !== 'melee') {
      const tu = tuOf('throw');
      const acc = OV.Combat.accuracy(S.B, u, it.id, 'throw');
      add({ label: T('mode.throw'), cost: tu, acc, enabled: tu <= (u.tu | 0), why: tu > (u.tu | 0) ? T('bs.noTU') : '', run: () => enterThrow({ itemId: it.id, inv: null, fuse: null }) });
    }
    return out;
  }
  function openMenu(hand) {
    const u = sel();
    if (!u) return toast('hud.selectFirst', null, 'info');
    if (S.menu && S.menu.hand === hand && S.menu.page === 'main') {
      closeMenu();
      return;
    }
    const it = handItem(u, hand);
    if (!it) {
      toast('hud.menu.empty', null, 'info');
      return;
    }
    if (u.status === 'panic') {
      toast('hud.panicking', { name: uname(u) }, 'warn');
      return;
    }
    if (S.mode !== 'move') cancelMode(true);
    const entries = menuEntries(u, hand, it);
    S.menu = { hand, page: 'main', entries, itemId: it.id };
    const d = defOf(it);
    const head = el('div', { class: 'bs-menu-head' }, iconCanvas(it.type, 30), el('span', { text: T(d.nameKey) }));
    if (it.ammo) head.appendChild(el('span', { class: 'bs-menu-ammo', text: it.ammo.rounds + '/' + ((OV.Data.items[it.ammo.type] || {}).rounds | 0) }));
    const listEl = el('div', { class: 'bs-menu-list' });
    if (!entries.length) listEl.appendChild(el('div', { class: 'bs-menu-none muted', text: T('hud.menu.noAction') }));
    let n = 0;
    for (const e of entries) {
      if (e.info) {
        listEl.appendChild(el('div', { class: 'bs-menu-info', text: e.label }));
        continue;
      }
      n++;
      const num = n;
      e.num = num;
      const b = el('button', { class: 'bs-menu-item' + (e.enabled ? '' : ' off'), type: 'button', role: 'menuitem' },
        el('span', { class: 'key', text: String(num) }),
        el('span', { class: 'bs-mi-label', text: e.label }),
        el('span', { class: 'bs-mi-cost', text: e.cost !== undefined && e.cost !== null ? T('hud.menu.cost', { tu: e.cost }) : '' }),
        el('span', { class: 'bs-mi-acc', text: e.acc !== undefined ? T('hud.menu.acc', { acc: e.acc }) : '', title: e.acc !== undefined ? T('hud.menu.acc.tip') : null }));
      if (!e.enabled && e.why) b.title = e.why;
      b.addEventListener('click', () => pickEntry(e));
      listEl.appendChild(b);
    }
    showMenu(hand, [head, listEl]);
    sfx('ui_click');
  }
  function pickEntry(e) {
    if (!e || e.info) return;
    if (!e.enabled) {
      deny(null);
      if (e.why) toast(e.why, null, 'warn');
      return;
    }
    e.run();
  }
  function showMenu(hand, nodes) {
    const M = S.hud.menu;
    OV.Dom.clear(M);
    for (const n of nodes) M.appendChild(n);
    M.classList.remove('hidden');
    const anchor = hand === 'L' ? S.hud.handL : S.hud.handR;
    const r = anchor.getBoundingClientRect();
    const mw = M.offsetWidth, mh = M.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2));
    M.style.left = x + 'px';
    M.style.top = Math.max(8, r.top - mh - 10) + 'px';
    S.hudDirty = true;
  }
  function openFusePage(u, hand, it) {
    S.menu = { hand, page: 'fuse', itemId: it.id, fuse: 0 };
    const row = el('div', { class: 'bs-fuse' });
    const max = tune('GRENADE_FUSE_MAX', 5);
    for (let f = 0; f <= max; f++) {
      const b = el('button', { class: 'bs-fuse-b' + (f === 0 ? ' def' : ''), type: 'button', text: String(f) });
      b.addEventListener('click', () => primeWith(f));
      row.appendChild(b);
    }
    const tu = OV.BUnits.actionTU(S.B, u, it.id, 'prime');
    showMenu(hand, [
      el('div', { class: 'bs-menu-head' }, iconCanvas(it.type, 30), el('span', { text: T('hud.menu.fuse') }), el('span', { class: 'bs-menu-ammo', text: T('hud.menu.cost', { tu }) })),
      el('div', { class: 'bs-fuse-hint muted', text: T(instantGrenades() ? 'hud.menu.fuseHint.instant' : 'hud.menu.fuseHint.end') }),
      row,
    ]);
  }
  const instantGrenades = () => !S.B.settings || S.B.settings.instantGrenades !== false;
  // texto da espoleta (plural certo; 0 depende de «Granadas instantâneas»)
  function fuseText(base, n) {
    return n > 0 ? Tn(base, n) : T(base + '.zero.' + (instantGrenades() ? 'instant' : 'end'));
  }
  function primeWith(f) {
    const u = sel();
    if (!u || !S.menu) return;
    const itemId = S.menu.itemId;
    closeMenu();
    act({ type: 'prime', unitId: u.id, itemId, fuse: f });
  }
  function openMedPage(u, it) {
    const B = S.B;
    const patients = B.units.filter((t) => t.onMap && LIVE[t.status] && t.side !== 'alien' && t.z === u.z
      && Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y)) <= 1);
    patients.sort((a, b) => (a.id === u.id ? -1 : b.id === u.id ? 1 : woundsOf(b) - woundsOf(a)));
    const hand = OV.BUnits.slotOf(u, it.id);
    S.menu = { hand, page: 'med', itemId: it.id };
    const nodes = [el('div', { class: 'bs-menu-head' }, iconCanvas(it.type, 30), el('span', { text: T('hud.med.title') }), el('span', { class: 'bs-menu-ammo', text: T('hud.menu.cost', { tu: defOf(it).useTU || tune('TU_MEDIKIT', 10) }) }))];
    const ch = it.charges || {};
    nodes.push(el('div', { class: 'bs-fuse-hint muted', text: T('hud.med.charges', { heal: ch.heal | 0, stim: ch.stim | 0, pain: ch.pain | 0 }) }));
    const list = el('div', { class: 'bs-med' });
    let n = 0;
    const doMed = (t, kind, part) => {
      closeMenu();
      act({ type: 'medikit', unitId: u.id, targetId: t.id, kind, part, itemId: it.id });
    };
    for (const t of patients) {
      const head = el('div', { class: 'bs-med-name' }, el('span', { text: t.id === u.id ? T('hud.med.self', { name: uname(t) }) : uname(t) }),
        el('span', { class: 'muted', text: (t.hp | 0) + '/' + (t.hpMax | 0) }));
      list.appendChild(head);
      (t.wounds || []).forEach((w, p) => {
        if (!(w > 0)) return;
        n++;
        const b = el('button', { class: 'bs-menu-item', type: 'button' }, el('span', { class: 'bs-mi-label', text: T('hud.med.part.' + p) }),
          el('span', { class: 'bs-mi-cost bad', text: T('hud.med.wounds', { n: w }) }), el('span', { class: 'bs-mi-acc', text: T('bs.action.heal') }));
        b.addEventListener('click', () => doMed(t, 'heal', p));
        list.appendChild(b);
      });
      const row = el('div', { class: 'bs-med-row' });
      for (const k of ['stim', 'pain']) {
        const b = el('button', { class: 'btn small', type: 'button', text: T('bs.action.' + k) });
        b.addEventListener('click', () => doMed(t, k, null));
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    if (!patients.length || (!n && !patients.length)) list.appendChild(el('div', { class: 'muted', text: T('hud.med.none') }));
    nodes.push(list);
    showMenu(hand === 'L' ? 'L' : 'R', nodes);
  }

  // ---- mapa tático (minimapa) ------------------------------------------------------------------------------
  function toggleMini() {
    S.miniOn = !S.miniOn;
    S.hud.mini.classList.toggle('hidden', !S.miniOn);
    S.mapDirty = true;
    S.hudDirty = true;
    sfx('ui_click');
  }
  function miniGeom() {
    const m = S.B.map;
    const k = Math.max(2, Math.min(5, Math.floor(220 / (m.w + m.h))));
    return { k, W: (m.w + m.h) * k + 2 * k, H: ((m.w + m.h) * k) / 2 + 2 * k };
  }
  function drawMini() {
    if (!S.miniOn) return;
    const B = S.B, m = B.map, D = OV.Data.tileDefs;
    const { k, W, H } = miniGeom();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = S.hud.miniCanvas;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const plane = m.w * m.h;
    const px = (x, y) => (x - y + m.h - 1) * k + k;
    const py = (x, y) => ((x + y) * k) / 2 + k;
    const vz = S.view.viewZ;
    const FLOOR = ['#26352b', '#34465a', '#45586c'];
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        let col = null;
        for (let z = vz; z >= 0; z--) {
          const i = z * plane + y * m.w + x;
          if (!(m.disc[i] & 1)) continue;
          const o = m.parts[i * 4 + 3], wst = m.parts[i * 4 + 1], nth = m.parts[i * 4 + 2], f = m.parts[i * 4];
          const od = o ? D[o] : null;
          if ((od && (od.fullBlock || (od.height | 0) >= 16)) || (wst && D[wst] && !D[wst].open) || (nth && D[nth] && !D[nth].open)) {
            col = od && od.set === 'UFO' ? '#7a7f9a' : '#7b8794';
            break;
          }
          if (f || z === 0) {
            col = m.fire[i] ? '#a2521e' : FLOOR[Math.min(2, z)];
            break;
          }
        }
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(px(x, y) - k, py(x, y), 2 * k, k);
      }
    }
    // unidades
    // soldados = círculos, alienígenas = losangos (a forma distingue-os sem depender da cor)
    const cvd = settings().palette === 'cvd';
    const dot = (u, colr, r, diamond) => {
      const s = (u.size || 1) - 1;
      const X = px(u.x + s / 2, u.y + s / 2), Y = py(u.x + s / 2, u.y + s / 2) + k / 2;
      g.fillStyle = colr;
      g.beginPath();
      if (diamond) {
        const q = r + 1;
        g.moveTo(X, Y - q);
        g.lineTo(X + q, Y);
        g.lineTo(X, Y + q);
        g.lineTo(X - q, Y);
        g.closePath();
      } else g.arc(X, Y, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.stroke();
    };
    for (const u of B.units) {
      if (!u.onMap || !LIVE[u.status] || u.x < 0) continue;
      if (u.side === 'xcom') dot(u, u.id === S.selId ? (cvd ? '#ffffff' : '#ffc23a') : cvd ? '#4aa8ff' : '#5fe08a', u.id === S.selId ? k + 1 : k, false);
      else if (seen(u)) dot(u, u.side === 'alien' ? (cvd ? '#ff4fd8' : '#ff4f43') : cvd ? '#ffb060' : '#ffd23a', k, u.side === 'alien');
    }
    // retângulo da vista atual
    const v = S.view;
    const corners = [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]].map(([sx, sy]) => {
      const t = OV.Iso.screenToTileF(sx, sy, vz, v.cam);
      return [px(t.x, t.y), py(t.x, t.y)];
    });
    g.strokeStyle = 'rgba(255,194,58,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    corners.forEach((p, n) => (n ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.stroke();
  }
  function onMiniClick(e) {
    if (!S) return;
    const m = S.B.map;
    const { k } = miniGeom();
    const r = S.hud.miniCanvas.getBoundingClientRect();
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    const u = (X - k) / k - (m.h - 1);
    const v = ((Y - k) * 2) / k;
    const x = Math.round((u + v) / 2), y = Math.round((v - u) / 2);
    centreOn(Math.max(0, Math.min(m.w - 1, x)), Math.max(0, Math.min(m.h - 1, y)), S.view.viewZ, 240);
  }

  // ---- entrada ------------------------------------------------------------------------------------------------
  function onInput(ev) {
    if (!S) return false;
    const k = ev.kind;
    if (k === 'hover') {
      // o rato manda: o cursor de teclado desaparece (só com movimento a sério, não com o tremor do trackpad)
      if (S.kcur.armed && S.mouse0 && Math.hypot(ev.x - S.mouse0.x, ev.y - S.mouse0.y) < 4) return true;
      S.mouse0 = { x: ev.x, y: ev.y };
      S.lastInput = 'ptr';
      S.lastPtrT = realNow();
      if (S.kcur.armed) {
        S.kcur.armed = false;
        S.view.kcur = null;
        if (S.mode === 'move') setHint('');
      }
      S.mouse = { x: ev.x, y: ev.y };
      S.force = forceMods(ev.mods);
      S.alt = !!(ev.mods && ev.mods.alt);
      refreshHover();
      return true;
    }
    if (k === 'down' || k === 'click' || k === 'secondary' || k === 'dragstart') {
      S.lastInput = 'ptr';
      S.lastPtrT = realNow();
      if (S.kcur.armed) {
        S.kcur.armed = false;
        S.view.kcur = null;
        if (S.mode === 'move') setHint('');
      }
    }
    if (k === 'leave') {
      S.mouse = null;
      clearPreview();
      return true;
    }
    // o jogador toma conta da câmara: a deslocação automática do apresentador para
    if ((k === 'pan' || k === 'zoom' || k === 'dragstart') && S.pctx) S.pctx.panTok = (S.pctx.panTok || 0) + 1;
    if (k === 'pan') {
      S.view.cam.x += ev.cx / S.view.cam.zoom;
      S.view.cam.y += ev.cy / S.view.cam.zoom;
      S.camTween = null;
      clampCam();
      S.hoverKey = '';
      refreshHover();
      return true;
    }
    if (k === 'zoom') {
      zoomAround(S.view.cam.zoom * ev.factor, ev.x, ev.y);
      S.zoomTween = null;
      scheduleSnap(ev.x, ev.y);
      S.hoverKey = '';
      refreshHover();
      return true;
    }
    if (k === 'wheelnotch') {
      if (settings().wheel === 'zoom') {
        zoomAround(S.view.cam.zoom * Math.pow(1.25, ev.delta), ev.x, ev.y);
        scheduleSnap(ev.x, ev.y);
      } else setViewZ(S.view.viewZ + ev.delta);
      return true;
    }
    if (k === 'dragstart') {
      S.dragging = true;
      if (S.spaceDown) S.spaceDragged = true;
      S.camTween = null;
      return true;
    }
    if (k === 'drag') {
      S.view.cam.x -= ev.dx / S.view.cam.zoom;
      S.view.cam.y -= ev.dy / S.view.cam.zoom;
      clampCam();
      return true;
    }
    if (k === 'dragend') {
      S.dragging = false;
      S.hoverKey = '';
      if (ev.pointerType !== 'touch') {
        S.mouse = { x: ev.x, y: ev.y };
        refreshHover();
      }
      return true;
    }
    if (k === 'key') return onKey(ev);
    if (k === 'keyup') {
      if (ev.key === ' ') {
        const wasDown = S.spaceDown;
        S.spaceDown = false;
        if (S.playing) OV.Presenter.fast = S.clickFast;
        // «Feito» só quando o toque inteiro no Espaço aconteceu com o jogo parado (segurar para acelerar não conta)
        else if (wasDown && S.spaceIdle && !S.spaceDragged && !S.ended && !OV.Dom.anyModalOpen()) cmdDone();
        S.spaceDragged = false;
        S.spaceIdle = false;
        return true;
      }
      if (/^Arrow/.test(ev.code || '')) delete S.arrowT[ev.code];
      if (ev.key === 'Alt' && S.alt) {
        S.alt = false;
        S.hoverKey = '';
        refreshHover();
      }
      if (forceKey(ev.key) || (ev.key === 'Control' && S.force)) {
        S.force = false;
        S.hoverKey = '';
        refreshHover();
      }
      return false;
    }
    if (S.ended) return true;
    if (S.playing) {
      if (k === 'click' || k === 'down') {
        if (k === 'click') {
          S.clickFast = true;
          OV.Presenter.hurry();
        }
        return true;
      }
      return k === 'secondary';
    }
    if (k === 'down') return true;
    if (k === 'click') {
      if (S.menu) {
        closeMenu();
        return true;
      }
      if (ev.pointerType === 'touch' || !S.mouse) S.mouse = { x: ev.x, y: ev.y };
      if (ev.mods) S.alt = !!ev.mods.alt;
      // pré-visualização atualizada para o ponto do clique (no toque não houve pairar antes)
      S.hoverKey = '';
      refreshHover();
      const p = pickAt(ev.x, ev.y);
      if (!p) return true;
      if (S.mode === 'target') clickTarget(p, ev.mods, ev.pointerType, undefined, ev.detail);
      else if (S.mode === 'throw') clickThrow(p, ev.pointerType, ev.detail);
      else {
        const u = p.unitId !== null && p.unitId !== undefined ? unitOf(p.unitId) : null;
        if (u && u.side === 'xcom') {
          if (u.id !== S.selId) select(u.id);
        } else if (u && u.side === 'alien') {
          toast(isTouch() || ev.pointerType === 'touch' ? 'hud.hint.aim.touch' : 'hud.hint.aim', null, 'info');
        } else clickMove(p, ev.mods, ev.pointerType);
      }
      S.hoverKey = '';
      refreshHover();
      return true;
    }
    if (k === 'dblclick') {
      const p = pickAt(ev.x, ev.y);
      if (p && p.unitId !== null && p.unitId !== undefined) {
        const u = unitOf(p.unitId);
        if (u && u.side === 'xcom') centreUnit(u);
      }
      return true;
    }
    if (k === 'secondary') {
      if (S.menu) {
        closeMenu();
        return true;
      }
      if (S.mode !== 'move' || S.lock >= 0) {
        cancelMode();
        return true;
      }
      const u = sel();
      const p = pickAt(ev.x, ev.y);
      if (u && p) {
        const i = p.unitId !== null && p.unitId !== undefined && unitOf(p.unitId) ? tileOfUnit(unitOf(p.unitId)) : idxOf(p.x, p.y, p.z);
        const a = { type: 'turn', unitId: u.id, toI: i };
        const v = OV.Act.validate(S.B, a);
        if (v.ok) act(a);
        else if (v.reason !== 'invalid') deny(v.reason);
      }
      return true;
    }
    return false;
  }

  function onKey(ev) {
    const key = ev.key, code = ev.code || '', m = ev.mods || {};
    const lk = key.length === 1 ? key.toLowerCase() : key;
    const kb = kbOn();
    if (key === 'Meta' || key === 'Control') {
      // tiro forçado: ⌘ no Mac, Ctrl nos outros; com o cursor de teclado a apontar, Ctrl também (Ctrl+Enter)
      if (forceKey(key) || (key === 'Control' && S.kcur.armed && S.mode === 'target')) {
        S.force = true;
        S.hoverKey = '';
        refreshHover();
      }
      return false;
    }
    if (key === 'Alt') {
      if (!S.alt) {
        S.alt = true;
        S.hoverKey = '';
        refreshHover();
      }
      return true;
    }
    if (S.ended) return false;
    S.lastInput = 'kb';
    // painel do turno/registo aberto: Tab entra nele; Enter/Espaço num botão dele é desse botão (clique nativo)
    if (S.report && S.hud && !S.menu) {
      if (key === 'Tab') {
        reportTab(m.shift ? -1 : 1);
        return true;
      }
      if ((key === 'Enter' || key === ' ') && S.hud.report.contains(document.activeElement)) return false;
    }
    const arrow = /^Arrow(Left|Right|Up|Down)$/.exec(code);
    if (arrow && !ev.repeat) S.arrowT[code] = realNow();
    if (key === ' ') {
      if (!ev.repeat) {
        S.spaceDown = true;
        S.spaceDragged = false;
        S.spaceIdle = !S.playing;
        // cursor de teclado numa casa útil: Espaço confirma (como Enter) em vez de «Feito»
        if (!S.playing && !S.menu && kbActive()) {
          S.spaceIdle = false;
          kbConfirm(m);
          return true;
        }
      }
      if (S.playing) {
        S.spaceIdle = false;
        OV.Presenter.fast = true;
      }
      return true;
    }
    // repetição automática: só panorâmica, ciclo de soldados, nível e zoom se repetem; ações (K, F, R, G, L, Enter,
    // ⌫, dígitos do menu…) contam uma vez por toque — segurar K não pode gastar UT a ajoelhar e levantar.
    // As setas do cursor repetem pelo próprio ritmo (think), não pelo do sistema.
    if (ev.repeat && !isPanKey(code, m) && key !== 'Tab' && !(m.shift && (key === 'ArrowUp' || key === 'ArrowDown'))
      && !/^(PageUp|PageDown|\.|,|<|>|\+|=|-|_)$/.test(key)) return true;
    if (ev.repeat && arrow && kb && !m.shift) return true;
    if (S.playing) {
      if (key === 'Escape' || key === 'Enter') {
        OV.Presenter.hurry();
        return true;
      }
      return isPanKey(code, m) || key === 'Tab';
    }
    // menu aberto: dígitos escolhem
    if (S.menu) {
      if (key === 'Escape') {
        closeMenu();
        return true;
      }
      const dm = /^Digit(\d)$/.exec(code) || /^Numpad(\d)$/.exec(code);
      if (dm && !m.shift) {
        const n = +dm[1];
        if (S.menu.page === 'fuse') {
          if (n <= tune('GRENADE_FUSE_MAX', 5)) primeWith(n);
          return true;
        }
        if (S.menu.page === 'main') pickEntry((S.menu.entries || []).find((e) => e.num === n));
        return true;
      }
      if (S.menu.page === 'fuse' && key === 'Enter') {
        primeWith(0);
        return true;
      }
      if (lk === 'q' || lk === 'e') {
        openMenu(lk === 'q' ? 'L' : 'R');
        return true;
      }
    }
    if (key === 'Escape') {
      if (S.mode !== 'move' || S.lock >= 0 || S.tapLock >= 0) cancelMode();
      else if (S.menu) closeMenu();
      else if (closeReport()) sfx('ui_click');
      else if (kbDisarm()) {
        setHint('');
        sfx('ui_click', { vol: 0.5 });
      } else openOptions();
      return true;
    }
    const aiming = S.mode === 'target' || S.mode === 'throw';
    if (key === 'Tab') {
      if (aiming && kb) kbCycleAlien(m.shift ? -1 : 1);
      else cycle(m.shift ? -1 : 1);
      return true;
    }
    if (key === 'Enter') {
      if (kbActive()) kbConfirm(m);
      else if ((m.ctrl || m.meta) && aiming) kbForceAtPointer();
      else endTurn();
      return true;
    }
    if (key === 'Backspace') {
      endTurn();
      return true;
    }
    // setas: cursor de tiles (⇧ + setas desloca a câmara); sem cursor de teclado, as setas deslocam a câmara
    if (arrow && kb && !m.shift && !m.alt && !m.meta && !m.ctrl) {
      const dir = arrow[1].toLowerCase();
      kbMove(dir);
      S.kcur.hold = { code, dir, next: realNow() + KB_HOLD };
      setHint(modeHint());
      return true;
    }
    if (!kb && m.shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
      setViewZ(S.view.viewZ + (key === 'ArrowUp' ? 1 : -1));
      return true;
    }
    if (key === 'PageUp' || key === 'PageDown') {
      setViewZ(S.view.viewZ + (key === 'PageUp' ? 1 : -1));
      return true;
    }
    if (key === '.' || key === ',' || key === '>' || key === '<') {
      setViewZ(S.view.viewZ + (key === '.' || key === '>' ? 1 : -1));
      return true;
    }
    if (key === '+' || key === '=') {
      zoomStep(1);
      return true;
    }
    if (key === '-' || key === '_') {
      zoomStep(-1);
      return true;
    }
    const fk = /^F([1-4])$/.exec(key);
    if (fk) {
      setReserve(['none', 'snap', 'aimed', 'auto'][+fk[1] - 1]);
      return true;
    }
    const dm = /^Digit(\d)$/.exec(code) || /^Numpad(\d)$/.exec(code);
    if (dm) {
      const n = +dm[1];
      if (m.shift) {
        if (n >= 1 && n <= 4) setReserve(['none', 'snap', 'aimed', 'auto'][n - 1]);
        else if (n === 5) toggleReserveKneel();
        return true;
      }
      const a = visibleAliens()[n === 0 ? 9 : n - 1];
      // a apontar (ou com o cursor já à vista): o cursor salta para o alienígena n; senão só centra
      if (a && kb && (aiming || S.kcur.armed)) kbJumpAlien(a);
      else centreAlien(n === 0 ? 9 : n - 1);
      return true;
    }
    if (m.meta || m.ctrl) return false;
    switch (lk) {
      case 'k': cmdKneel(); return true;
      case 'i': openInventory(); return true;
      case 'r': cmdReload(); return true;
      case 'q': openMenu('L'); return true;
      case 'e': openMenu('R'); return true;
      case 'f': cmdFireAgain(); return true;
      case 'g': cmdQuickThrow('grenade'); return true;
      case 'l': cmdQuickThrow('flare'); return true;
      case 'c':
      case 'h': centreUnit(sel()); return true;
      case 'm': toggleMini(); return true;
      case 'j': toggleReserveKneel(); return true;
      case 'n': openReport('log'); return true;
      case 't': kbTurn(); return true;
      case 'x': if (!m.shift) abortMission(); return true;
      case '?': showKbHint(); openKeys(); return true;
      default: break;
    }
    return isPanKey(code, m);
  }
  /* Ctrl + Enter a apontar sem cursor de teclado: tiro forçado na casa debaixo do ponteiro (no Mac ⌘ + tecla nunca
     chega, ver input.js; ⌃ + Enter chega). Nunca termina o turno por engano. */
  function kbForceAtPointer() {
    const p = S.mode === 'target' && S.mouse && !isTouch() ? pickAt(S.mouse.x, S.mouse.y) : null;
    if (!p) { toast(isMac() ? 'hud.kb.forceHint.mac' : 'hud.kb.forceHint', null, 'info'); return; }
    clickTarget(p, { shift: false, alt: false, ctrl: false, meta: false }, 'kb', true);
  }
  // T: rodar o soldado para o cursor de teclado ou, sem ele, para a casa debaixo do ponteiro (como o clique secundário)
  function kbTurn() {
    const u = sel();
    const p = !u ? null : S.kcur.armed ? kbPick() : S.mouse && !isTouch() ? pickAt(S.mouse.x, S.mouse.y) : null;
    if (!u || !p) {
      toast(u ? 'hud.kb.turnHint' : 'hud.selectFirst', null, 'info');
      return;
    }
    const t = p.unitId !== null && p.unitId !== undefined ? unitOf(p.unitId) : null;
    const a = { type: 'turn', unitId: u.id, toI: t && t !== u ? tileOfUnit(t) : idxOf(p.x, p.y, p.z) };
    const v = OV.Act.validate(S.B, a);
    if (v.ok) act(a);
    else if (v.reason !== 'invalid') deny(v.reason);
  }
  // ? : folha de teclas do Battlescape
  function openKeys() {
    const rows = [];
    for (let k = 1; OV.T.has('hud.keys.' + k); k++) {
      const kk = 'hud.keys.' + k;
      const [a, b] = T(isMac() && OV.T.has(kk + '.mac') ? kk + '.mac' : kk).split('|');
      rows.push(el('tr', null, el('td', null, el('kbd', { class: 'key', text: a })), el('td', { text: b || '' })));
    }
    const body = el('table', { class: 'tbl bs-keys' }, el('tbody', null, rows));
    OV.Dom.modal({ title: T('hud.keys.title'), body, wide: true, cls: 'bs-keysheet', buttons: [{ label: T('hud.opt.resume'), value: true, kind: 'primary' }] });
    // o foco no botão (rodapé fixo) não pode deslocar a lista: abre sempre no topo (Setas, Enter primeiro)
    const box = body.closest('.modal');
    if (box) box.scrollTop = 0;
  }
  function isPanKey(code, m) {
    if (m && (m.meta || m.ctrl || m.alt)) return false;
    if (/^Key[WASD]$/.test(code)) return true;
    if (!/^Arrow(Left|Right|Up|Down)$/.test(code)) return false;
    // com o cursor de teclado, só ⇧ + setas desloca a câmara; sem ele, ⇧↑/⇧↓ mudam de nível
    return kbOn() ? !!(m && m.shift) : !(m && m.shift && /ArrowUp|ArrowDown/.test(code));
  }

  // ---- ciclo --------------------------------------------------------------------------------------------------
  function think(dt) {
    if (!S) return;
    const now = realNow();
    S.view.time = now;
    // a dica do teclado some passado o seu tempo (sem esperar por outra tecla)
    if (S.kbHint && now >= S.kbHint.until && S.hud && S.hud.hint.classList.contains('on') && S.hud.hint.textContent === T('hud.hint.kb')) setHint(kbHint());
    // Espaço seguro desde antes de a reprodução começar também acelera (o apresentador repõe fast ao arrancar)
    if (S.spaceDown && S.playing && OV.Presenter.playing && !OV.Presenter.fast) OV.Presenter.fast = true;
    const sc = OV.Presenter.playing ? OV.Presenter.timeScale() : 1;
    if (OV.FX) OV.FX.update(dt * sc);
    const v = S.view, cam = v.cam;
    // teclado: panorâmica com aceleração
    const K = OV.Input ? OV.Input.keysDown : new Set();
    let kx = 0, ky = 0;
    const shift = K.has('ShiftLeft') || K.has('ShiftRight');
    const modal = OV.Dom.anyModalOpen();
    const kb = kbOn();
    if (!modal && !K.has('MetaLeft') && !K.has('MetaRight') && !K.has('AltLeft') && !K.has('AltRight')) {
      // W A S D deslocam sempre; setas só com ⇧ (com o cursor de teclado) ou sempre (sem ele, ⇧↑⇧↓ = nível)
      const arrows = kb ? shift : true;
      if ((arrows && K.has('ArrowLeft')) || (!shift && K.has('KeyA'))) kx -= 1;
      if ((arrows && K.has('ArrowRight')) || (!shift && K.has('KeyD'))) kx += 1;
      if ((arrows && (kb || !shift) && K.has('ArrowUp')) || (!shift && K.has('KeyW'))) ky -= 1;
      if ((arrows && (kb || !shift) && K.has('ArrowDown')) || (!shift && K.has('KeyS'))) ky += 1;
    }
    // cursor de teclado: segurar uma seta repete o passo ao ritmo próprio (a câmara segue o cursor)
    const hold = S.kcur.hold;
    if (hold) {
      if (!K.has(hold.code) || modal || shift || !kb || S.playing) S.kcur.hold = null;
      else if (now >= hold.next) {
        hold.next = now + KB_RATE;
        kbMove(hold.dir);
      }
    }
    // margens do ecrã (opção)
    if (settings().edgeScroll && S.mouse && !S.dragging && !modal) {
      if (S.mouse.x < EDGE) kx -= 1;
      if (S.mouse.x > v.w - EDGE) kx += 1;
      if (S.mouse.y < EDGE) ky -= 1;
      if (S.mouse.y > v.h - EDGE) ky += 1;
    }
    if (kx || ky) {
      S.panHold = (S.panHold || 0) + dt / 1000;
      const sp = Math.min(PAN_MAX, PAN_SPEED * (1 + S.panHold * PAN_ACCEL));
      const len = Math.hypot(kx, ky);
      cam.x += ((kx / len) * sp * dt) / 1000 / cam.zoom;
      cam.y += ((ky / len) * sp * dt) / 1000 / cam.zoom;
      S.camTween = null;
      clampCam();
      S.hoverKey = '';
      refreshHover();
    } else S.panHold = 0;
    if (S.camTween) {
      const t = S.camTween;
      t.t += dt;
      const p = Math.min(1, t.t / t.dur), e = 1 - Math.pow(1 - p, 3);
      cam.x = t.x0 + (t.x1 - t.x0) * e;
      cam.y = t.y0 + (t.y1 - t.y0) * e;
      if (p >= 1) S.camTween = null;
      S.hoverKey = '';
      refreshHover();
    }
    if (S.zoomTween) {
      const t = S.zoomTween;
      t.t += dt;
      const p = Math.min(1, t.t / t.dur), e = 1 - Math.pow(1 - p, 3);
      zoomAround(t.z0 + (t.z1 - t.z0) * e, t.px, t.py);
      if (p >= 1) S.zoomTween = null;
      S.hoverKey = '';
      refreshHover();
    }
    if (v.blips && v.blips.length && now - v.blips[0].t0 > 4000) v.blips = null;
    pruneDangers();
    updateReach();
    S.hudT = (S.hudT || 0) + dt;
    if (S.hudT > 100 || S.hudDirty) {
      S.hudT = 0;
      S.hudDirty = false;
      refreshHud();
      S.safeN = (S.safeN || 0) + 1;
      if (S.safeN % 10 === 1) measureSafe();
    }
    S.miniT = (S.miniT || 0) + dt;
    if (S.miniOn && (S.miniT > 250 || S.mapDirty)) {
      S.miniT = 0;
      S.mapDirty = false;
      drawMini();
    }
  }

  function draw(ctx, view) {
    if (!S) return;
    S.view.w = view.w;
    S.view.h = view.h;
    const g = view.begin('#05070a');
    const t0 = realNow();
    OV.BattleRender.draw(g, S.B, S.view);
    if (S.perf) notePerf(realNow() - t0);
  }
  // janela deslizante de 60 fotogramas: fps, desenho médio e p95
  function notePerf(ms) {
    const P = S.perf, t = realNow();
    P.draw.push(ms);
    P.at.push(t);
    if (P.draw.length > 60) {
      P.draw.shift();
      P.at.shift();
    }
    if (t - P.shown < 500 || P.at.length < 2) return;
    P.shown = t;
    const fps = ((P.at.length - 1) * 1000) / (P.at[P.at.length - 1] - P.at[0]);
    const sorted = P.draw.slice().sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const st = OV.BattleRender.stats();
    P.last = { fps: Math.round(fps), avg: +avg.toFixed(2), p95: +p95.toFixed(2), chunks: st.chunks, sprites: st.sprites };
    if (S.hud && S.hud.perf) {
      S.hud.perf.textContent = T('hud.perf', { fps: P.last.fps, ms: avg.toFixed(1), p95: p95.toFixed(1), chunks: st.chunks, sprites: st.sprites });
      S.hud.perf.classList.toggle('slow', fps < 50 || avg > 8);
    }
  }

  // ---- cena -----------------------------------------------------------------------------------------------
  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.battlescape = function (params) {
    const p = params || {};
    const B = p.B || (OV.Game && OV.Game.B);
    if (!B) throw new Error('battlescape: falta B');
    const sc = { id: 'battlescape', isScreen: true };

    sc.enter = function () {
      if (OV.Game) OV.Game.B = B;
      const anim = { units: {}, hidden: new Set(), hideItems: new Set() };
      S = {
        B, onExit: typeof p.onExit === 'function' ? p.onExit : null, onPlayerTurn: typeof p.onPlayerTurn === 'function' ? p.onPlayerTurn : null, scene: sc,
        view: {
          cam: { x: 0, y: 0, zoom: 1 }, w: OV.View.w, h: OV.View.h, viewZ: 0, time: 0, selectedId: null, hover: null, cursor: 'move',
          path: null, reach: null, target: null, throwArc: null, throwInfo: null, throwRange: null, anim, showAll: false, blips: null,
        },
        anim, selId: null, mode: 'move', aim: null, throwPlan: null, lock: -1, tapLock: -1, playing: false, ended: false, menu: null,
        mouse: null, pick: null, hoverKey: '', reachKey: '', ver: 0, hitCache: new Map(), uiRng: OV.RNG.create(0x51ed7a11),
        lastFire: null, miniOn: false, mood: null, hudDirty: true, mapDirty: true, force: false, spaceDown: false, spaceDragged: false,
        clickFast: false, perf: OV.Game && OV.Game.debug ? { draw: [], at: [], shown: 0, last: null } : null,
        kcur: { x: 0, y: 0, armed: false, anchor: null, hold: null }, arrowT: {}, alt: false, lastInput: 'ptr', mouse0: null, aimLabel: '',
        log: [], logCtx: { last: {}, seenAt: {} }, report: null, alienNades: new Set(),
      };
      S.pctx = {
        view: S.view, anim, side: 'xcom', followId: () => (S ? S.selId : null),
        hooks: {
          hidden: (on) => showHidden(on),
          banner: (text, kind) => showBanner(text, kind),
          event: (ev) => {
            if (!S) return;
            S.hudDirty = true;
            S.mapDirty = true;
            if (ev.t === 'spotted' || ev.t === 'death' || ev.t === 'turnStart') updateMusic();
          },
          viewZ: (z) => S && setViewZ(z),
          log: (ev) => noteEvent(ev),
          blips: (list) => {
            if (!S) return;
            const t0 = realNow();
            S.view.blips = list.map((b) => Object.assign({ t0 }, b));
          },
        },
      };
      current = sc;
      // o fundo animado dos menus guarda telas de ecrã inteiro (~60 MB a 2×): libertar durante a batalha
      if (OV.Screens && OV.Screens.Backdrop && OV.Screens.Backdrop.release) OV.Screens.Backdrop.release();
      buildHud();
      measureSafe();
      if (OV.BattleRender.reset) OV.BattleRender.reset(B);
      if (OV.FX) OV.FX.clear();
      document.body.classList.add('in-battle');
      // primeira seleção e câmara
      const first = squad().filter(selectable)[0];
      if (first) {
        S.selId = first.id;
        S.view.selectedId = first.id;
        S.view.viewZ = first.z;
        centreUnit(first, 0);
      } else centreOn(B.map.w >> 1, B.map.h >> 1, 0, 0);
      updateMusic();
      refreshHud();
      if (B.phase === 'setup') {
        playGen(OV.Battle.beginBattle(B)).then(() => {
          if (S && !S.ended) {
            ensureSelection();
            updateMusic();
            playerTurnHook();
            if (p.tips) openTips();
          }
        });
      } else if (B.phase === 'over') finishBattle();
    };
    sc.exit = function () {
      if (current === sc) current = null;
      if (S && S.scene === sc) {
        clearTimeout(S.snapTimer);
        clearTimeout(S.bannerTimer);
        clearTimeout(S.hiddenTimer);
        if (S.hud && S.hud.root.parentNode) S.hud.root.parentNode.removeChild(S.hud.root);
        S = null;
      }
      OV.Dom.hideTooltip();
      hideLongPress();
      if (OV.FX) {
        OV.FX.clear();
        OV.FX.reduceMotion = false;
      }
      document.body.classList.remove('in-battle', 'bs-cvd', 'bs-rm');
      document.body.style.removeProperty('--bs-bot');
    };
    sc.pause = function () {
      if (S && S.hud) S.hud.root.classList.add('paused');
      if (S) closeMenu();
    };
    sc.resume = function () {
      if (!S || !S.hud) return;
      S.hud.root.classList.remove('paused');
      S.sig = {};
      invalidate();
      ensureSelection();
    };
    sc.think = think;
    sc.draw = draw;
    sc.onInput = onInput;
    sc.onResize = function (view) {
      if (!S) return;
      S.view.w = view.w;
      S.view.h = view.h;
      clampCam();
      measureSafe();
      if (S.menu) closeMenu();
    };
    // separador escondido: o rAF para e a reprodução congela sozinha (nada a acelerar); as teclas largadas lá fora
    // nunca chegam, por isso esquecem-se aqui
    sc.onHidden = function () {
      if (!S) return;
      S.spaceDown = false;
      S.spaceIdle = false;
      S.force = false;
      S.alt = false;
      S.kcur.hold = null;
      S.arrowT = {};
      if (OV.Input) OV.Input.keysDown.clear();
    };
    return sc;
  };

  // ---- API pública e depuração ------------------------------------------------------------------------------
  const debug = {
    // centro do losango do tile em px CSS do ecrã
    tileToScreen(x, y, z) {
      if (!S) return null;
      const p = OV.Iso.tileCenter(x, y, z, S.view.cam);
      return { x: p.x, y: p.y };
    },
    // meio do corpo da unidade (para cliques)
    unitScreen(id) {
      const u = unitOf(id);
      if (!u || u.x < 0) return null;
      const s = (u.size || 1) - 1;
      const p = OV.Iso.tileCenter(u.x + s / 2, u.y + s / 2, u.z, S.view.cam);
      const h = ((u.kneel ? u.kneelHeight : u.height) || 20) * S.view.cam.zoom;
      return { x: p.x, y: p.y - h * 0.9 };
    },
    async selectAndMove(id, x, y, z) {
      if (!S) return { ok: false };
      select(id, { quiet: true });
      return act({ type: 'walk', unitId: id, to: idxOf(x, y, z === undefined ? unitOf(id).z : z) });
    },
    state() {
      if (!S) return null;
      const u = sel();
      return {
        selectedId: S.selId, mode: S.mode, playing: S.playing || OV.Presenter.playing, ended: S.ended, viewZ: S.view.viewZ,
        cam: Object.assign({}, S.view.cam), hover: S.view.hover, lock: S.lock,
        pathSteps: S.view.path ? S.view.path.steps.length : 0, pathLabel: S.view.path ? S.view.path.label : null,
        pathStates: S.view.path ? S.view.path.steps.map((s) => s.state) : [],
        reachCount: S.view.reach ? S.view.reach.count : 0,
        dangers: S.view.dangers ? S.view.dangers.map((g) => ({ x: g.x, y: g.y, z: g.z, r: g.r })) : [],
        target: S.view.target ? { label: S.view.target.label, hitPct: S.view.target.hitPct, blocked: S.view.target.blocked, sub: S.view.target.sub, blastR: S.view.target.blast ? S.view.target.blast.r : 0, route: S.view.target.route ? S.view.target.line.length - 1 : 0 } : null,
        throwInfo: S.view.throwInfo ? { label: S.view.throwInfo.label, ok: S.view.throwInfo.ok, sub: S.view.throwInfo.sub || null, blastR: S.view.throwInfo.blast ? S.view.throwInfo.blast.r : 0 } : null,
        menu: S.menu ? { hand: S.menu.hand, page: S.menu.page, entries: (S.menu.entries || []).map((e) => ({ label: e.label, cost: e.cost, acc: e.acc, enabled: e.enabled })) } : null,
        turn: S.B.turn, side: S.B.side, phase: S.B.phase, result: S.B.result || null, reserve: S.B.reserve, reserveKneel: !!S.B.reserveKneel,
        unit: u ? { id: u.id, x: u.x, y: u.y, z: u.z, tu: u.tu, energy: u.energy, kneel: !!u.kneel, dir: u.dir, hp: u.hp } : null,
        visibleAliens: visibleAliens().map((a) => ({ id: a.id, x: a.x, y: a.y, z: a.z })),
        miniOn: !!S.miniOn,
        kcur: S.kcur.armed ? { x: S.kcur.x, y: S.kcur.y, z: S.view.viewZ } : null, tapLock: S.tapLock,
        pathSub: S.view.path ? S.view.path.sub || null : null, hint: S.hud ? S.hud.hint.textContent : '',
        targetLabel: S.view.target && S.view.targetLabel ? Object.assign({}, S.view.targetLabel) : null,
        report: S.report ? { kind: S.report.kind, rows: Array.from(S.hud.report.querySelectorAll('.bs-report-txt')).map((n) => n.textContent) } : null,
      };
    },
    // registo de mensagens (entradas com o texto já traduzido)
    log() {
      return S ? S.log.map((e) => ({ turn: e.turn, side: e.side, kind: e.kind, own: e.own, text: T(e.key, e.params), at: e.at, from: e.from })) : [];
    },
    // última leitura de desempenho (?debug=1): {fps, avg, p95, chunks, sprites} | null
    perf() {
      return S && S.perf ? S.perf.last : null;
    },
    // mostrar o mapa todo (medições de desempenho; só a vista, B não muda)
    showAll(on) {
      if (S) S.view.showAll = !!on;
    },
    // centrar a câmara num tile (só a vista)
    centre(x, y, z) {
      if (!S) return;
      if (z !== undefined) setViewZ(z);
      centreOn(x, y, z === undefined ? S.view.viewZ : z, 0);
    },
    hover(x, y) {
      if (!S) return;
      // como o rato a sério: esconde o cursor de teclado
      S.kcur.armed = false;
      S.lastInput = 'ptr';
      S.lastPtrT = realNow();
      S.mouse = { x, y };
      S.hoverKey = '';
      refreshHover();
    },
    // QA: cursor de teclado armado num tile (como se lá tivesse chegado com as setas)
    kb(x, y, z) {
      if (!S) return;
      S.lastInput = 'kb';
      kbPlace(x, y, z === undefined ? S.view.viewZ : z);
    },
    // QA: um evento entra no registo como se viesse do apresentador; report('turn'|'log') abre o painel
    noteEvent(ev) {
      noteEvent(ev);
    },
    report(kind) {
      if (!S) return;
      if (kind === 'turn') openReport('turn', S.log.filter((e) => e.own));
      else openReport('log');
    },
    // QA: abre os conselhos da primeira missão
    tips() {
      if (S) openTips();
    },
    // QA: volta a correr o aviso de granadas do início do turno → número de círculos
    grenades() {
      if (!S) return 0;
      const rows = warnGrenades();
      if (rows.length) openReport('turn', rows);
      return rows.length;
    },
  };

  OV.BattleUI = {
    get scene() { return current; },
    open(B, opts) {
      return OV.Scenes.push('battlescape', Object.assign({ B }, opts || {}));
    },
    openInventory,
    refresh() { if (S) invalidate(); },
    // abortar a missão (com a confirmação de sempre): botão do HUD, tecla X e o painel Opções (Esc)
    abort() { if (S) abortMission(); },
    model: { kbStep, logEntry, blastConfirm, handName, confirmEarly, reportSummary, turnReportRows },
    debug,
  };
})(globalThis.OV || (globalThis.OV = {}));
