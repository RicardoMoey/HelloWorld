/* Inventário do Battlescape, kit médico e ecrã «Equipar» (DESIGN.md §15.4, §3.7, §3.6).
   Boneco de papel: mãos (2 espaços grandes), cinto (4 unidades), mochila (9 unidades) e chão do tile (lista).
   Arrastar e largar (pointer events) ou clicar no objeto e depois no destino (trackpad); custo em UT em todos os
   destinos («−8 UT», vermelho quando não chega ou não cabe); recarregar largando um carregador na arma; ativar
   granadas (espoleta 0–5); descarregar (quando o motor tem a ação 'unload'); dicas com as estatísticas do objeto.
   Teclado: I/Esc fecha, setas movem o foco, Enter/Espaço apanha/pousa, ⌫ larga, R recarrega, Tab muda de soldado.
   Todas as mudanças passam por OV.Act.perform (via opts.perform = ação do Battlescape, que anima no apresentador,
   ou OV.Presenter.play / esgotar o gerador) — as UT são cobradas pelo motor, nunca aqui.

   OV.InventoryUI.open(B, unitId, opts) → Promise (resolve ao fechar)  — empilha a cena 'inventory' por cima do mapa
     opts = {onClose(), perform(action) → Promise<{ok}>, select(unitId)}
   OV.InventoryUI.medikit(B, unitId, itemId?, opts) → Promise           — só o painel do kit médico (menu «Usar»)
   OV.InventoryUI.close() ; isOpen() ; refresh() ; debug.state()
   OV.InventoryUI.equipScreen(container, {squad, stores, onChange, night?, selectedId?, researched?}) → controlador
     (researched: G.researched da campanha | null = tudo conhecido; omitido = OV.Game.G.researched)
   OV.InventoryUI.model = {autoLoadout(soldier, stores, opts) → loadout, armedLo(loadout) → bool (arma que dispara),
     loadPlan(loadout) → {R, L}: {slot, k, type}|null (carregador que entra em cada arma, como BUnits.autoLoad),
     inWeapon(loadout) → {belt:Set(k), pack:Set(k)}, visibleIn(loadout, slot) → [tipos que ocupam espaço],
     eqMove(loadout, from, k, type, to) → {ok, lo, back[], label?}|{ok:false, reason}, settleOrder(loadout) → loadout
     (ordem guardada: o carregador «na arma» que é o único compatível do cinto passa para o fim),
     navPick(rects, k, dir) → índice (setas do teclado: vizinho só para lá da aresta do atual; k = fica)}
     squad = [{id, name, rank, stats{str,tu,hp…}, armour, portraitSeed, female, nat, loadout{R,L,belt[],pack[]}}]
     stores = {tipoDeItem: quantidade}. Trabalha sobre cópias (sem UT; o armazém é a reserva) e chama
     onChange({loadouts: {id: loadout}, stores}) a cada alteração; quem chama aplica-as ao jogo.
     controlador = {root, state(), select(id), refresh(), destroy()} */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  const el = (...a) => OV.Dom.el(...a);
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  // espoleta 0: rebenta ao aterrar (granadas instantâneas, por omissão) ou no fim do turno
  const instantOf = (B) => {
    const st = (B && B.settings) || (OV.Game && OV.Game.settings) || {};
    return st.instantGrenades !== false;
  };
  const fuseText = (base, n, B) => (n > 0 ? Tn(base, n) : T(base + '.zero.' + (instantOf(B) ? 'instant' : 'end')));
  const D = () => OV.Data;
  const MINUS = '−';
  const LIVE = { ok: 1, panic: 1 };
  const SLOT_ORDER = ['L', 'R', 'belt', 'pack'];
  const PARTS = 6;
  const dpr = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const isTouch = () => !!(OV.Input && OV.Input.lastPointerType === 'touch');

  function sfx(name, opts) {
    if (OV.audio) OV.audio.play(name, opts);
  }
  const defOf = (type) => (type ? D().items[type] || null : null);
  const capOf = (slot) => ((D().invSlots[slot] || {}).capacity) | 0;
  const sizeOf = (type) => D().itemSize(type) || 1;
  const unitName = (u) => (u ? u.name || (u.nameKey ? T(u.nameKey) : T('hud.unit.alien')) : '');
  const hasUnload = () => !!(OV.Act && OV.Act.TYPES && OV.Act.TYPES.indexOf('unload') >= 0);
  const reasonText = (r) => (OV.T.has('bs.' + r) ? T('bs.' + r) : T('bs.invalid'));
  const costText = (tu) => T('hud.inv.cost', { tu });

  function rankName(u, abbr) {
    if (!u || typeof u.rank !== 'number' || (u.type && u.type !== 'soldier')) return '';
    const r = D().ranks && D().ranks.soldier ? D().ranks.soldier[u.rank] : null;
    return r ? T(abbr ? r.abbrKey : r.nameKey) : '';
  }
  // peso de um objeto (com o carregador inserido)
  function weightOf(type, ammo) {
    const d = defOf(type);
    let w = d ? d.weight | 0 : 0;
    if (ammo && defOf(ammo.type)) w += defOf(ammo.type).weight | 0;
    return w;
  }

  // ---- desenho -----------------------------------------------------------------------------------------------
  function iconCanvas(type, size) {
    const k = dpr();
    const c = el('canvas', { class: 'inv-ic', width: Math.round(size * k), height: Math.round(size * k) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    if (OV.ItemSprites) OV.ItemSprites.drawIcon(g, type, 0, 0, size);
    return c;
  }
  function portraitCanvas(u, size) {
    const k = dpr();
    const c = el('canvas', { class: 'inv-pt', width: Math.round(size * k), height: Math.round(size * k) });
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    try {
      if (OV.Portraits && (!u.type || u.type === 'soldier')) {
        OV.Portraits.draw(g, { portraitSeed: u.portraitSeed, female: u.female, nat: u.nat, armour: u.armourId || u.armour, rank: u.rank }, 0, 0, size);
      } else if (OV.UnitSprites) {
        g.fillStyle = '#16222e';
        g.fillRect(0, 0, size, size);
        const spr = OV.UnitSprites.get(u.sprite || 'soldier', 3, 'stand', 0, k * 1.3, { team: u.origSide || u.side, armour: u.armourId || 'coveralls' });
        const sc = Math.min((size * 0.92) / spr.h, (size * 0.92) / spr.w, 1.3);
        g.drawImage(spr.c, size / 2 - spr.ax * sc, size * 0.95 - spr.ay * sc, spr.w * sc, spr.h * sc);
      }
    } catch (e) {
      g.fillStyle = '#16222e';
      g.fillRect(0, 0, size, size);
    }
    return c;
  }
  // boneco grande ao centro, com a arma que tem nas mãos
  function figureCanvas(B, u, h) {
    const k = dpr();
    const w = Math.round(h * 0.72);
    const c = el('canvas', { class: 'inv-fig-c', width: Math.round(w * k), height: Math.round(h * k) });
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    if (!OV.UnitSprites) return c;
    const g = c.getContext('2d');
    let weapon = 'none', gun = 'ballistic';
    for (const hand of ['R', 'L']) {
      const it = B ? OV.BUnits.findItem(B, u.items[hand]) : null;
      const d = it && defOf(it.type);
      if (!d || (d.kind !== 'firearm' && d.kind !== 'melee' && d.kind !== 'psiamp')) continue;
      weapon = d.size >= 4 ? 'heavy' : d.twoHanded ? 'rifle' : 'pistol';
      gun = /plasma/.test(it.type) ? 'plasma' : /laser/.test(it.type) ? 'laser' : 'ballistic';
      break;
    }
    let skin = (u.portraitSeed >>> 0) & 3;
    if (OV.Portraits && OV.Portraits.traits && u.sprite === 'soldier') {
      try { skin = Math.min(3, Math.floor(((OV.Portraits.traits(u).skinIdx || 0) * 4) / 10)); } catch (e) { /* tom por omissão */ }
    }
    try {
      const probe = OV.UnitSprites.get(u.sprite || 'soldier', 3, 'stand', 0, 1, { armour: u.armourId || 'coveralls', weapon, gun, team: u.origSide || u.side, female: !!u.female, skin, rank: u.rank | 0 });
      const sc = Math.min((h * 0.9) / probe.h, (w * 0.95) / probe.w);
      const spr = OV.UnitSprites.get(u.sprite || 'soldier', 3, 'stand', 0, sc * k, { armour: u.armourId || 'coveralls', weapon, gun, team: u.origSide || u.side, female: !!u.female, skin, rank: u.rank | 0 });
      g.setTransform(k, 0, 0, k, 0, 0);
      // sombra no chão
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(w / 2, h * 0.94, w * 0.28, h * 0.035, 0, 0, Math.PI * 2);
      g.fill();
      g.drawImage(spr.c, w / 2 - spr.ax * sc, h * 0.94 - spr.ay * sc - 8 * sc, spr.w * sc, spr.h * sc);
    } catch (e) {
      // sem sprite: fica só o contorno do espaço
    }
    return c;
  }

  // pegada (tamanho em unidades de inventário)
  function footprint(size) {
    const f = el('span', { class: 'inv-fp', 'aria-hidden': 'true' });
    for (let k = 0; k < size; k++) f.appendChild(el('i'));
    return f;
  }

  /* Ladrilho de objeto. e = {src, drop?, type, ammo?, rounds?, fuse?, charges?, name, count?, cantCarry?}
     o = {icon, nameOn, big, cls} */
  function tileEl(e, o) {
    const d = defOf(e.type) || {};
    const size = sizeOf(e.type);
    const t = el('div', { class: 'inv-it s' + size + (o.cls ? ' ' + o.cls : '') + (e.cantCarry ? ' heavy' : ''), dataset: { src: e.src, nav: '1' } });
    if (e.drop) t.dataset.drop = e.drop;
    if (o.cls && o.cls.indexOf('cell') >= 0) t.style.gridColumn = 'span ' + size;
    t.appendChild(iconCanvas(e.type, o.icon));
    if (o.nameOn) t.appendChild(el('span', { class: 'inv-nm', text: e.name }));
    t.appendChild(footprint(size));
    // munições: arma (carregador inserido) ou carregador solto
    if (d.kind === 'firearm' && Array.isArray(d.ammo) && d.ammo.length) {
      if (e.ammo) {
        const max = (defOf(e.ammo.type) || {}).rounds | 0;
        t.appendChild(el('span', { class: 'inv-badge ammo' + (e.ammo.rounds <= 0 ? ' empty' : ''), text: o.big ? e.ammo.rounds + '/' + max : String(e.ammo.rounds) }));
      } else if (e.ammo === null) t.appendChild(el('span', { class: 'inv-badge ammo empty', text: T('hud.inv.empty') }));
    } else if (d.kind === 'ammo') {
      const r = e.rounds === null || e.rounds === undefined ? d.rounds | 0 : e.rounds;
      t.appendChild(el('span', { class: 'inv-badge ammo', text: String(r) }));
    } else if (d.kind === 'grenade' && e.fuse >= 0) {
      t.appendChild(el('span', { class: 'inv-badge fuse', text: T('hud.fuse.badge', { n: e.fuse }), title: fuseText('hud.tip.fuse', e.fuse, V && V.B) }));
    } else if (d.kind === 'medikit' && e.charges) {
      t.appendChild(el('span', { class: 'inv-badge med', text: '✚ ' + (e.charges.heal | 0) }));
    }
    if (e.count !== undefined) t.appendChild(el('span', { class: 'inv-badge count', text: T('hud.equip.count', { n: e.count }) }));
    t.setAttribute('aria-label', e.name);
    return t;
  }

  /* Texto das estatísticas (dica e painel de informação). ctx = {B, u, it} (batalha) ou {type, str} (equipar) */
  function statLines(type, ctx) {
    const d = defOf(type);
    const out = [];
    if (!d) return out;
    const B = ctx.B, u = ctx.u, it = ctx.it;
    const ammo = it ? it.ammo : null;
    out.push(T('hud.inv.stat.wsize', { w: weightOf(type, ammo), s: sizeOf(type) }) + (d.twoHanded ? ' · ' + T('hud.inv.stat.twoHanded') : ''));
    if (d.kind === 'firearm' || d.kind === 'melee') {
      const ad = Array.isArray(d.ammo) && d.ammo.length ? (ammo ? defOf(ammo.type) : null) : d;
      if (ad && ad.power !== undefined) {
        let s = T('hud.inv.stat.damage', { power: d.strengthPower && u ? u.stats.str | 0 : ad.power, type: T('dmg.' + ad.dmg) });
        if (ad.radius) s += ' · ' + T('hud.inv.stat.radius', { r: ad.radius });
        out.push(s);
      }
      if (Array.isArray(d.ammo) && d.ammo.length && it) {
        if (ammo) out.push(T('hud.inv.stat.loaded', { name: T(defOf(ammo.type).nameKey), n: ammo.rounds, max: defOf(ammo.type).rounds | 0 }));
        else out.push(T('hud.inv.stat.unloaded'));
      }
      for (const m of D().weaponModes(type)) {
        let acc = m.acc, tu = null;
        if (B && u && it) {
          acc = OV.Combat ? OV.Combat.accuracy(B, u, it.id, m.mode) : m.acc;
          tu = OV.BUnits.actionTU(B, u, it.id, m.mode);
        }
        const shots = m.mode === 'auto' && m.shots > 1 ? ' ×' + m.shots : '';
        out.push(tu !== null
          ? T('hud.inv.stat.mode', { mode: T('mode.' + m.mode) + shots, acc, tu })
          : T(m.flat ? 'hud.inv.stat.modeFlat' : 'hud.inv.stat.modePct', { mode: T('mode.' + m.mode) + shots, acc, tu: m.tu }));
      }
    } else if (d.kind === 'ammo') {
      let s = T('hud.inv.stat.damage', { power: d.power, type: T('dmg.' + d.dmg) });
      if (d.radius) s += ' · ' + T('hud.inv.stat.radius', { r: d.radius });
      out.push(s);
      const r = it && it.rounds !== null && it.rounds !== undefined ? it.rounds : d.rounds | 0;
      out.push(T('hud.inv.stat.rounds', { n: r, max: d.rounds | 0 }));
      const users = Object.keys(D().items).filter((k) => {
        const w = D().items[k];
        return w.kind === 'firearm' && Array.isArray(w.ammo) && w.ammo.indexOf(type) >= 0;
      });
      if (users.length) out.push(T('hud.inv.stat.fits', { list: users.map((k) => T(D().items[k].nameKey)).join(', ') }));
    } else if (d.kind === 'grenade') {
      out.push(T('hud.inv.stat.damage', { power: d.power, type: T('dmg.' + d.dmg) }) + ' · ' + T('hud.inv.stat.radius', { r: d.radius | 0 }));
      if (it && it.fuse >= 0) out.push(fuseText('hud.inv.stat.primed', it.fuse, B));
      else if (d.prime) out.push(T('hud.inv.stat.unprimed', { pct: tune('PCT_PRIME', 50) }));
    } else if (d.kind === 'medikit') {
      const ch = it && it.charges ? it.charges : d.charges || {};
      out.push(T('hud.inv.stat.charges', { heal: ch.heal | 0, stim: ch.stim | 0, pain: ch.pain | 0 }));
      out.push(T('hud.inv.stat.useTU', { tu: d.useTU || tune('TU_MEDIKIT', 10) }));
    } else if (d.kind === 'flare') {
      out.push(T('hud.inv.stat.light', { n: d.light | 0 }));
    } else if (d.kind === 'scanner') {
      out.push(T('hud.inv.stat.scanner', { pct: d.usePct || tune('PCT_SCANNER', 25) }));
    } else if (d.kind === 'corpse') {
      if (d.carry === false) out.push(T('bs.tooHeavy'));
    }
    if (d.kind !== 'firearm' && d.kind !== 'corpse' && !d.fixed && d.carry !== false) {
      const str = u ? u.stats.str | 0 : ctx.str | 0;
      if (str > 0) out.push(T('hud.inv.stat.throw', { r: D().throwRange(str, weightOf(type, ammo)) }));
    }
    return out;
  }
  function tipHtml(name, lines) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return '<b>' + esc(name) + '</b>' + lines.map((l) => '<br><span class="muted">' + esc(l) + '</span>').join('');
  }

  function meter(kind, label, v, max, o) {
    const opt = o || {};
    const pct = (x) => (max > 0 ? Math.max(0, Math.min(100, (x / max) * 100)) : 0);
    const bar = el('div', { class: 'inv-meter-bar' }, el('i', { class: 'fill', style: { width: pct(v).toFixed(1) + '%' } }));
    if (opt.ghost !== undefined && opt.ghost !== null && opt.ghost !== v) {
      const a = Math.min(v, opt.ghost), b = Math.max(v, opt.ghost);
      bar.appendChild(el('i', { class: 'ghost ' + (opt.ghost < v ? 'minus' : 'plus'), style: { left: pct(a).toFixed(1) + '%', width: (pct(b) - pct(a)).toFixed(1) + '%' } }));
    }
    if (opt.mark) bar.appendChild(el('b', { class: 'mark', style: { left: pct(opt.mark).toFixed(1) + '%' } }));
    return el('div', { class: 'inv-meter ' + kind + (opt.bad ? ' bad' : '') },
      el('div', { class: 'inv-meter-top' }, el('span', { class: 'lbl', text: label }), el('span', { class: 'val', text: opt.text || v + '/' + max })),
      bar,
      opt.note ? el('div', { class: 'inv-meter-note', text: opt.note }) : null);
  }

  /* ---- motor de escolha: arrastar e largar + clicar/clicar + teclado -----------------------------------------
     api = {preview(src, drop) → {ok, label, bad?, warn?}|null, commit(src, drop, p), canPick(src), busy(),
            changed(sel, hot, hotP), background()}  — fontes com data-src, destinos com data-drop */
  const HOLD_MS = 300; // toque longo que levanta um objeto de uma lista que rola
  function makePicker(root, api) {
    const P = { sel: null, hot: null, hotP: null, drag: null, press: null };
    let ghost = null;

    function dropChain(node) {
      const out = [];
      let n = node && node.closest ? node.closest('[data-drop]') : null;
      while (n && root.contains(n)) {
        out.push(n);
        n = n.parentElement ? n.parentElement.closest('[data-drop]') : null;
      }
      return out;
    }
    // primeiro destino da cadeia com significado para a seleção
    function resolve(node) {
      if (!P.sel) return null;
      for (const n of dropChain(node)) {
        const p = api.preview(P.sel, n.dataset.drop);
        if (p) return { key: n.dataset.drop, p, el: n };
      }
      return null;
    }
    /* destino de um clique noutro objeto: o próprio objeto (recarregar a arma com o carregador escolhido) ou, se
       aceitar o objeto escolhido, o contentor onde ele está (tocar numa linha do armazém guarda; munição largada na
       arma carrega-a). Sem destino válido → null (o clique escolhe esse objeto). Fora de objetos: o contentor. */
    function clickTarget(node) {
      if (!P.sel) return null;
      const srcEl = node && node.closest ? node.closest('[data-src]') : null;
      if (srcEl && root.contains(srcEl)) {
        if (srcEl.dataset.src === P.sel) return null;
        if (api.canPick(srcEl.dataset.src)) {
          const p = srcEl.dataset.drop ? api.preview(P.sel, srcEl.dataset.drop) : null;
          if (p) return { key: srcEl.dataset.drop, p, el: srcEl };
          const r = resolve(srcEl.parentElement);
          return r && r.p.ok ? r : null;
        }
      }
      return resolve(node);
    }
    // contentor de um objeto que recusa o objeto escolhido (Enter numa casa ocupada: recusar, não trocar a escolha)
    function refusal(srcEl) {
      const r = resolve(srcEl.parentElement);
      return r && !r.p.ok ? r : null;
    }
    function decorate() {
      for (const n of root.querySelectorAll('[data-drop]')) {
        n.classList.remove('drop-ok', 'drop-bad', 'drop-warn', 'hot');
        const old = n.querySelector(':scope > .inv-chip');
        if (old) old.remove();
      }
      for (const n of root.querySelectorAll('[data-src]')) n.classList.toggle('picked', !!P.sel && n.dataset.src === P.sel);
      root.classList.toggle('picking', !!P.sel);
      if (!P.sel) return;
      for (const n of root.querySelectorAll('[data-drop]')) {
        const p = api.preview(P.sel, n.dataset.drop);
        if (!p) continue;
        n.classList.add(p.ok ? (p.warn ? 'drop-warn' : 'drop-ok') : 'drop-bad');
        if (p.label) n.appendChild(el('span', { class: 'inv-chip' + (p.ok ? (p.warn ? ' warn' : '') : ' bad'), text: p.label }));
      }
      if (P.hot) {
        const h = root.querySelector('[data-drop="' + P.hot + '"]');
        if (h) h.classList.add('hot');
      }
    }
    function select(src, quiet) {
      if (src && !api.canPick(src)) src = null;
      if (src) OV.Dom.hideTooltip();
      P.sel = src;
      P.hot = null;
      P.hotP = null;
      if (src && !quiet) sfx('ui_select');
      decorate();
      api.changed(P.sel, null, null);
    }
    function setHot(r) {
      const key = r ? r.key : null;
      if (key === P.hot) return;
      P.hot = key;
      P.hotP = r ? r.p : null;
      for (const n of root.querySelectorAll('.hot')) n.classList.remove('hot');
      if (r) r.el.classList.add('hot');
      api.changed(P.sel, P.hot, P.hotP);
    }
    function deny(p) {
      sfx('ui_deny');
      if (p && p.reason) OV.Dom.toast(p.reason, null, 'warn');
    }
    async function commit(r) {
      const src = P.sel;
      P.sel = null;
      P.hot = null;
      P.hotP = null;
      decorate();
      await api.commit(src, r.key, r.p);
    }
    // clique (ou Enter, kbd = true) num nó
    function activate(node, kbd) {
      if (api.busy()) return;
      const srcEl = node.closest ? node.closest('[data-src]') : null;
      if (!P.sel) {
        if (srcEl && root.contains(srcEl)) select(srcEl.dataset.src);
        return;
      }
      if (srcEl && srcEl.dataset.src === P.sel) {
        select(null, true);
        sfx('ui_click', { vol: 0.5 });
        return;
      }
      const r = clickTarget(node);
      if (r) {
        if (r.p.ok) commit(r);
        else deny(r.p);
        return;
      }
      // teclado: o objeto escolhido nunca se perde em silêncio — casa ocupada recusa com som e motivo
      const no = kbd && srcEl && root.contains(srcEl) ? refusal(srcEl) : null;
      if (no) {
        deny(no.p.reason ? no.p : { reason: no.p.label });
        return;
      }
      if (srcEl && root.contains(srcEl) && api.canPick(srcEl.dataset.src)) {
        select(srcEl.dataset.src);
        return;
      }
      select(null, true);
    }
    function startDrag(pr) {
      P.drag = pr;
      if (P.sel !== pr.src) select(pr.src, true);
      sfx('ui_select', { vol: 0.6 });
      ghost = pr.el.cloneNode(true);
      // as telas (canvas) não se copiam com cloneNode: redesenhar
      const srcC = pr.el.querySelectorAll('canvas'), dstC = ghost.querySelectorAll('canvas');
      srcC.forEach((c, k) => { if (dstC[k]) dstC[k].getContext('2d').drawImage(c, 0, 0); });
      ghost.classList.add('inv-ghost');
      ghost.classList.remove('picked', 'kfocus', 'drop-ok', 'drop-bad', 'drop-warn', 'hot');
      const r = pr.el.getBoundingClientRect();
      // linha do armazém (larga como a lista): o fantasma fica do tamanho de um cartão, centrado no dedo/cursor
      const w = pr.el.classList.contains('row') ? Math.min(r.width, 260) : r.width;
      ghost.style.width = w + 'px';
      ghost.style.height = r.height + 'px';
      pr.dx = w < r.width ? w / 2 : pr.x0 - r.left;
      pr.dy = pr.y0 - r.top;
      root.appendChild(ghost);
      pr.el.classList.add('dragging');
    }
    function moveGhost(x, y) {
      if (!ghost) return;
      ghost.style.transform = 'translate(' + (x - P.drag.dx) + 'px,' + (y - P.drag.dy) + 'px) rotate(-3deg) scale(1.04)';
    }
    function endDrag() {
      if (ghost) ghost.remove();
      ghost = null;
      if (P.drag && P.drag.el) P.drag.el.classList.remove('dragging');
      P.drag = null;
    }

    /* toque: as linhas do armazém (e as listas que rolam) têm touch-action: pan-y — arrastar na vertical rola a
       lista. Segurar o dedo HOLD_MS sem mexer levanta o objeto (fantasma + som) e, a partir daí, o touchmove é
       cancelado (ouvinte não passivo) para a lista não rolar; na horizontal o arrasto começa logo, como no rato. */
    function onDown(e) {
      if (e.button !== 0 || api.busy()) return;
      const srcEl = e.target.closest('[data-src]');
      const pr = { x0: e.clientX, y0: e.clientY, id: e.pointerId, node: e.target, src: srcEl && root.contains(srcEl) ? srcEl.dataset.src : null, el: srcEl, type: e.pointerType };
      P.press = pr;
      if (srcEl) e.preventDefault();
      clearTimeout(P.holdT);
      if (pr.type === 'touch' && pr.src) {
        P.holdT = setTimeout(() => {
          if (P.press !== pr || P.drag || api.busy() || !api.canPick(pr.src)) return;
          pr.held = true;
          if (OV.Dom.hideLongPress) OV.Dom.hideLongPress();
          startDrag(pr);
          moveGhost(pr.x0, pr.y0);
          if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) { /* ignora */ }
        }, HOLD_MS);
      }
    }
    function onMove(e) {
      const pr = P.press;
      if (pr && pr.id === e.pointerId) {
        const ddx = e.clientX - pr.x0, ddy = e.clientY - pr.y0;
        // toque antes de segurar: na vertical é a lista a rolar (o navegador fica com o gesto)
        if (!P.drag && pr.type === 'touch' && !pr.held && Math.hypot(ddx, ddy) > 6) {
          clearTimeout(P.holdT);
          if (Math.abs(ddy) >= Math.abs(ddx)) return;
        }
        if (!P.drag && pr.src && api.canPick(pr.src) && Math.hypot(ddx, ddy) > 6) startDrag(pr);
        if (P.drag) {
          moveGhost(e.clientX, e.clientY);
          const under = document.elementFromPoint(e.clientX, e.clientY);
          setHot(resolve(under));
          return;
        }
      }
      if (!P.sel || P.drag || e.pointerType === 'touch') return;
      setHot(root.contains(e.target) ? clickTarget(e.target) : null);
    }
    function onUp(e) {
      const pr = P.press;
      if (!pr || pr.id !== e.pointerId) return;
      P.press = null;
      clearTimeout(P.holdT);
      // toque longo largado no sítio: fica escolhido (o toque seguinte no destino pousa-o)
      if (P.drag && pr.held && Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) < 10) {
        endDrag();
        return;
      }
      if (P.drag) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const r = resolve(under);
        endDrag();
        if (r && r.p.ok) commit(r);
        else {
          if (r) deny(r.p);
          select(null, true);
        }
        return;
      }
      const inside = pr.node.closest && pr.node.closest('[data-src],[data-drop],[data-act],button,.inv-keep');
      if (!inside) {
        if (P.sel) select(null, true);
        else api.background(pr.node);
        return;
      }
      if (pr.node.closest('[data-act],button')) return;
      activate(pr.node);
    }
    function onCancel(e) {
      clearTimeout(P.holdT);
      if (P.press && P.press.id === e.pointerId) P.press = null;
      if (P.drag) {
        endDrag();
        select(null, true);
      }
    }
    // objeto levantado pelo toque longo (ou já a arrastar): o dedo arrasta o objeto, não a lista
    const onTouchMove = (e) => {
      if ((P.drag || (P.press && P.press.held)) && e.cancelable) e.preventDefault();
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    root.addEventListener('pointerleave', (e) => { if (!P.drag && e.pointerType !== 'touch') setHot(null); });

    P.select = select;
    P.activate = activate;
    P.decorate = decorate;
    P.setHotNode = (node) => setHot(node ? clickTarget(node) : null);
    P.destroy = function () {
      clearTimeout(P.holdT);
      endDrag();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    return P;
  }

  /* ---- navegação por teclado (foco virtual, sem foco DOM para não duplicar ativações) ---------------------- */
  function navTargets(scope) {
    return Array.from(scope.querySelectorAll('[data-nav]')).filter((n) => {
      if (n.closest('.inv-ghost') || n.closest('.hidden')) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  /* zonas: cabeçalho, boneco (mãos, cinto, mochila), chão/armazém, painel de informação, equipa. ↑/↓ ficam na
     zona enquanto houver para onde ir (↓ da mão direita vai ao cinto, não às ações); ←/→ preferem a mesma linha. */
  const NAV_ZONES = '.inv-head, .inv-doll, .inv-ground, .inv-info, .eq-squad';
  /* vizinho para uma seta (pura, testada em Node): rects = [{left, top, right, bottom, zone}], k = o atual → índice
     do destino ou k (fica onde está). Só contam casas que estão inteiras para lá da aresta do atual (com EDGE_TOL px
     de folga): ↓ da mão nunca vai à outra mão (mesma linha) e ← da mão esquerda não desce para o cinto. ←/→ ficam
     na mesma linha (sobreposição vertical) ou num cone estreito; ↑/↓ vão à linha mais próxima da mesma zona e, nela,
     ao vizinho mais próximo na horizontal. */
  const EDGE_TOL = 6;
  function navPick(rects, k, dir) {
    const a = rects[k];
    if (!a) return 0;
    const horiz = dir === 'left' || dir === 'right';
    const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    const cands = [];
    rects.forEach((b, j) => {
      if (j === k) return;
      const gap = dir === 'left' ? a.left - b.right : dir === 'right' ? b.left - a.right : dir === 'up' ? a.top - b.bottom : b.top - a.bottom;
      if (gap < -EDGE_TOL) return;
      const dx = (b.left + b.right) / 2 - ax, dy = (b.top + b.bottom) / 2 - ay;
      const main = horiz ? Math.abs(dx) : Math.abs(dy), side = horiz ? Math.abs(dy) : Math.abs(dx);
      const overlap = horiz ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const ov = overlap > 4;
      if (horiz && !ov && side > main * 0.75) return;
      cands.push({ j, gap: Math.max(0, gap), main, side, ov, same: (b.zone || null) === (a.zone || null) });
    });
    const rowMin = horiz ? 0 : Math.min(Infinity, ...cands.filter((c) => c.same).map((c) => c.gap));
    let best = k, bd = Infinity;
    for (const c of cands) {
      let d;
      if (horiz) d = ((c.ov ? 0 : 2) + (c.same ? 0 : 1)) * 1e6 + (c.ov ? c.main : c.main + c.side * 3);
      else if (c.same) d = (c.gap <= rowMin + 12 ? 0 : 1e5 + c.gap * 10) + (c.ov ? c.side : 1e4 + c.side);
      else d = 2e6 + (c.ov ? c.gap + c.side * 0.1 : 1e5 + c.gap + c.side * 3);
      if (d < bd) { bd = d; best = c.j; }
    }
    return best;
  }
  function navMove(scope, cur, dir) {
    const list = navTargets(scope);
    if (!list.length) return null;
    if (!cur || !scope.contains(cur)) return list[0];
    let k = list.indexOf(cur);
    if (k < 0) {
      list.push(cur);
      k = list.length - 1;
    }
    const rects = list.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, zone: n.closest(NAV_ZONES) };
    });
    return list[navPick(rects, k, dir)] || cur;
  }
  function setFocus(V, node) {
    if (V.focusEl && V.focusEl !== node) V.focusEl.classList.remove('kfocus');
    V.focusEl = node || null;
    V.focusKey = node ? navKey(node) : null;
    const box = node && node.closest ? node.closest('[data-drop]') : null;
    V.focusBox = box ? box.dataset.drop : null;
    if (node) {
      node.classList.add('kfocus');
      if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  const navKey = (n) => n.dataset.src || n.dataset.drop || n.dataset.act || n.dataset.part || n.dataset.pid || null;
  /* depois de redesenhar: o mesmo nó (pela chave) ou, se mudou (objeto pousado, mão que ficou cheia, casa vazia sem
     chave), o compartimento onde o foco estava — o objeto que lá chegou (o último) ou a 1.ª casa. Nunca salta para
     o 1.º botão do ecrã (o Enter seguinte copiaria). */
  function restoreFocus(V, scope) {
    if (!V.kbd || (!V.focusKey && !V.focusBox)) return;
    const k = V.focusKey;
    let n = k ? scope.querySelector('[data-src="' + k + '"],[data-drop="' + k + '"],[data-act="' + k + '"],[data-part="' + k + '"],[data-pid="' + k + '"]') : null;
    if (!(n && n.dataset.nav)) {
      n = null;
      const box = V.focusBox ? scope.querySelector('[data-drop="' + V.focusBox + '"]') : null;
      if (box) {
        const items = navTargets(box);
        const srcs = items.filter((x) => x.dataset.src);
        n = (V.focusBox === 'slot:stores' || V.focusBox === 'slot:ground' ? srcs[0] : srcs[srcs.length - 1]) || items[0] || (box.dataset.nav ? box : null);
      }
    }
    V.focusEl = null;
    setFocus(V, n || navTargets(scope)[0] || null);
  }

  /* =============================================================================================================
     Inventário de batalha
     ============================================================================================================= */
  let V = null;

  const unitOf = (id) => (V && id !== null && id !== undefined ? OV.BUnits.findUnit(V.B, id) : null);
  const itemOf = (id) => (V && id !== null && id !== undefined ? OV.BUnits.findItem(V.B, id) : null);
  const cur = () => unitOf(V && V.unitId);
  const tileOfUnit = (u) => (u.z * V.B.map.h + u.y) * V.B.map.w + u.x;
  const idOfKey = (k) => (k && (k.startsWith('i:') || k.startsWith('item:')) ? +k.slice(k.indexOf(':') + 1) : null);

  function invUnits() {
    return V.B.units.filter((u) => (u.side === 'xcom') && u.onMap && u.x >= 0 && LIVE[u.status] === 1 && u.type === 'soldier');
  }
  function groundItems(u) {
    if (!u || u.x < 0) return [];
    const tiles = OV.BUnits.unitTiles(u, V.B.map);
    return V.B.items.filter((it) => it.owner === null && it.at !== null && it.at !== undefined && tiles.indexOf(it.at) >= 0);
  }
  function slotOfItem(u, it) {
    const s = OV.BUnits.slotOf(u, it.id);
    if (s) return s;
    if (it.owner === null && it.at !== null && it.at !== undefined && OV.BUnits.unitTiles(u, V.B.map).indexOf(it.at) >= 0) return 'ground';
    return null;
  }
  function itemName(it) {
    const d = defOf(it.type);
    if (it.unitId !== null && it.unitId !== undefined) {
      const b = OV.BUnits.findUnit(V.B, it.unitId);
      if (b) {
        if (b.status === 'out') return T('hud.inv.body', { name: unitName(b) });
        if (b.origSide === 'xcom' || b.side === 'civ') return T('hud.inv.corpseOf', { name: unitName(b) });
      }
    }
    return d ? T(d.nameKey) : it.type;
  }
  function entryOf(it, drop) {
    const d = defOf(it.type) || {};
    return {
      src: 'i:' + it.id, drop: drop || null, type: it.type, ammo: it.ammo, rounds: it.rounds, fuse: it.fuse, charges: it.charges,
      name: itemName(it), cantCarry: d.carry === false || d.battle === false,
    };
  }
  const isReloadable = (it) => {
    const d = it && defOf(it.type);
    return !!(d && d.kind === 'firearm' && Array.isArray(d.ammo) && d.ammo.length);
  };
  function freeHand(u, except) {
    for (const h of ['R', 'L']) if (h !== except && (u.items[h] === null || u.items[h] === undefined)) return h;
    return null;
  }
  // a reserva de UT (só aviso: os movimentos de inventário não lhe estão sujeitos no motor)
  function reserveOf(u) {
    return OV.Act && OV.Act.reserveTU ? OV.Act.reserveTU(V.B, u) | 0 : 0;
  }
  // resultado de pré-visualização a partir de validações
  function pv(ok, tu, reason, steps, extra) {
    const u = cur();
    const o = { ok, tu, steps: steps || [], reason: reason ? reasonText(reason) : null, warn: false, label: '' };
    if (ok) {
      o.label = costText(tu);
      const res = reserveOf(u);
      if (res > 0 && (u.tu | 0) - tu < res && (u.tu | 0) >= res) {
        o.warn = true;
        o.reason = T('hud.inv.eatsReserve');
      }
    } else if (reason === 'noTU' && tu) o.label = costText(tu);
    else if (reason) o.label = reason === 'slotFull' ? T('hud.inv.occupied') : reason === 'noRoom' ? T('hud.inv.noFit') : reasonText(reason);
    return Object.assign(o, extra || {});
  }
  function invAction(u, it, to) {
    return { type: slotOfItem(u, it) === 'ground' ? 'pickup' : 'inv', unitId: u.id, itemId: it.id, to };
  }
  // carregador → arma: pode apanhar primeiro do chão (lugar mais barato que caiba)
  function reloadPreview(u, clip, w) {
    const wd = defOf(w.type);
    if (!isReloadable(w) || wd.ammo.indexOf(clip.type) < 0 || defOf(clip.type).kind !== 'ammo') return null;
    const wslot = slotOfItem(u, w);
    if (wslot !== 'R' && wslot !== 'L') return pv(false, 0, null, [], { reason: T('hud.inv.weaponInHand'), label: T('hud.inv.weaponInHandShort') });
    if (w.ammo && w.ammo.rounds > 0) return pv(false, 0, 'loaded');
    const reloadTU = tune('TU_RELOAD', 15);
    const steps = [];
    let tu = 0;
    if (slotOfItem(u, clip) === 'ground') {
      let best = null;
      for (const s of ['L', 'R', 'belt', 'pack']) {
        if (s === wslot) continue;
        const a = { type: 'pickup', unitId: u.id, itemId: clip.id, to: s };
        const v = OV.Act.validate(V.B, a);
        if (!(v.ok || (v.reason === 'noTU' && v.tu))) continue;
        if (!best || v.tu < best.v.tu) best = { a, v };
      }
      if (!best) return pv(false, 0, 'noRoom');
      steps.push(best.a);
      tu += best.v.tu;
      const turn = OV.Act.validate(V.B, { type: 'endUnit', unitId: u.id });
      if (!turn.ok) return pv(false, 0, turn.reason);
    } else {
      const v = OV.Act.validate(V.B, { type: 'reload', unitId: u.id, hand: wslot, clipId: clip.id });
      if (!v.ok && v.reason !== 'noTU') return pv(false, 0, v.reason);
    }
    tu += reloadTU;
    steps.push({ type: 'reload', unitId: u.id, hand: wslot, clipId: clip.id });
    return tu <= (u.tu | 0) ? pv(true, tu, null, steps, { reload: true }) : pv(false, tu, 'noTU', steps, { reload: true });
  }
  function preview(src, drop) {
    const u = cur();
    if (!u || !V) return null;
    const it = itemOf(idOfKey(src));
    if (!it) return null;
    const from = slotOfItem(u, it);
    if (!from) return null;
    if (drop.startsWith('item:')) {
      const w = itemOf(idOfKey(drop));
      if (!w || w.id === it.id) return null;
      return reloadPreview(u, it, w);
    }
    const to = drop.slice(5);
    if (to === from) return null;
    if (to === 'R' || to === 'L') {
      const occ = itemOf(u.items[to]);
      // carregador sobre a arma na mão: quem responde é o próprio objeto (um só destino «recarregar»)
      if (occ && occ.id !== it.id && reloadPreview(u, it, occ)) return null;
    }
    const a = invAction(u, it, to);
    const v = OV.Act.validate(V.B, a);
    const w = OV.BUnits.weight(V.B, u);
    const dw = weightOf(it.type, it.ammo);
    const extra = { weight: from === 'ground' ? w + dw : to === 'ground' ? w - dw : w };
    // mão ocupada por arma de duas mãos: aviso de precisão
    if (v.ok && (to === 'R' || to === 'L')) {
      const other = itemOf(u.items[to === 'R' ? 'L' : 'R']);
      if (other && D().isTwoHanded(other.type)) extra.note = T('hud.inv.twoHandWarn');
      else if (D().isTwoHanded(it.type) && other) extra.note = T('hud.inv.twoHandWarn');
    }
    return pv(v.ok, v.tu | 0, v.ok ? null : v.reason, [a], extra);
  }

  // ---- execução ------------------------------------------------------------------------------------------------
  async function performOne(a) {
    if (V.opts.perform) {
      const r = await V.opts.perform(a);
      return !(r && r.ok === false);
    }
    const gen = OV.Act.perform(V.B, a);
    if (OV.Presenter && OV.Presenter.play) {
      await OV.Presenter.play(V.B, gen, { view: { cam: { x: 0, y: 0, zoom: 1 }, w: window.innerWidth, h: window.innerHeight, viewZ: 0 } });
      const res = OV.Presenter.lastResult;
      return !(res && res.ok === false);
    }
    let r = gen.next();
    while (!r.done) r = gen.next();
    return !(r.value && r.value.ok === false);
  }
  async function run(steps) {
    if (!V || V.busy || !steps || !steps.length) return false;
    const mine = V;
    mine.busy = true;
    mine.root.classList.add('busy');
    let ok = true;
    try {
      for (const a of steps) {
        const v = OV.Act.validate(mine.B, a);
        if (!v.ok) {
          sfx('ui_deny');
          OV.Dom.toast('bs.' + v.reason, null, 'warn');
          ok = false;
          break;
        }
        const done = await performOne(a);
        if (V !== mine) return false;
        if (!done) {
          ok = false;
          break;
        }
        if (mine.B.phase === 'over' || !LIVE[(cur() || {}).status]) {
          closeInv();
          return false;
        }
      }
    } catch (e) {
      console.error(e);
      ok = false;
    } finally {
      if (V === mine) {
        mine.busy = false;
        mine.root.classList.remove('busy');
        render();
      }
    }
    return ok;
  }

  // ---- construção -------------------------------------------------------------------------------------------
  function handBox(u, hand) {
    const it = itemOf(u.items[hand]);
    const box = el('div', { class: 'inv-hand' + (it ? '' : ' empty'), dataset: { drop: 'slot:' + hand } });
    box.appendChild(el('div', { class: 'inv-cap' }, el('span', { text: T('inv.' + hand) })));
    if (it) box.appendChild(tileEl(entryOf(it, isReloadable(it) ? 'item:' + it.id : null), { icon: 96, nameOn: true, big: true, cls: 'big' }));
    else {
      box.dataset.nav = '1';
      box.appendChild(el('div', { class: 'inv-empty', text: T('hud.hand.empty') }));
    }
    return box;
  }
  function strip(u, slot) {
    const items = OV.BUnits.item(V.B, u, slot);
    const cap = capOf(slot);
    let used = 0;
    for (const it of items) used += sizeOf(it.type);
    const cells = el('div', { class: 'inv-cells' });
    cells.style.setProperty('--cap', String(cap));
    for (const it of items) cells.appendChild(tileEl(entryOf(it, isReloadable(it) ? 'item:' + it.id : null), { icon: 46, cls: 'cell' }));
    for (let k = used; k < cap; k++) {
      const c = el('div', { class: 'inv-slotcell', dataset: { cell: String(k - used) } });
      if (k === used) c.dataset.nav = '1';
      cells.appendChild(c);
    }
    const box = el('div', { class: 'inv-strip ' + slot, dataset: { drop: 'slot:' + slot } },
      el('div', { class: 'inv-cap' }, el('span', { text: T('inv.' + slot) }), el('span', { class: 'inv-use' + (used >= cap ? ' full' : ''), text: T('hud.inv.units', { used, cap }) })),
      cells);
    return box;
  }
  function groundBox(u) {
    const list = groundItems(u);
    const box = el('div', { class: 'inv-ground', dataset: { drop: 'slot:ground' } });
    const capEl = el('div', { class: 'inv-cap' }, el('span', { text: T('inv.ground') }), el('span', { class: 'inv-use', text: String(list.length) }));
    if (list.length) capEl.dataset.nav = '1';
    box.appendChild(capEl);
    const scroll = el('div', { class: 'inv-ground-list' });
    if (!list.length) {
      const e = el('div', { class: 'inv-ground-empty', text: T('hud.inv.groundEmpty') });
      e.dataset.nav = '1';
      scroll.appendChild(e);
    }
    // corpos e cadáveres no fim
    list.sort((a, b) => (defOf(a.type).kind === 'corpse') - (defOf(b.type).kind === 'corpse') || a.id - b.id);
    for (const it of list) {
      const e = entryOf(it, null);
      const row = tileEl(e, { icon: 40, nameOn: true, cls: 'row' });
      row.appendChild(el('span', { class: 'inv-wt', text: T('hud.inv.wt', { n: weightOf(it.type, it.ammo) }) }));
      scroll.appendChild(row);
    }
    box.appendChild(scroll);
    return box;
  }
  function header(u) {
    const B = V.B;
    const w = OV.BUnits.weight(B, u);
    const str = u.stats.str | 0;
    const hp = V.picker && V.picker.hotP ? V.picker.hotP : null;
    const over = w > str;
    const pen = over ? (u.stats.tu | 0) - Math.floor(((u.stats.tu | 0) * Math.max(0, str)) / w) : 0;
    let wGhost = hp && hp.weight !== undefined && hp.weight !== w ? hp.weight : null;
    let note = over ? T('hud.inv.overweight', { n: pen }) : T('hud.inv.weightOk');
    if (wGhost !== null) {
      const p2 = wGhost > str ? (u.stats.tu | 0) - Math.floor(((u.stats.tu | 0) * Math.max(0, str)) / wGhost) : 0;
      note = wGhost > str ? T('hud.inv.overweightAfter', { w: wGhost, n: p2 }) : T('hud.inv.weightAfter', { w: wGhost });
    }
    const tuGhost = hp && hp.tu ? Math.max(0, (u.tu | 0) - hp.tu) : null;
    const res = reserveOf(u);
    const port = el('div', { class: 'inv-port' }, portraitCanvas(u, 64));
    const ab = rankName(u, true);
    if (ab) port.appendChild(el('span', { class: 'inv-rank r' + (u.rank | 0), text: ab }));
    const multi = invUnits().length > 1;
    const navBtn = (dir) => {
      const b = el('button', { class: 'inv-nav-b', type: 'button', html: dir < 0 ? '&#8249;' : '&#8250;', dataset: { act: dir < 0 ? 'prev' : 'next' } });
      b.disabled = !multi;
      b.addEventListener('click', () => switchUnit(dir));
      OV.Dom.tooltip(b, '<b>' + T(dir < 0 ? 'hud.inv.prev' : 'hud.inv.next') + '</b> <span class="key">' + (dir < 0 ? '⇧Tab' : 'Tab') + '</span>');
      return b;
    };
    const close = el('button', { class: 'inv-close', type: 'button', dataset: { act: 'close' } }, el('span', { text: T('hud.inv.close') }), el('span', { class: 'key', text: 'I' }));
    close.addEventListener('click', () => closeInv());
    const tuNote = hp && hp.tu && hp.ok ? T('hud.inv.tuAfter', { tu: tuGhost }) : hp && !hp.ok && hp.tu ? T('hud.inv.tuShort', { tu: hp.tu, have: u.tu | 0 }) : res > 0 ? T('hud.inv.reserve', { n: res }) : '';
    return el('div', { class: 'inv-head' },
      port,
      el('div', { class: 'inv-who' },
        el('div', { class: 'inv-title', text: T('hud.inv.title') }),
        el('div', { class: 'inv-name', text: unitName(u) }),
        el('div', { class: 'inv-sub', text: [rankName(u), u.armourId ? T('armour.' + u.armourId) : ''].filter(Boolean).join(' · ') })),
      el('div', { class: 'inv-meters' },
        meter('tu', T('hud.bar.tu.long'), u.tu | 0, u.tuMax | 0 || u.stats.tu | 0, { ghost: tuGhost, mark: res > 0 && res <= (u.tu | 0) ? res : null, note: tuNote, bad: !!(hp && !hp.ok && hp.tu) }),
        meter('wt', T('hud.inv.weightLbl'), wGhost !== null ? wGhost : w, Math.max(str, w, wGhost || 0), { text: T('hud.inv.weight', { w: wGhost !== null ? wGhost : w, str }), bad: (wGhost !== null ? wGhost : w) > str, note, mark: str })),
      el('div', { class: 'inv-navs' }, navBtn(-1), navBtn(1)),
      close);
  }
  // botões de ação do objeto selecionado
  function actionsFor(u, it) {
    const out = [];
    const d = defOf(it.type);
    const from = slotOfItem(u, it);
    const add = (key, label, steps, p, onClick) => out.push({ key, label, steps, p, onClick });
    if (isReloadable(it) && (from === 'R' || from === 'L')) {
      if (!it.ammo || it.ammo.rounds <= 0) {
        const v = OV.Act.validate(V.B, { type: 'reload', unitId: u.id, hand: from });
        if (v.ok || v.reason !== 'noWeapon') add('reload', T('hud.inv.act.reload'), [{ type: 'reload', unitId: u.id, hand: from }], pv(v.ok, v.tu | 0 || tune('TU_RELOAD', 15), v.ok ? null : v.reason));
      } else if (hasUnload()) {
        const a = { type: 'unload', unitId: u.id, hand: from };
        const v = OV.Act.validate(V.B, a);
        add('unload', T('hud.inv.act.unload'), [a], pv(v.ok, v.tu | 0, v.ok ? null : v.reason));
      }
    }
    if (d.kind === 'grenade' && d.prime && !(it.fuse >= 0)) {
      const pre = primeSteps(u, it, 0);
      add('prime', T('hud.inv.act.prime'), null, pre.p, () => { V.fusePick = it.id; render(); });
    }
    if (d.kind === 'medikit') {
      const ms = medKitMove(u, it);
      add('use', T('hud.inv.act.use'), null, ms.blocked ? pv(false, 0, null, [], { reason: T('hud.handsFull'), label: T('hud.handsFull') }) : pv(true, (ms.tu | 0) + (d.useTU || tune('TU_MEDIKIT', 10)), null), () => openMed(u.id, it.id));
    }
    if (from === 'ground') {
      let best = null;
      for (const s of ['R', 'L', 'belt', 'pack']) {
        const a = { type: 'pickup', unitId: u.id, itemId: it.id, to: s };
        const v = OV.Act.validate(V.B, a);
        if (v.ok && (!best || v.tu < best.v.tu)) best = { a, v };
        else if (!best && v.reason === 'noTU') best = best || { a, v };
      }
      if (best) add('pickup', T('hud.inv.act.pickup'), [best.a], pv(best.v.ok, best.v.tu | 0, best.v.ok ? null : best.v.reason));
      else add('pickup', T('hud.inv.act.pickup'), null, pv(false, 0, d.carry === false ? 'tooHeavy' : 'noRoom'));
    } else if (from) {
      const a = { type: 'inv', unitId: u.id, itemId: it.id, to: 'ground' };
      const v = OV.Act.validate(V.B, a);
      add('drop', T('hud.inv.act.drop'), [a], pv(v.ok, v.tu | 0, v.ok ? null : v.reason));
    }
    return out;
  }
  // ativar: a granada tem de estar na mão (passa para a mão livre se for preciso)
  function primeSteps(u, it, fuse) {
    const from = slotOfItem(u, it);
    const steps = [];
    let tu = 0;
    if (from !== 'R' && from !== 'L') {
      const h = freeHand(u);
      if (!h) return { steps: null, p: pv(false, 0, null, [], { reason: T('hud.handsFull'), label: T('hud.handsFull') }) };
      const a = invAction(u, it, h);
      const v = OV.Act.validate(V.B, a);
      if (!v.ok && v.reason !== 'noTU') return { steps: null, p: pv(false, 0, v.reason) };
      steps.push(a);
      tu += v.tu | 0;
    }
    else {
      const v = OV.Act.validate(V.B, { type: 'prime', unitId: u.id, itemId: it.id, fuse });
      if (!v.ok && v.reason !== 'noTU') return { steps: null, p: pv(false, 0, v.reason) };
    }
    const ptu = OV.BUnits.actionTU(V.B, u, it.id, 'prime') | 0;
    tu += ptu;
    steps.push({ type: 'prime', unitId: u.id, itemId: it.id, fuse });
    const turn = OV.Act.validate(V.B, { type: 'endUnit', unitId: u.id });
    if (!turn.ok) return { steps: null, p: pv(false, 0, turn.reason) };
    return { steps, p: tu <= (u.tu | 0) ? pv(true, tu, null, steps) : pv(false, tu, 'noTU', steps) };
  }
  function actButton(a) {
    const p = a.p;
    const b = el('button', { class: 'inv-act' + (p && !p.ok ? ' off' : p && p.warn ? ' warn' : ''), type: 'button', dataset: { act: a.key, nav: '1' } },
      el('span', { class: 'lbl', text: a.label }),
      p && p.label ? el('span', { class: 'cost' + (p.ok ? '' : ' bad'), text: p.label }) : null);
    b.addEventListener('click', () => {
      if (V.busy) return;
      if (p && !p.ok) {
        sfx('ui_deny');
        if (p.reason) OV.Dom.toast(p.reason, null, 'warn');
        return;
      }
      if (a.onClick) {
        sfx('ui_click');
        a.onClick();
      } else run(a.steps);
    });
    if (p && p.reason) OV.Dom.tooltip(b, '<b>' + a.label + '</b><br><span class="muted">' + p.reason + '</span>');
    return b;
  }
  function infoBox(u) {
    const box = el('div', { class: 'inv-info' });
    const selIt = itemOf(idOfKey(V.picker ? V.picker.sel : null));
    // com um objeto escolhido, o painel fica nele (as ações não fogem ao passar por outros objetos)
    const showIt = selIt || itemOf(idOfKey(V.hoverSrc));
    if (!showIt) {
      box.appendChild(el('div', { class: 'inv-hint' }, el('b', { text: T('hud.inv.howTitle') }), el('span', { text: T(isTouch() ? 'hud.inv.hint.touch' : 'hud.inv.hint') })));
      return box;
    }
    const lines = statLines(showIt.type, { B: V.B, u, it: showIt });
    const desc = el('div', { class: 'inv-desc' },
      iconCanvas(showIt.type, 56),
      el('div', { class: 'inv-desc-txt' }, el('div', { class: 'inv-desc-name', text: itemName(showIt) }), el('ul', null, lines.map((l) => el('li', { text: l })))));
    box.appendChild(desc);
    if (selIt && selIt === showIt) {
      const acts = el('div', { class: 'inv-acts' });
      if (V.fusePick === selIt.id) {
        acts.appendChild(el('div', { class: 'inv-fuse-cap', text: T('hud.inv.fuse') }));
        const row = el('div', { class: 'inv-fuse' });
        const base = primeSteps(u, selIt, 0);
        for (let f = 0; f <= tune('GRENADE_FUSE_MAX', 5); f++) {
          const b = el('button', { class: 'inv-fuse-b' + (f === 0 ? ' def' : '') + (base.p.ok ? '' : ' off'), type: 'button', text: String(f), dataset: { act: 'fuse' + f, nav: '1' } });
          b.addEventListener('click', () => primeWith(f));
          row.appendChild(b);
        }
        acts.appendChild(row);
        acts.appendChild(el('div', { class: 'inv-fuse-note' + (base.p.ok ? '' : ' bad'), text: (base.p.ok ? base.p.label : base.p.reason || base.p.label) + ' · ' + T(instantOf(V.B) ? 'hud.inv.fuseHint.instant' : 'hud.inv.fuseHint.end') }));
      } else {
        for (const a of actionsFor(u, selIt)) acts.appendChild(actButton(a));
        if (!acts.children.length) acts.appendChild(el('div', { class: 'muted', text: T('hud.inv.noActions') }));
      }
      box.appendChild(acts);
    } else if (selIt) box.appendChild(el('div', { class: 'inv-acts' }, el('div', { class: 'inv-target-hint', text: T('hud.inv.pickTarget', { item: itemName(selIt) }) })));
    return box;
  }
  function primeWith(f) {
    const u = cur();
    const it = itemOf(V.fusePick);
    if (!u || !it) return;
    const ps = primeSteps(u, it, f);
    if (!ps.p.ok) {
      sfx('ui_deny');
      if (ps.p.reason) OV.Dom.toast(ps.p.reason, null, 'warn');
      return;
    }
    V.fusePick = null;
    if (V.picker) V.picker.select(null, true);
    run(ps.steps);
  }

  function render() {
    if (!V || !V.root) return;
    if (V.mode === 'med') {
      renderMed();
      return;
    }
    const u = cur();
    if (!u || !LIVE[u.status]) {
      closeInv();
      return;
    }
    const panel = V.panel;
    // os nós vão ser substituídos: dica e passagem do rato deixam de valer
    OV.Dom.hideTooltip();
    V.hoverSrc = null;
    const scroll = panel.querySelector('.inv-ground-list');
    const top = scroll ? scroll.scrollTop : 0;
    OV.Dom.clear(panel);
    const readOnly = OV.Act.validate(V.B, { type: 'endUnit', unitId: u.id });
    panel.appendChild(header(u));
    if (!readOnly.ok) panel.appendChild(el('div', { class: 'inv-ro', text: T('hud.inv.readOnly', { why: reasonText(readOnly.reason) }) }));
    const doll = el('div', { class: 'inv-doll' },
      el('div', { class: 'inv-handsrow' }, handBox(u, 'L'), el('div', { class: 'inv-fig' }, figureCanvas(V.B, u, 176)), handBox(u, 'R')),
      strip(u, 'belt'),
      strip(u, 'pack'));
    panel.appendChild(el('div', { class: 'inv-body' }, doll, groundBox(u)));
    panel.appendChild(infoBox(u));
    const sc2 = panel.querySelector('.inv-ground-list');
    if (sc2) sc2.scrollTop = top;
    // dicas com estatísticas em cada objeto
    for (const n of panel.querySelectorAll('[data-src]')) {
      const it = itemOf(idOfKey(n.dataset.src));
      if (!it) continue;
      OV.Dom.tooltip(n, () => (V && V.picker && V.picker.sel ? '' : tipHtml(itemName(it), statLines(it.type, { B: V.B, u, it }))));
      n.addEventListener('mouseenter', () => {
        if (V && V.hoverSrc !== n.dataset.src) {
          V.hoverSrc = n.dataset.src;
          if (!V.picker.sel) refreshInfo();
        }
      });
      n.addEventListener('mouseleave', () => {
        if (V && V.hoverSrc === n.dataset.src) {
          V.hoverSrc = null;
          if (!V.picker.sel) refreshInfo();
        }
      });
    }
    if (V.picker) V.picker.decorate();
    if (V.med && V.medHost) renderMed();
    else restoreFocus(V, panel);
  }
  // só o painel de informação e o cabeçalho (pré-visualizações durante o arrasto / passagem do rato)
  function refreshInfo() {
    if (!V || V.mode !== 'inv') return;
    const u = cur();
    if (!u) return;
    const old = V.panel.querySelector('.inv-info');
    if (old) {
      const n = infoBox(u);
      old.replaceWith(n);
    }
    const head = V.panel.querySelector('.inv-head');
    if (head) head.replaceWith(header(u));
    restoreFocus(V, V.panel);
  }

  function switchUnit(dir) {
    if (!V || V.busy) return;
    const list = invUnits();
    if (list.length < 2) return;
    let k = list.findIndex((x) => x.id === V.unitId);
    k = (k + dir + list.length) % list.length;
    V.unitId = list[k].id;
    V.fusePick = null;
    V.hoverSrc = null;
    if (V.picker) V.picker.select(null, true);
    if (V.opts.select) V.opts.select(V.unitId);
    sfx('ui_select');
    render();
  }

  function keyInv(ev) {
    const key = ev.key, m = ev.mods || {};
    const lk = key.length === 1 ? key.toLowerCase() : key;
    const P = V.picker;
    if (key === 'Escape') {
      if (V.fusePick) { V.fusePick = null; render(); return true; }
      if (P.sel) { P.select(null, true); sfx('ui_click', { vol: 0.5 }); return true; }
      closeInv();
      return true;
    }
    if (lk === 'i') { closeInv(); return true; }
    if (V.busy) return true;
    const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (dirs[key]) {
      V.kbd = true;
      const n = navMove(V.panel, V.focusEl, dirs[key]);
      setFocus(V, n);
      if (P.sel && n) P.setHotNode(n);
      if (n && n.dataset.src) {
        V.hoverSrc = P.sel ? null : n.dataset.src;
        if (!P.sel) refreshInfo();
      }
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      V.kbd = true;
      if (document.activeElement && V.root.contains(document.activeElement)) document.activeElement.blur();
      if (!V.focusEl || !V.panel.contains(V.focusEl)) {
        setFocus(V, navTargets(V.panel)[0] || null);
        return true;
      }
      if (V.focusEl.tagName === 'BUTTON') V.focusEl.click();
      else P.activate(V.focusEl, true);
      return true;
    }
    if (key === 'Tab') { switchUnit(m.shift ? -1 : 1); return true; }
    if (V.fusePick) {
      const dm = /^Digit(\d)$/.exec(ev.code || '') || /^Numpad(\d)$/.exec(ev.code || '');
      if (dm && +dm[1] <= tune('GRENADE_FUSE_MAX', 5)) { primeWith(+dm[1]); return true; }
    }
    const selIt = itemOf(idOfKey(P.sel || (V.focusEl && V.focusEl.dataset.src)));
    const u = cur();
    if ((key === 'Backspace' || key === 'Delete') && selIt && u) {
      const a = actionsFor(u, selIt).find((x) => x.key === 'drop');
      if (a) {
        if (!a.p.ok) { sfx('ui_deny'); if (a.p.reason) OV.Dom.toast(a.p.reason, null, 'warn'); } else { P.select(null, true); run(a.steps); }
      }
      return true;
    }
    if (lk === 'r' && u) {
      const hand = selIt && (slotOfItem(u, selIt) === 'R' || slotOfItem(u, selIt) === 'L') && isReloadable(selIt) ? slotOfItem(u, selIt) : ['R', 'L'].find((h) => isReloadable(itemOf(u.items[h])) && !(itemOf(u.items[h]).ammo && itemOf(u.items[h]).ammo.rounds > 0));
      if (!hand) { OV.Dom.toast('hud.noReload', null, 'info'); return true; }
      const a = { type: 'reload', unitId: u.id, hand };
      const v = OV.Act.validate(V.B, a);
      if (!v.ok) { sfx('ui_deny'); OV.Dom.toast('bs.' + v.reason, null, 'warn'); } else { P.select(null, true); run([a]); }
      return true;
    }
    return !!(m.meta || m.ctrl) ? false : true;
  }

  /* =============================================================================================================
     Kit médico
     ============================================================================================================= */
  // posição do paciente (unidade ativa ou corpo inconsciente no chão)
  function patientRect(t) {
    if (t.onMap && t.x >= 0 && LIVE[t.status]) return { x: t.x, y: t.y, z: t.z, size: t.size || 1 };
    if (t.status !== 'out') return null;
    const body = V.B.items.find((it) => it.unitId === t.id && it.at !== null && it.at !== undefined);
    if (!body) return null;
    const m = V.B.map, plane = m.w * m.h;
    const z = (body.at / plane) | 0, r = body.at - z * plane;
    return { x: r % m.w, y: (r / m.w) | 0, z, size: 1 };
  }
  function patients(u) {
    const out = [];
    for (const t of V.B.units) {
      if (t.status === 'dead') continue;
      if (t !== u && !(t.origSide === 'xcom' || t.side === 'xcom' || t.side === 'civ')) continue;
      const r = t === u ? { x: u.x, y: u.y, z: u.z, size: 1 } : patientRect(t);
      if (!r || r.z !== u.z) continue;
      const gx = Math.max(0, r.x - u.x, u.x - (r.x + r.size - 1)), gy = Math.max(0, r.y - u.y, u.y - (r.y + r.size - 1));
      if (Math.max(gx, gy) > 1) continue;
      out.push(t);
    }
    const woundsOf = (t) => (t.wounds || []).reduce((s, w) => s + (w | 0), 0);
    out.sort((a, b) => (a === u ? -1 : b === u ? 1 : woundsOf(b) - woundsOf(a) || a.id - b.id));
    return out;
  }
  function findKit(u, kitId) {
    const own = (it) => it && defOf(it.type) && defOf(it.type).kind === 'medikit' && OV.BUnits.slotOf(u, it.id);
    if (kitId !== undefined && kitId !== null && own(itemOf(kitId))) return itemOf(kitId);
    for (const s of ['R', 'L']) if (own(itemOf(u.items[s]))) return itemOf(u.items[s]);
    for (const s of ['belt', 'pack']) {
      const k = OV.BUnits.item(V.B, u, s).find(own);
      if (k) return k;
    }
    return null;
  }
  // passo para pôr o kit na mão (se ainda não estiver)
  function medKitMove(u, kit) {
    const s = OV.BUnits.slotOf(u, kit.id);
    if (s === 'R' || s === 'L') return { steps: [], tu: 0 };
    const h = freeHand(u);
    if (!h) return { blocked: true, steps: [], tu: 0 };
    const a = { type: 'inv', unitId: u.id, itemId: kit.id, to: h };
    const v = OV.Act.validate(V.B, a);
    return { steps: [a], tu: v.tu | 0, hand: h, v };
  }
  // pré-visualização de um tratamento
  function medPreview(u, kit, t, kind, part) {
    const d = defOf(kit.type);
    const mv = medKitMove(u, kit);
    if (mv.blocked) return pv(false, 0, null, [], { reason: T('hud.handsFull'), label: T('hud.handsFull') });
    if (mv.v && !mv.v.ok && mv.v.reason !== 'noTU') return pv(false, 0, mv.v.reason);
    const useTU = d.useTU || tune('TU_MEDIKIT', 10);
    const a = { type: 'medikit', unitId: u.id, targetId: t.id, kind, part: kind === 'heal' ? part : null, itemId: kit.id };
    const steps = mv.steps.concat([a]);
    if (!mv.steps.length) {
      const v = OV.Act.validate(V.B, a);
      if (!v.ok) return pv(false, v.tu | 0, v.reason, steps);
      return pv(true, v.tu | 0, null, steps);
    }
    // kit ainda fora da mão: as mesmas regras verificadas à mão
    if (!kit.charges || !(kit.charges[kind] > 0)) return pv(false, 0, 'noCharges');
    if (kind === 'heal' && !(part >= 0 && t.wounds[part] > 0)) return pv(false, 0, 'noWound');
    const turn = OV.Act.validate(V.B, { type: 'endUnit', unitId: u.id });
    if (!turn.ok) return pv(false, 0, turn.reason);
    const tu = mv.tu + useTU;
    return tu <= (u.tu | 0) ? pv(true, tu, null, steps) : pv(false, tu, 'noTU', steps);
  }

  // diagrama do corpo (vista de frente: o lado direito do paciente fica à esquerda do ecrã)
  const BODY = [
    { p: 0, d: 'M60 8a17 18 0 1 1-0.1 0z', lx: 60, ly: 27 },
    { p: 1, d: 'M40 50h40q6 0 7 7l3 58q0 6-6 6H36q-6 0-6-6l3-58q1-7 7-7z', lx: 60, ly: 86 },
    { p: 2, d: 'M31 54q-8 1-10 9l-9 52q-1 7 5 8l5 1q5 0 6-6l8-48z', lx: 18, ly: 92 },
    { p: 3, d: 'M89 54q8 1 10 9l9 52q1 7-5 8l-5 1q-5 0-6-6l-8-48z', lx: 102, ly: 92 },
    { p: 4, d: 'M36 125h22l-2 86q0 6-6 6h-7q-6 0-6-6z', lx: 46, ly: 170 },
    { p: 5, d: 'M62 125h22l-1 86q0 6-6 6h-7q-6 0-6-6z', lx: 74, ly: 170 },
  ];
  function bodySvg(t, part) {
    let s = '<svg class="medk-svg" viewBox="0 0 120 224" role="group" aria-label="' + T('hud.medk.body') + '">';
    s += '<defs><radialGradient id="medkW" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#ff6a5c"/><stop offset="1" stop-color="#8a1a14"/></radialGradient></defs>';
    for (const b of BODY) {
      const w = t.wounds[b.p] | 0;
      const cls = 'medk-part' + (w > 0 ? ' hurt' : '') + (b.p === part ? ' sel' : '') + (w >= 3 ? ' bad' : '');
      s += '<g class="' + cls + '" data-part="' + b.p + '" data-nav="1"><path d="' + b.d + '"/>';
      if (w > 0) s += '<circle class="medk-dot" cx="' + b.lx + '" cy="' + b.ly + '" r="8.5"/><text x="' + b.lx + '" y="' + (b.ly + 3.6) + '">' + w + '</text>';
      s += '</g>';
    }
    return s + '</svg>';
  }
  function openMed(unitId, kitId) {
    if (!V) return;
    const u = unitOf(unitId);
    const kit = findKit(u, kitId);
    if (!kit) {
      sfx('ui_deny');
      OV.Dom.toast('hud.medk.noKit', null, 'warn');
      return;
    }
    if (V.picker) V.picker.select(null, true);
    V.med = { kitId: kit.id, patientId: u.id, part: null };
    sfx('ui_click');
    if (V.mode === 'inv') {
      V.root.classList.add('med-open');
      V.medHost = el('div', { class: 'medk-back' });
      V.medHost.addEventListener('pointerdown', (e) => { if (e.target === V.medHost) closeMed(); });
      V.root.appendChild(V.medHost);
    }
    renderMed();
  }
  function closeMed() {
    if (!V) return;
    if (V.mode === 'med') {
      closeInv();
      return;
    }
    V.med = null;
    if (V.medHost) V.medHost.remove();
    V.medHost = null;
    V.root.classList.remove('med-open');
    sfx('ui_click', { vol: 0.5 });
    render();
  }
  function renderMed() {
    if (!V || !V.med) return;
    const host = V.mode === 'med' ? V.panel : V.medHost;
    const u = cur();
    const kit = u ? findKit(u, V.med.kitId) : null;
    if (!u || !LIVE[u.status] || !kit) {
      closeMed();
      return;
    }
    V.med.kitId = kit.id;
    const list = patients(u);
    let t = list.find((x) => x.id === V.med.patientId) || list[0] || u;
    V.med.patientId = t.id;
    const wounded = [0, 1, 2, 3, 4, 5].filter((p) => (t.wounds[p] | 0) > 0);
    // parte escolhida à mão (setas ↑/↓, clique) fica; sem escolha (ou curada) → a 1.ª ferida
    if (V.med.part === null || (!V.med.pinned && !(t.wounds[V.med.part] > 0))) {
      V.med.part = wounded.length ? wounded[0] : null;
      V.med.pinned = false;
    }
    const part = V.med.part;
    // botão com o foco real (Tab, clique): volta a tê-lo depois de redesenhar
    const fa = document.activeElement;
    if (fa && host.contains(fa) && fa.tagName === 'BUTTON') V.medFocus = medKey(fa);
    OV.Dom.hideTooltip();
    OV.Dom.clear(host);
    const card = V.mode === 'med' ? host : el('div', { class: 'medk panel' });
    if (V.mode !== 'med') host.appendChild(card);
    const closeB = el('button', { class: 'inv-close', type: 'button', dataset: { act: 'medclose' } }, el('span', { text: T(V.mode === 'med' ? 'hud.inv.close' : 'hud.medk.back') }), el('span', { class: 'key', text: 'Esc' }));
    closeB.addEventListener('click', () => closeMed());
    const ch = kit.charges || {};
    card.appendChild(el('div', { class: 'medk-head' },
      iconCanvas(kit.type, 40),
      el('div', { class: 'medk-ttl' }, el('div', { class: 'inv-title', text: T('hud.medk.title') }), el('div', { class: 'inv-name', text: T('hud.medk.user', { name: unitName(u), tu: u.tu | 0 }) })),
      closeB));
    // pacientes
    const plist = el('div', { class: 'medk-pats', role: 'listbox', 'aria-label': T('hud.medk.patients') });
    for (const p of list) {
      const w = (p.wounds || []).reduce((s, x) => s + (x | 0), 0);
      const b = el('button', { class: 'medk-pat' + (p.id === t.id ? ' on' : '') + (w ? ' hurt' : ''), type: 'button', dataset: { pid: String(p.id), nav: '1' } },
        el('span', { class: 'nm', text: p === u ? T('hud.medk.self', { name: unitName(p) }) : unitName(p) }),
        el('span', { class: 'st', text: (p.status === 'out' ? T('hud.medk.out') + ' · ' : '') + T('hud.medk.hp', { hp: Math.max(0, p.hp | 0), max: p.hpMax | 0 }) }),
        w ? el('span', { class: 'wd', text: String(w) }) : null);
      b.setAttribute('aria-pressed', p.id === t.id ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (!V || !V.med) return;
        V.med.patientId = p.id;
        V.med.part = null;
        V.med.pinned = false;
        sfx('ui_click');
        renderMed();
      });
      plist.appendChild(b);
    }
    if (!list.length) plist.appendChild(el('div', { class: 'muted', text: T('hud.medk.none') }));
    card.appendChild(plist);
    // corpo + estado + tratamentos
    const fig = el('div', { class: 'medk-fig', html: bodySvg(t, part) });
    fig.addEventListener('click', (e) => {
      const g = e.target.closest && e.target.closest('[data-part]');
      if (!g || !V || !V.med) return;
      V.med.part = +g.dataset.part;
      V.med.pinned = true;
      sfx('ui_click');
      renderMed();
    });
    const partList = el('div', { class: 'medk-parts' });
    for (let p = 0; p < PARTS; p++) {
      const w = t.wounds[p] | 0;
      const b = el('button', { class: 'medk-pb' + (w ? ' hurt' : '') + (p === part ? ' on' : ''), type: 'button', dataset: { part: String(p) },
        'aria-pressed': p === part ? 'true' : 'false', 'aria-label': Tn(p === part ? 'hud.medk.partSel' : 'hud.medk.partBtn', w, { part: T('hud.medk.part.' + p) }) },
        el('span', { text: T('hud.medk.part.' + p) }), el('b', { text: String(w) }));
      b.addEventListener('click', () => {
        V.med.part = p;
        V.med.pinned = true;
        sfx('ui_click');
        renderMed();
      });
      partList.appendChild(b);
    }
    const total = wounded.reduce((s, p) => s + (t.wounds[p] | 0), 0);
    const stunPct = t.hpMax > 0 ? Math.max(0, Math.min(100, (Math.min(t.stun | 0, Math.max(0, t.hp)) / t.hpMax) * 100)) : 0;
    const hpBar = meter('hp', T('hud.bar.hp.long'), Math.max(0, t.hp | 0), t.hpMax | 0, { note: (t.stun | 0) > 0 ? T('hud.stun', { n: t.stun | 0 }) : null });
    if (stunPct > 0) hpBar.querySelector('.inv-meter-bar').appendChild(el('b', { class: 'stun', style: { width: stunPct.toFixed(1) + '%' } }));
    const stats = el('div', { class: 'medk-stats' },
      el('div', { class: 'medk-pname', text: unitName(t) + (t.status === 'out' ? ' · ' + T('hud.medk.out') : '') }),
      hpBar,
      meter('en', T('hud.bar.en.long'), t.energy | 0, t.energyMax | 0 || t.stats.sta | 0),
      meter('mo', T('hud.bar.mo.long'), t.morale | 0, 100),
      el('div', { class: 'medk-wounds' + (total ? ' bad' : ''), text: total ? Tn('hud.medk.wounds', total) + ' · ' + T('hud.medk.bleed', { n: total }) : T('hud.medk.noWounds') }));
    const treat = el('div', { class: 'medk-treat' });
    const painGain = Math.max(0, Math.min(100 - (t.morale | 0), ((t.stats.hp | 0) - (t.hp | 0)) - (t.moraleRestored | 0)));
    const kinds = [
      { kind: 'heal', key: '1', fx: part !== null ? T('hud.medk.heal.fx', { part: T('hud.medk.part.' + part), hp: defOf(kit.type).healHP || tune('MEDIKIT_HEAL_HP', 3) }) : T('hud.medk.pickPart') },
      { kind: 'stim', key: '2', fx: T('hud.medk.stim.fx', { en: defOf(kit.type).stimEnergy || tune('MEDIKIT_STIM_ENERGY', 10), st: defOf(kit.type).stimStun || tune('MEDIKIT_STIM_STUN', 4) }) },
      { kind: 'pain', key: '3', fx: painGain > 0 ? T('hud.medk.pain.fx', { n: painGain }) : T('hud.medk.pain.none') },
    ];
    for (const k of kinds) {
      const p = medPreview(u, kit, t, k.kind, part);
      // impossível por um motivo (não por UT): o motivo vai por baixo do título, a coluna do custo fica com «—»
      const why = !p.ok && p.reason && p.label === p.reason;
      const b = el('button', { class: 'medk-b ' + k.kind + (p.ok ? (p.warn ? ' warn' : '') : ' off'), type: 'button', dataset: { act: 'med-' + k.kind, nav: '1' } },
        el('span', { class: 'key', text: k.key }),
        el('span', { class: 'medk-b-txt' }, el('b', { text: T('bs.action.' + k.kind) }), el('small', { class: why ? 'bad' : '', text: why ? p.reason : k.fx })),
        el('span', { class: 'medk-b-ch', text: Tn('hud.medk.charges', ch[k.kind] | 0) }),
        el('span', { class: 'cost' + (p.ok ? '' : ' bad'), text: why ? '—' : p.label || '' }));
      if (p.reason) OV.Dom.tooltip(b, '<b>' + T('bs.action.' + k.kind) + '</b><br><span class="muted">' + p.reason + '</span>');
      b.addEventListener('click', () => doMed(k.kind));
      treat.appendChild(b);
    }
    const mv = medKitMove(u, kit);
    if (mv.steps.length) treat.appendChild(el('div', { class: 'medk-move', text: T('hud.medk.takeKit', { hand: T('inv.' + mv.hand).toLowerCase(), tu: mv.tu }) }));
    else if (mv.blocked) treat.appendChild(el('div', { class: 'medk-move bad', text: T('hud.handsFull') }));
    card.appendChild(el('div', { class: 'medk-main' }, el('div', { class: 'medk-left' }, fig, partList), el('div', { class: 'medk-right' }, stats, treat)));
    // as teclas do painel, à vista (no toque: a sequência de toques)
    const touchUI = isTouch() || (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches);
    card.appendChild(el('div', { class: 'medk-keys', text: T(touchUI ? 'hud.medk.keys.touch' : 'hud.medk.keys') }));
    if (V.medFlash) {
      const f = card.querySelector('.medk-' + V.medFlash);
      if (f) f.classList.add('flash');
      V.medFlash = null;
    }
    restoreFocus(V, card);
    medRefocus(card);
  }
  async function doMed(kind) {
    if (!V || !V.med || V.busy) return;
    const u = cur();
    const kit = findKit(u, V.med.kitId);
    const t = unitOf(V.med.patientId);
    if (!u || !kit || !t) return;
    const p = medPreview(u, kit, t, kind, V.med.part);
    if (!p.ok) {
      sfx('ui_deny');
      if (p.reason) OV.Dom.toast(p.reason, null, 'warn');
      return;
    }
    V.medFlash = kind === 'heal' ? 'fig' : 'stats';
    // curada a parte escolhida, o painel passa à ferida seguinte
    if (kind === 'heal') V.med.pinned = false;
    await run(p.steps);
  }
  /* teclado do kit médico, como o painel se vê: ←/→ mudam de ferido (a fila de pacientes é horizontal), ↑/↓ de
     parte do corpo (a lista é vertical); 1/2/3 tratam; Tab / ⇧Tab percorrem os botões do painel (foco real, preso
     no painel) e Enter/Espaço ativam o botão com foco — sem foco num botão, Enter cura a parte escolhida. */
  const MED_PARTS = [0, 1, 2, 3, 4, 5];
  function keyMed(ev) {
    const key = ev.key;
    const lk = key.length === 1 ? key.toLowerCase() : key;
    if (key === 'Escape' || (lk === 'i' && V.mode === 'med')) { closeMed(); return true; }
    if (lk === 'i') { closeInv(); return true; }
    const host = V.mode === 'med' ? V.panel : V.medHost;
    const btns = host ? Array.from(host.querySelectorAll('button')).filter((b) => !b.disabled && b.offsetParent !== null) : [];
    const act = document.activeElement;
    if (key === 'Tab') {
      if (!btns.length) return true;
      const k = btns.indexOf(act);
      const dir = ev.mods && ev.mods.shift ? -1 : 1;
      const n = btns[k < 0 ? (dir > 0 ? 0 : btns.length - 1) : (k + dir + btns.length) % btns.length];
      n.focus({ preventScroll: true });
      n.scrollIntoView({ block: 'nearest' });
      V.medFocus = medKey(n);
      return true;
    }
    if ((key === 'Enter' || key === ' ') && act && btns.indexOf(act) >= 0) return false;
    if (V.busy) return true;
    const code = ev.code || '';
    const dm = /^(?:Digit|Numpad)([1-3])$/.exec(code);
    if (dm) { doMed(['heal', 'stim', 'pain'][+dm[1] - 1]); return true; }
    const u = cur();
    if (!u) return true;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const list = patients(u);
      if (list.length > 1) {
        let k = list.findIndex((x) => x.id === V.med.patientId);
        k = (k + (key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
        V.med.patientId = list[k].id;
        V.med.part = null;
        V.med.pinned = false;
        V.medFocus = 'pid:' + list[k].id;
        if (act && act.blur) act.blur();
        sfx('ui_click');
        renderMed();
      } else sfx('ui_deny', { vol: 0.5 });
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      let k = MED_PARTS.indexOf(V.med.part);
      k = k < 0 ? 0 : (k + (key === 'ArrowDown' ? 1 : -1) + MED_PARTS.length) % MED_PARTS.length;
      V.med.part = MED_PARTS[k];
      V.med.pinned = true;
      V.medFocus = 'part:' + V.med.part;
      if (act && act.blur) act.blur();
      sfx('ui_click', { vol: 0.5 });
      renderMed();
      return true;
    }
    if (key === 'Enter' || key === ' ') { doMed('heal'); return true; }
    return true;
  }
  // chave estável de um botão do painel (para lhe devolver o foco depois de redesenhar)
  const medKey = (n) => (n.dataset.pid ? 'pid:' + n.dataset.pid : n.dataset.part ? 'part:' + n.dataset.part : n.dataset.act ? 'act:' + n.dataset.act : null);
  // depois de redesenhar o painel: o foco real volta ao mesmo botão (paciente, parte ou tratamento)
  function medRefocus(card) {
    const k = V && V.medFocus;
    if (!k) return;
    const [kind, v] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    const sel = kind === 'pid' ? '[data-pid="' + v + '"]' : kind === 'part' ? '.medk-pb[data-part="' + v + '"]' : '[data-act="' + v + '"]';
    const n = card.querySelector(sel);
    if (n) n.focus({ preventScroll: true });
  }

  /* =============================================================================================================
     Cena
     ============================================================================================================= */
  function closeInv() {
    if (!V) return;
    const top = OV.Scenes.top();
    if (top && top === V.scene) OV.Scenes.pop();
    else if (V.scene && V.scene.exit) {
      const i = OV.Scenes.stack.indexOf(V.scene);
      if (i >= 0) OV.Scenes.stack.splice(i, 1);
      V.scene.exit();
    }
  }

  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.inventory = function (params) {
    const p = params || {};
    const sc = { id: 'inventory', isScreen: false };
    sc.enter = function () {
      const B = p.B || (OV.Game && OV.Game.B);
      V = {
        scene: sc, B, unitId: p.unitId, opts: p, mode: p.mode === 'med' ? 'med' : 'inv', root: null, panel: null, picker: null,
        hoverSrc: null, fusePick: null, med: null, medHost: null, busy: false, kbd: false, focusEl: null, focusKey: null, resolve: p._resolve || null,
      };
      const root = el('div', { class: 'inv-root' + (V.mode === 'med' ? ' only-med' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': T(V.mode === 'med' ? 'hud.medk.title' : 'hud.inv.title') });
      const panel = el('div', { class: V.mode === 'med' ? 'medk panel solo' : 'inv-panel panel' });
      root.appendChild(panel);
      V.root = root;
      V.panel = panel;
      document.getElementById('hud').appendChild(root);
      root.addEventListener('pointermove', (e) => {
        if (V && V.kbd && e.pointerType !== 'touch' && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 2) {
          V.kbd = false;
          if (V.focusEl) V.focusEl.classList.remove('kfocus');
        }
      });
      if (V.mode === 'inv') {
        V.picker = makePicker(panel, {
          preview,
          canPick: (src) => !!itemOf(idOfKey(src)),
          busy: () => !V || V.busy || !!V.med,
          commit: (src, drop, pp) => run(pp.steps),
          changed: (sel) => {
            if (!V) return;
            if (sel && V.fusePick && V.fusePick !== idOfKey(sel)) V.fusePick = null;
            if (sel) V.hoverSrc = null;
            refreshInfo();
          },
          background: () => {},
        });
        root.addEventListener('pointerdown', (e) => {
          if (e.target === root && V && !V.busy && !V.med) {
            if (V.picker.sel) V.picker.select(null, true);
            else closeInv();
          }
        });
        sfx('ui_click');
        render();
        if (p.medkit) openMed(V.unitId, p.medkit === true ? null : p.medkit);
      } else {
        root.addEventListener('pointerdown', (e) => { if (e.target === root && V && !V.busy) closeInv(); });
        const u = cur();
        const kit = u ? findKit(u, p.itemId) : null;
        V.med = { kitId: kit ? kit.id : null, patientId: p.targetId !== undefined ? p.targetId : u ? u.id : null, part: null };
        sfx('ui_click');
        renderMed();
      }
    };
    sc.exit = function () {
      if (!V || V.scene !== sc) return;
      const done = V;
      if (done.picker) done.picker.destroy();
      if (done.root && done.root.parentNode) done.root.parentNode.removeChild(done.root);
      OV.Dom.hideTooltip();
      V = null;
      sfx('ui_click', { vol: 0.5 });
      if (done.opts.onClose) done.opts.onClose();
      if (done.resolve) done.resolve();
    };
    sc.pause = function () { if (V && V.root) V.root.classList.add('hidden'); };
    sc.resume = function () {
      if (!V || !V.root) return;
      V.root.classList.remove('hidden');
      render();
    };
    sc.think = function (dt) {
      // o mapa continua vivo por baixo (partículas do apresentador)
      if (OV.FX && OV.FX.update) OV.FX.update(dt * (OV.Presenter && OV.Presenter.playing ? OV.Presenter.timeScale() : 1));
    };
    sc.draw = function () {};
    sc.onInput = function (ev) {
      if (!V) return false;
      if (ev.kind === 'key') {
        if (OV.Presenter && OV.Presenter.playing && ev.key === ' ') { OV.Presenter.hurry(); return true; }
        return V.med ? keyMed(ev) : keyInv(ev);
      }
      return ev.kind !== 'keyup';
    };
    sc.onResize = function () { if (V) (V.med && V.mode === 'med' ? renderMed : render)(); };
    return sc;
  };

  function openScene(B, unitId, opts) {
    return new Promise((resolve) => {
      if (V) closeInv();
      const u = B ? OV.BUnits.findUnit(B, unitId) : null;
      if (!B || !u || !LIVE[u.status] || u.side !== 'xcom') {
        sfx('ui_deny');
        OV.Dom.toast('hud.inv.cantOpen', null, 'info');
        resolve();
        return;
      }
      OV.Scenes.push('inventory', Object.assign({}, opts || {}, { B, unitId, _resolve: resolve }));
    });
  }

  /* =============================================================================================================
     Ecrã «Equipar» (antes da missão; sem UT; reserva = armazém)
     ============================================================================================================= */
  const EQ_GROUPS = [
    ['weapon', (d) => d.kind === 'firearm' || d.kind === 'melee'],
    ['ammo', (d) => d.kind === 'ammo'],
    ['explosive', (d) => d.kind === 'grenade'],
    ['gear', (d) => d.kind === 'medikit' || d.kind === 'scanner' || d.kind === 'flare' || d.kind === 'psiamp'],
  ];
  const emptyLo = () => ({ R: null, L: null, belt: [], pack: [] });
  // botões do equipamento: [comando, chave de texto, tecla]
  const EQ_CMDS = [['copy', 'hud.equip.copy', 'C'], ['paste', 'hud.equip.paste', 'V'], ['auto', 'hud.equip.auto', 'A'], ['clear', 'hud.equip.clear', 'X']];
  function reduceMotion() {
    const v = ((OV.Game && OV.Game.settings) || {}).reduceMotion || 'auto';
    if (v === 'on' || v === true) return true;
    if (v === 'off' || v === false) return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  const cloneLo = (lo) => ({ R: (lo && lo.R) || null, L: (lo && lo.L) || null, belt: ((lo && lo.belt) || []).slice(), pack: ((lo && lo.pack) || []).slice() });
  const equipable = (type) => {
    const d = defOf(type);
    return !!d && !d.fixed && d.battle !== false && d.carry !== false && d.kind !== 'corpse' && d.kind !== 'armour' && !(d.kind || '').startsWith('craft');
  };
  function loTypes(lo) {
    const out = [];
    for (const s of SLOT_ORDER) {
      if (s === 'R' || s === 'L') { if (lo[s]) out.push(lo[s]); } else out.push(...lo[s]);
    }
    return out;
  }
  const loWeight = (lo) => loTypes(lo).reduce((s, t) => s + weightOf(t, null), 0);
  // o motor recusa usar o que não foi investigado (OV.Act: notResearched); researched = lista de G (null = tudo)
  const knownTo = (researched) => (type) => {
    const d = defOf(type);
    return !Array.isArray(researched) || !d || !d.research || researched.indexOf(d.research) >= 0;
  };
  // preferência de armas: as pesadas (≥ 16 de peso) só para os mais fortes da equipa
  const GUN_PREF = ['plasma_rifle', 'heavy_plasma', 'laser_rifle', 'rifle', 'plasma_pistol', 'laser_pistol', 'pistol',
    'heavy_laser', 'auto_cannon', 'heavy_cannon', 'rocket_launcher', 'blaster_launcher', 'small_launcher'];
  /* Auto-equipar um soldado (puro; tira do armazém `stores`, que muda). o = {night, researched, squad}.
     Só armas investigadas e com munição no armazém, cujo peso com um carregador caiba na Força; munição no cinto
     ou, se não couber (foguetes), na mochila — o motor carrega a arma no início da missão; granadas e sinalizador
     só se o peso continuar dentro da Força; kit médico para o soldado com mais saúde (ou para quem já o levava:
     o.keepMed). → loadout */
  function autoLoadout(s, stores, o) {
    const opt = o || {};
    const known = knownTo(opt.researched);
    const str = (s.stats && s.stats.str) | 0;
    const lo = emptyLo();
    let w = 0;
    const have = (t) => (stores[t] | 0) > 0 && known(t);
    const take = (t) => {
      if (!have(t)) return false;
      stores[t]--;
      return true;
    };
    const place = (t) => {
      // o carregador que entra na arma não ocupa espaço (ver inWeapon)
      for (const slot of ['belt', 'pack']) {
        lo[slot].push(t);
        if (slotFits(lo, slot) && take(t)) {
          w += weightOf(t, null);
          return true;
        }
        lo[slot].pop();
      }
      return false;
    };
    const squad = opt.squad || [s];
    const strs = squad.map((x) => (x.stats && x.stats.str) | 0).sort((a, b) => b - a);
    const strong = strs.length < 3 || str >= strs[Math.max(0, Math.ceil(strs.length / 3) - 1)];
    const clipsFor = (gd) => (Array.isArray(gd.ammo) ? gd.ammo.filter(have) : []);
    const firearms = Object.keys(stores).filter((t) => have(t) && defOf(t) && defOf(t).kind === 'firearm' && equipable(t));
    const order = GUN_PREF.filter((t) => firearms.indexOf(t) >= 0).concat(firearms.filter((t) => GUN_PREF.indexOf(t) < 0));
    const usable = (t) => {
      const gd = defOf(t);
      const needs = Array.isArray(gd.ammo) && gd.ammo.length;
      const clips = clipsFor(gd);
      if (needs && !clips.length) return false;
      return (gd.weight | 0) + (needs ? weightOf(clips[0], null) : 0) <= str;
    };
    let gun = order.find((t) => usable(t) && (strong || (defOf(t).weight | 0) < 16)) || null;
    // ninguém aguenta nada com munição: a arma mais leve que dispare
    if (!gun) gun = order.filter((t) => { const gd = defOf(t); return !(Array.isArray(gd.ammo) && gd.ammo.length) || clipsFor(gd).length; })
      .sort((a, b) => (defOf(a).weight | 0) - (defOf(b).weight | 0))[0] || null;
    if (gun && take(gun)) {
      lo.R = gun;
      w += weightOf(gun, null);
      const gd = defOf(gun);
      for (let n = 0; n < 2; n++) {
        const c = clipsFor(gd)[0];
        if (!c || (n > 0 && w + weightOf(c, null) > str)) break;
        if (!place(c)) break;
      }
    }
    for (let n = 0; n < 2; n++) {
      const g = ['grenade', 'alien_grenade'].find(have);
      if (!g || w + weightOf(g, null) > str || !place(g)) break;
    }
    if (opt.night && have('electro_flare') && w + weightOf('electro_flare', null) <= str) place('electro_flare');
    const best = squad.slice().sort((a, b) => ((b.stats && b.stats.hp) | 0) - ((a.stats && a.stats.hp) | 0))[0];
    if ((opt.keepMed || (best && best.id === s.id)) && have('medikit') && w + weightOf('medikit', null) <= str && D().fitsSlot('medikit', 'pack', visibleIn(lo, 'pack')) && take('medikit')) {
      lo.pack.push('medikit');
      w += weightOf('medikit', null);
    }
    return settleOrder(lo);
  }

  // equipamento com uma arma de fogo que dispara: sem carregadores ou com carregador próprio na mochila/cinto
  function armedLo(lo) {
    for (const h of ['R', 'L']) {
      const gd = lo && lo[h] ? defOf(lo[h]) : null;
      if (!gd || gd.kind !== 'firearm') continue;
      if (!(Array.isArray(gd.ammo) && gd.ammo.length)) return true;
      if (['belt', 'pack'].some((sl) => (lo[sl] || []).some((t) => gd.ammo.indexOf(t) >= 0))) return true;
    }
    return false;
  }

  /* que carregador vai para dentro de cada arma no início da missão — a mesma escolha de OV.BUnits.autoLoad (mão
     direita e depois a esquerda; o 1.º carregador compatível do cinto e depois da mochila). → {R, L}: {slot, k, type}|null */
  function loadPlan(lo) {
    const used = { belt: new Set(), pack: new Set() };
    const out = { R: null, L: null };
    for (const h of ['R', 'L']) {
      const gd = lo && lo[h] ? defOf(lo[h]) : null;
      if (!gd || gd.kind !== 'firearm' || !Array.isArray(gd.ammo) || !gd.ammo.length) continue;
      for (const sl of ['belt', 'pack']) {
        const k = ((lo && lo[sl]) || []).findIndex((t, j) => !used[sl].has(j) && gd.ammo.indexOf(t) >= 0);
        if (k >= 0) {
          used[sl].add(k);
          out[h] = { slot: sl, k, type: lo[sl][k] };
          break;
        }
      }
    }
    return out;
  }
  /* O carregador «na arma» (loadPlan) continua na lista do cinto/mochila do equipamento — é dali que o motor o tira
     para a arma no início da missão — mas não ocupa espaço: o cinto do «Equipar» é o cinto do combate. */
  function inWeapon(lo) {
    const plan = loadPlan(lo);
    const out = { belt: new Set(), pack: new Set() };
    for (const h of ['R', 'L']) if (plan[h]) out[plan[h].slot].add(plan[h].k);
    return out;
  }
  // tipos que ocupam o compartimento (sem os carregadores que vão dentro das armas)
  function visibleIn(lo, slot) {
    const iw = inWeapon(lo)[slot];
    return ((lo && lo[slot]) || []).filter((_, k) => !iw.has(k));
  }
  // o que ocupa o compartimento cabe nele?
  function slotFits(lo, slot) {
    const acc = [];
    for (const t of visibleIn(lo, slot)) {
      if (!D().fitsSlot(t, slot, acc)) return false;
      acc.push(t);
    }
    return true;
  }
  /* ordem guardada: o carregador «na arma» que é o único compatível do cinto vai para o fim da lista. O motor põe o
     cinto pela ordem e manda o que não cabe para a mochila, de onde autoLoad o tira na mesma — assim o cinto do
     combate fica igual ao do ecrã mesmo cheio (não muda a escolha de loadPlan). */
  function settleOrder(lo) {
    const plan = loadPlan(lo);
    for (const h of ['R', 'L']) {
      const p = plan[h];
      if (!p || p.slot !== 'belt') continue;
      const gd = defOf(lo[h]);
      const others = lo.belt.some((t, j) => j !== p.k && gd.ammo.indexOf(t) >= 0);
      if (!others) lo.belt.push(lo.belt.splice(p.k, 1)[0]);
    }
    return lo;
  }
  /* mover um objeto no «Equipar» (pura). from = 'stores' | 'R' | 'L' | 'belt' | 'pack' (k = índice na lista), to =
     'stores' | compartimento. Munição largada numa arma ocupada carrega-a (ou fica de reserva no cinto/mochila); uma
     arma que sai das mãos para o armazém leva o carregador que tinha dentro; um carregador que deixa de estar «na
     arma» e já não cabe volta ao armazém. → {ok, lo, back:[tipos para o armazém], label?: 'load'|'spare'|'stores'} |
     {ok:false, reason: 'occupied'|'noFit'|'tooBig'} */
  function eqMove(lo0, from, k, type, to) {
    if (!lo0 || !type || to === from) return { ok: false, reason: 'same' };
    const before = loadPlan(lo0);
    const lo = cloneLo(lo0);
    if (from === 'R' || from === 'L') lo[from] = null;
    else if (from !== 'stores') lo[from].splice(k, 1);
    const back = [];
    let label = null;
    // carregadores que estavam dentro de uma arma e deixaram de estar (a arma saiu da mão)
    const freed = () => {
      const now = loadPlan(lo);
      const out = [];
      for (const h of ['R', 'L']) {
        const b = before[h];
        if (!b) continue;
        const still = ['R', 'L'].some((x) => now[x] && now[x].type === b.type && now[x].slot === b.slot);
        if (!still) out.push(b);
      }
      return out;
    };
    const dropFreed = (all) => {
      for (const b of freed()) {
        if (!all && slotFits(lo, b.slot)) continue;
        // tira um exemplar desse tipo que esteja à vista no compartimento (o último)
        const iw = inWeapon(lo)[b.slot];
        let j = -1;
        for (let x = lo[b.slot].length - 1; x >= 0 && j < 0; x--) if (lo[b.slot][x] === b.type && !iw.has(x)) j = x;
        if (j < 0) continue;
        lo[b.slot].splice(j, 1);
        back.push(b.type);
      }
    };
    if (to === 'stores') {
      back.push(type);
      label = 'stores';
      // a arma volta ao armazém com o carregador que tinha dentro
      if (from === 'R' || from === 'L') dropFreed(true);
      return { ok: true, lo: settleOrder(lo), back, label };
    }
    if (to === 'R' || to === 'L') {
      if (lo[to]) {
        const gd = defOf(lo[to]), d = defOf(type);
        if (!gd || !d || d.kind !== 'ammo' || !Array.isArray(gd.ammo) || gd.ammo.indexOf(type) < 0) return { ok: false, reason: 'occupied' };
        if (!loadPlan(lo)[to]) {
          // arma vazia: o carregador vai para dentro dela (não ocupa espaço)
          lo.belt.push(type);
          label = 'load';
        } else {
          let put = null;
          for (const sl of ['belt', 'pack']) {
            lo[sl].push(type);
            if (slotFits(lo, sl)) { put = sl; break; }
            lo[sl].pop();
          }
          if (!put) return { ok: false, reason: 'noFit' };
          label = 'spare';
        }
      } else {
        if (!equipable(type)) return { ok: false, reason: 'noFit' };
        lo[to] = type;
      }
      dropFreed(false);
      return { ok: true, lo: settleOrder(lo), back, label };
    }
    if (!lo[to]) return { ok: false, reason: 'noFit' };
    const d = defOf(type);
    if (!d || (d.size || 1) > (D().invSlots[to].maxSize | 0)) return { ok: false, reason: 'tooBig' };
    if (!D().fitsSlot(type, to, [])) return { ok: false, reason: 'noFit' };
    lo[to].push(type);
    dropFreed(false);
    if (!slotFits(lo, to)) return { ok: false, reason: 'noFit' };
    return { ok: true, lo: settleOrder(lo), back, label };
  }

  function equipScreen(container, options) {
    const o = options || {};
    const squad = (o.squad || []).slice();
    // investigação da campanha (o motor recusa o resto): opção explícita ou a campanha aberta
    // researched: null explícito = tudo conhecido (Batalha Rápida); sem a opção, a campanha aberta (compatibilidade)
    const researched = Array.isArray(o.researched) ? o.researched : 'researched' in o ? null : OV.Game && OV.Game.G && Array.isArray(OV.Game.G.researched) ? OV.Game.G.researched : null;
    const known = knownTo(researched);
    const E = {
      loadouts: {}, stores: {}, selId: o.selectedId !== undefined ? o.selectedId : squad.length ? squad[0].id : null, clip: null,
      hoverSrc: null, kbd: false, focusEl: null, focusKey: null,
    };
    for (const s of squad) E.loadouts[s.id] = settleOrder(cloneLo(s.loadout));
    for (const k of Object.keys(o.stores || {})) if ((o.stores[k] | 0) > 0) E.stores[k] = o.stores[k] | 0;
    // raiz = contentor de consultas (@container eq): o arranjo segue a largura disponível, não a do ecrã
    const root = el('div', { class: 'inv-equip' });
    container.appendChild(root);
    const soldier = () => squad.find((s) => s.id === E.selId) || null;
    const lo = () => E.loadouts[E.selId];
    const emit = () => { if (o.onChange) o.onChange(stateOf()); };
    function stateOf() {
      const out = { loadouts: {}, stores: {} };
      for (const id of Object.keys(E.loadouts)) out.loadouts[id] = cloneLo(E.loadouts[id]);
      for (const k of Object.keys(E.stores)) if (E.stores[k] > 0) out.stores[k] = E.stores[k];
      return out;
    }
    const take = (type) => {
      if (!(E.stores[type] > 0)) return false;
      E.stores[type]--;
      return true;
    };
    const give = (type) => { E.stores[type] = (E.stores[type] | 0) + 1; };
    // fonte: 'st:<tipo>' (armazém) ou 'lo:<slot>:<índice>'
    function srcType(src) {
      if (!src) return null;
      if (src.startsWith('st:')) return src.slice(3);
      const [, slot, k] = src.split(':');
      const l = lo();
      if (!l || !(slot in l)) return null;
      return slot === 'R' || slot === 'L' ? l[slot] : l[slot][+k] || null;
    }
    // origem do objeto escolhido → [compartimento, índice]
    function srcSlot(src) {
      if (src.startsWith('st:')) return ['stores', -1];
      const [, slot, k] = src.split(':');
      return [slot, +k];
    }
    function eqPreview(src, drop) {
      const type = srcType(src);
      if (!type || !lo()) return null;
      const to = drop.slice(5);
      const [from, k] = srcSlot(src);
      if (to === from) return null;
      const r = eqMove(lo(), from, k, type, to);
      if (r.ok) return { ok: true, label: r.label === 'stores' ? T('hud.equip.toStores') : r.label ? T('hud.equip.' + r.label) : '' };
      if (r.reason === 'occupied') return { ok: false, label: T('hud.inv.occupied'), reason: T('bs.slotFull') };
      return { ok: false, label: T('hud.inv.noFit'), reason: r.reason === 'tooBig' ? T('hud.equip.tooBig', { slot: T('inv.' + to) }) : T('bs.noRoom') };
    }
    function eqCommit(src, drop) {
      const type = srcType(src);
      const to = drop.slice(5);
      if (!type || !lo()) return;
      const [from, k] = srcSlot(src);
      const r = eqMove(lo(), from, k, type, to);
      if (!r.ok) return;
      if (from === 'stores' && !take(type)) return;
      E.loadouts[E.selId] = r.lo;
      for (const t of r.back) give(t);
      // a arma saiu da mão para o cinto/mochila e o carregador que tinha dentro já não coube: voltou ao armazém
      if (to !== 'stores' && r.back.length) OV.Dom.toast(OV.Tn('hud.equip.clipBack', r.back.length), null, 'info');
      sfx('ui_click');
      emit();
      draw();
    }
    const picker = makePicker(root, {
      preview: eqPreview,
      canPick: (src) => !!srcType(src),
      busy: () => false,
      commit: eqCommit,
      changed: () => drawInfo(),
      background: () => {},
    });

    // keepMed: quem já levava o kit médico continua a levá-lo (o AUTO-EQUIPAR não o tira)
    function autoFor(s, keepMed) {
      return autoLoadout(s, E.stores, { night: !!o.night, researched, squad, keepMed: !!keepMed });
    }
    function emptyInto(id) {
      for (const t of loTypes(E.loadouts[id])) give(t);
      E.loadouts[id] = emptyLo();
    }
    function cmd(kind) {
      const s = soldier();
      if (!s) return;
      if (kind === 'copy') {
        E.clip = cloneLo(lo());
        OV.Dom.toast('hud.equip.copied', { name: s.name || '' }, 'info');
        sfx('ui_click');
      } else if (kind === 'paste') {
        if (!E.clip) return;
        emptyInto(s.id);
        const l = emptyLo();
        let missing = 0;
        for (const slot of SLOT_ORDER) {
          const list = slot === 'R' || slot === 'L' ? (E.clip[slot] ? [E.clip[slot]] : []) : E.clip[slot];
          for (const t of list) {
            if (!take(t)) { missing++; continue; }
            if (slot === 'R' || slot === 'L') l[slot] = t;
            else l[slot].push(t);
          }
        }
        E.loadouts[s.id] = settleOrder(l);
        if (missing) OV.Dom.toast(Tn('hud.equip.missing', missing), null, 'warn');
        sfx('ui_confirm');
        emit();
      } else if (kind === 'auto') {
        const hadMed = loTypes(E.loadouts[s.id] || emptyLo()).indexOf('medikit') >= 0;
        emptyInto(s.id);
        E.loadouts[s.id] = autoFor(s, hadMed);
        // sem arma que dispare (ou sem munição para ela): dizer onde se compra em vez de deixar o soldado desarmado
        if (!armedLo(E.loadouts[s.id])) {
          sfx('ui_deny');
          OV.Dom.toast(isTouch() ? 'hud.equip.noWeapons.touch' : 'hud.equip.noWeapons', null, 'warn');
        } else sfx('ui_confirm');
        emit();
      } else if (kind === 'clear') {
        emptyInto(s.id);
        sfx('ui_click');
        emit();
      }
      draw();
    }
    function eqTile(src, type, o2) {
      const t = tileEl({ src, type, name: T(defOf(type).nameKey), count: o2.count, ammo: o2.ammo }, o2);
      // por investigar: o motor recusa usá-lo em combate
      if (!known(type)) {
        t.classList.add('unk');
        t.appendChild(el('span', { class: 'inv-unk', text: T(o2.cls === 'row' ? 'hud.equip.unknown' : 'hud.equip.unknown.short') }));
      }
      return t;
    }
    const eqStatLines = (type, s) => {
      const lines = statLines(type, { str: s && s.stats ? s.stats.str : 0 });
      if (!known(type)) lines.unshift(T('hud.equip.unknown.tip'));
      return lines;
    };
    function drawInfo() {
      const box = root.querySelector('.inv-info');
      if (!box) return;
      const nb = infoFor();
      box.replaceWith(nb);
    }
    function infoFor() {
      const box = el('div', { class: 'inv-info eq' });
      const type = srcType(picker.sel || E.hoverSrc || '') || null;
      const s = soldier();
      if (!type) {
        /* ajuda inteira e, para janelas baixas (CSS: max-height 640 px), uma versão curta em 2 linhas que se lê toda
           (a inteira fica na dica do nó) */
        const full = T(isTouch() ? 'hud.equip.hint.touch' : 'hud.equip.hint');
        box.appendChild(el('div', { class: 'inv-hint', title: full }, el('b', { text: T('hud.equip.title') }),
          el('span', { class: 'inv-hint-long', text: full }), el('span', { class: 'inv-hint-short', text: T(isTouch() ? 'hud.equip.hint.short.touch' : 'hud.equip.hint.short') })));
        return box;
      }
      box.appendChild(el('div', { class: 'inv-desc' }, iconCanvas(type, 56),
        el('div', { class: 'inv-desc-txt' }, el('div', { class: 'inv-desc-name', text: T(defOf(type).nameKey) }),
          el('ul', null, eqStatLines(type, s).map((l) => el('li', { text: l }))))));
      if (picker.sel) box.appendChild(el('div', { class: 'inv-acts' }, el('div', { class: 'inv-target-hint', text: T('hud.inv.pickTarget', { item: T(defOf(type).nameKey) }) })));
      return box;
    }
    function draw() {
      const s = soldier();
      OV.Dom.hideTooltip();
      E.hoverSrc = null;
      const scroll = root.querySelector('.eq-stores-list');
      const top = scroll ? scroll.scrollTop : 0;
      OV.Dom.clear(root);
      E.focusEl = null;
      const grid = el('div', { class: 'eq-grid' });
      root.appendChild(grid);
      root.classList.toggle('rm', reduceMotion());
      // equipa
      const list = el('div', { class: 'eq-squad' });
      for (const x of squad) {
        const l = E.loadouts[x.id];
        const w = loWeight(l), str = (x.stats && x.stats.str) | 0;
        const b = el('button', { class: 'eq-sol' + (x.id === E.selId ? ' on' : ''), type: 'button', dataset: { sid: String(x.id) } },
          portraitCanvas({ portraitSeed: x.portraitSeed, female: x.female, nat: x.nat, armourId: x.armour, rank: x.rank, type: 'soldier' }, 34),
          el('span', { class: 'eq-sol-txt' }, el('b', { text: x.name || '' }), el('small', { text: rankName({ rank: x.rank, type: 'soldier' }) })),
          l.R ? iconCanvas(l.R, 30) : el('span', { class: 'eq-sol-none' }),
          el('span', { class: 'eq-sol-w' + (w > str ? ' bad' : ''), text: w + '/' + str }));
        b.addEventListener('click', () => { E.selId = x.id; picker.select(null, true); sfx('ui_select'); draw(); });
        list.appendChild(b);
      }
      // boneco
      const doll = el('div', { class: 'inv-doll' });
      if (s) {
        const l = lo();
        const w = loWeight(l), str = (s.stats && s.stats.str) | 0;
        const head = el('div', { class: 'inv-head eq' },
          el('div', { class: 'inv-port' }, portraitCanvas({ portraitSeed: s.portraitSeed, female: s.female, nat: s.nat, armourId: s.armour, rank: s.rank, type: 'soldier' }, 56)),
          el('div', { class: 'inv-who' }, el('div', { class: 'inv-title', text: T('hud.equip.title') }), el('div', { class: 'inv-name', text: s.name || '' }),
            el('div', { class: 'inv-sub', text: [rankName({ rank: s.rank, type: 'soldier' }), s.armour ? T('armour.' + s.armour) : ''].filter(Boolean).join(' · ') })),
          el('div', { class: 'inv-meters' }, meter('wt', T('hud.inv.weightLbl'), w, Math.max(str, w), { text: T('hud.inv.weight', { w, str }), bad: w > str, mark: str, note: w > str ? T('hud.equip.overweight') : T('hud.inv.weightOk') })));
        const btns = el('div', { class: 'eq-btns' });
        for (const [k, lbl, key] of EQ_CMDS) {
          const b = el('button', { class: 'btn small', type: 'button', text: T(lbl), dataset: { act: k, nav: '1' }, 'aria-label': T(lbl) + ' (' + key + ')' });
          if (k === 'paste' && !E.clip) b.disabled = true;
          b.addEventListener('click', () => cmd(k));
          OV.Dom.tooltip(b, () => '<b>' + T(lbl) + '</b> <span class="key">' + key + '</span><br><span class="muted">' + T(lbl + '.tip') + '</span>');
          btns.appendChild(b);
        }
        head.appendChild(btns);
        doll.appendChild(head);
        /* a arma parte carregada com o 1.º carregador compatível: indicador «20/20» na mão; esse carregador vai dentro
           dela e não aparece nem conta no cinto/mochila (como no inventário de combate) */
        const plan = loadPlan(l);
        const iw = inWeapon(l);
        const hand = (h) => {
          const box = el('div', { class: 'inv-hand' + (l[h] ? '' : ' empty'), dataset: { drop: 'slot:' + h } }, el('div', { class: 'inv-cap' }, el('span', { text: T('inv.' + h) })));
          const gd = l[h] ? defOf(l[h]) : null;
          const needs = !!gd && gd.kind === 'firearm' && Array.isArray(gd.ammo) && gd.ammo.length > 0;
          const ammo = !needs ? undefined : plan[h] ? { type: plan[h].type, rounds: (defOf(plan[h].type) || {}).rounds | 0 } : null;
          if (l[h]) {
            const tile = eqTile('lo:' + h + ':0', l[h], { icon: 96, nameOn: true, big: true, cls: 'big', ammo });
            if (plan[h]) {
              tile.classList.add('inweapon');
              tile.dataset.clip = plan[h].type;
            }
            box.appendChild(tile);
          }
          else {
            box.dataset.nav = '1';
            box.appendChild(el('div', { class: 'inv-empty', text: T('hud.hand.empty') }));
          }
          return box;
        };
        const fig = el('div', { class: 'inv-fig' }, figureCanvas(null, { sprite: 'soldier', items: {}, armourId: s.armour, portraitSeed: s.portraitSeed, female: s.female, rank: s.rank, side: 'xcom' }, 150));
        doll.appendChild(el('div', { class: 'inv-handsrow' }, hand('L'), fig, hand('R')));
        for (const slot of ['belt', 'pack']) {
          const cap = capOf(slot);
          let used = 0;
          const cells = el('div', { class: 'inv-cells' });
          cells.style.setProperty('--cap', String(cap));
          l[slot].forEach((t, k) => {
            if (iw[slot].has(k)) return;
            used += sizeOf(t);
            cells.appendChild(eqTile('lo:' + slot + ':' + k, t, { icon: 46, cls: 'cell' }));
          });
          for (let k = used; k < cap; k++) {
            const c = el('div', { class: 'inv-slotcell' });
            if (k === used) c.dataset.nav = '1';
            cells.appendChild(c);
          }
          doll.appendChild(el('div', { class: 'inv-strip ' + slot, dataset: { drop: 'slot:' + slot } },
            el('div', { class: 'inv-cap' }, el('span', { text: T('inv.' + slot) }), el('span', { class: 'inv-use' + (used >= cap ? ' full' : ''), text: T('hud.inv.units', { used, cap }) })),
            cells));
        }
      }
      // armazém
      const stores = el('div', { class: 'inv-ground eq-stores', dataset: { drop: 'slot:stores' } },
        el('div', { class: 'inv-cap', dataset: { nav: '1' } }, el('span', { text: T('hud.equip.stores') })));
      const sl = el('div', { class: 'inv-ground-list eq-stores-list' });
      let any = false;
      for (const [g, test] of EQ_GROUPS) {
        const types = Object.keys(E.stores).filter((t) => E.stores[t] > 0 && equipable(t) && test(defOf(t))).sort((a, b) => T(defOf(a).nameKey).localeCompare(T(defOf(b).nameKey), 'pt'));
        if (!types.length) continue;
        any = true;
        sl.appendChild(el('div', { class: 'eq-group', text: T('hud.equip.group.' + g) }));
        for (const t of types) {
          const row = eqTile('st:' + t, t, { icon: 36, nameOn: true, cls: 'row', count: E.stores[t] });
          row.appendChild(el('span', { class: 'inv-wt', text: T('hud.inv.wt', { n: weightOf(t, null) }) }));
          sl.appendChild(row);
        }
      }
      if (!any) sl.appendChild(el('div', { class: 'inv-ground-empty', text: T('hud.equip.storesEmpty') }));
      stores.appendChild(sl);
      grid.append(list, el('div', { class: 'eq-main' }, el('div', { class: 'inv-body' }, doll, stores), infoFor()));
      const sc = root.querySelector('.eq-stores-list');
      if (sc) sc.scrollTop = top;
      if (E.kbd) restoreFocus(E, root);
      for (const n of root.querySelectorAll('[data-src]')) {
        const type = srcType(n.dataset.src);
        if (!type) continue;
        const extra = n.dataset.clip ? T('hud.equip.inWeapon.tip', { clip: T(defOf(n.dataset.clip).nameKey) }) : n.querySelector('.inv-badge.ammo.empty') ? T('hud.equip.noAmmo.tip') : null;
        OV.Dom.tooltip(n, () => (picker.sel ? '' : tipHtml(T(defOf(type).nameKey), extra ? [extra].concat(eqStatLines(type, s)) : eqStatLines(type, s))));
        n.addEventListener('mouseenter', () => { E.hoverSrc = n.dataset.src; drawInfo(); });
        n.addEventListener('mouseleave', () => { if (E.hoverSrc === n.dataset.src) { E.hoverSrc = null; drawInfo(); } });
      }
      picker.decorate();
    }
    /* teclado (foco virtual como no inventário de batalha): setas movem o foco entre objetos, compartimentos e
       armazém; Enter/Espaço apanha e pousa; ⌫ devolve ao armazém; Tab / 1–0 muda de soldado; C V A X = Copiar,
       Colar, Auto-equipar, Esvaziar; Esc larga o objeto escolhido. Ouve em captura para chegar antes do ecrã que
       o contém (base, briefing); Enter só é tomado com a navegação por teclado ativa. */
    function selectSol(id) {
      E.selId = id;
      picker.select(null, true);
      sfx('ui_select');
      draw();
    }
    function onKeyDown(e) {
      if (!root.isConnected || (OV.Dom.anyModalOpen && OV.Dom.anyModalOpen()) || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key, lk = key.length === 1 ? key.toLowerCase() : key;
      const eat = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[key]) {
        eat();
        E.kbd = true;
        const n = navMove(root, E.focusEl, dirs[key]);
        setFocus(E, n);
        if (picker.sel && n) picker.setHotNode(n);
        if (n && n.dataset.src && !picker.sel) {
          E.hoverSrc = n.dataset.src;
          drawInfo();
        }
        return;
      }
      if ((key === 'Enter' || key === ' ') && E.kbd && E.focusEl && root.contains(E.focusEl)) {
        eat();
        if (e.repeat) return;
        if (E.focusEl.tagName === 'BUTTON') E.focusEl.click();
        else picker.activate(E.focusEl, true);
        return;
      }
      if (key === 'Escape' && picker.sel) {
        eat();
        picker.select(null, true);
        sfx('ui_click', { vol: 0.5 });
        return;
      }
      if (e.repeat) return;
      if (key === 'Tab' && squad.length) {
        eat();
        const k = squad.findIndex((x) => x.id === E.selId);
        selectSol(squad[(k + (e.shiftKey ? squad.length - 1 : 1) + squad.length) % squad.length].id);
        return;
      }
      if (/^[0-9]$/.test(key) && !e.shiftKey) {
        eat();
        const x = squad[key === '0' ? 9 : +key - 1];
        if (x) selectSol(x.id);
        return;
      }
      // ⌫ devolve ao armazém o objeto escolhido (rato, toque ou teclado) ou, sem escolha, o que tem o foco do teclado
      if (key === 'Backspace' || key === 'Delete') {
        const fsrc = E.kbd && E.focusEl && root.contains(E.focusEl) ? E.focusEl.dataset.src : null;
        const src = picker.sel ? picker.sel : fsrc;
        if (src && src.startsWith('lo:')) {
          eat();
          picker.select(null, true);
          eqCommit(src, 'slot:stores');
          return;
        }
      }
      const c = EQ_CMDS.find((x) => x[2].toLowerCase() === lk);
      if (c) {
        eat();
        cmd(c[0]);
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointermove', (e) => {
      if (E.kbd && e.pointerType !== 'touch' && Math.abs(e.movementX) + Math.abs(e.movementY) > 2) {
        E.kbd = false;
        if (E.focusEl) E.focusEl.classList.remove('kfocus');
      }
    });
    draw();
    return {
      root,
      state: stateOf,
      select(id) { if (squad.some((x) => x.id === id)) { E.selId = id; picker.select(null, true); draw(); } },
      refresh: draw,
      destroy() {
        window.removeEventListener('keydown', onKeyDown, true);
        picker.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  // ---- API pública --------------------------------------------------------------------------------------------
  OV.InventoryUI = {
    open(B, unitId, opts) {
      return openScene(B, unitId, Object.assign({}, opts || {}, { mode: 'inv' }));
    },
    medikit(B, unitId, itemId, opts) {
      return openScene(B, unitId, Object.assign({}, opts || {}, { mode: 'med', itemId }));
    },
    close: closeInv,
    isOpen: () => !!V,
    refresh() { if (V) render(); },
    equipScreen,
    model: { autoLoadout, armedLo, loadPlan, inWeapon, visibleIn, eqMove, settleOrder, navPick },
    debug: {
      state() {
        if (!V) return { open: false };
        const u = cur();
        const ids = (s) => (u ? OV.BUnits.item(V.B, u, s) : []).map((it) => ({ id: it.id, type: it.type, ammo: it.ammo ? it.ammo.rounds : null, fuse: it.fuse }));
        const one = (h) => { const it = u ? itemOf(u.items[h]) : null; return it ? { id: it.id, type: it.type, ammo: it.ammo ? it.ammo.rounds : null, fuse: it.fuse } : null; };
        return {
          open: true, mode: V.mode, unitId: V.unitId, busy: V.busy, selected: V.picker ? V.picker.sel : null, hot: V.picker ? V.picker.hot : null,
          hotLabel: V.picker && V.picker.hotP ? V.picker.hotP.label : null, fusePick: V.fusePick,
          tu: u ? u.tu : null, weight: u ? OV.BUnits.weight(V.B, u) : null, str: u ? u.stats.str : null,
          R: one('R'), L: one('L'), belt: ids('belt'), pack: ids('pack'),
          ground: u ? groundItems(u).map((it) => ({ id: it.id, type: it.type })) : [],
          med: V.med ? { kitId: V.med.kitId, patientId: V.med.patientId, part: V.med.part } : null,
        };
      },
    },
  };
})(globalThis.OV || (globalThis.OV = {}));
