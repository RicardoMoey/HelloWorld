/* Ronda de personas 4 — ecrãs: «Mês» recomendado para Base Alienígena e Cidónia na Batalha Rápida, civis mortos
   pela X-COM no relatório, fogo amigo de um atirador que morreu depois (foguete = explosão), texto do OVNI aterrado,
   ↑/↓/PageDown no briefing (também o da campanha) e opções sem rato no iPad. Carrega js/ui/screens.js em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.monthWarn) vm.runInThisContext(read('js/ui/screens.js'), { filename: 'screens.js' });
  const SC = OV.Screens;
  const has = (k) => typeof OV.STR[k] === 'string';
  // DOM mínimo para lossNotes (reposto no fim de cada teste)
  const mk = (tag, attrs, ...kids) => {
    const n = { tag, cls: (attrs && attrs.class) || '', text: (attrs && attrs.text) || '', kids: [] };
    for (const k of kids.flat()) if (k !== null && k !== undefined) n.kids.push(k);
    return n;
  };
  const flat = (n) => (typeof n === 'string' ? n : n.text + n.kids.map(flat).join(''));
  function withDom(fn) {
    const prev = OV.Dom;
    OV.Dom = Object.assign({}, prev || {}, { el: mk });
    try { return fn(); } finally { OV.Dom = prev; }
  }

  // ---- 1. Batalha Rápida: Cidónia/Base Alienígena com espingardas ---------------------------------------------------
  t.test('ecrãs r4: Cidónia e Base Alienígena abaixo do «Mês» recomendado mostram um aviso', () => {
    t.eq(SC.MONTH_MIN, { alienBase: 2, cydonia: 4 });
    const w = SC.monthWarn({ kind: 'cydonia', month: 0 });
    t.ok(w && /Espingardas/.test(w) && /Cidónia/.test(w) && /Mês 4/.test(w), 'aviso: ' + w);
    t.eq(SC.monthWarn({ kind: 'cydonia', month: 4 }), null, 'mês 4: sem aviso');
    t.ok(SC.monthWarn({ kind: 'alienBase', month: 1 }), 'base alienígena no mês 1');
    t.eq(SC.monthWarn({ kind: 'alienBase', month: 2 }), null);
    for (const k of ['crash', 'landed', 'terror']) t.eq(SC.monthWarn({ kind: k, month: 0 }), null, k + ': sem aviso');
    for (const k of ['scr.qb.month.auto', 'scr.qb.warn.month']) t.ok(has(k), k);
  });
  t.test('ecrãs r4: escolher Cidónia sobe o «Mês» para 4 (Base Alienígena para 2); o jogador pode voltar a baixá-lo', () => {
    const src = read('js/ui/screens.js');
    t.ok(/if \(k === 'kind' && \(q\.month \| 0\) < \(MONTH_MIN\[v\] \| 0\)\) \{ q\.month = MONTH_MIN\[v\]; bumped = true; \}/.test(src), 'set(): só ao mudar a missão');
    t.ok(/const w = monthWarn\(q\); monthWarnEl\.textContent = w \|\| ''; monthWarnEl\.classList\.toggle\('hidden', !w\);/.test(src), 'aviso por baixo do «Mês»');
    t.ok(/row\(T\('scr\.qb\.month'\), cMonth, el\('div', null, monthNote, monthWarnEl\)\)/.test(src), 'na linha do «Mês»');
    // o kit do mês 4 em Cidónia é de plasma/Blaster (o que o aviso recomenda)
    const { mission } = SC.buildQuickMission({ kind: 'cydonia', month: 4, seed: 5, squad: 8 });
    t.ok(mission.squad.every((s) => s.loadout.R === 'heavy_plasma' || s.loadout.R === 'blaster_launcher'), 'mês 4: plasma pesado e Blaster');
  });

  // ---- 2. civis mortos pela X-COM ------------------------------------------------------------------------------------
  function terrorB(civ) {
    const units = [
      { id: 1, name: 'Ana Sousa', origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 2, name: 'Rui Lopes', origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 3, origSide: 'alien', type: 'floater_soldier', status: 'dead' },
    ];
    for (let k = 0; k < 6; k++) units.push({ id: 10 + k, origSide: 'civ', type: 'civilian_m', status: k < civ ? 'dead' : 'ok', killedBy: k < civ ? 1 : null });
    return { units, items: [], brought: { blaster_launcher: 1 }, stats: { civKilledByXcom: civ }, mission: { kind: 'terror', race: 'floater', month: 4, seed: 1, difficulty: 0 } };
  }
  t.test('ecrãs r4: numa vitória de terror com civis mortos pelas armas da X-COM, o relatório diz porquê e dá a dica', () => {
    const B = terrorB(4);
    t.eq(SC.lossCauses(B).civ, 4);
    withDom(() => {
      const notes = SC.lossNotes(B, 'win', { debrief: { lines: [{ key: 'bs.debrief.civKilledByXcom', n: 4, points: -200 }] } });
      const cause = notes.find((n) => /scr-cause/.test(n.cls));
      t.ok(cause && flat(cause) === '4 civis mortos pelas armas da X-COM (−200 pontos).', 'causa: ' + (cause && flat(cause)));
      const tip = notes.find((n) => /scr-tip/.test(n.cls));
      t.ok(tip && /^Dica:/.test(flat(tip)) && /50 pontos/.test(flat(tip)) && /Blaster/.test(flat(tip)), 'dica: ' + (tip && flat(tip)));
      t.ok(tip && !/costly/.test(tip.cls), 'não é uma «vitória cara» (ninguém da equipa morreu)');
      // sem a linha do relatório (campanha): a mesma conta do motor (valor 30 + 2 × 10 = 50 por civil)
      const one = SC.lossNotes(terrorB(1), 'win').find((n) => /scr-cause/.test(n.cls));
      t.eq(flat(one), '1 civil morto pelas armas da X-COM (−50 pontos).');
      t.eq(SC.lossNotes(terrorB(0), 'win').length, 0, 'sem civis mortos: nada');
    });
  });

  // ---- 3. fogo amigo de um atirador já morto -----------------------------------------------------------------------
  function ffDead(o) {
    const units = [
      { id: 1, name: 'Julie Gauthier', origSide: 'xcom', type: 'soldier', soldierId: 's1', status: 'dead', killedBy: 2, deathCause: 'shot', deathDmg: o.dmg },
      // o atirador morreu depois: killUnit → dropAll esvaziou-lhe as mãos
      { id: 2, name: 'Daniel Gauthier', origSide: 'xcom', type: 'soldier', soldierId: 's2', status: 'dead', killedBy: 9, deathCause: 'shot', items: { R: null, L: null } },
      { id: 3, name: 'Ana Sousa', origSide: 'xcom', type: 'soldier', soldierId: 's3', status: 'ok' },
      { id: 9, origSide: 'alien', type: 'ethereal_soldier', status: 'ok' },
    ];
    const squad = [
      { soldierId: 's1', loadout: { R: 'rifle', belt: ['rifle_clip'], pack: [] } },
      { soldierId: 's2', loadout: { R: o.gun || 'rocket_launcher', belt: o.belt || ['grenade'], pack: o.pack || ['small_rocket', 'small_rocket'] } },
      { soldierId: 's3', loadout: { R: 'rifle', belt: ['rifle_clip'], pack: [] } },
    ];
    return { units, items: [{ id: 70, type: o.gun || 'rocket_launcher', owner: null, at: 5 }], brought: { rifle: 2, rocket_launcher: 1 }, mission: { kind: 'cydonia', race: 'ethereal', month: 0, seed: 1, difficulty: 0, squad } };
  }
  t.test('ecrãs r4: morte por foguete de um colega que morreu antes do fim conta como explosão', () => {
    const c = SC.lossCauses(ffDead({}));
    t.eq(c.ff.length, 1);
    t.eq(c.ff[0].how, 'blast', 'o lança-foguetes com que partiu (já largado)');
    t.eq(c.tip === 'scr.db.tip.friendly' || c.tip === 'scr.db.tip.outnumbered' || c.tip === 'scr.db.tip.weapons', true, 'não é a dica dos tiros: ' + c.tip);
    t.eq(SC.lossCauses(ffDead({ gun: 'rifle', belt: ['rifle_clip'], pack: [] })).ff[0].how, 'shot', 'partiu com espingarda: tiro');
    t.eq(SC.lossCauses(ffDead({ gun: 'heavy_cannon', belt: ['hc_ap', 'hc_he'], pack: [] })).ff[0].how, 'shot', 'canhão com AP e HE: sem saber a munição, tiro');
    // quando o motor guarda o tipo de dano do golpe fatal, é esse que decide
    t.eq(SC.lossCauses(ffDead({ dmg: 'HE', gun: 'rifle', belt: ['rifle_clip'], pack: [] })).ff[0].how, 'blast', 'deathDmg HE');
    t.eq(SC.lossCauses(ffDead({ dmg: 'LASER' })).ff[0].how, 'shot', 'deathDmg LASER');
    // B real (Battle.create): B.mission não guarda a equipa — o relatório passa a missão, ou contam as armas no cadáver
    const real = ffDead({});
    const squad = real.mission.squad;
    delete real.mission.squad;
    t.eq(SC.lossCauses(real, { mission: { squad } }).ff[0].how, 'blast', 'com a missão do relatório');
    real.items.push({ id: 80, type: 'xcom_corpse', unitId: 2, owner: null, at: 5 });
    t.eq(SC.lossCauses(real).ff[0].how, 'blast', 'sem a missão: o lança-foguetes largado junto ao cadáver');
    real.items[0].at = 9;
    t.eq(SC.lossCauses(real).ff[0].how, 'shot', 'arma noutro tile: não é dele');
    withDom(() => {
      const cause = SC.lossNotes(ffDead({}), 'loss').find((n) => /scr-cause/.test(n.cls));
      t.ok(cause && /Julie Gauthier ← explosão de Daniel Gauthier/.test(flat(cause)), flat(cause || { text: '', kids: [] }));
    });
  });

  // ---- 4. briefing do OVNI aterrado ----------------------------------------------------------------------------------
  t.test('ecrãs r4: o briefing do OVNI aterrado já não promete pontos que o relatório não dá', () => {
    const s = OV.STR['scr.br.obj.landed.2'];
    t.ok(!/pontos/.test(s), s);
    t.ok(/material/.test(s) && /ligas/.test(s) && /fontes de energia/.test(s), s);
  });

  // ---- 5. teclado no briefing ------------------------------------------------------------------------------------------
  t.test('ecrãs r4: ↑/↓/PageDown/Fim deslocam o corpo do briefing com o foco em «Iniciar missão» (qualquer cena com .scr-brief-body)', () => {
    const prevDoc = globalThis.document;
    globalThis.document = { activeElement: null };
    try {
      const box = { scrollHeight: 800, clientHeight: 300, scrollTop: 0, scrollBy(o) { this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, this.scrollTop + o.top)); } };
      const asked = [];
      const root = { querySelector(sel) { asked.push(sel); return sel === '.scr-brief-body' ? box : null; }, contains: () => false, classList: { add() {}, remove() {} } };
      // a cena da campanha (cbriefing) não declara spec.scroll: vale o corpo do briefing por omissão
      const sc = SC.ui.makeScreen('cbriefing', { build() {}, keys: (ev) => ev.key === 'Enter' });
      sc.root = root;
      t.eq(sc.onInput({ kind: 'key', key: 'ArrowDown' }), true, '↓ tratado');
      t.eq(box.scrollTop, 60);
      t.eq(sc.onInput({ kind: 'key', key: 'PageDown' }), true);
      t.eq(box.scrollTop, 300);
      t.eq(sc.onInput({ kind: 'key', key: 'End' }), true);
      t.eq(box.scrollTop, 800);
      t.eq(sc.onInput({ kind: 'key', key: 'Home' }), true);
      t.eq(box.scrollTop, 0);
      t.eq(sc.onInput({ kind: 'key', key: 'Enter' }), true, 'as teclas da cena vêm primeiro');
      t.ok(asked.indexOf('.scr-brief-body') >= 0);
      // corpo que cabe (ecrã grande): ↓ não é engolido
      box.scrollHeight = 300;
      t.eq(sc.onInput({ kind: 'key', key: 'ArrowDown' }), false);
      // cenas com spec.scroll: false ficam como estavam
      const off = SC.ui.makeScreen('x', { build() {}, scroll: false });
      off.root = root;
      box.scrollHeight = 800;
      t.eq(off.onInput({ kind: 'key', key: 'ArrowDown' }), false);
    } finally {
      if (prevDoc === undefined) delete globalThis.document;
      else globalThis.document = prevDoc;
    }
    t.ok(/↑ ↓ deslocam/.test(OV.STR['scr.br.hint']), 'o rodapé do briefing anuncia as setas');
  });

  // ---- 6. opções e etiquetas no iPad -----------------------------------------------------------------------------------
  t.test('ecrãs r4: no iPad as opções do rato desaparecem, a dica fala de toques e a etiqueta do toque longo não mostra teclas', () => {
    const src = read('js/ui/screens.js');
    t.ok(/mouseLess\(\) \? null : optRow\(T\('scr\.opt\.edgeScroll'\)/.test(src), 'margens do ecrã só com rato');
    t.ok(/mouseLess\(\) \? null : optRow\(T\('scr\.opt\.wheel'\)/.test(src), 'roda do rato só com rato');
    t.ok(/TT\('scr\.opt\.confirmBlast\.hint'\)/.test(src), 'dica com variante de toque');
    t.ok(/2\.º toque/.test(OV.STR['scr.opt.confirmBlast.hint.touch']), OV.STR['scr.opt.confirmBlast.hint.touch']);
    const css = read('css/screens.css');
    t.ok(/@media \(hover: none\) \{ \.lp-tip \.key, \.lp-tip kbd \{ display: none; \} \}/.test(css), '.lp-tip .key escondido sem pairar');
  });
};
