/* QA da integração da ronda 2 de personas (pendentes que cruzavam ficheiros de vários donos).
   Serve /home/user/HelloWorld com «python3 -m http.server» numa porta livre e verifica, com capturas:
   A) Base 1280×800 só com teclado: Enter num separador deixa o foco no separador ativo; N → Esc volta ao «Novo
      projeto»; N → Enter (Iniciar) não deixa o foco no <body>; E (Equipar) → Esc volta ao botão «Equipar».
   B) Mercado a 1024×700 e 1024×576: «−», «+» e «+10» à vista e dentro da linha (Comprar e Vender).
   C) Briefing da campanha: «N soldados levam armas sem munição» → A (Equipar automaticamente) carrega-as; rodapé do
      Equipar com setas/Enter/⌫; «Repetir a missão» (gravação «Antes da missão») sorteia outro mapa a cada tentativa.
   D) Batalha Rápida: aviso no briefing quando uma arma vai sem carregador; espingardas com 3 carregadores.
   E) Mac (navigator.platform MacIntel): ⌃ Control + Enter a apontar força o tiro na casa do ponteiro e nunca termina
      o turno; «Como Jogar» e a folha de teclas dizem «⌃ Control + Enter».
   F) iPad (toque): textos «.touch» (menu, Opções, briefing noturno) e sem emblemas de tecla nos botões.
   Uso: node qa/integration_r2.mjs [--out DIR] */
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SESSION = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad';
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'integration_r2') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'integration_r2') : path.join(process.cwd(), 'qa-out', 'integration_r2');
const OUT = path.resolve(arg('out', DEF_OUT));
fs.mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(true); }); s.on('error', () => res(false)); });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const URL0 = 'http://127.0.0.1:' + port + '/ovni-1999/index.html';
const errors = [];
const fails = [];
let checks = 0, shotN = 0, browser = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, msg) => { checks++; console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fails.push(msg); };
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function open(view, query, o) {
  const opts = o || {};
  const V = {
    desk: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    small: { viewport: { width: 1024, height: 700 }, deviceScaleFactor: 1 },
    zoom: { viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1 },
    pad: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: IPAD_UA },
  }[view];
  const ctx = await browser.newContext(V);
  if (opts.mac) await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  if (opts.touch) {
    await ctx.addInitScript(() => {
      // iPad: OV.Input.lastPointerType fica 'touch' desde o início (como depois do primeiro toque)
      document.addEventListener('DOMContentLoaded', () => { if (window.OV && OV.Input) OV.Input.lastPointerType = 'touch'; });
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const tag = view + (opts.mac ? '-mac' : '');
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
  await page.goto(URL0 + '?' + (query ? query + '&' : '') + 'debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.CampaignUI && OV.BaseUI && OV.Screens);
  if (opts.touch) await page.evaluate(() => { OV.Input.lastPointerType = 'touch'; });
  await sleep(300);
  return { ctx, page };
}
async function shot(page, name) {
  shotN++;
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, String(shotN).padStart(2, '0') + '_' + name + '.png') });
}
const noMissing = async (page, where) => log(!(await page.evaluate(() => document.body.innerText.includes('⟦'))), where + ': sem chaves ⟦…⟧');
const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'BODY';
  return a.tagName + (a.dataset && a.dataset.tab ? '[tab=' + a.dataset.tab + ']' : '') + (a.dataset && a.dataset.act ? '[act=' + a.dataset.act + ']' : '') + (a.classList.contains('on') ? '.on' : '');
});
const topId = (page) => page.evaluate(() => (OV.Scenes.top() || {}).id);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent).join(' | '));

