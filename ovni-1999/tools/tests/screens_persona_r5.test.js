/* Ronda de personas 5 — ecrãs: nas Opções de um iPad só de toque, a linha «Cursor de teclado no combate» só aparece
   depois de se usar um teclado físico na sessão, e «Reduzir movimento» fala da definição do iPad, não do computador.
   Carrega js/ui/screens.js em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.showKbCursor) vm.runInThisContext(read('js/ui/screens.js'), { filename: 'screens.js' });
  const SC = OV.Screens;

  t.test('ecrãs r5: «Cursor de teclado» escondido no toque até se usar um teclado físico', () => {
    t.eq(SC.showKbCursor(false, false), true, 'rato/trackpad: sempre');
    t.eq(SC.showKbCursor(true, false), false, 'iPad sem teclado: escondido');
    t.eq(SC.showKbCursor(true, true), true, 'iPad com teclado externo: aparece');
    const src = read('js/ui/screens.js');
    t.ok(/showKbCursor\(mouseLess\(\), kbSeen\) \? optRow\(T\(ACC \+ 'kbCursor'\)/.test(src), 'a linha usa showKbCursor');
    // qualquer tecla fora de campos de texto conta (em captura, antes de OV.Input: o Esc que abre as Opções já conta)
    t.ok(/window\.addEventListener\('keydown', \(e\) => \{[\s\S]{0,200}kbSeen = true;[\s\S]{0,20}\}, true\);/.test(src), 'escuta em captura');
  });

  t.test('ecrãs r5: «Reduzir movimento» tem variante de toque sem «computador»', () => {
    const base = OV.STR['scr.opt.acc.motion.hint'];
    const touch = OV.STR['scr.opt.acc.motion.hint.touch'];
    t.ok(typeof base === 'string' && !/computador/.test(base), 'base: ' + base);
    t.ok(typeof touch === 'string' && /iPad/.test(touch) && /Movimento/.test(touch) && !/computador/.test(touch), 'toque: ' + touch);
    t.ok(/TT\(ACC \+ 'motion\.hint'\)/.test(read('js/ui/screens.js')), 'a dica usa TT (variante .touch)');
  });
};
