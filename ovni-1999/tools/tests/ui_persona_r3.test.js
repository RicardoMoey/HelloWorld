/* Ronda 3 de personas — Battlescape, kit médico e «Equipar» (battle_ui.js, presenter.js, inventory_ui.js,
   battle_render.js, battle.css, pt-PT.hud.js, pt-PT.battle.js): o carregador «na arma» não ocupa o cinto do
   «Equipar» (o cinto do ecrã é o do combate), avisos com ⇧1, «ferido e a sangrar» em vez de «mortalmente», X aborta,
   pânico no relatório do turno, teclado do kit médico como o painel se vê, dica do teclado que some, etiquetas do
   alvo longe do atirador, «Equipar» em janelas baixas e no retrato, «Toque de novo para lançar».
   O comportamento no navegador está em qa/persona_r3_battle.mjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.BattleUI) load('js/ui/battle_ui.js');
  if (!OV.InventoryUI) load('js/ui/inventory_ui.js');
  if (!OV.Presenter) load('js/ui/presenter.js');
  const IM = OV.InventoryUI.model;
  const BM = OV.BattleUI.model;
  const S = OV.STR;
  const has = (k) => typeof S[k] === 'string' && S[k].length > 0;
  const stats = { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 40, melee: 30, psiStr: 30, psiSkill: 0 };
  // o que o motor faz no início da missão com este equipamento
  function battleOf(lo) {
    const B = { map: OV.BMap.create(6, 6, 1), units: [], items: [], nextId: 1, turn: 1, side: 'xcom', pendingBerserk: [], mission: { kind: 'crash', difficulty: 0 }, rng: OV.RNG.streams(3) };
    OV.Battle.rebuildDerived(B);
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'x', name: 'X', nat: 'pt', rank: 0, armour: 'coveralls', stats }, lo);
    const types = (s) => OV.BUnits.item(B, u, s).map((it) => it.type);
    const w = (h) => { const it = OV.BUnits.findItem(B, u.items[h]); return it ? it.type + (it.ammo ? '+' + it.ammo.type : '') : null; };
    return { R: w('R'), L: w('L'), belt: types('belt'), pack: types('pack') };
  }
  // o mesmo, visto no «Equipar»
  function screenOf(lo) {
    const p = IM.loadPlan(lo);
    const w = (h) => (lo[h] ? lo[h] + (p[h] ? '+' + p[h].type : '') : null);
    return { R: w('R'), L: w('L'), belt: IM.visibleIn(lo, 'belt'), pack: IM.visibleIn(lo, 'pack') };
  }
  const sorted = (a) => a.slice().sort();

  t.test('persona r3: o carregador «na arma» não ocupa o cinto do «Equipar» (arma carregada + 2 carregadores + granada + fumo)', () => {
    let lo = { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'rifle_clip', 'grenade'], pack: [] };
    t.eq(IM.visibleIn(lo, 'belt'), ['rifle_clip', 'rifle_clip', 'grenade'], 'cinto à vista: 3 de 4');
    t.eq(IM.inWeapon(lo).belt.has(0), true, 'o 1.º carregador está na arma');
    const r = IM.eqMove(lo, 'stores', -1, 'smoke_grenade', 'belt');
    t.ok(r.ok, 'a granada de fumo cabe no cinto (antes: «Não cabe aí»)');
    t.eq(IM.visibleIn(r.lo, 'belt').length, 4, 'cinto 4/4 com a arma carregada');
    t.eq(IM.eqMove(r.lo, 'stores', -1, 'grenade', 'belt').ok, false, 'um 5.º objeto já não cabe');
    // a arma volta ao armazém com o carregador que tinha dentro
    const back = IM.eqMove(r.lo, 'R', 0, 'rifle', 'stores');
    t.ok(back.ok && sorted(back.back).join() === 'rifle,rifle_clip', 'arma + carregador para o armazém: ' + back.back);
    t.eq(IM.visibleIn(back.lo, 'belt').length, 4, 'o cinto fica como estava');
    // arma para a mochila: o carregador que deixa de estar na arma fica se couber, senão volta ao armazém
    lo = { R: 'pistol', L: null, belt: ['pistol_clip', 'grenade', 'grenade', 'smoke_grenade', 'electro_flare'], pack: [] };
    t.eq(IM.visibleIn(lo, 'belt').length, 4);
    const mv = IM.eqMove(lo, 'R', 0, 'pistol', 'pack');
    t.ok(mv.ok && mv.back.join() === 'pistol_clip' && mv.lo.pack.join() === 'pistol', 'pistola para a mochila; o carregador não cabe no cinto → armazém');
    // munição largada numa arma vazia carrega-a sem pedir espaço
    lo = { R: 'rifle', L: null, belt: ['grenade', 'grenade', 'smoke_grenade', 'electro_flare'], pack: [] };
    const ld = IM.eqMove(lo, 'stores', -1, 'rifle_clip', 'R');
    t.ok(ld.ok && ld.label === 'load' && IM.loadPlan(ld.lo).R && IM.visibleIn(ld.lo, 'belt').length === 4, 'carregar uma arma com o cinto cheio');
    const sp = IM.eqMove(ld.lo, 'stores', -1, 'rifle_clip', 'R');
    t.ok(sp.ok && sp.label === 'spare' && sp.lo.pack.indexOf('rifle_clip') >= 0, 'o seguinte é de reserva e vai para a mochila (cinto cheio)');
    t.eq(IM.eqMove(lo, 'stores', -1, 'pistol_clip', 'R').reason, 'occupied', 'munição de outra arma: recusa');
  });

  t.test('persona r3: o cinto do «Equipar» é o cinto do combate (OV.BUnits.fromSoldier + autoLoad)', () => {
    const cases = [
      { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade'], pack: ['electro_flare'] },
      { R: 'rifle', L: null, belt: ['grenade', 'grenade', 'smoke_grenade', 'electro_flare', 'rifle_clip'], pack: [] },
      { R: 'rifle', L: 'pistol', belt: ['grenade', 'smoke_grenade', 'electro_flare', 'grenade', 'rifle_clip', 'pistol_clip'], pack: ['medikit'] },
      { R: 'heavy_cannon', L: null, belt: ['grenade', 'smoke_grenade'], pack: ['hc_ap', 'hc_he'] },
      { R: 'heavy_cannon', L: null, belt: ['grenade', 'smoke_grenade', 'hc_he'], pack: ['hc_ap'] },
    ];
    for (const lo0 of cases) {
      // o ecrã guarda pela ordem de settleOrder (o carregador «na arma» que é o único do cinto vai para o fim)
      const lo = IM.settleOrder(JSON.parse(JSON.stringify(lo0)));
      t.eq(battleOf(lo), screenOf(lo), JSON.stringify(lo0));
    }
    // o Auto-equipar não gasta uma casa do cinto com o carregador da arma
    const st = { rifle: 2, rifle_clip: 6, grenade: 4, electro_flare: 2 };
    const auto = IM.autoLoadout({ id: 1, stats: { str: 40, hp: 30 } }, st, { night: true, researched: null, squad: [{ id: 1, stats: { str: 40, hp: 30 } }] });
    const v = IM.visibleIn(auto, 'belt');
    t.ok(auto.R === 'rifle' && IM.loadPlan(auto).R, 'arma carregada');
    t.ok(v.length === 4 && v.indexOf('rifle_clip') >= 0 && v.filter((x) => x === 'grenade').length === 2 && v.indexOf('electro_flare') >= 0, 'cinto: reserva, 2 granadas e sinalizador ' + JSON.stringify(auto));
    sameKit(auto, 'auto-equipar no combate');
  });

  /* cinto cheio com um carregador de reserva compatível e a arma carregada (o cinto clássico): o motor só o reproduz
     com o patch de OV.BUnits.fromSoldier (carregar as armas antes de encher o cinto — ver open_issues da ronda 3).
     Sem ele, o soldado leva o mesmo (armas carregadas, mesmos objetos) mas até um objeto por arma passa do cinto
     para a mochila. */
  const PRELOAD = battleOf({ R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade', 'grenade', 'electro_flare'], pack: [] }).belt.length === 4;
  function sameKit(lo, msg) {
    const b = battleOf(lo), s = screenOf(lo);
    if (PRELOAD) {
      t.eq(b, s, msg + ' (motor com pré-carga)');
      return;
    }
    t.eq([b.R, b.L], [s.R, s.L], msg + ': armas carregadas como no ecrã');
    t.eq(sorted(b.belt.concat(b.pack)), sorted(s.belt.concat(s.pack)), msg + ': mesmos objetos no cinto e na mochila');
    const hands = [s.R, s.L].filter((x) => x && x.indexOf('+') > 0).length;
    t.ok(b.belt.length >= s.belt.length - hands, msg + ': no máximo um objeto do cinto por arma carregada vai para a mochila');
  }

  t.test('persona r3: cinto cheio + carregador de reserva + arma carregada — nada se perde no combate', () => {
    const lo = { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade', 'smoke_grenade', 'electro_flare'], pack: [] };
    t.eq(IM.visibleIn(lo, 'belt').length, 4, 'o ecrã mostra 4/4');
    sameKit(lo, 'cinto clássico');
    sameKit({ R: 'rifle', L: 'pistol', belt: ['pistol_clip', 'rifle_clip', 'rifle_clip', 'grenade', 'grenade', 'smoke_grenade'], pack: ['medikit'] }, 'duas armas');
  });

  t.test('persona r3: textos — ⇧1 nos avisos de reserva, «ferido e a sangrar», lançar, abortar e kit médico', () => {
    for (const k of ['hud.stop.reserved', 'hud.path.reserve.fix', 'hud.path.reserve.deny']) t.ok(/⇧1/.test(S[k]) && S[k].indexOf('⇧1') < S[k].indexOf('F1'), k + ': ⇧1 antes de F1');
    t.ok(/^⇧1–⇧4 \(F1–F4\)/.test(S['hud.keys.14']), 'folha de teclas: ⇧1 primeiro');
    for (const k of ['bs.ev.wounded', 'bs.ev.wounded.f', 'hud.log.hitWound', 'hud.log.hitWound.f']) t.ok(!/mortalmente/.test(S[k]) && /sangra/.test(S[k]), k + ': ' + S[k]);
    t.ok(/kit médico/.test(S['bs.ev.woundedGrave']) && /\{n\}/.test(S['bs.ev.woundedGrave']) && /próximo turno/.test(S['bs.ev.woundedNext.f']), 'grave só com prazo');
    const P = OV.Presenter;
    t.eq(P.woundTurns({ hp: 26, wounds: [0, 2, 0, 0, 0, 0] }), 13, '−2 de saúde: 13 turnos — não é «grave»');
    t.eq(P.woundTurns({ hp: 5, wounds: [1, 1, 0, 0, 0, 1] }), 2, 'grave');
    t.eq(P.woundTurns({ hp: 3, wounds: [0, 0, 3, 0, 0, 0] }), 1, 'próximo turno');
    t.eq(P.woundTurns({ hp: 30, wounds: [0, 0, 0, 0, 0, 0] }), 0, 'sem feridas');
    const pres = read('js/ui/presenter.js');
    t.ok(/left > 0 && left <= 3 \? \(left === 1 \? 'bs\.ev\.woundedNext' : 'bs\.ev\.woundedGrave'\) : 'bs\.ev\.wounded'/.test(pres), 'presenter escolhe pelo prazo');
    for (const k of ['hud.confirmThrow', 'hud.confirmThrow.click', 'hud.confirmThrow.key', 'hud.confirmFire.click', 'hud.confirmFire.key']) t.ok(has(k), k);
    t.ok(/lançar/.test(S['hud.confirmThrow']) && !/disparar/.test(S['hud.confirmThrow']), 'lançar, não disparar');
    const ui = read('js/ui/battle_ui.js');
    t.ok(/else label = T\(confirmKey\('hud\.confirmThrow'\)\) \+ ' · ' \+ label;/.test(ui), 'arremesso usa hud.confirmThrow');
    t.ok(/case 'x': if \(!m\.shift\) abortMission\(\); return true;/.test(ui), 'X aborta (com a confirmação)');
    t.ok(/^X\|Abortar missão/.test(S['hud.keys.20']) && typeof OV.BattleUI.abort === 'function', 'linha na folha de teclas e OV.BattleUI.abort');
    for (const k of ['hud.medk.keys', 'hud.medk.keys.touch', 'hud.medk.partSel', 'hud.medk.partBtn', 'hud.sq.panic', 'hud.sq.panic.aria', 'hud.sq.aria', 'hud.sq.spent.aria', 'hud.sq.gone.aria', 'hud.report.turnStart', 'hud.report.panic.one', 'hud.report.panic.other', 'hud.panicSkip.one', 'hud.panicSkip.other', 'hud.equip.clipBack.one', 'hud.equip.clipBack.other']) t.ok(has(k), k);
    t.ok(/←\/→ ferido · ↑\/↓ parte do corpo/.test(S['hud.medk.keys']), 'teclas do kit como o painel se vê');
    t.ok(!/[←↑1]/.test(S['hud.medk.keys.touch']), 'toque sem teclas');
    t.ok(/\{clip\}/.test(S['hud.equip.inWeapon.tip']) && /não ocupa espaço/.test(S['hud.equip.hint']) && /não ocupa espaço/.test(S['hud.equip.hint.touch']), 'ajuda do Equipar');
  });

  t.test('persona r3: relatório do turno — pânico do início do turno X-COM com secção e contagem', () => {
    const entries = [
      { key: 'hud.log.hit', params: { name: 'João' }, kind: 'warn', own: true, side: 'alien' },
      { key: 'hud.log.alienKilled', params: { name: 'Sectoide' }, kind: 'good', own: false, side: 'alien' },
      { key: 'bs.morale.freeze', params: { name: 'Dieter' }, kind: 'warn', own: true, side: 'xcom' },
      { key: 'bs.morale.flee', params: { name: 'Omar' }, kind: 'warn', own: true, side: 'xcom' },
      { key: 'bs.morale.berserk', params: { name: 'Makoto' }, kind: 'warn', own: true, side: 'xcom' },
    ];
    const rows = BM.turnReportRows(entries);
    t.eq(rows.map((e) => e.key), ['hud.log.hit', 'hud.report.turnStart', 'bs.morale.freeze', 'bs.morale.flee', 'bs.morale.berserk']);
    t.eq(BM.reportSummary(rows), '1 ferido · 3 em pânico');
    t.eq(BM.turnReportRows(entries.slice(0, 2)).length, 1, 'sem nada no início do turno, sem secção');
    const ui = read('js/ui/battle_ui.js');
    t.ok(/const hurt = turnReportRows\(S\.log\.slice\(mark\)\)\.concat\(warnGrenades\(\)\);/.test(ui), 'endTurn usa as linhas novas');
    t.ok(/toast\(Tn\('hud\.panicSkip', panicked\), null, 'warn'\)/.test(ui), 'Tab avisa de quem está em pânico');
    t.ok(/class: 'bs-sq-st', 'aria-hidden': 'true' \}, el\('b', \{ text: '⚠' \}\), T\('hud\.sq\.panic'\)/.test(ui), 'linha da equipa com ícone e texto');
    t.ok(/row\.setAttribute\('aria-label'/.test(ui), 'aria-label com o estado');
  });

  t.test('persona r3: kit médico — ←/→ ferido, ↑/↓ parte, Tab nos botões, parte escolhida marcada', () => {
    const inv = read('js/ui/inventory_ui.js');
    const km = inv.slice(inv.indexOf('  function keyMed(ev) {'), inv.indexOf('  // chave estável de um botão do painel'));
    t.ok(/if \(key === 'ArrowLeft' \|\| key === 'ArrowRight'\) \{\s*const list = patients\(u\);/.test(km), '←/→ mudam de paciente');
    t.ok(/if \(key === 'ArrowUp' \|\| key === 'ArrowDown'\) \{\s*let k = MED_PARTS\.indexOf/.test(km), '↑/↓ mudam de parte');
    t.ok(/if \(key === 'Tab'\) \{[\s\S]*?n\.focus\(/.test(km), 'Tab move o foco real');
    t.ok(/if \(\(key === 'Enter' \|\| key === ' '\) && act && btns\.indexOf\(act\) >= 0\) return false;/.test(km), 'Enter ativa o botão com foco');
    t.ok(/'aria-pressed': p === part \? 'true' : 'false'/.test(inv), 'parte com aria-pressed');
    t.ok(/V\.med\.part === null \|\| \(!V\.med\.pinned && !\(t\.wounds\[V\.med\.part\] > 0\)\)/.test(inv), 'a parte escolhida à mão não é trocada');
    const css = read('css/battle.css');
    t.ok(/\.medk-pb\.on \{[^}]*box-shadow: inset 3px 0 0 var\(--amber\)/.test(css) && /\.medk-pb\.on span::before \{ content: '▶ '/.test(css), 'parte escolhida com marca e forma');
    t.ok(/\.medk-keys \{/.test(css), 'rodapé com as teclas');
  });

  t.test('persona r3: dica do teclado some, etiquetas do alvo longe do atirador, CSS do «Equipar»', () => {
    const ui = read('js/ui/battle_ui.js');
    t.ok(/const KB_HINT_MS = 6000;/.test(ui) && /case '\?': showKbHint\(\); openKeys\(\); return true;/.test(ui), 'dica 6 s por turno; ? volta a mostrá-la');
    const gfx = read('js/gfx/battle_render.js');
    t.ok(/function labelSide\(B, F, T, X, Y, gap, wMax, box\)/.test(gfx) && /const side = labelSide\(B, F, T, X, Y, gap, wMax, box\);/.test(gfx), 'lado oposto ao atirador');
    t.ok(/ctx\.globalAlpha = sel \|\| tgt \? 0\.72 : 0\.42;/.test(gfx), 'atirador e alvo mais visíveis através das paredes');
    const css = read('css/battle.css');
    t.ok(/@media \(hover: none\) \{\s*\.inv-equip \.eq-grid \.eq-main \.inv-head\.eq \.eq-btns \.btn \{ min-height: 36px; \}/.test(css), 'botões do Equipar ≥ 36 px no toque');
    t.ok(/\.inv-equip \.eq-grid \.eq-main \.eq-stores \{ flex: 1 1 260px; min-height: 260px; \}/.test(css) && /\.eq-stores-list \{ flex: 1; min-height: 0; max-height: none; \}/.test(css), 'armazém com a altura que sobra no retrato');
    t.ok(/@media \(max-height: 640px\) \{[^@]*\.inv-equip \.inv-handsrow \{ height: 100px;/.test(css), 'boneco mais baixo em janelas baixas');
    t.ok(!/\.eq-inw/.test(css), 'sem a casa «NA ARMA» no cinto');
  });
};
