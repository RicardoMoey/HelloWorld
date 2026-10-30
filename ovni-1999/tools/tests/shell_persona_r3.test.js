/* Ronda de personas 3 — correções do «shell» (estratégia, campanha, base): equipa pequena no «Enviar equipa» (pergunta
   com «Embarcar N e enviar» por omissão, aviso forte no briefing, aviso persistente de aptos fora da nave), «Esperar
   pelo dia» por omissão em Recruta, material novo que ficou na base, guarda de duplo clique em Contratar/Despedir/Iniciar,
   foco ao iniciar o 1.º projeto, texto do modo construção ao teclado, nomes acessíveis com contexto, plural do
   subtítulo, painel lateral baixo, mira logo no «Escolher no globo», Financiamento em retrato, textos do iPad,
   relatório mensal ao teclado, mapa novo em qualquer carga. Carrega os ficheiros de interface em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.leftAtBase) load('js/ui/campaign_ui.js');
  const M = OV.GeoUI.model, D = OV.Data, C = OV.Campaign, CU = OV.CampaignUI;
  const has = (k) => typeof OV.STR[k] === 'string';
  const NEW = (seed, difficulty) => C.newCampaign({ seed, difficulty, baseLonLat: { lon: -9.14, lat: 38.72 } });
  const transportOf = (G) => Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => D.crafts[c.type].transport);

  // ---- «Enviar equipa» com poucos soldados ---------------------------------------------------------------------
  t.test('geo: aptos na base mas fora da nave → aviso persistente «leva só N a bordo» com «Embarcar»', () => {
    const G = NEW(31, 0);
    const c = transportOf(G);
    t.ok(c && c.soldiers.length >= 6, 'a Skyranger começa com a equipa a bordo');
    t.eq(M.squadShort(G), null, 'equipa completa: sem aviso');
    for (const id of c.soldiers.slice(2)) OV.BaseSim.assignSoldier(G, id, null);
    t.eq(c.soldiers.length, 2, 'só 2 a bordo');
    const sh = M.squadShort(G);
    t.ok(sh && sh.craftId === c.id && sh.fit === 2 && sh.idle > 0, 'aviso com a nave e os aptos em terra: ' + JSON.stringify(sh));
    t.ok(/leva só 2 soldados a bordo: há mais \d+ aptos na base/.test(OV.Tn('geo.alert.aboard', 2, { craft: 'Skyranger-1', idle: 8 })));
    // com a nave fora do hangar não há aviso (não se pode embarcar)
    c.status = 'out';
    t.eq(M.squadShort(G), null, 'nave fora: sem aviso de embarque');
    const src = read('js/ui/geo_ui.js');
    t.ok(/dataset: \{ alert: 'aboard' \}/.test(src) && /CU\(\)\.crewUp\(G, sh\.craftId\)/.test(src), 'o aviso embarca com um clique');
  });
  t.test('geo: clique na nave com menos soldados do que o efetivo mínimo → pergunta, «Embarcar N e enviar» por omissão', () => {
    const src = read('js/ui/geo_ui.js');
    t.ok(/if \(!dry\) \{ if \(!shortConfirm\(c, pick\)\) pick\(\); return; \}/.test(src), 'a linha da nave passa pela pergunta');
    t.ok(/if \(!crew \|\| !fit \|\| fit >= \(crew\.min \| 0\)\) return false;/.test(src), 'só abaixo do mínimo estimado');
    t.ok(/label: T\('geo\.short\.board', \{ n \}\), value: 'board', kind: 'primary'/.test(src), '«Embarcar N e enviar» é o principal (Enter)');
    t.ok(/label: T\('geo\.short\.go'\), value: 'go', kind: 'danger'/.test(src), '«Enviar assim» é o perigoso');
    t.ok(/if \(v === 'board'\) \{\s*const r = cu\.crewUp\(G, c\.id\);/.test(src), 'embarcar e só depois enviar');
    for (const k of ['geo.short.title', 'geo.short.risk', 'geo.short.board', 'geo.short.go']) t.ok(has(k), k);
    t.eq(OV.T('geo.short.board', { n: 4 }), 'Embarcar 4 e enviar');
  });
  t.test('campanha: briefing com menos soldados do que o efetivo mínimo → aviso «bad» (não só «lugares vazios»)', () => {
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/if \(range && squad\.length && squad\.length < \(range\.min \| 0\)\) \{\s*out\.unshift\(\{ cls: 'bad', id: 'short'/.test(cu), 'AVISOS com estilo bad no topo');
    t.ok(/Só 2 soldados contra 3–4 alienígenas: é provável perder a missão e a nave/.test(OV.Tn('cp.br.warn.short', 2, { crew: OV.Screens.crewText({ min: 3, max: 4 }) })));
    t.ok(has('cp.br.warn.short.one'));
  });

  // ---- noite: esperar pelo dia por omissão --------------------------------------------------------------------
  t.test('geo: «Esperar pelo dia» é o Enter em Recruta e até à 1.ª missão noturna (salvo destroços que expiram)', () => {
    const G0 = NEW(32, 0), G1 = NEW(33, 1);
    const ufo = (G, status, crashLeftS) => {
      const u = { id: C.nextId(G, 'u'), type: 'small_scout', status, lon: 2, lat: 45, hyper: false, race: 'sectoid', missionId: null, crashLeftS: crashLeftS || 0, groundLeftS: 3600 };
      G.ufos.push(u);
      return { kind: 'ufo', id: u.id };
    };
    // ronda 5: num OVNI aterrado, esperar só é o Enter quando se sabe que fica no chão até amanhecer (nt.safe)
    const nt = { h: 5, crashed: false, safe: true }, ntRisk = { h: 5, crashed: false, safe: false };
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), nt), true, 'Recruta: esperar');
    t.eq(M.waitIsDefault(G1, ufo(G1, 'landed'), nt), true, 'Veterano, 1.ª noite: esperar');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), ntRisk), false, 'Recruta, OVNI que pode descolar: atacar');
    G1.ui.geo = Object.assign(G1.ui.geo || {}, { nightTried: true });
    t.eq(M.waitIsDefault(G1, ufo(G1, 'landed'), ntRisk), false, 'Veterano depois da 1.ª noite: atacar');
    G0.ui.geo = Object.assign(G0.ui.geo || {}, { nightTried: true });
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), nt), true, 'Recruta, seguro: esperar');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'crashed', 2 * 3600), { h: 5, crashed: true }), false, 'destroços acabam antes do dia: atacar');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'crashed', 40 * 3600), { h: 5, crashed: true }), true, 'destroços duram: esperar');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), null), false, 'de dia nada muda');
    // combustível: a nave no local tem de aguentar até ao amanhecer (senão regressa à base sem missão)
    const sky = transportOf(G0);
    Object.assign(sky, { status: 'patrol', lon: 30, lat: 50, speed: Math.round(D.crafts[sky.type].speed / 2), fuel: D.crafts[sky.type].fuel });
    t.ok(M.loiterHours(G0, sky) > 10, 'depósito cheio: ' + M.loiterHours(G0, sky).toFixed(1) + ' h');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), nt, sky), true, 'chega até de manhã: esperar');
    sky.fuel = 180;
    t.ok(M.loiterHours(G0, sky) < 5, 'pouco combustível: ' + M.loiterHours(G0, sky).toFixed(1) + ' h');
    t.eq(M.waitIsDefault(G0, ufo(G0, 'landed'), nt, sky), false, 'não chega até de manhã: atacar');
    t.ok(/regressa à base sem missão/.test(OV.T('geo.ev.arrived.night.fuel', { craft: 'S', t: '2 h' })));
    const src = read('js/ui/geo_ui.js');
    t.ok(/buttons: waitDef \? \[wait, go, recall\] : \[go, wait, recall\]/.test(src), 'esperar primeiro e por omissão');
    t.ok(/key: waitDef \? 'Enter' : 'W'/.test(src) && /def: waitDef/.test(src), 'Enter espera');
    t.ok(/if \(nt && !nt\.dusk\) markNight\(\); launchMission/.test(src), 'atacar de noite (não ao crepúsculo) marca a 1.ª missão noturna');
    t.ok(has('geo.ev.arrived.night.ask') && has('geo.a.attackNow'));
  });

  // ---- material que ficou na base ------------------------------------------------------------------------------
  t.test('campanha: equipar a bordo diz o que ficou no armazém; a entrega de armas oferece «Pôr na nave»', () => {
    const G = NEW(34, 0);
    const c = transportOf(G);
    const b = C.findBase(G, c.baseId);
    b.stores.rocket_launcher = 11;
    b.stores.small_rocket = 4;
    c.status = 'out'; // a nave está no local da missão: só vai o que leva a bordo
    let pool;
    try { pool = C.equipPool(G, c.id); } catch (e) { pool = null; }
    t.ok(pool, 'equipPool');
    const left = CU.leftAtBase(G, c, pool);
    // ronda 4 (tardia): o material de captura vem antes das armas; depois as armas, com a munição
    const capt = left.findIndex((x) => x.id === 'smoke_grenade' || x.id === 'stun_rod');
    const rl = left.findIndex((x) => x.id === 'rocket_launcher');
    t.ok(rl >= 0 && left[rl].n === 11 && (capt < 0 || capt < rl), 'captura e depois as armas: ' + JSON.stringify(left));
    t.ok(left.some((x) => x.id === 'small_rocket' && x.n === 4), 'com a munição');
    t.ok(left.length <= 4);
    t.ok(left.every((x) => D.items[x.id].kind !== 'corpse'), 'só material de combate');
    t.ok(/Ficaram em Lusitânia: 11 × Lança-Foguetes/.test(OV.T('cp.eq.leftAtBase', { base: 'Lusitânia', list: '11 × Lança-Foguetes' })));
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/const left = !home && craft \? leftAtBase\(G, craft, pool(, \{[^}]*\})?\) : \[\];/.test(cu), 'só fora da base');
    // aviso de entrega
    t.ok(M.GEAR_KINDS.firearm && !M.GEAR_KINDS.ammo && !M.GEAR_KINDS.corpse);
    c.status = 'ready';
    t.eq(M.homeTransport(G, b.id).id, c.id, 'transporte no hangar com equipa');
    c.status = 'out';
    t.eq(M.homeTransport(G, b.id), null, 'fora do hangar: sem botão');
    const src = read('js/ui/geo_ui.js');
    t.ok(/openBase\(tc\.baseId, 'crafts', \{ equip: tc\.id \}\)/.test(src), '«Pôr na nave» abre o equipamento');
    const bu = read('js/ui/base_ui.js');
    t.ok(/if \(P\.equip && C\(\)\.findCraft\(g, P\.equip\)\)/.test(bu) && /equip: \(opts && opts\.equip\) \|\| null/.test(bu), 'BaseUI.open(…, {equip})');
    t.eq(OV.T('geo.a.putAboard', { craft: 'Skyranger-1' }), 'Pôr na Skyranger-1');
  });

  // ---- base ------------------------------------------------------------------------------------------------------
  t.test('base: Contratar, Despedir, Iniciar (investigação e fabrico) e Interrogar com guarda de duplo clique', () => {
    const src = read('js/ui/base_ui.js');
    t.ok(/let lastOnceT = -1e9[^;]*;[\s\S]{0,600}?function oneShot\(e\)/.test(src), 'guarda ao nível do módulo');
    t.ok(/if \(o\.once && !oneShot\(e\)\) return;/.test(src), 'btn({once}) corta o 2.º clique');
    t.ok(/errText\(why\) : null, once: true,\s*on: \(\) => act\(\(\) => BS\(\)\.hire/.test(src), 'Contratar');
    t.ok(/errText\('busy'\) : null, once: true,\s*on: \(\) => act\(\(\) => BS\(\)\.sack/.test(src), 'Despedir');
    t.ok(/data: \{ start: id \}, once: true/.test(src), 'Iniciar investigação');
    t.ok(/q: String\(q\) \}, once: true/.test(src) && /q: '0' \}, once: true/.test(src), 'Iniciar fabrico');
    t.ok(/data: \{ interrogate: u \}, once: true/.test(src), 'Interrogar');
  });
  t.test('base: o foco fora do conteúdo sobrevive ao redesenho e a folha de projetos volta ao «Novo projeto»', () => {
    const src = read('js/ui/base_ui.js');
    t.ok(/!S\.r\.content\.contains\(a\) \? OV\.Dom\.focusKey\(a\) : null;/.test(src), 'refresh guarda a chave do foco (separador, cabeçalho)');
    t.ok(/if \(fk && \(!now \|\| now === document\.body \|\| !now\.isConnected\) && !OV\.Dom\.refocus\(fk, S\.root\)\)/.test(src), 'e devolve-o');
    t.ok(/returnTo && \(!cur \|\| cur === document\.body \|\| !S\.r\.content\.contains\(cur\)\)/.test(src), 'N num separador → volta ao «Novo projeto»');
  });
  t.test('base: modo construção ao teclado e dica dentro da janela; nomes com contexto; plural do subtítulo', () => {
    const src = read('js/ui/base_ui.js');
    t.ok(/!S\.hover && S\.kcur && !touchNow\(\) \? T\('base\.build\.validHere\.key'\)/.test(src), 'texto do teclado');
    t.ok(/Enter constrói/.test(OV.T('base.build.validHere.key')) && /Esc cancela/.test(OV.T('base.build.validHere.key')));
    t.ok(/if \(lx >= 4\) tip\.style\.left/.test(src) && /Math\.max\(4, Math\.min\(vw - w - 4/.test(src), 'a dica do fantasma nunca sai pela esquerda');
    for (const k of ['base.sci.plus1', 'base.sci.plus5', 'base.sci.all', 'base.sci.minus1', 'base.sci.minus5']) t.ok(src.indexOf("title: T('" + k + "'), aria: ar('" + k + "')") >= 0, k + ' com o nome do projeto');
    for (const k of ['base.eng.plus1', 'base.eng.all', 'base.prod.qtyPlus', 'base.prod.cancel']) t.ok(src.indexOf("title: T('" + k + "'), aria: ar('" + k + "')") >= 0, k + ' com o nome do fabrico');
    t.eq((src.match(/aria: T\('base\.tip\.articleFor', \{ name: articleTitle\(art\) \}\)/g) || []).length, 3, 'Ufopédia com o artigo');
    t.eq(OV.T('base.aria.ctx', { what: OV.T('base.sci.plus1'), name: 'Kit Médico' }), 'Atribuir mais 1 cientista — Kit Médico');
    t.eq(OV.Tn('base.research.sub', 1), '1 projeto disponível');
    t.eq(OV.Tn('base.research.sub', 3), '3 projetos disponíveis');
    t.ok(!has('base.research.sub'), 'sem a forma sem plural');
  });

  // ---- Geoscape ----------------------------------------------------------------------------------------------------
  t.test('geo: painel lateral baixo desloca-se; mira logo no «Escolher no globo»; Financiamento numa coluna em retrato', () => {
    const css = read('css/geo.css');
    t.ok(/\.geo-side \{ overflow-y: auto;/.test(css), 'o painel desloca-se');
    t.ok(/@media \(max-height: 640px\) \{\s*\.geo-lists \{ flex: none; min-height: 0; overflow: visible; \}/.test(css), 'abaixo de 640 px uma só deslocação');
    t.ok(/@media \(max-width: 900px\) \{ \.geo-fund-grid \{ grid-template-columns: 1fr; \}/.test(css), 'retrato: uma coluna');
    t.ok(/\.geo-fund-l \{ touch-action: pan-x pan-y;/.test(css), 'deslize lateral no iPad');
    const src = read('js/ui/geo_ui.js');
    t.ok(/side\.addEventListener\('focusin'/.test(src) && /scrollIntoView\(\{ block: 'nearest' \}\)/.test(src), 'o foco do teclado fica à vista');
    t.ok(/S\.kbdAim = !!byKey && !touchNow\(\);/.test(src), 'a mira aparece ao entrar pelo teclado');
    t.ok(/startTargetMode\(S\.dlg\.st\.craftId, true\)/.test(src) && /startTargetMode\(st\.craftId, !e \|\| e\.detail === 0\)/.test(src), 'G e Enter no botão');
    t.ok(/showBanner\(name, msg, !r\.ok \? 'bad' : r\.warn \? 'warn' : 'ok', null, tmKeys\(\)\)/.test(src), 'a linha Enter/Esc fica por baixo');
    for (const k of ['geo.tm.keys', 'geo.tm.keys.mouse', 'geo.tm.keys.touch']) t.ok(has(k), k);
    t.eq(M.textKeys().filter((k) => !has(k)), [], 'textKeys do Geoscape com texto');
  });
  t.test('iPad: textos sem teclas na interceção, no aviso de interceção aberta e nos sinalizadores', () => {
    const keyRe = /\b[QELM]\b|\([0-9]\)|\b[2-5] (Cauteloso|Agressivo|Desengatar)|\(2–4\)|Q\/E|tecla/;
    for (const k of ['df.hint.modes', 'df.hint.small', 'df.hint.scrambleBig', 'df.st.standoff', 'geo.dfBanner.text', 'geo.ev.team.eta.night.flares.touch.one', 'geo.ev.team.eta.night.flares.touch.other', 'geo.idle.toast', 'cp.resume.geo', 'base.research.hint.finalMission']) {
      const tk = /\.touch\./.test(k) ? k : k + '.touch';
      t.ok(has(tk), tk);
      t.ok(!keyRe.test(OV.STR[tk].replace(/\{[a-z]+\}/g, '')), tk + ' sem teclas: ' + OV.STR[tk]);
    }
    const df = read('js/ui/dogfight_ui.js');
    t.ok(/hintLines\.push\(TT\('df\.hint\.modes'\)\)/.test(df) && /const mainTxt = TT\(mainKey/.test(df), 'a interceção escolhe a variante do toque');
    const geo = read('js/ui/geo_ui.js');
    t.ok(/TT\('geo\.dfBanner\.text'\)/.test(geo) && /'geo\.ev\.team\.eta\.night\.flares\.touch'/.test(geo), 'Geoscape também');
    const css = read('css/campaign.css');
    t.ok(/@media \(hover: none\) \{ \.cp-diff-n \{ display: none; \} \}/.test(css), 'sem selos 1/2/3 na dificuldade');
  });
  t.test('campanha: toque duplo no mar só centra (um aviso, nunca dois); toque longo centra como no Geoscape', () => {
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/if \(\(ev\.detail \| 0\) < 2\) st\.seaT = setTimeout/.test(cu), 'o aviso do mar espera pelo 2.º toque');
    t.ok(/if \(ev\.kind === 'dblclick' \|\| ev\.kind === 'secondary'\) \{\s*clearTimeout\(st\.seaT\);/.test(cu), 'o duplo toque cancela o aviso');
    t.ok(/Toque longo: centrar/.test(OV.STR['cp.ng.gestures.touch']) && /toque longo centra/.test(OV.STR['geo.hint.touch']), 'o mesmo gesto ensinado nos dois ecrãs');
    const dom = read('js/ui/dom.js');
    t.ok(/const same = kind === 'good' \? null : \[\.\.\.box\.children\]\.find/.test(dom) && /if \(same\) \{ arm\(same\); return; \}/.test(dom), 'o mesmo aviso à vista não se repete');
  });
  t.test('campanha: relatório mensal desloca-se ao teclado (setas, PageDown, Fim) e recebe o Tab', () => {
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/ui\.scrollKeys\(ev, sc\.root\.querySelector\('\.cp-mr-body'\)\)/.test(cu), 'scrollKeys no relatório mensal');
    t.ok(/class: 'cp-mr-body scr-scroll', tabindex: '0', role: 'region'/.test(cu), 'tabindex 0');
    t.ok(/\.cp-mr-body:focus-visible \{ outline: 2px solid/.test(read('css/campaign.css')), 'foco visível');
    t.ok(has('cp.mr.body.aria'));
  });
  t.test('campanha: carregar qualquer gravação no Geoscape sorteia outro mapa (determinístico pelo n.º da carga)', () => {
    const G = NEW(35, 1);
    const m0 = G.rng.map;
    const n1 = CU.reseedOnLoad(G);
    const m1 = G.rng.map;
    const n2 = CU.reseedOnLoad(G);
    t.ok(n2 === n1 + 1, 'o contador avança: ' + n1 + ' → ' + n2);
    t.ok(m1 !== m0 && G.rng.map !== m1, 'cada carga muda a stream do mapa');
    const H = NEW(35, 1);
    C.reseedMap(H, 0x10000 + n1);
    t.eq(H.rng.map, m1, 'mesmo estado + mesma carga ⇒ mesmo mapa');
    const G2 = NEW(35, 1);
    t.eq(G2.rng.geo, G.rng.geo, 'as outras streams não mudam');
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/reseedOnLoad\(G\);\s*openGeo\(G\);/.test(cu), 'resume() (menu Continuar e Carregar) aplica o sal');
  });
};
