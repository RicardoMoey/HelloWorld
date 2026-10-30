/* Ronda de personas 5 — correções do «shell» (estratégia, campanha, base): dica presa ao trocar de cena, «Ficaram em…»
   com o que já vai a bordo, «Esperar pelo dia» só quando o OVNI fica, transporte que regressa em vez de perseguir,
   «Vender material» abre Vender, kit noturno/completar o kit, próximos passos clicáveis, embarque depois das baixas,
   tipo do OVNI no cabeçalho da interceção, briefing de OVNI danificado, botões segmentados com aria-pressed, avisos da
   base em retrato, saúde distinta das UT na paleta para daltonismo. Carrega os ficheiros de interface em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Dom || !OV.Dom.tooltipNode) load('js/ui/dom.js');
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI || !OV.GeoUI.model.groundTransport) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.fieldKitPlan) load('js/ui/campaign_ui.js');
  if (!OV.BaseUI || !OV.BaseUI.lostTopics) load('js/ui/base_ui.js');
  if (!OV.DogfightUI || !OV.DogfightUI.model) load('js/ui/dogfight_ui.js');
  const M = OV.GeoUI.model, D = OV.Data, C = OV.Campaign, CU = OV.CampaignUI;
  const has = (k) => typeof OV.STR[k] === 'string';
  const NEW = (seed, difficulty) => C.newCampaign({ seed, difficulty, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const transportOf = (G) => Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => D.crafts[c.type].transport);
  const nightUfo = (G, groundH) => {
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon: 0, lat: 10, hyper: false, race: 'sectoid', missionId: null, crashLeftS: 0, groundLeftS: 0, detected: true };
    G.ufos.push(u);
    let k = 0;
    while (k < 48 && OV.GMath.dayPhase(G, u.lon, u.lat) !== 'night') { G.t += 3600; k++; }
    const ref = { kind: 'ufo', id: u.id };
    u.groundLeftS = Math.round(groundH * 3600);
    return { u, ref };
  };

  // ---- #0 / #8 dica presa por cima do ecrã seguinte -----------------------------------------------------------------
  t.test('r5 (Rui, Tiago): trocar de cena esconde a dica e a etiqueta de toque longo (push, pop, replace, set)', () => {
    let tips = 0, lps = 0;
    const ctx = vm.createContext({});
    ctx.OV = { Dom: { hideTooltip: () => { tips++; }, hideLongPress: () => { lps++; }, clearToasts: () => {} }, SceneDefs: {} };
    ctx.globalThis = ctx;
    vm.runInContext(read('js/ui/scenes.js'), ctx, { filename: 'scenes.js' });
    const S = ctx.OV.Scenes;
    ctx.OV.SceneDefs.a = () => ({ isScreen: true });
    ctx.OV.SceneDefs.b = () => ({ isScreen: true });
    S.set('a'); t.ok(tips >= 1 && lps >= 1, 'set');
    let n = tips; S.push('b'); t.ok(tips > n, 'push');
    n = tips; S.replace('a'); t.ok(tips > n, 'replace');
    n = tips; S.pop(); t.ok(tips > n, 'pop');
    // dom.js: a dica lembra o nó de origem e some ao primeiro movimento se ele saiu do DOM ou já não está debaixo do ponteiro
    const src = read('js/ui/dom.js');
    t.ok(/if \(tipNode && \(!tipNode\.isConnected \|\| \(tipNode\.matches && !tipNode\.matches\(':hover'\)\)\)\) hideTooltip\(\);/.test(src), 'pointermove esconde a dica órfã');
    t.ok(/const host = \$\('modals'\);\s*hideTooltip\(\);\s*hideLongPress\(\);/.test(src), 'um modal novo esconde a dica');
    t.ok(/tipNode = node;/.test(src) && /function hideTooltip\(\) \{\s*tipNode = null;/.test(src));
    t.eq(typeof OV.Dom.tooltipNode, 'function');
  });

  // ---- #1 «Ficaram em…» ignorava os tipos que já vão a bordo ---------------------------------------------------------
  t.test('r5 (Rui): «Ficaram em …» inclui o que já vai a bordo quando fica muito mais na base (sinalizadores à noite primeiro)', () => {
    const G = NEW(51, 2);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    c.status = 'out';
    const pool = C.equipPool(G, c.id);
    const aboard = Object.assign({}, pool.stores);
    for (const s of pool.squad) for (const id of [s.loadout.R, s.loadout.L, ...(s.loadout.belt || []), ...(s.loadout.pack || [])]) if (id) aboard[id] = (aboard[id] | 0) + 1;
    t.ok((aboard.grenade | 0) > 0, 'há granadas a bordo: ' + JSON.stringify(aboard));
    b.stores.grenade = (aboard.grenade | 0) + 7;
    b.stores.electro_flare = 12;
    b.stores.hc_he = 6;
    const all = CU.leftAtBaseAll(G, c, pool, { night: true });
    const gr = all.find((x) => x.id === 'grenade');
    t.ok(gr && gr.n === b.stores.grenade && gr.ab === (aboard.grenade | 0), 'granadas com quantas vão a bordo: ' + JSON.stringify(all));
    const fl = all.findIndex((x) => x.id === 'electro_flare');
    t.ok(fl >= 0 && all[fl].n === 12, 'sinalizadores');
    const firstNonCapture = all.findIndex((x) => !(D.items[x.id].kind === 'melee' || D.items[x.id].dmg === 'STUN' || D.items[x.id].dmg === 'SMOKE'));
    t.eq(fl, firstNonCapture, 'de noite, logo a seguir ao material de captura');
    t.ok(all.some((x) => x.id === 'hc_he'), 'munição de uma arma que vai a bordo também conta');
    const day = CU.leftAtBaseAll(G, c, pool, { night: false });
    t.ok(day.findIndex((x) => x.id === 'electro_flare') > day.findIndex((x) => x.id === 'grenade'), 'de dia os sinalizadores não sobem');
    const txt = CU.leftText(G, c, pool, b, { night: true });
    t.ok(/12 × Sinalizador[^,]*\(\d+ a bordo\)|12 × Sinalizador/.test(txt), txt);
    t.eq(OV.T('cp.eq.leftAboard', { n: 12, name: 'Sinalizador', ab: 4 }), '12 × Sinalizador (4 a bordo)');
    // um tipo que já vai a bordo em quantidade não aparece (o armazém tem menos do que a nave leva)
    b.stores.grenade = 1;
    t.ok(!CU.leftAtBaseAll(G, c, pool, { night: true }).some((x) => x.id === 'grenade') || (aboard.grenade | 0) < pool.squad.length, 'granadas suficientes a bordo: sem aviso');
    t.ok(/leftAtBase\(G, craft, pool, \{ night: !!p\.night \}\)/.test(read('js/ui/campaign_ui.js')), 'o Equipar passa a noite');
  });

  // ---- #2 «Esperar pelo dia» com um OVNI que descola antes de amanhecer ----------------------------------------------
  t.test('r5 (Sofia): OVNI aterrado que descola antes do dia — «Atacar já» é o Enter, também em Recruta, e o texto di-lo', () => {
    const G = NEW(52, 0);
    G.month = 0;
    const { u, ref } = nightUfo(G, 2);
    const nt = M.nightAt(G, ref);
    t.ok(nt && nt.h > 2, 'noite longa: ' + JSON.stringify(nt));
    t.eq(nt.safe, false);
    t.eq(nt.leaves, true, 'nos meses de aprendizagem sabe-se que levanta voo');
    t.eq(M.waitIsDefault(G, ref, nt), false, 'Recruta: atacar já');
    u.groundLeftS = (nt.h + 2) * 3600;
    const nt2 = M.nightAt(G, ref);
    t.eq(nt2.safe, true);
    t.eq(M.waitIsDefault(G, ref, nt2), true, 'fica até amanhecer: esperar');
    G.month = OV.TUNE.NIGHT_LANDING_MONTHS;
    const nt3 = M.nightAt(G, ref);
    t.eq(nt3.leaves, false, 'depois dos meses de aprendizagem não se revela');
    t.eq(M.waitIsDefault(G, ref, nt3), false, 'e sem garantia não se recomenda esperar');
    t.ok(/levantar voo antes de amanhecer/.test(OV.T('geo.ev.arrived.night.leaves', { t: '9 h' })) && /perde a missão/.test(OV.T('geo.ev.arrived.night.leaves', { t: '9 h' })));
    t.ok(has('geo.ev.arrived.dusk.leaves') && has('cp.br.note.leaves'));
    t.ok(/notes\.push\(gmN && gmN\.leaves \? T\('cp\.br\.note\.leaves'\) : touchT\('cp\.br\.note\.waitDay'\)\)/.test(read('js/ui/campaign_ui.js')), 'o briefing não sugere esperar');
    t.ok(/const nightSuffix = \(nt\) => \(nt\.crashed \? '\.crash' : nt\.safe \? '\.safe' : nt\.leaves \? '\.leaves' : ''\);/.test(read('js/ui/geo_ui.js')));
    // destroços que duram continuam a recomendar esperar em Recruta
    const cr = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'crashed', lon: 0, lat: 10, crashLeftS: 60 * 3600, detected: true };
    G.ufos.push(cr);
    t.eq(M.waitIsDefault(G, { kind: 'ufo', id: cr.id }, { h: 5, crashed: true }), true);
  });

  // ---- #3 «Vender material» abria Comprar ----------------------------------------------------------------------------
  t.test('r5 (Sofia): «Vender material» abre o Mercado já em Vender', () => {
    const sc = OV.SceneDefs.basescape({ G: NEW(53, 0), tab: 'market', market: 'sell' });
    t.eq(sc.S.market, 'sell');
    t.eq(OV.SceneDefs.basescape({ G: NEW(53, 0), tab: 'market' }).S.market, 'buy', 'sem pedido: Comprar');
    const geo = read('js/ui/geo_ui.js'), bu = read('js/ui/base_ui.js');
    t.ok(/openBase\(o\.baseId, 'market', \{ market: 'sell' \}\)/.test(geo), 'o botão do aviso pede Vender');
    t.ok(/market: \(opts && opts\.market\) \|\| null/.test(bu) && /top\.go\(baseId, tab, opts\)/.test(bu) && /if \(opts && \(opts\.market === 'sell' \|\| opts\.market === 'buy'\)\) S\.market = opts\.market;/.test(bu), 'BaseUI.open passa o modo, também com a base já aberta');
  });

  // ---- #4 kit noturno / completar o kit ------------------------------------------------------------------------------
  t.test('r5 (Sofia): «Equipar para a noite» dá sinalizadores, espingardas livres a quem só tem pistola e o kit médico', () => {
    const G = NEW(54, 0);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    // plano sem mudar G: ninguém com sinalizador nem kit médico, 5 sinalizadores e um kit no armazém
    const ids = c.soldiers.slice();
    const save = ids.map((id) => JSON.stringify(C.findSoldier(G, id).loadout));
    for (const id of ids) {
      const lo = C.findSoldier(G, id).loadout;
      lo.belt = (lo.belt || []).filter((x) => x !== 'electro_flare' && x !== 'medikit');
      lo.pack = (lo.pack || []).filter((x) => x !== 'electro_flare' && x !== 'medikit');
    }
    b.stores.electro_flare = 5;
    b.stores.medikit = 1;
    const plan = CU.fieldKitPlan(G, c.id, { night: true });
    t.eq(plan.want, 3);
    t.eq(plan.carriers, 0);
    t.eq(plan.flares, 3, 'três sinalizadores');
    t.eq(plan.med, 1, 'o kit médico vai numa mochila');
    const flareLo = Object.keys(plan.loadouts).filter((id) => [].concat(plan.loadouts[id].belt, plan.loadouts[id].pack).indexOf('electro_flare') >= 0);
    t.eq(flareLo.length, 3);
    for (const id of Object.keys(plan.loadouts)) {
      const s = C.findSoldier(G, id), lo = plan.loadouts[id];
      const w = [lo.R, lo.L, ...lo.belt, ...lo.pack].filter(Boolean).reduce((a, x) => a + (D.items[x].weight | 0), 0);
      t.ok(w <= Math.max(1, s.stats.str | 0), 'dentro da Força: ' + id);
    }
    t.eq(CU.fieldKitPlan(G, c.id, { night: false }).flares, 0, 'de dia não há sinalizadores');
    ids.forEach((id, i) => { C.findSoldier(G, id).loadout = JSON.parse(save[i]); });
    // aplicado de verdade (Campaign.applyEquip): quem só tem pistola recebe uma espingarda livre
    const G2 = NEW(9, 0);
    const c2 = transportOf(G2);
    const before = CU.fieldKitPlan(G2, c2.id, { night: true });
    const r = CU.fieldKit(G2, c2.id, { night: true });
    t.ok(r.ok, JSON.stringify(r));
    t.eq(r.armed, before.armed);
    if (before.armed) t.ok(/espingarda/.test(CU.fieldKitText(r)), CU.fieldKitText(r));
    const after = CU.fieldKitPlan(G2, c2.id, { night: true });
    t.eq(after.armed + after.med + after.flares, 0, 'depois de aplicado nada falta');
    // nunca tira nada a ninguém: quem tinha kit médico continua com ele
    const meds = C.equipPool(G2, c2.id).squad.filter((s) => [].concat(s.loadout.belt || [], s.loadout.pack || []).indexOf('medikit') >= 0).length;
    t.ok(meds >= 1, 'há quem leve o kit médico');
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/w\.id === 'kit' && warns\.findIndex\(\(x\) => x\.id === 'kit'\) === i \? btn\(T\(M\.night \? 'cp\.br\.kit\.night' : 'cp\.br\.kit'\)/.test(cu), 'botão no aviso do briefing');
    t.ok(/kitBtn = kp && \(kp\.armed \|\| kp\.med \|\| kp\.flares\) \? btn\(/.test(cu) && /el\('div', \{ class: 'scr-foot-btns' \}, kitBtn, doneBtn\)/.test(cu), 'e no rodapé do Equipar (K)');
    for (const k of ['cp.br.kit', 'cp.br.kit.tip', 'cp.br.kit.night', 'cp.br.kit.night.tip', 'cp.br.warn.pistols.one', 'cp.br.warn.pistols.other', 'cp.br.warn.medAboard',
      'cp.br.warn.flaresAboard.one', 'cp.br.warn.flaresAboard.other', 'cp.br.warn.flaresAboard.none', 'cp.kit.armed.one', 'cp.kit.armed.other', 'cp.kit.med', 'cp.kit.flares.one', 'cp.kit.flares.other', 'cp.kit.none']) t.ok(has(k), k);
  });

  // ---- #5 transporte que perseguia o OVNI ----------------------------------------------------------------------------
  t.test('r5 (Sofia): transporte não persegue OVNIs no ar — regressa sozinho e «Alvo perdido» sugere regressar', () => {
    const G = NEW(55, 0);
    const sky = transportOf(G);
    t.eq(M.groundTransport(G, sky), true, 'Skyranger');
    const fighter = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => !D.crafts[c.type].transport);
    if (fighter) t.eq(M.groundTransport(G, fighter), false, 'intercetor');
    const src = read('js/ui/geo_ui.js');
    t.ok(/for \(const ev of evs\) if \(ev\.t === 'ufoLiftOff' \|\| ev\.t === 'landedUfoGone'\) transportsHome\(ev\.ufoId, ev\.recalled\);/.test(src), 'ao levantar voo');
    t.ok(/const r = W\(\)\.recall\(G, c\.id\);\s*if \(r && r\.ok\) addToast\(\{ t: 'transportHome'/.test(src), 'via World.recall');
    t.ok(/const home = groundTransport\(G, c\);/.test(src) && /buttons: home \? \[recallB,/.test(src), '«Regressar à base» primeiro');
    t.ok(/key: home \? 'Enter' : 'R', cls: home \? 'primary' : '', def: home/.test(src), 'e por omissão');
    t.eq(M.toastFor(G, 'transportHome', [{ craftId: sky.id, ufoId: 'u1' }]).kind, 'warn');
    t.ok(/regressa à base/.test(M.toastFor(G, 'transportHome', [{ craftId: sky.id, ufoId: 'u1' }]).text));
    t.ok(has('geo.ev.targetLost.transport') && has('geo.toast.transportHome.many'));
  });

  // ---- #6 próximos passos clicáveis ----------------------------------------------------------------------------------
  t.test('r5 (Sofia): cada «Próximo passo» é um botão com ação, dica e foco', () => {
    const src = read('js/ui/geo_ui.js');
    t.ok(/el\('li', \{ class: st\.done \? 'done' : '' \}, stepBtn\(st\)\)/.test(src));
    t.ok(/el\('button', \{ type: 'button', class: 'geo-step'/.test(src) && /OV\.Dom\.tooltip\(b, \(\) => tip\(TT\('geo\.steps\.' \+ st\.id \+ '\.tip'\), STEP_KEYS\[st\.id\]\)\)/.test(src));
    t.ok(/if \(id === 'research' && b\) openBase\(b\.id, 'research', \{ pick: true \}\);/.test(src) && /else if \(id === 'hire' && b\) openBase\(b\.id, 'personnel'\);/.test(src));
    for (const id of ['research', 'hire', 'speed', 'ufo']) t.ok(has('geo.steps.' + id + '.tip'), id);
    t.ok(has('geo.steps.ufo.hint') && has('geo.steps.done'));
    const css = read('css/geo.css');
    t.ok(/\.geo-step \{[^}]*cursor: pointer/.test(css) && /\.geo-step:focus-visible/.test(css) && /\.geo-step \{ min-height: 32px; \}/.test(css), 'cursor, foco e alvo de toque');
  });

  // ---- #7 soldados aptos que ficaram na base ------------------------------------------------------------------------
  t.test('r5 (Tiago): a nave de volta ao hangar (ou um soldado curado) embarca os aptos que ficaram na base', () => {
    const G = NEW(57, 0);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    const out = c.soldiers.slice(0, 3);
    for (const id of out) t.ok(OV.BaseSim.assignSoldier(G, id, null).ok !== false);
    t.eq(CU.idleFit(G, b.id).length >= 3, true);
    const r = CU.crewUp(G, c.id);
    t.ok(r.boarded >= 3, JSON.stringify(r));
    const src = read('js/ui/geo_ui.js');
    t.ok(/if \(ev\.t === 'craftReturned' && ev\.baseId\) boardAt\.add\(ev\.baseId\);/.test(src) && /if \(ev\.t === 'soldierRecovered'\)/.test(src), 'regresso e cura');
    t.ok(/function crewOnReturn\(baseId\) \{[\s\S]{0,700}const r = cu\.crewUp\(G, c\.id\);\s*if \(r\.boarded\) addToast\(\{ t: 'crewBoarded'/.test(src), 'crewUp e aviso');
    t.ok(/return box\('warn', Tn\('geo\.fix\.seats'/.test(src), 'lugares vazios com aptos na base: aviso, não informação');
    t.eq(M.toastFor(G, 'crewBoarded', [{ text: 'a' }, { text: 'b', warn: true }]).kind, 'warn');
  });

  // ---- #9 tipo do OVNI no cabeçalho da interceção -------------------------------------------------------------------
  t.test('r5 (Inês): o cabeçalho da interceção mostra o tipo quando o OVNI já está identificado', () => {
    const G = NEW(58, 1);
    const u = { id: C.nextId(G, 'u'), type: 'large_scout', status: 'flying', lon: 0, lat: 0, hyper: false };
    G.ufos.push(u);
    const DM = OV.DogfightUI.model;
    const name = OV.T(D.ufos.large_scout.nameKey);
    t.ok(DM.ufoLabel(G, u).indexOf(name) < 0, 'desconhecido: só o eco');
    G.ui = G.ui || {};
    G.ui.idUfos = [u.id];
    t.eq(M.typeKnown(G, u), true);
    const lbl = DM.ufoLabel(G, u);
    t.ok(lbl.indexOf(name) >= 0 && lbl.indexOf('(' + OV.T(D.ufos.large_scout.sizeKey).toLowerCase() + ')') >= 0, lbl);
  });

  // ---- #10 briefing de um OVNI aterrado danificado ------------------------------------------------------------------
  t.test('r5 (Inês): OVNI aterrado depois de levar dano — o briefing não diz «casco intacto»', () => {
    const G = NEW(59, 1);
    const u = { id: C.nextId(G, 'u'), type: 'large_scout', status: 'landed', lon: 0, lat: 0, dmg: 0 };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    t.eq(CU.landedHurt(G, ref), false);
    u.dmg = 118;
    t.eq(CU.landedHurt(G, ref), true);
    const txt = OV.T('cp.br.note.landedDamaged');
    t.ok(/danificado/.test(txt) && !/intacto/.test(txt) && /não facilita/.test(txt), txt);
    t.ok(/notes\.push\(T\(landedHurt\(G, siteRef\) \? 'cp\.br\.note\.landedDamaged' : 'cp\.br\.note\.landed'\)\)/.test(read('js/ui/campaign_ui.js')));
  });

  // ---- #11 botões segmentados sem estado acessível ------------------------------------------------------------------
  t.test('r5 (Pedro): botões segmentados da base (armadura, nave) dizem qual está escolhido (aria-pressed, grupo, ✓)', () => {
    const bu = read('js/ui/base_ui.js');
    t.ok(/if \(o\.pressed === undefined && \/\(\^\|\\s\)seg\(\\s\|\$\)\/\.test\(o\.cls \|\| ''\)\) o = Object\.assign\(\{\}, o, \{ pressed: \/\(\^\|\\s\)on\(\\s\|\$\)\/\.test\(o\.cls \|\| ''\) \}\);/.test(bu), 'todo o .seg leva aria-pressed');
    t.ok(/arm\.setAttribute\('role', 'group'\);\s*arm\.setAttribute\('aria-label', T\('base\.sol\.armour'\)\);/.test(bu));
    t.ok(/seat\.setAttribute\('role', 'group'\);\s*seat\.setAttribute\('aria-label', T\('base\.sol\.craft'\)\);/.test(bu));
    t.ok(/\.bsc \.btn\.seg\.on::before \{ content: '✓'/.test(read('css/basescape.css')), 'forma além da cor');
  });

  // ---- #12 avisos por cima dos separadores em retrato ---------------------------------------------------------------
  t.test('r5 (Marta): na base em retrato os avisos vão para baixo (não tapam os separadores)', () => {
    const css = read('css/basescape.css');
    t.ok(/@media \(max-width: 900px\), \(orientation: portrait\) and \(max-width: 1100px\) \{\s*body:has\(\.scr\.bsc:not\(\.scr-paused\):not\(\.scr-leaving\)\) #toasts \{ top: auto; bottom: calc\(18px \+ env\(safe-area-inset-bottom\)\); \}/.test(css));
  });

  // ---- #13 saúde e UT com o mesmo azul na paleta para daltonismo ----------------------------------------------------
  t.test('r5 (Pedro): paleta para daltonismo — saúde não usa o azul das UT', () => {
    const css = read('css/base.css');
    const cvd = css.match(/:root\[data-palette="cvd"\] \{([^}]*)\}/);
    t.ok(cvd, 'bloco cvd');
    const hp = (cvd[1].match(/--hp:\s*(#[0-9a-f]{6})/i) || [])[1];
    const tu = (css.match(/--tu:\s*(#[0-9a-f]{6})/i) || [])[1];
    t.ok(hp && tu, hp + ' ' + tu);
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [r1, g1, b1] = rgb(hp), [r2, g2, b2] = rgb(tu);
    t.ok(Math.abs(lum(hp) - lum(tu)) > 40 || Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 150, 'saúde distinguível das UT: ' + hp + ' / ' + tu);
  });
};
