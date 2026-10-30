/* Persona ronda 1 (simulação/dados): reserva para ajoelhar ao andar ajoelhado, Lançador Blaster com rota de voo,
   mortes pelas fontes de energia contadas como queda, aluguer proporcional das naves vendidas, fabrico parado com o
   armazém cheio, teto do lucro de fabricar para vender. Contrato: docs/CAMPAIGN_API.md §11.7; DESIGN §22. */
module.exports = function (OV, t) {
  const D = OV.Data;
  const BM = OV.BMap;
  const BU = OV.BUnits;
  const BT = OV.Battle;
  const A = OV.Act;
  const C = OV.Campaign, BS = OV.BaseSim, E = OV.Economy;
  const id = (k) => D.tileId(k);

  // ---- batalha: mapa aberto FARM de dia, turno X-COM ------------------------------------------------------------
  function fixture(w, h) {
    const m = BM.create(w || 20, h || 16, 1);
    for (let i = 0; i < m.n; i++) m.parts[i * 4] = id('FARM.ground');
    const B = {
      map: m, units: [], items: [], nextId: 1, turn: 1, side: 'xcom', phase: 'play', aborted: false, pendingExplosions: [],
      reserve: 'none', reserveKneel: false, craftTiles: [], specials: {}, settings: { instantGrenades: true },
      stats: { civSaved: 0, civKilledByAliens: 0, civKilledByXcom: 0, aliensKilled: 0, aliensStunned: 0, xcomKilled: 0, crashDead: 0 },
      mission: { kind: 'terror', difficulty: 0, shade: 0, deploymentId: 'dep_terror_site', craftType: 'skyranger' }, rng: OV.RNG.streams(11),
    };
    BT.rebuildDerived(B);
    return B;
  }
  const I = (B, x, y) => BM.idx(B.map, x, y, 0);
  let sid = 1;
  function soldier(B, x, y, loadout, dir) {
    const s = {
      soldierId: 'R' + sid++, name: 'Teste', nat: 'pt', rank: 0, armour: 'coveralls', missions: 0,
      stats: { tu: 60, sta: 60, hp: 40, brav: 50, react: 50, fire: 55, thr: 60, str: 40, melee: 30, psiStr: 40, psiSkill: 0 },
    };
    const u = BU.fromSoldier(B, s, loadout || { R: 'rifle', L: null, belt: ['rifle_clip'], pack: [] });
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = dir === undefined ? 2 : dir;
    return u;
  }
  function alien(B, x, y) {
    const u = BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(5), 'dep_terror_site');
    BU.placeUnit(B, u, I(B, x, y));
    u.dir = 6;
    return u;
  }
  const run = (gen) => {
    const ev = [];
    let r;
    while (!(r = gen.next()).done) ev.push(r.value);
    return { ev, ret: r.value };
  };

  t.test('reserva para ajoelhar: quem anda ajoelhado guarda as UT para voltar a ajoelhar (validate, perform, walkPreview)', () => {
    const B = fixture();
    BU.fromAlien(B, 'sectoid_soldier', 0, OV.RNG.create(9), 'dep_terror_site'); // fora do mapa: a batalha continua viva
    const s = soldier(B, 2, 2);
    OV.LOS.refreshAll(B);
    t.eq(run(A.perform(B, { type: 'kneel', unitId: s.id })).ret.ok, true);
    t.eq(s.tu, 56);
    B.reserve = 'snap';
    B.reserveKneel = true;
    t.eq(A.reserveTU(B, s), 15, 'ajoelhado e parado: só o tiro (já está ajoelhado)');
    t.eq(A.reserveTU(B, s, { standing: true }), 19, 'a andar fica de pé: tiro + joelho');
    const wp = A.walkPreview(B, s, I(B, 16, 2));
    t.eq(wp.reserve, 19, 'a pré-visualização usa a mesma reserva');
    // 56 − 8 (levantar) = 48; 48 − 19 = 29 ⇒ 7 passos de 4 UT; o 8.º come a reserva
    t.eq(wp.marks.slice(0, 9), [0, 0, 0, 0, 0, 0, 0, 1, 1]);
    t.eq(A.validate(B, { type: 'walk', unitId: s.id, to: I(B, 16, 2) }).reserve, 19);
    const r = run(A.perform(B, { type: 'walk', unitId: s.id, to: I(B, 16, 2) }));
    t.eq([r.ev.filter((e) => e.t === 'step').length, s.tu, s.kneel], [7, 20, false]);
    t.eq(r.ret.reason, 'reserved');
    const k = A.validate(B, { type: 'kneel', unitId: s.id });
    t.eq([k.ok, k.tu], [true, 4], 'volta a ajoelhar e ainda guarda o tiro rápido');
    run(A.perform(B, { type: 'kneel', unitId: s.id }));
    t.eq([s.kneel, s.tu >= 15], [true, true]);
  });

  t.test('Lançador Blaster: valida pela rota de voo (Path.flyRoute), não pela linha de tiro; sem rota → noRoute', () => {
    const B = fixture(20, 16);
    for (let y = 0; y < 16; y++) B.map.parts[I(B, 8, y) * 4 + 1] = id('FARM.wall');
    const a = alien(B, 14, 8);
    const loadout = { R: 'blaster_launcher', L: null, belt: [], pack: [] };
    const s = soldier(B, 2, 8, loadout);
    const bl = BU.item(B, s, 'R');
    bl.ammo = { type: 'blaster_bomb', rounds: 1 };
    soldier(B, 11, 8, null, 2); // observador do outro lado da parede
    OV.LOS.refreshAll(B);
    t.ok(OV.LOS.isVisibleTo(B, 'xcom', a), 'a equipa vê o alienígena');
    t.eq(OV.LOS.targetVoxel(B, s, a), null, 'o atirador não tem linha de tiro');
    const shot = { type: 'shoot', unitId: s.id, hand: 'R', mode: 'aimed', target: { unitId: a.id } };
    const v0 = A.validate(B, shot);
    t.eq([v0.ok, v0.reason, v0.key], [false, 'noRoute', 'bs.noRoute'], 'parede inteira: a bomba não tem por onde voar');
    t.ok(A.REASONS.indexOf('noRoute') >= 0);
    // abre-se uma brecha na parede: a bomba contorna-a
    B.map.parts[I(B, 8, 14) * 4 + 1] = 0;
    B.map.disc.fill(7); // r5: a rota só passa por casas já descobertas pela X-COM
    BT.rebuildDerived(B);
    OV.LOS.refreshAll(B);
    const v = A.validate(B, shot);
    t.eq(v.ok, true, 'rota pela brecha');
    t.eq([v.route[0], v.route[v.route.length - 1]], [I(B, 2, 8), I(B, 14, 8)]);
    t.ok(v.route.indexOf(I(B, 8, 14)) >= 0 || v.route.indexOf(I(B, 7, 14)) >= 0, 'passa pela brecha');
    // uma arma normal continua a exigir linha de tiro
    const r = soldier(B, 2, 4);
    OV.LOS.refreshAll(B);
    t.eq(A.validate(B, { type: 'shoot', unitId: r.id, hand: 'R', mode: 'snap', target: { unitId: a.id } }).reason, 'noLOF');
    t.eq(A.validate(B, { type: 'shoot', unitId: r.id, hand: 'R', mode: 'snap', target: { unitId: a.id } }).route, undefined);
    const ev = run(A.perform(B, shot)).ev;
    const sh = ev.find((e) => e.t === 'shot');
    t.ok(sh && sh.path.length > 2, 'a bomba voa por pontos de passagem');
  });

  t.test('fontes de energia: alienígenas mortos antes do turno 1 contam como mortos na queda (sem abates nem pontos)', () => {
    const B = BT.create(BT.quickMission({ ufoType: 'medium_scout', seed: 7, difficulty: 1, month: 0 }));
    const al = B.units.filter((u) => u.side === 'alien' && u.status !== 'dead' && u.onMap);
    t.ok(al.length >= 2, 'tripulação');
    const crash0 = B.stats.crashDead | 0;
    B.pendingExplosions = al.map((u) => ({
      i: BM.idx(B.map, u.x, u.y, u.z), part: null, power: 250, radius: 2, dmg: 'HE',
      voxel: [u.x * 16 + 8, u.y * 16 + 8, u.z * 24 + 8], cause: 'powerSource',
    }));
    run(BT.beginBattle(B));
    const dead = al.filter((u) => u.status === 'dead');
    t.ok(dead.length >= 1, 'alguém morreu na explosão');
    t.ok(dead.every((u) => u.crashDead), 'marcados como queda');
    t.eq(B.stats.aliensKilled, 0, 'nenhum abate da X-COM');
    t.eq(B.stats.crashDead, crash0 + dead.length);
    for (const u of B.units) if (u.side === 'alien' && u.status !== 'dead') { BU.removeUnitFromMap(B, u); u.status = 'dead'; }
    const deb = BT.debrief(B);
    t.eq(deb.lines.find((l) => l.key === 'bs.debrief.aliensKilled').n, B.units.filter((u) => u.origSide === 'alien' && !u.crashDead).length,
      'a linha de abates exclui as mortes da queda');
  });

  t.test('clarão do disparo: de noite quem dispara fica iluminado (a X-COM vê-o) até ao próximo turno do seu lado', () => {
    const B = fixture(30, 16);
    B.mission.shade = 13;
    B.side = 'alien';
    const s = soldier(B, 2, 8, null, 2);
    s.stats.hp = 200; s.hp = 200; s.hpMax = 200; // sobrevive ao tiro
    const a = alien(B, 16, 8);
    a.dir = 6;
    OV.LOS.computeLight(B);
    OV.LOS.refreshAll(B);
    t.ok(OV.LOS.shadeAt(B, I(B, 16, 8)) > OV.TUNE.DARK_SHADE, 'escuro');
    t.ok(OV.LOS.isVisibleTo(B, 'alien', s), 'os alienígenas veem no escuro');
    t.ok(!OV.LOS.isVisibleTo(B, 'xcom', a), 'a 14 tiles no escuro a X-COM não o vê');
    const v = A.validate(B, { type: 'shoot', unitId: a.id, hand: 'R', mode: 'snap', target: { unitId: s.id } });
    t.eq(v.ok, true, v.reason);
    const r = run(A.perform(B, { type: 'shoot', unitId: a.id, hand: 'R', mode: 'snap', target: { unitId: s.id } }));
    t.eq(B.flashes, [{ i: I(B, 16, 8), side: 'alien' }]);
    t.ok(OV.LOS.shadeAt(B, I(B, 16, 8)) <= OV.TUNE.DARK_SHADE, 'o tile do atirador ficou iluminado');
    t.ok(OV.LOS.shadeAt(B, I(B, 18, 8)) > OV.TUNE.DARK_SHADE, 'só o tile do atirador');
    t.ok(OV.LOS.isVisibleTo(B, 'xcom', a), 'a X-COM vê o atirador');
    t.ok(r.ev.some((e) => e.t === 'spotted' && e.unitId === a.id), 'evento spotted para a apresentação');
    // o turno X-COM não apaga o clarão; o regresso do lado alienígena sim
    run(BT.endPlayerTurn(Object.assign(B, { side: 'xcom' })));
    t.eq(B.flashes, [], 'apagado no início do turno alienígena seguinte');
    // de dia não há clarão
    const D2 = fixture(30, 16);
    D2.side = 'alien';
    const s2 = soldier(D2, 2, 8);
    s2.hp = s2.hpMax = 200;
    const a2 = alien(D2, 10, 8);
    OV.LOS.refreshAll(D2);
    run(A.perform(D2, { type: 'shoot', unitId: a2.id, hand: 'R', mode: 'snap', target: { unitId: s2.id } }));
    t.eq(D2.flashes || [], []);
  });

  t.test('Recruta: a granada alienígena é ativada com espoleta 1 (rebenta no fim do turno X-COM); Veterano: 0', () => {
    t.eq(OV.TUNE.AI_GRENADE_FUSE, [1, 0, 0]);
    for (const diff of [0, 1]) {
      const B = fixture(24, 16);
      B.side = 'alien';
      B.turn = 4;
      B.mission.difficulty = diff;
      const sq = [soldier(B, 12, 7), soldier(B, 12, 8), soldier(B, 13, 8)];
      const a = alien(B, 4, 8);
      a.dir = 2;
      for (const it of BU.allItems(B, a)) BU.deleteItem(B, it.id);
      const g = BU.newItem(B, 'alien_grenade', {});
      BU.giveItem(B, a, g.id, 'R', true);
      a.ai = a.ai || {};
      OV.LOS.refreshAll(B);
      const ctx = OV.AI.turnContext(B, 'alien');
      const uc = OV.AI.unitContext(B, a, ctx);
      const first = OV.AI.explosivePlan(B, a, uc, ctx);
      t.ok(first && first.type === 'prime', 'ativa a granada contra o grupo (' + diff + ')');
      t.eq(first.fuse, diff === 0 ? 1 : 0);
      t.ok(sq.length === 3);
    }
  });

  // ---- campanha ---------------------------------------------------------------------------------------------------
  const fresh = (seed) => {
    const G = C.newCampaign({ seed: seed || 5, difficulty: 1 });
    G.events.length = 0;
    return G;
  };
  const interceptor = (G) => Object.values(G.crafts).find((c) => c.type === 'interceptor');

  t.test('aluguer proporcional: vender antes do fecho do mês paga os dias de posse; o ciclo vender/recomprar não poupa', () => {
    const G = fresh();
    const b = G.bases[0];
    t.eq(b.rentDue, 0);
    const ic = interceptor(G);
    t.eq(ic.acquiredT, 0);
    const m0 = OV.Clock.monthStartT(0), m1 = OV.Clock.monthStartT(1);
    G.t = m1 - 2 * 3600; // 2 h antes do fim de janeiro
    const due = BS.craftRentDue(G, ic.id);
    const rent = D.crafts.interceptor.rent;
    t.eq(due, OV.U.idiv(rent * (m1 - 2 * 3600), m1 - m0), 'desde a chegada (t = 0, meio-dia de 1 de janeiro)');
    const up0 = E.upkeep(G).crafts;
    const r = BS.sellCraft(G, ic.id);
    t.eq([r.ok, r.price, r.rent], [true, D.crafts.interceptor.sell, due]);
    t.eq(b.rentDue, due);
    t.eq(E.upkeep(G).crafts, up0 - rent + due, 'a manutenção mostra o aluguer devido');
    const f0 = G.funds;
    G.t = m1;
    G.month = 1;
    const rep = E.monthEnd(G);
    t.eq(rep.upkeep.crafts, up0 - rent + due);
    t.eq(b.rentDue, 0, 'cobrado e limpo no fecho');
    t.ok(G.funds <= f0 + rep.income - rep.upkeep.total, 'cobrado nos fundos');
    // a nave recomprada a seguir paga o mês inteiro no fecho seguinte (como no original)
    const bought = BS.buy(G, b.id, 'interceptor', 1);
    t.eq(bought.ok, true);
    t.eq(E.upkeep(G).crafts, up0, 'a encomenda já conta o aluguer do mês');
    const tBuy = G.t;
    G.t = bought.delivery.etaT;
    BS.hourly(G);
    const nc = Object.values(G.crafts).find((c) => c.type === 'interceptor' && c.id !== ic.id && b.crafts.indexOf(c.id) >= 0 && c.acquiredT >= tBuy);
    t.ok(nc, 'entregue');
    t.eq(nc.acquiredT, tBuy, 'o aluguer conta desde a compra, não desde a entrega');
    // ciclo: o que se poupa no aluguer (rent − due) é menor do que a perda na venda (buy − sell)
    t.ok(rent - due < D.crafts.interceptor.buy - D.crafts.interceptor.sell, 'o ciclo dá prejuízo');
  });

  t.test('aluguer proporcional: nave comprada a meio do mês e vendida no mesmo mês paga só desde a chegada', () => {
    const G = fresh(6);
    const b = G.bases[0];
    const ic = interceptor(G);
    const day = 24 * 3600;
    const m0 = OV.Clock.monthStartT(0), len = OV.Clock.monthStartT(1) - m0;
    ic.acquiredT = 10 * day;
    G.t = 20 * day;
    t.eq(BS.craftRentDue(G, ic.id), OV.U.idiv(D.crafts.interceptor.rent * 10 * day, len));
    ic.acquiredT = null; // gravação antiga: desde o início do mês
    t.eq(BS.craftRentDue(G, ic.id), OV.U.idiv(D.crafts.interceptor.rent * (20 * day - m0), len));
    const sky = Object.values(G.crafts).find((c) => c.type === 'skyranger');
    sky.soldiers.slice().forEach((s) => BS.assignSoldier(G, s, null));
    t.eq(BS.sellCraft(G, sky.id).rent, OV.U.idiv(D.crafts.skyranger.rent * 20 * day, len));
    t.eq(b.rentDue > 0, true);
    // gravação: rentDue e acquiredT sobrevivem e são reparados
    const back = OV.Save.fromJSON(JSON.parse(JSON.stringify(OV.Save.toJSON(G)))).G;
    t.eq(back.bases[0].rentDue, b.rentDue);
    const raw = JSON.parse(JSON.stringify(OV.Save.toJSON(G)));
    delete raw.campaign.bases[0].rentDue;
    for (const k in raw.campaign.crafts) delete raw.campaign.crafts[k].acquiredT;
    const rep = OV.Save.fromJSON(raw).G;
    t.eq(rep.bases[0].rentDue, 0);
    t.ok(Object.values(rep.crafts).every((c) => c.acquiredT === null), 'acquiredT em falta → null (início do mês)');
  });

  t.test('fabrico respeita o armazém: para com stalled «storage» e retoma quando há espaço', () => {
    const G = fresh();
    const b = G.bases[0];
    G.researched.push('laser_weapons', 'laser_pistol');
    const cap = BS.capacities(G, b.id).storage;
    // enche o armazém até faltar menos do que uma pistola laser
    const room = cap.cap * 10 - cap.usedTenths;
    const need = Math.round(D.items.laser_pistol.storage * 10);
    b.stores.alien_alloys = (b.stores.alien_alloys | 0) + Math.floor((room - need + 1) / Math.round(D.items.alien_alloys.storage * 10)) + 1;
    t.ok(BS.capacities(G, b.id).storage.usedTenths + need > cap.cap * 10, 'sem espaço para mais uma');
    const f0 = G.funds;
    const r = BS.startProduction(G, b.id, 'laser_pistol', 10, 3);
    t.eq(r.ok, true);
    t.eq([r.production.stalled, r.production.paid, G.funds], ['storage', false, f0], 'não paga a unidade que não cabe');
    t.eq(G.events.filter((e) => e.t === 'productionStalled').map((e) => e.reason), ['storage']);
    for (let k = 0; k < 24; k++) BS.hourly(G);
    t.eq([r.production.done, b.stores.laser_pistol | 0], [0, 0], 'nada entra acima da capacidade');
    t.eq(G.events.filter((e) => e.t === 'productionStalled').length, 1, 'avisa uma vez');
    t.eq(BS.sell(G, b.id, 'alien_alloys', 20).ok, true);
    for (let k = 0; k < 7; k++) BS.hourly(G);
    t.eq([r.production.stalled, r.production.done], [null, 1], 'retoma sozinho');
    const st = BS.capacities(G, b.id).storage;
    t.ok(st.usedTenths <= st.cap * 10, 'dentro da capacidade');
  });

  t.test('fabricar para vender: nenhum item rende mais do que MANUFACTURE_PROFIT_CAP_H $/h-engenheiro', () => {
    const cap = OV.TUNE.MANUFACTURE_PROFIT_CAP_H;
    t.eq(cap, 100);
    const sellOf = (k) => (D.items[k] && D.items[k].sell) || 0;
    const over = [];
    for (const k in D.manufacture) {
      const m = D.manufacture[k];
      if (m.produces.craft) continue;
      let mat = 0;
      for (const it in m.materials) mat += sellOf(it) * m.materials[it];
      const profit = sellOf(m.produces.item) * (m.produces.n || 1) - m.cost - mat;
      if (profit > cap * m.hours) over.push(k + ' ' + Math.round(profit / m.hours));
      if (m.costOrig !== undefined) t.ok(m.cost >= m.costOrig, k + ': nunca mais barato do que o original');
    }
    t.eq(over, []);
    // o caso da persona: 10 engenheiros em detetores de movimento durante 30 dias rendem ≤ 100 $/h cada
    const ms = D.manufacture.motion_scanner;
    t.ok((D.items.motion_scanner.sell - ms.cost) * 10 * 24 * 30 / ms.hours <= cap * 10 * 24 * 30);
  });
};
