/* Ronda de personas 3 — ecrãs: kit inicial da Batalha Rápida dentro da Força (mês 4 e noite), Enter com o foco em
   «Aleatória», fogo amigo a tiro/explosão/reação no relatório, dica numa vitória cara e caminho por formas (●/○/✕)
   em «Como Jogar». Carrega js/ui/screens.js em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.trimToStr) vm.runInThisContext(read('js/ui/screens.js'), { filename: 'screens.js' });
  const SC = OV.Screens, D = OV.Data;
  const has = (k) => typeof OV.STR[k] === 'string';
  const items = (l) => [l.R, l.L].concat(l.belt || [], l.pack || []).filter(Boolean);
  const weight = (l) => items(l).reduce((w, id) => w + (D.items[id].weight | 0), 0);
  const count = (list) => list.reduce((m, id) => { m[id] = (m[id] | 0) + 1; return m; }, {});

  // ---- kit inicial ----------------------------------------------------------------------------------------------
  t.test('ecrãs r3: o kit inicial da Batalha Rápida respeita a Força em todos os meses, de dia e de noite', () => {
    let checked = 0, trimmed = 0;
    for (const month of [0, 1, 2, 3, 4]) {
      for (const time of ['day', 'night']) {
        for (const seed of [10, 91277, 3, 41, 777, 12345]) {
          const kind = seed % 2 ? 'terror' : 'landed';
          const { mission } = SC.buildQuickMission({ kind, ufo: 'battleship', month, time, seed, squad: 10, diff: 2 });
          for (const s of mission.squad) {
            const gd = D.items[s.loadout.R];
            const floor = (gd.weight | 0) + (Array.isArray(gd.ammo) && gd.ammo.length ? Math.min(...gd.ammo.map((a) => D.items[a].weight | 0)) : 0);
            const w = weight(s.loadout);
            t.ok(w <= s.stats.str || w <= floor, 'mês ' + month + ' ' + time + ' semente ' + seed + ': ' + s.name + ' ' + w + '/' + s.stats.str);
            if (time === 'night') t.ok(items(s.loadout).indexOf('electro_flare') >= 0, s.name + ': de noite ainda leva um sinalizador');
            checked++;
          }
          if (mission.craftItems.high_explosive > 0 || (time === 'night' && mission.craftItems.electro_flare > 4)) trimmed++;
        }
      }
    }
    t.ok(checked >= 500, 'soldados verificados: ' + checked);
    t.ok(trimmed > 0, 'há missões em que os extras passaram para a nave: ' + trimmed);
  });
  t.test('ecrãs r3: trimToStr devolve os extras ao armazém pela ordem certa e guarda arma + 1 carregador', () => {
    const s = { stats: { str: 22 }, loadout: { R: 'heavy_plasma', L: null, belt: ['heavy_plasma_clip', 'heavy_plasma_clip', 'electro_flare', 'high_explosive'], pack: ['electro_flare'] } };
    const store = {};
    t.eq(SC.trimToStr(s, store), ['high_explosive'], 'o explosivo sai primeiro e chega (26 → 20)');
    t.eq(store, { high_explosive: 1 });
    t.eq(weight(s.loadout), 20);
    // Força mínima: tudo o que é extra sai, ficam a arma e um carregador
    const w = { stats: { str: 5 }, loadout: { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip', 'grenade', 'electro_flare'], pack: ['electro_flare', 'smoke_grenade'] } };
    const st2 = {};
    const before = count(items(w.loadout));
    SC.trimToStr(w, st2);
    t.eq(items(w.loadout), ['rifle', 'rifle_clip'], 'só a arma e um carregador');
    const after = count(items(w.loadout));
    for (const id of Object.keys(before)) t.eq((after[id] | 0) + (st2[id] | 0), before[id], id + ': nada se perde');
    const ok = { stats: { str: 40 }, loadout: { R: 'rifle', L: null, belt: ['rifle_clip', 'grenade'], pack: ['electro_flare'] } };
    t.eq(SC.trimToStr(ok, {}), [], 'dentro da Força não mexe');
  });
  t.test('ecrãs r3: os casos da ronda 3 (mês 4 de noite; terror de noite no mês 0) sem excesso de peso', () => {
    const { mission } = SC.buildQuickMission({ kind: 'landed', ufo: 'battleship', month: 4, time: 'night', seed: 10, squad: 10, diff: 2 });
    t.eq(mission.squad.filter((s) => weight(s.loadout) > s.stats.str).map((s) => s.name), []);
    const night0 = SC.buildQuickMission({ kind: 'terror', month: 0, time: 'night', seed: 91277, squad: 8, diff: 0 });
    t.eq(night0.mission.squad.filter((s) => weight(s.loadout) > s.stats.str).map((s) => s.name), [], 'Local de Terror de noite, mês 0');
  });

  // ---- Enter na Batalha Rápida ------------------------------------------------------------------------------------
  t.test('ecrãs r3: Enter começa também com o foco em «Aleatória» (não volta a sortear)', () => {
    const src = read('js/ui/screens.js');
    t.ok(/a === startBtn \|\| a === reroll \|\| \(a\.classList && a\.classList\.contains\('scr-seg-b'\)\)\) \{ start\(\); return true; \}/.test(src), 'keys(): Enter com o foco em reroll');
    t.ok(/\n {8}reroll = el\('button'/.test(src), 'reroll é a variável da cena (não uma const local)');
  });

  // ---- relatório -------------------------------------------------------------------------------------------------
  function ffB(o) {
    const units = [
      { id: 1, name: 'Meera Nair', origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 2, deathCause: 'shot', deathSide: o.side || null },
      { id: 2, name: 'Matthew Nguyen', origSide: 'xcom', type: 'soldier', status: 'ok', items: { R: 50, L: null } },
      { id: 3, name: 'Ana Sousa', origSide: 'xcom', type: 'soldier', status: o.dead3 ? 'dead' : 'ok', killedBy: o.dead3 ? 9 : null },
      { id: 4, name: 'Rui Lopes', origSide: 'xcom', type: 'soldier', status: 'ok' },
    ];
    for (let k = 0; k < (o.aliens || 2); k++) units.push({ id: 9 + k, origSide: 'alien', type: 'sectoid_soldier', status: 'dead' });
    const its = [{ id: 50, type: o.gun || 'rifle', owner: 2, ammo: o.ammo === null ? null : { type: o.ammo || 'rifle_clip', rounds: 3 } }];
    return { units, items: its, brought: o.brought || { rifle: 4, rifle_clip: 8 }, mission: { kind: 'crash', race: 'sectoid', month: 0, seed: 1, difficulty: o.diff || 0 } };
  }
  t.test('ecrãs r3: fogo amigo a tiro (reação) dá a dica da linha de fogo e diz quem atingiu quem', () => {
    const c = SC.lossCauses(ffB({ side: 'alien' }));
    t.eq(c.friendly, 1);
    t.eq(c.ff, [{ victim: 'Meera Nair', killer: 'Matthew Nguyen', how: 'shot', reaction: true }]);
    t.eq(c.tip, 'scr.db.tip.friendly.shot', 'tiro de espingarda: não é a dica dos explosivos');
    t.eq(SC.lossCauses(ffB({ side: 'xcom' })).ff[0].reaction, false, 'no próprio turno não é reação');
    t.eq(SC.lossCauses(ffB({})).ff[0].reaction, false, 'sem deathSide do motor: não inventa reação');
    t.eq(OV.T('scr.db.ff.shot.r', { victim: 'Meera Nair', killer: 'Matthew Nguyen' }), 'Meera Nair ← tiro de reação de Matthew Nguyen');
    t.ok(!/explosivos/.test(OV.Tn('scr.db.friendly', 1)), 'a linha do fogo amigo já não fala sempre de explosivos');
  });
  t.test('ecrãs r3: foguetes, granadas e a própria explosão contam como explosivos', () => {
    t.eq(SC.lossCauses(ffB({ gun: 'rocket_launcher', ammo: 'small_rocket' })).ff[0].how, 'blast', 'foguete (o motor diz «shot»)');
    t.eq(SC.lossCauses(ffB({ gun: 'rocket_launcher', ammo: null })).ff[0].how, 'blast', 'lança-foguetes já vazio');
    t.eq(SC.lossCauses(ffB({ gun: 'heavy_cannon', ammo: 'hc_he' })).ff[0].how, 'blast', 'canhão pesado HE');
    const g = ffB({});
    g.units[0].deathCause = 'grenade';
    t.eq(SC.lossCauses(g).ff[0].how, 'blast');
    t.eq(SC.lossCauses(g).tip, 'scr.db.tip.friendly');
    const self = ffB({});
    self.units[0].killedBy = 1;
    self.units[0].deathCause = 'grenade';
    t.eq(SC.lossCauses(self).ff[0].how, 'self');
    for (const k of ['scr.db.ff.shot', 'scr.db.ff.shot.r', 'scr.db.ff.blast', 'scr.db.ff.self', 'scr.db.ff.more', 'scr.db.tip.friendly.shot', 'scr.db.tip.outnumbered', 'scr.db.tip.costly']) t.ok(has(k), k);
  });
  t.test('ecrãs r3: equipa pequena contra mais alienígenas tem prioridade; feridas com kit médico a bordo', () => {
    const c = SC.lossCauses(ffB({ aliens: 6, dead3: true }));
    t.eq([c.squad, c.aliens], [4, 6]);
    t.eq(c.tip, 'scr.db.tip.outnumbered');
    t.ok(OV.T('scr.db.tip.outnumbered', { n: 2, aliens: 4 }).indexOf('2 contra 4 alienígenas') >= 0);
    const w = ffB({ brought: { rifle: 4, rifle_clip: 8, medikit: 1 } });
    w.units[2].status = 'dead';
    w.units[2].deathCause = 'wounds';
    t.eq(SC.lossCauses(w).tip2, 'scr.db.tip.wounds', 'morreu a sangrar com um kit a bordo');
    const nokit = ffB({});
    nokit.units[2].status = 'dead';
    nokit.units[2].deathCause = 'wounds';
    t.eq(SC.lossCauses(nokit).tip2, null, 'sem kit não há 2.ª dica');
  });
  t.test('ecrãs r3: vitória cara (metade da equipa ou 3 em Recruta) também mostra a dica', () => {
    const half = ffB({ dead3: true, diff: 2 });
    t.eq(SC.lossCauses(half).costly, true, '2 de 4 mortos');
    t.eq(SC.lossCauses(ffB({ diff: 2 })).costly, false, '1 de 4');
    // lossNotes com um DOM mínimo (reposto no fim)
    const prev = OV.Dom;
    const mk = (tag, attrs, ...kids) => {
      const n = { tag, cls: (attrs && attrs.class) || '', text: (attrs && attrs.text) || '', kids: [] };
      for (const k of kids.flat()) if (k !== null && k !== undefined) n.kids.push(k);
      return n;
    };
    const flat = (n) => (typeof n === 'string' ? n : n.text + n.kids.map(flat).join(''));
    OV.Dom = Object.assign({}, prev || {}, { el: mk });
    try {
      const tip = SC.lossNotes(half, 'win').find((n) => /scr-tip/.test(n.cls));
      t.ok(tip && /costly/.test(tip.cls), 'vitória cara: há dica');
      t.ok(tip && flat(tip).indexOf(OV.T('scr.db.tip.costly')) === 0, 'com o título «Vitória cara»');
      t.eq(SC.lossNotes(ffB({ diff: 2 }), 'win').filter((n) => /scr-tip/.test(n.cls)).length, 0, 'vitória com 1 de 4: sem dica');
      const cause = SC.lossNotes(ffB({ side: 'alien' }), 'loss').find((n) => /scr-cause/.test(n.cls));
      t.ok(cause && /Meera Nair ← tiro de reação de Matthew Nguyen/.test(flat(cause)), 'nomeia quem atingiu quem: ' + (cause && flat(cause)));
    } finally {
      OV.Dom = prev;
    }
  });

  // ---- Como Jogar ------------------------------------------------------------------------------------------------
  t.test('ecrãs r3: «Como Jogar» explica o caminho pelas formas (● cheio, ○ oco, ✕), as cores só repetem', () => {
    const b = OV.STR['scr.howto.tu.body'];
    t.ok(/●/.test(b) && /○/.test(b) && /✕/.test(b), 'as três formas');
    t.ok(/sem reserva, para um tiro rápido/.test(b), 'explica o ○ sem reserva (conta o tiro rápido)');
    t.ok(/daltonismo/.test(b), 'menciona a paleta para daltonismo');
  });
};
