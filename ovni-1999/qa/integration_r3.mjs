/* Ronda 3 de personas — integração num Chromium real (Playwright). Uma verificação por pendente integrado (a parte
   pura está em tools/tests/integration_r3.test.js):
   A) Battlescape (Mac, 1440×900, noite num OVNI caído): caminho ○ sem reserva diz «sem UT para disparar»; Esc → o
      painel Opções tem «Abortar missão» (tooltip com X) e X abre a confirmação de sempre; os «Mostrar» do registo
      dizem de que entrada são (aria-label); carga acima da Força mostra «⚖ Carga»; ao fim de 5 turnos sem contacto
      com os alienígenas dentro do OVNI, o relatório do turno dá o conselho «procurem a porta» — uma vez só;
   B) Geoscape (mês 0, Veterano já com uma noite tentada): OVNI aterrado de noite → «Esperar pelo dia» por omissão e
      o texto diz que o OVNI fica no chão até amanhecer;
   C) local já visitado: o diálogo do Geoscape e o briefing mostram a guarnição real (1 alienígena);
   D) «Equipar» a bordo a 1024×560 (cabeçalho e rodapé compactos, mãos e cinto à vista) e no iPad em retrato
      (834×1194: o painel usa a altura toda); a Ufopédia também no retrato.
   Falha com qualquer erro de consola/página ou chave ⟦…⟧. Uso: node ovni-1999/qa/integration_r3.mjs [--out <pasta>] */
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
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
const DEF_OUT = process.env.OVNI_QA_OUT ? path.join(process.env.OVNI_QA_OUT, 'integration_r3') : fs.existsSync(SESSION) ? path.join(SESSION, 'ui4', 'integration_r3') : path.join(process.cwd(), 'qa-out', 'integration_r3');
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
const URL0 = 'http://127.0.0.1:' + port + '/ovni-1999/index.html?debug=1&nosw=1';
const errors = [];
const fails = [];
let browser, ctx, page, shotN = 0, checks = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (ok, msg) => { checks++; console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fails.push(msg); };
const shot = async (name) => { shotN++; await sleep(250); await page.screenshot({ path: path.join(OUT, String(shotN).padStart(2, '0') + '_' + name + '.png') }); };
const st = () => page.evaluate(() => OV.BattleUI.debug.state());
const noMissing = async (where) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const m = txt.match(/⟦[^⟧]*⟧/g);
  log(!m, where + ': sem chaves ⟦…⟧ ' + (m ? [...new Set(m)].join(', ') : ''));
};
function watch(p, tag) {
  p.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + (e && e.message)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console.error: ' + m.text()); });
}
async function newPage(opts, tag, mac) {
  if (ctx) await ctx.close();
  ctx = await browser.newContext(opts);
  if (mac) await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  watch(page, tag);
}
async function idle(ms) {
  await page.waitForFunction(() => {
    if (!OV.BattleUI.scene) return true;
    const s = OV.BattleUI.debug.state();
    return !!s && !s.playing && !OV.Presenter.playing;
  }, null, { timeout: ms || 90000 });
  await sleep(150);
}
async function endTurn() {
  await page.keyboard.press('Enter');
  await sleep(300);
  const b = page.locator('#modals .btn.primary');
  if (await b.count()) await b.first().click();
  for (let k = 0; k < 80; k++) {
    await sleep(100);
    const s = await st();
    if (!s || s.ended || (!s.playing && s.side === 'xcom' && k > 3)) break;
  }
  await idle();
}
// campanha nova no Geoscape (sem introdução)
const NEWG = (o) => {
  const G = OV.Campaign.newCampaign({ seed: o.seed || 41, difficulty: o.diff | 0, baseLonLat: { lon: -9.14, lat: 38.72 } });
  G.ui.geoIntro = true;
  G.month = o.month | 0;
  OV.Game.G = G;
  window.__G = G;
  window.__sky = Object.keys(G.crafts).map((id) => G.crafts[id]).find((c) => OV.Data.crafts[c.type].transport);
  OV.CampaignUI.openGeo(G);
  return true;
};

