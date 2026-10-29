/* Interceção (dogfight) — reprodução do DogfightState do OpenXcom (DESIGN.md §3.13; REA 02-geoscape §6;
   contrato docs/CAMPAIGN_API.md §1.15, §5.5). Um tick = 30 ms de tempo real (Data.dogfight.tickMs).
   OV.Dogfight = {
     create(G, craftId, ufoId) → dogfight|null    em G.dogfights, craft.dogfightId; dist = open (640), modo 'standoff'
     tick(G, dogfightId) → eventos[]              um tick; sorteios na stream combat; chama finish quando acaba
     setMode(G, id, mode) ; toggleWeapon(G, id, slot) ; disengage(G, id)
     hitChance(G, id, slot) → % ; targetDist(G, id) → distância pretendida ; breakingOff(G, id) → bool
     autoResolve(G, id, mode='standard', maxTicks=20000) → resultado (sem UI)
     finish(G, id) → resultado                    aplica o resultado e remove o dogfight }
   Distâncias: dist = distância nave–OVNI; projéteis da nave com pos = distância percorrida desde a nave
   (chegam quando pos ≥ dist); feixes e o tiro do OVNI resolvem-se no próprio tick.
   Eventos devolvidos por tick (não vão para G.events): {t:'df.fire', from:'craft'|'ufo', slot?, weapon?},
   {t:'df.hit', target:'ufo'|'craft', dmg, slot?}, {t:'df.miss', from, slot?}, {t:'df.move', dist},
   {t:'df.retreat'} (Cauteloso com dano ≥ 50 % ⇒ Distância), {t:'df.breakOff'} (o OVNI foge mais depressa que a nave),
   {t:'df.end', outcome}. */
