/* Correções da vaga 4 (simulação): interrogatórios retroativos, cancelar um interrogatório, venda de naves,
   desmantelar (hangar reservado, armazém cheio), rearme sem avisos repetidos, retaliação com aviso (baseSpotted),
   defesas primeiro, descolagem das naves da base e guarnição à medida, validação profunda das gravações.
   Contrato: docs/CAMPAIGN_API.md §4, §5.4, §5.6, §5.9, §5.10, §11. */
module.exports = function (OV, t) {
  const C = OV.Campaign, BS = OV.BaseSim, W = OV.World, D = OV.Data, S = OV.Save;
  const fresh = (seed, diff) => {
    const G = C.newCampaign({ seed: seed || 5, difficulty: diff === undefined ? 1 : diff });
    G.events.length = 0;
    return G;
  };
  const interceptor = (G) => Object.values(G.crafts).find((c) => c.type === 'interceptor');
  const sky = (G) => Object.values(G.crafts).find((c) => c.type === 'skyranger');

  // ---- interrogatórios -----------------------------------------------------------------------------------------
  t.test('interrogatório retroativo (dados): comandante antes do tempo conta quando Origens / Solução Marciana acabam', () => {
    const cmd = ['interrogate_sectoid_commander'];
    t.eq(D.researchEffects('alien_origins', cmd, { interrogated: true }).flags, ['leaderInterrogated']);
    t.eq(D.researchEffects('alien_origins', ['interrogate_sectoid_soldier'], { interrogated: true }).flags, [], 'um soldado não chega');
    t.eq(D.researchEffects('alien_origins', ['interrogate_floater_leader'], { interrogated: true }).flags, ['leaderInterrogated']);
    const fx = D.researchEffects('martian_solution', cmd.concat('alien_origins'), { interrogated: true, leaderInterrogated: true });
    t.eq(fx.flags, ['martianSolution', 'commanderInterrogated']);
    t.eq(D.researchEffects('martian_solution', ['interrogate_sectoid_leader', 'alien_origins'], { leaderInterrogated: true }).flags, ['martianSolution'], 'líder não é comandante');
    t.eq(D.researchEffects('alien_origins', cmd, { interrogated: true, leaderInterrogated: true }).flags, [], 'bandeira já ganha');
  });

  t.test('interrogatório retroativo (base): o comandante interrogado primeiro já não perde Cidónia', () => {
    const G = fresh(3);
    const b = G.bases[0];
    G.debug = { instantBuild: true };
    t.eq(BS.build(G, b.id, 'alien_containment', 5, 3).ok, true);
    b.aliens = { sectoid_commander: 1, sectoid_leader: 2 }; // o que a rendição de uma base alienígena entrega
    const go = (topic) => {
      t.ok(C.availableResearch(G, b.id).indexOf(topic) >= 0, topic + ' disponível');
      t.eq(BS.startResearch(G, b.id, topic, 10).ok, true, topic);
      return BS.completeResearch(G, b.id, topic);
    };
    go('interrogate_sectoid_commander');
    t.eq([G.flags.interrogated, G.flags.leaderInterrogated, G.flags.commanderInterrogated], [true, false, false]);
    t.eq(go('alien_origins').flags, ['leaderInterrogated']);
    const ms = go('martian_solution');
    t.eq(ms.flags, ['martianSolution', 'commanderInterrogated']);
    t.ok(ms.unlocked.indexOf('cydonia') >= 0, 'Cidónia desbloqueada pelo evento');
    t.eq(go('cydonia').flags, ['cydoniaUnlocked']);
    t.eq(b.aliens, { sectoid_leader: 2 }, 'os líderes sobram');
  });

  t.test('cancelResearch de um interrogatório devolve o alienígena à contenção (autópsia: o cadáver não volta)', () => {
    const G = fresh();
    const b = G.bases[0];
    b.aliens.sectoid_leader = 1;
    t.eq(BS.startResearch(G, b.id, 'interrogate_sectoid_leader', 2).ok, true);
    t.eq(b.aliens, {});
    t.eq(BS.cancelResearch(G, b.id, 'interrogate_sectoid_leader'), { ok: true, returned: 'sectoid_leader' });
    t.eq(b.aliens, { sectoid_leader: 1 });
    t.eq(b.research.length, 0);
    b.stores.sectoid_corpse = 1;
    t.eq(BS.startResearch(G, b.id, 'autopsy_sectoid', 2).ok, true);
    t.eq(BS.cancelResearch(G, b.id, 'autopsy_sectoid'), { ok: true, returned: null });
    t.eq(b.stores.sectoid_corpse, undefined);
  });

  // ---- venda de naves ------------------------------------------------------------------------------------------
  t.test('sellCraft: Intercetor vendido (75 %), armas e munições para o armazém, aluguer e hangar libertados', () => {
    const G = fresh();
    const b = G.bases[0];
    const ic = interceptor(G);
    const funds = G.funds;
    const rent = OV.Economy.upkeep(G).crafts;
    const st = Object.assign({}, b.stores);
    t.eq(BS.canBuy(G, b.id, 'interceptor', 1), 'hangar', 'os 3 hangares estão ocupados');
    t.eq(BS.sellCraft(G, ic.id), { ok: true, price: 450000 });
    t.eq(G.funds - funds, D.crafts.interceptor.sell);
    t.eq(C.findCraft(G, ic.id), null);
    t.eq(b.crafts.indexOf(ic.id), -1);
    t.eq(rent - OV.Economy.upkeep(G).crafts, D.crafts.interceptor.rent, 'o aluguer acaba');
    t.eq([b.stores.stingray - st.stingray, b.stores.cannon - st.cannon], [1, 1], 'lançadores voltam');
    t.eq([b.stores.stingray_missile - st.stingray_missile, b.stores.cannon_rounds - st.cannon_rounds], [6, 4], 'munição em carregadores inteiros');
    t.eq(BS.canBuy(G, b.id, 'interceptor', 1), null, 'hangar livre');
    t.eq(BS.sellCraft(G, ic.id), { ok: false, reason: 'noCraft' });
  });

  t.test('sellCraft: recusa com soldados a bordo e fora da base; a carga solta volta ao armazém', () => {
    const G = fresh();
    const b = G.bases[0];
    const sk = sky(G);
    t.eq(BS.canSellCraft(G, sk.id), 'crew');
    t.eq(BS.sellCraft(G, sk.id), { ok: false, reason: 'crew' });
    const ic = interceptor(G);
    t.eq(W.launch(G, ic.id, { kind: 'point', lon: 0, lat: 40 }).ok, true);
    t.eq(BS.sellCraft(G, ic.id), { ok: false, reason: 'away' });
    for (const sid of sk.soldiers.slice()) t.eq(BS.assignSoldier(G, sid, null).ok, true);
    const rifles = (b.stores.rifle | 0) + (sk.equipment.rifle | 0);
    t.eq(BS.sellCraft(G, sk.id).ok, true);
    t.eq(b.stores.rifle, rifles, 'a carga da Skyranger fica na base');
  });

  // ---- desmantelar --------------------------------------------------------------------------------------------
  t.test('canDismantle: hangar reservado por uma nave em fabrico já paga; armazém cheio não bloqueia um laboratório vazio', () => {
    const G = fresh(3);
    const b = G.bases[0];
    G.debug = { instantBuild: true };
    for (const id of Object.keys(D.research)) if (G.researched.indexOf(id) < 0 && !D.research[id].template) G.researched.push(id);
    G.funds = 1e8;
    const m = D.manufacture.firestorm;
    for (const it in m.materials) b.stores[it] = (b.stores[it] | 0) + m.materials[it];
    t.eq(BS.build(G, b.id, 'hangar', 4, 0).ok, true);
    t.eq(BS.canDismantle(G, b.id, 4, 0), null, 'hangar livre');
    const r = BS.startProduction(G, b.id, 'firestorm', BS.staff(G, b.id).engineers.free, 1);
    t.ok(r.ok && r.production.paid, 'Firestorm paga');
    t.eq(BS.canDismantle(G, b.id, 4, 0), 'inUse', 'o hangar está reservado');
    t.eq(BS.dismantle(G, b.id, 4, 0), { ok: false, reason: 'inUse' });
    // armazém acima da capacidade (recuperação de uma missão): só bloqueia o que dá armazém
    t.eq(BS.build(G, b.id, 'laboratory', 0, 3).ok, true);
    b.stores.alien_alloys = (b.stores.alien_alloys | 0) + 600;
    t.ok(BS.capacities(G, b.id).storage.used > BS.capacities(G, b.id).storage.cap, 'armazém cheio demais');
    t.eq(BS.canDismantle(G, b.id, 0, 3), null, 'laboratório vazio desmonta-se');
    t.eq(BS.build(G, b.id, 'general_stores', 5, 3).ok, true);
    t.eq(BS.canDismantle(G, b.id, 5, 3), 'inUse', 'um armazém não');
  });

  // ---- rearme -------------------------------------------------------------------------------------------------
  t.test('rearme: arma sem munição em armazém avisa uma só vez por ciclo; a entrega volta a rearmar', () => {
    const G = fresh(7);
    const b = G.bases[0];
    const ic = interceptor(G);
    ic.weapons[0].ammo = 0;
    ic.weapons[1].ammo = 0;
    delete b.stores.cannon_rounds;
    ic.status = 'rearm';
    for (let h = 0; h < 8; h++) BS.hourly(G);
    const short = G.events.filter((e) => e.t === 'craftRearmShort');
    t.eq(short.length, 1);
    t.eq([short[0].itemId, short[0].what], ['cannon_rounds', 'ammo']);
    t.eq([ic.status, ic.weapons[0].ammo, ic.weapons[1].ammo], ['ready', 6, 0]);
    G.events.length = 0;
    b.deliveries.push({ id: 'dlx', kind: 'item', itemId: 'cannon_rounds', n: 4, etaT: G.t });
    BS.hourly(G);
    t.eq(ic.status, 'rearm', 'munição de nave chegou');
    for (let h = 0; h < 3; h++) BS.hourly(G);
    t.eq([ic.status, ic.weapons[1].ammo], ['ready', 200]);
    t.eq(G.events.filter((e) => e.t === 'craftRearmShort').length, 0);
  });

  // ---- retaliação ---------------------------------------------------------------------------------------------
  // retaliação na região da base, já na última vaga (a próxima nave é a do ataque assim que a base for vista)
  function retaliation(G) {
    const b = G.bases[0];
    const m = OV.Missions.spawnMission(G, 'alien_retaliation', { region: b.region, race: 'sectoid', delayMin: 600 });
    return m;
  }
  function assaultNow(G, m) {
    const b = G.bases[0];
    m.targetBaseId = b.id;
    m.wave = D.alienMissions.alien_retaliation.waves.length;
    m.countdownS = 1800;
  }

  t.test('baseSpotted: a base localizada para o jogo e dá pelo menos RETALIATION_WARNING_MIN até o ataque', () => {
    const G = fresh(4);
    const b = G.bases[0];
    const m = retaliation(G);
    let ev = null;
    for (let k = 0; k < 24 * 30 && !ev; k++) {
      W.step(G, 720);
      ev = G.events.find((e) => e.t === 'baseSpotted') || null;
      G.events.length = 0;
    }
    t.ok(ev, 'base localizada');
    t.eq([ev.stop, ev.baseId, ev.missionId], [true, b.id, m.id]);
    t.ok(ev.etaS >= OV.TUNE.RETALIATION_WARNING_MIN * 60, 'aviso de ' + ev.etaS + ' s');
    t.eq(C.EVENTS.baseSpotted.stop, true);
    t.ok(b.spotted && m.targetBaseId === b.id);
    t.ok(m.countdownS >= OV.TUNE.RETALIATION_WARNING_MIN * 60 - 600);
  });

  t.test('o Couraçado do ataque nasce detetado e não se perde do radar; um Intercetor da base pode engajá-lo', () => {
    const G = fresh(4);
    const m = retaliation(G);
    assaultNow(G, m);
    OV.Missions.think30m(G);
    const u = G.ufos.find((x) => x.targetBaseId);
    t.ok(u && u.type === 'battleship', 'Couraçado');
    t.ok(u.detected && G.events.some((e) => e.t === 'ufoDetected' && e.ufoId === u.id));
    t.eq(u.siege, null);
    W.detect(G);
    t.ok(u.detected, 'continua detetado longe do radar');
    const ic = interceptor(G);
    t.eq(W.canOrder(G, ic.id, { kind: 'ufo', id: u.id }), { ok: true }, 'sem aviso tooSlow contra o ataque à própria base');
  });

  t.test('ataque: defesas primeiro, naves armadas descolam (dogfight), depois a guarnição; 8 recrutas em casa aguentam (Veterano)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const G = fresh(seed, 1);
      const b = G.bases[0];
      G.debug = { instantBuild: true };
      t.eq(BS.build(G, b.id, 'missile_defence', 4, 2).ok, true);
      const m = retaliation(G);
      assaultNow(G, m);
      let attack = null, scrambled = 0, def = null;
      for (let k = 0; k < 400 && !def; k++) {
        const r = W.step(G, 60);
        for (const e of G.events.splice(0)) {
          if (e.t === 'baseAttack') attack = e;
          if (e.t === 'dogfightStart' && e.scramble) scrambled++;
          if (e.t === 'baseDefence') def = e;
        }
        if (r.reason === 'dogfight') {
          const u = G.ufos.find((x) => x.targetBaseId);
          t.ok(u.siege && u.siege.shots.length === 1, 'a defesa de mísseis atirou antes das naves');
          for (const df of G.dogfights.slice()) OV.Dogfight.autoResolve(G, df.id, 'disengage');
        }
      }
      t.ok(attack, 'baseAttack (semente ' + seed + ')');
      t.ok(def, 'baseDefence');
      if (def.result !== 'ufoDestroyed') {
        t.eq(scrambled, 2, 'os dois Intercetores descolaram');
        t.eq(def.result, 'repelled', 'semente ' + seed);
        t.eq(def.shots.length, 1, 'uma só salva das defesas');
      }
      t.eq(G.flags.lost, false);
      t.eq(G.ufos.filter((x) => x.targetBaseId).length, 0);
    }
  });

  t.test('ataque com a equipa fora: a base cai (com aviso antes) e o jogo acaba depois do resultado', () => {
    const G = fresh(2, 1);
    const b = G.bases[0];
    for (const c of Object.values(G.crafts)) c.weapons = c.weapons.map(() => null);
    const sk = sky(G);
    t.eq(W.launch(G, sk.id, { kind: 'point', lon: 30, lat: 0 }).ok, true);
    const m = retaliation(G);
    assaultNow(G, m);
    const types = [];
    for (let k = 0; k < 400 && !G.flags.lost; k++) {
      W.step(G, 60);
      for (const e of G.events.splice(0)) types.push(e.t);
    }
    t.eq([G.flags.lost, G.flags.lostReason], [true, 'baseLost']);
    t.ok(types.indexOf('ufoDetected') < types.indexOf('baseAttack'), 'o Couraçado foi visto a chegar');
    t.ok(types.indexOf('baseAttack') < types.indexOf('baseDefence') && types.indexOf('baseDefence') < types.indexOf('gameOver'));
    t.eq(C.findBase(G, b.id), null);
  });

  t.test('guarnição à medida: os recrutas iniciais ≥ exigência de Veterano em 20 sementes; os 8 de Super-humano não chegam', () => {
    const T = OV.TUNE;
    const vet = T.BASE_DEFENCE_BASE + T.BASE_DEFENCE_PER_COEF * 2;
    const sup = T.BASE_DEFENCE_BASE + T.BASE_DEFENCE_PER_COEF * 4;
    const strength = (G) => Object.values(G.soldiers).reduce((a, x) => a + x.stats.tu + x.stats.fire + x.stats.hp, 0);
    let min = Infinity, max = 0;
    for (let seed = 1; seed <= 20; seed++) {
      min = Math.min(min, strength(C.newCampaign({ seed, difficulty: 1 })));
      max = Math.max(max, strength(C.newCampaign({ seed, difficulty: 2 })));
    }
    t.ok(min >= vet, 'recrutas de Veterano ' + min + ' ≥ ' + vet);
    t.ok(max < sup, 'Super-humano ' + sup + ' > ' + max + ' (8 recrutas)');
  });

  // ---- gravações ----------------------------------------------------------------------------------------------
  t.test('Save.fromJSON: recusa um G partido (save.err.parse) e repara o que tem valor óbvio; o ciclo corre depois', () => {
    const G0 = fresh(3);
    for (let i = 0; i < 30; i++) {
      W.step(G0, 720);
      G0.events.length = 0;
    }
    const base = S.toJSON(G0, null, { label: 'x' });
    const errOf = (mut) => {
      const o = JSON.parse(JSON.stringify(base));
      mut(o.campaign, o);
      try {
        S.importFile(JSON.stringify(o));
        return null;
      } catch (e) {
        return e.message;
      }
    };
    const bad = {
      'sem deliveries': (g) => { delete g.bases[0].deliveries; },
      'sem research': (g) => { delete g.bases[0].research; },
      'nave de base inexistente': (g) => { g.crafts.c2.baseId = 'b9'; },
      'soldado sem atributos': (g) => { delete g.soldiers[Object.keys(g.soldiers)[0]].stats; },
      'score.month em falta': (g) => { delete g.score.month; },
      'país nulo': (g) => { g.countries[0] = null; },
      'ids vazio': (g) => { g.ids = {}; },
      't negativo': (g) => { g.t = -5; },
      't fora dos 5 s': (g) => { g.t += 3; },
      'mês trocado': (g) => { g.month = 7; },
      'fundos fracionários': (g) => { g.funds = 1.5; },
      'OVNI de tipo desconhecido': (g) => { g.ufos.push({ id: 'u99', type: 'disco', status: 'flying', lon: 0, lat: 0, dmg: 0 }); },
    };
    for (const k of Object.keys(bad)) t.eq(errOf(bad[k]), 'save.err.parse', k);
    const fixable = {
      'sem transfers': (g) => { delete g.bases[0].transfers; },
      'sem aliens': (g) => { delete g.bases[0].aliens; },
      'armas null': (g) => { g.crafts.c2.weapons = null; },
      'contadores vazios': (g) => { g.stats = {}; g.council = {}; g.seen = {}; },
      'bandeiras vazias': (g) => { g.flags = {}; },
      'interceção gravada à mão': (g) => {
        g.dogfights = [{ id: 'd1', craftId: 'c2', ufoId: 'u404', dist: 100, mode: 'standoff', weapons: [], projectiles: [], ticks: 0, over: false, outcome: null, escapeT: 10, ufoReload: 0 }];
        g.crafts.c2.dogfightId = 'd1';
      },
      'ui em lista': (g) => { g.ui = []; },
    };
    for (const k of Object.keys(fixable)) {
      const o = JSON.parse(JSON.stringify(base));
      fixable[k](o.campaign);
      const G = S.importFile(JSON.stringify(o)).G;
      for (let i = 0; i < 48; i++) {
        const r = W.step(G, 720);
        G.events.length = 0;
        t.ok(r.reason !== 'dogfight', k + ': sem interceção fantasma');
        if (r.reason === 'ended') break;
      }
      t.ok(Number.isInteger(C.hash(G)), k);
      t.eq(S.toJSON(G).game, 'ovni-1999', k + ': grava outra vez');
    }
  });
};
