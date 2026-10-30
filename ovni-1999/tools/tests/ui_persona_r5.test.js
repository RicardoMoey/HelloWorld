/* Ronda 5 de personas — Battlescape e «Equipar» (battle_ui.js, input.js, battle_render.js, inventory_ui.js,
   css/battle.css, pt-PT.hud.js). Uma verificação por achado (r5_fixA #0–#12); o comportamento no navegador está em
   qa/persona_r5_battle.mjs. */
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
  if (!OV.BattleRender) {
    if (!OV.Color) load('js/gfx/color.js');
    if (!OV.Iso) load('js/gfx/iso.js');
    load('js/gfx/battle_render.js');
  }
  const BM = OV.BattleUI.model;
  const S = OV.STR;
  const has = (k) => typeof S[k] === 'string' && S[k].length > 0 && S[k].indexOf('⟦') < 0;
  const ui = read('js/ui/battle_ui.js');
  const mk = (id, side, x, y, extra) => Object.assign({ id, side, origSide: side, x, y, z: 0, onMap: true, status: 'ok', size: 1, name: side === 'xcom' ? 'Soldado ' + id : null, nameKey: side === 'alien' ? 'race.sectoid' : null }, extra || {});

  t.test('r5 #0 (Rui): o painel do turno não rouba o foco — Enter termina o turno, Esc fecha, Tab entra', () => {
    t.ok((ui.match(/close\.focus\(/g) || []).length === 1 && /if \(kind === 'log' && S\.lastInput === 'kb'\) close\.focus\(/.test(ui), 'FECHAR só recebe o foco no registo (N), nunca no relatório do turno');
    t.ok(/if \(key === 'Tab'\) \{\s*reportTab\(/.test(ui), 'Tab ainda entra no painel');
    t.ok(/if \(key === 'Enter'\) \{\s*if \(kbActive\(\)\) kbConfirm\(m\);\s*else if \(\(m\.ctrl \|\| m\.meta\) && aiming\) kbForceAtPointer\(\);\s*else endTurn\(\);/.test(ui), 'Enter → endTurn (que fecha o painel)');
    t.ok(/closeReport\(\);\s*S\.pending = null;/.test(ui), 'endTurn fecha o painel');
  });

  t.test('r5 #1 (Sofia): a batalha que acaba depois de «Fim do turno» mostra primeiro as baixas dessa fase', () => {
    t.ok(/S\.endMark = mark;/.test(ui), 'marca do registo guardada antes do turno alienígena');
    t.ok(/const last = endNo !== null && endNo !== undefined \? turnReportRows\(S\.log\.filter\(\(e\) => e\.seq > mark\), endNo\) : \[\];/.test(ui), 'finishBattle lê as entradas desde «Fim do turno»');
    t.ok(/if \(reportSummary\(last\)\) \{[\s\S]{0,200}openReport\('turn', last,[\s\S]{0,160}, res\)\);/.test(ui), 'relatório do turno antes do relatório da missão, com «Continuar»');
    t.ok(/S\.ended && S\.report && S\.report\.final && \(key === 'Enter' \|\| key === 'Escape' \|\| key === ' '\)/.test(ui), 'Enter/Esc/Espaço seguem');
    t.ok(has('hud.report.continue'), 'hud.report.continue');
    // só quando há baixas, feridos ou pânico (o resumo não vazio)
    const rows = BM.turnReportRows([
      { key: 'hud.log.kia', params: { name: 'Dmitri' }, own: true, side: 'xcom', turn: 15, kind: 'bad' },
      { key: 'hud.log.shotAt', params: { name: 'x', target: 'Wu' }, own: true, side: 'alien', turn: 15, kind: 'warn' },
    ], 15);
    t.ok(/1 soldado morto|morto/.test(BM.reportSummary(rows)), BM.reportSummary(rows));
    t.eq(BM.reportSummary(BM.turnReportRows([{ key: 'hud.log.shotAt', params: { name: 'x', target: 'Wu' }, own: true, side: 'alien', turn: 15 }], 15)), '', 'só tiros falhados: segue direto');
  });

  t.test('r5 #2 (Sofia): a dica de uma linha da equipa abre à direita da coluna', () => {
    t.ok(/function tipRight\(node\)/.test(ui) && /tipRight\(row\);/.test(ui), 'tipRight nas linhas da equipa');
    t.ok(/t\.style\.left = Math\.round\(r\.right \+ 8\) \+ 'px';/.test(ui), 'à direita da linha');
  });

  t.test('r5 #3 (Tiago): foguete com aliado ao lado da linha — risco no raio dele, 2.º clique', () => {
    // o caso do relatório: Serguei (15,5) aponta a (12,2); Nicolas em (15,4); raio 3
    const sg = mk(1, 'xcom', 15, 5), ni = mk(2, 'xcom', 15, 4), far = mk(3, 'xcom', 2, 20), civ = mk(4, 'civ', 16, 2);
    const B = { units: [sg, ni, far, civ] };
    const r = BM.blastLineRisk(B, sg, 12, 2, 0, 3, {});
    t.eq(r.near, [2], 'Nicolas perto da linha');
    t.ok(r.hit.indexOf(2) >= 0 && r.hit.indexOf(1) >= 0 && r.hit.indexOf(3) < 0, 'no raio dele: Nicolas e o próprio atirador; o longe não');
    t.ok(r.self, 'self');
    t.eq(BM.blastLineRisk(B, sg, 12, 2, 0, 3, { seen: (u) => u.id !== 2 }).near.length, 0, 'aliado por ver não conta');
    t.ok(/if \(b && !b\.smoke\) return blastConfirm\(settings\(\), diff\) \? lineRisk\(/.test(ui), 'lineRiskConfirm já não sai a 0 nos explosivos');
    for (const via of ['click', 'tap', 'key']) for (const n of ['one', 'other']) t.ok(has('hud.confirmLine.blast.' + via + '.' + n), 'hud.confirmLine.blast.' + via + '.' + n);
    t.ok(OV.Tn('hud.confirmLine.blast.click', 1, { n: 1, name: 'Nicolas Leroy' }).indexOf('rebentar em cima de Nicolas Leroy') >= 0, '«… pode rebentar em cima de Nicolas Leroy»');
    t.ok(has('hud.target.nearLine.blast.one') && has('hud.target.nearLine.blast.other'));
  });

  t.test('r5 #4 (Tiago): explosivo apontado a um alienígena mostra o acerto (não «apanha o alvo»)', () => {
    const txt = OV.T('hud.target.blast', { pct: 23, r: 3, tu: 25 });
    t.ok(/23 %/.test(txt) && /raio 3/.test(txt) && !/apanha o alvo/.test(txt), txt);
    t.ok(has('hud.target.blast.noPct') && /Se acertar/.test(S['hud.target.blast.noPct']), 'sem pré-visualização do acerto: «Se acertar: …»');
    t.ok(/const pct = tgtUnit \? T0\.hitPct : null;/.test(ui) && /T0\.hitPct = pct;/.test(ui), 'o acerto fica na etiqueta (cor) quando aponta a uma unidade');
  });

  t.test('r5 #5 (Tiago): porta fechada com alguém do outro lado — o soldado vai lá e abre-a', () => {
    t.ok(/const db = v\.ok \? doorBlock\(u, v\.steps\) : null;/.test(ui), 'clickMove verifica a porta no caminho');
    t.ok(/st\.occupant !== null && st\.occupant !== undefined/.test(ui) && /st\.opensUfoDoor/.test(ui), 'ocupante não visto atrás de porta normal ou de OVNI');
    t.ok(/path: v\.steps\.slice\(0, db\.k\)/.test(ui) && /if \(dv\.ok\) act\(db\.door\);/.test(ui), 'anda até à porta e abre-a');
    for (const k of ['hud.door.someone', 'hud.door.someone.mac', 'hud.door.someone.touch']) t.ok(has(k), k);
  });

  t.test('r5 #6 (Pedro): etiquetas do cursor fogem das colunas do HUD e partem-se em linhas', () => {
    const F = { dpr: 1, W: 1024, H: 576, view: { safe: { avoid: [{ x0: 10, y0: 52, x1: 160, y1: 330 }, { x0: 960, y0: 10, x1: 1014, y1: 200 }] } } };
    t.eq(BM && OV.BattleRender.avoidCols(F, 40, 100, 300, 20), 168, 'à altura da equipa: passa para a direita dela');
    t.eq(OV.BattleRender.avoidCols(F, 40, 400, 300, 20), 40, 'abaixo da equipa: fica');
    t.eq(OV.BattleRender.avoidCols(F, 800, 100, 300, 20), 960 - 8 - 300, 'à altura dos alienígenas: encosta à esquerda deles');
    const gfx = read('js/gfx/battle_render.js');
    t.ok(/const PILL_MAX = 420;/.test(gfx) && /function wrapText\(ctx, text, maxW\)/.test(gfx), 'textos longos em várias linhas');
    t.ok(/S\.view\.safe = \{[^}]*avoid \};/.test(ui), 'a interface mede as colunas');
    t.ok(/const under = \(sf\.avoid \|\| \[\]\)\.some\(/.test(ui) && /if \(under \|\| p\.x < mx/.test(ui), 'o cursor de teclado debaixo de uma coluna puxa a câmara');
  });

  t.test('r5 #7 (Pedro): tiros dos alienígenas contra os nossos ficam no registo; se acertarem, fica só o ferimento', () => {
    const ana = mk(1, 'xcom', 2, 2, { name: 'Ana', hp: 20 });
    const sec = mk(2, 'alien', 9, 2, { name: 'Sectoide Navegador' });
    const B = { units: [ana, sec], map: { w: 20, h: 20, d: 1 }, side: 'alien' };
    const C = { last: {}, seenAt: {} };
    const shot = (round) => ({ t: 'shot', shooterId: 2, targetId: 1, targetI: 42, round, shots: 1, hit: { kind: 'floor' }, vis: true, pos: 49 });
    // o atacante está à vista (a LOS real precisa do mapa inteiro: aqui diz-se que sim)
    const vis0 = OV.LOS.isVisibleTo;
    OV.LOS.isVisibleTo = () => true;
    let e;
    try { e = BM.logEntry(B, shot(0), C); } finally { OV.LOS.isVisibleTo = vis0; }
    t.ok(e && e.key === 'hud.log.shotAt' && e.own && e.kind === 'warn' && e.at === 42 && e.from === 49, JSON.stringify(e));
    t.ok(OV.T(e.key, e.params) === 'Sectoide Navegador disparou contra Ana — falhou', OV.T(e.key, e.params));
    t.eq(BM.logEntry(B, shot(1), C), null, 'resto da rajada: a mesma entrada');
    const hit = BM.logEntry(B, { t: 'damage', unitId: 1, amount: 7, attackerId: 2, cause: 'shot', dmgType: 'AP', vis: true, pos: 42 }, C);
    t.ok(e.gone === true && hit && /^hud\.log\.hit/.test(hit.key), 'acertou: a entrada «falhou» sai e fica a do ferimento');
    t.eq(BM.turnReportRows([Object.assign({ side: 'alien', turn: 3 }, e)], 3).length, 0, 'entradas que saíram não entram no relatório');
    t.ok(has('hud.log.shotAt') && has('hud.log.shotAt.burst'));
  });

  t.test('r5 #8 (Pedro): «Equipar» em janelas baixas — cinto e mochila lado a lado, ajuda curta inteira', () => {
    const css = read('css/battle.css');
    t.ok(/@media \(max-height: 860px\) \{\s*@container eq \(min-width: 861px\) \{\s*\.inv-equip \.eq-grid \.eq-main \.inv-doll \{ display: grid; grid-template-columns: minmax\(0, 4fr\) minmax\(0, 9fr\);/.test(css), 'cinto 4 : mochila 9 lado a lado');
    t.ok(/\.inv-hint-short \{ display: none; \}/.test(css) && /\.inv-hint-short \{ display: -webkit-box; -webkit-line-clamp: 2;/.test(css), 'ajuda curta em 2 linhas só nas janelas baixas');
    t.ok(/inv-hint-short/.test(read('js/ui/inventory_ui.js')), 'inventory_ui escreve as duas versões');
    t.ok(has('hud.equip.hint.short') && has('hud.equip.hint.short.touch'));
    t.ok(S['hud.equip.hint.short'].length < 200, 'curta: cabe em 2 linhas a 680 px');
  });

  t.test('r5 #9 (Marta): explosivo que apanha aliados pede no toque uma janela à parte, com o atirador nomeado', () => {
    t.ok(/const b = risky && isTouch\(\) \? blastPreview\(u, it, i\) : null;/.test(ui) && /askBlast\(u, ids, 'shoot'/.test(ui), 'tiro: janela no toque');
    t.ok(/if \(risky && isTouch\(\)\) \{\s*askBlast\(/.test(ui), 'granada: a mesma janela');
    t.ok(/buttons: \[\{ label: T\('common\.cancel'\), value: false \}, \{ label: T\(kind === 'throw'/.test(ui), 'Cancelar primeiro (fica com o foco)');
    const w = BM.blastWho({ risk: 2, civ: 0, self: true, selfF: true });
    t.eq(w, 'a própria atiradora e 1 aliado');
    t.eq(BM.blastWho({ risk: 1, civ: 0, self: true }), 'o próprio atirador');
    t.eq(BM.blastWho({ risk: 4, civ: 2, self: true }), 'o próprio atirador, 1 aliado e 2 civis');
    t.eq(BM.blastWho({ risk: 3, civ: 0 }), '3 aliados');
    t.eq(OV.T('hud.confirmBlast.tap.who', { who: w }), 'Toque outra vez para disparar — atinge a própria atiradora e 1 aliado');
    for (const k of ['hud.blastAsk.title', 'hud.blastAsk.title.throw', 'hud.blastAsk.text', 'hud.blastAsk.text.throw', 'hud.blastAsk.fire', 'hud.blastAsk.throw', 'hud.blastAsk.self', 'hud.blastAsk.self.f', 'hud.blast.self', 'hud.blast.self.f', 'hud.blast.and3']) t.ok(has(k), k);
  });

  t.test('r5 #10 (Marta): o meio de entrada segue toques no HUD e começa em toque num ecrã só tátil', () => {
    const inp = read('js/ui/input.js');
    t.ok(/document\.addEventListener\('pointerdown', \(e\) => \{ if \(e\.pointerType\) I\.lastPointerType = e\.pointerType; \}, \{ capture: true, passive: true \}\);/.test(inp), 'pointerdown no documento');
    t.ok(/lastPointerType: coarseOnly\(\) \? 'touch' : 'mouse',/.test(inp), 'iPad: começa em toque');
  });

  t.test('r5 #11 (Marta): «Fim do turno» e a lista da equipa durante uma animação ficam guardados', () => {
    t.ok(/if \(S\.B\.side === 'xcom' && S\.endNo === null\) queueIntent\(\{ end: true \}\);/.test(ui), 'fim do turno guardado');
    t.ok(/queueIntent\(\{ select: u\.id \}\)/.test(ui), 'soldado da lista guardado');
    t.ok(/if \(S\.pending\) setTimeout\(runPending, 0\);/.test(ui) && /if \(P0\.end\) endTurn\(\);/.test(ui), 'aplicados no fim da animação');
    t.ok(/\.bs-end\.queued \{ animation:/.test(read('css/battle.css')), 'o botão pulsa enquanto espera');
  });

  t.test('r5 #12 (Marta): o conselho «estão dentro do OVNI» fica no registo (N) com «Mostrar»', () => {
    t.ok(/if \(hint\) pushLog\(Object\.assign\(\{\}, hint, \{ own: false \}\)\);/.test(ui), 'entra no registo');
    t.ok(/function pushLog\(e\)/.test(ui), 'pushLog');
  });
};
