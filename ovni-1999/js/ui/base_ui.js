/* Basescape e ecrãs de gestão (DESIGN.md §13, §15.5; contrato docs/CAMPAIGN_API.md §1.8–§1.10, §5.6, §6).
   Grelha 6×6 no canvas (OV.BaseRender) + painel DOM com separadores «Instalações / Investigação / Produção /
   Pessoal / Armazém / Naves / Soldados / Mercado / Contenção» (teclas 1–9).
   A interface nunca altera G diretamente: tudo passa por OV.BaseSim / OV.Campaign / OV.Soldiers; os eventos
   produzidos por essas chamadas são retirados de G.events logo a seguir (toasts) e os desconhecidos devolvidos.
   Cena: OV.SceneDefs.basescape({G, baseId, tab}) (isScreen).
   API: OV.BaseUI = {
     TABS,
     open(G, baseId?, tab?, {pick?, item?, qty?, equip?})   empilha 'basescape' (ou muda de base/separador se já estiver no topo); tab
                              'research' abre a escolha de projeto sozinha sem projetos a decorrer ou com pick;
                              tab 'market' + item: Comprar com a linha do objeto realçada e o botão em foco
                              (qty: quantidade já escolhida nessa linha);
                              equip: craftId → Naves com o equipamento desse transporte aberto («Pôr na nave»)
     close()                  volta ao ecrã anterior (Geoscape) ; isOpen() → bool ; refresh()
     errText(reason) → texto pt-PT de 'base.err.<reason>'
     lostTopics(G, base, itemId, n) → [topicId] que deixam de se poder investigar se se venderem n (Mercado › Vender avisa e pede confirmação)
     groupDeliveries(G, deliveries) → [{kind, itemId, n, h}] (mesmo tipo + mesma hora somados) ; nextTen(v) → dezena seguinte
     debug: { state(), cellCenter(x, y) → {x, y} px do centro de uma célula, scene() }
   }
   Teclado: 1–9 separadores (←/→ com o foco num separador), U Ufopédia, B construir, N novo projeto/produção, E equipar, X missão final (Naves), M memorial, [ ] base
   anterior/seguinte, setas + Enter na construção, ⌫ desmantelar, Esc cancela/volta. */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  // chave no feminino quando existe (soldadas: «Morta em combate»…)
  const gk = (key, s) => (s && s.female && OV.T.has(key + '.f') ? key + '.f' : key);
  const el = (...a) => OV.Dom.el(...a);
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const BS = () => OV.BaseSim;
  const esc = (s) => OV.U.esc(s);
  const money = (n) => OV.U.fmtMoney(n | 0);
  const int = (n) => OV.U.fmtInt(n | 0);
  const dec1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',').replace(',0', '');
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const dprNow = () => Math.min(2, (OV.View && OV.View.dpr) || (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);

  const TABS = ['facilities', 'research', 'production', 'personnel', 'stores', 'crafts', 'soldiers', 'market', 'containment'];
  const IN_HANGAR = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  const STATS = ['tu', 'sta', 'hp', 'brav', 'react', 'fire', 'thr', 'str', 'melee'];
  const COLS = ['rank', 'name', 'missions', 'kills', 'tu', 'hp', 'fire', 'react', 'brav', 'wound', 'craft'];
  const CAP_KEYS = ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts'];
  const CAP_FAC = { personnel: 'living_quarters', labs: 'laboratory', workshops: 'workshop', storage: 'general_stores', aliens: 'alien_containment', crafts: 'hangar' };
  const PROG_CLS = { 'research.progress.none': 'p-none', 'research.progress.unknown': 'p-unknown', 'research.progress.poor': 'p-poor', 'research.progress.average': 'p-average', 'research.progress.good': 'p-good', 'research.progress.excellent': 'p-excellent' };
  // categorias do armazém e do mercado (ordem de apresentação)
  const CATS = [
    ['craft', null],
    ['craft_weapon', (it) => it.kind === 'craft_weapon'],
    ['craft_ammo', (it) => it.kind === 'craft_ammo'],
    ['weapon', (it) => it.kind === 'firearm' || it.kind === 'melee'],
    ['ammo', (it) => it.kind === 'ammo'],
    ['explosive', (it) => it.kind === 'grenade'],
    ['equipment', (it) => it.kind === 'medikit' || it.kind === 'scanner' || it.kind === 'flare' || it.kind === 'psiamp'],
    ['armour', (it) => it.kind === 'armour'],
    ['material', (it) => it.kind === 'material'],
    ['component', (it) => it.kind === 'component'],
    ['artefact', (it) => it.kind === 'artefact'],
    ['corpse', (it) => it.kind === 'corpse'],
    ['other', () => true],
  ];
  const catOf = (id) => {
    const it = D().items[id];
    if (!it) return 'other';
    for (const [k, f] of CATS) if (f && f(it)) return k;
    return 'other';
  };

  function sfx(name) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name); } catch (e) { /* som opcional */ }
  }
  function errText(reason) {
    const k = 'base.err.' + reason;
    return OV.T.has(k) ? T(k) : T('base.err.generic');
  }
  function deny(text) {
    sfx('ui_deny');
    OV.Dom.toast(text, null, 'warn');
  }
  const kbd = (k) => (k ? ' <span class="key">' + esc(k) + '</span>' : '');
  function tipHtml(title, lines, key) {
    let h = '<b>' + esc(title) + '</b>' + kbd(key);
    for (const l of lines || []) if (l) h += '<br>' + l;
    return h;
  }
  const warnLine = (t) => '<span class="bsc-tip-why">' + esc(t) + '</span>';
  // textos de ajuda com variante de toque (iPad): «Toque…» em vez de «Clique…», sem Shift+clique
  const touchNow = () => !!(OV.Input && OV.Input.lastPointerType === 'touch') || (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches);
  const TT = (k, p) => (touchNow() && OV.T.has(k + '.touch') ? T(k + '.touch', p) : T(k, p));

  // botão com dica e razão de bloqueio: bloqueado fica cinzento e o clique explica porquê (com zumbido)
  /* ações que mudam G e recriam o próprio botão (contratar, despedir, comprar, iniciar): o 2.º clique de um duplo
     clique (event.detail ≥ 2) ou um clique a menos de 400 ms do anterior não as repete */
  /* o teclado (click com event.detail 0) nunca é travado: cada Enter/Espaço novo é uma ordem pedida de propósito; só a
     repetição automática de uma tecla mantida premida não repete a ação */
  let lastOnceT = -1e9, keyRepeat = false;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') keyRepeat = !!e.repeat; }, true);
    document.addEventListener('keyup', () => { keyRepeat = false; }, true);
  }
  function oneShot(e) {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (e && (e.detail | 0) === 0 && e.isTrusted !== false) {
      if (keyRepeat) return false;
      lastOnceT = t;
      return true;
    }
    if ((e && e.detail > 1) || t - lastOnceT < 400) return false;
    lastOnceT = t;
    return true;
  }
  /* tópicos disponíveis na base b que deixam de o estar se se venderem n unidades de id (needItem sem outra unidade):
     cadáveres, armas alienígenas… → [topicId]. Só lê G. */
  function lostTopics(g, b, id, n) {
    const avail = C().availableResearch(g, b.id);
    if (!avail.length || !(n > 0)) return [];
    const st = Object.assign({}, b.stores);
    st[id] = Math.max(0, (st[id] | 0) - n);
    const after = D().researchAvailable(g.researched, g.flags, st, b.aliens);
    return avail.filter((t) => after.indexOf(t) < 0);
  }
  // nome acessível de um botão repetido com o contexto da linha: «Atribuir mais 1 cientista — Kit Médico»
  const ctxName = (what, name) => T('base.aria.ctx', { what, name });
  function btn(label, o) {
    o = o || {};
    // nome acessível com contexto («Iniciar: Armas Laser», «Comprar 1 × Stingray»); bloqueado não é paragem do Tab
    const aria = o.aria || (o.title && o.title !== label ? o.title : null);
    const b = el('button', { type: 'button', class: 'btn ' + (o.cls || ''), 'aria-disabled': o.why ? 'true' : null, 'aria-label': aria ? aria + (o.why ? ' — ' + o.why : '') : null, 'aria-keyshortcuts': o.key || null, 'aria-pressed': o.pressed === undefined ? null : o.pressed ? 'true' : 'false', dataset: o.data || null });
    if (o.icon) b.appendChild(o.icon);
    b.appendChild(document.createTextNode(label));
    if (o.key && !o.noTab) b.appendChild(el('kbd', { text: o.key }));
    if (o.why || o.noTab) { if (o.why) b.classList.add('disabled'); b.tabIndex = -1; }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (o.why) { deny(o.why); return; }
      if (o.once && !oneShot(e)) return;
      if (o.on) o.on(e);
    });
    OV.Dom.tooltip(b, () => tipHtml(o.title || label, [o.tip ? esc(o.tip) : '', o.why ? warnLine(o.why) : ''], o.key));
    if (o.hover) {
      b.addEventListener('mouseenter', () => o.hover(true));
      b.addEventListener('mouseleave', () => o.hover(false));
    }
    return b;
  }
  function meter(label, used, cap, o) {
    o = o || {};
    const full = cap > 0 ? used / cap : used > 0 ? 2 : 0;
    const cls = full > 1 ? 'over' : full >= 1 ? 'full' : full >= 0.85 ? 'high' : '';
    const m = el('div', { class: 'bsc-meter ' + cls + (o.cls ? ' ' + o.cls : ''), dataset: o.data || null },
      el('div', { class: 'bsc-meter-t' }, el('span', { text: label }), el('b', { text: o.text || T('base.cap.value', { used: o.fmt ? o.fmt(used) : int(used), total: o.fmt ? o.fmt(cap) : int(cap) }) })),
      el('div', { class: 'bsc-meter-bar' }, el('i', { style: { width: Math.min(100, full * 100).toFixed(1) + '%' } })));
    if (o.tip) OV.Dom.tooltip(m, o.tip);
    return m;
  }
  function itemIcon(id, size) {
    const k = dprNow();
    const c = el('canvas', { class: 'bsc-ic', width: Math.round(size * k), height: Math.round(size * k) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    try { if (OV.ItemSprites) OV.ItemSprites.drawIcon(g, id, 0, 0, size); } catch (e) { /* ícone opcional */ }
    return c;
  }
  function imgIcon(url, size, cls) {
    return el('img', { class: 'bsc-img ' + (cls || ''), src: url, width: size, height: size, alt: '', draggable: 'false' });
  }
  function facIcon(type, size) {
    if (!OV.BaseRender) return el('span', { class: 'bsc-img-ph' });
    return imgIcon(OV.BaseRender.facilityIconURL(type, size, dprNow()), size, 'fac');
  }
  function craftIcon(type, size) {
    if (!OV.BaseRender) return el('span', { class: 'bsc-img-ph' });
    return imgIcon(OV.BaseRender.craftIconURL(type, size, dprNow()), size, 'craft');
  }
  function alienIcon(unit, size) {
    const k = dprNow();
    const c = el('canvas', { class: 'bsc-ic alien', width: Math.round(size * k), height: Math.round(size * k) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    try {
      const u = D().units[unit];
      if (OV.UnitSprites && u) {
        const spr = OV.UnitSprites.get(u.sprite || unit, 3, 'stand', 0, k * 1.3, {});
        const sc = Math.min((size * 0.9) / spr.h, (size * 0.9) / spr.w, 1.4);
        g.drawImage(spr.c, size / 2 - spr.ax * sc, size * 0.96 - spr.ay * sc, spr.w * sc, spr.h * sc);
      }
    } catch (e) { /* retrato opcional */ }
    return c;
  }
  function portrait(s, size) {
    const k = dprNow();
    const c = el('canvas', { class: 'bsc-portrait', width: Math.round(size * k), height: Math.round(size * k) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    try {
      if (OV.Portraits) OV.Portraits.draw(g, { portraitSeed: s.portraitSeed, female: s.female, nat: s.nat, armour: s.armour, rank: s.rank }, 0, 0, size);
    } catch (e) { /* retrato opcional */ }
    return c;
  }

  // nomes
  const baseName = (b) => (b && b.name) || T('base.defaultName');
  function craftName(c) {
    if (!c) return '';
    if (c.name) return c.name;
    const def = D().crafts[c.type];
    return T('craft.instance', { type: def ? T(def.nameKey) : c.type, n: c.num });
  }
  function itemName(id) {
    const it = D().items[id];
    if (it) return T(it.nameKey);
    const cd = D().crafts[id];
    if (cd) return T(cd.nameKey);
    return id;
  }
  const facName = (type) => (D().facilities[type] ? T(D().facilities[type].nameKey) : type);
  const topicName = (id) => (OV.T.has('research.' + id) ? T('research.' + id) : id);
  const prodName = (id) => {
    const m = D().manufacture[id];
    return m && m.nameKey ? T(m.nameKey) : id;
  };
  const unitName = (u) => (OV.T.has('unit.' + u) ? T('unit.' + u) : u);
  function rankName(r, abbr) {
    const def = D().ranks && D().ranks.soldier ? D().ranks.soldier[r | 0] : null;
    return def ? T(abbr ? def.abbrKey : def.nameKey) : '';
  }
  const hoursLeft = (G, etaT) => Math.max(0, Math.ceil((etaT - G.t) / 3600));
  // «+10» vai até à dezena seguinte (1 → 10 → 20), não 1 → 11
  const nextTen = (v) => Math.floor(v / 10) * 10 + 10;
  /* encomendas do mesmo tipo que chegam na mesma hora numa só linha («7 soldados · chegam dentro de 48 h»):
     → [{kind, itemId, n, h}] por ordem de chegada */
  function groupDeliveries(G, list) {
    const out = [], by = {};
    for (const d of list.slice().sort((x, y) => x.etaT - y.etaT)) {
      const h = hoursLeft(G, d.etaT);
      const k = d.kind + '|' + (d.itemId || '') + '|' + h;
      if (by[k]) by[k].n += d.n | 0;
      else out.push((by[k] = { kind: d.kind, itemId: d.itemId || null, n: d.n | 0, h }));
    }
    return out;
  }
  const researched = (G, id) => !id || G.researched.indexOf(id) >= 0;
  const inHangar = (c) => !!c && IN_HANGAR[c.status] === 1;
  function effectLines(def) {
    const out = [];
    if (def.lift) out.push(T('facility.effect.lift'));
    for (const k of ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts']) if (def[k] > 0) out.push(T('facility.effect.' + k, { n: def[k] }));
    if (def.radarRange > 0) out.push(T('facility.effect.radar', { range: int(def.radarRange), chance: def.radarChance }));
    if (def.hyper) out.push(T('facility.effect.hyper'));
    if (def.defence > 0) out.push(T('facility.effect.defence', { power: def.defence, acc: def.hitRatio }));
    return out;
  }
  // primeiro artigo aberto da Ufopédia entre vários candidatos
  function articleTitle(id) {
    try {
      const a = OV.Ufopaedia && OV.Ufopaedia.article ? OV.Ufopaedia.article(id) : null;
      return a ? OV.Ufopaedia.title(a) : id;
    } catch (e) { return id; }
  }
  function articleFor(G, ids) {
    const UP = OV.Ufopaedia;
    if (!UP || !UP.isOpen) return null;
    for (const id of ids) {
      if (!id) continue;
      try {
        const r = UP.resolve ? UP.resolve(id) : id;
        if (r && UP.isOpen(G, r)) return r;
      } catch (e) { /* artigo inexistente */ }
    }
    return null;
  }

  let active = null; // estado da cena aberta (uma de cada vez)

  // ================================================================================================
  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.basescape = function (params) {
    const P = params || {};
    const sc = { id: 'basescape', isScreen: true };
    const S = {
      G: P.G, baseId: null, tab: 'facilities', root: null, r: {}, dirty: true, lastDraw: 0, L: null,
      hover: null, sel: null, build: null, kcur: null, dismantle: null, highlight: null, hlFac: null,
      craftSel: null, solSel: null, sort: { key: 'rank', dir: -1 }, memorial: false, market: 'buy', qty: {}, sellQty: {},
      equip: null, sheet: null, scroll: {}, autoPick: false, ro: null, ghostTip: null, bg: null, bgKey: '',
    };
    sc.S = S;
    const G = () => S.G;
    const base = () => C().findBase(S.G, S.baseId);

    function pickBase(id) {
      const g = S.G;
      if (!g || !g.bases.length) return null;
      return C().findBase(g, id) ? id : g.bases[0].id;
    }

    // ---- montagem ------------------------------------------------------------------------------------
    function mount() {
      const host = OV.Dom.$('hud');
      const root = el('div', { class: 'scr bsc', role: 'region', 'aria-label': T('base.aria') });
      S.root = root;
      const r = S.r;
      r.top = el('header', { class: 'bsc-top' });
      r.tabs = el('nav', { class: 'bsc-tabs', role: 'tablist', 'aria-label': T('base.tabs.aria') });
      r.gridhost = el('div', { class: 'bsc-gridhost', 'aria-hidden': 'true' });
      r.ghost = el('div', { class: 'bsc-ghosttip hidden' });
      r.info = el('section', { class: 'bsc-info', 'aria-live': 'polite' });
      r.caps = el('section', { class: 'bsc-caps' });
      r.left = el('div', { class: 'bsc-left' }, r.gridhost, r.info, r.caps);
      r.content = el('div', { class: 'bsc-content scroll', 'data-scroll': '' });
      r.panel = el('section', { class: 'bsc-panel', role: 'tabpanel' }, r.content);
      r.body = el('div', { class: 'bsc-body' }, r.left, r.panel);
      root.append(r.top, r.tabs, r.body, r.ghost);
      root.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (e.key === 'Escape' && (tag === 'INPUT' || tag === 'SELECT')) { e.preventDefault(); e.target.blur(); }
      });
      host.appendChild(root);
      if (typeof ResizeObserver !== 'undefined') {
        S.ro = new ResizeObserver(() => { S.dirty = true; });
        S.ro.observe(r.gridhost);
      }
    }
    function unmount() {
      if (S.ro) S.ro.disconnect();
      closeEquip(true);
      if (S.sheet) S.sheet.close();
      const root = S.root;
      if (!root) return;
      root.classList.add('scr-leaving');
      root.setAttribute('aria-hidden', 'true');
      setTimeout(() => root.remove(), 170);
      S.root = null;
    }

    // ---- ações sobre a simulação ------------------------------------------------------------------------
    // chama fn() (mutação da simulação), trata os eventos que produziu e redesenha; → resultado ou null
    function act(fn, okText) {
      const g = S.G;
      const n0 = g.events.length;
      let r;
      try {
        r = fn();
      } catch (e) {
        g.events.splice(n0);
        deny(errText(String((e && e.message) || '').replace(/^.*\.err\./, '')));
        refresh();
        return null;
      }
      const evs = g.events.splice(n0);
      for (const ev of evs) eventToast(ev);
      if (r && r.ok === false) {
        deny(errText(r.reason));
        refresh();
        return null;
      }
      sfx('ui_confirm');
      if (okText) OV.Dom.toast(okText, null, 'good');
      refresh();
      return r || { ok: true };
    }
    function eventToast(ev) {
      const g = S.G;
      if (ev.t === 'facilityDone') OV.Dom.toast(T('base.toast.facilityDone', { name: facName(ev.type) }), null, 'good');
      else if (ev.t === 'productionStalled') OV.Dom.toast(T('base.prod.stalledToast.' + ev.reason, { item: prodName(ev.item) }), null, 'warn');
      else if (ev.t === 'craftReady') OV.Dom.toast(T('base.toast.craftReady', { craft: craftName(C().findCraft(g, ev.craftId)) }), null, 'good');
      else g.events.push(ev); // o Geoscape trata o resto
    }

    // ---- separadores ----------------------------------------------------------------------------------------
    function setTab(tab, quiet, byKey) {
      if (TABS.indexOf(tab) < 0) return;
      if (S.tab !== tab) {
        if (S.r.content) S.scroll[S.tab] = S.r.content.scrollTop;
        S.tab = tab;
        if (!quiet) sfx('ui_select');
      }
      if (S.G && S.G.ui) S.G.ui.baseTab = tab;
      // o separador redesenhado (ou o botão que mudou de separador) perde o foco: devolve-o ao separador ativo
      const a = document.activeElement;
      // (atalho 1–9: não — o foco fica no <body> e as setas continuam a mover o cursor da grelha)
      const lost = !byKey && !!a && ((S.r.tabs && S.r.tabs.contains(a)) || (S.r.content && S.r.content.contains(a)));
      renderTabs();
      renderContent();
      if (lost && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected) && !OV.Dom.trapOpen()) {
        const t = S.r.tabs.querySelector('.bsc-tab.on');
        if (t) t.focus({ preventScroll: true });
      }
    }
    function switchBase(d) {
      const g = S.G;
      if (!g || g.bases.length < 2) return;
      const i = g.bases.findIndex((b) => b.id === S.baseId);
      S.baseId = g.bases[(i + d + g.bases.length) % g.bases.length].id;
      S.sel = null;
      S.build = null;
      S.craftSel = null;
      S.solSel = null;
      sfx('ui_select');
      refresh();
    }

    function refresh() {
      if (!S.root) return;
      if (!base()) {
        S.baseId = pickBase(S.baseId);
        if (!S.baseId) { back(); return; }
      }
      // o foco fora do conteúdo (separador, cabeçalho) também sobrevive ao redesenho: nunca cai no <body>
      const a = document.activeElement;
      const fk = a && a !== document.body && S.root.contains(a) && !S.r.content.contains(a) ? OV.Dom.focusKey(a) : null;
      renderTop();
      renderTabs();
      renderInfo();
      renderCaps();
      renderContent();
      const now = document.activeElement;
      if (fk && (!now || now === document.body || !now.isConnected) && !OV.Dom.refocus(fk, S.root)) {
        const t = S.r.tabs.querySelector('.bsc-tab.on');
        if (t) t.focus({ preventScroll: true });
      }
      S.dirty = true;
    }

    // ---- cabeçalho ---------------------------------------------------------------------------------------
    function renderTop() {
      const g = S.G, b = base(), r = S.r;
      OV.Dom.clear(r.top);
      const region = b.region && OV.T.has('region.' + b.region) ? T('region.' + b.region) : '';
      const title = el('div', { class: 'bsc-title-wrap' },
        el('div', { class: 'bsc-kicker', text: T('base.kicker') + (region ? ' · ' + region : '') }),
        el('div', { class: 'bsc-title-row' },
          el('h1', { class: 'bsc-title', text: baseName(b) }),
          btn('✎', { cls: 'small ghost bsc-rename', title: T('base.rename'), tip: T('base.rename.tip'), on: renameBaseDlg })));
      const sw = el('div', { class: 'bsc-switch' });
      if (g.bases.length > 1) {
        sw.append(btn('◀', { cls: 'small', title: T('base.switch.prev'), key: '[', on: () => switchBase(-1) }),
          el('span', { class: 'bsc-switch-n', text: T('base.switch.of', { i: g.bases.findIndex((x) => x.id === b.id) + 1, n: g.bases.length }) }),
          btn('▶', { cls: 'small', title: T('base.switch.next'), key: ']', on: () => switchBase(1) }));
      }
      const up = OV.Economy && OV.Economy.baseUpkeep ? OV.Economy.baseUpkeep(g, b) : null;
      const stats = el('div', { class: 'bsc-topstats' },
        el('div', { class: 'bsc-ts' }, el('span', { text: T('base.date') }), el('b', { class: 'mono', text: OV.U.fmtDate(g.t) })),
        el('div', { class: 'bsc-ts' + (g.funds < 0 ? ' bad' : '') }, el('span', { text: T('base.fundsLbl') }), el('b', { class: 'mono bsc-funds', text: money(g.funds) })),
        up ? el('div', { class: 'bsc-ts bsc-ts-upkeep' }, el('span', { text: T('base.upkeepLbl') }), el('b', { class: 'mono', text: money(up.total) })) : null);
      if (up) {
        OV.Dom.tooltip(stats.lastChild, tipHtml(T('base.upkeep', { money: money(up.total) }), [
          esc(T('base.upkeep.facilities') + ': ' + money(up.facilities)), esc(T('base.upkeep.salaries') + ': ' + money(up.salaries)),
          esc(T('base.upkeep.crafts') + ': ' + money(up.crafts))]));
      }
      const acts = el('div', { class: 'bsc-topbtns' },
        OV.Ufopaedia ? btn(T('base.btn.ufopaedia'), { title: T('base.btn.ufopaedia'), tip: T('base.tip.ufopaedia'), key: 'U', on: () => openUfopaedia(null) }) : null,
        btn(T('base.btn.back'), { cls: 'primary', title: T('base.btn.back'), tip: T('base.tip.back'), key: 'Esc', on: back }));
      r.top.append(title, sw, stats, acts);
    }

    function renderTabs() {
      const r = S.r, g = S.G, b = base();
      OV.Dom.clear(r.tabs);
      const badges = tabBadges(g, b);
      TABS.forEach((tab, i) => {
        const on = tab === S.tab;
        const bd = badges[tab];
        const t = el('button', {
          type: 'button', class: 'bsc-tab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'aria-keyshortcuts': String(i + 1), dataset: { tab },
          tabindex: on ? '0' : '-1',
        }, el('kbd', { text: String(i + 1), 'aria-hidden': 'true' }), el('span', { class: 'bsc-tab-l', text: T('base.tab.' + tab) }),
        bd ? el('span', { class: 'bsc-badge ' + (bd.cls || ''), text: bd.text }) : null);
        t.addEventListener('click', () => setTab(tab));
        OV.Dom.tooltip(t, () => tipHtml(T('base.tab.' + tab), [esc(T('base.tabtip.' + tab)), bd && bd.tip ? warnLine(bd.tip) : ''], String(i + 1)));
        r.tabs.appendChild(t);
      });
    }
    function tabBadges(g, b) {
      const out = {};
      const st = BS().staff(g, b.id);
      const caps = BS().capacities(g, b.id);
      const building = b.grid.filter((f) => f.daysLeft > 0).length;
      if (building) out.facilities = { text: String(building), tip: Tn('base.badge.building', building) };
      const avail = C().availableResearch(g, b.id).length;
      if (st.scientists.free > 0 && caps.labs.used < caps.labs.cap && (avail > 0 || b.research.length)) out.research = { text: '!', cls: 'warn', tip: Tn('base.badge.idleSci', st.scientists.free) };
      else if (b.research.length) out.research = { text: String(b.research.length), tip: Tn('base.badge.projects', b.research.length) };
      const stalled = b.production.filter((p) => p.stalled).length;
      if (stalled) out.production = { text: '!', cls: 'bad', tip: Tn('base.badge.stalled', stalled) };
      else if (st.engineers.free > 0 && b.production.length) out.production = { text: '!', cls: 'warn', tip: Tn('base.badge.idleEng', st.engineers.free) };
      else if (b.production.length) out.production = { text: String(b.production.length), tip: Tn('base.badge.orders', b.production.length) };
      const arriving = b.deliveries.filter((d) => d.kind === 'soldier' || d.kind === 'scientist' || d.kind === 'engineer').reduce((s, d) => s + d.n, 0);
      if (arriving) out.personnel = { text: '+' + arriving, tip: Tn('base.badge.arriving', arriving) };
      if (caps.storage.usedTenths > caps.storage.cap * 10) out.stores = { text: '!', cls: 'bad', tip: T('base.badge.storageOver') };
      const away = b.crafts.map((id) => C().findCraft(g, id)).filter((c) => c && !inHangar(c)).length;
      if (away) out.crafts = { text: String(away), cls: 'info', tip: Tn('base.badge.away', away) };
      const wounded = b.soldiers.map((id) => C().findSoldier(g, id)).filter((s) => s && s.woundDays > 0).length;
      if (wounded) out.soldiers = { text: String(wounded), cls: 'bad', tip: Tn('base.badge.wounded', wounded) };
      const items = b.deliveries.filter((d) => d.kind === 'item' || d.kind === 'craft').length;
      if (items) out.market = { text: String(items), cls: 'info', tip: Tn('base.badge.deliveries', items) };
      const aliens = Object.values(b.aliens).reduce((s, n) => s + n, 0);
      if (aliens) out.containment = { text: String(aliens), tip: Tn('base.badge.aliens', aliens) };
      return out;
    }

    // ---- barra de informação (debaixo da grelha) ---------------------------------------------------------------
    function renderInfo() {
      const r = S.r, b = base(), g = S.G;
      OV.Dom.clear(r.info);
      r.info.className = 'bsc-info';
      if (S.build) {
        const def = D().facilities[S.build.type];
        const cur = S.hover || S.kcur;
        let state;
        if (cur) {
          const p = ghostPos(cur);
          const why = BS().canPlace(g, b.id, S.build.type, p.x, p.y);
          state = why ? el('span', { class: 'bad', text: errText(why) }) : el('span', { class: 'good', text: !S.hover && S.kcur && !touchNow() ? T('base.build.validHere.key') : TT('base.build.validHere') });
          r.info.classList.add(why ? 'invalid' : 'valid');
        } else state = el('span', { class: 'muted', text: T('base.build.hint') });
        r.info.append(el('div', { class: 'bsc-info-main' }, facIcon(S.build.type, 40),
          el('div', { class: 'bsc-info-txt' },
            el('div', { class: 'bsc-info-name', text: T('base.build.placing', { name: facName(S.build.type) }) }),
            el('div', { class: 'bsc-info-sub' }, state),
            el('div', { class: 'bsc-info-sub muted', text: T('base.build.costLine', { cost: money(def.cost), days: Tn('common.days', def.days), upkeep: money(def.upkeep) }) }))),
        el('div', { class: 'bsc-info-btns' }, btn(T('common.cancel'), { cls: 'small', title: T('base.build.cancel'), tip: T('base.build.cancelTip'), key: 'Esc', on: cancelBuild })));
        return;
      }
      const at = S.sel || S.hover || S.kcur;
      const f = at ? OV.BaseRender.facilityAt(b, at.x, at.y) : null;
      if (!f) {
        r.info.append(el('div', { class: 'bsc-info-main' }, el('div', { class: 'bsc-info-txt' },
          el('div', { class: 'bsc-info-name muted', text: T('base.info.idle') }),
          el('div', { class: 'bsc-info-sub muted', text: TT('base.info.idleHint') }))));
        return;
      }
      const def = D().facilities[f.type];
      const status = f.daysLeft > 0 ? el('span', { class: 'warn', text: T('base.facility.building') + ' · ' + Tn('base.build.daysLeft', f.daysLeft) }) : el('span', { class: 'good', text: T('base.facility.ready') });
      let extra = '';
      if (f.type === 'hangar') {
        const slot = OV.BaseRender.hangarSlots(b).find((h) => h.x === f.x && h.y === f.y);
        const c = slot && slot.craftId ? C().findCraft(g, slot.craftId) : null;
        extra = c ? T('base.info.hangarCraft', { craft: craftName(c), status: T('craft.status.' + c.status) }) : f.daysLeft > 0 ? '' : T('base.info.hangarEmpty');
      }
      r.info.append(el('div', { class: 'bsc-info-main' }, facIcon(f.type, 40),
        el('div', { class: 'bsc-info-txt' },
          el('div', { class: 'bsc-info-name' }, el('span', { text: facName(f.type) }), el('span', { class: 'bsc-info-sep', text: ' · ' }), status),
          el('div', { class: 'bsc-info-sub muted', text: [effectLines(def).join(' · '), extra].filter(Boolean).join(' — ') }))));
      if (S.sel) {
        const why = BS().canDismantle(g, b.id, f.x, f.y);
        const jump = jumpTab(f.type);
        const btns = el('div', { class: 'bsc-info-btns' },
          jump ? btn(T('base.info.open', { tab: T('base.tab.' + jump) }), { cls: 'small', title: T('base.info.open', { tab: T('base.tab.' + jump) }), tip: T('base.info.openTip'), key: String(TABS.indexOf(jump) + 1), on: () => { setTab(jump); if (f.type === 'hangar') selectHangarCraft(f); } }) : null,
          btn(T('base.dismantle'), {
            cls: 'small danger', title: T('base.dismantle'), tip: T('base.dismantle.tip'), key: '⌫', why: why ? errText(why) : null,
            on: () => dismantleDlg(f), hover: (on) => { S.dismantle = on ? { x: f.x, y: f.y, ok: !why } : null; S.dirty = true; },
          }));
        r.info.appendChild(btns);
      }
    }
    function jumpTab(type) {
      return { laboratory: 'research', workshop: 'production', living_quarters: 'personnel', general_stores: 'stores', hangar: 'crafts', alien_containment: 'containment' }[type] || null;
    }
    function selectHangarCraft(f) {
      const b = base();
      const slot = OV.BaseRender.hangarSlots(b).find((h) => h.x === f.x && h.y === f.y);
      if (slot && slot.craftId) { S.craftSel = slot.craftId; renderContent(); }
    }

    // ---- medidores de capacidade --------------------------------------------------------------------------------
    function renderCaps() {
      const r = S.r, b = base();
      OV.Dom.clear(r.caps);
      S.highlight = null;
      const caps = BS().capacities(S.G, b.id);
      for (const k of CAP_KEYS) {
        const c = caps[k];
        const m = meter(T('base.capShort.' + k), c.used, c.cap, {
          fmt: k === 'storage' ? dec1 : null, data: { cap: k },
          tip: () => tipHtml(T('base.cap.' + k), [esc(T('base.captip.' + k)), c.used > c.cap ? warnLine(T('base.cap.over')) : c.used >= c.cap && c.cap > 0 ? warnLine(T('base.cap.full')) : '']),
        });
        m.addEventListener('mouseenter', () => { S.highlight = CAP_FAC[k]; S.dirty = true; });
        m.addEventListener('mouseleave', () => { S.highlight = null; S.dirty = true; });
        r.caps.appendChild(m);
      }
    }

    // ---- conteúdo do separador ------------------------------------------------------------------------------
    function renderContent() {
      const r = S.r;
      const keep = r.content.scrollTop;
      const same = r.content.dataset.tab === S.tab;
      // o foco do teclado sobrevive ao redesenho (Contratar, Iniciar, Gravar…): reencontra o mesmo botão pela chave
      const a = document.activeElement;
      const hadFocus = same && !!a && r.content.contains(a);
      const fk = hadFocus ? OV.Dom.focusKey(a) : null;
      OV.Dom.hideTooltip();
      OV.Dom.clear(r.content);
      S.hlFac = null; // a linha sob o rato desaparece sem mouseleave
      r.content.dataset.tab = S.tab;
      r.panel.dataset.tab = S.tab;
      r.body.dataset.tab = S.tab; // retrato: fora das Instalações a grelha encolhe e o separador fica com a altura (basescape.css)
      const fn = { facilities: tabFacilities, research: tabResearch, production: tabProduction, personnel: tabPersonnel, stores: tabStores, crafts: tabCrafts, soldiers: tabSoldiers, market: tabMarket, containment: tabContainment }[S.tab];
      r.content.appendChild(fn());
      r.content.scrollTop = same ? keep : S.scroll[S.tab] || 0;
      if (hadFocus && !(fk && OV.Dom.refocus(fk, r.content))) {
        // o botão desapareceu: o foco vai para o separador ativo (nunca para o <body>)
        const t = r.tabs.querySelector('.bsc-tab.on');
        if (t) t.focus({ preventScroll: true });
      }
      if (S.focusSol) { S.focusSol = false; const tr = r.content.querySelector('tr[data-sol].sel'); if (tr) tr.focus({ preventScroll: true }); }
      // soldado escolhido com o rato/toque: a ficha (renomear, armadura, nave) entra na área visível se estiver abaixo
      if (S.revealSol) { S.revealSol = false; revealDetail(); }
    }
    function revealDetail() {
      const box = S.r.content, d = box.querySelector('.bsc-sol-detail');
      if (!d) return;
      const top = d.getBoundingClientRect().top - box.getBoundingClientRect().top;
      // só quando o topo da ficha não se vê (no ecrã largo a ficha já está à vista ao lado da lista)
      if (top > box.clientHeight - 72) box.scrollTop += Math.min(top - 8, top - box.clientHeight + Math.min(d.offsetHeight, box.clientHeight) + 8);
    }
    function head(title, sub, ...right) {
      return el('div', { class: 'bsc-head' },
        el('div', { class: 'bsc-head-t' }, el('h2', { class: 'bsc-h', text: title }), sub ? el('div', { class: 'bsc-head-sub', text: sub }) : null),
        el('div', { class: 'bsc-head-r' }, ...right));
    }
    const section = (title, ...kids) => el('section', { class: 'bsc-sec' }, el('h3', { class: 'bsc-sec-t', text: title }), ...kids);
    const note = (text, cls) => el('p', { class: 'bsc-note ' + (cls || ''), text });

    // ---------------------------------------------------------------------------------------------------- 1
    function tabFacilities() {
      const g = S.G, b = base();
      const wrap = el('div', { class: 'bsc-tab-fac' });
      wrap.appendChild(head(T('base.tab.facilities'), T('base.fac.sub', { n: b.grid.length })));
      const list = el('div', { class: 'bsc-list bsc-buildlist' });
      const types = Object.keys(D().facilities).filter((t) => OV.T.has(D().facilities[t].nameKey));
      for (const type of types) {
        const def = D().facilities[type];
        let why = null;
        if (def.research && !researched(g, def.research)) why = T('base.place.locked', { topic: topicName(def.research) });
        else if (def.lift && b.grid.some((f) => D().facilities[f.type] && D().facilities[f.type].lift)) why = T('base.build.liftOne');
        else if (g.funds < def.cost) why = errText('funds');
        const on = S.build && S.build.type === type;
        const row = el('button', { type: 'button', class: 'bsc-row bsc-fac' + (why ? ' locked' : '') + (on ? ' on' : ''), dataset: { fac: type }, 'aria-disabled': why ? 'true' : null },
          facIcon(type, 44),
          el('div', { class: 'bsc-row-main' },
            el('div', { class: 'bsc-row-name', text: facName(type) }),
            el('div', { class: 'bsc-row-sub', text: effectLines(def).join(' · ') }),
            why ? el('div', { class: 'bsc-row-why', text: why }) : null),
          el('div', { class: 'bsc-fac-num' },
            el('b', { class: g.funds < def.cost ? 'bad' : '', text: money(def.cost) }),
            el('span', { text: Tn('common.days', def.days) }),
            el('span', { class: 'muted', text: T('base.perMonth', { money: money(def.upkeep) }) })));
        row.addEventListener('click', () => {
          if (why) { deny(why); return; }
          startBuild(type);
        });
        row.addEventListener('mouseenter', () => { S.hlFac = type; S.dirty = true; });
        row.addEventListener('mouseleave', () => { S.hlFac = null; S.dirty = true; });
        OV.Dom.tooltip(row, () => tipHtml(facName(type), [esc(T('base.build.cost') + ': ' + money(def.cost)), esc(T('base.build.days') + ': ' + Tn('common.days', def.days)),
          esc(T('base.build.upkeep') + ': ' + money(def.upkeep)), why ? warnLine(why) : esc(TT('base.build.clickToPlace'))]));
        list.appendChild(row);
      }
      wrap.appendChild(section(T('base.build.title'), note(T('base.build.rules')), list));
      // obras em curso por baixo da lista de construção: iniciar uma obra não empurra a lista (o clique seguinte cai no mesmo sítio)
      const building = b.grid.filter((f) => f.daysLeft > 0);
      if (building.length) {
        const ul = el('div', { class: 'bsc-list' });
        for (const f of building) {
          const def = D().facilities[f.type];
          const pct = def.days > 0 ? 1 - f.daysLeft / def.days : 1;
          const row = el('div', { class: 'bsc-row bsc-build-row' }, facIcon(f.type, 36),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: facName(f.type) }),
              el('div', { class: 'bsc-prog' }, el('i', { style: { width: (pct * 100).toFixed(0) + '%' } }))),
            el('div', { class: 'bsc-row-val warn', text: Tn('base.build.daysLeft', f.daysLeft) }));
          row.addEventListener('mouseenter', () => { S.sel = { x: f.x, y: f.y }; S.dirty = true; renderInfo(); });
          ul.appendChild(row);
        }
        wrap.appendChild(section(T('base.fac.underway'), ul));
      }
      return wrap;
    }

    // ---- construção e desmantelamento ---------------------------------------------------------------------------
    function startBuild(type) {
      S.build = { type };
      S.sel = null;
      const b = base();
      // cursor de teclado: primeira posição válida (ou o centro)
      S.kcur = null;
      for (let y = 0; y < 6 && !S.kcur; y++) for (let x = 0; x < 6 && !S.kcur; x++) if (!BS().canPlace(S.G, b.id, type, x, y)) S.kcur = { x, y };
      if (!S.kcur) S.kcur = { x: 2, y: 2 };
      sfx('ui_select');
      renderInfo();
      renderContent();
      S.dirty = true;
    }
    function cancelBuild() {
      if (!S.build) return;
      S.build = null;
      S.kcur = null;
      hideGhostTip();
      sfx('ui_click');
      renderInfo();
      renderContent();
      S.dirty = true;
    }
    function ghostPos(cell) {
      const size = S.build ? D().facilities[S.build.type].size : 1;
      return { x: Math.max(0, Math.min(6 - size, cell.x)), y: Math.max(0, Math.min(6 - size, cell.y)) };
    }
    async function tryPlace(cell, quick) {
      if (!S.build) return;
      const g = S.G, b = base(), type = S.build.type;
      const p = ghostPos(cell);
      const why = BS().canPlace(g, b.id, type, p.x, p.y);
      if (why) { deny(errText(why)); return; }
      const def = D().facilities[type];
      if (!quick) {
        const body = el('div', { class: 'bsc-confirm' }, facIcon(type, 64),
          el('div', null, el('p', { class: 'modal-text', text: T('base.build.confirm', { name: facName(type), cost: money(def.cost) }) }),
            el('p', { class: 'bsc-note', text: T('base.build.costLine', { cost: money(def.cost), days: Tn('common.days', def.days), upkeep: money(def.upkeep) }) }),
            el('p', { class: 'bsc-note muted', text: T('base.build.fundsAfter', { money: money(g.funds - def.cost) }) })));
        const ok = await OV.Dom.modal({ title: T('base.build.title'), body, buttons: [{ label: T('common.cancel'), value: false }, { label: T('base.build'), value: true, kind: 'primary' }] });
        if (!ok || !S.build || !S.root) return;
      }
      const r = act(() => BS().build(g, b.id, type, p.x, p.y), T('base.toast.buildStarted', { name: facName(type), days: Tn('common.days', def.days) }));
      if (r && !quick) {
        S.build = null;
        S.kcur = null;
        hideGhostTip();
        S.sel = { x: p.x, y: p.y };
        refresh();
      }
    }
    async function dismantleDlg(f) {
      const g = S.G, b = base();
      const why = BS().canDismantle(g, b.id, f.x, f.y);
      if (why) { deny(errText(why)); return; }
      const ok = await OV.Dom.modal({
        title: T('base.dismantle'), cls: 'alert',
        body: el('div', { class: 'bsc-confirm' }, facIcon(f.type, 64), el('p', { class: 'modal-text', text: T('base.dismantle.confirm', { name: facName(f.type) }) })),
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('base.dismantle'), value: true, kind: 'danger' }],
      });
      S.dismantle = null;
      if (!ok || !S.root) return;
      if (act(() => BS().dismantle(g, b.id, f.x, f.y), T('base.toast.dismantled', { name: facName(f.type) }))) {
        S.sel = null;
        refresh();
      }
    }
    function renameBaseDlg() {
      const b = base();
      const inp = el('input', { type: 'text', class: 'bsc-input', maxlength: '24', value: baseName(b), 'aria-label': T('base.rename') });
      const s = sheet(T('base.rename'), el('div', { class: 'bsc-rename-box' }, inp), [
        { label: T('common.cancel') },
        { label: T('base.rename.ok'), kind: 'primary', on: () => { act(() => BS().renameBase(S.G, b.id, inp.value)); s.close(); } },
      ]);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(() => BS().renameBase(S.G, b.id, inp.value)); s.close(); } });
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    // ---------------------------------------------------------------------------------------------------- 2
    function storyHints(g) {
      const out = [];
      const f = g.flags || {};
      if (f.cydoniaUnlocked) out.push(TT('base.research.hint.finalMission'));
      else if (researched(g, 'martian_solution') && !f.commanderInterrogated) out.push(T('base.research.hint.commander'));
      else if (researched(g, 'alien_origins') && !f.leaderInterrogated) out.push(T('base.research.hint.leader'));
      else if (!f.interrogated && g.researched.length >= 3 && !g.bases.some((b) => Object.keys(b.aliens).length || b.research.some((p) => /^interrogate_/.test(p.topic)))) out.push(T('base.research.hint.capture'));
      return out;
    }
    function sciStepper(p) {
      const g = S.G, b = base();
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const room = Math.max(0, Math.min(st.scientists.free, caps.labs.cap - caps.labs.used));
      const roomWhy = st.scientists.free <= 0 ? errText('scientists') : errText('labs');
      const set = (n) => act(() => BS().setScientists(g, b.id, p.topic, n));
      const nm = topicName(p.topic);
      const ar = (k) => ctxName(T(k), nm);
      return el('div', { class: 'bsc-stepper', dataset: { topic: p.topic } },
        btn('−5', { cls: 'small', title: T('base.sci.minus5'), aria: ar('base.sci.minus5'), why: p.scientists <= 0 ? T('base.sci.none') : null, on: () => set(Math.max(0, p.scientists - 5)) }),
        btn('−', { cls: 'small', title: T('base.sci.minus1'), aria: ar('base.sci.minus1'), why: p.scientists <= 0 ? T('base.sci.none') : null, on: () => set(p.scientists - 1) }),
        el('b', { class: 'bsc-step-v', text: String(p.scientists) }),
        btn('+', { cls: 'small', title: T('base.sci.plus1'), aria: ar('base.sci.plus1'), why: room <= 0 ? roomWhy : null, on: () => set(p.scientists + 1) }),
        btn('+5', { cls: 'small', title: T('base.sci.plus5'), aria: ar('base.sci.plus5'), why: room <= 0 ? roomWhy : null, on: () => set(p.scientists + Math.min(5, room)) }),
        btn(T('base.btn.all'), { cls: 'small', title: T('base.sci.all'), aria: ar('base.sci.all'), tip: T('base.sci.allTip'), why: room <= 0 ? roomWhy : null, on: () => set(p.scientists + room) }));
    }
    function tabResearch() {
      const g = S.G, b = base();
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const avail = C().availableResearch(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-res' });
      const newWhy = !avail.length ? T('base.research.none') : caps.labs.cap <= 0 ? errText('labs') : null;
      wrap.appendChild(head(T('base.tab.research'), Tn('base.research.sub', avail.length),
        btn(T('base.research.new') + (avail.length ? ' (' + avail.length + ')' : ''), { cls: 'primary', title: T('base.research.new'), tip: T('base.research.newTip'), key: 'N', why: newWhy, on: researchPicker, data: { act: 'newResearch' } })));
      wrap.appendChild(el('div', { class: 'bsc-meters2' },
        meter(T('base.personnel.scientists'), st.scientists.total - st.scientists.free, st.scientists.total, { text: T('base.sci.busyOf', { busy: st.scientists.total - st.scientists.free, total: st.scientists.total }) }),
        meter(T('base.cap.labs'), caps.labs.used, caps.labs.cap)));
      if (st.scientists.free > 0 && caps.labs.used < caps.labs.cap) {
        wrap.appendChild(note(Tn('base.research.idle', st.scientists.free), 'warn'));
      }
      for (const h of storyHints(g)) wrap.appendChild(note(h, 'story'));
      if (!b.research.length) {
        wrap.appendChild(el('div', { class: 'bsc-empty' }, el('p', { text: T('base.research.noActive') }),
          avail.length ? btn(T('base.research.new'), { cls: 'primary', title: T('base.research.new'), key: 'N', why: newWhy, on: researchPicker }) : null));
        return wrap;
      }
      const list = el('div', { class: 'bsc-cards' });
      for (const p of b.research) {
        const topic = D().researchTopic(p.topic);
        const lbl = BS().researchLabel(g, b.id, p.topic);
        const art = articleFor(g, [p.topic].concat((topic && topic.needItem) || [], (topic && topic.items) || []));
        const card = el('div', { class: 'bsc-card bsc-proj', dataset: { topic: p.topic } },
          el('div', { class: 'bsc-card-h' },
            el('div', { class: 'bsc-card-t' }, el('div', { class: 'bsc-row-name', text: topicName(p.topic) }),
              el('div', { class: 'bsc-row-sub', text: T('research.cat.' + ((topic && topic.cat) || 'story')) + (topic && topic.interrogation ? ' · ' + T('base.research.interrogation') : '') })),
            el('span', { class: 'bsc-chip prog ' + (PROG_CLS[lbl] || ''), text: T(lbl) })),
          el('div', { class: 'bsc-card-row' }, el('span', { class: 'bsc-lbl', text: T('base.research.scientists') }), sciStepper(p)),
          el('div', { class: 'bsc-card-act' },
            art ? btn(T('base.btn.ufopaedia'), { cls: 'small ghost', title: T('base.tip.article'), aria: T('base.tip.articleFor', { name: articleTitle(art) }), on: () => openUfopaedia(art) }) : null,
            btn(T('base.research.cancel'), { cls: 'small danger', title: T('base.research.cancel'), tip: T('base.research.cancelTip'), on: () => cancelResearchDlg(p) })));
        if (!p.scientists) card.appendChild(note(T('base.research.stopped'), 'warn'));
        list.appendChild(card);
      }
      wrap.appendChild(section(T('base.research.active'), list));
      return wrap;
    }
    async function cancelResearchDlg(p) {
      const topic = D().researchTopic(p.topic);
      const live = topic && topic.consumes && topic.consumes.liveAlien;
      // um interrogatório cancelado devolve o alienígena à contenção (BaseSim.cancelResearch → returned)
      const loss = live ? T('base.research.cancelReturns', { name: unitName(live) }) : T('base.research.cancelLoss');
      const ok = await OV.Dom.modal({ title: T('base.research.cancel'), body: T('base.research.cancelConfirm', { name: esc(topicName(p.topic)) }) + '<br><span class="muted">' + esc(loss) + '</span>', buttons: [{ label: T('common.no'), value: false }, { label: T('base.research.cancel'), value: true, kind: 'danger' }] });
      if (!ok || !S.root) return;
      const r = act(() => BS().cancelResearch(S.G, base().id, p.topic), T('base.toast.researchCancelled', { name: topicName(p.topic) }));
      if (r && r.returned) OV.Dom.toast(T('base.toast.alienReturned', { name: unitName(r.returned) }), null, 'info');
    }
    function researchPicker() {
      const g = S.G, b = base();
      const avail = C().availableResearch(g, b.id);
      if (!avail.length) { deny(T('base.research.none')); return; }
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const give = Math.max(0, Math.min(st.scientists.free, caps.labs.cap - caps.labs.used));
      const body = el('div', { class: 'bsc-picker' });
      body.appendChild(note(give > 0 ? Tn('base.research.willAssign', give) : T('base.research.noneFree'), give > 0 ? '' : 'warn'));
      const groups = {};
      for (const id of avail) {
        const t = D().researchTopic(id);
        const cat = (t && t.cat) || 'story';
        (groups[cat] = groups[cat] || []).push(id);
      }
      const order = ['story', 'alien_life', 'alien_tech', 'weapons', 'equipment', 'armour', 'craft', 'facility'];
      for (const cat of Object.keys(groups).sort((a, c) => order.indexOf(a) - order.indexOf(c))) {
        const list = el('div', { class: 'bsc-list' });
        for (const id of groups[cat]) {
          const t = D().researchTopic(id);
          const notes = [];
          if (t.needItem) notes.push(T('base.research.needsItem', { item: itemName(D().researchConsumable(id, b.stores) || t.needItem[0]) }));
          if (t.interrogation) notes.push(T('base.research.consumesAlien'));
          // projetos novos pelo nome; fabrico e construção com o verbo, para não parecer uma tautologia («Kit Médico — Desbloqueia: Kit Médico»)
          const leads = (t.unlocks || []).map(topicName).concat((t.enables && t.enables.manufacture || []).map((m) => T('base.research.leadMake', { name: prodName(m) })),
            (t.enables && t.enables.facilities || []).map((f) => T('base.research.leadBuild', { name: facName(f) })));
          if (leads.length) notes.push(T('base.research.unlocks') + ': ' + leads.slice(0, 4).join(', ') + (leads.length > 4 ? '…' : ''));
          const art = articleFor(g, [id].concat(t.needItem || [], t.items || []));
          const row = el('div', { class: 'bsc-row bsc-pick', dataset: { topic: id } },
            t.needItem ? itemIcon(D().researchConsumable(id, b.stores) || t.needItem[0], 36) : t.interrogation ? alienIcon(t.unit, 36) : el('span', { class: 'bsc-glyph', text: '◆' }),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: topicName(id) }),
              notes.length ? el('div', { class: 'bsc-row-sub', text: notes.join(' · ') }) : null),
            el('div', { class: 'bsc-row-btns' },
              art ? btn(T('base.btn.ufopaedia'), { cls: 'small ghost', title: T('base.tip.article'), aria: T('base.tip.articleFor', { name: articleTitle(art) }), on: () => { s.close(); openUfopaedia(art); } }) : null,
              btn(T('base.research.start'), {
                cls: 'small primary', title: T('base.research.start'), aria: T('base.research.startAria', { name: topicName(id) }), tip: Tn('base.research.startTip', give), data: { start: id }, once: true,
                on: () => {
                  s.close();
                  act(() => BS().startResearch(g, b.id, id, give), T('base.toast.researchStarted', { name: topicName(id), who: Tn('base.nSci', give) }));
                },
              })));
          list.appendChild(row);
        }
        body.appendChild(section(T('research.cat.' + cat), list));
      }
      // aberto pela tecla N: ao fechar, o foco volta ao botão «Novo projeto» e não ao <body>
      const s = sheet(T('base.research.new'), body, [{ label: T('common.close') }], 'bsc-sheet-research', S.r.content.querySelector('[data-act="newResearch"]'));
    }

    // ---------------------------------------------------------------------------------------------------- 3
    function materialsLine(m, stores) {
      const box = el('span', { class: 'bsc-mats' });
      const ids = Object.keys(m.materials);
      if (!ids.length) { box.appendChild(el('span', { class: 'muted', text: T('base.prod.noMaterials') })); return box; }
      for (const id of ids) {
        const have = stores[id] | 0, need = m.materials[id];
        box.appendChild(el('span', { class: 'bsc-mat ' + (have >= need ? 'ok' : 'short') }, itemIcon(id, 18), el('span', { text: T('base.prod.have', { name: itemName(id), have, need }) })));
      }
      return box;
    }
    function tabProduction() {
      const g = S.G, b = base();
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const avail = C().availableManufacture(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-prod' });
      const newWhy = !avail.length ? T('base.prod.none') : caps.workshops.cap <= 0 ? errText('workshops') : null;
      wrap.appendChild(head(T('base.tab.production'), Tn('base.prod.sub', avail.length),
        btn(T('base.prod.new') + (avail.length ? ' (' + avail.length + ')' : ''), { cls: 'primary', title: T('base.prod.new'), tip: T('base.prod.newTip'), key: 'N', why: newWhy, on: prodPicker, data: { act: 'newProduction' } })));
      wrap.appendChild(el('div', { class: 'bsc-meters2' },
        meter(T('base.personnel.engineers'), st.engineers.total - st.engineers.free, st.engineers.total, { text: T('base.eng.busyOf', { busy: st.engineers.total - st.engineers.free, total: st.engineers.total }) }),
        meter(T('base.cap.workshops'), caps.workshops.used, caps.workshops.cap)));
      if (!b.production.length) {
        wrap.appendChild(el('div', { class: 'bsc-empty' }, el('p', { text: avail.length ? T('base.prod.noActive') : T('base.prod.none') }),
          avail.length ? btn(T('base.prod.new'), { cls: 'primary', title: T('base.prod.new'), key: 'N', why: newWhy, on: prodPicker }) : null));
        return wrap;
      }
      if (st.engineers.free > 0) wrap.appendChild(note(Tn('base.prod.idle', st.engineers.free), 'warn'));
      const list = el('div', { class: 'bsc-cards' });
      for (const p of b.production) {
        const m = D().manufacture[p.item];
        if (!m) continue;
        const left = Math.max(0, m.hours - p.spent);
        const eta = p.engineers > 0 ? Math.ceil(left / p.engineers) : 0;
        const qtyText = p.qty > 0 ? T('base.prod.done', { done: p.done, qty: p.qty }) : T('base.prod.contDone', { n: p.done });
        const roomEng = Math.max(0, Math.min(st.engineers.free, caps.workshops.cap - caps.workshops.used));
        const engWhy = st.engineers.free <= 0 ? errText('engineers') : errText('workshops');
        const setE = (n) => act(() => BS().setEngineers(g, b.id, p.id, n));
        const setQ = (q) => act(() => BS().setQty(g, b.id, p.id, q));
        const ar = (k) => ctxName(T(k), prodName(p.item));
        const card = el('div', { class: 'bsc-card bsc-order' + (p.stalled ? ' stalled' : ''), dataset: { pid: p.id } },
          el('div', { class: 'bsc-card-h' }, itemOrCraftIcon(m, 40),
            el('div', { class: 'bsc-card-t' }, el('div', { class: 'bsc-row-name', text: prodName(p.item) }),
              el('div', { class: 'bsc-row-sub', text: qtyText + ' · ' + T('base.prod.unitCost', { money: money(m.cost) }) })),
            p.stalled ? el('span', { class: 'bsc-chip bad', text: T('base.prod.stalled.' + p.stalled) }) : el('span', { class: 'bsc-chip good', text: T('base.prod.running') })),
          el('div', { class: 'bsc-unit' },
            el('div', { class: 'bsc-prog' + (p.paid ? '' : ' unpaid') }, el('i', { style: { width: Math.min(100, (p.spent / m.hours) * 100).toFixed(1) + '%' } })),
            el('span', { class: 'mono', text: T('base.prod.unitHours', { spent: p.spent, hours: m.hours }) }),
            el('span', { class: p.stalled ? 'bad' : p.engineers > 0 ? 'muted' : 'warn', text: p.stalled ? T('base.prod.stalled.' + p.stalled) : p.engineers > 0 ? Tn('base.prod.eta', eta) : T('base.prod.noEngineers') })),
          el('div', { class: 'bsc-card-row' }, el('span', { class: 'bsc-lbl', text: T('base.prod.materials') }), materialsLine(m, b.stores)),
          el('div', { class: 'bsc-card-row' }, el('span', { class: 'bsc-lbl', text: T('base.prod.engineers') }),
            el('div', { class: 'bsc-stepper' },
              btn('−5', { cls: 'small', title: T('base.eng.minus5'), aria: ar('base.eng.minus5'), why: p.engineers <= 0 ? T('base.eng.none') : null, on: () => setE(Math.max(0, p.engineers - 5)) }),
              btn('−', { cls: 'small', title: T('base.eng.minus1'), aria: ar('base.eng.minus1'), why: p.engineers <= 0 ? T('base.eng.none') : null, on: () => setE(p.engineers - 1) }),
              el('b', { class: 'bsc-step-v', text: String(p.engineers) }),
              btn('+', { cls: 'small', title: T('base.eng.plus1'), aria: ar('base.eng.plus1'), why: roomEng <= 0 ? engWhy : null, on: () => setE(p.engineers + 1) }),
              btn('+5', { cls: 'small', title: T('base.eng.plus5'), aria: ar('base.eng.plus5'), why: roomEng <= 0 ? engWhy : null, on: () => setE(p.engineers + Math.min(5, roomEng)) }),
              btn(T('base.btn.all'), { cls: 'small', title: T('base.eng.all'), aria: ar('base.eng.all'), why: roomEng <= 0 ? engWhy : null, on: () => setE(p.engineers + roomEng) }))),
          el('div', { class: 'bsc-card-row' }, el('span', { class: 'bsc-lbl', text: T('base.prod.qty') }),
            el('div', { class: 'bsc-stepper' },
              btn('−', { cls: 'small', title: T('base.prod.qtyMinus'), aria: ar('base.prod.qtyMinus'), why: p.qty <= 1 || p.qty - 1 <= p.done ? T('base.prod.qtyMin') : null, on: () => setQ(p.qty - 1) }),
              el('b', { class: 'bsc-step-v', text: p.qty > 0 ? String(p.qty) : '∞' }),
              btn('+', { cls: 'small', title: T('base.prod.qtyPlus'), aria: ar('base.prod.qtyPlus'), on: () => setQ(p.qty > 0 ? p.qty + 1 : p.done + 1) }),
              btn(T('base.prod.continuous'), { cls: 'small' + (p.qty === 0 ? ' on' : ''), title: T('base.prod.continuous'), aria: ar('base.prod.continuous'), tip: T('base.prod.continuousTip'), on: () => setQ(p.qty === 0 ? p.done + 1 : 0) }))),
          el('div', { class: 'bsc-card-act' },
            btn(T('base.prod.cancel'), { cls: 'small danger', title: T('base.prod.cancel'), aria: ar('base.prod.cancel'), tip: T('base.prod.cancelTip'), on: () => cancelProdDlg(p) })));
        if (p.stalled) card.insertBefore(note(T('base.prod.stalledHelp.' + p.stalled), 'bad'), card.lastChild);
        list.appendChild(card);
      }
      wrap.appendChild(section(T('base.prod.active'), list));
      return wrap;
    }
    function itemOrCraftIcon(m, size) {
      if (m.produces && m.produces.craft) return craftIcon(m.produces.craft, size);
      return itemIcon((m.produces && m.produces.item) || m.id, size);
    }
    async function cancelProdDlg(p) {
      const ok = await OV.Dom.modal({ title: T('base.prod.cancel'), body: T('base.prod.cancelConfirm', { name: esc(prodName(p.item)) }), buttons: [{ label: T('common.no'), value: false }, { label: T('base.prod.cancel'), value: true, kind: 'danger' }] });
      if (ok && S.root) act(() => BS().cancelProduction(S.G, base().id, p.id), T('base.toast.prodCancelled', { name: prodName(p.item) }));
    }
    function prodPicker() {
      const g = S.G, b = base();
      const avail = C().availableManufacture(g, b.id);
      if (!avail.length) { deny(T('base.prod.none')); return; }
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const wsFree = caps.workshops.cap - caps.workshops.used;
      const body = el('div', { class: 'bsc-picker' });
      body.appendChild(note(T('base.prod.pickHint', { eng: st.engineers.free, space: wsFree })));
      const groups = {};
      for (const id of avail) (groups[D().manufacture[id].cat] = groups[D().manufacture[id].cat] || []).push(id);
      for (const cat of Object.keys(groups)) {
        const list = el('div', { class: 'bsc-list' });
        for (const id of groups[cat]) {
          const m = D().manufacture[id];
          const eng = Math.max(0, Math.min(st.engineers.free, wsFree - m.space));
          let why = null;
          if (wsFree < m.space) why = T('base.prod.noSpace', { space: m.space });
          const short = Object.keys(m.materials).some((k) => (b.stores[k] | 0) < m.materials[k]);
          const warns = [];
          if (short) warns.push(T('base.prod.warnMaterials'));
          if (g.funds < m.cost) warns.push(T('base.prod.warnFunds'));
          if (m.produces.craft) warns.push(T('base.prod.needsHangar'));
          const start = (q) => {
            s.close();
            act(() => BS().startProduction(g, b.id, id, eng, q), T('base.toast.prodStarted', { name: prodName(id), who: Tn('base.nEng', eng) }));
          };
          const row = el('div', { class: 'bsc-row bsc-pick', dataset: { item: id } }, itemOrCraftIcon(m, 40),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: prodName(id) }),
              el('div', { class: 'bsc-row-sub', text: T('base.prod.specs', { hours: m.hours, cost: money(m.cost), space: m.space }) }),
              materialsLine(m, b.stores),
              warns.length ? el('div', { class: 'bsc-row-why warn', text: warns.join(' · ') }) : null,
              why ? el('div', { class: 'bsc-row-why', text: why }) : null),
            el('div', { class: 'bsc-row-btns' },
              ...[1, 5, 10].map((q) => btn('×' + q, { cls: 'small' + (q === 1 ? ' primary' : ''), title: T('base.prod.startN', { n: q }), tip: Tn('base.prod.startTip', eng), why, data: { start: id, q: String(q) }, once: true, on: () => start(q) })),
              btn('∞', { cls: 'small', title: T('base.prod.startCont'), tip: T('base.prod.continuousTip'), why, data: { start: id, q: '0' }, once: true, on: () => start(0) })));
          list.appendChild(row);
        }
        body.appendChild(section(T('base.prod.cat.' + cat), list));
      }
      const s = sheet(T('base.prod.new'), body, [{ label: T('common.close') }], 'bsc-sheet-prod');
    }

    // ---------------------------------------------------------------------------------------------------- 4
    function tabPersonnel() {
      const g = S.G, b = base();
      const st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-pers' });
      wrap.appendChild(head(T('base.tab.personnel'), T('base.pers.sub', { h: tune('DELIVERY_PERSONNEL_H', 48) })));
      wrap.appendChild(el('div', { class: 'bsc-meters2' }, meter(T('base.cap.personnel'), caps.personnel.used, caps.personnel.cap, { tip: () => tipHtml(T('base.cap.personnel'), [esc(T('base.captip.personnel'))]) })));
      const arriving = (kind) => b.deliveries.filter((d) => d.kind === kind).reduce((s, d) => s + d.n, 0);
      const soldiers = b.soldiers.map((id) => C().findSoldier(g, id)).filter(Boolean);
      const kinds = [
        { kind: 'soldier', total: soldiers.length, extra: Tn('base.pers.fit', soldiers.filter((s) => !s.woundDays).length) + ' · ' + Tn('base.pers.wounded', soldiers.filter((s) => s.woundDays > 0).length), hire: [1, 5], sack: null },
        { kind: 'scientist', total: st.scientists.total, extra: Tn('base.pers.free', st.scientists.free) + ' · ' + Tn('base.pers.busy', st.scientists.total - st.scientists.free), hire: [1, 5, 10], sack: [1, 5], free: st.scientists.free },
        { kind: 'engineer', total: st.engineers.total, extra: Tn('base.pers.free', st.engineers.free) + ' · ' + Tn('base.pers.busy', st.engineers.total - st.engineers.free), hire: [1, 5, 10], sack: [1, 5], free: st.engineers.free },
      ];
      const grid = el('div', { class: 'bsc-pers' });
      for (const k of kinds) {
        const cost = tune(k.kind.toUpperCase() + '_HIRE', 0), salary = tune(k.kind.toUpperCase() + '_SALARY', 0);
        const arr = arriving(k.kind);
        const hireBtns = k.hire.map((n) => {
          const why = BS().canHire(g, b.id, k.kind, n);
          return btn(T('base.pers.hireN', { n }), {
            cls: 'small' + (n === 1 ? ' primary' : ''), title: T('base.pers.hireTitle', { n, kind: Tn('base.kind.' + k.kind, n) }), data: { hire: k.kind, n: String(n) },
            tip: T('base.pers.hireTip', { cost: money(cost * n), h: tune('DELIVERY_PERSONNEL_H', 48) }), why: why ? errText(why) : null, once: true,
            on: () => act(() => BS().hire(g, b.id, k.kind, n), T('base.toast.hired', { n, kind: Tn('base.kind.' + k.kind, n), h: tune('DELIVERY_PERSONNEL_H', 48) })),
          });
        });
        const sackBtns = (k.sack || []).map((n) => btn(T('base.pers.sackN', { n }), {
          cls: 'small danger', title: T('base.pers.sackTitle', { n, kind: Tn('base.kind.' + k.kind, n) }), tip: T('base.pers.sackTip'), data: { sack: k.kind, n: String(n) },
          why: k.total < n ? errText('count') : k.free < n ? errText('busy') : null, once: true,
          on: () => act(() => BS().sack(g, b.id, k.kind, n), T('base.toast.sacked', { n, kind: Tn('base.kind.' + k.kind, n) })),
        }));
        grid.appendChild(el('div', { class: 'bsc-card bsc-pcard', dataset: { kind: k.kind } },
          el('div', { class: 'bsc-card-h' }, el('span', { class: 'bsc-pglyph ' + k.kind }),
            el('div', { class: 'bsc-card-t' }, el('div', { class: 'bsc-row-name', text: T('base.personnel.' + k.kind + 's') }), el('div', { class: 'bsc-row-sub', text: k.extra })),
            el('b', { class: 'bsc-big', text: String(k.total) })),
          el('div', { class: 'bsc-pinfo' },
            el('span', { text: T('base.personnel.hireCost', { money: money(cost) }) }),
            el('span', { text: T('base.personnel.salary', { money: money(salary) }) }),
            arr ? el('span', { class: 'good', text: T('base.personnel.arriving', { n: arr }) }) : null),
          el('div', { class: 'bsc-card-act' }, ...hireBtns, ...sackBtns),
          k.kind === 'soldier' ? note(T('base.pers.soldierAuto'), 'info') : null,
          k.kind === 'soldier' ? note(T('base.pers.sackSoldierHint'), 'muted') : null));
      }
      wrap.appendChild(grid);
      wrap.appendChild(deliveriesSection((d) => d.kind === 'soldier' || d.kind === 'scientist' || d.kind === 'engineer'));
      return wrap;
    }
    function deliveriesSection(filter) {
      const g = S.G, b = base();
      const list = groupDeliveries(g, b.deliveries.filter(filter));
      const box = el('div', { class: 'bsc-list bsc-deliv' });
      if (!list.length) box.appendChild(note(T('base.deliv.none'), 'muted'));
      for (const d of list) {
        const what = d.kind === 'item' || d.kind === 'craft' ? itemName(d.itemId) : Tn('base.kind.' + d.kind, d.n);
        box.appendChild(el('div', { class: 'bsc-row', dataset: { deliv: d.kind + ':' + (d.itemId || '') } },
          d.kind === 'item' ? itemIcon(d.itemId, 28) : d.kind === 'craft' ? craftIcon(d.itemId, 28) : el('span', { class: 'bsc-pglyph small ' + d.kind }),
          el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: (d.kind === 'item' || d.kind === 'craft' ? d.n + ' × ' : d.n + ' ') + what })),
          el('div', { class: 'bsc-row-val mono', text: Tn('base.deliv.eta', d.n, { h: d.h }) })));
      }
      return section(T('base.deliv.title'), box);
    }

    // ---------------------------------------------------------------------------------------------------- 5
    function tabStores() {
      const g = S.G, b = base();
      const caps = BS().capacities(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-stores' });
      const ids = Object.keys(b.stores).filter((id) => b.stores[id] > 0);
      const total = ids.reduce((s, id) => s + b.stores[id], 0);
      wrap.appendChild(head(T('base.tab.stores'), Tn('base.stores.items', total, { n: int(total) }) + ' · ' + Tn('base.stores.kinds', ids.length)));
      wrap.appendChild(el('div', { class: 'bsc-meters2' }, meter(T('base.cap.storage'), caps.storage.used, caps.storage.cap, { fmt: dec1, tip: () => tipHtml(T('base.cap.storage'), [esc(T('base.captip.storage'))]) })));
      if (caps.storage.usedTenths > caps.storage.cap * 10) wrap.appendChild(note(T('base.stores.over'), 'bad'));
      if (!ids.length) wrap.appendChild(note(T('base.stores.empty'), 'muted'));
      const by = {};
      for (const id of ids) (by[catOf(id)] = by[catOf(id)] || []).push(id);
      for (const [cat] of CATS) {
        if (!by[cat]) continue;
        const list = el('div', { class: 'bsc-grid-items' });
        for (const id of by[cat].sort((x, y) => itemName(x).localeCompare(itemName(y), 'pt'))) {
          const it = D().items[id] || {};
          const n = b.stores[id];
          const art = articleFor(g, [id]);
          const cell = el('div', { class: 'bsc-item' + (art ? ' link' : ''), dataset: { item: id } }, itemIcon(id, 40),
            el('div', { class: 'bsc-item-t' }, el('div', { class: 'bsc-item-n', text: itemName(id) }),
              el('div', { class: 'bsc-item-s', text: T('base.stores.unitsEach', { each: dec1(it.storage || 0.1), u: dec1((it.storage || 0.1) * n) }) })),
            el('b', { class: 'bsc-item-c', text: '×' + int(n) }));
          OV.Dom.tooltip(cell, () => tipHtml(itemName(id), [esc(T('base.stores.tipCount', { n: int(n) })), it.sell > 0 ? esc(T('base.stores.tipSell', { money: money(it.sell) })) : '', art ? esc(T('base.stores.tipArticle')) : '']));
          if (art) cell.addEventListener('click', () => openUfopaedia(art));
          list.appendChild(cell);
        }
        wrap.appendChild(section(T('base.cat.' + cat), list));
      }
      // equipamento a bordo (conta para o armazém, orig)
      const aboard = el('div', { class: 'bsc-list' });
      let anyAboard = false;
      for (const cid of b.crafts) {
        const c = C().findCraft(g, cid);
        if (!c) continue;
        const n = Object.values(c.equipment || {}).reduce((s, v) => s + v, 0);
        if (!n) continue;
        anyAboard = true;
        aboard.appendChild(el('div', { class: 'bsc-row' }, craftIcon(c.type, 28),
          el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: craftName(c) })),
          el('div', { class: 'bsc-row-val', text: Tn('base.stores.aboardN', n) })));
      }
      if (anyAboard) wrap.appendChild(section(T('base.stores.aboard'), note(T('base.stores.aboardHint'), 'muted'), aboard));
      return wrap;
    }

    // ---------------------------------------------------------------------------------------------------- 6
    function craftWhyAway(c) { return inHangar(c) ? null : errText('away'); }
    function tabCrafts() {
      const g = S.G, b = base();
      const crafts = b.crafts.map((id) => C().findCraft(g, id)).filter(Boolean);
      const wrap = el('div', { class: 'bsc-tab-crafts' });
      const caps = BS().capacities(g, b.id);
      wrap.appendChild(head(T('base.tab.crafts'), Tn('base.crafts.n', crafts.length) + ' · ' + Tn('base.crafts.cap', caps.crafts.cap),
        btn(T('base.crafts.buy'), { cls: 'small', title: T('base.crafts.buy'), tip: T('base.crafts.buyTip'), key: '8', on: () => { S.market = 'buy'; setTab('market'); } })));
      if (!crafts.length) { wrap.appendChild(note(T('base.crafts.none'), 'muted')); return wrap; }
      if (!S.craftSel || !crafts.some((c) => c.id === S.craftSel)) S.craftSel = crafts[0].id;
      const list = el('div', { class: 'bsc-craftlist' });
      for (const c of crafts) {
        const def = D().crafts[c.type];
        const card = el('button', { type: 'button', class: 'bsc-craft' + (c.id === S.craftSel ? ' on' : ''), dataset: { craft: c.id } }, craftIcon(c.type, 48),
          el('div', { class: 'bsc-craft-t' }, el('b', { text: craftName(c) }), el('span', { class: 'bsc-chip st-' + c.status, text: T('craft.status.' + c.status) }),
            el('span', { class: 'bsc-craft-mini' }, def.seatsUI > 0 ? T('base.crafts.seats', { n: c.soldiers.length, max: def.seatsUI }) : T('base.crafts.weaponsN', { n: c.weapons.filter(Boolean).length, max: def.weapons }))));
        card.addEventListener('click', () => { S.craftSel = c.id; sfx('ui_select'); renderContent(); });
        OV.Dom.tooltip(card, () => tipHtml(craftName(c), [esc(T('craft.status.' + c.status)), esc(T('base.crafts.fuel') + ' ' + c.fuel + '/' + def.fuel + ' · ' + T('base.crafts.hp') + ' ' + c.hp + '/' + def.hp)]));
        list.appendChild(card);
      }
      wrap.appendChild(list);
      wrap.appendChild(craftDetail(C().findCraft(g, S.craftSel)));
      return wrap;
    }
    function craftDetail(c) {
      const g = S.G, b = base();
      const def = D().crafts[c.type];
      const away = craftWhyAway(c);
      const box = el('div', { class: 'bsc-card bsc-craft-detail', dataset: { craft: c.id } });
      box.appendChild(el('div', { class: 'bsc-cd-head' }, craftIcon(c.type, 96),
        el('div', { class: 'bsc-cd-t' },
          el('div', { class: 'bsc-cd-name' }, el('span', { text: craftName(c) }),
            btn('✎', { cls: 'small ghost', title: T('base.crafts.rename'), tip: T('base.rename.tip'), on: () => renameCraftDlg(c) })),
          el('div', { class: 'bsc-row-sub', text: T(def.nameKey) + ' · ' + T('base.crafts.speed', { kn: int(def.speed) }) }),
          el('span', { class: 'bsc-chip st-' + c.status, text: T('craft.status.' + c.status) }),
          el('div', { class: 'bsc-cd-bars' },
            OV.Dom.bar(c.fuel, def.fuel, 'en', T('base.crafts.fuel') + ' ' + Math.round((c.fuel / def.fuel) * 100) + ' %'),
            OV.Dom.bar(c.hp, def.hp, 'hp', T('base.crafts.hp') + ' ' + Math.round((c.hp / def.hp) * 100) + ' %')))));
      if (!inHangar(c)) box.appendChild(note(T('base.crafts.awayNote'), 'warn'));
      else if (c.status !== 'ready') box.appendChild(note(T('base.crafts.service.' + c.status), 'muted'));
      // missão final (Vingador) e venda da nave
      const acts = el('div', { class: 'bsc-cd-acts' });
      const CU = OV.CampaignUI;
      if (g.flags.cydoniaUnlocked && CU && CU.cydoniaCapable && CU.cydoniaCapable(c)) {
        const st = CU.cydoniaState(g, c.id);
        acts.appendChild(btn(T('base.crafts.cydonia'), { cls: 'primary cydonia', title: T('base.crafts.cydonia'), tip: T('base.crafts.cydoniaTip'), key: 'X', why: st.ok ? null : CU.cydoniaWhy(st.reason), data: { act: 'cydonia' }, on: () => CU.launchCydonia(g, c.id) }));
      }
      const sellWhy = BS().canSellCraft ? BS().canSellCraft(g, c.id) : 'unavailable';
      acts.appendChild(btn(T('base.crafts.sell'), { cls: 'small danger', title: T('base.crafts.sell'), tip: T('base.crafts.sellTip', { price: money(def.sell) }), why: sellWhy ? errText(sellWhy) : null, data: { act: 'sellCraft' }, on: () => sellCraftDlg(c) }));
      box.appendChild(acts);
      // armas
      if (def.weapons > 0) {
        const ws = el('div', { class: 'bsc-list' });
        for (let k = 0; k < def.weapons; k++) {
          const w = c.weapons[k] || null;
          const wd = w ? D().craftWeapons[w.type] : null;
          const ammoTxt = !w ? '' : wd && wd.ammoMax === null ? T('base.crafts.ammoUnlimited') : T('base.crafts.ammo', { n: w.ammo, max: wd ? wd.ammoMax : 0 });
          const stock = wd && wd.ammoItem ? b.stores[wd.ammoItem] | 0 : null;
          ws.appendChild(el('div', { class: 'bsc-row bsc-wslot', dataset: { slot: String(k) } },
            w ? itemIcon(w.type, 36) : el('span', { class: 'bsc-slot-empty' }),
            el('div', { class: 'bsc-row-main' },
              el('div', { class: 'bsc-row-name', text: T('base.crafts.slot', { n: k + 1 }) + ' · ' + (w ? T(wd.nameKey) : T('base.crafts.emptySlot')) }),
              w ? el('div', { class: 'bsc-row-sub', text: ammoTxt + (stock !== null ? ' · ' + T('base.crafts.ammoStock', { name: itemName(wd.ammoItem), n: stock }) : '') }) : null),
            el('div', { class: 'bsc-row-btns' },
              btn(w ? T('base.crafts.swap') : T('base.crafts.fit'), { cls: 'small', title: T('base.crafts.fit'), tip: T('base.crafts.fitTip'), why: away, data: { fit: String(k) }, on: () => weaponPicker(c, k) }),
              w ? btn(T('base.crafts.remove'), { cls: 'small danger', title: T('base.crafts.remove'), tip: T('base.crafts.removeTip'), why: away, on: () => act(() => BS().fitWeapon(g, c.id, k, null), T('base.toast.weaponRemoved', { name: T(wd.nameKey) })) }) : null)));
        }
        box.appendChild(section(T('base.crafts.weapons'), ws));
      }
      // tripulação
      if (def.seatsUI > 0) {
        const max = def.seatsUI;
        const CUI = OV.CampaignUI;
        const idle = CUI && CUI.idleFit ? CUI.idleFit(g, b.id).length : 0;
        const free = Math.max(0, max - c.soldiers.length);
        const unarmed = CUI && CUI.unarmedAboard ? CUI.unarmedAboard(g, c.id).length : 0;
        const boardWhy = away || (!free ? errText('seats') : !idle ? T('base.crafts.noIdle') : null);
        const crewHead = el('div', { class: 'bsc-crew-head' },
          el('span', { class: 'bsc-note muted', text: TT('base.crafts.crewHint') }),
          CUI && CUI.crewUp ? btn(T('base.crafts.boardAll', { n: Math.min(idle, free) }), { cls: 'small' + (!c.soldiers.length && !boardWhy ? ' primary' : ''), title: T('base.crafts.boardAll', { n: Math.min(idle, free) }), tip: T('base.crafts.boardAllTip'), key: 'A', why: boardWhy, data: { act: 'boardAll' }, on: () => crewUpDlg(c) }) : null,
          btn(T('base.crafts.equip'), { cls: 'primary small', title: T('base.crafts.equip'), tip: T('base.crafts.equipTip'), key: 'E', why: away || (!c.soldiers.length ? T('base.crafts.noCrew') : null), on: () => openEquip(c.id), data: { act: 'equip' } }));
        const crewWarn = unarmed ? el('div', { class: 'bsc-note bad bsc-crew-warn' }, el('span', { text: Tn('base.crafts.unarmed', unarmed) }),
          away ? null : btn(T('base.crafts.autoKit'), { cls: 'small', title: T('base.crafts.autoKit'), tip: T('base.crafts.autoKitTip'), data: { act: 'autoKit' }, on: () => autoKitNow(c) }),
          CUI && CUI.orderStarterKit ? btn(T('base.crafts.starterKit'), { cls: 'small', title: T('base.crafts.starterKit'), tip: T('base.crafts.starterKitTip'), data: { act: 'starterKit' }, on: () => CUI.orderStarterKit(g, b.id, unarmed).then(() => refresh()) }) : null) : null;
        const crew = el('div', { class: 'bsc-crew' });
        const sols = b.soldiers.map((id) => C().findSoldier(g, id)).filter(Boolean);
        sols.sort((x, y) => (x.craftId === c.id ? 0 : 1) - (y.craftId === c.id ? 0 : 1) || y.rank - x.rank);
        for (const s of sols) {
          const aboard = s.craftId === c.id;
          const other = s.craftId && !aboard ? C().findCraft(g, s.craftId) : null;
          let why = away;
          if (!why && other && !inHangar(other)) why = errText('away');
          if (!why && !aboard && s.woundDays > 0) why = errText('wounded');
          if (!why && !aboard && c.soldiers.length >= max) why = errText('seats');
          const noGun = aboard && CUI && CUI.armedLo && !CUI.armedLo(s.loadout);
          const row = el('button', { type: 'button', class: 'bsc-crewrow' + (aboard ? ' on' : '') + (why ? ' locked' : ''), dataset: { sol: s.id }, 'aria-pressed': aboard ? 'true' : 'false' },
            el('span', { class: 'bsc-check' }),
            el('span', { class: 'bsc-crew-rank', text: rankName(s.rank, true) }),
            el('span', { class: 'bsc-crew-name', text: s.name }),
            el('span', { class: 'bsc-crew-st ' + (s.woundDays > 0 || noGun ? 'bad' : other ? 'muted' : ''), text: s.woundDays > 0 ? Tn('base.sol.woundedDays', s.woundDays) : noGun ? T('base.crafts.noGun') : other ? craftName(other) : '' }));
          row.addEventListener('click', () => {
            if (why) { deny(why); return; }
            act(() => BS().assignSoldier(g, s.id, aboard ? null : c.id));
          });
          OV.Dom.tooltip(row, () => tipHtml(s.name, [esc(aboard ? T('base.crafts.crewOff') : T('base.crafts.crewOn')), why ? warnLine(why) : '']));
          crew.appendChild(row);
        }
        box.appendChild(section(T('base.crafts.crew') + ' · ' + T('base.crafts.seats', { n: c.soldiers.length, max }), crewHead, crewWarn, crew));
        // carga solta
        const loose = BS().loose(g, c.id) || {};
        const ids = Object.keys(loose);
        const lbox = el('div', { class: 'bsc-chips' });
        for (const id of ids) lbox.appendChild(el('span', { class: 'bsc-chip item' }, itemIcon(id, 18), el('span', { text: loose[id] + ' × ' + itemName(id) })));
        if (!ids.length) lbox.appendChild(el('span', { class: 'muted', text: T('base.crafts.noCargo') }));
        box.appendChild(section(T('base.crafts.cargo'), note(T('base.crafts.cargoHint'), 'muted'), lbox));
      }
      return box;
    }
    // «Embarcar todos os aptos»: os soldados aptos sem nave embarcam e quem vai sem arma leva o material do armazém
    function crewUpDlg(c) {
      const CUI = OV.CampaignUI;
      if (!CUI || !CUI.crewUp) return;
      const r = CUI.crewUp(S.G, c.id);
      sfx(r.boarded || r.equipped ? 'ui_confirm' : 'ui_deny');
      OV.Dom.toast(CUI.crewText(S.G, c.id, r) || T('base.crafts.boardNone'), null, r.unarmed ? 'warn' : 'good');
      refresh();
    }
    function autoKitNow(c) {
      const CUI = OV.CampaignUI;
      if (!CUI || !CUI.autoKit) return;
      const k = CUI.autoKit(S.G, c.id);
      sfx(k.equipped ? 'ui_confirm' : 'ui_deny');
      OV.Dom.toast(k.equipped ? Tn('cp.crew.equipped', k.equipped) + (k.unarmed ? ' ' + Tn('cp.crew.unarmed', k.unarmed) : '') : T('cp.br.autoKit.none'), null, k.unarmed ? 'warn' : 'good');
      refresh();
    }
    function weaponPicker(c, slot) {
      const g = S.G, b = base();
      const cur = c.weapons[slot] || null;
      const body = el('div', { class: 'bsc-picker' });
      const list = el('div', { class: 'bsc-list' });
      let any = false;
      for (const id of Object.keys(D().craftWeapons)) {
        const wd = D().craftWeapons[id];
        if (wd.mvp === false) continue;
        const have = b.stores[id] | 0;
        const isCur = cur && cur.type === id;
        if (!have && !isCur) continue;
        any = true;
        const ammo = wd.ammoItem ? T('base.crafts.ammoStock', { name: itemName(wd.ammoItem), n: b.stores[wd.ammoItem] | 0 }) : T('base.crafts.ammoUnlimited');
        list.appendChild(el('div', { class: 'bsc-row bsc-pick', dataset: { weapon: id } }, itemIcon(id, 40),
          el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: T(wd.nameKey) }),
            el('div', { class: 'bsc-row-sub', text: T('base.cw.specs', { dmg: wd.dmg, range: wd.range, acc: wd.acc }) + ' · ' + ammo }),
            el('div', { class: 'bsc-row-sub muted', text: T('base.cw.inStores', { n: have }) })),
          el('div', { class: 'bsc-row-btns' },
            btn(isCur ? T('base.cw.fitted') : T('base.crafts.fit'), {
              cls: 'small' + (isCur ? '' : ' primary'), title: T('base.crafts.fit'), why: isCur ? T('base.cw.already') : null, data: { pick: id },
              on: () => { s.close(); act(() => BS().fitWeapon(g, c.id, slot, id), T('base.toast.weaponFitted', { name: T(wd.nameKey), craft: craftName(c) })); },
            }))));
      }
      if (!any) body.appendChild(note(T('base.cw.noneInStores'), 'warn'));
      body.appendChild(list);
      body.appendChild(note(T('base.cw.rearmHint'), 'muted'));
      const s = sheet(T('base.cw.title', { n: slot + 1, craft: craftName(c) }), body, [
        { label: T('base.crafts.buyWeapons'), on: () => { s.close(); S.market = 'buy'; setTab('market'); } },
        { label: T('common.close') },
      ]);
    }
    async function sellCraftDlg(c) {
      const g = S.G, def = D().crafts[c.type];
      const why = BS().canSellCraft(g, c.id);
      if (why) { deny(errText(why)); return; }
      const name = craftName(c);
      const rentDue = BS().craftRentDue ? BS().craftRentDue(g, c.id) | 0 : 0;
      const ok = await OV.Dom.modal({
        title: T('base.crafts.sell'), cls: 'alert',
        body: el('div', { class: 'bsc-confirm' }, craftIcon(c.type, 64),
          el('div', null, el('p', { class: 'modal-text', text: T('base.crafts.sellConfirm', { craft: name, price: money(def.sell) }) }),
            el('p', { class: 'bsc-note muted', text: T(def.rent > 0 ? 'base.crafts.sellNote.rent' : 'base.crafts.sellNote', { rent: money(def.rent) }) }),
            // aluguer proporcional já corrido este mês: fica em base.rentDue e é cobrado no fecho do mês
            rentDue > 0 ? el('p', { class: 'bsc-note warn', text: T('base.crafts.sellRentDue', { rent: money(rentDue) }) }) : null)),
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('base.crafts.sellGo', { price: money(def.sell) }), value: true, kind: 'danger' }],
      });
      if (!ok || !S.root) return;
      if (act(() => BS().sellCraft(g, c.id), T('base.toast.craftSold', { craft: name, money: money(def.sell) }))) {
        S.craftSel = null;
        refresh();
      }
    }
    function renameCraftDlg(c) {
      const inp = el('input', { type: 'text', class: 'bsc-input', maxlength: '24', value: craftName(c), 'aria-label': T('base.crafts.rename') });
      const doIt = () => { act(() => BS().renameCraft(S.G, c.id, inp.value)); s.close(); };
      const s = sheet(T('base.crafts.rename'), el('div', { class: 'bsc-rename-box' }, inp), [{ label: T('common.cancel') }, { label: T('base.rename.ok'), kind: 'primary', on: doIt }]);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doIt(); } });
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    // ---- «Equipar» (OV.InventoryUI.equipScreen sobre Campaign.equipPool / applyEquip) ---------------------------
    function openEquip(craftId) {
      const g = S.G;
      const c = C().findCraft(g, craftId);
      if (!c || !OV.InventoryUI || !OV.InventoryUI.equipScreen) return;
      if (!inHangar(c)) { deny(errText('away')); return; }
      if (!c.soldiers.length) { deny(T('base.crafts.noCrew')); return; }
      closeEquip(true);
      const bodyBox = el('div', { class: 'bsc-equip-body' });
      const done = btn(T('base.equip.done'), { cls: 'primary', title: T('base.equip.done'), tip: T('base.equip.doneTip'), key: 'Esc', on: () => closeEquip(), data: { act: 'equipDone' } });
      const ov = el('div', { class: 'bsc-equip', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'bsc-equip-panel' },
          el('div', { class: 'bsc-equip-head' },
            el('div', null, el('div', { class: 'bsc-kicker', text: T('base.equip.kicker') }), el('h2', { class: 'bsc-h', text: craftName(c) })),
            el('div', { class: 'bsc-equip-note muted', text: TT('base.equip.hint') }), done),
          bodyBox));
      S.root.appendChild(ov);
      // o ecrã «Equipar» prende o foco: as linhas da tripulação por trás ficam inertes até fechar
      const release = OV.Dom.trapFocus(ov);
      // cada alteração é aplicada logo (Campaign.applyEquip recusa o que criaria ou destruiria itens)
      const build = () => {
        OV.Dom.clear(bodyBox);
        const pool = C().equipPool(g, craftId);
        let ctl = null;
        ctl = OV.InventoryUI.equipScreen(bodyBox, {
          squad: pool.squad, stores: pool.stores, researched: g.researched,
          onChange: (state) => {
            const r = C().applyEquip(g, craftId, state);
            if (!r || !r.ok) {
              deny(errText((r && r.reason) || 'mismatch'));
              if (S.equip) {
                try { ctl.destroy(); } catch (e) { /* já removido */ }
                S.equip.ctl = build();
              }
              return;
            }
            if (S.equip) S.equip.changed = true;
          },
        });
        return ctl;
      };
      S.equip = { craftId, ov, ctl: null, changed: false, release };
      S.equip.ctl = build();
      sfx('ui_select');
      setTimeout(() => { if (S.equip && S.equip.ov === ov && !ov.contains(document.activeElement)) { const f = OV.Dom.focusables(ov)[0]; if (f) f.focus({ preventScroll: true }); } }, 0);
    }
    function closeEquip(silent) {
      const E = S.equip;
      if (!E) return;
      S.equip = null;
      try { if (E.ctl) E.ctl.destroy(); } catch (e) { /* já removido */ }
      E.ov.remove();
      if (E.release) E.release(!silent);
      OV.Dom.hideTooltip();
      if (!silent) {
        sfx('ui_click');
        if (E.changed) OV.Dom.toast(T('base.toast.equipSaved', { craft: craftName(C().findCraft(S.G, E.craftId)) }), null, 'good');
        refresh();
        // aberto pela tecla E o foco estava no <body>: volta ao botão «Equipar»
        const a = document.activeElement;
        if (!a || a === document.body || !a.isConnected) OV.Dom.refocus('[data-act="equip"]', S.root);
      }
    }

    // ---------------------------------------------------------------------------------------------------- 7
    function sortVal(s, key) {
      switch (key) {
        case 'rank': return s.rank;
        case 'name': return s.name;
        case 'missions': return s.missions;
        case 'kills': return s.kills;
        case 'wound': return s.woundDays;
        case 'craft': return s.craftId ? craftName(C().findCraft(S.G, s.craftId)) : '';
        default: return s.stats[key] | 0;
      }
    }
    function tabSoldiers() {
      const g = S.G, b = base();
      const wrap = el('div', { class: 'bsc-tab-sol' + (S.memorial ? ' memorial' : '') });
      const sols = b.soldiers.map((id) => C().findSoldier(g, id)).filter(Boolean);
      const wounded = sols.filter((s) => s.woundDays > 0).length;
      wrap.appendChild(head(S.memorial ? T('base.mem.title') : T('base.tab.soldiers'),
        S.memorial ? Tn('base.mem.sub', g.dead.length) : Tn('base.sol.n', sols.length) + ' · ' + Tn('base.pers.wounded', wounded),
        btn(S.memorial ? T('base.sol.backToList') : T('base.mem.btn') + (g.dead.length ? ' (' + g.dead.length + ')' : ''), { cls: 'small' + (S.memorial ? ' on' : ''), title: T('base.mem.btn'), tip: T('base.mem.tip'), key: 'M', on: () => { S.memorial = !S.memorial; sfx('ui_select'); renderContent(); }, data: { act: 'memorial' } }),
        S.memorial ? null : btn(T('base.sol.hire'), { cls: 'small', title: T('base.sol.hire'), tip: T('base.sol.hireTip'), key: '4', on: () => setTab('personnel') })));
      if (S.memorial) { wrap.appendChild(memorial()); return wrap; }
      if (!sols.length) { wrap.appendChild(note(T('base.sol.none'), 'muted')); return wrap; }
      const k = S.sort.key, dir = S.sort.dir;
      sols.sort((x, y) => {
        const a = sortVal(x, k), c = sortVal(y, k);
        const r = typeof a === 'string' ? a.localeCompare(c, 'pt') : a - c;
        return r * dir || x.name.localeCompare(y.name, 'pt');
      });
      if (!S.solSel || !sols.some((s) => s.id === S.solSel)) S.solSel = sols[0].id;
      const thead = el('tr');
      for (const col of COLS) {
        const on = col === k;
        const th = el('th', { class: 'c-' + col + (on ? ' on' : ''), scope: 'col', 'aria-sort': on ? (dir > 0 ? 'ascending' : 'descending') : 'none', tabindex: '0', dataset: { col } },
          T('base.sol.col.' + col), on ? el('i', { class: 'bsc-sort', text: dir > 0 ? '▲' : '▼' }) : null);
        const go = () => {
          if (S.sort.key === col) S.sort.dir = -S.sort.dir;
          else S.sort = { key: col, dir: col === 'name' || col === 'craft' ? 1 : -1 };
          sfx('ui_click');
          renderContent();
        };
        th.addEventListener('click', go);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        OV.Dom.tooltip(th, () => tipHtml(T('base.sol.colTip.' + col), [esc(T('base.sol.sortTip'))]));
        thead.appendChild(th);
      }
      const tbody = el('tbody');
      for (const s of sols) {
        const c = s.craftId ? C().findCraft(g, s.craftId) : null;
        // lista com foco itinerante: a linha escolhida é a paragem do Tab; ↑/↓ escolhem, Enter vai para a ficha
        const on = s.id === S.solSel;
        const tr = el('tr', { class: 'click' + (on ? ' sel' : '') + (s.woundDays > 0 ? ' wounded' : ''), dataset: { sol: s.id }, tabindex: on ? '0' : '-1', 'aria-selected': on ? 'true' : 'false' },
          el('td', { class: 'c-rank' }, el('span', { class: 'bsc-rank r' + s.rank, text: rankName(s.rank, true) })),
          el('td', { class: 'c-name', text: s.name }),
          el('td', { class: 'c-missions mono', text: String(s.missions) }),
          el('td', { class: 'c-kills mono', text: String(s.kills) }),
          ...['tu', 'hp', 'fire', 'react', 'brav'].map((st) => el('td', { class: 'c-' + st + ' mono' + (s.stats[st] > s.initial[st] ? ' up' : ''), text: String(s.stats[st]) })),
          el('td', { class: 'c-wound mono' + (s.woundDays > 0 ? ' bad' : ' muted'), text: s.woundDays > 0 ? String(s.woundDays) : '—' }),
          el('td', { class: 'c-craft', text: c ? craftName(c) : '—' }));
        tr.addEventListener('click', () => { S.solSel = s.id; S.focusSol = true; S.revealSol = true; sfx('ui_select'); renderContent(); });
        tbody.appendChild(tr);
      }
      S.solOrder = sols.map((x) => x.id);
      const table = el('table', { class: 'tbl bsc-soltbl', 'aria-label': T('base.tab.soldiers') }, el('thead', null, thead), tbody);
      wrap.appendChild(el('div', { class: 'bsc-tblwrap' }, table));
      wrap.appendChild(soldierDetail(C().findSoldier(g, S.solSel)));
      return wrap;
    }
    function soldierDetail(s) {
      const g = S.G, b = base();
      const caps = D().soldierGen ? D().soldierGen.caps : {};
      const c = s.craftId ? C().findCraft(g, s.craftId) : null;
      const away = c && !inHangar(c) ? errText('away') : null;
      const box = el('div', { class: 'bsc-card bsc-sol-detail', dataset: { sol: s.id } });
      const nameInp = el('input', { type: 'text', class: 'bsc-input bsc-sol-name', maxlength: '24', value: s.name, 'aria-label': T('base.sol.rename') });
      const doRename = () => {
        if (nameInp.value.trim() === s.name) return;
        act(() => OV.Soldiers.rename(g, s.id, nameInp.value), T('base.toast.renamed', { name: nameInp.value.trim() }));
      };
      nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } });
      const nat = s.nat && OV.T.has('nat.' + s.nat) ? T('nat.' + s.nat) : '';
      box.appendChild(el('div', { class: 'bsc-sd-head' }, portrait(s, 72),
        el('div', { class: 'bsc-sd-t' },
          el('div', { class: 'bsc-sd-name' }, nameInp, btn(T('base.sol.renameBtn'), { cls: 'small', title: T('base.sol.rename'), tip: T('base.sol.renameTip'), on: doRename })),
          el('div', { class: 'bsc-row-sub', text: [rankName(s.rank), nat, Tn('base.sol.missionsN', s.missions), Tn('base.sol.killsN', s.kills)].filter(Boolean).join(' · ') }),
          s.woundDays > 0 ? el('span', { class: 'bsc-chip bad', text: Tn('base.sol.woundedDays', s.woundDays) }) : el('span', { class: 'bsc-chip good', text: T('base.sol.fit') }))));
      // atributos: inicial vs atual
      const stats = el('div', { class: 'bsc-stats' });
      for (const k of STATS) {
        const cap = caps[k] || 100;
        const cur = s.stats[k] | 0, ini = (s.initial && s.initial[k]) | 0;
        const gain = cur - ini;
        stats.appendChild(el('div', { class: 'bsc-stat', dataset: { stat: k } },
          el('span', { class: 'bsc-stat-k', text: T('stat.' + k) }),
          el('div', { class: 'bsc-stat-bar' },
            el('i', { class: 'ini', style: { width: (Math.min(ini, cur) / cap * 100).toFixed(1) + '%' } }),
            gain > 0 ? el('i', { class: 'gain', style: { left: (ini / cap * 100).toFixed(1) + '%', width: (gain / cap * 100).toFixed(1) + '%' } }) : null),
          el('b', { class: 'mono', text: String(cur) }),
          el('small', { class: gain > 0 ? 'good' : 'muted', text: gain > 0 ? '+' + gain : '' })));
      }
      box.appendChild(section(T('base.sol.stats'), note(T('base.sol.statsHint'), 'muted'), stats));
      // armadura
      const arm = el('div', { class: 'bsc-seg' });
      for (const id of Object.keys(D().armours)) {
        const a = D().armours[id];
        if (a.research && !researched(g, a.research)) continue;
        const isCur = s.armour === id;
        const stock = a.storeItem ? b.stores[a.storeItem] | 0 : null;
        const why = isCur ? null : away || (stock !== null && stock < 1 ? errText('stock') : null);
        arm.appendChild(btn(T(a.nameKey) + (stock !== null ? ' (' + stock + ')' : ''), {
          cls: 'small seg' + (isCur ? ' on' : ''), title: T(a.nameKey), tip: T('base.sol.armourTip', { f: a.front, s: a.side, r: a.rear }), why, data: { armour: id },
          on: () => { if (!isCur) act(() => BS().setArmour(g, s.id, id), T('base.toast.armour', { name: s.name, armour: T(a.nameKey) })); },
        }));
      }
      box.appendChild(section(T('base.sol.armour'), arm));
      // nave
      const seat = el('div', { class: 'bsc-seg' });
      const transports = b.crafts.map((id) => C().findCraft(g, id)).filter((x) => x && D().crafts[x.type].seatsUI > 0);
      seat.appendChild(btn(T('base.sol.noCraft'), { cls: 'small seg' + (!s.craftId ? ' on' : ''), title: T('base.sol.noCraft'), why: !s.craftId ? null : away, on: () => { if (s.craftId) act(() => BS().assignSoldier(g, s.id, null)); } }));
      for (const t of transports) {
        const on = s.craftId === t.id;
        const max = D().crafts[t.type].seatsUI;
        let why = null;
        if (!on) why = away || (!inHangar(t) ? errText('away') : s.woundDays > 0 ? errText('wounded') : t.soldiers.length >= max ? errText('seats') : null);
        seat.appendChild(btn(craftName(t) + ' ' + t.soldiers.length + '/' + max, { cls: 'small seg' + (on ? ' on' : ''), title: craftName(t), tip: T('base.sol.seatTip'), why, data: { seat: t.id }, on: () => { if (!on) act(() => BS().assignSoldier(g, s.id, t.id)); } }));
      }
      box.appendChild(section(T('base.sol.craft'), seat));
      box.appendChild(el('div', { class: 'bsc-card-act' },
        btn(T('base.sol.sack'), { cls: 'small danger', title: T('base.sol.sack'), tip: T('base.sol.sackTip'), why: away, on: () => sackSoldierDlg(s) })));
      return box;
    }
    async function sackSoldierDlg(s) {
      const ok = await OV.Dom.modal({ title: T('base.sol.sack'), cls: 'alert', body: T('base.sol.sackConfirm', { name: esc(s.name) }), buttons: [{ label: T('common.no'), value: false }, { label: T('base.sol.sack'), value: true, kind: 'danger' }] });
      if (ok && S.root && act(() => BS().sack(S.G, base().id, 'soldier', s.id), T('base.toast.sackedSoldier', { name: s.name }))) {
        S.solSel = null;
        refresh();
      }
    }
    function memorial() {
      const g = S.G;
      if (!g.dead.length) return note(T('base.mem.none'), 'muted');
      const tbody = el('tbody');
      for (const d of g.dead.slice().reverse()) {
        tbody.appendChild(el('tr', null,
          el('td', null, el('span', { class: 'bsc-rank r' + d.rank, text: rankName(d.rank, true) })),
          el('td', { text: d.name }),
          el('td', { class: 'mono', text: String(d.missions) }),
          el('td', { class: 'mono', text: String(d.kills) }),
          el('td', { class: 'mono', text: OV.U.fmtDate(d.diedT, false) }),
          el('td', { text: T(gk('base.mem.cause.' + (d.cause || 'kia'), d)) })));
      }
      return el('div', { class: 'bsc-tblwrap' }, el('table', { class: 'tbl bsc-memtbl' },
        el('thead', null, el('tr', null, ...['rank', 'name', 'missions', 'kills', 'date', 'cause'].map((k) => el('th', { text: T('base.mem.col.' + k) })))),
        tbody));
    }

    // ---------------------------------------------------------------------------------------------------- 8
    /* comprar/vender: o 2.º clique de um duplo clique (event.detail ≥ 2) ou um clique a menos de 400 ms do anterior
       não repete a encomenda (o botão é recriado depois de cada compra) */
    function qtyCtl(map, id, max, onChange, tag) {
      const v = Math.max(1, Math.min(max || 999, map[id] || 1));
      map[id] = v;
      const set = (n) => { map[id] = Math.max(1, Math.min(max || 999, n)); sfx('ui_click'); onChange(); };
      const nm = itemName(id);
      const k = (tag || 'q') + ':' + id;
      return el('div', { class: 'bsc-stepper qty' },
        btn('−', { cls: 'small', title: T('base.market.less'), aria: T('base.market.lessOf', { name: nm }), key: '←', noTab: true, why: v <= 1 ? T('base.market.minQty') : null, data: { qty: k + ':-1' }, on: () => set(v - 1) }),
        el('b', { class: 'bsc-step-v', text: String(v) }),
        btn('+', { cls: 'small', title: T('base.market.more'), aria: T('base.market.moreOf', { name: nm }), key: '→', noTab: true, why: max && v >= max ? T('base.market.maxQty') : null, data: { qty: k + ':+1' }, on: () => set(v + 1) }),
        btn('+10', { cls: 'small', title: T('base.market.more10'), aria: T('base.market.more10Of', { name: nm }), key: '⇧→', noTab: true, why: max && v >= max ? T('base.market.maxQty') : null, data: { qty: k + ':+10' }, on: () => set(nextTen(v)) }));
    }
    // vender: o último exemplar de que a investigação precisa pede confirmação (Cancelar é o botão por omissão)
    async function sellNow(id, n) {
      const g = S.G, b = base();
      const it = D().items[id] || {};
      const lost = lostTopics(g, b, id, n);
      if (lost.length) {
        const ret = document.activeElement;
        const ok = await OV.Dom.modal({
          title: T('base.market.sellLast.title'), cls: 'alert',
          body: el('div', { class: 'bsc-confirm' }, itemIcon(id, 48), el('p', { class: 'modal-text', text: Tn('base.market.sellLast.body', lost.length, { n, name: itemName(id), topics: lost.map(topicName).join(', ') }) })),
          buttons: [{ label: T('base.market.sellLast.keep'), value: false, kind: 'primary' }, { label: T('base.market.sellLast.ok', { n }), value: true, kind: 'danger' }],
        });
        if (!S.root || base() !== b) return;
        if (!ok) { if (ret && ret.isConnected) ret.focus({ preventScroll: true }); return; }
      }
      S.sellQty[id] = 1;
      act(() => BS().sell(g, b.id, id, n), T('base.toast.sold', { n, name: itemName(id), money: money(it.sell * n) }));
    }
    // Mercado ao teclado: ↑/↓ PgUp/PgDn mudam de linha; ←/→ quantidade (⇧ ±10), Início/Fim mínimo/máximo; Enter compra/vende
    function marketKey(k, m) {
      const a = document.activeElement;
      if (!a || !a.closest || !S.r.content.contains(a)) return false;
      const row = a.closest('.bsc-mrow[data-buy], .bsc-mrow[data-sell]');
      if (!row) return false;
      const buy = !!row.dataset.buy, id = buy ? row.dataset.buy : row.dataset.sell;
      const actSel = '[data-act="' + (buy ? 'buy' : 'sell') + '"]';
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown') {
        const rows = [...S.r.content.querySelectorAll(buy ? '.bsc-mrow[data-buy]' : '.bsc-mrow[data-sell]')].filter((r) => r.querySelector(actSel));
        const i = rows.indexOf(row);
        const d = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : k === 'PageUp' ? -6 : 6;
        const j = Math.max(0, Math.min(rows.length - 1, i + d));
        if (j !== i) {
          const nb = rows[j].querySelector(actSel);
          nb.focus({ preventScroll: true });
          rows[j].scrollIntoView({ block: 'nearest' });
          sfx('ui_click');
        }
        return true;
      }
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return false;
      const g = S.G, b = base();
      const map = buy ? S.qty : S.sellQty;
      const isCraft = buy && !!D().crafts[id];
      const price = isCraft ? D().crafts[id].buy : (D().items[id] || {}).buy || 0;
      const max = buy ? (isCraft ? 3 : Math.max(1, Math.min(999, price > 0 ? Math.floor(g.funds / price) : 999))) : Math.max(1, b.stores[id] | 0);
      const v = Math.max(1, Math.min(buy ? (isCraft ? 3 : 999) : max, map[id] || 1));
      const step = m && m.shift ? 10 : 1;
      let nv = k === 'Home' ? 1 : k === 'End' ? max : v + (k === 'ArrowRight' ? step : -step);
      nv = Math.max(1, Math.min(buy ? (isCraft ? 3 : 999) : max, nv));
      if (nv === v) { sfx('ui_deny'); return true; }
      map[id] = nv;
      sfx('ui_click');
      renderContent();
      return true;
    }
    function tabMarket() {
      const g = S.G, b = base();
      const caps = BS().capacities(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-market' });
      const seg = el('div', { class: 'bsc-seg' },
        btn(T('base.market.buy'), { cls: 'small seg' + (S.market === 'buy' ? ' on' : ''), title: T('base.market.buy'), tip: T('base.market.buyTip'), pressed: S.market === 'buy', data: { mode: 'buy' }, on: () => { S.market = 'buy'; sfx('ui_select'); renderContent(); } }),
        btn(T('base.market.sell'), { cls: 'small seg' + (S.market === 'sell' ? ' on' : ''), title: T('base.market.sell'), tip: T('base.market.sellTip'), pressed: S.market === 'sell', data: { mode: 'sell' }, on: () => { S.market = 'sell'; sfx('ui_select'); renderContent(); } }));
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', T('base.tab.market'));
      wrap.appendChild(head(T('base.tab.market'), T('base.market.sub', { money: money(g.funds) }), seg));
      wrap.appendChild(el('div', { class: 'bsc-meters2' },
        meter(T('base.cap.storage'), caps.storage.used, caps.storage.cap, { fmt: dec1 }),
        meter(T('base.cap.crafts'), caps.crafts.used, caps.crafts.cap)));
      // teclado: uma paragem do Tab por linha (o botão Comprar/Vender); setas mudam de linha e de quantidade
      wrap.appendChild(note(T('base.market.kbdHint.' + S.market), 'muted bsc-kbd-hint'));
      if (S.market === 'buy') wrap.append(marketBuy(), deliveriesSection((d) => d.kind === 'item' || d.kind === 'craft'));
      else wrap.appendChild(marketSell());
      return wrap;
    }
    function marketBuy() {
      const g = S.G, b = base();
      const box = el('div');
      // armazém sobrelotado: a saída (vender ou construir armazéns) fica à vista, não só na dica do botão
      const caps = BS().capacities(g, b.id);
      if (caps.storage.usedTenths > caps.storage.cap * 10) box.appendChild(note(T('base.market.storageFull'), 'bad'));
      const groups = {};
      for (const id of Object.keys(D().crafts)) {
        const cd = D().crafts[id];
        if (cd.buy > 0 && researched(g, cd.requires)) (groups.craft = groups.craft || []).push(id);
      }
      for (const id of Object.keys(D().items)) {
        const it = D().items[id];
        if (!(it.buy > 0) || it.mvp === false || !researched(g, it.research)) continue;
        (groups[catOf(id)] = groups[catOf(id)] || []).push(id);
      }
      for (const [cat] of CATS) {
        if (!groups[cat]) continue;
        const list = el('div', { class: 'bsc-list' });
        for (const id of groups[cat]) {
          const isCraft = cat === 'craft';
          const def = isCraft ? D().crafts[id] : D().items[id];
          const n = S.qty[id] || 1;
          const why = BS().canBuy(g, b.id, id, n);
          const space = isCraft ? 0 : def.storage || 0.1;
          const eta = isCraft ? def.deliveryH | 0 : def.deliveryH > 0 ? def.deliveryH : tune('DELIVERY_ITEMS_H', 24);
          const have = isCraft ? b.crafts.map((x) => C().findCraft(g, x)).filter((x) => x && x.type === id).length : b.stores[id] | 0;
          list.appendChild(el('div', { class: 'bsc-row bsc-mrow', dataset: { buy: id } },
            isCraft ? craftIcon(id, 40) : itemIcon(id, 40),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: itemName(id) }),
              el('div', { class: 'bsc-row-sub', text: T('base.market.priceLine', { price: money(def.buy), h: eta, have }) + (isCraft ? ' · ' + T('base.market.rent', { money: money(def.rent) }) : ' · ' + T('base.market.space', { u: dec1(space) })) }),
              // munição de nave em caixas: o rearme abre sempre uma caixa inteira
              !isCraft && def.kind === 'craft_ammo' && def.rounds > 1 ? el('div', { class: 'bsc-row-sub', text: T('base.market.clip', { n: def.rounds }) }) : null,
              why === 'storage' || why === 'hangar' ? el('div', { class: 'bsc-row-why', text: errText(why) }) : null),
            qtyCtl(S.qty, id, isCraft ? 3 : 0, renderContent, 'buy'),
            el('div', { class: 'bsc-mtotal mono' + (g.funds < def.buy * n ? ' bad' : ''), text: money(def.buy * n) }),
            btn(T('base.market.buy'), {
              cls: 'small primary', title: T('base.market.buyN', { n, name: itemName(id) }), tip: T('base.market.buyEta', { h: eta }) + ' ' + T('base.market.rowKeys'), why: why ? errText(why) : null, data: { act: 'buy', id },
              on: (e) => {
                if (!oneShot(e)) return;
                S.qty[id] = 1;
                if (!act(() => BS().buy(g, b.id, id, n), T('base.toast.bought', { n, name: itemName(id), h: eta }))) { S.qty[id] = n; renderContent(); }
              },
            })));
        }
        box.appendChild(section(T('base.cat.' + cat), list));
      }
      return box;
    }
    function marketSell() {
      const g = S.G, b = base();
      const box = el('div');
      const ids = Object.keys(b.stores).filter((id) => b.stores[id] > 0);
      if (!ids.length) box.appendChild(note(T('base.stores.empty'), 'muted'));
      const by = {};
      for (const id of ids) (by[catOf(id)] = by[catOf(id)] || []).push(id);
      for (const [cat] of CATS) {
        if (!by[cat]) continue;
        const list = el('div', { class: 'bsc-list' });
        for (const id of by[cat].sort((x, y) => itemName(x).localeCompare(itemName(y), 'pt'))) {
          const it = D().items[id] || {};
          const have = b.stores[id];
          const n = Math.min(have, S.sellQty[id] || 1);
          const why = !(it.sell > 0) ? errText('unsellable') : null;
          // tópicos que deixam de se poder investigar se se vender tudo (cadáver, arma alienígena…)
          const need = why ? [] : lostTopics(g, b, id, have);
          list.appendChild(el('div', { class: 'bsc-row bsc-mrow' + (why ? ' locked' : '') + (need.length ? ' need' : ''), dataset: { sell: id } }, itemIcon(id, 36),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: itemName(id) }),
              el('div', { class: 'bsc-row-sub', text: why ? why : T('base.market.sellLine', { price: money(it.sell), have }) + ' · ' + T('base.market.frees', { u: dec1((it.storage || 0.1) * n) }) }),
              need.length ? el('div', { class: 'bsc-row-need', text: Tn('base.market.needFor', need.length, { topics: need.map(topicName).join(', ') }) }) : null),
            why ? el('span') : qtyCtl(S.sellQty, id, have, renderContent, 'sell'),
            el('div', { class: 'bsc-mtotal mono good', text: why ? '' : money(it.sell * n) }),
            el('div', { class: 'bsc-row-btns' },
              why ? null : btn(T('base.market.all'), { cls: 'small', title: T('base.market.allTip'), aria: T('base.market.allOf', { name: itemName(id) }), key: 'Fim', noTab: true, data: { sellAll: id }, on: () => { S.sellQty[id] = have; renderContent(); } }),
              btn(T('base.market.sell'), {
                cls: 'small', title: T('base.market.sellN', { n, name: itemName(id) }), tip: T('base.market.sellNow') + ' ' + T('base.market.rowKeys'), why, data: { act: 'sell', id },
                on: (e) => { if (!oneShot(e)) return; sellNow(id, n); },
              }))));
        }
        box.appendChild(section(T('base.cat.' + cat), list));
      }
      const aliens = Object.keys(b.aliens).filter((u) => b.aliens[u] > 0);
      if (aliens.length) {
        const list = el('div', { class: 'bsc-list' });
        for (const u of aliens) {
          list.appendChild(el('div', { class: 'bsc-row bsc-mrow locked' }, alienIcon(u, 36),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: unitName(u) + ' ×' + b.aliens[u] }), el('div', { class: 'bsc-row-sub', text: T('base.market.noSellLive') })),
            el('span'), el('span'),
            btn(T('base.market.sell'), { cls: 'small', title: T('base.market.sell'), why: errText('unsellable') })));
        }
        box.appendChild(section(T('base.cat.live'), list));
      }
      return box;
    }

    // ---------------------------------------------------------------------------------------------------- 9
    function tabContainment() {
      const g = S.G, b = base();
      const caps = BS().capacities(g, b.id);
      const wrap = el('div', { class: 'bsc-tab-cont' });
      const units = Object.keys(b.aliens).filter((u) => b.aliens[u] > 0);
      wrap.appendChild(head(T('base.containment.title'), T('base.cont.sub', { n: caps.aliens.used, cap: caps.aliens.cap })));
      wrap.appendChild(el('div', { class: 'bsc-meters2' }, meter(T('base.cap.aliens'), caps.aliens.used, caps.aliens.cap, { tip: () => tipHtml(T('base.cap.aliens'), [esc(T('base.captip.aliens'))]) })));
      if (caps.aliens.cap <= 0) wrap.appendChild(note(T('base.cont.build'), 'warn'));
      for (const h of storyHints(g)) wrap.appendChild(note(h, 'story'));
      const running = b.research.filter((p) => /^interrogate_/.test(p.topic));
      if (running.length) {
        const rl = el('div', { class: 'bsc-list' });
        for (const p of running) {
          const t = D().researchTopic(p.topic);
          const lbl = BS().researchLabel(g, b.id, p.topic);
          rl.appendChild(el('div', { class: 'bsc-row', dataset: { topic: p.topic } }, alienIcon(t ? t.unit : '', 40),
            el('div', { class: 'bsc-row-main' }, el('div', { class: 'bsc-row-name', text: topicName(p.topic) }),
              el('div', { class: 'bsc-row-sub', text: Tn('base.cont.runningSci', p.scientists) })),
            el('span', { class: 'bsc-chip prog ' + (PROG_CLS[lbl] || ''), text: T(lbl) })));
        }
        wrap.appendChild(section(T('base.cont.runningTitle'), rl));
      }
      if (!units.length) { wrap.appendChild(note(T('base.containment.empty'), 'muted')); return wrap; }
      const avail = C().availableResearch(g, b.id);
      const st = BS().staff(g, b.id);
      const list = el('div', { class: 'bsc-cards' });
      for (const u of units) {
        const topic = D().interrogationId(u);
        const running = g.bases.some((x) => x.research.some((p) => p.topic === topic));
        const can = avail.indexOf(topic) >= 0;
        const done = researched(g, topic);
        const rr = D().unitRankRace(u);
        let status, btnNode = null;
        if (running) status = el('span', { class: 'bsc-chip good', text: T('base.cont.running') });
        else if (can) {
          status = el('span', { class: 'bsc-chip warn', text: done ? T('base.cont.newInfo') : T('base.cont.ready') });
          const caps2 = BS().capacities(g, b.id);
          const give = Math.max(0, Math.min(st.scientists.free, caps2.labs.cap - caps2.labs.used));
          btnNode = btn(T('base.cont.interrogate'), {
            cls: 'small primary', title: T('base.cont.interrogate'), tip: T('base.cont.interrogateTip', { who: Tn('base.nSci', give) }), why: caps2.labs.cap <= 0 ? errText('labs') : null, data: { interrogate: u }, once: true,
            on: () => act(() => BS().startResearch(g, b.id, topic, give), T('base.toast.researchStarted', { name: topicName(topic), who: Tn('base.nSci', give) })),
          });
        } else status = el('span', { class: 'bsc-chip muted', text: done ? T('base.cont.nothingNew') : T('base.cont.unavailable') });
        const art = articleFor(g, [rr ? 'race_' + rr.race : null]);
        list.appendChild(el('div', { class: 'bsc-card bsc-alien', dataset: { unit: u } },
          el('div', { class: 'bsc-card-h' }, alienIcon(u, 64),
            el('div', { class: 'bsc-card-t' },
              el('div', { class: 'bsc-row-name', text: unitName(u) + (b.aliens[u] > 1 ? ' ×' + b.aliens[u] : '') }),
              el('div', { class: 'bsc-row-sub', text: rr ? T('base.cont.rankRace', { rank: T('arank.' + rr.rank), race: OV.T.has('race.' + rr.race) ? T('race.' + rr.race) : rr.race }) : '' }),
              el('div', { class: 'bsc-row-sub muted', text: T('base.cont.hint.' + (rr ? rr.rank : 'soldier')) })),
            status),
          el('div', { class: 'bsc-card-act' },
            art ? btn(T('base.btn.ufopaedia'), { cls: 'small ghost', title: T('base.tip.article'), aria: T('base.tip.articleFor', { name: articleTitle(art) }), on: () => openUfopaedia(art) }) : null,
            btnNode)));
      }
      wrap.appendChild(list);
      return wrap;
    }

    // ---- folha modal genérica (listas de escolha) -----------------------------------------------------------
    /* returnTo: para onde volta o foco ao fechar quando a folha abriu sem foco ou a partir de fora do conteúdo (tecla N
       com o foco num separador, que se redesenha: o foco iria para o <body>) */
    function sheet(title, body, buttons, cls, returnTo) {
      if (S.sheet) S.sheet.close();
      const host = OV.Dom.$('modals');
      const box = el('div', { class: 'modal wide bsc-sheet ' + (cls || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
      const back = el('div', { class: 'modal-back' }, box);
      let closed = false, release = null;
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        OV.Dom.hideTooltip();
        back.remove();
        if (release) release();
        if (S.sheet === api) S.sheet = null;
      };
      const onKey = (e) => {
        if (back.nextElementSibling) return; // um modal de confirmação por cima trata as teclas
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { sfx('ui_click'); close(); } }
      };
      const acts = el('div', { class: 'modal-actions' });
      for (const bt of buttons || []) {
        const n = el('button', { type: 'button', class: 'btn ' + (bt.kind || '') }, bt.label);
        n.addEventListener('click', () => { if (bt.on) bt.on(); else { sfx('ui_click'); close(); } });
        acts.appendChild(n);
      }
      box.append(el('h2', { class: 'modal-title', text: title }), el('div', { class: 'bsc-sheet-body scroll', 'data-scroll': '' }, body), acts);
      back.addEventListener('click', (e) => { if (e.target === back) close(); });
      host.appendChild(back);
      // foco preso na folha (o resto inerte) e devolvido a quem a abriu
      const cur = document.activeElement;
      release = OV.Dom.trapFocus(back, returnTo && (!cur || cur === document.body || !S.r.content.contains(cur)) ? { returnTo } : undefined);
      document.addEventListener('keydown', onKey, true);
      const api = { close, box };
      S.sheet = api;
      sfx('ui_select');
      const first = box.querySelector('.btn.primary:not(.disabled)') || box.querySelector('.btn');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 0);
      return api;
    }

    // ---- navegação ------------------------------------------------------------------------------------------
    function openUfopaedia(id) {
      if (!OV.Ufopaedia || !OV.Ufopaedia.open) return;
      sfx('ui_click');
      OV.Ufopaedia.open(S.G, id || undefined);
    }
    function back() {
      sfx('ui_click');
      if (OV.Scenes.top() !== sc) return;
      if (OV.Scenes.stack.length > 1) OV.Scenes.pop();
      else if (OV.GeoUI && OV.GeoUI.open && S.G) OV.GeoUI.open(S.G);
      else OV.Scenes.set('menu');
    }

    // ---- canvas ---------------------------------------------------------------------------------------------
    function layoutView() {
      const r = S.r.gridhost.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return null;
      const L = OV.BaseRender.layout(r.width, r.height, { pad: 20, minCell: 28, maxCell: 118 });
      return { x: Math.round(r.left + L.x), y: Math.round(r.top + L.y), cell: L.cell, host: r };
    }
    // fundo: planta técnica escura com grelha fina e coordenadas A–F / 1–6 à volta da base
    function backdrop(g, view, L) {
      const key = view.w + 'x' + view.h + '@' + view.dpr + '|' + (L ? L.x + ',' + L.y + ',' + L.cell : '');
      if (S.bgKey !== key) {
        const c = document.createElement('canvas');
        c.width = Math.round(view.w * view.dpr);
        c.height = Math.round(view.h * view.dpr);
        const x = c.getContext('2d');
        x.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        const cx = L ? L.x + L.cell * 3 : view.w / 2, cy = L ? L.y + L.cell * 3 : view.h / 2;
        const rg = x.createRadialGradient(cx, cy, 10, cx, cy, Math.max(view.w, view.h) * 0.75);
        rg.addColorStop(0, '#0f1d2a');
        rg.addColorStop(0.55, '#081019');
        rg.addColorStop(1, '#03060a');
        x.fillStyle = rg;
        x.fillRect(0, 0, view.w, view.h);
        x.strokeStyle = 'rgba(88,200,255,0.045)';
        x.lineWidth = 1;
        const step = L ? L.cell / 2 : 40;
        const ox = L ? L.x % step : 0, oy = L ? L.y % step : 0;
        x.beginPath();
        for (let px = ox; px < view.w; px += step) { x.moveTo(Math.round(px) + 0.5, 0); x.lineTo(Math.round(px) + 0.5, view.h); }
        for (let py = oy; py < view.h; py += step) { x.moveTo(0, Math.round(py) + 0.5); x.lineTo(view.w, Math.round(py) + 0.5); }
        x.stroke();
        if (L) {
          const N = 6, s = L.cell * N, pad = 15;
          // moldura com cantos
          x.strokeStyle = 'rgba(63,215,197,0.35)';
          x.lineWidth = 1.5;
          const bx = L.x - pad, by = L.y - pad, bw = s + pad * 2, k = Math.min(26, L.cell * 0.4);
          x.beginPath();
          for (const [ax, ay, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bw, 1, -1], [bx + bw, by + bw, -1, -1]]) {
            x.moveTo(ax, ay + dy * k); x.lineTo(ax, ay); x.lineTo(ax + dx * k, ay);
          }
          x.stroke();
          x.fillStyle = 'rgba(125,147,166,0.75)';
          x.font = '700 10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          for (let i = 0; i < N; i++) {
            x.fillText('ABCDEF'[i], L.x + (i + 0.5) * L.cell, L.y - pad / 2);
            x.fillText(String(i + 1), L.x - pad / 2, L.y + (i + 0.5) * L.cell);
          }
        }
        S.bg = c;
        S.bgKey = key;
      }
      g.drawImage(S.bg, 0, 0, view.w, view.h);
    }
    function ghost() {
      if (!S.build) return null;
      const cur = S.hover || S.kcur;
      if (!cur) return null;
      const p = ghostPos(cur);
      return { type: S.build.type, x: p.x, y: p.y, valid: !BS().canPlace(S.G, S.baseId, S.build.type, p.x, p.y) };
    }
    function updateGhostTip() {
      const gh = ghost(), L = S.L, tip = S.r.ghost;
      if (!gh || !L) { hideGhostTip(); return; }
      const why = BS().canPlace(S.G, S.baseId, gh.type, gh.x, gh.y);
      const size = D().facilities[gh.type].size;
      tip.textContent = why ? errText(why) : T('base.build.ghostOk', { cost: money(D().facilities[gh.type].cost) });
      tip.className = 'bsc-ghosttip ' + (why ? 'bad' : 'good');
      const x = L.x + (gh.x + size) * L.cell + 8, y = L.y + gh.y * L.cell;
      tip.style.left = Math.round(x) + 'px';
      tip.style.top = Math.round(y) + 'px';
      // não sair do ecrã à direita: encosta à esquerda da instalação; se também não cabe aí, fica por baixo (ou por
      // cima) da instalação, sempre dentro da janela
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const vw = typeof window !== 'undefined' ? window.innerWidth : L.host.right, vh = typeof window !== 'undefined' ? window.innerHeight : L.host.bottom;
      if (x + w > L.host.right - 4) {
        const lx = L.x + gh.x * L.cell - w - 8;
        if (lx >= 4) tip.style.left = Math.round(lx) + 'px';
        else {
          const below = L.y + (gh.y + size) * L.cell + 6;
          tip.style.left = Math.round(Math.max(4, Math.min(vw - w - 4, L.x + gh.x * L.cell))) + 'px';
          tip.style.top = Math.round(below + h <= vh - 4 ? below : Math.max(4, L.y + gh.y * L.cell - h - 6)) + 'px';
        }
      }
    }
    function hideGhostTip() { if (S.r.ghost) S.r.ghost.className = 'bsc-ghosttip hidden'; }

    sc.draw = function (ctx, view) {
      const b = base();
      if (!S.root || !b || !OV.BaseRender) return;
      const t = now();
      const anim = OV.BaseRender.animated(b);
      const isTop = OV.Scenes.top() === sc;
      if (!S.dirty && isTop && !(anim && t - S.lastDraw >= 1000 / (OV.BaseRender.ANIM_FPS || 20))) return;
      S.dirty = false;
      S.lastDraw = t;
      const L = layoutView();
      S.L = L;
      const g = view.begin('#04070b');
      backdrop(g, view, L);
      if (!L) return;
      const hl = S.hlFac || S.highlight;
      OV.BaseRender.draw(g, b, {
        x: L.x, y: L.y, cell: L.cell, dpr: view.dpr, time: t / 1000,
        hover: S.build ? null : S.hover || S.kcur, selection: S.sel, ghost: ghost(), dismantle: S.dismantle, highlight: hl || null, G: S.G,
      });
      if (S.build) updateGhostTip();
    };

    // ---- entrada ---------------------------------------------------------------------------------------------
    function cellFrom(ev) {
      return S.L ? OV.BaseRender.cellAt({ x: S.L.x, y: S.L.y, cell: S.L.cell }, ev.x, ev.y) : null;
    }
    function sameCell(a, b) { return (!a && !b) || (a && b && a.x === b.x && a.y === b.y); }
    function onHover(cell) {
      if (sameCell(cell, S.hover)) return;
      S.hover = cell;
      if (cell && S.build) S.kcur = cell;
      else if (cell) S.kcur = null;
      if (!cell) hideGhostTip();
      S.dirty = true;
      renderInfo();
    }
    function onClick(ev) {
      const cell = cellFrom(ev);
      if (S.build) {
        if (!cell) return;
        S.hover = ev.pointerType === 'mouse' ? cell : S.hover;
        S.kcur = cell;
        S.dirty = true;
        renderInfo();
        tryPlace(cell, !!(ev.mods && ev.mods.shift));
        return;
      }
      const f = cell ? OV.BaseRender.facilityAt(base(), cell.x, cell.y) : null;
      if (!f) {
        if (S.sel) { S.sel = null; sfx('ui_click'); }
      } else if (S.sel && S.sel.x === f.x && S.sel.y === f.y) {
        S.sel = null;
        sfx('ui_click');
      } else {
        S.sel = { x: f.x, y: f.y };
        sfx('ui_select');
        if (f.type === 'hangar' && S.tab === 'crafts') selectHangarCraft(f);
      }
      S.dirty = true;
      renderInfo();
    }
    function onDbl(ev) {
      if (S.build) return;
      const cell = cellFrom(ev);
      const f = cell ? OV.BaseRender.facilityAt(base(), cell.x, cell.y) : null;
      const tab = f ? jumpTab(f.type) : null;
      if (tab) {
        S.sel = { x: f.x, y: f.y };
        setTab(tab);
        if (f.type === 'hangar') selectHangarCraft(f);
      }
    }
    function moveCursor(dx, dy) {
      const c = S.kcur || { x: 2, y: 2 };
      S.kcur = { x: Math.max(0, Math.min(5, c.x + dx)), y: Math.max(0, Math.min(5, c.y + dy)) };
      S.hover = null;
      sfx('ui_click');
      S.dirty = true;
      renderInfo();
    }
    function onKey(ev) {
      const k = ev.key;
      const m = ev.mods || {};
      if (S.equip) {
        if (k === 'Escape') { if (!ev.repeat) closeEquip(); return true; }
        return false;
      }
      if (m.ctrl || m.alt) return false;
      // Esc mantido premido não atravessa vários ecrãs: só uma pressão nova sai
      if (ev.repeat && (k === 'Escape' || k === 'Enter')) return true;
      if (k === 'Escape') {
        if (S.build) cancelBuild();
        else if (S.dismantle) { S.sel = null; S.dismantle = null; sfx('ui_click'); S.dirty = true; renderInfo(); }
        else back(); // uma instalação só selecionada não prende o Esc: o jogador quer sair
        return true;
      }
      // foco num separador (role=tab): ←/→/Início/Fim mudam de separador (padrão WAI-ARIA); a grelha fica para depois
      const ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains('bsc-tab') && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End')) {
        const i = TABS.indexOf(S.tab);
        const j = k === 'Home' ? 0 : k === 'End' ? TABS.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        setTab(TABS[j]);
        const t = S.r.tabs && S.r.tabs.querySelector('.bsc-tab[data-tab="' + TABS[j] + '"]');
        if (t) t.focus({ preventScroll: true });
        return true;
      }
      if (S.build) {
        if (k === 'ArrowLeft') { moveCursor(-1, 0); return true; }
        if (k === 'ArrowRight') { moveCursor(1, 0); return true; }
        if (k === 'ArrowUp') { moveCursor(0, -1); return true; }
        if (k === 'ArrowDown') { moveCursor(0, 1); return true; }
        if (k === 'Enter' && S.kcur) { tryPlace(S.kcur, !!m.shift); return true; }
      }
      if (S.tab === 'market' && marketKey(k, m)) return true;
      if (ev.repeat) return false;
      if (/^[1-9]$/.test(k) && !m.shift) { setTab(TABS[+k - 1], false, true); return true; }
      const lk = k.length === 1 ? k.toLowerCase() : k;
      if (lk === 'u' && OV.Ufopaedia) { openUfopaedia(null); return true; }
      if (lk === 'b') { setTab('facilities'); const list = S.r.content.querySelector('.bsc-buildlist'); if (list) list.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; }
      if (lk === 'n') {
        if (S.tab === 'research') { const b = S.r.content.querySelector('[data-act="newResearch"]'); if (b) b.click(); return true; }
        if (S.tab === 'production') { const b = S.r.content.querySelector('[data-act="newProduction"]'); if (b) b.click(); return true; }
        return false;
      }
      if (lk === 'e' && S.tab === 'crafts') { const b = S.r.content.querySelector('[data-act="equip"]'); if (b) b.click(); return true; }
      if (lk === 'a' && S.tab === 'crafts') { const b = S.r.content.querySelector('[data-act="boardAll"]'); if (b) b.click(); return true; }
      if (lk === 'x' && S.tab === 'crafts') { const b = S.r.content.querySelector('[data-act="cydonia"]'); if (b) b.click(); return true; }
      if (lk === 'm' && S.tab === 'soldiers') { S.memorial = !S.memorial; sfx('ui_select'); renderContent(); return true; }
      if (k === '[') { switchBase(-1); return true; }
      if (k === ']') { switchBase(1); return true; }
      // Soldados: ↑/↓/Início/Fim escolhem o soldado da lista (com o foco onde estiver, fora dos campos de texto)
      if (S.tab === 'soldiers' && !S.memorial && S.solOrder && S.solOrder.length && (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End')) {
        const L = S.solOrder;
        let i = L.indexOf(S.solSel);
        i = k === 'Home' ? 0 : k === 'End' ? L.length - 1 : Math.max(0, Math.min(L.length - 1, i + (k === 'ArrowDown' ? 1 : -1)));
        if (L[i] !== S.solSel) sfx('ui_select');
        S.solSel = L[i];
        S.focusSol = true;
        renderContent();
        return true;
      }
      if (S.tab === 'soldiers' && k === 'Enter' && document.activeElement && document.activeElement.matches && document.activeElement.matches('tr[data-sol]')) {
        const inp = S.r.content.querySelector('.bsc-sol-name');
        if (inp) { inp.focus(); inp.select(); }
        return true;
      }
      // Instalações: as setas movem um cursor sobre a grelha; Enter escolhe a instalação, ⌫ desmantela
      if (S.tab === 'facilities' && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
        if (!S.kcur) S.kcur = S.sel ? { x: S.sel.x, y: S.sel.y } : { x: 2, y: 2 };
        else moveCursor(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0);
        S.dirty = true;
        renderInfo();
        return true;
      }
      if (S.tab === 'facilities' && k === 'Enter' && S.kcur && !(document.activeElement && document.activeElement.tagName === 'BUTTON' && S.root.contains(document.activeElement))) {
        const f = OV.BaseRender.facilityAt(base(), S.kcur.x, S.kcur.y);
        if (!f || (S.sel && S.sel.x === f.x && S.sel.y === f.y)) { S.sel = null; sfx('ui_click'); }
        else { S.sel = { x: f.x, y: f.y }; sfx('ui_select'); }
        S.dirty = true;
        renderInfo();
        return true;
      }
      if ((k === 'Backspace' || k === 'Delete') && S.sel) {
        const f = OV.BaseRender.facilityAt(base(), S.sel.x, S.sel.y);
        if (f) dismantleDlg(f);
        return true;
      }
      return false;
    }
    sc.onInput = function (ev) {
      if (!S.root) return false;
      switch (ev.kind) {
        case 'hover': if (!S.equip) onHover(cellFrom(ev)); return true;
        case 'leave': onHover(null); return true;
        case 'click': if (!S.equip) onClick(ev); return true;
        case 'dblclick': if (!S.equip) onDbl(ev); return true;
        case 'secondary':
          if (S.build) cancelBuild();
          else if (S.sel) { S.sel = null; S.dirty = true; renderInfo(); sfx('ui_click'); }
          return true;
        case 'key': return onKey(ev);
        default: return false;
      }
    };

    // ---- ciclo de vida -----------------------------------------------------------------------------------------
    sc.enter = function () {
      const g = S.G;
      S.baseId = pickBase(P.baseId);
      const want = P.tab || (g && g.ui && g.ui.baseTab) || 'facilities';
      S.tab = TABS.indexOf(want) >= 0 ? want : 'facilities';
      if (g && !g.ui) g.ui = {};
      active = sc;
      mount();
      if (!S.baseId) { refresh(); return; }
      refresh();
      try {
        if (OV.audio && OV.audio.music) {
          const moods = OV.audio.moods ? OV.audio.moods() : [];
          OV.audio.music(moods.indexOf('base') >= 0 ? 'base' : 'geoscape');
        }
      } catch (e) { /* som opcional */ }
      // vindo do aviso «Investigação concluída → Novo projeto»: abre logo a escolha se houver quem trabalhe
      // com projetos a decorrer (ex.: cientistas acabados de chegar) mostra-se a lista para os atribuir; a escolha de
      // projeto só abre sozinha sem projetos ou quando pedida («Novo projeto»)
      // vindo de «Comprar munição» (Geoscape): Mercado › Comprar com a linha do objeto à vista e o botão em foco
      if (P.tab === 'market' && P.item) {
        S.market = 'buy';
        // quantidade sugerida (ex.: caixas de munição para encher as naves e ter uma recarga de reserva)
        if (P.qty > 0) S.qty[P.item] = P.qty | 0;
        renderContent();
        setTimeout(() => {
          const row = S.root && S.r.content.querySelector('[data-buy="' + P.item + '"]');
          if (!row) return;
          row.classList.add('bsc-hl');
          row.scrollIntoView({ block: 'center' });
          const b = row.querySelector('[data-act="buy"]');
          if (b && OV.Input.lastPointerType !== 'touch') b.focus({ preventScroll: true });
        }, 60);
      }
      // vindo de «Pôr na nave» (material entregue): Naves com o transporte escolhido e o equipamento aberto
      if (P.equip && C().findCraft(g, P.equip)) {
        S.tab = 'crafts';
        S.craftSel = P.equip;
        refresh();
        setTimeout(() => { if (S.root && OV.Scenes.top() === sc) openEquip(P.equip); }, 60);
      }
      if (P.tab === 'research' && (P.pick || !base().research.length)) {
        const b = base(), st = BS().staff(g, b.id), caps = BS().capacities(g, b.id);
        if (st.scientists.free > 0 && caps.labs.used < caps.labs.cap && C().availableResearch(g, b.id).length) setTimeout(() => { if (S.root && OV.Scenes.top() === sc) researchPicker(); }, 220);
      }
    };
    sc.exit = function () {
      unmount();
      if (active === sc) active = null;
    };
    sc.pause = function () {
      if (S.root) S.root.classList.add('scr-paused');
      if (S.sheet) S.sheet.close();
      hideGhostTip();
      OV.Dom.hideTooltip();
    };
    sc.resume = function () {
      if (S.root) S.root.classList.remove('scr-paused');
      active = sc;
      S.bgKey = '';
      refresh();
    };
    sc.think = function () {};
    sc.onResize = function () {
      S.dirty = true;
      S.bgKey = '';
    };
    sc.go = function (baseId, tab) {
      S.baseId = pickBase(baseId || S.baseId);
      S.sel = null;
      S.build = null;
      if (tab && TABS.indexOf(tab) >= 0) S.tab = tab;
      refresh();
    };
    sc.refresh = refresh;
    sc.debugState = () => ({
      tab: S.tab, baseId: S.baseId, build: S.build ? S.build.type : null, sel: S.sel, hover: S.hover, kcur: S.kcur,
      layout: S.L ? { x: S.L.x, y: S.L.y, cell: S.L.cell } : null, equip: S.equip ? S.equip.craftId : null, sheet: !!S.sheet,
      craftSel: S.craftSel, solSel: S.solSel, market: S.market, memorial: S.memorial,
    });
    return sc;
  };

  // ================================================================================================
  function open(G, baseId, tab, opts) {
    const top = OV.Scenes.top();
    if (top && top.id === 'basescape' && top.S && top.S.G === G) {
      top.go(baseId, tab);
      return top;
    }
    return OV.Scenes.push('basescape', { G, baseId: baseId || null, tab: tab || null, pick: !!(opts && opts.pick), item: (opts && opts.item) || null, qty: (opts && opts.qty) || null, equip: (opts && opts.equip) || null });
  }
  function close() {
    const top = OV.Scenes.top();
    if (!top || top.id !== 'basescape') return false;
    if (OV.Scenes.stack.length > 1) OV.Scenes.pop();
    else if (OV.GeoUI && OV.GeoUI.open && top.S.G) OV.GeoUI.open(top.S.G);
    else OV.Scenes.set('menu');
    return true;
  }

  OV.BaseUI = {
    TABS: TABS.slice(),
    open,
    close,
    isOpen: () => !!active,
    refresh() { if (active) active.refresh(); },
    errText, groupDeliveries, nextTen, lostTopics,
    debug: {
      scene: () => active,
      state: () => (active ? active.debugState() : null),
      cellCenter(x, y) {
        const st = active ? active.debugState() : null;
        if (!st || !st.layout) return null;
        return { x: st.layout.x + (x + 0.5) * st.layout.cell, y: st.layout.y + (y + 0.5) * st.layout.cell };
      },
    },
  };
})(globalThis.OV || (globalThis.OV = {}));
