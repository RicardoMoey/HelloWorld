/* Fluxo da campanha (docs/CAMPAIGN_API.md §6; DESIGN.md §12–§14, §18): nova campanha com colocação da base no globo,
   briefing com passo «Equipar», batalha com gravação automática por turno, relatório da missão da campanha, relatório
   mensal, fim de jogo, vitória e diálogo de gravar/carregar. Só altera G através de OV.Campaign / OV.Save.
   Cenas: newgame {} · cbriefing {G, siteRef, craftId, mission} · equip {G, craftId, onDone?} · cdebrief {G, B, model,
   onDone} · monthReport {G, report} · gameOver {G, reason} · victory {G} · saveload {G?, mode:'save'|'load'} ·
   campaignHub {G} (substituto enquanto o Geoscape não existir).
   OV.CampaignUI = {
     newGame() ; launchMission(G, siteRef, craftId) → bool ; startBattle(mission, meta) → bool
     afterBattle(G, B, result) (uma só vez por batalha) ; resume({G, B}) → bool ; openGeo(G) ; popToGeo(G)
     equip(G, craftId, onDone?) ; monthReport(G, report) → Promise ; gameOver(G, reason) ; victory(G)
     baseDefence(G, ev) → Promise (resultado de um ataque à base) ; saveDialog(G) ; loadDialog()
     autosave(G, {silent?}) → {ok, reason?} ; saveLabel(G) → texto ; errText(err) → texto
     launchCydonia(G, craftId?) → Promise(bool)   confirmação «sem regresso» e briefing da missão final
     cydoniaState(G, craftId) → {ok, reason} ; cydoniaPick(G, baseId?) → {ok, reason, craftId} ; cydoniaWhy(reason) → texto
     cydoniaCapable(craft) → bool ; monthAlienSplit(G, report) → [{key, n?, pts}] ; fundingTotals(report) → {before, delta, after}
     debug.newgame() → {step, diff, chosen, name, view} | null   (QA)
     Equipa (puras sobre G, só via BaseSim/Campaign): armedLo(lo) → bool ; idleFit(G, baseId) → [ids] ;
       unarmedAboard(G, craftId) → [ids] ; boardAll(G, craftId) → [ids embarcados] ;
       autoKit(G, craftId, {all?}) → {ok, equipped, unarmed, reason?} ; crewUp(G, craftId) → {boarded, equipped, unarmed} ;
       crewText(G, craftId, r) → texto ; starterKit(G, baseId, n) → {items:[{id,n}], cost} ;
       buyStarterKit(G, baseId, kit) → {ok, reason?, cost, eta} ; orderStarterKit(G, baseId, n) → Promise(bool) (diálogo)
     Gravações extra da interface: EXTRA_SLOTS ['auto2','preMission'] (rodam com a automática; «Antes da missão» ao abrir
       o briefing) ; saveBeforeMission(G, siteRef, craftId) ; preMissionFor(G, startedT) → {siteRef, craftId}|null ;
       retryMission(G, pm) ; extraSummary(slot) ; loadExtra(slot) → {G, B, meta} ; markUfoKnown(G, ufoId) }
   Atalhos: ver as dicas de cada botão (tooltip com a tecla). */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  const Tn = (k, n, p) => OV.Tn(k, n, p);
  const el = (...a) => OV.Dom.el(...a);
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const SUI = () => OV.Screens.ui;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const esc = (s) => OV.U.esc(String(s));
  const money = (n) => OV.U.fmtMoney(n | 0);
  const signed = (n) => (n > 0 ? '+' : '') + OV.U.fmtInt(n | 0);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const uiRng = OV.RNG.create((Date.now() ^ 0x0c4a7e15) >>> 0);
  const settings = () => (OV.Game && OV.Game.settings) || {};
  const LISBON = { lon: -9.14, lat: 38.72 };
  const NG_KEY = 'ovni1999.newgame';

  function sfx(name) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name); } catch (e) { /* som opcional */ }
  }
  function music(mood) {
    try { if (OV.audio && OV.audio.music) OV.audio.music(mood); } catch (e) { /* idem */ }
  }
  function stinger(name) {
    try { if (OV.audio && OV.audio.stinger) OV.audio.stinger(name); } catch (e) { /* idem */ }
  }
  function lsGet(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* modo privado */ }
  }

  // ---- textos e nomes ---------------------------------------------------------------------------------------
  // Error('campaign.err.x' | 'save.err.x') → texto pt-PT
  function errText(e) {
    const msg = e && e.message ? e.message : String(e || '');
    if (OV.T.has(msg)) return T(msg);
    return T('cp.err.generic', { msg });
  }
  const writeText = (reason) => (OV.T.has('save.write.' + reason) ? T('save.write.' + reason) : OV.T.has('save.err.' + reason) ? T('save.err.' + reason) : T('cp.err.generic', { msg: reason }));
  const baseName = (b) => (b && b.name ? b.name : T('base.defaultName'));
  function craftName(craft) {
    if (!craft) return '—';
    if (craft.name) return craft.name;
    const def = D().crafts[craft.type];
    return T('craft.instance', { type: def ? T(def.nameKey) : craft.type, n: craft.num | 0 });
  }
  const dateText = (t, withTime) => OV.U.fmtDate(t | 0, withTime);
  const monthTitle = (y, m) => T('cp.monthYear', { month: T('cp.month.' + m), y });
  function saveLabel(G) {
    const d = OV.U.dateOf(G.t | 0);
    return T('cp.save.label', { month: T('cp.month.' + d.m), y: d.y, base: baseName(G.bases[0]) });
  }
  function battleLabel(G, B) {
    const M = B.mission || {};
    return T('cp.save.labelBattle', { kind: T('bs.mission.' + (M.kind || 'crash')), turn: B.turn | 0 });
  }
  function tipHtml(title, key, extra) {
    let h = '<b>' + esc(title) + '</b>';
    if (key) h += ' <span class="key">' + esc(key) + '</span>';
    if (extra) h += '<br><span class="muted">' + esc(extra) + '</span>';
    return h;
  }
  // botão com dica (tecla incluída) e rótulo acessível
  function btn(label, o) {
    const opts = o || {};
    const b = el('button', { type: 'button', class: 'btn ' + (opts.cls || ''), dataset: opts.data || null }, label);
    if (opts.key) b.setAttribute('aria-keyshortcuts', opts.key);
    b.addEventListener('click', (e) => {
      if (b.disabled) return;
      if (opts.sound !== false) sfx(opts.sound || 'ui_click');
      if (opts.onClick) opts.onClick(e);
    });
    OV.Dom.tooltip(b, () => tipHtml(opts.tip || label, opts.key, opts.extra));
    if (opts.disabled) b.disabled = true;
    return b;
  }
  const kv = (k, v, cls) => el('div', { class: 'cp-kv' + (cls ? ' ' + cls : '') }, el('span', { class: 'cp-k', text: k }), el('b', { class: 'cp-v', text: v }));
  // ajuda com variante de toque (iPad): «Toque…» em vez de «Clique…»
  const touchT = (k, p) => (((OV.Input && OV.Input.lastPointerType === 'touch') || (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches)) && OV.T.has(k + '.touch') ? T(k + '.touch', p) : T(k, p));
  const activeIsButtonIn = (root) => {
    const a = document.activeElement;
    return !!a && a !== document.body && !!root && root.contains(a) && (a.tagName === 'BUTTON' || a.tagName === 'INPUT' || a.tagName === 'A');
  };

  // ================================================================================================
  // Equipa da nave: embarcar os aptos, equipar com o armazém e o kit básico (caminho guiado depois de perder a nave)
  // Funções puras sobre G (só mudam G através de OV.BaseSim.assignSoldier, OV.Campaign.applyEquip e OV.BaseSim.buy).
  // ================================================================================================
  const HANGAR_ST = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  const isTransport = (c) => !!c && !!D().crafts[c.type] && (D().crafts[c.type].seatsUI | 0) > 0;
  const craftHome = (G, c) => { const b = c ? C().findBase(G, c.baseId) : null; return !!b && !!HANGAR_ST[c.status] && b.crafts.indexOf(c.id) >= 0; };
  const WEAPON_KINDS = { firearm: 1, melee: 1 };
  // o soldado leva uma arma numa das mãos?
  function armedLo(lo) {
    const isW = (id) => !!id && !!D().items[id] && !!WEAPON_KINDS[D().items[id].kind];
    return !!lo && (isW(lo.R) || isW(lo.L));
  }
  // soldados aptos da base sem lugar numa nave
  function idleFit(G, baseId) {
    const b = C().findBase(G, baseId);
    if (!b) return [];
    return b.soldiers.filter((id) => { const s = C().findSoldier(G, id); return s && !s.craftId && !(s.woundDays > 0); });
  }
  // soldados a bordo sem arma nas mãos
  function unarmedAboard(G, craftId) {
    const c = C().findCraft(G, craftId);
    if (!c) return [];
    return c.soldiers.filter((id) => { const s = C().findSoldier(G, id); return s && !armedLo(s.loadout); });
  }
  // embarca os soldados aptos sem nave (os de patente mais alta primeiro) até encher os lugares → [ids]
  function boardAll(G, craftId) {
    const c = C().findCraft(G, craftId);
    if (!c || !isTransport(c) || !craftHome(G, c) || !OV.BaseSim) return [];
    const max = D().crafts[c.type].seatsUI | 0;
    const list = idleFit(G, c.baseId).map((id) => C().findSoldier(G, id)).sort((a, b) => (b.rank - a.rank) || (a.hiredT | 0) - (b.hiredT | 0));
    const out = [];
    for (const s of list) {
      if (c.soldiers.length >= max) break;
      const r = OV.BaseSim.assignSoldier(G, s.id, c.id);
      if (r && r.ok !== false) out.push(s.id);
    }
    return out;
  }
  const PREF_GUNS = ['heavy_plasma', 'plasma_rifle', 'laser_rifle', 'rifle', 'plasma_pistol', 'laser_pistol', 'pistol'];
  // o motor recusa disparar armas por investigar: o equipamento automático nunca as escolhe
  const usable = (G, id) => { const it = D().items[id]; return !!it && it.battle !== false && (!it.research || G.researched.indexOf(it.research) >= 0); };
  const weightOf = (id) => (D().items[id] && D().items[id].weight) | 0;
  /* Equipa automaticamente quem está a bordo sem arma (ou todos com all:true) com o que há na nave e, no hangar, no
     armazém: a melhor arma utilizável que a Força aguenta com munição, 2 carregadores, 1 granada e um kit médico para a
     equipa. → {equipped, unarmed, ok, reason} (unarmed = a bordo ainda sem arma). */
  function autoKit(G, craftId, o) {
    const opts = o || {};
    const c = C().findCraft(G, craftId);
    if (!c) return { ok: false, reason: 'noCraft', equipped: 0, unarmed: 0 };
    let pool;
    try { pool = C().equipPool(G, craftId); } catch (e) { return { ok: false, reason: 'noCraft', equipped: 0, unarmed: 0 }; }
    const st = Object.assign({}, pool.stores);
    const take = (id) => { if ((st[id] | 0) > 0) { st[id]--; if (!st[id]) delete st[id]; return true; } return false; };
    const give = (id) => { if (id) st[id] = (st[id] | 0) + 1; };
    const loadouts = {};
    let equipped = 0;
    const loHas = (lo, id) => [lo.R, lo.L, ...(lo.belt || []), ...(lo.pack || [])].indexOf(id) >= 0;
    const hasMed = (except) => pool.squad.some((s) => s.id !== except && !loadouts[s.id] && loHas(s.loadout, 'medikit'))
      || Object.keys(loadouts).some((id) => loHas(loadouts[id], 'medikit'));
    const team = pool.squad.slice().sort((a, b) => ((b.stats && b.stats.str) | 0) - ((a.stats && a.stats.str) | 0));
    for (const s of team) {
      if (!opts.all && armedLo(s.loadout)) continue;
      // devolve o que levava (sem arma, só restos) e monta de novo
      for (const id of [s.loadout.R, s.loadout.L, ...(s.loadout.belt || []), ...(s.loadout.pack || [])]) give(id);
      const lo = { R: null, L: null, belt: [], pack: [] };
      const str = Math.max(1, (s.stats && s.stats.str) | 0);
      let w = 0;
      const fits = (id, slot) => w + weightOf(id) <= str && D().fitsSlot(id, slot, lo[slot]);
      const put = (id, slot) => { if (!fits(id, slot) || !take(id)) return false; lo[slot].push(id); w += weightOf(id); return true; };
      const ammoFor = (g) => { const a = D().items[g].ammo; return Array.isArray(a) && a.length ? a.filter((x) => usable(G, x) && (st[x] | 0) > 0) : null; };
      const guns = PREF_GUNS.concat(Object.keys(st).filter((id) => D().items[id] && D().items[id].kind === 'firearm' && PREF_GUNS.indexOf(id) < 0).sort((a, b) => weightOf(a) - weightOf(b)));
      let gun = null;
      for (const g of guns) {
        if (!(st[g] > 0) || !usable(G, g) || !D().items[g] || D().items[g].kind !== 'firearm') continue;
        const ammo = ammoFor(g);
        if (ammo && !ammo.length) continue; // sem munição não serve
        const clipW = ammo ? weightOf(ammo[0]) : 0;
        if (weightOf(g) + clipW > str) continue;
        gun = g;
        break;
      }
      if (!gun && (st.stun_rod | 0) > 0 && usable(G, 'stun_rod') && weightOf('stun_rod') <= str) gun = 'stun_rod';
      if (gun && take(gun)) {
        lo.R = gun;
        w += weightOf(gun);
        const ammo = D().items[gun].ammo;
        if (Array.isArray(ammo) && ammo.length) {
          for (let n = 0; n < 2; n++) {
            const clip = ammo.find((x) => usable(G, x) && (st[x] | 0) > 0);
            if (!clip || !put(clip, 'belt')) break;
          }
        }
        if (!put('grenade', 'belt')) put('grenade', 'pack');
        if (!hasMed(s.id)) put('medikit', 'pack');
        equipped++;
      }
      loadouts[s.id] = lo;
    }
    if (!Object.keys(loadouts).length) return { ok: true, equipped: 0, unarmed: unarmedAboard(G, craftId).length };
    const r = C().applyEquip(G, craftId, { loadouts, stores: st });
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'mismatch', equipped: 0, unarmed: unarmedAboard(G, craftId).length };
    return { ok: true, equipped, unarmed: unarmedAboard(G, craftId).length };
  }
  // embarcar todos os aptos e equipar os que ficaram sem arma → {boarded, equipped, unarmed}
  function crewUp(G, craftId) {
    const boarded = boardAll(G, craftId);
    const k = autoKit(G, craftId);
    return { boarded: boarded.length, equipped: k.equipped | 0, unarmed: k.unarmed | 0 };
  }
  /* Kit básico para n soldados sem arma: espingarda, 2 carregadores e 1 granada cada, descontando o que já há no
     armazém e a bordo → {items:[{id, n}], cost} (vazio se nada faltar). */
  function starterKit(G, baseId, n) {
    const b = C().findBase(G, baseId);
    const items = [];
    if (!b || !(n > 0)) return { items, cost: 0 };
    const have = Object.assign({}, b.stores);
    for (const cid of b.crafts) {
      const c = C().findCraft(G, cid);
      if (!c) continue;
      let loose = {};
      try { loose = OV.BaseSim && OV.BaseSim.loose ? OV.BaseSim.loose(G, cid) || {} : {}; } catch (e) { loose = {}; }
      for (const k of Object.keys(loose)) have[k] = (have[k] | 0) + loose[k];
    }
    let cost = 0;
    for (const [id, per] of [['rifle', 1], ['rifle_clip', 2], ['grenade', 1]]) {
      const it = D().items[id];
      const need = Math.max(0, per * n - (have[id] | 0));
      if (!it || !need) continue;
      items.push({ id, n: need });
      cost += (it.buy | 0) * need;
    }
    return { items, cost };
  }
  // encomenda o kit (tudo ou nada: verifica primeiro) → {ok, reason?, cost, eta}
  function buyStarterKit(G, baseId, kit) {
    const k = kit || { items: [] };
    if (!k.items.length) return { ok: false, reason: 'nothing' };
    if (!OV.BaseSim || !OV.BaseSim.buy) return { ok: false, reason: 'unavailable' };
    if (G.funds < k.cost) return { ok: false, reason: 'funds' };
    for (const x of k.items) {
      const why = OV.BaseSim.canBuy ? OV.BaseSim.canBuy(G, baseId, x.id, x.n) : null;
      if (why) return { ok: false, reason: why };
    }
    for (const x of k.items) {
      const r = OV.BaseSim.buy(G, baseId, x.id, x.n);
      if (r && r.ok === false) return { ok: false, reason: r.reason };
    }
    return { ok: true, cost: k.cost, eta: tune('DELIVERY_ITEMS_H', 24) };
  }
  // diálogo «Encomendar kit básico» (confirma o custo) → Promise(bool)
  function orderStarterKit(G, baseId, n) {
    const kit = starterKit(G, baseId, n);
    if (!kit.items.length) { OV.Dom.toast(T('cp.kit.none'), null, 'info'); return Promise.resolve(false); }
    const list = el('ul', { class: 'cp-warns' }, kit.items.map((x) => el('li', { text: x.n + ' × ' + itemName(x.id) })));
    const body = el('div', null,
      el('p', { class: 'modal-text', text: Tn('cp.kit.body', n) }), list,
      el('p', { class: 'modal-text' + (G.funds < kit.cost ? ' bad' : ''), text: T('cp.kit.cost', { cost: money(kit.cost), funds: money(G.funds), h: tune('DELIVERY_ITEMS_H', 24) }) }));
    return OV.Dom.modal({
      title: T('cp.kit.title'), body,
      buttons: [{ label: T('common.cancel'), value: false }, { label: T('cp.kit.buy', { cost: money(kit.cost) }), value: true, kind: 'primary' }],
    }).then((v) => {
      if (!v) return false;
      const r = buyStarterKit(G, baseId, kit);
      if (!r.ok) { sfx('ui_deny'); OV.Dom.toast(OV.T.has('base.err.' + r.reason) ? T('base.err.' + r.reason) : T('cp.kit.fail'), null, 'warn'); return false; }
      sfx('ui_confirm');
      OV.Dom.toast(T('cp.kit.ordered', { cost: money(r.cost), h: r.eta }), null, 'good');
      return true;
    });
  }
  // texto de um resultado de crewUp (toast/linha de aviso)
  function crewText(G, craftId, r) {
    const c = C().findCraft(G, craftId);
    const parts = [];
    if (r.boarded) parts.push(Tn('cp.crew.boarded', r.boarded, { craft: craftName(c) }));
    if (r.equipped) parts.push(Tn('cp.crew.equipped', r.equipped));
    if (r.unarmed) parts.push(Tn('cp.crew.unarmed', r.unarmed));
    return parts.join(' ');
  }

  // ---- navegação entre cenas --------------------------------------------------------------------------------
  const GEO_IDS = { geoscape: 1, campaignHub: 1 };
  function openGeo(G) {
    OV.Game.G = G;
    OV.Game.B = null;
    if (OV.GeoUI && typeof OV.GeoUI.open === 'function') return OV.GeoUI.open(G);
    if (OV.SceneDefs.geoscape) return OV.Scenes.set('geoscape', { G });
    return OV.Scenes.set('campaignHub', { G });
  }
  // volta ao Geoscape que ficou por baixo (ou abre-o)
  function popToGeo(G) {
    const st = OV.Scenes.stack;
    let i = -1;
    for (let k = st.length - 1; k >= 0; k--) if (GEO_IDS[st[k].id]) { i = k; break; }
    if (i < 0) return openGeo(G);
    while (OV.Scenes.stack.length - 1 > i) OV.Scenes.pop();
    return OV.Scenes.top();
  }

  // ---- gravação ---------------------------------------------------------------------------------------------
  let quotaOffered = false;
  function offerExport(G, B) {
    OV.Dom.toast(T('cp.save.quota'), null, 'alert');
    if (!OV.Save || !G) return;
    OV.Dom.modal({
      title: T('cp.sl.quota.title'), body: T('cp.sl.quota.body'), cls: 'alert',
      buttons: [{ label: T('common.close'), value: false }, { label: T('cp.sl.export'), value: true, kind: 'primary' }],
    }).then((v) => { if (v) exportGame(G, B); });
  }
  function exportGame(G, B) {
    try {
      const f = OV.Save.exportFile(OV.Save.toJSON(G, B || null, { label: B ? battleLabel(G, B) : saveLabel(G) }));
      OV.Dom.download(f.filename, f.text, f.mime);
      OV.Dom.toast(T('cp.sl.exported', { name: f.filename }), null, 'good');
      return true;
    } catch (e) {
      OV.Dom.modal({ title: T('cp.sl.title.save'), body: esc(errText(e)), cls: 'alert' });
      return false;
    }
  }
  /* Ranhuras extra só da interface (o OV.Save só conhece auto/autoTurn/1–3): 'auto2' guarda a gravação automática
     anterior (rodam a cada gravação automática) e 'preMission' o estado de antes da última missão (nunca o de depois
     de uma derrota). Mesmo formato e prefixo de chave do OV.Save; lidas com OV.Save.importFile. */
  const EXTRA_SLOTS = ['auto2', 'preMission'];
  const extraKey = (slot) => (OV.Save && OV.Save.KEY ? OV.Save.KEY(slot) : 'ovni1999.save.' + slot);
  function lsRaw(key) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch (e) { return null; }
  }
  function lsRawSet(key, v) {
    try {
      if (typeof localStorage === 'undefined') return false;
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
      return true;
    } catch (e) { return false; }
  }
  function readExtra(slot) {
    const txt = lsRaw(extraKey(slot));
    if (!txt) return null;
    try { return JSON.parse(txt); } catch (e) { return null; }
  }
  // resumo de uma ranhura extra no formato de OV.Save.list()
  function extraSummary(slot) {
    const txt = lsRaw(extraKey(slot));
    if (!txt) return null;
    let obj = null;
    try { obj = JSON.parse(txt); } catch (e) { obj = null; }
    const g = obj && obj.campaign;
    if (!g || obj.game !== 'ovni-1999') return { slot, corrupt: true };
    const d = Number.isFinite(g.t) ? OV.U.dateOf(g.t | 0) : null;
    return {
      slot, label: typeof obj.label === 'string' ? obj.label : null, savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : null, t: g.t,
      date: d ? d.y + '-' + OV.U.pad2(d.m + 1) + '-' + OV.U.pad2(d.d) : null, month: g.month, funds: g.funds, difficulty: g.difficulty | 0, battle: false, extra: true,
    };
  }
  function loadExtra(slot) {
    const txt = lsRaw(extraKey(slot));
    if (!txt) return null;
    return OV.Save.importFile(txt);
  }
  // antes de cada missão (ao abrir o briefing): a gravação «Antes da missão» para repetir depois de uma derrota
  function saveBeforeMission(G, siteRef, craftId) {
    if (!OV.Save || !G) return false;
    let obj;
    try { obj = OV.Save.toJSON(G, null, { label: T('cp.save.labelPre', { label: saveLabel(G) }) }); } catch (e) { return false; }
    obj.preMission = { siteRef, craftId, t: G.t, seed: G.seed };
    return lsRawSet(extraKey('preMission'), JSON.stringify(obj));
  }
  // a gravação «Antes da missão» é desta campanha e desta missão? (seed e instante do lançamento)
  function preMissionFor(G, startedT) {
    const obj = readExtra('preMission');
    const pm = obj && obj.preMission;
    if (!pm || !G || pm.seed !== G.seed || pm.t !== startedT) return null;
    return pm;
  }
  // gravação automática do Geoscape (ranhura 'auto'; a anterior passa a 'auto2')
  function autosave(G, o) {
    const opts = o || {};
    if (!OV.Save || !G) return { ok: false, reason: 'unavailable' };
    const prev = lsRaw(extraKey('auto'));
    const r = OV.Save.save('auto', G, null, { label: saveLabel(G) });
    if (r.ok && prev) lsRawSet(extraKey('auto2'), prev);
    if (r.ok) { if (!opts.silent) OV.Dom.toast(T('cp.save.auto'), null, 'info'); return r; }
    if (r.reason === 'quota' && !quotaOffered) { quotaOffered = true; offerExport(G, null); }
    else if (r.reason !== 'busy' && !opts.silent) OV.Dom.toast(writeText(r.reason), null, 'warn');
    return r;
  }
  // gravação automática de uma campanha ainda por acabar (a que uma nova campanha substituiria) → {obj, label}|null
  function liveAuto() {
    let obj = null;
    try { obj = OV.Save && OV.Save.read ? OV.Save.read('auto') : null; } catch (e) { obj = null; }
    const g = obj && obj.campaign;
    if (!g || !g.flags || g.flags.won || g.flags.lost) return null;
    let label = obj.label;
    if (!label) { try { label = saveLabel(g); } catch (e) { label = T('cp.sl.slot.auto'); } }
    return { obj, label };
  }
  // início de cada turno do jogador numa batalha da campanha (ranhura 'autoTurn')
  function autosaveTurn(G, B) {
    if (!OV.Save || !G || !B) return null;
    const r = OV.Save.save('autoTurn', G, B, { label: battleLabel(G, B) });
    if (!r.ok && r.reason === 'quota' && !quotaOffered) { quotaOffered = true; OV.Dom.toast(T('cp.save.quota'), null, 'alert'); }
    return r;
  }

  // ================================================================================================
  // Globo partilhado (nova campanha e substituto do Geoscape): câmara, gestos do trackpad e teclado
  // ================================================================================================
  function globeCam(view) {
    const GR = OV.GlobeRender;
    let vel = null;
    function input(ev) {
      if (!GR) return false;
      switch (ev.kind) {
        case 'drag':
          GR.rotateBy(view, ev.dx, ev.dy);
          vel = { vx: ev.dx / 16, vy: ev.dy / 16, t: now() };
          return true;
        case 'dragend':
          if (vel && now() - vel.t < 80 && Math.hypot(vel.vx, vel.vy) > 0.15) GR.fling(view, vel.vx, vel.vy);
          vel = null;
          return true;
        case 'pan':
          GR.rotateBy(view, -ev.cx, -ev.cy);
          return true;
        case 'zoom':
          GR.zoomAt(view, OV.U.clamp(view.zoom + Math.log(ev.factor) / Math.log(1.55), 0, 5), ev.x, ev.y);
          return true;
        case 'wheelnotch':
          GR.zoomTo(view, OV.U.clamp(Math.round(view.zoom) + ev.delta, 0, 5), 220, ev.x, ev.y);
          return true;
        default:
          return false;
      }
    }
    function key(ev) {
      if (!GR) return false;
      const k = ev.key;
      const step = 60;
      if (k === 'ArrowLeft') { GR.rotateBy(view, step, 0); return true; }
      if (k === 'ArrowRight') { GR.rotateBy(view, -step, 0); return true; }
      if (k === 'ArrowUp') { GR.rotateBy(view, 0, step); return true; }
      if (k === 'ArrowDown') { GR.rotateBy(view, 0, -step); return true; }
      if (k === '+' || k === '=') { GR.zoomTo(view, OV.U.clamp(Math.round(view.zoom) + 1, 0, 5)); return true; }
      if (k === '-' || k === '_') { GR.zoomTo(view, OV.U.clamp(Math.round(view.zoom) - 1, 0, 5)); return true; }
      return false;
    }
    return { input, key };
  }
  function syncView(view) {
    const V = OV.View;
    view.w = V.w;
    view.h = V.h;
    view.dpr = V.dpr;
    view.time = now();
    view.touch = !!(OV.Input && OV.Input.lastPointerType === 'touch');
  }
  function drawGlobe(G, view) {
    const ctx = OV.View.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    OV.GlobeRender.draw(ctx, G, view);
    ctx.setTransform(OV.View.dpr, 0, 0, OV.View.dpr, 0, 0);
    return ctx;
  }
  // mira do teclado no centro do globo (verde/laranja conforme o ponto é válido; forma igual nas duas paletas)
  function drawCrosshair(c, x, y, ok) {
    c.save();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    const arm = (lw, col) => {
      c.lineWidth = lw;
      c.strokeStyle = col;
      c.beginPath();
      c.moveTo(x - 18, y); c.lineTo(x - 6, y); c.moveTo(x + 6, y); c.lineTo(x + 18, y);
      c.moveTo(x, y - 18); c.lineTo(x, y - 6); c.moveTo(x, y + 6); c.lineTo(x, y + 18);
      c.stroke();
    };
    arm(4, 'rgba(0,0,0,0.55)');
    arm(2, ok === false ? '#ff9a3c' : '#e8f6ff');
    c.beginPath();
    c.arc(x, y, 10, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
  // centro do globo à esquerda de um painel lateral (ou acima de um painel em baixo, no estreito)
  function centreBeside(view, panel) {
    if (!panel || !panel.isConnected) { view.cx = undefined; view.cy = undefined; return; }
    const r = panel.getBoundingClientRect();
    if (r.width < view.w * 0.7) { view.cx = Math.max(160, r.left / 2); view.cy = view.h / 2; } else { view.cx = view.w / 2; view.cy = Math.max(140, r.top / 2); }
  }

  // ================================================================================================
  // Cena: nova campanha (dificuldade → local da base no globo → nome → fundar)
  // ================================================================================================
  OV.SceneDefs.newgame = function () {
    const ui = SUI();
    const GR = OV.GlobeRender;
    const prev = lsGet(NG_KEY) || {};
    const st = {
      step: 'diff', diff: prev.diff === 0 || prev.diff === 2 ? prev.diff : 1, seed: '',
      chosen: { lon: LISBON.lon, lat: LISBON.lat }, hover: null, name: '', nameEdited: false,
    };
    const view = { lon: LISBON.lon + 6, lat: LISBON.lat - 4, zoom: 2.1, w: 1, h: 1, dpr: 1, time: 0, mode: 'placeBase', cursor: null, t: 0, selection: null, hover: null, highlights: [] };
    const cam = globeCam(view);
    let sc = null, panel = null, nextBtn = null, foundBtn = null, nameInp = null, info = null, diffSeg = null, layoutDirty = true;

    function infoOf(p) {
      const G = OV.GMath;
      const land = !!p && G.isLand(p.lon, p.lat);
      const region = p ? G.regionAt(p.lon, p.lat) : null;
      const mapCountry = p ? G.countryAtMap(p.lon, p.lat) : null;
      const funder = p ? G.countryAt(p.lon, p.lat) : null;
      const range = (D().facilities.small_radar && D().facilities.small_radar.radarRange) || 1695;
      const covered = [];
      if (p) for (const id of Object.keys(D().countries)) {
        const c = D().countries[id];
        if (c.label && G.distNmLL(p.lon, p.lat, c.label[0], c.label[1]) <= range) covered.push(id);
      }
      return { land, region, mapCountry, funder, covered };
    }
    function defaultName(inf) {
      if (inf.mapCountry === 'portugal') return T('base.defaultName');
      return inf.region ? T('cp.ng.baseOf', { region: T('region.' + inf.region) }) : T('base.defaultName');
    }

    function buildDiff(root) {
      const thr = tune('RATING_THRESHOLD', [-900, -700, -500]);
      diffSeg = el('div', { class: 'cp-diffs', role: 'radiogroup', 'aria-label': T('cp.ng.diff') });
      const cards = [0, 1, 2].map((d) => {
        const b = el('button', { type: 'button', class: 'cp-diff d' + d, role: 'radio', dataset: { d: String(d) } },
          el('span', { class: 'cp-diff-n', text: String(d + 1) }),
          el('span', { class: 'cp-diff-name', text: T('diff.' + d) }),
          el('span', { class: 'cp-diff-desc', text: T('cp.ng.diff.' + d) }),
          el('span', { class: 'cp-diff-facts' },
            el('span', { text: T('cp.ng.fact.aim.' + d) }),
            el('span', { text: T('cp.ng.fact.crew.' + d) }),
            el('span', { text: T('cp.ng.fact.council', { n: OV.U.fmtInt(thr[d]) }) })));
        b.addEventListener('click', () => { if (st.diff !== d) sfx('ui_select'); setDiff(d); });
        b.addEventListener('dblclick', () => toPlace());
        OV.Dom.tooltip(b, () => tipHtml(T('diff.' + d), String(d + 1)));
        return b;
      });
      cards.forEach((b) => diffSeg.appendChild(b));
      const seedInp = el('input', { type: 'text', inputmode: 'numeric', class: 'cp-seed', placeholder: T('cp.ng.seed.random'), 'aria-label': T('cp.ng.seed'), maxlength: '10' });
      seedInp.value = st.seed;
      seedInp.addEventListener('input', () => { seedInp.value = seedInp.value.replace(/\D+/g, ''); st.seed = seedInp.value; });
      seedInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toPlace(); } });
      nextBtn = btn(T('cp.ng.next'), { cls: 'primary scr-big', key: 'Enter', tip: T('cp.ng.next.tip'), sound: false, onClick: toPlace });
      root.append(el('div', { class: 'scr-panel cp-ng-diff' },
        ui.header(T('cp.ng.kicker'), T('cp.ng.title.diff')),
        el('div', { class: 'cp-ng-body' },
          el('p', { class: 'cp-lead', text: T('cp.ng.lead') }),
          diffSeg,
          el('div', { class: 'cp-seed-row' },
            el('label', { class: 'cp-k', text: T('cp.ng.seed') }), seedInp,
            el('span', { class: 'scr-muted small', text: T('cp.ng.seed.hint') }))),
        el('footer', { class: 'scr-foot' },
          el('span', { class: 'scr-hint', text: T('cp.ng.hint.diff') }),
          el('div', { class: 'scr-foot-btns' },
            btn(T('scr.back'), { key: 'Esc', tip: T('cp.ng.back.menu'), onClick: back }),
            nextBtn))));
      setDiff(st.diff);
    }
    function setDiff(d) {
      st.diff = d;
      if (!diffSeg) return;
      // foco itinerante: com o foco no grupo, a seleção e o anel de foco andam juntos
      const inside = diffSeg.contains(document.activeElement);
      for (const b of diffSeg.children) {
        const on = +b.dataset.d === d;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && inside && document.activeElement !== b) b.focus({ preventScroll: true });
      }
    }

    function buildPlace(root) {
      nameInp = el('input', { type: 'text', class: 'cp-name', maxlength: '32', 'aria-label': T('cp.ng.name') });
      nameInp.addEventListener('input', () => { st.nameEdited = nameInp.value.trim().length > 0; st.name = nameInp.value; refreshFound(); });
      // Enter/«Ir» no teclado do iPad só fecha o teclado: fundar a base é sempre o botão (o 2.º Enter)
      nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInp.blur(); if (foundBtn && OV.Input.lastPointerType !== 'touch') foundBtn.focus({ preventScroll: true }); } });
      info = el('div', { class: 'cp-ng-info' });
      foundBtn = btn(T('cp.ng.found'), { cls: 'primary scr-big', key: 'Enter', tip: T('cp.ng.found.tip'), sound: false, onClick: () => found(false) });
      const zoomRow = el('div', { class: 'cp-zoom' },
        btn('−', { cls: 'small ghost', key: '−', tip: T('cp.ng.zoomOut'), onClick: () => GR.zoomTo(view, OV.U.clamp(Math.round(view.zoom) - 1, 0, 5)) }),
        btn('+', { cls: 'small ghost', key: '+', tip: T('cp.ng.zoomIn'), onClick: () => GR.zoomTo(view, OV.U.clamp(Math.round(view.zoom) + 1, 0, 5)) }),
        btn(T('cp.ng.centre'), { cls: 'small ghost', key: 'C', tip: T('cp.ng.centre.tip'), onClick: () => GR.rotateTo(view, st.chosen.lon, st.chosen.lat) }));
      panel = el('aside', { class: 'scr-panel cp-ng-side' },
        ui.header(T('cp.ng.kicker2'), T('cp.ng.title.place')),
        el('div', { class: 'cp-ng-sbody scr-scroll' },
          el('p', { class: 'cp-help', text: touchT('cp.ng.help') }),
          touchT('cp.ng.kbd') ? el('p', { class: 'cp-help cp-kbd-help', text: touchT('cp.ng.kbd') }) : null,
          info,
          el('label', { class: 'cp-k cp-name-l', text: T('cp.ng.name') }), nameInp,
          zoomRow),
        el('footer', { class: 'scr-foot' },
          el('div', { class: 'scr-foot-btns' },
            btn(T('scr.back'), { key: 'Esc', tip: T('cp.ng.back.diff'), onClick: back }),
            foundBtn)));
      root.append(panel, el('div', { class: 'cp-globe-tip', text: touchT('cp.ng.gestures') }));
      refreshInfo();
      layoutDirty = true;
    }
    function refreshInfo() {
      if (!info) return;
      const inf = infoOf(st.chosen);
      OV.Dom.clear(info);
      info.append(
        kv(T('cp.ng.coords'), fmtLL(st.chosen)),
        kv(T('cp.ng.region'), inf.region ? T('region.' + inf.region) : '—'),
        kv(T('cp.ng.country'), inf.mapCountry ? countryName(inf.mapCountry) : T('cp.ng.noCountry')),
        el('div', { class: 'cp-note ' + (inf.funder ? 'good' : 'warn'), text: inf.funder ? T('cp.ng.funder', { country: countryName(inf.funder) }) : T('cp.ng.noFunder') }),
        el('div', { class: 'cp-k cp-cov-k', text: T('cp.ng.radar') }),
        el('div', { class: 'cp-cov' }, inf.covered.length ? inf.covered.map((id) => el('span', { class: 'cp-cov-c', text: countryName(id) })) : el('span', { class: 'scr-muted', text: T('cp.ng.radar.none') })));
      if (!st.nameEdited && nameInp) {
        st.name = defaultName(inf);
        nameInp.value = st.name;
      }
      refreshFound();
    }
    function refreshFound() {
      if (foundBtn) foundBtn.disabled = !OV.GMath.isLand(st.chosen.lon, st.chosen.lat);
    }
    // vírgula decimal pt-PT, como no Geoscape («38,7° N · 9,1° O»)
    const dec1 = (v) => Math.abs(v).toFixed(1).replace('.', ',');
    const fmtLL = (p) => T('cp.ng.ll', { lat: dec1(p.lat), ns: T(p.lat >= 0 ? 'cp.ng.N' : 'cp.ng.S'), lon: dec1(p.lon), ew: T(p.lon >= 0 ? 'cp.ng.E' : 'cp.ng.W') });
    const countryName = (id) => (OV.T.has('country.' + id) ? T('country.' + id) : id);

    function render() {
      if (!sc || !sc.root) return;
      OV.Dom.clear(sc.root);
      panel = info = nameInp = foundBtn = nextBtn = diffSeg = null;
      sc.root.classList.toggle('cp-ng-placing', st.step === 'place');
      if (st.step === 'diff') buildDiff(sc.root);
      else buildPlace(sc.root);
      setTimeout(() => {
        if (!sc || !sc.root) return;
        const f = st.step === 'diff' ? diffSeg && diffSeg.querySelector('.on') : foundBtn;
        if (f) f.focus({ preventScroll: true });
      }, 0);
    }
    function toPlace() {
      if (st.step !== 'diff') return;
      sfx('ui_confirm');
      lsSet(NG_KEY, { diff: st.diff });
      if (GR && GR.prewarm) GR.prewarm();
      st.step = 'place';
      view.lon = LISBON.lon + 6; view.lat = LISBON.lat - 4; view.zoom = 2.1;
      render();
      if (GR) GR.rotateTo(view, LISBON.lon + 4, LISBON.lat - 2, 900, 2.4);
      music('geoscape');
    }
    function back() {
      if (st.step === 'place') { st.step = 'diff'; render(); music('menu'); return; }
      if (OV.Scenes.stack.length > 1) OV.Scenes.pop();
      else OV.Scenes.set('menu');
    }
    function choose(p) {
      if (!p) return;
      if (!OV.GMath.isLand(p.lon, p.lat)) { sfx('ui_deny'); OV.Dom.toast(T('cp.ng.sea'), null, 'warn'); return; }
      st.chosen = { lon: +p.lon.toFixed(3), lat: +p.lat.toFixed(3) };
      sfx('ui_select');
      refreshInfo();
    }
    // a gravação automática de uma campanha por acabar seria substituída sem aviso: pergunta-se (e oferece-se exportar)
    let asking = false;
    function found(confirmed) {
      if (st.step !== 'place' || asking) return;
      if (!OV.GMath.isLand(st.chosen.lon, st.chosen.lat)) { sfx('ui_deny'); OV.Dom.toast(T('cp.ng.sea'), null, 'warn'); return; }
      const old = confirmed ? null : liveAuto();
      if (old) {
        asking = true;
        sfx('ui_select');
        OV.Dom.modal({
          title: T('cp.ng.auto.title'), cls: 'alert',
          body: el('div', null, el('p', { class: 'modal-text', text: T('cp.ng.auto.body', { label: old.label }) }), el('p', { class: 'modal-text scr-muted', text: T('cp.ng.auto.hint') })),
          buttons: [{ label: T('common.cancel'), value: false }, { label: T('cp.ng.auto.replace'), value: 'go', kind: 'danger' }, { label: T('cp.ng.auto.export'), value: 'export', kind: 'primary' }],
        }).then((v) => {
          asking = false;
          if (!v) return;
          if (v === 'export') {
            try {
              const f = OV.Save.exportFile(old.obj);
              OV.Dom.download(f.filename, f.text, f.mime);
              OV.Dom.toast(T('cp.sl.exported', { name: f.filename }), null, 'good');
            } catch (e) {
              OV.Dom.modal({ title: T('cp.sl.title.save'), body: esc(errText(e)), cls: 'alert' });
              return;
            }
          }
          found(true);
        });
        return;
      }
      const name = String((nameInp && nameInp.value) || st.name || '').trim().slice(0, 32);
      const seed = st.seed !== '' ? (+st.seed >>> 0) || 1 : (uiRng.u32() >>> 0) || 1;
      let G;
      try {
        G = C().newCampaign({ difficulty: st.diff, seed, baseLonLat: { lon: st.chosen.lon, lat: st.chosen.lat }, baseName: !name || name === T('base.defaultName') ? null : name });
      } catch (e) {
        sfx('ui_deny');
        OV.Dom.modal({ title: T('cp.ng.title.place'), body: esc(T('cp.ng.failed', { msg: e && e.message ? e.message : String(e) })), cls: 'alert' });
        return;
      }
      sfx('ui_confirm');
      OV.Game.G = G;
      OV.Game.B = null;
      // o turno de batalha gravado era da campanha anterior: «Continuar» não o pode reabrir
      try { if (OV.Save && OV.Save.remove) OV.Save.remove('autoTurn'); } catch (e) { /* armazenamento indisponível */ }
      lsRawSet(extraKey('preMission'), null);
      autosave(G, { silent: true });
      openGeo(G);
      OV.Dom.toast(T('cp.ng.founded', { name: baseName(G.bases[0]) }), null, 'good');
    }

    sc = ui.makeScreen('newgame', {
      backdrop: { dim: 0.45 },
      build(root, s) { sc = s; render(); music('menu'); },
      keys(ev) {
        const k = ev.key;
        if (st.step === 'diff') {
          if (k >= '1' && k <= '3') { sfx('ui_select'); setDiff(+k - 1); return true; }
          if (k === 'ArrowRight' || k === 'ArrowDown') { sfx('ui_select'); setDiff(Math.min(2, st.diff + 1)); return true; }
          if (k === 'ArrowLeft' || k === 'ArrowUp') { sfx('ui_select'); setDiff(Math.max(0, st.diff - 1)); return true; }
          if (k === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === nextBtn || document.activeElement.classList.contains('cp-diff')) { toPlace(); return true; } return false; }
          return false;
        }
        if (k === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === foundBtn) { found(false); return true; } return false; }
        if (k === 'c' || k === 'C') { GR.rotateTo(view, st.chosen.lon, st.chosen.lat); return true; }
        // teclado: as setas rodam o globo sob a mira do centro e Espaço escolhe esse ponto
        if (k === ' ') { if (!ev.repeat) { st.kbd = true; choose(centrePick()); } return true; }
        if (cam.key(ev)) { st.kbd = true; return true; }
        return false;
      },
      back,
    });
    const keyInput = sc.onInput;
    const centrePick = () => GR.pick(view, Number.isFinite(view.cx) ? view.cx : view.w / 2, Number.isFinite(view.cy) ? view.cy : view.h / 2);
    sc.onInput = function (ev) {
      if (ev.kind === 'key') return keyInput(ev);
      if (st.step !== 'place' || !GR) return false;
      if (ev.kind === 'hover') { st.kbd = false; st.hover = GR.pick(view, ev.x, ev.y); return true; }
      if (ev.kind === 'leave') { st.hover = null; return true; }
      if (ev.kind === 'click') {
        const p = GR.pick(view, ev.x, ev.y);
        if (ev.mods && ev.mods.alt && p) { GR.rotateTo(view, p.lon, p.lat); return true; }
        choose(p);
        return true;
      }
      if (ev.kind === 'dblclick' || ev.kind === 'secondary') {
        const p = GR.pick(view, ev.x, ev.y);
        if (p) GR.rotateTo(view, p.lon, p.lat);
        return true;
      }
      return cam.input(ev);
    };
    const baseDraw = sc.draw;
    sc.draw = function (ctx, v) {
      if (st.step !== 'place' || !GR) { baseDraw(ctx, v); return; }
      syncView(view);
      if (layoutDirty && panel && panel.isConnected) { centreBeside(view, panel); layoutDirty = false; }
      if (st.kbd) st.hover = centrePick();
      view.cursor = st.hover || st.chosen;
      view.placeValid = view.cursor ? OV.GMath.isLand(view.cursor.lon, view.cursor.lat) : null;
      const c = drawGlobe(null, view);
      if (st.kbd) drawCrosshair(c, Number.isFinite(view.cx) ? view.cx : view.w / 2, Number.isFinite(view.cy) ? view.cy : view.h / 2, view.placeValid);
      // marca o local escolhido quando o cursor está noutro ponto
      if (st.hover) {
        const p = GR.project(view, st.chosen.lon, st.chosen.lat);
        if (p.front) {
          c.save();
          c.strokeStyle = '#ffb53d';
          c.fillStyle = 'rgba(47,134,255,0.9)';
          c.lineWidth = 2;
          c.fillRect(p.x - 6, p.y - 6, 12, 12);
          c.strokeRect(p.x - 8, p.y - 8, 16, 16);
          c.restore();
        }
      }
    };
    sc.onResize = function () { layoutDirty = true; };
    sc._dbg = () => ({ step: st.step, diff: st.diff, chosen: Object.assign({}, st.chosen), name: nameInp ? nameInp.value : st.name, view: { lon: view.lon, lat: view.lat, zoom: view.zoom, w: view.w, h: view.h, dpr: view.dpr, cx: view.cx, cy: view.cy } });
    return sc;
  };

  // ================================================================================================
  // Missões: lançamento → briefing (com «Equipar») → batalha → relatório → Geoscape
  // ================================================================================================
  const missionSettings = () => ({ instantGrenades: settings().instantGrenades !== false });
  const loItems = (lo) => (lo ? [lo.R, lo.L].concat(lo.belt || [], lo.pack || []).filter(Boolean) : []);
  const itemName = (id) => (D().items[id] ? T(D().items[id].nameKey) : id);

  // o OVNI do briefing fica identificado no Geoscape (o cartão deixa de dizer «Tipo desconhecido»)
  function markUfoKnown(G, ufoId) {
    if (!G || !G.ui || !ufoId) return;
    const list = (G.ui.idUfos = Array.isArray(G.ui.idUfos) ? G.ui.idUfos : []);
    if (list.indexOf(ufoId) < 0) list.push(ufoId);
    while (list.length > 40) list.shift();
  }
  function launchMission(G, siteRef, craftId) {
    OV.Game.G = G;
    // antes de mexer em G (sorteio do mapa): a gravação «Antes da missão» para repetir depois de uma derrota
    saveBeforeMission(G, siteRef, craftId);
    let mission;
    try {
      mission = C().startMission(G, siteRef, craftId, { settings: missionSettings() });
    } catch (e) {
      sfx('ui_deny');
      OV.Dom.modal({ title: T('cp.br.cannot'), body: esc(errText(e)), cls: 'alert' });
      return false;
    }
    sfx('ui_confirm');
    if (siteRef && siteRef.kind === 'ufo') markUfoKnown(G, siteRef.id);
    OV.Scenes.push('cbriefing', { G, siteRef, craftId, mission });
    return true;
  }

  // ---- missão final (Cidónia): partida do hangar, sem regresso -------------------------------------------------
  const AIRBORNE = { out: 1, patrol: 1, returning: 1 };
  const cydoniaCapable = (c) => !!c && (c.type === 'avenger' || !!(D().crafts[c.type] && D().crafts[c.type].spacecraft));
  const fitAboard = (G, c) => (c.soldiers || []).filter((id) => { const s = C().findSoldier(G, id); return s && !(s.woundDays > 0); }).length;
  // {ok, reason}: as razões são as de Campaign.checkStart (campaign.err.*), pela ordem mais útil ao jogador
  function cydoniaState(G, craftId) {
    if (!G || !G.flags.cydoniaUnlocked) return { ok: false, reason: 'locked' };
    if (G.flags.won || G.flags.lost) return { ok: false, reason: 'ended' };
    if (G.activeMission) return { ok: false, reason: 'busy' };
    const c = craftId ? C().findCraft(G, craftId) : null;
    if (!c) return { ok: false, reason: 'noCraft' };
    if (!cydoniaCapable(c)) return { ok: false, reason: 'craftType' };
    if (c.dogfightId) return { ok: false, reason: 'inDogfight' };
    const base = C().findBase(G, c.baseId);
    if (c.status !== 'ready' || AIRBORNE[c.status] || !base || base.crafts.indexOf(c.id) < 0) return { ok: false, reason: 'notReady' };
    if (!fitAboard(G, c)) return { ok: false, reason: 'noSoldiers' };
    return { ok: true, reason: null };
  }
  // a nave que partiria (de uma base, ou de qualquer uma): a primeira pronta, senão a que está mais perto de estar
  const PICK_ORDER = ['noSoldiers', 'notReady', 'inDogfight', 'busy', 'ended', 'locked'];
  function cydoniaPick(G, baseId) {
    let best = null;
    for (const b of G.bases) {
      if (baseId && b.id !== baseId) continue;
      for (const id of b.crafts) {
        const c = C().findCraft(G, id);
        if (!cydoniaCapable(c)) continue;
        const st = cydoniaState(G, id);
        if (st.ok) return { ok: true, reason: null, craftId: id };
        if (!best || PICK_ORDER.indexOf(st.reason) < PICK_ORDER.indexOf(best.reason)) best = { ok: false, reason: st.reason, craftId: id };
      }
    }
    if (best) return best;
    return { ok: false, reason: G.flags.cydoniaUnlocked ? 'noAvenger' : 'locked', craftId: null };
  }
  const cydoniaWhy = (reason) => (OV.T.has('cp.cy.err.' + reason) ? T('cp.cy.err.' + reason) : OV.T.has('campaign.err.' + reason) ? T('campaign.err.' + reason) : T('cp.err.generic', { msg: reason }));
  // confirmação («não há regresso») e lançamento → briefing; Promise(bool)
  function launchCydonia(G, craftId) {
    const id = craftId || cydoniaPick(G, null).craftId;
    const st = cydoniaState(G, id);
    if (!st.ok) {
      sfx('ui_deny');
      OV.Dom.toast(cydoniaWhy(id ? st.reason : cydoniaPick(G, null).reason), null, 'warn');
      return Promise.resolve(false);
    }
    const c = C().findCraft(G, id);
    const body = el('div', { class: 'cp-cy' },
      el('p', { class: 'modal-text', text: T('cp.cy.body', { craft: craftName(c), n: fitAboard(G, c) }) }),
      el('p', { class: 'modal-text cp-cy-warn', text: T('cp.cy.noReturn') }),
      el('p', { class: 'modal-text scr-muted', text: T('cp.cy.tip') }));
    sfx('alien_spotted');
    return OV.Dom.modal({
      title: T('cp.cy.title'), body, cls: 'alert cp-cy-modal',
      buttons: [{ label: T('cp.cy.stay'), value: false }, { label: T('cp.cy.go'), value: true, kind: 'danger' }],
    }).then((v) => (v ? launchMission(G, { kind: 'cydonia' }, id) : false));
  }

  // ícones pequenos do equipamento de um soldado (arma grande + resto agrupado)
  function kitEl(lo, big) {
    const ui = SUI();
    const items = loItems(lo);
    const main = lo && (lo.R || lo.L);
    const rest = {};
    let skip = main ? 1 : 0;
    for (const it of items) {
      if (skip && it === main) { skip = 0; continue; }
      rest[it] = (rest[it] | 0) + 1;
    }
    return el('div', { class: 'cp-kit' },
      main ? ui.itemIconEl(main, big || 38) : el('span', { class: 'cp-kit-none', text: T('cp.br.unarmed') }),
      el('div', { class: 'cp-kit-rest' }, Object.keys(rest).map((id) => el('span', { class: 'cp-kit-i' }, ui.itemIconEl(id, 20), rest[id] > 1 ? el('i', { text: '×' + rest[id] }) : null))));
  }

  // cidade · país · região do local; o país dos contornos reais (só apresentação) quando não é financiador
  function whereOf(G, siteRef, meta) {
    let country = meta.countryKey ? T(meta.countryKey) : null;
    if (!country && siteRef && siteRef.kind !== 'cydonia') {
      const tg = C().targetOf(G, siteRef);
      const id = tg ? OV.GMath.countryAtMap(tg.lon, tg.lat) : null;
      if (id && OV.T.has('country.' + id)) country = T('country.' + id);
    }
    return [meta.cityKey ? T(meta.cityKey) : null, country, meta.regionKey ? T(meta.regionKey) : null].filter(Boolean);
  }

  // avisos táticos antes de partir (equipamento em falta, sem kit médico, noite sem sinalizadores, peso)
  function briefingWarnings(G, mission, M) {
    const out = [];
    const squad = mission.squad || [];
    const pool = mission.craftItems || {};
    let missing = 0;
    const has = (id) => squad.some((s) => loItems(s.loadout).indexOf(id) >= 0) || (pool[id] | 0) > 0;
    for (const s of squad) {
      const sol = C().findSoldier(G, s.soldierId);
      if (sol) missing += Math.max(0, loItems(sol.loadout).length - loItems(s.loadout).length);
      let w = 0;
      for (const it of loItems(s.loadout)) w += (D().items[it] && D().items[it].weight) | 0;
      if (s.stats && w > (s.stats.str | 0)) out.push({ cls: 'warn', text: T('cp.br.warn.heavy', { name: s.name, w, str: s.stats.str | 0 }) });
    }
    if (missing) out.unshift({ cls: 'bad', text: Tn('cp.br.warn.missing', missing) });
    const unarmed = squad.filter((s) => !armedLo(s.loadout)).length;
    if (unarmed) out.unshift({ cls: 'bad', id: 'unarmed', text: Tn('cp.br.warn.unarmed', unarmed) });
    if (!has('medikit')) out.push({ cls: 'warn', text: T('cp.br.warn.medikit') });
    if (M.night && !has('electro_flare')) out.push({ cls: 'warn', text: T('cp.br.warn.flares') });
    const craft = C().findCraft(G, mission.craftId);
    const seats = craft && D().crafts[craft.type] ? D().crafts[craft.type].seatsUI | 0 : 0;
    if (seats && squad.length < seats) out.push({ cls: 'info', text: Tn('cp.br.warn.seats', seats - squad.length) });
    return out;
  }

  OV.SceneDefs.cbriefing = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G, siteRef = p.siteRef, craftId = p.craftId;
    let mission = p.mission;
    let sc = null, startBtn = null, busy = false;

    function restart() {
      C().cancelMission(G);
      try {
        mission = C().startMission(G, siteRef, craftId, { settings: missionSettings() });
        return true;
      } catch (e) {
        OV.Dom.modal({ title: T('cp.br.cannot'), body: esc(errText(e)), cls: 'alert' });
        if (OV.Scenes.top() === sc) OV.Scenes.pop();
        return false;
      }
    }
    function cancel() {
      C().cancelMission(G);
      if (OV.Scenes.top() === sc) OV.Scenes.pop();
    }
    function start() {
      if (busy) return;
      busy = true;
      if (!startBattle(mission, mission.meta)) busy = false;
    }
    function equip() {
      if (busy) return;
      OV.Scenes.push('equip', { G, craftId, night: !!mission.night });
    }
    // «Equipar automaticamente»: quem vai sem arma leva o que há a bordo (e no hangar, do armazém)
    function autoKitNow() {
      if (busy) return;
      const r = autoKit(G, craftId);
      if (r.ok && r.equipped) {
        OV.Dom.toast(Tn('cp.crew.equipped', r.equipped) + (r.unarmed ? ' ' + Tn('cp.crew.unarmed', r.unarmed) : ''), null, r.unarmed ? 'warn' : 'good');
        if (restart()) render();
      } else {
        sfx('ui_deny');
        OV.Dom.toast(T('cp.br.autoKit.none'), null, 'warn');
      }
    }
    function soldierCard(s) {
      const rank = D().soldierRank(s.rank | 0);
      const st = s.stats || {};
      const statCell = (k) => el('span', { class: 'scr-st' }, el('i', { text: T('stat.' + k + '.abbr') }), el('b', { text: String(st[k] | 0) }));
      return el('div', { class: 'scr-soldier cp-sol' },
        ui.portraitEl(s, 54),
        el('div', { class: 'scr-soldier-info' },
          el('div', { class: 'scr-soldier-name' }, el('span', { class: 'scr-rank r' + (s.rank | 0), text: rank ? T(rank.abbrKey) : '' }), el('b', { text: s.name || '' })),
          el('div', { class: 'scr-soldier-sub', text: [s.nat ? T('nat.' + s.nat) : '', Tn('scr.br.missions', s.missions | 0)].filter(Boolean).join(' · ') }),
          el('div', { class: 'scr-stats' }, ['tu', 'hp', 'fire', 'react', 'brav'].map(statCell))),
        kitEl(s.loadout, 38));
    }
    function render() {
      if (!sc || !sc.root) return;
      const root = sc.root;
      OV.Dom.clear(root);
      const M = OV.Battle.normalizeMission(mission);
      const meta = mission.meta || {};
      const craft = C().findCraft(G, craftId);
      const time = meta.time || (M.night ? 'night' : 'day');
      const raceId = meta.race;
      const race = raceId ? D().races[raceId] : null;
      // a tripulação real usa a tabela do mês (crewRules.earlyMonths): o efetivo estimado também
      const range = D().deploymentRange(M.deploymentId, M.difficulty, M.month);
      const sprite = race && race.members && race.members.soldier ? ui.unitSpriteEl(race.members.soldier, 86) : null;
      const where = whereOf(G, siteRef, meta);
      const notes = [];
      if (time === 'night') notes.push(T('scr.br.note.night'));
      if (time === 'dusk') notes.push(T('scr.br.note.dusk'));
      if (M.kind === 'crash') notes.push(T('scr.br.note.crash'));
      if (M.kind === 'terror') notes.push(T('scr.br.note.terror'));
      if (M.kind === 'landed') notes.push(T('cp.br.note.landed'));
      const warns = briefingWarnings(G, mission, M);
      const squad = mission.squad || [];
      startBtn = btn(T('cp.br.start'), { cls: 'primary scr-big', key: 'Enter', tip: T('cp.br.start.tip'), sound: false, onClick: (e) => { if (e.detail > 1) return; start(); } });
      root.append(el('div', { class: 'scr-panel scr-brief cp-brief k-' + M.kind },
        ui.header(T('cp.br.kicker', { date: dateText(G.t) }), OV.Screens.missionTitle(M, meta),
          el('div', { class: 'scr-chips' },
            where.length ? el('span', { class: 'scr-chip cp-where' }, el('i', { text: T('cp.br.where') }), where.join(' · ')) : null,
            el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.terrain') }), T('terrain.' + M.terrain)),
            el('span', { class: 'scr-chip t-' + time }, el('i', { text: T('scr.br.time') }), T('scr.time.' + time)),
            el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.craft') }), craftName(craft)),
            el('span', { class: 'scr-chip' }, el('i', { text: T('scr.br.diff') }), T('diff.' + M.difficulty)))),
        el('div', { class: 'scr-brief-body' },
          el('div', { class: 'scr-brief-left' },
            ui.panelSection(T('scr.br.objectives'),
              el('ol', { class: 'scr-obj' },
                el('li', { text: T('scr.br.obj.' + M.kind + '.1') }),
                el('li', { text: T('scr.br.obj.' + M.kind + '.2') }),
                el('li', { class: 'scr-muted', text: T('scr.br.obj.abort') }))),
            ui.panelSection(T('scr.br.intel'),
              el('div', { class: 'scr-intel' }, sprite ? el('div', { class: 'scr-intel-sprite' }, sprite) : el('div', { class: 'scr-intel-sprite cp-unknown', text: '?' }),
                el('dl', null,
                  el('dt', { text: T('scr.br.race') }), el('dd', { text: race ? T(race.pluralKey || race.nameKey) : T('cp.br.raceUnknown') }),
                  el('dt', { text: T('scr.br.crew') }), el('dd', { text: OV.Screens.crewText(range) }))),
              race ? null : el('p', { class: 'scr-note', text: T('cp.br.raceHint') }),
              notes.map((n) => el('p', { class: 'scr-note', text: n }))),
            warns.length ? ui.panelSection(T('cp.br.warnings'), el('ul', { class: 'cp-warns' }, warns.map((w) => el('li', { class: w.cls },
              el('span', { text: w.text }),
              w.id === 'unarmed' ? btn(T('cp.br.autoKit'), { cls: 'small', key: 'A', tip: T('cp.br.autoKit.tip'), onClick: autoKitNow }) : null)))) : null),
          ui.panelSection(T('scr.br.squad') + ' · ' + squad.length,
            squad.length ? el('div', { class: 'scr-roster' }, squad.map(soldierCard)) : el('p', { class: 'cp-note bad', text: T('cp.br.noSquad') }))),
        el('footer', { class: 'scr-foot' },
          el('span', { class: 'scr-hint', text: T('cp.br.hint') }),
          el('div', { class: 'scr-foot-btns' },
            btn(T('common.cancel'), { key: 'Esc', tip: T('cp.br.cancel.tip'), onClick: cancel }),
            btn(T('cp.br.equip'), { key: 'E', tip: T('cp.br.equip.tip'), onClick: equip }),
            startBtn))));
      startBtn.disabled = !squad.length;
    }
    sc = ui.makeScreen('cbriefing', {
      cls: 'scr-briefing',
      backdrop: { dim: 0.55, tint: mission && mission.kind === 'terror' ? 'rgba(120,20,10,0.10)' : null },
      build(root, s) { sc = s; render(); },
      focus: () => startBtn,
      resume(s, result) {
        if (result && result.changed && restart()) render();
        setTimeout(() => { if (startBtn && startBtn.isConnected) startBtn.focus({ preventScroll: true }); }, 0);
      },
      keys(ev) {
        if (ev.key === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === startBtn) { if (startBtn && !startBtn.disabled) start(); return true; } return false; }
        if (ev.key === 'e' || ev.key === 'E') { sfx('ui_click'); equip(); return true; }
        if ((ev.key === 'a' || ev.key === 'A') && !ev.repeat && sc.root && sc.root.querySelector('.cp-warns .btn')) { autoKitNow(); return true; }
        return false;
      },
      back: cancel,
    });
    return sc;
  };

  // ---- «Equipar» (cena própria; a base também a pode abrir) ----------------------------------------------
  OV.SceneDefs.equip = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G, craftId = p.craftId;
    let sc = null, ctrl = null, host = null, doneBtn = null, changed = false, closed = false;

    function curSid() {
      const b = host && host.querySelector('.eq-sol.on');
      return b ? b.dataset.sid : null;
    }
    function sids() {
      return host ? [...host.querySelectorAll('.eq-sol')].map((b) => b.dataset.sid) : [];
    }
    function done() {
      if (closed) return;
      closed = true;
      const r = { changed };
      if (typeof p.onDone === 'function') p.onDone(r);
      if (OV.Scenes.top() === sc) OV.Scenes.pop(r);
    }
    function onChange(res) {
      const r = C().applyEquip(G, craftId, res);
      if (r && r.ok) changed = true;
      else OV.Dom.toast(T('cp.eq.err.' + ((r && r.reason) || 'mismatch')), null, 'warn');
    }
    sc = ui.makeScreen('equip', {
      backdrop: { dim: 0.6 },
      build(root, s) {
        sc = s;
        const craft = C().findCraft(G, craftId);
        let pool = null;
        try { pool = C().equipPool(G, craftId); } catch (e) { pool = null; }
        const base = craft ? C().findBase(G, craft.baseId) : null;
        const home = !!craft && !!base && base.crafts.indexOf(craft.id) >= 0 && !{ out: 1, patrol: 1, returning: 1 }[craft.status];
        host = el('div', { class: 'cp-eq-host' });
        doneBtn = btn(T('cp.eq.done'), { cls: 'primary', key: 'Enter', tip: T('cp.eq.done.tip'), onClick: done });
        root.append(el('div', { class: 'scr-panel cp-eq' },
          ui.header(T('cp.eq.kicker', { base: baseName(base) }), T('cp.eq.title', { craft: craftName(craft) }),
            el('div', { class: 'scr-chips' },
              el('span', { class: 'scr-chip ' + (home ? 't-day' : 't-dusk') }, el('i', { text: T('cp.eq.source') }), T(home ? 'cp.eq.home' : 'cp.eq.away')),
              pool ? el('span', { class: 'scr-chip' }, el('i', { text: T('cp.eq.squad') }), String(pool.squad.length)) : null)),
          host,
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('cp.eq.hint') }),
            el('div', { class: 'scr-foot-btns' }, doneBtn))));
        if (!pool || !pool.squad.length || !OV.InventoryUI || !OV.InventoryUI.equipScreen) {
          host.appendChild(el('p', { class: 'cp-note warn', text: T(pool ? 'cp.eq.empty' : 'cp.eq.noCraft') }));
          return;
        }
        ctrl = OV.InventoryUI.equipScreen(host, { squad: pool.squad, stores: pool.stores, onChange, night: !!p.night });
      },
      exit() { if (ctrl) ctrl.destroy(); ctrl = null; },
      focus: () => doneBtn,
      keys(ev) {
        const k = ev.key;
        if (k === 'Escape') {
          if (ctrl && host.querySelector('.inv-equip.picking')) { ctrl.select(curSid()); return true; }
          sfx('ui_click');
          done();
          return true;
        }
        if (k === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === doneBtn) { sfx('ui_click'); done(); return true; } return false; }
        if (!ctrl) return false;
        const list = sids();
        if (k === 'Tab' && list.length) {
          const i = list.indexOf(curSid());
          ctrl.select(list[(i + (ev.mods && ev.mods.shift ? list.length - 1 : 1)) % list.length]);
          sfx('ui_select');
          return true;
        }
        if (/^[0-9]$/.test(k)) {
          const i = k === '0' ? 9 : +k - 1;
          if (list[i]) { ctrl.select(list[i]); sfx('ui_select'); }
          return true;
        }
        return false;
      },
    });
    return sc;
  };
  function equip(G, craftId, onDone) {
    return OV.Scenes.push('equip', { G, craftId, onDone });
  }

  // ---- batalha ----------------------------------------------------------------------------------------------
  function enterBattle(G, B, mission, meta, reset) {
    const params = { B, G, mission, meta: meta || {}, onExit: (r) => afterBattle(G, B, r), onPlayerTurn: (b) => autosaveTurn(G, b) };
    if (reset) OV.Scenes.set('battlescape', params);
    else OV.Scenes.replace('battlescape', params);
  }
  function startBattle(mission, meta) {
    const G = OV.Game.G;
    if (!G || !mission) {
      OV.Dom.modal({ title: T('scr.br.errorTitle'), body: T('cp.br.noGame'), cls: 'alert' });
      return false;
    }
    if (!OV.SceneDefs.battlescape) {
      OV.Dom.modal({ title: T('scr.br.errorTitle'), body: T('scr.br.noBattle'), cls: 'alert' });
      return false;
    }
    let B;
    try {
      B = OV.Battle.create(mission);
    } catch (e) {
      OV.Dom.modal({ title: T('scr.br.errorTitle'), body: esc(T('scr.br.error', { msg: e && e.message ? e.message : String(e) })), cls: 'alert' });
      return false;
    }
    OV.Game.B = B;
    sfx('ui_confirm');
    enterBattle(G, B, mission, meta || mission.meta || {}, false);
    return true;
  }

  // tira de G.events os eventos destes tipos (os restantes ficam para o Geoscape)
  function takeEvents(G, types) {
    const out = [];
    if (!Array.isArray(G.events)) return out;
    for (let i = G.events.length - 1; i >= 0; i--) if (types[G.events[i].t]) out.unshift(G.events.splice(i, 1)[0]);
    return out;
  }

  const finished = new WeakSet();
  let lastWin = null;
  function afterBattle(G, B, result) {
    if (!G || !B || finished.has(B)) return null;
    finished.add(B);
    let model;
    const am = G.activeMission;
    const pre = am ? preMissionFor(G, am.startedT) : null;
    const tg = am && am.siteRef && am.siteRef.kind !== 'cydonia' ? C().targetOf(G, am.siteRef) : null;
    const loc = tg ? { lon: tg.lon, lat: tg.lat } : null;
    // projetos de investigação que o material recuperado abre (comparação antes/depois do fecho da missão)
    const craft0 = am ? C().findCraft(G, am.craftId) : null;
    const rBase = craft0 ? craft0.baseId : G.bases[0] ? G.bases[0].id : null;
    let before = null;
    try { before = rBase ? C().availableResearch(G, rBase) : null; } catch (e) { before = null; }
    try {
      model = OV.Battle.outcome(B) ? C().finishMission(G, B) : C().abortMission(G, B);
    } catch (e) {
      OV.Game.B = null;
      OV.Dom.modal({ title: T('scr.br.errorTitle'), body: esc(errText(e)), cls: 'alert' });
      popToGeo(G);
      return null;
    }
    OV.Game.B = null;
    // a batalha está resolvida: a gravação do último turno ficaria obsoleta (e «Continuar» podia reabri-la)
    try { if (OV.Save && OV.Save.remove) OV.Save.remove('autoTurn'); } catch (e) { /* armazenamento indisponível */ }
    takeEvents(G, { victory: 1, gameOver: 1 });
    if (model.outcome === 'continue') autosave(G, { silent: true });
    if (model.outcome === 'victory') lastWin = { squad: (B.units || []).filter((u) => u.origSide === 'xcom' && u.type === 'soldier').map((u) => u.soldierId), t: G.t };
    let newResearch = [];
    try { if (before && C().findBase(G, rBase)) newResearch = C().availableResearch(G, rBase).filter((id) => before.indexOf(id) < 0); } catch (e) { newResearch = []; }
    const lost = (model.debrief && model.debrief.result) !== 'win';
    const retry = lost && (G.difficulty | 0) <= 1 && pre ? pre : null;
    const p = { G, B, model, loc, result: result || null, retry, research: { baseId: rBase, topics: newResearch }, onDone: () => afterDebrief(G, model) };
    const top = OV.Scenes.top();
    if (top && top.id === 'battlescape') OV.Scenes.replace('cdebrief', p);
    else OV.Scenes.push('cdebrief', p);
    return model;
  }
  function afterDebrief(G, model) {
    if (model.outcome === 'victory' || G.flags.won) return victory(G);
    if (model.outcome === 'gameOver' || G.flags.lost) return gameOver(G, G.flags.lostReason || 'cydonia');
    popToGeo(G);
    music('geoscape');
    return null;
  }

  // retomar uma gravação da campanha (com B: a batalha continua e o resultado aplica-se no fim)
  function resume(st) {
    const G = st && st.G;
    if (!G) return false;
    const B = st.B || null;
    OV.Game.G = G;
    OV.Game.B = B;
    if (B) {
      if (!OV.SceneDefs.battlescape) {
        OV.Dom.modal({ title: T('scr.load.title'), body: T('scr.load.noScene') });
        return false;
      }
      let meta = {};
      const am = G.activeMission;
      try { if (am) meta = C().briefingMeta(G, { craftId: am.craftId, meta: { campaign: { siteRef: am.siteRef } } }); } catch (e) { meta = {}; }
      enterBattle(G, B, B.mission, meta, true);
      OV.Dom.toast(T('cp.resume.battle', { turn: B.turn | 0 }), null, 'info');
      return true;
    }
    if (G.flags.won) { victory(G); return true; }
    if (G.flags.lost) { gameOver(G, G.flags.lostReason || 'council'); return true; }
    openGeo(G);
    OV.Dom.toast(T('cp.resume.geo', { date: dateText(G.t) }), null, 'info');
    return true;
  }

  // ---- relatório da missão (campanha) ----------------------------------------------------------------------
  OV.SceneDefs.cdebrief = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G, B = p.B, model = p.model;
    const deb = model.debrief;
    const result = deb.result || 'abort';
    const M = OV.Battle.normalizeMission(model.mission || B.mission);
    const meta = model.meta || {};
    let contBtn = null, sc = null;

    const unitBySid = new Map();
    for (const u of B.units) if (u.origSide === 'xcom' && u.type === 'soldier') unitBySid.set(u.soldierId !== null && u.soldierId !== undefined ? u.soldierId : u.id, u);
    const deadById = new Map();
    for (const d of G.dead) deadById.set(d.id, d);
    function who(sid) {
      const u = unitBySid.get(sid) || {};
      const s = G.soldiers[sid] || deadById.get(sid) || {};
      return {
        name: s.name || u.name || '?', rankBefore: u.rank !== undefined ? u.rank | 0 : s.rank | 0, rank: s.rank !== undefined ? s.rank | 0 : u.rank | 0,
        nat: s.nat || u.nat, female: s.female !== undefined ? s.female : u.female, portraitSeed: s.portraitSeed !== undefined ? s.portraitSeed : u.portraitSeed,
        armour: s.armour || u.armourId, kills: u.kills | 0, missions: s.missions | 0, woundDays: G.soldiers[sid] ? G.soldiers[sid].woundDays | 0 : 0,
      };
    }
    const rankLabel = (r) => { const d = D().soldierRank(r | 0); return d ? T(d.abbrKey) : ''; };
    const itemsGrid = (bag, size) => el('div', { class: 'scr-items' }, Object.keys(bag).sort().map((id) =>
      el('div', { class: 'scr-item' }, ui.itemIconEl(id, size || 36), el('span', { text: itemName(id) }), el('b', { text: '×' + bag[id] }))));
    const unitName = (ty) => (D().units[ty] ? T(D().units[ty].nameKey) : ty);

    function build(root) {
      const total = deb.score | 0;
      const rating = OV.Screens.missionRating(total);
      // base de origem da nave (guardada antes do fecho: com a nave perdida já não se chega a ela pela nave)
      const base = (p.research && p.research.baseId ? C().findBase(G, p.research.baseId) : null)
        || (C().findCraft(G, M.craftId) && C().findBase(G, C().findCraft(G, M.craftId).baseId)) || G.bases[0] || null;
      const where = [meta.cityKey ? T(meta.cityKey) : null, meta.countryKey ? T(meta.countryKey) : null, meta.regionKey ? T(meta.regionKey) : null].filter(Boolean);
      if (!meta.countryKey && p.loc) {
        const id = OV.GMath.countryAtMap(p.loc.lon, p.loc.lat);
        if (id && OV.T.has('country.' + id)) where.splice(where.length - (meta.regionKey ? 1 : 0), 0, T('country.' + id));
      }

      // pontuação
      const anyIcon = (deb.lines || []).some((l) => l.itemId);
      const rows = (deb.lines || []).map((l) => el('tr', null,
        el('td', { class: 'scr-sl' }, l.itemId ? ui.itemIconEl(l.itemId, 26) : anyIcon ? el('span', { class: 'scr-sl-gap' }) : null, el('span', { text: T(l.key) })),
        el('td', { class: 'scr-sn', text: '×' + (l.n | 0) }),
        el('td', { class: 'scr-sp ' + (l.points > 0 ? 'good' : l.points < 0 ? 'bad' : ''), text: signed(l.points) })));
      const scoreSec = ui.panelSection(T('bs.debrief.score'),
        rows.length ? el('table', { class: 'scr-score' }, el('tbody', null, rows)) : el('p', { class: 'scr-muted', text: T('scr.db.noScore') }),
        el('div', { class: 'scr-total r-' + rating },
          el('span', { text: T('bs.debrief.total') }), el('b', { text: signed(total) }),
          el('span', { class: 'scr-rating' }, el('i', { text: T('scr.db.rating') }), T('rating.' + rating))),
        meta.regionKey ? el('p', { class: 'cp-note info', text: T('cp.db.scoreTo', { region: T(meta.regionKey) }) }) : null);

      // alienígenas: abatidos, capturados, contenção
      const killed = {}, captured = {};
      for (const u of B.units) if (u.origSide === 'alien' && u.status === 'dead' && !u.crashDead) killed[u.type] = (killed[u.type] | 0) + 1;
      for (const c of deb.captured || []) captured[c.unitType] = (captured[c.unitType] | 0) + 1;
      const types = [...new Set(Object.keys(killed).concat(Object.keys(captured)))].sort();
      const contain = [];
      for (const ty of Object.keys(model.capturedStored || {})) contain.push(el('li', { class: 'good', text: T('cp.db.contained', { name: unitName(ty), n: model.capturedStored[ty], base: baseName(base) }) }));
      for (const ty of Object.keys(model.capturedLost || {})) contain.push(el('li', { class: 'bad', text: T('cp.db.containLost', { name: unitName(ty), n: model.capturedLost[ty] }) }));
      const alienSec = ui.panelSection(T('scr.db.aliens'),
        types.length ? el('div', { class: 'scr-aliens' }, types.map((ty) => el('div', { class: 'scr-alien-row' },
          el('div', { class: 'scr-alien-pic' }, ui.unitSpriteEl(ty, 40)),
          el('span', { class: 'scr-alien-name', text: unitName(ty) }),
          killed[ty] ? el('span', { class: 'scr-tag bad', text: T('scr.db.killed') + ' ×' + killed[ty] }) : null,
          captured[ty] ? el('span', { class: 'scr-tag good', text: T('scr.db.captured') + ' ×' + captured[ty] }) : null))) : el('p', { class: 'scr-muted', text: T('scr.db.noAliens') }),
        contain.length ? el('ul', { class: 'cp-warns' }, contain) : null);

      // baixas
      const fallen = (deb.dead || []).map((sid) => ({ sid, kia: true })).concat((deb.mia || []).map((sid) => ({ sid, kia: false })));
      const lossSec = ui.panelSection(T('scr.db.losses'),
        fallen.length ? el('div', { class: 'scr-memorial' },
          el('div', { class: 'scr-mem-title', text: T('scr.db.memorial') }),
          fallen.map((f) => {
            const w = who(f.sid);
            return el('div', { class: 'scr-mem' }, ui.portraitEl({ portraitSeed: w.portraitSeed, female: w.female, nat: w.nat, armour: w.armour, rank: w.rankBefore }, 48, 'mem'),
              el('div', null,
                el('div', { class: 'scr-mem-name' }, el('span', { class: 'scr-rank r' + w.rankBefore, text: rankLabel(w.rankBefore) }), el('b', { text: w.name })),
                el('div', { class: 'scr-muted', text: [T(f.kia ? 'scr.db.kia' : 'scr.db.mia'), Tn('cp.db.missions', w.missions + 1), w.kills ? Tn('bs.debrief.soldier.kills', w.kills) : null].filter(Boolean).join(' · ') })));
          })) : el('p', { class: 'scr-good-note', text: T('scr.db.noLosses') }));

      // feridos (dias na enfermaria)
      const wounded = Object.keys(deb.wounded || {});
      const woundSec = wounded.length ? ui.panelSection(T('bs.debrief.wounded'),
        el('div', { class: 'scr-wounded' }, wounded.map((sid) => {
          const w = who(sid);
          return el('div', { class: 'scr-wound' }, el('b', { text: w.name }),
            el('span', { class: 'bad', text: T('scr.db.hpLost', { n: deb.wounded[sid] }) + (w.woundDays ? ' · ' + Tn('cp.db.woundDays', w.woundDays) : '') }));
        }))) : null;

      // material: entregue no armazém, perdido, armazém sobrelotado
      const stored = model.stored || {};
      const lost = deb.equipmentLost || {};
      const recSec = ui.panelSection(model.craftLost ? T('cp.db.storedLost') : T('cp.db.stored', { base: baseName(base) }),
        model.craftLost ? el('p', { class: 'cp-note bad', text: T('cp.db.craftLost') })
          : Object.keys(stored).length ? itemsGrid(stored, 36) : el('p', { class: 'scr-muted', text: T('scr.db.nothing') }),
        Object.keys(lost).length && !model.craftLost ? el('div', { class: 'cp-lost' }, el('div', { class: 'cp-k', text: T('bs.debrief.equipmentLost') }), itemsGrid(lost, 26)) : null,
        model.storage && model.storage.over ? el('p', { class: 'cp-note bad', text: T('cp.db.storageOver', { used: model.storage.used, cap: model.storage.cap }) }) : null);

      // investigação que o material recuperado abriu (o momento «e agora?»)
      const rs = p.research && p.research.topics.length && model.outcome === 'continue' && OV.BaseUI ? p.research : null;
      const topicName = (id) => (OV.T.has('research.' + id) ? T('research.' + id) : id);
      researchBtn = rs ? btn(T('cp.db.research.open'), { cls: 'small', key: 'I', tip: T('cp.db.research.tip'), onClick: openResearch }) : null;
      const resSec = rs ? ui.panelSection(T('cp.db.research'),
        el('div', { class: 'cp-newres' }, rs.topics.map((id) => el('span', { class: 'scr-tag good', text: topicName(id) }))),
        el('div', { class: 'cp-newres-act' }, researchBtn)) : null;

      // progressão e promoções
      const prog = model.progression || [];
      const extraPromo = (model.promotions || []).filter((pr) => !prog.some((g) => g.soldierId === pr.id));
      const progSec = prog.length || extraPromo.length ? ui.panelSection(T('scr.db.progress'),
        el('div', { class: 'scr-prog' }, prog.map((g) => {
          const w = who(g.soldierId);
          const gainEls = Object.keys(g.gains || {}).map((k) => el('span', { class: 'scr-gain' }, el('i', { text: T('stat.' + k + '.abbr') }), '+' + g.gains[k]));
          const promo = g.promoted !== null && g.promoted !== undefined ? D().soldierRank(g.promoted) : null;
          return el('div', { class: 'scr-prog-row' },
            ui.portraitEl({ portraitSeed: w.portraitSeed, female: w.female, nat: w.nat, armour: w.armour, rank: w.rank }, 36),
            el('div', { class: 'scr-prog-name' }, el('span', { class: 'scr-rank r' + w.rank, text: rankLabel(w.rank) }), el('b', { text: w.name }),
              g.kills ? el('span', { class: 'scr-muted', text: ' · ' + Tn('bs.debrief.soldier.kills', g.kills) }) : null),
            el('div', { class: 'scr-gains' }, gainEls.length ? gainEls : el('span', { class: 'scr-muted', text: T('scr.db.noGains') })),
            promo ? el('span', { class: 'scr-promo', text: T('scr.db.promoted', { rank: T(promo.nameKey) }) }) : null);
        })),
        extraPromo.length ? el('p', { class: 'cp-note good', text: T('cp.db.alsoPromoted', { list: extraPromo.map((pr) => {
          const s = G.soldiers[pr.id];
          const r = D().soldierRank(pr.to);
          return (s ? s.name : pr.id) + ' (' + (r ? T(r.nameKey) : '') + ')';
        }).join(', ') }) }) : null) : null;

      contBtn = btn(T('scr.db.continue'), { cls: 'primary scr-big', key: 'Enter', tip: T(model.outcome === 'continue' ? 'cp.db.continue.tip' : 'cp.db.end.tip'), sound: 'ui_confirm', onClick: cont });
      // derrota em Recruta/Veterano: repetir a partir da gravação «Antes da missão»
      retryBtn = p.retry ? btn(T('cp.db.retry'), { key: 'R', tip: T('cp.db.retry.tip'), extra: T('cp.db.retry.extra'), onClick: retry }) : null;
      root.append(el('div', { class: 'scr-panel scr-deb cp-deb res-' + result },
        el('header', { class: 'scr-banner' },
          el('div', { class: 'scr-kicker', text: T('bs.debrief.title') + ' · ' + OV.Screens.missionTitle(M, meta) }),
          el('h1', { class: 'scr-result', text: T('scr.db.result.' + result) }),
          el('div', { class: 'scr-result-sub', text: [T('scr.db.sub.' + result), deb.turns ? Tn('scr.db.turns', deb.turns | 0) : null, where.join(' · ') || null].filter(Boolean).join(' · ') }),
          el('div', { class: 'scr-deb-cause' }, OV.Screens.lossNotes ? OV.Screens.lossNotes(B, result) : null)),
        el('div', { class: 'scr-deb-body' },
          el('div', { class: 'scr-deb-col' }, scoreSec, alienSec),
          el('div', { class: 'scr-deb-col' }, lossSec, woundSec, recSec, resSec),
          progSec ? el('div', { class: 'scr-deb-wide' }, progSec) : null),
        el('footer', { class: 'scr-foot' },
          el('span', { class: 'scr-hint', text: T('cp.db.hint', { date: dateText(G.t) }) }),
          el('div', { class: 'scr-foot-btns' }, retryBtn, contBtn))));
    }
    let left = false, researchBtn = null, retryBtn = null;
    function retry() {
      if (left || !p.retry) return;
      left = true;
      retryMission(G, p.retry);
    }
    function cont() {
      if (left) return;
      left = true;
      if (typeof p.onDone === 'function') p.onDone(model);
    }
    // continuar e abrir logo a investigação da base (com a escolha de projeto, se houver cientistas livres)
    function openResearch() {
      if (left) return;
      const baseId = p.research && p.research.baseId;
      cont();
      if (baseId && OV.BaseUI && OV.BaseUI.open && OV.Scenes.top() && OV.Scenes.top().id === 'geoscape') OV.BaseUI.open(G, baseId, 'research', { pick: true });
    }
    sc = ui.makeScreen('cdebrief', {
      cls: 'scr-debrief',
      backdrop: { dim: 0.6, tint: result === 'win' ? null : 'rgba(110,16,10,0.10)' },
      build(root, s) { sc = s; build(root); music('menu'); },
      focus: () => contBtn,
      keys(ev) {
        if (ev.key === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === contBtn) { sfx('ui_confirm'); cont(); return true; } }
        if ((ev.key === 'i' || ev.key === 'I') && researchBtn) { sfx('ui_click'); openResearch(); return true; }
        if ((ev.key === 'r' || ev.key === 'R') && retryBtn && !ev.repeat) { sfx('ui_click'); retry(); return true; }
        return false;
      },
    });
    return sc;
  };
  // carrega a gravação «Antes da missão» e volta a abrir o briefing da mesma missão (mesma nave, mesmo local)
  function retryMission(G0, pm) {
    let st = null;
    try { st = loadExtra('preMission'); } catch (e) { st = null; }
    if (!st || !st.G) {
      OV.Dom.modal({ title: T('scr.load.title'), body: esc(T('cp.db.retry.fail')), cls: 'alert' });
      return false;
    }
    resume(st);
    const G = st.G;
    const ok = pm && pm.siteRef && pm.craftId && C().findCraft(G, pm.craftId) && (pm.siteRef.kind === 'cydonia' || C().targetOf(G, pm.siteRef));
    if (ok) launchMission(G, pm.siteRef, pm.craftId);
    return true;
  }

  // ================================================================================================
  // Relatório mensal (sobreposição sobre o Geoscape)
  // ================================================================================================
  let pendingEnd = null;
  const ratingCls = (key) => 'r-' + String(key || 'rating.ok').replace('rating.', '');
  function overlay(id, spec) {
    const ui = SUI();
    return ui.makeScreen(id, Object.assign({ isScreen: false, backdrop: false, cls: 'scr-overlay' }, spec));
  }
  function barRow(label, v, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (Math.abs(v) / max) * 100)) : 0;
    return el('div', { class: 'cp-bar ' + (cls || '') },
      el('span', { class: 'cp-bar-l', text: label }),
      el('span', { class: 'cp-bar-t' }, el('i', { style: { width: pct.toFixed(1) + '%' } })),
      el('b', { class: 'cp-bar-v', text: signed(v) }));
  }

  // parcela dos ataques sem resposta nos pontos alienígenas do mês (registo do Geoscape em G.ui.terrorLog)
  function monthAlienSplit(G, R) {
    const alien = R.alien | 0;
    const log = G && G.ui && G.ui.terrorLog ? G.ui.terrorLog[R.month] : null;
    const pts = log ? Math.min(alien, log.pts | 0) : 0;
    if (!log || !log.n || pts <= 0) return [{ key: 'cp.mr.alien', pts: alien }];
    return [{ key: 'cp.mr.alienTerror', n: log.n, pts }, { key: 'cp.mr.alienOther', pts: Math.max(0, alien - pts) }];
  }
  // totais da tabela do financiamento: antes, variação e depois (= receita do próximo mês)
  function fundingTotals(R) {
    const out = { before: 0, delta: 0, after: 0 };
    for (const c of R.countries || []) { out.before += c.before | 0; out.delta += c.delta | 0; out.after += c.after | 0; }
    return out;
  }

  OV.SceneDefs.monthReport = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G, R = p.report || (G && G.reports && G.reports[G.reports.length - 1]) || null;
    let sc = null, okBtn = null, closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (OV.Scenes.top() === sc) OV.Scenes.pop();
      if (typeof p.onClose === 'function') p.onClose();
      const end = pendingEnd;
      pendingEnd = null;
      if (end) { if (end.kind === 'victory') victory(G); else gameOver(G, end.reason); }
    }
    function build(root) {
      if (!R) { root.append(el('div', { class: 'scr-panel cp-mr' }, ui.header(T('cp.mr.kicker'), '—'))); return; }
      const thr = tune('RATING_THRESHOLD', [-900, -700, -500])[G.difficulty | 0];
      const max = Math.max(1, Math.abs(R.xcom | 0), Math.abs(R.alien | 0), Math.abs(R.research | 0), Math.abs(R.councilBonus | 0));
      const split = monthAlienSplit(G, R);
      const scoreSec = ui.panelSection(T('cp.mr.score'),
        barRow(T('cp.mr.xcom'), R.xcom | 0, max, 'good'),
        barRow(T('cp.mr.research'), R.research | 0, max, 'good'),
        (R.councilBonus | 0) ? barRow(T('cp.mr.bonus'), R.councilBonus | 0, max, 'good') : null,
        split.map((x) => barRow(x.n ? Tn(x.key, x.n) : T(x.key), -x.pts, max, 'bad')),
        el('div', { class: 'scr-total ' + ratingCls(R.ratingKey) },
          el('span', { text: T('cp.mr.rating') }), el('b', { text: signed(R.rating) }),
          el('span', { class: 'scr-rating' }, el('i', { text: T('cp.mr.threshold', { n: OV.U.fmtInt(thr) }) }), T(R.ratingKey))));
      // pontos por região (quando o relatório os traz)
      const reg = R.regions && typeof R.regions === 'object' ? Object.keys(R.regions).map((id) => ({ id, x: R.regions[id].xcom | 0, a: R.regions[id].alien | 0 })).filter((r) => r.x || r.a) : null;
      let regSec = null;
      if (reg && reg.length) {
        reg.sort((a, b) => (b.a - b.x) - (a.a - a.x));
        const rmax = Math.max(1, ...reg.map((r) => Math.max(Math.abs(r.x), Math.abs(r.a))));
        regSec = ui.panelSection(T('cp.mr.regions'),
          el('table', { class: 'cp-tbl cp-reg' },
            el('thead', null, el('tr', null, el('th', { text: T('cp.mr.region') }), el('th', { text: T('cp.mr.xcomShort') }), el('th', { text: T('cp.mr.alienShort') }))),
            el('tbody', null, reg.map((r) => el('tr', { class: r.a > r.x ? 'worse' : '' },
              el('td', { text: T('region.' + r.id) }),
              el('td', null, el('span', { class: 'cp-mini good' }, el('i', { style: { width: (100 * Math.abs(r.x) / rmax).toFixed(0) + '%' } })), el('b', { class: 'good', text: OV.U.fmtInt(r.x) })),
              el('td', null, el('span', { class: 'cp-mini bad' }, el('i', { style: { width: (100 * Math.abs(r.a) / rmax).toFixed(0) + '%' } })), el('b', { class: 'bad', text: OV.U.fmtInt(r.a) })))))));
      }
      // financiamento por país
      const tot = fundingTotals(R);
      const crows = (R.countries || []).map((c) => {
        const def = D().countries[c.id];
        const d = c.delta | 0;
        const arrow = c.pact ? '✕' : d > 0 ? '▲' : d < 0 ? '▼' : '—';
        return el('tr', { class: c.pact ? 'pact' : d > 0 ? 'up' : d < 0 ? 'down' : '' },
          el('td', null, el('span', { class: 'cp-arrow', text: arrow }), def ? T(def.nameKey) : c.id, c.newPact ? el('span', { class: 'scr-tag bad cp-pact', text: T('cp.mr.newPact') }) : c.pact ? el('span', { class: 'scr-tag bad cp-pact', text: T('cp.mr.pact') }) : null),
          el('td', { class: 'num', text: money(c.before) }),
          el('td', { class: 'num ' + (d > 0 ? 'good' : d < 0 ? 'bad' : 'muted'), text: d ? (d > 0 ? '+' : '−') + money(Math.abs(d)).replace('−', '') : '—' }),
          el('td', { class: 'num', text: money(c.after) }));
      });
      const fundSec = ui.panelSection(T('cp.mr.funding'),
        el('table', { class: 'cp-tbl cp-fund' },
          el('thead', null, el('tr', null, el('th', { text: T('cp.mr.country') }), el('th', { class: 'num', text: T('cp.mr.before') }), el('th', { class: 'num', text: T('cp.mr.change') }), el('th', { class: 'num', text: T('cp.mr.after') }))),
          el('tbody', null, crows),
          el('tfoot', null, el('tr', null, el('td', { text: T('cp.mr.total') }), el('td', { class: 'num', text: money(tot.before) }),
            el('td', { class: 'num ' + (tot.delta > 0 ? 'good' : tot.delta < 0 ? 'bad' : 'muted'), text: tot.delta ? (tot.delta > 0 ? '+' : '−') + money(Math.abs(tot.delta)).replace('−', '') : '—' }),
            el('td', { class: 'num', text: money(tot.after) })))));
      // contas do mês
      const up = R.upkeep || {};
      const net = (R.income | 0) - (up.total | 0);
      const finSec = ui.panelSection(T('cp.mr.finance'),
        el('div', { class: 'cp-fin' },
          kv(T('cp.mr.income'), money(R.income), 'good'),
          kv(T('cp.mr.upkeep.facilities'), '−' + money(up.facilities | 0)),
          kv(T('cp.mr.upkeep.salaries'), '−' + money(up.salaries | 0)),
          kv(T('cp.mr.upkeep.crafts'), '−' + money(up.crafts | 0)),
          kv(T('cp.mr.net'), (net >= 0 ? '+' : '') + money(net), net >= 0 ? 'good' : 'bad'),
          kv(T('cp.mr.funds'), money(R.fundsBefore) + ' → ' + money(R.fundsAfter), (R.fundsAfter | 0) < 0 ? 'bad' : ''),
          kv(T('cp.mr.nextIncome'), money(tot.after), tot.delta < 0 ? 'bad' : 'good')));
      // avisos
      const warns = [];
      if (R.defeat) warns.push({ cls: 'bad', text: T('cp.mr.warn.defeat.' + R.defeat) });
      if (R.debtWarning) warns.push({ cls: 'bad', text: T('cp.mr.warn.debt', { limit: money(tune('DEBT_LIMIT', -1000000)) }) });
      else if ((R.fundsAfter | 0) < 0 && !R.defeat) warns.push({ cls: 'warn', text: T('cp.mr.warn.negative') });
      const terrorPts = OV.Missions && OV.Missions.expiredPoints ? OV.Missions.expiredPoints(G) : 1000;
      if ((R.badMonths | 0) === 1 && !R.defeat) warns.push({ cls: 'bad', text: T('cp.mr.warn.badMonth') + ' ' + T(split.length > 1 ? 'cp.mr.advice.terror' : 'cp.mr.advice', { points: OV.U.fmtInt(terrorPts) }) });
      const pacts = (R.countries || []).filter((c) => c.newPact);
      if (pacts.length) warns.push({ cls: 'bad', text: T('cp.mr.warn.pacts', { list: pacts.map((c) => (D().countries[c.id] ? T(D().countries[c.id].nameKey) : c.id)).join(', ') }) });
      if (R.alienBaseRevealed) {
        const ab = C().findAlienBase(G, R.alienBaseRevealed);
        warns.push({ cls: 'info', text: T('cp.mr.warn.alienBase', { region: ab && ab.region ? T('region.' + ab.region) : '—' }) });
      }
      okBtn = btn(T('cp.mr.continue'), { cls: 'primary scr-big', key: 'Enter', tip: T(R.defeat || G.flags.lost ? 'cp.mr.continue.end' : 'cp.mr.continue.tip'), sound: 'ui_confirm', onClick: close });
      root.append(el('div', { class: 'scr-ov-back' }),
        el('div', { class: 'scr-panel cp-mr ' + ratingCls(R.ratingKey), role: 'dialog', 'aria-modal': 'true', 'aria-label': T('cp.mr.kicker') },
          el('header', { class: 'scr-head cp-mr-head' },
            el('div', null,
              el('div', { class: 'scr-kicker', text: T('cp.mr.kicker') }),
              el('h1', { class: 'scr-title', text: monthTitle(R.y, R.m) })),
            el('div', { class: 'cp-mr-rating' }, el('span', { class: 'cp-k', text: T('cp.mr.rating') }), el('b', { text: T(R.ratingKey) }))),
          el('div', { class: 'cp-mr-body scr-scroll' },
            el('blockquote', { class: 'cp-council ' + String(R.councilKey || '').replace('council.', 'c-') },
              el('div', { class: 'cp-k', text: T('cp.mr.council') }), el('p', { text: T(R.councilKey || 'council.satisfied') })),
            warns.length ? el('ul', { class: 'cp-warns cp-mr-warns' }, warns.map((w) => el('li', { class: w.cls, text: w.text }))) : null,
            el('div', { class: 'cp-mr-grid' },
              el('div', { class: 'scr-deb-col' }, scoreSec, regSec, finSec),
              el('div', { class: 'scr-deb-col' }, fundSec))),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('cp.mr.hint') }),
            el('div', { class: 'scr-foot-btns' }, okBtn))));
    }
    sc = overlay('monthReport', {
      trap: '.cp-mr',
      build(root, s) { sc = s; build(root); sfx('monthly_report'); },
      focus: () => okBtn,
      keys(ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { sfx('ui_confirm'); close(); return true; }
        return false;
      },
      back: close,
    });
    return sc;
  };
  function monthReport(G, report) {
    return new Promise((resolve) => {
      OV.Scenes.push('monthReport', { G, report, onClose: resolve });
    });
  }

  // ================================================================================================
  // Fim de jogo e vitória
  // ================================================================================================
  function statsGrid(G) {
    const s = G.stats || {};
    const days = Math.floor((G.t | 0) / 86400);
    const items = [
      ['cp.st.date', dateText(G.t, false)], ['cp.st.days', OV.U.fmtInt(days)],
      ['cp.st.won', OV.U.fmtInt(s.missionsWon | 0)], ['cp.st.lost', OV.U.fmtInt((s.missionsLost | 0) + (s.missionsAborted | 0))],
      ['cp.st.ufos', OV.U.fmtInt(s.ufosShotDown | 0) + ' / ' + OV.U.fmtInt(s.ufosDetected | 0)], ['cp.st.killed', OV.U.fmtInt(s.aliensKilled | 0)],
      ['cp.st.captured', OV.U.fmtInt(s.aliensCaptured | 0)], ['cp.st.civilians', OV.U.fmtInt(s.civiliansSaved | 0)],
      ['cp.st.soldiersLost', OV.U.fmtInt(s.soldiersLost | 0)], ['cp.st.craftsLost', OV.U.fmtInt(s.craftsLost | 0)],
      ['cp.st.research', OV.U.fmtInt((G.researched || []).length)], ['cp.st.score', OV.U.fmtInt(((G.score && G.score.all.xcom) | 0) + ((G.score && G.score.all.research) | 0)) + ' / ' + OV.U.fmtInt((G.score && G.score.all.alien) | 0)],
    ];
    return el('div', { class: 'cp-stats' }, items.map(([k, v]) => el('div', { class: 'cp-stat' }, el('b', { text: v }), el('span', { text: T(k) }))));
  }
  function memorial(G, limit) {
    const ui = SUI();
    const list = (G.dead || []).slice().reverse();
    if (!list.length) return el('p', { class: 'scr-good-note', text: T('cp.go.noDead') });
    const shown = list.slice(0, limit || 60);
    return el('div', { class: 'cp-memgrid' },
      shown.map((d) => {
        const r = D().soldierRank(d.rank | 0);
        return el('div', { class: 'cp-memcard' }, ui.portraitEl(d, 44, 'mem'),
          el('div', null,
            el('div', { class: 'scr-mem-name' }, el('span', { class: 'scr-rank r' + (d.rank | 0), text: r ? T(r.abbrKey) : '' }), el('b', { text: d.name })),
            el('div', { class: 'scr-muted small', text: [T('cp.cause.' + (d.cause || 'kia')), dateText(d.diedT | 0, false), Tn('bs.debrief.soldier.kills', d.kills | 0)].join(' · ') })));
      }),
      list.length > shown.length ? el('p', { class: 'scr-muted', text: Tn('cp.go.moreDead', list.length - shown.length) }) : null);
  }
  function toMenu() {
    OV.Game.G = null;
    OV.Game.B = null;
    OV.Scenes.set('menu');
  }

  OV.SceneDefs.gameOver = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G;
    const reason = p.reason || (G && G.flags.lostReason) || 'council';
    let menuBtn = null, sc = null;
    sc = ui.makeScreen('gameOver', {
      cls: 'cp-end',
      backdrop: { dim: 0.55, tint: 'rgba(120,16,10,0.16)' },
      build(root, s) {
        sc = s;
        stinger('defeat');
        music('menu');
        menuBtn = btn(T('cp.end.menu'), { cls: 'primary scr-big', key: 'Enter', tip: T('cp.end.menu.tip'), onClick: toMenu });
        root.append(el('div', { class: 'scr-panel cp-go' },
          el('header', { class: 'scr-banner' },
            el('div', { class: 'scr-kicker', text: T('cp.go.kicker') }),
            el('h1', { class: 'scr-result', text: T('cp.go.title.' + reason) }),
            el('div', { class: 'scr-result-sub', text: T('cp.go.text.' + reason) })),
          el('div', { class: 'cp-end-body scr-scroll' },
            ui.panelSection(T('cp.end.stats'), statsGrid(G)),
            ui.panelSection(T('cp.go.memorial', { n: (G.dead || []).length }), memorial(G, 60))),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('cp.go.hint') }),
            el('div', { class: 'scr-foot-btns' },
              btn(T('scr.menu.load'), { key: 'L', tip: T('scr.menu.load.hint'), onClick: () => loadDialog() }),
              menuBtn))));
      },
      focus: () => menuBtn,
      keys(ev) {
        if (ev.key === 'Enter') { if (!activeIsButtonIn(sc.root) || document.activeElement === menuBtn) { toMenu(); return true; } return false; }
        if (ev.key === 'l' || ev.key === 'L') { loadDialog(); return true; }
        return false;
      },
    });
    return sc;
  };
  function gameOver(G, reason) {
    const top = OV.Scenes.top();
    if (top && top.id === 'monthReport') { pendingEnd = { kind: 'gameOver', reason }; return null; }
    OV.Game.B = null;
    return OV.Scenes.set('gameOver', { G, reason: reason || (G && G.flags.lostReason) || 'council' });
  }

  OV.SceneDefs.victory = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G;
    let menuBtn = null, sc = null;
    function team() {
      const ids = lastWin && lastWin.squad && lastWin.squad.length ? lastWin.squad : Object.keys(G.soldiers).sort((a, b) => (G.soldiers[b].kills | 0) - (G.soldiers[a].kills | 0)).slice(0, 12);
      const dead = new Map((G.dead || []).map((d) => [d.id, d]));
      return ids.map((id) => (G.soldiers[id] ? { s: G.soldiers[id], dead: false } : dead.has(id) ? { s: dead.get(id), dead: true } : null)).filter(Boolean);
    }
    sc = ui.makeScreen('victory', {
      cls: 'cp-end cp-vic-scr',
      backdrop: { dim: 0.35, tint: 'rgba(255,190,90,0.07)' },
      build(root, s) {
        sc = s;
        stinger('victory');
        music('menu');
        menuBtn = btn(T('cp.end.menu'), { cls: 'primary scr-big', key: 'Enter', tip: T('cp.end.menu.tip'), onClick: toMenu });
        const squad = team();
        root.append(el('div', { class: 'scr-panel cp-vic' },
          el('header', { class: 'scr-banner cp-vic-banner' },
            el('div', { class: 'cp-rays', 'aria-hidden': 'true' }),
            el('div', { class: 'scr-kicker', text: T('cp.vic.kicker') }),
            el('h1', { class: 'scr-result', text: T('cp.vic.title') }),
            el('div', { class: 'scr-result-sub', text: T('cp.vic.sub', { date: dateText(G.t, false) }) })),
          el('div', { class: 'cp-end-body scr-scroll' },
            el('p', { class: 'cp-epic', text: T('cp.vic.text') }),
            ui.panelSection(T('cp.vic.squad'),
              el('div', { class: 'cp-heroes' }, squad.map(({ s: x, dead }) => {
                const r = D().soldierRank(x.rank | 0);
                return el('div', { class: 'cp-hero' + (dead ? ' fallen' : '') }, ui.portraitEl(x, 64, dead ? 'mem' : ''),
                  el('div', { class: 'scr-mem-name' }, el('span', { class: 'scr-rank r' + (x.rank | 0), text: r ? T(r.abbrKey) : '' }), el('b', { text: x.name })),
                  el('div', { class: 'scr-muted small', text: dead ? T('cp.vic.fallen') : [Tn('cp.db.missions', x.missions | 0), Tn('bs.debrief.soldier.kills', x.kills | 0)].join(' · ') }));
              }))),
            ui.panelSection(T('cp.end.stats'), statsGrid(G)),
            (G.dead || []).length ? ui.panelSection(T('cp.vic.memorial', { n: G.dead.length }), memorial(G, 24)) : null),
          el('footer', { class: 'scr-foot' },
            el('span', { class: 'scr-hint', text: T('cp.vic.hint') }),
            el('div', { class: 'scr-foot-btns' }, menuBtn))));
      },
      focus: () => menuBtn,
      keys(ev) {
        if (ev.key === 'Enter') { toMenu(); return true; }
        return false;
      },
    });
    return sc;
  };
  function victory(G) {
    const top = OV.Scenes.top();
    if (top && top.id === 'monthReport') { pendingEnd = { kind: 'victory' }; return null; }
    OV.Game.B = null;
    return OV.Scenes.set('victory', { G });
  }

  // resultado de um ataque à base (evento baseDefence)
  function baseDefence(G, ev) {
    const e = ev || {};
    const base = C().findBase(G, e.baseId);
    const shots = (e.shots || []).map((s) => {
      const def = D().facilities[s.type];
      return el('li', { class: s.hit ? 'good' : 'muted', text: (def ? T(def.nameKey) : s.type) + ' — ' + (s.hit ? T('cp.bd.hit', { dmg: s.dmg | 0 }) : T('cp.bd.miss')) });
    });
    const dead = new Map((G.dead || []).map((d) => [d.id, d]));
    const names = (e.soldiersLost || []).map((id) => (dead.get(id) ? dead.get(id).name : id));
    const body = el('div', { class: 'cp-bd' },
      el('p', { class: 'modal-text', text: T('cp.bd.text.' + (e.result || 'repelled'), { base: base ? baseName(base) : T('cp.bd.theBase') }) }),
      shots.length ? el('div', null, el('div', { class: 'cp-k', text: T('cp.bd.defences') }), el('ul', { class: 'cp-warns' }, shots)) : el('p', { class: 'scr-muted', text: T('cp.bd.noDefences') }),
      names.length ? el('p', { class: 'modal-text bad', text: T('cp.bd.lost', { list: names.join(', ') }) }) : null);
    if (e.result === 'lost') sfx('explosion_large');
    else sfx(e.result === 'ufoDestroyed' ? 'ufo_crash' : 'ui_confirm');
    return OV.Dom.modal({ title: T('cp.bd.title.' + (e.result || 'repelled')), body, cls: e.result === 'lost' ? 'alert' : '', buttons: [{ label: T('common.ok'), value: true, kind: 'primary' }] });
  }

  // ================================================================================================
  // Gravar / carregar (sobreposição): ranhuras auto, autoTurn e 1–3; exportar, importar, apagar
  // ================================================================================================
  OV.SceneDefs.saveload = function (params) {
    const ui = SUI();
    const p = params || {};
    const G = p.G || null;
    let mode = p.mode === 'save' && G ? 'save' : 'load';
    let sc = null, listEl = null, tabs = null, sel = -1, rows = [], closeBtn = null;

    function entries() {
      const S = OV.Save;
      let raw = [];
      try { raw = S.list(); } catch (e) { raw = []; }
      const bySlot = {};
      for (const e of raw) bySlot[e.slot] = e;
      // ranhuras extra da interface (gravação automática anterior, antes da missão): só se existirem
      for (const x of EXTRA_SLOTS) { const e = extraSummary(x); if (e) bySlot[x] = e; }
      const order = S.SLOTS.slice(0, 2).concat(EXTRA_SLOTS, S.SLOTS.slice(2));
      const slots = mode === 'save' ? order.filter((s) => S.SLOTS.indexOf(s) >= 0 || bySlot[s]) : order.filter((s) => bySlot[s]);
      return slots.map((slot) => bySlot[slot] || { slot, empty: true });
    }
    const isExtra = (slot) => EXTRA_SLOTS.indexOf(slot) >= 0;
    const slotName = (slot) => (slot === 'auto' ? T('cp.sl.slot.auto') : slot === 'autoTurn' ? T('cp.sl.slot.autoTurn') : isExtra(slot) ? T('cp.sl.slot.' + slot) : T('cp.sl.slot.n', { n: slot }));
    const manual = (slot) => slot !== 'auto' && slot !== 'autoTurn' && !isExtra(slot);
    function rowEl(e, i) {
      const sub = [];
      if (!e.empty && !e.corrupt) {
        if (e.date) { const [y, m, d] = e.date.split('-').map(Number); sub.push(d + ' ' + T('cp.monthShort.' + (m - 1)) + ' ' + y); }
        if (e.funds !== null && e.funds !== undefined) sub.push(money(e.funds));
        if (e.difficulty !== null && e.difficulty !== undefined) sub.push(T('diff.' + e.difficulty));
      }
      const acts = el('div', { class: 'cp-sl-acts' });
      if (mode === 'save' && manual(e.slot)) acts.appendChild(btn(T(e.empty ? 'cp.sl.save' : 'cp.sl.overwrite'), { cls: 'small primary', key: 'Enter', tip: T('cp.sl.save.tip'), onClick: () => doSave(e) }));
      if (mode === 'load' && !e.empty && !e.corrupt) acts.appendChild(btn(T('cp.sl.open'), { cls: 'small primary', key: 'Enter', tip: T('cp.sl.open.tip'), onClick: () => doLoad(e) }));
      if (!e.empty && !e.corrupt) acts.appendChild(btn(T('cp.sl.export'), { cls: 'small', key: 'E', tip: T('cp.sl.export.tip'), onClick: () => doExport(e) }));
      if (!e.empty) acts.appendChild(btn(T('cp.sl.delete'), { cls: 'small danger', key: '⌫', tip: T('cp.sl.delete.tip'), onClick: () => doDelete(e) }));
      const row = el('div', { class: 'cp-sl-row' + (e.empty ? ' empty' : '') + (e.corrupt ? ' corrupt' : '') + (i === sel ? ' sel' : ''), role: 'option', dataset: { slot: e.slot }, tabindex: '-1' },
        el('span', { class: 'cp-sl-slot', text: slotName(e.slot) }),
        el('div', { class: 'cp-sl-main' },
          el('b', { text: e.empty ? T('cp.sl.empty') : e.corrupt ? T('cp.sl.corrupt') : e.label || slotName(e.slot) }),
          el('span', { class: 'scr-muted small' }, sub.join(' · '),
            e.battle ? el('span', { class: 'scr-tag cp-battle', text: T('cp.sl.inBattle') }) : null,
            !e.empty && e.savedAt ? el('span', { class: 'cp-sl-when', text: T('cp.sl.savedAt', { when: new Date(e.savedAt).toLocaleString('pt-PT') }) }) : null)),
        acts);
      row.addEventListener('pointerdown', () => { sel = i; mark(); });
      row.addEventListener('dblclick', (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('button'))) primary(e); });
      return row;
    }
    // linha inicial: a gravação mais recente (carregar) ou a primeira posição manual livre (gravar)
    function defaultSel() {
      if (mode === 'load') {
        let best = 0;
        rows.forEach((e, i) => { if (String(e.savedAt || '') > String(rows[best].savedAt || '')) best = i; });
        return best;
      }
      const free = rows.findIndex((e) => manual(e.slot) && e.empty);
      return free >= 0 ? free : Math.max(0, rows.findIndex((e) => manual(e.slot)));
    }
    function render() {
      const hadFocus = listEl.contains(document.activeElement) || document.activeElement === document.body;
      rows = entries();
      if (sel < 0) sel = defaultSel();
      if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
      OV.Dom.clear(listEl);
      if (!rows.length) listEl.appendChild(el('p', { class: 'scr-muted cp-sl-none', text: T('scr.load.empty') }));
      rows.forEach((e, i) => listEl.appendChild(rowEl(e, i)));
      if (tabs) tabs.refresh();
      // depois de gravar/apagar o foco fica na linha escolhida (não cai no <body>)
      if (hadFocus) { const r = listEl.querySelectorAll('.cp-sl-row')[sel]; if (r) r.focus({ preventScroll: true }); }
    }
    function mark() {
      [...listEl.querySelectorAll('.cp-sl-row')].forEach((r, i) => r.classList.toggle('sel', i === sel));
      const r = listEl.querySelectorAll('.cp-sl-row')[sel];
      if (r) { r.scrollIntoView({ block: 'nearest' }); r.focus({ preventScroll: true }); }
    }
    function primary(e) {
      if (!e) return;
      if (mode === 'save' && manual(e.slot)) doSave(e);
      else if (mode === 'load' && !e.empty && !e.corrupt) doLoad(e);
    }
    function doSave(e) {
      const go = () => {
        const r = OV.Save.save(e.slot, G, null, { label: saveLabel(G) });
        if (r.ok) { sfx('ui_confirm'); OV.Dom.toast(T('cp.sl.saved', { slot: slotName(e.slot) }), null, 'good'); render(); return; }
        sfx('ui_deny');
        if (r.reason === 'quota') offerExport(G, null);
        else OV.Dom.modal({ title: T('cp.sl.title.save'), body: esc(r.reason === 'busy' ? T('save.err.busy') : writeText(r.reason)), cls: 'alert' });
      };
      if (e.empty) { go(); return; }
      OV.Dom.modal({
        title: T('cp.sl.overwrite.title'), body: esc(T('cp.sl.overwrite.body', { slot: slotName(e.slot), label: e.label || slotName(e.slot) })),
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('cp.sl.overwrite'), value: true, kind: 'primary' }],
      }).then((v) => { if (v) go(); });
    }
    function confirmLeave() {
      const idle = { menu: 1, saveload: 1, gameOver: 1, victory: 1 };
      const playing = !!OV.Game.G && OV.Scenes.stack.some((s) => !idle[s.id]);
      if (!playing) return Promise.resolve(true);
      return OV.Dom.modal({
        title: T('cp.sl.leave.title'), body: T('cp.sl.leave.body'), cls: 'alert',
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('cp.sl.open'), value: true, kind: 'danger' }],
      });
    }
    function openState(st) {
      if (OV.Scenes.top() === sc) OV.Scenes.pop();
      sfx('ui_confirm');
      if (st.G) resume(st);
      else OV.Screens.resumeGame(st);
    }
    function failLoad(err) {
      sfx('ui_deny');
      OV.Dom.modal({ title: T('scr.load.title'), body: esc(errText(err)), cls: 'alert' });
    }
    function doLoad(e) {
      confirmLeave().then((ok) => {
        if (!ok) return;
        let st = null;
        try { st = isExtra(e.slot) ? loadExtra(e.slot) : OV.Save.load(e.slot); } catch (err) { failLoad(err); return; }
        if (!st) { failLoad(new Error('save.err.parse')); return; }
        openState(st);
      });
    }
    function doExport(e) {
      try {
        const obj = isExtra(e.slot) ? readExtra(e.slot) : OV.Save.read(e.slot);
        if (!obj) throw new Error('save.err.parse');
        const f = OV.Save.exportFile(obj);
        OV.Dom.download(f.filename, f.text, f.mime);
        OV.Dom.toast(T('cp.sl.exported', { name: f.filename }), null, 'good');
      } catch (err) {
        failLoad(err);
      }
    }
    function doDelete(e) {
      OV.Dom.modal({
        title: T('cp.sl.delete.title'), body: esc(T('cp.sl.delete.body', { slot: slotName(e.slot) })), cls: 'alert',
        buttons: [{ label: T('common.cancel'), value: false }, { label: T('cp.sl.delete'), value: true, kind: 'danger' }],
      }).then((v) => {
        if (!v) return;
        if (isExtra(e.slot)) lsRawSet(extraKey(e.slot), null);
        else OV.Save.remove(e.slot);
        sfx('ui_click');
        render();
      });
    }
    function doImport() {
      OV.Dom.pickFile().then((text) => {
        if (!text) return;
        let st = null;
        try { st = OV.Save.importFile(text); } catch (err) { failLoad(err); return; }
        confirmLeave().then((ok) => { if (ok) openState(st); });
      });
    }
    function close() { if (OV.Scenes.top() === sc) OV.Scenes.pop(); }
    function setMode(m) {
      if (m === mode || (m === 'save' && !G)) return;
      mode = m;
      sel = -1;
      title.textContent = T(mode === 'save' ? 'cp.sl.title.save' : 'cp.sl.title.load');
      foot();
      render();
    }
    let title = null, footBtns = null;
    function foot() {
      OV.Dom.clear(footBtns);
      if (mode === 'load') footBtns.appendChild(btn(T('scr.load.import'), { key: 'I', tip: T('cp.sl.import.tip'), onClick: doImport }));
      if (G) footBtns.appendChild(btn(T('cp.sl.exportNow'), { key: 'X', tip: T('cp.sl.exportNow.tip'), onClick: () => exportGame(G, null) }));
      footBtns.appendChild(closeBtn);
    }
    sc = overlay('saveload', {
      trap: '.cp-sl',
      build(root, s) {
        sc = s;
        title = el('h1', { class: 'scr-title', text: T(mode === 'save' ? 'cp.sl.title.save' : 'cp.sl.title.load') });
        tabs = G ? ui.seg({ label: T('cp.sl.title.save'), options: [{ v: 'save', label: T('cp.sl.tab.save'), title: '1' }, { v: 'load', label: T('cp.sl.tab.load'), title: '2' }], get: () => mode, set: setMode }) : null;
        listEl = el('div', { class: 'cp-sl-list scr-scroll', role: 'listbox', 'aria-label': T('cp.sl.slots') });
        closeBtn = btn(T('common.close'), { cls: 'primary', key: 'Esc', tip: T('common.close'), onClick: close });
        footBtns = el('div', { class: 'scr-foot-btns' });
        root.append(el('div', { class: 'scr-ov-back', onclick: close }),
          el('div', { class: 'scr-panel cp-sl', role: 'dialog', 'aria-modal': 'true' },
            el('header', { class: 'scr-head' }, el('div', { class: 'scr-kicker', text: T('cp.sl.kicker') }), title, tabs ? el('div', { class: 'cp-sl-tabs' }, tabs) : null),
            listEl,
            el('footer', { class: 'scr-foot' }, el('span', { class: 'scr-hint', text: T('cp.sl.hint') }), footBtns)));
        foot();
        render();
      },
      focus: () => (listEl && listEl.querySelector('.cp-sl-row.sel')) || closeBtn,
      keys(ev) {
        const k = ev.key;
        if (k === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); mark(); sfx('ui_select'); return true; }
        if (k === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); sfx('ui_select'); return true; }
        if (k === 'Enter') { if (!activeIsButtonIn(sc.root)) { primary(rows[sel]); return true; } return false; }
        if ((k === 'Delete' || k === 'Backspace') && rows[sel] && !rows[sel].empty) { doDelete(rows[sel]); return true; }
        if ((k === 'e' || k === 'E') && rows[sel] && !rows[sel].empty && !rows[sel].corrupt) { doExport(rows[sel]); return true; }
        if ((k === 'i' || k === 'I') && mode === 'load') { doImport(); return true; }
        if ((k === 'x' || k === 'X') && G) { exportGame(G, null); return true; }
        if (k === '1' && G) { setMode('save'); return true; }
        if (k === '2') { setMode('load'); return true; }
        return false;
      },
      back: close,
    });
    return sc;
  };
  function saveDialog(G) {
    if (!OV.Save) { OV.Dom.modal({ title: T('cp.sl.title.save'), body: T('scr.load.unavailable') }); return null; }
    return OV.Scenes.push('saveload', { G: G || OV.Game.G, mode: 'save' });
  }
  function loadDialog() {
    if (!OV.Save) { OV.Dom.modal({ title: T('scr.load.title'), body: T('scr.load.unavailable') }); return null; }
    const G = OV.Game.G && !OV.Game.G.flags.won && !OV.Game.G.flags.lost ? OV.Game.G : null;
    return OV.Scenes.push('saveload', { G, mode: 'load' });
  }

  // ================================================================================================
  // Substituto do Geoscape (só enquanto js/ui/geo_ui.js não regista a cena 'geoscape')
  // ================================================================================================
  OV.SceneDefs.campaignHub = function (params) {
    const ui = SUI();
    const G = (params && params.G) || OV.Game.G;
    const base = G.bases[0] || { lon: LISBON.lon, lat: LISBON.lat };
    const view = { lon: base.lon + 8, lat: base.lat - 6, zoom: 1.6, w: 1, h: 1, dpr: 1, time: 0, mode: 'normal', cursor: null, selection: base.id ? { kind: 'base', id: base.id } : null, hover: null, highlights: [] };
    const cam = globeCam(view);
    let sc = null, side = null, layoutDirty = true;
    sc = ui.makeScreen('campaignHub', {
      backdrop: false,
      build(root, s) {
        sc = s;
        if (OV.GlobeRender && OV.GlobeRender.prewarm) OV.GlobeRender.prewarm();
        side = el('aside', { class: 'scr-panel cp-hub' },
          ui.header(T('cp.hub.kicker'), baseName(G.bases[0])),
          el('div', { class: 'cp-ng-sbody' },
            kv(T('cp.st.date'), dateText(G.t)),
            kv(T('cp.hub.funds'), money(G.funds), G.funds < 0 ? 'bad' : ''),
            kv(T('scr.br.diff'), T('diff.' + G.difficulty)),
            el('p', { class: 'cp-note info', text: T('cp.hub.note') })),
          el('footer', { class: 'scr-foot' }, el('div', { class: 'scr-foot-btns cp-col' },
            btn(T('cp.sl.tab.save'), { key: 'S', tip: T('cp.sl.title.save'), onClick: () => saveDialog(G) }),
            btn(T('scr.menu.load'), { key: 'L', tip: T('scr.menu.load.hint'), onClick: loadDialog }),
            btn(T('up.menu'), { key: 'U', tip: T('up.menu.hint'), onClick: () => OV.Ufopaedia && OV.Ufopaedia.open(G) }),
            btn(T('cp.end.menu'), { cls: 'danger', key: 'Esc', tip: T('cp.end.menu.tip'), onClick: toMenu }))));
        root.append(side);
        if (OV.GlobeRender) OV.GlobeRender.rotateTo(view, base.lon + 4, base.lat - 2, 900, 2);
        music('geoscape');
      },
      keys(ev) {
        const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
        if (k === 's') { saveDialog(G); return true; }
        if (k === 'l') { loadDialog(); return true; }
        if (k === 'u' && OV.Ufopaedia) { OV.Ufopaedia.open(G); return true; }
        return cam.key(ev);
      },
      back: () => OV.Screens.openOptions(),
    });
    const keyIn = sc.onInput;
    sc.onInput = (ev) => (ev.kind === 'key' ? keyIn(ev) : cam.input(ev));
    sc.draw = function () {
      if (!OV.GlobeRender) return;
      syncView(view);
      if (layoutDirty && side && side.isConnected) { centreBeside(view, side); layoutDirty = false; }
      drawGlobe(G, view);
    };
    sc.onResize = () => { layoutDirty = true; };
    return sc;
  };

  // leitura para o QA (?debug=1 ou testes): estado da cena de nova campanha
  const debug = {
    newgame() {
      const sc = OV.Scenes.stack.find((x) => x.id === 'newgame');
      return sc && sc._dbg ? sc._dbg() : null;
    },
  };

  OV.CampaignUI = Object.assign(OV.CampaignUI || {}, {
    debug,
    newGame: () => OV.Scenes.push('newgame', {}),
    launchMission, startBattle, afterBattle, resume, openGeo, popToGeo, equip,
    cydoniaState, cydoniaPick, cydoniaWhy, cydoniaCapable, launchCydonia, monthAlienSplit, fundingTotals,
    monthReport, gameOver, victory, baseDefence, saveDialog, loadDialog, autosave, saveLabel, errText,
    armedLo, idleFit, unarmedAboard, boardAll, autoKit, crewUp, crewText, starterKit, buyStarterKit, orderStarterKit,
    markUfoKnown, saveBeforeMission, preMissionFor, retryMission, EXTRA_SLOTS, extraSummary, loadExtra,
  });
})(globalThis.OV || (globalThis.OV = {}));