// campanha com o Skyranger pousado junto a um OVNI aterrado (para o briefing e a repetição)
function setupLanded() {
  /* global OV */
  const C = OV.Campaign;
  const G = C.newCampaign({ seed: 5, difficulty: 1 });
  OV.Game.G = G;
  G.ufos.push({ id: 'u99', type: 'small_scout', status: 'landed', lon: -8, lat: 40, race: 'sectoid', alt: 0, hp: 50, dmg: 0, score: 50, missionId: null, seen: true, detected: true });
  const c = C.findCraft(G, 'c1');
  Object.assign(c, { status: 'patrol', lon: -8, lat: 40, dest: { kind: 'ufo', id: 'u99' } });
  window.__seeds = [];
  if (!C.__wrapped) {
    const orig = C.startMission;
    C.startMission = function (...a) { const m = orig.apply(this, a); window.__seeds.push(m.seed); return m; };
    C.__wrapped = true;
  }
  return true;
}
// tira os carregadores de dois soldados de espingarda (ficam no chão da nave)
function stripClips() {
  const C = OV.Campaign, G = OV.Game.G;
  const pool = C.equipPool(G, 'c1');
  const stores = Object.assign({}, pool.stores);
  const loadouts = {};
  for (const s of pool.squad.filter((q) => q.loadout.R === 'rifle').slice(0, 2)) {
    const lo = JSON.parse(JSON.stringify(s.loadout));
    for (const sl of ['belt', 'pack']) lo[sl] = lo[sl].filter((id) => { if (id === 'rifle_clip') { stores[id] = (stores[id] | 0) + 1; return false; } return true; });
    loadouts[s.id] = lo;
  }
  return C.applyEquip(G, 'c1', { loadouts, stores }).ok;
}

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // ============================== A) Base só com teclado ==============================
  {
    console.log('— A) base: foco');
    const { ctx, page } = await open('desk');
    await page.evaluate(() => { const G = OV.Campaign.newCampaign({ seed: 7, difficulty: 1 }); OV.Game.G = G; OV.BaseUI.open(G, 'b1', 'facilities'); });
    await page.waitForFunction(() => OV.BaseUI.isOpen());
    await sleep(400);
    await page.focus('.bsc-tab[data-tab="research"]');
    await page.keyboard.press('Enter');
    await sleep(250);
    log((await active(page)) === 'BUTTON[tab=research].on', 'Enter num separador: o foco fica no separador ativo (' + (await active(page)) + ')');
    await page.keyboard.press('Tab');
    await sleep(80);
    log((await active(page)) !== 'BODY', 'Tab a seguir continua dentro da base (' + (await active(page)) + ')');
    // N com o foco no <body>
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('n');
    await sleep(350);
    log(await page.evaluate(() => !!document.querySelector('.bsc-sheet-research')), 'N abre a escolha de projeto');
    await page.keyboard.press('Escape');
    await sleep(250);
    log((await active(page)) === 'BUTTON[act=newResearch]', 'N → Esc: o foco volta ao «Novo projeto» (' + (await active(page)) + ')');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('n');
    await sleep(350);
    const before = await page.evaluate(() => OV.Game.G.bases[0].research.length);
    await page.keyboard.press('Enter');
    await sleep(400);
    const after = await page.evaluate(() => OV.Game.G.bases[0].research.length);
    log(after === before + 1, 'N → Enter inicia um projeto (' + before + '→' + after + ')');
    log((await active(page)) !== 'BODY', 'depois de iniciar, o foco não cai no <body> (' + (await active(page)) + ')');
    await shot(page, 'base_research_focus');
    // Equipar pela tecla E e Esc
    await page.keyboard.press('6');
    await sleep(300);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('e');
    await sleep(500);
    log(await page.evaluate(() => !!document.querySelector('.bsc-equip')), 'E abre o «Equipar» da nave');
    await shot(page, 'base_equip');
    await page.keyboard.press('Escape');
    await sleep(400);
    log(await page.evaluate(() => !document.querySelector('.bsc-equip')), 'Esc fecha o «Equipar»');
    log((await active(page)) === 'BUTTON[act=equip]', 'E → Esc: o foco volta ao botão «Equipar» (' + (await active(page)) + ')');
    await noMissing(page, 'base');
    await ctx.close();
  }

  // ============================== B) Mercado a 1024 px ==============================
  for (const view of ['small', 'zoom']) {
    console.log('— B) mercado ' + view);
    const { ctx, page } = await open(view);
    await page.evaluate(() => { const G = OV.Campaign.newCampaign({ seed: 7, difficulty: 1 }); OV.Game.G = G; OV.BaseUI.open(G, 'b1', 'market'); });
    await page.waitForFunction(() => OV.BaseUI.isOpen());
    await sleep(500);
    const probe = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('.bsc-mrow')];
      const bad = [];
      for (const row of rows) {
        const rr = row.getBoundingClientRect();
        const btns = [...row.querySelectorAll('.bsc-stepper.qty .btn')];
        const vis = btns.filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0);
        const out = [...row.querySelectorAll('.btn')].filter((b) => b.getBoundingClientRect().right > rr.right + 0.5);
        if (vis.length !== 3 || out.length || row.scrollWidth > row.clientWidth + 1) bad.push(row.textContent.slice(0, 30) + ' vis=' + vis.length + ' out=' + out.length);
      }
      return { n: rows.length, bad, ten: rows.length ? [...rows[0].querySelectorAll('.bsc-stepper.qty .btn')].map((b) => b.textContent).join(' ') : '' };
    });
    let r = await probe();
    log(r.n > 5 && !r.bad.length, view + ' Comprar: «−», «+», «+10» à vista em ' + r.n + ' linhas, nada fora da linha ' + JSON.stringify(r.bad.slice(0, 3)));
    // «+10» funciona: 1 → 10
    const ten = page.locator('.bsc-mrow[data-buy="rifle_clip"] [data-qty="buy:rifle_clip:+10"]');
    if (await ten.count()) {
      await ten.click();
      await sleep(200);
      log((await page.locator('.bsc-mrow[data-buy="rifle_clip"] .bsc-step-v').textContent()) === '10', view + ': «+10» dá 10');
    } else log(false, view + ': sem linha de carregadores para testar «+10»');
    await shot(page, 'market_buy_' + view);
    await page.locator('[data-mode="sell"]').click();
    await sleep(350);
    r = await probe();
    log(r.n > 3 && !r.bad.length, view + ' Vender: «+10» à vista em ' + r.n + ' linhas ' + JSON.stringify(r.bad.slice(0, 3)));
    await shot(page, 'market_sell_' + view);
    await ctx.close();
  }

  // ============================== C) Briefing da campanha e repetição ==============================
  {
    console.log('— C) briefing da campanha');
    const { ctx, page } = await open('desk');
    await page.evaluate(setupLanded);
    log(await page.evaluate(stripClips), 'dois soldados sem carregadores (applyEquip)');
    await page.evaluate(() => OV.CampaignUI.launchMission(OV.Game.G, { kind: 'ufo', id: 'u99' }, 'c1'));
    await page.waitForFunction(() => (OV.Scenes.top() || {}).id === 'cbriefing');
    await sleep(400);
    let warn = await page.evaluate(() => [...document.querySelectorAll('.cp-warns li')].map((n) => n.textContent).join(' | '));
    log(/2 soldados levam armas sem munição/.test(warn) && /Equipar automaticamente/.test(warn), 'aviso «2 soldados levam armas sem munição» com o botão: ' + warn);
    await shot(page, 'brief_noammo');
    await page.keyboard.press('a');
    await sleep(400);
    warn = await page.evaluate(() => [...document.querySelectorAll('.cp-warns li')].map((n) => n.textContent).join(' | '));
    const t1 = await toasts(page);
    log(!/sem munição/.test(warn), 'A carrega as armas: o aviso desaparece (' + (warn || 'sem avisos') + ')');
    log(/2 armas receberam um carregador/.test(t1), 'aviso «2 armas receberam um carregador»: ' + t1);
    log(await page.evaluate(() => OV.CampaignUI.noAmmoCount(OV.Campaign.equipPool(OV.Game.G, 'c1').squad) === 0), 'equipamento gravado: ninguém sem munição');
    await shot(page, 'brief_loaded');
    // rodapé do Equipar
    await page.keyboard.press('e');
    await page.waitForFunction(() => (OV.Scenes.top() || {}).id === 'equip');
    await sleep(400);
    const hint = await page.evaluate(() => (document.querySelector('.cp-eq .scr-hint') || {}).textContent || '');
    log(/setas e Enter movem objetos/.test(hint) && /⌫ devolve ao armazém/.test(hint), 'rodapé do Equipar: ' + hint);
    const ov = await page.evaluate(() => { const h = document.querySelector('.cp-eq .scr-hint'); return h ? h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).whiteSpace === 'nowrap' : true; });
    log(!ov, 'rodapé do Equipar sem cortar');
    await shot(page, 'equip_hint');
    await page.keyboard.press('Escape');
    await sleep(300);
    // «Repetir a missão»: a gravação «Antes da missão» já existe (launchMission)
    const seeds0 = await page.evaluate(() => window.__seeds.slice());
    const pm = await page.evaluate(() => OV.Save.read('preMission').preMission);
    log(!!pm && pm.siteRef && pm.siteRef.id === 'u99', 'gravação «Antes da missão» escrita');
    await page.keyboard.press('Escape');
    await sleep(300);
    const seen = new Set([seeds0[0]]);
    for (let k = 1; k <= 2; k++) {
      await page.evaluate((p) => OV.CampaignUI.retryMission(OV.Game.G, p), pm);
      await page.waitForFunction(() => (OV.Scenes.top() || {}).id === 'cbriefing');
      await sleep(350);
      const s = await page.evaluate(() => window.__seeds[window.__seeds.length - 1]);
      const tt = await toasts(page);
      log(!seen.has(s), 'repetição ' + k + ': outra semente de mapa (' + s + ' ∉ ' + [...seen].join(',') + ')');
      log(/Nova tentativa/.test(tt), 'repetição ' + k + ': aviso «Nova tentativa…» (' + tt + ')');
      seen.add(s);
      if (k === 1) await shot(page, 'retry_brief');
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    await noMissing(page, 'briefing');
    await ctx.close();
  }

  // ============================== D) Batalha Rápida ==============================
  {
    console.log('— D) Batalha Rápida');
    const { ctx, page } = await open('desk');
    const r = await page.evaluate(() => {
      const { mission, meta } = OV.Screens.buildQuickMission({ kind: 'crash', ufo: 'small_scout', month: 0, seed: 9, squad: 8, time: 'day' });
      const clips = mission.squad.filter((s) => s.loadout.R === 'rifle').map((s) => [s.loadout.R, s.loadout.L].concat(s.loadout.belt, s.loadout.pack).filter((x) => x === 'rifle_clip').length);
      const s0 = mission.squad.find((s) => s.loadout.R === 'rifle');
      s0.loadout.belt = s0.loadout.belt.filter((x) => x !== 'rifle_clip');
      s0.loadout.pack = s0.loadout.pack.filter((x) => x !== 'rifle_clip');
      OV.Scenes.push('briefing', { mission, meta });
      return clips;
    });
    log(r.some((n) => n === 3) && r.every((n) => n >= 2), 'espingardas com 2–3 carregadores (3 quando a Força deixa): ' + r.join(','));
    await page.waitForFunction(() => (OV.Scenes.top() || {}).id === 'briefing');
    await sleep(400);
    const w = await page.evaluate(() => { const b = document.querySelector('.scr-br-warn'); return b && !b.classList.contains('hidden') ? b.textContent : ''; });
    log(/1 soldado leva uma arma sem munição/.test(w) && /Equipar/.test(w), 'briefing rápido avisa: ' + w);
    await shot(page, 'quick_brief_noammo');
    await noMissing(page, 'briefing rápido');
    await ctx.close();
  }

  // ============================== E) Mac: ⌃ Control + Enter ==============================
  {
    console.log('— E) Mac');
    const { ctx, page } = await open('desk', 'battle=medium_scout&seed=7&diff=0', { mac: true });
    await page.waitForFunction(() => OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
    const idle = () => page.waitForFunction(() => { const s = OV.BattleUI.debug.state(); return !!s && !s.playing && !OV.Presenter.playing; }, null, { timeout: 60000 });
    await idle();
    await sleep(300);
    const st = () => page.evaluate(() => OV.BattleUI.debug.state());
    // um soldado de espingarda (um lança-foguetes pede a 2.ª confirmação de explosivos, que não é o que se testa)
    for (let k = 0; k < 12; k++) {
      const ok = await page.evaluate(() => { const B = OV.Game.B, s = OV.BattleUI.debug.state(), u = OV.BUnits.findUnit(B, s.unit.id), it = OV.BUnits.findItem(B, u.items.R); return !!it && it.type === 'rifle'; });
      if (ok) break;
      await page.keyboard.press('Tab');
      await sleep(150);
    }
    const u0 = await page.evaluate(() => { const s = OV.BattleUI.debug.state(); return { id: s.unit.id, x: s.unit.x, y: s.unit.y, z: s.unit.z || 0, tu: s.unit.tu, turn: OV.Game.B.turn }; });
    await page.keyboard.press('e');
    await sleep(200);
    await page.keyboard.press('1');
    await sleep(250);
    let s = await st();
    log(s.mode === 'target', 'E → 1: modo de pontaria (' + s.mode + ')');
    // procura uma casa onde o tiro está bloqueado (precisa de tiro forçado)
    let found = null;
    for (let r = 2; r <= 9 && !found; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const p = await page.evaluate(([x, y, z]) => OV.BattleUI.debug.tileToScreen(x, y, z), [u0.x + dx, u0.y + dy, u0.z]);
        if (!p || p.x < 280 || p.x > 1000 || p.y < 100 || p.y > 560) continue;
        await page.mouse.move(p.x, p.y, { steps: 2 });
        await sleep(90);
        s = await st();
        if (s.target && s.target.blocked && /tiro forçado/.test(s.target.sub || '')) { found = { p, sub: s.target.sub, label: s.target.label }; break; }
      }
    }
    log(!!found, 'casa com tiro bloqueado: ' + (found ? found.label + ' / ' + found.sub : 'nenhuma'));
    if (found) {
      log(/⌃ Control \+ Enter/.test(found.sub), 'a dica do Mac diz «⌃ Control + Enter»: ' + found.sub);
      await shot(page, 'mac_force_hint');
      await page.keyboard.press('Control+Enter');
      await sleep(250);
      await idle();
      s = await st();
      const turn = await page.evaluate(() => OV.Game.B.turn);
      log(s.unit && s.unit.tu < u0.tu, '⌃ + Enter dispara o tiro forçado (UT ' + u0.tu + '→' + (s.unit && s.unit.tu) + ')');
      log(turn === u0.turn, '⌃ + Enter não termina o turno');
      await shot(page, 'mac_force_fired');
    }
    // ponteiro fora do mapa (em cima do HUD): aviso, nunca fim de turno
    await page.keyboard.press('e');
    await sleep(200);
    await page.keyboard.press('1');
    await sleep(200);
    s = await st();
    log(s.mode === 'target', 'outra vez a apontar');
    await page.mouse.move(640, 1);
    await sleep(150);
    const t0 = await page.evaluate(() => OV.Game.B.turn);
    await page.keyboard.press('Control+Enter');
    await sleep(300);
    log((await page.evaluate(() => OV.Game.B.turn)) === t0 && (await st()).mode === 'target', 'a apontar, ⌃ + Enter não termina o turno: ' + (await toasts(page)));
    if ((await st()).mode === 'target') await page.keyboard.press('Escape');
    await sleep(200);
    // folha de teclas
    await page.keyboard.press('?');
    await sleep(300);
    const sheet = await page.evaluate(() => (document.querySelector('.bs-keysheet') || {}).textContent || '');
    log(/⌃ Control \+ Enter/.test(sheet), 'folha de teclas no Mac: «⌃ Control + Enter»');
    await page.keyboard.press('Escape');
    await sleep(200);
    await noMissing(page, 'batalha Mac');
    // Como Jogar
    await page.goto(URL0 + '?debug=1&nosw=1');
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu');
    await page.evaluate(() => OV.Scenes.push('howto', { tab: 'controls' }));
    await sleep(400);
    let txt = await page.evaluate(() => document.body.innerText);
    log(/⌃ Control \+ Enter/.test(txt) && !/\nCtrl \+ Enter/.test(txt), 'Como Jogar no Mac: «⌃ Control + Enter»');
    if (!/⌃ Control \+ Enter/.test(txt)) {
      for (const tab of ['battle', 'geo']) { await page.evaluate((t) => { OV.Scenes.pop(); OV.Scenes.push('howto', { tab: t }); }, tab); await sleep(300); txt = await page.evaluate(() => document.body.innerText); if (/⌃ Control \+ Enter/.test(txt)) break; }
      log(/⌃ Control \+ Enter/.test(txt), 'Como Jogar no Mac (outro separador): «⌃ Control + Enter»');
    }
    await shot(page, 'mac_howto');
    await ctx.close();
  }

  // ============================== F) iPad: textos de toque ==============================
  {
    console.log('— F) iPad');
    const { ctx, page } = await open('pad', '', { touch: true });
    await page.evaluate(() => { OV.Scenes.pop(); OV.Scenes.push('menu'); });
    await sleep(400);
    let txt = await page.evaluate(() => document.body.innerText);
    log(/Controlos e regras essenciais/.test(txt) && !/Controlos no Mac/.test(txt), 'menu: «Controlos e regras essenciais»');
    await shot(page, 'pad_menu');
    await page.evaluate(() => OV.Screens.openOptions());
    await sleep(500);
    txt = await page.evaluate(() => document.body.innerText);
    log(/um toque acelera ×8/.test(txt) && /botão da granada/.test(txt) && !/Espaço ou clique acelera/.test(txt), 'Opções com textos de toque');
    const keys = await page.evaluate(() => [...document.querySelectorAll('.btn kbd, .btn .key, .modal .key')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.textContent));
    log(!keys.length, 'sem emblemas de tecla nos botões: ' + JSON.stringify(keys.slice(0, 5)));
    await shot(page, 'pad_options');
    await page.keyboard.press('Escape');
    await sleep(300);
    // briefing noturno de um OVNI: «o botão «Esperar pelo dia»»
    await page.evaluate(setupLanded);
    await page.evaluate(() => {
      // noite no local do OVNI: avança o relógio até ser noite em (−8, 40)
      const G = OV.Game.G;
      for (let k = 0; k < 48 && OV.GMath.dayPhase(G, -8, 40) !== 'night'; k++) G.t += 1800;
      G.month = OV.Clock.monthIndex(G.t);
      OV.CampaignUI.launchMission(G, { kind: 'ufo', id: 'u99' }, 'c1');
    });
    await page.waitForFunction(() => (OV.Scenes.top() || {}).id === 'cbriefing');
    await sleep(400);
    txt = await page.evaluate(() => document.querySelector('.cp-brief').textContent);
    const night = /Esperar pelo dia/.test(txt);
    log(night, 'briefing noturno com «Esperar pelo dia»');
    if (night) log(/o botão «Esperar pelo dia»/.test(txt) && !/«Esperar pelo dia» \(W\)/.test(txt), 'briefing no iPad: «o botão «Esperar pelo dia»» sem (W)');
    log(/Toque em «Iniciar missão»/.test(txt), 'rodapé do briefing no iPad: ' + (await page.evaluate(() => (document.querySelector('.cp-brief .scr-hint') || {}).textContent)));
    await shot(page, 'pad_brief_night');
    await noMissing(page, 'iPad');
    await ctx.close();
  }
} catch (e) {
  fails.push('exceção: ' + (e && e.stack || e));
  console.log('✗ exceção: ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.kill();
}

for (const e of errors) console.log('✗ ' + e);
const bad = fails.length + errors.length;
console.log('\n' + (bad ? '✗' : '✓') + ' integration_r2: ' + (checks - fails.length) + '/' + checks + ' verificações' + (errors.length ? ', ' + errors.length + ' erros de página' : '') + ' · capturas em ' + OUT);
process.exit(bad ? 1 : 0);
