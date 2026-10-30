/* Ronda 2 de personas — Battlescape, inventário e «Equipar» (battle_ui.js, presenter.js, inventory_ui.js, input.js,
   battle.css): cursor de teclado ao alternar setas (↓ ← ↓ ← segue uma fila da grelha), 2.ª confirmação de
   explosivos à prova de duplo clique, zombie com o nome do soldado, arma carregada no «Equipar» (o mesmo
   carregador que OV.BUnits.autoLoad mete na arma), textos novos e regras de CSS que evitam sobreposições.
   O comportamento no navegador está em qa/persona_r2_battle.mjs. */
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
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const M = OV.BattleUI.model;

  t.test('persona r2: ↓ ← ↓ ← segue uma fila da grelha (não salta entre duas casas)', () => {
    const m = { w: 40, h: 40 };
    const walk = (x, y, keys, n) => {
      let p = { x, y, anchor: null };
      const out = [];
      for (let k = 0; k < n; k++) for (const d of keys) {
        p = M.kbStep(m, p.x, p.y, d, p.anchor);
        out.push(p.x + ',' + p.y);
      }
      return { p, out };
    };
    let r = walk(3, 7, ['down', 'left'], 6);
    t.eq([r.p.x, r.p.y], [3, 19], '↓← ×6 desce a coluna x=3: ' + r.out.join(' '));
    t.eq(new Set(r.out).size, r.out.length, 'nunca volta a uma casa');
    r = walk(20, 20, ['up', 'right'], 4);
    t.ok(r.p.y <= 13 && Math.abs(r.p.x - 20) <= 1, '↑→ sobe a fila (y−1): ' + r.out.join(' '));
    r = walk(20, 20, ['left', 'up'], 4);
    t.ok(r.p.x <= 13 && Math.abs(r.p.y - 20) <= 1, '←↑ anda ao longo de x−1: ' + r.out.join(' '));
    r = walk(20, 20, ['right', 'down'], 4);
    t.ok(r.p.x >= 27 && Math.abs(r.p.y - 20) <= 1, '→↓ anda ao longo de x+1: ' + r.out.join(' '));
    // a mesma seta seguida continua a direito no ecrã (ronda 1)
    r = walk(20, 20, ['up'], 8);
    t.ok(Math.abs((r.p.x - r.p.y) - 0) <= 1 && r.p.x + r.p.y === 32, '↑ ×8 sobe a direito: ' + r.out.join(' '));
  });

  t.test('persona r2: explosivo com aliados — o 2.º clique de um duplo clique não dispara', () => {
    t.eq(M.confirmEarly('mouse', 2, 2000), true, 'detail 2 = 2.º clique de um duplo clique');
    t.eq(M.confirmEarly('mouse', 1, 120), true, 'clique demasiado rápido');
    t.eq(M.confirmEarly('mouse', 1, 650), false, 'clique separado confirma');
    t.eq(M.confirmEarly('touch', 2, 900), true, 'toque duplo também não');
    t.eq(M.confirmEarly('kb', undefined, 0), false, 'Enter (a repetição automática já é filtrada)');
    const src = read('js/ui/battle_ui.js');
    t.ok(/if \(risky && confirmTooSoon\(pointerType, detail\)\) return;/.test(src) && src.split('confirmTooSoon(pointerType, detail)').length === 3, 'tiro e lançamento usam a guarda');
    t.ok(/detail: isDbl \? 2 : 1/.test(read('js/ui/input.js')), 'OV.Input dá detail ao clique');
  });

  t.test('persona r2: soldado transformado em zombie — aviso e registo com o nome dele', () => {
    const BM = OV.BMap, BU = OV.BUnits;
    const m = BM.create(10, 10, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = OV.Data.tileId('FARM.ground');
    const B = { map: m, units: [], items: [], nextId: 1, turn: 5, side: 'alien', aborted: false, pendingBerserk: [], mission: { kind: 'terror', difficulty: 0, shade: 0, deploymentId: 'dep_small_scout' }, rng: OV.RNG.streams(9) };
    OV.Battle.rebuildDerived(B);
    const palesa = BU.fromSoldier(B, { soldierId: 'p', name: 'Palesa Steyn', nat: 'za', female: true, rank: 0, armour: 'coveralls', stats: { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 30, melee: 30, psiStr: 30, psiSkill: 0 } }, { R: null, L: null, belt: [], pack: [] });
    BU.placeUnit(B, palesa, BM.idx(m, 3, 3, 0));
    const z = BU.fromAlien(B, 'zombie', 0, B.rng.map, 'dep_small_scout');
    BU.placeUnit(B, z, BM.idx(m, 3, 3, 0));
    palesa.hp = 0;
    palesa.status = 'dead';
    const at = BM.idx(m, 3, 3, 0);
    const e = M.logEntry(B, { t: 'zombify', unitId: z.id, fromId: palesa.id, type: 'zombie', i: at, vis: true, pos: at }, { last: {}, seenAt: {} });
    t.ok(!!e, 'entra no registo');
    const txt = OV.T(e.key, e.params);
    t.ok(/^Palesa Steyn transformou-se num zombie/.test(txt), txt);
    t.eq([e.kind, e.own, e.at], ['bad', true, at]);
    const pres = read('js/ui/presenter.js');
    t.ok(/H\.zombify = async function \(C, B, ev\) \{\s*\/\/[^\n]*\n\s*const u = unit\(B, ev\.fromId\);/.test(pres), 'presenter: nome de fromId');
  });

  t.test('persona r2: «Equipar» mostra a arma carregada com o mesmo carregador que o motor usa', () => {
    const plan = OV.InventoryUI.model.loadPlan;
    t.eq(plan({ R: 'rifle', L: null, belt: ['grenade', 'rifle_clip', 'rifle_clip'], pack: [] }), { R: { slot: 'belt', k: 1, type: 'rifle_clip' }, L: null });
    t.eq(plan({ R: 'pistol', L: 'pistol', belt: ['pistol_clip'], pack: ['pistol_clip'] }).L, { slot: 'pack', k: 0, type: 'pistol_clip' }, 'a mão esquerda usa o carregador seguinte');
    t.eq(plan({ R: 'rifle', L: null, belt: [], pack: [] }).R, null, 'sem munição: vazia');
    t.eq(plan({ R: 'stun_rod', L: null, belt: ['rifle_clip'], pack: [] }).R, null, 'arma sem munição própria');
    // coincide com OV.BUnits.fromSoldier + autoLoad (o que acontece no início da missão)
    const BM = OV.BMap;
    const m = BM.create(6, 6, 1);
    const B = { map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', pendingBerserk: [], mission: { kind: 'crash', difficulty: 0 }, rng: OV.RNG.streams(3) };
    OV.Battle.rebuildDerived(B);
    const lo = { R: 'rifle', L: 'pistol', belt: ['grenade', 'pistol_clip', 'rifle_clip'], pack: ['rifle_clip', 'electro_flare'] };
    const u = OV.BUnits.fromSoldier(B, { soldierId: 'x', name: 'X', nat: 'pt', rank: 0, armour: 'coveralls', stats: { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 40, melee: 30, psiStr: 30, psiSkill: 0 } }, lo);
    const p = plan(lo);
    const left = { belt: lo.belt.filter((_, k) => !(p.R && p.R.slot === 'belt' && p.R.k === k) && !(p.L && p.L.slot === 'belt' && p.L.k === k)), pack: lo.pack.filter((_, k) => !(p.R && p.R.slot === 'pack' && p.R.k === k) && !(p.L && p.L.slot === 'pack' && p.L.k === k)) };
    const types = (s) => OV.BUnits.item(B, u, s).map((it) => it.type);
    t.eq(types('belt'), left.belt, 'cinto em combate = cinto do «Equipar» sem o carregador «Na arma»');
    t.eq(types('pack'), left.pack, 'mochila idem');
    t.eq(OV.BUnits.findItem(B, u.items.R).ammo.type, 'rifle_clip');
    t.eq(OV.BUnits.findItem(B, u.items.L).ammo.type, 'pistol_clip');
  });

  t.test('persona r2: textos novos (porta longe, reserva, toque, Equipar) existem e dizem a verdade', () => {
    const keys = ['hud.door.hint.far', 'hud.door.hint.far.mac', 'hud.door.hint.far.key', 'hud.path.reserve', 'hud.path.reserve.kneel',
      'hud.path.reserve.fix', 'hud.path.reserve.fix.touch', 'hud.path.reserve.deny', 'hud.path.reserve.deny.touch', 'hud.hint.aim.touch',
      'hud.equip.inWeapon.tip', 'hud.equip.load', 'hud.equip.spare', 'hud.equip.noAmmo.tip', 'hud.stop.reserved', 'hud.stop.reserved.touch',
      'hud.tip.squad.touch', 'hud.tip.alienKeys.touch', 'hud.tip.night.touch'];
    t.eq(keys.filter((k) => !has(k)), [], 'chaves');
    for (const k of ['hud.door.hint.far', 'hud.door.hint.far.mac', 'hud.door.hint.far.key']) t.ok(!/UT/.test(OV.STR[k]), k + ' sem custo inventado');
    t.ok(/\{res\}/.test(OV.STR['hud.path.reserve']) && /\{what\}/.test(OV.STR['hud.path.reserve.deny']), 'reserva com o valor');
    t.ok(!/[(«]?(Q\/E|Q ou E)/.test(OV.STR['hud.hint.aim.touch']), 'toque sem teclas');
    for (const k of ['hud.equip.hint', 'hud.equip.hint.touch', 'hud.equip.auto.tip']) t.ok(!/2 carregadores/.test(OV.STR[k]) && /carregad/.test(OV.STR[k]), k);
    t.ok(/ponteiro/.test(OV.STR['hud.keys.9']) && /clique secundário/.test(OV.STR['hud.keys.9']), 'T no ponteiro na folha de teclas');
  });

  t.test('persona r2: regras de CSS contra sobreposições (Equipar, dica, painel, toasts, teclas no toque)', () => {
    const css = read('css/battle.css');
    t.ok(/\.inv-equip \.inv-doll \{ container: eqd \/ inline-size; \}/.test(css), 'cabeçalho do Equipar pela largura do boneco');
    t.ok(/@container eqd \(max-width: 640px\)[^}]*\{[^}]*\}\s*\.inv-equip[^{]*\.eq-btns \{ grid-column: 1 \/ -1; grid-row: 2;/.test(css), 'botões por baixo quando estreito');
    t.ok(/\.inv-equip \.inv-head\.eq \.inv-meters \{[^}]*min-width: 0;/.test(css), 'medidores presos à coluna');
    t.ok(/\.bs-hint \{[^}]*bottom: calc\(var\(--bs-bot, 130px\) \+ 10px\)/.test(css), 'dica por cima do HUD de baixo medido');
    t.ok(/body\.in-battle:has\(\.bs-report:not\(\.hidden\)\) #toasts \{ top: auto; bottom:/.test(css), 'toasts fora do painel do turno');
    t.ok(/@media \(max-width: 960px\) \{\s*\/\*[^*]*\*\/\s*\.bs-report \{ left: calc\(170px/.test(css), 'painel ao lado da lista no retrato');
    t.ok(/\.bs-hud \.key, \.bs-hud \.bs-hand-key, \.inv-root \.key, body\.in-battle #modals \.key \{ display: none; \}/.test(css), 'sem emblemas de teclas no toque');
    t.ok(/\.inv-ground \.inv-it\.row \.inv-nm \{[^}]*-webkit-line-clamp: 2/.test(css), 'nomes do chão em duas linhas');
    t.ok(/\.modal\.bs-keysheet \.modal-actions \{ position: sticky;/.test(css), 'folha de teclas com rodapé fixo');
    t.ok(/\.inv-equip \.eq-grid \.eq-main \.inv-doll \{ min-height: 0; overflow-y: auto;/.test(css), 'boneco desloca-se em janelas baixas');
    const bu = read('js/ui/battle_ui.js');
    t.ok(/document\.body\.style\.setProperty\('--bs-bot', bb\)/.test(bu), '--bs-bot medido');
  });

  t.test('persona r2: Equipar e inventário — ⌫ no objeto escolhido, Enter não perde a escolha, foco não salta', () => {
    const src = read('js/ui/inventory_ui.js');
    t.ok(/const src = picker\.sel \? picker\.sel : fsrc;/.test(src), '⌫ usa o objeto escolhido com o rato');
    t.eq((src.match(/activate\((?:V|E)\.focusEl, true\)/g) || []).length, 2, 'Enter ativa com kbd = true nos dois ecrãs');
    t.ok(/const r = resolve\(srcEl\.parentElement\);\s*return r && r\.p\.ok \? r : null;/.test(src), 'toque numa linha do contentor guarda lá');
    t.ok(/V\.focusBox = box \? box\.dataset\.drop : null;/.test(src), 'o foco lembra o compartimento');
  });
};
