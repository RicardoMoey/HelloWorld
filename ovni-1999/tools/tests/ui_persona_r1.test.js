/* Ronda 1 de personas — Battlescape, inventário e «Equipar» (js/ui/battle_ui.js, presenter.js, inventory_ui.js,
   input.js): textos pt-PT de todas as chaves usadas (incluindo famílias dinâmicas e o feminino), passo do cursor de
   teclado (todas as casas alcançáveis, ↑ sobe a direito), 2.ª confirmação de explosivos por dificuldade, registo do
   turno alienígena (quem morreu, como, quem atacou), auto-equipar (investigação, munição, Força) e a pinça do iPad
   (deslizar com dois dedos no limite do zoom não mexe no zoom). Carrega os ficheiros de interface em Node. */
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

  t.test('persona r1: todas as chaves literais do Battlescape/inventário existem (e plurais)', () => {
    const miss = [];
    for (const f of ['js/ui/battle_ui.js', 'js/ui/presenter.js', 'js/ui/inventory_ui.js']) {
      const src = read(f);
      for (const m of src.matchAll(/\b(?:T|OV\.T|gk|toast\(C,|toast)\(\s*'([a-z][a-zA-Z0-9_.]+)'/g)) {
        if (m[1].endsWith('.') || /^(ui_|alien_|hud\.short\.$)/.test(m[1])) continue;
        if (!has(m[1])) miss.push(f + ': ' + m[1]);
      }
      for (const m of src.matchAll(/\b(?:Tn|OV\.Tn)\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (m[1].endsWith('.')) continue;
        for (const s of ['.one', '.other']) if (!has(m[1] + s)) miss.push(f + ': ' + m[1] + s);
      }
    }
    t.eq([...new Set(miss)], [], 'chaves em falta');
  });

  t.test('persona r1: famílias dinâmicas, feminino e folha de teclas', () => {
    const keys = [];
    for (const via of ['click', 'tap', 'key']) keys.push('hud.confirmBlast.' + via + '.one', 'hud.confirmBlast.' + via + '.other');
    for (const k of ['shot', 'explosion', 'blast', 'melee', 'fire', 'smoke', 'wounds', 'other']) keys.push('hud.log.how.' + k);
    for (const p of ['night', 'day', 'dusk', 'dim']) keys.push('hud.' + p, 'hud.tip.' + p);
    for (const v of ['', '.touch', '.kb']) keys.push('hud.hint.target' + v, 'hud.hint.throw' + v);
    for (const k of ['copy', 'paste', 'auto', 'clear']) keys.push('hud.equip.' + k, 'hud.equip.' + k + '.tip');
    for (const k of ['bs.ev.kia', 'bs.ev.wounded', 'bs.ev.healed', 'bs.morale.freeze', 'bs.status.mia', 'bs.status.kneel', 'hud.log.kia', 'hud.log.hit', 'hud.log.hitWound']) keys.push(k, k + '.f');
    for (const k of ['panic', 'berserk', 'freeze', 'flee']) keys.push('bs.morale.' + k);
    for (let k = 1; k <= 19; k++) keys.push('hud.keys.' + k);
    t.eq(keys.filter((k) => !has(k)), []);
    for (let k = 1; k <= 19; k++) t.ok(OV.T('hud.keys.' + k).indexOf('|') > 0, 'hud.keys.' + k + ' = tecla|efeito');
    t.ok(/Custa 16 UT · ficam 40/.test(OV.T('hud.path', { tu: 16, left: 40, energy: 46 })), 'custo e UT que ficam com a mesma semântica');
    t.ok(/morta/.test(OV.T('bs.ev.kia.f', { name: 'Teresa' })) && /paralisada/.test(OV.T('bs.morale.freeze.f', { name: 'Anjali' })), 'feminino');
    t.ok(/Toque para acelerar/.test(OV.T('hud.banner.hurry.touch')), 'turno alienígena no toque');
  });

  t.test('persona r1: cursor de teclado — ↑↑ sobe a direito, ← ← para a esquerda, todas as casas alcançáveis', () => {
    const m = { w: 7, h: 6 };
    let r = M.kbStep(m, 3, 3, 'up', null);
    r = M.kbStep(m, r.x, r.y, 'up', r.anchor);
    t.eq([r.x - r.y, r.x + r.y], [0, 4], '2 × ↑: mesma coluna de ecrã, uma casa inteira acima');
    let l = M.kbStep(m, 3, 3, 'left', null);
    l = M.kbStep(m, l.x, l.y, 'left', l.anchor);
    t.eq([l.x + l.y, l.x - l.y], [6, -2], '2 × ←: mesma linha de ecrã');
    // cada passo é para um vizinho ortogonal (meia casa no ecrã) e fica no mapa
    const seen = new Set(['0,0']), q = [[0, 0, null]];
    while (q.length) {
      const [x, y, a] = q.shift();
      for (const d of ['up', 'down', 'left', 'right']) {
        const s = M.kbStep(m, x, y, d, a);
        t.ok(s.x >= 0 && s.y >= 0 && s.x < m.w && s.y < m.h, 'dentro do mapa');
        t.ok(Math.abs(s.x - x) + Math.abs(s.y - y) <= 1, 'vizinho ortogonal');
        for (const flip of [false, true]) {
          const s2 = M.kbStep(m, x, y, d, { d: x - y + (flip ? 1 : -1), s: x + y + (flip ? -1 : 1), flip });
          const k = s2.x + ',' + s2.y;
          if (!seen.has(k)) {
            seen.add(k);
            q.push([s2.x, s2.y, s2.anchor]);
          }
        }
        const k = s.x + ',' + s.y;
        if (!seen.has(k)) {
          seen.add(k);
          q.push([s.x, s.y, s.anchor]);
        }
      }
    }
    t.eq(seen.size, m.w * m.h, 'todas as casas alcançáveis com as setas');
    const edge = M.kbStep(m, 0, 0, 'up', null);
    t.eq([edge.x, edge.y], [0, 0], 'no canto não sai do mapa');
  });

  t.test('persona r1: 2.ª confirmação de explosivos com aliados no raio', () => {
    t.ok(M.blastConfirm({}, 0) && M.blastConfirm({}, 1), 'por omissão em Recruta e Veterano');
    t.ok(!M.blastConfirm({}, 2), 'Super-humano: um clique');
    t.ok(M.blastConfirm({ confirmBlast: 'always' }, 2) && !M.blastConfirm({ confirmBlast: 'never' }, 0), 'opção');
    t.eq(M.handName('rocket_launcher'), OV.T('item.rocket_launcher'), 'nome completo quando cabe em duas linhas');
    t.eq(M.handName('auto_cannon'), 'Canhão Auto.', 'nome curto quando não cabe');
  });

  t.test('persona r1: registo do turno alienígena — quem caiu, como e quem atacou', () => {
    const BM = OV.BMap, BU = OV.BUnits;
    const m = BM.create(10, 10, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = OV.Data.tileId('FARM.ground');
    const B = { map: m, units: [], items: [], nextId: 1, turn: 3, side: 'alien', aborted: false, pendingBerserk: [], mission: { kind: 'crash', difficulty: 0, shade: 0, deploymentId: 'dep_small_scout' }, rng: OV.RNG.streams(5) };
    OV.Battle.rebuildDerived(B);
    const mk = (name, female, x) => {
      const u = BU.fromSoldier(B, { soldierId: name, name, nat: 'pt', female, rank: 0, armour: 'coveralls', stats: { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 30, melee: 30, psiStr: 30, psiSkill: 0 } }, { R: null, L: null, belt: [], pack: [] });
      BU.placeUnit(B, u, BM.idx(m, x, 2, 0));
      return u;
    };
    const teresa = mk('Teresa Carvalho', true, 2), rui = mk('Rui Lopes', false, 4);
    const al = BU.fromAlien(B, 'sectoid_soldier', 0, B.rng.map, 'dep_small_scout');
    BU.placeUnit(B, al, BM.idx(m, 8, 8, 0));
    const ctx = { last: {}, seenAt: {} };
    // granada de um alienígena que ninguém viu: dano + morte (o estado já mudou quando o evento sai)
    teresa.hp = 0;
    t.eq(M.logEntry(B, { t: 'damage', unitId: teresa.id, attackerId: al.id, dmgType: 'HE', cause: 'grenade', amount: 40, wounds: 0, vis: true, pos: BM.idx(m, 2, 2, 0) }, ctx), null, 'dano mortal: só a morte entra');
    const e = M.logEntry(B, { t: 'death', unitId: teresa.id, killerId: al.id, cause: 'grenade', i: BM.idx(m, 2, 2, 0), vis: true, pos: BM.idx(m, 2, 2, 0) }, ctx);
    t.ok(e && e.own && e.kind === 'bad', 'baixa nossa');
    const txt = OV.T(e.key, e.params);
    t.ok(/Teresa Carvalho foi morta em combate/.test(txt) && /explosão/.test(txt) && /atacante não visto/.test(txt), txt);
    t.eq(e.from, -1, 'atacante nunca visto: «Mostrar» vai para a vítima');
    // tiro visto: o atacante fica com nome e posição
    const shotEv = { t: 'shot', shooterId: al.id, vis: true, pos: BM.idx(m, 8, 8, 0) };
    const vis0 = OV.LOS.isVisibleTo;
    OV.LOS.isVisibleTo = (Bx, side, u) => (u === al ? true : vis0(Bx, side, u));
    let h;
    try {
      M.logEntry(B, shotEv, ctx);
      h = M.logEntry(B, { t: 'damage', unitId: rui.id, attackerId: al.id, dmgType: 'PLASMA', cause: 'shot', amount: 7, wounds: 1, vis: true, pos: BM.idx(m, 4, 2, 0) }, ctx);
    } finally {
      OV.LOS.isVisibleTo = vis0;
    }
    const ht = OV.T(h.key, h.params);
    t.ok(/Rui Lopes ficou ferido: −7 de saúde e uma ferida a sangrar/.test(ht) && /tiro de/.test(ht) && ht.indexOf(OV.T(al.nameKey)) >= 0, ht);
    t.eq(h.from, BM.idx(m, 8, 8, 0), 'posição de onde o atacante disparou');
    t.eq(M.logEntry(B, { t: 'morale', kind: 'change', unitId: rui.id }, ctx), null, 'variações de moral não entram');
    const fr = M.logEntry(B, { t: 'morale', kind: 'freeze', unitId: teresa.id, pos: 0 }, ctx);
    t.ok(/paralisada/.test(OV.T(fr.key, fr.params)), 'pânico no feminino');
  });

  t.test('persona r1: auto-equipar só dá o que serve (investigado, com munição, dentro da Força)', () => {
    const auto = OV.InventoryUI.model.autoLoadout;
    const sol = (id, str, hp) => ({ id, stats: { str, hp: hp || 30 } });
    const W = (lo) => [lo.R, lo.L, ...lo.belt, ...lo.pack].filter(Boolean).reduce((s, t2) => s + (OV.Data.items[t2].weight | 0), 0);
    // pistola de plasma por investigar: fica no armazém; espingarda e carregadores no cinto
    let st = { plasma_pistol: 1, plasma_pistol_clip: 2, rifle: 1, rifle_clip: 4, grenade: 4 };
    let lo = auto(sol('a', 30), st, { researched: [] });
    t.eq(lo.R, 'rifle', 'arma investigada');
    t.eq(lo.belt.filter((x) => x === 'rifle_clip').length, 2, '2 carregadores');
    t.eq(st.plasma_pistol, 1, 'a arma por investigar não sai do armazém');
    t.ok(W(lo) <= 30, 'peso dentro da Força: ' + W(lo));
    // lança-foguetes: os foguetes (tamanho 3) vão para a mochila
    st = { rocket_launcher: 1, small_rocket: 4 };
    lo = auto(sol('b', 40), st, { researched: [] });
    t.eq(lo.R, 'rocket_launcher');
    t.ok(lo.pack.indexOf('small_rocket') >= 0, 'foguete na mochila: ' + JSON.stringify(lo));
    // sem munição para o lança-foguetes: não o leva
    st = { rocket_launcher: 1, pistol: 1, pistol_clip: 2 };
    lo = auto(sol('c', 40), st, { researched: [] });
    t.eq(lo.R, 'pistol', 'arma sem munição fica');
    // Canhão Pesado acima da Força de um recruta fraco: pistola
    st = { heavy_cannon: 1, hc_ap: 2, pistol: 1, pistol_clip: 2 };
    const squad = [sol('w', 20), sol('s1', 40), sol('s2', 38), sol('s3', 36)];
    lo = auto(squad[0], st, { researched: [], squad });
    t.eq(lo.R, 'pistol', 'fraco: arma leve');
    t.ok(W(lo) <= 20, 'peso ' + W(lo) + ' ≤ 20');
    lo = auto(squad[1], st, { researched: [], squad });
    t.eq(lo.R, 'heavy_cannon', 'o mais forte leva a arma pesada');
    t.ok(W(lo) <= 40, 'peso ' + W(lo) + ' ≤ 40');
    // investigada: a pistola de plasma passa a contar
    st = { plasma_pistol: 1, plasma_pistol_clip: 2 };
    lo = auto(sol('d', 25), st, { researched: ['plasma_pistol'] });
    t.eq(lo.R, 'plasma_pistol');
  });

  t.test('persona r1: pinça do iPad — deslizar com dois dedos não mexe no zoom; afastar os dedos sim', () => {
    const handlers = {};
    const queue = [];
    const g = globalThis;
    const saved = { requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame, window: g.window, document: g.document, performance: g.performance };
    g.requestAnimationFrame = (f) => { queue.push(f); return queue.length; };
    g.cancelAnimationFrame = () => {};
    g.window = { addEventListener() {} };
    g.document = { addEventListener() {} };
    const canvas = { addEventListener: (k, f) => { handlers[k] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), setPointerCapture() {} };
    const evs = [];
    try {
      const I0 = OV.Input;
      load('js/ui/input.js');
      const I = OV.Input;
      I.attach(canvas, (e) => { evs.push(e); return true; });
      const pe = (type, id, x, y) => handlers[type]({ pointerType: 'touch', pointerId: id, clientX: x, clientY: y, button: 0, preventDefault() {} });
      const flush = () => { while (queue.length) queue.shift()(0); };
      pe('pointerdown', 1, 300, 300);
      pe('pointerdown', 2, 500, 300);
      // deslizar: um dedo de cada vez (como o Safari envia), 10 vezes
      for (let k = 1; k <= 10; k++) {
        pe('pointermove', 1, 300 + k * 12, 300 + k * 5);
        flush();
        pe('pointermove', 2, 500 + k * 12, 300 + k * 5);
        flush();
      }
      t.eq(evs.filter((e) => e.kind === 'zoom').length, 0, 'sem zoom ao deslizar');
      t.ok(evs.filter((e) => e.kind === 'pan').length > 0, 'deslizar desloca a câmara');
      // afastar os dedos de 200 para 320 px: zoom (fator total = 1.6)
      for (let k = 1; k <= 6; k++) {
        pe('pointermove', 1, 420 - k * 10, 350);
        pe('pointermove', 2, 620 + k * 10, 350);
        flush();
      }
      const z = evs.filter((e) => e.kind === 'zoom').reduce((p, e) => p * e.factor, 1);
      t.near(z, 1.6, 0.01, 'fator de zoom');
      pe('pointerup', 1, 360, 350);
      pe('pointerup', 2, 680, 350);
      OV.Input = I0 || I;
    } finally {
      Object.assign(g, saved);
    }
  });
};
