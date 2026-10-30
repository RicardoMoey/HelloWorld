/* Ronda de personas 4 — correções do «shell» (estratégia, campanha, base): clique fantasma de um duplo clique num ecrã
   novo, aviso de material necessário para investigar ao vender, obras em curso por baixo da lista de construção, bases
   alienígenas distinguíveis (raça/número, «outra base»), chave de foco única (sem data-lp genérico), Enter do teclado
   nunca travado pela guarda de duplo clique, Mercado com uma paragem do Tab por linha, base em retrato com o separador
   a ocupar a altura, «Esperar pelo dia» que acelera o tempo, noite sem a pergunta repetida, décimas em pt-PT no
   relatório, local da base recentrado ao rodar o iPad. Carrega os ficheiros de interface em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Dom || !OV.Dom.ghostClick) load('js/ui/dom.js');
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI || !OV.GeoUI.model.alienBaseName) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.fmtDec1) load('js/ui/campaign_ui.js');
  if (!OV.BaseUI || !OV.BaseUI.lostTopics) load('js/ui/base_ui.js');
  const M = OV.GeoUI.model, D = OV.Data, C = OV.Campaign;
  const has = (k) => typeof OV.STR[k] === 'string';
  const NEW = (seed, difficulty) => C.newCampaign({ seed, difficulty, baseLonLat: { lon: -9.14, lat: 38.72 } });

  // ---- #0 duplo clique em «Repetir a missão» cai em «Equipar» do briefing -------------------------------------------
  t.test('dom: ghostClick ignora o 2.º clique de um duplo clique num botão acabado de nascer, nunca o teclado', () => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    t.eq(OV.Dom.ghostClick({ detail: 2 }, now - 50), true, '2.º clique 50 ms depois de o botão aparecer');
    t.eq(OV.Dom.ghostClick({ detail: 1 }, now - 50), false, 'clique simples');
    t.eq(OV.Dom.ghostClick({ detail: 0 }, now - 50), false, 'Enter/Espaço (detail 0)');
    t.eq(OV.Dom.ghostClick({ detail: 2 }, now - 5000), false, 'duplo clique num botão antigo segue o caminho normal');
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/const born = [^;]+;\s*b\.addEventListener\('click', \(e\) => \{\s*if \(b\.disabled\) return;\s*if \(OV\.Dom\.ghostClick && OV\.Dom\.ghostClick\(e, born\)\) return;/.test(cu),
      'todos os botões da campanha (briefing: Cancelar, Equipar, Esperar) têm a guarda');
  });

  // ---- #1 vender o último cadáver/arma de que a investigação precisa -----------------------------------------------
  t.test('base: lostTopics diz que tópicos se perdem ao vender o último exemplar; a venda pede confirmação', () => {
    const G = NEW(7, 1);
    const b = G.bases[0];
    b.stores.sectoid_corpse = 2;
    t.ok(C.availableResearch(G, b.id).indexOf('autopsy_sectoid') >= 0, 'a autópsia está disponível com cadáveres');
    t.eq(OV.BaseUI.lostTopics(G, b, 'sectoid_corpse', 1), [], 'vender 1 de 2: nada se perde');
    t.eq(OV.BaseUI.lostTopics(G, b, 'sectoid_corpse', 2), ['autopsy_sectoid'], 'vender os 2: perde-se a autópsia');
    t.eq(b.stores.sectoid_corpse, 2, 'só lê G');
    // a meio da investigação o item já não é preciso
    G.researched.push('autopsy_sectoid');
    t.eq(OV.BaseUI.lostTopics(G, b, 'sectoid_corpse', 2), [], 'já investigado: vende-se à vontade');
    const bu = read('js/ui/base_ui.js');
    t.ok(/const need = why \? \[\] : lostTopics\(g, b, id, have\);/.test(bu) && /class: 'bsc-row-need'/.test(bu), 'a linha mostra «Necessário para investigar»');
    t.ok(/on: \(e\) => \{ if \(!oneShot\(e\)\) return; sellNow\(id, n\); \}/.test(bu) && /const lost = lostTopics\(g, b, id, n\);\s*if \(lost\.length\) \{/.test(bu), 'Vender (e «Tudo») passa pela confirmação');
    t.ok(/label: T\('base\.market\.sellLast\.keep'\), value: false, kind: 'primary'/.test(bu), '«Guardar» é o botão por omissão');
    t.eq(OV.Tn('base.market.needFor', 1, { topics: 'Autópsia: Sectoide' }), 'Necessário para investigar: Autópsia: Sectoide');
    for (const k of ['base.market.sellLast.title', 'base.market.sellLast.body.one', 'base.market.sellLast.body.other', 'base.market.sellLast.keep', 'base.market.sellLast.ok']) t.ok(has(k), k);
  });

  // ---- #2 «Em construção» empurrava a lista de construção ---------------------------------------------------------
  t.test('base: as obras em curso ficam por baixo da lista de construção (a lista não muda de sítio)', () => {
    const bu = read('js/ui/base_ui.js');
    const i = bu.indexOf('function tabFacilities()');
    const body = bu.slice(i, bu.indexOf('// ---- construção e desmantelamento', i));
    const list = body.indexOf("section(T('base.build.title')"), under = body.indexOf("section(T('base.fac.underway')");
    t.ok(list > 0 && under > list, 'secção «Em construção» depois da lista');
  });

  // ---- #3 duas bases alienígenas iguais na lista LOCAIS ---------------------------------------------------------
  t.test('geo: bases alienígenas com raça no nome e na lista, número quando iguais, «outra base» no alerta', () => {
    const G = NEW(9, 1);
    const a1 = { id: 'a1', lon: 5.8, lat: 5.5, race: 'floater', region: 'africa', discovered: true };
    const a2 = { id: 'a2', lon: 6.8, lat: 5.6, race: 'muton', region: 'africa', discovered: true };
    G.alienBases.push(a1, a2);
    const n1 = M.alienBaseName(G, a1), n2 = M.alienBaseName(G, a2);
    t.ok(n1 !== n2, n1 + ' ≠ ' + n2);
    t.ok(/Flutuantes/.test(n1) && /Mutons/.test(n2), 'raça no plural');
    t.eq(M.targetName(G, { kind: 'alienBase', id: 'a2' }), n2, 'targetName usa o mesmo nome');
    t.eq(M.alienBaseOther(G, a2), M.placeName(a1.lon, a1.lat) === M.placeName(a2.lon, a2.lat), '«outra» quando já há uma no mesmo sítio');
    // duas da mesma raça no mesmo sítio: número
    a1.race = 'muton';
    t.ok(M.alienBaseTwin(G, a1) === (M.placeName(a1.lon, a1.lat) === M.placeName(a2.lon, a2.lat)));
    if (M.alienBaseTwin(G, a1)) t.ok(/Base alienígena 1 /.test(M.alienBaseName(G, a1)) && /Base alienígena 2 /.test(M.alienBaseName(G, a2)));
    const src = read('js/ui/geo_ui.js');
    t.ok(/alienBaseTwin\(G, a\) \? T\('geo\.alienBase\.shortNum'/.test(src) && /' · ' \+ racePl\(a\.race\)/.test(src), 'linha LOCAIS com raça e número');
    t.ok(/\(alienBaseOther\(G, a\) \? '\.another' : ''\)/.test(src), 'alerta «outra base alienígena»');
    for (const r of ['patrol', 'agents', 'supply']) t.ok(/outra base alienígena/.test(OV.T('geo.ev.alienBaseFound.' + r + '.another', { place: 'Nigéria', race: 'Mutons' })), r);
    for (const k of ['geo.alienBase.nameRace', 'geo.alienBase.nameNum', 'geo.alienBase.shortNum']) t.ok(M.textKeys().indexOf(k) >= 0 && has(k), k);
  });

  // ---- #4 foco salta para «Novo projeto» ---------------------------------------------------------------------------
  t.test('dom: o toque longo não marca os botões com data-lp; focusKey só devolve chaves únicas (ou texto + ordem)', () => {
    const src = read('js/ui/dom.js');
    t.ok(!/dataset\.lp/.test(src), 'sem data-lp no DOM');
    t.ok(/const lpDone = typeof WeakSet/.test(src), 'WeakSet para os nós com toque longo');
    t.ok(/for \(const c of cands\) if \(unique\(c\)\) return c;/.test(src), 'só chaves que apanham um nó');
    t.ok(/return i < 0 \? null : 'T' \+ SEP \+ base \+ SEP \+ txt \+ SEP \+ i;/.test(src), 'último recurso: texto + ordem');
    t.ok(/if \(key\.charAt\(0\) === 'T' && key\.charAt\(1\) === SEP\)/.test(src), 'refocus entende a chave de texto');
  });

  // ---- #5 Enter do teclado travado pelo oneShot ------------------------------------------------------------------
  t.test('base: oneShot aceita cada Enter/Espaço novo (detail 0); só trava cliques e a repetição automática', () => {
    const bu = read('js/ui/base_ui.js');
    t.ok(/if \(e && \(e\.detail \| 0\) === 0 && e\.isTrusted !== false\) \{\s*if \(keyRepeat\) return false;\s*lastOnceT = t;\s*return true;\s*\}/.test(bu), 'teclado não passa pela janela de 400 ms');
    t.ok(/if \(\(e && e\.detail > 1\) \|\| t - lastOnceT < 400\) return false;/.test(bu), 'o duplo clique do rato continua travado');
  });

  // ---- #6 Mercado ao teclado ---------------------------------------------------------------------------------------
  t.test('base: Mercado com uma paragem do Tab por linha, setas e aria-pressed em Comprar/Vender', () => {
    const bu = read('js/ui/base_ui.js');
    t.ok(/if \(o\.why \|\| o\.noTab\) \{ if \(o\.why\) b\.classList\.add\('disabled'\); b\.tabIndex = -1; \}/.test(bu), 'btn({noTab})');
    t.eq((bu.match(/noTab: true/g) || []).length, 4, '−, +, +10 e «Tudo» fora do Tab');
    t.ok(/'aria-pressed': o\.pressed === undefined \? null/.test(bu) && /pressed: S\.market === 'buy'/.test(bu) && /pressed: S\.market === 'sell'/.test(bu), 'aria-pressed');
    t.ok(/if \(S\.tab === 'market' && marketKey\(k, m\)\) return true;\s*if \(ev\.repeat\) return false;/.test(bu), 'setas mantidas premidas repetem');
    for (const k of ['ArrowUp', 'PageDown', 'ArrowLeft', 'Home', 'End']) t.ok(bu.indexOf("k === '" + k + "'") > 0, k);
    for (const k of ['base.market.kbdHint.buy', 'base.market.kbdHint.sell', 'base.market.rowKeys']) t.ok(has(k), k);
  });

  // ---- #7 base em retrato --------------------------------------------------------------------------------------
  t.test('base: em retrato, fora das Instalações a grelha encolhe e a ficha do soldado entra à vista', () => {
    const css = read('css/basescape.css');
    t.ok(/\.bsc-body:not\(\[data-tab="facilities"\]\) \{ grid-template-rows: minmax\(150px, 22%\) minmax\(0, 1fr\); \}/.test(css), 'grelha pequena');
    t.ok(/\.bsc-body:not\(\[data-tab="facilities"\]\) \.bsc-info \{ display: none; \}/.test(css), 'sem a ficha da instalação');
    const bu = read('js/ui/base_ui.js');
    t.ok(/r\.body\.dataset\.tab = S\.tab;/.test(bu), 'data-tab no corpo');
    t.ok(/S\.solSel = s\.id; S\.focusSol = true; S\.revealSol = true;/.test(bu) && /if \(S\.revealSol\) \{ S\.revealSol = false; revealDetail\(\); \}/.test(bu), 'toque num soldado revela a ficha');
  });

  // ---- #8 «Esperar pelo dia» a 5 seg ----------------------------------------------------------------------------
  t.test('geo: «Esperar pelo dia» acelera o tempo (≥ 30 min), também vindo do briefing', () => {
    t.eq(M.waitSpeed(5), 3, '30 min');
    t.eq(M.waitSpeed(9), 4, '1 hora para mais de 6 h');
    t.eq(OV.T('geo.speed.3'), '30 min');
    const src = read('js/ui/geo_ui.js');
    t.ok(/const sp = Math\.max\(clk\.speed, waitSpeed\(nt\.h\)\);\s*setSpeed\(sp\);/.test(src), 'janela «Equipa no local»');
    t.ok(/if \(wd\.length\) \{ for \(const w of wd\) w\.sped = true; setSpeed\(Math\.max\(clk\.speed, waitSpeed\(0\)\)\); \}/.test(src), 'regresso do briefing');
    t.ok(/o tempo passa a «30 min»/.test(OV.T('geo.toast.waitDay.fast', { s: '30 min', t: '5 h' })));
  });

  // ---- #9 a mesma pergunta duas vezes de noite --------------------------------------------------------------------
  t.test('geo: com a pergunta curta por cima, a linha do porquê não repete «Esperar pelo dia»', () => {
    for (const ph of ['night', 'dusk']) for (const v of [{}, { safe: true }, { crashed: true }]) {
      const k = M.nightLineKey(ph, v, true);
      t.ok(k && has(k), ph + JSON.stringify(v) + ' → ' + k);
      t.ok(!/Esperar pelo dia/.test(OV.T(k, { t: '5 h', d: 20 })), k + ' sem a pergunta');
      t.eq(M.nightLineKey(ph, v, false), null, 'sem a pergunta: o parágrafo completo');
      t.ok(M.textKeys().indexOf(k) >= 0, k + ' na lista de chaves');
    }
    t.ok(/fica no chão até amanhecer/.test(OV.T('geo.ev.arrived.night.safe.short')), 'a garantia dos primeiros meses fica');
  });

  // ---- #10 decimal inglês no relatório ---------------------------------------------------------------------------
  t.test('campanha: armazém sobrelotado com décimas em pt-PT', () => {
    t.eq(OV.CampaignUI.fmtDec1(51.2), '51,2');
    t.eq(OV.CampaignUI.fmtDec1(50), '50');
    t.eq(OV.CampaignUI.fmtDec1(41.66), '41,7');
    t.ok(/T\('cp\.db\.storageOver', \{ used: fmtDec1\(model\.storage\.used\), cap: fmtDec1\(model\.storage\.cap\) \}\)/.test(read('js/ui/campaign_ui.js')));
    t.ok(/51,2\/50/.test(OV.T('cp.db.storageOver', { used: OV.CampaignUI.fmtDec1(51.2), cap: '50' })));
  });

  // ---- #11 rodar o iPad no «Local da primeira base» ---------------------------------------------------------------
  t.test('campanha: ao mudar as dimensões da janela, o local escolhido volta ao centro à vista', () => {
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/const wh = view\.w \+ 'x' \+ view\.h;\s*if \(lastWH && wh !== lastWH\) \{ recentre = true; layoutDirty = true; \}/.test(cu), 'dimensões novas marcam o recentrar');
    t.ok(/if \(recentre\) \{ recentre = false; GR\.rotateTo\(view, st\.chosen\.lon, st\.chosen\.lat, 260\); \}/.test(cu), 'depois de recalcular o centro livre');
  });
};