(function (OV) {
  'use strict';

  const U = OV.U;
  const D = () => OV.Data;
  const C = () => OV.Campaign;
  const tune = (k, d) => (OV.TUNE && OV.TUNE[k] !== undefined ? OV.TUNE[k] : d);
  const MODES = { standoff: 1, cautious: 1, standard: 1, aggressive: 1, disengage: 1 };

  const coef = (G) => 2 * U.clamp(G.difficulty | 0, 0, 2);
  const hasAmmo = (w) => !!w && (w.ammo === null || w.ammo > 0);

  function parts(G, d) {
    const craft = C().findCraft(G, d.craftId);
    const ufo = C().findUfo(G, d.ufoId);
    return { craft, ufo, cdef: craft ? D().crafts[craft.type] : null, udef: ufo ? D().ufos[ufo.type] : null };
  }

  function create(G, craftId, ufoId) {
    const craft = C().findCraft(G, craftId);
    const ufo = C().findUfo(G, ufoId);
    if (!craft || !ufo || craft.dogfightId || ufo.status !== 'flying') return null;
    if (G.dogfights.length >= tune('MAX_DOGFIGHTS', D().dogfight.maxSimultaneous)) return null;
    const DF = D().dogfight;
    const udef = D().ufos[ufo.type];
    // o OVNI já está noutro dogfight: partilha a contagem da fuga e do tiro (Ufo::getEscapeCountdown orig)
    const other = G.dogfights.find((x) => x.ufoId === ufoId && !x.over) || null;
    let escapeT, ufoReload;
    if (other) {
      escapeT = other.escapeT;
      ufoReload = other.ufoReload;
    } else {
      escapeT = Math.max(1, udef.breakOff + C().rng(G, 'combat').int(0, udef.breakOff) - DF.escapeCoefMul * coef(G));
      ufoReload = 0; // primeiro tiro imediato
    }
    const weapons = [];
    craft.weapons.forEach((w, slot) => {
      if (w) weapons.push({ slot, enabled: true, reload: 0 });
    });
    const d = {
      id: C().nextId(G, 'd'), craftId, ufoId, dist: DF.open, mode: 'standoff', weapons, ufoReload, escapeT,
      projectiles: [], ticks: 0, over: false, outcome: null,
    };
    G.dogfights.push(d);
    craft.dogfightId = d.id;
    return d;
  }

  // o OVNI acelerou para a velocidade máxima e a nave não o acompanha; ours: o Couraçado de um ataque à base vai
  // a caminho do alvo e não foge (as naves da base atacada combatem-no até ao fim)
  function breaking(ufo, cdef) {
    return !!ufo && !!cdef && ufo.status === 'flying' && !ufo.targetBaseId && ufo.speed > cdef.speed;
  }

  // distância pretendida pelo modo (minimumDistance/maximumDistance orig: só armas ativas com munição)
  function targetOf(G, d, craft) {
    const DF = D().dogfight;
    const live = d.weapons.filter((ws) => ws.enabled && hasAmmo(craft.weapons[ws.slot]))
      .map((ws) => D().craftWeapons[craft.weapons[ws.slot].type].range);
    const anyAmmo = craft.weapons.some(hasAmmo) || d.projectiles.length > 0;
    if (!anyAmmo && d.mode !== 'disengage') return DF.standoff; // sem munições: recua para a Distância
    switch (d.mode) {
      case 'cautious': return live.length ? Math.max(...live) * DF.rangeMul : DF.standoff;
      case 'standard': return live.length ? Math.min(...live) * DF.rangeMul : DF.standoff;
      case 'aggressive': return DF.aggressive;
      case 'disengage': return DF.disengage;
      default: return DF.standoff;
    }
  }
  function targetDist(G, id) {
    const d = C().findDogfight(G, id);
    const craft = d ? C().findCraft(G, d.craftId) : null;
    return d && craft ? targetOf(G, d, craft) : null;
  }
  function breakingOff(G, id) {
    const d = C().findDogfight(G, id);
    if (!d) return false;
    const p = parts(G, d);
    return breaking(p.ufo, p.cdef);
  }

  function hitChance(G, id, slot) {
    const d = C().findDogfight(G, id);
    if (!d) return 0;
    const p = parts(G, d);
    const w = p.craft && p.craft.weapons[slot];
    if (!w || !p.udef) return 0;
    return D().dogfightHitChance(D().craftWeapons[w.type].acc, p.udef.size);
  }

  function setMode(G, id, mode) {
    const d = C().findDogfight(G, id);
    if (!d || d.over || !MODES[mode]) return false;
    const p = parts(G, d);
    if (breaking(p.ufo, p.cdef)) return false;
    d.mode = mode;
    return true;
  }
  const disengage = (G, id) => setMode(G, id, 'disengage');
  function toggleWeapon(G, id, slot) {
    const d = C().findDogfight(G, id);
    const ws = d && !d.over ? d.weapons.find((w) => w.slot === slot) : null;
    if (!ws) return false;
    ws.enabled = !ws.enabled;
    return true;
  }

  function end(d, outcome) {
    d.over = true;
    d.outcome = outcome;
  }

  // dano ao OVNI: queda quando dmg > hp/2, destruído quando dmg ≥ hp (Data.ufoRules)
  function hitUfo(d, ufo, udef, dmg, slot, ev) {
    ufo.dmg += dmg;
    ev.push({ t: 'df.hit', target: 'ufo', dmg, slot });
    if (ufo.dmg * 2 > udef.hp) end(d, ufo.dmg >= udef.hp ? 'destroyed' : 'crashed');
  }

  function tick(G, id) {
    const d = C().findDogfight(G, id);
    if (!d) return [];
    const ev = [];
    const DF = D().dogfight;
    const { craft, ufo, cdef, udef } = parts(G, d);
    if (!d.over) {
      if (!craft) end(d, 'craftDestroyed');
      else if (!ufo) end(d, 'destroyed');
      else if (ufo.status === 'crashed') end(d, 'crashed');
      else if (ufo.status !== 'flying') end(d, 'escaped');
    }
    if (d.over) return closeOut(G, d, ev);
    const r = C().rng(G, 'combat');
    d.ticks++;

    // contagens do OVNI (fuga e tiro); na fuga acelera para a velocidade máxima (orig)
    if (d.escapeT > 0) {
      d.escapeT--;
      if (d.escapeT === 0) {
        ufo.speed = udef.speed;
        if (breaking(ufo, cdef)) ev.push({ t: 'df.breakOff' });
        // ours: o Couraçado de um ataque à base não foge — passa pela nave e segue para a base
        else if (ufo.targetBaseId) {
          end(d, 'disengaged');
          return closeOut(G, d, ev);
        }
      }
    }
    if (d.ufoReload > 0) d.ufoReload--;
    const fleeing = breaking(ufo, cdef);

    // distância: recuar +4, aproximar −approach (ours 4, orig 2); a fugir o OVNI afasta-se +4
    const before = d.dist;
    let change = 0;
    if (fleeing) change = DF.retreat;
    else {
      const target = targetOf(G, d, craft);
      if (d.dist < target) change = Math.min(DF.retreat, target - d.dist);
      else if (d.dist > target) change = -DF.approach;
    }
    d.dist += change;

    // projéteis da nave
    const keep = [];
    for (const pr of d.projectiles) {
      if (!fleeing) pr.pos += change; // a nave não empurra nem puxa o que já disparou
      pr.pos += DF.projectile;
      const wd = D().craftWeapons[pr.weapon];
      if (!d.over && pr.pos >= d.dist) {
        if (pr.hit && pr.dmg > 0) hitUfo(d, ufo, udef, pr.dmg, pr.slot, ev);
        else ev.push({ t: 'df.miss', from: 'craft', slot: pr.slot });
        continue;
      }
      if (wd && U.idiv(pr.pos, DF.rangeMul) >= wd.range) {
        ev.push({ t: 'df.miss', from: 'craft', slot: pr.slot });
        continue;
      }
      if (!d.over) keep.push(pr);
    }
    d.projectiles = keep;

    // armas da nave
    const mdef = DF.modes[d.mode];
    const reloadKey = (mdef && mdef.reload) || 'standard';
    for (const ws of d.weapons) {
      if (d.over) break;
      const w = craft.weapons[ws.slot];
      if (!w) continue;
      const wd = D().craftWeapons[w.type];
      if (ws.reload === 0) {
        if (!(mdef && mdef.fire) || d.dist > wd.range * DF.rangeMul || !hasAmmo(w) || !ws.enabled) continue;
        if (w.ammo !== null) w.ammo--;
        ws.reload = wd.reload[reloadKey];
        const hit = r.pct(D().dogfightHitChance(wd.acc, udef.size));
        const dmg = hit ? r.int(U.idiv(wd.dmg * DF.craftDmgMinNum, DF.craftDmgMinDen), wd.dmg) : 0;
        ev.push({ t: 'df.fire', from: 'craft', slot: ws.slot, weapon: w.type });
        if (wd.beam) {
          if (hit) hitUfo(d, ufo, udef, dmg, ws.slot, ev);
          else ev.push({ t: 'df.miss', from: 'craft', slot: ws.slot });
        } else {
          d.projectiles.push({ from: 'craft', slot: ws.slot, weapon: w.type, pos: 0, hit, dmg });
        }
      } else {
        ws.reload--;
      }
    }

    // tiro do OVNI: só ao primeiro dogfight dentro do alcance (getShootingAt orig)
    const uw = udef.weapon;
    const ufoRange = uw.range * DF.rangeMul;
    if (!d.over && uw.power > 0 && uw.range > 0 && d.dist <= ufoRange && d.ufoReload === 0) {
      const shooter = G.dogfights.find((x) => x.ufoId === d.ufoId && !x.over && x.dist <= ufoRange);
      if (shooter === d) {
        const R = Math.max(1, uw.reload - DF.ufoReloadCoefMul * coef(G));
        d.ufoReload = r.int(0, R) + R;
        ev.push({ t: 'df.fire', from: 'ufo' });
        const dmg = r.pct(DF.ufoHitPct) ? r.int(0, uw.power) : 0;
        if (dmg > 0) {
          craft.hp = Math.max(0, craft.hp - dmg);
          ev.push({ t: 'df.hit', target: 'craft', dmg });
          if (craft.hp <= 0) end(d, 'craftDestroyed');
          else if (d.mode === 'cautious' && (cdef.hp - craft.hp) * 100 >= cdef.hp * DF.cautiousRetreatDmgPct) {
            d.mode = 'standoff';
            ev.push({ t: 'df.retreat' });
          }
        } else {
          ev.push({ t: 'df.miss', from: 'ufo' });
        }
      }
    }
    if (d.dist !== before) ev.push({ t: 'df.move', dist: d.dist });

    // fim: fuga, desengate, ou nave sem munições recolhida à Distância
    if (!d.over) {
      if (fleeing && d.dist > DF.endDist && !d.projectiles.length) end(d, 'escaped');
      else if (d.mode === 'disengage' && d.dist > DF.endDist) end(d, 'disengaged');
      else if (!craft.weapons.some(hasAmmo) && !d.projectiles.length && d.dist >= DF.standoff) end(d, 'craftRetreated');
    }
    return d.over ? closeOut(G, d, ev) : ev;
  }

  function closeOut(G, d, ev) {
    ev.push({ t: 'df.end', outcome: d.outcome });
    finish(G, d.id);
    return ev;
  }

  // OVNI abatido sem OV.Missions (só para depuração isolada): queda simples ou remoção
  function ufoDownFallback(G, ufo, how, craftId) {
    if (how === 'destroyed') {
      C().removeById(G.ufos, ufo.id);
      C().event(G, 'ufoDestroyed', { ufoId: ufo.id, craftId, type: ufo.type, score: 0 });
    } else {
      ufo.status = 'crashed';
      ufo.speed = 0;
      ufo.crashLeftS = tune('CRASH_SITE_HOURS', [24, 72])[0] * 3600;
      C().event(G, 'ufoCrashed', { ufoId: ufo.id, craftId, lon: ufo.lon, lat: ufo.lat });
    }
  }
  // nave perdida sem OV.World.loseCraft (contrato §3.3)
  function loseCraftFallback(G, craft) {
    const def = D().crafts[craft.type];
    const soldiers = craft.soldiers.slice();
    for (const sid of soldiers) OV.Soldiers.kill(G, sid, 'craft', { kind: 'craft', lon: craft.lon, lat: craft.lat });
    const base = C().findBase(G, craft.baseId);
    if (base) C().removeById(base.crafts, craft.id);
    delete G.crafts[craft.id];
    OV.Economy.addScore(G, 'xcom', -def.score, craft.lon, craft.lat);
    G.stats.craftsLost = (G.stats.craftsLost | 0) + 1;
    C().event(G, 'craftLost', { craftId: craft.id, type: craft.type, reason: 'dogfight', soldiers });
  }

  // aplica o resultado (contrato §5.5) e remove o dogfight
  function finish(G, id) {
    const d = C().findDogfight(G, id);
    if (!d) return null;
    if (!d.over) end(d, 'disengaged');
    C().removeById(G.dogfights, d.id);
    const craft = C().findCraft(G, d.craftId);
    const ufo = C().findUfo(G, d.ufoId);
    const o = d.outcome;
    if ((o === 'crashed' || o === 'destroyed') && ufo && ufo.status === 'flying') {
      if (OV.Missions && typeof OV.Missions.onUfoDown === 'function') OV.Missions.onUfoDown(G, ufo.id, o, d.craftId);
      else ufoDownFallback(G, ufo, o, d.craftId);
    } else if (o === 'escaped' && ufo) {
      C().event(G, 'ufoEscaped', { ufoId: ufo.id, craftId: d.craftId });
    }
    if (craft) {
      craft.dogfightId = null;
      if (o === 'craftDestroyed') {
        if (OV.World && typeof OV.World.loseCraft === 'function') OV.World.loseCraft(G, craft.id, 'dogfight');
        else loseCraftFallback(G, craft);
      } else {
        craft.status = 'returning';
        craft.dest = { kind: 'base', id: craft.baseId };
        craft.patrol = false;
        craft.speed = D().crafts[craft.type].speed;
      }
    }
    C().event(G, 'dogfightEnd', { dogfightId: d.id, craftId: d.craftId, ufoId: d.ufoId, outcome: o });
    return o;
  }

  // resolução sem interface (bot, testes): ticks até acabar; ao fim de maxTicks desengata
  function autoResolve(G, id, mode, maxTicks) {
    const d = C().findDogfight(G, id);
    if (!d) return null;
    const limit = maxTicks === undefined ? 20000 : maxTicks;
    setMode(G, id, mode || 'standard');
    let n = 0;
    while (!d.over) {
      if (n++ === limit) setMode(G, id, 'disengage');
      tick(G, id);
      if (n > limit + 2000) {
        finish(G, id);
        break;
      }
    }
    return d.outcome;
  }

  OV.Dogfight = { create, tick, setMode, toggleWeapon, disengage, hitChance, targetDist, breakingOff, autoResolve, finish };
})(globalThis.OV || (globalThis.OV = {}));
