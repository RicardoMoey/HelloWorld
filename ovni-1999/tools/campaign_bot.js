/* Bot de campanha headless (DESIGN.md §14, §19.3; contrato docs/CAMPAIGN_API.md §8, §11): joga a campanha inteira
   como um jogador sensato, só através das APIs públicas da estratégia (OV.World, OV.BaseSim, OV.Campaign, OV.Dogfight,
   OV.Save) e do playerBot da batalha (OV.AI, lado X-COM). Usado por `node ovni-1999/tools/sim.js campaign`.

   const Bot = require('./campaign_bot');
   Bot.run({OV?, seed, difficulty, days, saveMidDay?, log?}) → relatório (ver report()); saveMidDay: grava G com
     OV.Save.toJSON no primeiro ponto calmo depois desse dia, carrega com OV.Save.fromJSON e continua (mesmo resultado)
   Bot.create(OV, opts) → bot {G, mem, step(), done(), report(), reload(G)} (para testes: avança uma hora de cada vez)

   O que faz:
   - base em Lisboa; laboratório, contenção e alojamentos no dia 0, radar grande, armazém, oficina, 4.º hangar,
     defesas (mísseis, laser, plasma) e 2.ª contenção quando faz falta; até 50 cientistas e 20 engenheiros, soldados
     para a nave + 6 (+ 8 a partir do mês 2) — sem deixar o saldo mensal previsto abaixo de −400 k$;
   - investigação por prioridades (RESEARCH_PRI): lasers, ligas, armadura, componentes OVNI, plasma, kit médico;
     interrogatórios guardados até darem a bandeira certa (líder depois das Origens, comandante depois da Solução
     Marciana) → Origens → Solução Marciana → Cidónia; Construção OVNI → Firestorm → Vingador (material reservado);
   - interceta OVNIs detetados a ≤ 3 200 mn: Batedor Pequeno só a canhão (cai inteiro), «Cauteloso» quando as armas
     da nave têm mais alcance que a do OVNI, os grandes só com duas armas assim;
   - nave de transporte: terror sempre (ETA ≤ 15 h, ≥ 4 soldados); quedas à luz do dia (as de naves médias ou maiores
     nunca de noite); aterragens a ≤ 2,5 h (de noite só batedores pequenos); no máximo OPTIONAL_PER_MONTH quedas/aterragens
     opcionais por mês, mais uma quando a história para (falta um alienígena vivo, ou ligas para o Vingador ou para as
     armaduras de Cidónia ou do assalto à base alienígena); batedores pequenos e médios só no mês 0, para alienígenas
     vivos ou quando faltam ligas; naves grandes e tripulações de Mutões ou Etéreos só com plasma e ≥ 6 soldados com armadura;
   - bases alienígenas só enquanto a história precisa de um comandante: lasers e ≥ 8 com armadura (Recruta: 4; Veterano e
     Homens-Serpente: plasma; Etéreos: 6 fatos; Mutões: fatos e Cidónia desbloqueada), 12 dias de pausa depois de um
     fracasso; a reserva de material do Vingador só começa depois disso (antes, as ligas vão para as armaduras);
   - Cidónia: a equipa só passa para o Vingador com o material final (12 fatos energéticos; ao fim de 20 dias 12
     armaduras; ao fim de 40, 10) e os Lança-Bombas Blaster (até 10 dias de espera); até lá a Skyranger continua a voar
     (ligas e alienígenas), e o Vingador nunca arrisca outras missões;
   - base localizada (baseSpotted): a nave de transporte volta e fica em casa até a retaliação acabar; descolagens
     contra o Couraçado do ataque sem hipóteses (canFight) desengatam logo;
   - batalhas com OV.AI (lado X-COM) através de Campaign.startMission / finishMission (limite 40 turnos ⇒ abortar);
   - equipa os soldados com o melhor material investigado (armas alienígenas só depois de investigadas, como o
     motor exige), sem passar a Força (acima dela as UT do turno descem; só a arma e o 1.º carregador passam sempre),
     armaduras (os de reserva devolvem as suas), kits médicos, very-lights e granadas (Cidónia: 2 Lança-Bombas
     Blaster); fabrica lasers, plasma (Plasma Pesado para Cidónia), armaduras (a pessoal tapa as baixas), carregadores,
     bombas atordoantes, Blasters, canhões de nave e o Vingador; vende o excedente alienígena e, sem Skyranger, as
     reservas que forem precisas para comprar outra (o Vingador fica para Cidónia).
   A memória do bot (mem) é JSON simples fora de G (é o «jogador»): gravar/carregar G a meio não muda o resultado.
   Só Node (ferramenta); determinístico: mesma semente ⇒ mesmo relatório e mesmo hash. */
'use strict';

const DAY = 86400;
const HOUR = 3600;
const STEP_TICKS = 720; // 1 h de jogo por chamada a World.step (para mais cedo em eventos)
const BATTLE_TURNS = 40;
const OPTIONAL_PER_MONTH = 2; // quedas/aterragens por mês que o bot aceita (orçamento de tempo de um jogador)
const GAP_DAYS = 90; // janela da métrica «intervalo sem OVNIs» (meses 0–2)

// ---- planos fixos ----------------------------------------------------------------------------------------------
// construção por ordem (base inicial orig, grelha 6×6): só começa quando há fundos acima da reserva
// when(bot) opcional: condição extra (investigação, uso do armazém…)
const BUILD = [
  { type: 'laboratory', x: 4, y: 2 },
  { type: 'alien_containment', x: 5, y: 3 },
  { type: 'living_quarters', x: 1, y: 2 },
  { type: 'large_radar', x: 0, y: 3, when: (q) => q.day() >= 5 },
  { type: 'general_stores', x: 5, y: 2, when: (q) => q.storagePct() >= 75 || q.month() >= 1 },
  { type: 'missile_defence', x: 1, y: 1, when: (q) => q.month() >= 1 },
  { type: 'workshop', x: 4, y: 1, when: (q) => q.month() >= 1 || q.has('ufo_construction') },
  { type: 'hangar', x: 2, y: 4, when: (q) => q.has('ufo_construction') || q.month() >= 2 },
  { type: 'living_quarters', x: 0, y: 2, when: (q) => q.month() >= 1 },
  { type: 'missile_defence', x: 1, y: 0, when: (q) => q.month() >= 2 },
  { type: 'alien_containment', x: 4, y: 0, when: (q) => q.aliensPct() >= 60 },
  { type: 'laser_defence', x: 0, y: 1, when: (q) => q.has('laser_defense') && q.month() >= 1 },
  { type: 'plasma_defence', x: 0, y: 0, when: (q) => q.has('plasma_defense') && q.month() >= 2 },
  { type: 'plasma_defence', x: 5, y: 0, when: (q) => q.has('plasma_defense') && q.month() >= 2 },
];

// prioridade dos tópicos (maior primeiro); interrogatórios e autópsias calculados à parte
const RESEARCH_PRI = {
  alien_origins: 100, martian_solution: 100, cydonia: 100,
  laser_weapons: 92, laser_pistol: 90, laser_rifle: 89, alien_alloys: 91, personal_armour: 88,
  elerium: 84, power_source: 84, ufo_navigation: 84, ufo_construction: 83, new_fighter: 82, ultimate_craft: 82,
  small_launcher: 80, heavy_plasma: 78, plasma_rifle: 77, medikit: 70, power_suit: 66, laser_cannon: 60,
  plasma_cannon: 55, alien_grenade: 52, blaster_launcher: 85, heavy_laser: 40, flying_suit: 40, hyper_wave: 35,
  laser_defense: 30, plasma_defense: 25, plasma_pistol: 30, motion_scanner: 10,
  alien_food: 12, alien_surgery: 12, examination_room: 12, alien_reproduction: 12, alien_entertainment: 12,
};
// tópicos cujo dia de conclusão vai para a linha temporal do relatório
const KEY_TOPICS = ['laser_rifle', 'alien_alloys', 'personal_armour', 'medikit', 'elerium', 'power_source', 'ufo_navigation',
  'ufo_construction', 'heavy_plasma', 'plasma_rifle', 'small_launcher', 'alien_origins', 'martian_solution', 'new_fighter',
  'ultimate_craft', 'cydonia'];

// armas por preferência: [arma, carregador|null]
const WEAPONS = [
  ['heavy_plasma', 'heavy_plasma_clip'], ['plasma_rifle', 'plasma_rifle_clip'], ['laser_rifle', null], ['rifle', 'rifle_clip'],
  ['plasma_pistol', 'plasma_pistol_clip'], ['laser_pistol', null], ['pistol', 'pistol_clip'],
];
const ARMOURS = ['flying_suit', 'power_suit', 'personal_armour'];
const SELL_ALWAYS = ['alien_food', 'alien_surgery', 'examination_room', 'alien_reproduction', 'alien_entertainment'];

