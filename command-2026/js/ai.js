/* IA adversária: árvore de comportamento (behavior tree) com quadro negro.
   Perceção → economia → construção → produção reativa → militar (defender / vaga / reunir) → batedores → engenheiros → poderes */
'use strict';
(function () {
  const CG = window.CG;
  const T = CG.TILE;

  // ---------------------------------------------------------------- nós da árvore
  const BT = {
    sel: (...c) => ({ t: 'sel', c }),
    seq: (...c) => ({ t: 'seq', c }),
    all: (...c) => ({ t: 'all', c }),
    cond: (f) => ({ t: 'cond', f }),
    act: (f) => ({ t: 'act', f }),
    tick(n, ai) {
      switch (n.t) {
        case 'sel':
          for (const c of n.c) if (BT.tick(c, ai)) return true;
          return false;
        case 'seq':
          for (const c of n.c) if (!BT.tick(c, ai)) return false;
          return true;
        case 'all': {
          let any = false;
          for (const c of n.c) if (BT.tick(c, ai)) any = true;
          return any;
        }
        default:
          return !!n.f.call(ai);
      }
    },
  };
  CG.BT = BT;

  const PLAN = ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery', 'radar', 'tower_mg', 'power', 'tower_at',
    'airfield', 'power', 'tech', 'sam', 'power', 'tower_mg', 'tower_at', 'factory', 'sam', 'power', 'refinery', 'barracks',
    'power', 'tower_at', 'tower_mg', 'sam', 'power', 'airfield', 'power', 'tower_at'];

  function role(def) {
    const w = def.weapon;
    if (!w) return null;
    if (w.wh === 'AA') return 'aa';
    if (w.wh === 'HE' && w.range > 7 * T) return 'arty';
    if (w.wh === 'AP' || w.wh === 'AT' || w.wh === 'AIR' || w.wh === 'DEMO' || w.wh === 'HACK') return 'av';
    return 'ai';
  }
  CG.unitRole = role;

  class AI {
    constructor(G, p) {
      this.G = G;
      this.p = p;
      this.d = p.diff;
      this.t = 0.5 + p.id * 0.13;
      this.base = { x: p.start.x * T + T / 2, y: p.start.y * T + T / 2 };
      this.enemyStarts = G.players.filter((q) => q.id !== p.id).map((q) => ({ x: q.start.x * T + T / 2, y: q.start.y * T + T / 2, owner: q.id }));
      this.known = new Map();
      this.seen = { inf: 0, veh: 0, air: 0 };
      this.threat = null;
      this.wave = null;
      this.waveNum = 0;
      this.scoutId = 0;
      this.scouts = 0;
      this.skip = {};
      this.engT = 0;
      this.mcvT = 0;
      this.powerT = 0;
      this.tree = BT.all(
        BT.seq(BT.cond(this.noConyard), BT.sel(BT.seq(BT.cond(this.hasMCV), BT.act(this.deployMCV)), BT.act(this.buildMCV))),
        BT.act(this.economy),
        BT.act(this.structures),
        BT.act(this.production),
        BT.sel(
          BT.seq(BT.cond(this.baseThreatened), BT.act(this.defend)),
          BT.seq(BT.cond(this.waveActive), BT.sel(BT.seq(BT.cond(this.waveBroken), BT.act(this.retreat)), BT.act(this.pressWave))),
          BT.seq(BT.cond(this.armyReady), BT.act(this.launchWave)),
          BT.act(this.rallyIdle)
        ),
        BT.seq(BT.cond(this.needScout), BT.act(this.scout)),
        BT.seq(BT.cond(this.canEngineer), BT.act(this.engineers)),
        BT.seq(BT.cond(this.powerReady), BT.act(this.usePowers))
      );
    }

    update(dt) {
      if (this.p.defeated) return;
      this.t -= dt;
      if (this.t > 0) return;
      this.t = this.d.think;
      this.perceive();
      BT.tick(this.tree, this);
    }

    onUnitBuilt() {}

    onAttacked(t, src) {
      if (!src || src.owner === undefined || src.owner < 0) return;
      if (t.kind === 'bld' || t.def.harvester || CG.dist(t.x, t.y, this.base.x, this.base.y) < 16 * T) {
        this.threat = { x: src.x !== undefined ? src.x : t.x, y: src.y !== undefined ? src.y : t.y, t: this.G.time };
      }
    }

    // ---------------------------------------------------------------- perceção
    perceive() {
      const G = this.G, p = this.p;
      this.mine = [];
      this.army = [];
      this.myBlds = [];
      this.harvs = 0;
      this.mcvs = [];
      this.engs = [];
      this.visibleEnemies = [];
      let cy = null;
      const decay = 0.97;
      this.seen.inf *= decay;
      this.seen.veh *= decay;
      this.seen.air *= decay;
      for (const e of G.entities) {
        if (!e.alive) continue;
        if (e.owner === p.id) {
          if (e.kind === 'bld') {
            this.myBlds.push(e);
            if (e.def.conyard && !cy) cy = e;
          } else {
            this.mine.push(e);
            if (e.def.harvester) this.harvs++;
            else if (e.def.mcv) this.mcvs.push(e);
            else if (e.def.engineer) this.engs.push(e);
            else if (e.def.weapon && e.id !== this.scoutId) this.army.push(e);
          }
        } else if (e.owner >= 0 && CG.visibleTo(G, e, p.id)) {
          if (e.kind === 'bld') this.known.set(e.id, { x: e.x, y: e.y, type: e.type, owner: e.owner, cost: e.def.cost || 300 });
          else {
            this.visibleEnemies.push(e);
            this.seen[e.def.cat] += 0.2;
          }
        }
      }
      for (const [id] of this.known) {
        const e = G.byId.get(id);
        if (!e || !e.alive || e.owner === p.id || e.owner < 0) this.known.delete(id);
      }
      if (cy) this.base = { x: cy.x, y: cy.y };
      this.conyard = cy;
      this.strength = (list) => list.reduce((s, u) => s + (u.alive ? u.def.cost * (u.hp / u.maxHp) : 0), 0);
    }

    // ---------------------------------------------------------------- recuperação de base
    noConyard() { return !this.conyard; }
    hasMCV() { return this.mcvs.length > 0; }
    deployMCV() {
      const G = this.G;
      const u = this.mcvs[0];
      if (u.order && (u.order.type === 'deploy' || u.order.type === 'move')) return true;
      const t = CG.deployTile(u);
      if (CG.canPlace(G, this.p.id, 'conyard', t.x, t.y, { anywhere: true, ignore: u.id }).ok) {
        CG.orderDeploy(G, u);
        return true;
      }
      const spot = this.findSpot('conyard', this.base.x, this.base.y, { anywhere: true, ignore: u.id, spacing: true });
      if (spot) CG.orderMove(G, u, (spot.x + 1.5) * T, (spot.y + 1.5) * T, false);
      return true;
    }
    buildMCV() {
      const p = this.p;
      if (p.queues.veh.items.indexOf('mcv') >= 0) return true;
      if (CG.hasPrereqs(p, CG.UNITS.mcv) && p.credits >= 2000) CG.enqueue(this.G, p, 'mcv');
      return true;
    }

    // ---------------------------------------------------------------- economia
    economy() {
      const G = this.G, p = this.p;
      const refs = p.owned.refinery || 0;
      const want = Math.min(8, Math.round(refs * this.d.harvPerRef));
      const queued = p.queues.veh.items.filter((x) => x === 'harv').length;
      if (refs > 0 && this.harvs + queued < want && CG.hasPrereqs(p, CG.UNITS.harv) && p.queues.veh.items.length < 3) {
        if (p.queues.veh.items.length && p.queues.veh.items[0] !== 'harv') p.queues.veh.items.splice(1, 0, 'harv');
        else CG.enqueue(G, p, 'harv');
      }
      if (p.credits > 500) {
        for (const b of this.myBlds) if (b.hp < b.maxHp * 0.7 && b.built >= 1) b.repairing = true;
      }
      // extratores parados (sem ordem) voltam ao trabalho
      for (const u of this.mine) if (u.def.harvester && !u.order) CG.orderHarvest(G, u);
      return true;
    }

    // ---------------------------------------------------------------- construção
    structures() {
      const G = this.G, p = this.p;
      const q = p.queues.bld;
      if (!this.conyard) return false;
      if (q.ready) {
        const type = q.items[0];
        const spot = this.placeFor(type);
        if (spot && CG.placeStructure(G, p, spot.x, spot.y)) return true;
        CG.dequeue(G, p, type);
        this.skip[type] = G.time + 40;
        return false;
      }
      if (q.items.length) return true;
      const surplus = p.powerProd - p.powerUse;
      const counts = {};
      for (const b of this.myBlds) counts[b.type] = (counts[b.type] || 0) + 1;
      let next = null;
      if (surplus < 25 && G.time > 5) next = 'power';
      else {
        const need = {};
        for (const type of PLAN) {
          need[type] = (need[type] || 0) + 1;
          if ((counts[type] || 0) >= need[type]) continue;
          if (this.skip[type] && this.skip[type] > G.time) continue;
          const def = CG.BUILDINGS[type];
          if (!CG.hasPrereqs(p, def)) continue;
          if (def.power < 0 && surplus + def.power < 0) { next = 'power'; break; }
          next = type;
          break;
        }
        if (!next && p.credits > 2500) {
          const extra = ['tower_at', 'tower_mg', 'sam'][G.rng.int(3)];
          if (CG.hasPrereqs(p, CG.BUILDINGS[extra]) && (counts[extra] || 0) < 8) next = extra;
        }
      }
      if (next) {
        const def = CG.BUILDINGS[next];
        if (def.defense && G.time < 120 && this.d === CG.DIFFICULTY.easy) return true;
        CG.enqueue(G, p, next);
      }
      return true;
    }

    placeFor(type) {
      const def = CG.BUILDINGS[type];
      const bx = this.base.x, by = this.base.y;
      if (def.refinery) {
        const f = this.bestField();
        if (f) {
          const spot = this.findSpot(type, f.x * T, f.y * T, { spacing: true, minDist: 2 });
          if (spot) return spot;
        }
      }
      if (def.defense) {
        const tgt = this.threatDir();
        const ang = Math.atan2(tgt.y - by, tgt.x - bx) + this.G.rng.range(-0.7, 0.7);
        const r = this.G.rng.range(5, 8) * T;
        const spot = this.findSpot(type, bx + Math.cos(ang) * r, by + Math.sin(ang) * r, { spacing: false });
        if (spot) return spot;
      }
      return this.findSpot(type, bx, by, { spacing: true, minDist: 3 });
    }

    bestField() {
      const m = this.G.map;
      let best = null, bs = 1e18;
      for (const f of m.fields) {
        let amt = 0;
        for (const i of f.tiles) amt += m.res[i];
        if (amt < 2000) continue;
        const d = CG.dist(f.x * T, f.y * T, this.base.x, this.base.y);
        let refNear = false;
        for (const b of this.myBlds) if (b.def.refinery && CG.dist(b.x, b.y, f.x * T, f.y * T) < 7 * T) refNear = true;
        const s = d + (refNear ? 30 * T : 0);
        if (s < bs) { bs = s; best = f; }
      }
      return best;
    }

    threatDir() {
      let best = null, bd = 1e18;
      for (const s of this.enemyStarts) {
        const q = this.G.players[s.owner];
        if (q.defeated) continue;
        const d = CG.dist(s.x, s.y, this.base.x, this.base.y);
        if (d < bd) { bd = d; best = s; }
      }
      return best || { x: this.G.map.pxW / 2, y: this.G.map.pxH / 2 };
    }

    findSpot(type, px, py, opts) {
      const G = this.G, m = G.map;
      const def = CG.BUILDINGS[type];
      const cx = Math.floor(px / T - def.w / 2 + 0.5), cy = Math.floor(py / T - def.h / 2 + 0.5);
      const minD = opts.minDist || 0;
      let best = null, bs = 1e18;
      for (let r = minD; r <= 16; r++) {
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const tx = cx + dx, ty = cy + dy;
            if (tx < 1 || ty < 1 || tx + def.w >= m.w - 1 || ty + def.h >= m.h - 1) continue;
            if (opts.spacing && !this.ringClear(tx, ty, def)) continue;
            if (!CG.canPlace(G, this.p.id, type, tx, ty, opts).ok) continue;
            const s = dx * dx + dy * dy + G.rng.next() * 3;
            if (s < bs) { bs = s; best = { x: tx, y: ty }; }
          }
        if (best && r > minD + 1) break;
      }
      return best;
    }

    // mantém um corredor de 1 tile à volta dos edifícios para não emparedar a base
    ringClear(tx, ty, def) {
      const m = this.G.map;
      for (let y = ty - 1; y <= ty + def.h; y++)
        for (let x = tx - 1; x <= tx + def.w; x++) {
          if (!m.inBounds(x, y)) return false;
          const i = m.idx(x, y);
          if (m.block[i] === 2 || m.reserve[i]) return false;
        }
      if (def.refinery) {
        const y = ty + def.h + 1;
        for (let x = tx; x <= tx + 2; x++) if (m.inBounds(x, y) && m.block[m.idx(x, y)] === 2) return false;
      }
      return true;
    }

    // ---------------------------------------------------------------- produção reativa
    production() {
      const G = this.G, p = this.p;
      if (p.unitCount >= CG.UNIT_CAP - 4) return false;
      const bq = p.queues.bld;
      if (bq.items.length && !bq.ready && p.credits < 400 && G.time < 600) return false;
      const total = this.seen.inf + this.seen.veh + this.seen.air + 0.001;
      const want = { ai: 0.32, av: 0.45, aa: 0.08, arty: 0.12 };
      if (this.d.counters && total > 1) {
        want.aa += (this.seen.air / total) * 0.9;
        want.av += (this.seen.veh / total) * 0.35;
        want.ai += (this.seen.inf / total) * 0.35;
      }
      if (!this.seen.air || this.seen.air < 0.5) want.aa = Math.min(want.aa, 0.06);
      for (const key of ['inf', 'veh', 'air']) {
        const q = p.queues[key];
        if (q.items.length >= 2) continue;
        if (!CG.producers(G, p, key).length) continue;
        const opts = [];
        for (const id of p.faction.units) {
          const def = CG.UNITS[id];
          if (def.cat !== key || def.harvester || def.mcv || def.engineer) continue;
          if (!CG.hasPrereqs(p, def)) continue;
          const subDef = def.spawn ? CG.UNITS[def.spawn] : def;
          const r = role(subDef);
          if (!r) continue;
          let wgt = want[r] || 0.05;
          if (key === 'air') wgt *= r === 'av' ? 1.6 : 0.5;
          if (key === 'veh' && r === 'ai') wgt *= 0.9;
          if (key === 'inf' && r === 'av') wgt *= 0.6;
          if (def.cost > p.credits + 600) wgt *= 0.3;
          opts.push({ id, w: wgt });
        }
        if (key === 'air' && !opts.length) continue;
        if (!opts.length) continue;
        let sum = 0;
        for (const o of opts) sum += o.w;
        let r = G.rng.next() * sum;
        let pick = opts[0].id;
        for (const o of opts) { r -= o.w; if (r <= 0) { pick = o.id; break; } }
        if (p.credits < 150 && G.time > 60) continue;
        CG.enqueue(G, p, pick);
      }
      return true;
    }

    // ---------------------------------------------------------------- militar
    baseThreatened() {
      const G = this.G;
      let n = 0, sx = 0, sy = 0;
      for (const e of this.visibleEnemies) {
        if (!e.def.weapon) continue;
        let near = CG.dist(e.x, e.y, this.base.x, this.base.y) < 15 * T;
        if (!near) for (const b of this.myBlds) if (CG.dist2(e.x, e.y, b.x, b.y) < 64 * 64 * 2.2) { near = true; break; }
        if (near) { n++; sx += e.x; sy += e.y; }
      }
      if (n > 0) { this.threatPos = { x: sx / n, y: sy / n }; return true; }
      if (this.threat && G.time - this.threat.t < 8) { this.threatPos = this.threat; return true; }
      return false;
    }
    defend() {
      const G = this.G;
      const tp = this.threatPos;
      const waveIds = this.wave ? new Set(this.wave.ids) : null;
      for (const u of this.army) {
        const inWave = waveIds && waveIds.has(u.id);
        if (inWave && CG.dist(u.x, u.y, this.base.x, this.base.y) > 26 * T) continue;
        if (u.target && u.order && u.order.type === 'amove') continue;
        if (u.order && u.order.type === 'amove' && CG.dist2(u.order.x, u.order.y, tp.x, tp.y) < 4 * T * T) continue;
        CG.orderMove(G, u, tp.x + G.rng.range(-40, 40), tp.y + G.rng.range(-40, 40), true);
      }
      return true;
    }

    waveActive() { return !!this.wave; }
    waveUnits() {
      const out = [];
      for (const id of this.wave.ids) {
        const u = this.G.byId.get(id);
        if (u && u.alive) out.push(u);
      }
      return out;
    }
    waveBroken() {
      const units = this.waveUnits();
      this.wave.ids = units.map((u) => u.id);
      const s = this.strength(units);
      return units.length === 0 || s < this.wave.start * 0.3;
    }
    retreat() {
      const G = this.G;
      for (const u of this.waveUnits()) CG.orderMove(G, u, this.base.x + G.rng.range(-80, 80), this.base.y + G.rng.range(-80, 80), false);
      this.wave = null;
      return true;
    }
    pickTarget() {
      let best = null, bd = 1e18;
      const from = this.wave && this.wave.center ? this.wave.center : this.base;
      for (const [, k] of this.known) {
        const q = this.G.players[k.owner];
        if (!q || q.defeated) continue;
        const d = CG.dist(k.x, k.y, from.x, from.y) - (k.type === 'conyard' ? 4 * T : 0);
        if (d < bd) { bd = d; best = { x: k.x, y: k.y }; }
      }
      if (best) return best;
      const p = this.p;
      for (const s of this.enemyStarts) {
        if (this.G.players[s.owner].defeated) continue;
        if (!p.explored[this.G.map.idx(Math.floor(s.x / T), Math.floor(s.y / T))] || !this.wave) return { x: s.x, y: s.y };
      }
      // tudo explorado e nada conhecido: o quartel-general "fornece" a posição do edifício inimigo mais próximo
      let bb = null, bdd = 1e18;
      for (const e of this.G.entities) {
        if (!e.alive || e.kind !== 'bld' || e.owner < 0 || e.owner === p.id || e.def.noCount) continue;
        const d = CG.dist2(e.x, e.y, from.x, from.y);
        if (d < bdd) { bdd = d; bb = e; }
      }
      if (bb) return { x: bb.x, y: bb.y };
      if (this.visibleEnemies.length) return { x: this.visibleEnemies[0].x, y: this.visibleEnemies[0].y };
      const alive = this.enemyStarts.filter((s) => !this.G.players[s.owner].defeated);
      return alive.length ? alive[this.G.rng.int(alive.length)] : null;
    }
    attackableBy(units, e) {
      for (const u of units) if (CG.canTarget(this.G, u, e, false)) return true;
      return false;
    }
    pressWave() {
      const G = this.G;
      const w = this.wave;
      const units = this.waveUnits();
      let cx = 0, cy = 0;
      for (const u of units) { cx += u.x; cy += u.y; }
      w.center = { x: cx / units.length, y: cy / units.length };
      if (w.state === 'gather') {
        w.t += this.d.think;
        let near = 0;
        for (const u of units) if (CG.dist(u.x, u.y, w.stage.x, w.stage.y) < 7 * T) near++;
        if (near >= units.length * 0.7 || w.t > 30) {
          w.state = 'attack';
          w.target = this.pickTarget();
          w.issueT = 0;
        } else {
          for (const u of units) if (!u.order && CG.dist(u.x, u.y, w.stage.x, w.stage.y) > 5 * T) CG.orderMove(G, u, w.stage.x + G.rng.range(-60, 60), w.stage.y + G.rng.range(-60, 60), true);
        }
        return true;
      }
      // ataque: reavalia o alvo e reemite ordens periodicamente
      w.issueT -= this.d.think;
      const tgtGone = !w.target || (CG.dist(w.center.x, w.center.y, w.target.x, w.target.y) < 4 * T &&
        !this.visibleEnemies.some((e) => CG.dist(e.x, e.y, w.target.x, w.target.y) < 8 * T && this.attackableBy(units, e)) && !this.knownNear(w.target, 3 * T));
      if (tgtGone) {
        w.target = this.pickTarget();
        w.issueT = 0;
      }
      if (!w.target) return true;
      // reforços: o exército parado junta-se à vaga em curso
      const idle = this.idleArmy().filter((u) => !u.order && !u.target);
      if (idle.length && this.strength(idle) >= this.waveNeed() * 0.5) {
        for (const u of idle) {
          w.ids.push(u.id);
          CG.orderMove(G, u, w.target.x + G.rng.range(-70, 70), w.target.y + G.rng.range(-70, 70), true);
        }
        w.start += this.strength(idle);
      }
      if (w.issueT <= 0) {
        w.issueT = 6;
        for (const u of units) {
          if (u.target && u.order && u.order.type === 'amove') continue;
          CG.orderMove(G, u, w.target.x + G.rng.range(-70, 70), w.target.y + G.rng.range(-70, 70), true);
        }
      } else {
        for (const u of units) if (!u.order) CG.orderMove(G, u, w.target.x + G.rng.range(-70, 70), w.target.y + G.rng.range(-70, 70), true);
      }
      return true;
    }
    knownNear(pt, r) {
      for (const [, k] of this.known) if (CG.dist2(k.x, k.y, pt.x, pt.y) < r * r) return true;
      return false;
    }
    idleArmy() {
      const waveIds = this.wave ? new Set(this.wave.ids) : null;
      return this.army.filter((u) => !(waveIds && waveIds.has(u.id)));
    }
    armyReady() {
      const G = this.G;
      if (G.time < this.d.firstWave) return false;
      const idle = this.idleArmy();
      const need = this.waveNeed();
      const str = this.strength(idle);
      const since = G.time - (this.lastWaveT || 0);
      return str >= need || idle.length >= 40 || (since > 150 && str >= need * 0.5);
    }
    waveNeed() {
      return Math.min(9000, this.d.waveBase + this.waveNum * this.d.waveGrow);
    }
    launchWave() {
      const G = this.G;
      const units = this.idleArmy();
      const target = this.pickTarget();
      if (!target || !units.length) return false;
      const ang = Math.atan2(target.y - this.base.y, target.x - this.base.x);
      const dist = Math.min(14 * T, CG.dist(target.x, target.y, this.base.x, this.base.y) * 0.4);
      let stage = { x: this.base.x + Math.cos(ang) * dist, y: this.base.y + Math.sin(ang) * dist };
      const f = G.map.nearestFree(Math.floor(stage.x / T), Math.floor(stage.y / T), 6);
      if (f) stage = { x: f.x * T + T / 2, y: f.y * T + T / 2 };
      this.wave = { ids: units.map((u) => u.id), start: this.strength(units), state: 'gather', stage, t: 0, target, issueT: 0, center: this.base };
      this.waveNum++;
      this.lastWaveT = G.time;
      CG.groupMove(G, units, stage.x, stage.y, true);
      return true;
    }
    rallyIdle() {
      const G = this.G;
      const tgt = this.threatDir();
      const ang = Math.atan2(tgt.y - this.base.y, tgt.x - this.base.x);
      const rx = this.base.x + Math.cos(ang) * 6 * T, ry = this.base.y + Math.sin(ang) * 6 * T;
      for (const u of this.army) {
        if (u.order || u.target) continue;
        if (CG.dist(u.x, u.y, rx, ry) > 6 * T) CG.orderMove(G, u, rx + G.rng.range(-90, 90), ry + G.rng.range(-90, 90), true);
      }
      return true;
    }

    // ---------------------------------------------------------------- batedores
    needScout() {
      const G = this.G;
      if (G.time < 35 || this.scouts >= (this.d === CG.DIFFICULTY.easy ? 1 : 3)) return false;
      const s = G.byId.get(this.scoutId);
      if (s && s.alive) return false;
      return this.enemyStarts.some((st) => !this.p.explored[G.map.idx(Math.floor(st.x / T), Math.floor(st.y / T))]);
    }
    scout() {
      const G = this.G;
      let best = null, bs = 1e18;
      for (const u of this.mine) {
        if (u.def.harvester || u.def.mcv || u.def.engineer || u.order) continue;
        const s = -u.def.speed + u.def.cost * 0.02;
        if (s < bs) { bs = s; best = u; }
      }
      if (!best) return false;
      const st = this.enemyStarts.find((s2) => !this.p.explored[G.map.idx(Math.floor(s2.x / T), Math.floor(s2.y / T))]);
      if (!st) return false;
      this.scoutId = best.id;
      this.scouts++;
      CG.orderMove(G, best, st.x, st.y, false);
      return true;
    }

    // ---------------------------------------------------------------- engenheiros (poços de petróleo)
    canEngineer() {
      return this.d.engineers && this.G.time > 150 && (this.p.owned.barracks || 0) > 0;
    }
    engineers() {
      const G = this.G, p = this.p;
      let target = null, bd = 1e18;
      for (const e of G.entities) {
        if (!e.alive || e.kind !== 'bld' || !e.def.income || e.owner === p.id || e.owner >= 0) continue;
        const d = CG.dist(e.x, e.y, this.base.x, this.base.y);
        if (d < 34 * T && d < bd) { bd = d; target = e; }
      }
      if (!target) return false;
      for (const u of this.engs) {
        if (u.order && u.order.type === 'capture') return true;
        CG.orderCapture(G, u, target);
        return true;
      }
      if (G.time > this.engT && p.credits > 1400 && p.queues.inf.items.indexOf('eng') < 0) {
        this.engT = G.time + 90;
        CG.enqueue(G, p, 'eng');
      }
      return true;
    }

    // ---------------------------------------------------------------- poderes de apoio
    powerReady() {
      if (!this.d.powers) return false;
      for (const id of this.p.faction.powers) if (this.p.powers[id].charge >= 1 && this.p.powers[id].avail) return true;
      return false;
    }
    usePowers() {
      const G = this.G, p = this.p;
      for (const id of p.faction.powers) {
        const pw = p.powers[id];
        if (pw.charge < 1 || !pw.avail) continue;
        const def = CG.POWERS[id];
        let tgt = null;
        if (def.kind === 'reveal') {
          const st = this.enemyStarts.find((s) => !G.players[s.owner].defeated);
          tgt = this.known.size ? this.pickTarget() : st;
        } else {
          tgt = this.bestCluster(def.radius * T, def.kind === 'emp');
          const minVal = def.kind === 'strike' ? 1800 : 600;
          if (tgt && tgt.v < minVal) tgt = null;
        }
        if (tgt) CG.usePower(G, p, id, tgt.x, tgt.y);
      }
      return true;
    }
    bestCluster(r, unitsToo) {
      const pts = [];
      for (const [, k] of this.known) pts.push({ x: k.x, y: k.y, v: k.cost || 300 });
      if (unitsToo) for (const e of this.visibleEnemies) if (e.def.cat !== 'inf') pts.push({ x: e.x, y: e.y, v: e.def.cost });
      let best = null;
      for (const c of pts) {
        let v = 0;
        for (const o of pts) if (CG.dist2(c.x, c.y, o.x, o.y) <= r * r) v += o.v;
        if (!best || v > best.v) best = { x: c.x, y: c.y, v };
      }
      return best;
    }
  }
  CG.AI = AI;
})();
