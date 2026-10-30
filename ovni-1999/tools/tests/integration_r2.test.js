/* Integração da ronda 2 de personas (pendentes que cruzavam ficheiros de vários donos): repetir a missão com outro
   mapa (Campaign.reseedMap), linha própria do terror abandonado, aviso e correção de armas sem munição no briefing,
   carregador de reserva extra na Batalha Rápida, textos de toque e do Mac (tiro forçado com ⌃ + Enter).
   O comportamento no navegador está em qa/integration_r2.mjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.InventoryUI) load('js/ui/inventory_ui.js');
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.autoKit) load('js/ui/campaign_ui.js');
  const C = OV.Campaign, D = OV.Data, CU = OV.CampaignUI, SC = OV.Screens;
  const has = (k) => typeof OV.STR[k] === 'string' && OV.STR[k].length > 0;
  const items = (l) => [l.R, l.L].concat(l.belt || [], l.pack || []).filter(Boolean);
  const weight = (l) => items(l).reduce((w, id) => w + (D.items[id].weight | 0), 0);

  // ---- «Repetir a missão»: outro mapa, determinístico -------------------------------------------------------------
  t.test('reseedMap: só mexe em G.rng.map, é determinístico e cada tentativa dá outro estado', () => {
    const G = C.newCampaign({ seed: 11, difficulty: 2 });
    const before = Object.assign({}, G.rng);
    const s1 = C.reseedMap(JSON.parse(JSON.stringify(G)), 1);
    const r = C.reseedMap(G, 1);
    t.eq(r, s1, 'mesmo estado + mesmo sal ⇒ mesmo resultado');
    t.eq(G.rng.map, r >>> 0);
    t.ok(Number.isInteger(G.rng.map) && G.rng.map >= 0 && G.rng.map <= 0xffffffff, 'uint32');
    t.ok(G.rng.map !== before.map, 'a stream do mapa mudou');
    for (const k of ['geo', 'combat', 'ai']) t.eq(G.rng[k], before[k], 'a stream ' + k + ' não mexe');
    const seen = new Set();
    for (let n = 1; n <= 12; n++) {
      const g = { rng: Object.assign({}, before) };
      seen.add(C.reseedMap(g, n));
    }
    t.eq(seen.size, 12, '12 tentativas, 12 estados diferentes');
    t.throws(() => C.reseedMap({}, 1), 'sem G.rng.map lança');
    t.ok(has('campaign.err.noGame') && has('cp.db.retry.newMap'), 'textos');
  });

  t.test('reseedMap: a missão repetida a partir da mesma gravação tem outra semente de mapa', () => {
    const G = C.newCampaign({ seed: 5, difficulty: 1 });
    const ufo = { id: 'u99', type: 'small_scout', status: 'landed', lon: -8, lat: 40, race: 'sectoid', alt: 0, hp: 50, dmg: 0, score: 50, missionId: null, seen: true, detected: true };
    G.ufos.push(ufo);
    const craft = C.findCraft(G, 'c1');
    Object.assign(craft, { status: 'patrol', lon: ufo.lon, lat: ufo.lat, dest: { kind: 'ufo', id: ufo.id } });
    const snap = JSON.stringify(G);
    const seedOf = (g) => { const m = C.startMission(g, { kind: 'ufo', id: 'u99' }, craft.id); C.cancelMission(g); return m.seed; };
    const fresh = () => { const g = JSON.parse(snap); C.rebuildDerived(g); return g; };
    const s0 = seedOf(fresh());
    t.eq(seedOf(fresh()), s0, 'sem reseed: a mesma gravação dá o mesmo mapa (o exploit)');
    const g1 = fresh(); C.reseedMap(g1, 1);
    const g1b = fresh(); C.reseedMap(g1b, 1);
    const s1 = seedOf(g1);
    t.ok(s1 !== s0, 'tentativa 1: outro mapa');
    t.eq(seedOf(g1b), s1, 'tentativa 1 outra vez: o mesmo mapa (determinístico)');
    const g2 = fresh(); C.reseedMap(g2, 2);
    t.ok(seedOf(g2) !== s1, 'tentativa 2: outro mapa ainda');
  });

  t.test('reseedMap: a interface usa o n.º da tentativa guardado na gravação «Antes da missão»', () => {
    const src = read('js/ui/campaign_ui.js');
    t.ok(/function retrySalt\(G\)/.test(src) && /obj\.preMission\.retries = n/.test(src) && /C\(\)\.reseedMap\(G, n\)/.test(src), 'retrySalt guarda e usa o n.º');
    t.ok(/slot === 'preMission' && st && st\.G\) retrySalt\(st\.G\)/.test(src), 'loadExtra(preMission) chama retrySalt');
    t.ok(/isExtra\(e\.slot\) \? loadExtra\(e\.slot\)/.test(src), 'o diálogo Carregar também passa por loadExtra');
    t.ok(/reseedMap\(G, salt\)/.test(read('docs/CAMPAIGN_API.md')), 'contrato documentado');
  });

  // ---- terror abandonado --------------------------------------------------------------------------------------------
  t.test('terror abandonado: linha própria no relatório e o aviso do Geoscape diz que abandonar custa o mesmo', () => {
    t.eq(OV.Battle.TERROR_ABANDONED_KEY, 'bs.debrief.terrorAbandoned');
    t.eq(OV.STR['bs.debrief.terrorAbandoned'], 'Local de terror abandonado');
    t.ok(/Abandonar a batalha custa pelo menos o mesmo/.test(OV.STR['geo.ev.terrorSite.stakes']) && /\{points\}/.test(OV.STR['geo.ev.terrorSite.stakes']), 'texto do aviso');
  });

  // ---- armas sem munição no briefing --------------------------------------------------------------------------------
  t.test('briefing: arma sem carregador conta como «sem munição» e «Equipar automaticamente» dá-lhe um', () => {
    const G = C.newCampaign({ seed: 3, difficulty: 0 });
    const craft = C.findCraft(G, 'c1');
    const pool = C.equipPool(G, craft.id);
    t.eq(CU.noAmmoCount(pool.squad), 0, 'equipamento inicial: todos carregados');
    t.eq(CU.emptyHands({ R: 'rifle', L: null, belt: [], pack: [] }), ['R']);
    t.eq(CU.emptyHands({ R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] }), []);
    t.eq(CU.emptyHands({ R: 'laser_rifle', L: null, belt: [], pack: [] }), [], 'arma sem munição própria (laser) nunca está vazia');
    t.eq(CU.emptyHands({ R: 'rifle', L: 'rifle', belt: ['rifle_clip'], pack: [] }), ['L'], 'duas armas, um carregador');
    // tira os carregadores de dois soldados de espingarda
    const rifle = pool.squad.filter((s) => s.loadout.R === 'rifle').slice(0, 2);
    t.eq(rifle.length, 2);
    const stores = Object.assign({}, pool.stores);
    const loadouts = {};
    for (const s of rifle) {
      const lo = JSON.parse(JSON.stringify(s.loadout));
      for (const sl of ['belt', 'pack']) {
        lo[sl] = lo[sl].filter((id) => { if (id === 'rifle_clip') { stores[id] = (stores[id] | 0) + 1; return false; } return true; });
      }
      loadouts[s.id] = lo;
    }
    t.ok(C.applyEquip(G, craft.id, { loadouts, stores }).ok, 'applyEquip');
    const p2 = C.equipPool(G, craft.id);
    t.eq(CU.noAmmoCount(p2.squad), 2, 'dois soldados sem munição');
    t.ok(has('cp.br.warn.noAmmo.one') && has('cp.br.warn.noAmmo.other') && has('cp.crew.loaded.other') && has('cp.crew.dry.one'), 'textos');
    const r = CU.loadAmmo(G, craft.id);
    t.ok(r.ok && r.loaded === 2 && r.left === 0, 'loadAmmo: ' + JSON.stringify(r));
    const p3 = C.equipPool(G, craft.id);
    t.eq(CU.noAmmoCount(p3.squad), 0, 'todos carregados outra vez');
    for (const s of p3.squad.filter((q) => rifle.some((x) => x.id === q.id))) t.eq(items(s.loadout).filter((id) => id === 'rifle_clip').length, 1, s.name + ': um carregador de volta');
    const src = read('js/ui/campaign_ui.js');
    t.ok(/Tn\('cp\.br\.warn\.noAmmo', dry\)/.test(src) && /const a = loadAmmo\(G, craftId\)/.test(src), 'briefing avisa e o botão também carrega');
  });

  // ---- Batalha Rápida: carregador de reserva a mais -----------------------------------------------------------------
  t.test('Batalha Rápida: espingardas levam 3 carregadores quando a Força deixa (arma carregada + 2 de reserva)', () => {
    let three = 0, total = 0;
    for (const seed of [3, 9, 21, 40]) {
      const { mission } = SC.buildQuickMission({ kind: 'crash', ufo: 'small_scout', month: 0, seed, squad: 8, time: 'day' });
      for (const s of mission.squad) {
        const lo = s.loadout;
        t.ok(weight(lo) <= Math.max(weight(SC.loadoutFor(0, 0, false, false, false).lo), s.stats.str), 'nunca passa da Força por causa do carregador extra');
        if (lo.R !== 'rifle') continue;
        total++;
        const clips = items(lo).filter((id) => id === 'rifle_clip').length;
        t.ok(clips >= 2 && clips <= 3, 'carregadores: ' + clips);
        if (clips === 3) three++;
        else t.ok(weight(lo) + D.items.rifle_clip.weight > s.stats.str || !D.fitsSlot('rifle_clip', 'belt', lo.belt) && !D.fitsSlot('rifle_clip', 'pack', lo.pack), 'só fica com 2 se não couber');
      }
    }
    t.ok(three > 0 && total > 0, 'há soldados com 3 carregadores (' + three + '/' + total + ')');
    const s = { stats: { str: 1 }, loadout: { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip'], pack: [] } };
    t.eq(SC.spareClip(s), false, 'Força 1: não acrescenta');
    const s2 = { stats: { str: 60 }, loadout: { R: 'rifle', L: null, belt: ['rifle_clip', 'rifle_clip'], pack: [] } };
    t.eq(SC.spareClip(s2), true);
    t.eq(items(s2.loadout).filter((id) => id === 'rifle_clip').length, 3);
    t.eq(SC.spareClip(s2), false, 'já tem 3');
  });

  // ---- textos: Equipar, toque, Mac ----------------------------------------------------------------------------------
  t.test('textos: rodapé do Equipar com setas/Enter/⌫ e variantes de toque', () => {
    const h = OV.STR['cp.eq.hint'];
    t.ok(/setas e Enter movem objetos/.test(h) && /⌫ devolve ao armazém/.test(h) && /Tab ou 1–9/.test(h), 'cp.eq.hint');
    for (const k of ['cp.eq.hint', 'cp.br.note.waitDay', 'cp.br.hint', 'cp.br.hint.night', 'scr.db.tip.enemy', 'scr.opt.speed.hint', 'scr.opt.instantGrenades.hint', 'scr.menu.howto.hint', 'scr.br.warn.noAmmo.fix']) {
      t.ok(has(k + '.touch'), k + '.touch existe');
      t.ok(!/\((K|W|G|E)\)|Espaço|Clique|clique/.test(OV.STR[k + '.touch']), k + '.touch sem teclas nem «clique»: ' + OV.STR[k + '.touch']);
    }
    t.ok(!/Mac/.test(OV.STR['scr.menu.howto.hint.touch']), 'menu no iPad não fala do Mac');
    t.ok(/@media \(hover: none\) \{[^}]*#tooltip[^}]*\}[\s\S]*?\.btn kbd, \.btn \.key, \.modal \.key \{ display: none; \}/.test(read('css/base.css')), 'emblemas de tecla escondidos no toque');
    const scr = read('js/ui/screens.js');
    for (const k of ["TT(e.key + '.hint')", "TT('scr.opt.speed.hint')", "TT('scr.opt.instantGrenades.hint')", 'TT(keyOf(c.tip), pr)']) t.ok(scr.indexOf(k) >= 0, 'screens usa ' + k);
    const cui = read('js/ui/campaign_ui.js');
    for (const k of ["touchT('cp.br.note.waitDay')", "touchT('cp.eq.hint')", "touchT(nightUfo() ? 'cp.br.hint.night' : 'cp.br.hint')"]) t.ok(cui.indexOf(k) >= 0, 'campaign_ui usa ' + k);
  });

  t.test('Mac: tiro forçado pelo teclado com ⌃ Control + Enter (⌘ + tecla nunca chega ao jogo)', () => {
    t.ok(/⌃ Control \+ Enter/.test(OV.STR['scr.howto.key.18.mac']) && !/^Ctrl/.test(OV.STR['scr.howto.key.18.mac']), 'Como Jogar no Mac');
    t.ok(/⌃ Control \+ Enter/.test(OV.STR['hud.keys.7.mac']) && /⌃ Control \+ Enter/.test(OV.STR['hud.hint.forceFire.mac']) && has('hud.kb.forceHint.mac') && has('hud.kb.forceHint'), 'folha de teclas e dica da pontaria');
    const src = read('js/ui/battle_ui.js');
    t.ok(/else if \(\(m\.ctrl \|\| m\.meta\) && aiming\) kbForceAtPointer\(\);/.test(src), 'Ctrl + Enter a apontar nunca termina o turno');
    t.ok(/clickTarget\(p, \{ shift: false, alt: false, ctrl: false, meta: false \}, 'kb', true\)/.test(src), 'tiro forçado na casa do ponteiro');
    t.ok(/if \(e\.metaKey && e\.key !== 'Meta'\) return;/.test(read('js/ui/input.js')), 'input.js continua a largar ⌘ + tecla (atalhos do macOS)');
  });

  t.test('base: foco devolvido ao separador, ao «Novo projeto» e ao «Equipar»; «+10» à vista a 1024 px', () => {
    const src = read('js/ui/base_ui.js');
    t.ok(/const t = S\.r\.tabs\.querySelector\('\.bsc-tab\.on'\);\s*if \(t\) t\.focus/.test(src), 'setTab foca o separador ativo');
    t.ok(/OV\.Dom\.refocus\('\[data-act="equip"\]', S\.root\)/.test(src), 'closeEquip volta ao «Equipar»');
    t.ok(/'bsc-sheet-research', S\.r\.content\.querySelector\('\[data-act="newResearch"\]'\)\)/.test(src), 'folha da investigação volta ao «Novo projeto»');
    t.ok(!/\.bsc-stepper\.qty \.btn:last-child \{ display: none; \}/.test(read('css/basescape.css')), '«+10» já não é escondido');
  });
};
