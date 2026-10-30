/* Ronda de personas 2 — correções do «shell» (estratégia, menus, campanha): Batalha Rápida (penumbra das bases, kit
   médico pela folga de Força, Enter, semente nova), «Esperar pelo dia» até ser dia pleno, avisos persistentes
   (cientistas parados, poucos soldados), efetivo contra equipa, intercetor sem munição, dica de armas fracas,
   encomendas somadas, «+10», registo «você», textos por plataforma. Carrega os ficheiros de interface em Node. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function (OV, t) {
  const ROOT = path.join(__dirname, '..', '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const load = (f) => vm.runInThisContext(read(f), { filename: path.basename(f) });
  OV.SceneDefs = OV.SceneDefs || {};
  if (!OV.Screens || !OV.Screens.crewText) load('js/ui/screens.js');
  if (!OV.GeoUI) load('js/ui/geo_ui.js');
  if (!OV.CampaignUI || !OV.CampaignUI.autoKit) load('js/ui/campaign_ui.js');
  if (!OV.BaseUI || !OV.BaseUI.groupDeliveries) load('js/ui/base_ui.js');
  const SC = OV.Screens, M = OV.GeoUI.model, D = OV.Data, C = OV.Campaign, BU = OV.BaseUI;
  const has = (k) => typeof OV.STR[k] === 'string';
  const items = (l) => [l.R, l.L].concat(l.belt || [], l.pack || []).filter(Boolean);
  const weight = (l) => items(l).reduce((w, id) => w + (D.items[id].weight | 0), 0);

  // ---- Batalha Rápida ------------------------------------------------------------------------------------------
  t.test('quick: base alienígena e Cidónia são penumbra (não noite), sem sinalizadores e com a nota própria', () => {
    for (const kind of ['alienBase', 'cydonia']) {
      for (const time of ['day', 'night']) {
        const { mission, meta } = SC.buildQuickMission({ kind, month: 3, seed: 77, squad: 8, time });
        const N = OV.Battle.normalizeMission(mission);
        t.eq(meta.time, 'dim', kind + '/' + time + ': hora «dim»');
        t.eq(N.night, false, kind + ': a batalha não é noturna');
        t.ok(mission.squad.every((s) => items(s.loadout).indexOf('electro_flare') < 0), kind + ': sem sinalizadores no equipamento');
        t.ok(!(mission.craftItems.electro_flare > 0), kind + ': sem sinalizadores no chão da nave');
      }
    }
    const night = SC.buildQuickMission({ kind: 'crash', month: 0, seed: 77, squad: 8, time: 'night' });
    t.eq(night.meta.time, 'night');
    t.ok(night.mission.squad.every((s) => items(s.loadout).indexOf('electro_flare') >= 0), 'OVNI de noite continua com sinalizadores');
    t.ok(has('scr.time.dim') && has('scr.br.note.dim') && /\{time\}/.test(OV.STR['scr.qb.time.fixed']), 'textos da penumbra');
    t.ok(!/noite/i.test(OV.STR['scr.br.note.dim']) || /não é noite/.test(OV.STR['scr.br.note.dim']), 'a nota não diz que é noite');
  });
  t.test('quick: o kit médico vai para quem tem folga de Força (nunca deixa ninguém com excesso de peso)', () => {
    let carriers = 0;
    for (const month of [2, 3, 4]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { mission } = SC.buildQuickMission({ kind: 'crash', ufo: 'medium_scout', month, seed, squad: 8, time: 'day' });
        const meds = mission.squad.filter((s) => s.loadout.pack.indexOf('medikit') >= 0);
        carriers += meds.length;
        for (const s of meds) t.ok(weight(s.loadout) <= s.stats.str, 'mês ' + month + ' semente ' + seed + ': ' + s.name + ' ' + weight(s.loadout) + '/' + s.stats.str);
        const total = meds.length + (mission.craftItems.medikit | 0);
        t.ok(total >= 2, 'mês ' + month + ' semente ' + seed + ': 2 kits (soldados + nave), não se perdem');
      }
    }
    t.ok(carriers > 100, 'quase sempre há quem os leve: ' + carriers);
    // sem o 5.º argumento mantém-se a regra antiga (compatibilidade da API)
    t.ok(SC.loadoutFor(2, 1, false).lo.pack.indexOf('medikit') >= 0);
    t.ok(SC.loadoutFor(2, 1, false, false, false).lo.pack.indexOf('medikit') < 0);
  });
  t.test('quick: Enter começa com o foco num segmento ou no deslizador; a semente é nova em cada abertura', () => {
    const src = read('js/ui/screens.js');
    t.ok(/classList\.contains\('scr-seg-b'\)\)\) \{ start\(\); return true; \}/.test(src), 'keys(): Enter num .scr-seg-b');
    t.ok(/squadInp\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Enter'/.test(src), 'Enter no deslizador (o teclado global ignora <input>)');
    t.ok(/if \(!q\.seedLocked\) q\.seed = uiRng\.int/.test(src), 'semente sorteada exceto se escrita à mão');
    t.ok(has('scr.qb.seed.tip'));
  });

  // ---- relatório -------------------------------------------------------------------------------------------------
  function lossB(month, race, brought) {
    const units = [];
    for (let i = 1; i <= 4; i++) units.push({ id: i, origSide: 'xcom', type: 'soldier', status: 'dead', killedBy: 9 });
    units.push({ id: 9, origSide: 'alien', type: race + '_soldier', status: 'ok' });
    return { units, items: [], brought, mission: { kind: 'terror', race, month, seed: 1 } };
  }
  t.test('relatório: armas balísticas contra Mutons (ou no mês ≥ 2) dão a dica da tecnologia, não a de ajoelhar', () => {
    const muton = SC.lossCauses(lossB(0, 'muton', { rifle: 4, rifle_clip: 8, heavy_cannon: 1, hc_ap: 2 }));
    const N = OV.Battle.normalizeMission({ kind: 'terror', race: 'muton', month: 0 });
    if (N.race === 'muton') t.eq(muton.tip, 'scr.db.tip.weapons', 'Mutons com espingardas');
    t.eq(SC.lossCauses(lossB(3, 'sectoid', { rifle: 4, rifle_clip: 8 })).tip, 'scr.db.tip.weapons', 'mês 3 sem laser nem plasma');
    t.eq(SC.lossCauses(lossB(3, 'sectoid', { laser_rifle: 4 })).tip, 'scr.db.tip.enemy', 'com laser: a dica tática');
    t.eq(SC.lossCauses(lossB(0, 'sectoid', { rifle: 4, rifle_clip: 8 })).tip, 'scr.db.tip.enemy', 'mês 0 contra Sectoides: a dica tática');
    t.ok(/\{race\}/.test(OV.STR['scr.db.tip.weapons']) && /Investiga/.test(OV.STR['scr.db.tip.weapons.cp']), 'textos com a raça e a investigação');
  });
  t.test('textos: as dicas do relatório tratam o jogador por «você» (como o resto do jogo)', () => {
    for (const k of ['scr.db.tip.enemy', 'scr.db.tip.friendly', 'scr.db.tip.wounds', 'scr.db.tip.weapons', 'scr.db.tip.weapons.cp']) {
      t.ok(!/\b(avança|ajoelha |te mexes|afasta a|dispares|usa o|puderes|investiga )\b/i.test(OV.STR[k]), k + ': ' + OV.STR[k]);
    }
  });
  t.test('textos: «Como Jogar» por plataforma (no Mac ⌘+clique força o tiro; Ctrl+clique é o secundário)', () => {
    t.ok(/⌘/.test(OV.STR['scr.howto.ptr.7.mac']) && !/⌘/.test(OV.STR['scr.howto.ptr.7']), 'linha 7: ⌘ só no Mac');
    t.ok(!/Ctrl\+clique a apontar/.test(OV.STR['scr.howto.ptr.7.mac']), 'no Mac a linha 7 não diz Ctrl+clique');
    t.ok(/Ctrl\+clique/.test(OV.STR['scr.howto.ptr.3.mac']) && !/Ctrl\+clique/.test(OV.STR['scr.howto.ptr.3']), 'linha 3: Ctrl+clique secundário só no Mac');
    t.ok(/rowText\(prefix \+ '\.' \+ i\)/.test(read('js/ui/screens.js')), 'a tabela escolhe a variante .mac');
    let n = 0;
    while (has('scr.howto.bk.' + (n + 1))) n++;
    t.ok(n >= 8 && has('scr.howto.bk.title'), 'tabela «Teclado na base»: ' + n + ' linhas');
  });
  t.test('estatísticas abreviadas com nome completo (dica e aria-label) e legenda no briefing', () => {
    for (const f of ['js/ui/screens.js', 'js/ui/campaign_ui.js']) {
      const src = read(f);
      t.eq((src.match(/class: 'scr-st', title: T\('stat\.' \+ k\)/g) || []).length, 1, f + ': statCell com title');
      t.eq((src.match(/class: 'scr-gain', title: T\('stat\.' \+ k\)/g) || []).length, 1, f + ': gainEls com title');
      t.ok(/statLegend\(\[/.test(src), f + ': legenda');
    }
    for (const k of ['tu', 'hp', 'fire', 'react', 'brav', 'str']) t.ok(has('stat.' + k) && has('stat.' + k + '.abbr'), k);
  });

  // ---- Geoscape ----------------------------------------------------------------------------------------------------
  function duskSpot(G, lat) {
    for (let lon = -180; lon < 180; lon += 1) if (OV.GMath.dayPhase(G, lon, lat) === 'dusk') return lon;
    return null;
  }
  t.test('geo: «Esperar pelo dia» só volta a perguntar com dia pleno (o crepúsculo não é «amanheceu»)', () => {
    const G = C.newCampaign({ seed: 5, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const lon = duskSpot(G, 52);
    t.ok(lon !== null, 'há um ponto ao crepúsculo');
    const u = { id: C.nextId(G, 'u'), type: 'small_scout', status: 'landed', lon, lat: 52, hyper: false, race: 'sectoid', missionId: null };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    // ronda 3 (casual): o crepúsculo também pergunta à chegada (nightAt devolve dusk), mas não é «amanheceu»
    t.eq(M.nightAt(G, ref).dusk, true, 'não é noite, é crepúsculo…');
    t.eq(M.dayAt(G, ref), false, '…mas também ainda não é dia');
    const src = read('js/ui/geo_ui.js');
    t.ok(/if \(!dayAt\(G, ref\) && !\(w\.until && G\.t >= w\.until\)\) return true;/.test(src), 'checkWaitDay espera por dayAt (ou pelo limite anunciado)');
    t.ok(/until: G\.t \+ nt\.h \* 3600/.test(src), 'o limite é o das horas anunciadas');
  });
  t.test('geo: aviso persistente de cientistas parados e de poucos soldados (qualquer mês)', () => {
    const G = C.newCampaign({ seed: 6, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    G.month = 4;
    const idle = M.idleStaff(G);
    t.ok(idle.sci > 0, 'no início os cientistas estão parados: ' + idle.sci);
    t.eq(M.squadShort(G), null, '10 soldados aptos: sem aviso');
    const b = G.bases[0];
    for (const id of b.soldiers.slice(0, 7)) C.findSoldier(G, id).woundDays = 9;
    const sh = M.squadShort(G);
    t.ok(sh && sh.fit === 3 && sh.seats >= 8, 'só 3 aptos: ' + JSON.stringify(sh));
    b.deliveries.push({ id: 'dlx', kind: 'soldier', itemId: null, n: 7, etaT: G.t + 18 * 3600 });
    t.eq(M.squadShort(G).arriving, { n: 7, h: 18 }, 'recrutas a caminho');
    t.eq(OV.Tn('geo.alert.squad', 3, { seats: 10 }), 'Só 3 soldados aptos para 10 lugares no transporte.');
    t.ok(/Chegam 7 recrutas/.test(OV.Tn('geo.alert.squad.arriving', 7, { t: '18 h' })));
    const src = read('js/ui/geo_ui.js');
    t.ok(/S\.short = squadShort\(G\);/.test(src) && /renderAlerts\(\);/.test(src), 'o painel desenha os avisos');
  });
  t.test('geo: investigação concluída com cientistas parados → «Novo projeto» é o Enter', () => {
    const src = read('js/ui/geo_ui.js');
    t.ok(/idleSci && !final \? \{ label: T\('geo\.a\.newProject'\), key: 'Enter', cls: 'primary', def: true/.test(src), 'Novo projeto por omissão');
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/cp\.mr\.warn\.noResearch/.test(cu) && /cp\.mr\.warn\.near/.test(cu), 'relatório mensal: sem investigação e perto do limite');
    t.ok(has('cp.mr.warn.noResearch.other') && /\{thr\}/.test(OV.STR['cp.mr.warn.near']));
  });
  t.test('geo: efetivo estimado do alvo e «Só N soldados contra…» no Enviar equipa', () => {
    const G = C.newCampaign({ seed: 8, difficulty: 1, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const u = { id: C.nextId(G, 'u'), type: 'medium_scout', status: 'landed', lon: 2, lat: 45, hyper: false, race: 'sectoid', missionId: null };
    G.ufos.push(u);
    const ref = { kind: 'ufo', id: u.id };
    t.eq(M.crewEstimate(G, ref), null, 'tipo desconhecido: não se adivinha o efetivo');
    G.seen.ufoTypes.push('medium_scout');
    const r = M.crewEstimate(G, ref);
    t.ok(r && r.max >= r.min && r.min > 0, 'efetivo: ' + JSON.stringify(r));
    t.eq(JSON.stringify(r), JSON.stringify(D.deploymentRange(D.ufos.medium_scout.deployment, 1, G.month | 0)), 'o mesmo do briefing');
    t.ok(/Só 3 soldados contra 4–5 alienígenas\./.test(OV.Tn('geo.fix.short', 3, { crew: SC.crewText({ min: 4, max: 5 }) })));
  });
  t.test('geo: intercetor sem munição tem selo, pede confirmação e o aviso de rearme abre o Mercado', () => {
    const G = C.newCampaign({ seed: 9, difficulty: 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
    const icp = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => !D.crafts[c.type].transport);
    t.ok(icp && icp.weapons.some(Boolean), 'há um intercetor armado');
    t.eq(M.noAmmo(icp), false);
    for (const w of icp.weapons) if (w) w.ammo = 0;
    t.eq(M.noAmmo(icp), true, 'tudo a 0: sem munição');
    t.eq(M.classify({ t: 'craftRearmShort', what: 'ammo' }), 'popup');
    t.eq(M.classify({ t: 'craftRearmShort', what: 'fuel' }), 'toast');
    const src = read('js/ui/geo_ui.js');
    t.ok(/openBase\(c\.baseId, 'market', \{ item: items\[0\], qty: sug\.qty \}\)/.test(src), '«Comprar munição» abre o Mercado na linha certa (com a quantidade sugerida)');
    t.ok(/geo\.int\.noAmmo\.confirm/.test(src), 'confirmação antes de enviar');
    t.ok(/P\.tab === 'market' && P\.item/.test(read('js/ui/base_ui.js')), 'a base realça a linha pedida');
  });
  t.test('geo: noite com sinalizadores a bordo diz quantos e como se usam', () => {
    t.ok(/L/.test(OV.Tn('geo.ev.team.eta.night.flares', 4, { craft: 'S', t: '1 h' })) && /4 sinalizadores/.test(OV.Tn('geo.ev.team.eta.night.flares', 4, { craft: 'S', t: '1 h' })));
    t.ok(has('geo.ev.team.eta.night.none'));
    t.eq(M.textKeys().filter((k) => !has(k)), [], 'textKeys do Geoscape com texto');
  });

  // ---- base ------------------------------------------------------------------------------------------------------
  t.test('base: encomendas do mesmo tipo e hora numa linha, com concordância («chegam»)', () => {
    const G = { t: 1000 };
    const out = BU.groupDeliveries(G, [
      { kind: 'soldier', n: 5, etaT: 1000 + 48 * 3600 }, { kind: 'soldier', n: 1, etaT: 1000 + 48 * 3600 - 30 }, { kind: 'soldier', n: 1, etaT: 1000 + 48 * 3600 },
      { kind: 'scientist', n: 2, etaT: 1000 + 48 * 3600 }, { kind: 'item', itemId: 'rifle', n: 3, etaT: 1000 + 24 * 3600 }, { kind: 'item', itemId: 'rifle', n: 2, etaT: 1000 + 30 * 3600 },
    ]);
    t.eq(out.map((d) => d.kind + (d.itemId ? ':' + d.itemId : '') + '×' + d.n + '@' + d.h), ['item:rifle×3@24', 'item:rifle×2@30', 'soldier×7@48', 'scientist×2@48']);
    t.eq(OV.Tn('base.deliv.eta', 10, { h: 48 }), 'chegam dentro de 48 h');
    t.eq(OV.Tn('base.deliv.eta', 1, { h: 48 }), 'chega dentro de 48 h');
  });
  t.test('base: «+10» vai à dezena seguinte; comprar tem guarda de duplo clique e repõe a quantidade', () => {
    t.eq([1, 9, 10, 11, 25].map(BU.nextTen), [10, 10, 20, 20, 30]);
    const src = read('js/ui/base_ui.js');
    t.ok(/function oneShot\(e\)/.test(src) && /e\.detail > 1/.test(src) && /< 400/.test(src), 'guarda: event.detail e 400 ms');
    t.ok(/if \(!oneShot\(e\)\) return;\s*S\.qty\[id\] = 1;/.test(src), 'comprar: guarda e quantidade a 1');
    t.ok(/base\.market\.space/.test(src) && /base\.market\.frees/.test(src) && /base\.stores\.unitsEach/.test(src), 'espaço por unidade em Comprar, Vender e Armazém');
  });
  t.test('base: separadores com aria-keyshortcuts, ← → mudam de separador e a dica do fantasma não apanha toques', () => {
    const src = read('js/ui/base_ui.js');
    t.ok(/role: 'tab', 'aria-selected': on \? 'true' : 'false', 'aria-keyshortcuts': String\(i \+ 1\)/.test(src));
    t.ok(/ae\.classList\.contains\('bsc-tab'\)/.test(src), '← → com o foco num separador');
    const css = read('css/basescape.css');
    t.ok(/\.scr > \.bsc-ghosttip, \.bsc-ghosttip \{ pointer-events: none; \}/.test(css), 'a dica do fantasma ignora o ponteiro (vence «.scr > *»)');
    t.ok(/table\.tbl\.bsc-soltbl td \{ padding-top: 10px/.test(css), 'linhas de soldados ≥ 32 px no toque (vence table.tbl td)');
    t.ok(!/\.bsc-tab kbd \{ display: none; \}\s*\.bsc-tab \{ font-size: 10\.5px; \}/.test(css), 'as teclas dos separadores já não se escondem a 1100 px');
  });

  // ---- campanha ----------------------------------------------------------------------------------------------------
  t.test('campanha: gravações com nome acessível por posição; relatório desloca-se ao teclado', () => {
    const cu = read('js/ui/campaign_ui.js');
    t.ok(/aria: aria\(e\.empty \? 'cp\.sl\.save' : 'cp\.sl\.overwrite'\)/.test(cu) && /aria: aria\('cp\.sl\.delete'\)/.test(cu));
    t.eq(OV.T('cp.sl.aria', { act: 'Gravar', slot: 'Posição 2' }), 'Gravar: Posição 2');
    t.ok(/ui\.scrollKeys\(ev, sc\.root\.querySelector\('\.scr-deb-body'\)\)/.test(cu), 'cdebrief: ↓/PageDown');
    t.ok(/scrollKeys\(ev, s && s\.root && s\.root\.querySelector\('\.scr-deb-body'\)\)/.test(read('js/ui/screens.js')), 'debrief rápido: ↓/PageDown');
    t.ok(has('cp.db.capturedLine') && /Contenção/.test(OV.STR['cp.db.containLost']), 'capturado mas morto sem contenção: explicado');
  });
};