function create(OV, opts) {
  const o = opts || {};
  const C = OV.Campaign, W = OV.World, BS = OV.BaseSim, D = OV.Data, GM = OV.GMath;
  const log = typeof o.log === 'function' ? o.log : null;
  const difficulty = o.difficulty === undefined ? 1 : o.difficulty | 0;
  const seed = o.seed === undefined ? 1 : o.seed >>> 0;
  const maxT = Math.round((o.days === undefined ? 200 : +o.days) * DAY);

  const bot = {
    G: C.newCampaign({ seed, difficulty }),
    mem: {
      battles: [], dogfights: { started: 0, crashed: 0, destroyed: 0, escaped: 0, other: 0, lost: 0 },
      research: {}, months: [], built: {}, firstCrashT: null, firstBattleT: null, firstDetectT: null, avengerT: null,
      retaliations: [], seaDowns: 0, baseFail: {}, basesFound: [], crashSites: 0, terror: { seen: 0, fought: 0, won: 0, expired: 0 }, lastManageDay: -1,
      sold: 0, pacts: [], spotted: [], detectT: [],
    },
  };

  const say = (msg) => {
    if (log) log(fmtDay(bot.G.t) + ' ' + msg);
  };
  const base = () => bot.G.bases[0] || null;
  const crafts = () => Object.keys(bot.G.crafts).map((id) => bot.G.crafts[id]);
  const craftsOf = (type) => crafts().filter((c) => c.type === type);
  const HANGAR = { ready: 1, repair: 1, rearm: 1, refuel: 1 };
  const AIR = { out: 1, patrol: 1, returning: 1 };
  const stock = (id) => (base() ? base().stores[id] | 0 : 0);
  const has = (topic) => bot.G.researched.indexOf(topic) >= 0;
  const fitSoldiers = (c) => c.soldiers.filter((id) => bot.G.soldiers[id] && !(bot.G.soldiers[id].woundDays > 0)).length;
  const transports = () => crafts().filter((c) => D.crafts[c.type].transport);
  const interceptors = () => crafts().filter((c) => !D.crafts[c.type].transport);
  // base encontrada por uma retaliação (aviso baseSpotted): a equipa fica em casa até o ataque passar
  const threatened = () => !!base() && bot.G.alienMissions.some((m) => m.targetBaseId === base().id);
  const baseReserve = () => 600000 + 150000 * (bot.G.month | 0);
  // a juntar para o Vingador: obras, contratações e fabrico comum esperam (o Vingador usa só a reserva base)
  const saving = () => has('ultimate_craft') && storyPastBase() && !craftsOf('avenger').length && !producing('avenger').length;
  // a história passou a base alienígena: há um comandante vivo ou já interrogado (ou a Solução Marciana)
  const storyPastBase = () => !!(bot.G.flags.martianSolution || bot.G.flags.commanderInterrogated) || liveRank('commander');
  const reserve = () => baseReserve() + (saving() ? D.manufacture.avenger.cost : 0);

  // ---- personagens: força (UT + Pontaria + Saúde) ----------------------------------------------------------------
  const power = (s) => (s.stats.tu | 0) + (s.stats.fire | 0) + (s.stats.hp | 0);

  // ---- construção, pessoal, compras ------------------------------------------------------------------------------
  function manageBuild() {
    const G = bot.G, b = base();
    const q = {
      month: () => G.month | 0, day: () => G.t / DAY, has,
      aliensPct: () => {
        const a = BS.capacities(G, b.id).aliens;
        return a.cap > 0 ? (100 * a.used) / a.cap : 0;
      },
      storagePct: () => {
        const st = BS.capacities(G, b.id).storage;
        return st.cap > 0 ? (100 * st.used) / st.cap : 100;
      },
    };
    for (let k = 0; k < BUILD.length; k++) {
      const p = BUILD[k];
      if (bot.mem.built[k]) continue;
      if (p.when && !p.when(q)) continue;
      const fd = D.facilities[p.type];
      if (G.funds - fd.cost < reserve()) return;
      const r = BS.build(G, b.id, p.type, p.x, p.y);
      if (r.ok) {
        bot.mem.built[k] = G.t;
        say('constrói ' + p.type + ' (' + p.x + ',' + p.y + ')');
      } else if (r.reason !== 'funds') bot.mem.built[k] = -1; // impossível: salta
      else return;
    }
  }

  // 50 cientistas chegam para a árvore comprimida (DESIGN §3.15: ~1 525 dias-cientista até Cidónia)
  function wantScientists() {
    const cap = BS.capacities(bot.G, base().id);
    return Math.min(cap.labs.cap, 50);
  }
  function manageStaff() {
    const G = bot.G, b = base();
    const cap = BS.capacities(G, b.id);
    let room = cap.personnel.cap - cap.personnel.used;
    const pending = (kind) => b.deliveries.filter((d) => d.kind === kind).reduce((s, d) => s + d.n, 0);
    // soldados: lugares da maior nave de transporte (pelo menos os da Skyranger, mesmo sem nave)
    const seats = Math.max(D.crafts.skyranger.seatsUI | 0, ...transports().map((c) => D.crafts[c.type].seatsUI | 0));
    const soldiers = b.soldiers.length + pending('soldier');
    // reservas para repor baixas e guarnição contra retaliações (a defesa automática conta quem está na base)
    const wantSol = seats + ((G.month | 0) >= 2 ? 8 : 6);
    if (soldiers < wantSol && room > 0) {
      const n = Math.min(wantSol - soldiers, room);
      if (G.funds - n * 40000 > 0 && BS.hire(G, b.id, 'soldier', n).ok) {
        room -= n;
        say('contrata ' + n + ' soldados');
      }
    }
    // saldo mensal previsto (receitas − manutenção, já com o pessoal a caminho): não contrata se ficar muito negativo
    const net = () => OV.Economy.income(G) - OV.Economy.upkeep(G).total;
    // cientistas até encher os laboratórios
    const sci = b.scientists + pending('scientist');
    const wantSci = wantScientists();
    if (sci < wantSci && room > 0) {
      let n = Math.min(wantSci - sci, room, 20);
      while (n > 0 && net() - n * 30000 < -400000) n -= 2;
      if (n > 0 && G.funds - n * 30000 > reserve() && BS.hire(G, b.id, 'scientist', n).ok) {
        room -= n;
        say('contrata ' + n + ' cientistas');
      }
    }
    // engenheiros: 20 (o Vingador, 2 400 h, fica pronto em 5 dias; a 2.ª oficina dá o espaço de 36)
    const eng = b.engineers + pending('engineer');
    const wantEng = Math.min(20, cap.workshops.cap);
    if (eng < wantEng && room > 0) {
      let n = Math.min(wantEng - eng, room, 10);
      while (n > 0 && net() - n * 25000 < -400000) n -= 2;
      if (n > 0 && G.funds - n * 25000 > reserve() && BS.hire(G, b.id, 'engineer', n).ok) say('contrata ' + n + ' engenheiros');
    }
  }

  // material barato de reposição (munições de nave, carregadores, granadas, very-lights)
  const RESTOCK = [['stingray_missile', 12, 10], ['cannon_rounds', 8, 10], ['rifle_clip', 24, 20], ['grenade', 10, 10], ['electro_flare', 4, 6]];
  function manageBuy() {
    const G = bot.G, b = base();
    // naves perdidas: repõe a nave de transporte (sempre) e um Intercetor (com fundos)
    const coming = (type) => b.deliveries.filter((d) => d.kind === 'craft' && d.itemId === type).length;
    // sem Skyranger não há campanha (o Vingador fica guardado para Cidónia): vende o que for preciso para a pagar
    if (!craftsOf('skyranger').length && !coming('skyranger')) {
      if (G.funds < D.crafts.skyranger.buy) raiseFunds(D.crafts.skyranger.buy + 100000);
      if (BS.canBuy(G, b.id, 'skyranger', 1) === null && BS.buy(G, b.id, 'skyranger', 1).ok) say('compra Skyranger');
    }
    if (interceptors().length + coming('interceptor') < 2 && G.funds - 600000 > reserve() && BS.canBuy(G, b.id, 'interceptor', 1) === null) {
      if (BS.buy(G, b.id, 'interceptor', 1).ok) say('compra Intercetor');
    }
    for (const c of interceptors()) {
      if (!HANGAR[c.status]) continue;
      c.weapons.forEach((w, slot) => {
        if (w) return;
        const pick = stock('stingray') > 0 ? 'stingray' : stock('cannon') > 0 ? 'cannon' : null;
        if (pick && BS.fitWeapon(G, c.id, slot, pick).ok) say('monta ' + pick + ' em ' + c.id);
      });
    }
    // armas convencionais: uma por soldado (as avançadas contam) — as que se perdem com a nave repõem-se
    const guns = owned('rifle') + owned('laser_rifle') + owned('heavy_plasma') + owned('plasma_rifle');
    const need = b.soldiers.length + 2 - guns;
    if (need > 0 && BS.canBuy(G, b.id, 'rifle', need) === null && G.funds > reserve() * 0.3) {
      BS.buy(G, b.id, 'rifle', need);
      say('compra ' + need + ' espingardas');
    }
    for (const [id, low, n] of RESTOCK) {
      const pending = b.deliveries.filter((d) => d.itemId === id).reduce((s, d) => s + d.n, 0);
      if (stock(id) + pending >= low) continue;
      if (BS.canBuy(G, b.id, id, n) === null && G.funds > reserve() * 0.5) BS.buy(G, b.id, id, n);
    }
  }

  // ---- venda do excedente ------------------------------------------------------------------------------------------
  function keepOf(id) {
    const G = bot.G;
    if (SELL_ALWAYS.indexOf(id) >= 0) return has(id) ? 0 : 1;
    const it = D.items[id];
    if (!it) return Infinity;
    if (it.kind === 'corpse') return it.topic && !has(it.topic) ? 1 : 0;
    if (id === 'alien_alloys') return craftsOf('avenger').length ? 60 : 110;
    if (id === 'elerium_115') return has('cydonia') || craftsOf('avenger').length ? 120 : 160;
    if (id === 'ufo_power_source') return craftsOf('avenger').length ? 1 : 3;
    if (id === 'ufo_navigation') return craftsOf('avenger').length ? 1 : 2;
    const squad = 14;
    if (id === 'heavy_plasma' || id === 'plasma_rifle') return squad;
    if (id === 'heavy_plasma_clip' || id === 'plasma_rifle_clip') return squad * 3;
    if (id === 'plasma_pistol') return has('plasma_pistol') ? 0 : 1;
    if (id === 'plasma_pistol_clip') return has('plasma_pistol') ? 0 : 1;
    if (id === 'small_launcher') return 2;
    if (id === 'stun_bomb') return 8;
    if (id === 'blaster_launcher') return 2;
    if (id === 'blaster_bomb') return 6;
    if (id === 'alien_grenade') return 20;
    if (id === 'laser_pistol' || id === 'laser_rifle') return squad;
    if (id === 'pistol' || id === 'pistol_clip' || id === 'rifle' || id === 'rifle_clip') return Infinity;
    return Infinity;
  }
  // vende material de reserva (do menos ao mais precioso para a história) até ter `target` $
  function raiseFunds(target) {
    const G = bot.G, b = base();
    const order = ['alien_alloys', 'elerium_115', 'ufo_navigation', 'heavy_plasma', 'plasma_rifle', 'ufo_power_source'];
    let got = 0;
    for (const id of order) {
      while (G.funds < target && (b.stores[id] | 0) > 0) {
        const price = D.items[id].sell;
        const n = Math.min(b.stores[id] | 0, Math.max(1, Math.ceil((target - G.funds) / price)));
        if (!BS.sell(G, b.id, id, n).ok) break;
        got += n * price;
      }
    }
    if (got) say('vende reservas para fundos: $' + got);
  }
  function manageSell(force) {
    const G = bot.G, b = base();
    const ids = Object.keys(b.stores).sort();
    let got = 0;
    const what = [];
    for (const id of ids) {
      const it = D.items[id];
      if (!it || !(it.sell > 0)) continue;
      const keep = keepOf(id);
      if (keep === Infinity) continue;
      const n = (b.stores[id] | 0) - keep;
      if (n <= 0) continue;
      if (BS.sell(G, b.id, id, n).ok) {
        got += n * it.sell;
        what.push(n + '× ' + id);
      }
    }
    // aperto de fundos: vende também peças de reserva
    if (force && G.funds + got < 0) {
      for (const id of ['ufo_power_source', 'ufo_navigation', 'alien_alloys', 'elerium_115']) {
        const n = Math.floor((b.stores[id] | 0) / 2);
        if (n > 0 && BS.sell(G, b.id, id, n).ok) got += n * D.items[id].sell;
      }
    }
    if (got) {
      bot.mem.sold += got;
      say('vende ' + what.join(', ') + ': $' + got);
    }
  }

  // ---- investigação ---------------------------------------------------------------------------------------------------
  function interrogationScore(topic) {
    const G = bot.G;
    const t = D.researchTopic(topic);
    if (!t) return -1;
    const fx = D.researchEffects(topic, G.researched, G.flags);
    const rank = t.rank;
    const fl = G.flags;
    // a bandeira só conta se o tópico «depois» já estiver concluído quando o interrogatório acaba: espera por ele
    if (rank === 'commander') {
      if (!fl.commanderInterrogated && has('martian_solution')) return 99;
      // só gasta o comandante na bandeira do líder se não houver um líder à espera
      if (!fl.leaderInterrogated && has('alien_origins') && !liveRank('leader') && !interrogating('leader')) return 97;
      return -1; // guarda o comandante para quando der a bandeira
    }
    if (rank === 'leader') {
      if (!fl.leaderInterrogated && has('alien_origins') && !interrogating('leader') && !interrogating('commander')) return 98;
      if (!fl.interrogated && !otherLiveAlien(t.unit)) return 60;
      return -1;
    }
    if (!fl.interrogated) return 96;
    if (rank === 'navigator' && !fl.navigatorInterrogated) return 20;
    return fx && fx.points > 0 && !has(topic) ? 15 : -1;
  }
  function interrogating(rank) {
    return base().research.some((p) => {
      const t = D.researchTopic(p.topic);
      return !!t && t.interrogation && t.rank === rank;
    });
  }
  function liveRank(rank) {
    const b = base();
    return Object.keys(b.aliens).some((k) => {
      const rr = D.unitRankRace(k);
      return !!rr && rr.rank === rank;
    });
  }
  function otherLiveAlien(unit) {
    const b = base();
    for (const k of Object.keys(b.aliens)) {
      if (k === unit) continue;
      const rr = D.unitRankRace(k);
      if (rr && rr.rank !== 'leader' && rr.rank !== 'commander') return true;
    }
    return false;
  }
  function topicScore(topic) {
    if (topic.indexOf('interrogate_') === 0) return interrogationScore(topic);
    if (topic.indexOf('autopsy_') === 0) return 34;
    const p = RESEARCH_PRI[topic];
    return p === undefined ? 5 : p;
  }
  function manageResearch() {
    const G = bot.G, b = base();
    const avail = C.availableResearch(G, b.id).map((t) => ({ t, s: topicScore(t) })).filter((x) => x.s >= 0);
    avail.sort((a, b2) => b2.s - a.s || (a.t < b2.t ? -1 : 1));
    const proj = b.research.map((p) => ({ p, s: topicScore(p.topic) }));
    proj.sort((a, b2) => b2.s - a.s || (a.p.topic < b2.p.topic ? -1 : 1));
    // cada projeto leva até ⌈restante/3⌉ cientistas (acaba em ≥ 3 dias, desperdício pequeno), máx. 30
    const want = (cost, spent) => Math.max(1, Math.min(30, Math.ceil(Math.max(1, cost - spent) / 3)));
    // primeiro liberta todos e volta a distribuir por prioridade
    for (const x of proj) BS.setScientists(G, b.id, x.p.topic, 0);
    let free = BS.staff(G, b.id).scientists.free;
    for (const x of proj) {
      if (free <= 0) break;
      const n = Math.min(free, want(x.p.cost, x.p.spent));
      if (BS.setScientists(G, b.id, x.p.topic, n).ok) free -= n;
    }
    for (const x of avail) {
      if (free <= 0) break;
      const t = D.researchTopic(x.t);
      const n = Math.min(free, want(t.cost, 0));
      const r = BS.startResearch(G, b.id, x.t, n);
      if (r.ok) {
        free -= n;
        say('investiga ' + x.t + ' (' + n + ' cientistas)');
      }
    }
  }

  // ---- fabrico -------------------------------------------------------------------------------------------------------
  function producing(item) {
    return base().production.filter((p) => p.item === item);
  }
  function owned(id) {
    // em armazém + a bordo de naves + nos modelos dos soldados (armaduras: vestidas)
    const G = bot.G;
    let n = stock(id);
    for (const c of crafts()) n += c.equipment[id] | 0;
    for (const sid of Object.keys(G.soldiers)) if (G.soldiers[sid].armour === id) n++;
    return n;
  }
  // material reservado para o Vingador (a partir de Construção OVNI, até estar construído): ligas, fontes, navegação
  function reservedFor() {
    const out = {};
    const avenger = craftsOf('avenger').length > 0 || producing('avenger').length > 0;
    // só depois de haver um comandante (vivo ou interrogado): antes disso as ligas vão para as armaduras que a história
    // precisa (assalto à base alienígena)
    if (avenger || !has('ufo_construction') || !storyPastBase()) return out;
    const m = D.manufacture.avenger.materials;
    for (const k of Object.keys(m)) out[k] = m[k];
    const psMissing = Math.max(0, (m.ufo_power_source | 0) - stock('ufo_power_source'));
    const navMissing = Math.max(0, (m.ufo_navigation | 0) - stock('ufo_navigation'));
    const add = (k, n) => { out[k] = (out[k] | 0) + n; };
    for (const k of Object.keys(D.manufacture.ufo_power_source.materials)) add(k, psMissing * D.manufacture.ufo_power_source.materials[k]);
    for (const k of Object.keys(D.manufacture.ufo_navigation.materials)) add(k, navMissing * D.manufacture.ufo_navigation.materials[k]);
    return out;
  }
  function wantedProduction() {
    const out = [];
    const squad = 12;
    const pending = (item) => producing(item).reduce((s, p) => s + Math.max(0, p.qty - p.done), 0);
    const avenger = craftsOf('avenger').length > 0 || producing('avenger').length > 0;
    // o Vingador e as suas peças usam a reserva (forAvenger); o resto só o material acima dela
    const story = storyPastBase();
    if (has('ultimate_craft') && !avenger && story) out.push({ item: 'avenger', qty: 1, pri: 100, forAvenger: true });
    if (has('ufo_construction') && !avenger && story) {
      if (stock('ufo_power_source') < 2 && has('power_source')) out.push({ item: 'ufo_power_source', qty: 1, pri: 99, forAvenger: true });
      if (stock('ufo_navigation') < 1 && has('ufo_navigation')) out.push({ item: 'ufo_navigation', qty: 1, pri: 99, forAvenger: true });
    }
    // Plasma Pesado (1 liga) para os 12 de Cidónia; antes disso espingardas de plasma (1 liga) para a equipa
    if (has('heavy_plasma') && bot.G.flags.cydoniaUnlocked) {
      const n = owned('heavy_plasma') + pending('heavy_plasma');
      if (n < 12) out.push({ item: 'heavy_plasma', qty: Math.min(2, 12 - n), pri: 97, forAvenger: craftsOf('avenger').length > 0 });
    } else if (has('plasma_rifle') && !baseArmourShort()) {
      const n = owned('heavy_plasma') + owned('plasma_rifle') + pending('plasma_rifle');
      if (n < 10) out.push({ item: 'plasma_rifle', qty: Math.min(2, 10 - n), pri: 89 });
    }
    // espingardas laser (sem ligas) repõem as armas avançadas perdidas com as baixas, mesmo depois do plasma
    if (has('laser_rifle')) {
      const n = owned('laser_rifle') + owned('heavy_plasma') + owned('plasma_rifle') + pending('laser_rifle');
      if (n < squad) out.push({ item: 'laser_rifle', qty: Math.min(4, squad - n), pri: 90 });
    }
    // armaduras primeiro: podem usar a reserva de ligas do Vingador (sobreviver vem antes). A armadura pessoal tapa
    // os buracos (baixas levam a armadura) mesmo depois dos fatos energéticos, que custam mais ligas e Elerium.
    const suitsN = owned('power_suit') + owned('flying_suit') + pending('power_suit');
    const armouredN = suitsN + owned('personal_armour') + pending('personal_armour');
    if (has('power_suit')) {
      // fase final: fatos para os 12 de Cidónia antes de tudo — mas só com o Vingador feito ou em fabrico (as ligas
      // reservadas para ele não vão para os fatos quando Cidónia é investigada antes da nave)
      const last = !!bot.G.flags.cydoniaUnlocked && avenger;
      if (suitsN < squad) out.push({ item: 'power_suit', qty: Math.min(2, squad - suitsN), pri: last ? 101 : 80, forAvenger: last });
    }
    if (has('personal_armour') && armouredN < squad && !(bot.G.flags.cydoniaUnlocked && has('power_suit'))) {
      out.push({ item: 'personal_armour', qty: Math.min(2, squad - armouredN), pri: 95, forAvenger: armouredN < 6 && !has('ultimate_craft') });
    }
    // Lança-Bombas Blaster para Cidónia (o Cérebro e os Sectopodes; DESIGN §14 fase final)
    if (has('blaster_launcher') && (bot.G.flags.martianSolution || bot.G.flags.cydoniaUnlocked)) {
      if (owned('blaster_launcher') + pending('blaster_launcher') < 2) out.push({ item: 'blaster_launcher', qty: 1, pri: 96 });
      if (owned('blaster_bomb') + pending('blaster_bomb') < 6) out.push({ item: 'blaster_bomb', qty: 2, pri: 96 });
    }
    if (has('medikit') && owned('medikit') + pending('medikit') < 4) out.push({ item: 'medikit', qty: 1, pri: 75 });
    if (has('alien_grenade') && bot.G.flags.martianSolution && owned('alien_grenade') + pending('alien_grenade') < 12) out.push({ item: 'alien_grenade', qty: 4, pri: 74 });
    if (has('heavy_plasma') && owned('heavy_plasma_clip') < 2 * Math.min(squad, owned('heavy_plasma'))) out.push({ item: 'heavy_plasma_clip', qty: 6, pri: 88 });
    if (has('plasma_rifle') && owned('plasma_rifle_clip') < 2 * Math.min(squad, owned('plasma_rifle'))) out.push({ item: 'plasma_rifle_clip', qty: 6, pri: 87 });
    if (has('small_launcher') && owned('stun_bomb') < 4) out.push({ item: 'stun_bomb', qty: 4, pri: 86 });
    if (has('laser_cannon') && !has('plasma_cannon')) {
      const fitted = interceptors().reduce((s, c) => s + c.weapons.filter((w) => w && w.type === 'laser_cannon').length, 0);
      if (fitted + stock('laser_cannon') < 2) out.push({ item: 'laser_cannon', qty: 1, pri: 60 });
    }
    if (has('plasma_cannon')) {
      const fitted = interceptors().reduce((s, c) => s + c.weapons.filter((w) => w && w.type === 'plasma_beam').length, 0);
      if (fitted + stock('plasma_beam') < 2) out.push({ item: 'plasma_beam', qty: 1, pri: 62 });
    }
    if (has('new_fighter') && avenger && craftsOf('firestorm').length === 0 && craftsOf('skyranger').length) out.push({ item: 'firestorm', qty: 1, pri: 50 });
    return out.sort((a, b) => b.pri - a.pri);
  }
  function manageProduction() {
    const G = bot.G, b = base();
    // tira os engenheiros de ordens paradas (falta de material) e volta a distribuir
    for (const p of b.production.slice()) {
      if (p.stalled === 'materials' && !p.paid) BS.cancelProduction(G, b.id, p.id);
    }
    const wanted = wantedProduction();
    const held = reservedFor();
    for (const w of wanted) {
      if (producing(w.item).length) continue;
      if (D.manufactureAvailable(G.researched).indexOf(w.item) < 0) continue;
      const m = D.manufacture[w.item];
      let okMat = true;
      for (const it of Object.keys(m.materials)) {
        if (stock(it) - (w.forAvenger ? 0 : held[it] | 0) < m.materials[it] * w.qty) okMat = false;
      }
      // o Vingador custa 900 k$: junta-se dinheiro para ele (só a reserva normal fica de fora)
      if (!okMat || G.funds - m.cost < (w.forAvenger ? baseReserve() * 0.5 : reserve())) continue;
      const r = BS.startProduction(G, b.id, w.item, 0, w.qty);
      if (r.ok) say('fabrica ' + w.qty + '× ' + w.item);
    }
    // engenheiros por prioridade (ordens desejadas primeiro)
    const pri = {};
    wanted.forEach((w, i) => { pri[w.item] = 100 - i; });
    const prods = b.production.slice().sort((a, c) => (pri[c.item] | 0) - (pri[a.item] | 0) || (a.id < c.id ? -1 : 1));
    for (const p of prods) BS.setEngineers(G, b.id, p.id, 0);
    let free = BS.staff(G, b.id).engineers.free;
    for (const p of prods) {
      if (free <= 0) break;
      // ordem parada por pagar (armazém cheio, sem hangar, sem fundos): os engenheiros vão para a seguinte (o
      // BaseSim volta a tentar pagá-la a cada hora; sem isto um fato parado pelo armazém prendia o Vingador)
      if (p.stalled && !p.paid) continue;
      const ws = BS.capacities(G, b.id).workshops;
      const n = Math.min(free, ws.cap - ws.used);
      if (n > 0 && BS.setEngineers(G, b.id, p.id, n).ok) free -= n;
    }
  }

  // ---- soldados e equipamento ---------------------------------------------------------------------------------------
  function squadCraft() {
    // o Vingador fica guardado para Cidónia (perdê-lo custa ligas, fontes de energia e semanas); as missões comuns
    // vão na Skyranger. Sem Skyranger, a nave de transporte com mais lugares.
    const G = bot.G;
    const t = transports().sort((a, b) => (D.crafts[b.type].seatsUI | 0) - (D.crafts[a.type].seatsUI | 0) || (a.id < b.id ? -1 : 1));
    const sky = t.find((c) => c.type === 'skyranger');
    // Cidónia desbloqueada: a equipa só passa para o Vingador com o material final pronto; até lá a Skyranger continua a
    // trazer ligas (armaduras) e alienígenas
    if (sky && !(G.flags.cydoniaUnlocked && craftsOf('avenger').length && finalKitReady())) return sky;
    return t[0] || null;
  }
  // material para Cidónia: 12 fatos energéticos; ao fim de 20 dias, 12 armaduras quaisquer; ao fim de 40, 10
  function finalKitReady() {
    const G = bot.G;
    if (!G.flags.cydoniaUnlocked) return false;
    if (bot.mem.cydoniaT === undefined) bot.mem.cydoniaT = G.t;
    const waited = G.t - bot.mem.cydoniaT;
    const suits = owned('power_suit') + owned('flying_suit');
    const armoured = suits + owned('personal_armour');
    const seats = D.crafts.avenger.seatsUI;
    return suits >= seats || waited >= 20 * DAY && armoured >= seats || waited >= 40 * DAY && armoured >= 10;
  }
  function manageSquad() {
    const G = bot.G;
    const main = squadCraft();
    if (!main || !HANGAR[main.status]) return;
    // tira os soldados de outras naves de transporte no hangar
    for (const c of transports()) {
      if (c.id === main.id || !HANGAR[c.status]) continue;
      for (const sid of c.soldiers.slice()) BS.assignSoldier(G, sid, null);
    }
    const fit = base().soldiers.map((id) => G.soldiers[id]).filter((s) => s && !(s.woundDays > 0));
    const seats = D.crafts[main.type].seatsUI | 0;
    fit.sort((a, b) => power(b) - power(a) || b.missions - a.missions || (a.id < b.id ? -1 : 1));
    const chosen = new Set(fit.slice(0, seats).map((s) => s.id));
    for (const sid of main.soldiers.slice()) if (!chosen.has(sid)) BS.assignSoldier(G, sid, null);
    for (const s of fit.slice(0, seats)) if (s.craftId !== main.id) BS.assignSoldier(G, s.id, main.id);
    // armaduras: os soldados de reserva devolvem as suas ao armazém (a equipa da nave veste primeiro), depois a melhor
    // que houver em armazém
    for (const sid of base().soldiers) {
      const s = G.soldiers[sid];
      if (s && s.craftId !== main.id && ARMOURS.indexOf(s.armour) >= 0) BS.setArmour(G, sid, 'coveralls');
    }
    for (const sid of main.soldiers) {
      const s = G.soldiers[sid];
      for (const a of ARMOURS) {
        if (!has(a)) continue;
        if (s.armour === a) break;
        if (ARMOURS.indexOf(s.armour) >= 0 && ARMOURS.indexOf(s.armour) < ARMOURS.indexOf(a)) break;
        if (stock(a) > 0 && BS.setArmour(G, sid, a).ok) break;
      }
    }
    equipCraft(main);
  }

  function equipCraft(craft) {
    const G = bot.G;
    if (!HANGAR[craft.status]) return;
    const pool = C.equipPool(G, craft.id);
    const bag = Object.assign({}, pool.stores);
    const add = (id, n) => {
      bag[id] = (bag[id] | 0) + n;
      if (!bag[id]) delete bag[id];
    };
    const takeIt = (id) => {
      if ((bag[id] | 0) <= 0 || !usable(id)) return false;
      add(id, -1);
      return true;
    };
    for (const s of pool.squad) {
      const lo = s.loadout;
      for (const it of [lo.R, lo.L].concat(lo.belt || [], lo.pack || [])) if (it) add(it, 1);
    }
    // material alienígena só depois de investigado (o jogador ainda não sabe usá-lo); o resto fica em R
    const usable = (id) => {
      const it = D.items[id];
      return !!it && (!it.research || has(it.research));
    };
    const avail = (id) => (usable(id) ? bag[id] | 0 : 0);
    const team = pool.squad.slice().sort((a, b) => b.stats.fire - a.stats.fire || (a.id < b.id ? -1 : 1));
    const strongest = pool.squad.slice().sort((a, b) => b.stats.str - a.stats.str || (a.id < b.id ? -1 : 1));
    const loadouts = {};
    const fits = (lo, slot, it) => D.fitsSlot(it, slot, lo[slot]);
    // peso: acima da Força as UT do turno descem na proporção (BUnits.turnTU) — só a arma e o 1.º carregador passam
    const wt = (id) => (D.items[id] ? D.items[id].weight | 0 : 0);
    const cur = { load: 0, cap: 0, force: false };
    const light = (it) => cur.force || cur.load + wt(it) <= cur.cap;
    const putBelt = (lo, it) => {
      if (light(it) && fits(lo, 'belt', it) && takeIt(it)) {
        lo.belt.push(it);
        cur.load += wt(it);
        return true;
      }
      return false;
    };
    const putPack = (lo, it) => {
      if (light(it) && fits(lo, 'pack', it) && takeIt(it)) {
        lo.pack.push(it);
        cur.load += wt(it);
        return true;
      }
      return false;
    };
    const putHand = (lo, it) => {
      if (!takeIt(it)) return false;
      lo.R = it;
      cur.load += wt(it);
      return true;
    };
    const advanced = avail('laser_rifle') + avail('heavy_plasma') + avail('plasma_rifle') >= Math.ceil(team.length / 2);
    // papéis: atordoador (Lançador Pequeno), canhão pesado (só sem armas avançadas), médicos
    const final = !!G.flags.cydoniaUnlocked;
    const stunner = !final && avail('small_launcher') > 0 && avail('stun_bomb') > 0 ? strongest.find((s) => s.stats.str >= 30) || null : null;
    const heavy = !advanced && avail('heavy_cannon') > 0 && team.length > 3 ? strongest.find((s) => s !== stunner) : null;
    // Cidónia: até dois Lança-Bombas Blaster nos mais fortes (com bombas)
    const blasters = new Set();
    if (final && avail('blaster_bomb') >= 2) {
      for (const s of strongest) {
        if (blasters.size >= Math.min(2, avail('blaster_launcher'), avail('blaster_bomb') >> 1)) break;
        if (s !== stunner && s !== heavy && s.stats.str >= 25) blasters.add(s);
      }
    }
    let medics = 0, flares = 0, smoke = 0;
    for (const s of team) {
      const lo = { R: null, L: null, belt: [], pack: [] };
      Object.assign(cur, { load: 0, cap: s.stats.str | 0, force: true });
      if (s === stunner) {
        putHand(lo, 'small_launcher');
        putBelt(lo, 'stun_bomb');
        cur.force = false;
        for (let k = 0; k < 2; k++) putBelt(lo, 'stun_bomb');
      } else if (blasters.has(s)) {
        putHand(lo, 'blaster_launcher');
        putBelt(lo, 'blaster_bomb');
        cur.force = false;
        putBelt(lo, 'blaster_bomb');
        if (!putPack(lo, 'blaster_bomb')) putBelt(lo, 'blaster_bomb');
      } else if (s === heavy) {
        putHand(lo, 'heavy_cannon');
        if (!putBelt(lo, 'hc_he')) putBelt(lo, 'hc_ap');
        cur.force = false;
        putBelt(lo, 'hc_ap');
      } else {
        for (const [w, clip] of WEAPONS) {
          if (avail(w) <= 0) continue;
          if (clip && avail(clip) <= 0) continue;
          putHand(lo, w);
          if (clip) putBelt(lo, clip);
          cur.force = false;
          if (clip) putBelt(lo, clip);
          break;
        }
      }
      cur.force = false;
      if (!putBelt(lo, 'alien_grenade')) putBelt(lo, 'grenade');
      if (flares < 4 && putBelt(lo, 'electro_flare')) flares++;
      if (medics < (final ? 3 : 2) && s !== stunner && putPack(lo, 'medikit')) medics++;
      if (final) while (putBelt(lo, 'alien_grenade'));
      if (smoke < 2 && s !== stunner && putPack(lo, 'smoke_grenade')) smoke++;
      loadouts[s.id] = lo;
    }
    const r = C.applyEquip(G, craft.id, { loadouts, stores: bag });
    if (!r.ok) say('equipar recusado: ' + r.reason);
  }

  // armas das naves de interceção: o melhor canhão de feixe que houver em armazém
  function manageCraftWeapons() {
    const G = bot.G;
    for (const c of interceptors()) {
      if (!HANGAR[c.status]) continue;
      for (const w of ['plasma_beam', 'laser_cannon']) {
        if (stock(w) <= 0) continue;
        // substitui primeiro o canhão, depois os mísseis
        const order = [];
        c.weapons.forEach((x, i) => order.push(i));
        order.sort((a, b) => rankW(c.weapons[a]) - rankW(c.weapons[b]));
        for (const slot of order) {
          if (stock(w) <= 0) break;
          if (rankW(c.weapons[slot]) >= rankW({ type: w })) continue;
          if (BS.fitWeapon(G, c.id, slot, w).ok) say('monta ' + w + ' em ' + c.id);
        }
      }
    }
  }
  function rankW(w) {
    if (!w) return 0;
    return { cannon: 1, stingray: 2, avalanche: 3, laser_cannon: 4, plasma_beam: 5 }[w.type] || 0;
  }

  // ---- interceção ---------------------------------------------------------------------------------------------------------
  function armedFor(c) {
    return c.weapons.some((w) => w && (w.ammo === null || w.ammo > 0));
  }
  // como um jogador cauteloso: OVNIs até ao tamanho médio sempre; os grandes só com duas armas que disparam de fora do
  // alcance da arma deles (o modo «Cauteloso» mantém essa distância) e casco para o aguentar
  function canFight(c, ufo) {
    const udef = D.ufos[ufo.type];
    if (udef.size <= 2) return true;
    const ws = c.weapons.filter((w) => w && (w.ammo === null || w.ammo > 0));
    const outrange = ws.filter((w) => D.craftWeapons[w.type].range > udef.weapon.range).length;
    return outrange >= 2 && udef.hp <= 3 * ws.reduce((s, w) => s + D.craftWeapons[w.type].dmg, 0) * 4;
  }
  function launchable(c) {
    if (c.status === 'ready') return true;
    if (!HANGAR[c.status]) return false;
    const def = D.crafts[c.type];
    return c.fuel * 2 >= def.fuel && c.hp * 2 >= def.hp && armedFor(c);
  }
  function chasing(ufoId) {
    return crafts().filter((c) => AIR[c.status] && c.dest && c.dest.kind === 'ufo' && c.dest.id === ufoId);
  }
  function manageIntercepts() {
    const G = bot.G, b = base();
    for (const u of G.ufos) {
      if (u.status !== 'flying' || !u.detected) continue;
      if (chasing(u.id).some((c) => !D.crafts[c.type].transport)) continue;
      const d = GM.distNm(b, u);
      if (d > 3200) continue;
      const free = interceptors().filter((c) => launchable(c) && armedFor(c) && canFight(c, u));
      if (!free.length) continue;
      free.sort((a, c) => rankW(c.weapons[0]) + rankW(c.weapons[1]) - rankW(a.weapons[0]) - rankW(a.weapons[1]) || (a.id < c.id ? -1 : 1));
      const n = D.ufos[u.type].size >= 2 ? 2 : 1;
      for (const c of free.slice(0, n)) {
        const r = W.order(G, c.id, { kind: 'ufo', id: u.id });
        if (r.ok) say('interceta ' + u.type + ' com ' + c.id + (r.warn ? ' (' + r.warn + ')' : ''));
      }
    }
  }

  function resolveDogfight(id) {
    const G = bot.G;
    const df = C.findDogfight(G, id);
    if (!df) return;
    const ufo = C.findUfo(G, df.ufoId);
    const craft = C.findCraft(G, df.craftId);
    bot.mem.dogfights.started++;
    let mode = 'standard';
    if (ufo && craft && D.ufos[ufo.type].size === 0) {
      // Batedor Pequeno: só o canhão (cai inteiro); com feixes, normal
      craft.weapons.forEach((w, slot) => {
        if (w && w.type === 'stingray' && craft.weapons.some((x) => x && x.type === 'cannon' && x.ammo > 0)) OV.Dogfight.toggleWeapon(G, id, slot);
      });
    }
    // fora do alcance da arma do OVNI: «Cauteloso» (alcance mais longo) dispara sem levar tiros
    if (ufo && craft && ufo.targetBaseId && !canFight(craft, ufo)) mode = 'disengage'; // descolagem sem hipóteses
    else if (ufo && craft) {
      const reach = Math.max(0, ...craft.weapons.filter((w) => w && (w.ammo === null || w.ammo > 0)).map((w) => D.craftWeapons[w.type].range));
      if (D.ufos[ufo.type].weapon.range > 0 && reach > D.ufos[ufo.type].weapon.range) mode = 'cautious';
    }
    const out = OV.Dogfight.autoResolve(G, id, mode);
    if (out === 'crashed') {
      bot.mem.dogfights.crashed++;
      const u2 = ufo ? C.findUfo(G, ufo.id) : null;
      if (!u2 || u2.status !== 'crashed') bot.mem.seaDowns++;
    }
    else if (out === 'destroyed') bot.mem.dogfights.destroyed++;
    else if (out === 'escaped') bot.mem.dogfights.escaped++;
    else if (out === 'craftDestroyed') bot.mem.dogfights.lost++;
    else bot.mem.dogfights.other++;
    say('dogfight ' + (ufo ? ufo.type : '?') + ' → ' + out);
  }

  // ---- missões terrestres ---------------------------------------------------------------------------------------------
  // % dos soldados a bordo com uma arma laser ou de plasma no modelo
  function advancedShare(c) {
    const G = bot.G;
    const ids = c.soldiers.filter((id) => G.soldiers[id]);
    if (!ids.length) return 0;
    const adv = ids.filter((id) => /laser|plasma/.test(G.soldiers[id].loadout.R || '')).length;
    return Math.round((100 * adv) / ids.length);
  }
  function gearLevel() {
    // 0 espingardas, 1 lasers/plasma (mistura), 2 plasma — contam as armas de todos os tipos juntas
    const plasma = owned('heavy_plasma') + owned('plasma_rifle');
    if (plasma >= 6) return 2;
    if (plasma + owned('laser_rifle') >= 6) return 1;
    return 0;
  }
  // assalto a uma base alienígena: lasers e ≥ 4 com armadura (ou plasma) e nenhum fracasso nos últimos 20 dias
  // (Mutões: plasma e fatos energéticos — e sem comandante para capturar, por isso só depois da história)
  function readyForBase(ab) {
    const G = bot.G;
    const c = squadCraft();
    if (!c || gearLevel() < 1) return false;
    const armoured = c.soldiers.filter((id) => G.soldiers[id] && ARMOURS.indexOf(G.soldiers[id].armour) >= 0).length;
    const suits = c.soldiers.filter((id) => G.soldiers[id] && (G.soldiers[id].armour === 'power_suit' || G.soldiers[id].armour === 'flying_suit')).length;
    // sem armadura um assalto falhado custa a equipa inteira (os de fato-macaco morrem primeiro); Recruta: alienígenas com
    // metade da Pontaria e da armadura, chegam 4
    if (armoured < (G.difficulty >= 1 ? 8 : 4)) return false;
    if (G.difficulty >= 1 && gearLevel() < 2) return false; // Veterano: só com plasma (lasers + armadura ≈ 58 %, plasma ≈ 90 %)
    if (ab.race === 'muton' && (gearLevel() < 2 || suits < 8 || !G.flags.cydoniaUnlocked)) return false;
    if (ab.race === 'snakeman' && gearLevel() < 2) return false; // Crisálidas: só com plasma
    if (ab.race === 'ethereal' && suits < 6) return false; // Etéreos: plasma pesado e fatos
    // depois do comandante interrogado a história já não precisa de bases (o resto é pontuação e risco)
    if (G.flags.commanderInterrogated || liveRank('commander')) return false;
    const last = bot.mem.baseFail[ab.id];
    return last === undefined || G.t - last > 12 * DAY;
  }
  // orçamento de tempo de um jogador (2–4 h): no máximo OPTIONAL_PER_MONTH batalhas opcionais (quedas e aterragens)
  // por mês, salvo quando a história precisa de alienígenas vivos ou o Vingador de ligas
  function optionalThisMonth() {
    const G = bot.G;
    return bot.mem.battles.filter((b) => (b.kind === 'crash' || b.kind === 'landed') && b.month === (G.month | 0)).length;
  }
  // ligas que fazem falta: reserva do Vingador + armaduras pessoais em falta para uma equipa de 10 + (fase final, com o
  // Vingador feito) fatos energéticos para os 12 de Cidónia + margem
  function alloysWanted() {
    const armoured = owned('personal_armour') + owned('power_suit') + owned('flying_suit');
    const suits = owned('power_suit') + owned('flying_suit');
    const final = !!bot.G.flags.cydoniaUnlocked && craftsOf('avenger').length > 0;
    let missing = has('personal_armour') ? 2 * Math.max(0, 10 - armoured) : 0;
    if (final) missing = has('power_suit') ? 3 * Math.max(0, 12 - suits) : 2 * Math.max(0, 12 - armoured);
    return (reservedFor().alien_alloys | 0) + missing + 10;
  }
  // a história espera pela base alienígena e faltam armaduras para o assalto (readyForBase)
  function baseArmourShort() {
    const G = bot.G;
    if (G.flags.commanderInterrogated || liveRank('commander') || !has('personal_armour')) return false;
    const armoured = owned('personal_armour') + owned('power_suit') + owned('flying_suit');
    return armoured < (G.difficulty >= 1 ? 8 : 4);
  }
  function worthIt(u) {
    const G = bot.G;
    const size = D.ufos[u.type].size;
    const live = Object.keys(base().aliens).length > 0;
    const needLive = !G.flags.interrogated && !live && BS.capacities(G, base().id).aliens.cap > 0;
    const alloysShort = stock('alien_alloys') < alloysWanted();
    const optional = optionalThisMonth();
    const budget = OPTIONAL_PER_MONTH;
    if (optional >= budget) {
      // uma batalha extra no mês quando a história para: falta um alienígena vivo, ou ligas para o Vingador ou para as
      // armaduras de Cidónia
      const noAvenger = has('ultimate_craft') && storyPastBase() && !craftsOf('avenger').length && !producing('avenger').length;
      const blocked = alloysShort && size >= 1 && (noAvenger || !!G.flags.cydoniaUnlocked && !finalKitReady() || baseArmourShort());
      if (!((needLive || blocked) && optional < budget + 1)) return false;
    }
    return worthItSize(u, size, needLive, alloysShort);
  }
  function worthItSize(u, size, needLive, alloysShort) {
    const G = bot.G;
    if (size >= 2) return true;
    if (needLive) return true;
    if ((G.month | 0) < 1) return true;
    // batedores médios e grandes: ligas quando faltam para o Vingador e as armaduras
    return alloysShort && size >= 1;
  }
  // como um jogador cauteloso: naves grandes (Ceifeira para cima) e tripulações de Mutões ou Etéreos só com plasma e
  // pelo menos 6 soldados com armadura na nave; aterragens de batedores médios/grandes pelo menos com lasers
  function fightable(u) {
    const G = bot.G;
    const c = squadCraft();
    if (!c) return false;
    const size = D.ufos[u.type].size;
    const armoured = c.soldiers.filter((id) => G.soldiers[id] && ARMOURS.indexOf(G.soldiers[id].armour) >= 0).length;
    const strong = gearLevel() >= 2 && armoured >= 6;
    if ((size >= 2 || u.race === 'muton' || u.race === 'ethereal') && !strong) return false;
    if (u.status === 'landed' && size >= 1 && gearLevel() < 1 && (G.month | 0) >= 1) return false;
    return true;
  }
  function etaH(c, p) {
    return GM.distNm(c, p) / D.crafts[c.type].speed;
  }
  function groundTargets() {
    const G = bot.G;
    const out = [];
    const lvl = gearLevel();
    for (const u of G.ufos) {
      if (!u.detected && u.status !== 'crashed') continue;
      if (u.status !== 'crashed' && u.status !== 'landed') continue;
      const size = D.ufos[u.type].size;
      if (size >= 3 && lvl < 1) continue;
      // batedores pequenos e médios só valem a viagem no início ou quando faltam alienígenas vivos ou ligas
      if (!worthIt(u)) continue;
      if (!fightable(u)) continue;
      if (u.type === 'battleship' && lvl < 2 && G.month < 3) continue;
      out.push({ ref: { kind: 'ufo', id: u.id }, obj: u, kind: u.status, pri: u.status === 'landed' ? 3 : 2 });
    }
    for (const s of G.sites) out.push({ ref: { kind: 'site', id: s.id }, obj: s, kind: 'terror', pri: 4 });
    for (const a of G.alienBases) {
      if (!a.discovered) continue;
      if (lvl < 1 && G.month < 2) continue;
      out.push({ ref: { kind: 'alienBase', id: a.id }, obj: a, kind: 'alienBase', pri: 1 });
    }
    return out.sort((a, b) => b.pri - a.pri);
  }
  function manageGround() {
    const G = bot.G;
    const c = squadCraft();
    if (!c) return;
    // a caminho de um alvo: se outro mais urgente aparecer (terror), muda de rumo
    const busy = AIR[c.status];
    if (busy && c.status === 'returning') return;
    if (threatened()) {
      if (busy) W.recall(G, c.id);
      return;
    }
    if (!busy && !launchable(c)) return;
    // fase final: Cidónia desbloqueada e Vingador pronto ⇒ a equipa espera por Cidónia (sem arriscar o Vingador)
    if (G.flags.cydoniaUnlocked && c.type === 'avenger') return;
    const fit = fitSoldiers(c);
    if (fit < 4) return;
    // missões opcionais só com equipa composta e armada para o mês (do mês 2 em diante, lasers ou plasma)
    const armedNow = (G.month | 0) < 2 || gearLevel() >= 1 && advancedShare(c) >= 50;
    for (const tg of groundTargets()) {
      if (tg.kind !== 'terror' && (fit < Math.min(8, D.crafts[c.type].seatsUI) || !armedNow)) continue;
      if (busy && c.dest && c.dest.kind === tg.ref.kind && c.dest.id === tg.ref.id) return; // já vai
      if (busy && !(tg.kind === 'terror' && !(c.dest && c.dest.kind === 'site'))) continue;
      const eta = etaH(c, tg.obj);
      const phase = GM.dayPhase({ t: G.t + Math.round(eta * HOUR) }, tg.obj.lon, tg.obj.lat);
      const big = tg.obj.type ? D.ufos[tg.obj.type].size >= 1 : false;
      // queda: espera pela luz do dia (o local dura ≥ 24 h); aterragem de noite só contra um Batedor Pequeno
      if (tg.kind === 'crashed' && phase === 'night' && (tg.obj.crashLeftS > 14 * HOUR || big)) continue;
      if (tg.kind === 'landed' && phase === 'night' && (big && gearLevel() < 1 || D.ufos[tg.obj.type].size >= 2)) continue;
      if (tg.obj.type === 'battleship' && phase === 'night') continue;
      if (tg.kind === 'landed' && eta > 2.5) continue;
      // terror: dura ≥ 16 h (TERROR_SITE_HOURS) — vai sempre que chega a tempo, mesmo com equipa curta
      if (tg.kind === 'terror' && (eta > 15 || fitSoldiers(c) < 4)) continue;
      if (tg.kind === 'alienBase' && !readyForBase(tg.obj)) continue;
      if (tg.kind === 'crashed' && eta * HOUR > tg.obj.crashLeftS) continue;
      const r = W.order(G, c.id, tg.ref);
      if (r.ok) {
        say('envia ' + c.type + ' → ' + tg.kind + ' ' + (tg.obj.type || tg.obj.cityId || tg.obj.id) + ' (' + eta.toFixed(1) + ' h)');
        return;
      }
    }
  }

  function playBattle(craftId, ref) {
    const G = bot.G;
    let mission;
    try {
      mission = C.startMission(G, ref, craftId, { settings: {} });
    } catch (e) {
      say('startMission recusado: ' + e.message);
      W.recall(G, craftId);
      return;
    }
    const B = OV.Battle.create(mission);
    const drain = (g) => {
      let x;
      while (!(x = g.next()).done);
      return x.value;
    };
    drain(OV.Battle.beginBattle(B));
    while (B.phase !== 'over' && B.turn <= BATTLE_TURNS) {
      drain(OV.AI.turn(B, 'xcom'));
      if (B.phase !== 'over') drain(OV.Battle.endPlayerTurn(B));
    }
    const squad = mission.squad.length;
    const model = C.finishMission(G, B);
    const deb = model.debrief;
    const row = {
      day: +(G.t / DAY).toFixed(2), kind: mission.kind, ufo: mission.ufoType, race: mission.race, month: mission.month,
      night: !!B.mission.night, gear: mission.squad.map((s) => s.loadout.R || '-').join(','),
      armour: mission.squad.reduce((o, s) => Object.assign(o, { [s.armour]: (o[s.armour] | 0) + 1 }), {}),
      result: deb.result, turns: B.turn, squad, lost: deb.soldiers.filter((s) => s.status !== 'ok').length,
      kills: deb.kills | 0, captured: deb.captured.map((x) => x.unitType), score: deb.score | 0,
    };
    bot.mem.battles.push(row);
    if (bot.mem.firstBattleT === null) bot.mem.firstBattleT = G.t;
    if (mission.kind === 'alienBase' && deb.result !== 'win') bot.mem.baseFail[mission.siteId] = G.t;
    if (mission.kind === 'terror') {
      bot.mem.terror.fought++;
      if (deb.result === 'win') bot.mem.terror.won++;
    }
    say('batalha ' + row.kind + ' ' + (row.ufo || '') + ' ' + row.race + (row.night ? ' (noite)' : '') + ' [' + row.gear + '] → ' + row.result + ' (' + row.turns + ' turnos, baixas ' + row.lost + '/' + squad +
      ', mortos ' + row.kills + (row.captured.length ? ', capturados ' + row.captured.join('+') : '') + ')');
  }

  // ---- eventos --------------------------------------------------------------------------------------------------------
  function handle(ev) {
    const G = bot.G;
    switch (ev.t) {
      case 'dogfightStart':
        resolveDogfight(ev.dogfightId);
        break;
      case 'ufoDetected':
        if (bot.mem.firstDetectT === null) bot.mem.firstDetectT = G.t;
        if (G.t < GAP_DAYS * DAY) bot.mem.detectT.push(G.t);
        break;
      case 'ufoCrashed': {
        bot.mem.crashSites++;
        if (bot.mem.firstCrashT === null) bot.mem.firstCrashT = G.t;
        const u = C.findUfo(G, ev.ufoId);
        say('OVNI caído: ' + (u ? u.type : '?') + ' em ' + ev.lon.toFixed(1) + ',' + ev.lat.toFixed(1) + ' (' + Math.round(GM.distNm(base(), ev)) + ' mn)');
        break;
      }
      case 'ufoDestroyed':
        say('OVNI destruído: ' + ev.type);
        break;
      case 'craftArrived': {
        const c = C.findCraft(G, ev.craftId);
        if (!c) break;
        if (ev.prompt === 'mission') playBattle(c.id, ev.target);
        else W.recall(G, c.id);
        break;
      }
      case 'targetLost':
      case 'craftLowFuel': {
        const c = C.findCraft(G, ev.craftId);
        if (c && AIR[c.status] && c.status !== 'returning') W.recall(G, c.id);
        break;
      }
      case 'researchDone':
        if (KEY_TOPICS.indexOf(ev.topic) >= 0 && bot.mem.research[ev.topic] === undefined) bot.mem.research[ev.topic] = +(G.t / DAY).toFixed(1);
        say('investigação concluída: ' + ev.topic);
        break;
      case 'terrorSite':
        bot.mem.terror.seen++;
        say('terror em ' + ev.cityId + ' (' + ev.race + ')');
        break;
      case 'terrorSiteExpired':
        bot.mem.terror.expired++;
        break;
      case 'productionDone':
        if (ev.item === 'avenger' && bot.mem.avengerT === null) bot.mem.avengerT = G.t;
        break;
      case 'baseSpotted':
        bot.mem.spotted.push(+(G.t / DAY).toFixed(1));
        say('a base foi localizada pelos alienígenas — a equipa fica em casa');
        break;
      case 'baseDefence':
        bot.mem.retaliations.push({ day: +(G.t / DAY).toFixed(1), result: ev.result, lost: ev.soldiersLost.length });
        say('ataque à base → ' + ev.result);
        break;
      case 'alienBaseFound': {
        const ab = C.findAlienBase(G, ev.alienBaseId);
        bot.mem.basesFound.push({ day: +(G.t / DAY).toFixed(1), how: ev.how, race: ab ? ab.race : null });
        say('base alienígena descoberta (' + ev.how + ', ' + (ab ? ab.race : '?') + ')');
        break;
      }
      case 'pactSigned':
        bot.mem.pacts.push({ day: +(G.t / DAY).toFixed(1), country: ev.countryId });
        break;
      case 'monthEnd': {
        const r = ev.report;
        bot.mem.months.push({ month: r.month, rating: r.rating, funds: r.fundsAfter, income: r.income, upkeep: r.upkeep.total, xcom: r.xcom, alien: r.alien });
        say('fim do mês ' + r.month + ': avaliação ' + r.rating + ' (X-COM ' + r.xcom + ', aliens ' + r.alien + '), fundos $' + r.fundsAfter);
        break;
      }
      case 'gameOver':
        say('FIM DO JOGO: ' + ev.reason);
        break;
      case 'victory':
        say('VITÓRIA');
        break;
      default:
        break;
    }
  }

  // ---- gestão periódica ----------------------------------------------------------------------------------------------
  function manage() {
    const G = bot.G;
    if (!base()) return;
    const day = Math.floor(G.t / DAY);
    if (day !== bot.mem.lastManageDay) {
      bot.mem.lastManageDay = day;
      manageSell(G.funds < 0);
      manageBuild();
      manageStaff();
      manageBuy();
      manageProduction();
      manageCraftWeapons();
    }
    manageResearch();
    manageSquad();
    manageIntercepts();
    manageGround();
    manageCydonia();
  }
  function manageCydonia() {
    const G = bot.G;
    if (!G.flags.cydoniaUnlocked || G.activeMission) return;
    if (bot.mem.cydoniaT === undefined) bot.mem.cydoniaT = G.t;
    const av = craftsOf('avenger').find((c) => c.status === 'ready');
    if (!av) return;
    // a equipa só embarca no Vingador com o material final (finalKitReady: fatos, ou armaduras depois de esperar; nunca
    // de fato-macaco); espera ainda pelos Lança-Bombas Blaster até 10 dias e pela nave cheia
    const waited = G.t - bot.mem.cydoniaT;
    const blastersDue = has('blaster_launcher') && owned('blaster_launcher') < 2 && waited < 10 * DAY;
    const fit = fitSoldiers(av);
    if (!finalKitReady() || blastersDue || fit < (waited >= 40 * DAY ? 10 : D.crafts.avenger.seatsUI)) return;
    say('lança Cidónia com ' + fitSoldiers(av) + ' soldados');
    playBattle(av.id, { kind: 'cydonia' });
  }

  // ---- ciclo ----------------------------------------------------------------------------------------------------------
  function done() {
    const G = bot.G;
    return !!(G.flags.won || G.flags.lost) || G.t >= maxT;
  }
  function step() {
    const G = bot.G;
    if (done()) return false;
    manage();
    const r = W.step(G, STEP_TICKS);
    const evs = G.events.splice(0);
    for (const ev of evs) handle(ev);
    // dogfights criados fora dos eventos (não devia acontecer) e eventos novos dos handlers
    for (const df of G.dogfights.slice()) resolveDogfight(df.id);
    const more = G.events.splice(0);
    for (const ev of more) handle(ev);
    if (r.reason === 'battle' && G.activeMission) C.cancelMission(G);
    return !done();
  }
  function reload(G2) {
    bot.G = G2;
  }

  function report() {
    const G = bot.G;
    const m = bot.mem;
    const byKind = {};
    for (const b of m.battles) {
      const k = byKind[b.kind] || (byKind[b.kind] = { n: 0, won: 0 });
      k.n++;
      if (b.result === 'win') k.won++;
    }
    const reason = G.flags.won ? 'victory' : G.flags.lost ? G.flags.lostReason : 'timeout';
    return {
      seed, difficulty, endDay: +(G.t / DAY).toFixed(1), reason, monthsSurvived: G.history.length,
      battles: m.battles.length, byKind, battleLog: m.battles,
      soldiersLost: G.stats.soldiersLost, soldiersAlive: Object.keys(G.soldiers).length,
      ratings: m.months.map((x) => x.rating), funds: m.months.map((x) => x.funds), months: m.months,
      research: m.research, avengerDay: m.avengerT === null ? null : +(m.avengerT / DAY).toFixed(1),
      ufos: {
        detected: G.stats.ufosDetected, intercepted: m.dogfights.started, crashed: m.dogfights.crashed, destroyed: m.dogfights.destroyed,
        escaped: m.dogfights.escaped, craftLost: m.dogfights.lost, crashedAtSea: m.seaDowns, shotDownTotal: G.stats.ufosShotDown, destroyedTotal: G.stats.ufosDestroyed,
      },
      terror: m.terror, pacts: m.pacts, retaliations: m.retaliations, spotted: m.spotted, sold: m.sold, basesFound: m.basesFound,
      ufosSpawned: (G.ids.seq.u | 0), crashSites: m.crashSites,
      firstDetectDay: m.firstDetectT === null ? null : +(m.firstDetectT / DAY).toFixed(2),
      firstCrashDay: m.firstCrashT === null ? null : +(m.firstCrashT / DAY).toFixed(2),
      firstBattleDay: m.firstBattleT === null ? null : +(m.firstBattleT / DAY).toFixed(2),
      gapDays: detectGap(m.detectT || [], Math.min(G.t, GAP_DAYS * DAY)),
      detectDays: (m.detectT || []).map((t) => +(t / DAY).toFixed(1)),
      flags: { interrogated: !!G.flags.interrogated, leader: !!G.flags.leaderInterrogated, commander: !!G.flags.commanderInterrogated },
      hash: C.hash(G),
    };
  }

  bot.step = step;
  bot.done = done;
  bot.report = report;
  bot.reload = reload;
  return bot;
}