try {
  if (!(await waitPort(port, 8000))) throw new Error('servidor HTTP não arrancou');
  browser = await chromium.launch();

  // ============================== A) Battlescape ==============================
  await newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'battle', true);
  await page.goto('http://127.0.0.1:' + port + '/ovni-1999/index.html?battle=small_scout&night=1&seed=17&month=0&debug=1&nosw=1');
  await page.waitForFunction(() => window.OV && OV.BattleUI && OV.BattleUI.scene && OV.BattleUI.debug.state(), null, { timeout: 40000 });
  await idle();
  // fechar os conselhos da primeira missão, se abertos
  await page.evaluate(() => { const s = OV.BattleUI.debug.state(); return s && s.report; }).then(async (r) => { if (r) await page.keyboard.press('Escape'); });
  await sleep(200);

  // A1) caminho ○ sem reserva
  const found = await page.evaluate(() => {
    const B = OV.Game.B, D = OV.BattleUI.debug;
    B.reserve = 'none';
    const s0 = D.state();
    const u = OV.BUnits.findUnit(B, s0.selectedId);
    u.tu = Math.min(u.tu, 30);
    OV.BattleUI.refresh();
    for (let r = 2; r <= 12; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const x = u.x + dx, y = u.y + dy;
        if (x < 0 || y < 0 || x >= B.map.w || y >= B.map.h) continue;
        const p = D.tileToScreen(x, y, u.z);
        D.hover(p.x, p.y);
        const s = D.state();
        const sts = s.pathStates;
        if (sts.length > 1 && sts[sts.length - 1] === 'reserve') return { label: s.pathLabel, x, y };
      }
    }
    return null;
  });
  log(!!found && /· sem UT para disparar$/.test(found.label), 'caminho ○ sem reserva: «' + (found && found.label) + '»');
  if (found) await shot('path_noShot');
  // e num destino ● o rótulo não traz o sufixo
  const plain = await page.evaluate(() => {
    const B = OV.Game.B, D = OV.BattleUI.debug;
    const u = OV.BUnits.findUnit(B, D.state().selectedId);
    u.tu = u.tuMax;
    OV.BattleUI.refresh();
    for (let r = 1; r <= 4; r++) {
      for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const x = u.x + dx, y = u.y + dy;
        if (x < 0 || y < 0 || x >= B.map.w || y >= B.map.h) continue;
        const p = D.tileToScreen(x, y, u.z);
        D.hover(p.x, p.y);
        const s = D.state();
        if (s.pathStates.length > 1 && s.pathStates[s.pathStates.length - 1] === 'ok') return { label: s.pathLabel };
      }
    }
    return null;
  });
  log(!!plain && !/sem UT para disparar/.test(plain.label), 'destino ● sem o sufixo: «' + (plain && plain.label) + '»');

  // A2) Esc → Opções com «Abortar missão»; X → confirmação
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.scr-opts', { timeout: 8000 });
  await sleep(300);
  const ab = await page.evaluate(() => {
    const b = document.querySelector('.scr-opts .scr-opt-abort');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent, keys: b.getAttribute('aria-keyshortcuts'), w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  log(!!ab && ab.text === 'Abortar missão' && ab.keys === 'X' && ab.h >= 28, 'Opções (Esc): botão «Abortar missão» ' + JSON.stringify(ab));
  if (ab) {
    await page.mouse.move(ab.x - 30, ab.y - 30);
    await page.mouse.move(ab.x, ab.y, { steps: 6 });
    await sleep(400);
    const tipTxt = await page.evaluate(() => { const t = document.getElementById('tooltip'); return t && !t.classList.contains('hidden') ? t.textContent : ''; });
    log(/Abortar missão\s*X/.test(tipTxt), 'tooltip com a tecla X: «' + tipTxt + '»');
  }
  await shot('options_abort');
  await page.keyboard.press('x');
  await sleep(500);
  const conf = await page.evaluate(() => ({ top: OV.Scenes.top().id, modal: (document.querySelector('#modals .modal') || {}).innerText || '' }));
  log(conf.top === 'battlescape' && /Abortar/i.test(conf.modal), 'X no painel: fecha-o e pede a confirmação ' + JSON.stringify({ top: conf.top, modal: conf.modal.slice(0, 60) }));
  await shot('abort_confirm');
  await page.keyboard.press('Escape');
  await sleep(300);
  log(!(await page.evaluate(() => OV.Game.B.result || OV.Game.B.aborted)), 'Cancelar: a batalha continua');
  // clique no botão também chega à confirmação
  await page.keyboard.press('Escape');
  await page.waitForSelector('.scr-opts .scr-opt-abort');
  await page.click('.scr-opts .scr-opt-abort');
  await sleep(400);
  log(await page.evaluate(() => OV.Scenes.top().id === 'battlescape' && !!document.querySelector('#modals .modal')), 'clique em «Abortar missão» → confirmação');
  await page.keyboard.press('Escape');
  await sleep(300);
  // fora da batalha (menu principal) o painel não tem o botão
  // (verificado mais abaixo, no Geoscape)

  // A3) «Mostrar» com contexto
  await page.evaluate(() => {
    const B = OV.Game.B;
    const s = B.units.find((u) => u.side === 'xcom' && u.onMap && u.status === 'ok');
    const a = B.units.find((u) => u.side === 'alien');
    OV.BattleUI.debug.noteEvent({ t: 'damage', unitId: s.id, amount: 4, dmgType: 'AP', cause: 'shot', attackerId: a.id, pos: OV.BMap.idx(B.map, s.x, s.y, s.z) });
    OV.BattleUI.debug.report('log');
  });
  await sleep(300);
  const aria = await page.evaluate(() => Array.from(document.querySelectorAll('.bs-report-row .btn')).map((b) => ({ label: b.getAttribute('aria-label'), row: b.closest('.bs-report-row').querySelector('.bs-report-txt').textContent })));
  log(aria.length > 0 && aria.every((a) => a.label.endsWith(': ' + a.row) && /^(Mostrar|Atacante): /.test(a.label)), '«Mostrar» com aria-label da entrada ' + JSON.stringify(aria[0]));
  await shot('log_aria');
  await page.keyboard.press('Escape');
  await sleep(200);

  // A4) carga acima da Força
  const heavy = await page.evaluate(() => {
    const B = OV.Game.B, D = OV.BattleUI.debug;
    const u = OV.BUnits.findUnit(B, D.state().selectedId);
    for (let k = 0; k < 6; k++) { const it = OV.BUnits.newItem(B, 'high_explosive'); OV.BUnits.giveItem(B, u, it.id, 'pack', true); }
    OV.BattleUI.refresh();
    return { w: OV.BUnits.weight(B, u), str: u.stats.str };
  });
  await sleep(300);
  const chip = await page.evaluate(() => { const c = document.querySelector('.bs-chip.heavy'); return c ? { text: c.textContent, aria: c.getAttribute('aria-label') } : null; });
  log(!!chip && /Carga/.test(chip.text) && /UT em vez de/.test(chip.aria), 'carga ' + heavy.w + ' > Força ' + heavy.str + ': ' + JSON.stringify(chip));
  await shot('overweight_chip');

  // A5) conselho «estão dentro do OVNI»
  let hintSeen = 0, dueSeen = 0;
  for (let k = 0; k < 3; k++) {
    // os soldados ficam na nave (sem contacto); o último contacto passa para longe
    // último contacto há 4 turnos: depois do turno alienígena faz 5
    const due = await page.evaluate(() => { const B = OV.Game.B; OV.BattleUI.debug.contact(B.turn - 4); return OV.BattleUI.model.ufoHintDue(Object.assign({}, B, { turn: B.turn + 1 }), B.turn - 4); });
    await endTurn();
    const s = await st();
    if (s.ended) break;
    const shown = !!(s.report && s.report.rows.some((t) => /dentro do OVNI/.test(t)));
    const dueAfter = await page.evaluate(() => {
      const B = OV.Game.B, r = B.ufo;
      return B.units.filter((u) => u.side === 'alien' && u.onMap && (u.status === 'ok' || u.status === 'panic')).every((u) => u.x >= r.x && u.x < r.x + r.w && u.y >= r.y && u.y < r.y + r.h);
    });
    if (shown) {
      hintSeen++;
      await shot('ufo_hint');
      const title = await page.evaluate(() => (document.querySelector('.bs-report-title') || {}).textContent || '');
      log(/Sem contacto há 5 turnos: .*[Pp]rocurem a porta/.test(s.report.rows.join(' ')) && /Conselho|turno alienígena/.test(title), 'conselho no relatório do turno («' + title + '»: ' + s.report.rows.join(' | ') + ')');
    } else if (due && dueAfter && s.contactTurn < s.turn - 4 && !s.ufoHinted) dueSeen++;
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  log(hintSeen === 1, 'o conselho aparece uma vez por batalha (' + hintSeen + ')');
  log(dueSeen === 0, 'nunca fica por mostrar quando é devido');
  await noMissing('battlescape');

  // ============================== B) Geoscape: noite segura no mês 0 ==============================
  await newPage({ viewport: { width: 1440, height: 900 } }, 'geo', true);
  await page.goto(URL0);
  await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.CampaignUI && OV.GeoUI);
  await page.evaluate(NEWG, { diff: 1, month: 0, seed: 52 });
  await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
  const night = await page.evaluate(() => {
    const G = window.__G;
    G.ui.geo = Object.assign(G.ui.geo || {}, { nightTried: true });
    let lon = null;
    for (let l = -180; l < 180; l += 10) if (OV.GMath.dayPhase(G, l, 20) === 'night' && OV.GMath.dayPhase({ t: G.t + 3 * 3600 }, l, 20) === 'night') { lon = l; break; }
    if (lon === null) return null;
    const id = 'u960';
    G.ufos.push({ id, type: 'small_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon, lat: 20, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 20 * 3600, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null });
    const c = window.__sky;
    c.lon = lon; c.lat = 20; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
    G.events.push({ t: 'craftArrived', craftId: c.id, target: { kind: 'ufo', id }, prompt: 'mission' });
    OV.GeoUI.open(G);
    return id;
  });
  await sleep(900);
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.geo-pop');
    return p ? { text: p.innerText, prim: (p.querySelector('.btn.primary') || {}).textContent || '' } : null;
  });
  log(!!night && !!pop && /fica no chão até amanhecer/.test(pop.text), 'mês 0: «o OVNI fica no chão até amanhecer» ' + (pop && pop.text.slice(0, 120)));
  log(!!pop && /Esperar pelo dia/.test(pop.prim), 'Veterano depois da 1.ª noite, mas seguro: «Esperar pelo dia» é o Enter (' + (pop && pop.prim) + ')');
  log(!!pop && !/pode descolar entretanto/.test(pop.text), 'sem «pode descolar entretanto»');
  await shot('geo_night_safe');
  await noMissing('geo noite');
  await page.keyboard.press('Escape');
  await sleep(300);
  // fora da batalha, o painel Opções não tem «Abortar missão»
  await page.evaluate(() => OV.Scenes.push('options', {}));
  await sleep(400);
  log(await page.evaluate(() => !!document.querySelector('.scr-opts') && !document.querySelector('.scr-opts .scr-opt-abort')), 'Opções fora da batalha: sem «Abortar missão»');
  await page.evaluate(() => OV.Scenes.pop());
  await sleep(200);

  // ============================== C) guarnição de um local já visitado ==============================
  const gar = await page.evaluate(() => {
    const G = window.__G;
    const id = 'u961';
    G.ufos.push({ id, type: 'medium_scout', missionId: null, race: 'sectoid', region: 'europe', traj: 'P0', wp: 0, lon: 2, lat: 46, dest: null, alt: 0, speed: 0, status: 'landed', dmg: 0, detected: true, hyper: false, groundLeftS: 20 * 3600, crashLeftS: 0, lastSeen: null, objective: false, targetBaseId: null, siteCity: null, siege: null,
      garrison: { crew: [{ type: 'sectoid_soldier', rank: 'soldier', tier: 0, outside: false }], leftovers: { rifle: 1 }, crashed: false, visits: 1 } });
    if (G.seen.ufoTypes.indexOf('medium_scout') < 0) G.seen.ufoTypes.push('medium_scout');
    // menos soldados aptos do que o efetivo normal: o diálogo mostraria «contra 3–5 alienígenas»
    return { id, est: OV.GeoUI.model.crewEstimate(G, { kind: 'ufo', id }) };
  });
  log(gar.est && gar.est.min === 1 && gar.est.max === 1, 'Geoscape: efetivo = guarnição ' + JSON.stringify(gar.est));
  await page.evaluate((id) => {
    const G = window.__G, c = window.__sky, ufo = G.ufos.find((x) => x.id === id);
    c.lon = ufo.lon; c.lat = ufo.lat; c.status = 'patrol'; c.dest = { kind: 'ufo', id };
    OV.CampaignUI.launchMission(G, { kind: 'ufo', id }, c.id);
  }, gar.id);
  await page.waitForFunction(() => OV.Scenes.top() && OV.Scenes.top().id === 'cbriefing', null, { timeout: 10000 });
  await sleep(600);
  const brief = await page.evaluate(() => document.querySelector('.cp-brief').innerText);
  log(/\b1 alienígena\b/.test(brief) && !/\d+–\d+ alienígenas/.test(brief), 'briefing: «1 alienígena» (a guarnição real)');
  await shot('briefing_garrison');
  await noMissing('briefing');

  // ============================== D) «Equipar» e Ufopédia: janelas baixas e retrato ==============================
  async function openEquip(view) {
    await newPage(view, 'equip', !view.hasTouch);
    await page.goto(URL0);
    await page.waitForFunction(() => window.OV && OV.Scenes && OV.Scenes.top() && OV.Scenes.top().id === 'menu', null, { timeout: 30000 });
    await page.evaluate(NEWG, { diff: 1, month: 0, seed: 31 });
    await page.waitForFunction(() => OV.GeoUI.current() && OV.GeoUI.current().mode, null, { timeout: 20000 });
    await sleep(300);
    await page.evaluate(() => { const G = OV.Game.G; OV.Scenes.push('equip', { G, craftId: window.__sky.id }); });
    await page.waitForSelector('.cp-eq .inv-equip', { timeout: 10000 });
    await sleep(500);
  }
  const eqBox = () => page.evaluate(() => {
    const r = (q) => { const n = document.querySelector(q); if (!n) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
    const d = document.querySelector('.inv-doll');
    const v = d ? d.getBoundingClientRect() : null;
    return { panel: r('.cp-eq'), head: r('.cp-eq > header'), foot: r('.cp-eq > footer'), hands: r('.inv-doll .inv-handsrow'), belt: r('.inv-doll .inv-strip.belt'), doll: v ? { t: v.top, b: v.top + d.clientHeight } : null, vh: innerHeight };
  });
  // 1024×560
  await openEquip({ viewport: { width: 1024, height: 560 } });
  let e = await eqBox();
  log(e.head && e.foot && e.head.h + e.foot.h <= 200, '1024×560: cabeçalho + rodapé ≤ 200 px (' + (e.head && e.head.h) + ' + ' + (e.foot && e.foot.h) + ')');
  log(e.hands && e.belt && e.doll && e.hands.t >= e.doll.t - 1 && e.belt.b <= e.doll.b + 1, '1024×560: mãos e cinto à vista ao abrir ' + JSON.stringify({ hands: e.hands, belt: e.belt, doll: e.doll }));
  const hint = await page.evaluate(() => { const n = document.querySelector('.cp-eq > footer .scr-hint'); return n ? { sw: n.scrollWidth, cw: n.clientWidth, ws: getComputedStyle(n).whiteSpace } : null; });
  log(!hint || hint.ws === 'nowrap', '1024×560: a dica do rodapé fica numa linha ' + JSON.stringify(hint));
  await shot('equip_1024x560');
  await noMissing('equipar 1024×560');
  // iPad retrato
  const IPAD = { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  await openEquip(IPAD);
  e = await eqBox();
  log(e.panel && e.panel.h >= e.vh - 80, 'iPad retrato: «Equipar» com a altura toda (' + (e.panel && e.panel.h) + ' de ' + e.vh + ')');
  await shot('equip_ipad_portrait');
  await noMissing('equipar iPad');
  // Ufopédia no retrato
  await page.evaluate(() => OV.Ufopaedia.open(null, 'race_sectoid'));
  await page.waitForSelector('.up-panel', { timeout: 10000 });
  await sleep(500);
  const up = await page.evaluate(() => { const b = document.querySelector('.up-panel').getBoundingClientRect(); return { h: Math.round(b.height), vh: innerHeight }; });
  log(up.h >= up.vh - 80, 'iPad retrato: Ufopédia com a altura toda (' + up.h + ' de ' + up.vh + ')');
  await shot('ufopaedia_ipad_portrait');
  await noMissing('ufopédia iPad');
  // paisagem: nada muda (o painel continua limitado a 880/900 px)
  await page.setViewportSize({ width: 1194, height: 834 });
  await sleep(400);
  const upL = await page.evaluate(() => Math.round(document.querySelector('.up-panel').getBoundingClientRect().height));
  log(upL <= 834, 'iPad paisagem: Ufopédia dentro do ecrã (' + upL + ')');
  await shot('ufopaedia_ipad_landscape');
} catch (err) {
  fails.push('exceção: ' + (err && err.stack ? err.stack : err));
  console.log('✗ exceção: ' + (err && err.stack ? err.stack : err));
} finally {
  if (browser) await browser.close();
  server.kill();
}
for (const e of errors) { console.log('✗ ' + e); fails.push(e); }
console.log((fails.length ? '✗ ' : '✓ ') + (checks - fails.length + errors.length) + '/' + checks + ' verificações · capturas em ' + OUT);
process.exit(fails.length ? 1 : 0);
