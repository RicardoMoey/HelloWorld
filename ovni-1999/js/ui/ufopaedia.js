/* Ufopédia (DESIGN.md §13; CAMPAIGN_API.md §5.11, §6): catálogo de artigos gerado a partir das regras, regra de
   desbloqueio, tabelas de características, ilustrações procedimentais em canvas e a cena 'ufopaedia'.
   O catálogo e as tabelas são puros (correm em Node para os testes); o DOM e o canvas só são tocados pela cena.
   Ids de artigo: craft_<tipo>, item_<item>, armour_coveralls, facility_<tipo>, race_<raça|unidade de terror>,
   ufo_<tipo> e tópicos com artigo próprio (laser_weapons, ufo_construction, alien_origins, martian_solution, cydonia,
   alien_interrogation). Qualquer outro id (tópico, item, munição, cadáver, unidade) resolve para um destes.
   Cena: OV.SceneDefs.ufopaedia({G?, articleId?, section?}) — sem G é o «Arquivo» com tudo desclassificado.
   API: OV.Ufopaedia = { SECTIONS, catalogue, article, articles, resolve, isOpen, openArticles, sectionCounts,
                         isNew, markRead, title, text, stats, illustrate, unitsOf, search, open } */
(function (OV) {
  'use strict';

  const T = (k, p) => OV.T(k, p);
  const D = () => OV.Data;
  const fmtInt = (n) => (OV.U && OV.U.fmtInt ? OV.U.fmtInt(n) : String(n));
  const money = (n) => (OV.U && OV.U.fmtMoney ? OV.U.fmtMoney(n) : '$' + n);
  const TAU = Math.PI * 2;

  const SECTIONS = ['crafts', 'craftWeapons', 'equipment', 'facilities', 'aliens', 'alienResearch', 'components', 'ufos'];
  // artigos de tópico com página própria (o resto dos tópicos aponta para o item/instalação/nave/raça)
  const STORY = {
    laser_weapons: 'equipment', ufo_construction: 'components', alien_origins: 'alienResearch',
    martian_solution: 'alienResearch', cydonia: 'alienResearch',
  };
  const EQUIP_ORDER = [
    'pistol', 'rifle', 'heavy_cannon', 'auto_cannon', 'rocket_launcher', '@laser_weapons', 'laser_pistol', 'laser_rifle', 'heavy_laser',
    'plasma_pistol', 'plasma_rifle', 'heavy_plasma', 'small_launcher', 'blaster_launcher', 'stun_rod', 'grenade', 'smoke_grenade',
    'high_explosive', 'alien_grenade', 'electro_flare', 'medikit', 'motion_scanner',
  ];
  const COMPONENT_ORDER = ['ufo_power_source', 'ufo_navigation', '@ufo_construction', 'alien_alloys', 'elerium_115', 'alien_food',
    'alien_surgery', 'examination_room', 'alien_reproduction', 'alien_entertainment'];
  const RACES = ['sectoid', 'floater', 'snakeman', 'muton', 'ethereal'];
  const TERROR = ['cyberdisc', 'sectopod', 'reaper', 'chryssalid', 'zombie'];
  const RANK_ORDER = ['soldier', 'navigator', 'engineer', 'medic', 'leader', 'commander'];
  const STAT_ROWS = ['tu', 'sta', 'hp', 'brav', 'react', 'fire', 'thr', 'str', 'melee', 'psiStr', 'psiSkill'];

  // ================================================================================================
  // Catálogo
  // ================================================================================================
  let CAT = null;

  function build() {
    const Dt = D();
    const list = [];
    const byId = {};
    const alias = {};
    const add = (a) => {
      a.textKey = 'up.txt.' + a.id;
      a.topics = [];
      a.flag = a.flag || null;
      list.push(a);
      byId[a.id] = a;
      return a;
    };
    const itemAlways = (it) => !it.research && !it.topic;
    const mvp = (it) => it && it.mvp !== false;

    // naves X-COM
    for (const id in Dt.crafts) {
      const c = Dt.crafts[id];
      add({ id: 'craft_' + id, sec: 'crafts', kind: 'craft', ref: id, titleKey: c.nameKey, always: !c.requires });
      alias[id] = 'craft_' + id;
    }
    // armamento de naves (lançadores MVP; munições apontam para o lançador)
    for (const id in Dt.craftWeapons) {
      const w = Dt.craftWeapons[id];
      const it = Dt.items[w.item];
      if (!w.mvp || !it) continue;
      add({ id: 'item_' + w.item, sec: 'craftWeapons', kind: 'cw', ref: id, titleKey: it.nameKey, always: itemAlways(it) });
      alias[w.item] = 'item_' + w.item;
      if (w.ammoItem) alias[w.ammoItem] = 'item_' + w.item;
    }
    // armas e equipamento, depois armaduras
    const story = (id) => {
      const t = Dt.research[id];
      return add({ id, sec: STORY[id], kind: 'story', ref: id, titleKey: t ? t.nameKey : 'research.' + id, always: false });
    };
    for (const e of EQUIP_ORDER) {
      if (e[0] === '@') { story(e.slice(1)); continue; }
      const it = Dt.items[e];
      if (!mvp(it)) continue;
      add({ id: 'item_' + e, sec: 'equipment', kind: 'item', ref: e, titleKey: it.nameKey, always: itemAlways(it) });
      alias[e] = 'item_' + e;
      for (const a of it.ammo || []) if (!alias[a]) alias[a] = 'item_' + e;
    }
    for (const id in Dt.armours) {
      const a = Dt.armours[id];
      const art = a.storeItem ? 'item_' + a.storeItem : 'armour_' + id;
      add({ id: art, sec: 'equipment', kind: 'armour', ref: id, titleKey: a.nameKey, always: !a.research });
      alias[id] = art;
      if (a.storeItem) alias[a.storeItem] = art;
    }
    // instalações
    for (const id in Dt.facilities) {
      const f = Dt.facilities[id];
      add({ id: 'facility_' + id, sec: 'facilities', kind: 'facility', ref: id, titleKey: f.nameKey, always: !f.research });
      alias[id] = 'facility_' + id;
    }
    // formas de vida: raças e unidades de terror (cadáveres, armas embutidas e unidades apontam para cá)
    for (const r of RACES.concat(TERROR)) {
      const unit = Dt.units[r] || Dt.units[r + '_soldier'];
      if (!unit) continue;
      const terror = TERROR.includes(r);
      add({ id: 'race_' + r, sec: 'aliens', kind: 'race', ref: r, titleKey: terror ? 'unit.' + r : 'race.' + r, always: false, terror });
      alias[r] = 'race_' + r;
    }
    for (const uid in Dt.units) {
      const u = Dt.units[uid];
      if (u.side !== 'alien') continue;
      const r = TERROR.includes(uid) ? uid : u.race;
      if (byId['race_' + r]) {
        alias[uid] = 'race_' + r;
        if (u.corpse && !alias[u.corpse]) alias[u.corpse] = 'race_' + r;
        if (u.weapon && !alias[u.weapon]) alias[u.weapon] = 'race_' + r;
      }
    }
    // investigação alienígena
    add({ id: 'alien_interrogation', sec: 'alienResearch', kind: 'story', ref: 'interrogate', titleKey: 'up.title.alien_interrogation', always: false, flag: 'interrogated' });
    for (const id of ['alien_origins', 'martian_solution', 'cydonia']) story(id);
    // componentes OVNI
    for (const e of COMPONENT_ORDER) {
      if (e[0] === '@') { story(e.slice(1)); continue; }
      const it = Dt.items[e];
      if (!it) continue;
      add({ id: 'item_' + e, sec: 'components', kind: 'item', ref: e, titleKey: it.nameKey, always: itemAlways(it) });
      alias[e] = 'item_' + e;
    }
    // OVNIs
    for (const id in Dt.ufos) {
      add({ id: 'ufo_' + id, sec: 'ufos', kind: 'ufo', ref: id, titleKey: Dt.ufos[id].nameKey, always: false });
      alias[id] = 'ufo_' + id;
    }

    // tópicos de investigação → artigo (o próprio, o primeiro item/armadura/instalação/nave, ou a raça)
    for (const tid in Dt.research) {
      const t = Dt.research[tid];
      if (t.template) continue;
      let to = null;
      if (byId[t.article]) to = t.article;
      else if (t.items.length && alias[t.items[0]]) to = alias[t.items[0]];
      else if (t.armours.length && alias[t.armours[0]]) to = alias[t.armours[0]];
      else if (t.enables && t.enables.facilities.length) to = alias[t.enables.facilities[0]];
      else if (t.enables && t.enables.crafts.length) to = alias[t.enables.crafts[0]];
      else if (t.race && alias[t.race]) to = alias[t.race];
      if (!to) continue;
      if (!alias[tid] && !byId[tid]) alias[tid] = to;
      if (t.article !== tid && !alias[t.article] && !byId[t.article]) alias[t.article] = to;
      if (byId[to] && !byId[to].topics.includes(tid)) byId[to].topics.push(tid);
    }
    // ordem por secção, mantendo a ordem de inserção dentro de cada uma
    const order = [];
    for (const s of SECTIONS) for (const a of list) if (a.sec === s) order.push(a);
    order.forEach((a, i) => { a.idx = i; });
    CAT = { list: order, byId, alias, resolved: new Map() };
    return CAT;
  }
  function catalogue() {
    if (!CAT || !CAT.list.length) build();
    return CAT;
  }
  const article = (id) => {
    const r = resolve(id);
    return r ? catalogue().byId[r] : null;
  };
  const articles = () => catalogue().list;

  // qualquer id (artigo, tópico, item, munição, cadáver, unidade, raça, tipo de nave/OVNI/instalação) → id de artigo | null
  function resolve(id) {
    if (typeof id !== 'string' || !id) return null;
    const C = catalogue();
    if (C.byId[id]) return id;
    if (C.resolved.has(id)) return C.resolved.get(id);
    let out = C.alias[id] || null;
    if (!out) {
      const pfx = ['craft_', 'item_', 'facility_', 'ufo_', 'race_', 'armour_'];
      for (const p of pfx) if (!out && id.startsWith(p) && C.alias[id.slice(p.length)]) out = C.alias[id.slice(p.length)];
    }
    if (!out && D().researchTopic) {
      const t = D().researchTopic(id);
      if (t && t.article && t.article !== id) out = resolve(t.article);
      else if (t && t.race && C.alias[t.race]) out = C.alias[t.race];
    }
    C.resolved.set(id, out);
    return out;
  }

  // regra única de desbloqueio (§5.11): sempre aberto, em G.ufopaedia, ou tópico investigado que o nomeia
  function isOpen(G, id) {
    const a = article(id);
    if (!a) return false;
    if (!G) return true;
    if (a.always) return true;
    if (a.flag && G.flags && G.flags[a.flag]) return true;
    for (const u of G.ufopaedia || []) if (resolve(u) === a.id) return true;
    const Dt = D();
    for (const t of G.researched || []) {
      const tp = Dt.researchTopic ? Dt.researchTopic(t) : Dt.research[t];
      if (tp && (resolve(tp.article) === a.id || resolve(t) === a.id)) return true;
    }
    return false;
  }
  const openArticles = (G) => articles().filter((a) => isOpen(G, a.id));
  function sectionCounts(G) {
    const out = {};
    for (const s of SECTIONS) out[s] = { open: 0, total: 0 };
    for (const a of articles()) {
      out[a.sec].total++;
      if (isOpen(G, a.id)) out[a.sec].open++;
    }
    return out;
  }
  // artigos novos: desbloqueados por investigação/captura e ainda não lidos (G.ui.ufopaediaRead)
  function isNew(G, id) {
    const a = article(id);
    if (!G || !a || a.always || !isOpen(G, a.id)) return false;
    const read = G.ui && G.ui.ufopaediaRead;
    return !(read && read.indexOf(a.id) >= 0);
  }
  function markRead(G, id) {
    const a = article(id);
    if (!G || !a || a.always) return;
    if (!G.ui || typeof G.ui !== 'object') G.ui = {};
    if (!Array.isArray(G.ui.ufopaediaRead)) G.ui.ufopaediaRead = [];
    if (G.ui.ufopaediaRead.indexOf(a.id) < 0) G.ui.ufopaediaRead.push(a.id);
  }

  const title = (a) => T(a.titleKey);
  const text = (a) => T(a.textKey);

  // pesquisa sem acentos nem maiúsculas sobre título, secção e unidades da raça
  const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function search(list, q) {
    const f = fold(q || '').trim();
    if (!f) return list.slice();
    const words = f.split(/\s+/);
    const scored = [];
    for (const a of list) {
      const hay = fold(title(a) + ' ' + T('up.sec.' + a.sec) + ' ' + (a.kind === 'race' ? unitsOf(a).map((u) => T('unit.' + u)).join(' ') : ''));
      if (!words.every((w) => hay.includes(w))) continue;
      const tt = fold(title(a));
      scored.push({ a, s: tt.startsWith(f) ? 0 : tt.includes(f) ? 1 : 2 });
    }
    scored.sort((x, y) => x.s - y.s || x.a.idx - y.a.idx);
    return scored.map((x) => x.a);
  }

  // ================================================================================================
  // Características (geradas das regras; texto já traduzido)
  // Blocos: {kv:[[rótulo, valor]], title?} | {table:{title, head:[], rows:[[]], hi?: índice de coluna}} | {note}
  // ================================================================================================
  const pct = (n) => T('up.v.pct', { n });
  const dash = '—';
  const dmgName = (k) => T('dmg.' + k);
  const tuCost = (m) => (m.flat ? T('up.v.tuFlat', { n: m.tu }) : T('up.v.tuPct', { n: m.tu }));

  // unidades de uma raça por patente (distintas, ordem de patente) ou a própria unidade de terror
  function unitsOf(a) {
    const Dt = D();
    if (!a || a.kind !== 'race') return [];
    if (a.terror) return [a.ref];
    const m = (Dt.races[a.ref] || {}).members || {};
    const out = [];
    for (const rk of RANK_ORDER) {
      const u = m[rk];
      if (typeof u === 'string' && Dt.units[u] && Dt.units[u].race === a.ref && !out.includes(u)) out.push(u);
    }
    return out;
  }

  function manufactureBlock(id) {
    const Dt = D();
    let m = Dt.manufacture[id];
    if (!m) for (const k in Dt.manufacture) if (Dt.manufacture[k].produces && Dt.manufacture[k].produces.craft === id) m = Dt.manufacture[k];
    if (!m) return null;
    const mats = Object.keys(m.materials).map((k) => m.materials[k] + '× ' + T(Dt.items[k] ? Dt.items[k].nameKey : 'item.' + k));
    const rows = [
      [T('up.st.manHours'), T('up.v.engHours', { n: fmtInt(m.hours) })],
      [T('up.st.manCost'), money(m.cost)],
      [T('up.st.manSpace'), fmtInt(m.space)],
    ];
    if (mats.length) rows.push([T('up.st.manMaterials'), mats.join(' · ')]);
    return { title: T('up.sec.manufacture'), kv: rows };
  }
  function priceRows(it) {
    const rows = [];
    if (it.buy > 0) rows.push([T('up.st.buy'), money(it.buy)]);
    if (it.sell > 0) rows.push([T('up.st.sell'), money(it.sell)]);
    return rows;
  }
  function researchNote(a) {
    if (!a.topics.length) return null;
    const names = a.topics.map((t) => T(D().research[t].nameKey));
    if (a.kind === 'race' && !a.terror) names.push(T('up.v.interrogation'));
    return { note: T('up.note.research', { list: names.join(' · ') }) };
  }

  function itemStats(it) {
    const Dt = D();
    const blocks = [];
    const kv = [];
    const modes = Dt.weaponModes(it.id);
    if (it.kind === 'firearm' || it.kind === 'melee') {
      if (!it.ammo) {
        kv.push([T('up.st.damage'), (it.strengthPower ? T('up.v.strength') + ' + ' : '') + it.power]);
        kv.push([T('up.st.dmgType'), dmgName(it.dmg)]);
        if (it.kind === 'firearm') kv.push([T('up.st.ammo'), T('up.v.unlimited')]);
      }
      if (modes.length) {
        blocks.push({ table: {
          title: T('up.st.modes'), head: [T('up.st.mode'), T('up.st.acc'), T('up.st.tu')],
          rows: modes.map((m) => [T(m.nameKey) + (m.shots > 1 ? ' ×' + m.shots : ''), pct(m.acc), tuCost(m)]),
        } });
      }
      if (it.guided) kv.push([T('up.st.guided'), pct(it.guided.acc)]);
      if (it.ammo && it.ammo.length) {
        blocks.push({ table: {
          title: T('up.st.ammoTable'), head: [T('up.st.ammo'), T('up.st.damage'), T('up.st.dmgType'), T('up.st.rounds'), T('up.st.radius')],
          rows: it.ammo.filter((id) => Dt.items[id]).map((id) => {
            const c = Dt.items[id];
            return [T(c.nameKey), String(c.power), dmgName(c.dmg), String(c.rounds), c.radius ? T('up.v.tiles', { n: c.radius }) : dash];
          }),
        } });
      }
    } else if (it.kind === 'grenade') {
      kv.push([T('up.st.damage'), String(it.power)], [T('up.st.dmgType'), dmgName(it.dmg)], [T('up.st.radius'), T('up.v.tiles', { n: it.radius })]);
      if (it.proximity) kv.push([T('up.st.proximity'), T('common.yes')]);
      blocks.push({ table: { title: T('up.st.modes'), head: [T('up.st.mode'), T('up.st.tu')], rows: modes.map((m) => [T(m.nameKey), tuCost(m)]) } });
    } else if (it.kind === 'flare') {
      kv.push([T('up.st.light'), T('up.v.tiles', { n: it.light })]);
      blocks.push({ table: { title: T('up.st.modes'), head: [T('up.st.mode'), T('up.st.tu')], rows: modes.map((m) => [T(m.nameKey), tuCost(m)]) } });
    } else if (it.kind === 'medikit') {
      kv.push([T('up.st.charges'), T('up.v.charges', it.charges)], [T('up.st.heal'), T('up.v.heal', { hp: it.healHP, w: it.healWounds })],
        [T('up.st.stim'), T('up.v.stim', { n: it.stimEnergy })], [T('up.st.tu'), T('up.v.tuFlat', { n: it.useTU })]);
    } else if (it.kind === 'scanner') {
      kv.push([T('up.st.tu'), T('up.v.tuPct', { n: it.usePct })]);
    } else if (it.kind === 'material' || it.kind === 'component' || it.kind === 'artefact') {
      kv.push([T('up.st.storage'), String(it.storage).replace('.', ',')]);
      const found = [];
      for (const uid in Dt.ufos) {
        const rec = Dt.ufoRecovery(uid, {});
        if (rec[it.id]) found.push(T(Dt.ufos[uid].nameKey) + ' ×' + rec[it.id]);
      }
      if (found.length) blocks.push({ table: { title: T('up.st.recovered'), head: [T('up.st.ufoQty')], rows: found.map((s) => [s]) } });
    }
    if (it.battle && it.kind !== 'material') {
      kv.push([T('up.st.weight'), String(it.weight)], [T('up.st.size'), T('up.v.slots', { n: it.size })]);
      if (it.twoHanded) kv.push([T('up.st.hands'), T('up.v.twoHands')]);
    }
    kv.push(...priceRows(it));
    blocks.unshift({ kv });
    return blocks;
  }

  function armourStats(a) {
    const Dt = D();
    const kv = [
      [T('armourSide.front'), String(a.front)], [T('armourSide.side'), String(a.side)],
      [T('armourSide.rear'), String(a.rear)], [T('armourSide.under'), String(a.under)],
    ];
    if (a.flight) kv.push([T('up.st.flight'), T('common.yes')]);
    const res = [];
    for (const k of Dt.DMG_IDS) {
      const v = a.mods[k];
      if (v === 100 || v === undefined || (Dt.damageTypes[k] && Dt.damageTypes[k].phase && Dt.damageTypes[k].phase !== 'MVP')) continue;
      res.push([dmgName(k), v === 0 ? T('up.v.immune') : pct(v)]);
    }
    const blocks = [{ title: T('up.st.armour'), kv }];
    if (res.length) blocks.push({ table: { title: T('up.st.dmgMods'), head: [T('up.st.dmgType'), T('up.st.dmgTaken')], rows: res } });
    if (a.storeItem && Dt.items[a.storeItem]) blocks.push({ kv: priceRows(Dt.items[a.storeItem]) });
    return blocks;
  }

  function craftStats(c) {
    const Dt = D();
    const fuel = c.refuelItem ? T('up.v.fuelElerium', { n: c.fuel }) : fmtInt(c.fuel);
    const kv = [
      [T('up.st.speed'), T('up.v.knots', { n: fmtInt(c.speed) })],
      [T('up.st.accel'), String(c.accel)],
      [T('up.st.fuel'), fuel],
      [T('up.st.hull'), fmtInt(c.hp)],
      [T('up.st.weapons'), String(c.weapons)],
      [T('up.st.seats'), c.seats ? T('up.v.seats', { n: c.seatsUI, max: c.seats }) : dash],
      [T('up.st.radar'), T('up.v.nm', { n: fmtInt(c.radarRange) })],
    ];
    if (c.buy > 0) kv.push([T('up.st.buy'), money(c.buy)]);
    if (c.rent > 0) kv.push([T('up.st.rent'), T('up.v.perMonth', { v: money(c.rent) })]);
    if (c.spacecraft) kv.push([T('up.st.space'), T('common.yes')]);
    const out = [{ kv }];
    const mb = manufactureBlock(c.id);
    if (mb) out.push(mb);
    return out;
  }

  function cwStats(w) {
    const Dt = D();
    const it = Dt.items[w.item];
    const ammo = w.ammoItem ? Dt.items[w.ammoItem] : null;
    const reload = (w.reload.standard * Dt.dogfight.tickMs / 1000).toFixed(1).replace('.', ',');
    const kv = [
      [T('up.st.damage'), T('up.v.dmgRange', { min: Math.floor(w.dmg / 2), max: w.dmg })],
      [T('up.st.range'), T('up.v.km', { n: w.range })],
      [T('up.st.acc'), pct(w.acc)],
      [T('up.st.ammoCap'), w.ammoMax === null ? T('up.v.unlimited') : String(w.ammoMax)],
      [T('up.st.reload'), T('up.v.seconds', { n: reload })],
    ];
    if (ammo) kv.push([T('up.st.ammoItem'), T(ammo.nameKey) + (ammo.buy > 0 ? ' · ' + money(ammo.buy) : '')]);
    kv.push(...priceRows(it));
    const rows = [];
    for (let s = 0; s < 5; s++) rows.push([T('ufo.size.' + s), pct(Dt.dogfightHitChance(w.acc, s))]);
    const out = [{ kv }, { table: { title: T('up.st.hitChance'), head: [T('up.st.ufoSize'), T('up.st.chance')], rows } }];
    const mb = manufactureBlock(w.item);
    if (mb) out.push(mb);
    return out;
  }

  function facilityStats(f) {
    const kv = [
      [T('up.st.facSize'), f.size + '×' + f.size],
      [T('up.st.cost'), money(f.cost)],
      [T('up.st.days'), OV.Tn('common.days', f.days)],
      [T('up.st.upkeep'), T('up.v.perMonth', { v: money(f.upkeep) })],
    ];
    const fx = [];
    if (f.lift) fx.push(T('facility.effect.lift'));
    for (const k of ['personnel', 'labs', 'workshops', 'storage', 'aliens', 'crafts']) if (f[k]) fx.push(T('facility.effect.' + k, { n: f[k] }));
    if (f.radarRange) fx.push(T('facility.effect.radar', { range: fmtInt(f.radarRange), chance: f.radarChance }));
    if (f.hyper) fx.push(T('facility.effect.hyper'));
    if (f.defence) fx.push(T('facility.effect.defence', { power: f.defence, acc: f.hitRatio }));
    for (const s of fx) kv.push([T('up.st.effect'), s]);
    return [{ kv }];
  }

  function raceStats(a, G, unitId) {
    const Dt = D();
    const units = unitsOf(a);
    const uid = units.includes(unitId) ? unitId : units[0];
    const u = Dt.units[uid];
    const hi = G ? G.difficulty | 0 : -1;
    const head = [T('up.st.attr'), T('diff.0'), T('diff.1'), T('diff.2')];
    const per = [0, 1, 2].map((d) => Dt.alienStats(uid, d));
    const rows = [];
    for (const k of STAT_ROWS) {
      if (per.every((s) => !s[k])) continue;
      rows.push([T('stat.' + k)].concat(per.map((s) => String(s[k]))));
    }
    const arm = [0, 1, 2].map((d) => Dt.alienArmour(uid, d));
    rows.push([T('up.st.armourFront')].concat(arm.map((x) => String(x[0]))));
    rows.push([T('up.st.armourRear')].concat(arm.map((x) => String(x[3]))));
    const out = [{ table: { title: T('unit.' + uid), head, rows, hi: hi >= 0 ? hi + 1 : null } }];
    const kv = [];
    kv.push([T('up.st.move'), T('up.v.move.' + (u.move || 'walk'))]);
    if ((u.size || 1) > 1) kv.push([T('up.st.unitSize'), '2×2']);
    if (u.weapon && Dt.items[u.weapon]) {
      const w = Dt.items[u.weapon];
      kv.push([T('up.st.natWeapon'), T(w.nameKey) + ' · ' + (w.strengthPower ? T('up.v.strength') : w.power) + ' ' + dmgName(w.dmg)]);
    }
    if (u.psi) kv.push([T('up.st.psi'), T('common.yes')]);
    if (u.explodeOnDeath) kv.push([T('up.st.explodes'), u.explodeOnDeath.power + ' ' + dmgName(u.explodeOnDeath.dmg)]);
    if (u.spawnOnDeath) kv.push([T('up.st.spawns'), T('unit.' + u.spawnOnDeath)]);
    if (u.capturable === false) kv.push([T('up.st.capture'), T('common.no')]);
    kv.push([T('up.st.value'), String(u.value)]);
    out.push({ kv });
    const weak = [], strong = [];
    for (const k of Dt.DMG_IDS) {
      const v = u.armour.mods[k];
      if (v === undefined || v === 100 || k === 'SMOKE' || k === 'ACID') continue;
      (v > 100 ? weak : strong).push(dmgName(k) + ' ' + pct(v));
    }
    if (weak.length || strong.length) {
      const r = [];
      if (weak.length) r.push([T('up.st.weak'), weak.join(' · ')]);
      if (strong.length) r.push([T('up.st.strong'), strong.join(' · ')]);
      out.push({ kv: r });
    }
    return out;
  }

  function ufoStats(u) {
    const Dt = D();
    const kv = [
      [T('up.st.ufoSize'), T(u.sizeKey)],
      [T('up.st.hull'), fmtInt(u.hp)],
      [T('up.st.speed'), T('up.v.knots', { n: fmtInt(u.speed) })],
      [T('up.st.ufoWeapon'), u.weapon.power ? T('up.v.ufoWeapon', { p: u.weapon.power, r: u.weapon.range }) : T('up.v.unarmed')],
      [T('up.st.score'), T('up.v.score', { a: u.score, b: u.scoreDestroyed })],
    ];
    const crew = [0, 1, 2].map((d) => {
      const r = Dt.deploymentRange(u.deployment, d);
      return r ? (r.min === r.max ? String(r.min) : r.min + '–' + r.max) : dash;
    });
    const rec = Dt.ufoRecovery(u.id, {});
    const recRows = Object.keys(rec).map((k) => [T(Dt.items[k].nameKey), fmtInt(rec[k])]);
    return [
      { kv },
      { table: { title: T('up.st.crew'), head: [T('diff.0'), T('diff.1'), T('diff.2')], rows: [crew] } },
      { table: { title: T('up.st.recovery'), head: [T('up.st.item'), T('up.st.qty')], rows: recRows } },
    ];
  }

  function storyStats(a) {
    const Dt = D();
    if (a.id === 'alien_interrogation') {
      const rows = Dt.research.interrogate.outcomes.map((o) => [
        o.ranks === '*' ? T('up.v.anyRank') : o.ranks.map((r) => T('arank.' + r)).join(' / '),
        T('up.int.' + (o.flag || 'free_' + o.freeArticle)),
      ]);
      return [{ table: { title: T('up.st.interrogation'), head: [T('up.st.rank'), T('up.st.reveals')], rows } }];
    }
    if (a.id === 'laser_weapons') {
      const rows = ['laser_pistol', 'laser_rifle', 'heavy_laser'].map((id) => {
        const it = Dt.items[id];
        return [T(it.nameKey), String(it.power), String(it.weight)];
      });
      return [{ table: { title: T('up.st.family'), head: [T('up.st.weapon'), T('up.st.damage'), T('up.st.weight')], rows } }];
    }
    const t = Dt.research[a.ref];
    if (!t) return [];
    const kv = [[T('up.st.resCost'), T('up.v.sciDays', { n: t.cost })], [T('up.st.points'), String(t.points)]];
    const next = t.unlocks.map((id) => T(Dt.research[id].nameKey));
    if (next.length) kv.push([T('up.st.leadsTo'), next.join(' · ')]);
    return [{ kv }];
  }

  // blocos de características do artigo; opts.unit escolhe a patente nas raças
  function stats(id, G, opts) {
    const a = article(id);
    if (!a) return [];
    const Dt = D();
    let out;
    if (a.kind === 'craft') out = craftStats(Dt.crafts[a.ref]);
    else if (a.kind === 'cw') out = cwStats(Dt.craftWeapons[a.ref]);
    else if (a.kind === 'item') out = itemStats(Dt.items[a.ref]);
    else if (a.kind === 'armour') out = armourStats(Dt.armours[a.ref]);
    else if (a.kind === 'facility') out = facilityStats(Dt.facilities[a.ref]);
    else if (a.kind === 'race') out = raceStats(a, G, opts && opts.unit);
    else if (a.kind === 'ufo') out = ufoStats(Dt.ufos[a.ref]);
    else out = storyStats(a);
    if (a.kind === 'item' || a.kind === 'armour') {
      const mb = manufactureBlock(a.kind === 'armour' ? Dt.armours[a.ref].storeItem || a.ref : a.ref);
      if (mb) out.push(mb);
    }
    const rn = researchNote(a);
    if (rn) out.push(rn);
    return out.filter((b) => !(b.kv && !b.kv.length));
  }

  // ================================================================================================
  // Ilustrações procedimentais (canvas 2D; px CSS com transformação dpr já aplicada)
  // ================================================================================================
  const Ccss = (c, a) => (OV.Color ? OV.Color.css(c, a) : '#' + c.toString(16).padStart(6, '0'));
  const shade = (c, f) => (OV.Color ? OV.Color.shade(c, f) : c);
  const INK = 0x8fd8ff, AMBER = 0xffb53d, TEALC = 0x3fd7c5, METAL = 0x7d8794, METAL_D = 0x3c444f, HULL = 0x6c6478;

  function backdrop(g, w, h, tint) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0c1824');
    bg.addColorStop(1, '#060c13');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const rg = g.createRadialGradient(w * 0.5, h * 0.48, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
    rg.addColorStop(0, Ccss(tint || 0x1d4c6a, 0.55));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
    // grelha de planta técnica
    const step = Math.max(14, Math.round(Math.min(w, h) / 18));
    g.lineWidth = 1;
    for (let x = (w / 2) % step; x < w; x += step) {
      g.strokeStyle = Math.abs(x - w / 2) < 1 ? 'rgba(120,200,255,0.16)' : 'rgba(120,200,255,0.055)';
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); g.stroke();
    }
    for (let y = (h / 2) % step; y < h; y += step) {
      g.strokeStyle = Math.abs(y - h / 2) < 1 ? 'rgba(120,200,255,0.16)' : 'rgba(120,200,255,0.055)';
      g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(w, Math.round(y) + 0.5); g.stroke();
    }
    // cantos de enquadramento
    g.strokeStyle = Ccss(AMBER, 0.65);
    g.lineWidth = 2;
    const L = Math.min(26, w * 0.08), m = 8;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      g.beginPath(); g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); g.stroke();
    }
  }
  function vignette(g, w, h) {
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }
  function glow(g, x, y, r, c, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Ccss(c, a === undefined ? 0.8 : a));
    gr.addColorStop(1, Ccss(c, 0));
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  // linha de cota com marcas nas pontas
  function dimLine(g, x0, y0, x1, y1) {
    g.save();
    g.strokeStyle = Ccss(INK, 0.45);
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.setLineDash([]);
    const ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, k = 5;
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      g.beginPath(); g.moveTo(x - Math.cos(ang) * k, y - Math.sin(ang) * k); g.lineTo(x + Math.cos(ang) * k, y + Math.sin(ang) * k); g.stroke();
    }
    g.restore();
  }
  function metalFill(g, x0, y0, x1, y1, c) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, Ccss(shade(c, 0.35)));
    gr.addColorStop(0.5, Ccss(c));
    gr.addColorStop(1, Ccss(shade(c, -0.45)));
    return gr;
  }
  function poly(g, pts, fill, stroke, lw) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1.5; g.stroke(); }
  }
  // espelho em x de uma metade (pontos com x ≥ 0) → polígono completo
  const mirror = (half) => half.concat(half.slice().reverse().map(([x, y]) => [-x, y]));
  const dpr = (g) => { const t = g.getTransform ? g.getTransform() : null; return t ? Math.abs(t.a) || 1 : 1; };

  // ---- itens ---------------------------------------------------------------------------------------------
  function drawItem(g, w, h, id, extras) {
    const IS = OV.ItemSprites;
    if (!IS) return;
    const k = dpr(g);
    // ícone de 48 px com o item à escala real: amplia-se a caixa até ~2× o máximo rasterizado (8×)
    const big = Math.min(w * 1.05, (extras && extras.length ? h * 0.8 : h * 1.0), ((IS.BOX * 8) / k) * 2);
    const cy = extras && extras.length ? h * 0.4 : h * 0.5;
    glow(g, w / 2, cy, big * 0.45, TEALC, 0.14);
    g.save();
    g.imageSmoothingQuality = 'high';
    IS.drawIcon(g, id, w / 2 - big / 2, cy - big / 2, big);
    g.restore();
    if (extras && extras.length) {
      const n = extras.length, s = Math.min(h * 0.22, (w * 0.84) / n);
      const y = h - s - h * 0.05;
      g.strokeStyle = Ccss(INK, 0.25);
      g.beginPath(); g.moveTo(w * 0.12, y - 6); g.lineTo(w * 0.88, y - 6); g.stroke();
      extras.forEach((e, i) => IS.drawIcon(g, e, w / 2 - (n * s) / 2 + i * s, y, s));
    }
  }

  // ---- unidades (soldado de armadura, alienígenas) --------------------------------------------------------
  function drawUnit(g, w, h, key, opts, hFrac) {
    const US = OV.UnitSprites;
    if (!US) return;
    const k = dpr(g);
    const probe = US.get(key, 2, 'stand', 0, 1, opts);
    const targetH = h * (hFrac || 0.74);
    const z = Math.min(targetH / Math.max(1, probe.h), (w * 0.8) / Math.max(1, probe.w));
    const spr = US.get(key, 2, opts && opts.pose ? opts.pose : 'stand', 0, Math.min(8, z * k), opts);
    const gy = h * 0.86;
    // plataforma de observação
    g.save();
    g.fillStyle = 'rgba(63,215,197,0.10)';
    g.strokeStyle = Ccss(TEALC, 0.45);
    g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(w / 2, gy - 4, Math.min(w * 0.3, spr.w * z * 0.55), Math.min(h * 0.05, 18), 0, 0, TAU); g.fill(); g.stroke();
    g.restore();
    glow(g, w / 2, gy - spr.h * z * 0.45, spr.h * z * 0.6, TEALC, 0.12);
    const dx = w / 2 - (spr.fx !== undefined ? spr.fx : spr.ax) * z;
    const dy = gy - 4 - (spr.fy !== undefined ? spr.fy : spr.ay) * z;
    g.imageSmoothingQuality = 'high';
    g.drawImage(spr.c, dx, dy, spr.w * z, spr.h * z);
    // régua de altura
    const top = dy + 4, x = Math.max(16, w / 2 - spr.w * z * 0.5 - 24);
    g.strokeStyle = Ccss(INK, 0.4);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x, gy - 4); g.stroke();
    for (let i = 0; i <= 10; i++) {
      const y = top + ((gy - 4 - top) * i) / 10;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (i % 5 ? 4 : 9), y); g.stroke();
    }
  }

  // ---- naves X-COM (vista de cima; nariz para cima; unidades = metade da envergadura) ----------------------
  const CRAFT_ART = {
    skyranger(g) {
      // asas altas com motores VTOL
      poly(g, mirror([[0.08, -0.05], [0.98, 0.05], [1, 0.2], [0.1, 0.22]]), metalFill(g, 0, -0.1, 0, 0.3, 0x67727e), Ccss(0x0a0f14), 0.02);
      for (const s of [1, -1]) {
        g.fillStyle = metalFill(g, s * 0.6, -0.15, s * 0.6, 0.35, 0x4c5560);
        g.beginPath(); g.ellipse(s * 0.6, 0.1, 0.12, 0.3, 0, 0, TAU); g.fill();
        g.strokeStyle = '#0a0f14'; g.lineWidth = 0.02; g.stroke();
        glow(g, s * 0.6, 0.1, 0.1, AMBER, 0.35);
      }
      // fuselagem larga com rampa traseira
      poly(g, mirror([[0, -0.92], [0.14, -0.86], [0.27, -0.6], [0.28, 0.7], [0.2, 0.92], [0, 0.95]]), metalFill(g, -0.28, 0, 0.28, 0, 0x8a96a2), '#0a0f14', 0.02);
      // empenagem dupla
      poly(g, mirror([[0.16, 0.7], [0.5, 0.88], [0.5, 0.98], [0.16, 0.95]]), Ccss(0x56606b), '#0a0f14', 0.015);
      g.fillStyle = Ccss(0x1a2b3a);
      poly(g, mirror([[0, -0.86], [0.12, -0.81], [0.16, -0.68], [0, -0.66]]), Ccss(0x7fe4ff, 0.75));
      g.strokeStyle = 'rgba(10,15,20,0.6)'; g.lineWidth = 0.012;
      for (const y of [-0.45, -0.15, 0.15, 0.45]) { g.beginPath(); g.moveTo(-0.26, y); g.lineTo(0.26, y); g.stroke(); }
      g.fillStyle = Ccss(AMBER, 0.85);
      g.fillRect(-0.12, 0.55, 0.24, 0.05);
    },
    interceptor(g) {
      poly(g, mirror([[0, -1], [0.06, -0.8], [0.09, -0.1], [0.75, 0.55], [0.78, 0.7], [0.12, 0.62], [0.32, 0.92], [0.3, 1], [0, 0.95]]),
        metalFill(g, -0.6, -0.2, 0.6, 0.6, 0x7d8a96), '#0a0f14', 0.02);
      poly(g, mirror([[0.06, -0.55], [0.26, -0.38], [0.25, -0.32], [0.07, -0.36]]), Ccss(0x5d6873), '#0a0f14', 0.012);
      poly(g, mirror([[0, -0.72], [0.045, -0.62], [0.05, -0.42], [0, -0.38]]), Ccss(0x7fe4ff, 0.8));
      for (const s of [1, -1]) {
        g.fillStyle = Ccss(0x2d343c); g.fillRect(s * 0.45 - 0.03, 0.2, 0.06, 0.3);
        g.fillStyle = Ccss(0xd8432c); g.fillRect(s * 0.45 - 0.02, 0.2, 0.04, 0.05);
      }
      glow(g, 0, 0.98, 0.14, AMBER, 0.55);
    },
    firestorm(g) {
      poly(g, mirror([[0, -1], [0.18, -0.55], [0.95, 0.65], [0.85, 0.8], [0.25, 0.6], [0.12, 0.85], [0, 0.78]]),
        metalFill(g, -0.8, -0.4, 0.8, 0.8, HULL), '#0a0f14', 0.02);
      poly(g, mirror([[0, -0.6], [0.32, 0.25], [0, 0.42]]), Ccss(shade(HULL, -0.25)), Ccss(0x9b91a8, 0.6), 0.012);
      glow(g, 0, 0.05, 0.32, 0x78ff96, 0.55);
      g.fillStyle = Ccss(0xcfffe0); g.beginPath(); g.arc(0, 0.05, 0.06, 0, TAU); g.fill();
      for (const s of [1, -1]) glow(g, s * 0.55, 0.6, 0.12, 0x78ff96, 0.4);
    },
    avenger(g) {
      poly(g, mirror([[0, -1], [0.22, -0.72], [0.4, -0.2], [0.98, 0.42], [0.95, 0.62], [0.45, 0.55], [0.42, 0.9], [0.18, 0.98], [0, 0.9]]),
        metalFill(g, -0.8, -0.6, 0.8, 0.8, HULL), '#0a0f14', 0.02);
      poly(g, mirror([[0, -0.82], [0.14, -0.6], [0.2, 0.3], [0, 0.4]]), Ccss(shade(HULL, 0.18)), Ccss(0x2a2530), 0.012);
      g.strokeStyle = Ccss(0x9b91a8, 0.55); g.lineWidth = 0.012;
      g.strokeRect(-0.16, -0.3, 0.32, 0.5);
      for (const s of [1, -1]) {
        glow(g, s * 0.3, 0.88, 0.16, 0x78ff96, 0.5);
        g.fillStyle = Ccss(0x2a2530); g.fillRect(s * 0.3 - 0.06, 0.72, 0.12, 0.18);
      }
      poly(g, mirror([[0, -0.9], [0.06, -0.78], [0, -0.72]]), Ccss(0x7fe4ff, 0.85));
    },
  };
  function drawCraft(g, w, h, type) {
    const fn = CRAFT_ART[type];
    if (!fn) return;
    const R = Math.min(w, h) * 0.42;
    glow(g, w / 2, h / 2, R * 1.1, 0x1d4c6a, 0.4);
    // sombra projetada
    g.save();
    g.translate(w / 2 + R * 0.06, h / 2 + R * 0.08);
    g.scale(R, R);
    g.globalAlpha = 0.35;
    g.filter = 'blur(4px)';
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(0, 0, 0.8, 0.9, 0, 0, TAU); g.fill();
    g.restore();
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(R, R);
    g.lineJoin = 'round';
    fn(g);
    g.restore();
    dimLine(g, w / 2 - R, h / 2 + R * 1.08, w / 2 + R, h / 2 + R * 1.08);
    dimLine(g, w / 2 + R * 1.12, h / 2 - R, w / 2 + R * 1.12, h / 2 + R);
  }

  // ---- OVNIs: vista de cima + perfil; casco alienígena com luzes laranja ------------------------------------
  const UFO_SHAPE = {
    small_scout: { r: 0.5, ring: 0, pods: 0, lobes: 0, ax: 1, ay: 1, dome: 0.18 },
    medium_scout: { r: 0.62, ring: 0.82, pods: 0, lobes: 4, ax: 1, ay: 1, dome: 0.2 },
    large_scout: { r: 0.72, ring: 0.85, pods: 2, lobes: 0, ax: 1, ay: 1, dome: 0.24 },
    harvester: { r: 0.66, ring: 0.8, pods: 3, lobes: 0, ax: 1, ay: 1, dome: 0.26, claws: true },
    abductor: { r: 0.7, ring: 0.78, pods: 3, lobes: 0, ax: 1, ay: 1, dome: 0.3, fins: 3 },
    supply_ship: { r: 0.66, ring: 0, pods: 0, lobes: 0, ax: 1.45, ay: 0.95, dome: 0.2, box: true },
    terror_ship: { r: 0.66, ring: 0.82, pods: 2, lobes: 3, ax: 1.4, ay: 0.95, dome: 0.24, spikes: true },
    battleship: { r: 0.8, ring: 0.9, pods: 4, lobes: 8, lobeR: 0.13, ax: 1.1, ay: 1.1, dome: 0.32 },
  };
  function ufoTop(g, sh, lit) {
    const hull = metalFill(g, -1, -1, 1, 1, HULL);
    g.save();
    g.scale(sh.ax, sh.ay);
    if (sh.lobes) {
      for (let i = 0; i < sh.lobes; i++) {
        const a = (i / sh.lobes) * TAU + Math.PI / sh.lobes;
        g.fillStyle = Ccss(shade(HULL, -0.2));
        g.beginPath(); g.arc(Math.cos(a) * sh.r, Math.sin(a) * sh.r, sh.r * (sh.lobeR || 0.24), 0, TAU); g.fill();
        g.strokeStyle = '#0a0a10'; g.lineWidth = 0.02; g.stroke();
      }
    }
    if (sh.box) {
      g.fillStyle = hull;
      g.beginPath();
      if (g.roundRect) g.roundRect(-sh.r * 1.05, -sh.r * 0.85, sh.r * 2.1, sh.r * 1.7, 0.18); else g.rect(-sh.r * 1.05, -sh.r * 0.85, sh.r * 2.1, sh.r * 1.7);
      g.fill(); g.strokeStyle = '#0a0a10'; g.lineWidth = 0.025; g.stroke();
    }
    if (sh.spikes) {
      for (const s of [1, -1]) poly(g, [[sh.r * 0.6, s * sh.r * 0.35], [sh.r * 1.45, s * sh.r * 0.1], [sh.r * 0.7, s * sh.r * 0.7]], Ccss(shade(HULL, -0.15)), '#0a0a10', 0.02);
    }
    if (sh.fins) {
      for (let i = 0; i < sh.fins; i++) {
        const a = (i / sh.fins) * TAU + Math.PI / 2;
        const c = Math.cos(a), sn = Math.sin(a), px = -sn, py = c;
        poly(g, [[c * sh.r * 0.8 + px * 0.16, sn * sh.r * 0.8 + py * 0.16], [c * sh.r * 1.32, sn * sh.r * 1.32],
          [c * sh.r * 0.8 - px * 0.16, sn * sh.r * 0.8 - py * 0.16]], Ccss(shade(HULL, -0.3)), '#0a0a10', 0.02);
        if (lit) glow(g, c * sh.r * 1.25, sn * sh.r * 1.25, 0.07, 0xff6a2a, 0.8);
      }
    }
    if (sh.box) {
      // casco de carga retangular: porões, sem disco
      g.strokeStyle = 'rgba(20,16,28,0.6)'; g.lineWidth = 0.015;
      for (let i = 0; i < 4; i++) {
        const x = -sh.r * 0.9 + i * sh.r * 0.48;
        g.fillStyle = Ccss(shade(HULL, -0.28));
        g.fillRect(x, -sh.r * 0.7, sh.r * 0.36, sh.r * 0.38);
        g.fillRect(x, sh.r * 0.32, sh.r * 0.36, sh.r * 0.38);
        g.strokeRect(x, -sh.r * 0.7, sh.r * 0.36, sh.r * 0.38);
        g.strokeRect(x, sh.r * 0.32, sh.r * 0.36, sh.r * 0.38);
        if (lit) { glow(g, x + sh.r * 0.18, -sh.r * 0.78, 0.05, 0xffa040, 0.85); glow(g, x + sh.r * 0.18, sh.r * 0.78, 0.05, 0xffa040, 0.85); }
      }
      g.fillStyle = Ccss(shade(HULL, 0.1));
      g.fillRect(-sh.r * 1.0, -sh.r * 0.16, sh.r * 2.0, sh.r * 0.32);
      g.strokeRect(-sh.r * 1.0, -sh.r * 0.16, sh.r * 2.0, sh.r * 0.32);
      const dg2 = g.createRadialGradient(-0.03, -0.03, 0.01, 0, 0, sh.dome);
      dg2.addColorStop(0, Ccss(0xd8d0e8)); dg2.addColorStop(1, Ccss(0x4d4560));
      g.fillStyle = dg2; g.beginPath(); g.arc(-sh.r * 0.55, 0, sh.dome, 0, TAU); g.fill();
      g.strokeStyle = '#0a0a10'; g.lineWidth = 0.02; g.stroke();
      g.restore();
      return;
    }
    // disco principal (octogonal como os modelos de interior)
    const oct = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; oct.push([Math.cos(a) * sh.r, Math.sin(a) * sh.r]); }
    poly(g, oct, hull, '#0a0a10', 0.03);
    // costuras radiais das placas do casco e anel interior
    g.strokeStyle = 'rgba(20,16,28,0.55)'; g.lineWidth = 0.012;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      g.beginPath(); g.moveTo(Math.cos(a) * sh.dome * 1.15, Math.sin(a) * sh.dome * 1.15); g.lineTo(Math.cos(a) * sh.r * 0.9, Math.sin(a) * sh.r * 0.9); g.stroke();
    }
    if (sh.ring) {
      g.strokeStyle = Ccss(0x9b91a8, 0.55); g.lineWidth = 0.02;
      g.beginPath(); g.arc(0, 0, sh.r * sh.ring, 0, TAU); g.stroke();
    }
    g.strokeStyle = Ccss(0x9b91a8, 0.35); g.lineWidth = 0.015;
    g.beginPath(); g.arc(0, 0, sh.dome * 1.6, 0, TAU); g.stroke();
    for (let i = 0; i < sh.pods; i++) {
      const a = (i / sh.pods) * TAU - Math.PI / 2;
      const x = Math.cos(a) * sh.r * 0.62, y = Math.sin(a) * sh.r * 0.62;
      g.fillStyle = Ccss(shade(HULL, -0.35));
      g.beginPath(); g.arc(x, y, sh.r * 0.14, 0, TAU); g.fill();
      if (lit) glow(g, x, y, sh.r * 0.12, 0xff8a2a, 0.55);
    }
    if (sh.claws) for (const s of [1, -1]) poly(g, [[s * sh.r * 0.9, -0.12], [s * sh.r * 1.25, -0.3], [s * sh.r * 1.2, 0.3], [s * sh.r * 0.9, 0.12]], Ccss(shade(HULL, -0.3)), '#0a0a10', 0.02);
    // cúpula
    const dg = g.createRadialGradient(-0.05, -0.05, 0.01, 0, 0, sh.dome);
    dg.addColorStop(0, Ccss(0xd8d0e8));
    dg.addColorStop(1, Ccss(0x4d4560));
    g.fillStyle = dg;
    g.beginPath(); g.arc(0, 0, sh.dome, 0, TAU); g.fill();
    g.strokeStyle = '#0a0a10'; g.lineWidth = 0.02; g.stroke();
    // luzes da orla
    if (lit) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      glow(g, Math.cos(a) * sh.r * 0.92, Math.sin(a) * sh.r * 0.92, 0.06, 0xffa040, 0.85);
    }
    g.restore();
  }
  function ufoSide(g, sh, wR) {
    // perfil em lente com cúpula
    g.save();
    g.scale(sh.ax, 1);
    g.fillStyle = metalFill(g, 0, -0.3, 0, 0.3, HULL);
    g.beginPath();
    g.moveTo(-sh.r, 0);
    g.quadraticCurveTo(0, -0.26 * wR, sh.r, 0);
    g.quadraticCurveTo(0, 0.2 * wR, -sh.r, 0);
    g.fill(); g.strokeStyle = '#0a0a10'; g.lineWidth = 0.02; g.stroke();
    g.fillStyle = Ccss(0xb8b0cc);
    g.beginPath(); g.ellipse(0, -0.11 * wR, sh.dome * 0.9, sh.dome * 0.55, 0, Math.PI, TAU); g.fill(); g.stroke();
    for (let i = -3; i <= 3; i++) glow(g, (i / 3.6) * sh.r, 0.01, 0.035, 0xffa040, 0.85);
    g.restore();
  }
  // silhueta de um Intercetor à escala (comparação)
  function scaleRef(g, x, y, s) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.globalAlpha = 0.8;
    CRAFT_ART.interceptor(g);
    g.restore();
  }
  function drawUfo(g, w, h, type) {
    const sh = UFO_SHAPE[type];
    if (!sh) return;
    const u = D().ufos[type];
    // escala relativa entre tipos: pela largura do bloco (10..30 tiles)
    const span = Math.max(u.blockSize.w, u.blockSize.h);
    const R = Math.min(w * 0.4 / Math.max(1, sh.ax), h * 0.36) * (0.72 + 0.28 * (span / 30));
    const cx = w * 0.5, cy = h * 0.4;
    glow(g, cx, cy, R * 1.5, 0xff8a2a, 0.12);
    g.save(); g.translate(cx, cy); g.scale(R, R); ufoTop(g, sh, true); g.restore();
    // perfil
    const py = h * 0.85, pR = Math.min(w * 0.3 / Math.max(1, sh.ax), R * 0.95);
    g.save(); g.translate(cx, py); g.scale(pR, pR); ufoSide(g, sh, 1.6); g.restore();
    g.strokeStyle = Ccss(INK, 0.22);
    g.beginPath(); g.moveTo(w * 0.1, py + pR * 0.3); g.lineTo(w * 0.9, py + pR * 0.3); g.stroke();
    // referência: Intercetor à mesma escala (≈ 3 tiles de envergadura)
    const ref = R * (3 / span) * 1.2;
    scaleRef(g, w * 0.88, h * 0.14, Math.max(6, ref));
    dimLine(g, cx - R * sh.ax * sh.r, cy + R * 1.05, cx + R * sh.ax * sh.r, cy + R * 1.05);
  }

  // ---- instalações: planta vista de cima ----------------------------------------------------------------
  function facilityArt(g, id, n) {
    // referencial: célula 0..n (n = 1 ou 2)
    const S = n;
    g.fillStyle = metalFill(g, 0, 0, S, S, 0x2b3946);
    g.fillRect(0, 0, S, S);
    g.strokeStyle = Ccss(INK, 0.7); g.lineWidth = 0.02;
    g.strokeRect(0.02, 0.02, S - 0.04, S - 0.04);
    g.strokeStyle = Ccss(INK, 0.18); g.lineWidth = 0.008;
    for (let i = 1; i < 8 * S; i++) {
      g.beginPath(); g.moveTo(i / 8, 0.04); g.lineTo(i / 8, S - 0.04); g.stroke();
      g.beginPath(); g.moveTo(0.04, i / 8); g.lineTo(S - 0.04, i / 8); g.stroke();
    }
    // portas para as vizinhas (meio de cada lado)
    g.fillStyle = Ccss(0x0b1118);
    for (const [x, y, ww, hh] of [[S / 2 - 0.08, 0, 0.16, 0.05], [S / 2 - 0.08, S - 0.05, 0.16, 0.05], [0, S / 2 - 0.08, 0.05, 0.16], [S - 0.05, S / 2 - 0.08, 0.05, 0.16]]) g.fillRect(x, y, ww, hh);
    const c = S / 2;
    const ink = Ccss(INK, 0.85);
    const box = (x, y, ww, hh, f) => { g.fillStyle = f || Ccss(0x3d5163); g.fillRect(x, y, ww, hh); g.strokeStyle = ink; g.lineWidth = 0.012; g.strokeRect(x, y, ww, hh); };
    const ring = (r, col, lw) => { g.strokeStyle = col || ink; g.lineWidth = lw || 0.015; g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); };
    switch (id) {
      case 'access_lift': {
        box(0.22, 0.22, 0.56, 0.56, Ccss(0x1a242e));
        g.save(); g.beginPath(); g.rect(0.22, 0.22, 0.56, 0.56); g.clip();
        g.strokeStyle = Ccss(AMBER, 0.8); g.lineWidth = 0.05;
        for (let i = -1; i < 2; i += 0.16) { g.beginPath(); g.moveTo(i, 0.2); g.lineTo(i + 0.6, 0.8); g.stroke(); }
        g.restore();
        box(0.3, 0.3, 0.4, 0.4, Ccss(0x4a5a68));
        g.fillStyle = Ccss(TEALC);
        poly(g, [[0.5, 0.34], [0.6, 0.46], [0.4, 0.46]], Ccss(TEALC)); poly(g, [[0.5, 0.66], [0.6, 0.54], [0.4, 0.54]], Ccss(TEALC));
        break;
      }
      case 'living_quarters':
        for (let i = 0; i < 4; i++) { box(0.12, 0.12 + i * 0.2, 0.26, 0.12); box(0.62, 0.12 + i * 0.2, 0.26, 0.12); }
        g.fillStyle = Ccss(AMBER, 0.25); g.fillRect(0.44, 0.08, 0.12, 0.84);
        break;
      case 'laboratory':
        box(0.1, 0.12, 0.8, 0.12); box(0.1, 0.76, 0.8, 0.12);
        for (let i = 0; i < 5; i++) { glow(g, 0.18 + i * 0.16, 0.18, 0.05, i % 2 ? TEALC : 0x78ff96, 0.9); glow(g, 0.18 + i * 0.16, 0.82, 0.04, 0x58c8ff, 0.8); }
        box(0.36, 0.38, 0.28, 0.24, Ccss(0x1a2a36)); glow(g, 0.5, 0.5, 0.1, TEALC, 0.6);
        break;
      case 'workshop':
        box(0.1, 0.1, 0.32, 0.3); box(0.58, 0.1, 0.32, 0.3); box(0.1, 0.6, 0.8, 0.28);
        for (const [x, y] of [[0.26, 0.25], [0.74, 0.25]]) {
          g.strokeStyle = Ccss(AMBER); g.lineWidth = 0.02;
          g.beginPath(); g.arc(x, y, 0.08, 0, TAU); g.stroke();
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.moveTo(x + Math.cos(a) * 0.08, y + Math.sin(a) * 0.08); g.lineTo(x + Math.cos(a) * 0.11, y + Math.sin(a) * 0.11); g.stroke(); }
        }
        g.strokeStyle = Ccss(INK, 0.5); g.setLineDash([0.03, 0.02]); g.beginPath(); g.moveTo(0.12, 0.74); g.lineTo(0.88, 0.74); g.stroke(); g.setLineDash([]);
        break;
      case 'general_stores':
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
          box(0.12 + x * 0.27, 0.12 + y * 0.27, 0.22, 0.22, Ccss(x === 1 && y === 1 ? 0x5a4a2a : 0x4a5a3a));
          g.strokeStyle = Ccss(0x0b1118, 0.6); g.beginPath(); g.moveTo(0.12 + x * 0.27, 0.12 + y * 0.27); g.lineTo(0.34 + x * 0.27, 0.34 + y * 0.27); g.stroke();
        }
        break;
      case 'alien_containment':
        for (let i = 0; i < 2; i++) {
          box(0.1 + i * 0.44, 0.14, 0.36, 0.72, Ccss(0x162a22));
          glow(g, 0.28 + i * 0.44, 0.5, 0.12, 0x78ff96, 0.55);
          g.fillStyle = Ccss(0x9aa0a8); g.beginPath(); g.ellipse(0.28 + i * 0.44, 0.44, 0.05, 0.065, 0, 0, TAU); g.fill();
          g.strokeStyle = Ccss(INK, 0.9); g.lineWidth = 0.012;
          for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(0.1 + i * 0.44 + k * 0.06, 0.14); g.lineTo(0.1 + i * 0.44 + k * 0.06, 0.86); g.stroke(); }
        }
        break;
      case 'hangar': {
        ring(0.78, Ccss(AMBER, 0.6), 0.03);
        ring(0.6, Ccss(INK, 0.4), 0.012);
        g.fillStyle = Ccss(0x1b2630); g.beginPath(); g.arc(c, c, 0.76, 0, TAU); g.fill();
        g.save(); g.translate(c, c); g.scale(0.42, 0.42); CRAFT_ART.interceptor(g); g.restore();
        for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; glow(g, c + Math.cos(a) * 0.86, c + Math.sin(a) * 0.86, 0.04, AMBER, 0.8); }
        break;
      }
      case 'small_radar':
      case 'large_radar':
      case 'hyper_wave_decoder': {
        const big = id !== 'small_radar';
        const col = id === 'hyper_wave_decoder' ? 0xb48cff : TEALC;
        for (let r = 0.12; r < (big ? 0.46 : 0.36); r += 0.08) ring(r, Ccss(col, 0.45), 0.01);
        g.fillStyle = Ccss(0x4a5a68); g.beginPath(); g.arc(c, c, big ? 0.3 : 0.22, 0, TAU); g.fill();
        g.strokeStyle = ink; g.lineWidth = 0.015; g.stroke();
        const sw = g.createRadialGradient(c, c, 0, c, c, 0.45);
        sw.addColorStop(0, Ccss(col, 0.6)); sw.addColorStop(1, Ccss(col, 0));
        g.fillStyle = sw; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 0.45, -0.9, -0.2); g.closePath(); g.fill();
        g.strokeStyle = Ccss(col); g.lineWidth = 0.02; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(-0.2) * 0.45, c + Math.sin(-0.2) * 0.45); g.stroke();
        if (id === 'hyper_wave_decoder') for (let k = 0; k < 3; k++) { g.strokeStyle = Ccss(col, 0.7 - k * 0.2); g.beginPath(); g.arc(c, c, 0.36 + k * 0.05, 3.6, 4.6); g.stroke(); }
        break;
      }
      case 'missile_defence':
        box(0.25, 0.25, 0.5, 0.5, Ccss(0x3a4652));
        for (const [x, y] of [[0.36, 0.36], [0.64, 0.36], [0.36, 0.64], [0.64, 0.64]]) {
          g.fillStyle = Ccss(0xeceee8); g.beginPath(); g.arc(x, y, 0.07, 0, TAU); g.fill();
          g.fillStyle = Ccss(0xd8432c); g.beginPath(); g.arc(x, y, 0.035, 0, TAU); g.fill();
        }
        break;
      case 'laser_defence':
      case 'plasma_defence': {
        const col = id === 'laser_defence' ? 0xff4f43 : 0x78ff96;
        g.fillStyle = Ccss(0x4a5a68); g.beginPath(); g.arc(c, c, 0.24, 0, TAU); g.fill(); g.strokeStyle = ink; g.lineWidth = 0.015; g.stroke();
        g.fillStyle = Ccss(0x2a323a); g.fillRect(c - 0.04, c - 0.46, 0.08, 0.42);
        if (id === 'plasma_defence') g.fillRect(c - 0.12, c - 0.36, 0.06, 0.3), g.fillRect(c + 0.06, c - 0.36, 0.06, 0.3);
        glow(g, c, c - 0.46, 0.1, col, 0.9);
        glow(g, c, c, 0.12, col, 0.45);
        break;
      }
      default:
        break;
    }
  }
  function drawFacility(g, w, h, id) {
    const f = D().facilities[id];
    const n = f ? f.size : 1;
    const S = Math.min(w, h) * (n > 1 ? 0.78 : 0.58);
    g.save();
    g.translate(w / 2 - S / 2, h / 2 - S / 2);
    g.scale(S / n, S / n);
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 18;
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    g.shadowBlur = 0;
    facilityArt(g, id, n);
    g.restore();
    dimLine(g, w / 2 - S / 2, h / 2 + S / 2 + 14, w / 2 + S / 2, h / 2 + S / 2 + 14);
  }

  // ---- artigos de investigação -------------------------------------------------------------------------
  function planet(g, x, y, r, col, night) {
    const pg = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    pg.addColorStop(0, Ccss(shade(col, 0.3)));
    pg.addColorStop(0.7, Ccss(col));
    pg.addColorStop(1, Ccss(shade(col, -0.7)));
    g.fillStyle = pg;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (night) {
      const ng = g.createLinearGradient(x - r, y, x + r, y);
      ng.addColorStop(0.45, 'rgba(0,0,0,0)'); ng.addColorStop(1, 'rgba(0,0,10,0.75)');
      g.fillStyle = ng; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
  }
  function stars(g, w, h, n, seed) {
    const R = OV.RNG ? OV.RNG.create(seed) : { next: Math.random };
    for (let i = 0; i < n; i++) {
      g.fillStyle = 'rgba(230,240,255,' + (0.2 + R.next() * 0.7).toFixed(2) + ')';
      const s = R.next() < 0.1 ? 1.6 : 1;
      g.fillRect(R.next() * w, R.next() * h, s, s);
    }
  }
  function drawStory(g, w, h, id) {
    const m = Math.min(w, h);
    if (id === 'laser_weapons') {
      g.strokeStyle = Ccss(0xff4f43, 0.9); g.lineWidth = 3;
      g.beginPath(); g.moveTo(w * 0.52, h * 0.5); g.lineTo(w * 0.98, h * 0.2); g.stroke();
      glow(g, w * 0.98, h * 0.2, m * 0.12, 0xff4f43, 0.6);
      g.strokeStyle = Ccss(0xffd0c0, 0.9); g.lineWidth = 1;
      g.beginPath(); g.moveTo(w * 0.52, h * 0.5); g.lineTo(w * 0.98, h * 0.2); g.stroke();
      drawItem(g, w * 0.9, h, 'laser_rifle');
      return;
    }
    if (id === 'alien_interrogation') {
      const cone = g.createLinearGradient(0, 0, 0, h);
      cone.addColorStop(0, 'rgba(255,240,200,0.35)'); cone.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = cone;
      poly(g, [[w * 0.46, 0], [w * 0.54, 0], [w * 0.75, h * 0.9], [w * 0.25, h * 0.9]], cone);
      drawUnit(g, w, h, 'sectoid', { team: 'alien' }, 0.55);
      g.strokeStyle = Ccss(INK, 0.55); g.lineWidth = 3;
      for (let i = 1; i < 9; i++) { g.beginPath(); g.moveTo((w * i) / 9, h * 0.08); g.lineTo((w * i) / 9, h * 0.92); g.stroke(); }
      g.fillStyle = Ccss(0x0b1118, 0.85); g.fillRect(0, h * 0.06, w, 6); g.fillRect(0, h * 0.9, w, 6);
      return;
    }
    if (id === 'alien_origins' || id === 'martian_solution') {
      stars(g, w, h, 160, 7);
      planet(g, w * 0.18, h * 0.8, m * 0.32, 0x2c6aa0, true);
      const mx = w * 0.74, my = h * 0.32, mr = id === 'martian_solution' ? m * 0.26 : m * 0.1;
      planet(g, mx, my, mr, 0xb5512e, true);
      g.strokeStyle = Ccss(AMBER, 0.7); g.setLineDash([6, 5]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(w * 0.3, h * 0.62); g.quadraticCurveTo(w * 0.45, h * 0.2, mx - mr * 1.1, my + mr * 0.2); g.stroke();
      g.setLineDash([]);
      if (id === 'martian_solution') {
        const x = mx - mr * 0.25, y = my - mr * 0.15;
        g.strokeStyle = Ccss(0xff4f43); g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, mr * 0.16, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(x - mr * 0.3, y); g.lineTo(x + mr * 0.3, y); g.moveTo(x, y - mr * 0.3); g.lineTo(x, y + mr * 0.3); g.stroke();
      } else for (let i = 0; i < 5; i++) glow(g, w * (0.36 + i * 0.07), h * (0.5 - i * 0.05), 4, 0xffa040, 0.9);
      return;
    }
    if (id === 'cydonia') {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#120a10'); sky.addColorStop(0.65, '#5a2a1a'); sky.addColorStop(1, '#2a140c');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      stars(g, w, h * 0.5, 90, 11);
      planet(g, w * 0.82, h * 0.18, m * 0.05, 0x2c6aa0, false);
      poly(g, [[w * 0.28, h * 0.72], [w * 0.5, h * 0.3], [w * 0.74, h * 0.72]], metalFill(g, w * 0.3, h * 0.3, w * 0.7, h * 0.7, 0x7a4a34), '#1a0c08', 2);
      poly(g, [[w * 0.5, h * 0.3], [w * 0.74, h * 0.72], [w * 0.56, h * 0.74]], 'rgba(0,0,0,0.35)');
      glow(g, w * 0.5, h * 0.42, m * 0.1, 0xb48cff, 0.5);
      g.fillStyle = '#3a1c10'; g.beginPath(); g.moveTo(0, h * 0.7); g.quadraticCurveTo(w * 0.3, h * 0.64, w * 0.6, h * 0.74); g.quadraticCurveTo(w * 0.85, h * 0.8, w, h * 0.7); g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.save(); g.translate(w * 0.2, h * 0.22); g.rotate(0.5); g.scale(m * 0.09, m * 0.09); CRAFT_ART.avenger(g); g.restore();
      return;
    }
    if (id === 'ufo_construction') {
      const sh = UFO_SHAPE.large_scout, R = m * 0.3;
      g.save(); g.translate(w * 0.5, h * 0.36); g.scale(R, R * 0.5); g.globalAlpha = 0.9; ufoTop(g, sh, false); g.restore();
      g.save(); g.translate(w * 0.5, h * 0.74); g.scale(R, R); ufoSide(g, sh, 1.2); g.restore();
      g.strokeStyle = Ccss(INK, 0.5); g.setLineDash([5, 4]);
      for (const x of [-0.6, 0, 0.6]) { g.beginPath(); g.moveTo(w * 0.5 + x * R, h * 0.45); g.lineTo(w * 0.5 + x * R, h * 0.66); g.stroke(); }
      g.setLineDash([]);
      if (OV.ItemSprites) { OV.ItemSprites.drawIcon(g, 'ufo_power_source', w * 0.04, h * 0.5, m * 0.26); OV.ItemSprites.drawIcon(g, 'ufo_navigation', w * 0.96 - m * 0.26, h * 0.5, m * 0.26); }
    }
  }

  // desenha o artigo num contexto já escalado ao dpr (w×h px CSS); opts.unit escolhe a patente nas raças
  function illustrate(g, id, w, h, opts) {
    const a = article(id);
    if (!a) return;
    const Dt = D();
    g.save();
    const tint = a.kind === 'race' ? 0x1f4a3a : a.kind === 'ufo' ? 0x3a2a4a : a.sec === 'components' ? 0x2a3a4a : 0x1d4c6a;
    if (!(a.kind === 'story' && a.id === 'cydonia')) backdrop(g, w, h, tint);
    try {
      if (a.kind === 'item' || a.kind === 'cw') {
        const it = Dt.items[a.ref];
        const cw = a.kind === 'cw' ? Dt.craftWeapons[a.ref] : null;
        const extras = cw ? (cw.ammoItem ? [cw.ammoItem] : []) : (it.ammo || []).filter((x) => Dt.items[x]);
        drawItem(g, w, h, it.id, extras);
      } else if (a.kind === 'armour') {
        drawUnit(g, w, h, 'soldier', { armour: a.ref, weapon: 'rifle', gun: a.ref === 'coveralls' ? 'ballistic' : 'laser', team: 'xcom', skin: 1 }, 0.72);
        const ar = Dt.armours[a.ref];
        if (ar.storeItem && OV.ItemSprites) OV.ItemSprites.drawIcon(g, ar.storeItem, w - Math.min(w, h) * 0.3, h * 0.06, Math.min(w, h) * 0.26);
      } else if (a.kind === 'race') {
        const units = unitsOf(a);
        const uid = opts && units.includes(opts.unit) ? opts.unit : units[0];
        const u = Dt.units[uid];
        const sprite = u.sprite || u.species || a.ref;
        const armed = !a.terror;
        drawUnit(g, w, h, sprite, { team: 'alien', weapon: armed ? (uid.endsWith('commander') || uid.endsWith('leader') ? 'heavy' : 'rifle') : 'none', gun: 'plasma', pose: u.move === 'fly' ? 'float' : 'stand' }, (u.size || 1) > 1 ? 0.62 : 0.72);
      } else if (a.kind === 'craft') drawCraft(g, w, h, a.ref);
      else if (a.kind === 'facility') drawFacility(g, w, h, a.ref);
      else if (a.kind === 'ufo') drawUfo(g, w, h, a.ref);
      else drawStory(g, w, h, a.id);
    } catch (e) {
      // arte é cosmética: uma falha de desenho nunca impede o artigo
      if (typeof console !== 'undefined') console.warn('Ufopédia: ilustração', a.id, e);
    }
    vignette(g, w, h);
    g.restore();
  }

  // ================================================================================================
  // Cena
  // ================================================================================================
  function sfx(name) {
    try { if (OV.audio && OV.audio.play) OV.audio.play(name); } catch (e) { /* som é opcional */ }
  }
  const reduceMotion = () => (OV.Game && typeof OV.Game.reduceMotion === 'function' ? OV.Game.reduceMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  OV.SceneDefs = OV.SceneDefs || {};
  OV.SceneDefs.ufopaedia = function (params) {
    const P = params || {};
    const G = P.G || null;
    const el = (...x) => OV.Dom.el(...x);
    let root = null, nav = null, artBox = null, canvas = null, figCap = null, searchInp = null, counter = null;
    let titleEl = null, kickerEl = null, prevBtn = null, nextBtn = null, textEl = null, statsEl = null, chipsEl = null, newEl = null, infoEl = null;
    let list = [];
    let shown = [];
    let cur = null;
    let unit = null; // patente escolhida nas raças
    let query = '';
    let figW = 0, figH = 0, scanT = 0, base = null;
    let swipe = null, wheelAcc = 0, wheelT = 0;
    const navRows = new Map();

    function pickStart() {
      const want = resolve(P.articleId);
      if (want && isOpen(G, want)) return catalogue().byId[want];
      if (P.section) { const s = list.find((a) => a.sec === P.section); if (s) return s; }
      if (G && G.ui && G.ui.ufopaediaLast) { const l = article(G.ui.ufopaediaLast); if (l && isOpen(G, l.id)) return l; }
      return list[0] || null;
    }

    function buildNav() {
      centerNext = true;
      OV.Dom.clear(nav);
      navRows.clear();
      shown = search(list, query);
      const counts = sectionCounts(G);
      if (!shown.length) {
        nav.appendChild(el('p', { class: 'up-empty', text: T('up.search.none') }));
        return;
      }
      for (const s of SECTIONS) {
        const items = shown.filter((a) => a.sec === s);
        if (!items.length) continue;
        const c = counts[s];
        const head = el('div', { class: 'up-nav-sec' },
          el('span', { class: 'up-nav-sec-t', text: T('up.sec.' + s) }),
          el('span', { class: 'up-nav-sec-n', text: G ? c.open + '/' + c.total : String(c.total) }));
        const ul = el('ul', { class: 'up-nav-list', role: 'listbox', 'aria-label': T('up.sec.' + s) });
        for (const a of items) {
          const li = el('li', { class: 'up-nav-item', role: 'option', tabindex: '-1', dataset: { id: a.id } },
            el('span', { class: 'up-nav-name', text: title(a) }),
            isNew(G, a.id) ? el('span', { class: 'up-new', text: T('up.new') }) : null);
          li.addEventListener('click', () => { if (cur !== a) sfx('ui_select'); show(a); });
          navRows.set(a.id, li);
          ul.appendChild(li);
        }
        nav.append(head, ul);
      }
      if (G) {
        const all = articles().length, open = list.length;
        if (open < all && !query) nav.appendChild(el('p', { class: 'up-locked', text: OV.Tn('up.locked', all - open) }));
      }
      markSel();
    }
    let centerNext = true;
    function markSel() {
      for (const [id, li] of navRows) {
        const on = cur && id === cur.id;
        li.classList.toggle('sel', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) li.scrollIntoView({ block: centerNext ? 'center' : 'nearest' });
      }
      centerNext = false;
    }

    const order = () => (shown.length ? shown : list);
    function neighbour(d) {
      const o = order();
      if (!cur || !o.length) return null;
      let i = o.indexOf(cur);
      if (i < 0) i = 0;
      return o[(i + d + o.length) % o.length];
    }

    function renderBlocks(blocks) {
      OV.Dom.clear(statsEl);
      for (const b of blocks) {
        if (b.note) { statsEl.appendChild(el('p', { class: 'up-note', text: b.note })); continue; }
        if (b.kv) {
          const dl = el('dl', { class: 'up-kv' });
          for (const [k, v] of b.kv) dl.append(el('dt', { text: k }), el('dd', { text: v }));
          statsEl.appendChild(el('section', { class: 'up-block' }, b.title ? el('h3', { class: 'up-block-t', text: b.title }) : null, dl));
          continue;
        }
        const t = b.table;
        const tbl = el('table', { class: 'tbl up-tbl' },
          el('thead', null, el('tr', null, t.head.map((hd, i) => el('th', { class: i === t.hi ? 'hi' : null, text: hd })))),
          el('tbody', null, t.rows.map((r) => el('tr', null, r.map((v, i) => el('td', { class: i === t.hi ? 'hi' : null, text: v }))))));
        statsEl.appendChild(el('section', { class: 'up-block' }, t.title ? el('h3', { class: 'up-block-t', text: t.title }) : null, tbl));
      }
    }

    function show(a, dir) {
      if (!a) return;
      const changed = cur !== a;
      cur = a;
      if (changed) {
        const us = unitsOf(a);
        unit = us[0] || null;
      }
      titleEl.textContent = title(a);
      kickerEl.textContent = T('up.sec.' + a.sec);
      const o = order();
      counter.textContent = T('up.counter', { i: Math.max(1, o.indexOf(a) + 1), n: o.length });
      const wasNew = isNew(G, a.id);
      newEl.classList.toggle('hidden', !wasNew);
      textEl.textContent = text(a);
      // escolha de patente (raças com vários membros)
      OV.Dom.clear(chipsEl);
      const us = unitsOf(a);
      chipsEl.classList.toggle('hidden', us.length < 2);
      if (us.length > 1) {
        for (const u of us) {
          const b = el('button', { type: 'button', class: 'up-chip' + (u === unit ? ' on' : ''), 'aria-pressed': u === unit ? 'true' : 'false',
            text: T('arank.' + D().units[u].rank) });
          b.addEventListener('click', () => { if (unit !== u) { unit = u; sfx('ui_click'); show(cur); } });
          chipsEl.appendChild(b);
        }
      }
      renderBlocks(stats(a.id, G, { unit }));
      const p = prevBtn.querySelector('.up-pn-name'), n = nextBtn.querySelector('.up-pn-name');
      const pa = neighbour(-1), na = neighbour(1);
      p.textContent = pa ? title(pa) : '';
      n.textContent = na ? title(na) : '';
      prevBtn.disabled = nextBtn.disabled = o.length < 2;
      figCap.textContent = T('up.fig', { n: String(a.idx + 1).padStart(2, '0'), name: a.kind === 'race' && unit ? T('unit.' + unit) : title(a) });
      base = null;
      drawFig(true);
      if (changed) {
        artBox.scrollTop = 0;
        infoEl.scrollTop = 0;
        if (dir && !reduceMotion()) {
          artBox.classList.remove('up-slide-l', 'up-slide-r');
          void artBox.offsetWidth;
          artBox.classList.add(dir > 0 ? 'up-slide-l' : 'up-slide-r');
        }
      }
      if (G) {
        markRead(G, a.id);
        G.ui.ufopaediaLast = a.id;
        const li = navRows.get(a.id);
        if (li && wasNew) { const b = li.querySelector('.up-new'); if (b) b.remove(); }
      }
      markSel();
    }
    function go(d) {
      const a = neighbour(d);
      if (a && a !== cur) { sfx('ui_select'); show(a, d); }
    }

    // ilustração: base em cache + varrimento animado
    function drawFig(force) {
      if (!canvas || !cur) return;
      const box = canvas.parentNode;
      const w = Math.max(80, Math.round(box.clientWidth)), h = Math.max(60, Math.round(box.clientHeight));
      const k = (OV.View && OV.View.dpr) || Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
      if (force || w !== figW || h !== figH || !base) {
        figW = w; figH = h;
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        base = document.createElement('canvas');
        base.width = canvas.width; base.height = canvas.height;
        const bg = base.getContext('2d');
        bg.setTransform(k, 0, 0, k, 0, 0);
        illustrate(bg, cur.id, w, h, { unit });
      }
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(base, 0, 0);
      if (!reduceMotion()) {
        const y = ((scanT / 3200) % 1) * canvas.height;
        const sg = g.createLinearGradient(0, y - 40 * k, 0, y);
        sg.addColorStop(0, 'rgba(120,220,255,0)');
        sg.addColorStop(1, 'rgba(120,220,255,0.10)');
        g.fillStyle = sg;
        g.fillRect(0, y - 40 * k, canvas.width, 40 * k);
        g.fillStyle = 'rgba(160,235,255,0.28)';
        g.fillRect(0, y, canvas.width, Math.max(1, k));
      }
    }

    // pesquisa: mostra o 1.º resultado; sem resultados volta ao artigo que estava aberto antes de pesquisar (nunca
    // fica um artigo de uma correspondência intermédia, sem relação com o que se escreveu)
    let preSearch = null;
    function onSearch() {
      const prevQuery = query;
      query = searchInp.value;
      if (query && !prevQuery) preSearch = cur;
      buildNav();
      if (!shown.length) { if (preSearch && cur !== preSearch) show(preSearch); else if (cur) show(cur); }
      else if (!shown.includes(cur)) show(shown[0]);
      else if (cur) show(cur);
      if (!query) preSearch = null;
    }

    function close() {
      sfx('ui_click');
      if (OV.Scenes.stack.length > 1) OV.Scenes.pop();
      else OV.Scenes.set('menu');
    }

    function buildDom() {
      const host = OV.Dom.$('hud');
      root = el('div', { class: 'scr scr-ufopaedia up-root' + (G ? ' up-campaign' : ' up-archive') });
      kickerEl = el('div', { class: 'scr-kicker up-kicker' });
      titleEl = el('h1', { class: 'scr-title up-title' });
      newEl = el('span', { class: 'up-new up-new-big hidden', text: T('up.new') });
      searchInp = el('input', { type: 'search', class: 'up-search', placeholder: T('up.search'), 'aria-label': T('up.search.aria'), autocomplete: 'off', spellcheck: 'false' });
      searchInp.addEventListener('input', onSearch);
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (searchInp.value) { searchInp.value = ''; onSearch(); } else searchInp.blur();
        } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (shown.length) { show(shown[0]); searchInp.blur(); }
        }
      });
      nav = el('nav', { class: 'up-nav scr-scroll', 'data-scroll': '', 'aria-label': T('up.nav') });
      canvas = el('canvas', { class: 'up-canvas', role: 'img', 'aria-label': T('up.fig.aria') });
      figCap = el('div', { class: 'up-figcap' });
      const fig = el('figure', { class: 'up-fig' }, el('div', { class: 'up-fig-box' }, canvas), figCap);
      fig.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY, t: e.timeStamp }; });
      fig.addEventListener('pointerup', (e) => {
        if (!swipe) return;
        const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      });
      textEl = el('p', { class: 'up-text' });
      chipsEl = el('div', { class: 'up-chips', role: 'group', 'aria-label': T('up.ranks') });
      statsEl = el('div', { class: 'up-stats' });
      infoEl = el('div', { class: 'up-info scr-scroll', 'data-scroll': '', tabindex: '0', 'aria-label': T('up.info.aria') }, chipsEl, textEl, statsEl);
      artBox = el('article', { class: 'up-art', 'data-scroll': '' }, fig, infoEl);
      // deslizar com dois dedos no trackpad (horizontal) muda de artigo
      artBox.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
        const now = e.timeStamp;
        if (now - wheelT > 700) wheelAcc = 0;
        wheelT = now;
        wheelAcc += e.deltaX;
        if (Math.abs(wheelAcc) > 90) { go(wheelAcc > 0 ? 1 : -1); wheelAcc = -Math.sign(wheelAcc) * 400; }
      }, { passive: true });
      const pn = (d, cls, key) => {
        const b = el('button', { type: 'button', class: 'btn up-pn ' + cls, 'aria-label': T(key) },
          el('span', { class: 'up-pn-k', text: T(key) }), el('span', { class: 'up-pn-name' }));
        b.addEventListener('click', () => go(d));
        return b;
      };
      prevBtn = pn(-1, 'up-prev', 'up.prev');
      nextBtn = pn(1, 'up-next', 'up.next');
      counter = el('span', { class: 'up-counter' });
      const closeBtn = el('button', { type: 'button', class: 'btn up-close', text: T('up.close') });
      closeBtn.addEventListener('click', close);
      root.appendChild(el('div', { class: 'scr-panel up-panel', role: 'dialog', 'aria-label': T(G ? 'up.title' : 'up.archive') },
        el('header', { class: 'up-head' },
          el('div', { class: 'up-brand' },
            el('div', { class: 'up-logo', text: T(G ? 'up.title' : 'up.archive') }),
            el('div', { class: 'up-brand-sub', text: T(G ? 'up.sub.campaign' : 'up.sub.archive') })),
          el('div', { class: 'up-headline' }, kickerEl, el('div', { class: 'up-title-row' }, titleEl, newEl)),
          el('div', { class: 'up-tools' }, searchInp, closeBtn)),
        el('div', { class: 'up-body' }, nav, artBox),
        el('footer', { class: 'up-foot' }, prevBtn,
          el('div', { class: 'up-mid' }, counter, el('span', { class: 'up-hint', text: T('up.hint') })),
          nextBtn)));
      host.appendChild(root);
    }

    const sc = {
      id: 'ufopaedia',
      isScreen: true,
      enter() {
        list = openArticles(G);
        buildDom();
        buildNav();
        show(pickStart());
        setTimeout(() => { if (root && root.isConnected && !(document.activeElement && document.activeElement.tagName === 'INPUT')) root.querySelector('.up-next').focus({ preventScroll: true }); }, 0);
      },
      exit() {
        if (!root) return;
        const r = root;
        root = null;
        r.classList.add('scr-leaving');
        r.setAttribute('aria-hidden', 'true');
        setTimeout(() => r.remove(), 170);
      },
      pause() { if (root) root.classList.add('scr-paused'); },
      resume() {
        if (!root) return;
        root.classList.remove('scr-paused');
        list = openArticles(G);
        buildNav();
        show(cur && isOpen(G, cur.id) ? cur : list[0]);
      },
      think(dt) {
        scanT += dt;
        if (root && cur) drawFig(false);
      },
      draw(ctx, view) {
        if (OV.Screens && OV.Screens.Backdrop) OV.Screens.Backdrop.draw(ctx, view, { dim: 0.45 });
        else {
          ctx = view.begin ? view.begin(false) : ctx;
          ctx.fillStyle = '#05080c';
          ctx.fillRect(0, 0, view.w, view.h);
        }
      },
      onInput(ev) {
        if (ev.kind !== 'key') return false;
        const k = ev.key;
        // foco no texto do artigo (ou no artigo inteiro, em retrato): ↑/↓/PageUp/PageDown/Início/Fim deslocam o texto;
        // só ←/→ mudam de artigo
        const a = document.activeElement;
        const box = a && a.closest ? a.closest('.up-info, .up-art') : null;
        if (box && k !== 'ArrowLeft' && k !== 'ArrowRight') {
          const sk = OV.Screens && OV.Screens.ui && OV.Screens.ui.scrollKeys;
          const scroller = box.scrollHeight > box.clientHeight + 1 ? box : box.closest('.up-art');
          if (sk && scroller && sk(ev, scroller)) return true;
        }
        if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') { go(1); return true; }
        if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { go(-1); return true; }
        if (k === 'Home' || k === 'End') {
          const o = order();
          if (o.length) { sfx('ui_select'); show(k === 'Home' ? o[0] : o[o.length - 1]); }
          return true;
        }
        if (k === '/' || k === 'f' || k === 'F') { searchInp.focus(); searchInp.select(); return true; }
        if (k === 'Escape' || k === 'u' || k === 'U') { close(); return true; }
        return false;
      },
      onResize() { base = null; },
    };
    return sc;
  };

  // entrada pública: push da cena; G null ⇒ Arquivo (menu principal)
  function open(G, articleId, section) {
    if (!OV.Scenes) return null;
    return OV.Scenes.push('ufopaedia', { G: G || null, articleId: articleId || null, section: section || null });
  }

  OV.Ufopaedia = {
    SECTIONS, catalogue, article, articles, resolve, isOpen, openArticles, sectionCounts, isNew, markRead,
    title, text, stats, illustrate, unitsOf, search, open,
    rebuild: () => { CAT = null; return catalogue(); },
  };
})(globalThis.OV || (globalThis.OV = {}));
