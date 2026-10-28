/* Interface: menu de escaramuça, barra lateral (produção, poderes, seleção, comandos), mensagens, pausa e ecrã final */
'use strict';
(function () {
  const CG = window.CG;
  const U = (CG.ui = {});
  const $ = (id) => document.getElementById(id);
  const esc = CG.esc;

  const DEFAULTS = { faction: 'atl', opponents: 1, difficulty: 'normal', mapSize: 'medium', credits: 5000, theme: 'random', sound: true, music: true, voice: true, speed: 1 };
  const S = Object.assign({}, DEFAULTS, CG.store.get('cg2026.settings', {}));
  const SEGS = {
    opponents: [[1, '1'], [2, '2'], [3, '3']],
    difficulty: [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']],
    mapSize: [['small', 'Pequeno'], ['medium', 'Médio'], ['large', 'Grande']],
    credits: [[3000, '3 000'], [5000, '5 000'], [10000, '10 000']],
    theme: [['random', 'Aleatório'], ['desert', 'Deserto'], ['steppe', 'Estepe'], ['tundra', 'Tundra']],
    speed: [[1, 'Normal'], [1.5, 'Rápida'], [2, 'Turbo']],
  };
  const EMBLEM = {
    atl: '<svg viewBox="0 0 48 48" class="em"><circle cx="24" cy="24" r="21" fill="#0f2a44" stroke="#4fa8ff" stroke-width="2"/><path d="M24 7l4 13h13l-10.5 8 4 13L24 33l-10.5 8 4-13L7 20h13z" fill="#4fa8ff"/></svg>',
    eur: '<svg viewBox="0 0 48 48" class="em"><path d="M24 4l18 7v12c0 11-8 18-18 21C14 41 6 34 6 23V11z" fill="#3a1512" stroke="#ff5a4a" stroke-width="2"/><path d="M14 18l10 6 10-6M14 26l10 6 10-6" fill="none" stroke="#ff5a4a" stroke-width="3"/></svg>',
    van: '<svg viewBox="0 0 48 48" class="em"><circle cx="24" cy="24" r="21" fill="#3a2a0a" stroke="#ffb21f" stroke-width="2"/><circle cx="24" cy="30" r="8" fill="#ffb21f"/><path d="M24 8v8M10 16l6 5M38 16l-6 5M6 30h8M34 30h8" stroke="#ffb21f" stroke-width="3"/><path d="M6 36h36" stroke="#ffb21f" stroke-width="2"/></svg>',
  };
  const UNIQUE = { atl: ['sniper', 'himars', 'dscout'], eur: ['tank_e', 'arty', 'grad'], van: ['hacker', 'phantom', 'swarm'] };

  let G = null, tab = 'bld', lastOpts = null, fpsOn = false, endShown = false, creditsShown = 0, uiT = 0;
  let buildEls = {}, powerEls = {}, cmdEls = {}, selRefs = null;

  function save() { CG.store.set('cg2026.settings', S); }
  function sfx(n) { if (CG.audio) CG.audio.play(n); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  // ---------------------------------------------------------------- menu
  function buildMenu() {
    const fc = $('factions');
    fc.innerHTML = Object.values(CG.FACTIONS).map((f) => `
      <button class="fc" data-f="${f.id}">
        ${EMBLEM[f.id]}
        <div class="fn">${esc(f.name)}</div>
        <div class="fb">${esc(f.bloc)}</div>
        <p>${esc(f.motto)}</p>
        <ul>${f.traits.map((t) => '<li>' + esc(t) + '</li>').join('')}</ul>
        <p style="margin-top:6px;font-size:11px;color:#7f97a8">Unidades únicas: ${UNIQUE[f.id].map((u) => esc(CG.UNITS[u].name)).join(' · ')}</p>
      </button>`).join('');
    fc.querySelectorAll('.fc').forEach((b) => b.addEventListener('click', () => { S.faction = b.dataset.f; save(); syncMenu(); sfx('click'); }));
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.key;
      seg.innerHTML = SEGS[key].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('');
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const raw = SEGS[key].find(([v]) => String(v) === b.dataset.v)[0];
        S[key] = raw;
        save();
        syncMenu();
        if (key === 'speed' && G) G.speed = raw;
        sfx('click');
      }));
    });
    const bindToggle = (ids, key) => ids.forEach((id) => $(id).addEventListener('change', (e) => {
      S[key] = e.target.checked;
      save();
      syncMenu();
      if (CG.audio) {
        CG.audio.init();
        CG.audio.configure(S);
        if (key === 'music' || key === 'sound') {
          if (S.music && S.sound && G && !G.paused) CG.audio.startMusic();
          else CG.audio.stopMusic();
        }
      }
    }));
    bindToggle(['opt-sound', 'opt-sound2'], 'sound');
    bindToggle(['opt-music', 'opt-music2'], 'music');
    bindToggle(['opt-voice', 'opt-voice2'], 'voice');
    $('btn-start').addEventListener('click', () => startGame());
    $('btn-help').addEventListener('click', () => { show('screen-help'); sfx('click'); });
    $('btn-help2').addEventListener('click', () => { show('screen-help'); sfx('click'); });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => hide(b.dataset.close)));
    $('btn-resume').addEventListener('click', () => U.togglePause());
    $('btn-restart').addEventListener('click', () => { hide('screen-pause'); startGame(lastOpts); });
    $('btn-quit').addEventListener('click', () => quitToMenu());
    $('btn-again').addEventListener('click', () => { hide('screen-end'); startGame(); });
    $('btn-menu').addEventListener('click', () => quitToMenu());
    $('rps').innerHTML = rpsSvg();
    syncMenu();
  }

  function syncMenu() {
    document.querySelectorAll('.fc').forEach((b) => b.classList.toggle('on', b.dataset.f === S.faction));
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(S[seg.dataset.key])));
    });
    for (const [ids, key] of [[['opt-sound', 'opt-sound2'], 'sound'], [['opt-music', 'opt-music2'], 'music'], [['opt-voice', 'opt-voice2'], 'voice']]) {
      for (const id of ids) $(id).checked = !!S[key];
    }
  }

  function rpsSvg() {
    const node = (x, y, t, c) => `<g><circle cx="${x}" cy="${y}" r="30" fill="#0e151c" stroke="${c}" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="${c}" font-size="11" font-weight="700" font-family="sans-serif">${t}</text></g>`;
    const arr = (x1, y1, x2, y2, label, lx, ly) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7f97a8" stroke-width="2" marker-end="url(#ah)"/><text x="${lx}" y="${ly}" text-anchor="middle" fill="#a9bccb" font-size="10" font-family="sans-serif">${label}</text>`;
    return `<svg viewBox="0 0 300 220" role="img" aria-label="Triângulo tático">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#7f97a8"/></marker></defs>
      ${arr(132, 70, 78, 150, 'vence', 86, 100)}
      ${arr(212, 150, 168, 70, 'vence', 216, 100)}
      ${arr(88, 182, 210, 182, 'vence', 150, 200)}
      ${node(150, 42, 'VEÍCULOS', '#ffb21f')}${node(60, 178, 'INFANTARIA', '#4dff88')}${node(240, 178, 'AÉREO', '#4fd1ff')}
    </svg>`;
  }

  function startGame(opts) {
    if (CG.audio) { CG.audio.init(); CG.audio.configure(S); }
    const facIds = Object.keys(CG.FACTIONS);
    if (!opts) {
      opts = {
        faction: S.faction,
        opponents: Array.from({ length: S.opponents }, () => ({ faction: facIds[Math.floor(Math.random() * facIds.length)], difficulty: S.difficulty })),
        mapSize: S.mapSize, credits: S.credits, theme: S.theme === 'random' ? null : S.theme, speed: S.speed,
      };
    }
    opts = Object.assign({}, opts, { seed: (Math.random() * 0xffffffff) >>> 0, speed: S.speed });
    lastOpts = opts;
    hide('screen-menu');
    hide('screen-pause');
    hide('screen-end');
    show('game');
    CG.start(opts);
  }

  function quitToMenu() {
    CG.stop();
    G = null;
    if (CG.audio) CG.audio.stopMusic();
    hide('screen-pause');
    hide('screen-end');
    hide('game');
    hideTip();
    show('screen-menu');
  }

  // ---------------------------------------------------------------- arranque de partida
  U.onStart = function (game) {
    G = game;
    endShown = false;
    tab = 'bld';
    const H = G.players[G.human];
    creditsShown = H.credits;
    buildTabs();
    buildPowers();
    buildCmds();
    buildGrid();
    U.selectionChanged(G);
    $('msgs').innerHTML = '';
    $('fps').classList.toggle('hidden', !fpsOn);
    if (CG.audio) {
      CG.audio.listener = G.cam;
      if (S.music && S.sound) CG.audio.startMusic();
    }
    const th = G.map.theme;
    U.toast('Teatro de operações: ' + G.map.name + ' (' + th.name + ')', 'info');
    U.toast('Começa por uma Central Elétrica e uma Refinaria', 'info');
    if (CG.audio) CG.audio.speak('Comandante, a base está operacional');
    U.modeChanged(G);
  };

  U.inGame = () => !!G && !$('game').classList.contains('hidden') && $('screen-menu').classList.contains('hidden');

  U.togglePause = function () {
    if (!G || G.over) return;
    G.paused = !G.paused;
    if (G.paused) {
      syncMenu();
      show('screen-pause');
      if (CG.audio) CG.audio.stopMusic();
    } else {
      hide('screen-pause');
      hide('screen-help');
      if (CG.audio && S.music && S.sound) CG.audio.startMusic();
    }
  };
  U.toggleFps = function () {
    fpsOn = !fpsOn;
    $('fps').classList.toggle('hidden', !fpsOn);
  };

  // ---------------------------------------------------------------- mensagens
  U.toast = function (text, kind) {
    const box = $('msgs');
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || 'info');
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('fade'), 3600);
    setTimeout(() => d.remove(), 4300);
  };
  U.ping = (x, y) => CG.render.ping(x, y);

  // ---------------------------------------------------------------- separadores e grelha de produção
  function buildTabs() {
    const el = $('tabs');
    el.innerHTML = CG.BUILD_TABS.map((t) => `<button class="tab" data-tab="${t.id}" title="${t.name}">${t.short}<i class="dot"></i></button>`).join('');
    el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { setTab(b.dataset.tab); sfx('click'); }));
    markTabs();
  }
  function markTabs() {
    $('tabs').querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }
  function setTab(id) {
    tab = id;
    markTabs();
    buildGrid();
  }
  U.cycleTab = function (d) {
    const ids = CG.BUILD_TABS.map((t) => t.id);
    setTab(ids[(ids.indexOf(tab) + d + ids.length) % ids.length]);
  };

  function itemsFor(t, p) {
    if (t === 'bld') return CG.STRUCT_ORDER;
    if (t === 'def') return CG.DEF_ORDER;
    return p.faction.units.filter((id) => CG.UNITS[id].cat === t);
  }

  function buildGrid() {
    if (!G) return;
    const p = G.players[G.human];
    const box = $('build');
    box.innerHTML = '';
    buildEls = {};
    for (const id of itemsFor(tab, p)) {
      const def = CG.typeDef(id);
      const el = document.createElement('button');
      el.className = 'bi';
      el.innerHTML = `<canvas width="224" height="128"></canvas><span class="prog"></span><span class="cost">${CG.fmt(CG.costOf(p, def))}</span><span class="cnt"></span><span class="state"></span><span class="nm">${esc(def.name)}</span><span class="x" title="Cancelar">✕</span>`;
      el.querySelector('canvas').getContext('2d').drawImage(CG.sprites.icon(id, G.human, p.fid), 0, 0);
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) { cancelItem(id); return; }
        clickItem(id, e.shiftKey);
      });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelItem(id); });
      el.addEventListener('mouseenter', () => showTip(el, tipFor(id)));
      el.addEventListener('mouseleave', hideTip);
      box.appendChild(el);
      buildEls[id] = {
        el, prog: el.querySelector('.prog'), cnt: el.querySelector('.cnt'), state: el.querySelector('.state'),
        cost: el.querySelector('.cost'), last: '',
      };
    }
    updateGrid();
  }

  function clickItem(id, shift) {
    const p = G.players[G.human];
    const def = CG.typeDef(id);
    const key = CG.queueKey(def);
    const q = p.queues[key];
    if (CG.audio) CG.audio.init();
    if (key === 'bld') {
      if (q.ready && q.items[0] === id) {
        CG.input.setMode(G, { type: 'place', item: id });
        sfx('click');
        return;
      }
      if (q.items.length && q.items[0] === id) { U.toast('Em construção…', 'info'); return; }
    }
    const err = CG.enqueue(G, p, id);
    if (err) {
      U.toast(err, 'warn');
      sfx('error');
      return;
    }
    if (shift && key !== 'bld') for (let i = 0; i < 4; i++) CG.enqueue(G, p, id);
    sfx('click');
    updateGrid();
  }
  function cancelItem(id) {
    const p = G.players[G.human];
    if (G.mode && G.mode.type === 'place' && G.mode.item === id) CG.input.setMode(G, null);
    if (CG.dequeue(G, p, id)) { sfx('sell'); updateGrid(); }
  }

  function updateGrid() {
    const p = G.players[G.human];
    for (const id in buildEls) {
      const r = buildEls[id];
      const def = CG.typeDef(id);
      const key = CG.queueKey(def);
      const q = p.queues[key];
      const locked = !CG.hasPrereqs(p, def);
      const count = q.items.reduce((n, x) => n + (x === id ? 1 : 0), 0);
      const head = q.items[0] === id;
      let state = '', cls = '';
      let prog = 0;
      if (head) {
        prog = 1 - q.progress;
        if (key === 'bld' && q.ready) { state = 'PRONTO'; cls = 'ready'; prog = 0; }
        else if (q.stalled) { state = p.unitCount >= CG.UNIT_CAP && key !== 'bld' ? 'LIMITE' : 'EM ESPERA'; cls = 'hold'; }
      } else if (count > 0) { prog = 1; }
      else if (key === 'bld' && q.items.length) prog = 0.6;
      const sig = [locked, count, cls, state, Math.round(prog * 100)].join('|');
      if (sig === r.last) continue;
      r.last = sig;
      r.el.classList.toggle('locked', locked);
      r.el.classList.toggle('ready', cls === 'ready');
      r.el.classList.toggle('hold', cls === 'hold');
      r.el.classList.toggle('queued', count > 0);
      r.prog.style.height = (prog * 100).toFixed(1) + '%';
      r.state.textContent = state;
      r.cnt.style.display = count > 1 || (count === 1 && key !== 'bld') ? 'block' : 'none';
      r.cnt.textContent = count;
    }
    $('tabs').querySelectorAll('.tab').forEach((b) => {
      const t = b.dataset.tab;
      const qk = t === 'def' ? 'bld' : t;
      const q = p.queues[qk];
      let busy = q.items.length > 0, ready = false;
      if (qk === 'bld' && q.items.length) {
        const isDef = CG.BUILDINGS[q.items[0]].tab === 'def';
        busy = (t === 'def') === isDef;
        ready = busy && q.ready;
      }
      b.classList.toggle('busy', busy && !ready);
      b.classList.toggle('ready', ready);
    });
  }

  // ---------------------------------------------------------------- dicas (tooltip)
  function strongAgainst(w) {
    if (!w) return '';
    const m = CG.WARHEADS[w.wh];
    const names = { inf: 'infantaria', veh: 'veículos', air: 'aéreos', bld: 'edifícios' };
    const best = Object.keys(m).filter((k) => m[k] >= 1).map((k) => names[k]);
    return best.length ? 'Forte contra ' + best.join(', ') : '';
  }
  function tipFor(id) {
    const p = G.players[G.human];
    const def = CG.typeDef(id);
    let meta = '₵ ' + CG.fmt(CG.costOf(p, def)) + ' · ' + def.time + ' s';
    if (def.kind === 'bld' && def.power) meta += ' · ⚡ ' + (def.power > 0 ? '+' : '') + def.power;
    let stats = '';
    if (def.kind === 'unit') {
      const sub = def.spawn ? CG.UNITS[def.spawn] : def;
      stats = 'Vida ' + sub.hp * (def.squad || 1) + (def.squad ? ' (' + def.squad + '×)' : '') + ' · Vel. ' + sub.speed;
      if (sub.weapon) stats += ' · Alcance ' + (sub.weapon.range / CG.TILE).toFixed(1);
      const sa = strongAgainst(sub.weapon);
      if (sa) stats += '<br>' + sa;
    } else if (def.weapon) {
      stats = 'Vida ' + def.hp + ' · Alcance ' + ((def.weapon.range / CG.TILE) * p.faction.mods.defRange).toFixed(1) + '<br>' + strongAgainst(def.weapon);
    } else stats = 'Vida ' + def.hp;
    const miss = CG.missingPrereqs(p, def);
    return `<h4>${esc(def.name)}</h4><div class="meta">${meta}</div><p>${esc(def.desc)}</p><p style="margin-top:4px;color:#7f97a8">${stats}</p>${miss.length ? '<div class="req">Requer: ' + miss.map((r) => esc(CG.PREREQ_NAMES[r])).join(', ') + '</div>' : ''}`;
  }
  function showTip(el, html) {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    const t = $('tooltip');
    t.innerHTML = html;
    t.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left - tw - 8, y = r.top;
    if (x < 4) x = r.right + 8;
    y = CG.clamp(y, 4, window.innerHeight - th - 4);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  function hideTip() { $('tooltip').classList.add('hidden'); }

  // ---------------------------------------------------------------- poderes de apoio
  function buildPowers() {
    const p = G.players[G.human];
    const box = $('powers');
    box.innerHTML = '';
    powerEls = {};
    for (const id of p.faction.powers) {
      const def = CG.POWERS[id];
      const b = document.createElement('button');
      b.className = 'pw locked';
      b.innerHTML = `<canvas width="68" height="68"></canvas><span class="nm">${esc(def.name)}</span><i class="cd"></i>`;
      const c = b.querySelector('canvas').getContext('2d');
      CG.sprites.powerIcon(c, def.icon, 34, 34, 2, '#4fd1ff');
      b.addEventListener('click', () => {
        const pw = p.powers[id];
        if (!pw.avail) { U.toast('Requer ' + CG.PREREQ_NAMES[def.prereq], 'warn'); sfx('error'); return; }
        if (pw.charge < 1) { U.toast(def.name + ': a carregar (' + Math.round(pw.charge * 100) + '%)', 'warn'); sfx('error'); return; }
        if (p.lowPower) { U.toast('Energia insuficiente', 'warn'); sfx('error'); return; }
        CG.input.setMode(G, G.mode && G.mode.type === 'power' && G.mode.id === id ? null : { type: 'power', id });
        sfx('click');
      });
      b.addEventListener('mouseenter', () => {
        const pw = p.powers[id];
        showTip(b, `<h4>${esc(def.name)}</h4><div class="meta">Recarga ${def.cd} s · Raio ${def.radius} tiles</div><p>${esc(def.desc)}</p>${pw.avail ? '' : '<div class="req">Requer: ' + esc(CG.PREREQ_NAMES[def.prereq]) + '</div>'}`);
      });
      b.addEventListener('mouseleave', hideTip);
      box.appendChild(b);
      powerEls[id] = { b, cd: b.querySelector('.cd') };
    }
  }
  function updatePowers() {
    const p = G.players[G.human];
    for (const id in powerEls) {
      const r = powerEls[id];
      const pw = p.powers[id];
      r.b.classList.toggle('locked', !pw.avail);
      r.b.classList.toggle('ready', pw.avail && pw.charge >= 1 && !p.lowPower);
      r.b.classList.toggle('active', !!(G.mode && G.mode.type === 'power' && G.mode.id === id));
      r.cd.style.width = (pw.charge * 100).toFixed(1) + '%';
    }
  }

  // ---------------------------------------------------------------- comandos
  function buildCmds() {
    const defs = [
      ['amove', 'ATACAR', 'A', () => CG.input.setMode(G, G.mode && G.mode.type === 'amove' ? null : { type: 'amove' })],
      ['stop', 'PARAR', 'S', () => CG.input.stop(G)],
      ['deploy', 'IMPLANTAR', 'D', () => { if (!CG.input.deploy(G)) sfx('error'); }],
      ['desel', '✕ SEL.', 'Esc', () => { CG.input.setMode(G, null); CG.input.setSelection(G, [], false); }],
      ['repair', 'REPARAR', 'R', () => CG.input.setMode(G, G.mode && G.mode.type === 'repair' ? null : { type: 'repair' })],
      ['sell', 'VENDER', 'V', () => CG.input.setMode(G, G.mode && G.mode.type === 'sell' ? null : { type: 'sell' })],
      ['home', 'BASE', 'H', () => {
        const cy = G.entities.find((e) => e.alive && e.owner === G.human && e.def.conyard) || G.entities.find((e) => e.alive && e.owner === G.human && e.kind === 'bld');
        if (cy) CG.input.centerOn(G, cy.x, cy.y);
      }],
      ['menu', '☰ MENU', 'P', () => U.togglePause()],
    ];
    const box = $('cmds');
    box.innerHTML = '';
    cmdEls = {};
    for (const [id, label, key, fn] of defs) {
      const b = document.createElement('button');
      b.innerHTML = esc(label) + '<kbd>' + key + '</kbd>';
      b.addEventListener('click', () => { if (CG.audio) CG.audio.init(); fn(); sfx('click'); U.modeChanged(G); });
      box.appendChild(b);
      cmdEls[id] = b;
    }
  }
  function updateCmds() {
    const units = CG.input.ownUnits(G);
    cmdEls.amove.disabled = !units.some((u) => u.def.weapon);
    cmdEls.stop.disabled = !units.length;
    cmdEls.deploy.disabled = !units.some((u) => u.def.mcv);
    cmdEls.desel.disabled = !G.sel.length && !G.mode;
    cmdEls.amove.classList.toggle('on', !!(G.mode && G.mode.type === 'amove'));
    cmdEls.repair.classList.toggle('on', !!(G.mode && G.mode.type === 'repair'));
    cmdEls.sell.classList.toggle('on', !!(G.mode && G.mode.type === 'sell'));
  }

  U.modeChanged = function (game) {
    if (!game || !cmdEls.amove) return;
    updateCmds();
    updatePowers();
    updateHint();
  };
  function updateHint() {
    const m = G.mode;
    const h = $('hint');
    let t = '';
    if (m) {
      if (m.type === 'place') t = 'Coloca «' + CG.BUILDINGS[m.item].name + '» no mapa · botão direito ou Esc cancela' + (m.ok === false && m.reason ? ' · ' + m.reason : '');
      else if (m.type === 'amove') t = 'Atacar-mover: escolhe o destino (Shift mantém o modo)';
      else if (m.type === 'sell') t = 'Vender: clica num edifício teu (devolve 50%)';
      else if (m.type === 'repair') t = 'Reparar: clica num edifício danificado teu';
      else if (m.type === 'power') t = CG.POWERS[m.id].name + ': escolhe o alvo no mapa';
    }
    if (t) {
      if (h.textContent !== t) h.textContent = t;
      h.classList.remove('hidden');
    } else h.classList.add('hidden');
  }

  // ---------------------------------------------------------------- painel de seleção
  U.selectionChanged = function (game) {
    if (!game) return;
    G = game;
    const box = $('selinfo');
    const sel = G.sel.map((id) => G.byId.get(id)).filter((e) => e && e.alive);
    selRefs = null;
    if (!sel.length) {
      box.innerHTML = '<div style="line-height:1.45">Nada selecionado.<br>Clica numa unidade ou arrasta uma caixa. Botão direito dá ordens.</div>';
      if (cmdEls.amove) updateCmds();
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const own = e.owner === G.human;
      const fid = e.owner < 0 ? 'neutral' : G.players[e.owner].fid;
      const who = e.owner < 0 ? 'Neutro' : own ? 'As tuas forças' : 'Inimigo · ' + G.players[e.owner].faction.name;
      let extra = '';
      if (e.kind === 'unit' && e.def.weapon) extra = strongAgainst(e.def.weapon);
      if (e.kind === 'bld' && e.def.power) extra = '⚡ ' + (e.def.power > 0 ? '+' : '') + e.def.power;
      if (e.kind === 'bld' && own && (e.def.produces || e.def.conyard)) extra += (extra ? ' · ' : '') + 'Botão direito no mapa: ponto de reunião';
      box.innerHTML = `<div class="row"><canvas class="ic" width="224" height="128"></canvas><div style="flex:1;min-width:0">
        <div class="nm">${esc(e.def.name)}</div><div>${esc(who)}</div><div class="hp"><i></i></div><div class="st"></div></div></div>
        <div style="margin-top:3px">${esc(extra)}</div>
        ${own && e.kind === 'bld' && !e.def.noCount ? '<div class="acts"><button data-a="repair">REPARAR</button><button data-a="sell">VENDER</button></div>' : ''}`;
      box.querySelector('canvas').getContext('2d').drawImage(CG.sprites.icon(e.type, Math.max(0, e.owner), fid), 0, 0);
      const acts = box.querySelectorAll('.acts button');
      acts.forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.a === 'repair') e.repairing = !e.repairing && e.hp < e.maxHp;
        else CG.sellBuilding(G, e);
        sfx('click');
      }));
      selRefs = { e, hp: box.querySelector('.hp i'), st: box.querySelector('.st'), rep: box.querySelector('[data-a="repair"]') };
    } else {
      const groups = {};
      for (const e of sel) (groups[e.type] = groups[e.type] || []).push(e);
      box.innerHTML = '<div class="multi">' + Object.keys(groups).map((t) => `<button data-t="${t}" title="${esc(CG.typeDef(t).name)}"><canvas width="224" height="128"></canvas><b>${groups[t].length}</b></button>`).join('') + '</div>';
      box.querySelectorAll('.multi button').forEach((b) => {
        const t = b.dataset.t;
        const e0 = groups[t][0];
        b.querySelector('canvas').getContext('2d').drawImage(CG.sprites.icon(t, e0.owner, G.players[e0.owner].fid), 0, 0);
        b.addEventListener('click', () => CG.input.setSelection(G, groups[t].map((e) => e.id), false));
      });
    }
    if (cmdEls.amove) updateCmds();
  };
  function updateSel() {
    if (!selRefs) {
      if (G.sel.length && G.sel.some((id) => !G.byId.get(id))) U.selectionChanged(G);
      return;
    }
    const e = selRefs.e;
    if (!e.alive || (e.owner !== G.human && e.kind === 'bld' && !e.sel)) { CG.input.setSelection(G, [], false); return; }
    const f = e.hp / e.maxHp;
    selRefs.hp.style.width = (f * 100).toFixed(1) + '%';
    selRefs.hp.style.background = f > 0.5 ? '#4dff88' : f > 0.25 ? '#ffd23a' : '#ff4a3d';
    let st = 'Vida ' + Math.ceil(e.hp) + ' / ' + e.maxHp;
    if (e.kind === 'unit' && e.def.harvester) st += ' · Carga ' + Math.round(e.carry) + '/' + e.def.capacity;
    if (e.disabled > 0) st += ' · DESATIVADO';
    if (e.kind === 'bld' && e.built < 1) st += ' · Em construção';
    if (e.kind === 'unit' && e.def.stealth) st += e.firedT > 2.5 ? ' · Furtivo' : ' · Exposto';
    if (selRefs.st.textContent !== st) selRefs.st.textContent = st;
    if (selRefs.rep) selRefs.rep.classList.toggle('on', !!e.repairing);
  }

  // ---------------------------------------------------------------- por fotograma
  U.frame = function (game, dt) {
    G = game;
    const p = G.players[G.human];
    creditsShown += (p.credits - creditsShown) * Math.min(1, dt * 8);
    if (Math.abs(p.credits - creditsShown) < 1) creditsShown = p.credits;
    const ct = CG.fmt(creditsShown);
    const cel = $('credits');
    if (cel.textContent !== ct) cel.textContent = ct;
    uiT += dt;
    if (uiT >= 0.1) {
      uiT = 0;
      const max = Math.max(p.powerProd, p.powerUse, 100) * 1.15;
      $('power-fill').style.width = ((p.powerProd / max) * 100).toFixed(1) + '%';
      $('power-use').style.left = ((p.powerUse / max) * 100).toFixed(1) + '%';
      $('power-bar').classList.toggle('low', p.lowPower);
      const pt = p.powerUse + ' / ' + p.powerProd;
      if ($('power-txt').textContent !== pt) $('power-txt').textContent = pt;
      const ro = $('radar-off');
      ro.classList.toggle('hidden', p.hasRadar);
      if (!p.hasRadar) ro.querySelector('small').textContent = (p.owned.radar || 0) > 0 ? 'Sem energia para o radar' : 'Constrói um Centro de Comunicações';
      $('clock').textContent = CG.fmtTime(G.time) + (G.speed !== 1 ? ' ×' + G.speed : '');
      if (fpsOn && G.perf) $('fps').textContent = Math.round(G.perf.fps) + ' FPS · sim ' + G.perf.sim.toFixed(1) + ' ms · draw ' + G.perf.draw.toFixed(1) + ' ms · ' + G.entities.length + ' ent.';
      updateGrid();
      updatePowers();
      updateCmds();
      updateSel();
      updateHint();
      if (G.mode && G.mode.type === 'place' && p.queues.bld.items[0] !== G.mode.item) CG.input.setMode(G, null);
    }
    if (G.over && !endShown && G.time - G.overAt > 2.5) showEnd();
  };

  function showEnd() {
    endShown = true;
    hideTip();
    if (CG.audio) CG.audio.stopMusic();
    const win = G.result === 'victory';
    const t = $('end-title');
    t.textContent = win ? 'VITÓRIA' : 'DERROTA';
    t.className = win ? 'win' : 'lose';
    $('end-sub').textContent = (win ? 'Missão cumprida' : 'Missão falhada') + ' · Duração ' + CG.fmtTime(G.overAt) + ' · ' + G.map.name;
    const rows = G.players.map((p) => `<tr><td><span class="sw" style="background:${p.color.main}"></span>${esc(p.id === G.human ? 'Tu' : p.name)} · ${esc(p.faction.name)}</td>
      <td>${p.stats.unitsBuilt}</td><td>${p.stats.unitsLost}</td><td>${p.stats.unitsKilled}</td><td>${p.stats.bldKilled}</td><td>${CG.fmt(p.stats.harvested)}</td></tr>`).join('');
    $('end-stats').innerHTML = `<table class="stats"><tr><th>Jogador</th><th>Unid. produzidas</th><th>Perdidas</th><th>Abatidas</th><th>Edif. destruídos</th><th>Capital recolhido</th></tr>${rows}</table>`;
    show('screen-end');
  }

  // ---------------------------------------------------------------- arranque da página
  function boot() {
    buildMenu();
    if (CG.audio) CG.audio.configure(S);
    window.addEventListener('resize', () => { if (G) CG.render.resize(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && G && !G.paused && !G.over && U.inGame()) U.togglePause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('screen-help').classList.contains('hidden')) { hide('screen-help'); e.stopPropagation(); }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