// maior intervalo (dias) sem um OVNI detetado entre o dia 0 e `end` (meses 0–2: DESIGN §14, CAMPAIGN_API §11)
function detectGap(ts, end) {
  let prev = 0, gap = 0;
  for (const t of ts) {
    if (t > end) break;
    gap = Math.max(gap, t - prev);
    prev = t;
  }
  gap = Math.max(gap, end - prev);
  return +(gap / DAY).toFixed(1);
}

function fmtDay(t) {
  return 'd' + (t / DAY).toFixed(2).padStart(6);
}

/* Campanha completa. opts.saveMidDay: no primeiro ponto calmo depois desse dia grava G com OV.Save.toJSON, carrega
   com OV.Save.fromJSON e continua com o G carregado (o resultado tem de ser igual). */
function run(opts) {
  const o = opts || {};
  const OV = o.OV || require('./load')({ finalize: true });
  const bot = create(OV, o);
  let saved = false;
  while (bot.step()) {
    if (o.saveMidDay !== undefined && !saved && bot.G.t >= o.saveMidDay * DAY && !bot.G.dogfights.length && !bot.G.activeMission) {
      saved = true;
      const text = JSON.stringify(OV.Save.toJSON(bot.G, null, { label: 'bot', savedAt: '1999-01-01T00:00:00Z' }));
      const back = OV.Save.fromJSON(JSON.parse(text));
      bot.reload(back.G);
    }
  }
  const rep = bot.report();
  rep.savedMid = saved;
  return rep;
}

module.exports = { create, run, detectGap, BUILD, RESEARCH_PRI, KEY_TOPICS, OPTIONAL_PER_MONTH };
