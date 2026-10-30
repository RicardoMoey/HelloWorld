/* Ronda 4 de personas — Battlescape e inventário (battle_ui.js, inventory_ui.js, input.js, battle_render.js, fx.js,
   presenter.js, pt-PT.hud.js): aliados perto da linha de tiro (aviso + 2.º clique em Recruta), setas do inventário,
   tiros dos nossos no registo, pinça que não desce de zoom num deslize, inimigo à frente do atirador na pontaria.
   O comportamento no navegador está em qa/persona_r4_battle.mjs. */
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
  if (!OV.Input) load('js/ui/input.js');
  if (!OV.BattleRender) {
    OV.Color = OV.Color || null;
    if (!OV.Color) load('js/gfx/color.js');
    if (!OV.Iso) load('js/gfx/iso.js');
    load('js/gfx/battle_render.js');
  }
  const BM = OV.BattleUI.model;
  const IM = OV.InventoryUI.model;
  const S = OV.STR;
  const missing = (txt) => typeof txt !== 'string' || txt.indexOf('⟦') >= 0;

  const mk = (id, side, x, y, extra) => Object.assign({ id, side, origSide: side, x, y, z: 0, onMap: true, status: 'ok', size: 1, name: side === 'xcom' ? 'Soldado ' + id : null, nameKey: side === 'alien' ? 'race.sectoid' : null }, extra || {});

  t.test('persona r4 (Tiago): aliados a ≤ 1 casa da linha de tiro contam como risco; atrás do atirador, longe ou por ver não', () => {
    const shooter = mk(1, 'xcom', 2, 2);
    const B = {
      units: [shooter,
        mk(2, 'xcom', 4, 3), // 1 casa ao lado da linha, perto do atirador
        mk(3, 'xcom', 6, 2), // em cima da linha
        mk(4, 'xcom', 5, 5), // 3 casas ao lado: fora
        mk(5, 'xcom', 0, 2), // atrás do atirador: fora
        mk(6, 'xcom', 11, 2), // 1 casa depois do alvo: os falhanços passam por lá
        mk(7, 'xcom', 14, 2), // 4 casas depois do alvo: fora
        mk(8, 'alien', 10, 2), // o alvo
        mk(9, 'alien', 7, 3), // outro alienígena: não é risco
        mk(10, 'civ', 8, 1), // civil perto da linha: risco
        mk(11, 'xcom', 7, 2, { status: 'dead' }),
        mk(12, 'xcom', 5, 2, { z: 2 }), // dois níveis acima: fora
      ],
    };
    const r = BM.lineRisk(B, shooter, 10, 2, 0, { exclude: [8] });
    t.eq(r.map((x) => x.id), [2, 3, 10, 6], 'ordem: do mais perto do atirador para o mais longe');
    t.ok(r[0].d <= 1 && r[1].d === 0, 'distância à linha em casas');
    t.eq(BM.lineRisk(B, shooter, 10, 2, 0, { exclude: [8], seen: (u) => u.id !== 2 }).map((x) => x.id), [3, 10, 6], 'só os que o jogador vê');
    t.eq(BM.lineRisk(B, shooter, 2, 2, 0).length, 0, 'sem linha (alvo no próprio tile)');
    // o caso do relatório: Wolfgang a 0,41 casas da linha de Kevin (tiro na diagonal)
    const k = mk(20, 'xcom', 10, 10), w = mk(21, 'xcom', 12, 11);
    const r2 = BM.lineRisk({ units: [k, w] }, k, 16, 14, 0);
    t.eq(r2.length, 1, 'aliado a ~0,4 casas da diagonal');
  });

  t.test('persona r4 (Tiago): 2.º clique em Recruta só em tiros fracos (< 50 %); as opções dos explosivos mandam', () => {
    t.eq(BM.lineConfirm({}, 0, 25), true, 'Recruta, 25 %');
    t.eq(BM.lineConfirm({}, 0, 49), true);
    t.eq(BM.lineConfirm({}, 0, 50), false, '50 % já não pede');
    t.eq(BM.lineConfirm({}, 1, 20), false, 'Veterano: só o aviso');
    t.eq(BM.lineConfirm({ confirmBlast: 'always' }, 3, 20), true, '«Sempre»');
    t.eq(BM.lineConfirm({ confirmBlast: 'never' }, 0, 10), false, '«Nunca»');
    t.eq(BM.lineConfirm({}, 0, null), false, 'sem percentagem (explosivo): não');
    for (const k of ['hud.target.nearLine.one', 'hud.target.nearLine.other', 'hud.confirmLine.click.one', 'hud.confirmLine.click.other', 'hud.confirmLine.tap.one', 'hud.confirmLine.tap.other', 'hud.confirmLine.key.one', 'hud.confirmLine.key.other']) {
      t.ok(typeof S[k] === 'string' && S[k].length > 0, k);
    }
    t.ok(!missing(OV.Tn('hud.target.nearLine', 1, { n: 1, name: 'Wolfgang Weber' })) && OV.Tn('hud.target.nearLine', 1, { n: 1, name: 'Wolfgang Weber' }).indexOf('Wolfgang') >= 0, 'o nome do aliado no aviso');
    t.ok(OV.Tn('hud.confirmLine.click', 1, { n: 1, name: 'Wolfgang' }).indexOf('Wolfgang') >= 0, '«Clique outra vez — pode atingir Wolfgang»');
  });

  t.test('persona r4 (Pedro): o registo diz se os tiros dos nossos acertaram ou falharam (um por disparo/rajada)', () => {
    const cat = mk(1, 'xcom', 2, 2, { name: 'Catarina Sousa' });
    const sec = mk(2, 'alien', 9, 2, { name: 'Sectoide Soldado' });
    const sec2 = mk(3, 'alien', 9, 3, { name: 'Sectoide Navegador' });
    const B = { units: [cat, sec, sec2], map: { w: 20, h: 20, d: 1 }, side: 'xcom' };
    const C = { last: {}, seenAt: {} };
    const shot = (round, shots, hitId) => ({ t: 'shot', shooterId: 1, targetId: 2, targetI: 49, round, shots, hit: { kind: hitId ? 'unit' : 'floor', unitId: hitId || null }, vis: true, pos: 42 });
    const dmg = (id, n) => ({ t: 'damage', unitId: id, attackerId: 1, cause: 'shot', amount: n, wounds: 0, vis: true, pos: 49 });
    // tiro simples falhado
    let e = BM.logEntry(B, shot(0, 1, null), C);
    t.ok(e && e.key === 'hud.log.shot.miss', 'falhanço: ' + (e && e.key));
    t.ok(OV.T(e.key, e.params).indexOf('Catarina Sousa') >= 0 && OV.T(e.key, e.params).indexOf('Sectoide Soldado') >= 0, OV.T(e.key, e.params));
    t.eq(e.own, false, 'no turno X-COM não entra no relatório do turno');
    // tiro simples certeiro: a mesma entrada passa a acerto
    e = BM.logEntry(B, shot(0, 1, 2), C);
    t.eq(BM.logEntry(B, dmg(2, 12), C), null, 'o dano ao alienígena não cria uma 2.ª linha');
    t.eq(e.key, 'hud.log.shot.hit');
    t.eq(OV.T(e.key, e.params), OV.T('hud.log.shot.hit', { name: 'Catarina Sousa', target: 'Sectoide Soldado', n: 12 }));
    t.eq(e.kind, 'good');
    // rajada de 3: 2 acertos
    e = BM.logEntry(B, shot(0, 3, 2), C);
    BM.logEntry(B, dmg(2, 10), C);
    t.eq(BM.logEntry(B, shot(1, 3, null), C), null, '2.ª bala da rajada: sem linha nova');
    t.eq(BM.logEntry(B, shot(2, 3, 2), C), null);
    BM.logEntry(B, dmg(2, 8), C);
    t.eq([e.key, e.params.hits, e.params.shots, e.params.n], ['hud.log.shot.burstHit', 2, 3, 18], 'acertou 2 de 3 (−18)');
    t.ok(!missing(OV.T(e.key, e.params)), OV.T(e.key, e.params));
    // rajada sem acertos
    e = BM.logEntry(B, shot(0, 3, null), C);
    BM.logEntry(B, shot(1, 3, null), C);
    BM.logEntry(B, shot(2, 3, null), C);
    t.eq(e.key, 'hud.log.shot.burstMiss');
    // armadura aguentou
    e = BM.logEntry(B, shot(0, 1, 2), C);
    BM.logEntry(B, dmg(2, 0), C);
    t.eq(e.key, 'hud.log.shot.noDmg');
    // tiro a uma casa que apanhou um alienígena: a entrada aparece com o dano
    const tile = { t: 'shot', shooterId: 1, targetId: null, targetI: 50, round: 0, shots: 1, hit: { kind: 'unit', unitId: 3 }, vis: true, pos: 42 };
    t.eq(BM.logEntry(B, tile, C), null, 'tiro a uma casa: nada ainda');
    e = BM.logEntry(B, dmg(3, 9), C);
    t.ok(e && e.key === 'hud.log.shot.hit' && e.params.target === 'Sectoide Navegador', 'acertou num alienígena com um tiro a uma casa');
    // turno alienígena (fogo de reação): entra no relatório do turno
    B.side = 'alien';
    e = BM.logEntry(B, shot(0, 1, null), C);
    t.eq(e.own, true, 'fogo de reação no relatório do turno');
    t.ok(!/^hud\.log\.hit/.test(e.key), 'não conta como soldado ferido no resumo do turno');
    // ronda 5: o tiro do alienígena contra um dos nossos também entra («… disparou contra … — falhou»)
    const ae = BM.logEntry(B, { t: 'shot', shooterId: 2, targetId: 1, round: 0, shots: 1, hit: { kind: 'floor' }, vis: true, pos: 49 }, C);
    t.ok(ae && ae.key === 'hud.log.shotAt' && ae.own === true, 'tiro alienígena contra os nossos no registo');
    for (const k of ['hud.log.shot.miss', 'hud.log.shot.missTile', 'hud.log.shot.burstMiss', 'hud.log.shot.burstMissTile', 'hud.log.shot.hit', 'hud.log.shot.burstHit', 'hud.log.shot.noDmg', 'hud.log.shot.hitMany', 'hud.log.unseenAlien', 'hud.fx.miss', 'hud.tip.alienAim', 'hud.tip.alienAim.touch', 'hud.reserve.group']) {
      t.ok(typeof S[k] === 'string' && S[k].length > 0, k);
    }
  });

  t.test('persona r4 (Pedro): setas no inventário — ← da mão esquerda fica, ↓ vai ao cinto (nunca à outra mão)', () => {
    // geometria do inventário de combate a 1024×560 (persona, shots 070/071), px CSS
    const R = (l, tp, r, b, zone) => ({ left: l, top: tp, right: r, bottom: b, zone });
    const rects = [
      R(35, 148, 480, 410, 'doll'), // 0 mão esquerda (vazia: a caixa)
      R(700, 190, 1110, 393, 'doll'), // 1 espingarda na mão direita
      R(52, 458, 164, 539, 'doll'), // 2 cinto 1
      R(171, 458, 282, 539, 'doll'), // 3 cinto 2
      R(289, 458, 400, 539, 'doll'), // 4 cinto 3
      R(408, 458, 518, 539, 'doll'), // 5 cinto 4
      R(52, 604, 282, 686, 'doll'), // 6 mochila (kit médico 2×1)
      R(289, 604, 400, 686, 'doll'), // 7 mochila 2
      R(1145, 152, 1523, 699, 'ground'), // 8 chão
      R(1242, 54, 1293, 104, 'head'), // 9 ‹
      R(1300, 54, 1351, 104, 'head'), // 10 ›
      R(1367, 54, 1523, 104, 'head'), // 11 Fechar
    ];
    t.eq(IM.navPick(rects, 0, 'left'), 0, '← da mão esquerda: nada à esquerda — fica');
    const down = IM.navPick(rects, 0, 'down');
    t.ok(down >= 2 && down <= 5, '↓ da mão esquerda vai ao cinto (foi a ' + down + ')');
    t.eq(IM.navPick(rects, 0, 'right'), 1, '→ da mão esquerda: a mão direita');
    t.eq(IM.navPick(rects, 1, 'down') >= 2 && IM.navPick(rects, 1, 'down') <= 7, true, '↓ da mão direita desce (cinto/mochila)');
    t.ok(IM.navPick(rects, 1, 'left') === 0, '← da mão direita: a mão esquerda');
    t.eq(IM.navPick(rects, 2, 'left'), 2, '← do 1.º do cinto: fica (não sobe à mão)');
    t.eq(IM.navPick(rects, 2, 'right'), 3, '→ no cinto: a casa ao lado');
    t.eq(IM.navPick(rects, 2, 'up'), 0, '↑ do cinto: a mão esquerda');
    t.eq(IM.navPick(rects, 3, 'down'), 6, '↓ do cinto: a mochila');
    t.eq(IM.navPick(rects, 1, 'right'), 8, '→ da mão direita: o chão');
    t.ok([1, 5, 7].indexOf(IM.navPick(rects, 8, 'left')) >= 0, '← do chão volta ao soldado');
    t.eq(IM.navPick(rects, 9, 'right'), 10, '→ nos botões do topo');
  });

  t.test('persona r4 (Marta): deslize com dois dedos nunca mexe no zoom; a pinça é absoluta por gesto', () => {
    const P = OV.Input.pinchStep;
    // amostras como as do iPad: um dedo chega um fotograma atrasado (95 px num passo, depois 80 outra vez)
    let st = { d0: 80, d: 80, mx: 700, my: 400, zooming: false, over: 0, base: 80 };
    const z = [];
    for (const [d, mx] of [[95, 690], [80, 680], [80, 670], [97, 660], [80, 650], [80, 640]]) {
      const r = P(st, d, mx, 400);
      if (r.zoom) z.push(r.zoom.scale);
      t.ok(r.pan && r.pan.cx > 0, 'o deslize move a câmara');
    }
    t.eq(z, [], 'nenhum zoom num deslize com uma amostra atrasada');
    // pinça a sério: arranca no 2.º passo acima do limiar, com a escala desde o início do gesto
    st = { d0: 80, d: 80, mx: 0, my: 0, zooming: false, over: 0, base: 80 };
    const out = [];
    for (const d of [90, 100, 120, 100, 80]) {
      const r = P(st, d, 0, 0);
      if (r.zoom) out.push(Math.round(r.zoom.scale * 100) / 100);
    }
    t.eq(out, [1.25, 1.5, 1.25, 1], 'escala absoluta: volta a 1 quando os dedos voltam à distância inicial');
    // do lado da batalha: zoom0 · scale, com o corte em ZMAX — volta a 2, não desce a 1,5
    const ZMAX = 2, z0 = 2;
    const zs = out.map((s) => Math.min(ZMAX, z0 * s));
    t.eq(zs[zs.length - 1], 2, 'no limite, voltar à distância inicial deixa o zoom em 2');
  });

  t.test('persona r4 (Marta): a apontar, um inimigo atrás do atirador ganha à caixa do atirador (com folga no toque)', () => {
    const pickHostile = OV.BattleRender.pickHostile;
    const rects = [
      { x0: 120, x1: 160, y0: 430, y1: 505, unitId: 52, x: 13, y: 27, z: 0, hostile: true }, // sectoide atrás
      { x0: 130, x1: 170, y0: 446, y1: 521, unitId: 7, x: 14, y: 28, z: 0, hostile: false }, // Rajesh à frente
    ];
    t.eq(pickHostile(rects, 149, 490, 0).unitId, 52, 'toque no centro do alienígena (antes: o tile do atirador)');
    t.eq(pickHostile(rects, 149, 418, 20).unitId, 52, 'por cima da cabeça (seta), com 20 px de folga no toque');
    t.eq(pickHostile(rects, 149, 418, 4), null, 'com o rato a folga é pequena');
    t.eq(pickHostile(rects, 400, 490, 20), null, 'longe: nada (o resto da pontaria segue o tile)');
  });

  t.test('persona r4: textos do toque no inventário falam do toque longo', () => {
    t.ok(/mantenha o dedo/.test(S['hud.equip.hint.touch']), 'Equipar (toque)');
    t.ok(/mantenha o dedo/.test(S['hud.inv.hint.touch']), 'inventário de combate (toque)');
  });
};
