/* Ronda 4 de personas — integração: pendentes que cruzavam ficheiros de vários donos. Civis contados à parte no raio
   da explosão, u.deathDmg (o tipo de dano do golpe fatal) no motor, dica do pânico e nota da vitória pelo objetivo no
   relatório, alienígenas rendidos na contenção da campanha, opções do combate sem rato no iPad, ↑ ↓ no rodapé do
   briefing da campanha, radiogroup da velocidade com tabindex móvel, velocidade da espera pelo dia reposta depois de
   um alerta e textos do toque longo. O comportamento no navegador está em qa/integration_r4.mjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.lossNotes) vm.runInThisContext(read('js/ui/screens.js'), { filename: 'screens.js' });
  const SC = OV.Screens;
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const stats = { tu: 60, sta: 60, hp: 30, brav: 40, react: 40, fire: 50, thr: 50, str: 40, melee: 30, psiStr: 30, psiSkill: 0 };
  // DOM mínimo para lossNotes (reposto no fim)
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
  function battle(seed) {
    const B = { map: OV.BMap.create(8, 8, 1), units: [], items: [], nextId: 1, turn: 1, side: 'xcom', pendingBerserk: [], mission: { kind: 'crash', difficulty: 0 }, rng: OV.RNG.streams(seed || 5) };
    OV.Battle.rebuildDerived(B);
    return B;
  }
  function soldierAt(B, x, y, name) {
    const u = OV.BUnits.fromSoldier(B, { soldierId: 's' + name, name, nat: 'pt', rank: 0, armour: 'coveralls', stats }, { R: null, L: null, belt: [], pack: [] });
    OV.BUnits.placeUnit(B, u, x + y * B.map.w);
    return u;
  }

  // ---- 1. civis à parte no raio da explosão --------------------------------------------------------------------
  t.test('r4 integração: o raio da explosão conta os civis à parte dos aliados (textos .who)', () => {
    const src = read('js/ui/battle_ui.js');
    t.ok(/if \(f\.origSide === 'civ' \|\| f\.side === 'civ'\) civ\+\+;/.test(src), 'blastPreview conta os civis');
    t.ok(/return \{ x, y, z, r, smoke, risk, civ \};/.test(src), 'blastPreview devolve civ');
    t.eq((src.match(/blastRiskText\('hud\.(throw\.risk|confirmBlast\.' \+ confirmVia\(\))'?, /g) || []).length, 4, 'os 4 textos de risco usam blastRiskText');
    t.ok(!/Tn\('hud\.throw\.risk'/.test(src) && !/Tn\('hud\.confirmBlast\./.test(src), 'nenhum texto de risco fica só com «aliados»');
    for (const k of ['hud.throw.risk.who', 'hud.confirmBlast.click.who', 'hud.confirmBlast.tap.who', 'hud.confirmBlast.key.who', 'hud.blast.ally.one', 'hud.blast.ally.other', 'hud.blast.civ.one', 'hud.blast.civ.other', 'hud.blast.and']) t.ok(has(k), k);
    // a composição que blastWho faz: «2 aliados e 1 civil», «1 civil»
    const who = (s, c) => {
      const parts = [];
      if (s > 0) parts.push(OV.Tn('hud.blast.ally', s));
      if (c > 0) parts.push(OV.Tn('hud.blast.civ', c));
      return parts.length > 1 ? OV.T('hud.blast.and', { a: parts[0], b: parts[1] }) : parts[0];
    };
    t.eq(OV.T('hud.throw.risk.who', { who: who(2, 1) }), 'Risco: 2 aliados e 1 civil no raio da explosão');
    t.eq(OV.T('hud.confirmBlast.click.who', { who: who(0, 3) }), 'Clique outra vez para disparar — atinge 3 civis');
    t.eq(OV.Tn('hud.throw.risk', 2, { n: 2 }), 'Risco: 2 aliados no raio da explosão', 'sem civis: o texto de sempre');
  });

  // ---- 2. u.deathDmg -----------------------------------------------------------------------------------------------
  t.test('r4 integração: killUnit guarda o tipo de dano do golpe fatal (u.deathDmg)', () => {
    const B = battle(7);
    const a = soldierAt(B, 2, 2, 'A');
    const b = soldierAt(B, 5, 5, 'B');
    OV.Battle.rebuildDerived(B);
    OV.Combat.damageUnit(B, a, 500, 'HE', 0, 1, b.id, { cause: 'shot' });
    t.eq(a.status, 'dead');
    t.eq([a.deathCause, a.deathDmg], ['shot', 'HE'], 'foguete: causa «shot», dano HE');
    const c = soldierAt(B, 6, 1, 'C');
    OV.Battle.rebuildDerived(B);
    OV.Combat.damageUnit(B, c, 500, 'LASER', 0, 1, b.id, { cause: 'shot' });
    t.eq(c.deathDmg, 'LASER');
    const d = soldierAt(B, 1, 6, 'D');
    OV.Battle.rebuildDerived(B);
    OV.Combat.killUnit(B, d, null, 'wounds');
    t.eq([d.deathCause, d.deathDmg], ['wounds', null], 'sangrar: sem tipo de dano');
    // o relatório usa-o: o foguete de um colega é explosão, o laser é tiro
    const units = [
      { id: 1, name: 'V', origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 2, deathCause: 'shot', deathDmg: 'HE' },
      { id: 2, name: 'K', origSide: 'xcom', type: 'soldier', status: 'ok', items: { R: null, L: null } },
    ];
    t.eq(SC.lossCauses({ units, items: [], mission: { difficulty: 1 } }).ff[0].how, 'blast');
    units[0].deathDmg = 'LASER';
    t.eq(SC.lossCauses({ units, items: [], mission: { difficulty: 1 } }).ff[0].how, 'shot');
  });

  // ---- 3. dica do pânico e nota do objetivo -------------------------------------------------------------------------
  function deb(o) {
    const units = [
      { id: 1, name: 'Ana', origSide: 'xcom', type: 'soldier', status: o.dead ? 'dead' : 'ok', killedBy: o.dead ? 9 : null },
      { id: 2, name: 'Rui', origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 3, name: 'Eva', origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 4, name: 'Luís', origSide: 'xcom', type: 'soldier', status: 'ok' },
      { id: 9, origSide: 'alien', type: 'sectoid_soldier', status: 'ok' },
    ];
    return { units, items: [], brought: { rifle: 4 }, stats: { xcomPanics: o.panics | 0, civKilledByXcom: 0 }, mission: { kind: 'crash', race: 'sectoid', month: 0, difficulty: 0 } };
  }
  t.test('r4 integração: 2+ episódios de pânico dão a dica do oficial (1.ª dica, ou a 2.ª)', () => {
    t.ok(has('scr.db.tip.panic') && /oficial/.test(OV.T('scr.db.tip.panic')) && /ao mesmo tempo/.test(OV.T('scr.db.tip.panic')), 'texto');
    t.eq(SC.lossCauses(deb({ panics: 1, dead: true })).tip2, null, '1 episódio: nada');
    const c = SC.lossCauses(deb({ panics: 3, dead: true }));
    t.eq([c.panics, c.tip, c.tip2], [3, 'scr.db.tip.enemy', 'scr.db.tip.panic'], 'derrota com mortos: 2.ª dica');
    t.eq(SC.lossCauses(deb({ panics: 2 })).tip, 'scr.db.tip.panic', 'sem mortos: a dica é a do pânico');
    const notes = withDom(() => SC.lossNotes(deb({ panics: 2, dead: true }), 'loss'));
    const tip = notes.find((n) => /scr-tip/.test(n.cls));
    t.ok(tip && flat(tip).indexOf(OV.T('scr.db.tip.panic')) > 0, 'a derrota mostra a dica do pânico');
  });
  t.test('r4 integração: vitória pelo objetivo (centro de controlo) explica-se no relatório', () => {
    t.ok(has('scr.db.objective') && /Centro de controlo destruído/.test(OV.T('scr.db.objective')));
    const win = withDom(() => SC.lossNotes(deb({}), 'win', { debrief: { objective: true, lines: [] } }));
    const n = win.find((x) => /scr-cause good/.test(x.cls));
    t.ok(n && flat(n) === OV.T('scr.db.objective'), 'nota «Centro de controlo destruído…»');
    t.eq(withDom(() => SC.lossNotes(deb({}), 'win', { debrief: { objective: false, lines: [] } })).length, 0, 'vitória normal: nada');
    t.eq(withDom(() => SC.lossNotes(deb({}), 'loss', { debrief: { objective: true, lines: [] } })).filter((x) => /good/.test(x.cls)).length, 0, 'derrota: nunca');
    const cui = read('js/ui/campaign_ui.js');
    t.ok(cui.indexOf("OV.Screens.lossNotes(B, result, { campaign: true, debrief: deb })") >= 0, 'a campanha passa o debrief (objetivo e pontos dos civis)');
    t.ok(/\.scr-cause\.good::before \{ content: '✓ '; \}/.test(read('css/screens.css')), 'nota boa com ✓ (não ⚠)');
  });

  // ---- 4. alienígenas que se renderam -------------------------------------------------------------------------------
  t.test('r4 integração: a contenção separa os alienígenas que se renderam ao tomar a base', () => {
    t.ok(has('cp.db.surrendered') && /rendeu-se/.test(OV.T('cp.db.surrendered')));
    const cui = read('js/ui/campaign_ui.js');
    t.ok(/const n = model\.capturedStored\[ty\] - \(sur\[ty\] \| 0\);/.test(cui), 'capturados − rendidos na linha «para a contenção»');
    t.ok(/T\('cp\.db\.surrendered', \{ name: unitName\(ty\), n: sur\[ty\], base: baseName\(base\) \}\)/.test(cui), 'linha própria dos rendidos');
    t.ok(/surrendered/.test(read('js/sim/campaign.js')), 'o motor devolve surrendered');
  });

  // ---- 5. iPad, briefing, Geoscape, textos de toque ------------------------------------------------------------------
  t.test('r4 integração: opções do combate sem roda/margens no iPad; rodapé do briefing com ↑ ↓', () => {
    const src = read('js/ui/battle_ui.js');
    t.ok(/mouseLess \? null : row\(T\('hud\.opt\.wheel'\)/.test(src) && /mouseLess \? null : crow\(T\('hud\.opt\.edgeScroll'\)/.test(src), 'linhas só com rato');
    t.ok(/↑ ↓/.test(OV.T('cp.br.hint')) && /↑ ↓/.test(OV.T('cp.br.hint.night')), 'cp.br.hint menciona as setas');
    t.ok(/mantenha o dedo/.test(OV.T('base.equip.hint.touch')) && /mantenha o dedo/.test(OV.T('cp.eq.hint.touch')), 'toque longo nos textos');
  });
  t.test('r4 integração: velocidade do Geoscape com tabindex móvel e a espera pelo dia reposta depois de um alerta', () => {
    const src = read('js/ui/geo_ui.js');
    t.ok(/b\.tabIndex = i === clk\.speed \? 0 : -1;/.test(src), 'só a velocidade atual é paragem de Tab');
    t.ok(/speedBox\.addEventListener\('keydown'/.test(src), 'setas no radiogroup');
    t.ok(/r\.reason === 'event' && sp0 > 0 && waitPending\(\)\) S\.waitResume = sp0;/.test(src), 'alerta durante a espera guarda a velocidade');
    t.ok(/if \(S\.waitResume\) resumeWait\(\);/.test(src), 'e repõe-na quando as janelas fecham');
    t.ok(has('geo.toast.waitDay.resume'), 'toast da reposição');
  });
};
