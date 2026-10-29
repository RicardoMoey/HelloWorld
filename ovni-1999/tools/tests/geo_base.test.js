/* OV.BaseSim: grelha (ligação ao elevador), capacidades, pessoal, mercado e entregas, investigação (custo aleatório,
   conclusão, consumíveis, bandeiras), fabrico (paragens), manutenção das naves e invariante do equipamento.
   Contrato: docs/CAMPAIGN_API.md §1.8, §1.10, §5.6; DESIGN §3.13–§3.16. */
module.exports = function (OV, t) {
  const B = OV.BaseSim, Camp = OV.Campaign, D = OV.Data;
  const fresh = (o) => {
    const G = Camp.newCampaign(Object.assign({ seed: 31 }, o || {}));
    G.events.length = 0;
    return G;
  };
  const evs = (G, type) => G.events.filter((e) => e.t === type);
  const hours = (G, n) => {
    for (let k = 0; k < n; k++) {
      G.t += 3600;
      B.hourly(G);
    }
  };
  const days = (G, n) => {
    for (let k = 0; k < n; k++) B.daily(G);
  };
  // Σ modelos dos soldados ⊆ equipamento da nave (contrato §1.10)
  const invariant = (G, craftId) => {
    const c = G.crafts[craftId];
    const need = {};
    for (const sid of c.soldiers) {
      const lo = G.soldiers[sid].loadout;
      for (const it of [lo.R, lo.L].concat(lo.belt, lo.pack)) if (it) need[it] = (need[it] | 0) + 1;
    }
    for (const it in need) if ((c.equipment[it] | 0) < need[it]) return it;
    for (const it in c.equipment) if (!(c.equipment[it] > 0)) return 'zero:' + it;
    return null;
  };

  // ---- grelha e capacidades ------------------------------------------------------------------------------
  t.test('capacities da base inicial (só instalações concluídas)', () => {
    const G = fresh();
    const c = B.capacities(G, 'b1');
    t.eq(c.personnel, { cap: 50, used: 30 }); // 10 soldados (ours) + 10 + 10
    t.eq(c.labs, { cap: 50, used: 0 });
    t.eq(c.workshops, { cap: 50, used: 0 });
    t.eq(c.crafts, { cap: 3, used: 3 });
    t.eq(c.aliens, { cap: 0, used: 0 });
    t.eq(c.storage.cap, 50);
    t.ok(c.storage.used > 30 && c.storage.used < 50, 'armazém ' + c.storage.used);
    t.eq(c.storage.used, Math.round(c.storage.used * 10) / 10, 'uma casa decimal');
    t.eq(c.radars, [{ type: 'small_radar', rangeNm: 1695, chance: 15 }]);
    t.eq([c.defences, c.hyper, c.upkeep], [[], false, 2619000]);
    t.eq(B.staff(G, 'b1'), { soldiers: 10, scientists: { total: 10, free: 10 }, engineers: { total: 10, free: 10 } });
  });

  t.test('canPlace: elevador único, limites, sobreposição, ligação, investigação, fundos', () => {
    const G = fresh();
    t.eq(B.canPlace(G, 'b1', 'access_lift', 0, 0), 'lift');
    t.eq(B.canPlace(G, 'b1', 'laboratory', 6, 0), 'cells');
    t.eq(B.canPlace(G, 'b1', 'hangar', 5, 0), 'cells', 'hangar 2×2 sai da grelha');
    t.eq(B.canPlace(G, 'b1', 'laboratory', 2, 2), 'overlap');
    t.eq(B.canPlace(G, 'b1', 'hangar', 0, 2), 'overlap', 'hangar 2×2 por cima do radar (1,3)');
    t.eq(B.canPlace(G, 'b1', 'laboratory', 0, 0), 'notConnected');
    t.eq(B.canPlace(G, 'b1', 'laboratory', 1, 0), null, 'encosta ao hangar (2,0)');
    t.eq(B.canPlace(G, 'b1', 'laser_defence', 1, 0), 'research');
    t.eq(B.canPlace(G, 'b1', 'nao_existe', 1, 0), 'unavailable');
    G.funds = 100;
    t.eq(B.canPlace(G, 'b1', 'laboratory', 1, 0), 'funds');
  });

  t.test('build: paga logo, dias de obra, facilityDone e capacidade só quando concluída; fila de obras ligadas', () => {
    const G = fresh();
    const f0 = G.funds;
    const r = B.build(G, 'b1', 'living_quarters', 1, 2);
    t.eq(r.ok, true);
    t.eq(G.funds, f0 - 400000);
    t.eq(r.facility.daysLeft, D.facilities.living_quarters.days);
    // obra encostada a outra obra também é válida (ligação através de instalações em construção)
    t.eq(B.build(G, 'b1', 'general_stores', 0, 2).ok, true);
    t.eq(B.capacities(G, 'b1').personnel.cap, 50);
    t.eq(B.capacities(G, 'b1').upkeep, 2619000, 'obras sem manutenção');
    days(G, D.facilities.living_quarters.days - 1);
    t.eq(evs(G, 'facilityDone').length, 1, 'armazém (4 dias) já acabou');
    days(G, 1);
    t.eq(evs(G, 'facilityDone').map((e) => [e.type, e.x, e.y, e.stop]), [['general_stores', 0, 2, true], ['living_quarters', 1, 2, true]]);
    t.eq(B.capacities(G, 'b1').personnel.cap, 100);
    t.eq(B.capacities(G, 'b1').storage.cap, 100);
    const H = fresh();
    H.debug = { instantBuild: true };
    B.build(H, 'b1', 'laboratory', 1, 2);
    t.eq(B.capacities(H, 'b1').labs.cap, 100);
    t.eq(evs(H, 'facilityDone').length, 1);
  });

  t.test('canDismantle: elevador, ligação ao elevador, capacidade em uso; dismantle sem reembolso', () => {
    const G = fresh();
    t.eq(B.canDismantle(G, 'b1', 2, 2), 'lift');
    t.eq(B.canDismantle(G, 'b1', 0, 0), 'empty');
    t.eq(B.canDismantle(G, 'b1', 2, 3), 'notConnected', 'o armazém liga o radar e o hangar (0,4)');
    t.eq(B.canDismantle(G, 'b1', 3, 2), 'inUse', 'alojamentos com 28 pessoas');
    t.eq(B.canDismantle(G, 'b1', 5, 5), 'inUse', 'hangar ocupado (qualquer célula do 2×2)');
    const f0 = G.funds;
    t.eq(B.canDismantle(G, 'b1', 1, 3), 'notConnected', 'o hangar (0,4) só liga pelo radar');
    t.eq(B.dismantle(G, 'b1', 1, 3), { ok: false, reason: 'notConnected' });
    t.eq(B.canDismantle(G, 'b1', 3, 3), 'notConnected', 'o laboratório liga a oficina e o hangar (4,4)');
    // obra por acabar e armazém novo concluído desmontam-se; sem reembolso
    B.build(G, 'b1', 'laboratory', 1, 2);
    B.build(G, 'b1', 'general_stores', 4, 2);
    G.bases[0].grid[G.bases[0].grid.length - 1].daysLeft = 0;
    const f1 = G.funds;
    t.eq(B.dismantle(G, 'b1', 1, 2).ok, true);
    t.eq(B.dismantle(G, 'b1', 4, 2).ok, true);
    t.eq(G.funds, f1);
    t.ok(f1 < f0);
    t.eq(G.bases[0].grid.length, 9);
    t.ok(D.gridConnected(G.bases[0].grid).ok);
  });

  // ---- pessoal e mercado ---------------------------------------------------------------------------------
  t.test('hire: custo, entrega em 48 h, alojamentos contam o pessoal a caminho; recrutas gerados à chegada', () => {
    const G = fresh();
    const f0 = G.funds;
    const r = B.hire(G, 'b1', 'soldier', 2);
    t.eq(r.ok, true);
    t.eq(r.delivery.etaT, G.t + 48 * 3600);
    t.eq(B.hire(G, 'b1', 'scientist', 5).ok, true);
    t.eq(G.funds, f0 - 2 * 40000 - 5 * 30000);
    t.eq(B.capacities(G, 'b1').personnel.used, 37);
    t.eq(B.canHire(G, 'b1', 'engineer', 16), 'quarters');
    t.eq(B.canHire(G, 'b1', 'engineer', 0), 'count');
    t.eq(B.canHire(G, 'b1', 'pilot', 1), 'unavailable');
    hours(G, 47);
    t.eq(evs(G, 'deliveryArrived').length, 0);
    hours(G, 1);
    t.eq(evs(G, 'deliveryArrived').map((e) => [e.kind, e.n]), [['soldier', 2], ['scientist', 5]]);
    t.eq(G.bases[0].soldiers.length, 12);
    t.eq(G.bases[0].scientists, 15);
    t.eq(G.bases[0].deliveries, []);
    const s = G.soldiers[G.bases[0].soldiers[11]];
    t.eq([s.baseId, s.craftId, s.rank], ['b1', null, 0]);
    G.funds = 1000;
    t.eq(B.canHire(G, 'b1', 'soldier', 1), 'funds');
  });

  t.test('sack: só pessoal livre; soldado despedido devolve armadura e o modelo ao armazém', () => {
    const G = fresh();
    G.researched.push('personal_armour');
    G.bases[0].stores.personal_armour = 1;
    const sid = G.crafts.c1.soldiers[0];
    t.eq(B.setArmour(G, sid, 'personal_armour').ok, true);
    const rifles = G.bases[0].stores.rifle | 0;
    const tpl = G.soldiers[sid].loadout;
    t.eq(B.sack(G, 'b1', 'soldier', sid).ok, true);
    t.ok(!G.soldiers[sid] && G.bases[0].soldiers.indexOf(sid) < 0 && G.crafts.c1.soldiers.indexOf(sid) < 0);
    t.eq(G.bases[0].stores.personal_armour, 1);
    if (tpl.R === 'rifle') t.eq(G.bases[0].stores.rifle, rifles + 1);
    t.eq(invariant(G, 'c1'), null);
    B.startResearch(G, 'b1', 'laser_weapons', 8);
    t.eq(B.sack(G, 'b1', 'scientist', 3), { ok: false, reason: 'busy' });
    t.eq(B.sack(G, 'b1', 'scientist', 2).ok, true);
    t.eq(G.bases[0].scientists, 8);
    G.crafts.c1.status = 'out';
    t.eq(B.sack(G, 'b1', 'soldier', G.crafts.c1.soldiers[0]), { ok: false, reason: 'away' });
  });

  t.test('buy: preço, ETA 24 h itens / 48 h armas de nave / 96 h Intercetor, armazém e hangares; sell imediato', () => {
    const G = fresh();
    const f0 = G.funds;
    t.eq(B.buy(G, 'b1', 'rifle', 4).delivery.etaT, 24 * 3600);
    t.eq(B.buy(G, 'b1', 'stingray_missile', 2).delivery.etaT, 48 * 3600);
    t.eq(G.funds, f0 - 4 * 3000 - 2 * 3000);
    t.eq(B.canBuy(G, 'b1', 'interceptor', 1), 'hangar');
    t.eq(B.canBuy(G, 'b1', 'laser_pistol', 1), 'unavailable');
    t.eq(B.canBuy(G, 'b1', 'proximity_grenade', 1), 'unavailable', 'fora do MVP');
    t.eq(B.canBuy(G, 'b1', 'avalanche_missile', 10), 'storage', '1,5 por míssil');
    t.eq(B.canBuy(G, 'b1', 'rifle', 0), 'count');
    hours(G, 24);
    t.eq(evs(G, 'deliveryArrived').map((e) => [e.kind, e.itemId, e.n]), [['item', 'rifle', 4]]);
    t.eq(G.bases[0].stores.rifle, 6);
    // hangar livre ⇒ Intercetor (96 h) chega desarmado e pronto
    G.crafts.c3.status = 'ready';
    B.build(G, 'b1', 'hangar', 0, 0);
    G.bases[0].grid[G.bases[0].grid.length - 1].daysLeft = 0;
    t.eq(B.canPlace(G, 'b1', 'hangar', 0, 0), 'overlap');
    const r = B.buy(G, 'b1', 'interceptor', 1);
    t.eq(r.delivery.etaT, G.t + 96 * 3600);
    t.eq(B.canBuy(G, 'b1', 'interceptor', 1), 'hangar', 'a nave a caminho ocupa o hangar');
    hours(G, 96);
    const c = G.crafts[G.bases[0].crafts[3]];
    t.eq([c.type, c.status, c.weapons, c.fuel], ['interceptor', 'ready', [null, null], 1000]);
    // venda
    const f1 = G.funds;
    t.eq(B.sell(G, 'b1', 'rifle', 2).ok, true);
    t.eq(G.funds, f1 + 2 * D.items.rifle.sell);
    t.eq(B.sell(G, 'b1', 'rifle', 99), { ok: false, reason: 'stock' });
    G.bases[0].aliens.sectoid_soldier = 1;
    t.eq(B.sell(G, 'b1', 'sectoid_soldier', 1), { ok: false, reason: 'unsellable' });
  });

  // ---- investigação --------------------------------------------------------------------------------------
  t.test('startResearch: custo = max(1, floor(custo × RNG(80..120)/100)) — limites atingidos e respeitados', () => {
    const G = fresh();
    let lo = 1e9, hi = 0;
    for (let k = 0; k < 400; k++) {
      t.eq(B.startResearch(G, 'b1', 'laser_weapons', 0).ok, true);
      const c = G.bases[0].research[0].cost;
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
      B.cancelResearch(G, 'b1', 'laser_weapons');
    }
    t.eq([lo, hi], [16, 24], 'Armas Laser: 20 × 0,8..1,2');
  });

  t.test('investigação: razões (busy, labs, scientists, unavailable), progresso diário e conclusão', () => {
    const G = fresh();
    t.eq(B.startResearch(G, 'b1', 'laser_pistol', 1), { ok: false, reason: 'unavailable' });
    t.eq(B.startResearch(G, 'b1', 'laser_weapons', 11), { ok: false, reason: 'scientists' });
    G.bases[0].scientists = 60;
    t.eq(B.startResearch(G, 'b1', 'laser_weapons', 51), { ok: false, reason: 'labs' });
    t.eq(B.startResearch(G, 'b1', 'laser_weapons', 10).ok, true);
    t.eq(B.startResearch(G, 'b1', 'laser_weapons', 1), { ok: false, reason: 'busy' });
    t.eq(B.setScientists(G, 'b1', 'laser_weapons', 51), { ok: false, reason: 'labs' });
    t.eq(B.setScientists(G, 'b1', 'laser_weapons', 5).ok, true);
    const p = G.bases[0].research[0];
    t.eq(B.researchLabel(G, 'b1', 'laser_weapons'), 'research.progress.unknown');
    let d = 0;
    while (G.bases[0].research.length && d < 10) {
      B.daily(G);
      d++;
    }
    t.eq(d, Math.ceil(p.cost / 5));
    t.ok(G.researched.indexOf('laser_weapons') >= 0);
    t.ok(G.ufopaedia.indexOf('laser_weapons') >= 0);
    t.eq(G.score.month.research, 10);
    const e = evs(G, 'researchDone');
    t.eq(e.length, 1);
    t.eq([e[0].baseId, e[0].topic, e[0].article, e[0].stop, e[0].flags], ['b1', 'laser_weapons', 'laser_weapons', true, []]);
    t.ok(e[0].unlocked.indexOf('laser_pistol') >= 0, 'novo tópico disponível');
    t.eq(e[0].manufacture, []);
    // a pistola laser liberta fabrico
    B.completeResearch(G, 'b1', 'laser_pistol');
    t.eq(evs(G, 'researchDone')[1].manufacture, ['laser_pistol']);
    t.eq(B.researchLabel(G, 'b1', 'nada'), 'research.progress.none');
  });

  t.test('rótulos de progresso (§3.15): Desconhecido até 33 %, depois cientistas/custo ≤7 % ≤13 % ≤25 %', () => {
    const K = (c, s, n) => D.progressLabelKey(c, s, n).replace('research.progress.', '');
    t.eq([K(100, 0, 5), K(100, 33, 5), K(100, 34, 5), K(100, 34, 7), K(100, 34, 8), K(100, 34, 13), K(100, 34, 14), K(100, 34, 25), K(100, 34, 26), K(100, 50, 0)],
      ['unknown', 'unknown', 'poor', 'poor', 'average', 'average', 'good', 'good', 'excellent', 'none']);
  });

  t.test('consumíveis: autópsia gasta o cadáver; interrogatório gasta o alienígena vivo; cancelar não devolve', () => {
    const G = fresh();
    const b = G.bases[0];
    b.stores.sectoid_corpse = 1;
    t.eq(B.startResearch(G, 'b1', 'autopsy_sectoid', 2).ok, true);
    t.eq(b.stores.sectoid_corpse, undefined, 'sem chaves a zero');
    B.cancelResearch(G, 'b1', 'autopsy_sectoid');
    t.eq(b.stores.sectoid_corpse, undefined);
    t.eq(B.startResearch(G, 'b1', 'autopsy_sectoid', 2), { ok: false, reason: 'unavailable' });
    b.aliens.sectoid_leader = 1;
    t.eq(B.startResearch(G, 'b1', 'interrogate_sectoid_leader', 3).ok, true);
    t.eq(b.aliens, {});
  });

  t.test('completeResearch: bandeiras do interrogatório (ordem orig), artigos grátis, Solução Marciana → Cidónia', () => {
    const G = fresh();
    G.seen.ufoTypes.push('small_scout');
    B.completeResearch(G, 'b1', 'interrogate_sectoid_engineer');
    t.eq(G.flags.interrogated, true);
    t.ok(G.ufopaedia.indexOf('race_sectoid') >= 0 && G.ufopaedia.indexOf('ufo_small_scout') >= 0, 'engenheiro ⇒ artigo de OVNI');
    t.eq(G.score.month.research, 50);
    B.completeResearch(G, 'b1', 'alien_origins');
    t.eq(B.startResearch(G, 'b1', 'martian_solution', 1), { ok: false, reason: 'unavailable' });
    B.completeResearch(G, 'b1', 'interrogate_sectoid_leader');
    const e = B.completeResearch(G, 'b1', 'interrogate_sectoid_leader');
    t.eq(G.flags.leaderInterrogated, true);
    t.eq(G.researched.filter((x) => x === 'interrogate_sectoid_leader').length, 1, 'sem duplicados');
    t.ok(G.researched.indexOf('alien_origins') >= 0 && e.flags.length === 0, 'segunda vez: nada de novo');
    B.completeResearch(G, 'b1', 'martian_solution');
    t.eq(G.flags.martianSolution, true);
    B.completeResearch(G, 'b1', 'interrogate_sectoid_commander');
    t.eq(G.flags.commanderInterrogated, true);
    t.eq(G.flags.cydoniaUnlocked, false);
    const last = B.completeResearch(G, 'b1', 'cydonia');
    t.eq(last.flags, ['cydoniaUnlocked']);
    t.eq(G.flags.cydoniaUnlocked, true);
  });

  t.test('debug.instantResearch acaba no dia seguinte', () => {
    const G = fresh();
    G.debug = { instantResearch: true };
    B.startResearch(G, 'b1', 'medikit', 1);
    B.daily(G);
    t.ok(G.researched.indexOf('medikit') >= 0);
  });

  // ---- fabrico -------------------------------------------------------------------------------------------
  t.test('fabrico: paga cada unidade, +engenheiros por hora, productionDone no fim da encomenda', () => {
    const G = fresh();
    G.researched.push('laser_weapons', 'laser_pistol');
    const f0 = G.funds;
    t.eq(B.startProduction(G, 'b1', 'laser_rifle', 10, 1), { ok: false, reason: 'unavailable' });
    t.eq(B.startProduction(G, 'b1', 'laser_pistol', 11, 1), { ok: false, reason: 'engineers' });
    const r = B.startProduction(G, 'b1', 'laser_pistol', 10, 2);
    t.eq(r.ok, true);
    t.eq(G.funds, f0 - 8000, 'primeira unidade paga ao começar');
    t.eq(B.capacities(G, 'b1').workshops.used, 12, 'engenheiros + espaço');
    hours(G, 5);
    t.eq(r.production.done, 0);
    hours(G, 1);
    t.eq([r.production.done, G.bases[0].stores.laser_pistol, G.funds], [1, 1, f0 - 16000]);
    hours(G, 6);
    t.eq(G.bases[0].stores.laser_pistol, 2);
    t.eq(G.bases[0].production, []);
    t.eq(evs(G, 'productionDone').map((e) => [e.item, e.qty]), [['laser_pistol', 2]]);
    t.eq(G.funds, f0 - 16000);
  });

  t.test('fabrico: oficinas, contínuo (qty 0), vários por hora, hangar para naves', () => {
    const G = fresh();
    G.researched.push('laser_weapons', 'laser_pistol', 'alien_alloys', 'elerium', 'power_source', 'ufo_navigation', 'ufo_construction', 'new_fighter');
    G.bases[0].engineers = 100;
    t.eq(B.startProduction(G, 'b1', 'laser_pistol', 49, 0), { ok: false, reason: 'workshops' });
    t.eq(B.startProduction(G, 'b1', 'firestorm', 1, 1), { ok: false, reason: 'hangar' });
    const p = B.startProduction(G, 'b1', 'laser_pistol', 48, 0).production;
    hours(G, 5); // 240 h-engenheiro = 4 pistolas
    t.eq(p.done, 4);
    t.eq(G.bases[0].stores.laser_pistol, 4);
    t.eq(G.bases[0].production.length, 1, 'contínuo nunca acaba');
    t.eq(B.setQty(G, 'b1', p.id, 3), { ok: false, reason: 'count' });
    t.eq(B.setQty(G, 'b1', p.id, 5).ok, true);
    hours(G, 2);
    t.eq(G.bases[0].production, []);
    t.eq(evs(G, 'productionDone')[0].qty, 5);
  });

  t.test('fabrico: para por fundos/materiais (aviso uma vez), retoma quando há meios', () => {
    const G = fresh();
    G.researched.push('plasma_pistol');
    const b = G.bases[0];
    b.stores.alien_alloys = 1;
    const p = B.startProduction(G, 'b1', 'plasma_pistol', 10, 2).production;
    t.eq([p.paid, p.stalled, b.stores.alien_alloys], [true, null, undefined]);
    hours(G, 12);
    t.eq(p.done, 1);
    t.eq(p.stalled, 'materials');
    hours(G, 5);
    t.eq(evs(G, 'productionStalled').map((e) => [e.item, e.reason, e.stop]), [['plasma_pistol', 'materials', true]], 'um só aviso');
    b.stores.alien_alloys = 3;
    G.funds = 1000;
    hours(G, 1);
    t.eq(p.stalled, 'funds');
    t.eq(evs(G, 'productionStalled').length, 2);
    G.funds = 1000000;
    hours(G, 12);
    t.eq([p.stalled, b.stores.plasma_pistol, b.stores.alien_alloys], [null, 2, 2]);
    t.eq(b.production, []);
    // cancelar não reembolsa
    const q = B.startProduction(G, 'b1', 'plasma_pistol', 1, 1).production;
    const f = G.funds;
    t.eq(B.cancelProduction(G, 'b1', q.id).ok, true);
    t.eq(G.funds, f);
  });

  t.test('fabrico de nave: pronta no hangar livre; sem hangar a encomenda espera', () => {
    const G = fresh();
    G.researched.push('alien_alloys', 'elerium', 'power_source', 'ufo_navigation', 'ufo_construction', 'new_fighter');
    const b = G.bases[0];
    B.build(G, 'b1', 'hangar', 0, 0);
    b.grid[b.grid.length - 1].daysLeft = 0;
    Object.assign(b.stores, { alien_alloys: 25, ufo_power_source: 1, ufo_navigation: 1 });
    b.engineers = 40;
    G.debug = { instantProduction: true };
    const p = B.startProduction(G, 'b1', 'firestorm', 10, 1).production;
    t.eq(p.paid, true);
    t.eq(B.canBuy(G, 'b1', 'interceptor', 1), 'hangar', 'hangar reservado');
    hours(G, 1);
    const c = G.crafts[b.crafts[3]];
    t.eq([c.type, c.status, c.fuel], ['firestorm', 'ready', 20]);
    t.eq(evs(G, 'productionDone').length, 1);
  });

  // ---- naves -----------------------------------------------------------------------------------------------
  t.test('manutenção: reparar (+5/h) → rearmar (orig rearm) → reabastecer (+50/30 min) → craftReady', () => {
    const G = fresh();
    const b = G.bases[0];
    const c = G.crafts.c2;
    c.hp = 80;
    c.weapons[0].ammo = 4;
    c.weapons[1].ammo = 60;
    c.fuel = 900;
    t.eq(B.checkup(G, 'c2'), 'repair');
    const missiles = b.stores.stingray_missile;
    hours(G, 3);
    t.eq([c.hp, c.status], [95, 'repair']);
    hours(G, 1); // reparada; o rearme começa na mesma hora
    t.eq([c.hp, c.status], [100, 'rearm']);
    // Stingray +1; canhão: min(100, 200−60+49)/50 = 2 carregadores pedidos, só há 1 ⇒ +50
    t.eq([c.weapons[0].ammo, c.weapons[1].ammo, b.stores.stingray_missile, b.stores.cannon_rounds], [5, 110, missiles - 1, undefined]);
    t.eq(evs(G, 'craftRearmShort').length, 0);
    hours(G, 1);
    t.eq(c.weapons[0].ammo, 6);
    t.eq(evs(G, 'craftRearmShort').map((e) => [e.craftId, e.itemId, e.what]), [['c2', 'cannon_rounds', 'ammo']]);
    t.eq(c.status, 'refuel', 'sem munição em armazém passa à etapa seguinte');
    B.halfHourly(G);
    t.eq([c.fuel, c.status], [950, 'refuel']);
    B.halfHourly(G);
    t.eq([c.fuel, c.status], [1000, 'ready']);
    t.eq(evs(G, 'craftReady').map((e) => e.craftId), ['c2']);
    // chegada de munição de canhão: a nave volta a rearmar
    B.buy(G, 'b1', 'cannon_rounds', 2);
    hours(G, 48);
    t.eq(c.status, 'rearm');
    hours(G, 1);
    t.eq([c.weapons[1].ammo, c.status], [200, 'ready']);
  });

  t.test('fitWeapon: devolve lançador e munição ao armazém, nova arma começa vazia ⇒ rearm', () => {
    const G = fresh();
    const b = G.bases[0];
    const c = G.crafts.c3;
    const st = b.stores.stingray, sm = b.stores.stingray_missile;
    t.eq(B.fitWeapon(G, 'c3', 0, 'avalanche').ok, true);
    t.eq([b.stores.stingray, b.stores.stingray_missile, b.stores.avalanche], [st + 1, sm + 6, undefined]);
    t.eq(c.weapons[0], { type: 'avalanche', ammo: 0 });
    t.eq(c.status, 'rearm');
    t.eq(B.fitWeapon(G, 'c3', 1, 'avalanche'), { ok: false, reason: 'stock' });
    t.eq(B.fitWeapon(G, 'c3', 2, 'cannon'), { ok: false, reason: 'slot' });
    t.eq(B.fitWeapon(G, 'c1', 0, 'cannon'), { ok: false, reason: 'slot' }, 'Skyranger sem armas');
    t.eq(B.fitWeapon(G, 'c3', 1, null).ok, true);
    t.eq(c.weapons[1], null);
    hours(G, 3);
    t.eq([c.weapons[0].ammo, c.status], [3, 'ready']);
    c.status = 'out';
    t.eq(B.fitWeapon(G, 'c3', 1, 'cannon'), { ok: false, reason: 'away' });
  });

  t.test('equipamento: assignSoldier e moveCargo mantêm Σ modelos ⊆ equipamento', () => {
    const G = fresh();
    const b = G.bases[0];
    const c1 = G.crafts.c1;
    t.eq(invariant(G, 'c1'), null);
    const sid = c1.soldiers[0];
    const lo = JSON.parse(JSON.stringify(G.soldiers[sid].loadout));
    t.eq(B.assignSoldier(G, sid, null).ok, true);
    t.eq(G.soldiers[sid].craftId, null);
    t.eq(invariant(G, 'c1'), null);
    // volta a entrar: o modelo é apoiado pelo armazém (onde foi parar)
    t.eq(B.assignSoldier(G, sid, 'c1').ok, true);
    t.eq(G.soldiers[sid].loadout, lo);
    t.eq(invariant(G, 'c1'), null);
    // sem itens em lado nenhum, o modelo perde o que falta
    for (const x of c1.soldiers.slice()) t.eq(B.assignSoldier(G, x, null).ok, true);
    t.eq(c1.soldiers, []);
    for (const k of Object.keys(b.stores)) delete b.stores[k];
    for (const k of Object.keys(c1.equipment)) delete c1.equipment[k];
    t.eq(B.assignSoldier(G, sid, 'c1').ok, true);
    t.eq(G.soldiers[sid].loadout, { R: null, L: null, belt: [], pack: [] });
    t.eq(invariant(G, 'c1'), null);
    t.eq(B.assignSoldier(G, sid, 'c2'), { ok: false, reason: 'seats' }, 'Intercetor sem lugares');
    // carga solta
    const H = fresh();
    const h1 = H.crafts.c1;
    const loose = B.loose(H, 'c1');
    t.eq(B.moveCargo(H, 'c1', 'grenade', 2).ok, true);
    t.eq(B.loose(H, 'c1').grenade, (loose.grenade | 0) + 2);
    t.eq(B.moveCargo(H, 'c1', 'rifle', -99), { ok: false, reason: 'inUse' });
    t.eq(B.moveCargo(H, 'c1', 'grenade', -2).ok, true);
    t.eq(B.moveCargo(H, 'c1', 'stingray', 1), { ok: false, reason: 'unavailable' }, 'arma de nave não é carga de batalha');
    t.eq(invariant(H, 'c1'), null);
    // ferido não entra; nave fora não aceita
    const w = H.crafts.c1.soldiers[0];
    B.assignSoldier(H, w, null);
    H.soldiers[w].woundDays = 3;
    t.eq(B.assignSoldier(H, w, 'c1'), { ok: false, reason: 'wounded' });
    h1.status = 'out';
    t.eq(B.moveCargo(H, 'c1', 'grenade', 1), { ok: false, reason: 'away' });
  });

  t.test('setArmour: investigação, stock e devolução do fato antigo', () => {
    const G = fresh();
    const b = G.bases[0];
    const sid = Object.keys(G.soldiers)[0];
    t.eq(B.setArmour(G, sid, 'personal_armour'), { ok: false, reason: 'unavailable' });
    G.researched.push('personal_armour');
    t.eq(B.setArmour(G, sid, 'personal_armour'), { ok: false, reason: 'stock' });
    b.stores.personal_armour = 2;
    t.eq(B.setArmour(G, sid, 'personal_armour').ok, true);
    t.eq([G.soldiers[sid].armour, b.stores.personal_armour], ['personal_armour', 1]);
    t.eq(B.setArmour(G, sid, 'coveralls').ok, true);
    t.eq(b.stores.personal_armour, 2);
  });

  t.test('determinismo e JSON: uma semana de horas/dias com investigação, fabrico e entregas', () => {
    const run = () => {
      const G = fresh({ seed: 77 });
      G.researched.push('laser_weapons', 'laser_pistol');
      B.startResearch(G, 'b1', 'medikit', 6);
      B.startResearch(G, 'b1', 'motion_scanner', 4);
      B.startProduction(G, 'b1', 'laser_pistol', 10, 0);
      B.hire(G, 'b1', 'soldier', 3);
      B.build(G, 'b1', 'laboratory', 1, 2);
      G.crafts.c2.hp = 50;
      G.crafts.c2.status = 'repair';
      for (let h = 0; h < 24 * 7; h++) {
        G.t += 3600;
        B.halfHourly(G);
        B.hourly(G);
        if (h % 24 === 23) B.daily(G);
      }
      return G;
    };
    const G1 = run(), G2 = run();
    t.eq(Camp.hash(G1), Camp.hash(G2));
    const j = JSON.parse(JSON.stringify(G1));
    delete j.events;
    const k = JSON.parse(JSON.stringify(j));
    t.eq(j, k);
    t.eq(G1.bases[0].soldiers.length, 13);
    t.ok(G1.researched.indexOf('medikit') >= 0);
    t.eq(G1.crafts.c2.status, 'ready');
  });
};
